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

function testPresetCardsStretchAndWrapResponsively() {
  const listBlock = extractCssBlock(".craft-assist-preset-list");
  assert.equal(/display:\s*grid;/.test(listBlock), true, "preset list should use grid layout");
  assert.equal(
    /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(160px,\s*1fr\)\);/.test(listBlock),
    true,
    "preset list should stretch cards and add columns when the rail becomes wide enough"
  );

  const block = extractCssBlock(".craft-assist-preset-item");
  assert.equal(
    /width:\s*100%;/.test(block),
    true,
    "preset cards should fill the available card track so the new footer can align its action row consistently"
  );
  assert.equal(
    /max-width:\s*none;/.test(block),
    true,
    "preset cards should not keep the old compact width cap"
  );
  assert.equal(
    /margin:\s*0;/.test(block),
    true,
    "preset cards should fill their responsive grid track"
  );
}

function testPresetFooterCentersAgainstCardShell() {
  const itemBlock = extractCssBlock(".craft-assist-preset-item");
  assert.equal(
    /padding:\s*10px;/.test(itemBlock),
    true,
    "preset card shell should use symmetric horizontal padding so the footer action row can center against the visible card chrome"
  );

  const bodyBlock = extractCssBlock(".craft-assist-preset-body");
  assert.equal(
    /padding-right:\s*54px;/.test(bodyBlock),
    true,
    "preset card body should own the extra right inset needed to avoid the duplicate and remove buttons without shifting the footer off center"
  );
}

function main() {
  testPresetCardsDoNotShrinkVertically();
  testPresetCardsStretchAndWrapResponsively();
  testPresetFooterCentersAgainstCardShell();
  console.log("craft-assist-preset-layout tests passed");
}

main();
