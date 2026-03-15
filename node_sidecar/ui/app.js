const RARITY_MAP = {1: "Consumer", 2: "Industrial", 3: "Mil-Spec", 4: "Restricted", 5: "Classified", 6: "Covert", 7: "Contraband"};
const QUALITY_MAP = {1: "Genuine", 4: "Normal", 9: "StatTrak", 11: "Souvenir"};
const RARITY_VALUES = Object.keys(RARITY_MAP).map(Number).sort((a, b) => a - b).map((k) => RARITY_MAP[k]);
const STORAGE_UNIT_CAPACITY = 1000;
const MAIN_INVENTORY_CAPACITY = 1000;
const STORAGE_UNIT_DEF_INDEX = 1201;
const WEAR_INPUT_DECIMALS = 6;
const DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT = 5;
const SNAPSHOT_REUSE_WINDOW_MS = 10 * 60 * 1000;
const WEAR_SUFFIX_RANGES = [
  {keys: ["崭新出厂", "崭新", "factory new", "factorynew"], min: 0, max: 0.07},
  {keys: ["略有磨损", "略磨", "minimal wear", "minimalwear"], min: 0.07, max: 0.15},
  {keys: ["久经沙场", "久经", "field tested", "field-tested", "fieldtested"], min: 0.15, max: 0.38},
  {keys: ["破损不堪", "破损", "well worn", "well-worn", "wellworn"], min: 0.38, max: 0.45},
  {keys: ["战痕累累", "战痕", "battle scarred", "battle-scarred", "battlescarred"], min: 0.45, max: 1}
];

const state = {
  currentPage: "accountPage", accounts: [], activeAccount: "", accountSelectedUsername: "",
  currentAccountUsername: "", connectedUsername: "", rows: [], mode: "grouped", searchText: "",
  raritySelected: new Set(), collectionSelected: new Set(), collectionValues: [], collectionMenuKey: "", collectionSourceKey: "",
  wearMin: null, wearMax: null, wearSort: "asc", raritySort: "desc", quantitySort: "desc", collectionSort: "asc",
  renderInitialSize: 180, renderBatchSize: 240, renderWindowKey: "", renderVisibleCount: 0, renderVisibleTotal: 0,
  craftSelectedItemIds: new Set(), craftBusy: false, craftStatusText: "", craftIncludeCooling: false, craftShowSeed: false, craftShowCoolingTime: false, craftSettingsOpen: false, craftRecipeQueue: [], craftActiveRecipeId: "", craftRightPanelWidth: 360,
  craftAssistOpen: false, craftAssistPickerOpen: false, craftAssistPickerTargetMaterialId: "", craftAssistRoleChooserOpen: false, craftAssistPickRole: "main", craftAssistUseAbsoluteWear: false, craftAssistTargetWear: null, craftAssistWearOffsetPct: DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT, craftAssistMainCount: 5, craftAssistAuxCount: 5, craftAssistOverlayHeight: 0, craftAssistPresetWidth: 0, craftAssistMaterials: [], craftAssistPresets: [], craftAssistPresetApplyCountMap: {}, craftAssistPresetEditingId: "", craftAssistPresetEditingName: "", craftAssistPresetEditingBackup: null, craftAssistPresetEditingInitialSnapshot: null,
  expandedGroups: new Set(), selectedComponentId: "", showComponentItems: false, selectedComponentItemIds: new Set(), componentOpBusy: false,
  componentTaskQueue: {running: null, queued: []}, selectedQueueJobId: "", componentTaskProgressMap: {},
  targetDrawerOpen: false, targetComponentChoices: [], targetComponentSelectedId: "", targetComponentExcludeId: "",
  component: {summary_map: {}, item_map: {}}, snapshotPath: "", fetchTime: "", refreshing: false,
  snapshotDirty: false, snapshotDirtyReason: "", lastDirtyFallbackTs: 0, dirtyFallbackCooldownMs: 60 * 1000,
  refreshPhaseText: "", lastRefreshClickTs: 0, emptyHint: "请选用一个账号", filterPanel: "wear",
  rowsVersion: 0, filterCacheKey: "", filterCacheAllRows: [], filterCacheFilteredRows: [],
  groupCacheKey: "", groupCacheRows: [], lastPersistedSelected: "",
  profileHydratingUsernames: new Set(), profileHydratedUsernames: new Set(),
  snapshotCacheByAccount: new Map()
};

const ui = {
  navAccount: document.getElementById("navAccount"), navInventory: document.getElementById("navInventory"), navCraft: document.getElementById("navCraft"),
  accountPage: document.getElementById("accountPage"), inventoryPage: document.getElementById("inventoryPage"), craftPage: document.getElementById("craftPage"),
  accountUsername: document.getElementById("accountUsername"), accountPassword: document.getElementById("accountPassword"), accountTotp: document.getElementById("accountTotp"), accountRemark: document.getElementById("accountRemark"),
  loginSaveBtn: document.getElementById("loginSaveBtn"), clearAccountBtn: document.getElementById("clearAccountBtn"), accountStatus: document.getElementById("accountStatus"), savedAccountsWrap: document.getElementById("savedAccountsWrap"),
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
  componentCraftSettingsBtn: document.getElementById("componentCraftSettingsBtn"), componentCraftSettingsPanel: document.getElementById("componentCraftSettingsPanel"),
  componentCraftIncludeCooling: document.getElementById("componentCraftIncludeCooling"), componentCraftShowSeed: document.getElementById("componentCraftShowSeed"), componentCraftShowCoolingTime: document.getElementById("componentCraftShowCoolingTime"), componentCraftAssistWearOffsetPct: document.getElementById("componentCraftAssistWearOffsetPct"),
  componentCraftCoolingHint: document.getElementById("componentCraftCoolingHint"),
  componentTaskFloat: document.getElementById("componentTaskFloat"), componentTaskQueueList: document.getElementById("componentTaskQueueList"),
  componentTaskCancelBtn: document.getElementById("componentTaskCancelBtn"), componentTaskInfo: document.getElementById("componentTaskInfo"),
  targetComponentDrawer: document.getElementById("targetComponentDrawer"), targetComponentDrawerClose: document.getElementById("targetComponentDrawerClose"),
  targetComponentDrawerHint: document.getElementById("targetComponentDrawerHint"), targetComponentDrawerSelect: document.getElementById("targetComponentDrawerSelect"),
  targetComponentDrawerCancel: document.getElementById("targetComponentDrawerCancel"), targetComponentDrawerConfirm: document.getElementById("targetComponentDrawerConfirm"),
  remarkModal: document.getElementById("remarkModal"), remarkModalTitle: document.getElementById("remarkModalTitle"), remarkModalInput: document.getElementById("remarkModalInput"),
  remarkModalClose: document.getElementById("remarkModalClose"), remarkModalSaveBtn: document.getElementById("remarkModalSaveBtn"), remarkModalCancelBtn: document.getElementById("remarkModalCancelBtn"),
  snapshotPath: document.getElementById("snapshotPath"), listWrap: document.getElementById("listWrap"),
  craftConnectText: document.getElementById("craftConnectText"),
  craftSelectedText: document.getElementById("craftSelectedText"), craftRecipeText: document.getElementById("craftRecipeText"),
  craftStatusText: document.getElementById("craftStatusText"), craftCoolingHint: document.getElementById("craftCoolingHint"),
  craftLeftPanel: document.getElementById("craftLeftPanel"), craftSelectionList: document.getElementById("craftSelectionList"), craftSettingsBtn: document.getElementById("craftSettingsBtn"),
  craftSettingsPanel: document.getElementById("craftSettingsPanel"), craftIncludeCooling: document.getElementById("craftIncludeCooling"), craftShowSeed: document.getElementById("craftShowSeed"), craftShowCoolingTime: document.getElementById("craftShowCoolingTime"), craftAssistWearOffsetPct: document.getElementById("craftAssistWearOffsetPct"),
  craftAddRecipeBtn: document.getElementById("craftAddRecipeBtn"), craftExecuteQueueBtn: document.getElementById("craftExecuteQueueBtn"),
  craftClearQueueBtn: document.getElementById("craftClearQueueBtn"), craftQueueList: document.getElementById("craftQueueList"),
  craftAssistToggleBtn: document.getElementById("craftAssistToggleBtn"), craftAssistOverlay: document.getElementById("craftAssistOverlay"),
  craftAssistOverlayHandle: document.getElementById("craftAssistOverlayHandle"), craftAssistPanel: document.getElementById("craftAssistPanel"), craftAssistCloseBtn: document.getElementById("craftAssistCloseBtn"),
  craftAssistTargetWear: document.getElementById("craftAssistTargetWear"),
  craftAssistFilterModeRelative: document.getElementById("craftAssistFilterModeRelative"), craftAssistFilterModeAbsolute: document.getElementById("craftAssistFilterModeAbsolute"),
  craftAssistApplyBtn: document.getElementById("craftAssistApplyBtn"),
  craftAssistMainCount: document.getElementById("craftAssistMainCount"), craftAssistAuxCount: document.getElementById("craftAssistAuxCount"),
  craftAssistSelectBox: document.getElementById("craftAssistSelectBox"), craftAssistSelectText: document.getElementById("craftAssistSelectText"), craftAssistContent: document.getElementById("craftAssistContent"), craftAssistSplitBar: document.getElementById("craftAssistSplitBar"),
  craftAssistRoleSplit: document.getElementById("craftAssistRoleSplit"), craftAssistPicker: document.getElementById("craftAssistPicker"), craftAssistList: document.getElementById("craftAssistList"),
  craftAssistPresetPanel: document.getElementById("craftAssistPresetPanel"), craftAssistPresetSaveBtn: document.getElementById("craftAssistPresetSaveBtn"), craftAssistPresetList: document.getElementById("craftAssistPresetList"),
  craftAssistPresetModal: document.getElementById("craftAssistPresetModal"), craftAssistPresetModalInput: document.getElementById("craftAssistPresetModalInput"),
  craftAssistPresetModalClose: document.getElementById("craftAssistPresetModalClose"), craftAssistPresetModalSaveBtn: document.getElementById("craftAssistPresetModalSaveBtn"), craftAssistPresetModalCancelBtn: document.getElementById("craftAssistPresetModalCancelBtn"),
  craftLayout: document.getElementById("craftLayout"), craftSplitBar: document.getElementById("craftSplitBar"), craftRightPanel: document.getElementById("craftRightPanel")
};

let searchTimer = null;
let inventoryEventSource = null;
let inventoryEventUsername = "";
let remarkModalResolver = null;
let remarkModalAccount = "";
let craftAssistPresetModalResolver = null;
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
const CRAFT_ASSIST_PRESETS_KEY = "craft_assist_presets_v1";
const ERROR_TOAST_DURATION_MS = 2800;

