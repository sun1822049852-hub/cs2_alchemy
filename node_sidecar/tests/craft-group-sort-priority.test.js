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

function loadGroupSortFns(overrides = {}) {
  const source = [
    extractBlock("function buildGroupRows(", "function renderGrouped("),
    extractBlock("function buildCraftGroupRows(", "function renderCraftGrouped(")
  ].join("\n");
  const context = {
    state: overrides.state || {
      wearSort: "asc",
      raritySort: "desc",
      quantitySort: "desc",
      collectionSort: "asc"
    },
    itemDisplayName: overrides.itemDisplayName || ((row) => String(row && row.group_name || row && row.name || "").trim()),
    itemHasWear: overrides.itemHasWear || (() => true),
    coolingUnlockTs: overrides.coolingUnlockTs || ((row) => Number(row && row.cooling_unlock_ts || 0) || 0),
    groupCollectionText: overrides.groupCollectionText || ((items) => {
      const first = Array.isArray(items) ? items[0] : null;
      return String(first && first.collection || "").trim();
    }),
    groupNeedsExpand: overrides.groupNeedsExpand || (() => false),
    assetIdNumber: overrides.assetIdNumber || ((row) => {
      const numeric = Number(row && row.asset_id || 0);
      return Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
    }),
    formatVisibleWearText: overrides.formatVisibleWearText || ((value) => String(value)),
    rarityName: overrides.rarityName || ((row) => String(row && row.rarity_name || row && row.rarity || "")),
    groupCooldownText: overrides.groupCooldownText || (() => "无"),
    Math,
    Number,
    String,
    Array,
    Map,
    Set,
    console
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function testCraftGroupedRowsPrioritizeRarityOverCollection() {
  const app = loadGroupSortFns({
    state: {
      wearSort: "asc",
      raritySort: "desc",
      quantitySort: "desc",
      collectionSort: "asc"
    }
  });
  const candidates = [
    {
      asset_id: "1001",
      name: "低稀有度 A",
      group_name: "低稀有度 A",
      collection: "A Collection",
      rarity: 1,
      rarity_name: "工业级",
      float_value: 0.2,
      minfloat: 0,
      maxfloat: 1
    },
    {
      asset_id: "2001",
      name: "高稀有度 Z",
      group_name: "高稀有度 Z",
      collection: "Z Collection",
      rarity: 2,
      rarity_name: "军规级",
      float_value: 0.2,
      minfloat: 0,
      maxfloat: 1
    }
  ];

  const rows = app.buildCraftGroupRows(candidates);

  assert.equal(
    JSON.stringify(rows.map((row) => String(row.name || ""))),
    JSON.stringify(["高稀有度 Z", "低稀有度 A"]),
    "craft grouped table should sort higher rarity before lower rarity even when collection sort would otherwise place the lower rarity group first"
  );
}

function main() {
  testCraftGroupedRowsPrioritizeRarityOverCollection();
  console.log("craft-group-sort-priority tests passed");
}

main();
