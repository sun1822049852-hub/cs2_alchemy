const assert = require("node:assert/strict");
const http = require("node:http");

const {createServer} = require("../src/uiServer");

const sharedSecret = Buffer.from("route-shared").toString("base64");
const identitySecret = Buffer.from("route-identity").toString("base64");
const maFile = JSON.stringify({
  shared_secret: sharedSecret,
  identity_secret: identitySecret,
  secret_1: Buffer.from("route-secret-1").toString("base64"),
  serial_number: "123456",
  revocation_code: "R-ROUTE",
  account_name: "demo",
  device_id: "android:12345678-1234-4123-8123-123456789abc",
  steamid: "76561198000000001",
  access_token: "must_not_export",
  Session: {
    SteamID: "76561198000000001",
    SteamLoginSecure: "must_not_export"
  }
});

function createReadyLicenseRuntime() {
  const state = {
    ok: true,
    code: "ready",
    user: {id: "user_test", username: "member_test", membership_plan: "pro"},
    permissions: ["accounts.read", "accounts.write"],
    featureFlags: {},
    expiresAt: "2099-01-01T00:15:00.000Z",
    expiresInMs: 86400000
  };
  return {getState: () => state, stop() {}, importBundle: () => state, clear: () => state};
}

function makeAccountStore() {
  const publicRow = {
    username: "demo",
    remark: "Demo",
    steam_name: "",
    steam_id: "76561198000000001",
    steam_id64: "76561198000000001",
    avatar_url: "",
    has_steam_guard: true,
    is_active: true
  };
  return {
    list: () => [publicRow],
    getActive: () => publicRow,
    get: (username) => username === "demo" ? publicRow : null,
    getCredentials: (username) => username === "demo"
      ? {...publicRow, password: "secret", mafile_content: maFile}
      : null
  };
}

async function startServer() {
  const server = createServer({
    licenseRuntimeFactory: () => createReadyLicenseRuntime(),
    accountStoreFactory: () => makeAccountStore(),
    tokenStoreFactory: () => ({get: (username) => username === "demo" ? "refresh_token" : ""})
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {server, port: server.address().port};
}

function request(ctx, method, route) {
  return new Promise((resolve, reject) => {
    const req = http.request({hostname: "127.0.0.1", port: ctx.port, method, path: route}, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let body = raw;
        try { body = raw ? JSON.parse(raw) : {}; } catch (_) {}
        resolve({statusCode: res.statusCode || 0, headers: res.headers, body});
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function test_account_projection_has_only_guard_and_refresh_flags() {
  const ctx = await startServer();
  try {
    const response = await request(ctx, "GET", "/api/accounts");
    assert.equal(response.statusCode, 200);
    const row = response.body.accounts[0];
    assert.equal(row.has_steam_guard, true);
    assert.equal(row.has_refresh_token, true);
    assert.equal(Object.hasOwn(row, "password"), false);
    assert.equal(Object.hasOwn(row, "mafile_content"), false);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_token_code_and_recovery_routes_do_not_leak_secret() {
  const ctx = await startServer();
  try {
    const code = await request(ctx, "GET", "/api/accounts/steam-guard/code?username=demo");
    assert.equal(code.statusCode, 200);
    assert.deepEqual(Object.keys(code.body).sort(), ["current_code", "ok", "period", "remaining_seconds"]);
    assert.equal(code.body.current_code.length, 5);
    assert.equal(JSON.stringify(code.body).includes(sharedSecret), false);

    const recovery = await request(ctx, "GET", "/api/accounts/steam-guard/recovery-code?username=demo");
    assert.equal(recovery.statusCode, 200);
    assert.deepEqual(recovery.body, {ok: true, recovery_code: "R-ROUTE"});
    assert.equal(JSON.stringify(recovery.body).includes(sharedSecret), false);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_export_is_attachment_and_strips_session_tokens() {
  const ctx = await startServer();
  try {
    const response = await request(ctx, "GET", "/api/accounts/steam-guard/export?username=demo");
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers["content-disposition"] || ""), /demo\.maFile/);
    assert.equal(response.body.Session, null);
    assert.equal(response.body.shared_secret, sharedSecret);
    assert.equal(Object.hasOwn(response.body, "access_token"), false);
    assert.equal(JSON.stringify(response.body).includes("must_not_export"), false);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_legacy_secret_and_enrollment_routes_are_gone() {
  const ctx = await startServer();
  try {
    for (const [method, route] of [
      ["GET", "/api/accounts/token-detail?username=demo"],
      ["POST", "/api/accounts/enroll-steam-guard"],
      ["POST", "/api/accounts/finalize-steam-guard"]
    ]) {
      const response = await request(ctx, method, route);
      assert.equal(response.statusCode, 404, `${method} ${route} must be removed`);
    }
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function main() {
  await test_account_projection_has_only_guard_and_refresh_flags();
  await test_token_code_and_recovery_routes_do_not_leak_secret();
  await test_export_is_attachment_and_strips_session_tokens();
  await test_legacy_secret_and_enrollment_routes_are_gone();
  console.log("steam-guard-token-route tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
