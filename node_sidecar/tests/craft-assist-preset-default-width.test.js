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
      craftAssistApproachMode: false,
      craftAssistWearOffset: 0.00001,
      craftRightPanelWidth: 0,
      craftAssistOverlayHeight: 0,
      craftAssistPresetWidth: 0
    },
    localStorage: {
      getItem(key) {
        assert.equal(key, "craft_ui_prefs_v2");
        return storageValue;
      }
    },
    CRAFT_UI_PREFS_KEY: "craft_ui_prefs_v2",
    DEFAULT_CRAFT_ASSIST_WEAR_OFFSET: 0.00001,
    CRAFT_ASSIST_PRESET_MIN_WIDTH: 186,
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

assert.match(
  CSS_SOURCE,
  /\.craft-assist-content\s*\{[\s\S]*--craft-assist-preset-width:\s*186px;/m,
  "craft assist preset rail should render at the minimum width before any JS resize logic runs"
);

const clampContext = {
  Math,
  Number,
  CRAFT_ASSIST_PRESET_MIN_WIDTH: 186,
  ui: {
    craftAssistContent: {
      clientWidth: 0
    }
  }
};
vm.runInNewContext(extractFunctionSource("clampCraftAssistPresetWidth"), clampContext, {filename: APP_PATH});

assert.equal(
  clampContext.clampCraftAssistPresetWidth(undefined),
  186,
  "craft assist preset rail should default to the minimum width when no prior width is loaded"
);

assert.equal(
  clampContext.clampCraftAssistPresetWidth(278),
  278,
  "craft assist preset rail should still honor an explicit runtime resize within the allowed range"
);

const savedPrefsContext = createLoadPrefsContext(JSON.stringify({craft_assist_preset_width: 348}));
savedPrefsContext.loadCraftUiPrefs();
assert.equal(
  savedPrefsContext.state.craftAssistPresetWidth,
  186,
  "loading craft ui prefs should reset the preset rail to the minimum width instead of replaying an older wide sidebar"
);

console.log("craft-assist-preset-default-width tests passed");
