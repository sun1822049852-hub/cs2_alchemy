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

function extractFunctionSource(name) {
  const asyncMarker = `async function ${name}(`;
  const plainMarker = `function ${name}(`;
  const start = APP_SOURCE.indexOf(asyncMarker) >= 0
    ? APP_SOURCE.indexOf(asyncMarker)
    : APP_SOURCE.indexOf(plainMarker);
  assert.notEqual(start, -1, `missing function: ${name}`);
  let signatureDepth = 0;
  let bodyStart = -1;
  for (let i = start; i < APP_SOURCE.length; i += 1) {
    const ch = APP_SOURCE[i];
    if (ch === "(") {
      signatureDepth += 1;
    } else if (ch === ")") {
      signatureDepth -= 1;
    } else if (ch === "{" && signatureDepth === 0) {
      bodyStart = i;
      break;
    }
  }
  assert.notEqual(bodyStart, -1, `missing function body: ${name}`);
  let depth = 0;
  for (let i = bodyStart; i < APP_SOURCE.length; i += 1) {
    const ch = APP_SOURCE[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return APP_SOURCE.slice(start, i + 1);
      }
    }
  }
  throw new Error(`unterminated function: ${name}`);
}

function createClassList(initial = []) {
  const set = new Set(initial);
  return {
    add(...names) {
      for (const name of names) set.add(name);
    },
    remove(...names) {
      for (const name of names) set.delete(name);
    },
    toggle(name, force) {
      if (force === true) {
        set.add(name);
        return true;
      }
      if (force === false) {
        set.delete(name);
        return false;
      }
      if (set.has(name)) {
        set.delete(name);
        return false;
      }
      set.add(name);
      return true;
    },
    contains(name) {
      return set.has(name);
    }
  };
}

function createElement(documentRef, {value = "", classes = []} = {}) {
  return {
    value,
    textContent: "",
    disabled: false,
    readOnly: false,
    type: "text",
    classList: createClassList(classes),
    attributes: {},
    setAttribute(name, next) {
      this.attributes[name] = String(next);
    },
    focus() {
      documentRef.activeElement = this;
    }
  };
}

function applyAllowedClientPermissionToButton(button, _permission, {disabled = false, title = ""} = {}) {
  if (!button) return false;
  button.disabled = !!disabled;
  button.title = String(title || "").trim();
  return true;
}

