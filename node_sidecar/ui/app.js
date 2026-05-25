const RARITY_MAP = {1: "Consumer", 2: "Industrial", 3: "Mil-Spec", 4: "Restricted", 5: "Classified", 6: "Covert", 7: "Contraband"};
const QUALITY_MAP = {1: "Genuine", 4: "Normal", 9: "StatTrak", 11: "Souvenir"};
const RARITY_VALUES = Object.keys(RARITY_MAP)
  .map(Number)
  .sort((a, b) => a - b)
  .map((k) => normalizeCraftPredictorRarityLabel(RARITY_MAP[k]) || RARITY_MAP[k]);
const STORAGE_UNIT_CAPACITY = 1000;
const MAIN_INVENTORY_CAPACITY = 1000;
const STORAGE_UNIT_DEF_INDEX = 1201;
const WEAR_INPUT_DECIMALS = 16;
const TRADEUP_SIMULATION_WEAR_DECIMALS = 16;
const TRADEUP_SIMULATION_MODAL_WEAR_DECIMALS = 4;
const TRADEUP_SIMULATION_RANGE_DECIMALS = 4;
const DEFAULT_CRAFT_ASSIST_WEAR_OFFSET = 0.00001;
const CRAFT_ASSIST_PRESET_MIN_WIDTH = 186;
const SNAPSHOT_REUSE_WINDOW_MS = 10 * 60 * 1000;
const WEAR_SUFFIX_RANGES = [
  {keys: ["崭新出厂", "崭新", "factory new", "factorynew"], min: 0, max: 0.07},
  {keys: ["略有磨损", "略磨", "minimal wear", "minimalwear"], min: 0.07, max: 0.15},
  {keys: ["久经沙场", "久经", "field tested", "field-tested", "fieldtested"], min: 0.15, max: 0.38},
  {keys: ["破损不堪", "破损", "well worn", "well-worn", "wellworn"], min: 0.38, max: 0.45},
  {keys: ["战痕累累", "战痕", "battle scarred", "battle-scarred", "battlescarred"], min: 0.45, max: 1}
];

const state = {
  currentPage: "accountPage", navDrawerOpen: false, accounts: [], activeAccount: "", accountSelectedUsername: "",
  accountPasswordVisible: false,
  accountLoginMode: "add",
  pendingRelogin: null,
  pendingGuard: null, // {username, password, guard_type, guard_hint} — two-phase login state
  accountLoginBusy: false,
  currentAccountUsername: "", connectedUsername: "", rows: [], mode: "grouped", searchText: "",
  raritySelected: new Set(), collectionSelected: new Set(), collectionValues: [], collectionMenuKey: "", collectionSourceKey: "",
  wearMin: null, wearMax: null, wearSort: "asc", raritySort: "desc", quantitySort: "desc", collectionSort: "asc",
  renderInitialSize: 180, renderBatchSize: 240, renderWindowKey: "", renderVisibleCount: 0, renderVisibleTotal: 0,
  craftSelectedItemIds: new Set(), craftBusy: false, craftPauseRequested: false, craftPaused: false, craftAssistSelecting: false, craftAssistPendingUiAction: "", craftAssistPendingPresetId: "", craftAssistRunToken: "", craftStatusText: "", craftStatusError: false, craftUseComponentItems: false, craftIncludeCooling: false, craftShowSeed: false, craftShowFullWear: false, craftShowCoolingTime: false, craftHideCollection: false, craftHideQuantity: false, craftSettingsOpen: false, craftRecipeQueue: [], craftActiveRecipeId: "", craftCandidateRows: [], craftCandidateStats: null, craftCandidateLoading: false, craftCandidateRequestKey: "", craftCandidateLoadedKey: "", craftCandidateRequestSeq: 0, craftRightPanelWidth: 0,
  craftProgressEnabled: false, craftProgressVisible: false, craftProgressTitle: "", craftProgressDetail: "", craftProgressMode: "", craftProgressPercent: 0, craftProgressPercentTarget: 0,
  craftAssistOpen: false, craftAssistPickerOpen: false, craftAssistPickerTargetMaterialId: "", craftAssistRoleChooserOpen: false, craftAssistPickRole: "main", craftAssistUseAbsoluteWear: false, craftAssistTargetWear: null, craftAssistTargetWearRaw: "", craftAssistWearOffset: DEFAULT_CRAFT_ASSIST_WEAR_OFFSET, craftAssistFastMode: false, craftAssistApproachMode: false, craftAssistMainCount: 5, craftAssistAuxCount: 5, craftAssistOverlayHeight: 0, craftAssistPresetWidth: 0, craftAssistMaterials: [], craftAssistPresets: [], craftAssistPresetApplyCountMap: {}, craftAssistPresetEditingId: "", craftAssistPresetEditingName: "", craftAssistPresetEditingBackup: null, craftAssistPresetEditingInitialSnapshot: null, craftPredictorOpen: false, craftPredictorContextType: "", craftPredictorContextId: "", craftPredictorContextLabel: "", craftPredictorAutoOpenMuted: false, craftPredictorLoading: false, craftPredictorError: "", craftPredictorResponse: null, craftPredictorRequestKey: "", craftPredictorLoadedKey: "", craftPredictorRequestSeq: 0, craftPredictorPreferredRowsContextKey: "", craftPredictorPreferredRowsById: null,
  simulationViewMode: "workspace", simulationOutputRole: "primary_output", simulationMaterialRole: "main_material", simulationOutputChooserOpen: false, simulationMaterialChooserOpen: false, simulationPresets: [], simulationActivePresetId: "", simulationWorkspacePreset: null, simulationWorkspaceSourcePresetId: "", simulationPickerOpen: false, simulationPickerMode: "", simulationPickerTitle: "", simulationPickerQuery: "", simulationPickerResults: [], simulationPickerError: "", simulationLoading: false, simulationPersisting: false, simulationSearchLoading: false, simulationRequestSeq: 0, simulationSearchSeq: 0, simulationModalOpen: false, simulationModalMode: "", simulationModalPresetId: "", simulationModalSlot: "", simulationModalItemType: "", simulationModalItemSnapshot: null,
  expandedGroups: new Set(), selectedComponentId: "", showComponentItems: false, selectedComponentItemIds: new Set(), componentOpBusy: false, componentOpBusyAction: "",
  componentTaskQueue: {running: null, queued: []}, selectedQueueJobId: "", componentTaskProgressMap: {},
  targetDrawerOpen: false, targetComponentChoices: [], targetComponentSelectedId: "", targetComponentExcludeId: "",
  component: {summary_map: {}, item_map: {}}, snapshotPath: "", fetchTime: "", refreshing: false,
  refreshSilentInfo: false,
  snapshotDirty: false, snapshotDirtyReason: "", lastDirtyFallbackTs: 0, dirtyFallbackCooldownMs: 60 * 1000,
  refreshPhaseText: "", lastRefreshClickTs: 0, emptyHint: "请选用一个账号", filterPanel: "wear",
  rowsVersion: 0, filterCacheKey: "", filterCacheAllRows: [], filterCacheFilteredRows: [],
  groupCacheKey: "", groupCacheRows: [], lastPersistedSelected: "",
  profileHydratingUsernames: new Set(), profileHydratedUsernames: new Set(),
  snapshotCacheByAccount: new Map(), craftAccountStateByAccount: new Map(), craftAssistRuntimeByAccount: new Map(), craftAssistActiveRunTokensByAccount: new Map(),
  clientLicense: {
    checked: false,
    authenticated: false,
    code: "license_missing",
    message: "",
    user: null,
    permissions: [],
    membership: [],
    featureFlags: {},
    authMode: "debug_bundle",
    allowManualImport: true,
    authServiceConfigured: false,
    authServiceBaseUrl: "",
    expiresAt: "",
    expiresInMs: 0
  },
  clientAuthView: "bundle",
  clientAuthModalOpen: false,
  clientAuthPromptTitle: "",
  clientAuthPromptHint: "",
  workspaceHydratedFor: "",
  // --- 多账号汰换 ---
  batchCraftAccounts: [],
  batchCraftSelectedPresetId: "",
  batchCraftLimit: 10,
  batchCraftQueue: [],
  batchCraftBusy: false,
  batchCraftStatusText: "",
  batchCraftStatusError: false,
  batchCraftActiveAccount: "",
  batchCraftUseComponentItems: false,
  batchCraftIncludeCooling: false,
  batchCraftFastMode: false,
  batchCraftApproachMode: false,
  batchCraftWearOffset: DEFAULT_CRAFT_ASSIST_WEAR_OFFSET,
  batchCraftSettingsOpen: false,
  batchCraftAccountPickerOpen: false,
  batchCraftPresetWidth: 200
};

const ui = {
  clientAuthModal: document.getElementById("clientAuthModal"), clientAuthModalCloseBtn: document.getElementById("clientAuthModalCloseBtn"), licenseGate: document.getElementById("licenseGate"), licenseTitle: document.getElementById("licenseTitle"), licenseHint: document.getElementById("licenseHint"),
  clientAuthModeTabs: document.getElementById("clientAuthModeTabs"), clientAuthLoginTabBtn: document.getElementById("clientAuthLoginTabBtn"), clientAuthRegisterTabBtn: document.getElementById("clientAuthRegisterTabBtn"), clientAuthResetTabBtn: document.getElementById("clientAuthResetTabBtn"), clientAuthBundleTabBtn: document.getElementById("clientAuthBundleTabBtn"),
  clientLoginPanel: document.getElementById("clientLoginPanel"), clientLoginUsername: document.getElementById("clientLoginUsername"), clientLoginPassword: document.getElementById("clientLoginPassword"), clientLoginSubmitBtn: document.getElementById("clientLoginSubmitBtn"),
  clientRegisterPanel: document.getElementById("clientRegisterPanel"), clientRegisterEmail: document.getElementById("clientRegisterEmail"), clientRegisterCode: document.getElementById("clientRegisterCode"), clientRegisterSendCodeBtn: document.getElementById("clientRegisterSendCodeBtn"), clientRegisterUsername: document.getElementById("clientRegisterUsername"), clientRegisterPassword: document.getElementById("clientRegisterPassword"), clientRegisterSubmitBtn: document.getElementById("clientRegisterSubmitBtn"),
  clientResetPanel: document.getElementById("clientResetPanel"), clientResetEmail: document.getElementById("clientResetEmail"), clientResetCode: document.getElementById("clientResetCode"), clientResetSendCodeBtn: document.getElementById("clientResetSendCodeBtn"), clientResetPassword: document.getElementById("clientResetPassword"), clientResetSubmitBtn: document.getElementById("clientResetSubmitBtn"),
  clientBundlePanel: document.getElementById("clientBundlePanel"),
  licenseBundleInput: document.getElementById("licenseBundleInput"), licenseImportBtn: document.getElementById("licenseImportBtn"), licenseClearBtn: document.getElementById("licenseClearBtn"), licenseStatus: document.getElementById("licenseStatus"),
  licenseClearLocalBtn: document.getElementById("licenseClearLocalBtn"), licenseUserPill: document.getElementById("licenseUserPill"), licenseUserName: document.getElementById("licenseUserName"),
  navShell: document.getElementById("navShell"), navRailTrigger: document.getElementById("navRailTrigger"), mainSidebar: document.getElementById("mainSidebar"),
  navAccount: document.getElementById("navAccount"), navInventory: document.getElementById("navInventory"), navCraft: document.getElementById("navCraft"), navSimulation: document.getElementById("navSimulation"),
  guestWorkspaceNotice: document.getElementById("guestWorkspaceNotice"), guestWorkspaceNoticeText: document.getElementById("guestWorkspaceNoticeText"), guestWorkspaceLoginBtn: document.getElementById("guestWorkspaceLoginBtn"),
  accountPage: document.getElementById("accountPage"), inventoryPage: document.getElementById("inventoryPage"), craftPage: document.getElementById("craftPage"), simulationPage: document.getElementById("simulationPage"),
  accountUsername: document.getElementById("accountUsername"), accountPassword: document.getElementById("accountPassword"), accountTotp: document.getElementById("accountTotp"), accountRemark: document.getElementById("accountRemark"),
  accountPasswordToggle: document.getElementById("accountPasswordToggle"),
  accountLoginModalTitle: document.getElementById("accountLoginModalTitle"), accountLoginHint: document.getElementById("accountLoginHint"),
  loginSaveBtn: document.getElementById("loginSaveBtn"), clearAccountBtn: document.getElementById("clearAccountBtn"), accountStatus: document.getElementById("accountStatus"), savedAccountsWrap: document.getElementById("savedAccountsWrap"),
  accountPageSummaryText: document.getElementById("accountPageSummaryText"), accountPageFetchTimeText: document.getElementById("accountPageFetchTimeText"), accountPageStatusText: document.getElementById("accountPageStatusText"),
  accountPageSelect: document.getElementById("accountPageSelect"), accountPageAddBtn: document.getElementById("accountPageAddBtn"), accountPageRefreshBtn: document.getElementById("accountPageRefreshBtn"), accountPageDisconnectBtn: document.getElementById("accountPageDisconnectBtn"),
  accountLoginModal: document.getElementById("accountLoginModal"), accountLoginModalClose: document.getElementById("accountLoginModalClose"),
  fetchTimeText: document.getElementById("fetchTimeText"), statusText: document.getElementById("statusText"),
  accountSelect: document.getElementById("accountSelect"), refreshBtn: document.getElementById("refreshBtn"), disconnectBtn: document.getElementById("disconnectBtn"), summaryText: document.getElementById("summaryText"),
  craftTopFetchTimeText: document.getElementById("craftTopFetchTimeText"), craftTopStatusText: document.getElementById("craftTopStatusText"),
  craftAccountSelect: document.getElementById("craftAccountSelect"), craftRefreshBtn: document.getElementById("craftRefreshBtn"), craftDisconnectBtn: document.getElementById("craftDisconnectBtn"),
  modeToggleBtn: document.getElementById("modeToggleBtn"), modeToggleGlyph: document.getElementById("modeToggleGlyph"),
  searchInput: document.getElementById("searchInput"), toggleFilterBtn: document.getElementById("toggleFilterBtn"), filterDrawer: document.getElementById("filterDrawer"),
  filterNavWear: document.getElementById("filterNavWear"), filterNavRarity: document.getElementById("filterNavRarity"), filterNavCollection: document.getElementById("filterNavCollection"),
  filterPanelWear: document.getElementById("filterPanelWear"), filterPanelRarity: document.getElementById("filterPanelRarity"), filterPanelCollection: document.getElementById("filterPanelCollection"),
  wearMin: document.getElementById("wearMin"), wearMax: document.getElementById("wearMax"), wearHint: document.getElementById("wearHint"),
  raritySummary: document.getElementById("raritySummary"), rarityMenu: document.getElementById("rarityMenu"), raritySelectAll: document.getElementById("raritySelectAll"), rarityClear: document.getElementById("rarityClear"),
  collectionSummary: document.getElementById("collectionSummary"), collectionMenu: document.getElementById("collectionMenu"), collectionSelectAll: document.getElementById("collectionSelectAll"), collectionClear: document.getElementById("collectionClear"),
  wearSortUp: document.getElementById("wearSortUp"), wearSortDown: document.getElementById("wearSortDown"), raritySortUp: document.getElementById("raritySortUp"), raritySortDown: document.getElementById("raritySortDown"),
  componentPanel: document.getElementById("componentPanel"), componentSelect: document.getElementById("componentSelect"), componentHint: document.getElementById("componentHint"),
  componentAvailableHint: document.getElementById("componentAvailableHint"),
  showComponentItemsWrap: document.getElementById("showComponentItemsWrap"), showComponentItems: document.getElementById("showComponentItems"),
  componentDepositBtn: document.getElementById("componentDepositBtn"), componentWithdrawBtn: document.getElementById("componentWithdrawBtn"),
  componentCraftSettingsBtn: document.getElementById("componentCraftSettingsBtn"), componentCraftSettingsPanel: document.getElementById("componentCraftSettingsPanel"), componentCraftUseComponentItems: document.getElementById("componentCraftUseComponentItems"),
  componentCraftIncludeCooling: document.getElementById("componentCraftIncludeCooling"), componentCraftShowSeed: document.getElementById("componentCraftShowSeed"), componentCraftShowFullWear: document.getElementById("componentCraftShowFullWear"), componentCraftShowCoolingTime: document.getElementById("componentCraftShowCoolingTime"), componentCraftHideCollection: document.getElementById("componentCraftHideCollection"), componentCraftHideQuantity: document.getElementById("componentCraftHideQuantity"),
  componentCraftCoolingHint: document.getElementById("componentCraftCoolingHint"),
  componentTaskFloat: document.getElementById("componentTaskFloat"), componentTaskQueueList: document.getElementById("componentTaskQueueList"),
  componentTaskCancelBtn: document.getElementById("componentTaskCancelBtn"), componentTaskInfo: document.getElementById("componentTaskInfo"),
  targetComponentDrawer: document.getElementById("targetComponentDrawer"), targetComponentDrawerClose: document.getElementById("targetComponentDrawerClose"),
  targetComponentDrawerHint: document.getElementById("targetComponentDrawerHint"), targetComponentDrawerSelect: document.getElementById("targetComponentDrawerSelect"),
  targetComponentDrawerCancel: document.getElementById("targetComponentDrawerCancel"), targetComponentDrawerConfirm: document.getElementById("targetComponentDrawerConfirm"),
  remarkModal: document.getElementById("remarkModal"), remarkModalTitle: document.getElementById("remarkModalTitle"), remarkModalInput: document.getElementById("remarkModalInput"),
  remarkModalClose: document.getElementById("remarkModalClose"), remarkModalSaveBtn: document.getElementById("remarkModalSaveBtn"), remarkModalCancelBtn: document.getElementById("remarkModalCancelBtn"),
  confirmModal: document.getElementById("confirmModal"), confirmModalTitle: document.getElementById("confirmModalTitle"), confirmModalMessage: document.getElementById("confirmModalMessage"),
  confirmModalClose: document.getElementById("confirmModalClose"), confirmModalConfirmBtn: document.getElementById("confirmModalConfirmBtn"), confirmModalCancelBtn: document.getElementById("confirmModalCancelBtn"),
  snapshotPath: document.getElementById("snapshotPath"), listWrap: document.getElementById("listWrap"),
  craftConnectText: document.getElementById("craftConnectText"),
  craftSelectedText: document.getElementById("craftSelectedText"), craftRecipeText: document.getElementById("craftRecipeText"),
  craftStatusText: document.getElementById("craftStatusText"), craftCoolingHint: document.getElementById("craftCoolingHint"), craftSelectionTitle: document.getElementById("craftSelectionTitle"),
  craftLeftPanel: document.getElementById("craftLeftPanel"), craftSelectionList: document.getElementById("craftSelectionList"), craftSettingsBtn: document.getElementById("craftSettingsBtn"),
  craftSettingsPanel: document.getElementById("craftSettingsPanel"), craftUseComponentItems: document.getElementById("craftUseComponentItems"), craftIncludeCooling: document.getElementById("craftIncludeCooling"), craftShowSeed: document.getElementById("craftShowSeed"), craftShowFullWear: document.getElementById("craftShowFullWear"), craftShowCoolingTime: document.getElementById("craftShowCoolingTime"), craftAssistFastMode: document.getElementById("craftAssistFastMode"), craftAssistApproachMode: document.getElementById("craftAssistApproachMode"), craftAssistWearOffsetPct: document.getElementById("craftAssistWearOffsetPct"), craftHideCollection: document.getElementById("craftHideCollection"), craftHideQuantity: document.getElementById("craftHideQuantity"),
  craftAddRecipeBtn: document.getElementById("craftAddRecipeBtn"), craftExecuteQueueBtn: document.getElementById("craftExecuteQueueBtn"),
  craftClearQueueBtn: document.getElementById("craftClearQueueBtn"), craftPreviewViewport: document.getElementById("craftPreviewViewport"), craftQueueList: document.getElementById("craftQueueList"),
  craftAssistToggleBtn: document.getElementById("craftAssistToggleBtn"), craftAssistOverlay: document.getElementById("craftAssistOverlay"),
  craftAssistOverlayHandle: document.getElementById("craftAssistOverlayHandle"), craftAssistPanel: document.getElementById("craftAssistPanel"), craftAssistCloseBtn: document.getElementById("craftAssistCloseBtn"),
  craftAssistPresetNameField: document.getElementById("craftAssistPresetNameField"), craftAssistPresetNameInput: document.getElementById("craftAssistPresetNameInput"),
  craftAssistTargetWear: document.getElementById("craftAssistTargetWear"),
  craftAssistFilterModeRelative: document.getElementById("craftAssistFilterModeRelative"), craftAssistFilterModeAbsolute: document.getElementById("craftAssistFilterModeAbsolute"),
  craftAssistApplyBtn: document.getElementById("craftAssistApplyBtn"),
  craftAssistMainCount: document.getElementById("craftAssistMainCount"), craftAssistAuxCount: document.getElementById("craftAssistAuxCount"),
  craftAssistSelectBox: document.getElementById("craftAssistSelectBox"), craftAssistSelectText: document.getElementById("craftAssistSelectText"), craftAssistContent: document.getElementById("craftAssistContent"), craftAssistSplitBar: document.getElementById("craftAssistSplitBar"),
  craftAssistRoleSplit: document.getElementById("craftAssistRoleSplit"), craftAssistPicker: document.getElementById("craftAssistPicker"), craftAssistList: document.getElementById("craftAssistList"),
  craftAssistBusyMask: document.getElementById("craftAssistBusyMask"), craftAssistBusyMaskTitle: document.getElementById("craftAssistBusyMaskTitle"), craftAssistBusyMaskDetail: document.getElementById("craftAssistBusyMaskDetail"),
  craftAssistPresetPanel: document.getElementById("craftAssistPresetPanel"), craftAssistPresetSaveBtn: document.getElementById("craftAssistPresetSaveBtn"), craftAssistPresetList: document.getElementById("craftAssistPresetList"),
  craftPredictorPanel: document.getElementById("craftPredictorPanel"), craftPredictorHandle: document.getElementById("craftPredictorHandle"), craftPredictorDrawer: document.getElementById("craftPredictorDrawer"), craftPredictorTitle: document.getElementById("craftPredictorTitle"), craftPredictorSubtitle: document.getElementById("craftPredictorSubtitle"), craftPredictorCloseBtn: document.getElementById("craftPredictorCloseBtn"), craftPredictorList: document.getElementById("craftPredictorList"),
  craftAssistPresetModal: document.getElementById("craftAssistPresetModal"), craftAssistPresetModalTitle: document.getElementById("craftAssistPresetModalTitle"), craftAssistPresetModalInput: document.getElementById("craftAssistPresetModalInput"),
  craftAssistPresetModalClose: document.getElementById("craftAssistPresetModalClose"), craftAssistPresetModalSaveBtn: document.getElementById("craftAssistPresetModalSaveBtn"), craftAssistPresetModalCancelBtn: document.getElementById("craftAssistPresetModalCancelBtn"),
  craftLayout: document.getElementById("craftLayout"), craftSplitBar: document.getElementById("craftSplitBar"), craftRightPanel: document.getElementById("craftRightPanel"),
  craftExecutionOverlay: document.getElementById("craftExecutionOverlay"), craftExecutionProgress: document.getElementById("craftExecutionProgress"), craftExecutionOverlayPercent: document.getElementById("craftExecutionOverlayPercent"), craftExecutionOverlayTitle: document.getElementById("craftExecutionOverlayTitle"), craftExecutionOverlayDetail: document.getElementById("craftExecutionOverlayDetail"),
  simulationModeSavedBtn: document.getElementById("simulationModeSavedBtn"), simulationModeWorkspaceBtn: document.getElementById("simulationModeWorkspaceBtn"), simulationSavedPresets: document.getElementById("simulationSavedPresets"), simulationWorkspace: document.getElementById("simulationWorkspace"), simulationWorkspaceActionsBar: document.getElementById("simulationWorkspaceActionsBar"), simulationSavePresetBtn: document.getElementById("simulationSavePresetBtn"), simulationCancelEditBtn: document.getElementById("simulationCancelEditBtn"), simulationLayout: document.getElementById("simulationLayout"), simulationOutputPanel: document.getElementById("simulationOutputPanel"), simulationMaterialPanel: document.getElementById("simulationMaterialPanel"), simulationOutputRoleChooser: document.getElementById("simulationOutputRoleChooser"), simulationOutputRoleChooserText: document.getElementById("simulationOutputRoleChooserText"), simulationOutputRoleSplit: document.getElementById("simulationOutputRoleSplit"), simulationMaterialRoleChooser: document.getElementById("simulationMaterialRoleChooser"), simulationMaterialRoleChooserText: document.getElementById("simulationMaterialRoleChooserText"), simulationMaterialRoleSplit: document.getElementById("simulationMaterialRoleSplit"), simulationOutputLane: document.getElementById("simulationOutputLane"), simulationMaterialLane: document.getElementById("simulationMaterialLane"), simulationPickerModal: document.getElementById("simulationPickerModal"), simulationPickerTitle: document.getElementById("simulationPickerTitle"), simulationPickerRoleBadge: document.getElementById("simulationPickerRoleBadge"), simulationPickerHint: document.getElementById("simulationPickerHint"), simulationPickerMeta: document.getElementById("simulationPickerMeta"), simulationPickerSearchInput: document.getElementById("simulationPickerSearchInput"), simulationPickerSearchBtn: document.getElementById("simulationPickerSearchBtn"), simulationPickerSearchResults: document.getElementById("simulationPickerSearchResults"), simulationPickerClose: document.getElementById("simulationPickerClose"), simulationPickerCancelBtn: document.getElementById("simulationPickerCancelBtn"), simulationCardModal: document.getElementById("simulationCardModal"), simulationCardModalTitle: document.getElementById("simulationCardModalTitle"), simulationCardModalBody: document.getElementById("simulationCardModalBody"), simulationCardModalField: document.getElementById("simulationCardModalField"), simulationCardModalWearInput: document.getElementById("simulationCardModalWearInput"), simulationCardModalWearHint: document.getElementById("simulationCardModalWearHint"), simulationCardModalReadonlyNote: document.getElementById("simulationCardModalReadonlyNote"), simulationCardModalClose: document.getElementById("simulationCardModalClose"), simulationCardModalSaveBtn: document.getElementById("simulationCardModalSaveBtn"), simulationCardModalCancelBtn: document.getElementById("simulationCardModalCancelBtn"),
  simExportCraftModal: document.getElementById("simExportCraftModal"), simExportCraftModalTitle: document.getElementById("simExportCraftModalTitle"), simExportCraftModalClose: document.getElementById("simExportCraftModalClose"), simExportCraftMaterialList: document.getElementById("simExportCraftMaterialList"), simExportCraftAddBtn: document.getElementById("simExportCraftAddBtn"), simExportCraftSearchPanel: document.getElementById("simExportCraftSearchPanel"), simExportCraftSearchInput: document.getElementById("simExportCraftSearchInput"), simExportCraftSearchBtn: document.getElementById("simExportCraftSearchBtn"), simExportCraftSearchResults: document.getElementById("simExportCraftSearchResults"), simExportCraftName: document.getElementById("simExportCraftName"), simExportCraftTargetWear: document.getElementById("simExportCraftTargetWear"), simExportCraftMainCount: document.getElementById("simExportCraftMainCount"), simExportCraftAuxCount: document.getElementById("simExportCraftAuxCount"), simExportCraftAuxCountRow: document.getElementById("simExportCraftAuxCountRow"), simExportCraftWearMin: document.getElementById("simExportCraftWearMin"), simExportCraftWearMax: document.getElementById("simExportCraftWearMax"), simExportCraftConfirmBtn: document.getElementById("simExportCraftConfirmBtn"), simExportCraftCancelBtn: document.getElementById("simExportCraftCancelBtn"),
  batchCraftPage: document.getElementById("batchCraftPage"), navBatchCraft: document.getElementById("navBatchCraft"), batchCraftStatusText: document.getElementById("batchCraftStatusText"),
  batchCraftAddAccountBtn: document.getElementById("batchCraftAddAccountBtn"), batchCraftAccountPicker: document.getElementById("batchCraftAccountPicker"), batchCraftAccountListbox: document.getElementById("batchCraftAccountListbox"), batchCraftClearAccountsBtn: document.getElementById("batchCraftClearAccountsBtn"),
  batchCraftActiveAccountText: document.getElementById("batchCraftActiveAccountText"), batchCraftAccountCards: document.getElementById("batchCraftAccountCards"),
  batchCraftPresetPanel: document.getElementById("batchCraftPresetPanel"), batchCraftPresetList: document.getElementById("batchCraftPresetList"), batchCraftLimitInput: document.getElementById("batchCraftLimitInput"),
  batchCraftRunSelectBtn: document.getElementById("batchCraftRunSelectBtn"), batchCraftExecuteBtn: document.getElementById("batchCraftExecuteBtn"),
  batchCraftSettingsBtn: document.getElementById("batchCraftSettingsBtn"), batchCraftSettingsPanel: document.getElementById("batchCraftSettingsPanel"),
  batchCraftUseComponentItems: document.getElementById("batchCraftUseComponentItems"), batchCraftIncludeCooling: document.getElementById("batchCraftIncludeCooling"),
  batchCraftFastMode: document.getElementById("batchCraftFastMode"), batchCraftApproachMode: document.getElementById("batchCraftApproachMode"), batchCraftWearOffsetPct: document.getElementById("batchCraftWearOffsetPct"),
  batchCraftSplitBar: document.getElementById("batchCraftSplitBar"),
  batchCraftQueuePanel: document.getElementById("batchCraftQueuePanel"), batchCraftQueueTitle: document.getElementById("batchCraftQueueTitle"), batchCraftQueueList: document.getElementById("batchCraftQueueList"), batchCraftClearQueueBtn: document.getElementById("batchCraftClearQueueBtn"),
  batchCraftOverlay: document.getElementById("batchCraftOverlay"), batchCraftOverlayTitle: document.getElementById("batchCraftOverlayTitle"), batchCraftOverlayDetail: document.getElementById("batchCraftOverlayDetail"), batchCraftOverlayProgressBar: document.getElementById("batchCraftOverlayProgressBar"),
  // ═══ Web 库存管理页 ═══
  webInventoryPage: document.getElementById("webInventoryPage"), navWebInventory: document.getElementById("navWebInventory"),
  webInvAccountPanel: document.getElementById("webInvAccountPanel"), webInvAccountList: document.getElementById("webInvAccountList"),
  webInvBatchBanCheck: document.getElementById("webInvBatchBanCheck"), webInvBatchTradeUrl: document.getElementById("webInvBatchTradeUrl"),
  webInvSplitBar: document.getElementById("webInvSplitBar"), webInvMain: document.getElementById("webInvMain"),
  webInvAccountInfo: document.getElementById("webInvAccountInfo"), webInvAccName: document.getElementById("webInvAccName"), webInvAccBalance: document.getElementById("webInvAccBalance"), webInvAccBanStatus: document.getElementById("webInvAccBanStatus"), webInvAccTradeUrl: document.getElementById("webInvAccTradeUrl"), webInvBalanceBtn: document.getElementById("webInvBalanceBtn"),
  webInvFetchBtn: document.getElementById("webInvFetchBtn"), webInvTradableOnly: document.getElementById("webInvTradableOnly"), webInvSelectAll: document.getElementById("webInvSelectAll"), webInvSelectedCount: document.getElementById("webInvSelectedCount"),
  webInvItemGrid: document.getElementById("webInvItemGrid"),
  webInvActionBar: document.getElementById("webInvActionBar"), webInvActionCount: document.getElementById("webInvActionCount"), webInvTransferBtn: document.getElementById("webInvTransferBtn"), webInvSellBtn: document.getElementById("webInvSellBtn"),
  // ═══ 市场上架弹窗 ═══
  marketSellModal: document.getElementById("marketSellModal"), marketSellCloseBtn: document.getElementById("marketSellCloseBtn"),
  marketSellPricePct: document.getElementById("marketSellPricePct"), marketSellApplyPctBtn: document.getElementById("marketSellApplyPctBtn"), marketSellFetchPricesBtn: document.getElementById("marketSellFetchPricesBtn"),
  marketSellItemList: document.getElementById("marketSellItemList"), marketSellProgress: document.getElementById("marketSellProgress"), marketSellProgressFill: document.getElementById("marketSellProgressFill"), marketSellProgressText: document.getElementById("marketSellProgressText"),
  marketSellSummary: document.getElementById("marketSellSummary"), marketSellStartBtn: document.getElementById("marketSellStartBtn"),
  // ═══ 市场上架确认弹窗 ═══
  marketConfirmModal: document.getElementById("marketConfirmModal"), marketConfirmCloseBtn: document.getElementById("marketConfirmCloseBtn"),
  marketConfirmRefreshBtn: document.getElementById("marketConfirmRefreshBtn"), marketConfirmSelectAll: document.getElementById("marketConfirmSelectAll"),
  marketConfirmCount: document.getElementById("marketConfirmCount"), marketConfirmItemList: document.getElementById("marketConfirmItemList"),
  marketConfirmProgress: document.getElementById("marketConfirmProgress"), marketConfirmProgressFill: document.getElementById("marketConfirmProgressFill"), marketConfirmProgressText: document.getElementById("marketConfirmProgressText"),
  marketConfirmSummary: document.getElementById("marketConfirmSummary"), marketConfirmStartBtn: document.getElementById("marketConfirmStartBtn"),
  // ═══ Steam API Key 弹窗 ═══
  steamApiKeyModal: document.getElementById("steamApiKeyModal"), steamApiKeyCloseBtn: document.getElementById("steamApiKeyCloseBtn"), steamApiKeyInput: document.getElementById("steamApiKeyInput"), steamApiKeySaveBtn: document.getElementById("steamApiKeySaveBtn")
};

const authSessionStore = typeof window !== "undefined" ? (window.cs2AlchemyAuthSessionStore || null) : null;
const authUiController = typeof window !== "undefined" ? (window.cs2AlchemyAuthUiController || null) : null;
const guestPreviewProvider = typeof window !== "undefined" ? (window.guestPreviewProvider || null) : null;
const workspaceAccessGuard = (
  typeof window !== "undefined"
  && typeof window.createWorkspaceAccessGuard === "function"
) ? window.createWorkspaceAccessGuard({
  getMode: () => {
    if (authSessionStore && typeof authSessionStore.getSnapshot === "function") {
      return String(authSessionStore.getSnapshot().mode || "").trim() || "booting";
    }
    return state.clientLicense && state.clientLicense.authenticated ? "authenticated" : "guest";
  },
  onUnauthorized: ({reason = "", view = "login"} = {}) => {
    openClientAuthModal({
      title: "登录后可用当前功能",
      hint: String(reason || "").trim() || "当前为访客预览态，登录后可继续刚才的操作。",
      view
    });
  }
}) : null;

let searchTimer = null;
let inventoryEventSource = null;
let inventoryEventUsername = "";
let remarkModalResolver = null;
let remarkModalAccount = "";
let confirmModalResolver = null;
let craftAssistPresetModalResolver = null;
let craftAssistPresetModalOptions = null;
let simExportCraftResolver = null;
let simExportCraftMaterials = [];
let simExportCraftSearchResults = [];
let simExportCraftSearchLoading = false;
let simExportCraftSearchSeq = 0;
let targetDrawerDrag = {active: false, offsetX: 0, offsetY: 0};
let craftSplitDrag = {active: false, startX: 0, startWidth: 360};
let craftAssistOverlayDrag = {active: false, startY: 0, startHeight: 0};
let craftAssistSplitDrag = {active: false, startX: 0, startWidth: 0};
let lazyLoadTickPending = false;
let lazyLoadAutoFillPending = false;
let craftAssistPickerCloseTimer = null;
let craftAssistPresetDraggingId = "";
let errorToastNode = null;
let errorToastTextNode = null;
let errorToastHideTimer = null;
let lastErrorToastText = "";
let lastErrorToastTs = 0;
const CRAFT_UI_PREFS_KEY = "craft_ui_prefs_v2";
const BATCH_CRAFT_UI_PREFS_KEY = "batch_craft_ui_prefs_v1";
const CRAFT_ASSIST_PRESETS_KEY = "craft_assist_presets_v1";
const TRADEUP_SIMULATION_PRESETS_KEY = "tradeup_simulation_presets_v1";
const ERROR_TOAST_DURATION_MS = 2800;

async function api(path, options = {}) {
  const requestOptions = options && typeof options === "object" ? {...options} : {};
  const timeoutMs = Math.max(0, Number(requestOptions.timeoutMs) || 0);
  const timeoutMessage = String(requestOptions.timeoutMessage || "").trim();
  const suppressAuthFailure = !!requestOptions.suppressAuthFailure;
  const requestHeaders = requestOptions.headers && typeof requestOptions.headers === "object"
    ? {...requestOptions.headers}
    : {};
  const externalSignal = requestOptions.signal || null;
  delete requestOptions.timeoutMs;
  delete requestOptions.timeoutMessage;
  delete requestOptions.suppressAuthFailure;
  delete requestOptions.headers;
  delete requestOptions.signal;

  let timer = null;
  let abortController = null;
  let detachExternalAbort = null;
  let fetchSignal = externalSignal || undefined;
  if (timeoutMs > 0) {
    abortController = new AbortController();
    if (externalSignal && typeof externalSignal.addEventListener === "function") {
      const forwardAbort = () => abortController.abort();
      if (externalSignal.aborted) {
        abortController.abort();
      } else {
        externalSignal.addEventListener("abort", forwardAbort, {once: true});
        detachExternalAbort = () => {
          if (typeof externalSignal.removeEventListener === "function") {
            externalSignal.removeEventListener("abort", forwardAbort);
          }
        };
      }
    }
    timer = setTimeout(() => abortController.abort(), timeoutMs);
    fetchSignal = abortController.signal;
  }

  try {
    const r = await fetch(path, {
      headers: {"Content-Type": "application/json", ...requestHeaders},
      ...requestOptions,
      ...(fetchSignal ? {signal: fetchSignal} : {})
    });
    const d = await r.json();
    if (!r.ok || d.ok === false) {
      const err = new Error(d.message || `http ${r.status}`);
      err.status = r.status;
      err.data = d;
      if (
        !suppressAuthFailure &&
        typeof window !== "undefined" &&
        typeof window.__cs2AlchemyHandleApiLicenseFailure === "function" &&
        Number(r.status) === 401
      ) {
        const reason = String(d && d.reason || "").trim();
        if (reason === "license_required" || reason === "license_expired" || reason === "license_invalid") {
          window.__cs2AlchemyHandleApiLicenseFailure(err);
        }
      }
      throw err;
    }
    return d;
  } catch (err) {
    const message = String(err && err.message ? err.message : err || "").trim();
    const name = String(err && err.name ? err.name : "").trim();
    const isAbort = /abort/i.test(name) || /abort|timeout/i.test(message);
    if (timeoutMs > 0 && abortController && abortController.signal && abortController.signal.aborted && isAbort) {
      throw new Error(timeoutMessage || `请求超时(${timeoutMs}ms)`);
    }
    throw err;
  } finally {
    if (timer != null) clearTimeout(timer);
    if (typeof detachExternalAbort === "function") detachExternalAbort();
  }
}

async function requestLicenseJson(path, options = {}) {
  const requestOptions = options && typeof options === "object" ? {...options} : {};
  const requestHeaders = requestOptions.headers && typeof requestOptions.headers === "object"
    ? {...requestOptions.headers}
    : {};
  delete requestOptions.headers;
  const response = await fetch(path, {
    headers: {"Content-Type": "application/json", ...requestHeaders},
    ...requestOptions
  });
  const data = await response.json();
  return {
    ok: response.ok && data.ok !== false,
    status: response.status,
    data
  };
}

function setLicenseStatus(text, isError = false) {
  if (!ui.licenseStatus) return;
  ui.licenseStatus.textContent = String(text || "").trim();
  ui.licenseStatus.classList.toggle("error", !!isError);
}

function getClientAuthMode() {
  const mode = String(state.clientLicense && state.clientLicense.authMode || "").trim();
  if (mode === "prod_login") return "prod_login";
  if (mode === "dev_auto_bundle") return "dev_auto_bundle";
  return "debug_bundle";
}

function isManualImportAllowed() {
  return !!(state.clientLicense && state.clientLicense.allowManualImport);
}

function isRemoteClientAuthConfigured() {
  return !!(state.clientLicense && state.clientLicense.authServiceConfigured);
}

function getRemoteClientAuthDisabled() {
  return getClientAuthMode() === "prod_login" && !isRemoteClientAuthConfigured();
}

function resolveDefaultClientAuthView() {
  return getClientAuthMode() === "prod_login" ? "login" : "bundle";
}

function getAvailableClientAuthViews() {
  const views = [];
  if (getClientAuthMode() === "prod_login") {
    views.push("login", "register", "reset");
  }
  if (isManualImportAllowed()) {
    views.push("bundle");
  }
  if (!views.length) {
    views.push(resolveDefaultClientAuthView());
  }
  return views;
}

function resolveClientAuthView() {
  const current = String(state.clientAuthView || "").trim();
  const availableViews = getAvailableClientAuthViews();
  return availableViews.includes(current) ? current : availableViews[0];
}

function setButtonBusy(button, busy) {
  if (!button) return;
  if (busy) {
    button.dataset.busy = "true";
    button.disabled = true;
    return;
  }
  delete button.dataset.busy;
  if (button === ui.licenseImportBtn) {
    button.disabled = !isManualImportAllowed();
    return;
  }
  button.disabled = getRemoteClientAuthDisabled();
}

function syncClientAuthControlStates() {
  setButtonBusy(ui.clientLoginSubmitBtn, false);
  setButtonBusy(ui.clientRegisterSendCodeBtn, false);
  setButtonBusy(ui.clientRegisterSubmitBtn, false);
  setButtonBusy(ui.clientResetSendCodeBtn, false);
  setButtonBusy(ui.clientResetSubmitBtn, false);
  setButtonBusy(ui.licenseImportBtn, false);
}

function isGuestWorkspaceActive() {
  return !(state.clientLicense && state.clientLicense.authenticated);
}

function syncAuthSessionStoreFromLicense() {
  if (!authSessionStore) return;
  if (typeof authSessionStore.setFromClientAuthState === "function") {
    authSessionStore.setFromClientAuthState({
      authenticated: !!(state.clientLicense && state.clientLicense.authenticated),
      code: String(state.clientLicense && state.clientLicense.code || "").trim(),
      expires_at: String(state.clientLicense && state.clientLicense.expiresAt || "").trim(),
      user: state.clientLicense && state.clientLicense.user ? deepCopyPlain(state.clientLicense.user) : null,
      auth_provider: getClientAuthMode() === "prod_login" ? "remote" : "bundle"
    });
    return;
  }
  if (state.clientLicense && state.clientLicense.authenticated && typeof authSessionStore.setAuthenticated === "function") {
    authSessionStore.setAuthenticated({
      authenticated: true,
      expires_at: String(state.clientLicense.expiresAt || "").trim(),
      user: state.clientLicense.user ? deepCopyPlain(state.clientLicense.user) : null,
      auth_provider: getClientAuthMode() === "prod_login" ? "remote" : "bundle"
    });
    return;
  }
  if (typeof authSessionStore.setGuest === "function") {
    authSessionStore.setGuest(String(state.clientLicense && state.clientLicense.code || "").trim());
  }
}

function getGuestWorkspaceNoticeMessage() {
  const code = String(state.clientLicense && state.clientLicense.code || "").trim();
  if (code === "license_expired") {
    return "当前授权已失效，已回落到访客预览态；登录后可继续使用真实功能。";
  }
  if (code === "license_invalid") {
    return "当前授权不可用，已切换到访客预览态；登录后可继续使用真实功能。";
  }
  return "当前为访客预览态，可先浏览页面结构，受限功能需登录后使用。";
}

function renderGuestWorkspaceNotice() {
  const visible = isGuestWorkspaceActive();
  const text = getGuestWorkspaceNoticeMessage();
  if (authUiController && typeof authUiController.setGuestNoticeVisible === "function") {
    authUiController.setGuestNoticeVisible(visible, text);
  } else {
    if (ui.guestWorkspaceNotice) {
      ui.guestWorkspaceNotice.classList.toggle("hidden", !visible);
    }
    if (ui.guestWorkspaceNoticeText) {
      ui.guestWorkspaceNoticeText.textContent = text;
    }
  }
}

function openClientAuthModal({title = "", hint = "", view = ""} = {}) {
  state.clientAuthModalOpen = true;
  state.clientAuthPromptTitle = String(title || "").trim();
  state.clientAuthPromptHint = String(hint || "").trim();
  if (view) {
    state.clientAuthView = String(view || "").trim();
  }
  renderLicenseGate();
}

function closeClientAuthModal() {
  state.clientAuthModalOpen = false;
  state.clientAuthPromptTitle = "";
  state.clientAuthPromptHint = "";
  renderLicenseGate();
}

function guardGuestAction({reason = "", view = "login", run = null} = {}) {
  if (!isGuestWorkspaceActive()) {
    if (typeof run === "function") {
      return run();
    }
    return true;
  }
  if (typeof workspaceAccessGuard === "undefined" && typeof authUiController === "undefined") {
    if (typeof run === "function") {
      return run();
    }
    return true;
  }
  if (typeof workspaceAccessGuard !== "undefined" && workspaceAccessGuard && typeof workspaceAccessGuard.requireAuth === "function") {
    workspaceAccessGuard.requireAuth({reason, view});
  } else {
    openClientAuthModal({
      title: "登录后可用当前功能",
      hint: String(reason || "").trim() || "当前为访客预览态，登录后可继续刚才的操作。",
      view
    });
  }
  return false;
}

function applyGuestWorkspacePreview({reason = ""} = {}) {
  if (!guestPreviewProvider) return false;
  const inventoryPreview = typeof guestPreviewProvider.getGuestInventoryPreview === "function"
    ? guestPreviewProvider.getGuestInventoryPreview()
    : null;
  const craftPreview = typeof guestPreviewProvider.getGuestCraftPreview === "function"
    ? guestPreviewProvider.getGuestCraftPreview()
    : null;
  const simulationPreview = typeof guestPreviewProvider.getGuestSimulationPreview === "function"
    ? guestPreviewProvider.getGuestSimulationPreview()
    : null;
  if (!inventoryPreview || !craftPreview || !simulationPreview) return false;

  state.workspaceHydratedFor = "";
  state.accounts = [];
  state.activeAccount = "";
  state.accountSelectedUsername = "";
  state.currentAccountUsername = "";
  state.connectedUsername = "";
  state.selectedComponentItemIds.clear();
  if (state.snapshotCacheByAccount instanceof Map) state.snapshotCacheByAccount.clear();
  if (state.craftAccountStateByAccount instanceof Map) state.craftAccountStateByAccount.clear();
  if (state.craftAssistRuntimeByAccount instanceof Map) state.craftAssistRuntimeByAccount.clear();
  if (state.craftAssistActiveRunTokensByAccount instanceof Map) state.craftAssistActiveRunTokensByAccount.clear();
  state.profileHydratingUsernames.clear();
  state.profileHydratedUsernames.clear();
  state.componentTaskQueue = {running: null, queued: []};
  state.selectedQueueJobId = "";
  state.targetDrawerOpen = false;
  state.targetComponentChoices = [];
  state.targetComponentSelectedId = "";
  state.targetComponentExcludeId = "";
  setAccountForm({username: "", password: "", totp: "", remark: ""});
  setNoAccountState({silentSummary: true});
  setRows(
    deepCopyPlain(Array.isArray(inventoryPreview.rows) ? inventoryPreview.rows : []),
    deepCopyPlain(inventoryPreview.component || {summary_map: {}, item_map: {}}),
    String(inventoryPreview.snapshotPath || "").trim()
  );
  state.fetchTime = "";
  state.craftCandidateRows = deepCopyPlain(Array.isArray(craftPreview.candidateRows) ? craftPreview.candidateRows : []);
  state.craftCandidateStats = deepCopyPlain(craftPreview.candidateStats || null);
  state.craftCandidateLoading = false;
  state.craftCandidateRequestKey = "";
  state.craftCandidateLoadedKey = "guest_preview";
  state.craftRecipeQueue = deepCopyPlain(Array.isArray(craftPreview.recipeQueue) ? craftPreview.recipeQueue : []);
  state.craftActiveRecipeId = String(craftPreview.activeRecipeId || "").trim();
  state.craftPredictorResponse = deepCopyPlain(craftPreview.predictor || null);
  state.craftPredictorError = "";
  state.craftPredictorLoading = false;
  state.craftSelectedItemIds.clear();
  state.craftAssistOpen = false;
  state.craftAssistPickerOpen = false;
  state.craftAssistPickerTargetMaterialId = "";
  state.craftAssistRoleChooserOpen = false;
  state.craftAssistMaterials = [];
  state.craftAssistPresets = [];
  state.craftAssistPresetApplyCountMap = {};
  state.craftAssistPresetEditingId = "";
  state.craftAssistPresetEditingName = "";
  state.craftAssistPresetEditingBackup = null;
  state.craftAssistPresetEditingInitialSnapshot = null;
  state.craftAssistPendingUiAction = "";
  state.craftAssistPendingPresetId = "";
  state.craftAssistRunToken = "";
  state.simulationPresets = deepCopyPlain(Array.isArray(simulationPreview.savedPresets) ? simulationPreview.savedPresets : []);
  state.simulationActivePresetId = String(
    (simulationPreview.savedPresets && simulationPreview.savedPresets[0] && simulationPreview.savedPresets[0].id) || ""
  ).trim();
  state.simulationWorkspacePreset = deepCopyPlain(simulationPreview.workspacePreset || null);
  state.simulationWorkspaceSourcePresetId = state.simulationActivePresetId;
  state.simulationPickerOpen = false;
  state.simulationModalOpen = false;
  clearCraftExecutionOverlayState();
  closeTargetComponentDrawer();
  renderTaskQueueControls();
  syncInventoryAccountSelect();
  syncInventoryTop();
  renderSavedAccounts();
  renderCraftPage();
  renderSimulationPage();
  renderGuestWorkspaceNotice();
  setAccountStatus("登录后可保存 Steam 账号并绑定到当前客户端身份。");
  setSummary(String(reason || inventoryPreview.summary || "").trim());
  return true;
}

function setClientAuthView(view) {
  state.clientAuthView = String(view || "").trim() || resolveDefaultClientAuthView();
  renderLicenseGate();
}

function applyClientLicenseState(data) {
  const payload = data && typeof data === "object" ? data : {};
  state.clientLicense = {
    checked: true,
    authenticated: !!payload.authenticated,
    code: String(payload.code || "").trim() || "license_missing",
    message: String(payload.message || "").trim(),
    user: payload.user && typeof payload.user === "object" ? payload.user : null,
    permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
    membership: Array.isArray(payload.membership) ? payload.membership : [],
    featureFlags: payload.feature_flags && typeof payload.feature_flags === "object" ? payload.feature_flags : {},
    authMode: (function () {
      const mode = String(payload.auth_mode || "").trim();
      if (mode === "prod_login") return "prod_login";
      if (mode === "dev_auto_bundle") return "dev_auto_bundle";
      return "debug_bundle";
    })(),
    allowManualImport: !!payload.allow_manual_import,
    authServiceConfigured: !!payload.auth_service_configured,
    authServiceBaseUrl: String(payload.auth_service_base_url || "").trim(),
    expiresAt: String(payload.expires_at || "").trim(),
    expiresInMs: Number(payload.expires_in_ms) || 0
  };
  state.clientAuthView = resolveClientAuthView();
  syncAuthSessionStoreFromLicense();
}

function buildClientMembershipHintText(license = state.clientLicense) {
  const user = license && license.user && typeof license.user === "object" ? license.user : null;
  const featureFlags = license && license.featureFlags && typeof license.featureFlags === "object" ? license.featureFlags : {};
  const membershipPlan = String(user && user.membership_plan || "").trim();
  const trialActive = !!featureFlags.trial_active;
  const trialExpiresAt = String(featureFlags.trial_expires_at || "").trim();
  const remainingDays = (() => {
    const expiresAtMs = Date.parse(trialExpiresAt);
    if (!trialActive || !Number.isFinite(expiresAtMs)) {
      return 0;
    }
    return Math.max(0, Math.ceil((expiresAtMs - Date.now()) / (24 * 60 * 60 * 1000)));
  })();
  if (membershipPlan === "trial" && trialActive) {
    return `新用户体验中，还可使用 ${remainingDays} 天普通版权限；当前最多绑定 1 个 Steam 账号；体验期内可使用炼金，到期后将失效。`;
  }
  if (membershipPlan === "inactive" || featureFlags.craft_enabled === false) {
    return "体验已到期，请开通会员后继续使用炼金功能；删除本地账号不等于换绑，既有 Steam 绑定资格仍会保留。";
  }
  if (membershipPlan === "member") {
    return "当前版本支持绑定无限个 Steam 账号，已开通后可持续使用炼金功能。";
  }
  if (membershipPlan === "standard") {
    return "当前版本仅支持绑定 1 个 Steam 账号，已开通后可使用炼金功能。";
  }
  return "";
}

function renderLicenseGate() {
  const license = state.clientLicense || {};
  const authenticated = !!license.authenticated;
  const readyForWorkspace = authenticated && !!state.workspaceHydratedFor;
  const expired = String(license.code || "").trim() === "license_expired";
  const authMode = getClientAuthMode();
  const allowManualImport = isManualImportAllowed();
  const remoteAuthDisabled = getRemoteClientAuthDisabled();
  const clientAuthView = resolveClientAuthView();
  const showRemotePanels = authMode === "prod_login";
  const showModeTabs = showRemotePanels;
  const modalOpen = !!state.clientAuthModalOpen;
  state.clientAuthView = clientAuthView;
  if (authUiController && typeof authUiController.setModalOpen === "function") {
    authUiController.setModalOpen(modalOpen);
  } else if (ui.clientAuthModal) {
    ui.clientAuthModal.classList.toggle("hidden", !modalOpen);
  }
  if (ui.clientAuthModalCloseBtn) {
    ui.clientAuthModalCloseBtn.classList.toggle("hidden", !modalOpen);
  }
  if (ui.licenseGate) {
    ui.licenseGate.classList.toggle("hidden", !modalOpen);
  }
  if (ui.licenseUserPill) {
    ui.licenseUserPill.classList.toggle("hidden", !readyForWorkspace);
  }
  if (ui.licenseUserName) {
    const user = license.user && typeof license.user === "object" ? license.user : null;
    ui.licenseUserName.textContent = user ? (String(user.username || "").trim()) : "";
  }
  let licenseTitleText = "客户端授权";
  if (readyForWorkspace) {
    licenseTitleText = "客户端授权就绪";
  } else if (authenticated) {
    licenseTitleText = "正在载入工作台";
  } else if (authMode === "prod_login") {
    licenseTitleText = expired ? "登录已过期" : "账号登录";
  } else if (authMode === "dev_auto_bundle") {
    licenseTitleText = expired ? "开发授权已过期" : "开发直通授权";
  } else {
    licenseTitleText = expired ? "授权已过期" : "客户端授权";
  }
  if (modalOpen && String(state.clientAuthPromptTitle || "").trim()) {
    licenseTitleText = String(state.clientAuthPromptTitle || "").trim();
  }
  if (ui.licenseTitle) {
    ui.licenseTitle.textContent = licenseTitleText;
  }
  let licenseHintText = "";
  const membershipHintText = buildClientMembershipHintText(license);
  if (readyForWorkspace) {
    licenseHintText = `当前授权已生效${license.expiresAt ? `，到期时间：${license.expiresAt}` : ""}。${membershipHintText ? ` ${membershipHintText}` : ""}`;
  } else if (authenticated) {
    licenseHintText = membershipHintText
      ? `${membershipHintText} 正在初始化本地工作台，请稍候。`
      : "授权已验证，正在初始化本地工作台，请稍候。";
  } else if (authMode === "prod_login") {
    licenseHintText = remoteAuthDisabled
      ? "正式登录模式已启用，但远程认证服务尚未配置。"
      : "登录入口为用户名和密码，邮箱仅用于注册验证与重置密码。";
  } else if (authMode === "dev_auto_bundle") {
    licenseHintText = expired
      ? "开发直通模式下的本地调试授权已过期，请重启客户端或检查本地私钥配置。"
      : "开发直通模式已启用，客户端会在启动时自动注入本地调试授权。";
  } else {
    licenseHintText = expired
      ? "当前授权已过期，请导入新的签名授权包。"
      : "请导入有效的签名授权包后继续。";
  }
  if (modalOpen && String(state.clientAuthPromptHint || "").trim()) {
    licenseHintText = String(state.clientAuthPromptHint || "").trim();
  }
  if (ui.licenseHint) {
    ui.licenseHint.textContent = licenseHintText;
  }
  if (ui.clientAuthModeTabs) {
    ui.clientAuthModeTabs.classList.toggle("hidden", !showModeTabs);
  }
  if (ui.clientAuthLoginTabBtn) {
    ui.clientAuthLoginTabBtn.classList.toggle("hidden", !showRemotePanels);
    ui.clientAuthLoginTabBtn.classList.toggle("active", clientAuthView === "login");
  }
  if (ui.clientAuthRegisterTabBtn) {
    ui.clientAuthRegisterTabBtn.classList.toggle("hidden", !showRemotePanels);
    ui.clientAuthRegisterTabBtn.classList.toggle("active", clientAuthView === "register");
  }
  if (ui.clientAuthResetTabBtn) {
    ui.clientAuthResetTabBtn.classList.toggle("hidden", !showRemotePanels);
    ui.clientAuthResetTabBtn.classList.toggle("active", clientAuthView === "reset");
  }
  if (ui.clientAuthBundleTabBtn) {
    ui.clientAuthBundleTabBtn.classList.toggle("hidden", !showModeTabs || !allowManualImport);
    ui.clientAuthBundleTabBtn.classList.toggle("active", clientAuthView === "bundle");
  }
  if (ui.clientLoginPanel) {
    ui.clientLoginPanel.classList.toggle("hidden", !(showRemotePanels && clientAuthView === "login"));
  }
  if (ui.clientRegisterPanel) {
    ui.clientRegisterPanel.classList.toggle("hidden", !(showRemotePanels && clientAuthView === "register"));
  }
  if (ui.clientResetPanel) {
    ui.clientResetPanel.classList.toggle("hidden", !(showRemotePanels && clientAuthView === "reset"));
  }
  if (ui.clientBundlePanel) {
    ui.clientBundlePanel.classList.toggle("hidden", !(allowManualImport && clientAuthView === "bundle"));
  }
  if (ui.licenseClearLocalBtn) {
    ui.licenseClearLocalBtn.textContent = authMode === "prod_login" ? "退出登录" : "清除授权";
  }
  syncClientAuthControlStates();
  if (!readyForWorkspace) {
    let statusText = "";
    if (authenticated) {
      statusText = "授权已通过，正在载入本地工作台...";
    } else if (authMode === "prod_login") {
      statusText = remoteAuthDisabled
        ? "认证服务未配置，当前无法执行登录。"
        : (String(license.message || "").trim() || "请输入账号密码登录。");
    } else if (authMode === "dev_auto_bundle") {
      statusText = expired
        ? "开发授权已过期，请重启客户端或检查本地私钥配置。"
        : (String(license.message || "").trim() || "正在自动加载本地开发授权。");
    } else {
      statusText = expired
        ? "授权已过期，请导入新的授权包。"
        : (String(license.message || "").trim() || "当前未导入客户端授权。");
    }
    const isError = !authenticated && (expired || remoteAuthDisabled);
    setLicenseStatus(
      statusText,
      isError
    );
  }
  renderGuestWorkspaceNotice();
}

async function initializeAuthenticatedWorkspace() {
  if (state.workspaceHydratedFor) {
    return;
  }
  loadCraftUiPrefs();
  loadBatchCraftUiPrefs();
  await loadCraftAssistPresetsFromStorage();
  await loadTradeupSimulationPresetsFromStorage();
  initWearOptions();
  refreshRarityMenu();
  setFilterPanel(state.filterPanel);
  updateFilterDrawer();
  applyCraftLayoutWidth();
  setAccountStatus("准备就绪");
  setNoAccountState({silentSummary: true});
  try {
    const uiState = await api("/api/ui-state");
    const preferred = String(uiState.last_selected_username || "").trim();
    await loadAccounts({preferUsername: preferred});
    if (state.accountSelectedUsername) await switchAccountView(state.accountSelectedUsername);
    else setNoAccountState({silentSummary: true});
    showPage("accountPage");
    state.workspaceHydratedFor = preferred || "ready";
  } catch (err) {
    setSummary(`初始化失败：${err.message}`);
    setAccountStatus(`初始化失败：${err.message}`, true);
  }
}

async function loadLicenseState({hydrateWorkspace = true} = {}) {
  const result = await requestLicenseJson("/api/client-auth/state");
  applyClientLicenseState(result.data || {});
  renderLicenseGate();
  if (state.clientLicense.authenticated && hydrateWorkspace) {
    setLicenseStatus("授权已验证，正在载入工作台...");
    state.clientAuthModalOpen = false;
    state.clientAuthPromptTitle = "";
    state.clientAuthPromptHint = "";
    await initializeAuthenticatedWorkspace();
    renderLicenseGate();
  } else if (hydrateWorkspace) {
    applyGuestWorkspacePreview({
      reason: String(state.clientLicense && state.clientLicense.message || "").trim()
        || "当前未登录，已进入访客预览态。"
    });
    renderLicenseGate();
  }
  return state.clientLicense;
}

async function submitClientLogin() {
  const username = String((ui.clientLoginUsername && ui.clientLoginUsername.value) || "").trim();
  const password = String((ui.clientLoginPassword && ui.clientLoginPassword.value) || "").trim();
  if (!username) {
    setLicenseStatus("请输入登录账号", true);
    return;
  }
  if (!password) {
    setLicenseStatus("请输入登录密码", true);
    return;
  }
  setButtonBusy(ui.clientLoginSubmitBtn, true);
  setLicenseStatus("正在登录并获取授权...");
  try {
    const result = await requestLicenseJson("/api/client-auth/login", {
      method: "POST",
      body: JSON.stringify({username, password})
    });
    if (!result.ok) {
      setLicenseStatus(String(result.data && result.data.message || "登录失败"), true);
      return;
    }
    if (ui.clientLoginPassword) {
      ui.clientLoginPassword.value = "";
    }
    await loadLicenseState({hydrateWorkspace: true});
  } catch (err) {
    setLicenseStatus(String(err && err.message ? err.message : err || "登录失败"), true);
  } finally {
    setButtonBusy(ui.clientLoginSubmitBtn, false);
  }
}

async function sendClientRegisterCode() {
  const email = String((ui.clientRegisterEmail && ui.clientRegisterEmail.value) || "").trim();
  if (!email) {
    setLicenseStatus("请输入注册邮箱", true);
    return;
  }
  setButtonBusy(ui.clientRegisterSendCodeBtn, true);
  setLicenseStatus("正在发送注册验证码...");
  try {
    const result = await requestLicenseJson("/api/client-auth/register/send-code", {
      method: "POST",
      body: JSON.stringify({email})
    });
    setLicenseStatus(String(result.data && result.data.message || "注册验证码已发送，请查收邮箱。"));
  } catch (err) {
    setLicenseStatus(String(err && err.message ? err.message : err || "发送注册验证码失败"), true);
  } finally {
    setButtonBusy(ui.clientRegisterSendCodeBtn, false);
  }
}

async function submitClientRegister() {
  const email = String((ui.clientRegisterEmail && ui.clientRegisterEmail.value) || "").trim();
  const code = String((ui.clientRegisterCode && ui.clientRegisterCode.value) || "").trim();
  const username = String((ui.clientRegisterUsername && ui.clientRegisterUsername.value) || "").trim();
  const password = String((ui.clientRegisterPassword && ui.clientRegisterPassword.value) || "").trim();
  if (!email || !code || !username || !password) {
    setLicenseStatus("请完整填写邮箱、验证码、用户名和密码", true);
    return;
  }
  setButtonBusy(ui.clientRegisterSubmitBtn, true);
  setLicenseStatus("正在提交注册...");
  try {
    const result = await requestLicenseJson("/api/client-auth/register", {
      method: "POST",
      body: JSON.stringify({email, code, username, password})
    });
    if (!result.ok) {
      setLicenseStatus(String(result.data && result.data.message || "注册失败"), true);
      return;
    }
    if (ui.clientLoginUsername) {
      ui.clientLoginUsername.value = username;
    }
    if (ui.clientRegisterCode) ui.clientRegisterCode.value = "";
    if (ui.clientRegisterPassword) ui.clientRegisterPassword.value = "";
    setClientAuthView("login");
    setLicenseStatus(String(result.data && result.data.message || "注册成功，请使用账号密码登录。"));
  } catch (err) {
    setLicenseStatus(String(err && err.message ? err.message : err || "注册失败"), true);
  } finally {
    setButtonBusy(ui.clientRegisterSubmitBtn, false);
  }
}

async function sendClientResetCode() {
  const email = String((ui.clientResetEmail && ui.clientResetEmail.value) || "").trim();
  if (!email) {
    setLicenseStatus("请输入重置邮箱", true);
    return;
  }
  setButtonBusy(ui.clientResetSendCodeBtn, true);
  setLicenseStatus("正在发送重置验证码...");
  try {
    const result = await requestLicenseJson("/api/client-auth/password/send-reset-code", {
      method: "POST",
      body: JSON.stringify({email})
    });
    setLicenseStatus(String(result.data && result.data.message || "重置验证码已发送，请查收邮箱。"));
  } catch (err) {
    setLicenseStatus(String(err && err.message ? err.message : err || "发送重置验证码失败"), true);
  } finally {
    setButtonBusy(ui.clientResetSendCodeBtn, false);
  }
}

async function submitClientReset() {
  const email = String((ui.clientResetEmail && ui.clientResetEmail.value) || "").trim();
  const code = String((ui.clientResetCode && ui.clientResetCode.value) || "").trim();
  const newPassword = String((ui.clientResetPassword && ui.clientResetPassword.value) || "").trim();
  if (!email || !code || !newPassword) {
    setLicenseStatus("请完整填写邮箱、验证码和新密码", true);
    return;
  }
  setButtonBusy(ui.clientResetSubmitBtn, true);
  setLicenseStatus("正在重置密码...");
  try {
    const result = await requestLicenseJson("/api/client-auth/password/reset", {
      method: "POST",
      body: JSON.stringify({email, code, new_password: newPassword})
    });
    if (!result.ok) {
      setLicenseStatus(String(result.data && result.data.message || "重置密码失败"), true);
      return;
    }
    if (ui.clientResetCode) ui.clientResetCode.value = "";
    if (ui.clientResetPassword) ui.clientResetPassword.value = "";
    setClientAuthView("login");
    setLicenseStatus(String(result.data && result.data.message || "密码已重置，请使用账号密码重新登录。"));
  } catch (err) {
    setLicenseStatus(String(err && err.message ? err.message : err || "重置密码失败"), true);
  } finally {
    setButtonBusy(ui.clientResetSubmitBtn, false);
  }
}

async function submitLicenseImport() {
  const raw = String((ui.licenseBundleInput && ui.licenseBundleInput.value) || "").trim();
  if (!raw) {
    setLicenseStatus("请输入授权包 JSON", true);
    return;
  }
  let bundle = null;
  try {
    bundle = JSON.parse(raw);
  } catch (_) {
    setLicenseStatus("授权包 JSON 格式错误", true);
    return;
  }
  setButtonBusy(ui.licenseImportBtn, true);
  setLicenseStatus("正在导入并校验客户端授权...");
  try {
    const result = await requestLicenseJson("/api/license/import", {
      method: "POST",
      body: JSON.stringify({bundle})
    });
    if (!result.ok) {
      setLicenseStatus(String(result.data && result.data.message || "客户端授权导入失败"), true);
      await loadLicenseState({hydrateWorkspace: false});
      return;
    }
    setLicenseStatus("客户端授权导入成功，正在载入工作台...");
    await loadLicenseState({hydrateWorkspace: true});
  } catch (err) {
    setLicenseStatus(String(err && err.message ? err.message : err || "客户端授权导入失败"), true);
  } finally {
    setButtonBusy(ui.licenseImportBtn, false);
  }
}

async function clearLocalLicense() {
  try {
    await requestLicenseJson(
      getClientAuthMode() === "prod_login" ? "/api/client-auth/logout" : "/api/license/clear",
      {method: "POST"}
    );
  } finally {
    state.workspaceHydratedFor = "";
    state.clientAuthModalOpen = false;
    state.clientAuthPromptTitle = "";
    state.clientAuthPromptHint = "";
    try {
      await loadLicenseState({hydrateWorkspace: true});
    } catch (_) {
      applyClientLicenseState({
        authenticated: false,
        code: "license_missing",
        message: getClientAuthMode() === "prod_login"
          ? "已退出登录，当前为访客预览态。"
          : "已清除授权，当前为访客预览态。",
        user: null,
        permissions: [],
        membership: [],
        feature_flags: {},
        auth_mode: getClientAuthMode(),
        allow_manual_import: isManualImportAllowed(),
        auth_service_configured: isRemoteClientAuthConfigured(),
        auth_service_base_url: String(state.clientLicense && state.clientLicense.authServiceBaseUrl || "").trim(),
        expires_at: "",
        expires_in_ms: 0
      });
      applyGuestWorkspacePreview({
        reason: getClientAuthMode() === "prod_login"
          ? "已退出登录，当前为访客预览态。"
          : "已清除授权，当前为访客预览态。"
      });
      renderLicenseGate();
    }
  }
}

async function handleApiLicenseFailure() {
  state.clientLicense = {
    checked: true,
    authenticated: false,
    code: "license_required",
    message: "客户端授权已失效",
    user: null,
    permissions: [],
    membership: [],
    featureFlags: {},
    authMode: getClientAuthMode(),
    allowManualImport: isManualImportAllowed(),
    authServiceConfigured: isRemoteClientAuthConfigured(),
    authServiceBaseUrl: String(state.clientLicense && state.clientLicense.authServiceBaseUrl || "").trim(),
    expiresAt: "",
    expiresInMs: 0
  };
  syncAuthSessionStoreFromLicense();
  state.workspaceHydratedFor = "";
  state.clientAuthModalOpen = false;
  state.clientAuthPromptTitle = "";
  state.clientAuthPromptHint = "";
  applyGuestWorkspacePreview({
    reason: getClientAuthMode() === "prod_login"
      ? "登录已失效，已回落到访客预览态。"
      : "授权已失效，已回落到访客预览态。"
  });
  renderLicenseGate();
  setLicenseStatus(
    getClientAuthMode() === "prod_login"
      ? "客户端登录授权已失效，请重新登录。"
      : "客户端授权已失效，请重新导入授权包。",
    true
  );
  try {
    await loadLicenseState({hydrateWorkspace: false});
  } catch (_) {
    // ignore refresh failures
  }
}

if (typeof window !== "undefined") {
  window.__cs2AlchemyHandleApiLicenseFailure = () => {
    void handleApiLicenseFailure();
  };
}

function parseEventData(raw) {
  try {
    return JSON.parse(String(raw || "{}"));
  } catch (_) {
    return {};
  }
}

function parseFetchTimeMs(text) {
  const value = String(text || "").trim();
  if (!value) return 0;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const ts = Date.parse(normalized);
  return Number.isFinite(ts) ? ts : 0;
}

function isSnapshotRecent(fetchTime, maxAgeMs = SNAPSHOT_REUSE_WINDOW_MS) {
  const ts = parseFetchTimeMs(fetchTime);
  if (!ts) return false;
  return Date.now() - ts <= Math.max(0, Number(maxAgeMs) || 0);
}

function deepCopyPlain(value) {
  if (value == null) return value;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch (_) {
      // fallback below
    }
  }
  return JSON.parse(JSON.stringify(value));
}

function cacheSnapshotForAccount(
  username,
  {rows = [], component = null, snapshotPath = "", fetchTime = "", connected = false, authState = "normal", authReason = ""} = {}
) {
  const key = String(username || "").trim();
  if (!key) return;
  if (!(state.snapshotCacheByAccount instanceof Map)) {
    state.snapshotCacheByAccount = new Map();
  }
  state.snapshotCacheByAccount.set(key, {
    rows: deepCopyPlain(Array.isArray(rows) ? rows : []),
    component: deepCopyPlain(component || {summary_map: {}, item_map: {}}),
    snapshotPath: String(snapshotPath || "").trim(),
    fetchTime: String(fetchTime || "").trim(),
    connected: !!connected,
    authState: String(authState || "").trim() || "normal",
    authReason: String(authReason || "").trim(),
    cachedAt: Date.now()
  });
}

function markCachedConnectionDisconnected(username) {
  const key = String(username || "").trim();
  if (!key) return;
  if (!(state.snapshotCacheByAccount instanceof Map)) return;
  const cached = state.snapshotCacheByAccount.get(key);
  if (!cached || typeof cached !== "object") return;
  state.snapshotCacheByAccount.set(key, {...cached, connected: false});
}

function applyCachedSnapshotForAccount(username, {silentSummary = false} = {}) {
  const key = String(username || "").trim();
  if (!key) return false;
  if (!(state.snapshotCacheByAccount instanceof Map)) return false;
  const cached = state.snapshotCacheByAccount.get(key);
  if (!cached || typeof cached !== "object") return false;
  if (!isSnapshotRecent(cached.fetchTime, SNAPSHOT_REUSE_WINDOW_MS)) {
    state.snapshotCacheByAccount.delete(key);
    return false;
  }
  state.currentAccountUsername = key;
  if (cached.connected === true) state.connectedUsername = key;
  else if (state.connectedUsername === key) state.connectedUsername = "";
  setAccountAuthState(key, {
    authState: String(cached.authState || "").trim() || "normal",
    authReason: String(cached.authReason || "").trim()
  });
  state.fetchTime = String(cached.fetchTime || "").trim();
  const rows = deepCopyPlain(Array.isArray(cached.rows) ? cached.rows : []);
  const component = deepCopyPlain(cached.component || {summary_map: {}, item_map: {}});
  setRows(rows, component, String(cached.snapshotPath || "").trim());
  clearSnapshotDirty();
  syncInventoryTop();
  if (rows.length) {
    if (!silentSummary) setSummary(`已显示该账号快照（10分钟内复用），共 ${rows.length} 条`);
  } else {
    state.emptyHint = "当前账号未连接";
    if (!silentSummary) setSummary("当前账号未连接（暂无上次库存信息）", {isError: false});
  }
  return true;
}

function markSnapshotDirty(reason = "") {
  state.snapshotDirty = true;
  state.snapshotDirtyReason = String(reason || "").trim();
}

function clearSnapshotDirty() {
  state.snapshotDirty = false;
  state.snapshotDirtyReason = "";
}

function normalizeItemIdList(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((x) => String(x || "").trim()).filter(Boolean)));
}

function createDefaultCraftAssistRuntimeState() {
  return {
    craftAssistSelecting: false,
    craftAssistPendingUiAction: "",
    craftAssistPendingPresetId: "",
    craftAssistRunToken: ""
  };
}

function normalizeCraftAssistRuntimeStateSnapshot(snapshot) {
  const base = createDefaultCraftAssistRuntimeState();
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  const action = String(source.craftAssistPendingUiAction || "").trim();
  const normalizedAction = action === "panel_apply" || action === "preset_apply" ? action : "";
  const normalizedPresetId = normalizedAction === "preset_apply"
    ? String(source.craftAssistPendingPresetId || "").trim()
    : "";
  const normalizedRunToken = String(source.craftAssistRunToken || "").trim();
  const selecting = !!source.craftAssistSelecting
    && !!normalizedAction
    && (normalizedAction !== "preset_apply" || !!normalizedPresetId);
  return {
    ...base,
    craftAssistSelecting: selecting,
    craftAssistPendingUiAction: selecting ? normalizedAction : "",
    craftAssistPendingPresetId: selecting ? normalizedPresetId : "",
    craftAssistRunToken: selecting ? normalizedRunToken : ""
  };
}

function createCraftAssistRunToken() {
  return `assist_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getCraftAssistActiveRunToken(username) {
  const key = String(username || "").trim();
  if (!key) return "";
  if (!(state.craftAssistActiveRunTokensByAccount instanceof Map)) {
    state.craftAssistActiveRunTokensByAccount = new Map();
  }
  return String(state.craftAssistActiveRunTokensByAccount.get(key) || "").trim();
}

function setCraftAssistActiveRunToken(username, token) {
  const key = String(username || "").trim();
  if (!key) return "";
  if (!(state.craftAssistActiveRunTokensByAccount instanceof Map)) {
    state.craftAssistActiveRunTokensByAccount = new Map();
  }
  const next = String(token || "").trim();
  if (!next) {
    state.craftAssistActiveRunTokensByAccount.delete(key);
    return "";
  }
  state.craftAssistActiveRunTokensByAccount.set(key, next);
  return next;
}

function clearCraftAssistActiveRunToken(username, {onlyIfToken = ""} = {}) {
  const key = String(username || "").trim();
  if (!key || !(state.craftAssistActiveRunTokensByAccount instanceof Map)) return "";
  const current = String(state.craftAssistActiveRunTokensByAccount.get(key) || "").trim();
  const expected = String(onlyIfToken || "").trim();
  if (expected && current && current !== expected) return current;
  state.craftAssistActiveRunTokensByAccount.delete(key);
  return current;
}

function normalizeCraftAssistRuntimeStateSnapshotForAccount(username, snapshot) {
  const next = normalizeCraftAssistRuntimeStateSnapshot(snapshot);
  if (!next.craftAssistSelecting) return next;
  const key = String(username || "").trim();
  if (!key) return createDefaultCraftAssistRuntimeState();
  const activeToken = getCraftAssistActiveRunToken(key);
  if (!activeToken) return createDefaultCraftAssistRuntimeState();
  if (String(next.craftAssistRunToken || "").trim() !== activeToken) {
    return createDefaultCraftAssistRuntimeState();
  }
  return next;
}

function buildCurrentCraftAssistRuntimeStateSnapshotRaw() {
  return normalizeCraftAssistRuntimeStateSnapshot({
    craftAssistSelecting: state.craftAssistSelecting,
    craftAssistPendingUiAction: state.craftAssistPendingUiAction,
    craftAssistPendingPresetId: state.craftAssistPendingPresetId,
    craftAssistRunToken: state.craftAssistRunToken
  });
}

function buildCurrentCraftAssistRuntimeStateSnapshot() {
  return normalizeCraftAssistRuntimeStateSnapshotForAccount(
    String(state.currentAccountUsername || "").trim(),
    buildCurrentCraftAssistRuntimeStateSnapshotRaw()
  );
}

function applyCraftAssistRuntimeStateSnapshot(snapshot, {username = "", skipValidation = false} = {}) {
  const key = String(username || state.currentAccountUsername || "").trim();
  const next = skipValidation
    ? normalizeCraftAssistRuntimeStateSnapshot(snapshot)
    : normalizeCraftAssistRuntimeStateSnapshotForAccount(key, snapshot);
  if (next.craftAssistSelecting) {
    state.craftAssistSelecting = true;
  } else {
    state.craftAssistSelecting = false;
  }
  state.craftAssistPendingUiAction = next.craftAssistPendingUiAction;
  state.craftAssistPendingPresetId = next.craftAssistPendingPresetId;
  state.craftAssistRunToken = next.craftAssistRunToken;
  return next;
}

function saveCraftAssistRuntimeState(username, snapshot = null) {
  const key = String(username || "").trim();
  if (!key) return createDefaultCraftAssistRuntimeState();
  if (!(state.craftAssistRuntimeByAccount instanceof Map)) {
    state.craftAssistRuntimeByAccount = new Map();
  }
  const sourceSnapshot = snapshot || buildCurrentCraftAssistRuntimeStateSnapshot();
  const next = normalizeCraftAssistRuntimeStateSnapshotForAccount(key, sourceSnapshot);
  state.craftAssistRuntimeByAccount.set(key, next);
  return next;
}

function getCraftAssistRuntimeStateSnapshot(username, {preferCurrent = false} = {}) {
  const key = String(username || "").trim();
  if (!key) return createDefaultCraftAssistRuntimeState();
  const current = String(state.currentAccountUsername || "").trim();
  if (preferCurrent && key === current) {
    return buildCurrentCraftAssistRuntimeStateSnapshot();
  }
  if (!(state.craftAssistRuntimeByAccount instanceof Map)) {
    state.craftAssistRuntimeByAccount = new Map();
  }
  return normalizeCraftAssistRuntimeStateSnapshotForAccount(key, state.craftAssistRuntimeByAccount.get(key));
}

function syncCurrentCraftAssistRuntimeState() {
  const key = String(state.currentAccountUsername || "").trim();
  const current = buildCurrentCraftAssistRuntimeStateSnapshotRaw();
  const next = normalizeCraftAssistRuntimeStateSnapshotForAccount(key, current);
  const changed = current.craftAssistSelecting !== next.craftAssistSelecting
    || current.craftAssistPendingUiAction !== next.craftAssistPendingUiAction
    || current.craftAssistPendingPresetId !== next.craftAssistPendingPresetId
    || current.craftAssistRunToken !== next.craftAssistRunToken;
  if (changed) {
    applyCraftAssistRuntimeStateSnapshot(next, {username: key, skipValidation: true});
  }
  return next;
}

function createDefaultCraftAccountScopedState() {
  return {
    craftSelectedItemIds: [],
    craftStatusText: "",
    craftStatusError: false,
    craftRecipeQueue: [],
    craftActiveRecipeId: "",
    craftAssistOpen: false,
    craftAssistPickerOpen: false,
    craftAssistPickerTargetMaterialId: "",
    craftAssistRoleChooserOpen: false,
    craftAssistPickRole: "main",
    craftAssistUseAbsoluteWear: false,
    craftAssistTargetWear: null,
    craftAssistTargetWearRaw: "",
    craftAssistMainCount: 5,
    craftAssistAuxCount: 5,
    craftAssistMaterials: [],
    craftAssistPresetApplyCountMap: {},
    craftAssistPresetEditingId: "",
    craftAssistPresetEditingName: "",
    craftAssistPresetEditingBackup: null,
    craftAssistPresetEditingInitialSnapshot: null,
    craftPredictorOpen: false,
    craftPredictorContextType: "",
    craftPredictorContextId: "",
    craftPredictorContextLabel: "",
    craftPredictorAutoOpenMuted: false
  };
}

function normalizeCraftAccountScopedItemIdList(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ));
}

function projectCraftAssistAccountScopedMaterials(materials) {
  const list = Array.isArray(materials) ? materials : [];
  const clamp01 = (value, fallback = 0) => {
    const numeric = Number(value);
    const base = Number.isFinite(numeric) ? numeric : Number(fallback);
    return Math.max(0, Math.min(1, Number.isFinite(base) ? base : 0));
  };
  const filterModeOf = (value) => String(value || "").trim() === "absolute" ? "absolute" : "relative";
  const normalizeNames = (value) => {
    const source = Array.isArray(value) ? value : (value == null ? [] : [value]);
    const out = [];
    const seen = new Set();
    for (const entry of source) {
      const name = String(entry || "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
    return out;
  };
  return list
    .map((entry) => {
      const items = Array.isArray(entry && entry.items) && entry.items.length > 0
        ? entry.items
            .map((item, index) => ({
              id: String(item && item.id || `${String(entry && entry.id || "assist").trim() || "assist"}__${index + 1}`).trim(),
              name: String(item && item.name || "").trim(),
              wear_filter_mode: filterModeOf(item && item.wear_filter_mode),
              wear_min: clamp01(item && item.wear_min, 0),
              wear_max: clamp01(item && item.wear_max, 1),
              custom_range: !!(item && item.custom_range)
            }))
            .filter((item) => item.name)
        : normalizeNames(entry && entry.names).map((name, index) => ({
            id: `${String(entry && entry.id || "assist").trim() || "assist"}__${index + 1}`,
            name,
            wear_filter_mode: filterModeOf(entry && entry.wear_filter_mode),
            wear_min: clamp01(entry && entry.wear_min, 0),
            wear_max: clamp01(entry && entry.wear_max, 1),
            custom_range: !!(entry && entry.custom_range)
          }));
      if (!items.length) return null;
      return {
        id: String(entry && entry.id || "").trim(),
        role: String(entry && entry.role || "").trim() === "aux" ? "aux" : "main",
        count: Math.max(1, Math.min(10, Math.trunc(Number(entry && entry.count) || 1))),
        items
      };
    })
    .filter(Boolean);
}

function normalizeCraftAccountScopedStateSnapshot(snapshot) {
  const base = createDefaultCraftAccountScopedState();
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  const selectedIds = source.craftSelectedItemIds instanceof Set
    ? [...source.craftSelectedItemIds]
    : (Array.isArray(source.craftSelectedItemIds) ? source.craftSelectedItemIds : []);
  const legacyPredictorKey = String(source.craftPredictorSelectedConfigKey || "").trim();
  let predictorContextType = String(source.craftPredictorContextType || "").trim();
  if (predictorContextType !== "recipe" && predictorContextType !== "draft") {
    predictorContextType = legacyPredictorKey ? "draft" : "";
  }
  const predictorContextId = String(source.craftPredictorContextId || "").trim();
  const predictorContextLabel = String(source.craftPredictorContextLabel || source.craftPredictorSelectedConfigLabel || "").trim();
  const predictorAutoOpenMuted = !!source.craftPredictorAutoOpenMuted;
  const targetWearPair = resolveCraftAssistTargetWearPair(
    source.craftAssistTargetWear,
    source.craftAssistTargetWearRaw
  );
  return {
    ...base,
    craftSelectedItemIds: normalizeCraftAccountScopedItemIdList(selectedIds),
    craftStatusText: String(source.craftStatusText || "").trim(),
    craftStatusError: !!source.craftStatusError,
    craftRecipeQueue: Array.isArray(source.craftRecipeQueue) ? deepCopyPlain(source.craftRecipeQueue) : [],
    craftActiveRecipeId: String(source.craftActiveRecipeId || "").trim(),
    craftAssistOpen: !!source.craftAssistOpen,
    craftAssistPickerOpen: !!source.craftAssistPickerOpen,
    craftAssistPickerTargetMaterialId: String(source.craftAssistPickerTargetMaterialId || "").trim(),
    craftAssistRoleChooserOpen: !!source.craftAssistRoleChooserOpen,
    craftAssistPickRole: String(source.craftAssistPickRole || "").trim() === "aux" ? "aux" : "main",
    craftAssistUseAbsoluteWear: !!source.craftAssistUseAbsoluteWear,
    craftAssistTargetWear: targetWearPair ? targetWearPair.target_wear : null,
    craftAssistTargetWearRaw: targetWearPair ? targetWearPair.target_wear_raw : "",
    craftAssistMainCount: Math.max(0, Math.min(10, Math.trunc(Number(source.craftAssistMainCount != null ? source.craftAssistMainCount : base.craftAssistMainCount) || base.craftAssistMainCount))),
    craftAssistAuxCount: Math.max(0, Math.min(10, Math.trunc(Number(source.craftAssistAuxCount != null ? source.craftAssistAuxCount : base.craftAssistAuxCount) || base.craftAssistAuxCount))),
    craftAssistMaterials: projectCraftAssistAccountScopedMaterials(source.craftAssistMaterials),
    craftAssistPresetApplyCountMap: source.craftAssistPresetApplyCountMap && typeof source.craftAssistPresetApplyCountMap === "object"
      ? deepCopyPlain(source.craftAssistPresetApplyCountMap)
      : {},
    craftAssistPresetEditingId: String(source.craftAssistPresetEditingId || "").trim(),
    craftAssistPresetEditingName: String(source.craftAssistPresetEditingName || "").trim(),
    craftAssistPresetEditingBackup: source.craftAssistPresetEditingBackup && typeof source.craftAssistPresetEditingBackup === "object"
      ? deepCopyPlain(source.craftAssistPresetEditingBackup)
      : null,
    craftAssistPresetEditingInitialSnapshot: source.craftAssistPresetEditingInitialSnapshot && typeof source.craftAssistPresetEditingInitialSnapshot === "object"
      ? deepCopyPlain(source.craftAssistPresetEditingInitialSnapshot)
      : null,
    craftPredictorOpen: !!source.craftPredictorOpen,
    craftPredictorContextType: predictorContextType,
    craftPredictorContextId: predictorContextId,
    craftPredictorContextLabel: predictorContextLabel,
    craftPredictorAutoOpenMuted: predictorAutoOpenMuted
  };
}

function buildCurrentCraftAccountScopedStateSnapshot() {
  const snapshot = normalizeCraftAccountScopedStateSnapshot({
    craftSelectedItemIds: [...state.craftSelectedItemIds],
    craftStatusText: state.craftStatusText,
    craftStatusError: state.craftStatusError,
    craftRecipeQueue: state.craftRecipeQueue,
    craftActiveRecipeId: state.craftActiveRecipeId,
    craftAssistOpen: state.craftAssistOpen,
    craftAssistPickerOpen: state.craftAssistPickerOpen,
    craftAssistPickerTargetMaterialId: state.craftAssistPickerTargetMaterialId,
    craftAssistRoleChooserOpen: state.craftAssistRoleChooserOpen,
    craftAssistPickRole: state.craftAssistPickRole,
    craftAssistTargetWear: state.craftAssistTargetWear,
    craftAssistTargetWearRaw: state.craftAssistTargetWearRaw,
    craftAssistMaterials: projectCraftAssistAccountScopedMaterials(state.craftAssistMaterials),
    craftAssistPresetApplyCountMap: state.craftAssistPresetApplyCountMap,
    craftAssistPresetEditingId: state.craftAssistPresetEditingId,
    craftAssistPresetEditingName: state.craftAssistPresetEditingName,
    craftAssistPresetEditingBackup: state.craftAssistPresetEditingBackup,
    craftAssistPresetEditingInitialSnapshot: state.craftAssistPresetEditingInitialSnapshot,
    craftPredictorOpen: state.craftPredictorOpen,
    craftPredictorContextType: state.craftPredictorContextType,
    craftPredictorContextId: state.craftPredictorContextId,
    craftPredictorContextLabel: state.craftPredictorContextLabel,
    craftPredictorAutoOpenMuted: state.craftPredictorAutoOpenMuted
  });
  delete snapshot.craftAssistUseAbsoluteWear;
  delete snapshot.craftAssistMainCount;
  delete snapshot.craftAssistAuxCount;
  return snapshot;
}

function applyCraftAccountScopedStateSnapshot(snapshot, {runtimeSnapshot = null, username = "", resetPredictorPreview = true} = {}) {
  const next = normalizeCraftAccountScopedStateSnapshot(snapshot);
  state.craftSelectedItemIds = new Set(next.craftSelectedItemIds);
  state.craftStatusText = next.craftStatusText;
  state.craftStatusError = !!next.craftStatusError;
  state.craftRecipeQueue = next.craftRecipeQueue;
  state.craftActiveRecipeId = next.craftActiveRecipeId;
  state.craftAssistOpen = !!next.craftAssistOpen;
  state.craftAssistPickerOpen = !!next.craftAssistPickerOpen;
  state.craftAssistPickerTargetMaterialId = next.craftAssistPickerTargetMaterialId;
  state.craftAssistRoleChooserOpen = !!next.craftAssistRoleChooserOpen;
  state.craftAssistPickRole = next.craftAssistPickRole;
  state.craftAssistUseAbsoluteWear = !!next.craftAssistUseAbsoluteWear;
  state.craftAssistTargetWear = next.craftAssistTargetWear;
  state.craftAssistTargetWearRaw = next.craftAssistTargetWearRaw;
  state.craftAssistMainCount = next.craftAssistMainCount;
  state.craftAssistAuxCount = next.craftAssistAuxCount;
  state.craftAssistMaterials = next.craftAssistMaterials;
  state.craftAssistPresetApplyCountMap = next.craftAssistPresetApplyCountMap;
  state.craftAssistPresetEditingId = next.craftAssistPresetEditingId;
  state.craftAssistPresetEditingName = next.craftAssistPresetEditingName;
  state.craftAssistPresetEditingBackup = next.craftAssistPresetEditingBackup;
  state.craftAssistPresetEditingInitialSnapshot = next.craftAssistPresetEditingInitialSnapshot;
  state.craftPredictorOpen = !!next.craftPredictorOpen;
  state.craftPredictorContextType = next.craftPredictorContextType;
  state.craftPredictorContextId = next.craftPredictorContextId;
  state.craftPredictorContextLabel = next.craftPredictorContextLabel;
  state.craftPredictorAutoOpenMuted = !!next.craftPredictorAutoOpenMuted;
  if (resetPredictorPreview && typeof clearCraftPredictorPreviewState === "function") {
    clearCraftPredictorPreviewState();
  }
  applyCraftAssistRuntimeStateSnapshot(runtimeSnapshot || createDefaultCraftAssistRuntimeState(), {username});
  return next;
}

function saveCraftAccountScopedState(username, snapshot = null) {
  const key = String(username || "").trim();
  if (!key) return null;
  if (!(state.craftAccountStateByAccount instanceof Map)) {
    state.craftAccountStateByAccount = new Map();
  }
  const next = normalizeCraftAccountScopedStateSnapshot(snapshot || buildCurrentCraftAccountScopedStateSnapshot());
  state.craftAccountStateByAccount.set(key, next);
  return next;
}

function getCraftAccountScopedStateSnapshot(username, {preferSaved = false} = {}) {
  const key = String(username || "").trim();
  if (!key) return createDefaultCraftAccountScopedState();
  const current = String(state.currentAccountUsername || "").trim();
  if (!preferSaved && key === current) {
    return buildCurrentCraftAccountScopedStateSnapshot();
  }
  if (!(state.craftAccountStateByAccount instanceof Map)) {
    state.craftAccountStateByAccount = new Map();
  }
  return normalizeCraftAccountScopedStateSnapshot(state.craftAccountStateByAccount.get(key));
}

function restoreCraftAccountScopedState(username, {preferSaved = true} = {}) {
  const key = String(username || "").trim();
  if (!key) {
    return applyCraftAccountScopedStateSnapshot(createDefaultCraftAccountScopedState(), {
      runtimeSnapshot: createDefaultCraftAssistRuntimeState(),
      username: ""
    });
  }
  const next = getCraftAccountScopedStateSnapshot(key, {preferSaved});
  saveCraftAccountScopedState(key, next);
  return applyCraftAccountScopedStateSnapshot(next, {
    runtimeSnapshot: getCraftAssistRuntimeStateSnapshot(key, {preferCurrent: false}),
    username: key
  });
}

function buildComponentSummaryFromRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const itemMap = {};
  const summaryMap = {};
  for (const row of list) {
    const cid = String(row && row.casket_id || "").trim();
    if (!cid) continue;
    if (!itemMap[cid]) itemMap[cid] = [];
    itemMap[cid].push(row);
  }
  for (const row of list) {
    if (Number(row && row.def_index || 0) !== STORAGE_UNIT_DEF_INDEX) continue;
    const id = rowAssetId(row);
    if (!id) continue;
    const expected = Math.max(0, Number(row && row.casket_contained_item_count || 0) || 0);
    const loaded = Math.max(Array.isArray(itemMap[id]) ? itemMap[id].length : 0, expected);
    summaryMap[id] = {
      component_id: id,
      name: String(row && (row.name || row.alchemy_name) || `Component ${id}`),
      expected_count: Math.max(STORAGE_UNIT_CAPACITY, expected),
      loaded_count: loaded
    };
  }
  return {summary_map: summaryMap, item_map: itemMap};
}

function applyComponentMoveDelta({
  action,
  componentId,
  successIds,
  successCount = 0,
  snapshotPath = "",
  fetchTime = ""
}) {
  const actionKey = String(action || "").trim();
  if (actionKey !== "withdraw" && actionKey !== "deposit") {
    return {ok: false, reason: "invalid_action", applied: 0};
  }
  const componentKey = String(componentId || "").trim();
  if (!componentKey) {
    return {ok: false, reason: "missing_component_id", applied: 0};
  }
  const ids = normalizeItemIdList(successIds);
  const expectedSuccess = Math.max(0, Number(successCount || 0) || 0);
  if (expectedSuccess > 0 && !ids.length) {
    return {ok: false, reason: "missing_success_ids", applied: 0};
  }
  if (expectedSuccess > ids.length) {
    return {ok: false, reason: "success_count_mismatch", applied: 0};
  }
  const nextFetchTime = String(fetchTime || "").trim();
  if (!ids.length) {
    if (nextFetchTime) state.fetchTime = nextFetchTime;
    syncInventoryTop();
    return {ok: true, reason: "", applied: 0};
  }

  const indexById = new Map();
  state.rows.forEach((row, idx) => {
    const id = rowAssetId(row);
    if (id) indexById.set(id, idx);
  });

  const missing = [];
  const nextRows = state.rows.map((row) => (row && typeof row === "object" ? {...row} : row));
  let applied = 0;
  for (const itemId of ids) {
    const idx = indexById.get(itemId);
    if (idx == null) {
      missing.push(itemId);
      continue;
    }
    const row = nextRows[idx];
    if (!row || typeof row !== "object") {
      missing.push(itemId);
      continue;
    }
    if (actionKey === "withdraw") {
      row.casket_id = "";
      // 组件内行通常携带 attr#272/273 的隐藏标记，取出后需同步清除以便炼金候选即时可见。
      row.hidden_reason = null;
    } else {
      row.casket_id = componentKey;
    }
    applied += 1;
  }

  if (missing.length) {
    const preview = missing.slice(0, 3).join(",");
    return {ok: false, reason: `missing_rows:${preview}`, applied};
  }

  const nextComponent = buildComponentSummaryFromRows(nextRows);
  const keepSelectedIds = new Set(state.selectedComponentItemIds);
  const nextSnapshotPath = String(snapshotPath || state.snapshotPath || "").trim();
  setRows(nextRows, nextComponent, nextSnapshotPath, {keepSelectedIds});
  if (nextFetchTime) state.fetchTime = nextFetchTime;
  syncInventoryTop();
  return {ok: true, reason: "", applied};
}

async function fallbackSnapshotForDirty(username, reason = "") {
  markSnapshotDirty(reason);
  const key = String(username || "").trim();
  if (!key) return false;
  const now = Date.now();
  const cooldownMs = Math.max(0, Number(state.dirtyFallbackCooldownMs || 0) || 0);
  const lastTs = Math.max(0, Number(state.lastDirtyFallbackTs || 0) || 0);
  if (cooldownMs > 0 && now - lastTs < cooldownMs) {
    return false;
  }
  state.lastDirtyFallbackTs = now;
  try {
    await loadSnapshotForAccount(key);
    clearSnapshotDirty();
    return true;
  } catch (_) {
    return false;
  }
}

function clampCraftRightPanelWidth(width) {
  const min = 280;
  const maxByWindow = Math.max(min, Math.floor((window.innerWidth || 1600) * 0.7));
  const max = Math.min(760, maxByWindow);
  const value = Number(width);
  if (!Number.isFinite(value) || value <= 0) return max;
  return Math.max(min, Math.min(Math.round(value), max));
}

function applyCraftLayoutWidth() {
  if (!ui.craftLayout) return;
  state.craftRightPanelWidth = clampCraftRightPanelWidth(state.craftRightPanelWidth);
  ui.craftLayout.style.setProperty("--craft-right-width", `${state.craftRightPanelWidth}px`);
  updateCraftActionLayout();
  applyCraftAssistOverlayHeight();
}

function updateCraftActionLayout() {
  if (!ui.craftRightPanel) return;
  const width = Number(ui.craftRightPanel.clientWidth || 0);
  ui.craftRightPanel.classList.toggle("compact-actions", width > 0 && width < 550);
}

function clampCraftAssistPresetWidth(width) {
  const min = CRAFT_ASSIST_PRESET_MIN_WIDTH;
  const contentWidth = Number(ui.craftAssistContent && ui.craftAssistContent.clientWidth || 0);
  const effective = contentWidth > 0 ? Math.max(0, contentWidth - 8) : 0;
  const auto = effective > 0 ? Math.max(min, Math.round(effective * 0.28)) : min;
  const maxByPanel = effective > 0 ? Math.max(min, Math.floor(effective * 0.62)) : 460;
  const max = Math.min(520, maxByPanel);
  const value = Number(width);
  if (!Number.isFinite(value) || value <= 0) return Math.max(min, Math.min(auto, max));
  return Math.max(min, Math.min(Math.round(value), max));
}

function applyCraftAssistPresetWidth() {
  if (!ui.craftAssistContent) return;
  state.craftAssistPresetWidth = clampCraftAssistPresetWidth(state.craftAssistPresetWidth);
  ui.craftAssistContent.style.setProperty("--craft-assist-preset-width", `${state.craftAssistPresetWidth}px`);
}

function clampCraftAssistOverlayHeight(height) {
  const min = 180;
  const panelHeight = Number(ui.craftLeftPanel && ui.craftLeftPanel.clientHeight || 0);
  const maxByPanel = panelHeight > 0 ? Math.max(min, panelHeight - 16) : 760;
  const max = Math.min(760, maxByPanel);
  const value = Number(height);
  if (!Number.isFinite(value) || value <= 0) {
    if (panelHeight > 0) {
      const preferred = Math.round(panelHeight - 24);
      return Math.max(min, Math.min(preferred, max));
    }
    return 560;
  }
  return Math.max(min, Math.min(Math.round(value), max));
}

function getCraftAssistSelectionListReserveHeight() {
  if (!ui.craftSelectionList || !ui.craftAssistOverlay || !state.craftAssistOpen) return 0;
  return clampCraftAssistOverlayHeight(state.craftAssistOverlayHeight) + 8;
}

function syncCraftSelectionListClearance({preserveVisibleBottom = false} = {}) {
  if (!ui.craftSelectionList) return;
  const next = getCraftAssistSelectionListReserveHeight();
  const previous = Number(ui.craftSelectionList.dataset && ui.craftSelectionList.dataset.craftAssistReserveHeight || 0);
  if (ui.craftSelectionList.style && typeof ui.craftSelectionList.style.setProperty === "function") {
    ui.craftSelectionList.style.setProperty("--craft-assist-list-reserve-height", `${next}px`);
  }
  if (ui.craftSelectionList.dataset) {
    ui.craftSelectionList.dataset.craftAssistReserveHeight = String(next);
  }
  if (preserveVisibleBottom && next > previous && Number.isFinite(Number(ui.craftSelectionList.scrollTop))) {
    ui.craftSelectionList.scrollTop = Number(ui.craftSelectionList.scrollTop || 0) + (next - previous);
  }
}

function applyCraftAssistOverlayHeight({preserveVisibleBottom = false} = {}) {
  if (!ui.craftAssistOverlay) return;
  state.craftAssistOverlayHeight = clampCraftAssistOverlayHeight(state.craftAssistOverlayHeight);
  ui.craftAssistOverlay.style.setProperty("--craft-assist-overlay-height", `${state.craftAssistOverlayHeight}px`);
  applyCraftAssistPresetWidth();
  syncCraftSelectionListClearance({preserveVisibleBottom});
}
function expandCraftAssistOverlayToBottom() {
  const panelHeight = Number(ui.craftLeftPanel && ui.craftLeftPanel.clientHeight || 0);
  if (!(panelHeight > 0)) return;
  state.craftAssistOverlayHeight = clampCraftAssistOverlayHeight(panelHeight - 24);
}

function startCraftAssistOverlayDrag(evt) {
  if (evt.button !== 0) return;
  if (!state.craftAssistOpen || !ui.craftAssistOverlayHandle || !ui.craftAssistOverlay) return;
  craftAssistOverlayDrag.active = true;
  craftAssistOverlayDrag.startY = evt.clientY;
  craftAssistOverlayDrag.startHeight = clampCraftAssistOverlayHeight(state.craftAssistOverlayHeight);
  document.body.classList.add("craft-assist-overlay-dragging");
  evt.preventDefault();
}

function moveCraftAssistOverlayDrag(evt) {
  if (!craftAssistOverlayDrag.active) return;
  const deltaY = craftAssistOverlayDrag.startY - evt.clientY;
  state.craftAssistOverlayHeight = clampCraftAssistOverlayHeight(craftAssistOverlayDrag.startHeight + deltaY);
  applyCraftAssistOverlayHeight({preserveVisibleBottom: true});
}

function stopCraftAssistOverlayDrag() {
  if (!craftAssistOverlayDrag.active) return;
  craftAssistOverlayDrag.active = false;
  document.body.classList.remove("craft-assist-overlay-dragging");
  saveCraftUiPrefs();
}

function startCraftAssistSplitDrag(evt) {
  if (evt.button !== 0) return;
  if (!state.craftAssistOpen || !ui.craftAssistSplitBar || !ui.craftAssistContent) return;
  craftAssistSplitDrag.active = true;
  craftAssistSplitDrag.startX = evt.clientX;
  craftAssistSplitDrag.startWidth = clampCraftAssistPresetWidth(state.craftAssistPresetWidth);
  document.body.classList.add("craft-assist-split-dragging");
  evt.preventDefault();
}

function moveCraftAssistSplitDrag(evt) {
  if (!craftAssistSplitDrag.active) return;
  const deltaX = evt.clientX - craftAssistSplitDrag.startX;
  // 与配方预览分割条保持同方向：向左拖大右侧，向右拖小右侧。
  state.craftAssistPresetWidth = clampCraftAssistPresetWidth(craftAssistSplitDrag.startWidth - deltaX);
  applyCraftAssistPresetWidth();
}

function stopCraftAssistSplitDrag() {
  if (!craftAssistSplitDrag.active) return;
  craftAssistSplitDrag.active = false;
  document.body.classList.remove("craft-assist-split-dragging");
  saveCraftUiPrefs();
}

function saveCraftUiPrefs() {
  try {
    const overlayHeight = Number(state.craftAssistOverlayHeight);
    localStorage.setItem(
      CRAFT_UI_PREFS_KEY,
        JSON.stringify({
          craft_use_component_items: !!state.craftUseComponentItems,
          craft_include_cooling: !!state.craftIncludeCooling,
          craft_show_seed: !!state.craftShowSeed,
        craft_show_full_wear: !!state.craftShowFullWear,
        craft_show_cooling_time: !!state.craftShowCoolingTime,
        craft_hide_collection: !!state.craftHideCollection,
        craft_hide_quantity: !!state.craftHideQuantity,
        craft_assist_fast_mode: !!state.craftAssistFastMode,
        craft_assist_approach_mode: !!state.craftAssistApproachMode,
        craft_assist_wear_offset: normalizeCraftAssistWearOffset(state.craftAssistWearOffset, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET),
        craft_right_width: clampCraftRightPanelWidth(state.craftRightPanelWidth),
        craft_assist_overlay_height: Number.isFinite(overlayHeight) ? overlayHeight : 0,
        craft_assist_preset_width: Number(state.craftAssistPresetWidth) || 240
      })
    );
  } catch (_) {
    // ignore storage errors
  }
}

function loadCraftUiPrefs() {
  try {
    const raw = localStorage.getItem(CRAFT_UI_PREFS_KEY);
    if (!raw) return;
    const prefs = JSON.parse(raw);
    if (typeof prefs.craft_use_component_items === "boolean") state.craftUseComponentItems = prefs.craft_use_component_items;
    if (typeof prefs.craft_include_cooling === "boolean") state.craftIncludeCooling = prefs.craft_include_cooling;
    if (typeof prefs.craft_show_seed === "boolean") state.craftShowSeed = prefs.craft_show_seed;
    if (typeof prefs.craft_show_full_wear === "boolean") state.craftShowFullWear = prefs.craft_show_full_wear;
    if (typeof prefs.craft_show_cooling_time === "boolean") state.craftShowCoolingTime = prefs.craft_show_cooling_time;
    if (typeof prefs.craft_hide_collection === "boolean") state.craftHideCollection = prefs.craft_hide_collection;
    if (typeof prefs.craft_hide_quantity === "boolean") state.craftHideQuantity = prefs.craft_hide_quantity;
    if (typeof prefs.craft_assist_fast_mode === "boolean") state.craftAssistFastMode = prefs.craft_assist_fast_mode;
    if (typeof prefs.craft_assist_approach_mode === "boolean") state.craftAssistApproachMode = prefs.craft_assist_approach_mode;
    if (Number.isFinite(Number(prefs.craft_assist_wear_offset))) {
      state.craftAssistWearOffset = normalizeCraftAssistWearOffset(prefs.craft_assist_wear_offset, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET);
    } else if (Number.isFinite(Number(prefs.craft_assist_wear_offset_pct))) {
      state.craftAssistWearOffset = normalizeLegacyCraftAssistWearOffsetPct(prefs.craft_assist_wear_offset_pct, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET);
    }
    if (Number.isFinite(Number(prefs.craft_right_width))) state.craftRightPanelWidth = Number(prefs.craft_right_width);
    if (Number.isFinite(Number(prefs.craft_assist_overlay_height))) {
      const savedOverlayHeight = Number(prefs.craft_assist_overlay_height);
      // 兼容旧默认值 320：迁移为自动高度（贴近底部），减少中间空白。
      state.craftAssistOverlayHeight = savedOverlayHeight === 320 ? 0 : savedOverlayHeight;
    }
    if (Number.isFinite(Number(prefs.craft_assist_preset_width))) state.craftAssistPresetWidth = CRAFT_ASSIST_PRESET_MIN_WIDTH;
  } catch (_) {
    // ignore storage errors
  }
}

function saveBatchCraftUiPrefs() {
  try {
    localStorage.setItem(BATCH_CRAFT_UI_PREFS_KEY, JSON.stringify({
      use_component_items: !!state.batchCraftUseComponentItems,
      include_cooling: !!state.batchCraftIncludeCooling,
      fast_mode: !!state.batchCraftFastMode,
      approach_mode: !!state.batchCraftApproachMode,
      wear_offset: normalizeCraftAssistWearOffset(state.batchCraftWearOffset, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET)
    }));
  } catch (_) {}
}

function loadBatchCraftUiPrefs() {
  try {
    const raw = localStorage.getItem(BATCH_CRAFT_UI_PREFS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (typeof p.use_component_items === "boolean") state.batchCraftUseComponentItems = p.use_component_items;
    if (typeof p.include_cooling === "boolean") state.batchCraftIncludeCooling = p.include_cooling;
    if (typeof p.fast_mode === "boolean") state.batchCraftFastMode = p.fast_mode;
    if (typeof p.approach_mode === "boolean") state.batchCraftApproachMode = p.approach_mode;
    if (Number.isFinite(Number(p.wear_offset))) {
      state.batchCraftWearOffset = normalizeCraftAssistWearOffset(p.wear_offset, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET);
    } else if (Number.isFinite(Number(p.wear_offset_pct))) {
      state.batchCraftWearOffset = normalizeLegacyCraftAssistWearOffsetPct(p.wear_offset_pct, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET);
    }
  } catch (_) {}
}

function startCraftSplitDrag(evt) {
  if (evt.button !== 0) return;
  if (!ui.craftSplitBar || !ui.craftLayout) return;
  craftSplitDrag.active = true;
  craftSplitDrag.startX = evt.clientX;
  craftSplitDrag.startWidth = clampCraftRightPanelWidth(state.craftRightPanelWidth);
  document.body.classList.add("craft-split-dragging");
  evt.preventDefault();
}

function moveCraftSplitDrag(evt) {
  if (!craftSplitDrag.active) return;
  const deltaX = evt.clientX - craftSplitDrag.startX;
  // 向左拖大右侧，向右拖小右侧。
  state.craftRightPanelWidth = clampCraftRightPanelWidth(craftSplitDrag.startWidth - deltaX);
  applyCraftLayoutWidth();
}

function stopCraftSplitDrag() {
  if (!craftSplitDrag.active) return;
  craftSplitDrag.active = false;
  document.body.classList.remove("craft-split-dragging");
  saveCraftUiPrefs();
}

function closeRemarkModal(value = null) {
  if (!ui.remarkModal) return;
  ui.remarkModal.classList.add("hidden");
  const resolver = remarkModalResolver;
  remarkModalResolver = null;
  remarkModalAccount = "";
  if (typeof resolver === "function") {
    resolver(value);
  }
}

function openRemarkModal(username, currentRemark = "") {
  const account = String(username || "").trim();
  const initValue = String(currentRemark || "").trim();
  return new Promise((resolve) => {
    remarkModalResolver = resolve;
    remarkModalAccount = account;
    if (ui.remarkModalTitle) ui.remarkModalTitle.textContent = `修改备注名：${account}`;
    if (ui.remarkModalInput) ui.remarkModalInput.value = initValue;
    ui.remarkModal.classList.remove("hidden");
    requestAnimationFrame(() => {
      if (ui.remarkModalInput) {
        ui.remarkModalInput.focus();
        ui.remarkModalInput.select();
      }
    });
  });
}

function closeConfirmModal(value = false) {
  if (!ui.confirmModal) return;
  ui.confirmModal.classList.add("hidden");
  const resolver = confirmModalResolver;
  confirmModalResolver = null;
  if (typeof resolver === "function") {
    resolver(!!value);
  }
}

function openConfirmModal({title = "请确认操作", message = "确认继续吗？", confirmText = "确认", cancelText = "取消"} = {}) {
  if (!ui.confirmModal) return Promise.resolve(false);
  return new Promise((resolve) => {
    confirmModalResolver = resolve;
    if (ui.confirmModalTitle) ui.confirmModalTitle.textContent = String(title || "").trim() || "请确认操作";
    if (ui.confirmModalMessage) ui.confirmModalMessage.textContent = String(message || "").trim() || "确认继续吗？";
    if (ui.confirmModalConfirmBtn) ui.confirmModalConfirmBtn.textContent = String(confirmText || "").trim() || "确认";
    if (ui.confirmModalCancelBtn) ui.confirmModalCancelBtn.textContent = String(cancelText || "").trim() || "取消";
    ui.confirmModal.classList.remove("hidden");
    requestAnimationFrame(() => {
      if (ui.confirmModalCancelBtn) ui.confirmModalCancelBtn.focus();
    });
  });
}

function resolveCraftAssistPresetModalOptions(options = {}) {
  return {
    title: String(options.title || "保存辅助配置").trim() || "保存辅助配置",
    confirmText: String(options.confirmText || "保存配置").trim() || "保存配置",
    placeholder: String(options.placeholder || "请输入配置名称").trim() || "请输入配置名称",
    emptyMessage: String(options.emptyMessage || "请先输入配置名称").trim() || "请先输入配置名称",
    onEmpty: typeof options.onEmpty === "function" ? options.onEmpty : null
  };
}
function applyCraftAssistPresetModalOptions(options = {}) {
  const nextOptions = resolveCraftAssistPresetModalOptions(options);
  craftAssistPresetModalOptions = nextOptions;
  if (ui.craftAssistPresetModalTitle) ui.craftAssistPresetModalTitle.textContent = nextOptions.title;
  if (ui.craftAssistPresetModalSaveBtn) ui.craftAssistPresetModalSaveBtn.textContent = nextOptions.confirmText;
  if (ui.craftAssistPresetModalInput) ui.craftAssistPresetModalInput.placeholder = nextOptions.placeholder;
  return nextOptions;
}
function closeCraftAssistPresetModal(value = null) {
  if (!ui.craftAssistPresetModal) return;
  ui.craftAssistPresetModal.classList.add("hidden");
  const resolver = craftAssistPresetModalResolver;
  craftAssistPresetModalResolver = null;
  applyCraftAssistPresetModalOptions();
  if (typeof resolver === "function") {
    resolver(value);
  }
}

function openCraftAssistPresetModal(initialName = "", options = {}) {
  const initValue = String(initialName || "").trim();
  applyCraftAssistPresetModalOptions(options);
  if (!ui.craftAssistPresetModal) return Promise.resolve(initValue || null);
  return new Promise((resolve) => {
    craftAssistPresetModalResolver = resolve;
    if (ui.craftAssistPresetModalInput) ui.craftAssistPresetModalInput.value = initValue;
    ui.craftAssistPresetModal.classList.remove("hidden");
    requestAnimationFrame(() => {
      if (ui.craftAssistPresetModalInput) {
        ui.craftAssistPresetModalInput.focus();
        ui.craftAssistPresetModalInput.select();
      }
    });
  });
}

function actionText(action) {
  return String(action || "").trim() === "withdraw" ? "取出" : "存入";
}

function queueLabel(job) {
  if (!job) return "";
  const name = actionText(job.action);
  const account = String(job.username || "").trim();
  const component = String(job.component_id || "").trim();
  const requested = Math.max(0, Number(job.requested || 0) || 0);
  const position = Math.max(0, Number(job.queue_position || 0) || 0);
  return `#${position} ${name} ${requested}件 @${account} -> ${component}`;
}

function applyTaskQueueSnapshot(snapshot) {
  const queued = Array.isArray(snapshot && snapshot.queued) ? snapshot.queued : [];
  const running = snapshot && snapshot.running ? snapshot.running : null;
  state.componentTaskQueue = {running, queued};
  const activeJobIds = new Set();
  if (running && running.job_id) activeJobIds.add(String(running.job_id).trim());
  for (const job of queued) {
    const jobId = String(job && job.job_id || "").trim();
    if (jobId) activeJobIds.add(jobId);
  }
  for (const jobId of Object.keys(state.componentTaskProgressMap || {})) {
    if (!activeJobIds.has(jobId)) delete state.componentTaskProgressMap[jobId];
  }
  renderTaskQueueControls();
}

function queueForCurrentAccount() {
  const username = String(state.currentAccountUsername || "").trim();
  const queued = Array.isArray(state.componentTaskQueue.queued) ? state.componentTaskQueue.queued : [];
  const running = state.componentTaskQueue.running && String(state.componentTaskQueue.running.username || "").trim() === username
    ? state.componentTaskQueue.running
    : null;
  return {
    running,
    queued: username ? queued.filter((x) => String(x.username || "").trim() === username) : []
  };
}

function renderTaskQueueControls() {
  if (!ui.componentTaskFloat || !ui.componentTaskQueueList || !ui.componentTaskCancelBtn || !ui.componentTaskInfo) return;
  const hasAccount = Boolean(String(state.currentAccountUsername || "").trim());
  const view = queueForCurrentAccount();
  const queued = view.queued;
  const running = view.running;
  const prevSelected = String(state.selectedQueueJobId || "").trim();

  if (prevSelected && queued.some((x) => String(x.job_id || "").trim() === prevSelected)) {
    state.selectedQueueJobId = prevSelected;
  } else {
    state.selectedQueueJobId = "";
  }
  ui.componentTaskCancelBtn.disabled = !hasAccount || !state.selectedQueueJobId;

  ui.componentTaskQueueList.replaceChildren();
  if (!queued.length) {
    const empty = document.createElement("div");
    empty.className = "task-queue-empty";
    empty.textContent = "无排队任务";
    ui.componentTaskQueueList.append(empty);
  } else {
    for (const job of queued) {
      const jobId = String(job.job_id || "").trim();
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `task-queue-item${state.selectedQueueJobId === jobId ? " active" : ""}`;
      btn.textContent = queueLabel(job);
      btn.onclick = () => {
        state.selectedQueueJobId = jobId;
        renderTaskQueueControls();
      };
      ui.componentTaskQueueList.append(btn);
    }
  }

  if (running) {
    const runningId = String(running.job_id || "").trim();
    const progress = runningId ? state.componentTaskProgressMap[runningId] : null;
    const total = Math.max(
      0,
      Number((progress && progress.total) != null ? progress.total : running.requested || 0) || 0
    );
    const processed = Math.max(0, Number(progress && progress.processed != null ? progress.processed : 0) || 0);
    const success = Math.max(0, Number(progress && progress.success != null ? progress.success : 0) || 0);
    const failed = Math.max(0, Number(progress && progress.failed != null ? progress.failed : 0) || 0);
    ui.componentTaskInfo.textContent = `执行中：${actionText(running.action)} ${processed}/${total}（成功${success}，失败${failed}）`;
  } else {
    ui.componentTaskInfo.textContent = "执行中：无";
  }

  ui.componentTaskFloat.classList.toggle("hidden", !running && queued.length <= 0);
}

async function loadComponentTaskQueue({silent = true} = {}) {
  try {
    const username = String(state.currentAccountUsername || "").trim();
    const query = username ? `?username=${encodeURIComponent(username)}` : "";
    const data = await api(`/api/component/tasks${query}`);
    applyTaskQueueSnapshot(data);
  } catch (err) {
    if (!silent) setSummary(`读取任务队列失败：${err.message}`);
  }
}

function stopInventoryEventStream() {
  if (!inventoryEventSource) return;
  try {
    inventoryEventSource.close();
  } catch (_) {
    // ignore close errors
  }
  inventoryEventSource = null;
  inventoryEventUsername = "";
}

function startInventoryEventStream(username) {
  const key = String(username || "").trim();
  if (!key) {
    stopInventoryEventStream();
    return;
  }
  if (inventoryEventSource && inventoryEventUsername === key) return;
  stopInventoryEventStream();
  const stream = new EventSource(`/api/events?username=${encodeURIComponent(key)}`);
  inventoryEventSource = stream;
  inventoryEventUsername = key;

  stream.addEventListener("inventory_refreshed", async (evt) => {
    const data = parseEventData(evt.data);
    const eventUsername = String(data.username || "").trim();
    if (!eventUsername || eventUsername !== state.currentAccountUsername) return;
    const remoteFetchTime = String(data.fetch_time || "").trim();
    if (data.connected === true) state.connectedUsername = eventUsername;
    if (!remoteFetchTime || remoteFetchTime === state.fetchTime) {
      syncInventoryTop();
      return;
    }
    await loadSnapshotForAccount(eventUsername);
    if (data.connected === true) state.connectedUsername = eventUsername;
    syncInventoryTop();
    setSummary(`库存已自动更新：${remoteFetchTime}`);
  });

  stream.addEventListener("inventory_connection_ready", (evt) => {
    const data = parseEventData(evt.data);
    const eventUsername = String(data.username || "").trim();
    if (!eventUsername || eventUsername !== state.currentAccountUsername) return;
    state.connectedUsername = eventUsername;
    clearCraftExecutionOverlayState({owner: "connect_flow"});
    renderSavedAccounts();
    if (state.refreshing) {
      setRefreshPhase("连接状态：已连接（同步中）");
      if (!state.refreshSilentInfo) {
        setSummary("已连接，正在同步库存与组件...");
      }
      return;
    }
    syncInventoryTop();
  });

  stream.addEventListener("inventory_refresh_failed", (evt) => {
    const data = parseEventData(evt.data);
    const eventUsername = String(data.username || "").trim();
    if (!eventUsername || eventUsername !== state.currentAccountUsername) return;
    if (state.connectedUsername === eventUsername) state.connectedUsername = "";
    syncInventoryTop();
    const msg = String(data.message || "未知错误");
    setSummary(`自动刷新失败：${msg}`);
  });

  stream.addEventListener("inventory_display_images_enriched", async (evt) => {
    const data = parseEventData(evt.data);
    const eventUsername = String(data.username || "").trim();
    if (!eventUsername || eventUsername !== state.currentAccountUsername) return;
    await loadSnapshotForAccount(eventUsername);
    syncInventoryTop();
    const ok = Math.max(0, Number(data.image_rows_ok || 0) || 0);
    const failed = Math.max(0, Number(data.image_rows_failed || 0) || 0);
    const targets = Math.max(0, Number(data.target_market_hash_names_count || 0) || 0);
    setSummary(`库存补图已更新：目标${targets}，成功${ok}，失败${failed}`);
  });

  stream.addEventListener("inventory_post_refresh_failed", (evt) => {
    const data = parseEventData(evt.data);
    const eventUsername = String(data.username || "").trim();
    if (!eventUsername || eventUsername !== state.currentAccountUsername) return;
    const msg = String(data.message || "未知错误");
    setSummary(`库存补图失败：${msg}`);
  });

  stream.addEventListener("component_task_queue", (evt) => {
    const data = parseEventData(evt.data);
    applyTaskQueueSnapshot(data);
  });

  stream.addEventListener("component_move_progress", (evt) => {
    const data = parseEventData(evt.data);
    const eventUsername = String(data.username || data.account || "").trim();
    if (!eventUsername || eventUsername !== state.currentAccountUsername) return;
    const jobId = String(data.job_id || "").trim();
    const action = String(data.action || "").trim() === "withdraw" ? "取出" : "存入";
    const processed = Math.max(0, Number(data.processed || 0) || 0);
    const total = Math.max(0, Number(data.total || 0) || 0);
    const success = Math.max(0, Number(data.success || 0) || 0);
    const failed = Math.max(0, Number(data.failed || 0) || 0);
    if (jobId) {
      state.componentTaskProgressMap[jobId] = {
        processed,
        total,
        success,
        failed,
        action: String(data.action || "").trim() === "withdraw" ? "withdraw" : "deposit",
        phase: String(data.phase || "").trim()
      };
    }
    renderTaskQueueControls();
    if (String(data.phase || "").trim() === "start") {
      setSummary(`组件${action}开始：0/${total}`);
      return;
    }
    setSummary(`组件${action}进度：${processed}/${total}（成功${success}，失败${failed}）`);
  });

  stream.addEventListener("component_move_done", async (evt) => {
    const data = parseEventData(evt.data);
    const eventUsername = String(data.username || data.account || "").trim();
    if (!eventUsername || eventUsername !== state.currentAccountUsername) return;
    const jobId = String(data.job_id || "").trim();
    if (jobId) delete state.componentTaskProgressMap[jobId];
    const action = String(data.action || "").trim() === "withdraw" ? "取出" : "存入";
    const requested = Math.max(0, Number(data.requested || 0) || 0);
    const success = Math.max(0, Number(data.success || 0) || 0);
    const failed = Math.max(0, Number(data.failed || 0) || 0);
    const firstFailedItem = String(data.first_failed_item_id || "").trim();
    const firstFailedReason = String(data.first_failed_reason || "").trim();
    const doneMessage = String(data.message || "").trim();
    const successIds = normalizeItemIdList(data.success_ids);
    let fallbackTriggered = false;
    try {
      const deltaResult = applyComponentMoveDelta({
        action: String(data.action || "").trim(),
        componentId: String(data.component_id || "").trim(),
        successIds,
        successCount: success,
        snapshotPath: String(data.snapshot_path || "").trim(),
        fetchTime: String(data.fetch_time || "").trim()
      });
      if (!deltaResult.ok) {
        fallbackTriggered = await fallbackSnapshotForDirty(eventUsername, deltaResult.reason || "delta_apply_failed");
      } else {
        clearSnapshotDirty();
      }
    } catch (_) {
      fallbackTriggered = await fallbackSnapshotForDirty(eventUsername, "delta_apply_exception");
    }
    try {
      await loadComponentTaskQueue();
    } catch (_) {
      // ignore queue refresh errors in SSE path
    }
    const reconcileTag = fallbackTriggered ? "（已回退校准）" : (state.snapshotDirty ? "（本地脏标，等待校准）" : "");
    if (doneMessage) {
      setSummary(`${doneMessage}${reconcileTag}`);
      return;
    }
    const tail = firstFailedReason ? `，首个失败 ${firstFailedItem || "-"}: ${firstFailedReason}` : "";
    setSummary(`组件${action}完成：${requested}件（成功${success}，失败${failed}）${tail}${reconcileTag}`);
  });

  stream.addEventListener("component_move_failed", async (evt) => {
    const data = parseEventData(evt.data);
    const eventUsername = String(data.username || data.account || "").trim();
    if (!eventUsername || eventUsername !== state.currentAccountUsername) return;
    const jobId = String(data.job_id || "").trim();
    if (jobId) delete state.componentTaskProgressMap[jobId];
    const action = String(data.action || "").trim() === "withdraw" ? "取出" : "存入";
    const msg = String(data.message || "未知错误");
    let fallbackTriggered = false;
    fallbackTriggered = await fallbackSnapshotForDirty(eventUsername, "component_move_failed");
    try {
      await loadComponentTaskQueue();
    } catch (_) {
      // ignore queue refresh errors
    }
    const reconcileTag = fallbackTriggered ? "（已回退校准）" : (state.snapshotDirty ? "（本地脏标，等待校准）" : "");
    setSummary(`组件${action}失败：${msg}${reconcileTag}`);
  });

  stream.addEventListener("craft_component_progress", (evt) => {
    const data = parseEventData(evt.data);
    const eventUsername = String(data.username || data.account || "").trim();
    if (!eventUsername || eventUsername !== state.currentAccountUsername) return;
    if (!state.craftBusy || !state.craftProgressEnabled) return;
    applyCraftComponentProgressEvent(data);
  });

  stream.onerror = () => {
    // EventSource has built-in reconnect, keep silent.
  };
}

function ensureErrorToastNode() {
  if (errorToastNode && errorToastTextNode) return;
  const node = document.createElement("div");
  node.id = "globalErrorToast";
  node.className = "error-toast";
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "assertive");
  node.setAttribute("aria-atomic", "true");
  const icon = document.createElement("span");
  icon.className = "error-toast-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "X";
  const text = document.createElement("span");
  text.className = "error-toast-text";
  node.append(icon, text);
  document.body.append(node);
  errorToastNode = node;
  errorToastTextNode = text;
}
function showErrorToast(message) {
  const msg = String(message || "").trim();
  if (!msg) return;
  const now = Date.now();
  if (msg === lastErrorToastText && now - lastErrorToastTs < 900) return;
  lastErrorToastText = msg;
  lastErrorToastTs = now;
  ensureErrorToastNode();
  if (!errorToastNode || !errorToastTextNode) return;
  errorToastTextNode.textContent = `错误：${msg}`;
  errorToastNode.classList.remove("show");
  // Force reflow so same message can replay animation.
  void errorToastNode.offsetWidth;
  errorToastNode.classList.add("show");
  if (errorToastHideTimer != null) {
    clearTimeout(errorToastHideTimer);
    errorToastHideTimer = null;
  }
  errorToastHideTimer = setTimeout(() => {
    if (errorToastNode) errorToastNode.classList.remove("show");
    errorToastHideTimer = null;
  }, ERROR_TOAST_DURATION_MS);
}
function isSummaryErrorMessage(text) {
  const msg = String(text || "").trim();
  if (!msg) return false;
  // 成功播报里可能包含“失败0”，不应作为错误浮层。
  if (/失败\s*0/.test(msg) || /成功\d+，失败0/.test(msg)) return false;
  const patterns = [
    /^请先/,
    /^请选用/,
    /失败[:：]/,
    /错误/,
    /无法/,
    /不能/,
    /已满/,
    /不足/,
    /不存在/,
    /未连接/,
    /中断/,
    /不满足/,
    /重复/,
    /过于频繁/,
    /空间已满/,
    /暂无可执行/,
    /暂无可用/,
    /无可编辑/
  ];
  return patterns.some((pattern) => pattern.test(msg));
}
function setSummary(text, {isError = null} = {}) {
  const msg = String(text || "");
  if (ui.summaryText) ui.summaryText.textContent = msg;
  const shouldToast = isError == null ? isSummaryErrorMessage(msg) : !!isError;
  if (shouldToast && msg.trim()) showErrorToast(msg);
}
function setAccountStatus(text, isError = false) {
  const msg = String(text || "");
  ui.accountStatus.textContent = msg;
  ui.accountStatus.classList.toggle("error", !!isError);
  if (isError && msg.trim()) showErrorToast(msg);
}
function formatLoginSaveError(err) {
  const payload = err && err.data && typeof err.data === "object" ? err.data : null;
  const reason = String(payload && payload.reason || "").trim();
  const reasonMessageMap = {
    auth_api_unreachable: "登录失败：无法连接 Steam 认证服务器，请检查网络或代理配置后重试",
    invalid_password: "登录失败：账号或密码错误，请确认后重试",
    totp_mismatch: "登录失败：令牌码错误，请输入当前有效的令牌码（会自动转为大写）",
    email_code_mismatch: "登录失败：验证码错误，请输入最新的邮箱验证码或令牌码",
    rate_limited: "登录失败：请求过于频繁，请稍后再试",
    access_denied: "登录失败：被 Steam 拒绝，请先在官方客户端完成一次登录确认",
    login_timeout: "登录失败：登录超时，请在 Steam 客户端确认后重试",
    device_confirmation_required: "登录失败：需要在 Steam 手机端确认本次登录",
    totp_required: "登录失败：缺少令牌码，请输入后重试",
    additional_auth_required: "登录失败：需要额外验证，请先在 Steam 客户端完成验证",
    refresh_token_missing: "登录失败：已通过账号校验，但未获取到 refresh_token，请稍后重试"
  };
  if (reason && reasonMessageMap[reason]) {
    return reasonMessageMap[reason];
  }
  const msg = String(payload && payload.message || (err && err.message) || "").trim();
  if (!msg) {
    return "登录失败：未知错误，请稍后重试";
  }
  return /^登录失败[:：]/.test(msg) ? msg : `登录失败：${msg}`;
}
function setRefreshPhase(text) { state.refreshPhaseText = String(text || "").trim(); syncInventoryTop(); }
function clearRefreshPhase() { state.refreshPhaseText = ""; syncInventoryTop(); }
const selectedAccount = () => state.accounts.find((x) => x.username === String(state.accountSelectedUsername || "").trim()) || null;
const accountByUsername = (username) => state.accounts.find((x) => x.username === String(username || "").trim()) || null;
function setAccountAuthState(username, {authState = "normal", authReason = ""} = {}) {
  const key = String(username || "").trim();
  if (!key) return;
  const nextAuthState = String(authState || "").trim() || "normal";
  const nextAuthReason = String(authReason || "").trim();
  state.accounts = (Array.isArray(state.accounts) ? state.accounts : []).map((row) => {
    if (String(row && row.username || "").trim() !== key) {
      return row;
    }
    return {
      ...row,
      auth_state: nextAuthState,
      auth_reason: nextAuthReason
    };
  });
  if (state.snapshotCacheByAccount instanceof Map) {
    const cached = state.snapshotCacheByAccount.get(key);
    if (cached && typeof cached === "object") {
      state.snapshotCacheByAccount.set(key, {
        ...cached,
        authState: nextAuthState,
        authReason: nextAuthReason
      });
    }
  }
}
function getAccountAuthState(username) {
  const key = String(username || "").trim();
  if (!key) return "normal";
  const row = accountByUsername(key);
  const rowState = String(row && row.auth_state || "").trim();
  if (rowState) {
    return rowState;
  }
  if (state.snapshotCacheByAccount instanceof Map) {
    const cached = state.snapshotCacheByAccount.get(key);
    const cachedState = String(cached && cached.authState || "").trim();
    if (cachedState) {
      return cachedState;
    }
  }
  return "normal";
}
function getAccountConnectionLabel(username, {connected = false, phaseText = "", currentSnapshot = false} = {}) {
  if (getAccountAuthState(username) === "auth_invalid") {
    return {
      text: "登录失效",
      connected: false
    };
  }
  if (currentSnapshot && phaseText) {
    return {
      text: normalizeTopStatusText(phaseText, false),
      connected: isConnectedPhaseText(phaseText)
    };
  }
  if (connected) {
    return {
      text: "已连接",
      connected: true
    };
  }
  return {
    text: "未连接",
    connected: false
  };
}
function pickAvatarUrlFromProfile(profile) {
  if (!profile || typeof profile !== "object") return "";
  return String(profile.avatar_url_full || profile.avatar_url_medium || profile.avatar_url_icon || "").trim();
}
function mergeAccountIdentity(username, {steamName = "", steamId = "", avatarUrl = "", balance = ""} = {}) {
  const key = String(username || "").trim();
  if (!key) return false;
  const nextSteamName = String(steamName || "").trim();
  const nextSteamId = String(steamId || "").trim();
  const nextAvatarUrl = String(avatarUrl || "").trim();
  const nextBalance = String(balance || "").trim();
  let changed = false;
  state.accounts = state.accounts.map((row) => {
    if (String(row && row.username || "").trim() !== key) return row;
    const currentSteamName = String(row && row.steam_name || "").trim();
    const currentSteamId = String(row && row.steam_id || "").trim();
    const currentAvatarUrl = String(row && row.avatar_url || "").trim();
    const currentBalance = String(row && row.balance || "").trim();
    const mergedSteamName = nextSteamName || currentSteamName;
    const mergedSteamId = nextSteamId || currentSteamId;
    const mergedAvatarUrl = nextAvatarUrl || currentAvatarUrl;
    const mergedBalance = nextBalance || currentBalance;
    if (
      mergedSteamName === currentSteamName &&
      mergedSteamId === currentSteamId &&
      mergedAvatarUrl === currentAvatarUrl &&
      mergedBalance === currentBalance
    ) return row;
    changed = true;
    return {...row, steam_name: mergedSteamName, steam_id: mergedSteamId, avatar_url: mergedAvatarUrl, balance: mergedBalance};
  });
  return changed;
}
async function ensureAccountProfile(username, {force = false} = {}) {
  const key = String(username || "").trim();
  if (!key) return false;
  if (state.profileHydratingUsernames.has(key)) return false;
  const row = accountByUsername(key);
  if (!row) return false;
  const hasSteamName = Boolean(String(row.steam_name || "").trim());
  const hasSteamId = Boolean(String(row.steam_id || "").trim());
  const hasAvatar = Boolean(String(row.avatar_url || "").trim());
  if (!force && state.profileHydratedUsernames.has(key)) return false;
  if (!force && hasSteamName && hasSteamId && hasAvatar) {
    state.profileHydratedUsernames.add(key);
    return false;
  }
  state.profileHydratingUsernames.add(key);
  try {
    const data = await api(`/api/accounts/profile?username=${encodeURIComponent(key)}`);
    const profile = data && data.profile && typeof data.profile === "object" ? data.profile : null;
    const changed = mergeAccountIdentity(key, {
      steamName: String(profile && profile.persona_name || "").trim(),
      steamId: String(profile && profile.steam_id64 || "").trim(),
      avatarUrl: pickAvatarUrlFromProfile(profile),
      balance: String(profile && profile.wallet_balance || "").trim()
    });
    state.profileHydratedUsernames.add(key);
    if (changed) {
      syncInventoryAccountSelect();
      renderSavedAccounts();
    }
    return changed;
  } catch (_) {
    return false;
  } finally {
    state.profileHydratingUsernames.delete(key);
  }
}
async function hydrateAccountsProfileIfNeeded() {
  const targets = state.accounts
    .map((row) => String(row && row.username || "").trim())
    .filter(Boolean)
    .filter((username) => {
      if (state.profileHydratedUsernames.has(username)) return false;
      const row = accountByUsername(username);
      if (!row) return false;
      const hasSteamName = Boolean(String(row.steam_name || "").trim());
      const hasSteamId = Boolean(String(row.steam_id || "").trim());
      const hasAvatar = Boolean(String(row.avatar_url || "").trim());
      return !hasSteamName || !hasSteamId || !hasAvatar;
    });
  for (const username of targets) {
    await ensureAccountProfile(username);
  }
}
function displayAccountName(row) {
  if (!row) return "";
  const username = String(row.username || "").trim();
  const steamName = String(row.steam_name || "").trim();
  const remark = String(row.remark || "").trim();
  const baseName = steamName || username;
  if (!baseName) return "";
  if (!remark || remark === username || remark === steamName || remark === baseName) return baseName;
  return `${baseName}（${remark}）`;
}
function optionAccountLabel(row) {
  return displayAccountName(row);
}
const isCurrentAccountConnected = () => {
  const current = String(state.currentAccountUsername || "").trim();
  if (!current) return false;
  return String(state.connectedUsername || "").trim() === current;
};
const normalizeTopStatusText = (text, fallbackConnected = false) => {
  const raw = String(text || "").trim();
  if (!raw) return fallbackConnected ? "已连接" : "未连接";
  return raw.replace(/^连接状态[:：]?\s*/, "");
};
const isConnectedPhaseText = (text) => {
  const value = String(text || "").trim();
  if (!value) return false;
  if (value.includes("未连接")) return false;
  return value.includes("已连接");
};
function setConnectionStatusTone(el, connected) {
  if (!el) return;
  const isConnected = !!connected;
  el.classList.toggle("status-connected", isConnected);
  el.classList.toggle("status-disconnected", !isConnected);
}

function syncAccountPageSummary() {
  if (!ui.accountPageSummaryText) return;
  if (isGuestWorkspaceActive()) {
    ui.accountPageSummaryText.textContent = "访客预览态：登录后可管理真实账号";
    return;
  }
  const count = Array.isArray(state.accounts) ? state.accounts.length : 0;
  if (!count) {
    ui.accountPageSummaryText.textContent = "尚未保存账号";
    return;
  }
  const current = accountByUsername(state.accountSelectedUsername || state.currentAccountUsername || state.activeAccount);
  const currentLabel = current ? (displayAccountName(current) || current.username) : "未选择账号";
  ui.accountPageSummaryText.textContent = `已保存 ${count} 个账号 · 当前：${currentLabel}`;
}

function syncInventoryTop() {
  const applyTop = (fetchEl, statusEl, refreshBtn, disconnectBtn, currentUsername = state.currentAccountUsername) => {
    if (!fetchEl || !statusEl || !refreshBtn) return;
    const current = String(currentUsername || "").trim();
    if (isGuestWorkspaceActive()) {
      fetchEl.textContent = "库存获取时间：-";
      statusEl.textContent = "未登录";
      setConnectionStatusTone(statusEl, false);
      statusEl.classList.remove("status-clickable");
      statusEl.title = "";
      refreshBtn.textContent = "连接并刷新库存信息";
      if (disconnectBtn) disconnectBtn.disabled = false;
      return;
    }
    if (!current) {
      fetchEl.textContent = "库存获取时间：-";
      statusEl.textContent = "未连接";
      setConnectionStatusTone(statusEl, false);
      statusEl.classList.remove("status-clickable");
      statusEl.title = "";
      refreshBtn.textContent = "连接并刷新库存信息";
      if (disconnectBtn) disconnectBtn.disabled = true;
      return;
    }
    const isCurrentSnapshot = current === String(state.currentAccountUsername || "").trim();
    fetchEl.textContent = `库存获取时间：${isCurrentSnapshot ? (state.fetchTime || "-") : "-"}`;
    const presentation = getAccountConnectionLabel(current, {
      connected: String(state.connectedUsername || "").trim() === current,
      phaseText: state.refreshPhaseText,
      currentSnapshot: isCurrentSnapshot
    });
    statusEl.textContent = presentation.text;
    const connected = presentation.connected;
    setConnectionStatusTone(statusEl, connected);
    const clickable = !state.refreshing && !connected;
    statusEl.classList.toggle("status-clickable", clickable);
    statusEl.title = clickable ? "点击连接并刷新库存" : "";
    refreshBtn.textContent = connected ? "刷新库存信息" : "连接并刷新库存信息";
    if (disconnectBtn) disconnectBtn.disabled = state.refreshing || !connected;
  };

  const accountPageKey = String((ui.accountPageSelect && ui.accountPageSelect.value) || "").trim();
  if (!state.currentAccountUsername) {
    applyTop(ui.accountPageFetchTimeText, ui.accountPageStatusText, ui.accountPageRefreshBtn, ui.accountPageDisconnectBtn, accountPageKey);
    applyTop(ui.fetchTimeText, ui.statusText, ui.refreshBtn, ui.disconnectBtn);
    applyTop(ui.craftTopFetchTimeText, ui.craftTopStatusText, ui.craftRefreshBtn, ui.craftDisconnectBtn);
    syncAccountPageSummary();
    return;
  }
  applyTop(ui.accountPageFetchTimeText, ui.accountPageStatusText, ui.accountPageRefreshBtn, ui.accountPageDisconnectBtn, accountPageKey);
  applyTop(ui.fetchTimeText, ui.statusText, ui.refreshBtn, ui.disconnectBtn);
  applyTop(ui.craftTopFetchTimeText, ui.craftTopStatusText, ui.craftRefreshBtn, ui.craftDisconnectBtn);
  syncAccountPageSummary();
}

function setAccountForm({username = "", password = "", totp = "", remark = ""} = {}) {
  ui.accountUsername.value = username;
  ui.accountPassword.value = password;
  ui.accountTotp.value = normalizeTotpCode(totp);
  ui.accountRemark.value = remark;
  state.accountPasswordVisible = false;
  syncAccountPasswordVisibility();
}

function syncAccountPasswordVisibility() {
  if (ui.accountPassword) {
    ui.accountPassword.type = state.accountPasswordVisible ? "text" : "password";
  }
  if (ui.accountPasswordToggle) {
    const visible = !!state.accountPasswordVisible;
    ui.accountPasswordToggle.classList.toggle("is-visible", visible);
    ui.accountPasswordToggle.setAttribute("aria-pressed", visible ? "true" : "false");
    ui.accountPasswordToggle.setAttribute("aria-label", visible ? "隐藏密码" : "显示密码");
    ui.accountPasswordToggle.title = visible ? "隐藏密码" : "显示密码";
  }
}

function normalizeTotpCode(value) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, "")
    .toUpperCase();
}

function normalizeAccountTotpInput() {
  if (!ui.accountTotp) return "";
  const next = normalizeTotpCode(ui.accountTotp.value);
  if (ui.accountTotp.value !== next) {
    ui.accountTotp.value = next;
  }
  return next;
}

function bindAccountTotpNormalization() {
  if (!ui.accountTotp) return;
  const apply = () => {
    normalizeAccountTotpInput();
  };
  ["input", "change", "blur", "keyup"].forEach((eventName) => {
    ui.accountTotp.addEventListener(eventName, apply);
  });
  ui.accountTotp.addEventListener("paste", () => {
    setTimeout(apply, 0);
  });
}

function clearAccountInputs({focusUsername = false} = {}) {
  state.accountLoginMode = "add";
  state.pendingRelogin = null;
  if (state.pendingGuard) {
    state.pendingGuard = null;
    resetGuardHintUI();
  }
  setAccountForm({username: "", password: "", totp: "", remark: ""});
  ensureAccountFormEditable({focusUsername});
}

function syncAccountLoginActionState() {
  const busy = !!state.accountLoginBusy;
  const refreshing = !!state.refreshing;
  if (ui.loginSaveBtn) ui.loginSaveBtn.disabled = busy || refreshing;
  if (ui.clearAccountBtn) ui.clearAccountBtn.disabled = busy;
  if (ui.accountLoginModalClose) ui.accountLoginModalClose.disabled = busy;
  if (ui.accountPasswordToggle) ui.accountPasswordToggle.disabled = busy;
  if (ui.accountLoginModal && typeof ui.accountLoginModal.setAttribute === "function") {
    ui.accountLoginModal.setAttribute("aria-busy", busy ? "true" : "false");
  }
}

function setAccountLoginBusy(busy) {
  state.accountLoginBusy = !!busy;
  syncAccountLoginActionState();
}

function ensureAccountFormEditable({focusUsername = false, focusGuard = false} = {}) {
  const reloginMode = String(state.accountLoginMode || "").trim() === "relogin";
  const fields = [ui.accountUsername, ui.accountPassword, ui.accountTotp, ui.accountRemark];
  for (const field of fields) {
    if (!field) continue;
    field.disabled = false;
    field.readOnly = false;
    if (field.classList && typeof field.classList.toggle === "function") {
      field.classList.toggle("is-locked", false);
    }
  }
  if (ui.accountUsername) {
    ui.accountUsername.readOnly = reloginMode;
    if (ui.accountUsername.classList && typeof ui.accountUsername.classList.toggle === "function") {
      ui.accountUsername.classList.toggle("is-locked", reloginMode);
    }
    if (typeof ui.accountUsername.setAttribute === "function") {
      ui.accountUsername.setAttribute("aria-readonly", reloginMode ? "true" : "false");
    }
  }
  if (ui.accountRemark) {
    ui.accountRemark.disabled = reloginMode;
    ui.accountRemark.readOnly = reloginMode;
  }
  if (ui.accountLoginModalTitle) {
    ui.accountLoginModalTitle.textContent = reloginMode ? "重新登录" : "添加账号";
  }
  if (ui.accountLoginHint) {
    ui.accountLoginHint.textContent = reloginMode
      ? "为当前账号重新登录并获取新的 loginKey"
      : "使用 Steam 账号登录并保存到当前客户端";
  }
  if (ui.loginSaveBtn) {
    ui.loginSaveBtn.textContent = reloginMode ? "重新登录" : "登录并保存";
  }
  syncAccountLoginActionState();
  const modalVisible = !ui.accountLoginModal || !ui.accountLoginModal.classList.contains("hidden");
  if (focusGuard && modalVisible && ui.accountTotp && typeof ui.accountTotp.focus === "function") {
    ui.accountTotp.focus();
    return;
  }
  if (focusUsername && modalVisible && ui.accountUsername && typeof ui.accountUsername.focus === "function") {
    ui.accountUsername.focus();
  }
}

function openAccountLoginModal({focusUsername = false, focusGuard = false} = {}) {
  if (!ui.accountLoginModal) return;
  ui.accountLoginModal.classList.remove("hidden");
  ensureAccountFormEditable({focusUsername, focusGuard});
}

function openAccountReloginModal({username = "", password = "", reason = ""} = {}) {
  state.accountLoginMode = "relogin";
  state.pendingRelogin = {
    username: String(username || "").trim(),
    reason: String(reason || "").trim()
  };
  setAccountForm({username, password, totp: "", remark: ""});
  openAccountLoginModal({focusGuard: true});
}

function closeAccountLoginModal() {
  if (!ui.accountLoginModal) return;
  ui.accountLoginModal.classList.add("hidden");
  syncAccountLoginActionState();
}

function setAccountLoginOverlayStage({percent = 0, title = "正在登录账号", detail = ""} = {}) {
  if (typeof setCraftExecutionOverlayState !== "function") return true;
  return setCraftExecutionOverlayState({
    owner: "login_flow",
    enabled: true,
    visible: true,
    mode: "connecting",
    percent,
    title,
    detail
  });
}

function clearAccountLoginOverlay() {
  if (typeof clearCraftExecutionOverlayState !== "function") return true;
  return clearCraftExecutionOverlayState({owner: "login_flow"});
}

function handlePostLoginRefreshResult(username, result = null) {
  if (!result || !result.reloginRequired) return result;
  const reason = String(result.reason || "").trim();
  const authState = String(result.authState || "").trim() || (reason === "login_key_invalid" ? "auth_invalid" : "login_required");
  const message = reason === "login_key_invalid"
    ? "登录失效，请重新登录后再刷新"
    : (reason === "login_key_missing"
      ? "当前账号缺少 loginKey，请重新登录后再刷新"
      : String(result.message || "").trim());
  if (typeof setAccountAuthState === "function") {
    setAccountAuthState(username, {
      authState,
      authReason: reason
    });
  }
  if (message && typeof setSummary === "function") {
    setSummary(message);
  }
  return result;
}

function syncAccountFormBySelection() {
  // 登录表单始终保持空白，避免自动回填账号密码。
  setAccountForm({username: "", password: "", totp: "", remark: ""});
}

function showPage(pageId) {
  state.currentPage = pageId;
  if (ui.navShell && ui.navShell.contains(document.activeElement) && typeof document.activeElement.blur === "function") {
    document.activeElement.blur();
  }
  for (const [id, btn] of [["accountPage", ui.navAccount], ["inventoryPage", ui.navInventory], ["craftPage", ui.navCraft], ["simulationPage", ui.navSimulation], ["batchCraftPage", ui.navBatchCraft], ["webInventoryPage", ui.navWebInventory]]) {
    const active = id === pageId;
    document.getElementById(id).classList.toggle("hidden", !active);
    if (btn) {
      btn.classList.toggle("active", active);
    }
  }
  setNavDrawerOpen(false);
  if (pageId === "accountPage") renderSavedAccounts();
  if (pageId === "inventoryPage") render();
  if (pageId === "craftPage") {
    applyCraftLayoutWidth();
    renderCraftPage();
  }
  if (pageId === "simulationPage") {
    if (state.simulationViewMode === "workspace" && !state.simulationWorkspacePreset) {
      openBlankTradeupSimulationWorkspaceDraft();
    }
    renderSimulationPage();
  }
  if (pageId === "batchCraftPage") {
    applyBatchCraftPresetWidth();
    renderBatchCraftPage();
    void ensureBatchCraftAccountsCached();
  }
  if (pageId === "webInventoryPage") {
    renderWebInvAccountList();
  }
  /* 全局产物预测面板：仅在炼金汰换 / 多账号汰换页可见 */
  const predictorPages = new Set(["craftPage", "batchCraftPage"]);
  const stageEl = document.getElementById("craftPredictorStage");
  if (stageEl) {
    stageEl.style.display = predictorPages.has(pageId) ? "" : "none";
  }
  if (!predictorPages.has(pageId) && state.craftPredictorOpen) {
    setCraftPredictorPanelOpen(false);
  }
}
function syncNavDrawerDom() {
  if (ui.navShell) ui.navShell.classList.toggle("nav-open", !!state.navDrawerOpen);
  if (ui.navRailTrigger) ui.navRailTrigger.setAttribute("aria-expanded", state.navDrawerOpen ? "true" : "false");
}
function setNavDrawerOpen(open) {
  state.navDrawerOpen = !!open;
  syncNavDrawerDom();
}

function syncInventoryAccountSelect() {
  const selects = [ui.accountPageSelect, ui.accountSelect, ui.craftAccountSelect].filter(Boolean);
  if (isGuestWorkspaceActive()) {
    for (const selectEl of selects) {
      selectEl.replaceChildren();
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "请先登录";
      selectEl.append(option);
      selectEl.value = "";
      selectEl.disabled = true;
    }
    ui.refreshBtn.disabled = false;
    if (ui.craftRefreshBtn) ui.craftRefreshBtn.disabled = false;
    if (ui.disconnectBtn) ui.disconnectBtn.disabled = false;
    if (ui.craftDisconnectBtn) ui.craftDisconnectBtn.disabled = false;
    if (ui.accountPageRefreshBtn) ui.accountPageRefreshBtn.disabled = false;
    if (ui.accountPageDisconnectBtn) ui.accountPageDisconnectBtn.disabled = false;
    syncAccountPageSummary();
    syncInventoryTop();
    return;
  }
  for (const selectEl of selects) {
    selectEl.replaceChildren();
    if (selectEl === ui.accountPageSelect) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "选择账号";
      selectEl.append(placeholder);
    }
    for (const row of state.accounts) {
      const o = document.createElement("option");
      o.value = row.username;
      o.textContent = optionAccountLabel(row);
      selectEl.append(o);
    }
    if (state.accountSelectedUsername) selectEl.value = state.accountSelectedUsername;
    else if (selectEl !== ui.accountPageSelect && state.activeAccount) selectEl.value = state.activeAccount;
    else selectEl.value = "";
  }
  const hasAccount = state.accounts.length > 0;
  ui.refreshBtn.disabled = !hasAccount || state.refreshing;
  if (ui.craftRefreshBtn) ui.craftRefreshBtn.disabled = !hasAccount || state.refreshing;
  if (ui.accountPageRefreshBtn) ui.accountPageRefreshBtn.disabled = !hasAccount || state.refreshing;
  if (ui.accountPageDisconnectBtn) ui.accountPageDisconnectBtn.disabled = state.refreshing || !isCurrentAccountConnected();
  syncAccountPageSummary();
  syncInventoryTop();
}
function renderSavedAccounts() {
  ui.savedAccountsWrap.replaceChildren();
  syncAccountPageSummary();
  if (isGuestWorkspaceActive()) {
    const cards = guestPreviewProvider && typeof guestPreviewProvider.getGuestAccountCards === "function"
      ? guestPreviewProvider.getGuestAccountCards()
      : [];
    if (!cards.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "登录后可保存 Steam 账号并绑定到当前客户端身份。";
      ui.savedAccountsWrap.append(empty);
      return;
    }
    for (const row of cards) {
      const card = document.createElement("div");
      card.className = "account-card";
      const main = document.createElement("div");
      main.className = "account-card-main";
      const avatar = document.createElement("div");
      avatar.className = "account-card-avatar";
      const fallback = document.createElement("span");
      fallback.className = "account-card-avatar-fallback";
      fallback.textContent = String(row && (row.remark || row.username || "示") || "示").slice(0, 1).toUpperCase();
      avatar.append(fallback);
      const info = document.createElement("div");
      info.className = "account-card-info";
      const title = document.createElement("div");
      title.className = "account-card-title";
      title.textContent = String(row && (row.remark || row.username) || "示例账号").trim();
      const sub = document.createElement("div");
      sub.className = "account-card-sub";
      sub.textContent = `账号：${String(row && row.username || "").trim() || "-"}`;
      const note = document.createElement("div");
      note.className = "account-card-sub";
      note.textContent = String(row && row.note || "").trim() || "登录后可保存真实 Steam 账号。";
      const side = document.createElement("div");
      side.className = "account-card-side";
      const badge = document.createElement("span");
      badge.className = "account-card-state status status-disconnected";
      badge.textContent = String(row && row.status || "示例").trim() || "示例";
      const actions = document.createElement("div");
      actions.className = "account-card-actions";
      const loginBtn = document.createElement("button");
      loginBtn.textContent = "登录后启用";
      loginBtn.onclick = (evt) => {
        evt.stopPropagation();
        openClientAuthModal({
          title: "登录后可保存 Steam 账号",
          hint: "当前为访客预览态，登录后可保存 Steam 账号并绑定到当前客户端身份。",
          view: "login"
        });
      };
      actions.append(loginBtn);
      info.append(title, sub, note, actions);
      side.append(badge);
      main.append(avatar, info, side);
      card.append(main);
      card.onclick = () => {
        openClientAuthModal({
          title: "登录后可保存 Steam 账号",
          hint: "当前为访客预览态，登录后可保存 Steam 账号并绑定到当前客户端身份。",
          view: "login"
        });
      };
      ui.savedAccountsWrap.append(card);
    }
    return;
  }
  const rows = [...state.accounts].sort((a, b) => {
    if (a.username === state.activeAccount && b.username !== state.activeAccount) return -1;
    if (b.username === state.activeAccount && a.username !== state.activeAccount) return 1;
    return String(a.remark || "").localeCompare(String(b.remark || ""));
  });
  if (!rows.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "暂无已保存账号";
    ui.savedAccountsWrap.append(e);
    return;
  }

  for (const row of rows) {
    const selected = row.username === state.accountSelectedUsername;
    const connected = row.username === state.connectedUsername;
    const accountName = String(row.username || "").trim();
    const displayName = displayAccountName(row) || accountName || "-";
    const avatarUrl = String(row.avatar_url || "").trim();
    const badgePresentation = getAccountConnectionLabel(row.username, {connected});
    const card = document.createElement("div");
    card.className = `account-card${connected ? " connected" : ""}${selected ? " selected" : ""}`;
    const main = document.createElement("div");
    main.className = "account-card-main";
    const avatar = document.createElement("div");
    avatar.className = "account-card-avatar";
    const applyAvatarFallback = () => {
      const fallback = document.createElement("span");
      fallback.className = "account-card-avatar-fallback";
      fallback.textContent = (displayName || accountName || "?").slice(0, 1).toUpperCase();
      avatar.replaceChildren(fallback);
    };
    if (avatarUrl) {
      const img = document.createElement("img");
      img.src = avatarUrl;
      img.alt = `${displayName} avatar`;
      img.loading = "lazy";
      img.onerror = applyAvatarFallback;
      avatar.append(img);
    } else {
      applyAvatarFallback();
    }
    const info = document.createElement("div");
    info.className = "account-card-info";
    const title = document.createElement("div");
    title.className = "account-card-title";
    title.textContent = displayName;
    const side = document.createElement("div");
    side.className = "account-card-side";
    const stateBadge = document.createElement("span");
    stateBadge.className = `account-card-state status ${badgePresentation.connected ? "status-connected" : "status-disconnected"}`;
    stateBadge.textContent = badgePresentation.text;
    if (!badgePresentation.connected && !state.refreshing) {
      stateBadge.classList.add("status-clickable");
      stateBadge.title = "点击连接并刷新库存";
      stateBadge.onclick = async (e) => {
        e.stopPropagation();
        try {
          await connectByStatusBadge({
            preferCraft: false,
            usernameOverride: row.username
          });
        } catch (err) {
          setAccountStatus(`连接失败：${err.message}`, true);
        }
      };
    }
    side.append(stateBadge);
    const actions = document.createElement("div");
    actions.className = "account-card-actions";

    const remarkBtn = document.createElement("button");
    remarkBtn.textContent = "修改备注";
    remarkBtn.disabled = state.refreshing;
    remarkBtn.onclick = async (e) => {
      e.stopPropagation();
      const next = await openRemarkModal(row.username, row.remark || "");
      if (next === null) return;
      const remark = String(next || "").trim();
      try {
        await api("/api/accounts/remark", {method: "POST", body: JSON.stringify({username: row.username, remark})});
        await loadAccounts({preferUsername: row.username});
        if (String(state.accountSelectedUsername || "").trim() === row.username) {
          ui.accountRemark.value = remark;
        }
        setAccountStatus("备注已更新");
      } catch (err) {
        setAccountStatus(`备注更新失败：${err.message}`, true);
      }
    };

    const delBtn = document.createElement("button");
    delBtn.className = "btn-danger";
    delBtn.textContent = "删除";
    delBtn.disabled = state.refreshing;
    delBtn.onclick = async (e) => { e.stopPropagation(); await deleteAccount(row); };

    const webInvBtn = document.createElement("button");
    webInvBtn.textContent = "Web库存";
    webInvBtn.title = "查看 Web 库存（可选择物品转移）";
    webInvBtn.onclick = (e) => { e.stopPropagation(); showPage("webInventoryPage"); webInvSelectAccount(row.username); };

    const tokenBtn = document.createElement("button");
    tokenBtn.textContent = "令牌详情";
    tokenBtn.title = "查看 Steam Guard 令牌信息";
    tokenBtn.style.display = row.mafile_content ? "" : "none";
    tokenBtn.onclick = (e) => { e.stopPropagation(); openTokenDetailModal(row.username); };

    actions.append(remarkBtn, tokenBtn, webInvBtn, delBtn);
    const sub = document.createElement("div");
    sub.className = "account-card-sub";
    const balanceText = String(row.balance || "").trim();
    sub.textContent = balanceText
      ? `账号：${accountName || "-"} · 余额：${balanceText}`
      : `账号：${accountName || "-"}`;
    card.onclick = () => {
      state.accountSelectedUsername = row.username;
      syncInventoryAccountSelect();
      syncAccountFormBySelection();
      setAccountStatus(`已选中账号：${displayAccountName(row) || row.username}`);
      syncAccountPageSummary();
      renderSavedAccounts();
    };
    info.append(title, sub, actions);
    main.append(avatar, info, side);
    card.append(main);
    ui.savedAccountsWrap.append(card);
  }
}

async function persistLastSelected(username) {
  const key = String(username || "").trim();
  if (!key) return;
  if (state.lastPersistedSelected === key) return;
  try {
    await api("/api/ui-state/last-selected", {method: "POST", body: JSON.stringify({username: key})});
    state.lastPersistedSelected = key;
  } catch (_) {}
}

async function loadAccounts({preferUsername = ""} = {}) {
  const data = await api("/api/accounts");
  state.accounts = data.accounts || [];
  state.activeAccount = data.active ? data.active.username : "";
  const lastSelected = String(data.last_selected_username || "").trim();
  if (lastSelected) state.lastPersistedSelected = lastSelected;
  const available = new Set(state.accounts.map((x) => x.username));
  const target = [String(preferUsername || "").trim(), String(state.accountSelectedUsername || "").trim(), lastSelected, state.activeAccount, state.accounts[0] ? state.accounts[0].username : ""].find((x) => x && available.has(x)) || "";
  state.accountSelectedUsername = target;
  syncInventoryAccountSelect();
  syncAccountFormBySelection();
  renderSavedAccounts();
  void hydrateAccountsProfileIfNeeded();
}

function makeCollectionSourceKey() {
  return `${state.rowsVersion}|${String(state.selectedComponentId || "").trim()}`;
}

function makeRowsStamp(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const size = list.length;
  if (!size) return "0";
  const first = list[0];
  const middle = list[Math.floor(size / 2)];
  const last = list[size - 1];
  return `${size}:${assetIdNumber(first)}:${assetIdNumber(middle)}:${assetIdNumber(last)}`;
}

function makeFilterCacheKey() {
  const rarityKey = [...state.raritySelected].sort((a, b) => String(a).localeCompare(String(b))).join("|");
  const collectionKey = [...state.collectionSelected].sort((a, b) => String(a).localeCompare(String(b))).join("|");
  return [
    state.rowsVersion,
    String(state.selectedComponentId || "").trim(),
    0,
    String(state.searchText || "").trim().toLowerCase(),
    state.wearMin == null ? "" : state.wearMin,
    state.wearMax == null ? "" : state.wearMax,
    state.wearSort,
    state.raritySort,
    rarityKey,
    collectionKey
  ].join("#");
}

function getFilterResult() {
  const key = makeFilterCacheKey();
  if (key === state.filterCacheKey) {
    return {allRows: state.filterCacheAllRows, filteredRows: state.filterCacheFilteredRows, filterKey: key};
  }
  const result = applyFilter();
  state.filterCacheKey = key;
  state.filterCacheAllRows = result.allRows;
  state.filterCacheFilteredRows = result.filteredRows;
  state.groupCacheKey = "";
  state.groupCacheRows = [];
  return {allRows: result.allRows, filteredRows: result.filteredRows, filterKey: key};
}

function getGroupedRows(filteredRows, filterKey) {
  const key = `${filterKey}|${state.wearSort}|${state.raritySort}|${state.quantitySort}|${state.collectionSort}|${makeRowsStamp(filteredRows)}`;
  if (key === state.groupCacheKey) return state.groupCacheRows;
  const rows = buildGroupRows(filteredRows);
  state.groupCacheKey = key;
  state.groupCacheRows = rows;
  return rows;
}

function backfillRowImages(newRows, oldRows) {
  if (!Array.isArray(newRows) || !newRows.length || !Array.isArray(oldRows) || !oldRows.length) return;
  const IMAGE_FIELDS = ["goods_icon_url", "goods_original_icon_url", "goods_share_thumbnail_url"];
  const oldImageMap = new Map();
  for (const old of oldRows) {
    const mh = String(old.market_hash_name || "").trim();
    if (!mh) continue;
    const hasImage = IMAGE_FIELDS.some((f) => normalizeSkinImageUrl(old[f]));
    if (hasImage && !oldImageMap.has(mh)) oldImageMap.set(mh, old);
  }
  if (!oldImageMap.size) return;
  for (const row of newRows) {
    const mh = String(row.market_hash_name || "").trim();
    if (!mh) continue;
    const hasNewImage = IMAGE_FIELDS.some((f) => normalizeSkinImageUrl(row[f]));
    if (hasNewImage) continue;
    const donor = oldImageMap.get(mh);
    if (!donor) continue;
    for (const f of IMAGE_FIELDS) {
      const donorUrl = normalizeSkinImageUrl(donor[f]);
      if (donorUrl && !normalizeSkinImageUrl(row[f])) row[f] = donorUrl;
    }
  }
}

function setRows(rows, component, snapshotPath = "", options = {}) {
  closeTargetComponentDrawer();
  const incoming = Array.isArray(rows) ? rows : [];
  backfillRowImages(incoming, state.rows);
  if (state.snapshotCacheByAccount instanceof Map) {
    const accountKey = String(state.currentAccountUsername || "").trim();
    const cached = accountKey ? state.snapshotCacheByAccount.get(accountKey) : null;
    if (cached && Array.isArray(cached.rows) && cached.rows.length) {
      backfillRowImages(incoming, cached.rows);
    }
  }
  state.rows = incoming;
  state.component = component || {summary_map: {}, item_map: {}};
  state.snapshotPath = snapshotPath || "";
  clearCraftCandidateState();
  resetRenderWindow();
  const keepSelectedIds = options && options.keepSelectedIds ? new Set(
    Array.from(options.keepSelectedIds).map((x) => String(x || "").trim()).filter(Boolean)
  ) : null;
  state.selectedComponentItemIds.clear();
  if (keepSelectedIds && keepSelectedIds.size) {
    const existingIds = new Set(state.rows.map((row) => rowAssetId(row)).filter(Boolean));
    for (const id of keepSelectedIds) {
      if (existingIds.has(id)) state.selectedComponentItemIds.add(id);
    }
  }
  state.rowsVersion += 1;
  state.filterCacheKey = "";
  state.filterCacheAllRows = [];
  state.filterCacheFilteredRows = [];
  state.groupCacheKey = "";
  state.groupCacheRows = [];
  state.collectionSourceKey = "";
  state.expandedGroups.clear();
  if (ui.snapshotPath) {
    ui.snapshotPath.textContent = state.snapshotPath ? `快照：${state.snapshotPath}` : "快照：未选择";
  }
  refreshComponentControls();
  refreshCollectionMenu(rowsForComponentScope(), {force: true, sourceKey: makeCollectionSourceKey()});
  render();
  renderCraftPage();
}

async function loadSnapshotForAccount(username, {silentSummary = false} = {}) {
  const key = String(username || "").trim();
  if (!key) return false;
  const data = await api(`/api/snapshot/account?username=${encodeURIComponent(key)}`);
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const component = data.component || {summary_map: {}, item_map: {}};
  const snapshotPath = data.snapshot && data.snapshot.path ? data.snapshot.path : "";
  const fetchTime = String(data.fetch_time || "").trim();
  const connected = data.connected === true;
  state.currentAccountUsername = key;
  if (connected) state.connectedUsername = key;
  else if (state.connectedUsername === key) state.connectedUsername = "";
  state.fetchTime = fetchTime;
  setAccountAuthState(key, {
    authState: String(data.auth_state || "").trim() || "normal",
    authReason: String(data.auth_reason || "").trim()
  });
  setRows(rows, component, snapshotPath);
  cacheSnapshotForAccount(key, {
    rows,
    component,
    snapshotPath,
    fetchTime,
    connected,
    authState: String(data.auth_state || "").trim() || "normal",
    authReason: String(data.auth_reason || "").trim()
  });
  clearSnapshotDirty();
  syncInventoryTop();
  if (rows.length) {
    if (!silentSummary) setSummary(`已显示该账号上次库存，共 ${rows.length} 条`);
  } else {
    state.emptyHint = "当前账号未连接";
    if (!silentSummary) setSummary("当前账号未连接（暂无上次库存信息）", {isError: false});
  }
  return true;
}

async function switchAccountView(username, {silentSnapshotSummary = false, deferComponentTaskQueue = false} = {}) {
  const key = String(username || "").trim();
  if (!key) return;
  const previousUsername = String(state.currentAccountUsername || "").trim();
  const switchingSameAccount = !!previousUsername && previousUsername === key;
  if (previousUsername) {
    saveCraftAccountScopedState(previousUsername);
    saveCraftAssistRuntimeState(previousUsername);
  }
  const targetCraftState = switchingSameAccount
    ? buildCurrentCraftAccountScopedStateSnapshot()
    : getCraftAccountScopedStateSnapshot(key, {preferSaved: true});
  const targetCraftRuntime = switchingSameAccount
    ? buildCurrentCraftAssistRuntimeStateSnapshot()
    : getCraftAssistRuntimeStateSnapshot(key, {preferCurrent: false});
  clearSnapshotDirty();
  state.lastDirtyFallbackTs = 0;
  state.craftSettingsOpen = false;
  applyCraftAccountScopedStateSnapshot(targetCraftState, {runtimeSnapshot: targetCraftRuntime, username: key});
  saveCraftAccountScopedState(key, targetCraftState);
  saveCraftAssistRuntimeState(key, targetCraftRuntime);
  if (craftAssistPickerCloseTimer != null) {
    clearTimeout(craftAssistPickerCloseTimer);
    craftAssistPickerCloseTimer = null;
  }
  state.accountSelectedUsername = key;
  syncInventoryAccountSelect();
  renderSavedAccounts();
  await persistLastSelected(key);
  const reused = applyCachedSnapshotForAccount(key, {silentSummary: !!silentSnapshotSummary});
  if (!reused) {
    await loadSnapshotForAccount(key, {silentSummary: !!silentSnapshotSummary});
  }
  restoreCraftAccountScopedState(key, {preferSaved: true});
  renderCraftPage();
  startInventoryEventStream(key);
  void ensureAccountProfile(key);
  if (deferComponentTaskQueue) {
    void loadComponentTaskQueue();
  } else {
    await loadComponentTaskQueue();
  }
}
async function useAccount(username) {
  const key = String(username || "").trim();
  if (!key) return;
  if (state.refreshing) { setAccountStatus("库存刷新中，请稍后再试", true); return; }
  try {
    await api("/api/accounts/active", {method: "POST", body: JSON.stringify({username: key})});
    state.activeAccount = key;
    await loadAccounts({preferUsername: key});
    await switchAccountView(key);
    await refreshWithConnectionOverlay({
      preferCraft: false,
      usernameOverride: key,
      force: true,
      silentRateLimit: true
    });
    const info = accountByUsername(key);
    setAccountStatus(`已设为当前账号：${info ? displayAccountName(info) : key}`);
  } catch (err) {
    setAccountStatus(`切换账号失败：${err.message}`, true);
  }
}

async function deleteAccount(row) {
  if (state.refreshing) { setAccountStatus("库存刷新中，暂时无法删除账号", true); return; }
  const ok = await openConfirmModal({
    title: "确认删除账号",
    message: `确认删除账号“${row.remark || row.username}（${row.username}）”？\n该操作只会移除本地保存的密码与账号记录，不会释放会员绑定资格。`,
    confirmText: "确认删除",
    cancelText: "取消"
  });
  if (!ok) return;
  try {
    await api("/api/accounts/delete", {method: "POST", body: JSON.stringify({username: row.username})});
    if (state.connectedUsername === row.username) state.connectedUsername = "";
    if (state.snapshotCacheByAccount instanceof Map) {
      state.snapshotCacheByAccount.delete(String(row.username || "").trim());
    }
    if (state.craftAccountStateByAccount instanceof Map) {
      state.craftAccountStateByAccount.delete(String(row.username || "").trim());
    }
    if (state.craftAssistRuntimeByAccount instanceof Map) {
      state.craftAssistRuntimeByAccount.delete(String(row.username || "").trim());
    }
    if (state.craftAssistActiveRunTokensByAccount instanceof Map) {
      state.craftAssistActiveRunTokensByAccount.delete(String(row.username || "").trim());
    }
    if (String(state.currentAccountUsername || "").trim() === String(row.username || "").trim()) {
      state.currentAccountUsername = "";
    }
    await loadAccounts();
    if (state.accounts.length) await switchAccountView(state.accountSelectedUsername || state.accounts[0].username);
    else setNoAccountState();
    ensureAccountFormEditable({focusUsername: state.currentPage === "accountPage"});
    setAccountStatus(`已删除账号：${row.remark || row.username}（${row.username}）`);
  } catch (err) {
    setAccountStatus(`删除失败：${err.message}`, true);
  }
}

async function loginAndSave() {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可保存 Steam 账号并绑定到当前客户端身份。",
    view: "login"
  }) === false) {
    return false;
  }
  if (state.accountLoginBusy) return false;
  const username = String(ui.accountUsername.value || "").trim();
  const password = String(ui.accountPassword.value || "").trim();
  const totp = normalizeAccountTotpInput();
  const remark = "";
  if (!username) { setAccountStatus("请输入 Steam 账号", true); return; }
  if (!password) { setAccountStatus("请输入密码", true); return; }

  // --- Phase 2: submitting guard code for a pending session ---
  if (state.pendingGuard && state.pendingGuard.username === username) {
    if (!totp) { setAccountStatus("请输入验证码", true); return; }
    if (setAccountLoginOverlayStage({percent: 25, title: "正在提交验证码", detail: "正在验证..."}) === false) {
      setAccountStatus("当前有任务进行中，请稍后再试", true);
      return false;
    }
    try {
      setAccountLoginBusy(true);
      setAccountStatus("正在提交验证码，请稍候...");
      await api("/api/accounts/login-submit-code", {
        method: "POST",
        body: JSON.stringify({username, password, code: totp, remark})
      });
      state.pendingGuard = null;
      resetGuardHintUI();
      await finishLoginSuccess(username);
      return true;
    } catch (err) {
      state.pendingGuard = null;
      resetGuardHintUI();
      setAccountStatus(formatLoginSaveError(err), true);
      return false;
    } finally {
      clearAccountLoginOverlay();
      if (state.accountLoginBusy) setAccountLoginBusy(false);
    }
  }

  // --- Phase 1: start login (may complete immediately or require guard) ---
  if (setAccountLoginOverlayStage({
    percent: 25,
    title: "正在登录账号",
    detail: totp ? "正在校验账号、密码与令牌码..." : "正在校验账号与密码..."
  }) === false) {
    setAccountStatus("当前有任务进行中，请稍后再试", true);
    return false;
  }

  try {
    setAccountLoginBusy(true);
    setAccountStatus("正在登录，请稍候...");
    const resp = await api("/api/accounts/login-start", {
      method: "POST",
      body: JSON.stringify({username, password, totp, remark})
    });
    const data = resp && resp.data ? resp.data : resp;

    if (data && data.done === false && data.guard_type) {
      // Guard required — enter phase 2
      clearAccountLoginOverlay();
      setAccountLoginBusy(false);
      state.pendingGuard = {username, password, guard_type: data.guard_type, guard_hint: data.guard_hint || ""};
      applyGuardHintUI(data.guard_type, data.guard_hint || "");
      return false;
    }

    // Login completed in one shot
    await finishLoginSuccess(username);
    return true;
  } catch (err) {
    setAccountStatus(formatLoginSaveError(err), true);
    return false;
  } finally {
    clearAccountLoginOverlay();
    if (state.accountLoginBusy) setAccountLoginBusy(false);
  }
}

function applyGuardHintUI(guardType, guardHint) {
  const label = guardType === "email_code"
    ? (guardHint ? `邮箱验证码（已发送到 ${guardHint}）` : "邮箱验证码")
    : "令牌码";
  const totpLabel = ui.accountTotp && ui.accountTotp.closest && ui.accountTotp.closest("label");
  if (totpLabel) {
    const span = totpLabel.querySelector("span");
    if (span) span.textContent = label;
  }
  if (ui.accountTotp) {
    ui.accountTotp.value = "";
    ui.accountTotp.maxLength = guardType === "email_code" ? 5 : 6;
    ui.accountTotp.focus();
  }
  const hintEl = document.getElementById("accountGuardHint");
  if (hintEl) {
    if (guardType === "email_code" && guardHint) {
      hintEl.textContent = `Steam 已向 ${guardHint} 发送验证码，请查收邮件`;
      hintEl.classList.remove("hidden");
    } else if (guardType === "device_code") {
      hintEl.textContent = "请输入 Steam 手机令牌码";
      hintEl.classList.remove("hidden");
    } else {
      hintEl.classList.add("hidden");
    }
  }
  setAccountStatus(guardType === "email_code"
    ? `验证码已发送到 ${guardHint || "邮箱"}，请输入后点击登录`
    : "请输入令牌码后点击登录");
  if (ui.loginSaveBtn) ui.loginSaveBtn.textContent = "提交验证码";
}

function resetGuardHintUI() {
  state.pendingGuard = null;
  const totpLabel = ui.accountTotp && ui.accountTotp.closest && ui.accountTotp.closest("label");
  if (totpLabel) {
    const span = totpLabel.querySelector("span");
    if (span) span.textContent = "令牌码";
  }
  if (ui.accountTotp) ui.accountTotp.maxLength = 6;
  const hintEl = document.getElementById("accountGuardHint");
  if (hintEl) hintEl.classList.add("hidden");
  syncAccountLoginActionState();
}

async function finishLoginSuccess(username) {
  setAccountLoginOverlayStage({percent: 60, title: "正在同步账号信息", detail: "正在更新本地账号列表..."});
  await loadAccounts({preferUsername: username});
  setAccountLoginOverlayStage({percent: 90, title: "正在切换账号视图", detail: "正在切换到刚登录的账号..."});
  await switchAccountView(username, {silentSnapshotSummary: true, deferComponentTaskQueue: true});
  setAccountLoginOverlayStage({percent: 100, title: "登录完成", detail: "正在准备后台刷新库存..."});
  clearAccountLoginOverlay();
  setAccountLoginBusy(false);
  clearAccountInputs();
  closeAccountLoginModal();
  setAccountStatus("准备就绪");
  void (async () => {
    try {
      handlePostLoginRefreshResult(
        username,
        await doRefresh({usernameOverride: username, force: true, silentRateLimit: true, silentInfo: true, suppressReloginModal: true})
      );
    } catch (_) {}
  })();
}

function clearAccountForm() {
  if (state.accountLoginBusy) return;
  clearAccountInputs();
  closeAccountLoginModal();
  setAccountStatus("");
}

function openAddAccountForm() {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可保存 Steam 账号并管理账号列表。",
    view: "login"
  }) === false) {
    return;
  }
  state.accountLoginMode = "add";
  state.pendingRelogin = null;
  clearAccountInputs({focusUsername: true});
  setAccountStatus("");
  openAccountLoginModal({focusUsername: true});
}

async function connectByStatusBadge({preferCraft = false, usernameOverride = ""} = {}) {
  if (state.refreshing) return;
  const username = String(
    usernameOverride ||
    (preferCraft && ui.craftAccountSelect ? ui.craftAccountSelect.value : "") ||
    (ui.accountPageSelect ? ui.accountPageSelect.value : "") ||
    (ui.accountSelect ? ui.accountSelect.value : "") ||
    (ui.craftAccountSelect ? ui.craftAccountSelect.value : "") ||
    state.currentAccountUsername
  ).trim();
  if (!username) return;
  if (String(state.connectedUsername || "").trim() === username && String(state.currentAccountUsername || "").trim() === username) {
    return;
  }
  if (String(state.currentAccountUsername || "").trim() !== username) {
    try {
      await switchAccountView(username);
    } catch (err) {
      setSummary(`切换账号失败：${err.message}`);
      return;
    }
  }
  await refreshWithConnectionOverlay({
    preferCraft,
    usernameOverride: username,
    force: true,
    silentRateLimit: true,
    silentInfo: true,
    forceOverlay: true
  });
}

function setNoAccountState({silentSummary = false} = {}) {
  const previousUsername = String(state.currentAccountUsername || "").trim();
  if (previousUsername) {
    saveCraftAccountScopedState(previousUsername);
    saveCraftAssistRuntimeState(previousUsername);
  }
  stopInventoryEventStream();
  closeTargetComponentDrawer();
  clearSnapshotDirty();
  state.lastDirtyFallbackTs = 0;
  state.currentAccountUsername = "";
  state.fetchTime = "";
  state.rows = [];
  state.snapshotPath = "";
  state.component = {summary_map: {}, item_map: {}};
  state.selectedComponentId = "";
  state.showComponentItems = false;
  state.selectedComponentItemIds.clear();
  state.componentTaskQueue = {running: null, queued: []};
  state.selectedQueueJobId = "";
  state.componentTaskProgressMap = {};
  state.craftBusy = false;
  state.craftSettingsOpen = false;
  applyCraftAccountScopedStateSnapshot(createDefaultCraftAccountScopedState(), {
    runtimeSnapshot: createDefaultCraftAssistRuntimeState(),
    username: ""
  });
  if (craftAssistPickerCloseTimer != null) {
    clearTimeout(craftAssistPickerCloseTimer);
    craftAssistPickerCloseTimer = null;
  }
  state.emptyHint = "请选用一个账号";
  ui.showComponentItems.checked = false;
  setRows([], {summary_map: {}, item_map: {}}, "");
  renderTaskQueueControls();
  syncInventoryTop();
  if (silentSummary) setSummary("");
  else setSummary("请选用一个账号");
}

function qualityName(row) { const v = String(row.quality_name || "").trim(); if (v) return v; const id = Number(row.quality || 0); return QUALITY_MAP[id] || `Unknown(${id})`; }
function rarityName(row) {
  const e = normalizeCraftPredictorRarityLabel(row && row.alchemy_rarity);
  if (e) return e;
  const r = normalizeCraftPredictorRarityLabel(row && row.rarity_name);
  if (r) return r;
  const id = Number(row && row.rarity || 0);
  return normalizeCraftPredictorRarityLabel(RARITY_MAP[id] || "") || `Unknown(${id})`;
}
const collectionName = (row) => String(row.collection || "").trim();
const itemDisplayName = (row) => {
  const raw = isComponentRow(row)
    ? String(row.name || row.alchemy_name || "").trim()
    : String(row.alchemy_name || "").trim() || String(row.name || "").trim();
  if (raw.toLowerCase().startsWith("storage unit")) {
    const suffix = raw.slice("storage unit".length).replace(/^\s*\|\s*/, "").trim();
    return suffix ? `库存组件（${suffix}）` : "库存组件";
  }
  return raw;
};
const itemSearchText = (row) => [row.name, row.market_hash_name, row.alchemy_name, row.collection, row.collection_en].map((x) => String(x || "").toLowerCase()).join(" ").trim();
function normalizeSkinImageUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /^https?:\/\//i.test(text) ? text : "";
}
function cssUrlValue(value) {
  const text = String(value || "").replace(/[\r\n]/g, "").replace(/["\\]/g, "\\$&");
  return text ? `url("${text}")` : "";
}
function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function preferredRowSkinImageUrl(row) {
  if (!row || typeof row !== "object") return "";
  const candidates = [
    row.goods_original_icon_url,
    row.goods_icon_url,
    row.goods_share_thumbnail_url
  ];
  for (const candidate of candidates) {
    const url = normalizeSkinImageUrl(candidate);
    if (url) return url;
  }
  return "";
}
function preferredRowsSkinImageUrl(rows) {
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    const url = preferredRowSkinImageUrl(row);
    if (url) return url;
  }
  return "";
}
function appendCardSkinBackdrop(card, row) {
  const imageUrl = preferredRowSkinImageUrl(row);
  if (!card || !imageUrl) return "";
  const backdrop = document.createElement("div");
  backdrop.className = "card-skin-backdrop";
  backdrop.style.backgroundImage = `linear-gradient(90deg, rgba(10,12,16,0.82) 0%, rgba(16,19,24,0.4) 42%, rgba(16,19,24,0.04) 100%), ${cssUrlValue(imageUrl)}`;
  backdrop.style.backgroundPosition = "center center, right 14px bottom -24px";
  backdrop.style.backgroundSize = "cover, 152px auto";
  card.classList.add("has-skin-image");
  card.append(backdrop);
  return imageUrl;
}
function decorateCraftSlotSkinImage(slot, row) {
  if (!slot) return "";
  const imageUrl = preferredRowSkinImageUrl(row);
  if (!imageUrl) return "";
  slot.classList.add("has-skin-image");
  slot.style.setProperty("--craft-slot-skin-image", cssUrlValue(imageUrl));
  return imageUrl;
}
function decorateGroupNameCell(nameCell, text, imageUrl) {
  if (!nameCell) return;
  nameCell.classList.add("group-name-cell");
  nameCell.replaceChildren();
  const label = document.createElement("span");
  label.className = "group-name-label";
  label.textContent = text;
  nameCell.append(label);
  const normalizedImageUrl = normalizeSkinImageUrl(imageUrl);
  if (!normalizedImageUrl) return;
  nameCell.classList.add("has-skin-image");
  nameCell.style.setProperty("--group-skin-image", cssUrlValue(normalizedImageUrl));
}
function normalizeWearToken(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\s_\-（）()]/g, "");
}
function truncateNumber(value, decimals = WEAR_INPUT_DECIMALS) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const d = Math.max(0, Math.trunc(Number(decimals) || 0));
  const scale = 10 ** d;
  if (!Number.isFinite(scale) || scale <= 0) return n;
  if (n >= 0) return Math.floor(n * scale + 1e-9) / scale;
  return Math.ceil(n * scale - 1e-9) / scale;
}
function numberTextTrunc(value, decimals = WEAR_INPUT_DECIMALS) {
  const d = Math.max(0, Math.trunc(Number(decimals) || 0));
  const t = truncateNumber(value, d);
  if (t == null) return "-";
  return t.toFixed(d);
}
function wearTextFull(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return "-";
    return raw;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  const text = String(n);
  if (!/[eE]/.test(text)) return text;
  return n.toFixed(16).replace(/\.?0+$/, "");
}
function formatVisibleWearText(value, decimals = 8) {
  if (value == null) return "-";
  return state.craftShowFullWear ? wearTextFull(value) : numberTextTrunc(value, decimals);
}
function parseOptionalWear01(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.max(0, Math.min(1, n));
  return clamped;
}
function normalizeCraftAssistTargetWearStep(value) {
  const parsed = parseOptionalWear01(value);
  return parsed == null ? null : Math.fround(parsed);
}
function resolveCraftAssistTargetWearPair(targetWearValue, targetWearRawValue, {fallback = null} = {}) {
  const rawText = String(targetWearRawValue == null ? "" : targetWearRawValue).trim();
  if (rawText) {
    const parsedRaw = Number(rawText);
    if (!Number.isFinite(parsedRaw) || parsedRaw < 0 || parsedRaw > 1) return null;
    return {
      target_wear_raw: rawText,
      target_wear: Math.fround(parsedRaw)
    };
  }
  const parsedTargetWear = parseOptionalWear01(targetWearValue);
  if (parsedTargetWear != null) {
    const targetWear = Math.fround(parsedTargetWear) === parsedTargetWear
      ? parsedTargetWear
      : Math.fround(parsedTargetWear);
    return {
      target_wear_raw: String(parsedTargetWear),
      target_wear: targetWear
    };
  }
  if (fallback == null && fallback !== 0) return null;
  const fallbackParsed = parseOptionalWear01(fallback);
  if (fallbackParsed == null) return null;
  return {
    target_wear_raw: String(fallbackParsed),
    target_wear: Math.fround(fallbackParsed)
  };
}
function normalizeCraftAssistTargetWearStepOrFallback(value, fallback = 0.5) {
  const normalized = normalizeCraftAssistTargetWearStep(value);
  if (normalized != null) return normalized;
  return normalizeCraftAssistTargetWearStep(fallback) || 0;
}
function inferWearSuffixRangeByName(name) {
  const normalized = normalizeWearToken(name);
  if (!normalized) return null;
  for (const rule of WEAR_SUFFIX_RANGES) {
    if (rule.keys.some((key) => normalized.includes(normalizeWearToken(key)))) {
      return {min: rule.min, max: rule.max};
    }
  }
  return null;
}
function getCraftMaterialFloatBoundsByName(name, rows = null) {
  const key = String(name || "").trim();
  if (!key) return null;
  const sourceRows = Array.isArray(rows) ? rows : getMainInventoryCraftableRows();
  let min = null;
  let max = null;
  for (const row of sourceRows) {
    if (itemDisplayName(row) !== key) continue;
    const rowMin = Number(row && row.minfloat);
    const rowMax = Number(row && row.maxfloat);
    if (!Number.isFinite(rowMin) || !Number.isFinite(rowMax) || rowMax <= rowMin) continue;
    const nextMin = Math.max(0, Math.min(1, rowMin));
    const nextMax = Math.max(0, Math.min(1, rowMax));
    min = min == null ? nextMin : Math.min(min, nextMin);
    max = max == null ? nextMax : Math.max(max, nextMax);
  }
  if (min == null || max == null || max < min) return null;
  return {min, max};
}
function resolveCraftMaterialWearConstraintByName(name, {useRelative = true, rows = null} = {}) {
  const suffixRange = inferWearSuffixRangeByName(name);
  const floatBounds = getCraftMaterialFloatBoundsByName(name, rows);
  let min = 0;
  let max = 1;
  if (suffixRange && floatBounds) {
    const interMin = Math.max(suffixRange.min, floatBounds.min);
    const interMax = Math.min(suffixRange.max, floatBounds.max);
    if (interMax >= interMin) {
      min = interMin;
      max = interMax;
    } else {
      // 交集异常时优先使用物品自身 minfloat/maxfloat 约束，避免不可选。
      min = floatBounds.min;
      max = floatBounds.max;
    }
  } else if (suffixRange) {
    min = suffixRange.min;
    max = suffixRange.max;
  } else if (floatBounds) {
    min = floatBounds.min;
    max = floatBounds.max;
  }
  if (useRelative) {
    if (floatBounds && floatBounds.max > floatBounds.min) {
      const denom = floatBounds.max - floatBounds.min;
      min = (min - floatBounds.min) / denom;
      max = (max - floatBounds.min) / denom;
    }
    min = Math.max(0, Math.min(1, min));
    max = Math.max(0, Math.min(1, max));
  } else {
    min = Math.max(0, Math.min(1, min));
    max = Math.max(0, Math.min(1, max));
  }
  if (max < min) {
    const tmp = min;
    min = max;
    max = tmp;
  }
  return {min, max, suffixRange, floatBounds};
}
function clampWearToRange(value, min, max, fallback = min) {
  const lo = Math.max(0, Math.min(1, Number(min)));
  const hi = Math.max(lo, Math.min(1, Number(max)));
  const n = Number(value);
  const base = Number.isFinite(n) ? n : Number(fallback);
  if (!Number.isFinite(base)) return lo;
  return Math.max(lo, Math.min(hi, base));
}
function resolveCraftAssistMaterialEffectiveRange(material, {useRelative = true, rows = null} = {}) {
  const names = craftAssistMaterialNames(material);
  const constraint = makeCraftAssistDefaultRange(names, {useRelative, rows});
  let wearMin = constraint.wear_min;
  let wearMax = constraint.wear_max;
  const custom = !!(material && material.custom_range);
  if (custom) {
    wearMin = clampWearToRange(material && material.wear_min, constraint.wear_min, constraint.wear_max, constraint.wear_min);
    wearMax = clampWearToRange(material && material.wear_max, constraint.wear_min, constraint.wear_max, constraint.wear_max);
    if (wearMax < wearMin) {
      const tmp = wearMin;
      wearMin = wearMax;
      wearMax = tmp;
    }
  }
  return {
    wear_min: wearMin,
    wear_max: wearMax,
    constraint_min: constraint.wear_min,
    constraint_max: constraint.wear_max,
    custom_range: custom
  };
}
function isComponentRow(row) { if (!row || typeof row !== "object") return false; const defIndex = Number(row.def_index || 0); if (defIndex === STORAGE_UNIT_DEF_INDEX) return true; const name = String(row.name || row.alchemy_name || "").toLowerCase(); return name.includes("storage unit"); }
function isYellowShieldBlockedRow(row) {
  if (!row || typeof row !== "object") return false;
  if (row.yellow_shield_blocked === true) return true;
  const lockKind = String(row.trade_lock_kind || "").trim().toLowerCase();
  if (lockKind === "yellow_shield") return true;
  const hiddenReason = String(row.hidden_reason || "").trim();
  return hiddenReason === "flags=24" || hiddenReason === "attr#277" || hiddenReason === "attr#312";
}
function isInventoryRowSelectable(row) { return !isComponentRow(row) && !isYellowShieldBlockedRow(row); }
function itemHasWear(row) { if (row.minfloat != null && row.maxfloat != null) return true; const n = String(row.name || "").toLowerCase(); return ["(factory new)", "(minimal wear)", "(field-tested)", "(well-worn)", "(battle-scarred)"].some((x) => n.includes(x)); }
function nthWeekdayOfMonthUtc(year, month, weekday, nth) { const first = new Date(Date.UTC(year, month, 1)); const firstWeekday = first.getUTCDay(); return 1 + ((7 + weekday - firstWeekday) % 7) + (nth - 1) * 7; }
function isUsPacificDst(unlockTs) { if (!Number.isFinite(unlockTs) || unlockTs <= 0) return false; const d = new Date(unlockTs * 1000); const year = d.getUTCFullYear(); const marchDay = nthWeekdayOfMonthUtc(year, 2, 0, 2); const novDay = nthWeekdayOfMonthUtc(year, 10, 0, 1); const startUtcTs = Math.floor(Date.UTC(year, 2, marchDay, 10, 0, 0) / 1000); const endUtcTs = Math.floor(Date.UTC(year, 10, novDay, 9, 0, 0) / 1000); return unlockTs >= startUtcTs && unlockTs < endUtcTs; }
function normalizeTradableAfterTs(value) { const baseTs = Number(value); if (!Number.isFinite(baseTs) || baseTs <= 0) return 0; const secTs = baseTs > 1e12 ? Math.floor(baseTs / 1000) : Math.floor(baseTs); return isUsPacificDst(secTs) ? secTs : secTs + 3600; }
function parseTradableAfter(row) { const raw = row.tradable_after; if (raw == null) return 0; if (typeof raw === "string") { if (/^\d+$/.test(raw)) { const num = Number(raw); if (Number.isFinite(num)) return normalizeTradableAfterTs(num); } const p = Date.parse(raw); return Number.isFinite(p) ? normalizeTradableAfterTs(Math.floor(p / 1000)) : 0; } return normalizeTradableAfterTs(raw); }
const coolingUnlockTs = (row) => { const ts = parseTradableAfter(row); return ts <= Math.floor(Date.now() / 1000) ? 0 : ts; };
function cooldownEndText(unlockTs) { const d = new Date(unlockTs * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`; }
function cooldownText(row, {compact = false} = {}) { const unlock = coolingUnlockTs(row); if (unlock <= 0) return "无"; const end = cooldownEndText(unlock); return compact ? `冷却中 ${end}结束` : `冷却中 ${end} 结束`; }
function groupCooldownText(items) { const cooling = items.filter((x) => coolingUnlockTs(x) > 0); if (!cooling.length) return "无"; const earliest = cooling.reduce((a, b) => (coolingUnlockTs(a) <= coolingUnlockTs(b) ? a : b)); if (cooling.length === 1) return cooldownText(earliest); return `${cooling.length}件冷却中，最早${cooldownEndText(coolingUnlockTs(earliest))}结束`; }
function groupCollectionText(items) { const values = Array.from(new Set(items.map((x) => collectionName(x)).filter(Boolean))).sort((a, b) => a.localeCompare(b)); if (!values.length) return ""; if (values.length === 1) return values[0]; return "多收藏品"; }
function groupNeedsExpand(items) { if (items.length <= 1) return true; const base = items[0], baseWear = itemHasWear(base), baseSeed = Number(base.paint_seed || 0), baseQ = Number(base.quality || 0), baseR = Number(base.rarity || 0), baseU = parseTradableAfter(base), baseF = Number(base.float_value || 0); for (let i = 1; i < items.length; i += 1) { const it = items[i]; if (Number(it.paint_seed || 0) !== baseSeed || Number(it.quality || 0) !== baseQ || Number(it.rarity || 0) !== baseR || parseTradableAfter(it) !== baseU) return true; const wear = itemHasWear(it); if (wear !== baseWear) return true; if (wear && Math.abs(Number(it.float_value || 0) - baseF) > 1e-9) return true; } return false; }
function rowAssetId(row) {
  if (!row || typeof row !== "object") return "";
  const candidates = [row.asset_id, row.assetid, row.item_id, row.id, row.component_id];
  for (const value of candidates) {
    const key = String(value == null ? "" : value).trim();
    if (key) return key;
  }
  return "";
}
const assetIdNumber = (row) => { const n = Number(rowAssetId(row)); return Number.isFinite(n) ? Math.trunc(n) : 0; };
function compactComponentName(name) { let t = String(name || "").trim(); if (!t) return "未命名组件"; if (t.toLowerCase().startsWith("storage unit")) { t = t.slice("Storage Unit".length).trim(); if (t.startsWith("|")) t = t.slice(1).trim(); } if (t.startsWith("(") && t.endsWith(")")) t = t.slice(1, -1).trim(); return t || "未命名组件"; }
const componentNameById = (id) => { const key = String(id || "").trim(); if (!key) return ""; const s = state.component.summary_map[key]; return s ? s.name || key : key; };
const selectedComponentId = () => String(state.selectedComponentId || "").trim();
function isAllInventoryMode() { return selectedComponentId() === "__ALL__"; }
function rowsForComponentScope() {
  const selected = selectedComponentId();
  if (selected === "__ALL__") {
    const mainRows = state.rows.filter((x) => !String(x.casket_id || "").trim());
    const componentRows = [];
    for (const [, items] of Object.entries(state.component.item_map || {})) {
      if (Array.isArray(items)) componentRows.push(...items);
    }
    return mainRows.concat(componentRows);
  }
  if (selected) return state.component.item_map[selected] || [];
  return state.rows.filter((x) => !String(x.casket_id || "").trim());
}
function isRowStatTrak(row) {
  if (Number(row && row.quality || 0) === 9) return true;
  const qualityText = String(row && row.quality_name || "").toLowerCase();
  return qualityText.includes("stattrak");
}
function isMainInventoryCraftableRow(row) {
  if (!row || typeof row !== "object") return false;
  if (String(row.casket_id || "").trim()) return false;
  if (String(row.hidden_reason || "").trim()) return false;
  if (isYellowShieldBlockedRow(row)) return false;
  if (row.is_craftable !== true) return false;
  return true;
}
function isAllowedComponentCraftHiddenReason(row) {
  if (!row || typeof row !== "object") return false;
  const casketId = String(row.casket_id || "").trim();
  const hiddenReason = String(row.hidden_reason || "").trim();
  if (!casketId || !hiddenReason) return false;
  return hiddenReason === "attr#272/273";
}
function getMainInventoryCraftableRows() {
  return state.rows
    .filter(isMainInventoryCraftableRow)
    .sort((a, b) => {
      const ra = Number(a.rarity || 0);
      const rb = Number(b.rarity || 0);
      if (ra !== rb) return rb - ra;
      const sa = isRowStatTrak(a) ? 1 : 0;
      const sb = isRowStatTrak(b) ? 1 : 0;
      if (sa !== sb) return sb - sa;
      const wa = Number(a.float_value || 0);
      const wb = Number(b.float_value || 0);
      if (wa !== wb) return wa - wb;
        return assetIdNumber(a) - assetIdNumber(b);
    });
}
function getAllInventoryCraftableRows({rows = state.rows, includeComponentItems = state.craftUseComponentItems} = {}) {
  const sourceRows = Array.isArray(rows) ? [...rows] : [];
  if (includeComponentItems) {
    const seen = new Set(sourceRows.map((row) => {
      if (!row || typeof row !== "object") return "";
      return String(row.asset_id || row.assetid || row.item_id || row.id || row.component_id || "").trim();
    }).filter(Boolean));
    const itemMap = state.component && state.component.item_map && typeof state.component.item_map === "object"
      ? state.component.item_map
      : {};
    for (const list of Object.values(itemMap)) {
      for (const row of Array.isArray(list) ? list : []) {
        if (!row || typeof row !== "object") continue;
        const key = String(row.asset_id || row.assetid || row.item_id || row.id || row.component_id || "").trim();
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        sourceRows.push(row);
      }
    }
  }
  return sourceRows
    .filter((row) => {
      if (!row || typeof row !== "object") return false;
      if (isYellowShieldBlockedRow(row)) return false;
      if (String(row.hidden_reason || "").trim() && !isAllowedComponentCraftHiddenReason(row)) return false;
      if (row.is_craftable !== true) return false;
      if (isComponentRow(row)) return false;
      const inComponent = !!String(row.casket_id || "").trim();
      if (inComponent && !includeComponentItems) return false;
      return true;
    })
    .sort((a, b) => {
      const ra = Number(a.rarity || 0);
      const rb = Number(b.rarity || 0);
      if (ra !== rb) return rb - ra;
      const sa = isRowStatTrak(a) ? 1 : 0;
      const sb = isRowStatTrak(b) ? 1 : 0;
      if (sa !== sb) return sb - sa;
      const wa = Number(a.float_value || 0);
      const wb = Number(b.float_value || 0);
      if (wa !== wb) return wa - wb;
      return assetIdNumber(a) - assetIdNumber(b);
    });
}
function getCraftCoolingRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => coolingUnlockTs(row) > 0);
}
function getQueuedCraftItemIds() {
  const out = new Set();
  for (const entry of getCraftQueuePendingEntries()) {
    for (const id of Array.isArray(entry && entry.item_ids) ? entry.item_ids : []) {
      const key = String(id || "").trim();
      if (key) out.add(key);
    }
  }
  return out;
}
function clearCraftCandidateState() {
  state.craftCandidateRows = [];
  state.craftCandidateStats = null;
  state.craftCandidateLoading = false;
  state.craftCandidateRequestKey = "";
  state.craftCandidateLoadedKey = "";
  state.craftCandidateRequestSeq = 0;
}
function commitCraftAccountScopedState(username, snapshot, {renderIfCurrent = false} = {}) {
  const key = String(username || "").trim();
  if (!key) return null;
  const liveSnapshot = normalizeCraftAccountScopedStateSnapshot(snapshot || buildCurrentCraftAccountScopedStateSnapshot());
  const next = saveCraftAccountScopedState(key, liveSnapshot);
  if (key === String(state.currentAccountUsername || "").trim()) {
    applyCraftAccountScopedStateSnapshot(liveSnapshot, {
      runtimeSnapshot: getCraftAssistRuntimeStateSnapshot(key, {preferCurrent: true}),
      username: key,
      resetPredictorPreview: false
    });
    if (renderIfCurrent) renderCraftPage();
  }
  return next;
}
function getCraftRowsForAccount(username) {
  const key = String(username || "").trim();
  if (!key) return [];
  if (key === String(state.currentAccountUsername || "").trim()) {
    return Array.isArray(state.rows) ? state.rows : [];
  }
  if (!(state.snapshotCacheByAccount instanceof Map)) return [];
  const cached = state.snapshotCacheByAccount.get(key);
  return cached && Array.isArray(cached.rows) ? deepCopyPlain(cached.rows) : [];
}
function getCraftComponentSummaryMapForAccount(username) {
  const key = String(username || "").trim();
  if (!key) return {};
  if (key === String(state.currentAccountUsername || "").trim()) {
    return state.component && state.component.summary_map && typeof state.component.summary_map === "object"
      ? state.component.summary_map
      : {};
  }
  if (!(state.snapshotCacheByAccount instanceof Map)) return {};
  const cached = state.snapshotCacheByAccount.get(key);
  return cached && cached.component && cached.component.summary_map && typeof cached.component.summary_map === "object"
    ? deepCopyPlain(cached.component.summary_map)
    : {};
}
function buildCraftAssistDraftSnapshotFromScopedState(scopedState) {
  const source = scopedState && typeof scopedState === "object" ? scopedState : createDefaultCraftAccountScopedState();
  const targetWearPair = resolveCraftAssistTargetWearPair(source.craftAssistTargetWear, source.craftAssistTargetWearRaw);
  return {
    panel_open: !!source.craftAssistOpen,
    target_wear: targetWearPair ? targetWearPair.target_wear : null,
    target_wear_raw: targetWearPair ? targetWearPair.target_wear_raw : "",
    materials: projectCraftAssistPersistedMaterialsFromState(source.craftAssistMaterials),
    pick_role: normalizeCraftAssistRole(source.craftAssistPickRole)
  };
}
function setCraftStatusOnScopedState(scopedState, text, isError = false) {
  if (!scopedState || typeof scopedState !== "object") return;
  scopedState.craftStatusText = String(text || "").trim();
  scopedState.craftStatusError = !!isError;
}
function getCraftQueuePendingEntriesFromState(scopedState) {
  return (Array.isArray(scopedState && scopedState.craftRecipeQueue) ? scopedState.craftRecipeQueue : []).filter((entry) => {
    return String(entry && entry.status || "").trim() !== "done";
  });
}
function getCraftQueuePendingCountFromState(scopedState) {
  return getCraftQueuePendingEntriesFromState(scopedState).length;
}
function pruneCompletedCraftRecipeEntriesFromState(scopedState) {
  if (!scopedState || typeof scopedState !== "object") return 0;
  const list = Array.isArray(scopedState.craftRecipeQueue) ? scopedState.craftRecipeQueue : [];
  if (!list.length) return 0;
  const next = list.filter((entry) => String(entry && entry.status || "").trim() !== "done");
  const removed = list.length - next.length;
  if (removed <= 0) return 0;
  scopedState.craftRecipeQueue = next;
  const activeId = String(scopedState.craftActiveRecipeId || "").trim();
  const activeExists = activeId && next.some((entry) => String(entry && entry.id || "").trim() === activeId);
  if (!activeExists) {
    scopedState.craftActiveRecipeId = "";
    scopedState.craftSelectedItemIds = scopedState.craftSelectedItemIds instanceof Set ? new Set() : [];
  }
  return removed;
}
function createEmptyCraftRecipeEntryInState(scopedState, {activate = true} = {}) {
  if (!scopedState || typeof scopedState !== "object") return null;
  pruneCompletedCraftRecipeEntriesFromState(scopedState);
  if (!Array.isArray(scopedState.craftRecipeQueue)) scopedState.craftRecipeQueue = [];
  const entry = {
    id: `craftq_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    item_ids: [],
    item_sources: {},
    recipe: 0,
    recipe_text: "",
    status: "pending",
    prepare_status: "pending",
    prepare_message: "",
    removed_missing_count: 0,
    result_text: "",
    spent_ids: [],
    gained_ids: []
  };
  scopedState.craftRecipeQueue.push(entry);
  if (activate) {
    scopedState.craftActiveRecipeId = entry.id;
  }
  return entry;
}
function getCraftCandidateSelectedIds() {
  return [...getQueuedCraftItemIds()].sort((a, b) => a.localeCompare(b));
}
function buildCraftCandidateRequestKey() {
  const username = String(state.currentAccountUsername || "").trim();
  const selectedIds = getCraftCandidateSelectedIds();
  return JSON.stringify({
    username,
    rowsVersion: Number(state.rowsVersion || 0),
    useComponentItems: !!state.craftUseComponentItems,
    includeCooling: !!state.craftIncludeCooling,
    selectedIds
  });
}
async function refreshCraftCandidateRows({force = false} = {}) {
  const username = String(state.currentAccountUsername || "").trim();
  if (!username || !String(state.snapshotPath || "").trim()) {
    clearCraftCandidateState();
    return false;
  }
  const requestKey = buildCraftCandidateRequestKey();
  if (!force && state.craftCandidateLoadedKey === requestKey) return true;
  if (state.craftCandidateLoading && state.craftCandidateRequestKey === requestKey) return false;
  const requestSeq = Number(state.craftCandidateRequestSeq || 0) + 1;
  state.craftCandidateRequestSeq = requestSeq;
  state.craftCandidateLoading = true;
  state.craftCandidateRequestKey = requestKey;
  try {
    const data = await api("/api/craft/candidates", {
      method: "POST",
      suppressAuthFailure: true,
      body: JSON.stringify({
        username,
        include_component_items: !!state.craftUseComponentItems,
        include_cooling: !!state.craftIncludeCooling,
        selected_item_ids: getCraftCandidateSelectedIds()
      })
    });
    if (requestSeq !== state.craftCandidateRequestSeq) return false;
    state.craftCandidateRows = Array.isArray(data && data.rows) ? data.rows : [];
    state.craftCandidateStats = data && data.stats && typeof data.stats === "object" ? data.stats : null;
    state.craftCandidateLoadedKey = requestKey;
    return true;
  } catch (err) {
    if (requestSeq !== state.craftCandidateRequestSeq) return false;
    state.craftCandidateRows = [];
    state.craftCandidateStats = null;
    state.craftCandidateLoadedKey = requestKey;
    setCraftStatus(`候选物品同步失败：${err.message}`, true);
    return false;
  } finally {
    if (requestSeq === state.craftCandidateRequestSeq) {
      state.craftCandidateLoading = false;
      state.craftCandidateRequestKey = "";
      renderCraftPage();
    }
  }
}
function getCraftQueuePendingEntries() {
  return (Array.isArray(state.craftRecipeQueue) ? state.craftRecipeQueue : []).filter((entry) => {
    const done = String(entry && entry.status || "").trim() === "done";
    return !done;
  });
}
function getCraftQueuePendingCount() {
  return getCraftQueuePendingEntries().length;
}
function pruneCompletedCraftRecipeEntries() {
  const list = Array.isArray(state.craftRecipeQueue) ? state.craftRecipeQueue : [];
  if (!list.length) return 0;
  const next = list.filter((entry) => String(entry && entry.status || "").trim() !== "done");
  const removed = list.length - next.length;
  if (removed <= 0) return 0;
  state.craftRecipeQueue = next;
  const activeId = String(state.craftActiveRecipeId || "").trim();
  const activeExists = activeId && next.some((entry) => String(entry && entry.id || "").trim() === activeId);
  if (!activeExists) {
    state.craftActiveRecipeId = "";
    state.craftSelectedItemIds.clear();
  }
  return removed;
}
function normalizeCraftRecipeItemIds(ids) {
  return Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter(Boolean)));
}
function buildCraftApiRecipePayload(entry) {
  return {
    queue_index: Number(entry && entry.queue_index),
    item_ids: [...normalizeCraftRecipeItemIds(entry && entry.item_ids)],
    item_sources: deepCopyPlain(entry && entry.item_sources && typeof entry.item_sources === "object" ? entry.item_sources : {})
  };
}
function buildCraftItemSourceSnapshot(row) {
  const componentId = String(row && row.casket_id || "").trim();
  if (!componentId) {
    return {
      source_scope: "main",
      source_component_id: "",
      source_component_name: ""
    };
  }
  const summaryMap = state.component && state.component.summary_map && typeof state.component.summary_map === "object"
    ? state.component.summary_map
    : {};
  const summary = summaryMap[componentId] && typeof summaryMap[componentId] === "object" ? summaryMap[componentId] : null;
  return {
    source_scope: "component",
    source_component_id: componentId,
    source_component_name: String((summary && summary.name) || componentNameById(componentId) || componentId).trim()
  };
}
function buildCraftItemSourceSnapshotWithSummary(row, componentSummaryMap = null) {
  const componentId = String(row && row.casket_id || "").trim();
  if (!componentId) {
    return {
      source_scope: "main",
      source_component_id: "",
      source_component_name: ""
    };
  }
  const summaryMap = componentSummaryMap && typeof componentSummaryMap === "object" ? componentSummaryMap : {};
  const summary = summaryMap[componentId] && typeof summaryMap[componentId] === "object" ? summaryMap[componentId] : null;
  return {
    source_scope: "component",
    source_component_id: componentId,
    source_component_name: String((summary && summary.name) || componentId).trim()
  };
}
function ensureCraftRecipeEntryMetadata(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (!entry.item_sources || typeof entry.item_sources !== "object" || Array.isArray(entry.item_sources)) {
    entry.item_sources = {};
  }
  entry.prepare_status = String(entry.prepare_status || "").trim() || "pending";
  entry.prepare_message = String(entry.prepare_message || "").trim();
  const removedMissingCount = Number(entry.removed_missing_count);
  entry.removed_missing_count = Number.isFinite(removedMissingCount) && removedMissingCount > 0
    ? Math.trunc(removedMissingCount)
    : 0;
  return entry;
}
function syncCraftRecipeEntryItemSources(entry, rowsById, componentSummaryMap = null) {
  const target = ensureCraftRecipeEntryMetadata(entry);
  if (!target) return {};
  const previousSources = target.item_sources && typeof target.item_sources === "object" ? target.item_sources : {};
  const nextSources = {};
  for (const id of normalizeCraftRecipeItemIds(target.item_ids)) {
    const row = rowsById instanceof Map ? rowsById.get(id) || null : null;
    if (row) {
      nextSources[id] = componentSummaryMap
        ? buildCraftItemSourceSnapshotWithSummary(row, componentSummaryMap)
        : buildCraftItemSourceSnapshot(row);
    }
    else if (previousSources[id] && typeof previousSources[id] === "object") nextSources[id] = {...previousSources[id]};
  }
  target.item_sources = nextSources;
  return nextSources;
}
function resetCraftRecipeEntryPreparation(entry) {
  const target = ensureCraftRecipeEntryMetadata(entry);
  if (!target) return;
  if (String(target.status || "").trim() !== "done") target.status = "pending";
  target.prepare_status = "pending";
  target.prepare_message = "";
  target.removed_missing_count = 0;
}
function createEmptyCraftRecipeEntry({activate = true} = {}) {
  pruneCompletedCraftRecipeEntries();
  const entry = {
    id: `craftq_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    item_ids: [],
    item_sources: {},
    recipe: 0,
    recipe_text: "",
    status: "pending",
    prepare_status: "pending",
    prepare_message: "",
    removed_missing_count: 0,
    result_text: "",
    spent_ids: [],
    gained_ids: []
  };
  state.craftRecipeQueue.push(entry);
  if (activate) {
    state.craftActiveRecipeId = entry.id;
  }
  return entry;
}
function findCraftRecipeById(recipeId) {
  const key = String(recipeId || "").trim();
  if (!key) return null;
  const found = (Array.isArray(state.craftRecipeQueue) ? state.craftRecipeQueue : []).find((entry) => String(entry && entry.id || "").trim() === key);
  if (found) return found;
  for (const group of (Array.isArray(state.batchCraftQueue) ? state.batchCraftQueue : [])) {
    const recipes = Array.isArray(group && group.recipes) ? group.recipes : [];
    const match = recipes.find((entry) => String(entry && entry.id || "").trim() === key);
    if (match) return match;
  }
  return null;
}
function syncCraftSelectedIdsFromActiveRecipe() {
  state.craftSelectedItemIds.clear();
  const active = findCraftRecipeById(state.craftActiveRecipeId);
  if (!active || String(active.status || "").trim() === "done") return;
  for (const id of normalizeCraftRecipeItemIds(active.item_ids)) {
    state.craftSelectedItemIds.add(id);
  }
}
function ensureActiveCraftRecipe({createIfMissing = false} = {}) {
  const active = findCraftRecipeById(state.craftActiveRecipeId);
  if (active && String(active.status || "").trim() !== "done") {
    syncCraftSelectedIdsFromActiveRecipe();
    return active;
  }
  const pending = getCraftQueuePendingEntries();
  if (pending.length) {
    state.craftActiveRecipeId = String(pending[pending.length - 1].id || "").trim();
    syncCraftSelectedIdsFromActiveRecipe();
    return pending[pending.length - 1];
  }
  if (createIfMissing) {
    const created = createEmptyCraftRecipeEntry({activate: true});
    syncCraftSelectedIdsFromActiveRecipe();
    return created;
  }
  state.craftActiveRecipeId = "";
  state.craftSelectedItemIds.clear();
  return null;
}
function setActiveCraftRecipe(recipeId) {
  const entry = findCraftRecipeById(recipeId);
  if (!entry || String(entry.status || "").trim() === "done") return;
  state.craftActiveRecipeId = String(entry.id || "").trim();
  syncCraftSelectedIdsFromActiveRecipe();
}
function reconcileCraftQueueWithInventory() {
  const rows = getAllInventoryCraftableRows({rows: state.rows, includeComponentItems: true});
  const rowsById = buildRowsByAssetId(rows);
  const claimed = new Set();
  for (const entry of getCraftQueuePendingEntries()) {
    ensureCraftRecipeEntryMetadata(entry);
    const nextIds = [];
    let removedMissingCount = 0;
    for (const id of normalizeCraftRecipeItemIds(entry.item_ids)) {
      if (!rowsById.has(id)) {
        removedMissingCount += 1;
        continue;
      }
      if (claimed.has(id)) continue;
      claimed.add(id);
      nextIds.push(id);
    }
    entry.item_ids = nextIds;
    syncCraftRecipeEntryItemSources(entry, rowsById);
    entry.removed_missing_count = removedMissingCount;
    if (removedMissingCount > 0) {
      entry.prepare_message = `重连校对移除 ${removedMissingCount} 件失效物品`;
    } else if (String(entry.status || "").trim() !== "prepare_failed") {
      entry.prepare_message = "";
    }
    if (String(entry.status || "").trim() !== "prepare_failed") {
      entry.prepare_status = "pending";
    }
  }
  ensureActiveCraftRecipe({createIfMissing: false});
}
function findPendingRecipeByItemId(itemId, {excludeRecipeId = ""} = {}) {
  const targetId = String(itemId || "").trim();
  if (!targetId) return null;
  const skipId = String(excludeRecipeId || "").trim();
  for (const entry of getCraftQueuePendingEntries()) {
    const entryId = String(entry && entry.id || "").trim();
    if (skipId && entryId === skipId) continue;
    const ids = normalizeCraftRecipeItemIds(entry && entry.item_ids);
    if (ids.includes(targetId)) return entry;
  }
  return null;
}
function getCraftExecutableEntries() {
  return getCraftQueuePendingEntries().filter((entry) => {
    if (String(entry && entry.status || "").trim() === "prepare_failed") return false;
    return normalizeCraftRecipeItemIds(entry && entry.item_ids).length === 10;
  });
}
function craftRecipeEntryUsesComponentItems(entry, rowsById = null) {
  const itemIds = normalizeCraftRecipeItemIds(entry && entry.item_ids);
  if (!itemIds.length) return false;
  const rowMap = rowsById instanceof Map
    ? rowsById
    : buildRowsByAssetId(getAllInventoryCraftableRows({rows: state.rows, includeComponentItems: true}));
  const itemSources = entry && typeof entry.item_sources === "object" && entry.item_sources ? entry.item_sources : {};
  return itemIds.some((id) => {
    const source = itemSources[id];
    if (source && String(source.source_scope || "").trim() === "component") return true;
    const row = rowMap.get(id);
    return !!String(row && row.casket_id || "").trim();
  });
}
function hasExecutableComponentBackedRecipes() {
  const rowsById = buildRowsByAssetId(getAllInventoryCraftableRows({rows: state.rows, includeComponentItems: true}));
  return getCraftExecutableEntries().some((entry) => craftRecipeEntryUsesComponentItems(entry, rowsById));
}
function buildRowsByAssetId(rows) {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = rowAssetId(row);
    if (id && !out.has(id)) out.set(id, row);
  }
  return out;
}
function countSelectedComponentCraftItems() {
  const rowsById = buildRowsByAssetId(getAllInventoryCraftableRows({rows: state.rows, includeComponentItems: true}));
  let count = 0;
  for (const entry of getCraftQueuePendingEntries()) {
    const itemSources = entry && typeof entry.item_sources === "object" && entry.item_sources ? entry.item_sources : {};
    for (const id of normalizeCraftRecipeItemIds(entry && entry.item_ids)) {
      const source = itemSources[id];
      if (source && String(source.source_scope || "").trim() === "component") {
        count += 1;
        continue;
      }
      const row = rowsById.get(id);
      if (row && String(row.casket_id || "").trim()) count += 1;
    }
  }
  return count;
}
function getAbsoluteWearValue(row) {
  if (!row || typeof row !== "object") return null;
  const wear = Number(row.float_value);
  if (!Number.isFinite(wear)) return null;
  return Math.max(0, Math.min(1, wear));
}
function getRelativeWearValue(row) {
  if (!row || typeof row !== "object") return null;
  const wear = getAbsoluteWearValue(row);
  const min = Number(row.minfloat);
  const max = Number(row.maxfloat);
  if (wear == null || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  const value = (wear - min) / (max - min);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}
function absoluteWearLabel(row, {prefix = true} = {}) {
  const value = getAbsoluteWearValue(row);
  const text = value == null ? "-" : formatVisibleWearText(value, 8);
  return prefix ? `绝对磨损 ${text}` : text;
}
function relativeWearLabel(row, {prefix = true} = {}) {
  const value = getRelativeWearValue(row);
  const text = value == null ? "-" : formatVisibleWearText(value, 8);
  return prefix ? `相对磨损 ${text}` : text;
}
function relativeWearDisplayLabel(row, {prefix = true} = {}) {
  const value = getRelativeWearValue(row);
  const text = value == null ? "-" : formatVisibleWearText(value, 8);
  return prefix ? `相对磨损 ${text}` : text;
}
function averageRelativeWearText(rows) {
  const values = (Array.isArray(rows) ? rows : [])
    .map((row) => getRelativeWearValue(row))
    .filter((value) => value != null && Number.isFinite(value));
  if (!values.length) return "-";
  const total = values.reduce((sum, value) => sum + value, 0);
  return wearTextFull(total / values.length);
}
function averageRelativeWearValue(rows) {
  const values = (Array.isArray(rows) ? rows : [])
    .map((row) => getRelativeWearValue(row))
    .filter((value) => value != null && Number.isFinite(value));
  if (!values.length) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}
function logCraftAssistPickedRows({recipeNo = 0, sourceText = "", targetValue = null, runOverall = null, mode = 10, selectedRows = []} = {}) {
  const list = Array.isArray(selectedRows) ? selectedRows : [];
  if (!list.length) return;
  const prefix = `[craft-assist][recipe#${Math.max(1, Number(recipeNo) || 1)}${sourceText ? `|${sourceText}` : ""}]`;
  const targetText = targetValue == null ? "-" : wearTextFull(targetValue);
  const runOverallText = runOverall == null ? "-" : wearTextFull(runOverall);
  const rowOverallValue = averageRelativeWearValue(list);
  const rowOverallText = rowOverallValue == null ? "-" : wearTextFull(rowOverallValue);
  const picked = list.map((row, index) => ({
    index: index + 1,
    asset_id: rowAssetId(row),
    name: itemDisplayName(row),
    relative_wear: wearTextFull(getRelativeWearValue(row)),
    absolute_wear: wearTextFull(getAbsoluteWearValue(row)),
    rarity: rarityName(row)
  }));
  if (typeof console.groupCollapsed === "function") {
    console.groupCollapsed(`${prefix} picked ${picked.length}/${mode}, target=${targetText}, algorithm=${runOverallText}, row_avg=${rowOverallText}`);
  } else {
    console.info(`${prefix} picked ${picked.length}/${mode}, target=${targetText}, algorithm=${runOverallText}, row_avg=${rowOverallText}`);
  }
  if (Math.abs(Number(rowOverallValue) - Number(runOverall)) > 1e-9) {
    console.warn(`${prefix} average mismatch: algorithm=${runOverallText}, row_avg=${rowOverallText}`);
  }
  console.info(`${prefix} picked_ids=${picked.map((item) => item.asset_id).join(",")}`);
  if (typeof console.table === "function") console.table(picked);
  else console.info(picked);
  if (typeof console.groupEnd === "function") console.groupEnd();
}
function buildCraftResultText(step, rowsById) {
  const gainedIds = Array.isArray(step && step.gained_ids)
    ? step.gained_ids.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  if (!gainedIds.length) return "产物：未返回";
  const rowsMap = rowsById instanceof Map ? rowsById : new Map();
  const parts = [];
  for (const id of gainedIds) {
    const row = rowsMap.get(id);
    if (row) {
      parts.push(`${itemDisplayName(row)}（${absoluteWearLabel(row)}）`);
    } else {
      parts.push("产物待同步");
    }
  }
  const missing = Array.isArray(step && step.missing_gained_ids)
    ? step.missing_gained_ids.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const pendingTail = missing.length ? `（待同步${missing.length}件）` : "";
  return `产物：${parts.join("，")}${pendingTail}`;
}
function applyCraftStepResultsToQueue({steps, pendingIndexes, rows}) {
  const list = Array.isArray(state.craftRecipeQueue) ? state.craftRecipeQueue : [];
  const stepList = Array.isArray(steps) ? steps : [];
  const indexList = Array.isArray(pendingIndexes) ? pendingIndexes : [];
  const rowsById = buildRowsByAssetId(rows);
  for (let i = 0; i < stepList.length; i += 1) {
    const queueIndex = Number(indexList[i]);
    if (!Number.isFinite(queueIndex) || queueIndex < 0 || queueIndex >= list.length) continue;
    const entry = list[queueIndex];
    if (!entry || typeof entry !== "object") continue;
    const step = stepList[i] || {};
    entry.status = "done";
    entry.spent_ids = Array.isArray(step.spent_ids)
      ? step.spent_ids.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    entry.gained_ids = Array.isArray(step.gained_ids)
      ? step.gained_ids.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    entry.result_text = buildCraftResultText(step, rowsById);
    entry.prepare_status = "ready";
    entry.prepare_message = "";
    entry.removed_missing_count = 0;
    entry.item_sources = {};
    // 执行完成后释放占位，允许继续选择新配方。
    entry.item_ids = [];
    entry.updated_at = Date.now();
  }
  ensureActiveCraftRecipe({createIfMissing: false});
  syncCraftSelectedIdsFromActiveRecipe();
}
function applyCraftPrepareResultsToQueue({prepareResults} = {}) {
  const list = Array.isArray(state.craftRecipeQueue) ? state.craftRecipeQueue : [];
  const rowsById = buildRowsByAssetId(getAllInventoryCraftableRows({rows: state.rows, includeComponentItems: true}));
  const componentSummaryMap = state.component && state.component.summary_map && typeof state.component.summary_map === "object"
    ? state.component.summary_map
    : {};
  for (const result of Array.isArray(prepareResults) ? prepareResults : []) {
    const queueIndex = Number(result && result.queue_index);
    if (!Number.isFinite(queueIndex) || queueIndex < 0 || queueIndex >= list.length) continue;
    const entry = list[queueIndex];
    if (!entry || typeof entry !== "object") continue;
    ensureCraftRecipeEntryMetadata(entry);
    const nextItemIds = normalizeCraftRecipeItemIds(result && result.item_ids);
    if (nextItemIds.length) {
      entry.item_ids = nextItemIds;
    }
    const sourceMap = result && typeof result.item_sources === "object" && result.item_sources ? result.item_sources : null;
    if (sourceMap) {
      const nextSources = {};
      for (const id of normalizeCraftRecipeItemIds(entry.item_ids)) {
        if (sourceMap[id] && typeof sourceMap[id] === "object") nextSources[id] = {...sourceMap[id]};
      }
      entry.item_sources = nextSources;
    }
    syncCraftRecipeEntryItemSources(entry, rowsById, componentSummaryMap);
    const status = String(result && result.status || "").trim();
    entry.status = status === "prepare_failed" ? "prepare_failed" : "pending";
    entry.prepare_status = String(result && result.prepare_status || "").trim() || (entry.status === "prepare_failed" ? "failed" : "ready");
    entry.prepare_message = String(result && result.prepare_message || "").trim();
    if (entry.status !== "prepare_failed" && entry.prepare_status === "ready") {
      entry.prepare_message = "";
    }
  }
  ensureActiveCraftRecipe({createIfMissing: false});
  syncCraftSelectedIdsFromActiveRecipe();
}
function buildPendingCraftQueueTitle({pendingIndex = 1, recipeRows = []} = {}) {
  const index = Math.max(1, Number(pendingIndex) || 1);
  return `#${index} | 平均相对磨损 ${averageRelativeWearText(recipeRows)}`;
}
function isCraftRecipeEditLocked() {
  return !!(state.refreshing || state.craftBusy || state.craftAssistSelecting || state.componentOpBusy);
}
function formatCraftSlotWear(row) {
  const value = getAbsoluteWearValue(row);
  if (value == null) return "-";
  return state.craftShowFullWear ? wearTextFull(value) : numberTextTrunc(value, 8);
}
function averageAbsoluteWearText(rows) {
  const values = (Array.isArray(rows) ? rows : [])
    .map((row) => getAbsoluteWearValue(row))
    .filter((value) => value != null && Number.isFinite(value));
  if (!values.length) return "-";
  const total = values.reduce((sum, value) => sum + value, 0);
  return wearTextFull(total / values.length);
}
function getCraftRowWearLabel(row) {
  if (!row || typeof row !== "object") return "-";
  const fromName = inferTradeupSimulationWearLabelFromName(
    row.market_hash_name || row.name || row.alchemy_name || ""
  );
  if (fromName) return fromName;
  const wear = getAbsoluteWearValue(row);
  if (wear == null) return "-";
  if (wear < 0.07) return "崭新出厂";
  if (wear < 0.15) return "略有磨损";
  if (wear < 0.38) return "久经沙场";
  if (wear < 0.45) return "破损不堪";
  return "战痕累累";
}
function getCraftRowWearToneClass(row) {
  const label = getCraftRowWearLabel(row);
  return getTradeupSimulationWearBadgeToneClass({wear_label: label});
}
function makeCraftQueueResultCardNode(row) {
  const imageUrl = preferredRowSkinImageUrl(row);
  const rarityVisual = getTradeupSimulationRarityVisuals(row && row.rarity_name);
  const styleParts = [`--simulation-card-rarity-color:${rarityVisual.color}`];
  if (imageUrl) styleParts.push(`--simulation-card-art-image:${cssUrlValue(imageUrl)}`);
  const wearValue = getAbsoluteWearValue(row);
  const wearText = wearValue != null ? (state.craftShowFullWear ? wearTextFull(wearValue) : numberTextTrunc(wearValue, 8)) : "-";
  const wearLabel = getCraftRowWearLabel(row);
  const wearToneClass = getCraftRowWearToneClass(row);
  const name = escapeHtml(itemDisplayName(row) || "未命名物品");
  const html = `
    <article class="simulation-output-card">
      <div class="simulation-card-art${imageUrl ? " has-image" : ""}" style='${styleParts.join(";")}'>
        <span class="simulation-card-wear-badge${wearToneClass}">${escapeHtml(wearLabel)}</span>
        ${renderTradeupSimulationWearStack(wearValue, wearText, wearToneClass)}
        ${imageUrl ? "" : '<span class="simulation-card-art-empty">暂无图</span>'}
      </div>
      <div class="simulation-card-content">
        <div class="simulation-card-name">${name}</div>
      </div>
    </article>
  `;
  const wrap = document.createElement("div");
  wrap.innerHTML = html.trim();
  const card = wrap.firstElementChild;
  card.title = `${itemDisplayName(row) || "未命名物品"}\n${wearLabel} ${wearText}`;
  return card;
}
function makeCraftSlotNode({row = null, rawId = "", onRemove = null, removeDisabled = false}) {
  const slot = document.createElement("div");
  slot.className = "craft-slot";
  if (!row && !rawId) {
    slot.classList.add("empty");
    slot.textContent = "空槽位";
    slot.title = "空槽位";
    return slot;
  }
  const assetId = row ? rowAssetId(row) : String(rawId || "").trim();
  const wearText = row ? formatCraftSlotWear(row) : "-";
  slot.classList.add("filled");
  if (row) decorateCraftSlotSkinImage(slot, row);
  slot.classList.toggle("full-wear-text", !!state.craftShowFullWear);
  const wear = document.createElement("div");
  wear.className = "craft-slot-wear";
  wear.textContent = wearText;
  wear.title = wearText;
  slot.append(wear);
  slot.title = row
    ? `${itemDisplayName(row) || "未命名物品"}\n磨损 ${wearText}`
    : (assetId || "未知物品");
  if (typeof onRemove === "function") {
    const removeRight = document.createElement("button");
    removeRight.type = "button";
    removeRight.className = "craft-slot-remove right";
    removeRight.title = "移除该槽位物品";
    removeRight.setAttribute("aria-label", "移除该槽位物品");
    removeRight.disabled = !!removeDisabled;
    removeRight.textContent = "×";
    removeRight.onclick = (evt) => {
      evt.stopPropagation();
      if (removeDisabled) return;
      onRemove(assetId);
    };
    slot.append(removeRight);
  }
  return slot;
}
function renderCraftQueueSlots({
  title,
  itemIds,
  rowsById,
  metaItems = [],
  showDeleteAction = false,
  onRemove = null,
  onRemoveItem = null,
  active = false,
  selectable = false,
  onActivate = null,
  extraClass = "",
  removeDisabled = false
}) {
  const wrap = document.createElement("div");
  wrap.className = `craft-queue-group${active ? " active" : ""}${selectable ? " selectable" : ""}${showDeleteAction ? " deletable" : ""}${extraClass ? ` ${extraClass}` : ""}`;
  if (selectable && typeof onActivate === "function") {
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "button");
    wrap.setAttribute("aria-label", "切换当前编辑配方");
    let clickTimer = null;
    wrap.onclick = () => {
      if (clickTimer) return;
      clickTimer = setTimeout(() => { clickTimer = null; onActivate(); }, 220);
    };
    wrap.ondblclick = () => {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      onActivate();
      if (typeof setCraftPredictorPanelOpen === "function") setCraftPredictorPanelOpen(true);
    };
    wrap.onkeydown = (evt) => {
      if (evt.key !== "Enter" && evt.key !== " ") return;
      evt.preventDefault();
      onActivate();
    };
  }
  const head = document.createElement("div");
  head.className = "craft-queue-group-head";
  const titleEl = document.createElement("div");
  titleEl.className = "craft-queue-group-title";
  titleEl.textContent = String(title || "").trim() || "#";
  head.append(titleEl);
  if (showDeleteAction && typeof onRemove === "function") {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "craft-queue-card-delete craft-queue-card-delete-floating";
    removeBtn.title = "删除该配方";
    removeBtn.setAttribute("aria-label", "删除该配方");
    removeBtn.textContent = "−";
    removeBtn.onclick = (evt) => {
      evt.stopPropagation();
      onRemove();
    };
    wrap.append(removeBtn);
  }
  wrap.append(head);

  const grid = document.createElement("div");
  grid.className = "craft-slot-grid";
  const ids = Array.isArray(itemIds) ? itemIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
  for (let i = 0; i < 10; i += 1) {
    const id = ids[i] || "";
    const row = id ? rowsById.get(id) || null : null;
    grid.append(makeCraftSlotNode({
      row,
      rawId: id,
      onRemove: id && typeof onRemoveItem === "function" ? onRemoveItem : null,
      removeDisabled
    }));
  }
  wrap.append(grid);
  const metaList = Array.isArray(metaItems) ? metaItems.filter((item) => item && String(item.text || "").trim()) : [];
  if (metaList.length) {
    const metaWrap = document.createElement("div");
    metaWrap.className = "craft-queue-meta-list";
    for (const meta of metaList) {
      const line = document.createElement("div");
      const tone = String(meta.tone || "").trim();
      line.className = `craft-queue-meta${tone ? ` ${tone}` : ""}`;
      line.textContent = String(meta.text || "").trim();
      metaWrap.append(line);
    }
    wrap.append(metaWrap);
  }
  return wrap;
}
function getCraftCandidates() {
  return Array.isArray(state.craftCandidateRows) ? state.craftCandidateRows : [];
}
function getCraftCoolingHintText(rows) {
  const coolingRows = getCraftCoolingRows(rows);
  if (!coolingRows.length) return "冷却中可选：无";
  return `冷却中可选：${coolingRows.length}件`;
}
function getCraftCoolingHintTextFromStats(stats) {
  const count = Math.max(0, Number(stats && stats.cooling_count != null ? stats.cooling_count : 0) || 0);
  return count > 0 ? `冷却中可选：${count}件` : "冷却中可选：无";
}
function craftItemCooldownLabel(row) {
  return coolingUnlockTs(row) > 0 ? "冷却中" : "无";
}
function craftGroupCooldownLabel(row) {
  const coolingCount = Math.max(0, Number(row && row.cooling_count || 0));
  if (coolingCount <= 0) return "无";
  return `${coolingCount}件冷却中`;
}
function syncCraftSelection() {
  syncCraftSelectedIdsFromActiveRecipe();
}
function getCraftSelectedRows() {
  syncCraftSelection();
  const rowMap = buildRowsByAssetId(getAllInventoryCraftableRows({rows: state.rows, includeComponentItems: true}));
  const rows = [];
  for (const id of state.craftSelectedItemIds) {
    const row = rowMap.get(id);
    if (row) rows.push(row);
  }
  return rows;
}
function getTradeUpRecipeFromRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length !== 10) {
    return {ok: false, reason: `需选择 10 件，当前 ${list.length} 件`, text: "配方：-"};
  }
  const raritySet = new Set(list.map((x) => Number(x.rarity || 0)));
  if (raritySet.size !== 1) {
    return {ok: false, reason: "所选 10 件稀有度不一致", text: "配方：稀有度不一致"};
  }
  const rarity = [...raritySet][0];
  if (rarity < 1 || rarity > 5) {
    return {ok: false, reason: `该稀有度不支持汰换（${rarity}）`, text: "配方：当前稀有度不支持"};
  }
  const stSet = new Set(list.map((x) => (isRowStatTrak(x) ? 1 : 0)));
  if (stSet.size !== 1) {
    return {ok: false, reason: "必须全是 StatTrak 或全是普通", text: "配方：品质不一致"};
  }
  const stattrak = [...stSet][0] === 1;
  const recipe = stattrak ? rarity + 9 : rarity - 1;
  const rarityLabel = craftRarityLabel(rarity);
  const nextLabel = craftRarityLabel(rarity + 1);
  const prefix = stattrak ? "StatTrak " : "";
  return {
    ok: true,
    recipe,
    rarity,
    stattrak,
    text: `配方：${prefix}${rarityLabel} -> ${prefix}${nextLabel}（recipe ${recipe}）`
  };
}
function craftRarityValue(row) {
  const n = Number(row && row.rarity);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}
function craftRarityLabel(value) {
  const normalized = normalizeCraftPredictorRarityLabel(value);
  if (normalized) return normalized;
  const rarity = Math.trunc(Number(value) || 0);
  return normalizeCraftPredictorRarityLabel(RARITY_MAP[rarity] || "") || `R${rarity || 0}`;
}
function toggleCraftItemSelection(itemId) {
  const key = String(itemId || "").trim();
  if (!key) return;
  if (isCraftRecipeEditLocked()) return;
  const active = ensureActiveCraftRecipe({createIfMissing: true});
  if (!active) return;
  const activeId = String(active.id || "").trim();
  const currentIds = normalizeCraftRecipeItemIds(active.item_ids);
  const rowMap = buildRowsByAssetId(getCraftCandidates());
  const allRowsById = buildRowsByAssetId(getAllInventoryCraftableRows({rows: state.rows, includeComponentItems: true}));
  const nextRow = rowMap.get(key) || allRowsById.get(key) || null;
  if (currentIds.includes(key)) {
    setCraftStatus("该物品已在当前配方槽位中，可在槽位角标移除", true);
    return;
  }
  const occupied = findPendingRecipeByItemId(key, {excludeRecipeId: activeId});
  if (occupied) {
    setCraftStatus("该物品已在其他配方槽位中，不能重复添加", true);
    return;
  }
  if (currentIds.length >= 10) {
    setCraftStatus("当前配方已满 10 件，请先新增配方或移除槽位物品", true);
    return;
  }
  if (nextRow && currentIds.length > 0) {
    const currentRows = currentIds.map((id) => allRowsById.get(id) || rowMap.get(id)).filter(Boolean);
    if (currentRows.length > 0) {
      const currentRarity = craftRarityValue(currentRows[0]);
      const nextRarity = craftRarityValue(nextRow);
      if (currentRarity > 0 && nextRarity > 0 && currentRarity !== nextRarity) {
        setCraftStatus(
          `当前配方已使用 ${craftRarityLabel(currentRarity)}，不能混入 ${craftRarityLabel(nextRarity)}（单配方需同一稀有度）`,
          true
        );
        return;
      }
    }
  }
  ensureCraftRecipeEntryMetadata(active);
  active.item_ids = [...currentIds, key];
  if (nextRow) {
    active.item_sources = {
      ...(active.item_sources && typeof active.item_sources === "object" ? active.item_sources : {}),
      [key]: buildCraftItemSourceSnapshot(nextRow)
    };
  }
  const nextRowsById = new Map(allRowsById);
  if (nextRow) nextRowsById.set(key, nextRow);
  resetCraftRecipeEntryPreparation(active);
  syncCraftSelectedIdsFromActiveRecipe();
  if (typeof focusCraftPredictorOnActiveDraft === "function") {
    focusCraftPredictorOnActiveDraft({autoOpen: true, preferredRowsById: nextRowsById});
  }
  clearCraftStatus();
}
function buildCraftGroupRows(candidates) {
  const baseGroups = buildGroupRows(candidates);
  return baseGroups.map((group) => {
    const rows = [...(Array.isArray(group.items) ? group.items : [])].sort((a, b) => {
      const wa = Number(a.float_value || 0);
      const wb = Number(b.float_value || 0);
      if (wa !== wb) return state.wearSort === "desc" ? wb - wa : wa - wb;
      return assetIdNumber(a) - assetIdNumber(b);
    });
    return {
      ...group,
      child_rows: rows,
      craft_expandable: rows.length > 1
    };
  });
}
function renderCraftGrouped(candidates) {
  if (!ui.craftSelectionList) return;
  if (!candidates.length) {
    if (state.craftCandidateLoading) {
      ui.craftSelectionList.innerHTML = "<div class=\"empty\">候选物品同步中...</div>";
    } else {
      ui.craftSelectionList.innerHTML = state.craftUseComponentItems
        ? "<div class=\"empty\">全库存中暂无可用炼金候选，或当前实际可从组件中取出的数量已不足以继续选择组件物品</div>"
        : "<div class=\"empty\">主库存中暂无可炼金物品</div>";
    }
    syncCraftSelectionListClearance();
    return;
  }
  const showSeed = !!state.craftShowSeed;
  const showCooling = !!state.craftIncludeCooling;
  const hideCollection = !!state.craftHideCollection;
  const hideQuantity = !!state.craftHideQuantity;
  const groupedRows = buildCraftGroupRows(candidates);
  const queuedIds = getQueuedCraftItemIds();
  const table = document.createElement("table");
  table.className = "group-table";
  const quantityTitle = showCooling ? "数量(可用/冷却中)" : "数量";
  const headers = [
    "<th><div class=\"th-sort-wrap\"><span>稀有度</span><span class=\"sort-stack\"><button type=\"button\" class=\"arrow-tri up col-sort-btn\" data-sort-key=\"rarity\" data-sort-dir=\"asc\" title=\"稀有度由低到高\" aria-label=\"稀有度由低到高\"></button><button type=\"button\" class=\"arrow-tri down col-sort-btn\" data-sort-key=\"rarity\" data-sort-dir=\"desc\" title=\"稀有度由高到低\" aria-label=\"稀有度由高到低\"></button></span></div></th>",
    "<th class=\"group-name-heading\">名称</th>"
  ];
  if (!hideCollection) headers.push("<th><div class=\"th-sort-wrap\"><span>收藏品</span><span class=\"sort-stack\"><button type=\"button\" class=\"arrow-tri up col-sort-btn\" data-sort-key=\"collection\" data-sort-dir=\"asc\" title=\"收藏品按字符升序\" aria-label=\"收藏品按字符升序\"></button><button type=\"button\" class=\"arrow-tri down col-sort-btn\" data-sort-key=\"collection\" data-sort-dir=\"desc\" title=\"收藏品按字符降序\" aria-label=\"收藏品按字符降序\"></button></span></div></th>");
  if (!hideQuantity) headers.push(`<th><div class="th-sort-wrap"><span>${quantityTitle}</span><span class="sort-stack"><button type="button" class="arrow-tri up col-sort-btn" data-sort-key="quantity" data-sort-dir="asc" title="数量由低到高" aria-label="数量由低到高"></button><button type="button" class="arrow-tri down col-sort-btn" data-sort-key="quantity" data-sort-dir="desc" title="数量由高到低" aria-label="数量由高到低"></button></span></div></th>`);
  if (showSeed) headers.push("<th>种子</th>");
  headers.push("<th><div class=\"th-sort-wrap\"><span>磨损</span><span class=\"sort-stack\"><button type=\"button\" class=\"arrow-tri up col-sort-btn\" data-sort-key=\"wear\" data-sort-dir=\"asc\" title=\"磨损由低到高\" aria-label=\"磨损由低到高\"></button><button type=\"button\" class=\"arrow-tri down col-sort-btn\" data-sort-key=\"wear\" data-sort-dir=\"desc\" title=\"磨损由高到低\" aria-label=\"磨损由高到低\"></button></span></div></th>");
  if (showCooling) headers.push("<th>冷却</th>");
  table.innerHTML = `<thead><tr>${headers.join("")}</tr></thead>`;
  refreshSortArrowStyles(table);
  for (const btn of table.querySelectorAll(".col-sort-btn")) {
    btn.onclick = (evt) => {
      evt.stopPropagation();
      const key = String(btn.dataset.sortKey || "");
      const dir = String(btn.dataset.sortDir || "");
      if ((key !== "wear" && key !== "rarity" && key !== "quantity" && key !== "collection") || (dir !== "asc" && dir !== "desc")) return;
      if (key === "wear") state.wearSort = dir;
      else if (key === "rarity") state.raritySort = dir;
      else if (key === "collection") state.collectionSort = dir;
      else state.quantitySort = dir;
      renderCraftPage();
    };
  }

  const tbody = document.createElement("tbody");
  for (const row of groupedRows) {
    const groupKey = `craft::${row.name}`;
    const expanded = state.expandedGroups.has(groupKey);
    const selectableRows = row.child_rows.filter((x) => !isComponentRow(x) && !queuedIds.has(rowAssetId(x)));
    const selectableGroupIds = [...new Set(selectableRows.map((x) => rowAssetId(x)).filter(Boolean))];
    const groupRows = row.child_rows.filter((x) => !isComponentRow(x));
    const groupIds = [...new Set(groupRows.map((x) => rowAssetId(x)).filter(Boolean))];
    const selectedCount = groupIds.reduce((acc, id) => acc + (state.craftSelectedItemIds.has(id) ? 1 : 0), 0);
    const componentGroup = row.items.some((x) => isComponentRow(x));
    const parentRarityText = componentGroup ? "" : row.parent_rarity;
    const parentCooldownText = componentGroup ? "" : craftGroupCooldownLabel(row);
    const parent = document.createElement("tr");
    parent.className = `group-parent${selectedCount > 0 ? " selected" : ""}`;
    const parentCells = [
      `<td>${parentRarityText}</td>`,
      `<td>${row.name}</td>`
    ];
    if (!hideCollection) parentCells.push(`<td>${row.collection || ""}</td>`);
    if (!hideQuantity) parentCells.push(`<td>${showCooling ? `${row.available_count}/${row.cooling_count}` : row.available_count}</td>`);
      if (showSeed) parentCells.push("<td></td>");
      parentCells.push(`<td>${row.wear_range_text || ""}</td>`);
      if (showCooling) parentCells.push(`<td>${parentCooldownText}</td>`);
      parent.innerHTML = parentCells.join("");
      const craftNameCell = parent.children[1];
      decorateGroupNameCell(craftNameCell, row.name, preferredRowsSkinImageUrl(row.items));
      parent.onclick = () => {
        if (expanded) {
          state.expandedGroups.delete(groupKey);
        renderCraftPage();
        return;
      }
      if (row.craft_expandable) {
        state.expandedGroups.add(groupKey);
        renderCraftPage();
        return;
      }
      if (!selectableGroupIds.length) {
        if (row.child_rows.some((x) => queuedIds.has(rowAssetId(x)))) {
          setCraftStatus("该组物品已在配方预览中，不能重复选择", true);
        }
        return;
      }
      toggleCraftItemSelection(selectableGroupIds[0]);
      renderCraftPage();
    };
    tbody.append(parent);
    if (!expanded) continue;
    for (const item of row.child_rows) {
      const itemId = rowAssetId(item);
      const componentRow = isComponentRow(item);
      const locked = queuedIds.has(itemId);
      const selectable = !componentRow && !locked;
      const selected = state.craftSelectedItemIds.has(itemId);
      const child = document.createElement("tr");
      child.className = `group-child${selectable ? " selectable" : ""}${selected ? " selected" : ""}${locked ? " locked" : ""}${!componentRow && coolingUnlockTs(item) > 0 ? " cooling" : ""}`;
      const childCells = [
        "<td></td>",
        `<td>${relativeWearDisplayLabel(item)}</td>`
      ];
      if (!hideCollection) childCells.push("<td></td>");
      if (!hideQuantity) childCells.push("<td></td>");
      if (showSeed) childCells.push(`<td>${Number(item.paint_seed || 0)}</td>`);
      childCells.push(`<td>${itemHasWear(item) ? formatVisibleWearText(item.float_value, 8) : ""}</td>`);
      if (showCooling) {
        childCells.push(`<td>${componentRow ? "" : (locked ? "已在配方预览" : craftItemCooldownLabel(item))}</td>`);
      }
      child.innerHTML = childCells.join("");
      if (selectable) {
        child.onclick = (evt) => {
          evt.stopPropagation();
          toggleCraftItemSelection(itemId);
          renderCraftPage();
        };
      }
      tbody.append(child);
    }
  }
  table.append(tbody);
  ui.craftSelectionList.replaceChildren(table);
  syncCraftSelectionListClearance();
}
function syncCraftStatusDom() {
  if (!ui.craftStatusText) return;
  ui.craftStatusText.textContent = state.craftStatusText || "点击左侧物品可填充当前高亮槽位";
  ui.craftStatusText.classList.toggle("error", !!state.craftStatusError);
}
function setCraftStatus(text, isError = false) {
  state.craftStatusText = String(text || "").trim();
  state.craftStatusError = !!isError;
  if (isError && state.craftStatusText) showErrorToast(state.craftStatusText);
  syncCraftStatusDom();
}
function clearCraftStatus() {
  state.craftStatusText = "";
  state.craftStatusError = false;
  syncCraftStatusDom();
}
function buildCraftComponentProgressDisplay(data) {
  const stage = String(data && data.stage || "").trim();
  const phase = String(data && data.phase || "").trim();
  if (stage === "prepare") {
    const total = Math.max(0, Number(data && data.total || 0) || 0);
    const processed = Math.max(0, Math.min(total || Number.MAX_SAFE_INTEGER, Number(data && data.processed || 0) || 0));
    const success = Math.max(0, Number(data && data.success || 0) || 0);
    const failed = Math.max(0, Number(data && data.failed || 0) || 0);
    const readyCount = Math.max(0, Number(data && data.ready_recipe_count || 0) || 0);
    const skippedCount = Math.max(0, Number(data && data.skipped_recipe_count || 0) || 0);
    if (phase === "done") {
      return {
        title: total > 0 ? `组件取物完成 ${processed}/${total}` : "组件取物校验完成",
        detail: `可执行 ${readyCount} 组${skippedCount > 0 ? `，跳过 ${skippedCount} 组` : ""}`
      };
    }
    return {
      title: total > 0 ? `正在从组件中取出物品 ${processed}/${total}` : "正在校验组件物品",
      detail: `成功 ${success}，失败 ${failed}`
    };
  }
  if (stage === "craft") {
    const total = Math.max(0, Number(data && data.total || 0) || 0);
    const index = Math.max(0, Number(data && data.index || 0) || 0);
    const completed = Math.max(0, Number(data && data.completed || 0) || 0);
    const current = total > 0 ? Math.min(Math.max(index, 1), total) : Math.max(index, 1);
    if (phase === "failed") {
      return {
        title: total > 0 ? `第 ${current}/${total} 组汰换失败` : "汰换失败",
        detail: String(data && data.message || "").trim() || "请查看下方状态栏中的错误信息"
      };
    }
    if (phase === "done") {
      return {
        title: total > 0 ? `第 ${current}/${total} 组汰换完成` : "汰换完成",
        detail: `已完成 ${completed}/${total} 组`
      };
    }
    return {
      title: total > 0 ? `正在执行第 ${current}/${total} 组汰换` : "正在执行汰换",
      detail: `已完成 ${completed}/${total} 组`
    };
  }
  return {
    title: "正在执行炼金任务",
    detail: "请稍候..."
  };
}
let craftExecutionPercentAnimationFrame = 0;
function normalizeCraftExecutionOverlayPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}
function cancelCraftExecutionPercentAnimation() {
  if (craftExecutionPercentAnimationFrame && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(craftExecutionPercentAnimationFrame);
  }
  craftExecutionPercentAnimationFrame = 0;
}
function stepCraftExecutionOverlayPercentAnimation() {
  craftExecutionPercentAnimationFrame = 0;
  const mode = String(state.craftProgressMode || "").trim();
  if (mode !== "connecting" || !state.craftProgressVisible) return;
  const current = normalizeCraftExecutionOverlayPercent(state.craftProgressPercent);
  const target = normalizeCraftExecutionOverlayPercent(state.craftProgressPercentTarget);
  if (current >= target) {
    applyCraftExecutionOverlayController({
      owner: craftExecutionOverlayOwner,
      percent: target
    });
    return;
  }
  const delta = target - current;
  const progressRatio = target > 0 ? current / target : 1;
  let step = 1;
  if (progressRatio >= 0.8) step = 6;
  else if (progressRatio >= 0.62) step = 5;
  else if (progressRatio >= 0.42) step = 4;
  else if (progressRatio >= 0.2) step = 3;
  else if (progressRatio >= 0.08) step = 2;
  applyCraftExecutionOverlayController({
    owner: craftExecutionOverlayOwner,
    percent: Math.min(target, current + step)
  });
  if (state.craftProgressPercent < target && typeof requestAnimationFrame === "function") {
    craftExecutionPercentAnimationFrame = requestAnimationFrame(stepCraftExecutionOverlayPercentAnimation);
  }
}
function queueCraftExecutionPercentAnimation() {
  const mode = String(state.craftProgressMode || "").trim();
  if (mode !== "connecting" || !state.craftProgressVisible) {
    cancelCraftExecutionPercentAnimation();
    return;
  }
  const current = normalizeCraftExecutionOverlayPercent(state.craftProgressPercent);
  const target = normalizeCraftExecutionOverlayPercent(state.craftProgressPercentTarget);
  if (current >= target) {
    applyCraftExecutionOverlayController({
      owner: craftExecutionOverlayOwner,
      percent: target
    });
    return;
  }
  if (typeof requestAnimationFrame !== "function") {
    applyCraftExecutionOverlayController({
      owner: craftExecutionOverlayOwner,
      percent: target
    });
    return;
  }
  if (craftExecutionPercentAnimationFrame) return;
  craftExecutionPercentAnimationFrame = requestAnimationFrame(stepCraftExecutionOverlayPercentAnimation);
}
function renderCraftExecutionOverlay() {
  if (!ui.craftExecutionOverlay || !ui.craftExecutionOverlayTitle || !ui.craftExecutionOverlayDetail) return;
  const mode = String(state.craftProgressMode || "").trim();
  const isConnecting = mode === "connecting";
  const isComponentPrepare = mode === "component_prepare";
  const show = !!state.craftProgressEnabled && !!state.craftProgressVisible && !isComponentPrepare;
  const percent = normalizeCraftExecutionOverlayPercent(state.craftProgressPercent);
  ui.craftExecutionOverlay.classList.toggle("hidden", !show);
  ui.craftExecutionOverlay.classList.toggle("connecting", show && isConnecting);
  if (ui.craftExecutionProgress) {
    ui.craftExecutionProgress.classList.toggle("hidden", !show || !isConnecting);
    if (ui.craftExecutionProgress.style && typeof ui.craftExecutionProgress.style.setProperty === "function") {
      ui.craftExecutionProgress.style.setProperty("--craft-execution-progress", `${percent}%`);
    }
  }
  if (ui.craftExecutionOverlayPercent) {
    ui.craftExecutionOverlayPercent.textContent = `${percent}%`;
  }
  ui.craftExecutionOverlayTitle.textContent = state.craftProgressTitle || "正在执行炼金任务";
  ui.craftExecutionOverlayDetail.textContent = state.craftProgressDetail || "请稍候...";
  if (typeof renderCraftAssistBusyMask === "function") renderCraftAssistBusyMask();
}
function setCraftExecutionOverlayState({owner = "", enabled, visible = false, mode = "", percent = 0, title = "", detail = ""} = {}) {
  const ownership = resolveCraftExecutionOverlayOwner(owner);
  if (!ownership.canWrite) return false;
  const nextMode = String(mode || "").trim();
  const normalizedPercent = normalizeCraftExecutionOverlayPercent(percent);
  const prevMode = String(state.craftProgressMode || "").trim();
  let nextPercent = normalizedPercent;
  if (nextMode === "connecting") {
    if (prevMode !== "connecting") {
      nextPercent = 0;
    } else if (state.craftProgressPercent > normalizedPercent) {
      nextPercent = normalizedPercent;
    } else {
      nextPercent = normalizeCraftExecutionOverlayPercent(state.craftProgressPercent);
    }
  } else {
    cancelCraftExecutionPercentAnimation();
  }
  const applied = applyCraftExecutionOverlayController({
    owner: ownership.effectiveOwner || owner,
    enabled,
    visible,
    mode: nextMode,
    percent: nextPercent,
    percentTarget: normalizedPercent,
    title,
    detail
  });
  if (nextMode === "connecting" && visible && applied) queueCraftExecutionPercentAnimation();
}
function clearCraftExecutionOverlayState({owner = ""} = {}) {
  return applyCraftExecutionOverlayController({owner, clear: true});
}
function createConnectProgressReporter() {
  return ({percent = 0, title = "正在连接账号", detail = ""} = {}) => {
    setCraftExecutionOverlayState({
      owner: "connect_flow",
      enabled: true,
      visible: true,
      mode: "connecting",
      percent,
      title,
      detail
    });
  };
}
async function refreshWithConnectionOverlay({
  preferCraft = false,
  usernameOverride = "",
  force = false,
  silentRateLimit = false,
  silentInfo = false,
  forceOverlay = false,
  keepSelectedIds = null
} = {}) {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可连接账号并刷新真实库存。",
    view: "login"
  }) === false) {
    return {ok: false, message: "请先登录"};
  }
  const username = String(
    usernameOverride ||
    (preferCraft
      ? ((ui.craftAccountSelect && ui.craftAccountSelect.value) || (ui.accountSelect && ui.accountSelect.value))
      : ((ui.accountPageSelect && ui.accountPageSelect.value) || (ui.accountSelect && ui.accountSelect.value) || (ui.craftAccountSelect && ui.craftAccountSelect.value))) ||
    state.currentAccountUsername ||
    ""
  ).trim();
  const shouldShowOverlay = !!username && (forceOverlay || String(state.connectedUsername || "").trim() !== username);
  const onProgress = shouldShowOverlay ? createConnectProgressReporter() : null;
  try {
    return await doRefresh({
      usernameOverride: username,
      force,
      silentRateLimit,
      silentInfo,
      onProgress,
      keepSelectedIds
    });
  } finally {
    if (onProgress) clearCraftExecutionOverlayState({owner: "connect_flow"});
  }
}
let craftExecutionOverlayOwner = "";
function normalizeCraftExecutionOverlayOwner(owner) {
  return String(owner || "").trim();
}
function resolveCraftExecutionOverlayOwner(owner = "") {
  const requestedOwner = normalizeCraftExecutionOverlayOwner(owner);
  const activeOwner = !!state.craftProgressEnabled ? normalizeCraftExecutionOverlayOwner(craftExecutionOverlayOwner) : "";
  const effectiveOwner = requestedOwner || activeOwner;
  return {
    activeOwner,
    effectiveOwner,
    canWrite: !activeOwner || !effectiveOwner || activeOwner === effectiveOwner
  };
}
function applyCraftExecutionOverlayController({
  owner = "",
  enabled,
  visible,
  mode,
  percent,
  percentTarget,
  title,
  detail,
  clear = false
} = {}) {
  const ownership = resolveCraftExecutionOverlayOwner(owner);
  if (!ownership.canWrite) return false;
  if (clear) {
    cancelCraftExecutionPercentAnimation();
    state.craftProgressEnabled = false;
    state.craftProgressVisible = false;
    state.craftProgressMode = "";
    state.craftProgressPercent = 0;
    state.craftProgressPercentTarget = 0;
    state.craftProgressTitle = "";
    state.craftProgressDetail = "";
    craftExecutionOverlayOwner = "";
    renderCraftExecutionOverlay();
    return true;
  }
  if (ownership.effectiveOwner) craftExecutionOverlayOwner = ownership.effectiveOwner;
  if (enabled !== undefined) state.craftProgressEnabled = !!enabled;
  if (visible !== undefined) state.craftProgressVisible = !!visible;
  if (mode !== undefined) state.craftProgressMode = String(mode || "").trim();
  if (percent !== undefined) state.craftProgressPercent = normalizeCraftExecutionOverlayPercent(percent);
  if (percentTarget !== undefined) state.craftProgressPercentTarget = normalizeCraftExecutionOverlayPercent(percentTarget);
  if (title !== undefined) state.craftProgressTitle = String(title || "").trim();
  if (detail !== undefined) state.craftProgressDetail = String(detail || "").trim();
  renderCraftExecutionOverlay();
  return true;
}
function applyCraftComponentProgressEvent(data) {
  const display = buildCraftComponentProgressDisplay(data);
  setCraftExecutionOverlayState({
    owner: "craft_flow",
    enabled: true,
    visible: true,
    mode: String(data && data.stage || "").trim() === "prepare" ? "component_prepare" : "",
    title: display.title,
    detail: display.detail
  });
}
function syncCraftSettingsControls(allCraftRows = null) {
  const useComponentItems = !!state.craftUseComponentItems;
  const includeCooling = !!state.craftIncludeCooling;
  const showSeed = !!state.craftShowSeed;
  const showFullWear = !!state.craftShowFullWear;
  const showCoolingTime = !!state.craftShowCoolingTime;
  if (ui.craftUseComponentItems) ui.craftUseComponentItems.checked = useComponentItems;
  if (ui.componentCraftUseComponentItems) ui.componentCraftUseComponentItems.checked = useComponentItems;
  if (ui.craftIncludeCooling) ui.craftIncludeCooling.checked = includeCooling;
  if (ui.componentCraftIncludeCooling) ui.componentCraftIncludeCooling.checked = includeCooling;
  if (ui.craftShowSeed) ui.craftShowSeed.checked = showSeed;
  if (ui.componentCraftShowSeed) ui.componentCraftShowSeed.checked = showSeed;
  if (ui.craftShowFullWear) ui.craftShowFullWear.checked = showFullWear;
  if (ui.componentCraftShowFullWear) ui.componentCraftShowFullWear.checked = showFullWear;
  if (ui.craftShowCoolingTime) ui.craftShowCoolingTime.checked = showCoolingTime;
  if (ui.componentCraftShowCoolingTime) ui.componentCraftShowCoolingTime.checked = showCoolingTime;
  const fastMode = !!state.craftAssistFastMode;
  const wearOffset = normalizeCraftAssistWearOffset(state.craftAssistWearOffset, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET);
  state.craftAssistWearOffset = wearOffset;
  if (ui.craftAssistFastMode) ui.craftAssistFastMode.checked = fastMode;
  if (ui.craftAssistApproachMode) ui.craftAssistApproachMode.checked = !!state.craftAssistApproachMode;
  if (ui.craftAssistWearOffsetPct && document.activeElement !== ui.craftAssistWearOffsetPct) {
    ui.craftAssistWearOffsetPct.value = craftAssistWearOffsetText(wearOffset);
  }
  const hideCollection = !!state.craftHideCollection;
  const hideQuantity = !!state.craftHideQuantity;
  if (ui.craftHideCollection) ui.craftHideCollection.checked = hideCollection;
  if (ui.componentCraftHideCollection) ui.componentCraftHideCollection.checked = hideCollection;
  if (ui.craftHideQuantity) ui.craftHideQuantity.checked = hideQuantity;
  if (ui.componentCraftHideQuantity) ui.componentCraftHideQuantity.checked = hideQuantity;
  const hintText = state.craftCandidateStats
    ? getCraftCoolingHintTextFromStats(state.craftCandidateStats)
    : getCraftCoolingHintText(Array.isArray(allCraftRows)
      ? allCraftRows
      : getAllInventoryCraftableRows({includeComponentItems: state.craftUseComponentItems}));
  if (ui.craftCoolingHint) ui.craftCoolingHint.textContent = hintText;
  if (ui.componentCraftCoolingHint) ui.componentCraftCoolingHint.textContent = hintText;
}
function setCraftSettingsPanelOpen(open) {
  state.craftSettingsOpen = !!open;
  if (ui.craftSettingsPanel) ui.craftSettingsPanel.classList.toggle("hidden", !state.craftSettingsOpen);
  if (ui.componentCraftSettingsPanel) ui.componentCraftSettingsPanel.classList.toggle("hidden", !state.craftSettingsOpen);
  if (ui.craftSettingsBtn) ui.craftSettingsBtn.classList.toggle("active", state.craftSettingsOpen);
  if (ui.componentCraftSettingsBtn) ui.componentCraftSettingsBtn.classList.toggle("active", state.craftSettingsOpen);
  if (state.craftSettingsOpen) syncCraftSettingsControls();
}
function clampWear01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.max(0, Math.min(1, Number(fallback) || 0));
  return Math.max(0, Math.min(1, n));
}
function wearText2(value) {
  return clampWear01(value, 0).toFixed(2);
}
function wearText6(value) {
  return clampWear01(value, 0).toFixed(WEAR_INPUT_DECIMALS);
}
function normalizeCraftAssistCount(value, fallback = 0) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return Math.max(0, Math.min(10, Math.trunc(Number(fallback) || 0)));
  return Math.max(0, Math.min(10, n));
}
function normalizeCraftAssistEntryCount(value, fallback = 1) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return Math.max(1, Math.min(10, Math.trunc(Number(fallback) || 1)));
  return Math.max(1, Math.min(10, n));
}
function normalizeCraftAssistApplyCount(value, fallback = 1) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return Math.max(1, Math.min(100, Math.trunc(Number(fallback) || 1)));
  return Math.max(1, Math.min(100, n));
}
function normalizeCraftAssistWearOffset(value, fallback = DEFAULT_CRAFT_ASSIST_WEAR_OFFSET) {
  const fallbackNum = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNum)
    ? Math.max(0, Math.min(1, fallbackNum))
    : DEFAULT_CRAFT_ASSIST_WEAR_OFFSET;
  const n = Number(value);
  if (!Number.isFinite(n)) return safeFallback;
  return Math.max(0, Math.min(1, n));
}
function normalizeLegacyCraftAssistWearOffsetPct(value, fallback = DEFAULT_CRAFT_ASSIST_WEAR_OFFSET) {
  const n = Number(value);
  if (!Number.isFinite(n)) return normalizeCraftAssistWearOffset(fallback, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET);
  return normalizeCraftAssistWearOffset(n / 100, fallback);
}
function craftAssistWearOffsetText(value) {
  const n = normalizeCraftAssistWearOffset(value, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET);
  return n.toFixed(8).replace(/\.?0+$/, "");
}
function setCraftAssistPendingUiState(action = "", presetId = "") {
  state.craftAssistPendingUiAction = String(action || "").trim();
  state.craftAssistPendingPresetId = String(presetId || "").trim();
}
function clearCraftAssistPendingUiState() {
  setCraftAssistPendingUiState("", "");
}
function isCraftAssistPendingUiAction(action, {presetId = ""} = {}) {
  if (!state.craftAssistSelecting) return false;
  const currentAction = String(state.craftAssistPendingUiAction || "").trim();
  const targetAction = String(action || "").trim();
  if (!targetAction || currentAction !== targetAction) return false;
  if (targetAction !== "preset_apply") return true;
  return String(state.craftAssistPendingPresetId || "").trim() === String(presetId || "").trim();
}
function rejectCraftAssistBusyUiAction() {
  if (!state.craftAssistSelecting) return false;
  setCraftStatus("辅助选材处理中，请稍后再试", true);
  return true;
}
function getCraftAssistOffsetSettingHintText() {
  const offsetText = craftAssistWearOffsetText(state.craftAssistWearOffset);
  return `当前产物偏移阈值 ${offsetText}（可在炼金设置中调整）`;
}
function normalizeCraftAssistFilterMode(mode) {
  return String(mode || "").trim() === "absolute" ? "absolute" : "relative";
}
function getCraftAssistFilterMode() {
  return state.craftAssistUseAbsoluteWear ? "absolute" : "relative";
}
function getCraftAssistFilterUseRelative() {
  return getCraftAssistFilterMode() !== "absolute";
}
function normalizeCraftAssistRole(role) {
  return String(role || "").trim() === "aux" ? "aux" : "main";
}
function craftAssistTargetCountFromMaterials(materials) {
  const list = Array.isArray(materials) ? materials : [];
  if (!list.length) return 10;
  // TODO: 未来根据第一个材料索引规则自动判定 5 合 1 / 10 合 1。
  return 10;
}
function normalizeCraftAssistDirection(role, direction) {
  const defaultDirection = normalizeCraftAssistRole(role) === "aux" ? "lt" : "gt";
  const value = String(direction || "").trim();
  if (value === "lt" || value === "gt") return value;
  return defaultDirection;
}
function makeCraftAssistUid(prefix = "assist") {
  return `${String(prefix || "assist").trim() || "assist"}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}
function normalizeCraftAssistNameList(value) {
  const source = Array.isArray(value)
    ? value
    : (value == null ? [] : [value]);
  const out = [];
  const seen = new Set();
  for (const item of source) {
    const name = String(item || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
function craftAssistMaterialNames(material) {
  const itemNames = Array.isArray(material && material.items)
    ? material.items.map((item) => String(item && item.name || "").trim()).filter(Boolean)
    : [];
  if (itemNames.length) {
    return normalizeCraftAssistNameList(itemNames);
  }
  const names = normalizeCraftAssistNameList(material && material.names);
  if (names.length) return names;
  const fallbackName = String(material && material.name || "").trim();
  return fallbackName ? [fallbackName] : [];
}
function craftAssistMaterialLabel(material) {
  const names = craftAssistMaterialNames(material);
  return names.length ? names.join(" / ") : "-";
}
function makeCraftAssistDefaultRange(names, {useRelative = getCraftAssistFilterUseRelative(), rows = null} = {}) {
  const nameList = normalizeCraftAssistNameList(names);
  if (!nameList.length) {
    return {wear_min: 0, wear_max: 1};
  }
  const first = resolveCraftMaterialWearConstraintByName(nameList[0], {useRelative, rows});
  let min = Number(first.min);
  let max = Number(first.max);
  for (let i = 1; i < nameList.length; i += 1) {
    const current = resolveCraftMaterialWearConstraintByName(nameList[i], {useRelative, rows});
    min = Math.max(min, Number(current.min));
    max = Math.min(max, Number(current.max));
  }
  if (!(max >= min)) {
    min = Number(first.min);
    max = Number(first.max);
  }
  return {wear_min: min, wear_max: max};
}
function normalizeCraftAssistMaterialEntry(entry, {targetWear = state.craftAssistTargetWear, idPrefix = "assist", useRelative = getCraftAssistFilterUseRelative(), rows = null} = {}) {
  const shared = globalThis && globalThis.craftAssistItemWearShared;
  if (shared && typeof shared.normalizeCraftAssistMaterialListCanonical === "function") {
    const canonical = shared.normalizeCraftAssistMaterialListCanonical([entry], {
      rows,
      legacyWearFilterMode: useRelative ? "relative" : "absolute",
      source: "renormalize"
    });
    return canonical[0] ? {...canonical[0]} : null;
  }
  const names = craftAssistMaterialNames(entry);
  if (!names.length) return null;
  const name = names[0];
  const role = normalizeCraftAssistRole(entry && entry.role);
  const count = normalizeCraftAssistEntryCount(entry && entry.count, 1);
  const defaultRange = makeCraftAssistDefaultRange(names, {useRelative, rows});
  const customRange = !!(entry && entry.custom_range);
  let wearMin = customRange
    ? clampWearToRange(entry && entry.wear_min, defaultRange.wear_min, defaultRange.wear_max, defaultRange.wear_min)
    : defaultRange.wear_min;
  let wearMax = customRange
    ? clampWearToRange(entry && entry.wear_max, defaultRange.wear_min, defaultRange.wear_max, defaultRange.wear_max)
    : defaultRange.wear_max;
  if (wearMax < wearMin) {
    const tmp = wearMin;
    wearMin = wearMax;
    wearMax = tmp;
  }
  return {
    id: makeCraftAssistUid(idPrefix),
    names,
    name,
    role,
    count,
    direction: normalizeCraftAssistDirection(role, entry && entry.direction),
    disable_direction_limit: !!(entry && entry.disable_direction_limit),
    wear_min: wearMin,
    wear_max: wearMax,
    custom_range: customRange
  };
}
function normalizeCraftAssistMaterialList(entries, {targetWear = state.craftAssistTargetWear, idPrefix = "assist", useRelative = getCraftAssistFilterUseRelative(), rows = null} = {}) {
  const shared = globalThis && globalThis.craftAssistItemWearShared;
  if (shared && typeof shared.normalizeCraftAssistMaterialListCanonical === "function") {
    return coalesceCraftAssistMaterialRoleBuckets(shared.normalizeCraftAssistMaterialListCanonical(entries, {
      rows,
      legacyWearFilterMode: useRelative ? "relative" : "absolute",
      source: "renormalize"
    }).map((entry) => ({...entry})), {source: "renormalize"});
  }
  const out = [];
  const seenNames = new Set();
  for (const raw of Array.isArray(entries) ? entries : []) {
    const normalized = normalizeCraftAssistMaterialEntry(raw, {targetWear, idPrefix, useRelative, rows});
    if (!normalized) continue;
    const allowedNames = normalized.names.filter((name) => {
      if (seenNames.has(name)) return false;
      seenNames.add(name);
      return true;
    });
    if (!allowedNames.length) continue;
    normalized.names = allowedNames;
    normalized.name = allowedNames[0];
    out.push(normalized);
  }
  return coalesceCraftAssistMaterialRoleBuckets(out, {source: "renormalize"});
}
function projectCraftAssistPersistedMaterialsFromState(materials = state.craftAssistMaterials) {
  const shared = globalThis && globalThis.craftAssistItemWearShared;
  if (shared && typeof shared.projectCraftAssistPersistedMaterials === "function") {
    return shared.projectCraftAssistPersistedMaterials(materials);
  }
  return normalizeCraftAssistMaterialList(materials, {
    targetWear: state.craftAssistTargetWear,
    idPrefix: "assist",
    useRelative: getCraftAssistFilterUseRelative()
  }).map((entry) => ({
    id: String(entry && entry.id || "").trim(),
    role: normalizeCraftAssistRole(entry && entry.role),
    count: normalizeCraftAssistEntryCount(entry && entry.count, 1),
    direction: normalizeCraftAssistDirection(entry && entry.role, entry && entry.direction),
    disable_direction_limit: !!(entry && entry.disable_direction_limit),
    items: craftAssistMaterialNames(entry).map((name, index) => ({
      id: `${String(entry && entry.id || "assist").trim() || "assist"}__${index + 1}`,
      name,
      wear_filter_mode: getCraftAssistFilterMode(),
      wear_min: clampWear01(entry && entry.wear_min, 0),
      wear_max: clampWear01(entry && entry.wear_max, 1),
      custom_range: !!(entry && entry.custom_range)
    }))
  }));
}
function resolveCraftAssistRequiredCountForApp() {
  const shared = globalThis && globalThis.craftAssistItemWearShared;
  if (shared && typeof shared.resolveCraftAssistRequiredCount === "function") {
    return shared.resolveCraftAssistRequiredCount();
  }
  return 10;
}
function syncCraftAssistAutoDirectionLimit() {
  // 兼容旧调用：已移除“可大于/可小于相对磨损”机制。
}
function refreshCraftAssistMaterialRanges({rows = null, useRelative = getCraftAssistFilterUseRelative()} = {}) {
  state.craftAssistMaterials = coalesceCraftAssistMaterialRoleBuckets((Array.isArray(state.craftAssistMaterials) ? state.craftAssistMaterials : [])
    .map((entry) => {
      const existingId = String(entry && entry.id || "").trim();
      const names = craftAssistMaterialNames(entry);
      if (!names.length) {
        const role = normalizeCraftAssistRole(entry && entry.role);
        let wearMin = clampWear01(entry && entry.wear_min, 0);
        let wearMax = clampWear01(entry && entry.wear_max, 1);
        if (wearMax < wearMin) {
          const tmp = wearMin;
          wearMin = wearMax;
          wearMax = tmp;
        }
        return {
          ...entry,
          id: existingId || makeCraftAssistUid("assist"),
          names: [],
          name: "",
          role,
          count: normalizeCraftAssistEntryCount(entry && entry.count, 1),
          direction: normalizeCraftAssistDirection(role, entry && entry.direction),
          disable_direction_limit: !!(entry && entry.disable_direction_limit),
          wear_min: wearMin,
          wear_max: wearMax,
          custom_range: !!(entry && entry.custom_range)
        };
      }
      const normalized = normalizeCraftAssistMaterialEntry(entry, {
        targetWear: state.craftAssistTargetWear,
        idPrefix: "assist",
        useRelative,
        rows
      });
      if (!normalized) return null;
      return {
        ...normalized,
        id: existingId || String(normalized.id || "").trim() || normalized.id
      };
    })
    .filter(Boolean), {source: "renormalize"});
  syncCraftAssistAutoDirectionLimit();
}
function setCraftAssistFilterMode(mode, {refreshRanges = true, renderPanel = true} = {}) {
  const nextMode = normalizeCraftAssistFilterMode(mode);
  const nextUseAbsolute = nextMode === "absolute";
  const changed = state.craftAssistUseAbsoluteWear !== nextUseAbsolute;
  state.craftAssistUseAbsoluteWear = nextUseAbsolute;
  if (refreshRanges && (changed || Array.isArray(state.craftAssistMaterials) && state.craftAssistMaterials.length > 0)) {
    refreshCraftAssistMaterialRanges({useRelative: nextMode !== "absolute"});
  }
  if (renderPanel) {
    renderCraftAssistPanel();
  }
}
function sanitizeCraftAssistPresetPayload(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const name = String(source.name || "").trim();
  if (!name) return null;
  const filterMode = normalizeCraftAssistFilterMode(source.wear_filter_mode);
  const targetWearPair = resolveCraftAssistTargetWearPair(source.target_wear, source.target_wear_raw);
  if (!targetWearPair) return null;
  const targetWear = targetWearPair.target_wear;
  const materials = projectCraftAssistPersistedMaterialsFromState(normalizeCraftAssistMaterialList(source.materials, {
    targetWear,
    idPrefix: "preset_material",
    useRelative: filterMode !== "absolute",
    rows: getAllInventoryCraftableRows()
  }))
    .filter((entry) => entry.count > 0);
  if (!materials.length) return null;
  const createdAt = Math.max(0, Number(source.created_at || 0) || 0);
  const updatedAt = Math.max(createdAt, Math.max(0, Number(source.updated_at || 0) || 0));
  return {
    id: String(source.id || makeCraftAssistUid("preset")).trim() || makeCraftAssistUid("preset"),
    name,
    target_wear: targetWear,
    target_wear_raw: targetWearPair.target_wear_raw,
    materials,
    created_at: createdAt || Date.now(),
    updated_at: updatedAt || Date.now()
  };
}
function normalizeCraftAssistPresetList(values) {
  return (Array.isArray(values) ? values : [])
    .map((entry) => sanitizeCraftAssistPresetPayload(entry))
    .filter(Boolean)
    .slice(0, 40);
}
function readCraftAssistPresetsFromLocalStorage() {
  try {
    const raw = localStorage.getItem(CRAFT_ASSIST_PRESETS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return normalizeCraftAssistPresetList(arr);
  } catch (_) {
    return [];
  }
}
function writeCraftAssistPresetsToLocalStorage(presets) {
  try {
    localStorage.setItem(CRAFT_ASSIST_PRESETS_KEY, JSON.stringify(Array.isArray(presets) ? presets : []));
  } catch (_) {
    // ignore storage errors
  }
}
async function saveCraftAssistPresetsToServer(presets) {
  try {
    await api("/api/ui-state/craft-assist-presets", {
      method: "POST",
      suppressAuthFailure: true,
      body: JSON.stringify({
        presets: Array.isArray(presets) ? presets : []
      })
    });
  } catch (_) {
    // ignore server sync errors
  }
}
async function loadCraftAssistPresetsFromServer() {
  try {
    const data = await api("/api/ui-state/craft-assist-presets", {suppressAuthFailure: true});
    return normalizeCraftAssistPresetList(data && data.presets);
  } catch (_) {
    return null;
  }
}
function saveCraftAssistPresetsToStorage() {
  const payload = normalizeCraftAssistPresetList(state.craftAssistPresets);
  state.craftAssistPresets = payload;
  writeCraftAssistPresetsToLocalStorage(payload);
  void saveCraftAssistPresetsToServer(payload);
}
async function loadCraftAssistPresetsFromStorage() {
  const localPresets = readCraftAssistPresetsFromLocalStorage();
  const serverPresets = await loadCraftAssistPresetsFromServer();
  if (Array.isArray(serverPresets)) {
    if (serverPresets.length > 0) {
      state.craftAssistPresets = serverPresets;
      writeCraftAssistPresetsToLocalStorage(serverPresets);
      return;
    }
    if (localPresets.length > 0) {
      state.craftAssistPresets = localPresets;
      await saveCraftAssistPresetsToServer(localPresets);
      return;
    }
    state.craftAssistPresets = [];
    return;
  }
  state.craftAssistPresets = localPresets;
}
function formatCraftAssistPresetTime(value) {
  const ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) return "-";
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "-";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}
function buildCurrentCraftAssistPresetSnapshot(name) {
  const presetName = String(name || "").trim();
  if (!presetName) return null;
  const targetWearPair = resolveCraftAssistTargetWearPair(state.craftAssistTargetWear, state.craftAssistTargetWearRaw);
  if (!targetWearPair) return null;
  const materials = projectCraftAssistPersistedMaterialsFromState(state.craftAssistMaterials)
    .filter((entry) => entry.count > 0);
  if (!materials.length) return null;
  return sanitizeCraftAssistPresetPayload({
    id: makeCraftAssistUid("preset"),
    name: presetName,
    target_wear: targetWearPair.target_wear,
    target_wear_raw: targetWearPair.target_wear_raw,
    materials,
    created_at: Date.now(),
    updated_at: Date.now()
  });
}
function makeTradeupSimulationUid(prefix = "simulation") {
  return `${String(prefix || "simulation").trim() || "simulation"}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}
function normalizeTradeupSimulationSlotName(slot) {
  const value = String(slot || "").trim();
  return ["primary_output", "aux_output", "main_material", "aux_material"].includes(value) ? value : "";
}
function isTradeupSimulationOutputSlot(slot) {
  const value = normalizeTradeupSimulationSlotName(slot);
  return value === "primary_output" || value === "aux_output";
}
function sanitizeTradeupSimulationTargetItem(value) {
  const source = value && typeof value === "object" ? value : {};
  const markethashname = String(source.markethashname || "").trim();
  if (!markethashname) return null;
  const minfloat = source.minfloat === null || source.minfloat === undefined || source.minfloat === ""
    ? null
    : Number(source.minfloat);
  const maxfloat = source.maxfloat === null || source.maxfloat === undefined || source.maxfloat === ""
    ? null
    : Number(source.maxfloat);
  return {
    markethashname,
    name: String(source.name || source.markethashname || "").trim(),
    basemarkethashname: String(source.basemarkethashname || source.basename || source.markethashname || "").trim() || markethashname,
    basename: String(source.basename || source.basemarkethashname || source.markethashname || "").trim() || markethashname,
    collection: String(source.collection || "").trim(),
    rarity: String(source.rarity || "").trim(),
    wearlevel: String(source.wearlevel || "").trim(),
    wear_label: String(source.wear_label || source.wearlevel || "").trim(),
    minfloat: Number.isFinite(minfloat) ? minfloat : null,
    maxfloat: Number.isFinite(maxfloat) ? maxfloat : null,
    wear_range: source.wear_range === null || source.wear_range === undefined || source.wear_range === ""
      ? null
      : (Number.isFinite(Number(source.wear_range)) ? Number(source.wear_range) : null),
    absolute_wear: source.absolute_wear === null || source.absolute_wear === undefined || source.absolute_wear === ""
      ? null
      : (Number.isFinite(Number(source.absolute_wear)) ? Number(source.absolute_wear) : null),
    editable: source.editable !== false,
    goods_icon_url: String(source.goods_icon_url || "").trim(),
    goods_original_icon_url: String(source.goods_original_icon_url || "").trim(),
    goods_share_thumbnail_url: String(source.goods_share_thumbnail_url || "").trim(),
    collection_lowest_rarity: String(source.collection_lowest_rarity || "").trim(),
    is_collection_lowest_rarity: source.is_collection_lowest_rarity === true,
    tradeup_restriction_reason: String(source.tradeup_restriction_reason || "").trim(),
    is_tradeup_restricted: source.is_tradeup_restricted === true
  };
}
function getTradeupSimulationDefaultName(source = {}) {
  const item = sanitizeTradeupSimulationTargetItem(source.cover_output)
    || sanitizeTradeupSimulationTargetItem(source.primary_output)
    || sanitizeTradeupSimulationTargetItem(source.target_item)
    || sanitizeTradeupSimulationTargetItem(source.aux_output);
  return String((item && (item.basename || item.basemarkethashname || item.markethashname)) || "").trim();
}
function normalizeTradeupSimulationRows(source = {}, key, fallbackRows = []) {
  if (Array.isArray(source && source[key])) return deepCopyPlain(source[key]);
  if (Array.isArray(source && source.rows)) return deepCopyPlain(source.rows);
  return deepCopyPlain(fallbackRows);
}
function finalizeTradeupSimulationPresetShape(source = {}) {
  const primaryOutput = sanitizeTradeupSimulationTargetItem(source.primary_output)
    || sanitizeTradeupSimulationTargetItem(source.cover_output)
    || sanitizeTradeupSimulationTargetItem(source.target_item)
    || sanitizeTradeupSimulationTargetItem(source.aux_output);
  const auxOutput = sanitizeTradeupSimulationTargetItem(source.aux_output);
  const mainMaterial = sanitizeTradeupSimulationTargetItem(source.main_material);
  const auxMaterial = sanitizeTradeupSimulationTargetItem(source.aux_material);
  const legacyAnchorItem = sanitizeTradeupSimulationTargetItem({
    ...source.target_item,
    markethashname: String(source.active_driver_markethashname || source.active_driver_item_key || "").trim(),
    basemarkethashname: String(source.active_driver_item_key || "").trim(),
    basename: String(source.active_driver_item_key || "").trim()
  });
  const coverOutput = sanitizeTradeupSimulationTargetItem(source.cover_output)
    || primaryOutput
    || auxOutput;
  const activeAnchorItem = sanitizeTradeupSimulationTargetItem(source.active_anchor_item)
    || legacyAnchorItem
    || coverOutput
    || mainMaterial
    || auxMaterial;
  const anchorWear = source.active_anchor_abs_wear === null || source.active_anchor_abs_wear === undefined || source.active_anchor_abs_wear === ""
    ? (source.active_driver_abs_wear === null || source.active_driver_abs_wear === undefined || source.active_driver_abs_wear === ""
      ? (activeAnchorItem && Number.isFinite(Number(activeAnchorItem.minfloat)) ? Number(activeAnchorItem.minfloat) : null)
      : Number(source.active_driver_abs_wear))
    : Number(source.active_anchor_abs_wear);
  const createdAt = Math.max(0, Number(source.created_at || 0) || 0) || Date.now();
  const updatedAt = Math.max(createdAt, Math.max(0, Number(source.updated_at || 0) || 0)) || createdAt;
  const outputRows = normalizeTradeupSimulationRows(source, "output_rows");
  const materialRows = normalizeTradeupSimulationRows(source, "material_rows", outputRows);
  return {
    id: String(source.id || makeTradeupSimulationUid("preset")).trim() || makeTradeupSimulationUid("preset"),
    name: String(source.name || "").trim() || getTradeupSimulationDefaultName({
      cover_output: coverOutput,
      primary_output: primaryOutput,
      aux_output: auxOutput
    }),
    primary_output: primaryOutput,
    aux_output: auxOutput,
    main_material: mainMaterial,
    aux_material: auxMaterial,
    cover_output: coverOutput,
    active_anchor_item: activeAnchorItem,
    active_anchor_abs_wear: Number.isFinite(anchorWear) ? anchorWear : null,
    output_rows: outputRows,
    material_rows: materialRows,
    rows: deepCopyPlain(Array.isArray(source.rows) ? source.rows : outputRows),
    output_candidates: deepCopyPlain(Array.isArray(source.output_candidates) ? source.output_candidates : []),
    warnings: deepCopyPlain(Array.isArray(source.warnings) ? source.warnings : []),
    dirty: !!source.dirty,
    created_at: createdAt,
    updated_at: updatedAt
  };
}
function enforceTradeupSimulationPresetRestrictions(preset) {
  const source = preset && typeof preset === "object" ? preset : {};
  const next = {...source};
  let removedAny = false;
  const clearBlockedSlot = (slotName) => {
    const item = sanitizeTradeupSimulationTargetItem(source[slotName]);
    if (!item) return;
    if (!getTradeupSimulationPickerRestrictionMessage(item, slotName)) return;
    next[slotName] = null;
    removedAny = true;
  };
  clearBlockedSlot("primary_output");
  clearBlockedSlot("aux_output");
  clearBlockedSlot("main_material");
  clearBlockedSlot("aux_material");
  const coverOutput = sanitizeTradeupSimulationTargetItem(source.cover_output);
  if (coverOutput && getTradeupSimulationPickerRestrictionMessage(coverOutput, "primary_output")) {
    next.cover_output = null;
    removedAny = true;
  }
  const materialKeys = new Set([
    getTradeupSimulationItemKey(sanitizeTradeupSimulationTargetItem(next.main_material)),
    getTradeupSimulationItemKey(sanitizeTradeupSimulationTargetItem(next.aux_material))
  ].filter(Boolean));
  const activeAnchorItem = sanitizeTradeupSimulationTargetItem(source.active_anchor_item);
  if (activeAnchorItem) {
    const anchorKey = getTradeupSimulationItemKey(activeAnchorItem);
    const anchorMatchesMaterial = !!(anchorKey && materialKeys.has(anchorKey));
    const anchorRestrictionMessage = anchorMatchesMaterial
      ? (getTradeupSimulationTradeupRestrictionReason(activeAnchorItem) ? "限量版物品不能加入炼金" : "")
      : getTradeupSimulationPickerRestrictionMessage(activeAnchorItem, "primary_output");
    if (anchorRestrictionMessage) {
      next.active_anchor_item = null;
      removedAny = true;
    }
  }
  const hasBlockedOutputCandidate = Array.isArray(source.output_candidates)
    && source.output_candidates.some((entry) => getTradeupSimulationPickerRestrictionMessage(entry, "primary_output"));
  if (hasBlockedOutputCandidate) {
    removedAny = true;
  }
  if (!removedAny) {
    return source;
  }
  next.cover_output = null;
  next.active_anchor_item = null;
  next.active_anchor_abs_wear = null;
  next.output_rows = [];
  next.material_rows = [];
  next.rows = [];
  next.output_candidates = [];
  next.warnings = [];
  return finalizeTradeupSimulationPresetShape(next);
}
function sanitizeTradeupSimulationPresetPayload(payload) {
  const normalized = enforceTradeupSimulationPresetRestrictions(
    finalizeTradeupSimulationPresetShape(payload && typeof payload === "object" ? payload : {})
  );
  if (!normalized.primary_output && !normalized.cover_output) return null;
  return normalized;
}
function sanitizeTradeupSimulationDraftPayload(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  return enforceTradeupSimulationPresetRestrictions(
    finalizeTradeupSimulationPresetShape({
      ...source,
      id: String(source.id || makeTradeupSimulationUid("draft")).trim() || makeTradeupSimulationUid("draft")
    })
  );
}
function getTradeupSimulationWorkspaceDraft(presetId = "") {
  const draft = state.simulationWorkspacePreset && typeof state.simulationWorkspacePreset === "object"
    ? state.simulationWorkspacePreset
    : null;
  if (!draft) return null;
  const key = String(presetId || "").trim();
  const draftId = String(draft.id || "").trim();
  const sourceId = String(state.simulationWorkspaceSourcePresetId || "").trim();
  if (!key || key === draftId || (sourceId && key === sourceId)) return draft;
  return null;
}
function setTradeupSimulationWorkspaceDraft(preset, {sourcePresetId = ""} = {}) {
  const draft = sanitizeTradeupSimulationDraftPayload(preset);
  state.simulationWorkspacePreset = draft;
  state.simulationWorkspaceSourcePresetId = String(sourcePresetId || "").trim();
  closeTradeupSimulationPickerModal();
  closeTradeupSimulationItemModal();
  return draft;
}
function openBlankTradeupSimulationWorkspaceDraft() {
  state.simulationViewMode = "workspace";
  return setTradeupSimulationWorkspaceDraft({
    id: makeTradeupSimulationUid("draft"),
    name: "",
    primary_output: null,
    aux_output: null,
    main_material: null,
    aux_material: null,
    cover_output: null,
    active_anchor_item: null,
    active_anchor_abs_wear: null,
    output_rows: [],
    material_rows: [],
    rows: [],
    output_candidates: [],
    warnings: [],
    dirty: true,
    created_at: Date.now(),
    updated_at: Date.now()
  }, {
    sourcePresetId: ""
  });
}
function openTradeupSimulationWorkspaceDraft() {
  state.simulationViewMode = "workspace";
  const existingDraft = sanitizeTradeupSimulationDraftPayload(state.simulationWorkspacePreset);
  if (existingDraft) {
    return setTradeupSimulationWorkspaceDraft(existingDraft, {
      sourcePresetId: state.simulationWorkspaceSourcePresetId
    });
  }
  return openBlankTradeupSimulationWorkspaceDraft();
}
function normalizeTradeupSimulationPresetList(values) {
  return (Array.isArray(values) ? values : [])
    .map((entry) => sanitizeTradeupSimulationPresetPayload(entry))
    .filter(Boolean)
    .slice(0, 40);
}
function readRawTradeupSimulationPresetsFromLocalStorage() {
  try {
    const raw = localStorage.getItem(TRADEUP_SIMULATION_PRESETS_KEY);
    if (!raw) return [];
    return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}
function serializeTradeupSimulationPresetList(values, {clearDirty = false} = {}) {
  return normalizeTradeupSimulationPresetList(values)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      primary_output: deepCopyPlain(entry.primary_output),
      aux_output: deepCopyPlain(entry.aux_output),
      main_material: deepCopyPlain(entry.main_material),
      aux_material: deepCopyPlain(entry.aux_material),
      cover_output: deepCopyPlain(entry.cover_output),
      active_anchor_item: deepCopyPlain(entry.active_anchor_item),
      active_anchor_abs_wear: entry.active_anchor_abs_wear,
      output_rows: deepCopyPlain(entry.output_rows),
      material_rows: deepCopyPlain(entry.material_rows),
      output_candidates: deepCopyPlain(entry.output_candidates),
      warnings: deepCopyPlain(entry.warnings),
      dirty: clearDirty ? false : !!entry.dirty,
      created_at: entry.created_at,
      updated_at: clearDirty ? Date.now() : entry.updated_at
    }));
}
function readTradeupSimulationPresetsFromLocalStorage() {
  return normalizeTradeupSimulationPresetList(readRawTradeupSimulationPresetsFromLocalStorage());
}
function shouldHydrateTradeupSimulationStoredItem(item, slotName = "") {
  const normalized = sanitizeTradeupSimulationTargetItem(item);
  if (!normalized) return false;
  if (String(normalized.collection || "").trim() === "限量版物品") return false;
  if (normalized.is_tradeup_restricted === true) return false;
  if (String(normalized.tradeup_restriction_reason || "").trim()) return false;
  if (normalized.is_collection_lowest_rarity === true) return false;
  if (String(normalized.collection_lowest_rarity || "").trim()) return false;
  return ["primary_output", "aux_output", "cover_output", "active_anchor_item", "output_candidate"].includes(String(slotName || "").trim());
}
async function fetchTradeupSimulationCatalogItem(markethashname) {
  const key = String(markethashname || "").trim();
  if (!key) return null;
  try {
    const data = await api(`/api/simulation/tradeup/item?markethashname=${encodeURIComponent(key)}`, {suppressAuthFailure: true});
    return sanitizeTradeupSimulationTargetItem(data && data.item);
  } catch (_) {
    return null;
  }
}
async function hydrateTradeupSimulationStoredItem(item, cache, slotName = "") {
  const normalized = sanitizeTradeupSimulationTargetItem(item);
  if (!normalized) return null;
  if (!shouldHydrateTradeupSimulationStoredItem(normalized, slotName)) {
    return normalized;
  }
  const key = normalized.markethashname;
  if (!cache.has(key)) {
    cache.set(key, fetchTradeupSimulationCatalogItem(key).then((resolved) => resolved || normalized));
  }
  const resolved = await cache.get(key);
  return deepCopyPlain(resolved || normalized);
}
async function hydrateTradeupSimulationStoredPreset(preset, cache) {
  const source = preset && typeof preset === "object" ? deepCopyPlain(preset) : {};
  const slotKeys = ["primary_output", "aux_output", "main_material", "aux_material", "cover_output", "active_anchor_item"];
  const hydratedSlots = await Promise.all(slotKeys.map(async (key) => [key, await hydrateTradeupSimulationStoredItem(source[key], cache, key)]));
  for (const [key, value] of hydratedSlots) {
    source[key] = value;
  }
  if (Array.isArray(source.output_candidates)) {
    source.output_candidates = (await Promise.all(
      source.output_candidates.map((entry) => hydrateTradeupSimulationStoredItem(entry, cache, "output_candidate"))
    )).filter(Boolean);
  }
  return source;
}
async function hydrateTradeupSimulationStoredPresets(presets) {
  const list = Array.isArray(presets) ? presets : [];
  if (!list.length) return [];
  const cache = new Map();
  const hydrated = [];
  for (const preset of list) {
    hydrated.push(await hydrateTradeupSimulationStoredPreset(preset, cache));
  }
  return hydrated;
}
function writeTradeupSimulationPresetsToLocalStorage(presets) {
  try {
    localStorage.setItem(TRADEUP_SIMULATION_PRESETS_KEY, JSON.stringify(Array.isArray(presets) ? presets : []));
  } catch (_) {
    // ignore storage errors
  }
}
async function saveTradeupSimulationPresetsToServer(presets) {
  try {
    await api("/api/ui-state/tradeup-simulation-presets", {
      method: "POST",
      suppressAuthFailure: true,
      body: JSON.stringify({
        presets: Array.isArray(presets) ? presets : []
      })
    });
    return true;
  } catch (_) {
    return false;
  }
}
async function loadTradeupSimulationPresetsFromServer() {
  try {
    const data = await api("/api/ui-state/tradeup-simulation-presets", {suppressAuthFailure: true});
    return Array.isArray(data && data.presets) ? data.presets : [];
  } catch (_) {
    return null;
  }
}
function saveTradeupSimulationPresetsToStorage() {
  const payload = normalizeTradeupSimulationPresetList(state.simulationPresets);
  state.simulationPresets = payload;
  const storedPayload = serializeTradeupSimulationPresetList(payload);
  writeTradeupSimulationPresetsToLocalStorage(storedPayload);
  void saveTradeupSimulationPresetsToServer(storedPayload);
}
async function loadTradeupSimulationPresetsFromStorage() {
  const localPresets = normalizeTradeupSimulationPresetList(
    await hydrateTradeupSimulationStoredPresets(readRawTradeupSimulationPresetsFromLocalStorage())
  );
  const serverPresetList = await loadTradeupSimulationPresetsFromServer();
  const serverPresets = Array.isArray(serverPresetList)
    ? normalizeTradeupSimulationPresetList(await hydrateTradeupSimulationStoredPresets(serverPresetList))
    : null;
  if (Array.isArray(serverPresets)) {
    if (serverPresets.length > 0) {
      state.simulationPresets = serverPresets;
      writeTradeupSimulationPresetsToLocalStorage(serverPresets);
    } else if (localPresets.length > 0) {
      state.simulationPresets = localPresets;
      await saveTradeupSimulationPresetsToServer(localPresets);
    } else {
      state.simulationPresets = [];
    }
  } else {
    state.simulationPresets = localPresets;
  }
  selectTradeupSimulationPreset(state.simulationActivePresetId, {
    openWorkspace: false
  });
}
async function persistTradeupSimulationPresets({clearDirty = false} = {}) {
  const draft = sanitizeTradeupSimulationDraftPayload(state.simulationWorkspacePreset);
  if (!draft || !(draft.primary_output || draft.cover_output)) return false;
  const sourceId = String(state.simulationWorkspaceSourcePresetId || "").trim();
  const currentList = Array.isArray(state.simulationPresets) ? [...state.simulationPresets] : [];
  const sourceIndex = sourceId
    ? currentList.findIndex((entry) => String(entry && entry.id || "").trim() === sourceId)
    : -1;
  const existing = sourceIndex >= 0 ? currentList[sourceIndex] : null;
  const savedPreset = sanitizeTradeupSimulationPresetPayload({
    ...draft,
    id: sourceId || makeTradeupSimulationUid("preset"),
    dirty: clearDirty ? false : !!draft.dirty,
    created_at: Math.max(0, Number(existing && existing.created_at || 0) || 0) || draft.created_at || Date.now(),
    updated_at: Date.now()
  });
  if (!savedPreset) return false;
  if (sourceIndex >= 0) currentList[sourceIndex] = savedPreset;
  else currentList.push(savedPreset);
  const payload = normalizeTradeupSimulationPresetList(
    clearDirty
      ? currentList.map((entry) => ({
        ...(entry && typeof entry === "object" ? entry : {}),
        dirty: false
      }))
      : currentList
  );
  const savedId = String(savedPreset.id || "").trim();
  state.simulationPresets = payload;
  state.simulationActivePresetId = savedId;
  state.simulationWorkspaceSourcePresetId = savedId;
  state.simulationWorkspacePreset = sanitizeTradeupSimulationDraftPayload({
    ...(payload.find((entry) => String(entry && entry.id || "").trim() === savedId) || savedPreset),
    dirty: false
  });
  const storedPayload = serializeTradeupSimulationPresetList(payload, {clearDirty});
  writeTradeupSimulationPresetsToLocalStorage(storedPayload);
  state.simulationPersisting = true;
  renderSimulationPage();
  const synced = await saveTradeupSimulationPresetsToServer(storedPayload);
  state.simulationPersisting = false;
  renderSimulationPage();
  return synced;
}
async function saveActiveTradeupSimulationPreset() {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可搜索物品、编辑并保存汰换模拟配置。",
    view: "login"
  }) === false) {
    return false;
  }
  const preset = getActiveTradeupSimulationPreset();
  if (!preset || state.simulationPersisting) return false;
  if (!(preset.primary_output || preset.cover_output)) {
    setSummary("请先选择主产物", {isError: true});
    return false;
  }
  const presetName = await openCraftAssistPresetModal("", {
    title: "保存汰换配置",
    confirmText: "保存配方",
    placeholder: "请输入配置名称",
    emptyMessage: "请先输入配置名称",
    onEmpty(message) {
      setSummary(message, {isError: true});
      showErrorToast(message);
    }
  });
  if (presetName == null) return false;
  const nextName = String(presetName || "").trim();
  if (!nextName) return false;
  state.simulationWorkspacePreset = sanitizeTradeupSimulationDraftPayload({
    ...(state.simulationWorkspacePreset && typeof state.simulationWorkspacePreset === "object"
      ? state.simulationWorkspacePreset
      : preset),
    name: nextName,
    dirty: true
  });
  return persistTradeupSimulationPresets({clearDirty: true});
}
async function cancelTradeupSimulationEditing() {
  state.simulationViewMode = "saved";
  state.simulationWorkspacePreset = null;
  state.simulationWorkspaceSourcePresetId = "";
  closeTradeupSimulationPickerModal();
  closeTradeupSimulationItemModal();
  selectTradeupSimulationPreset(state.simulationActivePresetId, {openWorkspace: false});
  renderSimulationPage();
}
async function deleteTradeupSimulationPreset(presetId) {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可管理真实的汰换模拟配置。",
    view: "login"
  }) === false) {
    return false;
  }
  const key = String(presetId || "").trim();
  if (!key) return false;
  const currentList = Array.isArray(state.simulationPresets) ? state.simulationPresets : [];
  if (!currentList.some((entry) => String(entry && entry.id || "").trim() === key)) return false;
  const nextList = normalizeTradeupSimulationPresetList(
    currentList.filter((entry) => String(entry && entry.id || "").trim() !== key)
  );
  state.simulationPresets = nextList;
  if (String(state.simulationActivePresetId || "").trim() === key) {
    state.simulationActivePresetId = nextList[0] ? String(nextList[0].id || "").trim() : "";
  }
  const workspacePresetId = String(state.simulationWorkspacePreset && state.simulationWorkspacePreset.id || "").trim();
  const workspaceSourceId = String(state.simulationWorkspaceSourcePresetId || "").trim();
  if (workspacePresetId === key || workspaceSourceId === key) {
    state.simulationWorkspacePreset = null;
    state.simulationWorkspaceSourcePresetId = "";
  }
  closeTradeupSimulationPickerModal();
  closeTradeupSimulationItemModal();
  const storedPayload = serializeTradeupSimulationPresetList(nextList);
  writeTradeupSimulationPresetsToLocalStorage(storedPayload);
  state.simulationPersisting = true;
  renderSimulationPage();
  const synced = await saveTradeupSimulationPresetsToServer(storedPayload);
  state.simulationPersisting = false;
  selectTradeupSimulationPreset(state.simulationActivePresetId, {openWorkspace: false});
  renderSimulationPage();
  return synced;
}
function findTradeupSimulationPresetIndex(presetId) {
  const key = String(presetId || "").trim();
  const list = Array.isArray(state.simulationPresets) ? state.simulationPresets : [];
  return list.findIndex((entry) => String(entry && entry.id || "").trim() === key);
}
function getTradeupSimulationPresetById(presetId) {
  const list = Array.isArray(state.simulationPresets) ? state.simulationPresets : [];
  const key = String(presetId || "").trim();
  if (!key) return null;
  return list.find((entry) => String(entry && entry.id || "").trim() === key) || null;
}
function updateTradeupSimulationPresetRecord(presetId, updater) {
  const activeDraft = getTradeupSimulationWorkspaceDraft();
  const key = String(presetId || (activeDraft && activeDraft.id) || state.simulationActivePresetId || "").trim();
  const draft = getTradeupSimulationWorkspaceDraft(key);
  if (draft) {
    const next = sanitizeTradeupSimulationDraftPayload(updater ? updater(deepCopyPlain(draft)) : draft);
    state.simulationWorkspacePreset = next;
    return next;
  }
  const index = findTradeupSimulationPresetIndex(key);
  if (index < 0) return null;
  const current = state.simulationPresets[index];
  const next = sanitizeTradeupSimulationPresetPayload(updater ? updater(deepCopyPlain(current)) : current);
  if (!next) return null;
  state.simulationPresets[index] = next;
  return next;
}
function closeTradeupSimulationPickerModal() {
  state.simulationSearchSeq = Math.max(0, Number(state.simulationSearchSeq || 0) || 0) + 1;
  state.simulationPickerQuery = "";
  state.simulationPickerResults = [];
  state.simulationPickerError = "";
  state.simulationSearchLoading = false;
  state.simulationPickerOpen = false;
  state.simulationPickerMode = "";
  state.simulationPickerTitle = "";
}
function closeTradeupSimulationRoleChoosers() {
  const hadOpen = !!state.simulationOutputChooserOpen || !!state.simulationMaterialChooserOpen;
  state.simulationOutputChooserOpen = false;
  state.simulationMaterialChooserOpen = false;
  return hadOpen;
}
function setTradeupSimulationRoleChooserOpen(kind, open) {
  const chooserKind = String(kind || "").trim() === "material" ? "material" : "output";
  const next = !!open;
  if (chooserKind === "output") {
    if (state.simulationOutputChooserOpen === next && (!next || !state.simulationMaterialChooserOpen)) return;
    state.simulationOutputChooserOpen = next;
    if (next) state.simulationMaterialChooserOpen = false;
  } else {
    if (state.simulationMaterialChooserOpen === next && (!next || !state.simulationOutputChooserOpen)) return;
    state.simulationMaterialChooserOpen = next;
    if (next) state.simulationOutputChooserOpen = false;
  }
  if (!next) {
    setTradeupSimulationChooserActiveSlot(chooserKind, "");
  } else {
    setTradeupSimulationChooserActiveSlot(
      chooserKind,
      getTradeupSimulationPreferredSlot(chooserKind, getActiveTradeupSimulationPreset())
    );
  }
  renderSimulationRoleChoosers(getActiveTradeupSimulationPreset());
}
function getTradeupSimulationChooserNodes(kind) {
  const chooserKind = String(kind || "").trim() === "material" ? "material" : "output";
  return {
    chooserKind,
    chooser: chooserKind === "material" ? ui.simulationMaterialRoleChooser : ui.simulationOutputRoleChooser,
    split: chooserKind === "material" ? ui.simulationMaterialRoleSplit : ui.simulationOutputRoleSplit,
    mainSlot: chooserKind === "material" ? "main_material" : "primary_output",
    auxSlot: chooserKind === "material" ? "aux_material" : "aux_output"
  };
}
function getTradeupSimulationPreferredSlot(kind, preset = null, currentSlot = "") {
  const {chooserKind, mainSlot, auxSlot} = getTradeupSimulationChooserNodes(kind);
  const activePreset = preset || getActiveTradeupSimulationPreset();
  const normalizedCurrent = normalizeTradeupSimulationSlotName(currentSlot);
  if (chooserKind === "output") {
    const hasMain = !!sanitizeTradeupSimulationTargetItem(activePreset && activePreset.primary_output);
    const hasAux = !!sanitizeTradeupSimulationTargetItem(activePreset && activePreset.aux_output);
    if (!hasMain) return mainSlot;
    if (!hasAux) return auxSlot;
  } else {
    const hasMain = !!sanitizeTradeupSimulationTargetItem(activePreset && activePreset.main_material);
    const hasAux = !!sanitizeTradeupSimulationTargetItem(activePreset && activePreset.aux_material);
    if (!hasMain) return mainSlot;
    if (!hasAux) return auxSlot;
  }
  if (normalizedCurrent === mainSlot || normalizedCurrent === auxSlot) return normalizedCurrent;
  const stateSlot = normalizeTradeupSimulationSlotName(
    chooserKind === "material" ? state.simulationMaterialRole : state.simulationOutputRole
  );
  return stateSlot || mainSlot;
}
function setTradeupSimulationChooserActiveSlot(kind, slot = "") {
  const {chooser, split, mainSlot, auxSlot} = getTradeupSimulationChooserNodes(kind);
  const normalizedSlot = normalizeTradeupSimulationSlotName(slot);
  if (chooser) {
    if (normalizedSlot) chooser.dataset.activeSlot = normalizedSlot;
    else delete chooser.dataset.activeSlot;
  }
  if (!split) return normalizedSlot || "";
  const main = split.querySelector(".role-main");
  const aux = split.querySelector(".role-aux");
  if (main) main.classList.toggle("is-active", normalizedSlot === mainSlot);
  if (aux) aux.classList.toggle("is-active", normalizedSlot === auxSlot);
  return normalizedSlot || "";
}
function inferTradeupSimulationChooserSlot(kind, evt, fallbackSlot = "", {allowPointerPosition = true} = {}) {
  const {chooser, mainSlot, auxSlot} = getTradeupSimulationChooserNodes(kind);
  const target = evt && evt.target && typeof evt.target.closest === "function" ? evt.target : null;
  if (target) {
    if (target.closest(".role-main")) return mainSlot;
    if (target.closest(".role-aux")) return auxSlot;
  }
  const clientX = evt && evt.clientX !== null && evt.clientX !== undefined
    ? Number(evt.clientX)
    : Number.NaN;
  if (allowPointerPosition && chooser && Number.isFinite(clientX)) {
    const rect = chooser.getBoundingClientRect();
    if (rect.width > 0) {
      return clientX < rect.left + rect.width / 2 ? mainSlot : auxSlot;
    }
  }
  const normalizedFallback = normalizeTradeupSimulationSlotName(fallbackSlot);
  return normalizedFallback || mainSlot;
}
function syncTradeupSimulationChooserHoverSlot(kind, evt, fallbackSlot = "") {
  const slotName = inferTradeupSimulationChooserSlot(kind, evt, fallbackSlot, {allowPointerPosition: true});
  return setTradeupSimulationChooserActiveSlot(kind, slotName);
}
function resolveTradeupSimulationChooserSlot(kind, evt, fallbackSlot = "") {
  const {chooser, chooserKind, mainSlot} = getTradeupSimulationChooserNodes(kind);
  const activeSlot = normalizeTradeupSimulationSlotName(chooser && chooser.dataset ? chooser.dataset.activeSlot : "");
  const preferredSlot = getTradeupSimulationPreferredSlot(kind, getActiveTradeupSimulationPreset(), activeSlot || fallbackSlot);
  const slotName = inferTradeupSimulationChooserSlot(kind, evt, preferredSlot, {allowPointerPosition: false});
  if (slotName) return slotName;
  const currentSlot = normalizeTradeupSimulationSlotName(
    chooserKind === "material" ? state.simulationMaterialRole : state.simulationOutputRole
  );
  return currentSlot || preferredSlot || mainSlot;
}
function closeTradeupSimulationItemModal() {
  state.simulationModalOpen = false;
  state.simulationModalMode = "";
  state.simulationModalPresetId = "";
  state.simulationModalSlot = "";
  state.simulationModalItemType = "";
  state.simulationModalItemSnapshot = null;
}
function openTradeupSimulationPickerModal({slot = "", title = ""} = {}) {
  const slotName = normalizeTradeupSimulationSlotName(slot);
  if (!slotName) return false;
  if (!state.simulationWorkspacePreset) {
    openBlankTradeupSimulationWorkspaceDraft();
  }
  state.simulationViewMode = "workspace";
  closeTradeupSimulationRoleChoosers();
  state.simulationSearchSeq = Math.max(0, Number(state.simulationSearchSeq || 0) || 0) + 1;
  state.simulationPickerQuery = "";
  state.simulationPickerResults = [];
  state.simulationPickerError = "";
  state.simulationSearchLoading = false;
  state.simulationPickerOpen = true;
  state.simulationPickerMode = slotName;
  state.simulationPickerTitle = String(title || "").trim() || `选择${slotName}`;
  closeTradeupSimulationItemModal();
  return true;
}
function openTradeupSimulationItemModal({presetId, slot = "", itemType = "output", item = null, mode = "edit"} = {}) {
  const preset = getTradeupSimulationWorkspaceDraft(presetId || state.simulationActivePresetId)
    || getTradeupSimulationPresetById(presetId || state.simulationActivePresetId)
    || getActiveTradeupSimulationPreset();
  const slotName = normalizeTradeupSimulationSlotName(slot);
  const itemSnapshot = sanitizeTradeupSimulationTargetItem(item)
    || sanitizeTradeupSimulationTargetItem(preset && preset[slotName]);
  if (!preset || !itemSnapshot) return false;
  state.simulationModalOpen = true;
  state.simulationModalMode = slotName && String(mode || "").trim() !== "readonly"
    ? "edit"
    : "readonly";
  state.simulationModalPresetId = String(preset.id || "").trim();
  state.simulationModalSlot = slotName;
  state.simulationModalItemType = String(itemType || "").trim() === "material" ? "material" : "output";
  state.simulationModalItemSnapshot = deepCopyPlain(itemSnapshot);
  closeTradeupSimulationPickerModal();
  state.simulationViewMode = "workspace";
  return true;
}
function getTradeupSimulationModalPreset() {
  return getTradeupSimulationWorkspaceDraft(state.simulationModalPresetId || state.simulationActivePresetId)
    || getTradeupSimulationPresetById(state.simulationModalPresetId || state.simulationActivePresetId)
    || getActiveTradeupSimulationPreset();
}
function getTradeupSimulationModalItem() {
  return sanitizeTradeupSimulationTargetItem(state.simulationModalItemSnapshot);
}
function getTradeupSimulationArtProps(item) {
  const artUrl = preferredRowSkinImageUrl(item);
  const rarityVisual = getTradeupSimulationRarityVisuals(item && item.rarity);
  const styleParts = [`--simulation-card-rarity-color:${rarityVisual.color}`];
  if (artUrl) {
    styleParts.push(`--simulation-card-art-image:${cssUrlValue(artUrl)}`);
  }
  return {
    artUrl,
    artStyleAttr: ` style='${styleParts.join(";")}'`
  };
}
function getTradeupSimulationRarityVisuals(value) {
  const label = normalizeCraftPredictorRarityLabel(value) || "未分级";
  const colorMap = {
    "消费级": "#b0c3d9",
    "工业级": "#5e98d9",
    "军规级": "#4b69ff",
    "受限": "#8847ff",
    "保密": "#d32ce6",
    "隐秘": "#eb4b4b",
    "金": "#e4ae39",
    "未分级": "#6d7c92"
  };
  return {
    label,
    color: colorMap[label] || colorMap["未分级"]
  };
}
function bindSimulationInteractiveElement(element, handler) {
  if (!element || typeof handler !== "function") return;
  element.onclick = handler;
  element.onkeydown = (evt) => {
    if (evt.key !== "Enter" && evt.key !== " ") return;
    evt.preventDefault();
    handler(evt);
  };
}
function selectTradeupSimulationPreset(presetId, {openWorkspace = false} = {}) {
  const list = Array.isArray(state.simulationPresets) ? state.simulationPresets : [];
  const key = String(presetId || "").trim();
  if (key && list.some((entry) => String(entry && entry.id || "").trim() === key)) {
    state.simulationActivePresetId = key;
    const preset = list.find((entry) => String(entry && entry.id || "").trim() === key) || null;
    if (!openWorkspace) {
      closeTradeupSimulationPickerModal();
      closeTradeupSimulationItemModal();
      return preset;
    }
    state.simulationViewMode = "workspace";
    return setTradeupSimulationWorkspaceDraft({
      ...deepCopyPlain(preset),
      dirty: false
    }, {
      sourcePresetId: key
    });
  }
  state.simulationActivePresetId = list[0] ? String(list[0].id || "").trim() : "";
  closeTradeupSimulationPickerModal();
  closeTradeupSimulationItemModal();
  if (!openWorkspace) return list[0] || null;
  return openBlankTradeupSimulationWorkspaceDraft();
}
function setTradeupSimulationActivePreset(presetId) {
  return selectTradeupSimulationPreset(presetId, {openWorkspace: true});
}
function applyTradeupSimulationResolveResult(presetId, result) {
  if (!result || typeof result !== "object" || result.ok !== true) return false;
  const rows = deepCopyPlain(Array.isArray(result.rows) ? result.rows : []);
  const outputCandidates = rows.flatMap((row) => Array.isArray(row && row.outputs) ? row.outputs : []);
  const next = updateTradeupSimulationPresetRecord(presetId, (current) => ({
    ...current,
    primary_output: current.primary_output || sanitizeTradeupSimulationTargetItem(result.target),
    cover_output: current.cover_output || current.primary_output || sanitizeTradeupSimulationTargetItem(result.target),
    active_anchor_item: sanitizeTradeupSimulationTargetItem(result.driver) || current.active_anchor_item,
    output_rows: rows,
    material_rows: rows,
    rows,
    output_candidates: outputCandidates,
    warnings: deepCopyPlain(Array.isArray(result.warnings) ? result.warnings : []),
    updated_at: Date.now()
  }));
  return !!next;
}
function applyTradeupSimulationResolveFailure(presetId, result) {
  const message = String(result && result.message || "解析失败").trim() || "解析失败";
  const invalidReason = String(result && result.invalid_reason || "").trim() || "resolve_failed";
  const warnings = Array.isArray(result && result.warnings) && result.warnings.length
    ? deepCopyPlain(result.warnings)
    : [{
      type: invalidReason,
      message
    }];
  const next = updateTradeupSimulationPresetRecord(presetId, (current) => ({
    ...current,
    output_rows: [],
    material_rows: [],
    rows: [],
    warnings,
    updated_at: Date.now()
  }));
  return !!next;
}
function applyTradeupSimulationSlotSelection({presetId, slot = "", item = null, absoluteWear = null} = {}) {
  const slotName = normalizeTradeupSimulationSlotName(slot);
  const nextItem = sanitizeTradeupSimulationTargetItem(item);
  if (!slotName || !nextItem) return false;
  const next = updateTradeupSimulationPresetRecord(presetId, (current) => ({
    ...current,
    [slotName]: nextItem,
    cover_output: slotName === "primary_output"
      ? nextItem
      : current.cover_output || (isTradeupSimulationOutputSlot(slotName) ? nextItem : null),
    active_anchor_item: nextItem,
    active_anchor_abs_wear: inheritTradeupSimulationAbsoluteWear(current, nextItem, absoluteWear),
    dirty: true,
    updated_at: Date.now()
  }));
  return !!next;
}
function adoptTradeupSimulationDerivedPrimaryOutput({presetId, candidates = []} = {}) {
  const list = (Array.isArray(candidates) ? candidates : [])
    .map((entry) => sanitizeTradeupSimulationTargetItem(entry))
    .filter(Boolean);
  if (!list.length) return false;
  const next = updateTradeupSimulationPresetRecord(presetId, (current) => {
    const currentPrimary = sanitizeTradeupSimulationTargetItem(current && current.primary_output);
    const currentAux = sanitizeTradeupSimulationTargetItem(current && current.aux_output);
    const currentCover = sanitizeTradeupSimulationTargetItem(current && current.cover_output)
      || currentPrimary;
    const mainMaterial = sanitizeTradeupSimulationTargetItem(current && current.main_material);
    const auxMaterial = sanitizeTradeupSimulationTargetItem(current && current.aux_material);
    const primaryCollection = String(
      (mainMaterial && mainMaterial.collection)
      || (currentPrimary && currentPrimary.collection)
      || (currentCover && currentCover.collection)
      || (auxMaterial && auxMaterial.collection)
      || ""
    ).trim();
    const auxCollection = String(auxMaterial && auxMaterial.collection || "").trim();
    const currentPrimaryCandidate = findTradeupSimulationCandidateByKey(list, currentPrimary);
    const currentAuxCandidate = findTradeupSimulationCandidateByKey(list, currentAux);
    const currentCoverCandidate = findTradeupSimulationCandidateByKey(list, currentCover);
    const primaryAlignedCandidate = pickTradeupSimulationCandidateForCollection(list, primaryCollection);
    const nextPrimary = currentPrimaryCandidate && (!primaryCollection || String(currentPrimaryCandidate.collection || "").trim() === primaryCollection)
      ? currentPrimaryCandidate
      : primaryAlignedCandidate || currentPrimaryCandidate || currentPrimary || list[0];
    let nextAux = null;
    if (auxCollection && auxCollection !== String(nextPrimary && nextPrimary.collection || "").trim()) {
      nextAux = currentAuxCandidate && String(currentAuxCandidate.collection || "").trim() === auxCollection
        ? currentAuxCandidate
        : pickTradeupSimulationCandidateForCollection(list, auxCollection);
      if (getTradeupSimulationItemKey(nextAux) === getTradeupSimulationItemKey(nextPrimary)) {
        nextAux = null;
      }
    }
    const nextCover = currentCoverCandidate || nextPrimary || nextAux || currentCover || list[0];
    return {
      ...current,
      primary_output: nextPrimary,
      aux_output: nextAux,
      cover_output: nextCover,
      output_rows: [],
      material_rows: [],
      rows: [],
      output_candidates: deepCopyPlain(list),
      dirty: true,
      updated_at: Date.now()
    };
  });
  return !!next;
}
function applyTradeupSimulationModalEdit({absoluteWear} = {}) {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可编辑汰换模拟配置。",
    view: "login"
  }) === false) {
    return false;
  }
  if (!state.simulationModalOpen || state.simulationModalMode !== "edit") return false;
  const preset = getTradeupSimulationModalPreset();
  const item = getTradeupSimulationModalItem();
  if (!preset || !item) return false;
  const updated = applyTradeupSimulationSlotSelection({
    presetId: preset.id,
    slot: state.simulationModalSlot,
    item,
    absoluteWear
  });
  if (updated) closeTradeupSimulationItemModal();
  return updated;
}
function buildCraftAssistParentGroups() {
  const groups = buildCraftGroupRows(getCraftCandidates());
  return groups
    .map((group) => ({
      key: String(group && group.name || "").trim(),
      name: String(group && group.name || "").trim(),
      count: Array.isArray(group && group.items) ? group.items.length : 0,
      rarity: String(group && group.parent_rarity || "").trim(),
      collection: String(group && group.collection || "").trim(),
      stattrak: Array.isArray(group && group.items) && group.items.length > 0 ? isRowStatTrak(group.items[0]) : false
    }))
    .filter((entry) => entry.key)
    .sort((a, b) => a.name.localeCompare(b.name));
}
function createCraftAssistMaterial(name, role = "main") {
  const key = String(name || "").trim();
  if (!key) return null;
  return normalizeCraftAssistMaterialEntry({
    role: normalizeCraftAssistRole(role),
    count: 1,
    direction: "",
    disable_direction_limit: false,
    items: [{
      name: key,
      wear_filter_mode: getCraftAssistFilterMode(),
      custom_range: false
    }]
  }, {targetWear: state.craftAssistTargetWear, idPrefix: "assist", useRelative: getCraftAssistFilterUseRelative()});
}
function normalizeCraftAssistMaterialForUi(entry, {source = "renormalize"} = {}) {
  const material = entry && typeof entry === "object" ? entry : null;
  if (!material) return null;
  const rows = typeof getAllInventoryCraftableRows === "function"
    ? getAllInventoryCraftableRows()
    : null;
  const shared = globalThis && globalThis.craftAssistItemWearShared;
  if (shared && typeof shared.normalizeCraftAssistMaterialListCanonical === "function") {
    const canonical = shared.normalizeCraftAssistMaterialListCanonical([material], {
      rows,
      legacyWearFilterMode: getCraftAssistFilterMode(),
      source
    });
    return canonical[0] ? {...canonical[0]} : null;
  }
  return normalizeCraftAssistMaterialEntry(material, {
    targetWear: state.craftAssistTargetWear,
    idPrefix: "assist",
    useRelative: getCraftAssistFilterUseRelative(),
    rows
  });
}
function craftAssistMaterialItems(material) {
  const projected = projectCraftAssistPersistedMaterialsFromState([material]);
  const entry = projected[0] || null;
  const materialId = String(entry && entry.id || material && material.id || "assist").trim() || "assist";
  return (Array.isArray(entry && entry.items) ? entry.items : [])
    .map((item, index) => ({
      id: String(item && item.id || `${materialId}__${index + 1}`).trim() || `${materialId}__${index + 1}`,
      name: String(item && item.name || "").trim(),
      wear_filter_mode: normalizeCraftAssistFilterMode(item && item.wear_filter_mode),
      wear_min: clampWear01(item && item.wear_min, 0),
      wear_max: clampWear01(item && item.wear_max, 1),
      custom_range: !!(item && item.custom_range)
    }))
    .filter((item) => item.name);
}
function coalesceCraftAssistMaterialRoleBuckets(materials, {source = "renormalize"} = {}) {
  const list = Array.isArray(materials) ? materials : [];
  const buckets = new Map();
  for (const material of list) {
    const role = normalizeCraftAssistRole(material && material.role);
    const items = craftAssistMaterialItems(material);
    if (!items.length) continue;
    if (!buckets.has(role)) {
      buckets.set(role, {
        id: String(material && material.id || "").trim(),
        role,
        count: 0,
        direction: material && material.direction,
        disable_direction_limit: !!(material && material.disable_direction_limit),
        items: []
      });
    }
    const bucket = buckets.get(role);
    bucket.count += normalizeCraftAssistEntryCount(material && material.count, 1);
    if (!bucket.id) {
      bucket.id = String(material && material.id || "").trim();
    }
    if (!bucket.disable_direction_limit && material && material.disable_direction_limit) {
      bucket.disable_direction_limit = true;
    }
    const seenNames = new Set(bucket.items.map((item) => String(item && item.name || "").trim()));
    for (const item of items) {
      const name = String(item && item.name || "").trim();
      if (!name || seenNames.has(name)) continue;
      seenNames.add(name);
      bucket.items.push({
        ...item,
        id: String(item && item.id || "").trim()
      });
    }
  }
  return ["main", "aux"]
    .filter((role) => buckets.has(role))
    .map((role) => {
      const bucket = buckets.get(role);
      const normalized = normalizeCraftAssistMaterialForUi({
        id: bucket.id || "",
        role,
        count: normalizeCraftAssistEntryCount(bucket.count, 1),
        direction: bucket.direction,
        disable_direction_limit: bucket.disable_direction_limit,
        items: bucket.items
      }, {source});
      return normalized ? {
        ...normalized,
        id: String(bucket.id || normalized.id || "").trim() || String(normalized.id || "").trim()
      } : null;
    })
    .filter(Boolean);
}
function createCraftAssistMaterialItem(name) {
  const itemName = String(name || "").trim();
  if (!itemName) return null;
  return {
    name: itemName,
    wear_filter_mode: getCraftAssistFilterMode(),
    wear_min: 0,
    wear_max: 1,
    custom_range: false
  };
}
function updateCraftAssistMaterialItems(materialId, updater, {source = "renormalize"} = {}) {
  const key = String(materialId || "").trim();
  if (!key || typeof updater !== "function") return false;
  const materials = Array.isArray(state.craftAssistMaterials) ? state.craftAssistMaterials : [];
  const target = materials.find((entry) => String(entry && entry.id || "").trim() === key);
  if (!target) return false;
  const currentItems = craftAssistMaterialItems(target);
  const nextItems = updater(currentItems.map((item) => ({...item})), target);
  if (!Array.isArray(nextItems)) return false;
  if (!nextItems.length) {
    removeCraftAssistMaterial(key);
    return true;
  }
  updateCraftAssistMaterial(key, (entry) => {
    const normalized = normalizeCraftAssistMaterialForUi({
      ...entry,
      id: key,
      items: nextItems
    }, {source});
    return normalized ? {
      ...normalized,
      id: key
    } : entry;
  });
  syncCraftAssistAutoDirectionLimit();
  renderCraftAssistPanel();
  return true;
}
function removeCraftAssistMaterialItem(materialId, materialItemId) {
  const key = String(materialId || "").trim();
  const itemKey = String(materialItemId || "").trim();
  if (!key || !itemKey) return;
  updateCraftAssistMaterialItems(key, (items) => items.filter((item) => String(item && item.id || "").trim() !== itemKey));
}
function resolveCraftAssistItemEffectiveRange(item, {rows = null} = {}) {
  const mode = normalizeCraftAssistFilterMode(item && item.wear_filter_mode);
  const constraint = resolveCraftMaterialWearConstraintByName(String(item && item.name || "").trim(), {
    useRelative: mode !== "absolute",
    rows
  }) || {min: 0, max: 1};
  let wearMin = Number(constraint.min);
  let wearMax = Number(constraint.max);
  const custom = !!(item && item.custom_range);
  if (custom) {
    wearMin = clampWearToRange(item && item.wear_min, constraint.min, constraint.max, constraint.min);
    wearMax = clampWearToRange(item && item.wear_max, constraint.min, constraint.max, constraint.max);
    if (wearMax < wearMin) {
      const tmp = wearMin;
      wearMin = wearMax;
      wearMax = tmp;
    }
  }
  return {
    wear_min: wearMin,
    wear_max: wearMax,
    constraint_min: Number(constraint.min),
    constraint_max: Number(constraint.max),
    custom_range: custom,
    use_relative: mode !== "absolute"
  };
}
function setCraftAssistPanelOpen(open, {expandOnOpen = true} = {}) {
  const nextOpen = !!open;
  const closingWithEdit = !nextOpen && isCraftAssistPresetEditing();
  state.craftAssistOpen = nextOpen;
  if (state.craftAssistOpen && expandOnOpen) {
    expandCraftAssistOverlayToBottom();
  }
  if (!state.craftAssistOpen) {
    stopCraftAssistOverlayDrag();
    stopCraftAssistSplitDrag();
    if (craftAssistPickerCloseTimer != null) {
      clearTimeout(craftAssistPickerCloseTimer);
      craftAssistPickerCloseTimer = null;
    }
    state.craftAssistPickerOpen = false;
    state.craftAssistPickerTargetMaterialId = "";
    state.craftAssistRoleChooserOpen = false;
    if (closingWithEdit) {
      cancelCraftAssistPresetEditingSession();
    }
  }
  if (state.craftAssistOpen) {
    applyCraftAssistOverlayHeight({preserveVisibleBottom: true});
  }
  renderCraftAssistPanel();
  if (typeof renderCraftPredictorPanel === "function") renderCraftPredictorPanel();
  if (typeof refreshCraftPredictorPreview === "function") void refreshCraftPredictorPreview();
  if (state.craftAssistOpen) {
    applyCraftAssistPresetWidth();
  }
}
function setCraftAssistRoleChooserOpen(open) {
  if (!state.craftAssistOpen) return;
  const next = !!open;
  if (next) {
    state.craftAssistPickerOpen = false;
    state.craftAssistPickerTargetMaterialId = "";
    if (craftAssistPickerCloseTimer != null) {
      clearTimeout(craftAssistPickerCloseTimer);
      craftAssistPickerCloseTimer = null;
    }
  }
  if (state.craftAssistRoleChooserOpen === next) return;
  state.craftAssistRoleChooserOpen = next;
  renderCraftAssistPanel();
}
function openCraftAssistPicker({targetMaterialId = state.craftAssistPickerTargetMaterialId} = {}) {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可使用辅助选材。",
    view: "login"
  }) === false) {
    return;
  }
  if (!state.craftAssistOpen) return;
  if (craftAssistPickerCloseTimer != null) {
    clearTimeout(craftAssistPickerCloseTimer);
    craftAssistPickerCloseTimer = null;
  }
  state.craftAssistPickerTargetMaterialId = String(targetMaterialId || "").trim();
  state.craftAssistRoleChooserOpen = false;
  if (!state.craftAssistPickerOpen) {
    state.craftAssistPickerOpen = true;
    renderCraftAssistPanel();
    return;
  }
  renderCraftAssistPanel();
}
function scheduleCloseCraftAssistPicker(delayMs = 140) {
  if (craftAssistPickerCloseTimer != null) {
    clearTimeout(craftAssistPickerCloseTimer);
    craftAssistPickerCloseTimer = null;
  }
  craftAssistPickerCloseTimer = setTimeout(() => {
    craftAssistPickerCloseTimer = null;
    if (!state.craftAssistPickerOpen) return;
    state.craftAssistPickerOpen = false;
    state.craftAssistPickerTargetMaterialId = "";
    renderCraftAssistPanel();
  }, Math.max(0, Number(delayMs) || 0));
}
function updateCraftAssistMaterial(materialId, updater) {
  const key = String(materialId || "").trim();
  if (!key || typeof updater !== "function") return;
  state.craftAssistMaterials = coalesceCraftAssistMaterialRoleBuckets(state.craftAssistMaterials.map((entry) => {
    if (String(entry && entry.id || "").trim() !== key) return entry;
    const next = updater(entry);
    return next && typeof next === "object" ? next : entry;
  }), {source: "renormalize"});
}
function addCraftAssistMaterialByName(name, {targetMaterialId = ""} = {}) {
  const key = String(name || "").trim();
  if (!key) return;
  const targetId = String(targetMaterialId || "").trim();
  const materials = Array.isArray(state.craftAssistMaterials) ? state.craftAssistMaterials : [];
  const requestedRole = normalizeCraftAssistRole(state.craftAssistPickRole);
  const existingIndex = materials.findIndex((entry) => craftAssistMaterialNames(entry).includes(key));
  const targetIndex = targetId
    ? materials.findIndex((entry) => String(entry && entry.id || "").trim() === targetId)
    : -1;

  if (targetId && targetIndex >= 0) {
    if (existingIndex >= 0 && existingIndex !== targetIndex) {
      setCraftStatus(`该物品已在其他材料项中：${key}`, true);
      return;
    }
    const targetEntry = materials[targetIndex];
    const names = craftAssistMaterialNames(targetEntry);
    if (names.includes(key)) {
      state.craftAssistPickerOpen = false;
      state.craftAssistRoleChooserOpen = false;
      state.craftAssistPickerTargetMaterialId = "";
      renderCraftAssistPanel();
      return;
    }
    const nextItem = createCraftAssistMaterialItem(key);
    if (!nextItem) return;
    updateCraftAssistMaterialItems(targetId, (items) => [...items, nextItem]);
    state.craftAssistPickerOpen = false;
    state.craftAssistRoleChooserOpen = false;
    state.craftAssistPickerTargetMaterialId = "";
    renderCraftAssistPanel();
    return;
  }

  const parentGroups = buildCraftAssistParentGroups();
  const rarityByName = new Map(parentGroups.map((group) => [String(group && group.name || "").trim(), String(group && group.rarity || "").trim()]));
  const nextRarity = String(rarityByName.get(key) || "").trim();
  const existingRarities = new Set(
    materials
      .flatMap((entry) => craftAssistMaterialNames(entry))
      .map((entryName) => String(rarityByName.get(entryName) || "").trim())
      .filter(Boolean)
  );
  if (nextRarity && existingRarities.size && !existingRarities.has(nextRarity)) {
    const currentRarity = [...existingRarities][0];
    setCraftStatus(
      `单配方需同一稀有度：当前为 ${normalizeCraftPredictorRarityLabel(currentRarity)}，不能添加 ${normalizeCraftPredictorRarityLabel(nextRarity)}`,
      true
    );
    return;
  }
  if (existingIndex >= 0) {
    state.craftAssistPickerOpen = false;
    state.craftAssistRoleChooserOpen = false;
    state.craftAssistPickerTargetMaterialId = "";
    renderCraftAssistPanel();
    return;
  }
  const existingRoleBucket = materials.find((entry) => normalizeCraftAssistRole(entry && entry.role) === requestedRole) || null;
  if (existingRoleBucket) {
    const nextItem = createCraftAssistMaterialItem(key);
    if (!nextItem) return;
    updateCraftAssistMaterialItems(String(existingRoleBucket && existingRoleBucket.id || "").trim(), (items) => [...items, nextItem]);
    state.craftAssistPickerOpen = false;
    state.craftAssistRoleChooserOpen = false;
    state.craftAssistPickerTargetMaterialId = "";
    renderCraftAssistPanel();
    return;
  }
  const mode = craftAssistMaterialLimitFor(materials);
  const totalCount = calcCraftAssistLiveTotalCount(materials);
  if (totalCount >= mode) {
    setCraftStatus(`材料数量已达 ${mode}，不能继续添加父类材料`, true);
    return;
  }
  const next = createCraftAssistMaterial(key, requestedRole);
  if (!next) return;
  const remain = Math.max(0, mode - totalCount);
  next.count = Math.max(1, Math.min(remain, normalizeCraftAssistEntryCount(next.count, 1)));
  state.craftAssistMaterials = coalesceCraftAssistMaterialRoleBuckets([...materials, next], {source: "renormalize"});
  syncCraftAssistAutoDirectionLimit();
  state.craftAssistPickerOpen = false;
  state.craftAssistRoleChooserOpen = false;
  state.craftAssistPickerTargetMaterialId = "";
  renderCraftAssistPanel();
}
function removeCraftAssistMaterial(materialId) {
  const key = String(materialId || "").trim();
  if (!key) return;
  state.craftAssistMaterials = state.craftAssistMaterials.filter((entry) => String(entry && entry.id || "").trim() !== key);
  if (String(state.craftAssistPickerTargetMaterialId || "").trim() === key) {
    state.craftAssistPickerTargetMaterialId = "";
  }
  syncCraftAssistAutoDirectionLimit();
  renderCraftAssistPanel();
}
function removeCraftAssistMaterialName(materialId, materialName) {
  const itemId = String(materialId || "").trim();
  const name = String(materialName || "").trim();
  if (!itemId || !name) return;
  const materials = Array.isArray(state.craftAssistMaterials) ? state.craftAssistMaterials : [];
  const target = materials.find((entry) => String(entry && entry.id || "").trim() === itemId);
  if (!target) return;
  const targetItem = craftAssistMaterialItems(target)
    .find((entry) => String(entry && entry.name || "").trim() === name);
  if (!targetItem) return;
  removeCraftAssistMaterialItem(itemId, targetItem.id);
}
function renderCraftAssistPicker() {
  if (!ui.craftAssistPicker) return;
  const open = !!state.craftAssistPickerOpen && !!state.craftAssistOpen;
  ui.craftAssistPicker.classList.toggle("hidden", !open);
  ui.craftAssistPicker.replaceChildren();
  if (!open) return;

  const targetMaterialId = String(state.craftAssistPickerTargetMaterialId || "").trim();
  const materials = Array.isArray(state.craftAssistMaterials) ? state.craftAssistMaterials : [];
  const targetMaterial = targetMaterialId
    ? (materials.find((entry) => String(entry && entry.id || "").trim() === targetMaterialId) || null)
    : null;
  if (targetMaterialId && !targetMaterial) {
    state.craftAssistPickerTargetMaterialId = "";
  }

  const tip = document.createElement("div");
  tip.className = "craft-assist-picker-empty";
  tip.textContent = targetMaterial
    ? `向该项添加物品：${craftAssistMaterialLabel(targetMaterial)}`
    : "点击左侧添加主料，右侧添加辅料";
  ui.craftAssistPicker.append(tip);

  const selected = new Set(
    materials.flatMap((entry) => craftAssistMaterialNames(entry))
  );
  const selectedInTarget = new Set(targetMaterial ? craftAssistMaterialNames(targetMaterial) : []);
  const groups = buildCraftAssistParentGroups();
  const groupsByName = new Map(groups.map((group) => [String(group && group.name || "").trim(), group]));
  const selectedRarities = new Set(
    materials
      .flatMap((entry) => craftAssistMaterialNames(entry))
      .map((entryName) => {
        const group = groupsByName.get(entryName);
        return String(group && group.rarity || "").trim();
      })
      .filter(Boolean)
  );
  const lockedRarity = selectedRarities.size ? [...selectedRarities][0] : "";
  const mode = craftAssistMaterialLimitFor(materials);
  const totalCount = calcCraftAssistLiveTotalCount(materials);
  const limitReached = totalCount >= mode;
  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "craft-assist-picker-empty";
    empty.textContent = "当前炼金页无可选父类材料";
    ui.craftAssistPicker.append(empty);
    return;
  }
  for (const group of groups) {
    const used = selected.has(group.name);
    const inTarget = selectedInTarget.has(group.name);
    const usedByOther = used && !inTarget;
    const groupRarity = String(group && group.rarity || "").trim();
    const blockedByRarity = !inTarget && !usedByOther && lockedRarity && groupRarity && groupRarity !== lockedRarity;
    if (usedByOther || blockedByRarity) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "craft-assist-picker-item";
    const blockedByLimit = !targetMaterial && !used && limitReached;
    btn.disabled = inTarget || blockedByLimit;
    let blockedTag = "";
    if (inTarget) blockedTag = " 已在本项";
    else if (blockedByLimit) blockedTag = ` 已满${mode}`;
    btn.textContent = `${group.name}（${group.count}）${blockedTag}`;
    btn.title = group.collection ? `${group.rarity || "-"} | ${group.collection}` : (group.rarity || "-");
    btn.onclick = () => {
      addCraftAssistMaterialByName(group.name, {targetMaterialId: targetMaterialId || ""});
    };
    ui.craftAssistPicker.append(btn);
  }
}
function parseCraftAssistRangeInputValue(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}
function seedCraftAssistDecimalInput(input, {seedWhenEmpty = false} = {}) {
  if (!input) return;
  const value = String(input.value || "").trim();
  if (!value) {
    if (!seedWhenEmpty) return;
    input.value = "0.";
    input.dataset.seeded = "1";
    requestAnimationFrame(() => {
      try {
        input.setSelectionRange(2, 2);
      } catch (_) {
        // ignore
      }
    });
    return;
  }
  requestAnimationFrame(() => {
    try {
      const currentValue = String(input.value || "");
      const prefixLength = /^[01]\./.test(currentValue) ? 2 : 0;
      input.setSelectionRange(prefixLength, currentValue.length);
    } catch (_) {
      // ignore
    }
  });
}
function commitCraftAssistTargetWearInput(input) {
  if (!input) return null;
  const raw = String(input.value || "").trim();
  if (raw === wearTextFull(0) && String(input.dataset && input.dataset.displayDefault || "") === "1") {
    delete input.dataset.displayDefault;
    delete input.dataset.persistedRaw;
    return null;
  }
  const pair = resolveCraftAssistTargetWearPair(null, raw);
  if (!pair) {
    if (raw) input.value = "";
    delete input.dataset.persistedRaw;
    return null;
  }
  delete input.dataset.displayDefault;
  input.dataset.persistedRaw = pair.target_wear_raw;
  input.value = pair.target_wear_raw;
  return pair.target_wear;
}
function renderCraftAssistList() {
  if (!ui.craftAssistList) return;
  syncCraftAssistAutoDirectionLimit();
  ui.craftAssistList.replaceChildren();
  if (typeof coalesceCraftAssistMaterialRoleBuckets === "function") {
    state.craftAssistMaterials = coalesceCraftAssistMaterialRoleBuckets(state.craftAssistMaterials, {source: "renormalize"});
  }
  const filterModeOf = typeof normalizeCraftAssistFilterMode === "function"
    ? normalizeCraftAssistFilterMode
    : (mode) => String(mode || "").trim() === "absolute" ? "absolute" : "relative";
  const readMaterialItems = typeof craftAssistMaterialItems === "function"
    ? craftAssistMaterialItems
    : (material) => {
      const materialId = String(material && material.id || "assist").trim() || "assist";
      const sourceItems = Array.isArray(material && material.items) && material.items.length
        ? material.items
        : craftAssistMaterialNames(material).map((name, index) => ({
          id: `${materialId}__${index + 1}`,
          name,
          wear_filter_mode: filterModeOf(typeof getCraftAssistFilterMode === "function" ? getCraftAssistFilterMode() : "relative"),
          wear_min: 0,
          wear_max: 1,
          custom_range: false
        }));
      return sourceItems
        .map((materialItem, index) => ({
          id: String(materialItem && materialItem.id || `${materialId}__${index + 1}`).trim() || `${materialId}__${index + 1}`,
          name: String(materialItem && materialItem.name || "").trim(),
          wear_filter_mode: filterModeOf(materialItem && materialItem.wear_filter_mode),
          wear_min: clampWearToRange(materialItem && materialItem.wear_min, 0, 1, 0),
          wear_max: clampWearToRange(materialItem && materialItem.wear_max, 0, 1, 1),
          custom_range: !!(materialItem && materialItem.custom_range)
        }))
        .filter((materialItem) => materialItem.name);
    };
  const resolveItemRange = typeof resolveCraftAssistItemEffectiveRange === "function"
    ? resolveCraftAssistItemEffectiveRange
    : (materialItem) => {
      const wearMin = clampWearToRange(materialItem && materialItem.wear_min, 0, 1, 0);
      const wearMax = clampWearToRange(materialItem && materialItem.wear_max, wearMin, 1, 1);
      return {
        wear_min: wearMin,
        wear_max: wearMax,
        constraint_min: 0,
        constraint_max: 1,
        custom_range: !!(materialItem && materialItem.custom_range),
        use_relative: filterModeOf(materialItem && materialItem.wear_filter_mode) !== "absolute"
      };
    };
  const applyItemUpdate = typeof updateCraftAssistMaterialItems === "function"
    ? updateCraftAssistMaterialItems
    : (materialId, updater) => {
      if (typeof updater !== "function" || typeof updateCraftAssistMaterial !== "function") return false;
      let removedWholeGroup = false;
      updateCraftAssistMaterial(materialId, (entry) => {
        const nextItems = updater(readMaterialItems(entry).map((item) => ({...item})), entry);
        if (!Array.isArray(nextItems)) return entry;
        if (!nextItems.length) {
          removedWholeGroup = true;
          return entry;
        }
        return {
          ...entry,
          items: nextItems
        };
      });
      if (removedWholeGroup && typeof removeCraftAssistMaterial === "function") {
        removeCraftAssistMaterial(materialId);
        return true;
      }
      if (typeof renderCraftAssistPanel === "function") renderCraftAssistPanel();
      return true;
    };
  const removeItem = typeof removeCraftAssistMaterialItem === "function"
    ? removeCraftAssistMaterialItem
    : (materialId, itemId) => applyItemUpdate(
      materialId,
      (items) => items.filter((materialItem) => String(materialItem && materialItem.id || "").trim() !== String(itemId || "").trim())
    );
  const materials = Array.isArray(state.craftAssistMaterials) ? state.craftAssistMaterials : [];
  if (!materials.length) {
    const empty = document.createElement("div");
    empty.className = "craft-assist-list-empty";
    empty.textContent = "悬停上方“尚未选择父类材料”行后，点击主料/辅料开始添加";
    ui.craftAssistList.append(empty);
    return;
  }
  const rows = typeof getAllInventoryCraftableRows === "function"
    ? getAllInventoryCraftableRows()
    : null;
  const minText = "Min";
  const maxText = "Max";
  const formatRangeWear = wearTextFull;
  for (const material of materials) {
    const materialId = String(material && material.id || "").trim();
    const selectedItems = readMaterialItems(material);
    const role = normalizeCraftAssistRole(material && material.role);
    const roleText = role === "main" ? "主料" : "辅料";
    const item = document.createElement("div");
    item.className = "craft-assist-item";

    const head = document.createElement("div");
    head.className = "craft-assist-item-head";
    const headPrimary = document.createElement("div");
    headPrimary.className = "craft-assist-item-head-primary";
    const title = document.createElement("div");
    title.className = "craft-assist-item-title";
    const badge = document.createElement("span");
    badge.className = `craft-assist-role-tag ${role}`;
    badge.textContent = roleText;
    title.append(badge);
    headPrimary.append(title);
    const addNameBtn = document.createElement("button");
    addNameBtn.type = "button";
    addNameBtn.className = "craft-assist-item-add";
    addNameBtn.textContent = "+";
    addNameBtn.title = "向该项添加物品";
    addNameBtn.setAttribute("aria-label", "向该项添加物品");
    addNameBtn.onclick = (evt) => {
      if (evt && typeof evt.stopPropagation === "function") evt.stopPropagation();
      state.craftAssistPickRole = role;
      openCraftAssistPicker({targetMaterialId: materialId});
    };
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "craft-assist-item-remove";
    removeBtn.title = "删除该条件项";
    removeBtn.setAttribute("aria-label", "删除该条件项");
    removeBtn.textContent = "×";
    removeBtn.onclick = () => {
      removeCraftAssistMaterial(materialId);
    };
    const actions = document.createElement("div");
    actions.className = "craft-assist-item-actions";
    const qtyLabel = document.createElement("label");
    qtyLabel.className = "craft-assist-field qty craft-assist-head-qty";
    const qtyText = document.createElement("span");
    qtyText.className = "craft-assist-head-qty-badge";
    qtyText.textContent = "数量";
    const qtyShell = document.createElement("div");
    qtyShell.className = "craft-assist-head-qty-shell";
    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.min = "1";
    qtyInput.max = "10";
    qtyInput.step = "1";
    qtyInput.setAttribute("aria-label", "数量");
    const qtyFallback = 1;
    qtyInput.value = String(normalizeCraftAssistEntryCount(material && material.count, qtyFallback));
    const commitQtyValue = (rawValue) => {
      const mode = craftAssistMaterialLimitFor(state.craftAssistMaterials);
      const currentId = String(materialId || "").trim();
      const otherTotal = calcCraftAssistLiveTotalCount(
        (Array.isArray(state.craftAssistMaterials) ? state.craftAssistMaterials : [])
          .filter((entry) => String(entry && entry.id || "").trim() !== currentId)
      );
      const maxAllowed = Math.max(0, mode - otherTotal);
      if (maxAllowed <= 0) {
        qtyInput.value = String(normalizeCraftAssistEntryCount(material && material.count, 1));
        setCraftStatus(`材料数量上限 ${mode}，请先调整其他词条数量`, true);
        return normalizeCraftAssistEntryCount(material && material.count, 1);
      }
      const requested = normalizeCraftAssistEntryCount(rawValue, material && material.count);
      const nextCount = Math.max(1, Math.min(requested, maxAllowed));
      if (requested > maxAllowed) {
        setCraftStatus(`材料数量上限 ${mode}，该项最多可填 ${maxAllowed}`, true);
      }
      updateCraftAssistMaterial(materialId, (entry) => ({...entry, count: nextCount}));
      syncCraftAssistAutoDirectionLimit();
      renderCraftAssistPanel();
      return nextCount;
    };
    qtyInput.onchange = () => {
      commitQtyValue(qtyInput.value);
    };
    qtyInput.onkeydown = (evt) => {
      if (evt.key !== "Enter") return;
      evt.preventDefault();
      commitQtyValue(qtyInput.value);
      qtyInput.blur();
    };
    const qtySpin = document.createElement("div");
    qtySpin.className = "craft-assist-head-qty-spin";
    const decrementBtn = document.createElement("button");
    decrementBtn.type = "button";
    decrementBtn.className = "craft-assist-head-qty-step decrement";
    decrementBtn.title = "减少数量";
    decrementBtn.setAttribute("aria-label", "减少数量");
    decrementBtn.onclick = (evt) => {
      if (evt && typeof evt.stopPropagation === "function") evt.stopPropagation();
      const current = normalizeCraftAssistEntryCount(qtyInput.value, material && material.count);
      commitQtyValue(current - 1);
    };
    const incrementBtn = document.createElement("button");
    incrementBtn.type = "button";
    incrementBtn.className = "craft-assist-head-qty-step increment";
    incrementBtn.title = "增加数量";
    incrementBtn.setAttribute("aria-label", "增加数量");
    incrementBtn.onclick = (evt) => {
      if (evt && typeof evt.stopPropagation === "function") evt.stopPropagation();
      const current = normalizeCraftAssistEntryCount(qtyInput.value, material && material.count);
      commitQtyValue(current + 1);
    };
    qtyShell.append(qtyInput, qtySpin);
    qtySpin.append(incrementBtn, decrementBtn);
    qtyLabel.append(qtyText, qtyShell);
    actions.append(qtyLabel, addNameBtn, removeBtn);
    head.append(headPrimary, actions);

    const cardList = document.createElement("div");
    cardList.className = "craft-assist-material-card-list";
    if (!selectedItems.length) {
      const selectedEmpty = document.createElement("div");
      selectedEmpty.className = "craft-assist-selected-empty";
      selectedEmpty.textContent = "暂无已选物品";
      cardList.append(selectedEmpty);
    }
    for (const materialItem of selectedItems) {
      const itemRange = resolveItemRange(materialItem, {rows});
      const constraintMin = Number(itemRange.constraint_min);
      const constraintMax = Number(itemRange.constraint_max);
      const wearLabel = itemRange.use_relative ? "相对磨损范围" : "绝对磨损范围";

      const card = document.createElement("div");
      card.className = "craft-assist-material-card";
      const cardRail = document.createElement("div");
      cardRail.className = "craft-assist-material-card-rail";
      const cardHead = document.createElement("div");
      cardHead.className = "craft-assist-material-card-head";
      const cardTitle = document.createElement("div");
      cardTitle.className = "craft-assist-material-card-title";
      cardTitle.textContent = materialItem.name;
      const cardRemove = document.createElement("button");
      cardRemove.type = "button";
      cardRemove.className = "craft-assist-material-card-remove";
      cardRemove.title = `删除该物品：${materialItem.name}`;
      cardRemove.setAttribute("aria-label", `删除该物品：${materialItem.name}`);
      cardRemove.textContent = "×";
      cardRemove.onclick = (evt) => {
        if (evt && typeof evt.stopPropagation === "function") evt.stopPropagation();
        removeItem(materialId, materialItem.id);
      };
      cardHead.append(cardTitle, cardRemove);

      const modeField = document.createElement("div");
      modeField.className = "craft-assist-field craft-assist-card-mode";
      const modeText = document.createElement("span");
      modeText.textContent = "筛选磨损";
      const modeWrap = document.createElement("div");
      modeWrap.className = "craft-assist-mode-toggle";
      modeWrap.setAttribute("role", "group");
      modeWrap.setAttribute("aria-label", `${materialItem.name} 磨损模式`);
      const modeGroupName = `craftAssistCardMode_${materialId}_${materialItem.id}`;
      const makeModeOption = (value, labelText) => {
        const option = document.createElement("label");
        option.className = "craft-assist-mode-option";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = modeGroupName;
        input.value = value;
        input.checked = filterModeOf(materialItem.wear_filter_mode) === value;
        input.onchange = () => {
          if (!input.checked) return;
          applyItemUpdate(materialId, (items) => items.map((entry) => (
            String(entry && entry.id || "").trim() === String(materialItem.id || "").trim()
              ? {
                ...entry,
                wear_filter_mode: value
              }
              : entry
          )), {source: "mode-switch"});
        };
        const text = document.createElement("span");
        text.textContent = labelText;
        option.append(input, text);
        return option;
      };
      modeWrap.append(
        makeModeOption("relative", "相对"),
        makeModeOption("absolute", "绝对")
      );
      modeField.append(modeText, modeWrap);

      const rangeLabel = document.createElement("label");
      rangeLabel.className = "craft-assist-field range craft-assist-card-range";
      const rangeText = document.createElement("span");
      rangeText.textContent = wearLabel;
      const rangeWrap = document.createElement("div");
      rangeWrap.className = "craft-assist-range-wrap";
      const minRow = document.createElement("div");
      minRow.className = "craft-assist-range-row";
      const minLabel = document.createElement("span");
      minLabel.className = "craft-assist-range-label";
      minLabel.textContent = minText;
      const minInput = document.createElement("input");
      minInput.type = "text";
      minInput.inputMode = "decimal";
      minInput.placeholder = formatRangeWear(itemRange.custom_range ? itemRange.wear_min : constraintMin);
      minInput.value = "";
      minInput.setAttribute("aria-label", `${materialItem.name} ${minText} 输入`);
      const maxRow = document.createElement("div");
      maxRow.className = "craft-assist-range-row";
      const maxLabel = document.createElement("span");
      maxLabel.className = "craft-assist-range-label";
      maxLabel.textContent = maxText;
      const maxInput = document.createElement("input");
      maxInput.type = "text";
      maxInput.inputMode = "decimal";
      maxInput.placeholder = formatRangeWear(itemRange.custom_range ? itemRange.wear_max : constraintMax);
      maxInput.value = "";
      maxInput.setAttribute("aria-label", `${materialItem.name} ${maxText} 输入`);
      const commitRange = () => {
        const normalizeRangeText = (input) => {
          const raw = String(input && input.value || "").trim();
          const seededBlank = input && input.dataset && input.dataset.seeded === "1" && raw === "0.";
          if (seededBlank) input.value = "";
          if (input && input.dataset) delete input.dataset.seeded;
          return seededBlank ? "" : raw;
        };
        const minTextRaw = normalizeRangeText(minInput);
        const maxTextRaw = normalizeRangeText(maxInput);
        const minRaw = parseCraftAssistRangeInputValue(minTextRaw);
        const maxRaw = parseCraftAssistRangeInputValue(maxTextRaw);
        const minBlank = minTextRaw === "";
        const maxBlank = maxTextRaw === "";
        if (minBlank && maxBlank) {
          return;
        }

        let nextMin = minBlank
          ? clampWearToRange(itemRange.wear_min, constraintMin, constraintMax, constraintMin)
          : clampWearToRange(minRaw, constraintMin, constraintMax, constraintMin);
        let nextMax = maxBlank
          ? clampWearToRange(itemRange.wear_max, constraintMin, constraintMax, constraintMax)
          : clampWearToRange(maxRaw, constraintMin, constraintMax, constraintMax);
        if (nextMax < nextMin) {
          if (!minBlank && maxBlank) nextMax = nextMin;
          else if (minBlank && !maxBlank) nextMin = nextMax;
          else nextMax = nextMin;
        }
        applyItemUpdate(materialId, (items) => items.map((entry) => (
          String(entry && entry.id || "").trim() === String(materialItem.id || "").trim()
            ? {
              ...entry,
              wear_min: nextMin,
              wear_max: nextMax,
              custom_range: !(
                Math.abs(nextMin - constraintMin) <= 1e-9 &&
                Math.abs(nextMax - constraintMax) <= 1e-9
              )
            }
            : entry
        )));
      };
      minInput.onfocus = () => seedCraftAssistDecimalInput(minInput, {seedWhenEmpty: true});
      maxInput.onfocus = () => seedCraftAssistDecimalInput(maxInput, {seedWhenEmpty: true});
      minInput.oninput = () => { delete minInput.dataset.seeded; };
      maxInput.oninput = () => { delete maxInput.dataset.seeded; };
      minInput.onblur = commitRange;
      maxInput.onblur = commitRange;
      minInput.onkeydown = (evt) => {
        if (evt.key !== "Enter") return;
        evt.preventDefault();
        commitRange();
        maxInput.focus();
      };
      maxInput.onkeydown = (evt) => {
        if (evt.key !== "Enter") return;
        evt.preventDefault();
        commitRange();
        maxInput.blur();
      };
      minRow.append(minLabel, minInput);
      maxRow.append(maxLabel, maxInput);
      rangeWrap.append(minRow, maxRow);
      rangeLabel.append(rangeText, rangeWrap);

      cardRail.append(cardHead, modeField, rangeLabel);
      card.append(cardRail);
      cardList.append(card);
    }
    item.append(head, cardList);
    ui.craftAssistList.append(item);
  }
}
function calcCraftAssistMaterialTotalCount(materials) {
  return (Array.isArray(materials) ? materials : [])
    .reduce((sum, item) => sum + normalizeCraftAssistEntryCount(item && item.count, 1), 0);
}
function calcCraftAssistLiveTotalCount(materials = state.craftAssistMaterials) {
  return (Array.isArray(materials) ? materials : [])
    .reduce((sum, item) => sum + normalizeCraftAssistEntryCount(item && item.count, 1), 0);
}
function validateCraftAssistMaterialEntriesForSave(materials = state.craftAssistMaterials) {
  const list = Array.isArray(materials) ? materials : [];
  let emptyCount = 0;
  for (const entry of list) {
    if (craftAssistMaterialNames(entry).length <= 0) emptyCount += 1;
  }
  if (emptyCount > 0) {
    return {ok: false, message: `保存失败：存在${emptyCount}个空材料项，请先添加材料或删除整项`};
  }
  return {ok: true};
}
function craftAssistMaterialLimitFor(materials = state.craftAssistMaterials) {
  return craftAssistTargetCountFromMaterials(Array.isArray(materials) ? materials : []);
}

function validateCraftAssistPresetSnapshot(snapshot) {
  if (!snapshot) {
    return {ok: false, message: "当前无可保存的辅助选材配置"};
  }
  const materials = Array.isArray(snapshot.materials) ? snapshot.materials : [];
  const mode = craftAssistTargetCountFromMaterials(materials);
  const totalCount = calcCraftAssistMaterialTotalCount(materials);
  if (totalCount !== mode) {
    return {ok: false, message: `保存失败：材料数量需等于 ${mode}，当前 ${totalCount}`};
  }
  return {ok: true, mode, totalCount};
}

function validateCurrentCraftAssistPresetBeforeNaming() {
  const materialCheck = validateCraftAssistMaterialEntriesForSave(state.craftAssistMaterials);
  if (!materialCheck.ok) {
    return materialCheck;
  }
  const targetWearPair = resolveCraftAssistTargetWearPair(state.craftAssistTargetWear, state.craftAssistTargetWearRaw);
  if (!targetWearPair) {
    return {ok: false, message: "请先填写有效的目标相对磨损"};
  }
  const probe = buildCurrentCraftAssistPresetSnapshot("__precheck__");
  return validateCraftAssistPresetSnapshot(probe);
}

function isCraftAssistPresetEditing() {
  return !!String(state.craftAssistPresetEditingId || "").trim();
}

function buildCraftAssistDraftSnapshotFromState() {
  const targetWearPair = resolveCraftAssistTargetWearPair(state.craftAssistTargetWear, state.craftAssistTargetWearRaw);
  return {
    panel_open: !!state.craftAssistOpen,
    target_wear: targetWearPair ? targetWearPair.target_wear : null,
    target_wear_raw: targetWearPair ? targetWearPair.target_wear_raw : "",
    materials: projectCraftAssistPersistedMaterialsFromState(state.craftAssistMaterials),
    pick_role: normalizeCraftAssistRole(state.craftAssistPickRole)
  };
}

function buildCraftAssistPresetComparableSnapshot({name = "", targetWear = null, targetWearRaw = "", wearFilterMode = "relative", materials = []} = {}) {
  const targetWearPair = resolveCraftAssistTargetWearPair(targetWear, targetWearRaw);
  const parsedTargetWear = targetWearPair ? targetWearPair.target_wear : null;
  const normalizedMaterials = projectCraftAssistPersistedMaterialsFromState(normalizeCraftAssistMaterialList(materials, {
    targetWear: parsedTargetWear,
    idPrefix: "assist",
    useRelative: normalizeCraftAssistFilterMode(wearFilterMode) !== "absolute",
    rows: getAllInventoryCraftableRows()
  }));
  return {
    name: String(name || "").trim(),
    target_wear: parsedTargetWear,
    target_wear_raw: targetWearPair ? targetWearPair.target_wear_raw : "",
    materials: normalizedMaterials
  };
}

function getCurrentCraftAssistPresetComparableSnapshot() {
  const filterMode = getCraftAssistFilterMode();
  return buildCraftAssistPresetComparableSnapshot({
    name: state.craftAssistPresetEditingName,
    targetWear: state.craftAssistTargetWear,
    targetWearRaw: state.craftAssistTargetWearRaw,
    wearFilterMode: filterMode,
    materials: state.craftAssistMaterials
  });
}

function isCraftAssistPresetEditingDirty() {
  if (!isCraftAssistPresetEditing()) return false;
  const baseline = state.craftAssistPresetEditingInitialSnapshot;
  if (!baseline || typeof baseline !== "object") return false;
  const current = getCurrentCraftAssistPresetComparableSnapshot();
  return JSON.stringify(baseline) !== JSON.stringify(current);
}

function restoreCraftAssistDraftSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return;
  const targetWearPair = resolveCraftAssistTargetWearPair(snapshot.target_wear, snapshot.target_wear_raw);
  state.craftAssistTargetWear = targetWearPair ? targetWearPair.target_wear : null;
  state.craftAssistTargetWearRaw = targetWearPair ? targetWearPair.target_wear_raw : "";
  state.craftAssistMaterials = normalizeCraftAssistMaterialList(snapshot.materials, {
    targetWear: state.craftAssistTargetWear,
    idPrefix: "assist",
    useRelative: normalizeCraftAssistFilterMode(snapshot.wear_filter_mode) !== "absolute",
    rows: getAllInventoryCraftableRows()
  });
  state.craftAssistUseAbsoluteWear = false;
  syncCraftAssistAutoDirectionLimit();
  state.craftAssistPickRole = normalizeCraftAssistRole(snapshot.pick_role);
  state.craftAssistPickerOpen = false;
  state.craftAssistPickerTargetMaterialId = "";
  state.craftAssistRoleChooserOpen = false;
}

function clearCraftAssistPresetEditingState({restoreDraft = false} = {}) {
  if (restoreDraft && state.craftAssistPresetEditingBackup) {
    restoreCraftAssistDraftSnapshot(state.craftAssistPresetEditingBackup);
  }
  state.craftAssistPresetEditingId = "";
  state.craftAssistPresetEditingName = "";
  state.craftAssistPresetEditingBackup = null;
  state.craftAssistPresetEditingInitialSnapshot = null;
}

function loadCraftAssistPresetIntoDraft(preset) {
  const normalized = sanitizeCraftAssistPresetPayload(preset);
  if (!normalized) return null;
  state.craftAssistTargetWear = normalizeCraftAssistTargetWearStep(normalized.target_wear);
  state.craftAssistTargetWearRaw = String(normalized.target_wear_raw || "").trim();
  state.craftAssistMaterials = normalizeCraftAssistMaterialList(normalized.materials, {
    targetWear: state.craftAssistTargetWear,
    idPrefix: "assist",
    useRelative: true,
    rows: getAllInventoryCraftableRows()
  });
  state.craftAssistUseAbsoluteWear = false;
  syncCraftAssistAutoDirectionLimit();
  state.craftAssistPickRole = "main";
  state.craftAssistPickerOpen = false;
  state.craftAssistPickerTargetMaterialId = "";
  state.craftAssistRoleChooserOpen = false;
  return normalized;
}

function saveCurrentCraftAssistPreset(nameInput) {
  const name = String(nameInput || "").trim();
  if (!name) {
    setCraftStatus("请先输入配置名称", true);
    return false;
  }
  const materialCheck = validateCraftAssistMaterialEntriesForSave(state.craftAssistMaterials);
  if (!materialCheck.ok) {
    setCraftStatus(materialCheck.message, true);
    return false;
  }
  const snapshot = buildCurrentCraftAssistPresetSnapshot(name);
  const check = validateCraftAssistPresetSnapshot(snapshot);
  if (!check.ok) {
    setCraftStatus(check.message, true);
    return false;
  }
  const list = Array.isArray(state.craftAssistPresets) ? [...state.craftAssistPresets] : [];
  const idx = list.findIndex((entry) => String(entry && entry.name || "").trim() === name);
  if (idx >= 0) {
    const existed = list[idx];
    const next = {
      ...snapshot,
      id: String(existed && existed.id || snapshot.id || "").trim() || makeCraftAssistUid("preset"),
      created_at: Math.max(0, Number(existed && existed.created_at || 0) || 0) || snapshot.created_at,
      updated_at: Date.now()
    };
    list[idx] = next;
  } else {
    list.unshift(snapshot);
  }
  state.craftAssistPresets = list
    .map((entry) => sanitizeCraftAssistPresetPayload(entry))
    .filter(Boolean)
    .slice(0, 40);
  saveCraftAssistPresetsToStorage();
  setCraftStatus(`已保存辅助配置：${name}`);
  renderCraftAssistPanel();
  return true;
}

async function promptAndSaveCurrentCraftAssistPreset() {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可保存炼金辅助配置。",
    view: "login"
  }) === false) {
    return false;
  }
  const preCheck = validateCurrentCraftAssistPresetBeforeNaming();
  if (!preCheck.ok) {
    setCraftStatus(preCheck.message, true);
    return false;
  }
  const presetName = await openCraftAssistPresetModal("");
  if (presetName == null) return false;
  return saveCurrentCraftAssistPreset(presetName);
}
async function applyCraftAssistPreset(presetId, {autoSelect = true, applyCount = 1} = {}) {
  const id = String(presetId || "").trim();
  if (!id) return;
  const list = Array.isArray(state.craftAssistPresets) ? state.craftAssistPresets : [];
  const idx = list.findIndex((entry) => String(entry && entry.id || "").trim() === id);
  if (idx < 0) return;
  const preset = sanitizeCraftAssistPresetPayload(list[idx]);
  if (!preset) return;

  if (autoSelect) {
    const draftBackup = buildCraftAssistDraftSnapshotFromState();
    const repeatCount = normalizeCraftAssistApplyCount(applyCount, 1);
    const runUsername = String(state.currentAccountUsername || state.accountSelectedUsername || "").trim();
    const targetWearPair = resolveCraftAssistTargetWearPair(preset.target_wear, preset.target_wear_raw);
    const batchOptions = {
      sourcePresetName: preset.name,
      repeatCount,
      draftSnapshot: {
        panel_open: draftBackup.panel_open,
        target_wear: targetWearPair ? targetWearPair.target_wear : null,
        target_wear_raw: targetWearPair ? targetWearPair.target_wear_raw : "",
        wear_filter_mode: preset.wear_filter_mode,
        materials: preset.materials,
        pick_role: draftBackup.pick_role
      },
      pendingUiAction: "preset_apply",
      pendingPresetId: id
    };
    if (runUsername) batchOptions.accountUsername = runUsername;
    return await applyCraftAssistAutoSelectionBatch(batchOptions);
  }

  if (isCraftAssistPresetEditing()) {
    clearCraftAssistPresetEditingState({restoreDraft: true});
  }
  const loaded = loadCraftAssistPresetIntoDraft(preset);
  if (!loaded) return;
  const now = Date.now();
  state.craftAssistPresets[idx] = {
    ...loaded,
    updated_at: now
  };
  saveCraftAssistPresetsToStorage();
  renderCraftAssistPanel();
  setCraftStatus(`已应用配置：${loaded.name}`);
}

function saveCraftAssistPresetEditingSession() {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可编辑炼金辅助配置。",
    view: "login"
  }) === false) {
    return false;
  }
  const editingId = String(state.craftAssistPresetEditingId || "").trim();
  if (!editingId) return false;
  const backupPanelOpen = !!(state.craftAssistPresetEditingBackup && state.craftAssistPresetEditingBackup.panel_open);
  const list = Array.isArray(state.craftAssistPresets) ? [...state.craftAssistPresets] : [];
  const idx = list.findIndex((entry) => String(entry && entry.id || "").trim() === editingId);
  if (idx < 0) {
    clearCraftAssistPresetEditingState({restoreDraft: true});
    setCraftAssistPanelOpen(backupPanelOpen, {expandOnOpen: false});
    setCraftStatus("编辑目标不存在，已退出独立编辑", true);
    return false;
  }
  const existed = sanitizeCraftAssistPresetPayload(list[idx]);
  if (!existed) {
    clearCraftAssistPresetEditingState({restoreDraft: true});
    setCraftAssistPanelOpen(backupPanelOpen, {expandOnOpen: false});
    setCraftStatus("编辑目标无效，已退出独立编辑", true);
    return false;
  }
  const materialCheck = validateCraftAssistMaterialEntriesForSave(state.craftAssistMaterials);
  if (!materialCheck.ok) {
    setCraftStatus(materialCheck.message, true);
    return false;
  }
  const editingName = String(state.craftAssistPresetEditingName || "").trim();
  if (!editingName) {
    setCraftStatus("请先填写配置名称", true);
    return false;
  }
  const snapshot = buildCurrentCraftAssistPresetSnapshot(editingName);
  const check = validateCraftAssistPresetSnapshot(snapshot);
  if (!check.ok) {
    setCraftStatus(check.message, true);
    return false;
  }
  const next = {
    ...snapshot,
    id: String(existed.id || "").trim() || editingId,
    name: editingName,
    created_at: Math.max(0, Number(existed.created_at || 0) || 0) || snapshot.created_at,
    updated_at: Date.now()
  };
  list[idx] = next;
  state.craftAssistPresets = normalizeCraftAssistPresetList(list);
  saveCraftAssistPresetsToStorage();
  const presetName = String(next.name || "").trim() || "未命名配置";
  clearCraftAssistPresetEditingState({restoreDraft: true});
  setCraftAssistPanelOpen(backupPanelOpen, {expandOnOpen: false});
  setCraftStatus(`已保存配置：${presetName}（独立编辑）`);
  renderCraftAssistPanel();
  return true;
}

function applyCraftAssistPresetForEdit(presetId) {
  const id = String(presetId || "").trim();
  if (!id) return;
  const list = Array.isArray(state.craftAssistPresets) ? state.craftAssistPresets : [];
  const idx = list.findIndex((entry) => String(entry && entry.id || "").trim() === id);
  if (idx < 0) return;
  const preset = sanitizeCraftAssistPresetPayload(list[idx]);
  if (!preset) return;
  if (isCraftAssistPresetEditing()) {
    const sameId = String(state.craftAssistPresetEditingId || "").trim() === id;
    if (sameId) {
      setCraftAssistPanelOpen(true, {expandOnOpen: false});
      return;
    }
    const dirty = isCraftAssistPresetEditingDirty();
    if (dirty) {
      const saveThenSwitch = window.confirm(
        `当前编辑存在未保存修改。\n` +
        `确定：保存并切换到【${String(preset.name || "").trim() || "目标配置"}】\n` +
        `取消：不保存并切换到【${String(preset.name || "").trim() || "目标配置"}】`
      );
      if (saveThenSwitch) {
        const saved = saveCraftAssistPresetEditingSession();
        if (!saved) return;
      } else {
        clearCraftAssistPresetEditingState({restoreDraft: true});
      }
    } else {
      clearCraftAssistPresetEditingState({restoreDraft: true});
    }
  }
  state.craftAssistPresetEditingBackup = buildCraftAssistDraftSnapshotFromState();
  state.craftAssistPresetEditingInitialSnapshot = buildCraftAssistPresetComparableSnapshot({
    name: preset.name,
    targetWear: preset.target_wear,
    wearFilterMode: preset.wear_filter_mode,
    materials: preset.materials
  });
  state.craftAssistPresetEditingId = String(preset.id || "").trim();
  state.craftAssistPresetEditingName = String(preset.name || "").trim();
  loadCraftAssistPresetIntoDraft(preset);
  setCraftAssistPanelOpen(true, {expandOnOpen: false});
  setCraftStatus(`正在独立编辑配置：${preset.name}。点击“保存修改”生效，关闭则取消`, false);
}

function cancelCraftAssistPresetEditingSession() {
  if (!isCraftAssistPresetEditing()) return;
  const backupPanelOpen = !!(state.craftAssistPresetEditingBackup && state.craftAssistPresetEditingBackup.panel_open);
  clearCraftAssistPresetEditingState({restoreDraft: true});
  setCraftAssistPanelOpen(backupPanelOpen, {expandOnOpen: false});
  setCraftStatus("已取消独立编辑，当前配方配置未变");
}
function reorderCraftAssistPresets(sourceId, targetId, {after = false} = {}) {
  const fromId = String(sourceId || "").trim();
  const toId = String(targetId || "").trim();
  if (!fromId || !toId || fromId === toId) return false;
  const list = Array.isArray(state.craftAssistPresets) ? state.craftAssistPresets : [];
  const moving = list.find((entry) => String(entry && entry.id || "").trim() === fromId);
  if (!moving) return false;
  const remaining = list.filter((entry) => String(entry && entry.id || "").trim() !== fromId);
  const targetIndex = remaining.findIndex((entry) => String(entry && entry.id || "").trim() === toId);
  if (targetIndex < 0) return false;
  const insertIndex = after ? targetIndex + 1 : targetIndex;
  remaining.splice(insertIndex, 0, moving);
  state.craftAssistPresets = remaining;
  saveCraftAssistPresetsToStorage();
  return true;
}
function clearCraftAssistPresetDragMarkers() {
  if (!ui.craftAssistPresetList) return;
  for (const node of ui.craftAssistPresetList.querySelectorAll(".craft-assist-preset-item")) {
    node.classList.remove("dragging", "drag-over-before", "drag-over-after");
  }
}
function removeCraftAssistPreset(presetId) {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可管理炼金辅助配置。",
    view: "login"
  }) === false) {
    return;
  }
  const id = String(presetId || "").trim();
  if (!id) return;
  const wasEditing = String(state.craftAssistPresetEditingId || "").trim() === id;
  const list = Array.isArray(state.craftAssistPresets) ? state.craftAssistPresets : [];
  const target = list.find((entry) => String(entry && entry.id || "").trim() === id);
  state.craftAssistPresets = list.filter((entry) => String(entry && entry.id || "").trim() !== id);
  if (state.craftAssistPresetApplyCountMap && typeof state.craftAssistPresetApplyCountMap === "object") {
    delete state.craftAssistPresetApplyCountMap[id];
  }
  if (wasEditing) {
    clearCraftAssistPresetEditingState({restoreDraft: true});
  }
  saveCraftAssistPresetsToStorage();
  if (target) setCraftStatus(`已删除配置：${String(target.name || "").trim()}`);
  renderCraftAssistPanel();
}
function duplicateCraftAssistPreset(presetId) {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可管理炼金辅助配置。",
    view: "login"
  }) === false) {
    return;
  }
  const id = String(presetId || "").trim();
  if (!id) return;
  const list = Array.isArray(state.craftAssistPresets) ? [...state.craftAssistPresets] : [];
  const idx = list.findIndex((entry) => String(entry && entry.id || "").trim() === id);
  if (idx < 0) return;
  const preset = sanitizeCraftAssistPresetPayload(list[idx]);
  if (!preset) return;
  const baseName = String(preset.name || "").trim() || "未命名配置";
  const existingNames = new Set(list.map((entry) => String(entry && entry.name || "").trim()).filter(Boolean));
  let duplicateName = `${baseName}（副本）`;
  let suffix = 2;
  while (existingNames.has(duplicateName)) {
    duplicateName = `${baseName}（副本${suffix}）`;
    suffix += 1;
  }
  const now = Date.now();
  const duplicated = sanitizeCraftAssistPresetPayload({
    ...preset,
    id: makeCraftAssistUid("preset"),
    name: duplicateName,
    materials: (Array.isArray(preset.materials) ? preset.materials : []).map((entry) => ({
      ...entry,
      items: Array.isArray(entry && entry.items) ? entry.items.map((item) => ({...item})) : []
    })),
    created_at: now,
    updated_at: now
  });
  if (!duplicated) {
    setCraftStatus("复制配置失败，请稍后重试", true);
    return;
  }
  list.splice(idx + 1, 0, duplicated);
  state.craftAssistPresets = normalizeCraftAssistPresetList(list);
  saveCraftAssistPresetsToStorage();
  setCraftStatus(`已复制配置：${duplicated.name}`);
  renderCraftAssistPanel();
}
function renderCraftAssistPresetPanel() {
  if (!ui.craftAssistPresetPanel || !ui.craftAssistPresetList) return;
  const prevPresetScrollTop = Math.max(0, Number(ui.craftAssistPresetList.scrollTop || 0) || 0);
  if (ui.craftAssistPresetSaveBtn) {
    ui.craftAssistPresetSaveBtn.disabled = state.refreshing || state.craftBusy;
  }
  ui.craftAssistPresetList.replaceChildren();
  const list = Array.isArray(state.craftAssistPresets) ? state.craftAssistPresets : [];
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "craft-assist-preset-empty";
    empty.textContent = "暂无配置，保存后可一键复用";
    ui.craftAssistPresetList.append(empty);
    return;
  }
  craftAssistPresetDraggingId = "";
  const applyCountMap = state.craftAssistPresetApplyCountMap && typeof state.craftAssistPresetApplyCountMap === "object"
    ? state.craftAssistPresetApplyCountMap
    : {};
  state.craftAssistPresetApplyCountMap = applyCountMap;
  const livePresetIds = new Set(list.map((entry) => String(entry && entry.id || "").trim()).filter(Boolean));
  for (const key of Object.keys(applyCountMap)) {
    if (!livePresetIds.has(String(key || "").trim())) {
      delete applyCountMap[key];
    }
  }
  const activeEditingId = String(state.craftAssistPresetEditingId || "").trim();
  const inEditingMode = !!activeEditingId;
  for (const preset of list) {
    const item = document.createElement("div");
    item.className = "craft-assist-preset-item";
    const presetId = String(preset && preset.id || "").trim();
    const isEditingItem = inEditingMode && presetId === activeEditingId;
    item.classList.toggle("editing", isEditingItem);
    item.draggable = !(state.refreshing || state.craftBusy || state.craftAssistSelecting || inEditingMode);
    const applyCountValue = normalizeCraftAssistApplyCount(applyCountMap[presetId], 1);
    if (presetId) applyCountMap[presetId] = applyCountValue;
    item.ondragstart = (evt) => {
      craftAssistPresetDraggingId = presetId;
      item.classList.add("dragging");
      if (evt && evt.dataTransfer) {
        evt.dataTransfer.effectAllowed = "move";
        evt.dataTransfer.setData("text/plain", presetId);
      }
    };
    item.ondragend = () => {
      craftAssistPresetDraggingId = "";
      clearCraftAssistPresetDragMarkers();
    };
    item.ondragover = (evt) => {
      const dragging = String(craftAssistPresetDraggingId || "").trim();
      if (!dragging || dragging === presetId) return;
      evt.preventDefault();
      const rect = item.getBoundingClientRect();
      const after = evt.clientY > rect.top + rect.height / 2;
      item.classList.toggle("drag-over-before", !after);
      item.classList.toggle("drag-over-after", after);
    };
    item.ondragleave = () => {
      item.classList.remove("drag-over-before", "drag-over-after");
    };
    item.ondrop = (evt) => {
      evt.preventDefault();
      const dragging = String(craftAssistPresetDraggingId || "").trim();
      item.classList.remove("drag-over-before", "drag-over-after");
      if (!dragging || dragging === presetId) return;
      const rect = item.getBoundingClientRect();
      const after = evt.clientY > rect.top + rect.height / 2;
      const changed = reorderCraftAssistPresets(dragging, presetId, {after});
      craftAssistPresetDraggingId = "";
      clearCraftAssistPresetDragMarkers();
      if (changed) renderCraftAssistPanel();
    };

    const name = document.createElement("div");
    name.className = "craft-assist-preset-name";
    name.textContent = String(preset && preset.name || "未命名配置");

    const count = (Array.isArray(preset && preset.materials) ? preset.materials : [])
      .reduce((sum, material) => sum + normalizeCraftAssistEntryCount(material && material.count, 1), 0);
    const meta = document.createElement("div");
    meta.className = "craft-assist-preset-meta";
    const metaTop = document.createElement("div");
    metaTop.className = "craft-assist-preset-meta-top";
    metaTop.textContent = `材料 ${(preset && preset.materials && preset.materials.length) || 0} 项 / ${count} 件 | ${formatCraftAssistPresetTime(preset && preset.updated_at)}`;
    const metaWear = document.createElement("div");
    metaWear.className = "craft-assist-preset-meta-wear";
    metaWear.textContent = `wear: ${wearTextFull(preset && preset.target_wear)}`;
    meta.append(metaTop, metaWear);
    const body = document.createElement("div");
    body.className = "craft-assist-preset-body";
    body.append(name, meta);

    const footer = document.createElement("div");
    footer.className = "craft-assist-preset-footer";
    const actions = document.createElement("div");
    actions.className = "craft-assist-preset-actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "craft-assist-preset-action-btn craft-assist-preset-edit";
    editBtn.textContent = "编辑";
    editBtn.disabled = state.refreshing || state.craftBusy;
    editBtn.onclick = () => {
      if (rejectCraftAssistBusyUiAction()) return;
      applyCraftAssistPresetForEdit(preset.id);
    };
    const applyCountWrap = document.createElement("div");
    applyCountWrap.className = "craft-assist-preset-apply-count";
    const applyCountStepper = document.createElement("div");
    applyCountStepper.className = "craft-assist-preset-apply-stepper";
    const applyCountInput = document.createElement("input");
    applyCountInput.type = "number";
    applyCountInput.min = "1";
    applyCountInput.max = "100";
    applyCountInput.step = "1";
    applyCountInput.value = String(applyCountValue);
    applyCountInput.setAttribute("aria-label", "应用数量");
    applyCountInput.disabled = inEditingMode || state.refreshing || state.craftBusy;
    const commitApplyCountValue = (value) => {
      const next = normalizeCraftAssistApplyCount(value, applyCountMap[presetId]);
      applyCountInput.value = String(next);
      if (presetId) applyCountMap[presetId] = next;
      return next;
    };
    applyCountInput.onchange = () => {
      commitApplyCountValue(applyCountInput.value);
    };
    const decrementBtn = document.createElement("button");
    decrementBtn.type = "button";
    decrementBtn.className = "craft-assist-preset-apply-step decrement";
    decrementBtn.textContent = "−";
    decrementBtn.title = "减少应用数量";
    decrementBtn.setAttribute("aria-label", "减少应用数量");
    decrementBtn.disabled = applyCountInput.disabled;
    decrementBtn.onclick = () => {
      if (applyCountInput.disabled) return;
      commitApplyCountValue((Number(applyCountInput.value) || applyCountValue) - 1);
    };
    const incrementBtn = document.createElement("button");
    incrementBtn.type = "button";
    incrementBtn.className = "craft-assist-preset-apply-step increment";
    incrementBtn.textContent = "+";
    incrementBtn.title = "增加应用数量";
    incrementBtn.setAttribute("aria-label", "增加应用数量");
    incrementBtn.disabled = applyCountInput.disabled;
    incrementBtn.onclick = () => {
      if (applyCountInput.disabled) return;
      commitApplyCountValue((Number(applyCountInput.value) || applyCountValue) + 1);
    };
    applyCountStepper.append(decrementBtn, applyCountInput, incrementBtn);
    applyCountWrap.append(applyCountStepper);
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "craft-assist-preset-action-btn craft-assist-preset-apply";
    applyBtn.textContent = "应用";
    applyBtn.disabled = inEditingMode || state.refreshing || state.craftBusy || isCraftAssistPendingUiAction("preset_apply", {presetId});
    applyBtn.onclick = () => {
      const countValue = commitApplyCountValue(applyCountInput.value);
      void applyCraftAssistPreset(preset.id, {autoSelect: true, applyCount: countValue});
    };
    const duplicateBtn = document.createElement("button");
    duplicateBtn.type = "button";
    duplicateBtn.textContent = "复制";
    duplicateBtn.className = "craft-assist-preset-duplicate";
    duplicateBtn.title = "复制该配置";
    duplicateBtn.setAttribute("aria-label", "复制该配置");
    duplicateBtn.disabled = inEditingMode || state.refreshing || state.craftBusy;
    duplicateBtn.onclick = () => {
      if (rejectCraftAssistBusyUiAction()) return;
      duplicateCraftAssistPreset(preset.id);
    };
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.className = "craft-assist-preset-remove";
    removeBtn.title = "删除该配置";
    removeBtn.setAttribute("aria-label", "删除该配置");
    removeBtn.disabled = inEditingMode || state.refreshing || state.craftBusy;
    removeBtn.onclick = async () => {
      if (rejectCraftAssistBusyUiAction()) return;
      const confirmed = await openConfirmModal({
        title: "确认删除配置",
        message: `确定要删除配置【${String(preset && preset.name || "").trim() || "该配置"}】吗？`,
        confirmText: "确认删除",
        cancelText: "取消"
      });
      if (!confirmed) return;
      removeCraftAssistPreset(preset.id);
    };
    actions.append(editBtn, applyCountWrap, applyBtn);
    footer.append(actions);

    item.append(body, footer, duplicateBtn, removeBtn);
    ui.craftAssistPresetList.append(item);
  }
  ui.craftAssistPresetList.scrollTop = prevPresetScrollTop;
}
function normalizeCraftAssistMaterialsForRun({materials = state.craftAssistMaterials, targetWear = state.craftAssistTargetWear, wearFilterMode = getCraftAssistFilterMode()} = {}) {
  const normalized = normalizeCraftAssistMaterialList(materials, {
    targetWear,
    idPrefix: "assist",
    useRelative: normalizeCraftAssistFilterMode(wearFilterMode) !== "absolute",
    rows: getAllInventoryCraftableRows()
  })
    .filter((entry) => craftAssistMaterialNames(entry).length > 0 && normalizeCraftAssistEntryCount(entry && entry.count, 1) > 0);
  return projectCraftAssistPersistedMaterialsFromState(normalized);
}
async function applyCraftAssistAutoSelection({accountUsername = "", sourcePresetName = "", draftSnapshot = null, pendingUiAction = "", pendingPresetId = ""} = {}) {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可使用辅助选材生成真实炼金配方。",
    view: "login"
  }) === false) {
    return false;
  }
  if (state.craftBusy) {
    setCraftStatus("汰换执行中，请稍后再试", true);
    return false;
  }
  if (state.refreshing) {
    setCraftStatus("库存刷新中，请稍后再试", true);
    return false;
  }
  const runUsername = String(accountUsername || state.currentAccountUsername || state.accountSelectedUsername || "").trim();
  if (!runUsername) {
    setCraftStatus("请先选择账号", true);
    return false;
  }
  let scopedState = getCraftAccountScopedStateSnapshot(runUsername);
  let runtimeState = getCraftAssistRuntimeStateSnapshot(runUsername, {
    preferCurrent: runUsername === String(state.currentAccountUsername || "").trim()
  });
  const commitScopedState = ({showErrorToastOnCurrent = false} = {}) => {
    const next = commitCraftAccountScopedState(runUsername, scopedState, {renderIfCurrent: true});
    if (next) scopedState = next;
    if (
      showErrorToastOnCurrent &&
      next &&
      next.craftStatusError &&
      next.craftStatusText &&
      runUsername === String(state.currentAccountUsername || "").trim()
    ) {
      showErrorToast(next.craftStatusText);
    }
    return next;
  };
  const setScopedStatus = (text, isError = false) => {
    setCraftStatusOnScopedState(scopedState, text, isError);
    commitScopedState({showErrorToastOnCurrent: isError});
  };
  if (state.craftAssistSelecting) {
    setCraftStatus("辅助选材处理中，请稍后再试", true);
    return false;
  }
  if (runtimeState.craftAssistSelecting) {
    setScopedStatus("辅助选材处理中，请稍后再试", true);
    return false;
  }
  const runSnapshot = draftSnapshot && typeof draftSnapshot === "object"
    ? draftSnapshot
    : buildCraftAssistDraftSnapshotFromScopedState(scopedState);
  const wearFilterMode = normalizeCraftAssistFilterMode(runSnapshot.wear_filter_mode);
  const targetWearPair = resolveCraftAssistTargetWearPair(runSnapshot.target_wear, runSnapshot.target_wear_raw);
  const targetValue = targetWearPair ? targetWearPair.target_wear : null;
  const targetWearRaw = targetWearPair ? targetWearPair.target_wear_raw : "";
  const materials = normalizeCraftAssistMaterialsForRun({
    materials: runSnapshot.materials,
    targetWear: targetValue,
    wearFilterMode
  });
  if (!materials.length) {
    setScopedStatus("请先添加父类材料并设置数量", true);
    return false;
  }
  const mode = craftAssistTargetCountFromMaterials(materials);
  const totalCount = materials.reduce((sum, item) => sum + Number(item.count || 0), 0);
  if (totalCount > mode) {
    setScopedStatus(`材料数量之和不能超过 ${mode}，当前 ${totalCount}`, true);
    return false;
  }
  if (targetValue == null) {
    setScopedStatus("请先输入目标相对磨损", true);
    return false;
  }
  const pendingCount = getCraftQueuePendingCountFromState(scopedState);
  if (pendingCount >= 50) {
    setScopedStatus("配方预览最多 50 组配方", true);
    return false;
  }

  try {
    const runToken = setCraftAssistActiveRunToken(runUsername, createCraftAssistRunToken());
    runtimeState = saveCraftAssistRuntimeState(runUsername, {
      craftAssistSelecting: true,
      craftAssistPendingUiAction: String(pendingUiAction || "").trim(),
      craftAssistPendingPresetId: String(pendingPresetId || "").trim(),
      craftAssistRunToken: runToken
    });
    if (runUsername === String(state.currentAccountUsername || "").trim()) {
      applyCraftAssistRuntimeStateSnapshot(runtimeState, {username: runUsername});
    }
    commitScopedState();

    // 每次点击只新增并填充 1 组配方，不覆盖当前编辑中的配方。
    const created = createEmptyCraftRecipeEntryInState(scopedState, {activate: false});
    if (!created) {
      setScopedStatus("当前无可编辑配方槽位", true);
      return false;
    }
    const createdId = String(created.id || "").trim();
    const findCreatedEntry = () => {
      return (Array.isArray(scopedState.craftRecipeQueue) ? scopedState.craftRecipeQueue : [])
        .find((entry) => String(entry && entry.id || "").trim() === createdId) || null;
    };
    const removeCreatedEntry = () => {
      scopedState.craftRecipeQueue = (Array.isArray(scopedState.craftRecipeQueue) ? scopedState.craftRecipeQueue : [])
        .filter((entry) => String(entry && entry.id || "").trim() !== createdId);
    };

    const pendingEntries = getCraftQueuePendingEntriesFromState(scopedState);
    const pendingOrder = new Map();
    for (let i = 0; i < pendingEntries.length; i += 1) {
      const entry = pendingEntries[i];
      const key = String(entry && entry.id || "").trim();
      if (!key) continue;
      pendingOrder.set(key, i + 1);
    }
    const recipeNo = pendingOrder.get(createdId) || pendingEntries.length;
    const activeRecipeId = String(scopedState.craftActiveRecipeId || "").trim();
    const blockedIds = new Set();
    for (const entry of pendingEntries) {
      const entryId = String(entry && entry.id || "").trim();
      if (entryId === createdId) continue;
      // 当前正在编辑且未满 10 件时，不参与屏蔽，避免“新增一组”时把候选过度裁掉。
      if (activeRecipeId && entryId === activeRecipeId && normalizeCraftRecipeItemIds(entry && entry.item_ids).length < mode) {
        continue;
      }
      for (const id of normalizeCraftRecipeItemIds(entry && entry.item_ids)) {
        blockedIds.add(id);
      }
    }

    const wearOffset = normalizeCraftAssistWearOffset(state.craftAssistWearOffset, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET);
    const summarizeDebugMaterials = (list) => {
      return (Array.isArray(list) ? list : []).map((material) => {
        const base = material && typeof material === "object" ? material : {};
        const fallbackItems = Array.isArray(base.names)
          ? base.names.map((name) => ({
              name,
              wear_filter_mode: base.wear_filter_mode,
              wear_min: base.wear_min,
              wear_max: base.wear_max
            }))
          : [];
        const rawItems = Array.isArray(base.items) && base.items.length ? base.items : fallbackItems;
        const itemNames = rawItems
          .map((item) => String(item && item.name || "").trim())
          .filter(Boolean);
        const wearRanges = rawItems
          .map((item) => {
            const wearMin = Number(item && item.wear_min);
            const wearMax = Number(item && item.wear_max);
            return {
              name: String(item && item.name || "").trim(),
              wear_filter_mode: String(item && item.wear_filter_mode || base.wear_filter_mode || "").trim(),
              wear_min: Number.isFinite(wearMin) ? wearMin : null,
              wear_max: Number.isFinite(wearMax) ? wearMax : null
            };
          })
          .filter((entry) => entry.name || entry.wear_filter_mode || entry.wear_min != null || entry.wear_max != null);
        return {
          role: String(base.role || "").trim() || "main",
          count: Number(base.count || 0) || 0,
          item_names: itemNames,
          wear_ranges: wearRanges
        };
      }).filter((entry) => entry.item_names.length || entry.wear_ranges.length || entry.count > 0);
    };
    const normalizeFailureInfo = (err) => {
      const data = err && err.data && typeof err.data === "object" ? err.data : null;
      const message = String(data && data.message || err && err.message || "辅助选材暂时失败，请重试。").trim()
        || "辅助选材暂时失败，请重试。";
      const detail = String(data && data.detail || err && err.message || "").trim() || message;
      const code = String(data && data.code || err && err.code || "").trim();
      return {code, message, detail};
    };
    let run = null;
    try {
      run = await api("/api/craft/assist-select", {
        method: "POST",
        timeoutMs: 60 * 1000,
        timeoutMessage: "辅助选材请求超时，请重试",
        body: JSON.stringify({
          username: runUsername,
          target_wear: targetValue,
          target_wear_raw: targetWearRaw,
          wear_approach_mode: state.craftAssistApproachMode ? "infinite" : "below",
          materials,
          use_component_items: !!state.craftUseComponentItems,
          blocked_ids: [...blockedIds],
          include_cooling: !!state.craftIncludeCooling,
          wear_offset: wearOffset,
          enable_fast_craft_assist: !!state.craftAssistFastMode
        })
      });
    } catch (err) {
      const failure = normalizeFailureInfo(err);
      console.warn("[craft-assist] auto selection failed", {
        account: runUsername,
        target_wear: targetValue,
        target_wear_raw: targetWearRaw,
        wear_approach_mode: state.craftAssistApproachMode ? "infinite" : "below",
        wear_offset: wearOffset,
        enable_fast_craft_assist: !!state.craftAssistFastMode,
        use_component_items: !!state.craftUseComponentItems,
        include_cooling: !!state.craftIncludeCooling,
        blocked_ids_length: blockedIds.size,
        materials: summarizeDebugMaterials(materials),
        code: failure.code,
        message: failure.message,
        detail: failure.detail
      });
      removeCreatedEntry();
      setScopedStatus(`配方#${recipeNo}：${failure.message}`, true);
      return false;
    }

    const createdEntry = findCreatedEntry();
    if (!createdEntry) {
      setScopedStatus(`配方#${recipeNo}：配方槽位已失效，请重试`, true);
      return false;
    }
    createdEntry.item_ids = normalizeCraftRecipeItemIds(run && (run.item_ids || run.itemIds));
    resetCraftRecipeEntryPreparation(createdEntry);
    if (createdEntry.item_ids.length !== mode) {
      removeCreatedEntry();
      setScopedStatus(`配方#${recipeNo}：辅助选材返回数量异常（${createdEntry.item_ids.length}/${mode}）`, true);
      return false;
    }
    const accountRows = getCraftRowsForAccount(runUsername);
    const rowsById = buildRowsByAssetId(accountRows);
    syncCraftRecipeEntryItemSources(createdEntry, rowsById, getCraftComponentSummaryMapForAccount(runUsername));
    commitScopedState();
    const selectedRows = createdEntry.item_ids.map((id) => rowsById.get(id)).filter(Boolean);
    const sourceText = String(sourcePresetName || "").trim();
    if (selectedRows.length) {
      logCraftAssistPickedRows({
        recipeNo,
        sourceText,
        targetValue,
        runOverall: run && run.overall,
        mode,
        selectedRows
      });
    } else if (Array.isArray(run && run.picks) && run.picks.length) {
      const prefix = `[craft-assist][recipe#${Math.max(1, Number(recipeNo) || 1)}${sourceText ? `|${sourceText}` : ""}]`;
      const targetText = targetValue == null ? "-" : wearTextFull(targetValue);
      const runOverallText = run && run.overall == null ? "-" : wearTextFull(run && run.overall);
      if (typeof console.groupCollapsed === "function") {
        console.groupCollapsed(`${prefix} picked ${run.picks.length}/${mode}, target=${targetText}, algorithm=${runOverallText}`);
      } else {
        console.info(`${prefix} picked ${run.picks.length}/${mode}, target=${targetText}, algorithm=${runOverallText}`);
      }
      console.info(`${prefix} picked_ids=${run.picks.map((item) => item.asset_id).join(",")}`);
      if (typeof console.table === "function") console.table(run.picks);
      else console.info(run.picks);
      if (typeof console.groupEnd === "function") console.groupEnd();
    }
    const localRecipeInfo = selectedRows.length === mode
      ? getTradeUpRecipeFromRows(selectedRows)
      : {ok: true, reason: ""};
    const backendRecipeOk = run && run.recipe_ok !== false;
    const backendRecipeReason = String(run && run.recipe_reason || "").trim();
    const sourceSuffix = sourceText ? `（${sourceText}）` : "";
    setCraftStatusOnScopedState(scopedState, "");
    if (!backendRecipeOk || !localRecipeInfo.ok) {
      const reason = backendRecipeReason || localRecipeInfo.reason || "请调整材料";
      setScopedStatus(`辅助选材完成${sourceSuffix}：已新增配方#${recipeNo}，但不满足炼金规则：${reason}`, true);
      return false;
    }

    const raritySuffix = Number(run && run.rarity || 0) > 0 ? `，稀有度 ${craftRarityLabel(run.rarity)}` : "";
    if (String(run && run.approach_mode || "").trim() === "infinite") {
      setScopedStatus(`辅助选材完成${sourceSuffix}：已新增配方#${recipeNo}，${createdEntry.item_ids.length}/${mode}${raritySuffix}，均值 ${wearTextFull(run.overall)} 逼近目标 ${wearTextFull(targetValue)}`);
    } else {
      setScopedStatus(`辅助选材完成${sourceSuffix}：已新增配方#${recipeNo}，${createdEntry.item_ids.length}/${mode}${raritySuffix}，均值 ${wearTextFull(run.overall)} < 目标 ${wearTextFull(targetValue)}`);
    }
    return true;
  } finally {
    clearCraftAssistActiveRunToken(runUsername, {onlyIfToken: String(runtimeState && runtimeState.craftAssistRunToken || "").trim()});
    runtimeState = saveCraftAssistRuntimeState(runUsername, createDefaultCraftAssistRuntimeState());
    if (runUsername === String(state.currentAccountUsername || "").trim()) {
      applyCraftAssistRuntimeStateSnapshot(runtimeState, {username: runUsername});
    }
    scopedState = getCraftAccountScopedStateSnapshot(runUsername);
    commitScopedState();
  }
}
async function applyCraftAssistAutoSelectionBatch({accountUsername = "", sourcePresetName = "", repeatCount = 1, draftSnapshot = null, pendingUiAction = "", pendingPresetId = ""} = {}) {
  const runUsername = String(accountUsername || state.currentAccountUsername || state.accountSelectedUsername || "").trim();
  const total = normalizeCraftAssistApplyCount(repeatCount, 1);
  let successCount = 0;
  for (let i = 0; i < total; i += 1) {
    const ok = await applyCraftAssistAutoSelection({
      accountUsername: runUsername,
      sourcePresetName,
      draftSnapshot,
      pendingUiAction,
      pendingPresetId
    });
    if (!ok) break;
    successCount += 1;
  }
  if (successCount <= 0) return false;
  let scopedState = getCraftAccountScopedStateSnapshot(runUsername);
  if (successCount < total) {
    const current = String(scopedState.craftStatusText || "").trim();
    setCraftStatusOnScopedState(scopedState, `批量完成 ${successCount}/${total} 组。${current || "已到可用上限"}`, true);
  } else if (total > 1) {
    setCraftStatusOnScopedState(scopedState, `批量完成 ${successCount}/${total} 组配方`);
  }
  commitCraftAccountScopedState(runUsername, scopedState, {renderIfCurrent: true});
  return true;
}
function normalizeCraftPredictorRarityLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = raw
    .toLowerCase()
    .replace(/[\s_\-]/g, "")
    .replace(/grade$/g, "");
  const aliases = {
    consumer: "消费级",
    "消费级": "消费级",
    "白": "消费级",
    industrial: "工业级",
    "工业级": "工业级",
    "浅蓝": "工业级",
    milspec: "军规级",
    "军规级": "军规级",
    "蓝": "军规级",
    restricted: "受限",
    "受限": "受限",
    "紫": "受限",
    classified: "保密",
    "保密": "保密",
    "粉": "保密",
    covert: "隐秘",
    "隐秘": "隐秘",
    "红": "隐秘",
    contraband: "金",
    "违禁": "金",
    "金": "金"
  };
  if (aliases[normalized]) return aliases[normalized];
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && RARITY_MAP[numeric]) {
    return normalizeCraftPredictorRarityLabel(RARITY_MAP[numeric]);
  }
  return raw;
}
function normalizeCraftPredictorContextType(value) {
  const raw = String(value || "").trim();
  return raw === "recipe" || raw === "draft" ? raw : "";
}
function normalizeCraftPredictorContextId(value) {
  return String(value || "").trim();
}
function buildCraftPredictorContextKey(type, id = "") {
  const normalizedType = normalizeCraftPredictorContextType(type);
  const normalizedId = normalizeCraftPredictorContextId(id);
  if (!normalizedType) return "";
  if (normalizedType === "recipe") return normalizedId ? `recipe:${normalizedId}` : "";
  return normalizedId ? `draft:${normalizedId}` : "draft";
}
function normalizeCraftPredictorMaterialNames(material) {
  const source = Array.isArray(material && material.items)
    ? material.items.map((item) => item && item.name)
    : Array.isArray(material && material.names)
      ? material.names
      : (material && material.name != null ? [material.name] : []);
  const out = [];
  const seen = new Set();
  for (const entry of source) {
    const name = String(entry || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
function normalizeCraftPredictorMaterialCount(value, fallback = 1) {
  const numeric = Math.trunc(Number(value));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return Math.max(1, Math.trunc(Number(fallback) || 1));
  }
  return numeric;
}
function normalizeCraftPredictorRequiredCount(value, fallback = 10) {
  const shared = globalThis && globalThis.craftAssistItemWearShared;
  const sharedRequiredCount = shared && typeof shared.resolveCraftAssistRequiredCount === "function"
    ? shared.resolveCraftAssistRequiredCount()
    : null;
  const numeric = Math.trunc(Number(value));
  if (numeric === 5 || numeric === 10) return numeric;
  if (numeric === sharedRequiredCount) return numeric;
  if (sharedRequiredCount != null) return sharedRequiredCount;
  const fallbackNumeric = Math.trunc(Number(fallback));
  if (fallbackNumeric === 5 || fallbackNumeric === 10) return fallbackNumeric;
  return 0;
}
function normalizeCraftPredictorTargetWear(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric));
}
function resolveCraftPredictorApproachMode() {
  const pageId = String(state.currentPage || "").trim();
  const infinite = pageId === "batchCraftPage"
    ? !!state.batchCraftApproachMode
    : !!state.craftAssistApproachMode;
  return infinite ? "infinite" : "below";
}
function clearCraftPredictorPreviewState() {
  state.craftPredictorLoading = false;
  state.craftPredictorError = "";
  state.craftPredictorResponse = null;
  state.craftPredictorRequestKey = "";
  state.craftPredictorLoadedKey = "";
  state.craftPredictorRequestSeq = 0;
}
function clearCraftPredictorPreferredRows() {
  state.craftPredictorPreferredRowsContextKey = "";
  state.craftPredictorPreferredRowsById = null;
}
function setCraftPredictorPreferredRows(contextKey, rowsById) {
  const key = String(contextKey || "").trim();
  if (!key || !(rowsById instanceof Map) || rowsById.size <= 0) {
    clearCraftPredictorPreferredRows();
    return;
  }
  state.craftPredictorPreferredRowsContextKey = key;
  state.craftPredictorPreferredRowsById = new Map(rowsById);
}
function getCraftPredictorRowsById({contextKey = "", preferredRowsById = null} = {}) {
  const liveRowsById = buildRowsByAssetId(getAllInventoryCraftableRows({rows: state.rows, includeComponentItems: true}));
  const nextKey = String(contextKey || "").trim();
  const hintedRowsById = preferredRowsById instanceof Map
    ? preferredRowsById
    : (nextKey && String(state.craftPredictorPreferredRowsContextKey || "").trim() === nextKey && state.craftPredictorPreferredRowsById instanceof Map
        ? state.craftPredictorPreferredRowsById
        : null);
  if (!(hintedRowsById instanceof Map) || hintedRowsById.size <= 0) return liveRowsById;
  const merged = new Map(liveRowsById);
  for (const [id, row] of hintedRowsById.entries()) {
    const key = String(id || "").trim();
    if (!key || !row || typeof row !== "object") continue;
    merged.set(key, row);
  }
  return merged;
}
function clearCraftPredictorContext() {
  state.craftPredictorContextType = "";
  state.craftPredictorContextId = "";
  state.craftPredictorContextLabel = "";
  clearCraftPredictorPreferredRows();
}
function setCraftPredictorPanelOpen(open, {manual = false} = {}) {
  const nextOpen = !!open;
  if (manual && !nextOpen) {
    state.craftPredictorAutoOpenMuted = true;
  }
  state.craftPredictorOpen = nextOpen;
  if (typeof renderCraftPredictorPanel === "function") renderCraftPredictorPanel();
  return state.craftPredictorOpen;
}
function selectCraftPredictorContext({type = "", id = "", label = "", autoOpen = false, forceOpen = false, preferredRowsById = null} = {}) {
  const nextType = normalizeCraftPredictorContextType(type);
  const nextIdRaw = normalizeCraftPredictorContextId(id);
  const resolvedId = nextType === "draft"
    ? (nextIdRaw || String(state.craftActiveRecipeId || "").trim())
    : nextIdRaw;
  const prevKey = buildCraftPredictorContextKey(state.craftPredictorContextType, state.craftPredictorContextId);
  if (!nextType || !resolvedId) {
    const hadContext = !!prevKey;
    clearCraftPredictorContext();
    if (hadContext && typeof clearCraftPredictorPreviewState === "function") clearCraftPredictorPreviewState();
    if (typeof renderCraftPredictorPanel === "function") renderCraftPredictorPanel();
    return;
  }
  const nextKey = buildCraftPredictorContextKey(nextType, resolvedId);
  if (prevKey !== nextKey && typeof clearCraftPredictorPreviewState === "function") {
    clearCraftPredictorPreviewState();
  }
  if (prevKey !== nextKey) {
    clearCraftPredictorPreferredRows();
  }
  state.craftPredictorContextType = nextType;
  state.craftPredictorContextId = resolvedId;
  state.craftPredictorContextLabel = String(label || "").trim() || (nextType === "draft" ? "当前配置" : "已选配方");
  if (preferredRowsById instanceof Map && preferredRowsById.size > 0) {
    setCraftPredictorPreferredRows(nextKey, preferredRowsById);
  }
  if (autoOpen && (forceOpen || !state.craftPredictorAutoOpenMuted)) {
    state.craftPredictorOpen = true;
  }
  if (typeof renderCraftPredictorPanel === "function") renderCraftPredictorPanel();
  if (typeof refreshCraftPredictorPreview === "function") void refreshCraftPredictorPreview({preferredRowsById});
}
function focusCraftPredictorOnActiveDraft({autoOpen = false, preferredRowsById = null} = {}) {
  const activeId = String(state.craftActiveRecipeId || "").trim();
  const activeEntry = activeId ? findCraftRecipeById(activeId) : null;
  if (!activeEntry || String(activeEntry.status || "").trim() === "done") return false;
  selectCraftPredictorContext({type: "draft", id: activeId, label: "当前配置", autoOpen, preferredRowsById});
  return true;
}
function syncCraftPredictorContextWithActiveRecipe() {
  const activeId = String(state.craftActiveRecipeId || "").trim();
  const activeEntry = activeId ? findCraftRecipeById(activeId) : null;
  const activeValid = !!(activeEntry && String(activeEntry.status || "").trim() !== "done");
  const contextType = normalizeCraftPredictorContextType(state.craftPredictorContextType);
  const contextId = normalizeCraftPredictorContextId(state.craftPredictorContextId);
  if (contextType === "recipe") {
    const selectedEntry = contextId ? findCraftRecipeById(contextId) : null;
    if (selectedEntry && String(selectedEntry.status || "").trim() !== "done") return;
  }
  if (activeValid) {
    const nextKey = buildCraftPredictorContextKey("draft", activeId);
    const prevKey = buildCraftPredictorContextKey(contextType, contextId);
    if (prevKey !== nextKey) {
      if (typeof clearCraftPredictorPreviewState === "function") clearCraftPredictorPreviewState();
      clearCraftPredictorPreferredRows();
      state.craftPredictorContextType = "draft";
      state.craftPredictorContextId = activeId;
      state.craftPredictorContextLabel = "当前配置";
    } else if (!String(state.craftPredictorContextLabel || "").trim()) {
      state.craftPredictorContextLabel = "当前配置";
    }
    return;
  }
  if (contextType || contextId || String(state.craftPredictorContextLabel || "").trim()) {
    clearCraftPredictorContext();
    if (typeof clearCraftPredictorPreviewState === "function") clearCraftPredictorPreviewState();
  }
}
function buildCraftPredictorParentGroupMap(parentGroups) {
  const map = new Map();
  for (const group of Array.isArray(parentGroups) ? parentGroups : []) {
    const name = String(group && group.name || "").trim();
    if (!name) continue;
    map.set(name, {
      collection: String(group && group.collection || "").trim(),
      rarity: normalizeCraftPredictorRarityLabel(group && group.rarity),
      stattrak: !!(group && group.stattrak)
    });
  }
  return map;
}
function craftPredictorInvalidDraft(reason, {message = "", requiredCount = 0, currentCount = 0} = {}) {
  return {
    ok: false,
    reason: String(reason || "").trim() || "invalid_request",
    message: String(message || "").trim(),
    requiredCount: Math.max(0, Number(requiredCount) || 0),
    currentCount: Math.max(0, Number(currentCount) || 0)
  };
}
function buildCraftPredictorRequestFromDraft({targetWear = null, requiredCount = 10, materials = [], parentGroups = []} = {}) {
  const normalizedTargetWear = normalizeCraftPredictorTargetWear(targetWear);
  if (normalizedTargetWear == null) {
    return craftPredictorInvalidDraft("missing_target_wear");
  }
  const normalizedRequiredCount = normalizeCraftPredictorRequiredCount(requiredCount, 10);
  if (normalizedRequiredCount <= 0) {
    return craftPredictorInvalidDraft("invalid_required_count");
  }
  const parentGroupMap = buildCraftPredictorParentGroupMap(parentGroups);
  const collectionCountMap = new Map();
  let inputRarity = "";
  let stattrak = null;
  let currentCount = 0;
  for (const material of Array.isArray(materials) ? materials : []) {
    const names = normalizeCraftPredictorMaterialNames(material);
    if (!names.length) continue;
    const count = normalizeCraftPredictorMaterialCount(material && material.count, 1);
    const descriptors = names
      .map((name) => ({name, meta: parentGroupMap.get(name) || null}))
      .filter((entry) => !!entry.meta);
    if (descriptors.length !== names.length) {
      return craftPredictorInvalidDraft("missing_parent_group", {requiredCount: normalizedRequiredCount, currentCount});
    }
    const firstMeta = descriptors[0].meta;
    const consistent = descriptors.every((entry) => {
      const meta = entry.meta;
      return meta
        && meta.collection === firstMeta.collection
        && meta.rarity === firstMeta.rarity
        && meta.stattrak === firstMeta.stattrak;
    });
    if (!consistent) {
      return craftPredictorInvalidDraft("ambiguous_material_group", {requiredCount: normalizedRequiredCount, currentCount});
    }
    if (!firstMeta.collection) {
      return craftPredictorInvalidDraft("missing_parent_group", {requiredCount: normalizedRequiredCount, currentCount});
    }
    if (!firstMeta.rarity) {
      return craftPredictorInvalidDraft("invalid_input_rarity", {requiredCount: normalizedRequiredCount, currentCount});
    }
    if (inputRarity && inputRarity !== firstMeta.rarity) {
      return craftPredictorInvalidDraft("mixed_rarity", {requiredCount: normalizedRequiredCount, currentCount});
    }
    if (stattrak != null && stattrak !== firstMeta.stattrak) {
      return craftPredictorInvalidDraft("mixed_stattrak", {requiredCount: normalizedRequiredCount, currentCount});
    }
    inputRarity = firstMeta.rarity;
    stattrak = firstMeta.stattrak;
    currentCount += count;
    collectionCountMap.set(firstMeta.collection, (collectionCountMap.get(firstMeta.collection) || 0) + count);
  }
  if (!collectionCountMap.size) {
    return craftPredictorInvalidDraft("no_materials", {requiredCount: normalizedRequiredCount, currentCount: 0});
  }
  if (currentCount > normalizedRequiredCount) {
    return craftPredictorInvalidDraft("invalid_group_count", {
      requiredCount: normalizedRequiredCount,
      currentCount
    });
  }
  const payloadGroups = Array.from(collectionCountMap.entries(), ([collection, count]) => {
    const group = new Object();
    group.collection = collection;
    group.count = count;
    return group;
  });
  return {
    ok: true,
    requiredCount: normalizedRequiredCount,
    currentCount,
    payload: {
      required_count: normalizedRequiredCount,
      target_relative_wear: normalizedTargetWear,
      wear_approach_mode: resolveCraftPredictorApproachMode(),
      input_rarity: inputRarity,
      stattrak: !!stattrak,
      groups: payloadGroups
    }
  };
}
function buildCraftPredictorRequestFromRecipeEntry(entry, rowsById) {
  const shared = globalThis && globalThis.craftAssistItemWearShared;
  const requiredCount = shared && typeof shared.resolveCraftAssistRequiredCount === "function"
    ? shared.resolveCraftAssistRequiredCount()
    : 10;
  const ids = normalizeCraftRecipeItemIds(entry && entry.item_ids);
  const rowMap = rowsById instanceof Map ? rowsById : new Map();
  if (!ids.length) {
    return craftPredictorInvalidDraft("no_recipe_materials", {requiredCount, currentCount: 0});
  }
  const rows = [];
  for (const id of ids) {
    const row = rowMap.get(id);
    if (!row) {
      return craftPredictorInvalidDraft("missing_recipe_items", {requiredCount, currentCount: rows.length});
    }
    rows.push(row);
  }
  const targetWear = normalizeCraftPredictorTargetWear(averageRelativeWearValue(rows));
  if (targetWear == null) {
    return craftPredictorInvalidDraft("missing_recipe_wear", {requiredCount, currentCount: rows.length});
  }
  const first = rows[0] || null;
  const inputRarity = normalizeCraftPredictorRarityLabel(first ? rarityName(first) : "");
  if (!inputRarity) {
    return craftPredictorInvalidDraft("invalid_input_rarity", {requiredCount, currentCount: rows.length});
  }
  const stattrak = first ? isRowStatTrak(first) : false;
  const groups = new Map();
  for (const row of rows) {
    const rarity = normalizeCraftPredictorRarityLabel(rarityName(row));
    if (rarity !== inputRarity) {
      return craftPredictorInvalidDraft("mixed_rarity", {requiredCount, currentCount: rows.length});
    }
    if (!!isRowStatTrak(row) !== !!stattrak) {
      return craftPredictorInvalidDraft("mixed_stattrak", {requiredCount, currentCount: rows.length});
    }
    const collection = collectionName(row);
    if (!collection) {
      return craftPredictorInvalidDraft("missing_recipe_collection", {requiredCount, currentCount: rows.length});
    }
    groups.set(collection, (groups.get(collection) || 0) + 1);
  }
  const payloadGroups = Array.from(groups.entries(), ([collection, count]) => ({collection, count}));
  return {
    ok: true,
    requiredCount,
    currentCount: rows.length,
    payload: {
      required_count: requiredCount,
      target_relative_wear: targetWear,
      wear_approach_mode: resolveCraftPredictorApproachMode(),
      input_rarity: inputRarity,
      stattrak: !!stattrak,
      groups: payloadGroups
    }
  };
}
function buildCraftPredictorStatusMessage(reason, {message = "", requiredCount = 0, currentCount = 0} = {}) {
  const serverMessage = String(message || "").trim();
  if (serverMessage) return serverMessage;
  if (reason === "missing_target_wear") return "请先输入目标相对磨损";
  if (reason === "no_materials") return "请先在辅助选材中添加父类材料";
  if (reason === "no_recipe_materials") return "请先在当前配方中加入材料";
  if (reason === "missing_recipe_items") return "当前配方部分材料未同步，请刷新后再试";
  if (reason === "missing_recipe_wear") return "当前配方无法计算相对磨损，暂时不能预测";
  if (reason === "missing_recipe_collection") return "当前配方存在缺少收藏品信息的材料，暂时不能预测";
  if (reason === "missing_parent_group") return "当前材料不在可选父类列表中，请重新选择";
  if (reason === "ambiguous_material_group") return "同一材料项跨武器箱或 StatTrak 池，暂时无法预测";
  if (reason === "mixed_rarity") return "当前材料存在不同稀有度，配方无效";
  if (reason === "mixed_stattrak") return "普通与 StatTrak 材料不能混合预测";
  if (reason === "invalid_group_count") return `当前材料数量 ${currentCount}/${requiredCount}，请调整后再预测`;
  if (reason === "invalid_required_count") return "当前配方规则无效";
  if (reason === "invalid_input_rarity") return "无法识别当前材料稀有度";
  if (reason === "no_higher_rarity_outcomes") return "当前稀有度已经没有更高阶产物";
  if (reason === "collection_outcomes_missing") return "存在武器箱在下一稀有度下没有产物";
  return "暂时无法预测当前配置";
}
function buildCraftPredictorOutcomeGroups(response) {
  const groups = new Map();
  for (const outcome of Array.isArray(response && response.outcomes) ? response.outcomes : []) {
    const groupKey = String(outcome && (outcome.collection_display || outcome.collection_key) || "").trim() || "未分组";
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {key: groupKey, title: groupKey, outcomes: []});
    }
    groups.get(groupKey).outcomes.push(outcome);
  }
  return [...groups.values()];
}
function formatCraftPredictorProbability(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  const percent = numeric * 100;
  return `${percent.toFixed(percent >= 1 ? 2 : 3).replace(/\.?0+$/, "")}%`;
}
function formatCraftPredictorFloat(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  if (typeof wearTextFull === "function") return wearTextFull(numeric);
  return String(numeric);
}
function formatCraftPredictorWearLevel(value) {
  const raw = String(value || "").trim();
  const labels = {
    "Factory New": "崭新出厂",
    "Minimal Wear": "略有磨损",
    "Field-Tested": "久经沙场",
    "Well-Worn": "破损不堪",
    "Battle-Scarred": "战痕累累"
  };
  return labels[raw] || raw;
}
function craftPredictorWearToneKey(value) {
  const token = normalizeWearToken(value);
  if (token === "崭新出厂" || token === "崭新" || token === "factorynew") return "fn";
  if (token === "略有磨损" || token === "略磨" || token === "minimalwear") return "mw";
  if (token === "久经沙场" || token === "久经" || token === "fieldtested") return "ft";
  if (token === "破损不堪" || token === "破损" || token === "wellworn") return "ww";
  if (token === "战痕累累" || token === "战痕" || token === "battlescarred") return "bs";
  return "unknown";
}
function craftPredictorGridColumnCount(count) {
  const normalizedCount = Math.max(0, Number(count) || 0);
  if (normalizedCount >= 7) return 4;
  if (normalizedCount >= 5) return 3;
  if (normalizedCount === 4) return 4;
  if (normalizedCount === 3) return 3;
  if (normalizedCount === 2) return 2;
  return 1;
}
function formatCraftPredictorTargetWear(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  if (typeof wearTextFull === "function") return wearTextFull(numeric);
  return String(numeric);
}
function formatCraftPredictorWearMarkerPosition(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "50%";
  const clamped = Math.max(0, Math.min(1, numeric));
  return `${(clamped * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}
function formatCraftPredictorOutcomeName(outcome) {
  const baseName = String(outcome && outcome.base_name || "").trim();
  const displayName = String(outcome && outcome.name || "").trim();
  return baseName || displayName || "未命名产物";
}
function fitCraftPredictorOutcomeName(node, {maxFontSize = 13, minFontSize = 10, step = 0.5} = {}) {
  if (!node || typeof node !== "object" || !node.style) return;
  const max = Number(maxFontSize);
  const min = Number(minFontSize);
  const shrinkStep = Number(step);
  if (!Number.isFinite(max) || !Number.isFinite(min) || !Number.isFinite(shrinkStep) || max <= 0 || min <= 0 || shrinkStep <= 0) return;
  const fits = () => {
    const clientWidth = Number(node.clientWidth || node.offsetWidth || 0);
    const scrollWidth = Number(node.scrollWidth || 0);
    if (!Number.isFinite(clientWidth) || clientWidth <= 0) return true;
    if (!Number.isFinite(scrollWidth) || scrollWidth <= 0) return true;
    return scrollWidth <= clientWidth + 1;
  };
  node.style.fontSize = `${max}px`;
  if (fits()) return;
  for (let size = max - shrinkStep; size >= min; size -= shrinkStep) {
    node.style.fontSize = `${size}px`;
    if (fits()) return;
  }
  node.style.fontSize = `${min}px`;
}
function fitCraftPredictorOutcomeNames(root = null) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  const names = root.querySelectorAll(".craft-predictor-outcome-name");
  for (const node of names) fitCraftPredictorOutcomeName(node);
}
function getCraftPredictorResolvedContext() {
  const contextType = normalizeCraftPredictorContextType(state.craftPredictorContextType);
  const contextId = normalizeCraftPredictorContextId(state.craftPredictorContextId);
  if (contextType === "recipe") {
    const entry = contextId ? findCraftRecipeById(contextId) : null;
    if (entry && String(entry.status || "").trim() !== "done") {
      return {
        key: buildCraftPredictorContextKey("recipe", contextId),
        type: "recipe",
        id: contextId,
        label: String(state.craftPredictorContextLabel || "").trim() || "已选配方",
        entry
      };
    }
  }
  if (contextType === "draft") {
    const draftId = contextId || String(state.craftActiveRecipeId || "").trim();
    const entry = draftId ? findCraftRecipeById(draftId) : null;
    if (entry && String(entry.status || "").trim() !== "done") {
      return {
        key: buildCraftPredictorContextKey("draft", draftId),
        type: "draft",
        id: draftId,
        label: String(state.craftPredictorContextLabel || "").trim() || "当前配置",
        entry
      };
    }
  }
  const activeId = String(state.craftActiveRecipeId || "").trim();
  const activeEntry = activeId ? findCraftRecipeById(activeId) : null;
  if (activeEntry && String(activeEntry.status || "").trim() !== "done") {
    return {
      key: buildCraftPredictorContextKey("draft", activeId),
      type: "draft",
      id: activeId,
      label: "当前配置",
      entry: activeEntry
    };
  }
  return null;
}
async function refreshCraftPredictorPreview({force = false, preferredRowsById = null} = {}) {
  const context = getCraftPredictorResolvedContext();
  if (!context) {
    if (typeof clearCraftPredictorPreviewState === "function") clearCraftPredictorPreviewState();
    if (typeof renderCraftPredictorPanel === "function") renderCraftPredictorPanel();
    return;
  }
  if (isGuestWorkspaceActive()) {
    state.craftPredictorLoading = false;
    state.craftPredictorRequestKey = "";
    state.craftPredictorLoadedKey = "";
    if (typeof renderCraftPredictorPanel === "function") renderCraftPredictorPanel();
    return;
  }
  if (context.type === "draft" && preferredRowsById instanceof Map && preferredRowsById.size > 0) {
    setCraftPredictorPreferredRows(context.key, preferredRowsById);
  }
  const rowsById = getCraftPredictorRowsById({contextKey: context.key, preferredRowsById});
  const draft = buildCraftPredictorRequestFromRecipeEntry(context.entry, rowsById);
  if (!draft.ok) {
    state.craftPredictorLoading = false;
    state.craftPredictorResponse = null;
    state.craftPredictorError = buildCraftPredictorStatusMessage(draft.reason, draft);
    state.craftPredictorRequestKey = "";
    state.craftPredictorLoadedKey = "";
    if (typeof renderCraftPredictorPanel === "function") renderCraftPredictorPanel();
    return;
  }
  const requestKey = JSON.stringify({context: context.key, payload: draft.payload});
  if (!force && state.craftPredictorLoadedKey === requestKey) return;
  if (!force && state.craftPredictorLoading && state.craftPredictorRequestKey === requestKey) return;
  if (typeof api !== "function") {
    state.craftPredictorLoading = false;
    state.craftPredictorResponse = null;
    state.craftPredictorError = "预测接口不可用";
    if (typeof renderCraftPredictorPanel === "function") renderCraftPredictorPanel();
    return;
  }
  state.craftPredictorLoading = true;
  state.craftPredictorError = "";
  state.craftPredictorRequestKey = requestKey;
  state.craftPredictorRequestSeq = Math.max(0, Number(state.craftPredictorRequestSeq || 0) || 0) + 1;
  const requestSeq = state.craftPredictorRequestSeq;
  if (typeof renderCraftPredictorPanel === "function") renderCraftPredictorPanel();
  try {
    const data = await api("/api/craft/predict-outcomes", {
      method: "POST",
      body: JSON.stringify(draft.payload)
    });
    if (requestSeq !== state.craftPredictorRequestSeq || state.craftPredictorRequestKey !== requestKey) return;
    state.craftPredictorLoading = false;
    state.craftPredictorResponse = data;
    state.craftPredictorError = "";
    state.craftPredictorLoadedKey = requestKey;
  } catch (err) {
    if (requestSeq !== state.craftPredictorRequestSeq || state.craftPredictorRequestKey !== requestKey) return;
    const response = err && err.data && typeof err.data === "object" ? err.data : null;
    const invalidReason = String(response && response.invalid_reason || "").trim();
    state.craftPredictorLoading = false;
    state.craftPredictorResponse = response;
    state.craftPredictorError = buildCraftPredictorStatusMessage(invalidReason, {
      message: response && response.message,
      requiredCount: response && response.required_count,
      currentCount: response && response.current_count
    });
    state.craftPredictorLoadedKey = requestKey;
  }
  if (typeof renderCraftPredictorPanel === "function") renderCraftPredictorPanel();
}
function renderCraftPredictorPanel() {
  if (typeof ui === "undefined" || !ui) return;
  if (!ui.craftPredictorPanel || !ui.craftPredictorHandle || !ui.craftPredictorList) return;
  const context = getCraftPredictorResolvedContext();
  const selectedLabel = context ? context.label : "未选择配方";
  const open = !!state.craftPredictorOpen;
  ui.craftPredictorPanel.classList.toggle("collapsed", !open);
  const stage = ui.craftPredictorPanel.closest(".craft-predictor-stage");
  if (stage) stage.classList.toggle("collapsed", !open);
  ui.craftPredictorHandle.setAttribute("aria-expanded", open ? "true" : "false");
  ui.craftPredictorHandle.setAttribute("aria-label", open ? "收起产物预测抽屉" : "展开产物预测抽屉");
  if (typeof updateCraftPredictorHandleGeometry === "function") updateCraftPredictorHandleGeometry();
  if (ui.craftPredictorTitle) ui.craftPredictorTitle.textContent = "模拟结果";
  const response = state.craftPredictorResponse && typeof state.craftPredictorResponse === "object"
    ? state.craftPredictorResponse
    : null;
  const rowsById = buildRowsByAssetId(getAllInventoryCraftableRows({rows: state.rows, includeComponentItems: true}));
  const fallbackDraft = context ? buildCraftPredictorRequestFromRecipeEntry(context.entry, rowsById) : null;
  const currentCount = Math.max(0, Number(response && response.current_count != null ? response.current_count : fallbackDraft && fallbackDraft.currentCount) || 0);
  const requiredCount = Math.max(0, Number(response && response.required_count != null ? response.required_count : fallbackDraft && fallbackDraft.requiredCount) || 0);
  const targetWear = response && response.target_relative_wear != null
    ? response.target_relative_wear
    : (fallbackDraft && fallbackDraft.payload ? fallbackDraft.payload.target_relative_wear : null);
  const inputRarity = normalizeCraftPredictorRarityLabel(
    response && response.input_rarity != null
      ? response.input_rarity
      : (fallbackDraft && fallbackDraft.payload ? fallbackDraft.payload.input_rarity : "")
  );
  const outputRarity = normalizeCraftPredictorRarityLabel(response && response.output_rarity);
  const subtitleParts = [];
  if (context) subtitleParts.push(selectedLabel);
  const targetWearText = formatCraftPredictorTargetWear(targetWear);
  if (targetWearText) subtitleParts.push(`平均相对磨损 ${targetWearText}`);
  if (requiredCount) subtitleParts.push(`${currentCount}/${requiredCount || 10}件`);
  if (inputRarity && outputRarity) subtitleParts.push(`${inputRarity} → ${outputRarity}`);
  if (ui.craftPredictorSubtitle) {
    ui.craftPredictorSubtitle.textContent = subtitleParts.length ? subtitleParts.join(" | ") : "等待选择配方";
  }

  let panelMessage = "选择配方后即可在此查看预测结果";
  let hasError = false;
  if (!context) {
    panelMessage = "选择配方后即可在此查看预测结果";
  } else if (state.craftPredictorLoading) {
    panelMessage = "正在根据当前配方预测产物与磨损...";
  } else if (state.craftPredictorError) {
    panelMessage = state.craftPredictorError;
    hasError = true;
  } else if (fallbackDraft && !fallbackDraft.ok) {
    panelMessage = buildCraftPredictorStatusMessage(fallbackDraft.reason, fallbackDraft);
    hasError = true;
  } else if (context) {
    panelMessage = "当前配方还没有可展示的预测结果";
  }
  ui.craftPredictorList.replaceChildren();

  const groups = response && response.ok ? buildCraftPredictorOutcomeGroups(response) : [];
  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = hasError ? "craft-predictor-empty error" : "craft-predictor-empty";
    empty.textContent = panelMessage;
    ui.craftPredictorList.append(empty);
    return;
  }
  groups.forEach((group, index) => {
    const section = document.createElement("section");
    section.className = "craft-predictor-group";
    section.id = `craftPredictorGroup_${index}`;
    const head = document.createElement("div");
    head.className = "craft-predictor-group-head";
    const title = document.createElement("div");
    title.className = "craft-predictor-group-title";
    title.textContent = `${group.title}(${group.outcomes.length})`;
    const arrow = document.createElement("div");
    arrow.className = "craft-predictor-group-arrow";
    arrow.textContent = "›";
    head.append(title, arrow);
    const grid = document.createElement("div");
    grid.className = "craft-predictor-group-grid";
    grid.dataset.columns = String(craftPredictorGridColumnCount(group.outcomes.length));
    group.outcomes.forEach((outcome) => {
      const card = document.createElement("div");
      card.className = "craft-predictor-outcome-card";
      const art = document.createElement("div");
      art.className = "craft-predictor-outcome-art";
      const artUrl = preferredRowSkinImageUrl(outcome);
      if (artUrl) {
        art.classList.add("has-image");
        art.style.setProperty("--craft-predictor-art-image", cssUrlValue(artUrl));
      } else {
        art.textContent = "暂无图";
      }
      const wearLevel = formatCraftPredictorWearLevel(outcome && outcome.predicted_wearlevel);
      if (wearLevel) {
        const wearChip = document.createElement("div");
        wearChip.className = "craft-predictor-outcome-wear";
        wearChip.classList.add(`tone-${craftPredictorWearToneKey(wearLevel)}`);
        wearChip.textContent = wearLevel;
        art.append(wearChip);
      }
      const probability = document.createElement("div");
      probability.className = "craft-predictor-outcome-probability";
      probability.textContent = formatCraftPredictorProbability(outcome && outcome.probability);
      art.append(probability);
      const floatValue = formatCraftPredictorFloat(outcome && outcome.predicted_float);
      const floatLine = document.createElement("div");
      floatLine.className = "craft-predictor-outcome-float";
      floatLine.textContent = floatValue ? `磨损: ${floatValue}` : "磨损: 待定";
      art.append(floatLine);
      const main = document.createElement("div");
      main.className = "craft-predictor-outcome-content";
      const wearBar = document.createElement("div");
      wearBar.className = "craft-predictor-outcome-bar";
      wearBar.style.setProperty(
        "--craft-predictor-wear-pos",
        formatCraftPredictorWearMarkerPosition(outcome && outcome.predicted_float)
      );
      const name = document.createElement("div");
      name.className = "craft-predictor-outcome-name";
      name.textContent = formatCraftPredictorOutcomeName(outcome);
      main.append(wearBar, name);
      card.append(art, main);
      grid.append(card);
    });
    section.append(head, grid);
    ui.craftPredictorList.append(section);
  });
  fitCraftPredictorOutcomeNames(ui.craftPredictorList);
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => fitCraftPredictorOutcomeNames(ui.craftPredictorList));
  }
}
function updateCraftPredictorHandleGeometry() {
  /* 面板已提升为 fixed 全局浮动，handle 定位由 CSS 控制，无需动态计算 */
}
function getCraftLeftPanelBusyState() {
  if (state.componentOpBusy) {
    const action = String(state.componentOpBusyAction || "").trim();
    const withdraw = action !== "deposit";
    return {
      show: true,
      title: withdraw ? "正在从组件取出物品" : "正在向组件存入物品",
      detail: withdraw ? "正在从组件取出物品，请稍候..." : "正在向组件存入物品，请稍候..."
    };
  }
  if (
    state.craftProgressEnabled
    && state.craftProgressVisible
    && String(state.craftProgressMode || "").trim() === "component_prepare"
  ) {
    return {
      show: true,
      title: String(state.craftProgressTitle || "").trim() || "正在从组件中取出物品",
      detail: String(state.craftProgressDetail || "").trim() || "请稍候..."
    };
  }
  const runtimeState = syncCurrentCraftAssistRuntimeState();
  const action = String(runtimeState.craftAssistPendingUiAction || "").trim();
  const presetId = String(runtimeState.craftAssistPendingPresetId || "").trim();
  const hasActiveAction = action === "panel_apply" || (action === "preset_apply" && !!presetId);
  if (!state.craftAssistOpen || !runtimeState.craftAssistSelecting || !hasActiveAction) {
    return {show: false, title: "", detail: ""};
  }
  let accountLabel = String(state.currentAccountUsername || "").trim() || "当前账号";
  if (typeof accountByUsername === "function" && typeof displayAccountName === "function") {
    const account = accountByUsername(state.currentAccountUsername);
    if (account) {
      accountLabel = displayAccountName(account);
    }
  }
  return {
    show: true,
    title: `正在为 ${accountLabel} 辅助选材`,
    detail: action === "preset_apply"
      ? "正在按已保存配置选材，请稍候..."
      : "正在按当前面板配置选材，请稍候..."
  };
}
function renderCraftAssistBusyMask() {
  if (!ui.craftAssistBusyMask || !ui.craftAssistBusyMaskTitle || !ui.craftAssistBusyMaskDetail) return;
  const busyState = getCraftLeftPanelBusyState();
  ui.craftAssistBusyMask.classList.toggle("hidden", !busyState.show);
  ui.craftAssistBusyMask.setAttribute("aria-hidden", busyState.show ? "false" : "true");
  ui.craftAssistBusyMaskTitle.textContent = busyState.title;
  ui.craftAssistBusyMaskDetail.textContent = busyState.detail;
}
function renderCraftAssistPanel() {
  if (!ui.craftAssistPanel || !ui.craftAssistOverlay) return;
  const open = !!state.craftAssistOpen;
  const editingPreset = isCraftAssistPresetEditing();
  if (typeof coalesceCraftAssistMaterialRoleBuckets === "function") {
    state.craftAssistMaterials = coalesceCraftAssistMaterialRoleBuckets(state.craftAssistMaterials, {source: "renormalize"});
  }
  ui.craftAssistOverlay.classList.toggle("hidden", !open);
  if (ui.craftAssistToggleBtn) {
    ui.craftAssistToggleBtn.classList.toggle("active", open);
    ui.craftAssistToggleBtn.setAttribute("aria-pressed", open ? "true" : "false");
  }
  if (!open) {
    if (typeof renderCraftAssistBusyMask === "function") renderCraftAssistBusyMask();
    syncCraftSelectionListClearance();
    if (typeof renderCraftPredictorPanel === "function") renderCraftPredictorPanel();
    if (typeof refreshCraftPredictorPreview === "function") void refreshCraftPredictorPreview();
    return;
  }

  if (ui.craftAssistPresetNameField) {
    ui.craftAssistPresetNameField.classList.toggle("hidden", !editingPreset);
  }
  if (ui.craftAssistPresetNameInput) {
    ui.craftAssistPresetNameInput.disabled = !editingPreset || state.refreshing || state.craftBusy;
    if (!editingPreset) {
      if (document.activeElement !== ui.craftAssistPresetNameInput) {
        ui.craftAssistPresetNameInput.value = "";
      }
    } else if (document.activeElement !== ui.craftAssistPresetNameInput) {
      ui.craftAssistPresetNameInput.value = String(state.craftAssistPresetEditingName || "").trim();
    }
  }
  if (ui.craftAssistTargetWear) {
    ui.craftAssistTargetWear.placeholder = wearTextFull(0);
  }
  if (ui.craftAssistTargetWear && document.activeElement !== ui.craftAssistTargetWear) {
    const targetWearPair = resolveCraftAssistTargetWearPair(state.craftAssistTargetWear, state.craftAssistTargetWearRaw);
    ui.craftAssistTargetWear.value = targetWearPair ? targetWearPair.target_wear_raw : wearTextFull(0);
    if (!targetWearPair) ui.craftAssistTargetWear.dataset.displayDefault = "1";
    else delete ui.craftAssistTargetWear.dataset.displayDefault;
  }
  const filterMode = getCraftAssistFilterMode();
  if (ui.craftAssistFilterModeRelative) {
    ui.craftAssistFilterModeRelative.checked = filterMode === "relative";
  }
  if (ui.craftAssistFilterModeAbsolute) {
    ui.craftAssistFilterModeAbsolute.checked = filterMode === "absolute";
  }
  if (ui.craftAssistMainCount && document.activeElement !== ui.craftAssistMainCount) {
    ui.craftAssistMainCount.value = String(normalizeCraftAssistCount(state.craftAssistMainCount, 5));
  }
  if (ui.craftAssistAuxCount && document.activeElement !== ui.craftAssistAuxCount) {
    ui.craftAssistAuxCount.value = String(normalizeCraftAssistCount(state.craftAssistAuxCount, 5));
  }
  if (ui.craftAssistApplyBtn) {
    ui.craftAssistApplyBtn.textContent = editingPreset ? "取消" : "按配置选材";
    ui.craftAssistApplyBtn.disabled = state.refreshing || state.craftBusy || isCraftAssistPendingUiAction("panel_apply");
  }
  if (ui.craftAssistPresetSaveBtn) {
    ui.craftAssistPresetSaveBtn.textContent = editingPreset ? "保存修改" : "保存当前";
    ui.craftAssistPresetSaveBtn.title = editingPreset
      ? `保存对配置【${String(state.craftAssistPresetEditingName || "").trim() || "-"}】的修改`
      : "";
  }
  if (ui.craftAssistSelectBox) {
    const count = Array.isArray(state.craftAssistMaterials) ? state.craftAssistMaterials.length : 0;
    const text = count > 0 ? `悬停继续添加父类材料（已选 ${count}）` : "尚未选择父类材料";
    if (ui.craftAssistSelectText) ui.craftAssistSelectText.textContent = text;
    else ui.craftAssistSelectBox.textContent = text;
    ui.craftAssistSelectBox.setAttribute("aria-label", text);
    ui.craftAssistSelectBox.classList.toggle("split", !!state.craftAssistRoleChooserOpen);
  }
  if (ui.craftAssistRoleSplit) {
    ui.craftAssistRoleSplit.classList.toggle("hidden", !state.craftAssistRoleChooserOpen);
  }
  renderCraftAssistPicker();
  renderCraftAssistList();
  renderCraftAssistPresetPanel();
  if (typeof renderCraftAssistBusyMask === "function") renderCraftAssistBusyMask();
  if (typeof renderCraftPredictorPanel === "function") renderCraftPredictorPanel();
  if (typeof refreshCraftPredictorPreview === "function") void refreshCraftPredictorPreview();
}
function isCraftQueueDeleteModeVisible() {
  return !isCraftRecipeEditLocked();
}
async function requestCraftTradeUpPause() {
  if (!state.craftBusy || state.craftPauseRequested) return;
  state.craftPauseRequested = true;
  setCraftStatus("已请求暂停，当前提交完成后将停止后续配方");
  if (state.craftProgressEnabled) {
    const overlaySnapshot = {
      visible: !!state.craftProgressVisible,
      mode: String(state.craftProgressMode || "").trim(),
      percent: normalizeCraftExecutionOverlayPercent(state.craftProgressPercentTarget),
      title: state.craftProgressTitle || "正在执行炼金任务",
      detail: state.craftProgressDetail || "请稍候..."
    };
    setCraftExecutionOverlayState({
      owner: "craft_flow",
      visible: true,
      mode: overlaySnapshot.mode,
      title: overlaySnapshot.title,
      detail: "暂停请求已记录，当前配方完成后停止"
    });
    const username = String(state.currentAccountUsername || "").trim();
    if (username) {
      try {
        await api("/api/craft/pause", {
          method: "POST",
          body: JSON.stringify({username})
        });
      } catch (err) {
        state.craftPauseRequested = false;
        setCraftExecutionOverlayState({
          owner: "craft_flow",
          visible: overlaySnapshot.visible,
          mode: overlaySnapshot.mode,
          percent: overlaySnapshot.percent,
          title: overlaySnapshot.title,
          detail: overlaySnapshot.detail
        });
        setCraftStatus(`暂停请求发送失败：${err.message}`, true);
      }
    }
  }
  renderCraftPage();
}
function renderCraftQueue() {
  if (!ui.craftQueueList) return;
  const prevScrollTop = Math.max(0, Number(ui.craftQueueList.scrollTop || 0) || 0);
  ui.craftQueueList.replaceChildren();
  const list = Array.isArray(state.craftRecipeQueue) ? state.craftRecipeQueue : [];
  ui.craftQueueList.classList.toggle("has-items", !!list.length);
  const rowsById = buildRowsByAssetId(state.rows);
  const recipeEditLocked = isCraftRecipeEditLocked();
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "craft-queue-empty";
    const emptyIcon = document.createElement("div");
    emptyIcon.className = "craft-queue-empty-icon";
    emptyIcon.textContent = "◇";
    const emptyBody = document.createElement("div");
    emptyBody.className = "craft-queue-empty-body";
    const line1 = document.createElement("div");
    line1.append("点击上方", document.createElement("strong"), "创建配方");
    line1.querySelector("strong").textContent = "加号";
    const line2 = document.createElement("div");
    line2.append("或点击", document.createElement("strong"), "进行快捷选材");
    line2.querySelector("strong").textContent = "闪电图标";
    emptyBody.append(line1, line2);
    empty.append(emptyIcon, emptyBody);
    ui.craftQueueList.append(empty);
    ui.craftQueueList.scrollTop = 0;
    return;
  }

  let pendingIndex = 0;
  const showDeleteAction = isCraftQueueDeleteModeVisible();
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    const done = String(entry && entry.status || "").trim() === "done";
    const itemIds = normalizeCraftRecipeItemIds(entry && entry.item_ids);
    if (!done) {
      pendingIndex += 1;
      const entryId = String(entry && entry.id || "").trim();
      ensureCraftRecipeEntryMetadata(entry);
      const recipeRows = itemIds.map((id) => rowsById.get(id)).filter(Boolean);
      const title = buildPendingCraftQueueTitle({pendingIndex, recipeRows});
      const isActive = entryId && entryId === String(state.craftActiveRecipeId || "").trim();
      const componentItemCount = itemIds.reduce((count, id) => {
        const source = entry.item_sources && typeof entry.item_sources === "object" ? entry.item_sources[id] : null;
        if (source && String(source.source_scope || "").trim() === "component") return count + 1;
        const row = rowsById.get(id);
        return String(row && row.casket_id || "").trim() ? count + 1 : count;
      }, 0);
      const metaItems = [];
      if (componentItemCount > 0 && String(entry.status || "").trim() !== "prepare_failed") {
        metaItems.push({text: `组件取料：${componentItemCount}件待准备`, tone: "info"});
      }
      if (Number(entry.removed_missing_count || 0) > 0) {
        metaItems.push({text: `重连校对：已移除${Math.max(0, Number(entry.removed_missing_count) || 0)}件失效物品`, tone: "warn"});
      }
      if (String(entry.status || "").trim() === "prepare_failed") {
        metaItems.push({text: entry.prepare_message || "组件取出失败，已跳过", tone: "error"});
      } else if (String(entry.prepare_status || "").trim() === "paused") {
        metaItems.push({text: entry.prepare_message || "已暂停，等待继续", tone: "warn"});
      }
      ui.craftQueueList.append(
        renderCraftQueueSlots({
          title,
          itemIds,
          rowsById,
          metaItems,
          active: isActive,
          selectable: true,
          extraClass: String(entry.status || "").trim() === "prepare_failed" ? "prepare-failed" : "",
          onActivate: () => {
            const currentActiveId = String(state.craftActiveRecipeId || "").trim();
            if (!entryId) return;
            if (currentActiveId !== entryId) {
              setActiveCraftRecipe(entryId);
            }
            if (typeof selectCraftPredictorContext === "function") {
              selectCraftPredictorContext({type: "recipe", id: entryId, label: title});
            }
            clearCraftStatus();
            renderCraftPage();
          },
          showDeleteAction,
          removeDisabled: recipeEditLocked,
          onRemoveItem: (assetId) => {
            if (recipeEditLocked) return;
            entry.item_ids = normalizeCraftRecipeItemIds(entry.item_ids).filter((id) => id !== String(assetId || "").trim());
            syncCraftRecipeEntryItemSources(entry, rowsById);
            resetCraftRecipeEntryPreparation(entry);
            if (isActive) {
              syncCraftSelectedIdsFromActiveRecipe();
              if (typeof focusCraftPredictorOnActiveDraft === "function") {
                focusCraftPredictorOnActiveDraft({autoOpen: true, preferredRowsById: rowsById});
              }
            }
            clearCraftStatus();
            renderCraftPage();
          },
          onRemove: () => {
            state.craftRecipeQueue = state.craftRecipeQueue.filter((x) => x.id !== entry.id);
            if (isActive) state.craftActiveRecipeId = "";
            ensureActiveCraftRecipe({createIfMissing: false});
            syncCraftSelectedIdsFromActiveRecipe();
            clearCraftStatus();
            renderCraftPage();
          }
        })
      );
      continue;
    }

    const doneRow = document.createElement("div");
    doneRow.className = `craft-queue-item done${showDeleteAction ? " deletable" : ""}`;
    const gainedIds = normalizeCraftRecipeItemIds(entry && entry.gained_ids);
    const gainedRows = gainedIds.map((id) => rowsById.get(id)).filter(Boolean);
    if (gainedRows.length) {
      const cardGrid = document.createElement("div");
      cardGrid.className = "craft-queue-result-card-grid";
      for (const row of gainedRows) {
        cardGrid.append(makeCraftQueueResultCardNode(row));
      }
      doneRow.append(cardGrid);
    } else {
      const resultWrap = document.createElement("div");
      resultWrap.className = "craft-queue-result";
      const resultTitle = document.createElement("div");
      resultTitle.className = "craft-queue-result-title";
      resultTitle.textContent = "产物：待确认";
      resultWrap.append(resultTitle);
      doneRow.append(resultWrap);
    }
    if (showDeleteAction) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "craft-queue-card-delete craft-queue-card-delete-floating";
      removeBtn.title = "删除该配方";
      removeBtn.setAttribute("aria-label", "删除该配方");
      removeBtn.textContent = "−";
      removeBtn.onclick = () => {
        state.craftRecipeQueue = state.craftRecipeQueue.filter((x) => x.id !== entry.id);
        clearCraftStatus();
        renderCraftPage();
      };
      doneRow.append(removeBtn);
    }
    ui.craftQueueList.append(doneRow);
  }
  const maxScrollTop = Math.max(0, ui.craftQueueList.scrollHeight - ui.craftQueueList.clientHeight);
  ui.craftQueueList.scrollTop = Math.min(prevScrollTop, maxScrollTop);
}
function addCurrentSelectionToCraftQueue() {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可编辑真实炼金配方。",
    view: "login"
  }) === false) {
    return;
  }
  if (isCraftRecipeEditLocked()) return;
  if (getCraftQueuePendingCount() >= 50) {
    setCraftStatus("配方预览最多 50 组配方", true);
    return;
  }
  const created = createEmptyCraftRecipeEntry({activate: true});
  if (typeof selectCraftPredictorContext === "function") {
    selectCraftPredictorContext({type: "draft", id: String(created && created.id || "").trim(), label: "当前配置"});
  }
  syncCraftSelectedIdsFromActiveRecipe();
  clearCraftStatus();
  const pending = getCraftQueuePendingEntries();
  const idx = pending.findIndex((x) => String(x && x.id || "").trim() === String(created && created.id || "").trim());
  setCraftStatus(`已新增配方#${Math.max(0, idx) + 1}，点击左侧物品可填充该配方槽位`);
  renderCraftPage();
}
function clearCraftQueue() {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可编辑真实炼金配方。",
    view: "login"
  }) === false) {
    return;
  }
  if (!state.craftRecipeQueue.length) return;
  if (isCraftRecipeEditLocked()) return;
  state.craftRecipeQueue = [];
  state.craftActiveRecipeId = "";
  state.craftPauseRequested = false;
  state.craftPaused = false;
  state.craftSelectedItemIds.clear();
  clearCraftStatus();
  setCraftStatus("已清空配方预览");
  renderCraftPage();
}
function getActiveTradeupSimulationPreset() {
  const draft = state.simulationWorkspacePreset && typeof state.simulationWorkspacePreset === "object"
    ? state.simulationWorkspacePreset
    : null;
  if (draft) return draft;
  const activeId = String(state.simulationActivePresetId || "").trim();
  const list = Array.isArray(state.simulationPresets) ? state.simulationPresets : [];
  if (!list.length) return null;
  return list.find((entry) => String(entry && entry.id || "").trim() === activeId) || list[0] || null;
}
function formatTradeupSimulationWear(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return numeric.toFixed(TRADEUP_SIMULATION_WEAR_DECIMALS);
}
function formatTradeupSimulationModalWear(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return numeric.toFixed(TRADEUP_SIMULATION_MODAL_WEAR_DECIMALS);
}
function summarizeTradeupSimulationWearLabel(label) {
  const value = String(label || "").trim();
  if (value === "Factory New") return "崭新出厂";
  if (value === "Minimal Wear") return "略有磨损";
  if (value === "Field-Tested") return "久经沙场";
  if (value === "Well-Worn") return "破损不堪";
  if (value === "Battle-Scarred") return "战痕累累";
  return value || "-";
}
function findTradeupSimulationOutputByKey(preset, itemKey) {
  const key = String(itemKey || "").trim();
  if (!key) return null;
  for (const row of Array.isArray(preset && preset.output_rows) ? preset.output_rows : []) {
    const outputs = Array.isArray(row && row.outputs) ? row.outputs : [];
    const match = outputs.find((entry) => String(entry && entry.basemarkethashname || "").trim() === key);
    if (match) return match;
  }
  const candidate = (Array.isArray(preset && preset.output_candidates) ? preset.output_candidates : [])
    .find((entry) => String(entry && (entry.basemarkethashname || entry.base_name || entry.markethashname) || "").trim() === key);
  if (candidate) return candidate;
  return null;
}
function findTradeupSimulationCandidateByKey(candidates, item) {
  const key = String(item && (item.basemarkethashname || item.basename || item.markethashname) || "").trim();
  if (!key) return null;
  const list = Array.isArray(candidates) ? candidates : [];
  return list.find((entry) => String(entry && (entry.basemarkethashname || entry.basename || entry.markethashname) || "").trim() === key) || null;
}
function pickTradeupSimulationCandidateForCollection(candidates, collection = "") {
  const list = (Array.isArray(candidates) ? candidates : [])
    .map((entry) => sanitizeTradeupSimulationTargetItem(entry))
    .filter(Boolean);
  if (!list.length) return null;
  const collectionKey = String(collection || "").trim();
  const scoped = collectionKey
    ? list.filter((entry) => String(entry && entry.collection || "").trim() === collectionKey)
    : list;
  const pool = scoped.length ? scoped : list;
  const pickIndex = Math.max(0, Math.min(pool.length - 1, Math.floor(Number(Math.random()) * pool.length)));
  return pool[pickIndex] || pool[0] || null;
}
function getTradeupSimulationActiveAnchorItem(preset) {
  return sanitizeTradeupSimulationTargetItem(preset && preset.active_anchor_item)
    || sanitizeTradeupSimulationTargetItem(preset && preset.cover_output)
    || sanitizeTradeupSimulationTargetItem(preset && preset.primary_output);
}
function getTradeupSimulationAnchorBounds(preset) {
  const anchor = getTradeupSimulationActiveAnchorItem(preset);
  const rowItem = findTradeupSimulationOutputByKey(preset, anchor && anchor.basemarkethashname);
  if (rowItem) return rowItem;
  if (anchor) return anchor;
  if (preset && preset.cover_output) return preset.cover_output;
  return null;
}
function getTradeupSimulationSelectedMaterialCollections(preset) {
  const current = [preset && preset.main_material, preset && preset.aux_material]
    .map((entry) => String(entry && entry.collection || "").trim())
    .filter(Boolean);
  const derived = (Array.isArray(preset && preset.rows) ? preset.rows : [])
    .flatMap((row) => Array.isArray(row && row.materials) ? row.materials : [])
    .map((item) => String(item && item.collection || "").trim())
    .filter(Boolean);
  return Array.from(new Set(current.concat(derived))).slice(0, 12);
}
function inferTradeupSimulationWearLabelFromName(value) {
  const wearRules = [
    ["崭新出厂", "崭新", "factory new", "factorynew"],
    ["略有磨损", "略磨", "minimal wear", "minimalwear"],
    ["久经沙场", "久经", "field tested", "field-tested", "fieldtested"],
    ["破损不堪", "破损", "well worn", "well-worn", "wellworn"],
    ["战痕累累", "战痕", "battle scarred", "battle-scarred", "battlescarred"]
  ];
  const normalizeToken = (text) => String(text || "")
    .toLowerCase()
    .replace(/[\s_\-（）()]/g, "");
  const normalized = normalizeToken(value);
  if (!normalized) return "";
  for (const rule of wearRules) {
    if (rule.some((key) => normalized.includes(normalizeToken(key)))) {
      return String(rule && rule[0] || "").trim();
    }
  }
  return "";
}
function getTradeupSimulationItemWearLabel(item) {
  const normalized = summarizeTradeupSimulationWearLabel(item && item.wear_label);
  if (normalized && normalized !== "-") return normalized;
  return inferTradeupSimulationWearLabelFromName(
    item && (item.markethashname || item.name || item.basename || item.basemarkethashname)
  );
}
function getTradeupSimulationWearBadgeLabel(item) {
  const label = getTradeupSimulationItemWearLabel(item);
  return label || "-";
}
function getTradeupSimulationWearBadgeToneClass(value) {
  const label = value && typeof value === "object"
    ? getTradeupSimulationItemWearLabel(value)
    : (summarizeTradeupSimulationWearLabel(value) || String(value || "").trim());
  const normalized = String(label || "").trim().toLowerCase().replace(/[\s_\-]/g, "");
  if (!normalized) return "";
  if (normalized.includes("崭新出厂") || normalized.includes("崭新") || normalized.includes("factorynew")) return " tone-fn";
  if (normalized.includes("略有磨损") || normalized.includes("略磨") || normalized.includes("minimalwear")) return " tone-mw";
  if (normalized.includes("久经沙场") || normalized.includes("久经") || normalized.includes("fieldtested")) return " tone-ft";
  if (normalized.includes("破损不堪") || normalized.includes("破损") || normalized.includes("wellworn")) return " tone-ww";
  if (normalized.includes("战痕累累") || normalized.includes("战痕") || normalized.includes("battlescarred")) return " tone-bs";
  return "";
}
function buildTradeupSimulationSavedCardSummary(preset) {
  const target = sanitizeTradeupSimulationTargetItem(preset && preset.cover_output)
    || sanitizeTradeupSimulationTargetItem(preset && preset.primary_output);
  const anchor = getTradeupSimulationActiveAnchorItem(preset);
  const anchorAbsoluteWearValue = Number(preset && preset.active_anchor_abs_wear);
  const collections = getTradeupSimulationSelectedMaterialCollections(preset);
  const fallbackCollection = String(target && target.collection || anchor && anchor.collection || "").trim();
  return {
    presetName: String(preset && preset.name || "").trim() || getTradeupSimulationDefaultName({
      cover_output: target,
      primary_output: target
    }) || "未命名配置",
    targetName: String(target && (target.basename || target.basemarkethashname || target.markethashname) || "未选择主产物").trim(),
    wearLabel: getTradeupSimulationItemWearLabel(target),
    wearToneClass: getTradeupSimulationWearBadgeToneClass(target),
    anchorWear: Number.isFinite(anchorAbsoluteWearValue)
      ? formatTradeupSimulationWear(anchorAbsoluteWearValue)
      : "-",
    anchorAbsoluteWearValue: Number.isFinite(anchorAbsoluteWearValue) ? anchorAbsoluteWearValue : null,
    collectionText: (collections.length ? collections : [fallbackCollection])
      .filter(Boolean)
      .join(" / ") || "未指定收藏品"
  };
}
function getTradeupSimulationAnchorRelativeWear(preset) {
  const item = getTradeupSimulationAnchorBounds(preset);
  const absoluteWear = Number(preset && preset.active_anchor_abs_wear);
  const minWear = Number(item && item.minfloat);
  const maxWear = Number(item && item.maxfloat);
  if (!Number.isFinite(absoluteWear) || !Number.isFinite(minWear) || !Number.isFinite(maxWear) || maxWear <= minWear) return null;
  return Math.max(0, Math.min(1, (absoluteWear - minWear) / (maxWear - minWear)));
}
function inheritTradeupSimulationAbsoluteWear(preset, item, absoluteWear = null) {
  const explicitWear = absoluteWear === null || absoluteWear === undefined || absoluteWear === ""
    ? null
    : Number(absoluteWear);
  if (Number.isFinite(explicitWear)) return explicitWear;
  const nextItem = sanitizeTradeupSimulationTargetItem(item);
  const nextMinWear = Number(nextItem && nextItem.minfloat);
  const nextMaxWear = Number(nextItem && nextItem.maxfloat);
  const nextHasBounds = Number.isFinite(nextMinWear) && Number.isFinite(nextMaxWear) && nextMaxWear > nextMinWear;
  const currentRelativeWear = getTradeupSimulationAnchorRelativeWear(preset);
  if (nextHasBounds && Number.isFinite(currentRelativeWear)) {
    return Number((nextMinWear + (nextMaxWear - nextMinWear) * currentRelativeWear).toFixed(12));
  }
  const currentAbsoluteWear = Number(preset && preset.active_anchor_abs_wear);
  if (Number.isFinite(currentAbsoluteWear)) {
    if (!nextHasBounds) return currentAbsoluteWear;
    return Number(Math.min(nextMaxWear, Math.max(nextMinWear, currentAbsoluteWear)).toFixed(12));
  }
  return Number.isFinite(nextMinWear) ? nextMinWear : null;
}
function mapTradeupSimulationPredictorOutcomeToItem(outcome) {
  const markethashname = String(outcome && (outcome.markethashname || outcome.name || outcome.base_name) || "").trim();
  if (!markethashname) return null;
  return sanitizeTradeupSimulationTargetItem({
    markethashname,
    name: String(outcome && (outcome.name || outcome.markethashname || outcome.base_name) || "").trim(),
    basemarkethashname: String(outcome && (outcome.base_name || outcome.markethashname || outcome.name) || "").trim(),
    basename: String(outcome && (outcome.base_name || outcome.markethashname || outcome.name) || "").trim(),
    collection: String(outcome && (outcome.collection_display || outcome.collection_key) || "").trim(),
    rarity: "",
    minfloat: outcome && outcome.minfloat,
    maxfloat: outcome && outcome.maxfloat,
    goods_icon_url: String(outcome && outcome.goods_icon_url || "").trim(),
    goods_original_icon_url: String(outcome && outcome.goods_original_icon_url || "").trim(),
    goods_share_thumbnail_url: String(outcome && outcome.goods_share_thumbnail_url || "").trim()
  });
}
function buildTradeupSimulationDerivedOutputPayload(preset) {
  const primaryOutput = sanitizeTradeupSimulationTargetItem(preset && preset.primary_output)
    || sanitizeTradeupSimulationTargetItem(preset && preset.cover_output);
  const mainMaterial = sanitizeTradeupSimulationTargetItem(preset && preset.main_material);
  const auxMaterial = sanitizeTradeupSimulationTargetItem(preset && preset.aux_material);
  const materialEntries = [
    {slot: "main_material", item: mainMaterial},
    {slot: "aux_material", item: auxMaterial}
  ]
    .filter(({item}) => !!item)
    .filter(({slot, item}) => !getTradeupSimulationPickerRestrictionMessage(item, slot));
  const materials = materialEntries.map(({item}) => item);
  if (!materials.length) return null;
  const rarity = String(materials[0] && materials[0].rarity || "").trim();
  if (!rarity || materials.some((item) => String(item && item.rarity || "").trim() !== rarity)) return null;
  const relativeWear = getTradeupSimulationAnchorRelativeWear(preset);
  if (!Number.isFinite(relativeWear)) return null;
  const groups = [];
  const collectionCountMap = new Map();
  const allowedMaterialBySlot = new Map(materialEntries.map(({slot, item}) => [slot, item]));
  const allowedMainMaterial = allowedMaterialBySlot.get("main_material") || null;
  const allowedAuxMaterial = allowedMaterialBySlot.get("aux_material") || null;
  const allowedRowCollections = (Array.isArray(preset && preset.rows) ? preset.rows : [])
    .flatMap((row) => Array.isArray(row && row.materials) ? row.materials : [])
    .filter((item) => !getTradeupSimulationPickerRestrictionMessage(item, "main_material"))
    .map((item) => String(item && item.collection || "").trim())
    .filter(Boolean);
  const pushCollection = (value) => {
    const collection = String(value || "").trim();
    if (!collection || collectionCountMap.has(collection) || collectionCountMap.size >= 10) return;
    collectionCountMap.set(collection, 1);
  };
  pushCollection(allowedMainMaterial && allowedMainMaterial.collection);
  if (!allowedMainMaterial) {
    pushCollection(primaryOutput && primaryOutput.collection);
  }
  pushCollection(allowedAuxMaterial && allowedAuxMaterial.collection);
  for (const collection of allowedRowCollections) {
    pushCollection(collection);
  }
  for (const [collection, count] of collectionCountMap.entries()) {
    if (!collection || !count) continue;
    groups.push({collection, count});
  }
  if (!groups.length) return null;
  return {
    required_count: 10,
    target_relative_wear: relativeWear,
    input_rarity: rarity,
    stattrak: false,
    groups
  };
}
function getTradeupSimulationResolveTargetKey(item) {
  const normalized = sanitizeTradeupSimulationTargetItem(item);
  if (!normalized) return "";
  const collection = String(normalized.collection || "").trim();
  const rarity = String(normalized.rarity || "").trim();
  return collection && rarity
    ? `${collection}|${rarity}`
    : String(normalized.markethashname || "").trim();
}
function getTradeupSimulationResolveTargets(preset) {
  const targets = [];
  const seen = new Set();
  const pushTarget = (value) => {
    const item = sanitizeTradeupSimulationTargetItem(value);
    if (!item) return;
    const key = getTradeupSimulationResolveTargetKey(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    targets.push(item);
  };
  pushTarget(preset && preset.primary_output);
  pushTarget(preset && preset.aux_output);
  for (const candidate of Array.isArray(preset && preset.output_candidates) ? preset.output_candidates : []) {
    pushTarget(candidate);
  }
  if (!targets.length) {
    pushTarget(preset && preset.cover_output);
  }
  return targets;
}
function getTradeupSimulationPickerContext() {
  const slot = normalizeTradeupSimulationSlotName(state.simulationPickerMode);
  const meta = getTradeupSimulationRoleMeta(slot);
  const roleText = String(meta && meta.title || "物品").trim() || "物品";
  const outputSlot = isTradeupSimulationOutputSlot(slot);
  return {
    roleText,
    hintText: slot
      ? `${roleText}会直接写入当前配方，后续调整在下方${outputSlot ? "产物" : "材料"}列表卡片中完成。${outputSlot ? " 最低级物品不能作为产物添加。" : ""}`
      : "搜索后点击候选项即可写入当前配方。",
    emptyText: slot
      ? `输入名称或收藏品后，为${roleText}搜索候选物品`
      : "输入关键字后搜索全量皮肤库",
    actionText: slot ? `点击设为${roleText}` : "点击写入当前配方"
  };
}
function getTradeupSimulationOutputRestrictionMessage(item, slot = "") {
  const slotName = normalizeTradeupSimulationSlotName(slot);
  if (!isTradeupSimulationOutputSlot(slotName)) return "";
  const nextItem = sanitizeTradeupSimulationTargetItem(item);
  if (!nextItem) return "";
  const rarityText = getTradeupSimulationSafeRarityText(nextItem && nextItem.rarity);
  const lowestRarity = getTradeupSimulationSafeRarityText(nextItem && nextItem.collection_lowest_rarity);
  const isLowest = nextItem.is_collection_lowest_rarity === true
    || (!!rarityText && !!lowestRarity && rarityText === lowestRarity);
  return isLowest ? "该收藏品最低级，不能作为产物添加" : "";
}
function getTradeupSimulationTradeupRestrictionReason(item) {
  const nextItem = sanitizeTradeupSimulationTargetItem(item);
  if (!nextItem) return "";
  const explicitReason = String(nextItem.tradeup_restriction_reason || "").trim();
  if (explicitReason) return explicitReason;
  if (nextItem.is_tradeup_restricted === true) return "tradeup_restricted";
  return String(nextItem.collection || "").trim() === "限量版物品" ? "limited_collection" : "";
}
function getTradeupSimulationPickerRestrictionMessage(item, slot = "") {
  const tradeupRestrictionReason = getTradeupSimulationTradeupRestrictionReason(item);
  if (tradeupRestrictionReason === "limited_collection" || tradeupRestrictionReason === "tradeup_restricted") {
    return "限量版物品不能加入炼金";
  }
  return getTradeupSimulationOutputRestrictionMessage(item, slot);
}
function getTradeupSimulationLockedRarity(preset, slot = "") {
  const slotName = normalizeTradeupSimulationSlotName(slot);
  const slotItems = (isTradeupSimulationOutputSlot(slotName)
    ? ["primary_output", "aux_output"]
    : ["main_material", "aux_material"])
    .map((slotName) => sanitizeTradeupSimulationTargetItem(preset && preset[slotName]))
    .filter(Boolean);
  for (const item of slotItems) {
    const rarity = getTradeupSimulationSafeRarityText(item && item.rarity);
    if (rarity) return rarity;
  }
  return "";
}
function validateTradeupSimulationPickerSelection(preset, slot, item) {
  const nextItem = sanitizeTradeupSimulationTargetItem(item);
  if (!nextItem) {
    return {ok: false, message: "未找到可添加的物品"};
  }
  const pickerRestrictionMessage = getTradeupSimulationPickerRestrictionMessage(nextItem, slot);
  if (pickerRestrictionMessage) {
    return {ok: false, message: pickerRestrictionMessage};
  }
  const currentRarity = getTradeupSimulationLockedRarity(preset, slot);
  const nextRarity = getTradeupSimulationSafeRarityText(nextItem && nextItem.rarity);
  if (currentRarity && nextRarity && currentRarity !== nextRarity) {
    return {
      ok: false,
      message: `单配方需同一稀有度：当前为 ${currentRarity}，不能添加 ${nextRarity}`
    };
  }
  return {ok: true, item: nextItem};
}
function getTradeupSimulationPickerBlockedMessage(preset, slot, item) {
  const slotName = normalizeTradeupSimulationSlotName(slot);
  if (!slotName) return "";
  const validation = validateTradeupSimulationPickerSelection(preset || {}, slotName, item);
  return validation && validation.ok === false
    ? String(validation.message || "").trim()
    : "";
}
async function selectTradeupSimulationPickerItem(pickIndex) {
  const results = Array.isArray(state.simulationPickerResults) ? state.simulationPickerResults : [];
  const index = Number(pickIndex);
  const item = Number.isInteger(index) ? results[index] : null;
  const slot = normalizeTradeupSimulationSlotName(state.simulationPickerMode);
  const preset = getActiveTradeupSimulationPreset();
  if (!slot || !item || !preset) return false;
  const validation = validateTradeupSimulationPickerSelection(preset, slot, item);
  if (!validation.ok) {
    showErrorToast(String(validation.message || "当前物品无法加入该配方").trim() || "当前物品无法加入该配方");
    return false;
  }
  const updated = applyTradeupSimulationSlotSelection({
    slot,
    item: validation.item
  });
  if (!updated) return false;
  closeTradeupSimulationPickerModal();
  renderSimulationPage();
  const refreshedPreset = getActiveTradeupSimulationPreset();
  if (!refreshedPreset) return true;
  if (isTradeupSimulationOutputSlot(slot)) {
    await resolveTradeupSimulationPreset(refreshedPreset.id);
    return true;
  }
  await refreshTradeupSimulationDerivedOutputs(refreshedPreset.id);
  const resolvedPreset = getActiveTradeupSimulationPreset();
  if (resolvedPreset && (resolvedPreset.cover_output || resolvedPreset.primary_output)) {
    await resolveTradeupSimulationPreset(resolvedPreset.id);
  }
  return true;
}
function renderTradeupSimulationPickerResults() {
  if (!ui.simulationPickerSearchResults) return;
  const results = Array.isArray(state.simulationPickerResults) ? state.simulationPickerResults : [];
  const context = getTradeupSimulationPickerContext();
  const slot = normalizeTradeupSimulationSlotName(state.simulationPickerMode);
  const preset = getActiveTradeupSimulationPreset();
  const errorText = String(state.simulationPickerError || "").trim();
  if (state.simulationSearchLoading) {
    ui.simulationPickerSearchResults.innerHTML = `<div class="simulation-row-empty">正在搜索${context.roleText}候选...</div>`;
    return;
  }
  if (errorText) {
    ui.simulationPickerSearchResults.innerHTML = `<div class="simulation-row-empty">搜索失败：${escapeHtml(errorText)}</div>`;
    return;
  }
  if (!results.length) {
    ui.simulationPickerSearchResults.innerHTML = String(state.simulationPickerQuery || "").trim()
      ? '<div class="simulation-row-empty">没有找到匹配的物品</div>'
      : `<div class="simulation-row-empty">${context.emptyText}</div>`;
    return;
  }
  ui.simulationPickerSearchResults.innerHTML = results.map((item, index) => {
    const {artUrl, artStyleAttr} = getTradeupSimulationArtProps(item);
    const pickerRestrictionMessage = getTradeupSimulationPickerBlockedMessage(preset, slot, item);
    const disabled = !!pickerRestrictionMessage;
    const itemLabel = String(item && (item.basename || item.basemarkethashname || item.markethashname) || "").trim();
    const rarityVisual = getTradeupSimulationRarityVisuals(item && item.rarity);
    const metaText = String(item && item.collection || "").trim() || "未标记收藏品";
    const rarityStyleAttr = ` style="--simulation-picker-rarity-color:${escapeHtmlAttribute(rarityVisual.color)}"`;
    const disabledAttr = disabled ? ' disabled aria-disabled="true"' : "";
    return `
      <button class="simulation-picker-item${disabled ? " is-disabled" : ""}" type="button" data-simulation-pick-index="${index}"${rarityStyleAttr}${disabledAttr}>
        <span class="simulation-picker-item-layout">
          <span class="simulation-picker-item-art${artUrl ? " has-image" : ""}"${artStyleAttr}>
            <span class="simulation-card-wear-badge simulation-picker-rarity-badge">${escapeHtml(rarityVisual.label)}</span>
            ${artUrl
              ? `<img class="simulation-picker-item-thumb" src="${escapeHtmlAttribute(artUrl)}" alt="${escapeHtmlAttribute(itemLabel)}" loading="eager" decoding="async" fetchpriority="high" />`
              : '<span class="simulation-card-art-empty">暂无图</span>'}
            <span class="simulation-picker-art-mask">
              <span class="simulation-picker-art-title" title="${escapeHtmlAttribute(itemLabel)}">${escapeHtml(itemLabel)}</span>
              <span class="simulation-picker-art-meta">${escapeHtml(metaText)}</span>
            </span>
          </span>
          ${pickerRestrictionMessage ? `<span class="simulation-picker-item-warning"><span class="simulation-picker-art-warning">${escapeHtml(pickerRestrictionMessage)}</span></span>` : ""}
        </span>
      </button>
    `;
  }).join("");
  const applyPickerThumbLayout = (thumb) => {
    if (!thumb) return;
    thumb.classList.remove("is-wide");
    const naturalWidth = Number(thumb.naturalWidth || 0);
    const naturalHeight = Number(thumb.naturalHeight || 0);
    if (!naturalWidth || !naturalHeight) return;
    if (naturalWidth / naturalHeight >= 1.3) {
      thumb.classList.add("is-wide");
    }
  };
  const handlePickerThumbError = (thumb) => {
    if (!thumb) return;
    const art = thumb.closest(".simulation-picker-item-art");
    if (!art) {
      thumb.remove();
      return;
    }
    art.classList.remove("has-image");
    thumb.remove();
    if (!art.querySelector(".simulation-card-art-empty")) {
      const empty = document.createElement("span");
      empty.className = "simulation-card-art-empty";
      empty.textContent = "暂无图";
      art.append(empty);
    }
  };
  for (const thumb of ui.simulationPickerSearchResults.querySelectorAll(".simulation-picker-item-thumb")) {
    thumb.onload = () => {
      applyPickerThumbLayout(thumb);
    };
    thumb.onerror = () => {
      handlePickerThumbError(thumb);
    };
    if (thumb.complete) {
      if (Number(thumb.naturalWidth || 0) > 0 && Number(thumb.naturalHeight || 0) > 0) {
        applyPickerThumbLayout(thumb);
      } else {
        handlePickerThumbError(thumb);
      }
    }
  }
  for (const button of ui.simulationPickerSearchResults.querySelectorAll("[data-simulation-pick-index]")) {
    button.onclick = async () => {
      if (button.disabled) return;
      const index = Number(button.getAttribute("data-simulation-pick-index"));
      await selectTradeupSimulationPickerItem(index);
    };
  }
}
async function searchTradeupSimulationItems(query) {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可搜索真实汰换物品库。",
    view: "login"
  }) === false) {
    return false;
  }
  const searchText = String(query != null ? query : state.simulationPickerQuery || "").trim();
  state.simulationPickerQuery = searchText;
  if (!searchText) {
    state.simulationSearchSeq = Math.max(0, Number(state.simulationSearchSeq || 0) || 0) + 1;
    state.simulationSearchLoading = false;
    state.simulationPickerResults = [];
    state.simulationPickerError = "";
    renderTradeupSimulationPickerModal();
    return;
  }
  state.simulationSearchLoading = true;
  state.simulationPickerError = "";
  state.simulationSearchSeq = Math.max(0, Number(state.simulationSearchSeq || 0) || 0) + 1;
  const requestSeq = state.simulationSearchSeq;
  renderTradeupSimulationPickerModal();
  try {
    const data = await api(`/api/simulation/tradeup/search-items?q=${encodeURIComponent(searchText)}`);
    if (requestSeq !== state.simulationSearchSeq) return;
    state.simulationSearchLoading = false;
    state.simulationPickerResults = Array.isArray(data && data.items) ? data.items : [];
    state.simulationPickerError = "";
    renderTradeupSimulationPickerModal();
  } catch (err) {
    if (requestSeq !== state.simulationSearchSeq) return;
    state.simulationSearchLoading = false;
    state.simulationPickerResults = [];
    state.simulationPickerError = String(err && err.message || err || "未知错误").trim();
    renderTradeupSimulationPickerModal();
  }
}
async function refreshTradeupSimulationDerivedOutputs(presetId) {
  const preset = getTradeupSimulationWorkspaceDraft(presetId)
    || getTradeupSimulationPresetById(presetId)
    || getActiveTradeupSimulationPreset();
  if (!preset) return false;
  const payload = buildTradeupSimulationDerivedOutputPayload(preset);
  if (!payload) return false;
  try {
    const data = await api("/api/craft/predict-outcomes", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const candidates = (Array.isArray(data && data.outcomes) ? data.outcomes : [])
      .map((entry) => mapTradeupSimulationPredictorOutcomeToItem(entry))
      .filter(Boolean);
    if (!candidates.length) return false;
    const updated = updateTradeupSimulationPresetRecord(preset.id, (current) => ({
      ...current,
      output_candidates: deepCopyPlain(candidates),
      warnings: [],
      updated_at: Date.now()
    }));
    if (!updated) return false;
    adoptTradeupSimulationDerivedPrimaryOutput({
      presetId: preset.id,
      candidates
    });
    return true;
  } catch (_) {
    return false;
  }
}
function buildTradeupSimulationResolvePayloads(preset) {
  const targets = getTradeupSimulationResolveTargets(preset);
  if (!preset || !targets.length) return [];
  const activeAnchorItem = getTradeupSimulationActiveAnchorItem(preset);
  const driverMarkethashname = String(activeAnchorItem && activeAnchorItem.markethashname || targets[0] && targets[0].markethashname || "").trim();
  const anchors = getTradeupSimulationSelectedMaterialCollections(preset).map((collection) => ({
    type: "collection",
    value: collection
  }));
  return targets.map((target) => ({
    target_item: {
      markethashname: String(target && target.markethashname || "").trim()
    },
    active_driver_item: {
      markethashname: driverMarkethashname
    },
    active_driver_abs_wear: preset.active_anchor_abs_wear,
    anchors
  })).filter((payload) => String(payload.target_item && payload.target_item.markethashname || "").trim());
}
function mergeTradeupSimulationResolveResults(preset, results = [], failures = []) {
  const successful = (Array.isArray(results) ? results : []).filter((entry) => entry && entry.ok === true);
  if (!successful.length) return null;
  const rowKeys = new Set();
  const rows = [];
  for (const result of successful) {
    for (const row of Array.isArray(result && result.rows) ? result.rows : []) {
      const outputs = Array.isArray(row && row.outputs) ? row.outputs : [];
      const rowKey = `${String(row && (row.collection_key || row.collection) || "").trim()}|${String(outputs[0] && outputs[0].rarity || "").trim()}`;
      if (rowKey && rowKeys.has(rowKey)) continue;
      if (rowKey) rowKeys.add(rowKey);
      rows.push(deepCopyPlain(row));
    }
  }
  const warnings = [];
  for (const result of successful) {
    warnings.push(...deepCopyPlain(Array.isArray(result && result.warnings) ? result.warnings : []));
  }
  for (const failure of Array.isArray(failures) ? failures : []) {
    const message = String(failure && failure.message || "").trim();
    if (!message) continue;
    warnings.push({
      type: String(failure && failure.invalid_reason || "resolve_failed").trim() || "resolve_failed",
      message
    });
  }
  return {
    ok: true,
    invalid_reason: "",
    message: "",
    target: deepCopyPlain(successful[0] && successful[0].target),
    driver: deepCopyPlain(successful[0] && successful[0].driver),
    rows,
    warnings
  };
}
async function resolveTradeupSimulationPreset(presetId) {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可解析并编辑真实汰换模拟配置。",
    view: "login"
  }) === false) {
    return false;
  }
  const preset = getTradeupSimulationWorkspaceDraft(presetId)
    || (Array.isArray(state.simulationPresets) ? state.simulationPresets : [])
      .find((entry) => String(entry && entry.id || "").trim() === String(presetId || "").trim());
  if (!preset) return;
  if (!Number.isFinite(Number(preset.active_anchor_abs_wear))) {
    renderSimulationPage();
    return;
  }
  const payloads = buildTradeupSimulationResolvePayloads(preset);
  if (!payloads.length) return;
  state.simulationLoading = true;
  state.simulationRequestSeq = Math.max(0, Number(state.simulationRequestSeq || 0) || 0) + 1;
  const requestSeq = state.simulationRequestSeq;
  renderSimulationPage();
  try {
    const responses = await Promise.all(payloads.map(async (payload) => {
      try {
        return await api("/api/simulation/tradeup/resolve", {
          method: "POST",
          body: JSON.stringify(payload)
        });
      } catch (err) {
        return {
          ok: false,
          invalid_reason: String(err && err.data && err.data.invalid_reason || "resolve_failed").trim() || "resolve_failed",
          message: String(err && err.data && err.data.message || err && err.message || err || "解析失败").trim(),
          warnings: deepCopyPlain(Array.isArray(err && err.data && err.data.warnings) ? err.data.warnings : []),
          rows: []
        };
      }
    }));
    if (requestSeq !== state.simulationRequestSeq) return;
    state.simulationLoading = false;
    const successful = responses.filter((entry) => entry && entry.ok === true);
    const failures = responses.filter((entry) => !entry || entry.ok !== true);
    if (successful.length) {
      const merged = mergeTradeupSimulationResolveResults(preset, successful, failures);
      if (merged) {
        applyTradeupSimulationResolveResult(preset.id, merged);
      } else {
        applyTradeupSimulationResolveFailure(preset.id, failures[0]);
      }
    } else {
      applyTradeupSimulationResolveFailure(preset.id, failures[0]);
    }
    renderSimulationPage();
  } catch (err) {
    if (requestSeq !== state.simulationRequestSeq) return;
    state.simulationLoading = false;
    applyTradeupSimulationResolveFailure(preset.id, {
      ok: false,
      invalid_reason: "resolve_failed",
      message: String(err && err.message || err || "解析失败").trim()
    });
    renderSimulationPage();
  }
}
function renderSimulationModeTabs() {
  const mode = state.simulationViewMode === "saved" ? "saved" : "workspace";
  for (const [button, value] of [[ui.simulationModeSavedBtn, "saved"], [ui.simulationModeWorkspaceBtn, "workspace"]]) {
    if (!button) continue;
    const active = mode === value;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }
}
function renderSimulationSavedPresets() {
  if (!ui.simulationSavedPresets) return;
  const list = Array.isArray(state.simulationPresets) ? state.simulationPresets : [];
  ui.simulationSavedPresets.classList.toggle("hidden", state.simulationViewMode !== "saved");
  if (!list.length) {
    ui.simulationSavedPresets.innerHTML = '<div class="simulation-row-empty">还没有已保存配方，点击“选材页面”开始。</div>';
    return;
  }
  ui.simulationSavedPresets.innerHTML = list.map((preset) => {
    const summary = buildTradeupSimulationSavedCardSummary(preset);
    const active = String(state.simulationActivePresetId || "").trim() === String(preset && preset.id || "").trim();
    return renderTradeupSimulationSelectionStyleCard({
      item: preset && (preset.cover_output || preset.primary_output),
      preset,
      kind: "output",
      mode: "saved",
      titleText: summary.presetName,
      sublineHtml: renderTradeupSimulationSavedCardSubline(summary.collectionText),
      extraClasses: `simulation-saved-card${active ? " simulation-anchor-active" : ""}`,
      extraArtHtml: `<button class="simulation-saved-export-btn" type="button" data-simulation-export-preset-id="${String(preset && preset.id || "").trim()}" aria-label="导出到快速选材" title="导出到快速选材">⇥</button><button class="simulation-saved-remove-btn" type="button" data-simulation-delete-preset-id="${String(preset && preset.id || "").trim()}" aria-label="删除该配方" title="删除该配方">×</button>`,
      dataAttrs: `data-simulation-preset-id="${String(preset && preset.id || "").trim()}"`,
      ariaLabel: `查看已保存配方 ${summary.presetName}`,
      actionBadgeText: "",
      wearValue: summary.anchorAbsoluteWearValue,
      wearText: summary.anchorWear,
      wearLabel: summary.wearLabel,
      wearToneClass: summary.wearToneClass
    });
  }).join("");
  const updateSavedCardActiveState = () => {
    const activeId = String(state.simulationActivePresetId || "").trim();
    for (const item of ui.simulationSavedPresets.querySelectorAll("[data-simulation-preset-id]")) {
      const isActive = String(item.getAttribute("data-simulation-preset-id") || "").trim() === activeId;
      item.classList.toggle("is-active", isActive);
      item.classList.toggle("simulation-anchor-active", isActive);
    }
  };
  for (const card of ui.simulationSavedPresets.querySelectorAll("[data-simulation-preset-id]")) {
    const removeBtn = card.querySelector("[data-simulation-delete-preset-id]");
    const exportBtn = card.querySelector("[data-simulation-export-preset-id]");
    if (exportBtn) {
      exportBtn.onclick = async (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        const presetId = String(exportBtn.getAttribute("data-simulation-export-preset-id") || "").trim();
        if (!presetId) return;
        const list = Array.isArray(state.simulationPresets) ? state.simulationPresets : [];
        const preset = list.find((entry) => String(entry && entry.id || "").trim() === presetId);
        if (!preset) return;
        await openSimExportCraftModal(preset);
      };
    }
    if (removeBtn) {
      removeBtn.onclick = async (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        const presetId = String(removeBtn.getAttribute("data-simulation-delete-preset-id") || "").trim();
        if (!presetId) return;
        const confirmed = await openConfirmModal({
          title: "确认删除配方",
          message: "确定要删除该配方吗？",
          confirmText: "确认删除",
          cancelText: "取消"
        });
        if (!confirmed) return;
        await deleteTradeupSimulationPreset(presetId);
      };
    }
    card.onclick = () => {
      const presetId = String(card.getAttribute("data-simulation-preset-id") || "").trim();
      selectTradeupSimulationPreset(presetId, {openWorkspace: false});
      closeTradeupSimulationPickerModal();
      updateSavedCardActiveState();
    };
    card.onkeydown = (evt) => {
      if (evt.key !== "Enter" && evt.key !== " ") return;
      evt.preventDefault();
      const presetId = String(card.getAttribute("data-simulation-preset-id") || "").trim();
      const preset = setTradeupSimulationActivePreset(presetId);
      closeTradeupSimulationPickerModal();
      renderSimulationPage();
      if (preset && Number.isFinite(Number(preset.active_anchor_abs_wear))) {
        void resolveTradeupSimulationPreset(preset.id);
      }
    };
    card.ondblclick = () => {
      const presetId = String(card.getAttribute("data-simulation-preset-id") || "").trim();
      const preset = setTradeupSimulationActivePreset(presetId);
      closeTradeupSimulationPickerModal();
      renderSimulationPage();
      if (preset && Number.isFinite(Number(preset.active_anchor_abs_wear))) {
        void resolveTradeupSimulationPreset(preset.id);
      }
    };
  }
}
function renderSimulationWorkspaceActionsBar(preset) {
  if (!ui.simulationWorkspaceActionsBar) return;
  const showActions = state.simulationViewMode === "workspace";
  ui.simulationWorkspaceActionsBar.classList.toggle("hidden", !showActions);
  if (ui.simulationSavePresetBtn) {
    ui.simulationSavePresetBtn.disabled = !preset || !(preset.primary_output || preset.cover_output) || !!state.simulationLoading || !!state.simulationPersisting;
    ui.simulationSavePresetBtn.textContent = state.simulationPersisting ? "保存中..." : "保存配置";
  }
  if (ui.simulationCancelEditBtn) {
    ui.simulationCancelEditBtn.disabled = !!state.simulationPersisting;
  }
}
// ── Simulation Export to Craft Assist ──
function extractSimExportCraftMaterials(preset) {
  const mainMat = sanitizeTradeupSimulationTargetItem(preset && preset.main_material);
  const auxMat = sanitizeTradeupSimulationTargetItem(preset && preset.aux_material);
  const mainCollection = String(mainMat && mainMat.collection || "").trim();
  const auxCollection = String(auxMat && auxMat.collection || "").trim();
  const rows = Array.isArray(preset && preset.material_rows) ? preset.material_rows : [];
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const materials = Array.isArray(row && row.materials) ? row.materials : [];
    for (const item of materials) {
      const t = sanitizeTradeupSimulationTargetItem(item);
      if (!t) continue;
      const key = String(t.markethashname || "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const col = String(t.collection || "").trim();
      let role = "main";
      if (auxCollection && col === auxCollection && col !== mainCollection) role = "aux";
      else if (auxCollection && col === auxCollection && col === mainCollection) {
        const auxKey = String(auxMat && auxMat.markethashname || "").trim();
        if (key === auxKey) role = "aux";
      }
      out.push({
        markethashname: key,
        basename: String(t.basename || t.basemarkethashname || key).trim(),
        role,
        artUrl: String(t.goods_icon_url || t.goods_share_thumbnail_url || "").trim(),
        collection: col
      });
    }
  }
  if (!out.length) {
    if (mainMat) {
      const mk = String(mainMat.markethashname || "").trim();
      if (mk && !seen.has(mk)) {
        seen.add(mk);
        out.push({markethashname: mk, basename: String(mainMat.basename || mainMat.basemarkethashname || mk).trim(), role: "main", artUrl: String(mainMat.goods_icon_url || "").trim(), collection: mainCollection});
      }
    }
    if (auxMat) {
      const mk = String(auxMat.markethashname || "").trim();
      if (mk && !seen.has(mk)) {
        seen.add(mk);
        out.push({markethashname: mk, basename: String(auxMat.basename || auxMat.basemarkethashname || mk).trim(), role: "aux", artUrl: String(auxMat.goods_icon_url || "").trim(), collection: auxCollection});
      }
    }
  }
  return out;
}
function renderSimExportCraftMaterialList() {
  if (!ui.simExportCraftMaterialList) return;
  if (!simExportCraftMaterials.length) {
    ui.simExportCraftMaterialList.innerHTML = '<div class="sim-export-craft-search-empty">暂无材料</div>';
    return;
  }
  ui.simExportCraftMaterialList.innerHTML = simExportCraftMaterials.map((m, i) => {
    const label = String(m.basename || m.markethashname || "").trim();
    const shortLabel = label.length > 36 ? label.slice(0, 34) + "…" : label;
    const role = m.role === "aux" ? "aux" : "main";
    const roleText = role === "aux" ? "辅料" : "主料";
    return `<div class="sim-export-craft-material-row" data-sim-export-idx="${i}">` +
      `<span class="sim-export-craft-material-name" title="${escapeHtmlAttribute(label)}">${escapeHtml(shortLabel)}</span>` +
      `<button class="sim-export-craft-role-btn" type="button" data-role="${role}" data-sim-export-role-idx="${i}" title="点击切换角色">${roleText}</button>` +
      `<button class="sim-export-craft-remove-btn" type="button" data-sim-export-remove-idx="${i}" title="移除该材料">×</button>` +
      `</div>`;
  }).join("");
  for (const btn of ui.simExportCraftMaterialList.querySelectorAll("[data-sim-export-role-idx]")) {
    btn.onclick = (evt) => {
      evt.preventDefault();
      const idx = Number(btn.getAttribute("data-sim-export-role-idx"));
      if (!Number.isInteger(idx) || idx < 0 || idx >= simExportCraftMaterials.length) return;
      simExportCraftMaterials[idx].role = simExportCraftMaterials[idx].role === "aux" ? "main" : "aux";
      renderSimExportCraftMaterialList();
      syncSimExportCraftAuxVisibility();
    };
  }
  for (const btn of ui.simExportCraftMaterialList.querySelectorAll("[data-sim-export-remove-idx]")) {
    btn.onclick = (evt) => {
      evt.preventDefault();
      const idx = Number(btn.getAttribute("data-sim-export-remove-idx"));
      if (!Number.isInteger(idx) || idx < 0 || idx >= simExportCraftMaterials.length) return;
      simExportCraftMaterials.splice(idx, 1);
      renderSimExportCraftMaterialList();
      syncSimExportCraftAuxVisibility();
    };
  }
}
function syncSimExportCraftAuxVisibility() {
  const hasAux = simExportCraftMaterials.some((m) => m.role === "aux");
  if (ui.simExportCraftAuxCountRow) {
    ui.simExportCraftAuxCountRow.classList.toggle("hidden", !hasAux);
  }
  if (!hasAux && ui.simExportCraftMainCount) {
    ui.simExportCraftMainCount.value = "10";
    if (ui.simExportCraftAuxCount) ui.simExportCraftAuxCount.value = "0";
  }
}
function closeSimExportCraftModal(result) {
  if (ui.simExportCraftModal) ui.simExportCraftModal.classList.add("hidden");
  if (ui.simExportCraftSearchPanel) ui.simExportCraftSearchPanel.classList.add("hidden");
  simExportCraftMaterials = [];
  simExportCraftSearchResults = [];
  simExportCraftSearchLoading = false;
  const resolver = simExportCraftResolver;
  simExportCraftResolver = null;
  if (typeof resolver === "function") resolver(result);
}
function resolveSimExportCraftTargetWearPair(preset) {
  const absWear = Number(preset && preset.active_anchor_abs_wear);
  if (!Number.isFinite(absWear)) return null;
  const anchor = getTradeupSimulationAnchorBounds(preset);
  const minWear = Number(anchor && anchor.minfloat);
  const maxWear = Number(anchor && anchor.maxfloat);
  let relativeWear = absWear;
  if (Number.isFinite(minWear) && Number.isFinite(maxWear) && maxWear > minWear) {
    relativeWear = (absWear - minWear) / (maxWear - minWear);
  }
  const clamped = clampWear01(relativeWear, 0);
  const rounded = Math.round(clamped * 100000000) / 100000000;
  return {
    target_wear_raw: String(rounded),
    target_wear: Math.fround(rounded)
  };
}
function openSimExportCraftModal(preset) {
  simExportCraftMaterials = extractSimExportCraftMaterials(preset);
  simExportCraftSearchResults = [];
  simExportCraftSearchLoading = false;
  if (ui.simExportCraftSearchPanel) ui.simExportCraftSearchPanel.classList.add("hidden");
  if (ui.simExportCraftSearchResults) ui.simExportCraftSearchResults.innerHTML = "";
  if (ui.simExportCraftSearchInput) ui.simExportCraftSearchInput.value = "";
  const presetName = String(preset && preset.name || "").trim();
  if (ui.simExportCraftName) ui.simExportCraftName.value = presetName;
  const targetWearPair = resolveSimExportCraftTargetWearPair(preset);
  if (ui.simExportCraftTargetWear) {
    ui.simExportCraftTargetWear.value = targetWearPair ? targetWearPair.target_wear_raw : "";
  }
  const hasAux = simExportCraftMaterials.some((m) => m.role === "aux");
  if (ui.simExportCraftMainCount) ui.simExportCraftMainCount.value = hasAux ? "5" : "10";
  if (ui.simExportCraftAuxCount) ui.simExportCraftAuxCount.value = hasAux ? "5" : "0";
  if (ui.simExportCraftWearMin) ui.simExportCraftWearMin.value = "0";
  if (ui.simExportCraftWearMax) ui.simExportCraftWearMax.value = "1";
  syncSimExportCraftAuxVisibility();
  renderSimExportCraftMaterialList();
  if (!ui.simExportCraftModal) return Promise.resolve(null);
  return new Promise((resolve) => {
    simExportCraftResolver = resolve;
    ui.simExportCraftModal.classList.remove("hidden");
    requestAnimationFrame(() => {
      if (ui.simExportCraftName) ui.simExportCraftName.focus();
    });
  });
}
function confirmSimExportCraftModal() {
  const name = String(ui.simExportCraftName && ui.simExportCraftName.value || "").trim();
  if (!name) {
    showErrorToast("请输入配置名称");
    return;
  }
  const targetWearRawInput = String(ui.simExportCraftTargetWear && ui.simExportCraftTargetWear.value || "").trim();
  const targetWear = parseOptionalWear01(targetWearRawInput);
  const targetWearPair = resolveCraftAssistTargetWearPair(targetWear, targetWearRawInput);
  if (!targetWearPair) {
    showErrorToast("请输入有效的目标磨损（0~1）");
    return;
  }
  if (!simExportCraftMaterials.length) {
    showErrorToast("至少需要一个材料");
    return;
  }
  const mainCount = Math.max(1, Math.min(10, Math.round(Number(ui.simExportCraftMainCount && ui.simExportCraftMainCount.value || 0) || 0)));
  const auxCount = Math.max(0, Math.min(9, Math.round(Number(ui.simExportCraftAuxCount && ui.simExportCraftAuxCount.value || 0) || 0)));
  const rawWearMin = parseOptionalWear01(ui.simExportCraftWearMin && ui.simExportCraftWearMin.value);
  const rawWearMax = parseOptionalWear01(ui.simExportCraftWearMax && ui.simExportCraftWearMax.value);
  const wearMin = rawWearMin != null ? clampWear01(rawWearMin, 0) : 0;
  const wearMax = rawWearMax != null ? clampWear01(rawWearMax, 1) : 1;
  const finalWearMin = Math.min(wearMin, wearMax);
  const finalWearMax = Math.max(wearMin, wearMax);
  const mainNames = simExportCraftMaterials.filter((m) => m.role !== "aux").map((m) => m.markethashname);
  const auxNames = simExportCraftMaterials.filter((m) => m.role === "aux").map((m) => m.markethashname);
  const materials = [];
  if (mainNames.length) {
    materials.push({
      id: makeCraftAssistUid("preset_material"),
      role: "main",
      count: mainCount,
      direction: normalizeCraftAssistDirection("main"),
      disable_direction_limit: false,
      names: mainNames,
      name: mainNames[0],
      wear_min: finalWearMin,
      wear_max: finalWearMax,
      custom_range: true,
      items: mainNames.map((n, idx) => ({
        id: `preset_material_main_${idx + 1}`,
        name: n,
        wear_filter_mode: "relative",
        wear_min: finalWearMin,
        wear_max: finalWearMax,
        custom_range: true
      }))
    });
  }
  if (auxNames.length && auxCount > 0) {
    materials.push({
      id: makeCraftAssistUid("preset_material"),
      role: "aux",
      count: auxCount,
      direction: normalizeCraftAssistDirection("aux"),
      disable_direction_limit: false,
      names: auxNames,
      name: auxNames[0],
      wear_min: finalWearMin,
      wear_max: finalWearMax,
      custom_range: true,
      items: auxNames.map((n, idx) => ({
        id: `preset_material_aux_${idx + 1}`,
        name: n,
        wear_filter_mode: "relative",
        wear_min: finalWearMin,
        wear_max: finalWearMax,
        custom_range: true
      }))
    });
  }
  if (!materials.length) {
    showErrorToast("至少需要一个有效材料");
    return;
  }
  const preset = sanitizeCraftAssistPresetPayload({
    id: makeCraftAssistUid("preset"),
    name,
    target_wear: targetWearPair.target_wear,
    target_wear_raw: targetWearPair.target_wear_raw,
    materials,
    created_at: Date.now(),
    updated_at: Date.now()
  });
  if (!preset) {
    showErrorToast("配置验证失败，请检查输入");
    return;
  }
  const list = Array.isArray(state.craftAssistPresets) ? [...state.craftAssistPresets] : [];
  list.push(preset);
  state.craftAssistPresets = normalizeCraftAssistPresetList(list);
  saveCraftAssistPresetsToStorage();
  setSummary(`已导出配置「${name}」到快速选材`);
  closeSimExportCraftModal(true);
}
async function searchSimExportCraftItems(query) {
  const searchText = String(query || "").trim();
  if (!searchText) {
    simExportCraftSearchResults = [];
    simExportCraftSearchLoading = false;
    renderSimExportCraftSearchResults();
    return;
  }
  simExportCraftSearchLoading = true;
  simExportCraftSearchSeq = Math.max(0, Number(simExportCraftSearchSeq || 0) || 0) + 1;
  const seq = simExportCraftSearchSeq;
  renderSimExportCraftSearchResults();
  try {
    const data = await api(`/api/simulation/tradeup/search-items?q=${encodeURIComponent(searchText)}`);
    if (seq !== simExportCraftSearchSeq) return;
    simExportCraftSearchLoading = false;
    simExportCraftSearchResults = Array.isArray(data && data.items) ? data.items : [];
    renderSimExportCraftSearchResults();
  } catch (_) {
    if (seq !== simExportCraftSearchSeq) return;
    simExportCraftSearchLoading = false;
    simExportCraftSearchResults = [];
    renderSimExportCraftSearchResults();
  }
}
function renderSimExportCraftSearchResults() {
  if (!ui.simExportCraftSearchResults) return;
  if (simExportCraftSearchLoading) {
    ui.simExportCraftSearchResults.innerHTML = '<div class="sim-export-craft-search-empty">搜索中...</div>';
    return;
  }
  if (!simExportCraftSearchResults.length) {
    ui.simExportCraftSearchResults.innerHTML = '<div class="sim-export-craft-search-empty">无结果</div>';
    return;
  }
  const existingKeys = new Set(simExportCraftMaterials.map((m) => m.markethashname));
  ui.simExportCraftSearchResults.innerHTML = simExportCraftSearchResults.map((item, i) => {
    const t = sanitizeTradeupSimulationTargetItem(item);
    if (!t) return "";
    const key = String(t.markethashname || "").trim();
    const label = String(t.basename || t.basemarkethashname || key).trim();
    const shortLabel = label.length > 40 ? label.slice(0, 38) + "…" : label;
    const exists = existingKeys.has(key);
    return `<button class="sim-export-craft-search-item${exists ? " is-disabled" : ""}" type="button" data-sim-export-search-idx="${i}"${exists ? ' disabled' : ''} title="${escapeHtmlAttribute(label)}">${escapeHtml(shortLabel)}${exists ? " (已添加)" : ""}</button>`;
  }).join("");
  for (const btn of ui.simExportCraftSearchResults.querySelectorAll("[data-sim-export-search-idx]:not([disabled])")) {
    btn.onclick = (evt) => {
      evt.preventDefault();
      const idx = Number(btn.getAttribute("data-sim-export-search-idx"));
      const item = simExportCraftSearchResults[idx];
      const t = sanitizeTradeupSimulationTargetItem(item);
      if (!t) return;
      const key = String(t.markethashname || "").trim();
      if (!key) return;
      if (simExportCraftMaterials.some((m) => m.markethashname === key)) return;
      simExportCraftMaterials.push({
        markethashname: key,
        basename: String(t.basename || t.basemarkethashname || key).trim(),
        role: "main",
        artUrl: String(t.goods_icon_url || t.goods_share_thumbnail_url || "").trim(),
        collection: String(t.collection || "").trim()
      });
      renderSimExportCraftMaterialList();
      syncSimExportCraftAuxVisibility();
      renderSimExportCraftSearchResults();
    };
  }
}
function getTradeupSimulationRoleMeta(slotName) {
  const slot = normalizeTradeupSimulationSlotName(slotName);
  if (slot === "primary_output") return {title: "主产物", hint: "封面位", buttonTitle: "选择主产物"};
  if (slot === "aux_output") return {title: "辅产物", hint: "结果参照位", buttonTitle: "选择辅产物"};
  if (slot === "main_material") return {title: "主料", hint: "材料入口", buttonTitle: "选择主料"};
  return {title: "辅料", hint: "补充材料", buttonTitle: "选择辅料"};
}
function buildTradeupSimulationChooserText(kind, preset) {
  const chooserKind = String(kind || "").trim() === "material" ? "material" : "output";
  const hasMain = chooserKind === "material"
    ? !!sanitizeTradeupSimulationTargetItem(preset && preset.main_material)
    : !!sanitizeTradeupSimulationTargetItem(preset && preset.primary_output);
  const hasAux = chooserKind === "material"
    ? !!sanitizeTradeupSimulationTargetItem(preset && preset.aux_material)
    : !!sanitizeTradeupSimulationTargetItem(preset && preset.aux_output);
  if (!hasMain && !hasAux) return chooserKind === "material" ? "添加材料" : "添加产物";
  if (!hasMain) return chooserKind === "material" ? "添加主料" : "添加主产物";
  if (!hasAux) return chooserKind === "material" ? "添加辅料" : "添加辅产物";
  return chooserKind === "material" ? "修改材料" : "修改产物";
}
function renderSimulationRoleChoosers(preset) {
  const outputText = buildTradeupSimulationChooserText("output", preset);
  const materialText = buildTradeupSimulationChooserText("material", preset);

  if (ui.simulationOutputRoleChooserText) {
    ui.simulationOutputRoleChooserText.innerHTML = `<span class="simulation-role-chooser-plus" aria-hidden="true">+</span><span>${outputText}</span>`;
  }
  if (ui.simulationOutputRoleChooser) {
    ui.simulationOutputRoleChooser.classList.toggle("split", !!state.simulationOutputChooserOpen);
    ui.simulationOutputRoleChooser.setAttribute("aria-label", outputText);
  }
  if (ui.simulationOutputRoleSplit) {
    ui.simulationOutputRoleSplit.classList.toggle("hidden", !state.simulationOutputChooserOpen);
  }

  if (ui.simulationMaterialRoleChooserText) {
    ui.simulationMaterialRoleChooserText.innerHTML = `<span class="simulation-role-chooser-plus" aria-hidden="true">+</span><span>${materialText}</span>`;
  }
  if (ui.simulationMaterialRoleChooser) {
    ui.simulationMaterialRoleChooser.classList.toggle("split", !!state.simulationMaterialChooserOpen);
    ui.simulationMaterialRoleChooser.setAttribute("aria-label", materialText);
  }
  if (ui.simulationMaterialRoleSplit) {
    ui.simulationMaterialRoleSplit.classList.toggle("hidden", !state.simulationMaterialChooserOpen);
  }
}
function openTradeupSimulationRoleSlotPicker(slotName) {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可编辑汰换模拟的产物和材料槽位。",
    view: "login"
  }) === false) {
    return;
  }
  const normalizedSlot = normalizeTradeupSimulationSlotName(slotName);
  if (!normalizedSlot) return;
  if (isTradeupSimulationOutputSlot(normalizedSlot)) {
    state.simulationOutputRole = normalizedSlot;
  } else {
    state.simulationMaterialRole = normalizedSlot;
  }
  if (!openTradeupSimulationPickerModal({
    slot: normalizedSlot,
    title: getTradeupSimulationRoleMeta(normalizedSlot).buttonTitle
  })) {
    return;
  }
  renderSimulationPage();
  focusTradeupSimulationModalPrimaryControl();
}
function renderSimulationRolePanel(preset) {
  renderSimulationRoleChoosers(preset);
}
function getTradeupSimulationItemDisplayName(item) {
  return String(item && (item.base_name || item.basename || item.name || item.basemarkethashname || item.markethashname) || "").trim();
}
function getTradeupSimulationItemDisplayWear(item, preset) {
  const absoluteWear = Number(item && item.absolute_wear);
  if (Number.isFinite(absoluteWear)) return absoluteWear;
  const itemKey = String(item && (item.basemarkethashname || item.markethashname) || "").trim();
  const activeAnchor = getTradeupSimulationActiveAnchorItem(preset);
  const activeKey = String(activeAnchor && (activeAnchor.basemarkethashname || activeAnchor.markethashname) || "").trim();
  const anchorWear = Number(preset && preset.active_anchor_abs_wear);
  if (itemKey && activeKey && itemKey === activeKey && Number.isFinite(anchorWear)) return anchorWear;
  const minWear = Number(item && item.minfloat);
  return Number.isFinite(minWear) ? minWear : null;
}
function getTradeupSimulationItemKey(item) {
  return String(item && (item.basemarkethashname || item.markethashname || item.basename) || "").trim();
}
function getTradeupSimulationSlotTagMeta(slotName) {
  const slot = normalizeTradeupSimulationSlotName(slotName);
  if (slot === "primary_output" || slot === "main_material") return {label: "主", className: "is-primary"};
  if (slot === "aux_output" || slot === "aux_material") return {label: "辅", className: "is-aux"};
  return null;
}
function resolveTradeupSimulationEditSlot(preset, item, itemType, preferredSlot = "") {
  const explicitSlot = normalizeTradeupSimulationSlotName(preferredSlot);
  if (explicitSlot) return explicitSlot;
  const kind = String(itemType || "").trim() === "material" ? "material" : "output";
  const slotNames = kind === "material"
    ? ["main_material", "aux_material"]
    : ["primary_output", "aux_output"];
  const itemKey = getTradeupSimulationItemKey(item);
  if (itemKey) {
    for (const slotName of slotNames) {
      const slotKey = getTradeupSimulationItemKey(sanitizeTradeupSimulationTargetItem(preset && preset[slotName]));
      if (slotKey && slotKey === itemKey) return slotName;
    }
  }
  const collectionKey = String(item && item.collection || "").trim();
  if (collectionKey) {
    for (const slotName of slotNames) {
      const slotItem = sanitizeTradeupSimulationTargetItem(preset && preset[slotName]);
      if (slotItem && String(slotItem.collection || "").trim() === collectionKey) {
        return slotName;
      }
    }
  }
  for (const slotName of slotNames) {
    if (sanitizeTradeupSimulationTargetItem(preset && preset[slotName])) return slotName;
  }
  return slotNames[0] || "";
}
function getTradeupSimulationCardActionBadge(item, preset) {
  const itemKey = getTradeupSimulationItemKey(item);
  const activeKey = getTradeupSimulationItemKey(getTradeupSimulationActiveAnchorItem(preset));
  return itemKey && activeKey && itemKey === activeKey ? "当前锚定" : "";
}
function getTradeupSimulationItemSlotTags(preset, item, kind, slotName = "") {
  const itemKey = getTradeupSimulationItemKey(item);
  if (!itemKey) return [];
  const explicitMeta = getTradeupSimulationSlotTagMeta(slotName);
  if (explicitMeta) return [explicitMeta];
  const slotNames = String(kind || "").trim() === "material"
    ? ["main_material", "aux_material"]
    : ["primary_output", "aux_output"];
  const tags = [];
  for (const name of slotNames) {
    const slotKey = getTradeupSimulationItemKey(sanitizeTradeupSimulationTargetItem(preset && preset[name]));
    if (!slotKey || slotKey !== itemKey) continue;
    const meta = getTradeupSimulationSlotTagMeta(name);
    if (meta && !tags.some((entry) => entry.label === meta.label)) {
      tags.push(meta);
    }
  }
  return tags;
}
function getTradeupSimulationCollectionSlotTags(preset, kind, collection) {
  const collectionKey = String(collection || "").trim();
  if (!collectionKey) return [];
  const collectFromSlots = (slotNames) => {
    const tags = [];
    for (const name of slotNames) {
      const item = sanitizeTradeupSimulationTargetItem(preset && preset[name]);
      if (!item || String(item.collection || "").trim() !== collectionKey) continue;
      const meta = getTradeupSimulationSlotTagMeta(name);
      if (meta && !tags.some((entry) => entry.label === meta.label)) {
        tags.push(meta);
      }
    }
    return tags;
  };
  const outputTags = collectFromSlots(["primary_output", "aux_output"]);
  if (outputTags.length) return outputTags;
  return String(kind || "").trim() === "material"
    ? collectFromSlots(["main_material", "aux_material"])
    : outputTags;
}
function getTradeupSimulationSafeRarityText(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const numericMatch = raw.match(/^r?(\d+)$/i);
  if (numericMatch) {
    const rarity = Number(numericMatch[1]);
    return Number.isFinite(rarity) && rarity > 0 ? craftRarityLabel(rarity) : "";
  }
  return normalizeCraftPredictorRarityLabel(raw);
}
function getTradeupSimulationLaneRarityText(preset, kind, collection, row, items) {
  const list = Array.isArray(items) ? items : [];
  const slotNames = String(kind || "").trim() === "material"
    ? ["main_material", "aux_material"]
    : ["primary_output", "aux_output"];
  const slotRarities = slotNames
    .map((name) => sanitizeTradeupSimulationTargetItem(preset && preset[name]))
    .filter((item) => item && tradeupSimulationCollectionMatches(item.collection, collection))
    .map((item) => item.rarity);
  const candidates = slotRarities.concat([
    row && row.rarity,
    row && row.output_rarity,
    row && row.input_rarity,
    ...list.map((item) => item && item.rarity)
  ]);
  for (const value of candidates) {
    const text = getTradeupSimulationSafeRarityText(value);
    if (text) return text;
  }
  return "";
}
function tradeupSimulationCollectionMatches(value, collection) {
  return String(value || "").trim() === String(collection || "").trim();
}
function isTradeupSimulationItemInCollection(value, collection) {
  const item = sanitizeTradeupSimulationTargetItem(value);
  return !!item && tradeupSimulationCollectionMatches(item.collection, collection);
}
function keepTradeupSimulationRowOutsideCollection(row, collection) {
  return !tradeupSimulationCollectionMatches(
    String(row && (row.collection || row.collection_key) || "").trim(),
    collection
  );
}
function renderTradeupSimulationCardSubline(item, preset, kind, slotName = "") {
  return "";
}
function renderTradeupSimulationLaneRemoveButton(collection) {
  const collectionText = String(collection || "").trim();
  if (!collectionText) return "";
  const label = `删除收藏品 ${collectionText}`;
  return `
    <button
      class="simulation-lane-remove-btn"
      type="button"
      data-simulation-remove-collection="${escapeHtmlAttribute(collectionText)}"
      aria-label="${escapeHtmlAttribute(label)}"
      title="${escapeHtmlAttribute(label)}"
    >
      <span aria-hidden="true">×</span>
    </button>
  `;
}
function renderTradeupSimulationLaneMeta(preset, kind, collection, items = [], row = null) {
  const rarityText = getTradeupSimulationLaneRarityText(preset, kind, collection, row, items);
  const slotTags = getTradeupSimulationCollectionSlotTags(preset, kind, collection)
    .map((entry) => `<span class="simulation-card-slot-tag ${entry.className}">${escapeHtml(entry.label)}</span>`)
    .join("");
  return {
    rarityText,
    slotTags
  };
}
function renderTradeupSimulationWearStack(wearValue, wearText, wearToneClass = "") {
  const resolvedWear = Number.isFinite(wearValue) ? wearValue : 0;
  return `
    <div class="simulation-card-wear-stack${wearToneClass}">
      <div class="simulation-card-float">${wearText}</div>
      <div class="simulation-card-bar${wearToneClass}" style="--simulation-card-wear-pos:${formatCraftPredictorWearMarkerPosition(resolvedWear)}"><span style="width:${Math.max(0, Math.min(100, resolvedWear * 100))}%"></span></div>
    </div>
  `;
}
function renderSimulationOutputCard(output, preset, rowIndex, itemIndex) {
  const wearValue = getTradeupSimulationItemDisplayWear(output, preset);
  const wearText = Number.isFinite(wearValue) ? formatTradeupSimulationWear(wearValue) : "-";
  const wearLabel = getTradeupSimulationWearBadgeLabel(output);
  const wearToneClass = getTradeupSimulationWearBadgeToneClass(output);
  const {artUrl, artStyleAttr} = getTradeupSimulationArtProps(output);
  const outputKey = getTradeupSimulationItemKey(output);
  const actionBadge = getTradeupSimulationCardActionBadge(output, preset);
  return `
    <article class="simulation-output-card simulation-card-button${actionBadge ? " simulation-anchor-active" : ""}" role="button" tabindex="0"
      data-simulation-card-role="output"
      data-simulation-card-mode="${output && output.editable === false ? "readonly" : "edit"}"
      data-simulation-row-index="${rowIndex}"
      data-simulation-item-index="${itemIndex}"
      aria-label="编辑目标产物 ${getTradeupSimulationItemDisplayName(output)}">
      <div class="simulation-card-art${artUrl ? " has-image" : ""}"${artStyleAttr}>
        <span class="simulation-card-wear-badge${wearToneClass}">${wearLabel}</span>
        ${actionBadge ? `<span class="simulation-card-action-badge">${escapeHtml(actionBadge)}</span>` : ""}
        ${renderTradeupSimulationWearStack(wearValue, wearText, wearToneClass)}
        ${artUrl ? "" : '<span class="simulation-card-art-empty">暂无图</span>'}
      </div>
      <div class="simulation-card-content">
        <div class="simulation-card-name">${getTradeupSimulationItemDisplayName(output)}</div>
        ${renderTradeupSimulationCardSubline(output, preset, "output")}
      </div>
    </article>
  `;
}
function renderSimulationMaterialCard(material, rowIndex, itemIndex) {
  const preset = getActiveTradeupSimulationPreset();
  const wearValue = getTradeupSimulationItemDisplayWear(material, preset);
  const wearText = Number.isFinite(wearValue) ? formatTradeupSimulationWear(wearValue) : "-";
  const wearLabel = getTradeupSimulationWearBadgeLabel(material);
  const wearToneClass = getTradeupSimulationWearBadgeToneClass(material);
  const {artUrl, artStyleAttr} = getTradeupSimulationArtProps(material);
  const actionBadge = getTradeupSimulationCardActionBadge(material, preset);
  return `
    <article class="simulation-material-card simulation-card-button${actionBadge ? " simulation-anchor-active" : ""}" role="button" tabindex="0"
      data-simulation-card-role="material"
      data-simulation-card-mode="${material && material.editable === false ? "readonly" : "edit"}"
      data-simulation-row-index="${rowIndex}"
      data-simulation-item-index="${itemIndex}"
      aria-label="编辑联动材料 ${getTradeupSimulationItemDisplayName(material)}">
      <div class="simulation-card-art${artUrl ? " has-image" : ""}"${artStyleAttr}>
        <span class="simulation-card-wear-badge${wearToneClass}">${wearLabel}</span>
        ${actionBadge ? `<span class="simulation-card-action-badge">${escapeHtml(actionBadge)}</span>` : ""}
        ${renderTradeupSimulationWearStack(wearValue, wearText, wearToneClass)}
        ${artUrl ? "" : '<span class="simulation-card-art-empty">暂无图</span>'}
      </div>
      <div class="simulation-card-content">
        <div class="simulation-card-name">${getTradeupSimulationItemDisplayName(material)}</div>
        ${renderTradeupSimulationCardSubline(material, preset, "material")}
      </div>
    </article>
  `;
}
function renderTradeupSimulationSavedCardSubline(collectionText = "") {
  const value = String(collectionText || "").trim() || "未指定收藏品";
  return `
    <div class="simulation-card-subline">
      <div class="simulation-card-subline-main">
        <span class="simulation-card-collection">${escapeHtml(value)}</span>
      </div>
    </div>
  `;
}
function renderTradeupSimulationSelectionStyleCard({
  item,
  preset,
  kind = "output",
  slotName = "",
  mode = "edit",
  titleText = "",
  sublineHtml = "",
  extraClasses = "",
  extraArtHtml = "",
  dataAttrs = "",
  ariaLabel = "",
  actionBadgeText = null,
  wearValue = null,
  wearText = "",
  wearLabel = "",
  wearToneClass = ""
} = {}) {
  const currentItem = sanitizeTradeupSimulationTargetItem(item);
  if (!currentItem) return "";
  const cardKind = String(kind || "").trim() === "material" ? "material" : "output";
  const roleMeta = getTradeupSimulationRoleMeta(slotName);
  const resolvedWearValue = Number.isFinite(Number(wearValue))
    ? Number(wearValue)
    : getTradeupSimulationItemDisplayWear(currentItem, preset);
  const resolvedWearText = String(wearText || "").trim()
    || (Number.isFinite(resolvedWearValue) ? formatTradeupSimulationWear(resolvedWearValue) : "-");
  const resolvedWearLabel = String(wearLabel || "").trim() || getTradeupSimulationWearBadgeLabel(currentItem);
  const {artUrl, artStyleAttr} = getTradeupSimulationArtProps(currentItem);
  const resolvedActionBadge = actionBadgeText === null
    ? getTradeupSimulationCardActionBadge(currentItem, preset)
    : String(actionBadgeText || "").trim();
  const articleClassName = [
    cardKind === "material" ? "simulation-material-card" : "simulation-output-card",
    "simulation-card-button",
    String(extraClasses || "").trim()
  ].filter(Boolean).join(" ");
  const extraAttrText = String(dataAttrs || "").trim();
  const resolvedTitleText = String(titleText || "").trim() || getTradeupSimulationItemDisplayName(currentItem);
  const resolvedSublineHtml = sublineHtml || renderTradeupSimulationCardSubline(currentItem, preset, cardKind, slotName);
  const resolvedMode = String(mode || "").trim() || "edit";
  const resolvedAriaLabel = String(ariaLabel || "").trim() || `编辑${roleMeta.title || "卡片"} ${getTradeupSimulationItemDisplayName(currentItem)}`;
  const explicitWearToneToken = String(wearToneClass || "").trim();
  const resolvedWearToneClass = explicitWearToneToken
    ? ` ${explicitWearToneToken}`
    : getTradeupSimulationWearBadgeToneClass(currentItem);
  return `
    <article class="${articleClassName}" role="button" tabindex="0"
      data-simulation-card-role="${cardKind}"
      data-simulation-card-mode="${escapeHtmlAttribute(resolvedMode)}"
      ${slotName ? `data-simulation-slot-name="${escapeHtmlAttribute(slotName)}"` : ""}
      ${extraAttrText}
      aria-label="${escapeHtmlAttribute(resolvedAriaLabel)}">
      <div class="simulation-card-art${artUrl ? " has-image" : ""}"${artStyleAttr}>
        <span class="simulation-card-wear-badge${resolvedWearToneClass}">${resolvedWearLabel}</span>
        ${resolvedActionBadge ? `<span class="simulation-card-action-badge">${escapeHtml(resolvedActionBadge)}</span>` : ""}
        ${extraArtHtml}
        ${renderTradeupSimulationWearStack(resolvedWearValue, resolvedWearText, resolvedWearToneClass)}
        ${artUrl ? "" : '<span class="simulation-card-art-empty">暂无图</span>'}
      </div>
      <div class="simulation-card-content">
        <div class="simulation-card-name">${escapeHtml(resolvedTitleText)}</div>
        ${resolvedSublineHtml}
      </div>
    </article>
  `;
}
function renderSimulationSelectedOutputCard(output, preset, slotName) {
  const item = sanitizeTradeupSimulationTargetItem(output);
  if (!item) return "";
  return renderTradeupSimulationSelectionStyleCard({
    item,
    preset,
    kind: "output",
    slotName,
    mode: "edit",
    extraClasses: getTradeupSimulationCardActionBadge(item, preset) ? "simulation-anchor-active" : "",
    ariaLabel: `编辑${getTradeupSimulationRoleMeta(slotName).title} ${getTradeupSimulationItemDisplayName(item)}`
  });
}
function renderSimulationSelectedMaterialCard(material, preset, slotName) {
  const item = sanitizeTradeupSimulationTargetItem(material);
  if (!item) return "";
  return renderTradeupSimulationSelectionStyleCard({
    item,
    preset,
    kind: "material",
    slotName,
    mode: item && item.editable === false ? "readonly" : "edit",
    extraClasses: getTradeupSimulationCardActionBadge(item, preset) ? "simulation-anchor-active" : "",
    ariaLabel: `编辑${getTradeupSimulationRoleMeta(slotName).title} ${getTradeupSimulationItemDisplayName(item)}`
  });
}
function removeTradeupSimulationCollectionFromPreset(presetId, collection) {
  const collectionKey = String(collection || "").trim();
  if (!collectionKey) return false;
  const next = updateTradeupSimulationPresetRecord(presetId, (current) => {
    const filterItem = (value) => {
      const item = sanitizeTradeupSimulationTargetItem(value);
      return item && tradeupSimulationCollectionMatches(item.collection, collectionKey) ? null : item;
    };
    let primaryOutput = filterItem(current && current.primary_output);
    let auxOutput = filterItem(current && current.aux_output);
    if (!primaryOutput && auxOutput) {
      primaryOutput = auxOutput;
      auxOutput = null;
    }
    let mainMaterial = filterItem(current && current.main_material);
    let auxMaterial = filterItem(current && current.aux_material);
    if (!mainMaterial && auxMaterial) {
      mainMaterial = auxMaterial;
      auxMaterial = null;
    }
    const outputCandidates = (Array.isArray(current && current.output_candidates) ? current.output_candidates : [])
      .map((entry) => sanitizeTradeupSimulationTargetItem(entry))
      .filter((entry) => entry && !tradeupSimulationCollectionMatches(entry.collection, collectionKey));
    const outputRows = (Array.isArray(current && current.output_rows) ? current.output_rows : [])
      .filter((row) => keepTradeupSimulationRowOutsideCollection(row, collectionKey));
    const materialRows = (Array.isArray(current && current.material_rows) ? current.material_rows : [])
      .filter((row) => keepTradeupSimulationRowOutsideCollection(row, collectionKey));
    const currentCover = filterItem(current && current.cover_output);
    const currentAnchor = filterItem(current && current.active_anchor_item);
    const fallbackAnchor = currentAnchor
      || currentCover
      || primaryOutput
      || mainMaterial
      || auxOutput
      || auxMaterial
      || outputCandidates[0]
      || null;
    const anchorWear = currentAnchor
      ? Number(current && current.active_anchor_abs_wear)
      : Number(fallbackAnchor && fallbackAnchor.minfloat);
    return {
      ...current,
      primary_output: primaryOutput,
      aux_output: auxOutput,
      main_material: mainMaterial,
      aux_material: auxMaterial,
      cover_output: currentCover || primaryOutput || auxOutput || outputCandidates[0] || null,
      active_anchor_item: fallbackAnchor,
      active_anchor_abs_wear: Number.isFinite(anchorWear) ? anchorWear : null,
      output_rows: outputRows,
      material_rows: materialRows,
      rows: outputRows,
      output_candidates: outputCandidates,
      warnings: [],
      dirty: true,
      updated_at: Date.now()
    };
  });
  return !!next;
}
function renderSimulationLaneSection(title, subtitle, cardsHtml, meta = null, actionHtml = "", cardCount = 0) {
  const metaParts = meta && typeof meta === "object"
    ? meta
    : {rarityText: "", slotTags: ""};
  return `
    <section class="simulation-lane-section">
      <div class="simulation-lane-head">
        <div class="simulation-lane-title-wrap">
          ${metaParts.slotTags ? `<div class="simulation-lane-meta">${metaParts.slotTags}</div>` : ""}
          ${metaParts.rarityText ? `<span class="simulation-lane-rarity">${escapeHtml(metaParts.rarityText)}</span>` : ""}
          <strong>${escapeHtml(title)}</strong>
        </div>
        ${actionHtml || (subtitle ? `<span class="simulation-card-note">${escapeHtml(subtitle)}</span>` : "")}
      </div>
      <div class="simulation-card-grid${cardCount === 1 ? " is-single-card" : ""}">
        ${cardsHtml}
      </div>
    </section>
  `;
}
function focusTradeupSimulationWearInput(input) {
  if (!input || input.disabled) return;
  if (typeof input.focus === "function") {
    input.focus();
  }
  const value = String(input.value || "");
  const prefixLength = /^[01]\./.test(value) ? 2 : 0;
  if (typeof input.setSelectionRange === "function") {
    try {
      input.setSelectionRange(prefixLength, value.length);
      return;
    } catch (_) {
      // ignore selection fallback failures
    }
  }
  if (typeof input.select === "function") {
    input.select();
  }
}
function focusTradeupSimulationModalPrimaryControl() {
  requestAnimationFrame(() => {
    if (
      state.simulationPickerOpen &&
      ui.simulationPickerSearchInput &&
      !ui.simulationPickerSearchInput.disabled
    ) {
      ui.simulationPickerSearchInput.focus();
      if (typeof ui.simulationPickerSearchInput.select === "function") {
        ui.simulationPickerSearchInput.select();
      }
      return;
    }
    if (
      state.simulationModalOpen &&
      state.simulationModalMode === "edit" &&
      ui.simulationCardModalWearInput &&
      !ui.simulationCardModalWearInput.disabled
    ) {
      focusTradeupSimulationWearInput(ui.simulationCardModalWearInput);
      return;
    }
    if (ui.simulationCardModalCancelBtn) {
      ui.simulationCardModalCancelBtn.focus();
    }
  });
}
function bindSimulationCardEvents(preset) {
  const bindRoot = (root, itemType) => {
    if (!root || root.dataset.simulationDelegated === itemType) return;
    root.dataset.simulationDelegated = itemType;
    const activateFromTarget = (rawTarget) => {
      const target = rawTarget && typeof rawTarget.closest === "function" ? rawTarget : null;
      if (!target) return;
      const removeButton = target.closest("[data-simulation-remove-collection]");
      if (removeButton && root.contains(removeButton)) {
        const currentPreset = getActiveTradeupSimulationPreset();
        const collection = String(removeButton.getAttribute("data-simulation-remove-collection") || "").trim();
        if (!currentPreset || !collection) return;
        if (!removeTradeupSimulationCollectionFromPreset(currentPreset.id, collection)) return;
        closeTradeupSimulationItemModal();
        renderSimulationPage();
        return;
      }
      const detailCard = target.closest("[data-simulation-card-role]");
      if (!detailCard || !root.contains(detailCard)) return;
      const currentPreset = getActiveTradeupSimulationPreset();
      if (!currentPreset) return;
      const slotName = normalizeTradeupSimulationSlotName(detailCard.getAttribute("data-simulation-slot-name"));
      const requestedMode = String(detailCard.getAttribute("data-simulation-card-mode") || "").trim() === "readonly"
        ? "readonly"
        : "edit";
      if (slotName) {
        const item = sanitizeTradeupSimulationTargetItem(currentPreset && currentPreset[slotName]);
        if (!item) return;
        if (!openTradeupSimulationItemModal({
          presetId: currentPreset.id,
          slot: slotName,
          itemType,
          item,
          mode: requestedMode
        })) {
          return;
        }
        renderSimulationPage();
        focusTradeupSimulationModalPrimaryControl();
        return;
      }
      const rowIndex = Number(detailCard.getAttribute("data-simulation-row-index"));
      const itemIndex = Number(detailCard.getAttribute("data-simulation-item-index"));
      const rows = itemType === "material"
        ? (Array.isArray(currentPreset && currentPreset.material_rows) ? currentPreset.material_rows : [])
        : (Array.isArray(currentPreset && currentPreset.output_rows) ? currentPreset.output_rows : []);
      const row = rows[rowIndex];
      const lane = itemType === "material" ? "materials" : "outputs";
      const item = Array.isArray(row && row[lane]) ? row[lane][itemIndex] : null;
      const editSlot = resolveTradeupSimulationEditSlot(currentPreset, item, itemType);
      if (!openTradeupSimulationItemModal({
        presetId: currentPreset.id,
        slot: editSlot,
        itemType,
        item,
        mode: requestedMode
      })) {
        return;
      }
      renderSimulationPage();
      focusTradeupSimulationModalPrimaryControl();
    };
    root.addEventListener("click", (evt) => {
      activateFromTarget(evt.target);
    });
    root.addEventListener("keydown", (evt) => {
      if (evt.key !== "Enter" && evt.key !== " ") return;
      const target = evt.target && typeof evt.target.closest === "function" ? evt.target : null;
      if (!target) return;
      if (!target.closest("[data-simulation-card-role]")) return;
      evt.preventDefault();
      activateFromTarget(target);
    });
  };
  bindRoot(ui.simulationOutputLane, "output");
  bindRoot(ui.simulationMaterialLane, "material");
}
function renderTradeupSimulationCardModal() {
  if (!ui.simulationCardModal) return;
  if (!state.simulationModalOpen) {
    ui.simulationCardModal.classList.add("hidden");
    return;
  }
  const preset = getTradeupSimulationModalPreset();
  const item = getTradeupSimulationModalItem();
  if (!preset || !item) {
    closeTradeupSimulationItemModal();
    ui.simulationCardModal.classList.add("hidden");
    return;
  }
  const itemType = String(state.simulationModalItemType || "").trim() === "material" ? "material" : "output";
  const outputKey = String(item && item.basemarkethashname || "").trim();
  const targetKey = String(preset && (preset.cover_output || preset.primary_output) && (preset.cover_output || preset.primary_output).basemarkethashname || "").trim();
  const activeKey = String(getTradeupSimulationActiveAnchorItem(preset) && getTradeupSimulationActiveAnchorItem(preset).basemarkethashname || "").trim();
  const roleMeta = state.simulationModalSlot
    ? getTradeupSimulationRoleMeta(state.simulationModalSlot)
    : {title: itemType === "material" ? "材料" : "产物"};
  const roleLabel = roleMeta.title;
  const editable = state.simulationModalMode === "edit";
  const wearValue = Number.isFinite(Number(preset && preset.active_anchor_abs_wear)) && outputKey === activeKey
    ? Number(preset.active_anchor_abs_wear)
    : Number(item && item.absolute_wear);
  const wearText = Number.isFinite(wearValue) ? formatTradeupSimulationWear(wearValue) : "-";
  const wearDetailText = Number.isFinite(wearValue) ? formatTradeupSimulationModalWear(wearValue) : "-";
  const {artUrl, artStyleAttr} = getTradeupSimulationArtProps(item);
  const minWear = Number(item && item.minfloat);
  const maxWear = Number(item && item.maxfloat);
  const hasBounds = Number.isFinite(minWear) && Number.isFinite(maxWear);
  const actionBadge = editable ? "可精修" : "只读";
  const wearLabel = getTradeupSimulationWearBadgeLabel(item);
  const wearToneClass = getTradeupSimulationWearBadgeToneClass(item);
  if (ui.simulationCardModalTitle) {
    ui.simulationCardModalTitle.textContent = editable
      ? `精修${roleLabel}`
      : itemType === "material"
        ? "查看材料详情"
        : "查看产物详情";
  }
  if (ui.simulationCardModalBody) {
    ui.simulationCardModalBody.innerHTML = `
      <div class="simulation-card-modal-preview">
        <div class="simulation-card-art${artUrl ? " has-image" : ""}"${artStyleAttr}>
          <span class="simulation-card-wear-badge${wearToneClass}">${wearLabel}</span>
          <span class="simulation-card-action-badge">${actionBadge}</span>
          ${artUrl ? "" : '<span class="simulation-card-art-empty">暂无图</span>'}
          <div class="simulation-card-float">绝对磨损 ${wearText}</div>
        </div>
        <div class="simulation-card-content">
          <div class="simulation-card-bar${wearToneClass}" style="--simulation-card-wear-pos:${formatCraftPredictorWearMarkerPosition(wearValue)}"><span style="width:${Math.max(0, Math.min(100, Number.isFinite(wearValue) ? wearValue * 100 : 0))}%"></span></div>
          <div class="simulation-card-name">${String(item && (item.base_name || item.name) || "").trim()}</div>
          <div class="simulation-card-meta">${String(item && item.collection || "").trim()} · ${String(item && item.rarity || "").trim()}</div>
        </div>
      </div>
      <div class="simulation-card-modal-lines">
        <div class="simulation-card-modal-line"><span>当前绝对磨损</span><strong>${wearDetailText}</strong></div>
        <div class="simulation-card-modal-line"><span>所在收藏品</span><strong>${String(item && item.collection || "未标记").trim()}</strong></div>
      </div>
    `;
  }
  if (ui.simulationCardModalField) {
    ui.simulationCardModalField.classList.toggle("hidden", !editable);
  }
  if (ui.simulationCardModalWearInput) {
    ui.simulationCardModalWearInput.disabled = !editable || !!state.simulationLoading;
    ui.simulationCardModalWearInput.value = editable && Number.isFinite(wearValue) ? formatTradeupSimulationModalWear(wearValue) : "";
  }
  if (ui.simulationCardModalWearHint) {
    ui.simulationCardModalWearHint.textContent = editable
      ? (hasBounds
        ? `允许范围：${formatTradeupSimulationModalWear(minWear)} - ${formatTradeupSimulationModalWear(maxWear)}`
        : "请输入新的绝对磨损，保存后会立即重算整组材料。")
      : "";
  }
  if (ui.simulationCardModalReadonlyNote) {
    ui.simulationCardModalReadonlyNote.textContent = itemType === "material"
      ? "当前材料暂不可编辑，仅展示本次推导结果。"
      : "当前产物暂不可编辑，仅展示本次推导结果。";
    ui.simulationCardModalReadonlyNote.classList.toggle("hidden", editable);
  }
  if (ui.simulationCardModalSaveBtn) {
    ui.simulationCardModalSaveBtn.classList.toggle("hidden", !editable);
    ui.simulationCardModalSaveBtn.disabled = !editable || !!state.simulationLoading;
    ui.simulationCardModalSaveBtn.textContent = state.simulationLoading ? "重算中..." : "应用精修";
  }
  if (ui.simulationCardModalCancelBtn) {
    ui.simulationCardModalCancelBtn.textContent = editable ? "取消" : "关闭";
  }
  ui.simulationCardModal.classList.remove("hidden");
}
function renderSimulationOutputGrid(preset) {
  if (!ui.simulationOutputLane) return;
  const sections = [];
  if (!preset) {
    sections.push('<div class="simulation-row-empty">先添加主产物，或先添加主料后再推导候选产物。</div>');
    ui.simulationOutputLane.innerHTML = sections.join("");
    return;
  }
  const selectedOutputs = [
    {slot: "primary_output", item: sanitizeTradeupSimulationTargetItem(preset && preset.primary_output)},
    {slot: "aux_output", item: sanitizeTradeupSimulationTargetItem(preset && preset.aux_output)}
  ].filter((entry) => entry.item);
  const rows = Array.isArray(preset.output_rows) ? preset.output_rows : [];
  if (!rows.length) {
    if (selectedOutputs.length) {
      sections.push(renderSimulationLaneSection(
        "当前已选产物",
        "搜索结果点击后会先写入这里，后续解析结果会继续追加在下方。",
        selectedOutputs.map((entry) => renderSimulationSelectedOutputCard(entry.item, preset, entry.slot)).join(""),
        null,
        "",
        selectedOutputs.length
      ));
    }
    const warningText = Array.isArray(preset.warnings) && preset.warnings[0]
      ? String(preset.warnings[0].message || "").trim()
      : "等待根据当前槽位推导产物组合。";
    if (!selectedOutputs.length || warningText) {
      sections.push(`<div class="simulation-row-empty">${warningText}</div>`);
    }
    ui.simulationOutputLane.innerHTML = sections.join("");
    return;
  }
  sections.push(...rows.map((row, rowIndex) => {
    const outputs = Array.isArray(row && row.outputs) ? row.outputs : [];
    const collection = String(row && row.collection || "").trim() || "目标产物";
    return renderSimulationLaneSection(
      collection,
      `产物 ${outputs.length} 个`,
      outputs.map((entry, itemIndex) => renderSimulationOutputCard(entry, preset, rowIndex, itemIndex)).join(""),
      renderTradeupSimulationLaneMeta(preset, "output", collection, outputs, row),
      renderTradeupSimulationLaneRemoveButton(collection),
      outputs.length
    );
  }));
  ui.simulationOutputLane.innerHTML = sections.join("");
}
function renderSimulationMaterialGrid(preset) {
  if (!ui.simulationMaterialLane) return;
  const sections = [];
  if (!preset || !(preset.cover_output || preset.primary_output)) {
    sections.push('<div class="simulation-row-empty">先添加主料或辅料，右侧会继续显示当前联动材料。</div>');
    ui.simulationMaterialLane.innerHTML = sections.join("");
    return;
  }
  const selectedMaterials = [
    {slot: "main_material", item: sanitizeTradeupSimulationTargetItem(preset && preset.main_material)},
    {slot: "aux_material", item: sanitizeTradeupSimulationTargetItem(preset && preset.aux_material)}
  ].filter((entry) => entry.item);
  const rows = Array.isArray(preset.material_rows) ? preset.material_rows : [];
  if (!rows.length) {
    if (selectedMaterials.length) {
      sections.push(renderSimulationLaneSection(
        "当前已选材料",
        "搜索结果点击后会先写入这里，联动材料推导完成后会继续追加。",
        selectedMaterials.map((entry) => renderSimulationSelectedMaterialCard(entry.item, preset, entry.slot)).join(""),
        null,
        "",
        selectedMaterials.length
      ));
    }
    const warningText = Array.isArray(preset.warnings) && preset.warnings[0]
      ? String(preset.warnings[0].message || "").trim()
      : "等待根据当前锚定物品生成材料。";
    if (!selectedMaterials.length || warningText) {
      sections.push(`<div class="simulation-row-empty">${warningText}</div>`);
    }
    ui.simulationMaterialLane.innerHTML = sections.join("");
    return;
  }
  sections.push(...rows.map((row, rowIndex) => {
    const materials = Array.isArray(row && row.materials) ? row.materials : [];
    const collection = String(row && row.collection || "").trim() || "联动材料";
    return renderSimulationLaneSection(
      collection,
      `材料 ${materials.length} 个`,
      materials.map((entry, itemIndex) => renderSimulationMaterialCard(entry, rowIndex, itemIndex)).join(""),
      renderTradeupSimulationLaneMeta(preset, "material", collection, materials, row),
      renderTradeupSimulationLaneRemoveButton(collection),
      materials.length
    );
  }));
  ui.simulationMaterialLane.innerHTML = sections.join("");
}
function renderSimulationWorkspace(preset) {
  if (!ui.simulationWorkspace) return;
  const showWorkspace = state.simulationViewMode !== "saved";
  ui.simulationWorkspace.classList.toggle("hidden", !showWorkspace);
  if (!showWorkspace) return;
  renderSimulationRolePanel(preset);
  renderSimulationOutputGrid(preset);
  renderSimulationMaterialGrid(preset);
  bindSimulationCardEvents(preset);
}
function renderTradeupSimulationPickerModal() {
  if (!ui.simulationPickerModal) return;
  ui.simulationPickerModal.classList.toggle("hidden", !state.simulationPickerOpen);
  const context = getTradeupSimulationPickerContext();
  const results = Array.isArray(state.simulationPickerResults) ? state.simulationPickerResults : [];
  const queryText = String(state.simulationPickerQuery || "").trim();
  const errorText = String(state.simulationPickerError || "").trim();
  if (ui.simulationPickerTitle) {
    ui.simulationPickerTitle.textContent = String(state.simulationPickerTitle || "选择物品").trim() || "选择物品";
  }
  if (ui.simulationPickerRoleBadge) {
    ui.simulationPickerRoleBadge.textContent = context.roleText;
  }
  if (ui.simulationPickerHint) {
    ui.simulationPickerHint.textContent = context.hintText;
  }
  if (ui.simulationPickerMeta) {
    ui.simulationPickerMeta.textContent = state.simulationSearchLoading
      ? `正在搜索${context.roleText}候选...`
      : errorText
        ? `搜索失败：${errorText}`
        : queryText
          ? `关键字“${queryText}”共匹配 ${results.length} 个结果`
          : "支持按物品名称或收藏品搜索。";
  }
  if (ui.simulationPickerSearchInput) {
    ui.simulationPickerSearchInput.value = queryText;
  }
  if (ui.simulationPickerSearchBtn) {
    ui.simulationPickerSearchBtn.disabled = !!state.simulationSearchLoading;
    ui.simulationPickerSearchBtn.textContent = state.simulationSearchLoading ? "搜索中..." : "搜索";
  }
  renderTradeupSimulationPickerResults();
}
function renderSimulationPage() {
  if (!ui.simulationPage) return;
  const preset = getActiveTradeupSimulationPreset();
  renderSimulationModeTabs();
  renderSimulationWorkspaceActionsBar(preset);
  renderSimulationSavedPresets();
  renderSimulationWorkspace(preset);
  renderTradeupSimulationPickerModal();
  renderTradeupSimulationCardModal();
}
function renderCraftPage() {
  if (!ui.craftPage) return;
  syncCurrentCraftAssistRuntimeState();
  const guestMode = isGuestWorkspaceActive();
  const connected = !guestMode && isCurrentAccountConnected();
  if (ui.craftConnectText) {
    ui.craftConnectText.textContent = `连接状态：${guestMode ? "未登录" : (connected ? "已连接" : "未连接")}`;
    setConnectionStatusTone(ui.craftConnectText, connected);
  }
  if (String(state.currentAccountUsername || "").trim() && String(state.snapshotPath || "").trim()) {
    void refreshCraftCandidateRows();
  }
  const candidateStats = state.craftCandidateStats && typeof state.craftCandidateStats === "object"
    ? state.craftCandidateStats
    : null;
  if (ui.craftSelectionTitle) {
    if (state.craftUseComponentItems) {
      // freeSlots here means the current budget of component items that can
      // actually be withdrawn under the shared component-mode rules. It is not
      // the same thing as the raw "1000 - visible main inventory items" count.
      const freeSlots = Math.max(0, Number(candidateStats && candidateStats.main_free_slots != null ? candidateStats.main_free_slots : estimateMainInventoryFreeSlots().freeSlots) || 0);
      const selectedComponentCount = Math.max(0, Number(candidateStats && candidateStats.selected_component_count != null ? candidateStats.selected_component_count : countSelectedComponentCraftItems()) || 0);
      ui.craftSelectionTitle.textContent = `全库存可炼金物品（组件已选 ${selectedComponentCount} / 实际可从组件中取出 ${freeSlots}）`;
    } else {
      ui.craftSelectionTitle.textContent = "主库存可炼金物品";
    }
  }
  syncCraftSettingsControls();
  setCraftSettingsPanelOpen(state.craftSettingsOpen);
  updateCraftActionLayout();
  if (connected) {
    reconcileCraftQueueWithInventory();
  }
  ensureActiveCraftRecipe({createIfMissing: false});
  if (typeof syncCraftPredictorContextWithActiveRecipe === "function") {
    syncCraftPredictorContextWithActiveRecipe();
  }

  const candidates = getCraftCandidates();
  const selectedRows = getCraftSelectedRows();
  const recipeInfo = getTradeUpRecipeFromRows(selectedRows);
  const queueCount = state.craftRecipeQueue.length;
  const pendingQueueCount = getCraftQueuePendingCount();
  const executableCount = getCraftExecutableEntries().length;
  const topActionsLocked = isCraftRecipeEditLocked();

  if (ui.craftSelectedText) ui.craftSelectedText.textContent = `当前槽位：${selectedRows.length}/10，可执行：${executableCount}组`;
  if (ui.craftRecipeText) ui.craftRecipeText.textContent = recipeInfo.text;
  syncCraftStatusDom();
  renderCraftQueue();
  if (ui.craftAddRecipeBtn) {
    ui.craftAddRecipeBtn.disabled = topActionsLocked || pendingQueueCount >= 50;
  }
  if (ui.craftExecuteQueueBtn) {
    const executeLabel = state.craftBusy ? (state.craftPauseRequested ? "暂停中..." : "暂停执行") : (state.craftPaused && executableCount > 0 ? "继续执行" : "执行配方");
    ui.craftExecuteQueueBtn.disabled = state.craftBusy
      ? !!state.craftPauseRequested
      : (topActionsLocked || executableCount <= 0);
    ui.craftExecuteQueueBtn.title = executeLabel;
    ui.craftExecuteQueueBtn.setAttribute("aria-label", executeLabel);
    ui.craftExecuteQueueBtn.classList.toggle("is-pausing", !!state.craftBusy);
    ui.craftExecuteQueueBtn.classList.toggle("is-paused", !state.craftBusy && !!state.craftPaused && executableCount > 0);
    const executeGlyph = ui.craftExecuteQueueBtn.querySelector("span");
    if (executeGlyph) {
      executeGlyph.classList.remove("craft-play-glyph", "craft-pause-glyph");
      executeGlyph.classList.add(state.craftBusy ? "craft-pause-glyph" : "craft-play-glyph");
    }
  }
  if (ui.craftClearQueueBtn) {
    ui.craftClearQueueBtn.disabled = topActionsLocked || queueCount <= 0;
  }
  if (ui.craftAssistToggleBtn) {
    ui.craftAssistToggleBtn.disabled = topActionsLocked;
  }
  renderCraftAssistPanel();

  if (!state.craftStatusText) {
    if (guestMode) setCraftStatus("当前为访客预览态，可浏览样例布局；登录后可编辑配方、辅助选材并执行真实炼金操作");
    else if (!connected && executableCount > 0) setCraftStatus("当前账号未连接，点击执行将自动连接账号");
    else if (!connected) setCraftStatus("请先连接并刷新库存");
    else if (state.craftCandidateLoading && !candidates.length) setCraftStatus("候选物品同步中...");
    else if (!candidates.length) {
      setCraftStatus(
        state.craftUseComponentItems
          ? "全库存中暂无可炼金物品，或当前实际可从组件中取出的数量已不足以继续选择组件物品"
          : "主库存中没有符合炼金规则的物品"
      );
    }
    else if (selectedRows.length >= 10 && recipeInfo.ok) setCraftStatus("当前配方已满10件，可执行，或先新增配方继续填充");
    else if (pendingQueueCount > 0) setCraftStatus(`当前有 ${pendingQueueCount} 组配方槽位，点击左侧物品会填充到当前高亮槽位`);
    else if (queueCount > 0) setCraftStatus("本轮产物已回写到预览，可继续添加新配方");
    else if (selectedRows.length !== 10) setCraftStatus("点击上方加号创建配方，或点击闪电图标进行快捷选材");
    else if (!recipeInfo.ok) setCraftStatus(recipeInfo.reason || "所选物品不满足炼金规则", true);
    else setCraftStatus("已满足炼金条件，可添加配方");
  } else if (!state.craftStatusError && recipeInfo.ok && connected && !state.craftBusy) {
    // keep external success message until next change; no-op
  }

  renderCraftGrouped(candidates);
  renderCraftExecutionOverlay();
  if (typeof updateCraftPredictorHandleGeometry === "function") updateCraftPredictorHandleGeometry();
}
async function ensureCraftConnectedForExecution() {
  const username = String(
    state.currentAccountUsername ||
    (ui.craftAccountSelect && ui.craftAccountSelect.value) ||
    (ui.accountSelect && ui.accountSelect.value) ||
    ""
  ).trim();
  if (!username) {
    setCraftStatus("请先选用一个账号", true);
    return false;
  }
  if (isCurrentAccountConnected()) return true;
  const onProgress = createConnectProgressReporter();
  onProgress({percent: 10, detail: "正在准备连接账号..."});
  try {
    const result = await doRefresh({
      usernameOverride: username,
      force: true,
      silentRateLimit: true,
      silentInfo: true,
      onProgress
    });
    if (result && result.ok && isCurrentAccountConnected()) {
      onProgress({percent: 100, detail: "账号已连接，准备执行配方..."});
      return true;
    }
    if (!(result && result.message)) {
      setCraftStatus("连接账号失败，请先连接并刷新库存", true);
    } else {
      setCraftStatus(result.message, true);
    }
    return false;
  } finally {
    clearCraftExecutionOverlayState({owner: "connect_flow"});
  }
}
async function ensureConnectedForComponentDeposit() {
  const username = String(
    state.currentAccountUsername ||
    (ui.accountPageSelect && ui.accountPageSelect.value) ||
    (ui.accountSelect && ui.accountSelect.value) ||
    (ui.craftAccountSelect && ui.craftAccountSelect.value) ||
    ""
  ).trim();
  if (!username) {
    setSummary("请先选用一个账号");
    return false;
  }
  if (isCurrentAccountConnected()) return true;
  const keepSelectedIds = new Set(state.selectedComponentItemIds);
  const result = await refreshWithConnectionOverlay({
    preferCraft: false,
    usernameOverride: username,
    force: true,
    silentRateLimit: true,
    silentInfo: true,
    keepSelectedIds,
    forceOverlay: true
  });
  if (result && result.ok && isCurrentAccountConnected()) {
    return true;
  }
  if (result && result.message) {
    setSummary(result.message);
  } else {
    setSummary("自动连接失败，请先连接并刷新库存");
  }
  return false;
}
async function ensureConnectedForComponentWithdraw() {
  const username = String(
    state.currentAccountUsername ||
    (ui.accountPageSelect && ui.accountPageSelect.value) ||
    (ui.accountSelect && ui.accountSelect.value) ||
    (ui.craftAccountSelect && ui.craftAccountSelect.value) ||
    ""
  ).trim();
  if (!username) {
    setSummary("请先选用一个账号");
    return false;
  }
  if (isCurrentAccountConnected()) return true;
  const keepSelectedIds = new Set(state.selectedComponentItemIds);
  const result = await refreshWithConnectionOverlay({
    preferCraft: false,
    usernameOverride: username,
    force: true,
    silentRateLimit: true,
    silentInfo: true,
    keepSelectedIds,
    forceOverlay: true
  });
  if (result && result.ok && isCurrentAccountConnected()) {
    return true;
  }
  if (result && result.message) {
    setSummary(result.message);
  } else {
    setSummary("自动连接失败，请先连接并刷新库存");
  }
  return false;
}
async function runCraftTradeUpQueue() {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可执行真实炼金配方。",
    view: "login"
  }) === false) {
    return false;
  }
  const username = String(state.currentAccountUsername || "").trim();
  if (!username) {
    setCraftStatus("请先选用一个账号", true);
    return;
  }
  const connectedOk = await ensureCraftConnectedForExecution();
  if (!connectedOk) {
    return;
  }
  reconcileCraftQueueWithInventory();
  const queue = Array.isArray(state.craftRecipeQueue) ? state.craftRecipeQueue : [];
  const pendingIndexes = [];
  const pendingEntries = [];
  for (let i = 0; i < queue.length; i += 1) {
    const entry = queue[i];
    const status = String(entry && entry.status || "").trim();
    const itemIds = normalizeCraftRecipeItemIds(entry && entry.item_ids);
    if (status === "done" || status === "prepare_failed" || itemIds.length !== 10) {
      continue;
    }
    entry.item_ids = itemIds;
    pendingIndexes.push(i);
    pendingEntries.push(entry);
  }
  if (!pendingEntries.length) {
    setCraftStatus("暂无可执行配方：每组需凑满10件", true);
    return;
  }
  const dedup = new Set();
  for (const entry of pendingEntries) {
    for (const id of normalizeCraftRecipeItemIds(entry.item_ids)) {
      const key = String(id || "").trim();
      if (!key) continue;
      if (dedup.has(key)) {
        setCraftStatus("配方预览存在重复物品，请调整后再执行", true);
        return;
      }
      dedup.add(key);
    }
  }
  const pendingRecipes = pendingEntries.map((entry, idx) => ({
    ...buildCraftApiRecipePayload({
      ...entry,
      queue_index: Number(pendingIndexes[idx])
    })
  }));
  if (!pendingRecipes.length) {
    setCraftStatus("配方预览为空，请先添加配方", true);
    return;
  }
  const ok = await openConfirmModal({
    title: "确认执行汰换",
    message: "您确认要执行汰换吗？",
    confirmText: "确认执行",
    cancelText: "取消"
  });
  if (!ok) {
    setCraftStatus("已取消执行");
    return;
  }

  const allRowsById = buildRowsByAssetId(getAllInventoryCraftableRows({rows: state.rows, includeComponentItems: true}));
  const componentFlow = pendingEntries.some((entry) => craftRecipeEntryUsesComponentItems(entry, allRowsById));
  const applyServerRows = (payload) => {
    if (!(payload && Array.isArray(payload.rows))) return;
    const keepSelectedIds = new Set(state.selectedComponentItemIds);
    setRows(
      payload.rows,
      payload.component || {summary_map: {}, item_map: {}},
      String(payload.snapshot_path || "").trim(),
      {keepSelectedIds}
    );
    if (String(payload.fetch_time || "").trim()) {
      state.fetchTime = String(payload.fetch_time).trim();
      syncInventoryTop();
    }
  };

  let completedCount = 0;
  let skippedCount = 0;
  let currentRecipePos = -1;
  let currentRecipeRequest = null;
  let currentRecipeTotal = pendingRecipes.length;
  let componentPrepareFinished = false;
  let lastDoneMsg = "";
  let remainingCount = 0;
  let paused = false;
  state.craftPauseRequested = false;
  state.craftPaused = false;
  if (componentFlow) {
    setCraftExecutionOverlayState({
      owner: "craft_flow",
      enabled: true,
      visible: true,
      mode: "component_prepare",
      title: `正在准备组件并执行 ${pendingRecipes.length} 组配方`,
      detail: "正在等待后端进度..."
    });
  } else {
    clearCraftExecutionOverlayState({owner: "craft_flow"});
  }
  state.craftBusy = true;
  setCraftStatus(componentFlow ? `正在准备组件并执行 ${pendingRecipes.length} 组配方...` : `正在准备执行 ${pendingRecipes.length} 组配方...`);
  renderCraftPage();
  try {
    if (componentFlow) {
      const data = await api("/api/craft/tradeup-with-components", {
        method: "POST",
        body: JSON.stringify({
          username,
          allow_cooling: !!state.craftIncludeCooling,
          prepare_only: true,
          use_component_items: true,
          recipes: pendingRecipes
        })
      });
      applyServerRows(data);
      const prepareResults = Array.isArray(data.prepare_results) ? data.prepare_results : [];
      applyCraftPrepareResultsToQueue({prepareResults});
      skippedCount = prepareResults.filter((entry) => String(entry && entry.status || "").trim() === "prepare_failed").length;
      componentPrepareFinished = true;
      const readyRecipes = prepareResults.filter((entry) => String(entry && entry.prepare_status || "").trim() === "ready");
      if (!readyRecipes.length) {
        clearCraftStatus();
        lastDoneMsg = String(data.message || "").trim() || "组件取料完成";
        setCraftStatus(`${lastDoneMsg}${skippedCount > 0 ? `，跳过${skippedCount}组` : ""}`);
        setSummary(lastDoneMsg);
        return;
      }
      currentRecipeTotal = readyRecipes.length;
      for (let i = 0; i < readyRecipes.length; i += 1) {
        currentRecipePos = i;
        currentRecipeRequest = buildCraftApiRecipePayload(readyRecipes[i]);
        const req = currentRecipeRequest;
        setCraftExecutionOverlayState({
          owner: "craft_flow",
          enabled: true,
          visible: true,
          title: `正在执行第 ${i + 1}/${readyRecipes.length} 组配方`,
          detail: `已完成 ${completedCount}/${readyRecipes.length} 组`
        });
        setCraftStatus(`正在执行第 ${i + 1}/${readyRecipes.length} 组配方...`);
        const data = await api("/api/craft/tradeup", {
          method: "POST",
          body: JSON.stringify({
            username,
            allow_cooling: !!state.craftIncludeCooling,
            use_component_items: false,
            recipes: [buildCraftApiRecipePayload(req)]
          })
        });
        const rows = Array.isArray(data.rows) ? data.rows : state.rows;
        applyServerRows(data);
        const stepList = Array.isArray(data.steps) && data.steps.length
          ? data.steps
          : [{
            spent_ids: [...req.item_ids],
            gained_ids: Array.isArray(data.gained_ids) ? data.gained_ids : [],
            missing_gained_ids: []
          }];
        applyCraftStepResultsToQueue({
          steps: [stepList[0]],
          pendingIndexes: [req.queue_index],
          rows
        });
        completedCount += 1;
        lastDoneMsg = String(data.message || "").trim();
        renderCraftPage();
        if (state.craftPauseRequested && i + 1 < readyRecipes.length) {
          paused = true;
          remainingCount = readyRecipes.length - i - 1;
          break;
        }
      }
    } else {
      currentRecipeTotal = pendingRecipes.length;
      for (let i = 0; i < pendingRecipes.length; i += 1) {
        currentRecipePos = i;
        currentRecipeRequest = pendingRecipes[i];
        const req = currentRecipeRequest;
        clearCraftExecutionOverlayState({owner: "craft_flow"});
        setCraftStatus(`正在串行执行第 ${i + 1}/${pendingRecipes.length} 组配方...`);
        const data = await api("/api/craft/tradeup", {
          method: "POST",
          body: JSON.stringify({
            username,
            allow_cooling: !!state.craftIncludeCooling,
            use_component_items: false,
            recipes: [buildCraftApiRecipePayload(req)]
          })
        });

        const rows = Array.isArray(data.rows) ? data.rows : state.rows;
        applyServerRows(data);
        const stepList = Array.isArray(data.steps) && data.steps.length
          ? data.steps
          : [{
            spent_ids: [...req.item_ids],
            gained_ids: Array.isArray(data.gained_ids) ? data.gained_ids : [],
            missing_gained_ids: []
          }];
        applyCraftStepResultsToQueue({
          steps: [stepList[0]],
          pendingIndexes: [req.queue_index],
          rows
        });
        completedCount += 1;
        lastDoneMsg = String(data.message || "").trim();
        renderCraftPage();
        if (state.craftPauseRequested && i + 1 < pendingRecipes.length) {
          paused = true;
          remainingCount = pendingRecipes.length - i - 1;
          break;
        }
      }
    }

    if (paused) {
      state.craftPaused = true;
      state.craftPauseRequested = false;
      clearCraftStatus();
      setCraftStatus(`已暂停，剩余${remainingCount}组配方未提交`);
      return;
    }

    state.craftPauseRequested = false;
    state.craftPaused = false;
    clearCraftStatus();
    const doneMsg = lastDoneMsg || "汰换成功";
    setCraftStatus(`${doneMsg}，已完成${completedCount}组配方${skippedCount > 0 ? `，跳过${skippedCount}组` : ""}`);
    setSummary(doneMsg);
  } catch (err) {
    const payload = err && err.data && typeof err.data === "object" ? err.data : null;
    const currentReq = currentRecipeRequest;
    if (payload) {
      applyServerRows(payload);
    }

    if (componentFlow && !componentPrepareFinished && payload) {
      const prepareResults = Array.isArray(payload.prepare_results) ? payload.prepare_results : [];
      if (prepareResults.length) {
        applyCraftPrepareResultsToQueue({prepareResults});
        skippedCount += prepareResults.filter((result) => String(result && result.status || "").trim() === "prepare_failed").length;
      }
      const completedSteps = Array.isArray(payload.steps) && payload.steps.length
        ? payload.steps
        : (Array.isArray(payload.completed_steps) ? payload.completed_steps : []);
      if (completedSteps.length) {
        applyCraftStepResultsToQueue({
          steps: completedSteps,
          pendingIndexes: completedSteps.map((step) => Number(step && step.queue_index)),
          rows: Array.isArray(payload.rows) ? payload.rows : state.rows
        });
        syncCraftSelectedIdsFromActiveRecipe();
        completedCount = completedSteps.length;
      }
      if (payload.paused) {
        state.craftPaused = true;
        state.craftPauseRequested = false;
        clearCraftStatus();
        const pausedMessage = String(payload && payload.message || "").trim() || `已暂停，剩余${Math.max(0, Number(payload && payload.remaining_recipe_count) || 0)}组配方待继续`;
        setCraftStatus(pausedMessage);
        setSummary(pausedMessage);
        return;
      }
      const msg = `${payload && payload.partial ? "炼金中断" : "炼金失败"}：已完成${completedCount}组${skippedCount > 0 ? `，跳过${skippedCount}组` : ""}，${err.message}`;
      setCraftStatus(msg, true);
      setSummary(msg);
    } else if (payload && payload.partial) {
      const completedSteps = Array.isArray(payload.completed_steps) ? payload.completed_steps : [];
      if (completedSteps.length && currentReq && Number.isFinite(currentReq.queue_index)) {
        applyCraftStepResultsToQueue({
          steps: [completedSteps[0]],
          pendingIndexes: [currentReq.queue_index],
          rows: Array.isArray(payload.rows) ? payload.rows : state.rows
        });
        syncCraftSelectedIdsFromActiveRecipe();
        completedCount += 1;
      }
      const failedAt = currentRecipePos >= 0 ? (currentRecipePos + 1) : Math.max(1, completedCount + 1);
      const msg = `汰换中断：已完成${completedCount}组，失败于第${failedAt}组，${err.message}`;
      setCraftStatus(msg, true);
      setSummary(msg);
    } else {
      const failedAt = currentRecipePos >= 0 ? (currentRecipePos + 1) : Math.max(1, completedCount + 1);
      const msg = `汰换失败：已完成${completedCount}组，失败于第${failedAt}组，${err.message}`;
      setCraftStatus(msg, true);
      setSummary(msg);
    }
    state.craftPauseRequested = false;
    state.craftPaused = false;
  } finally {
    state.craftBusy = false;
    clearCraftExecutionOverlayState({owner: "craft_flow"});
    renderCraftPage();
  }
}
function setFilterPanel(panelName) {
  const panel = panelName === "rarity" || panelName === "collection" ? panelName : "wear";
  state.filterPanel = panel;
  const navMap = {
    wear: ui.filterNavWear,
    rarity: ui.filterNavRarity,
    collection: ui.filterNavCollection
  };
  const panelMap = {
    wear: ui.filterPanelWear,
    rarity: ui.filterPanelRarity,
    collection: ui.filterPanelCollection
  };
  for (const [key, node] of Object.entries(navMap)) {
    node.classList.toggle("active", key === panel);
  }
  for (const [key, node] of Object.entries(panelMap)) {
    node.classList.toggle("hidden", key !== panel);
  }
}
function placeFilterDrawer() {
  if (ui.filterDrawer.classList.contains("hidden")) return;
  const pageRect = ui.inventoryPage.getBoundingClientRect();
  const btnRect = ui.toggleFilterBtn.getBoundingClientRect();
  const drawer = ui.filterDrawer;
  const gap = 8;
  const top = Math.max(0, btnRect.top - pageRect.top);
  drawer.style.top = `${top}px`;
  const preferredLeft = btnRect.right - pageRect.left + gap;
  const maxLeft = Math.max(0, pageRect.width - drawer.offsetWidth - 8);
  drawer.style.left = `${Math.max(0, Math.min(preferredLeft, maxLeft))}px`;
}
function updateFilterDrawer() {
  const open = !ui.filterDrawer.classList.contains("hidden");
  ui.toggleFilterBtn.classList.toggle("active", open);
  ui.toggleFilterBtn.setAttribute("aria-pressed", open ? "true" : "false");
  ui.toggleFilterBtn.setAttribute("aria-label", open ? "收起筛选" : "展开筛选");
  ui.toggleFilterBtn.title = open ? "收起筛选" : "展开筛选";
  if (open) {
    setFilterPanel(state.filterPanel || "wear");
    placeFilterDrawer();
  }
}
function toggleFilterDrawer() { ui.filterDrawer.classList.toggle("hidden"); updateFilterDrawer(); }
function initWearOptions() { const values = ["", ...Array.from({length: 101}, (_, i) => (i / 100).toFixed(2))]; for (const sel of [ui.wearMin, ui.wearMax]) { sel.replaceChildren(); for (const v of values) { const o = document.createElement("option"); o.value = v; o.textContent = v; sel.append(o); } } }
const parseWearSelectValue = (v) => { const t = String(v || "").trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
function validateWearFilter({changedSide = null, autoFix = false} = {}) { let minValue = parseWearSelectValue(ui.wearMin.value), maxValue = parseWearSelectValue(ui.wearMax.value); if (minValue !== null && maxValue !== null && maxValue <= minValue) { if (!autoFix) { ui.wearHint.textContent = "磨损后项必须大于前项"; return {minValue: null, maxValue: null, valid: false}; } if (changedSide === "max") { let fixedMin = Math.max(0, Math.round((maxValue - 0.01) * 100) / 100); if (fixedMin >= maxValue) { maxValue = 0.01; fixedMin = 0; } minValue = fixedMin; ui.wearMin.value = minValue.toFixed(2); ui.wearMax.value = maxValue.toFixed(2); } else { let fixedMax = Math.min(1, Math.round((minValue + 0.01) * 100) / 100); if (fixedMax <= minValue) { minValue = 0.99; fixedMax = 1; } maxValue = fixedMax; ui.wearMin.value = minValue.toFixed(2); ui.wearMax.value = maxValue.toFixed(2); } } ui.wearHint.textContent = ""; state.wearMin = minValue; state.wearMax = maxValue; return {minValue, maxValue, valid: true}; }
function onWearInputChanged(changedSide) {
  const minValue = parseWearSelectValue(ui.wearMin.value);
  const maxValue = parseWearSelectValue(ui.wearMax.value);
  if (changedSide === "min" && minValue !== null && maxValue === null) {
    let fixedMax = Math.min(1, Math.round((minValue + 0.01) * 100) / 100);
    if (fixedMax <= minValue) {
      fixedMax = 1;
      ui.wearMin.value = "0.99";
    }
    ui.wearMax.value = fixedMax.toFixed(2);
  }
  if (changedSide === "max" && maxValue !== null && minValue === null) {
    let fixedMin = Math.max(0, Math.round((maxValue - 0.01) * 100) / 100);
    if (fixedMin >= maxValue) {
      fixedMin = 0;
      ui.wearMax.value = "0.01";
    }
    ui.wearMin.value = fixedMin.toFixed(2);
  }
  validateWearFilter({changedSide, autoFix: true});
  resetRenderWindow();
  render();
}
function refreshSortArrowStyles(scope = null) {
  const root = scope && typeof scope.querySelector === "function" ? scope : null;
  if (root) {
    const wearUp = root.querySelector("[data-sort-key=\"wear\"][data-sort-dir=\"asc\"]");
    const wearDown = root.querySelector("[data-sort-key=\"wear\"][data-sort-dir=\"desc\"]");
    const rarityUp = root.querySelector("[data-sort-key=\"rarity\"][data-sort-dir=\"asc\"]");
    const rarityDown = root.querySelector("[data-sort-key=\"rarity\"][data-sort-dir=\"desc\"]");
    const quantityUp = root.querySelector("[data-sort-key=\"quantity\"][data-sort-dir=\"asc\"]");
    const quantityDown = root.querySelector("[data-sort-key=\"quantity\"][data-sort-dir=\"desc\"]");
    const collectionUp = root.querySelector("[data-sort-key=\"collection\"][data-sort-dir=\"asc\"]");
    const collectionDown = root.querySelector("[data-sort-key=\"collection\"][data-sort-dir=\"desc\"]");
    if (wearUp) wearUp.classList.toggle("active", state.wearSort === "asc");
    if (wearDown) wearDown.classList.toggle("active", state.wearSort === "desc");
    if (rarityUp) rarityUp.classList.toggle("active", state.raritySort === "asc");
    if (rarityDown) rarityDown.classList.toggle("active", state.raritySort === "desc");
    if (quantityUp) quantityUp.classList.toggle("active", state.quantitySort === "asc");
    if (quantityDown) quantityDown.classList.toggle("active", state.quantitySort === "desc");
    if (collectionUp) collectionUp.classList.toggle("active", state.collectionSort === "asc");
    if (collectionDown) collectionDown.classList.toggle("active", state.collectionSort === "desc");
  }
  if (ui.wearSortUp) ui.wearSortUp.classList.toggle("active", state.wearSort === "asc");
  if (ui.wearSortDown) ui.wearSortDown.classList.toggle("active", state.wearSort === "desc");
  if (ui.raritySortUp) ui.raritySortUp.classList.toggle("active", state.raritySort === "asc");
  if (ui.raritySortDown) ui.raritySortDown.classList.toggle("active", state.raritySort === "desc");
}
function syncModeButtons() {
  const mode = state.mode === "cards" ? "cards" : "grouped";
  const label = mode === "cards" ? "网格视图" : "列表视图";
  const nextModeLabel = mode === "cards" ? "列表视图" : "网格视图";
  ui.modeToggleBtn.classList.add("active");
  ui.modeToggleBtn.setAttribute("aria-pressed", "true");
  ui.modeToggleBtn.setAttribute("aria-label", `当前${label}，点击切换到${nextModeLabel}`);
  ui.modeToggleBtn.title = `当前${label}，点击切换到${nextModeLabel}`;
  ui.modeToggleGlyph.classList.remove("mode-glyph-grid", "mode-glyph-list");
  ui.modeToggleGlyph.classList.add(mode === "cards" ? "mode-glyph-grid" : "mode-glyph-list");
}
function updateRaritySummary() { const total = RARITY_VALUES.length, selected = state.raritySelected.size; if (selected <= 0 || selected >= total) { ui.raritySummary.textContent = "全部"; return; } if (selected === 1) { ui.raritySummary.textContent = [...state.raritySelected][0]; return; } ui.raritySummary.textContent = `已选${selected}项`; }
function refreshRarityMenu() {
  state.raritySelected = new Set([...state.raritySelected].filter((x) => RARITY_VALUES.includes(x)));
  ui.rarityMenu.replaceChildren();
  for (const label of RARITY_VALUES) {
    const w = document.createElement("label");
    w.className = "menu-item";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = state.raritySelected.has(label);
    box.onchange = () => {
      box.checked ? state.raritySelected.add(label) : state.raritySelected.delete(label);
      updateRaritySummary();
      resetRenderWindow();
      render();
    };
    w.append(box, document.createTextNode(label));
    ui.rarityMenu.append(w);
  }
  updateRaritySummary();
}
function updateCollectionSummary() { const total = state.collectionValues.length, selected = state.collectionSelected.size; if (selected <= 0 || selected >= total) { ui.collectionSummary.textContent = "全部"; return; } if (selected === 1) { ui.collectionSummary.textContent = [...state.collectionSelected][0]; return; } ui.collectionSummary.textContent = `已选${selected}项`; }
function refreshCollectionMenu(rows, {force = false, sourceKey = ""} = {}) {
  if (!force && sourceKey && sourceKey === state.collectionSourceKey) {
    updateCollectionSummary();
    return;
  }
  const values = Array.from(new Set(rows.map((x) => collectionName(x)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const key = values.join("||");
  if (!force && key === state.collectionMenuKey) {
    state.collectionSourceKey = sourceKey || state.collectionSourceKey;
    updateCollectionSummary();
    return;
  }
  state.collectionMenuKey = key;
  state.collectionSourceKey = sourceKey || state.collectionSourceKey;
  state.collectionValues = values;
  state.collectionSelected = new Set([...state.collectionSelected].filter((x) => values.includes(x)));
  ui.collectionMenu.replaceChildren();
  for (const label of values) {
    const w = document.createElement("label");
    w.className = "menu-item";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = state.collectionSelected.has(label);
    box.onchange = () => {
      box.checked ? state.collectionSelected.add(label) : state.collectionSelected.delete(label);
      updateCollectionSummary();
      resetRenderWindow();
      render();
    };
    w.append(box, document.createTextNode(label));
    ui.collectionMenu.append(w);
  }
  updateCollectionSummary();
}
function refreshComponentControls() {
  const summaries = Object.values(state.component.summary_map || {}).sort((a, b) => {
    const an = String(a.name || "").toLowerCase();
    const bn = String(b.name || "").toLowerCase();
    if (an !== bn) return an.localeCompare(bn);
    return assetIdNumber(a) - assetIdNumber(b);
  });
  ui.componentSelect.replaceChildren();
  if (summaries.length) {
    const viewAllOpt = document.createElement("option");
    viewAllOpt.value = "__ALL__";
    viewAllOpt.textContent = "查看全部库存";
    ui.componentSelect.append(viewAllOpt);
  }
  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = "主库存";
  ui.componentSelect.append(allOpt);
  for (const s of summaries) {
    const id = String(s.component_id || "").trim();
    if (!id) continue;
    const expected = Number(s.expected_count || 0);
    const capacity = Math.max(STORAGE_UNIT_CAPACITY, expected);
    const loaded = Number(s.loaded_count || 0);
    const tail = `${loaded}/${capacity}`;
    const o = document.createElement("option");
    o.value = id;
    o.textContent = `${compactComponentName(s.name)} [${tail}]`;
    ui.componentSelect.append(o);
  }
  if (!summaries.length) {
    ui.componentSelect.disabled = true;
    ui.componentSelect.value = "";
    state.selectedComponentId = "";
    state.selectedComponentItemIds.clear();
    updateMainInventoryAvailableHint();
    if (ui.componentHint) {
      ui.componentHint.textContent = "0/1000";
      ui.componentHint.title = "主库存可见 0/1000";
    }
    state.showComponentItems = false;
    if (ui.showComponentItems) ui.showComponentItems.checked = false;
    if (ui.showComponentItemsWrap) ui.showComponentItemsWrap.classList.add("hidden");
    renderTaskQueueControls();
    syncComponentActionState();
    return;
  }
  ui.componentSelect.disabled = false;
  state.showComponentItems = false;
  if (ui.showComponentItems) ui.showComponentItems.checked = false;
  if (state.selectedComponentId && state.selectedComponentId !== "__ALL__" && !Object.prototype.hasOwnProperty.call(state.component.summary_map, state.selectedComponentId)) {
    state.selectedComponentId = "";
    state.selectedComponentItemIds.clear();
  }
  ui.componentSelect.value = state.selectedComponentId;
  if (ui.showComponentItemsWrap) ui.showComponentItemsWrap.classList.add("hidden");
  updateComponentHint();
  renderTaskQueueControls();
  syncComponentActionState();
}
function updateMainInventoryAvailableHint(slotEstimate = null) {
  if (!ui.componentAvailableHint) return;
  const estimate = slotEstimate && typeof slotEstimate === "object" ? slotEstimate : estimateMainInventoryFreeSlots();
  const capacity = Math.max(0, Number(estimate && estimate.capacity != null ? estimate.capacity : MAIN_INVENTORY_CAPACITY) || 0);
  const occupiedSlots = Math.max(0, Number(estimate && estimate.occupiedSlots != null ? estimate.occupiedSlots : 0) || 0);
  const freeSlots = Math.max(0, capacity - occupiedSlots);
  ui.componentAvailableHint.textContent = `可取出：${freeSlots}`;
  ui.componentAvailableHint.title = `当前实际可从组件中取出的物品数量 ${freeSlots}/${capacity} | 占槽 ${occupiedSlots}`;
}
function updateComponentHint(visibleCount = null) {
  if (!ui.componentHint) return;
  const count = visibleCount == null ? rowsForComponentScope().length : Math.max(0, Number(visibleCount) || 0);
  const slotEstimate = estimateMainInventoryFreeSlots();
  updateMainInventoryAvailableHint(slotEstimate);
  const selected = selectedComponentId();
  if (selected === "__ALL__") {
    ui.componentHint.textContent = `全部 ${count}`;
    ui.componentHint.title = `全部库存物品 ${count}，当前选中 ${getSelectedRows().length} 件`;
    return;
  }
  if (selected) {
    const totalCapacity = 1000;
    ui.componentHint.textContent = `${count}/${totalCapacity}`;
    ui.componentHint.title = `组件可见 ${count}/${totalCapacity}，当前选中 ${getSelectedRows().length} 件`;
    return;
  }
  ui.componentHint.textContent = `${count}/${slotEstimate.capacity}`;
  ui.componentHint.title = `主库存可见 ${count}/${slotEstimate.capacity} | 占槽 ${slotEstimate.occupiedSlots} | 隐藏 ${slotEstimate.hiddenCount} | 交易保护 ${slotEstimate.coolingCount}`;
}
function getSelectedRows() {
  if (!state.selectedComponentItemIds.size) return [];
  const scopedRows = rowsForComponentScope();
  const scopedIds = new Set(
    scopedRows
      .filter((row) => isInventoryRowSelectable(row))
      .map((row) => rowAssetId(row))
      .filter(Boolean)
  );
  for (const id of [...state.selectedComponentItemIds]) {
    if (!scopedIds.has(id)) state.selectedComponentItemIds.delete(id);
  }
  return scopedRows.filter((row) => isInventoryRowSelectable(row) && state.selectedComponentItemIds.has(rowAssetId(row)));
}
function getSelectedIdsInComponent(componentId) {
  const target = String(componentId || "").trim();
  if (!target) return [];
  return getSelectedRows()
    .filter((row) => String(row.casket_id || "").trim() === target)
    .map((row) => rowAssetId(row))
    .filter(Boolean);
}
function listComponentChoices({excludeId = ""} = {}) {
  const skipId = String(excludeId || "").trim();
  return Object.values(state.component.summary_map || {})
    .map((row) => {
      const id = String(row.component_id || "").trim();
      return {id, name: compactComponentName(row.name)};
    })
    .filter((x) => x.id && x.id !== skipId)
    .sort((a, b) => a.name.localeCompare(b.name));
}
function rowWearValueForSort(row) {
  if (!row || !itemHasWear(row)) return Number.POSITIVE_INFINITY;
  const v = Number(row.float_value);
  return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
}
function compareRowsByWearAsc(a, b) {
  const wa = rowWearValueForSort(a);
  const wb = rowWearValueForSort(b);
  if (wa !== wb) return wa - wb;
  return assetIdNumber(a) - assetIdNumber(b);
}
function estimateComponentFreeSlots(componentId) {
  const key = String(componentId || "").trim();
  if (!key) return 0;
  const summary = state.component && state.component.summary_map ? state.component.summary_map[key] : null;
  const expected = Math.max(0, Number(summary && summary.expected_count != null ? summary.expected_count : 0) || 0);
  const capacity = Math.max(STORAGE_UNIT_CAPACITY, expected);
  const loadedFromMap = Array.isArray(state.component && state.component.item_map ? state.component.item_map[key] : null)
    ? state.component.item_map[key].length
    : Math.max(0, Number(summary && summary.loaded_count != null ? summary.loaded_count : 0) || 0);
  return Math.max(0, capacity - loadedFromMap);
}
function estimateMainInventoryFreeSlots() {
  const rows = Array.isArray(state.rows) ? state.rows : [];
  const mainRows = rows.filter((row) => !String(row && row.casket_id || "").trim());
  const hiddenCount = mainRows.filter((row) => String(row && row.hidden_reason || "").trim()).length;
  const coolingCount = mainRows.filter((row) => coolingUnlockTs(row) > 0).length;
  const occupiedSlots = Math.max(0, mainRows.length - hiddenCount - coolingCount);
  const capacity = MAIN_INVENTORY_CAPACITY;
  const freeSlots = Math.max(0, capacity - occupiedSlots);
  return {
    freeSlots,
    capacity,
    occupiedSlots,
    totalMainItems: mainRows.length,
    hiddenCount,
    coolingCount,
    reliable: true
  };
}
function shouldHideUnselectedComponentCandidate({selectedComponentCount = 0, mainFreeSlots = 0, isSelected = false} = {}) {
  if (isSelected) return false;
  const selected = Math.max(0, Number(selectedComponentCount) || 0);
  const free = Math.max(0, Number(mainFreeSlots) || 0);
  return selected >= free;
}
function closeTargetComponentDrawer() {
  state.targetDrawerOpen = false;
  state.targetComponentSelectedId = "";
  state.targetComponentChoices = [];
  state.targetComponentExcludeId = "";
  targetDrawerDrag.active = false;
  if (ui.targetComponentDrawer) ui.targetComponentDrawer.classList.add("hidden");
}
function clampDrawerPosition(left, top) {
  const drawer = ui.targetComponentDrawer;
  if (!drawer) return {left: 8, top: 8};
  const maxLeft = Math.max(8, window.innerWidth - drawer.offsetWidth - 8);
  const maxTop = Math.max(8, window.innerHeight - drawer.offsetHeight - 8);
  return {
    left: Math.max(8, Math.min(Math.round(Number(left) || 8), maxLeft)),
    top: Math.max(8, Math.min(Math.round(Number(top) || 8), maxTop))
  };
}
function setTargetDrawerPosition(left, top) {
  const drawer = ui.targetComponentDrawer;
  if (!drawer) return;
  const pos = clampDrawerPosition(left, top);
  drawer.style.left = `${pos.left}px`;
  drawer.style.top = `${pos.top}px`;
  drawer.style.right = "auto";
}
function placeTargetDrawerNearAnchor(anchorEl = null) {
  const drawer = ui.targetComponentDrawer;
  if (!drawer) return;
  const anchor = anchorEl || ui.componentDepositBtn;
  const anchorRect = anchor ? anchor.getBoundingClientRect() : {left: 12, bottom: 12};
  const defaultLeft = anchorRect.left;
  const defaultTop = anchorRect.bottom + 8;
  setTargetDrawerPosition(defaultLeft, defaultTop);
}
function renderTargetComponentDrawer() {
  if (!ui.targetComponentDrawerSelect || !ui.targetComponentDrawerHint || !ui.targetComponentDrawerConfirm) return;
  const selectedRows = getSelectedRows();
  const choices = Array.isArray(state.targetComponentChoices) ? state.targetComponentChoices : [];
  const selectedTarget = String(state.targetComponentSelectedId || "").trim();
  ui.targetComponentDrawerHint.textContent = selectedRows.length
    ? `已选 ${selectedRows.length} 件，请选择目标组件`
    : "请先在库存列表中选择要存入的物品";
  ui.targetComponentDrawerSelect.replaceChildren();
  if (!choices.length) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "暂无可用目标组件";
    ui.targetComponentDrawerSelect.append(empty);
    ui.targetComponentDrawerSelect.disabled = true;
  } else {
    ui.targetComponentDrawerSelect.disabled = false;
    for (const choice of choices) {
      const id = String(choice.id || "").trim();
      if (!id) continue;
      const summary = state.component && state.component.summary_map ? state.component.summary_map[id] : null;
      const expected = Math.max(0, Number(summary && summary.expected_count != null ? summary.expected_count : 0) || 0);
      const capacity = Math.max(STORAGE_UNIT_CAPACITY, expected);
      const loaded = Math.max(0, Number(summary && summary.loaded_count != null ? summary.loaded_count : 0) || 0);
      const free = Math.max(0, capacity - loaded);
      const item = document.createElement("option");
      item.value = id;
      item.textContent = expected > 0
        ? `${choice.name} (${loaded}/${capacity}，剩余${free})`
        : `${choice.name} (${loaded})`;
      ui.targetComponentDrawerSelect.append(item);
    }
    const nextSelected = selectedTarget || String(choices[0].id || "").trim();
    ui.targetComponentDrawerSelect.value = nextSelected;
    state.targetComponentSelectedId = String(ui.targetComponentDrawerSelect.value || "").trim();
  }
  const finalTarget = String(state.targetComponentSelectedId || "").trim();
  ui.targetComponentDrawerConfirm.disabled = !selectedRows.length || !finalTarget;
}
function openTargetComponentDrawer({excludeId = ""} = {}) {
  const selectedRows = getSelectedRows();
  if (!selectedRows.length) {
    setSummary("请先在库存列表中选择要存入的物品");
    return false;
  }
  const choices = listComponentChoices({excludeId});
  if (!choices.length) {
    setSummary("暂无可用目标组件");
    return false;
  }
  state.targetDrawerOpen = true;
  state.targetComponentExcludeId = String(excludeId || "").trim();
  state.targetComponentChoices = choices;
  state.targetComponentSelectedId = String(choices[0].id || "").trim();
  renderTargetComponentDrawer();
  if (ui.targetComponentDrawer) {
    ui.targetComponentDrawer.classList.remove("hidden");
    requestAnimationFrame(() => {
      placeTargetDrawerNearAnchor(ui.componentDepositBtn);
    });
  }
  return true;
}
function syncComponentActionState() {
  const currentComponent = selectedComponentId();
  const connected = isCurrentAccountConnected();
  const selectedRows = getSelectedRows();
  const hasTargetComponent = listComponentChoices().length > 0;
  const busy = state.componentOpBusy || state.refreshing;
  const depositBlocked = busy;
  const withdrawBlocked = busy;
  if (ui.componentWithdrawBtn) {
    ui.componentWithdrawBtn.classList.toggle("hidden", !currentComponent);
  }
  ui.componentDepositBtn.disabled = depositBlocked;
  ui.componentWithdrawBtn.disabled = withdrawBlocked;
  if (depositBlocked) {
    ui.componentDepositBtn.title = "处理中，请稍候";
  } else if (!connected) {
    ui.componentDepositBtn.title = "未连接时将在存入前自动连接并刷新库存";
  } else {
    ui.componentDepositBtn.title = !selectedRows.length
      ? "请先在列表选择要存入的物品"
      : (!hasTargetComponent ? "暂无可用目标组件" : "存入组件");
  }
  if (withdrawBlocked) {
    ui.componentWithdrawBtn.title = "处理中，请稍候";
    return;
  }
  if (!connected) {
    ui.componentWithdrawBtn.title = "未连接时将在取出前自动连接并刷新库存";
    return;
  }
  ui.componentWithdrawBtn.title = !currentComponent
    ? "请先选择组件"
    : "取出选中（优先低磨损）";
}
function applyFilter() {
  const keyword = String(state.searchText || "").trim().toLowerCase();
  const allRows = rowsForComponentScope();
  const selected = selectedComponentId();
  if (selected === "__ALL__") {
    state.emptyHint = allRows.length > 0 ? "全部库存在当前条件下无物品" : "库存为空，请先刷新库存";
  } else if (selected) {
    if (allRows.length > 0) {
      state.emptyHint = "该组件在当前条件下无物品";
    } else {
      const summary = state.component && state.component.summary_map
        ? state.component.summary_map[selected]
        : null;
      const loadedCount = Math.max(0, Number(summary && summary.loaded_count != null ? summary.loaded_count : 0) || 0);
      state.emptyHint = loadedCount > 0
        ? "该组件暂无已缓存物品，请先刷新库存"
        : "该组件当前无物品";
    }
  } else {
    state.emptyHint = "主库存在当前条件下无物品（隐藏条目默认不显示）";
  }

  const wearCheck = validateWearFilter({autoFix: false});
  const visibleRows = allRows.filter((x) => !x.hidden_reason || String(x.casket_id || "").trim());
  const wearRows = visibleRows.filter(itemHasWear);
  const noWearRows = visibleRows.filter((x) => !itemHasWear(x));
  let rows = wearRows;
  if (keyword) rows = rows.filter((x) => itemSearchText(x).includes(keyword));
  if (state.raritySelected.size && state.raritySelected.size < RARITY_VALUES.length) {
    rows = rows.filter((x) => state.raritySelected.has(rarityName(x)));
  }
  if (state.collectionSelected.size) {
    rows = rows.filter((x) => state.collectionSelected.has(collectionName(x)));
  }
  if (wearCheck.valid) {
    if (wearCheck.minValue !== null) rows = rows.filter((x) => Number(x.float_value || 0) >= wearCheck.minValue);
    if (wearCheck.maxValue !== null) rows = rows.filter((x) => Number(x.float_value || 0) <= wearCheck.maxValue);
  }
  rows.sort((a, b) => {
    const ra = Number(a.rarity || 0);
    const rb = Number(b.rarity || 0);
    if (ra !== rb) return state.raritySort === "desc" ? rb - ra : ra - rb;
    const wa = Number(a.float_value || 0);
    const wb = Number(b.float_value || 0);
    if (wa !== wb) return state.wearSort === "desc" ? wb - wa : wa - wb;
    return assetIdNumber(a) - assetIdNumber(b);
  });
  noWearRows.sort((a, b) => assetIdNumber(a) - assetIdNumber(b));
  return {allRows, filteredRows: rows.concat(noWearRows)};
}
function resetRenderWindow() {
  state.renderWindowKey = "";
  state.renderVisibleCount = 0;
  state.renderVisibleTotal = 0;
}
function resolveRenderWindow(list, windowKey) {
  const rows = Array.isArray(list) ? list : [];
  const totalCount = rows.length;
  if (state.renderWindowKey !== windowKey) {
    state.renderWindowKey = windowKey;
    state.renderVisibleCount = Math.min(totalCount, Math.max(1, Number(state.renderInitialSize) || 180));
  }
  if (state.renderVisibleCount <= 0) {
    state.renderVisibleCount = Math.min(totalCount, Math.max(1, Number(state.renderInitialSize) || 180));
  }
  if (state.renderVisibleCount > totalCount) state.renderVisibleCount = totalCount;
  state.renderVisibleTotal = totalCount;
  return {
    visibleRows: rows.slice(0, state.renderVisibleCount),
    visibleCount: state.renderVisibleCount,
    totalCount,
    hasMore: state.renderVisibleCount < totalCount
  };
}
function isNearPageBottom(thresholdPx = 320) {
  const doc = document.documentElement;
  const top = window.scrollY || window.pageYOffset || doc.scrollTop || 0;
  const viewportBottom = top + window.innerHeight;
  return viewportBottom >= doc.scrollHeight - thresholdPx;
}
function tryLoadMoreRows({force = false} = {}) {
  if (state.currentPage !== "inventoryPage") return false;
  if (state.renderVisibleCount >= state.renderVisibleTotal) return false;
  if (!force && !isNearPageBottom()) return false;
  const step = Math.max(1, Number(state.renderBatchSize) || 120);
  state.renderVisibleCount = Math.min(state.renderVisibleTotal, state.renderVisibleCount + step);
  render();
  return true;
}
function scheduleLazyLoadCheck() {
  if (lazyLoadTickPending) return;
  lazyLoadTickPending = true;
  requestAnimationFrame(() => {
    lazyLoadTickPending = false;
    tryLoadMoreRows();
  });
}
function scheduleAutoFillIfNeeded() {
  if (lazyLoadAutoFillPending) return;
  if (state.currentPage !== "inventoryPage") return;
  if (state.renderVisibleCount >= state.renderVisibleTotal) return;
  const doc = document.documentElement;
  const notScrollable = doc.scrollHeight <= window.innerHeight + 24;
  if (!notScrollable && !isNearPageBottom(420)) return;
  lazyLoadAutoFillPending = true;
  requestAnimationFrame(() => {
    lazyLoadAutoFillPending = false;
    tryLoadMoreRows({force: true});
  });
}
function createLoadMoreHint(visibleCount, totalCount, unit = "条") {
  const hint = document.createElement("div");
  hint.className = "lazy-load-hint";
  hint.textContent = `已加载 ${visibleCount}/${totalCount}${unit}，继续下滑自动加载`;
  return hint;
}
function toggleComponentItemSelection(itemId) {
  const key = String(itemId || "").trim();
  if (!key) return;
  if (state.selectedComponentItemIds.has(key)) state.selectedComponentItemIds.delete(key);
  else state.selectedComponentItemIds.add(key);
  if (state.targetDrawerOpen) renderTargetComponentDrawer();
  refreshComponentControls();
  render();
}
function toggleComponentGroupSelection(items) {
  const ids = (Array.isArray(items) ? items : [])
    .filter((x) => isInventoryRowSelectable(x))
    .map((x) => rowAssetId(x))
    .filter(Boolean);
  if (!ids.length) return;
  const selectedCount = ids.reduce((a, id) => a + (state.selectedComponentItemIds.has(id) ? 1 : 0), 0);
  const shouldSelect = selectedCount < ids.length;
  for (const id of ids) {
    if (shouldSelect) state.selectedComponentItemIds.add(id);
    else state.selectedComponentItemIds.delete(id);
  }
  if (state.targetDrawerOpen) renderTargetComponentDrawer();
  refreshComponentControls();
  render();
}
async function runComponentMove(action, itemIds, componentIdOverride = "") {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可执行组件存取操作。",
    view: "login"
  }) === false) {
    return null;
  }
  const actionName = String(action || "").trim() === "deposit" ? "deposit" : "withdraw";
  const componentId = String(componentIdOverride || selectedComponentId()).trim();
  const username = String(state.currentAccountUsername || "").trim();
  if (!componentId) throw new Error("请先选择组件");
  if (!username || !isCurrentAccountConnected()) throw new Error("请先连接并刷新库存");
  state.componentOpBusy = true;
  state.componentOpBusyAction = actionName;
  refreshComponentControls();
  try {
    const path = actionName === "deposit" ? "/api/component/deposit" : "/api/component/withdraw";
    const data = await api(path, {method: "POST", body: JSON.stringify({username, component_id: componentId, item_ids: itemIds})});
    if (data && data.queue) applyTaskQueueSnapshot(data.queue);
    state.selectedQueueJobId = data && data.job ? String(data.job.job_id || "").trim() : "";
    renderTaskQueueControls();
    setSummary(String(data.message || "任务已加入队列"));
    return data;
  } finally {
    state.componentOpBusy = false;
    state.componentOpBusyAction = "";
    refreshComponentControls();
  }
}
async function submitDepositToTarget(targetComponentId) {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可执行组件存入操作。",
    view: "login"
  }) === false) {
    return false;
  }
  const targetId = String(targetComponentId || "").trim();
  if (!targetId) {
    setSummary("请先选择目标组件");
    return false;
  }
  const connected = await ensureConnectedForComponentDeposit();
  if (!connected) return false;
  const targetExists = listComponentChoices({excludeId: selectedComponentId()}).some((choice) => String(choice && choice.id || "").trim() === targetId);
  if (!targetExists) {
    setSummary("自动校对后目标组件已变化，请重新选择目标组件");
    return false;
  }
  const selectedRows = getSelectedRows();
  if (!selectedRows.length) {
    setSummary("请先在库存列表中选择要存入的物品");
    return false;
  }
  const storableRows = selectedRows
    .filter((row) => String(row.casket_id || "").trim() !== targetId)
    .sort(compareRowsByWearAsc);
  if (!storableRows.length) {
    setSummary("所选物品已在目标组件中");
    return false;
  }
  const freeSlots = estimateComponentFreeSlots(targetId);
  if (freeSlots <= 0) {
    setSummary("目标组件已满，请先取出或更换组件");
    return false;
  }
  let submitRows = storableRows;
  if (storableRows.length > freeSlots) {
    const ok = window.confirm(
      `已选可存入 ${storableRows.length} 件，但目标组件仅剩 ${freeSlots} 个空间。\n` +
      `是否继续，仅按磨损从低到高存入前 ${freeSlots} 件？`
    );
    if (!ok) {
      setSummary("已取消存入");
      return false;
    }
    submitRows = storableRows.slice(0, freeSlots);
  }
  const submitIds = submitRows.map((row) => rowAssetId(row)).filter(Boolean);
  await runComponentMove("deposit", submitIds, targetId);
  for (const id of submitIds) {
    state.selectedComponentItemIds.delete(String(id || "").trim());
  }
  refreshComponentControls();
  render();
  return true;
}
function renderCards(filteredRows, totalRows, filterKey = "") {
  const scopeKey = `cards|${selectedComponentId() || "main"}|${filterKey}|${filteredRows.length}`;
  const {visibleRows, visibleCount, totalCount, hasMore} = resolveRenderWindow(filteredRows, scopeKey);
  if (!visibleRows.length) {
    ui.listWrap.innerHTML = `<div class="empty">${state.emptyHint}</div>`;
    setSummary(`匹配 ${filteredRows.length}/${totalRows.length}，已加载 0/0`);
    return;
  }
  const grid = document.createElement("div");
  grid.className = "grid";
  const showSeed = !!state.craftShowSeed;
  const showCoolingTime = !!state.craftShowCoolingTime;
  for (const row of visibleRows) {
    const itemId = rowAssetId(row);
    const componentRow = isComponentRow(row);
    const selectable = isInventoryRowSelectable(row);
    const selected = selectable && state.selectedComponentItemIds.has(itemId);
    const card = document.createElement("div");
    card.className = `card${selectable ? " selectable" : ""}${selected ? " selected" : ""}`;
    appendCardSkinBackdrop(card, row);
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = itemDisplayName(row);
    const meta = document.createElement("div");
    meta.className = "meta";
    const lines = [];
    if (showSeed) lines.push(`皮肤编号: ${Number(row.paint_index || 0)}  种子: ${Number(row.paint_seed || 0)}`);
    else lines.push(`皮肤编号: ${Number(row.paint_index || 0)}`);
    if (!componentRow) {
      lines.push(`稀有度: ${rarityName(row)}`);
    }
    if (itemHasWear(row)) lines.push(`磨损: ${formatVisibleWearText(row.float_value, 8)}`);
    const cid = String(row.casket_id || "").trim();
    const prefix = cid ? `组件: ${componentNameById(cid)}` : "";
    const unlock = coolingUnlockTs(row);
    if (componentRow) {
      meta.style.color = "#57606a";
      lines.push(prefix || "");
    } else {
      if (showCoolingTime && unlock > 0) {
        meta.style.color = "#c28f00";
        lines.push(`${prefix} （冷却中 ${cooldownEndText(unlock)} 结束）`.trim());
      } else {
        meta.style.color = "#57606a";
        if (prefix) lines.push(prefix);
        else if (showCoolingTime) lines.push("冷却: 无");
      }
    }
    meta.textContent = lines.filter(Boolean).join("\n");
    if (selectable) {
      card.onclick = () => toggleComponentItemSelection(itemId);
    }
    card.append(name, meta);
    grid.append(card);
  }
  const fragment = document.createDocumentFragment();
  fragment.append(grid);
  if (hasMore) {
    fragment.append(createLoadMoreHint(visibleCount, totalCount));
  }
  ui.listWrap.replaceChildren(fragment);
  setSummary(`匹配 ${filteredRows.length}/${totalRows.length}，已加载 ${visibleCount}/${totalCount}，已选${getSelectedRows().length}件`);
}
function buildGroupRows(filteredRows) {
  const groups = new Map();
  for (const item of filteredRows) {
    const key = itemDisplayName(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const wearGroups = [];
  const noWearGroups = [];
  for (const [name, items] of groups.entries()) {
    (items.some(itemHasWear) ? wearGroups : noWearGroups).push([name, items]);
  }

  const compareGroupQuantity = (a, b) => {
    const aCooling = a[1].filter((x) => coolingUnlockTs(x) > 0).length;
    const bCooling = b[1].filter((x) => coolingUnlockTs(x) > 0).length;
    const aAvailable = a[1].length - aCooling;
    const bAvailable = b[1].length - bCooling;
    if (aAvailable !== bAvailable) return state.quantitySort === "asc" ? aAvailable - bAvailable : bAvailable - aAvailable;
    if (aCooling !== bCooling) return state.quantitySort === "asc" ? aCooling - bCooling : bCooling - aCooling;
    return 0;
  };
  const compareGroupCollection = (a, b) => {
    const ca = String(groupCollectionText(a[1]) || "").trim().toLowerCase();
    const cb = String(groupCollectionText(b[1]) || "").trim().toLowerCase();
    if (ca === cb) return 0;
    const cmp = ca.localeCompare(cb);
    return state.collectionSort === "desc" ? -cmp : cmp;
  };
  const compareGroupRarity = (a, b) => {
    const ar = Math.max(...a[1].map((x) => Number(x.rarity || 0)));
    const br = Math.max(...b[1].map((x) => Number(x.rarity || 0)));
    if (ar === br) return 0;
    return state.raritySort === "desc" ? br - ar : ar - br;
  };

  wearGroups.sort((a, b) => {
    const rarityDiff = compareGroupRarity(a, b);
    if (rarityDiff !== 0) return rarityDiff;
    const collectionDiff = compareGroupCollection(a, b);
    if (collectionDiff !== 0) return collectionDiff;
    const quantityDiff = compareGroupQuantity(a, b);
    if (quantityDiff !== 0) return quantityDiff;
    return a[0].toLowerCase().localeCompare(b[0].toLowerCase());
  });
  noWearGroups.sort((a, b) => {
    const rarityDiff = compareGroupRarity(a, b);
    if (rarityDiff !== 0) return rarityDiff;
    const collectionDiff = compareGroupCollection(a, b);
    if (collectionDiff !== 0) return collectionDiff;
    const quantityDiff = compareGroupQuantity(a, b);
    if (quantityDiff !== 0) return quantityDiff;
    return a[0].toLowerCase().localeCompare(b[0].toLowerCase());
  });

  const out = [];
  for (const [name, items] of wearGroups.concat(noWearGroups)) {
    const coolingCount = items.filter((x) => coolingUnlockTs(x) > 0).length;
    const availableCount = items.length - coolingCount;
    const hasWear = items.some(itemHasWear);
    const needsExpand = groupNeedsExpand(items);
    const childRows = needsExpand
      ? [...items].sort((a, b) => {
        const wa = Number(a.float_value || 0);
        const wb = Number(b.float_value || 0);
        if (wa !== wb) return state.wearSort === "desc" ? wb - wa : wa - wb;
        return assetIdNumber(a) - assetIdNumber(b);
      })
      : [];

    let wearRangeText = "";
    if (hasWear) {
      const vals = items.map((x) => Number(x.float_value || 0));
      const minWear = Math.min(...vals);
      const maxWear = Math.max(...vals);
      wearRangeText = items.length <= 1 || Math.abs(maxWear - minWear) <= 1e-9
        ? formatVisibleWearText(minWear, 8)
        : `${formatVisibleWearText(minWear, 8)}~${formatVisibleWearText(maxWear, 8)}`;
    }

    out.push({
      name,
      items,
      parent_rarity: rarityName(items[0]),
      collection: groupCollectionText(items),
      available_count: availableCount,
      cooling_count: coolingCount,
      wear_range_text: wearRangeText,
      cooldown_text: groupCooldownText(items),
      needs_expand: needsExpand,
      child_rows: childRows
    });
  }
  return out;
}
function renderGrouped(filteredRows, totalRows, filterKey = "") {
  const groupedRows = getGroupedRows(filteredRows, filterKey);
  const scopeKey = `grouped|${selectedComponentId() || "main"}|${filterKey}|${groupedRows.length}`;
  const {visibleRows, visibleCount, totalCount, hasMore} = resolveRenderWindow(groupedRows, scopeKey);
  if (!visibleRows.length) {
    ui.listWrap.innerHTML = `<div class="empty">${state.emptyHint}</div>`;
    setSummary(`匹配 ${filteredRows.length}/${totalRows.length}，已加载分组 0/0`);
    return;
  }
  const table = document.createElement("table");
  table.className = "group-table";
  const showSeed = !!state.craftShowSeed;
  const showCoolingTime = !!state.craftShowCoolingTime;
  const hideCollection = !!state.craftHideCollection;
  const hideQuantity = !!state.craftHideQuantity;
  const headCells = [
    "<th class=\"select-col\"><input type=\"checkbox\" class=\"row-check group-check-all\" title=\"全选/全部取消\" aria-label=\"全选/全部取消\" /></th>",
    "<th><div class=\"th-sort-wrap\"><span>稀有度</span><span class=\"sort-stack\"><button type=\"button\" class=\"arrow-tri up col-sort-btn\" data-sort-key=\"rarity\" data-sort-dir=\"asc\" title=\"稀有度由低到高\" aria-label=\"稀有度由低到高\"></button><button type=\"button\" class=\"arrow-tri down col-sort-btn\" data-sort-key=\"rarity\" data-sort-dir=\"desc\" title=\"稀有度由高到低\" aria-label=\"稀有度由高到低\"></button></span></div></th>",
    "<th class=\"group-name-heading\">名称</th>"
  ];
  if (!hideCollection) headCells.push("<th><div class=\"th-sort-wrap\"><span>收藏品</span><span class=\"sort-stack\"><button type=\"button\" class=\"arrow-tri up col-sort-btn\" data-sort-key=\"collection\" data-sort-dir=\"asc\" title=\"收藏品按字符升序\" aria-label=\"收藏品按字符升序\"></button><button type=\"button\" class=\"arrow-tri down col-sort-btn\" data-sort-key=\"collection\" data-sort-dir=\"desc\" title=\"收藏品按字符降序\" aria-label=\"收藏品按字符降序\"></button></span></div></th>");
  if (!hideQuantity) headCells.push("<th><div class=\"th-sort-wrap\"><span>数量(可用/冷却中)</span><span class=\"sort-stack\"><button type=\"button\" class=\"arrow-tri up col-sort-btn\" data-sort-key=\"quantity\" data-sort-dir=\"asc\" title=\"数量由低到高\" aria-label=\"数量由低到高\"></button><button type=\"button\" class=\"arrow-tri down col-sort-btn\" data-sort-key=\"quantity\" data-sort-dir=\"desc\" title=\"数量由高到低\" aria-label=\"数量由高到低\"></button></span></div></th>");
  if (showSeed) headCells.push("<th>种子</th>");
  headCells.push("<th><div class=\"th-sort-wrap\"><span>磨损</span><span class=\"sort-stack\"><button type=\"button\" class=\"arrow-tri up col-sort-btn\" data-sort-key=\"wear\" data-sort-dir=\"asc\" title=\"磨损由低到高\" aria-label=\"磨损由低到高\"></button><button type=\"button\" class=\"arrow-tri down col-sort-btn\" data-sort-key=\"wear\" data-sort-dir=\"desc\" title=\"磨损由高到低\" aria-label=\"磨损由高到低\"></button></span></div></th>");
  if (showCoolingTime) headCells.push("<th>冷却</th>");
  table.innerHTML = `<thead><tr>${headCells.join("")}</tr></thead>`;
  refreshSortArrowStyles(table);
  for (const btn of table.querySelectorAll(".col-sort-btn")) {
    btn.onclick = (evt) => {
      evt.stopPropagation();
      const key = String(btn.dataset.sortKey || "");
      const dir = String(btn.dataset.sortDir || "");
      if ((key !== "wear" && key !== "rarity" && key !== "quantity" && key !== "collection") || (dir !== "asc" && dir !== "desc")) return;
      if (key === "wear") state.wearSort = dir;
      else if (key === "rarity") state.raritySort = dir;
      else if (key === "collection") state.collectionSort = dir;
      else state.quantitySort = dir;
      render();
    };
  }
  const tbody = document.createElement("tbody");
  const pageIds = [];
  for (const row of visibleRows) {
    const key = `${selectedComponentId() || "main"}::${row.name}`;
    const expanded = state.expandedGroups.has(key);
    const groupItems = row.needs_expand ? row.child_rows : row.items;
    const selectableGroupItems = groupItems.filter((x) => isInventoryRowSelectable(x));
    const groupIds = [...new Set(selectableGroupItems.map((x) => rowAssetId(x)).filter(Boolean))];
    pageIds.push(...groupIds);
    const selectedCount = groupIds.reduce((acc, id) => acc + (state.selectedComponentItemIds.has(id) ? 1 : 0), 0);
    const componentGroup = row.items.some((x) => isComponentRow(x));
    const parentRarityText = componentGroup ? "" : row.parent_rarity;
    const parentCooldownText = componentGroup ? "" : row.cooldown_text;
    const parentQuantityText = componentGroup ? "" : `${row.available_count}/${row.cooling_count}`;
    const parentSelectCell = groupIds.length > 0
      ? `<input type="checkbox" class="row-check group-check" ${selectedCount > 0 && selectedCount === groupIds.length ? "checked" : ""} ${groupIds.length <= 0 ? "disabled" : ""} />`
      : "";
    const parent = document.createElement("tr");
    parent.className = `group-parent${selectedCount > 0 ? " selected" : ""}${groupIds.length > 0 ? " selectable" : ""}`;
    const parentCells = [
      `<td class="select-col">${parentSelectCell}</td>`,
      `<td>${parentRarityText}</td>`,
      `<td>${row.name}</td>`
    ];
    if (!hideCollection) parentCells.push(`<td>${row.collection || ""}</td>`);
    if (!hideQuantity) parentCells.push(`<td>${parentQuantityText}</td>`);
    if (showSeed) parentCells.push("<td></td>");
    parentCells.push(`<td>${row.wear_range_text || ""}</td>`);
    if (showCoolingTime) parentCells.push(`<td>${parentCooldownText}</td>`);
    parent.innerHTML = parentCells.join("");
    const nameCell = parent.children[2];
    decorateGroupNameCell(nameCell, row.name, preferredRowsSkinImageUrl(row.items));
    const groupCheck = parent.querySelector(".group-check");
    if (groupCheck && selectedCount > 0 && selectedCount < groupIds.length) {
      groupCheck.indeterminate = true;
    }
    if (groupCheck) {
      groupCheck.onclick = (evt) => {
        evt.stopPropagation();
        toggleComponentGroupSelection(selectableGroupItems);
      };
    }
    parent.onclick = () => {
      if (componentGroup) return;
      if (!row.needs_expand) return;
      if (expanded) state.expandedGroups.delete(key);
      else state.expandedGroups.add(key);
      render();
    };
    tbody.append(parent);
    if (!row.needs_expand || !expanded) continue;
    for (const item of row.child_rows) {
      const itemId = rowAssetId(item);
      const selectable = isInventoryRowSelectable(item);
      const componentRow = isComponentRow(item);
      const selected = selectable && state.selectedComponentItemIds.has(itemId);
      const childSelectCell = selectable
        ? `<input type="checkbox" class="row-check item-check" ${selected ? "checked" : ""} title="选中该物品" aria-label="选中该物品" />`
        : "";
      const child = document.createElement("tr");
      child.className = `group-child${selectable ? " selectable" : ""}${selected ? " selected" : ""}${showCoolingTime && !componentRow && coolingUnlockTs(item) > 0 ? " cooling" : ""}`;
      const childCells = [
        `<td class="select-col">${childSelectCell}</td>`,
        "<td></td>",
        "<td></td>"
      ];
      if (!hideCollection) childCells.push("<td></td>");
      if (!hideQuantity) {
        const itemCasketId = String(item.casket_id || "").trim();
        if (isAllInventoryMode() && itemCasketId) {
          const cName = compactComponentName(componentNameById(itemCasketId));
          childCells.push(`<td class="component-origin-tag" title="所属组件：${cName}">${cName}</td>`);
        } else {
          childCells.push("<td></td>");
        }
      }
      if (showSeed) childCells.push(`<td>${Number(item.paint_seed || 0)}</td>`);
      childCells.push(`<td>${itemHasWear(item) ? formatVisibleWearText(item.float_value, 8) : ""}</td>`);
      if (showCoolingTime) childCells.push(`<td>${componentRow ? "" : cooldownText(item)}</td>`);
      child.innerHTML = childCells.join("");
      const itemCheck = child.querySelector(".item-check");
      if (itemCheck) {
        itemCheck.onclick = (evt) => {
          evt.stopPropagation();
          toggleComponentItemSelection(itemId);
        };
      }
      if (selectable) {
        child.onclick = (evt) => {
          if (evt.target && typeof evt.target.closest === "function" && evt.target.closest(".item-check")) return;
          evt.stopPropagation();
          toggleComponentItemSelection(itemId);
        };
      }
      tbody.append(child);
    }
  }
  table.append(tbody);
  const uniquePageIds = [...new Set(pageIds)];
  const allCheck = table.querySelector(".group-check-all");
  if (allCheck) {
    const selectedCount = uniquePageIds.reduce((acc, id) => acc + (state.selectedComponentItemIds.has(id) ? 1 : 0), 0);
    allCheck.disabled = uniquePageIds.length <= 0;
    allCheck.checked = uniquePageIds.length > 0 && selectedCount === uniquePageIds.length;
    allCheck.indeterminate = selectedCount > 0 && selectedCount < uniquePageIds.length;
    allCheck.onclick = (evt) => {
      evt.stopPropagation();
      if (!uniquePageIds.length) return;
      const shouldSelect = uniquePageIds.some((id) => !state.selectedComponentItemIds.has(id));
      for (const id of uniquePageIds) {
        if (shouldSelect) state.selectedComponentItemIds.add(id);
        else state.selectedComponentItemIds.delete(id);
      }
      refreshComponentControls();
      render();
    };
  }
  const fragment = document.createDocumentFragment();
  fragment.append(table);
  if (hasMore) {
    fragment.append(createLoadMoreHint(visibleCount, totalCount, "组"));
  }
  ui.listWrap.replaceChildren(fragment);
  setSummary(`匹配 ${filteredRows.length}/${totalRows.length}，已加载分组 ${visibleCount}/${totalCount}，已选${getSelectedRows().length}件`);
}
function render() {
  if (state.currentPage !== "inventoryPage") return;
  refreshSortArrowStyles();
  syncModeButtons();
  const {allRows, filteredRows, filterKey} = getFilterResult();
  updateComponentHint(filteredRows.length);
  refreshCollectionMenu(allRows, {sourceKey: makeCollectionSourceKey()});
  if (state.mode === "grouped") renderGrouped(filteredRows, allRows, filterKey);
  else renderCards(filteredRows, allRows, filterKey);
  syncComponentActionState();
  syncCraftSettingsControls(allRows);
  scheduleAutoFillIfNeeded();
}

async function disconnectCurrentSession({usernameOverride = ""} = {}) {
  if (guardGuestAction({
    reason: "当前为访客预览态，登录后可管理真实账号连接状态。",
    view: "login"
  }) === false) {
    return false;
  }
  if (state.refreshing) {
    setSummary("库存刷新中，请稍后再断开");
    return;
  }
  const username = String(
    usernameOverride ||
    state.currentAccountUsername ||
    (ui.accountPageSelect && ui.accountPageSelect.value) ||
    (ui.accountSelect && ui.accountSelect.value) ||
    (ui.craftAccountSelect && ui.craftAccountSelect.value) ||
    state.connectedUsername
  ).trim();
  if (!username) {
    setSummary("请先选择账号");
    return;
  }
  if (!state.connectedUsername || state.connectedUsername !== username) {
    setSummary("当前账号未连接");
    return;
  }
  try {
    const data = await api("/api/session/disconnect", {
      method: "POST",
      body: JSON.stringify({username})
    });
    if (state.connectedUsername === username) {
      state.connectedUsername = "";
    }
    markCachedConnectionDisconnected(username);
    syncInventoryTop();
    try {
      await loadComponentTaskQueue();
    } catch (_) {
      // ignore queue refresh errors
    }
    const cancelled = Math.max(0, Number(data.cancelled_tasks || 0) || 0);
    setSummary(cancelled > 0 ? `连接已断开，已取消${cancelled}个排队任务` : "连接已断开");
  } catch (err) {
    setSummary(`断开连接失败：${err.message}`);
  }
}

async function disconnectOtherSessionsForTarget(username, {silent = true} = {}) {
  const key = String(username || "").trim();
  if (!key) return {disconnected: []};
  const data = await api("/api/session/disconnect-others", {
    method: "POST",
    body: JSON.stringify({username: key})
  });
  const disconnected = Array.isArray(data && data.disconnected) ? data.disconnected : [];
  for (const item of disconnected) {
    markCachedConnectionDisconnected(item);
  }
  if (disconnected.length && String(state.connectedUsername || "").trim() !== key) {
    state.connectedUsername = "";
  }
  if (!silent && disconnected.length) {
    setSummary(`已断开其他账号连接：${disconnected.join("、")}`);
  }
  return {
    disconnected
  };
}

function setRefreshBusy(busy) {
  state.refreshing = !!busy;
  const disabled = state.refreshing || state.accounts.length <= 0;
  ui.refreshBtn.disabled = disabled;
  if (ui.craftRefreshBtn) ui.craftRefreshBtn.disabled = disabled;
  if (ui.accountPageRefreshBtn) ui.accountPageRefreshBtn.disabled = disabled;
  if (ui.disconnectBtn) ui.disconnectBtn.disabled = state.refreshing || !isCurrentAccountConnected();
  if (ui.craftDisconnectBtn) ui.craftDisconnectBtn.disabled = state.refreshing || !isCurrentAccountConnected();
  if (ui.accountPageDisconnectBtn) ui.accountPageDisconnectBtn.disabled = state.refreshing || !isCurrentAccountConnected();
  if (ui.accountPageAddBtn) ui.accountPageAddBtn.disabled = state.refreshing;
  syncAccountLoginActionState();
  syncComponentActionState();
  renderSavedAccounts();
  renderCraftPage();
}

async function doRefresh({
  usernameOverride = "",
  force = false,
  silentRateLimit = false,
  silentInfo = false,
  onProgress = null,
  keepSelectedIds = null,
  suppressReloginModal = false
} = {}) {
  if (state.refreshing) return {ok: false, message: "当前正在刷新库存"};
  const reportProgress = ({percent = 0, title = "正在连接账号", detail = ""} = {}) => {
    if (typeof onProgress !== "function") return;
    try {
      onProgress({percent, title, detail});
    } catch (_) {
      // ignore progress callback errors
    }
  };
  const username = String(
    usernameOverride ||
    (ui.accountPageSelect && ui.accountPageSelect.value) ||
    ui.accountSelect.value ||
    (ui.craftAccountSelect && ui.craftAccountSelect.value) ||
    state.currentAccountUsername ||
    ""
  ).trim();
  if (!username) {
    const message = "请选用一个账号";
    setSummary(message);
    state.emptyHint = message;
    render();
    return {ok: false, message};
  }
  clearCraftStatus();
  if (!force) {
    const now = Date.now() / 1000, remaining = 10 - (now - state.lastRefreshClickTs);
    if (remaining > 0) {
      const message = `刷新过于频繁，请在 ${Math.floor(remaining) + 1}s 后再试`;
      if (!silentRateLimit) setSummary(message);
      return {ok: false, message};
    }
    state.lastRefreshClickTs = now;
  }
  const account = accountByUsername(username);
  if (!account) {
    const message = `账号不存在：${username}`;
    setSummary(message);
    return {ok: false, message};
  }

  try {
    setRefreshBusy(true);
    state.refreshSilentInfo = !!silentInfo;
    reportProgress({percent: 10, detail: "正在准备连接账号..."});
    state.accountSelectedUsername = username;
    state.currentAccountUsername = username;
    startInventoryEventStream(username);
    syncInventoryAccountSelect();
    await persistLastSelected(username);
    if (state.activeAccount !== username) {
      reportProgress({percent: 25, detail: "正在切换目标账号..."});
      await api("/api/accounts/active", {method: "POST", body: JSON.stringify({username})});
      state.activeAccount = username;
    }
    reportProgress({percent: 40, detail: "正在清理其他账号连接..."});
    await disconnectOtherSessionsForTarget(username, {silent: true});
    setRefreshPhase(state.connectedUsername === username ? "连接状态：已连接（刷新中）" : "连接状态：连接中");
    if (!silentInfo) {
      setSummary(state.connectedUsername === username ? "已连接，正在刷新库存..." : "正在建立连接并刷新库存...");
    }
    reportProgress({
      percent: 68,
      detail: state.connectedUsername === username ? "账号已连接，正在刷新库存..." : "正在建立连接并刷新库存..."
    });

    const data = await api("/api/refresh", {method: "POST", body: JSON.stringify({username, include_hidden: "false"})});
    const result = data.result || {}, rows = Array.isArray(data.rows) ? data.rows : [];
    state.connectedUsername = username;
    state.fetchTime = String(data.fetch_time || "").trim();
    const component = data.component || {summary_map: {}, item_map: {}};
    const snapshotPath = result.snapshot_path || "";
    const nextKeepSelectedIds = keepSelectedIds instanceof Set
      ? new Set(Array.from(keepSelectedIds).map((id) => String(id || "").trim()).filter(Boolean))
      : (Array.isArray(keepSelectedIds)
        ? new Set(keepSelectedIds.map((id) => String(id || "").trim()).filter(Boolean))
        : null);
    setRows(rows, component, snapshotPath, nextKeepSelectedIds ? {keepSelectedIds: nextKeepSelectedIds} : {});
    setAccountAuthState(username, {authState: "normal", authReason: ""});
    cacheSnapshotForAccount(username, {
      rows,
      component,
      snapshotPath,
      fetchTime: state.fetchTime,
      connected: true,
      authState: "normal",
      authReason: ""
    });
    clearSnapshotDirty();
    clearRefreshPhase();
    syncInventoryTop();
    await loadComponentTaskQueue();
    if (!silentInfo) {
      setSummary(`${String(result.message || "刷新成功")}，共 ${rows.length} 条`);
    }
    reportProgress({percent: 100, detail: "库存已同步，准备执行配方..."});
    return {ok: true, message: String(result.message || "刷新成功").trim() || "刷新成功"};
  } catch (err) {
    if (state.connectedUsername === username) state.connectedUsername = "";
    clearRefreshPhase();
    const payload = err && err.data && typeof err.data === "object" ? err.data : null;
    const reason = String(payload && payload.reason || "").trim();
    if (reason === "login_key_missing" || reason === "login_key_invalid") {
      const authState = reason === "login_key_invalid"
        ? "auth_invalid"
        : (String(payload && payload.auth_state || "").trim() || "login_required");
      setAccountAuthState(username, {authState, authReason: reason});
      syncInventoryTop();
      if (!suppressReloginModal) {
        openAccountReloginModal({
          username,
          password: String(account && account.password || "").trim(),
          reason
        });
      }
      const message = reason === "login_key_invalid"
        ? "登录失效，请重新登录后再刷新"
        : "当前账号缺少 loginKey，请重新登录后再刷新";
      setSummary(message);
      return {ok: false, message, reloginRequired: true, reason, authState};
    }
    syncInventoryTop();
    const message = `刷新失败：${err.message}`;
    setSummary(message);
    return {ok: false, message};
  } finally {
    state.refreshSilentInfo = false;
    setRefreshBusy(false);
  }
}

// ===== 多账号汰换 (Batch Craft) =====

const batchCraftSplitDrag = {active: false, startX: 0, startWidth: 0};

function clampBatchCraftPresetWidth(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 200;
  return Math.max(160, Math.min(400, n));
}

function applyBatchCraftPresetWidth() {
  if (!ui.batchCraftPage) return;
  state.batchCraftPresetWidth = clampBatchCraftPresetWidth(state.batchCraftPresetWidth);
  const main = ui.batchCraftPage.querySelector(".batch-craft-main");
  if (main) main.style.setProperty("--batch-craft-preset-width", `${state.batchCraftPresetWidth}px`);
}

function startBatchCraftSplitDrag(evt) {
  if (evt.button !== 0) return;
  if (!ui.batchCraftSplitBar) return;
  batchCraftSplitDrag.active = true;
  batchCraftSplitDrag.startX = evt.clientX;
  batchCraftSplitDrag.startWidth = clampBatchCraftPresetWidth(state.batchCraftPresetWidth);
  document.body.classList.add("batch-craft-split-dragging");
  evt.preventDefault();
}

function moveBatchCraftSplitDrag(evt) {
  if (!batchCraftSplitDrag.active) return;
  const deltaX = evt.clientX - batchCraftSplitDrag.startX;
  state.batchCraftPresetWidth = clampBatchCraftPresetWidth(batchCraftSplitDrag.startWidth + deltaX);
  applyBatchCraftPresetWidth();
}

function stopBatchCraftSplitDrag() {
  if (!batchCraftSplitDrag.active) return;
  batchCraftSplitDrag.active = false;
  document.body.classList.remove("batch-craft-split-dragging");
}

function setBatchCraftStatus(text, isError = false) {
  state.batchCraftStatusText = String(text || "").trim();
  state.batchCraftStatusError = !!isError;
  if (ui.batchCraftStatusText) {
    ui.batchCraftStatusText.textContent = state.batchCraftStatusText;
    ui.batchCraftStatusText.classList.toggle("error", state.batchCraftStatusError);
  }
}

function setBatchCraftOverlay(visible, {title = "", detail = "", percent = 0} = {}) {
  if (!ui.batchCraftOverlay) return;
  ui.batchCraftOverlay.classList.toggle("hidden", !visible);
  if (ui.batchCraftOverlayTitle) ui.batchCraftOverlayTitle.textContent = title;
  if (ui.batchCraftOverlayDetail) ui.batchCraftOverlayDetail.textContent = detail;
  if (ui.batchCraftOverlayProgressBar) ui.batchCraftOverlayProgressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function hasCachedSnapshotForAccount(username) {
  const key = String(username || "").trim();
  if (!key) return false;
  if (key === String(state.currentAccountUsername || "").trim() && Array.isArray(state.rows) && state.rows.length > 0) return true;
  if (!(state.snapshotCacheByAccount instanceof Map)) return false;
  const cached = state.snapshotCacheByAccount.get(key);
  return !!(cached && Array.isArray(cached.rows) && cached.rows.length > 0);
}

function getCachedFetchTimeForAccount(username) {
  const key = String(username || "").trim();
  if (!key) return "";
  if (key === String(state.currentAccountUsername || "").trim()) return String(state.fetchTime || "").trim();
  if (!(state.snapshotCacheByAccount instanceof Map)) return "";
  const cached = state.snapshotCacheByAccount.get(key);
  return String(cached && cached.fetchTime || "").trim();
}

function getAccountRowByUsername(username) {
  const key = String(username || "").trim();
  if (!key) return null;
  const accounts = Array.isArray(state.accounts) ? state.accounts : [];
  return accounts.find((a) => String(a && a.username || "").trim() === key) || null;
}

async function ensureSnapshotCachedForAccount(username) {
  const key = String(username || "").trim();
  if (!key) return;
  if (hasCachedSnapshotForAccount(key)) return;
  try {
    const data = await api(`/api/snapshot/account?username=${encodeURIComponent(key)}`);
    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (!rows.length) return;
    cacheSnapshotForAccount(key, {
      rows,
      component: data.component || {summary_map: {}, item_map: {}},
      snapshotPath: data.snapshot && data.snapshot.path ? data.snapshot.path : "",
      fetchTime: String(data.fetch_time || "").trim(),
      connected: false,
      authState: String(data.auth_state || "").trim() || "normal",
      authReason: String(data.auth_reason || "").trim()
    });
  } catch (_) {
    // 离线快照不存在，静默忽略
  }
}

async function ensureBatchCraftAccountsCached() {
  const uncached = state.batchCraftAccounts.filter((u) => !hasCachedSnapshotForAccount(u));
  if (!uncached.length) return;
  await Promise.allSettled(uncached.map((u) => ensureSnapshotCachedForAccount(u)));
  renderBatchCraftPage();
}

async function addBatchCraftAccount(username) {
  const key = String(username || "").trim();
  if (!key) return;
  if (state.batchCraftAccounts.includes(key)) return;
  state.batchCraftAccounts.push(key);
  renderBatchCraftPage();
  await ensureSnapshotCachedForAccount(key);
  renderBatchCraftPage();
}

function removeBatchCraftAccount(username) {
  const key = String(username || "").trim();
  state.batchCraftAccounts = state.batchCraftAccounts.filter((u) => u !== key);
  state.batchCraftQueue = state.batchCraftQueue.filter((e) => e.username !== key);
  renderBatchCraftPage();
}

function clearBatchCraftAccounts() {
  state.batchCraftAccounts = [];
  state.batchCraftQueue = [];
  renderBatchCraftPage();
}

function clearBatchCraftQueue() {
  state.batchCraftQueue = [];
  renderBatchCraftPage();
}

function renderBatchCraftAccountCards() {
  if (!ui.batchCraftAccountCards) return;
  ui.batchCraftAccountCards.replaceChildren();
  for (const username of state.batchCraftAccounts) {
    const row = getAccountRowByUsername(username);
    const displayName = (row && displayAccountName(row)) || username;
    const avatarUrl = String(row && row.avatar_url || "").trim();
    const fetchTime = getCachedFetchTimeForAccount(username);
    const isActive = username === state.batchCraftActiveAccount;

    const card = document.createElement("div");
    card.className = `batch-craft-account-card${isActive ? " active" : ""}`;

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "batch-craft-account-card-avatar";
    if (avatarUrl) {
      const img = document.createElement("img");
      img.src = avatarUrl;
      img.alt = displayName;
      img.loading = "lazy";
      img.onerror = () => {
        avatarWrap.replaceChildren();
        const fb = document.createElement("span");
        fb.textContent = (displayName || "?").slice(0, 1).toUpperCase();
        avatarWrap.append(fb);
      };
      avatarWrap.append(img);
    } else {
      const fb = document.createElement("span");
      fb.textContent = (displayName || "?").slice(0, 1).toUpperCase();
      avatarWrap.append(fb);
    }

    const info = document.createElement("div");
    info.className = "batch-craft-account-card-info";
    const nameEl = document.createElement("div");
    nameEl.className = "batch-craft-account-card-name";
    nameEl.textContent = displayName;
    nameEl.title = displayName;
    const timeEl = document.createElement("div");
    timeEl.className = "batch-craft-account-card-time";
    timeEl.textContent = fetchTime ? `刷新：${fetchTime}` : "未刷新";
    info.append(nameEl, timeEl);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "batch-craft-account-card-remove";
    removeBtn.title = "移除";
    removeBtn.textContent = "×";
    removeBtn.disabled = !!state.batchCraftBusy;
    removeBtn.onclick = (evt) => {
      evt.stopPropagation();
      if (state.batchCraftBusy) return;
      removeBatchCraftAccount(username);
    };

    card.append(avatarWrap, info, removeBtn);
    ui.batchCraftAccountCards.append(card);
  }
}

function getAvailableBatchCraftAccounts() {
  const accounts = Array.isArray(state.accounts) ? state.accounts : [];
  const added = new Set(state.batchCraftAccounts);
  return accounts.filter((a) => {
    const username = String(a && a.username || "").trim();
    return username && !added.has(username);
  });
}

function placeBatchCraftAccountListbox() {
  if (!state.batchCraftAccountPickerOpen || !ui.batchCraftAccountListbox || !ui.batchCraftAddAccountBtn) return;
  const rect = ui.batchCraftAddAccountBtn.getBoundingClientRect();
  const panel = ui.batchCraftAccountListbox;
  const gap = 6;
  const panelWidth = panel.offsetWidth || 180;
  const panelHeight = panel.offsetHeight || 0;
  const maxLeft = Math.max(8, window.innerWidth - panelWidth - 8);
  const left = Math.max(8, Math.min(rect.left, maxLeft));
  let top = rect.bottom + gap;
  if (top + panelHeight > window.innerHeight - 8) {
    top = Math.max(8, rect.top - panelHeight - gap);
  }
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function renderBatchCraftAccountListbox() {
  if (!ui.batchCraftAccountListbox) return;
  ui.batchCraftAccountListbox.replaceChildren();
  const available = getAvailableBatchCraftAccounts();
  if (!available.length) {
    const empty = document.createElement("div");
    empty.className = "batch-craft-account-option empty";
    empty.setAttribute("role", "option");
    empty.setAttribute("aria-disabled", "true");
    empty.textContent = "无可添加账号";
    ui.batchCraftAccountListbox.append(empty);
    return;
  }
  for (const row of available) {
    const username = String(row && row.username || "").trim();
    if (!username) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "batch-craft-account-option";
    btn.setAttribute("role", "option");
    btn.dataset.username = username;
    btn.textContent = displayAccountName(row) || username;
    btn.title = username;
    btn.disabled = !!state.batchCraftBusy;
    btn.onclick = (evt) => {
      evt.stopPropagation();
      if (state.batchCraftBusy) return;
      closeBatchCraftAccountPicker();
      void addBatchCraftAccount(username);
    };
    ui.batchCraftAccountListbox.append(btn);
  }
}

function setBatchCraftAccountPickerOpen(open) {
  state.batchCraftAccountPickerOpen = !!open && !state.batchCraftBusy;
  if (state.batchCraftAccountPickerOpen && state.batchCraftSettingsOpen) setBatchCraftSettingsPanelOpen(false);
  if (state.batchCraftAccountPickerOpen) renderBatchCraftAccountPicker();
  if (ui.batchCraftAccountPicker) ui.batchCraftAccountPicker.classList.add("hidden");
  if (ui.batchCraftAccountListbox) {
    ui.batchCraftAccountListbox.classList.toggle("hidden", !state.batchCraftAccountPickerOpen);
    ui.batchCraftAccountListbox.setAttribute("aria-hidden", state.batchCraftAccountPickerOpen ? "false" : "true");
    if (state.batchCraftAccountPickerOpen) {
      placeBatchCraftAccountListbox();
      const firstOption = ui.batchCraftAccountListbox.querySelector(".batch-craft-account-option:not(.empty)");
      if (firstOption && typeof firstOption.focus === "function") firstOption.focus();
    }
  }
  if (ui.batchCraftAddAccountBtn) {
    ui.batchCraftAddAccountBtn.classList.toggle("active", state.batchCraftAccountPickerOpen);
    ui.batchCraftAddAccountBtn.setAttribute("aria-expanded", state.batchCraftAccountPickerOpen ? "true" : "false");
  }
}

function closeBatchCraftAccountPicker() {
  setBatchCraftAccountPickerOpen(false);
}

function placeBatchCraftSettingsPanel() {
  if (!state.batchCraftSettingsOpen || !ui.batchCraftSettingsPanel || !ui.batchCraftSettingsBtn) return;
  const rect = ui.batchCraftSettingsBtn.getBoundingClientRect();
  const panel = ui.batchCraftSettingsPanel;
  const gap = 6;
  const panelWidth = panel.offsetWidth || 220;
  const panelHeight = panel.offsetHeight || 0;
  const maxLeft = Math.max(8, window.innerWidth - panelWidth - 8);
  const left = Math.max(8, Math.min(rect.right - panelWidth, maxLeft));
  let top = rect.bottom + gap;
  if (top + panelHeight > window.innerHeight - 8) {
    top = Math.max(8, rect.top - panelHeight - gap);
  }
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function setBatchCraftSettingsPanelOpen(open) {
  state.batchCraftSettingsOpen = !!open;
  if (state.batchCraftSettingsOpen && state.batchCraftAccountPickerOpen) closeBatchCraftAccountPicker();
  if (ui.batchCraftSettingsPanel) {
    ui.batchCraftSettingsPanel.classList.toggle("hidden", !state.batchCraftSettingsOpen);
    if (state.batchCraftSettingsOpen) {
      syncBatchCraftSettingsControls();
      placeBatchCraftSettingsPanel();
    }
  }
  if (ui.batchCraftSettingsBtn) ui.batchCraftSettingsBtn.classList.toggle("active", state.batchCraftSettingsOpen);
}

function renderBatchCraftAccountPicker() {
  if (!ui.batchCraftAccountPicker) return;
  ui.batchCraftAccountPicker.replaceChildren();
  const available = getAvailableBatchCraftAccounts();
  if (!available.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "无可添加账号";
    ui.batchCraftAccountPicker.append(opt);
    renderBatchCraftAccountListbox();
    return;
  }
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "选择账号...";
  ui.batchCraftAccountPicker.append(placeholder);
  for (const row of available) {
    const opt = document.createElement("option");
    opt.value = String(row.username || "").trim();
    opt.textContent = displayAccountName(row) || String(row.username || "").trim();
    ui.batchCraftAccountPicker.append(opt);
  }
  renderBatchCraftAccountListbox();
}

function renderBatchCraftPresetList() {
  if (!ui.batchCraftPresetList) return;
  ui.batchCraftPresetList.replaceChildren();
  const list = Array.isArray(state.craftAssistPresets) ? state.craftAssistPresets : [];
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "batch-craft-preset-empty";
    empty.textContent = "暂无配方，请先在炼金汰换页面保存";
    ui.batchCraftPresetList.append(empty);
    return;
  }
  for (const preset of list) {
    const id = String(preset && preset.id || "").trim();
    const item = document.createElement("div");
    item.className = `batch-craft-preset-item${id === state.batchCraftSelectedPresetId ? " selected" : ""}`;

    const nameSpan = document.createElement("span");
    nameSpan.className = "batch-craft-preset-item-name";
    nameSpan.textContent = String(preset && preset.name || "未命名配置");
    item.title = nameSpan.textContent;

    const expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.className = "batch-craft-preset-expand-btn";
    expandBtn.title = "查看配方物品";
    expandBtn.innerHTML = '<svg viewBox="0 0 6 10"><path d="M0 0L6 5L0 10Z"/></svg>';
    expandBtn.onclick = (e) => {
      e.stopPropagation();
      showBatchCraftPresetPopover(preset, expandBtn);
    };

    item.append(nameSpan, expandBtn);
    item.onclick = () => {
      state.batchCraftSelectedPresetId = id;
      renderBatchCraftPresetList();
    };
    ui.batchCraftPresetList.append(item);
  }
}

/* 配方物品浮窗 */
let _batchCraftPopover = null;
let _batchCraftPopoverCleanup = null;
function closeBatchCraftPresetPopover() {
  if (_batchCraftPopover && _batchCraftPopover.parentNode) {
    _batchCraftPopover.parentNode.removeChild(_batchCraftPopover);
  }
  _batchCraftPopover = null;
  if (_batchCraftPopoverCleanup) {
    _batchCraftPopoverCleanup();
    _batchCraftPopoverCleanup = null;
  }
}
function showBatchCraftPresetPopover(preset, anchorEl) {
  closeBatchCraftPresetPopover();
  const materials = Array.isArray(preset && preset.materials) ? preset.materials : [];
  const pop = document.createElement("div");
  pop.className = "batch-craft-preset-popover";

  const title = document.createElement("div");
  title.className = "batch-craft-preset-popover-title";
  title.textContent = String(preset && preset.name || "未命名配置");
  pop.append(title);

  let hasItems = false;
  for (const mat of materials) {
    const role = normalizeCraftAssistRole(mat && mat.role);
    const roleText = role === "main" ? "主料" : "辅料";
    const names = Array.isArray(mat && mat.items) && mat.items.length
      ? mat.items.map((it) => String(it && it.name || "").trim()).filter(Boolean)
      : Array.isArray(mat && mat.names) ? mat.names.map((n) => String(n || "").trim()).filter(Boolean)
      : mat && mat.name ? [String(mat.name).trim()] : [];
    const count = mat && mat.count != null ? mat.count : 1;
    if (!names.length) continue;
    hasItems = true;

    /* --- role group card --- */
    const group = document.createElement("div");
    group.className = "batch-craft-popover-group";

    const head = document.createElement("div");
    head.className = "batch-craft-popover-group-head";
    const badge = document.createElement("span");
    badge.className = `batch-craft-popover-role-tag ${role}`;
    badge.textContent = roleText;
    head.append(badge);

    /* qty control */
    const qtyShell = document.createElement("div");
    qtyShell.className = "batch-craft-popover-qty-shell";
    const qtyLabel = document.createElement("span");
    qtyLabel.className = "batch-craft-popover-qty-label";
    qtyLabel.textContent = "数量";
    const qtyDec = document.createElement("button");
    qtyDec.type = "button";
    qtyDec.className = "batch-craft-popover-qty-step decrement";
    qtyDec.textContent = "−";
    qtyDec.title = "减少数量";
    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.className = "batch-craft-popover-qty-input";
    qtyInput.min = "1";
    qtyInput.max = "10";
    qtyInput.step = "1";
    qtyInput.value = String(count);
    const qtyInc = document.createElement("button");
    qtyInc.type = "button";
    qtyInc.className = "batch-craft-popover-qty-step increment";
    qtyInc.textContent = "+";
    qtyInc.title = "增加数量";

    const commitQty = (val) => {
      const n = Math.max(1, Math.min(10, Math.round(Number(val) || 1)));
      qtyInput.value = String(n);
      mat.count = n;
      saveCraftAssistPresetsToStorage();
    };
    qtyDec.onclick = (e) => { e.stopPropagation(); commitQty(Number(qtyInput.value) - 1); };
    qtyInc.onclick = (e) => { e.stopPropagation(); commitQty(Number(qtyInput.value) + 1); };
    qtyInput.onchange = () => commitQty(qtyInput.value);
    qtyInput.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); commitQty(qtyInput.value); qtyInput.blur(); } };

    qtyShell.append(qtyLabel, qtyDec, qtyInput, qtyInc);
    head.append(qtyShell);
    group.append(head);

    /* item cards */
    const cardList = document.createElement("div");
    cardList.className = "batch-craft-popover-card-list";
    for (const n of names) {
      const card = document.createElement("div");
      card.className = "batch-craft-popover-card";
      card.textContent = n;
      card.title = n;
      cardList.append(card);
    }
    group.append(cardList);
    pop.append(group);
  }
  if (!hasItems) {
    const empty = document.createElement("div");
    empty.className = "batch-craft-preset-popover-empty";
    empty.textContent = "无物品数据";
    pop.append(empty);
  }

  document.body.append(pop);
  _batchCraftPopover = pop;

  /* 定位：锚点右侧 */
  const rect = anchorEl.getBoundingClientRect();
  let left = rect.right + 6;
  let top = rect.top;
  const popW = pop.offsetWidth;
  const popH = pop.offsetHeight;
  if (left + popW > window.innerWidth - 8) left = rect.left - popW - 6;
  if (top + popH > window.innerHeight - 8) top = Math.max(8, window.innerHeight - popH - 8);
  pop.style.position = "fixed";
  pop.style.left = left + "px";
  pop.style.top = top + "px";

  /* 点击外部关闭 */
  const onClickOutside = (e) => {
    if (pop.contains(e.target) || anchorEl.contains(e.target)) return;
    closeBatchCraftPresetPopover();
  };
  setTimeout(() => document.addEventListener("pointerdown", onClickOutside), 0);
  _batchCraftPopoverCleanup = () => document.removeEventListener("pointerdown", onClickOutside);
}

function renderBatchCraftQueue() {
  if (!ui.batchCraftQueueList) return;
  ui.batchCraftQueueList.replaceChildren();
  const queue = Array.isArray(state.batchCraftQueue) ? state.batchCraftQueue : [];
  if (!queue.length) {
    const empty = document.createElement("div");
    empty.className = "batch-craft-queue-empty";
    empty.textContent = "选择配方后点击「快捷选材」生成配方";
    ui.batchCraftQueueList.append(empty);
    return;
  }
  let globalIdx = 0;
  for (const entry of queue) {
    const accountRows = getCraftRowsForAccount(entry.username);
    const rowsById = buildRowsByAssetId(accountRows);
    const accountRow = getAccountRowByUsername(entry.username);
    const accountDisplayName = (accountRow && displayAccountName(accountRow)) || entry.username;
    for (const recipe of entry.recipes) {
      globalIdx += 1;
      const itemIds = Array.isArray(recipe.item_ids) ? recipe.item_ids : [];
      const recipeRows = itemIds.map((id) => rowsById.get(id)).filter(Boolean);

      /* ── done: 与炼金汰换页对齐，直接渲染产物卡片 ── */
      if (recipe.status === "done") {
        const doneRow = document.createElement("div");
        doneRow.className = `craft-queue-item done${!state.batchCraftBusy ? " deletable" : ""}`;
        const gainedIds = normalizeCraftRecipeItemIds(recipe.result && recipe.result.gained_ids);
        const gainedRows = gainedIds.map((id) => rowsById.get(id)).filter(Boolean);
        if (gainedRows.length) {
          const cardGrid = document.createElement("div");
          cardGrid.className = "craft-queue-result-card-grid";
          for (const gr of gainedRows) {
            cardGrid.append(makeCraftQueueResultCardNode(gr));
          }
          doneRow.append(cardGrid);
        } else {
          const resultWrap = document.createElement("div");
          resultWrap.className = "craft-queue-result";
          const resultTitle = document.createElement("div");
          resultTitle.className = "craft-queue-result-title";
          resultTitle.textContent = "产物：待确认";
          resultWrap.append(resultTitle);
          doneRow.append(resultWrap);
        }
        const accountLabel = document.createElement("div");
        accountLabel.className = "batch-craft-account-label";
        accountLabel.textContent = accountDisplayName;
        doneRow.append(accountLabel);
        if (!state.batchCraftBusy) {
          const removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "craft-queue-card-delete craft-queue-card-delete-floating";
          removeBtn.title = "删除该配方";
          removeBtn.setAttribute("aria-label", "删除该配方");
          removeBtn.textContent = "−";
          removeBtn.onclick = () => {
            entry.recipes = entry.recipes.filter((r) => r.id !== recipe.id);
            if (!entry.recipes.length) {
              state.batchCraftQueue = state.batchCraftQueue.filter((e) => e !== entry);
            }
            renderBatchCraftQueue();
          };
          doneRow.append(removeBtn);
        }
        ui.batchCraftQueueList.append(doneRow);
        continue;
      }

      /* ── pending / failed: 保持原有 slot grid 渲染 ── */
      const title = buildPendingCraftQueueTitle({pendingIndex: globalIdx, recipeRows});
      const statusClass = recipe.status === "failed" ? " prepare-failed" : "";
      const card = renderCraftQueueSlots({
        title,
        itemIds,
        rowsById,
        showDeleteAction: !state.batchCraftBusy,
        onRemove: () => {
          entry.recipes = entry.recipes.filter((r) => r.id !== recipe.id);
          if (!entry.recipes.length) {
            state.batchCraftQueue = state.batchCraftQueue.filter((e) => e !== entry);
          }
          renderBatchCraftQueue();
        },
        active: false,
        selectable: true,
        onActivate: () => {
          selectCraftPredictorContext({type: "recipe", id: recipe.id, label: accountDisplayName + " 配方", autoOpen: false, preferredRowsById: rowsById});
        },
        extraClass: statusClass
      });
      const accountLabel = document.createElement("div");
      accountLabel.className = "batch-craft-account-label";
      accountLabel.textContent = accountDisplayName;
      card.append(accountLabel);
      ui.batchCraftQueueList.append(card);
    }
  }
  if (ui.batchCraftQueueTitle) {
    const totalRecipes = queue.reduce((s, e) => s + e.recipes.length, 0);
    ui.batchCraftQueueTitle.textContent = `配方预览（${totalRecipes} 组）`;
  }
}

function syncBatchCraftSettingsControls() {
  if (ui.batchCraftUseComponentItems) ui.batchCraftUseComponentItems.checked = !!state.batchCraftUseComponentItems;
  if (ui.batchCraftIncludeCooling) ui.batchCraftIncludeCooling.checked = !!state.batchCraftIncludeCooling;
  if (ui.batchCraftFastMode) ui.batchCraftFastMode.checked = !!state.batchCraftFastMode;
  if (ui.batchCraftApproachMode) ui.batchCraftApproachMode.checked = !!state.batchCraftApproachMode;
  const wearOffset = normalizeCraftAssistWearOffset(state.batchCraftWearOffset, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET);
  state.batchCraftWearOffset = wearOffset;
  if (ui.batchCraftWearOffsetPct && document.activeElement !== ui.batchCraftWearOffsetPct) {
    ui.batchCraftWearOffsetPct.value = craftAssistWearOffsetText(wearOffset);
  }
}

function renderBatchCraftPage() {
  if (!ui.batchCraftPage) return;
  if (state.batchCraftBusy && state.batchCraftAccountPickerOpen) closeBatchCraftAccountPicker();
  renderBatchCraftAccountCards();
  renderBatchCraftAccountPicker();
  renderBatchCraftPresetList();
  renderBatchCraftQueue();
  if (ui.batchCraftActiveAccountText) {
    ui.batchCraftActiveAccountText.textContent = state.batchCraftActiveAccount
      ? `正在处理：${state.batchCraftActiveAccount}`
      : "";
  }
  if (ui.batchCraftLimitInput) {
    ui.batchCraftLimitInput.value = String(state.batchCraftLimit || 10);
  }
  const busy = !!state.batchCraftBusy;
  if (ui.batchCraftRunSelectBtn) ui.batchCraftRunSelectBtn.disabled = busy;
  if (ui.batchCraftExecuteBtn) ui.batchCraftExecuteBtn.disabled = busy;
  if (ui.batchCraftAddAccountBtn) ui.batchCraftAddAccountBtn.disabled = busy;
  if (ui.batchCraftClearAccountsBtn) ui.batchCraftClearAccountsBtn.disabled = busy;
  if (ui.batchCraftClearQueueBtn) ui.batchCraftClearQueueBtn.disabled = busy;
  if (ui.batchCraftStatusText) {
    ui.batchCraftStatusText.textContent = state.batchCraftStatusText;
    ui.batchCraftStatusText.classList.toggle("error", !!state.batchCraftStatusError);
  }
  syncBatchCraftSettingsControls();
  if (typeof renderCraftPredictorPanel === "function") renderCraftPredictorPanel();
}

async function callBatchCraftAssistSelectForAccount(username, draftSnapshot, existingItemIds) {
  const accountRows = getCraftRowsForAccount(username);
  if (!accountRows.length) return null;
  const targetWearPair = resolveCraftAssistTargetWearPair(draftSnapshot.target_wear, draftSnapshot.target_wear_raw);
  const targetValue = targetWearPair ? targetWearPair.target_wear : null;
  const targetWearRaw = targetWearPair ? targetWearPair.target_wear_raw : "";
  const materials = normalizeCraftAssistMaterialsForRun({
    materials: draftSnapshot.materials,
    targetWear: targetValue,
    wearFilterMode: normalizeCraftAssistFilterMode(draftSnapshot.wear_filter_mode)
  });
  if (!materials.length || targetValue == null) return null;
  const mode = craftAssistTargetCountFromMaterials(materials);
  const summarizeDebugMaterials = (list) => {
    return (Array.isArray(list) ? list : []).map((material) => {
      const base = material && typeof material === "object" ? material : {};
      const fallbackItems = Array.isArray(base.names)
        ? base.names.map((name) => ({
            name,
            wear_filter_mode: base.wear_filter_mode,
            wear_min: base.wear_min,
            wear_max: base.wear_max
          }))
        : [];
      const rawItems = Array.isArray(base.items) && base.items.length ? base.items : fallbackItems;
      const itemNames = rawItems
        .map((item) => String(item && item.name || "").trim())
        .filter(Boolean);
      const wearRanges = rawItems
        .map((item) => {
          const wearMin = Number(item && item.wear_min);
          const wearMax = Number(item && item.wear_max);
          return {
            name: String(item && item.name || "").trim(),
            wear_filter_mode: String(item && item.wear_filter_mode || base.wear_filter_mode || "").trim(),
            wear_min: Number.isFinite(wearMin) ? wearMin : null,
            wear_max: Number.isFinite(wearMax) ? wearMax : null
          };
        })
        .filter((entry) => entry.name || entry.wear_filter_mode || entry.wear_min != null || entry.wear_max != null);
      return {
        role: String(base.role || "").trim() || "main",
        count: Number(base.count || 0) || 0,
        item_names: itemNames,
        wear_ranges: wearRanges
      };
    }).filter((entry) => entry.item_names.length || entry.wear_ranges.length || entry.count > 0);
  };
  const payload = {
    username,
    target_wear: targetValue,
    target_wear_raw: targetWearRaw,
    wear_approach_mode: state.batchCraftApproachMode ? "infinite" : "below",
    materials,
    use_component_items: !!state.batchCraftUseComponentItems,
    include_cooling: !!state.batchCraftIncludeCooling,
    wear_offset: normalizeCraftAssistWearOffset(state.batchCraftWearOffset, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET),
    blocked_ids: normalizeCraftRecipeItemIds(existingItemIds),
    enable_fast_craft_assist: !!state.batchCraftFastMode
  };
  try {
    const data = await api("/api/craft/assist-select", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const itemIds = normalizeCraftRecipeItemIds(data && (data.item_ids || data.itemIds));
    if (itemIds.length !== mode) return null;
    return {
      id: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      item_ids: itemIds,
      status: "pending",
      result: null
    };
  } catch (err) {
    const data = err && err.data && typeof err.data === "object" ? err.data : null;
    const message = String(data && data.message || err && err.message || "辅助选材暂时失败，请重试。").trim()
      || "辅助选材暂时失败，请重试。";
    const detail = String(data && data.detail || err && err.message || "").trim() || message;
    const code = String(data && data.code || err && err.code || "").trim();
    const occupiedItemIdsLength = Array.isArray(existingItemIds) ? existingItemIds.length : 0;
    console.warn("[craft-assist][batch] account selection failed", {
      account: username,
      target_wear: targetValue,
      target_wear_raw: targetWearRaw,
      wear_approach_mode: payload.wear_approach_mode,
      wear_offset: payload.wear_offset,
      enable_fast_craft_assist: payload.enable_fast_craft_assist,
      use_component_items: payload.use_component_items,
      include_cooling: payload.include_cooling,
      blocked_ids_length: Array.isArray(payload.blocked_ids) ? payload.blocked_ids.length : 0,
      occupied_item_ids_length: occupiedItemIdsLength,
      materials: summarizeDebugMaterials(materials),
      code,
      message,
      detail
    });
    return {
      failed: true,
      username,
      code,
      message,
      detail
    };
  }
}

async function runBatchCraftAssistSelect() {
  if (state.batchCraftBusy) return;
  if (!state.batchCraftAccounts.length) {
    setBatchCraftStatus("请先添加参与账号", true);
    return;
  }
  const presetId = String(state.batchCraftSelectedPresetId || "").trim();
  if (!presetId) {
    setBatchCraftStatus("请先选择一个选材配方", true);
    return;
  }
  const presetList = Array.isArray(state.craftAssistPresets) ? state.craftAssistPresets : [];
  const preset = presetList.find((p) => String(p && p.id || "").trim() === presetId);
  if (!preset) {
    setBatchCraftStatus("所选配方不存在", true);
    return;
  }
  const sanitized = sanitizeCraftAssistPresetPayload(preset);
  if (!sanitized) {
    setBatchCraftStatus("配方数据异常", true);
    return;
  }
  const missingAccounts = state.batchCraftAccounts.filter((u) => !hasCachedSnapshotForAccount(u));
  if (missingAccounts.length) {
    setBatchCraftStatus(`以下账号无库存缓存：${missingAccounts.join(", ")}`, true);
    return;
  }
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(state.batchCraftLimit) || 10)));
  const existingQueue = Array.isArray(state.batchCraftQueue) ? state.batchCraftQueue : [];
  state.batchCraftBusy = true;
  setBatchCraftStatus("正在并行选材...");
  renderBatchCraftPage();

  const draftSnapshot = {
    target_wear: sanitized.target_wear,
    target_wear_raw: sanitized.target_wear_raw,
    wear_filter_mode: sanitized.wear_filter_mode,
    materials: sanitized.materials,
    pick_role: "main"
  };

  // 并行：所有账号同时选材
  const promises = state.batchCraftAccounts.map(async (username) => {
    const accountEntry = {username, recipes: []};
    const failures = [];
    const existingEntry = existingQueue.find((entry) => String(entry && entry.username || "").trim() === username);
    const usedItemIds = existingEntry && Array.isArray(existingEntry.recipes)
      ? existingEntry.recipes.flatMap((recipe) => normalizeCraftRecipeItemIds(recipe && recipe.item_ids))
      : [];
    // 每个账号最多尝试 limit 次（总数上限由后面统一截断）
    for (let r = 0; r < limit; r++) {
      const result = await callBatchCraftAssistSelectForAccount(username, draftSnapshot, usedItemIds);
      if (!result) break;
      if (result.failed) {
        failures.push(result);
        break;
      }
      accountEntry.recipes.push(result);
      usedItemIds.push(...result.item_ids);
    }
    accountEntry.failures = failures;
    return accountEntry;
  });

  const results = await Promise.allSettled(promises);
  const allEntries = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.recipes.length > 0) {
      allEntries.push(result.value);
    }
  }
  const failureSummaries = results
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => Array.isArray(result.value && result.value.failures) ? result.value.failures : [])
    .map((failure) => {
      const account = String(failure && failure.username || "").trim();
      const message = String(failure && failure.message || "").trim();
      return account && message ? `${account}：${message}` : message || account;
    })
    .filter(Boolean);
  const failureSummaryText = failureSummaries.slice(0, 3).join("；");
  const hiddenFailureCount = Math.max(0, failureSummaries.length - 3);
  const failureSuffix = hiddenFailureCount > 0 ? `；另 ${hiddenFailureCount} 个账号失败` : "";

  // 按总数上限截断
  let totalCount = 0;
  for (const entry of allEntries) {
    const remaining = limit - totalCount;
    if (remaining <= 0) {
      entry.recipes = [];
    } else if (entry.recipes.length > remaining) {
      entry.recipes = entry.recipes.slice(0, remaining);
    }
    totalCount += entry.recipes.length;
  }
  const mergedEntries = existingQueue
    .map((entry) => ({
      ...entry,
      recipes: Array.isArray(entry && entry.recipes) ? entry.recipes.slice() : []
    }))
    .filter((entry) => String(entry && entry.username || "").trim() && entry.recipes.length > 0);
  for (const entry of allEntries.filter((e) => e.recipes.length > 0)) {
    const username = String(entry && entry.username || "").trim();
    const existingEntry = mergedEntries.find((item) => String(item && item.username || "").trim() === username);
    if (existingEntry) {
      existingEntry.recipes.push(...entry.recipes);
    } else {
      mergedEntries.push(entry);
    }
  }
  state.batchCraftQueue = mergedEntries;

  state.batchCraftBusy = false;
  const totalRecipes = state.batchCraftQueue.reduce((s, e) => s + e.recipes.length, 0);
  if (failureSummaries.length && totalRecipes <= 0) {
    setBatchCraftStatus(`选材失败：${failureSummaries.length} 个账号。${failureSummaryText}${failureSuffix}`, true);
    renderBatchCraftPage();
    return;
  }
  if (failureSummaries.length) {
    setBatchCraftStatus(`部分账号选材失败：失败 ${failureSummaries.length} 个账号。${failureSummaryText}${failureSuffix}。已选 ${state.batchCraftQueue.length} 个账号，共 ${totalRecipes} 组配方`, true);
    renderBatchCraftPage();
    return;
  }
  setBatchCraftStatus(`选材完成：${state.batchCraftQueue.length} 个账号，共 ${totalRecipes} 组配方`);
  renderBatchCraftPage();
}

async function runBatchCraftExecution() {
  if (state.batchCraftBusy) return;
  const pendingEntries = state.batchCraftQueue.filter((e) => e.recipes.some((r) => r.status === "pending"));
  if (!pendingEntries.length) {
    setBatchCraftStatus("无待执行配方", true);
    return;
  }
  function applyBatchCraftSuccessSnapshot(username, payload) {
    const accountName = String(username || "").trim();
    if (!accountName || !(payload && Array.isArray(payload.rows))) return;
    const currentAccount = String(state.currentAccountUsername || "").trim();
    const previousCached = state.snapshotCacheByAccount instanceof Map
      ? state.snapshotCacheByAccount.get(accountName)
      : null;
    const component = payload.component && typeof payload.component === "object"
      ? payload.component
      : {summary_map: {}, item_map: {}};
    const snapshotPath = String(
      payload.snapshot_path
      || (previousCached && previousCached.snapshotPath)
      || (accountName === currentAccount ? state.snapshotPath : "")
      || ""
    ).trim();
    const fetchTime = String(
      payload.fetch_time
      || (previousCached && previousCached.fetchTime)
      || (accountName === currentAccount ? state.fetchTime : "")
      || ""
    ).trim();
    if (accountName === currentAccount) {
      const keepSelectedIds = state.selectedComponentItemIds instanceof Set
        ? new Set(state.selectedComponentItemIds)
        : null;
      setRows(
        payload.rows,
        component,
        snapshotPath,
        keepSelectedIds && keepSelectedIds.size ? {keepSelectedIds} : {}
      );
      if (fetchTime) state.fetchTime = fetchTime;
      syncInventoryTop();
    }
    cacheSnapshotForAccount(accountName, {
      rows: payload.rows,
      component,
      snapshotPath,
      fetchTime,
      connected: accountName === currentAccount
        ? true
        : !!(previousCached && previousCached.connected),
      authState: String(previousCached && previousCached.authState || "").trim() || "normal",
      authReason: String(previousCached && previousCached.authReason || "").trim()
    });
  }
  const totalRecipes = pendingEntries.reduce((s, e) => s + e.recipes.filter((r) => r.status === "pending").length, 0);
  const ok = await openConfirmModal({
    title: "确认执行多账号汰换",
    message: `即将对 ${pendingEntries.length} 个账号执行共 ${totalRecipes} 组配方，确认？`,
    confirmText: "确认执行",
    cancelText: "取消"
  });
  if (!ok) {
    setBatchCraftStatus("已取消执行");
    return;
  }

  state.batchCraftBusy = true;
  let completedCount = 0;
  let failedCount = 0;
  setBatchCraftOverlay(true, {title: "正在执行多账号汰换...", detail: "准备中"});
  renderBatchCraftPage();

  for (let ai = 0; ai < pendingEntries.length; ai++) {
    const entry = pendingEntries[ai];
    const pendingRecipes = entry.recipes.filter((r) => r.status === "pending");
    if (!pendingRecipes.length) continue;

    state.batchCraftActiveAccount = entry.username;
    renderBatchCraftAccountCards();

    // 连接该账号
    setBatchCraftOverlay(true, {
      title: `正在连接账号 ${entry.username}（${ai + 1}/${pendingEntries.length}）`,
      detail: "连接中...",
      percent: (ai / pendingEntries.length) * 100
    });

    try {
      await api("/api/accounts/active", {
        method: "POST",
        body: JSON.stringify({username: entry.username})
      });
      const refreshResult = await doRefresh({
        usernameOverride: entry.username,
        force: true,
        silentRateLimit: true,
        silentInfo: true
      });
      if (!refreshResult || !refreshResult.ok) {
        for (const recipe of pendingRecipes) {
          recipe.status = "failed";
          recipe.result = {error: "连接失败"};
          failedCount++;
        }
        renderBatchCraftQueue();
        continue;
      }
    } catch (err) {
      for (const recipe of pendingRecipes) {
        recipe.status = "failed";
        recipe.result = {error: err.message};
        failedCount++;
      }
      renderBatchCraftQueue();
      continue;
    }

    // 逐个执行配方
    for (let ri = 0; ri < pendingRecipes.length; ri++) {
      const recipe = pendingRecipes[ri];
      const overallDone = completedCount + failedCount;
      const overallTotal = totalRecipes;
      setBatchCraftOverlay(true, {
        title: `${entry.username}：执行第 ${ri + 1}/${pendingRecipes.length} 组`,
        detail: `总进度 ${overallDone}/${overallTotal}`,
        percent: (overallDone / overallTotal) * 100
      });

      try {
        const data = await api("/api/craft/tradeup", {
          method: "POST",
          body: JSON.stringify({
            username: entry.username,
            allow_cooling: !!state.craftIncludeCooling,
            use_component_items: false,
            recipes: [{
              queue_index: ri,
              item_ids: recipe.item_ids,
              item_sources: {}
            }]
          })
        });
        applyBatchCraftSuccessSnapshot(entry.username, data);
        recipe.status = "done";
        recipe.result = data;
        completedCount++;
      } catch (err) {
        recipe.status = "failed";
        recipe.result = {error: err.message};
        failedCount++;
      }
      renderBatchCraftQueue();
    }
  }

  state.batchCraftActiveAccount = "";
  state.batchCraftBusy = false;
  setBatchCraftOverlay(false);
  setBatchCraftStatus(`执行完成：成功 ${completedCount} 组，失败 ${failedCount} 组`);
  renderBatchCraftPage();
}

function bindBatchCraftEvents() {
  if (ui.batchCraftAddAccountBtn) {
    ui.batchCraftAddAccountBtn.onclick = (evt) => {
      evt.stopPropagation();
      if (state.batchCraftBusy) return;
      if (!ui.batchCraftAccountListbox) return;
      setBatchCraftAccountPickerOpen(!state.batchCraftAccountPickerOpen);
    };
  }
  if (ui.batchCraftAccountPicker) {
    ui.batchCraftAccountPicker.onchange = () => {
      const value = ui.batchCraftAccountPicker.value;
      if (value) {
        void addBatchCraftAccount(value);
        ui.batchCraftAccountPicker.classList.add("hidden");
        closeBatchCraftAccountPicker();
      }
    };
    ui.batchCraftAccountPicker.onblur = () => {
      setTimeout(() => {
        if (ui.batchCraftAccountPicker) ui.batchCraftAccountPicker.classList.add("hidden");
      }, 150);
    };
  }
  if (ui.batchCraftClearAccountsBtn) {
    ui.batchCraftClearAccountsBtn.onclick = () => {
      if (state.batchCraftBusy) return;
      clearBatchCraftAccounts();
    };
  }
  if (ui.batchCraftLimitInput) {
    ui.batchCraftLimitInput.onchange = () => {
      state.batchCraftLimit = Math.max(1, Math.min(100, Math.trunc(Number(ui.batchCraftLimitInput.value) || 10)));
      ui.batchCraftLimitInput.value = String(state.batchCraftLimit);
    };
  }
  if (ui.batchCraftRunSelectBtn) {
    ui.batchCraftRunSelectBtn.onclick = () => void runBatchCraftAssistSelect();
  }
  if (ui.batchCraftExecuteBtn) {
    ui.batchCraftExecuteBtn.onclick = () => void runBatchCraftExecution();
  }
  if (ui.batchCraftClearQueueBtn) {
    ui.batchCraftClearQueueBtn.onclick = () => {
      if (state.batchCraftBusy) return;
      clearBatchCraftQueue();
    };
  }
  // -- batch craft settings panel --
  if (ui.batchCraftSettingsBtn) {
    ui.batchCraftSettingsBtn.onclick = (evt) => {
      evt.stopPropagation();
      setBatchCraftSettingsPanelOpen(!state.batchCraftSettingsOpen);
    };
  }
  if (ui.batchCraftUseComponentItems) {
    ui.batchCraftUseComponentItems.onchange = () => {
      state.batchCraftUseComponentItems = !!ui.batchCraftUseComponentItems.checked;
      saveBatchCraftUiPrefs();
    };
  }
  if (ui.batchCraftIncludeCooling) {
    ui.batchCraftIncludeCooling.onchange = () => {
      state.batchCraftIncludeCooling = !!ui.batchCraftIncludeCooling.checked;
      saveBatchCraftUiPrefs();
    };
  }
  if (ui.batchCraftFastMode) {
    ui.batchCraftFastMode.onchange = () => {
      state.batchCraftFastMode = !!ui.batchCraftFastMode.checked;
      saveBatchCraftUiPrefs();
    };
  }
  if (ui.batchCraftApproachMode) {
    ui.batchCraftApproachMode.onchange = () => {
      state.batchCraftApproachMode = !!ui.batchCraftApproachMode.checked;
      saveBatchCraftUiPrefs();
    };
  }
  if (ui.batchCraftWearOffsetPct) {
    ui.batchCraftWearOffsetPct.onfocus = () => { ui.batchCraftWearOffsetPct.select(); };
    ui.batchCraftWearOffsetPct.oninput = () => {
      state.batchCraftWearOffset = normalizeCraftAssistWearOffset(ui.batchCraftWearOffsetPct.value, state.batchCraftWearOffset);
    };
    const applyBatchWearOffset = () => {
      const v = normalizeCraftAssistWearOffset(ui.batchCraftWearOffsetPct.value, state.batchCraftWearOffset);
      state.batchCraftWearOffset = v;
      ui.batchCraftWearOffsetPct.value = craftAssistWearOffsetText(v);
      saveBatchCraftUiPrefs();
    };
    ui.batchCraftWearOffsetPct.onchange = applyBatchWearOffset;
    ui.batchCraftWearOffsetPct.onblur = applyBatchWearOffset;
    ui.batchCraftWearOffsetPct.onkeydown = (evt) => {
      if (evt.key !== "Enter") return;
      evt.preventDefault();
      applyBatchWearOffset();
      ui.batchCraftWearOffsetPct.blur();
    };
  }
  if (ui.batchCraftSplitBar) {
    ui.batchCraftSplitBar.onmousedown = (evt) => startBatchCraftSplitDrag(evt);
  }
  document.addEventListener("mousemove", moveBatchCraftSplitDrag);
  document.addEventListener("mouseup", stopBatchCraftSplitDrag);
}

function bindEvents() {
  if (ui.clientAuthLoginTabBtn) {
    ui.clientAuthLoginTabBtn.onclick = () => {
      setClientAuthView("login");
    };
  }
  if (ui.clientAuthRegisterTabBtn) {
    ui.clientAuthRegisterTabBtn.onclick = () => {
      setClientAuthView("register");
    };
  }
  if (ui.clientAuthResetTabBtn) {
    ui.clientAuthResetTabBtn.onclick = () => {
      setClientAuthView("reset");
    };
  }
  if (ui.clientAuthBundleTabBtn) {
    ui.clientAuthBundleTabBtn.onclick = () => {
      setClientAuthView("bundle");
    };
  }
  if (ui.clientLoginSubmitBtn) {
    ui.clientLoginSubmitBtn.onclick = () => {
      void submitClientLogin();
    };
  }
  if (ui.clientLoginPassword) {
    ui.clientLoginPassword.onkeydown = (evt) => {
      if (evt.key !== "Enter") return;
      evt.preventDefault();
      void submitClientLogin();
    };
  }
  if (ui.clientRegisterSendCodeBtn) {
    ui.clientRegisterSendCodeBtn.onclick = () => {
      void sendClientRegisterCode();
    };
  }
  if (ui.clientRegisterSubmitBtn) {
    ui.clientRegisterSubmitBtn.onclick = () => {
      void submitClientRegister();
    };
  }
  if (ui.clientResetSendCodeBtn) {
    ui.clientResetSendCodeBtn.onclick = () => {
      void sendClientResetCode();
    };
  }
  if (ui.clientResetSubmitBtn) {
    ui.clientResetSubmitBtn.onclick = () => {
      void submitClientReset();
    };
  }
  if (ui.licenseImportBtn) {
    ui.licenseImportBtn.onclick = () => {
      void submitLicenseImport();
    };
  }
  if (ui.licenseBundleInput) {
    ui.licenseBundleInput.onkeydown = (evt) => {
      if (evt.key !== "Enter") return;
      if (!evt.ctrlKey && !evt.metaKey) return;
      evt.preventDefault();
      void submitLicenseImport();
    };
  }
  if (ui.licenseClearBtn) {
    ui.licenseClearBtn.onclick = () => {
      if (ui.licenseBundleInput) {
        ui.licenseBundleInput.value = "";
      }
      setLicenseStatus("已清空导入框。");
    };
  }
  if (ui.licenseClearLocalBtn) {
    ui.licenseClearLocalBtn.onclick = () => {
      void clearLocalLicense();
    };
  }
  if (ui.guestWorkspaceLoginBtn) {
    ui.guestWorkspaceLoginBtn.onclick = () => {
      openClientAuthModal({
        title: "登录后可用当前功能",
        hint: "当前为访客预览态，登录后可继续使用真实功能。",
        view: "login"
      });
    };
  }
  if (ui.clientAuthModalCloseBtn) {
    ui.clientAuthModalCloseBtn.onclick = () => {
      closeClientAuthModal();
    };
  }
  window.addEventListener("beforeunload", () => {
    stopInventoryEventStream();
    closeTargetComponentDrawer();
    closeRemarkModal(null);
  });
  window.addEventListener("resize", () => {
    placeFilterDrawer();
    placeBatchCraftAccountListbox();
    placeBatchCraftSettingsPanel();
    applyCraftLayoutWidth();
    if (typeof fitCraftPredictorOutcomeNames === "function" && ui.craftPredictorList) {
      fitCraftPredictorOutcomeNames(ui.craftPredictorList);
    }
    if (typeof updateCraftPredictorHandleGeometry === "function") updateCraftPredictorHandleGeometry();
    if (ui.targetComponentDrawer && !ui.targetComponentDrawer.classList.contains("hidden")) {
      const rect = ui.targetComponentDrawer.getBoundingClientRect();
      setTargetDrawerPosition(rect.left, rect.top);
    }
    scheduleLazyLoadCheck();
  });
  window.addEventListener("scroll", () => {
    placeFilterDrawer();
    placeBatchCraftAccountListbox();
    placeBatchCraftSettingsPanel();
    scheduleLazyLoadCheck();
  }, true);
  document.addEventListener("mousemove", (evt) => {
    moveCraftSplitDrag(evt);
    moveCraftAssistOverlayDrag(evt);
    moveCraftAssistSplitDrag(evt);
  });
  document.addEventListener("mouseup", () => {
    stopCraftSplitDrag();
    stopCraftAssistOverlayDrag();
    stopCraftAssistSplitDrag();
  });
  document.addEventListener("click", (evt) => {
    const target = evt.target;
    if (!ui.filterDrawer.classList.contains("hidden")) {
      if (!ui.filterDrawer.contains(target) && !ui.toggleFilterBtn.contains(target)) {
        ui.filterDrawer.classList.add("hidden");
        updateFilterDrawer();
      }
    }
    if (ui.targetComponentDrawer && !ui.targetComponentDrawer.classList.contains("hidden")) {
      if (!ui.targetComponentDrawer.contains(target) && (!ui.componentDepositBtn || !ui.componentDepositBtn.contains(target))) {
        closeTargetComponentDrawer();
      }
    }
    if (state.craftSettingsOpen) {
      const craftPanel = ui.craftSettingsPanel;
      const craftBtn = ui.craftSettingsBtn;
      const componentPanel = ui.componentCraftSettingsPanel;
      const componentBtn = ui.componentCraftSettingsBtn;
      const inPanel = (craftPanel && craftPanel.contains(target)) || (componentPanel && componentPanel.contains(target));
      const inBtn = (craftBtn && craftBtn.contains(target)) || (componentBtn && componentBtn.contains(target));
      if (!inPanel && !inBtn) {
        setCraftSettingsPanelOpen(false);
      }
    }
    if (state.batchCraftSettingsOpen) {
      const bPanel = ui.batchCraftSettingsPanel;
      const bBtn = ui.batchCraftSettingsBtn;
      if ((!bPanel || !bPanel.contains(target)) && (!bBtn || !bBtn.contains(target))) {
        setBatchCraftSettingsPanelOpen(false);
      }
    }
    if (state.batchCraftAccountPickerOpen) {
      const bListbox = ui.batchCraftAccountListbox;
      const bBtn = ui.batchCraftAddAccountBtn;
      if ((!bListbox || !bListbox.contains(target)) && (!bBtn || !bBtn.contains(target))) {
        closeBatchCraftAccountPicker();
      }
    }
    if (state.craftAssistPickerOpen || state.craftAssistRoleChooserOpen) {
      const picker = ui.craftAssistPicker;
      const selectBox = ui.craftAssistSelectBox;
      const toggleBtn = ui.craftAssistToggleBtn;
      const inPicker = picker && picker.contains(target);
      const inSelect = selectBox && selectBox.contains(target);
      const inToggle = toggleBtn && toggleBtn.contains(target);
      if (!inPicker && !inSelect && !inToggle) {
        state.craftAssistPickerOpen = false;
        state.craftAssistPickerTargetMaterialId = "";
        state.craftAssistRoleChooserOpen = false;
        renderCraftAssistPanel();
      }
    }
    if (state.simulationOutputChooserOpen || state.simulationMaterialChooserOpen) {
      const inOutputChooser = ui.simulationOutputRoleChooser && ui.simulationOutputRoleChooser.contains(target);
      const inMaterialChooser = ui.simulationMaterialRoleChooser && ui.simulationMaterialRoleChooser.contains(target);
      if (!inOutputChooser && !inMaterialChooser && closeTradeupSimulationRoleChoosers()) {
        renderSimulationRoleChoosers(getActiveTradeupSimulationPreset());
      }
    }
  });
  if (ui.remarkModalClose) {
    ui.remarkModalClose.onclick = () => closeRemarkModal(null);
  }
  if (ui.remarkModalCancelBtn) {
    ui.remarkModalCancelBtn.onclick = () => closeRemarkModal(null);
  }
  if (ui.remarkModalSaveBtn) {
    ui.remarkModalSaveBtn.onclick = () => {
      const value = String(ui.remarkModalInput ? ui.remarkModalInput.value : "").trim() || remarkModalAccount;
      closeRemarkModal(value);
    };
  }
  if (ui.remarkModalInput) {
    ui.remarkModalInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        const value = String(ui.remarkModalInput.value || "").trim() || remarkModalAccount;
        closeRemarkModal(value);
        return;
      }
      if (evt.key === "Escape") {
        evt.preventDefault();
        closeRemarkModal(null);
      }
    });
  }
  if (ui.remarkModal) {
    ui.remarkModal.addEventListener("click", (evt) => {
      if (evt.target === ui.remarkModal) {
        closeRemarkModal(null);
      }
    });
  }
  if (ui.confirmModalClose) {
    ui.confirmModalClose.onclick = () => closeConfirmModal(false);
  }
  if (ui.confirmModalCancelBtn) {
    ui.confirmModalCancelBtn.onclick = () => closeConfirmModal(false);
  }
  if (ui.confirmModalConfirmBtn) {
    ui.confirmModalConfirmBtn.onclick = () => closeConfirmModal(true);
  }
  if (ui.confirmModal) {
    ui.confirmModal.addEventListener("click", (evt) => {
      if (evt.target === ui.confirmModal) {
        closeConfirmModal(false);
      }
    });
    ui.confirmModal.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape") {
        evt.preventDefault();
        closeConfirmModal(false);
        return;
      }
      if (evt.key === "Enter") {
        evt.preventDefault();
        closeConfirmModal(true);
      }
    });
  }
  applyCraftAssistPresetModalOptions();
  const confirmCraftAssistPresetModal = () => {
    const value = String(ui.craftAssistPresetModalInput ? ui.craftAssistPresetModalInput.value : "").trim();
    if (!value) {
      const modalOptions = craftAssistPresetModalOptions || resolveCraftAssistPresetModalOptions();
      const message = String(modalOptions.emptyMessage || "").trim() || "请先输入配置名称";
      if (typeof modalOptions.onEmpty === "function") modalOptions.onEmpty(message);
      else setCraftStatus(message, true);
      if (ui.craftAssistPresetModalInput) ui.craftAssistPresetModalInput.focus();
      return;
    }
    closeCraftAssistPresetModal(value);
  };
  if (ui.craftAssistPresetModalClose) {
    ui.craftAssistPresetModalClose.onclick = () => closeCraftAssistPresetModal(null);
  }
  if (ui.craftAssistPresetModalCancelBtn) {
    ui.craftAssistPresetModalCancelBtn.onclick = () => closeCraftAssistPresetModal(null);
  }
  if (ui.craftAssistPresetModalSaveBtn) {
    ui.craftAssistPresetModalSaveBtn.onclick = () => {
      confirmCraftAssistPresetModal();
    };
  }
  if (ui.craftAssistPresetModalInput) {
    ui.craftAssistPresetModalInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        confirmCraftAssistPresetModal();
        return;
      }
      if (evt.key === "Escape") {
        evt.preventDefault();
        closeCraftAssistPresetModal(null);
      }
    });
  }
  if (ui.craftAssistPresetModal) {
    ui.craftAssistPresetModal.addEventListener("click", (evt) => {
      if (evt.target === ui.craftAssistPresetModal) {
        closeCraftAssistPresetModal(null);
      }
    });
  }
  // ── Simulation Export to Craft Assist modal events ──
  if (ui.simExportCraftModalClose) {
    ui.simExportCraftModalClose.onclick = () => closeSimExportCraftModal(null);
  }
  if (ui.simExportCraftCancelBtn) {
    ui.simExportCraftCancelBtn.onclick = () => closeSimExportCraftModal(null);
  }
  if (ui.simExportCraftConfirmBtn) {
    ui.simExportCraftConfirmBtn.onclick = () => confirmSimExportCraftModal();
  }
  if (ui.simExportCraftModal) {
    ui.simExportCraftModal.addEventListener("click", (evt) => {
      if (evt.target === ui.simExportCraftModal) closeSimExportCraftModal(null);
    });
    ui.simExportCraftModal.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape") closeSimExportCraftModal(null);
    });
  }
  if (ui.simExportCraftAddBtn) {
    ui.simExportCraftAddBtn.onclick = () => {
      if (!ui.simExportCraftSearchPanel) return;
      const isHidden = ui.simExportCraftSearchPanel.classList.contains("hidden");
      ui.simExportCraftSearchPanel.classList.toggle("hidden", !isHidden);
      if (isHidden && ui.simExportCraftSearchInput) {
        ui.simExportCraftSearchInput.focus();
      }
    };
  }
  if (ui.simExportCraftSearchBtn) {
    ui.simExportCraftSearchBtn.onclick = () => {
      const query = ui.simExportCraftSearchInput ? ui.simExportCraftSearchInput.value : "";
      void searchSimExportCraftItems(query);
    };
  }
  if (ui.simExportCraftSearchInput) {
    ui.simExportCraftSearchInput.onkeydown = (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        void searchSimExportCraftItems(ui.simExportCraftSearchInput.value);
      }
    };
  }
  if (ui.simExportCraftMainCount && ui.simExportCraftAuxCount) {
    ui.simExportCraftMainCount.oninput = () => {
      const mainVal = Math.max(1, Math.min(10, Number(ui.simExportCraftMainCount.value) || 1));
      ui.simExportCraftMainCount.value = String(mainVal);
      const hasAux = simExportCraftMaterials.some((m) => m.role === "aux");
      if (hasAux) {
        const auxVal = Math.max(0, 10 - mainVal);
        ui.simExportCraftAuxCount.value = String(auxVal);
      }
    };
    ui.simExportCraftAuxCount.oninput = () => {
      const auxVal = Math.max(0, Math.min(9, Number(ui.simExportCraftAuxCount.value) || 0));
      ui.simExportCraftAuxCount.value = String(auxVal);
      ui.simExportCraftMainCount.value = String(Math.max(1, 10 - auxVal));
    };
  }
  if (ui.navShell) {
    ui.navShell.addEventListener("mouseenter", () => {
      setNavDrawerOpen(true);
    });
    ui.navShell.addEventListener("mouseleave", () => {
      if (state.navDrawerOpen && ui.navShell.contains(document.activeElement)) return;
      setNavDrawerOpen(false);
    });
    ui.navShell.addEventListener("focusin", () => {
      setNavDrawerOpen(true);
    });
    ui.navShell.addEventListener("focusout", () => {
      requestAnimationFrame(() => {
        if (ui.navShell.contains(document.activeElement)) return;
        setNavDrawerOpen(false);
      });
    });
  }
  if (ui.navRailTrigger) {
    ui.navRailTrigger.onclick = (evt) => {
      evt.stopPropagation();
      setNavDrawerOpen(!state.navDrawerOpen);
    };
  }
  document.addEventListener("pointerdown", (evt) => {
    if (!state.navDrawerOpen || !ui.navShell) return;
    if (ui.navShell.contains(evt.target)) return;
    setNavDrawerOpen(false);
  });
  document.addEventListener("keydown", (evt) => {
    if (evt.key === "Escape" && state.batchCraftAccountPickerOpen) {
      closeBatchCraftAccountPicker();
    }
    if (evt.key === "Escape" && state.batchCraftSettingsOpen) {
      setBatchCraftSettingsPanelOpen(false);
    }
    if (evt.key !== "Escape" || !state.navDrawerOpen) return;
    setNavDrawerOpen(false);
  });
  ui.navAccount.onclick = () => showPage("accountPage");
  ui.navInventory.onclick = () => showPage("inventoryPage");
  ui.navCraft.onclick = () => showPage("craftPage");
  ui.navSimulation.onclick = () => showPage("simulationPage");
  if (ui.navBatchCraft) ui.navBatchCraft.onclick = () => showPage("batchCraftPage");
  if (ui.navWebInventory) ui.navWebInventory.onclick = () => showPage("webInventoryPage");
  syncNavDrawerDom();

  if (ui.simulationModeSavedBtn) {
    ui.simulationModeSavedBtn.onclick = () => {
      state.simulationViewMode = "saved";
      closeTradeupSimulationPickerModal();
      closeTradeupSimulationItemModal();
      renderSimulationPage();
    };
  }
  if (ui.simulationModeWorkspaceBtn) {
    ui.simulationModeWorkspaceBtn.onclick = () => {
      openTradeupSimulationWorkspaceDraft();
      renderSimulationPage();
    };
  }
  const focusSimulationSearchInput = () => {
    if (!ui.simulationPickerSearchInput || typeof ui.simulationPickerSearchInput.focus !== "function") return;
    ui.simulationPickerSearchInput.focus();
    if (typeof ui.simulationPickerSearchInput.select === "function") {
      ui.simulationPickerSearchInput.select();
    }
  };
  if (ui.simulationSavePresetBtn) {
    ui.simulationSavePresetBtn.onclick = async () => {
      await saveActiveTradeupSimulationPreset();
    };
  }
  if (ui.simulationCancelEditBtn) {
    ui.simulationCancelEditBtn.onclick = () => {
      void cancelTradeupSimulationEditing();
    };
  }
  if (ui.simulationOutputRoleChooser) {
    const syncOutputChooserHover = (evt) => {
      syncTradeupSimulationChooserHoverSlot(
        "output",
        evt,
        getTradeupSimulationPreferredSlot("output", getActiveTradeupSimulationPreset())
      );
    };
    ui.simulationOutputRoleChooser.onclick = (evt) => {
      evt.preventDefault();
      const slotName = resolveTradeupSimulationChooserSlot(
        "output",
        evt,
        getTradeupSimulationPreferredSlot("output", getActiveTradeupSimulationPreset())
      );
      setTradeupSimulationRoleChooserOpen("output", false);
      openTradeupSimulationRoleSlotPicker(slotName);
    };
    ui.simulationOutputRoleChooser.onmousemove = syncOutputChooserHover;
    ui.simulationOutputRoleChooser.onmouseenter = syncOutputChooserHover;
    ui.simulationOutputRoleChooser.onmouseleave = () => {
      setTradeupSimulationChooserActiveSlot("output", "");
    };
    ui.simulationOutputRoleChooser.onkeydown = (evt) => {
      if (evt.key !== "Enter" && evt.key !== " ") return;
      evt.preventDefault();
      const slotName = getTradeupSimulationPreferredSlot("output", getActiveTradeupSimulationPreset());
      openTradeupSimulationRoleSlotPicker(slotName);
    };
    ui.simulationOutputRoleChooser.onfocus = () => {
      setTradeupSimulationRoleChooserOpen("output", true);
    };
    ui.simulationOutputRoleChooser.onblur = () => {
      setTradeupSimulationRoleChooserOpen("output", false);
      setTradeupSimulationChooserActiveSlot("output", "");
    };
  }
  if (ui.simulationMaterialRoleChooser) {
    const syncMaterialChooserHover = (evt) => {
      syncTradeupSimulationChooserHoverSlot(
        "material",
        evt,
        getTradeupSimulationPreferredSlot("material", getActiveTradeupSimulationPreset())
      );
    };
    ui.simulationMaterialRoleChooser.onclick = (evt) => {
      evt.preventDefault();
      const slotName = resolveTradeupSimulationChooserSlot(
        "material",
        evt,
        getTradeupSimulationPreferredSlot("material", getActiveTradeupSimulationPreset())
      );
      setTradeupSimulationRoleChooserOpen("material", false);
      openTradeupSimulationRoleSlotPicker(slotName);
    };
    ui.simulationMaterialRoleChooser.onmousemove = syncMaterialChooserHover;
    ui.simulationMaterialRoleChooser.onmouseenter = syncMaterialChooserHover;
    ui.simulationMaterialRoleChooser.onmouseleave = () => {
      setTradeupSimulationChooserActiveSlot("material", "");
    };
    ui.simulationMaterialRoleChooser.onkeydown = (evt) => {
      if (evt.key !== "Enter" && evt.key !== " ") return;
      evt.preventDefault();
      const slotName = getTradeupSimulationPreferredSlot("material", getActiveTradeupSimulationPreset());
      openTradeupSimulationRoleSlotPicker(slotName);
    };
    ui.simulationMaterialRoleChooser.onfocus = () => {
      setTradeupSimulationRoleChooserOpen("material", true);
    };
    ui.simulationMaterialRoleChooser.onblur = () => {
      setTradeupSimulationRoleChooserOpen("material", false);
      setTradeupSimulationChooserActiveSlot("material", "");
    };
  }
  if (ui.simulationPickerSearchBtn) {
    ui.simulationPickerSearchBtn.onclick = () => {
      void searchTradeupSimulationItems(ui.simulationPickerSearchInput ? ui.simulationPickerSearchInput.value : state.simulationPickerQuery);
    };
  }
  if (ui.simulationPickerSearchInput) {
    ui.simulationPickerSearchInput.oninput = () => {
      state.simulationPickerQuery = String(ui.simulationPickerSearchInput.value || "").trim();
    };
    ui.simulationPickerSearchInput.onkeydown = (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        void searchTradeupSimulationItems(ui.simulationPickerSearchInput.value);
        return;
      }
      if (evt.key === "Escape") {
        evt.preventDefault();
        closeTradeupSimulationPickerModal();
        renderSimulationPage();
      }
    };
  }
  if (ui.simulationPickerClose) {
    ui.simulationPickerClose.onclick = () => {
      closeTradeupSimulationPickerModal();
      renderSimulationPage();
    };
  }
  if (ui.simulationPickerCancelBtn) {
    ui.simulationPickerCancelBtn.onclick = () => {
      closeTradeupSimulationPickerModal();
      renderSimulationPage();
    };
  }
  if (ui.simulationPickerModal) {
    ui.simulationPickerModal.addEventListener("click", (evt) => {
      if (evt.target !== ui.simulationPickerModal) return;
      closeTradeupSimulationPickerModal();
      renderSimulationPage();
    });
    ui.simulationPickerModal.addEventListener("keydown", (evt) => {
      if (evt.key !== "Escape") return;
      evt.preventDefault();
      closeTradeupSimulationPickerModal();
      renderSimulationPage();
    });
  }
  if (ui.simulationCardModalClose) {
    ui.simulationCardModalClose.onclick = () => {
      closeTradeupSimulationItemModal();
      renderSimulationPage();
    };
  }
  if (ui.simulationCardModalCancelBtn) {
    ui.simulationCardModalCancelBtn.onclick = () => {
      closeTradeupSimulationItemModal();
      renderSimulationPage();
    };
  }
  if (ui.simulationCardModalSaveBtn) {
    ui.simulationCardModalSaveBtn.onclick = async () => {
      const preset = getTradeupSimulationModalPreset();
      const item = getTradeupSimulationModalItem();
      const raw = String(ui.simulationCardModalWearInput ? ui.simulationCardModalWearInput.value : "").trim();
      const numeric = Number(raw);
      const minWear = Number(item && item.minfloat);
      const maxWear = Number(item && item.maxfloat);
      if (!Number.isFinite(numeric)) {
        setSummary("请输入有效的绝对磨损数值");
        focusTradeupSimulationWearInput(ui.simulationCardModalWearInput);
        return;
      }
      if (Number.isFinite(minWear) && numeric < minWear) {
        setSummary(`绝对磨损不能低于 ${formatTradeupSimulationModalWear(minWear)}`);
        focusTradeupSimulationWearInput(ui.simulationCardModalWearInput);
        return;
      }
      if (Number.isFinite(maxWear) && numeric > maxWear) {
        setSummary(`绝对磨损不能高于 ${formatTradeupSimulationModalWear(maxWear)}`);
        focusTradeupSimulationWearInput(ui.simulationCardModalWearInput);
        return;
      }
      if (!applyTradeupSimulationModalEdit({absoluteWear: numeric})) {
        setSummary("应用精修失败，请重新选择卡片后再试");
        renderSimulationPage();
        return;
      }
      renderSimulationPage();
      if (preset) {
        await resolveTradeupSimulationPreset(preset.id);
      }
    };
  }
  if (ui.simulationCardModalWearInput) {
    ui.simulationCardModalWearInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && ui.simulationCardModalSaveBtn && !ui.simulationCardModalSaveBtn.classList.contains("hidden")) {
        evt.preventDefault();
        ui.simulationCardModalSaveBtn.click();
        return;
      }
      if (evt.key === "Escape") {
        evt.preventDefault();
        closeTradeupSimulationItemModal();
        renderSimulationPage();
      }
    });
  }
  if (ui.simulationCardModal) {
    ui.simulationCardModal.addEventListener("click", (evt) => {
      if (evt.target !== ui.simulationCardModal) return;
      closeTradeupSimulationItemModal();
      renderSimulationPage();
    });
    ui.simulationCardModal.addEventListener("keydown", (evt) => {
      if (evt.key !== "Escape") return;
      evt.preventDefault();
      closeTradeupSimulationItemModal();
      renderSimulationPage();
    });
  }

  ui.loginSaveBtn.onclick = loginAndSave;
  ui.clearAccountBtn.onclick = clearAccountForm;
  bindAccountTotpNormalization();
  if (ui.accountLoginModalClose) {
    ui.accountLoginModalClose.onclick = () => {
      clearAccountForm();
    };
  }
  if (ui.accountPasswordToggle) {
    ui.accountPasswordToggle.onclick = () => {
      state.accountPasswordVisible = !state.accountPasswordVisible;
      syncAccountPasswordVisibility();
      if (ui.accountPassword && typeof ui.accountPassword.focus === "function") {
        ui.accountPassword.focus({preventScroll: true});
      }
    };
  }
  if (ui.accountPassword) {
    ui.accountPassword.onkeydown = (evt) => {
      if (evt.key !== "Enter") return;
      evt.preventDefault();
      void loginAndSave();
    };
  }
  if (ui.accountTotp) {
    ui.accountTotp.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        void loginAndSave();
        return;
      }
    });
  }

  if (ui.accountPageSelect) {
    ui.accountPageSelect.onchange = async () => {
      const username = String(ui.accountPageSelect.value || "").trim();
      if (!username) return;
      try { await switchAccountView(username); }
      catch (err) { setAccountStatus(`切换账号视图失败：${err.message}`, true); }
    };
  }
  ui.accountSelect.onchange = async () => {
    const username = String(ui.accountSelect.value || "").trim();
    if (!username) return;
    try { await switchAccountView(username); }
    catch (err) { setSummary(`切换账号视图失败：${err.message}`); }
  };
  if (ui.craftAccountSelect) {
    ui.craftAccountSelect.onchange = async () => {
      const username = String(ui.craftAccountSelect.value || "").trim();
      if (!username) return;
      try { await switchAccountView(username); }
      catch (err) { setSummary(`切换账号视图失败：${err.message}`); }
    };
  }

  if (ui.accountPageAddBtn) {
    ui.accountPageAddBtn.onclick = () => {
      openAddAccountForm();
    };
  }
  if (ui.accountPageRefreshBtn) {
    ui.accountPageRefreshBtn.onclick = () => void refreshWithConnectionOverlay({
      preferCraft: false,
      usernameOverride: String((ui.accountPageSelect && ui.accountPageSelect.value) || "").trim(),
      force: false
    });
  }
  if (ui.accountPageStatusText) {
    ui.accountPageStatusText.onclick = () => {
      if (!ui.accountPageStatusText.classList.contains("status-clickable")) return;
      void connectByStatusBadge({
        preferCraft: false,
        usernameOverride: String((ui.accountPageSelect && ui.accountPageSelect.value) || "").trim()
      });
    };
  }
  if (ui.accountPageDisconnectBtn) {
    ui.accountPageDisconnectBtn.onclick = () => disconnectCurrentSession({
      usernameOverride: String((ui.accountPageSelect && ui.accountPageSelect.value) || "").trim()
    });
  }
  ui.refreshBtn.onclick = () => void refreshWithConnectionOverlay({preferCraft: false, force: false});
  if (ui.statusText) {
    ui.statusText.onclick = () => {
      if (!ui.statusText.classList.contains("status-clickable")) return;
      void connectByStatusBadge({preferCraft: false});
    };
  }
  if (ui.disconnectBtn) {
    ui.disconnectBtn.onclick = () => disconnectCurrentSession({
      usernameOverride: String((ui.accountSelect && ui.accountSelect.value) || "").trim()
    });
  }
  if (ui.craftRefreshBtn) {
    ui.craftRefreshBtn.onclick = () => void refreshWithConnectionOverlay({
      preferCraft: true,
      force: false
    });
  }
  if (ui.craftTopStatusText) {
    ui.craftTopStatusText.onclick = () => {
      if (!ui.craftTopStatusText.classList.contains("status-clickable")) return;
      void connectByStatusBadge({preferCraft: true});
    };
  }
  if (ui.craftDisconnectBtn) {
    ui.craftDisconnectBtn.onclick = () => disconnectCurrentSession({
      usernameOverride: String((ui.craftAccountSelect && ui.craftAccountSelect.value) || "").trim()
    });
  }

  ui.searchInput.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.searchText = String(ui.searchInput.value || "").trim(); resetRenderWindow(); render(); }, 180); };
  ui.modeToggleBtn.onclick = () => { state.mode = state.mode === "cards" ? "grouped" : "cards"; resetRenderWindow(); render(); };
  ui.toggleFilterBtn.onclick = toggleFilterDrawer;
  ui.filterNavWear.onclick = () => setFilterPanel("wear");
  ui.filterNavRarity.onclick = () => setFilterPanel("rarity");
  ui.filterNavCollection.onclick = () => setFilterPanel("collection");
  ui.wearMin.onchange = () => onWearInputChanged("min");
  ui.wearMax.onchange = () => onWearInputChanged("max");
  ui.raritySelectAll.onclick = () => { state.raritySelected = new Set(RARITY_VALUES); refreshRarityMenu(); resetRenderWindow(); render(); };
  ui.rarityClear.onclick = () => { state.raritySelected.clear(); refreshRarityMenu(); resetRenderWindow(); render(); };
  ui.collectionSelectAll.onclick = () => { state.collectionSelected = new Set(state.collectionValues); refreshCollectionMenu(rowsForComponentScope(), {force: true}); resetRenderWindow(); render(); };
  ui.collectionClear.onclick = () => { state.collectionSelected.clear(); refreshCollectionMenu(rowsForComponentScope(), {force: true}); resetRenderWindow(); render(); };
  if (ui.wearSortUp) ui.wearSortUp.onclick = () => { state.wearSort = "asc"; render(); };
  if (ui.wearSortDown) ui.wearSortDown.onclick = () => { state.wearSort = "desc"; render(); };
  if (ui.raritySortUp) ui.raritySortUp.onclick = () => { state.raritySort = "asc"; render(); };
  if (ui.raritySortDown) ui.raritySortDown.onclick = () => { state.raritySort = "desc"; render(); };
  ui.componentSelect.onchange = () => {
    const selected = String(ui.componentSelect.value || "").trim();
    state.selectedComponentId = selected;
    state.expandedGroups.clear();
    closeTargetComponentDrawer();
    if (selected) state.mode = "grouped";
    resetRenderWindow();
    refreshComponentControls();
    render();
  };
  ui.showComponentItems.onchange = () => {
    state.showComponentItems = !!ui.showComponentItems.checked;
    resetRenderWindow();
    render();
  };
  if (ui.componentTaskCancelBtn) {
    ui.componentTaskCancelBtn.onclick = async () => {
      const jobId = String(state.selectedQueueJobId || "").trim();
      if (!jobId) {
        setSummary("请先选择一个排队任务");
        return;
      }
      try {
        await api("/api/component/tasks/cancel", {
          method: "POST",
          body: JSON.stringify({job_id: jobId})
        });
        state.selectedQueueJobId = "";
        await loadComponentTaskQueue();
        setSummary("已取消排队任务");
      } catch (err) {
        setSummary(`取消任务失败：${err.message}`);
      }
    };
  }
  if (ui.targetComponentDrawerClose) {
    ui.targetComponentDrawerClose.onclick = () => closeTargetComponentDrawer();
  }
  if (ui.targetComponentDrawerSelect) {
    ui.targetComponentDrawerSelect.onchange = () => {
      state.targetComponentSelectedId = String(ui.targetComponentDrawerSelect.value || "").trim();
      renderTargetComponentDrawer();
    };
  }
  if (ui.targetComponentDrawer) {
    const head = ui.targetComponentDrawer.querySelector(".drawer-head");
    if (head) {
      head.addEventListener("mousedown", (evt) => {
        if (evt.button !== 0) return;
        const target = evt.target;
        if (ui.targetComponentDrawerClose && ui.targetComponentDrawerClose.contains(target)) return;
        const rect = ui.targetComponentDrawer.getBoundingClientRect();
        targetDrawerDrag.active = true;
        targetDrawerDrag.offsetX = evt.clientX - rect.left;
        targetDrawerDrag.offsetY = evt.clientY - rect.top;
        evt.preventDefault();
      });
    }
    document.addEventListener("mousemove", (evt) => {
      if (!targetDrawerDrag.active) return;
      const left = evt.clientX - targetDrawerDrag.offsetX;
      const top = evt.clientY - targetDrawerDrag.offsetY;
      setTargetDrawerPosition(left, top);
    });
    document.addEventListener("mouseup", () => {
      targetDrawerDrag.active = false;
    });
  }
  if (ui.targetComponentDrawerCancel) {
    ui.targetComponentDrawerCancel.onclick = () => closeTargetComponentDrawer();
  }
  if (ui.targetComponentDrawerConfirm) {
    ui.targetComponentDrawerConfirm.onclick = async () => {
      const targetComponentId = String(state.targetComponentSelectedId || "").trim();
      if (!targetComponentId) {
        setSummary("请先选择目标组件");
        return;
      }
      try {
        const ok = await submitDepositToTarget(targetComponentId);
        if (ok) closeTargetComponentDrawer();
      } catch (err) {
        setSummary(`存入失败：${err.message}`);
      }
    };
  }
  ui.componentDepositBtn.onclick = async () => {
    if (!getSelectedRows().length) {
      setSummary("请先在库存列表中选择要存入的物品");
      return;
    }
    const connected = await ensureConnectedForComponentDeposit();
    if (!connected) return;
    openTargetComponentDrawer({excludeId: selectedComponentId()});
  };
  ui.componentWithdrawBtn.onclick = async () => {
    const currentComponentId = selectedComponentId();
    if (!currentComponentId) {
      setSummary("请先选择组件");
      return;
    }
    const connected = await ensureConnectedForComponentWithdraw();
    if (!connected) return;
    if (isAllInventoryMode()) {
      const selectedRows = getSelectedRows()
        .filter((row) => !!String(row && row.casket_id || "").trim())
        .sort(compareRowsByWearAsc);
      if (!selectedRows.length) {
        setSummary("请先选择组件内的物品进行取出");
        return;
      }
      const slotEstimate = estimateMainInventoryFreeSlots();
      const freeSlots = slotEstimate.freeSlots;
      if (freeSlots <= 0) {
        setSummary("主库存空间已满，无法取出");
        return;
      }
      let submitRows = selectedRows;
      if (selectedRows.length > freeSlots) {
        const ok = window.confirm(
          `已选可取出 ${selectedRows.length} 件，但主库存仅剩 ${freeSlots} 个空间。\n` +
          `是否继续，仅按磨损从低到高取出前 ${freeSlots} 件？`
        );
        if (!ok) { setSummary("已取消取出"); return; }
        submitRows = selectedRows.slice(0, freeSlots);
      }
      const byComponent = new Map();
      for (const row of submitRows) {
        const cid = String(row.casket_id || "").trim();
        if (!cid) continue;
        if (!byComponent.has(cid)) byComponent.set(cid, []);
        byComponent.get(cid).push(row);
      }
      try {
        for (const [cid, rows] of byComponent.entries()) {
          const itemIds = rows.map((r) => rowAssetId(r)).filter(Boolean);
          await runComponentMove("withdraw", itemIds, cid);
          for (const id of itemIds) state.selectedComponentItemIds.delete(String(id || "").trim());
        }
        refreshComponentControls();
        render();
      } catch (err) {
        setSummary(`取出失败：${err.message}`);
      }
      return;
    }
    const componentStillExists = listComponentChoices().some((choice) => String(choice && choice.id || "").trim() === currentComponentId);
    if (!componentStillExists) {
      setSummary("自动校对后当前组件已变化，请重新选择组件");
      return;
    }
    const selectedRows = getSelectedRows()
      .filter((row) => String(row && row.casket_id || "").trim() === currentComponentId)
      .sort(compareRowsByWearAsc);
    if (!selectedRows.length) {
      setSummary("请先在组件列表中选择要取出的物品");
      return;
    }
    const slotEstimate = estimateMainInventoryFreeSlots();
    let submitRows = selectedRows;
    const freeSlots = slotEstimate.freeSlots;
    if (freeSlots <= 0) {
      setSummary("主库存空间已满，无法取出");
      return;
    }
    if (selectedRows.length > freeSlots) {
      const ok = window.confirm(
        `已选可取出 ${selectedRows.length} 件，但主库存仅剩 ${freeSlots} 个空间。\n` +
        `是否继续，仅按磨损从低到高取出前 ${freeSlots} 件？`
      );
      if (!ok) {
        setSummary("已取消取出");
        return;
      }
      submitRows = selectedRows.slice(0, freeSlots);
    }
    const itemIds = submitRows.map((row) => rowAssetId(row)).filter(Boolean);
    try {
      await runComponentMove("withdraw", itemIds, "");
      for (const id of itemIds) {
        state.selectedComponentItemIds.delete(String(id || "").trim());
      }
      refreshComponentControls();
      render();
    } catch (err) {
      setSummary(`取出失败：${err.message}`);
    }
  };
  const toggleCraftSettingsPanel = () => {
    setCraftSettingsPanelOpen(!state.craftSettingsOpen);
  };
  if (ui.craftSettingsBtn) {
    ui.craftSettingsBtn.onclick = () => {
      toggleCraftSettingsPanel();
    };
  }
  if (ui.componentCraftSettingsBtn) {
    ui.componentCraftSettingsBtn.onclick = () => {
      toggleCraftSettingsPanel();
    };
  }
  const applyCraftUseComponentItems = (checked) => {
    state.craftUseComponentItems = !!checked;
    saveCraftUiPrefs();
    clearCraftStatus();
    state.craftCandidateRows = [];
    state.craftCandidateStats = null;
    state.craftCandidateLoadedKey = "";
    syncCraftSettingsControls();
    renderCraftPage();
  };
  if (ui.craftUseComponentItems) {
    ui.craftUseComponentItems.onchange = () => {
      applyCraftUseComponentItems(ui.craftUseComponentItems.checked);
    };
  }
  if (ui.componentCraftUseComponentItems) {
    ui.componentCraftUseComponentItems.onchange = () => {
      applyCraftUseComponentItems(ui.componentCraftUseComponentItems.checked);
    };
  }
  const applyCraftIncludeCooling = (checked) => {
    state.craftIncludeCooling = !!checked;
    saveCraftUiPrefs();
    clearCraftStatus();
    state.craftCandidateRows = [];
    state.craftCandidateStats = null;
    state.craftCandidateLoadedKey = "";
    syncCraftSettingsControls();
    renderCraftPage();
  };
  if (ui.craftIncludeCooling) {
    ui.craftIncludeCooling.onchange = () => {
      applyCraftIncludeCooling(ui.craftIncludeCooling.checked);
    };
  }
  if (ui.componentCraftIncludeCooling) {
    ui.componentCraftIncludeCooling.onchange = () => {
      applyCraftIncludeCooling(ui.componentCraftIncludeCooling.checked);
    };
  }
  const applyCraftShowSeed = (checked) => {
    state.craftShowSeed = !!checked;
    saveCraftUiPrefs();
    syncCraftSettingsControls();
    render();
    renderCraftPage();
  };
  if (ui.craftShowSeed) {
    ui.craftShowSeed.onchange = () => {
      applyCraftShowSeed(ui.craftShowSeed.checked);
    };
  }
  if (ui.componentCraftShowSeed) {
    ui.componentCraftShowSeed.onchange = () => {
      applyCraftShowSeed(ui.componentCraftShowSeed.checked);
    };
  }
  const applyCraftShowFullWear = (checked) => {
    state.craftShowFullWear = !!checked;
    saveCraftUiPrefs();
    syncCraftSettingsControls();
    renderCraftPage();
  };
  if (ui.craftShowFullWear) {
    ui.craftShowFullWear.onchange = () => {
      applyCraftShowFullWear(ui.craftShowFullWear.checked);
    };
  }
  if (ui.componentCraftShowFullWear) {
    ui.componentCraftShowFullWear.onchange = () => {
      applyCraftShowFullWear(ui.componentCraftShowFullWear.checked);
    };
  }
  const applyCraftShowCoolingTime = (checked) => {
    state.craftShowCoolingTime = !!checked;
    saveCraftUiPrefs();
    syncCraftSettingsControls();
    render();
  };
  if (ui.craftShowCoolingTime) {
    ui.craftShowCoolingTime.onchange = () => {
      applyCraftShowCoolingTime(ui.craftShowCoolingTime.checked);
    };
  }
  if (ui.componentCraftShowCoolingTime) {
    ui.componentCraftShowCoolingTime.onchange = () => {
      applyCraftShowCoolingTime(ui.componentCraftShowCoolingTime.checked);
    };
  }
  const applyCraftAssistFastMode = (checked) => {
    state.craftAssistFastMode = !!checked;
    saveCraftUiPrefs();
    syncCraftSettingsControls();
  };
  if (ui.craftAssistFastMode) {
    ui.craftAssistFastMode.onchange = () => {
      applyCraftAssistFastMode(ui.craftAssistFastMode.checked);
    };
  }
  const applyCraftAssistApproachMode = (checked) => {
    state.craftAssistApproachMode = !!checked;
    saveCraftUiPrefs();
    syncCraftSettingsControls();
  };
  if (ui.craftAssistApproachMode) {
    ui.craftAssistApproachMode.onchange = () => {
      applyCraftAssistApproachMode(ui.craftAssistApproachMode.checked);
    };
  }
  const applyCraftAssistWearOffset = (inputNode) => {
    if (!inputNode) return;
    const nextValue = normalizeCraftAssistWearOffset(inputNode.value, state.craftAssistWearOffset);
    state.craftAssistWearOffset = nextValue;
    inputNode.value = craftAssistWearOffsetText(nextValue);
    saveCraftUiPrefs();
    syncCraftSettingsControls();
  };
  if (ui.craftAssistWearOffsetPct) {
    ui.craftAssistWearOffsetPct.onfocus = () => {
      ui.craftAssistWearOffsetPct.select();
    };
    ui.craftAssistWearOffsetPct.oninput = () => {
      state.craftAssistWearOffset = normalizeCraftAssistWearOffset(
        ui.craftAssistWearOffsetPct.value,
        state.craftAssistWearOffset
      );
    };
    ui.craftAssistWearOffsetPct.onchange = () => {
      applyCraftAssistWearOffset(ui.craftAssistWearOffsetPct);
    };
    ui.craftAssistWearOffsetPct.onblur = () => {
      applyCraftAssistWearOffset(ui.craftAssistWearOffsetPct);
    };
    ui.craftAssistWearOffsetPct.onkeydown = (evt) => {
      if (evt.key !== "Enter") return;
      evt.preventDefault();
      applyCraftAssistWearOffset(ui.craftAssistWearOffsetPct);
      ui.craftAssistWearOffsetPct.blur();
    };
  }
  const applyCraftHideCollection = (checked) => {
    state.craftHideCollection = !!checked;
    saveCraftUiPrefs();
    syncCraftSettingsControls();
    render();
    renderCraftPage();
  };
  if (ui.craftHideCollection) {
    ui.craftHideCollection.onchange = () => {
      applyCraftHideCollection(ui.craftHideCollection.checked);
    };
  }
  if (ui.componentCraftHideCollection) {
    ui.componentCraftHideCollection.onchange = () => {
      applyCraftHideCollection(ui.componentCraftHideCollection.checked);
    };
  }
  const applyCraftHideQuantity = (checked) => {
    state.craftHideQuantity = !!checked;
    saveCraftUiPrefs();
    syncCraftSettingsControls();
    render();
    renderCraftPage();
  };
  if (ui.craftHideQuantity) {
    ui.craftHideQuantity.onchange = () => {
      applyCraftHideQuantity(ui.craftHideQuantity.checked);
    };
  }
  if (ui.componentCraftHideQuantity) {
    ui.componentCraftHideQuantity.onchange = () => {
      applyCraftHideQuantity(ui.componentCraftHideQuantity.checked);
    };
  }
  if (ui.craftSplitBar) {
    ui.craftSplitBar.onmousedown = (evt) => {
      startCraftSplitDrag(evt);
    };
  }
  if (ui.craftAssistOverlayHandle) {
    ui.craftAssistOverlayHandle.onmousedown = (evt) => {
      startCraftAssistOverlayDrag(evt);
    };
  }
  if (ui.craftAssistSplitBar) {
    ui.craftAssistSplitBar.onmousedown = (evt) => {
      startCraftAssistSplitDrag(evt);
    };
  }
  if (ui.craftAddRecipeBtn) {
    ui.craftAddRecipeBtn.onclick = () => {
      addCurrentSelectionToCraftQueue();
    };
  }
  if (ui.craftAssistToggleBtn) {
    ui.craftAssistToggleBtn.onclick = () => {
      setCraftAssistPanelOpen(!state.craftAssistOpen);
    };
  }
  if (ui.craftAssistCloseBtn) {
    ui.craftAssistCloseBtn.onclick = () => {
      setCraftAssistPanelOpen(false);
    };
  }
  if (ui.craftPredictorHandle) {
    ui.craftPredictorHandle.onclick = () => {
      setCraftPredictorPanelOpen(!state.craftPredictorOpen, {manual: true});
    };
  }
  if (ui.craftPredictorCloseBtn) {
    ui.craftPredictorCloseBtn.onclick = () => {
      setCraftPredictorPanelOpen(false, {manual: true});
    };
  }
  if (ui.craftAssistTargetWear) {
    const commitTargetWear = () => {
      state.craftAssistTargetWear = commitCraftAssistTargetWearInput(ui.craftAssistTargetWear);
      state.craftAssistTargetWearRaw = String(ui.craftAssistTargetWear && ui.craftAssistTargetWear.dataset && ui.craftAssistTargetWear.dataset.persistedRaw || "").trim();
      renderCraftAssistPanel();
    };
    ui.craftAssistTargetWear.onfocus = () => {
      seedCraftAssistDecimalInput(ui.craftAssistTargetWear);
    };
    ui.craftAssistTargetWear.oninput = () => {
      delete ui.craftAssistTargetWear.dataset.displayDefault;
    };
    ui.craftAssistTargetWear.onchange = commitTargetWear;
    ui.craftAssistTargetWear.onblur = commitTargetWear;
    ui.craftAssistTargetWear.onkeydown = (evt) => {
      if (evt.key !== "Enter") return;
      evt.preventDefault();
      commitTargetWear();
      ui.craftAssistTargetWear.blur();
    };
  }
  if (ui.craftAssistPresetNameInput) {
    const syncPresetEditingName = ({trim = false} = {}) => {
      if (!isCraftAssistPresetEditing()) return;
      const raw = String(ui.craftAssistPresetNameInput.value || "");
      const next = trim ? raw.trim() : raw;
      state.craftAssistPresetEditingName = next;
      if (trim && ui.craftAssistPresetNameInput.value !== next) {
        ui.craftAssistPresetNameInput.value = next;
      }
      if (ui.craftAssistPresetSaveBtn) {
        ui.craftAssistPresetSaveBtn.title = `保存对配置【${String(state.craftAssistPresetEditingName || "").trim() || "-"}】的修改`;
      }
    };
    ui.craftAssistPresetNameInput.oninput = () => {
      syncPresetEditingName();
    };
    ui.craftAssistPresetNameInput.onchange = () => {
      syncPresetEditingName({trim: true});
    };
    ui.craftAssistPresetNameInput.onblur = () => {
      syncPresetEditingName({trim: true});
    };
  }
  if (ui.craftAssistFilterModeRelative) {
    ui.craftAssistFilterModeRelative.onchange = () => {
      if (!ui.craftAssistFilterModeRelative.checked) return;
      setCraftAssistFilterMode("relative");
    };
  }
  if (ui.craftAssistFilterModeAbsolute) {
    ui.craftAssistFilterModeAbsolute.onchange = () => {
      if (!ui.craftAssistFilterModeAbsolute.checked) return;
      setCraftAssistFilterMode("absolute");
    };
  }
  if (ui.craftAssistPresetSaveBtn) {
    ui.craftAssistPresetSaveBtn.onclick = async () => {
      if (rejectCraftAssistBusyUiAction()) return;
      if (isCraftAssistPresetEditing()) {
        saveCraftAssistPresetEditingSession();
        return;
      }
      await promptAndSaveCurrentCraftAssistPreset();
    };
  }
  if (ui.craftAssistMainCount) {
    ui.craftAssistMainCount.onchange = () => {
      state.craftAssistMainCount = normalizeCraftAssistCount(ui.craftAssistMainCount.value, state.craftAssistMainCount);
      renderCraftAssistPanel();
    };
  }
  if (ui.craftAssistAuxCount) {
    ui.craftAssistAuxCount.onchange = () => {
      state.craftAssistAuxCount = normalizeCraftAssistCount(ui.craftAssistAuxCount.value, state.craftAssistAuxCount);
      renderCraftAssistPanel();
    };
  }
  if (ui.craftAssistApplyBtn) {
    ui.craftAssistApplyBtn.onclick = () => {
      if (isCraftAssistPresetEditing()) {
        cancelCraftAssistPresetEditingSession();
        return;
      }
      void applyCraftAssistAutoSelection({pendingUiAction: "panel_apply"});
    };
  }
  if (ui.craftAssistSelectBox) {
    ui.craftAssistSelectBox.onmouseenter = () => {
      setCraftAssistRoleChooserOpen(true);
    };
    ui.craftAssistSelectBox.onmouseleave = () => {
      setCraftAssistRoleChooserOpen(false);
    };
    ui.craftAssistSelectBox.onclick = (evt) => {
      evt.preventDefault();
      const rect = ui.craftAssistSelectBox.getBoundingClientRect();
      const half = rect.left + rect.width / 2;
      state.craftAssistPickRole = evt.clientX < half ? "main" : "aux";
      setCraftAssistRoleChooserOpen(false);
      openCraftAssistPicker({targetMaterialId: ""});
    };
    ui.craftAssistSelectBox.onkeydown = (evt) => {
      if (evt.key !== "Enter" && evt.key !== " ") return;
      evt.preventDefault();
      openCraftAssistPicker({targetMaterialId: ""});
    };
    ui.craftAssistSelectBox.onfocus = () => {
      setCraftAssistRoleChooserOpen(true);
    };
    ui.craftAssistSelectBox.onblur = () => {
      setCraftAssistRoleChooserOpen(false);
      scheduleCloseCraftAssistPicker();
    };
  }
  if (ui.craftAssistPicker) {
    ui.craftAssistPicker.onmouseenter = () => {
      openCraftAssistPicker();
    };
    ui.craftAssistPicker.onmouseleave = () => {
      scheduleCloseCraftAssistPicker();
    };
  }
  if (ui.craftExecuteQueueBtn) {
    ui.craftExecuteQueueBtn.onclick = async () => {
      if (state.craftBusy) {
        await requestCraftTradeUpPause();
        return;
      }
      await runCraftTradeUpQueue();
    };
  }
  if (ui.craftClearQueueBtn) {
    ui.craftClearQueueBtn.onclick = () => {
      clearCraftQueue();
    };
  }
  bindBatchCraftEvents();
}

// ===== 批量导入 maFile =====

const batchImportState = {
  files: [],  // { name, content, password }
  running: false
};

function initBatchImport() {
  const btn = document.getElementById("accountPageBatchImportBtn");
  const modal = document.getElementById("batchImportModal");
  const closeBtn = document.getElementById("batchImportCloseBtn");
  const fileInput = document.getElementById("batchImportFileInput");
  const selectFilesBtn = document.getElementById("batchImportSelectFilesBtn");
  const dropZone = document.getElementById("batchImportDropZone");
  const startBtn = document.getElementById("batchImportStartBtn");
  const pwdMode = document.getElementById("batchImportPwdMode");
  const uniformSection = document.getElementById("batchImportUniformSection");
  const pasteSection = document.getElementById("batchImportPasteSection");
  const parseBtn = document.getElementById("batchImportParseBtn");

  if (!btn || !modal) return;

  btn.onclick = () => {
    batchImportState.files = [];
    batchImportState.running = false;
    renderBatchImportFileList();
    document.getElementById("batchImportProgress").classList.add("hidden");
    document.getElementById("batchImportResults").innerHTML = "";
    document.getElementById("batchImportParseResult").innerHTML = "";
    const ta = document.getElementById("batchImportPasteArea");
    if (ta) ta.value = "";
    // 默认粘贴模式
    if (pwdMode) pwdMode.value = "paste";
    switchBatchPwdMode("paste");
    modal.classList.remove("hidden");
  };

  closeBtn.onclick = () => { if (!batchImportState.running) modal.classList.add("hidden"); };
  modal.onclick = (e) => { if (e.target === modal && !batchImportState.running) modal.classList.add("hidden"); };

  selectFilesBtn.onclick = () => fileInput.click();
  fileInput.onchange = () => { handleBatchImportFiles(fileInput.files); fileInput.value = ""; };

  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); };
  dropZone.ondragleave = () => dropZone.classList.remove("drag-over");
  dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    handleBatchImportFiles(e.dataTransfer.files);
  };

  if (pwdMode) {
    pwdMode.onchange = () => switchBatchPwdMode(pwdMode.value);
  }

  if (parseBtn) {
    parseBtn.onclick = () => applyParsedCredentials();
  }

  startBtn.onclick = () => startBatchImport();
}

function switchBatchPwdMode(mode) {
  const uniformSection = document.getElementById("batchImportUniformSection");
  const pasteSection = document.getElementById("batchImportPasteSection");
  if (uniformSection) uniformSection.classList.toggle("hidden", mode !== "uniform");
  if (pasteSection) pasteSection.classList.toggle("hidden", mode !== "paste");
  renderBatchImportFileList();
}

async function handleBatchImportFiles(fileList) {
  for (const file of fileList) {
    try {
      const content = await file.text();
      JSON.parse(content); // validate JSON
      const parsed = JSON.parse(content);
      const accountName = parsed.account_name || file.name.replace(/\.maFile$/i, "");
      batchImportState.files.push({name: file.name, accountName, content, password: ""});
    } catch (err) {
      console.warn("maFile parse error:", file.name, err);
    }
  }
  renderBatchImportFileList();
}

function renderBatchImportFileList() {
  const wrap = document.getElementById("batchImportFileList");
  const pwdMode = document.getElementById("batchImportPwdMode");
  const mode = pwdMode ? pwdMode.value : "paste";
  wrap.innerHTML = "";
  for (let i = 0; i < batchImportState.files.length; i++) {
    const f = batchImportState.files[i];
    const div = document.createElement("div");
    div.className = "batch-import-file-item";
    const nameSpan = document.createElement("span");
    nameSpan.className = "file-name";
    nameSpan.textContent = f.accountName || f.name;
    div.append(nameSpan);
    if (f.password && mode === "paste") {
      const tag = document.createElement("span");
      tag.style.cssText = "color:var(--success);font-size:11px;margin-left:8px;";
      tag.textContent = "✓ 已匹配密码";
      div.append(tag);
    }
    if (mode === "individual") {
      const pwd = document.createElement("input");
      pwd.type = "password";
      pwd.className = "file-pwd";
      pwd.placeholder = "密码";
      pwd.value = f.password;
      pwd.oninput = () => { f.password = pwd.value; };
      div.append(pwd);
    }
    const rm = document.createElement("button");
    rm.className = "file-remove";
    rm.textContent = "×";
    rm.onclick = () => { batchImportState.files.splice(i, 1); renderBatchImportFileList(); };
    div.append(rm);
    wrap.append(div);
  }
}

/**
 * 解析粘贴的账密文本，提取账号和密码对
 * 支持格式：账号xxx密码yyy（后面可能还有令牌秘钥等，忽略）
 * 每行一个账号
 */
function parseBatchCredentials(text) {
  const result = new Map();
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  for (const line of lines) {
    // 匹配「账号xxx密码yyy」格式，账号和密码之间可能有空格
    const m = line.match(/账号\s*(\S+?)\s*密码\s*(\S+)/);
    if (m) {
      result.set(m[1].trim(), m[2].trim());
    }
  }
  return result;
}

/**
 * 将解析的账密映射应用到已导入的 maFile 列表
 */
function applyParsedCredentials() {
  const ta = document.getElementById("batchImportPasteArea");
  const resultDiv = document.getElementById("batchImportParseResult");
  if (!ta || !resultDiv) return;

  const text = ta.value.trim();
  if (!text) {
    resultDiv.innerHTML = '<span class="match-fail">请先粘贴账密文本</span>';
    return;
  }

  const credMap = parseBatchCredentials(text);
  if (credMap.size === 0) {
    resultDiv.innerHTML = '<span class="match-fail">未识别到任何账号密码对，请检查格式</span>';
    return;
  }

  let matched = 0;
  let unmatched = [];
  // 将密码匹配到已导入的文件
  for (const f of batchImportState.files) {
    const pwd = credMap.get(f.accountName);
    if (pwd) {
      f.password = pwd;
      matched++;
    }
  }
  // 检查哪些解析出的账号没有对应的 maFile
  for (const [acct] of credMap) {
    if (!batchImportState.files.some(f => f.accountName === acct)) {
      unmatched.push(acct);
    }
  }

  let html = `<span class="match-ok">解析到 ${credMap.size} 个账号，匹配成功 ${matched} 个</span>`;
  if (unmatched.length > 0) {
    html += `<br><span class="match-fail">未找到对应 maFile 的账号：${unmatched.join(", ")}</span>`;
  }
  const noPassword = batchImportState.files.filter(f => !f.password);
  if (noPassword.length > 0) {
    html += `<br><span class="match-fail">仍缺密码的账号：${noPassword.map(f => f.accountName).join(", ")}</span>`;
  }
  resultDiv.innerHTML = html;
  renderBatchImportFileList();
}

async function startBatchImport() {
  if (batchImportState.running || batchImportState.files.length === 0) return;
  batchImportState.running = true;

  const pwdMode = document.getElementById("batchImportPwdMode");
  const mode = pwdMode ? pwdMode.value : "paste";
  const uniformPassword = document.getElementById("batchImportPasswordInput").value;
  const progressWrap = document.getElementById("batchImportProgress");
  const progressFill = document.getElementById("batchImportProgressFill");
  const progressText = document.getElementById("batchImportProgressText");
  const resultsWrap = document.getElementById("batchImportResults");
  const startBtn = document.getElementById("batchImportStartBtn");

  progressWrap.classList.remove("hidden");
  progressFill.style.width = "0%";
  progressText.textContent = "准备中...";
  resultsWrap.innerHTML = "";
  startBtn.disabled = true;

  const accounts = batchImportState.files.map((f) => ({
    username: f.accountName,
    password: mode === "uniform" ? uniformPassword : f.password,
    maFileContent: f.content
  }));

  try {
    const resp = await fetch("/api/accounts/batch-import", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({accounts})
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let eventName = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventName = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (eventName === "progress" || eventName === "account_result") {
              const pct = data.total > 0 ? Math.round((data.done / data.total) * 100) : 0;
              progressFill.style.width = pct + "%";
              progressText.textContent = `${data.done || 0} / ${data.total || 0}`;
            }
            if (eventName === "account_result") {
              const item = document.createElement("div");
              item.className = `batch-import-result-item ${data.ok ? "ok" : "fail"}`;
              item.textContent = `${data.ok ? "✓" : "✗"} ${data.username}: ${data.message}`;
              resultsWrap.append(item);
            }
          } catch (_) {}
        }
      }
    }
  } catch (err) {
    progressText.textContent = `导入出错: ${err.message}`;
  }

  batchImportState.running = false;
  startBtn.disabled = false;

  // 刷新账号列表
  try { await loadAccounts(); } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════════════════
// Web 库存管理页
// ═══════════════════════════════════════════════════════════════════════════

const webInvState = {
  selectedAccount: null,
  inventoryCache: new Map(),
  selectedAssetIds: new Set(),
  cacheTtlMs: 5 * 60 * 1000,
  splitDragging: false,
  panelWidth: 220
};

function renderWebInvAccountList() {
  if (!ui.webInvAccountList) return;
  const wrap = ui.webInvAccountList;
  wrap.replaceChildren();
  const accounts = state.savedAccounts || [];
  for (const acc of accounts) {
    const item = document.createElement("div");
    item.className = "web-inv-account-item" + (webInvState.selectedAccount === acc.username ? " selected" : "");
    const avatar = document.createElement("div");
    avatar.className = "web-inv-account-item-avatar";
    if (acc.avatar_url) {
      const img = document.createElement("img");
      img.src = acc.avatar_url;
      img.width = 28; img.height = 28;
      avatar.append(img);
    }
    const name = document.createElement("span");
    name.className = "web-inv-account-item-name";
    name.textContent = acc.steam_name || acc.username;
    item.append(avatar, name);
    if (acc.ban_status) {
      const badge = document.createElement("span");
      badge.className = "web-inv-account-item-badge " + (acc.ban_status.includes("正常") ? "ban-ok" : acc.ban_status.includes("🟡") ? "ban-warn" : "ban-bad");
      badge.textContent = acc.ban_status.includes("正常") ? "正常" : "封禁";
      badge.title = acc.ban_status;
      item.append(badge);
    }
    item.onclick = () => webInvSelectAccount(acc.username);
    wrap.append(item);
  }
}

function webInvSelectAccount(username) {
  webInvState.selectedAccount = username;
  webInvState.selectedAssetIds.clear();
  renderWebInvAccountList();
  renderWebInvAccountInfo();
  renderWebInvItemGrid();
  updateWebInvActionBar();
}

function renderWebInvAccountInfo() {
  if (!ui.webInvAccountInfo) return;
  const username = webInvState.selectedAccount;
  if (!username) {
    ui.webInvAccountInfo.classList.add("hidden");
    return;
  }
  ui.webInvAccountInfo.classList.remove("hidden");
  const acc = (state.savedAccounts || []).find(a => a.username === username);
  if (!acc) return;
  ui.webInvAccName.textContent = acc.steam_name || acc.username;
  ui.webInvAccBalance.textContent = acc.balance || "-";
  ui.webInvAccBanStatus.textContent = acc.ban_status || "-";
  const tradeUrl = acc.trade_url || "";
  ui.webInvAccTradeUrl.textContent = tradeUrl ? tradeUrl.slice(0, 50) + (tradeUrl.length > 50 ? "..." : "") : "-";
  ui.webInvAccTradeUrl.title = tradeUrl || "无交易链接";
  ui.webInvAccTradeUrl.onclick = () => {
    if (tradeUrl) { navigator.clipboard.writeText(tradeUrl).catch(() => {}); }
  };
}

function webInvComponentName(component, componentId) {
  const key = String(componentId || "").trim();
  if (!key) return "";
  const summaryMap = component && component.summary_map && typeof component.summary_map === "object"
    ? component.summary_map
    : {};
  const summary = summaryMap[key];
  const rawName = String(summary && summary.name || "").trim();
  return compactComponentName(rawName || key);
}

function webInvAdaptSnapshotRow(row, component) {
  if (!row || typeof row !== "object") return null;
  const assetid = rowAssetId(row);
  if (!assetid) return null;
  if (Number(row.def_index || 0) === STORAGE_UNIT_DEF_INDEX) return null;
  const componentId = String(row.casket_id || "").trim();
  const hiddenReason = String(row.hidden_reason || "").trim();
  const imageUrl = preferredRowSkinImageUrl(row);
  const marketHashName = String(row.market_hash_name || "").trim();
  const name = String(row.name || marketHashName || assetid).trim();
  const tradable = !hiddenReason && coolingUnlockTs(row) <= 0;
  return {
    assetid,
    asset_id: assetid,
    market_hash_name: marketHashName || name,
    name: name || marketHashName || assetid,
    name_color: String(row.name_color || "").trim(),
    image_url: imageUrl,
    icon_url: String(row.icon_url || "").trim(),
    tradable,
    tradable_after: row.tradable_after,
    source_scope: componentId ? "component" : "main",
    source_component_id: componentId,
    source_component_name: componentId ? webInvComponentName(component, componentId) : "",
    is_component_item: !!componentId,
    can_transfer: tradable && !componentId,
    can_list: !hiddenReason && !!(marketHashName || name),
    block_reason: hiddenReason,
    raw_row: row
  };
}

function webInvBuildSnapshotCacheEntry(data) {
  const rows = Array.isArray(data && data.rows) ? data.rows : [];
  const component = data && data.component ? data.component : {summary_map: {}, item_map: {}};
  return {
    rows,
    component,
    items: rows.map((row) => webInvAdaptSnapshotRow(row, component)).filter(Boolean),
    fetchTime: String(data && data.fetch_time || "").trim(),
    snapshotPath: data && data.snapshot && data.snapshot.path ? data.snapshot.path : "",
    fetchedAt: Date.now()
  };
}

function webInvResolveImageSrc(item, size = "96fx96f") {
  const direct = String(item && item.image_url || "").trim();
  if (direct) return direct;
  const iconPath = String(item && item.icon_url || "").trim();
  return iconPath ? `https://community.akamai.steamstatic.com/economy/image/${iconPath}/${size}` : "";
}

function renderWebInvItemGrid() {
  if (!ui.webInvItemGrid) return;
  const grid = ui.webInvItemGrid;
  grid.replaceChildren();
  const username = webInvState.selectedAccount;
  if (!username) return;
  const cached = webInvState.inventoryCache.get(username);
  if (!cached) {
    const hint = document.createElement("div");
    hint.className = "web-inv-grid-empty";
    hint.textContent = "点击「拉取库存」获取物品";
    grid.append(hint);
    return;
  }
  let items = cached.items || [];
  if (ui.webInvTradableOnly && ui.webInvTradableOnly.checked) {
    items = items.filter(it => it.tradable);
  }
  if (items.length === 0) {
    const hint = document.createElement("div");
    hint.className = "web-inv-grid-empty";
    hint.textContent = "库存为空";
    grid.append(hint);
    return;
  }
  for (const item of items) {
    const card = document.createElement("div");
    card.className = "web-inv-item-card" + (webInvState.selectedAssetIds.has(item.assetid) ? " selected" : "");
    const img = document.createElement("img");
    img.src = webInvResolveImageSrc(item, "96fx96f");
    img.alt = item.market_hash_name || item.name || "";
    img.loading = "lazy";
    const label = document.createElement("div");
    label.className = "web-inv-item-label";
    label.textContent = item.market_hash_name || item.name || "Unknown";
    label.title = item.source_component_name ? `${label.textContent}\n来源：${item.source_component_name}` : label.textContent;
    card.title = label.title;
    card.append(img, label);
    if (!item.tradable) {
      card.classList.add("not-tradable");
    }
    card.onclick = () => {
      if (webInvState.selectedAssetIds.has(item.assetid)) {
        webInvState.selectedAssetIds.delete(item.assetid);
        card.classList.remove("selected");
      } else {
        webInvState.selectedAssetIds.add(item.assetid);
        card.classList.add("selected");
      }
      updateWebInvActionBar();
    };
    grid.append(card);
  }
}

function updateWebInvActionBar() {
  const count = webInvState.selectedAssetIds.size;
  if (ui.webInvSelectedCount) ui.webInvSelectedCount.textContent = `已选 ${count} 件`;
  if (ui.webInvActionBar) ui.webInvActionBar.classList.toggle("hidden", count === 0);
  if (ui.webInvActionCount) ui.webInvActionCount.textContent = `${count} 件物品`;
}

async function webInvFetchInventory() {
  const username = webInvState.selectedAccount;
  if (!username) return;
  if (ui.webInvFetchBtn) { ui.webInvFetchBtn.disabled = true; ui.webInvFetchBtn.textContent = "拉取中..."; }
  try {
    const resp = await fetch(`/api/accounts/${encodeURIComponent(username)}/inventory`);
    const data = await resp.json();
    if (data.ok && data.items) {
      webInvState.inventoryCache.set(username, {
        items: data.items,
        rows: [],
        component: {summary_map: {}, item_map: {}},
        fetchTime: "",
        snapshotPath: "",
        fetchedAt: Date.now()
      });
      webInvState.selectedAssetIds.clear();
      renderWebInvItemGrid();
      updateWebInvActionBar();
    } else {
      alert("拉取失败: " + (data.message || "未知错误"));
    }
  } catch (err) {
    alert("拉取失败: " + err.message);
  } finally {
    if (ui.webInvFetchBtn) { ui.webInvFetchBtn.disabled = false; ui.webInvFetchBtn.textContent = "拉取库存"; }
  }
}

function webInvSelectAll() {
  const username = webInvState.selectedAccount;
  if (!username) return;
  const cached = webInvState.inventoryCache.get(username);
  if (!cached) return;
  let items = cached.items || [];
  if (ui.webInvTradableOnly && ui.webInvTradableOnly.checked) {
    items = items.filter(it => it.tradable);
  }
  const allSelected = items.length > 0 && items.every(it => webInvState.selectedAssetIds.has(it.assetid));
  if (allSelected) {
    webInvState.selectedAssetIds.clear();
  } else {
    for (const it of items) webInvState.selectedAssetIds.add(it.assetid);
  }
  renderWebInvItemGrid();
  updateWebInvActionBar();
}

async function webInvFetchBalance() {
  const username = webInvState.selectedAccount;
  if (!username) return;
  if (ui.webInvBalanceBtn) { ui.webInvBalanceBtn.disabled = true; ui.webInvBalanceBtn.textContent = "查询中..."; }
  try {
    const resp = await fetch("/api/accounts/fetch-balance", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({usernames: [username]})
    });
    const data = await resp.json();
    if (data.ok && data.results && data.results.length > 0) {
      const r = data.results[0];
      if (r.success) {
        const acc = (state.savedAccounts || []).find(a => a.username === username);
        if (acc) acc.balance = r.balance;
        renderWebInvAccountInfo();
      } else {
        alert("余额查询失败: " + (r.message || "未知错误"));
      }
    }
  } catch (err) {
    alert("余额查询失败: " + err.message);
  } finally {
    if (ui.webInvBalanceBtn) { ui.webInvBalanceBtn.disabled = false; ui.webInvBalanceBtn.textContent = "查询余额"; }
  }
}

async function webInvBatchBanCheck() {
  if (ui.webInvBatchBanCheck) { ui.webInvBatchBanCheck.disabled = true; ui.webInvBatchBanCheck.textContent = "检测中..."; }
  try {
    const accounts = state.savedAccounts || [];
    const usernames = accounts.map(a => a.username);
    if (usernames.length === 0) return;
    const resp = await fetch("/api/accounts/check-bans", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({usernames})
    });
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("text/event-stream")) {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        let eventName = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) eventName = line.slice(7).trim();
          else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventName === "ban-result" && data.username) {
                const acc = accounts.find(a => a.username === data.username);
                if (acc) acc.ban_status = data.banStatus || "";
              }
            } catch (_) {}
          }
        }
      }
      renderWebInvAccountList();
      renderWebInvAccountInfo();
    } else {
      const data = await resp.json();
      if (data.ok && data.results) {
        for (const r of data.results) {
          const acc = accounts.find(a => a.username === r.username);
          if (acc) acc.ban_status = r.banStatus || "";
        }
        renderWebInvAccountList();
        renderWebInvAccountInfo();
      }
    }
  } catch (err) {
    alert("封禁检测失败: " + err.message);
  } finally {
    if (ui.webInvBatchBanCheck) { ui.webInvBatchBanCheck.disabled = false; ui.webInvBatchBanCheck.textContent = "封禁检测"; }
  }
}

async function webInvBatchTradeUrl() {
  if (ui.webInvBatchTradeUrl) { ui.webInvBatchTradeUrl.disabled = true; ui.webInvBatchTradeUrl.textContent = "刷新中..."; }
  try {
    const accounts = state.savedAccounts || [];
    const usernames = accounts.map(a => a.username);
    if (usernames.length === 0) return;
    const resp = await fetch("/api/accounts/refresh-trade-url", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({usernames})
    });
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("text/event-stream")) {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        let eventName = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) eventName = line.slice(7).trim();
          else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventName === "trade-url-result" && data.username) {
                const acc = accounts.find(a => a.username === data.username);
                if (acc) acc.trade_url = data.tradeUrl || "";
              }
            } catch (_) {}
          }
        }
      }
      renderWebInvAccountInfo();
    } else {
      const data = await resp.json();
      if (data.ok && data.results) {
        for (const r of data.results) {
          const acc = accounts.find(a => a.username === r.username);
          if (acc) acc.trade_url = r.tradeUrl || "";
        }
        renderWebInvAccountInfo();
      }
    }
  } catch (err) {
    alert("刷新交易链接失败: " + err.message);
  } finally {
    if (ui.webInvBatchTradeUrl) { ui.webInvBatchTradeUrl.disabled = false; ui.webInvBatchTradeUrl.textContent = "刷新链接"; }
  }
}

// ═══ 市场上架 ═══

function openMarketSellModal() {
  const username = webInvState.selectedAccount;
  if (!username || webInvState.selectedAssetIds.size === 0) return;
  const cached = webInvState.inventoryCache.get(username);
  if (!cached) return;
  const selectedItems = (cached.items || []).filter(it => webInvState.selectedAssetIds.has(it.assetid));
  if (selectedItems.length === 0) return;

  if (ui.marketSellModal) ui.marketSellModal.classList.remove("hidden");
  if (ui.marketSellProgress) ui.marketSellProgress.classList.add("hidden");
  if (ui.marketSellStartBtn) ui.marketSellStartBtn.disabled = false;

  const list = ui.marketSellItemList;
  if (!list) return;
  list.replaceChildren();

  for (const item of selectedItems) {
    const row = document.createElement("div");
    row.className = "market-sell-item-row";
    row.dataset.assetid = item.assetid;
    row.dataset.marketHashName = item.market_hash_name || "";

    const img = document.createElement("img");
    img.src = webInvResolveImageSrc(item, "64fx64f");
    img.width = 48; img.height = 48;

    const nameSpan = document.createElement("span");
    nameSpan.className = "market-sell-item-name";
    nameSpan.textContent = item.market_hash_name || item.name || "Unknown";

    const refPrice = document.createElement("span");
    refPrice.className = "market-sell-ref-price";
    refPrice.textContent = "-";
    refPrice.dataset.assetid = item.assetid;

    const priceInput = document.createElement("input");
    priceInput.type = "number";
    priceInput.className = "market-sell-price-input";
    priceInput.placeholder = "卖家到手(分)";
    priceInput.min = "1";
    priceInput.dataset.assetid = item.assetid;
    priceInput.oninput = () => updateMarketSellSummary();

    const buyerSpan = document.createElement("span");
    buyerSpan.className = "market-sell-buyer-price";
    buyerSpan.textContent = "-";
    buyerSpan.dataset.assetid = item.assetid;

    priceInput.addEventListener("input", () => {
      const cents = parseInt(priceInput.value, 10);
      if (cents > 0) {
        const steamFee = Math.max(1, Math.floor(cents * 0.1));
        const gameFee = Math.max(1, Math.floor(cents * 0.05));
        buyerSpan.textContent = `买家付 ¥${((cents + steamFee + gameFee) / 100).toFixed(2)}`;
      } else {
        buyerSpan.textContent = "-";
      }
    });

    row.append(img, nameSpan, refPrice, priceInput, buyerSpan);
    list.append(row);
  }
  updateMarketSellSummary();
}

function updateMarketSellSummary() {
  if (!ui.marketSellSummary) return;
  const inputs = (ui.marketSellItemList || document).querySelectorAll(".market-sell-price-input");
  let count = 0, totalCents = 0;
  for (const inp of inputs) {
    const v = parseInt(inp.value, 10);
    if (v > 0) { count++; totalCents += v; }
  }
  ui.marketSellSummary.textContent = `${count} 件 · 预估收入 ¥${(totalCents / 100).toFixed(2)}`;
}

async function marketSellFetchPrices() {
  const rows = (ui.marketSellItemList || document).querySelectorAll(".market-sell-item-row");
  const items = [];
  for (const row of rows) {
    const name = row.dataset.marketHashName;
    if (name) items.push({marketHashName: name, assetid: row.dataset.assetid});
  }
  if (items.length === 0) return;
  if (ui.marketSellFetchPricesBtn) { ui.marketSellFetchPricesBtn.disabled = true; ui.marketSellFetchPricesBtn.textContent = "查询中..."; }
  try {
    const resp = await fetch("/api/market/batch-price", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({items, currency: 23})
    });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      let eventName = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) eventName = line.slice(7).trim();
        else if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (eventName === "price-result" && data.marketHashName) {
              const refEls = (ui.marketSellItemList || document).querySelectorAll(`.market-sell-ref-price`);
              for (const el of refEls) {
                const row = el.closest(".market-sell-item-row");
                if (row && row.dataset.marketHashName === data.marketHashName) {
                  el.textContent = data.lowestPrice || "-";
                  el.dataset.lowestPriceCents = data.lowestPriceCents || "";
                }
              }
            }
          } catch (_) {}
        }
      }
    }
  } catch (err) {
    console.error("批量查价失败:", err);
  } finally {
    if (ui.marketSellFetchPricesBtn) { ui.marketSellFetchPricesBtn.disabled = false; ui.marketSellFetchPricesBtn.textContent = "查询市场价"; }
  }
}

function marketSellApplyPct() {
  const pct = parseInt((ui.marketSellPricePct || {}).value, 10) || 100;
  const rows = (ui.marketSellItemList || document).querySelectorAll(".market-sell-item-row");
  for (const row of rows) {
    const refEl = row.querySelector(".market-sell-ref-price");
    const input = row.querySelector(".market-sell-price-input");
    if (!refEl || !input) continue;
    const refText = refEl.textContent || "";
    const match = refText.match(/([\d,.]+)/);
    if (match) {
      const refYuan = parseFloat(match[1].replace(",", ""));
      if (refYuan > 0) {
        const sellerCents = Math.max(1, Math.round(refYuan * 100 * pct / 100 / 1.15));
        input.value = sellerCents;
        input.dispatchEvent(new Event("input"));
      }
    }
  }
  updateMarketSellSummary();
}

async function marketSellStart() {
  const username = webInvState.selectedAccount;
  if (!username) return;
  const rows = (ui.marketSellItemList || document).querySelectorAll(".market-sell-item-row");
  const items = [];
  for (const row of rows) {
    const input = row.querySelector(".market-sell-price-input");
    const cents = parseInt(input?.value, 10);
    if (cents > 0) {
      items.push({assetId: row.dataset.assetid, priceInCents: cents, currency: 23});
    }
  }
  if (items.length === 0) { alert("请先设置价格"); return; }
  if (ui.marketSellStartBtn) ui.marketSellStartBtn.disabled = true;
  if (ui.marketSellProgress) ui.marketSellProgress.classList.remove("hidden");

  try {
    const resp = await fetch("/api/market/batch-sell", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({username, items})
    });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      let eventName = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) eventName = line.slice(7).trim();
        else if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (eventName === "progress") {
              const pct = Math.round(((data.index + 1) / data.total) * 100);
              if (ui.marketSellProgressFill) ui.marketSellProgressFill.style.width = pct + "%";
              if (ui.marketSellProgressText) ui.marketSellProgressText.textContent = `上架中 ${data.index + 1}/${data.total}`;
            } else if (eventName === "done") {
              if (ui.marketSellProgressText) ui.marketSellProgressText.textContent = `完成: 成功 ${data.successCount}, 失败 ${data.failCount}`;
              // 上架完成后，延迟 2 秒自动打开确认弹窗
              if (data.successCount > 0) {
                setTimeout(() => openMarketConfirmModal(), 2000);
              }
            }
          } catch (_) {}
        }
      }
    }
  } catch (err) {
    alert("上架失败: " + err.message);
  } finally {
    if (ui.marketSellStartBtn) ui.marketSellStartBtn.disabled = false;
  }
}

// ═══ 市场上架确认 ═══

async function openMarketConfirmModal() {
  const username = webInvState.selectedAccount;
  if (!username) { alert("请先选择账号"); return; }

  if (ui.marketConfirmModal) ui.marketConfirmModal.classList.remove("hidden");
  if (ui.marketConfirmProgress) ui.marketConfirmProgress.classList.add("hidden");
  if (ui.marketConfirmStartBtn) ui.marketConfirmStartBtn.disabled = false;
  if (ui.marketConfirmItemList) ui.marketConfirmItemList.replaceChildren();
  if (ui.marketConfirmCount) ui.marketConfirmCount.textContent = "加载中...";
  if (ui.marketConfirmSummary) ui.marketConfirmSummary.textContent = "已选 0 项";
  if (ui.marketConfirmSelectAll) ui.marketConfirmSelectAll.checked = false;

  await marketConfirmRefresh();
}

async function marketConfirmRefresh() {
  const username = webInvState.selectedAccount;
  if (!username) return;

  if (ui.marketConfirmRefreshBtn) ui.marketConfirmRefreshBtn.disabled = true;
  if (ui.marketConfirmCount) ui.marketConfirmCount.textContent = "加载中...";
  if (ui.marketConfirmItemList) ui.marketConfirmItemList.replaceChildren();

  try {
    const resp = await fetch("/api/market/confirmations", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({username})
    });
    const data = await resp.json();
    if (!data.ok) { alert(data.message || "获取确认列表失败"); return; }

    const items = data.confirmations || [];
    if (ui.marketConfirmCount) ui.marketConfirmCount.textContent = `${items.length} 项待确认`;

    const list = ui.marketConfirmItemList;
    if (!list) return;

    for (const item of items) {
      const row = document.createElement("div");
      row.className = "market-confirm-item-row";
      row.dataset.confirmId = item.id;
      row.dataset.confirmKey = item.key;

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "market-confirm-item-cb";
      cb.onchange = () => updateMarketConfirmSummary();

      const icon = document.createElement("img");
      icon.src = item.icon || "";
      icon.width = 44; icon.height = 33;
      icon.onerror = () => { icon.style.display = "none"; };

      const titleSpan = document.createElement("span");
      titleSpan.className = "market-confirm-item-title";
      titleSpan.textContent = item.title || "未知物品";

      const descSpan = document.createElement("span");
      descSpan.className = "market-confirm-item-desc";
      descSpan.textContent = item.description || "";

      row.append(cb, icon, titleSpan, descSpan);
      list.appendChild(row);
    }
  } catch (err) {
    alert("获取确认列表失败: " + err.message);
  } finally {
    if (ui.marketConfirmRefreshBtn) ui.marketConfirmRefreshBtn.disabled = false;
  }
}

function updateMarketConfirmSummary() {
  const cbs = (ui.marketConfirmItemList || document).querySelectorAll(".market-confirm-item-cb:checked");
  if (ui.marketConfirmSummary) ui.marketConfirmSummary.textContent = `已选 ${cbs.length} 项`;
}

async function marketConfirmStart() {
  const username = webInvState.selectedAccount;
  if (!username) return;

  const rows = (ui.marketConfirmItemList || document).querySelectorAll(".market-confirm-item-row");
  const ids = [];
  for (const row of rows) {
    const cb = row.querySelector(".market-confirm-item-cb");
    if (cb && cb.checked) {
      ids.push(row.dataset.confirmId);
    }
  }
  if (ids.length === 0) { alert("请先勾选要确认的物品"); return; }

  if (ui.marketConfirmStartBtn) ui.marketConfirmStartBtn.disabled = true;
  if (ui.marketConfirmProgress) ui.marketConfirmProgress.classList.remove("hidden");
  if (ui.marketConfirmProgressFill) ui.marketConfirmProgressFill.style.width = "0%";
  if (ui.marketConfirmProgressText) ui.marketConfirmProgressText.textContent = "确认中...";

  try {
    const resp = await fetch("/api/market/confirm-listings", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({username, confirmationIds: ids})
    });
    const data = await resp.json();
    if (!data.ok) { alert(data.message || "确认失败"); return; }

    const results = data.results || [];
    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;

    if (ui.marketConfirmProgressFill) ui.marketConfirmProgressFill.style.width = "100%";
    if (ui.marketConfirmProgressText) ui.marketConfirmProgressText.textContent = `完成: 成功 ${successCount}, 失败 ${failCount}`;

    // 确认完成后刷新列表
    setTimeout(() => marketConfirmRefresh(), 1500);
  } catch (err) {
    alert("确认失败: " + err.message);
  } finally {
    if (ui.marketConfirmStartBtn) ui.marketConfirmStartBtn.disabled = false;
  }
}

// ═══ Steam API Key 配置 ═══

async function openSteamApiKeyModal() {
  if (ui.steamApiKeyModal) ui.steamApiKeyModal.classList.remove("hidden");
  try {
    const resp = await fetch("/api/settings/steam-api-key");
    const data = await resp.json();
    if (ui.steamApiKeyInput) ui.steamApiKeyInput.value = data.hasKey ? "••••••••" : "";
  } catch (_) {}
}

async function saveSteamApiKey() {
  const key = (ui.steamApiKeyInput || {}).value || "";
  if (key === "••••••••") { if (ui.steamApiKeyModal) ui.steamApiKeyModal.classList.add("hidden"); return; }
  try {
    await fetch("/api/settings/steam-api-key", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({key})
    });
    if (ui.steamApiKeyModal) ui.steamApiKeyModal.classList.add("hidden");
  } catch (err) {
    alert("保存失败: " + err.message);
  }
}

// ═══ Web 库存管理页 — 分隔条拖拽 ═══

function initWebInvSplitDrag() {
  if (!ui.webInvSplitBar) return;
  ui.webInvSplitBar.onmousedown = (evt) => {
    evt.preventDefault();
    webInvState.splitDragging = true;
    document.body.classList.add("web-inv-split-dragging");
    const layout = ui.webInvSplitBar.parentElement;
    const onMove = (e) => {
      if (!webInvState.splitDragging) return;
      const rect = layout.getBoundingClientRect();
      let w = e.clientX - rect.left;
      w = Math.max(160, Math.min(w, rect.width - 200));
      webInvState.panelWidth = w;
      layout.style.gridTemplateColumns = `${w}px 6px 1fr`;
    };
    const onUp = () => {
      webInvState.splitDragging = false;
      document.body.classList.remove("web-inv-split-dragging");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
}

// ═══ Web 库存管理页 — 事件绑定 ═══

function bindWebInvEvents() {
  if (ui.webInvFetchBtn) ui.webInvFetchBtn.onclick = () => webInvFetchInventory();
  if (ui.webInvSelectAll) ui.webInvSelectAll.onclick = () => webInvSelectAll();
  if (ui.webInvTradableOnly) ui.webInvTradableOnly.onchange = () => { renderWebInvItemGrid(); updateWebInvActionBar(); };
  if (ui.webInvBalanceBtn) ui.webInvBalanceBtn.onclick = () => webInvFetchBalance();
  if (ui.webInvBatchBanCheck) ui.webInvBatchBanCheck.onclick = () => webInvBatchBanCheck();
  if (ui.webInvBatchTradeUrl) ui.webInvBatchTradeUrl.onclick = () => webInvBatchTradeUrl();
  if (ui.webInvSellBtn) ui.webInvSellBtn.onclick = () => openMarketSellModal();
  if (ui.webInvTransferBtn) ui.webInvTransferBtn.onclick = () => {
    // Reuse existing trade transfer modal
    const modal = document.getElementById("tradeTransferModal");
    if (modal) modal.classList.remove("hidden");
  };
  // Market sell modal
  if (ui.marketSellCloseBtn) ui.marketSellCloseBtn.onclick = () => { if (ui.marketSellModal) ui.marketSellModal.classList.add("hidden"); };
  if (ui.marketSellFetchPricesBtn) ui.marketSellFetchPricesBtn.onclick = () => marketSellFetchPrices();
  if (ui.marketSellApplyPctBtn) ui.marketSellApplyPctBtn.onclick = () => marketSellApplyPct();
  if (ui.marketSellStartBtn) ui.marketSellStartBtn.onclick = () => marketSellStart();
  // Market confirm modal
  if (ui.marketConfirmCloseBtn) ui.marketConfirmCloseBtn.onclick = () => { if (ui.marketConfirmModal) ui.marketConfirmModal.classList.add("hidden"); };
  if (ui.marketConfirmRefreshBtn) ui.marketConfirmRefreshBtn.onclick = () => marketConfirmRefresh();
  if (ui.marketConfirmSelectAll) ui.marketConfirmSelectAll.onchange = () => {
    const checked = ui.marketConfirmSelectAll.checked;
    (ui.marketConfirmItemList || document).querySelectorAll(".market-confirm-item-cb").forEach(cb => { cb.checked = checked; });
    updateMarketConfirmSummary();
  };
  if (ui.marketConfirmStartBtn) ui.marketConfirmStartBtn.onclick = () => marketConfirmStart();
  // Steam API Key modal
  if (ui.steamApiKeyCloseBtn) ui.steamApiKeyCloseBtn.onclick = () => { if (ui.steamApiKeyModal) ui.steamApiKeyModal.classList.add("hidden"); };
  if (ui.steamApiKeySaveBtn) ui.steamApiKeySaveBtn.onclick = () => saveSteamApiKey();
  // Split bar
  initWebInvSplitDrag();
}

// 初始化调用（在 DOMContentLoaded 或 init 中）
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindWebInvEvents);
  } else {
    bindWebInvEvents();
  }
}

// ===== Web 库存查看（旧弹窗，保留但不再从卡片触发） =====

const webInventoryState = {
  username: "",
  items: [],
  selectedAssetIds: new Set()
};

function openWebInventoryModal(username) {
  webInventoryState.username = username;
  webInventoryState.items = [];
  webInventoryState.selectedAssetIds.clear();

  const modal = document.getElementById("webInventoryModal");
  document.getElementById("webInventoryAccountName").textContent = username;
  document.getElementById("webInventoryLoading").style.display = "";
  document.getElementById("webInventoryList").innerHTML = "";
  document.getElementById("webInventoryEmpty").classList.add("hidden");
  document.getElementById("webInventoryCount").textContent = "0 件物品";
  modal.classList.remove("hidden");

  fetchWebInventory(username);
}

async function fetchWebInventory(username) {
  try {
    const data = await api(`/api/snapshot/account?username=${encodeURIComponent(username)}&source=web_inventory&save_stub=1`);
    const cached = webInvBuildSnapshotCacheEntry(data);
    document.getElementById("webInventoryLoading").style.display = "none";
    webInventoryState.items = cached.items || [];
    if (webInventoryState.items.length === 0) {
      document.getElementById("webInventoryEmpty").classList.remove("hidden");
      return;
    }

    renderWebInventoryList();
  } catch (err) {
    document.getElementById("webInventoryLoading").style.display = "none";
    document.getElementById("webInventoryEmpty").textContent = `错误: ${err.message}`;
    document.getElementById("webInventoryEmpty").classList.remove("hidden");
  }
}

function renderWebInventoryList() {
  const wrap = document.getElementById("webInventoryList");
  wrap.innerHTML = "";

  for (const item of webInventoryState.items) {
    const div = document.createElement("div");
    div.className = `web-inventory-item${item.tradable ? "" : " not-tradable"}`;
    if (webInventoryState.selectedAssetIds.has(item.assetid)) div.classList.add("selected");

    const img = document.createElement("img");
    img.src = webInvResolveImageSrc(item, "96fx96f");
    img.alt = item.name;
    img.loading = "lazy";

    const name = document.createElement("div");
    name.className = "item-name";
    name.textContent = item.name || item.market_hash_name || "-";
    if (item.name_color) name.style.color = `#${item.name_color}`;

    div.append(img, name);

    if (!item.tradable) {
      const badge = document.createElement("span");
      badge.className = "item-tradable-badge";
      badge.textContent = "不可交易";
      div.append(badge);
    }

    div.onclick = () => {
      if (!item.tradable) return;
      if (webInventoryState.selectedAssetIds.has(item.assetid)) {
        webInventoryState.selectedAssetIds.delete(item.assetid);
        div.classList.remove("selected");
      } else {
        webInventoryState.selectedAssetIds.add(item.assetid);
        div.classList.add("selected");
      }
      document.getElementById("webInventoryCount").textContent = `${webInventoryState.selectedAssetIds.size} 件已选`;
    };

    wrap.append(div);
  }

  document.getElementById("webInventoryCount").textContent = `${webInventoryState.items.length} 件物品`;
}

function initWebInventoryModal() {
  const modal = document.getElementById("webInventoryModal");
  const closeBtn = document.getElementById("webInventoryCloseBtn");
  const transferBtn = document.getElementById("webInventoryTransferBtn");

  if (!modal) return;

  closeBtn.onclick = () => modal.classList.add("hidden");
  modal.onclick = (e) => { if (e.target === modal) modal.classList.add("hidden"); };

  transferBtn.onclick = () => {
    if (webInventoryState.selectedAssetIds.size === 0) return;
    modal.classList.add("hidden");
    openTradeTransferModal(webInventoryState.username, [...webInventoryState.selectedAssetIds]);
  };
}

// ===== 库存转移 =====

const tradeTransferState = {
  fromUsername: "",
  assetIds: [],
  running: false
};

function openTradeTransferModal(fromUsername, assetIds) {
  tradeTransferState.fromUsername = fromUsername;
  tradeTransferState.assetIds = assetIds || [];
  tradeTransferState.running = false;

  const modal = document.getElementById("tradeTransferModal");
  const fromSelect = document.getElementById("tradeTransferFromSelect");
  const toAccountSelect = document.getElementById("tradeTransferToAccountSelect");
  const itemsWrap = document.getElementById("tradeTransferSelectedItems");
  const progressWrap = document.getElementById("tradeTransferProgress");

  // 填充发送方下拉
  fromSelect.innerHTML = "";
  for (const acc of state.accounts) {
    if (!acc.mafile_content) continue;
    const opt = document.createElement("option");
    opt.value = acc.username;
    opt.textContent = acc.remark || acc.username;
    if (acc.username === fromUsername) opt.selected = true;
    fromSelect.append(opt);
  }

  // 填充接收方下拉
  toAccountSelect.innerHTML = "";
  for (const acc of state.accounts) {
    if (acc.username === fromUsername) continue;
    const opt = document.createElement("option");
    opt.value = acc.username;
    opt.textContent = acc.remark || acc.username;
    toAccountSelect.append(opt);
  }

  // 显示选中物品
  itemsWrap.innerHTML = "";
  const selectedItems = webInventoryState.items.filter((it) => assetIds.includes(it.assetid));
  for (const item of selectedItems) {
    const chip = document.createElement("span");
    chip.className = "trade-transfer-item-chip";
    chip.textContent = item.name || item.market_hash_name || item.assetid;
    itemsWrap.append(chip);
  }

  document.getElementById("tradeTransferItemCount").textContent = `${assetIds.length} 件物品`;
  progressWrap.classList.add("hidden");
  progressWrap.innerHTML = "";
  modal.classList.remove("hidden");
}

function initTradeTransferModal() {
  const modal = document.getElementById("tradeTransferModal");
  const closeBtn = document.getElementById("tradeTransferCloseBtn");
  const startBtn = document.getElementById("tradeTransferStartBtn");
  const toMode = document.getElementById("tradeTransferToMode");

  if (!modal) return;

  closeBtn.onclick = () => { if (!tradeTransferState.running) modal.classList.add("hidden"); };
  modal.onclick = (e) => { if (e.target === modal && !tradeTransferState.running) modal.classList.add("hidden"); };

  toMode.onchange = () => {
    document.getElementById("tradeTransferUrlWrap").classList.toggle("hidden", toMode.value !== "url");
    document.getElementById("tradeTransferAccountWrap").classList.toggle("hidden", toMode.value !== "account");
  };

  startBtn.onclick = () => startTradeTransfer();
}

async function startTradeTransfer() {
  if (tradeTransferState.running) return;
  tradeTransferState.running = true;

  const fromUsername = document.getElementById("tradeTransferFromSelect").value;
  const toMode = document.getElementById("tradeTransferToMode").value;
  let toTradeUrl = "";

  if (toMode === "url") {
    toTradeUrl = document.getElementById("tradeTransferUrl").value.trim();
  } else {
    // 从库中账号获取交易链接 — 暂时需要用户手动输入
    // TODO: 存储账号交易链接
    toTradeUrl = prompt("请输入接收方的交易链接：");
  }

  if (!toTradeUrl) {
    tradeTransferState.running = false;
    return;
  }

  const progressWrap = document.getElementById("tradeTransferProgress");
  const startBtn = document.getElementById("tradeTransferStartBtn");
  progressWrap.classList.remove("hidden");
  progressWrap.innerHTML = '<div class="step-line">开始转移...</div>';
  startBtn.disabled = true;

  try {
    const resp = await fetch("/api/accounts/send-trade-offer", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        fromUsername,
        toTradeUrl,
        assetIds: tradeTransferState.assetIds
      })
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let eventName = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventName = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            const stepDiv = document.createElement("div");
            if (eventName === "step") {
              stepDiv.className = "step-line";
              stepDiv.textContent = data.message || JSON.stringify(data);
            } else if (eventName === "done") {
              stepDiv.className = "step-line ok";
              stepDiv.textContent = "转移完成！报价ID: " + (data.tradeofferid || "-");
            } else if (eventName === "error") {
              stepDiv.className = "step-line error";
              stepDiv.textContent = "错误: " + (data.message || "未知错误");
            }
            if (stepDiv.textContent) progressWrap.append(stepDiv);
          } catch (_) {}
        }
      }
    }
  } catch (err) {
    const errDiv = document.createElement("div");
    errDiv.className = "step-line error";
    errDiv.textContent = `请求失败: ${err.message}`;
    progressWrap.append(errDiv);
  }

  tradeTransferState.running = false;
  startBtn.disabled = false;
}

// ═══ Steam Guard 令牌绑定 ═══

let enrollState = { step: 1, username: "", mode: "", revocationCode: "", running: false };

function isReplaceEnrollMode(mode) {
  const value = String(mode || "").trim();
  return value === "replace_existing" || value === "replace";
}

function formatSteamGuardEnrollError(input, fallbackMessage) {
  const payload = input && typeof input === "object" && input.data && typeof input.data === "object"
    ? input.data
    : (input && typeof input === "object" ? input : null);
  const reason = String(payload && payload.reason || "").trim();
  const message = String(payload && payload.message || "").trim();
  const status = String(payload && payload.status || "").trim();
  const reasonMessageMap = {
    already_has_authenticator: "该账号已绑定 Steam Guard 令牌",
    replace_start_failed: "旧令牌替换验证启动失败，请稍后重试",
    rate_limited: "操作过于频繁，请稍后再试",
    no_phone_number: "该账号未绑定手机号，请先在 Steam 客户端绑定手机",
    unknown_error: `未知错误 (status=${status || "?"})`
  };
  if (reason && reasonMessageMap[reason]) {
    return reasonMessageMap[reason];
  }
  return message || String(input && input.message || "").trim() || fallbackMessage;
}

function initSteamGuardEnroll() {
  const btn = document.getElementById("accountPageEnrollBtn");
  const modal = document.getElementById("steamGuardEnrollModal");
  const closeBtn = document.getElementById("steamGuardEnrollCloseBtn");
  const actionBtn = document.getElementById("enrollActionBtn");
  const backBtn = document.getElementById("enrollBackBtn");

  if (!btn || !modal) return;

  btn.onclick = () => {
    enrollState = { step: 1, username: "", mode: "", revocationCode: "", running: false };
    populateEnrollAccountSelect();
    showEnrollStep(1);
    document.getElementById("enrollRevocationWrap").classList.remove("hidden");
    document.getElementById("enrollRevocationCode").textContent = "-";
    document.getElementById("enrollFinalRevCode").textContent = "-";
    document.getElementById("enrollFinalModeText").textContent = "Steam Guard 令牌绑定成功";
    document.getElementById("enrollStatusText").textContent = "";
    document.getElementById("enrollStatusText").className = "enroll-status";
    modal.classList.remove("hidden");
  };

  closeBtn.onclick = () => {
    if (enrollState.running) return;
    modal.classList.add("hidden");
  };
  modal.onclick = (e) => {
    if (e.target === modal && !enrollState.running) modal.classList.add("hidden");
  };

  actionBtn.onclick = () => handleEnrollAction();
  backBtn.onclick = () => {
    if (enrollState.step === 2 && !enrollState.running) showEnrollStep(1);
  };
}

function populateEnrollAccountSelect() {
  const sel = document.getElementById("enrollAccountSelect");
  sel.innerHTML = "";
  const accounts = (state.accounts || []).filter(a => a.username);
  if (!accounts.length) {
    const opt = document.createElement("option");
    opt.textContent = "无可用账号";
    opt.disabled = true;
    sel.append(opt);
    return;
  }
  for (const acc of accounts) {
    const opt = document.createElement("option");
    opt.value = acc.username;
    opt.textContent = acc.remark ? `${acc.remark} (${acc.username})` : acc.username;
    sel.append(opt);
  }
}

function showEnrollStep(step) {
  enrollState.step = step;
  document.getElementById("enrollStep1").classList.toggle("hidden", step !== 1);
  document.getElementById("enrollStep2").classList.toggle("hidden", step !== 2);
  document.getElementById("enrollStep3").classList.toggle("hidden", step !== 3);
  const actionBtn = document.getElementById("enrollActionBtn");
  const backBtn = document.getElementById("enrollBackBtn");
  if (step === 1) {
    actionBtn.textContent = "开始绑定";
    actionBtn.disabled = false;
    backBtn.classList.add("hidden");
  } else if (step === 2) {
    actionBtn.textContent = "确认绑定";
    actionBtn.disabled = false;
    backBtn.classList.remove("hidden");
  } else if (step === 3) {
    actionBtn.textContent = "完成";
    actionBtn.disabled = false;
    backBtn.classList.add("hidden");
  }
}

async function handleEnrollAction() {
  const statusEl = document.getElementById("enrollStatusText");
  const actionBtn = document.getElementById("enrollActionBtn");

  if (enrollState.step === 1) {
    // Step 1 → call enroll API
    const username = document.getElementById("enrollAccountSelect").value;
    if (!username) { statusEl.textContent = "请选择账号"; statusEl.className = "enroll-status error"; return; }
    enrollState.username = username;
    enrollState.running = true;
    actionBtn.disabled = true;
    statusEl.textContent = "正在连接 Steam 服务器...";
    statusEl.className = "enroll-status";
    try {
      const data = await api("/api/accounts/enroll-steam-guard", {
        method: "POST",
        body: JSON.stringify({ username })
      });
      if (!data.ok) {
        statusEl.textContent = formatSteamGuardEnrollError(data, "绑定失败");
        statusEl.className = "enroll-status error";
        enrollState.running = false;
        actionBtn.disabled = false;
        return;
      }
      enrollState.mode = data.mode || "new_enroll";
      enrollState.revocationCode = data.revocation_code || "";
      const isReplace = isReplaceEnrollMode(enrollState.mode);
      document.getElementById("enrollRevocationWrap").classList.toggle("hidden", isReplace);
      document.getElementById("enrollRevocationCode").textContent = enrollState.revocationCode || "-";
      document.getElementById("enrollSmsInput").value = "";
      statusEl.textContent = isReplace
        ? "旧令牌替换验证已开始，请输入收到的验证码"
        : "验证码已发送到绑定手机";
      statusEl.className = "enroll-status";
      enrollState.running = false;
      showEnrollStep(2);
    } catch (err) {
      statusEl.textContent = formatSteamGuardEnrollError(err, `请求失败：${err.message}`);
      statusEl.className = "enroll-status error";
      enrollState.running = false;
      actionBtn.disabled = false;
    }
  } else if (enrollState.step === 2) {
    // Step 2 → call finalize API
    const code = document.getElementById("enrollSmsInput").value.trim();
    if (!code) { statusEl.textContent = "请输入验证码"; statusEl.className = "enroll-status error"; return; }
    enrollState.running = true;
    actionBtn.disabled = true;
    statusEl.textContent = "正在验证...";
    statusEl.className = "enroll-status";
    try {
      const data = await api("/api/accounts/finalize-steam-guard", {
        method: "POST",
        body: JSON.stringify({ username: enrollState.username, activationCode: code })
      });
      if (!data.ok) {
        statusEl.textContent = formatSteamGuardEnrollError(data, "验证失败，请检查验证码");
        statusEl.className = "enroll-status error";
        enrollState.running = false;
        actionBtn.disabled = false;
        return;
      }
      document.getElementById("enrollFinalRevCode").textContent = data.revocation_code || enrollState.revocationCode;
      document.getElementById("enrollFinalModeText").textContent = isReplaceEnrollMode(enrollState.mode)
        ? "旧令牌已替换为新令牌"
        : "Steam Guard 令牌绑定成功";
      statusEl.textContent = "";
      enrollState.running = false;
      showEnrollStep(3);
      // Refresh account list
      try { await loadAccounts(); } catch (_) {}
    } catch (err) {
      statusEl.textContent = formatSteamGuardEnrollError(err, `请求失败：${err.message}`);
      statusEl.className = "enroll-status error";
      enrollState.running = false;
      actionBtn.disabled = false;
    }
  } else if (enrollState.step === 3) {
    // Step 3 → close modal
    document.getElementById("steamGuardEnrollModal").classList.add("hidden");
  }
}

// ═══ Steam Guard 令牌详情 ═══

let tokenDetailState = { interval: null, sharedSecret: null, serverTimeDiff: 0 };

const STEAM_CHARS = "23456789BCDFGHJKMNPQRTVWXY";

async function computeSteamTotp(sharedSecretB64, serverTimeDiff) {
  const secretBytes = Uint8Array.from(atob(sharedSecretB64), c => c.charCodeAt(0));
  const time = Math.floor((Date.now() / 1000 + serverTimeDiff) / 30);
  const timeBytes = new ArrayBuffer(8);
  const view = new DataView(timeBytes);
  view.setUint32(4, time, false); // big-endian

  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, timeBytes);
  const hash = new Uint8Array(sig);

  const offset = hash[hash.length - 1] & 0x0f;
  let code = ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];

  let result = "";
  for (let i = 0; i < 5; i++) {
    result += STEAM_CHARS[code % STEAM_CHARS.length];
    code = Math.floor(code / STEAM_CHARS.length);
  }
  return result;
}

function getTotpRemaining(serverTimeDiff) {
  return 30 - Math.floor((Date.now() / 1000 + serverTimeDiff) % 30);
}

function parseTokenDetailSteamData(steamData) {
  if (!steamData) {
    return {};
  }
  if (typeof steamData === "string") {
    try {
      const parsed = JSON.parse(steamData);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  return steamData && typeof steamData === "object" ? steamData : {};
}

function sanitizeTokenDetailSecret(value) {
  const text = String(value || "").trim();
  if (!text || text === "[REDACTED]") {
    return "";
  }
  return text;
}

function extractSharedSecretFromTokenDetailData(steamData) {
  const raw = parseTokenDetailSteamData(steamData);
  const response = raw && raw.response && typeof raw.response === "object" ? raw.response : {};
  const responsePascal = raw && raw.Response && typeof raw.Response === "object" ? raw.Response : {};
  const candidates = [
    raw.shared_secret,
    raw.SharedSecret,
    response.shared_secret,
    response.SharedSecret,
    responsePascal.shared_secret,
    responsePascal.SharedSecret
  ];
  for (const candidate of candidates) {
    const secret = sanitizeTokenDetailSecret(candidate);
    if (secret) {
      return secret;
    }
  }
  return "";
}

async function decryptTokenDetailSharedSecret(data) {
  const encryptedSecret = String(data && data.encryptedSecret || "").trim();
  const secretKeyHex = String(data && data.secretKeyHex || "").trim();
  const ivHex = String(data && data.ivHex || "").trim();
  if (!encryptedSecret || !secretKeyHex || !ivHex || !crypto || !crypto.subtle) {
    return "";
  }
  const keyParts = secretKeyHex.match(/.{2}/g);
  const ivParts = ivHex.match(/.{2}/g);
  if (!Array.isArray(keyParts) || !Array.isArray(ivParts)) {
    return "";
  }
  const keyBytes = new Uint8Array(keyParts.map((b) => parseInt(b, 16)));
  const ivBytes = new Uint8Array(ivParts.map((b) => parseInt(b, 16)));
  const encBytes = Uint8Array.from(atob(encryptedSecret), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, {name: "AES-CBC"}, false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({name: "AES-CBC", iv: ivBytes}, cryptoKey, encBytes);
  return new TextDecoder().decode(decrypted).trim();
}

async function openTokenDetailModal(username) {
  const modal = document.getElementById("tokenDetailModal");
  const nameEl = document.getElementById("tokenDetailAccountName");
  const codeEl = document.getElementById("tokenTotpCode");
  const barEl = document.getElementById("tokenTotpBar");
  const countdownEl = document.getElementById("tokenTotpCountdown");

  // Reset
  nameEl.textContent = username;
  codeEl.textContent = "-----";
  barEl.style.setProperty("--totp-progress", "100%");
  countdownEl.textContent = "30s";
  document.getElementById("tokenDeviceId").textContent = "●●●●●●●●";
  document.getElementById("tokenDeviceId").classList.add("masked");
  document.getElementById("tokenRevCode").textContent = "●●●●●●●●";
  document.getElementById("tokenRevCode").classList.add("masked");
  document.getElementById("tokenAccName").textContent = "-";
  document.getElementById("tokenSteamId").textContent = "-";
  document.getElementById("tokenRawData").textContent = "加载中...";

  // Clear previous interval
  if (tokenDetailState.interval) { clearInterval(tokenDetailState.interval); tokenDetailState.interval = null; }
  tokenDetailState.sharedSecret = null;

  modal.classList.remove("hidden");

  try {
    const data = await api(`/api/accounts/token-detail?username=${encodeURIComponent(username)}`);
    if (!data.ok) {
      codeEl.textContent = "ERROR";
      document.getElementById("tokenRawData").textContent = data.message || "加载失败";
      return;
    }

    // Populate info fields (store real values as data attributes)
    document.getElementById("tokenDeviceId").dataset.real = data.deviceId || "-";
    document.getElementById("tokenRevCode").dataset.real = data.revocationCode || "-";
    document.getElementById("tokenAccName").textContent = data.accountName || "-";
    document.getElementById("tokenSteamId").textContent = data.steamId64 || "-";
    document.getElementById("tokenSteamId").dataset.real = data.steamId64 || "-";

    // Raw data
    const rawSteamData = parseTokenDetailSteamData(data.steamData);
    document.getElementById("tokenRawData").textContent = JSON.stringify(rawSteamData, null, 2);

    codeEl.textContent = data.currentTotp || "-----";
    tokenDetailState.serverTimeDiff = data.serverTimeDiff || 0;
    const remaining = getTotpRemaining(tokenDetailState.serverTimeDiff);
    barEl.style.setProperty("--totp-progress", Math.round((remaining / 30) * 100) + "%");
    countdownEl.textContent = remaining + "s";

    let sharedSecret = "";
    try {
      sharedSecret = await decryptTokenDetailSharedSecret(data);
    } catch (_) {
      sharedSecret = "";
    }
    if (!sharedSecret) {
      sharedSecret = extractSharedSecretFromTokenDetailData(rawSteamData);
    }
    if (!sharedSecret) {
      return;
    }

    tokenDetailState.sharedSecret = sharedSecret;

    // Initial TOTP
    const totp = await computeSteamTotp(sharedSecret, tokenDetailState.serverTimeDiff);
    codeEl.textContent = totp;

    // Start interval
    tokenDetailState.interval = setInterval(async () => {
      try {
        const code = await computeSteamTotp(tokenDetailState.sharedSecret, tokenDetailState.serverTimeDiff);
        codeEl.textContent = code;
        const remaining = getTotpRemaining(tokenDetailState.serverTimeDiff);
        const pct = Math.round((remaining / 30) * 100);
        barEl.style.setProperty("--totp-progress", pct + "%");
        countdownEl.textContent = remaining + "s";
      } catch (_) {}
    }, 1000);

  } catch (err) {
    codeEl.textContent = "ERROR";
    document.getElementById("tokenRawData").textContent = `加载失败：${err.message}`;
  }
}

function initTokenDetailModal() {
  const modal = document.getElementById("tokenDetailModal");
  const closeBtn = document.getElementById("tokenDetailCloseBtn");
  if (!modal) return;

  const closeModal = () => {
    modal.classList.add("hidden");
    if (tokenDetailState.interval) { clearInterval(tokenDetailState.interval); tokenDetailState.interval = null; }
    tokenDetailState.sharedSecret = null;
  };

  closeBtn.onclick = closeModal;
  const doneBtn = document.getElementById("tokenDetailDoneBtn");
  if (doneBtn) doneBtn.onclick = closeModal;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };

  // Copy buttons
  modal.querySelectorAll(".token-copy-btn[data-copy]").forEach(btn => {
    btn.onclick = () => {
      const targetId = btn.dataset.copy;
      const el = document.getElementById(targetId);
      const text = el.dataset.real || el.textContent;
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = "\u2713";
        setTimeout(() => { btn.textContent = "\uD83D\uDCCB"; }, 1200);
      }).catch(() => {});
    };
  });

  // TOTP copy
  const totpCopyBtn = document.getElementById("tokenTotpCopyBtn");
  if (totpCopyBtn) {
    totpCopyBtn.onclick = () => {
      const code = document.getElementById("tokenTotpCode").textContent;
      navigator.clipboard.writeText(code).then(() => {
        totpCopyBtn.textContent = "\u2713";
        setTimeout(() => { totpCopyBtn.textContent = "\uD83D\uDCCB"; }, 1200);
      }).catch(() => {});
    };
  }

  // Toggle buttons
  modal.querySelectorAll(".token-toggle-btn").forEach(btn => {
    btn.onclick = () => {
      const targetId = btn.dataset.field;
      const el = document.getElementById(targetId);
      if (el.classList.contains("masked")) {
        el.textContent = el.dataset.real || "-";
        el.classList.remove("masked");
        btn.textContent = "\uD83D\uDD12";
      } else {
        el.textContent = "\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF";
        el.classList.add("masked");
        btn.textContent = "\uD83D\uDC41";
      }
    };
  });
}

async function init() {
  bindEvents();
  initBatchImport();
  initWebInventoryModal();
  initTradeTransferModal();
  initSteamGuardEnroll();
  initTokenDetailModal();
  bindWebInvEvents();
  try {
    renderLicenseGate();
    await loadLicenseState({hydrateWorkspace: true});
  } catch (err) {
    setLicenseStatus(`客户端授权检查失败：${err.message}`, true);
  }
}

init();
