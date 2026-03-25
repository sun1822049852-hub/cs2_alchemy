const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function testComponentCraftRouteUsesBatchRecipesPayload() {
  assert.equal(
    APP_SOURCE.includes('const componentFlow = pendingEntries.some((entry) => craftRecipeEntryUsesComponentItems(entry, allRowsById));'),
    true,
    "component craft execution should detect a batch component flow before submitting requests"
  );
  assert.equal(
    APP_SOURCE.includes('const data = await api("/api/craft/tradeup-with-components", {'),
    true,
    "component craft execution should call the dedicated component batch route"
  );
  assert.equal(
    APP_SOURCE.includes("recipes: pendingRecipes"),
    true,
    "component craft execution should submit the full pendingRecipes batch at once"
  );
  assert.equal(
    APP_SOURCE.includes("prepare_only: true"),
    true,
    "component craft execution should batch-prepare component items before starting serial craft calls"
  );
  assert.equal(
    APP_SOURCE.includes('const readyRecipes = prepareResults.filter((entry) => String(entry && entry.prepare_status || "").trim() === "ready");'),
    true,
    "component craft execution should derive serial craft work from the ready prepare results"
  );
  assert.equal(
    APP_SOURCE.includes("for (let i = 0; i < readyRecipes.length; i += 1) {"),
    true,
    "component craft execution should still execute ready recipes one by one after batch prepare"
  );
}

function main() {
  testComponentCraftRouteUsesBatchRecipesPayload();
  console.log("craft-component-batch-route tests passed");
}

main();
