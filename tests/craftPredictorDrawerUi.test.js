const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "..", "node_sidecar", "ui", "index.html");
const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");
const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");

const html = fs.readFileSync(htmlPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const app = fs.readFileSync(appPath, "utf8");

const htmlFragments = [
  'id="craftPreviewViewport"',
  'id="craftPreviewCandidates"',
  'id="craftPredictorStage"',
  'id="craftQueueList"',
  'id="craftPredictorPanel"',
  'id="craftPredictorHandle"',
  'id="craftPredictorDrawer"',
  'id="craftPredictorTitle"',
  'id="craftPredictorSubtitle"',
  'id="craftPredictorList"'
];

for (const fragment of htmlFragments) {
  assert.equal(
    html.includes(fragment),
    true,
    `craft predictor drawer html should include fragment: ${fragment}`
  );
}

const removedHtmlFragments = [
  'id="craftPredictorRail"',
  'id="craftQueueMain"',
  'id="craftPredictorStatus"',
  'id="craftPredictorNav"'
];

for (const fragment of removedHtmlFragments) {
  assert.equal(
    html.includes(fragment),
    false,
    `craft predictor drawer html should remove fragment: ${fragment}`
  );
}

const appFragments = [
  "craftPredictorOpen: false",
  'craftPredictorContextType: ""',
  'craftPredictorContextId: ""',
  'craftPredictorContextLabel: ""',
  'craftPredictorAutoOpenMuted: false',
  'craftPreviewViewport: document.getElementById("craftPreviewViewport")',
  'craftPredictorHandle: document.getElementById("craftPredictorHandle")',
  'craftPredictorDrawer: document.getElementById("craftPredictorDrawer")',
  "function selectCraftPredictorContext(",
  "function focusCraftPredictorOnActiveDraft(",
  "function buildCraftPredictorRequestFromRecipeEntry(",
  "function setCraftPredictorPreferredRows(",
  "function getCraftPredictorRowsById(",
  'focusCraftPredictorOnActiveDraft({autoOpen: true, preferredRowsById:',
  'craftPredictorAutoOpenMuted = true;',
  'preferredRowSkinImageUrl(outcome)',
  'ui.craftPredictorTitle.textContent = "模拟结果"',
  'craft-predictor-outcome-wear',
  'craft-predictor-outcome-bar',
  'craft-predictor-group-arrow',
  "function fitCraftPredictorOutcomeName(",
  "function fitCraftPredictorOutcomeNames(",
  "fitCraftPredictorOutcomeNames(ui.craftPredictorList);",
  'grid.dataset.columns = group.outcomes.length >= 4 ? "4" : "2";',
  "craftPredictorWearToneKey(",
  'wearChip.classList.add(`tone-${craftPredictorWearToneKey(wearLevel)}`)'
];

for (const fragment of appFragments) {
  assert.equal(
    app.includes(fragment),
    true,
    `craft predictor drawer app should include fragment: ${fragment}`
  );
}

const removedAppFragments = [
  "function selectCraftPredictorConfig(",
  'craftPredictorStatus: document.getElementById("craftPredictorStatus")',
  'craftPredictorNav: document.getElementById("craftPredictorNav")',
  'ui.craftPredictorStatus',
  'ui.craftPredictorNav',
  'priceSlot.className = "craft-predictor-outcome-price-slot"',
  'navItem.className = "craft-predictor-nav-item"',
  '`当前已预测 ${response.outcomes.length} 个可产出物品`'
];

for (const fragment of removedAppFragments) {
  assert.equal(
    app.includes(fragment),
    false,
    `craft predictor drawer app should remove fragment: ${fragment}`
  );
}

const cssFragments = [
  ".craft-preview-viewport {",
  ".craft-preview-candidates {",
  ".craft-predictor-stage {",
  ".craft-predictor-panel {",
  ".craft-predictor-panel.collapsed .craft-predictor-drawer {",
  ".craft-predictor-handle {",
  ".craft-predictor-drawer {",
  ".craft-predictor-head {",
  ".craft-predictor-body {",
  ".craft-predictor-group-grid {",
  ".craft-predictor-group-arrow {",
  ".craft-predictor-outcome-card {",
  ".craft-predictor-outcome-art {",
  ".craft-predictor-outcome-wear {",
  ".craft-predictor-outcome-wear.tone-mw {",
  ".craft-predictor-outcome-wear.tone-ft {",
  ".craft-predictor-outcome-bar {",
  ".craft-predictor-outcome-float {",
  ".craft-predictor-list {",
  "body.theme-inkblue #craftPage .craft-predictor-drawer {"
];

for (const fragment of cssFragments) {
  assert.equal(
    css.includes(fragment),
    true,
    `craft predictor drawer css should include fragment: ${fragment}`
  );
}

const removedCssFragments = [
  ".craft-predictor-status {",
  ".craft-predictor-status.error {",
  ".craft-predictor-nav {",
  ".craft-predictor-nav-item {",
  ".craft-predictor-nav-item:hover {",
  ".craft-predictor-outcome-price-slot {",
  ".craft-predictor-outcome-price-label {",
  ".craft-predictor-outcome-price-value {",
  ".craft-predictor-outcome-chip {",
  ".craft-predictor-outcome-footer {"
];

for (const fragment of removedCssFragments) {
  assert.equal(
    css.includes(fragment),
    false,
    `craft predictor drawer css should remove fragment: ${fragment}`
  );
}

assert.match(
  css,
  /\.craft-preview-viewport\s*\{[\s\S]*position:\s*relative;[\s\S]*flex:\s*1 1 auto;/m,
  "craft predictor drawer should keep the preview viewport as one full-height candidate region"
);

assert.match(
  css,
  /\.craft-predictor-stage\s*\{[\s\S]*position:\s*absolute;[\s\S]*bottom:\s*0;[\s\S]*height:\s*50%;/m,
  "craft predictor drawer should stay as a bottom-half overlay stage"
);

assert.match(
  css,
  /\.craft-predictor-handle\s*\{[\s\S]*width:\s*42px;[\s\S]*height:\s*64px;[\s\S]*border-radius:\s*16px 0 0 16px;/m,
  "craft predictor drawer should use the approved short gold tab handle"
);

assert.match(
  css,
  /\.craft-predictor-body\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;/m,
  "craft predictor drawer body should become a single-column result flow"
);

assert.match(
  css,
  /\.craft-predictor-group-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[\s\S]*align-items:\s*start;/m,
  "craft predictor drawer should default to a compact two-column result grid for smaller outcome groups"
);

assert.match(
  css,
  /\.craft-predictor-group-grid\[data-columns="4"\]\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/m,
  "craft predictor drawer should expand to four columns for larger outcome groups"
);

assert.match(
  css,
  /\.craft-predictor-outcome-card\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;/m,
  "craft predictor drawer should render outcomes as vertical tiles instead of horizontal media cards"
);

assert.match(
  css,
  /\.craft-predictor-outcome-content\s*\{[^}]*gap:\s*6px;[^}]*padding:\s*8px 9px 6px;[^}]*\}/m,
  "craft predictor drawer should tighten the bottom content spacing so there is no extra black footer under short names"
);

assert.match(
  css,
  /\.craft-predictor-outcome-name\s*\{[^}]*display:\s*block;[^}]*white-space:\s*nowrap;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*min-height:\s*0;[^}]*\}/m,
  "craft predictor drawer should keep outcome names on a single line and hide any final overflow after text fitting"
);

