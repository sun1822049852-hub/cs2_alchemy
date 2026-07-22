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

function loadDisplayAccountName() {
  const source = extractBlock("function displayAccountName(", "function optionAccountLabel(");
  const context = {String};
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context.displayAccountName;
}

function testDisplayAccountNameAppendsRemarkAfterSteamName() {
  const displayAccountName = loadDisplayAccountName();
  assert.equal(
    displayAccountName({username: "alice", steam_name: "AliceSteam", remark: "主号"}),
    "AliceSteam（主号）"
  );
}

function testDisplayAccountNameAppendsRemarkAfterUsernameWhenNoSteamName() {
  const displayAccountName = loadDisplayAccountName();
  assert.equal(
    displayAccountName({username: "alice", steam_name: "", remark: "主号"}),
    "alice（主号）"
  );
}

function testDisplayAccountNameAvoidsDuplicateRemark() {
  const displayAccountName = loadDisplayAccountName();
  assert.equal(
    displayAccountName({username: "alice", steam_name: "AliceSteam", remark: "alice"}),
    "AliceSteam"
  );
  assert.equal(
    displayAccountName({username: "alice", steam_name: "", remark: "alice"}),
    "alice"
  );
}

function testSavedAccountCardSourceUsesDisplayNameAndNoSetCurrentButton() {
  const renderSource = extractBlock("function renderSavedAccounts(", "async function persistLastSelected(");
  assert.equal(
    renderSource.includes("const displayName = displayAccountName(row) || accountName || \"-\";"),
    true,
    "saved account cards should use the shared displayAccountName formatter"
  );
  assert.equal(
    renderSource.includes("设为当前"),
    false,
    "saved account cards should not render the set-current button anymore"
  );
}

function loadAccountConnectionLabel(row) {
  const source = extractBlock("function getAccountConnectionLabel(", "function pickAvatarUrlFromProfile(");
  const context = {
    accountByUsername: () => row,
    getAccountAuthState: () => "normal",
    state: {refreshing: false}
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context.getAccountConnectionLabel;
}

function testGuardOnlyAccountCardShowsPasswordAwareState() {
  assert.deepEqual(
    {...loadAccountConnectionLabel({has_steam_guard: true, has_refresh_token: false, has_password: true})("alice", {connected: false})},
    {text: "未登录", connected: false}
  );
  assert.deepEqual(
    {...loadAccountConnectionLabel({has_steam_guard: true, has_refresh_token: false, has_password: false})("alice", {connected: false})},
    {text: "无密码", connected: false}
  );
}

async function testNoPasswordBadgeOpensPasswordEntryWithoutRefreshAttempt() {
  const source = extractBlock("async function connectByStatusBadge(", "function setNoAccountState(");
  const reloginCalls = [];
  let refreshCalls = 0;
  const context = {
    String,
    state: {
      refreshing: false,
      connectedUsername: "",
      currentAccountUsername: "alice"
    },
    ui: {
      craftAccountSelect: null,
      accountPageSelect: null,
      accountSelect: null
    },
    accountByUsername: () => ({
      username: "alice",
      has_steam_guard: true,
      has_refresh_token: false,
      has_password: false
    }),
    openAccountReloginModal: (payload) => reloginCalls.push(payload),
    switchAccountView: async () => {},
    setSummary: () => {},
    refreshWithConnectionOverlay: async () => { refreshCalls += 1; }
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  await context.connectByStatusBadge({usernameOverride: "alice"});
  assert.deepEqual(Array.from(reloginCalls, (call) => ({...call})), [{
    username: "alice",
    password: "",
    reason: "password_reentry_required"
  }]);
  assert.equal(refreshCalls, 0);
}

async function testGuardOnlyAccountDoesNotHydrateProfileBeforeFirstLogin() {
  const source = extractBlock("async function hydrateAccountsProfileIfNeeded(", "function displayAccountName(");
  const hydrated = [];
  const context = {
    Boolean,
    String,
    state: {
      accounts: [{
        username: "alice",
        steam_name: "",
        steam_id: "",
        avatar_url: "",
        has_steam_guard: true,
        has_refresh_token: false
      }],
      profileHydratedUsernames: new Set()
    },
    accountByUsername: () => context.state.accounts[0],
    ensureAccountProfile: async (username) => { hydrated.push(username); }
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  await context.hydrateAccountsProfileIfNeeded();
  assert.deepEqual(hydrated, []);
}

async function testDirectProfileHydrationAlsoSkipsGuardOnlyAccountBeforeFirstLogin() {
  const source = extractBlock("async function ensureAccountProfile(", "async function hydrateAccountsProfileIfNeeded(");
  let apiCalls = 0;
  const row = {
    username: "alice",
    steam_name: "",
    steam_id: "",
    avatar_url: "",
    has_steam_guard: true,
    has_refresh_token: false
  };
  const context = {
    Boolean,
    String,
    state: {
      profileHydratingUsernames: new Set(),
      profileHydratedUsernames: new Set()
    },
    accountByUsername: () => row,
    api: async () => { apiCalls += 1; return {}; }
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  assert.equal(await context.ensureAccountProfile("alice"), false);
  assert.equal(apiCalls, 0);
}

function testSuccessfulRefreshHydratesProfileOnlyAfterRefreshTokenProjectionUpdates() {
  const source = extractBlock("async function doRefresh(", "// ===== 多账号汰换 (Batch Craft) =====");
  const tokenIndex = source.indexOf("has_refresh_token: true");
  const profileIndex = source.indexOf("ensureAccountProfile(username)");
  assert.notEqual(tokenIndex, -1);
  assert.ok(profileIndex > tokenIndex, "profile hydration must start only after refresh token success is projected");
}

async function main() {
  testDisplayAccountNameAppendsRemarkAfterSteamName();
  testDisplayAccountNameAppendsRemarkAfterUsernameWhenNoSteamName();
  testDisplayAccountNameAvoidsDuplicateRemark();
  testSavedAccountCardSourceUsesDisplayNameAndNoSetCurrentButton();
  testGuardOnlyAccountCardShowsPasswordAwareState();
  await testNoPasswordBadgeOpensPasswordEntryWithoutRefreshAttempt();
  await testGuardOnlyAccountDoesNotHydrateProfileBeforeFirstLogin();
  await testDirectProfileHydrationAlsoSkipsGuardOnlyAccountBeforeFirstLogin();
  testSuccessfulRefreshHydratesProfileOnlyAfterRefreshTokenProjectionUpdates();
  console.log("account-card-render tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
