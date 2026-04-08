const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
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

function createContext({apiResult} = {}) {
  const summaryCalls = [];
  const rowsCalls = [];
  const nowIso = new Date().toISOString();
  const context = {
    Date,
    JSON,
    Math,
    Number,
    String,
    Array,
    Object,
    Map,
    Set,
    encodeURIComponent,
    structuredClone: global.structuredClone,
    state: {
      snapshotCacheByAccount: new Map(),
      connectedUsername: "alice",
      currentAccountUsername: "",
      fetchTime: "",
      emptyHint: ""
    },
    summaryCalls,
    rowsCalls,
    setRows(rows, component, snapshotPath) {
      rowsCalls.push({
        rows: Array.isArray(rows) ? rows : [],
        component,
        snapshotPath: String(snapshotPath || "")
      });
    },
    clearSnapshotDirty() {},
    syncInventoryTop() {},
    setSummary(message, options = {}) {
      summaryCalls.push({
        message: String(message || "").trim(),
        options
      });
    },
    api: async () => apiResult || {
      rows: [],
      component: {summary_map: {}, item_map: {}},
      snapshot: {path: ""},
      fetch_time: nowIso,
      connected: false
    }
  };
  const source = [
    extractConst("SNAPSHOT_REUSE_WINDOW_MS"),
    extractBlock("function parseFetchTimeMs(", "function markSnapshotDirty("),
    extractBlock("async function loadSnapshotForAccount(", "async function switchAccountView(")
  ].join("\n");
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function test_apply_cached_snapshot_marks_offline_empty_message_as_non_error() {
  const context = createContext();
  context.state.snapshotCacheByAccount.set("alice", {
    rows: [],
    component: {summary_map: {}, item_map: {}},
    snapshotPath: "",
    fetchTime: new Date().toISOString(),
    connected: false
  });

  const applied = context.applyCachedSnapshotForAccount("alice");

  assert.equal(applied, true);
  assert.equal(context.summaryCalls.length, 1);
  assert.equal(context.summaryCalls[0].message, "当前账号未连接（暂无上次库存信息）");
  assert.equal(context.summaryCalls[0].options.isError, false);
}

async function test_load_snapshot_marks_offline_empty_message_as_non_error() {
  const context = createContext({
    apiResult: {
      rows: [],
      component: {summary_map: {}, item_map: {}},
      snapshot: {path: ""},
      fetch_time: new Date().toISOString(),
      connected: false
    }
  });

  const loaded = await context.loadSnapshotForAccount("alice");

  assert.equal(loaded, true);
  assert.equal(context.summaryCalls.length, 1);
  assert.equal(context.summaryCalls[0].message, "当前账号未连接（暂无上次库存信息）");
  assert.equal(context.summaryCalls[0].options.isError, false);
}

(async () => {
  test_apply_cached_snapshot_marks_offline_empty_message_as_non_error();
  await test_load_snapshot_marks_offline_empty_message_as_non_error();
  console.log("offlineSnapshotToastSuppression tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
