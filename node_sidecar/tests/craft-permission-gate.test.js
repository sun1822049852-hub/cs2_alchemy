const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const crypto = require("node:crypto");

const {FEATURE_CODES} = require("../../shared/licensePolicy");
const {hashCraftPermitPayload} = require("../../shared/craftPermitPolicy");
const {stableJsonStringify} = require("../../shared/licensePolicy");
const {resolveDeviceId} = require("../src/deviceIdentity");

function createLicenseRuntime(permissions, {refreshCredential = ""} = {}) {
  const state = {
    ok: true,
    code: "ready",
    user: {
      id: "user_test",
      username: "member_test",
      membership_plan: "free"
    },
    permissions: Array.isArray(permissions) ? permissions.slice() : [],
    featureFlags: {
      simulation_enabled: permissions.includes(FEATURE_CODES.SIMULATION_USE)
    },
    expiresAt: "2099-01-01T00:15:00.000Z",
    expiresInMs: 86400000
  };
  return {
    getState() {
      return state;
    },
    readBundle() {
      return {
        refresh_credential: refreshCredential
      };
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

function requestJson({port, method = "POST", route, body}) {
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
          statusCode: res.statusCode,
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

function writeSnapshot(filePath, items) {
  fs.writeFileSync(filePath, JSON.stringify({
    format: 1,
    generated_at: "test",
    item_count: items.length,
    items
  }, null, 2));
}

function makeRow({id, name, relative, rarity = 4, min = 0, max = 1}) {
  return {
    asset_id: String(id),
    name,
    alchemy_name: name,
    float_value: min + (max - min) * relative,
    minfloat: min,
    maxfloat: max,
    rarity,
    quality: 0,
    quality_name: "Normal",
    is_craftable: true,
    hidden_reason: "",
    casket_id: "",
    tradable_after: 0
  };
}

function loadCreateServer({
  snapshotPath,
  connectedUsernames = [],
  craftCalls = [],
  componentCraftCalls = [],
  craftResponse = {ok: true, recipe_count: 1, rows: [], steps: []},
  componentCraftResponse = {ok: true, recipe_count: 1, ready_recipe_count: 1, skipped_recipe_count: 0, rows: [], steps: []}
}) {
  const uiServerPath = require.resolve("../src/uiServer");
  const uiServerSourcePath = path.join(__dirname, "..", "src", "uiServer.js");
  const originalLoad = Module._load;
  const previousEnv = process.env.CRAFT_ASSIST_USE_WORKER_POOL;
  process.env.CRAFT_ASSIST_USE_WORKER_POOL = "0";
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
    if (parent && parent.filename === uiServerSourcePath && request === "./uiStateStore") {
      return {
        UiStateStore: class FakeUiStateStore {
          getAccount() {
            return {
              snapshot_path: snapshotPath,
              fetch_time: "test-fetch-time"
            };
          }
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./services/craftAssistService") {
      return {
        createCraftAssistService() {
          return {
            async selectForRecipe() {
              return {
                ok: true,
                selected: []
              };
            }
          };
        },
        buildCraftAssistSelectionContextFromCandidateRows(candidateRows, {includeCooling = false} = {}) {
          return {
            includeCooling: !!includeCooling,
            candidateRows: Array.isArray(candidateRows) ? candidateRows.slice() : [],
            rowsByName: new Map(),
            rowsById: new Map(),
            candidateCache: new Map()
          };
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./services/refreshRuntime") {
      return {
        createRefreshRuntime() {
          const connected = new Set(connectedUsernames.map((item) => String(item)));
          return {
            start() {},
            handleSseRequest() {},
            emitSse() {},
            async runRefreshJob() {
              throw new Error("runRefreshJob not implemented in test");
            },
            isConnected(username) {
              return connected.has(String(username || "").trim());
            },
            removeAccount(username) {
              connected.delete(String(username || "").trim());
            }
          };
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./services/craftService") {
      return {
        createCraftService() {
          return {
            async runTradeUp(args) {
              craftCalls.push({kind: "single", ...args});
              return craftResponse;
            },
            async runTradeUpBatch(args) {
              craftCalls.push({kind: "batch", ...args});
              return craftResponse;
            }
          };
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./services/craftTradeupWithComponentsService") {
      return {
        createCraftTradeupWithComponentsService() {
          return {
            async runTradeUpWithComponents(args) {
              componentCraftCalls.push(args);
              return componentCraftResponse;
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
    if (previousEnv === undefined) {
      delete process.env.CRAFT_ASSIST_USE_WORKER_POOL;
    } else {
      process.env.CRAFT_ASSIST_USE_WORKER_POOL = previousEnv;
    }
  }
}

async function withTempDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "craft-permission-gate-"));
  try {
    return await run(dir);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

function getBaselinePermissions() {
  return [
    FEATURE_CODES.ACCOUNTS_READ,
    FEATURE_CODES.ACCOUNTS_WRITE,
    FEATURE_CODES.INVENTORY_READ,
    FEATURE_CODES.INVENTORY_REFRESH,
    FEATURE_CODES.SIMULATION_USE
  ];
}

function signPermit(privateKey, snapshot) {
  return crypto.sign(null, Buffer.from(stableJsonStringify(snapshot)), privateKey).toString("base64");
}

async function test_helper_craft_routes_allow_simulation_permission_without_craft_use() {
  await withTempDir(async (dir) => {
    const snapshotPath = path.join(dir, "snapshot.json");
    writeSnapshot(snapshotPath, [
      makeRow({id: "asset_1", name: "Main (Factory New)", relative: 0.03}),
      makeRow({id: "asset_2", name: "Aux (Minimal Wear)", relative: 0.12})
    ]);

    const createServer = loadCreateServer({snapshotPath});
    const predictorCalls = [];
    const server = createServer({
      licenseRuntimeFactory: () => createLicenseRuntime(getBaselinePermissions()),
      craftOutcomePredictor: {
        predict(payload) {
          predictorCalls.push(payload);
          return {
            ok: true,
            outcomes: [{base_name: "AK-47 | Ice Coaled", probability: 0.3}]
          };
        }
      }
    });

    try {
      const address = await listen(server);

      const assistResponse = await requestJson({
        port: address.port,
        route: "/api/craft/assist-select",
        body: {
          username: "member_test",
          target_wear: "0.12",
          wear_approach_mode: "finite",
          materials: [],
          selected_item_ids: ["asset_1"]
        }
      });
      assert.equal(assistResponse.statusCode, 200);
      assert.equal(assistResponse.body.ok, true);

      const predictPayload = {
        required_count: 10,
        target_relative_wear: 0.42,
        input_rarity: "军规级",
        stattrak: false,
        groups: [{collection: "Fracture Case", count: 3}]
      };
      const predictResponse = await requestJson({
        port: address.port,
        route: "/api/craft/predict-outcomes",
        body: predictPayload
      });
      assert.equal(predictResponse.statusCode, 200);
      assert.equal(predictResponse.body.ok, true);
      assert.deepEqual(predictorCalls, [predictPayload]);

      const candidatesResponse = await requestJson({
        port: address.port,
        route: "/api/craft/candidates",
        body: {
          username: "member_test",
          selected_item_ids: ["asset_1"]
        }
      });
      assert.equal(candidatesResponse.statusCode, 200);
      assert.equal(candidatesResponse.body.ok, true);
      assert.equal(Array.isArray(candidatesResponse.body.rows), true);
      assert.equal(candidatesResponse.body.rows.length > 0, true);
    } finally {
      await closeServer(server);
      delete require.cache[require.resolve("../src/uiServer")];
    }
  });
}

async function test_real_craft_execution_routes_still_require_craft_use() {
  const createServer = loadCreateServer({snapshotPath: path.join(os.tmpdir(), "unused-snapshot.json")});
  const server = createServer({
    licenseRuntimeFactory: () => createLicenseRuntime(getBaselinePermissions())
  });

  try {
    const address = await listen(server);

    const tradeupResponse = await requestJson({
      port: address.port,
      route: "/api/craft/tradeup",
      body: {}
    });
    assert.equal(tradeupResponse.statusCode, 403);
    assert.equal(tradeupResponse.body.reason, "permission_denied");

    const batchResponse = await requestJson({
      port: address.port,
      route: "/api/craft/tradeup-with-components",
      body: {}
    });
    assert.equal(batchResponse.statusCode, 403);
    assert.equal(batchResponse.body.reason, "permission_denied");
  } finally {
    await closeServer(server);
    delete require.cache[require.resolve("../src/uiServer")];
  }
}

async function test_real_craft_execution_routes_require_remote_permit_in_prod_login() {
  await withTempDir(async (dir) => {
    const machineIdFile = path.join(dir, "machine-id.bin");
    fs.writeFileSync(machineIdFile, "device-alpha");
    const deviceId = resolveDeviceId(machineIdFile);
    const publicKeyFile = path.join(dir, "craft-permit-public.pem");
    const permitCalls = [];
    const craftCalls = [];
    const componentCraftCalls = [];
    const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
    fs.writeFileSync(publicKeyFile, publicKey.export({type: "spki", format: "pem"}));

    const createServer = loadCreateServer({
      snapshotPath: path.join(dir, "unused-snapshot.json"),
      connectedUsernames: ["member_test"],
      craftCalls,
      componentCraftCalls
    });
    const server = createServer({
      licenseConfigFactory: () => ({
        defaultAuthMode: "prod_login",
        publicKeyFile,
        machineIdFile
      }),
      licenseRuntimeFactory: () => createLicenseRuntime([
        ...getBaselinePermissions(),
        FEATURE_CODES.CRAFT_USE
      ], {
        refreshCredential: "refresh_token_1"
      }),
      controlPlaneAuthClientFactory: () => ({
        getCapabilities() {
          return {configured: true, baseUrl: "https://auth.example.com"};
        },
        async issueCraftPermit(args = {}) {
          permitCalls.push({...args});
          const snapshot = {
            sub: "user_test",
            username: "member_test",
            device_id: deviceId,
            action: String(args.action || "").trim(),
            account_username: String(args.accountUsername || "").trim(),
            payload_hash: String(args.payloadHash || "").trim(),
            jti: `permit_${permitCalls.length}`,
            iat: "2026-04-07T03:00:00.000Z",
            exp: "2099-01-01T00:00:30.000Z"
          };
          return {
            permit: {
              snapshot,
              signature: signPermit(privateKey, snapshot)
            }
          };
        }
      })
    });

    try {
      const address = await listen(server);

      const tradeupBody = {
        username: "member_test",
        password: "secret_1",
        allow_cooling: true,
        item_ids: ["asset_1", "asset_2"]
      };
      const tradeupResponse = await requestJson({
        port: address.port,
        route: "/api/craft/tradeup",
        body: tradeupBody
      });
      assert.equal(tradeupResponse.statusCode, 200);
      assert.equal(tradeupResponse.body.ok, true);

      const componentBody = {
        username: "member_test",
        password: "secret_2",
        allow_cooling: false,
        prepare_only: true,
        recipes: [
          {
            target_item: "AK-47 | Ice Coaled",
            item_ids: ["asset_3", "asset_4"]
          }
        ]
      };
      const componentResponse = await requestJson({
        port: address.port,
        route: "/api/craft/tradeup-with-components",
        body: componentBody
      });
      assert.equal(componentResponse.statusCode, 200);
      assert.equal(componentResponse.body.ok, true);

      assert.equal(permitCalls.length, 2);
      assert.deepEqual(permitCalls[0], {
        refreshCredential: "refresh_token_1",
        deviceId,
        action: "craft.tradeup.execute",
        accountUsername: "member_test",
        payloadHash: hashCraftPermitPayload("craft.tradeup.execute", tradeupBody)
      });
      assert.deepEqual(permitCalls[1], {
        refreshCredential: "refresh_token_1",
        deviceId,
        action: "craft.tradeup.with_components.execute",
        accountUsername: "member_test",
        payloadHash: hashCraftPermitPayload("craft.tradeup.with_components.execute", componentBody)
      });
      assert.equal(craftCalls.length, 1);
      assert.equal(componentCraftCalls.length, 1);
    } finally {
      await closeServer(server);
      delete require.cache[require.resolve("../src/uiServer")];
    }
  });
}

async function test_real_craft_execution_routes_fail_when_remote_permit_is_unavailable() {
  await withTempDir(async (dir) => {
    const machineIdFile = path.join(dir, "machine-id.bin");
    fs.writeFileSync(machineIdFile, "device-alpha");
    const craftCalls = [];
    const createServer = loadCreateServer({
      snapshotPath: path.join(dir, "unused-snapshot.json"),
      connectedUsernames: ["member_test"],
      craftCalls
    });
    const server = createServer({
      licenseConfigFactory: () => ({
        defaultAuthMode: "prod_login",
        machineIdFile
      }),
      licenseRuntimeFactory: () => createLicenseRuntime([
        ...getBaselinePermissions(),
        FEATURE_CODES.CRAFT_USE
      ], {
        refreshCredential: "refresh_token_1"
      }),
      controlPlaneAuthClientFactory: () => ({
        getCapabilities() {
          return {configured: true, baseUrl: "https://auth.example.com"};
        },
        async issueCraftPermit() {
          const error = new Error("认证服务不可用");
          error.code = "craft_auth_unavailable";
          error.status = 503;
          throw error;
        }
      })
    });

    try {
      const address = await listen(server);
      const tradeupResponse = await requestJson({
        port: address.port,
        route: "/api/craft/tradeup",
        body: {
          username: "member_test",
          password: "secret_1",
          item_ids: ["asset_1"]
        }
      });
      assert.equal(tradeupResponse.statusCode, 503);
      assert.equal(tradeupResponse.body.reason, "craft_auth_unavailable");
      assert.equal(craftCalls.length, 0);
    } finally {
      await closeServer(server);
      delete require.cache[require.resolve("../src/uiServer")];
    }
  });
}

async function main() {
  await test_helper_craft_routes_allow_simulation_permission_without_craft_use();
  await test_real_craft_execution_routes_still_require_craft_use();
  await test_real_craft_execution_routes_require_remote_permit_in_prod_login();
  await test_real_craft_execution_routes_fail_when_remote_permit_is_unavailable();
  console.log("craft-permission-gate tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
