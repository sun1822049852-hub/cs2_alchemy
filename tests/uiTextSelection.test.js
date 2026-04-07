const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");
const css = fs.readFileSync(cssPath, "utf8");

const requiredFragments = [
  "body {",
  "-webkit-user-select: none;",
  "user-select: none;",
  "input,",
  "textarea,",
  '[contenteditable="true"] {',
  "-webkit-user-select: text;",
  "user-select: text;"
];

for (const fragment of requiredFragments) {
  assert.equal(
    css.includes(fragment),
    true,
    `ui text selection css should include fragment: ${fragment}`
  );
}

console.log("uiTextSelection tests passed");
