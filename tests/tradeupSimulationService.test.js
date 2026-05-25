const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {DatabaseSync} = require("node:sqlite");

const {createCraftOutcomeCatalog} = require("../node_sidecar/src/services/craftOutcomeCatalog");
const {createTradeupSimulationCatalog} = require("../node_sidecar/src/services/tradeupSimulationCatalog");
const {createTradeupSimulationService} = require("../node_sidecar/src/services/tradeupSimulationService");

function float32SequentialMean(values) {
  let sum = Math.fround(0);
  for (const value of values) {
    sum = Math.fround(sum + Math.fround(value));
  }
  return Math.fround(sum / Math.fround(values.length));
}

function float32OutcomeWear(relativeWear, minfloat, maxfloat) {
  const outMin = Math.fround(minfloat);
  const outMax = Math.fround(maxfloat);
  const range = Math.fround(outMax - outMin);
  return Math.fround(outMin + Math.fround(Math.fround(relativeWear) * range));
}

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
  displayBase = base,
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
    const marketBase = base;
    const displayMarketBase = displayBase;
    insertSkinRow(db, {
      markethashname: `${marketBase} (${wearlevel})`,
      name: `${displayMarketBase} (${wearlevel})`,
      basemarkethashname: marketBase,
      basename: displayMarketBase,
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

function buildDPrecisionFixtureDb() {
  const {dbPath, db} = createTempSkinDb();
  insertWearFamily(db, {
    base: "AUG | Steel Sentinel",
    collection: "Control Case",
    rarity: "军规级",
    minfloat: 0,
    maxfloat: 0.7
  });
  insertWearFamily(db, {
    base: "P90 | Full Sunset",
    collection: "Control Case",
    rarity: "军规级",
    minfloat: 0,
    maxfloat: 0.7
  });
  insertWearFamily(db, {
    base: "FAMAS | Half Sleeve",
    collection: "Control Case",
    rarity: "军规级",
    minfloat: 0,
    maxfloat: 0.7
  });
  insertWearFamily(db, {
    base: "Driver | Relative Carrier",
    collection: "Driver Case",
    rarity: "受限",
    minfloat: 0,
    maxfloat: 1
  });
  insertWearFamily(db, {
    base: "Glock-18 | Greenline",
    collection: "Control Case",
    rarity: "受限",
    minfloat: 0,
    maxfloat: 0.7
  });
  db.close();
  return dbPath;
}

function buildMissingTargetBoundsFixtureDb() {
  const {dbPath, db} = createTempSkinDb();
  insertWearFamily(db, {
    base: "AK-47 | Slate",
    collection: "Snakebite Case",
    rarity: "受限",
    minfloat: 0,
    maxfloat: 1
  });
  insertWearFamily(db, {
    base: "M4A4 | In Living Color",
    collection: "Snakebite Case",
    rarity: "军规级",
    minfloat: 0,
    maxfloat: 1
  });
  insertWearFamily(db, {
    base: "Target | Missing Bounds",
    collection: "Snakebite Case",
    rarity: "受限",
    minfloat: null,
    maxfloat: null,
    wearRange: null
  });
  db.close();
  return dbPath;
}

function buildSouvenirPoolFixtureDb() {
  const {dbPath, db} = createTempSkinDb();
  insertWearFamily(db, {
    base: "AWP | Acheron",
    collection: "2018 Nuke Collection",
    rarity: "军规级"
  });
  insertWearFamily(db, {
    base: "Souvenir AWP | Acheron",
    collection: "2018 Nuke Collection",
    rarity: "军规级"
  });
  insertWearFamily(db, {
    base: "M4A4 | Mainframe",
    collection: "2018 Nuke Collection",
    rarity: "受限"
  });
  insertWearFamily(db, {
    base: "Souvenir M4A4 | Mainframe",
    collection: "2018 Nuke Collection",
    rarity: "受限"
  });
  insertWearFamily(db, {
    base: "Souvenir P250 | Facility Draft",
    collection: "2018 Nuke Collection",
    rarity: "受限"
  });
  db.close();
  return dbPath;
}

function buildLocalizedSouvenirPoolFixtureDb() {
  const {dbPath, db} = createTempSkinDb();
  insertWearFamily(db, {
    base: "Souvenir AWP | Acheron",
    displayBase: "纪念品 AWP | Acheron",
    collection: "2018 Nuke Collection",
    rarity: "军规级"
  });
  insertWearFamily(db, {
    base: "Souvenir P250 | Facility Draft",
    displayBase: "纪念品 P250 | Facility Draft",
    collection: "2018 Nuke Collection",
    rarity: "受限"
  });
  db.close();
  return dbPath;
}

function buildLocalizedDisplayPoolFixtureDb() {
  const {dbPath, db} = createTempSkinDb();
  insertWearFamily(db, {
    base: "AWP | Acheron",
    displayBase: "AWP | 阿刻戎",
    collection: "2018 Nuke Collection",
    rarity: "军规级"
  });
  insertWearFamily(db, {
    base: "Glock-18 | Nuclear Garden",
    displayBase: "格洛克18型 | 核子花园",
    collection: "2018 Nuke Collection",
    rarity: "受限"
  });
  insertWearFamily(db, {
    base: "M4A4 | Mainframe",
    displayBase: "M4A4 | 主机",
    collection: "2018 Nuke Collection",
    rarity: "受限"
  });
  insertWearFamily(db, {
    base: "Souvenir M4A4 | Mainframe",
    displayBase: "M4A4（纪念品） | 主机",
    collection: "2018 Nuke Collection",
    rarity: "受限"
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

function createDPrecisionFixtureService() {
  const dbPath = buildDPrecisionFixtureDb();
  const catalog = createTradeupSimulationCatalog({dbPath});
  const outcomeCatalog = createCraftOutcomeCatalog({dbPath});
  return createTradeupSimulationService({catalog, outcomeCatalog});
}

function createMissingTargetBoundsFixtureService() {
  const dbPath = buildMissingTargetBoundsFixtureDb();
  const catalog = createTradeupSimulationCatalog({dbPath});
  const outcomeCatalog = createCraftOutcomeCatalog({dbPath});
  return createTradeupSimulationService({catalog, outcomeCatalog});
}

function createSouvenirPoolFixtureService() {
  const dbPath = buildSouvenirPoolFixtureDb();
  const catalog = createTradeupSimulationCatalog({dbPath});
  const outcomeCatalog = createCraftOutcomeCatalog({dbPath});
  return createTradeupSimulationService({catalog, outcomeCatalog});
}

function createLocalizedSouvenirPoolFixtureService() {
  const dbPath = buildLocalizedSouvenirPoolFixtureDb();
  const catalog = createTradeupSimulationCatalog({dbPath});
  const outcomeCatalog = createCraftOutcomeCatalog({dbPath});
  return createTradeupSimulationService({catalog, outcomeCatalog});
}

function createLocalizedDisplayPoolFixtureService() {
  const dbPath = buildLocalizedDisplayPoolFixtureDb();
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

function test_resolve_uses_float32_output_wear_chain_for_real_block_21_sample() {
  const service = createDPrecisionFixtureService();

  const block21Materials = [
    0.2758138477802276,
    0.2811573147773742,
    0.2813495993614197,
    0.2814185917377472,
    0.2814828157424927,
    0.2815606594085693,
    0.2816655933856964,
    0.2820283174514770,
    0.2820589840412140,
    0.1713817417621612
  ];
  const relativeWearD = float32SequentialMean(block21Materials);
  const driverWear = relativeWearD;
  const expectedD = Number(float32OutcomeWear(relativeWearD, 0, 0.7).toFixed(12));
  const oldC = Number((relativeWearD * 0.7).toFixed(12));
  assert.equal(expectedD, 0.188994199038);
  assert.equal(oldC, 0.188994207978);

  const result = service.resolve({
    target_item: {markethashname: "Glock-18 | Greenline (Minimal Wear)"},
    active_driver_item: {markethashname: "Driver | Relative Carrier (Field-Tested)"},
    active_driver_abs_wear: driverWear,
    anchors: []
  });

  assert.equal(result.ok, true);
  assert.equal(typeof result.rows[0].sharedRelativeWear, "number");

  // Old chain would shift the derived absolute wear by ~1 ULP here; we want the float32 chain value exactly.
  assert.equal(result.target.absolute_wear, expectedD);
  assert.notEqual(result.target.absolute_wear, oldC);
}

function test_resolve_keeps_non_driver_target_wear_label_empty_when_bounds_missing() {
  const service = createMissingTargetBoundsFixtureService();

  const result = service.resolve({
    target_item: {markethashname: "Target | Missing Bounds (Factory New)"},
    active_driver_item: {markethashname: "AK-47 | Slate (Minimal Wear)"},
    active_driver_abs_wear: 0.12,
    anchors: []
  });

  assert.equal(result.ok, true);
  assert.notEqual(result.target.markethashname, result.driver.markethashname);
  assert.equal(result.target.absolute_wear, null);
  assert.equal(result.target.wear_label, "");
}

function test_resolve_excludes_souvenir_outputs_but_keeps_souvenir_materials() {
  const service = createSouvenirPoolFixtureService();

  const result = service.resolve({
    target_item: {markethashname: "M4A4 | Mainframe (Minimal Wear)"},
    active_driver_item: {markethashname: "M4A4 | Mainframe (Minimal Wear)"},
    active_driver_abs_wear: 0.12,
    anchors: []
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.rows[0].outputs.map((entry) => entry.base_name),
    ["M4A4 | Mainframe"]
  );
  const souvenirOnlyOutput = result.rows[0].outputs.find((entry) => entry.base_name === "P250 | Facility Draft");
  assert.equal(souvenirOnlyOutput, undefined);
  assert.equal(result.rows[0].outputs.some((entry) => /^Souvenir\s+/i.test(entry.base_name)), false);
  assert.deepEqual(
    result.rows[0].materials.map((entry) => entry.base_name).sort(),
    ["AWP | Acheron", "Souvenir AWP | Acheron"].sort()
  );
}

function test_resolve_canonicalizes_souvenir_target_and_driver_as_normal_outputs() {
  const service = createSouvenirPoolFixtureService();

  const result = service.resolve({
    target_item: {markethashname: "Souvenir M4A4 | Mainframe (Minimal Wear)"},
    active_driver_item: {markethashname: "Souvenir M4A4 | Mainframe (Minimal Wear)"},
    active_driver_abs_wear: 0.12,
    anchors: []
  });

  assert.equal(result.ok, true);
  assert.equal(result.target.markethashname, "M4A4 | Mainframe (Minimal Wear)");
  assert.equal(result.target.name, "M4A4 | Mainframe (Minimal Wear)");
  assert.equal(result.target.basemarkethashname, "M4A4 | Mainframe");
  assert.equal(result.target.basename, "M4A4 | Mainframe");
  assert.equal(result.driver.markethashname, "M4A4 | Mainframe (Minimal Wear)");
  assert.equal(result.driver.name, "M4A4 | Mainframe (Minimal Wear)");
  assert.equal(result.driver.basemarkethashname, "M4A4 | Mainframe");
  assert.equal(result.driver.basename, "M4A4 | Mainframe");
  assert.equal(JSON.stringify(result.target).includes("Souvenir"), false);
  assert.equal(JSON.stringify(result.driver).includes("Souvenir"), false);
  assert.deepEqual(
    result.rows[0].outputs.map((entry) => entry.base_name),
    ["M4A4 | Mainframe"]
  );
  assert.deepEqual(
    result.rows[0].materials.map((entry) => entry.base_name).sort(),
    ["AWP | Acheron", "Souvenir AWP | Acheron"].sort()
  );
}

function test_resolve_rejects_souvenir_target_when_normal_row_is_missing() {
  const service = createSouvenirPoolFixtureService();

  const result = service.resolve({
    target_item: {markethashname: "Souvenir P250 | Facility Draft (Minimal Wear)"},
    active_driver_abs_wear: 0.12,
    anchors: []
  });

  assert.equal(result.ok, false);
  assert.equal(result.invalid_reason, "target_item_not_found");
}

function test_resolve_rejects_localized_souvenir_target_when_normal_row_is_missing() {
  const service = createLocalizedSouvenirPoolFixtureService();

  const result = service.resolve({
    target_item: {markethashname: "Souvenir P250 | Facility Draft (Minimal Wear)"},
    active_driver_abs_wear: 0.12,
    anchors: []
  });

  assert.equal(result.ok, false);
  assert.equal(result.invalid_reason, "target_item_not_found");
}

function test_resolve_rejects_souvenir_driver_when_normal_row_is_missing() {
  const service = createSouvenirPoolFixtureService();

  const result = service.resolve({
    target_item: {markethashname: "M4A4 | Mainframe (Minimal Wear)"},
    active_driver_item: {markethashname: "Souvenir P250 | Facility Draft (Minimal Wear)"},
    active_driver_abs_wear: 0.12,
    anchors: []
  });

  assert.equal(result.ok, false);
  assert.equal(result.invalid_reason, "driver_item_not_found");
}

function test_resolve_preserves_localized_display_for_normal_top_level_and_outputs() {
  const service = createLocalizedDisplayPoolFixtureService();

  const result = service.resolve({
    target_item: {markethashname: "Glock-18 | Nuclear Garden (Minimal Wear)"},
    active_driver_item: {markethashname: "Glock-18 | Nuclear Garden (Minimal Wear)"},
    active_driver_abs_wear: 0.12,
    anchors: []
  });

  assert.equal(result.ok, true);
  assert.equal(result.target.markethashname, "Glock-18 | Nuclear Garden (Minimal Wear)");
  assert.equal(result.target.name, "格洛克18型 | 核子花园 (Minimal Wear)");
  assert.equal(result.target.basename, "格洛克18型 | 核子花园");
  assert.equal(result.driver.name, "格洛克18型 | 核子花园 (Minimal Wear)");
  const localizedOutput = result.rows[0].outputs.find(
    (entry) => entry.markethashname === "Glock-18 | Nuclear Garden (Minimal Wear)"
  );
  assert.ok(localizedOutput);
  assert.equal(localizedOutput.base_name, "格洛克18型 | 核子花园");
  assert.equal(localizedOutput.name, "格洛克18型 | 核子花园 (Minimal Wear)");
}

function test_resolve_strips_parenthesized_souvenir_marker_without_losing_localized_display() {
  const service = createLocalizedDisplayPoolFixtureService();

  const result = service.resolve({
    target_item: {markethashname: "Souvenir M4A4 | Mainframe (Minimal Wear)"},
    active_driver_item: {markethashname: "Souvenir M4A4 | Mainframe (Minimal Wear)"},
    active_driver_abs_wear: 0.12,
    anchors: []
  });

  assert.equal(result.ok, true);
  assert.equal(result.target.markethashname, "M4A4 | Mainframe (Minimal Wear)");
  assert.equal(result.target.name, "M4A4 | 主机 (Minimal Wear)");
  assert.equal(result.target.basename, "M4A4 | 主机");
  assert.equal(result.driver.name, "M4A4 | 主机 (Minimal Wear)");
  const localizedOutput = result.rows[0].outputs.find(
    (entry) => entry.markethashname === "M4A4 | Mainframe (Minimal Wear)"
  );
  assert.ok(localizedOutput);
  assert.equal(localizedOutput.base_name, "M4A4 | 主机");
  assert.equal(localizedOutput.name, "M4A4 | 主机 (Minimal Wear)");
  assert.equal(/Souvenir|纪念品/.test(JSON.stringify(result.target)), false);
  assert.equal(/Souvenir|纪念品/.test(JSON.stringify(result.driver)), false);
  assert.equal(/Souvenir|纪念品/.test(JSON.stringify(result.rows[0].outputs)), false);
}

function main() {
  test_resolve_builds_collection_row_with_outputs_and_locked_materials();
  test_resolve_rejects_out_of_range_driver_wear();
  test_resolve_keeps_missing_wear_bound_entries_as_degraded_cards();
  test_resolve_allows_cross_collection_driver_relative_wear();
  test_resolve_uses_float32_output_wear_chain_for_real_block_21_sample();
  test_resolve_keeps_non_driver_target_wear_label_empty_when_bounds_missing();
  test_resolve_excludes_souvenir_outputs_but_keeps_souvenir_materials();
  test_resolve_canonicalizes_souvenir_target_and_driver_as_normal_outputs();
  test_resolve_rejects_souvenir_target_when_normal_row_is_missing();
  test_resolve_rejects_localized_souvenir_target_when_normal_row_is_missing();
  test_resolve_rejects_souvenir_driver_when_normal_row_is_missing();
  test_resolve_preserves_localized_display_for_normal_top_level_and_outputs();
  test_resolve_strips_parenthesized_souvenir_marker_without_losing_localized_display();
  console.log("tradeupSimulationService tests passed");
}

main();
