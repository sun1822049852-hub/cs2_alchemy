const RARITY_MAP = {1: "Consumer", 2: "Industrial", 3: "Mil-Spec", 4: "Restricted", 5: "Classified", 6: "Covert", 7: "Contraband"};
const QUALITY_MAP = {1: "Genuine", 4: "Normal", 9: "StatTrak", 11: "Souvenir"};
const RARITY_VALUES = Object.keys(RARITY_MAP).map(Number).sort((a, b) => a - b).map((k) => RARITY_MAP[k]);

const state = {
  currentPage: "accountPage", accounts: [], activeAccount: "", accountSelectedUsername: "",
  currentAccountUsername: "", connectedUsername: "", rows: [], mode: "grouped", includeHidden: false, searchText: "",
  raritySelected: new Set(), collectionSelected: new Set(), collectionValues: [], collectionMenuKey: "", collectionSourceKey: "",
  wearMin: null, wearMax: null, wearSort: "asc", raritySort: "desc", pageSize: 90, page: 1,
  expandedGroups: new Set(), selectedComponentId: "", showComponentItems: false, selectedComponentItemIds: new Set(), componentOpBusy: false,
  component: {summary_map: {}, item_map: {}}, snapshotPath: "", fetchTime: "", refreshing: false,
  depositModalOpen: false, depositSearchText: "", depositWearOnly: false, depositSelectedIds: new Set(),
  refreshPhaseText: "", lastRefreshClickTs: 0, emptyHint: "请选用一个账号",
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
  modeGridBtn: document.getElementById("modeGridBtn"), modeListBtn: document.getElementById("modeListBtn"),
  includeHidden: document.getElementById("includeHidden"), searchInput: document.getElementById("searchInput"), toggleFilterBtn: document.getElementById("toggleFilterBtn"), filterDrawer: document.getElementById("filterDrawer"),
  wearMin: document.getElementById("wearMin"), wearMax: document.getElementById("wearMax"), wearHint: document.getElementById("wearHint"),
  raritySummary: document.getElementById("raritySummary"), rarityMenu: document.getElementById("rarityMenu"), raritySelectAll: document.getElementById("raritySelectAll"), rarityClear: document.getElementById("rarityClear"),
  collectionSummary: document.getElementById("collectionSummary"), collectionMenu: document.getElementById("collectionMenu"), collectionSelectAll: document.getElementById("collectionSelectAll"), collectionClear: document.getElementById("collectionClear"),
  wearSortUp: document.getElementById("wearSortUp"), wearSortDown: document.getElementById("wearSortDown"), raritySortUp: document.getElementById("raritySortUp"), raritySortDown: document.getElementById("raritySortDown"),
  componentPanel: document.getElementById("componentPanel"), componentSelect: document.getElementById("componentSelect"), componentHint: document.getElementById("componentHint"),
  showComponentItemsWrap: document.getElementById("showComponentItemsWrap"), showComponentItems: document.getElementById("showComponentItems"),
  componentDepositBtn: document.getElementById("componentDepositBtn"), componentWithdrawBtn: document.getElementById("componentWithdrawBtn"),
  pageSize: document.getElementById("pageSize"), prevBtn: document.getElementById("prevBtn"), nextBtn: document.getElementById("nextBtn"), pageInfo: document.getElementById("pageInfo"), snapshotPath: document.getElementById("snapshotPath"), listWrap: document.getElementById("listWrap"),
  depositModal: document.getElementById("depositModal"), depositModalClose: document.getElementById("depositModalClose"), depositCancelBtn: document.getElementById("depositCancelBtn"), depositConfirmBtn: document.getElementById("depositConfirmBtn"),
  depositSearchInput: document.getElementById("depositSearchInput"), depositWearOnly: document.getElementById("depositWearOnly"), depositSelectAllBtn: document.getElementById("depositSelectAllBtn"), depositInvertBtn: document.getElementById("depositInvertBtn"), depositCounter: document.getElementById("depositCounter"), depositListWrap: document.getElementById("depositListWrap")
};

let searchTimer = null;
let inventoryEventSource = null;
let inventoryEventUsername = "";

async function api(path, options = {}) {
  const r = await fetch(path, {headers: {"Content-Type": "application/json"}, ...options});
  const d = await r.json();
  if (!r.ok || d.ok === false) throw new Error(d.message || `http ${r.status}`);
  return d;
}

