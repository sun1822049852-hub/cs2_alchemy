const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");

const app = fs.readFileSync(appPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");

const appFragments = [
  'class="row-check item-check"',
  'const itemCheck = child.querySelector(".item-check");',
  "itemCheck.onclick = (evt) => {",
  "toggleComponentItemSelection(itemId);"
];

for (const fragment of appFragments) {
  assert.equal(
    app.includes(fragment),
    true,
    `inventory selection app should include fragment: ${fragment}`
  );
}

const cssFragments = [
  "body.theme-inkblue #inventoryPage .group-parent.selected,",
  "body.theme-inkblue #inventoryPage .group-child.selected {",
  "rgba(243, 199, 121, 0.26)",
  "rgba(220, 164, 76, 0.12)"
];

for (const fragment of cssFragments) {
  assert.equal(
    css.includes(fragment),
    true,
    `inventory selection css should include fragment: ${fragment}`
  );
}

console.log("inventorySelectionBehavior tests passed");
