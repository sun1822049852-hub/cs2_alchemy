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
  hasCompleteSteamGuard,
  normalizeMaFileForExport,
  readSteamGuardSummary
};
