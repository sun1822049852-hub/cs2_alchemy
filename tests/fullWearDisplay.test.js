const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const app = fs.readFileSync(appPath, "utf8");

const requiredFragments = [
  "const TRADEUP_SIMULATION_WEAR_DECIMALS = 16;",
  "function wearTextFull(value) {",
  "function formatVisibleWearText(value, decimals = 8) {",
  "return state.craftShowFullWear ? wearTextFull(value) : numberTextTrunc(value, decimals);",
  "return numeric.toFixed(TRADEUP_SIMULATION_WEAR_DECIMALS);",
  'const text = value == null ? "-" : formatVisibleWearText(value, 8);',
  "return wearTextFull(total / values.length);",
  'relative_wear: wearTextFull(getRelativeWearValue(row)),',
  'absolute_wear: wearTextFull(getAbsoluteWearValue(row)),',
  'setScopedStatus(`辅助选材完成${sourceSuffix}：已新增配方#${recipeNo}，${createdEntry.item_ids.length}/${mode}${raritySuffix}，均值 ${wearTextFull(run.overall)} < 目标 ${wearTextFull(targetValue)}`);',
  'if (itemHasWear(row)) lines.push(`磨损: ${formatVisibleWearText(row.float_value, 8)}`);',
  "? formatVisibleWearText(minWear, 8)",
  ': `${formatVisibleWearText(minWear, 8)}~${formatVisibleWearText(maxWear, 8)}`;',
  '<td>${relativeWearDisplayLabel(item)}</td>',
  'childCells.push(`<td>${itemHasWear(item) ? formatVisibleWearText(item.float_value, 8) : ""}</td>`);'
];

for (const fragment of requiredFragments) {
  assert.equal(
    app.includes(fragment),
    true,
    `full wear display should include fragment: ${fragment}`
  );
}

const forbiddenFragments = [
  "const FULL_WEAR_DISPLAY_MIN_DECIMALS = 16;",
  'const text = value == null ? "-" : numberTextTrunc(value, WEAR_INPUT_DECIMALS);',
  'const text = value == null ? "-" : wearTextFull(value);',
  'relative_wear: numberTextTrunc(getRelativeWearValue(row), WEAR_INPUT_DECIMALS),',
  'absolute_wear: numberTextTrunc(getAbsoluteWearValue(row), WEAR_INPUT_DECIMALS),',
  'setScopedStatus(`辅助选材完成${sourceSuffix}：已新增配方#${recipeNo}，${createdEntry.item_ids.length}/${mode}${raritySuffix}，均值 ${numberTextTrunc(run.overall, WEAR_INPUT_DECIMALS)} < 目标 ${numberTextTrunc(targetValue, WEAR_INPUT_DECIMALS)}`);',
  'lines.push(`磨损: ${numberTextTrunc(row.float_value, WEAR_INPUT_DECIMALS)}`);',
  'if (itemHasWear(row)) lines.push(`磨损: ${wearTextFull(row.float_value)}`);',
  "? wearTextFull(minWear)",
  ': `${wearTextFull(minWear)}~${wearTextFull(maxWear)}`;',
  'childCells.push(`<td>${itemHasWear(item) ? numberTextTrunc(item.float_value, WEAR_INPUT_DECIMALS) : ""}</td>`);',
  '<td>${relativeWearLabel(item)}</td>'
];

for (const fragment of forbiddenFragments) {
  assert.equal(
    app.includes(fragment),
    false,
    `full wear display should not keep truncated fragment: ${fragment}`
  );
}

const wearTextFullMatch = app.match(/function wearTextFull\(value\) \{[\s\S]*?\n\}/);
assert.notEqual(wearTextFullMatch, null, "full wear display should expose wearTextFull");

const simulationDecimalsMatch = app.match(/const TRADEUP_SIMULATION_WEAR_DECIMALS = \d+;/);
assert.notEqual(simulationDecimalsMatch, null, "tradeup simulation should define a dedicated fixed wear precision");

const formatTradeupSimulationWearMatch = app.match(/function formatTradeupSimulationWear\(value\) \{[\s\S]*?\n\}/);
assert.notEqual(formatTradeupSimulationWearMatch, null, "tradeup simulation should expose its dedicated wear formatter");

const runtime = {};
vm.runInNewContext(
  `${simulationDecimalsMatch[0]}\n${wearTextFullMatch[0]}\n${formatTradeupSimulationWearMatch[0]}\nresult = { TRADEUP_SIMULATION_WEAR_DECIMALS, wearTextFull, formatTradeupSimulationWear };`,
  runtime
);

assert.equal(runtime.result.TRADEUP_SIMULATION_WEAR_DECIMALS, 16, "tradeup simulation should keep a dedicated 16-digit wear precision");
assert.equal(runtime.result.wearTextFull(0), "0", "global full wear display should still omit redundant trailing zero padding");
assert.equal(runtime.result.wearTextFull(0.1), "0.1", "global full wear display should preserve compact decimal output outside the simulation page");
assert.equal(runtime.result.wearTextFull("0.1234567890123456"), "0.1234567890123456", "full wear display should preserve higher-precision string input");
assert.equal(runtime.result.formatTradeupSimulationWear(0), "0.0000000000000000", "tradeup simulation should still render zero with 16 fixed decimal places");
assert.equal(runtime.result.formatTradeupSimulationWear(0.1), "0.1000000000000000", "tradeup simulation should still render fixed 16-digit wear text");

console.log("fullWearDisplay tests passed");