function loadAccountModalFns() {
  const source = extractBlock("function setAccountForm(", "function showPage(");
  const document = {activeElement: null};
  const ui = {
    accountUsername: createElement(document),
    accountPassword: createElement(document),
    accountTotp: createElement(document),
    accountRemark: createElement(document),
    accountPasswordToggle: createElement(document),
    accountLoginModal: createElement(document, {classes: ["hidden"]}),
    accountLoginModalTitle: createElement(document),
    accountLoginHint: createElement(document),
    loginSaveBtn: createElement(document),
    accountStatus: createElement(document)
  };
  const state = {
    accountPasswordVisible: false
  };
  const context = {
    String,
    Array,
    Object,
    document,
    ui,
    state,
    applyClientPermissionToButton: applyAllowedClientPermissionToButton
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

function loadLoginHarness({
  apiImpl = async () => ({ok: true}),
  doRefreshImpl = async () => ({ok: true}),
  switchAccountViewImpl = async () => ({ok: true}),
  initialOverlayOwner = ""
} = {}) {
  const modalSource = extractBlock("function setAccountForm(", "function showPage(");
  const loginSource = [
    extractFunctionSource("loginAndSave"),
    extractFunctionSource("finishLoginSuccess"),
    extractFunctionSource("clearAccountForm"),
    extractFunctionSource("openAddAccountForm")
  ].join("\n\n");
  const source = `${modalSource}\n${loginSource}`;
  const document = {activeElement: null};
  const ui = {
    accountUsername: createElement(document),
    accountPassword: createElement(document),
    accountTotp: createElement(document),
    accountRemark: createElement(document),
    accountPasswordToggle: createElement(document),
    accountLoginModal: createElement(document, {classes: ["hidden"]}),
    accountLoginModalTitle: createElement(document),
    accountLoginHint: createElement(document),
    loginSaveBtn: createElement(document),
    clearAccountBtn: createElement(document),
    accountLoginModalClose: createElement(document),
    accountStatus: createElement(document)
  };
  const calls = {
    events: [],
    api: [],
    refresh: [],
    overlay: [],
    summary: [],
    auth: [],
    reloginModal: []
  };
  const state = {
    accountPasswordVisible: false,
    accountLoginMode: "add",
    pendingRelogin: null,
    craftProgressOwner: String(initialOverlayOwner || "").trim()
  };
  const context = {
    Promise,
    Math,
    Number,
    String,
    Array,
    Object,
    JSON,
    document,
    ui,
    state,
    applyClientPermissionToButton: applyAllowedClientPermissionToButton,
    guardGuestAction() {
      return true;
    },
    normalizeAccountTotpInput() {
      const normalized = String(ui.accountTotp.value || "").replace(/\s+/g, "").toUpperCase();
      ui.accountTotp.value = normalized;
      return normalized;
    },
    setAccountStatus(text, isError = false) {
      ui.accountStatus.textContent = String(text || "");
      ui.accountStatus.classList.toggle("error", !!isError);
      calls.events.push(`status:${ui.accountStatus.textContent}`);
    },
    formatLoginSaveError(err) {
      return String(err && err.message ? err.message : err);
    },
    async api(pathName, options) {
      calls.api.push({pathName, options});
      calls.events.push(`api:${String(pathName || "")}`);
      return apiImpl(pathName, options);
    },
    async loadAccounts() {
      calls.events.push("loadAccounts");
    },
    async switchAccountView(...args) {
      calls.events.push("switchAccountView");
      return switchAccountViewImpl(...args);
    },
    async doRefresh(options) {
      calls.refresh.push(options);
      calls.events.push("doRefresh:start");
      return doRefreshImpl(options);
    },
    setCraftExecutionOverlayState(payload = {}) {
      calls.overlay.push({type: "set", payload});
      calls.events.push("overlay:set");
      const owner = String(payload.owner || "").trim();
      if (state.craftProgressOwner && owner && state.craftProgressOwner !== owner) {
        return false;
      }
      if (owner) {
        state.craftProgressOwner = owner;
      }
      return true;
    },
    clearCraftExecutionOverlayState(payload = {}) {
      calls.overlay.push({type: "clear", payload});
      calls.events.push("overlay:clear");
      const owner = String(payload.owner || "").trim();
      if (!owner || owner === String(state.craftProgressOwner || "").trim()) {
        state.craftProgressOwner = "";
      }
    },
    setSummary(message) {
      calls.summary.push(String(message || ""));
    },
    setAccountAuthState(username, payload = {}) {
      calls.auth.push({
        username: String(username || ""),
        authState: String(payload.authState || ""),
        authReason: String(payload.authReason || "")
      });
    }
  };

  vm.runInNewContext(source, context, {filename: APP_PATH});
  const originalOpenRelogin = context.openAccountReloginModal;
  context.openAccountReloginModal = (payload = {}) => {
    calls.reloginModal.push(payload);
    return originalOpenRelogin(payload);
  };

  ui.loginSaveBtn.onclick = context.loginAndSave;
  ui.clearAccountBtn.onclick = context.clearAccountForm;
  ui.accountLoginModalClose.onclick = () => {
    context.clearAccountForm();
  };

  context.calls = calls;
  return context;
}

function test_relogin_modal_locks_username_uses_saved_password_and_focuses_guard() {
  const app = loadAccountModalFns();
  assert.equal(typeof app.openAccountReloginModal, "function");

  app.openAccountReloginModal({
    username: "countsteam01",
    reason: "login_key_invalid"
  });

  assert.equal(app.ui.accountLoginModal.classList.contains("hidden"), false);
  assert.equal(app.ui.accountLoginModalTitle.textContent, "重新登录");
  assert.match(app.ui.accountLoginHint.textContent, /重新登录|loginKey/i);
  assert.equal(app.ui.accountUsername.value, "countsteam01");
  assert.equal(app.ui.accountUsername.readOnly, true);
  assert.equal(app.ui.accountPassword.value, "");
  assert.equal(app.ui.accountTotp.value, "");
  assert.equal(app.ui.loginSaveBtn.textContent, "重新登录");
  assert.equal(app.document.activeElement, app.ui.accountTotp);
}

function test_source_mentions_login_invalid_badge_and_relogin_helper() {
  assert.equal(
    APP_SOURCE.includes("登录失效"),
    true,
    "app should render the 登录失效 state in UI text"
  );
  assert.equal(
    APP_SOURCE.includes("openAccountReloginModal("),
    true,
    "app should expose a dedicated relogin modal helper"
  );
}

async function test_do_refresh_opens_relogin_modal_for_invalid_login_key() {
  const source = extractFunctionSource("doRefresh");
  const reloginCalls = [];
  const summaryCalls = [];
  const state = {
    refreshing: false,
    lastRefreshClickTs: 0,
    accountSelectedUsername: "",
    currentAccountUsername: "",
    activeAccount: "countsteam01",
    connectedUsername: "",
    fetchTime: "",
    accounts: [{
      username: "countsteam01",
      password: "SecretA"
    }],
    snapshotCacheByAccount: new Map()
  };
  const ui = {
    accountPageSelect: {value: ""},
    accountSelect: {value: "countsteam01"},
    craftAccountSelect: {value: ""}
  };
  const context = {
    Promise,
    Date,
    Math,
    String,
    Set,
    Map,
    state,
    ui,
    clearCraftStatus() {},
    setRefreshBusy() {},
    startInventoryEventStream() {},
    syncInventoryAccountSelect() {},
    async persistLastSelected() {},
    async disconnectOtherSessionsForTarget() {},
    setRefreshPhase() {},
    setSummary(message) {
      summaryCalls.push(String(message || ""));
    },
    accountByUsername(username) {
      return state.accounts.find((row) => row.username === username) || null;
    },
    async api(pathName) {
      if (pathName === "/api/refresh") {
        const err = new Error("当前账号登录已失效，请重新登录后再刷新");
        err.data = {
          reason: "login_key_invalid",
          auth_state: "auth_invalid",
          relogin_required: true
        };
        throw err;
      }
      return {ok: true};
    },
    setRows() {},
    cacheSnapshotForAccount() {},
    clearSnapshotDirty() {},
    clearRefreshPhase() {},
    syncInventoryTop() {},
    async loadComponentTaskQueue() {},
    openAccountReloginModal(payload) {
      reloginCalls.push(payload);
    },
    setAccountAuthState(username, payload) {
      const row = state.accounts.find((item) => item.username === username);
      if (row) {
        row.auth_state = payload.authState;
        row.auth_reason = payload.authReason;
      }
    }
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});

  const result = await context.doRefresh({force: true});

  assert.equal(result.ok, false);
  assert.equal(reloginCalls.length, 1);
  assert.equal(reloginCalls[0].username, "countsteam01");
  assert.equal(reloginCalls[0].reason, "login_key_invalid");
  assert.equal(state.accounts[0].auth_state, "auth_invalid");
  assert.equal(summaryCalls.some((text) => text.includes("登录失效")), true);
}

async function test_login_overlay_becomes_visible_before_login_request_and_uses_title_stage() {
  const apiDeferred = createDeferred();
  const app = loadLoginHarness({
    apiImpl: async (pathName) => {
      if (pathName === "/api/accounts/login-start") {
        return apiDeferred.promise;
      }
      return {ok: true};
    }
  });

  app.openAddAccountForm();
  app.ui.accountUsername.value = "countsteam01";
  app.ui.accountPassword.value = "SecretA";
  app.ui.accountTotp.value = "ab cd12";

  const pending = app.loginAndSave();
  await Promise.resolve();

  assert.equal(
    app.calls.overlay.length > 0,
    true,
    "login should surface the shared connecting overlay before awaiting /api/accounts/login-start"
  );
  const firstOverlaySet = app.calls.overlay.find((entry) => entry.type === "set");
  assert.ok(firstOverlaySet, "expected a shared overlay set call during login");
  assert.equal(firstOverlaySet.payload.visible, true, "shared login overlay payload should explicitly set visible=true before awaiting login api");
  assert.equal(firstOverlaySet.payload.mode, "connecting");
  const firstOverlayTitle = String(firstOverlaySet.payload.title || "");
  assert.match(firstOverlayTitle, /登录/, "shared login overlay should surface login-stage wording in overlay title");
  assert.doesNotMatch(firstOverlayTitle, /连接/, "shared login overlay title should not fall back to the generic connect wording");

  const overlayIndex = app.calls.events.indexOf("overlay:set");
  const apiIndex = app.calls.events.indexOf("api:/api/accounts/login-start");
  assert.equal(overlayIndex >= 0 && apiIndex >= 0 && overlayIndex < apiIndex, true);

  apiDeferred.resolve({ok: true});
  await pending;
}

async function test_validation_failure_missing_password_keeps_modal_and_skips_overlay() {
  const app = loadLoginHarness();
  app.openAddAccountForm();
  app.ui.accountUsername.value = "countsteam01";
  app.ui.accountPassword.value = "";
  app.ui.accountTotp.value = "";

  await app.loginAndSave();

  assert.equal(app.calls.api.length, 0);
  assert.equal(app.calls.overlay.length, 0);
  assert.equal(app.ui.accountLoginModal.classList.contains("hidden"), false);
  assert.equal(app.ui.accountStatus.textContent, "请输入密码");
}

async function test_add_and_relogin_share_flow_and_all_modal_actions_are_inert_while_login_pending() {
  const apiDeferred = createDeferred();
  const app = loadLoginHarness({
    apiImpl: async (pathName) => {
      if (pathName === "/api/accounts/login-start") return apiDeferred.promise;
      return {ok: true};
    }
  });

  app.openAddAccountForm();
  app.ui.accountUsername.value = "countsteam01";
  app.ui.accountPassword.value = "SecretA";
  app.ui.accountTotp.value = "ABC123";
  const pending = app.ui.loginSaveBtn.onclick();
  await Promise.resolve();

  assert.equal(app.calls.api.length, 1);
  assert.equal(app.ui.loginSaveBtn.disabled, true, "loginSaveBtn should be visibly disabled while login is pending");
  assert.equal(app.ui.clearAccountBtn.disabled, true, "clearAccountBtn should be visibly disabled while login is pending");
  assert.equal(app.ui.accountLoginModalClose.disabled, true, "modal close control should be visibly disabled while login is pending");
  app.ui.loginSaveBtn.onclick();
  app.ui.clearAccountBtn.onclick();
  app.ui.accountLoginModalClose.onclick();
  assert.equal(app.calls.api.length, 1, "loginSaveBtn should remain inert while login is pending");
  assert.equal(app.ui.accountLoginModal.classList.contains("hidden"), false, "pending login should keep modal visible");
  assert.equal(app.ui.accountUsername.value, "countsteam01", "pending login should keep current form state intact");

  apiDeferred.resolve({ok: true});
  await pending;

  const apiDeferredRelogin = createDeferred();
  app.api = async (pathName, options) => {
    app.calls.api.push({pathName, options});
    if (pathName === "/api/accounts/login-start") return apiDeferredRelogin.promise;
    return {ok: true};
  };
  app.openAccountReloginModal({
    username: "countsteam01",
    reason: "login_key_invalid"
  });
  app.ui.accountTotp.value = "ZXCV12";
  const reloginApiCountBeforePending = app.calls.api.length;
  const reloginUsernameBeforePending = app.ui.accountUsername.value;
  const reloginPending = app.ui.loginSaveBtn.onclick();
  await Promise.resolve();
  assert.equal(
    app.calls.api.length,
    reloginApiCountBeforePending + 1,
    "relogin entry should still use loginAndSave flow"
  );
  const reloginRequest = app.calls.api[app.calls.api.length - 1];
  assert.equal(JSON.parse(reloginRequest.options.body).password, "", "relogin should let the backend read the stored password");
  assert.equal(app.ui.loginSaveBtn.disabled, true, "relogin pending should keep loginSaveBtn visibly disabled");
  assert.equal(app.ui.clearAccountBtn.disabled, true, "relogin pending should keep clearAccountBtn visibly disabled");
  assert.equal(app.ui.accountLoginModalClose.disabled, true, "relogin pending should keep modal close control visibly disabled");
  app.ui.loginSaveBtn.onclick();
  app.ui.clearAccountBtn.onclick();
  app.ui.accountLoginModalClose.onclick();
  assert.equal(
    app.calls.api.length,
    reloginApiCountBeforePending + 1,
    "relogin pending should avoid duplicate login requests"
  );
  assert.equal(
    app.ui.accountLoginModal.classList.contains("hidden"),
    false,
    "relogin pending should keep modal visible"
  );
  assert.equal(
    app.ui.accountUsername.value,
    reloginUsernameBeforePending,
    "relogin pending should preserve modal form state"
  );
  apiDeferredRelogin.resolve({ok: true});
  await reloginPending;
}

async function test_active_overlay_owner_blocks_login_request_and_reports_busy_status() {
  const app = loadLoginHarness({initialOverlayOwner: "craft_flow"});
  app.openAddAccountForm();
  app.ui.accountUsername.value = "countsteam01";
  app.ui.accountPassword.value = "SecretA";
  app.ui.accountTotp.value = "QWER12";

  await app.loginAndSave();

  assert.equal(app.calls.api.length, 0, "active non-login overlay owner should block /api/accounts/login-start");
  assert.equal(app.ui.accountLoginModal.classList.contains("hidden"), false, "blocked login should keep modal open");
  assert.match(app.ui.accountStatus.textContent, /当前有任务进行中，请稍后再试/);
}

async function test_login_success_closes_overlay_and_modal_before_post_login_refresh() {
  const refreshStateSnapshots = [];
  const app = loadLoginHarness({
    doRefreshImpl: async () => {
      const lastOverlayEvent = app.calls.overlay[app.calls.overlay.length - 1] || null;
      refreshStateSnapshots.push({
        modalHidden: app.ui.accountLoginModal.classList.contains("hidden"),
        overlayOwnerAtRefreshStart: String(app.state.craftProgressOwner || ""),
        lastOverlayEventType: String(lastOverlayEvent && lastOverlayEvent.type || "")
      });
      return {ok: true};
    }
  });
  app.openAddAccountForm();
  app.ui.accountUsername.value = "countsteam01";
  app.ui.accountPassword.value = "SecretA";
  app.ui.accountTotp.value = "LOGIN1";

  await app.loginAndSave();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(
    refreshStateSnapshots.length,
    1,
    `expected post-login refresh; events=${JSON.stringify(app.calls.events)} status=${app.ui.accountStatus.textContent}`
  );
  assert.equal(
    refreshStateSnapshots[0].overlayOwnerAtRefreshStart,
    "",
    "refresh should start with overlay already closed (no active owner)"
  );
  assert.equal(
    refreshStateSnapshots[0].lastOverlayEventType,
    "clear",
    "refresh should start only after the login overlay has already been cleared"
  );
  assert.equal(refreshStateSnapshots[0].modalHidden, true, "modal should close before post-login refresh starts");
}

async function test_login_resolves_without_waiting_for_background_refresh() {
  const refreshDeferred = createDeferred();
  const app = loadLoginHarness({
    doRefreshImpl: async () => refreshDeferred.promise
  });
  app.openAddAccountForm();
  app.ui.accountUsername.value = "countsteam01";
  app.ui.accountPassword.value = "SecretA";
  app.ui.accountTotp.value = "READY01";

  const loginPromise = app.loginAndSave();
  const settledBeforeRefresh = await Promise.race([
    loginPromise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 0))
  ]);

  assert.equal(settledBeforeRefresh, true, "loginAndSave should settle without waiting for post-login background refresh");
  assert.equal(app.calls.refresh.length, 1, "login should still trigger one background refresh");
  assert.equal(app.ui.accountLoginModal.classList.contains("hidden"), true, "modal should already be closed when login promise settles");
  assert.equal(
    app.calls.overlay[app.calls.overlay.length - 1] && app.calls.overlay[app.calls.overlay.length - 1].type,
    "clear",
    "login overlay should already be cleared when login promise settles"
  );

  refreshDeferred.resolve({ok: true});
  await Promise.resolve();
}

