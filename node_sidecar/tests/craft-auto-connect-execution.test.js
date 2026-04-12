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

function extractFunctionSource(name) {
  const marker = `function ${name}(`;
  const asyncMarker = `async function ${name}(`;
  const asyncStart = APP_SOURCE.indexOf(asyncMarker);
  const syncStart = APP_SOURCE.indexOf(marker);
  const start = asyncStart >= 0 ? asyncStart : syncStart;
  assert.notEqual(start, -1, `missing function ${name}`);
  let depth = 0;
  let seenOpen = false;
  for (let index = start; index < APP_SOURCE.length; index += 1) {
    const char = APP_SOURCE[index];
    if (char === "{") {
      depth += 1;
      seenOpen = true;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (seenOpen && depth === 0) return APP_SOURCE.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function createClassList() {
  const values = new Set();
  return {
    add(name) {
      values.add(String(name));
    },
    remove(name) {
      values.delete(String(name));
    },
    toggle(name, force) {
      const key = String(name);
      if (force === undefined) {
        if (values.has(key)) values.delete(key);
        else values.add(key);
        return values.has(key);
      }
      if (force) values.add(key);
      else values.delete(key);
      return !!force;
    }
  };
}

function createGlyphClassList() {
  const values = new Set();
  return {
    add(...names) {
      for (const name of names) values.add(String(name));
    },
    remove(...names) {
      for (const name of names) values.delete(String(name));
    },
    contains(name) {
      return values.has(String(name));
    }
  };
}

function loadRenderCraftPageFns(initialState = {}, {connected = false, executableCount = 1} = {}) {
  const source = [
    extractBlock("function isCraftRecipeEditLocked(", "function formatCraftSlotWear("),
    extractBlock("function renderCraftPage(", "async function runCraftTradeUpQueue(")
  ].join("\n");
  const glyph = {classList: createGlyphClassList()};
  const buttonClassList = createClassList();
  const button = {
    disabled: true,
    title: "",
    attrs: new Map(),
    classList: buttonClassList,
    querySelector() {
      return glyph;
    },
    setAttribute(name, value) {
      this.attrs.set(String(name), String(value));
    }
  };
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
      rows: [],
      currentAccountUsername: "acc-a",
      craftUseComponentItems: false,
      craftCandidateLoading: false,
      craftCandidateStats: null,
      craftSettingsOpen: false,
      craftStatusText: "",
      craftStatusError: false,
      craftBusy: false,
      craftPaused: false,
      craftPauseRequested: false,
      craftAssistSelecting: false,
      craftRecipeQueue: [{id: "recipe-1", item_ids: Array.from({length: 10}, (_, index) => `item-${index}`), status: "pending"}],
      craftActiveRecipeId: "recipe-1",
      craftSelectedItemIds: new Set(),
      craftPredictorContextType: "",
      craftPredictorContextId: "",
      craftPredictorContextLabel: "",
      ...initialState
    },
    ui: {
      craftPage: {},
      craftSelectionTitle: null,
      craftSelectedText: null,
      craftRecipeText: null,
      craftAddRecipeBtn: null,
      craftExecuteQueueBtn: button,
      craftClearQueueBtn: null,
      craftAssistToggleBtn: null,
      craftConnectText: null
    },
    syncCurrentCraftAssistRuntimeState() {},
    isGuestWorkspaceActive() {
      return false;
    },
    isCurrentAccountConnected() {
      return connected;
    },
    setConnectionStatusTone() {},
    syncCraftSettingsControls() {},
    setCraftSettingsPanelOpen() {},
    updateCraftActionLayout() {},
    reconcileCraftQueueWithInventory() {},
    ensureActiveCraftRecipe() {
      return context.state.craftRecipeQueue[0] || null;
    },
    syncCraftPredictorContextWithActiveRecipe() {},
    getCraftCandidates() {
      return [];
    },
    getCraftSelectedRows() {
      return [];
    },
    getTradeUpRecipeFromRows() {
      return {ok: true, text: "配方：-"};
    },
    getCraftQueuePendingCount() {
      return 1;
    },
    getCraftExecutableEntries() {
      return Array.from({length: executableCount}, (_, index) => ({id: `exec-${index}`}));
    },
    syncCraftStatusDom() {},
    renderCraftQueue() {},
    renderCraftAssistPanel() {},
    renderCraftGrouped() {},
    renderCraftExecutionOverlay() {},
    setCraftStatus() {},
    refreshCraftCandidateRows() {},
    estimateMainInventoryFreeSlots() {
      return {freeSlots: 0};
    },
    countSelectedComponentCraftItems() {
      return 0;
    }
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function loadEnsureCraftConnectedFn(initialState = {}, {
  connectedInitially = false,
  refreshResult = {ok: true},
  onDoRefresh = null
} = {}) {
  const source = [
    extractBlock("function createConnectProgressReporter(", "function applyCraftComponentProgressEvent("),
    extractFunctionSource("ensureCraftConnectedForExecution")
  ].join("\n");
  const overlayStates = [];
  const context = {
    Math,
    Number,
    String,
    Promise,
    console,
    state: {
      currentAccountUsername: "acc-a",
      ...initialState
    },
    ui: {
      accountSelect: {value: ""},
      craftAccountSelect: {value: ""}
    },
    overlayStates,
    clearedOverlay: 0,
    refreshCalls: [],
    lastCraftStatus: null,
    isCurrentAccountConnected() {
      return !!context.connected;
    },
    connected: connectedInitially,
    setCraftStatus(message, isError = false) {
      context.lastCraftStatus = {message, isError};
    },
    setCraftExecutionOverlayState(payload) {
      overlayStates.push(payload);
    },
    clearCraftExecutionOverlayState() {
      context.clearedOverlay += 1;
    },
    async doRefresh(options) {
      context.refreshCalls.push(options);
      if (typeof onDoRefresh === "function") {
        return onDoRefresh(options, context);
      }
      if (refreshResult && refreshResult.ok) context.connected = true;
      return refreshResult;
    }
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function testDisconnectedCraftRenderKeepsExecuteEnabledForAutoConnect() {
  const app = loadRenderCraftPageFns({}, {connected: false, executableCount: 2});
  app.renderCraftPage();
  assert.equal(
    app.ui.craftExecuteQueueBtn.disabled,
    false,
    "craft execute button should stay enabled when there are executable recipes because click can auto-connect the account first"
  );
}

async function testEnsureCraftConnectedRefreshesDisconnectedAccountForExecution() {
  const refreshProgressSentinel = {
    percent: 73,
    title: "__refresh_internal_progress__",
    detail: "refresh-only-signal"
  };
  let clearedOverlayBeforeRefreshReturns = -1;
  const app = loadEnsureCraftConnectedFn({}, {
    connectedInitially: false,
    refreshResult: {ok: true},
    onDoRefresh(options, context) {
      options.onProgress(refreshProgressSentinel);
      clearedOverlayBeforeRefreshReturns = context.clearedOverlay;
      context.connected = true;
      return {ok: true};
    }
  });
  assert.equal(typeof app.ensureCraftConnectedForExecution, "function", "expected auto-connect helper for craft execution");

  const ok = await app.ensureCraftConnectedForExecution();

  assert.equal(ok, true, "disconnected craft execution should proceed after auto-connect succeeds");
  assert.equal(app.refreshCalls.length, 1, "auto-connect helper should refresh the account exactly once");
  assert.equal(app.refreshCalls[0].force, true);
  assert.equal(app.refreshCalls[0].silentRateLimit, true);
  assert.equal(app.refreshCalls[0].silentInfo, true);
  assert.equal(typeof app.refreshCalls[0].onProgress, "function", "auto-connect refresh should wire progress callbacks into the centered overlay");
  assert.equal(app.overlayStates.length > 0, true, "auto-connect helper should surface centered progress overlay states");
  assert.equal(
    app.overlayStates.some((payload) => (
      payload &&
      payload.visible === true &&
      payload.mode === "connecting" &&
      payload.percent === refreshProgressSentinel.percent &&
      payload.title === refreshProgressSentinel.title
    )),
    true,
    "refresh-internal progress callback should drive a visible connecting overlay payload through the shared path"
  );
  assert.equal(clearedOverlayBeforeRefreshReturns, 0, "overlay should not clear until shared shutdown runs");
  assert.equal(app.clearedOverlay, 1, "auto-connect helper should clear the centered overlay after success");
}

async function testEnsureCraftConnectedClearsOverlayWhenRefreshThrows() {
  let clearedOverlayBeforeThrow = -1;
  const thrown = new Error("refresh exploded");
  const app = loadEnsureCraftConnectedFn({}, {
    connectedInitially: false,
    onDoRefresh(options, context) {
      options.onProgress({percent: 55, title: "正在连接账号", detail: "throw-path"});
      clearedOverlayBeforeThrow = context.clearedOverlay;
      throw thrown;
    }
  });

  await assert.rejects(
    app.ensureCraftConnectedForExecution(),
    thrown,
    "auto-connect helper should preserve thrown refresh errors"
  );
  assert.equal(clearedOverlayBeforeThrow, 0, "overlay should remain active until shared finally cleanup runs");
  assert.equal(app.clearedOverlay, 1, "auto-connect helper should clear the centered overlay even when refresh throws");
}

async function main() {
  testDisconnectedCraftRenderKeepsExecuteEnabledForAutoConnect();
  await testEnsureCraftConnectedRefreshesDisconnectedAccountForExecution();
  await testEnsureCraftConnectedClearsOverlayWhenRefreshThrows();
  console.log("craft-auto-connect-execution tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
