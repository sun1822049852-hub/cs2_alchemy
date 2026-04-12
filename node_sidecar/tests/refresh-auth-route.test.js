const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const {stableJsonStringify, FEATURE_CODES} = require("../../shared/licensePolicy");
const {configureRuntimePaths} = require("../src/constants");
const {UiStateStore} = require("../src/uiStateStore");
const {LicenseStore} = require("../src/licenseStore");
const {createLicenseEnforcer} = require("../src/licenseEnforcer");
const {createLicenseScheduler} = require("../src/licenseScheduler");
const {createServer} = require("../src/uiServer");
const {refreshInventory} = require("../src/refreshWorkflow");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-refresh-auth-"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function createSnapshot(overrides = {}) {
  return {
    sub: "user_1",
    username: "member_a",
    device_id: "device_alpha",
    membership_plan: "pro",
    permissions: [
      FEATURE_CODES.ACCOUNTS_READ,
      FEATURE_CODES.ACCOUNTS_WRITE,
      FEATURE_CODES.INVENTORY_READ,
      FEATURE_CODES.INVENTORY_REFRESH
    ],
    feature_flags: {},
    policy_version: 1,
    jti: "snap_1",
    iat: "2026-04-12T11:00:00.000Z",
    exp: "2026-04-12T11:30:00.000Z",
    ...overrides
  };
}

