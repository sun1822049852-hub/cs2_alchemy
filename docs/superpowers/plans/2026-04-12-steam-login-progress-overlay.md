# Steam 登录阶段进度条复用 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse the existing centered connect overlay for Steam `添加账号 / 重登`, show immediate stage text while `loginAndSave()` runs, finish the login overlay before background inventory refresh starts, and keep the shared overlay safe from conflicting writers.

**Architecture:** Keep the current `craftExecutionOverlay` DOM/CSS and the existing `connecting` render mode instead of inventing a new login modal. Add an owner-aware overlay controller inside `node_sidecar/ui/app.js` so login, manual refresh, auto-connect, and craft-progress writers all go through the same arbitration layer; then restructure `loginAndSave()` into staged login work plus a post-close background refresh path that suppresses auto-reopening relogin on the first post-login refresh.

**Tech Stack:** Vanilla browser JS in `node_sidecar/ui/app.js`, existing HTML/CSS overlay, plain Node VM tests in `node_sidecar/tests/*.test.js`, PowerShell runtime verification in the main workspace.

---

## File Map

- Modify: `node_sidecar/ui/app.js`
  Responsibility: add owner-aware shared overlay control, route existing connect/craft overlay writers through it, stage `loginAndSave()` progress, disable modal close actions during login, and trigger a post-close refresh that does not auto-open relogin immediately.
- Modify: `node_sidecar/tests/account-relogin-modal.test.js`
  Responsibility: cover staged login overlay behavior, locked relogin behavior, disabled cancel/close during login, and suppressed auto-relogin on the first post-login refresh.
- Modify: `node_sidecar/tests/manual-connect-progress-overlay.test.js`
  Responsibility: keep manual refresh wired to the shared overlay controller and confirm the connect path still uses `connecting` mode and overlay cleanup correctly.
- Modify: `node_sidecar/tests/craft-auto-connect-execution.test.js`
  Responsibility: keep the direct craft auto-connect reporter path working after overlay ownership is centralized.
- Modify: `node_sidecar/tests/craft-component-progress-overlay.test.js`
  Responsibility: verify the centered overlay state machine still supports `connecting` and `component_prepare`, and add owner/arbitration assertions at the lowest shared overlay layer.

## Execution Notes

- Follow `@superpowers:test-driven-development` inside every task: add or extend the failing assertion first, then write the smallest change that makes it pass.
- Use `@local:ui-runtime-guardrails` for the final desktop verification because this task changes real UI timing and feedback, not just pure logic.
- Use `@superpowers:verification-before-completion` before claiming implementation is done.
- Stay in the main workspace per this repository's workflow; do not create a worktree for this task.
- Do not commit unless the user explicitly asks for a commit.

## Chunk 1: Shared Overlay Ownership

### Task 1: Add failing regression coverage for the shared connect overlay entry points

**Files:**
- Modify: `node_sidecar/tests/manual-connect-progress-overlay.test.js`
- Modify: `node_sidecar/tests/craft-auto-connect-execution.test.js`
- Test: `node_sidecar/tests/manual-connect-progress-overlay.test.js`
- Test: `node_sidecar/tests/craft-auto-connect-execution.test.js`

- [ ] Step 1: Extend `node_sidecar/tests/manual-connect-progress-overlay.test.js` so the disconnected refresh path must still produce a progress callback that drives `mode: "connecting"` and clears through the shared overlay shutdown path.
- [ ] Step 2: Extend `node_sidecar/tests/craft-auto-connect-execution.test.js` so `ensureCraftConnectedForExecution()` still drives the same shared overlay path instead of bypassing the future owner-aware controller.
- [ ] Step 3: Run `node .\node_sidecar\tests\manual-connect-progress-overlay.test.js`.
- [ ] Step 4: Run `node .\node_sidecar\tests\craft-auto-connect-execution.test.js`.
- [ ] Step 5: Confirm both scripts stay green so the later ownership refactor has a regression safety net for the already-working connect paths.

### Task 2: Add failing coverage for low-level overlay arbitration

**Files:**
- Modify: `node_sidecar/tests/craft-component-progress-overlay.test.js`
- Test: `node_sidecar/tests/craft-component-progress-overlay.test.js`

- [ ] Step 1: Extend `node_sidecar/tests/craft-component-progress-overlay.test.js` with owner-aware expectations at the shared overlay layer, including `connecting` title rendering and the rule that a non-owner write/clear cannot clobber an active owner.
- [ ] Step 2: Run `node .\node_sidecar\tests\craft-component-progress-overlay.test.js`.
- [ ] Step 3: Confirm the new owner/arbitration assertions fail against the current direct-state implementation.

### Task 3: Implement the owner-aware overlay controller in `app.js`

**Files:**
- Modify: `node_sidecar/ui/app.js`
- Test: `node_sidecar/tests/manual-connect-progress-overlay.test.js`
- Test: `node_sidecar/tests/craft-auto-connect-execution.test.js`
- Test: `node_sidecar/tests/craft-component-progress-overlay.test.js`

