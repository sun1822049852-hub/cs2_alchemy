const assert = require("node:assert/strict");

const {createSteamGuardSteamAdapter} = require("../src/steamGuardSteamAdapter");

async function test_add_authenticator_uses_access_token_web_api() {
  const calls = [];

  const adapter = createSteamGuardSteamAdapter({
    ensureReachable: async () => ({ok: true}),
    steamPost: async (request) => {
      calls.push(request);
      return {
        statusCode: 200,
        json: {
          response: {
            status: 1,
            shared_secret: Buffer.from("shared"),
            identity_secret: Buffer.from("identity"),
            secret_1: Buffer.from("secret-1"),
            serial_number: "123456",
            revocation_code: "R12345",
            account_name: "demo"
          }
        }
      };
    },
    timeoutMs: 1000
  });
  const result = await adapter.addAuthenticator({
    refreshToken: "temporary-refresh",
    accessToken: "temporary-access",
    steamId64: "76561198000000001",
    deviceId: "android:12345678-1234-4123-8123-123456789abc"
  });

  assert.equal(result.status, 1);
  assert.equal(result.shared_secret, Buffer.from("shared").toString("base64"));
  assert.equal(result.identity_secret, Buffer.from("identity").toString("base64"));
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin, "https://api.steampowered.com");
  assert.equal(url.pathname, "/ITwoFactorService/AddAuthenticator/v1/");
  assert.equal(url.searchParams.get("access_token"), "temporary-access");
  assert.deepEqual(calls[0].body, {
    steamid: "76561198000000001",
    authenticator_time: calls[0].body.authenticator_time,
    authenticator_type: "1",
    device_identifier: "android:12345678-1234-4123-8123-123456789abc",
    sms_phone_id: "1"
  });
  assert.match(calls[0].body.authenticator_time, /^\d{10}$/);
  assert.equal(calls[0].maxRetries, 0);
  assert.equal(calls[0].timeoutMs, 1000);
  assert.equal(JSON.stringify(calls).includes("temporary-refresh"), false);
}

async function test_add_authenticator_http_error_is_sanitized() {
  const adapter = createSteamGuardSteamAdapter({
    ensureReachable: async () => ({ok: true}),
    steamPost: async () => ({
      statusCode: 403,
      body: "upstream response contains sensitive diagnostics",
      json: null
    }),
    timeoutMs: 1000
  });

  await assert.rejects(
    adapter.addAuthenticator({
      refreshToken: "temporary-refresh",
      accessToken: "temporary-access",
      steamId64: "76561198000000001",
      deviceId: "android:12345678-1234-4123-8123-123456789abc"
    }),
    (err) => {
      assert.equal(err.statusCode, 403);
      assert.equal(err.code, "steam_guard_add_http_error");
      assert.equal(String(err.message).includes("temporary-access"), false);
      assert.equal(String(err.message).includes("sensitive diagnostics"), false);
      return true;
    }
  );
}

async function test_query_time_offset_uses_steam_server_time_without_credentials() {
  const calls = [];
  const adapter = createSteamGuardSteamAdapter({
    ensureReachable: async () => ({ok: true}),
    steamPost: async (request) => {
      calls.push(request);
      return {
        statusCode: 200,
        json: {response: {server_time: 1037}}
      };
    },
    now: () => 1_000_000,
    timeoutMs: 1000
  });

  assert.equal(await adapter.queryTimeOffset(), 37);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/ITwoFactorService/QueryTime/v1/");
  assert.equal(url.searchParams.has("access_token"), false);
  assert.equal(calls[0].body, null);
  assert.equal(calls[0].maxRetries, 0);
}

async function main() {
  await test_add_authenticator_uses_access_token_web_api();
  await test_add_authenticator_http_error_is_sanitized();
  await test_query_time_offset_uses_steam_server_time_without_credentials();
  console.log("steam-guard-steam-adapter tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
