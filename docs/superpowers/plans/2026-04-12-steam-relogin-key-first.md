# Steam Relogin Key-First Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Steam refresh/relogin so `/api/refresh` only uses saved `loginKey`, marks invalid credentials as `登录失效`, and reuses `/api/accounts/login-save` for locked-account relogin that restores a fresh key before retrying refresh.

**Architecture:** Persist per-account auth metadata alongside snapshot metadata in `UiStateStore` so server routes, snapshot APIs, SSE events, and the browser all read the same `normal` / `login_required` / `auth_invalid` source of truth. Keep `login-save` as the only `账号 + 密码 + 令牌` authentication path; refresh stays key-first by passing a refresh-token-only flag down through `refreshWorkflow`, `sessionPool`, and `CS2Session`, while the existing add-account modal gains a relogin mode instead of introducing a second dialog.

**Tech Stack:** Node.js CommonJS, `steam-user`, `steam-session`, vanilla browser JS/CSS/HTML, plain Node test scripts, PowerShell runtime verification.

---

## File Map

- Modify: `node_sidecar/src/uiStateStore.js`
  Responsibility: store per-account `auth_state`, `auth_reason`, and clearing helpers next to snapshot metadata without breaking existing snapshot backup/cleanup behavior.
- Modify: `node_sidecar/src/uiServer.js`
  Responsibility: make runtime dependencies injectable for tests, normalize refresh errors into structured HTTP payloads, clear invalid-auth state after successful `login-save`, and expose auth metadata on account/snapshot routes.
- Modify: `node_sidecar/src/refreshWorkflow.js`
  Responsibility: enforce key-first refresh rules and throw typed refresh errors such as `login_key_missing` / `login_key_invalid`.
- Modify: `node_sidecar/src/services/refreshRuntime.js`
  Responsibility: include structured refresh failure metadata in SSE events so live UI state stays aligned with server auth state.
- Modify: `node_sidecar/src/services/sessionPool.js`
  Responsibility: pass through a refresh-token-only connection mode for refresh/reconnect work without changing debug-only password flows.
- Modify: `node_sidecar/src/cs2Session.js`
  Responsibility: honor refresh-token-only mode so refresh never falls back to password logon or terminal `steamGuard` prompts.
- Modify: `node_sidecar/ui/app.js`
  Responsibility: add relogin modal mode, keep usernames locked in auto-open relogin, focus `guard` by default, distinguish `未连接` from `登录失效`, and auto-retry refresh after successful relogin.
- Modify: `node_sidecar/ui/index.html`
  Responsibility: expose modal title/hint hooks and any lock-state affordances needed for the reused account modal.
- Modify: `node_sidecar/ui/styles.css`
  Responsibility: style locked relogin fields and invalid-auth badge states in the existing ink-blue UI language.
- Create: `node_sidecar/tests/refresh-auth-route.test.js`
  Responsibility: cover `/api/refresh` and `/api/accounts/login-save` auth-state contracts without live Steam dependencies.
- Create: `node_sidecar/tests/account-relogin-modal.test.js`
  Responsibility: cover relogin modal mode, locked username behavior, guard focus, badge text, and auto-retry wiring in `app.js`.

## Execution Notes

- Follow `@superpowers:test-driven-development` inside every task: write or extend the failing assertion first, then implement the smallest change that makes it pass.
- Use `@superpowers:verification-before-completion` before claiming the feature is done.
- Do not commit in this repository unless the user explicitly asks for a commit.

## Chunk 1: Server Contracts

### Task 1: Persist auth state in the server-facing account metadata

**Files:**
- Modify: `node_sidecar/src/uiStateStore.js`
- Modify: `node_sidecar/src/uiServer.js`
- Test: `node_sidecar/tests/refresh-auth-route.test.js`

