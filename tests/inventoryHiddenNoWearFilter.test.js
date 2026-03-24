const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "..", "node_sidecar", "ui", "app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

function pickIds(rows) {
  return Array.from((Array.isArray(rows) ? rows : []), (row) => String(row.asset_id || ""))
    .filter(Boolean)
    .sort();
}

function loadApplyFilter(rows) {
  const source = extractBlock("function applyFilter()", "function resetRenderWindow()");
  const context = {
    Math,
    Number,
    String,
    Array,
    Object,
    Set,
    state: {
      searchText: "",
      raritySelected: new Set(),
      collectionSelected: new Set(),
      raritySort: "asc",
      wearSort: "asc",
      emptyHint: ""
    },
    RARITY_VALUES: [1, 2, 3, 4, 5, 6],
    rowsForComponentScope() {
      return rows;
    },
    selectedComponentId() {
      return "";
    },
    validateWearFilter() {
      return {valid: true, minValue: null, maxValue: null};
    },
    itemHasWear(row) {
      return !!row.has_wear;
    },
    itemSearchText(row) {
      return String(row.name || "").toLowerCase();
    },
    collectionName(row) {
      return String(row.collection || "");
    },
    rarityName(row) {
      return String(row.rarity_name || row.rarity || "");
    },
    assetIdNumber(row) {
      const n = Number(row && row.asset_id);
      return Number.isFinite(n) ? Math.trunc(n) : 0;
    },
    console
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function testHiddenNoWearMainInventoryItemIsFilteredOut() {
  const rows = [
    {
      asset_id: "10001",
      name: "AK-47 | Slate (Field-Tested)",
      hidden_reason: "",
      casket_id: "",
      has_wear: true,
      float_value: 0.22
    },
    {
      asset_id: "10002",
      name: "Sealed Graffiti | Hop (Brick Red)",
      hidden_reason: "manual",
      casket_id: "",
      has_wear: false
    },
    {
      asset_id: "10003",
      name: "Sticker | Test",
      hidden_reason: "",
      casket_id: "",
      has_wear: false
    }
  ];

  const app = loadApplyFilter(rows);
  const result = app.applyFilter();

  assert.deepEqual(
    pickIds(result.filteredRows),
    ["10001", "10003"],
    "hidden no-wear main inventory items should not leak back into the visible filtered rows"
  );
}

function main() {
  testHiddenNoWearMainInventoryItemIsFilteredOut();
  console.log("inventoryHiddenNoWearFilter tests passed");
}

main();
