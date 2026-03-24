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
  'id="craftClearQueueBtn"',
  'id="craftExecuteQueueBtn"',
  'class="row craft-queue-run-row"',
  'id="confirmModal"',
  'id="confirmModalTitle"',
  'id="confirmModalMessage"',
  'id="confirmModalConfirmBtn"',
  'id="confirmModalCancelBtn"'
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

assert.equal(
  html.includes('id="craftQueueDeleteModeBtn"'),
  false,
  "craft queue header should remove the old top delete-mode minus button now that each card owns its own delete control"
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

assert.equal(
  app.includes('window.confirm("您确认要执行汰换吗？")'),
  false,
  "executing the craft queue should no longer use the browser confirm dialog"
);

assert.equal(
  app.includes('await openConfirmModal({'),
  true,
  "executing the craft queue should use the in-app confirm modal before sending trade-up requests"
);

assert.equal(
  app.includes('message: "您确认要执行汰换吗？"'),
  true,
  "the in-app confirm modal should show the required trade-up confirmation copy"
);

assert.equal(
  app.includes('return !!state.craftQueueDeleteMode && !state.refreshing && !state.craftBusy && !state.craftAssistSelecting;'),
  false,
  "delete affordances should no longer depend on a separate delete mode toggle"
);

assert.equal(
  app.includes("craftQueueDeleteMode"),
  false,
  "frontend should remove the obsolete delete-mode state and handlers now that deletion lives on each card"
);

const addFunctionMatch = app.match(/function addCurrentSelectionToCraftQueue\(\) \{([\s\S]*?)\n\}/);
assert.ok(addFunctionMatch, "should find addCurrentSelectionToCraftQueue function");
assert.equal(
  addFunctionMatch[1].includes('setCraftStatus("请先连接并刷新库存", true);'),
  false,
  "adding an empty recipe should not hard-stop only because the account is offline"
);

console.log("craftQueueHeaderLayout tests passed");
