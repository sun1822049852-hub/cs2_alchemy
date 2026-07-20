const assert = require("node:assert/strict");

const {createControlPlaneAuthClient} = require("../src/controlPlaneAuthClient");

async function test_login_fails_when_service_is_not_configured() {
  const client = createControlPlaneAuthClient({baseUrl: ""});
  await assert.rejects(
    () => client.login({username: "alice", password: "secret", deviceId: "device_1"}),
    (err) => err && err.code === "auth_service_not_configured"
  );
}

function test_capabilities_reject_non_local_auth_service() {
  const client = createControlPlaneAuthClient({baseUrl: "https://auth.example.com"});
  assert.deepEqual(client.getCapabilities(), {
    configured: false,
    baseUrl: ""
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
    baseUrl: "http://203.0.113.10",
    fetchFn: async () => {
      called = true;
      throw new Error("fetch should not be called for insecure public http");
    }
  });
  await assert.rejects(
    () => client.login({username: "alice", password: "secret", deviceId: "device_1"}),
    (err) => err && err.code === "non_local_control_plane_base_url"
  );
  assert.equal(called, false);
}

async function test_control_plane_request_times_out() {
  const client = createControlPlaneAuthClient({
    baseUrl: "http://127.0.0.1:8787",
    requestTimeoutMs: 20,
    fetchFn: async () => new Promise(() => {})
  });
  const result = await Promise.race([
    client.login({username: "alice", password: "Password1234", deviceId: "device_1"})
      .then(() => ({code: "unexpected_success"}), (err) => err),
    new Promise((resolve) => setTimeout(() => resolve({code: "test_watchdog"}), 100))
  ]);
  assert.equal(result && result.code, "auth_request_timeout");
  assert.equal(result && result.status, 504);
}

async function test_control_plane_response_body_times_out() {
  const client = createControlPlaneAuthClient({
    baseUrl: "http://127.0.0.1:8787",
    requestTimeoutMs: 20,
    fetchFn: async () => ({
      ok: true,
      status: 200,
      json: async () => new Promise(() => {})
    })
  });
  const result = await Promise.race([
    client.login({username: "alice", password: "Password1234", deviceId: "device_1"})
      .then(() => ({code: "unexpected_success"}), (err) => err),
    new Promise((resolve) => setTimeout(() => resolve({code: "test_watchdog"}), 100))
  ]);
  assert.equal(result && result.code, "auth_request_timeout");
  assert.equal(result && result.status, 504);
}

async function test_registration_readiness_times_out() {
  const client = createControlPlaneAuthClient({
    baseUrl: "http://127.0.0.1:8787",
    requestTimeoutMs: 20,
    fetchFn: async () => new Promise(() => {})
  });
  const result = await Promise.race([
    client.getRegistrationReadiness()
      .then(() => ({code: "unexpected_success"}), (err) => err),
    new Promise((resolve) => setTimeout(() => resolve({code: "test_watchdog"}), 100))
  ]);
  assert.equal(result && result.code, "auth_request_timeout");
  assert.equal(result && result.status, 504);
}

async function test_login_normalizes_remote_auth_payload() {
  const calls = [];
  const client = createControlPlaneAuthClient({
    baseUrl: "http://127.0.0.1:8787",
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
  assert.equal(calls[0].url, "http://127.0.0.1:8787/api/auth/login");
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
    baseUrl: "http://127.0.0.1:8787",
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
  assert.equal(calls[0].url, "http://127.0.0.1:8787/api/auth/refresh");
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

async function test_membership_products_use_get_without_exposing_credentials() {
  const calls = [];
  const client = createControlPlaneAuthClient({
    baseUrl: "http://127.0.0.1:8787",
    fetchFn: async (url, options = {}) => {
      calls.push({
        url,
        method: options.method,
        headers: {...(options.headers || {})},
        body: options.body
      });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            items: [{id: "product_30d", name: "30 天会员", membership_days: 30, price_cents: 1990}]
          };
        }
      };
    }
  });

  const result = await client.getMembershipProducts();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:8787/api/auth/membership/products");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].body, undefined);
  assert.equal(JSON.stringify(calls[0]).includes("refresh_token_1"), false);
  assert.deepEqual(result.products, [{id: "product_30d", name: "30 天会员", membership_days: 30, price_cents: 1990}]);
}

async function test_redeem_activation_code_normalizes_rotated_bundle() {
  const calls = [];
  const client = createControlPlaneAuthClient({
    baseUrl: "http://127.0.0.1:8787",
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
            user: {id: "user_1", username: "alice", membership_plan: "member"},
            access_bundle: {snapshot: {sub: "user_1", membership_plan: "member"}, signature: "signed_member"},
            refresh_token: "refresh_token_2"
          };
        }
      };
    }
  });

  const result = await client.redeemActivationCode({
    refreshCredential: "refresh_token_1",
    deviceId: "device_1",
    code: "CS2-AAAA-BBBB-CCCC-DDDD"
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:8787/api/auth/membership/redeem");
  assert.deepEqual(calls[0].body, {
    refresh_token: "refresh_token_1",
    device_id: "device_1",
    code: "CS2-AAAA-BBBB-CCCC-DDDD"
  });
  assert.deepEqual(result, {
    user: {id: "user_1", username: "alice", membership_plan: "member"},
    bundle: {snapshot: {sub: "user_1", membership_plan: "member"}, signature: "signed_member"},
    refreshCredential: "refresh_token_2"
  });
}

async function test_checkout_forwards_private_credential_and_placeholder_error() {
  const calls = [];
  const client = createControlPlaneAuthClient({
    baseUrl: "http://127.0.0.1:8787",
    fetchFn: async (url, options = {}) => {
      calls.push({url, method: options.method, body: JSON.parse(String(options.body || "{}"))});
      return {
        ok: false,
        status: 503,
        async json() {
          return {ok: false, reason: "payment_not_configured", message: "支付方式暂未开放"};
        }
      };
    }
  });

  await assert.rejects(
    () => client.checkoutMembership({
      refreshCredential: "refresh_token_1",
      deviceId: "device_1",
      productId: "product_30d"
    }),
    (err) => err && err.code === "payment_not_configured" && err.status === 503
  );
  assert.deepEqual(calls, [{
    url: "http://127.0.0.1:8787/api/auth/payment/checkout",
    method: "POST",
    body: {refresh_token: "refresh_token_1", device_id: "device_1", product_id: "product_30d"}
  }]);
}

function test_removed_remote_permit_and_steam_binding_methods_are_absent() {
  const client = createControlPlaneAuthClient({baseUrl: "http://127.0.0.1:8787"});
  assert.equal(client.issueCraftPermit, undefined);
  assert.equal(client.checkOrBindSteamAccount, undefined);
}

async function main() {
  await test_login_fails_when_service_is_not_configured();
  test_capabilities_reject_non_local_auth_service();
  test_capabilities_allow_loopback_http_auth_service();
  await test_login_rejects_public_http_auth_service_before_fetch();
  await test_control_plane_request_times_out();
  await test_control_plane_response_body_times_out();
  await test_registration_readiness_times_out();
  await test_login_normalizes_remote_auth_payload();
  await test_refresh_normalizes_rotated_refresh_token();
  await test_membership_products_use_get_without_exposing_credentials();
  await test_redeem_activation_code_normalizes_rotated_bundle();
  await test_checkout_forwards_private_credential_and_placeholder_error();
  test_removed_remote_permit_and_steam_binding_methods_are_absent();
  console.log("control-plane-auth-client tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
