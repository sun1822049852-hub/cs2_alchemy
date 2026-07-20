const {ensureAuthApiReachable} = require("./networkPrecheck");
const {steamPost: defaultSteamPost} = require("./steamHttpClient");
const {asString} = require("./utils");

const ADD_AUTHENTICATOR_URL = "https://api.steampowered.com/ITwoFactorService/AddAuthenticator/v1/";
const QUERY_TIME_URL = "https://api.steampowered.com/ITwoFactorService/QueryTime/v1/";

function toBase64(value) {
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  return asString(value).trim();
}

function normalizeResponse(response) {
  const envelope = response && typeof response === "object" ? response : {};
  const body = envelope.response && typeof envelope.response === "object"
    ? envelope.response
    : envelope;
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
  ensureReachable = ensureAuthApiReachable,
  steamPost = defaultSteamPost,
  now = Date.now,
  timeoutMs = 30000
} = {}) {
  const timeout = Math.max(1000, Number(timeoutMs) || 30000);

  async function addAuthenticator({accessToken, steamId64, deviceId} = {}) {
    const temporaryAccessToken = asString(accessToken).trim();
    const expectedSteamId64 = asString(steamId64).trim();
    const deviceIdentifier = asString(deviceId).trim();
    if (!temporaryAccessToken) throw new Error("temporary access token is required");
    if (!expectedSteamId64) throw new Error("steamId64 is required");
    if (!/^android:[0-9a-f-]{36}$/i.test(deviceIdentifier)) throw new Error("deviceId is invalid");

    await ensureReachable({force: true, timeoutMs: Math.min(timeout, 5000)});

    const url = new URL(ADD_AUTHENTICATOR_URL);
    url.searchParams.set("access_token", temporaryAccessToken);
    const result = await steamPost({
      url: url.toString(),
      body: {
        steamid: expectedSteamId64,
        authenticator_time: String(Math.floor(Date.now() / 1000)),
        authenticator_type: "1",
        device_identifier: deviceIdentifier,
        sms_phone_id: "1"
      },
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      maxRetries: 0,
      timeoutMs: timeout
    });

    const statusCode = Number(result && result.statusCode) || 0;
    if (statusCode !== 200) {
      const error = new Error(`Steam Guard AddAuthenticator HTTP ${statusCode || "request_failed"}`);
      error.code = "steam_guard_add_http_error";
      error.statusCode = statusCode;
      throw error;
    }
    if (!result.json || typeof result.json !== "object") {
      const error = new Error("Steam Guard AddAuthenticator returned invalid JSON");
      error.code = "steam_guard_add_invalid_response";
      throw error;
    }
    return normalizeResponse(result.json);
  }

  async function queryTimeOffset() {
    await ensureReachable({force: true, timeoutMs: Math.min(timeout, 5000)});
    const result = await steamPost({
      url: QUERY_TIME_URL,
      body: null,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      maxRetries: 0,
      timeoutMs: timeout
    });
    const statusCode = Number(result && result.statusCode) || 0;
    if (statusCode !== 200) {
      const error = new Error(`Steam Guard QueryTime HTTP ${statusCode || "request_failed"}`);
      error.code = "steam_guard_time_http_error";
      error.statusCode = statusCode;
      throw error;
    }
    const response = result && result.json && result.json.response;
    const serverTime = Number(response && response.server_time);
    if (!Number.isFinite(serverTime) || serverTime <= 0) {
      const error = new Error("Steam Guard QueryTime returned invalid JSON");
      error.code = "steam_guard_time_invalid_response";
      throw error;
    }
    return serverTime - Math.floor(Number(now()) / 1000);
  }

  return {addAuthenticator, queryTimeOffset};
}

module.exports = {
  createSteamGuardSteamAdapter
};
