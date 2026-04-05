const assert = require("node:assert/strict");
const http = require("node:http");
const Module = require("node:module");
const {FEATURE_CODES} = require("../../shared/licensePolicy");

const originalLoad = Module._load;
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
  return originalLoad(request, parent, isMain);
};

const {createServer} = require("../src/uiServer");
Module._load = originalLoad;

function createReadyLicenseRuntime() {
  const state = {
    ok: true,
    code: "ready",
    user: {
      id: "user_test",
      username: "member_test",
      membership_plan: "pro"
    },
    permissions: Object.values(FEATURE_CODES),
    featureFlags: {
      simulation_enabled: true
    },
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

function requestJson({port, method = "POST", path, body}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? "" : JSON.stringify(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path,
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
          statusCode: res.statusCode,
          body: raw ? JSON.parse(raw) : {}
        });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function createMemoryUiStateStore() {
  const data = {presets: []};
  return {
    getTradeupSimulationPresets() {
      return JSON.parse(JSON.stringify(data.presets));
    },
    setTradeupSimulationPresets(presets) {
      data.presets = Array.isArray(presets) ? JSON.parse(JSON.stringify(presets)) : [];
    }
  };
}

async function test_search_route_returns_catalog_items() {
  const calls = [];
  const server = createServer({
    licenseRuntimeFactory: () => createReadyLicenseRuntime(),
    tradeupSimulationCatalog: {
      searchItems(query) {
        calls.push(query);
        return [{
          markethashname: "AK-47 | Slate (Minimal Wear)",
          collection_lowest_rarity: "受限",
          is_collection_lowest_rarity: true
        }];
      }
    }
  });

  try {
    const address = await listen(server);
    const response = await requestJson({
      port: address.port,
      method: "GET",
      path: "/api/simulation/tradeup/search-items?q=slate"
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.items.length, 1);
    assert.equal(response.body.items[0].collection_lowest_rarity, "受限");
    assert.equal(response.body.items[0].is_collection_lowest_rarity, true);
    assert.deepEqual(calls, ["slate"]);
  } finally {
    await closeServer(server);
  }
}

async function test_item_route_returns_catalog_item_details() {
  const calls = [];
  const server = createServer({
    licenseRuntimeFactory: () => createReadyLicenseRuntime(),
    tradeupSimulationCatalog: {
      searchItems() {
        return [];
      },
      getItemByMarketHashName(markethashname) {
        calls.push(markethashname);
        return {
          markethashname,
          collection_lowest_rarity: "工业级",
          is_collection_lowest_rarity: true
        };
      }
    }
  });

  try {
    const address = await listen(server);
    const response = await requestJson({
      port: address.port,
      method: "GET",
      path: "/api/simulation/tradeup/item?markethashname=XM1014%20%7C%20%E8%B7%91%E8%B7%91%E8%B7%91%20(Factory%20New)"
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.item.collection_lowest_rarity, "工业级");
    assert.equal(response.body.item.is_collection_lowest_rarity, true);
    assert.deepEqual(calls, ["XM1014 | 跑跑跑 (Factory New)"]);
  } finally {
    await closeServer(server);
  }
}

async function test_resolve_route_returns_bad_request_for_invalid_payload() {
  const server = createServer({
    licenseRuntimeFactory: () => createReadyLicenseRuntime(),
    tradeupSimulationService: {
      resolve(payload) {
        return {
          ok: false,
          invalid_reason: "invalid_driver_absolute_wear",
          message: "驱动绝对磨损越界",
          payload
        };
      }
    }
  });

  try {
    const address = await listen(server);
    const response = await requestJson({
      port: address.port,
      path: "/api/simulation/tradeup/resolve",
      body: {
        target_item: {markethashname: "AK-47 | Slate (Minimal Wear)"},
        active_driver_abs_wear: 2
      }
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.invalid_reason, "invalid_driver_absolute_wear");
  } finally {
    await closeServer(server);
  }
}

async function test_tradeup_simulation_preset_routes_roundtrip() {
  const uiStateStore = createMemoryUiStateStore();
  const server = createServer({
    licenseRuntimeFactory: () => createReadyLicenseRuntime(),
    uiStateStoreFactory() {
      return uiStateStore;
    }
  });

  try {
    const address = await listen(server);

    let response = await requestJson({
      port: address.port,
      method: "GET",
      path: "/api/ui-state/tradeup-simulation-presets"
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.presets, []);

    response = await requestJson({
      port: address.port,
      path: "/api/ui-state/tradeup-simulation-presets",
      body: {
        presets: [{id: "preset_1", name: "Snakebite Slate"}]
      }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.presets.length, 1);
    assert.equal(response.body.presets[0].name, "Snakebite Slate");
  } finally {
    await closeServer(server);
  }
}

async function main() {
  await test_search_route_returns_catalog_items();
  await test_item_route_returns_catalog_item_details();
  await test_resolve_route_returns_bad_request_for_invalid_payload();
  await test_tradeup_simulation_preset_routes_roundtrip();
  console.log("tradeup-simulation-route tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
