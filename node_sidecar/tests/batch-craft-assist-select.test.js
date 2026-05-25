const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

function loadBatchCraftAssistSelect(overrides = {}) {
  const source = extractBlock(
    "function resolveCraftAssistTargetWearPair(",
    "function normalizeCraftAssistTargetWearStepOrFallback("
  ) + "\n" + extractBlock(
    "async function callBatchCraftAssistSelectForAccount(",
    "async function runBatchCraftExecution("
  );
  const warnCalls = [];
  const batchStatusCalls = [];
  const context = {
    Math,
    Number,
    String,
    Boolean,
    Array,
    JSON,
    DEFAULT_CRAFT_ASSIST_WEAR_OFFSET: 0.00001,
    Date: overrides.Date || Date,
    state: overrides.state,
    getCraftRowsForAccount: overrides.getCraftRowsForAccount,
    normalizeCraftAssistFilterMode: overrides.normalizeCraftAssistFilterMode,
    parseOptionalWear01: overrides.parseOptionalWear01,
    normalizeCraftAssistTargetWearStep: overrides.normalizeCraftAssistTargetWearStep || ((value) => {
      const parsed = overrides.parseOptionalWear01 ? overrides.parseOptionalWear01(value) : Number(value);
      return parsed == null || !Number.isFinite(Number(parsed)) ? null : Math.fround(Math.max(0, Math.min(1, Number(parsed))));
    }),
    normalizeCraftAssistWearOffset: overrides.normalizeCraftAssistWearOffset || ((value, fallback = 0.00001) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
    }),
    normalizeCraftAssistMaterialsForRun: overrides.normalizeCraftAssistMaterialsForRun,
    craftAssistTargetCountFromMaterials: overrides.craftAssistTargetCountFromMaterials,
    api: overrides.api,
    normalizeCraftRecipeItemIds: overrides.normalizeCraftRecipeItemIds,
    hasCachedSnapshotForAccount: overrides.hasCachedSnapshotForAccount,
    sanitizeCraftAssistPresetPayload: overrides.sanitizeCraftAssistPresetPayload,
    renderBatchCraftPage: overrides.renderBatchCraftPage || function() {},
    setBatchCraftStatus(text, isError = false) {
      batchStatusCalls.push({text: String(text || "").trim(), isError: !!isError});
      if (context.state) {
        context.state.batchCraftStatusText = String(text || "").trim();
        context.state.batchCraftStatusError = !!isError;
      }
    },
    console: {
      warn(...args) {
        warnCalls.push(args);
      },
      info() {},
      log() {},
      error() {}
    }
  };
  vm.runInNewContext(
    `${source}\nthis.callBatchCraftAssistSelectForAccount = callBatchCraftAssistSelectForAccount;\nthis.runBatchCraftAssistSelect = runBatchCraftAssistSelect;`,
    context,
    {filename: APP_PATH}
  );
  context.getWarnCalls = () => warnCalls.map((entry) => entry.slice());
  context.getBatchStatusCalls = () => batchStatusCalls.map((entry) => ({...entry}));
  return context;
}

function createBatchRunHarness({DateImpl, accounts, api, limit = 10, existingQueue = []}) {
  return loadBatchCraftAssistSelect({
    Date: DateImpl,
    state: {
      batchCraftAccounts: accounts,
      batchCraftSelectedPresetId: "preset-1",
      batchCraftLimit: limit,
      batchCraftQueue: Array.isArray(existingQueue) ? existingQueue : [],
      batchCraftBusy: false,
      batchCraftStatusText: "",
      batchCraftStatusError: false,
      craftAssistPresets: [{id: "preset-1"}],
      batchCraftUseComponentItems: true,
      batchCraftIncludeCooling: false,
      batchCraftFastMode: true,
      batchCraftApproachMode: true,
      batchCraftWearOffset: 0.00017
    },
    hasCachedSnapshotForAccount(username) {
      assert.ok(accounts.includes(username), `unexpected account cache check: ${username}`);
      return true;
    },
    sanitizeCraftAssistPresetPayload(preset) {
      assert.equal(preset.id, "preset-1");
      return {
        target_wear: 0.2142,
        wear_filter_mode: "relative",
        materials: [{id: "mat-1", role: "main", count: 10, items: [{id: "mat-1__1", name: "AK"}]}]
      };
    },
    getCraftRowsForAccount(username) {
      assert.ok(accounts.includes(username), `unexpected account row lookup: ${username}`);
      return [{asset_id: `${username}-seed-1`}];
    },
    normalizeCraftAssistFilterMode(value) {
      return String(value || "").trim() === "absolute" ? "absolute" : "relative";
    },
    parseOptionalWear01(value) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    },
    normalizeCraftAssistMaterialsForRun({materials}) {
      return Array.isArray(materials) ? materials : [];
    },
    craftAssistTargetCountFromMaterials(materials) {
      assert.equal(materials.length, 1);
      return 10;
    },
    api,
    normalizeCraftRecipeItemIds(ids) {
      return Array.from(new Set((Array.isArray(ids) ? ids : []).map((value) => String(value || "").trim()).filter(Boolean)));
    }
  });
}

