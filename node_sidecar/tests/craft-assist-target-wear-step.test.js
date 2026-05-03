const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {prevFloat32} = require("../src/services/craftAssistFloat32Step");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

function loadTargetWearFns(overrides = {}) {
  const source = [
    extractBlock("function truncateNumber(", "function inferWearSuffixRangeByName("),
    extractBlock("function clampWear01(", "function wearText2("),
    extractBlock("function normalizeCraftAssistFilterMode(", "function getCraftAssistFilterMode("),
    extractBlock("function sanitizeCraftAssistPresetPayload(", "function readCraftAssistPresetsFromLocalStorage("),
    extractBlock("function buildCurrentCraftAssistPresetSnapshot(", "function makeTradeupSimulationUid("),
    extractBlock("function validateCurrentCraftAssistPresetBeforeNaming(", "function isCraftAssistPresetEditing("),
    extractBlock("function buildCraftAssistDraftSnapshotFromState(", "function buildCraftAssistPresetComparableSnapshot("),
    extractBlock("function restoreCraftAssistDraftSnapshot(", "function clearCraftAssistPresetEditingState("),
    extractBlock("function loadCraftAssistPresetIntoDraft(", "function saveCurrentCraftAssistPreset("),
    extractBlock("function saveCurrentCraftAssistPreset(", "async function promptAndSaveCurrentCraftAssistPreset()"),
    extractBlock("async function applyCraftAssistPreset(", "function saveCraftAssistPresetEditingSession("),
    extractBlock("async function applyCraftAssistAutoSelection(", "async function applyCraftAssistAutoSelectionBatch("),
    extractBlock("async function callBatchCraftAssistSelectForAccount(", "async function runBatchCraftAssistSelect(")
  ].join("\n");
  const state = overrides.state || {};
  const context = {
    state,
    WEAR_INPUT_DECIMALS: 6,
    DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT: 5,
    Math,
    Number,
    String,
    Array,
    Set,
    JSON,
    Date: overrides.Date || Date,
    console: overrides.console || console,
    guardGuestAction: overrides.guardGuestAction || (() => true),
    makeCraftAssistUid: overrides.makeCraftAssistUid || (() => "preset_generated"),
    projectCraftAssistPersistedMaterialsFromState: overrides.projectCraftAssistPersistedMaterialsFromState || ((materials) => Array.isArray(materials) ? JSON.parse(JSON.stringify(materials)) : []),
    normalizeCraftAssistMaterialList: overrides.normalizeCraftAssistMaterialList || ((materials) => Array.isArray(materials) ? JSON.parse(JSON.stringify(materials)) : []),
    getAllInventoryCraftableRows: overrides.getAllInventoryCraftableRows || (() => []),
    validateCraftAssistMaterialEntriesForSave: overrides.validateCraftAssistMaterialEntriesForSave || (() => ({ok: true})),
    validateCraftAssistPresetSnapshot: overrides.validateCraftAssistPresetSnapshot || (() => ({ok: true})),
    craftAssistTargetCountFromMaterials: overrides.craftAssistTargetCountFromMaterials || (() => 10),
    calcCraftAssistMaterialTotalCount: overrides.calcCraftAssistMaterialTotalCount || ((materials) => (Array.isArray(materials) ? materials : []).reduce((sum, entry) => sum + Number(entry && entry.count || 0), 0)),
    saveCraftAssistPresetsToStorage: overrides.saveCraftAssistPresetsToStorage || (() => {}),
    setCraftStatus: overrides.setCraftStatus || (() => {}),
    renderCraftAssistPanel: overrides.renderCraftAssistPanel || (() => {}),
    syncCraftAssistAutoDirectionLimit: overrides.syncCraftAssistAutoDirectionLimit || (() => {}),
    getCraftRowsForAccount: overrides.getCraftRowsForAccount || (() => []),
    normalizeCraftAssistMaterialsForRun: overrides.normalizeCraftAssistMaterialsForRun || (({materials}) => Array.isArray(materials) ? materials : []),
    getCraftQueuePendingCountFromState: overrides.getCraftQueuePendingCountFromState || (() => 0),
    setCraftAssistActiveRunToken: overrides.setCraftAssistActiveRunToken || (() => "run-token"),
    createCraftAssistRunToken: overrides.createCraftAssistRunToken || (() => "run-token"),
    saveCraftAssistRuntimeState: overrides.saveCraftAssistRuntimeState || (() => ({craftAssistSelecting: true})),
    applyCraftAssistRuntimeStateSnapshot: overrides.applyCraftAssistRuntimeStateSnapshot || (() => {}),
    commitCraftAccountScopedStateForUsername: overrides.commitCraftAccountScopedStateForUsername || (() => {}),
    createEmptyCraftRecipeEntryInState: overrides.createEmptyCraftRecipeEntryInState || (() => ({id: "recipe-1"})),
    getCraftQueuePendingEntriesFromState: overrides.getCraftQueuePendingEntriesFromState || (() => []),
    normalizeCraftRecipeItemIds: overrides.normalizeCraftRecipeItemIds || ((ids) => Array.from(new Set((Array.isArray(ids) ? ids : []).map((value) => String(value || "").trim()).filter(Boolean)))),
    normalizeCraftAssistWearOffsetPct: overrides.normalizeCraftAssistWearOffsetPct || ((value, fallback) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : fallback;
    }),
    normalizeCraftAssistRole: overrides.normalizeCraftAssistRole || ((role) => String(role || "").trim() === "aux" ? "aux" : "main"),
    api: overrides.api || (async () => ({item_ids: []})),
    clearScopedCraftAssistRuntimeState: overrides.clearScopedCraftAssistRuntimeState || (() => {}),
    clearCraftAssistActiveRunToken: overrides.clearCraftAssistActiveRunToken || (() => {}),
    setTimeout: overrides.setTimeout || ((callback) => {
      if (typeof callback === "function") callback();
      return 1;
    }),
    clearTimeout: overrides.clearTimeout || (() => {}),
    AbortController: overrides.AbortController || class AbortControllerMock {
      constructor() {
        this.signal = {};
      }
      abort() {}
    },
    addFilledCraftRecipeToState: overrides.addFilledCraftRecipeToState || (() => true),
    removeCraftRecipeEntryFromState: overrides.removeCraftRecipeEntryFromState || (() => {}),
    refreshCraftQueueRecipeCacheInState: overrides.refreshCraftQueueRecipeCacheInState || (() => {}),
    buildCraftAssistDraftSnapshotFromScopedState: overrides.buildCraftAssistDraftSnapshotFromScopedState,
    normalizeCraftAssistApplyCount: overrides.normalizeCraftAssistApplyCount || ((value) => Math.max(1, Math.trunc(Number(value) || 1))),
    applyCraftAssistAutoSelection: overrides.applyCraftAssistAutoSelection,
    applyCraftAssistAutoSelectionBatch: overrides.applyCraftAssistAutoSelectionBatch || (async () => true),
    getCraftAccountScopedStateSnapshot: overrides.getCraftAccountScopedStateSnapshot || (() => ({
      craftRecipeQueue: [],
      craftActiveRecipeId: "",
      craftStatusText: "",
      craftStatusError: false,
      craftAssistSelecting: false
    })),
    getCraftAssistRuntimeStateSnapshot: overrides.getCraftAssistRuntimeStateSnapshot || (() => ({
      craftAssistSelecting: false,
      craftAssistPendingUiAction: "",
      craftAssistPendingPresetId: "",
      craftAssistRunToken: ""
    })),
    createDefaultCraftAssistRuntimeState: overrides.createDefaultCraftAssistRuntimeState || (() => ({
      craftAssistSelecting: false,
      craftAssistPendingUiAction: "",
      craftAssistPendingPresetId: "",
      craftAssistRunToken: ""
    })),
    commitCraftAccountScopedState: overrides.commitCraftAccountScopedState || ((_username, scopedState) => scopedState),
    setCraftStatusOnScopedState: overrides.setCraftStatusOnScopedState || ((scopedState, text, isError = false) => {
      scopedState.craftStatusText = String(text || "").trim();
      scopedState.craftStatusError = !!isError;
    }),
    showErrorToast: overrides.showErrorToast || (() => {}),
    resetCraftRecipeEntryPreparation: overrides.resetCraftRecipeEntryPreparation || (() => {}),
    buildRowsByAssetId: overrides.buildRowsByAssetId || ((rows) => new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row && (row.asset_id || row.assetid || row.id) || "").trim(), row]))),
    syncCraftRecipeEntryItemSources: overrides.syncCraftRecipeEntryItemSources || (() => {}),
    getCraftComponentSummaryMapForAccount: overrides.getCraftComponentSummaryMapForAccount || (() => ({})),
    logCraftAssistPickedRows: overrides.logCraftAssistPickedRows || (() => {}),
    getTradeUpRecipeFromRows: overrides.getTradeUpRecipeFromRows || (() => ({ok: true, reason: ""})),
    craftRarityLabel: overrides.craftRarityLabel || ((value) => String(value || "")),
    Promise
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function createPreset(overrides = {}) {
  return {
    id: "preset_legacy",
    name: "Legacy preset",
    target_wear: 0.214285,
    target_wear_raw: undefined,
    materials: [{id: "mat_1", role: "main", count: 10, items: [{id: "mat_1__1", name: "AK"}]}],
    created_at: 11,
    updated_at: 22,
    ...overrides
  };
}

