# Membership Steam Binding Tier Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 7-day trial membership that can bind exactly one Steam account and use craft during the trial, keep `standard` limited to one Steam account, keep `member` unlimited, and prevent local deletion or reinstall from resetting single-account binding eligibility.

**Architecture:** Keep the remote control plane as the source of truth for membership lifecycle, entitlement flags, and Steam binding eligibility. The client continues to store local Steam accounts and snapshots, but `login-save` must ask the control plane to accept or reject a bound `steam_id64` before writing local account data. Craft availability remains entitlement-driven: active `trial / standard / member` carry `craft.use`, while expired or unopened `inactive` does not.

**Tech Stack:** Node.js CommonJS, built-in `http`/`crypto`/`node:sqlite`, plain HTML/CSS/JS, `node:assert` style test files invoked with `node <test-file>`.

---

**Workspace Policy:** This repository stays uncommitted unless the user explicitly asks. Replace normal commit steps with a diff checkpoint and verification run; do not create commits while executing this plan unless the user later requests it.

## File Structure

- Modify: `admin_console/src/controlPlaneStore.js`
  Own the membership plan catalog, entitlement resolution, trial expiry fallback, and persistent Steam binding eligibility checks.
- Modify: `admin_console/src/server.js`
  Own registration defaults and the new authenticated Steam binding check/bind endpoint.
- Modify: `admin_console/src/entitlementSigner.js`
  Add the new membership-specific `feature_flags` and keep signed bundle payloads aligned with resolved entitlements.
- Modify: `admin_console/ui/app.js`
  Surface `trial / standard / member / inactive` semantics and operator guidance in the control plane UI.
- Modify: `admin_console/tests/control-plane-store.test.js`
  Lock plan defaults, expiry handling, and entitlement flags.
- Create: `admin_console/tests/control-plane-binding-policy.test.js`
  Lock single-bind vs unlimited-bind behavior at the store level.
- Modify: `admin_console/tests/control-plane-server.test.js`
  Lock registration, login/refresh entitlement payloads, and the new Steam binding endpoint.
- Modify: `admin_console/tests/control-plane-ui-copy.test.js`
  Lock operator-facing copy for trial and inactive states.
- Modify: `node_sidecar/src/controlPlaneAuthClient.js`
  Add the client call that sends `refresh_token + device_id + steam_id` to the control plane binding endpoint.
- Modify: `node_sidecar/src/uiServer.js`
  Call the binding endpoint during `login-save` before local account persistence; preserve current local delete semantics.
- Modify: `node_sidecar/ui/app.js`
  Render trial countdown, binding-limit copy, craft availability copy, and inactive-state guidance in the client UI.
- Modify: `node_sidecar/tests/control-plane-auth-client.test.js`
  Lock request/response normalization for the new binding endpoint.
- Modify: `node_sidecar/tests/client-auth-session-lifecycle.test.js`
  Lock active `trial` entitlement payload handling and expired-trial fallback behavior.
- Create: `node_sidecar/tests/account-binding-policy.test.js`
  Lock `login-save` behavior so rejected bindings never write local accounts.
- Modify: `node_sidecar/tests/craft-permission-gate.test.js`
  Lock the rule that active `trial` still carries `craft.use`, while `inactive` does not.
- Modify: `node_sidecar/tests/ui-server-auth.test.js`
  Lock `/api/client-auth/state` and related auth payloads for `trial` and `inactive`.
- Modify: `tests/accountDeleteModal.test.js`
  Lock the client delete copy so it says local deletion does not equal rebinding.
- Create: `tests/clientMembershipCopy.test.js`
  Lock client-side UI copy for `trial / standard / member / inactive`.

## Chunk 1: Control Plane Membership Lifecycle

### Task 1: Redefine membership plans and entitlement payloads around `trial / standard / member / inactive`

**Files:**
- Modify: `admin_console/tests/control-plane-store.test.js`
- Modify: `admin_console/src/controlPlaneStore.js`
- Modify: `admin_console/src/entitlementSigner.js`

- [ ] **Step 1: Write the failing store tests**

