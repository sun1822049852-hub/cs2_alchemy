const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const JS = fs.readFileSync(path.resolve(__dirname, "../ui/app.js"), "utf8");
const WEB_INV_SECTION = JS.slice(
  JS.indexOf("// Web 库存管理页"),
  JS.indexOf("// ═══ 市场上架 ═══")
);
const OLD_MODAL_SECTION = JS.slice(
  JS.indexOf("// ===== Web 库存查看"),
  JS.indexOf("function renderWebInventoryList")
);

function test_legacy_web_inventory_modal_uses_independent_web_inventory_route() {
  assert.match(
    JS,
    /async function fetchWebInventory\(username\)[\s\S]*?api\(`\/api\/accounts\/\$\{encodeURIComponent\(username\)\}\/inventory`\)/,
    "legacy web inventory modal should fetch through /api/accounts/:username/inventory"
  );
  assert.equal(
    OLD_MODAL_SECTION.includes("/api/snapshot/account"),
    false,
    "legacy web inventory modal should not read GC snapshot data"
  );
  assert.equal(
    OLD_MODAL_SECTION.includes("source=web_inventory"),
    false,
    "legacy web inventory modal should not label GC snapshots as web inventory"
  );
  assert.equal(
    OLD_MODAL_SECTION.includes("save_stub=1"),
    false,
    "legacy web inventory modal should not persist web inventory snapshot stubs"
  );
}

function test_web_inventory_reads_do_not_mutate_gc_inventory_state() {
  assert.equal(
    WEB_INV_SECTION.includes("setRows("),
    false,
    "web inventory reads should not call the GC inventory row setter"
  );
  assert.equal(
    WEB_INV_SECTION.includes("state.rows ="),
    false,
    "web inventory reads should not write GC inventory rows"
  );
  assert.equal(
    WEB_INV_SECTION.includes("webInvBuildSnapshotCacheEntry"),
    false,
    "web inventory reads should not adapt GC snapshots into web inventory cache"
  );
  assert.equal(
    WEB_INV_SECTION.includes("/api/snapshot/account"),
    false,
    "web inventory reads should not call the GC snapshot route"
  );
  assert.equal(
    WEB_INV_SECTION.includes("save_stub=1"),
    false,
    "web inventory reads should not save GC snapshot stubs"
  );
}

function test_web_inventory_section_does_not_accept_gc_source_metadata() {
  for (const key of ["source_scope", "source_component_id", "source_component_name"]) {
    assert.equal(
      WEB_INV_SECTION.includes(key),
      false,
      `web inventory section should not accept GC source metadata: ${key}`
    );
  }
}

function main() {
  test_legacy_web_inventory_modal_uses_independent_web_inventory_route();
  test_web_inventory_reads_do_not_mutate_gc_inventory_state();
  test_web_inventory_section_does_not_accept_gc_source_metadata();
  console.log("web-inventory-gc-source tests passed");
}

main();
