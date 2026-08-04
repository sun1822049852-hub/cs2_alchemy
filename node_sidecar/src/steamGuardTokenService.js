const {parseMaFile, generateTotp, getServerTime} = require("./maFileParser");
const {asString} = require("./utils");

const LOGIN_TOKEN_FIELDS = new Set([
  "access_token",
  "refresh_token",
  "accessToken",
  "refreshToken",
  "oauth_token",
  "steamLoginSecure",
  "SteamLoginSecure",
  "WebCookie",
  "web_cookie",
  "cookies"
]);

function parseRawMaFile(content) {
  if (typeof content === "string") {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("maFile 内容无效");
    }
    return parsed;
  }
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    throw new Error("maFile 内容为空");
  }
  return content;
}

function readSessionObject(raw) {
  return raw && raw.Session && typeof raw.Session === "object" && !Array.isArray(raw.Session)
    ? raw.Session
    : null;
}

function normalizeMaFileForExport(content) {
  const raw = parseRawMaFile(content);
  const normalized = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "Session" || LOGIN_TOKEN_FIELDS.has(key)) continue;
    normalized[key] = value;
  }
  const parsed = parseMaFile(normalized);
  normalized.account_name = asString(normalized.account_name || parsed.accountName).trim();
  normalized.device_id = asString(normalized.device_id || parsed.deviceId).trim();
  normalized.shared_secret = parsed.sharedSecret;
  normalized.identity_secret = parsed.identitySecret;
  normalized.revocation_code = parsed.revocationCode;
  normalized.steamid = asString(normalized.steamid || parsed.steamId64).trim();
  normalized.Session = null;
  return normalized;
}

function getSteamGuardCapabilities(content) {
  try {
    const raw = parseRawMaFile(content);
    const parsed = parseMaFile(raw);
    const isFull = !!parsed.identitySecret;
    const type = isFull ? "full" : "login_only";
    return {
      type,
      login_code: !!parsed.sharedSecret,
      confirmation: isFull,
      recovery_code: isFull && !!parsed.revocationCode,
      web_session: isFull && !!(parsed.refreshToken || parsed.accessToken)
    };
  } catch (_) {
    return {
      type: "none",
      login_code: false,
      confirmation: false,
      recovery_code: false,
      web_session: false
    };
  }
}

function invalidImportMaFileError() {
  const err = new Error("令牌文件格式错误");
  err.code = "invalid_mafile_format";
  return err;
}

function normalizeSteamGuardImportMaFile(content) {
  try {
    const raw = parseRawMaFile(content);
    const accountName = asString(raw.account_name).trim();
    const sharedSecret = asString(raw.shared_secret).trim();
    if (!accountName || !sharedSecret) {
      throw invalidImportMaFileError();
    }
    const capabilities = getSteamGuardCapabilities(raw);
    if (!capabilities.login_code) {
      throw invalidImportMaFileError();
    }
    const normalized = {};
    if (capabilities.type === "full") {
      Object.assign(normalized, raw);
    } else {
      const steamId64 = asString(raw.steamid || raw.steam_id64).trim();
      if (steamId64) normalized.steamid = steamId64;
      const session = readSessionObject(raw);
      if (session && Object.hasOwn(session, "SteamID")) {
        normalized.Session = {SteamID: session.SteamID};
      }
    }
    normalized.account_name = accountName;
    normalized.shared_secret = sharedSecret;
    const capabilityFlags = {
      login_code: capabilities.login_code,
      confirmation: capabilities.confirmation,
      recovery_code: capabilities.recovery_code,
      web_session: capabilities.web_session
    };
    return {
      accountName,
      steamGuardType: capabilities.type,
      capabilities: capabilityFlags,
      maFileContent: JSON.stringify(normalized)
    };
  } catch (err) {
    if (err && err.code === "invalid_mafile_format") {
      throw err;
    }
    throw invalidImportMaFileError();
  }
}

function readSteamGuardSummary(content, {nowSeconds} = {}) {
  const parsed = parseMaFile(content);
  const now = Number.isFinite(Number(nowSeconds)) ? Math.floor(Number(nowSeconds)) : getServerTime();
  const elapsed = ((now % 30) + 30) % 30;
  return {
    accountName: parsed.accountName,
    steamId64: parsed.steamId64 || asString(parsed.raw && parsed.raw.steamid).trim(),
    deviceId: parsed.deviceId,
    revocationCode: parsed.revocationCode,
    currentTotp: generateTotp(parsed.sharedSecret),
    period: 30,
    remainingSeconds: 30 - elapsed
  };
}

function hasCompleteSteamGuard(content) {
  try {
    const parsed = parseMaFile(content);
    return !!(
      parsed.sharedSecret
      && parsed.identitySecret
      && parsed.deviceId
      && parsed.revocationCode
    );
  } catch (_) {
    return false;
  }
}

module.exports = {
  getSteamGuardCapabilities,
  hasCompleteSteamGuard,
  normalizeSteamGuardImportMaFile,
  normalizeMaFileForExport,
  readSteamGuardSummary
};
