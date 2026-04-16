const assert = require("node:assert/strict");
const http = require("node:http");
const Module = require("node:module");
const path = require("node:path");

const {FEATURE_CODES} = require("../../shared/licensePolicy");

function createLicenseRuntime(permissions = []) {
  const state = {
    ok: true,
    code: "ready",
    user: {
      id: "user_test",
      username: "member_test",
      membership_plan: "pro"
    },
    permissions,
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

function requestJson({port, route, method = "POST", body = null}) {
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

function loadCreateServer({connectedUsernames = [], redeemCalls = [], redeemResponse, inspectCalls = [], inspectResponse} = {}) {
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
            shutdown() {},
            touch() {}
          };
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./services/refreshRuntime") {
      return {
        createRefreshRuntime() {
          const connected = new Set(connectedUsernames.map((value) => String(value).trim()));
          return {
            start() {},
            handleSseRequest() {},
            emitSse() {},
            isConnected(username) {
              return connected.has(String(username || "").trim());
            },
            removeAccount() {}
          };
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./services/componentOpsService") {
      return {
        createComponentOpsService() {
          return {};
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./services/craftService") {
      return {
        createCraftService() {
          return {};
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./services/craftTradeupWithComponentsService") {
      return {
        createCraftTradeupWithComponentsService() {
          return {};
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./services/craftAssistService") {
      return {
        createCraftAssistService() {
          return {};
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./services/weaponArmoryService") {
      return {
        createWeaponArmoryService() {
          return {
            async inspect(args) {
              inspectCalls.push(args);
              return inspectResponse || {
                ok: true,
                account: String(args.username || "").trim(),
                redeemable_balance: 8,
                options: [
                  {
                    campaign_id: 11,
                    redeem_id: 0,
                    expected_cost: 4,
                    generation_time: 1775285012,
                    redeemable_balance: 8,
                    balance_after_redeem: 4,
                    affordable: true
                  }
                ],
                armory_state: {
                  xp_shop_bids: [
                    {campaign_id: 11, redeem_id: 0, expected_cost: 4, generation_time: 1775285012}
                  ]
                }
              };
            },
            async redeem(args) {
              redeemCalls.push(args);
              return redeemResponse || {
                ok: true,
                success: true,
                account: String(args.username || "").trim(),
                resolved: {
                  campaign_id: 11,
                  redeem_id: 0,
                  redeemable_balance: 8,
                  expected_cost: 4,
                  bid_control: 0
                },
                message: "武库奖励兑换成功"
              };
            }
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

async function test_weapon_armory_route_calls_service_and_returns_payload() {
  const redeemCalls = [];
  const createServer = loadCreateServer({
    connectedUsernames: ["x833830262"],
    redeemCalls
  });
  const server = createServer({
    licenseRuntimeFactory: () => createLicenseRuntime([
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.INVENTORY_READ
    ])
  });

  try {
    const address = await listen(server);
    const response = await requestJson({
      port: address.port,
      route: "/api/inventory/redeem-mission-reward",
      body: {
        username: "x833830262",
        ack_tracks: true,
        wait_ms: 2500
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.success, true);
    assert.equal(redeemCalls.length, 1);
    assert.equal(redeemCalls[0].username, "x833830262");
    assert.equal(redeemCalls[0].ackTracks, true);
    assert.equal(redeemCalls[0].waitMs, 2500);
  } finally {
    await closeServer(server);
    delete require.cache[require.resolve("../src/uiServer")];
  }
}

async function test_weapon_armory_route_requires_connected_account() {
  const redeemCalls = [];
  const createServer = loadCreateServer({
    connectedUsernames: [],
    redeemCalls
  });
  const server = createServer({
    licenseRuntimeFactory: () => createLicenseRuntime([
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.INVENTORY_READ
    ])
  });

  try {
    const address = await listen(server);
    const response = await requestJson({
      port: address.port,
      route: "/api/inventory/redeem-mission-reward",
      body: {
        username: "x833830262"
      }
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.ok, false);
    assert.equal(redeemCalls.length, 0);
  } finally {
    await closeServer(server);
    delete require.cache[require.resolve("../src/uiServer")];
  }
}

async function test_weapon_armory_options_route_calls_service_and_returns_payload() {
  const inspectCalls = [];
  const createServer = loadCreateServer({
    connectedUsernames: ["x833830262"],
    inspectCalls
  });
  const server = createServer({
    licenseRuntimeFactory: () => createLicenseRuntime([
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.INVENTORY_READ
    ])
  });

  try {
    const address = await listen(server);
    const response = await requestJson({
      port: address.port,
      method: "GET",
      route: "/api/inventory/redeem-mission-reward/options?username=x833830262"
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.account, "x833830262");
    assert.equal(response.body.redeemable_balance, 8);
    assert.equal(Array.isArray(response.body.options), true);
    assert.equal(response.body.options.length, 1);
    assert.equal(inspectCalls.length, 1);
    assert.equal(inspectCalls[0].username, "x833830262");
  } finally {
    await closeServer(server);
    delete require.cache[require.resolve("../src/uiServer")];
  }
}

async function main() {
  await test_weapon_armory_options_route_calls_service_and_returns_payload();
  await test_weapon_armory_route_calls_service_and_returns_payload();
  await test_weapon_armory_route_requires_connected_account();
  console.log("weapon-armory-route tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
