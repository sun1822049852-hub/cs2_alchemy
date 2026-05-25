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

function resolveStubValue(value, ...args) {
  return typeof value === "function" ? value(...args) : value;
}

function createTestError(message, code = "") {
  const err = new Error(String(message || "test error"));
  if (code) {
    err.code = code;
  }
  return err;
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
    targetWearRaw: String(args && args.targetWearRaw == null ? "" : args.targetWearRaw),
    wearApproachMode: String(args && args.wearApproachMode || ""),
    blockedIds: normalizeIdList(args && args.blockedIds),
    selectedItemIds: normalizeIdList(args && args.selectedItemIds),
    includeComponentItems: !!(args && args.includeComponentItems),
    includeCooling: !!(args && args.includeCooling),
    wearOffset: Number(args && args.wearOffset),
    enableFastCraftAssist: !!(args && args.enableFastCraftAssist),
    materials: projectCraftAssistPersistedMaterials(materials),
    candidateCacheKeyTuples: materials.map((material) => buildCraftAssistCandidateCacheKeyTuple(material, args && args.targetWear)),
    selectionTraceGroups: materials.map((material) => projectCraftAssistTraceMaterial(material)),
    candidateIds: candidateRows.map((row) => String(row && row.asset_id || "")).filter(Boolean)
  };
}

function validAssistTargetRaw(raw = "0.21") {
  return String(raw);
}

function validAssistTargetStep(raw = "0.21") {
  return Math.fround(Number(raw));
}

function makeAssistSelectBody(overrides = {}) {
  const raw = Object.prototype.hasOwnProperty.call(overrides, "target_wear_raw")
    ? overrides.target_wear_raw
    : validAssistTargetRaw();
  const step = Object.prototype.hasOwnProperty.call(overrides, "target_wear")
    ? overrides.target_wear
    : validAssistTargetStep(raw);
  return {
    username: "member_test",
    target_wear: step,
    target_wear_raw: raw,
    wear_filter_mode: "relative",
    materials: [{id: "mat-1", role: "main", count: 10, names: ["Main (Factory New)"]}],
    ...overrides
  };
}

