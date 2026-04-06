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

function loadCraftCandidateFn() {
  const source = extractBlock(
    "async function refreshCraftCandidateRows(",
    "function getCraftQueuePendingEntries("
  );
  const apiCalls = [];
  const context = {
    String,
    Number,
    Array,
    Object,
    JSON,
    Promise,
    console,
    apiCalls,
    state: {
      currentAccountUsername: "demo_user",
      snapshotPath: "C:/demo/snapshot.json",
      craftUseComponentItems: true,
      craftIncludeCooling: false,
      craftCandidateLoadedKey: "",
      craftCandidateLoading: false,
      craftCandidateRequestKey: "",
      craftCandidateRequestSeq: 0
    },
    clearCraftCandidateState() {
      throw new Error("clearCraftCandidateState should not be called");
    },
    buildCraftCandidateRequestKey() {
      return "demo_request_key";
    },
    getCraftCandidateSelectedIds() {
      return ["asset_1", "asset_2"];
    },
    setCraftStatus() {},
    renderCraftPage() {},
    api(route, options = {}) {
      apiCalls.push({route, options});
      return Promise.resolve({
        rows: [{asset_id: "asset_1"}],
        stats: {total: 1}
      });
    }
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

async function test_refresh_craft_candidate_rows_suppresses_global_auth_failure() {
  const context = loadCraftCandidateFn();

  const loaded = await context.refreshCraftCandidateRows();
  const call = context.apiCalls[0];

  assert.equal(loaded, true);
  assert.ok(call);
  assert.equal(call.route, "/api/craft/candidates");
  assert.equal(call.options.suppressAuthFailure, true);
}

async function main() {
  await test_refresh_craft_candidate_rows_suppresses_global_auth_failure();
  console.log("craft-candidate-auth-suppression tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
