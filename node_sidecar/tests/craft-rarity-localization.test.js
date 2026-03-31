const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function extractConst(name) {
  const match = APP_SOURCE.match(new RegExp(`^[\\uFEFF\\s]*const\\s+${name}\\s*=\\s*[^;]+;`, "m"));
  assert.ok(match, `missing const ${name}`);
  return match[0].replace(/^\uFEFF/, "");
}

function extractFunctionSource(name) {
  const marker = `function ${name}(`;
  const start = APP_SOURCE.indexOf(marker);
  assert.notEqual(start, -1, `missing function ${name}`);
  let depth = 0;
  let seenOpen = false;
  for (let index = start; index < APP_SOURCE.length; index += 1) {
    const char = APP_SOURCE[index];
    if (char === "{") {
      depth += 1;
      seenOpen = true;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (seenOpen && depth === 0) {
        return APP_SOURCE.slice(start, index + 1);
      }
    }
  }
  throw new Error(`unterminated function ${name}`);
}

const context = {
  Math,
  Number,
  String,
  Set,
  isRowStatTrak() {
    return false;
  }
};

vm.runInNewContext(
  [
    extractConst("RARITY_MAP"),
    extractFunctionSource("normalizeCraftPredictorRarityLabel"),
    extractFunctionSource("getTradeUpRecipeFromRows"),
    extractFunctionSource("craftRarityLabel")
  ].join("\n"),
  context,
  {filename: APP_PATH}
);

assert.equal(
  context.craftRarityLabel(3),
  "军规级",
  "craft rarity helper should localize numeric rarity values into Chinese labels"
);

assert.equal(
  context.craftRarityLabel(2),
  "工业级",
  "craft rarity helper should not leak Industrial into status text"
);

const recipe = context.getTradeUpRecipeFromRows(Array.from({length: 10}, () => ({rarity: 3})));
assert.equal(recipe.ok, true);
assert.equal(
  recipe.text,
  "配方：军规级 -> 受限（recipe 2）",
  "trade-up preview text should use Chinese rarity labels"
);

assert.match(
  APP_SOURCE,
  /单配方需同一稀有度：当前为 \$\{normalizeCraftPredictorRarityLabel\(currentRarity\)\}，不能添加 \$\{normalizeCraftPredictorRarityLabel\(nextRarity\)\}/m,
  "craft assist rarity conflict hint should also normalize English rarity names into Chinese"
);

console.log("craft-rarity-localization tests passed");
