const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

function loadSavePromptFns(overrides = {}) {
  const source = extractBlock("async function saveActiveTradeupSimulationPreset(", "async function cancelTradeupSimulationEditing(");
  const context = {
    state: {
      simulationPersisting: false,
      simulationWorkspacePreset: null,
      simulationActivePresetId: "",
      simulationPresets: [],
      ...overrides.state
    },
    guardGuestAction: overrides.guardGuestAction || (() => true),
    getActiveTradeupSimulationPreset: overrides.getActiveTradeupSimulationPreset || (() => context.state.simulationWorkspacePreset),
    openCraftAssistPresetModal: overrides.openCraftAssistPresetModal || (async () => null),
    sanitizeTradeupSimulationDraftPayload: overrides.sanitizeTradeupSimulationDraftPayload || ((value) => value),
    persistTradeupSimulationPresets: overrides.persistTradeupSimulationPresets || (async () => true),
    setSummary: overrides.setSummary || (() => {}),
    showErrorToast: overrides.showErrorToast || (() => {}),
    String,
    Number,
    Array,
    Object,
    console
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function createSimulationItem({
  markethashname = "USP-S | Cortex (Minimal Wear)",
  basemarkethashname = "USP-S | Cortex",
  collection = "猎杀号收藏品"
} = {}) {
  return {
    markethashname,
    basemarkethashname,
    basename: basemarkethashname,
    name: markethashname,
    collection
  };
}

async function test_save_active_tradeup_simulation_preset_opens_with_empty_name_even_when_draft_has_name() {
  const primary = createSimulationItem();
  let receivedInitialName = "__unset__";
  const app = loadSavePromptFns({
    state: {
      simulationWorkspacePreset: {
        id: "draft_prompt_save",
        name: "旧配置名",
        primary_output: primary,
        cover_output: primary,
        active_anchor_item: primary,
        active_anchor_abs_wear: 0.118,
        output_rows: [],
        material_rows: [],
        output_candidates: [],
        warnings: [],
        dirty: true,
        created_at: 100,
        updated_at: 100
      }
    },
    openCraftAssistPresetModal: async (initialName, options = {}) => {
      receivedInitialName = String(initialName);
      assert.equal(String(options.title || ""), "保存汰换配置");
      return "  新配置名称  ";
    }
  });

  const saved = await app.saveActiveTradeupSimulationPreset();

  assert.equal(saved, true);
  assert.equal(receivedInitialName, "", "tradeup save prompt should open with an empty preset name instead of reusing the previous one");
  assert.equal(app.state.simulationWorkspacePreset.name, "新配置名称");
}

async function main() {
  await test_save_active_tradeup_simulation_preset_opens_with_empty_name_even_when_draft_has_name();
  console.log("tradeup-simulation-save-prompt tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
