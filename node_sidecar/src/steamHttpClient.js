"use strict";

const https = require("https");
const http = require("http");
const zlib = require("zlib");
const crypto = require("crypto");
const { URL } = require("url");

// ═══════════════════════════════════════════════════════════════════════════
// Chrome 指纹常量 — 统一版本，三处一致
// ═══════════════════════════════════════════════════════════════════════════
const CHROME_VER = "136";
const CHROME_FULL = "136.0.7103.114";
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL} Safari/537.36`;
const SEC_CH_UA = `"Chromium";v="${CHROME_VER}", "Not.A/Brand";v="24", "Google Chrome";v="${CHROME_VER}"`;

// ═══════════════════════════════════════════════════════════════════════════
// browserid 会话级缓存 — 按 steamId64 维度，5 分钟 TTL
// ═══════════════════════════════════════════════════════════════════════════
const _browserIdCache = new Map();
const BROWSERID_TTL = 5 * 60 * 1000;

function _getBrowserId(steamId64) {
  const key = steamId64 || "__global__";
  const cached = _browserIdCache.get(key);
  if (cached && Date.now() - cached.ts < BROWSERID_TTL) return cached.id;
  const id = crypto.randomBytes(8).toString("hex");
  _browserIdCache.set(key, { id, ts: Date.now() });
  return id;
}

/**
 * Enhance a base cookie string with browser simulation fields.
 * browserid 按 steamId64 会话级缓存，不再每次随机。
 * 支持 steamLoginSecure 多值时按 JWT aud 选择正确的 token。
 * @param {string} baseCookie
 * @param {object} [opts]
 * @param {string} [opts.steamId64] - 用于 browserid 缓存 key
 * @param {string} [opts.domain] - "community" | "store"，用于 steamLoginSecure 选择
 * @returns {string}
 */
function enhanceCookieString(baseCookie, opts = {}) {
  const { steamId64, domain } = opts;
  const parts = baseCookie ? baseCookie.split(";").map(s => s.trim()).filter(Boolean) : [];
  const cookieMap = new Map();
  const secures = [];

  for (const p of parts) {
    const eqIdx = p.indexOf("=");
    if (eqIdx < 0) continue;
    const name = p.slice(0, eqIdx);
    const value = p.slice(eqIdx + 1);
    if (name === "steamLoginSecure") {
      secures.push(value);
    } else {
      cookieMap.set(name, value);
    }
  }

  // 注入浏览器必备 cookie
  if (!cookieMap.has("Steam_Language")) cookieMap.set("Steam_Language", "schinese");
  if (!cookieMap.has("timezoneOffset")) cookieMap.set("timezoneOffset", "28800,0");
  if (!cookieMap.has("browserid")) cookieMap.set("browserid", _getBrowserId(steamId64));
  if (!cookieMap.has("sessionid")) cookieMap.set("sessionid", crypto.randomBytes(12).toString("hex"));

  // steamLoginSecure 多值：按 JWT aud 选择匹配 domain 的 token
  let targetSecure = secures[0] || "";
  if (secures.length > 1) {
    const targetAud = (domain || "").includes("store") ? "web:store" : "web:community";
    for (const s of secures) {
      try {
        const decoded = decodeURIComponent(s);
        if (decoded.includes("||")) {
          const jwt = decoded.split("||")[1];
          const payloadBase64 = jwt.split(".")[1];
          if (payloadBase64) {
            const payload = JSON.parse(Buffer.from(payloadBase64, "base64").toString("utf8"));
            if (payload.aud && payload.aud.includes(targetAud)) {
              targetSecure = s;
              break;
            }
          }
        }
      } catch (_) { /* 解析失败用第一个 */ }
    }
  }

  // 组装结果：steamLoginSecure 放最前
  let result = targetSecure ? `steamLoginSecure=${targetSecure}` : "";
  for (const [k, v] of cookieMap) {
    if (result) result += "; ";
    result += `${k}=${v}`;
  }
  return result;
}

/**
 * Build browser-simulated headers for Steam POST (XHR) requests.
 * Origin 从 referer 自动推导，不再硬编码 steamcommunity.com。
 * @param {object} opts
 * @param {string} opts.cookieString - enhanced cookie
 * @param {string} [opts.sessionid]
 * @param {string} [opts.steamId64]
 * @param {string} [opts.referer]
 * @returns {object}
 */
function buildSteamHeaders({ cookieString, sessionid, steamId64, referer }) {
  const ref = referer || `https://steamcommunity.com/profiles/${steamId64}/`;
  // Origin 从 referer 自动提取
  let origin;
  try { origin = new URL(ref).origin; } catch (_) { origin = "https://steamcommunity.com"; }

  return {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Cookie": cookieString,
    "Referer": ref,
    "Origin": origin,
    "X-Requested-With": "XMLHttpRequest",
    "User-Agent": UA,
    "sec-ch-ua": SEC_CH_UA,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Connection": "keep-alive",
  };
}

