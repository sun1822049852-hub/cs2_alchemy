const fs = require("node:fs");
const path = require("node:path");

const {AccountStore} = require("./accountStore");
const {TokenStore} = require("./tokenStore");
const {CS2Session} = require("./cs2Session");
const {probeWeaponArmoryWithSteam} = require("./services/weaponArmoryService");
const {asString, nowStamp, sleep} = require("./utils");

function sanitizeCapturePathSegment(value, fallback = "active") {
  const normalized = asString(value).trim().replace(/[^\w.-]+/g, "_");
  return normalized || fallback;
}

function buildGcCaptureOutputPath({
  accountName = "",
  outputPath = "",
  outputDir = "",
  baseDir = path.resolve(__dirname, ".."),
  stamp = nowStamp()
} = {}) {
  const explicitPath = asString(outputPath).trim();
  if (explicitPath) {
    return path.resolve(explicitPath);
  }
  const directory = asString(outputDir).trim()
    ? path.resolve(outputDir)
    : path.resolve(baseDir, "tmp");
  return path.join(
    directory,
    `gc-session-${sanitizeCapturePathSegment(stamp, "capture")}-${sanitizeCapturePathSegment(accountName)}.jsonl`
  );
}

function createGcSessionWriter({outputPath, fsImpl = fs} = {}) {
  const resolvedPath = path.resolve(asString(outputPath).trim());
  fsImpl.mkdirSync(path.dirname(resolvedPath), {recursive: true});
  fsImpl.writeFileSync(resolvedPath, "", "utf8");
  let count = 0;
  return {
    outputPath: resolvedPath,
    write(entry) {
      if (!entry || typeof entry !== "object") {
        return;
      }
      fsImpl.appendFileSync(resolvedPath, `${JSON.stringify(entry)}\n`, "utf8");
      count += 1;
    },
    getCount() {
      return count;
    }
  };
}

async function captureGcSession({
  accountName,
  password,
  durationMs = 3000,
  ackTracks = true,
  ackWaitMs = 500,
  outputPath = "",
  outputDir = "",
  logger,
  accountStore = null,
  tokenStore = null,
  SessionClass = CS2Session,
  probeFn = probeWeaponArmoryWithSteam,
  sleepFn = sleep
} = {}) {
  const accounts = accountStore || new AccountStore();
  const active = accountName
    ? (typeof accounts.getCredentials === "function" ? accounts.getCredentials(accountName) : accounts.get(accountName))
    : (typeof accounts.getActiveCredentials === "function" ? accounts.getActiveCredentials() : accounts.getActive());
  if (!active) {
    throw new Error(`account not found: ${accountName || "(active)"}`);
  }

  const resolvedAccount = asString(active.username).trim();
  const resolvedPassword = asString(password || active.password || "").trim();
  const tokens = tokenStore || new TokenStore();
  const refreshToken = typeof tokens.get === "function" ? asString(tokens.get(resolvedAccount)).trim() : "";
  if (!refreshToken && !resolvedPassword) {
    throw new Error(`password missing: ${resolvedAccount}`);
  }

  const normalizedDurationMs = Math.max(0, Number(durationMs) || 0);
  const normalizedAckWaitMs = Math.max(0, Number(ackWaitMs) || 0);
  const writer = createGcSessionWriter({
    outputPath: buildGcCaptureOutputPath({
      accountName: resolvedAccount,
      outputPath,
      outputDir
    })
  });
  const session = new SessionClass({logger, tokenStore: tokens});

  try {
    const {steam} = await session.connect({
      username: resolvedAccount,
      password: resolvedPassword,
      refreshToken,
      gcTrace: {
        enabled: true,
        onMessage(entry) {
          writer.write({
            account: resolvedAccount,
            ...entry
          });
        }
      }
    });

    let probeResult = null;
    if (typeof probeFn === "function") {
      probeResult = await probeFn({
        steam,
        accountName: resolvedAccount,
        ackTracks: Boolean(ackTracks),
        ackWaitMs: normalizedAckWaitMs,
        waitMs: normalizedDurationMs,
        traceLimit: 50,
        logger
      });
    } else {
      await sleepFn(normalizedDurationMs);
    }

    return {
      ok: true,
      account: resolvedAccount,
      output_path: writer.outputPath,
      messages_written: writer.getCount(),
      ack_tracks: {
        sent: Boolean(ackTracks),
        wait_ms: normalizedAckWaitMs
      },
      wait_ms: normalizedDurationMs,
      probe_result: probeResult
        ? {
          before_state: probeResult.before_state || null,
          after_state: probeResult.after_state || null,
          observed_gc_messages: Array.isArray(probeResult.observed_gc_messages)
            ? probeResult.observed_gc_messages.length
            : 0
        }
        : null
    };
  } finally {
    session.disconnect();
  }
}

module.exports = {
  buildGcCaptureOutputPath,
  captureGcSession
};
