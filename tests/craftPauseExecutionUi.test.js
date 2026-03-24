const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");
const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");

const css = fs.readFileSync(cssPath, "utf8");
const app = fs.readFileSync(appPath, "utf8");

const requiredAppFragments = [
  "craftPauseRequested: false",
  "craftPaused: false",
  "function requestCraftTradeUpPause() {",
  'setCraftStatus("已请求暂停，当前提交完成后将停止后续配方");',
  'state.craftPaused = true;',
  'state.craftPauseRequested = false;',
  'const executeLabel = state.craftBusy ? (state.craftPauseRequested ? "暂停中..." : "暂停执行") : (state.craftPaused && executableCount > 0 ? "继续执行" : "执行配方");',
  'if (state.craftBusy) {',
  "requestCraftTradeUpPause();",
  'setCraftStatus(`已暂停，剩余${remainingCount}组配方未提交`);'
];

for (const fragment of requiredAppFragments) {
  assert.equal(
    app.includes(fragment),
    true,
    `craft pause execution logic should include fragment: ${fragment}`
  );
}

const requiredCssFragments = [
  ".craft-pause-glyph {",
  ".craft-execute-btn.is-pausing::before {",
  ".craft-execute-btn.is-paused::before {"
];

for (const fragment of requiredCssFragments) {
  assert.equal(
    css.includes(fragment),
    true,
    `craft pause execution ui css should include fragment: ${fragment}`
  );
}

console.log("craftPauseExecutionUi tests passed");
