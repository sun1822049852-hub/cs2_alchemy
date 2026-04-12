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

function loadManualConnectFns({
  connectedUsername = "",
  currentAccountUsername = "acc-a",
  refreshResult = {ok: true}
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
      return refreshResult;
    }
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

async function test_disconnected_manual_refresh_wires_connect_progress_overlay() {
  const app = loadManualConnectFns({
    connectedUsername: "",
    currentAccountUsername: "acc-a",
    refreshResult: {ok: true}
  });

  const result = await app.refreshWithConnectionOverlay({preferCraft: false, force: false});

  assert.deepEqual(result, {ok: true});
  assert.equal(app.refreshCalls.length, 1);
  assert.equal(app.refreshCalls[0].usernameOverride, "acc-a");
  assert.equal(typeof app.refreshCalls[0].onProgress, "function");
  app.refreshCalls[0].onProgress({percent: 40, title: "正在连接账号", detail: "正在建立连接并刷新库存..."});
  assert.equal(app.overlayStates.length > 0, true);
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

function test_source_wires_manual_buttons_into_connect_overlay_helper() {
  assert.equal(
    APP_SOURCE.includes("ui.refreshBtn.onclick = () => void refreshWithConnectionOverlay({preferCraft: false, force: false});"),
    true,
    "manual inventory refresh button should go through the connect overlay helper"
  );
  assert.equal(
    APP_SOURCE.includes("ui.craftRefreshBtn.onclick = () => void refreshWithConnectionOverlay({"),
    true,
    "craft page refresh button should also go through the connect overlay helper"
  );
}

async function main() {
  await test_disconnected_manual_refresh_wires_connect_progress_overlay();
  await test_connected_manual_refresh_skips_connect_overlay();
  test_source_wires_manual_buttons_into_connect_overlay_helper();
  console.log("manual-connect-progress-overlay tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