function createSignedBundle(privateKey, snapshotOverrides = {}) {
  const snapshot = createSnapshot(snapshotOverrides);
  return {
    snapshot,
    signature: crypto.sign(null, Buffer.from(stableJsonStringify(snapshot)), privateKey).toString("base64"),
    source: "manual"
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

function createLicenseRuntime(filePath) {
  const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
  const store = new LicenseStore(filePath);
  const scheduler = createLicenseScheduler({
    store,
    enforcer: createLicenseEnforcer({
      publicKey,
      deviceId: "device_alpha"
    }),
    now: () => Date.parse("2026-04-12T11:05:00.000Z")
  });
  return {
    scheduler,
    issueBundle(snapshotOverrides = {}) {
      return createSignedBundle(privateKey, snapshotOverrides);
    }
  };
}

function createFakeAccountStore(seedRows = []) {
  const rows = new Map();
  const list = Array.isArray(seedRows) && seedRows.length
    ? seedRows
    : [{
      username: "countsteam01",
      password: "SecretA",
      remark: "主号A",
      steam_name: "Alpha",
      steam_id: "steamid-alpha",
      avatar_url: "https://example.com/a.png",
      is_active: true
    }];
  for (const row of list) {
    rows.set(String(row.username || "").trim(), {...row});
  }
  let active = list.find((row) => row && row.is_active)?.username || list[0].username;
  return {
    list() {
      return Array.from(rows.values()).map((row) => ({
        ...row,
        is_active: row.username === active
      }));
    },
    getActive() {
      const row = rows.get(String(active || "").trim());
      return row ? {...row, is_active: true} : null;
    },
    get(username) {
      const row = rows.get(String(username || "").trim());
      return row ? {...row, is_active: row.username === active} : null;
    },
    setActive(username) {
      const key = String(username || "").trim();
      if (!rows.has(key)) {
        return false;
      }
      active = key;
      return true;
    },
    upsert(payload) {
      const key = String(payload && payload.username || "").trim();
      if (!key) {
        return false;
      }
      rows.set(key, {
        ...rows.get(key),
        ...payload,
        username: key
      });
      active = key;
      return true;
    },
    updateRemark(username, remark) {
      const key = String(username || "").trim();
      if (!rows.has(key)) {
        return false;
      }
      rows.set(key, {
        ...rows.get(key),
        remark: String(remark || "").trim()
      });
      return true;
    },
    remove(username) {
      const key = String(username || "").trim();
      return rows.delete(key);
    }
  };
}

async function startServer({accounts = null, uiStateData = {}} = {}) {
  const tempDir = makeTempDir();
  configureRuntimePaths({
    projectRoot: tempDir,
    userDataDir: tempDir,
    isPackaged: false
  });
  const uiStateFilePath = path.join(tempDir, "inventory_ui_state.json");
  const licenseStateFilePath = path.join(tempDir, "client_license_state.json");
  writeJson(uiStateFilePath, uiStateData);

  const runtime = createLicenseRuntime(licenseStateFilePath);
  const fakeAccountStore = createFakeAccountStore(accounts || undefined);
  const createServerOptions = arguments[0] && arguments[0].createServerOptionsFactory
    ? arguments[0].createServerOptionsFactory({tempDir, uiStateFilePath, licenseStateFilePath})
    : {};
  const server = createServer({
    licenseRuntimeFactory: () => runtime.scheduler,
    licenseConfigFactory: () => ({
      authMode: "debug_bundle"
    }),
    uiStateStoreFactory: ({viewerUsername} = {}) => new UiStateStore(uiStateFilePath, {viewerUsername}),
    accountStoreFactory: () => fakeAccountStore,
    ...createServerOptions
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    tempDir,
    uiStateFilePath,
    licenseStateFilePath,
    runtime,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function stopServer(ctx) {
  await new Promise((resolve) => ctx.server.close(resolve));
  fs.rmSync(ctx.tempDir, {recursive: true, force: true});
}

async function requestJson(ctx, method, route, {body = null} = {}) {
  const payload = body == null ? "" : JSON.stringify(body);
  const url = new URL(route, ctx.baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve({
            statusCode: res.statusCode || 0,
            body: raw ? JSON.parse(raw) : {}
          });
        });
      }
    );
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function authorize(ctx) {
  const response = await requestJson(ctx, "POST", "/api/license/import", {
    body: {
      bundle: ctx.runtime.issueBundle()
    }
  });
  assert.equal(response.statusCode, 200);
}

async function test_accounts_and_snapshot_routes_include_default_auth_state() {
  const ctx = await startServer();
  try {
    await authorize(ctx);

    const accountsResponse = await requestJson(ctx, "GET", "/api/accounts");
    assert.equal(accountsResponse.statusCode, 200);
    assert.equal(accountsResponse.body.accounts.length, 1);
    assert.equal(accountsResponse.body.accounts[0].username, "countsteam01");
    assert.equal(accountsResponse.body.accounts[0].auth_state, "normal");
    assert.equal(accountsResponse.body.accounts[0].auth_reason, "");

    const snapshotResponse = await requestJson(
      ctx,
      "GET",
      "/api/snapshot/account?username=countsteam01"
    );
    assert.equal(snapshotResponse.statusCode, 200);
    assert.equal(snapshotResponse.body.ok, true);
    assert.equal(snapshotResponse.body.auth_state, "normal");
    assert.equal(snapshotResponse.body.auth_reason, "");
  } finally {
    await stopServer(ctx);
  }
}

async function test_refresh_route_uses_injected_refresh_inventory_fn() {
  let refreshCall = null;
  const ctx = await startServer({
    createServerOptionsFactory: ({tempDir}) => ({
      refreshInventoryFn: async (args = {}) => {
        refreshCall = {...args};
        const snapshotPath = path.join(tempDir, "logs", "processed_inventory", "inventory_processed_20260412_121500.json");
        writeJson(snapshotPath, {items: []});
        return {
          account: String(args.username || "").trim(),
          snapshot_path: snapshotPath,
          message: "stub refresh ok"
        };
      }
    })
  });
  try {
    await authorize(ctx);

    const response = await requestJson(ctx, "POST", "/api/refresh", {
      body: {
        username: "countsteam01",
        include_hidden: "false"
      }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(refreshCall && refreshCall.username, "countsteam01");
    assert.equal(response.body.result.account, "countsteam01");
  } finally {
    await stopServer(ctx);
  }
}

async function test_refresh_inventory_requires_saved_login_key_before_connecting() {
  let connectCalls = 0;
  class FakeSession {
    async connect() {
      connectCalls += 1;
      throw new Error("connect should not be reached without login key");
    }
    disconnect() {}
  }

  await assert.rejects(
    () => refreshInventory({
      username: "countsteam01",
      accountStore: {
        get() {
          return {
            username: "countsteam01",
            password: "SecretA"
          };
        }
      },
      tokenStore: {
        get() {
          return "";
        }
      },
      schemaStore: {
        load() {
          return {};
        }
      },
      SessionClass: FakeSession
    }),
    (err) => {
      assert.equal(err && err.code, "login_key_missing");
      return true;
    }
  );
  assert.equal(connectCalls, 0);
}

async function test_refresh_inventory_classifies_invalid_saved_login_key() {
  const connectCalls = [];
  class FakeSession {
    async connect(args = {}) {
      connectCalls.push({...args});
      const err = new Error("refresh token rejected");
      err.code = "InvalidPassword";
      throw err;
    }
    disconnect() {}
  }

  await assert.rejects(
    () => refreshInventory({
      username: "countsteam01",
      accountStore: {
        get() {
          return {
            username: "countsteam01",
            password: "SecretA"
          };
        }
      },
      tokenStore: {
        get() {
          return "old_login_key";
        }
      },
      schemaStore: {
        load() {
          return {};
        }
      },
      SessionClass: FakeSession
    }),
    (err) => {
      assert.equal(err && err.code, "login_key_invalid");
      return true;
    }
  );
  assert.equal(connectCalls.length, 1);
  assert.equal(connectCalls[0].refreshToken, "old_login_key");
  assert.equal(connectCalls[0].refreshTokenOnly, true);
}

async function test_refresh_inventory_reports_connection_ready_before_component_preload_finishes() {
  const componentDeferred = createDeferred();
  const events = [];
  class FakeSession {
    async connect(args = {}) {
      events.push(`connect:${String(args.username || "").trim()}`);
      return {
        csgo: {
          inventory: [{id: "item_1"}]
        }
      };
    }
    disconnect() {
      events.push("disconnect");
    }
  }

  const refreshTask = refreshInventory({
    username: "countsteam01",
    accountStore: {
      get() {
        return {
          username: "countsteam01",
          password: "SecretA"
        };
      }
    },
    tokenStore: {
      get() {
        return "saved_login_key";
      }
    },
    schemaStore: {
      load() {
        return {};
      }
    },
    SessionClass: FakeSession,
    onConnectionReady() {
      events.push("connection_ready");
    },
    preloadComponentContentsFn: async () => {
      events.push("component_preload:start");
      await componentDeferred.promise;
      events.push("component_preload:done");
      return {
        waiting: 0,
        loaded_items: [],
        expected_total: 0,
        notified: 0
      };
    },
    parseInventoryFn() {
      return {
        rows: [],
        hiddenRows: []
      };
    },
    saveProcessedSnapshotFn() {
      return path.join(os.tmpdir(), "inventory_processed_test.json");
    }
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    events,
    ["connect:countsteam01", "connection_ready", "component_preload:start"],
    "refreshInventory should surface connection ready before component preload finishes"
  );

  componentDeferred.resolve();
  const result = await refreshTask;
  assert.equal(result.account, "countsteam01");
  assert.equal(events.includes("component_preload:done"), true);
  assert.equal(events[events.length - 1], "disconnect");
}

async function test_refresh_route_returns_login_key_invalid_and_persists_auth_state() {
  let refreshCalls = 0;
  const ctx = await startServer({
    createServerOptionsFactory: () => ({
      refreshInventoryFn: async () => {
        refreshCalls += 1;
        const err = new Error("login key invalid: countsteam01");
        err.code = "login_key_invalid";
        err.reason = "login_key_invalid";
        err.status = 409;
        err.auth_state = "auth_invalid";
        throw err;
      }
    })
  });
  try {
    await authorize(ctx);

    const response = await requestJson(ctx, "POST", "/api/refresh", {
      body: {
        username: "countsteam01",
        include_hidden: "false"
      }
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.reason, "login_key_invalid");
    assert.equal(response.body.auth_state, "auth_invalid");
    assert.equal(response.body.relogin_required, true);
    assert.equal(refreshCalls, 1);

    const accountsResponse = await requestJson(ctx, "GET", "/api/accounts");
    assert.equal(accountsResponse.statusCode, 200);
    assert.equal(accountsResponse.body.accounts[0].auth_state, "auth_invalid");
    assert.equal(accountsResponse.body.accounts[0].auth_reason, "login_key_invalid");
  } finally {
    await stopServer(ctx);
  }
}

async function test_refresh_route_skips_retry_for_persisted_auth_invalid_state() {
  let refreshCalls = 0;
  const ctx = await startServer({
    uiStateData: {
      accounts: {
        countsteam01: {
          auth_state: "auth_invalid",
          auth_reason: "login_key_invalid"
        }
      }
    },
    createServerOptionsFactory: () => ({
      refreshInventoryFn: async () => {
        refreshCalls += 1;
        const err = new Error("refresh stub should not run for auth_invalid");
        err.code = "unexpected_refresh_call";
        throw err;
      }
    })
  });
  try {
    await authorize(ctx);

    const response = await requestJson(ctx, "POST", "/api/refresh", {
      body: {
        username: "countsteam01",
        include_hidden: "false"
      }
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.reason, "login_key_invalid");
    assert.equal(response.body.auth_state, "auth_invalid");
    assert.equal(response.body.relogin_required, true);
    assert.equal(refreshCalls, 0);
  } finally {
    await stopServer(ctx);
  }
}

async function test_login_save_clears_persisted_auth_invalid_state() {
  let loginCalls = 0;
  const ctx = await startServer({
    uiStateData: {
      accounts: {
        countsteam01: {
          auth_state: "auth_invalid",
          auth_reason: "login_key_invalid"
        }
      }
    },
    createServerOptionsFactory: () => ({
      loginAndSaveTokenFn: async ({username, password, twoFactorCode}) => {
        loginCalls += 1;
        assert.equal(username, "countsteam01");
        assert.equal(password, "SecretA");
        assert.equal(twoFactorCode, "123456");
        return {
          username,
          refresh_token: "new_login_key"
        };
      },
      resolveAccountProfileFn: async ({username}) => ({
        username,
        steam_id64: "steamid-alpha",
        persona_name: "Alpha",
        avatar_url_full: "https://example.com/a.png"
      })
    })
  });
  try {
    await authorize(ctx);

    const response = await requestJson(ctx, "POST", "/api/accounts/login-save", {
      body: {
        username: "countsteam01",
        password: "SecretA",
        totp: "123456"
      }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(loginCalls, 1);

    const accountsResponse = await requestJson(ctx, "GET", "/api/accounts");
    assert.equal(accountsResponse.statusCode, 200);
    assert.equal(accountsResponse.body.accounts[0].auth_state, "normal");
    assert.equal(accountsResponse.body.accounts[0].auth_reason, "");
  } finally {
    await stopServer(ctx);
  }
}

async function main() {
  await test_accounts_and_snapshot_routes_include_default_auth_state();
  await test_refresh_route_uses_injected_refresh_inventory_fn();
  await test_refresh_inventory_requires_saved_login_key_before_connecting();
  await test_refresh_inventory_classifies_invalid_saved_login_key();
  await test_refresh_inventory_reports_connection_ready_before_component_preload_finishes();
  await test_refresh_route_returns_login_key_invalid_and_persists_auth_state();
  await test_refresh_route_skips_retry_for_persisted_auth_invalid_state();
  await test_login_save_clears_persisted_auth_invalid_state();
  console.log("refresh-auth-route tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
