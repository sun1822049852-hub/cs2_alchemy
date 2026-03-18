const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const source = fs.readFileSync(appPath, "utf8");

const forbiddenSymbols = [
  "function runCraftAssistSelectionForRecipe(",
  "function applyCraftAssistDeficitCorrection(",
  "function applyCraftAssistOverflowCorrection(",
  "function applyCraftAssistOffsetWindowCorrection(",
  "function solveCraftAssistMinCostAssignmentForRarity(",
  "function findCraftAssistFallbackBelowTargetSolution(",
  "function pickCraftAssistBySplit("
];

for (const symbol of forbiddenSymbols) {
  assert.equal(
    source.includes(symbol),
    false,
    `frontend should not keep mirrored craft-assist solver symbol: ${symbol}`
  );
}

assert.equal(
  source.includes('api("/api/craft/assist-select"'),
  true,
  "frontend must still call backend craft assist API"
);

console.log("uiCraftAssistSingleSource tests passed");