function createBatchAssistError(message, code = "material_quantity_insufficient_blocked") {
  const err = new Error(message);
  err.data = {
    ok: false,
    code,
    message,
    detail: `${code} detail`
  };
  return err;
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function prevFloat32(value) {
  const f32 = Math.fround(Number(value));
  if (!Number.isFinite(f32) || f32 <= 0) return f32;
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, f32, false);
  const bits = view.getUint32(0, false);
  if (bits === 0) return 0;
  view.setUint32(0, bits - 1, false);
  return view.getFloat32(0, false);
}

async function test_batch_helper_uses_current_assist_route_contract({DateImpl}) {
  let capturedRequest = null;
  const targetWearRaw = "0.21";
  const targetWearStep = Math.fround(Number(targetWearRaw));
  const app = loadBatchCraftAssistSelect({
    Date: DateImpl,
    state: {
      batchCraftUseComponentItems: true,
      batchCraftIncludeCooling: false,
      batchCraftFastMode: true,
      batchCraftApproachMode: true,
      batchCraftWearOffset: 0.00017
    },
    getCraftRowsForAccount(username) {
      assert.equal(username, "acc-a");
      return [{asset_id: "seed-1"}];
    },
    normalizeCraftAssistFilterMode(value) {
      return String(value || "").trim() === "absolute" ? "absolute" : "relative";
    },
    parseOptionalWear01(value) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    },
    normalizeCraftAssistMaterialsForRun({materials, targetWear, wearFilterMode}) {
      assert.equal(targetWear, targetWearStep);
      assert.equal(wearFilterMode, "relative");
      return Array.isArray(materials) ? materials : [];
    },
    craftAssistTargetCountFromMaterials(materials) {
      assert.equal(materials.length, 1);
      return 10;
    },
    async api(route, options = {}) {
      assert.equal(route, "/api/craft/assist-select");
      capturedRequest = JSON.parse(String(options.body || "{}"));
      return {
        ok: true,
        item_ids: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
        overall: 0.2141
      };
    },
    normalizeCraftRecipeItemIds(ids) {
      return Array.from(new Set((Array.isArray(ids) ? ids : []).map((value) => String(value || "").trim()).filter(Boolean)));
    }
  });

  const result = await app.callBatchCraftAssistSelectForAccount(
    "acc-a",
    {
      target_wear: targetWearStep,
      target_wear_raw: targetWearRaw,
      wear_filter_mode: "relative",
      materials: [{id: "mat-1", role: "main", count: 10, items: [{id: "mat-1__1", name: "AK"}]}]
    },
    ["used-1", "used-2"]
  );

  assert.deepEqual(capturedRequest, {
    username: "acc-a",
    target_wear: targetWearStep,
    target_wear_raw: targetWearRaw,
    wear_approach_mode: "infinite",
    materials: [{id: "mat-1", role: "main", count: 10, items: [{id: "mat-1__1", name: "AK"}]}],
    use_component_items: true,
    include_cooling: false,
    wear_offset: 0.00017,
    blocked_ids: ["used-1", "used-2"],
    enable_fast_craft_assist: true
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    id: "batch_1745582400000_4fzzzx",
    item_ids: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
    status: "pending",
    result: null
  });
}

