# Remote Control Plane And Signed Snapshot Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split admin control from the shipped client by introducing a remote control plane that issues signed entitlement snapshots, while keeping all Steam/business data and interactions local to the client.

**Architecture:** Add a new `admin_console` application that stores users, plans, entitlements, device bindings, refresh sessions, and audit logs. Convert the current `node_sidecar` app into a pure client runtime that validates a signed `15-minute` entitlement snapshot locally, refreshes it on startup and every `5 minutes`, and gates local features without exposing admin pages or admin APIs to end users.

**Tech Stack:** Node.js CommonJS, `node:sqlite`, built-in `crypto`, built-in `fetch`, existing Electron shell, plain HTML/CSS/JS frontend, `node:assert` tests.

**Execution note:** The workspace preference is to keep changes uncommitted until the user explicitly asks for a commit. Replace all usual “commit” checkpoints with local verification checkpoints.

---

## File Structure

**Create**

- `shared/featureCodes.js`
- `shared/licensePolicy.js`
- `admin_console/package.json`
- `admin_console/src/constants.js`
- `admin_console/src/controlPlaneStore.js`
- `admin_console/src/entitlementSigner.js`
- `admin_console/src/server.js`
- `admin_console/ui/index.html`
- `admin_console/ui/app.js`
- `admin_console/ui/styles.css`
- `admin_console/tests/control-plane-store.test.js`
- `admin_console/tests/entitlement-signer.test.js`
- `admin_console/tests/control-plane-server.test.js`
- `node_sidecar/src/licenseConfig.js`
- `node_sidecar/src/licenseStore.js`
- `node_sidecar/src/controlPlaneClient.js`
- `node_sidecar/src/licenseEnforcer.js`
- `node_sidecar/src/licenseScheduler.js`
- `node_sidecar/tests/license-policy.test.js`
- `node_sidecar/tests/license-store.test.js`
- `node_sidecar/tests/license-gate.test.js`
- `node_sidecar/tests/license-scheduler.test.js`
- `tools/initControlPlaneAdmin.js`
- `tools/migrateLocalAuthToControlPlane.js`

**Modify**

- `README.md`
- `main_ui_node_desktop.js`
- `node_sidecar/src/constants.js`
- `node_sidecar/src/uiServer.js`
- `node_sidecar/src/uiStateStore.js`
- `node_sidecar/ui/index.html`
- `node_sidecar/ui/app.js`
- `node_sidecar/ui/styles.css`
- `node_sidecar/src/appAuthStore.js`
- `node_sidecar/tests/ui-server-auth.test.js`

---

## Chunk 1: Shared Contract And License Configuration

### Task 1: Freeze the shared feature and snapshot contract

**Files:**
- Create: `shared/featureCodes.js`
- Create: `shared/licensePolicy.js`
- Create: `node_sidecar/tests/license-policy.test.js`

- [ ] **Step 1: Write the failing contract test**

```js
const assert = require("node:assert/strict");
const {FEATURE_CODES, validateSnapshot, isSnapshotExpired} = require("../../shared/licensePolicy");

const snapshot = {
  sub: "user_1",
  username: "member_a",
  device_id: "machine_1",
  membership_plan: "pro",
  permissions: [FEATURE_CODES.CRAFT_USE],
  feature_flags: {simulation_enabled: false},
  policy_version: 1,
  jti: "snap_1",
  iat: "2026-04-04T12:00:00.000Z",
  exp: "2026-04-04T12:15:00.000Z"
};

assert.equal(validateSnapshot(snapshot).ok, true);
assert.equal(isSnapshotExpired(snapshot, "2026-04-04T12:16:00.000Z"), true);
```

- [ ] **Step 2: Run the test to prove the contract does not exist yet**

Run: `node node_sidecar/tests/license-policy.test.js`  
Expected: FAIL because `shared/licensePolicy.js` does not exist.

- [ ] **Step 3: Implement the minimal shared contract**

```js
const FEATURE_CODES = {
  ACCOUNTS_READ: "accounts.read",
  ACCOUNTS_WRITE: "accounts.write",
  INVENTORY_READ: "inventory.read",
  INVENTORY_REFRESH: "inventory.refresh",
  CRAFT_USE: "craft.use",
  SIMULATION_USE: "simulation.use"
};
```

Add `validateSnapshot()`, `isSnapshotExpired()`, and `hasPermission()` in `shared/licensePolicy.js`.

- [ ] **Step 4: Re-run the shared contract test**

