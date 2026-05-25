const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const CSS_PATH = path.resolve(__dirname, "../ui/styles.css");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");
const CSS_SOURCE = fs.readFileSync(CSS_PATH, "utf8");

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

function createLoadPrefsContext(storageValue) {
  const context = {
    Math,
    Number,
    JSON,
    state: {
      craftUseComponentItems: false,
      craftIncludeCooling: false,
      craftShowSeed: false,
      craftShowFullWear: false,
      craftShowCoolingTime: false,
      craftAssistFastMode: false,
      craftAssistWearOffset: 0.00001,
      craftRightPanelWidth: 0,
      craftAssistOverlayHeight: 0,
      craftAssistPresetWidth: 0
    },
    localStorage: {
      getItem(key) {
        assert.equal(key, "craft_ui_prefs");
        return storageValue;
      }
    },
    CRAFT_UI_PREFS_KEY: "craft_ui_prefs",
    DEFAULT_CRAFT_ASSIST_WEAR_OFFSET: 0.00001,
    normalizeCraftAssistWearOffset(value, fallback) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : fallback;
    },
    normalizeLegacyCraftAssistWearOffsetPct(value, fallback) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric / 100 : fallback;
    }
  };
  vm.runInNewContext(extractFunctionSource("loadCraftUiPrefs"), context, {filename: APP_PATH});
  return context;
}

assert.equal(
  APP_SOURCE.includes("craftRightPanelWidth: 0"),
  true,
  "craft right panel width should start in auto mode so the first visit can expand to the maximum width"
);

assert.match(
  CSS_SOURCE,
  /\.craft-layout\s*\{[\s\S]*--craft-right-width:\s*min\(760px,\s*70vw\);/m,
  "craft layout should render the right panel at the largest default width before any saved preference loads"
);

const clampContext = {
  Math,
  Number,
  window: {innerWidth: 1600}
};
vm.runInNewContext(extractFunctionSource("clampCraftRightPanelWidth"), clampContext, {filename: APP_PATH});

assert.equal(
  clampContext.clampCraftRightPanelWidth(undefined),
  760,
  "craft right panel should expand to the current maximum width when no saved width exists"
);

assert.equal(
  clampContext.clampCraftRightPanelWidth(420),
  420,
  "craft right panel should still honor explicit saved widths"
);

const emptyPrefsContext = createLoadPrefsContext(null);
emptyPrefsContext.loadCraftUiPrefs();
assert.equal(
  emptyPrefsContext.state.craftRightPanelWidth,
  0,
  "loading craft ui prefs should keep auto width mode when there is no saved craft_right_width"
);

const savedPrefsContext = createLoadPrefsContext(JSON.stringify({craft_right_width: 432}));
savedPrefsContext.loadCraftUiPrefs();
assert.equal(
  savedPrefsContext.state.craftRightPanelWidth,
  432,
  "loading craft ui prefs should preserve an existing saved right panel width"
);

console.log("craft-right-panel-default-width tests passed");
