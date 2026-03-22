const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const app = fs.readFileSync(appPath, "utf8");

const requiredFragments = [
  "return clamped;",
  'input.value = wearTextFull(parsed);',
  'ui.craftAssistTargetWear.placeholder = "0.1234567890123456";',
  'ui.craftAssistTargetWear.value = targetWear == null ? "" : wearTextFull(targetWear);'
];

for (const fragment of requiredFragments) {
  assert.equal(
    app.includes(fragment),
    true,
    `target wear precision should include fragment: ${fragment}`
  );
}

const forbiddenFragments = [
  "return truncateNumber(clamped, WEAR_INPUT_DECIMALS);",
  'input.value = wearText6(parsed);',
  'ui.craftAssistTargetWear.placeholder = "0.000000";',
  'ui.craftAssistTargetWear.value = targetWear == null ? "" : wearText6(targetWear);'
];

for (const fragment of forbiddenFragments) {
  assert.equal(
    app.includes(fragment),
    false,
    `target wear precision should not keep fragment: ${fragment}`
  );
}

console.log("targetWearPrecision tests passed");
