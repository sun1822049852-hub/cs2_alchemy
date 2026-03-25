const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");
const appSource = fs.readFileSync(appPath, "utf8");
const cssSource = fs.readFileSync(cssPath, "utf8");

const appFragments = [
  'const applyCountStepper = document.createElement("div");',
  'applyCountStepper.className = "craft-assist-preset-apply-stepper";',
  'const decrementBtn = document.createElement("button");',
  'decrementBtn.className = "craft-assist-preset-apply-step decrement";',
  'decrementBtn.setAttribute("aria-label", "减少应用数量");',
  'const incrementBtn = document.createElement("button");',
  'incrementBtn.className = "craft-assist-preset-apply-step increment";',
  'incrementBtn.setAttribute("aria-label", "增加应用数量");',
  "applyCountStepper.append(decrementBtn, applyCountInput, incrementBtn);"
];

for (const fragment of appFragments) {
  assert.equal(
    appSource.includes(fragment),
    true,
    `craft assist preset stepper ui should include fragment: ${fragment}`
  );
}

const cssFragments = [
  ".craft-assist-preset-apply-stepper {",
  ".craft-assist-preset-apply-step {",
  ".craft-assist-preset-apply-step::before {",
  ".craft-assist-preset-apply-step.increment::before {",
  ".craft-assist-preset-apply-step.decrement::before {",
  '.craft-assist-preset-apply-count input[type="number"]::-webkit-outer-spin-button,',
  '.craft-assist-preset-apply-count input[type="number"]::-webkit-inner-spin-button {',
  "appearance: textfield;"
];

for (const fragment of cssFragments) {
  assert.equal(
    cssSource.includes(fragment),
    true,
    `craft assist preset stepper css should include fragment: ${fragment}`
  );
}

assert.match(
  cssSource,
  /\.craft-assist-preset-apply-stepper\s*\{[\s\S]*grid-template-columns:\s*18px minmax\(0,\s*1fr\) 18px;/m,
  "craft assist preset stepper should use narrow custom minus and plus buttons around the count input"
);

assert.match(
  cssSource,
  /\.craft-assist-preset-apply-step\s*\{[\s\S]*width:\s*100%(?:\s*!important)?;[\s\S]*min-width:\s*0(?:\s*!important)?;[\s\S]*height:\s*100%;[\s\S]*font-size:\s*0;/m,
  "craft assist preset step buttons should override the shared preset action button size so they do not collapse into large dark blocks"
);

assert.match(
  cssSource,
  /\.craft-assist-preset-apply-step::before\s*\{[\s\S]*border-top:\s*2px solid currentColor;[\s\S]*border-right:\s*2px solid currentColor;/m,
  "craft assist preset step buttons should render visible chevron arrows instead of relying on text glyphs"
);

console.log("craftAssistPresetStepperUi tests passed");
