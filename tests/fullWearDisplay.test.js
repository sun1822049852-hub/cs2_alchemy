const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const app = fs.readFileSync(appPath, "utf8");

const requiredFragments = [
  "function wearTextFull(value) {",
  'const text = value == null ? "-" : wearTextFull(value);',
  "return wearTextFull(total / values.length);",
  'relative_wear: wearTextFull(getRelativeWearValue(row)),',
  'absolute_wear: wearTextFull(getAbsoluteWearValue(row)),',
  'setScopedStatus(`辅助选材完成${sourceSuffix}：已新增配方#${recipeNo}，${createdEntry.item_ids.length}/${mode}${raritySuffix}，均值 ${wearTextFull(run.overall)} < 目标 ${wearTextFull(targetValue)}`);',
  'lines.push(`磨损: ${wearTextFull(row.float_value)}`);',
  "? numberTextTrunc(minWear, WEAR_INPUT_DECIMALS)",
  ': `${numberTextTrunc(minWear, WEAR_INPUT_DECIMALS)}~${numberTextTrunc(maxWear, WEAR_INPUT_DECIMALS)}`;',
  'childCells.push(`<td>${itemHasWear(item) ? wearTextFull(item.float_value) : ""}</td>`);'
];

for (const fragment of requiredFragments) {
  assert.equal(
    app.includes(fragment),
    true,
    `full wear display should include fragment: ${fragment}`
  );
}

const forbiddenFragments = [
  'const text = value == null ? "-" : numberTextTrunc(value, WEAR_INPUT_DECIMALS);',
  'relative_wear: numberTextTrunc(getRelativeWearValue(row), WEAR_INPUT_DECIMALS),',
  'absolute_wear: numberTextTrunc(getAbsoluteWearValue(row), WEAR_INPUT_DECIMALS),',
  'setScopedStatus(`辅助选材完成${sourceSuffix}：已新增配方#${recipeNo}，${createdEntry.item_ids.length}/${mode}${raritySuffix}，均值 ${numberTextTrunc(run.overall, WEAR_INPUT_DECIMALS)} < 目标 ${numberTextTrunc(targetValue, WEAR_INPUT_DECIMALS)}`);',
  'lines.push(`磨损: ${numberTextTrunc(row.float_value, WEAR_INPUT_DECIMALS)}`);',
  "? wearTextFull(minWear)",
  ': `${wearTextFull(minWear)}~${wearTextFull(maxWear)}`;',
  'childCells.push(`<td>${itemHasWear(item) ? numberTextTrunc(item.float_value, WEAR_INPUT_DECIMALS) : ""}</td>`);'
];

for (const fragment of forbiddenFragments) {
  assert.equal(
    app.includes(fragment),
    false,
    `full wear display should not keep truncated fragment: ${fragment}`
  );
}

console.log("fullWearDisplay tests passed");