- [ ] Step 1: Create `node_sidecar/tests/refresh-auth-route.test.js` with a temp runtime-path harness that seeds `accounts.json`, `login_keys.json`, and `inventory_ui_state.json`, then asserts `/api/accounts` and `/api/snapshot/account` expose `auth_state`, `auth_reason`, and default `normal` values.
- [ ] Step 2: Run `node .\node_sidecar\tests\refresh-auth-route.test.js` and confirm it fails because the current responses do not include auth metadata.
- [ ] Step 3: Extend `UiStateStore` account records to persist `snapshot_path`, `fetch_time`, `auth_state`, and `auth_reason`, plus helpers such as `setAccountAuthState()` and `clearAccountAuthState()` that do not clobber snapshot data.
- [ ] Step 4: Update `/api/accounts` and `/api/snapshot/account` in `uiServer.js` to merge `UiStateStore` auth metadata into response payloads while preserving the existing account list and snapshot response shape.
- [ ] Step 5: Re-run `node .\node_sidecar\tests\refresh-auth-route.test.js` and confirm the auth-state response assertions pass.

### Task 2: Make refresh/login routes injectable enough to test without Steam

**Files:**
- Modify: `node_sidecar/src/uiServer.js`
- Test: `node_sidecar/tests/refresh-auth-route.test.js`

- [ ] Step 1: Extend `node_sidecar/tests/refresh-auth-route.test.js` with stub-driven `/api/refresh` and `/api/accounts/login-save` cases that need to inject `refreshInventoryFn` and `loginAndSaveTokenFn` into the server.
- [ ] Step 2: Run `node .\node_sidecar\tests\refresh-auth-route.test.js` and confirm the current `createServer()` path cannot isolate those code paths yet.
- [ ] Step 3: Refactor `uiServer.js` runtime setup so `createServer(options)` can accept `refreshInventoryFn`, `loginAndSaveTokenFn`, and optional runtime/session factory overrides while production still defaults to the existing real implementations.
- [ ] Step 4: Keep `ensureRuntimeBootstrapped()` and server shutdown behavior intact after the refactor so existing routes still clean up worker pools and sessions.
- [ ] Step 5: Re-run `node .\node_sidecar\tests\refresh-auth-route.test.js` and confirm the route harness now runs fully against stubs.

## Chunk 2: Key-First Refresh Flow

### Task 3: Stop refresh from falling back to password login

**Files:**
- Modify: `node_sidecar/src/refreshWorkflow.js`
- Modify: `node_sidecar/src/services/sessionPool.js`
- Modify: `node_sidecar/src/cs2Session.js`
- Test: `node_sidecar/tests/refresh-auth-route.test.js`

- [ ] Step 1: Add failing cases to `node_sidecar/tests/refresh-auth-route.test.js` for `login_key_missing` when no saved key exists and `login_key_invalid` when the refresh path reports an expired/invalid key.
- [ ] Step 2: Run `node .\node_sidecar\tests\refresh-auth-route.test.js` and confirm `/api/refresh` still collapses these scenarios into the current generic failure path.
- [ ] Step 3: Teach `refreshWorkflow.js` to treat saved `loginKey` as mandatory for refresh, skip saved-password fallback when no key exists, and throw typed errors that distinguish missing key from invalid key.
- [ ] Step 4: Thread a `refreshTokenOnly` or equivalent flag through `sessionPool.js` and `cs2Session.js` so refresh/reconnect never prompts for `steamGuard`, while debug capture / reward workflows keep their current dual-mode behavior.
- [ ] Step 5: Re-run `node .\node_sidecar\tests\refresh-auth-route.test.js` and confirm refresh now distinguishes missing vs invalid key without using password fallback.

### Task 4: Persist invalid-auth state and clear it after successful relogin

**Files:**
- Modify: `node_sidecar/src/uiServer.js`
- Modify: `node_sidecar/src/services/refreshRuntime.js`
- Test: `node_sidecar/tests/refresh-auth-route.test.js`
- Test: `node_sidecar/tests/account-binding-policy.test.js`

- [ ] Step 1: Add failing coverage showing `login_key_invalid` marks the account `auth_invalid`, repeated `/api/refresh` calls stop blind retries against the same old key, and successful `/api/accounts/login-save` clears the invalid state.
- [ ] Step 2: Run `node .\node_sidecar\tests\refresh-auth-route.test.js` and confirm the state-persistence and state-clear assertions fail.
- [ ] Step 3: Normalize `/api/refresh` failures in `uiServer.js` into structured payloads with `reason`, `auth_state`, `relogin_required`, and `username`, write `auth_invalid` into `UiStateStore`, and clear that state after successful `login-save`.
- [ ] Step 4: Update `refreshRuntime.js` so `inventory_refresh_failed` SSE payloads carry the same structured `reason` / `auth_state` fields needed by the live UI.
- [ ] Step 5: Re-run `node .\node_sidecar\tests\refresh-auth-route.test.js` and `node .\node_sidecar\tests\account-binding-policy.test.js`, confirming auth-state handling works and binding checks around `login-save` still pass.