function test_save_current_preset_persists_target_wear_raw_and_step() {
  let persisted = 0;
  const state = {
    craftAssistTargetWear: Math.fround(0.21),
    craftAssistTargetWearRaw: "0.21",
    craftAssistMaterials: [{id: "mat_1", role: "main", count: 10, items: [{id: "mat_1__1", name: "AK"}]}],
    craftAssistPresets: []
  };
  const app = loadTargetWearFns({
    state,
    saveCraftAssistPresetsToStorage: () => {
      persisted += 1;
    }
  });

  const ok = app.saveCurrentCraftAssistPreset("Legacy preset");

  assert.equal(ok, true);
  assert.equal(persisted, 1);
  assert.equal(state.craftAssistPresets.length, 1);
  assert.equal(state.craftAssistPresets[0].target_wear_raw, "0.21");
  assert.equal(state.craftAssistPresets[0].target_wear, Math.fround(0.21));
  assert.equal(Math.fround(state.craftAssistPresets[0].target_wear), state.craftAssistPresets[0].target_wear);
}

function test_load_legacy_raw_decimal_preset_migrates_raw_and_step() {
  const state = {
    craftAssistTargetWear: null,
    craftAssistTargetWearRaw: "",
    craftAssistMaterials: []
  };
  const app = loadTargetWearFns({state});

  const loaded = app.loadCraftAssistPresetIntoDraft(createPreset({target_wear: 0.21, target_wear_raw: undefined}));

  assert.equal(loaded.target_wear_raw, "0.21");
  assert.equal(loaded.target_wear, Math.fround(0.21));
  assert.equal(state.craftAssistTargetWearRaw, "0.21");
  assert.equal(state.craftAssistTargetWear, Math.fround(0.21));
  assert.equal(Math.fround(state.craftAssistTargetWear), state.craftAssistTargetWear);
}

