const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {DatabaseSync} = require("node:sqlite");

const {
  normalizeCollectionKey,
  normalizeRarityRank,
  rarityLabelFromRank
} = require("../node_sidecar/src/services/skinAlchemyRules");
const {createCraftOutcomeCatalog} = require("../node_sidecar/src/services/craftOutcomeCatalog");
const {createCraftOutcomePredictor} = require("../node_sidecar/src/services/craftOutcomePredictor");
const {prevFloat32} = require("../node_sidecar/src/services/craftAssistFloat32Step");

function test_shared_collection_and_rarity_helpers() {
  assert.equal(normalizeCollectionKey("裂空武器箱"), "Fracture Case");
  assert.equal(normalizeRarityRank("军规级"), 3);
  assert.equal(normalizeRarityRank("蓝"), 3);
  assert.equal(rarityLabelFromRank(4), "受限");
}

function createTempPredictorDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-craft-outcome-"));
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
      inventory_display_only INTEGER DEFAULT 0,
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
      wearlevel, minfloat, maxfloat, isstattrak, wear_range, inventory_display_only,
      goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.markethashname,
    row.name || row.markethashname,
    row.basemarkethashname,
    row.basename || row.basemarkethashname,
    row.collection || "",
    row.rarity || "",
    row.wearlevel,
    row.minfloat == null ? null : row.minfloat,
    row.maxfloat == null ? null : row.maxfloat,
    row.isstattrak ? 1 : 0,
    row.wear_range == null ? null : row.wear_range,
    row.inventory_display_only ? 1 : 0,
    row.goods_icon_url || "",
    row.goods_original_icon_url || "",
    row.goods_share_thumbnail_url || ""
  );
}

function buildCatalogFixtureDb() {
  const {dbPath, db} = createTempPredictorDb();
  insertSkinRow(db, {
    markethashname: "AK-47 | Ice Coaled (Factory New)",
    basemarkethashname: "AK-47 | Ice Coaled",
    collection: "Fracture Case",
    rarity: "受限",
    wearlevel: "Factory New",
    minfloat: 0,
    maxfloat: 1,
    wear_range: 1
  });
  insertSkinRow(db, {
    markethashname: "AK-47 | Ice Coaled (Minimal Wear)",
    basemarkethashname: "AK-47 | Ice Coaled",
    collection: "裂空武器箱",
    rarity: "受限",
    wearlevel: "Minimal Wear",
    minfloat: 0,
    maxfloat: 1,
    wear_range: 1
  });
  db.close();
  return dbPath;
}

function insertWearFamily(db, {
  base,
  collection,
  rarity,
  isstattrak = false,
  minfloat = 0,
  maxfloat = 1,
  wearRange = null,
  goodsIconUrl = "",
  goodsOriginalIconUrl = "",
  goodsShareThumbnailUrl = "",
  wearlevels = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"]
}) {
  const computedWearRange = wearRange == null && minfloat != null && maxfloat != null
    ? Number(maxfloat) - Number(minfloat)
    : wearRange;
  for (const wearlevel of wearlevels) {
    insertSkinRow(db, {
      markethashname: `${isstattrak ? "StatTrak™ " : ""}${base} (${wearlevel})`,
      name: `${isstattrak ? "StatTrak™ " : ""}${base} (${wearlevel})`,
      basemarkethashname: `${isstattrak ? "StatTrak™ " : ""}${base}`,
      basename: `${isstattrak ? "StatTrak™ " : ""}${base}`,
      collection,
      rarity,
      wearlevel,
      minfloat,
      maxfloat,
      isstattrak,
      wear_range: computedWearRange,
      goods_icon_url: goodsIconUrl,
      goods_original_icon_url: goodsOriginalIconUrl,
      goods_share_thumbnail_url: goodsShareThumbnailUrl
    });
  }
}

