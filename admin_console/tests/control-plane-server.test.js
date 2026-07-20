const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const {createServer} = require("../src/server");
const {ControlPlaneStore} = require("../src/controlPlaneStore");
const {createEntitlementSigner} = require("../src/entitlementSigner");
const {FEATURE_CODES} = require("../../shared/featureCodes");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-control-plane-server-"));
}

async function startServer() {
  const tempDir = makeTempDir();
  const store = new ControlPlaneStore({dbPath: path.join(tempDir, "control-plane-auth.db")});
  let currentNow = new Date("2026-04-05T00:00:00.000Z");
  const sentMessages = [];
  const server = createServer({
    storeFactory: () => store,
    codeGenerator: () => "123456",
    mailConfigFactory: () => ({
      configured: true,
      authCodeTtlMinutes: 5,
      authCodeCooldownSeconds: 60,
      refreshSessionDays: 30,
      adminSessionHours: 8,
      snapshotTtlMinutes: 15,
      privateKeyFile: path.join(__dirname, "..", "..", "tmp", "client_license_private.pem")
    }),
    now: () => new Date(currentNow),
    mailServiceFactory: () => ({
      async sendVerificationCode(payload) {
        sentMessages.push(payload);
        return {messageId: `message-${sentMessages.length}`};
      },
      async sendTestMail() {
        return {messageId: "test-message"};
      }
    })
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    tempDir,
    store,
    sentMessages,
    server,
    setNow(value) { currentNow = new Date(value); },
    baseUrl: `http://127.0.0.1:${server.address().port}`
  };
}

async function stopServer(ctx) {
  await new Promise((resolve) => ctx.server.close(resolve));
  fs.rmSync(ctx.tempDir, {recursive: true, force: true});
}

async function request(ctx, method, route, body = null, headers = {}) {
  const rawBody = typeof body === "string" ? body : (body === null ? "" : JSON.stringify(body));
  const url = new URL(route, ctx.baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(rawBody),
        ...headers
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let bodyValue = {};
        try { bodyValue = text ? JSON.parse(text) : {}; } catch (_) {}
        resolve({status: res.statusCode || 0, headers: res.headers, text, body: bodyValue});
      });
    });
    req.on("error", reject);
    if (rawBody) req.write(rawBody);
    req.end();
  });
}

function cookieFrom(response) {
  const values = response.headers["set-cookie"] || [];
  return String(values[0] || "").split(";")[0];
}

