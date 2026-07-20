const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const {createServer} = require("../src/uiServer");
const {resolveDeviceId} = require("../src/deviceIdentity");

function createRuntime({authenticated = true} = {}) {
  let bundle = {
    snapshot: authenticated ? {sub: "user_1", username: "alice", membership_plan: "inactive"} : null,
    signature: authenticated ? "signed_inactive" : "",
    refresh_credential: authenticated ? "refresh_private_1" : ""
  };
  let state = authenticated ? {
    ok: true,
    code: "ready",
    user: {id: "user_1", username: "alice", membership_plan: "inactive"},
    permissions: ["accounts.read", "accounts.write", "inventory.read", "inventory.refresh", "simulation.use"],
    featureFlags: {craft_enabled: false, membership_expires_at: ""},
    expiresAt: "2099-01-01T00:15:00.000Z",
    expiresInMs: 60_000
  } : {
    ok: false,
    code: "license_missing",
    user: null,
    permissions: [],
    featureFlags: {},
    expiresAt: "",
    expiresInMs: 0
  };
  return {
    getState() {
      return state;
    },
    readBundle() {
      return {...bundle};
    },
    importBundle(nextBundle) {
      bundle = {...nextBundle};
      state = {
        ...state,
        ok: true,
        code: "ready",
        user: {
          id: nextBundle.snapshot.sub,
          username: nextBundle.snapshot.username,
          membership_plan: nextBundle.snapshot.membership_plan
        },
        permissions: [...nextBundle.snapshot.permissions],
        featureFlags: {...nextBundle.snapshot.feature_flags},
        expiresAt: nextBundle.snapshot.exp,
        expiresInMs: 60_000
      };
      return state;
    },
    stop() {},
    clear() {
      return state;
    }
  };
}

async function startServer({authenticated = true, authClient} = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs2-membership-routes-"));
  const machineIdFile = path.join(tempDir, "machine-id.bin");
  fs.writeFileSync(machineIdFile, "membership-device", "utf8");
  const runtime = createRuntime({authenticated});
  const server = createServer({
    licenseRuntimeFactory: () => runtime,
    licenseConfigFactory: () => ({
      authMode: "prod_login",
      controlPlaneBaseUrl: "http://127.0.0.1:8787",
      machineIdFile
    }),
    controlPlaneAuthClientFactory: () => authClient
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    authClient,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    deviceId: resolveDeviceId(machineIdFile),
    runtime,
    server,
    tempDir
  };
}

async function stopServer(ctx) {
  await new Promise((resolve) => ctx.server.close(resolve));
  fs.rmSync(ctx.tempDir, {recursive: true, force: true});
}

async function requestJson(ctx, method, route, body = null) {
  const payload = body === null ? "" : JSON.stringify(body);
  const url = new URL(route, ctx.baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method,
      headers: payload ? {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      } : {}
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({status: res.statusCode || 0, body: raw ? JSON.parse(raw) : {}});
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function test_products_are_available_without_a_local_license() {
  const ctx = await startServer({
    authenticated: false,
    authClient: {
      async getMembershipProducts() {
        return {ok: true, products: [{id: "p30", name: "30 天会员", days: 30, price_cents: 1990}]};
      }
    }
  });
  try {
    const response = await requestJson(ctx, "GET", "/api/membership/products");
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.products, [{id: "p30", name: "30 天会员", days: 30, price_cents: 1990}]);
  } finally {
    await stopServer(ctx);
  }
}

async function test_redeem_uses_private_local_credentials_and_imports_rotated_bundle() {
  const calls = [];
  const ctx = await startServer({
    authClient: {
      async redeemActivationCode(args) {
        calls.push({...args});
        return {
          user: {id: "user_1", username: "alice", membership_plan: "member"},
          bundle: {
            snapshot: {
              sub: "user_1",
              username: "alice",
              membership_plan: "member",
              permissions: ["accounts.read", "accounts.write", "craft.use", "inventory.read", "inventory.refresh", "simulation.use"],
              feature_flags: {craft_enabled: true, membership_expires_at: "2026-09-01T00:00:00.000Z"},
              exp: "2099-01-01T00:15:00.000Z"
            },
            signature: "signed_member"
          },
          refreshCredential: "refresh_private_2"
        };
      }
    }
  });
  try {
    const response = await requestJson(ctx, "POST", "/api/membership/redeem", {
      code: "CS2-AAAA-BBBB-CCCC-DDDD",
      refresh_credential: "browser_must_not_control_this",
      device_id: "browser_must_not_control_this"
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.authenticated, true);
    assert.equal(response.body.user.membership_plan, "member");
    assert.equal(JSON.stringify(response.body).includes("refresh_private"), false);
    assert.deepEqual(calls, [{
      refreshCredential: "refresh_private_1",
      deviceId: ctx.deviceId,
      code: "CS2-AAAA-BBBB-CCCC-DDDD"
    }]);
    assert.equal(ctx.runtime.readBundle().refresh_credential, "refresh_private_2");
  } finally {
    await stopServer(ctx);
  }
}

async function test_checkout_placeholder_does_not_change_the_local_bundle() {
  const calls = [];
  const error = new Error("支付方式暂未开放");
  error.code = "payment_not_configured";
  error.status = 503;
  const ctx = await startServer({
    authClient: {
      async checkoutMembership(args) {
        calls.push({...args});
        throw error;
      }
    }
  });
  try {
    const before = ctx.runtime.readBundle();
    const response = await requestJson(ctx, "POST", "/api/membership/checkout", {product_id: "p30"});
    assert.equal(response.status, 503);
    assert.equal(response.body.reason, "payment_not_configured");
    assert.deepEqual(ctx.runtime.readBundle(), before);
    assert.deepEqual(calls, [{
      refreshCredential: "refresh_private_1",
      deviceId: ctx.deviceId,
      productId: "p30"
    }]);
  } finally {
    await stopServer(ctx);
  }
}

async function main() {
  await test_products_are_available_without_a_local_license();
  await test_redeem_uses_private_local_credentials_and_imports_rotated_bundle();
  await test_checkout_placeholder_does_not_change_the_local_bundle();
  console.log("membership-routes tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
