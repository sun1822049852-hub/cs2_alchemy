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
  'id="craftQueueMain"',
  'id="craftPredictorPanel"',
  'id="craftPredictorRail"',
  'id="craftPredictorSurface"',
  'id="craftPredictorList"',
  'id="craftPredictorNav"'
];

for (const fragment of htmlFragments) {
  assert.equal(
    html.includes(fragment),
    true,
    `craft predictor drawer html should include fragment: ${fragment}`
  );
}

const appFragments = [
  "craftPredictorOpen: false",
  'craftPredictorSelectedConfigKey: ""',
  "craftPredictorDismissedConfigKeys: {}",
  'craftQueueMain: document.getElementById("craftQueueMain")',
  'craftPredictorPanel: document.getElementById("craftPredictorPanel")',
  'craftPredictorRail: document.getElementById("craftPredictorRail")',
  'function setCraftPredictorPanelOpen(',
  'function selectCraftPredictorConfig(',
  'function refreshCraftPredictorPreview(',
  'api("/api/craft/predict-outcomes"'
];

for (const fragment of appFragments) {
  assert.equal(
    app.includes(fragment),
    true,
    `craft predictor drawer app should include fragment: ${fragment}`
  );
}

const cssFragments = [
  ".craft-queue-main {",
  ".craft-predictor-panel {",
  ".craft-predictor-panel.collapsed {",
  ".craft-predictor-rail {",
  ".craft-predictor-nav {",
  ".craft-predictor-list {",
  "clip-path: polygon(",
  "body.theme-inkblue #craftPage .craft-predictor-surface {"
];

for (const fragment of cssFragments) {
  assert.equal(
    css.includes(fragment),
    true,
    `craft predictor drawer css should include fragment: ${fragment}`
  );
}

assert.match(
  css,
  /\.craft-predictor-panel\s*\{[\s\S]*position:\s*absolute;[\s\S]*right:\s*0;[\s\S]*width:\s*max\(50%,\s*280px\);/m,
  "craft predictor drawer should overlay the right half of the queue area"
);

assert.match(
  css,
  /\.craft-predictor-rail\s*\{[\s\S]*position:\s*absolute;[\s\S]*right:\s*0;[\s\S]*clip-path:\s*polygon\(/m,
  "craft predictor drawer should expose a trapezoid rail trigger on the right edge"
);

console.log("craftPredictorDrawerUi tests passed");
