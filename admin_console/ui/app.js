const state = {
  token: window.localStorage.getItem("admin_console_token") || "",
  session: null,
  bootstrapNeeded: false,
  stats: null,
  plans: [],
  users: [],
  selectedUserId: 0,
  devices: [],
  bindings: []
};

const refs = {
  authPanel: document.querySelector("#authPanel"),
  authTitle: document.querySelector("#authTitle"),
  authHint: document.querySelector("#authHint"),
  authMessage: document.querySelector("#authMessage"),
  bootstrapForm: document.querySelector("#bootstrapForm"),
  bootstrapUsername: document.querySelector("#bootstrapUsername"),
  bootstrapPassword: document.querySelector("#bootstrapPassword"),
  loginForm: document.querySelector("#loginForm"),
  loginUsername: document.querySelector("#loginUsername"),
  loginPassword: document.querySelector("#loginPassword"),
  logoutButton: document.querySelector("#logoutButton"),
  workspace: document.querySelector("#workspace"),
  sessionSummary: document.querySelector("#sessionSummary"),
  statsGrid: document.querySelector("#statsGrid"),
  usersList: document.querySelector("#usersList"),
  detailHint: document.querySelector("#detailHint"),
  userForm: document.querySelector("#userForm"),
  userPlan: document.querySelector("#userPlan"),
  userStatus: document.querySelector("#userStatus"),
  userExpiryDate: document.querySelector("#userExpiryDate"),
  userExpiryTime: document.querySelector("#userExpiryTime"),
  membershipMeta: document.querySelector("#membershipMeta"),
  permissionList: document.querySelector("#permissionList"),
  deviceList: document.querySelector("#deviceList"),
  bindingList: document.querySelector("#bindingList")
};

const DEFAULT_EXPIRY_TIME = "23:59";

const FEATURE_CODES = [
  "accounts.read",
  "accounts.write",
  "inventory.read",
  "inventory.refresh",
  "craft.use",
  "simulation.use"
];

function setMessage(message = "", isError = false) {
  refs.authMessage.textContent = message;
  refs.authMessage.className = `alert auth-alert ${message ? "" : "d-none"} ${isError ? "alert-danger" : "alert-secondary"}`;
}

function getHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    ...(state.token ? {Authorization: `Bearer ${state.token}`} : {}),
    ...extra
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: getHeaders(options.headers || {})
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : {};
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || "请求失败");
  }
  return data;
}

function saveToken(token = "") {
  state.token = token;
  if (token) {
    window.localStorage.setItem("admin_console_token", token);
  } else {
    window.localStorage.removeItem("admin_console_token");
  }
}

function selectedUser() {
  return state.users.find((item) => item.id === state.selectedUserId) || null;
}

function selectedPlan() {
  return state.plans.find((item) => item.code === refs.userPlan.value) || null;
}

