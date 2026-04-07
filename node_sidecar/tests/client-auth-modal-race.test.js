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

function createContext() {
  const source = [
    extractBlock("function applyGuestWorkspacePreview(", "function setClientAuthView("),
    extractBlock("async function loadLicenseState(", "async function submitClientLogin(")
  ].join("\n");

  let resolveLicenseState;
  const requestPromise = new Promise((resolve) => {
    resolveLicenseState = resolve;
  });

  const context = {
    Array,
    JSON,
    Map,
    Promise,
    Set,
    String,
    requestLicenseJson() {
      return requestPromise;
    },
    applyClientLicenseState(data) {
      const payload = data && typeof data === "object" ? data : {};
      context.state.clientLicense = {
        authenticated: !!payload.authenticated,
        message: String(payload.message || "").trim()
      };
    },
    renderLicenseGate() {},
    initializeAuthenticatedWorkspace: async () => {
      throw new Error("guest bootstrap should not initialize authenticated workspace");
    },
    setLicenseStatus() {},
    deepCopyPlain(value) {
      if (value == null) return value;
      return JSON.parse(JSON.stringify(value));
    },
    guestPreviewProvider: {
      getGuestInventoryPreview() {
        return {
          rows: [],
          component: {summary_map: {}, item_map: {}},
          snapshotPath: "",
          summary: "guest preview"
        };
      },
      getGuestCraftPreview() {
        return {
          candidateRows: [],
          candidateStats: null,
          recipeQueue: [],
          activeRecipeId: "",
          predictor: null
        };
      },
      getGuestSimulationPreview() {
        return {
          savedPresets: [],
          workspacePreset: null
        };
      }
    },
    state: {
      clientLicense: {
        authenticated: false,
        message: ""
      },
      clientAuthModalOpen: false,
      clientAuthPromptTitle: "",
      clientAuthPromptHint: "",
      workspaceHydratedFor: "booting",
      accounts: [],
      activeAccount: "demo",
      accountSelectedUsername: "demo",
      currentAccountUsername: "demo",
      connectedUsername: "demo",
      selectedComponentItemIds: new Set(["component_1"]),
      snapshotCacheByAccount: new Map([["demo", {}]]),
      craftAccountStateByAccount: new Map([["demo", {}]]),
      craftAssistRuntimeByAccount: new Map([["demo", {}]]),
      craftAssistActiveRunTokensByAccount: new Map([["demo", {}]]),
      profileHydratingUsernames: new Set(["demo"]),
      profileHydratedUsernames: new Set(["demo"]),
      componentTaskQueue: {running: {id: "task_1"}, queued: [{id: "task_2"}]},
      selectedQueueJobId: "task_2",
      targetDrawerOpen: true,
      targetComponentChoices: [{id: "component_1"}],
      targetComponentSelectedId: "component_1",
      targetComponentExcludeId: "component_2",
      fetchTime: "2026-04-07T00:00:00.000Z",
      craftCandidateRows: [{id: "candidate_1"}],
      craftCandidateStats: {count: 1},
      craftCandidateLoading: true,
      craftCandidateRequestKey: "request_1",
      craftCandidateLoadedKey: "request_0",
      craftRecipeQueue: [{id: "recipe_1"}],
      craftActiveRecipeId: "recipe_1",
      craftPredictorResponse: {ok: true},
      craftPredictorError: "old error",
      craftPredictorLoading: true,
      craftSelectedItemIds: new Set(["item_1"]),
      craftAssistOpen: true,
      craftAssistPickerOpen: true,
      craftAssistPickerTargetMaterialId: "material_1",
      craftAssistRoleChooserOpen: true,
      craftAssistMaterials: [{id: "material_1"}],
      craftAssistPresets: [{id: "preset_1"}],
      craftAssistPresetApplyCountMap: {preset_1: 1},
      craftAssistPresetEditingId: "preset_1",
      craftAssistPresetEditingName: "preset",
      craftAssistPresetEditingBackup: {id: "preset_1"},
      craftAssistPresetEditingInitialSnapshot: {id: "preset_1"},
      craftAssistPendingUiAction: "apply",
      craftAssistPendingPresetId: "preset_1",
      craftAssistRunToken: "token_1",
      simulationPresets: [{id: "sim_1"}],
      simulationActivePresetId: "sim_1",
      simulationWorkspacePreset: {id: "workspace_1"},
      simulationWorkspaceSourcePresetId: "sim_1",
      simulationPickerOpen: true,
      simulationModalOpen: true
    },
    setAccountForm() {},
    setNoAccountState() {},
    setRows() {},
    clearCraftExecutionOverlayState() {},
    closeTargetComponentDrawer() {},
    renderTaskQueueControls() {},
    syncInventoryAccountSelect() {},
    syncInventoryTop() {},
    renderSavedAccounts() {},
    renderCraftPage() {},
    renderSimulationPage() {},
    renderGuestWorkspaceNotice() {},
    setAccountStatus() {},
    setSummary() {}
  };

  vm.runInNewContext(source, context, {filename: APP_PATH});
  return {
    context,
    resolveLicenseState
  };
}

async function test_guest_bootstrap_does_not_close_user_opened_login_modal() {
  const {context, resolveLicenseState} = createContext();
  const loading = context.loadLicenseState({hydrateWorkspace: true});

  context.state.clientAuthModalOpen = true;
  context.state.clientAuthPromptTitle = "登录后可用当前功能";
  context.state.clientAuthPromptHint = "当前为访客预览态，登录后可继续使用真实功能。";

  resolveLicenseState({
    data: {
      authenticated: false,
      message: "当前未登录，已进入访客预览态。"
    }
  });
  await loading;

  assert.equal(context.state.clientAuthModalOpen, true);
  assert.equal(context.state.clientAuthPromptTitle, "登录后可用当前功能");
  assert.equal(context.state.clientAuthPromptHint, "当前为访客预览态，登录后可继续使用真实功能。");
}

async function main() {
  await test_guest_bootstrap_does_not_close_user_opened_login_modal();
  console.log("client-auth-modal-race tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
