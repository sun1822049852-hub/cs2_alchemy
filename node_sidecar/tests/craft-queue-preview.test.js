const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function extractConst(name) {
  const match = APP_SOURCE.match(new RegExp(`^const\\s+${name}\\s*=\\s*[^;]+;`, "m"));
  assert.ok(match, `missing const ${name}`);
  return match[0];
}

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

function loadCraftQueueFns() {
  const source = [
    extractConst("WEAR_INPUT_DECIMALS"),
    extractBlock("function truncateNumber(", "function parseOptionalWear01("),
    extractBlock("function getAbsoluteWearValue(", "function makeCraftSlotNode(")
  ].join("\n");
  const context = {Math, Number, String, Array, console};
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function main() {
  const app = loadCraftQueueFns();
  assert.equal(typeof app.buildPendingCraftQueueTitle, "function");

  const recipeRows = [
    {float_value: 0, minfloat: 0, maxfloat: 1},
    {float_value: 0.015625, minfloat: 0, maxfloat: 1}
  ];

  assert.equal(app.averageAbsoluteWearText(recipeRows), "0.0078125");
  assert.equal(app.averageRelativeWearText(recipeRows), "0.0078125");
  assert.equal(
    app.buildPendingCraftQueueTitle({pendingIndex: 2, recipeRows}),
    "#2 | 平均相对磨损 0.0078125"
  );
}

main();