async function main() {
  const ctx = await startServer();
  try {
    const health = await request(ctx, "GET", "/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.headers["x-content-type-options"], "nosniff");
    assert.equal(health.headers["x-frame-options"], "DENY");
    assert.match(health.headers["content-security-policy"], /default-src 'self'/);

    const crossOriginBootstrap = await request(ctx, "POST", "/api/admin/bootstrap", {
      username: "attacker",
      password: "attacker pass"
    }, {Origin: "https://evil.example"});
    assert.equal(crossOriginBootstrap.status, 403);
    assert.equal(crossOriginBootstrap.body.reason, "cross_origin_request_denied");
    const reboundHost = `attacker.example:${ctx.server.address().port}`;
    const reboundBootstrap = await request(ctx, "POST", "/api/admin/bootstrap", {
      username: "attacker",
      password: "attacker pass"
    }, {Host: reboundHost, Origin: `http://${reboundHost}`});
    assert.equal(reboundBootstrap.status, 403);
    assert.equal(reboundBootstrap.body.reason, "local_host_required");
    const plainTextBootstrap = await request(ctx, "POST", "/api/admin/bootstrap", {
      username: "attacker",
      password: "attacker pass"
    }, {"Content-Type": "text/plain"});
    assert.equal(plainTextBootstrap.status, 415);

    assert.equal((await request(ctx, "POST", "/api/health", "{" )).status, 400);
    assert.equal((await request(ctx, "POST", "/api/health", JSON.stringify({data: "x".repeat(65536)}))).status, 413);
    assert.equal((await request(ctx, "POST", "/api/dev/mail/test", {to: "test@example.com"})).status, 401);

    const bootstrap = await request(ctx, "POST", "/api/admin/bootstrap", {
      username: "admin",
      password: "root password"
    });
    assert.equal(bootstrap.status, 200);

    const login = await request(ctx, "POST", "/api/admin/login", {
      username: "admin",
      password: "root password"
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.session_token, undefined);
    assert.equal(typeof login.body.csrf_token, "string");
    const cookie = cookieFrom(login);
    assert.match(cookie, /^admin_session=/);
    assert.match(String(login.headers["set-cookie"][0]), /HttpOnly/i);
    assert.match(String(login.headers["set-cookie"][0]), /SameSite=Strict/i);
    const readHeaders = {Cookie: cookie};
    const writeHeaders = {Cookie: cookie, "X-CSRF-Token": login.body.csrf_token};

    assert.equal((await request(ctx, "POST", "/api/dev/mail/test", {to: "test@example.com"}, readHeaders)).status, 403);
    assert.equal((await request(ctx, "POST", "/api/dev/mail/test", {to: "test@example.com"}, writeHeaders)).status, 200);

    assert.equal((await request(ctx, "GET", "/api/admin/plans", null, {Authorization: "Bearer ignored"})).status, 401);
    const plans = await request(ctx, "GET", "/api/admin/plans", null, readHeaders);
    assert.deepEqual(plans.body.items.map((item) => item.code), ["inactive", "member"]);

    const missingCsrf = await request(ctx, "POST", "/api/admin/users", {
      email: "alice@example.com", username: "alice", password: "client pass1"
    }, readHeaders);
    assert.equal(missingCsrf.status, 403);
    assert.equal(missingCsrf.body.reason, "csrf_invalid");

    const created = await request(ctx, "POST", "/api/admin/users", {
      email: "alice@example.com",
      username: "alice",
      password: "client pass1",
      membership_days: 0
    }, writeHeaders);
    assert.equal(created.status, 201);
    assert.equal(created.body.user.membership_plan, "inactive");

    const product = await request(ctx, "POST", "/api/admin/products", {
      name: "30 天会员", description: "本地商品", membership_days: 30,
      price_cents: 1990, is_enabled: true, sort_order: 10
    }, writeHeaders);
    assert.equal(product.status, 201);
    const publicProducts = await request(ctx, "GET", "/api/auth/membership/products");
    assert.equal(publicProducts.status, 200);
    assert.equal(publicProducts.body.items.length, 1);
    assert.equal(publicProducts.body.items[0].price_cents, 1990);

    const removableProduct = await request(ctx, "POST", "/api/admin/products", {
      name: "1 天测试商品", membership_days: 1, price_cents: 100, is_enabled: true
    }, writeHeaders);
    assert.equal(removableProduct.status, 201);
    assert.equal((await request(ctx, "DELETE", `/api/admin/products/${removableProduct.body.product.id}`, null, writeHeaders)).status, 200);

    const codes = await request(ctx, "POST", "/api/admin/activation-codes", {
      count: 1, days: 7, expires_at: "2026-12-31T00:00:00.000Z"
    }, writeHeaders);
    assert.equal(codes.status, 201);
    assert.equal(codes.body.codes.length, 1);
    const activationCode = codes.body.codes[0].code;

    const clientLogin = await request(ctx, "POST", "/api/auth/login", {
      username: "alice", password: "client pass1", device_id: "device-alpha"
    });
    assert.equal(clientLogin.status, 200);
    assert.equal(clientLogin.body.user.membership_plan, "inactive");
    assert.equal(clientLogin.body.access_bundle.snapshot.iss, "cs2-alchemy-control-plane");
    assert.equal(clientLogin.body.access_bundle.snapshot.aud, "cs2-alchemy-desktop");
    assert.equal(clientLogin.body.access_bundle.snapshot.token_type, "entitlement");
    assert.equal(clientLogin.body.access_bundle.snapshot.key_id, "local-ed25519-v1");
    assert.equal(clientLogin.body.access_bundle.snapshot.feature_flags.membership_expires_at, "");
    assert.equal(clientLogin.body.access_bundle.snapshot.permissions.includes(FEATURE_CODES.CRAFT_USE), false);

    const failClosedSigner = createEntitlementSigner({
      privateKeyFile: path.join(__dirname, "..", "..", "tmp", "client_license_private.pem"),
      now: () => new Date("2026-04-05T00:00:00.000Z")
    });
    const failClosedBundle = failClosedSigner.issueBundle({
      user: {id: "fail_closed", username: "fail_closed", membership_plan: "inactive"},
      deviceId: "device-fail-closed"
    });
    assert.deepEqual(failClosedBundle.snapshot.permissions, []);

    const redeemed = await request(ctx, "POST", "/api/auth/membership/redeem", {
      refresh_token: clientLogin.body.refresh_token,
      device_id: "device-alpha",
      code: activationCode
    });
    assert.equal(redeemed.status, 200);
    assert.equal(redeemed.body.user.membership_plan, "member");
    assert.equal(redeemed.body.user.membership_expires_at, "2026-04-12T00:00:00.000Z");
    assert.equal(redeemed.body.access_bundle.snapshot.permissions.includes(FEATURE_CODES.CRAFT_USE), true);
    assert.equal(redeemed.body.access_bundle.snapshot.feature_flags.membership_expires_at, "2026-04-12T00:00:00.000Z");

    const checkout = await request(ctx, "POST", "/api/auth/payment/checkout", {
      refresh_token: clientLogin.body.refresh_token,
      device_id: "device-alpha",
      product_id: product.body.product.id
    });
    assert.equal(checkout.status, 501);
    assert.equal(checkout.body.reason, "payment_not_configured");
    const orders = await request(ctx, "GET", "/api/admin/orders", null, readHeaders);
    assert.deepEqual(orders.body.items, []);

    assert.equal((await request(ctx, "POST", "/api/auth/craft-permit", {})).status, 404);
    assert.equal((await request(ctx, "POST", "/api/auth/steam-binding/check-or-bind", {})).status, 404);
    assert.equal((await request(ctx, "GET", `/api/admin/users/${created.body.user.id}/steam-bindings`, null, readHeaders)).status, 404);

    const reset = await request(ctx, "POST", `/api/admin/users/${created.body.user.id}/reset-password`, {
      new_password: "new client12"
    }, writeHeaders);
    assert.equal(reset.status, 200);
    assert.equal((await request(ctx, "POST", "/api/auth/refresh", {
      refresh_token: clientLogin.body.refresh_token, device_id: "device-alpha"
    })).status, 401);

    const bulkInvalid = await request(ctx, "POST", "/api/admin/users/bulk-grant", {
      user_ids: [created.body.user.id, 999999], days: 3
    }, writeHeaders);
    assert.equal(bulkInvalid.status, 404);

    const archived = await request(ctx, "DELETE", `/api/admin/users/${created.body.user.id}`, null, writeHeaders);
    assert.equal(archived.status, 200);
    assert.equal(archived.body.user.status, "archived");
    const restored = await request(ctx, "POST", `/api/admin/users/${created.body.user.id}/restore`, {}, writeHeaders);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.user.status, "active");

    const nonSuper = ctx.store.createOrUpdateAdminUser({
      username: "operator", password: "operator pass", isSuperAdmin: false
    });
    const nonSuperSession = ctx.store.createAdminSession({adminUserId: nonSuper.id});
    const forbidden = await request(ctx, "GET", "/api/admin/users", null, {
      Cookie: `admin_session=${nonSuperSession.session_token}`
    });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.reason, "super_admin_required");

    for (let index = 0; index < 5; index += 1) {
      const failed = await request(ctx, "POST", "/api/admin/login", {username: "admin", password: "wrong password"});
      assert.equal(failed.status, 401);
    }
    assert.equal((await request(ctx, "POST", "/api/admin/login", {username: "admin", password: "wrong password"})).status, 429);

    for (let index = 0; index < 20; index += 1) {
      const username = index < 5 ? "locked-user" : `missing-${index}`;
      await request(ctx, "POST", "/api/auth/login", {
        username, password: "wrong pass12", device_id: `device-${index}`
      });
    }
    const ipLimited = await request(ctx, "POST", "/api/auth/login", {
      username: "another-user", password: "wrong pass12", device_id: "device-final"
    });
    assert.equal(ipLimited.status, 429);

    const logout = await request(ctx, "POST", "/api/admin/logout", {}, writeHeaders);
    assert.equal(logout.status, 200);
    assert.match(String(logout.headers["set-cookie"][0]), /Max-Age=0/i);
  } finally {
    await stopServer(ctx);
  }

  console.log("control-plane-server tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
