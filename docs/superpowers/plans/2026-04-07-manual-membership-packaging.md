# Manual Membership Packaging Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Windows-packaged client that uses remote login plus signed local license bundles, while the admin console manually grants permissions and only real craft execution requires explicit authorization.

**Architecture:** Keep the existing control-plane-signed bundle model and tighten it into a release-ready flow. Registered users receive a default baseline plan that enables all current capabilities except `craft.use`; the admin console remains the source of truth for plan assignment and per-user permission overrides. Release launchers must force `prod_login`, the client must auto-refresh short-lived bundles, and packaged builds must move writable state out of the install directory into Electron user data.

**Tech Stack:** Node.js CommonJS, Electron, built-in `http`/`crypto`/`node:sqlite`, plain HTML/CSS/JS, Windows NSIS packaging via `electron-builder`, `node:assert` tests.

---

## File Structure

- Modify: `shared/featureCodes.js`
  Keep the existing feature code registry as the contract shared by client and control plane.
- Modify: `admin_console/src/controlPlaneStore.js`
  Redefine default plan permissions and entitlement resolution for newly registered users.
- Modify: `admin_console/src/server.js`
  Keep admin APIs intact while ensuring login/refresh responses always sign the correct entitlements.
- Modify: `admin_console/ui/app.js`
  Show the new default plan semantics and make per-user overrides explicit in the console UI.
- Modify: `admin_console/tests/control-plane-store.test.js`
  Lock the new plan defaults and entitlement calculations.
- Modify: `admin_console/tests/control-plane-server.test.js`
  Lock the new registration/login/device/session behavior and remove date-sensitive flakiness.
- Modify: `main_ui_node_desktop.js`
  Separate release launcher behavior from dev bootstrap behavior.
- Modify: `run.bat`
  Keep it as a release-friendly launcher that no longer silently enables dev auto-bundle mode.
- Modify: `node_sidecar/src/devDesktopLaunchEnv.js`
  Restrict auto-injected dev auth env to explicit dev entrypoints only.
- Modify: `node_sidecar/src/licenseConfig.js`
  Make `prod_login` the packaged default while preserving manual import only for debug/dev flows.
- Modify: `node_sidecar/src/uiServer.js`
  Wire login/import/refresh/logout lifecycle and keep `craft.use` as the only hard-gated execution capability.
- Modify: `node_sidecar/src/licenseScheduler.js`
  Use the existing scheduler hook to perform bundle refresh before expiry.
- Modify: `node_sidecar/src/licenseStore.js`
  Persist and expose refresh credentials cleanly for refresh/revoke flows.
- Modify: `node_sidecar/src/controlPlaneAuthClient.js`
  Keep remote auth client payload normalization stable for login, refresh, and logout.
- Modify: `node_sidecar/electron-main.js`
  Resolve writable runtime paths from Electron `userData` in packaged mode.
- Modify: `node_sidecar/src/constants.js`
  Stop hard-binding writable state to repo root for packaged builds.
- Modify: `node_sidecar/src/jsonStore.js`
  Preserve directory creation behavior for relocated runtime files.
- Modify: `node_sidecar/package.json`
  Add Windows packaging scripts and bundler config.
- Create: `node_sidecar/tests/craft-permission-gate.test.js`
  Lock the rule that only real craft execution depends on `craft.use`.
- Create: `node_sidecar/tests/runtime-paths.test.js`
  Lock packaged-vs-dev path resolution.
- Modify: `tests/main-ui-node-desktop-launcher.test.js`
  Lock launcher defaults so release launchers stop forcing dev mode.
- Modify: `README.md`
  Document release login mode, baseline permissions, and packaging commands.
- Modify: `admin_console/README.md`
  Document how manual permission issuance works in the first shipped version.

## Chunk 1: Permission Model And Default Entitlements

### Task 1: Redefine the default membership plan so new users get everything except real craft execution

**Files:**
- Modify: `admin_console/tests/control-plane-store.test.js`
- Modify: `admin_console/src/controlPlaneStore.js`
- Reference: `shared/featureCodes.js`

- [ ] **Step 1: Write the failing entitlement tests**

```js
function test_default_registered_user_plan_enables_all_non_craft_features() {
  const store = new ControlPlaneStore({dbPath});
  const user = store.createClientUser({
    email: "alice@example.com",
    username: "alice",
    password: "Secret123!"
  });
  const entitlements = store.resolveUserEntitlements({userId: user.id, now: new Date("2026-04-07T00:00:00.000Z")});
  assert.deepEqual(entitlements.permissions, [
    FEATURE_CODES.ACCOUNTS_READ,
    FEATURE_CODES.ACCOUNTS_WRITE,
    FEATURE_CODES.INVENTORY_READ,
    FEATURE_CODES.INVENTORY_REFRESH,
    FEATURE_CODES.SIMULATION_USE
  ]);
}
```