function test_load_f32_step_only_legacy_preset_backfills_stringified_step() {
  const step = Math.fround(0.21);
  const app = loadTargetWearFns();

  const list = app.normalizeCraftAssistPresetList([createPreset({target_wear: step, target_wear_raw: undefined})]);

  assert.equal(list.length, 1);
  assert.equal(list[0].target_wear_raw, String(step));
  assert.equal(list[0].target_wear, step);
  assert.equal(Math.fround(list[0].target_wear), list[0].target_wear);
}

function test_load_mismatched_dual_field_preset_trusts_raw() {
  const step = prevFloat32(Math.fround(0.21));
  const app = loadTargetWearFns();

  const list = app.normalizeCraftAssistPresetList([createPreset({target_wear: step, target_wear_raw: "0.21"})]);

  assert.equal(list.length, 1);
  assert.equal(list[0].target_wear_raw, "0.21");
  assert.equal(list[0].target_wear, Math.fround(0.21));
  assert.notEqual(list[0].target_wear, step);
}

function test_rejects_unparsable_target_wear_raw() {
  const app = loadTargetWearFns();

  const list = app.normalizeCraftAssistPresetList([createPreset({target_wear: 0.21, target_wear_raw: "not-a-number"})]);

  assert.equal(list.length, 0);
}

function test_sanitize_rejects_missing_target_wear_fields() {
  const app = loadTargetWearFns();

  const preset = app.sanitizeCraftAssistPresetPayload(createPreset({
    target_wear: undefined,
    target_wear_raw: undefined
  }));

  assert.equal(preset, null);
}

