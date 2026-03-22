const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const STYLES_PATH = path.resolve(__dirname, "../ui/styles.css");
const STYLES_SOURCE = fs.readFileSync(STYLES_PATH, "utf8");

function extractCssBlock(selector) {
  const start = STYLES_SOURCE.indexOf(selector);
  assert.notEqual(start, -1, `missing selector: ${selector}`);
  const openBrace = STYLES_SOURCE.indexOf("{", start);
  assert.notEqual(openBrace, -1, `missing block start for: ${selector}`);
  const closeBrace = STYLES_SOURCE.indexOf("}", openBrace);
  assert.notEqual(closeBrace, -1, `missing block end for: ${selector}`);
  return STYLES_SOURCE.slice(openBrace + 1, closeBrace);
}

function testPresetCardsDoNotShrinkVertically() {
  const block = extractCssBlock(".craft-assist-preset-item");
  assert.equal(
    /flex:\s*0\s+0\s+auto;/.test(block),
    true,
    "preset cards should keep intrinsic height so the list scrolls instead of vertically compressing them"
  );
}

function main() {
  testPresetCardsDoNotShrinkVertically();
  console.log("craft-assist-preset-layout tests passed");
}

main();
