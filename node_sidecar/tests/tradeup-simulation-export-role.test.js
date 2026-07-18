const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

function loadExportFns() {
  const source = [
    extractBlock("function sanitizeTradeupSimulationTargetItem(", "function getTradeupSimulationDefaultName("),
    extractBlock("function extractSimExportCraftMaterials(", "function renderSimExportCraftMaterialList(")
  ].join("\n");
  const context = {String, Number, Array, Object, Set, Map, console};
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function item({market, localized, collection}) {
  return {
    markethashname: market,
    basemarkethashname: market.replace(/\s+\([^)]+\)$/, ""),
    basename: market.replace(/\s+\([^)]+\)$/, ""),
    name: localized,
    collection,
    rarity: "军规级"
  };
}

function test_export_uses_first_material_row_as_main_and_later_rows_as_aux_when_slots_are_missing() {
  const app = loadExportFns();
  const main = item({
    market: "FAMAS | Half Sleeve (Field-Tested)",
    localized: "法玛斯 | 半袖式 (久经沙场)",
    collection: "狩猎运动收藏品"
  });
  const aux = item({
    market: "PP-Bizon | Carbon Fiber (Factory New)",
    localized: "PP-野牛 | 碳素纤维 (崭新出厂)",
    collection: "殒命大厦收藏品"
  });

  const materials = app.extractSimExportCraftMaterials({
    main_material: null,
    aux_material: null,
    material_rows: [
      {collection: "狩猎运动收藏品", materials: [main]},
      {collection: "殒命大厦收藏品", materials: [aux]}
    ]
  });

  assert.deepEqual(Array.from(materials, (entry) => entry.role), ["main", "aux"]);
  assert.deepEqual(Array.from(materials, (entry) => entry.display_name), [
    "法玛斯 | 半袖式 (久经沙场)",
    "PP-野牛 | 碳素纤维 (崭新出厂)"
  ]);
  assert.deepEqual(Array.from(materials, (entry) => entry.markethashname), [
    "FAMAS | Half Sleeve (Field-Tested)",
    "PP-Bizon | Carbon Fiber (Factory New)"
  ]);
}

test_export_uses_first_material_row_as_main_and_later_rows_as_aux_when_slots_are_missing();
console.log("tradeup-simulation-export-role tests passed");
