const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const {stableJsonStringify, FEATURE_CODES, LICENSE_SNAPSHOT_POLICY} = require("../../shared/licensePolicy");
const {createServer} = require("../src/uiServer");
const {UiStateStore} = require("../src/uiStateStore");
const {LicenseStore} = require("../src/licenseStore");
const {createLicenseEnforcer} = require("../src/licenseEnforcer");
const {createLicenseScheduler} = require("../src/licenseScheduler");
const {resolveDeviceId} = require("../src/deviceIdentity");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-ui-license-"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function legacyAccountsFixture() {
  return {
    accounts: {
      countsteam01: {
        password: "SecretA",
        remark: "主号A",
        steam_name: "Alpha",
        steam_id: "steamid-alpha",
        avatar_url: "https://example.com/a.png"
      }
    },
    active: "countsteam01"
  };
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
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.CRAFT_USE,
      FEATURE_CODES.SIMULATION_USE
    ],
    feature_flags: {
      simulation_enabled: true
    },
    policy_version: 1,
    jti: "snap_1",
    iat: "2026-04-04T12:00:00.000Z",
    exp: "2026-04-04T12:15:00.000Z",
    iss: LICENSE_SNAPSHOT_POLICY.issuer,
    aud: LICENSE_SNAPSHOT_POLICY.audience,
    token_type: LICENSE_SNAPSHOT_POLICY.tokenType,
    key_id: LICENSE_SNAPSHOT_POLICY.keyId,
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

function createLicenseRuntime(filePath) {
  const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
  const store = new LicenseStore(filePath);
  const scheduler = createLicenseScheduler({
    store,
    enforcer: createLicenseEnforcer({
      publicKey,
      deviceId: "device_alpha"
    }),
    now: () => Date.parse("2026-04-04T12:05:00.000Z")
  });
  return {
    scheduler,
    issueBundle(snapshotOverrides = {}) {
      return createSignedBundle(privateKey, snapshotOverrides);
    }
  };
}

