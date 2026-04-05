const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "..", "node_sidecar", "ui", "index.html");
const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");

const html = fs.readFileSync(htmlPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");

const htmlFragments = [
  '<section class="page hidden" id="inventoryPage">',
  '<section class="page hidden" id="craftPage">',
  'id="filterDrawer"',
  'id="componentPanel"',
  'class="craft-queue-shell"',
  'id="craftExecutionOverlay"'
];

for (const fragment of htmlFragments) {
  assert.equal(
    html.includes(fragment),
    true,
    `inventory/craft style scope html should include fragment: ${fragment}`
  );
}

const cssFragments = [
  "body.theme-inkblue :is(#inventoryPage, #craftPage) {",
  "--ops-page-bg: linear-gradient(180deg, #16181c 0%, #0f1114 100%);",
  "--ops-accent: #dca44c;",
  "body.theme-inkblue #inventoryPage .topbar,",
  "body.theme-inkblue #craftPage .craft-topbar,",
  "body.theme-inkblue #inventoryPage #componentPanel,",
  "body.theme-inkblue #inventoryPage #filterDrawer,",
  "body.theme-inkblue #inventoryPage .filter-menu-shell,",
  "body.theme-inkblue #inventoryPage .group-table th {",
  "body.theme-inkblue :is(#inventoryPage, #craftPage) :is(.group-table, .craft-selection-table, .deposit-table, .deposit-excluded-table) {",
  "body.theme-inkblue :is(#inventoryPage, #craftPage) :is(.group-table th, .group-table td, .craft-selection-table th, .craft-selection-table td, .deposit-table th, .deposit-table td, .deposit-excluded-table th, .deposit-excluded-table td) {",
  "body.theme-inkblue #inventoryPage .component-available-badge,",
  "body.theme-inkblue #inventoryPage .card.selected,",
  "body.theme-inkblue #craftPage #craftLayout > .panel,",
  "body.theme-inkblue #craftPage .craft-selection-list,",
  "body.theme-inkblue :is(#inventoryPage, #craftPage) .row-check {",
  "appearance: none;",
  "body.theme-inkblue :is(#inventoryPage, #craftPage) .row-check:checked {",
  "body.theme-inkblue :is(#inventoryPage, #craftPage) .row-check:indeterminate {",
  "body.theme-inkblue :is(#inventoryPage, #craftPage) .sort-stack {",
  "body.theme-inkblue :is(#inventoryPage, #craftPage) .arrow-tri {",
  "body.theme-inkblue :is(#inventoryPage, #craftPage) .arrow-tri.active.up::before {",
  "body.theme-inkblue :is(#inventoryPage, #craftPage) .arrow-tri.active.down::before {",
  "body.theme-inkblue #craftPage :is(.group-parent, .group-child) {",
  "body.theme-inkblue #craftPage .group-parent.selected,",
  "body.theme-inkblue #craftPage .group-child.selected {",
  "body.theme-inkblue #craftPage .craft-selection-table th {",
  "body.theme-inkblue :is(#inventoryPage, #craftPage) :is(#listWrap, .menu-list, .task-queue-list, .drawer-select-list, .craft-selection-list, .craft-queue-list, .craft-assist-picker, .craft-assist-list, .craft-assist-preset-list, #craftPredictorList) {",
  "scrollbar-color: rgba(220, 164, 76, 0.72) rgba(12, 14, 18, 0.88);",
  "body.theme-inkblue :is(#inventoryPage, #craftPage) :is(#listWrap, .menu-list, .task-queue-list, .drawer-select-list, .craft-selection-list, .craft-queue-list, .craft-assist-picker, .craft-assist-list, .craft-assist-preset-list, #craftPredictorList)::-webkit-scrollbar {",
  "body.theme-inkblue :is(#inventoryPage, #craftPage) :is(#listWrap, .menu-list, .task-queue-list, .drawer-select-list, .craft-selection-list, .craft-queue-list, .craft-assist-picker, .craft-assist-list, .craft-assist-preset-list, #craftPredictorList)::-webkit-scrollbar-thumb {",
  "body.theme-inkblue #craftPage .craft-assist-panel,",
  "body.theme-inkblue #craftPage .craft-assist-preset-panel,",
  "body.theme-inkblue #craftPage .craft-queue-shell,",
  "body.theme-inkblue #craftPage .craft-queue-group.active {",
  "body.theme-inkblue #craftPage .craft-slot.filled {",
  "body.theme-inkblue #craftPage .craft-execution-card {"
];

for (const fragment of cssFragments) {
  assert.equal(
    css.includes(fragment),
    true,
    `missing inventory/craft style fragment: ${fragment}`
  );
}

assert.match(
  css,
  /body\.theme-inkblue\s*\{[\s\S]*scrollbar-color:\s*rgba\(220,\s*164,\s*76,\s*0\.72\)\s*rgba\(12,\s*14,\s*18,\s*0\.88\);/m,
  "inventory and craft pages should tint the window scrollbar to the shared yellow inkblue accent"
);

assert.match(
  css,
  /body\.theme-inkblue::-webkit-scrollbar\s*\{/m,
  "inventory and craft pages should style the window scrollbar width in webkit browsers"
);

assert.match(
  css,
  /body\.theme-inkblue::-webkit-scrollbar-thumb\s*\{[\s\S]*linear-gradient\(180deg,\s*rgba\(243,\s*199,\s*121,\s*0\.82\),\s*rgba\(220,\s*164,\s*76,\s*0\.54\)\);/m,
  "inventory and craft pages should style the window scrollbar thumb with the yellow accent gradient"
);

console.log("inventoryCraftStyleScope tests passed");
