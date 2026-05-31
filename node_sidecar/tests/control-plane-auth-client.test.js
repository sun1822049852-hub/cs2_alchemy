const assert = require("node:assert/strict");

const {createControlPlaneAuthClient} = require("../src/controlPlaneAuthClient");

async function test_login_fails_when_service_is_not_configured() {
  const client = createControlPlaneAuthClient({baseUrl: ""});
  await assert.rejects(
    () => client.login({username: "alice", password: "secret", deviceId: "device_1"}),
    (err) => err && err.code === "auth_service_not_configured"
  );
}

function test_capabilities_allow_https_auth_service() {
  const client = createControlPlaneAuthClient({baseUrl: "https://auth.example.com"});
  assert.deepEqual(client.getCapabilities(), {
    configured: true,
    baseUrl: "https://auth.example.com"
  });
}

function test_capabilities_allow_loopback_http_auth_service() {
  const client = createControlPlaneAuthClient({baseUrl: "http://localhost:8787"});
  assert.deepEqual(client.getCapabilities(), {
    configured: true,
    baseUrl: "http://localhost:8787"
  });
}

async function test_login_rejects_public_http_auth_service_before_fetch() {
  let called = false;
  const client = createControlPlaneAuthClient({
    baseUrl: "http://8.138.39.139",
    fetchFn: async () => {
      called = true;
      throw new Error("fetch should not be called for insecure public http");
    }
  });
  await assert.rejects(
    () => client.login({username: "alice", password: "secret", deviceId: "device_1"}),
    (err) => err && err.code === "insecure_control_plane_base_url"
  );
  assert.equal(called, false);
}

async function test_login_normalizes_remote_auth_payload() {
  const calls = [];
  const client = createControlPlaneAuthClient({
    baseUrl: "https://auth.example.com",
    fetchFn: async (url, options = {}) => {
      calls.push({
        url,
        method: options.method,
        body: JSON.parse(String(options.body || "{}"))
      });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            user: {
              id: "user_1",
              username: "alice"
            },
            access_bundle: {
              snapshot: {
                sub: "user_1"
              },
              signature: "signed"
            },
            refresh_token: "refresh_token_1"
          };
        }
      };
    }
  });

  const result = await client.login({
    username: "alice",
    password: "secret",
    deviceId: "device_1",
    clientVersion: "1.0.0"
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://auth.example.com/api/auth/login");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, {
    username: "alice",
    password: "secret",
    device_id: "device_1",
    client_version: "1.0.0"
  });
  assert.deepEqual(result, {
    user: {
      id: "user_1",
      username: "alice"
    },
    bundle: {
      snapshot: {
        sub: "user_1"
      },
      signature: "signed"
    },
    refreshCredential: "refresh_token_1"
  });
}

async function test_refresh_normalizes_rotated_refresh_token() {
  const calls = [];
  const client = createControlPlaneAuthClient({
    baseUrl: "https://auth.example.com",
    fetchFn: async (url, options = {}) => {
      calls.push({
        url,
        method: options.method,
        body: JSON.parse(String(options.body || "{}"))
      });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            access_bundle: {
              snapshot: {
                sub: "user_1"
              },
              signature: "rotated_signed"
            },
            refresh_token: "refresh_token_2"
          };
        }
      };
    }
  });

  const result = await client.refresh({
    refreshCredential: "refresh_token_1",
    deviceId: "device_1"
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://auth.example.com/api/auth/refresh");
  assert.deepEqual(calls[0].body, {
    refresh_token: "refresh_token_1",
    device_id: "device_1"
  });
  assert.deepEqual(result, {
    bundle: {
      snapshot: {
        sub: "user_1"
      },
      signature: "rotated_signed"
    },
    refreshCredential: "refresh_token_2"
  });
}

async function test_issue_craft_permit_normalizes_request_and_response() {
  const calls = [];
  const client = createControlPlaneAuthClient({
    baseUrl: "https://auth.example.com",
    fetchFn: async (url, options = {}) => {
      calls.push({
        url,
        method: options.method,
        body: JSON.parse(String(options.body || "{}"))
      });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            permit: {
              snapshot: {
                sub: "user_1",
                action: "craft.tradeup.execute"
              },
              signature: "permit_signed"
            }
          };
        }
      };
    }
  });

  const result = await client.issueCraftPermit({
    refreshCredential: "refresh_token_1",
    deviceId: "device_1",
    action: "craft.tradeup.execute",
    accountUsername: "steam_account_a",
    payloadHash: "sha256:abc123"
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://auth.example.com/api/auth/craft-permit");
  assert.deepEqual(calls[0].body, {
    refresh_token: "refresh_token_1",
    device_id: "device_1",
    action: "craft.tradeup.execute",
    account_username: "steam_account_a",
    payload_hash: "sha256:abc123"
  });
  assert.deepEqual(result, {
    permit: {
      snapshot: {
        sub: "user_1",
        action: "craft.tradeup.execute"
      },
      signature: "permit_signed"
    }
  });
}

async function test_check_or_bind_steam_account_normalizes_request_and_response() {
  const calls = [];
  const client = createControlPlaneAuthClient({
    baseUrl: "https://auth.example.com",
    fetchFn: async (url, options = {}) => {
      calls.push({
        url,
        method: options.method,
        body: JSON.parse(String(options.body || "{}"))
      });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            binding_mode: "single_locked",
            binding_limit: 1,
            bound_count: 1,
            matched_existing: false,
            message: "Steam 绑定资格已确认"
          };
        }
      };
    }
  });

  const result = await client.checkOrBindSteamAccount({
    refreshCredential: "refresh_token_1",
    deviceId: "device_1",
    steamId: "76561198000000001",
    steamAccountName: "steam_account_a"
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://auth.example.com/api/auth/steam-binding/check-or-bind");
  assert.deepEqual(calls[0].body, {
    refresh_token: "refresh_token_1",
    device_id: "device_1",
    steam_id: "76561198000000001",
    steam_account_name: "steam_account_a"
  });
  assert.deepEqual(result, {
    ok: true,
    bindingMode: "single_locked",
    bindingLimit: 1,
    boundCount: 1,
    matchedExisting: false,
    message: "Steam 绑定资格已确认"
  });
}

async function main() {
  await test_login_fails_when_service_is_not_configured();
  test_capabilities_allow_https_auth_service();
  test_capabilities_allow_loopback_http_auth_service();
  await test_login_rejects_public_http_auth_service_before_fetch();
  await test_login_normalizes_remote_auth_payload();
  await test_refresh_normalizes_rotated_refresh_token();
  await test_issue_craft_permit_normalizes_request_and_response();
  await test_check_or_bind_steam_account_normalizes_request_and_response();
  console.log("control-plane-auth-client tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
