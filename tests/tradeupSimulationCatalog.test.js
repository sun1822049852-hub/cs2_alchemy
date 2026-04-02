const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {DatabaseSync} = require("node:sqlite");

const {createTradeupSimulationCatalog} = require("../node_sidecar/src/services/tradeupSimulationCatalog");

function createTempSkinDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-sim-catalog-"));
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

function buildCatalogFixtureDb() {
  const {dbPath, db} = createTempSkinDb();
  insertSkinRow(db, {
    markethashname: "AK-47 | Slate (Battle-Scarred)",
    basemarkethashname: "AK-47 | Slate",
    basename: "AK-47 | Slate",
    collection: "蛇噬武器箱",
    rarity: "受限",
    wearlevel: "Battle-Scarred",
    minfloat: 0,
    maxfloat: 1,
    wear_range: 1
  });
  insertSkinRow(db, {
    markethashname: "AK-47 | Slate (Factory New)",
    basemarkethashname: "AK-47 | Slate",
    basename: "AK-47 | Slate",
    collection: "蛇噬武器箱",
    rarity: "受限",
    wearlevel: "Factory New",
    minfloat: 0,
    maxfloat: 1,
    wear_range: 1
  });
  insertSkinRow(db, {
    markethashname: "AK-47 | Slate (Minimal Wear)",
    basemarkethashname: "AK-47 | Slate",
    basename: "AK-47 | Slate",
    collection: "蛇噬武器箱",
    rarity: "受限",
    wearlevel: "Minimal Wear",
    minfloat: 0,
    maxfloat: 1,
    wear_range: 1,
    goods_icon_url: "https://img.example/slate.webp"
  });
  insertSkinRow(db, {
    markethashname: "StatTrak™ AK-47 | Slate (Factory New)",
    basemarkethashname: "StatTrak™ AK-47 | Slate",
    basename: "StatTrak™ AK-47 | Slate",
    collection: "蛇噬武器箱",
    rarity: "受限",
    wearlevel: "Factory New",
    minfloat: 0,
    maxfloat: 1,
    wear_range: 1,
    isstattrak: 1,
    goods_icon_url: "https://img.example/stattrak-slate.webp"
  });
  insertSkinRow(db, {
    markethashname: "USP-S | The Traitor (Minimal Wear)",
    basemarkethashname: "USP-S | The Traitor",
    basename: "USP-S | The Traitor",
    collection: "Snakebite Case",
    rarity: "保密",
    wearlevel: "Minimal Wear",
    minfloat: 0,
    maxfloat: 1,
    wear_range: 1,
    goods_icon_url: "https://img.example/traitor.webp"
  });
  db.close();
  return dbPath;
}

function buildPagedCatalogFixtureDb() {
  const {dbPath, db} = createTempSkinDb();
  for (let groupIndex = 0; groupIndex < 10; groupIndex += 1) {
    const baseKey = `Needle Duplicate ${String(groupIndex).padStart(2, "0")}`;
    for (let variantIndex = 0; variantIndex < 40; variantIndex += 1) {
      insertSkinRow(db, {
        markethashname: `${baseKey} Variant ${String(variantIndex).padStart(3, "0")}`,
        name: `${baseKey} Variant ${String(variantIndex).padStart(3, "0")}`,
        basemarkethashname: baseKey,
        basename: baseKey,
        collection: "Paged Search Case",
        rarity: "受限",
        wearlevel: "Minimal Wear",
        minfloat: 0,
        maxfloat: 1,
        wear_range: 1,
        goods_icon_url: `https://img.example/duplicate-${groupIndex}-${variantIndex}.webp`
      });
    }
  }
  for (let uniqueIndex = 0; uniqueIndex < 20; uniqueIndex += 1) {
    const baseKey = `Needle Unique ${String(uniqueIndex).padStart(2, "0")}`;
    insertSkinRow(db, {
      markethashname: baseKey,
      name: baseKey,
      basemarkethashname: baseKey,
      basename: baseKey,
      collection: "Paged Search Case",
      rarity: "军规级",
      wearlevel: "Factory New",
      minfloat: 0,
      maxfloat: 0.7,
      wear_range: 0.7,
      goods_icon_url: `https://img.example/unique-${uniqueIndex}.webp`
    });
  }
  db.close();
  return dbPath;
}

