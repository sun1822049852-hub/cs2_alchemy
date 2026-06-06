const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const JS = fs.readFileSync(path.resolve(__dirname, "../ui/app.js"), "utf8");
const WEB_INV_SECTION = JS.slice(
  JS.indexOf("// Web 库存管理页"),
  JS.indexOf("// ═══ 市场上架 ═══")
);

function test_init_does_not_call_missing_web_inventory_bootstrap_helper() {
  assert.equal(
    JS.includes("initWebInvBindings();"),
    false,
    "startup must not call the removed initWebInvBindings helper"
  );
}

function test_init_calls_defined_web_inventory_event_binder() {
  assert.match(JS, /function bindWebInvEvents\(\)/);
  assert.match(JS, /bindWebInvEvents\(\);/);
}

function test_web_inventory_accounts_use_loaded_accounts_state() {
  assert.match(
    JS,
    /function webInvAccounts\(\)\s*\{\s*return Array\.isArray\(state\.accounts\) \? state\.accounts : \[\];\s*\}/,
    "web inventory should expose a single account source backed by state.accounts"
  );
  assert.equal(
    WEB_INV_SECTION.includes("state.savedAccounts"),
    false,
    "web inventory page should not depend on a second savedAccounts state"
  );
}

function test_web_inventory_page_uses_account_inventory_route() {
  assert.equal(
    JS.includes("/api/steam/single-inventory"),
    false,
    "web inventory page should not call the removed /api/steam/single-inventory route"
  );
  assert.match(
    JS,
    /async function webInvFetchInventory\(\)[\s\S]*?api\(`\/api\/accounts\/\$\{encodeURIComponent\(username\)\}\/inventory`\)/,
    "web inventory main entry should fetch inventory through /api/accounts/:username/inventory"
  );
}

function main() {
  test_init_does_not_call_missing_web_inventory_bootstrap_helper();
  test_init_calls_defined_web_inventory_event_binder();
  test_web_inventory_accounts_use_loaded_accounts_state();
  test_web_inventory_page_uses_account_inventory_route();
  console.log("web-inventory-bootstrap tests passed");
}

main();
