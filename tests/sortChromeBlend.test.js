const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");
const css = fs.readFileSync(cssPath, "utf8");

const cssFragments = [
  "body.theme-inkblue :is(#inventoryPage, #craftPage) .sort-stack {",
  "body.theme-inkblue :is(#inventoryPage, #craftPage) .arrow-tri {",
  "body.theme-inkblue :is(#inventoryPage, #craftPage) .arrow-tri:hover {"
];

for (const fragment of cssFragments) {
  assert.equal(
    css.includes(fragment),
    true,
    `sort chrome blend css should include fragment: ${fragment}`
  );
}

assert.match(
  css,
  /body\.theme-inkblue :is\(#inventoryPage, #craftPage\) \.sort-stack\s*\{[\s\S]*border-color:\s*transparent;[\s\S]*background:\s*transparent;[\s\S]*box-shadow:\s*none;/m,
  "sort stack should hide its square chrome by blending into the themed table header"
);

assert.match(
  css,
  /body\.theme-inkblue :is\(#inventoryPage, #craftPage\) \.arrow-tri\s*\{[\s\S]*background:\s*transparent;[\s\S]*border-radius:\s*0;/m,
  "arrow buttons should not paint a visible tile behind the glyphs"
);

assert.match(
  css,
  /body\.theme-inkblue :is\(#inventoryPage, #craftPage\) \.arrow-tri:hover\s*\{[\s\S]*background:\s*transparent;/m,
  "hovering sort arrows should keep the background invisible"
);

console.log("sortChromeBlend tests passed");
