const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const htmlPath = path.join(__dirname, "..", "node_sidecar", "ui", "index.html");
const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");

const appSource = fs.readFileSync(appPath, "utf8");
const htmlSource = fs.readFileSync(htmlPath, "utf8");
const cssSource = fs.readFileSync(cssPath, "utf8");

function extractFunctionSource(name) {
  const asyncMarker = `async function ${name}(`;
  const marker = `function ${name}(`;
  const asyncStart = appSource.indexOf(asyncMarker);
  const start = asyncStart >= 0 ? asyncStart : appSource.indexOf(marker);
  assert.notEqual(start, -1, `craft assist editor should define ${name}`);
  const paramsStart = appSource.indexOf("(", start);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < appSource.length; index += 1) {
    if (appSource[index] === "(") paramsDepth += 1;
    if (appSource[index] === ")") paramsDepth -= 1;
    if (paramsDepth === 0) {
      paramsEnd = index;
      break;
    }
  }
  const bodyStart = appSource.indexOf("{", paramsEnd);
  let depth = 0;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    if (appSource[index] === "{") depth += 1;
    if (appSource[index] === "}") depth -= 1;
    if (depth === 0) return appSource.slice(start, index + 1);
  }
  assert.fail(`craft assist editor function ${name} should have a complete body`);
}

const htmlFragments = [
  'id="craftAssistEditorModal"',
  'class="modal-card craft-assist-editor-card"',
  'id="craftAssistPresetNameField"',
  'id="craftAssistPresetNameInput"',
  'class="craft-assist-field craft-assist-target-field"',
  'id="craftAssistEditorLeft"',
  'id="craftAssistMainRoleGroup"',
  'id="craftAssistAuxRoleGroup"',
  'id="craftAssistEditorSearch"',
  'id="craftAssistEditorPrediction"',
  'id="craftAssistOutcomeModal"',
  'id="craftAssistOutcomeModalRarityBadge"',
  'id="craftAssistOutcomeModalWearLabel"',
  'id="craftAssistOutcomeModalAbsoluteValue"',
  'class="craft-assist-outcome-decimal-input"',
  'inputmode="numeric" pattern="[0-9]*"'
];

for (const fragment of htmlFragments) {
  assert.equal(
    htmlSource.includes(fragment),
    true,
    `craft assist preset editor html should include fragment: ${fragment}`
  );
}

assert.doesNotMatch(
  htmlSource,
  /id="craftAssist(?:Main|Aux)RoleBtn"|class="craft-assist-editor-role-tabs"/,
  "craft assist editor should use the persistent role groups themselves as the role controls"
);

assert.doesNotMatch(
  htmlSource,
  /id="craftAssistOutcomeConverter"/,
  "outcome wear conversion should no longer be embedded in the prediction column"
);

assert.doesNotMatch(
  htmlSource,
  /craftAssistOutcomeModalStatusBadge|可精修/,
  "the outcome wear converter should not show a refinement badge"
);

assert.doesNotMatch(
  htmlSource,
  /id="craftAssistOutcomeRelativeWrap"[^>]*class="[^"]*hidden/,
  "the relative-wear row should remain visible before the user enters digits"
);

