const state = {
  csrfToken: "",
  session: null,
  bootstrapNeeded: false,
  activeView: "users",
  stats: null,
  plans: [],
  users: [],
  selectedUserId: 0,
  selectedUserIds: new Set(),
  devices: [],
  activationCodes: [],
  activationResult: [],
  products: [],
  selectedProductId: 0,
  orders: []
};

const refs = Object.fromEntries([
  "authPanel", "authTitle", "authHint", "authMessage", "bootstrapForm", "bootstrapUsername",
  "bootstrapPassword", "loginForm", "loginUsername", "loginPassword", "logoutButton", "workspace",
  "workspaceTitle", "workspaceNav", "sessionSummary", "globalMessage", "statsGrid", "usersView",
  "activationCodesView", "productsView", "ordersView", "bulkGrantForm", "bulkGrantDays",
  "showArchivedUsers", "createUserForm", "createUsername", "createEmail", "createPassword",
  "createMembershipDays", "usersList", "detailHint", "userForm", "userPlan", "userStatus",
  "userExpiryDate", "userExpiryTime", "membershipMeta", "permissionList", "archiveUserButton",
  "restoreUserButton", "resetPasswordForm", "resetPasswordValue", "generatePasswordButton", "generatedPasswordResult", "deviceList",
  "activationCodeForm", "activationDays", "activationCount", "activationExpiresAt", "activationResult",
  "activationResultCodes", "activationStatusFilter", "activationCodesList", "productForm", "productFormTitle",
  "productName", "productDescription", "productDays", "productPriceCents", "productSortOrder",
  "productEnabled", "productsList", "ordersList"
].map((id) => [id, document.querySelector(`#${id}`)]));

const DEFAULT_EXPIRY_TIME = "23:59";
const VIEW_TITLES = {users: "用户管理", activationCodes: "激活码管理", products: "充值商品", orders: "订单管理"};
const FEATURE_CODES = ["accounts.read", "accounts.write", "inventory.read", "inventory.refresh", "craft.use", "simulation.use"];

function setMessage(message = "", isError = false, target = refs.globalMessage) {
  target.textContent = message;
  target.className = `alert ${message ? "" : "d-none"} ${isError ? "alert-danger" : "alert-success"}`;
}

function isMutationMethod(method = "GET") {
  return !["GET", "HEAD", "OPTIONS"].includes(String(method || "GET").toUpperCase());
}

function getHeaders(method = "GET", extra = {}) {
  return {
    "Content-Type": "application/json",
    ...(isMutationMethod(method) && state.csrfToken ? {"X-CSRF-Token": state.csrfToken} : {}),
    ...extra
  };
}

