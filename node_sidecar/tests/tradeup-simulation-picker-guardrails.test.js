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

function createLocalStorageStub() {
  const bucket = new Map();
  return {
    getItem(key) {
      return bucket.has(key) ? bucket.get(key) : null;
    },
    setItem(key, value) {
      bucket.set(String(key), String(value));
    },
    removeItem(key) {
      bucket.delete(String(key));
    }
  };
}

function loadSimulationFns(initialState = {}) {
  const source = [
    extractConst("TRADEUP_SIMULATION_PRESETS_KEY"),
    extractBlock("function makeTradeupSimulationUid(", "function renderCraftPage(")
  ].join("\n");
  const localStorage = createLocalStorageStub();
  const context = {
    Math: Object.create(Math),
    Number,
    String,
    Array,
    Object,
    JSON,
    Date,
    Map,
    Set,
    console,
    localStorage,
    ui: {
      simulationPickerSearchResults: null
    },
    renderSimulationPage() {},
    showErrorToast() {},
    setSummary() {},
    escapeHtml(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    },
    escapeHtmlAttribute(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    },
    deepCopyPlain(value) {
      return value == null ? value : JSON.parse(JSON.stringify(value));
    },
    requestAnimationFrame(callback) {
      if (typeof callback === "function") callback();
      return 1;
    },
    state: {
      simulationViewMode: "workspace",
      simulationOutputRole: "primary_output",
      simulationMaterialRole: "main_material",
      simulationPickerOpen: true,
      simulationPickerMode: "",
      simulationPickerTitle: "",
      simulationPickerQuery: "",
      simulationPickerResults: [],
      simulationPickerError: "",
      simulationSearchLoading: false,
      simulationSearchSeq: 0,
      simulationPresets: [],
      simulationActivePresetId: "",
      simulationWorkspacePreset: null,
      simulationWorkspaceSourcePresetId: "",
      ...initialState
    },
    api() {
      return Promise.resolve({ok: true, presets: []});
    }
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function createSimulationItem({
  markethashname,
  basemarkethashname,
  collection = "猎杀号收藏品",
  rarity = "受限",
  minfloat = 0,
  maxfloat = 1
}) {
  return {
    markethashname,
    basemarkethashname,
    basename: basemarkethashname,
    name: markethashname,
    collection,
    rarity,
    minfloat,
    maxfloat
  };
}

function createSearchResultsStub() {
  return {
    innerHTML: "",
    querySelectorAll() {
      return [];
    }
  };
}

function test_render_tradeup_simulation_picker_results_marks_mismatched_rarity_candidates_disabled_with_footer_warning() {
  const lockedItem = createSimulationItem({
    markethashname: "Five-SeveN | 混沌点阵 (Field-Tested)",
    basemarkethashname: "Five-SeveN | 混沌点阵",
    rarity: "军规级",
    collection: "狂牙大行动收藏品"
  });
  const app = loadSimulationFns({
    simulationWorkspacePreset: {
      id: "preset_rarity_lock",
      primary_output: createSimulationItem({
        markethashname: "USP-S | Cortex (Field-Tested)",
        basemarkethashname: "USP-S | Cortex",
        rarity: "受限",
        collection: "狂牙大行动收藏品"
      }),
      main_material: lockedItem,
      aux_material: null,
      cover_output: createSimulationItem({
        markethashname: "USP-S | Cortex (Field-Tested)",
        basemarkethashname: "USP-S | Cortex",
        rarity: "受限",
        collection: "狂牙大行动收藏品"
      }),
      active_anchor_item: lockedItem,
      active_anchor_abs_wear: 0.18,
      output_rows: [],
      material_rows: [],
      output_candidates: []
    },
    simulationPickerMode: "aux_material",
    simulationPickerQuery: "p90",
    simulationPickerResults: [createSimulationItem({
      markethashname: "P90 | 潜管作品 (Factory New)",
      basemarkethashname: "P90 | 潜管作品",
      rarity: "工业级",
      collection: "2025 列车停放站收藏品"
    })]
  });
  app.preferredRowSkinImageUrl = () => "";
  app.ui.simulationPickerSearchResults = createSearchResultsStub();

  app.renderTradeupSimulationPickerResults();

  assert.equal(
    app.ui.simulationPickerSearchResults.innerHTML.includes("simulation-picker-item is-disabled"),
    true,
    "mismatched-rarity picker candidates should render disabled before the user clicks them"
  );
  assert.equal(
    app.ui.simulationPickerSearchResults.innerHTML.includes('disabled aria-disabled="true"'),
    true,
    "mismatched-rarity picker candidates should carry the native disabled attribute"
  );
  assert.equal(
    app.ui.simulationPickerSearchResults.innerHTML.includes("单配方需同一稀有度：当前为 军规级，不能添加 工业级"),
    true,
    "mismatched-rarity picker candidates should surface the full rarity-lock warning inline"
  );
  assert.equal(
    app.ui.simulationPickerSearchResults.innerHTML.includes("simulation-picker-item-warning"),
    true,
    "blocked picker candidates should pull the warning into the card footer instead of squeezing it inside the artwork mask"
  );
}

function test_render_tradeup_simulation_picker_results_marks_limited_collection_candidates_disabled_with_footer_warning() {
  const app = loadSimulationFns({
    simulationPickerMode: "main_material",
    simulationPickerQuery: "热处理",
    simulationPickerResults: [{
      ...createSimulationItem({
        markethashname: "Desert Eagle | Heat Treated (Factory New)",
        basemarkethashname: "Desert Eagle | Heat Treated",
        rarity: "保密",
        collection: "限量版物品"
      }),
      is_tradeup_restricted: true,
      tradeup_restriction_reason: "limited_collection"
    }]
  });
  app.preferredRowSkinImageUrl = () => "";
  app.ui.simulationPickerSearchResults = createSearchResultsStub();

  app.renderTradeupSimulationPickerResults();

  assert.equal(
    app.ui.simulationPickerSearchResults.innerHTML.includes("simulation-picker-item is-disabled"),
    true,
    "limited-edition collection candidates should stay disabled in the picker"
  );
  assert.equal(
    app.ui.simulationPickerSearchResults.innerHTML.includes("限量版物品不能加入炼金"),
    true,
    "limited-edition collection candidates should show the alchemy restriction warning inline"
  );
  assert.equal(
    app.ui.simulationPickerSearchResults.innerHTML.includes("simulation-picker-item-warning"),
    true,
    "limited-edition collection candidates should also render the warning in the footer area"
  );
}

function main() {
  test_render_tradeup_simulation_picker_results_marks_mismatched_rarity_candidates_disabled_with_footer_warning();
  test_render_tradeup_simulation_picker_results_marks_limited_collection_candidates_disabled_with_footer_warning();
  console.log("tradeup-simulation-picker-guardrails tests passed");
}

main();
