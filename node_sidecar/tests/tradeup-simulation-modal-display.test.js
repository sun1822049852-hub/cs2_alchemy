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
    extractConst("TRADEUP_SIMULATION_WEAR_DECIMALS"),
    extractConst("TRADEUP_SIMULATION_MODAL_WEAR_DECIMALS"),
    extractBlock("function makeTradeupSimulationUid(", "function renderCraftPage(")
  ].join("\n");
  const localStorage = createLocalStorageStub();
  const context = {
    Math,
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
      simulationCardModal: null,
      simulationCardModalTitle: null,
      simulationCardModalBody: null,
      simulationCardModalField: null,
      simulationCardModalWearInput: null,
      simulationCardModalWearHint: null,
      simulationCardModalReadonlyNote: null,
      simulationCardModalSaveBtn: null,
      simulationCardModalCancelBtn: null
    },
    renderSimulationPage() {},
    setSummary() {},
    showErrorToast() {},
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
      simulationPresets: [],
      simulationActivePresetId: "",
      simulationWorkspacePreset: null,
      simulationWorkspaceSourcePresetId: "",
      simulationModalOpen: false,
      simulationModalMode: "",
      simulationModalPresetId: "",
      simulationModalSlot: "",
      simulationLoading: false,
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
    base_name: basemarkethashname,
    name: markethashname,
    collection,
    rarity,
    minfloat,
    maxfloat
  };
}

function createClassList(initial = []) {
  const set = new Set(initial);
  return {
    add(...names) {
      for (const name of names) set.add(String(name));
    },
    remove(...names) {
      for (const name of names) set.delete(String(name));
    },
    toggle(name, force) {
      const key = String(name);
      if (force === undefined) {
        if (set.has(key)) {
          set.delete(key);
          return false;
        }
        set.add(key);
        return true;
      }
      if (force) set.add(key);
      else set.delete(key);
      return !!force;
    },
    contains(name) {
      return set.has(String(name));
    }
  };
}

function test_render_tradeup_simulation_card_modal_hides_preview_role_tags_and_uses_four_decimal_lower_wear_display() {
  const mainMaterial = createSimulationItem({
    markethashname: "Five-SeveN | 混沌点阵 (Field-Tested)",
    basemarkethashname: "Five-SeveN | 混沌点阵",
    collection: "狂牙大行动收藏品",
    rarity: "军规级",
    minfloat: 0.02,
    maxfloat: 0.78
  });
  const preset = {
    id: "preset_modal_render",
    name: "弹窗渲染",
    primary_output: createSimulationItem({
      markethashname: "USP-S | Cortex (Field-Tested)",
      basemarkethashname: "USP-S | Cortex",
      collection: "狂牙大行动收藏品"
    }),
    aux_output: null,
    main_material: mainMaterial,
    aux_material: null,
    cover_output: createSimulationItem({
      markethashname: "USP-S | Cortex (Field-Tested)",
      basemarkethashname: "USP-S | Cortex",
      collection: "狂牙大行动收藏品"
    }),
    active_anchor_item: mainMaterial,
    active_anchor_abs_wear: 0.33,
    output_rows: [],
    material_rows: []
  };
  const app = loadSimulationFns({
    simulationPresets: [preset],
    simulationActivePresetId: "preset_modal_render",
    simulationWorkspaceSourcePresetId: "preset_modal_render",
    simulationWorkspacePreset: {
      ...preset,
      dirty: false
    }
  });
  app.ui.simulationCardModal = {classList: createClassList(["hidden"])};
  app.ui.simulationCardModalTitle = {textContent: ""};
  app.ui.simulationCardModalBody = {innerHTML: ""};
  app.ui.simulationCardModalField = {classList: createClassList(["hidden"])};
  app.ui.simulationCardModalWearInput = {disabled: false, value: ""};
  app.ui.simulationCardModalWearHint = {textContent: ""};
  app.ui.simulationCardModalReadonlyNote = {textContent: "", classList: createClassList(["hidden"])};
  app.ui.simulationCardModalSaveBtn = {disabled: false, textContent: "", classList: createClassList(["hidden"])};
  app.ui.simulationCardModalCancelBtn = {textContent: ""};
  app.preferredRowSkinImageUrl = () => "";

  app.openTradeupSimulationItemModal({
    presetId: "preset_modal_render",
    slot: "main_material",
    itemType: "material",
    item: mainMaterial,
    mode: "edit"
  });

  assert.doesNotThrow(() => app.renderTradeupSimulationCardModal());
  assert.equal(app.ui.simulationCardModal.classList.contains("hidden"), false);
  assert.doesNotMatch(
    app.ui.simulationCardModalBody.innerHTML,
    /simulation-card-tag-row|simulation-card-role|simulation-card-chip/,
    "simulation card modal should remove the old role and wear-range tag row from the preview content"
  );
  assert.match(
    app.ui.simulationCardModalBody.innerHTML,
    /当前绝对磨损<\/span><strong>0\.3300<\/strong>/,
    "simulation card modal should show the lower absolute wear summary with four visible decimals"
  );
  assert.equal(
    app.ui.simulationCardModalWearInput.value,
    "0.3300",
    "simulation card modal input should show four visible decimals without changing internal precision"
  );
  assert.equal(
    app.ui.simulationCardModalWearHint.textContent,
    "允许范围：0.0200 - 0.7800",
    "simulation card modal wear hint should show the allowed range with four visible decimals"
  );
}

function test_format_tradeup_simulation_modal_wear_uses_four_decimals() {
  const app = loadSimulationFns();

  assert.equal(typeof app.formatTradeupSimulationModalWear, "function");
  assert.equal(
    app.formatTradeupSimulationModalWear(0.123456789),
    "0.1235",
    "simulation card modal wear formatting should clamp visible decimals to four"
  );
  assert.equal(
    app.formatTradeupSimulationModalWear("not-a-number"),
    "-",
    "simulation card modal wear formatting should preserve the invalid fallback"
  );
}

function main() {
  test_render_tradeup_simulation_card_modal_hides_preview_role_tags_and_uses_four_decimal_lower_wear_display();
  test_format_tradeup_simulation_modal_wear_uses_four_decimals();
  console.log("tradeup-simulation-modal-display tests passed");
}

main();