## Chunk 3: Relogin UI

### Task 5: Add a relogin mode to the existing account modal

**Files:**
- Modify: `node_sidecar/ui/app.js`
- Modify: `node_sidecar/ui/index.html`
- Modify: `node_sidecar/ui/styles.css`
- Test: `node_sidecar/tests/account-relogin-modal.test.js`

- [ ] Step 1: Create `node_sidecar/tests/account-relogin-modal.test.js` with a VM harness that exercises a relogin-modal controller and asserts title text, hint text, locked username, cleared TOTP, password prefill, submit-label swap, and guard-first focus.
- [ ] Step 2: Run `node .\node_sidecar\tests\account-relogin-modal.test.js` and confirm it fails because the modal currently only supports add-account mode.
- [ ] Step 3: Add explicit modal-mode state in `app.js`, plus HTML hooks for the modal title/hint and CSS for read-only/locked fields that match the current modal card style.
- [ ] Step 4: Implement separate helpers for add-account mode vs relogin mode, keeping the username editable only for user-initiated add-account and read-only for auto-open relogin.
- [ ] Step 5: Re-run `node .\node_sidecar\tests\account-relogin-modal.test.js` and confirm relogin-mode assertions pass.

### Task 6: Drive relogin UX from refresh failures and show `登录失效`

**Files:**
- Modify: `node_sidecar/ui/app.js`
- Test: `node_sidecar/tests/account-relogin-modal.test.js`

- [ ] Step 1: Extend `node_sidecar/tests/account-relogin-modal.test.js` with failing cases proving `doRefresh()` reacts to `login_key_missing` by opening relogin mode, reacts to `login_key_invalid` by switching badges to `登录失效`, and retries refresh automatically after successful relogin.
- [ ] Step 2: Run `node .\node_sidecar\tests\account-relogin-modal.test.js` and confirm the current UI neither opens relogin mode nor preserves locked-account state.
- [ ] Step 3: Teach `doRefresh()` to read `err.data.reason`, open the relogin modal instead of showing only a generic error, keep pending refresh context for auto-retry, and reuse the locally stored password when present while keeping the username locked.
- [ ] Step 4: Update top status text, account-card badges, snapshot hydration, and `inventory_refresh_failed` SSE handling so `未连接` remains the neutral disconnected state and `登录失效` is reserved for invalid credentials.
- [ ] Step 5: Re-run `node .\node_sidecar\tests\account-relogin-modal.test.js` and confirm relogin retries, badge text, locked-username behavior, and guard-first focus all pass.

## Chunk 4: Verification

### Task 7: Run automated regression checks

**Files:**
- None

- [ ] Step 1: Run `node .\node_sidecar\tests\refresh-auth-route.test.js`.
- [ ] Step 2: Run `node .\node_sidecar\tests\account-relogin-modal.test.js`.
- [ ] Step 3: Run `node .\node_sidecar\tests\account-binding-policy.test.js`.
- [ ] Step 4: Run `node .\node_sidecar\tests\manual-connect-progress-overlay.test.js`.
- [ ] Step 5: Confirm each script prints its `... tests passed` sentinel and leave the worktree uncommitted for real runtime validation.

### Task 8: Verify the real desktop flow in the main workspace

**Files:**
- None

- [ ] Step 1: Launch `node .\main_ui_node_desktop.js` from the repo root so the app uses the same local account database, token store, and UI state as the user's real environment.
- [ ] Step 2: Verify an account with a valid saved `loginKey` still refreshes directly without opening the modal.
- [ ] Step 3: Remove or rename the target account's `login_keys.json` entry, trigger refresh, and confirm relogin opens with locked username, empty `guard`, and editable password only when no local password exists.
- [ ] Step 4: Simulate an invalid key or invalid password path and confirm the badge reads `登录失效`, the username remains locked, the focus lands on `令牌码`, and invalid-password responses keep the modal open.
- [ ] Step 5: Confirm successful relogin saves the new key, clears `登录失效`, retries refresh automatically, and do not commit unless the user explicitly asks.
