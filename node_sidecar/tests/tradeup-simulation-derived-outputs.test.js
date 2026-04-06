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
    ui: {},
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

function test_adopt_tradeup_simulation_derived_primary_output_keeps_existing_primary_and_adds_aux_output_for_aux_material_collection() {
  const primaryOutput = createSimulationItem({
    markethashname: "USP-S | Cortex (Field-Tested)",
    basemarkethashname: "USP-S | Cortex",
    collection: "狂牙大行动收藏品",
    rarity: "受限"
  });
  const mainMaterial = createSimulationItem({
    markethashname: "Five-SeveN | 混沌点阵 (Field-Tested)",
    basemarkethashname: "Five-SeveN | 混沌点阵",
    collection: "狂牙大行动收藏品",
    rarity: "军规级"
  });
  const auxMaterial = createSimulationItem({
    markethashname: "MAC-10 | 脱轨 (Field-Tested)",
    basemarkethashname: "MAC-10 | 脱轨",
    collection: "2025 列车停放站收藏品",
    rarity: "军规级"
  });
  const app = loadSimulationFns({
    simulationWorkspacePreset: {
      id: "draft_dual_material_outputs",
      name: "双收藏品材料",
      primary_output: primaryOutput,
      aux_output: null,
      main_material: mainMaterial,
      aux_material: auxMaterial,
      cover_output: primaryOutput,
      active_anchor_item: auxMaterial,
      active_anchor_abs_wear: 0.222,
      output_rows: [],
      material_rows: [],
      rows: [],
      output_candidates: [primaryOutput],
      warnings: [],
      dirty: false
    }
  });

  const adopted = app.adoptTradeupSimulationDerivedPrimaryOutput({
    presetId: "draft_dual_material_outputs",
    candidates: [
      createSimulationItem({
        markethashname: "USP-S | Cortex (Field-Tested)",
        basemarkethashname: "USP-S | Cortex",
        collection: "狂牙大行动收藏品",
        rarity: "受限"
      }),
      createSimulationItem({
        markethashname: "P250 | 随便玩玩 (Field-Tested)",
        basemarkethashname: "P250 | 随便玩玩",
        collection: "2025 列车停放站收藏品",
        rarity: "受限"
      })
    ]
  });

  assert.equal(adopted, true);
  assert.equal(
    app.state.simulationWorkspacePreset.primary_output.basemarkethashname,
    "USP-S | Cortex",
    "adding an auxiliary material should preserve the existing primary output instead of replacing it with the auxiliary collection outcome"
  );
  assert.equal(
    app.state.simulationWorkspacePreset.aux_output.basemarkethashname,
    "P250 | 随便玩玩",
    "adding an auxiliary material should append the derived output from the auxiliary material collection into the left auxiliary output slot"
  );
  assert.equal(
    app.state.simulationWorkspacePreset.cover_output.basemarkethashname,
    "USP-S | Cortex",
    "adding an auxiliary material should keep the current cover output focused on the original primary output"
  );
}

function test_build_tradeup_simulation_derived_output_payload_tracks_primary_and_aux_collections_without_fixed_split() {
  const primaryOutput = createSimulationItem({
    markethashname: "USP-S | Cortex (Field-Tested)",
    basemarkethashname: "USP-S | Cortex",
    collection: "狂牙大行动收藏品",
    rarity: "受限",
    minfloat: 0.06,
    maxfloat: 0.8
  });
  const auxMaterial = createSimulationItem({
    markethashname: "MAC-10 | 脱轨 (Field-Tested)",
    basemarkethashname: "MAC-10 | 脱轨",
    collection: "2025 列车停放站收藏品",
    rarity: "军规级",
    minfloat: 0.05,
    maxfloat: 0.7
  });
  const app = loadSimulationFns({
    simulationWorkspacePreset: {
      id: "draft_payload_pairing",
      name: "主产物加辅料",
      primary_output: primaryOutput,
      aux_output: null,
      main_material: null,
      aux_material: auxMaterial,
      cover_output: primaryOutput,
      active_anchor_item: auxMaterial,
      active_anchor_abs_wear: 0.167,
      output_rows: [],
      material_rows: [],
      rows: [],
      output_candidates: [],
      warnings: [],
      dirty: false
    }
  });

  const payload = app.buildTradeupSimulationDerivedOutputPayload(app.state.simulationWorkspacePreset);

  assert.ok(payload, "adding an auxiliary material beside an existing primary output should still produce a predictor payload");
  assert.equal(payload.required_count, 10);
  assert.deepEqual(
    JSON.parse(JSON.stringify(payload.groups)),
    [
      {collection: "狂牙大行动收藏品", count: 1},
      {collection: "2025 列车停放站收藏品", count: 1}
    ],
    "adding an auxiliary material beside an existing primary output should track both collections as separate constraints without fabricating a fixed 5+5 split"
  );
}

function main() {
  test_adopt_tradeup_simulation_derived_primary_output_keeps_existing_primary_and_adds_aux_output_for_aux_material_collection();
  test_build_tradeup_simulation_derived_output_payload_tracks_primary_and_aux_collections_without_fixed_split();
  console.log("tradeup-simulation-derived-outputs tests passed");
}

main();
