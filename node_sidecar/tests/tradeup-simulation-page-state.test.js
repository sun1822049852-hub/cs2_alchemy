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
    extractConst("TRADEUP_SIMULATION_BELOW_TARGET_SAFE_OFFSET"),
    extractBlock("function makeTradeupSimulationUid(", "function renderCraftPage(")
  ].join("\n");
  const localStorage = createLocalStorageStub();
  const apiCalls = [];
  const errorToasts = [];
  const math = Object.create(Math);
  const context = {
    Math: math,
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
    apiCalls,
    errorToasts,
    ui: {
      craftAssistPresetModal: null,
      craftAssistPresetModalInput: null,
      craftAssistPresetModalTitle: null,
      craftAssistPresetModalClose: null,
      craftAssistPresetModalSaveBtn: null,
      craftAssistPresetModalCancelBtn: null,
      simulationPickerModal: null,
      simulationPickerTitle: null,
      simulationPickerRoleBadge: null,
      simulationPickerHint: null,
      simulationPickerMeta: null,
      simulationPickerSearchInput: null,
      simulationPickerSearchBtn: null,
      simulationPickerSearchResults: null
    },
    renderSimulationPage() {},
    guardGuestAction() {
      return true;
    },
    showErrorToast(message) {
      errorToasts.push(String(message || "").trim());
    },
    setSummary(message, options = {}) {
      context.lastSummary = {
        text: String(message || "").trim(),
        isError: options && options.isError === true
      };
    },
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
      simulationPickerOpen: false,
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
      craftAssistPresets: [],
      simulationModalOpen: false,
      simulationModalMode: "",
      simulationModalPresetId: "",
      simulationModalSlot: "",
      simulationPersisting: false,
      ...initialState
    },
    api(path, options = {}) {
      apiCalls.push({path, options});
      if (path === "/api/ui-state/tradeup-simulation-presets" && (!options.method || options.method === "GET")) {
        return Promise.resolve({ok: true, presets: []});
      }
      return Promise.resolve({ok: true, presets: []});
    },
    parseOptionalWear01(value) {
      const raw = String(value == null ? "" : value).trim();
      if (!raw) return null;
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      return Math.max(0, Math.min(1, n));
    },
    clampWear01(value, fallback = 0) {
      const n = Number(value);
      if (!Number.isFinite(n)) return Math.max(0, Math.min(1, Number(fallback) || 0));
      return Math.max(0, Math.min(1, n));
    },
    resolveCraftAssistTargetWearPair(targetWearValue, targetWearRawValue) {
      const rawText = String(targetWearRawValue == null ? "" : targetWearRawValue).trim();
      if (rawText) {
        const parsedRaw = Number(rawText);
        if (!Number.isFinite(parsedRaw) || parsedRaw < 0 || parsedRaw > 1) return null;
        return {
          target_wear_raw: rawText,
          target_wear: Math.fround(parsedRaw)
        };
      }
      const parsedTargetWear = context.parseOptionalWear01(targetWearValue);
      if (parsedTargetWear == null) return null;
      return {
        target_wear_raw: String(parsedTargetWear),
        target_wear: Math.fround(parsedTargetWear)
      };
    },
    normalizeCraftAssistDirection(role) {
      return String(role || "").trim() === "aux" ? "aux" : "main";
    },
    makeCraftAssistUid(prefix = "assist") {
      return `${prefix}_test`;
    },
    sanitizeCraftAssistPresetPayload(payload) {
      const source = payload && typeof payload === "object" ? payload : {};
      const rawText = String(source.target_wear_raw == null ? "" : source.target_wear_raw).trim();
      const rawValue = rawText ? Number(rawText) : Number(source.target_wear);
      if (!Number.isFinite(rawValue) || rawValue < 0 || rawValue > 1) return null;
      const name = String(source.name || "").trim();
      if (!name) return null;
      const materials = Array.isArray(source.materials) ? JSON.parse(JSON.stringify(source.materials)) : [];
      if (!materials.length) return null;
      return {
        ...source,
        name,
        target_wear: Math.fround(rawValue),
        target_wear_raw: rawText || String(rawValue),
        materials
      };
    },
    normalizeCraftAssistPresetList(values) {
      return (Array.isArray(values) ? values : [])
        .map((entry) => context.sanitizeCraftAssistPresetPayload(entry))
        .filter(Boolean);
    },
    saveCraftAssistPresetsToStorage() {
      context.craftAssistPresetSaveCount = (context.craftAssistPresetSaveCount || 0) + 1;
    }
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  context.localStorageStub = localStorage;
  return context;
}