```js
function test_trial_plan_keeps_craft_permission_while_membership_is_active() {
  const now = new Date("2026-04-08T00:00:00.000Z");
  const store = new ControlPlaneStore({dbPath});
  const user = store.createClientUser({
    email: "trial@example.com",
    username: "trial_user",
    password: "Secret123!",
    membershipPlan: "trial",
    membershipExpiresAt: "2026-04-15T00:00:00.000Z",
    now
  });
  const entitlements = store.resolveUserEntitlements({userId: user.id, now});
  assert.equal(entitlements.membership_plan, "trial");
  assert.equal(entitlements.permissions.includes(FEATURE_CODES.CRAFT_USE), true);
  assert.equal(entitlements.feature_flags.craft_enabled, true);
  assert.equal(entitlements.feature_flags.steam_binding_limit, 1);
}

function test_expired_trial_falls_back_to_inactive_without_craft_permission() {
  const store = new ControlPlaneStore({dbPath});
  const user = store.createClientUser({
    email: "expired@example.com",
    username: "expired_trial",
    password: "Secret123!",
    membershipPlan: "trial",
    membershipExpiresAt: "2026-04-01T00:00:00.000Z",
    now: new Date("2026-03-25T00:00:00.000Z")
  });
  const entitlements = store.resolveUserEntitlements({
    userId: user.id,
    now: new Date("2026-04-20T00:00:00.000Z")
  });
  assert.equal(entitlements.membership_plan, "inactive");
  assert.equal(entitlements.permissions.includes(FEATURE_CODES.CRAFT_USE), false);
  assert.equal(entitlements.feature_flags.craft_enabled, false);
}
```

- [ ] **Step 2: Run the store tests to confirm failure**

Run: `node admin_console/tests/control-plane-store.test.js`
Expected: FAIL because the current default plan model is still `free / pro / elite` and only emits `simulation_enabled`.

- [ ] **Step 3: Implement the minimal membership and entitlement changes**

```js
const DEFAULT_MEMBERSHIP_PLANS = [
  {code: "inactive", name: "Inactive", permissions: []},
  {
    code: "trial",
    name: "Trial",
    permissions: [
      FEATURE_CODES.ACCOUNTS_READ,
      FEATURE_CODES.ACCOUNTS_WRITE,
      FEATURE_CODES.INVENTORY_READ,
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.SIMULATION_USE,
      FEATURE_CODES.CRAFT_USE
    ]
  },
  {
    code: "standard",
    name: "Standard",
    permissions: [
      FEATURE_CODES.ACCOUNTS_READ,
      FEATURE_CODES.ACCOUNTS_WRITE,
      FEATURE_CODES.INVENTORY_READ,
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.SIMULATION_USE,
      FEATURE_CODES.CRAFT_USE
    ]
  },
  {
    code: "member",
    name: "Member",
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

return {
  membership_plan: effectivePlanCode,
  feature_flags: {
    simulation_enabled: resolvedPermissions.includes(FEATURE_CODES.SIMULATION_USE),
    craft_enabled: resolvedPermissions.includes(FEATURE_CODES.CRAFT_USE),
    steam_binding_mode: effectivePlanCode === "member" ? "unlimited" : "single_locked",
    steam_binding_limit: effectivePlanCode === "member" ? -1 : (effectivePlanCode === "inactive" ? 0 : 1),
    trial_active: effectivePlanCode === "trial",
    trial_expires_at: effectivePlanCode === "trial" ? user.membership_expires_at : ""
  }
};
```

- [ ] **Step 4: Re-run the store tests**

Run: `node admin_console/tests/control-plane-store.test.js`
Expected: PASS with active `trial` still carrying `craft.use` and expired `trial` resolving to `inactive`.

- [ ] **Step 5: Checkpoint**

Run: `git diff -- admin_console/src/controlPlaneStore.js admin_console/src/entitlementSigner.js admin_console/tests/control-plane-store.test.js`
Expected: only membership-plan and entitlement-flag changes appear; do not commit.

### Task 2: Make registration grant a 7-day `trial` instead of an inert baseline plan

**Files:**
- Modify: `admin_console/tests/control-plane-server.test.js`
- Modify: `admin_console/src/server.js`

- [ ] **Step 1: Write the failing registration test**

```js
assert.equal(register.body.user.membership_plan, "trial");
assert.equal(register.body.user.membership_expires_at, "2026-04-15T00:00:00.000Z");
assert.equal(register.body.user.remaining_membership_days, 7);
```

- [ ] **Step 2: Run the server test to confirm failure**

Run: `node admin_console/tests/control-plane-server.test.js`
Expected: FAIL because `/api/auth/register` currently creates users with the store default (`free`) and no trial expiry.

- [ ] **Step 3: Implement explicit `trial + 7 days` registration defaults**