- [ ] Step 1: Add a single owner-aware overlay controller in `node_sidecar/ui/app.js` that governs all state affecting overlay rendering, including `state.craftProgressEnabled`, visible/mode/title/detail/percent writes, and clear behavior.
- [ ] Step 2: Refactor `createConnectProgressReporter()` and `refreshWithConnectionOverlay()` to use that controller without changing the visible `connecting`-mode behavior.
- [ ] Step 3: Route direct craft-progress writers through the same owner-aware path, including `applyCraftComponentProgressEvent(...)`, craft auto-connect, craft pause messaging, and craft execution setup/cleanup.
- [ ] Step 4: Keep `component_prepare` behavior intact so the centered overlay stays hidden for prepare-only progress while the state fields still update for downstream consumers.
- [ ] Step 5: Run `node .\node_sidecar\tests\manual-connect-progress-overlay.test.js`.
- [ ] Step 6: Run `node .\node_sidecar\tests\craft-auto-connect-execution.test.js`.
- [ ] Step 7: Run `node .\node_sidecar\tests\craft-component-progress-overlay.test.js`.
- [ ] Step 8: Confirm all three overlay regression scripts pass before touching login flow.

## Chunk 2: Login Progress Flow

### Task 4: Add failing coverage for staged login overlay behavior

**Files:**
- Modify: `node_sidecar/tests/account-relogin-modal.test.js`
- Test: `node_sidecar/tests/account-relogin-modal.test.js`

- [ ] Step 1: Extend `node_sidecar/tests/account-relogin-modal.test.js` with a `loginAndSave()` harness that asserts the login overlay becomes visible before the first awaited login request, and that the stage text is asserted against overlay `title`, not hidden `detail`.
- [ ] Step 2: Add assertions that validation failures such as missing `令牌码` never open the overlay and still report the form error in the existing modal state.
- [ ] Step 3: Add assertions that both `添加账号` and `重登` still enter the same `loginAndSave()` flow, while `loginSaveBtn`, `clearAccountBtn`, and the modal close handler all become inert during an active login request.
- [ ] Step 4: Add assertions that if another overlay owner is already active, login does not start `/api/accounts/login-save`, keeps the modal open, and reports the “当前有任务进行中，请稍后再试” style status in the login form.
- [ ] Step 5: Add assertions that login success closes the overlay and modal before the post-login refresh starts, while login failure closes the overlay and leaves the modal state intact.
- [ ] Step 6: Add a case where the first post-login background refresh returns `reloginRequired` / `login_key_invalid` and assert the UI updates summary/auth state without auto-opening a second relogin modal in the same cycle.
- [ ] Step 7: Run `node .\node_sidecar\tests\account-relogin-modal.test.js`.
- [ ] Step 8: Confirm the new staged-login assertions fail against the current synchronous `loginAndSave()` implementation.

### Task 5: Implement staged login progress and post-close refresh

**Files:**
- Modify: `node_sidecar/ui/app.js`
- Test: `node_sidecar/tests/account-relogin-modal.test.js`

- [ ] Step 1: Introduce explicit login-busy state in `node_sidecar/ui/app.js` so submit/cancel/close controls can be disabled or ignored while login is active.
- [ ] Step 2: Rework `loginAndSave()` so it performs only local validation first, aborts early if overlay ownership cannot be acquired, then opens a login-owned `connecting` overlay session, updates overlay `title` at the `25 -> 60 -> 90 -> 100` checkpoints, and ends that session before closing the modal.
- [ ] Step 3: Keep `添加账号` and `重登` sharing the same `loginAndSave()` execution path while preserving their existing field-locking differences outside the shared submit logic.
- [ ] Step 4: Move the inventory refresh out of the blocking login path so it runs after overlay teardown and modal close, while keeping account list reload and `switchAccountView(...)` inside the login-owned stage flow.
- [ ] Step 5: Add a targeted option or call-site path for the first post-login refresh so `doRefresh()` can update auth state / summary without auto-opening relogin when that one background refresh fails immediately.
- [ ] Step 6: Keep existing relogin constraints untouched: relogin usernames stay locked, auto-open relogin still focuses `guard`, and failed login submissions do not invent a new focus mode.
- [ ] Step 7: Run `node .\node_sidecar\tests\account-relogin-modal.test.js`.
- [ ] Step 8: Confirm the staged login overlay script passes before running the broader regression batch.

## Chunk 3: End-to-End Verification

### Task 6: Run the automated UI regression batch

**Files:**
- None

- [ ] Step 1: Run `node .\node_sidecar\tests\account-relogin-modal.test.js`.
- [ ] Step 2: Run `node .\node_sidecar\tests\manual-connect-progress-overlay.test.js`.
- [ ] Step 3: Run `node .\node_sidecar\tests\craft-auto-connect-execution.test.js`.
- [ ] Step 4: Run `node .\node_sidecar\tests\craft-component-progress-overlay.test.js`.
- [ ] Step 5: Confirm each script prints its `... tests passed` sentinel with no new failures.

### Task 7: Verify the real desktop flow in the main workspace

**Files:**
- None

- [ ] Step 1: Launch `node .\main_ui_node_desktop.js` from `C:\Users\18220\Desktop\cs2_alchemy`.
- [ ] Step 2: In `添加账号`, submit without `令牌码` and verify the form reports the validation error without ever showing the centered progress overlay.
- [ ] Step 3: In `添加账号`, submit valid credentials and verify the centered progress overlay appears immediately, advances the stage text in the overlay title, and closes the modal before inventory refresh finishes.
- [ ] Step 4: In an auto-open `重新登录` flow, verify the username remains locked, focus lands on `令牌码`, the same progress overlay appears on submit, and the cancel/close controls are inert while login is in flight.
- [ ] Step 5: Force a relogin submission failure and verify the modal stays open with the locked username preserved.
- [ ] Step 6: Force the first post-login refresh to fail with a relogin-required response and verify the UI updates summary/auth state without immediately opening a second relogin modal.
- [ ] Step 7: Re-run a normal manual refresh and a craft auto-connect path to confirm the shared overlay still behaves like the preexisting connect flow.
