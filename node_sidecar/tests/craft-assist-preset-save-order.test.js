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

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function test_preset_server_saves_are_serialized_in_edit_order() {
  let releaseFirst;
  const firstPending = new Promise((resolve) => { releaseFirst = resolve; });
  const requests = [];
  const context = {
    state: {craftAssistPresets: [{id: "preset", materials: [{role: "main", count: 9}]}]},
    normalizeCraftAssistPresetList(values) {
      return JSON.parse(JSON.stringify(Array.isArray(values) ? values : []));
    },
    writeCraftAssistPresetsToLocalStorage() {},
    async api(route, options) {
      const payload = JSON.parse(options.body);
      requests.push({route, payload});
      if (requests.length === 1) await firstPending;
      return {ok: true};
    },
    Promise,
    JSON
  };
  const source = extractBlock(
    "async function saveCraftAssistPresetsToServer(",
    "async function loadCraftAssistPresetsFromStorage("
  );
  vm.runInNewContext(source, context, {filename: APP_PATH});

  context.saveCraftAssistPresetsToStorage();
  context.state.craftAssistPresets = [{id: "preset", materials: [{role: "main", count: 10}]}];
  context.saveCraftAssistPresetsToStorage();
  await flushMicrotasks();

  assert.equal(requests.length, 1, "the second save must wait until the first server write settles");
  assert.equal(requests[0].payload.presets[0].materials[0].count, 9);

  releaseFirst();
  await flushMicrotasks();
  await flushMicrotasks();

  assert.equal(requests.length, 2);
  assert.equal(requests[1].payload.presets[0].materials[0].count, 10);
}

test_preset_server_saves_are_serialized_in_edit_order()
  .then(() => console.log("craft-assist-preset-save-order tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
