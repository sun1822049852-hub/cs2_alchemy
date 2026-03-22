const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const source = fs.readFileSync(appPath, "utf8");

const forbiddenSymbols = [
  "function runCraftAssistSelectionForRecipe(",
  "function applyCraftAssistDeficitCorrection(",
  "function applyCraftAssistOverflowCorrection(",
  "function applyCraftAssistOffsetWindowCorrection(",
  "function solveCraftAssistMinCostAssignmentForRarity(",
  "function findCraftAssistFallbackBelowTargetSolution(",
  "function pickCraftAssistBySplit("
];

for (const symbol of forbiddenSymbols) {
  assert.equal(
    source.includes(symbol),
    false,
    `frontend should not keep mirrored craft-assist solver symbol: ${symbol}`
  );
}

assert.equal(
  source.includes('api("/api/craft/assist-select"'),
  true,
  "frontend must still call backend craft assist API"
);

assert.equal(
  source.includes('api("/api/craft/candidates"'),
  true,
  "frontend must fetch craft candidates from backend single source"
);

const requiredConcurrencyGuardFragments = [
  "craftAssistSelecting: false",
  'craftAssistPendingUiAction: ""',
  'craftAssistPendingPresetId: ""',
  'use_component_items: !!state.craftUseComponentItems',
  'selected_item_ids: getCraftCandidateSelectedIds()',
  "if (state.craftAssistSelecting) {",
  'setCraftStatus("辅助选材处理中，请稍后再试", true);',
  "state.craftAssistSelecting = true;",
  "state.craftAssistSelecting = false;",
  "function isCraftAssistPendingUiAction(",
  "function rejectCraftAssistBusyUiAction(",
  'ui.craftAssistApplyBtn.disabled = state.refreshing || state.craftBusy || isCraftAssistPendingUiAction("panel_apply");',
  "ui.craftAssistPresetSaveBtn.disabled = state.refreshing || state.craftBusy;",
  "item.draggable = !(state.refreshing || state.craftBusy || state.craftAssistSelecting || inEditingMode);",
  "editBtn.disabled = state.refreshing || state.craftBusy;",
  "applyCountInput.disabled = inEditingMode || state.refreshing || state.craftBusy;",
  'applyBtn.disabled = inEditingMode || state.refreshing || state.craftBusy || isCraftAssistPendingUiAction("preset_apply", {presetId});'
];

for (const fragment of requiredConcurrencyGuardFragments) {
  assert.equal(
    source.includes(fragment),
    true,
    `frontend must keep craft assist concurrency guard fragment: ${fragment}`
  );
}

console.log("uiCraftAssistSingleSource tests passed");
