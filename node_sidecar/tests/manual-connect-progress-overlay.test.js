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
  const asyncMarker = `async function ${name}(`;
  const plainMarker = `function ${name}(`;
  const start = APP_SOURCE.indexOf(asyncMarker) >= 0
    ? APP_SOURCE.indexOf(asyncMarker)
    : APP_SOURCE.indexOf(plainMarker);
  assert.notEqual(start, -1, `missing function: ${name}`);
  let signatureDepth = 0;
  let bodyStart = -1;
  for (let i = start; i < APP_SOURCE.length; i += 1) {
    const ch = APP_SOURCE[i];
    if (ch === "(") signatureDepth += 1;
    else if (ch === ")") signatureDepth -= 1;
    else if (ch === "{" && signatureDepth === 0) {
      bodyStart = i;
      break;
    }
  }
  assert.notEqual(bodyStart, -1, `missing function body: ${name}`);
  let depth = 0;
  for (let i = bodyStart; i < APP_SOURCE.length; i += 1) {
    const ch = APP_SOURCE[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return APP_SOURCE.slice(start, i + 1);
      }
    }
  }
  throw new Error(`unterminated function: ${name}`);
}

function createFakeEventSourceClass() {
  return class FakeEventSource {
    static instances = [];

    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      this.closed = false;
      FakeEventSource.instances.push(this);
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    close() {
      this.closed = true;
    }

    emit(type, payload) {
      const listener = this.listeners.get(type);
      if (!listener) {
        return;
      }
      listener({
        data: JSON.stringify(payload || {})
      });
    }
  };
}

