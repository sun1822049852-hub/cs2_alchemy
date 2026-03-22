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
    contains(name) {
      return set.has(name);
    },
    add(name) {
      set.add(name);
    },
    remove(name) {
      set.delete(name);
    },
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
    }
  };
}

function createStyle() {
  const values = Object.create(null);
  return {
    values,
    setProperty(name, value) {
      values[name] = value;
    },
    getPropertyValue(name) {
      return values[name] || "";
    }
  };
}

function createSelectionList(scrollTop = 0) {
  return {
    style: createStyle(),
    dataset: {},
    scrollTop
  };
}

function loadOverlayFns({state, ui, applyCraftAssistPresetWidth = () => {}} = {}) {
  const source = [
    extractBlock("function clampCraftAssistOverlayHeight(", "function getCraftAssistSelectionListReserveHeight("),
    extractBlock("function getCraftAssistSelectionListReserveHeight(", "function startCraftAssistOverlayDrag(")
  ].join("\n");
  const context = {
    Math,
    Number,
    String,
    Object,
    state,
    ui,
    applyCraftAssistPresetWidth,
    console
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function testClosedOverlayClearsReserve() {
  const list = createSelectionList(24);
  const context = loadOverlayFns({
    state: {craftAssistOpen: false, craftAssistOverlayHeight: 320},
    ui: {
      craftLeftPanel: {clientHeight: 720},
      craftAssistOverlay: {classList: createClassList(["hidden"]), style: createStyle()},
      craftSelectionList: list
    }
  });

  assert.equal(context.getCraftAssistSelectionListReserveHeight(), 0);
  context.syncCraftSelectionListClearance({preserveVisibleBottom: true});
  assert.equal(list.style.getPropertyValue("--craft-assist-list-reserve-height"), "0px");
  assert.equal(list.dataset.craftAssistReserveHeight, "0");
  assert.equal(list.scrollTop, 24);
}

function testOpenOverlayAppliesReserveAndPushesScroll() {
  const list = createSelectionList(40);
  const context = loadOverlayFns({
    state: {craftAssistOpen: true, craftAssistOverlayHeight: 320},
    ui: {
      craftLeftPanel: {clientHeight: 720},
      craftAssistOverlay: {classList: createClassList(), style: createStyle()},
      craftSelectionList: list
    }
  });

  assert.equal(context.getCraftAssistSelectionListReserveHeight(), 328);
  context.syncCraftSelectionListClearance({preserveVisibleBottom: true});
  assert.equal(list.style.getPropertyValue("--craft-assist-list-reserve-height"), "328px");
  assert.equal(list.dataset.craftAssistReserveHeight, "328");
  assert.equal(list.scrollTop, 368);
}

function testOpenStateCanPrecomputeReserveBeforeOverlayUnhides() {
  const context = loadOverlayFns({
    state: {craftAssistOpen: true, craftAssistOverlayHeight: 320},
    ui: {
      craftLeftPanel: {clientHeight: 720},
      craftAssistOverlay: {classList: createClassList(["hidden"]), style: createStyle()},
      craftSelectionList: createSelectionList(0)
    }
  });

  assert.equal(
    context.getCraftAssistSelectionListReserveHeight(),
    328,
    "open panel should still reserve list space before the overlay class is unhidden"
  );
}

function testApplyOverlayHeightAlsoRefreshesListReserve() {
  const list = createSelectionList(12);
  let presetWidthCalls = 0;
  const overlayStyle = createStyle();
  const context = loadOverlayFns({
    state: {craftAssistOpen: true, craftAssistOverlayHeight: 999},
    ui: {
      craftLeftPanel: {clientHeight: 500},
      craftAssistOverlay: {classList: createClassList(), style: overlayStyle},
      craftSelectionList: list
    },
    applyCraftAssistPresetWidth: () => {
      presetWidthCalls += 1;
    }
  });

  context.applyCraftAssistOverlayHeight({preserveVisibleBottom: true});

  assert.equal(context.state.craftAssistOverlayHeight, 484);
  assert.equal(overlayStyle.getPropertyValue("--craft-assist-overlay-height"), "484px");
  assert.equal(list.style.getPropertyValue("--craft-assist-list-reserve-height"), "492px");
  assert.equal(list.scrollTop, 504);
  assert.equal(presetWidthCalls, 1);
}

function main() {
  testClosedOverlayClearsReserve();
  testOpenOverlayAppliesReserveAndPushesScroll();
  testOpenStateCanPrecomputeReserveBeforeOverlayUnhides();
  testApplyOverlayHeightAlsoRefreshesListReserve();
  console.log("craft-assist-overlay-clearance tests passed");
}

main();
