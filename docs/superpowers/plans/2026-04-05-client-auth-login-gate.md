# Client Auth Login Gate Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将客户端从“永远手工导包”收口为“正式登录 / 调试导包”双模式，并为后续邮箱验证码认证预留稳定接口。

**Architecture:** 保留现有本地 license 验签与业务 API gate，不重写授权内核。新增 `auth mode` 配置、远端认证客户端抽象、本地 `client-auth` API 和统一 gate UI，使正式模式只暴露登录流，调试模式继续保留导包流。

**Tech Stack:** Node.js HTTP server, local JSON store, current license runtime, browser UI in `node_sidecar/ui`, plain JS tests

---

### Task 1: Add client auth mode config

**Files:**
- Modify: `node_sidecar/src/licenseConfig.js`
- Test: `node_sidecar/tests/client-auth-config.test.js`

- [ ] **Step 1: Write the failing test**

Add tests covering:
- default auth mode is `debug_bundle`
- env override `CLIENT_AUTH_MODE=prod_login`
- `CONTROL_PLANE_BASE_URL` is exposed for remote auth calls

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_sidecar/tests/client-auth-config.test.js`
Expected: FAIL because auth mode fields do not exist yet

- [ ] **Step 3: Implement minimal config support**

Expose:
- `authMode`
- `allowManualImport`
- `controlPlaneBaseUrl`

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_sidecar/tests/client-auth-config.test.js`
Expected: PASS

### Task 2: Add remote auth client abstraction

**Files:**
- Create: `node_sidecar/src/controlPlaneAuthClient.js`
- Test: `node_sidecar/tests/control-plane-auth-client.test.js`

- [ ] **Step 1: Write the failing test**

Cover:
- returns not configured error when base URL is missing
- normalizes login payload
- normalizes refresh response into `{bundle, refreshCredential, user}`

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_sidecar/tests/control-plane-auth-client.test.js`
Expected: FAIL because module does not exist

- [ ] **Step 3: Implement minimal client**

Methods:
- `getCapabilities()`
- `login()`
- `refresh()`
- `logout()`
- `sendRegisterCode()`
- `register()`
- `sendResetCode()`
- `resetPassword()`

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_sidecar/tests/control-plane-auth-client.test.js`
Expected: PASS

### Task 3: Expose local client-auth API in uiServer

**Files:**
- Modify: `node_sidecar/src/uiServer.js`
- Test: `node_sidecar/tests/ui-server-auth.test.js`

- [ ] **Step 1: Write the failing test**

Add coverage for:
- `GET /api/client-auth/state`
- `prod_login` mode rejects `POST /api/license/import`
- `POST /api/client-auth/login` writes remote bundle into local runtime

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_sidecar/tests/ui-server-auth.test.js`
Expected: FAIL because routes do not exist and import is still allowed

- [ ] **Step 3: Implement minimal server changes**

Add:
- auth mode helpers
- public route whitelist updates
- local client-auth routes
- remote auth client injection hook
- manual import guard in `prod_login`

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_sidecar/tests/ui-server-auth.test.js`
Expected: PASS

### Task 4: Convert gate UI to dual mode shell

**Files:**
- Modify: `node_sidecar/ui/index.html`
- Modify: `node_sidecar/ui/app.js`
- Modify: `node_sidecar/ui/styles.css`
- Test: `node_sidecar/tests/app-auth-gate.test.js`

- [ ] **Step 1: Write the failing test**

Add assertions for:
- login form markup exists
- register / reset sections exist
- JS bootstraps `/api/client-auth/state`

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_sidecar/tests/app-auth-gate.test.js`
Expected: FAIL because login-mode shell does not exist

- [ ] **Step 3: Implement minimal UI behavior**

Requirements:
- `debug_bundle` shows current bundle import UI
- `prod_login` shows login/register/reset tabs
- login submits to `/api/client-auth/login`
- register/reset call local sidecar proxy routes
- logout/clear still clears local runtime

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_sidecar/tests/app-auth-gate.test.js`
Expected: PASS

### Task 5: Wire refresh token based silent renewal

**Files:**
- Modify: `node_sidecar/src/uiServer.js`
- Modify: `node_sidecar/src/licenseScheduler.js`
- Test: `node_sidecar/tests/license-scheduler.test.js`

- [ ] **Step 1: Write the failing test**

Add coverage that:
- scheduler calls remote refresh when `refresh_credential` exists and bundle is near expiry
- refreshed bundle is saved back into store

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_sidecar/tests/license-scheduler.test.js`
Expected: FAIL because remote auth refresh is not wired yet

- [ ] **Step 3: Implement minimal refresh integration**

Reuse current `refreshFn` extension point.

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_sidecar/tests/license-scheduler.test.js`
Expected: PASS

### Task 6: Verify targeted regression set

**Files:**
- Modify: none
- Test:
  - `node_sidecar/tests/client-auth-config.test.js`
  - `node_sidecar/tests/control-plane-auth-client.test.js`
  - `node_sidecar/tests/ui-server-auth.test.js`
  - `node_sidecar/tests/app-auth-gate.test.js`
  - `node_sidecar/tests/license-scheduler.test.js`
  - `node_sidecar/tests/tradeup-simulation-picker-interaction.test.js`

- [ ] **Step 1: Run targeted verification**

Run:
- `node node_sidecar/tests/client-auth-config.test.js`
- `node node_sidecar/tests/control-plane-auth-client.test.js`
- `node node_sidecar/tests/ui-server-auth.test.js`
- `node node_sidecar/tests/app-auth-gate.test.js`
- `node node_sidecar/tests/license-scheduler.test.js`
- `node node_sidecar/tests/tradeup-simulation-picker-interaction.test.js`

Expected: All PASS

- [ ] **Step 2: Run syntax checks**

Run:
- `node -c node_sidecar/src/uiServer.js`
- `node -c node_sidecar/src/controlPlaneAuthClient.js`
- `node -c node_sidecar/ui/app.js`

Expected: exit 0

- [ ] **Step 3: Leave changes uncommitted for user validation**

Do not commit in this workspace unless the user explicitly requests it.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-05-client-auth-login-gate.md`. Execution proceeds in the current workspace because this repository is configured to avoid worktrees by default unless the user explicitly asks for isolation.