```js
const registerNow = now();
const trialExpiresAt = new Date(registerNow.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
const user = store.createClientUser({
  email,
  username,
  password,
  membershipPlan: "trial",
  membershipExpiresAt: trialExpiresAt,
  now: registerNow
});
```

- [ ] **Step 4: Re-run the server test**

Run: `node admin_console/tests/control-plane-server.test.js`
Expected: PASS with registration creating a `trial` user whose expiry is pinned to injected `now()`.

- [ ] **Step 5: Checkpoint**

Run: `git diff -- admin_console/src/server.js admin_console/tests/control-plane-server.test.js`
Expected: only registration-default changes appear; do not commit.

## Chunk 2: Control Plane Steam Binding Eligibility

### Task 3: Persist single-bind eligibility and expose an authenticated `check-or-bind` endpoint

**Files:**
- Create: `admin_console/tests/control-plane-binding-policy.test.js`
- Modify: `admin_console/src/controlPlaneStore.js`
- Modify: `admin_console/src/server.js`
- Modify: `admin_console/tests/control-plane-server.test.js`

- [ ] **Step 1: Write failing binding-policy tests**

```js
function test_trial_user_can_bind_first_steam_id_but_not_second() {
  const store = new ControlPlaneStore({dbPath});
  const user = makeUser(store, {membershipPlan: "trial", membershipExpiresAt: "2026-04-15T00:00:00.000Z"});
  assert.deepEqual(store.checkOrBindSteamAccount({userId: user.id, steamId: "76561198000000001", now}).ok, true);
  const denied = store.checkOrBindSteamAccount({userId: user.id, steamId: "76561198000000002", now});
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "steam_binding_limit_reached");
}

function test_member_user_can_bind_multiple_steam_ids() {
  const store = new ControlPlaneStore({dbPath});
  const user = makeUser(store, {membershipPlan: "member"});
  assert.equal(store.checkOrBindSteamAccount({userId: user.id, steamId: "76561198000000001", now}).ok, true);
  assert.equal(store.checkOrBindSteamAccount({userId: user.id, steamId: "76561198000000002", now}).ok, true);
}
```

- [ ] **Step 2: Run the new binding-policy tests**

Run: `node admin_console/tests/control-plane-binding-policy.test.js`
Expected: FAIL because there is currently no `client_user_steam_binding` table or `checkOrBindSteamAccount` method.

- [ ] **Step 3: Implement the binding table, store helpers, and HTTP route**

```js
CREATE TABLE IF NOT EXISTS client_user_steam_binding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  steam_id TEXT NOT NULL,
  steam_account_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  first_bound_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'client_login_save',
  note TEXT NOT NULL DEFAULT '',
  UNIQUE(user_id, steam_id)
);

checkOrBindSteamAccount({userId, steamId, steamAccountName = "", now = new Date()} = {}) {
  // resolve entitlements; reject inactive; allow same steam_id; enforce limit 1 for trial/standard; unlimited for member
}

if (req.method === "POST" && pathname === "/api/auth/steam-binding/check-or-bind") {
  const access = store.resolveClientAccess({refreshToken, deviceId, now: now()});
  const result = store.checkOrBindSteamAccount({
    userId: access.user.id,
    steamId,
    steamAccountName,
    now: now()
  });
}
```

- [ ] **Step 4: Re-run binding and server tests**

Run: `node admin_console/tests/control-plane-binding-policy.test.js`
Expected: PASS

Run: `node admin_console/tests/control-plane-server.test.js`
Expected: PASS with endpoint coverage for same-account reuse, second-account rejection, and member multi-bind success.

- [ ] **Step 5: Checkpoint**

Run: `git diff -- admin_console/src/controlPlaneStore.js admin_console/src/server.js admin_console/tests/control-plane-binding-policy.test.js admin_console/tests/control-plane-server.test.js`
Expected: only binding-model and endpoint changes appear; do not commit.

## Chunk 3: Client Runtime Enforcement

### Task 4: Teach the client auth client how to call the Steam binding endpoint

**Files:**
- Modify: `node_sidecar/src/controlPlaneAuthClient.js`
- Modify: `node_sidecar/tests/control-plane-auth-client.test.js`

- [ ] **Step 1: Write the failing auth-client test**