async function test_batch_helper_below_mode_keeps_raw_and_does_not_pre_shift({DateImpl}) {
  let capturedRequest = null;
  const targetWearRaw = "0.21";
  const targetWearStep = Math.fround(Number(targetWearRaw));
  const shiftedStep = prevFloat32(targetWearStep);
  const app = loadBatchCraftAssistSelect({
    Date: DateImpl,
    state: {
      batchCraftUseComponentItems: true,
      batchCraftIncludeCooling: false,
      batchCraftFastMode: true,
      batchCraftApproachMode: false,
      batchCraftWearOffset: 0.00017
    },
    getCraftRowsForAccount(username) {
      assert.equal(username, "acc-below");
      return [{asset_id: "seed-1"}];
    },
    normalizeCraftAssistFilterMode(value) {
      return String(value || "").trim() === "absolute" ? "absolute" : "relative";
    },
    parseOptionalWear01(value) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    },
    normalizeCraftAssistMaterialsForRun({materials, targetWear, wearFilterMode}) {
      assert.equal(targetWear, targetWearStep);
      assert.equal(wearFilterMode, "relative");
      return Array.isArray(materials) ? materials : [];
    },
    craftAssistTargetCountFromMaterials(materials) {
      assert.equal(materials.length, 1);
      return 10;
    },
    async api(route, options = {}) {
      assert.equal(route, "/api/craft/assist-select");
      capturedRequest = JSON.parse(String(options.body || "{}"));
      return {
        ok: true,
        item_ids: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
        overall: 0.2141
      };
    },
    normalizeCraftRecipeItemIds(ids) {
      return Array.from(new Set((Array.isArray(ids) ? ids : []).map((value) => String(value || "").trim()).filter(Boolean)));
    }
  });

  await app.callBatchCraftAssistSelectForAccount(
    "acc-below",
    {
      target_wear: targetWearStep,
      target_wear_raw: targetWearRaw,
      wear_filter_mode: "relative",
      materials: [{id: "mat-1", role: "main", count: 10, items: [{id: "mat-1__1", name: "AK"}]}]
    },
    ["used-1"]
  );

  assert.equal(capturedRequest.wear_approach_mode, "below");
  assert.equal(capturedRequest.target_wear, targetWearStep);
  assert.equal(capturedRequest.target_wear_raw, targetWearRaw);
  assert.notEqual(capturedRequest.target_wear, shiftedStep);
}

async function test_batch_helper_keeps_null_and_logs_account_level_failure({DateImpl}) {
  const targetWearRaw = "0.21";
  const targetWearStep = Math.fround(Number(targetWearRaw));
  const app = loadBatchCraftAssistSelect({
    Date: DateImpl,
    state: {
      batchCraftUseComponentItems: true,
      batchCraftIncludeCooling: false,
      batchCraftFastMode: true,
      batchCraftApproachMode: true,
      batchCraftWearOffset: 0.00017
    },
    getCraftRowsForAccount(username) {
      assert.equal(username, "acc-b");
      return [{asset_id: "seed-1"}];
    },
    normalizeCraftAssistFilterMode(value) {
      return String(value || "").trim() === "absolute" ? "absolute" : "relative";
    },
    parseOptionalWear01(value) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    },
    normalizeCraftAssistMaterialsForRun({materials}) {
      return Array.isArray(materials) ? materials : [];
    },
    craftAssistTargetCountFromMaterials(materials) {
      assert.equal(materials.length, 1);
      return 10;
    },
    async api() {
      const err = new Error("辅助选材暂时失败，请重试。");
      err.data = {
        ok: false,
        code: "worker_timeout",
        message: "辅助选材暂时失败，请重试。",
        detail: "craft assist worker timeout after 300000ms"
      };
      throw err;
    },
    normalizeCraftRecipeItemIds(ids) {
      return Array.from(new Set((Array.isArray(ids) ? ids : []).map((value) => String(value || "").trim()).filter(Boolean)));
    }
  });

  const result = await app.callBatchCraftAssistSelectForAccount(
    "acc-b",
    {
      target_wear: targetWearStep,
      target_wear_raw: targetWearRaw,
      wear_filter_mode: "relative",
      materials: [{id: "mat-1", role: "main", count: 10, items: [{id: "mat-1__1", name: "AK", wear_filter_mode: "relative", wear_min: 0.1, wear_max: 0.2}]}]
    },
    ["used-1", "used-2", "used-2", "used-3"]
  );

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    failed: true,
    username: "acc-b",
    code: "worker_timeout",
    message: "辅助选材暂时失败，请重试。",
    detail: "craft assist worker timeout after 300000ms"
  });
  const warnCalls = app.getWarnCalls();
  assert.equal(warnCalls.length, 1);
  assert.match(String(warnCalls[0][0] || ""), /craft-assist/i);
  assert.deepEqual(JSON.parse(JSON.stringify(warnCalls[0][1])), {
    account: "acc-b",
    target_wear: targetWearStep,
    target_wear_raw: targetWearRaw,
    wear_approach_mode: "infinite",
    wear_offset: 0.00017,
    enable_fast_craft_assist: true,
    use_component_items: true,
    include_cooling: false,
    blocked_ids_length: 3,
    occupied_item_ids_length: 4,
    materials: [
      {
        role: "main",
        count: 10,
        item_names: ["AK"],
        wear_ranges: [
          {
            name: "AK",
            wear_filter_mode: "relative",
            wear_min: 0.1,
            wear_max: 0.2
          }
        ]
      }
    ],
    code: "worker_timeout",
    message: "辅助选材暂时失败，请重试。",
    detail: "craft assist worker timeout after 300000ms"
  });
}