async function flushMicrotasks(count = 4) {
  for (let i = 0; i < count; i += 1) {
    await Promise.resolve();
  }
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

function test_normalize_tradeup_simulation_preset_list_preserves_dual_slot_shape() {
  const app = loadSimulationFns();
  assert.equal(typeof app.normalizeTradeupSimulationPresetList, "function");

  const primaryOutput = createSimulationItem({
    markethashname: "USP-S | Cortex (Minimal Wear)",
    basemarkethashname: "USP-S | Cortex",
    minfloat: 0.06,
    maxfloat: 0.8
  });
  const auxOutput = createSimulationItem({
    markethashname: "P250 | 随便玩玩 (Field-Tested)",
    basemarkethashname: "P250 | 随便玩玩",
    minfloat: 0,
    maxfloat: 0.55
  });
  const mainMaterial = createSimulationItem({
    markethashname: "Five-SeveN | 混沌点阵 (Minimal Wear)",
    basemarkethashname: "Five-SeveN | 混沌点阵",
    rarity: "军规级"
  });
  const auxMaterial = createSimulationItem({
    markethashname: "MAG-7 | 失衡 (Field-Tested)",
    basemarkethashname: "MAG-7 | 失衡",
    rarity: "军规级"
  });

  const presets = app.normalizeTradeupSimulationPresetList([{
    id: "preset_1",
    name: "  猎杀号双栏样例  ",
    primary_output: primaryOutput,
    aux_output: auxOutput,
    main_material: mainMaterial,
    aux_material: auxMaterial,
    cover_output: primaryOutput,
    active_anchor_item: auxMaterial,
    active_anchor_abs_wear: 0.1417,
    output_rows: [],
    material_rows: [],
    output_candidates: []
  }]);

  assert.equal(presets.length, 1);
  assert.equal(presets[0].name, "猎杀号双栏样例");
  assert.equal(presets[0].primary_output.basemarkethashname, "USP-S | Cortex");
  assert.equal(presets[0].aux_output.basemarkethashname, "P250 | 随便玩玩");
  assert.equal(presets[0].main_material.basemarkethashname, "Five-SeveN | 混沌点阵");
  assert.equal(presets[0].aux_material.basemarkethashname, "MAG-7 | 失衡");
  assert.equal(presets[0].cover_output.basemarkethashname, "USP-S | Cortex");
  assert.equal(presets[0].active_anchor_item.basemarkethashname, "MAG-7 | 失衡");
  assert.equal(presets[0].active_anchor_abs_wear, 0.1417);
}

function test_normalize_tradeup_simulation_preset_list_migrates_legacy_target_into_primary_cover() {
  const app = loadSimulationFns();

  const presets = app.normalizeTradeupSimulationPresetList([{
    id: "preset_legacy",
    target_item: createSimulationItem({
      markethashname: "AK-47 | Slate (Minimal Wear)",
      basemarkethashname: "AK-47 | Slate"
    }),
    active_driver_markethashname: "Desert Eagle | Trigger Discipline (Minimal Wear)",
    active_driver_item_key: "Desert Eagle | Trigger Discipline",
    active_driver_abs_wear: 0.1284
  }]);

  assert.equal(presets.length, 1);
  assert.equal(presets[0].primary_output.basemarkethashname, "AK-47 | Slate");
  assert.equal(presets[0].cover_output.basemarkethashname, "AK-47 | Slate");
  assert.equal(presets[0].active_anchor_item.basemarkethashname, "Desert Eagle | Trigger Discipline");
  assert.equal(presets[0].active_anchor_abs_wear, 0.1284);
}

function test_normalize_tradeup_simulation_preset_list_drops_restricted_output_presets() {
  const app = loadSimulationFns();

  const presets = app.normalizeTradeupSimulationPresetList([{
    id: "preset_limited_output",
    primary_output: {
      ...createSimulationItem({
        markethashname: "Desert Eagle | Heat Treated (Factory New)",
        basemarkethashname: "Desert Eagle | Heat Treated",
        rarity: "保密",
        collection: "限量版物品"
      }),
      is_tradeup_restricted: true,
      tradeup_restriction_reason: "limited_collection"
    },
    cover_output: {
      ...createSimulationItem({
        markethashname: "Desert Eagle | Heat Treated (Factory New)",
        basemarkethashname: "Desert Eagle | Heat Treated",
        rarity: "保密",
        collection: "限量版物品"
      }),
      is_tradeup_restricted: true,
      tradeup_restriction_reason: "limited_collection"
    }
  }]);

  assert.equal(presets.length, 0);
}

function test_normalize_tradeup_simulation_preset_list_drops_lowest_collection_output_presets() {
  const app = loadSimulationFns();

  const presets = app.normalizeTradeupSimulationPresetList([{
    id: "preset_lowest_output",
    primary_output: {
      ...createSimulationItem({
        markethashname: "XM1014 | 跑跑跑 (Factory New)",
        basemarkethashname: "XM1014 | 跑跑跑",
        rarity: "工业级",
        collection: "2025 列车停放站收藏品"
      }),
      collection_lowest_rarity: "工业级",
      is_collection_lowest_rarity: true
    },
    cover_output: {
      ...createSimulationItem({
        markethashname: "XM1014 | 跑跑跑 (Factory New)",
        basemarkethashname: "XM1014 | 跑跑跑",
        rarity: "工业级",
        collection: "2025 列车停放站收藏品"
      }),
      collection_lowest_rarity: "工业级",
      is_collection_lowest_rarity: true
    }
  }]);

  assert.equal(presets.length, 0);
}

async function test_save_tradeup_simulation_presets_to_storage_writes_new_slot_shape() {
  const app = loadSimulationFns({
    simulationPresets: [{
      id: "preset_1",
      name: "猎杀号样例",
      primary_output: createSimulationItem({
        markethashname: "USP-S | Cortex (Minimal Wear)",
        basemarkethashname: "USP-S | Cortex"
      }),
      cover_output: createSimulationItem({
        markethashname: "USP-S | Cortex (Minimal Wear)",
        basemarkethashname: "USP-S | Cortex"
      }),
      active_anchor_item: createSimulationItem({
        markethashname: "Five-SeveN | 混沌点阵 (Minimal Wear)",
        basemarkethashname: "Five-SeveN | 混沌点阵",
        rarity: "军规级"
      }),
      active_anchor_abs_wear: 0.1417,
      output_rows: [],
      material_rows: [],
      output_candidates: []
    }]
  });

  app.saveTradeupSimulationPresetsToStorage();
  await flushMicrotasks();

  const raw = app.localStorageStub.getItem("tradeup_simulation_presets_v1");
  assert.ok(raw, "expected simulation presets to be stored locally");
  const stored = JSON.parse(raw);
  assert.equal(stored[0].primary_output.basemarkethashname, "USP-S | Cortex");
  assert.equal(stored[0].cover_output.basemarkethashname, "USP-S | Cortex");
  assert.equal(stored[0].active_anchor_item.basemarkethashname, "Five-SeveN | 混沌点阵");
  assert.equal(app.apiCalls[0].path, "/api/ui-state/tradeup-simulation-presets");
}

function test_open_blank_tradeup_simulation_workspace_draft_starts_with_empty_four_slots() {
  const app = loadSimulationFns({
    simulationViewMode: "saved",
    simulationPresets: [{
      id: "preset_1",
      name: "A",
      primary_output: createSimulationItem({
        markethashname: "USP-S | Cortex (Minimal Wear)",
        basemarkethashname: "USP-S | Cortex"
      }),
      cover_output: createSimulationItem({
        markethashname: "USP-S | Cortex (Minimal Wear)",
        basemarkethashname: "USP-S | Cortex"
      })
    }]
  });

  const draft = app.openBlankTradeupSimulationWorkspaceDraft();

  assert.ok(draft, "expected blank workspace draft");
  assert.equal(app.state.simulationViewMode, "workspace");
  assert.equal(app.state.simulationWorkspaceSourcePresetId, "");
  assert.equal(app.state.simulationWorkspacePreset.primary_output, null);
  assert.equal(app.state.simulationWorkspacePreset.aux_output, null);
  assert.equal(app.state.simulationWorkspacePreset.main_material, null);
  assert.equal(app.state.simulationWorkspacePreset.aux_material, null);
  assert.equal(app.state.simulationWorkspacePreset.cover_output, null);
}

function test_open_tradeup_simulation_workspace_draft_reuses_existing_unsaved_draft() {
  const primary = createSimulationItem({
    markethashname: "USP-S | Cortex (Minimal Wear)",
    basemarkethashname: "USP-S | Cortex"
  });
  const app = loadSimulationFns({
    simulationViewMode: "saved",
    simulationWorkspaceSourcePresetId: "preset_draft",
    simulationWorkspacePreset: {
      id: "draft_keep",
      name: "未保存草稿",
      primary_output: primary,
      aux_output: null,
      main_material: null,
      aux_material: null,
      cover_output: primary,
      active_anchor_item: primary,
      active_anchor_abs_wear: 0.118,
      output_rows: [],
      material_rows: [],
      output_candidates: [],
      dirty: true
    }
  });

  const draft = app.openTradeupSimulationWorkspaceDraft();

  assert.ok(draft, "expected workspace draft to reopen");
  assert.equal(app.state.simulationViewMode, "workspace");
  assert.equal(app.state.simulationWorkspaceSourcePresetId, "preset_draft");
  assert.equal(app.state.simulationWorkspacePreset.id, "draft_keep");
  assert.equal(app.state.simulationWorkspacePreset.primary_output.basemarkethashname, "USP-S | Cortex");
  assert.equal(app.state.simulationWorkspacePreset.dirty, true);
}

function test_open_tradeup_simulation_workspace_draft_strips_restricted_items_from_existing_unsaved_draft() {
  const primary = createSimulationItem({
    markethashname: "USP-S | Cortex (Minimal Wear)",
    basemarkethashname: "USP-S | Cortex"
  });
  const limitedMaterial = {
    ...createSimulationItem({
      markethashname: "Desert Eagle | Heat Treated (Factory New)",
      basemarkethashname: "Desert Eagle | Heat Treated",
      rarity: "保密",
      collection: "限量版物品"
    }),
    is_tradeup_restricted: true,
    tradeup_restriction_reason: "limited_collection"
  };
  const app = loadSimulationFns({
    simulationViewMode: "saved",
    simulationWorkspaceSourcePresetId: "preset_draft",
    simulationWorkspacePreset: {
      id: "draft_limited",
      name: "旧草稿",
      primary_output: primary,
      aux_output: null,
      main_material: limitedMaterial,
      aux_material: null,
      cover_output: primary,
      active_anchor_item: limitedMaterial,
      active_anchor_abs_wear: 0.118,
      output_rows: [{id: "stale-output"}],
      material_rows: [{id: "stale-material"}],
      output_candidates: [{markethashname: "stale"}],
      warnings: ["stale warning"],
      dirty: true
    }
  });

  const draft = app.openTradeupSimulationWorkspaceDraft();

  assert.ok(draft, "expected workspace draft to reopen");
  assert.equal(app.state.simulationWorkspacePreset.main_material, null);
  assert.equal(app.state.simulationWorkspacePreset.active_anchor_item.basemarkethashname, "USP-S | Cortex");
  assert.deepEqual(app.state.simulationWorkspacePreset.output_rows, []);
  assert.deepEqual(app.state.simulationWorkspacePreset.material_rows, []);
  assert.deepEqual(app.state.simulationWorkspacePreset.output_candidates, []);
}

function test_set_tradeup_simulation_active_preset_loads_workspace_draft_without_mutating_saved_entry() {
  const primary = createSimulationItem({
    markethashname: "USP-S | Cortex (Minimal Wear)",
    basemarkethashname: "USP-S | Cortex"
  });
  const app = loadSimulationFns({
    simulationViewMode: "saved",
    simulationPresets: [{
      id: "preset_1",
      name: "猎杀号样例",
      primary_output: primary,
      cover_output: primary,
      active_anchor_item: primary,
      active_anchor_abs_wear: 0.118,
      output_rows: [],
      material_rows: [],
      output_candidates: []
    }],
    simulationActivePresetId: "preset_1"
  });

  const draft = app.setTradeupSimulationActivePreset("preset_1");
  assert.ok(draft, "expected saved preset to open inside workspace");
  assert.equal(app.state.simulationViewMode, "workspace");
  assert.equal(app.state.simulationWorkspaceSourcePresetId, "preset_1");
  assert.notEqual(app.state.simulationWorkspacePreset, app.state.simulationPresets[0]);

  const updated = app.applyTradeupSimulationSlotSelection({
    presetId: "preset_1",
    slot: "aux_material",
    item: createSimulationItem({
      markethashname: "MAG-7 | 失衡 (Field-Tested)",
      basemarkethashname: "MAG-7 | 失衡",
      rarity: "军规级"
    }),
    absoluteWear: 0.1417
  });

  assert.equal(updated, true);
  assert.equal(app.state.simulationWorkspacePreset.aux_material.basemarkethashname, "MAG-7 | 失衡");
  assert.equal(app.state.simulationWorkspacePreset.cover_output.basemarkethashname, "USP-S | Cortex");
  assert.equal(app.state.simulationWorkspacePreset.active_anchor_item.basemarkethashname, "MAG-7 | 失衡");
  assert.equal(app.state.simulationWorkspacePreset.active_anchor_abs_wear, 0.1417);
  assert.equal(app.state.simulationWorkspacePreset.dirty, true);
  assert.equal(app.state.simulationPresets[0].cover_output.basemarkethashname, "USP-S | Cortex");
  assert.equal(app.state.simulationPresets[0].active_anchor_abs_wear, 0.118);
}

async function test_persist_tradeup_simulation_presets_saves_workspace_draft_into_saved_list() {
  const primary = createSimulationItem({
    markethashname: "USP-S | Cortex (Minimal Wear)",
    basemarkethashname: "USP-S | Cortex"
  });
  const app = loadSimulationFns({
    simulationViewMode: "workspace",
    simulationPresets: []
  });

  app.state.simulationWorkspacePreset = {
    id: "draft_1",
    name: "猎杀号样例",
    primary_output: primary,
    cover_output: primary,
    main_material: createSimulationItem({
      markethashname: "Five-SeveN | 混沌点阵 (Minimal Wear)",
      basemarkethashname: "Five-SeveN | 混沌点阵",
      rarity: "军规级"
    }),
    active_anchor_item: primary,
    active_anchor_abs_wear: 0.118,
    output_rows: [],
    material_rows: [],
    output_candidates: [],
    warnings: [],
    dirty: true,
    created_at: 100,
    updated_at: 100
  };

  const saved = await app.persistTradeupSimulationPresets({clearDirty: true});
  await flushMicrotasks();

  assert.equal(saved, true);
  assert.equal(app.state.simulationPresets.length, 1);
  assert.equal(app.state.simulationWorkspaceSourcePresetId, app.state.simulationPresets[0].id);
  assert.equal(app.state.simulationWorkspacePreset.dirty, false);
  assert.equal(app.state.simulationPresets[0].cover_output.basemarkethashname, "USP-S | Cortex");
  assert.equal(app.apiCalls[app.apiCalls.length - 1].path, "/api/ui-state/tradeup-simulation-presets");
}

async function test_persist_tradeup_simulation_presets_strips_restricted_materials_before_saving() {
  const primary = createSimulationItem({
    markethashname: "USP-S | Cortex (Minimal Wear)",
    basemarkethashname: "USP-S | Cortex"
  });
  const limitedMaterial = {
    ...createSimulationItem({
      markethashname: "Desert Eagle | Heat Treated (Factory New)",
      basemarkethashname: "Desert Eagle | Heat Treated",
      rarity: "保密",
      collection: "限量版物品"
    }),
    is_tradeup_restriction: true,
    is_tradeup_restricted: true,
    tradeup_restriction_reason: "limited_collection"
  };
  const app = loadSimulationFns({
    simulationViewMode: "workspace",
    simulationPresets: []
  });

  app.state.simulationWorkspacePreset = {
    id: "draft_limited_save",
    name: "限量版落库净化",
    primary_output: primary,
    cover_output: primary,
    main_material: limitedMaterial,
    active_anchor_item: limitedMaterial,
    active_anchor_abs_wear: 0.22,
    output_rows: [{id: "stale-output"}],
    material_rows: [{id: "stale-material"}],
    output_candidates: [{markethashname: "stale"}],
    warnings: ["stale warning"],
    dirty: true,
    created_at: 100,
    updated_at: 100
  };

  const saved = await app.persistTradeupSimulationPresets({clearDirty: true});
  await flushMicrotasks();

  assert.equal(saved, true);
  assert.equal(app.state.simulationPresets.length, 1);
  assert.equal(app.state.simulationPresets[0].main_material, null);
  assert.equal(app.state.simulationWorkspacePreset.main_material, null);
  assert.equal(app.state.simulationWorkspacePreset.active_anchor_item.basemarkethashname, "USP-S | Cortex");
  assert.deepEqual(app.state.simulationPresets[0].output_rows, []);
  assert.deepEqual(app.state.simulationPresets[0].material_rows, []);
  assert.deepEqual(app.state.simulationPresets[0].output_candidates, []);
}

async function test_load_tradeup_simulation_presets_from_storage_backfills_legacy_lowest_output_metadata() {
  const legacyLowest = createSimulationItem({
    markethashname: "XM1014 | 跑跑跑 (Factory New)",
    basemarkethashname: "XM1014 | 跑跑跑",
    rarity: "工业级",
    collection: "2025 列车停放站收藏品",
    minfloat: 0,
    maxfloat: 0.78
  });
  const app = loadSimulationFns();
  app.localStorageStub.setItem("tradeup_simulation_presets_v1", JSON.stringify([{
    id: "preset_legacy_lowest",
    name: "旧最低级产物",
    primary_output: legacyLowest,
    cover_output: legacyLowest,
    active_anchor_item: legacyLowest,
    active_anchor_abs_wear: 0.24
  }]));
  app.api = (path, options = {}) => {
    app.apiCalls.push({path, options});
    if (path === "/api/ui-state/tradeup-simulation-presets" && (!options.method || options.method === "GET")) {
      return Promise.resolve({ok: true, presets: []});
    }
    if (path.startsWith("/api/simulation/tradeup/item?markethashname=")) {
      const encodedLegacyName = encodeURIComponent(legacyLowest.markethashname);
      return Promise.resolve({
        ok: true,
        item: path.includes(encodedLegacyName)
          ? {
              ...legacyLowest,
              collection_lowest_rarity: "工业级",
              is_collection_lowest_rarity: true
            }
          : validOutput
      });
    }
    return Promise.resolve({ok: true});
  };

  await app.loadTradeupSimulationPresetsFromStorage();
  await flushMicrotasks();

  assert.equal(app.state.simulationPresets.length, 0);
  assert.equal(
    app.apiCalls.some((call) => call.path.startsWith("/api/simulation/tradeup/item?markethashname=")),
    true
  );
}

async function test_load_tradeup_simulation_presets_from_storage_keeps_valid_presets_beyond_legacy_invalid_cap() {
  const legacyLowest = createSimulationItem({
    markethashname: "XM1014 | 跑跑跑 (Factory New)",
    basemarkethashname: "XM1014 | 跑跑跑",
    rarity: "工业级",
    collection: "2025 列车停放站收藏品",
    minfloat: 0,
    maxfloat: 0.78
  });
  const validOutput = createSimulationItem({
    markethashname: "USP-S | Cortex (Minimal Wear)",
    basemarkethashname: "USP-S | Cortex",
    rarity: "军规级",
    collection: "狂牙大行动收藏品",
    minfloat: 0.02,
    maxfloat: 0.7
  });
  const app = loadSimulationFns();
  const storedPresets = Array.from({length: 40}, (_, index) => ({
    id: `preset_legacy_lowest_${index}`,
    name: `旧最低级产物 ${index + 1}`,
    primary_output: legacyLowest,
    cover_output: legacyLowest,
    active_anchor_item: legacyLowest,
    active_anchor_abs_wear: 0.24
  }));
  storedPresets.push({
    id: "preset_valid_tail",
    name: "尾部有效预设",
    primary_output: validOutput,
    cover_output: validOutput,
    active_anchor_item: validOutput,
    active_anchor_abs_wear: 0.18
  });
  app.localStorageStub.setItem("tradeup_simulation_presets_v1", JSON.stringify(storedPresets));
  app.api = (path, options = {}) => {
    app.apiCalls.push({path, options});
    if (path === "/api/ui-state/tradeup-simulation-presets" && (!options.method || options.method === "GET")) {
      return Promise.resolve({ok: true, presets: []});
    }
    if (path.startsWith("/api/simulation/tradeup/item?markethashname=")) {
      const encodedLegacyName = encodeURIComponent(legacyLowest.markethashname);
      return Promise.resolve({
        ok: true,
        item: path.includes(encodedLegacyName)
          ? {
              ...legacyLowest,
              collection_lowest_rarity: "工业级",
              is_collection_lowest_rarity: true
            }
          : validOutput
      });
    }
    return Promise.resolve({ok: true});
  };

  await app.loadTradeupSimulationPresetsFromStorage();
  await flushMicrotasks();

  assert.equal(app.state.simulationPresets.length, 1);
  assert.equal(app.state.simulationPresets[0].id, "preset_valid_tail");
  assert.equal(app.state.simulationPresets[0].primary_output.basemarkethashname, "USP-S | Cortex");
}

async function test_load_tradeup_simulation_presets_from_server_keeps_valid_presets_beyond_legacy_invalid_cap() {
  const legacyLowest = createSimulationItem({
    markethashname: "XM1014 | 跑跑跑 (Factory New)",
    basemarkethashname: "XM1014 | 跑跑跑",
    rarity: "工业级",
    collection: "2025 列车停放站收藏品",
    minfloat: 0,
    maxfloat: 0.78
  });
  const validOutput = createSimulationItem({
    markethashname: "USP-S | Cortex (Minimal Wear)",
    basemarkethashname: "USP-S | Cortex",
    rarity: "军规级",
    collection: "狂牙大行动收藏品",
    minfloat: 0.02,
    maxfloat: 0.7
  });
  const serverPresets = Array.from({length: 40}, (_, index) => ({
    id: `server_legacy_lowest_${index}`,
    name: `服务端旧最低级产物 ${index + 1}`,
    primary_output: legacyLowest,
    cover_output: legacyLowest,
    active_anchor_item: legacyLowest,
    active_anchor_abs_wear: 0.24
  }));
  serverPresets.push({
    id: "server_valid_tail",
    name: "服务端尾部有效预设",
    primary_output: validOutput,
    cover_output: validOutput,
    active_anchor_item: validOutput,
    active_anchor_abs_wear: 0.18
  });
  const app = loadSimulationFns();
  app.api = (path, options = {}) => {
    app.apiCalls.push({path, options});
    if (path === "/api/ui-state/tradeup-simulation-presets" && (!options.method || options.method === "GET")) {
      return Promise.resolve({ok: true, presets: serverPresets});
    }
    if (path.startsWith("/api/simulation/tradeup/item?markethashname=")) {
      const encodedLegacyName = encodeURIComponent(legacyLowest.markethashname);
      return Promise.resolve({
        ok: true,
        item: path.includes(encodedLegacyName)
          ? {
              ...legacyLowest,
              collection_lowest_rarity: "工业级",
              is_collection_lowest_rarity: true
            }
          : validOutput
      });
    }
    return Promise.resolve({ok: true});
  };

  await app.loadTradeupSimulationPresetsFromStorage();
  await flushMicrotasks();

  assert.equal(app.state.simulationPresets.length, 1);
  assert.equal(app.state.simulationPresets[0].id, "server_valid_tail");
  assert.equal(app.state.simulationPresets[0].primary_output.basemarkethashname, "USP-S | Cortex");
}

function test_build_tradeup_simulation_derived_output_payload_ignores_restricted_material_grouping() {
  const app = loadSimulationFns();
  const validMaterial = createSimulationItem({
    markethashname: "Five-SeveN | 混沌点阵 (Field-Tested)",
    basemarkethashname: "Five-SeveN | 混沌点阵",
    rarity: "军规级",
    collection: "狂牙大行动收藏品",
    minfloat: 0,
    maxfloat: 1
  });
  const limitedMaterial = {
    ...createSimulationItem({
      markethashname: "Desert Eagle | Heat Treated (Field-Tested)",
      basemarkethashname: "Desert Eagle | Heat Treated",
      rarity: "军规级",
      collection: "限量版物品",
      minfloat: 0,
      maxfloat: 1
    }),
    is_tradeup_restricted: true,
    tradeup_restriction_reason: "limited_collection"
  };

  const payload = app.buildTradeupSimulationDerivedOutputPayload({
    main_material: validMaterial,
    aux_material: limitedMaterial,
    active_anchor_item: validMaterial,
    active_anchor_abs_wear: 0.24
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(payload.groups)),
    [{collection: "狂牙大行动收藏品", count: 1}]
  );
}

async function test_refresh_tradeup_simulation_derived_outputs_surfaces_prediction_failure_without_dropping_material() {
  const app = loadSimulationFns();
  const mainMaterial = createSimulationItem({
    markethashname: "AUG | 渐变琥珀 (Factory New)",
    basemarkethashname: "AUG | 渐变琥珀",
    rarity: "军规级",
    collection: "2021 列车停放站收藏品",
    minfloat: 0,
    maxfloat: 0.4
  });
  app.state.simulationWorkspacePreset = {
    id: "draft_prediction_failure",
    name: "预测失败仍保留材料",
    primary_output: null,
    aux_output: null,
    main_material: mainMaterial,
    aux_material: null,
    cover_output: null,
    active_anchor_item: mainMaterial,
    active_anchor_abs_wear: 0,
    output_rows: [],
    material_rows: [],
    rows: [],
    output_candidates: [],
    warnings: [],
    dirty: true
  };
  app.api = async () => {
    throw new Error("预测服务暂时不可用");
  };
  let renderCount = 0;
  app.renderSimulationPage = () => {
    renderCount += 1;
  };

  const refreshed = await app.refreshTradeupSimulationDerivedOutputs("draft_prediction_failure");

  assert.equal(refreshed, false);
  assert.equal(app.state.simulationWorkspacePreset.main_material.markethashname, mainMaterial.markethashname);
  assert.match(
    String(app.state.simulationWorkspacePreset.warnings[0]?.message || ""),
    /预测服务暂时不可用/,
    "prediction errors should remain visible instead of being swallowed"
  );
  assert.equal(renderCount, 1, "recording a prediction failure should refresh the visible workspace state");
}

async function test_refresh_tradeup_simulation_derived_outputs_surfaces_missing_invalid_and_empty_outcomes() {
  const responses = [
    {label: "missing", value: {ok: true}},
    {label: "invalid type", value: {ok: true, outcomes: {}}},
    {label: "empty", value: {ok: true, outcomes: []}}
  ];
  for (const scenario of responses) {
    const app = loadSimulationFns();
    const mainMaterial = createSimulationItem({
      markethashname: "AUG | 渐变琥珀 (Factory New)",
      basemarkethashname: "AUG | 渐变琥珀",
      rarity: "军规级",
      collection: "2021 列车停放站收藏品",
      minfloat: 0,
      maxfloat: 0.4
    });
    app.state.simulationWorkspacePreset = {
      id: `draft_${scenario.label.replaceAll(" ", "_")}_outcomes`,
      main_material: mainMaterial,
      active_anchor_item: mainMaterial,
      active_anchor_abs_wear: 0,
      output_rows: [],
      material_rows: [],
      rows: [],
      output_candidates: [],
      warnings: []
    };
    app.api = async () => scenario.value;
    let renderCount = 0;
    app.renderSimulationPage = () => {
      renderCount += 1;
    };

    const refreshed = await app.refreshTradeupSimulationDerivedOutputs(app.state.simulationWorkspacePreset.id);

    assert.equal(refreshed, false, `${scenario.label} outcomes should fail derivation`);
    assert.match(
      String(app.state.simulationWorkspacePreset.warnings[0]?.message || ""),
      /未返回可用产物/,
      `${scenario.label} outcomes should produce a visible warning`
    );
    assert.equal(renderCount, 1, `${scenario.label} outcomes should refresh the workspace warning`);
  }
}

async function test_refresh_tradeup_simulation_derived_outputs_ignores_stale_failure_after_material_change() {
  const app = loadSimulationFns();
  const firstMaterial = createSimulationItem({
    markethashname: "AUG | 渐变琥珀 (Factory New)",
    basemarkethashname: "AUG | 渐变琥珀",
    rarity: "军规级",
    collection: "2021 列车停放站收藏品",
    minfloat: 0,
    maxfloat: 0.4
  });
  app.state.simulationWorkspacePreset = {
    id: "draft_stale_prediction_failure",
    main_material: firstMaterial,
    active_anchor_item: firstMaterial,
    active_anchor_abs_wear: 0,
    output_rows: [],
    material_rows: [],
    rows: [],
    output_candidates: [],
    warnings: []
  };
  let rejectFirstRequest = null;
  app.api = () => new Promise((resolve, reject) => {
    rejectFirstRequest = reject;
  });
  app.renderSimulationPage = () => {};

  const pendingRefresh = app.refreshTradeupSimulationDerivedOutputs("draft_stale_prediction_failure");
  await flushMicrotasks();
  assert.equal(typeof rejectFirstRequest, "function");

  app.applyTradeupSimulationSlotSelection({
    slot: "main_material",
    item: createSimulationItem({
      markethashname: "Five-SeveN | 混沌点阵 (Minimal Wear)",
      basemarkethashname: "Five-SeveN | 混沌点阵",
      rarity: "军规级",
      collection: "狂牙大行动收藏品",
      minfloat: 0,
      maxfloat: 1
    }),
    absoluteWear: 0.22
  });
  rejectFirstRequest(new Error("旧材料预测失败"));
  await pendingRefresh;

  assert.equal(app.state.simulationWorkspacePreset.main_material.basemarkethashname, "Five-SeveN | 混沌点阵");
  assert.deepEqual(
    app.state.simulationWorkspacePreset.warnings,
    [],
    "a late failure from the previous material selection must not overwrite the current workspace state"
  );
}

async function test_refresh_tradeup_simulation_derived_outputs_ignores_stale_success_after_material_change() {
  const app = loadSimulationFns();
  const firstMaterial = createSimulationItem({
    markethashname: "AUG | 渐变琥珀 (Factory New)",
    basemarkethashname: "AUG | 渐变琥珀",
    rarity: "军规级",
    collection: "2021 列车停放站收藏品",
    minfloat: 0,
    maxfloat: 0.4
  });
  app.state.simulationWorkspacePreset = {
    id: "draft_stale_prediction_success",
    main_material: firstMaterial,
    active_anchor_item: firstMaterial,
    active_anchor_abs_wear: 0,
    output_rows: [],
    material_rows: [],
    rows: [],
    output_candidates: [],
    warnings: []
  };
  let resolveFirstRequest = null;
  app.api = () => new Promise((resolve) => {
    resolveFirstRequest = resolve;
  });

  const pendingRefresh = app.refreshTradeupSimulationDerivedOutputs("draft_stale_prediction_success");
  await flushMicrotasks();
  assert.equal(typeof resolveFirstRequest, "function");

  app.applyTradeupSimulationSlotSelection({
    slot: "main_material",
    item: createSimulationItem({
      markethashname: "Five-SeveN | 混沌点阵 (Minimal Wear)",
      basemarkethashname: "Five-SeveN | 混沌点阵",
      rarity: "军规级",
      collection: "狂牙大行动收藏品",
      minfloat: 0,
      maxfloat: 1
    }),
    absoluteWear: 0.22
  });
  resolveFirstRequest({
    ok: true,
    outcomes: [{
      markethashname: "AWP | 旧产物 (Factory New)",
      name: "AWP | 旧产物 (Factory New)",
      base_name: "AWP | 旧产物",
      collection_display: "2021 列车停放站收藏品",
      minfloat: 0,
      maxfloat: 1
    }]
  });
  await pendingRefresh;

  assert.equal(app.state.simulationWorkspacePreset.main_material.basemarkethashname, "Five-SeveN | 混沌点阵");
  assert.deepEqual(app.state.simulationWorkspacePreset.output_candidates, []);
  assert.equal(app.state.simulationWorkspacePreset.primary_output, null);
}

function test_sanitize_tradeup_simulation_draft_payload_replaces_lowest_output_anchor() {
  const app = loadSimulationFns();
  const primary = createSimulationItem({
    markethashname: "USP-S | Cortex (Minimal Wear)",
    basemarkethashname: "USP-S | Cortex",
    rarity: "军规级",
    collection: "狂牙大行动收藏品",
    minfloat: 0.02,
    maxfloat: 0.7
  });
  const lowestAnchor = {
    ...createSimulationItem({
      markethashname: "XM1014 | 跑跑跑 (Factory New)",
      basemarkethashname: "XM1014 | 跑跑跑",
      rarity: "工业级",
      collection: "2025 列车停放站收藏品",
      minfloat: 0,
      maxfloat: 0.78
    }),
    collection_lowest_rarity: "工业级",
    is_collection_lowest_rarity: true
  };

  const draft = app.sanitizeTradeupSimulationDraftPayload({
    id: "draft_anchor_lowest",
    name: "最低级旧锚点",
    primary_output: primary,
    cover_output: primary,
    active_anchor_item: lowestAnchor,
    active_anchor_abs_wear: 0.31
  });

  assert.equal(draft.primary_output.basemarkethashname, "USP-S | Cortex");
  assert.equal(draft.active_anchor_item.basemarkethashname, "USP-S | Cortex");
  assert.equal(draft.active_anchor_abs_wear, 0.02);
}

function test_apply_tradeup_simulation_slot_selection_sets_cover_for_primary_output() {
  const app = loadSimulationFns();
  app.openBlankTradeupSimulationWorkspaceDraft();

  const updated = app.applyTradeupSimulationSlotSelection({
    slot: "primary_output",
    item: createSimulationItem({
      markethashname: "USP-S | Cortex (Minimal Wear)",
      basemarkethashname: "USP-S | Cortex"
    }),
    absoluteWear: 0.118
  });

  assert.equal(updated, true);
  assert.equal(app.state.simulationWorkspacePreset.primary_output.basemarkethashname, "USP-S | Cortex");
  assert.equal(app.state.simulationWorkspacePreset.cover_output.basemarkethashname, "USP-S | Cortex");
  assert.equal(app.state.simulationWorkspacePreset.active_anchor_item.basemarkethashname, "USP-S | Cortex");
  assert.equal(app.state.simulationWorkspacePreset.active_anchor_abs_wear, 0.118);
}

function test_open_tradeup_simulation_picker_modal_records_slot_context() {
  const app = loadSimulationFns({
    simulationViewMode: "saved",
    simulationPickerQuery: "旧查询",
    simulationPickerResults: [createSimulationItem({
      markethashname: "USP-S | Cortex (Minimal Wear)",
      basemarkethashname: "USP-S | Cortex"
    })],
    simulationSearchLoading: true
  });

  const opened = app.openTradeupSimulationPickerModal({
    slot: "main_material",
    title: "选择主料"
  });

  assert.equal(opened, true);
  assert.equal(app.state.simulationViewMode, "workspace");
  assert.equal(app.state.simulationPickerOpen, true);
  assert.equal(app.state.simulationPickerMode, "main_material");
  assert.equal(app.state.simulationPickerTitle, "选择主料");
  assert.equal(app.state.simulationPickerQuery, "");
  assert.equal(Array.isArray(app.state.simulationPickerResults), true);
  assert.equal(app.state.simulationPickerResults.length, 0);
  assert.equal(app.state.simulationSearchLoading, false);
}

function test_adopt_tradeup_simulation_derived_primary_output_uses_random_cover_when_missing() {
  const app = loadSimulationFns();
  app.Math.random = () => 0.9;
  app.openBlankTradeupSimulationWorkspaceDraft();

  const adopted = app.adoptTradeupSimulationDerivedPrimaryOutput({
    presetId: app.state.simulationWorkspacePreset.id,
    candidates: [
      createSimulationItem({
        markethashname: "USP-S | Cortex (Minimal Wear)",
        basemarkethashname: "USP-S | Cortex"
      }),
      createSimulationItem({
        markethashname: "P250 | 随便玩玩 (Field-Tested)",
        basemarkethashname: "P250 | 随便玩玩"
      })
    ]
  });

  assert.equal(adopted, true);
  assert.equal(app.state.simulationWorkspacePreset.primary_output.basemarkethashname, "P250 | 随便玩玩");
  assert.equal(app.state.simulationWorkspacePreset.cover_output.basemarkethashname, "P250 | 随便玩玩");
}

function test_apply_tradeup_simulation_slot_selection_preserves_cover_when_material_changes() {
  const primary = createSimulationItem({
    markethashname: "USP-S | Cortex (Minimal Wear)",
    basemarkethashname: "USP-S | Cortex"
  });
  const app = loadSimulationFns({
    simulationWorkspacePreset: {
      id: "draft_1",
      name: "猎杀号样例",
      primary_output: primary,
      cover_output: primary,
      active_anchor_item: primary,
      active_anchor_abs_wear: 0.118,
      dirty: false
    }
  });

  const updated = app.applyTradeupSimulationSlotSelection({
    slot: "main_material",
    item: createSimulationItem({
      markethashname: "Five-SeveN | 混沌点阵 (Minimal Wear)",
      basemarkethashname: "Five-SeveN | 混沌点阵",
      rarity: "军规级"
    }),
    absoluteWear: 0.222
  });

  assert.equal(updated, true);
  assert.equal(app.state.simulationWorkspacePreset.main_material.basemarkethashname, "Five-SeveN | 混沌点阵");
  assert.equal(app.state.simulationWorkspacePreset.cover_output.basemarkethashname, "USP-S | Cortex");
  assert.equal(app.state.simulationWorkspacePreset.active_anchor_item.basemarkethashname, "Five-SeveN | 混沌点阵");
  assert.equal(app.state.simulationWorkspacePreset.active_anchor_abs_wear, 0.222);
}

function test_apply_tradeup_simulation_material_selection_invalidates_stale_derived_projection() {
  const primary = createSimulationItem({
    markethashname: "USP-S | Cortex (Minimal Wear)",
    basemarkethashname: "USP-S | Cortex"
  });
  const app = loadSimulationFns({
    simulationWorkspacePreset: {
      id: "draft_stale_projection",
      name: "旧派生结果",
      primary_output: primary,
      cover_output: primary,
      main_material: createSimulationItem({
        markethashname: "旧材料 (Field-Tested)",
        basemarkethashname: "旧材料",
        rarity: "军规级"
      }),
      active_anchor_item: primary,
      active_anchor_abs_wear: 0.118,
      output_rows: [{collection: "旧收藏品", outputs: [primary]}],
      material_rows: [{collection: "旧收藏品", materials: [{markethashname: "旧材料"}]}],
      rows: [{collection: "旧收藏品"}],
      output_candidates: [primary],
      warnings: [{type: "old_warning", message: "旧警告"}],
      dirty: false
    }
  });

  const updated = app.applyTradeupSimulationSlotSelection({
    slot: "main_material",
    item: createSimulationItem({
      markethashname: "Five-SeveN | 混沌点阵 (Minimal Wear)",
      basemarkethashname: "Five-SeveN | 混沌点阵",
      rarity: "军规级"
    }),
    absoluteWear: 0.222
  });

  assert.equal(updated, true);
  assert.equal(app.state.simulationWorkspacePreset.cover_output.basemarkethashname, "USP-S | Cortex");
  assert.deepEqual(app.state.simulationWorkspacePreset.output_rows, []);
  assert.deepEqual(app.state.simulationWorkspacePreset.material_rows, []);
  assert.deepEqual(app.state.simulationWorkspacePreset.rows, []);
  assert.deepEqual(app.state.simulationWorkspacePreset.output_candidates, []);
  assert.deepEqual(app.state.simulationWorkspacePreset.warnings, []);
}

function test_render_simulation_lane_section_marks_single_card_rows() {
  const app = loadSimulationFns();

  const html = app.renderSimulationLaneSection(
    "当前已选产物",
    "",
    '<article class="simulation-output-card"></article>',
    null,
    "",
    1
  );

  assert.match(
    html,
    /class="simulation-card-grid is-single-card"/,
    "single-card simulation lanes should render a dedicated class so one card keeps its compact width"
  );
}

function test_build_tradeup_simulation_saved_card_summary_uses_wear_tier_and_relative_wear() {
  const cover = createSimulationItem({
    markethashname: "USP-S | Cortex (Minimal Wear)",
    basemarkethashname: "USP-S | Cortex",
    collection: "猎杀号收藏品",
    minfloat: 0.06,
    maxfloat: 0.8
  });
  cover.wear_label = "Minimal Wear";
  const anchor = createSimulationItem({
    markethashname: "XM1014 | 跑跑跑 (Field-Tested)",
    basemarkethashname: "XM1014 | 跑跑跑",
    minfloat: 0.15,
    maxfloat: 0.55
  });
  const app = loadSimulationFns();

  const summary = app.buildTradeupSimulationSavedCardSummary({
    name: "  我的配方配置  ",
    cover_output: cover,
    primary_output: cover,
    active_anchor_item: anchor,
    active_anchor_abs_wear: 0.35,
    main_material: createSimulationItem({
      markethashname: "Five-SeveN | 混沌点阵 (Minimal Wear)",
      basemarkethashname: "Five-SeveN | 混沌点阵"
    })
  });

  assert.equal(summary.presetName, "我的配方配置");
  assert.equal(summary.wearLabel, "略有磨损");
  assert.equal(summary.wearToneClass, " tone-mw");
  assert.equal(summary.anchorWear, "0.3500000000000000");
  assert.equal(summary.anchorAbsoluteWearValue, 0.35);
  assert.equal(summary.collectionText, "猎杀号收藏品");
}

async function test_save_active_tradeup_simulation_preset_uses_prompted_name_before_persisting() {
  const primary = createSimulationItem({
    markethashname: "USP-S | Cortex (Minimal Wear)",
    basemarkethashname: "USP-S | Cortex",
    collection: "猎杀号收藏品"
  });
  const app = loadSimulationFns({
    simulationViewMode: "workspace",
    simulationPresets: []
  });

  app.state.simulationWorkspacePreset = {
    id: "draft_prompt_save",
    name: "旧配置名",
    primary_output: primary,
    cover_output: primary,
    active_anchor_item: primary,
    active_anchor_abs_wear: 0.118,
    output_rows: [],
    material_rows: [],
    output_candidates: [],
    warnings: [],
    dirty: true,
    created_at: 100,
    updated_at: 100
  };

  app.openCraftAssistPresetModal = async (initialName, options = {}) => {
    assert.equal(initialName, "");
    assert.equal(String(options.title || "").includes("配置"), true);
    return "  新配置名称  ";
  };

  const saved = await app.saveActiveTradeupSimulationPreset();
  await flushMicrotasks();

  assert.equal(saved, true);
  assert.equal(app.state.simulationPresets.length, 1);
  assert.equal(app.state.simulationPresets[0].name, "新配置名称");
  assert.equal(app.state.simulationWorkspacePreset.name, "新配置名称");
}

async function test_save_active_tradeup_simulation_preset_stops_when_name_prompt_is_cancelled() {
  const primary = createSimulationItem({
    markethashname: "USP-S | Cortex (Minimal Wear)",
    basemarkethashname: "USP-S | Cortex"
  });
  const app = loadSimulationFns({
    simulationViewMode: "workspace",
    simulationPresets: []
  });

  app.state.simulationWorkspacePreset = {
    id: "draft_prompt_cancel",
    name: "取消前名字",
    primary_output: primary,
    cover_output: primary,
    active_anchor_item: primary,
    active_anchor_abs_wear: 0.118,
    output_rows: [],
    material_rows: [],
    output_candidates: [],
    warnings: [],
    dirty: true,
    created_at: 100,
    updated_at: 100
  };

  app.openCraftAssistPresetModal = async () => null;

  const saved = await app.saveActiveTradeupSimulationPreset();
  await flushMicrotasks();

  assert.equal(saved, false);
  assert.equal(app.state.simulationPresets.length, 0);
  assert.equal(app.apiCalls.length, 0);
}

function test_render_simulation_selected_output_card_uses_item_rarity_color_even_when_anchor_active() {
  const app = loadSimulationFns();
  app.preferredRowSkinImageUrl = () => "";
  const item = createSimulationItem({
    markethashname: "USP-S | Cortex (Minimal Wear)",
    basemarkethashname: "USP-S | Cortex",
    rarity: "军规级",
    minfloat: 0.06,
    maxfloat: 0.8
  });
  item.wear_label = "Minimal Wear";
  const html = app.renderSimulationSelectedOutputCard(item, {
    primary_output: item,
    cover_output: item,
    active_anchor_item: item,
    active_anchor_abs_wear: 0.145714
  }, "primary_output");

  assert.match(
    html,
    /simulation-anchor-active/,
    "anchor cards should still mark the selected item"
  );
  assert.match(
    html,
    /--simulation-card-rarity-color:#4b69ff/,
    "selected simulation cards should keep their own rarity stripe color instead of being recolored by the anchor state"
  );
}

function test_render_simulation_selected_output_card_applies_wear_tone_class_to_badge() {
  const app = loadSimulationFns();
  app.preferredRowSkinImageUrl = () => "";
  const item = createSimulationItem({
    markethashname: "USP-S | Cortex (Minimal Wear)",
    basemarkethashname: "USP-S | Cortex",
    rarity: "军规级",
    minfloat: 0.06,
    maxfloat: 0.8
  });
  item.wear_label = "Minimal Wear";

  const html = app.renderSimulationSelectedOutputCard(item, {
    primary_output: item,
    cover_output: item,
    active_anchor_item: item,
    active_anchor_abs_wear: 0.145714
  }, "primary_output");

  assert.match(
    html,
    /simulation-card-wear-badge tone-mw/,
    "simulation card wear badges should inherit the correct wear tone class so the text color matches the displayed wear tier"
  );

  assert.match(
    html,
    /simulation-card-bar tone-mw/,
    "simulation card wear bars should inherit the minimal-wear tone class so the bottom range keeps the correct tier color"
  );
}

function test_render_simulation_selected_output_card_applies_factory_new_tone_class_to_bar() {
  const app = loadSimulationFns();
  app.preferredRowSkinImageUrl = () => "";
  const item = createSimulationItem({
    markethashname: "P90 | 潜管作品 (Factory New)",
    basemarkethashname: "P90 | 潜管作品",
    rarity: "军规级",
    minfloat: 0,
    maxfloat: 0.07
  });
  item.wear_label = "Factory New";

  const html = app.renderSimulationSelectedOutputCard(item, {
    primary_output: item,
    cover_output: item,
    active_anchor_item: item,
    active_anchor_abs_wear: 0.041245
  }, "primary_output");

  assert.match(
    html,
    /simulation-card-wear-badge tone-fn/,
    "simulation card wear badges should also mark factory-new items with the dedicated tone class"
  );

  assert.match(
    html,
    /simulation-card-bar tone-fn/,
    "simulation card wear bars should inherit the factory-new tone class so the bottom range can split factory new away from minimal wear"
  );
}

function test_render_simulation_selected_material_card_applies_wear_tone_classes() {
  const app = loadSimulationFns();
  app.preferredRowSkinImageUrl = () => "";
  const item = createSimulationItem({
    markethashname: "Glock-18 | 锈蚀烈焰 (Minimal Wear)",
    basemarkethashname: "Glock-18 | 锈蚀烈焰",
    rarity: "军规级",
    minfloat: 0.07,
    maxfloat: 0.85
  });
  item.wear_label = "Minimal Wear";

  const html = app.renderSimulationSelectedMaterialCard(item, {
    main_material: item,
    cover_output: item,
    active_anchor_item: item,
    active_anchor_abs_wear: 0.132451
  }, "main_material");

  assert.match(
    html,
    /simulation-card-wear-badge tone-mw/,
    "selected material cards should keep the minimal-wear badge tone so the tier label remains green"
  );

  assert.match(
    html,
    /simulation-card-bar tone-mw/,
    "selected material cards should also pass the minimal-wear tone into the bottom wear bar"
  );
}

function test_render_simulation_material_grid_shows_selected_material_before_output_derivation() {
  const app = loadSimulationFns();
  app.preferredRowSkinImageUrl = () => "";
  const mainMaterial = createSimulationItem({
    markethashname: "AUG | 渐变琥珀 (Factory New)",
    basemarkethashname: "AUG | 渐变琥珀",
    collection: "2021 列车停放站收藏品",
    rarity: "军规级",
    minfloat: 0,
    maxfloat: 0.4
  });
  const preset = {
    id: "draft_selected_material_without_output",
    name: "已选材料待推导",
    primary_output: null,
    aux_output: null,
    main_material: mainMaterial,
    aux_material: null,
    cover_output: null,
    active_anchor_item: mainMaterial,
    active_anchor_abs_wear: 0,
    output_rows: [],
    material_rows: [],
    rows: [],
    output_candidates: [],
    warnings: [{type: "prediction_pending", message: "正在根据当前材料推导产物"}],
    dirty: true
  };
  app.state.simulationWorkspacePreset = preset;
  app.ui.simulationMaterialLane = {innerHTML: ""};

  app.renderSimulationMaterialGrid(preset);

  assert.match(app.ui.simulationMaterialLane.innerHTML, /data-simulation-card-role="material"/);
  assert.match(app.ui.simulationMaterialLane.innerHTML, /AUG \| 渐变琥珀/);
  assert.doesNotMatch(
    app.ui.simulationMaterialLane.innerHTML,
    /先添加主料或辅料/,
    "the empty-workspace hint must not replace a material the user has already selected"
  );
}

function test_render_simulation_grids_escape_prediction_warning() {
  const app = loadSimulationFns();
  app.preferredRowSkinImageUrl = () => "";
  const mainMaterial = createSimulationItem({
    markethashname: "AUG | 渐变琥珀 (Factory New)",
    basemarkethashname: "AUG | 渐变琥珀",
    collection: "2021 列车停放站收藏品",
    rarity: "军规级",
    minfloat: 0,
    maxfloat: 0.4
  });
  const preset = {
    main_material: mainMaterial,
    aux_material: null,
    primary_output: null,
    cover_output: null,
    active_anchor_item: mainMaterial,
    active_anchor_abs_wear: 0,
    material_rows: [],
    warnings: [{
      type: "derived_output_prediction_failed",
      message: '<img src=x onerror="alert(1)">'
    }]
  };
  app.state.simulationWorkspacePreset = preset;
  app.ui.simulationMaterialLane = {innerHTML: ""};
  app.ui.simulationOutputLane = {innerHTML: ""};

  app.renderSimulationMaterialGrid(preset);
  app.renderSimulationOutputGrid(preset);

  assert.doesNotMatch(app.ui.simulationMaterialLane.innerHTML, /<img src=x/);
  assert.match(app.ui.simulationMaterialLane.innerHTML, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(app.ui.simulationOutputLane.innerHTML, /<img src=x/);
  assert.match(app.ui.simulationOutputLane.innerHTML, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
}

function test_render_tradeup_simulation_selection_style_card_preserves_explicit_wear_tone_spacing() {
  const app = loadSimulationFns();
  app.preferredRowSkinImageUrl = () => "";
  const item = createSimulationItem({
    markethashname: "P90 | 潜管作品 (Factory New)",
    basemarkethashname: "P90 | 潜管作品",
    rarity: "军规级",
    minfloat: 0,
    maxfloat: 0.07
  });
  item.wear_label = "Factory New";

  const html = app.renderTradeupSimulationSelectionStyleCard({
    item,
    preset: {
      primary_output: item,
      cover_output: item,
      active_anchor_item: item,
      active_anchor_abs_wear: 0.041245
    },
    kind: "output",
    mode: "saved",
    titleText: "Badge Verify",
    sublineHtml: "",
    wearValue: 0.041245,
    wearText: "0.041245",
    wearLabel: "崭新出厂",
    wearToneClass: " tone-fn"
  });

  assert.match(
    html,
    /simulation-card-wear-badge tone-fn/,
    "shared selection-style cards should preserve the explicit wear tone class spacing when saved cards pass a prefixed tone token"
  );

  assert.match(
    html,
    /simulation-card-wear-stack tone-fn/,
    "shared selection-style cards should also keep the explicit wear tone class on the saved-card wear stack"
  );

  assert.match(
    html,
    /simulation-card-bar tone-fn/,
    "shared selection-style cards should keep the explicit wear tone class on the saved-card wear bar"
  );
}

function test_sim_export_craft_preset_converts_anchor_absolute_wear_to_relative_target_wear() {
  const app = loadSimulationFns();
  const anchor = createSimulationItem({
    markethashname: "AK-47 | 范式 (Field-Tested)",
    basemarkethashname: "AK-47 | 范式",
    collection: "控制收藏品",
    rarity: "保密",
    minfloat: 0.1,
    maxfloat: 0.7
  });
  const material = createSimulationItem({
    markethashname: "Five-SeveN | 混沌点阵 (Minimal Wear)",
    basemarkethashname: "Five-SeveN | 混沌点阵",
    collection: "控制收藏品",
    rarity: "受限",
    minfloat: 0,
    maxfloat: 1
  });
  const valueInput = (value = "") => ({value, focus() {}});
  app.ui.simExportCraftName = valueInput();
  app.ui.simExportCraftTargetWear = valueInput();
  app.ui.simExportCraftMainCount = valueInput();
  app.ui.simExportCraftAuxCount = valueInput();
  app.ui.simExportCraftWearMin = valueInput();
  app.ui.simExportCraftWearMax = valueInput();
  app.ui.simExportCraftModal = {classList: createClassList(["hidden"])};
  app.ui.simExportCraftSearchPanel = {classList: createClassList(["hidden"])};
  app.ui.simExportCraftSearchResults = {innerHTML: ""};
  app.ui.simExportCraftSearchInput = valueInput();
  app.ui.simExportCraftMaterialList = {
    innerHTML: "",
    querySelectorAll() {
      return [];
    }
  };

  app.openSimExportCraftModal({
    id: "preset_export_relative",
    name: "相对磨损导出",
    primary_output: anchor,
    cover_output: anchor,
    active_anchor_item: anchor,
    active_anchor_abs_wear: 0.4,
    main_material: material,
    material_rows: [{collection: "控制收藏品", materials: [material]}]
  });
  app.confirmSimExportCraftModal();

  assert.equal(app.state.craftAssistPresets.length, 1);
  assert.equal(app.state.craftAssistPresets[0].target_wear_raw, "0.5");
  assert.equal(app.state.craftAssistPresets[0].target_wear, Math.fround(0.5));
  assert.notEqual(app.state.craftAssistPresets[0].target_wear, Math.fround(0.4));
  assert.equal(app.craftAssistPresetSaveCount, 1);
}

async function test_delete_tradeup_simulation_preset_removes_saved_entry_and_persists() {
  const presetA = {
    id: "preset_a",
    name: "A",
    primary_output: createSimulationItem({
      markethashname: "USP-S | Cortex (Minimal Wear)",
      basemarkethashname: "USP-S | Cortex"
    }),
    cover_output: createSimulationItem({
      markethashname: "USP-S | Cortex (Minimal Wear)",
      basemarkethashname: "USP-S | Cortex"
    }),
    active_anchor_item: createSimulationItem({
      markethashname: "USP-S | Cortex (Minimal Wear)",
      basemarkethashname: "USP-S | Cortex"
    }),
    active_anchor_abs_wear: 0.118,
    output_rows: [],
    material_rows: [],
    output_candidates: []
  };
  const presetB = {
    id: "preset_b",
    name: "B",
    primary_output: createSimulationItem({
      markethashname: "P250 | 随便玩玩 (Field-Tested)",
      basemarkethashname: "P250 | 随便玩玩"
    }),
    cover_output: createSimulationItem({
      markethashname: "P250 | 随便玩玩 (Field-Tested)",
      basemarkethashname: "P250 | 随便玩玩"
    }),
    active_anchor_item: createSimulationItem({
      markethashname: "P250 | 随便玩玩 (Field-Tested)",
      basemarkethashname: "P250 | 随便玩玩"
    }),
    active_anchor_abs_wear: 0.228,
    output_rows: [],
    material_rows: [],
    output_candidates: []
  };
  const app = loadSimulationFns({
    simulationViewMode: "saved",
    simulationPresets: [presetA, presetB],
    simulationActivePresetId: "preset_a",
    simulationWorkspaceSourcePresetId: "preset_a",
    simulationWorkspacePreset: {
      ...presetA,
      dirty: false
    }
  });

  const deleted = await app.deleteTradeupSimulationPreset("preset_a");
  await flushMicrotasks();

  assert.equal(deleted, true);
  assert.equal(app.state.simulationPresets.length, 1);
  assert.equal(app.state.simulationPresets[0].id, "preset_b");
  assert.equal(app.state.simulationActivePresetId, "preset_b");
  assert.equal(app.state.simulationWorkspaceSourcePresetId, "");
  assert.equal(app.state.simulationWorkspacePreset, null);
  assert.equal(app.apiCalls[app.apiCalls.length - 1].path, "/api/ui-state/tradeup-simulation-presets");
}

async function test_tradeup_simulation_picker_search_ignores_stale_response_after_reopen() {
  const app = loadSimulationFns();
  let resolveFirstSearch = null;
  app.renderTradeupSimulationPickerModal = () => {};
  app.renderTradeupSimulationPickerResults = () => {};
  app.api = () => new Promise((resolve) => {
    resolveFirstSearch = resolve;
  });
  app.openTradeupSimulationPickerModal({
    slot: "main_material",
    title: "选择主料"
  });

  const pendingSearch = app.searchTradeupSimulationItems("旧查询");
  app.closeTradeupSimulationPickerModal();
  app.openTradeupSimulationPickerModal({
    slot: "aux_material",
    title: "选择辅料"
  });
  resolveFirstSearch({
    items: [createSimulationItem({
      markethashname: "USP-S | Cortex (Minimal Wear)",
      basemarkethashname: "USP-S | Cortex"
    })]
  });
  await pendingSearch;
  await flushMicrotasks();

  assert.equal(app.state.simulationPickerOpen, true);
  assert.equal(app.state.simulationPickerMode, "aux_material");
  assert.equal(app.state.simulationPickerTitle, "选择辅料");
  assert.equal(app.state.simulationPickerQuery, "");
  assert.equal(app.state.simulationPickerResults.length, 0);
  assert.equal(app.state.simulationSearchLoading, false);
}

async function test_tradeup_simulation_picker_search_rerenders_full_modal_state() {
  const app = loadSimulationFns();
  let modalRenderCount = 0;
  app.renderTradeupSimulationPickerModal = () => {
    modalRenderCount += 1;
  };
  app.renderTradeupSimulationPickerResults = () => {};
  app.api = () => Promise.resolve({items: []});

  await app.searchTradeupSimulationItems("AK");

  assert.equal(modalRenderCount >= 2, true);
  assert.equal(app.state.simulationSearchLoading, false);
}

async function test_tradeup_simulation_picker_clear_search_invalidates_pending_response() {
  const app = loadSimulationFns();
  let resolveFirstSearch = null;
  app.renderTradeupSimulationPickerModal = () => {};
  app.renderTradeupSimulationPickerResults = () => {};
  app.api = () => new Promise((resolve) => {
    resolveFirstSearch = resolve;
  });
  app.openTradeupSimulationPickerModal({
    slot: "primary_output",
    title: "选择主产物"
  });

  const pendingSearch = app.searchTradeupSimulationItems("旧查询");
  await app.searchTradeupSimulationItems("");
  resolveFirstSearch({
    items: [createSimulationItem({
      markethashname: "USP-S | Cortex (Minimal Wear)",
      basemarkethashname: "USP-S | Cortex"
    })]
  });
  await pendingSearch;
  await flushMicrotasks();

  assert.equal(app.state.simulationPickerQuery, "");
  assert.equal(app.state.simulationPickerResults.length, 0);
  assert.equal(app.state.simulationSearchLoading, false);
}

async function test_tradeup_simulation_picker_ignores_out_of_order_search_responses() {
  const app = loadSimulationFns();
  const pendingResolves = [];
  app.renderTradeupSimulationPickerModal = () => {};
  app.renderTradeupSimulationPickerResults = () => {};
  app.api = () => new Promise((resolve) => {
    pendingResolves.push(resolve);
  });
  app.openTradeupSimulationPickerModal({
    slot: "primary_output",
    title: "选择主产物"
  });

  const firstSearch = app.searchTradeupSimulationItems("第一批");
  const secondSearch = app.searchTradeupSimulationItems("第二批");
  pendingResolves[0]({
    items: [createSimulationItem({
      markethashname: "AK-47 | Slate (Minimal Wear)",
      basemarkethashname: "AK-47 | Slate"
    })]
  });
  await firstSearch;
  await flushMicrotasks();

  assert.equal(app.state.simulationPickerResults.length, 0);
  assert.equal(app.state.simulationSearchLoading, true);

  pendingResolves[1]({
    items: [createSimulationItem({
      markethashname: "USP-S | Cortex (Minimal Wear)",
      basemarkethashname: "USP-S | Cortex"
    })]
  });
  await secondSearch;
  await flushMicrotasks();

  assert.equal(app.state.simulationPickerQuery, "第二批");
  assert.equal(app.state.simulationPickerResults.length, 1);
  assert.equal(app.state.simulationPickerResults[0].basemarkethashname, "USP-S | Cortex");
  assert.equal(app.state.simulationSearchLoading, false);
}

async function test_tradeup_simulation_picker_search_failure_sets_consistent_error_state() {
  const app = loadSimulationFns();
  app.renderTradeupSimulationPickerResults = () => {};
  app.api = () => Promise.reject(new Error("网络炸了"));
  app.openTradeupSimulationPickerModal({
    slot: "primary_output",
    title: "选择主产物"
  });

  await app.searchTradeupSimulationItems("失败查询");
  await flushMicrotasks();

  assert.equal(app.state.simulationPickerQuery, "失败查询");
  assert.equal(app.state.simulationPickerResults.length, 0);
  assert.equal(app.state.simulationPickerError, "网络炸了");
  assert.equal(app.state.simulationSearchLoading, false);
}

function test_tradeup_simulation_picker_context_warns_outputs_about_lowest_collection_rarity() {
  const app = loadSimulationFns({
    simulationPickerMode: "primary_output"
  });

  const context = app.getTradeupSimulationPickerContext();

  assert.equal(
    context.hintText.includes("最低级物品不能作为产物添加"),
    true,
    "output picker context should explicitly warn that the lowest collection rarity cannot be added as an output"
  );
}

function test_render_tradeup_simulation_picker_results_hides_lowest_output_candidates() {
  const app = loadSimulationFns({
    simulationPickerMode: "primary_output",
    simulationPickerQuery: "阿尔卑斯",
    simulationPickerResults: [
      {
        ...createSimulationItem({
          markethashname: "XM1014 | 跑跑跑 (工业级)",
          basemarkethashname: "XM1014 | 跑跑跑",
          rarity: "工业级",
          collection: "2025 列车停放站收藏品"
        }),
        collection_lowest_rarity: "工业级",
        is_collection_lowest_rarity: true
      }
    ]
  });
  app.preferredRowSkinImageUrl = () => "";
  const searchResults = {
    innerHTML: "",
    querySelectorAll() {
      return [];
    }
  };
  app.ui.simulationPickerSearchResults = searchResults;

  app.renderTradeupSimulationPickerResults();

  assert.equal(searchResults.innerHTML.includes("XM1014 | 跑跑跑"), false);
  assert.match(searchResults.innerHTML, /没有可添加的匹配物品/);
}

function test_render_tradeup_simulation_picker_results_hides_limited_collection_candidates_for_materials() {
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
  const searchResults = {
    innerHTML: "",
    querySelectorAll() {
      return [];
    }
  };
  app.ui.simulationPickerSearchResults = searchResults;

  app.renderTradeupSimulationPickerResults();

  assert.equal(searchResults.innerHTML.includes("Desert Eagle | Heat Treated"), false);
  assert.match(searchResults.innerHTML, /没有可添加的匹配物品/);
}

async function test_select_tradeup_simulation_picker_item_blocks_mixed_material_rarity_without_closing_picker() {
  const lockedItem = createSimulationItem({
    markethashname: "Five-SeveN | 混沌点阵 (Field-Tested)",
    basemarkethashname: "Five-SeveN | 混沌点阵",
    rarity: "军规级",
    collection: "狂牙大行动收藏品"
  });
  const preset = {
    id: "preset_rarity_lock",
    name: "品级锁定",
    primary_output: createSimulationItem({
      markethashname: "USP-S | Cortex (Field-Tested)",
      basemarkethashname: "USP-S | Cortex",
      rarity: "受限",
      collection: "狂牙大行动收藏品"
    }),
    aux_output: null,
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
  };
  const app = loadSimulationFns({
    simulationPresets: [preset],
    simulationActivePresetId: "preset_rarity_lock",
    simulationWorkspaceSourcePresetId: "preset_rarity_lock",
    simulationWorkspacePreset: {
      ...preset,
      dirty: false
    },
    simulationPickerOpen: true,
    simulationPickerMode: "aux_material",
    simulationPickerQuery: "p90",
    simulationPickerResults: [createSimulationItem({
      markethashname: "P90 | 潜管作品 (Factory New)",
      basemarkethashname: "P90 | 潜管作品",
      rarity: "工业级",
      collection: "2025 列车停放站收藏品"
    })]
  });
  app.renderTradeupSimulationPickerModal = () => {};
  app.renderTradeupSimulationPickerResults = () => {};

  const selected = await app.selectTradeupSimulationPickerItem(0);

  assert.equal(selected, false);
  assert.equal(app.state.simulationPickerOpen, true);
  assert.equal(app.state.simulationPickerMode, "aux_material");
  assert.equal(app.state.simulationPickerQuery, "p90");
  assert.equal(app.state.simulationPickerResults.length, 1);
  assert.equal(app.state.simulationWorkspacePreset.aux_material, null);
  assert.deepEqual(
    app.errorToasts,
    ["单配方需同一稀有度：当前为 军规级，不能添加 工业级"]
  );
}

async function test_select_tradeup_simulation_picker_item_blocks_lowest_collection_rarity_for_outputs() {
  const preset = {
    id: "preset_output_lowest_block",
    name: "产物最低级禁入",
    primary_output: null,
    aux_output: null,
    main_material: createSimulationItem({
      markethashname: "Five-SeveN | 混沌点阵 (Field-Tested)",
      basemarkethashname: "Five-SeveN | 混沌点阵",
      rarity: "军规级",
      collection: "狂牙大行动收藏品"
    }),
    aux_material: null,
    cover_output: null,
    active_anchor_item: null,
    active_anchor_abs_wear: 0.18,
    output_rows: [],
    material_rows: [],
    output_candidates: []
  };
  const app = loadSimulationFns({
    simulationPresets: [preset],
    simulationActivePresetId: "preset_output_lowest_block",
    simulationWorkspaceSourcePresetId: "preset_output_lowest_block",
    simulationWorkspacePreset: {
      ...preset,
      dirty: false
    },
    simulationPickerOpen: true,
    simulationPickerMode: "primary_output",
    simulationPickerQuery: "跑跑跑",
    simulationPickerResults: [{
      ...createSimulationItem({
        markethashname: "XM1014 | 跑跑跑 (Factory New)",
        basemarkethashname: "XM1014 | 跑跑跑",
        rarity: "工业级",
        collection: "2025 列车停放站收藏品"
      }),
      collection_lowest_rarity: "工业级",
      is_collection_lowest_rarity: true
    }]
  });
  app.renderTradeupSimulationPickerModal = () => {};
  app.renderTradeupSimulationPickerResults = () => {};

  const selected = await app.selectTradeupSimulationPickerItem(0);

  assert.equal(selected, false);
  assert.equal(app.state.simulationPickerOpen, true);
  assert.equal(app.state.simulationWorkspacePreset.primary_output, null);
  assert.deepEqual(
    app.errorToasts,
    ["该收藏品最低级，不能作为产物添加"]
  );
}

async function test_select_tradeup_simulation_picker_item_blocks_limited_collection_for_materials() {
  const preset = {
    id: "preset_material_limited_block",
    name: "限量版禁入",
    primary_output: null,
    aux_output: null,
    main_material: null,
    aux_material: null,
    cover_output: null,
    active_anchor_item: null,
    active_anchor_abs_wear: 0.18,
    output_rows: [],
    material_rows: [],
    output_candidates: []
  };
  const app = loadSimulationFns({
    simulationPresets: [preset],
    simulationActivePresetId: "preset_material_limited_block",
    simulationWorkspaceSourcePresetId: "preset_material_limited_block",
    simulationWorkspacePreset: {
      ...preset,
      dirty: false
    },
    simulationPickerOpen: true,
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
  app.renderTradeupSimulationPickerModal = () => {};
  app.renderTradeupSimulationPickerResults = () => {};

  const selected = await app.selectTradeupSimulationPickerItem(0);

  assert.equal(selected, false);
  assert.equal(app.state.simulationPickerOpen, true);
  assert.equal(app.state.simulationWorkspacePreset.main_material, null);
  assert.deepEqual(
    app.errorToasts,
    ["限量版物品不能加入炼金"]
  );
}

async function test_select_tradeup_simulation_picker_item_accepts_matching_rarity_and_closes_picker() {
  const lockedItem = createSimulationItem({
    markethashname: "USP-S | Cortex (Field-Tested)",
    basemarkethashname: "USP-S | Cortex",
    rarity: "军规级",
    collection: "狂牙大行动收藏品"
  });
  const preset = {
    id: "preset_rarity_match",
    name: "品级匹配",
    primary_output: lockedItem,
    aux_output: null,
    main_material: null,
    aux_material: null,
    cover_output: lockedItem,
    active_anchor_item: lockedItem,
    active_anchor_abs_wear: 0.18,
    output_rows: [],
    material_rows: [],
    output_candidates: []
  };
  const app = loadSimulationFns({
    simulationPresets: [preset],
    simulationActivePresetId: "preset_rarity_match",
    simulationWorkspaceSourcePresetId: "preset_rarity_match",
    simulationWorkspacePreset: {
      ...preset,
      dirty: false
    },
    simulationPickerOpen: true,
    simulationPickerMode: "aux_material",
    simulationPickerQuery: "mac10",
    simulationPickerResults: [createSimulationItem({
      markethashname: "MAC-10 | 脱轨 (Field-Tested)",
      basemarkethashname: "MAC-10 | 脱轨",
      rarity: "军规级",
      collection: "2025 列车停放站收藏品",
      minfloat: 0.05,
      maxfloat: 0.7
    })]
  });
  app.renderTradeupSimulationPickerModal = () => {};
  app.renderTradeupSimulationPickerResults = () => {};
  app.renderSimulationPage = () => {};
  app.refreshTradeupSimulationDerivedOutputs = async () => true;
  app.resolveTradeupSimulationPreset = async () => true;

  const selected = await app.selectTradeupSimulationPickerItem(0);

  assert.equal(selected, true);
  assert.equal(app.state.simulationPickerOpen, false);
  assert.equal(app.state.simulationWorkspacePreset.aux_material.basemarkethashname, "MAC-10 | 脱轨");
  assert.equal(
    app.state.simulationWorkspacePreset.active_anchor_abs_wear,
    0.167,
    "adding an auxiliary material should inherit the current relative wear onto the new item's range instead of resetting it to the new item's minfloat"
  );
  assert.deepEqual(app.errorToasts, []);
}

async function test_select_tradeup_simulation_picker_item_allows_material_rarity_to_differ_from_output_side_lock() {
  const primaryOutput = createSimulationItem({
    markethashname: "USP-S | Cortex (Field-Tested)",
    basemarkethashname: "USP-S | Cortex",
    rarity: "受限",
    collection: "狂牙大行动收藏品"
  });
  const preset = {
    id: "preset_independent_rarity_lock",
    name: "左右分别锁品级",
    primary_output: primaryOutput,
    aux_output: createSimulationItem({
      markethashname: "P250 | 随便玩玩 (Field-Tested)",
      basemarkethashname: "P250 | 随便玩玩",
      rarity: "受限",
      collection: "裂网大行动收藏品"
    }),
    main_material: null,
    aux_material: null,
    cover_output: primaryOutput,
    active_anchor_item: primaryOutput,
    active_anchor_abs_wear: 0.18,
    output_rows: [],
    material_rows: [],
    output_candidates: [primaryOutput]
  };
  const app = loadSimulationFns({
    simulationPresets: [preset],
    simulationActivePresetId: "preset_independent_rarity_lock",
    simulationWorkspaceSourcePresetId: "preset_independent_rarity_lock",
    simulationWorkspacePreset: {
      ...preset,
      dirty: false
    },
    simulationPickerOpen: true,
    simulationPickerMode: "main_material",
    simulationPickerQuery: "five seven",
    simulationPickerResults: [createSimulationItem({
      markethashname: "Five-SeveN | 混沌点阵 (Field-Tested)",
      basemarkethashname: "Five-SeveN | 混沌点阵",
      rarity: "军规级",
      collection: "狂牙大行动收藏品",
      minfloat: 0.02,
      maxfloat: 0.78
    })]
  });
  app.renderTradeupSimulationPickerModal = () => {};
  app.renderTradeupSimulationPickerResults = () => {};
  app.renderSimulationPage = () => {};
  app.refreshTradeupSimulationDerivedOutputs = async () => true;
  app.resolveTradeupSimulationPreset = async () => true;

  const selected = await app.selectTradeupSimulationPickerItem(0);

  assert.equal(selected, true);
  assert.equal(app.state.simulationPickerOpen, false);
  assert.equal(app.state.simulationWorkspacePreset.main_material.basemarkethashname, "Five-SeveN | 混沌点阵");
  assert.deepEqual(app.errorToasts, []);
}

async function test_select_tradeup_simulation_picker_item_allows_lowest_collection_rarity_for_materials() {
  const preset = {
    id: "preset_material_lowest_ok",
    name: "材料最低级允许",
    primary_output: null,
    aux_output: null,
    main_material: null,
    aux_material: null,
    cover_output: null,
    active_anchor_item: null,
    active_anchor_abs_wear: 0.18,
    output_rows: [],
    material_rows: [],
    output_candidates: []
  };
  const app = loadSimulationFns({
    simulationPresets: [preset],
    simulationActivePresetId: "preset_material_lowest_ok",
    simulationWorkspaceSourcePresetId: "preset_material_lowest_ok",
    simulationWorkspacePreset: {
      ...preset,
      dirty: false
    },
    simulationPickerOpen: true,
    simulationPickerMode: "main_material",
    simulationPickerQuery: "跑跑跑",
    simulationPickerResults: [{
      ...createSimulationItem({
        markethashname: "XM1014 | 跑跑跑 (Factory New)",
        basemarkethashname: "XM1014 | 跑跑跑",
        rarity: "工业级",
        collection: "2025 列车停放站收藏品",
        minfloat: 0.02,
        maxfloat: 0.78
      }),
      collection_lowest_rarity: "工业级",
      is_collection_lowest_rarity: true
    }]
  });
  app.renderTradeupSimulationPickerModal = () => {};
  app.renderTradeupSimulationPickerResults = () => {};
  app.renderSimulationPage = () => {};
  app.refreshTradeupSimulationDerivedOutputs = async () => true;
  app.resolveTradeupSimulationPreset = async () => true;

  const selected = await app.selectTradeupSimulationPickerItem(0);

  assert.equal(selected, true);
  assert.equal(app.state.simulationPickerOpen, false);
  assert.equal(app.state.simulationWorkspacePreset.main_material.basemarkethashname, "XM1014 | 跑跑跑");
  assert.deepEqual(app.errorToasts, []);
}

async function test_select_tradeup_simulation_picker_item_blocks_mixed_output_rarity_without_closing_picker() {
  const lockedItem = createSimulationItem({
    markethashname: "USP-S | Cortex (Field-Tested)",
    basemarkethashname: "USP-S | Cortex",
    rarity: "军规级",
    collection: "狂牙大行动收藏品"
  });
  const preset = {
    id: "preset_output_rarity_lock",
    name: "产物品级锁定",
    primary_output: lockedItem,
    aux_output: null,
    main_material: createSimulationItem({
      markethashname: "Five-SeveN | 混沌点阵 (Field-Tested)",
      basemarkethashname: "Five-SeveN | 混沌点阵",
      rarity: "工业级",
      collection: "狂牙大行动收藏品"
    }),
    aux_material: null,
    cover_output: lockedItem,
    active_anchor_item: lockedItem,
    active_anchor_abs_wear: 0.18,
    output_rows: [],
    material_rows: [],
    output_candidates: []
  };
  const app = loadSimulationFns({
    simulationPresets: [preset],
    simulationActivePresetId: "preset_output_rarity_lock",
    simulationWorkspaceSourcePresetId: "preset_output_rarity_lock",
    simulationWorkspacePreset: {
      ...preset,
      dirty: false
    },
    simulationPickerOpen: true,
    simulationPickerMode: "aux_output",
    simulationPickerQuery: "p90",
    simulationPickerResults: [createSimulationItem({
      markethashname: "P90 | 潜管作品 (Factory New)",
      basemarkethashname: "P90 | 潜管作品",
      rarity: "工业级",
      collection: "2025 列车停放站收藏品"
    })]
  });
  app.renderTradeupSimulationPickerModal = () => {};
  app.renderTradeupSimulationPickerResults = () => {};

  const selected = await app.selectTradeupSimulationPickerItem(0);

  assert.equal(selected, false);
  assert.equal(app.state.simulationPickerOpen, true);
  assert.equal(app.state.simulationWorkspacePreset.aux_output, null);
  assert.deepEqual(
    app.errorToasts,
    ["单配方需同一稀有度：当前为 军规级，不能添加 工业级"]
  );
}

function test_open_tradeup_simulation_item_modal_allows_material_slot_editing() {
  const mainMaterial = createSimulationItem({
    markethashname: "Five-SeveN | 混沌点阵 (Field-Tested)",
    basemarkethashname: "Five-SeveN | 混沌点阵",
    collection: "狂牙大行动收藏品",
    minfloat: 0.02,
    maxfloat: 0.78
  });
  const preset = {
    id: "preset_material_edit",
    name: "材料精修",
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
    active_anchor_abs_wear: 0.31,
    output_rows: [],
    material_rows: []
  };
  const app = loadSimulationFns({
    simulationPresets: [preset],
    simulationActivePresetId: "preset_material_edit",
    simulationWorkspaceSourcePresetId: "preset_material_edit",
    simulationWorkspacePreset: {
      ...preset,
      dirty: false
    }
  });

  const opened = app.openTradeupSimulationItemModal({
    presetId: "preset_material_edit",
    slot: "main_material",
    itemType: "material",
    item: mainMaterial,
    mode: "edit"
  });

  assert.equal(opened, true);
  assert.equal(app.state.simulationModalOpen, true);
  assert.equal(
    app.state.simulationModalMode,
    "edit",
    "material slots should open an editable wear modal so clicking a material can modify absolute wear"
  );
}

function test_focus_tradeup_simulation_modal_primary_control_preserves_zero_prefix_selection() {
  const app = loadSimulationFns({
    simulationModalOpen: true,
    simulationModalMode: "edit"
  });
  const input = {
    disabled: false,
    value: "0.123456",
    focusCalls: 0,
    selectCalls: 0,
    selectionStart: -1,
    selectionEnd: -1,
    focus() {
      this.focusCalls += 1;
    },
    select() {
      this.selectCalls += 1;
    },
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    }
  };
  app.ui.simulationCardModalWearInput = input;

  app.focusTradeupSimulationModalPrimaryControl();

  assert.equal(input.focusCalls, 1);
  assert.equal(input.selectionStart, 2);
  assert.equal(input.selectionEnd, input.value.length);
  assert.equal(input.selectCalls, 0);
}

function test_resolve_tradeup_simulation_edit_slot_prefers_matching_material_collection() {
  const app = loadSimulationFns();
  const preset = {
    main_material: createSimulationItem({
      markethashname: "Five-SeveN | 混沌点阵 (Field-Tested)",
      basemarkethashname: "Five-SeveN | 混沌点阵",
      collection: "狂牙大行动收藏品"
    }),
    aux_material: createSimulationItem({
      markethashname: "P250 | 随便玩玩 (Field-Tested)",
      basemarkethashname: "P250 | 随便玩玩",
      collection: "裂网大行动收藏品"
    })
  };
  const clickedItem = createSimulationItem({
    markethashname: "Glock-18 | 锈蚀烈焰 (Minimal Wear)",
    basemarkethashname: "Glock-18 | 锈蚀烈焰",
    collection: "狂牙大行动收藏品"
  });

  const slot = app.resolveTradeupSimulationEditSlot(preset, clickedItem, "material");

  assert.equal(
    slot,
    "main_material",
    "material cards rendered under a collection lane should inherit the matching material slot so edits target the correct anchor"
  );
}

function test_render_simulation_card_modal_renders_without_role_label_reference_error() {
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
  assert.match(app.ui.simulationCardModalBody.innerHTML, /当前绝对磨损/);
  assert.match(app.ui.simulationCardModalBody.innerHTML, /Five-SeveN \| 混沌点阵/);
  assert.doesNotMatch(app.ui.simulationCardModalBody.innerHTML, /主料|辅料|主产物|辅产物/);
}

async function main() {
  test_normalize_tradeup_simulation_preset_list_preserves_dual_slot_shape();
  test_normalize_tradeup_simulation_preset_list_migrates_legacy_target_into_primary_cover();
  test_normalize_tradeup_simulation_preset_list_drops_restricted_output_presets();
  test_normalize_tradeup_simulation_preset_list_drops_lowest_collection_output_presets();
  await test_save_tradeup_simulation_presets_to_storage_writes_new_slot_shape();
  test_open_blank_tradeup_simulation_workspace_draft_starts_with_empty_four_slots();
  test_open_tradeup_simulation_workspace_draft_reuses_existing_unsaved_draft();
  test_open_tradeup_simulation_workspace_draft_strips_restricted_items_from_existing_unsaved_draft();
  test_set_tradeup_simulation_active_preset_loads_workspace_draft_without_mutating_saved_entry();
  await test_persist_tradeup_simulation_presets_saves_workspace_draft_into_saved_list();
  await test_persist_tradeup_simulation_presets_strips_restricted_materials_before_saving();
  await test_load_tradeup_simulation_presets_from_storage_backfills_legacy_lowest_output_metadata();
  await test_load_tradeup_simulation_presets_from_storage_keeps_valid_presets_beyond_legacy_invalid_cap();
  await test_load_tradeup_simulation_presets_from_server_keeps_valid_presets_beyond_legacy_invalid_cap();
  test_apply_tradeup_simulation_slot_selection_sets_cover_for_primary_output();
  test_build_tradeup_simulation_derived_output_payload_ignores_restricted_material_grouping();
  await test_refresh_tradeup_simulation_derived_outputs_surfaces_prediction_failure_without_dropping_material();
  await test_refresh_tradeup_simulation_derived_outputs_surfaces_missing_invalid_and_empty_outcomes();
  await test_refresh_tradeup_simulation_derived_outputs_ignores_stale_failure_after_material_change();
  await test_refresh_tradeup_simulation_derived_outputs_ignores_stale_success_after_material_change();
  test_sanitize_tradeup_simulation_draft_payload_replaces_lowest_output_anchor();
  test_open_tradeup_simulation_picker_modal_records_slot_context();
  test_adopt_tradeup_simulation_derived_primary_output_uses_random_cover_when_missing();
  test_apply_tradeup_simulation_slot_selection_preserves_cover_when_material_changes();
  test_apply_tradeup_simulation_material_selection_invalidates_stale_derived_projection();
  test_render_simulation_lane_section_marks_single_card_rows();
  test_build_tradeup_simulation_saved_card_summary_uses_wear_tier_and_relative_wear();
  await test_save_active_tradeup_simulation_preset_uses_prompted_name_before_persisting();
  await test_save_active_tradeup_simulation_preset_stops_when_name_prompt_is_cancelled();
  test_render_simulation_selected_output_card_uses_item_rarity_color_even_when_anchor_active();
  test_render_simulation_selected_output_card_applies_wear_tone_class_to_badge();
  test_render_simulation_selected_output_card_applies_factory_new_tone_class_to_bar();
  test_render_simulation_selected_material_card_applies_wear_tone_classes();
  test_render_simulation_material_grid_shows_selected_material_before_output_derivation();
  test_render_simulation_grids_escape_prediction_warning();
  test_render_tradeup_simulation_selection_style_card_preserves_explicit_wear_tone_spacing();
  test_sim_export_craft_preset_converts_anchor_absolute_wear_to_relative_target_wear();
  await test_delete_tradeup_simulation_preset_removes_saved_entry_and_persists();
  await test_tradeup_simulation_picker_search_ignores_stale_response_after_reopen();
  await test_tradeup_simulation_picker_search_rerenders_full_modal_state();
  await test_tradeup_simulation_picker_clear_search_invalidates_pending_response();
  await test_tradeup_simulation_picker_ignores_out_of_order_search_responses();
  await test_tradeup_simulation_picker_search_failure_sets_consistent_error_state();
  test_tradeup_simulation_picker_context_warns_outputs_about_lowest_collection_rarity();
  test_render_tradeup_simulation_picker_results_hides_lowest_output_candidates();
  test_render_tradeup_simulation_picker_results_hides_limited_collection_candidates_for_materials();
  await test_select_tradeup_simulation_picker_item_blocks_mixed_material_rarity_without_closing_picker();
  await test_select_tradeup_simulation_picker_item_blocks_lowest_collection_rarity_for_outputs();
  await test_select_tradeup_simulation_picker_item_blocks_limited_collection_for_materials();
  await test_select_tradeup_simulation_picker_item_accepts_matching_rarity_and_closes_picker();
  await test_select_tradeup_simulation_picker_item_allows_material_rarity_to_differ_from_output_side_lock();
  await test_select_tradeup_simulation_picker_item_allows_lowest_collection_rarity_for_materials();
  await test_select_tradeup_simulation_picker_item_blocks_mixed_output_rarity_without_closing_picker();
  test_open_tradeup_simulation_item_modal_allows_material_slot_editing();
  test_focus_tradeup_simulation_modal_primary_control_preserves_zero_prefix_selection();
  test_resolve_tradeup_simulation_edit_slot_prefers_matching_material_collection();
  test_render_simulation_card_modal_renders_without_role_label_reference_error();
  console.log("tradeup-simulation-page-state tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
