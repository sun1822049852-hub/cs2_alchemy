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

function loadRenderCraftPageFns(initialState = {}) {
  const source = [
    extractBlock("function isCraftRecipeEditLocked(", "function formatCraftSlotWear("),
    extractBlock("function renderCraftPage(", "async function runCraftTradeUpQueue(")
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
      rows: [{asset_id: "cached-1", is_craftable: true}],
      currentAccountUsername: "acc-a",
      craftUseComponentItems: false,
      craftCandidateLoading: false,
      craftCandidateStats: null,
      craftSettingsOpen: false,
      craftStatusText: "",
      craftStatusError: false,
      craftBusy: false,
      craftAssistSelecting: false,
      craftRecipeQueue: [{id: "recipe-1", item_ids: ["cached-1"], status: "pending"}],
      craftActiveRecipeId: "recipe-1",
      craftSelectedItemIds: new Set(["cached-1"]),
      craftPredictorContextType: "",
      craftPredictorContextId: "",
      craftPredictorContextLabel: "",
      ...initialState
    },
    ui: {
      craftPage: {},
      craftSelectionTitle: null,
      craftSelectedText: null,
      craftRecipeText: null,
      craftAddRecipeBtn: null,
      craftExecuteQueueBtn: null,
      craftClearQueueBtn: null,
      craftAssistToggleBtn: null,
      craftConnectText: null
    },
    syncCurrentCraftAssistRuntimeState() {},
    isCurrentAccountConnected() {
      return false;
    },
    setConnectionStatusTone() {},
    syncCraftSettingsControls() {},
    setCraftSettingsPanelOpen() {},
    updateCraftActionLayout() {},
    reconcileCraftQueueWithInventory() {
      context.reconcileCalls += 1;
    },
    ensureActiveCraftRecipe() {
      context.ensureActiveCalls += 1;
      return context.state.craftRecipeQueue[0] || null;
    },
    syncCraftPredictorContextWithActiveRecipe() {
      context.syncPredictorCalls += 1;
      const activeId = String(context.state.craftActiveRecipeId || "").trim();
      if (!activeId) {
        context.state.craftPredictorContextType = "";
        context.state.craftPredictorContextId = "";
        context.state.craftPredictorContextLabel = "";
        return;
      }
      context.state.craftPredictorContextType = "draft";
      context.state.craftPredictorContextId = activeId;
      context.state.craftPredictorContextLabel = "当前配置";
    },
    getCraftCandidates() {
      return [];
    },
    getCraftSelectedRows() {
      return [];
    },
    getTradeUpRecipeFromRows() {
      return {ok: true, text: "配方：-"};
    },
    getCraftQueuePendingCount() {
      return 1;
    },
    getCraftExecutableEntries() {
      return [];
    },
    syncCraftStatusDom() {},
    renderCraftQueue() {},
    renderCraftAssistPanel() {},
    renderCraftGrouped() {},
    renderCraftExecutionOverlay() {},
    setCraftStatus() {},
    refreshCraftCandidateRows() {},
    estimateMainInventoryFreeSlots() {
      return {freeSlots: 0};
    },
    countSelectedComponentCraftItems() {
      return 0;
    },
    reconcileCalls: 0,
    ensureActiveCalls: 0,
    syncPredictorCalls: 0
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function testOfflineCraftRenderKeepsActiveRecipeForPredictor() {
  const app = loadRenderCraftPageFns();
  assert.equal(typeof app.renderCraftPage, "function", "expected renderCraftPage to exist");

  app.renderCraftPage();

  assert.equal(
    app.state.craftActiveRecipeId,
    "recipe-1",
    "cached craft editing should keep the active recipe even when the account is currently disconnected"
  );
  assert.equal(
    app.state.craftPredictorContextId,
    "recipe-1",
    "predictor context should still target the cached draft while editing offline"
  );
  assert.equal(app.syncPredictorCalls, 1, "render should still re-sync predictor context for offline draft editing");
}

function main() {
  testOfflineCraftRenderKeepsActiveRecipeForPredictor();
  console.log("craft-predictor-offline-render tests passed");
}

main();
