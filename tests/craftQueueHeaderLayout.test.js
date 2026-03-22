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
  'class="row craft-queue-header"',
  'class="craft-queue-header-spacer"',
  'class="craft-queue-shell"',
  'id="craftAssistToggleBtn"',
  'id="craftAddRecipeBtn"',
  'id="craftQueueDeleteModeBtn"',
  'id="craftClearQueueBtn"',
  'id="craftExecuteQueueBtn"',
  'class="row craft-queue-run-row"'
];

for (const fragment of htmlFragments) {
  assert.equal(
    html.includes(fragment),
    true,
    `craft queue header html should include fragment: ${fragment}`
  );
}

assert.equal(
  html.includes('>配方预览<'),
  false,
  "craft queue header should no longer render the 配方预览 title text"
);

const cssFragments = [
  ".craft-queue-header {",
  ".craft-queue-header-spacer {",
  ".craft-queue-header-actions {",
  ".craft-queue-shell {",
  ".craft-queue-run-row {",
  ".craft-queue-empty {",
  ".craft-queue-empty-icon {",
  ".craft-queue-empty-body {",
  ".craft-add-recipe-btn {",
  ".craft-delete-mode-btn {",
  ".craft-clear-queue-btn {",
  ".craft-execute-btn::before {",
  ".craft-queue-icon-btn",
  ".craft-execute-btn {"
];

for (const fragment of cssFragments) {
  assert.equal(
    css.includes(fragment),
    true,
    `craft queue header css should include fragment: ${fragment}`
  );
}

const appFragments = [
  "craftQueueDeleteMode: false",
  'craftQueueDeleteModeBtn: document.getElementById("craftQueueDeleteModeBtn")',
  "state.craftQueueDeleteMode",
  'emptyIcon.className = "craft-queue-empty-icon"',
  'emptyBody.className = "craft-queue-empty-body"',
  "点击上方加号创建配方",
  "闪电图标进行快捷选材"
];

for (const fragment of appFragments) {
  assert.equal(
    app.includes(fragment),
    true,
    `craft queue header app logic should include fragment: ${fragment}`
  );
}

assert.equal(
  app.includes('ui.craftAddRecipeBtn.disabled = topActionsLocked || pendingQueueCount >= 50;'),
  true,
  "add recipe button should stay clickable while offline"
);

assert.equal(
  app.includes('ui.craftAddRecipeBtn.disabled = !connected || topActionsLocked || pendingQueueCount >= 50;'),
  false,
  "add recipe button should no longer be disabled only because the account is offline"
);

const addFunctionMatch = app.match(/function addCurrentSelectionToCraftQueue\(\) \{([\s\S]*?)\n\}/);
assert.ok(addFunctionMatch, "should find addCurrentSelectionToCraftQueue function");
assert.equal(
  addFunctionMatch[1].includes('setCraftStatus("请先连接并刷新库存", true);'),
  false,
  "adding an empty recipe should not hard-stop only because the account is offline"
);

console.log("craftQueueHeaderLayout tests passed");
