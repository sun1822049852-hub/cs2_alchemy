const assert = require("node:assert/strict");

const {createControlPlaneAuthClient} = require("../src/controlPlaneAuthClient");

async function test_login_fails_when_service_is_not_configured() {
  const client = createControlPlaneAuthClient({baseUrl: ""});
  await assert.rejects(
    () => client.login({username: "alice", password: "secret", deviceId: "device_1"}),
    (err) => err && err.code === "auth_service_not_configured"
  );
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

async function main() {
  await test_login_fails_when_service_is_not_configured();
  await test_login_normalizes_remote_auth_payload();
  await test_refresh_normalizes_rotated_refresh_token();
  console.log("control-plane-auth-client tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