function buildPredictorFixtureDb() {
  const {dbPath, db} = createTempPredictorDb();
  insertWearFamily(db, {
    base: "AK-47 | Ice Coaled",
    collection: "Fracture Case",
    rarity: "受限",
    goodsIconUrl: "https://img.example/ice-coaled/icon.webp",
    goodsOriginalIconUrl: "https://img.example/ice-coaled/original.webp",
    goodsShareThumbnailUrl: "https://img.example/ice-coaled/share.webp"
  });
  insertWearFamily(db, {
    base: "M4A4 | Tooth Fairy",
    collection: "裂空武器箱",
    rarity: "受限"
  });
  insertWearFamily(db, {
    base: "USP-S | Cortex",
    collection: "“头号特训”武器箱",
    rarity: "受限",
    minfloat: 0.1,
    maxfloat: 0.7
  });
  insertWearFamily(db, {
    base: "AK-47 | Ice Coaled",
    collection: "Fracture Case",
    rarity: "受限",
    isstattrak: true
  });
  insertSkinRow(db, {
    markethashname: "MAC-10 | No Bounds (Field-Tested)",
    basemarkethashname: "MAC-10 | No Bounds",
    basename: "MAC-10 | No Bounds",
    collection: "Fracture Case",
    rarity: "受限",
    wearlevel: "Field-Tested",
    minfloat: null,
    maxfloat: null,
    isstattrak: 0,
    wear_range: null
  });
  insertWearFamily(db, {
    base: "Glock-18 | Missing Tier",
    collection: "Revolution Case",
    rarity: "受限",
    wearlevels: ["Minimal Wear"]
  });
  db.close();
  return dbPath;
}

function test_outcome_catalog_scaffold_reads_base_buckets_and_wear_map() {
  const dbPath = buildCatalogFixtureDb();
  const catalog = createCraftOutcomeCatalog({dbPath});
  const snapshot = catalog.getSnapshot();
  assert.equal(snapshot.baseBuckets.has("Fracture Case|4|0"), true);
  assert.equal(snapshot.wearMap.get("AK-47 | Ice Coaled").has("Minimal Wear"), true);
}

function test_predictor_invalidates_top_rarity_and_missing_collections() {
  const dbPath = buildPredictorFixtureDb();
  const predictor = createCraftOutcomePredictor({
    catalog: createCraftOutcomeCatalog({dbPath})
  });
  const topRarity = predictor.predict({
    required_count: 10,
    target_relative_wear: 0.2,
    input_rarity: "金",
    stattrak: false,
    groups: [{collection: "Fracture Case", count: 3}]
  });
  assert.equal(topRarity.ok, false);
  assert.equal(topRarity.invalid_reason, "no_higher_rarity_outcomes");

  const missingCollection = predictor.predict({
    required_count: 10,
    target_relative_wear: 0.2,
    input_rarity: "军规级",
    stattrak: false,
    groups: [{collection: "Missing Case", count: 3}]
  });
  assert.equal(missingCollection.ok, false);
  assert.equal(missingCollection.invalid_reason, "collection_outcomes_missing");
}

