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

function loadSimulationAuthFns() {
  const source = [
    extractBlock("function sanitizeTradeupSimulationTargetItem(", "function getTradeupSimulationDefaultName("),
    extractBlock("async function fetchTradeupSimulationCatalogItem(", "async function hydrateTradeupSimulationStoredItem("),
    extractBlock("async function saveTradeupSimulationPresetsToServer(", "async function loadTradeupSimulationPresetsFromServer("),
    extractBlock("async function loadTradeupSimulationPresetsFromServer(", "function saveTradeupSimulationPresetsToStorage(")
  ].join("\n");
  const apiCalls = [];
  const context = {
    String,
    Number,
    Array,
    Object,
    JSON,
    Map,
    Set,
    console,
    encodeURIComponent,
    apiCalls,
    api(route, options = {}) {
      apiCalls.push({route, options});
      if (route.startsWith("/api/simulation/tradeup/item?markethashname=")) {
        return Promise.resolve({
          ok: true,
          item: {
            markethashname: "USP-S | Cortex (Minimal Wear)",
            basemarkethashname: "USP-S | Cortex",
            basename: "USP-S | Cortex",
            name: "USP-S | Cortex (Minimal Wear)",
            collection: "狂牙大行动收藏品",
            rarity: "军规级",
            minfloat: 0.06,
            maxfloat: 0.8
          }
        });
      }
      if (route === "/api/ui-state/tradeup-simulation-presets") {
        return Promise.resolve({ok: true, presets: []});
      }
      return Promise.resolve({ok: true});
    }
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

async function test_fetch_tradeup_simulation_catalog_item_suppresses_global_auth_failure() {
  const context = loadSimulationAuthFns();

  const item = await context.fetchTradeupSimulationCatalogItem("USP-S | Cortex (Minimal Wear)");
  const call = context.apiCalls[0];

  assert.ok(item);
  assert.equal(call.route.includes("/api/simulation/tradeup/item?markethashname="), true);
  assert.equal(call.options.suppressAuthFailure, true);
}

async function test_tradeup_simulation_server_preset_sync_suppresses_global_auth_failure() {
  const context = loadSimulationAuthFns();

  await context.loadTradeupSimulationPresetsFromServer();
  await context.saveTradeupSimulationPresetsToServer([{id: "preset_1"}]);

  const loadCall = context.apiCalls.find((call) => call.route === "/api/ui-state/tradeup-simulation-presets" && (!call.options.method || call.options.method === "GET"));
  const saveCall = context.apiCalls.find((call) => call.route === "/api/ui-state/tradeup-simulation-presets" && call.options.method === "POST");

  assert.ok(loadCall);
  assert.ok(saveCall);
  assert.equal(loadCall.options.suppressAuthFailure, true);
  assert.equal(saveCall.options.suppressAuthFailure, true);
}

async function main() {
  await test_fetch_tradeup_simulation_catalog_item_suppresses_global_auth_failure();
  await test_tradeup_simulation_server_preset_sync_suppresses_global_auth_failure();
  console.log("tradeup-simulation-auth-suppression tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
