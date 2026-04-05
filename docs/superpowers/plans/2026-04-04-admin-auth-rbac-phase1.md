# Admin Auth And RBAC Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an application-level admin login gate for the Node/Electron UI, migrate saved Steam accounts into SQLite-backed storage, and reserve RBAC/membership/binding data structures without breaking the existing Steam login and inventory workflows.

**Architecture:** Keep Steam authentication unchanged and place a new app-auth/session layer in front of all protected `/api/*` routes. Store app users, roles, permissions, memberships, sessions, Steam accounts, and user-account bindings in `csgo_skins.db`; keep `login_keys.json` as phase-1 token storage. Scope UI presets and last-selected account by authenticated app user while preserving snapshot caches by Steam account.

**Tech Stack:** Node.js CommonJS, `node:sqlite`, built-in `crypto`, existing HTTP server in `node_sidecar/src/uiServer.js`, plain HTML/CSS/JS frontend, `node:assert` tests.

---

## Chunk 1: Auth Data Model And Legacy Migration

### Task 1: Add failing tests for auth schema and bootstrap flow

**Files:**
- Create: `node_sidecar/tests/app-auth-store.test.js`
- Create: `node_sidecar/src/appAuthStore.js`

- [ ] **Step 1: Write the failing test**

```js
function test_bootstrap_admin_creates_super_admin_and_permissions() {
  const store = new AppAuthStore({dbPath, accountsFilePath, tokensFilePath});
  assert.equal(store.needsBootstrap(), true);
  const result = store.bootstrapAdmin({password: "Secret123!"});
  assert.equal(result.user.username, "admin");
  assert.equal(result.user.is_super_admin, true);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_sidecar/tests/app-auth-store.test.js`