Run: `node node_sidecar/tests/license-policy.test.js`  
Expected: PASS with the `15-minute` expiry semantics enforced.

- [ ] **Step 5: Local verification checkpoint**

Record the final shared snapshot shape in both code comments and the design doc. Do not commit.

### Task 2: Introduce explicit control-plane configuration on the client

**Files:**
- Create: `node_sidecar/src/licenseConfig.js`
- Modify: `node_sidecar/src/constants.js`
- Modify: `main_ui_node_desktop.js`

- [ ] **Step 1: Write a failing config load test**

Add a small assertion in `node_sidecar/tests/license-policy.test.js` or a dedicated test that verifies:

```js
const {getLicenseConfig} = require("../src/licenseConfig");
const config = getLicenseConfig();
assert.equal(typeof config.controlPlaneBaseUrl, "string");
assert.equal(config.snapshotRefreshMs, 5 * 60 * 1000);
assert.equal(config.snapshotTtlMs, 15 * 60 * 1000);
```

- [ ] **Step 2: Run the config test**

Run: `node node_sidecar/tests/license-policy.test.js`  
Expected: FAIL because `licenseConfig.js` does not exist.

- [ ] **Step 3: Implement configuration loading**

Support:

- `CONTROL_PLANE_BASE_URL`
- `CONTROL_PLANE_PUBLIC_KEY_FILE`
- `LICENSE_REFRESH_MS`
- `LICENSE_SNAPSHOT_TTL_MS`

Default values:

- refresh interval: `300000`
- snapshot TTL: `900000`

- [ ] **Step 4: Wire Electron startup to pass config through**

Ensure `main_ui_node_desktop.js` passes through environment variables unchanged and logs a clear startup error if the public key path is missing.

- [ ] **Step 5: Re-run the config test**

Run: `node node_sidecar/tests/license-policy.test.js`  
Expected: PASS with deterministic defaults.

---

## Chunk 2: Control Plane Storage And Signing

### Task 3: Build the control-plane database schema and admin bootstrap

**Files:**
- Create: `admin_console/package.json`
- Create: `admin_console/src/constants.js`
- Create: `admin_console/src/controlPlaneStore.js`
- Create: `admin_console/tests/control-plane-store.test.js`
- Create: `tools/initControlPlaneAdmin.js`

- [ ] **Step 1: Write the failing store test**

```js
const store = new ControlPlaneStore({dbPath});
assert.equal(store.needsBootstrap(), true);
const admin = store.bootstrapAdmin({username: "admin", password: "Secret123!"});
assert.equal(admin.username, "admin");
assert.equal(store.listClientUsers().length, 0);
```

- [ ] **Step 2: Run the failing store test**

Run: `node admin_console/tests/control-plane-store.test.js`  
Expected: FAIL because `ControlPlaneStore` does not exist.

- [ ] **Step 3: Implement the control-plane schema**

Create tables:

- `admin_user`
- `client_user`
- `membership_plan`
- `feature_bundle`
- `user_entitlement`
- `device_binding`
- `refresh_session`
- `audit_log`

Seed a default plan placeholder and default feature bundle set.

- [ ] **Step 4: Add the admin bootstrap CLI**

Implement:

```powershell
node tools/initControlPlaneAdmin.js --password "你的控制台密码"
```

The CLI should create the first `admin_user` in the control-plane database only.

- [ ] **Step 5: Re-run the store test**

Run: `node admin_console/tests/control-plane-store.test.js`  
Expected: PASS with bootstrap and schema seeding.

### Task 4: Add signed entitlement issuance and refresh-session rotation

**Files:**
- Create: `admin_console/src/entitlementSigner.js`
- Create: `admin_console/tests/entitlement-signer.test.js`
- Modify: `admin_console/src/controlPlaneStore.js`
- Modify: `shared/licensePolicy.js`

- [ ] **Step 1: Write the failing signer test**

```js
const {createSignedSnapshot, verifySignedSnapshot} = require("../src/entitlementSigner");
const result = createSignedSnapshot({sub: "user_1", device_id: "machine_1", permissions: ["craft.use"]});
assert.equal(verifySignedSnapshot(result.snapshot, result.signature).ok, true);
```

- [ ] **Step 2: Run the signer test**

Run: `node admin_console/tests/entitlement-signer.test.js`  
Expected: FAIL because the signer does not exist.

- [ ] **Step 3: Implement signing and refresh rotation**

