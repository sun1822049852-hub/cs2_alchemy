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

function createMaskNode() {
  return {
    classList: createClassList(["hidden"]),
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    }
  };
}

function loadBusyMaskRender(overrides = {}) {
  const source = [
    extractBlock("function createDefaultCraftAssistRuntimeState(", "function createDefaultCraftAccountScopedState("),
    extractBlock("function getCraftLeftPanelBusyState(", "function renderCraftAssistBusyMask("),
    extractBlock("function renderCraftAssistBusyMask(", "function renderCraftAssistPanel(")
  ].join("\n");
  const context = {
    state: {
      craftAssistOpen: true,
      craftAssistSelecting: false,
      craftAssistPendingUiAction: "",
      craftAssistPendingPresetId: "",
      craftAssistRunToken: "",
      craftAssistActiveRunTokensByAccount: new Map(),
      currentAccountUsername: "acc-a",
      componentOpBusy: false,
      componentOpBusyAction: "",
      ...overrides.state
    },
    ui: {
      craftAssistBusyMask: createMaskNode(),
      craftAssistBusyMaskTitle: {textContent: ""},
      craftAssistBusyMaskDetail: {textContent: ""},
      ...overrides.ui
    },
    accountByUsername: overrides.accountByUsername || (() => null),
    displayAccountName: overrides.displayAccountName || ((account) => account && account.username ? account.username : "当前账号"),
    String,
    console
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function testMaskStaysHiddenWithoutRecognizedPendingAction() {
  const app = loadBusyMaskRender({
    state: {
      craftAssistOpen: true,
      craftAssistSelecting: true,
      craftAssistPendingUiAction: "",
      craftAssistPendingPresetId: "preset-stale"
    }
  });

  app.renderCraftAssistBusyMask();

  assert.equal(
    app.ui.craftAssistBusyMask.classList.contains("hidden"),
    true,
    "busy mask should stay hidden when no real pending action is active"
  );
  assert.equal(app.ui.craftAssistBusyMask.attrs["aria-hidden"], "true");
}

function testMaskShowsForActivePanelApplyRun() {
  const app = loadBusyMaskRender({
    state: {
      craftAssistOpen: true,
      craftAssistSelecting: true,
      craftAssistPendingUiAction: "panel_apply",
      craftAssistRunToken: "token-live"
    }
  });
  app.setCraftAssistActiveRunToken("acc-a", "token-live");

  app.renderCraftAssistBusyMask();

  assert.equal(app.ui.craftAssistBusyMask.classList.contains("hidden"), false);
  assert.equal(app.ui.craftAssistBusyMask.attrs["aria-hidden"], "false");
  assert.match(app.ui.craftAssistBusyMaskTitle.textContent, /正在为/);
  assert.match(app.ui.craftAssistBusyMaskDetail.textContent, /当前面板配置/);
}

function testMaskClearsStalePanelApplyStateWithoutActiveToken() {
  const app = loadBusyMaskRender({
    state: {
      craftAssistOpen: true,
      craftAssistSelecting: true,
      craftAssistPendingUiAction: "panel_apply",
      craftAssistRunToken: "token-stale"
    }
  });

  app.renderCraftAssistBusyMask();

  assert.equal(app.ui.craftAssistBusyMask.classList.contains("hidden"), true);
  assert.equal(app.state.craftAssistSelecting, false);
  assert.equal(app.state.craftAssistPendingUiAction, "");
  assert.equal(app.state.craftAssistRunToken, "");
}

function testMaskShowsForComponentWithdrawBusyState() {
  const app = loadBusyMaskRender({
    state: {
      craftAssistOpen: false,
      componentOpBusy: true,
      componentOpBusyAction: "withdraw"
    }
  });

  app.renderCraftAssistBusyMask();

  assert.equal(app.ui.craftAssistBusyMask.classList.contains("hidden"), false);
  assert.equal(app.ui.craftAssistBusyMask.attrs["aria-hidden"], "false");
  assert.match(app.ui.craftAssistBusyMaskTitle.textContent, /组件/);
  assert.match(app.ui.craftAssistBusyMaskDetail.textContent, /取出物品/);
}

function main() {
  testMaskStaysHiddenWithoutRecognizedPendingAction();
  testMaskShowsForActivePanelApplyRun();
  testMaskClearsStalePanelApplyStateWithoutActiveToken();
  testMaskShowsForComponentWithdrawBusyState();
  console.log("craft-assist-busy-mask-render tests passed");
}

main();
