const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const {FEATURE_CODES} = require("../../shared/licensePolicy");
const {configureRuntimePaths, PATHS} = require("../src/constants");
const {AppAuthStore} = require("../src/appAuthStore");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "account-profile-scope-"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function createReadyLicenseRuntime() {
  const state = {
    ok: true,
    code: "ready",
    user: {
      id: "user_test",
      username: "member_test",
      membership_plan: "pro"
    },
    permissions: [
      FEATURE_CODES.ACCOUNTS_READ,
      FEATURE_CODES.ACCOUNTS_WRITE,
      FEATURE_CODES.INVENTORY_READ,
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.CRAFT_USE,
      FEATURE_CODES.SIMULATION_USE
    ],
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

function loadCreateServer({wallet} = {}) {
  const uiServerPath = require.resolve("../src/uiServer");
  const uiServerSourcePath = path.join(__dirname, "..", "src", "uiServer.js");
  const originalLoad = Module._load;
  delete require.cache[uiServerPath];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "steam-session") {
      return {
        LoginSession: class FakeLoginSession {},
        EAuthSessionGuardType: {Unknown: 0, None: 1},
        EAuthTokenPlatformType: {SteamClient: 0}
      };
    }
    if (request === "steam-user") {
      return class FakeSteamUser {};
    }
    if (request === "globaloffensive") {
      return class FakeGlobalOffensive {};
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./services/sessionPool") {
      return {
        createSessionPool() {
          return {
            async acquire() {
              const steam = {
                steamID: {
                  getSteamID64() {
                    return "76561199000000001";
                  },
                  getSteam3RenderedID() {
                    return "[U:1:12345673]";
                  }
                },
                async getPersonas(ids) {
                  const steamId64 = Array.isArray(ids) && ids[0] ? String(ids[0]) : "76561199000000001";
                  return {
                    personas: {
                      [steamId64]: {
                        player_name: "Seleno",
                        avatar_url_icon: "https://example.com/avatar-icon.png",
                        avatar_url_medium: "https://example.com/avatar-medium.png",
                        avatar_url_full: "https://example.com/avatar-full.png"
                      }
                    }
                  };
                },
                users: {}
              };
              if (wallet !== undefined) {
                steam.wallet = wallet;
              }
              return {
                reused: false,
                steam,
                csgo: {
                  accountData: {
                    account_id: 12345673,
                    player_level: 10,
                    player_cur_xp: 88
                  }
                }
              };
            },
            shutdown() {}
          };
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./services/refreshRuntime") {
      return {
        createRefreshRuntime() {
          return {
            start() {},
            handleSseRequest() {},
            emitSse() {},
            isConnected() {
              return false;
            },
            removeAccount() {}
          };
        }
      };
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    const {createServer} = require(uiServerPath);
    return createServer;
  } finally {
    Module._load = originalLoad;
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
    server.on("error", reject);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function requestJson({port, route, method = "GET", body = null}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? "" : JSON.stringify(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port,
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

function writeProfileAccountsFixture(accountsFilePath) {
  writeJson(accountsFilePath, {
    accounts: {
      selenomorphology: {
        password: "SecretA",
        remark: ""
      }
    },
    active: "selenomorphology"
  });
}

function readSteamAccountRow({dbPath, accountsFilePath, username}) {
  const verifyStore = new AppAuthStore({dbPath, accountsFilePath, readOnly: true, initialize: false});
  try {
    return verifyStore.getSteamAccountForUser("", username, {includeAll: true});
  } finally {
    verifyStore.close();
  }
}

async function testAccountProfileRouteUsesAccountViewerScopeConsistently() {
  const tempDir = makeTempDir();
  const originalPaths = {...PATHS};
  const dbPath = path.join(tempDir, "csgo_skins.db");
  const accountsFilePath = path.join(tempDir, "accounts.json");
  const uiStateFilePath = path.join(tempDir, "inventory_ui_state.json");

  try {
    configureRuntimePaths({
      projectRoot: tempDir,
      userDataDir: tempDir,
      isPackaged: false
    });
    writeProfileAccountsFixture(accountsFilePath);
    writeJson(uiStateFilePath, {});

    const seeded = new AppAuthStore({dbPath, accountsFilePath});
    seeded.close();

    const createServer = loadCreateServer();
    const server = createServer({
      licenseRuntimeFactory: () => createReadyLicenseRuntime()
    });

    try {
      const address = await listen(server);
      const accountsResponse = await requestJson({
        port: address.port,
        route: "/api/accounts"
      });
      assert.equal(accountsResponse.statusCode, 200);
      assert.equal(accountsResponse.body.accounts.length, 1);
      assert.equal(accountsResponse.body.accounts[0].username, "selenomorphology");

      const profileResponse = await requestJson({
        port: address.port,
        route: "/api/accounts/profile?username=selenomorphology"
      });
      assert.equal(profileResponse.statusCode, 200);
      assert.equal(profileResponse.body.ok, true);
      assert.equal(profileResponse.body.profile.persona_name, "Seleno");
      assert.equal(
        profileResponse.body.profile.avatar_url_full,
        "https://example.com/avatar-full.png"
      );

      const row = readSteamAccountRow({dbPath, accountsFilePath, username: "selenomorphology"});
      assert.equal(row.steam_name, "Seleno");
      assert.equal(row.avatar_url, "https://example.com/avatar-full.png");
    } finally {
      await closeServer(server);
      delete require.cache[require.resolve("../src/uiServer")];
    }
  } finally {
    configureRuntimePaths({
      projectRoot: originalPaths.ROOT_DIR,
      userDataDir: originalPaths.WRITABLE_ROOT,
      isPackaged: false
    });
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

async function testAccountProfileRoutePersistsSteamCmWalletMetadata() {
  const tempDir = makeTempDir();
  const originalPaths = {...PATHS};
  const dbPath = path.join(tempDir, "csgo_skins.db");
  const accountsFilePath = path.join(tempDir, "accounts.json");
  const uiStateFilePath = path.join(tempDir, "inventory_ui_state.json");

  try {
    configureRuntimePaths({
      projectRoot: tempDir,
      userDataDir: tempDir,
      isPackaged: false
    });
    writeProfileAccountsFixture(accountsFilePath);
    writeJson(uiStateFilePath, {});

    const seeded = new AppAuthStore({dbPath, accountsFilePath});
    seeded.close();

    const createServer = loadCreateServer({
      wallet: {
        hasWallet: true,
        currency: 23,
        balance: 15
      }
    });
    const server = createServer({
      licenseRuntimeFactory: () => createReadyLicenseRuntime()
    });

    try {
      const address = await listen(server);
      const profileResponse = await requestJson({
        port: address.port,
        route: "/api/accounts/profile?username=selenomorphology"
      });
      assert.equal(profileResponse.statusCode, 200);
      assert.equal(profileResponse.body.ok, true);
      assert.equal(profileResponse.body.profile.wallet_balance, "¥ 15.00");
      assert.equal(profileResponse.body.profile.wallet_source, "steam_cm");
      assert.equal(profileResponse.body.profile.wallet_currency, "CNY");
      assert.ok(profileResponse.body.profile.wallet_observed_at);

      const row = readSteamAccountRow({dbPath, accountsFilePath, username: "selenomorphology"});
      assert.equal(row.balance, "¥ 15.00");
      assert.equal(row.balance_source, "steam_cm");
      assert.equal(row.balance_currency, "CNY");
      assert.ok(row.balance_observed_at);
    } finally {
      await closeServer(server);
      delete require.cache[require.resolve("../src/uiServer")];
    }
  } finally {
    configureRuntimePaths({
      projectRoot: originalPaths.ROOT_DIR,
      userDataDir: originalPaths.WRITABLE_ROOT,
      isPackaged: false
    });
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

async function testAccountProfileRouteDoesNotFallbackToStoredStoreWalletWhenCmUnavailable() {
  const tempDir = makeTempDir();
  const originalPaths = {...PATHS};
  const dbPath = path.join(tempDir, "csgo_skins.db");
  const accountsFilePath = path.join(tempDir, "accounts.json");
  const uiStateFilePath = path.join(tempDir, "inventory_ui_state.json");
  const oldObservedAt = "2026-06-06T11:00:00.000Z";

  try {
    configureRuntimePaths({
      projectRoot: tempDir,
      userDataDir: tempDir,
      isPackaged: false
    });
    writeProfileAccountsFixture(accountsFilePath);
    writeJson(uiStateFilePath, {});

    const seeded = new AppAuthStore({dbPath, accountsFilePath});
    seeded.updateSteamWalletBalance("selenomorphology", {
      balance: "¥ 88.00",
      source: "steam_store",
      currency: "CNY",
      observedAt: oldObservedAt
    });
    seeded.close();

    const createServer = loadCreateServer({
      wallet: {
        hasWallet: false
      }
    });
    const server = createServer({
      licenseRuntimeFactory: () => createReadyLicenseRuntime()
    });

    try {
      const address = await listen(server);
      const profileResponse = await requestJson({
        port: address.port,
        route: "/api/accounts/profile?username=selenomorphology"
      });
      assert.equal(profileResponse.statusCode, 200);
      assert.equal(profileResponse.body.ok, true);
      assert.notEqual(profileResponse.body.profile.wallet_source, "steam_store");
      assert.equal(profileResponse.body.profile.wallet_balance, "");

      const row = readSteamAccountRow({dbPath, accountsFilePath, username: "selenomorphology"});
      assert.equal(row.balance, "¥ 88.00");
      assert.equal(row.balance_source, "steam_store");
      assert.equal(row.balance_currency, "CNY");
      assert.equal(row.balance_observed_at, oldObservedAt);
    } finally {
      await closeServer(server);
      delete require.cache[require.resolve("../src/uiServer")];
    }
  } finally {
    configureRuntimePaths({
      projectRoot: originalPaths.ROOT_DIR,
      userDataDir: originalPaths.WRITABLE_ROOT,
      isPackaged: false
    });
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

async function main() {
  await testAccountProfileRouteUsesAccountViewerScopeConsistently();
  await testAccountProfileRoutePersistsSteamCmWalletMetadata();
  await testAccountProfileRouteDoesNotFallbackToStoredStoreWalletWhenCmUnavailable();
  console.log("account-profile-route scope tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
