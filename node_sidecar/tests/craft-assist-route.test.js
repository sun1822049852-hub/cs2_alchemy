const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const {FEATURE_CODES} = require("../../shared/licensePolicy");
const {buildCraftCandidateContext} = require("../src/services/craftCandidateService");
const {
  buildCraftAssistCandidateCacheKeyTuple,
  normalizeCraftAssistMaterialListCanonical,
  projectCraftAssistPersistedMaterials,
  projectCraftAssistTraceMaterial
} = require("../ui/craftAssistItemWearShared");

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
    if (payload) req.write(payload);
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

function normalizeIdList(ids) {
  return Array.from(new Set((Array.isArray(ids) ? ids : [])
    .map((value) => String(value == null ? "" : value).trim())
    .filter(Boolean)));
}

function makeRow({
  id,
  name,
  relative,
  rarity = 4,
  min = 0,
  max = 1
}) {
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

function summarizeAssistArgs(args, {snapshotRows = null} = {}) {
  const materials = Array.isArray(args && args.materials) ? args.materials : [];
  const candidateRows = Array.isArray(args && args.candidateRows)
    ? args.candidateRows
    : Array.isArray(args && args.selectionContext && args.selectionContext.candidateRows)
      ? args.selectionContext.candidateRows
      : Array.isArray(snapshotRows)
        ? buildCraftCandidateContext({
            rows: snapshotRows,
            includeComponentItems: !!(args && args.includeComponentItems),
            includeCooling: !!(args && args.includeCooling),
            selectedItemIds: normalizeIdList(args && args.selectedItemIds)
          }).candidateRows
        : [];
  return {
    targetWear: String(args && args.targetWear == null ? "" : args.targetWear),
    wearApproachMode: String(args && args.wearApproachMode || ""),
    blockedIds: normalizeIdList(args && args.blockedIds),
    selectedItemIds: normalizeIdList(args && args.selectedItemIds),
    includeComponentItems: !!(args && args.includeComponentItems),
    includeCooling: !!(args && args.includeCooling),
    wearOffsetPct: Number(args && args.wearOffsetPct),
    enableFastCraftAssist: !!(args && args.enableFastCraftAssist),
    materials: projectCraftAssistPersistedMaterials(materials),
    candidateCacheKeyTuples: materials.map((material) => buildCraftAssistCandidateCacheKeyTuple(material, args && args.targetWear)),
    selectionTraceGroups: materials.map((material) => projectCraftAssistTraceMaterial(material)),
    candidateIds: candidateRows.map((row) => String(row && row.asset_id || "")).filter(Boolean)
  };
}

function loadCreateServerForAssistRoute({snapshotPath, useWorkerPool}) {
  const uiServerPath = require.resolve("../src/uiServer");
  const uiServerSourcePath = path.join(__dirname, "..", "src", "uiServer.js");
  const originalLoad = Module._load;
  const previousEnv = process.env.CRAFT_ASSIST_USE_WORKER_POOL;
  process.env.CRAFT_ASSIST_USE_WORKER_POOL = useWorkerPool ? "1" : "0";
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
            selectForRecipe(args) {
              return Promise.resolve({
                ok: true,
                debug: summarizeAssistArgs(args)
              });
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
    if (parent && parent.filename === uiServerSourcePath && request === "./services/craftAssistWorkerPool") {
      return {
        createCraftAssistWorkerPool() {
          return {
            selectForRecipe(args) {
              const snapshot = JSON.parse(fs.readFileSync(String(args && args.snapshotPath || ""), "utf8"));
              const snapshotRows = Array.isArray(snapshot && snapshot.items) ? snapshot.items : [];
              return Promise.resolve({
                ok: true,
                debug: summarizeAssistArgs(args, {snapshotRows})
              });
            },
            close() {
              return Promise.resolve();
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
    if (previousEnv === undefined) delete process.env.CRAFT_ASSIST_USE_WORKER_POOL;
    else process.env.CRAFT_ASSIST_USE_WORKER_POOL = previousEnv;
  }
}

async function withTempDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "craft-assist-route-"));
  try {
    return await run(dir);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

async function test_assist_select_route_feeds_direct_and_worker_from_same_normalized_request() {
  await withTempDir(async (dir) => {
    const rows = [
      makeRow({id: "m1", name: "Main (Factory New)", relative: 0.03}),
      makeRow({id: "m2", name: "Main (Factory New)", relative: 0.04}),
      makeRow({id: "m3", name: "Main (Factory New)", relative: 0.05}),
      makeRow({id: "a1", name: "Aux A (Minimal Wear)", relative: 0.11}),
      makeRow({id: "a2", name: "Aux A (Minimal Wear)", relative: 0.12}),
      makeRow({id: "a3", name: "Aux A (Minimal Wear)", relative: 0.13}),
      makeRow({id: "a4", name: "Aux A (Minimal Wear)", relative: 0.14}),
      makeRow({id: "a5", name: "Aux B (Field-Tested)", relative: 0.18}),
      makeRow({id: "a6", name: "Aux B (Field-Tested)", relative: 0.19}),
      makeRow({id: "a7", name: "Aux B (Field-Tested)", relative: 0.20}),
      makeRow({id: "a8", name: "Aux B (Field-Tested)", relative: 0.21}),
      makeRow({id: "a9", name: "Aux B (Field-Tested)", relative: 0.22})
    ];
    const snapshotPath = path.join(dir, "snapshot.json");
    writeSnapshot(snapshotPath, rows);

    const body = {
      username: "member_test",
      target_wear: "0.215",
      wear_filter_mode: "relative",
      wear_approach_mode: "infinite",
      materials: [
        {
          id: "legacy-main",
          role: "main",
          count: "2",
          names: ["Main (Factory New)"],
          wear_filter_mode: "absolute",
          wear_min: 0.8,
          wear_max: 0.9
        },
        {
          id: "aux-mixed",
          role: "aux",
          count: 8,
          wear_filter_mode: "absolute",
          wear_min: 0.99,
          wear_max: 1,
          items: [
            {id: "aux-a", name: "Aux A (Minimal Wear)", wear_filter_mode: "relative", wear_min: 0.1, wear_max: 0.2, custom_range: true},
            {id: "aux-b", name: "Aux B (Field-Tested)", wear_filter_mode: "absolute", wear_min: 0.99, wear_max: 1, custom_range: false}
          ]
        }
      ],
      blocked_ids: ["blocked-1"],
      selected_item_ids: ["selected-1", "selected-2"],
      use_component_items: "true",
      include_cooling: true,
      wear_offset_pct: 17,
      enable_fast_craft_assist: 1
    };

    const expectedCandidateRows = buildCraftCandidateContext({
      rows,
      includeComponentItems: true,
      includeCooling: true,
      selectedItemIds: body.selected_item_ids
    }).candidateRows;
    const expectedMaterials = normalizeCraftAssistMaterialListCanonical(body.materials, {
      rows: expectedCandidateRows,
      legacyWearFilterMode: body.wear_filter_mode,
      source: "renormalize"
    });
    const expectedSummary = summarizeAssistArgs({
      targetWear: body.target_wear,
      wearApproachMode: body.wear_approach_mode,
      materials: expectedMaterials,
      blockedIds: body.blocked_ids,
      selectedItemIds: body.selected_item_ids,
      includeComponentItems: true,
      includeCooling: true,
      wearOffsetPct: body.wear_offset_pct,
      enableFastCraftAssist: true,
      candidateRows: expectedCandidateRows
    });

    const directServer = loadCreateServerForAssistRoute({snapshotPath, useWorkerPool: false})({
      licenseRuntimeFactory: () => createReadyLicenseRuntime()
    });
    const workerServer = loadCreateServerForAssistRoute({snapshotPath, useWorkerPool: true})({
      licenseRuntimeFactory: () => createReadyLicenseRuntime()
    });

    try {
      const directAddress = await listen(directServer);
      const workerAddress = await listen(workerServer);
      const directResponse = await requestJson({
        port: directAddress.port,
        route: "/api/craft/assist-select",
        body
      });
      const workerResponse = await requestJson({
        port: workerAddress.port,
        route: "/api/craft/assist-select",
        body
      });

      assert.equal(directResponse.statusCode, 200);
      assert.equal(workerResponse.statusCode, 200);
      assert.deepEqual(directResponse.body.debug, workerResponse.body.debug);
      assert.deepEqual(directResponse.body.debug, expectedSummary);
    } finally {
      await closeServer(directServer);
      await closeServer(workerServer);
      delete require.cache[require.resolve("../src/uiServer")];
    }
  });
}

(async () => {
  await test_assist_select_route_feeds_direct_and_worker_from_same_normalized_request();
  console.log("craft-assist-route tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
