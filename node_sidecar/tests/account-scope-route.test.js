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
  return fs.mkdtempSync(path.join(os.tmpdir(), "account-scope-route-"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function createLicenseRuntime({username, permissions}) {
  const state = {
    ok: true,
    code: "ready",
    user: {
      id: `user_${username}`,
      username,
      membership_plan: "pro"
    },
    permissions: Array.isArray(permissions) ? permissions.slice() : [],
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

function createExternalCallTracker() {
  return {
    sendTradeOffer: [],
    confirmTradeOffer: [],
    acceptTradeOffer: [],
    cancelTradeOffer: [],
    sellItem: [],
    getMarketConfirmations: [],
    confirmMarketListings: [],
    checkBansBatch: [],
    checkBanSingle: [],
    fetchBalance: [],
    fetchBalanceResult: {success: true, balance: "12.34"},
    fetchTradeUrl: [],
    refreshWebCookie: [],
    refreshWebCookieFromToken: []
  };
}

function loadCreateServer({calls = createExternalCallTracker()} = {}) {
  const uiServerPath = require.resolve("../src/uiServer");
  const uiServerSourcePath = path.join(__dirname, "..", "src", "uiServer.js");
  const originalLoad = Module._load;
  delete require.cache[uiServerPath];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (parent && parent.filename === uiServerSourcePath && request === "./steamWebSession") {
      return {
        async refreshWebCookie(maData) {
          calls.refreshWebCookie.push({maData});
          return {
            cookieString: "sessionid=session-test; steamLoginSecure=secure-test",
            sessionid: "session-test",
            steamId64: String(maData && maData.steamId64 || "76561198000000001"),
            accessToken: "access-token-test"
          };
        },
        async refreshWebCookieFromToken(refreshToken, steamId64) {
          calls.refreshWebCookieFromToken.push({refreshToken, steamId64});
          return {
            cookieString: "sessionid=session-test; steamLoginSecure=secure-test",
            sessionid: "session-test",
            steamId64: String(steamId64 || "76561198000000001"),
            accessToken: "access-token-test"
          };
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./tradeService") {
      return {
        parseTradeUrl() {
          return {
            partnerId: "123456",
            tradeToken: "trade-token-test"
          };
        },
        async sendTradeOffer(args) {
          calls.sendTradeOffer.push({...args});
          return {tradeofferid: "offer-test-1"};
        },
        async confirmTradeOffer(args) {
          calls.confirmTradeOffer.push({...args});
          return true;
        },
        async acceptTradeOffer(args) {
          calls.acceptTradeOffer.push({...args});
          return {ok: true};
        },
        async cancelTradeOffer(args) {
          calls.cancelTradeOffer.push({...args});
          return {ok: true};
        },
        steamId64ToAccountId(steamId64) {
          return String(steamId64 || "");
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./steamMarketService") {
      return {
        async sellItem(args) {
          calls.sellItem.push({...args});
          return {success: true};
        },
        async getPriceOverview() {
          return {success: true};
        },
        calculateBuyerPrice(value) {
          return Number(value) || 0;
        },
        calculateSellerPrice(value) {
          return Number(value) || 0;
        },
        async getMarketConfirmations(args) {
          calls.getMarketConfirmations.push({...args});
          return [];
        },
        async confirmMarketListings(args) {
          calls.confirmMarketListings.push({...args});
          return {
            results: (Array.isArray(args.confirmationIds) ? args.confirmationIds : []).map((id) => ({
              id,
              ok: true
            }))
          };
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./steamAccountTools") {
      return {
        async checkBansBatch(steamIds, apiKey) {
          calls.checkBansBatch.push({steamIds: steamIds.slice(), apiKey});
          return new Map(steamIds.map((steamId) => [steamId, {NumberOfVACBans: 0, CommunityBanned: false}]));
        },
        async checkBanSingle(args) {
          calls.checkBanSingle.push({...args});
          return {NumberOfVACBans: 0, CommunityBanned: false};
        },
        formatBanStatus() {
          return "正常";
        },
        async fetchBalance(args) {
          calls.fetchBalance.push({...args});
          const result = typeof calls.fetchBalanceResult === "function"
            ? await calls.fetchBalanceResult(args)
            : calls.fetchBalanceResult;
          return {...result};
        },
        async fetchTradeUrl(args) {
          calls.fetchTradeUrl.push({...args});
          return {success: true, tradeUrl: "https://steamcommunity.com/tradeoffer/new/?partner=1&token=test"};
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./steamApiKeyStore") {
      return {
        getSteamApiKey() {
          return "steam-api-key-test";
        },
        setSteamApiKey() {}
      };
    }
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

function parseSseEvents(raw) {
  return String(raw || "")
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const eventLine = block.split(/\r?\n/).find((line) => line.startsWith("event:"));
      const dataLine = block.split(/\r?\n/).find((line) => line.startsWith("data:"));
      let data = {};
      if (dataLine) {
        data = JSON.parse(dataLine.slice("data:".length).trim());
      }
      return {
        event: eventLine ? eventLine.slice("event:".length).trim() : "",
        data
      };
    });
}

function requestSse({port, route, method = "GET", body = null}) {
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
          raw,
          events: parseSseEvents(raw)
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

function seedAuthStore({dbPath, accountsFilePath}) {
  const store = new AppAuthStore({dbPath, accountsFilePath});
  try {
    store.upsertSteamAccount({
      username: "countsteam01",
      password: "SecretA",
      remark: "primary",
      steam_id: "76561198000000001",
      steam_id64: "76561198000000001",
      mafile_content: JSON.stringify({
        shared_secret: "shared-secret-test",
        identity_secret: "identity-secret-test",
        Session: {
          SteamID: "76561198000000001",
          SteamLoginSecure: "76561198000000001%7C%7Crefresh-token-1"
        },
        access_token: "access-token-1"
      })
    }, {viewerUsername: "", setActive: true});
    store.upsertSteamAccount({
      username: "countsteam02",
      password: "SecretB",
      remark: "secondary",
      steam_id: "76561198000000002",
      steam_id64: "76561198000000002",
      mafile_content: JSON.stringify({
        shared_secret: "shared-secret-test",
        identity_secret: "identity-secret-test",
        Session: {
          SteamID: "76561198000000002",
          SteamLoginSecure: "76561198000000002%7C%7Crefresh-token-2"
        },
        access_token: "access-token-2"
      })
    }, {viewerUsername: "", setActive: false});
    store.bootstrapAdmin({password: "Admin!234"});
    store.createUser({
      username: "member_a",
      password: "Member!234",
      roleCodes: ["member"],
      boundSteamUsernames: ["countsteam01"]
    });
    store.createUser({
      username: "member_b",
      password: "Member!234",
      roleCodes: ["member"],
      boundSteamUsernames: ["countsteam02"]
    });
  } finally {
    store.close();
  }
}

async function withScopedServer({username, permissions}, run) {
  const tempDir = makeTempDir();
  const originalPaths = {...PATHS};
  const dbPath = path.join(tempDir, "csgo_skins.db");
  const accountsFilePath = path.join(tempDir, "accounts.json");
  const calls = createExternalCallTracker();
  try {
    configureRuntimePaths({
      projectRoot: tempDir,
      userDataDir: tempDir,
      isPackaged: false
    });
    writeJson(accountsFilePath, {
      accounts: {
        countsteam01: {
          password: "SecretA",
          remark: "primary",
          steam_id: "76561198000000001",
          steam_id64: "76561198000000001",
          mafile_content: JSON.stringify({
            shared_secret: "shared-secret-test",
            identity_secret: "identity-secret-test",
            Session: {
              SteamID: "76561198000000001",
              SteamLoginSecure: "76561198000000001%7C%7Crefresh-token-1"
            },
            access_token: "access-token-1"
          })
        },
        countsteam02: {
          password: "SecretB",
          remark: "secondary",
          steam_id: "76561198000000002",
          steam_id64: "76561198000000002",
          mafile_content: JSON.stringify({
            shared_secret: "shared-secret-test",
            identity_secret: "identity-secret-test",
            Session: {
              SteamID: "76561198000000002",
              SteamLoginSecure: "76561198000000002%7C%7Crefresh-token-2"
            },
            access_token: "access-token-2"
          })
        }
      },
      active: "countsteam01"
    });
    writeJson(path.join(tempDir, "inventory_ui_state.json"), {});
    seedAuthStore({dbPath, accountsFilePath});

    const createServer = loadCreateServer({calls});
    const server = createServer({
      licenseRuntimeFactory: () => createLicenseRuntime({username, permissions}),
      licenseConfigFactory: () => ({authMode: "debug_bundle"})
    });
    try {
      const address = await listen(server);
      await run({port: address.port, calls, dbPath, accountsFilePath});
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

function accountReadPermissions() {
  return [
    FEATURE_CODES.ACCOUNTS_READ,
    FEATURE_CODES.ACCOUNTS_WRITE,
    FEATURE_CODES.INVENTORY_READ,
    FEATURE_CODES.INVENTORY_REFRESH,
    FEATURE_CODES.CRAFT_USE,
    FEATURE_CODES.SIMULATION_USE
  ];
}

async function test_bound_user_only_lists_bound_steam_accounts() {
  await withScopedServer({
    username: "member_a",
    permissions: accountReadPermissions()
  }, async ({port}) => {
    const response = await requestJson({
      port,
      route: "/api/accounts"
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      response.body.accounts.map((row) => row.username),
      ["countsteam01"]
    );
  });
}

async function test_unbound_user_cannot_select_wrong_steam_account() {
  await withScopedServer({
    username: "member_a",
    permissions: accountReadPermissions()
  }, async ({port}) => {
    const response = await requestJson({
      port,
      method: "POST",
      route: "/api/ui-state/last-selected",
      body: {
        username: "countsteam02"
      }
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.reason, "account_scope_denied");
  });
}

async function test_trade_routes_stop_before_external_calls_for_unbound_account() {
  await withScopedServer({
    username: "member_a",
    permissions: accountReadPermissions()
  }, async ({port, calls}) => {
    const sendResponse = await requestSse({
      port,
      method: "POST",
      route: "/api/accounts/send-trade-offer",
      body: {
        fromUsername: "countsteam02",
        toTradeUrl: "https://steamcommunity.com/tradeoffer/new/?partner=123456&token=test",
        assetIds: ["asset-1"]
      }
    });
    assert.equal(sendResponse.statusCode, 200);
    assert.equal(sendResponse.events[0].event, "error");
    assert.equal(sendResponse.events[0].data.message, "发送方账号不存在");

    const acceptResponse = await requestJson({
      port,
      method: "POST",
      route: "/api/accounts/accept-offers",
      body: {
        username: "countsteam02",
        tradeofferIds: ["offer-1"]
      }
    });
    assert.equal(acceptResponse.statusCode, 400);
    assert.equal(acceptResponse.body.message, "账号不存在");

    const cancelResponse = await requestJson({
      port,
      method: "POST",
      route: "/api/accounts/cancel-sent-offers",
      body: {
        username: "countsteam02",
        tradeofferIds: ["offer-1"]
      }
    });
    assert.equal(cancelResponse.statusCode, 400);
    assert.equal(cancelResponse.body.message, "账号不存在");

    assert.equal(calls.refreshWebCookie.length, 0);
    assert.equal(calls.sendTradeOffer.length, 0);
    assert.equal(calls.acceptTradeOffer.length, 0);
    assert.equal(calls.cancelTradeOffer.length, 0);
    assert.equal(calls.confirmTradeOffer.length, 0);
  });
}

async function test_market_routes_stop_before_external_calls_for_unbound_account() {
  await withScopedServer({
    username: "member_a",
    permissions: accountReadPermissions()
  }, async ({port, calls}) => {
    const sellResponse = await requestJson({
      port,
      method: "POST",
      route: "/api/market/batch-sell",
      body: {
        username: "countsteam02",
        items: [
          {
            assetId: "asset-2",
            priceInCents: 123,
            currency: 23
          }
        ]
      }
    });
    assert.equal(sellResponse.statusCode, 404);
    assert.equal(sellResponse.body.message, "账号不存在");

    const confirmationsResponse = await requestJson({
      port,
      method: "POST",
      route: "/api/market/confirmations",
      body: {
        username: "countsteam02"
      }
    });
    assert.equal(confirmationsResponse.statusCode, 404);
    assert.equal(confirmationsResponse.body.message, "账号不存在");

    const confirmListingsResponse = await requestJson({
      port,
      method: "POST",
      route: "/api/market/confirm-listings",
      body: {
        username: "countsteam02",
        confirmationIds: ["conf-1"]
      }
    });
    assert.equal(confirmListingsResponse.statusCode, 404);
    assert.equal(confirmListingsResponse.body.message, "账号不存在");

    assert.equal(calls.refreshWebCookie.length, 0);
    assert.equal(calls.sellItem.length, 0);
    assert.equal(calls.getMarketConfirmations.length, 0);
    assert.equal(calls.confirmMarketListings.length, 0);
  });
}

async function test_fetch_balance_persists_steam_store_source_metadata() {
  await withScopedServer({
    username: "member_a",
    permissions: accountReadPermissions()
  }, async ({port, calls, dbPath, accountsFilePath}) => {
    calls.fetchBalanceResult = {
      success: true,
      balance: "¥ 12.34",
      currency: "CNY",
      source: "upstream_fake",
      observed_at: "2026-06-06T10:00:00.000Z"
    };

    const response = await requestJson({
      port,
      method: "POST",
      route: "/api/accounts/fetch-balance",
      body: {
        usernames: ["countsteam01"]
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.results.length, 1);
    const result = response.body.results[0];
    assert.equal(result.username, "countsteam01");
    assert.equal(result.success, true);
    assert.equal(result.balance, "¥ 12.34");
    assert.equal(result.source, "steam_store");
    assert.equal(result.persisted, true);
    assert.equal(result.currency, "CNY");
    assert.equal(typeof result.observed_at, "string");
    assert.ok(result.observed_at.length > 0);

    const store = new AppAuthStore({dbPath, accountsFilePath, readOnly: true, initialize: false});
    try {
      const account = store.getSteamAccountForUser("member_a", "countsteam01");
      assert.equal(account.balance, "¥ 12.34");
      assert.equal(account.balance_source, "steam_store");
      assert.equal(account.balance_currency, "CNY");
      assert.equal(typeof account.balance_observed_at, "string");
      assert.ok(account.balance_observed_at.length > 0);
    } finally {
      store.close();
    }
  });
}

async function test_fetch_balance_failure_does_not_fall_back_to_steam_cm_balance() {
  await withScopedServer({
    username: "member_a",
    permissions: accountReadPermissions()
  }, async ({port, calls, dbPath, accountsFilePath}) => {
    const seedStore = new AppAuthStore({dbPath, accountsFilePath});
    try {
      seedStore.updateSteamWalletBalance("countsteam01", {
        balance: "¥ 99.00",
        source: "steam_cm",
        currency: "CNY",
        observedAt: "2026-06-06T11:00:00.000Z"
      });
    } finally {
      seedStore.close();
    }
    calls.fetchBalanceResult = {
      success: false,
      balance: null,
      currency: null,
      message: "store unavailable",
      source: "upstream_fake",
      observed_at: "2026-06-06T10:00:00.000Z"
    };

    const response = await requestJson({
      port,
      method: "POST",
      route: "/api/accounts/fetch-balance",
      body: {
        usernames: ["countsteam01"]
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.results.length, 1);
    const result = response.body.results[0];
    assert.equal(result.username, "countsteam01");
    assert.equal(result.success, false);
    assert.notEqual(result.balance, "¥ 99.00");
    assert.equal(Object.prototype.hasOwnProperty.call(result, "source"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result, "observed_at"), false);

    const readStore = new AppAuthStore({dbPath, accountsFilePath, readOnly: true, initialize: false});
    try {
      const account = readStore.getSteamAccountForUser("member_a", "countsteam01");
      assert.equal(account.balance, "¥ 99.00");
      assert.equal(account.balance_source, "steam_cm");
      assert.equal(account.balance_currency, "CNY");
      assert.equal(account.balance_observed_at, "2026-06-06T11:00:00.000Z");
    } finally {
      readStore.close();
    }
  });
}

async function test_fetch_balance_reports_unpersisted_source_metadata_when_local_persist_fails() {
  await withScopedServer({
    username: "member_a",
    permissions: accountReadPermissions()
  }, async ({port, calls, dbPath, accountsFilePath}) => {
    const seedStore = new AppAuthStore({dbPath, accountsFilePath});
    try {
      seedStore.updateSteamWalletBalance("countsteam01", {
        balance: "¥ 99.00",
        source: "steam_cm",
        currency: "CNY",
        observedAt: "2026-06-06T11:00:00.000Z"
      });
    } finally {
      seedStore.close();
    }

    calls.fetchBalanceResult = {
      success: true,
      balance: "¥ 12.34",
      currency: "CNY",
      source: "upstream_fake",
      observed_at: "2026-06-06T10:00:00.000Z"
    };
    const originalUpdateSteamWalletBalance = AppAuthStore.prototype.updateSteamWalletBalance;
    const originalClose = AppAuthStore.prototype.close;
    let balancePersistStoreCloseCount = 0;
    let balancePersistStore = null;
    AppAuthStore.prototype.updateSteamWalletBalance = function failBalancePersist() {
      balancePersistStore = this;
      throw new Error("simulated balance persist failure");
    };
    AppAuthStore.prototype.close = function countClose() {
      if (this === balancePersistStore) {
        balancePersistStoreCloseCount += 1;
      }
      return originalClose.apply(this, arguments);
    };

    try {
      const response = await requestJson({
        port,
        method: "POST",
        route: "/api/accounts/fetch-balance",
        body: {
          usernames: ["countsteam01"]
        }
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.results.length, 1);
      const result = response.body.results[0];
      assert.equal(result.username, "countsteam01");
      assert.equal(result.success, true);
      assert.equal(result.balance, "¥ 12.34");
      assert.equal(result.currency, "CNY");
      assert.equal(result.persisted, false);
      assert.match(result.persist_error, /simulated balance persist failure/);
      assert.equal(Object.prototype.hasOwnProperty.call(result, "source"), false);
      assert.equal(Object.prototype.hasOwnProperty.call(result, "observed_at"), false);
      assert.equal(balancePersistStoreCloseCount, 1);
    } finally {
      AppAuthStore.prototype.updateSteamWalletBalance = originalUpdateSteamWalletBalance;
      AppAuthStore.prototype.close = originalClose;
      if (balancePersistStore && balancePersistStoreCloseCount === 0) {
        originalClose.call(balancePersistStore);
      }
    }

    const readStore = new AppAuthStore({dbPath, accountsFilePath, readOnly: true, initialize: false});
    try {
      const account = readStore.getSteamAccountForUser("member_a", "countsteam01");
      assert.equal(account.balance, "¥ 99.00");
      assert.equal(account.balance_source, "steam_cm");
      assert.equal(account.balance_currency, "CNY");
      assert.equal(account.balance_observed_at, "2026-06-06T11:00:00.000Z");
    } finally {
      readStore.close();
    }
  });
}

async function test_account_tool_routes_skip_unbound_accounts_before_steam_calls() {
  await withScopedServer({
    username: "member_a",
    permissions: accountReadPermissions()
  }, async ({port, calls}) => {
    const bansResponse = await requestJson({
      port,
      method: "POST",
      route: "/api/accounts/check-bans",
      body: {
        usernames: ["countsteam01", "countsteam02"]
      }
    });
    assert.equal(bansResponse.statusCode, 200);
    assert.deepEqual(
      bansResponse.body.results.map((row) => row.username),
      ["countsteam01"]
    );
    assert.equal(calls.checkBansBatch.length, 1);
    assert.deepEqual(calls.checkBansBatch[0].steamIds, ["76561198000000001"]);

    const balanceResponse = await requestJson({
      port,
      method: "POST",
      route: "/api/accounts/fetch-balance",
      body: {
        usernames: ["countsteam01", "countsteam02"]
      }
    });
    assert.equal(balanceResponse.statusCode, 200);
    assert.deepEqual(
      balanceResponse.body.results.map((row) => ({username: row.username, success: row.success})),
      [
        {username: "countsteam01", success: true},
        {username: "countsteam02", success: false}
      ]
    );
    assert.equal(calls.fetchBalance.length, 1);
    assert.equal(calls.refreshWebCookie.length, 1);

    const tradeUrlResponse = await requestSse({
      port,
      method: "POST",
      route: "/api/accounts/refresh-trade-url",
      body: {
        usernames: ["countsteam01", "countsteam02"]
      }
    });
    assert.equal(tradeUrlResponse.statusCode, 200);
    const urlResults = tradeUrlResponse.events.filter((event) => event.event === "url-result");
    assert.deepEqual(
      urlResults.map((event) => ({username: event.data.username, success: event.data.success})),
      [
        {username: "countsteam01", success: true},
        {username: "countsteam02", success: false}
      ]
    );
    assert.equal(calls.fetchTradeUrl.length, 1);
    assert.equal(calls.refreshWebCookie.length, 2);
  });
}

async function test_super_admin_can_access_unbound_steam_accounts() {
  await withScopedServer({
    username: "admin",
    permissions: []
  }, async ({port}) => {
    const accounts = await requestJson({
      port,
      route: "/api/accounts"
    });
    assert.equal(accounts.statusCode, 200);
    assert.deepEqual(
      accounts.body.accounts.map((row) => row.username),
      ["countsteam01", "countsteam02"]
    );

    const selected = await requestJson({
      port,
      method: "POST",
      route: "/api/ui-state/last-selected",
      body: {
        username: "countsteam02"
      }
    });
    assert.equal(selected.statusCode, 200);
  });
}

async function test_unknown_dev_user_keeps_legacy_single_user_scope() {
  await withScopedServer({
    username: "dev_local",
    permissions: accountReadPermissions()
  }, async ({port}) => {
    const accounts = await requestJson({
      port,
      route: "/api/accounts"
    });
    assert.equal(accounts.statusCode, 200);
    assert.deepEqual(
      accounts.body.accounts.map((row) => row.username),
      ["countsteam01", "countsteam02"]
    );

    const selected = await requestJson({
      port,
      method: "POST",
      route: "/api/ui-state/last-selected",
      body: {
        username: "countsteam02"
      }
    });
    assert.equal(selected.statusCode, 200);

    const snapshots = await requestJson({
      port,
      route: "/api/snapshot/accounts"
    });
    assert.equal(snapshots.statusCode, 200);
    assert.deepEqual(
      snapshots.body.snapshots.map((row) => row.username),
      ["countsteam01", "countsteam02"]
    );
  });
}

async function main() {
  await test_bound_user_only_lists_bound_steam_accounts();
  await test_unbound_user_cannot_select_wrong_steam_account();
  await test_trade_routes_stop_before_external_calls_for_unbound_account();
  await test_market_routes_stop_before_external_calls_for_unbound_account();
  await test_fetch_balance_persists_steam_store_source_metadata();
  await test_fetch_balance_failure_does_not_fall_back_to_steam_cm_balance();
  await test_fetch_balance_reports_unpersisted_source_metadata_when_local_persist_fails();
  await test_account_tool_routes_skip_unbound_accounts_before_steam_calls();
  await test_super_admin_can_access_unbound_steam_accounts();
  await test_unknown_dev_user_keeps_legacy_single_user_scope();
  console.log("account-scope-route tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
