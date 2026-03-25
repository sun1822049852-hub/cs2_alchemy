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

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createScopedState() {
  return {
    craftSelectedItemIds: [],
    craftStatusText: "",
    craftStatusError: false,
    craftRecipeQueue: [],
    craftActiveRecipeId: "",
    craftAssistSelecting: false,
    craftAssistPendingUiAction: "",
    craftAssistPendingPresetId: "",
    craftAssistOpen: true,
    craftAssistPickerOpen: false,
    craftAssistPickerTargetMaterialId: "",
    craftAssistRoleChooserOpen: false,
    craftAssistPickRole: "main",
    craftAssistUseAbsoluteWear: false,
    craftAssistTargetWear: 0.2142,
    craftAssistMainCount: 5,
    craftAssistAuxCount: 5,
    craftAssistMaterials: [],
    craftAssistPresetApplyCountMap: {},
    craftAssistPresetEditingId: "",
    craftAssistPresetEditingName: "",
    craftAssistPresetEditingBackup: null,
    craftAssistPresetEditingInitialSnapshot: null
  };
}

function loadApplyCraftAssistAutoSelection() {
  const ids = Array.from({length: 10}, (_, index) => String(index + 1));
  const rows = ids.map((id) => ({asset_id: id}));
  let savedScopedState = createScopedState();
  const source = [
    extractConst("DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT"),
    extractConst("WEAR_INPUT_DECIMALS"),
    extractBlock("function createDefaultCraftAssistRuntimeState(", "function createDefaultCraftAccountScopedState("),
    extractBlock("async function applyCraftAssistAutoSelection(", "async function applyCraftAssistAutoSelectionBatch(")
  ].join("\n");
  const context = {
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    JSON,
    console,
    state: {
      craftBusy: false,
      refreshing: false,
      currentAccountUsername: "acc-a",
      accountSelectedUsername: "acc-a",
      craftAssistSelecting: false,
      craftAssistPendingUiAction: "",
      craftAssistPendingPresetId: "",
      craftUseComponentItems: false,
      craftIncludeCooling: false,
      craftAssistWearOffsetPct: 5,
      craftAssistRuntimeByAccount: new Map()
    },
    getCraftAccountScopedStateSnapshot() {
      return deepClone(savedScopedState);
    },
    commitCraftAccountScopedState(username, snapshot) {
      assert.equal(username, "acc-a");
      savedScopedState = deepClone(snapshot);
      return deepClone(savedScopedState);
    },
    buildCraftAssistDraftSnapshotFromScopedState() {
      return {
        panel_open: true,
        target_wear: 0.2142,
        wear_filter_mode: "relative",
        materials: [{id: "mat-1", names: ["AK"], role: "main", count: 10}],
        pick_role: "main"
      };
    },
    normalizeCraftAssistFilterMode(value) {
      return String(value || "relative");
    },
    parseOptionalWear01(value) {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    },
    normalizeCraftAssistMaterialsForRun({materials}) {
      return Array.isArray(materials) ? materials : [];
    },
    craftAssistTargetCountFromMaterials() {
      return 10;
    },
    getCraftQueuePendingCountFromState(scopedState) {
      return Array.isArray(scopedState && scopedState.craftRecipeQueue) ? scopedState.craftRecipeQueue.length : 0;
    },
    getCraftQueuePendingEntriesFromState(scopedState) {
      return Array.isArray(scopedState && scopedState.craftRecipeQueue) ? scopedState.craftRecipeQueue : [];
    },
    createEmptyCraftRecipeEntryInState(scopedState) {
      const entry = {
        id: "recipe-1",
        item_ids: [],
        item_sources: {},
        status: "pending",
        prepare_status: "pending",
        prepare_message: "",
        removed_missing_count: 0
      };
      scopedState.craftRecipeQueue.push(entry);
      return entry;
    },
    normalizeCraftRecipeItemIds(list) {
      return Array.from(new Set((Array.isArray(list) ? list : []).map((id) => String(id || "").trim()).filter(Boolean)));
    },
    normalizeCraftAssistWearOffsetPct(value) {
      return Number(value) || 5;
    },
    async api() {
      return {
        item_ids: ids,
        overall: 0.214199,
        rarity: 2,
        recipe_ok: true
      };
    },
    resetCraftRecipeEntryPreparation(entry) {
      entry.prepare_status = "pending";
    },
    getCraftRowsForAccount() {
      return rows;
    },
    buildRowsByAssetId(list) {
      return new Map((Array.isArray(list) ? list : []).map((row) => [String(row.asset_id), row]));
    },
    syncCraftRecipeEntryItemSources(entry) {
      entry.item_sources = Object.fromEntries((Array.isArray(entry.item_ids) ? entry.item_ids : []).map((id) => [id, {source_scope: "main"}]));
    },
    getCraftComponentSummaryMapForAccount() {
      return {};
    },
    logCraftAssistPickedRows() {},
    numberTextTrunc(value) {
      return String(value);
    },
    wearTextFull(value) {
      return String(value);
    },
    getTradeUpRecipeFromRows() {
      return {ok: true, reason: ""};
    },
    craftRarityLabel(value) {
      return `R${value}`;
    },
    setCraftStatusOnScopedState(scopedState, text, isError = false) {
      scopedState.craftStatusText = String(text || "").trim();
      scopedState.craftStatusError = !!isError;
    },
    showErrorToast() {},
    renderCraftPage() {}
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  context.getSavedScopedState = () => deepClone(savedScopedState);
  return context;
}

async function testSuccessfulAutoSelectionWritesBackFilledRecipeInsteadOfEmptyShell() {
  const app = loadApplyCraftAssistAutoSelection();

  const ok = await app.applyCraftAssistAutoSelection({accountUsername: "acc-a", pendingUiAction: "panel_apply"});
  const saved = app.getSavedScopedState();

  assert.equal(ok, true);
  assert.equal(saved.craftRecipeQueue.length, 1);
  assert.deepEqual(saved.craftRecipeQueue[0].item_ids, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  assert.equal(saved.craftRecipeQueue.some((entry) => Array.isArray(entry.item_ids) && entry.item_ids.length === 0), false);
}

async function main() {
  await testSuccessfulAutoSelectionWritesBackFilledRecipeInsteadOfEmptyShell();
  console.log("craft-assist-autoselect-writeback tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
