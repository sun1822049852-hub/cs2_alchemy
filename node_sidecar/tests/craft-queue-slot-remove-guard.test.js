const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function main() {
  assert.equal(
    APP_SOURCE.includes("function isCraftRecipeEditLocked() {"),
    true,
    "craft queue should expose a shared recipe edit lock helper"
  );

  assert.equal(
    APP_SOURCE.includes("return !!(state.refreshing || state.craftBusy || state.craftAssistSelecting || state.componentOpBusy);"),
    true,
    "shared recipe edit lock should cover assist selecting and component move busy states"
  );

  assert.equal(
    APP_SOURCE.includes('function makeCraftSlotNode({row = null, rawId = "", onRemove = null, removeDisabled = false}) {'),
    true,
    "craft slot renderer should accept a removeDisabled flag"
  );

  assert.equal(
    APP_SOURCE.includes("removeRight.disabled = !!removeDisabled;"),
    true,
    "craft slot remove affordance should become disabled while recipe edits are locked"
  );

  assert.equal(
    APP_SOURCE.includes("if (removeDisabled) return;"),
    true,
    "craft slot remove handler should guard against locked recipe edits"
  );

  assert.equal(
    APP_SOURCE.includes("const recipeEditLocked = isCraftRecipeEditLocked();"),
    true,
    "craft queue rendering should derive remove state from the shared recipe edit lock"
  );

  assert.equal(
    APP_SOURCE.includes("removeDisabled: recipeEditLocked"),
    true,
    "craft queue slots should reuse the shared lock when deciding whether removal is allowed"
  );

  console.log("craft-queue-slot-remove-guard tests passed");
}

main();
