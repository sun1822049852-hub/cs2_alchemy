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
  'linear-gradient(90deg, rgba(10,12,16,0.82) 0%, rgba(16,19,24,0.4) 42%, rgba(16,19,24,0.04) 100%)',
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
  "body.theme-inkblue #inventoryPage .card-skin-backdrop {",
  ".group-name-cell {",
  ".group-name-cell.has-skin-image {",
  ".group-name-cell.has-skin-image::before {",
  ".group-name-label {"
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
  /\.group-name-cell\.has-skin-image\s*\{[\s\S]*background:\s*transparent;[\s\S]*padding-left:\s*124px;[\s\S]*padding-right:\s*12px;/m,
  "group name cell should reserve a foreground text lane instead of letting the name sit on top of the weapon image"
);

assert.match(
  css,
  /\.group-name-label\s*\{[\s\S]*display:\s*block;[\s\S]*max-width:\s*100%;[\s\S]*word-break:\s*break-word;/m,
  "group name label should wrap within the reserved text lane"
);

assert.equal(
  app.includes("rgba(255,255,255,0.97)"),
  false,
  "inventory card skin backdrop should no longer use a white wash gradient"
);

console.log("inventorySkinImageUi tests passed");