async function test_batch_selection_surfaces_blocked_shortfall_message_in_top_status({DateImpl}) {
  const blockedMessage = "辅助选材失败：当前库存里没有足够符合条件的材料。请减少目标数量或放宽材料范围。";
  const app = loadBatchCraftAssistSelect({
    Date: DateImpl,
    state: {
      batchCraftAccounts: ["acc-c"],
      batchCraftSelectedPresetId: "preset-1",
      batchCraftLimit: 10,
      batchCraftQueue: [],
      batchCraftBusy: false,
      batchCraftStatusText: "",
      batchCraftStatusError: false,
      craftAssistPresets: [{id: "preset-1"}],
      batchCraftUseComponentItems: true,
      batchCraftIncludeCooling: false,
      batchCraftFastMode: true,
      batchCraftApproachMode: true,
      batchCraftWearOffset: 0.00017
    },
    hasCachedSnapshotForAccount(username) {
      assert.equal(username, "acc-c");
      return true;
    },
    sanitizeCraftAssistPresetPayload(preset) {
      assert.equal(preset.id, "preset-1");
      return {
        target_wear: 0.2142,
        wear_filter_mode: "relative",
        materials: [{id: "mat-1", role: "main", count: 10, items: [{id: "mat-1__1", name: "AK"}]}]
      };
    },
    getCraftRowsForAccount(username) {
      assert.equal(username, "acc-c");
      return [{asset_id: "seed-1"}];
    },
    normalizeCraftAssistFilterMode(value) {
      return String(value || "").trim() === "absolute" ? "absolute" : "relative";
    },
    parseOptionalWear01(value) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    },
    normalizeCraftAssistMaterialsForRun({materials}) {
      return Array.isArray(materials) ? materials : [];
    },
    craftAssistTargetCountFromMaterials(materials) {
      assert.equal(materials.length, 1);
      return 10;
    },
    async api() {
      const err = new Error(blockedMessage);
      err.data = {
        ok: false,
        code: "material_quantity_insufficient_blocked",
        message: blockedMessage,
        detail: "shortfall code-first detail"
      };
      throw err;
    },
    normalizeCraftRecipeItemIds(ids) {
      return Array.from(new Set((Array.isArray(ids) ? ids : []).map((value) => String(value || "").trim()).filter(Boolean)));
    }
  });

  await app.runBatchCraftAssistSelect();

  assert.equal(app.state.batchCraftQueue.length, 0);
  assert.equal(app.state.batchCraftStatusError, true);
  assert.match(app.state.batchCraftStatusText, /当前库存里没有足够符合条件的材料/);
  assert.doesNotMatch(app.state.batchCraftStatusText, /选材完成：0 个账号，共 0 组配方/);

  const statusCalls = app.getBatchStatusCalls();
  assert.equal(statusCalls.at(-1).isError, true);
  assert.match(statusCalls.at(-1).text, /acc-c/);
  assert.match(statusCalls.at(-1).text, /当前库存里没有足够符合条件的材料/);
}

