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
    extractBlock("function setCraftAssistPanelOpen(", "function setCraftAssistRoleChooserOpen("),
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
      craftAssistOpen: false,
      craftAssistPickerOpen: false,
      craftAssistPickerTargetMaterialId: "",
      craftAssistRoleChooserOpen: false,
      craftAssistPresetEditingId: "",
      craftAssistPresetEditingName: "",
      craftPredictorOpen: false,
      craftPredictorContextType: "",
      craftPredictorContextId: "",
      craftPredictorContextLabel: "",
      craftPredictorAutoOpenMuted: false,
      craftPredictorLoading: false,
      craftPredictorError: "",
      craftPredictorResponse: null,
      craftPredictorRequestKey: "",
      craftPredictorLoadedKey: "",
      craftPredictorRequestSeq: 0,
      craftPredictorPreferredRowsContextKey: "",
      craftPredictorPreferredRowsById: null,
      currentPage: "craftPage",
      craftAssistApproachMode: false,
      batchCraftApproachMode: false,
      craftAssistTargetWear: null,
      craftAssistMaterials: [],
      ...initialState
    },
    craftAssistPickerCloseTimer: null,
    renderCraftAssistPanel() {},
    renderCraftPredictorPanel() {},
    renderCraftPage() {},
    refreshCraftPredictorPreview() {
      context.refreshCalls += 1;
    },
    refreshCalls: 0,
    isGuestWorkspaceActive() {
      return false;
    },
    isCraftAssistPresetEditing() {
      return false;
    },
    expandCraftAssistOverlayToBottom() {},
    stopCraftAssistOverlayDrag() {},
    stopCraftAssistSplitDrag() {},
    cancelCraftAssistPresetEditingSession() {},
    applyCraftAssistOverlayHeight() {},
    applyCraftAssistPresetWidth() {},
    buildCraftAssistParentGroups() {
      return [];
    },
    findCraftRecipeById(recipeId) {
      const key = String(recipeId || "").trim();
      if (!key) return null;
      const list = Array.isArray(context.state.craftRecipeQueue) ? context.state.craftRecipeQueue : [];
      return list.find((entry) => String(entry && entry.id || "").trim() === key) || {id: key, item_ids: [], status: "pending"};
    },
    getAllInventoryCraftableRows() {
      return [];
    },
    buildRowsByAssetId() {
      return new Map();
    },
    normalizeCraftRecipeItemIds(ids) {
      return Array.isArray(ids) ? ids.map((value) => String(value || "").trim()).filter(Boolean) : [];
    },
    collectionName(row) {
      return String(row && row.collection || "").trim();
    },
    rarityName(row) {
      return String(row && (row.alchemy_rarity || row.rarity_name) || "").trim();
    },
    isRowStatTrak(row) {
      return !!(row && row.stattrak);
    },
    averageRelativeWearValue() {
      return 0.2;
    },
    craftAssistMaterialLimitFor() {
      return 10;
    },
    api() {
      throw new Error("api should not be called in panel-state unit tests");
    },
    wearTextFull(value) {
      return String(value);
    }
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

async function flushMicrotasks(count = 4) {
  for (let i = 0; i < count; i += 1) {
    await Promise.resolve();
  }
}

function testSelectCraftPredictorContextSetsRecipeTargetWithoutAutoOpen() {
  const app = loadPredictorPanelFns();
  assert.equal(typeof app.selectCraftPredictorContext, "function", "expected recipe-oriented predictor context helper");
  assert.equal(typeof app.setCraftPredictorPanelOpen, "function", "expected panel toggle helper to exist");

  app.selectCraftPredictorContext({type: "recipe", id: "recipe-1", label: "#1"});
  assert.equal(app.state.craftPredictorOpen, false, "selecting predictor context should not force the drawer open");
  assert.equal(app.state.craftPredictorContextType, "recipe");
  assert.equal(app.state.craftPredictorContextId, "recipe-1");
  assert.equal(app.state.craftPredictorContextLabel, "#1");
}

function testSetCraftAssistPanelOpenDoesNotHijackPredictorContextOrVisibility() {
  const app = loadPredictorPanelFns({
    craftPredictorOpen: false,
    craftPredictorContextType: "recipe",
    craftPredictorContextId: "recipe-1",
    craftPredictorContextLabel: "#1"
  });
  assert.equal(typeof app.setCraftAssistPanelOpen, "function", "expected craft assist toggle helper to exist");

  app.setCraftAssistPanelOpen(true);
  assert.equal(app.state.craftAssistOpen, true);
  assert.equal(app.state.craftPredictorOpen, false, "opening craft assist should not force predictor visible");
  assert.equal(app.state.craftPredictorContextType, "recipe");
  assert.equal(app.state.craftPredictorContextId, "recipe-1");
}

