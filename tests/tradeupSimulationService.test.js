const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {DatabaseSync} = require("node:sqlite");

const {createCraftOutcomeCatalog} = require("../node_sidecar/src/services/craftOutcomeCatalog");
const {createTradeupSimulationCatalog} = require("../node_sidecar/src/services/tradeupSimulationCatalog");
const {createTradeupSimulationService} = require("../node_sidecar/src/services/tradeupSimulationService");

function createTempSkinDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-sim-service-"));
  const dbPath = path.join(tempDir, "skins.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE skin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      markethashname TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      basemarkethashname TEXT NOT NULL,
      basename TEXT NOT NULL,
      collection TEXT,
      rarity TEXT,
      wearlevel TEXT NOT NULL,
      minfloat REAL,
      maxfloat REAL,
      isstattrak INTEGER DEFAULT 0,
      wear_range REAL,
      goods_icon_url TEXT DEFAULT '',
      goods_original_icon_url TEXT DEFAULT '',
      goods_share_thumbnail_url TEXT DEFAULT ''
    )
  `);
  return {dbPath, db};
}

function insertSkinRow(db, row) {
  db.prepare(`
    INSERT INTO skin (
      markethashname, name, basemarkethashname, basename, collection, rarity,
      wearlevel, minfloat, maxfloat, isstattrak, wear_range,
      goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.markethashname,
    row.name || row.markethashname,
    row.basemarkethashname,
    row.basename || row.basemarkethashname,
    row.collection || "",
    row.rarity || "",
    row.wearlevel || "",
    row.minfloat == null ? null : row.minfloat,
    row.maxfloat == null ? null : row.maxfloat,
    row.isstattrak ? 1 : 0,
    row.wear_range == null ? null : row.wear_range,
    row.goods_icon_url || "",
    row.goods_original_icon_url || "",
    row.goods_share_thumbnail_url || ""
  );
}

function insertWearFamily(db, {
  base,
  collection,
  rarity,
  minfloat = 0,
  maxfloat = 1,
  wearRange = null,
  goodsIconUrl = "",
  wearlevels = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"]
}) {
  const resolvedWearRange = wearRange == null && minfloat != null && maxfloat != null
    ? Number(maxfloat) - Number(minfloat)
    : wearRange;
  for (const wearlevel of wearlevels) {
    insertSkinRow(db, {
      markethashname: `${base} (${wearlevel})`,
      name: `${base} (${wearlevel})`,
      basemarkethashname: base,
      basename: base,
      collection,
      rarity,
      wearlevel,
      minfloat,
      maxfloat,
      wear_range: resolvedWearRange,
      goods_icon_url: goodsIconUrl
    });
  }
}

function buildSimulationFixtureDb() {
  const {dbPath, db} = createTempSkinDb();
  insertWearFamily(db, {
    base: "AK-47 | Slate",
    collection: "Snakebite Case",
    rarity: "受限",
    goodsIconUrl: "https://img.example/slate.webp"
  });
  insertWearFamily(db, {
    base: "Desert Eagle | Trigger Discipline",
    collection: "Snakebite Case",
    rarity: "受限",
    goodsIconUrl: "https://img.example/trigger.webp"
  });
  insertWearFamily(db, {
    base: "M4A4 | In Living Color",
    collection: "Snakebite Case",
    rarity: "军规级",
    goodsIconUrl: "https://img.example/living.webp"
  });
  insertWearFamily(db, {
    base: "Glock-18 | Clearpolymer",
    collection: "Snakebite Case",
    rarity: "军规级",
    goodsIconUrl: "https://img.example/clearpolymer.webp"
  });
  insertWearFamily(db, {
    base: "Negev | dev_texture",
    collection: "Snakebite Case",
    rarity: "军规级",
    minfloat: null,
    maxfloat: null,
    wearRange: null,
    goodsIconUrl: "https://img.example/dev.webp"
  });
  insertWearFamily(db, {
    base: "P2000 | Acid Etched",
    collection: "Prisma 2 Case",
    rarity: "受限",
    goodsIconUrl: "https://img.example/acid.webp"
  });
  db.close();
  return dbPath;
}

