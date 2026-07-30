const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const {
  stableJsonStringify,
  FEATURE_CODES,
  LICENSE_SNAPSHOT_POLICY
} = require("../../shared/licensePolicy");
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
    membership_plan: "member",
    permissions: [
      FEATURE_CODES.ACCOUNTS_READ,
      FEATURE_CODES.ACCOUNTS_WRITE,
      FEATURE_CODES.INVENTORY_READ,
      FEATURE_CODES.INVENTORY_REFRESH
    ],
    feature_flags: {},
    policy_version: 1,
    iss: LICENSE_SNAPSHOT_POLICY.issuer,
    aud: LICENSE_SNAPSHOT_POLICY.audience,
    token_type: LICENSE_SNAPSHOT_POLICY.tokenType,
    key_id: LICENSE_SNAPSHOT_POLICY.keyId,
    jti: "snap_1",
    iat: "2026-04-12T11:00:00.000Z",
    exp: "2026-04-12T11:15:00.000Z",
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
  const projectAccount = (row) => {
    if (!row) return null;
    const {password: _password, mafile_content: _mafileContent, ...publicRow} = row;
    return {...publicRow, is_active: row.username === active};
  };
  return {
    list() {
      return Array.from(rows.values()).map((row) => projectAccount(row));
    },
    getActive() {
      const row = rows.get(String(active || "").trim());
      return projectAccount(row);
    },
    get(username) {
      const row = rows.get(String(username || "").trim());
      return projectAccount(row);
    },
    getCredentials(username) {
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
    saveVerifiedCredentials(username, password) {
      const key = String(username || "").trim();
      const secret = String(password || "").trim();
      if (!key || !secret) return false;
      rows.set(key, {
        ...rows.get(key),
        username: key,
        password: secret
      });
      return true;
    },
    clearPassword(username) {
      const key = String(username || "").trim();
      const row = rows.get(key);
      if (!row) return false;
      rows.set(key, {...row, password: ""});
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
    accountStore: fakeAccountStore,
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

async function test_snapshot_account_route_can_persist_web_inventory_stub_artifact() {
  const ctx = await startServer({
    uiStateData: {
      accounts: {
        countsteam01: {
          snapshot_path: "",
          fetch_time: "2026-04-25 18:30:00"
        }
      }
    },
    createServerOptionsFactory: ({tempDir}) => {
      const snapshotPath = path.join(tempDir, "logs", "processed_inventory", "inventory_processed_20260425_183000.json");
      writeJson(snapshotPath, {
        items: [
          {
            asset_id: "asset-main-1",
            def_index: 7,
            market_hash_name: "AK-47 | Redline (Field-Tested)",
            name: "AK-47 | Redline (Field-Tested)",
            goods_icon_url: "https://example.com/redline.png",
            casket_id: "",
            is_craftable: true
          },
          {
            asset_id: "asset-box-1",
            def_index: 9,
            market_hash_name: "AWP | Asiimov (Battle-Scarred)",
            name: "AWP | Asiimov (Battle-Scarred)",
            goods_icon_url: "https://example.com/asiimov.png",
            casket_id: "component-1",
            is_craftable: true
          }
        ]
      });
      return {
        uiStateStoreFactory: ({viewerUsername} = {}) => {
          writeJson(path.join(tempDir, "inventory_ui_state.json"), {
            accounts: {
              countsteam01: {
                snapshot_path: snapshotPath,
                fetch_time: "2026-04-25 18:30:00",
                auth_state: "normal",
                auth_reason: ""
              }
            }
          });
          return new UiStateStore(path.join(tempDir, "inventory_ui_state.json"), {viewerUsername});
        }
      };
    }
  });
  try {
    await authorize(ctx);

    const response = await requestJson(
      ctx,
      "GET",
      "/api/snapshot/account?username=countsteam01&source=web_inventory&save_stub=1"
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(typeof response.body.stub_artifact, "object");
    assert.equal(typeof response.body.stub_artifact.stub_path, "string");
    assert.equal(typeof response.body.stub_artifact.log_path, "string");
    assert.equal(fs.existsSync(response.body.stub_artifact.stub_path), true, "stub file should be created");
    assert.equal(fs.existsSync(response.body.stub_artifact.log_path), true, "fetch log should be created");

    const stubPayload = JSON.parse(fs.readFileSync(response.body.stub_artifact.stub_path, "utf8"));
    assert.equal(stubPayload.format, "web_inventory_fetch_stub_v1");
    assert.equal(stubPayload.username, "countsteam01");
    assert.equal(stubPayload.source, "web_inventory");
    assert.equal(stubPayload.counts.row_count, 2);
    assert.equal(stubPayload.counts.component_item_count, 1);
    assert.equal(Array.isArray(stubPayload.sample_rows), true);
    assert.equal(stubPayload.sample_rows[0].asset_id, "asset-main-1");

    const logLines = fs.readFileSync(response.body.stub_artifact.log_path, "utf8").trim().split(/\r?\n/).filter(Boolean);
    assert.equal(logLines.length, 1);
    const logEntry = JSON.parse(logLines[0]);
    assert.equal(logEntry.username, "countsteam01");
    assert.equal(logEntry.source, "web_inventory");
    assert.equal(logEntry.row_count, 2);
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
  let storedToken = "old_login_key";
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
          return storedToken;
        },
        remove() {
          storedToken = "";
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
  assert.equal(storedToken, "");
}

async function test_refresh_inventory_only_enables_auto_recovery_for_accounts_with_mafile() {
  const recoveryFlags = [];
  for (const mafileContent of ["", JSON.stringify({shared_secret: "guard"})]) {
    const sessionPool = {
      hasTokenRecovery() {
        return true;
      },
      async acquire(args) {
        recoveryFlags.push(args.allowTokenRecovery);
        throw new Error("stop after recovery eligibility check");
      },
      invalidate() {
      }
    };
    await assert.rejects(
      () => refreshInventory({
        username: "countsteam01",
        accountStore: {
          getCredentials() {
            return {
              username: "countsteam01",
              password: "SecretA",
              mafile_content: mafileContent
            };
          }
        },
        tokenStore: {get() { return "expired-token"; }},
        schemaStore: {load() { return {}; }},
        sessionPool
      }),
      /stop after recovery eligibility check/
    );
  }
  assert.deepEqual(recoveryFlags, [false, true]);
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
        err.credential_state = "password_reentry_required";
        err.password_cleared = true;
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
    assert.equal(response.body.message, "登录过期");
    assert.equal(response.body.auth_state, "auth_invalid");
    assert.equal(response.body.relogin_required, true);
    assert.equal(response.body.credential_state, "password_reentry_required");
    assert.equal(response.body.password_cleared, true);
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

async function test_refresh_route_preserves_password_reentry_after_automatic_recovery_is_latched() {
  const ctx = await startServer({
    accounts: [{
      username: "countsteam01",
      password: "",
      remark: "主号A",
      steam_name: "Alpha",
      steam_id: "steamid-alpha",
      avatar_url: "https://example.com/a.png",
      mafile_content: JSON.stringify({shared_secret: "guard"}),
      is_active: true
    }],
    createServerOptionsFactory: () => ({
      refreshInventoryFn: async () => {
        const err = new Error("该账号没有保存密码");
        err.code = "password_missing";
        err.reason = "password_missing";
        err.status = 409;
        err.auth_state = "needs_attention";
        err.credential_state = "password_reentry_required";
        throw err;
      }
    })
  });
  try {
    await authorize(ctx);

    const response = await requestJson(ctx, "POST", "/api/refresh", {
      body: {username: "countsteam01"}
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.reason, "password_missing");
    assert.equal(response.body.auth_state, "needs_attention");
    assert.equal(response.body.relogin_required, true);
    assert.equal(response.body.credential_state, "password_reentry_required");
  } finally {
    await stopServer(ctx);
  }
}

async function test_guard_account_retries_despite_persisted_auth_invalid_state() {
  let refreshCalls = 0;
  const ctx = await startServer({
    accounts: [{
      username: "countsteam01",
      password: "SecretA",
      remark: "主号A",
      steam_name: "Alpha",
      steam_id: "steamid-alpha",
      avatar_url: "https://example.com/a.png",
      mafile_content: JSON.stringify({
        shared_secret: Buffer.from("shared-secret").toString("base64"),
        identity_secret: Buffer.from("identity-secret").toString("base64"),
        revocation_code: "R12345",
        device_id: "android:00000000-0000-0000-0000-000000000001"
      }),
      has_steam_guard: true,
      is_active: true
    }],
    uiStateData: {
      accounts: {
        countsteam01: {
          auth_state: "auth_invalid",
          auth_reason: "login_key_invalid"
        }
      }
    },
    createServerOptionsFactory: ({tempDir}) => ({
      refreshInventoryFn: async () => {
        refreshCalls += 1;
        const snapshotPath = path.join(tempDir, "guard-refresh-snapshot.json");
        writeJson(snapshotPath, []);
        return {account: "countsteam01", snapshot_path: snapshotPath};
      }
    })
  });
  try {
    await authorize(ctx);
    const response = await requestJson(ctx, "POST", "/api/refresh", {
      body: {username: "countsteam01", include_hidden: "false"}
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(refreshCalls, 1);
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
        assert.equal(twoFactorCode, "A1B2C");
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
        totp: "A1B2C"
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

async function test_login_start_uses_saved_password_for_existing_account() {
  let loginInput = null;
  const ctx = await startServer({
    createServerOptionsFactory: () => ({
      startLoginSessionFn: async (input) => {
        loginInput = input;
        return {
          done: false,
          guard_type: "email_code",
          guard_hint: "m***@example.com"
        };
      }
    })
  });
  try {
    await authorize(ctx);

    const response = await requestJson(ctx, "POST", "/api/accounts/login-start", {
      body: {
        username: "countsteam01",
        password: ""
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.done, false);
    assert.equal(response.body.guard_type, "email_code");
    assert.ok(loginInput, "existing-account login should call the login service");
    assert.equal(loginInput.username, "countsteam01");
    assert.equal(loginInput.password, "SecretA");
  } finally {
    await stopServer(ctx);
  }
}

async function test_login_start_surfaces_profile_license_failure_and_emits_status() {
  const emitted = [];
  const licenseError = new Error("CS2 领取失败：请求过于频繁，请稍后重试（EResult 84）");
  licenseError.code = "cs2_license_claim_rate_limited";
  licenseError.reason = "cs2_license_claim_rate_limited";
  licenseError.stage = "steam_app_license";
  licenseError.status = 409;
  licenseError.eresult = 84;
  licenseError.steam_eresult = 84;
  licenseError.retryable = true;
  const ctx = await startServer({
    createServerOptionsFactory: () => ({
      refreshRuntime: {
        start() {},
        shutdown() {},
        emitSse(event, payload) {
          emitted.push({event, payload});
        }
      },
      startLoginSessionFn: async ({username}) => ({
        done: true,
        result: {username, refresh_token: "new-login-token"}
      }),
      resolveAccountProfileFn: async (input) => {
        assert.equal(typeof input.onLicenseStatus, "function");
        await input.onLicenseStatus({
          stage: "claiming",
          app_id: 730,
          message: "账号尚未入库，正在领取 CS2 免费许可"
        });
        throw licenseError;
      }
    })
  });
  try {
    await authorize(ctx);
    const response = await requestJson(ctx, "POST", "/api/accounts/login-start", {
      body: {username: "countsteam01", password: "SecretA"}
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.reason, "cs2_license_claim_rate_limited");
    assert.equal(response.body.message, licenseError.message);
    assert.equal(response.body.steam_eresult, 84);
    assert.equal(response.body.retryable, true);
    assert.deepEqual(emitted, [{
      event: "steam_app_license_status",
      payload: {
        stage: "claiming",
        app_id: 730,
        message: "账号尚未入库，正在领取 CS2 免费许可",
        username: "countsteam01",
        source: "account_login"
      }
    }]);
  } finally {
    await stopServer(ctx);
  }
}

async function test_login_start_persists_verified_credentials_before_guard_response() {
  const ctx = await startServer({
    accounts: [{
      username: "countsteam01",
      password: "OldPassword",
      remark: "主号A",
      steam_name: "Alpha",
      steam_id: "steamid-alpha",
      avatar_url: "https://example.com/a.png",
      is_active: true
    }],
    createServerOptionsFactory: () => ({
      startLoginSessionFn: async () => ({
        done: false,
        guard_type: "email_code",
        guard_hint: "m***@example.com"
      })
    })
  });
  try {
    await authorize(ctx);
    const response = await requestJson(ctx, "POST", "/api/accounts/login-start", {
      body: {username: "countsteam01", password: "VerifiedPassword"}
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.done, false);
    assert.equal(response.body.credentials_saved, true);
    const accounts = await requestJson(ctx, "GET", "/api/accounts");
    assert.equal(accounts.body.accounts[0].remark, "主号A");
    const credentials = ctx.accountStore.getCredentials("countsteam01");
    assert.equal(credentials.password, "VerifiedPassword");
    assert.equal(credentials.remark, "主号A");
    assert.equal(credentials.steam_name, "Alpha");
    assert.equal(credentials.steam_id, "steamid-alpha");
    assert.equal(credentials.avatar_url, "https://example.com/a.png");
  } finally {
    await stopServer(ctx);
  }
}

async function test_login_start_saves_new_verified_account_without_switching_active_account() {
  const ctx = await startServer({
    createServerOptionsFactory: () => ({
      startLoginSessionFn: async () => ({
        done: false,
        guard_type: "device_code",
        guard_hint: ""
      })
    })
  });
  try {
    await authorize(ctx);
    const response = await requestJson(ctx, "POST", "/api/accounts/login-start", {
      body: {username: "new_verified_account", password: "VerifiedPassword"}
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.done, false);
    assert.equal(response.body.credentials_saved, true);
    assert.equal(ctx.accountStore.getCredentials("new_verified_account").password, "VerifiedPassword");
    assert.equal(ctx.accountStore.getActive().username, "countsteam01");
  } finally {
    await stopServer(ctx);
  }
}

async function test_login_start_submits_local_guard_on_backend_after_password_phase() {
  const sharedSecret = Buffer.from("server-side-login-guard").toString("base64");
  const maFileContent = JSON.stringify({
    account_name: "countsteam01",
    shared_secret: sharedSecret,
    identity_secret: Buffer.from("server-side-identity").toString("base64"),
    device_id: "android:12345678-1234-4123-8123-123456789abc",
    revocation_code: "R12345",
    Session: null
  });
  let startInput = null;
  let submitInput = null;
  const ctx = await startServer({
    accounts: [{
      username: "countsteam01",
      password: "SecretA",
      remark: "主号A",
      steam_name: "Alpha",
      steam_id: "steamid-alpha",
      avatar_url: "https://example.com/a.png",
      mafile_content: maFileContent,
      has_steam_guard: true,
      is_active: true
    }],
    createServerOptionsFactory: () => ({
      startLoginSessionFn: async (input) => {
        startInput = input;
        return {done: false, guard_type: "device_code", guard_hint: ""};
      },
      submitGuardCodeFn: async (input) => {
        submitInput = input;
        return {
          done: true,
          authenticated_password: "SecretA",
          result: {
            username: "countsteam01",
            refresh_token: "refreshed-token",
            steam_id64: "steamid-alpha"
          }
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
    const response = await requestJson(ctx, "POST", "/api/accounts/login-start", {
      body: {
        username: "countsteam01",
        password: "SecretA",
        totp: "CLIENT-MUST-NOT-BE-USED"
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.done, true);
    assert.equal(startInput.twoFactorCode, "", "password phase must start without a client-supplied Guard code");
    assert.ok(submitInput, "backend should submit the local maFile code after Steam requests device_code");
    assert.equal(submitInput.username, "countsteam01");
    assert.match(submitInput.code, /^[A-Z0-9]{5}$/);
    assert.equal(JSON.stringify(response.body).includes(submitInput.code), false);
    assert.equal(JSON.stringify(response.body).includes(sharedSecret), false);
  } finally {
    await stopServer(ctx);
  }
}

async function test_existing_guard_invalid_password_clears_only_saved_password() {
  const maFileContent = JSON.stringify({
    account_name: "countsteam01",
    shared_secret: Buffer.from("saved-login-guard").toString("base64"),
    identity_secret: Buffer.from("saved-login-identity").toString("base64"),
    device_id: "android:12345678-1234-4123-8123-123456789abc",
    revocation_code: "R12345",
    Session: null
  });
  const ctx = await startServer({
    accounts: [{
      username: "countsteam01",
      password: "WrongPassword",
      remark: "主号A",
      steam_name: "Alpha",
      steam_id: "steamid-alpha",
      avatar_url: "https://example.com/a.png",
      mafile_content: maFileContent,
      has_steam_guard: true,
      is_active: true
    }],
    createServerOptionsFactory: () => ({
      startLoginSessionFn: async () => {
        const error = new Error("InvalidPassword");
        error.eresult = 5;
        throw error;
      }
    })
  });
  try {
    await authorize(ctx);
    const response = await requestJson(ctx, "POST", "/api/accounts/login-start", {
      body: {username: "countsteam01", password: "WrongPassword"}
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.body.reason, "invalid_password");
    assert.equal(response.body.message, "密码错误，请重新输入密码");
    assert.equal(response.body.password_cleared, true);

    const accounts = await requestJson(ctx, "GET", "/api/accounts");
    assert.equal(accounts.body.accounts[0].password, "");
    assert.equal(accounts.body.accounts[0].has_steam_guard, true);
  } finally {
    await stopServer(ctx);
  }
}

async function test_new_account_invalid_password_keeps_account_or_password_message() {
  const ctx = await startServer({
    createServerOptionsFactory: () => ({
      startLoginSessionFn: async () => {
        const error = new Error("InvalidPassword");
        error.eresult = 5;
        throw error;
      }
    })
  });
  try {
    await authorize(ctx);
    const response = await requestJson(ctx, "POST", "/api/accounts/login-start", {
      body: {username: "brand_new_account", password: "WrongPassword"}
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.reason, "invalid_password");
    assert.equal(response.body.message, "账号或密码错误，请确认后重试");
    assert.equal(Object.hasOwn(response.body, "password_cleared"), false);
  } finally {
    await stopServer(ctx);
  }
}

async function test_existing_account_access_denied_is_persisted_as_login_expiry() {
  const invalidatedAccounts = [];
  const ctx = await startServer({
    createServerOptionsFactory: () => ({
      startLoginSessionFn: async () => {
        const error = new Error("AccessDenied");
        error.eresult = 15;
        throw error;
      },
      tokenRecoveryService: {
        async invalidateAuthentication(username) {
          invalidatedAccounts.push(username);
        }
      }
    })
  });
  try {
    await authorize(ctx);

    const response = await requestJson(ctx, "POST", "/api/accounts/login-start", {
      body: {username: "countsteam01", password: "SecretA"}
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.reason, "login_key_invalid");
    assert.equal(response.body.auth_state, "auth_invalid");
    assert.equal(response.body.relogin_required, true);
    assert.equal(response.body.message, "登录过期");
    assert.deepEqual(invalidatedAccounts, ["countsteam01"]);

    const accounts = await requestJson(ctx, "GET", "/api/accounts");
    assert.equal(accounts.body.accounts[0].auth_state, "auth_invalid");
    assert.equal(accounts.body.accounts[0].auth_reason, "login_key_invalid");
  } finally {
    await stopServer(ctx);
  }
}

async function test_new_account_access_denied_remains_access_denied() {
  const ctx = await startServer({
    createServerOptionsFactory: () => ({
      startLoginSessionFn: async () => {
        const error = new Error("AccessDenied");
        error.eresult = 15;
        throw error;
      }
    })
  });
  try {
    await authorize(ctx);

    const response = await requestJson(ctx, "POST", "/api/accounts/login-start", {
      body: {username: "brand_new_account", password: "SecretNew"}
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.reason, "access_denied");
    assert.equal(Object.hasOwn(response.body, "auth_state"), false);
  } finally {
    await stopServer(ctx);
  }
}

async function test_login_submit_code_ignores_tampered_password_and_uses_phase1_authenticated_password() {
  let submitInput = null;
  let profileInput = null;
  const ctx = await startServer({
    createServerOptionsFactory: () => ({
      submitGuardCodeFn: async (input) => {
        submitInput = input;
        return {
          done: true,
          authenticated_password: "SecretA",
          result: {
            username: "countsteam01",
            refresh_token: "refreshed-token",
            steam_id64: "steamid-alpha"
          }
        };
      },
      resolveAccountProfileFn: async (input) => {
        profileInput = input;
        return {
          username: input.username,
          steam_id64: "steamid-alpha",
          persona_name: "Alpha",
          avatar_url_full: "https://example.com/a.png"
        };
      }
    })
  });
  try {
    await authorize(ctx);

    const response = await requestJson(ctx, "POST", "/api/accounts/login-submit-code", {
      body: {
        username: "countsteam01",
        code: "ABCDE",
        password: "TamperedPassword"
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.ok(submitInput, "guard-code submission should call the pending login service");
    assert.equal(submitInput.username, "countsteam01");
    assert.equal(submitInput.code, "ABCDE");
    assert.ok(profileInput, "successful guard-code submission should refresh the account profile");
    assert.equal(profileInput.password, "SecretA");
    assert.equal(JSON.stringify(response.body).includes("SecretA"), false);
    assert.equal(Object.hasOwn(response.body.active || {}, "password"), false);
    assert.equal(Object.hasOwn(response.body.accounts[0] || {}, "password"), false);
  } finally {
    await stopServer(ctx);
  }
}

async function test_login_code_routes_reject_invalid_format_before_auth_service() {
  const calls = {
    start: 0,
    submit: 0,
    save: 0
  };
  const ctx = await startServer({
    createServerOptionsFactory: () => ({
      startLoginSessionFn: async () => {
        calls.start += 1;
        return {done: false, guard_type: "device_code", guard_hint: ""};
      },
      submitGuardCodeFn: async () => {
        calls.submit += 1;
        return {done: true, result: {username: "countsteam01", refresh_token: "token"}};
      },
      loginAndSaveTokenFn: async () => {
        calls.save += 1;
        return {username: "countsteam01", refresh_token: "token"};
      }
    })
  });
  try {
    await authorize(ctx);

    const startResponse = await requestJson(ctx, "POST", "/api/accounts/login-start", {
      body: {username: "countsteam01", password: "SecretA", totp: "AB-12"}
    });
    const submitResponse = await requestJson(ctx, "POST", "/api/accounts/login-submit-code", {
      body: {username: "countsteam01", code: "ABC123"}
    });
    const saveResponse = await requestJson(ctx, "POST", "/api/accounts/login-save", {
      body: {username: "countsteam01", password: "SecretA", totp: "abc12"}
    });

    for (const response of [startResponse, submitResponse, saveResponse]) {
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.reason, "invalid_guard_code_format");
      assert.equal(response.body.message, "验证码必须为5位大写字母或数字");
    }
    assert.deepEqual(calls, {start: 0, submit: 0, save: 0});
  } finally {
    await stopServer(ctx);
  }
}

async function main() {
  await test_accounts_and_snapshot_routes_include_default_auth_state();
  await test_snapshot_account_route_can_persist_web_inventory_stub_artifact();
  await test_refresh_route_uses_injected_refresh_inventory_fn();
  await test_refresh_inventory_requires_saved_login_key_before_connecting();
  await test_refresh_inventory_classifies_invalid_saved_login_key();
  await test_refresh_inventory_only_enables_auto_recovery_for_accounts_with_mafile();
  await test_refresh_inventory_reports_connection_ready_before_component_preload_finishes();
  await test_refresh_route_returns_login_key_invalid_and_persists_auth_state();
  await test_refresh_route_preserves_password_reentry_after_automatic_recovery_is_latched();
  await test_refresh_route_skips_retry_for_persisted_auth_invalid_state();
  await test_guard_account_retries_despite_persisted_auth_invalid_state();
  await test_login_save_clears_persisted_auth_invalid_state();
  await test_login_start_uses_saved_password_for_existing_account();
  await test_login_start_surfaces_profile_license_failure_and_emits_status();
  await test_login_start_persists_verified_credentials_before_guard_response();
  await test_login_start_saves_new_verified_account_without_switching_active_account();
  await test_login_start_submits_local_guard_on_backend_after_password_phase();
  await test_existing_guard_invalid_password_clears_only_saved_password();
  await test_new_account_invalid_password_keeps_account_or_password_message();
  await test_existing_account_access_denied_is_persisted_as_login_expiry();
  await test_new_account_access_denied_remains_access_denied();
  await test_login_submit_code_ignores_tampered_password_and_uses_phase1_authenticated_password();
  await test_login_code_routes_reject_invalid_format_before_auth_service();
  console.log("refresh-auth-route tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