```js
const result = await client.checkOrBindSteamAccount({
  refreshCredential: "refresh_1",
  deviceId: "device_alpha",
  steamId: "76561198000000001",
  steamAccountName: "steam_account_a"
});
assert.equal(capturedPathname, "/api/auth/steam-binding/check-or-bind");
assert.equal(capturedBody.steam_id, "76561198000000001");
assert.equal(result.binding_limit, 1);
```

- [ ] **Step 2: Run the auth-client test**

Run: `node node_sidecar/tests/control-plane-auth-client.test.js`
Expected: FAIL because the client does not yet expose a binding-check method.

- [ ] **Step 3: Implement the minimal client wrapper**

```js
async checkOrBindSteamAccount({refreshCredential = "", deviceId = "", steamId = "", steamAccountName = ""} = {}) {
  return postJson("/api/auth/steam-binding/check-or-bind", {
    refresh_token: asString(refreshCredential).trim(),
    device_id: asString(deviceId).trim(),
    steam_id: asString(steamId).trim(),
    steam_account_name: asString(steamAccountName).trim()
  });
}
```

- [ ] **Step 4: Re-run the auth-client test**

Run: `node node_sidecar/tests/control-plane-auth-client.test.js`
Expected: PASS

- [ ] **Step 5: Checkpoint**

Run: `git diff -- node_sidecar/src/controlPlaneAuthClient.js node_sidecar/tests/control-plane-auth-client.test.js`
Expected: only the new client wrapper and test assertions appear; do not commit.

### Task 5: Gate `login-save` on remote binding approval before local account persistence

**Files:**
- Create: `node_sidecar/tests/account-binding-policy.test.js`
- Modify: `node_sidecar/src/uiServer.js`
- Modify: `node_sidecar/tests/client-auth-session-lifecycle.test.js`

- [ ] **Step 1: Write the failing `login-save` binding tests**

```js
async function test_login_save_rejects_second_trial_binding_without_writing_local_account() {
  const response = await requestJson(ctx, "POST", "/api/accounts/login-save", {
    username: "steam_account_b",
    password: "pw",
    totp: "123456"
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.reason, "steam_binding_limit_reached");
  assert.equal(store.list().some((item) => item.username === "steam_account_b"), false);
}

async function test_login_save_reuses_license_refresh_credential_for_binding_check() {
  assert.equal(capturedArgs.refreshCredential, "remote_refresh_token");
  assert.equal(capturedArgs.steamId, "76561198000000001");
}
```

- [ ] **Step 2: Run the new targeted test**

Run: `node node_sidecar/tests/account-binding-policy.test.js`
Expected: FAIL because `login-save` currently writes the local account immediately after Steam auth.

- [ ] **Step 3: Implement the minimal `uiServer.js` gate**

```js
const runtimeBundle = auth.licenseRuntime && typeof auth.licenseRuntime.readBundle === "function"
  ? auth.licenseRuntime.readBundle()
  : null;
const refreshCredential = asString(runtimeBundle && runtimeBundle.refresh_credential).trim();
const binding = await authClient.checkOrBindSteamAccount({
  refreshCredential,
  deviceId: resolveDeviceId(getClientLicenseConfig(deps).machineIdFile),
  steamId: nextSteamId,
  steamAccountName: username
});
if (!binding || binding.ok === false) {
  writeJson(res, 409, {
    ok: false,
    reason: asString(binding && binding.reason || "steam_binding_denied").trim(),
    message: asString(binding && binding.message || "当前账号不允许绑定新的 Steam 账号").trim()
  });
  return true;
}
```

- [ ] **Step 4: Re-run the binding and lifecycle tests**

Run: `node node_sidecar/tests/account-binding-policy.test.js`
Expected: PASS

Run: `node node_sidecar/tests/client-auth-session-lifecycle.test.js`
Expected: PASS with the runtime still exposing the saved `refresh_credential` during authenticated client flows.

- [ ] **Step 5: Checkpoint**

Run: `git diff -- node_sidecar/src/uiServer.js node_sidecar/tests/account-binding-policy.test.js node_sidecar/tests/client-auth-session-lifecycle.test.js`
Expected: only `login-save` gating changes appear; do not commit.

### Task 6: Keep craft gating aligned with active `trial` and expired `inactive`

**Files:**
- Modify: `node_sidecar/tests/craft-permission-gate.test.js`
- Modify: `node_sidecar/tests/ui-server-auth.test.js`
- Modify: `node_sidecar/src/uiServer.js`

- [ ] **Step 1: Write the failing permission tests**

