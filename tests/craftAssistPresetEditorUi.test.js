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
  'id="craftAssistPresetNameField"',
  'id="craftAssistPresetNameInput"',
  'class="craft-assist-field craft-assist-inline-field craft-assist-preset-name-field hidden"',
  'class="craft-assist-field craft-assist-inline-field craft-assist-target-field"'
];

for (const fragment of htmlFragments) {
  assert.equal(
    htmlSource.includes(fragment),
    true,
    `craft assist preset editor html should include fragment: ${fragment}`
  );
}

const appFragments = [
  'craftAssistPresetNameField: document.getElementById("craftAssistPresetNameField")',
  'craftAssistPresetNameInput: document.getElementById("craftAssistPresetNameInput")',
  'ui.craftAssistPresetNameField.classList.toggle("hidden", !editingPreset);',
  'ui.craftAssistPresetNameInput.value = String(state.craftAssistPresetEditingName || "").trim();',
  'ui.craftAssistPresetNameInput.oninput = () => {'
];

for (const fragment of appFragments) {
  assert.equal(
    appSource.includes(fragment),
    true,
    `craft assist preset editor app should include fragment: ${fragment}`
  );
}

assert.match(
  cssSource,
  /\.craft-assist-inline-field\s*\{[\s\S]*flex-direction:\s*row;[\s\S]*align-items:\s*center;/m,
  "craft assist inline field should lay label text before the input so target wear reads inline"
);

assert.match(
  cssSource,
  /\.craft-assist-main-tools \.craft-assist-preset-name-field\s*\{[\s\S]*min-width:\s*180px;/m,
  "craft assist preset name field should reserve inline space inside the main tools row during edit mode"
);

assert.match(
  cssSource,
  /\.craft-assist-main-tools \.craft-assist-target-field\s*\{[\s\S]*flex-direction:\s*row;[\s\S]*align-items:\s*center;/m,
  "craft assist target wear field should move its label before the numeric input in the tools row"
);

assert.match(
  cssSource,
  /\.craft-assist-main-tools \.craft-assist-preset-name-field input\[type="text"\]\s*\{[\s\S]*caret-color:\s*#1d4ed8;/m,
  "craft assist preset name input should force a visible light-theme caret color instead of relying on browser defaults"
);

assert.match(
  cssSource,
  /body\.theme-inkblue #craftPage \.craft-assist-main-tools \.craft-assist-preset-name-field input\[type="text"\]\s*\{[\s\S]*caret-color:\s*#f3c779;/m,
  "craft assist preset name input should also force a visible ink-theme caret color on the dark surface"
);

console.log("craftAssistPresetEditorUi tests passed");
