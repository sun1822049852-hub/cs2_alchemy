const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const JS = fs.readFileSync(path.resolve(__dirname, "../ui/app.js"), "utf8");

function test_market_sell_modal_keeps_gc_source_metadata_on_rows() {
  assert.match(
    JS,
    /row\.dataset\.sourceScope\s*=\s*item\.source_scope\s*\|\|\s*"main"/,
    "market sell modal rows should keep sourceScope from GC-adapted items"
  );
  assert.match(
    JS,
    /row\.dataset\.sourceComponentId\s*=\s*item\.source_component_id\s*\|\|\s*""/,
    "market sell modal rows should keep sourceComponentId from GC-adapted items"
  );
  assert.match(
    JS,
    /row\.dataset\.sourceComponentName\s*=\s*item\.source_component_name\s*\|\|\s*""/,
    "market sell modal rows should keep sourceComponentName from GC-adapted items"
  );
}

function test_market_sell_start_submits_gc_source_metadata() {
  assert.match(
    JS,
    /items\.push\(\{\s*assetId:\s*row\.dataset\.assetid,\s*priceInCents:\s*cents,\s*currency:\s*23,\s*marketHashName:\s*row\.dataset\.marketHashName\s*\|\|\s*"",\s*sourceScope:\s*row\.dataset\.sourceScope\s*\|\|\s*"main",\s*sourceComponentId:\s*row\.dataset\.sourceComponentId\s*\|\|\s*"",\s*sourceComponentName:\s*row\.dataset\.sourceComponentName\s*\|\|\s*""\s*\}\)/,
    "marketSellStart should submit GC source metadata for component-aware listing"
  );
}

function main() {
  test_market_sell_modal_keeps_gc_source_metadata_on_rows();
  test_market_sell_start_submits_gc_source_metadata();
  console.log("web-inventory-gc-source tests passed");
}

main();
