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

function loadCraftReconcileFns(initialState = {}) {
  const source = [
    extractConst("STORAGE_UNIT_DEF_INDEX"),
    extractBlock("function isComponentRow(", "function getCraftCoolingRows("),
    extractBlock("function getQueuedCraftItemIds(", "function getAbsoluteWearValue(")
  ].join("\n");
  const context = {
    Math,
    Number,
    String,
    Array,
    Object,
    Date,
    Set,
    console,
    state: {
      rows: [],
      craftUseComponentItems: true,
      craftRecipeQueue: [],
      craftActiveRecipeId: "",
      craftSelectedItemIds: new Set(),
      component: {summary_map: {}, item_map: {}},
      ...initialState
    }
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
    rarity,
    quality,
    quality_name: qualityName,
    float_value: floatValue,
    def_index: defIndex
  };
}

function testComponentQueuedItemSurvivesFullInventoryReconcile() {
  const entry = {
    id: "recipe-1",
    status: "pending",
    item_ids: ["component-1", "main-1"],
    item_sources: {
      "component-1": {
        source_scope: "component",
        source_component_id: "box-old",
        source_component_name: "旧箱"
      },
      "main-1": {
        source_scope: "main",
        source_component_id: "",
        source_component_name: ""
      }
    }
  };
  const app = loadCraftReconcileFns({
    rows: [
      makeRow({id: "main-1", name: "Main Craft"}),
      makeRow({id: "component-1", name: "Component Craft", casketId: "box-1"})
    ],
    craftRecipeQueue: [entry],
    craftActiveRecipeId: "recipe-1",
    component: {
      summary_map: {
        "box-1": {component_id: "box-1", name: "蓝箱"}
      },
      item_map: {}
    }
  });

  assert.equal(typeof app.reconcileCraftQueueWithInventory, "function", "expected full-inventory reconcile helper to exist");
  app.reconcileCraftQueueWithInventory();

  assert.deepEqual(Array.from(entry.item_ids), ["component-1", "main-1"]);
  assert.equal(entry.item_sources["component-1"].source_scope, "component");
  assert.equal(entry.item_sources["component-1"].source_component_id, "box-1");
  assert.equal(entry.item_sources["component-1"].source_component_name, "蓝箱");
}

function testMissingQueuedItemIsRemovedButRecipeRemainsPending() {
  const entry = {
    id: "recipe-1",
    status: "pending",
    item_ids: ["component-missing", "main-1"],
    item_sources: {
      "component-missing": {
        source_scope: "component",
        source_component_id: "box-1",
        source_component_name: "蓝箱"
      },
      "main-1": {
        source_scope: "main",
        source_component_id: "",
        source_component_name: ""
      }
    }
  };
  const app = loadCraftReconcileFns({
    rows: [
      makeRow({id: "main-1", name: "Main Craft"})
    ],
    craftRecipeQueue: [entry],
    craftActiveRecipeId: "recipe-1"
  });

  app.reconcileCraftQueueWithInventory();

  assert.deepEqual(Array.from(entry.item_ids), ["main-1"]);
  assert.equal(Object.prototype.hasOwnProperty.call(entry.item_sources, "component-missing"), false);
  assert.equal(entry.removed_missing_count, 1);
}

function main() {
  testComponentQueuedItemSurvivesFullInventoryReconcile();
  testMissingQueuedItemIsRemovedButRecipeRemainsPending();
  console.log("craft-component-reconcile tests passed");
}

main();
