const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");
const appSource = fs.readFileSync(appPath, "utf8");
const cssSource = fs.readFileSync(cssPath, "utf8");

const appFragments = [
  'const body = document.createElement("div");',
  'body.className = "craft-assist-preset-body";',
  'const footer = document.createElement("div");',
  'footer.className = "craft-assist-preset-footer";',
  'const applyCountStepper = document.createElement("div");',
  'applyCountStepper.className = "craft-assist-preset-apply-stepper";',
  'const decrementBtn = document.createElement("button");',
  'decrementBtn.className = "craft-assist-preset-apply-step decrement";',
  'decrementBtn.setAttribute("aria-label", "减少应用数量");',
  'const incrementBtn = document.createElement("button");',
  'incrementBtn.className = "craft-assist-preset-apply-step increment";',
  'incrementBtn.setAttribute("aria-label", "增加应用数量");',
  'const duplicateBtn = document.createElement("button");',
  'duplicateBtn.className = "craft-assist-preset-duplicate";',
  'duplicateBtn.textContent = "复制";',
  'editBtn.className = "craft-assist-preset-action-btn craft-assist-preset-edit";',
  'applyBtn.className = "craft-assist-preset-action-btn craft-assist-preset-apply";',
  "applyCountStepper.append(decrementBtn, applyCountInput, incrementBtn);",
  "body.append(name, meta);",
  "footer.append(actions);",
  "item.append(body, footer, duplicateBtn, removeBtn);"
];

for (const fragment of appFragments) {
  assert.equal(
    appSource.includes(fragment),
    true,
    `craft assist preset stepper ui should include fragment: ${fragment}`
  );
}

const cssFragments = [
  ".craft-assist-preset-body {",
  ".craft-assist-preset-footer {",
  ".craft-assist-preset-action-btn {",
  ".craft-assist-preset-apply-stepper {",
  ".craft-assist-preset-apply-step {",
  ".craft-assist-preset-duplicate {",
  ".craft-assist-preset-item:hover :is(.craft-assist-preset-duplicate, .craft-assist-preset-remove) {",
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
  /\.craft-assist-preset-footer\s*\{[\s\S]*padding:\s*4px;[\s\S]*border-radius:\s*10px;/m,
  "craft assist preset footer should become its own chrome container so the action row can align independently from the title copy"
);

assert.match(
  cssSource,
  /\.craft-assist-preset-actions\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto minmax\(0,\s*1fr\);[\s\S]*width:\s*100%;/m,
  "craft assist preset actions should use balanced side tracks around the count stepper instead of hard-coded narrow button columns"
);

assert.match(
  cssSource,
  /\.craft-assist-preset-action-btn\s*\{[\s\S]*appearance:\s*none;[\s\S]*display:\s*inline-flex;[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*center;[\s\S]*width:\s*100%;[\s\S]*height:\s*28px;[\s\S]*font-family:\s*inherit;/m,
  "craft assist preset action buttons should use a component-scoped button reset so the card no longer depends on browser-native button chrome"
);

assert.match(
  cssSource,
  /\.craft-assist-preset-apply-stepper\s*\{[\s\S]*grid-template-columns:\s*16px minmax\(0,\s*1fr\) 16px;[\s\S]*height:\s*28px;/m,
  "craft assist preset stepper should match the refactored action-button height while keeping its compact arrow controls"
);

assert.match(
  cssSource,
  /\.craft-assist-preset-apply-step\s*\{[\s\S]*width:\s*100%(?:\s*!important)?;[\s\S]*min-width:\s*0(?:\s*!important)?;[\s\S]*height:\s*100%;[\s\S]*font-size:\s*0;/m,
  "craft assist preset step buttons should override the shared preset action button size so they do not collapse into large dark blocks"
);

assert.match(
  cssSource,
  /\.craft-assist-preset-body\s*\{[\s\S]*display:\s*grid;[\s\S]*gap:\s*4px;[\s\S]*min-width:\s*0;/m,
  "craft assist preset card should separate its text block into a dedicated body section so title and metadata stop competing with the footer layout"
);

assert.match(
  cssSource,
  /\.craft-assist-preset-apply-count\s*\{[\s\S]*display:\s*flex;[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*center;[\s\S]*width:\s*64px;/m,
  "craft assist preset apply count wrapper should reserve a stable center column inside the refactored footer"
);

assert.match(
  cssSource,
  /\.craft-assist-preset-action-btn\s*\{[\s\S]*text-align:\s*center;[\s\S]*white-space:\s*nowrap;/m,
  "craft assist preset action buttons should keep a dedicated centered text box inside the rebuilt footer"
);

assert.match(
  cssSource,
  /\.craft-assist-preset-apply-step::before\s*\{[\s\S]*border-top:\s*2px solid currentColor;[\s\S]*border-right:\s*2px solid currentColor;/m,
  "craft assist preset step buttons should render visible chevron arrows instead of relying on text glyphs"
);

console.log("craftAssistPresetStepperUi tests passed");