- [ ] **Step 2: Run the store tests to confirm failure**

Run: `node admin_console/tests/control-plane-store.test.js`
Expected: FAIL because the current default `free` plan is still read-only and does not include the new baseline permission set.

- [ ] **Step 3: Implement the minimal plan-default changes**

```js
const DEFAULT_MEMBERSHIP_PLANS = [
  {
    code: "free",
    name: "Free",
    description: "Default registered access without craft execution",
    permissions: [
      FEATURE_CODES.ACCOUNTS_READ,
      FEATURE_CODES.ACCOUNTS_WRITE,
      FEATURE_CODES.INVENTORY_READ,
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.SIMULATION_USE
    ]
  },
  {
    code: "pro",
    name: "Pro",
    description: "Includes real craft execution",
    permissions: [
      FEATURE_CODES.ACCOUNTS_READ,
      FEATURE_CODES.ACCOUNTS_WRITE,
      FEATURE_CODES.INVENTORY_READ,
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.SIMULATION_USE,
      FEATURE_CODES.CRAFT_USE
    ]
  }
];
```

- [ ] **Step 4: Re-run the store tests**

Run: `node admin_console/tests/control-plane-store.test.js`
Expected: PASS with the new default baseline and `craft.use` still absent from new registrations.

- [ ] **Step 5: Commit**

```bash
git add admin_console/src/controlPlaneStore.js admin_console/tests/control-plane-store.test.js
git commit -m "feat: redefine default membership entitlements"
```

### Task 2: Lock the client gate so only true craft execution depends on remote authorization

**Files:**
- Create: `node_sidecar/tests/craft-permission-gate.test.js`
- Modify: `node_sidecar/src/uiServer.js`

- [ ] **Step 1: Write the failing route-gate tests**

```js
async function test_simulation_routes_stay_available_without_craft_use() {
  const auth = makeAuth({permissions: [
    "accounts.read",
    "accounts.write",
    "inventory.read",
    "inventory.refresh",
    "simulation.use"
  ]});
  const result = await requestWithAuth(auth, "POST", "/api/tradeup-simulation/resolve", payload);
  assert.equal(result.status, 200);
}

async function test_real_craft_execution_requires_craft_use() {
  const auth = makeAuth({permissions: [
    "accounts.read",
    "accounts.write",
    "inventory.read",
    "inventory.refresh",
    "simulation.use"
  ]});
  const result = await requestWithAuth(auth, "POST", "/api/craft/execute", payload);
  assert.equal(result.status, 403);
  assert.equal(result.body.reason, "permission_denied");
}
```

- [ ] **Step 2: Run the new targeted test**

Run: `node node_sidecar/tests/craft-permission-gate.test.js`
Expected: FAIL until the execution-only permission boundary is explicitly covered in tests.

- [ ] **Step 3: Tighten the permission checks in `uiServer.js`**

```js
if (pathname === "/api/craft/execute" && req.method === "POST") {
  if (!requirePermission(res, auth, FEATURE_CODES.CRAFT_USE)) {
    return true;
  }
}

if (pathname === "/api/tradeup-simulation/resolve" && req.method === "POST") {
  if (!requirePermission(res, auth, FEATURE_CODES.SIMULATION_USE)) {
    return true;
  }
}
```

- [ ] **Step 4: Re-run the targeted test and the existing simulation/craft tests**

Run: `node node_sidecar/tests/craft-permission-gate.test.js`
Expected: PASS

Run: `node tests/craftExecutionGuard.test.js`
Expected: PASS

Run: `node tests/tradeupSimulationService.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/uiServer.js node_sidecar/tests/craft-permission-gate.test.js
git commit -m "feat: gate only real craft execution behind authorization"
```

## Chunk 2: Release Auth Mode And Bundle Lifecycle

### Task 3: Separate release launchers from dev launchers and make release default to `prod_login`

**Files:**
- Modify: `tests/main-ui-node-desktop-launcher.test.js`
- Modify: `main_ui_node_desktop.js`
- Modify: `run.bat`
- Modify: `node_sidecar/src/devDesktopLaunchEnv.js`
- Modify: `node_sidecar/src/licenseConfig.js`
- Reference: `scripts/start-client-dev.ps1`

- [ ] **Step 1: Write the failing launcher tests**