function testFocusCraftPredictorOnActiveDraftRetargetsCurrentEditedRecipe() {
  const app = loadPredictorPanelFns({
    craftPredictorOpen: false,
    craftPredictorContextType: "recipe",
    craftPredictorContextId: "recipe-1",
    craftPredictorContextLabel: "#1",
    craftActiveRecipeId: "recipe-2",
    craftRecipeQueue: [
      {id: "recipe-1", item_ids: ["a"], status: "pending"},
      {id: "recipe-2", item_ids: ["b"], status: "pending"}
    ]
  });

  assert.equal(typeof app.focusCraftPredictorOnActiveDraft, "function", "expected current-draft focus helper to exist");

  app.focusCraftPredictorOnActiveDraft({autoOpen: true});
  assert.equal(app.state.craftPredictorOpen, true, "editing current recipe should auto-open predictor until the user manually collapses it");
  assert.equal(app.state.craftPredictorContextType, "draft");
  assert.equal(app.state.craftPredictorContextId, "recipe-2");
  assert.equal(app.state.craftPredictorContextLabel, "当前配置");
}

function testManualCollapseStopsRepeatedAutoOpenForSameDraft() {
  const app = loadPredictorPanelFns({
    craftPredictorOpen: false,
    craftActiveRecipeId: "recipe-2",
    craftRecipeQueue: [
      {id: "recipe-2", item_ids: ["b"], status: "pending"}
    ]
  });

  app.focusCraftPredictorOnActiveDraft({autoOpen: true});
  assert.equal(app.state.craftPredictorOpen, true);

  app.setCraftPredictorPanelOpen(false, {manual: true});
  assert.equal(app.state.craftPredictorOpen, false);
  assert.equal(app.state.craftPredictorAutoOpenMuted, true);

  app.focusCraftPredictorOnActiveDraft({autoOpen: true});
  assert.equal(
    app.state.craftPredictorOpen,
    false,
    "manually collapsed predictor should stop auto-opening again while the user keeps editing"
  );
}

function testDifferentDraftAlsoStaysMutedAfterManualCollapse() {
  const app = loadPredictorPanelFns({
    craftPredictorOpen: false,
    craftPredictorAutoOpenMuted: true,
    craftActiveRecipeId: "recipe-3",
    craftRecipeQueue: [
      {id: "recipe-2", item_ids: ["b"], status: "pending"},
      {id: "recipe-3", item_ids: ["c"], status: "pending"}
    ]
  });

  app.focusCraftPredictorOnActiveDraft({autoOpen: true});
  assert.equal(
    app.state.craftPredictorOpen,
    false,
    "after the user manually collapses predictor, editing other recipes should also stop auto-opening"
  );
  assert.equal(app.state.craftPredictorContextId, "recipe-3");
}

async function testFocusCraftPredictorOnActiveDraftKeepsImmediatePredictionAcrossFollowupRefresh() {
  const app = loadPredictorPanelFns({
    craftPredictorOpen: false,
    craftActiveRecipeId: "recipe-2",
    craftRecipeQueue: [
      {id: "recipe-2", item_ids: ["b"], status: "pending"}
    ]
  });
  const preferredRowsById = new Map([[
    "b",
    {
      asset_id: "b",
      collection: "Fracture Case",
      alchemy_rarity: "军规级",
      stattrak: false
    }
  ]]);
  const apiCalls = [];
  let resolveApi = null;

  app.getAllInventoryCraftableRows = () => [];
  app.buildRowsByAssetId = (rows) => new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [String(row && row.asset_id || "").trim(), row])
  );
  app.api = async (path, init) => {
    apiCalls.push({
      path,
      body: JSON.parse(String(init && init.body || "{}"))
    });
    return await new Promise((resolve) => {
      resolveApi = () => resolve({
        ok: true,
        invalid_reason: "",
        message: "",
        required_count: 10,
        current_count: 1,
        target_relative_wear: 0.2,
        input_rarity: "军规级",
        output_rarity: "受限",
        outcomes: [{base_name: "AK-47 | Ice Coaled", probability: 0.1}]
      });
    });
  };

  app.focusCraftPredictorOnActiveDraft({autoOpen: true, preferredRowsById});
  assert.equal(apiCalls.length, 1, "auto-open should immediately start predicting with the just-selected material rows");
  assert.equal(app.state.craftPredictorLoading, true, "initial auto-open refresh should keep predictor in loading state");

  await app.refreshCraftPredictorPreview();
  assert.equal(
    apiCalls.length,
    1,
    "follow-up refreshes should reuse the same hinted rows instead of cancelling the in-flight prediction"
  );
  assert.equal(
    app.state.craftPredictorLoading,
    true,
    "follow-up refresh without synced inventory rows should not downgrade the predictor back to an error state"
  );

  assert.ok(resolveApi, "expected the predictor api call to stay pending until the test resolves it");
  resolveApi();
  await flushMicrotasks();

  assert.equal(app.state.craftPredictorError, "");
  assert.equal(app.state.craftPredictorResponse && app.state.craftPredictorResponse.ok, true);
  assert.equal(app.state.craftPredictorResponse.outcomes.length, 1);
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

