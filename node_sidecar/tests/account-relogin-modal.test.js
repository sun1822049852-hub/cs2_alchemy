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
    state
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function test_relogin_modal_locks_username_prefills_password_and_focuses_guard() {
  const app = loadAccountModalFns();
  assert.equal(typeof app.openAccountReloginModal, "function");

  app.openAccountReloginModal({
    username: "countsteam01",
    password: "SecretA",
    reason: "login_key_invalid"
  });

  assert.equal(app.ui.accountLoginModal.classList.contains("hidden"), false);
  assert.equal(app.ui.accountLoginModalTitle.textContent, "重新登录");
  assert.match(app.ui.accountLoginHint.textContent, /重新登录|loginKey/i);
  assert.equal(app.ui.accountUsername.value, "countsteam01");
  assert.equal(app.ui.accountUsername.readOnly, true);
  assert.equal(app.ui.accountPassword.value, "SecretA");
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

async function main() {
  test_relogin_modal_locks_username_prefills_password_and_focuses_guard();
  test_source_mentions_login_invalid_badge_and_relogin_helper();
  await test_do_refresh_opens_relogin_modal_for_invalid_login_key();
  console.log("account-relogin-modal tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