async function test_login_failure_closes_overlay_and_keeps_modal_state() {
  const app = loadLoginHarness({
    apiImpl: async () => {
      throw new Error("boom");
    }
  });
  app.openAddAccountForm();
  app.ui.accountUsername.value = "countsteam01";
  app.ui.accountPassword.value = "SecretA";
  app.ui.accountTotp.value = "ERR123";

  await app.loginAndSave();

  assert.equal(
    app.calls.overlay.some((entry) => entry.type === "clear"),
    true,
    "login failure should close the shared overlay"
  );
  assert.equal(app.ui.accountLoginModal.classList.contains("hidden"), false, "login failure should keep modal open");
  assert.equal(app.ui.accountUsername.value, "countsteam01");
  assert.equal(app.ui.loginSaveBtn.disabled, false, "login failure should re-enable loginSaveBtn");
  assert.equal(app.ui.clearAccountBtn.disabled, false, "login failure should keep clearAccountBtn operable");
  assert.equal(app.ui.accountLoginModalClose.disabled, false, "login failure should keep close control operable");

  app.ui.accountTotp.value = "ERR124";
  await app.ui.loginSaveBtn.onclick();
  assert.equal(app.calls.api.length, 2, "login failure should still allow retry submit in the same modal");
  assert.equal(app.ui.accountLoginModal.classList.contains("hidden"), false, "retry failure should keep modal open");

  app.ui.accountLoginModalClose.onclick();
  assert.equal(app.ui.accountLoginModal.classList.contains("hidden"), true, "after failure the modal should remain user-closable");
}

