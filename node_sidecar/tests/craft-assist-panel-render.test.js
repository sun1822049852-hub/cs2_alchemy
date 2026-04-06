const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const craftAssistItemWearShared = require("../ui/craftAssistItemWearShared");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

function createClassList(initial = []) {
  const set = new Set(initial);
  return {
    toggle(name, force) {
      if (force === true) {
        set.add(name);
        return true;
      }
      if (force === false) {
        set.delete(name);
        return false;
      }
      if (set.has(name)) {
        set.delete(name);
        return false;
      }
      set.add(name);
      return true;
    },
    contains(name) {
      return set.has(name);
    }
  };
}

function createButton() {
  return {
    classList: createClassList(),
    attrs: {},
    textContent: "",
    disabled: false,
    setAttribute(name, value) {
      this.attrs[name] = value;
    }
  };
}

function createStyle() {
  const values = Object.create(null);
  return {
    values,
    setProperty(name, value) {
      values[name] = String(value);
    },
    getPropertyValue(name) {
      return values[name] || "";
    }
  };
}

function createDomClassList(initial = []) {
  const set = new Set(initial);
  return {
    add(name) {
      if (!name) return;
      set.add(String(name));
    },
    remove(name) {
      set.delete(String(name));
    },
    toggle(name, force) {
      const key = String(name);
      if (force === true) {
        set.add(key);
        return true;
      }
      if (force === false) {
        set.delete(key);
        return false;
      }
      if (set.has(key)) {
        set.delete(key);
        return false;
      }
      set.add(key);
      return true;
    },
    contains(name) {
      return set.has(String(name));
    },
    toArray() {
      return [...set];
    },
    toString() {
      return [...set].join(" ");
    },
    reset(names) {
      set.clear();
      for (const name of names) {
        if (name) set.add(String(name));
      }
    }
  };
}

function createDomNode(tagName, ownerDocument = null) {
  const node = {
    tagName: String(tagName || "div").toUpperCase(),
    ownerDocument,
    children: [],
    parentNode: null,
    attrs: {},
    dataset: {},
    style: createStyle(),
    classList: createDomClassList(),
    disabled: false,
    title: "",
    type: "",
    value: "",
    placeholder: "",
    inputMode: "",
    min: "",
    max: "",
    step: "",
    checked: false,
    selectionStart: 0,
    selectionEnd: 0,
    _textContent: "",
    append(...nodes) {
      for (const child of nodes) {
        if (!child) continue;
        child.parentNode = this;
        this.children.push(child);
      }
    },
    replaceChildren(...nodes) {
      this.children = [];
      this._textContent = "";
      this.append(...nodes);
    },
    setAttribute(name, value) {
      const key = String(name);
      const text = String(value);
      this.attrs[key] = text;
      if (key === "class") {
        this.className = text;
        return;
      }
      if (key === "aria-label") this.ariaLabel = text;
      if (key === "title") this.title = text;
    },
    getAttribute(name) {
      const key = String(name);
      if (key === "class") return this.className;
      return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : "";
    },
    focus() {
      if (this.ownerDocument) this.ownerDocument.activeElement = this;
    },
    blur() {
      if (this.ownerDocument && this.ownerDocument.activeElement === this) {
        this.ownerDocument.activeElement = null;
      }
    },
    setSelectionRange(start, end) {
      this.selectionStart = Number(start);
      this.selectionEnd = Number(end);
    },
    select() {
      const length = String(this.value || "").length;
      this.selectionStart = 0;
      this.selectionEnd = length;
    }
  };
  Object.defineProperty(node, "className", {
    get() {
      return node.classList.toString();
    },
    set(value) {
      const parts = String(value || "").split(/\s+/).filter(Boolean);
      node.classList.reset(parts);
    }
  });
  Object.defineProperty(node, "textContent", {
    get() {
      return [node._textContent, ...node.children.map((child) => child.textContent)].join("");
    },
    set(value) {
      node._textContent = String(value == null ? "" : value);
      node.children = [];
    }
  });
  return node;
}

function createDocument() {
  const document = {
    activeElement: null,
    createElement(tagName) {
      return createDomNode(tagName, document);
    }
  };
  return document;
}

function walkNodes(root, visitor) {
  if (!root || typeof root !== "object") return;
  visitor(root);
  for (const child of root.children || []) {
    walkNodes(child, visitor);
  }
}

function findAllByClass(root, className) {
  const matches = [];
  walkNodes(root, (node) => {
    if (node && node.classList && node.classList.contains(className)) {
      matches.push(node);
    }
  });
  return matches;
}

function findFirstByClass(root, className) {
  return findAllByClass(root, className)[0] || null;
}

function findAllByTag(root, tagName) {
  const normalized = String(tagName || "").toUpperCase();
  const matches = [];
  walkNodes(root, (node) => {
    if (String(node && node.tagName || "") === normalized) {
      matches.push(node);
    }
  });
  return matches;
}

function isDescendant(root, target) {
  let current = target;
  while (current) {
    if (current === root) return true;
    current = current.parentNode || null;
  }
  return false;
}