const appFragments = [
  'craftAssistPresetNameField: document.getElementById("craftAssistPresetNameField")',
  'craftAssistPresetNameInput: document.getElementById("craftAssistPresetNameInput")',
  'ui.craftAssistPresetNameInput.disabled = tagMode;',
  '? String(tagNames[Math.trunc(Number(state.craftAssistRarityTag) || 0)] || "")',
  'state.craftAssistEditorInitialSnapshot = deepCopyPlain(captureCraftAssistEditorSnapshot());',
  'const savedPreset = deepCopyPlain(list[idx]);',
  'message: "当前配方存在未保存修改，确认关闭并放弃这些修改吗？"',
  'card.ondragend = (evt) => {',
  'document.elementFromPoint(Number(evt.clientX), Number(evt.clientY))',
  'card.onmousedown = (evt) => {',
  'document.addEventListener("mouseup", finishDrag, true);',
  'if (activeRecipeId && entryId === activeRecipeId && itemIds.length < requiredCount) continue;',
  'function invalidateCraftAssistEditorPrediction(',
  'predictorDraft.payload.wear_approach_mode = "infinite"',
  'preserveEmptyRoles: true',
  'entry.is_tradeup_restricted === true',
  'lockedRarity && !rarity',
  'craftAssistEditorCanonicalIdentity',
  'state.craftAssistEditorSelectedOutcomeKey = "";',
  'state.craftAssistUseAbsoluteWear = normalizeCraftAssistFilterMode(snapshot.wear_filter_mode) === "absolute";',
  'if (evt.key === "Escape" && state.craftAssistEditorOpen)',
  'craftAssistOutcomeModal: document.getElementById("craftAssistOutcomeModal")',
  'craftAssistOutcomeModalWearLabel: document.getElementById("craftAssistOutcomeModalWearLabel")',
  'craftAssistOutcomeModalAbsoluteValue: document.getElementById("craftAssistOutcomeModalAbsoluteValue")'
];

for (const fragment of appFragments) {
  assert.equal(
    appSource.includes(fragment),
    true,
    `craft assist preset editor app should include fragment: ${fragment}`
  );
}

assert.equal(
  appSource.includes("填写目标相对磨损后显示预测"),
  false,
  "targetless specific recipes should leave the prediction column blank instead of rendering an instruction block"
);

assert.doesNotMatch(
  appSource,
  /ui\.craftAssistEditorPrediction\.classList\.toggle\("hidden",\s*tagMode\)/,
  "rarity-tag mode should keep the prediction column visible"
);
assert.match(
  extractFunctionSource("renderCraftAssistEditor"),
  /ui\.craftAssistEditorPrediction\.classList\.remove\("hidden"\)/,
  "rarity-tag mode should explicitly restore the visible prediction column"
);
assert.match(
  extractFunctionSource("renderCraftAssistEditor"),
  /tagMode\s*\?\s*"当前配方已选所有（标签级）"/,
  "rarity-tag mode should explain that all qualifying items are selected by rarity"
);
assert.match(
  extractFunctionSource("renderCraftAssistEditorPrediction"),
  /tagMode[\s\S]*标签模式不进行产物预测/,
  "rarity-tag mode should leave the prediction panel visible with an explicit no-prediction state"
);

assert.match(
  extractFunctionSource("selectCraftAssistEditorOutcome"),
  /ui\.craftAssistOutcomeModal\.classList\.remove\("hidden"\)/,
  "selecting an outcome should open the independent wear conversion modal"
);