function test_rejects_target_wear_raw_above_one() {
  const app = loadTargetWearFns();

  const list = app.normalizeCraftAssistPresetList([createPreset({target_wear: 0.21, target_wear_raw: "1.2"})]);

  assert.equal(list.length, 0);
}

function test_rejects_target_wear_raw_below_zero() {
  const app = loadTargetWearFns();

  const list = app.normalizeCraftAssistPresetList([createPreset({target_wear: 0.21, target_wear_raw: "-0.1"})]);

  assert.equal(list.length, 0);
}

function test_draft_snapshot_and_restore_preserve_target_wear_raw() {
  const state = {
    craftAssistOpen: true,
    craftAssistTargetWear: Math.fround(0.21),
    craftAssistTargetWearRaw: "0.21",
    craftAssistMaterials: [{id: "mat_1", role: "main", count: 10, items: [{id: "mat_1__1", name: "AK"}]}],
    craftAssistPickRole: "aux",
    craftAssistPickerOpen: true,
    craftAssistPickerTargetMaterialId: "mat_1",
    craftAssistRoleChooserOpen: true
  };
  const app = loadTargetWearFns({state});

  const snapshot = app.buildCraftAssistDraftSnapshotFromState();
  assert.equal(snapshot.target_wear_raw, "0.21");
  assert.equal(snapshot.target_wear, Math.fround(0.21));

  state.craftAssistTargetWear = null;
  state.craftAssistTargetWearRaw = "";
  state.craftAssistMaterials = [];
  state.craftAssistPickRole = "main";
  state.craftAssistPickerOpen = false;
  state.craftAssistPickerTargetMaterialId = "";
  state.craftAssistRoleChooserOpen = false;

  app.restoreCraftAssistDraftSnapshot(snapshot);

  assert.equal(state.craftAssistTargetWearRaw, "0.21");
  assert.equal(state.craftAssistTargetWear, Math.fround(0.21));
  assert.equal(state.craftAssistPickRole, "aux");
}

function test_load_legacy_preset_into_draft_rejects_unparsable_raw() {
  const state = {
    craftAssistTargetWear: null,
    craftAssistTargetWearRaw: "",
    craftAssistMaterials: []
  };
  const app = loadTargetWearFns({state});

  const loaded = app.loadCraftAssistPresetIntoDraft(createPreset({target_wear: 0.21, target_wear_raw: "bad-raw"}));

  assert.equal(loaded, null);
  assert.equal(state.craftAssistTargetWearRaw, "");
  assert.equal(state.craftAssistTargetWear, null);
}

async function test_apply_preset_auto_select_passes_float32_target_wear_without_frontend_below_step() {
  const rawTargetWear = 0.214285;
  const expectedTargetWear = Math.fround(rawTargetWear);
  const belowTargetWear = prevFloat32(expectedTargetWear);
  const captured = [];
  const state = {
    currentAccountUsername: "acc-a",
    accountSelectedUsername: "",
    craftAssistOpen: true,
    craftAssistTargetWear: 0.5,
    craftAssistMaterials: [{id: "draft_mat", role: "main", count: 10, items: [{id: "draft_mat__1", name: "Draft"}]}],
    craftAssistPickRole: "main",
    craftAssistPresets: [createPreset({target_wear: rawTargetWear})]
  };
  const app = loadTargetWearFns({
    state,
    applyCraftAssistAutoSelectionBatch: async (options) => {
      captured.push({
        mode: state.craftAssistApproachMode ? "infinite" : "below",
        options
      });
      return true;
    }
  });

  state.craftAssistApproachMode = false;
  assert.equal(await app.applyCraftAssistPreset("preset_legacy", {autoSelect: true}), true);
  state.craftAssistApproachMode = true;
  assert.equal(await app.applyCraftAssistPreset("preset_legacy", {autoSelect: true}), true);

  assert.deepEqual(captured.map((entry) => entry.mode), ["below", "infinite"]);
  for (const entry of captured) {
    const snapshot = entry.options && entry.options.draftSnapshot;
    assert.equal(snapshot.target_wear, expectedTargetWear);
    assert.equal(Math.fround(snapshot.target_wear), snapshot.target_wear);
    assert.notEqual(snapshot.target_wear, belowTargetWear);
    assert.equal(entry.options.pendingUiAction, "preset_apply");
    assert.equal(entry.options.pendingPresetId, "preset_legacy");
  }
}