/**
 * Build GET-specific headers (navigate mode, HTML Accept, no XHR markers).
 */
function _buildGetHeaders(baseHeaders) {
  const h = { ...baseHeaders };
  delete h["Content-Type"];
  delete h["X-Requested-With"];
  delete h["Origin"];
  h["sec-fetch-mode"] = "navigate";
  h["sec-fetch-dest"] = "document";
  h["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8";
  h["Upgrade-Insecure-Requests"] = "1";
  return h;
}

/**
 * Decompress response body based on content-encoding header.
 * @param {Buffer} raw
 * @param {string} encoding - content-encoding value
 * @returns {Promise<Buffer>}
 */
function _decompress(raw, encoding) {
  if (!encoding) return Promise.resolve(raw);
  const enc = encoding.trim().toLowerCase();
  if (enc === "gzip" || enc === "x-gzip") {
    return new Promise((resolve, reject) => zlib.gunzip(raw, (err, buf) => err ? reject(err) : resolve(buf)));
  }
  if (enc === "deflate") {
    return new Promise((resolve, reject) => zlib.inflate(raw, (err, buf) => err ? reject(err) : resolve(buf)));
  }
  if (enc === "br") {
    return new Promise((resolve, reject) => zlib.brotliDecompress(raw, (err, buf) => err ? reject(err) : resolve(buf)));
  }
  return Promise.resolve(raw);
}

/**
 * Core request executor with retry + 429 exponential backoff + gzip/br decompression.
 * Always resolves — never throws.
 * @param {object} opts
 * @param {string} opts.method - GET or POST
 * @param {string} opts.url
 * @param {string|object|null} opts.body - for POST; object → URLSearchParams encoded
 * @param {object} opts.headers
 * @param {number} [opts.maxRetries=3]
 * @param {number} [opts.retryDelayMs=1500]
 * @param {number} [opts.timeoutMs=25000]
 * @returns {Promise<{statusCode: number, body: string, json: object|null}>}
 */
function _request({ method, url, body, headers, maxRetries = 3, retryDelayMs = 1500, timeoutMs = 25000 }) {
  let encodedBody = null;
  if (body != null && method === "POST") {
    encodedBody = typeof body === "object" ? new URLSearchParams(body).toString() : String(body);
  }

  const parsed = new URL(url);
  const transport = parsed.protocol === "https:" ? https : http;

  const doRequest = (attempt) => new Promise((resolve) => {
    const reqOpts = {
      method,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: { ...headers },
      timeout: timeoutMs,
    };

    if (encodedBody && method === "POST") {
      reqOpts.headers["Content-Length"] = Buffer.byteLength(encodedBody);
    }

    const req = transport.request(reqOpts, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", async () => {
        const rawBuf = Buffer.concat(chunks);
        const statusCode = res.statusCode;

        // 解压
        let bodyStr;
        try {
          const decompressed = await _decompress(rawBuf, res.headers["content-encoding"]);
          bodyStr = decompressed.toString("utf8");
        } catch (_) {
          bodyStr = rawBuf.toString("utf8");
        }

        let json = null;
        try { json = JSON.parse(bodyStr); } catch (_) { /* not json */ }

        const result = { statusCode, body: bodyStr, json };

        // 429 — exponential backoff with jitter
        if (statusCode === 429 && attempt < maxRetries) {
          const delay = retryDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
          setTimeout(() => resolve(doRequest(attempt + 1)), delay);
          return;
        }

        // 5xx — retry
        if (statusCode >= 500 && attempt < maxRetries) {
          const delay = retryDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 300);
          setTimeout(() => resolve(doRequest(attempt + 1)), delay);
          return;
        }

        resolve(result);
      });
    });

    req.on("timeout", () => {
      req.destroy();
      if (attempt < maxRetries) {
        const delay = retryDelayMs * Math.pow(2, attempt);
        setTimeout(() => resolve(doRequest(attempt + 1)), delay);
      } else {
        resolve({ statusCode: 0, body: "timeout", json: null });
      }
    });

    req.on("error", (err) => {
      if (attempt < maxRetries) {
        const delay = retryDelayMs * Math.pow(2, attempt);
        setTimeout(() => resolve(doRequest(attempt + 1)), delay);
      } else {
        resolve({ statusCode: 0, body: err.message, json: null });
      }
    });

    if (encodedBody && method === "POST") {
      req.write(encodedBody);
    }
    req.end();
  });

  return doRequest(0);
}

/**
 * POST request with retry + 429 backoff.
 */
function steamPost(opts) {
  return _request({ ...opts, method: "POST" });
}

/**
 * GET request with retry + 429 backoff.
 * Headers auto-adjusted for navigate mode.
 */
function steamGet(opts) {
  return _request({
    ...opts,
    method: "GET",
    body: null,
    headers: _buildGetHeaders(opts.headers || {}),
  });
}

module.exports = {
  enhanceCookieString,
  buildSteamHeaders,
  steamPost,
  steamGet,
};