function test_search_items_returns_normalized_picker_rows() {
  const dbPath = buildCatalogFixtureDb();
  const catalog = createTradeupSimulationCatalog({dbPath});

  const results = catalog.searchItems("AK-47 | Slate", {limit: 1});

  assert.equal(Array.isArray(results), true);
  assert.equal(results.length, 1);
  assert.equal(results[0].markethashname, "AK-47 | Slate (Minimal Wear)");
  assert.equal(results[0].basemarkethashname, "AK-47 | Slate");
  assert.equal(results[0].collection, "Snakebite Case");
  assert.equal(results[0].rarity, "受限");
  assert.equal(results[0].minfloat, 0);
  assert.equal(results[0].maxfloat, 1);
  assert.equal(results[0].goods_icon_url, "https://img.example/slate.webp");
}

function test_search_items_matches_collection_alias_queries() {
  const dbPath = buildCatalogFixtureDb();
  const catalog = createTradeupSimulationCatalog({dbPath});

  const results = catalog.searchItems("蛇噬武器箱");

  assert.equal(results.length >= 1, true);
  assert.equal(results.every((entry) => entry.collection === "Snakebite Case"), true);
}

function test_get_item_by_market_hash_name_returns_concrete_item_details() {
  const dbPath = buildCatalogFixtureDb();
  const catalog = createTradeupSimulationCatalog({dbPath});

  const item = catalog.getItemByMarketHashName("AK-47 | Slate (Minimal Wear)");

  assert.equal(item.markethashname, "AK-47 | Slate (Minimal Wear)");
  assert.equal(item.basemarkethashname, "AK-47 | Slate");
  assert.equal(item.collection, "Snakebite Case");
  assert.equal(item.rarity, "受限");
  assert.equal(item.wearlevel, "Minimal Wear");
}

function test_search_items_keeps_fetching_until_limit_unique_items_are_collected() {
  const dbPath = buildPagedCatalogFixtureDb();
  const catalog = createTradeupSimulationCatalog({dbPath});

  const results = catalog.searchItems("Needle", {limit: 20});

  assert.equal(results.length, 20);
  assert.equal(results.some((entry) => entry.markethashname === "Needle Unique 09"), true);
}

function test_search_items_matches_stattrak_queries_without_tm_symbol() {
  const dbPath = buildCatalogFixtureDb();
  const catalog = createTradeupSimulationCatalog({dbPath});

  const results = catalog.searchItems("StatTrak AK-47");

  assert.equal(results.length >= 1, true);
  assert.equal(results.some((entry) => entry.markethashname === "StatTrak™ AK-47 | Slate (Factory New)"), true);
  assert.equal(results.some((entry) => Number(entry.isstattrak) === 1), true);
}

function test_search_items_returns_empty_when_query_normalizes_to_empty_text() {
  const dbPath = buildCatalogFixtureDb();
  const catalog = createTradeupSimulationCatalog({dbPath});

  const results = catalog.searchItems("™");

  assert.equal(Array.isArray(results), true);
  assert.equal(results.length, 0);
}

function main() {
  test_search_items_returns_normalized_picker_rows();
  test_search_items_matches_collection_alias_queries();
  test_get_item_by_market_hash_name_returns_concrete_item_details();
  test_search_items_keeps_fetching_until_limit_unique_items_are_collected();
  test_search_items_matches_stattrak_queries_without_tm_symbol();
  test_search_items_returns_empty_when_query_normalizes_to_empty_text();
  console.log("tradeupSimulationCatalog tests passed");
}

main();