async function test_batch_selection_summarizes_mixed_success_and_failure({DateImpl}) {
  const app = createBatchRunHarness({
    DateImpl,
    accounts: ["acc-ok", "acc-fail"],
    limit: 1,
    async api(_route, options = {}) {
      const request = JSON.parse(String(options.body || "{}"));
      if (request.username === "acc-ok") {
        return {
          ok: true,
          item_ids: ["ok-1", "ok-2", "ok-3", "ok-4", "ok-5", "ok-6", "ok-7", "ok-8", "ok-9", "ok-10"],
          overall: 0.2141
        };
      }
      throw createBatchAssistError("辅助选材失败：acc-fail 库存不足。");
    }
  });

  await app.runBatchCraftAssistSelect();

  assert.equal(app.state.batchCraftQueue.length, 1);
  assert.equal(app.state.batchCraftQueue[0].username, "acc-ok");
  assert.deepEqual(app.state.batchCraftQueue[0].recipes[0].item_ids, ["ok-1", "ok-2", "ok-3", "ok-4", "ok-5", "ok-6", "ok-7", "ok-8", "ok-9", "ok-10"]);
  assert.equal(app.state.batchCraftStatusError, true);
  assert.match(app.state.batchCraftStatusText, /部分账号选材失败/);
  assert.match(app.state.batchCraftStatusText, /失败 1 个账号/);
  assert.match(app.state.batchCraftStatusText, /acc-fail：辅助选材失败：acc-fail 库存不足。/);
  assert.match(app.state.batchCraftStatusText, /已选 1 个账号，共 1 组配方/);
}

async function test_batch_selection_preserves_existing_queue_entries({DateImpl}) {
  const expectedOldQueue = [
    {
      username: "old-account",
      recipes: [
        {
          id: "old-recipe",
          item_ids: ["old-1", "old-2", "old-3", "old-4", "old-5", "old-6", "old-7", "old-8", "old-9", "old-10"],
          status: "pending",
          result: null
        }
      ]
    }
  ];
  const inputOldQueue = clonePlain(expectedOldQueue);
  const expectedNewItemIds = ["new-1", "new-2", "new-3", "new-4", "new-5", "new-6", "new-7", "new-8", "new-9", "new-10"];
  const app = createBatchRunHarness({
    DateImpl,
    accounts: ["new-account"],
    limit: 1,
    existingQueue: inputOldQueue,
    async api(_route, options = {}) {
      const request = JSON.parse(String(options.body || "{}"));
      assert.equal(request.username, "new-account");
      return {
        ok: true,
        item_ids: expectedNewItemIds,
        overall: 0.2141
      };
    }
  });

  await app.runBatchCraftAssistSelect();

  assert.equal(app.state.batchCraftQueue.length, 2);
  assert.equal(app.state.batchCraftQueue[0].username, "old-account");
  assert.deepEqual(app.state.batchCraftQueue[0].recipes[0].item_ids, expectedOldQueue[0].recipes[0].item_ids);
  assert.equal(app.state.batchCraftQueue[1].username, "new-account");
  assert.deepEqual(app.state.batchCraftQueue[1].recipes[0].item_ids, expectedNewItemIds);
  assert.deepEqual(inputOldQueue, expectedOldQueue);
}

