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

function loadApplyPresetFn(overrides = {}) {
  const source = [
    extractBlock("function resolveCraftAssistTargetWearPair(", "function normalizeCraftAssistTargetWearStepOrFallback("),
    extractBlock("async function applyCraftAssistPreset(", "function saveCraftAssistPresetEditingSession(")
  ].join("\n");
  const context = {
    Array,
    Math,
    Number,
    String,
    parseOptionalWear01: overrides.parseOptionalWear01 || ((value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }),
    state: overrides.state,
    sanitizeCraftAssistPresetPayload: overrides.sanitizeCraftAssistPresetPayload,
    buildCraftAssistDraftSnapshotFromState: overrides.buildCraftAssistDraftSnapshotFromState,
    restoreCraftAssistDraftSnapshot: overrides.restoreCraftAssistDraftSnapshot,
    normalizeCraftAssistApplyCount: overrides.normalizeCraftAssistApplyCount,
    applyCraftAssistAutoSelectionBatch: overrides.applyCraftAssistAutoSelectionBatch,
    isCraftAssistPresetEditing: overrides.isCraftAssistPresetEditing,
    clearCraftAssistPresetEditingState: overrides.clearCraftAssistPresetEditingState,
    loadCraftAssistPresetIntoDraft: overrides.loadCraftAssistPresetIntoDraft,
    saveCraftAssistPresetsToStorage: overrides.saveCraftAssistPresetsToStorage,
    renderCraftAssistPanel: overrides.renderCraftAssistPanel,
    setCraftStatus: overrides.setCraftStatus,
    Date: overrides.Date || Date,
    console
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

async function testAutoSelectDoesNotMutateLiveDraftState() {
  const targetWearRaw = "0.21";
  const targetWearStep = Math.fround(Number(targetWearRaw));
  const originalDraft = {
    panel_open: true,
    target_wear: 0.2142,
    materials: [{id: "live", role: "main", count: 10, items: [{id: "live__1", name: "LIVE", wear_filter_mode: "absolute", wear_min: 0.01, wear_max: 0.07, custom_range: true}]}],
    pick_role: "main"
  };
  const preset = {
    id: "preset-1",
    name: "Preset One",
    target_wear: targetWearStep,
    target_wear_raw: targetWearRaw,
    materials: [{id: "preset", role: "aux", count: 10, items: [{id: "preset__1", name: "PRESET", wear_filter_mode: "relative", wear_min: 0.2, wear_max: 0.5, custom_range: false}]}]
  };
  const state = {
    craftAssistPresets: [preset],
    craftAssistPresetEditingId: "",
    craftAssistPresetEditingName: "",
    craftAssistPresetEditingBackup: null,
    craftAssistPresetEditingInitialSnapshot: null,
    craftAssistTargetWear: originalDraft.target_wear,
    craftAssistMaterials: originalDraft.materials,
    craftAssistPickRole: originalDraft.pick_role
  };
  const restoreCalls = [];
  let receivedBatchArgs = null;
  let renderCalls = 0;
  const app = loadApplyPresetFn({
    state,
    sanitizeCraftAssistPresetPayload: (value) => value,
    buildCraftAssistDraftSnapshotFromState: () => ({
      panel_open: originalDraft.panel_open,
      target_wear: state.craftAssistTargetWear,
      materials: state.craftAssistMaterials,
      pick_role: state.craftAssistPickRole
    }),
    restoreCraftAssistDraftSnapshot: (snapshot) => {
      restoreCalls.push(snapshot);
      state.craftAssistTargetWear = snapshot.target_wear;
      state.craftAssistMaterials = snapshot.materials;
      state.craftAssistPickRole = snapshot.pick_role;
    },
    normalizeCraftAssistApplyCount: (value) => Number(value) || 1,
    applyCraftAssistAutoSelectionBatch: async (args) => {
      receivedBatchArgs = args;
      assert.equal(state.craftAssistTargetWear, originalDraft.target_wear, "live target wear should stay unchanged during preset auto-apply");
      assert.deepEqual(state.craftAssistMaterials, originalDraft.materials, "live materials should stay unchanged during preset auto-apply");
      return true;
    },
    isCraftAssistPresetEditing: () => false,
    clearCraftAssistPresetEditingState: () => {
      throw new Error("should not clear editing state in autoSelect path");
    },
    loadCraftAssistPresetIntoDraft: () => {
      throw new Error("should not load preset into live draft in autoSelect path");
    },
    saveCraftAssistPresetsToStorage: () => {},
    renderCraftAssistPanel: () => {
      renderCalls += 1;
    },
    setCraftStatus: () => {}
  });

  const ok = await app.applyCraftAssistPreset("preset-1", {autoSelect: true, applyCount: 2});

  assert.equal(ok, true);
  assert.equal(JSON.stringify(receivedBatchArgs), JSON.stringify({
    sourcePresetName: "Preset One",
    repeatCount: 2,
      draftSnapshot: {
        panel_open: true,
        target_wear: targetWearStep,
        target_wear_raw: targetWearRaw,
        materials: preset.materials,
        pick_role: "main"
      },
    pendingUiAction: "preset_apply",
    pendingPresetId: "preset-1"
  }));
  assert.equal(restoreCalls.length, 0, "autoSelect path should not restore live draft snapshots anymore");
  assert.equal(state.craftAssistTargetWear, originalDraft.target_wear);
  assert.deepEqual(state.craftAssistMaterials, originalDraft.materials);
  assert.equal(renderCalls, 0);
}

async function testLegacyPresetWithoutRawReconstructsRawForAutoSelectHandoff() {
  const legacyTargetWear = 0.21;
  const legacyTargetWearStep = Math.fround(legacyTargetWear);
  const preset = {
    id: "preset-legacy",
    name: "Legacy Preset",
    target_wear: legacyTargetWear,
    materials: [{id: "preset", role: "aux", count: 10, items: [{id: "preset__1", name: "PRESET", wear_filter_mode: "relative", wear_min: 0.2, wear_max: 0.5, custom_range: false}]}]
  };
  assert.equal(Object.prototype.hasOwnProperty.call(preset, "target_wear_raw"), false);
  const state = {
    craftAssistPresets: [preset],
    craftAssistPresetEditingId: "",
    craftAssistPresetEditingName: "",
    craftAssistPresetEditingBackup: null,
    craftAssistPresetEditingInitialSnapshot: null,
    craftAssistTargetWear: 0.2142,
    craftAssistMaterials: preset.materials,
    craftAssistPickRole: "main"
  };
  let receivedBatchArgs = null;
  const app = loadApplyPresetFn({
    state,
    sanitizeCraftAssistPresetPayload: (value) => value,
    buildCraftAssistDraftSnapshotFromState: () => ({
      panel_open: true,
      target_wear: state.craftAssistTargetWear,
      materials: state.craftAssistMaterials,
      pick_role: state.craftAssistPickRole
    }),
    restoreCraftAssistDraftSnapshot: () => {
      throw new Error("should not restore live draft in legacy autoSelect path");
    },
    normalizeCraftAssistApplyCount: (value) => Number(value) || 1,
    applyCraftAssistAutoSelectionBatch: async (args) => {
      receivedBatchArgs = args;
      return true;
    },
    isCraftAssistPresetEditing: () => false,
    clearCraftAssistPresetEditingState: () => {},
    loadCraftAssistPresetIntoDraft: () => {
      throw new Error("should not load preset into live draft in autoSelect path");
    },
    saveCraftAssistPresetsToStorage: () => {},
    renderCraftAssistPanel: () => {},
    setCraftStatus: () => {}
  });

  const ok = await app.applyCraftAssistPreset("preset-legacy", {autoSelect: true, applyCount: 1});

  assert.equal(ok, true);
  assert.equal(receivedBatchArgs.sourcePresetName, "Legacy Preset");
  assert.equal(receivedBatchArgs.draftSnapshot.target_wear_raw, "0.21");
  assert.equal(receivedBatchArgs.draftSnapshot.target_wear, legacyTargetWearStep);
}

async function main() {
  await testAutoSelectDoesNotMutateLiveDraftState();
  await testLegacyPresetWithoutRawReconstructsRawForAutoSelectHandoff();
  console.log("craft-assist-preset-apply tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