Use built-in `crypto` with an `Ed25519` private key. Add store methods:

- `createRefreshSession()`
- `rotateRefreshSession()`
- `revokeRefreshSession()`
- `resolveEffectiveEntitlement()`

The returned snapshot must always contain:

- `iat`
- `exp`
- `policy_version`
- `jti`
- `device_id`

- [ ] **Step 4: Add negative-path assertions**

Verify that:

- tampered payload fails verification
- revoked refresh session cannot rotate
- disabled user cannot obtain a fresh snapshot

- [ ] **Step 5: Re-run signer and store tests**

Run:

- `node admin_console/tests/entitlement-signer.test.js`
- `node admin_console/tests/control-plane-store.test.js`

Expected: PASS for both tests.

---

## Chunk 3: Control Plane HTTP API And Admin Console UI

### Task 5: Expose admin auth, user management, and entitlement management APIs

**Files:**
- Create: `admin_console/src/server.js`
- Create: `admin_console/tests/control-plane-server.test.js`
- Modify: `admin_console/src/controlPlaneStore.js`

- [ ] **Step 1: Write the failing server auth test**

```js
const session = await requestJson("GET", "/api/admin/session");
assert.equal(session.status, 200);
assert.equal(session.body.authenticated, false);
```

Add follow-up assertions for:

- `/api/admin/login`
- `/api/admin/logout`
- `/api/admin/users`
- `/api/admin/plans`
- `/api/admin/entitlements`
- `/api/admin/devices`

- [ ] **Step 2: Run the server test**

Run: `node admin_console/tests/control-plane-server.test.js`  
Expected: FAIL because the server does not exist.

- [ ] **Step 3: Implement admin cookie session routes**

Add:

- `GET /api/admin/session`
- `POST /api/admin/login`
- `POST /api/admin/logout`

Then gate all management routes behind the admin session.

- [ ] **Step 4: Implement CRUD and audit paths**

Implement the minimal routes needed for:

- client user creation
- password reset / disable
- membership assignment
- feature override assignment
- device revoke / allow
- audit log listing

- [ ] **Step 5: Re-run the server test**

Run: `node admin_console/tests/control-plane-server.test.js`  
Expected: PASS with authenticated admin flows only.

### Task 6: Add client-facing activate and refresh endpoints, plus a minimal admin UI

**Files:**
- Modify: `admin_console/src/server.js`
- Create: `admin_console/ui/index.html`
- Create: `admin_console/ui/app.js`
- Create: `admin_console/ui/styles.css`
- Modify: `admin_console/tests/control-plane-server.test.js`

- [ ] **Step 1: Extend the failing server test with client routes**

Add assertions for:

- `POST /api/client/activate`
- `POST /api/client/refresh`

Expected response shape:

```json
{
  "ok": true,
  "refresh_credential": "opaque-client-secret",
  "snapshot": {},
  "signature": "base64"
}
```

- [ ] **Step 2: Run the extended server test**

Run: `node admin_console/tests/control-plane-server.test.js`  
Expected: FAIL because client routes are not implemented.

- [ ] **Step 3: Implement activate and refresh logic**

Activation inputs:

- `username`
- `password`
- `device_id`
- `device_label`

Refresh inputs:

- `refresh_credential`
- `device_id`

Rotate the refresh credential on every successful refresh.

- [ ] **Step 4: Build the minimal admin UI**

The first version only needs:

- admin login form
- user list
- user detail drawer or panel
- membership / feature toggles
- device list
- audit log table

Keep it separate from `node_sidecar/ui/`; this UI lives only in `admin_console/ui/`.

- [ ] **Step 5: Re-run the server test and perform a manual browser sanity check**

Run: `node admin_console/tests/control-plane-server.test.js`  
Expected: PASS, then manually open the local control-plane page and verify admin login and user CRUD.

---

## Chunk 4: Client License Store, Remote Sync, And Scheduler

### Task 7: Add a local license store and a control-plane HTTP client

**Files:**
- Create: `node_sidecar/src/licenseStore.js`
- Create: `node_sidecar/src/controlPlaneClient.js`
- Create: `node_sidecar/tests/license-store.test.js`
- Modify: `node_sidecar/src/constants.js`

- [ ] **Step 1: Write the failing client-side storage test**

```js
const store = new LicenseStore({filePath});
store.save({
  refreshCredential: "r1",
  snapshot: {sub: "user_1", exp: "2026-04-04T12:15:00.000Z"},
  signature: "sig"
});
const state = store.read();
assert.equal(state.refreshCredential, "r1");
assert.equal(state.snapshot.sub, "user_1");
```

