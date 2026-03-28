const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "..", "node_sidecar", "ui", "index.html");
const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");

const html = fs.readFileSync(htmlPath, "utf8");
const app = fs.readFileSync(appPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");

const htmlFragments = [
  'id="craftShowFullWear"',
  'id="componentCraftShowFullWear"',
  ">显示完整磨损<"
];

for (const fragment of htmlFragments) {
  assert.equal(
    html.includes(fragment),
    true,
    `craft queue slot image layout html should include fragment: ${fragment}`
  );
}

const appFragments = [
  "function decorateCraftSlotSkinImage(slot, row) {",
  'slot.classList.add("has-skin-image");',
  'slot.style.setProperty("--craft-slot-skin-image", cssUrlValue(imageUrl));',
  "ui.craftQueueList.classList.toggle(\"has-items\", !!list.length);",
  'ui.craftRightPanel.classList.toggle("compact-actions", width > 0 && width < 550);',
  "craftShowFullWear: false",
  'craftShowFullWear: document.getElementById("craftShowFullWear")',
  'componentCraftShowFullWear: document.getElementById("componentCraftShowFullWear")',
  "craft_show_full_wear",
  "state.craftShowFullWear = !!checked;"
];

for (const fragment of appFragments) {
  assert.equal(
    app.includes(fragment),
    true,
    `craft queue slot image layout app should include fragment: ${fragment}`
  );
}

const makeCraftSlotNodeMatch = app.match(/function makeCraftSlotNode\(\{row = null, rawId = "", onRemove = null(?:, removeDisabled = false)?\}\) \{([\s\S]*?)\n\}/);
assert.ok(makeCraftSlotNodeMatch, "should find makeCraftSlotNode function");
assert.equal(
  makeCraftSlotNodeMatch[1].includes('craft-slot-name'),
  false,
  "craft slot should no longer render the visible item name inside the slot"
);

assert.equal(
  makeCraftSlotNodeMatch[1].includes('slot.classList.toggle("full-wear-text", !!state.craftShowFullWear);'),
  true,
  "craft slot should toggle a full-wear class when complete wear display is enabled"
);

const formatCraftSlotWearMatch = app.match(/function formatCraftSlotWear\(row\) \{([\s\S]*?)\n\}/);
assert.ok(formatCraftSlotWearMatch, "should find formatCraftSlotWear function");
assert.match(
  formatCraftSlotWearMatch[1],
  /return state\.craftShowFullWear \? wearTextFull\(value\) : numberTextTrunc\(value,\s*8\);/,
  "craft slot wear text should default to 8-digit truncation and switch to full wear when enabled"
);

const cssFragments = [
  ".craft-queue-list.has-items {",
  ".craft-right-panel.compact-actions .craft-queue-list.has-items {",
  ".craft-slot.has-skin-image {",
  ".craft-slot.has-skin-image::before {",
  ".craft-slot.has-skin-image::after {",
  ".craft-slot.has-skin-image .craft-slot-wear {",
  ".craft-slot.full-wear-text .craft-slot-wear {"
];

for (const fragment of cssFragments) {
  assert.equal(
    css.includes(fragment),
    true,
    `craft queue slot image layout css should include fragment: ${fragment}`
  );
}

assert.match(
  css,
  /\.craft-queue-list\.has-items\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/m,
  "craft queue list should render pending recipes in two columns"
);

assert.match(
  css,
  /\.craft-right-panel\.compact-actions\s+\.craft-queue-list\.has-items\s*\{[\s\S]*grid-template-columns:\s*1fr;/m,
  "craft queue list should collapse to a single column when the right panel becomes compact"
);

assert.match(
  css,
  /\.craft-slot-wear\s*\{[\s\S]*font-size:\s*10px;[\s\S]*word-break:\s*break-all;/m,
  "craft slot wear should keep a compact text style"
);

assert.match(
  css,
  /\.craft-slot\.has-skin-image\s*\{[\s\S]*padding:\s*6px;/m,
  "craft slot with skin art should let the weapon image occupy the full slot footprint"
);

assert.match(
  css,
  /\.craft-slot\.has-skin-image::before\s*\{[\s\S]*linear-gradient\(180deg,[\s\S]*0%[\s\S]*56%[\s\S]*100%/m,
  "craft slot should switch to a vertical overlay so the full weapon art remains visible underneath"
);

assert.match(
  css,
  /\.craft-slot\.has-skin-image::after\s*\{[\s\S]*inset:\s*0;[\s\S]*background-position:\s*center\s*center;[\s\S]*background-size:\s*cover;/m,
  "craft slot weapon image should fill the entire slot instead of staying in a side lane"
);

assert.match(
  css,
  /\.craft-slot\.has-skin-image\s+\.craft-slot-wear\s*\{[\s\S]*left:\s*0;[\s\S]*right:\s*0;[\s\S]*bottom:\s*0;[\s\S]*top:\s*auto;[\s\S]*padding:\s*4px\s*6px\s*3px;[\s\S]*border-radius:\s*0\s+0\s+11px\s+11px;[\s\S]*text-align:\s*center;[\s\S]*white-space:\s*nowrap;[\s\S]*text-overflow:\s*ellipsis;/m,
  "craft slot wear should render as a horizontal bottom bar covering the image"
);

assert.match(
  css,
  /\.craft-slot\.full-wear-text\s+\.craft-slot-wear\s*\{[\s\S]*font-size:\s*8px;[\s\S]*letter-spacing:\s*-0\.02em;[\s\S]*text-overflow:\s*clip;/m,
  "full wear mode should tighten the bottom bar text so the complete wear value can remain visible"
);

const forbiddenAppFragments = [
  "function formatCraftChildSlotWear(row) {",
  "function decorateCraftChildSlotCell(nameCell, row) {",
  'const childNameCell = child.children[1];',
  'decorateCraftChildSlotCell(childNameCell, item);'
];

for (const fragment of forbiddenAppFragments) {
  assert.equal(
    app.includes(fragment),
    false,
    `craft queue slot image layout app should not repurpose expanded child rows into slot-image widgets: ${fragment}`
  );
}

const forbiddenCssFragments = [
  ".craft-child-slot-cell {",
  ".craft-child-slot {"
];

for (const fragment of forbiddenCssFragments) {
  assert.equal(
    css.includes(fragment),
    false,
    `craft queue slot image layout css should not add child-row slot styling: ${fragment}`
  );
}

console.log("craftQueueSlotImageLayout tests passed");