function parseEventData(raw) {
  try {
    return JSON.parse(String(raw || "{}"));
  } catch (_) {
    return {};
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

function syncInventoryTop() {
  if (!state.currentAccountUsername) {
    ui.currentAccountText.textContent = "当前账号：未选择";
    ui.fetchTimeText.textContent = "库存获取时间：-";
    ui.statusText.textContent = "连接状态：未连接";
    ui.refreshBtn.textContent = "连接并刷新库存信息";
    return;
  }
  ui.currentAccountText.textContent = `当前账号：${state.currentAccountUsername}`;
  ui.fetchTimeText.textContent = `库存获取时间：${state.fetchTime || "-"}`;
  if (state.refreshPhaseText) ui.statusText.textContent = state.refreshPhaseText;
  else if (state.connectedUsername === state.currentAccountUsername) ui.statusText.textContent = "连接状态：已连接";
  else ui.statusText.textContent = "连接状态：未连接";
  ui.refreshBtn.textContent = state.connectedUsername === state.currentAccountUsername ? "刷新库存信息" : "连接并刷新库存信息";
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
}

function syncInventoryAccountSelect() {
  ui.accountSelect.replaceChildren();
  for (const row of state.accounts) {
    const o = document.createElement("option");
    o.value = row.username;
    o.textContent = `${row.remark || row.username}（${row.username}）${row.is_active ? " [当前]" : ""}`;
    ui.accountSelect.append(o);
  }
  if (state.accountSelectedUsername) ui.accountSelect.value = state.accountSelectedUsername;
  else if (state.activeAccount) ui.accountSelect.value = state.activeAccount;
  const hasAccount = state.accounts.length > 0;
  ui.refreshBtn.disabled = !hasAccount || state.refreshing;
  ui.useAccountBtn.disabled = !hasAccount || state.refreshing;
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
      const next = window.prompt(`账号：${row.username}\n请输入新的备注名：`, row.remark || row.username);
      if (next === null) return;
      const remark = String(next || "").trim() || row.username;
      try {
        await api("/api/accounts/upsert", {method: "POST", body: JSON.stringify({username: row.username, password: row.password || "", remark})});
        await loadAccounts({preferUsername: row.username});
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
  return `${state.rowsVersion}|${String(state.selectedComponentId || "").trim()}|${state.showComponentItems ? 1 : 0}`;
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
    state.showComponentItems ? 1 : 0,
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

function setRows(rows, component, snapshotPath = "") {
  state.rows = Array.isArray(rows) ? rows : [];
  state.component = component || {summary_map: {}, item_map: {}};
  state.snapshotPath = snapshotPath || "";
  state.page = 1;
  state.selectedComponentItemIds.clear();
  state.depositSelectedIds.clear();
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
}

async function loadSnapshotForAccount(username) {
  const key = String(username || "").trim();
  if (!key) return false;
  const data = await api(`/api/snapshot/account?username=${encodeURIComponent(key)}`);
  const rows = Array.isArray(data.rows) ? data.rows : [];
  state.currentAccountUsername = key;
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
  state.accountSelectedUsername = key;
  syncInventoryAccountSelect();
  renderSavedAccounts();
  await persistLastSelected(key);
  await loadSnapshotForAccount(key);
  startInventoryEventStream(key);
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
  state.currentAccountUsername = "";
  state.fetchTime = "";
  state.rows = [];
  state.snapshotPath = "";
  state.component = {summary_map: {}, item_map: {}};
  state.selectedComponentId = "";
  state.showComponentItems = false;
  state.selectedComponentItemIds.clear();
  state.depositSelectedIds.clear();
  state.emptyHint = "请选用一个账号";
  ui.showComponentItems.checked = false;
  setRows([], {summary_map: {}, item_map: {}}, "");
  syncInventoryTop();
  setSummary("请选用一个账号");
}

function qualityName(row) { const v = String(row.quality_name || "").trim(); if (v) return v; const id = Number(row.quality || 0); return QUALITY_MAP[id] || `Unknown(${id})`; }
function rarityName(row) { const e = String(row.alchemy_rarity || "").trim(); if (e) return e; const r = String(row.rarity_name || "").trim(); if (r) return r; const id = Number(row.rarity || 0); return RARITY_MAP[id] || `Unknown(${id})`; }
const collectionName = (row) => String(row.collection || "").trim();
const itemDisplayName = (row) => String(row.alchemy_name || "").trim() || String(row.name || "").trim();
const itemSearchText = (row) => [row.name, row.market_hash_name, row.alchemy_name, row.collection, row.collection_en].map((x) => String(x || "").toLowerCase()).join(" ").trim();
function itemHasWear(row) { if (row.minfloat != null && row.maxfloat != null) return true; const n = String(row.name || "").toLowerCase(); return ["(factory new)", "(minimal wear)", "(field-tested)", "(well-worn)", "(battle-scarred)"].some((x) => n.includes(x)); }
function parseTradableAfter(row) { const raw = row.tradable_after; if (raw == null) return 0; if (typeof raw === "string") { if (/^\d+$/.test(raw)) { const num = Number(raw); if (Number.isFinite(num)) return num > 1e12 ? Math.floor(num / 1000) : Math.floor(num); } const p = Date.parse(raw); return Number.isFinite(p) ? Math.floor(p / 1000) : 0; } const n = Number(raw); if (!Number.isFinite(n)) return 0; return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n); }
const coolingUnlockTs = (row) => { const ts = parseTradableAfter(row); return ts <= Math.floor(Date.now() / 1000) ? 0 : ts; };
function cooldownEndText(unlockTs) { const d = new Date(unlockTs * 1000); return `${String(d.getMonth() + 1).padStart(2, "0")}月${String(d.getDate()).padStart(2, "0")}日`; }
function cooldownText(row, {compact = false} = {}) { const unlock = coolingUnlockTs(row); if (unlock <= 0) return "无"; const end = cooldownEndText(unlock); return compact ? `冷却中 ${end}结束` : `冷却中 ${end} 结束`; }
function groupCooldownText(items) { const cooling = items.filter((x) => coolingUnlockTs(x) > 0); if (!cooling.length) return "无"; const earliest = cooling.reduce((a, b) => (coolingUnlockTs(a) <= coolingUnlockTs(b) ? a : b)); if (cooling.length === 1) return cooldownText(earliest); return `${cooling.length}件冷却中，最早${cooldownEndText(coolingUnlockTs(earliest))}结束`; }
function groupCollectionText(items) { const values = Array.from(new Set(items.map((x) => collectionName(x)).filter(Boolean))).sort((a, b) => a.localeCompare(b)); if (!values.length) return ""; if (values.length === 1) return values[0]; return "多收藏品"; }
function groupNeedsExpand(items) { if (items.length <= 1) return true; const base = items[0], baseWear = itemHasWear(base), baseSeed = Number(base.paint_seed || 0), baseQ = Number(base.quality || 0), baseR = Number(base.rarity || 0), baseU = parseTradableAfter(base), baseF = Number(base.float_value || 0); for (let i = 1; i < items.length; i += 1) { const it = items[i]; if (Number(it.paint_seed || 0) !== baseSeed || Number(it.quality || 0) !== baseQ || Number(it.rarity || 0) !== baseR || parseTradableAfter(it) !== baseU) return true; const wear = itemHasWear(it); if (wear !== baseWear) return true; if (wear && Math.abs(Number(it.float_value || 0) - baseF) > 1e-9) return true; } return false; }
const assetIdNumber = (row) => { const n = Number(row.asset_id || 0); return Number.isFinite(n) ? Math.trunc(n) : 0; };
function compactComponentName(name) { let t = String(name || "").trim(); if (!t) return "未命名组件"; if (t.toLowerCase().startsWith("storage unit")) { t = t.slice("Storage Unit".length).trim(); if (t.startsWith("|")) t = t.slice(1).trim(); } if (t.startsWith("(") && t.endsWith(")")) t = t.slice(1, -1).trim(); return t || "未命名组件"; }
const componentNameById = (id) => { const key = String(id || "").trim(); if (!key) return ""; const s = state.component.summary_map[key]; return s ? s.name || key : key; };
const selectedComponentId = () => String(state.selectedComponentId || "").trim();
function rowsForComponentScope() {
  const selected = selectedComponentId();
  if (selected) return state.component.item_map[selected] || [];
  if (state.showComponentItems) return state.rows;
  return state.rows.filter((x) => !String(x.casket_id || "").trim());
}
function rowsForDepositSource() {
  return state.rows.filter((row) => {
    if (String(row.casket_id || "").trim()) return false;
    if (Number(row.def_index || 0) === 1201) return false;
    if (row.hidden_reason) return false;
    return true;
  });
}
function updateFilterDrawer() { const open = !ui.filterDrawer.classList.contains("hidden"); ui.toggleFilterBtn.textContent = open ? "收起筛选" : "展开筛选"; }
function toggleFilterDrawer() { ui.filterDrawer.classList.toggle("hidden"); updateFilterDrawer(); }
function initWearOptions() { const values = ["", ...Array.from({length: 101}, (_, i) => (i / 100).toFixed(2))]; for (const sel of [ui.wearMin, ui.wearMax]) { sel.replaceChildren(); for (const v of values) { const o = document.createElement("option"); o.value = v; o.textContent = v; sel.append(o); } } }
const parseWearSelectValue = (v) => { const t = String(v || "").trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
function validateWearFilter({changedSide = null, autoFix = false} = {}) { let minValue = parseWearSelectValue(ui.wearMin.value), maxValue = parseWearSelectValue(ui.wearMax.value); if (minValue !== null && maxValue !== null && maxValue <= minValue) { if (!autoFix) { ui.wearHint.textContent = "磨损后项必须大于前项"; return {minValue: null, maxValue: null, valid: false}; } if (changedSide === "max") { let fixedMin = Math.max(0, Math.round((maxValue - 0.01) * 100) / 100); if (fixedMin >= maxValue) { maxValue = 0.01; fixedMin = 0; } minValue = fixedMin; ui.wearMin.value = minValue.toFixed(2); ui.wearMax.value = maxValue.toFixed(2); } else { let fixedMax = Math.min(1, Math.round((minValue + 0.01) * 100) / 100); if (fixedMax <= minValue) { minValue = 0.99; fixedMax = 1; } maxValue = fixedMax; ui.wearMin.value = minValue.toFixed(2); ui.wearMax.value = maxValue.toFixed(2); } } ui.wearHint.textContent = ""; state.wearMin = minValue; state.wearMax = maxValue; return {minValue, maxValue, valid: true}; }
function onWearInputChanged(changedSide) { const minValue = parseWearSelectValue(ui.wearMin.value), maxValue = parseWearSelectValue(ui.wearMax.value); if (changedSide === "min" && minValue !== null && maxValue === null) { let fixedMax = Math.min(1, Math.round((minValue + 0.01) * 100) / 100); if (fixedMax <= minValue) { fixedMax = 1; ui.wearMin.value = "0.99"; } ui.wearMax.value = fixedMax.toFixed(2); } if (changedSide === "max" && maxValue !== null && minValue === null) { let fixedMin = Math.max(0, Math.round((maxValue - 0.01) * 100) / 100); if (fixedMin >= maxValue) { fixedMin = 0; ui.wearMax.value = "0.01"; } ui.wearMin.value = fixedMin.toFixed(2); } validateWearFilter({changedSide, autoFix: true}); state.page = 1; render(); }
function refreshSortArrowStyles() { ui.wearSortUp.classList.toggle("active", state.wearSort === "asc"); ui.wearSortDown.classList.toggle("active", state.wearSort === "desc"); ui.raritySortUp.classList.toggle("active", state.raritySort === "asc"); ui.raritySortDown.classList.toggle("active", state.raritySort === "desc"); }
function syncModeButtons() {
  const gridActive = state.mode === "cards";
  const listActive = state.mode === "grouped";
  ui.modeGridBtn.classList.toggle("active", gridActive);
  ui.modeListBtn.classList.toggle("active", listActive);
  ui.modeGridBtn.setAttribute("aria-pressed", gridActive ? "true" : "false");
  ui.modeListBtn.setAttribute("aria-pressed", listActive ? "true" : "false");
}
function updateRaritySummary() { const total = RARITY_VALUES.length, selected = state.raritySelected.size; if (selected <= 0 || selected >= total) { ui.raritySummary.textContent = "全部"; return; } if (selected === 1) { ui.raritySummary.textContent = [...state.raritySelected][0]; return; } ui.raritySummary.textContent = `已选${selected}项`; }
function refreshRarityMenu() { state.raritySelected = new Set([...state.raritySelected].filter((x) => RARITY_VALUES.includes(x))); ui.rarityMenu.replaceChildren(); for (const label of RARITY_VALUES) { const w = document.createElement("label"); w.className = "menu-item"; const box = document.createElement("input"); box.type = "checkbox"; box.checked = state.raritySelected.has(label); box.onchange = () => { box.checked ? state.raritySelected.add(label) : state.raritySelected.delete(label); updateRaritySummary(); state.page = 1; render(); }; w.append(box, document.createTextNode(label)); ui.rarityMenu.append(w); } updateRaritySummary(); }
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
      state.page = 1;
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
  allOpt.textContent = "未选中组件";
  ui.componentSelect.append(allOpt);
  for (const s of summaries) {
    const id = String(s.component_id || "").trim();
    if (!id) continue;
    const expected = Number(s.expected_count || 0);
    const loaded = Number(s.loaded_count || 0);
    const tail = expected > 0 ? `${loaded}/${expected}` : `${loaded}`;
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
    ui.componentHint.textContent = "0个/0件";
    ui.showComponentItemsWrap.classList.remove("hidden");
    syncComponentActionState();
    return;
  }
  ui.componentSelect.disabled = false;
  ui.showComponentItems.checked = state.showComponentItems;
  if (!Object.prototype.hasOwnProperty.call(state.component.summary_map, state.selectedComponentId)) {
    state.selectedComponentId = "";
    state.selectedComponentItemIds.clear();
  }
  ui.componentSelect.value = state.selectedComponentId;
  const total = summaries.length;
  const loadedItems = Object.values(state.component.item_map || {}).reduce((a, arr) => a + arr.length, 0);
  const selected = selectedComponentId();
  if (selected) {
    ui.componentHint.textContent = `${total}个/${loadedItems}件，当前已选${state.selectedComponentItemIds.size}件`;
    ui.showComponentItemsWrap.classList.add("hidden");
  } else {
    ui.componentHint.textContent = `${total}个/${loadedItems}件`;
    ui.showComponentItemsWrap.classList.remove("hidden");
  }
  syncComponentActionState();
}
function syncComponentActionState() {
  const selected = selectedComponentId();
  ui.componentDepositBtn.disabled = !selected || state.componentOpBusy || state.refreshing;
  ui.componentWithdrawBtn.disabled = !selected || state.componentOpBusy || state.refreshing || state.selectedComponentItemIds.size <= 0;
}
function applyFilter() { const keyword = String(state.searchText || "").trim().toLowerCase(); const allRows = rowsForComponentScope(), selected = selectedComponentId(); if (selected) state.emptyHint = allRows.length ? "该组件在当前条件下无物品" : "该组件暂无已缓存物品，请先刷新库存"; else if (state.showComponentItems) state.emptyHint = "当前条件下无物品"; else state.emptyHint = "当前条件下无物品（已隐藏组件内物品）"; const wearCheck = validateWearFilter({autoFix: false}); const wearRows = allRows.filter(itemHasWear), noWearRows = allRows.filter((x) => !itemHasWear(x)); let rows = wearRows; if (!state.includeHidden) rows = rows.filter((x) => !x.hidden_reason || String(x.casket_id || "").trim()); if (keyword) rows = rows.filter((x) => itemSearchText(x).includes(keyword)); if (state.raritySelected.size && state.raritySelected.size < RARITY_VALUES.length) rows = rows.filter((x) => state.raritySelected.has(rarityName(x))); if (state.collectionSelected.size) rows = rows.filter((x) => state.collectionSelected.has(collectionName(x))); if (wearCheck.valid) { if (wearCheck.minValue !== null) rows = rows.filter((x) => Number(x.float_value || 0) >= wearCheck.minValue); if (wearCheck.maxValue !== null) rows = rows.filter((x) => Number(x.float_value || 0) <= wearCheck.maxValue); } rows.sort((a, b) => { const ra = Number(a.rarity || 0), rb = Number(b.rarity || 0); if (ra !== rb) return state.raritySort === "desc" ? rb - ra : ra - rb; const wa = Number(a.float_value || 0), wb = Number(b.float_value || 0); if (wa !== wb) return state.wearSort === "desc" ? wb - wa : wa - wb; return assetIdNumber(a) - assetIdNumber(b); }); noWearRows.sort((a, b) => assetIdNumber(a) - assetIdNumber(b)); return {allRows, filteredRows: rows.concat(noWearRows)}; }
const paginate = (list) => { const size = Math.max(1, Number(state.pageSize) || 90), pages = Math.max(1, Math.ceil(list.length / size)); if (state.page < 1) state.page = 1; if (state.page > pages) state.page = pages; const start = (state.page - 1) * size; return {pages, start, pageList: list.slice(start, start + size)}; };
function toggleComponentItemSelection(itemId) {
  const key = String(itemId || "").trim();
  if (!key) return;
  if (state.selectedComponentItemIds.has(key)) state.selectedComponentItemIds.delete(key);
  else state.selectedComponentItemIds.add(key);
  refreshComponentControls();
  render();
}
function renderComponentItems(filteredRows, totalRows) {
  const {pageList, pages} = paginate(filteredRows);
  ui.pageInfo.textContent = `${state.page}/${pages}`;
  ui.prevBtn.disabled = state.page <= 1;
  ui.nextBtn.disabled = state.page >= pages;
  if (!pageList.length) {
    ui.listWrap.innerHTML = `<div class="empty">${state.emptyHint}</div>`;
    setSummary(`组件内匹配 ${filteredRows.length}/${totalRows.length}`);
    return;
  }
  const table = document.createElement("table");
  table.className = "group-table";
  table.innerHTML = "<thead><tr><th class=\"group-select-cell\">选择</th><th>名称</th><th>稀有度</th><th>收藏品</th><th>种子</th><th>磨损</th><th>冷却</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const item of pageList) {
    const itemId = String(item.asset_id || "").trim();
    const selected = state.selectedComponentItemIds.has(itemId);
    const tr = document.createElement("tr");
    tr.className = `group-child selectable${selected ? " selected" : ""}${coolingUnlockTs(item) > 0 ? " cooling" : ""}`;
    tr.innerHTML = `<td class="group-select-cell"><span class="group-select-pill">${selected ? "已选" : "选择"}</span></td><td>${itemDisplayName(item)}</td><td>${rarityName(item)}</td><td>${collectionName(item)}</td><td>${Number(item.paint_seed || 0)}</td><td>${itemHasWear(item) ? Number(item.float_value || 0).toFixed(6) : ""}</td><td>${cooldownText(item)}</td>`;
    tr.onclick = () => toggleComponentItemSelection(itemId);
    tbody.append(tr);
  }
  table.append(tbody);
  ui.listWrap.replaceChildren(table);
  setSummary(`组件内匹配 ${filteredRows.length}/${totalRows.length}，已选${state.selectedComponentItemIds.size}件`);
}
function filteredDepositRows() {
  const keyword = String(state.depositSearchText || "").trim().toLowerCase();
  let rows = rowsForDepositSource();
  if (state.depositWearOnly) rows = rows.filter(itemHasWear);
  if (keyword) rows = rows.filter((x) => itemSearchText(x).includes(keyword));
  rows = [...rows].sort((a, b) => assetIdNumber(a) - assetIdNumber(b));
  return rows;
}
function updateDepositCounter(total = filteredDepositRows().length) {
  ui.depositCounter.textContent = `已选 ${state.depositSelectedIds.size} 项 / 可选 ${total} 项`;
}
function renderDepositList() {
  const rows = filteredDepositRows();
  state.depositSelectedIds = new Set([...state.depositSelectedIds].filter((id) => rows.some((x) => String(x.asset_id) === id)));
  updateDepositCounter(rows.length);
  if (!rows.length) {
    ui.depositListWrap.innerHTML = "<div class=\"empty\">当前条件下没有可存入物品</div>";
    return;
  }
  const table = document.createElement("table");
  table.className = "deposit-table";
  table.innerHTML = "<thead><tr><th>选择</th><th>名称</th><th>稀有度</th><th>收藏品</th><th>磨损</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const itemId = String(row.asset_id || "").trim();
    const checked = state.depositSelectedIds.has(itemId);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><input type="checkbox" ${checked ? "checked" : ""} /></td><td>${itemDisplayName(row)}</td><td>${rarityName(row)}</td><td>${collectionName(row)}</td><td>${itemHasWear(row) ? Number(row.float_value || 0).toFixed(6) : ""}</td>`;
    const box = tr.querySelector("input");
    box.onchange = () => {
      if (box.checked) state.depositSelectedIds.add(itemId);
      else state.depositSelectedIds.delete(itemId);
      updateDepositCounter(rows.length);
    };
    tr.onclick = (evt) => {
      if (evt.target === box) return;
      box.checked = !box.checked;
      box.dispatchEvent(new Event("change"));
    };
    tbody.append(tr);
  }
  table.append(tbody);
  ui.depositListWrap.replaceChildren(table);
}
function openDepositModal() {
  const componentId = selectedComponentId();
  if (!componentId) {
    setSummary("请先选择组件");
    return;
  }
  state.depositModalOpen = true;
  state.depositSearchText = "";
  state.depositWearOnly = false;
  state.depositSelectedIds.clear();
  ui.depositSearchInput.value = "";
  ui.depositWearOnly.checked = false;
  ui.depositModal.classList.remove("hidden");
  renderDepositList();
}
function closeDepositModal() {
  state.depositModalOpen = false;
  state.depositSelectedIds.clear();
  ui.depositModal.classList.add("hidden");
}
async function runComponentMove(action, itemIds) {
  const componentId = selectedComponentId();
  const username = String(state.currentAccountUsername || "").trim();
  if (!componentId) throw new Error("请先选择组件");
  if (!username) throw new Error("请先选择账号并连接库存");
  state.componentOpBusy = true;
  refreshComponentControls();
  try {
    const path = action === "deposit" ? "/api/component/deposit" : "/api/component/withdraw";
    const data = await api(path, {method: "POST", body: JSON.stringify({username, component_id: componentId, item_ids: itemIds})});
    state.connectedUsername = username;
    state.fetchTime = String(data.fetch_time || "").trim();
    setRows(Array.isArray(data.rows) ? data.rows : [], data.component || {summary_map: {}, item_map: {}}, data.snapshot_path || "");
    syncInventoryTop();
    setSummary(String(data.message || "组件操作成功"));
    return data;
  } finally {
    state.componentOpBusy = false;
    refreshComponentControls();
  }
}
function renderCards(filteredRows, totalRows) { const {pageList, pages, start} = paginate(filteredRows); ui.pageInfo.textContent = `${state.page}/${pages}`; ui.prevBtn.disabled = state.page <= 1; ui.nextBtn.disabled = state.page >= pages; if (!pageList.length) { ui.listWrap.innerHTML = `<div class="empty">${state.emptyHint}</div>`; setSummary(`匹配 ${filteredRows.length}/${totalRows.length}，可见 0-0`); return; } const grid = document.createElement("div"); grid.className = "grid"; for (const row of pageList) { const card = document.createElement("div"); card.className = "card"; const name = document.createElement("div"); name.className = "name"; name.textContent = itemDisplayName(row); const meta = document.createElement("div"); meta.className = "meta"; const lines = []; lines.push(`Asset: ${row.asset_id}`); lines.push(`皮肤编号: ${Number(row.paint_index || 0)}  种子: ${Number(row.paint_seed || 0)}`); lines.push(`品质/稀有度: ${qualityName(row)}(${Number(row.quality || 0)}) / ${rarityName(row)}(${Number(row.rarity || 0)})`); if (itemHasWear(row)) lines.push(`磨损: ${Number(row.float_value || 0).toFixed(6)}`); const cid = String(row.casket_id || "").trim(), prefix = cid ? `组件: ${componentNameById(cid)}` : "", unlock = coolingUnlockTs(row); if (unlock > 0) { meta.style.color = "#c28f00"; lines.push(`${prefix} （冷却中 ${cooldownEndText(unlock)} 结束）`.trim()); } else { meta.style.color = "#57606a"; lines.push(prefix || "冷却: 无"); } meta.textContent = lines.join("\n"); card.append(name, meta); grid.append(card); } ui.listWrap.replaceChildren(grid); setSummary(`匹配 ${filteredRows.length}/${totalRows.length}，可见 ${start + 1}-${start + pageList.length}`); }
function buildGroupRows(filteredRows) { const groups = new Map(); for (const item of filteredRows) { const key = itemDisplayName(item); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); } const wearGroups = [], noWearGroups = []; for (const [name, items] of groups.entries()) { (items.some(itemHasWear) ? wearGroups : noWearGroups).push([name, items]); } wearGroups.sort((a, b) => { const ar = Math.max(...a[1].map((x) => Number(x.rarity || 0))), br = Math.max(...b[1].map((x) => Number(x.rarity || 0))); if (ar !== br) return state.raritySort === "desc" ? br - ar : ar - br; return a[0].toLowerCase().localeCompare(b[0].toLowerCase()); }); noWearGroups.sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase())); const out = []; for (const [name, items] of wearGroups.concat(noWearGroups)) { const coolingCount = items.filter((x) => coolingUnlockTs(x) > 0).length, availableCount = items.length - coolingCount, hasWear = items.some(itemHasWear), needsExpand = groupNeedsExpand(items); const childRows = needsExpand ? [...items].sort((a, b) => { const wa = Number(a.float_value || 0), wb = Number(b.float_value || 0); if (wa !== wb) return state.wearSort === "desc" ? wb - wa : wa - wb; return assetIdNumber(a) - assetIdNumber(b); }) : []; let wearRangeText = ""; if (hasWear) { const vals = items.map((x) => Number(x.float_value || 0)); wearRangeText = `${Math.min(...vals).toFixed(6)}~${Math.max(...vals).toFixed(6)}`; } out.push({name, items, parent_rarity: rarityName(items[0]), collection: groupCollectionText(items), available_count: availableCount, cooling_count: coolingCount, wear_range_text: wearRangeText, cooldown_text: groupCooldownText(items), needs_expand: needsExpand, child_rows: childRows}); } return out; }
function renderGrouped(filteredRows, totalRows, filterKey = "") { const groupedRows = getGroupedRows(filteredRows, filterKey), {pageList, pages} = paginate(groupedRows); ui.pageInfo.textContent = `${state.page}/${pages}`; ui.prevBtn.disabled = state.page <= 1; ui.nextBtn.disabled = state.page >= pages; if (!pageList.length) { ui.listWrap.innerHTML = `<div class="empty">${state.emptyHint}</div>`; setSummary(`匹配 ${filteredRows.length}/${totalRows.length}`); return; } const table = document.createElement("table"); table.className = "group-table"; table.innerHTML = "<thead><tr><th>稀有度</th><th>名称</th><th>收藏品</th><th>数量(可用/冷却中)</th><th>种子</th><th>磨损</th><th>冷却</th></tr></thead>"; const tbody = document.createElement("tbody"); for (const row of pageList) { const key = row.name, parent = document.createElement("tr"); parent.className = "group-parent"; parent.innerHTML = `<td>${row.parent_rarity}</td><td>${row.name}</td><td>${row.collection || ""}</td><td>${row.available_count}/${row.cooling_count}</td><td></td><td>${row.wear_range_text || ""}</td><td>${row.cooldown_text}</td>`; parent.onclick = () => { if (!row.needs_expand) return; state.expandedGroups.has(key) ? state.expandedGroups.delete(key) : state.expandedGroups.add(key); render(); }; tbody.append(parent); if (!row.needs_expand || !state.expandedGroups.has(key)) continue; for (const item of row.child_rows) { const child = document.createElement("tr"); child.className = `group-child ${coolingUnlockTs(item) > 0 ? "cooling" : ""}`; child.innerHTML = `<td></td><td>Asset ${item.asset_id}</td><td></td><td></td><td>${Number(item.paint_seed || 0)}</td><td>${itemHasWear(item) ? Number(item.float_value || 0).toFixed(6) : ""}</td><td>${cooldownText(item)}</td>`; tbody.append(child); } } table.append(tbody); ui.listWrap.replaceChildren(table); setSummary(`匹配 ${filteredRows.length}/${totalRows.length}`); }
function render() {
  if (state.currentPage !== "inventoryPage") return;
  refreshSortArrowStyles();
  syncModeButtons();
  const {allRows, filteredRows, filterKey} = getFilterResult();
  refreshCollectionMenu(allRows, {sourceKey: makeCollectionSourceKey()});
  if (selectedComponentId()) renderComponentItems(filteredRows, allRows);
  else if (state.mode === "grouped") renderGrouped(filteredRows, allRows, filterKey);
  else renderCards(filteredRows, allRows);
  syncComponentActionState();
}
function setRefreshBusy(busy) { state.refreshing = !!busy; ui.refreshBtn.disabled = state.refreshing || state.accounts.length <= 0; ui.useAccountBtn.disabled = state.refreshing || state.accounts.length <= 0; ui.loginSaveBtn.disabled = state.refreshing; syncComponentActionState(); renderSavedAccounts(); }

async function doRefresh({usernameOverride = "", force = false, silentRateLimit = false} = {}) {
  if (state.refreshing) return;
  const username = String(usernameOverride || ui.accountSelect.value || state.currentAccountUsername || "").trim();
  if (!username) { setSummary("请选用一个账号"); state.emptyHint = "请选用一个账号"; render(); return; }
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
  });
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

  ui.useAccountBtn.onclick = async () => {
    const username = String(ui.accountSelect.value || "").trim();
    if (!username) { setSummary("请先选择账号"); return; }
    await useAccount(username);
    syncInventoryAccountSelect();
  };
  ui.refreshBtn.onclick = () => doRefresh({force: false});

  ui.includeHidden.onchange = () => { state.includeHidden = !!ui.includeHidden.checked; state.page = 1; render(); };
  ui.searchInput.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.searchText = String(ui.searchInput.value || "").trim(); state.page = 1; render(); }, 180); };
  ui.modeGridBtn.onclick = () => { if (state.mode === "cards") return; state.mode = "cards"; state.page = 1; render(); };
  ui.modeListBtn.onclick = () => { if (state.mode === "grouped") return; state.mode = "grouped"; state.page = 1; render(); };
  ui.toggleFilterBtn.onclick = toggleFilterDrawer;
  ui.wearMin.onchange = () => onWearInputChanged("min");
  ui.wearMax.onchange = () => onWearInputChanged("max");
  ui.raritySelectAll.onclick = () => { state.raritySelected = new Set(RARITY_VALUES); refreshRarityMenu(); state.page = 1; render(); };
  ui.rarityClear.onclick = () => { state.raritySelected.clear(); refreshRarityMenu(); state.page = 1; render(); };
  ui.collectionSelectAll.onclick = () => { state.collectionSelected = new Set(state.collectionValues); refreshCollectionMenu(rowsForComponentScope(), {force: true}); state.page = 1; render(); };
  ui.collectionClear.onclick = () => { state.collectionSelected.clear(); refreshCollectionMenu(rowsForComponentScope(), {force: true}); state.page = 1; render(); };
  ui.wearSortUp.onclick = () => { state.wearSort = "asc"; render(); };
  ui.wearSortDown.onclick = () => { state.wearSort = "desc"; render(); };
  ui.raritySortUp.onclick = () => { state.raritySort = "asc"; render(); };
  ui.raritySortDown.onclick = () => { state.raritySort = "desc"; render(); };
  ui.componentSelect.onchange = () => {
    const selected = String(ui.componentSelect.value || "").trim();
    state.selectedComponentId = selected;
    state.selectedComponentItemIds.clear();
    state.page = 1;
    refreshComponentControls();
    render();
  };
  ui.showComponentItems.onchange = () => {
    state.showComponentItems = !!ui.showComponentItems.checked;
    state.page = 1;
    render();
  };
  ui.componentDepositBtn.onclick = () => openDepositModal();
  ui.componentWithdrawBtn.onclick = async () => {
    const itemIds = [...state.selectedComponentItemIds];
    if (!itemIds.length) {
      setSummary("请先在组件列表中选择要取出的物品");
      return;
    }
    try {
      await runComponentMove("withdraw", itemIds);
      state.selectedComponentItemIds.clear();
      refreshComponentControls();
      render();
    } catch (err) {
      setSummary(`取出失败：${err.message}`);
    }
  };
  ui.depositModalClose.onclick = closeDepositModal;
  ui.depositCancelBtn.onclick = closeDepositModal;
  ui.depositModal.onclick = (evt) => {
    if (evt.target === ui.depositModal) closeDepositModal();
  };
  ui.depositSearchInput.oninput = () => {
    state.depositSearchText = String(ui.depositSearchInput.value || "").trim();
    renderDepositList();
  };
  ui.depositWearOnly.onchange = () => {
    state.depositWearOnly = !!ui.depositWearOnly.checked;
    renderDepositList();
  };
  ui.depositSelectAllBtn.onclick = () => {
    const rows = filteredDepositRows();
    state.depositSelectedIds = new Set(rows.map((x) => String(x.asset_id || "").trim()).filter(Boolean));
    renderDepositList();
  };
  ui.depositInvertBtn.onclick = () => {
    const rows = filteredDepositRows();
    const next = new Set();
    for (const row of rows) {
      const id = String(row.asset_id || "").trim();
      if (!id || state.depositSelectedIds.has(id)) continue;
      next.add(id);
    }
    state.depositSelectedIds = next;
    renderDepositList();
  };
  ui.depositConfirmBtn.onclick = async () => {
    const itemIds = [...state.depositSelectedIds];
    if (!itemIds.length) {
      setSummary("请先选择要存入组件的物品");
      return;
    }
    try {
      await runComponentMove("deposit", itemIds);
      closeDepositModal();
      render();
    } catch (err) {
      setSummary(`存入失败：${err.message}`);
    }
  };
  ui.pageSize.onchange = () => { state.pageSize = Number(ui.pageSize.value) || 90; state.page = 1; render(); };
  ui.prevBtn.onclick = () => { state.page -= 1; render(); };
  ui.nextBtn.onclick = () => { state.page += 1; render(); };
}

async function init() {
  bindEvents();
  initWearOptions();
  refreshRarityMenu();
  updateFilterDrawer();
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