async function test_batch_selection_blocks_existing_same_account_recipe_items({DateImpl}) {
  const expectedOldItemIds = ["old-1", "old-2", "old-3", "old-4", "old-5", "old-6", "old-7", "old-8", "old-9", "old-10"];
  const expectedOldQueue = [
    {
      username: "same-account",
      recipes: [
        {
          id: "old-recipe",
          item_ids: expectedOldItemIds,
          status: "pending",
          result: null
        }
      ]
    }
  ];
  const inputOldQueue = clonePlain(expectedOldQueue);
  const expectedNewItemIds = ["new-1", "new-2", "new-3", "new-4", "new-5", "new-6", "new-7", "new-8", "new-9", "new-10"];
  let capturedBlockedIds = null;
  const app = createBatchRunHarness({
    DateImpl,
    accounts: ["same-account"],
    limit: 1,
    existingQueue: inputOldQueue,
    async api(_route, options = {}) {
      const request = JSON.parse(String(options.body || "{}"));
      capturedBlockedIds = request.blocked_ids;
      return {
        ok: true,
        item_ids: expectedNewItemIds,
        overall: 0.2141
      };
    }
  });

  await app.runBatchCraftAssistSelect();

  assert.deepEqual(capturedBlockedIds, expectedOldItemIds);
  assert.equal(app.state.batchCraftQueue.length, 1);
  assert.equal(app.state.batchCraftQueue[0].username, "same-account");
  assert.equal(app.state.batchCraftQueue[0].recipes.length, 2);
  assert.deepEqual(app.state.batchCraftQueue[0].recipes[0].item_ids, expectedOldItemIds);
  assert.deepEqual(app.state.batchCraftQueue[0].recipes[1].item_ids, expectedNewItemIds);
  assert.deepEqual(inputOldQueue, expectedOldQueue);
}

async function test_batch_selection_failure_preserves_existing_queue_entries({DateImpl}) {
  const expectedOldQueue = [
    {
      username: "old-account",
      recipes: [
        {
          id: "old-recipe",
          item_ids: ["old-1", "old-2", "old-3", "old-4", "old-5", "old-6", "old-7", "old-8", "old-9", "old-10"],
          status: "pending",
          result: null
        }
      ]
    }
  ];
  const inputOldQueue = clonePlain(expectedOldQueue);
  const app = createBatchRunHarness({
    DateImpl,
    accounts: ["new-fail-account"],
    limit: 1,
    existingQueue: inputOldQueue,
    async api() {
      throw createBatchAssistError("辅助选材失败：new-fail-account 库存不足。");
    }
  });

  await app.runBatchCraftAssistSelect();

  assert.equal(app.state.batchCraftQueue.length, 1);
  assert.equal(app.state.batchCraftQueue[0].username, "old-account");
  assert.equal(app.state.batchCraftQueue[0].recipes.length, 1);
  assert.deepEqual(app.state.batchCraftQueue[0].recipes[0].item_ids, expectedOldQueue[0].recipes[0].item_ids);
  assert.equal(app.state.batchCraftQueue.some((entry) => entry.username === "new-fail-account"), false);
  assert.equal(app.state.batchCraftBusy, false);
  assert.equal(app.state.batchCraftStatusError, true);
  assert.match(app.state.batchCraftStatusText, /选材失败|部分账号选材失败/);
  assert.match(app.state.batchCraftStatusText, /new-fail-account/);
  assert.deepEqual(inputOldQueue, expectedOldQueue);
}

async function test_batch_selection_summarizes_multiple_failures({DateImpl}) {
  const app = createBatchRunHarness({
    DateImpl,
    accounts: ["acc-a", "acc-b", "acc-c"],
    async api(_route, options = {}) {
      const request = JSON.parse(String(options.body || "{}"));
      throw createBatchAssistError(`辅助选材失败：${request.username} 库存不足。`);
    }
  });

  await app.runBatchCraftAssistSelect();

  assert.equal(app.state.batchCraftQueue.length, 0);
  assert.equal(app.state.batchCraftStatusError, true);
  assert.match(app.state.batchCraftStatusText, /选材失败：3 个账号/);
  assert.match(app.state.batchCraftStatusText, /acc-a：辅助选材失败：acc-a 库存不足。/);
  assert.match(app.state.batchCraftStatusText, /acc-b：辅助选材失败：acc-b 库存不足。/);
  assert.match(app.state.batchCraftStatusText, /acc-c：辅助选材失败：acc-c 库存不足。/);
  assert.doesNotMatch(app.state.batchCraftStatusText, /选材完成：0 个账号，共 0 组配方/);
}