```js
function test_release_launcher_defaults_to_prod_login() {
  const env = buildDesktopLauncherEnv({}, {projectRoot, mode: "release"});
  assert.equal(env.CLIENT_AUTH_MODE, "prod_login");
}

function test_dev_launcher_still_can_opt_into_dev_auto_bundle() {
  const env = buildDesktopLauncherEnv({}, {projectRoot, mode: "dev"});
  assert.equal(env.CLIENT_AUTH_MODE, "dev_auto_bundle");
}
```

- [ ] **Step 2: Run launcher tests to confirm failure**

Run: `node tests/main-ui-node-desktop-launcher.test.js`
Expected: FAIL because the current helper always injects `dev_auto_bundle`.

- [ ] **Step 3: Implement explicit launcher-mode branching**

```js
function buildDesktopLauncherEnv(baseEnv = process.env, {projectRoot, mode = "release"} = {}) {
  if (mode === "dev") {
    // keep dev_auto_bundle defaults
  }
  env.CLIENT_AUTH_MODE = normalizeText(env.CLIENT_AUTH_MODE) || "prod_login";
  return env;
}
```

- [ ] **Step 4: Re-run launcher tests and a smoke launch check**

Run: `node tests/main-ui-node-desktop-launcher.test.js`
Expected: PASS

Run: `node main_ui_node_desktop.js`
Expected: release launcher no longer injects dev auto-bundle by default.

- [ ] **Step 5: Commit**

```bash
git add main_ui_node_desktop.js run.bat node_sidecar/src/devDesktopLaunchEnv.js node_sidecar/src/licenseConfig.js tests/main-ui-node-desktop-launcher.test.js
git commit -m "feat: default release launcher to prod login"
```

### Task 4: Wire bundle refresh and true remote logout revoke into the client runtime

**Files:**
- Modify: `node_sidecar/src/uiServer.js`
- Modify: `node_sidecar/src/licenseScheduler.js`
- Modify: `node_sidecar/src/licenseStore.js`
- Modify: `node_sidecar/src/controlPlaneAuthClient.js`
- Modify: `node_sidecar/tests/license-scheduler.test.js`
- Modify: `node_sidecar/tests/control-plane-auth-client.test.js`
- Create: `node_sidecar/tests/client-auth-session-lifecycle.test.js`

- [ ] **Step 1: Write the failing lifecycle tests**

```js
async function test_client_refreshes_bundle_before_expiry_using_saved_refresh_credential() {
  // login -> save bundle with refresh_credential -> tick scheduler -> expect refresh call
}

async function test_client_logout_sends_saved_refresh_credential_to_remote_service() {
  // save state -> call logout route -> expect remote logout payload refresh_token === saved credential
}
```

- [ ] **Step 2: Run the lifecycle-focused tests to confirm failure**

Run: `node node_sidecar/tests/control-plane-auth-client.test.js`
Expected: PASS for current client normalization coverage

Run: `node node_sidecar/tests/license-scheduler.test.js`
Expected: PASS for generic scheduler coverage

Run: `node node_sidecar/tests/client-auth-session-lifecycle.test.js`
Expected: FAIL because the runtime does not yet provide refresh/revoke wiring.

- [ ] **Step 3: Implement runtime refresh and logout revoke**

```js
const scheduler = createLicenseScheduler({
  store,
  enforcer,
  refreshIntervalMs: config.refreshIntervalMs,
  refreshThresholdMs: config.refreshIntervalMs,
  refreshFn: async (state) => {
    const bundle = store.read();
    const result = await authClient.refresh({
      refreshCredential: bundle.refresh_credential,
      deviceId
    });
    return {
      ...result.bundle,
      refresh_credential: result.refreshCredential
    };
  }
});

await authClient.logout({
  refreshCredential: auth.licenseRuntime.readBundle().refresh_credential
});
```

- [ ] **Step 4: Re-run lifecycle tests**

Run: `node node_sidecar/tests/client-auth-session-lifecycle.test.js`
Expected: PASS

Run: `node node_sidecar/tests/control-plane-auth-client.test.js`
Expected: PASS

Run: `node node_sidecar/tests/license-scheduler.test.js`
Expected: PASS

Run: `node node_sidecar/tests/license-gate.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/uiServer.js node_sidecar/src/licenseScheduler.js node_sidecar/src/licenseStore.js node_sidecar/src/controlPlaneAuthClient.js node_sidecar/tests/control-plane-auth-client.test.js node_sidecar/tests/license-scheduler.test.js node_sidecar/tests/client-auth-session-lifecycle.test.js
git commit -m "feat: close client auth refresh and revoke lifecycle"
```

