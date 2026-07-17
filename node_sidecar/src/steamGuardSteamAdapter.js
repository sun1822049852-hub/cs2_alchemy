const SteamUser = require("steam-user");
const {ensureAuthApiReachable} = require("./networkPrecheck");
const {asString, withTimeout} = require("./utils");

function toBase64(value) {
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  return asString(value).trim();
}

function normalizeResponse(response) {
  const body = response && typeof response === "object" ? response : {};
  return {
    ...body,
    shared_secret: toBase64(body.shared_secret),
    identity_secret: toBase64(body.identity_secret),
    secret_1: toBase64(body.secret_1),
    serial_number: asString(body.serial_number).trim(),
    revocation_code: asString(body.revocation_code).trim(),
    account_name: asString(body.account_name).trim(),
    uri: asString(body.uri).trim(),
    token_gid: asString(body.token_gid).trim(),
    server_time: asString(body.server_time).trim(),
    status: Number(body.status) || 0
  };
}

function createSteamGuardSteamAdapter({
  SteamUserClass = SteamUser,
  ensureReachable = ensureAuthApiReachable,
  timeoutMs = 30000
} = {}) {
  const timeout = Math.max(1000, Number(timeoutMs) || 30000);

  async function addAuthenticator({refreshToken, accessToken, steamId64, deviceId} = {}) {
    const temporaryRefreshToken = asString(refreshToken).trim();
    const temporaryAccessToken = asString(accessToken).trim();
    const expectedSteamId64 = asString(steamId64).trim();
    const deviceIdentifier = asString(deviceId).trim();
    if (!temporaryRefreshToken) throw new Error("temporary refresh token is required");
    if (!temporaryAccessToken) throw new Error("temporary access token is required");
    if (!expectedSteamId64) throw new Error("steamId64 is required");
    if (!/^android:[0-9a-f-]{36}$/i.test(deviceIdentifier)) throw new Error("deviceId is invalid");

    await ensureReachable({force: true, timeoutMs: Math.min(timeout, 5000)});
    const steam = new SteamUserClass({autoRelogin: false, renewRefreshTokens: false});
    try {
      await withTimeout(new Promise((resolve, reject) => {
        const cleanup = () => {
          if (typeof steam.removeListener === "function") {
            steam.removeListener("loggedOn", onLoggedOn);
            steam.removeListener("error", onError);
          }
        };
        const onLoggedOn = () => { cleanup(); resolve(); };
        const onError = (err) => { cleanup(); reject(err); };
        steam.once("loggedOn", onLoggedOn);
        steam.once("error", onError);
        steam.logOn({refreshToken: temporaryRefreshToken});
      }), timeout, "Steam Guard temporary logon timed out");

      const actualSteamId64 = steam.steamID && typeof steam.steamID.getSteamID64 === "function"
        ? asString(steam.steamID.getSteamID64()).trim()
        : asString(steam.steamID).trim();
      if (actualSteamId64 && actualSteamId64 !== expectedSteamId64) {
        throw new Error("Steam account mismatch");
      }

      const response = await withTimeout(new Promise((resolve, reject) => {
        try {
          steam._sendUnified("TwoFactor.AddAuthenticator#1", {
            steamid: expectedSteamId64,
            authenticator_time: Math.floor(Date.now() / 1000),
            authenticator_type: 1,
            device_identifier: deviceIdentifier,
            sms_phone_id: "1",
            version: 1
          }, (body) => resolve(body || {}));
        } catch (err) {
          reject(err);
        }
      }), timeout, "AddAuthenticator timed out");
      return normalizeResponse(response);
    } finally {
      try { steam.logOff(); } catch (_) {}
    }
  }

  return {addAuthenticator};
}

module.exports = {
  createSteamGuardSteamAdapter
};
