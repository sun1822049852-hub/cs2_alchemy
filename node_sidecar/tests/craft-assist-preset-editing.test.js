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

function loadDirtyFns(overrides = {}) {
  const source = [
    extractBlock("function resolveCraftAssistTargetWearPair(", "function normalizeCraftAssistTargetWearStepOrFallback("),
    extractBlock("function buildCraftAssistPresetComparableSnapshot(", "function getCurrentCraftAssistPresetComparableSnapshot("),
    extractBlock("function getCurrentCraftAssistPresetComparableSnapshot(", "function isCraftAssistPresetEditingDirty("),
    extractBlock("function isCraftAssistPresetEditingDirty(", "function restoreCraftAssistDraftSnapshot(")
  ].join("\n");
  const context = {
    state: overrides.state,
    parseOptionalWear01: overrides.parseOptionalWear01 || ((value) => value == null ? null : Number(value)),
    normalizeCraftAssistTargetWearStep: overrides.normalizeCraftAssistTargetWearStep || ((value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Math.fround(Math.max(0, Math.min(1, numeric))) : null;
    }),
    projectCraftAssistPersistedMaterialsFromState: overrides.projectCraftAssistPersistedMaterialsFromState || ((materials) => JSON.parse(JSON.stringify(Array.isArray(materials) ? materials : []))),
    normalizeCraftAssistMaterialList: overrides.normalizeCraftAssistMaterialList || ((materials) => Array.isArray(materials) ? materials : []),
    normalizeCraftAssistFilterMode: overrides.normalizeCraftAssistFilterMode || ((mode) => String(mode || "").trim() === "absolute" ? "absolute" : "relative"),
    getAllInventoryCraftableRows: overrides.getAllInventoryCraftableRows || (() => []),
    getCraftAssistFilterMode: overrides.getCraftAssistFilterMode || (() => "relative"),
    isCraftAssistPresetEditing: overrides.isCraftAssistPresetEditing || (() => !!String(overrides.state && overrides.state.craftAssistPresetEditingId || "").trim()),
    JSON,
    String,
    Number,
    console
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function loadEditingFns(overrides = {}) {
  const source = extractBlock("function saveCraftAssistPresetEditingSession(", "function applyCraftAssistPresetForEdit(");
  const context = {
    state: overrides.state,
    guardGuestAction: overrides.guardGuestAction || (() => true),
    sanitizeCraftAssistPresetPayload: overrides.sanitizeCraftAssistPresetPayload || ((value) => value),
    validateCraftAssistMaterialEntriesForSave: overrides.validateCraftAssistMaterialEntriesForSave || (() => ({ok: true})),
    buildCurrentCraftAssistPresetSnapshot: overrides.buildCurrentCraftAssistPresetSnapshot || ((name) => ({name})),
    validateCraftAssistPresetSnapshot: overrides.validateCraftAssistPresetSnapshot || (() => ({ok: true})),
    normalizeCraftAssistPresetList: overrides.normalizeCraftAssistPresetList || ((list) => list),
    saveCraftAssistPresetsToStorage: overrides.saveCraftAssistPresetsToStorage || (() => {}),
    clearCraftAssistPresetEditingState: overrides.clearCraftAssistPresetEditingState || (() => {}),
    setCraftAssistPanelOpen: overrides.setCraftAssistPanelOpen || (() => {}),
    setCraftStatus: overrides.setCraftStatus || (() => {}),
    renderCraftAssistPanel: overrides.renderCraftAssistPanel || (() => {}),
    String,
    Number,
    Array,
    Date: overrides.Date || Date,
    console
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function loadDuplicateFn(overrides = {}) {
  const source = extractBlock("function duplicateCraftAssistPreset(", "function renderCraftAssistPresetPanel(");
  const context = {
    state: overrides.state,
    guardGuestAction: overrides.guardGuestAction || (() => true),
    sanitizeCraftAssistPresetPayload: overrides.sanitizeCraftAssistPresetPayload || ((value) => value),
    makeCraftAssistUid: overrides.makeCraftAssistUid || (() => "preset_dup"),
    normalizeCraftAssistPresetList: overrides.normalizeCraftAssistPresetList || ((list) => list),
    saveCraftAssistPresetsToStorage: overrides.saveCraftAssistPresetsToStorage || (() => {}),
    renderCraftAssistPanel: overrides.renderCraftAssistPanel || (() => {}),
    setCraftStatus: overrides.setCraftStatus || (() => {}),
    String,
    Number,
    Array,
    Date: overrides.Date || Date,
    console
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function testRenameCountsAsDirtyEditingState() {
  const state = {
    craftAssistPresetEditingId: "preset_1",
    craftAssistPresetEditingName: "赤线（副本）",
    craftAssistPresetEditingInitialSnapshot: null,
    craftAssistTargetWear: Math.fround(0.21),
    craftAssistTargetWearRaw: "0.21",
    craftAssistMaterials: [{id: "mat_1", count: 10}]
  };
  const app = loadDirtyFns({state});
  state.craftAssistPresetEditingInitialSnapshot = app.buildCraftAssistPresetComparableSnapshot({
    name: "赤线",
    targetWear: Math.fround(0.21),
    targetWearRaw: "0.21",
    materials: [{id: "mat_1", count: 10}]
  });

  assert.equal(
    app.isCraftAssistPresetEditingDirty(),
    true,
    "changing only the preset name should still mark the editing session as dirty"
  );
}

function testTargetWearRawDifferenceCountsAsDirtyEditingState() {
  const state = {
    craftAssistPresetEditingId: "preset_1",
    craftAssistPresetEditingName: "赤线",
    craftAssistPresetEditingInitialSnapshot: null,
    craftAssistTargetWear: Math.fround(0.21),
    craftAssistTargetWearRaw: String(Math.fround(0.21)),
    craftAssistMaterials: [{id: "mat_1", count: 10}]
  };
  const app = loadDirtyFns({state});
  state.craftAssistPresetEditingInitialSnapshot = app.buildCraftAssistPresetComparableSnapshot({
    name: "赤线",
    targetWear: Math.fround(0.21),
    targetWearRaw: "0.21",
    materials: [{id: "mat_1", count: 10}]
  });

  assert.equal(
    app.isCraftAssistPresetEditingDirty(),
    true,
    "changing only the preserved raw decimal should still mark the editing session as dirty"
  );
}

function testSaveEditingSessionPersistsEditedName() {
  const statusCalls = [];
  let savedToStorage = 0;
  let renderCalls = 0;
  const state = {
    craftAssistPresetEditingId: "preset_1",
    craftAssistPresetEditingName: "新配置名",
    craftAssistPresetEditingBackup: {panel_open: true},
    craftAssistPresets: [{
      id: "preset_1",
      name: "旧配置名",
      target_wear: 0.1,
      target_wear_raw: "0.1",
      materials: [{id: "mat_1", count: 10}],
      created_at: 11,
      updated_at: 11
    }],
    craftAssistMaterials: [{id: "mat_1", count: 10}]
  };
  const app = loadEditingFns({
    state,
    sanitizeCraftAssistPresetPayload: (value) => value ? JSON.parse(JSON.stringify(value)) : value,
    buildCurrentCraftAssistPresetSnapshot: (name) => ({
      id: "snapshot_1",
      name,
      target_wear: 0.2,
      target_wear_raw: "0.21",
      materials: [{id: "mat_1", count: 10}],
      created_at: 22,
      updated_at: 22
    }),
    validateCraftAssistPresetSnapshot: () => ({ok: true}),
    normalizeCraftAssistPresetList: (list) => list,
    saveCraftAssistPresetsToStorage: () => {
      savedToStorage += 1;
    },
    clearCraftAssistPresetEditingState: () => {
      state.craftAssistPresetEditingId = "";
      state.craftAssistPresetEditingName = "";
    },
    setCraftAssistPanelOpen: () => {},
    setCraftStatus: (message) => {
      statusCalls.push(String(message || ""));
    },
    renderCraftAssistPanel: () => {
      renderCalls += 1;
    },
    Date: {now: () => 777}
  });

  const ok = app.saveCraftAssistPresetEditingSession();

  assert.equal(ok, true, "saving an editing session with a renamed preset should succeed");
  assert.equal(state.craftAssistPresets[0].name, "新配置名");
  assert.equal(state.craftAssistPresets[0].target_wear_raw, "0.21");
  assert.equal(state.craftAssistPresets[0].target_wear, 0.2);
  assert.equal(savedToStorage, 1, "renamed preset should still persist back to storage");
  assert.equal(renderCalls, 1, "renamed preset save should rerender the panel");
  assert.equal(
    statusCalls.some((message) => message.includes("新配置名")),
    true,
    "save status should mention the edited preset name"
  );
}

function testDuplicatePresetCreatesNamedCopyBesideOriginal() {
  const statusCalls = [];
  let savedToStorage = 0;
  let renderCalls = 0;
  const state = {
    craftAssistPresets: [
      {
        id: "preset_alpha",
        name: "赤线",
        target_wear: 0.123,
        target_wear_raw: "0.123",
        materials: [{id: "mat_1", count: 10, items: [{id: "mat_1__1", name: "赤线"}]}],
        created_at: 11,
        updated_at: 11
      },
      {
        id: "preset_beta",
        name: "蓝钢",
        target_wear: 0.456,
        target_wear_raw: "0.456",
        materials: [{id: "mat_2", count: 10, items: [{id: "mat_2__1", name: "蓝钢"}]}],
        created_at: 22,
        updated_at: 22
      }
    ]
  };
  const app = loadDuplicateFn({
    state,
    sanitizeCraftAssistPresetPayload: (value) => value ? JSON.parse(JSON.stringify(value)) : value,
    makeCraftAssistUid: () => "preset_copy",
    saveCraftAssistPresetsToStorage: () => {
      savedToStorage += 1;
    },
    renderCraftAssistPanel: () => {
      renderCalls += 1;
    },
    setCraftStatus: (message) => {
      statusCalls.push(String(message || ""));
    },
    Date: {now: () => 999}
  });

  app.duplicateCraftAssistPreset("preset_alpha");

  assert.equal(state.craftAssistPresets.length, 3, "duplicating a preset should insert one new preset");
  assert.equal(state.craftAssistPresets[1].id, "preset_copy");
  assert.equal(state.craftAssistPresets[1].name, "赤线（副本）");
  assert.equal(state.craftAssistPresets[1].target_wear_raw, "0.123");
  assert.deepEqual(state.craftAssistPresets[1].materials, [{id: "mat_1", count: 10, items: [{id: "mat_1__1", name: "赤线"}]}]);
  assert.equal(savedToStorage, 1, "duplicated preset should persist to storage");
  assert.equal(renderCalls, 1, "duplicated preset should rerender the preset panel");
  assert.equal(
    statusCalls.some((message) => message.includes("赤线（副本）")),
    true,
    "duplicate status should mention the new copy name"
  );
}

function main() {
  testRenameCountsAsDirtyEditingState();
  testTargetWearRawDifferenceCountsAsDirtyEditingState();
  testSaveEditingSessionPersistsEditedName();
  testDuplicatePresetCreatesNamedCopyBesideOriginal();
  console.log("craft-assist-preset-editing tests passed");
}

main();