async function startServer(options = {}) {
  const tempDir = makeTempDir();
  const accountsFilePath = path.join(tempDir, "accounts.json");
  const uiStateFilePath = path.join(tempDir, "inventory_ui_state.json");
  const licenseStateFilePath = path.join(tempDir, "client_license_state.json");
  const clientConfigFilePath = path.join(tempDir, "client_config.json");
  const machineIdFilePath = path.join(tempDir, "machine_id.bin");
  writeJson(accountsFilePath, legacyAccountsFixture());
  writeJson(uiStateFilePath, {});
  writeJson(clientConfigFilePath, {});
  fs.writeFileSync(machineIdFilePath, Buffer.from("ui-auth-device", "utf8"));

  const runtime = createLicenseRuntime(licenseStateFilePath);
  const fakeAccountStore = {
    list() {
      return [
        {
          username: "countsteam01",
          password: "SecretA",
          remark: "主号A",
          steam_name: "Alpha",
          steam_id: "steamid-alpha",
          avatar_url: "https://example.com/a.png",
          is_active: true
        }
      ];
    },
    getActive() {
      return this.list()[0];
    },
    get(username) {
      return this.list().find((row) => row.username === username) || null;
    },
    setActive() {
      return true;
    },
    upsert() {
      return true;
    },
    updateRemark() {
      return true;
    },
    remove() {
      return true;
    }
  };
  const server = createServer({
    ...(options.useBuiltInLicenseRuntime ? {} : {licenseRuntimeFactory: () => runtime.scheduler}),
    licenseConfigFactory: () => ({
      authMode: "debug_bundle",
      configFile: clientConfigFilePath,
      machineIdFile: machineIdFilePath,
      ...(options.licenseConfig && typeof options.licenseConfig === "object" ? options.licenseConfig : {})
    }),
    controlPlaneAuthClientFactory: options.controlPlaneAuthClientFactory,
    authStoreFactory: options.authStoreFactory,
    uiStateStoreFactory: ({viewerUsername} = {}) =>
      new UiStateStore(uiStateFilePath, {
        viewerUsername
      }),
    accountStoreFactory: () => fakeAccountStore
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    tempDir,
    accountsFilePath,
    uiStateFilePath,
    licenseStateFilePath,
    machineIdFilePath,
    runtime,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function stopServer(ctx) {
  await new Promise((resolve) => ctx.server.close(resolve));
  fs.rmSync(ctx.tempDir, {recursive: true, force: true});
}

async function requestJson(ctx, method, route, {body = null, headers = {}} = {}) {
  const payload = body == null ? "" : JSON.stringify(body);
  const url = new URL(route, ctx.baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...headers
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = {};
          try {
            json = raw ? JSON.parse(raw) : {};
          } catch (err) {
            reject(err);
            return;
          }
          resolve({
            status: res.statusCode || 0,
            body: json,
            headers: res.headers
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

async function test_import_license_and_gate_business_api() {
  const ctx = await startServer();
  try {
    const stateBefore = await requestJson(ctx, "GET", "/api/license/state");
    assert.equal(stateBefore.status, 200);
    assert.equal(stateBefore.body.authenticated, false);
    assert.equal(stateBefore.body.code, "license_missing");

    const blocked = await requestJson(ctx, "GET", "/api/accounts");
    assert.equal(blocked.status, 401);
    assert.equal(blocked.body.reason, "license_required");

    const imported = await requestJson(ctx, "POST", "/api/license/import", {
      body: {
        bundle: ctx.runtime.issueBundle()
      }
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.authenticated, true);
    assert.equal(imported.body.user.username, "member_a");

    const stateAfter = await requestJson(ctx, "GET", "/api/license/state");
    assert.equal(stateAfter.status, 200);
    assert.equal(stateAfter.body.authenticated, true);
    assert.equal(stateAfter.body.user.username, "member_a");

    const accounts = await requestJson(ctx, "GET", "/api/accounts");
    assert.equal(accounts.status, 200);
    assert.equal(Array.isArray(accounts.body.accounts), true);
    assert.equal(accounts.body.accounts.length, 1);

    const cleared = await requestJson(ctx, "POST", "/api/license/clear");
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.authenticated, false);
  } finally {
    await stopServer(ctx);
  }
}

async function test_prod_login_mode_blocks_manual_import() {
  const ctx = await startServer({
    licenseConfig: {
      authMode: "prod_login"
    }
  });
  try {
    const authState = await requestJson(ctx, "GET", "/api/client-auth/state");
    assert.equal(authState.status, 200);
    assert.equal(authState.body.auth_mode, "prod_login");
    assert.equal(authState.body.allow_manual_import, false);

    const imported = await requestJson(ctx, "POST", "/api/license/import", {
      body: {
        bundle: ctx.runtime.issueBundle()
      }
    });
    assert.equal(imported.status, 403);
    assert.equal(imported.body.reason, "manual_import_disabled");
  } finally {
    await stopServer(ctx);
  }
}

async function test_client_auth_login_writes_local_control_plane_bundle_to_runtime() {
  let receivedPassword = "";
  const ctx = await startServer({
    licenseConfig: {
      authMode: "prod_login",
      controlPlaneBaseUrl: "http://127.0.0.1:8787"
    },
    controlPlaneAuthClientFactory: () => ({
      getCapabilities() {
        return {
          configured: true,
          baseUrl: "http://127.0.0.1:8787"
        };
      },
      async login({password}) {
        receivedPassword = password;
        return {
          user: {
            id: "user_1",
            username: "member_remote"
          },
          bundle: ctx.runtime.issueBundle({
            sub: "user_1",
            username: "member_remote",
            jti: "snap_remote"
          }),
          refreshCredential: "refresh_token_1"
        };
      }
    })
  });
  try {
    const login = await requestJson(ctx, "POST", "/api/client-auth/login", {
      body: {
        username: "member_remote",
        password: " login secret "
      }
    });
    assert.equal(login.status, 200);
    assert.equal(receivedPassword, " login secret ");
    assert.equal(login.body.authenticated, true);
    assert.equal(login.body.user.username, "member_remote");

    const state = await requestJson(ctx, "GET", "/api/license/state");
    assert.equal(state.status, 200);
    assert.equal(state.body.authenticated, true);
    assert.equal(state.body.user.username, "member_remote");
  } finally {
    await stopServer(ctx);
  }
}

async function test_local_api_rejects_cross_origin_and_oversized_mutations() {
  const ctx = await startServer();
  try {
    const crossOrigin = await requestJson(ctx, "POST", "/api/license/clear", {
      headers: {Origin: "https://evil.example"}
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(crossOrigin.body.reason, "cross_origin_request_denied");

    const plainText = await requestJson(ctx, "POST", "/api/client-auth/login", {
      body: {username: "member_a", password: "Password1234"},
      headers: {"Content-Type": "text/plain"}
    });
    assert.equal(plainText.status, 415);

    const oversized = await requestJson(ctx, "POST", "/api/client-auth/login", {
      body: {username: "member_a", password: "x".repeat(65536)}
    });
    assert.equal(oversized.status, 413);
  } finally {
    await stopServer(ctx);
  }
}

async function test_signed_permissions_ignore_legacy_local_super_admin() {
  const ctx = await startServer({
    authStoreFactory: () => ({
      dbPath: path.join(os.tmpdir(), "legacy-auth-store.db"),
      accountsFilePath: path.join(os.tmpdir(), "legacy-accounts.json"),
      getUserByUsername() {
        return {username: "member_a", display_name: "Legacy admin", is_super_admin: true};
      },
      canAccessSteamAccount() {
        return true;
      },
      close() {}
    })
  });
  try {
    const imported = await requestJson(ctx, "POST", "/api/license/import", {
      body: {
        bundle: ctx.runtime.issueBundle({
          membership_plan: "inactive",
          permissions: [],
          jti: "snap_no_permissions"
        })
      }
    });
    assert.equal(imported.status, 200);

    const accounts = await requestJson(ctx, "GET", "/api/accounts");
    assert.equal(accounts.status, 403);
    assert.equal(accounts.body.reason, "permission_denied");
  } finally {
    await stopServer(ctx);
  }
}

async function test_register_complete_imports_bundle_without_exposing_credentials() {
  let receivedDeviceId = "";
  const ctx = await startServer({
    licenseConfig: {
      authMode: "prod_login",
      controlPlaneBaseUrl: "http://127.0.0.1:8787"
    },
    controlPlaneAuthClientFactory: () => ({
      getCapabilities() {
        return {configured: true, baseUrl: "http://127.0.0.1:8787"};
      },
      async completeRegister({deviceId}) {
        receivedDeviceId = deviceId;
        return {
          user: {id: "registered_1", username: "registered_user"},
          bundle: ctx.runtime.issueBundle({
            sub: "registered_1",
            username: "registered_user",
            membership_plan: "inactive",
            permissions: [FEATURE_CODES.ACCOUNTS_READ],
            jti: "snap_registered"
          }),
          refreshCredential: "refresh_secret_must_stay_in_sidecar",
          refresh_token: "raw_refresh_must_not_escape",
          access_bundle: {refresh_credential: "nested_refresh_must_not_escape"}
        };
      }
    })
  });
  try {
    const registered = await requestJson(ctx, "POST", "/api/client-auth/register/complete", {
      body: {
        email: "registered@example.com",
        verification_ticket: "ticket_1",
        username: "registered_user",
        password: "RegisterPass12",
        device_id: "browser_supplied_device"
      }
    });
    assert.equal(registered.status, 200);
    assert.equal(registered.body.authenticated, true);
    assert.equal(registered.body.user.username, "registered_user");
    assert.equal(receivedDeviceId, resolveDeviceId(ctx.machineIdFilePath));
    const responseText = JSON.stringify(registered.body);
    assert.equal(responseText.includes("refresh_secret_must_stay_in_sidecar"), false);
    assert.equal(responseText.includes("raw_refresh_must_not_escape"), false);
    assert.equal(responseText.includes("nested_refresh_must_not_escape"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(registered.body, "bundle"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(registered.body, "access_bundle"), false);

    const stored = ctx.runtime.scheduler.readBundle();
    assert.equal(stored.refresh_credential, "refresh_secret_must_stay_in_sidecar");
  } finally {
    await stopServer(ctx);
  }
}

async function test_dev_auto_bundle_mode_bootstraps_local_signed_license() {
  const tempDir = makeTempDir();
  try {
    const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
    const privateKeyFile = path.join(tempDir, "client_license_private.pem");
    const publicKeyFile = path.join(tempDir, "client_license_public.pem");
    const machineIdFile = path.join(tempDir, "machine_id.bin");
    const uiStateFilePath = path.join(tempDir, "inventory_ui_state.json");
    const licenseStateFilePath = path.join(tempDir, "client_license_state.json");
    fs.writeFileSync(privateKeyFile, privateKey.export({format: "pem", type: "pkcs8"}), "utf8");
    fs.writeFileSync(publicKeyFile, publicKey.export({format: "pem", type: "spki"}), "utf8");
    fs.writeFileSync(machineIdFile, Buffer.from("dev-machine", "utf8"));
    writeJson(uiStateFilePath, {});

    const fakeAccountStore = {
      list() {
        return [{
          username: "countsteam01",
          password: "SecretA",
          remark: "主号A",
          steam_name: "Alpha",
          steam_id: "steamid-alpha",
          avatar_url: "https://example.com/a.png",
          is_active: true
        }];
      },
      getActive() {
        return this.list()[0];
      },
      get(username) {
        return this.list().find((row) => row.username === username) || null;
      },
      setActive() {
        return true;
      },
      upsert() {
        return true;
      },
      updateRemark() {
        return true;
      },
      remove() {
        return true;
      }
    };

    const server = createServer({
      licenseConfigFactory: () => ({
        authMode: "dev_auto_bundle",
        configFile: path.join(tempDir, "client_config.json"),
        publicKeyFile,
        machineIdFile,
        licenseStateFile: licenseStateFilePath,
        devLicensePrivateKeyFile: privateKeyFile
      }),
      uiStateStoreFactory: ({viewerUsername} = {}) => new UiStateStore(uiStateFilePath, {viewerUsername}),
      accountStoreFactory: () => fakeAccountStore
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const ctx = {
      tempDir,
      server,
      baseUrl: `http://127.0.0.1:${server.address().port}`
    };
    try {
      const authState = await requestJson(ctx, "GET", "/api/client-auth/state");
      assert.equal(authState.status, 200);
      assert.equal(authState.body.authenticated, true);
      assert.equal(authState.body.auth_mode, "dev_auto_bundle");
      assert.equal(authState.body.user.username, "dev_local");

      const accounts = await requestJson(ctx, "GET", "/api/accounts");
      assert.equal(accounts.status, 200);
      assert.equal(Array.isArray(accounts.body.accounts), true);
      assert.equal(accounts.body.accounts.length, 1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

async function main() {
  await test_local_api_rejects_cross_origin_and_oversized_mutations();
  await test_import_license_and_gate_business_api();
  await test_prod_login_mode_blocks_manual_import();
  await test_client_auth_login_writes_local_control_plane_bundle_to_runtime();
  await test_signed_permissions_ignore_legacy_local_super_admin();
  await test_register_complete_imports_bundle_without_exposing_credentials();
  await test_dev_auto_bundle_mode_bootstraps_local_signed_license();
  console.log("ui-server-auth tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
