const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function extractConst(name) {
  const match = APP_SOURCE.match(new RegExp(`^const\\s+${name}\\s*=\\s*[^;]+;`, "m"));
  assert.ok(match, `missing const ${name}`);
  return match[0];
}

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

function loadCraftComponentSelectionFns(initialState = {}) {
  const source = [
    extractConst("STORAGE_UNIT_DEF_INDEX"),
    extractConst("MAIN_INVENTORY_CAPACITY"),
    extractBlock("function isComponentRow(", "function getCraftCoolingRows("),
    extractBlock("function estimateMainInventoryFreeSlots(", "function closeTargetComponentDrawer(")
  ].join("\n");
  const context = {
    Math,
    Number,
    String,
    Array,
    Object,
    Date,
    state: {
      rows: [],
      ...initialState
    },
    console
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function makeRow({
  id,
  name,
  casketId = "",
  craftable = true,
  hiddenReason = "",
  yellowShieldBlocked = false,
  tradeLockKind = "",
  tradableAfter = 0,
  rarity = 3,
  quality = 0,
  qualityName = "Normal",
  floatValue = 0.2,
  defIndex = 7
}) {
  return {
    asset_id: String(id),
    name,
    alchemy_name: name,
    casket_id: String(casketId || ""),
    is_craftable: craftable,
    hidden_reason: hiddenReason,
    yellow_shield_blocked: yellowShieldBlocked,
    trade_lock_kind: tradeLockKind,
    tradable_after: tradableAfter,
    rarity,
    quality,
    quality_name: qualityName,
    float_value: floatValue,
    def_index: defIndex
  };
}

function pickIds(rows) {
  return Array.from((Array.isArray(rows) ? rows : []), (row) => String(row.asset_id || "")).sort();
}

function testComponentCandidatesAppearOnlyWhenEnabled() {
  const app = loadCraftComponentSelectionFns();
  const rows = [
    makeRow({id: "main-1", name: "Main Craft"}),
    makeRow({id: "component-1", name: "Component Craft", casketId: "box-1"}),
    makeRow({id: "component-2", name: "Component Craft Hidden By Casket Attr", casketId: "box-1", hiddenReason: "attr#272/273"}),
    makeRow({id: "component-hidden", name: "Hidden Component Craft", casketId: "box-1", hiddenReason: "manual"}),
    makeRow({id: "box-1", name: "Storage Unit | Blue", defIndex: 1201, craftable: false})
  ];

  assert.equal(typeof app.getAllInventoryCraftableRows, "function", "expected component-aware craft candidate helper to exist");
  assert.deepEqual(
    pickIds(app.getAllInventoryCraftableRows({rows, includeComponentItems: false})),
    ["main-1"]
  );
  assert.deepEqual(
    pickIds(app.getAllInventoryCraftableRows({rows, includeComponentItems: true})),
    ["component-1", "component-2", "main-1"]
  );
}

function testComponentCandidatesAlsoReadFromComponentItemMap() {
  const app = loadCraftComponentSelectionFns({
    component: {
      summary_map: {
        "box-1": {component_id: "box-1", name: "蓝箱"}
      },
      item_map: {
        "box-1": [
          makeRow({id: "component-1", name: "Component Craft", casketId: "box-1"})
        ]
      }
    }
  });
  const rows = [
    makeRow({id: "main-1", name: "Main Craft"})
  ];

  assert.deepEqual(
    pickIds(app.getAllInventoryCraftableRows({rows, includeComponentItems: true})),
    ["component-1", "main-1"]
  );
}

function testStrictPreclipHidesUnselectedComponentCandidatesAtBudget() {
  const app = loadCraftComponentSelectionFns();
  assert.equal(typeof app.shouldHideUnselectedComponentCandidate, "function", "expected strict pre-clip helper to exist");
  assert.equal(
    app.shouldHideUnselectedComponentCandidate({
      selectedComponentCount: 3,
      mainFreeSlots: 3,
      isSelected: false
    }),
    true
  );
  assert.equal(
    app.shouldHideUnselectedComponentCandidate({
      selectedComponentCount: 3,
      mainFreeSlots: 3,
      isSelected: true
    }),
    false
  );
  assert.equal(
    app.shouldHideUnselectedComponentCandidate({
      selectedComponentCount: 2,
      mainFreeSlots: 3,
      isSelected: false
    }),
    false
  );
}

function testSourceClarifiesAvailableMeansActualWithdrawableCount() {
  assert.equal(
    APP_SOURCE.includes("实际可从组件中取出"),
    true,
    "component-mode hints should clarify that available count means actual withdrawable items from components"
  );
}

function testYellowShieldRowsStayUnselectableWhileNormalCoolingRemainsAvailable() {
  const app = loadCraftComponentSelectionFns();
  const rows = [
    makeRow({id: "plain-1", name: "Plain Craft"}),
    makeRow({id: "steam-cooling-1", name: "Steam Cooling Craft", tradableAfter: "2000000000"}),
    makeRow({
      id: "yellow-shield-1",
      name: "Yellow Shield Craft",
      yellowShieldBlocked: true,
      tradeLockKind: "yellow_shield",
      tradableAfter: "2000000000"
    })
  ];

  assert.equal(app.isInventoryRowSelectable(rows[0]), true);
  assert.equal(app.isInventoryRowSelectable(rows[1]), true);
  assert.equal(app.isInventoryRowSelectable(rows[2]), false);
  assert.deepEqual(
    pickIds(app.getAllInventoryCraftableRows({rows, includeComponentItems: false})),
    ["plain-1", "steam-cooling-1"]
  );
}

function main() {
  testComponentCandidatesAppearOnlyWhenEnabled();
  testComponentCandidatesAlsoReadFromComponentItemMap();
  testStrictPreclipHidesUnselectedComponentCandidatesAtBudget();
  testSourceClarifiesAvailableMeansActualWithdrawableCount();
  testYellowShieldRowsStayUnselectableWhileNormalCoolingRemainsAvailable();
  console.log("craft-component-selection-ui tests passed");
}

main();