function loadManualConnectFns({
  connectedUsername = "",
  currentAccountUsername = "acc-a",
  refreshResult = {ok: true},
  onDoRefresh = null
} = {}) {
  const source = extractBlock("function createConnectProgressReporter(", "function applyCraftComponentProgressEvent(");
  const context = {
    Math,
    Number,
    String,
    Promise,
    console,
    state: {
      connectedUsername,
      currentAccountUsername,
      craftProgressEnabled: false
    },
    ui: {
      accountSelect: {value: "acc-a"},
      craftAccountSelect: {value: "acc-craft"}
    },
    refreshCalls: [],
    overlayStates: [],
    clearCalls: 0,
    setCraftExecutionOverlayState(payload) {
      context.overlayStates.push(payload);
    },
    clearCraftExecutionOverlayState() {
      context.clearCalls += 1;
    },
    guardGuestAction() {
      return true;
    },
    async doRefresh(options) {
      context.refreshCalls.push(options);
      if (typeof onDoRefresh === "function") {
        return onDoRefresh(options, context);
      }
      return refreshResult;
    }
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function loadUseAccountFn() {
  const source = extractFunctionSource("useAccount");
  const context = {
    String,
    Promise,
    state: {
      refreshing: false,
      activeAccount: ""
    },
    refreshCalls: [],
    directRefreshCalls: [],
    accountStatusMessages: [],
    async api() {
      return {ok: true};
    },
    async loadAccounts() {},
    async switchAccountView() {},
    async refreshWithConnectionOverlay(options) {
      context.refreshCalls.push(options);
      return {ok: true};
    },
    async doRefresh(options) {
      context.directRefreshCalls.push(options);
      return {ok: true};
    },
    accountByUsername(username) {
      return {username, remark: ""};
    },
    displayAccountName(row) {
      return row.username;
    },
    setAccountStatus(message) {
      context.accountStatusMessages.push(String(message || ""));
    }
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function loadDisconnectOtherSessionsFn({apiImpl} = {}) {
  const source = extractFunctionSource("disconnectOtherSessionsForTarget");
  const context = {
    Array,
    String,
    state: {
      connectedUsername: ""
    },
    apiCalls: [],
    async api(pathname, options) {
      context.apiCalls.push({pathname, options});
      if (typeof apiImpl === "function") {
        return apiImpl(pathname, options, context);
      }
      return {ok: true, disconnected: []};
    },
    markCachedConnectionDisconnected() {},
    setSummary() {}
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function loadInventoryEventStreamFns({
  currentAccountUsername = "acc-a",
  connectedUsername = "",
  refreshing = true,
  visibilityState = "visible"
} = {}) {
  const lifecycleSource = extractBlock("function stopInventoryEventStream()", "function formatInventoryRefreshFailureMessage(");
  const startSource = extractFunctionSource("startInventoryEventStream");
  const FakeEventSource = createFakeEventSourceClass();
  const calls = {
    phase: [],
    summary: [],
    overlayClear: [],
    renderSavedAccounts: 0,
    syncInventoryTop: 0,
    loadSnapshot: [],
    componentQueue: []
  };
  const context = {
    String,
    JSON,
    encodeURIComponent,
    document: {
      visibilityState
    },
    EventSource: FakeEventSource,
    inventoryEventSource: null,
    inventoryEventUsername: "",
    state: {
      currentAccountUsername,
      connectedUsername,
      refreshPhaseText: "连接状态：连接中",
      refreshing,
      refreshSilentInfo: false
    },
    parseEventData(data) {
      return JSON.parse(String(data || "{}"));
    },
    async loadSnapshotForAccount(username) {
      calls.loadSnapshot.push(String(username || ""));
    },
    syncInventoryTop() {
      calls.syncInventoryTop += 1;
    },
    setSummary(message) {
      calls.summary.push(String(message || ""));
    },
    setRefreshPhase(text) {
      const next = String(text || "").trim();
      context.state.refreshPhaseText = next;
      calls.phase.push(next);
    },
    clearCraftExecutionOverlayState(payload) {
      calls.overlayClear.push(payload || null);
      return true;
    },
    renderSavedAccounts() {
      calls.renderSavedAccounts += 1;
    },
    applyTaskQueueSnapshot(payload) {
      calls.componentQueue.push(payload);
    }
  };
  vm.runInNewContext(`${lifecycleSource}\n${startSource}`, context, {filename: APP_PATH});
  return {context, calls, FakeEventSource};
}

async function test_disconnected_manual_refresh_wires_connect_progress_overlay() {
  let clearCallsBeforeRefreshReturns = -1;
  const app = loadManualConnectFns({
    connectedUsername: "",
    currentAccountUsername: "acc-a",
    refreshResult: {ok: true},
    onDoRefresh(options, context) {
      options.onProgress({percent: 40, title: "正在连接账号", detail: "正在建立连接并刷新库存..."});
      clearCallsBeforeRefreshReturns = context.clearCalls;
      return {ok: true};
    }
  });

  const result = await app.refreshWithConnectionOverlay({preferCraft: false, force: false});

  assert.deepEqual(result, {ok: true});
  assert.equal(app.refreshCalls.length, 1);
  assert.equal(app.refreshCalls[0].usernameOverride, "acc-a");
  assert.equal(typeof app.refreshCalls[0].onProgress, "function");
  assert.equal(app.overlayStates.length > 0, true);
  assert.equal(
    app.overlayStates.some((payload) => payload && payload.visible === true && payload.mode === "connecting"),
    true,
    "disconnected refresh should produce a visible connecting overlay payload via progress callback"
  );
  assert.equal(clearCallsBeforeRefreshReturns, 0, "overlay should be cleared by shared shutdown path after refresh settles");
  assert.equal(app.clearCalls, 1);
}

async function test_connected_manual_refresh_skips_connect_overlay() {
  const app = loadManualConnectFns({
    connectedUsername: "acc-a",
    currentAccountUsername: "acc-a",
    refreshResult: {ok: true}
  });

  await app.refreshWithConnectionOverlay({preferCraft: false, force: false});

  assert.equal(app.refreshCalls.length, 1);
  assert.equal(app.refreshCalls[0].usernameOverride, "acc-a");
  assert.equal(app.refreshCalls[0].onProgress, null);
  assert.equal(app.clearCalls, 0);
}

async function test_disconnect_others_request_has_a_bounded_local_timeout() {
  const app = loadDisconnectOtherSessionsFn({
    apiImpl(pathname, options) {
      if (Number(options && options.timeoutMs) > 0) {
        return Promise.reject(new Error(String(options.timeoutMessage || "请求超时")));
      }
      return new Promise(() => {});
    }
  });

  const result = Promise.race([
    app.disconnectOtherSessionsForTarget("acc-a", {silent: true}),
    new Promise((_, reject) => setTimeout(() => reject(new Error("test observed an unbounded disconnect request")), 50))
  ]);

  await assert.rejects(result, /清理其他账号连接超时/);
  assert.equal(app.apiCalls.length, 1);
  assert.equal(app.apiCalls[0].pathname, "/api/session/disconnect-others");
  assert.equal(Number(app.apiCalls[0].options.timeoutMs) >= 1000, true);
  assert.equal(Number(app.apiCalls[0].options.timeoutMs) <= 10000, true);
}

function test_saved_account_status_badge_routes_connect_through_shared_overlay_source() {
  const renderSource = extractBlock("function renderSavedAccounts(", "async function persistLastSelected(");
  assert.equal(
    renderSource.includes("await connectByStatusBadge({"),
    true,
    "saved account card disconnected badge should reuse the shared connect entry point"
  );
  assert.equal(
    renderSource.includes("await doRefresh({usernameOverride: row.username, force: true, silentRateLimit: true, silentInfo: true});"),
    false,
    "saved account card disconnected badge should not bypass the shared connect overlay"
  );
}

async function test_use_account_reuses_shared_connect_overlay() {
  const app = loadUseAccountFn();

  await app.useAccount("acc-a");

  assert.equal(app.refreshCalls.length, 1, "useAccount should route post-switch connect through refreshWithConnectionOverlay");
  assert.equal(app.refreshCalls[0].usernameOverride, "acc-a");
  assert.equal(app.refreshCalls[0].force, true);
  assert.equal(app.refreshCalls[0].silentRateLimit, true);
  assert.equal(app.directRefreshCalls.length, 0, "useAccount should not call doRefresh directly anymore");
}

function test_connection_ready_event_marks_connected_and_clears_connect_overlay() {
  const {context, calls, FakeEventSource} = loadInventoryEventStreamFns({
    currentAccountUsername: "acc-a",
    connectedUsername: "",
    refreshing: true
  });

  context.startInventoryEventStream("acc-a");
  assert.equal(FakeEventSource.instances.length, 1, "expected an EventSource to be created for the selected account");
  FakeEventSource.instances[0].emit("inventory_connection_ready", {
    username: "acc-a",
    source: "manual",
    connected: true
  });

  assert.equal(context.state.connectedUsername, "acc-a", "connection-ready event should mark the account connected immediately");
  assert.equal(calls.overlayClear.length, 1, "connection-ready event should close the centered connect overlay before full refresh settles");
  assert.equal(calls.overlayClear[0] && calls.overlayClear[0].owner, "connect_flow");
  assert.equal(calls.renderSavedAccounts, 1, "connection-ready event should repaint saved account cards immediately");
  assert.equal(
    calls.phase[calls.phase.length - 1],
    "连接状态：已连接（同步中）",
    "connection-ready event should swap the top status from connecting to connected-syncing"
  );
  assert.equal(
    calls.summary[calls.summary.length - 1],
    "已连接，正在同步库存与组件...",
    "connection-ready event should explain that background sync is still running"
  );
}

function test_connection_ready_event_respects_silent_refresh_summary() {
  const {context, calls, FakeEventSource} = loadInventoryEventStreamFns({
    currentAccountUsername: "acc-a",
    connectedUsername: "",
    refreshing: true
  });
  context.state.refreshSilentInfo = true;
  context.startInventoryEventStream("acc-a");
  FakeEventSource.instances[0].emit("inventory_connection_ready", {
    username: "acc-a",
    source: "manual",
    connected: true
  });

  assert.equal(calls.summary.length, 0, "silent refresh should not surface connection-ready summary noise");
  assert.equal(
    calls.phase[calls.phase.length - 1],
    "连接状态：已连接（同步中）",
    "silent refresh should still update the top connection phase"
  );
}

function test_hidden_page_does_not_open_inventory_event_stream() {
  const {context, FakeEventSource} = loadInventoryEventStreamFns({
    currentAccountUsername: "acc-a",
    visibilityState: "hidden"
  });

  context.startInventoryEventStream("acc-a");

  assert.equal(FakeEventSource.instances.length, 0, "hidden pages must not consume a long-lived SSE connection");
}

function test_visibility_lifecycle_closes_and_restores_only_the_current_stream() {
  const {context, FakeEventSource} = loadInventoryEventStreamFns({
    currentAccountUsername: "acc-a",
    visibilityState: "visible"
  });
  assert.equal(
    typeof context.syncInventoryEventStreamVisibility,
    "function",
    "inventory SSE needs an explicit visibility lifecycle owner"
  );

  context.startInventoryEventStream("acc-a");
  assert.equal(FakeEventSource.instances.length, 1);
  context.document.visibilityState = "hidden";
  context.syncInventoryEventStreamVisibility();
  assert.equal(FakeEventSource.instances[0].closed, true, "hiding the page should close its SSE connection");

  context.document.visibilityState = "visible";
  context.syncInventoryEventStreamVisibility();
  assert.equal(FakeEventSource.instances.length, 2, "returning to the page should restore one current-account stream");
  assert.equal(
    FakeEventSource.instances[1].url,
    "/api/events?username=acc-a&stream_version=2",
    "visible pages should use the versioned SSE handshake so legacy clients can be retired"
  );
}

function test_page_lifecycle_handlers_release_inventory_event_stream() {
  assert.equal(
    APP_SOURCE.includes('document.addEventListener("visibilitychange", syncInventoryEventStreamVisibility);'),
    true,
    "visibility changes should drive the inventory SSE lifecycle"
  );
  assert.equal(
    APP_SOURCE.includes('window.addEventListener("pagehide", stopInventoryEventStream);'),
    true,
    "pagehide should release the inventory SSE even when beforeunload is skipped"
  );
}

async function main() {
  await test_disconnected_manual_refresh_wires_connect_progress_overlay();
  await test_connected_manual_refresh_skips_connect_overlay();
  await test_disconnect_others_request_has_a_bounded_local_timeout();
  test_saved_account_status_badge_routes_connect_through_shared_overlay_source();
  await test_use_account_reuses_shared_connect_overlay();
  test_connection_ready_event_marks_connected_and_clears_connect_overlay();
  test_connection_ready_event_respects_silent_refresh_summary();
  test_hidden_page_does_not_open_inventory_event_stream();
  test_visibility_lifecycle_closes_and_restores_only_the_current_stream();
  test_page_lifecycle_handlers_release_inventory_event_stream();
  console.log("manual-connect-progress-overlay tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