const outcomeConverterSource = extractFunctionSource("updateCraftAssistOutcomeConverter");
assert.match(
  outcomeConverterSource,
  /ui\.craftAssistOutcomeModalWearLabel\.textContent\s*=/,
  "a valid absolute wear input should update the modal wear label immediately"
);
assert.match(
  outcomeConverterSource,
  /ui\.craftAssistOutcomeModalAbsoluteValue\.textContent\s*=/,
  "the modal card should keep its absolute wear value visible while editing"
);
assert.match(
  outcomeConverterSource,
  /ui\.craftAssistOutcomeRelativeWear\.value\s*=/,
  "the modal should always resolve a relative-wear display value"
);
assert.match(
  outcomeConverterSource,
  /ui\.craftAssistOutcomeRelativeWrap\.classList\.remove\("hidden"\)/,
  "the relative-wear row should always remain visible"
);
assert.match(
  outcomeConverterSource,
  /ui\.craftAssistOutcomeError\.classList\.remove\("hidden"\)/,
  "an invalid absolute wear input should reveal the conversion error row"
);
assert.match(
  appSource,
  /ui\.craftAssistOutcomeAbsoluteWear\.oninput\s*=\s*\(\)\s*=>\s*\{[\s\S]*sanitizeCraftAssistOutcomeWearDigits[\s\S]*updateCraftAssistOutcomeConverter\(\)/,
  "outcome wear input should keep only fractional digits before converting"
);

assert.match(
  cssSource,
  /\.craft-assist-outcome-modal-card\s*\{[\s\S]*width:\s*440px;[\s\S]*height:\s*620px;/,
  "the outcome wear converter should keep a stable desktop size"
);

assert.match(
  appSource,
  /ui\.craftAssistTargetWear\.value\s*=\s*pair\s*\?\s*pair\.target_wear_raw\s*:\s*"";/,
  "a new specific editor should preserve the target wear as empty until the user enters one"
);

assert.match(
  extractFunctionSource("renderCraftAssistEditor"),
  /if\s*\(!open\)\s*\{[\s\S]*renderCraftAssistOutcomeModal\(\);[\s\S]*return;/,
  "closing the editor should also hide the independent outcome modal"
);

assert.match(
  extractFunctionSource("renderCraftAssistList"),
  /item\.onclick\s*=\s*\(evt\)\s*=>[\s\S]*activateRole\(\)/,
  "clicking the non-interactive area of a persistent role group should select that whole group"
);
assert.match(
  extractFunctionSource("renderCraftAssistList"),
  /item\.classList\.toggle\("active",[\s\S]*state\.craftAssistPickRole/,
  "the selected role should highlight the persistent group container"
);
assert.match(
  extractFunctionSource("openNewCraftAssistEditor"),
  /state\.craftAssistPickRole\s*=\s*"main"/,
  "new craft assist editors should default future additions to the main role"
);
assert.match(
  extractFunctionSource("applyCraftAssistPresetForEdit"),
  /state\.craftAssistPickRole\s*=\s*"main"/,
  "edited craft assist presets should default future additions to the main role"
);
assert.match(
  extractFunctionSource("buildCraftAssistEditorParentGroups"),
  /getAllInventoryCraftableRows\(\{includeComponentItems:\s*true\}\)/,
  "editor prediction metadata should include component inventory without restricting catalog-only additions"
);
assert.match(
  extractFunctionSource("renderCraftAssistEditorPrediction"),
  /formatCraftAssistEditorOutcomeMeta\(outcome,\s*state\.craftAssistEditorPredictionResponse\)/,
  "editor outcome cards should omit missing wear when no target is set"
);
assert.match(
  extractFunctionSource("renderCraftAssistList"),
  /craft-assist-material-drag-preview[\s\S]*document\.body\.append/,
  "dragging a material should create a visible card ghost"
);
assert.match(
  extractFunctionSource("refreshCraftAssistEditorPrediction"),
  /allowUnknownDistribution:\s*true/,
  "the live editor should request outcome unions for ambiguous aggregate groups"
);
assert.match(
  extractFunctionSource("saveCraftAssistEditor"),
  /validateCraftAssistMaterialEntriesForSave\(\s*buildCraftAssistEditorRoleValidationMaterials\([\s\S]*openAlertModal/,
  "saving should show a modal when a role retains quantity without any item"
);
assert.match(
  extractFunctionSource("renderCraftAssistList"),
  /setCraftAssistEditorComplementaryRoleCount\(role,\s*rawValue\)/,
  "editing either role quantity should update the complementary role count"
);
assert.match(
  extractFunctionSource("renderCraftAssistList"),
  /actions\.classList\.toggle\("hidden",\s*placeholder\s*&&\s*!state\.craftAssistEditorOpen\)/,
  "empty editor roles should keep their quantity and add controls visible"
);
assert.match(
  extractFunctionSource("renderCraftAssistPanel"),
  /preserveEmptyRoles:\s*!!state\.craftAssistEditorOpen/,
  "panel rerenders should retain empty editor role shells"
);
assert.match(
  extractFunctionSource("refreshCraftAssistMaterialRanges"),
  /preserveEmptyRoles:\s*!!state\.craftAssistEditorOpen/,
  "wear-range refreshes should retain empty editor role shells"
);
assert.match(
  cssSource,
  /\.craft-assist-material-drag-preview\s*\{[\s\S]*position:\s*fixed;[\s\S]*pointer-events:\s*none;/,
  "material drag ghosts should stay visible without intercepting drop events"
);
assert.match(
  cssSource,
  /\.craft-assist-editor-role-btn\.active\s*\{[\s\S]*background:\s*transparent;/,
  "the selected role header should avoid a solid full-width highlight strip"
);
assert.match(
  cssSource,
  /\.craft-assist-editor-role-group\.active\s+\.craft-assist-role-tag\s*\{[\s\S]*border-color:/,
  "the selected role should emphasize its compact role tag"
);
assert.match(
  cssSource,
  /body\.theme-inkblue \.craft-assist-editor-modal \.craft-assist-editor-role-group\.active\s*\{[\s\S]*border-color:/,
  "the dark editor theme should keep the selected role group visibly outlined"
);
assert.doesNotMatch(
  cssSource,
  /\.craft-assist-editor-role-btn\.active\s*\{[^}]*background:\s*var\(--accent\)/,
  "the selected role header should not fill with the global accent color"
);
assert.match(
  appSource,
  /ui\.craftAssistTargetWear\.oninput\s*=\s*\(\)\s*=>\s*\{[\s\S]*state\.craftAssistTargetWear\s*=\s*null;[\s\S]*invalidateCraftAssistEditorPrediction\(\{refresh:\s*false\}\)/,
  "clearing target wear while typing should immediately blank and invalidate the prediction"
);

{
  const state = {
    craftAssistEditorSource: "database",
    craftAssistEditorSearchQuery: "不存在的材料XYZ",
    craftAssistEditorSearchResults: [{name: "stale database result"}],
    craftAssistEditorSearchLoading: true,
    craftAssistEditorSearchError: "stale error",
    craftAssistEditorSearchSeq: 7
  };
  const ui = {craftAssistEditorSearch: {value: "不存在的材料XYZ"}};
  let renderCount = 0;
  const context = {
    state,
    ui,
    renderCraftAssistEditor: () => { renderCount += 1; }
  };
  vm.runInNewContext(
    `${extractFunctionSource("setCraftAssistEditorSource")}; this.setCraftAssistEditorSource = setCraftAssistEditorSource;`,
    context,
    {filename: appPath}
  );

  context.setCraftAssistEditorSource("warehouse");
  assert.equal(state.craftAssistEditorSource, "warehouse");
  assert.equal(state.craftAssistEditorSearchQuery, "");
  assert.equal(Array.isArray(state.craftAssistEditorSearchResults), true);
  assert.equal(state.craftAssistEditorSearchResults.length, 0);
  assert.equal(state.craftAssistEditorSearchLoading, false);
  assert.equal(state.craftAssistEditorSearchError, "");
  assert.equal(state.craftAssistEditorSearchSeq, 8);
  assert.equal(ui.craftAssistEditorSearch.value, "");
  assert.equal(renderCount, 1);
}

assert.match(
  cssSource,
  /\.craft-assist-editor-card\s*\{[\s\S]*width:\s*min\((?:1[4-9]\d{2}|[2-9]\d{3})px,\s*calc\(100vw\s*-\s*\d+px\)\);[\s\S]*height:\s*min\(760px,\s*calc\(100vh\s*-\s*\d+px\)\);/m,
  "craft assist editor should be wider than the previous 1320px frame"
);

assert.match(
  cssSource,
  /\.craft-assist-editor-left\s+\.craft-assist-material-card-list\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,/m,
  "craft assist editor left role groups should keep at least four material cards in each row"
);
assert.match(
  cssSource,
  /\.craft-assist-editor-left\s+\.craft-assist-list\s*\{[\s\S]*grid-template-rows:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[\s\S]*align-content:\s*stretch;[\s\S]*overflow:\s*hidden;/m,
  "main and auxiliary role groups should split and fill the available editor height"
);
assert.match(
  cssSource,
  /\.craft-assist-editor-left\s+\.craft-assist-editor-role-group\s*\{[\s\S]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\);[\s\S]*overflow:\s*hidden;/m,
  "each role group should keep a stable internal card viewport"
);
assert.match(
  cssSource,
  /\.craft-assist-editor-left\s+\.craft-assist-editor-role-group\s+\.craft-assist-material-card-list\s*\{[\s\S]*overflow:\s*auto;/m,
  "material cards should scroll inside their fixed-height role group"
);

{
  const state = {
    craftAssistMainCount: 10,
    craftAssistAuxCount: 0,
    craftAssistMaterials: []
  };
  const context = {
    state,
    normalizeCraftAssistRole: (value) => String(value || "").trim() === "aux" ? "aux" : "main",
    craftAssistMaterialNames: (entry) => (Array.isArray(entry && entry.items) ? entry.items : [])
      .map((item) => String(item && item.name || "").trim())
      .filter(Boolean)
  };
  vm.runInNewContext(
    [
      extractFunctionSource("buildCraftAssistEditorRoleValidationMaterials"),
      extractFunctionSource("validateCraftAssistMaterialEntriesForSave"),
      "this.buildValidationMaterials = buildCraftAssistEditorRoleValidationMaterials;",
      "this.validateMaterials = validateCraftAssistMaterialEntriesForSave;"
    ].join("\n"),
    context,
    {filename: appPath}
  );

  let validationMaterials = context.buildValidationMaterials();
  let result = context.validateMaterials(validationMaterials);
  assert.equal(result.ok, false);
  assert.match(result.message, /主料有数量但未添加物品/);

  state.craftAssistMaterials = [{role: "main", count: 10, items: [{name: "AK-47 | Slate"}]}];
  state.craftAssistAuxCount = 2;
  validationMaterials = context.buildValidationMaterials();
  result = context.validateMaterials(validationMaterials);
  assert.equal(result.ok, false);
  assert.match(result.message, /辅料有数量但未添加物品/);

  state.craftAssistAuxCount = 0;
  validationMaterials = context.buildValidationMaterials();
  result = context.validateMaterials(validationMaterials);
  assert.equal(result.ok, true, "an empty zero-count role should remain saveable");
}

{
  const state = {
    craftAssistEditorOpen: true,
    craftAssistMaterialMode: "specific",
    craftAssistMainCount: 8,
    craftAssistAuxCount: 2,
    craftAssistPickRole: "main",
    craftAssistMaterials: [
      {id: "main-role", role: "main", count: 8, items: [{id: "a", name: "A"}, {id: "b", name: "B"}]},
      {id: "aux-role", role: "aux", count: 2, items: [{id: "c", name: "C"}]}
    ]
  };
  const context = {
    state,
    String,
    Number,
    Math,
    normalizeCraftAssistRole: (value) => String(value || "").trim() === "aux" ? "aux" : "main",
    normalizeCraftAssistCount: (value, fallback = 0) => {
      const numeric = Math.trunc(Number(value));
      return Math.max(0, Math.min(10, Number.isFinite(numeric) ? numeric : Number(fallback) || 0));
    },
    normalizeCraftAssistRoleCount: (value, role, fallback = 0) => {
      const numeric = Math.trunc(Number(value));
      const resolved = Number.isFinite(numeric) ? numeric : Number(fallback) || 0;
      return String(role || "") === "aux"
        ? Math.max(0, Math.min(9, resolved))
        : Math.max(1, Math.min(10, resolved));
    },
    craftAssistMaterialItems: (material) => (Array.isArray(material && material.items) ? material.items : [])
      .map((item) => ({...item})),
    coalesceCraftAssistMaterialRoleBuckets: (materials) => materials,
    makeCraftAssistUid: (prefix) => `${prefix}_new`,
    renderCraftAssistEditor() {},
    invalidateCraftAssistEditorPrediction() {}
  };
  vm.runInNewContext(
    [
      extractFunctionSource("createCraftAssistEditorRoleShell"),
      extractFunctionSource("setCraftAssistEditorComplementaryRoleCount"),
      extractFunctionSource("moveCraftAssistEditorMaterialItem"),
      "this.setRoleCount = setCraftAssistEditorComplementaryRoleCount;",
      "this.moveItem = moveCraftAssistEditorMaterialItem;"
    ].join("\n"),
    context,
    {filename: appPath}
  );

  let counts = context.setRoleCount("main", 7);
  assert.deepEqual({...counts}, {main_count: 7, aux_count: 3});
  assert.equal(state.craftAssistMaterials.find((entry) => entry.role === "main").count, 7);
  assert.equal(state.craftAssistMaterials.find((entry) => entry.role === "aux").count, 3);

  counts = context.setRoleCount("aux", 2);
  assert.deepEqual({...counts}, {main_count: 8, aux_count: 2});

  assert.equal(context.moveItem("c", "main"), true);
  let main = state.craftAssistMaterials.find((entry) => entry.role === "main");
  let aux = state.craftAssistMaterials.find((entry) => entry.role === "aux");
  assert.equal(main.count, 8);
  assert.equal(aux.count, 2);
  assert.equal(JSON.stringify(main.items.map((item) => item.id)), JSON.stringify(["a", "b", "c"]));
  assert.equal(JSON.stringify(aux.items.map((item) => item.id)), JSON.stringify([]));

  assert.equal(context.moveItem("c", "aux"), true);
  main = state.craftAssistMaterials.find((entry) => entry.role === "main");
  aux = state.craftAssistMaterials.find((entry) => entry.role === "aux");
  assert.equal(main.count, 8);
  assert.equal(aux.count, 2);
  assert.equal(JSON.stringify(main.items.map((item) => item.id)), JSON.stringify(["a", "b"]));
  assert.equal(JSON.stringify(aux.items.map((item) => item.id)), JSON.stringify(["c"]));
}

{
  const hiddenClasses = new Set(["hidden"]);
  const relativeWrap = {
    classList: {
      add: (...names) => names.forEach((name) => hiddenClasses.add(name)),
      remove: (...names) => names.forEach((name) => hiddenClasses.delete(name))
    }
  };
  const context = {
    Number,
    String,
    state: {
      craftAssistEditorSelectedOutcome: {
        minfloat: 0,
        maxfloat: 0.86,
        predicted_float: 0.85
      }
    },
    ui: {
      craftAssistOutcomeAbsoluteWear: {value: ""},
      craftAssistOutcomeRelativeWear: {value: ""},
      craftAssistOutcomeRelativeWrap: relativeWrap,
      craftAssistOutcomeError: {
        textContent: "",
        classList: {add() {}, remove() {}}
      },
      craftAssistOutcomeModalWearLabel: {textContent: ""},
      craftAssistOutcomeModalAbsoluteValue: {textContent: ""}
    },
    wearTextFull: (value) => String(value),
    getCraftAssistOutcomeWearLabel: () => "战痕累累",
    applyCraftAssistOutcomeTone() {}
  };
  vm.runInNewContext(
    [
      extractFunctionSource("sanitizeCraftAssistOutcomeWearDigits"),
      extractFunctionSource("resolveCraftAssistOutcomeDefaultWear"),
      extractFunctionSource("updateCraftAssistOutcomeConverter"),
      "this.sanitizeWearDigits = sanitizeCraftAssistOutcomeWearDigits;",
      "this.updateConverter = updateCraftAssistOutcomeConverter;"
    ].join("\n"),
    context,
    {filename: appPath}
  );

  assert.equal(context.sanitizeWearDigits("0.85x"), "85");
  context.updateConverter();
  assert.equal(hiddenClasses.has("hidden"), false);
  assert.equal(context.ui.craftAssistOutcomeRelativeWear.value, String(0.85 / 0.86));

  context.ui.craftAssistOutcomeAbsoluteWear.value = "0.50a";
  context.updateConverter();
  assert.equal(context.ui.craftAssistOutcomeAbsoluteWear.value, "50");
  assert.equal(context.ui.craftAssistOutcomeModalAbsoluteValue.textContent, "0.5");
  assert.equal(context.ui.craftAssistOutcomeRelativeWear.value, String(0.5 / 0.86));
}

async function verifyPredictionRequestPolicy() {
  const state = {
    craftAssistEditorOpen: true,
    craftAssistMaterialMode: "rarity_tag",
    craftAssistRarityTag: 2,
    craftAssistTargetWear: null,
    craftAssistTargetWearRaw: "",
    craftAssistMaterials: [],
    craftUseComponentItems: false,
    craftIncludeCooling: false,
    craftAssistApproachMode: false,
    craftAssistFastMode: false,
    craftAssistEditorPredictionKey: "",
    craftAssistEditorPredictionSeq: 0,
    craftAssistEditorPredictionLoading: false,
    craftAssistEditorPredictionResponse: null,
    craftAssistEditorPredictionError: "",
    craftAssistEditorSelectedOutcomeKey: "",
    craftAssistEditorSelectedOutcome: null
  };
  let apiCallCount = 0;
  const clearPrediction = () => {
    state.craftAssistEditorPredictionLoading = false;
    state.craftAssistEditorPredictionResponse = null;
    state.craftAssistEditorPredictionError = "";
  };
  const context = {
    state,
    resolveCraftAssistTargetWearPair: () => null,
    projectCraftAssistPersistedMaterialsFromState: (materials) => materials,
    getCraftAssistEditorBlockedIds: () => [],
    invalidateCraftAssistEditorPrediction: clearPrediction,
    setCraftAssistEditorPredictionFailure: (message) => {
      clearPrediction();
      state.craftAssistEditorPredictionError = String(message || "");
    },
    renderCraftAssistEditorPrediction: () => {},
    buildCraftAssistEditorParentGroups: () => [],
    calcCraftAssistMaterialTotalCount: (materials) => materials.reduce((sum, material) => sum + Number(material.count || 0), 0),
    buildCraftPredictorRequestFromDraft: (options) => ({
      ok: true,
      payload: {
        required_count: options.requiredCount,
        input_rarity: "军规级",
        groups: [{collection: "Fracture Case", count: 3}]
      }
    }),
    api: async () => {
      apiCallCount += 1;
      return {
        ok: true,
        target_relative_wear: null,
        outcomes: [{base_name: "AK-47 | Ice Coaled", probability: 0.3}]
      };
    }
  };
  vm.runInNewContext(
    `${extractFunctionSource("refreshCraftAssistEditorPrediction")}; this.refreshCraftAssistEditorPrediction = refreshCraftAssistEditorPrediction;`,
    context,
    {filename: appPath}
  );

  await context.refreshCraftAssistEditorPrediction({force: true});
  assert.equal(apiCallCount, 0, "rarity-tag mode should not send selection or outcome prediction requests");

  state.craftAssistMaterialMode = "specific";
  state.craftAssistMaterials = [{role: "main", count: 3, items: [{name: "AK-47 | Slate"}]}];
  state.craftAssistEditorPredictionError = "stale hint";
  await context.refreshCraftAssistEditorPrediction({force: true});
  assert.equal(apiCallCount, 1, "targetless specific mode should predict products and probabilities for partial materials");
  assert.equal(state.craftAssistEditorPredictionResponse && state.craftAssistEditorPredictionResponse.ok, true);
  assert.equal(state.craftAssistEditorPredictionError, "");
}

verifyPredictionRequestPolicy()
  .then(() => console.log("craftAssistPresetEditorUi tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
