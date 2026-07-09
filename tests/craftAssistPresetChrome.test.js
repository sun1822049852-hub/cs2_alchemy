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
  ".craft-assist-split-bar::before {",
  ".craft-assist-preset-list {",
  "padding: 0;",
  "background: transparent;",
  ".craft-assist-preset-footer {",
  ".craft-assist-preset-action-btn {",
  "body.theme-inkblue #craftPage .craft-assist-preset-list {",
  "body.theme-inkblue #craftPage .craft-assist-preset-footer {",
  "body.theme-inkblue #craftPage .craft-assist-preset-action-btn {",
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
  /\.craft-assist-overlay-handle\s*\{[\s\S]*width:\s*112px;[\s\S]*height:\s*14px;[\s\S]*position:\s*absolute;[\s\S]*left:\s*50%;/m,
  "craft assist overlay handle should be centered against the whole assist panel instead of the left column only"
);

assert.match(
  css,
  /\.craft-assist-close\.craft-assist-close-floating\s*\{[\s\S]*top:\s*-2px;[\s\S]*right:\s*4px;[\s\S]*width:\s*16px;[\s\S]*height:\s*16px;/m,
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
  /\.craft-assist-panel\s*\{[\s\S]*padding:\s*10px 4px 10px 10px;/m,
  "craft assist panel should reduce right padding so the preset scrollbar aligns with the left reference list"
);

assert.match(
  css,
  /body\.theme-inkblue #craftPage \.craft-assist-panel\s*\{[\s\S]*padding:\s*12px 4px 12px 12px;/m,
  "ink theme should keep the same reduced right padding for preset scrollbar alignment"
);

assert.match(
  css,
  /\.craft-assist-content\s*\{[\s\S]*gap:\s*0;/m,
  "craft assist content should remove the visual gutter so the divider no longer reads like a thick empty border"
);

assert.match(
  css,
  /\.craft-assist-split-bar\s*\{[\s\S]*position:\s*relative;[\s\S]*width:\s*4px;/m,
  "craft assist split bar should use a narrow draggable lane so the panel seam no longer reads as a thick gap"
);

assert.match(
  css,
  /\.craft-assist-split-bar::before\s*\{[\s\S]*width:\s*1px;[\s\S]*left:\s*50%;[\s\S]*top:\s*0;[\s\S]*bottom:\s*0;/m,
  "craft assist split bar should render a single center divider line instead of a thick block"
);

assert.match(
  css,
  /\.craft-assist-main-col\s*\{[\s\S]*border:\s*none;[\s\S]*border-top-right-radius:\s*0;[\s\S]*border-bottom-right-radius:\s*0;/m,
  "main editor column should drop its right border so the split bar owns the only visible divider line"
);

assert.match(
  css,
  /\.craft-assist-preset-panel\s*\{[\s\S]*border:\s*none;[\s\S]*border-top-left-radius:\s*0;[\s\S]*border-bottom-left-radius:\s*0;[\s\S]*padding:\s*4px 0 4px 4px;/m,
  "preset panel should keep the seam compact while letting the preset scrollbar sit closer to the reference list edge"
);

assert.match(
  css,
  /\.craft-assist-preset-list\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*align-items:\s*center;/m,
  "preset list should center cards instead of stretching them across the full rail width"
);

assert.match(
  css,
  /\.craft-assist-preset-footer\s*\{[\s\S]*padding:\s*4px;[\s\S]*border-radius:\s*10px;/m,
  "preset card footer should have its own inset chrome so the action row can stay visually aligned"
);

assert.match(
  css,
  /\.craft-assist-preset-action-btn\s*\{[\s\S]*appearance:\s*none;[\s\S]*width:\s*100%;[\s\S]*height:\s*28px;/m,
  "preset action buttons should use a dedicated button reset instead of browser-native chrome"
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

assert.match(
  css,
  /body\.theme-inkblue #craftPage \.craft-assist-preset-action-btn\s*\{[\s\S]*background:\s*linear-gradient\([\s\S]*box-shadow:\s*inset/m,
  "preset action buttons should also use the ink theme inset chrome so the rebuilt footer reads as one control cluster"
);

console.log("craftAssistPresetChrome tests passed");