function normalizeCraftAssistNamesForTest(material) {
  if (Array.isArray(material && material.items)) {
    return material.items
      .map((item) => String(item && item.name || "").trim())
      .filter(Boolean);
  }
  if (Array.isArray(material && material.names)) {
    return material.names
      .map((name) => String(name || "").trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeCraftAssistItemsForTest(material) {
  const materialId = String(material && material.id || "assist_group").trim() || "assist_group";
  return (Array.isArray(material && material.items) ? material.items : [])
    .map((item, index) => ({
      id: String(item && item.id || `${materialId}__${index + 1}`).trim() || `${materialId}__${index + 1}`,
      name: String(item && item.name || "").trim(),
      wear_filter_mode: String(item && item.wear_filter_mode || "").trim() === "absolute" ? "absolute" : "relative",
      wear_min: item && item.wear_min != null ? Number(item.wear_min) : 0,
      wear_max: item && item.wear_max != null ? Number(item.wear_max) : 1,
      custom_range: !!(item && item.custom_range)
    }))
    .filter((item) => item.name);
}

function createCraftAssistItem(overrides = {}) {
  return {
    id: overrides.id || "assist_item_1",
    name: overrides.name || "AK-47 | Redline (Field-Tested)",
    wear_filter_mode: overrides.wear_filter_mode || "relative",
    wear_min: overrides.wear_min == null ? 0.111111 : overrides.wear_min,
    wear_max: overrides.wear_max == null ? 0.333333 : overrides.wear_max,
    custom_range: overrides.custom_range !== undefined ? overrides.custom_range : true
  };
}

function createCraftAssistMaterial(overrides = {}) {
  return {
    id: overrides.id || "assist_group_1",
    role: overrides.role || "main",
    count: overrides.count == null ? 2 : overrides.count,
    items: overrides.items || [
      createCraftAssistItem({
        id: "assist_group_1__1",
        name: "AK-47 | Redline (Field-Tested)",
        wear_filter_mode: "relative",
        wear_min: 0.111111,
        wear_max: 0.222222
      }),
      createCraftAssistItem({
        id: "assist_group_1__2",
        name: "M4A4 | Buzz Kill (Minimal Wear)",
        wear_filter_mode: "absolute",
        wear_min: 0.07,
        wear_max: 0.15
      })
    ]
  };
}

function loadPanelFns(overrides = {}) {
  const source = [
    extractBlock("function setCraftAssistPanelOpen(", "function setCraftAssistRoleChooserOpen("),
    extractBlock("function renderCraftAssistPanel(", "function renderCraftQueue(")
  ].join("\n");
  const context = {
    state: overrides.state,
    ui: overrides.ui,
    clearTimeout,
    isCraftAssistPresetEditing: overrides.isCraftAssistPresetEditing,
    stopCraftAssistOverlayDrag: overrides.stopCraftAssistOverlayDrag,
    stopCraftAssistSplitDrag: overrides.stopCraftAssistSplitDrag,
    cancelCraftAssistPresetEditingSession: overrides.cancelCraftAssistPresetEditingSession,
    renderCraftAssistPanel: overrides.renderCraftAssistPanel,
    expandCraftAssistOverlayToBottom: overrides.expandCraftAssistOverlayToBottom,
    applyCraftAssistOverlayHeight: overrides.applyCraftAssistOverlayHeight,
    applyCraftAssistPresetWidth: overrides.applyCraftAssistPresetWidth || (() => {}),
    syncCraftSelectionListClearance: overrides.syncCraftSelectionListClearance,
    isCraftAssistPendingUiAction: overrides.isCraftAssistPendingUiAction,
    parseOptionalWear01: overrides.parseOptionalWear01,
    wearTextFull: overrides.wearTextFull || ((value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric.toFixed(6) : "";
    }),
    wearText6: overrides.wearText6,
    getCraftAssistFilterMode: overrides.getCraftAssistFilterMode,
    normalizeCraftAssistCount: overrides.normalizeCraftAssistCount,
    renderCraftAssistPicker: overrides.renderCraftAssistPicker,
    renderCraftAssistList: overrides.renderCraftAssistList,
    renderCraftAssistPresetPanel: overrides.renderCraftAssistPresetPanel,
    coalesceCraftAssistMaterialRoleBuckets: overrides.coalesceCraftAssistMaterialRoleBuckets || ((materials) => Array.isArray(materials) ? materials : []),
    String,
    Number,
    console,
    document: {activeElement: null}
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function loadRenderListFns(overrides = {}) {
  const source = extractBlock("function renderCraftAssistList(", "function calcCraftAssistMaterialTotalCount(");
  const document = createDocument();
  const state = overrides.state || {
    craftAssistMaterials: [],
    craftAssistPickRole: "main"
  };
  const ui = overrides.ui || {
    craftAssistList: document.createElement("div")
  };
  const context = {
    state,
    ui,
    document,
    requestAnimationFrame: (callback) => {
      if (typeof callback === "function") callback();
    },
    syncCraftAssistAutoDirectionLimit: overrides.syncCraftAssistAutoDirectionLimit || (() => {}),
    getCraftAssistFilterUseRelative: overrides.getCraftAssistFilterUseRelative || (() => true),
    wearTextFull: overrides.wearTextFull || ((value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric.toFixed(6) : "";
    }),
    craftAssistMaterialNames: overrides.craftAssistMaterialNames || normalizeCraftAssistNamesForTest,
    craftAssistMaterialItems: overrides.craftAssistMaterialItems || normalizeCraftAssistItemsForTest,
    resolveCraftAssistMaterialEffectiveRange: overrides.resolveCraftAssistMaterialEffectiveRange || (() => ({
      constraint_min: 0,
      constraint_max: 1,
      wear_min: 0,
      wear_max: 1
    })),
    resolveCraftAssistItemEffectiveRange: overrides.resolveCraftAssistItemEffectiveRange || ((item) => ({
      constraint_min: 0,
      constraint_max: 1,
      use_relative: String(item && item.wear_filter_mode || "").trim() !== "absolute",
      wear_min: Number(item && item.wear_min != null ? item.wear_min : 0),
      wear_max: Number(item && item.wear_max != null ? item.wear_max : 1),
      custom_range: !!(item && item.custom_range)
    })),
    normalizeCraftAssistRole: overrides.normalizeCraftAssistRole || ((role) => String(role || "").trim() === "aux" ? "aux" : "main"),
    normalizeCraftAssistFilterMode: overrides.normalizeCraftAssistFilterMode || ((mode) => String(mode || "").trim() === "absolute" ? "absolute" : "relative"),
    openCraftAssistPicker: overrides.openCraftAssistPicker || (() => {}),
    normalizeCraftAssistEntryCount: overrides.normalizeCraftAssistEntryCount || ((value, fallback) => {
      const numeric = Math.trunc(Number(value));
      if (!Number.isFinite(numeric) || numeric <= 0) {
        return Math.max(1, Math.trunc(Number(fallback) || 1));
      }
      return numeric;
    }),
    craftAssistMaterialLimitFor: overrides.craftAssistMaterialLimitFor || (() => 10),
    calcCraftAssistLiveTotalCount: overrides.calcCraftAssistLiveTotalCount || ((materials) => {
      return (Array.isArray(materials) ? materials : []).reduce((sum, entry) => {
        const numeric = Math.trunc(Number(entry && entry.count));
        return sum + (Number.isFinite(numeric) && numeric > 0 ? numeric : 1);
      }, 0);
    }),
    setCraftStatus: overrides.setCraftStatus || (() => {}),
    updateCraftAssistMaterial: overrides.updateCraftAssistMaterial || (() => {}),
    updateCraftAssistMaterialItems: overrides.updateCraftAssistMaterialItems || (() => false),
    renderCraftAssistPanel: overrides.renderCraftAssistPanel || (() => {}),
    parseCraftAssistRangeInputValue: overrides.parseCraftAssistRangeInputValue || ((value) => {
      const numeric = Number(String(value == null ? "" : value).trim());
      return Number.isFinite(numeric) ? numeric : null;
    }),
    clampWearToRange: overrides.clampWearToRange || ((value, min, max, fallback) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return Number.isFinite(Number(fallback)) ? Number(fallback) : Number(min);
      return Math.max(Number(min), Math.min(Number(max), numeric));
    }),
    seedCraftAssistDecimalInput: overrides.seedCraftAssistDecimalInput || (() => {}),
    removeCraftAssistMaterialName: overrides.removeCraftAssistMaterialName || (() => {}),
    removeCraftAssistMaterial: overrides.removeCraftAssistMaterial || (() => {}),
    removeCraftAssistMaterialItem: overrides.removeCraftAssistMaterialItem || (() => {}),
    getAllInventoryCraftableRows: overrides.getAllInventoryCraftableRows || (() => []),
    coalesceCraftAssistMaterialRoleBuckets: overrides.coalesceCraftAssistMaterialRoleBuckets || ((materials) => {
      const buckets = new Map();
      for (const material of Array.isArray(materials) ? materials : []) {
        const role = String(material && material.role || "").trim() === "aux" ? "aux" : "main";
        if (!buckets.has(role)) {
          buckets.set(role, {
            ...material,
            role,
            items: []
          });
        }
        const bucket = buckets.get(role);
        bucket.count = Number(bucket.count || 0) + Number(material && material.count || 0);
        for (const item of normalizeCraftAssistItemsForTest(material)) {
          const name = String(item && item.name || "").trim();
          if (!name) continue;
          if (bucket.items.some((entry) => String(entry && entry.name || "").trim() === name)) continue;
          bucket.items.push({...item});
        }
      }
      return ["main", "aux"].filter((role) => buckets.has(role)).map((role) => buckets.get(role));
    }),
    craftAssistItemWearShared,
    console,
    String,
    Number
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function loadCraftAssistDecimalInputFns(overrides = {}) {
  const source = extractBlock("function seedCraftAssistDecimalInput(", "function renderCraftAssistList(");
  const context = {
    requestAnimationFrame: overrides.requestAnimationFrame || ((callback) => {
      if (typeof callback === "function") callback();
    }),
    parseOptionalWear01: overrides.parseOptionalWear01 || ((value) => {
      const text = String(value == null ? "" : value).trim();
      if (!text) return null;
      const numeric = Number(text);
      return Number.isFinite(numeric) ? numeric : null;
    }),
    wearTextFull: overrides.wearTextFull || ((value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric.toFixed(6) : "";
    }),
    console,
    String,
    Number
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function loadPickerFns(overrides = {}) {
  const source = extractBlock("function renderCraftAssistPicker(", "function parseCraftAssistRangeInputValue(");
  const document = createDocument();
  const state = overrides.state || {
    craftAssistOpen: true,
    craftAssistPickerOpen: true,
    craftAssistPickerTargetMaterialId: "",
    craftAssistMaterials: []
  };
  const ui = overrides.ui || {
    craftAssistPicker: document.createElement("div")
  };
  const context = {
    state,
    ui,
    document,
    craftAssistMaterialNames: overrides.craftAssistMaterialNames || normalizeCraftAssistNamesForTest,
    craftAssistMaterialLabel: overrides.craftAssistMaterialLabel || ((material) => normalizeCraftAssistNamesForTest(material).join(" / ")),
    buildCraftAssistParentGroups: overrides.buildCraftAssistParentGroups || (() => []),
    craftAssistMaterialLimitFor: overrides.craftAssistMaterialLimitFor || (() => 10),
    calcCraftAssistLiveTotalCount: overrides.calcCraftAssistLiveTotalCount || ((materials) => {
      return (Array.isArray(materials) ? materials : []).reduce((sum, entry) => sum + Number(entry && entry.count || 0), 0);
    }),
    addCraftAssistMaterialByName: overrides.addCraftAssistMaterialByName || (() => {}),
    String,
    Number,
    Array,
    Set,
    Map,
    console
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function loadAddMaterialFns(overrides = {}) {
  const source = extractBlock("function addCraftAssistMaterialByName(", "function removeCraftAssistMaterial(");
  const state = overrides.state || {
    craftAssistMaterials: [],
    craftAssistPickRole: "main",
    craftAssistPickerOpen: true,
    craftAssistRoleChooserOpen: true,
    craftAssistPickerTargetMaterialId: ""
  };
  const context = {
    state,
    normalizeCraftAssistRole: overrides.normalizeCraftAssistRole || ((role) => String(role || "").trim() === "aux" ? "aux" : "main"),
    craftAssistMaterialNames: overrides.craftAssistMaterialNames || normalizeCraftAssistNamesForTest,
    createCraftAssistMaterialItem: overrides.createCraftAssistMaterialItem || ((name) => ({
      id: `${String(name || "").trim()}__item`,
      name: String(name || "").trim(),
      wear_filter_mode: "relative",
      wear_min: 0,
      wear_max: 1,
      custom_range: false
    })),
    updateCraftAssistMaterialItems: overrides.updateCraftAssistMaterialItems || (() => false),
    buildCraftAssistParentGroups: overrides.buildCraftAssistParentGroups || (() => []),
    normalizeCraftPredictorRarityLabel: overrides.normalizeCraftPredictorRarityLabel || ((value) => String(value || "")),
    setCraftStatus: overrides.setCraftStatus || (() => {}),
    createCraftAssistMaterial: overrides.createCraftAssistMaterial || ((name, role) => ({
      id: `${String(role || "main").trim()}-bucket`,
      role,
      count: 1,
      items: [{id: `${String(role || "main").trim()}-bucket__1`, name}]
    })),
    craftAssistMaterialLimitFor: overrides.craftAssistMaterialLimitFor || (() => 10),
    calcCraftAssistLiveTotalCount: overrides.calcCraftAssistLiveTotalCount || ((materials) => {
      return (Array.isArray(materials) ? materials : []).reduce((sum, entry) => sum + Number(entry && entry.count || 0), 0);
    }),
    normalizeCraftAssistEntryCount: overrides.normalizeCraftAssistEntryCount || ((value, fallback) => {
      const numeric = Math.trunc(Number(value));
      return Number.isFinite(numeric) && numeric > 0 ? numeric : Math.max(1, Math.trunc(Number(fallback) || 1));
    }),
    syncCraftAssistAutoDirectionLimit: overrides.syncCraftAssistAutoDirectionLimit || (() => {}),
    renderCraftAssistPanel: overrides.renderCraftAssistPanel || (() => {}),
    String,
    Number,
    Array,
    Set,
    Map,
    console
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function loadSetPanelOpenOnly(overrides = {}) {
  const source = extractBlock("function setCraftAssistPanelOpen(", "function setCraftAssistRoleChooserOpen(");
  const context = {
    state: overrides.state,
    ui: overrides.ui,
    clearTimeout,
    isCraftAssistPresetEditing: overrides.isCraftAssistPresetEditing,
    stopCraftAssistOverlayDrag: overrides.stopCraftAssistOverlayDrag,
    stopCraftAssistSplitDrag: overrides.stopCraftAssistSplitDrag,
    cancelCraftAssistPresetEditingSession: overrides.cancelCraftAssistPresetEditingSession,
    renderCraftAssistPanel: overrides.renderCraftAssistPanel,
    expandCraftAssistOverlayToBottom: overrides.expandCraftAssistOverlayToBottom,
    applyCraftAssistOverlayHeight: overrides.applyCraftAssistOverlayHeight,
    applyCraftAssistPresetWidth: overrides.applyCraftAssistPresetWidth || (() => {}),
    craftAssistPickerCloseTimer: null,
    console
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function testOrdinaryRenderDoesNotTriggerClearancePreserve() {
  const applyCalls = [];
  const app = loadPanelFns({
    state: {
      craftAssistOpen: true,
      refreshing: false,
      craftBusy: false,
      craftAssistSelecting: false,
      craftAssistRoleChooserOpen: false,
      craftAssistMaterials: [],
      craftAssistTargetWear: null,
      craftAssistMainCount: 5,
      craftAssistAuxCount: 5
    },
    ui: {
      craftAssistPanel: {},
      craftAssistOverlay: {classList: createClassList()},
      craftAssistToggleBtn: createButton(),
      craftAssistApplyBtn: createButton(),
      craftAssistPresetSaveBtn: createButton()
    },
    isCraftAssistPresetEditing: () => false,
    stopCraftAssistOverlayDrag: () => {},
    stopCraftAssistSplitDrag: () => {},
    cancelCraftAssistPresetEditingSession: () => {},
    expandCraftAssistOverlayToBottom: () => {},
    applyCraftAssistOverlayHeight: (args) => {
      applyCalls.push(args);
    },
    syncCraftSelectionListClearance: () => {},
    isCraftAssistPendingUiAction: () => false,
    parseOptionalWear01: () => null,
    wearText6: () => "0.000000",
    getCraftAssistFilterMode: () => "relative",
    normalizeCraftAssistCount: (value, fallback) => fallback,
    renderCraftAssistPicker: () => {},
    renderCraftAssistList: () => {},
    renderCraftAssistPresetPanel: () => {}
  });

  app.renderCraftAssistPanel();

  assert.equal(applyCalls.length, 0, "ordinary panel rerender should not trigger overlay-height clearance sync");
}

function testOpeningPanelTriggersOnePreservedClearanceSync() {
  const applyCalls = [];
  const app = loadPanelFns({
    state: {
      craftAssistOpen: false,
      craftAssistPickerOpen: false,
      craftAssistPickerTargetMaterialId: "",
      craftAssistRoleChooserOpen: false
    },
    ui: {},
    isCraftAssistPresetEditing: () => false,
    stopCraftAssistOverlayDrag: () => {},
    stopCraftAssistSplitDrag: () => {},
    cancelCraftAssistPresetEditingSession: () => {},
    expandCraftAssistOverlayToBottom: () => {},
    applyCraftAssistOverlayHeight: (args) => {
      applyCalls.push(args);
    },
    syncCraftSelectionListClearance: () => {},
    isCraftAssistPendingUiAction: (action) => action === "panel_apply",
    parseOptionalWear01: () => null,
    wearText6: () => "0.000000",
    getCraftAssistFilterMode: () => "relative",
    normalizeCraftAssistCount: (value, fallback) => fallback,
    renderCraftAssistPicker: () => {},
    renderCraftAssistList: () => {},
    renderCraftAssistPresetPanel: () => {}
  });

  app.setCraftAssistPanelOpen(true, {expandOnOpen: true});

  assert.equal(JSON.stringify(applyCalls), JSON.stringify([{preserveVisibleBottom: true}]));
}

function testOpeningPanelAppliesReserveBeforeRenderingOverlay() {
  const calls = [];
  const app = loadSetPanelOpenOnly({
    state: {
      craftAssistOpen: false,
      craftAssistPickerOpen: false,
      craftAssistPickerTargetMaterialId: "",
      craftAssistRoleChooserOpen: false
    },
    ui: {},
    isCraftAssistPresetEditing: () => false,
    stopCraftAssistOverlayDrag: () => {},
    stopCraftAssistSplitDrag: () => {},
    cancelCraftAssistPresetEditingSession: () => {},
    expandCraftAssistOverlayToBottom: () => {
      calls.push("expand");
    },
    applyCraftAssistOverlayHeight: () => {
      calls.push("apply");
    },
    renderCraftAssistPanel: () => {
      calls.push("render");
    }
  });

  app.setCraftAssistPanelOpen(true, {expandOnOpen: true});

  assert.deepEqual(
    calls,
    ["expand", "apply", "render"],
    "opening the panel should reserve the selection list before the overlay is rendered visible"
  );
}

function testTargetWearInputShowsZeroDisplayWhenStateIsEmpty() {
  const document = createDocument();
  const targetWearInput = document.createElement("input");
  const app = loadPanelFns({
    state: {
      craftAssistOpen: true,
      refreshing: false,
      craftBusy: false,
      craftAssistSelecting: false,
      craftAssistRoleChooserOpen: false,
      craftAssistMaterials: [],
      craftAssistTargetWear: null,
      craftAssistMainCount: 5,
      craftAssistAuxCount: 5
    },
    ui: {
      craftAssistPanel: {},
      craftAssistOverlay: {classList: createClassList()},
      craftAssistToggleBtn: createButton(),
      craftAssistApplyBtn: createButton(),
      craftAssistPresetSaveBtn: createButton(),
      craftAssistTargetWear: targetWearInput
    },
    isCraftAssistPresetEditing: () => false,
    stopCraftAssistOverlayDrag: () => {},
    stopCraftAssistSplitDrag: () => {},
    cancelCraftAssistPresetEditingSession: () => {},
    expandCraftAssistOverlayToBottom: () => {},
    applyCraftAssistOverlayHeight: () => {},
    syncCraftSelectionListClearance: () => {},
    isCraftAssistPendingUiAction: () => false,
    parseOptionalWear01: (value) => value == null || String(value).trim() === "" ? null : Number(value),
    wearTextFull: (value) => Number(value).toFixed(6),
    wearText6: () => "0.000000",
    getCraftAssistFilterMode: () => "relative",
    normalizeCraftAssistCount: (value, fallback) => fallback,
    renderCraftAssistPicker: () => {},
    renderCraftAssistList: () => {},
    renderCraftAssistPresetPanel: () => {}
  });

  app.renderCraftAssistPanel();

  assert.equal(targetWearInput.placeholder, "0.000000", "empty target wear should expose 0.000000 as the placeholder baseline");
  assert.equal(targetWearInput.value, "0.000000", "empty target wear should render a visible 0.000000 baseline");
  assert.equal(targetWearInput.dataset.displayDefault, "1", "empty target wear baseline should be marked as a display-only default");
}

function testMaterialCardsRenderInsideOwningGroupAndLegacyStripIsGone() {
  const app = loadRenderListFns({
    state: {
      craftAssistMaterials: [createCraftAssistMaterial()],
      craftAssistPickRole: "main"
    }
  });

  app.renderCraftAssistList();

  const group = findFirstByClass(app.ui.craftAssistList, "craft-assist-item");
  assert.ok(group, "render should still create a material group root");
  assert.equal(
    findAllByClass(group, "craft-assist-selected-wrap").length,
    0,
    "selected materials should render as per-material item cards instead of the legacy selected-material strip"
  );
  const cardList = findFirstByClass(group, "craft-assist-material-card-list");
  assert.ok(cardList, "material group should render a dedicated item-card list");
  const cards = findAllByClass(group, "craft-assist-material-card");
  assert.equal(cards.length, 2, "each selected material should render as its own item card inside the owning material group");
  const titles = cards.map((card) => {
    const title = findFirstByClass(card, "craft-assist-material-card-title");
    return String(title && title.textContent || "").trim();
  });
  assert.deepEqual(
    titles,
    [
      "AK-47 | Redline (Field-Tested)",
      "M4A4 | Buzz Kill (Minimal Wear)"
    ],
    "item cards should render the selected material names under the owning group"
  );
}

function testQuantityControlMovesIntoConditionHeaderRightSide() {
  const app = loadRenderListFns({
    state: {
      craftAssistMaterials: [createCraftAssistMaterial({items: [createCraftAssistItem()]})],
      craftAssistPickRole: "main"
    }
  });

  app.renderCraftAssistList();

  const head = findFirstByClass(app.ui.craftAssistList, "craft-assist-item-head");
  assert.ok(head, "material group should render a condition header");
  const actions = findFirstByClass(head, "craft-assist-item-actions");
  assert.ok(actions, "condition header should expose a right-side action column for quantity and actions");
  const qtyField = findAllByClass(actions, "craft-assist-head-qty")[0] || null;
  assert.ok(qtyField, "quantity control should live in the condition header's right-side column");
  assert.equal(String(qtyField.textContent || "").includes("数量"), true, "header-side quantity control should keep the 数量 label");
  const strayQtyField = findAllByClass(app.ui.craftAssistList, "qty")
    .find((node) => !isDescendant(actions, node));
  assert.equal(
    !!strayQtyField,
    false,
    "quantity control should no longer render as a standalone material-level config row below the condition header"
  );
}

function testRoleTagReplacesLegacyConditionTitleAndStaysCompact() {
  const app = loadRenderListFns({
    state: {
      craftAssistMaterials: [createCraftAssistMaterial({items: [createCraftAssistItem()]})],
      craftAssistPickRole: "main"
    }
  });

  app.renderCraftAssistList();

  const head = findFirstByClass(app.ui.craftAssistList, "craft-assist-item-head");
  assert.ok(head, "material group should render a condition header");
  const title = findFirstByClass(head, "craft-assist-item-title");
  assert.ok(title, "condition header should still render a left title slot");
  assert.equal(String(title.textContent || "").includes("条件设置"), false, "legacy 条件设置 text should be removed from the condition header");
  assert.equal(String(title.textContent || "").trim(), "主料", "the role tag should now occupy the old title position");
  const roleTags = findAllByClass(head, "craft-assist-role-tag");
  assert.equal(roleTags.length, 1, "condition header should render exactly one compact role tag instead of a separate stretched strip");
}

function testEachItemCardOwnsItsRelativeAbsoluteToggleAndWearInputs() {
  const app = loadRenderListFns({
    state: {
      craftAssistMaterials: [createCraftAssistMaterial()],
      craftAssistPickRole: "main"
    }
  });

  app.renderCraftAssistList();

  const cards = findAllByClass(app.ui.craftAssistList, "craft-assist-material-card");
  assert.equal(cards.length, 2, "fixture should render two item cards before checking per-card controls");
  cards.forEach((card, index) => {
    const toggle = findFirstByClass(card, "craft-assist-mode-toggle");
    assert.ok(toggle, `item card #${index + 1} should own its own relative/absolute toggle`);
    const toggleText = String(toggle.textContent || "");
    assert.equal(toggleText.includes("相对"), true, `item card #${index + 1} toggle should expose the relative mode label`);
    assert.equal(toggleText.includes("绝对"), true, `item card #${index + 1} toggle should expose the absolute mode label`);
    const inputs = findAllByTag(card, "INPUT");
    const minInput = inputs.find((node) => String(node.getAttribute("aria-label") || "").includes(" Min 输入"));
    const maxInput = inputs.find((node) => String(node.getAttribute("aria-label") || "").includes(" Max 输入"));
    assert.ok(minInput, `item card #${index + 1} should render its own Min input`);
    assert.ok(maxInput, `item card #${index + 1} should render its own Max input`);
    const rangeField = findFirstByClass(card, "craft-assist-card-range");
    const rangeRows = findAllByClass(card, "craft-assist-range-row");
    assert.equal(rangeRows.length, 2, `item card #${index + 1} should stack Min and Max as two range rows`);
    assert.equal(String(card.textContent || "").includes("Minwear"), false, `item card #${index + 1} should not keep the legacy Minwear label`);
    assert.equal(String(card.textContent || "").includes("Maxwear"), false, `item card #${index + 1} should not keep the legacy Maxwear label`);
    assert.equal(String(rangeField && rangeField.textContent || "").includes("-"), false, `item card #${index + 1} should remove the legacy inline dash between Min and Max`);
    assert.ok(
      rangeField,
      `item card #${index + 1} should render wear inputs inside the dedicated card range field`
    );
  });
}

function testDeletingLastItemCardRemovesWholeMaterialGroup() {
  const removeItemCalls = [];
  const app = loadRenderListFns({
    state: {
      craftAssistMaterials: [createCraftAssistMaterial({items: [createCraftAssistItem({id: "assist_group_1__solo"})]})],
      craftAssistPickRole: "main"
    },
    removeCraftAssistMaterialItem(materialId, itemId) {
      removeItemCalls.push([materialId, itemId]);
      app.state.craftAssistMaterials = (Array.isArray(app.state.craftAssistMaterials) ? app.state.craftAssistMaterials : [])
        .flatMap((material) => {
          if (String(material && material.id || "").trim() !== materialId) return [material];
          const nextItems = normalizeCraftAssistItemsForTest(material)
            .filter((item) => String(item && item.id || "").trim() !== itemId);
          if (!nextItems.length) return [];
          return [{...material, items: nextItems}];
        });
    }
  });

  app.renderCraftAssistList();

  const card = findFirstByClass(app.ui.craftAssistList, "craft-assist-material-card");
  assert.ok(card, "single selected material should still render as an item card");
  const removeBtn = findFirstByClass(card, "craft-assist-material-card-remove");
  assert.ok(removeBtn, "item card should expose a dedicated delete action");
  assert.equal(typeof removeBtn.onclick, "function", "item card delete action should wire an onclick handler");
  removeBtn.onclick({stopPropagation() {}});
  app.renderCraftAssistList();
  assert.deepEqual(
    removeItemCalls,
    [["assist_group_1", "assist_group_1__solo"]],
    "deleting the last remaining item card should route through the item-level delete hook with the owning material and item ids"
  );
  assert.equal(
    findAllByClass(app.ui.craftAssistList, "craft-assist-item").length,
    0,
    "after deleting the last remaining item card, the whole material group should disappear on rerender"
  );
}

function testAddingSameRoleMaterialReusesExistingBucketInsteadOfCreatingAnotherGroup() {
  const renderCalls = [];
  const app = loadAddMaterialFns({
    state: {
      craftAssistMaterials: [
        createCraftAssistMaterial({
          id: "main-bucket",
          role: "main",
          count: 3,
          items: [createCraftAssistItem({id: "main-bucket__1", name: "AK-47 | Slate"})]
        }),
        createCraftAssistMaterial({
          id: "aux-bucket",
          role: "aux",
          count: 7,
          items: [createCraftAssistItem({id: "aux-bucket__1", name: "USP-S | Cortex"})]
        })
      ],
      craftAssistPickRole: "main",
      craftAssistPickerOpen: true,
      craftAssistRoleChooserOpen: true,
      craftAssistPickerTargetMaterialId: ""
    },
    buildCraftAssistParentGroups: () => [
      {name: "AK-47 | Slate", rarity: "工业级"},
      {name: "M4A4 | Buzz Kill", rarity: "工业级"},
      {name: "USP-S | Cortex", rarity: "工业级"}
    ],
    updateCraftAssistMaterialItems(materialId, updater) {
      app.state.craftAssistMaterials = app.state.craftAssistMaterials.map((material) => {
        if (String(material && material.id || "").trim() !== String(materialId || "").trim()) return material;
        return {
          ...material,
          items: updater(normalizeCraftAssistItemsForTest(material)).map((item, index) => ({
            ...item,
            id: String(item && item.id || `${materialId}__${index + 1}`)
          }))
        };
      });
      return true;
    },
    renderCraftAssistPanel: () => {
      renderCalls.push("render");
    }
  });

  app.addCraftAssistMaterialByName("M4A4 | Buzz Kill");

  assert.equal(app.state.craftAssistMaterials.length, 2, "adding another main-role item should not create a third top-level material group");
  const mainBuckets = app.state.craftAssistMaterials.filter((material) => String(material && material.role || "").trim() === "main");
  assert.equal(mainBuckets.length, 1, "there should still be exactly one main bucket after adding a main item");
  assert.equal(
    JSON.stringify(normalizeCraftAssistItemsForTest(mainBuckets[0]).map((item) => String(item && item.name || "").trim())),
    JSON.stringify(["AK-47 | Slate", "M4A4 | Buzz Kill"]),
    "the new item should be appended into the existing main bucket"
  );
  assert.equal(renderCalls.length > 0, true, "reusing the existing role bucket should still rerender the panel");
}

function testPickerHidesRarityMismatchedAndUsedElsewhereCandidatesWhenContinuingToAdd() {
  const app = loadPickerFns({
    state: {
      craftAssistOpen: true,
      craftAssistPickerOpen: true,
      craftAssistPickerTargetMaterialId: "main-bucket",
      craftAssistMaterials: [
        createCraftAssistMaterial({
          id: "main-bucket",
          role: "main",
          count: 3,
          items: [createCraftAssistItem({id: "main-bucket__1", name: "AK-47 | Slate"})]
        }),
        createCraftAssistMaterial({
          id: "aux-bucket",
          role: "aux",
          count: 2,
          items: [createCraftAssistItem({id: "aux-bucket__1", name: "P250 | Sand Dune"})]
        })
      ]
    },
    buildCraftAssistParentGroups: () => [
      {name: "AK-47 | Slate", count: 2, rarity: "工业级", collection: "久经沙场"},
      {name: "M4A4 | Buzz Kill", count: 3, rarity: "工业级", collection: "久经沙场"},
      {name: "P250 | Sand Dune", count: 4, rarity: "工业级", collection: "久经沙场"},
      {name: "USP-S | Cortex", count: 5, rarity: "军规级", collection: "久经沙场"}
    ]
  });

  app.renderCraftAssistPicker();

  const pickerButtons = findAllByTag(app.ui.craftAssistPicker, "BUTTON");
  const buttonTexts = pickerButtons.map((node) => String(node.textContent || "").trim());
  assert.deepEqual(
    buttonTexts,
    [
      "AK-47 | Slate（2） 已在本项",
      "M4A4 | Buzz Kill（3）"
    ],
    "continuing to add materials should hide parent candidates whose rarity mismatches or are already used in other material groups"
  );
  assert.equal(
    buttonTexts.some((text) => text.includes("稀有度需")),
    false,
    "picker should hide mismatched-rarity candidates instead of rendering disabled entries with rarity warnings"
  );
  assert.equal(
    buttonTexts.some((text) => text.includes("已在其他项")),
    false,
    "picker should hide candidates that are already used by other material groups instead of rendering disabled entries"
  );
}

function testRenderCoalescesDuplicateRoleBucketsIntoSingleMainAndAuxGroups() {
  const app = loadRenderListFns({
    state: {
      craftAssistMaterials: [
        createCraftAssistMaterial({
          id: "main-a",
          role: "main",
          count: 2,
          items: [createCraftAssistItem({id: "main-a__1", name: "AK-47 | Slate"})]
        }),
        createCraftAssistMaterial({
          id: "main-b",
          role: "main",
          count: 3,
          items: [createCraftAssistItem({id: "main-b__1", name: "M4A4 | Buzz Kill"})]
        }),
        createCraftAssistMaterial({
          id: "aux-a",
          role: "aux",
          count: 5,
          items: [createCraftAssistItem({id: "aux-a__1", name: "USP-S | Cortex"})]
        }),
        createCraftAssistMaterial({
          id: "aux-b",
          role: "aux",
          count: 1,
          items: [createCraftAssistItem({id: "aux-b__1", name: "P250 | Asiimov"})]
        })
      ],
      craftAssistPickRole: "main"
    }
  });

  app.renderCraftAssistList();

  const groups = findAllByClass(app.ui.craftAssistList, "craft-assist-item");
  assert.equal(groups.length, 2, "render should collapse duplicate same-role groups so only one main bucket and one aux bucket remain visible");
  const labels = groups.map((group) => String(findFirstByClass(group, "craft-assist-role-tag")?.textContent || "").trim());
  assert.deepEqual(labels, ["主料", "辅料"], "collapsed render should still expose exactly one main label and one aux label");
  const cardTitles = groups.map((group) =>
    findAllByClass(group, "craft-assist-material-card-title").map((node) => String(node && node.textContent || "").trim())
  );
  assert.deepEqual(
    cardTitles,
    [
      ["AK-47 | Slate", "M4A4 | Buzz Kill"],
      ["USP-S | Cortex", "P250 | Asiimov"]
    ],
    "each visible role bucket should contain the combined child item cards of that role"
  );
}

function testItemCardsUseCompactRailLayout() {
  const app = loadRenderListFns({
    state: {
      craftAssistMaterials: [createCraftAssistMaterial()],
      craftAssistPickRole: "main"
    }
  });

  app.renderCraftAssistList();

  const cards = findAllByClass(app.ui.craftAssistList, "craft-assist-material-card");
  assert.equal(cards.length > 0, true, "fixture should render at least one material item card");
  cards.forEach((card, index) => {
    const rail = findFirstByClass(card, "craft-assist-material-card-rail");
    const modeField = findFirstByClass(card, "craft-assist-card-mode");
    const rangeField = findFirstByClass(card, "craft-assist-card-range");
    assert.ok(rail, `item card #${index + 1} should render a compact left rail block`);
    assert.equal(
      !!findFirstByClass(card, "craft-assist-material-card-fields"),
      false,
      `item card #${index + 1} should no longer render a separate right-side field block`
    );
    assert.ok(modeField, `item card #${index + 1} should render the mode toggle block`);
    assert.ok(rangeField, `item card #${index + 1} should render the wear range block`);
    assert.ok(
      isDescendant(rail, modeField) && isDescendant(rail, rangeField),
      `item card #${index + 1} should place wear controls below the relative/absolute toggle inside the compact rail`
    );
  });
}

function testWearInputUsesPlaceholderAndZeroSeedForEditing() {
  const helperFns = loadCraftAssistDecimalInputFns();
  const itemUpdateCalls = [];
  const app = loadRenderListFns({
    seedCraftAssistDecimalInput: helperFns.seedCraftAssistDecimalInput,
    updateCraftAssistMaterialItems(materialId, updater) {
      itemUpdateCalls.push({materialId, updater});
      return true;
    },
    state: {
      craftAssistMaterials: [
        createCraftAssistMaterial({
          items: [
            createCraftAssistItem({
              id: "assist_group_1__1",
              name: "AK-47 | Slate",
              wear_min: 0.15,
              wear_max: 0.33,
              custom_range: true
            }),
            createCraftAssistItem({
              id: "assist_group_1__2",
              name: "M4A4 | Buzz Kill",
              wear_min: 0,
              wear_max: 1,
              custom_range: false
            })
          ]
        })
      ],
      craftAssistPickRole: "main"
    }
  });

  app.renderCraftAssistList();

  const cards = findAllByClass(app.ui.craftAssistList, "craft-assist-material-card");
  assert.equal(cards.length, 2, "fixture should render one populated range card and one empty range card");

  const populatedInputs = findAllByTag(cards[0], "INPUT");
  const populatedMinInput = populatedInputs.find((node) => String(node.getAttribute("aria-label") || "").includes(" Min 输入"));
  assert.ok(populatedMinInput, "populated card should render its Min input");
  assert.equal(populatedMinInput.value, "", "populated range should no longer prefill the live input value");
  assert.equal(populatedMinInput.placeholder, "0.150000", "populated range should expose the stored wear as placeholder text");
  populatedMinInput.focus();
  populatedMinInput.onfocus();
  assert.equal(populatedMinInput.value, "0.", "focus should seed a 0. prefix when the visible input starts empty");
  assert.equal(populatedMinInput.selectionStart, 2, "focus should place the caret after the seeded 0. prefix");
  assert.equal(populatedMinInput.selectionEnd, 2, "focus should keep the caret collapsed after the seeded 0. prefix");
  populatedMinInput.onblur();
  assert.equal(itemUpdateCalls.length, 0, "seeded 0. blur without typing should not overwrite the stored custom range");
  assert.equal(populatedMinInput.value, "", "seeded 0. should clear back to an empty live input after blur");

  const emptyInputs = findAllByTag(cards[1], "INPUT");
  const emptyMinInput = emptyInputs.find((node) => String(node.getAttribute("aria-label") || "").includes(" Min 输入"));
  assert.ok(emptyMinInput, "empty-range card should render its Min input");
  assert.equal(emptyMinInput.value, "", "default range input should still start empty");
  assert.equal(emptyMinInput.placeholder, "0.000000", "default range input should show the default boundary as placeholder text");
  emptyMinInput.focus();
  emptyMinInput.onfocus();
  assert.equal(emptyMinInput.value, "0.", "default range input should also seed 0. on focus for direct editing");
  assert.equal(emptyMinInput.selectionStart, 2, "default range input should place the caret after the seeded 0. prefix");
  assert.equal(emptyMinInput.selectionEnd, 2, "default range input should keep the caret after the seeded 0. prefix");
}

function testTargetWearDisplayDefaultStaysNullUntilUserActuallyEdits() {
  const helperFns = loadCraftAssistDecimalInputFns();
  const document = createDocument();
  const input = document.createElement("input");
  input.value = "0.000000";
  input.dataset.displayDefault = "1";

  helperFns.seedCraftAssistDecimalInput(input);
  assert.equal(input.selectionStart, 2, "target wear focus should keep the 0. prefix and select the fractional suffix");
  assert.equal(input.selectionEnd, input.value.length, "target wear focus should select through the end of the displayed default value");

  const untouched = helperFns.commitCraftAssistTargetWearInput(input);
  assert.equal(untouched, null, "leaving the displayed default untouched should keep target wear state empty");
  assert.equal(input.dataset.displayDefault, undefined, "committing the untouched displayed default should clear the display-only marker");

  input.value = "0.123456";
  const edited = helperFns.commitCraftAssistTargetWearInput(input);
  assert.equal(edited, 0.123456, "once the user edits target wear, the committed value should be parsed as a real number");
}

function main() {
  const tests = [
    testOrdinaryRenderDoesNotTriggerClearancePreserve,
    testOpeningPanelTriggersOnePreservedClearanceSync,
    testOpeningPanelAppliesReserveBeforeRenderingOverlay,
    testTargetWearInputShowsZeroDisplayWhenStateIsEmpty,
    testMaterialCardsRenderInsideOwningGroupAndLegacyStripIsGone,
    testQuantityControlMovesIntoConditionHeaderRightSide,
    testRoleTagReplacesLegacyConditionTitleAndStaysCompact,
    testEachItemCardOwnsItsRelativeAbsoluteToggleAndWearInputs,
    testDeletingLastItemCardRemovesWholeMaterialGroup,
    testAddingSameRoleMaterialReusesExistingBucketInsteadOfCreatingAnotherGroup,
    testPickerHidesRarityMismatchedAndUsedElsewhereCandidatesWhenContinuingToAdd,
    testRenderCoalescesDuplicateRoleBucketsIntoSingleMainAndAuxGroups,
    testItemCardsUseCompactRailLayout,
    testWearInputUsesPlaceholderAndZeroSeedForEditing,
    testTargetWearDisplayDefaultStaysNullUntilUserActuallyEdits
  ];
  const failures = [];
  for (const testFn of tests) {
    try {
      testFn();
    } catch (error) {
      failures.push({name: testFn.name, error});
    }
  }
  if (failures.length) {
    console.error(`craft-assist-panel-render tests failed: ${failures.length}`);
    for (const failure of failures) {
      console.error(`- ${failure.name}: ${failure.error && failure.error.message ? failure.error.message : failure.error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("craft-assist-panel-render tests passed");
}

main();
