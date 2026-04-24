/**
 * steamGuardEnrollService.js
 * Steam Guard (mobile authenticator) enrollment — two-phase flow:
 *   Phase 1: enrollSteamGuard  → enableTwoFactor → returns revocation_code, waits for SMS
 *   Phase 2: finalizeSteamGuard → finalizeTwoFactor → returns maFile JSON
 */

const crypto = require("crypto");
const SteamUser = require("steam-user");
const SteamTotp = require("steam-totp");
const { ensureAuthApiReachable } = require("./networkPrecheck");
const { withTimeout } = require("./utils");

// ── session cache ──────────────────────────────────────────────────
const enrollingSessions = new Map(); // key=username  value={steam, sharedSecret, response, timestamp}
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [username, entry] of enrollingSessions) {
    if (now - entry.timestamp > SESSION_TTL_MS) {
      try { entry.steam.logOff(); } catch (_) { /* best-effort */ }
      enrollingSessions.delete(username);
    }
  }
}

// ── helpers ────────────────────────────────────────────────────────
function generateDeviceId() {
  const bytes = crypto.randomBytes(16);
  // RFC-4122 v4: set version (4) and variant (10xx)
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return (
    hex.slice(0, 8) + "-" +
    hex.slice(8, 12) + "-" +
    hex.slice(12, 16) + "-" +
    hex.slice(16, 20) + "-" +
    hex.slice(20, 32)
  );
}

function log(logger, msg, data) {
  if (logger && typeof logger.info === "function") {
    logger.info("steam_guard", msg, data);
  }
}

// ── Phase 1: enable two-factor ────────────────────────────────────
async function enrollSteamGuard({ username, refreshToken, logger, timeoutMs = 60000 }) {
  cleanupExpiredSessions();

  try {
    await ensureAuthApiReachable({ logger });
  } catch (err) {
    return { ok: false, reason: "network_unreachable", message: String(err && err.message || err) };
  }

  const steam = new SteamUser({ autoRelogin: false, renewRefreshTokens: true });

  // login with refresh token
  try {
    await withTimeout(
      new Promise((resolve, reject) => {
        steam.once("loggedOn", resolve);
        steam.once("error", reject);
        steam.logOn({ refreshToken });
      }),
      timeoutMs,
      "Steam logOn timed out"
    );
    log(logger, "logged on for enrollment", { username });
  } catch (err) {
    try { steam.logOff(); } catch (_) {}
    return { ok: false, reason: "login_failed", message: String(err && err.message || err) };
  }

  // enableTwoFactor
  try {
    const response = await withTimeout(
      new Promise((resolve, reject) => {
        steam.enableTwoFactor((err, resp) => {
          if (err) return reject(err);
          resolve(resp);
        });
      }),
      timeoutMs,
      "enableTwoFactor timed out"
    );

    log(logger, "enableTwoFactor response", { username, status: response.status });

    if (response.status === 29) {
      try { steam.logOff(); } catch (_) {}
      return { ok: false, reason: "already_has_authenticator", status: 29 };
    }
    if (response.status === 84) {
      try { steam.logOff(); } catch (_) {}
      return { ok: false, reason: "rate_limited", status: 84 };
    }
    if (response.status === 2) {
      try { steam.logOff(); } catch (_) {}
      return { ok: false, reason: "no_phone_number", status: 2 };
    }
    if (response.status !== 1) {
      try { steam.logOff(); } catch (_) {}
      return { ok: false, reason: "unknown_error", status: response.status };
    }

    // status === 1 → success, cache session for finalize phase
    enrollingSessions.set(username, {
      steam,
      sharedSecret: response.shared_secret,
      response,
      timestamp: Date.now(),
    });

    return {
      ok: true,
      status: 1,
      revocation_code: response.revocation_code,
      requires_sms: true,
      server_time: response.server_time,
    };
  } catch (err) {
    try { steam.logOff(); } catch (_) {}
    return { ok: false, reason: "enable_two_factor_failed", message: String(err && err.message || err) };
  }
}

// ── Phase 2: finalize with SMS code ───────────────────────────────
async function finalizeSteamGuard({ username, activationCode, logger }) {
  cleanupExpiredSessions();

  const session = enrollingSessions.get(username);
  if (!session) {
    return { ok: false, reason: "no_pending_session" };
  }

  const { steam, sharedSecret, response: enrollResponse } = session;

  try {
    // compute current TOTP to prove we hold the secret
    SteamTotp.generateAuthCode(sharedSecret);

    const sharedSecretBuffer = Buffer.isBuffer(sharedSecret)
      ? sharedSecret
      : Buffer.from(sharedSecret, "base64");

    await new Promise((resolve, reject) => {
      steam.finalizeTwoFactor(sharedSecretBuffer, activationCode, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    log(logger, "finalizeTwoFactor succeeded", { username });

    // assemble maFile
    const maFileJson = {
      shared_secret: enrollResponse.shared_secret,
      serial_number: String(enrollResponse.serial_number || ""),
      revocation_code: enrollResponse.revocation_code,
      uri: enrollResponse.uri || "",
      server_time: String(enrollResponse.server_time || ""),
      account_name: username,
      token_gid: enrollResponse.token_gid || "",
      identity_secret: enrollResponse.identity_secret || "",
      secret_1: enrollResponse.secret_1 || "",
      status: 1,
      device_id: `android:${generateDeviceId()}`,
      Session: {},
    };

    // cleanup
    enrollingSessions.delete(username);
    try { steam.logOff(); } catch (_) {}

    return {
      ok: true,
      maFileContent: JSON.stringify(maFileJson),
      revocation_code: enrollResponse.revocation_code,
    };
  } catch (err) {
    log(logger, "finalizeTwoFactor failed", { username, error: String(err && err.message || err) });
    return { ok: false, reason: "finalize_failed", message: String(err && err.message || err) };
  }
}

module.exports = { enrollSteamGuard, finalizeSteamGuard };