async function api(path, options = {}) {
  const r = await fetch(path, {headers: {"Content-Type": "application/json"}, ...options});
  const d = await r.json();
  if (!r.ok || d.ok === false) {
    const err = new Error(d.message || `http ${r.status}`);
    err.status = r.status;
    err.data = d;
    throw err;
  }
  return d;
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

function cacheSnapshotForAccount(username, {rows = [], component = null, snapshotPath = "", fetchTime = "", connected = false} = {}) {
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
    if (!silentSummary) setSummary("当前账号未连接（暂无上次库存信息）");
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
      name: String(row && (row.alchemy_name || row.name) || `Component ${id}`),
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
  if (!Number.isFinite(value)) return 360;
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
  ui.craftRightPanel.classList.toggle("compact-actions", width > 0 && width < 390);
}

function clampCraftAssistPresetWidth(width) {
  const min = 220;
  const contentWidth = Number(ui.craftAssistContent && ui.craftAssistContent.clientWidth || 0);
  const effective = contentWidth > 0 ? Math.max(0, contentWidth - 8) : 0;
  const auto = effective > 0 ? Math.round(effective * 0.28) : 240;
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

function applyCraftAssistOverlayHeight() {
  if (!ui.craftAssistOverlay) return;
  state.craftAssistOverlayHeight = clampCraftAssistOverlayHeight(state.craftAssistOverlayHeight);
  ui.craftAssistOverlay.style.setProperty("--craft-assist-overlay-height", `${state.craftAssistOverlayHeight}px`);
  applyCraftAssistPresetWidth();
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
  applyCraftAssistOverlayHeight();
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
        craft_include_cooling: !!state.craftIncludeCooling,
        craft_show_seed: !!state.craftShowSeed,
        craft_show_cooling_time: !!state.craftShowCoolingTime,
        craft_assist_wear_offset_pct: normalizeCraftAssistWearOffsetPct(state.craftAssistWearOffsetPct, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT),
        craft_right_width: Number(state.craftRightPanelWidth) || 360,
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
    if (typeof prefs.craft_include_cooling === "boolean") state.craftIncludeCooling = prefs.craft_include_cooling;
    if (typeof prefs.craft_show_seed === "boolean") state.craftShowSeed = prefs.craft_show_seed;
    if (typeof prefs.craft_show_cooling_time === "boolean") state.craftShowCoolingTime = prefs.craft_show_cooling_time;
    if (Number.isFinite(Number(prefs.craft_assist_wear_offset_pct))) {
      state.craftAssistWearOffsetPct = normalizeCraftAssistWearOffsetPct(prefs.craft_assist_wear_offset_pct, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT);
    }
    if (Number.isFinite(Number(prefs.craft_right_width))) state.craftRightPanelWidth = Number(prefs.craft_right_width);
    if (Number.isFinite(Number(prefs.craft_assist_overlay_height))) {
      const savedOverlayHeight = Number(prefs.craft_assist_overlay_height);
      // 兼容旧默认值 320：迁移为自动高度（贴近底部），减少中间空白。
      state.craftAssistOverlayHeight = savedOverlayHeight === 320 ? 0 : savedOverlayHeight;
    }
    if (Number.isFinite(Number(prefs.craft_assist_preset_width))) state.craftAssistPresetWidth = Number(prefs.craft_assist_preset_width);
  } catch (_) {
    // ignore storage errors
  }
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

function closeCraftAssistPresetModal(value = null) {
  if (!ui.craftAssistPresetModal) return;
  ui.craftAssistPresetModal.classList.add("hidden");
  const resolver = craftAssistPresetModalResolver;
  craftAssistPresetModalResolver = null;
  if (typeof resolver === "function") {
    resolver(value);
  }
}

function openCraftAssistPresetModal(initialName = "") {
  const initValue = String(initialName || "").trim();
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

  stream.addEventListener("inventory_refresh_failed", (evt) => {
    const data = parseEventData(evt.data);
    const eventUsername = String(data.username || "").trim();
    if (!eventUsername || eventUsername !== state.currentAccountUsername) return;
    if (state.connectedUsername === eventUsername) state.connectedUsername = "";
    syncInventoryTop();
    const msg = String(data.message || "未知错误");
    setSummary(`自动刷新失败：${msg}`);
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
function pickAvatarUrlFromProfile(profile) {
  if (!profile || typeof profile !== "object") return "";
  return String(profile.avatar_url_full || profile.avatar_url_medium || profile.avatar_url_icon || "").trim();
}
function mergeAccountIdentity(username, {steamName = "", steamId = "", avatarUrl = ""} = {}) {
  const key = String(username || "").trim();
  if (!key) return false;
  const nextSteamName = String(steamName || "").trim();
  const nextSteamId = String(steamId || "").trim();
  const nextAvatarUrl = String(avatarUrl || "").trim();
  let changed = false;
  state.accounts = state.accounts.map((row) => {
    if (String(row && row.username || "").trim() !== key) return row;
    const currentSteamName = String(row && row.steam_name || "").trim();
    const currentSteamId = String(row && row.steam_id || "").trim();
    const currentAvatarUrl = String(row && row.avatar_url || "").trim();
    const mergedSteamName = nextSteamName || currentSteamName;
    const mergedSteamId = nextSteamId || currentSteamId;
    const mergedAvatarUrl = nextAvatarUrl || currentAvatarUrl;
    if (
      mergedSteamName === currentSteamName &&
      mergedSteamId === currentSteamId &&
      mergedAvatarUrl === currentAvatarUrl
    ) return row;
    changed = true;
    return {...row, steam_name: mergedSteamName, steam_id: mergedSteamId, avatar_url: mergedAvatarUrl};
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
      avatarUrl: pickAvatarUrlFromProfile(profile)
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
  if (steamName) return steamName;
  if (!remark || remark === username) return username;
  return remark;
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

function syncInventoryTop() {
  const applyTop = (fetchEl, statusEl, refreshBtn, disconnectBtn) => {
    if (!fetchEl || !statusEl || !refreshBtn) return;
    if (!state.currentAccountUsername) {
      fetchEl.textContent = "库存获取时间：-";
      statusEl.textContent = "未连接";
      setConnectionStatusTone(statusEl, false);
      statusEl.classList.remove("status-clickable");
      statusEl.title = "";
      refreshBtn.textContent = "连接并刷新库存信息";
      if (disconnectBtn) disconnectBtn.disabled = true;
      return;
    }
    fetchEl.textContent = `库存获取时间：${state.fetchTime || "-"}`;
    if (state.refreshPhaseText) statusEl.textContent = normalizeTopStatusText(state.refreshPhaseText, false);
    else if (isCurrentAccountConnected()) statusEl.textContent = "已连接";
    else statusEl.textContent = "未连接";
    const connected = isCurrentAccountConnected() || isConnectedPhaseText(state.refreshPhaseText);
    setConnectionStatusTone(statusEl, connected);
    const clickable = !state.refreshing && !connected;
    statusEl.classList.toggle("status-clickable", clickable);
    statusEl.title = clickable ? "点击连接并刷新库存" : "";
    refreshBtn.textContent = isCurrentAccountConnected() ? "刷新库存信息" : "连接并刷新库存信息";
    if (disconnectBtn) disconnectBtn.disabled = state.refreshing || !isCurrentAccountConnected();
  };

  if (!state.currentAccountUsername) {
    applyTop(ui.fetchTimeText, ui.statusText, ui.refreshBtn, ui.disconnectBtn);
    applyTop(ui.craftTopFetchTimeText, ui.craftTopStatusText, ui.craftRefreshBtn, ui.craftDisconnectBtn);
    return;
  }
  applyTop(ui.fetchTimeText, ui.statusText, ui.refreshBtn, ui.disconnectBtn);
  applyTop(ui.craftTopFetchTimeText, ui.craftTopStatusText, ui.craftRefreshBtn, ui.craftDisconnectBtn);
}

function setAccountForm({username = "", password = "", totp = "", remark = ""} = {}) {
  ui.accountUsername.value = username;
  ui.accountPassword.value = password;
  ui.accountTotp.value = normalizeTotpCode(totp);
  ui.accountRemark.value = remark;
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
  setAccountForm({username: "", password: "", totp: "", remark: ""});
  ensureAccountFormEditable({focusUsername});
}

function ensureAccountFormEditable({focusUsername = false} = {}) {
  const fields = [ui.accountUsername, ui.accountPassword, ui.accountTotp, ui.accountRemark];
  for (const field of fields) {
    if (!field) continue;
    field.disabled = false;
    field.readOnly = false;
  }
  if (focusUsername && ui.accountUsername && typeof ui.accountUsername.focus === "function") {
    ui.accountUsername.focus();
  }
}

function syncAccountFormBySelection() {
  // 登录表单始终保持空白，避免自动回填账号密码。
  setAccountForm({username: "", password: "", totp: "", remark: ""});
}

function showPage(pageId) {
  state.currentPage = pageId;
  for (const [id, btn] of [["accountPage", ui.navAccount], ["inventoryPage", ui.navInventory], ["craftPage", ui.navCraft]]) {
    const active = id === pageId;
    document.getElementById(id).classList.toggle("hidden", !active);
    btn.classList.toggle("active", active);
  }
  if (pageId === "accountPage") renderSavedAccounts();
  if (pageId === "inventoryPage") render();
  if (pageId === "craftPage") {
    applyCraftLayoutWidth();
    renderCraftPage();
  }
}

function syncInventoryAccountSelect() {
  const selects = [ui.accountSelect, ui.craftAccountSelect].filter(Boolean);
  for (const selectEl of selects) {
    selectEl.replaceChildren();
    for (const row of state.accounts) {
      const o = document.createElement("option");
      o.value = row.username;
      o.textContent = optionAccountLabel(row);
      selectEl.append(o);
    }
    if (state.accountSelectedUsername) selectEl.value = state.accountSelectedUsername;
    else if (state.activeAccount) selectEl.value = state.activeAccount;
  }
  const hasAccount = state.accounts.length > 0;
  ui.refreshBtn.disabled = !hasAccount || state.refreshing;
  if (ui.craftRefreshBtn) ui.craftRefreshBtn.disabled = !hasAccount || state.refreshing;
}
function renderSavedAccounts() {
  ui.savedAccountsWrap.replaceChildren();
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
    const steamName = String(row.steam_name || "").trim();
    const displayName = steamName || accountName || "-";
    const avatarUrl = String(row.avatar_url || "").trim();
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
    const titleRow = document.createElement("div");
    titleRow.className = "account-card-title-row";
    const title = document.createElement("div");
    title.className = "account-card-title";
    title.textContent = displayName;
    const stateBadge = document.createElement("span");
    stateBadge.className = `account-card-state status ${connected ? "status-connected" : "status-disconnected"}`;
    stateBadge.textContent = connected ? "已连接" : "未连接";
    if (!connected && !state.refreshing) {
      stateBadge.classList.add("status-clickable");
      stateBadge.title = "点击连接并刷新库存";
      stateBadge.onclick = async (e) => {
        e.stopPropagation();
        try {
          await switchAccountView(row.username);
          await doRefresh({usernameOverride: row.username, force: true, silentRateLimit: true, silentInfo: true});
        } catch (err) {
          setAccountStatus(`连接失败：${err.message}`, true);
        }
      };
    }
    const actions = document.createElement("div");
    actions.className = "account-card-actions";

    const connectBtn = document.createElement("button");
    connectBtn.textContent = "设为当前";
    connectBtn.disabled = state.refreshing;
    connectBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        await switchAccountView(row.username);
      } catch (err) {
        setAccountStatus(`切换失败：${err.message}`, true);
      }
    };

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

    actions.append(connectBtn, remarkBtn, delBtn);
    titleRow.append(title, stateBadge);
    const sub = document.createElement("div");
    sub.className = "account-card-sub";
    sub.textContent = `账号：${accountName || "-"}`;
    card.onclick = () => {
      state.accountSelectedUsername = row.username;
      syncInventoryAccountSelect();
      syncAccountFormBySelection();
      setAccountStatus(`已选中账号：${displayAccountName(row) || row.username}`);
      renderSavedAccounts();
    };
    info.append(titleRow, sub, actions);
    main.append(avatar, info);
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

function setRows(rows, component, snapshotPath = "", options = {}) {
  closeTargetComponentDrawer();
  state.rows = Array.isArray(rows) ? rows : [];
  state.component = component || {summary_map: {}, item_map: {}};
  state.snapshotPath = snapshotPath || "";
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
  setRows(rows, component, snapshotPath);
  cacheSnapshotForAccount(key, {
    rows,
    component,
    snapshotPath,
    fetchTime,
    connected
  });
  clearSnapshotDirty();
  syncInventoryTop();
  if (rows.length) {
    if (!silentSummary) setSummary(`已显示该账号上次库存，共 ${rows.length} 条`);
  } else {
    state.emptyHint = "当前账号未连接";
    if (!silentSummary) setSummary("当前账号未连接（暂无上次库存信息）");
  }
  return true;
}

async function switchAccountView(username, {silentSnapshotSummary = false} = {}) {
  const key = String(username || "").trim();
  if (!key) return;
  clearSnapshotDirty();
  state.lastDirtyFallbackTs = 0;
  state.craftSelectedItemIds.clear();
  state.craftBusy = false;
  state.craftStatusText = "";
  state.craftRecipeQueue = [];
  state.craftActiveRecipeId = "";
  state.craftSettingsOpen = false;
  state.craftAssistOpen = false;
  state.craftAssistPickerOpen = false;
  state.craftAssistPickerTargetMaterialId = "";
  state.craftAssistRoleChooserOpen = false;
  state.craftAssistPickRole = "main";
  state.craftAssistUseAbsoluteWear = false;
  state.craftAssistTargetWear = null;
  state.craftAssistMainCount = 5;
  state.craftAssistAuxCount = 5;
  state.craftAssistMaterials = [];
  state.craftAssistPresetApplyCountMap = {};
  state.craftAssistPresetEditingId = "";
  state.craftAssistPresetEditingName = "";
  state.craftAssistPresetEditingBackup = null;
  state.craftAssistPresetEditingInitialSnapshot = null;
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
  startInventoryEventStream(key);
  void ensureAccountProfile(key);
  await loadComponentTaskQueue();
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
    await doRefresh({usernameOverride: key, force: true, silentRateLimit: true});
    const info = accountByUsername(key);
    setAccountStatus(`已设为当前账号：${info ? displayAccountName(info) : key}`);
  } catch (err) {
    setAccountStatus(`切换账号失败：${err.message}`, true);
  }
}

async function deleteAccount(row) {
  if (state.refreshing) { setAccountStatus("库存刷新中，暂时无法删除账号", true); return; }
  const ok = window.confirm(`确认删除账号“${row.remark || row.username}（${row.username}）”？\n该操作会移除本地保存的密码与账号记录。`);
  if (!ok) return;
  try {
    await api("/api/accounts/delete", {method: "POST", body: JSON.stringify({username: row.username})});
    if (state.connectedUsername === row.username) state.connectedUsername = "";
    if (state.snapshotCacheByAccount instanceof Map) {
      state.snapshotCacheByAccount.delete(String(row.username || "").trim());
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
  const username = String(ui.accountUsername.value || "").trim();
  const password = String(ui.accountPassword.value || "").trim();
  const totp = normalizeAccountTotpInput();
  const remark = String(ui.accountRemark.value || "").trim();
  if (!username) { setAccountStatus("请输入 Steam 账号", true); return; }
  if (!password) { setAccountStatus("请输入密码", true); return; }
  if (!totp) { setAccountStatus("请输入令牌码", true); return; }

  try {
    ui.loginSaveBtn.disabled = true;
    setAccountStatus("正在登录并获取 token，请稍候...");
    await api("/api/accounts/login-save", {method: "POST", body: JSON.stringify({username, password, totp, remark})});
    await loadAccounts({preferUsername: username});
    await switchAccountView(username, {silentSnapshotSummary: true});
    await doRefresh({usernameOverride: username, force: true, silentRateLimit: true, silentInfo: true});
    clearAccountInputs({focusUsername: state.currentPage === "accountPage"});
    setAccountStatus("准备就绪");
  } catch (err) {
    setAccountStatus(formatLoginSaveError(err), true);
  } finally {
    ui.loginSaveBtn.disabled = false;
  }
}

function clearAccountForm() {
  state.accountSelectedUsername = "";
  clearAccountInputs();
  setAccountStatus("输入已清空");
  renderSavedAccounts();
}

async function connectByStatusBadge({preferCraft = false} = {}) {
  if (state.refreshing) return;
  const username = String(
    (preferCraft && ui.craftAccountSelect ? ui.craftAccountSelect.value : "") ||
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
  await doRefresh({usernameOverride: username, force: true, silentRateLimit: true, silentInfo: true});
}

function setNoAccountState({silentSummary = false} = {}) {
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
  state.craftSelectedItemIds.clear();
  state.craftBusy = false;
  state.craftStatusText = "";
  state.craftRecipeQueue = [];
  state.craftActiveRecipeId = "";
  state.craftSettingsOpen = false;
  state.craftAssistOpen = false;
  state.craftAssistPickerOpen = false;
  state.craftAssistPickerTargetMaterialId = "";
  state.craftAssistRoleChooserOpen = false;
  state.craftAssistPickRole = "main";
  state.craftAssistUseAbsoluteWear = false;
  state.craftAssistTargetWear = null;
  state.craftAssistMainCount = 5;
  state.craftAssistAuxCount = 5;
  state.craftAssistMaterials = [];
  state.craftAssistPresetApplyCountMap = {};
  state.craftAssistPresetEditingId = "";
  state.craftAssistPresetEditingName = "";
  state.craftAssistPresetEditingBackup = null;
  state.craftAssistPresetEditingInitialSnapshot = null;
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
function rarityName(row) { const e = String(row.alchemy_rarity || "").trim(); if (e) return e; const r = String(row.rarity_name || "").trim(); if (r) return r; const id = Number(row.rarity || 0); return RARITY_MAP[id] || `Unknown(${id})`; }
const collectionName = (row) => String(row.collection || "").trim();
const itemDisplayName = (row) => String(row.alchemy_name || "").trim() || String(row.name || "").trim();
const itemSearchText = (row) => [row.name, row.market_hash_name, row.alchemy_name, row.collection, row.collection_en].map((x) => String(x || "").toLowerCase()).join(" ").trim();
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
function parseOptionalWear01(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.max(0, Math.min(1, n));
  return truncateNumber(clamped, WEAR_INPUT_DECIMALS);
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
function isInventoryRowSelectable(row) { return !isComponentRow(row); }
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
function rowsForComponentScope() {
  const selected = selectedComponentId();
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
  if (row.is_craftable !== true) return false;
  return true;
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
function createEmptyCraftRecipeEntry({activate = true} = {}) {
  pruneCompletedCraftRecipeEntries();
  const entry = {
    id: `craftq_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    item_ids: [],
    recipe: 0,
    recipe_text: "",
    status: "pending",
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
  return (Array.isArray(state.craftRecipeQueue) ? state.craftRecipeQueue : []).find((entry) => String(entry && entry.id || "").trim() === key) || null;
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
  const rows = getMainInventoryCraftableRows();
  const validIds = new Set(rows.map((row) => rowAssetId(row)).filter(Boolean));
  const claimed = new Set();
  for (const entry of getCraftQueuePendingEntries()) {
    const nextIds = [];
    for (const id of normalizeCraftRecipeItemIds(entry.item_ids)) {
      if (!validIds.has(id)) continue;
      if (claimed.has(id)) continue;
      claimed.add(id);
      nextIds.push(id);
    }
    entry.item_ids = nextIds;
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
  return getCraftQueuePendingEntries().filter((entry) => normalizeCraftRecipeItemIds(entry && entry.item_ids).length === 10);
}
function buildRowsByAssetId(rows) {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = rowAssetId(row);
    if (id && !out.has(id)) out.set(id, row);
  }
  return out;
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
  const text = value == null ? "-" : numberTextTrunc(value, WEAR_INPUT_DECIMALS);
  return prefix ? `绝对磨损 ${text}` : text;
}
function relativeWearLabel(row, {prefix = true} = {}) {
  const value = getRelativeWearValue(row);
  const text = value == null ? "-" : numberTextTrunc(value, WEAR_INPUT_DECIMALS);
  return prefix ? `相对磨损 ${text}` : text;
}
function averageRelativeWearText(rows) {
  const values = (Array.isArray(rows) ? rows : [])
    .map((row) => getRelativeWearValue(row))
    .filter((value) => value != null && Number.isFinite(value));
  if (!values.length) return "-";
  const total = values.reduce((sum, value) => sum + value, 0);
  return numberTextTrunc(total / values.length, WEAR_INPUT_DECIMALS);
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
    // 执行完成后释放占位，允许继续选择新配方。
    entry.item_ids = [];
    entry.updated_at = Date.now();
  }
  ensureActiveCraftRecipe({createIfMissing: false});
  syncCraftSelectedIdsFromActiveRecipe();
}
function formatCraftSlotWear(row) {
  return relativeWearLabel(row, {prefix: false});
}
function makeCraftSlotNode({row = null, rawId = "", onRemove = null}) {
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
  const wear = document.createElement("div");
  wear.className = "craft-slot-wear";
  wear.textContent = `相对磨损 ${wearText}`;
  slot.append(wear);
  slot.title = `相对磨损：${wearText}`;
  if (typeof onRemove === "function") {
    const removeRight = document.createElement("button");
    removeRight.type = "button";
    removeRight.className = "craft-slot-remove right";
    removeRight.title = "移除该槽位物品";
    removeRight.setAttribute("aria-label", "移除该槽位物品");
    removeRight.textContent = "×";
    removeRight.onclick = (evt) => {
      evt.stopPropagation();
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
  removable = false,
  onRemove = null,
  onRemoveItem = null,
  active = false,
  selectable = false,
  onActivate = null,
  extraClass = ""
}) {
  const wrap = document.createElement("div");
  wrap.className = `craft-queue-group${active ? " active" : ""}${selectable ? " selectable" : ""}${extraClass ? ` ${extraClass}` : ""}`;
  if (selectable && typeof onActivate === "function") {
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "button");
    wrap.setAttribute("aria-label", "切换当前编辑配方");
    wrap.onclick = () => {
      onActivate();
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
  if (removable) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "移除";
    removeBtn.disabled = state.craftBusy;
    removeBtn.onclick = (evt) => {
      evt.stopPropagation();
      if (typeof onRemove === "function") onRemove();
    };
    head.append(removeBtn);
  }
  wrap.append(head);

  const grid = document.createElement("div");
  grid.className = "craft-slot-grid";
  const ids = Array.isArray(itemIds) ? itemIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
  for (let i = 0; i < 10; i += 1) {
    const id = ids[i] || "";
    const row = id ? rowsById.get(id) || null : null;
    grid.append(makeCraftSlotNode({row, rawId: id, onRemove: id && typeof onRemoveItem === "function" ? onRemoveItem : null}));
  }
  wrap.append(grid);
  return wrap;
}
function getCraftCandidates() {
  const allRows = getMainInventoryCraftableRows();
  if (state.craftIncludeCooling) {
    return allRows;
  }
  return allRows.filter((row) => coolingUnlockTs(row) <= 0);
}
function getCraftCoolingHintText(rows) {
  const coolingRows = getCraftCoolingRows(rows);
  if (!coolingRows.length) return "冷却中可选：无";
  return `冷却中可选：${coolingRows.length}件`;
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
  const rowMap = buildRowsByAssetId(getMainInventoryCraftableRows());
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
  const rarityLabel = RARITY_MAP[rarity] || `R${rarity}`;
  const nextLabel = RARITY_MAP[rarity + 1] || `R${rarity + 1}`;
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
  const rarity = Math.trunc(Number(value) || 0);
  return RARITY_MAP[rarity] || `R${rarity || 0}`;
}
function toggleCraftItemSelection(itemId) {
  const key = String(itemId || "").trim();
  if (!key) return;
  const active = ensureActiveCraftRecipe({createIfMissing: true});
  if (!active) return;
  const activeId = String(active.id || "").trim();
  const currentIds = normalizeCraftRecipeItemIds(active.item_ids);
  const rowMap = buildRowsByAssetId(getCraftCandidates());
  const nextRow = rowMap.get(key) || null;
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
    const currentRows = currentIds.map((id) => rowMap.get(id)).filter(Boolean);
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
  active.item_ids = [...currentIds, key];
  syncCraftSelectedIdsFromActiveRecipe();
  state.craftStatusText = "";
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
    ui.craftSelectionList.innerHTML = "<div class=\"empty\">主库存中暂无可炼金物品</div>";
    return;
  }
  const showSeed = !!state.craftShowSeed;
  const showCooling = !!state.craftIncludeCooling;
  const groupedRows = buildCraftGroupRows(candidates);
  const queuedIds = getQueuedCraftItemIds();
  const table = document.createElement("table");
  table.className = "group-table";
  const quantityTitle = showCooling ? "数量(可用/冷却中)" : "数量";
  const headers = [
    "<th><div class=\"th-sort-wrap\"><span>稀有度</span><span class=\"sort-stack\"><button type=\"button\" class=\"arrow-tri up col-sort-btn\" data-sort-key=\"rarity\" data-sort-dir=\"asc\" title=\"稀有度由低到高\" aria-label=\"稀有度由低到高\"></button><button type=\"button\" class=\"arrow-tri down col-sort-btn\" data-sort-key=\"rarity\" data-sort-dir=\"desc\" title=\"稀有度由高到低\" aria-label=\"稀有度由高到低\"></button></span></div></th>",
    "<th>名称</th>",
    "<th><div class=\"th-sort-wrap\"><span>收藏品</span><span class=\"sort-stack\"><button type=\"button\" class=\"arrow-tri up col-sort-btn\" data-sort-key=\"collection\" data-sort-dir=\"asc\" title=\"收藏品按字符升序\" aria-label=\"收藏品按字符升序\"></button><button type=\"button\" class=\"arrow-tri down col-sort-btn\" data-sort-key=\"collection\" data-sort-dir=\"desc\" title=\"收藏品按字符降序\" aria-label=\"收藏品按字符降序\"></button></span></div></th>",
    `<th><div class="th-sort-wrap"><span>${quantityTitle}</span><span class="sort-stack"><button type="button" class="arrow-tri up col-sort-btn" data-sort-key="quantity" data-sort-dir="asc" title="数量由低到高" aria-label="数量由低到高"></button><button type="button" class="arrow-tri down col-sort-btn" data-sort-key="quantity" data-sort-dir="desc" title="数量由高到低" aria-label="数量由高到低"></button></span></div></th>`
  ];
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
      `<td>${row.name}</td>`,
      `<td>${row.collection || ""}</td>`,
      `<td>${showCooling ? `${row.available_count}/${row.cooling_count}` : row.available_count}</td>`
    ];
    if (showSeed) parentCells.push("<td></td>");
    parentCells.push(`<td>${row.wear_range_text || ""}</td>`);
    if (showCooling) parentCells.push(`<td>${parentCooldownText}</td>`);
    parent.innerHTML = parentCells.join("");
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
        `<td>${relativeWearLabel(item)}</td>`,
        "<td></td>",
        "<td></td>"
      ];
      if (showSeed) childCells.push(`<td>${Number(item.paint_seed || 0)}</td>`);
      childCells.push(`<td>${itemHasWear(item) ? numberTextTrunc(item.float_value, WEAR_INPUT_DECIMALS) : ""}</td>`);
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
}
function setCraftStatus(text, isError = false) {
  state.craftStatusText = String(text || "").trim();
  if (isError && state.craftStatusText) showErrorToast(state.craftStatusText);
  if (!ui.craftStatusText) return;
  ui.craftStatusText.textContent = state.craftStatusText || "点击左侧物品可填充当前高亮槽位";
  ui.craftStatusText.classList.toggle("error", !!isError);
}
function syncCraftSettingsControls(allCraftRows = null) {
  const includeCooling = !!state.craftIncludeCooling;
  const showSeed = !!state.craftShowSeed;
  const showCoolingTime = !!state.craftShowCoolingTime;
  const wearOffsetPct = normalizeCraftAssistWearOffsetPct(state.craftAssistWearOffsetPct, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT);
  state.craftAssistWearOffsetPct = wearOffsetPct;
  if (ui.craftIncludeCooling) ui.craftIncludeCooling.checked = includeCooling;
  if (ui.componentCraftIncludeCooling) ui.componentCraftIncludeCooling.checked = includeCooling;
  if (ui.craftShowSeed) ui.craftShowSeed.checked = showSeed;
  if (ui.componentCraftShowSeed) ui.componentCraftShowSeed.checked = showSeed;
  if (ui.craftShowCoolingTime) ui.craftShowCoolingTime.checked = showCoolingTime;
  if (ui.componentCraftShowCoolingTime) ui.componentCraftShowCoolingTime.checked = showCoolingTime;
  if (ui.craftAssistWearOffsetPct && document.activeElement !== ui.craftAssistWearOffsetPct) {
    ui.craftAssistWearOffsetPct.value = craftAssistWearOffsetPctText(wearOffsetPct);
  }
  if (ui.componentCraftAssistWearOffsetPct && document.activeElement !== ui.componentCraftAssistWearOffsetPct) {
    ui.componentCraftAssistWearOffsetPct.value = craftAssistWearOffsetPctText(wearOffsetPct);
  }
  const rows = Array.isArray(allCraftRows) ? allCraftRows : getMainInventoryCraftableRows();
  const hintText = getCraftCoolingHintText(rows);
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
  return normalizeCraftAssistEntryCount(value, fallback);
}
function normalizeCraftAssistWearOffsetPct(value, fallback = DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT) {
  const fallbackNum = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNum)
    ? Math.max(0, Math.min(100, fallbackNum))
    : DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT;
  const n = Number(value);
  if (!Number.isFinite(n)) return safeFallback;
  const clamped = Math.max(0, Math.min(100, n));
  return Math.round(clamped * 100) / 100;
}
function craftAssistWearOffsetPctText(value) {
  const n = normalizeCraftAssistWearOffsetPct(value, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT);
  return Number.isInteger(n) ? String(n) : String(n.toFixed(2)).replace(/\.?0+$/, "");
}
function getCraftAssistWearOffsetByTarget(targetValue) {
  const pct = normalizeCraftAssistWearOffsetPct(state.craftAssistWearOffsetPct, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT);
  const target = Number(targetValue);
  if (!Number.isFinite(target) || target <= 0 || pct <= 0) return 0;
  return target * (pct / 100);
}
function getCraftAssistOffsetSettingHintText() {
  const pctText = craftAssistWearOffsetPctText(state.craftAssistWearOffsetPct);
  return `当前产物偏移阈值 ${pctText}%（可在炼金设置中调整）`;
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
function craftAssistDirectionText(direction) {
  return String(direction || "").trim() === "lt" ? "小于相对磨损" : "大于相对磨损";
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
  return out;
}
function syncCraftAssistAutoDirectionLimit() {
  // 主料数量=10时自动勾选；下调后自动取消。
  // 辅料保持用户手动选择。
  const materials = Array.isArray(state.craftAssistMaterials) ? state.craftAssistMaterials : [];
  if (!materials.length) return;
  state.craftAssistMaterials = materials
    .map((entry) => {
      if (!entry) return null;
      const role = normalizeCraftAssistRole(entry.role);
      const count = normalizeCraftAssistEntryCount(entry.count, 1);
      const autoDisableLimit = role === "main" && count === 10;
      return {
        ...entry,
        disable_direction_limit: role === "main"
          ? autoDisableLimit
          : !!entry.disable_direction_limit
      };
    })
    .filter(Boolean);
}
function refreshCraftAssistMaterialRanges({rows = null, useRelative = getCraftAssistFilterUseRelative()} = {}) {
  state.craftAssistMaterials = (Array.isArray(state.craftAssistMaterials) ? state.craftAssistMaterials : [])
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
    .filter(Boolean);
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
  const useRelativeFilter = filterMode !== "absolute";
  const targetWear = clampWear01(source.target_wear, 0.5);
  const materials = normalizeCraftAssistMaterialList(source.materials, {
    targetWear,
    idPrefix: "preset_material",
    useRelative: useRelativeFilter
  })
    .map((entry) => {
      const names = craftAssistMaterialNames(entry);
      return {
        names,
        name: names[0] || String(entry && entry.name || "").trim(),
        role: entry.role,
        count: entry.count,
        direction: entry.direction,
        disable_direction_limit: !!entry.disable_direction_limit,
        wear_min: entry.wear_min,
        wear_max: entry.wear_max,
        custom_range: !!entry.custom_range
      };
    })
    .filter((entry) => entry.count > 0);
  if (!materials.length) return null;
  const createdAt = Math.max(0, Number(source.created_at || 0) || 0);
  const updatedAt = Math.max(createdAt, Math.max(0, Number(source.updated_at || 0) || 0));
  return {
    id: String(source.id || makeCraftAssistUid("preset")).trim() || makeCraftAssistUid("preset"),
    name,
    target_wear: targetWear,
    wear_filter_mode: filterMode,
    use_absolute_wear: filterMode === "absolute",
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
    const data = await api("/api/ui-state/craft-assist-presets");
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
  const filterMode = getCraftAssistFilterMode();
  const targetWear = parseOptionalWear01(state.craftAssistTargetWear);
  if (targetWear == null) return null;
  const materials = normalizeCraftAssistMaterialList(state.craftAssistMaterials, {
    targetWear,
    idPrefix: "preset_material",
    useRelative: filterMode !== "absolute"
  })
    .filter((entry) => entry.count > 0)
    .map((entry) => ({
      names: craftAssistMaterialNames(entry),
      name: entry.name,
      role: entry.role,
      count: entry.count,
      direction: entry.direction,
      disable_direction_limit: !!entry.disable_direction_limit,
      wear_min: entry.wear_min,
      wear_max: entry.wear_max,
      custom_range: !!entry.custom_range
    }));
  if (!materials.length) return null;
  return sanitizeCraftAssistPresetPayload({
    id: makeCraftAssistUid("preset"),
    name: presetName,
    target_wear: targetWear,
    wear_filter_mode: filterMode,
    use_absolute_wear: filterMode === "absolute",
    materials,
    created_at: Date.now(),
    updated_at: Date.now()
  });
}
function buildCraftAssistParentGroups() {
  const groups = buildCraftGroupRows(getCraftCandidates());
  return groups
    .map((group) => ({
      key: String(group && group.name || "").trim(),
      name: String(group && group.name || "").trim(),
      count: Array.isArray(group && group.items) ? group.items.length : 0,
      rarity: String(group && group.parent_rarity || "").trim(),
      collection: String(group && group.collection || "").trim()
    }))
    .filter((entry) => entry.key)
    .sort((a, b) => a.name.localeCompare(b.name));
}
function createCraftAssistMaterial(name, role = "main") {
  const key = String(name || "").trim();
  if (!key) return null;
  return normalizeCraftAssistMaterialEntry({
    names: [key],
    name: key,
    role: normalizeCraftAssistRole(role),
    count: 1,
    direction: "",
    disable_direction_limit: false,
    custom_range: false
  }, {targetWear: state.craftAssistTargetWear, idPrefix: "assist", useRelative: getCraftAssistFilterUseRelative()});
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
  renderCraftAssistPanel();
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
  state.craftAssistMaterials = state.craftAssistMaterials.map((entry) => {
    if (String(entry && entry.id || "").trim() !== key) return entry;
    const next = updater(entry);
    return next && typeof next === "object" ? next : entry;
  });
}
function addCraftAssistMaterialByName(name, {targetMaterialId = ""} = {}) {
  const key = String(name || "").trim();
  if (!key) return;
  const targetId = String(targetMaterialId || "").trim();
  const materials = Array.isArray(state.craftAssistMaterials) ? state.craftAssistMaterials : [];
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
    updateCraftAssistMaterial(targetId, (entry) => {
      const nextNames = [...craftAssistMaterialNames(entry), key];
      return {
        ...entry,
        names: nextNames,
        name: nextNames[0]
      };
    });
    refreshCraftAssistMaterialRanges();
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
    setCraftStatus(`单配方需同一稀有度：当前为 ${currentRarity}，不能添加 ${nextRarity}`, true);
    return;
  }
  if (existingIndex >= 0) {
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
  const next = createCraftAssistMaterial(key, state.craftAssistPickRole);
  if (!next) return;
  const remain = Math.max(0, mode - totalCount);
  next.count = Math.max(1, Math.min(remain, normalizeCraftAssistEntryCount(next.count, 1)));
  state.craftAssistMaterials = [...materials, next];
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
  const currentNames = craftAssistMaterialNames(target);
  if (!currentNames.length) {
    removeCraftAssistMaterial(itemId);
    return;
  }
  const nextNames = currentNames.filter((entryName) => entryName !== name);
  if (nextNames.length === currentNames.length) return;
  if (!nextNames.length) {
    updateCraftAssistMaterial(itemId, (entry) => ({
      ...entry,
      names: [],
      name: ""
    }));
    syncCraftAssistAutoDirectionLimit();
    renderCraftAssistPanel();
    return;
  }
  updateCraftAssistMaterial(itemId, (entry) => ({
    ...entry,
    names: nextNames,
    name: nextNames[0]
  }));
  refreshCraftAssistMaterialRanges();
  renderCraftAssistPanel();
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
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "craft-assist-picker-item";
    const used = selected.has(group.name);
    const inTarget = selectedInTarget.has(group.name);
    const usedByOther = used && !inTarget;
    const groupRarity = String(group && group.rarity || "").trim();
    const blockedByRarity = !inTarget && !usedByOther && lockedRarity && groupRarity && groupRarity !== lockedRarity;
    const blockedByLimit = !targetMaterial && !used && limitReached;
    btn.disabled = inTarget || usedByOther || blockedByLimit || blockedByRarity;
    let blockedTag = "";
    if (inTarget) blockedTag = " 已在本项";
    else if (usedByOther) blockedTag = " 已在其他项";
    else if (blockedByLimit) blockedTag = ` 已满${mode}`;
    else if (blockedByRarity) blockedTag = ` 稀有度需 ${lockedRarity}`;
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
function seedCraftAssistDecimalInput(input) {
  if (!input) return;
  if (String(input.value || "").trim()) return;
  input.value = "0.";
  input.dataset.seeded = "1";
  requestAnimationFrame(() => {
    try {
      input.setSelectionRange(2, 2);
    } catch (_) {
      // ignore
    }
  });
}
function commitCraftAssistTargetWearInput(input) {
  if (!input) return null;
  const raw = String(input.value || "").trim();
  if (input.dataset.seeded === "1" && raw === "0.") {
    input.value = "";
    delete input.dataset.seeded;
    return null;
  }
  delete input.dataset.seeded;
  const parsed = parseOptionalWear01(raw);
  if (parsed == null) {
    if (raw) input.value = "";
    return null;
  }
  input.value = wearText6(parsed);
  return parsed;
}
function renderCraftAssistList() {
  if (!ui.craftAssistList) return;
  syncCraftAssistAutoDirectionLimit();
  ui.craftAssistList.replaceChildren();
  const materials = Array.isArray(state.craftAssistMaterials) ? state.craftAssistMaterials : [];
  if (!materials.length) {
    const empty = document.createElement("div");
    empty.className = "craft-assist-list-empty";
    empty.textContent = "悬停上方“尚未选择父类材料”行后，点击主料/辅料开始添加";
    ui.craftAssistList.append(empty);
    return;
  }
  const filterUseRelative = getCraftAssistFilterUseRelative();
  const wearLabel = filterUseRelative ? "相对磨损范围" : "绝对磨损范围";
  const minText = "Minwear";
  const maxText = "Maxwear";
  for (const material of materials) {
    const materialId = String(material && material.id || "").trim();
    const selectedNames = craftAssistMaterialNames(material);
    const resolvedRange = resolveCraftAssistMaterialEffectiveRange(material, {
      useRelative: filterUseRelative
    });
    const constraintMin = Number(resolvedRange.constraint_min);
    const constraintMax = Number(resolvedRange.constraint_max);
    const customRange = !!(material && material.custom_range);
    const role = normalizeCraftAssistRole(material && material.role);
    const roleText = role === "main" ? "主料" : "辅料";
    const disableLimit = !!(material && material.disable_direction_limit);
    const item = document.createElement("div");
    item.className = "craft-assist-item";

    const head = document.createElement("div");
    head.className = "craft-assist-item-head";
    const title = document.createElement("div");
    title.className = "craft-assist-item-title";
    title.textContent = `条件设置（已选${selectedNames.length}）`;
    const badge = document.createElement("span");
    badge.className = `craft-assist-role-tag ${role}`;
    badge.textContent = roleText;
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
    actions.append(badge, addNameBtn, removeBtn);
    head.append(title, actions);

    const configRow = document.createElement("div");
    configRow.className = "craft-assist-item-config";
    const qtyLabel = document.createElement("label");
    qtyLabel.className = "craft-assist-field qty";
    const qtyText = document.createElement("span");
    qtyText.textContent = "数量";
    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.min = "1";
    qtyInput.max = "10";
    qtyInput.step = "1";
    const qtyFallback = 1;
    qtyInput.value = String(normalizeCraftAssistEntryCount(material && material.count, qtyFallback));
    qtyInput.onchange = () => {
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
        return;
      }
      const requested = normalizeCraftAssistEntryCount(qtyInput.value, material && material.count);
      const nextCount = Math.max(1, Math.min(requested, maxAllowed));
      if (requested > maxAllowed) {
        setCraftStatus(`材料数量上限 ${mode}，该项最多可填 ${maxAllowed}`, true);
      }
      updateCraftAssistMaterial(materialId, (entry) => ({...entry, count: nextCount}));
      syncCraftAssistAutoDirectionLimit();
      renderCraftAssistPanel();
    };
    qtyLabel.append(qtyText, qtyInput);
    configRow.append(qtyLabel);

    const rangeLabel = document.createElement("label");
    rangeLabel.className = "craft-assist-field range";
    const rangeText = document.createElement("span");
    rangeText.textContent = wearLabel;
    const rangeWrap = document.createElement("div");
    rangeWrap.className = "craft-assist-range-wrap";
    const minLabel = document.createElement("span");
    minLabel.className = "craft-assist-range-label";
    minLabel.textContent = minText;
    const minInput = document.createElement("input");
    minInput.type = "text";
    minInput.inputMode = "decimal";
    minInput.placeholder = wearText2(constraintMin);
    minInput.value = customRange ? wearText2(resolvedRange.wear_min) : "";
    minInput.setAttribute("aria-label", `${minText} 输入`);
    const dash = document.createElement("span");
    dash.textContent = "-";
    const maxLabel = document.createElement("span");
    maxLabel.className = "craft-assist-range-label";
    maxLabel.textContent = maxText;
    const maxInput = document.createElement("input");
    maxInput.type = "text";
    maxInput.inputMode = "decimal";
    maxInput.placeholder = wearText2(constraintMax);
    maxInput.value = customRange ? wearText2(resolvedRange.wear_max) : "";
    maxInput.setAttribute("aria-label", `${maxText} 输入`);
    const commitRange = () => {
      if (minInput.dataset.seeded === "1" && String(minInput.value || "").trim() === "0.") {
        minInput.value = "";
      }
      if (maxInput.dataset.seeded === "1" && String(maxInput.value || "").trim() === "0.") {
        maxInput.value = "";
      }
      delete minInput.dataset.seeded;
      delete maxInput.dataset.seeded;

      const minRaw = parseCraftAssistRangeInputValue(minInput.value);
      const maxRaw = parseCraftAssistRangeInputValue(maxInput.value);
      const minBlank = String(minInput.value || "").trim() === "";
      const maxBlank = String(maxInput.value || "").trim() === "";
      if (minBlank && maxBlank) {
        updateCraftAssistMaterial(materialId, (entry) => ({
          ...entry,
          wear_min: constraintMin,
          wear_max: constraintMax,
          custom_range: false
        }));
        renderCraftAssistPanel();
        return;
      }

      let nextMin = minBlank
        ? constraintMin
        : clampWearToRange(minRaw, constraintMin, constraintMax, constraintMin);
      let nextMax = maxBlank
        ? constraintMax
        : clampWearToRange(maxRaw, constraintMin, constraintMax, constraintMax);
      if (nextMax < nextMin) {
        if (!minBlank && maxBlank) nextMax = nextMin;
        else if (minBlank && !maxBlank) nextMin = nextMax;
        else nextMax = nextMin;
      }
      updateCraftAssistMaterial(materialId, (entry) => ({
        ...entry,
        wear_min: nextMin,
        wear_max: nextMax,
        custom_range: true
      }));
      renderCraftAssistPanel();
    };
    minInput.onfocus = () => seedCraftAssistDecimalInput(minInput);
    maxInput.onfocus = () => seedCraftAssistDecimalInput(maxInput);
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
    rangeWrap.append(minLabel, minInput, dash, maxLabel, maxInput);
    rangeLabel.append(rangeText, rangeWrap);
    configRow.append(rangeLabel);

    const limitRow = document.createElement("label");
    limitRow.className = "craft-assist-item-limit";
    const limitCheck = document.createElement("input");
    limitCheck.type = "checkbox";
    limitCheck.checked = disableLimit;
    const limitText = document.createElement("span");
    limitText.textContent = "可小于相对磨损";
    limitCheck.onchange = () => {
      updateCraftAssistMaterial(materialId, (entry) => ({
        ...entry,
        direction: normalizeCraftAssistDirection(role, entry && entry.direction),
        disable_direction_limit: !!limitCheck.checked
      }));
      syncCraftAssistAutoDirectionLimit();
      renderCraftAssistPanel();
    };
    limitRow.append(limitCheck, limitText);
    configRow.append(limitRow);

    const selectedWrap = document.createElement("div");
    selectedWrap.className = "craft-assist-selected-wrap";
    const selectedLabel = document.createElement("div");
    selectedLabel.className = "craft-assist-selected-label";
    selectedLabel.textContent = "已选材料";
    const selectedTags = document.createElement("div");
    selectedTags.className = "craft-assist-selected-tags";
    if (!selectedNames.length) {
      const selectedEmpty = document.createElement("div");
      selectedEmpty.className = "craft-assist-selected-empty";
      selectedEmpty.textContent = "暂无";
      selectedTags.append(selectedEmpty);
    } else {
      for (const name of selectedNames) {
        const tag = document.createElement("div");
        tag.className = "craft-assist-selected-tag";
        const tagText = document.createElement("span");
        tagText.className = "craft-assist-selected-tag-text";
        tagText.textContent = name;
        const tagRemove = document.createElement("button");
        tagRemove.type = "button";
        tagRemove.className = "craft-assist-selected-tag-remove";
        tagRemove.title = `从该项删除：${name}`;
        tagRemove.setAttribute("aria-label", `从该项删除：${name}`);
        tagRemove.textContent = "×";
        tagRemove.onclick = (evt) => {
          if (evt && typeof evt.stopPropagation === "function") evt.stopPropagation();
          removeCraftAssistMaterialName(materialId, name);
        };
        tag.append(tagText, tagRemove);
        selectedTags.append(tag);
      }
    }
    selectedWrap.append(selectedLabel, selectedTags);

    item.append(head, configRow, selectedWrap);
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
  const targetWear = parseOptionalWear01(state.craftAssistTargetWear);
  if (targetWear == null) {
    return {ok: false, message: "请先填写目标相对磨损"};
  }
  const probe = buildCurrentCraftAssistPresetSnapshot("__precheck__");
  return validateCraftAssistPresetSnapshot(probe);
}

function isCraftAssistPresetEditing() {
  return !!String(state.craftAssistPresetEditingId || "").trim();
}

function buildCraftAssistDraftSnapshotFromState() {
  const filterMode = getCraftAssistFilterMode();
  const targetWear = parseOptionalWear01(state.craftAssistTargetWear);
  return {
    panel_open: !!state.craftAssistOpen,
    target_wear: targetWear,
    wear_filter_mode: filterMode,
    materials: normalizeCraftAssistMaterialList(state.craftAssistMaterials, {
      targetWear,
      idPrefix: "assist",
      useRelative: filterMode !== "absolute"
    }).map((entry) => ({...entry})),
    pick_role: normalizeCraftAssistRole(state.craftAssistPickRole)
  };
}

function buildCraftAssistPresetComparableSnapshot({targetWear = null, wearFilterMode = "relative", materials = []} = {}) {
  const filterMode = normalizeCraftAssistFilterMode(wearFilterMode);
  const parsedTargetWear = parseOptionalWear01(targetWear);
  const normalizedMaterials = normalizeCraftAssistMaterialList(materials, {
    targetWear: parsedTargetWear,
    idPrefix: "assist",
    useRelative: filterMode !== "absolute"
  }).map((entry) => ({
    names: craftAssistMaterialNames(entry),
    role: normalizeCraftAssistRole(entry && entry.role),
    count: normalizeCraftAssistEntryCount(entry && entry.count, 1),
    direction: normalizeCraftAssistDirection(entry && entry.role, entry && entry.direction),
    disable_direction_limit: !!(entry && entry.disable_direction_limit),
    wear_min: clampWear01(entry && entry.wear_min, 0),
    wear_max: clampWear01(entry && entry.wear_max, 1),
    custom_range: !!(entry && entry.custom_range)
  }));
  return {
    target_wear: parsedTargetWear,
    wear_filter_mode: filterMode,
    materials: normalizedMaterials
  };
}

function getCurrentCraftAssistPresetComparableSnapshot() {
  const filterMode = getCraftAssistFilterMode();
  return buildCraftAssistPresetComparableSnapshot({
    targetWear: state.craftAssistTargetWear,
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
  const filterMode = normalizeCraftAssistFilterMode(snapshot.wear_filter_mode);
  state.craftAssistTargetWear = parseOptionalWear01(snapshot.target_wear);
  setCraftAssistFilterMode(filterMode, {refreshRanges: false, renderPanel: false});
  state.craftAssistMaterials = normalizeCraftAssistMaterialList(snapshot.materials, {
    targetWear: state.craftAssistTargetWear,
    idPrefix: "assist",
    useRelative: filterMode !== "absolute"
  });
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
  const filterMode = normalizeCraftAssistFilterMode(normalized.wear_filter_mode);
  state.craftAssistTargetWear = parseOptionalWear01(normalized.target_wear);
  setCraftAssistFilterMode(filterMode, {refreshRanges: false, renderPanel: false});
  state.craftAssistMaterials = normalizeCraftAssistMaterialList(normalized.materials, {
    targetWear: state.craftAssistTargetWear,
    idPrefix: "assist",
    useRelative: filterMode !== "absolute"
  });
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
  const preCheck = validateCurrentCraftAssistPresetBeforeNaming();
  if (!preCheck.ok) {
    setCraftStatus(preCheck.message, true);
    return false;
  }
  const presetName = await openCraftAssistPresetModal("");
  if (presetName == null) return false;
  return saveCurrentCraftAssistPreset(presetName);
}
function applyCraftAssistPreset(presetId, {autoSelect = true, applyCount = 1} = {}) {
  const id = String(presetId || "").trim();
  if (!id) return;
  const list = Array.isArray(state.craftAssistPresets) ? state.craftAssistPresets : [];
  const idx = list.findIndex((entry) => String(entry && entry.id || "").trim() === id);
  if (idx < 0) return;
  const preset = sanitizeCraftAssistPresetPayload(list[idx]);
  if (!preset) return;

  if (autoSelect) {
    const draftBackup = buildCraftAssistDraftSnapshotFromState();
    const editingBackup = {
      id: state.craftAssistPresetEditingId,
      name: state.craftAssistPresetEditingName,
      backup: state.craftAssistPresetEditingBackup,
      initial: state.craftAssistPresetEditingInitialSnapshot
    };
    const repeatCount = normalizeCraftAssistApplyCount(applyCount, 1);
    try {
      restoreCraftAssistDraftSnapshot({
        panel_open: draftBackup.panel_open,
        target_wear: preset.target_wear,
        wear_filter_mode: preset.wear_filter_mode,
        materials: preset.materials,
        pick_role: draftBackup.pick_role
      });
      return applyCraftAssistAutoSelectionBatch({sourcePresetName: preset.name, repeatCount});
    } finally {
      restoreCraftAssistDraftSnapshot(draftBackup);
      state.craftAssistPresetEditingId = editingBackup.id;
      state.craftAssistPresetEditingName = editingBackup.name;
      state.craftAssistPresetEditingBackup = editingBackup.backup;
      state.craftAssistPresetEditingInitialSnapshot = editingBackup.initial;
      renderCraftAssistPanel();
    }
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
  const snapshot = buildCurrentCraftAssistPresetSnapshot(String(existed.name || "").trim());
  const check = validateCraftAssistPresetSnapshot(snapshot);
  if (!check.ok) {
    setCraftStatus(check.message, true);
    return false;
  }
  const next = {
    ...snapshot,
    id: String(existed.id || "").trim() || editingId,
    name: String(existed.name || "").trim(),
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
function renderCraftAssistPresetPanel() {
  if (!ui.craftAssistPresetPanel || !ui.craftAssistPresetList) return;
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
    item.draggable = !(state.refreshing || state.craftBusy || inEditingMode);
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
    metaWear.textContent = `wear: ${wearText6(preset && preset.target_wear)}`;
    meta.append(metaTop, metaWear);

    const actions = document.createElement("div");
    actions.className = "craft-assist-preset-actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "craft-assist-preset-edit";
    editBtn.textContent = "编辑";
    editBtn.disabled = state.refreshing || state.craftBusy;
    editBtn.onclick = () => {
      applyCraftAssistPresetForEdit(preset.id);
    };
    const applyCountWrap = document.createElement("label");
    applyCountWrap.className = "craft-assist-preset-apply-count";
    const applyCountInput = document.createElement("input");
    applyCountInput.type = "number";
    applyCountInput.min = "1";
    applyCountInput.max = "10";
    applyCountInput.step = "1";
    applyCountInput.value = String(applyCountValue);
    applyCountInput.setAttribute("aria-label", "应用数量");
    applyCountInput.disabled = inEditingMode || state.refreshing || state.craftBusy;
    applyCountInput.onchange = () => {
      const next = normalizeCraftAssistApplyCount(applyCountInput.value, applyCountMap[presetId]);
      applyCountInput.value = String(next);
      if (presetId) applyCountMap[presetId] = next;
    };
    applyCountWrap.append(applyCountInput);
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.textContent = "应用";
    applyBtn.disabled = inEditingMode || state.refreshing || state.craftBusy;
    applyBtn.onclick = () => {
      const countValue = normalizeCraftAssistApplyCount(applyCountInput.value, applyCountMap[presetId]);
      applyCountInput.value = String(countValue);
      if (presetId) applyCountMap[presetId] = countValue;
      applyCraftAssistPreset(preset.id, {autoSelect: true, applyCount: countValue});
    };
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.className = "craft-assist-preset-remove";
    removeBtn.title = "删除该配置";
    removeBtn.setAttribute("aria-label", "删除该配置");
    removeBtn.disabled = inEditingMode || state.refreshing || state.craftBusy;
    removeBtn.onclick = () => {
      const ok = window.confirm(`确认删除配置【${String(preset && preset.name || "").trim()}】？`);
      if (!ok) return;
      removeCraftAssistPreset(preset.id);
    };
    actions.append(editBtn, applyCountWrap, applyBtn);

    item.append(name, meta, actions, removeBtn);
    ui.craftAssistPresetList.append(item);
  }
}
function craftAssistRelativeValueOfRow(row) {
  if (!row || typeof row !== "object") return null;
  return getRelativeWearValue(row);
}
function craftAssistValueOfRow(row) {
  return craftAssistRelativeValueOfRow(row);
}
function buildCraftAssistRowsByName(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = rowAssetId(row);
    if (!id) continue;
    const name = itemDisplayName(row);
    if (!name) continue;
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(row);
  }
  return map;
}
function normalizeCraftAssistMaterialsForRun() {
  const useRelativeFilter = getCraftAssistFilterUseRelative();
  const normalized = (Array.isArray(state.craftAssistMaterials) ? state.craftAssistMaterials : [])
    .map((entry) => {
      const names = craftAssistMaterialNames(entry);
      const name = names[0] || "";
      const role = normalizeCraftAssistRole(entry && entry.role);
      const countFallback = 1;
      const count = normalizeCraftAssistEntryCount(entry && entry.count, countFallback);
      const resolvedRange = resolveCraftAssistMaterialEffectiveRange(entry, {useRelative: useRelativeFilter});
      let wearMin = clampWear01(resolvedRange.wear_min, 0);
      let wearMax = clampWear01(resolvedRange.wear_max, 1);
      if (wearMax < wearMin) {
        const tmp = wearMin;
        wearMin = wearMax;
        wearMax = tmp;
      }
      return {
        id: String(entry && entry.id || "").trim(),
        names,
        name,
        label: names.join(" / "),
        role,
        count,
        direction: normalizeCraftAssistDirection(role, entry && entry.direction),
        disable_direction_limit: !!(entry && entry.disable_direction_limit),
        wear_min: wearMin,
        wear_max: wearMax
      };
    })
    .filter((entry) => entry.names.length > 0 && entry.count > 0);
  return normalized;
}
function craftAssistCandidateComparator(a, b, target) {
  const da = Math.abs(Number(a && a.value) - target);
  const db = Math.abs(Number(b && b.value) - target);
  if (da !== db) return da - db;
  const va = Number(a && a.value);
  const vb = Number(b && b.value);
  if (va !== vb) return va - vb;
  return String(a && a.id || "").localeCompare(String(b && b.id || ""));
}
function collectCraftAssistCandidatesForMaterial(material, rowsByName, blockedIds, targetValue) {
  const nameList = craftAssistMaterialNames(material);
  const rows = [];
  for (const name of nameList) {
    rows.push(...(rowsByName.get(name) || []));
  }
  const useRelativeFilter = getCraftAssistFilterUseRelative();
  const target = Number(targetValue);
  const unique = new Map();
  for (const row of rows) {
    const id = rowAssetId(row);
    if (!id || blockedIds.has(id)) continue;
    if (unique.has(id)) continue;
    const relativeValue = craftAssistRelativeValueOfRow(row);
    const rangeValue = useRelativeFilter ? relativeValue : getAbsoluteWearValue(row);
    const value = craftAssistValueOfRow(row);
    if (relativeValue == null || rangeValue == null || value == null) continue;
    if (rangeValue < Number(material.wear_min) - 1e-9 || rangeValue > Number(material.wear_max) + 1e-9) continue;
    if (!material.disable_direction_limit) {
      if (material.direction === "gt" && !(value > target + 1e-9)) continue;
      if (material.direction === "lt" && !(value < target - 1e-9)) continue;
    }
    unique.set(id, {id, row, value, relative_value: relativeValue});
  }
  const list = [...unique.values()];
  list.sort((a, b) => craftAssistCandidateComparator(a, b, targetValue));
  return list;
}
function pickCraftAssistClosest(candidates, count, targetValue) {
  return [...(Array.isArray(candidates) ? candidates : [])]
    .sort((a, b) => craftAssistCandidateComparator(a, b, targetValue))
    .slice(0, Math.max(0, Number(count) || 0));
}
function pickCraftAssistBySplit(candidates, count, targetValue) {
  const need = Math.max(0, Number(count) || 0);
  const list = Array.isArray(candidates) ? candidates : [];
  if (need <= 0 || !list.length) return [];
  if (need === 1) return pickCraftAssistClosest(list, 1, targetValue);

  const above = list.filter((x) => Number(x.value) > targetValue + 1e-9)
    .sort((a, b) => craftAssistCandidateComparator(a, b, targetValue));
  const below = list.filter((x) => Number(x.value) < targetValue - 1e-9)
    .sort((a, b) => craftAssistCandidateComparator(a, b, targetValue));

  const makeOption = (upCount, downCount) => {
    const selected = [];
    const used = new Set();
    const pushFrom = (arr, n) => {
      for (const item of arr) {
        if (selected.length >= need || n <= 0) break;
        if (used.has(item.id)) continue;
        used.add(item.id);
        selected.push(item);
        n -= 1;
      }
      return n;
    };
    let remainUp = Math.max(0, Math.min(need, Number(upCount) || 0));
    let remainDown = Math.max(0, Math.min(need - remainUp, Number(downCount) || 0));
    remainUp = pushFrom(above, remainUp);
    remainDown = pushFrom(below, remainDown);
    const rest = list
      .filter((item) => !used.has(item.id))
      .sort((a, b) => craftAssistCandidateComparator(a, b, targetValue));
    for (const item of rest) {
      if (selected.length >= need) break;
      selected.push(item);
    }
    return selected.slice(0, need);
  };

  const low = Math.floor(need / 2);
  const high = Math.ceil(need / 2);
  const options = [makeOption(high, low)];
  if (high !== low) options.push(makeOption(low, high));

  let best = [];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const option of options) {
    if (option.length !== need) continue;
    const avg = option.reduce((sum, item) => sum + Number(item.value), 0) / need;
    const score = Math.abs(avg - targetValue) + (avg >= targetValue ? 1e-8 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = option;
    }
  }
  if (best.length === need) return best;
  return pickCraftAssistClosest(list, need, targetValue);
}
function applyCraftAssistDeficitCorrection({selected, candidates, targetValue, count}) {
  const need = Math.max(0, Number(count) || 0);
  const chosen = Array.isArray(selected) ? [...selected] : [];
  if (need <= 0 || chosen.length !== need) return chosen;
  const threshold = Number(targetValue) - 1e-9;
  const pool = Array.isArray(candidates) ? candidates : [];
  if (!pool.length) return chosen;

  const calcAvg = (list) => list.reduce((sum, item) => sum + Number(item && item.value || 0), 0) / need;
  let avg = calcAvg(chosen);
  if (!(avg < threshold)) return chosen;

  let iterations = 0;
  const maxIterations = 80;
  while (avg < threshold && iterations < maxIterations) {
    const gap = threshold - avg;
    const selectedIds = new Set(chosen.map((item) => String(item && item.id || "").trim()).filter(Boolean));
    let bestMove = null;
    for (let idx = 0; idx < chosen.length; idx += 1) {
      const oldItem = chosen[idx];
      const oldValue = Number(oldItem && oldItem.value);
      if (!Number.isFinite(oldValue)) continue;
      for (const candidate of pool) {
        const nextId = String(candidate && candidate.id || "").trim();
        if (!nextId || selectedIds.has(nextId)) continue;
        const nextValue = Number(candidate && candidate.value);
        if (!Number.isFinite(nextValue) || !(nextValue > oldValue + 1e-9)) continue;
        const deltaAvg = (nextValue - oldValue) / need;
        if (!(deltaAvg > 1e-12) || deltaAvg > gap + 1e-12) continue;
        if (!bestMove || deltaAvg > bestMove.deltaAvg) {
          bestMove = {idx, next: candidate, deltaAvg};
        }
      }
    }
    if (!bestMove) break;
    chosen[bestMove.idx] = bestMove.next;
    avg = calcAvg(chosen);
    iterations += 1;
  }
  return chosen;
}
function applyCraftAssistOverflowCorrection({materialResults, targetValue, maxIterations = 80}) {
  const entries = Array.isArray(materialResults) ? materialResults : [];
  if (!entries.length) return entries;
  const threshold = Number(targetValue) - 1e-9;
  let overall = calcCraftAssistOverallMean(entries);
  if (overall == null) return entries;
  let iterations = 0;
  while (!(overall < threshold) && iterations < Math.max(1, Number(maxIterations) || 80)) {
    const needDrop = overall - threshold;
    const totalMaterials = entries.length;
    const moves = [];
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex];
      const selected = Array.isArray(entry && entry.selected) ? entry.selected : [];
      const available = Array.isArray(entry && entry.available) ? entry.available : [];
      if (!selected.length || !available.length) continue;
      const selectedIds = new Set(selected.map((item) => String(item && item.id || "").trim()).filter(Boolean));
      const pool = available.filter((cand) => !selectedIds.has(String(cand && cand.id || "").trim()));
      if (!pool.length) continue;
      for (const oldItem of selected) {
        const oldValue = Number(oldItem && oldItem.value);
        if (!Number.isFinite(oldValue)) continue;
        for (const candidate of pool) {
          const nextValue = Number(candidate && candidate.value);
          if (!Number.isFinite(nextValue)) continue;
          if (!(nextValue < oldValue - 1e-9)) continue;
          const deltaMaterial = (oldValue - nextValue) / selected.length;
          const deltaOverall = deltaMaterial / totalMaterials;
          if (!(deltaOverall > 1e-12)) continue;
          moves.push({
            entryIndex,
            oldId: String(oldItem && oldItem.id || "").trim(),
            next: candidate,
            drop: deltaOverall
          });
        }
      }
    }
    if (!moves.length) break;
    const underMoves = moves.filter((move) => move.drop <= needDrop + 1e-12);
    let chosen = null;
    if (underMoves.length) {
      underMoves.sort((a, b) => Number(b.drop) - Number(a.drop));
      chosen = underMoves[0];
    } else {
      moves.sort((a, b) => Number(a.drop) - Number(b.drop));
      chosen = moves[0];
    }
    if (!chosen) break;
    const entry = entries[chosen.entryIndex];
    entry.selected = (Array.isArray(entry.selected) ? entry.selected : []).map((item) => {
      const id = String(item && item.id || "").trim();
      return id === chosen.oldId ? chosen.next : item;
    });
    overall = calcCraftAssistOverallMean(entries);
    if (overall == null) break;
    iterations += 1;
  }
  return entries;
}
function applyCraftAssistOffsetWindowCorrection({materialResults, targetValue, maxOffset, maxIterations = 120}) {
  const entries = Array.isArray(materialResults) ? materialResults : [];
  if (!entries.length) return entries;
  const target = Number(targetValue);
  const offset = Number(maxOffset);
  if (!Number.isFinite(target) || !Number.isFinite(offset) || offset <= 0) return entries;
  const lowerBound = target - offset;
  const cap = target - 1e-9;
  const totalMaterials = entries.length;
  let overall = calcCraftAssistOverallMean(entries);
  if (overall == null) return entries;
  let iterations = 0;
  const limit = Math.max(1, Number(maxIterations) || 120);
  while (overall < lowerBound - 1e-9 && iterations < limit) {
    const needRaise = lowerBound - overall;
    const moves = [];
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex];
      const selected = Array.isArray(entry && entry.selected) ? entry.selected : [];
      const available = Array.isArray(entry && entry.available) ? entry.available : [];
      if (!selected.length || !available.length) continue;
      const selectedIds = new Set(selected.map((item) => String(item && item.id || "").trim()).filter(Boolean));
      const pool = available.filter((cand) => !selectedIds.has(String(cand && cand.id || "").trim()));
      if (!pool.length) continue;
      for (const oldItem of selected) {
        const oldValue = Number(oldItem && oldItem.value);
        if (!Number.isFinite(oldValue)) continue;
        for (const candidate of pool) {
          const nextValue = Number(candidate && candidate.value);
          if (!Number.isFinite(nextValue)) continue;
          if (!(nextValue > oldValue + 1e-9)) continue;
          const deltaMaterial = (nextValue - oldValue) / selected.length;
          const deltaOverall = deltaMaterial / totalMaterials;
          if (!(deltaOverall > 1e-12)) continue;
          const nextOverall = overall + deltaOverall;
          if (!(nextOverall < cap)) continue;
          moves.push({
            entryIndex,
            oldId: String(oldItem && oldItem.id || "").trim(),
            next: candidate,
            raise: deltaOverall
          });
        }
      }
    }
    if (!moves.length) break;
    const underMoves = moves.filter((move) => move.raise <= needRaise + 1e-12);
    let chosen = null;
    if (underMoves.length) {
      underMoves.sort((a, b) => Number(b.raise) - Number(a.raise));
      chosen = underMoves[0];
    } else {
      moves.sort((a, b) => Number(a.raise) - Number(b.raise));
      chosen = moves[0];
    }
    if (!chosen) break;
    const entry = entries[chosen.entryIndex];
    entry.selected = (Array.isArray(entry.selected) ? entry.selected : []).map((item) => {
      const id = String(item && item.id || "").trim();
      return id === chosen.oldId ? chosen.next : item;
    });
    overall = calcCraftAssistOverallMean(entries);
    if (overall == null) break;
    iterations += 1;
  }
  return entries;
}
function solveCraftAssistMinCostAssignmentForRarity({prepared, rarity}) {
  const sourceList = Array.isArray(prepared) ? prepared : [];
  const entries = [];
  let totalNeed = 0;
  for (const item of sourceList) {
    const material = item && item.material ? item.material : null;
    if (!material) return null;
    const need = normalizeCraftAssistEntryCount(material && material.count, 1);
    const available = (Array.isArray(item && item.candidates) ? item.candidates : [])
      .filter((cand) => craftRarityValue(cand && cand.row) === Number(rarity));
    if (available.length < need) return null;
    entries.push({material, need, available});
    totalNeed += need;
  }
  if (!entries.length || totalNeed <= 0) return null;

  const candidateMap = new Map();
  for (const entry of entries) {
    for (const cand of entry.available) {
      const id = String(cand && cand.id || "").trim();
      if (!id || candidateMap.has(id)) continue;
      candidateMap.set(id, cand);
    }
  }
  const candidateIds = [...candidateMap.keys()];
  if (!candidateIds.length) return null;
  const candidateIndexMap = new Map(candidateIds.map((id, idx) => [id, idx]));

  const sourceNode = 0;
  const materialNodeStart = 1;
  const candidateNodeStart = materialNodeStart + entries.length;
  const sinkNode = candidateNodeStart + candidateIds.length;
  const nodeCount = sinkNode + 1;
  const graph = Array.from({length: nodeCount}, () => []);

  const addEdge = (from, to, capacity, cost, meta = null) => {
    const fwd = {to, rev: 0, cap: capacity, cost, meta};
    const rev = {to: from, rev: 0, cap: 0, cost: -cost, meta: null};
    fwd.rev = graph[to].length;
    rev.rev = graph[from].length;
    graph[from].push(fwd);
    graph[to].push(rev);
    return fwd;
  };

  const assignmentEdges = [];
  const COST_SCALE = 1e6;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const materialNode = materialNodeStart + i;
    addEdge(sourceNode, materialNode, entry.need, 0);
    const denom = Math.max(1, Number(entry.need) || 1);
    for (const cand of entry.available) {
      const candId = String(cand && cand.id || "").trim();
      const candIdx = candidateIndexMap.get(candId);
      if (!candId || candIdx == null) continue;
      const value = Number(cand && cand.value);
      if (!Number.isFinite(value)) continue;
      const candidateNode = candidateNodeStart + candIdx;
      const unitCost = Math.round((value / denom) * COST_SCALE);
      const edge = addEdge(materialNode, candidateNode, 1, unitCost, {materialIndex: i, candidateId: candId});
      assignmentEdges.push(edge);
    }
  }
  for (let i = 0; i < candidateIds.length; i += 1) {
    addEdge(candidateNodeStart + i, sinkNode, 1, 0);
  }

  const potential = Array(nodeCount).fill(0);
  const dist = Array(nodeCount).fill(0);
  const prevNode = Array(nodeCount).fill(-1);
  const prevEdge = Array(nodeCount).fill(-1);
  const pushHeap = (heap, item) => {
    heap.push(item);
    let idx = heap.length - 1;
    while (idx > 0) {
      const parent = Math.floor((idx - 1) / 2);
      if (heap[parent][0] <= heap[idx][0]) break;
      const tmp = heap[parent];
      heap[parent] = heap[idx];
      heap[idx] = tmp;
      idx = parent;
    }
  };
  const popHeap = (heap) => {
    if (!heap.length) return null;
    const out = heap[0];
    const tail = heap.pop();
    if (!heap.length) return out;
    heap[0] = tail;
    let idx = 0;
    while (true) {
      const left = idx * 2 + 1;
      const right = left + 1;
      let smallest = idx;
      if (left < heap.length && heap[left][0] < heap[smallest][0]) smallest = left;
      if (right < heap.length && heap[right][0] < heap[smallest][0]) smallest = right;
      if (smallest === idx) break;
      const tmp = heap[smallest];
      heap[smallest] = heap[idx];
      heap[idx] = tmp;
      idx = smallest;
    }
    return out;
  };

  let flow = 0;
  while (flow < totalNeed) {
    dist.fill(Number.POSITIVE_INFINITY);
    prevNode.fill(-1);
    prevEdge.fill(-1);
    dist[sourceNode] = 0;
    const heap = [];
    pushHeap(heap, [0, sourceNode]);

    while (heap.length) {
      const top = popHeap(heap);
      if (!top) break;
      const [currentDist, node] = top;
      if (currentDist !== dist[node]) continue;
      const edges = graph[node];
      for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
        const edge = edges[edgeIndex];
        if (!edge || edge.cap <= 0) continue;
        const next = edge.to;
        const reducedCost = edge.cost + potential[node] - potential[next];
        const nextDist = currentDist + reducedCost;
        if (nextDist + 1e-9 >= dist[next]) continue;
        dist[next] = nextDist;
        prevNode[next] = node;
        prevEdge[next] = edgeIndex;
        pushHeap(heap, [nextDist, next]);
      }
    }

    if (!Number.isFinite(dist[sinkNode])) return null;
    for (let node = 0; node < nodeCount; node += 1) {
      if (!Number.isFinite(dist[node])) continue;
      potential[node] += dist[node];
    }

    let addFlow = totalNeed - flow;
    for (let node = sinkNode; node !== sourceNode; node = prevNode[node]) {
      if (node < 0 || prevNode[node] < 0 || prevEdge[node] < 0) return null;
      const edge = graph[prevNode[node]][prevEdge[node]];
      addFlow = Math.min(addFlow, edge.cap);
    }
    if (!(addFlow > 0)) return null;

    for (let node = sinkNode; node !== sourceNode; node = prevNode[node]) {
      const from = prevNode[node];
      const edge = graph[from][prevEdge[node]];
      edge.cap -= addFlow;
      graph[node][edge.rev].cap += addFlow;
    }
    flow += addFlow;
  }

  if (flow < totalNeed) return null;

  const selectedByMaterial = entries.map(() => []);
  for (const edge of assignmentEdges) {
    if (!edge || edge.cap > 0 || !edge.meta) continue;
    const materialIndex = Number(edge.meta.materialIndex);
    const candidateId = String(edge.meta.candidateId || "").trim();
    if (!Number.isFinite(materialIndex) || materialIndex < 0 || materialIndex >= selectedByMaterial.length || !candidateId) continue;
    const cand = candidateMap.get(candidateId);
    if (!cand) continue;
    selectedByMaterial[materialIndex].push(cand);
  }

  const materialResults = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const selected = selectedByMaterial[i];
    if (!Array.isArray(selected) || selected.length !== entry.need) return null;
    materialResults.push({
      material: entry.material,
      selected: [...selected],
      available: entry.available
    });
  }
  const overall = calcCraftAssistOverallMean(materialResults);
  if (overall == null) return null;
  return {
    rarity: Number(rarity),
    materialResults,
    overall
  };
}
function findCraftAssistFallbackBelowTargetSolution({prepared, raritySet, targetValue}) {
  const threshold = Number(targetValue) - 1e-9;
  const rarities = [...(raritySet instanceof Set ? raritySet : new Set())]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!rarities.length) return null;
  let best = null;
  for (const rarity of rarities) {
    const solved = solveCraftAssistMinCostAssignmentForRarity({
      prepared,
      rarity
    });
    if (!solved || solved.overall == null) continue;
    if (!(Number(solved.overall) < threshold)) continue;
    const gap = Number(targetValue) - Number(solved.overall);
    if (!best || gap < best.gap - 1e-12 || (Math.abs(gap - best.gap) <= 1e-12 && Number(solved.rarity) < Number(best.rarity))) {
      best = {
        rarity: Number(solved.rarity),
        materialResults: solved.materialResults,
        overall: Number(solved.overall),
        gap
      };
    }
  }
  if (!best) return null;
  return {
    rarity: best.rarity,
    materialResults: best.materialResults,
    overall: best.overall
  };
}
function calcCraftAssistOverallMean(materialResults) {
  const means = [];
  for (const item of Array.isArray(materialResults) ? materialResults : []) {
    const picks = Array.isArray(item && item.selected) ? item.selected : [];
    if (!picks.length) continue;
    const avg = picks.reduce((sum, pick) => sum + Number(pick.value), 0) / picks.length;
    means.push(avg);
  }
  if (!means.length) return null;
  return means.reduce((sum, value) => sum + value, 0) / means.length;
}
function runCraftAssistSelectionForRecipe({materials, rowsByName, blockedIds, targetValue}) {
  const blocked = blockedIds instanceof Set ? blockedIds : new Set();
  const offsetHintText = getCraftAssistOffsetSettingHintText();
  const prepared = materials.map((material) => {
    const cands = collectCraftAssistCandidatesForMaterial(material, rowsByName, blocked, targetValue);
    const estimate = pickCraftAssistClosest(cands, material.count, targetValue);
    const estimateDiff = estimate.length
      ? Math.abs(estimate.reduce((sum, item) => sum + Number(item.value), 0) / estimate.length - targetValue)
      : Number.POSITIVE_INFINITY;
    return {material, candidates: cands, estimateDiff};
  });
  const feasibleRaritySets = prepared.map((item) => {
    const countByRarity = new Map();
    for (const cand of item.candidates) {
      const rarity = craftRarityValue(cand.row);
      if (rarity <= 0) continue;
      countByRarity.set(rarity, (countByRarity.get(rarity) || 0) + 1);
    }
    const feasible = new Set(
      [...countByRarity.entries()]
        .filter(([, count]) => count >= Number(item.material && item.material.count || 0))
        .map(([rarity]) => rarity)
    );
    return {material: item.material, feasible, candidateCount: item.candidates.length};
  });
  let sharedRaritySet = null;
  for (const item of feasibleRaritySets) {
    if (!item.feasible.size) {
      const materialName = craftAssistMaterialLabel(item.material);
      const requiredCount = Number(item.material && item.material.count || 0);
      const candidateCount = Math.max(0, Number(item.candidateCount || 0));
      if (candidateCount <= 0) {
        return {ok: false, message: `父类材料【${materialName}】无可用材料，${offsetHintText}`};
      }
      if (requiredCount > 0 && candidateCount < requiredCount) {
        return {ok: false, message: `父类材料【${materialName}】可用数量不足：需${requiredCount}，仅${candidateCount}，${offsetHintText}`};
      }
      return {ok: false, message: `父类材料【${materialName}】在当前条件下无法满足同稀有度数量要求`};
    }
    if (sharedRaritySet == null) {
      sharedRaritySet = new Set(item.feasible);
      continue;
    }
    sharedRaritySet = new Set([...sharedRaritySet].filter((rarity) => item.feasible.has(rarity)));
  }
  if (!sharedRaritySet || !sharedRaritySet.size) {
    return {ok: false, message: "父类材料稀有度不一致，单个配方必须使用同一稀有度材料"};
  }
  const pickRarityScores = [...sharedRaritySet].map((rarity) => {
    let score = 0;
    for (const item of prepared) {
      const sameRarity = item.candidates.filter((cand) => craftRarityValue(cand.row) === rarity);
      const estimate = pickCraftAssistClosest(sameRarity, item.material.count, targetValue);
      if (estimate.length !== item.material.count) {
        score = Number.POSITIVE_INFINITY;
        break;
      }
      const avg = estimate.reduce((sum, cand) => sum + Number(cand.value), 0) / estimate.length;
      score += Math.abs(avg - targetValue);
    }
    return {rarity, score};
  });
  pickRarityScores.sort((a, b) => {
    const diff = Number(a.score) - Number(b.score);
    if (diff !== 0) return diff;
    return Number(a.rarity) - Number(b.rarity);
  });
  let selectedRarity = Number(pickRarityScores[0] && pickRarityScores[0].rarity || 0);
  if (!Number.isFinite(selectedRarity) || selectedRarity <= 0) {
    return {ok: false, message: "辅助选材未命中可用稀有度，请调整材料约束"};
  }
  prepared.sort((a, b) => {
    const diff = Number(a.estimateDiff) - Number(b.estimateDiff);
    if (diff !== 0) return diff;
    const sizeDiff = Number(a.candidates.length) - Number(b.candidates.length);
    if (sizeDiff !== 0) return sizeDiff;
    return craftAssistMaterialLabel(a.material).localeCompare(craftAssistMaterialLabel(b.material));
  });

  const usedIds = new Set();
  let materialResults = [];
  for (const item of prepared) {
    const material = item.material;
    const materialLabel = craftAssistMaterialLabel(material);
    const available = item.candidates.filter((cand) => !usedIds.has(cand.id) && craftRarityValue(cand.row) === selectedRarity);
    if (available.length < material.count) {
      return {
        ok: false,
        message: `父类材料【${materialLabel}】可用数量不足：需${material.count}，仅${available.length}（稀有度 ${craftRarityLabel(selectedRarity)}），${offsetHintText}`
      };
    }
    let picked = pickCraftAssistBySplit(available, material.count, targetValue);
    picked = applyCraftAssistDeficitCorrection({
      selected: picked,
      candidates: available,
      targetValue,
      count: material.count
    });
    if (picked.length !== material.count) {
      return {ok: false, message: `父类材料【${materialLabel}】选材失败`};
    }
    for (const choice of picked) {
      if (usedIds.has(choice.id)) {
        return {ok: false, message: `辅助选材出现重复物品：${choice.id}`};
      }
      usedIds.add(choice.id);
    }
    materialResults.push({material, selected: picked, available});
  }

  const overallBeforeRetry = calcCraftAssistOverallMean(materialResults);
  if (overallBeforeRetry != null && !(overallBeforeRetry < targetValue - 1e-9)) {
    applyCraftAssistOverflowCorrection({
      materialResults,
      targetValue
    });
  }
  let overall = calcCraftAssistOverallMean(materialResults);
  if (overall == null) {
    return {ok: false, message: "辅助选材未得到有效结果"};
  }
  if (!(overall < targetValue - 1e-9)) {
    const fallback = findCraftAssistFallbackBelowTargetSolution({
      prepared,
      raritySet: sharedRaritySet,
      targetValue
    });
    if (fallback) {
      selectedRarity = Number(fallback.rarity || selectedRarity);
      materialResults = Array.isArray(fallback.materialResults) ? fallback.materialResults : materialResults;
      overall = Number(fallback.overall);
    } else {
      const retried = overallBeforeRetry != null && !(overallBeforeRetry < targetValue - 1e-9);
      const retryPrefix = retried ? "已执行下探重试，" : "";
      return {ok: false, message: `${retryPrefix}结果均值需小于目标磨损：当前 ${numberTextTrunc(overall, WEAR_INPUT_DECIMALS)}，目标 ${numberTextTrunc(targetValue, WEAR_INPUT_DECIMALS)}`};
    }
  }

  const outputOffset = getCraftAssistWearOffsetByTarget(targetValue);
  if (outputOffset > 0) {
    const offsetLowerBound = Number(targetValue) - Number(outputOffset);
    const needOffsetRetry = overall < offsetLowerBound - 1e-9;
    if (needOffsetRetry) {
      applyCraftAssistOffsetWindowCorrection({
        materialResults,
        targetValue,
        maxOffset: outputOffset
      });
      overall = calcCraftAssistOverallMean(materialResults);
      if (overall == null) {
        return {ok: false, message: "偏移修正后结果无效，请调整材料范围"};
      }
      if (!(overall < targetValue - 1e-9)) {
        return {
          ok: false,
          message: `偏移回拉后超过目标磨损：当前 ${numberTextTrunc(overall, WEAR_INPUT_DECIMALS)}，目标 ${numberTextTrunc(targetValue, WEAR_INPUT_DECIMALS)}`
        };
      }
    }
    const delta = Math.abs(Number(overall) - Number(targetValue));
    if (delta > outputOffset + 1e-9) {
      const retryPrefix = needOffsetRetry ? "已执行偏移回拉重试，" : "";
      return {
        ok: false,
        message: `${retryPrefix}产物相对磨损偏移超阈值：当前偏移 ${numberTextTrunc(delta, WEAR_INPUT_DECIMALS)}，阈值 ${numberTextTrunc(outputOffset, WEAR_INPUT_DECIMALS)}`
      };
    }
  }

  const resultIds = [];
  for (const entry of materialResults) {
    for (const choice of entry.selected) {
      resultIds.push(choice.id);
    }
  }
  return {
    ok: true,
    itemIds: normalizeCraftRecipeItemIds(resultIds),
    overall,
    rarity: selectedRarity
  };
}
function applyCraftAssistAutoSelection({sourcePresetName = ""} = {}) {
  if (state.craftBusy) {
    setCraftStatus("汰换执行中，请稍后再试", true);
    return false;
  }
  if (state.refreshing) {
    setCraftStatus("库存刷新中，请稍后再试", true);
    return false;
  }
  const materials = normalizeCraftAssistMaterialsForRun();
  if (!materials.length) {
    setCraftStatus("请先添加父类材料并设置数量", true);
    return false;
  }
  const mode = craftAssistTargetCountFromMaterials(materials);
  const totalCount = materials.reduce((sum, item) => sum + Number(item.count || 0), 0);
  if (totalCount > mode) {
    setCraftStatus(`材料数量之和不能超过 ${mode}，当前 ${totalCount}`, true);
    return false;
  }
  const targetValue = parseOptionalWear01(state.craftAssistTargetWear);
  if (targetValue == null) {
    setCraftStatus("请先输入目标相对磨损", true);
    return false;
  }
  const candidateRows = getCraftCandidates();
  if (!candidateRows.length) {
    setCraftStatus("主库存无可选炼金物品", true);
    return false;
  }
  const pendingCount = getCraftQueuePendingCount();
  if (pendingCount >= 50) {
    setCraftStatus("配方预览最多 50 组配方", true);
    return false;
  }

  // 每次点击只新增并填充 1 组配方，不覆盖当前编辑中的配方。
  const created = createEmptyCraftRecipeEntry({activate: false});
  if (!created) {
    setCraftStatus("当前无可编辑配方槽位", true);
    return false;
  }
  const createdId = String(created.id || "").trim();
  const removeCreatedEntry = () => {
    state.craftRecipeQueue = (Array.isArray(state.craftRecipeQueue) ? state.craftRecipeQueue : [])
      .filter((entry) => String(entry && entry.id || "").trim() !== createdId);
  };

  const pendingEntries = getCraftQueuePendingEntries();
  const pendingOrder = new Map();
  for (let i = 0; i < pendingEntries.length; i += 1) {
    const entry = pendingEntries[i];
    const key = String(entry && entry.id || "").trim();
    if (!key) continue;
    pendingOrder.set(key, i + 1);
  }
  const recipeNo = pendingOrder.get(createdId) || pendingEntries.length;
  const activeRecipeId = String(state.craftActiveRecipeId || "").trim();
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

  const rowsByName = buildCraftAssistRowsByName(candidateRows);
  const run = runCraftAssistSelectionForRecipe({
    materials,
    rowsByName,
    blockedIds,
    targetValue
  });
  if (!run.ok) {
    removeCreatedEntry();
    setCraftStatus(`配方#${recipeNo}：${run.message}`, true);
    renderCraftPage();
    return false;
  }

  created.item_ids = normalizeCraftRecipeItemIds(run.itemIds);
  const rowsById = buildRowsByAssetId(candidateRows);
  const selectedRows = created.item_ids.map((id) => rowsById.get(id)).filter(Boolean);
  const recipeInfo = getTradeUpRecipeFromRows(selectedRows);
  const sourceText = String(sourcePresetName || "").trim();
  const sourceSuffix = sourceText ? `（${sourceText}）` : "";
  state.craftStatusText = "";
  if (!recipeInfo.ok) {
    setCraftStatus(`辅助选材完成${sourceSuffix}：已新增配方#${recipeNo}，但不满足炼金规则：${recipeInfo.reason || "请调整材料"}`, true);
    renderCraftPage();
    return false;
  }

  const raritySuffix = Number(run && run.rarity || 0) > 0 ? `，稀有度 ${craftRarityLabel(run.rarity)}` : "";
  setCraftStatus(`辅助选材完成${sourceSuffix}：已新增配方#${recipeNo}，${created.item_ids.length}/${mode}${raritySuffix}，均值 ${numberTextTrunc(run.overall, WEAR_INPUT_DECIMALS)} < 目标 ${numberTextTrunc(targetValue, WEAR_INPUT_DECIMALS)}`);
  renderCraftPage();
  return true;
}
function applyCraftAssistAutoSelectionBatch({sourcePresetName = "", repeatCount = 1} = {}) {
  const total = normalizeCraftAssistApplyCount(repeatCount, 1);
  let successCount = 0;
  for (let i = 0; i < total; i += 1) {
    const ok = applyCraftAssistAutoSelection({sourcePresetName});
    if (!ok) break;
    successCount += 1;
  }
  if (successCount <= 0) return false;
  if (successCount < total) {
    const current = String(state.craftStatusText || "").trim();
    setCraftStatus(`批量完成 ${successCount}/${total} 组。${current || "已到可用上限"}`, successCount < total);
  } else if (total > 1) {
    setCraftStatus(`批量完成 ${successCount}/${total} 组配方`);
  }
  renderCraftPage();
  return true;
}
function renderCraftAssistPanel() {
  if (!ui.craftAssistPanel || !ui.craftAssistOverlay) return;
  const open = !!state.craftAssistOpen;
  const editingPreset = isCraftAssistPresetEditing();
  ui.craftAssistOverlay.classList.toggle("hidden", !open);
  if (ui.craftAssistToggleBtn) {
    ui.craftAssistToggleBtn.classList.toggle("active", open);
    ui.craftAssistToggleBtn.setAttribute("aria-pressed", open ? "true" : "false");
  }
  if (!open) return;
  applyCraftAssistOverlayHeight();

  if (ui.craftAssistTargetWear) {
    ui.craftAssistTargetWear.placeholder = "0.000000";
  }
  if (ui.craftAssistTargetWear && document.activeElement !== ui.craftAssistTargetWear) {
    const targetWear = parseOptionalWear01(state.craftAssistTargetWear);
    ui.craftAssistTargetWear.value = targetWear == null ? "" : wearText6(targetWear);
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
    ui.craftAssistApplyBtn.disabled = state.refreshing || state.craftBusy;
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
}
function renderCraftQueue() {
  if (!ui.craftQueueList) return;
  const prevScrollTop = Math.max(0, Number(ui.craftQueueList.scrollTop || 0) || 0);
  ui.craftQueueList.replaceChildren();
  const list = Array.isArray(state.craftRecipeQueue) ? state.craftRecipeQueue : [];
  const rowsById = buildRowsByAssetId(state.rows);
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "暂无配方，点击“添加配方”创建";
    ui.craftQueueList.append(empty);
    ui.craftQueueList.scrollTop = 0;
    return;
  }

  let pendingIndex = 0;
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    const done = String(entry && entry.status || "").trim() === "done";
    const itemIds = normalizeCraftRecipeItemIds(entry && entry.item_ids);
    if (!done) {
      pendingIndex += 1;
      const entryId = String(entry && entry.id || "").trim();
      const recipeRows = itemIds.map((id) => rowsById.get(id)).filter(Boolean);
      const title = `#${pendingIndex} | 平均相对磨损 ${averageRelativeWearText(recipeRows)}`;
      const isActive = entryId && entryId === String(state.craftActiveRecipeId || "").trim();
      ui.craftQueueList.append(
        renderCraftQueueSlots({
          title,
          itemIds,
          rowsById,
          active: isActive,
          selectable: true,
          onActivate: () => {
            const currentActiveId = String(state.craftActiveRecipeId || "").trim();
            if (!entryId || currentActiveId === entryId) return;
            setActiveCraftRecipe(entryId);
            state.craftStatusText = "";
            renderCraftPage();
          },
          removable: true,
          onRemoveItem: (assetId) => {
            entry.item_ids = normalizeCraftRecipeItemIds(entry.item_ids).filter((id) => id !== String(assetId || "").trim());
            if (isActive) syncCraftSelectedIdsFromActiveRecipe();
            state.craftStatusText = "";
            renderCraftPage();
          },
          onRemove: () => {
            state.craftRecipeQueue = state.craftRecipeQueue.filter((x) => x.id !== entry.id);
            if (isActive) state.craftActiveRecipeId = "";
            ensureActiveCraftRecipe({createIfMissing: false});
            syncCraftSelectedIdsFromActiveRecipe();
            state.craftStatusText = "";
            renderCraftPage();
          }
        })
      );
      continue;
    }

    const doneRow = document.createElement("div");
    doneRow.className = "craft-queue-item done";
    const resultWrap = document.createElement("div");
    resultWrap.className = "craft-queue-result";
    const gainedIds = normalizeCraftRecipeItemIds(entry && entry.gained_ids);
    const names = [];
    const wears = [];
    for (const id of gainedIds) {
      const row = rowsById.get(id);
      if (!row) continue;
      names.push(itemDisplayName(row));
      wears.push(absoluteWearLabel(row, {prefix: false}));
    }
    const resultTitle = document.createElement("div");
    resultTitle.className = "craft-queue-result-title";
    resultTitle.textContent = names.length ? `产物：${names.join("，")}` : "产物：待确认";
    const wearLine = document.createElement("div");
    wearLine.className = "craft-queue-result-wear";
    wearLine.textContent = `wear: ${wears.length ? wears.join("，") : "-"}`;
    resultWrap.append(resultTitle, wearLine);
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "移除";
    removeBtn.disabled = state.craftBusy;
    removeBtn.onclick = () => {
      state.craftRecipeQueue = state.craftRecipeQueue.filter((x) => x.id !== entry.id);
      state.craftStatusText = "";
      renderCraftPage();
    };
    doneRow.append(resultWrap, removeBtn);
    ui.craftQueueList.append(doneRow);
  }
  const maxScrollTop = Math.max(0, ui.craftQueueList.scrollHeight - ui.craftQueueList.clientHeight);
  ui.craftQueueList.scrollTop = Math.min(prevScrollTop, maxScrollTop);
}
function addCurrentSelectionToCraftQueue() {
  const connected = isCurrentAccountConnected();
  if (!connected) {
    setCraftStatus("请先连接并刷新库存", true);
    return;
  }
  if (state.craftBusy || state.refreshing) return;
  if (getCraftQueuePendingCount() >= 50) {
    setCraftStatus("配方预览最多 50 组配方", true);
    return;
  }
  const created = createEmptyCraftRecipeEntry({activate: true});
  syncCraftSelectedIdsFromActiveRecipe();
  state.craftStatusText = "";
  const pending = getCraftQueuePendingEntries();
  const idx = pending.findIndex((x) => String(x && x.id || "").trim() === String(created && created.id || "").trim());
  setCraftStatus(`已新增配方#${Math.max(0, idx) + 1}，点击左侧物品可填充该配方槽位`);
  renderCraftPage();
}
function clearCraftQueue() {
  if (!state.craftRecipeQueue.length) return;
  if (state.craftBusy) return;
  state.craftRecipeQueue = [];
  state.craftActiveRecipeId = "";
  state.craftSelectedItemIds.clear();
  state.craftStatusText = "";
  setCraftStatus("已清空配方预览");
  renderCraftPage();
}
function renderCraftPage() {
  if (!ui.craftPage) return;
  const connected = isCurrentAccountConnected();
  if (ui.craftConnectText) {
    ui.craftConnectText.textContent = `连接状态：${connected ? "已连接" : "未连接"}`;
    setConnectionStatusTone(ui.craftConnectText, connected);
  }
  const allCraftRows = getMainInventoryCraftableRows();
  syncCraftSettingsControls(allCraftRows);
  setCraftSettingsPanelOpen(state.craftSettingsOpen);
  updateCraftActionLayout();
  if (connected) {
    reconcileCraftQueueWithInventory();
    ensureActiveCraftRecipe({createIfMissing: false});
  } else {
    state.craftActiveRecipeId = "";
    state.craftSelectedItemIds.clear();
  }

  const candidates = getCraftCandidates();
  const selectedRows = getCraftSelectedRows();
  const recipeInfo = getTradeUpRecipeFromRows(selectedRows);
  const queueCount = state.craftRecipeQueue.length;
  const pendingQueueCount = getCraftQueuePendingCount();
  const executableCount = getCraftExecutableEntries().length;

  if (ui.craftSelectedText) ui.craftSelectedText.textContent = `当前槽位：${selectedRows.length}/10，可执行：${executableCount}组`;
  if (ui.craftRecipeText) ui.craftRecipeText.textContent = recipeInfo.text;
  renderCraftQueue();
  if (ui.craftAddRecipeBtn) {
    ui.craftAddRecipeBtn.disabled = !connected || state.refreshing || state.craftBusy || pendingQueueCount >= 50;
  }
  if (ui.craftExecuteQueueBtn) {
    ui.craftExecuteQueueBtn.textContent = state.craftBusy ? "执行中..." : "执行";
    ui.craftExecuteQueueBtn.disabled = !connected || state.refreshing || state.craftBusy || executableCount <= 0;
  }
  if (ui.craftClearQueueBtn) {
    ui.craftClearQueueBtn.disabled = state.craftBusy || queueCount <= 0;
  }
  if (ui.craftAssistToggleBtn) {
    ui.craftAssistToggleBtn.disabled = state.refreshing || state.craftBusy;
  }
  renderCraftAssistPanel();

  if (!state.craftStatusText) {
    if (!connected) setCraftStatus("请先连接并刷新库存");
    else if (!candidates.length) setCraftStatus("主库存中没有符合炼金规则的物品");
    else if (selectedRows.length >= 10 && recipeInfo.ok) setCraftStatus("当前配方已满10件，可执行，或先新增配方继续填充");
    else if (pendingQueueCount > 0) setCraftStatus(`当前有 ${pendingQueueCount} 组配方槽位，点击左侧物品会填充到当前高亮槽位`);
    else if (queueCount > 0) setCraftStatus("本轮产物已回写到预览，可继续添加新配方");
    else if (selectedRows.length !== 10) setCraftStatus("可随时新增配方；点击左侧物品会填充到当前高亮槽位");
    else if (!recipeInfo.ok) setCraftStatus(recipeInfo.reason || "所选物品不满足炼金规则", true);
    else setCraftStatus("已满足炼金条件，可添加配方");
  } else if (ui.craftStatusText && !ui.craftStatusText.classList.contains("error") && recipeInfo.ok && connected && !state.craftBusy) {
    // keep external success message until next change; no-op
  }

  renderCraftGrouped(candidates);
}
async function runCraftTradeUpQueue() {
  const username = String(state.currentAccountUsername || "").trim();
  if (!username || !isCurrentAccountConnected()) {
    setCraftStatus("请先连接并刷新库存", true);
    return;
  }
  reconcileCraftQueueWithInventory();
  const queue = Array.isArray(state.craftRecipeQueue) ? state.craftRecipeQueue : [];
  const pendingIndexes = [];
  const pendingEntries = [];
  for (let i = 0; i < queue.length; i += 1) {
    const entry = queue[i];
    const done = String(entry && entry.status || "").trim() === "done";
    const itemIds = normalizeCraftRecipeItemIds(entry && entry.item_ids);
    if (done || itemIds.length !== 10) {
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
    queue_index: Number(pendingIndexes[idx]),
    item_ids: [...normalizeCraftRecipeItemIds(entry.item_ids)]
  }));
  if (!pendingRecipes.length) {
    setCraftStatus("配方预览为空，请先添加配方", true);
    return;
  }

  let completedCount = 0;
  let currentRecipePos = -1;
  let lastDoneMsg = "";
  state.craftBusy = true;
  setCraftStatus(`正在串行执行 ${pendingRecipes.length} 组配方...`);
  renderCraftPage();
  try {
    for (let i = 0; i < pendingRecipes.length; i += 1) {
      currentRecipePos = i;
      const req = pendingRecipes[i];
      setCraftStatus(`正在串行执行第 ${i + 1}/${pendingRecipes.length} 组配方...`);

      const data = await api("/api/craft/tradeup", {
        method: "POST",
        body: JSON.stringify({
          username,
          allow_cooling: !!state.craftIncludeCooling,
          item_ids: req.item_ids
        })
      });

      const rows = Array.isArray(data.rows) ? data.rows : [];
      const keepSelectedIds = new Set(state.selectedComponentItemIds);
      setRows(
        rows,
        data.component || {summary_map: {}, item_map: {}},
        String(data.snapshot_path || "").trim(),
        {keepSelectedIds}
      );
      if (String(data.fetch_time || "").trim()) {
        state.fetchTime = String(data.fetch_time).trim();
        syncInventoryTop();
      }

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
      syncCraftSelectedIdsFromActiveRecipe();
      completedCount += 1;
      lastDoneMsg = String(data.message || "").trim();
      renderCraftPage();
    }

    state.craftStatusText = "";
    const doneMsg = lastDoneMsg || "汰换成功";
    setCraftStatus(`${doneMsg}，已串行回写${completedCount}组产物`);
    setSummary(doneMsg);
  } catch (err) {
    const payload = err && err.data && typeof err.data === "object" ? err.data : null;
    const currentReq = currentRecipePos >= 0 && currentRecipePos < pendingRecipes.length ? pendingRecipes[currentRecipePos] : null;
    if (payload && Array.isArray(payload.rows)) {
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
    }

    if (payload && payload.partial) {
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
  } finally {
    state.craftBusy = false;
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
  if (state.selectedComponentId && !Object.prototype.hasOwnProperty.call(state.component.summary_map, state.selectedComponentId)) {
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
  ui.componentAvailableHint.textContent = `可用：${freeSlots}`;
  ui.componentAvailableHint.title = `主库存可用槽位 ${freeSlots}/${capacity} | 占槽 ${occupiedSlots}`;
}
function updateComponentHint(visibleCount = null) {
  if (!ui.componentHint) return;
  const count = visibleCount == null ? rowsForComponentScope().length : Math.max(0, Number(visibleCount) || 0);
  const slotEstimate = estimateMainInventoryFreeSlots();
  updateMainInventoryAvailableHint(slotEstimate);
  const selected = selectedComponentId();
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
  const blocked = !connected || state.componentOpBusy || state.refreshing;
  if (ui.componentWithdrawBtn) {
    ui.componentWithdrawBtn.classList.toggle("hidden", !currentComponent);
  }
  ui.componentDepositBtn.disabled = blocked;
  ui.componentWithdrawBtn.disabled = blocked;
  if (blocked) {
    ui.componentDepositBtn.title = connected ? "处理中，请稍候" : "请先连接并刷新库存";
    ui.componentWithdrawBtn.title = connected ? "处理中，请稍候" : "请先连接并刷新库存";
    return;
  }
  ui.componentDepositBtn.title = !selectedRows.length
    ? "请先在列表选择要存入的物品"
    : (!hasTargetComponent ? "暂无可用目标组件" : "存入组件");
  ui.componentWithdrawBtn.title = !currentComponent
    ? "请先选择组件"
    : "取出选中（优先低磨损）";
}
function applyFilter() {
  const keyword = String(state.searchText || "").trim().toLowerCase();
  const allRows = rowsForComponentScope();
  const selected = selectedComponentId();
  if (selected) {
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
  const wearRows = allRows.filter(itemHasWear);
  const noWearRows = allRows.filter((x) => !itemHasWear(x));
  let rows = wearRows;
  rows = rows.filter((x) => !x.hidden_reason || String(x.casket_id || "").trim());
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
  const componentId = String(componentIdOverride || selectedComponentId()).trim();
  const username = String(state.currentAccountUsername || "").trim();
  if (!componentId) throw new Error("请先选择组件");
  if (!username || !isCurrentAccountConnected()) throw new Error("请先连接并刷新库存");
  state.componentOpBusy = true;
  refreshComponentControls();
  try {
    const path = action === "deposit" ? "/api/component/deposit" : "/api/component/withdraw";
    const data = await api(path, {method: "POST", body: JSON.stringify({username, component_id: componentId, item_ids: itemIds})});
    if (data && data.queue) applyTaskQueueSnapshot(data.queue);
    state.selectedQueueJobId = data && data.job ? String(data.job.job_id || "").trim() : "";
    renderTaskQueueControls();
    setSummary(String(data.message || "任务已加入队列"));
    return data;
  } finally {
    state.componentOpBusy = false;
    refreshComponentControls();
  }
}
async function submitDepositToTarget(targetComponentId) {
  const selectedRows = getSelectedRows();
  if (!selectedRows.length) {
    setSummary("请先在库存列表中选择要存入的物品");
    return false;
  }
  const targetId = String(targetComponentId || "").trim();
  if (!targetId) {
    setSummary("请先选择目标组件");
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
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = itemDisplayName(row);
    const meta = document.createElement("div");
    meta.className = "meta";
    const lines = [];
    lines.push(`Asset: ${itemId || "-"}`);
    if (showSeed) lines.push(`皮肤编号: ${Number(row.paint_index || 0)}  种子: ${Number(row.paint_seed || 0)}`);
    else lines.push(`皮肤编号: ${Number(row.paint_index || 0)}`);
    if (!componentRow) {
      lines.push(`品质/稀有度: ${qualityName(row)}(${Number(row.quality || 0)}) / ${rarityName(row)}(${Number(row.rarity || 0)})`);
    }
    if (itemHasWear(row)) lines.push(`磨损: ${numberTextTrunc(row.float_value, WEAR_INPUT_DECIMALS)}`);
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

  wearGroups.sort((a, b) => {
    const collectionDiff = compareGroupCollection(a, b);
    if (collectionDiff !== 0) return collectionDiff;
    const quantityDiff = compareGroupQuantity(a, b);
    if (quantityDiff !== 0) return quantityDiff;
    const ar = Math.max(...a[1].map((x) => Number(x.rarity || 0)));
    const br = Math.max(...b[1].map((x) => Number(x.rarity || 0)));
    if (ar !== br) return state.raritySort === "desc" ? br - ar : ar - br;
    return a[0].toLowerCase().localeCompare(b[0].toLowerCase());
  });
  noWearGroups.sort((a, b) => {
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
        ? numberTextTrunc(minWear, WEAR_INPUT_DECIMALS)
        : `${numberTextTrunc(minWear, WEAR_INPUT_DECIMALS)}~${numberTextTrunc(maxWear, WEAR_INPUT_DECIMALS)}`;
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
  const headCells = [
    "<th class=\"select-col\"><input type=\"checkbox\" class=\"row-check group-check-all\" title=\"全选/全部取消\" aria-label=\"全选/全部取消\" /></th>",
    "<th><div class=\"th-sort-wrap\"><span>稀有度</span><span class=\"sort-stack\"><button type=\"button\" class=\"arrow-tri up col-sort-btn\" data-sort-key=\"rarity\" data-sort-dir=\"asc\" title=\"稀有度由低到高\" aria-label=\"稀有度由低到高\"></button><button type=\"button\" class=\"arrow-tri down col-sort-btn\" data-sort-key=\"rarity\" data-sort-dir=\"desc\" title=\"稀有度由高到低\" aria-label=\"稀有度由高到低\"></button></span></div></th>",
    "<th>名称</th>",
    "<th><div class=\"th-sort-wrap\"><span>收藏品</span><span class=\"sort-stack\"><button type=\"button\" class=\"arrow-tri up col-sort-btn\" data-sort-key=\"collection\" data-sort-dir=\"asc\" title=\"收藏品按字符升序\" aria-label=\"收藏品按字符升序\"></button><button type=\"button\" class=\"arrow-tri down col-sort-btn\" data-sort-key=\"collection\" data-sort-dir=\"desc\" title=\"收藏品按字符降序\" aria-label=\"收藏品按字符降序\"></button></span></div></th>",
    "<th><div class=\"th-sort-wrap\"><span>数量(可用/冷却中)</span><span class=\"sort-stack\"><button type=\"button\" class=\"arrow-tri up col-sort-btn\" data-sort-key=\"quantity\" data-sort-dir=\"asc\" title=\"数量由低到高\" aria-label=\"数量由低到高\"></button><button type=\"button\" class=\"arrow-tri down col-sort-btn\" data-sort-key=\"quantity\" data-sort-dir=\"desc\" title=\"数量由高到低\" aria-label=\"数量由高到低\"></button></span></div></th>"
  ];
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
      `<td>${row.name}</td>`,
      `<td>${row.collection || ""}</td>`,
      `<td>${parentQuantityText}</td>`
    ];
    if (showSeed) parentCells.push("<td></td>");
    parentCells.push(`<td>${row.wear_range_text || ""}</td>`);
    if (showCoolingTime) parentCells.push(`<td>${parentCooldownText}</td>`);
    parent.innerHTML = parentCells.join("");
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
      const child = document.createElement("tr");
      child.className = `group-child${selectable ? " selectable" : ""}${selected ? " selected" : ""}${showCoolingTime && !componentRow && coolingUnlockTs(item) > 0 ? " cooling" : ""}`;
      const childCells = [
        "<td class=\"select-col\"></td>",
        "<td></td>",
        `<td>Asset ${itemId || "-"}</td>`,
        "<td></td>",
        "<td></td>"
      ];
      if (showSeed) childCells.push(`<td>${Number(item.paint_seed || 0)}</td>`);
      childCells.push(`<td>${itemHasWear(item) ? numberTextTrunc(item.float_value, WEAR_INPUT_DECIMALS) : ""}</td>`);
      if (showCoolingTime) childCells.push(`<td>${componentRow ? "" : cooldownText(item)}</td>`);
      child.innerHTML = childCells.join("");
      if (selectable) {
        child.onclick = (evt) => {
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
  if (state.refreshing) {
    setSummary("库存刷新中，请稍后再断开");
    return;
  }
  const username = String(
    usernameOverride ||
    state.currentAccountUsername ||
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
  if (ui.disconnectBtn) ui.disconnectBtn.disabled = state.refreshing || !isCurrentAccountConnected();
  if (ui.craftDisconnectBtn) ui.craftDisconnectBtn.disabled = state.refreshing || !isCurrentAccountConnected();
  ui.loginSaveBtn.disabled = state.refreshing;
  syncComponentActionState();
  renderSavedAccounts();
  renderCraftPage();
}

async function doRefresh({usernameOverride = "", force = false, silentRateLimit = false, silentInfo = false} = {}) {
  if (state.refreshing) return;
  const username = String(usernameOverride || ui.accountSelect.value || (ui.craftAccountSelect && ui.craftAccountSelect.value) || state.currentAccountUsername || "").trim();
  if (!username) { setSummary("请选用一个账号"); state.emptyHint = "请选用一个账号"; render(); return; }
  state.craftStatusText = "";
  if (!force) {
    const now = Date.now() / 1000, remaining = 10 - (now - state.lastRefreshClickTs);
    if (remaining > 0) { if (!silentRateLimit) setSummary(`刷新过于频繁，请在 ${Math.floor(remaining) + 1}s 后再试`); return; }
    state.lastRefreshClickTs = now;
  }
  const account = accountByUsername(username);
  if (!account) { setSummary(`账号不存在：${username}`); return; }

  try {
    setRefreshBusy(true);
    state.accountSelectedUsername = username;
    state.currentAccountUsername = username;
    startInventoryEventStream(username);
    syncInventoryAccountSelect();
    await persistLastSelected(username);
    if (state.activeAccount !== username) {
      await api("/api/accounts/active", {method: "POST", body: JSON.stringify({username})});
      state.activeAccount = username;
    }
    await disconnectOtherSessionsForTarget(username, {silent: true});
    setRefreshPhase(state.connectedUsername === username ? "连接状态：已连接（刷新中）" : "连接状态：连接中");
    if (!silentInfo) {
      setSummary(state.connectedUsername === username ? "已连接，正在刷新库存..." : "正在建立连接并刷新库存...");
    }

    const data = await api("/api/refresh", {method: "POST", body: JSON.stringify({username, include_hidden: "false"})});
    const result = data.result || {}, rows = Array.isArray(data.rows) ? data.rows : [];
    state.connectedUsername = username;
    state.fetchTime = String(data.fetch_time || "").trim();
    const component = data.component || {summary_map: {}, item_map: {}};
    const snapshotPath = result.snapshot_path || "";
    setRows(rows, component, snapshotPath);
    cacheSnapshotForAccount(username, {
      rows,
      component,
      snapshotPath,
      fetchTime: state.fetchTime,
      connected: true
    });
    clearSnapshotDirty();
    clearRefreshPhase();
    syncInventoryTop();
    await loadComponentTaskQueue();
    if (!silentInfo) {
      setSummary(`${String(result.message || "刷新成功")}，共 ${rows.length} 条`);
    }
  } catch (err) {
    if (state.connectedUsername === username) state.connectedUsername = "";
    clearRefreshPhase();
    syncInventoryTop();
    setSummary(`刷新失败：${err.message}`);
  } finally {
    setRefreshBusy(false);
  }
}

function bindEvents() {
  window.addEventListener("beforeunload", () => {
    stopInventoryEventStream();
    closeTargetComponentDrawer();
    closeRemarkModal(null);
  });
  window.addEventListener("resize", () => {
    placeFilterDrawer();
    applyCraftLayoutWidth();
    if (ui.targetComponentDrawer && !ui.targetComponentDrawer.classList.contains("hidden")) {
      const rect = ui.targetComponentDrawer.getBoundingClientRect();
      setTargetDrawerPosition(rect.left, rect.top);
    }
    scheduleLazyLoadCheck();
  });
  window.addEventListener("scroll", () => {
    placeFilterDrawer();
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
  const confirmCraftAssistPresetModal = () => {
    const value = String(ui.craftAssistPresetModalInput ? ui.craftAssistPresetModalInput.value : "").trim();
    if (!value) {
      setCraftStatus("请先输入配置名称", true);
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
  ui.navAccount.onclick = () => showPage("accountPage");
  ui.navInventory.onclick = () => showPage("inventoryPage");
  ui.navCraft.onclick = () => showPage("craftPage");

  ui.loginSaveBtn.onclick = loginAndSave;
  ui.clearAccountBtn.onclick = clearAccountForm;
  bindAccountTotpNormalization();

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

  ui.refreshBtn.onclick = () => doRefresh({force: false});
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
    ui.craftRefreshBtn.onclick = () => doRefresh({
      force: false,
      usernameOverride: String((ui.craftAccountSelect && ui.craftAccountSelect.value) || "").trim()
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
    if (!isCurrentAccountConnected()) {
      setSummary("请先连接并刷新库存");
      return;
    }
    openTargetComponentDrawer({excludeId: selectedComponentId()});
  };
  ui.componentWithdrawBtn.onclick = async () => {
    if (!isCurrentAccountConnected()) {
      setSummary("请先连接并刷新库存");
      return;
    }
    const currentComponentId = selectedComponentId();
    if (!currentComponentId) {
      setSummary("请先选择组件");
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
  const applyCraftIncludeCooling = (checked) => {
    state.craftIncludeCooling = !!checked;
    saveCraftUiPrefs();
    state.craftStatusText = "";
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
  const applyCraftAssistWearOffsetPct = (inputNode) => {
    if (!inputNode) return;
    const nextValue = normalizeCraftAssistWearOffsetPct(inputNode.value, state.craftAssistWearOffsetPct);
    state.craftAssistWearOffsetPct = nextValue;
    inputNode.value = craftAssistWearOffsetPctText(nextValue);
    saveCraftUiPrefs();
    syncCraftSettingsControls();
  };
  if (ui.craftAssistWearOffsetPct) {
    ui.craftAssistWearOffsetPct.onfocus = () => {
      ui.craftAssistWearOffsetPct.select();
    };
    ui.craftAssistWearOffsetPct.oninput = () => {
      state.craftAssistWearOffsetPct = normalizeCraftAssistWearOffsetPct(
        ui.craftAssistWearOffsetPct.value,
        state.craftAssistWearOffsetPct
      );
    };
    ui.craftAssistWearOffsetPct.onchange = () => {
      applyCraftAssistWearOffsetPct(ui.craftAssistWearOffsetPct);
    };
    ui.craftAssistWearOffsetPct.onblur = () => {
      applyCraftAssistWearOffsetPct(ui.craftAssistWearOffsetPct);
    };
    ui.craftAssistWearOffsetPct.onkeydown = (evt) => {
      if (evt.key !== "Enter") return;
      evt.preventDefault();
      applyCraftAssistWearOffsetPct(ui.craftAssistWearOffsetPct);
      ui.craftAssistWearOffsetPct.blur();
    };
  }
  if (ui.componentCraftAssistWearOffsetPct) {
    ui.componentCraftAssistWearOffsetPct.onfocus = () => {
      ui.componentCraftAssistWearOffsetPct.select();
    };
    ui.componentCraftAssistWearOffsetPct.oninput = () => {
      state.craftAssistWearOffsetPct = normalizeCraftAssistWearOffsetPct(
        ui.componentCraftAssistWearOffsetPct.value,
        state.craftAssistWearOffsetPct
      );
    };
    ui.componentCraftAssistWearOffsetPct.onchange = () => {
      applyCraftAssistWearOffsetPct(ui.componentCraftAssistWearOffsetPct);
    };
    ui.componentCraftAssistWearOffsetPct.onblur = () => {
      applyCraftAssistWearOffsetPct(ui.componentCraftAssistWearOffsetPct);
    };
    ui.componentCraftAssistWearOffsetPct.onkeydown = (evt) => {
      if (evt.key !== "Enter") return;
      evt.preventDefault();
      applyCraftAssistWearOffsetPct(ui.componentCraftAssistWearOffsetPct);
      ui.componentCraftAssistWearOffsetPct.blur();
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
  if (ui.craftAssistTargetWear) {
    const commitTargetWear = () => {
      state.craftAssistTargetWear = commitCraftAssistTargetWearInput(ui.craftAssistTargetWear);
      renderCraftAssistPanel();
    };
    ui.craftAssistTargetWear.onfocus = () => {
      seedCraftAssistDecimalInput(ui.craftAssistTargetWear);
    };
    ui.craftAssistTargetWear.oninput = () => {
      delete ui.craftAssistTargetWear.dataset.seeded;
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
      applyCraftAssistAutoSelection();
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
      await runCraftTradeUpQueue();
    };
  }
  if (ui.craftClearQueueBtn) {
    ui.craftClearQueueBtn.onclick = () => {
      clearCraftQueue();
    };
  }
}

async function init() {
  loadCraftUiPrefs();
  await loadCraftAssistPresetsFromStorage();
  bindEvents();
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
  } catch (err) {
    setSummary(`初始化失败：${err.message}`);
    setAccountStatus(`初始化失败：${err.message}`, true);
  }
  showPage("accountPage");
}

init();

