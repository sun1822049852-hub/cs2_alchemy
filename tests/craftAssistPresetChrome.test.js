const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");
const css = fs.readFileSync(cssPath, "utf8");

const cssFragments = [
  ".craft-assist-overlay-handle {",
  ".craft-assist-close.craft-assist-close-floating {",
  "font-size: 0;",
  ".craft-assist-close.craft-assist-close-floating::before,",
  ".craft-assist-close.craft-assist-close-floating::after {",
  "body.theme-inkblue #craftPage .craft-assist-close.craft-assist-close-floating {",
  ".craft-assist-preset-list {",
  "padding: 0;",
  "background: transparent;",
  "body.theme-inkblue #craftPage .craft-assist-preset-list {",
  "box-shadow: none;"
];

for (const fragment of cssFragments) {
  assert.equal(
    css.includes(fragment),
    true,
    `craft assist preset chrome css should include fragment: ${fragment}`
  );
}

assert.match(
  css,
  /\.craft-assist-overlay-handle\s*\{[\s\S]*height:\s*18px;/m,
  "craft assist overlay handle should grow taller so the top guide zone keeps the close button clear of the content border"
);

assert.match(
  css,
  /\.craft-assist-close\.craft-assist-close-floating\s*\{[\s\S]*top:\s*1px;[\s\S]*right:\s*4px;[\s\S]*width:\s*16px;[\s\S]*height:\s*16px;/m,
  "floating craft assist close button should shrink and move into the top guide frame near the upper-right corner"
);

assert.match(
  css,
  /(^|\n)\.craft-assist-close\.craft-assist-close-floating\s*\{[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;[^}]*transform:\s*translateY\(0\);/m,
  "floating craft assist close button should stay persistently visible without requiring hover"
);

assert.match(
  css,
  /\.craft-assist-preset-list\s*\{[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;[\s\S]*padding:\s*0;/m,
  "preset list should drop the inner frame so only the panel and item cards keep visible chrome"
);

assert.match(
  css,
  /body\.theme-inkblue #craftPage \.craft-assist-close\.craft-assist-close-floating\s*\{[\s\S]*background:\s*linear-gradient\(/m,
  "floating craft assist close button should use a themed gradient surface instead of a plain text chip"
);

assert.match(
  css,
  /body\.theme-inkblue #craftPage \.craft-assist-close\.craft-assist-close-floating\s*\{[\s\S]*box-shadow:\s*inset/m,
  "floating craft assist close button should read as a red sunken control in the ink theme"
);

console.log("craftAssistPresetChrome tests passed");