function toLocalDateTimeInput(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (number) => String(number).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoDateTime(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function formatLocalDateTimeText(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "未设置";
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }
  const pad = (number) => String(number).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + ` ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function clearElement(element) {
  if (element) {
    element.replaceChildren();
  }
}

function appendText(parent, text = "") {
  parent.appendChild(document.createTextNode(String(text || "")));
}

function createElement(tagName, {className = "", text = "", attrs = {}} = {}, children = []) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  for (const [name, value] of Object.entries(attrs || {})) {
    if (value !== undefined && value !== null) {
      element.setAttribute(name, String(value));
    }
  }
  if (text !== "") {
    element.textContent = String(text);
  }
  for (const child of children) {
    if (child === null || child === undefined) {
      continue;
    }
    if (typeof child === "string" || typeof child === "number") {
      appendText(element, child);
    } else {
      element.appendChild(child);
    }
  }
  return element;
}

function renderEmptyBlock(target, text = "") {
  clearElement(target);
  target.appendChild(createElement("div", {className: "empty-block", text}));
}

function normalizeTimeValue(value = "") {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return "";
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return "";
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function splitLocalDateTimeParts(value = "") {
  const text = toLocalDateTimeInput(value);
  if (!text) {
    return {
      dateValue: "",
      timeValue: DEFAULT_EXPIRY_TIME
    };
  }
  const [dateValue, rawTimeValue = DEFAULT_EXPIRY_TIME] = text.split("T");
  return {
    dateValue,
    timeValue: normalizeTimeValue(rawTimeValue) || DEFAULT_EXPIRY_TIME
  };
}

function toIsoDateTimeFromParts(dateValue = "", timeValue = "") {
  const dateText = String(dateValue || "").trim();
  if (!dateText) {
    return "";
  }
  const normalizedTime = normalizeTimeValue(timeValue) || DEFAULT_EXPIRY_TIME;
  return toIsoDateTime(`${dateText}T${normalizedTime}`);
}

function updateMembershipMetaPreview() {
  if (refs.userPlan.value === "trial") {
    refs.membershipMeta.textContent = "Trial：新注册用户默认获得 7 天普通版权限，期间允许炼金。";
    return;
  }
  if (refs.userPlan.value === "inactive") {
    refs.membershipMeta.textContent = "Inactive：体验到期或未开通，不能炼金，但保留既有 Steam 绑定资格。";
    return;
  }
  const expiryDateValue = String(refs.userExpiryDate.value || "").trim();
  const expiryIso = toIsoDateTimeFromParts(expiryDateValue, refs.userExpiryTime.value);
  refs.membershipMeta.textContent = expiryIso
    ? `当前计划：${refs.userPlan.value}，可按需覆盖单项权限。预计到期时间：${formatLocalDateTimeText(expiryIso)}。保存后控制台会自动重算剩余天数。`
    : `当前计划：${refs.userPlan.value}，可按需覆盖单项权限。请选择到期日期；若不调整时间，默认按 ${DEFAULT_EXPIRY_TIME} 处理。`;
}

function syncPermissionsFromPlan() {
  const plan = selectedPlan();
  const permissions = new Set((plan && plan.permissions) || []);
  FEATURE_CODES.forEach((code) => {
    const input = refs.permissionList.querySelector(`[data-feature-code="${code}"]`);
    if (input) {
      input.checked = permissions.has(code);
    }
  });
}

function renderAuth() {
  refs.bootstrapForm.hidden = !state.bootstrapNeeded;
  refs.loginForm.hidden = state.bootstrapNeeded;
  refs.authTitle.textContent = state.bootstrapNeeded ? "初始化超级管理员" : "管理员登录";
  refs.authHint.textContent = state.bootstrapNeeded
    ? "当前控制台尚未初始化。先创建第一个超级管理员账号。"
    : "使用控制台管理员账号进入管理面。";
  refs.logoutButton.hidden = !state.session;
  refs.workspace.hidden = !state.session;
  refs.authPanel.hidden = !!state.session;
}

function renderStats() {
  const stats = state.stats || {total_users: 0, active_users: 0, plans: 0};
  refs.sessionSummary.textContent = state.session
    ? `当前管理员：${state.session.user.username}`
    : "尚未登录";
  clearElement(refs.statsGrid);
  const strip = createElement("div", {className: "stats-strip"});
  [
    ["用户总数", stats.total_users, "Client Users"],
    ["活跃用户", stats.active_users, "Active Accounts"],
    ["会员计划", stats.plans, "Plan Templates"]
  ].forEach(([label, value, kicker]) => {
    const body = createElement("div", {className: "card-body"}, [
      createElement("div", {className: "stats-kicker", text: kicker}),
      createElement("div", {className: "stats-value", text: value}),
      createElement("div", {className: "text-secondary mt-2", text: label})
    ]);
    strip.appendChild(createElement("div", {className: "card"}, [body]));
  });
  refs.statsGrid.appendChild(strip);
}

function renderUsers() {
  if (!state.users.length) {
    renderEmptyBlock(refs.usersList, "当前没有终端用户。");
    return;
  }
  clearElement(refs.usersList);
  const table = createElement("table", {className: "table table-vcenter card-table users-table"});
  const thead = createElement("thead");
  const headerRow = createElement("tr");
  ["用户", "会员", "剩余天数", "状态", "最终权限"].forEach((label) => {
    headerRow.appendChild(createElement("th", {text: label}));
  });
  headerRow.appendChild(createElement("th", {className: "w-1"}));
  thead.appendChild(headerRow);
  const tbody = createElement("tbody");
  state.users.forEach((user) => {
    const row = createElement("tr", {
      className: user.id === state.selectedUserId ? "is-selected" : "",
      attrs: {"data-user-id": user.id}
    });
    row.appendChild(createElement("td", {}, [
      createElement("div", {className: "fw-semibold", text: user.username}),
      createElement("div", {className: "text-secondary", text: user.email})
    ]));
    row.appendChild(createElement("td", {}, [
      createElement("span", {className: "badge bg-blue-lt", text: user.membership_plan}),
      createElement("div", {className: "text-secondary mt-1", text: formatLocalDateTimeText(user.membership_expires_at)})
    ]));
    row.appendChild(createElement("td", {text: user.remaining_membership_days}));
    row.appendChild(createElement("td", {}, [
      createElement("span", {
        className: `badge ${user.status === "active" ? "bg-green-lt" : "bg-red-lt"}`,
        text: user.status
      })
    ]));
    const chips = createElement("div", {className: "feature-chips"});
    const permissions = (user.entitlements && user.entitlements.permissions) || [];
    if (permissions.length) {
      permissions.forEach((code) => {
        chips.appendChild(createElement("span", {className: "badge bg-secondary-lt", text: code}));
      });
    } else {
      chips.appendChild(createElement("span", {className: "text-secondary", text: "无"}));
    }
    row.appendChild(createElement("td", {}, [chips]));
    row.appendChild(createElement("td", {}, [
      createElement("button", {
        className: "btn btn-sm btn-outline-primary",
        text: "管理",
        attrs: {type: "button", "data-user-id": user.id}
      })
    ]));
    tbody.appendChild(row);
  });
  table.append(thead, tbody);
  refs.usersList.appendChild(table);
}

function renderUserDetail() {
  const user = selectedUser();
  if (!user) {
    refs.userForm.hidden = true;
    refs.detailHint.textContent = "选择左侧用户后即可调整会员、单项权限与设备授权。";
    renderEmptyBlock(refs.deviceList, "尚未选择用户。");
    return;
  }
  refs.userForm.hidden = false;
  refs.detailHint.textContent = `正在编辑 ${user.username}。`;
  clearElement(refs.userPlan);
  state.plans.forEach((plan) => {
    const option = createElement("option", {text: plan.code});
    option.value = String(plan.code || "");
    option.selected = plan.code === user.membership_plan;
    refs.userPlan.appendChild(option);
  });
  refs.userStatus.value = user.status;
  const expiryParts = splitLocalDateTimeParts(user.membership_expires_at);
  refs.userExpiryDate.value = expiryParts.dateValue;
  refs.userExpiryTime.value = expiryParts.timeValue;
  refs.userExpiryDate.disabled = user.membership_plan === "inactive";
  refs.userExpiryTime.disabled = user.membership_plan === "inactive";
  refs.userExpiryDate.required = user.membership_plan !== "inactive";
  refs.membershipMeta.textContent = user.membership_plan === "trial"
    ? "Trial：新注册用户默认获得 7 天普通版权限，期间允许炼金。"
    : user.membership_plan === "inactive"
      ? "Inactive：体验到期或未开通，不能炼金，但保留既有 Steam 绑定资格。"
      : user.membership_expires_at
        ? `当前计划：${user.membership_plan}，可按需覆盖单项权限。剩余 ${user.remaining_membership_days} 天，到期时间：${formatLocalDateTimeText(user.membership_expires_at)}`
        : `当前计划：${user.membership_plan}，可按需覆盖单项权限。请选择到期日期；若不调整时间，默认按 ${DEFAULT_EXPIRY_TIME} 处理。`;
  const permissions = new Set((user.entitlements && user.entitlements.permissions) || []);
  clearElement(refs.permissionList);
  FEATURE_CODES.forEach((code) => {
    const input = createElement("input", {
      className: "form-check-input",
      attrs: {type: "checkbox", "data-feature-code": code}
    });
    input.checked = permissions.has(code);
    const label = createElement("label", {className: "form-check form-switch"}, [
      createElement("span", {className: "form-check-label", text: code}),
      input
    ]);
    refs.permissionList.appendChild(createElement("div", {className: "permission-row"}, [
      label,
      createElement("div", {
        className: "permission-hint",
        text: "计划模板 + 用户覆盖共同决定控制签名快照是否下发此功能。"
      })
    ]));
  });
  renderDevices();
  renderBindings();
}

function renderDevices() {
  const user = selectedUser();
  if (!user) {
    renderEmptyBlock(refs.deviceList, "尚未选择用户。");
    return;
  }
  if (!state.devices.length) {
    renderEmptyBlock(refs.deviceList, "当前没有活跃设备。");
    return;
  }
  clearElement(refs.deviceList);
  const stack = createElement("div", {className: "device-stack"});
  state.devices.forEach((item) => {
    stack.appendChild(createElement("article", {className: "device-item"}, [
      createElement("h4", {text: item.device_id}),
      createElement("div", {className: "device-meta", text: `最后使用：${item.last_used_at || item.created_at}`}),
      createElement("div", {className: "device-meta", text: `过期时间：${formatLocalDateTimeText(item.expires_at)}`}),
      createElement("button", {
        className: "btn btn-sm btn-outline-danger",
        text: "吊销设备",
        attrs: {type: "button", "data-session-id": item.id}
      })
    ]));
  });
  refs.deviceList.appendChild(stack);
}

function renderBindings() {
  const user = selectedUser();
  if (!user) {
    renderEmptyBlock(refs.bindingList, "尚未选择用户。");
    return;
  }
  if (!state.bindings.length) {
    renderEmptyBlock(refs.bindingList, "当前没有占用中的 Steam 绑定资格。");
    return;
  }
  clearElement(refs.bindingList);
  const stack = createElement("div", {className: "device-stack"});
  state.bindings.forEach((item) => {
    stack.appendChild(createElement("article", {className: "device-item"}, [
      createElement("h4", {text: item.steam_account_name || item.steam_id}),
      createElement("div", {className: "device-meta", text: `SteamID：${item.steam_id}`}),
      createElement("div", {className: "device-meta", text: `首次绑定：${formatLocalDateTimeText(item.first_bound_at)}`}),
      createElement("div", {className: "device-meta", text: `最近使用：${formatLocalDateTimeText(item.last_seen_at)}`}),
      createElement("button", {
        className: "btn btn-sm btn-outline-danger",
        text: "解除绑定资格",
        attrs: {type: "button", "data-binding-id": item.id}
      })
    ]));
  });
  refs.bindingList.appendChild(stack);
}

async function loadSession() {
  const bootstrap = await api("/api/admin/bootstrap/state", {method: "GET"});
  state.bootstrapNeeded = !!bootstrap.needs_bootstrap;
  if (!state.token) {
    state.session = null;
    renderAuth();
    return;
  }
  try {
    const session = await api("/api/admin/session", {method: "GET"});
    state.session = session.authenticated ? session : null;
  } catch (_) {
    saveToken("");
    state.session = null;
  }
  renderAuth();
}

async function loadDashboard() {
  if (!state.session) {
    return;
  }
  const [overview, plans, users] = await Promise.all([
    api("/api/admin/overview", {method: "GET"}),
    api("/api/admin/plans", {method: "GET"}),
    api("/api/admin/users", {method: "GET"})
  ]);
  state.stats = overview.stats;
  state.plans = plans.items || [];
  state.users = users.items || [];
  if (!state.users.find((item) => item.id === state.selectedUserId)) {
    state.selectedUserId = state.users[0] ? state.users[0].id : 0;
  }
  renderStats();
  renderUsers();
  await loadSelectedUserRuntimeDetails();
}

async function loadSelectedUserRuntimeDetails() {
  const user = selectedUser();
  if (!user || !state.session) {
    state.devices = [];
    state.bindings = [];
    renderUserDetail();
    return;
  }
  const [devicesResponse, bindingsResponse] = await Promise.all([
    api(`/api/admin/users/${user.id}/devices`, {method: "GET"}),
    api(`/api/admin/users/${user.id}/steam-bindings`, {method: "GET"})
  ]);
  state.devices = devicesResponse.items || [];
  state.bindings = bindingsResponse.items || [];
  renderUserDetail();
}

async function handleBootstrap(event) {
  event.preventDefault();
  try {
    await api("/api/admin/bootstrap", {
      method: "POST",
      body: JSON.stringify({
        username: refs.bootstrapUsername.value.trim() || "admin",
        password: refs.bootstrapPassword.value.trim()
      })
    });
    setMessage("超级管理员已初始化，请直接登录。");
    state.bootstrapNeeded = false;
    refs.bootstrapPassword.value = "";
    renderAuth();
  } catch (err) {
    setMessage(err.message, true);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  try {
    const data = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        username: refs.loginUsername.value.trim() || "admin",
        password: refs.loginPassword.value.trim()
      })
    });
    saveToken(data.session_token || "");
    refs.loginPassword.value = "";
    setMessage("");
    await loadSession();
    await loadDashboard();
  } catch (err) {
    setMessage(err.message, true);
  }
}

async function handleLogout() {
  try {
    await api("/api/admin/logout", {method: "POST", body: JSON.stringify({})});
  } catch (_) {
  }
  saveToken("");
  state.session = null;
  state.stats = null;
  state.users = [];
  state.selectedUserId = 0;
  state.devices = [];
  state.bindings = [];
  await loadSession();
}

async function handleUserSubmit(event) {
  event.preventDefault();
  const user = selectedUser();
  if (!user) {
    return;
  }
  const permissionOverrides = FEATURE_CODES.map((code) => ({
    feature_code: code,
    enabled: Boolean(refs.permissionList.querySelector(`[data-feature-code="${code}"]`)?.checked)
  }));
  try {
    await api(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        membership_plan: refs.userPlan.value,
        status: refs.userStatus.value,
        membership_expires_at: refs.userPlan.value === "inactive"
          ? ""
          : toIsoDateTimeFromParts(refs.userExpiryDate.value, refs.userExpiryTime.value),
        permission_overrides: permissionOverrides
      })
    });
    await loadDashboard();
  } catch (err) {
    setMessage(err.message, true);
  }
}

async function handleWorkspaceClick(event) {
  const userButton = event.target.closest("[data-user-id]");
  if (userButton) {
    state.selectedUserId = Number(userButton.getAttribute("data-user-id")) || 0;
    await loadSelectedUserRuntimeDetails();
    renderUsers();
    return;
  }
  const sessionButton = event.target.closest("[data-session-id]");
  if (sessionButton) {
    const user = selectedUser();
    if (!user) {
      return;
    }
    const sessionId = sessionButton.getAttribute("data-session-id");
    if (!window.confirm("确认吊销该设备？该设备上的客户端需要重新登录后才能继续使用。")) {
      return;
    }
    const originalText = sessionButton.textContent;
    sessionButton.disabled = true;
    sessionButton.textContent = "吊销中...";
    try {
      const result = await api(`/api/admin/users/${user.id}/devices/${sessionId}/revoke`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setMessage(result.message || "设备已吊销");
      await loadSelectedUserRuntimeDetails();
      await loadDashboard();
    } catch (err) {
      setMessage(err.message || "设备吊销失败", true);
    } finally {
      sessionButton.disabled = false;
      sessionButton.textContent = originalText || "吊销设备";
    }
    return;
  }
  const bindingButton = event.target.closest("[data-binding-id]");
  if (bindingButton) {
    const user = selectedUser();
    if (!user) {
      return;
    }
    const bindingId = bindingButton.getAttribute("data-binding-id");
    if (!window.confirm("确认解除该 Steam 绑定资格？该操作会允许用户重新绑定新的 Steam 账号。")) {
      return;
    }
    await api(`/api/admin/users/${user.id}/steam-bindings/${bindingId}/revoke`, {
      method: "POST",
      body: JSON.stringify({note: "manual_reset"})
    });
    await loadSelectedUserRuntimeDetails();
    await loadDashboard();
  }
}

async function init() {
  refs.bootstrapForm.addEventListener("submit", handleBootstrap);
  refs.loginForm.addEventListener("submit", handleLogin);
  refs.logoutButton.addEventListener("click", handleLogout);
  refs.userForm.addEventListener("submit", handleUserSubmit);
  refs.userPlan.addEventListener("change", () => {
    refs.userExpiryDate.disabled = refs.userPlan.value === "inactive";
    refs.userExpiryTime.disabled = refs.userPlan.value === "inactive";
    refs.userExpiryDate.required = refs.userPlan.value !== "inactive";
    if (refs.userPlan.value === "inactive") {
      refs.userExpiryDate.value = "";
      refs.userExpiryTime.value = DEFAULT_EXPIRY_TIME;
    } else {
      refs.userExpiryTime.value = normalizeTimeValue(refs.userExpiryTime.value) || DEFAULT_EXPIRY_TIME;
    }
    updateMembershipMetaPreview();
    syncPermissionsFromPlan();
  });
  refs.userExpiryDate.addEventListener("input", updateMembershipMetaPreview);
  refs.userExpiryTime.addEventListener("change", () => {
    refs.userExpiryTime.value = normalizeTimeValue(refs.userExpiryTime.value) || DEFAULT_EXPIRY_TIME;
    updateMembershipMetaPreview();
  });
  refs.usersList.addEventListener("click", handleWorkspaceClick);
  refs.deviceList.addEventListener("click", handleWorkspaceClick);
  refs.bindingList.addEventListener("click", handleWorkspaceClick);
  await loadSession();
  if (state.session) {
    await loadDashboard();
  }
}

init().catch((err) => {
  setMessage(err.message || "控制台加载失败", true);
});
