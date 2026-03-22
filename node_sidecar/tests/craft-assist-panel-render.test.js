const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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
    wearText6: overrides.wearText6,
    getCraftAssistFilterMode: overrides.getCraftAssistFilterMode,
    normalizeCraftAssistCount: overrides.normalizeCraftAssistCount,
    renderCraftAssistPicker: overrides.renderCraftAssistPicker,
    renderCraftAssistList: overrides.renderCraftAssistList,
    renderCraftAssistPresetPanel: overrides.renderCraftAssistPresetPanel,
    String,
    Number,
    console,
    document: {activeElement: null}
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

function main() {
  testOrdinaryRenderDoesNotTriggerClearancePreserve();
  testOpeningPanelTriggersOnePreservedClearanceSync();
  testOpeningPanelAppliesReserveBeforeRenderingOverlay();
  console.log("craft-assist-panel-render tests passed");
}

main();
