const RARITY_MAP = {1: "Consumer", 2: "Industrial", 3: "Mil-Spec", 4: "Restricted", 5: "Classified", 6: "Covert", 7: "Contraband"};
const QUALITY_MAP = {1: "Genuine", 4: "Normal", 9: "StatTrak", 11: "Souvenir"};
const RARITY_VALUES = Object.keys(RARITY_MAP).map(Number).sort((a, b) => a - b).map((k) => RARITY_MAP[k]);
const STORAGE_UNIT_CAPACITY = 1000;
const STORAGE_UNIT_DEF_INDEX = 1201;

const state = {
  currentPage: "accountPage", accounts: [], activeAccount: "", accountSelectedUsername: "",
  currentAccountUsername: "", connectedUsername: "", rows: [], mode: "grouped", includeHidden: false, searchText: "",
  raritySelected: new Set(), collectionSelected: new Set(), collectionValues: [], collectionMenuKey: "", collectionSourceKey: "",
  wearMin: null, wearMax: null, wearSort: "asc", raritySort: "desc",
  renderInitialSize: 180, renderBatchSize: 240, renderWindowKey: "", renderVisibleCount: 0, renderVisibleTotal: 0,
  craftSelectedItemIds: new Set(), craftBusy: false, craftStatusText: "", craftIncludeCooling: false, craftShowSeed: false, craftSettingsOpen: false, craftRecipeQueue: [], craftRightPanelWidth: 360,
  expandedGroups: new Set(), selectedComponentId: "", showComponentItems: false, selectedComponentItemIds: new Set(), componentOpBusy: false,
  componentTaskQueue: {running: null, queued: []}, selectedQueueJobId: "", componentTaskProgressMap: {},
  targetDrawerOpen: false, targetComponentChoices: [], targetComponentSelectedId: "", targetComponentExcludeId: "",
  component: {summary_map: {}, item_map: {}}, snapshotPath: "", fetchTime: "", refreshing: false,
  refreshPhaseText: "", lastRefreshClickTs: 0, emptyHint: "请选用一个账号", filterPanel: "wear",
  rowsVersion: 0, filterCacheKey: "", filterCacheAllRows: [], filterCacheFilteredRows: [],
  groupCacheKey: "", groupCacheRows: [], lastPersistedSelected: ""
};

const ui = {
  navAccount: document.getElementById("navAccount"), navInventory: document.getElementById("navInventory"), navCraft: document.getElementById("navCraft"),
  accountPage: document.getElementById("accountPage"), inventoryPage: document.getElementById("inventoryPage"), craftPage: document.getElementById("craftPage"),
  accountUsername: document.getElementById("accountUsername"), accountPassword: document.getElementById("accountPassword"), accountTotp: document.getElementById("accountTotp"), accountRemark: document.getElementById("accountRemark"),
  loginSaveBtn: document.getElementById("loginSaveBtn"), clearAccountBtn: document.getElementById("clearAccountBtn"), accountStatus: document.getElementById("accountStatus"), savedAccountsWrap: document.getElementById("savedAccountsWrap"),
  currentAccountText: document.getElementById("currentAccountText"), fetchTimeText: document.getElementById("fetchTimeText"), statusText: document.getElementById("statusText"),
  accountSelect: document.getElementById("accountSelect"), useAccountBtn: document.getElementById("useAccountBtn"), refreshBtn: document.getElementById("refreshBtn"), summaryText: document.getElementById("summaryText"),
  craftTopFetchTimeText: document.getElementById("craftTopFetchTimeText"), craftTopStatusText: document.getElementById("craftTopStatusText"),
  craftAccountSelect: document.getElementById("craftAccountSelect"), craftUseAccountBtn: document.getElementById("craftUseAccountBtn"), craftRefreshBtn: document.getElementById("craftRefreshBtn"),
  modeToggleBtn: document.getElementById("modeToggleBtn"), modeToggleGlyph: document.getElementById("modeToggleGlyph"),
  includeHidden: document.getElementById("includeHidden"), searchInput: document.getElementById("searchInput"), toggleFilterBtn: document.getElementById("toggleFilterBtn"), filterDrawer: document.getElementById("filterDrawer"),
  filterNavWear: document.getElementById("filterNavWear"), filterNavRarity: document.getElementById("filterNavRarity"), filterNavCollection: document.getElementById("filterNavCollection"),
  filterPanelWear: document.getElementById("filterPanelWear"), filterPanelRarity: document.getElementById("filterPanelRarity"), filterPanelCollection: document.getElementById("filterPanelCollection"),
  wearMin: document.getElementById("wearMin"), wearMax: document.getElementById("wearMax"), wearHint: document.getElementById("wearHint"),
  raritySummary: document.getElementById("raritySummary"), rarityMenu: document.getElementById("rarityMenu"), raritySelectAll: document.getElementById("raritySelectAll"), rarityClear: document.getElementById("rarityClear"),
  collectionSummary: document.getElementById("collectionSummary"), collectionMenu: document.getElementById("collectionMenu"), collectionSelectAll: document.getElementById("collectionSelectAll"), collectionClear: document.getElementById("collectionClear"),
  wearSortUp: document.getElementById("wearSortUp"), wearSortDown: document.getElementById("wearSortDown"), raritySortUp: document.getElementById("raritySortUp"), raritySortDown: document.getElementById("raritySortDown"),
  componentPanel: document.getElementById("componentPanel"), componentSelect: document.getElementById("componentSelect"), componentHint: document.getElementById("componentHint"),
  showComponentItemsWrap: document.getElementById("showComponentItemsWrap"), showComponentItems: document.getElementById("showComponentItems"),
  componentDepositBtn: document.getElementById("componentDepositBtn"), componentWithdrawBtn: document.getElementById("componentWithdrawBtn"),
  componentTaskFloat: document.getElementById("componentTaskFloat"), componentTaskQueueList: document.getElementById("componentTaskQueueList"),
  componentTaskCancelBtn: document.getElementById("componentTaskCancelBtn"), componentTaskInfo: document.getElementById("componentTaskInfo"),
  targetComponentDrawer: document.getElementById("targetComponentDrawer"), targetComponentDrawerClose: document.getElementById("targetComponentDrawerClose"),
  targetComponentDrawerHint: document.getElementById("targetComponentDrawerHint"), targetComponentDrawerSelect: document.getElementById("targetComponentDrawerSelect"),
  targetComponentDrawerCancel: document.getElementById("targetComponentDrawerCancel"), targetComponentDrawerConfirm: document.getElementById("targetComponentDrawerConfirm"),
  remarkModal: document.getElementById("remarkModal"), remarkModalTitle: document.getElementById("remarkModalTitle"), remarkModalInput: document.getElementById("remarkModalInput"),
  remarkModalClose: document.getElementById("remarkModalClose"), remarkModalSaveBtn: document.getElementById("remarkModalSaveBtn"), remarkModalCancelBtn: document.getElementById("remarkModalCancelBtn"),
  snapshotPath: document.getElementById("snapshotPath"), listWrap: document.getElementById("listWrap"),
  craftAccountText: document.getElementById("craftAccountText"), craftConnectText: document.getElementById("craftConnectText"),
  craftSelectedText: document.getElementById("craftSelectedText"), craftRecipeText: document.getElementById("craftRecipeText"),
  craftStatusText: document.getElementById("craftStatusText"), craftCoolingHint: document.getElementById("craftCoolingHint"),
  craftSelectionList: document.getElementById("craftSelectionList"), craftSettingsBtn: document.getElementById("craftSettingsBtn"),
  craftSettingsPanel: document.getElementById("craftSettingsPanel"), craftIncludeCooling: document.getElementById("craftIncludeCooling"), craftShowSeed: document.getElementById("craftShowSeed"),
  craftAddRecipeBtn: document.getElementById("craftAddRecipeBtn"), craftExecuteQueueBtn: document.getElementById("craftExecuteQueueBtn"),
  craftClearQueueBtn: document.getElementById("craftClearQueueBtn"), craftQueueList: document.getElementById("craftQueueList"),
  craftLayout: document.getElementById("craftLayout"), craftSplitBar: document.getElementById("craftSplitBar"), craftRightPanel: document.getElementById("craftRightPanel")
};