## Chunk 3: Control Plane Hardening

### Task 5: Remove date-sensitive drift from control-plane server tests and lock the new entitlement contract

**Files:**
- Modify: `admin_console/tests/control-plane-server.test.js`
- Modify: `admin_console/src/server.js`

- [ ] **Step 1: Make the failing assertion deterministic**

```js
const fixedNow = () => new Date("2026-04-05T00:00:00.000Z");
const server = createServer({dbPath, now: fixedNow, ...});
assert.equal(updatedUser.body.user.remaining_membership_days, 15);
```

- [ ] **Step 2: Run the control-plane server tests to confirm the current failure**

Run: `cd admin_console && npm test`
Expected: FAIL in `control-plane-server.test.js` before the `now()` dependency is normalized.

- [ ] **Step 3: Keep all test-time calculations pinned to injected time**

```js
const updated = store.updateClientUserControl({
  ...,
  now: now()
});
```

- [ ] **Step 4: Re-run control-plane tests**

Run: `cd admin_console && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add admin_console/src/server.js admin_console/tests/control-plane-server.test.js
git commit -m "test: stabilize control plane server time-dependent coverage"
```

### Task 6: Make the console UI reflect default baseline access plus manual craft authorization

**Files:**
- Modify: `admin_console/ui/app.js`
- Modify: `admin_console/README.md`

- [ ] **Step 1: Add UI-copy tests or assertions if needed**

```js
// If UI tests are not practical, at minimum add static assertions in a small node test
// that verify the copy strings for default plan semantics.
```

- [ ] **Step 2: Update the console copy and hint text**

```js
refs.membershipMeta.textContent = user.membership_plan === "free"
  ? "默认开放账号、库存、刷新与汰换模拟；真实炼金执行需单独授权。"
  : `当前计划：${user.membership_plan}，可按需覆盖单项权限。`;
```

- [ ] **Step 3: Document the operator flow**

```md
1. 用户注册后默认可登录并使用非 craft 功能。
2. 如需真实炼金，在控制台给该用户开启 `craft.use`。
3. 如需回收能力，可在用户详情里关闭 `craft.use` 或直接吊销设备。
```

- [ ] **Step 4: Run the control-plane UI smoke flow manually**

Run: `cd admin_console && npm start`
Expected: the console clearly explains that only real craft execution is gated.

- [ ] **Step 5: Commit**

```bash
git add admin_console/ui/app.js admin_console/README.md
git commit -m "docs: clarify manual craft authorization in control plane ui"
```

## Chunk 4: Packaging And Writable Runtime Paths

### Task 7: Move packaged writable state into Electron user data while preserving repo-root behavior in dev

**Files:**
- Create: `node_sidecar/tests/runtime-paths.test.js`
- Modify: `node_sidecar/electron-main.js`
- Modify: `node_sidecar/src/constants.js`
- Modify: `node_sidecar/src/jsonStore.js`

- [ ] **Step 1: Write the failing runtime-path tests**

```js
function test_dev_mode_paths_stay_in_project_root() {
  const paths = resolveRuntimePaths({isPackaged: false, projectRoot, userDataDir});
  assert.equal(paths.licenseStateFile, path.join(projectRoot, "client_license_state.json"));
}

function test_packaged_mode_paths_move_to_user_data() {
  const paths = resolveRuntimePaths({isPackaged: true, projectRoot, userDataDir});
  assert.equal(paths.licenseStateFile, path.join(userDataDir, "client_license_state.json"));
}
```

- [ ] **Step 2: Run the new runtime-path test**

Run: `node node_sidecar/tests/runtime-paths.test.js`
Expected: FAIL because constants are currently hard-bound to repo root.

- [ ] **Step 3: Implement a runtime path resolver**

```js
function resolveRuntimePaths({isPackaged, projectRoot, userDataDir}) {
  const writableRoot = isPackaged ? userDataDir : projectRoot;
  return {
    MACHINE_ID_FILE: path.join(writableRoot, "machine_id.bin"),
    LICENSE_STATE_FILE: path.join(writableRoot, "client_license_state.json"),
    UI_STATE_FILE: path.join(writableRoot, "inventory_ui_state.json"),
    SKIN_DB_FILE: path.join(writableRoot, "csgo_skins.db")
  };
}
```

- [ ] **Step 4: Re-run runtime-path tests and a desktop smoke check**

Run: `node node_sidecar/tests/runtime-paths.test.js`
Expected: PASS

