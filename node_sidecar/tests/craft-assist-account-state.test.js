const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function extractConst(name) {
  const match = APP_SOURCE.match(new RegExp(`^const\\s+${name}\\s*=\\s*[^;]+;`, "m"));
  assert.ok(match, `missing const ${name}`);
  return match[0];
}

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

function loadCraftAssistAccountStateFns(initialState = {}) {
  const source = [
    extractConst("DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT"),
    extractBlock("function createDefaultCraftAssistRuntimeState(", "function clearCraftCandidateState(")
  ].join("\n");
  const context = {
    Math,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
    JSON,
    console,
    state: {
      currentAccountUsername: "acc-a",
      craftSelectedItemIds: new Set(),
      craftStatusText: "",
      craftRecipeQueue: [],
      craftActiveRecipeId: "",
      craftAssistSelecting: false,
      craftAssistPendingUiAction: "",
      craftAssistPendingPresetId: "",
      craftAssistOpen: false,
      craftAssistPickerOpen: false,
      craftAssistPickerTargetMaterialId: "",
      craftAssistRoleChooserOpen: false,
      craftAssistPickRole: "main",
      craftAssistUseAbsoluteWear: false,
      craftAssistTargetWear: null,
      craftAssistMainCount: 5,
      craftAssistAuxCount: 5,
      craftAssistMaterials: [],
      craftAssistPresetApplyCountMap: {},
      craftAssistPresetEditingId: "",
      craftAssistPresetEditingName: "",
      craftAssistPresetEditingBackup: null,
      craftAssistPresetEditingInitialSnapshot: null,
      craftAccountStateByAccount: new Map(),
      craftAssistRuntimeByAccount: new Map(),
      ...initialState
    },
    deepCopyPlain(value) {
      return JSON.parse(JSON.stringify(value));
    }
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function testSaveAndRestoreCraftAccountScopedStateKeepsDraftButClearsRuntimeBusyFlags() {
  const app = loadCraftAssistAccountStateFns({
    craftSelectedItemIds: new Set(["a1", "a2"]),
    craftStatusText: "账号A处理中",
    craftRecipeQueue: [{id: "queue-a", item_ids: ["x1"]}],
    craftActiveRecipeId: "queue-a",
    craftAssistSelecting: true,
    craftAssistPendingUiAction: "panel_apply",
    craftAssistPendingPresetId: "preset-a",
    craftAssistOpen: true,
    craftAssistPickRole: "aux",
    craftAssistTargetWear: 0.2142,
    craftAssistMaterials: [{id: "m1", names: ["AK"], count: 3}],
    craftAssistPresetApplyCountMap: {presetA: 2}
  });

  assert.equal(typeof app.saveCraftAccountScopedState, "function", "expected save helper to exist");
  assert.equal(typeof app.restoreCraftAccountScopedState, "function", "expected restore helper to exist");

  app.saveCraftAccountScopedState("acc-a");

  app.state.craftSelectedItemIds = new Set(["b1"]);
  app.state.craftStatusText = "账号B";
  app.state.craftRecipeQueue = [];
  app.state.craftAssistSelecting = false;
  app.state.craftAssistPendingUiAction = "";
  app.state.craftAssistPendingPresetId = "";
  app.state.craftAssistOpen = false;
  app.state.craftAssistPickRole = "main";
  app.state.craftAssistTargetWear = null;
  app.state.craftAssistMaterials = [];
  app.state.craftAssistPresetApplyCountMap = {};

  app.restoreCraftAccountScopedState("acc-a");

  assert.deepEqual(Array.from(app.state.craftSelectedItemIds), ["a1", "a2"]);
  assert.equal(app.state.craftStatusText, "账号A处理中");
  assert.equal(app.state.craftRecipeQueue[0].id, "queue-a");
  assert.equal(app.state.craftAssistSelecting, false);
  assert.equal(app.state.craftAssistPendingUiAction, "");
  assert.equal(app.state.craftAssistPendingPresetId, "");
  assert.equal(app.state.craftAssistOpen, true);
  assert.equal(app.state.craftAssistPickRole, "aux");
  assert.equal(app.state.craftAssistTargetWear, 0.2142);
  assert.equal(app.state.craftAssistMaterials[0].id, "m1");
  assert.equal(app.state.craftAssistPresetApplyCountMap.presetA, 2);
}

function testMissingAccountRestoresEmptyDefaults() {
  const app = loadCraftAssistAccountStateFns({
    craftAssistSelecting: true,
    craftAssistTargetWear: 0.3,
    craftAssistMaterials: [{id: "old"}]
  });

  app.restoreCraftAccountScopedState("acc-missing");

  assert.equal(app.state.craftAssistSelecting, false);
  assert.equal(app.state.craftAssistTargetWear, null);
  assert.deepEqual(Array.from(app.state.craftSelectedItemIds), []);
  assert.deepEqual(Array.from(app.state.craftAssistMaterials), []);
}

function testRestoreCanStillShowLiveRuntimeBusyStateForCurrentAccount() {
  const app = loadCraftAssistAccountStateFns({
    craftAssistOpen: true,
    craftAssistTargetWear: 0.123,
    craftAssistMaterials: [{id: "m-live"}]
  });

  assert.equal(typeof app.saveCraftAssistRuntimeState, "function", "expected runtime save helper to exist");

  app.saveCraftAccountScopedState("acc-a");
  app.saveCraftAssistRuntimeState("acc-a", {
    craftAssistSelecting: true,
    craftAssistPendingUiAction: "preset_apply",
    craftAssistPendingPresetId: "preset-live"
  });

  app.state.craftAssistSelecting = false;
  app.state.craftAssistPendingUiAction = "";
  app.state.craftAssistPendingPresetId = "";
  app.restoreCraftAccountScopedState("acc-a");

  assert.equal(app.state.craftAssistSelecting, true);
  assert.equal(app.state.craftAssistPendingUiAction, "preset_apply");
  assert.equal(app.state.craftAssistPendingPresetId, "preset-live");
  assert.equal(app.state.craftAssistOpen, true);
  assert.equal(app.state.craftAssistMaterials[0].id, "m-live");
}

function testRestoreDropsLegacyBusyRuntimeSnapshotWithoutPendingAction() {
  const app = loadCraftAssistAccountStateFns({
    craftAssistOpen: true,
    craftAssistTargetWear: 0.456,
    craftAssistMaterials: [{id: "m-legacy"}]
  });

  app.saveCraftAccountScopedState("acc-a");
  app.saveCraftAssistRuntimeState("acc-a", {
    craftAssistSelecting: true,
    craftAssistPendingUiAction: "",
    craftAssistPendingPresetId: "preset-stale"
  });

  app.state.craftAssistSelecting = false;
  app.state.craftAssistPendingUiAction = "";
  app.state.craftAssistPendingPresetId = "";
  app.restoreCraftAccountScopedState("acc-a");

  assert.equal(
    app.state.craftAssistSelecting,
    false,
    "runtime busy flag without an active pending action should be discarded during restore"
  );
  assert.equal(app.state.craftAssistPendingUiAction, "");
  assert.equal(app.state.craftAssistPendingPresetId, "");
}

function main() {
  testSaveAndRestoreCraftAccountScopedStateKeepsDraftButClearsRuntimeBusyFlags();
  testMissingAccountRestoresEmptyDefaults();
  testRestoreCanStillShowLiveRuntimeBusyStateForCurrentAccount();
  testRestoreDropsLegacyBusyRuntimeSnapshotWithoutPendingAction();
  console.log("craft-assist-account-state tests passed");
}

main();