async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const response = await fetch(path, {
    ...options,
    method,
    credentials: "same-origin",
    headers: getHeaders(method, options.headers || {})
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : {};
  if (!response.ok || data.ok === false) {
    const error = new Error(data.message || "请求失败");
    error.code = data.reason || data.code || "request_failed";
    throw error;
  }
  return data;
}

function selectedUser() {
  return state.users.find((item) => Number(item.id) === Number(state.selectedUserId)) || null;
}

function selectedPlan() {
  return state.plans.find((item) => item.code === refs.userPlan.value) || null;
}

function listFrom(data, keys = []) {
  for (const key of ["items", ...keys]) {
    if (Array.isArray(data && data[key])) return data[key];
  }
  return [];
}

function toLocalDateTimeInput(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoDateTime(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function formatLocalDateTimeText(value = "") {
  const text = String(value || "").trim();
  if (!text) return "未设置";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeTimeValue(value = "") {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function splitLocalDateTimeParts(value = "") {
  const text = toLocalDateTimeInput(value);
  if (!text) return {dateValue: "", timeValue: DEFAULT_EXPIRY_TIME};
  const [dateValue, rawTimeValue = DEFAULT_EXPIRY_TIME] = text.split("T");
  return {dateValue, timeValue: normalizeTimeValue(rawTimeValue) || DEFAULT_EXPIRY_TIME};
}

function toIsoDateTimeFromParts(dateValue = "", timeValue = "") {
  const dateText = String(dateValue || "").trim();
  if (!dateText) return "";
  return toIsoDateTime(`${dateText}T${normalizeTimeValue(timeValue) || DEFAULT_EXPIRY_TIME}`);
}

function syncPermissionsFromPlan() {
  const permissions = new Set((selectedPlan() && selectedPlan().permissions) || []);
  FEATURE_CODES.forEach((code) => {
    const input = refs.permissionList.querySelector(`[data-feature-code="${code}"]`);
    if (input) input.checked = permissions.has(code);
  });
}

function clearElement(element) {
  if (element) element.replaceChildren();
}

function createElement(tagName, {className = "", text = "", attrs = {}} = {}, children = []) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  Object.entries(attrs).forEach(([name, value]) => {
    if (value !== undefined && value !== null) element.setAttribute(name, String(value));
  });
  if (text !== "") element.textContent = String(text);
  children.filter((child) => child !== null && child !== undefined).forEach((child) => {
    element.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  });
  return element;
}

function renderEmptyBlock(target, text) {
  clearElement(target);
  target.appendChild(createElement("div", {className: "empty-block", text}));
}

function updateMembershipMetaPreview() {
  if (refs.userPlan.value === "inactive") {
    refs.membershipMeta.textContent = "Inactive：可使用除真实炼金外的全部当前功能。";
    return;
  }
  const expiry = toIsoDateTimeFromParts(refs.userExpiryDate.value, refs.userExpiryTime.value);
  refs.membershipMeta.textContent = expiry
    ? `Member：拥有全部当前功能，包括真实炼金。预计到期：${formatLocalDateTimeText(expiry)}。`
    : "Member：拥有全部当前功能，包括真实炼金。请选择到期时间。";
}

function isArchived(user) {
  return Boolean(user && (user.archived_at || user.is_archived || user.archived));
}

function isProductEnabled(item) {
  return Boolean(item && (item.is_enabled ?? item.enabled));
}

function renderAuth() {
  refs.bootstrapForm.hidden = !state.bootstrapNeeded;
  refs.loginForm.hidden = state.bootstrapNeeded;
  refs.authTitle.textContent = state.bootstrapNeeded ? "初始化超级管理员" : "管理员登录";
  refs.authHint.textContent = state.bootstrapNeeded ? "创建本地控制台的第一个超级管理员。" : "使用本地控制台管理员账号登录。";
  refs.logoutButton.hidden = !state.session;
  refs.workspace.hidden = !state.session;
  refs.authPanel.hidden = Boolean(state.session);
}

function renderStats() {
  const stats = state.stats || {};
  refs.sessionSummary.textContent = state.session ? `当前管理员：${state.session.user && state.session.user.username || "admin"}` : "尚未登录";
  clearElement(refs.statsGrid);
  [["用户总数", stats.total_users ?? state.users.length], ["有效账号", stats.active_users ?? state.users.filter((user) => user.status === "active").length], ["启用商品", stats.enabled_products ?? state.products.filter(isProductEnabled).length]].forEach(([label, value]) => {
    refs.statsGrid.appendChild(createElement("div", {className: "stat-item"}, [createElement("strong", {text: value}), createElement("span", {text: label})]));
  });
}

function setActiveView(view) {
  if (!VIEW_TITLES[view]) return;
  state.activeView = view;
  refs.workspaceTitle.textContent = VIEW_TITLES[view];
  Object.entries({users: refs.usersView, activationCodes: refs.activationCodesView, products: refs.productsView, orders: refs.ordersView}).forEach(([name, element]) => { element.hidden = name !== view; });
  refs.workspaceNav.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.getAttribute("data-view") === view));
}

function renderUsers() {
  const visibleUsers = state.users.filter((user) => refs.showArchivedUsers.checked || !isArchived(user));
  if (!visibleUsers.length) return renderEmptyBlock(refs.usersList, refs.showArchivedUsers.checked ? "当前没有终端用户。" : "当前没有未归档用户。");
  clearElement(refs.usersList);
  const table = createElement("table", {className: "table table-vcenter card-table users-table"});
  const head = createElement("thead");
  const header = createElement("tr");
  ["", "用户", "会员", "到期", "状态", "操作"].forEach((label) => header.appendChild(createElement("th", {text: label})));
  head.appendChild(header);
  const body = createElement("tbody");
  visibleUsers.forEach((user) => {
    const row = createElement("tr", {className: Number(user.id) === Number(state.selectedUserId) ? "is-selected" : "", attrs: {"data-user-id": user.id}});
    const checkbox = createElement("input", {className: "form-check-input", attrs: {type: "checkbox", "data-user-select": user.id, "aria-label": `选择 ${user.username}`}});
    checkbox.checked = state.selectedUserIds.has(Number(user.id));
    row.appendChild(createElement("td", {}, [checkbox]));
    row.appendChild(createElement("td", {}, [createElement("div", {className: "fw-semibold", text: user.username}), createElement("div", {className: "text-secondary", text: user.email})]));
    row.appendChild(createElement("td", {}, [createElement("span", {className: `badge ${user.membership_plan === "member" ? "bg-green-lt" : "bg-secondary-lt"}`, text: user.membership_plan || "inactive"})]));
    row.appendChild(createElement("td", {text: formatLocalDateTimeText(user.membership_expires_at)}));
    row.appendChild(createElement("td", {}, [createElement("span", {className: `badge ${isArchived(user) ? "bg-yellow-lt" : user.status === "active" ? "bg-green-lt" : "bg-red-lt"}`, text: isArchived(user) ? "archived" : user.status})]));
    row.appendChild(createElement("td", {}, [createElement("button", {className: "btn btn-sm btn-outline-primary", text: "管理", attrs: {type: "button", "data-user-id": user.id}})]));
    body.appendChild(row);
  });
  table.append(head, body);
  refs.usersList.appendChild(table);
}

function renderDevices() {
  if (!selectedUser()) return renderEmptyBlock(refs.deviceList, "尚未选择用户。");
  if (!state.devices.length) return renderEmptyBlock(refs.deviceList, "当前没有活跃设备。");
  clearElement(refs.deviceList);
  const stack = createElement("div", {className: "device-stack"});
  state.devices.forEach((item) => stack.appendChild(createElement("div", {className: "device-item"}, [
    createElement("div", {}, [createElement("strong", {text: item.device_id}), createElement("div", {className: "text-secondary", text: `最后使用：${formatLocalDateTimeText(item.last_used_at || item.created_at)}`})]),
    createElement("button", {className: "btn btn-sm btn-outline-danger", text: "吊销设备", attrs: {type: "button", "data-session-id": item.id}})
  ])));
  refs.deviceList.appendChild(stack);
}

function renderUserDetail() {
  const user = selectedUser();
  if (!user) {
    refs.userForm.hidden = true;
    refs.resetPasswordForm.hidden = true;
    refs.detailHint.textContent = "尚未选择用户。";
    return renderDevices();
  }
  refs.userForm.hidden = false;
  refs.resetPasswordForm.hidden = false;
  refs.detailHint.textContent = `正在编辑 ${user.username}。`;
  clearElement(refs.userPlan);
  const plans = state.plans.filter((plan) => ["inactive", "member"].includes(plan.code));
  (plans.length ? plans : [{code: "inactive", permissions: FEATURE_CODES.filter((code) => code !== "craft.use")}, {code: "member", permissions: FEATURE_CODES}]).forEach((plan) => {
    const option = createElement("option", {text: plan.code});
    option.value = plan.code;
    option.selected = plan.code === user.membership_plan;
    refs.userPlan.appendChild(option);
  });
  refs.userPlan.value = user.membership_plan || "inactive";
  refs.userStatus.value = user.status || "active";
  const parts = splitLocalDateTimeParts(user.membership_expires_at);
  refs.userExpiryDate.value = parts.dateValue;
  refs.userExpiryTime.value = parts.timeValue;
  const inactive = refs.userPlan.value === "inactive";
  refs.userExpiryDate.disabled = inactive;
  refs.userExpiryTime.disabled = inactive;
  refs.userExpiryDate.required = !inactive;
  updateMembershipMetaPreview();
  clearElement(refs.permissionList);
  const permissions = new Set(user.entitlements && user.entitlements.permissions || []);
  FEATURE_CODES.forEach((code) => {
    const input = createElement("input", {className: "form-check-input", attrs: {type: "checkbox", "data-feature-code": code}});
    input.checked = permissions.has(code);
    refs.permissionList.appendChild(createElement("label", {className: "permission-row"}, [createElement("span", {text: code}), input]));
  });
  refs.archiveUserButton.hidden = isArchived(user);
  refs.restoreUserButton.hidden = !isArchived(user);
  refs.generatedPasswordResult.hidden = true;
  renderDevices();
}

function activationStatus(item) {
  if (item.status) return item.status;
  if (item.revoked_at) return "revoked";
  if (item.used_at || item.redeemed_at) return "used";
  if (item.expires_at && new Date(item.expires_at).getTime() <= Date.now()) return "expired";
  return "unused";
}

function renderActivationCodes() {
  if (!state.activationCodes.length) return renderEmptyBlock(refs.activationCodesList, "当前没有激活码。");
  clearElement(refs.activationCodesList);
  const table = createElement("table", {className: "table table-vcenter card-table"});
  const head = createElement("thead", {}, [createElement("tr", {}, ["掩码", "批次", "天数", "状态", "失效时间", "操作"].map((label) => createElement("th", {text: label})))]);
  const body = createElement("tbody");
  state.activationCodes.forEach((item) => {
    const status = activationStatus(item);
    const cells = [item.masked_code || item.code_mask || item.mask || "-", item.batch_id || item.batch || "-", item.membership_days ?? item.days, status, formatLocalDateTimeText(item.expires_at)].map((text) => createElement("td", {text}));
    cells.push(createElement("td", {}, [(status === "available" || status === "unused") ? createElement("button", {className: "btn btn-sm btn-outline-danger", text: "撤销", attrs: {type: "button", "data-revoke-code-id": item.id}}) : createElement("span", {className: "text-secondary", text: "-"})]));
    body.appendChild(createElement("tr", {}, cells));
  });
  table.append(head, body);
  refs.activationCodesList.appendChild(table);
}

function renderActivationResult() {
  refs.activationResult.hidden = !state.activationResult.length;
  refs.activationResultCodes.textContent = state.activationResult.join("\n");
}

function formatPrice(cents) {
  return `¥${(Number(cents || 0) / 100).toFixed(2)}`;
}

function renderProducts() {
  if (!state.products.length) return renderEmptyBlock(refs.productsList, "当前没有充值商品，请先创建商品模板。");
  clearElement(refs.productsList);
  const table = createElement("table", {className: "table table-vcenter card-table"});
  const head = createElement("thead", {}, [createElement("tr", {}, ["商品", "会员天数", "价格", "排序", "状态", "操作"].map((label) => createElement("th", {text: label})))]);
  const body = createElement("tbody");
  state.products.forEach((item) => body.appendChild(createElement("tr", {}, [
    createElement("td", {}, [createElement("div", {className: "fw-semibold", text: item.name}), createElement("div", {className: "text-secondary", text: item.description || "无描述"})]),
    createElement("td", {text: item.membership_days ?? item.days}), createElement("td", {text: formatPrice(item.price_cents)}), createElement("td", {text: item.sort_order ?? 0}),
    createElement("td", {}, [createElement("span", {className: `badge ${isProductEnabled(item) ? "bg-green-lt" : "bg-secondary-lt"}`, text: isProductEnabled(item) ? "启用" : "停用"})]),
    createElement("td", {}, [
      createElement("button", {className: "btn btn-sm btn-outline-primary", text: "编辑", attrs: {type: "button", "data-edit-product-id": item.id}}),
      createElement("button", {className: "btn btn-sm btn-outline-danger ms-2", text: "删除", attrs: {type: "button", "data-delete-product-id": item.id}})
    ])
  ])));
  table.append(head, body);
  refs.productsList.appendChild(table);
}

function renderOrders() {
  if (!state.orders.length) return renderEmptyBlock(refs.ordersList, "当前没有订单。支付接入前不会创建占位订单。");
  clearElement(refs.ordersList);
  const table = createElement("table", {className: "table table-vcenter card-table"});
  const head = createElement("thead", {}, [createElement("tr", {}, ["订单号", "用户", "商品", "金额", "状态", "渠道 / 外部交易号", "创建时间"].map((label) => createElement("th", {text: label})))]);
  const body = createElement("tbody");
  state.orders.forEach((item) => body.appendChild(createElement("tr", {}, [
    createElement("td", {text: item.order_no || item.order_number}), createElement("td", {text: item.username || item.user_snapshot && item.user_snapshot.username || item.user_id}),
    createElement("td", {text: item.product_name || item.product_snapshot && item.product_snapshot.name || "-"}), createElement("td", {text: formatPrice(item.amount_cents)}),
    createElement("td", {}, [createElement("span", {className: "badge bg-secondary-lt", text: item.status})]), createElement("td", {text: [item.provider, item.external_transaction_id].filter(Boolean).join(" / ") || "-"}),
    createElement("td", {text: formatLocalDateTimeText(item.created_at)})
  ])));
  table.append(head, body);
  refs.ordersList.appendChild(table);
}

async function loadSession() {
  const bootstrap = await api("/api/admin/bootstrap/state", {method: "GET"});
  state.bootstrapNeeded = Boolean(bootstrap.needs_bootstrap);
  if (state.bootstrapNeeded) {
    state.session = null;
    state.csrfToken = "";
    return renderAuth();
  }
  try {
    const session = await api("/api/admin/session", {method: "GET"});
    state.session = session.authenticated === false ? null : (session.session || session);
    state.csrfToken = session.csrf_token || state.session && state.session.csrf_token || "";
  } catch (_) {
    state.session = null;
    state.csrfToken = "";
  }
  renderAuth();
}

async function loadUsers() {
  const query = refs.showArchivedUsers.checked ? "?include_archived=1" : "";
  const response = await api(`/api/admin/users${query}`, {method: "GET"});
  state.users = listFrom(response, ["users"]);
  if (!state.users.some((item) => Number(item.id) === Number(state.selectedUserId))) state.selectedUserId = state.users[0] && state.users[0].id || 0;
  renderUsers();
  await loadSelectedUserRuntimeDetails();
}

async function loadSelectedUserRuntimeDetails() {
  const user = selectedUser();
  if (!user || !state.session) {
    state.devices = [];
    return renderUserDetail();
  }
  const response = await api(`/api/admin/users/${user.id}/devices`, {method: "GET"});
  state.devices = listFrom(response, ["devices"]);
  renderUserDetail();
}

async function loadActivationCodes() {
  const status = refs.activationStatusFilter.value;
  const response = await api(`/api/admin/activation-codes${status ? `?status=${encodeURIComponent(status)}` : ""}`, {method: "GET"});
  state.activationCodes = listFrom(response, ["activation_codes", "codes"]);
  renderActivationCodes();
}

async function loadProducts() {
  const response = await api("/api/admin/products", {method: "GET"});
  state.products = listFrom(response, ["products"]);
  renderProducts();
  renderStats();
}

async function loadOrders() {
  const response = await api("/api/admin/orders", {method: "GET"});
  state.orders = listFrom(response, ["orders"]);
  renderOrders();
}

async function loadOverviewStats() {
  const overview = await api("/api/admin/overview", {method: "GET"});
  state.stats = overview.stats || {};
  renderStats();
}

async function loadDashboard() {
  if (!state.session) return;
  const plans = await api("/api/admin/plans", {method: "GET"});
  state.plans = listFrom(plans, ["plans"]);
  await Promise.all([loadOverviewStats(), loadUsers(), loadActivationCodes(), loadProducts(), loadOrders()]);
  renderStats();
}

async function handleBootstrap(event) {
  event.preventDefault();
  try {
    await api("/api/admin/bootstrap", {method: "POST", body: JSON.stringify({username: refs.bootstrapUsername.value.trim() || "admin", password: refs.bootstrapPassword.value})});
    refs.bootstrapPassword.value = "";
    state.bootstrapNeeded = false;
    setMessage("超级管理员已初始化，请登录。", false, refs.authMessage);
    renderAuth();
  } catch (error) { setMessage(error.message, true, refs.authMessage); }
}

async function handleLogin(event) {
  event.preventDefault();
  try {
    const data = await api("/api/admin/login", {method: "POST", body: JSON.stringify({username: refs.loginUsername.value.trim() || "admin", password: refs.loginPassword.value})});
    refs.loginPassword.value = "";
    state.csrfToken = data.csrf_token || "";
    await loadSession();
    await loadDashboard();
    setMessage("");
  } catch (error) { setMessage(error.message, true, refs.authMessage); }
}

async function handleLogout() {
  try { await api("/api/admin/logout", {method: "POST", body: "{}"}); } catch (_) {}
  state.session = null;
  state.csrfToken = "";
  state.selectedUserIds.clear();
  await loadSession();
}

async function handleUserSubmit(event) {
  event.preventDefault();
  const user = selectedUser();
  if (!user) return;
  const permission_overrides = FEATURE_CODES.map((feature_code) => ({feature_code, enabled: Boolean(refs.permissionList.querySelector(`[data-feature-code="${feature_code}"]`)?.checked)}));
  try {
    await api(`/api/admin/users/${user.id}`, {method: "PATCH", body: JSON.stringify({membership_plan: refs.userPlan.value, status: refs.userStatus.value, membership_expires_at: refs.userPlan.value === "inactive" ? "" : toIsoDateTimeFromParts(refs.userExpiryDate.value, refs.userExpiryTime.value), permission_overrides})});
    await loadUsers();
    setMessage("用户配置已保存。");
  } catch (error) { setMessage(error.message, true); }
}

async function handleCreateUser(event) {
  event.preventDefault();
  try {
    await api("/api/admin/users", {method: "POST", body: JSON.stringify({username: refs.createUsername.value.trim(), email: refs.createEmail.value.trim(), password: refs.createPassword.value, membership_days: Number(refs.createMembershipDays.value || 0)})});
    refs.createUserForm.reset(); refs.createMembershipDays.value = "0"; refs.createUserForm.hidden = true;
    await Promise.all([loadUsers(), loadOverviewStats()]); setMessage("用户已创建。");
  } catch (error) { setMessage(error.message, true); }
}

async function handleBulkGrant(event) {
  event.preventDefault();
  const user_ids = [...state.selectedUserIds];
  if (!user_ids.length) return setMessage("请先勾选需要授权的用户。", true);
  try {
    await api("/api/admin/users/bulk-grant", {method: "POST", body: JSON.stringify({user_ids, days: Number(refs.bulkGrantDays.value)})});
    await loadUsers(); setMessage(`已为 ${user_ids.length} 个用户增加会员天数。`);
  } catch (error) { setMessage(error.message, true); }
}

async function handleResetPassword(event) {
  event.preventDefault();
  const user = selectedUser();
  if (!user) return;
  try {
    const password = refs.resetPasswordValue.value;
    const result = await api(`/api/admin/users/${user.id}/reset-password`, {method: "POST", body: JSON.stringify(password ? {new_password: password} : {generate: true})});
    refs.resetPasswordValue.value = "";
    const generated = result.generated_password || result.temporary_password || result.password || "";
    refs.generatedPasswordResult.hidden = !generated;
    refs.generatedPasswordResult.textContent = generated ? `临时密码（仅展示一次）：${generated}` : "密码已重置。";
    setMessage("密码已重置，用户的现有会话已吊销。");
  } catch (error) { setMessage(error.message, true); }
}

async function handleActivationSubmit(event) {
  event.preventDefault();
  try {
    const result = await api("/api/admin/activation-codes", {method: "POST", body: JSON.stringify({days: Number(refs.activationDays.value), count: Number(refs.activationCount.value), expires_at: toIsoDateTime(refs.activationExpiresAt.value) || null})});
    const raw = listFrom(result, ["raw_codes", "codes", "activation_codes"]);
    state.activationResult = raw.map((item) => typeof item === "string" ? item : item.code || item.raw_code).filter(Boolean);
    renderActivationResult(); await loadActivationCodes(); setMessage(`已生成 ${state.activationResult.length} 个激活码。`);
  } catch (error) { setMessage(error.message, true); }
}

function resetProductForm() {
  state.selectedProductId = 0; refs.productForm.reset(); refs.productEnabled.checked = true; refs.productSortOrder.value = "0"; refs.productFormTitle.textContent = "创建充值商品";
}

async function handleProductSubmit(event) {
  event.preventDefault();
  const payload = {name: refs.productName.value.trim(), description: refs.productDescription.value.trim(), membership_days: Number(refs.productDays.value), price_cents: Number(refs.productPriceCents.value), is_enabled: refs.productEnabled.checked, sort_order: Number(refs.productSortOrder.value || 0)};
  try {
    await api(state.selectedProductId ? `/api/admin/products/${state.selectedProductId}` : "/api/admin/products", {method: state.selectedProductId ? "PATCH" : "POST", body: JSON.stringify(payload)});
    resetProductForm(); await Promise.all([loadProducts(), loadOverviewStats()]); setMessage("充值商品已保存。");
  } catch (error) { setMessage(error.message, true); }
}

async function handleWorkspaceClick(event) {
  const checkbox = event.target.closest("[data-user-select]");
  if (checkbox) {
    const id = Number(checkbox.getAttribute("data-user-select"));
    checkbox.checked ? state.selectedUserIds.add(id) : state.selectedUserIds.delete(id);
    return;
  }
  const userButton = event.target.closest("[data-user-id]");
  if (userButton) { state.selectedUserId = Number(userButton.getAttribute("data-user-id")); await loadSelectedUserRuntimeDetails(); renderUsers(); return; }
  const sessionButton = event.target.closest("[data-session-id]");
  if (sessionButton && selectedUser() && window.confirm("确认吊销该设备？")) {
    sessionButton.disabled = true;
    try { await api(`/api/admin/users/${selectedUser().id}/devices/${sessionButton.getAttribute("data-session-id")}/revoke`, {method: "POST", body: "{}"}); await loadSelectedUserRuntimeDetails(); setMessage("设备已吊销。"); }
    catch (error) { setMessage(error.message, true); } finally { sessionButton.disabled = false; }
    return;
  }
  const revoke = event.target.closest("[data-revoke-code-id]");
  if (revoke && window.confirm("确认撤销该未使用激活码？")) { try { await api(`/api/admin/activation-codes/${revoke.getAttribute("data-revoke-code-id")}/revoke`, {method: "POST", body: "{}"}); await loadActivationCodes(); setMessage("激活码已撤销。"); } catch (error) { setMessage(error.message, true); } return; }
  const deleteProductButton = event.target.closest("[data-delete-product-id]");
  if (deleteProductButton && window.confirm("确认删除该商品模板？已被订单引用的商品无法删除。")) {
    try {
      await api(`/api/admin/products/${deleteProductButton.getAttribute("data-delete-product-id")}`, {method: "DELETE"});
      resetProductForm(); await Promise.all([loadProducts(), loadOverviewStats()]); setMessage("充值商品已删除。");
    } catch (error) { setMessage(error.message, true); }
    return;
  }
  const edit = event.target.closest("[data-edit-product-id]");
  if (edit) {
    const item = state.products.find((product) => Number(product.id) === Number(edit.getAttribute("data-edit-product-id")));
    if (!item) return;
    state.selectedProductId = Number(item.id); refs.productName.value = item.name || ""; refs.productDescription.value = item.description || ""; refs.productDays.value = item.membership_days ?? item.days; refs.productPriceCents.value = item.price_cents; refs.productSortOrder.value = item.sort_order ?? 0; refs.productEnabled.checked = isProductEnabled(item); refs.productFormTitle.textContent = `编辑商品：${item.name}`; refs.productForm.scrollIntoView({behavior: "smooth", block: "start"});
  }
}

async function archiveSelectedUser() {
  const user = selectedUser(); if (!user || !window.confirm(`确认归档用户 ${user.username}？其现有会话将被吊销。`)) return;
  try { await api(`/api/admin/users/${user.id}`, {method: "DELETE"}); await Promise.all([loadUsers(), loadOverviewStats()]); setMessage("用户已归档。"); } catch (error) { setMessage(error.message, true); }
}

async function restoreSelectedUser() {
  const user = selectedUser(); if (!user) return;
  try { await api(`/api/admin/users/${user.id}/restore`, {method: "POST", body: "{}"}); await Promise.all([loadUsers(), loadOverviewStats()]); setMessage("用户已恢复。"); } catch (error) { setMessage(error.message, true); }
}

async function copyActivationCodes() {
  try { await navigator.clipboard.writeText(state.activationResult.join("\n")); setMessage("激活码已复制。"); } catch (_) { setMessage("复制失败，请手动选择结果。", true); }
}

function exportActivationCodes() {
  const blob = new Blob([`${state.activationResult.join("\r\n")}\r\n`], {type: "text/plain;charset=utf-8"});
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `cs2-activation-codes-${Date.now()}.txt`; link.click(); URL.revokeObjectURL(link.href);
}

async function init() {
  refs.bootstrapForm.addEventListener("submit", handleBootstrap); refs.loginForm.addEventListener("submit", handleLogin); refs.logoutButton.addEventListener("click", handleLogout);
  refs.userForm.addEventListener("submit", handleUserSubmit); refs.createUserForm.addEventListener("submit", handleCreateUser); refs.bulkGrantForm.addEventListener("submit", handleBulkGrant); refs.resetPasswordForm.addEventListener("submit", handleResetPassword);
  refs.activationCodeForm.addEventListener("submit", handleActivationSubmit); refs.productForm.addEventListener("submit", handleProductSubmit);
  refs.workspaceNav.addEventListener("click", (event) => { const button = event.target.closest("[data-view]"); if (button) setActiveView(button.getAttribute("data-view")); });
  refs.workspace.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]")?.getAttribute("data-action");
    if (action === "toggle-create-user") refs.createUserForm.hidden = !refs.createUserForm.hidden;
    else if (action === "copy-activation-codes") await copyActivationCodes();
    else if (action === "export-activation-codes") exportActivationCodes();
    else if (action === "dismiss-activation-result") { state.activationResult = []; renderActivationResult(); }
    else if (action === "reset-product-form") resetProductForm();
    else await handleWorkspaceClick(event);
  });
  refs.showArchivedUsers.addEventListener("change", loadUsers); refs.activationStatusFilter.addEventListener("change", loadActivationCodes);
  refs.userPlan.addEventListener("change", () => { const inactive = refs.userPlan.value === "inactive"; refs.userExpiryDate.disabled = inactive; refs.userExpiryTime.disabled = inactive; refs.userExpiryDate.required = !inactive; if (inactive) refs.userExpiryDate.value = ""; else refs.userExpiryTime.value = normalizeTimeValue(refs.userExpiryTime.value) || DEFAULT_EXPIRY_TIME; updateMembershipMetaPreview(); syncPermissionsFromPlan(); });
  refs.userExpiryDate.addEventListener("input", updateMembershipMetaPreview); refs.userExpiryTime.addEventListener("change", updateMembershipMetaPreview);
  refs.archiveUserButton.addEventListener("click", archiveSelectedUser); refs.restoreUserButton.addEventListener("click", restoreSelectedUser);
  refs.generatePasswordButton.addEventListener("click", async () => { refs.resetPasswordValue.value = ""; await handleResetPassword({preventDefault() {}}); });
  setActiveView("users"); await loadSession(); if (state.session) await loadDashboard();
}

init().catch((error) => setMessage(error.message || "控制台初始化失败", true, refs.authMessage));