Expected: FAIL because `AppAuthStore` does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
class AppAuthStore {
  constructor({dbPath}) {
    this.db = new DatabaseSync(dbPath);
    this.ensureSchema();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_sidecar/tests/app-auth-store.test.js`
Expected: PASS for the bootstrap scenario.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/appAuthStore.js node_sidecar/tests/app-auth-store.test.js
git commit -m "feat: add app auth store bootstrap foundation"
```

### Task 2: Add legacy Steam account migration coverage

**Files:**
- Modify: `node_sidecar/tests/app-auth-store.test.js`
- Modify: `node_sidecar/src/appAuthStore.js`

- [ ] **Step 1: Write the failing test**

```js
function test_imports_legacy_accounts_json_into_steam_account_table() {
  writeLegacyAccounts(accountsFilePath);
  const store = new AppAuthStore({dbPath, accountsFilePath});
  const rows = store.listSteamAccountsForUser(null, {includeAll: true});
  assert.equal(rows.length, 2);
  assert.equal(rows[0].username, "countsteam01");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_sidecar/tests/app-auth-store.test.js`
Expected: FAIL because legacy accounts are not migrated.

- [ ] **Step 3: Write minimal implementation**

```js
importLegacyAccountsIfNeeded() {
  const legacy = readJson(this.accountsFilePath, {accounts: {}});
  // upsert into steam_account when db rows are missing
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_sidecar/tests/app-auth-store.test.js`
Expected: PASS with migrated rows available.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/appAuthStore.js node_sidecar/tests/app-auth-store.test.js
git commit -m "feat: migrate legacy steam accounts into sqlite"
```

## Chunk 2: Session Auth And Protected API Gate

### Task 3: Add failing tests for bootstrap/login/session/logout routes

**Files:**
- Create: `node_sidecar/tests/ui-server-auth.test.js`
- Modify: `node_sidecar/src/uiServer.js`

- [ ] **Step 1: Write the failing test**

```js
async function test_requires_bootstrap_before_login() {
  const {server, requestJson} = await startTestServer();
  const result = await requestJson("GET", "/api/auth/session");
  assert.equal(result.status, 200);
  assert.equal(result.body.needs_bootstrap, true);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_sidecar/tests/ui-server-auth.test.js`
Expected: FAIL because auth routes do not exist.

- [ ] **Step 3: Write minimal implementation**

```js
if (pathname === "/api/auth/session" && req.method === "GET") {
  writeJson(res, 200, {ok: true, authenticated: false, needs_bootstrap: authStore.needsBootstrap()});
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_sidecar/tests/ui-server-auth.test.js`
Expected: PASS for bootstrap and anonymous session checks.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/uiServer.js node_sidecar/tests/ui-server-auth.test.js
git commit -m "feat: add app auth bootstrap and session routes"
```

### Task 4: Add failing tests for unauthorized API access

**Files:**
- Modify: `node_sidecar/tests/ui-server-auth.test.js`
- Modify: `node_sidecar/src/uiServer.js`

- [ ] **Step 1: Write the failing test**

```js
async function test_blocks_accounts_api_without_app_session() {
  const result = await requestJson("GET", "/api/accounts");
  assert.equal(result.status, 401);
  assert.equal(result.body.reason, "app_auth_required");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_sidecar/tests/ui-server-auth.test.js`
Expected: FAIL because `/api/accounts` currently returns 200 anonymously.

- [ ] **Step 3: Write minimal implementation**

```js
if (pathname.startsWith("/api/") && !isPublicAuthRoute(pathname)) {
  const session = resolveRequestSession(req, authStore);
  if (!session.user) {
    writeJson(res, 401, {ok: false, reason: "app_auth_required", message: "请先登录后台管理员账号"});
    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_sidecar/tests/ui-server-auth.test.js`
Expected: PASS with 401 for protected APIs and 200 after login.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/uiServer.js node_sidecar/tests/ui-server-auth.test.js
git commit -m "feat: gate protected api routes behind app session"
```

## Chunk 3: SQLite-Backed Steam Account Store And Binding Checks

### Task 5: Add failing tests for AccountStore SQLite behavior

**Files:**
- Create: `node_sidecar/tests/account-store-sqlite.test.js`
- Modify: `node_sidecar/src/accountStore.js`
- Modify: `node_sidecar/src/appAuthStore.js`

- [ ] **Step 1: Write the failing test**

```js
function test_account_store_lists_sqlite_accounts_for_admin_viewer() {
  const store = new AccountStore({dbPath, accountsFilePath, viewerUsername: "admin"});
  const rows = store.list();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].username, "1822049852");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_sidecar/tests/account-store-sqlite.test.js`
Expected: FAIL because `AccountStore` still reads `accounts.json`.

- [ ] **Step 3: Write minimal implementation**

```js
class AccountStore {
  constructor(options = {}) {
    this.authStore = new AppAuthStore(options);
    this.viewerUsername = options.viewerUsername || "";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_sidecar/tests/account-store-sqlite.test.js`
Expected: PASS with SQLite-backed rows.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/accountStore.js node_sidecar/src/appAuthStore.js node_sidecar/tests/account-store-sqlite.test.js
git commit -m "feat: back steam account store with sqlite auth tables"
```

### Task 6: Add binding-aware access tests

**Files:**
- Modify: `node_sidecar/tests/app-auth-store.test.js`
- Modify: `node_sidecar/tests/account-store-sqlite.test.js`
- Modify: `node_sidecar/src/appAuthStore.js`
- Modify: `node_sidecar/src/accountStore.js`

- [ ] **Step 1: Write the failing test**

```js
function test_regular_user_only_sees_bound_steam_accounts() {
  const user = store.createUserWithBindings({username: "member_a", password: "Secret123!", accounts: ["countsteam01"]});
  const rows = new AccountStore({dbPath, viewerUsername: user.username}).list();
  assert.deepEqual(rows.map((row) => row.username), ["countsteam01"]);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_sidecar/tests/app-auth-store.test.js`
Expected: FAIL because bindings are not enforced.

- [ ] **Step 3: Write minimal implementation**

```js
listSteamAccountsForUser(viewerUsername) {
  if (this.isSuperAdmin(viewerUsername)) return this.listAllSteamAccounts();
  return this.listBoundSteamAccounts(viewerUsername);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_sidecar/tests/app-auth-store.test.js`
Expected: PASS with filtered rows for non-admin users.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/appAuthStore.js node_sidecar/src/accountStore.js node_sidecar/tests/app-auth-store.test.js node_sidecar/tests/account-store-sqlite.test.js
git commit -m "feat: enforce steam account bindings in account store"
```

## Chunk 4: User-Scoped UI State And Frontend Login Gate

### Task 7: Add failing tests for user-scoped UI state

**Files:**
- Create: `node_sidecar/tests/ui-state-store-auth-scope.test.js`
- Modify: `node_sidecar/src/uiStateStore.js`

- [ ] **Step 1: Write the failing test**

```js
function test_last_selected_and_presets_are_scoped_by_app_user() {
  const adminStore = new UiStateStore(filePath, {viewerUsername: "admin"});
  const memberStore = new UiStateStore(filePath, {viewerUsername: "member_a"});
  adminStore.setLastSelected("1822049852");
  memberStore.setLastSelected("countsteam01");
  assert.equal(adminStore.getLastSelected(), "1822049852");
  assert.equal(memberStore.getLastSelected(), "countsteam01");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_sidecar/tests/ui-state-store-auth-scope.test.js`
Expected: FAIL because `UiStateStore` currently uses global values.

- [ ] **Step 3: Write minimal implementation**

```js
_viewerBucket() {
  const key = this.viewerUsername || "__global__";
  // initialize per-user state under raw.app_users[key]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_sidecar/tests/ui-state-store-auth-scope.test.js`
Expected: PASS with isolated last-selected and preset values.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/uiStateStore.js node_sidecar/tests/ui-state-store-auth-scope.test.js
git commit -m "feat: scope ui state by authenticated app user"
```

### Task 8: Add failing tests for frontend auth gate

**Files:**
- Create: `node_sidecar/tests/app-auth-gate.test.js`
- Modify: `node_sidecar/ui/index.html`
- Modify: `node_sidecar/ui/app.js`
- Modify: `node_sidecar/ui/styles.css`

- [ ] **Step 1: Write the failing test**

```js
function test_index_renders_auth_gate_shell() {
  assert.match(html, /id="appAuthGate"/);
  assert.match(jsSource, /loadAppSession\(/);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_sidecar/tests/app-auth-gate.test.js`
Expected: FAIL because no app-level auth gate exists.

- [ ] **Step 3: Write minimal implementation**

```js
async function init() {
  await loadAppSession();
  if (!state.appAuth.authenticated) return;
  // existing initialization
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_sidecar/tests/app-auth-gate.test.js`
Expected: PASS with login/bootstrap overlay fragments present.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/ui/index.html node_sidecar/ui/app.js node_sidecar/ui/styles.css node_sidecar/tests/app-auth-gate.test.js
git commit -m "feat: add app auth gate to frontend shell"
```

## Chunk 5: Route Integration, Permission Checks, And Verification

### Task 9: Add failing tests for permission and account-scope enforcement in protected routes

**Files:**
- Modify: `node_sidecar/tests/ui-server-auth.test.js`
- Modify: `node_sidecar/src/uiServer.js`

- [ ] **Step 1: Write the failing test**

```js
async function test_snapshot_route_rejects_unbound_account() {
  await loginAs("member_a");
  const result = await requestJson("GET", "/api/snapshot/account?username=1822049852", {cookie});
  assert.equal(result.status, 403);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_sidecar/tests/ui-server-auth.test.js`
Expected: FAIL because protected routes do not check account scope.

- [ ] **Step 3: Write minimal implementation**

```js
function requireSteamAccountAccess(res, auth, username) {
  if (!auth.store.canAccessSteamAccount(auth.user.username, username)) {
    writeJson(res, 403, {ok: false, message: "当前登录用户无权访问该 Steam 账号"});
    return false;
  }
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_sidecar/tests/ui-server-auth.test.js`
Expected: PASS with 403 for unbound account access and 200 for allowed accounts.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/uiServer.js node_sidecar/tests/ui-server-auth.test.js
git commit -m "feat: enforce account scope on protected routes"
```

### Task 10: Run focused verification and document operator entrypoints

**Files:**
- Modify: `README.md`
- Create: `tools/initAdminUser.js`

- [ ] **Step 1: Write the failing test**

```js
function test_readme_mentions_admin_bootstrap_or_init_script() {
  assert.match(readme, /initAdminUser\.js|初始化管理员/);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_sidecar/tests/app-auth-gate.test.js`
Expected: FAIL because operator docs do not mention admin bootstrap/init flow.

- [ ] **Step 3: Write minimal implementation**

```js
node tools/initAdminUser.js --password "Secret123!"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_sidecar/tests/app-auth-gate.test.js`
Expected: PASS with documented admin initialization entrypoint.

- [ ] **Step 5: Commit**

```bash
git add README.md tools/initAdminUser.js node_sidecar/tests/app-auth-gate.test.js
git commit -m "docs: document admin bootstrap entrypoint"
```

## Verification

- Run: `node node_sidecar/tests/app-auth-store.test.js`
- Run: `node node_sidecar/tests/account-store-sqlite.test.js`
- Run: `node node_sidecar/tests/ui-state-store-auth-scope.test.js`
- Run: `node node_sidecar/tests/ui-server-auth.test.js`
- Run: `node node_sidecar/tests/app-auth-gate.test.js`

## Notes

- Preserve existing `login_keys.json` token behavior in phase 1.
- Do not revert unrelated pending edits already present in `node_sidecar/uiServer.js`, `node_sidecar/ui/app.js`, `node_sidecar/ui/styles.css`, and simulation tests.
- Keep all new auth code dependency-free; use built-in `crypto` and `node:sqlite`.