async function test_post_login_refresh_relogin_required_updates_summary_and_auth_without_reopening_modal() {
  const app = loadLoginHarness({
    doRefreshImpl: async () => ({
      ok: false,
      reason: "login_key_invalid",
      reloginRequired: true,
      message: "当前账号登录已失效，请重新登录后再刷新",
      authState: "auth_invalid"
    })
  });
  app.openAddAccountForm();
  app.ui.accountUsername.value = "countsteam01";
  app.ui.accountPassword.value = "SecretA";
  app.ui.accountTotp.value = "RELG01";

  await app.loginAndSave();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(app.calls.reloginModal.length, 0, "post-login reloginRequired should not auto-open a second relogin modal");
  assert.equal(app.calls.summary.some((text) => text.includes("登录失效")), true, "post-login reloginRequired should update summary");
  assert.equal(
    app.calls.auth.some((entry) => (
      entry.username === "countsteam01" &&
      entry.authState === "auth_invalid" &&
      entry.authReason === "login_key_invalid"
    )),
    true,
    "post-login reloginRequired should update auth state metadata"
  );
}

function loadSwitchAccountViewHarness({
  loadComponentTaskQueueImpl = async () => ({ok: true})
} = {}) {
  const source = extractFunctionSource("switchAccountView");
  const calls = {
    loadComponentTaskQueue: 0
  };
  const context = {
    String,
    Promise,
    clearTimeout,
    craftAssistPickerCloseTimer: null,
    state: {
      currentAccountUsername: "",
      lastDirtyFallbackTs: 0,
      craftSettingsOpen: false
    },
    calls,
    saveCraftAccountScopedState() {},
    saveCraftAssistRuntimeState() {},
    buildCurrentCraftAccountScopedStateSnapshot() {
      return {};
    },
    getCraftAccountScopedStateSnapshot() {
      return {};
    },
    buildCurrentCraftAssistRuntimeStateSnapshot() {
      return {};
    },
    getCraftAssistRuntimeStateSnapshot() {
      return {};
    },
    clearSnapshotDirty() {},
    applyCraftAccountScopedStateSnapshot() {},
    syncInventoryAccountSelect() {},
    renderSavedAccounts() {},
    async persistLastSelected() {},
    applyCachedSnapshotForAccount() {
      return true;
    },
    async loadSnapshotForAccount() {},
    restoreCraftAccountScopedState() {},
    renderCraftPage() {},
    startInventoryEventStream() {},
    ensureAccountProfile() {},
    async loadComponentTaskQueue() {
      calls.loadComponentTaskQueue += 1;
      return loadComponentTaskQueueImpl();
    }
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

async function test_switch_account_view_can_defer_component_queue_loading() {
  const deferred = createDeferred();
  const app = loadSwitchAccountViewHarness({
    loadComponentTaskQueueImpl: async () => deferred.promise
  });

  const switchPromise = app.switchAccountView("countsteam01", {
    silentSnapshotSummary: true,
    deferComponentTaskQueue: true
  });

  const settledBeforeQueueLoad = await Promise.race([
    switchPromise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 0))
  ]);

  assert.equal(
    settledBeforeQueueLoad,
    true,
    "switchAccountView should not await component task queue when deferComponentTaskQueue=true"
  );
  assert.equal(app.calls.loadComponentTaskQueue, 1, "switchAccountView should still trigger one component task queue refresh");

  deferred.resolve({ok: true});
  await Promise.resolve();
}

async function main() {
  await test_login_overlay_becomes_visible_before_login_request_and_uses_title_stage();
  await test_validation_failure_missing_password_keeps_modal_and_skips_overlay();
  await test_add_and_relogin_share_flow_and_all_modal_actions_are_inert_while_login_pending();
  await test_active_overlay_owner_blocks_login_request_and_reports_busy_status();
  await test_login_success_closes_overlay_and_modal_before_post_login_refresh();
  await test_login_resolves_without_waiting_for_background_refresh();
  await test_login_failure_closes_overlay_and_keeps_modal_state();
  await test_post_login_refresh_relogin_required_updates_summary_and_auth_without_reopening_modal();
  await test_switch_account_view_can_defer_component_queue_loading();
  test_relogin_modal_locks_username_uses_saved_password_and_focuses_guard();
  test_source_mentions_login_invalid_badge_and_relogin_helper();
  await test_do_refresh_opens_relogin_modal_for_invalid_login_key();
  console.log("account-relogin-modal tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
