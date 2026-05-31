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

function createClassList() {
  const values = new Set();
  return {
    add(...classes) {
      for (const className of classes) values.add(className);
    },
    remove(...classes) {
      for (const className of classes) values.delete(className);
    },
    toggle(className, force) {
      const enabled = force == null ? !values.has(className) : !!force;
      if (enabled) values.add(className);
      else values.delete(className);
      return enabled;
    },
    contains(className) {
      return values.has(className);
    }
  };
}

function createButton() {
  const attrs = {};
  return {
    disabled: false,
    title: "",
    textContent: "",
    classList: createClassList(),
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    getAttribute(name) {
      return attrs[name];
    },
    removeAttribute(name) {
      delete attrs[name];
    }
  };
}

function loadPermissionUiFns() {
  const source = [
    extractBlock("const CLIENT_PERMISSION_LABELS = {", "async function api("),
    extractBlock("function syncAccountLoginActionState(", "function setAccountLoginBusy("),
    extractBlock("function renderSimulationWorkspaceActionsBar(", "// ── Simulation Export to Craft Assist ──"),
    extractBlock("function renderTradeupSimulationPickerModal(", "function renderSimulationPage("),
    extractBlock("function renderCraftPage(", "async function ensureCraftConnectedForExecution("),
    extractBlock("function renderBatchCraftPage(", "async function callBatchCraftAssistSelectForAccount("),
    extractBlock("function syncComponentActionState(", "function applyFilter("),
    extractBlock("function setRefreshBusy(", "async function doRefresh(")
  ].join("\n");
  const state = {
    clientLicense: {
      authenticated: true,
      code: "",
      permissions: []
    },
    accounts: [{username: "acc-a"}],
    accountLoginBusy: false,
    refreshing: false,
    simulationViewMode: "workspace",
    simulationLoading: false,
    simulationPersisting: false,
    simulationPickerOpen: true,
    simulationPickerTitle: "选择物品",
    simulationPickerQuery: "",
    simulationPickerResults: [],
    simulationPickerError: "",
    simulationSearchLoading: false,
    craftBusy: false,
    craftPauseRequested: false,
    craftPaused: false,
    craftRecipeQueue: [],
    craftStatusText: "",
    craftStatusError: false,
    craftUseComponentItems: false,
    batchCraftBusy: false,
    batchCraftAccountPickerOpen: false,
    batchCraftActiveAccount: "",
    batchCraftLimit: 10,
    batchCraftStatusText: "",
    batchCraftStatusError: false,
    currentAccountUsername: "acc-a",
    connectedUsername: "acc-a",
    componentOpBusy: false,
    selectedComponentId: "",
    targetComponentChoices: []
  };
  const ui = {
    loginSaveBtn: createButton(),
    clearAccountBtn: createButton(),
    accountPageAddBtn: createButton(),
    accountLoginModalClose: createButton(),
    accountPasswordToggle: createButton(),
    accountLoginModal: createButton(),
    simulationWorkspaceActionsBar: createButton(),
    simulationSavePresetBtn: createButton(),
    simulationCancelEditBtn: createButton(),
    simulationPickerModal: createButton(),
    simulationPickerTitle: createButton(),
    simulationPickerRoleBadge: createButton(),
    simulationPickerHint: createButton(),
    simulationPickerMeta: createButton(),
    simulationPickerSearchInput: {value: ""},
    simulationPickerSearchBtn: createButton(),
    craftPage: createButton(),
    craftConnectText: createButton(),
    craftSelectionTitle: createButton(),
    craftSelectedText: createButton(),
    craftRecipeText: createButton(),
    craftAddRecipeBtn: createButton(),
    craftExecuteQueueBtn: {
      ...createButton(),
      querySelector() {
        return {classList: createClassList()};
      }
    },
    craftClearQueueBtn: createButton(),
    craftAssistToggleBtn: createButton(),
    batchCraftPage: createButton(),
    batchCraftActiveAccountText: createButton(),
    batchCraftLimitInput: {value: ""},
    batchCraftRunSelectBtn: createButton(),
    batchCraftExecuteBtn: createButton(),
    batchCraftAddAccountBtn: createButton(),
    batchCraftClearAccountsBtn: createButton(),
    batchCraftClearQueueBtn: createButton(),
    batchCraftStatusText: {
      ...createButton(),
      classList: createClassList()
    },
    componentDepositBtn: createButton(),
    componentWithdrawBtn: createButton()
  };
  const context = {
    state,
    ui,
    String,
    Number,
    Array,
    Object,
    Math,
    document: {activeElement: null},
    isCurrentAccountConnected: () => true,
    isGuestWorkspaceActive: () => false,
    setConnectionStatusTone() {},
    syncCurrentCraftAssistRuntimeState() {},
    syncCraftSettingsControls() {},
    setCraftSettingsPanelOpen() {},
    updateCraftActionLayout() {},
    reconcileCraftQueueWithInventory() {},
    ensureActiveCraftRecipe() {},
    syncCraftPredictorContextWithActiveRecipe() {},
    getCraftCandidates: () => [{asset_id: "1"}],
    getCraftSelectedRows: () => [],
    getTradeUpRecipeFromRows: () => ({ok: true, text: "ok"}),
    getCraftQueuePendingCount: () => 0,
    getCraftExecutableEntries: () => [{id: "recipe-1"}],
    isCraftRecipeEditLocked: () => false,
    syncCraftStatusDom() {},
    renderCraftQueue() {},
    renderCraftAssistPanel() {},
    renderSavedAccounts() {},
    setCraftStatus(message, isError = false) {
      state.craftStatusText = String(message || "");
      state.craftStatusError = !!isError;
    },
    renderCraftGrouped() {},
    renderCraftExecutionOverlay() {},
    renderBatchCraftAccountCards() {},
    renderBatchCraftAccountPicker() {},
    renderBatchCraftPresetList() {},
    renderBatchCraftQueue() {},
    closeBatchCraftAccountPicker() {
      state.batchCraftAccountPickerOpen = false;
    },
    syncBatchCraftSettingsControls() {},
    renderCraftPredictorPanel() {},
    updateCraftPredictorHandleGeometry() {},
    getActiveTradeupSimulationPreset: () => ({}),
    getTradeupSimulationPickerContext: () => ({
      roleText: "目标",
      hintText: "请选择候选"
    }),
    renderTradeupSimulationPickerResults() {},
    listComponentChoices: () => [],
    selectedComponentId: () => "",
    getSelectedRows: () => [],
    console
  };
  vm.runInNewContext(
    `${source}\nthis.hasClientPermission = hasClientPermission;\nthis.clientPermissionState = clientPermissionState;\nthis.applyClientPermissionToButton = applyClientPermissionToButton;\nthis.renderBatchCraftPage = renderBatchCraftPage;`,
    context,
    {filename: APP_PATH}
  );
  return context;
}