function createFixtureService() {
  const dbPath = buildSimulationFixtureDb();
  const catalog = createTradeupSimulationCatalog({dbPath});
  const outcomeCatalog = createCraftOutcomeCatalog({dbPath});
  return createTradeupSimulationService({catalog, outcomeCatalog});
}

function test_resolve_builds_collection_row_with_outputs_and_locked_materials() {
  const service = createFixtureService();

  const result = service.resolve({
    target_item: {markethashname: "AK-47 | Slate (Minimal Wear)"},
    active_driver_item: {markethashname: "Desert Eagle | Trigger Discipline (Minimal Wear)"},
    active_driver_abs_wear: 0.1417,
    anchors: []
  });

  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.driver.markethashname, "Desert Eagle | Trigger Discipline (Minimal Wear)");
  assert.equal(result.rows[0].collection, "Snakebite Case");
  assert.equal(result.rows[0].outputs.length, 2);
  assert.equal(result.rows[0].materials.length, 3);
  assert.equal(result.rows[0].outputs.every((entry) => entry.editable === true), true);
  assert.equal(result.rows[0].materials.every((entry) => entry.editable === false), true);
  assert.equal(result.rows[0].outputs.every((entry) => typeof entry.absolute_wear === "number"), true);
  assert.equal(
    result.rows[0].materials.filter((entry) => entry.missing_wear_bounds !== true).every((entry) => typeof entry.absolute_wear === "number"),
    true
  );
}

function test_resolve_rejects_out_of_range_driver_wear() {
  const service = createFixtureService();

  const result = service.resolve({
    target_item: {markethashname: "AK-47 | Slate (Minimal Wear)"},
    active_driver_item: {markethashname: "AK-47 | Slate (Minimal Wear)"},
    active_driver_abs_wear: 1.4,
    anchors: []
  });

  assert.equal(result.ok, false);
  assert.equal(result.invalid_reason, "invalid_driver_absolute_wear");
}

function test_resolve_keeps_missing_wear_bound_entries_as_degraded_cards() {
  const service = createFixtureService();

  const result = service.resolve({
    target_item: {markethashname: "AK-47 | Slate (Minimal Wear)"},
    active_driver_item: {markethashname: "AK-47 | Slate (Minimal Wear)"},
    active_driver_abs_wear: 0.12,
    anchors: []
  });

  const degraded = result.rows[0].materials.find((entry) => entry.base_name === "Negev | dev_texture");
  assert.ok(degraded, "expected degraded material card to remain in result");
  assert.equal(degraded.missing_wear_bounds, true);
  assert.equal(degraded.absolute_wear, null);
  assert.equal(Array.isArray(result.warnings), true);
}

function test_resolve_allows_cross_collection_driver_relative_wear() {
  const service = createFixtureService();

  const result = service.resolve({
    target_item: {markethashname: "AK-47 | Slate (Minimal Wear)"},
    active_driver_item: {markethashname: "P2000 | Acid Etched (Minimal Wear)"},
    active_driver_abs_wear: 0.14,
    anchors: []
  });

  assert.equal(result.ok, true);
  assert.equal(result.driver.markethashname, "P2000 | Acid Etched (Minimal Wear)");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].collection, "Snakebite Case");
  assert.equal(result.rows[0].outputs.length, 2);
  assert.equal(result.rows[0].materials.length, 3);
}

function main() {
  test_resolve_builds_collection_row_with_outputs_and_locked_materials();
  test_resolve_rejects_out_of_range_driver_wear();
  test_resolve_keeps_missing_wear_bound_entries_as_degraded_cards();
  test_resolve_allows_cross_collection_driver_relative_wear();
  console.log("tradeupSimulationService tests passed");
}

main();
