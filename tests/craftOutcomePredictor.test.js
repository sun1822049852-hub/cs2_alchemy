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
  displayBase = base,
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
    const marketBase = `${isstattrak ? "StatTrak™ " : ""}${base}`;
    const displayMarketBase = `${isstattrak ? "StatTrak™ " : ""}${displayBase}`;
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
      isstattrak,
      wear_range: computedWearRange,
      goods_icon_url: goodsIconUrl,
      goods_original_icon_url: goodsOriginalIconUrl,
      goods_share_thumbnail_url: goodsShareThumbnailUrl
    });
  }
}

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

function buildDPrecisionPredictorFixtureDb() {
  const {dbPath, db} = createTempPredictorDb();
  insertWearFamily(db, {
    base: "P250 | Just For Fun",
    collection: "Control Case",
    rarity: "受限",
    minfloat: 0,
    maxfloat: 0.7
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

function test_predictor_returns_products_and_probabilities_without_target_wear() {
  const dbPath = buildPredictorFixtureDb();
  const predictor = createCraftOutcomePredictor({
    catalog: createCraftOutcomeCatalog({dbPath})
  });
  const result = predictor.predict({
    required_count: 10,
    input_rarity: "军规级",
    stattrak: false,
    groups: [{collection: "Fracture Case", count: 3}]
  });

  assert.equal(result.ok, true);
  assert.equal(result.current_count, 3);
  assert.equal(result.target_relative_wear, null);
  assert.equal(result.summary.probability_total, 0.3);
  assert.ok(result.outcomes.length > 0);
  assert.equal(result.outcomes.every((item) => item.predicted_float == null), true);
  assert.equal(result.outcomes.every((item) => item.predicted_wearlevel === ""), true);
  assert.equal(result.outcomes.every((item) => item.name === item.base_name), true);
}

function test_predictor_returns_outcome_union_without_probabilities_for_unknown_distribution() {
  const dbPath = buildPredictorFixtureDb();
  const predictor = createCraftOutcomePredictor({
    catalog: createCraftOutcomeCatalog({dbPath})
  });
  const result = predictor.predict({
    required_count: 10,
    current_count: 10,
    probability_mode: "unknown",
    target_relative_wear: 0.2,
    input_rarity: "军规级",
    stattrak: false,
    groups: [
      {collection: "Fracture Case", count: 1},
      {collection: "Clutch Case", count: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.current_count, 10);
  assert.equal(result.probability_known, false);
  assert.equal(result.summary.probability_total, null);
  assert.equal(result.summary.probability_missing, null);
  assert.ok(result.outcomes.length > 0);
  assert.equal(result.outcomes.every((item) => item.probability === null), true);
  assert.equal(result.outcomes.some((item) => Number.isFinite(item.predicted_float)), true);
  assert.deepEqual(
    [...new Set(result.outcomes.map((item) => item.collection_key))].sort(),
    ["Clutch Case", "Fracture Case"]
  );
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

function test_predictor_defaults_to_below_safe_offset_for_output_float() {
  const dbPath = buildPredictorFixtureDb();
  const predictor = createCraftOutcomePredictor({
    catalog: createCraftOutcomeCatalog({dbPath})
  });
  const rawRelativeWear = 0.069999999;
  const expectedBelowStep = Number(Math.fround(rawRelativeWear - 0.0000001).toFixed(12));
  const oldPrevFloat32Step = Number(prevFloat32(Math.fround(rawRelativeWear)).toFixed(12));
  assert.equal(expectedBelowStep, 0.06999989599);
  assert.equal(oldPrevFloat32Step, 0.069999992847);

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
  assert.notEqual(result.outcomes[0].predicted_float, oldPrevFloat32Step);
  assert.equal(result.outcomes[0].predicted_wearlevel, "Factory New");
  assert.equal(result.outcomes[0].name, "StatTrak™ AK-47 | Ice Coaled (Factory New)");
}

function test_predictor_below_uses_raw_decimal_step_when_raw_sits_above_float32_step() {
  const dbPath = buildPredictorFixtureDb();
  const predictor = createCraftOutcomePredictor({
    catalog: createCraftOutcomeCatalog({dbPath})
  });
  const rawRelativeWear = 0.21;
  const oldRawStep = Number(Math.fround(rawRelativeWear).toFixed(12));
  const expectedBelowStep = Number(Math.fround(rawRelativeWear - 0.0000001).toFixed(12));
  const oldPrevFloat32Step = Number(prevFloat32(Math.fround(rawRelativeWear)).toFixed(12));
  assert.equal(oldRawStep, 0.209999993443);
  assert.equal(expectedBelowStep, 0.209999904037);
  assert.equal(oldPrevFloat32Step, 0.209999978542);

  const result = predictor.predict({
    required_count: 10,
    target_relative_wear: rawRelativeWear,
    input_rarity: "军规级",
    stattrak: true,
    groups: [{collection: "裂空武器箱", count: 3}]
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcomes[0].predicted_float, expectedBelowStep);
  assert.notEqual(result.outcomes[0].predicted_float, oldRawStep);
  assert.notEqual(result.outcomes[0].predicted_float, oldPrevFloat32Step);
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

function test_predictor_below_uses_safe_offset_for_exact_float32_step_input() {
  const dbPath = buildPredictorFixtureDb();
  const predictor = createCraftOutcomePredictor({
    catalog: createCraftOutcomeCatalog({dbPath})
  });
  const rawRelativeWear = 0.20999999344348907;
  assert.equal(Math.fround(rawRelativeWear), rawRelativeWear);
  const expectedBelowStep = Number(Math.fround(rawRelativeWear - 0.0000001).toFixed(12));
  const oldPrevFloat32Step = Number(prevFloat32(Math.fround(rawRelativeWear)).toFixed(12));
  assert.equal(expectedBelowStep, 0.209999889135);
  assert.equal(oldPrevFloat32Step, 0.209999978542);

  const result = predictor.predict({
    required_count: 10,
    target_relative_wear: rawRelativeWear,
    input_rarity: "军规级",
    stattrak: true,
    groups: [{collection: "裂空武器箱", count: 3}]
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcomes[0].predicted_float, expectedBelowStep);
  assert.notEqual(result.outcomes[0].predicted_float, oldPrevFloat32Step);
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

function test_predictor_uses_float32_output_wear_chain_for_real_block_2_and_27_samples() {
  const dbPath = buildDPrecisionPredictorFixtureDb();
  const predictor = createCraftOutcomePredictor({
    catalog: createCraftOutcomeCatalog({dbPath})
  });
  const samples = [
    {
      label: "产物3 block 2",
      materials: [
        0.1982271969318390,
        0.2294915914535522,
        0.2214016467332840,
        0.1960709542036056,
        0.2215701788663864,
        0.2264136672019958,
        0.2265089154243469,
        0.2265659868717193,
        0.1696951240301132,
        0.2269040942192077
      ],
      expectedD: 0.149999439716,
      oldC: 0.149999448657
    },
    {
      label: "产物3 block 27",
      materials: [
        0.2251613587141037,
        0.1926978230476379,
        0.1905441880226135,
        0.1695592254400253,
        0.2263000607490539,
        0.2265266180038452,
        0.2267705947160721,
        0.2274858653545379,
        0.2285781949758529,
        0.2292252331972122
      ],
      expectedD: 0.149999439716,
      oldC: 0.149999448657
    }
  ];

  for (const sample of samples) {
    const relativeWearD = float32SequentialMean(sample.materials);
    const expectedD = Number(float32OutcomeWear(relativeWearD, 0, 0.7).toFixed(12));
    const oldC = Number((relativeWearD * 0.7).toFixed(12));
    assert.equal(expectedD, sample.expectedD, sample.label);
    assert.equal(oldC, sample.oldC, sample.label);

    const result = predictor.predict({
      required_count: 10,
      target_relative_wear: relativeWearD,
      wear_approach_mode: "infinite",
      input_rarity: "军规级",
      stattrak: false,
      groups: [{collection: "Control Case", count: 10}]
    });

    assert.equal(result.ok, true, sample.label);
    assert.equal(result.outcomes[0].predicted_float, expectedD, sample.label);
    assert.notEqual(result.outcomes[0].predicted_float, oldC, sample.label);
  }
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
    markethashname: "Sticker | Miami Stabbyfish",
    basemarkethashname: "Sticker | Miami Stabbyfish",
    basename: "Sticker | Miami Stabbyfish",
    collection: "Fracture Case",
    rarity: "受限",
    wearlevel: "Unknown",
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

function test_predictor_excludes_souvenir_outcomes_from_result_pool() {
  const {dbPath, db} = createTempPredictorDb();
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

  const predictor = createCraftOutcomePredictor({
    catalog: createCraftOutcomeCatalog({dbPath})
  });
  const result = predictor.predict({
    required_count: 10,
    target_relative_wear: 0.12,
    input_rarity: "军规级",
    stattrak: false,
    groups: [{collection: "2018 Nuke Collection", count: 10}]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.outcomes.map((item) => item.base_name), [
    "M4A4 | Mainframe"
  ]);
  assert.deepEqual(result.outcomes.map((item) => item.probability), [1]);
  const souvenirOnlyOutcome = result.outcomes.find((item) => item.base_name === "P250 | Facility Draft");
  assert.equal(souvenirOnlyOutcome, undefined);
  assert.equal(result.outcomes.some((item) => /^Souvenir\s+/i.test(item.base_name)), false);
  assert.equal(result.outcomes.some((item) => /^Souvenir\s+/i.test(item.name)), false);
  assert.equal(result.summary.probability_total, 1);
}

function test_predictor_preserves_localized_display_for_normal_outcomes() {
  const {dbPath, db} = createTempPredictorDb();
  insertWearFamily(db, {
    base: "Glock-18 | Nuclear Garden",
    displayBase: "格洛克18型 | 核子花园",
    collection: "2018 Nuke Collection",
    rarity: "受限"
  });
  db.close();

  const predictor = createCraftOutcomePredictor({
    catalog: createCraftOutcomeCatalog({dbPath})
  });
  const result = predictor.predict({
    required_count: 10,
    target_relative_wear: 0.12,
    input_rarity: "军规级",
    stattrak: false,
    groups: [{collection: "2018 Nuke Collection", count: 10}]
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcomes.length, 1);
  assert.equal(result.outcomes[0].base_name, "格洛克18型 | 核子花园");
  assert.equal(result.outcomes[0].name, "格洛克18型 | 核子花园 (Minimal Wear)");
  assert.equal(result.outcomes[0].markethashname, "Glock-18 | Nuclear Garden (Minimal Wear)");
}

function test_predictor_rejects_collection_when_only_souvenir_outcomes_exist() {
  const {dbPath, db} = createTempPredictorDb();
  insertWearFamily(db, {
    base: "Souvenir P250 | Facility Draft",
    displayBase: "纪念品 P250 | Facility Draft",
    collection: "2018 Nuke Collection",
    rarity: "受限"
  });
  db.close();

  const predictor = createCraftOutcomePredictor({
    catalog: createCraftOutcomeCatalog({dbPath})
  });
  const result = predictor.predict({
    required_count: 10,
    target_relative_wear: 0.12,
    input_rarity: "军规级",
    stattrak: false,
    groups: [{collection: "2018 Nuke Collection", count: 10}]
  });

  assert.equal(result.ok, false);
  assert.equal(result.invalid_reason, "collection_outcomes_missing");
  assert.deepEqual(result.outcomes, []);
}

function test_predictor_ignores_parenthesized_souvenir_outcome_when_normal_display_exists() {
  const {dbPath, db} = createTempPredictorDb();
  insertWearFamily(db, {
    base: "Glock-18 | Nuclear Garden",
    displayBase: "格洛克18型 | 核子花园",
    collection: "2018 Nuke Collection",
    rarity: "受限"
  });
  insertWearFamily(db, {
    base: "Souvenir Glock-18 | Nuclear Garden",
    displayBase: "格洛克18型（纪念品） | 核子花园",
    collection: "2018 Nuke Collection",
    rarity: "受限"
  });
  db.close();

  const predictor = createCraftOutcomePredictor({
    catalog: createCraftOutcomeCatalog({dbPath})
  });
  const result = predictor.predict({
    required_count: 10,
    target_relative_wear: 0.12,
    input_rarity: "军规级",
    stattrak: false,
    groups: [{collection: "2018 Nuke Collection", count: 10}]
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcomes.length, 1);
  assert.equal(result.outcomes[0].base_name, "格洛克18型 | 核子花园");
  assert.equal(result.outcomes[0].name, "格洛克18型 | 核子花园 (Minimal Wear)");
  assert.equal(result.outcomes[0].markethashname, "Glock-18 | Nuclear Garden (Minimal Wear)");
  assert.equal(/Souvenir|纪念品/.test(JSON.stringify(result.outcomes[0])), false);
}

function runTests() {
  test_shared_collection_and_rarity_helpers();
  test_outcome_catalog_scaffold_reads_base_buckets_and_wear_map();
  test_outcome_catalog_excludes_inventory_display_only_rows();
  test_predictor_excludes_souvenir_outcomes_from_result_pool();
  test_predictor_preserves_localized_display_for_normal_outcomes();
  test_predictor_rejects_collection_when_only_souvenir_outcomes_exist();
  test_predictor_ignores_parenthesized_souvenir_outcome_when_normal_display_exists();
  test_predictor_invalidates_top_rarity_and_missing_collections();
  test_predictor_returns_realtime_probabilities_for_partial_recipe();
  test_predictor_returns_products_and_probabilities_without_target_wear();
  test_predictor_returns_outcome_union_without_probabilities_for_unknown_distribution();
  test_predictor_isolates_stattrak_pools_and_maps_wear();
  test_predictor_uses_infinite_mode_input_float32_step_for_output_float();
  test_predictor_below_uses_raw_decimal_step_when_raw_sits_above_float32_step();
  test_predictor_below_rejects_unreachable_zero_raw();
  test_predictor_below_uses_safe_offset_for_exact_float32_step_input();
  test_predictor_infinite_mode_keeps_input_float32_step();
  test_predictor_uses_float32_output_wear_chain_for_real_block_2_and_27_samples();
  test_predictor_defaults_to_below_safe_offset_for_output_float();
  test_predictor_keeps_missing_wear_bounds_and_missing_concrete_rows();
  console.log("craftOutcomePredictor tests passed");
}

runTests();
