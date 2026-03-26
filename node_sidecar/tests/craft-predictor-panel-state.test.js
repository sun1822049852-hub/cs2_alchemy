const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function extractConst(name) {
  const match = APP_SOURCE.match(new RegExp(`^[\\uFEFF\\s]*const\\s+${name}\\s*=\\s*[^;]+;`, "m"));
  assert.ok(match, `missing const ${name}`);
  return match[0].replace(/^\uFEFF/, "");
}

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

function loadPredictorPanelFns(initialState = {}) {
  const source = [
    extractConst("RARITY_MAP"),
    extractBlock("function normalizeCraftPredictorRarityLabel(", "function renderCraftAssistBusyMask(")
  ].join("\n");
  const context = {
    Math,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
    JSON,
    console,
    state: {
      craftPredictorOpen: false,
      craftPredictorSelectedConfigKey: "",
      craftPredictorSelectedConfigLabel: "",
      craftPredictorDismissedConfigKeys: {},
      ...initialState
    },
    renderCraftPredictorPanel() {},
    renderCraftPage() {}
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function testSelectCraftPredictorConfigAutoOpensOnlyOncePerConfig() {
  const app = loadPredictorPanelFns();
  assert.equal(typeof app.selectCraftPredictorConfig, "function", "expected config selection helper to exist");
  assert.equal(typeof app.setCraftPredictorPanelOpen, "function", "expected panel toggle helper to exist");

  app.selectCraftPredictorConfig("draft", {label: "当前配置", autoOpen: true});
  assert.equal(app.state.craftPredictorOpen, true);
  assert.equal(app.state.craftPredictorSelectedConfigKey, "draft");

  app.setCraftPredictorPanelOpen(false, {manual: true});
  assert.equal(app.state.craftPredictorOpen, false);
  assert.equal(app.state.craftPredictorDismissedConfigKeys.draft, true);

  app.selectCraftPredictorConfig("draft", {label: "当前配置", autoOpen: true});
  assert.equal(
    app.state.craftPredictorOpen,
    false,
    "manually collapsed config should not auto-open again until another config is selected"
  );

  app.selectCraftPredictorConfig("preset:alpha", {label: "Alpha", autoOpen: true});
  assert.equal(app.state.craftPredictorOpen, true);
  assert.equal(app.state.craftPredictorSelectedConfigKey, "preset:alpha");
}

function testBuildCraftPredictorRequestFromDraftAggregatesCollections() {
  const app = loadPredictorPanelFns();
  assert.equal(typeof app.buildCraftPredictorRequestFromDraft, "function", "expected request builder helper to exist");

  const result = app.buildCraftPredictorRequestFromDraft({
    targetWear: 0.18,
    requiredCount: 10,
    materials: [
      {names: ["AK-47 | Slate"], count: 3},
      {names: ["USP-S | Cortex"], count: 2}
    ],
    parentGroups: [
      {name: "AK-47 | Slate", collection: "Fracture Case", rarity: "军规级", stattrak: false},
      {name: "USP-S | Cortex", collection: "Clutch Case", rarity: "Mil-Spec", stattrak: false}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.payload.required_count, 10);
  assert.equal(result.payload.target_relative_wear, 0.18);
  assert.equal(result.payload.input_rarity, "军规级");
  assert.equal(result.payload.stattrak, false);
  assert.deepEqual(Array.from(result.payload.groups), [
    {collection: "Fracture Case", count: 3},
    {collection: "Clutch Case", count: 2}
  ]);
}

function testBuildCraftPredictorRequestRejectsAmbiguousOrMixedPools() {
  const app = loadPredictorPanelFns();

  const ambiguous = app.buildCraftPredictorRequestFromDraft({
    targetWear: 0.3,
    requiredCount: 10,
    materials: [
      {names: ["AK-47 | Slate", "USP-S | Cortex"], count: 4}
    ],
    parentGroups: [
      {name: "AK-47 | Slate", collection: "Fracture Case", rarity: "军规级", stattrak: false},
      {name: "USP-S | Cortex", collection: "Clutch Case", rarity: "军规级", stattrak: false}
    ]
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, "ambiguous_material_group");

  const mixedPool = app.buildCraftPredictorRequestFromDraft({
    targetWear: 0.3,
    requiredCount: 10,
    materials: [
      {names: ["AK-47 | Slate"], count: 4},
      {names: ["StatTrak™ USP-S | Cortex"], count: 6}
    ],
    parentGroups: [
      {name: "AK-47 | Slate", collection: "Fracture Case", rarity: "军规级", stattrak: false},
      {name: "StatTrak™ USP-S | Cortex", collection: "Clutch Case", rarity: "军规级", stattrak: true}
    ]
  });
  assert.equal(mixedPool.ok, false);
  assert.equal(mixedPool.reason, "mixed_stattrak");
}

function main() {
  testSelectCraftPredictorConfigAutoOpensOnlyOncePerConfig();
  testBuildCraftPredictorRequestFromDraftAggregatesCollections();
  testBuildCraftPredictorRequestRejectsAmbiguousOrMixedPools();
  console.log("craft-predictor-panel-state tests passed");
}

main();