function testBuildCraftPredictorRequestFromDraftPassesCurrentApproachMode() {
  const app = loadPredictorPanelFns({
    currentPage: "craftPage",
    craftAssistApproachMode: true
  });

  const result = app.buildCraftPredictorRequestFromDraft({
    targetWear: 0.18,
    requiredCount: 10,
    materials: [
      {names: ["AK-47 | Slate"], count: 3}
    ],
    parentGroups: [
      {name: "AK-47 | Slate", collection: "Fracture Case", rarity: "军规级", stattrak: false}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.payload.wear_approach_mode, "infinite");
}

function testBuildCraftPredictorRequestFromRecipePassesCurrentApproachMode() {
  const app = loadPredictorPanelFns({
    currentPage: "craftPage",
    craftAssistApproachMode: true
  });
  const rowsById = new Map([[
    "a",
    {
      asset_id: "a",
      collection: "Fracture Case",
      alchemy_rarity: "军规级",
      stattrak: false
    }
  ]]);

  const result = app.buildCraftPredictorRequestFromRecipeEntry(
    {id: "recipe-1", item_ids: ["a"], status: "pending"},
    rowsById
  );

  assert.equal(result.ok, true);
  assert.equal(result.payload.wear_approach_mode, "infinite");
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

function testBuildCraftPredictorRequestFromDraftSupportsItemLevelMaterialsAndSharedRequiredCount() {
  const app = loadPredictorPanelFns();
  app.craftAssistItemWearShared = {
    resolveCraftAssistRequiredCount() {
      return 5;
    }
  };

  const result = app.buildCraftPredictorRequestFromDraft({
    targetWear: 0.18,
    requiredCount: null,
    materials: [
      {role: "main", count: 3, items: [{name: "AK-47 | Slate"}]},
      {role: "aux", count: 2, items: [{name: "USP-S | Cortex"}]}
    ],
    parentGroups: [
      {name: "AK-47 | Slate", collection: "Fracture Case", rarity: "军规级", stattrak: false},
      {name: "USP-S | Cortex", collection: "Clutch Case", rarity: "军规级", stattrak: false}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.payload.required_count, 5);
  assert.deepEqual(Array.from(result.payload.groups), [
    {collection: "Fracture Case", count: 3},
    {collection: "Clutch Case", count: 2}
  ]);
}

async function main() {
  testSelectCraftPredictorContextSetsRecipeTargetWithoutAutoOpen();
  testSetCraftAssistPanelOpenDoesNotHijackPredictorContextOrVisibility();
  testFocusCraftPredictorOnActiveDraftRetargetsCurrentEditedRecipe();
  testManualCollapseStopsRepeatedAutoOpenForSameDraft();
  testDifferentDraftAlsoStaysMutedAfterManualCollapse();
  await testFocusCraftPredictorOnActiveDraftKeepsImmediatePredictionAcrossFollowupRefresh();
  testBuildCraftPredictorRequestFromDraftAggregatesCollections();
  testBuildCraftPredictorRequestFromDraftPassesCurrentApproachMode();
  testBuildCraftPredictorRequestFromRecipePassesCurrentApproachMode();
  testBuildCraftPredictorRequestRejectsAmbiguousOrMixedPools();
  testBuildCraftPredictorRequestFromDraftSupportsItemLevelMaterialsAndSharedRequiredCount();
  console.log("craft-predictor-panel-state tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