```js
async function test_active_trial_bundle_can_request_real_craft() {
  const auth = makeLicenseAuth({
    membershipPlan: "trial",
    permissions: [FEATURE_CODES.CRAFT_USE]
  });
  const response = await requestWithAuth(auth, "POST", "/api/craft/tradeup", payload);
  assert.notEqual(response.status, 403);
}

async function test_inactive_bundle_loses_craft_permission() {
  const auth = makeLicenseAuth({
    membershipPlan: "inactive",
    permissions: []
  });
  const response = await requestWithAuth(auth, "POST", "/api/craft/tradeup", payload);
  assert.equal(response.status, 403);
}
```

- [ ] **Step 2: Run the permission tests**

Run: `node node_sidecar/tests/craft-permission-gate.test.js`
Expected: FAIL until the test fixtures and auth-state payloads acknowledge active `trial` as a craft-enabled state.

- [ ] **Step 3: Make the auth payloads and route tests match the new entitlement contract**

```js
feature_flags: {
  craft_enabled: permissions.includes(FEATURE_CODES.CRAFT_USE),
  steam_binding_limit: membershipPlan === "member" ? -1 : (membershipPlan === "inactive" ? 0 : 1),
  trial_active: membershipPlan === "trial"
}
```

- [ ] **Step 4: Re-run the permission and auth tests**

Run: `node node_sidecar/tests/craft-permission-gate.test.js`
Expected: PASS

Run: `node node_sidecar/tests/ui-server-auth.test.js`
Expected: PASS

- [ ] **Step 5: Checkpoint**

Run: `git diff -- node_sidecar/src/uiServer.js node_sidecar/tests/craft-permission-gate.test.js node_sidecar/tests/ui-server-auth.test.js`
Expected: only entitlement payload and route-gate expectation changes appear; do not commit.

## Chunk 4: UI Copy And User Guidance

### Task 7: Update the client UI to explain trial countdown, craft availability, and non-rebinding deletion

**Files:**
- Modify: `node_sidecar/ui/app.js`
- Modify: `tests/accountDeleteModal.test.js`
- Create: `tests/clientMembershipCopy.test.js`

- [ ] **Step 1: Write the failing UI-copy tests**

```js
assert.match(APP_SOURCE, /新用户体验中，还可使用 7 天普通版权限/);
assert.match(APP_SOURCE, /体验期内可使用炼金，到期后将失效/);
assert.match(APP_SOURCE, /删除本地账号不等于换绑/);
```

- [ ] **Step 2: Run the UI-copy tests**

Run: `node tests/accountDeleteModal.test.js`
Expected: FAIL once the delete modal copy assertion is tightened.

Run: `node tests/clientMembershipCopy.test.js`
Expected: FAIL because the membership copy test file does not exist yet.

- [ ] **Step 3: Implement the minimal copy updates**

```js
message: `确认删除账号“${row.remark || row.username}（${row.username}）”？\n该操作只会移除本地保存的密码与账号记录，不会释放会员绑定资格。`

ui.membershipStatus.textContent = trialActive
  ? `新用户体验中，还可使用 ${remainingDays} 天普通版权限`
  : inactive
    ? "体验已到期，请开通会员后继续使用炼金功能"
    : membershipPlan === "member"
      ? "当前版本支持绑定无限个 Steam 账号"
      : "当前版本仅支持绑定 1 个 Steam 账号";
```

- [ ] **Step 4: Re-run the UI-copy tests**

Run: `node tests/accountDeleteModal.test.js`
Expected: PASS

Run: `node tests/clientMembershipCopy.test.js`
Expected: PASS

- [ ] **Step 5: Checkpoint**

Run: `git diff -- node_sidecar/ui/app.js tests/accountDeleteModal.test.js tests/clientMembershipCopy.test.js`
Expected: only copy and membership-status rendering changes appear; do not commit.

### Task 8: Update control-plane UI copy for trial and inactive operators

**Files:**
- Modify: `admin_console/ui/app.js`
- Modify: `admin_console/tests/control-plane-ui-copy.test.js`

- [ ] **Step 1: Write the failing control-plane UI-copy assertions**

```js
assert.equal(
  APP_SOURCE.includes("Trial：新注册用户默认获得 7 天普通版权限，期间允许炼金。"),
  true
);
assert.equal(
  APP_SOURCE.includes("Inactive：体验到期或未开通，不能炼金，但保留既有 Steam 绑定资格。"),
  true
);
```

