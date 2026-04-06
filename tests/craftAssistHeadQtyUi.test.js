const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");
const appSource = fs.readFileSync(appPath, "utf8");
const cssSource = fs.readFileSync(cssPath, "utf8");

const appFragments = [
  'qtyText.className = "craft-assist-head-qty-badge";',
  'const qtyShell = document.createElement("div");',
  'qtyShell.className = "craft-assist-head-qty-shell";',
  'const qtySpin = document.createElement("div");',
  'qtySpin.className = "craft-assist-head-qty-spin";',
  'const decrementBtn = document.createElement("button");',
  'decrementBtn.className = "craft-assist-head-qty-step decrement";',
  'decrementBtn.setAttribute("aria-label", "减少数量");',
  'const incrementBtn = document.createElement("button");',
  'incrementBtn.className = "craft-assist-head-qty-step increment";',
  'incrementBtn.setAttribute("aria-label", "增加数量");',
  'qtyShell.append(qtyInput, qtySpin);',
  'qtySpin.append(incrementBtn, decrementBtn);',
  'qtyLabel.append(qtyText, qtyShell);'
];

for (const fragment of appFragments) {
  assert.equal(
    appSource.includes(fragment),
    true,
    `craft assist head qty ui should include fragment: ${fragment}`
  );
}

const cssFragments = [
  ".craft-assist-head-qty {",
  ".craft-assist-head-qty-badge {",
  ".craft-assist-head-qty-shell {",
  ".craft-assist-head-qty-spin {",
  ".craft-assist-head-qty-step {",
  ".craft-assist-head-qty-step::before {",
  ".craft-assist-head-qty-step.increment::before {",
  ".craft-assist-head-qty-step.decrement::before {",
  '.craft-assist-head-qty input[type="number"]::-webkit-outer-spin-button,',
  '.craft-assist-head-qty input[type="number"]::-webkit-inner-spin-button {'
];

for (const fragment of cssFragments) {
  assert.equal(
    cssSource.includes(fragment),
    true,
    `craft assist head qty css should include fragment: ${fragment}`
  );
}

assert.match(
  cssSource,
  /\.craft-assist-head-qty\s*\{[\s\S]*width:\s*72px;[\s\S]*min-width:\s*72px;/m,
  "craft assist head qty wrapper should become narrower than the previous 88px header field"
);

assert.match(
  cssSource,
  /\.craft-assist-head-qty-badge\s*\{[\s\S]*position:\s*absolute;[\s\S]*top:\s*0;[\s\S]*left:\s*8px;/m,
  "craft assist head qty label should sit like a legend on the small frame instead of consuming vertical layout above it"
);

assert.match(
  cssSource,
  /\.craft-assist-head-qty-shell\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*16px;[\s\S]*height:\s*26px;/m,
  "craft assist head qty shell should use a compact input-plus-spinner rail"
);

assert.match(
  cssSource,
  /body\.theme-inkblue #craftPage \.craft-assist-head-qty-step\s*\{[\s\S]*color:\s*#f3c779;[\s\S]*background:\s*rgba\(243,\s*199,\s*121,\s*0\.06\);/m,
  "craft assist head qty step buttons should switch to the ink theme gold chrome instead of the light-theme blue controls"
);

console.log("craftAssistHeadQtyUi tests passed");
