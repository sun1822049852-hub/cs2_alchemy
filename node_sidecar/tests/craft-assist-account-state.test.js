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
      craftAssistRunToken: "",
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
      craftAssistActiveRunTokensByAccount: new Map(),
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
    craftAssistMaterials: [{id: "m1", role: "main", count: 3, items: [{id: "m1__1", name: "AK", wear_filter_mode: "relative", wear_min: 0.1, wear_max: 0.2, custom_range: true}]}],
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
  assert.equal(app.state.craftAssistTargetWear, Math.fround(0.2142));
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
    craftAssistMaterials: [{id: "m-live", role: "main", count: 1, items: [{id: "m-live__1", name: "AK", wear_filter_mode: "absolute", wear_min: 0.03, wear_max: 0.07, custom_range: true}]}]
  });

  assert.equal(typeof app.saveCraftAssistRuntimeState, "function", "expected runtime save helper to exist");

  app.saveCraftAccountScopedState("acc-a");
  app.setCraftAssistActiveRunToken("acc-a", "token-live");
  app.saveCraftAssistRuntimeState("acc-a", {
    craftAssistSelecting: true,
    craftAssistPendingUiAction: "preset_apply",
    craftAssistPendingPresetId: "preset-live",
    craftAssistRunToken: "token-live"
  });

  app.state.craftAssistSelecting = false;
  app.state.craftAssistPendingUiAction = "";
  app.state.craftAssistPendingPresetId = "";
  app.restoreCraftAccountScopedState("acc-a");

  assert.equal(app.state.craftAssistSelecting, true);
  assert.equal(app.state.craftAssistPendingUiAction, "preset_apply");
  assert.equal(app.state.craftAssistPendingPresetId, "preset-live");
  assert.equal(app.state.craftAssistRunToken, "token-live");
  assert.equal(app.state.craftAssistOpen, true);
  assert.equal(app.state.craftAssistMaterials[0].id, "m-live");
}

function testRestoreDropsBusyRuntimeSnapshotWithoutActiveRunToken() {
  const app = loadCraftAssistAccountStateFns({
    craftAssistOpen: true,
    craftAssistTargetWear: 0.456,
    craftAssistMaterials: [{id: "m-legacy", role: "aux", count: 1, items: [{id: "m-legacy__1", name: "USP-S", wear_filter_mode: "relative", wear_min: 0.2, wear_max: 0.4, custom_range: false}]}]
  });

  app.saveCraftAccountScopedState("acc-a");
  app.saveCraftAssistRuntimeState("acc-a", {
    craftAssistSelecting: true,
    craftAssistPendingUiAction: "panel_apply",
    craftAssistPendingPresetId: "",
    craftAssistRunToken: "token-stale"
  });

  app.state.craftAssistSelecting = false;
  app.state.craftAssistPendingUiAction = "";
  app.state.craftAssistPendingPresetId = "";
  app.state.craftAssistRunToken = "";
  app.restoreCraftAccountScopedState("acc-a");

  assert.equal(
    app.state.craftAssistSelecting,
    false,
    "runtime busy flag without an active run token should be discarded during restore"
  );
  assert.equal(app.state.craftAssistPendingUiAction, "");
  assert.equal(app.state.craftAssistPendingPresetId, "");
  assert.equal(app.state.craftAssistRunToken, "");
}

function testAccountScopedWritebackUsesItemLevelMaterialsAndOmitsLegacyTopLevelFields() {
  const app = loadCraftAssistAccountStateFns({
    craftAssistUseAbsoluteWear: true,
    craftAssistMainCount: 4,
    craftAssistAuxCount: 6,
    craftAssistMaterials: [{
      id: "m-write",
      role: "main",
      count: 4,
      items: [
        {id: "m-write__1", name: "AK", wear_filter_mode: "absolute", wear_min: 0.01, wear_max: 0.07, custom_range: true}
      ],
      label: "AK"
    }]
  });

  const snapshot = app.buildCurrentCraftAccountScopedStateSnapshot();

  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, "craftAssistUseAbsoluteWear"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, "craftAssistMainCount"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, "craftAssistAuxCount"), false);
  assert.equal(JSON.stringify(snapshot.craftAssistMaterials), JSON.stringify([{
    id: "m-write",
    role: "main",
    count: 4,
    items: [
      {id: "m-write__1", name: "AK", wear_filter_mode: "absolute", wear_min: 0.01, wear_max: 0.07, custom_range: true}
    ]
  }]));
}

function main() {
  testSaveAndRestoreCraftAccountScopedStateKeepsDraftButClearsRuntimeBusyFlags();
  testMissingAccountRestoresEmptyDefaults();
  testRestoreCanStillShowLiveRuntimeBusyStateForCurrentAccount();
  testRestoreDropsBusyRuntimeSnapshotWithoutActiveRunToken();
  testAccountScopedWritebackUsesItemLevelMaterialsAndOmitsLegacyTopLevelFields();
  console.log("craft-assist-account-state tests passed");
}

main();
