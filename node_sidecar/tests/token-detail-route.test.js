const assert = require("node:assert/strict");
const http = require("node:http");

const {createServer} = require("../src/uiServer");

function createReadyLicenseRuntime() {
  const state = {
    ok: true,
    code: "ready",
    user: {
      id: "user_test",
      username: "member_test",
      membership_plan: "pro"
    },
    permissions: ["accounts.read", "accounts.write"],
    featureFlags: {},
    expiresAt: "2099-01-01T00:15:00.000Z",
    expiresInMs: 86400000
  };
  return {
    getState() {
      return state;
    },
    stop() {},
    importBundle() {
      return state;
    },
    clear() {
      return state;
    }
  };
}

async function startServer(accountStore) {
  const server = createServer({
    licenseRuntimeFactory: () => createReadyLicenseRuntime(),
    accountStoreFactory: () => accountStore
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.on("error", reject);
  });
  return {
    server,
    port: server.address().port
  };
}

async function stopServer(ctx) {
  await new Promise((resolve) => ctx.server.close(resolve));
}

function requestJson(ctx, method, route, {body = null} = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? "" : JSON.stringify(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port: ctx.port,
      method,
      path: route,
      headers: payload
        ? {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload)
          }
        : {}
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: res.statusCode || 0,
          body: raw ? JSON.parse(raw) : {}
        });
      });
    });
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function test_token_detail_redacts_raw_tokens_but_keeps_totp_contract() {
  const sharedSecret = Buffer.from("totp_secret").toString("base64");
  const accountStore = {
    get(username) {
      if (username !== "demo") {
        return null;
      }
      return {
        username: "demo",
        mafile_content: JSON.stringify({
          account_name: "demo",
          shared_secret: sharedSecret,
          identity_secret: Buffer.from("identity_secret").toString("base64"),
          access_token: "access_1",
          revocation_code: "R12345",
          device_id: "android:test-device",
          Session: {
            SteamID: "76561198000000001",
            SteamLoginSecure: "steamLoginSecure=76561198000000001%7C%7Crefresh_1"
          }
        })
      };
    }
  };
  const ctx = await startServer(accountStore);

  try {
    const response = await requestJson(ctx, "GET", "/api/accounts/token-detail?username=demo");
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(typeof response.body.currentTotp, "string");
    assert.equal(response.body.currentTotp.length, 5);
    assert.equal(response.body.period, 30);
    assert.equal(typeof response.body.encryptedSecret, "string");
    assert.equal(typeof response.body.steamData, "object");
    assert.equal(response.body.steamData.shared_secret, sharedSecret);
    assert.equal(response.body.steamData.access_token, "[REDACTED]");
    assert.equal(response.body.steamData.Session.SteamLoginSecure, "[REDACTED]");
  } finally {
    await stopServer(ctx);
  }
}

async function main() {
  await test_token_detail_redacts_raw_tokens_but_keeps_totp_contract();
  console.log("token-detail-route tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
