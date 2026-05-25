const net = require("net");
const https = require("https");
const {URL} = require("url");
const {asString} = require("./utils");
const {
  getProxyUrl: getConfiguredProxyUrl,
  proxyHint: getConfiguredProxyHint,
  createProxyAgentForUrl
} = require("./proxyConfig");

const AUTH_PRECHECK_URL =
  "https://api.steampowered.com/IAuthenticationService/GetPasswordRSAPublicKey/v1?account_name=precheck";
const AUTH_PRECHECK_TIMEOUT_MS = 4000;
const AUTH_PRECHECK_CACHE_MS = 2 * 60 * 1000;
const AUTH_FAILURE_COOLDOWN_MS = 10 * 1000;

const CM_PROBE_TIMEOUT_MS = 400;
const CM_PROBE_CACHE_MS = 60 * 1000;
const CM_PROBE_MAX_SERVERS = 8;
const CM_PROBE_WORKERS = 4;
const CM_SERVERS = [
  {host: "162.254.197.42", port: 443, name: "HK-1"},
  {host: "162.254.197.43", port: 443, name: "HK-2"},
  {host: "155.133.248.53", port: 443, name: "SG-1"},
  {host: "155.133.248.54", port: 443, name: "SG-2"},
  {host: "162.254.192.67", port: 443, name: "US-1"},
  {host: "162.254.192.68", port: 443, name: "US-2"},
  {host: "146.66.152.11", port: 443, name: "EU-1"},
  {host: "146.66.152.12", port: 443, name: "EU-2"},
  {host: "146.66.155.11", port: 443, name: "EU-3"},
  {host: "146.66.155.12", port: 443, name: "EU-4"},
  {host: "155.133.246.68", port: 443, name: "JP-1"},
  {host: "155.133.246.69", port: 443, name: "JP-2"}
];

const authPrecheckCacheByProxy = new Map();
const authFailureCooldownByProxy = new Map();
let cmProbeCache = null;

function getProxyUrl() {
  return asString(getConfiguredProxyUrl()).trim();
}

function authProxyKey() {
  return getProxyUrl().toLowerCase();
}

function proxyHint() {
  return getConfiguredProxyHint();
}

function requestAuthPrecheck({timeout}) {
  return new Promise((resolve, reject) => {
    const url = new URL(AUTH_PRECHECK_URL);
    const proxyAgent = createProxyAgentForUrl(AUTH_PRECHECK_URL);
    const reqOptions = {
      method: "GET",
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        Accept: "application/json"
      },
      timeout
    };
    if (proxyAgent) {
      reqOptions.agent = proxyAgent;
    }

    const req = https.request(reqOptions, (res) => {
      let text = "";
      res.on("data", (chunk) => {
        text += String(chunk || "");
      });
      res.on("end", () => {
        resolve({
          ok: Number(res.statusCode || 0) >= 200 && Number(res.statusCode || 0) < 300,
          status: Number(res.statusCode) || 0,
          text
        });
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`timeout(${timeout}ms)`));
    });
    req.on("error", reject);
    req.end();
  });
}

function shouldUseAuthCache(entry, force) {
  if (force) {
    return false;
  }
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const checkedAt = Number(entry.checked_at || 0);
  if (!Number.isFinite(checkedAt) || checkedAt <= 0) {
    return false;
  }
  return Date.now() - checkedAt < AUTH_PRECHECK_CACHE_MS;
}

function formatAuthCooldown(cooldownUntil) {
  const remainMs = Math.max(0, Number(cooldownUntil || 0) - Date.now());
  if (remainMs <= 0) {
    return "";
  }
  return `cooldown ${Math.ceil(remainMs / 1000)}s`;
}

async function precheckAuthApi({logger, force = false, timeoutMs = AUTH_PRECHECK_TIMEOUT_MS} = {}) {
  const key = authProxyKey();
  const cached = authPrecheckCacheByProxy.get(key);
  if (shouldUseAuthCache(cached, force)) {
    return {
      ok: !!cached.ok,
      detail: asString(cached.detail).trim(),
      from_cache: true
    };
  }

  const cooldownUntil = Number(authFailureCooldownByProxy.get(key) || 0);
  if (!force && cooldownUntil > Date.now()) {
    const detail = formatAuthCooldown(cooldownUntil);
    return {
      ok: false,
      detail,
      from_cache: true
    };
  }

  const timeout = Math.max(500, Number(timeoutMs) || AUTH_PRECHECK_TIMEOUT_MS);
  let result = {
    ok: false,
    detail: "precheck_failed",
    from_cache: false
  };

  try {
    const response = await requestAuthPrecheck({timeout});
    const text = response.text;
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      parsed = null;
    }
    const body = parsed && parsed.response && typeof parsed.response === "object" ? parsed.response : {};
    const hasRsa = Boolean(asString(body.publickey_mod).trim());
    if (response.ok && hasRsa) {
      const ts = asString(body.timestamp).trim();
      result = {
        ok: true,
        detail: `http=${response.status} rsa_ts=${ts || "-"}`,
        from_cache: false
      };
      authFailureCooldownByProxy.set(key, 0);
      if (logger) {
        logger.info("auth_precheck", `auth api reachable: ${result.detail}`);
      }
    } else {
      const snippet = asString(text).trim().slice(0, 120).replace(/\s+/g, " ");
      result = {
        ok: false,
        detail: `http=${response.status} has_rsa=${hasRsa ? "yes" : "no"} body=${snippet || "-"}`,
        from_cache: false
      };
      authFailureCooldownByProxy.set(key, Date.now() + AUTH_FAILURE_COOLDOWN_MS);
      if (logger) {
        logger.warn("auth_precheck", `auth api precheck failed: ${result.detail}${proxyHint()}`);
      }
    }
  } catch (err) {
    const msg = asString(err && err.message ? err.message : err).trim();
    const isAbort = /aborted|abort|timeout/i.test(msg);
    result = {
      ok: false,
      detail: isAbort ? `timeout(${timeout}ms)` : (msg || "request_failed"),
      from_cache: false
    };
    authFailureCooldownByProxy.set(key, Date.now() + AUTH_FAILURE_COOLDOWN_MS);
    if (logger) {
      logger.warn("auth_precheck", `auth api precheck error: ${result.detail}${proxyHint()}`);
    }
  }

  authPrecheckCacheByProxy.set(key, {
    ok: result.ok,
    detail: result.detail,
    checked_at: Date.now()
  });
  return result;
}