function test_permission_helper_uses_client_auth_permissions() {
  const app = loadPermissionUiFns();
  app.state.clientLicense.permissions = ["craft.use", "inventory.refresh"];

  assert.equal(app.hasClientPermission("craft.use"), true);
  assert.equal(app.hasClientPermission("simulation.use"), false);
  assert.equal(app.clientPermissionState("simulation.use").allowed, false);
  assert.match(app.clientPermissionState("simulation.use").message, /无权|权限/);
}

function test_expired_license_blocks_permission_even_if_permission_code_exists() {
  const app = loadPermissionUiFns();
  app.state.clientLicense.authenticated = false;
  app.state.clientLicense.code = "license_expired";
  app.state.clientLicense.permissions = ["inventory.refresh"];

  assert.equal(app.hasClientPermission("inventory.refresh"), false);
  const result = app.clientPermissionState("inventory.refresh");
  assert.equal(result.allowed, false);
  assert.match(result.message, /登录|授权|失效/);
}

function test_restricted_buttons_are_disabled_with_clear_permission_hint() {
  const app = loadPermissionUiFns();
  app.state.clientLicense.permissions = ["accounts.read"];

  app.syncAccountLoginActionState();
  assert.equal(app.ui.loginSaveBtn.disabled, true);
  assert.match(app.ui.loginSaveBtn.title, /账号|权限|无权/);
  app.setRefreshBusy(false);
  assert.equal(app.ui.accountPageAddBtn.disabled, true);
  assert.match(app.ui.accountPageAddBtn.title, /账号|权限|无权/);

  app.renderSimulationWorkspaceActionsBar({primary_output: {name: "AK"}});
  assert.equal(app.ui.simulationSavePresetBtn.disabled, true);
  assert.match(app.ui.simulationSavePresetBtn.title, /模拟|权限|无权/);

  app.renderTradeupSimulationPickerModal();
  assert.equal(app.ui.simulationPickerSearchBtn.disabled, true);
  assert.match(app.ui.simulationPickerSearchBtn.title, /模拟|权限|无权/);

  app.renderCraftPage();
  assert.equal(app.ui.craftAddRecipeBtn.disabled, true);
  assert.equal(app.ui.craftAssistToggleBtn.disabled, true);
  assert.equal(app.ui.craftExecuteQueueBtn.disabled, true);
  assert.match(app.ui.craftExecuteQueueBtn.title, /炼金|权限|无权/);

  app.renderBatchCraftPage();
  assert.equal(app.ui.batchCraftRunSelectBtn.disabled, true);
  assert.equal(app.ui.batchCraftExecuteBtn.disabled, true);
  assert.match(app.ui.batchCraftRunSelectBtn.title, /炼金|权限|无权/);
  assert.match(app.ui.batchCraftExecuteBtn.title, /炼金|权限|无权/);

  app.syncComponentActionState();
  assert.equal(app.ui.componentDepositBtn.disabled, true);
  assert.equal(app.ui.componentWithdrawBtn.disabled, true);
  assert.match(app.ui.componentDepositBtn.title, /库存|权限|无权/);
}

function test_allowed_permissions_keep_buttons_available_when_other_state_allows() {
  const app = loadPermissionUiFns();
  app.state.clientLicense.permissions = [
    "accounts.write",
    "inventory.refresh",
    "craft.use",
    "simulation.use"
  ];

  app.syncAccountLoginActionState();
  assert.equal(app.ui.loginSaveBtn.disabled, false);
  app.setRefreshBusy(false);
  assert.equal(app.ui.accountPageAddBtn.disabled, false);

  app.renderSimulationWorkspaceActionsBar({primary_output: {name: "AK"}});
  assert.equal(app.ui.simulationSavePresetBtn.disabled, false);

  app.renderCraftPage();
  assert.equal(app.ui.craftAddRecipeBtn.disabled, false);
  assert.equal(app.ui.craftAssistToggleBtn.disabled, false);
  assert.equal(app.ui.craftExecuteQueueBtn.disabled, false);

  app.renderBatchCraftPage();
  assert.equal(app.ui.batchCraftRunSelectBtn.disabled, false);
  assert.equal(app.ui.batchCraftExecuteBtn.disabled, false);
}

function main() {
  test_permission_helper_uses_client_auth_permissions();
  test_expired_license_blocks_permission_even_if_permission_code_exists();
  test_restricted_buttons_are_disabled_with_clear_permission_hint();
  test_allowed_permissions_keep_buttons_available_when_other_state_allows();
  console.log("client-permission-ui-state tests passed");
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
