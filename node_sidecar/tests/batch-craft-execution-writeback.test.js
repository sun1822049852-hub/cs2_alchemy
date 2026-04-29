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

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadRunBatchCraftExecution(overrides = {}) {
  const source = extractBlock(
    "async function runBatchCraftExecution(",
    "function bindBatchCraftEvents("
  );
  const context = {
    Math,
    Number,
    String,
    Boolean,
    Array,
    Set,
    JSON,
    state: overrides.state,
    openConfirmModal: overrides.openConfirmModal,
    setBatchCraftStatus: overrides.setBatchCraftStatus,
    setBatchCraftOverlay: overrides.setBatchCraftOverlay,
    renderBatchCraftPage: overrides.renderBatchCraftPage,
    renderBatchCraftAccountCards: overrides.renderBatchCraftAccountCards,
    renderBatchCraftQueue: overrides.renderBatchCraftQueue,
    api: overrides.api,
    doRefresh: overrides.doRefresh,
    setRows: overrides.setRows,
    syncInventoryTop: overrides.syncInventoryTop,
    cacheSnapshotForAccount: overrides.cacheSnapshotForAccount,
    console
  };
  vm.runInNewContext(`${source}\nthis.runBatchCraftExecution = runBatchCraftExecution;`, context, {filename: APP_PATH});
  return context;
}

async function test_batch_craft_success_writebacks_latest_inventory_snapshot() {
  const oldRows = [{asset_id: "spent-1", market_hash_name: "Old Item"}];
  const newRows = [{asset_id: "gained-1", market_hash_name: "New Item"}];
  const newComponent = {summary_map: {unit_1: {component_id: "unit_1", loaded_count: 1}}, item_map: {}};
  const state = {
    batchCraftBusy: false,
    batchCraftQueue: [{
      username: "acc-a",
      recipes: [{
        id: "recipe-1",
        item_ids: ["spent-1"],
        status: "pending",
        result: null
      }]
    }],
    craftIncludeCooling: false,
    batchCraftActiveAccount: "",
    currentAccountUsername: "acc-a",
    rows: deepCopy(oldRows),
    component: {summary_map: {}, item_map: {}},
    snapshotPath: "snapshot-old.json",
    fetchTime: "old-fetch",
    snapshotCacheByAccount: new Map([
      ["acc-a", {
        rows: deepCopy(oldRows),
        component: {summary_map: {}, item_map: {}},
        snapshotPath: "snapshot-old.json",
        fetchTime: "old-fetch",
        connected: true,
        authState: "normal",
        authReason: ""
      }]
    ])
  };

  const app = loadRunBatchCraftExecution({
    state,
    async openConfirmModal() {
      return true;
    },
    setBatchCraftStatus() {},
    setBatchCraftOverlay() {},
    renderBatchCraftPage() {},
    renderBatchCraftAccountCards() {},
    renderBatchCraftQueue() {},
    setRows(rows, component, snapshotPath) {
      state.rows = deepCopy(rows);
      state.component = deepCopy(component);
      state.snapshotPath = String(snapshotPath || "");
    },
    syncInventoryTop() {},
    cacheSnapshotForAccount(username, payload = {}) {
      state.snapshotCacheByAccount.set(String(username || ""), {
        rows: deepCopy(Array.isArray(payload.rows) ? payload.rows : []),
        component: deepCopy(payload.component || {summary_map: {}, item_map: {}}),
        snapshotPath: String(payload.snapshotPath || ""),
        fetchTime: String(payload.fetchTime || ""),
        connected: !!payload.connected,
        authState: String(payload.authState || ""),
        authReason: String(payload.authReason || "")
      });
    },
    async doRefresh() {
      state.currentAccountUsername = "acc-a";
      state.rows = deepCopy(oldRows);
      state.component = {summary_map: {}, item_map: {}};
      state.snapshotPath = "snapshot-old.json";
      state.fetchTime = "old-fetch";
      return {ok: true};
    },
    async api(route, options = {}) {
      if (route === "/api/accounts/active") {
        assert.deepEqual(JSON.parse(String(options.body || "{}")), {username: "acc-a"});
        return {ok: true};
      }
      if (route === "/api/craft/tradeup") {
        return {
          ok: true,
          rows: deepCopy(newRows),
          component: deepCopy(newComponent),
          snapshot_path: "snapshot-new.json",
          fetch_time: "new-fetch",
          gained_ids: ["gained-1"]
        };
      }
      throw new Error(`unexpected route: ${route}`);
    }
  });

  await app.runBatchCraftExecution();

  assert.equal(state.batchCraftQueue[0].recipes[0].status, "done");
  assert.deepEqual(deepCopy(state.rows), newRows);
  assert.deepEqual(deepCopy(state.component), newComponent);
  assert.equal(state.snapshotPath, "snapshot-new.json");
  assert.equal(state.fetchTime, "new-fetch");

  const cached = state.snapshotCacheByAccount.get("acc-a");
  assert.ok(cached, "expected acc-a snapshot cache to exist");
  assert.deepEqual(deepCopy(cached.rows), newRows);
  assert.deepEqual(deepCopy(cached.component), newComponent);
  assert.equal(cached.snapshotPath, "snapshot-new.json");
  assert.equal(cached.fetchTime, "new-fetch");
}

async function main() {
  await test_batch_craft_success_writebacks_latest_inventory_snapshot();
  console.log("batch-craft-execution-writeback tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