function loadCreateServerForAssistRoute({
  snapshotPath,
  useWorkerPool,
  directResult = null,
  directError = null,
  workerResult = null,
  workerError = null
}) {
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
              const rejection = resolveStubValue(directError, args);
              if (rejection) {
                return Promise.reject(rejection);
              }
              const resolved = resolveStubValue(directResult, args);
              if (resolved) {
                return Promise.resolve(resolved);
              }
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
              const rejection = resolveStubValue(workerError, args);
              if (rejection) {
                return Promise.reject(rejection);
              }
              const resolved = resolveStubValue(workerResult, args);
              if (resolved) {
                return Promise.resolve(resolved);
              }
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

async function requestAssistSelectFailure({
  useWorkerPool = false,
  directResult = null,
  directError = null,
  workerResult = null,
  workerError = null,
  bodyOverrides = {}
} = {}) {
  return withTempDir(async (dir) => {
    const snapshotPath = path.join(dir, "snapshot.json");
    writeSnapshot(snapshotPath, [
      makeRow({id: "m1", name: "Main (Factory New)", relative: 0.03})
    ]);
    const server = loadCreateServerForAssistRoute({
      snapshotPath,
      useWorkerPool,
      directResult,
      directError,
      workerResult,
      workerError
    })({
      licenseRuntimeFactory: () => createReadyLicenseRuntime()
    });

    try {
      const address = await listen(server);
      return await requestJson({
        port: address.port,
        route: "/api/craft/assist-select",
        body: {
          ...makeAssistSelectBody(),
          ...bodyOverrides
        }
      });
    } finally {
      await closeServer(server);
      delete require.cache[require.resolve("../src/uiServer")];
    }
  });
}

async function assertAssistSelectFailureMapping({
  label,
  useWorkerPool = false,
  directResult = null,
  directError = null,
  workerError = null,
  bodyOverrides = {},
  expectedStatus = null,
  expectedCode,
  expectedMessage,
  expectedDetail
}) {
  const response = await requestAssistSelectFailure({
    useWorkerPool,
    directResult,
    directError,
    workerError,
    bodyOverrides
  });

  assert.equal(response.body.ok, false, label);
  assert.ok(response.statusCode >= 400, label);
  if (expectedStatus != null) {
    assert.equal(response.statusCode, expectedStatus, label);
  }
  assert.equal(response.body.code, expectedCode, label);
  assert.equal(response.body.message, expectedMessage, label);
  assert.equal(response.body.detail, expectedDetail, label);
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
      target_wear: validAssistTargetStep("0.215"),
      target_wear_raw: "0.215",
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
      wear_offset: 0.00017,
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
      targetWear: validAssistTargetStep("0.215"),
      targetWearRaw: "0.215",
      wearApproachMode: body.wear_approach_mode,
      materials: expectedMaterials,
      blockedIds: body.blocked_ids,
      selectedItemIds: body.selected_item_ids,
      includeComponentItems: true,
      includeCooling: true,
      wearOffset: body.wear_offset,
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

async function test_assist_select_route_normalizes_technical_service_message_to_human_message() {
  await withTempDir(async (dir) => {
    const snapshotPath = path.join(dir, "snapshot.json");
    writeSnapshot(snapshotPath, [
      makeRow({id: "m1", name: "Main (Factory New)", relative: 0.03})
    ]);
    const server = loadCreateServerForAssistRoute({
      snapshotPath,
      useWorkerPool: false,
      directResult: {
        ok: false,
        code: "target_step_invalid",
        message: "目标磨损必须是 [0,1] 内的 exact float32 台阶"
      }
    })({
      licenseRuntimeFactory: () => createReadyLicenseRuntime()
    });

    try {
      const address = await listen(server);
      const response = await requestJson({
        port: address.port,
        route: "/api/craft/assist-select",
        body: {
          ...makeAssistSelectBody(),
          username: "member_test"
        }
      });

      assert.equal(response.statusCode, 400);
      assert.equal(response.body.ok, false);
      assert.equal(response.body.code, "target_step_invalid");
      assert.equal(response.body.message, "目标磨损不是可用台阶，请用预测器或输入框生成的目标值。");
      assert.equal(response.body.detail, "目标磨损必须是 [0,1] 内的 exact float32 台阶");
    } finally {
      await closeServer(server);
      delete require.cache[require.resolve("../src/uiServer")];
    }
  });
}

async function test_assist_select_route_accepts_matching_raw_and_step_request() {
  await withTempDir(async (dir) => {
    const snapshotPath = path.join(dir, "snapshot.json");
    writeSnapshot(snapshotPath, [
      makeRow({id: "m1", name: "Main (Factory New)", relative: 0.03})
    ]);
    const server = loadCreateServerForAssistRoute({
      snapshotPath,
      useWorkerPool: false
    })({
      licenseRuntimeFactory: () => createReadyLicenseRuntime()
    });

    try {
      const address = await listen(server);
      const response = await requestJson({
        port: address.port,
        route: "/api/craft/assist-select",
        body: makeAssistSelectBody()
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.debug.targetWear, String(validAssistTargetStep()));
      assert.equal(response.body.debug.targetWearRaw, validAssistTargetRaw());
    } finally {
      await closeServer(server);
      delete require.cache[require.resolve("../src/uiServer")];
    }
  });
}

async function test_assist_select_route_keeps_legacy_fallback_when_raw_is_missing() {
  await withTempDir(async (dir) => {
    const snapshotPath = path.join(dir, "snapshot.json");
    writeSnapshot(snapshotPath, [
      makeRow({id: "m1", name: "Main (Factory New)", relative: 0.03})
    ]);
    const server = loadCreateServerForAssistRoute({
      snapshotPath,
      useWorkerPool: false
    })({
      licenseRuntimeFactory: () => createReadyLicenseRuntime()
    });

    try {
      const address = await listen(server);
      const body = makeAssistSelectBody({
        target_wear: validAssistTargetStep(),
        target_wear_raw: undefined
      });
      delete body.target_wear_raw;
      const response = await requestJson({
        port: address.port,
        route: "/api/craft/assist-select",
        body
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.debug.targetWear, String(validAssistTargetStep()));
      assert.equal(response.body.debug.targetWearRaw, String(validAssistTargetStep()));
    } finally {
      await closeServer(server);
      delete require.cache[require.resolve("../src/uiServer")];
    }
  });
}

async function test_assist_select_route_rejects_raw_step_mismatch() {
  const response = await requestAssistSelectFailure({
    bodyOverrides: makeAssistSelectBody({
      target_wear_raw: "0.21",
      target_wear: Math.fround(0.22)
    })
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, "invalid_target_step");
  assert.equal(response.body.message, "目标磨损和原始输入不一致，请重新输入目标磨损。");
  assert.equal(response.body.detail, "target_wear must equal Math.fround(Number(target_wear_raw))");
}

async function test_assist_select_route_rejects_invalid_target_wear_raw() {
  const cases = [
    {
      label: "unparseable raw",
      body: makeAssistSelectBody({
        target_wear_raw: "not-a-number",
        target_wear: 0
      })
    },
    {
      label: "raw below range",
      body: makeAssistSelectBody({
        target_wear_raw: "-0.01",
        target_wear: Math.fround(-0.01)
      })
    },
    {
      label: "raw above range",
      body: makeAssistSelectBody({
        target_wear_raw: "1.01",
        target_wear: Math.fround(1.01)
      })
    }
  ];

  for (const current of cases) {
    const response = await requestAssistSelectFailure({
      bodyOverrides: current.body
    });

    assert.equal(response.statusCode, 400, current.label);
    assert.equal(response.body.ok, false, current.label);
    assert.equal(response.body.code, "invalid_target_wear", current.label);
    assert.equal(response.body.message, "请填写 0 到 1 之间的目标磨损。", current.label);
    assert.equal(response.body.detail, "target_wear_raw must be a finite number in [0, 1]", current.label);
  }
}

async function test_assist_select_route_requires_username_with_masked_message() {
  await withTempDir(async (dir) => {
    const snapshotPath = path.join(dir, "snapshot.json");
    writeSnapshot(snapshotPath, [
      makeRow({id: "m1", name: "Main (Factory New)", relative: 0.03})
    ]);
    const server = loadCreateServerForAssistRoute({
      snapshotPath,
      useWorkerPool: false
    })({
      licenseRuntimeFactory: () => createReadyLicenseRuntime()
    });

    try {
      const address = await listen(server);
      const response = await requestJson({
        port: address.port,
        route: "/api/craft/assist-select",
        body: {
          ...makeAssistSelectBody(),
          username: undefined
        }
      });

      assert.equal(response.statusCode, 400);
      assert.deepEqual(response.body, {
        ok: false,
        code: "account_required",
        message: "请先选择要选材的账号。",
        detail: "username is required"
      });
      assert.ok(!response.body.message.includes("username is required"));
    } finally {
      await closeServer(server);
      delete require.cache[require.resolve("../src/uiServer")];
    }
  });
}

async function test_assist_select_route_maps_candidate_rows_context_failure_from_result_detail() {
  await withTempDir(async (dir) => {
    const snapshotPath = path.join(dir, "snapshot.json");
    writeSnapshot(snapshotPath, [
      makeRow({id: "m1", name: "Main (Factory New)", relative: 0.03})
    ]);
    const server = loadCreateServerForAssistRoute({
      snapshotPath,
      useWorkerPool: false,
      directResult: {
        ok: false,
        code: "inventory_insufficient",
        message: "辅助选材失败：当前库存里没有足够符合条件的材料。",
        detail: "candidateRows is required"
      }
    })({
      licenseRuntimeFactory: () => createReadyLicenseRuntime()
    });

    try {
      const address = await listen(server);
      const response = await requestJson({
        port: address.port,
        route: "/api/craft/assist-select",
        body: {
          ...makeAssistSelectBody(),
          username: "member_test"
        }
      });

      assert.equal(response.statusCode, 400);
      assert.equal(response.body.ok, false);
      assert.equal(response.body.code, "craft_assist_context_missing");
      assert.equal(response.body.message, "辅助选材上下文失效，请刷新库存后重试。");
      assert.equal(response.body.detail, "candidateRows is required");
    } finally {
      await closeServer(server);
      delete require.cache[require.resolve("../src/uiServer")];
    }
  });
}

async function test_assist_select_route_masks_direct_exception_details_in_message() {
  await withTempDir(async (dir) => {
    const snapshotPath = path.join(dir, "snapshot.json");
    writeSnapshot(snapshotPath, [
      makeRow({id: "m1", name: "Main (Factory New)", relative: 0.03})
    ]);
    const server = loadCreateServerForAssistRoute({
      snapshotPath,
      useWorkerPool: false,
      directError: createTestError("candidateRows is required", "invalid_request")
    })({
      licenseRuntimeFactory: () => createReadyLicenseRuntime()
    });

    try {
      const address = await listen(server);
      const response = await requestJson({
        port: address.port,
        route: "/api/craft/assist-select",
        body: {
          ...makeAssistSelectBody(),
          username: "member_test"
        }
      });

      assert.equal(response.body.ok, false);
      assert.ok(response.statusCode >= 400);
      assert.equal(response.body.code, "craft_assist_context_missing");
      assert.equal(response.body.message, "辅助选材上下文失效，请刷新库存后重试。");
      assert.equal(response.body.detail, "candidateRows is required");
    } finally {
      await closeServer(server);
      delete require.cache[require.resolve("../src/uiServer")];
    }
  });
}

async function test_assist_select_route_maps_worker_timeout_without_fast_assist_to_enable_fast_hint() {
  const response = await requestAssistSelectFailure({
    useWorkerPool: true,
    workerError: createTestError("craft assist worker timeout after 300000ms", "worker_timeout"),
    bodyOverrides: {
      enable_fast_craft_assist: false
    }
  });

  assert.equal(response.body.ok, false);
  assert.ok(response.statusCode >= 400);
  assert.equal(response.body.code, "worker_timeout");
  assert.equal(response.body.message, "辅助选材计算超时，请缩小材料范围或使用快速选材。");
  assert.equal(response.body.detail, "craft assist worker timeout after 300000ms");
}

async function test_assist_select_route_maps_worker_timeout_with_fast_assist_to_retry_hint() {
  const response = await requestAssistSelectFailure({
    useWorkerPool: true,
    workerError: createTestError("worker timeout after 300000ms", "worker_timeout"),
    bodyOverrides: {
      enable_fast_craft_assist: true
    }
  });

  assert.equal(response.body.ok, false);
  assert.ok(response.statusCode >= 400);
  assert.equal(response.body.code, "worker_timeout");
  assert.equal(response.body.message, "辅助选材计算超时，请缩小材料范围后重试。");
  assert.equal(response.body.detail, "worker timeout after 300000ms");
}

async function test_assist_select_route_maps_prefilter_technical_error_to_fast_mode_hint() {
  const response = await requestAssistSelectFailure({
    useWorkerPool: true,
    workerError: createTestError("prefilter internal error: shard response invalid", "prefilter_internal_error"),
    bodyOverrides: {
      enable_fast_craft_assist: true
    }
  });

  assert.equal(response.body.ok, false);
  assert.ok(response.statusCode >= 400);
  assert.equal(response.body.code, "prefilter_internal_error");
  assert.equal(response.body.message, "快速选材预筛失败，请关闭快速模式。");
  assert.equal(response.body.detail, "prefilter internal error: shard response invalid");
}

async function test_assist_select_route_maps_worker_exit_to_background_error() {
  const response = await requestAssistSelectFailure({
    useWorkerPool: true,
    workerError: createTestError("worker exited with code 1", "worker_exited")
  });

  assert.equal(response.body.ok, false);
  assert.ok(response.statusCode >= 400);
  assert.equal(response.body.code, "worker_exited");
  assert.equal(response.body.message, "辅助选材后台异常。");
  assert.equal(response.body.detail, "worker exited with code 1");
}

async function test_assist_select_route_maps_worker_exit_code_to_background_error() {
  const response = await requestAssistSelectFailure({
    useWorkerPool: true,
    workerError: createTestError("process closed", "worker_exited")
  });

  assert.equal(response.body.ok, false);
  assert.ok(response.statusCode >= 400);
  assert.equal(response.body.code, "worker_exited");
  assert.equal(response.body.message, "辅助选材后台异常。");
  assert.equal(response.body.detail, "process closed");
}

async function test_assist_select_route_maps_final_result_step_failure_without_leaking_step_word() {
  const response = await requestAssistSelectFailure({
    useWorkerPool: false,
    directResult: {
      ok: false,
      code: "final_result_not_on_target_step",
      message: "final result is on 非目标 float32 台阶"
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, "final_result_not_on_target_step");
  assert.equal(response.body.message, "选材结果未通过最终校验，请放宽目标或更换材料。");
  assert.ok(!response.body.message.includes("台阶"));
  assert.equal(response.body.detail, "final result is on 非目标 float32 台阶");
}

async function test_assist_select_route_maps_cannot_target_below_zero_to_unreachable_message() {
  const response = await requestAssistSelectFailure({
    useWorkerPool: false,
    directResult: {
      ok: false,
      code: "target_below_zero",
      message: "cannot target below zero with current material bounds"
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, "target_below_zero");
  assert.equal(response.body.message, "当前材料组合达不到目标磨损，请放宽范围或更换材料。");
  assert.equal(response.body.detail, "cannot target below zero with current material bounds");
}

async function test_assist_select_route_maps_invalid_target_wear_variants() {
  const cases = [
    {
      label: "target_wear required token",
      directResult: {
        ok: false,
        message: "target_wear is required"
      },
      expectedDetail: "target_wear is required"
    },
    {
      label: "empty relative target prompt",
      directResult: {
        ok: false,
        message: "请先输入目标相对磨损"
      },
      expectedDetail: "请先输入目标相对磨损"
    },
    {
      label: "invalid target wear code",
      directResult: {
        ok: false,
        code: "invalid_target_wear",
        message: "目标磨损非法：abc"
      },
      expectedDetail: "目标磨损非法：abc"
    }
  ];

  for (const current of cases) {
    await assertAssistSelectFailureMapping({
      label: current.label,
      directResult: current.directResult,
      expectedCode: "invalid_target_wear",
      expectedMessage: "请填写 0 到 1 之间的目标磨损。",
      expectedDetail: current.expectedDetail
    });
  }
}

async function test_assist_select_route_maps_target_step_invalid_without_code_to_stable_code() {
  await assertAssistSelectFailureMapping({
    label: "target step invalid fallback code",
    directResult: {
      ok: false,
      message: "target step invalid"
    },
    expectedCode: "invalid_target_step",
    expectedMessage: "目标磨损不是可用台阶，请用预测器或输入框生成的目标值。",
    expectedDetail: "target step invalid"
  });
}

async function test_assist_select_route_maps_snapshot_missing_to_refresh_inventory() {
  await assertAssistSelectFailureMapping({
    label: "snapshot_missing code",
    directResult: {
      ok: false,
      code: "snapshot_missing",
      message: "库存快照不存在或失效"
    },
    expectedStatus: 409,
    expectedCode: "snapshot_missing",
    expectedMessage: "库存缓存已失效，请先刷新该账号库存。",
    expectedDetail: "库存快照不存在或失效"
  });
}

async function test_assist_select_route_maps_inventory_material_and_rarity_failures() {
  const cases = [
    {
      label: "inventory has no craft candidates",
      detail: "主库存无可选炼金物品",
      expectedCode: "inventory_no_candidates",
      expectedMessage: "当前库存没有可用于炼金的物品。"
    },
    {
      label: "material missing with parsed name",
      detail: "父类材料【M4A1-S | Nitro】无可用材料，请调整磨损范围",
      expectedCode: "material_missing",
      expectedMessage: "材料【M4A1-S | Nitro】库存中没有可用件。"
    },
    {
      label: "material missing fallback",
      detail: "父类材料无可用材料，请调整磨损范围",
      expectedCode: "material_missing",
      expectedMessage: "配方要求的材料库存中没有可用件。"
    },
    {
      label: "material quantity insufficient",
      detail: "父类材料【AK-47 | Redline】可用数量不足：需7，仅3，请调整磨损范围",
      expectedCode: "material_quantity_insufficient",
      expectedMessage: "材料【AK-47 | Redline】数量不足：需要 7 件，当前可用 3 件。"
    },
    {
      label: "same rarity count unmet",
      detail: "父类材料【Aux】在当前条件下无法满足同稀有度数量要求",
      expectedCode: "rarity_requirement_unmet",
      expectedMessage: "当前材料无法凑齐同一稀有度的 10 件。"
    },
    {
      label: "rarity mismatch",
      detail: "父类材料稀有度不一致，单个配方必须使用同一稀有度材料",
      expectedCode: "rarity_requirement_unmet",
      expectedMessage: "当前材料无法凑齐同一稀有度的 10 件。"
    }
  ];

  for (const current of cases) {
    await assertAssistSelectFailureMapping({
      label: current.label,
      directResult: {
        ok: false,
        message: current.detail
      },
      expectedCode: current.expectedCode,
      expectedMessage: current.expectedMessage,
      expectedDetail: current.detail
    });
  }
}

async function test_assist_select_route_maps_quantity_shortfall_cooling_filtered_code() {
  const detail = "父类材料【AK-47 | Redline】可用数量不足：需7，仅3，请调整磨损范围";
  await assertAssistSelectFailureMapping({
    label: "material quantity insufficient from cooling filter",
    directResult: {
      ok: false,
      code: "material_quantity_insufficient_cooling_filtered",
      message: detail
    },
    expectedCode: "material_quantity_insufficient_cooling_filtered",
    expectedMessage: "材料【AK-47 | Redline】数量不足：需要 7 件，当前可用 3 件；有物品仍在冷却中，可勾选包含冷却物品或更换材料。",
    expectedDetail: detail
  });
}

async function test_assist_select_route_maps_quantity_shortfall_blocked_code() {
  const detail = "父类材料【AK-47 | Redline】可用数量不足：需7，仅3，请调整磨损范围";
  await assertAssistSelectFailureMapping({
    label: "material quantity insufficient from blocked ids",
    directResult: {
      ok: false,
      code: "material_quantity_insufficient_blocked",
      message: detail
    },
    expectedCode: "material_quantity_insufficient_blocked",
    expectedMessage: "材料【AK-47 | Redline】数量不足：需要 7 件，当前可用 3 件；部分物品已被本批次占用，请减少本批次配方或更换材料。",
    expectedDetail: detail
  });
}

async function test_assist_select_route_maps_quantity_shortfall_cooling_filtered_code_without_chinese_shortfall_text() {
  const detail = "cooling filtered shortfall";
  await assertAssistSelectFailureMapping({
    label: "material quantity insufficient cooling code without localized shortfall text",
    directResult: {
      ok: false,
      code: "material_quantity_insufficient_cooling_filtered",
      message: detail
    },
    expectedCode: "material_quantity_insufficient_cooling_filtered",
    expectedMessage: "配方要求的材料数量不足；有物品仍在冷却中，可勾选包含冷却物品或更换材料。",
    expectedDetail: detail
  });
}

async function test_assist_select_route_maps_quantity_shortfall_blocked_code_without_chinese_shortfall_text() {
  const detail = "blocked shortfall";
  await assertAssistSelectFailureMapping({
    label: "material quantity insufficient blocked code without localized shortfall text",
    directResult: {
      ok: false,
      code: "material_quantity_insufficient_blocked",
      message: detail
    },
    expectedCode: "material_quantity_insufficient_blocked",
    expectedMessage: "配方要求的材料数量不足；部分物品已被本批次占用，请减少本批次配方或更换材料。",
    expectedDetail: detail
  });
}

async function test_assist_select_route_maps_final_validation_and_unreachable_failures() {
  const cases = [
    {
      label: "final result invalid code",
      directResult: {
        ok: false,
        code: "final_result_invalid",
        message: "终局校验失败：结果均值无效，请调整材料范围"
      },
      expectedCode: "final_result_invalid",
      expectedMessage: "选材结果未通过最终校验，请放宽目标或更换材料。",
      expectedDetail: "终局校验失败：结果均值无效，请调整材料范围"
    },
    {
      label: "no approximate result",
      directResult: {
        ok: false,
        message: "无法找到可用逼近结果"
      },
      expectedCode: "target_unreachable",
      expectedMessage: "当前材料组合达不到目标磨损，请放宽范围或更换材料。",
      expectedDetail: "无法找到可用逼近结果"
    },
    {
      label: "specific unreachable code preserved",
      directResult: {
        ok: false,
        code: "final_result_exceeds_target",
        message: "结果均值需小于目标磨损：目标 0.2142"
      },
      expectedCode: "final_result_exceeds_target",
      expectedMessage: "当前材料组合达不到目标磨损，请放宽范围或更换材料。",
      expectedDetail: "结果均值需小于目标磨损：目标 0.2142"
    },
    {
      label: "target wear unreachable text",
      directResult: {
        ok: false,
        message: "当前组合达不到目标磨损"
      },
      expectedCode: "target_unreachable",
      expectedMessage: "当前材料组合达不到目标磨损，请放宽范围或更换材料。",
      expectedDetail: "当前组合达不到目标磨损"
    }
  ];

  for (const current of cases) {
    await assertAssistSelectFailureMapping({
      label: current.label,
      directResult: current.directResult,
      expectedCode: current.expectedCode,
      expectedMessage: current.expectedMessage,
      expectedDetail: current.expectedDetail
    });
  }
}

(async () => {
  await test_assist_select_route_feeds_direct_and_worker_from_same_normalized_request();
  await test_assist_select_route_normalizes_technical_service_message_to_human_message();
  await test_assist_select_route_accepts_matching_raw_and_step_request();
  await test_assist_select_route_keeps_legacy_fallback_when_raw_is_missing();
  await test_assist_select_route_rejects_raw_step_mismatch();
  await test_assist_select_route_rejects_invalid_target_wear_raw();
  await test_assist_select_route_requires_username_with_masked_message();
  await test_assist_select_route_maps_candidate_rows_context_failure_from_result_detail();
  await test_assist_select_route_masks_direct_exception_details_in_message();
  await test_assist_select_route_maps_worker_timeout_without_fast_assist_to_enable_fast_hint();
  await test_assist_select_route_maps_worker_timeout_with_fast_assist_to_retry_hint();
  await test_assist_select_route_maps_prefilter_technical_error_to_fast_mode_hint();
  await test_assist_select_route_maps_worker_exit_to_background_error();
  await test_assist_select_route_maps_worker_exit_code_to_background_error();
  await test_assist_select_route_maps_final_result_step_failure_without_leaking_step_word();
  await test_assist_select_route_maps_cannot_target_below_zero_to_unreachable_message();
  await test_assist_select_route_maps_invalid_target_wear_variants();
  await test_assist_select_route_maps_target_step_invalid_without_code_to_stable_code();
  await test_assist_select_route_maps_snapshot_missing_to_refresh_inventory();
  await test_assist_select_route_maps_inventory_material_and_rarity_failures();
  await test_assist_select_route_maps_quantity_shortfall_cooling_filtered_code();
  await test_assist_select_route_maps_quantity_shortfall_blocked_code();
  await test_assist_select_route_maps_quantity_shortfall_cooling_filtered_code_without_chinese_shortfall_text();
  await test_assist_select_route_maps_quantity_shortfall_blocked_code_without_chinese_shortfall_text();
  await test_assist_select_route_maps_final_validation_and_unreachable_failures();
  console.log("craft-assist-route tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
