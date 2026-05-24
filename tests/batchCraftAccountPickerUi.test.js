const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const htmlPath = path.join(__dirname, "..", "node_sidecar", "ui", "index.html");
const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");

const appSource = fs.readFileSync(appPath, "utf8");
const htmlSource = fs.readFileSync(htmlPath, "utf8");
const cssSource = fs.readFileSync(cssPath, "utf8");

const htmlFragments = [
  'id="batchCraftAccountListbox"',
  'aria-haspopup="listbox"',
  'aria-expanded="false"',
  'class="batch-craft-account-listbox hidden"',
  'role="listbox"',
  'aria-labelledby="batchCraftAddAccountBtn"',
  'aria-hidden="true"',
  'id="batchCraftAccountPicker"',
  'class="batch-craft-account-picker hidden"'
];

for (const fragment of htmlFragments) {
  assert.equal(
    htmlSource.includes(fragment),
    true,
    `batch craft account picker html should include fragment: ${fragment}`
  );
}

const appFragments = [
  "batchCraftAccountPickerOpen: false",
  'batchCraftAccountListbox: document.getElementById("batchCraftAccountListbox")',
  "function getAvailableBatchCraftAccounts() {",
  "function renderBatchCraftAccountListbox() {",
  'btn.className = "batch-craft-account-option";',
  'btn.setAttribute("role", "option");',
  "void addBatchCraftAccount(username);",
  "function setBatchCraftAccountPickerOpen(open) {",
  'ui.batchCraftAccountListbox.classList.toggle("hidden", !state.batchCraftAccountPickerOpen);',
  'ui.batchCraftAccountListbox.setAttribute("aria-hidden", state.batchCraftAccountPickerOpen ? "false" : "true");',
  "function closeBatchCraftAccountPicker() {",
  "if (state.batchCraftBusy) return;",
  "setBatchCraftAccountPickerOpen(!state.batchCraftAccountPickerOpen);",
  'if (evt.key === "Escape" && state.batchCraftAccountPickerOpen) {'
];

for (const fragment of appFragments) {
  assert.equal(
    appSource.includes(fragment),
    true,
    `batch craft account picker app should include fragment: ${fragment}`
  );
}

assert.equal(
  appSource.includes(".showPicker("),
  false,
  "batch craft account picker should not depend on native select.showPicker()"
);

assert.match(
  appSource,
  /function renderBatchCraftAccountPicker\(\)\s*\{[\s\S]*renderBatchCraftAccountListbox\(\);[\s\S]*\}/m,
  "legacy select renderer should also refresh the custom listbox so the hidden select is only a compatibility fallback"
);

assert.match(
  appSource,
  /empty\.className = "batch-craft-account-option empty";[\s\S]*empty\.textContent = "无可添加账号";/m,
  "custom account listbox should render a clear empty state when no accounts are addable"
);

const cssFragments = [
  ".batch-craft-account-listbox {",
  ".batch-craft-account-listbox.hidden {",
  ".batch-craft-account-option {",
  ".batch-craft-account-option.empty {",
  "body.theme-inkblue .batch-craft-account-listbox {",
  "body.theme-inkblue .batch-craft-account-option {",
  "body.theme-inkblue .batch-craft-account-option:hover:not(:disabled) {"
];

for (const fragment of cssFragments) {
  assert.equal(
    cssSource.includes(fragment),
    true,
    `batch craft account picker css should include fragment: ${fragment}`
  );
}

assert.match(
  cssSource,
  /\.batch-craft-account-listbox\s*\{[\s\S]*position:\s*fixed;[\s\S]*z-index:\s*40;[\s\S]*display:\s*flex;/m,
  "custom account listbox should be a fixed popover so the account bar scroll container cannot clip it"
);

assert.match(
  cssSource,
  /\.batch-craft-account-listbox\.hidden\s*\{[\s\S]*display:\s*none;/m,
  "custom account listbox hidden state should override its flex display"
);

assert.match(
  cssSource,
  /#batchCraftPage \.batch-craft-limit-label input\[type="number"\]\s*\{[\s\S]*width:\s*54px;[\s\S]*min-width:\s*54px;/m,
  "batch craft total limit input should stay narrow instead of inheriting broad global input sizing"
);

assert.match(
  cssSource,
  /#batchCraftPage \.batch-craft-popover-qty-input\s*\{[\s\S]*width:\s*36px(?:\s*!important)?;[\s\S]*min-width:\s*36px(?:\s*!important)?;/m,
  "batch craft recipe popover qty input should stay at a compact width even if global input styles change"
);

console.log("batchCraftAccountPickerUi tests passed");
