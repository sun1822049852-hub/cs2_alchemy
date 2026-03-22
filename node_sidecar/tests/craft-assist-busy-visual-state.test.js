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

function loadBusyHelpers(state) {
  const source = extractBlock("function setCraftAssistPendingUiState(", "function getCraftAssistOffsetSettingHintText(");
  const context = {
    state,
    String,
    console
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function testPendingUiHelperTargetsOnlyTheMatchingAction() {
  const state = {
    craftAssistSelecting: true,
    craftAssistPendingUiAction: "preset_apply",
    craftAssistPendingPresetId: "preset-2"
  };
  const app = loadBusyHelpers(state);

  assert.equal(app.isCraftAssistPendingUiAction("preset_apply", {presetId: "preset-2"}), true);
  assert.equal(app.isCraftAssistPendingUiAction("preset_apply", {presetId: "preset-1"}), false);
  assert.equal(app.isCraftAssistPendingUiAction("panel_apply"), false);

  app.setCraftAssistPendingUiState("panel_apply", "");
  assert.equal(app.isCraftAssistPendingUiAction("panel_apply"), true);
  assert.equal(app.isCraftAssistPendingUiAction("preset_apply", {presetId: "preset-2"}), false);

  app.clearCraftAssistPendingUiState();
  assert.equal(app.isCraftAssistPendingUiAction("panel_apply"), false);
}

function testRenderSourceUsesTargetedBusyDisableRules() {
  assert.equal(
    APP_SOURCE.includes('ui.craftAssistApplyBtn.disabled = state.refreshing || state.craftBusy || isCraftAssistPendingUiAction("panel_apply");'),
    true,
    "top apply button should only gray while its own panel_apply action is pending"
  );
  assert.equal(
    APP_SOURCE.includes('applyBtn.disabled = inEditingMode || state.refreshing || state.craftBusy || isCraftAssistPendingUiAction("preset_apply", {presetId});'),
    true,
    "preset apply button should only gray for its own pending preset_apply action"
  );
  assert.equal(
    APP_SOURCE.includes("editBtn.disabled = state.refreshing || state.craftBusy;"),
    true,
    "preset edit button should no longer gray on unrelated preset apply"
  );
  assert.equal(
    APP_SOURCE.includes("applyCountInput.disabled = inEditingMode || state.refreshing || state.craftBusy;"),
    true,
    "preset apply count input should no longer gray on unrelated preset apply"
  );
  assert.equal(
    APP_SOURCE.includes("applyBtn.disabled = inEditingMode || state.refreshing || state.craftBusy || state.craftAssistSelecting;"),
    false,
    "preset apply button should not be globally disabled by craftAssistSelecting anymore"
  );
}

function main() {
  testPendingUiHelperTargetsOnlyTheMatchingAction();
  testRenderSourceUsesTargetedBusyDisableRules();
  console.log("craft-assist-busy-visual-state tests passed");
}

main();