Run: `node tests/main-ui-node-desktop-launcher.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/electron-main.js node_sidecar/src/constants.js node_sidecar/src/jsonStore.js node_sidecar/tests/runtime-paths.test.js
git commit -m "feat: move packaged writable state to user data"
```

### Task 8: Add Windows packaging scripts and installer configuration

**Files:**
- Modify: `node_sidecar/package.json`
- Create: `node_sidecar/electron-builder.yml`
- Modify: `README.md`

- [ ] **Step 1: Write the packaging smoke expectation into docs/tests**

```md
Run: `cd node_sidecar && npm run build:win`
Expected: NSIS installer and unpacked app under `dist/`.
```

- [ ] **Step 2: Add the minimal packaging config**

```yaml
appId: com.cs2alchemy.client
productName: CS2 Alchemy
directories:
  output: dist
files:
  - electron-main.js
  - electron-preload.js
  - src/**
  - ui/**
  - package.json
extraResources:
  - from: ../keys
    to: keys
win:
  target:
    - nsis
```

- [ ] **Step 3: Add scripts and dependencies**

```json
{
  "scripts": {
    "ui:desktop": "electron electron-main.js",
    "pack:win": "electron-builder --dir --win",
    "build:win": "electron-builder --win nsis"
  },
  "devDependencies": {
    "electron": "^37.2.0",
    "electron-builder": "^26.0.0"
  }
}
```

- [ ] **Step 4: Run the packaging smoke build**

Run: `cd node_sidecar && npm install`
Expected: PASS

Run: `cd node_sidecar && npm run pack:win`
Expected: PASS with unpacked app output

Run: `cd node_sidecar && npm run build:win`
Expected: PASS with NSIS installer output

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/package.json node_sidecar/electron-builder.yml README.md
git commit -m "build: add windows packaging pipeline"
```

## Chunk 5: End-To-End Verification And Operator Handoff

### Task 9: Run focused regression and manual release smoke verification

**Files:**
- Modify: `README.md`
- Modify: `admin_console/README.md`

- [ ] **Step 1: Run automated auth and control-plane verification**

Run: `cd admin_console && npm test`
Expected: PASS

Run: `node node_sidecar/tests/control-plane-auth-client.test.js`
Expected: PASS

Run: `node node_sidecar/tests/license-scheduler.test.js`
Expected: PASS

Run: `node node_sidecar/tests/license-gate.test.js`
Expected: PASS

Run: `node node_sidecar/tests/client-auth-session-lifecycle.test.js`
Expected: PASS

Run: `node node_sidecar/tests/craft-permission-gate.test.js`
Expected: PASS

Run: `node node_sidecar/tests/runtime-paths.test.js`
Expected: PASS

Run: `node tests/main-ui-node-desktop-launcher.test.js`
Expected: PASS

- [ ] **Step 2: Run packaged-client manual smoke flow**

```text
1. Install the generated Windows package.
2. Launch the packaged client.
3. Register a fresh user.
4. Confirm accounts/inventory/simulation are available immediately.
5. Confirm real craft execution is blocked with `permission_denied`.
6. In admin console, enable `craft.use` for the user.
7. Refresh or re-login in client and confirm real craft execution is now available.
8. Revoke the device in admin console and confirm refresh/login state is invalidated on the client.
```

- [ ] **Step 3: Update operator docs**

```md
- Release build uses `prod_login` by default.
- New users get baseline access automatically.
- Only `craft.use` needs explicit grant in the first shipped version.
- Device revoke is the emergency off switch.
```

- [ ] **Step 4: Commit docs and verification notes**

```bash
git add README.md admin_console/README.md
git commit -m "docs: record release auth and manual entitlement workflow"
```

## Verification

- Run: `cd admin_console && npm test`
- Run: `node node_sidecar/tests/control-plane-auth-client.test.js`
- Run: `node node_sidecar/tests/license-scheduler.test.js`
- Run: `node node_sidecar/tests/license-gate.test.js`
- Run: `node node_sidecar/tests/client-auth-session-lifecycle.test.js`
- Run: `node node_sidecar/tests/craft-permission-gate.test.js`
- Run: `node node_sidecar/tests/runtime-paths.test.js`
- Run: `node tests/main-ui-node-desktop-launcher.test.js`
- Run: `cd node_sidecar && npm run pack:win`
- Run: `cd node_sidecar && npm run build:win`

## Notes

- Do not add payment, billing, or order logic in this implementation wave.
- Keep the admin console as the only authority for manual permission issuance.
- Preserve manual import flows only for explicit debug/dev modes, never as the packaged default.
- Do not revert unrelated pending edits elsewhere in the repository.
