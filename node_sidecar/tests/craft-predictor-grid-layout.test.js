const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const CSS_PATH = path.resolve(__dirname, "../ui/styles.css");
const app = fs.readFileSync(APP_PATH, "utf8");
const css = fs.readFileSync(CSS_PATH, "utf8");

function extractFunctionSource(name) {
  const marker = `function ${name}(`;
  const start = app.indexOf(marker);
  assert.notEqual(start, -1, `missing function ${name}`);
  let depth = 0;
  let seenOpen = false;
  for (let index = start; index < app.length; index += 1) {
    const char = app[index];
    if (char === "{") {
      depth += 1;
      seenOpen = true;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (seenOpen && depth === 0) {
        return app.slice(start, index + 1);
      }
    }
  }
  throw new Error(`unterminated function ${name}`);
}

const helperContext = {Math, Number};
vm.runInNewContext(extractFunctionSource("craftPredictorGridColumnCount"), helperContext, {filename: APP_PATH});
const craftPredictorGridColumnCount = helperContext.craftPredictorGridColumnCount;

assert.equal(
  app.includes("function craftPredictorGridColumnCount("),
  true,
  "craft predictor should expose a dedicated grid column helper for outcome groups"
);

assert.match(
  app,
  /function craftPredictorGridColumnCount\(count\)\s*\{[\s\S]*normalizedCount\s*>=\s*7[\s\S]*return 4;[\s\S]*normalizedCount\s*>=\s*5[\s\S]*return 3;[\s\S]*normalizedCount\s*===\s*4[\s\S]*return 4;[\s\S]*normalizedCount\s*===\s*3[\s\S]*return 3;[\s\S]*normalizedCount\s*===\s*2[\s\S]*return 2;[\s\S]*return 1;/m,
  "craft predictor should map three-item and five-to-six-item groups to a three-column layout"
);

assert.equal(
  app.includes('grid.dataset.columns = String(craftPredictorGridColumnCount(group.outcomes.length));'),
  true,
  "craft predictor render should derive grid columns from the helper instead of a fixed two-or-four split"
);

assert.equal(
  craftPredictorGridColumnCount(5),
  3,
  "craft predictor should keep five outcomes within two rows by using three columns"
);

assert.equal(
  craftPredictorGridColumnCount(8),
  4,
  "craft predictor should keep eight outcomes within two rows by using four columns"
);

assert.match(
  css,
  /\.craft-predictor-group-grid\[data-columns="3"\]\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/m,
  "craft predictor styles should define a dedicated three-column outcome grid"
);

assert.match(
  css,
  /body\.theme-inkblue :is\(#inventoryPage, #craftPage\) :is\(#listWrap, \.menu-list, \.task-queue-list, \.drawer-select-list, \.craft-selection-list, \.craft-queue-list, \.craft-assist-picker, \.craft-assist-list, \.craft-assist-preset-list, #craftPredictorList\)\s*\{[\s\S]*scrollbar-color:\s*rgba\(220, 164, 76, 0\.72\) rgba\(12, 14, 18, 0\.88\);/m,
  "craft predictor result list should share the inkblue themed scrollbar styling"
);

console.log("craft-predictor-grid-layout tests passed");
