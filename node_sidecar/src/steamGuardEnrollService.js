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
const { refreshAccessToken } = require("./steamWebSession");
const { asString, withTimeout } = require("./utils");

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

function resolveSteamId64(steam) {
  if (!steam || !steam.steamID) {
    return "";
  }
  const steamId = steam.steamID;
  if (typeof steamId.getSteamID64 === "function") {
    return asString(steamId.getSteamID64()).trim();
  }
  if (typeof steamId.toString === "function") {
    return asString(steamId.toString()).trim();
  }
  return "";
}

function resolveDeviceId(steam) {
  const steamId64 = resolveSteamId64(steam);
  if (steamId64) {
    try {
      return SteamTotp.getDeviceID(steamId64);
    } catch (_) {
      // fall through to random device id
    }
  }
  return `android:${generateDeviceId()}`;
}

function secretToBase64(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString("base64");
  }
  return asString(value).trim();
}

function secretToBuffer(value) {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  const text = asString(value).trim();
  return text ? Buffer.from(text, "base64") : Buffer.alloc(0);
}

function normalizeTokenPayload(token = {}) {
  const serverTime = token && Object.prototype.hasOwnProperty.call(token, "server_time")
    ? token.server_time
    : "";
  return {
    ...token,
    shared_secret: secretToBase64(token.shared_secret),
    identity_secret: secretToBase64(token.identity_secret),
    secret_1: secretToBase64(token.secret_1),
    revocation_code: asString(token.revocation_code).trim(),
    uri: asString(token.uri).trim(),
    account_name: asString(token.account_name).trim(),
    token_gid: asString(token.token_gid).trim(),
    serial_number: asString(token.serial_number).trim(),
    status: Number(token.status) || 1,
    steamid: asString(token.steamid).trim(),
    steamguard_scheme: Number(token.steamguard_scheme) || 0,
    server_time: asString(serverTime).trim()
  };
}

function sendUnified(steam, method, payload) {
  return new Promise((resolve, reject) => {
    try {
      steam._sendUnified(method, payload, (body) => resolve(body || {}));
    } catch (err) {
      reject(err);
    }
  });
}

async function startReplaceAuthenticator(steam) {
  const body = await sendUnified(steam, "TwoFactor.RemoveAuthenticatorViaChallengeStart#1", {});
  if (!body || body.success !== true) {
    throw new Error("replace_start_failed");
  }
  return body;
}

async function continueReplaceAuthenticator(steam, smsCode) {
  const body = await sendUnified(steam, "TwoFactor.RemoveAuthenticatorViaChallengeContinue#1", {
    sms_code: asString(smsCode).trim(),
    generate_new_token: true,
    version: 1
  });
  if (!body || body.success !== true || !body.replacement_token) {
    throw new Error("replace_finalize_failed");
  }
  return body;
}

async function buildProjectCompatibleMaFile({
  tokenPayload,
  accountName,
  steamId64,
  refreshToken,
  deviceId,
  refreshAccessTokenFn = refreshAccessToken
}) {
  const normalized = normalizeTokenPayload(tokenPayload);
  const sid = asString(steamId64 || normalized.steamid).trim();
  const refreshTokenText = asString(refreshToken).trim();
  if (!sid) {
    throw new Error("steam_id64_missing");
  }
  if (!refreshTokenText) {
    throw new Error("refresh_token_missing");
  }

  const accessToken = await refreshAccessTokenFn(refreshTokenText);
  return {
    uri: normalized.uri,
    status: normalized.status || 1,
    Session: {
      SteamID: sid,
      SteamLoginSecure: `steamLoginSecure=${sid}%7C%7C${refreshTokenText}`
    },
    secret_1: normalized.secret_1,
    device_id: asString(deviceId).trim(),
    token_gid: normalized.token_gid,
    server_time: asString(normalized.server_time).trim(),
    access_token: asString(accessToken).trim(),
    account_name: normalized.account_name || asString(accountName).trim(),
    serial_number: normalized.serial_number,
    shared_secret: normalized.shared_secret,
    fully_enrolled: true,
    identity_secret: normalized.identity_secret,
    revocation_code: normalized.revocation_code,
    steamid: sid,
    steamguard_scheme: normalized.steamguard_scheme ? String(normalized.steamguard_scheme) : ""
  };
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
      try {
        await startReplaceAuthenticator(steam);
      } catch (err) {
        try { steam.logOff(); } catch (_) {}
        return { ok: false, reason: "replace_start_failed", status: 29, message: String(err && err.message || err) };
      }

      enrollingSessions.set(username, {
        mode: "replace_existing",
        steam,
        refreshToken,
        steamId64: resolveSteamId64(steam),
        accountName: username,
        deviceId: resolveDeviceId(steam),
        timestamp: Date.now()
      });

      return {
        ok: true,
        mode: "replace_existing",
        status: 29,
        requires_sms: true
      };
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
      mode: "new_enroll",
      steam,
      sharedSecret: response.shared_secret,
      response: normalizeTokenPayload(response),
      refreshToken,
      steamId64: resolveSteamId64(steam),
      accountName: username,
      deviceId: resolveDeviceId(steam),
      timestamp: Date.now(),
    });

    return {
      ok: true,
      mode: "new_enroll",
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

  const {
    mode,
    steam,
    sharedSecret,
    response: enrollResponse,
    refreshToken,
    steamId64,
    accountName,
    deviceId
  } = session;

  try {
    let tokenPayload = null;
    if (mode === "new_enroll") {
      // compute current TOTP to prove we hold the secret
      SteamTotp.generateAuthCode(sharedSecret);

      const sharedSecretBuffer = secretToBuffer(sharedSecret);
      await new Promise((resolve, reject) => {
        steam.finalizeTwoFactor(sharedSecretBuffer, activationCode, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
      log(logger, "finalizeTwoFactor succeeded", { username, mode });
      tokenPayload = enrollResponse;
    } else if (mode === "replace_existing") {
      const replaceBody = await continueReplaceAuthenticator(steam, activationCode);
      tokenPayload = normalizeTokenPayload(replaceBody.replacement_token);
      log(logger, "replace authenticator succeeded", { username, mode });
    } else {
      throw new Error("unknown_enroll_mode");
    }

    const maFileJson = await buildProjectCompatibleMaFile({
      tokenPayload,
      accountName: accountName || username,
      steamId64,
      refreshToken,
      deviceId,
      refreshAccessTokenFn: refreshAccessToken
    });

    // cleanup
    enrollingSessions.delete(username);
    try { steam.logOff(); } catch (_) {}

    return {
      ok: true,
      maFileContent: JSON.stringify(maFileJson),
      revocation_code: maFileJson.revocation_code,
    };
  } catch (err) {
    log(logger, "finalizeTwoFactor failed", { username, error: String(err && err.message || err) });
    return { ok: false, reason: "finalize_failed", message: String(err && err.message || err) };
  }
}

module.exports = { enrollSteamGuard, finalizeSteamGuard };