let searchTimer = null;
let inventoryEventSource = null;
let inventoryEventUsername = "";
let remarkModalResolver = null;
let remarkModalAccount = "";
let targetDrawerDrag = {active: false, offsetX: 0, offsetY: 0};
let craftSplitDrag = {active: false, startX: 0, startWidth: 360};
let lazyLoadTickPending = false;
let lazyLoadAutoFillPending = false;
const CRAFT_UI_PREFS_KEY = "craft_ui_prefs_v2";

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
}

function updateCraftActionLayout() {
  if (!ui.craftRightPanel) return;
  const width = Number(ui.craftRightPanel.clientWidth || 0);
  ui.craftRightPanel.classList.toggle("compact-actions", width > 0 && width < 390);
}

function saveCraftUiPrefs() {
  try {
    localStorage.setItem(
      CRAFT_UI_PREFS_KEY,
      JSON.stringify({
        craft_include_cooling: !!state.craftIncludeCooling,
        craft_show_seed: !!state.craftShowSeed,
        craft_right_width: Number(state.craftRightPanelWidth) || 360
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
    if (Number.isFinite(Number(prefs.craft_right_width))) state.craftRightPanelWidth = Number(prefs.craft_right_width);
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
  const initValue = String(currentRemark || account).trim() || account;
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
    try {
      await loadSnapshotForAccount(eventUsername);
      await loadComponentTaskQueue();
    } catch (_) {
      // ignore snapshot refresh errors in SSE path
    }
    if (doneMessage) {
      setSummary(doneMessage);
      return;
    }
    const tail = firstFailedReason ? `，首个失败 ${firstFailedItem || "-"}: ${firstFailedReason}` : "";
    setSummary(`组件${action}完成：${requested}件（成功${success}，失败${failed}）${tail}`);
  });

  stream.addEventListener("component_move_failed", async (evt) => {
    const data = parseEventData(evt.data);
    const eventUsername = String(data.username || data.account || "").trim();
    if (!eventUsername || eventUsername !== state.currentAccountUsername) return;
    const jobId = String(data.job_id || "").trim();
    if (jobId) delete state.componentTaskProgressMap[jobId];
    const action = String(data.action || "").trim() === "withdraw" ? "取出" : "存入";
    const msg = String(data.message || "未知错误");
    try {
      await loadComponentTaskQueue();
    } catch (_) {
      // ignore queue refresh errors
    }
    setSummary(`组件${action}失败：${msg}`);
  });

  stream.onerror = () => {
    // EventSource has built-in reconnect, keep silent.
  };
}

function setSummary(text) { ui.summaryText.textContent = String(text || ""); }
function setAccountStatus(text, isError = false) { ui.accountStatus.textContent = String(text || ""); ui.accountStatus.classList.toggle("error", !!isError); }
function setRefreshPhase(text) { state.refreshPhaseText = String(text || "").trim(); syncInventoryTop(); }
function clearRefreshPhase() { state.refreshPhaseText = ""; syncInventoryTop(); }
const selectedAccount = () => state.accounts.find((x) => x.username === String(state.accountSelectedUsername || "").trim()) || null;
const accountByUsername = (username) => state.accounts.find((x) => x.username === String(username || "").trim()) || null;
function displayAccountName(row) {
  if (!row) return "";
  const username = String(row.username || "").trim();
  const remark = String(row.remark || "").trim();
  if (!remark || remark === username) return username;
  return `${remark}（${username}）`;
}
function optionAccountLabel(row) {
  return displayAccountName(row);
}
const isCurrentAccountConnected = () => {
  const current = String(state.currentAccountUsername || "").trim();
  if (!current) return false;
  return String(state.connectedUsername || "").trim() === current;
};

function syncUseAccountButtonState() {
  const hasAccount = state.accounts.length > 0;
  const active = String(state.activeAccount || "").trim();
  const applyButton = (btn, selectEl) => {
    if (!btn) return;
    const selected = String((selectEl && selectEl.value) || state.accountSelectedUsername || "").trim();
    const isActive = Boolean(selected) && selected === active;
    btn.textContent = isActive ? "当前账号" : "设为当前";
    btn.disabled = !hasAccount || state.refreshing || !selected || isActive;
  };
  applyButton(ui.useAccountBtn, ui.accountSelect);
  applyButton(ui.craftUseAccountBtn, ui.craftAccountSelect);
}

function syncInventoryTop() {
  const applyTop = (fetchEl, statusEl, refreshBtn) => {
    if (!fetchEl || !statusEl || !refreshBtn) return;
    if (!state.currentAccountUsername) {
      fetchEl.textContent = "库存获取时间：-";
      statusEl.textContent = "连接状态：未连接";
      refreshBtn.textContent = "连接并刷新库存信息";
      return;
    }
    fetchEl.textContent = `库存获取时间：${state.fetchTime || "-"}`;
    if (state.refreshPhaseText) statusEl.textContent = state.refreshPhaseText;
    else if (isCurrentAccountConnected()) statusEl.textContent = "连接状态：已连接";
    else statusEl.textContent = "连接状态：未连接";
    refreshBtn.textContent = isCurrentAccountConnected() ? "刷新库存信息" : "连接并刷新库存信息";
  };

  if (!state.currentAccountUsername) {
    if (ui.currentAccountText) ui.currentAccountText.textContent = "当前账号：未选择";
    applyTop(ui.fetchTimeText, ui.statusText, ui.refreshBtn);
    applyTop(ui.craftTopFetchTimeText, ui.craftTopStatusText, ui.craftRefreshBtn);
    return;
  }
  const current = accountByUsername(state.currentAccountUsername);
  if (ui.currentAccountText) ui.currentAccountText.textContent = `当前账号：${displayAccountName(current) || state.currentAccountUsername}`;
  applyTop(ui.fetchTimeText, ui.statusText, ui.refreshBtn);
  applyTop(ui.craftTopFetchTimeText, ui.craftTopStatusText, ui.craftRefreshBtn);
}

function setAccountForm({username = "", password = "", totp = "", remark = ""} = {}) {
  ui.accountUsername.value = username;
  ui.accountPassword.value = password;
  ui.accountTotp.value = totp;
  ui.accountRemark.value = remark;
}

function syncAccountFormBySelection() {
  const row = selectedAccount();
  if (!row) return;
  setAccountForm({username: row.username, password: row.password || "", totp: "", remark: row.remark || row.username});
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
  syncUseAccountButtonState();
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
    const active = row.username === state.activeAccount;
    const selected = row.username === state.accountSelectedUsername;
    const card = document.createElement("div");
    card.className = `account-card${active ? " active" : ""}${selected ? " selected" : ""}`;
    const header = document.createElement("div");
    header.className = "account-card-header";
    const title = document.createElement("div");
    title.className = "account-card-title";
    title.textContent = `${row.remark || row.username}${active ? "（当前）" : ""}`;
    const actions = document.createElement("div");
    actions.className = "account-card-actions";

    const useBtn = document.createElement("button");
    useBtn.textContent = active ? "使用中" : "使用该账号";
    useBtn.disabled = active || state.refreshing;
    useBtn.onclick = async (e) => { e.stopPropagation(); await useAccount(row.username); };

    const remarkBtn = document.createElement("button");
    remarkBtn.textContent = "修改备注";
    remarkBtn.disabled = state.refreshing;
    remarkBtn.onclick = async (e) => {
      e.stopPropagation();
      const next = await openRemarkModal(row.username, row.remark || row.username);
      if (next === null) return;
      const remark = String(next || "").trim() || row.username;
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

    actions.append(useBtn, remarkBtn, delBtn);
    header.append(title, actions);
    const sub = document.createElement("div");
    sub.className = "account-card-sub";
    sub.textContent = row.username;
    card.onclick = () => {
      state.accountSelectedUsername = row.username;
      syncInventoryAccountSelect();
      syncAccountFormBySelection();
      setAccountStatus(`已选中账号：${row.remark || row.username}（${row.username}）`);
      renderSavedAccounts();
    };
    card.append(header, sub);
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
    state.includeHidden ? 1 : 0,
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
  const key = `${filterKey}|${state.wearSort}|${state.raritySort}|${makeRowsStamp(filteredRows)}`;
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
  ui.snapshotPath.textContent = state.snapshotPath ? `快照：${state.snapshotPath}` : "快照：未选择";
  refreshComponentControls();
  refreshCollectionMenu(rowsForComponentScope(), {force: true, sourceKey: makeCollectionSourceKey()});
  render();
  renderCraftPage();
}

async function loadSnapshotForAccount(username) {
  const key = String(username || "").trim();
  if (!key) return false;
  const data = await api(`/api/snapshot/account?username=${encodeURIComponent(key)}`);
  const rows = Array.isArray(data.rows) ? data.rows : [];
  state.currentAccountUsername = key;
  if (data.connected === true) state.connectedUsername = key;
  else if (state.connectedUsername === key) state.connectedUsername = "";
  state.fetchTime = String(data.fetch_time || "").trim();
  setRows(rows, data.component || {summary_map: {}, item_map: {}}, data.snapshot && data.snapshot.path ? data.snapshot.path : "");
  syncInventoryTop();
  if (rows.length) setSummary(`已显示该账号上次库存，共 ${rows.length} 条`);
  else { state.emptyHint = "当前账号未连接"; setSummary("当前账号未连接（暂无上次库存信息）"); }
  return true;
}

async function switchAccountView(username) {
  const key = String(username || "").trim();
  if (!key) return;
  state.craftSelectedItemIds.clear();
  state.craftBusy = false;
  state.craftStatusText = "";
  state.craftRecipeQueue = [];
  state.craftSettingsOpen = false;
  state.accountSelectedUsername = key;
  syncInventoryAccountSelect();
  renderSavedAccounts();
  await persistLastSelected(key);
  await loadSnapshotForAccount(key);
  startInventoryEventStream(key);
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
    setAccountStatus(`已设为当前账号：${info ? info.remark || key : key}（${key}）`);
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
    await loadAccounts();
    if (state.accounts.length) await switchAccountView(state.accountSelectedUsername || state.accounts[0].username);
    else setNoAccountState();
    setAccountStatus(`已删除账号：${row.remark || row.username}（${row.username}）`);
  } catch (err) {
    setAccountStatus(`删除失败：${err.message}`, true);
  }
}

async function loginAndSave() {
  const username = String(ui.accountUsername.value || "").trim();
  const password = String(ui.accountPassword.value || "").trim();
  const totp = String(ui.accountTotp.value || "").trim();
  const remark = String(ui.accountRemark.value || "").trim() || username;
  if (!username) { setAccountStatus("请输入 Steam 账号", true); return; }
  if (!password) { setAccountStatus("请输入密码", true); return; }
  if (!totp) { setAccountStatus("请输入令牌码", true); return; }

  try {
    ui.loginSaveBtn.disabled = true;
    setAccountStatus("正在登录并获取 token，请稍候...");
    const data = await api("/api/accounts/login-save", {method: "POST", body: JSON.stringify({username, password, totp, remark})});
    ui.accountTotp.value = "";
    await loadAccounts({preferUsername: username});
    await switchAccountView(username);
    setAccountStatus(data.message || "登录成功，已保存账号");
  } catch (err) {
    setAccountStatus(`登录失败：${err.message}`, true);
  } finally {
    ui.loginSaveBtn.disabled = false;
  }
}

function clearAccountForm() {
  state.accountSelectedUsername = "";
  setAccountForm({username: "", password: "", totp: "", remark: ""});
  setAccountStatus("输入已清空");
  renderSavedAccounts();
}

function setNoAccountState() {
  stopInventoryEventStream();
  closeTargetComponentDrawer();
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
  state.craftSettingsOpen = false;
  state.emptyHint = "请选用一个账号";
  ui.showComponentItems.checked = false;
  setRows([], {summary_map: {}, item_map: {}}, "");
  renderTaskQueueControls();
  syncInventoryTop();
  setSummary("请选用一个账号");
}

function qualityName(row) { const v = String(row.quality_name || "").trim(); if (v) return v; const id = Number(row.quality || 0); return QUALITY_MAP[id] || `Unknown(${id})`; }
function rarityName(row) { const e = String(row.alchemy_rarity || "").trim(); if (e) return e; const r = String(row.rarity_name || "").trim(); if (r) return r; const id = Number(row.rarity || 0); return RARITY_MAP[id] || `Unknown(${id})`; }
const collectionName = (row) => String(row.collection || "").trim();
const itemDisplayName = (row) => String(row.alchemy_name || "").trim() || String(row.name || "").trim();
const itemSearchText = (row) => [row.name, row.market_hash_name, row.alchemy_name, row.collection, row.collection_en].map((x) => String(x || "").toLowerCase()).join(" ").trim();
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
  for (const entry of Array.isArray(state.craftRecipeQueue) ? state.craftRecipeQueue : []) {
    for (const id of Array.isArray(entry && entry.item_ids) ? entry.item_ids : []) {
      const key = String(id || "").trim();
      if (key) out.add(key);
    }
  }
  return out;
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
function syncCraftSelection(candidates) {
  const queuedIds = getQueuedCraftItemIds();
  const validIds = new Set(
    (Array.isArray(candidates) ? candidates : [])
      .map((x) => rowAssetId(x))
      .filter((id) => id && !queuedIds.has(id))
  );
  for (const id of [...state.craftSelectedItemIds]) {
    if (!validIds.has(id)) state.craftSelectedItemIds.delete(id);
  }
}
function getCraftSelectedRows(candidates) {
  syncCraftSelection(candidates);
  return (Array.isArray(candidates) ? candidates : []).filter((row) => state.craftSelectedItemIds.has(rowAssetId(row)));
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
function toggleCraftItemSelection(itemId) {
  const key = String(itemId || "").trim();
  if (!key) return;
  const queuedIds = getQueuedCraftItemIds();
  if (queuedIds.has(key)) {
    setCraftStatus("该物品已在配方预览中，不能重复选择", true);
    return;
  }
  if (state.craftSelectedItemIds.has(key)) {
    state.craftSelectedItemIds.delete(key);
    state.craftStatusText = "";
    return;
  }
  if (state.craftSelectedItemIds.size >= 10) {
    setCraftStatus("最多选择 10 件物品", true);
    return;
  }
  state.craftSelectedItemIds.add(key);
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
    "<th>收藏品</th>",
    `<th>${quantityTitle}</th>`
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
      if ((key !== "wear" && key !== "rarity") || (dir !== "asc" && dir !== "desc")) return;
      if (key === "wear") state.wearSort = dir;
      else state.raritySort = dir;
      renderCraftPage();
    };
  }

  const tbody = document.createElement("tbody");
  for (const row of groupedRows) {
    const groupKey = `craft::${row.name}`;
    const expanded = state.expandedGroups.has(groupKey);
    const selectableRows = row.child_rows.filter((x) => !isComponentRow(x) && !queuedIds.has(rowAssetId(x)));
    const groupIds = [...new Set(selectableRows.map((x) => rowAssetId(x)).filter(Boolean))];
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
      if (!groupIds.length) {
        if (row.child_rows.some((x) => queuedIds.has(rowAssetId(x)))) {
          setCraftStatus("该组物品已在配方预览中，不能重复选择", true);
        }
        return;
      }
      if (groupIds.length === 1) {
        toggleCraftItemSelection(groupIds[0]);
        renderCraftPage();
        return;
      }
      if (expanded) state.expandedGroups.delete(groupKey);
      else state.expandedGroups.add(groupKey);
      renderCraftPage();
    };
    tbody.append(parent);
    if (!expanded) continue;
    for (const item of row.child_rows) {
      const itemId = rowAssetId(item);
      const componentRow = isComponentRow(item);
      const locked = queuedIds.has(itemId);
      const selectable = !componentRow && !locked;
      const selected = selectable && state.craftSelectedItemIds.has(itemId);
      const child = document.createElement("tr");
      child.className = `group-child${selectable ? " selectable" : ""}${selected ? " selected" : ""}${locked ? " locked" : ""}${!componentRow && coolingUnlockTs(item) > 0 ? " cooling" : ""}`;
      const childCells = [
        "<td></td>",
        `<td>Asset ${itemId || "-"}</td>`,
        "<td></td>",
        "<td></td>"
      ];
      if (showSeed) childCells.push(`<td>${Number(item.paint_seed || 0)}</td>`);
      childCells.push(`<td>${itemHasWear(item) ? Number(item.float_value || 0).toFixed(6) : ""}</td>`);
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
  if (!ui.craftStatusText) return;
  ui.craftStatusText.textContent = state.craftStatusText || "请在下方选择 10 件符合炼金规则的主库存物品";
  ui.craftStatusText.classList.toggle("error", !!isError);
}
function setCraftSettingsPanelOpen(open) {
  state.craftSettingsOpen = !!open;
  if (ui.craftSettingsPanel) ui.craftSettingsPanel.classList.toggle("hidden", !state.craftSettingsOpen);
  if (ui.craftSettingsBtn) ui.craftSettingsBtn.classList.toggle("active", state.craftSettingsOpen);
}
function renderCraftQueue() {
  if (!ui.craftQueueList) return;
  ui.craftQueueList.replaceChildren();
  const list = Array.isArray(state.craftRecipeQueue) ? state.craftRecipeQueue : [];
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "配方预览为空";
    ui.craftQueueList.append(empty);
    return;
  }
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    const row = document.createElement("div");
    row.className = "craft-queue-item";
    const text = document.createElement("div");
    text.className = "craft-queue-text";
    text.textContent = `#${i + 1} ${entry.recipe_text}（${entry.item_ids.length}件）`;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "移除";
    removeBtn.disabled = state.craftBusy;
    removeBtn.onclick = () => {
      state.craftRecipeQueue = state.craftRecipeQueue.filter((x) => x.id !== entry.id);
      state.craftStatusText = "";
      renderCraftPage();
    };
    row.append(text, removeBtn);
    ui.craftQueueList.append(row);
  }
}
function addCurrentSelectionToCraftQueue() {
  const connected = isCurrentAccountConnected();
  if (!connected) {
    setCraftStatus("请先连接并刷新库存", true);
    return;
  }
  if (state.craftBusy || state.refreshing) return;
  if (state.craftRecipeQueue.length >= 50) {
    setCraftStatus("配方预览最多 50 组配方", true);
    return;
  }
  const candidates = getCraftCandidates();
  const selectedRows = getCraftSelectedRows(candidates);
  const recipeInfo = getTradeUpRecipeFromRows(selectedRows);
  if (!recipeInfo.ok) {
    setCraftStatus(recipeInfo.reason || "所选物品不满足炼金规则", true);
    return;
  }
  const itemIds = selectedRows.map((x) => rowAssetId(x)).filter(Boolean);
  if (itemIds.length !== 10) {
    setCraftStatus(`需选择 10 件，当前 ${itemIds.length} 件`, true);
    return;
  }
  const queuedIds = getQueuedCraftItemIds();
  const duplicate = itemIds.find((id) => queuedIds.has(id));
  if (duplicate) {
    setCraftStatus(`存在重复物品：${duplicate}`, true);
    return;
  }
  const queueItem = {
    id: `craftq_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    item_ids: itemIds,
    recipe: recipeInfo.recipe,
    recipe_text: String(recipeInfo.text || "").replace(/^配方：/, "").trim() || `recipe ${recipeInfo.recipe}`
  };
  state.craftRecipeQueue.push(queueItem);
  state.craftSelectedItemIds.clear();
  state.craftStatusText = "";
  setCraftStatus(`已添加配方：${queueItem.recipe_text}`);
  renderCraftPage();
}
function clearCraftQueue() {
  if (!state.craftRecipeQueue.length) return;
  if (state.craftBusy) return;
  state.craftRecipeQueue = [];
  state.craftStatusText = "";
  setCraftStatus("已清空配方预览");
  renderCraftPage();
}
function renderCraftPage() {
  if (!ui.craftPage) return;
  const username = String(state.currentAccountUsername || "").trim();
  const connected = isCurrentAccountConnected();
  const account = accountByUsername(username);
  if (ui.craftAccountText) ui.craftAccountText.textContent = `账号：${displayAccountName(account) || username || "-"}`;
  if (ui.craftConnectText) ui.craftConnectText.textContent = `连接状态：${connected ? "已连接" : "未连接"}`;
  if (ui.craftIncludeCooling) ui.craftIncludeCooling.checked = !!state.craftIncludeCooling;
  if (ui.craftShowSeed) ui.craftShowSeed.checked = !!state.craftShowSeed;
  setCraftSettingsPanelOpen(state.craftSettingsOpen);
  updateCraftActionLayout();

  const allCraftRows = getMainInventoryCraftableRows();
  if (ui.craftCoolingHint) ui.craftCoolingHint.textContent = getCraftCoolingHintText(allCraftRows);
  const candidates = getCraftCandidates();
  const selectedRows = getCraftSelectedRows(candidates);
  const recipeInfo = getTradeUpRecipeFromRows(selectedRows);
  const queueCount = state.craftRecipeQueue.length;

  if (ui.craftSelectedText) ui.craftSelectedText.textContent = `待添加：${selectedRows.length}/10，配方预览：${queueCount}组`;
  if (ui.craftRecipeText) ui.craftRecipeText.textContent = recipeInfo.text;
  renderCraftQueue();
  if (ui.craftAddRecipeBtn) {
    ui.craftAddRecipeBtn.disabled = !connected || state.refreshing || state.craftBusy || !recipeInfo.ok;
  }
  if (ui.craftExecuteQueueBtn) {
    ui.craftExecuteQueueBtn.textContent = state.craftBusy ? "执行中..." : "执行";
    ui.craftExecuteQueueBtn.disabled = !connected || state.refreshing || state.craftBusy || queueCount <= 0;
  }
  if (ui.craftClearQueueBtn) {
    ui.craftClearQueueBtn.disabled = state.craftBusy || queueCount <= 0;
  }

  if (!state.craftStatusText) {
    if (!connected) setCraftStatus("请先连接并刷新库存");
    else if (!candidates.length) setCraftStatus("主库存中没有符合炼金规则的物品");
    else if (queueCount > 0) setCraftStatus(`配方预览已有 ${queueCount} 组，可执行`);
    else if (selectedRows.length !== 10) setCraftStatus("请在下方选择 10 件物品并添加配方");
    else if (!recipeInfo.ok) setCraftStatus(recipeInfo.reason || "所选物品不满足炼金规则", true);
    else setCraftStatus("已满足炼金条件，可添加配方");
  } else if (!ui.craftStatusText.classList.contains("error") && recipeInfo.ok && connected && !state.craftBusy) {
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
  const queue = Array.isArray(state.craftRecipeQueue) ? state.craftRecipeQueue : [];
  if (!queue.length) {
    setCraftStatus("配方预览为空，请先添加配方", true);
    return;
  }
  const dedup = new Set();
  for (const entry of queue) {
    for (const id of Array.isArray(entry.item_ids) ? entry.item_ids : []) {
      const key = String(id || "").trim();
      if (!key) continue;
      if (dedup.has(key)) {
        setCraftStatus(`配方预览存在重复物品：${key}`, true);
        return;
      }
      dedup.add(key);
    }
  }
  const recipes = queue.map((entry) => ({item_ids: [...entry.item_ids]}));
  if (!recipes.length) {
    setCraftStatus("配方预览为空，请先添加配方", true);
    return;
  }

  state.craftBusy = true;
  setCraftStatus(`正在执行 ${recipes.length} 组配方...`);
  renderCraftPage();
  try {
    const data = await api("/api/craft/tradeup", {
      method: "POST",
      body: JSON.stringify({
        username,
        allow_cooling: !!state.craftIncludeCooling,
        recipes
      })
    });
    const keepSelectedIds = new Set(state.selectedComponentItemIds);
    setRows(
      Array.isArray(data.rows) ? data.rows : [],
      data.component || {summary_map: {}, item_map: {}},
      String(data.snapshot_path || "").trim(),
      {keepSelectedIds}
    );
    if (String(data.fetch_time || "").trim()) {
      state.fetchTime = String(data.fetch_time).trim();
      syncInventoryTop();
    }
    state.craftSelectedItemIds.clear();
    state.craftRecipeQueue = [];
    state.craftStatusText = "";
    setCraftStatus(String(data.message || "汰换成功"));
    setSummary(String(data.message || "汰换成功"));
  } catch (err) {
    const payload = err && err.data && typeof err.data === "object" ? err.data : null;
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
      const completedSteps = Array.isArray(payload.completed_steps) ? payload.completed_steps.length : 0;
      if (completedSteps > 0) {
        state.craftRecipeQueue = state.craftRecipeQueue.slice(completedSteps);
      }
      state.craftSelectedItemIds.clear();
      const failedStep = Math.max(0, Number(payload.failed_step || 0) || 0);
      const msg = `汰换中断：已完成${completedSteps}组${failedStep > 0 ? `，失败于第${failedStep}组` : ""}，${err.message}`;
      setCraftStatus(msg, true);
      setSummary(msg);
    } else {
      setCraftStatus(`汰换失败：${err.message}`, true);
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
    if (wearUp) wearUp.classList.toggle("active", state.wearSort === "asc");
    if (wearDown) wearDown.classList.toggle("active", state.wearSort === "desc");
    if (rarityUp) rarityUp.classList.toggle("active", state.raritySort === "asc");
    if (rarityDown) rarityDown.classList.toggle("active", state.raritySort === "desc");
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
    ui.componentHint.textContent = "0/1000";
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
function updateComponentHint(visibleCount = null) {
  const count = visibleCount == null ? rowsForComponentScope().length : Math.max(0, Number(visibleCount) || 0);
  const selected = selectedComponentId();
  const totalCapacity = 1000;
  const tail = selected ? `，已选${getSelectedRows().length}件` : "";
  ui.componentHint.textContent = `${count}/${totalCapacity}${tail}`;
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
    : "取出选中";
}
function applyFilter() { const keyword = String(state.searchText || "").trim().toLowerCase(); const allRows = rowsForComponentScope(), selected = selectedComponentId(); if (selected) state.emptyHint = allRows.length ? "该组件在当前条件下无物品" : "该组件暂无已缓存物品，请先刷新库存"; else state.emptyHint = "主库存在当前条件下无物品（组件内物品已隐藏）"; const wearCheck = validateWearFilter({autoFix: false}); const wearRows = allRows.filter(itemHasWear), noWearRows = allRows.filter((x) => !itemHasWear(x)); let rows = wearRows; if (!state.includeHidden) rows = rows.filter((x) => !x.hidden_reason || String(x.casket_id || "").trim()); if (keyword) rows = rows.filter((x) => itemSearchText(x).includes(keyword)); if (state.raritySelected.size && state.raritySelected.size < RARITY_VALUES.length) rows = rows.filter((x) => state.raritySelected.has(rarityName(x))); if (state.collectionSelected.size) rows = rows.filter((x) => state.collectionSelected.has(collectionName(x))); if (wearCheck.valid) { if (wearCheck.minValue !== null) rows = rows.filter((x) => Number(x.float_value || 0) >= wearCheck.minValue); if (wearCheck.maxValue !== null) rows = rows.filter((x) => Number(x.float_value || 0) <= wearCheck.maxValue); } rows.sort((a, b) => { const ra = Number(a.rarity || 0), rb = Number(b.rarity || 0); if (ra !== rb) return state.raritySort === "desc" ? rb - ra : ra - rb; const wa = Number(a.float_value || 0), wb = Number(b.float_value || 0); if (wa !== wb) return state.wearSort === "desc" ? wb - wa : wa - wb; return assetIdNumber(a) - assetIdNumber(b); }); noWearRows.sort((a, b) => assetIdNumber(a) - assetIdNumber(b)); return {allRows, filteredRows: rows.concat(noWearRows)}; }
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
    lines.push(`皮肤编号: ${Number(row.paint_index || 0)}  种子: ${Number(row.paint_seed || 0)}`);
    if (!componentRow) {
      lines.push(`品质/稀有度: ${qualityName(row)}(${Number(row.quality || 0)}) / ${rarityName(row)}(${Number(row.rarity || 0)})`);
    }
    if (itemHasWear(row)) lines.push(`磨损: ${Number(row.float_value || 0).toFixed(6)}`);
    const cid = String(row.casket_id || "").trim();
    const prefix = cid ? `组件: ${componentNameById(cid)}` : "";
    const unlock = coolingUnlockTs(row);
    if (componentRow) {
      meta.style.color = "#57606a";
      lines.push(prefix || "");
    } else if (unlock > 0) {
      meta.style.color = "#c28f00";
      lines.push(`${prefix} （冷却中 ${cooldownEndText(unlock)} 结束）`.trim());
    } else {
      meta.style.color = "#57606a";
      lines.push(prefix || "冷却: 无");
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

  wearGroups.sort((a, b) => {
    const ar = Math.max(...a[1].map((x) => Number(x.rarity || 0)));
    const br = Math.max(...b[1].map((x) => Number(x.rarity || 0)));
    if (ar !== br) return state.raritySort === "desc" ? br - ar : ar - br;
    return a[0].toLowerCase().localeCompare(b[0].toLowerCase());
  });
  noWearGroups.sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()));

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
        ? minWear.toFixed(6)
        : `${minWear.toFixed(6)}~${maxWear.toFixed(6)}`;
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
  table.innerHTML = "<thead><tr><th class=\"select-col\"><input type=\"checkbox\" class=\"row-check group-check-all\" title=\"全选/全部取消\" aria-label=\"全选/全部取消\" /></th><th><div class=\"th-sort-wrap\"><span>稀有度</span><span class=\"sort-stack\"><button type=\"button\" class=\"arrow-tri up col-sort-btn\" data-sort-key=\"rarity\" data-sort-dir=\"asc\" title=\"稀有度由低到高\" aria-label=\"稀有度由低到高\"></button><button type=\"button\" class=\"arrow-tri down col-sort-btn\" data-sort-key=\"rarity\" data-sort-dir=\"desc\" title=\"稀有度由高到低\" aria-label=\"稀有度由高到低\"></button></span></div></th><th>名称</th><th>收藏品</th><th>数量(可用/冷却中)</th><th>种子</th><th><div class=\"th-sort-wrap\"><span>磨损</span><span class=\"sort-stack\"><button type=\"button\" class=\"arrow-tri up col-sort-btn\" data-sort-key=\"wear\" data-sort-dir=\"asc\" title=\"磨损由低到高\" aria-label=\"磨损由低到高\"></button><button type=\"button\" class=\"arrow-tri down col-sort-btn\" data-sort-key=\"wear\" data-sort-dir=\"desc\" title=\"磨损由高到低\" aria-label=\"磨损由高到低\"></button></span></div></th><th>冷却</th></tr></thead>";
  refreshSortArrowStyles(table);
  for (const btn of table.querySelectorAll(".col-sort-btn")) {
    btn.onclick = (evt) => {
      evt.stopPropagation();
      const key = String(btn.dataset.sortKey || "");
      const dir = String(btn.dataset.sortDir || "");
      if ((key !== "wear" && key !== "rarity") || (dir !== "asc" && dir !== "desc")) return;
      if (key === "wear") state.wearSort = dir;
      else state.raritySort = dir;
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
    parent.innerHTML = `<td class="select-col">${parentSelectCell}</td><td>${parentRarityText}</td><td>${row.name}</td><td>${row.collection || ""}</td><td>${parentQuantityText}</td><td></td><td>${row.wear_range_text || ""}</td><td>${parentCooldownText}</td>`;
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
      child.className = `group-child${selectable ? " selectable" : ""}${selected ? " selected" : ""}${!componentRow && coolingUnlockTs(item) > 0 ? " cooling" : ""}`;
      child.innerHTML = `<td class="select-col"></td><td></td><td>Asset ${itemId || "-"}</td><td></td><td></td><td>${Number(item.paint_seed || 0)}</td><td>${itemHasWear(item) ? Number(item.float_value || 0).toFixed(6) : ""}</td><td>${componentRow ? "" : cooldownText(item)}</td>`;
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
  scheduleAutoFillIfNeeded();
}
function setRefreshBusy(busy) {
  state.refreshing = !!busy;
  const disabled = state.refreshing || state.accounts.length <= 0;
  ui.refreshBtn.disabled = disabled;
  if (ui.craftRefreshBtn) ui.craftRefreshBtn.disabled = disabled;
  syncUseAccountButtonState();
  ui.loginSaveBtn.disabled = state.refreshing;
  syncComponentActionState();
  renderSavedAccounts();
}

async function doRefresh({usernameOverride = "", force = false, silentRateLimit = false} = {}) {
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
    setRefreshPhase(state.connectedUsername === username ? "连接状态：已连接（刷新中）" : "连接状态：连接中");
    setSummary(state.connectedUsername === username ? "已连接，正在刷新库存..." : "正在建立连接并刷新库存...");

    const data = await api("/api/refresh", {method: "POST", body: JSON.stringify({username, include_hidden: String(state.includeHidden)})});
    const result = data.result || {}, rows = Array.isArray(data.rows) ? data.rows : [];
    state.connectedUsername = username;
    state.fetchTime = String(data.fetch_time || "").trim();
    setRows(rows, data.component || {summary_map: {}, item_map: {}}, result.snapshot_path || "");
    clearRefreshPhase();
    syncInventoryTop();
    await loadComponentTaskQueue();
    setSummary(`${String(result.message || "刷新成功")}，共 ${rows.length} 条`);
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
  });
  document.addEventListener("mouseup", () => {
    stopCraftSplitDrag();
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
      const settingsPanel = ui.craftSettingsPanel;
      const settingsBtn = ui.craftSettingsBtn;
      const inPanel = settingsPanel && settingsPanel.contains(target);
      const inBtn = settingsBtn && settingsBtn.contains(target);
      if (!inPanel && !inBtn) {
        setCraftSettingsPanelOpen(false);
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
  ui.navAccount.onclick = () => showPage("accountPage");
  ui.navInventory.onclick = () => showPage("inventoryPage");
  ui.navCraft.onclick = () => showPage("craftPage");

  ui.loginSaveBtn.onclick = loginAndSave;
  ui.clearAccountBtn.onclick = clearAccountForm;

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

  ui.useAccountBtn.onclick = async () => {
    const username = String(ui.accountSelect.value || "").trim();
    if (!username) { setSummary("请先选择账号"); return; }
    await useAccount(username);
    syncInventoryAccountSelect();
  };
  if (ui.craftUseAccountBtn) {
    ui.craftUseAccountBtn.onclick = async () => {
      const username = String((ui.craftAccountSelect && ui.craftAccountSelect.value) || "").trim();
      if (!username) { setSummary("请先选择账号"); return; }
      await useAccount(username);
      syncInventoryAccountSelect();
    };
  }
  ui.refreshBtn.onclick = () => doRefresh({force: false});
  if (ui.craftRefreshBtn) {
    ui.craftRefreshBtn.onclick = () => doRefresh({
      force: false,
      usernameOverride: String((ui.craftAccountSelect && ui.craftAccountSelect.value) || "").trim()
    });
  }

  ui.includeHidden.onchange = () => { state.includeHidden = !!ui.includeHidden.checked; resetRenderWindow(); render(); };
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
    if (!selectedComponentId()) {
      setSummary("请先选择组件");
      return;
    }
    const itemIds = getSelectedIdsInComponent(selectedComponentId());
    if (!itemIds.length) {
      setSummary("请先在组件列表中选择要取出的物品");
      return;
    }
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
  if (ui.craftSettingsBtn) {
    ui.craftSettingsBtn.onclick = () => {
      setCraftSettingsPanelOpen(!state.craftSettingsOpen);
    };
  }
  if (ui.craftIncludeCooling) {
    ui.craftIncludeCooling.onchange = () => {
      state.craftIncludeCooling = !!ui.craftIncludeCooling.checked;
      saveCraftUiPrefs();
      state.craftStatusText = "";
      renderCraftPage();
    };
  }
  if (ui.craftShowSeed) {
    ui.craftShowSeed.onchange = () => {
      state.craftShowSeed = !!ui.craftShowSeed.checked;
      saveCraftUiPrefs();
      renderCraftPage();
    };
  }
  if (ui.craftSplitBar) {
    ui.craftSplitBar.onmousedown = (evt) => {
      startCraftSplitDrag(evt);
    };
  }
  if (ui.craftAddRecipeBtn) {
    ui.craftAddRecipeBtn.onclick = () => {
      addCurrentSelectionToCraftQueue();
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
  bindEvents();
  initWearOptions();
  refreshRarityMenu();
  setFilterPanel(state.filterPanel);
  updateFilterDrawer();
  applyCraftLayoutWidth();
  setAccountStatus("准备就绪");
  setNoAccountState();
  try {
    const uiState = await api("/api/ui-state");
    const preferred = String(uiState.last_selected_username || "").trim();
    await loadAccounts({preferUsername: preferred});
    if (state.accountSelectedUsername) await switchAccountView(state.accountSelectedUsername);
    else setNoAccountState();
  } catch (err) {
    setSummary(`初始化失败：${err.message}`);
    setAccountStatus(`初始化失败：${err.message}`, true);
  }
  showPage("accountPage");
}

init();