- [ ] **Step 2: Run the storage test**

Run: `node node_sidecar/tests/license-store.test.js`  
Expected: FAIL because `LicenseStore` does not exist.

- [ ] **Step 3: Implement local persistence and remote client methods**

Add:

- `activate()`
- `refresh()`
- `clear()`
- `read()`
- `save()`

Store data in a dedicated local file, not in `inventory_ui_state.json`.

- [ ] **Step 4: Add negative-path coverage**

Verify behavior for:

- missing refresh credential
- malformed snapshot
- network timeout
- HTTP `401` / `403` / `409`

- [ ] **Step 5: Re-run the storage test**

Run: `node node_sidecar/tests/license-store.test.js`  
Expected: PASS with deterministic read/write behavior.

### Task 8: Add a startup-first license gate and a silent refresh scheduler

**Files:**
- Create: `node_sidecar/src/licenseEnforcer.js`
- Create: `node_sidecar/src/licenseScheduler.js`
- Create: `node_sidecar/tests/license-gate.test.js`
- Create: `node_sidecar/tests/license-scheduler.test.js`
- Modify: `node_sidecar/src/uiServer.js`

- [ ] **Step 1: Write the failing gate and scheduler tests**

Add assertions for:

- expired snapshot blocks protected routes
- valid signed snapshot allows protected routes
- scheduler attempts refresh every `5 minutes`
- scheduler stops unlocking once `exp` is crossed without refresh

- [ ] **Step 2: Run the new tests**

Run:

- `node node_sidecar/tests/license-gate.test.js`
- `node node_sidecar/tests/license-scheduler.test.js`

Expected: FAIL because the enforcer and scheduler do not exist.

- [ ] **Step 3: Implement the enforcer and scheduler**

Responsibilities:

- `licenseEnforcer.js`
  - verify signature
  - check expiry
  - expose `hasPermission()`
  - expose `isLocked()`
- `licenseScheduler.js`
  - refresh on startup
  - refresh every `300000 ms`
  - emit state changes for UI updates

- [ ] **Step 4: Integrate the scheduler into server startup**

Load local license state once, attempt immediate refresh, and keep the result in memory for route gates and UI status.

- [ ] **Step 5: Re-run the new tests**

Run:

- `node node_sidecar/tests/license-gate.test.js`
- `node node_sidecar/tests/license-scheduler.test.js`

Expected: PASS with clear locked/unlocked transitions.

---

## Chunk 5: Client UI And Protected Feature Cutover

### Task 9: Replace the current local admin session gate with the signed-license gate

**Files:**
- Modify: `node_sidecar/src/uiServer.js`
- Modify: `node_sidecar/src/appAuthStore.js`
- Modify: `node_sidecar/tests/ui-server-auth.test.js`
- Modify: `node_sidecar/src/uiStateStore.js`

- [ ] **Step 1: Freeze the current auth routes with failing regression expectations**

Add tests that describe the new end state:

- `/api/auth/bootstrap-admin` is unavailable in client mode
- `/api/auth/login` is unavailable in client mode
- `/api/auth/logout` is unavailable in client mode
- protected business APIs now return `license_required` or `license_expired`

- [ ] **Step 2: Run the regression test**

Run: `node node_sidecar/tests/ui-server-auth.test.js`  
Expected: FAIL because client mode still uses app auth routes.

- [ ] **Step 3: Cut routes over to license enforcement**

In `uiServer.js`:

- replace `resolveRequestAuth()` usage with `resolveClientLicense()`
- replace `requirePermission()` with `requireLicensedFeature()`
- keep route-level checks on:
  - `/api/accounts`
  - `/api/refresh`
  - `/api/craft/*`
  - `/api/simulation/*`
  - `/api/snapshot/*`

In `uiStateStore.js`, scope persisted UI state by licensed user identity rather than by local app admin.

- [ ] **Step 4: Demote `appAuthStore.js` to migration-only status**

Stop using it in the runtime client path. Keep only the pieces needed by `tools/migrateLocalAuthToControlPlane.js`.

- [ ] **Step 5: Re-run the auth regression test**

Run: `node node_sidecar/tests/ui-server-auth.test.js`  
Expected: PASS with the client no longer exposing admin bootstrap/login/logout routes.

### Task 10: Replace the admin overlay with activation, refresh, and expired-state UI