- [ ] **Step 2: Run the control-plane UI-copy test**

Run: `node admin_console/tests/control-plane-ui-copy.test.js`
Expected: FAIL because the console still describes the older `free / pro` semantics.

- [ ] **Step 3: Implement the minimal operator guidance**

```js
refs.membershipMeta.textContent = user.membership_plan === "trial"
  ? "Trial：新注册用户默认获得 7 天普通版权限，期间允许炼金。"
  : user.membership_plan === "inactive"
    ? "Inactive：体验到期或未开通，不能炼金，但保留既有 Steam 绑定资格。"
    : `当前计划：${user.membership_plan}，可按需覆盖单项权限。`;
```

- [ ] **Step 4: Re-run the control-plane UI-copy test**

Run: `node admin_console/tests/control-plane-ui-copy.test.js`
Expected: PASS

- [ ] **Step 5: Checkpoint**

Run: `git diff -- admin_console/ui/app.js admin_console/tests/control-plane-ui-copy.test.js`
Expected: only operator copy changes appear; do not commit.

## Chunk 5: Focused Verification

### Task 9: Run the focused regression suite and manual smoke checks

**Files:**
- Reference only: `docs/superpowers/specs/2026-04-08-membership-steam-binding-tier-design.md`

- [ ] **Step 1: Run automated control-plane verification**

Run: `node admin_console/tests/control-plane-store.test.js`
Expected: PASS

Run: `node admin_console/tests/control-plane-binding-policy.test.js`
Expected: PASS

Run: `node admin_console/tests/control-plane-server.test.js`
Expected: PASS

Run: `node admin_console/tests/control-plane-ui-copy.test.js`
Expected: PASS

- [ ] **Step 2: Run automated client verification**

Run: `node node_sidecar/tests/control-plane-auth-client.test.js`
Expected: PASS

Run: `node node_sidecar/tests/client-auth-session-lifecycle.test.js`
Expected: PASS

Run: `node node_sidecar/tests/account-binding-policy.test.js`
Expected: PASS

Run: `node node_sidecar/tests/craft-permission-gate.test.js`
Expected: PASS

Run: `node node_sidecar/tests/ui-server-auth.test.js`
Expected: PASS

Run: `node tests/accountDeleteModal.test.js`
Expected: PASS

Run: `node tests/clientMembershipCopy.test.js`
Expected: PASS

- [ ] **Step 3: Run the manual smoke flow**

```text
1. Register a fresh client user.
2. Confirm the user lands on `trial` with a 7-day expiry.
3. Log into one Steam account and verify `login-save` succeeds.
4. Try a second Steam account on the same `trial` user and confirm the client is rejected before local persistence.
5. Confirm active `trial` can still access craft execution.
6. Force the same user into expired `trial` / `inactive` in the control plane.
7. Refresh client auth state and confirm craft is disabled while the original Steam binding still remains reserved.
8. Upgrade the same user to `standard`, then `member`, and confirm binding/craft behavior follows the new plan immediately after entitlement refresh.
```

- [ ] **Step 4: Final checkpoint**

Run: `git status --short`
Expected: only the planned files are modified or newly created; do not commit unless the user explicitly requests it.

## Verification

- Run: `node admin_console/tests/control-plane-store.test.js`
- Run: `node admin_console/tests/control-plane-binding-policy.test.js`
- Run: `node admin_console/tests/control-plane-server.test.js`
- Run: `node admin_console/tests/control-plane-ui-copy.test.js`
- Run: `node node_sidecar/tests/control-plane-auth-client.test.js`
- Run: `node node_sidecar/tests/client-auth-session-lifecycle.test.js`
- Run: `node node_sidecar/tests/account-binding-policy.test.js`
- Run: `node node_sidecar/tests/craft-permission-gate.test.js`
- Run: `node node_sidecar/tests/ui-server-auth.test.js`
- Run: `node tests/accountDeleteModal.test.js`
- Run: `node tests/clientMembershipCopy.test.js`

## Notes

- Follow `@superpowers:test-driven-development` while executing: each behavior change should land behind a failing test first.
- Follow `@superpowers:verification-before-completion` before claiming the feature is done.
- Do not change local account deletion into a remote unbind; the spec explicitly forbids releasing binding eligibility from the client.
- Do not silently keep old `free / pro / elite` operator copy in UI surfaces after the new plan model lands.
- Do not commit during execution unless the user later explicitly asks for a commit.