async function test_auto_select_request_quantizes_legacy_preset_target_wear() {
  let request = null;
  const scopedState = {
    craftRecipeQueue: [],
    craftActiveRecipeId: "",
    craftAssistSelecting: false
  };
  const app = loadTargetWearFns({
    state: {
      currentAccountUsername: "acc-a",
      craftAssistSelecting: false,
      craftAssistApproachMode: false,
      craftAssistWearOffsetPct: 5,
      craftUseComponentItems: false,
      craftIncludeCooling: false,
      craftAssistFastMode: false
    },
    getCraftRowsForAccount: () => [{asset_id: "seed-1"}],
    getCraftQueuePendingEntriesFromState: () => scopedState.craftRecipeQueue,
    commitCraftAccountScopedStateForUsername: (_username, updater) => {
      updater(scopedState);
    },
    getCraftAccountScopedStateSnapshot: () => scopedState,
    commitCraftAccountScopedState: () => scopedState,
    createEmptyCraftRecipeEntryInState: (targetState) => {
      const entry = {id: "recipe-1"};
      targetState.craftRecipeQueue.push(entry);
      return entry;
    },
    api: async (_path, options = {}) => {
      request = JSON.parse(String(options.body || "{}"));
      return {item_ids: Array.from({length: 10}, (_, index) => `item-${index + 1}`)};
    }
  });

  const ok = await app.applyCraftAssistAutoSelection({
    accountUsername: "acc-a",
    draftSnapshot: {
      target_wear: 0.214285,
      materials: [{id: "mat_1", role: "main", count: 10, items: [{id: "mat_1__1", name: "AK"}]}]
    }
  });

  assert.equal(ok, true);
  assert.equal(request.target_wear, Math.fround(0.214285));
  assert.equal(Math.fround(request.target_wear), request.target_wear);
  assert.equal(request.wear_approach_mode, "below");
  assert.equal(request.wear_offset_pct, 5);
}

async function test_batch_request_quantizes_legacy_preset_target_wear() {
  let request = null;
  const app = loadTargetWearFns({
    state: {
      batchCraftApproachMode: true,
      batchCraftUseComponentItems: false,
      batchCraftIncludeCooling: false,
      batchCraftWearOffsetPct: 9,
      batchCraftFastMode: false
    },
    getCraftRowsForAccount: () => [{asset_id: "seed-1"}],
    api: async (_path, options = {}) => {
      request = JSON.parse(String(options.body || "{}"));
      return {item_ids: Array.from({length: 10}, (_, index) => `item-${index + 1}`)};
    }
  });

  const result = await app.callBatchCraftAssistSelectForAccount(
    "acc-b",
    {
      target_wear: 0.214285,
      materials: [{id: "mat_1", role: "main", count: 10, items: [{id: "mat_1__1", name: "AK"}]}]
    },
    []
  );

  assert.equal(result && result.failed, undefined);
  assert.equal(request.target_wear, Math.fround(0.214285));
  assert.equal(Math.fround(request.target_wear), request.target_wear);
  assert.equal(request.wear_approach_mode, "infinite");
  assert.equal(request.wear_offset_pct, 9);
}

async function main() {
  test_save_current_preset_persists_target_wear_raw_and_step();
  test_load_legacy_raw_decimal_preset_migrates_raw_and_step();
  test_load_f32_step_only_legacy_preset_backfills_stringified_step();
  test_load_mismatched_dual_field_preset_trusts_raw();
  test_rejects_unparsable_target_wear_raw();
  test_sanitize_rejects_missing_target_wear_fields();
  test_rejects_target_wear_raw_above_one();
  test_rejects_target_wear_raw_below_zero();
  test_draft_snapshot_and_restore_preserve_target_wear_raw();
  test_load_legacy_preset_into_draft_rejects_unparsable_raw();
  await test_apply_preset_auto_select_passes_float32_target_wear_without_frontend_below_step();
  await test_auto_select_request_quantizes_legacy_preset_target_wear();
  await test_batch_request_quantizes_legacy_preset_target_wear();
  console.log("craft-assist-target-wear-step tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
