const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {DatabaseSync} = require("node:sqlite");

const {parseInventory} = require("../node_sidecar/src/inventoryParser");
const {createSnapshotRowsLoader} = require("../node_sidecar/src/services/snapshotRowsLoader");

function createTempSkinDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-inventory-meta-"));
  const dbPath = path.join(tempDir, "skins.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE skin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      markethashname TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      collection TEXT,
      rarity TEXT,
      minfloat REAL,
      maxfloat REAL,
      isstattrak INTEGER DEFAULT 0,
      wear_range REAL,
      inventory_display_only INTEGER DEFAULT 0,
      goods_icon_url TEXT DEFAULT '',
      goods_original_icon_url TEXT DEFAULT '',
      goods_share_thumbnail_url TEXT DEFAULT ''
    )
  `);
  return {tempDir, dbPath, db};
}

function writeFloatBytes(value) {
  const buf = Buffer.alloc(4);
  buf.writeFloatLE(Number(value) || 0, 0);
  return buf;
}

function buildInventoryItem() {
  return {
    id: "1001",
    def_index: 7,
    quality: 3,
    rarity: 4,
    inventory: 1,
    attribute: [
      {def_index: 6, value: 282},
      {def_index: 8, value_bytes: writeFloatBytes(0.2)}
    ]
  };
}

function buildSchema() {
  return {
    weapons: {
      "7": "AK-47"
    },
    paints: {
      "282": "Redline"
    },
    item_defs: {}
  };
}

function seedSkinRow(db, {displayOnly = false} = {}) {
  db.prepare(`
    INSERT INTO skin (
      markethashname, name, collection, rarity, minfloat, maxfloat, isstattrak, wear_range,
      inventory_display_only, goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "AK-47 | Redline (Field-Tested)",
    "AK-47 | 红线",
    "Phoenix Collection",
    "受限",
    0.1,
    0.7,
    0,
    0.6,
    displayOnly ? 1 : 0,
    "https://img.example/ak-icon.webp",
    "https://img.example/ak-original.webp",
    "https://img.example/ak-share.webp"
  );
}

function test_parseInventory_enriches_image_fields_from_db() {
  const {dbPath, db} = createTempSkinDb();
  seedSkinRow(db);
  db.close();

  const parsed = parseInventory([buildInventoryItem()], buildSchema(), {dbPath});
  const row = parsed.rows[0];

  assert.equal(row.market_hash_name, "AK-47 | Redline (Field-Tested)");
  assert.equal(row.alchemy_name, "AK-47 | 红线");
  assert.equal(row.collection, "Phoenix Collection");
  assert.equal(row.alchemy_rarity, "受限");
  assert.equal(row.goods_icon_url, "https://img.example/ak-icon.webp");
  assert.equal(row.goods_original_icon_url, "https://img.example/ak-original.webp");
  assert.equal(row.goods_share_thumbnail_url, "https://img.example/ak-share.webp");
}

function test_parseInventory_marks_inventory_display_only_rows_as_not_craftable() {
  const {dbPath, db} = createTempSkinDb();
  seedSkinRow(db, {displayOnly: true});
  db.close();

  const parsed = parseInventory([buildInventoryItem()], buildSchema(), {dbPath});
  const row = parsed.rows[0];

  assert.equal(row.market_hash_name, "AK-47 | Redline (Field-Tested)");
  assert.equal(row.is_craftable, false);
  assert.equal(row.craftable_reason, "inventory_display_only");
}

function test_snapshotRowsLoader_backfills_missing_image_fields_from_db() {
  const {tempDir, dbPath, db} = createTempSkinDb();
  seedSkinRow(db);
  db.close();

  const snapshotPath = path.join(tempDir, "inventory_processed_test.json");
  fs.writeFileSync(snapshotPath, JSON.stringify({
    format: "processed_inventory_v1",
    fetched_at: "2026-03-22 12:00:00",
    items: [
      {
        asset_id: 1001,
        market_hash_name: "AK-47 | Redline (Field-Tested)",
        name: "AK-47 | Redline (Field-Tested)",
        minfloat: null,
        maxfloat: null,
        wear_range: null,
        goods_icon_url: "",
        goods_original_icon_url: "",
        goods_share_thumbnail_url: ""
      }
    ]
  }, null, 2), "utf8");

  const loader = createSnapshotRowsLoader({limit: 2});
  const rows = loader.loadSnapshotRows(snapshotPath, {dbPath});
  const row = rows[0];

  assert.equal(row.minfloat, 0.1);
  assert.equal(row.maxfloat, 0.7);
  assert.equal(row.wear_range, 0.6);
  assert.equal(row.goods_icon_url, "https://img.example/ak-icon.webp");
  assert.equal(row.goods_original_icon_url, "https://img.example/ak-original.webp");
  assert.equal(row.goods_share_thumbnail_url, "https://img.example/ak-share.webp");
}

function test_snapshotRowsLoader_invalidates_cache_when_db_changes() {
  const {tempDir, dbPath, db} = createTempSkinDb();
  db.close();

  const snapshotPath = path.join(tempDir, "inventory_processed_cache_test.json");
  fs.writeFileSync(snapshotPath, JSON.stringify({
    format: "processed_inventory_v1",
    fetched_at: "2026-04-07 13:40:00",
    items: [
      {
        asset_id: 2001,
        market_hash_name: "Sticker | Miami Stabbyfish",
        name: "Sticker | Miami Stabbyfish",
        alchemy_name: "",
        collection: "",
        alchemy_rarity: "",
        minfloat: null,
        maxfloat: null,
        wear_range: null,
        goods_icon_url: "",
        goods_original_icon_url: "",
        goods_share_thumbnail_url: ""
      }
    ]
  }, null, 2), "utf8");

  const loader = createSnapshotRowsLoader({limit: 2});
  const initialRows = loader.loadSnapshotRows(snapshotPath, {dbPath});
  assert.equal(initialRows[0].alchemy_name, "");
  assert.equal(initialRows[0].goods_icon_url, "");

  const verifyDb = new DatabaseSync(dbPath);
  verifyDb.prepare(`
    INSERT INTO skin (
      markethashname, name, collection, rarity, minfloat, maxfloat, isstattrak, wear_range,
      inventory_display_only, goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "Sticker | Miami Stabbyfish",
    "印花 | 斯塔比鱼（迈阿密）",
    "",
    "",
    null,
    null,
    0,
    null,
    1,
    "https://img.example/stabbyfish/icon.webp",
    "https://img.example/stabbyfish/original.webp",
    "https://img.example/stabbyfish/share.webp"
  );
  verifyDb.close();

  const updatedRows = loader.loadSnapshotRows(snapshotPath, {dbPath});
  assert.equal(updatedRows[0].alchemy_name, "印花 | 斯塔比鱼（迈阿密）");
  assert.equal(updatedRows[0].goods_icon_url, "https://img.example/stabbyfish/icon.webp");
  assert.equal(updatedRows[0].goods_original_icon_url, "https://img.example/stabbyfish/original.webp");
  assert.equal(updatedRows[0].goods_share_thumbnail_url, "https://img.example/stabbyfish/share.webp");
}

test_parseInventory_enriches_image_fields_from_db();
test_parseInventory_marks_inventory_display_only_rows_as_not_craftable();
test_snapshotRowsLoader_backfills_missing_image_fields_from_db();
test_snapshotRowsLoader_invalidates_cache_when_db_changes();

console.log("inventorySkinMetadataImages tests passed");