**Files:**
- Modify: `node_sidecar/ui/index.html`
- Modify: `node_sidecar/ui/app.js`
- Modify: `node_sidecar/ui/styles.css`
- Modify: `node_sidecar/tests/app-auth-gate.test.js`

- [ ] **Step 1: Rewrite the failing UI gate test**

Replace the old admin-gate assumptions with:

- activation form appears when no refresh credential exists
- “syncing license” state appears on startup
- expired overlay appears when snapshot is invalid
- only licensed features render as enabled

- [ ] **Step 2: Run the UI gate test**

Run: `node node_sidecar/tests/app-auth-gate.test.js`  
Expected: FAIL because the UI still renders the admin bootstrap/login flow.

- [ ] **Step 3: Implement the new client gate UI**

Required states:

- `activate`
- `syncing`
- `ready`
- `expired`
- `refresh_failed_but_still_valid`

Required actions:

- login / activate user
- retry sync
- clear local license

- [ ] **Step 4: Hide or disable features from the current nav shell**

Example:

- hide or disable simulation when `simulation.use` is absent
- disable refresh buttons when `inventory.refresh` is absent
- block account editing when `accounts.write` is absent

- [ ] **Step 5: Re-run the UI gate test**

Run: `node node_sidecar/tests/app-auth-gate.test.js`  
Expected: PASS with the new activation and expiry UX.

---

## Chunk 6: Migration, Docs, And Final Verification

### Task 11: Add a one-shot migration utility from local app-auth data to the control plane

**Files:**
- Create: `tools/migrateLocalAuthToControlPlane.js`
- Modify: `node_sidecar/src/appAuthStore.js`
- Modify: `admin_console/src/controlPlaneStore.js`

- [ ] **Step 1: Write the failing migration test**

Create a focused test or inline harness that seeds local `app_user`, `membership_plan`, and `app_user_role` data, then verifies the control-plane database receives:

- `client_user`
- `membership_plan`
- `user_entitlement`

- [ ] **Step 2: Run the migration test**

Run: `node admin_console/tests/control-plane-store.test.js`  
Expected: FAIL because no migration tool exists.

- [ ] **Step 3: Implement the migration script**

Supported behavior:

- read local `csgo_skins.db`
- export compatible auth rows
- import them into the control-plane DB
- skip Steam business data entirely

- [ ] **Step 4: Re-run the migration test**

Run: `node admin_console/tests/control-plane-store.test.js`  
Expected: PASS with auth-only migration.

- [ ] **Step 5: Manual verification checkpoint**

Run the tool against a copy of the real database first. Do not commit.

### Task 12: Update docs and run the end-to-end verification matrix

**Files:**
- Modify: `README.md`
- Optionally modify: `node_sidecar/README.md`
- Optionally add: `docs/superpowers/hand-offs/2026-04-04-remote-control-plane-license.md`

- [ ] **Step 1: Update operator documentation**

Document:

- how to start the control plane
- how to bootstrap the control-plane admin
- how the client reads `CONTROL_PLANE_BASE_URL`
- how activation and `15-minute` expiry work
- what data stays local vs remote

- [ ] **Step 2: Run the automated verification suite**

Run:

- `node admin_console/tests/control-plane-store.test.js`
- `node admin_console/tests/entitlement-signer.test.js`
- `node admin_console/tests/control-plane-server.test.js`
- `node node_sidecar/tests/license-policy.test.js`
- `node node_sidecar/tests/license-store.test.js`
- `node node_sidecar/tests/license-gate.test.js`
- `node node_sidecar/tests/license-scheduler.test.js`
- `node node_sidecar/tests/app-auth-gate.test.js`
- `node node_sidecar/tests/ui-server-auth.test.js`

Expected: PASS for all tests.

- [ ] **Step 3: Run the manual desktop validation**

Manual checks:

1. Start the control plane and log in as admin
2. Create a client user and assign a plan
3. Start the desktop client with `CONTROL_PLANE_BASE_URL`
4. Activate the client user
5. Verify startup refresh succeeds
6. Disable one feature in the control plane
7. Confirm the client loses that feature within `15 minutes`
8. Revoke the device and confirm the next refresh locks the client

- [ ] **Step 4: Keep the workspace uncommitted for user validation**

Do not commit unless the user explicitly asks for it.

- [ ] **Step 5: Produce the rollout summary**

Summarize:

- created control-plane files
- modified client runtime files
- migration status
- automated test coverage
- manual validation status