function test_predictor_returns_realtime_probabilities_for_partial_recipe() {
  const dbPath = buildPredictorFixtureDb();
  const predictor = createCraftOutcomePredictor({
    catalog: createCraftOutcomeCatalog({dbPath})
  });
  const result = predictor.predict({
    required_count: 10,
    target_relative_wear: 0.5,
    input_rarity: "军规级",
    stattrak: false,
    groups: [
      {collection: "Fracture Case", count: 3},
      {collection: "Clutch Case", count: 2}
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.current_count, 5);
  assert.equal(result.output_rarity, "受限");
  assert.equal(result.summary.probability_total, 0.5);
  assert.equal(result.summary.probability_missing, 0.5);
  const fractureOutcome = result.outcomes.find((item) => item.base_name === "AK-47 | Ice Coaled");
  const clutchOutcome = result.outcomes.find((item) => item.base_name === "USP-S | Cortex");
  assert.equal(fractureOutcome.probability, 0.1);
  assert.equal(fractureOutcome.goods_original_icon_url, "https://img.example/ice-coaled/original.webp");
  assert.equal(fractureOutcome.goods_share_thumbnail_url, "https://img.example/ice-coaled/share.webp");
  assert.equal(clutchOutcome.probability, 0.2);
}

function test_predictor_isolates_stattrak_pools_and_maps_wear() {
  const dbPath = buildPredictorFixtureDb();
  const predictor = createCraftOutcomePredictor({
    catalog: createCraftOutcomeCatalog({dbPath})
  });
  const result = predictor.predict({
    required_count: 10,
    target_relative_wear: 0.07,
    wear_approach_mode: "infinite",
    input_rarity: "军规级",
    stattrak: true,
    groups: [{collection: "裂空武器箱", count: 3}]
  });
  assert.equal(result.ok, true);
  assert.equal(result.outcomes.length, 1);
  assert.equal(result.outcomes[0].name, "StatTrak™ AK-47 | Ice Coaled (Minimal Wear)");
  assert.equal(result.outcomes[0].predicted_wearlevel, "Minimal Wear");
  assert.equal(result.outcomes[0].predicted_float, 0.070000000298);
}

function test_predictor_uses_infinite_mode_input_float32_step_for_output_float() {
  const dbPath = buildPredictorFixtureDb();
  const predictor = createCraftOutcomePredictor({
    catalog: createCraftOutcomeCatalog({dbPath})
  });
  const rawRelativeWear = 0.069999999;
  assert.notEqual(Math.fround(rawRelativeWear), rawRelativeWear);

  const result = predictor.predict({
    required_count: 10,
    target_relative_wear: rawRelativeWear,
    wear_approach_mode: "infinite",
    input_rarity: "军规级",
    stattrak: true,
    groups: [{collection: "裂空武器箱", count: 3}]
  });

  assert.equal(result.ok, true);
  assert.equal(result.target_relative_wear, 0.069999999);
  assert.equal(result.outcomes[0].predicted_float, 0.070000000298);
  assert.equal(result.outcomes[0].predicted_wearlevel, "Minimal Wear");
  assert.equal(result.outcomes[0].name, "StatTrak™ AK-47 | Ice Coaled (Minimal Wear)");
}

function test_predictor_defaults_to_below_previous_float32_step_for_output_float() {
  const dbPath = buildPredictorFixtureDb();
  const predictor = createCraftOutcomePredictor({
    catalog: createCraftOutcomeCatalog({dbPath})
  });
  const rawRelativeWear = 0.069999999;
  const inputStep = Math.fround(rawRelativeWear);
  const expectedBelowStep = Number(prevFloat32(inputStep).toFixed(12));
  assert.equal(expectedBelowStep, 0.069999992847);

  const result = predictor.predict({
    required_count: 10,
    target_relative_wear: rawRelativeWear,
    input_rarity: "军规级",
    stattrak: true,
    groups: [{collection: "裂空武器箱", count: 3}]
  });

  assert.equal(result.ok, true);
  assert.equal(result.target_relative_wear, 0.069999999);
  assert.equal(result.outcomes[0].predicted_float, expectedBelowStep);
  assert.equal(result.outcomes[0].predicted_wearlevel, "Factory New");
  assert.equal(result.outcomes[0].name, "StatTrak™ AK-47 | Ice Coaled (Factory New)");
}

function test_predictor_below_uses_raw_decimal_step_when_raw_sits_above_float32_step() {
  const dbPath = buildPredictorFixtureDb();
  const predictor = createCraftOutcomePredictor({
    catalog: createCraftOutcomeCatalog({dbPath})
  });
  const rawRelativeWear = 0.21;
  const expectedStep = Number(Math.fround(rawRelativeWear).toFixed(12));
  const expectedBelowStep = Number(prevFloat32(Math.fround(rawRelativeWear)).toFixed(12));
  assert.equal(expectedStep, 0.209999993443);
  assert.equal(expectedBelowStep, 0.209999978542);

  const result = predictor.predict({
    required_count: 10,
    target_relative_wear: rawRelativeWear,
    input_rarity: "军规级",
    stattrak: true,
    groups: [{collection: "裂空武器箱", count: 3}]
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcomes[0].predicted_float, expectedStep);
  assert.notEqual(result.outcomes[0].predicted_float, expectedBelowStep);
}

function test_predictor_below_rejects_unreachable_zero_raw() {
  const dbPath = buildPredictorFixtureDb();
  const predictor = createCraftOutcomePredictor({
    catalog: createCraftOutcomeCatalog({dbPath})
  });

  const result = predictor.predict({
    required_count: 10,
    target_relative_wear: 0,
    input_rarity: "军规级",
    stattrak: true,
    groups: [{collection: "裂空武器箱", count: 3}]
  });

  assert.equal(result.ok, false);
  assert.equal(result.invalid_reason, "unreachable_below_target");
}

function test_predictor_below_uses_previous_float32_step_for_exact_step_input() {
  const dbPath = buildPredictorFixtureDb();
  const predictor = createCraftOutcomePredictor({
    catalog: createCraftOutcomeCatalog({dbPath})
  });
  const rawRelativeWear = 0.20999999344348907;
  assert.equal(Math.fround(rawRelativeWear), rawRelativeWear);
  const expectedBelowStep = Number(prevFloat32(Math.fround(rawRelativeWear)).toFixed(12));

  const result = predictor.predict({
    required_count: 10,
    target_relative_wear: rawRelativeWear,
    input_rarity: "军规级",
    stattrak: true,
    groups: [{collection: "裂空武器箱", count: 3}]
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcomes[0].predicted_float, expectedBelowStep);
}

function test_predictor_infinite_mode_keeps_input_float32_step() {
  const dbPath = buildPredictorFixtureDb();
  const predictor = createCraftOutcomePredictor({
    catalog: createCraftOutcomeCatalog({dbPath})
  });
  const rawRelativeWear = 0.21;
  const expectedStep = Number(Math.fround(rawRelativeWear).toFixed(12));

  const result = predictor.predict({
    required_count: 10,
    target_relative_wear: rawRelativeWear,
    wear_approach_mode: "infinite",
    input_rarity: "军规级",
    stattrak: true,
    groups: [{collection: "裂空武器箱", count: 3}]
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcomes[0].predicted_float, expectedStep);
}

function test_predictor_keeps_missing_wear_bounds_and_missing_concrete_rows() {
  const dbPath = buildPredictorFixtureDb();
  const predictor = createCraftOutcomePredictor({
    catalog: createCraftOutcomeCatalog({dbPath})
  });
  const missingBounds = predictor.predict({
    required_count: 10,
    target_relative_wear: 0.6,
    input_rarity: "军规级",
    stattrak: false,
    groups: [{collection: "Fracture Case", count: 3}]
  });
  const noBoundsOutcome = missingBounds.outcomes.find((item) => item.base_name === "MAC-10 | No Bounds");
  assert.equal(noBoundsOutcome.probability, 0.1);
  assert.equal(noBoundsOutcome.predicted_float, null);
  assert.equal(noBoundsOutcome.missing_wear_bounds, true);

  const missingMapped = predictor.predict({
    required_count: 10,
    target_relative_wear: 0.8,
    input_rarity: "军规级",
    stattrak: false,
    groups: [{collection: "Revolution Case", count: 4}]
  });
  assert.equal(missingMapped.ok, true);
  assert.equal(missingMapped.outcomes[0].mapped_skin_missing, true);
  assert.equal(missingMapped.outcomes[0].predicted_wearlevel, "Battle-Scarred");
}

function test_outcome_catalog_excludes_inventory_display_only_rows() {
  const {dbPath, db} = createTempPredictorDb();
  insertSkinRow(db, {
    markethashname: "AK-47 | Ice Coaled (Factory New)",
    basemarkethashname: "AK-47 | Ice Coaled",
    collection: "Fracture Case",
    rarity: "受限",
    wearlevel: "Factory New",
    minfloat: 0,
    maxfloat: 1,
    wear_range: 1
  });
  insertSkinRow(db, {
    markethashname: "Souvenir AK-47 | Ice Coaled (Factory New)",
    basemarkethashname: "Souvenir AK-47 | Ice Coaled",
    basename: "Souvenir AK-47 | Ice Coaled",
    collection: "Fracture Case",
    rarity: "受限",
    wearlevel: "Factory New",
    minfloat: 0,
    maxfloat: 1,
    wear_range: 1,
    inventory_display_only: 1
  });
  db.close();

  const catalog = createCraftOutcomeCatalog({dbPath});
  const snapshot = catalog.getSnapshot();
  const bucket = snapshot.baseBuckets.get("Fracture Case|4|0") || [];

  assert.equal(bucket.length, 1);
  assert.equal(bucket[0].base_name, "AK-47 | Ice Coaled");
}

function runTests() {
  test_shared_collection_and_rarity_helpers();
  test_outcome_catalog_scaffold_reads_base_buckets_and_wear_map();
  test_outcome_catalog_excludes_inventory_display_only_rows();
  test_predictor_invalidates_top_rarity_and_missing_collections();
  test_predictor_returns_realtime_probabilities_for_partial_recipe();
  test_predictor_isolates_stattrak_pools_and_maps_wear();
  test_predictor_uses_infinite_mode_input_float32_step_for_output_float();
  test_predictor_below_uses_raw_decimal_step_when_raw_sits_above_float32_step();
  test_predictor_below_rejects_unreachable_zero_raw();
  test_predictor_below_uses_previous_float32_step_for_exact_step_input();
  test_predictor_infinite_mode_keeps_input_float32_step();
  test_predictor_defaults_to_below_previous_float32_step_for_output_float();
  test_predictor_keeps_missing_wear_bounds_and_missing_concrete_rows();
  console.log("craftOutcomePredictor tests passed");
}

runTests();
