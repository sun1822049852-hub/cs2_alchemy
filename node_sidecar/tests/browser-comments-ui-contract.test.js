const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const APP_SOURCE = fs.readFileSync(path.resolve(__dirname, "../ui/app.js"), "utf8");
const CSS_SOURCE = fs.readFileSync(path.resolve(__dirname, "../ui/styles.css"), "utf8");
const HTML_SOURCE = fs.readFileSync(path.resolve(__dirname, "../ui/index.html"), "utf8");

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

function extractCssBlock(selector) {
  const start = CSS_SOURCE.indexOf(selector);
  assert.notEqual(start, -1, `missing CSS selector: ${selector}`);
  const end = CSS_SOURCE.indexOf("}", start);
  assert.notEqual(end, -1, `unterminated CSS selector: ${selector}`);
  return CSS_SOURCE.slice(start, end + 1);
}

function test_completed_craft_card_uses_full_bleed_art_with_overlaid_delete_action() {
  const cardBlock = extractCssBlock(".craft-queue-result-card-grid .simulation-output-card {");
  assert.match(cardBlock, /position:\s*relative;/);
  assert.match(cardBlock, /height:\s*140px;/);
  const artBlock = extractCssBlock(".craft-queue-result-card-grid .simulation-card-art {");
  assert.match(artBlock, /position:\s*absolute;/);
  assert.match(artBlock, /inset:\s*0;/);
  assert.match(
    CSS_SOURCE,
    /\.craft-queue-item\.done\.deletable\s*\{[^}]*padding-right:\s*8px;/s
  );
  assert.match(
    CSS_SOURCE,
    /\.craft-queue-item\.done \.craft-queue-card-delete-floating\s*\{[^}]*z-index:\s*[3-9]/s
  );
}

function test_craft_assist_presets_expand_and_wrap_into_two_columns() {
  assert.match(
    CSS_SOURCE,
    /\.craft-assist-preset-list\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(160px,\s*1fr\)\);/s
  );
  assert.match(
    CSS_SOURCE,
    /\.craft-assist-preset-item\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;/s
  );
}

function test_craft_assist_preset_card_omits_material_count_and_timestamp() {
  const renderSource = extractBlock("function renderCraftAssistPresetPanel()", "function normalizeCraftAssistMaterialsForRun(");
  assert.equal(renderSource.includes("craft-assist-preset-meta-top"), false);
  assert.equal(renderSource.includes("formatCraftAssistPresetTime"), false);
  assert.match(renderSource, /craft-assist-preset-meta-wear/);
}

function test_saved_simulation_cards_expose_explicit_rename_action() {
  const renderSource = extractBlock("function renderSimulationSavedPresets()", "function renderSimulationWorkspaceActionsBar(");
  assert.match(renderSource, /simulation-saved-rename-btn/);
  assert.match(renderSource, /data-simulation-rename-preset-id/);
  assert.match(renderSource, /renameTradeupSimulationPreset/);
}

function test_export_modal_has_separate_main_and_auxiliary_wear_ranges() {
  for (const id of [
    "simExportCraftWearMin",
    "simExportCraftWearMax",
    "simExportCraftAuxWearMin",
    "simExportCraftAuxWearMax"
  ]) {
    assert.match(HTML_SOURCE, new RegExp(`id="${id}"`));
  }
  assert.match(HTML_SOURCE, />主料相对磨损范围</);
  assert.match(HTML_SOURCE, />辅料相对磨损范围</);
}

function test_batch_preset_popover_exposes_search_and_warehouse_quick_pick_controls() {
  const source = extractBlock("function showBatchCraftPresetPopover(", "function renderBatchCraftQueue(");
  assert.match(source, /batch-craft-popover-add/);
  assert.match(source, /batch-craft-popover-search-input/);
  assert.match(source, /batch-craft-popover-picker-results/);
  assert.match(source, /getBatchCraftPresetPickerGroups/);
  assert.match(source, /addBatchCraftPresetMaterialName/);
  assert.match(source, /removeBatchCraftPresetMaterialName/);
}

function main() {
  test_completed_craft_card_uses_full_bleed_art_with_overlaid_delete_action();
  test_craft_assist_presets_expand_and_wrap_into_two_columns();
  test_craft_assist_preset_card_omits_material_count_and_timestamp();
  test_saved_simulation_cards_expose_explicit_rename_action();
  test_export_modal_has_separate_main_and_auxiliary_wear_ranges();
  test_batch_preset_popover_exposes_search_and_warehouse_quick_pick_controls();
  console.log("browser-comments-ui-contract tests passed");
}

main();
