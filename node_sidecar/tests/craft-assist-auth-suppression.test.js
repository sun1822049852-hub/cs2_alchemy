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

function loadCraftAssistAuthFns() {
  const source = [
    extractBlock("async function saveCraftAssistPresetsToServer(", "async function loadCraftAssistPresetsFromServer("),
    extractBlock("async function loadCraftAssistPresetsFromServer(", "function saveCraftAssistPresetsToStorage(")
  ].join("\n");
  const apiCalls = [];
  const context = {
    Array,
    Object,
    console,
    apiCalls,
    normalizeCraftAssistPresetList(value) {
      return Array.isArray(value) ? value : [];
    },
    api(route, options = {}) {
      apiCalls.push({route, options});
      return Promise.resolve({ok: true, presets: []});
    }
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

async function test_craft_assist_server_preset_sync_suppresses_global_auth_failure() {
  const context = loadCraftAssistAuthFns();

  await context.loadCraftAssistPresetsFromServer();
  await context.saveCraftAssistPresetsToServer([{id: "preset_1"}]);

  const loadCall = context.apiCalls.find((call) => call.route === "/api/ui-state/craft-assist-presets" && (!call.options.method || call.options.method === "GET"));
  const saveCall = context.apiCalls.find((call) => call.route === "/api/ui-state/craft-assist-presets" && call.options.method === "POST");

  assert.ok(loadCall);
  assert.ok(saveCall);
  assert.equal(loadCall.options.suppressAuthFailure, true);
  assert.equal(saveCall.options.suppressAuthFailure, true);
}

async function main() {
  await test_craft_assist_server_preset_sync_suppresses_global_auth_failure();
  console.log("craft-assist-auth-suppression tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
