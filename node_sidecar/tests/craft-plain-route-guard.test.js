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

function loadRecipePayloadHelpers() {
  const source = [
    extractBlock("function normalizeCraftRecipeItemIds(", "function buildCraftItemSourceSnapshot("),
    extractBlock("function buildCraftApiRecipePayload(", "function buildCraftItemSourceSnapshot(")
  ].join("\n");
  const context = {
    Array,
    JSON,
    Math,
    Number,
    Object,
    String,
    console,
    deepCopyPlain(value) {
      return JSON.parse(JSON.stringify(value));
    }
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function testBuildCraftApiRecipePayloadKeepsItemSources() {
  const app = loadRecipePayloadHelpers();
  const payload = app.buildCraftApiRecipePayload({
    queue_index: 3,
    item_ids: ["1001", "1001", "1002"],
    item_sources: {
      "1001": {
        source_scope: "component",
        source_component_id: "5001",
        source_component_name: "Box 5001"
      },
      "1002": {
        source_scope: "main",
        source_component_id: "",
        source_component_name: ""
      }
    }
  });

  assert.equal(payload.queue_index, 3);
  assert.deepEqual(Array.from(payload.item_ids), ["1001", "1002"]);
  assert.equal(payload.item_sources["1001"].source_scope, "component");
  assert.equal(payload.item_sources["1001"].source_component_id, "5001");
}

function testPlainCraftRouteUsesRecipePayloadInsteadOfBareItemIds() {
  assert.equal(
    APP_SOURCE.includes("recipes: [buildCraftApiRecipePayload(req)]"),
    true,
    "plain craft route should carry item_sources metadata for backend guard"
  );
  assert.equal(
    APP_SOURCE.includes("item_ids: req.item_ids"),
    false,
    "plain craft route should no longer send only bare item_ids"
  );
}

function main() {
  testBuildCraftApiRecipePayloadKeepsItemSources();
  testPlainCraftRouteUsesRecipePayloadInsteadOfBareItemIds();
  console.log("craft-plain-route-guard tests passed");
}

main();
