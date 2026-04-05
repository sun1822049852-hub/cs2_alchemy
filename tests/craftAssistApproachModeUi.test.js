const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "..", "node_sidecar", "ui", "index.html");
const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");

const html = fs.readFileSync(htmlPath, "utf8");
const app = fs.readFileSync(appPath, "utf8");

const htmlFragments = [
  '<label class="inline"><span>逼近磨损模式</span><input id="craftAssistApproachMode" type="checkbox" /></label>'
];

for (const fragment of htmlFragments) {
  assert.equal(
    html.includes(fragment),
    true,
    `craft assist approach mode html should include fragment: ${fragment}`
  );
}

const appFragments = [
  "craftAssistApproachMode: false,",
  'craftAssistApproachMode: document.getElementById("craftAssistApproachMode")',
  "craft_assist_approach_mode: !!state.craftAssistApproachMode,",
  'if (typeof prefs.craft_assist_approach_mode === "boolean") state.craftAssistApproachMode = prefs.craft_assist_approach_mode;',
  "if (ui.craftAssistApproachMode) ui.craftAssistApproachMode.checked = !!state.craftAssistApproachMode;",
  "const applyCraftAssistApproachMode = (checked) => {",
  "state.craftAssistApproachMode = !!checked;",
  "ui.craftAssistApproachMode.onchange = () => {",
  'wear_approach_mode: state.craftAssistApproachMode ? "infinite" : "below",'
];

for (const fragment of appFragments) {
  assert.equal(
    app.includes(fragment),
    true,
    `craft assist approach mode app should include fragment: ${fragment}`
  );
}

assert.match(
  html,
  /高速选材[\s\S]*逼近磨损模式[\s\S]*磨损偏移阈值\(%\)/,
  "craft settings should place approach mode directly under fast mode and above wear offset"
);

console.log("craftAssistApproachModeUi tests passed");