async function ensureAuthApiReachable({logger, force = true, timeoutMs = AUTH_PRECHECK_TIMEOUT_MS} = {}) {
  const checked = await precheckAuthApi({logger, force, timeoutMs});
  if (checked.ok) {
    return checked;
  }
  throw new Error(`Steam auth api unreachable: ${checked.detail}${proxyHint()}`);
}

function probeTcpServer({host, port, timeoutMs}) {
  return new Promise((resolve) => {
    const timeout = Math.max(100, Number(timeoutMs) || CM_PROBE_TIMEOUT_MS);
    const startedAt = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (ok, reason) => {
      if (settled) {
        return;
      }
      settled = true;
      const latencyMs = Math.max(1, Date.now() - startedAt);
      try {
        socket.destroy();
      } catch (_) {
        // ignore destroy errors
      }
      resolve({
        ok: !!ok,
        host,
        port,
        latency_ms: latencyMs,
        reason: asString(reason).trim()
      });
    };

    socket.setTimeout(timeout);
    socket.once("timeout", () => finish(false, `timeout(${timeout}ms)`));
    socket.once("error", (err) => {
      const code = asString(err && (err.code || "")).trim();
      const message = asString(err && err.message ? err.message : err).trim();
      finish(false, code ? `${code}${message ? `:${message}` : ""}` : message || "connect_error");
    });
    socket.once("connect", () => finish(true, ""));

    try {
      socket.connect(Number(port), String(host));
    } catch (err) {
      finish(false, asString(err && err.message ? err.message : err));
    }
  });
}

function sortByLatency(a, b) {
  return Number(a && a.latency_ms || 0) - Number(b && b.latency_ms || 0);
}

async function probeCmReachability({
  logger,
  force = false,
  timeoutMs = CM_PROBE_TIMEOUT_MS,
  maxServers = CM_PROBE_MAX_SERVERS,
  workers = CM_PROBE_WORKERS
} = {}) {
  if (!force && cmProbeCache && Date.now() - Number(cmProbeCache.checked_at || 0) < CM_PROBE_CACHE_MS) {
    return {
      ...cmProbeCache,
      from_cache: true
    };
  }

  const limit = Math.max(1, Math.min(CM_SERVERS.length, Number(maxServers) || CM_PROBE_MAX_SERVERS));
  const candidates = CM_SERVERS.slice(0, limit);
  const resultList = new Array(candidates.length);
  let nextIndex = 0;

  const workerCount = Math.max(1, Math.min(candidates.length, Number(workers) || CM_PROBE_WORKERS));
  const runWorker = async () => {
    while (true) {
      const idx = nextIndex;
      nextIndex += 1;
      if (idx >= candidates.length) {
        return;
      }
      const target = candidates[idx];
      resultList[idx] = await probeTcpServer({
        host: target.host,
        port: target.port,
        timeoutMs
      });
    }
  };

  await Promise.all(new Array(workerCount).fill(0).map(() => runWorker()));

  const reachableList = resultList.filter((x) => x && x.ok).sort(sortByLatency);
  const fastest = reachableList.length ? reachableList[0] : null;
  const summary = {
    checked_at: Date.now(),
    total: candidates.length,
    reachable: reachableList.length,
    fastest: fastest
      ? `${fastest.host}:${fastest.port}@${fastest.latency_ms}ms`
      : "",
    results: resultList.map((entry, idx) => ({
      host: candidates[idx].host,
      port: candidates[idx].port,
      ok: !!(entry && entry.ok),
      latency_ms: Number(entry && entry.latency_ms || 0),
      reason: asString(entry && entry.reason ? entry.reason : "").trim()
    }))
  };

  cmProbeCache = summary;

  if (logger) {
    if (summary.reachable > 0) {
      logger.info(
        "cm_precheck",
        `cm probe reachable=${summary.reachable}/${summary.total} fastest=${summary.fastest || "-"}`
      );
    } else {
      logger.warn("cm_precheck", `cm probe reachable=0/${summary.total}${proxyHint()}`);
    }
  }

  return {
    ...summary,
    from_cache: false
  };
}

module.exports = {
  getProxyUrl,
  proxyHint,
  precheckAuthApi,
  ensureAuthApiReachable,
  probeCmReachability
};
