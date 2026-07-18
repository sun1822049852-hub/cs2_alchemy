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
    getTradeupSimulationPresetById: overrides.getTradeupSimulationPresetById || ((presetId) => context.state.simulationPresets.find((entry) => entry.id === presetId) || null),
    updateTradeupSimulationPresetRecord: overrides.updateTradeupSimulationPresetRecord || ((presetId, updater) => {
      const index = context.state.simulationPresets.findIndex((entry) => entry.id === presetId);
      if (index < 0) return null;
      context.state.simulationPresets[index] = updater({...context.state.simulationPresets[index]});
      return context.state.simulationPresets[index];
    }),
    saveTradeupSimulationPresetsToStorage: overrides.saveTradeupSimulationPresetsToStorage || (() => {}),
    renderSimulationPage: overrides.renderSimulationPage || (() => {}),
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

async function test_existing_saved_tradeup_simulation_preset_saves_without_rename_prompt() {
  const primary = createSimulationItem();
  let promptCount = 0;
  const app = loadSavePromptFns({
    state: {
      simulationWorkspaceSourcePresetId: "preset_saved",
      simulationPresets: [{id: "preset_saved", name: "旧配置名", primary_output: primary}],
      simulationWorkspacePreset: {
        id: "preset_saved",
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
    openCraftAssistPresetModal: async () => {
      promptCount += 1;
      return "不应出现";
    }
  });

  const saved = await app.saveActiveTradeupSimulationPreset();

  assert.equal(saved, true);
  assert.equal(promptCount, 0, "saving an existing preset must not reopen the rename modal");
  assert.equal(app.state.simulationWorkspacePreset.name, "旧配置名");
}

async function test_new_tradeup_simulation_preset_still_prompts_for_a_name() {
  const primary = createSimulationItem();
  let receivedInitialName = "__unset__";
  const app = loadSavePromptFns({
    state: {
      simulationWorkspaceSourcePresetId: "",
      simulationWorkspacePreset: {
        id: "draft_new",
        name: "",
        primary_output: primary
      }
    },
    openCraftAssistPresetModal: async (initialName) => {
      receivedInitialName = String(initialName);
      return "新配置名称";
    }
  });

  const saved = await app.saveActiveTradeupSimulationPreset();

  assert.equal(saved, true);
  assert.equal(receivedInitialName, "");
  assert.equal(app.state.simulationWorkspacePreset.name, "新配置名称");
}

async function test_saved_tradeup_simulation_preset_can_be_renamed_only_from_explicit_action() {
  const primary = createSimulationItem();
  let saveCount = 0;
  const app = loadSavePromptFns({
    state: {
      simulationPresets: [{id: "preset_rename", name: "旧名称", primary_output: primary}],
      simulationWorkspaceSourcePresetId: "preset_rename",
      simulationWorkspacePreset: {id: "preset_rename", name: "旧名称", primary_output: primary}
    },
    openCraftAssistPresetModal: async (initialName, options) => {
      assert.equal(initialName, "旧名称");
      assert.equal(options.title, "重命名汰换配置");
      return "新名称";
    },
    saveTradeupSimulationPresetsToStorage: () => {
      saveCount += 1;
    }
  });

  const renamed = await app.renameTradeupSimulationPreset("preset_rename");

  assert.equal(renamed, true);
  assert.equal(app.state.simulationPresets[0].name, "新名称");
  assert.equal(app.state.simulationWorkspacePreset.name, "新名称");
  assert.equal(saveCount, 1);
}

async function main() {
  await test_existing_saved_tradeup_simulation_preset_saves_without_rename_prompt();
  await test_new_tradeup_simulation_preset_still_prompts_for_a_name();
  await test_saved_tradeup_simulation_preset_can_be_renamed_only_from_explicit_action();
  console.log("tradeup-simulation-save-prompt tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