async function test_batch_selection_preserves_preset_target_wear_raw_in_assist_request({DateImpl}) {
  let capturedRequest = null;
  const app = loadBatchCraftAssistSelect({
    Date: DateImpl,
    state: {
      batchCraftAccounts: ["acc-raw"],
      batchCraftSelectedPresetId: "preset-raw",
      batchCraftLimit: 1,
      batchCraftQueue: [],
      batchCraftBusy: false,
      batchCraftStatusText: "",
      batchCraftStatusError: false,
      craftAssistPresets: [{
        id: "preset-raw",
        target_wear: Math.fround(0.21),
        target_wear_raw: "0.21"
      }],
      batchCraftUseComponentItems: true,
      batchCraftIncludeCooling: false,
      batchCraftFastMode: true,
      batchCraftApproachMode: true,
      batchCraftWearOffset: 0.00017
    },
    hasCachedSnapshotForAccount(username) {
      assert.equal(username, "acc-raw");
      return true;
    },
    sanitizeCraftAssistPresetPayload(preset) {
      assert.equal(preset.id, "preset-raw");
      return {
        target_wear: Math.fround(0.21),
        target_wear_raw: "0.21",
        wear_filter_mode: "relative",
        materials: [{id: "mat-raw", role: "main", count: 10, items: [{id: "mat-raw__1", name: "AK"}]}]
      };
    },
    getCraftRowsForAccount(username) {
      assert.equal(username, "acc-raw");
      return [{asset_id: "seed-raw"}];
    },
    normalizeCraftAssistFilterMode(value) {
      return String(value || "").trim() === "absolute" ? "absolute" : "relative";
    },
    parseOptionalWear01(value) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    },
    normalizeCraftAssistMaterialsForRun({materials}) {
      return Array.isArray(materials) ? materials : [];
    },
    craftAssistTargetCountFromMaterials(materials) {
      assert.equal(materials.length, 1);
      return 10;
    },
    async api(route, options = {}) {
      assert.equal(route, "/api/craft/assist-select");
      capturedRequest = JSON.parse(String(options.body || "{}"));
      return {
        ok: true,
        item_ids: ["raw-1", "raw-2", "raw-3", "raw-4", "raw-5", "raw-6", "raw-7", "raw-8", "raw-9", "raw-10"],
        overall: Math.fround(0.21)
      };
    },
    normalizeCraftRecipeItemIds(ids) {
      return Array.from(new Set((Array.isArray(ids) ? ids : []).map((value) => String(value || "").trim()).filter(Boolean)));
    }
  });

  await app.runBatchCraftAssistSelect();

  assert.ok(capturedRequest, "expected batch run to call assist-select");
  assert.equal(capturedRequest.target_wear, Math.fround(0.21));
  assert.equal(capturedRequest.target_wear_raw, "0.21");
  assert.notEqual(capturedRequest.target_wear_raw, String(Math.fround(0.21)));
}

async function main() {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length) {
        super(...args);
        return;
      }
      super("2026-04-25T12:00:00.000Z");
    }

    static now() {
      return 1745582400000;
    }
  }
  const originalRandom = Math.random;
  Math.random = () => 0.123456789;
  try {
    await test_batch_helper_uses_current_assist_route_contract({DateImpl: FakeDate});
    await test_batch_helper_below_mode_keeps_raw_and_does_not_pre_shift({DateImpl: FakeDate});
    await test_batch_helper_keeps_null_and_logs_account_level_failure({DateImpl: FakeDate});
    await test_batch_selection_surfaces_blocked_shortfall_message_in_top_status({DateImpl: FakeDate});
    await test_batch_selection_summarizes_mixed_success_and_failure({DateImpl: FakeDate});
    await test_batch_selection_preserves_existing_queue_entries({DateImpl: FakeDate});
    await test_batch_selection_blocks_existing_same_account_recipe_items({DateImpl: FakeDate});
    await test_batch_selection_failure_preserves_existing_queue_entries({DateImpl: FakeDate});
    await test_batch_selection_summarizes_multiple_failures({DateImpl: FakeDate});
    await test_batch_selection_preserves_preset_target_wear_raw_in_assist_request({DateImpl: FakeDate});
  } finally {
    Math.random = originalRandom;
  }
  console.log("batch-craft-assist-select tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
