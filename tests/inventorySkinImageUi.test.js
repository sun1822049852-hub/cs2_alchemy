const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");

const app = fs.readFileSync(appPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");

const appFragments = [
  "function preferredRowSkinImageUrl(",
  "row.goods_original_icon_url",
  "row.goods_icon_url",
  "row.goods_share_thumbnail_url",
  'backdrop.className = "card-skin-backdrop"',
  'card.classList.add("has-skin-image")',
  'nameCell.classList.add("group-name-cell")',
  'nameCell.classList.add("has-skin-image")',
  'const craftNameCell = parent.children[1];',
  'decorateGroupNameCell(craftNameCell, row.name, preferredRowsSkinImageUrl(row.items));'
];

for (const fragment of appFragments) {
  assert.equal(
    app.includes(fragment),
    true,
    `inventory image ui app should include fragment: ${fragment}`
  );
}

const cssFragments = [
  ".card.has-skin-image {",
  ".card-skin-backdrop {",
  ".group-name-cell {",
  ".group-name-cell.has-skin-image {",
  ".group-name-cell.has-skin-image::before {"
];

for (const fragment of cssFragments) {
  assert.equal(
    css.includes(fragment),
    true,
    `inventory image ui css should include fragment: ${fragment}`
  );
}

assert.match(
  css,
  /\.group-name-cell\.has-skin-image\s*\{\s*background:\s*transparent;/,
  "group name cell should no longer paint an extra color layer under the weapon image"
);

console.log("inventorySkinImageUi tests passed");