assert.match(
  css,
  /\.craft-predictor-outcome-wear\s*\{[^}]*top:\s*0;[^}]*left:\s*14px;[^}]*min-height:\s*18px;[^}]*padding:\s*2px 7px 1px 6px;[^}]*border-radius:\s*0;[^}]*background:\s*rgba\(18,\s*18,\s*18,\s*0\.72\)[^}]*\}/m,
  "craft predictor drawer should keep the shortened wear strip flush against the rarity rail"
);

assert.match(
  css,
  /\.craft-predictor-outcome-art\s*\{[^}]*height:\s*92px;[^}]*background:\s*transparent;[^}]*\}/m,
  "craft predictor drawer should crop the lower black body in the art region"
);

assert.match(
  css,
  /\.craft-predictor-outcome-art\.has-image::after\s*\{[^}]*background-position:\s*center 38%;[^}]*background-size:\s*max\(132px,\s*100%\)\s+auto;[^}]*\}/m,
  "craft predictor drawer should scale weapon art proportionally until the width threshold, then stop shrinking and clip overflow like a progress fill"
);

assert.match(
  css,
  /\.craft-predictor-handle:active\s*\{[^}]*transform:\s*translateY\(-50%\);[^}]*\}/m,
  "craft predictor drawer handle should cancel the global button active offset so the tab icon does not wobble on click"
);

assert.match(
  css,
  /\.craft-predictor-outcome-float\s*\{[\s\S]*position:\s*absolute;[\s\S]*left:\s*0;[\s\S]*right:\s*0;[\s\S]*bottom:\s*0;[\s\S]*background:\s*linear-gradient\(/m,
  "craft predictor drawer should render the float text as a semi-transparent lower art overlay"
);

assert.equal(
  app.includes("art.append(floatLine);"),
  true,
  "craft predictor drawer should append the float overlay inside the art area"
);

assert.match(
  css,
  /\.craft-predictor-drawer\s*\{[\s\S]*transition:\s*transform 0\.22s ease, opacity 0\.18s ease;/m,
  "craft predictor drawer should still slide horizontally without introducing a vertical sink animation"
);

console.log("craftPredictorDrawerUi tests passed");
