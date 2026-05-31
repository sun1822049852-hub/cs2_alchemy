# 2026-05-29 project audit fix handoff

## Current Goal

- Goal: hand off the project-level audit findings so the next session can use multiple subagents to fix the remaining issues.
- Scope: current root worktree only: `C:/Users/18220/Desktop/cs2_alchemy`.
- Not reviewed: sibling/child worktrees:
  - `C:/Users/18220/.config/superpowers/worktrees/cs2_alchemy/feature-skin-db-sync`
  - `C:/Users/18220/Desktop/cs2_alchemy/.worktrees/craft-outcome-predictor`
  - `C:/Users/18220/Desktop/cs2_alchemy/.worktrees/skin-price-columns`
- This handoff is read-only review output. No business code was changed in this session.

## 2026-05-30 Execution Status

- This handoff has now been executed in the current root worktree. The original checklist below is kept as the audit source, not as the current todo truth.
- Completed and verified in focused tests:
  - P1.M1 Remote Auth Transport.
  - P1.M2 Local Steam Account Scope.
  - P1.M3 Component Operation Permissions.
  - P1.M4 Admin Email Code Hardening.
  - P1.M5 Admin Console HTML Injection Risk.
  - P2.M1 Batch Craft Component Source Handling.
  - P2.M2 Batch Craft Cooling Switch.
  - P2.M3 64-bit Asset ID Safety.
  - P3.M1 maFile Parse Fallback.
  - P3.M2 Windows System Proxy Fallback.
  - P3.M3 JSON Store Corruption Safety.
  - P3.M4 Raw Fetch Auth/Error Handling.
  - P3.M5 Frontend Permission State, including the later batch craft button gap found by review.
  - P3.M6 Admin Device Revoke UX.
  - P4.M2 Packaging Resource Contract.
- Partially completed / intentionally not closed:
  - P4.M1 Dependency Audit: `admin_console` audit is clean after `nodemailer` upgrade; `node_sidecar` audit still has known remaining vulnerabilities and no broad major upgrade was attempted.
  - P4.M3 Test Entrypoints: `node_sidecar` now has test scripts and packaging preflight, and `admin_console npm test` was expanded; full `node_sidecar npm test` must not be treated as green yet because unrelated/historical failures remain.
  - P4.M4 Repo Hygiene / Release Artifacts: packaging key resources were narrowed and no runtime/output files were deleted; decisions about tracked `dist/`, `backup/`, and `output/playwright/` remain separate repo-hygiene work.
- See `docs/agent/session-log.md` section `2026-05-30 project audit repair implementation` for exact tests run, worker review notes, and remaining risks.

## Important Product Decision

- Audit issue 3, "`/api/accounts` returns Steam password and `mafile_content`", is **not** in the next repair list.
- User clarified this is intentional for the current product shape: a single-user local program.
- Treat it as an accepted single-user design boundary, not a bug, as long as:
  - the app remains local single-user;
  - the local API is not exposed to LAN/public network;
  - Electron/front-end does not load untrusted remote pages;
  - the product does not become multi-user/shared/commercial without revisiting this.
- Do not remove password/maFile fields from the account list in the next repair pass unless the user explicitly changes this product boundary.

## Must Not Change

- Do not create a git worktree unless the user explicitly asks. Project default is the main workspace.
- Do not commit unless the user explicitly asks.
- Do not clean, delete, or revert runtime/output files such as `output/`, `backup/`, `inventory_ui_state.json`, or local DB files.
- Do not trigger real Steam actions, real craft execution, real market listing, real trade, or real account login while fixing.
- Do not broaden the product into multi-user architecture while fixing this list.
- Do not remove current single-user account-management behavior unless it directly conflicts with a listed repair item.
- Keep hardware/runtime target unchanged.

## Current Workspace State

- Branch inspected: `main` in `C:/Users/18220/Desktop/cs2_alchemy`.
- `git status --short` at handoff time showed only:
  - `?? output/c5-wear-dry-run/`
- The untracked output directory was not reviewed as product code and was not modified.

## Review Evidence Summary

- Five review subagents were run with `gpt-5.5` and `xhigh`, then closed after completion.
- Review lanes:
  - auth/security/license/admin control plane
  - Electron/Node client reliability
  - craft/inventory/data correctness
  - UI/UX authorization behavior
  - tests/release/config/dependencies
- Main agent spot-checked the high-risk evidence in source before writing this handoff.
- No full Electron run, no real Steam run, no full package build.

## Repair Checklist

### P1.M1 - Remote Auth Transport

- [ ] P1.M1.T1.S1 Change release/default remote control-plane config away from plain HTTP.
  - Evidence: `node_sidecar/build/client_config.release.json` uses `http://8.138.39.139`.
  - Evidence: `README.md` documents the same HTTP default.
  - Expected fix: formal remote/default release mode should use HTTPS, or fail closed for non-loopback HTTP.
  - Preserve: local dev loopback / SSH tunnel flows.
- [ ] P1.M1.T1.S2 Add tests for remote base URL validation.
  - Cover HTTPS allowed.
  - Cover loopback HTTP allowed if intended.
  - Cover public HTTP rejected in prod/release mode.
- [ ] P1.M1.T1.S3 Update README/config docs to match the new rule.

### P1.M2 - Local Steam Account Scope

- [ ] P1.M2.T1.S1 Remove the effective always-allow account scope behavior.
  - Evidence: `node_sidecar/src/uiServer.js` has `canAccessSteamAccount() { return true; }`.
  - Evidence: `accountViewerUsername` is currently set to empty string in request auth state.
  - Expected fix: bind current license/app user to the account viewer identity used by `AccountStore`.
- [ ] P1.M2.T1.S2 Make `requireSteamAccountAccess(...)` meaningful for account read/write, inventory, trade, market, component and craft paths that accept `username`.
- [ ] P1.M2.T1.S3 Add tests:
  - bound user can access bound Steam account;
  - unbound user gets `403 account_scope_denied`;
  - super/admin/dev single-user case still works as intended.
- [ ] P1.M2.T1.S4 Confirm this does not break current single-user local mode.

### P1.M3 - Component Operation Permissions

- [ ] P1.M3.T1.S1 Add explicit permission checks to component deposit/withdraw/task endpoints.
  - Evidence paths:
    - `node_sidecar/src/uiServer.js` `/api/component/deposit`
    - `/api/component/deposit-candidates`
    - `/api/component/withdraw`
    - `/api/component/tasks`
    - `/api/component/tasks/cancel`
  - Expected fix: use the correct existing permission, or introduce a narrow permission only if necessary.
- [ ] P1.M3.T1.S2 Add account-scope checks for `username` and task ownership.
- [ ] P1.M3.T1.S3 Add focused tests for low-permission users and wrong-account users.

### P1.M4 - Admin Email Code Hardening

- [ ] P1.M4.T1.S1 Replace `Math.random()` code generation with `crypto.randomInt()`.
  - Evidence: `admin_console/src/server.js` `createCodeGenerator()`.
- [ ] P1.M4.T1.S2 Whitelist email-code scenes.
  - Evidence: `/api/auth/email/send-code` accepts client-provided `scene`.
- [ ] P1.M4.T1.S3 Add failed-attempt throttling or lockout.
  - Failed verification should not allow unlimited guesses of the same active code.
- [ ] P1.M4.T1.S4 Add tests for:
  - invalid scene rejected;
  - repeated wrong code attempts lock or consume according to chosen design;
  - successful register/reset still works.

### P1.M5 - Admin Console HTML Injection Risk

- [ ] P1.M5.T1.S1 Stop rendering external/admin-database fields through raw `innerHTML`.
  - Evidence: `admin_console/ui/app.js` renders `steam_account_name` via template HTML.
  - Expected fix: prefer DOM creation with `textContent`, or a shared escaping helper if templates remain.
- [ ] P1.M5.T1.S2 Cover binding list, user list, device list, permission chips, and other dynamic fields that are not guaranteed constants.
- [ ] P1.M5.T1.S3 Add regression tests with names containing `<`, `"`, and script-like text.

### P2.M1 - Batch Craft Component Source Handling

- [ ] P2.M1.T1.S1 Preserve item source metadata from batch craft selection to execution.
  - Evidence: batch selection sends `use_component_items: !!state.batchCraftUseComponentItems`.
  - Evidence: batch execution sends `use_component_items: false` and `item_sources: {}`.
  - Expected fix: if batch-selected materials include component items, execution should use the same prepare/execute component flow as single-account craft.
- [ ] P2.M1.T1.S2 Add tests proving component sources are not lost between batch select and batch execute.
- [ ] P2.M1.T1.S3 Do not trigger real craft execution in tests.

### P2.M2 - Batch Craft Cooling Switch

- [ ] P2.M2.T1.S1 Use `state.batchCraftIncludeCooling` for batch execution.
  - Evidence: selection uses `state.batchCraftIncludeCooling`.
  - Evidence: execution currently uses `state.craftIncludeCooling`.
- [ ] P2.M2.T1.S2 Add payload-level regression tests.

### P2.M3 - 64-bit Asset ID Safety

- [ ] P2.M3.T1.S1 Stop converting inventory `asset_id` / Steam item IDs to JS `Number`.
  - Evidence: `node_sidecar/src/inventoryParser.js` stores `asset_id: toInt(item.id, 0)`.
  - Evidence: `toInt()` uses `Number(value)`.
  - Expected fix: store and compare these IDs as strings. Use `BigInt` only where numeric ordering is truly required.
- [ ] P2.M3.T1.S2 Audit direct comparisons and map keys that expect numeric asset IDs.
- [ ] P2.M3.T1.S3 Add regression tests with an ID greater than `Number.MAX_SAFE_INTEGER`.
- [ ] P2.M3.T1.S4 Verify component/craft/market selection still finds the intended item.

### P3.M1 - maFile Parse Fallback

- [ ] P3.M1.T1.S1 Keep refresh-token fallback alive when `mafile_content` is malformed or incomplete.
  - Evidence: `resolveWebSessionForAccount()` calls `parseMaFile(account.mafile_content)` before the try/catch around maFile refresh.
  - Expected fix: parse failure should be logged in a sanitized way, then fallback should try `TokenStore` refresh token if available.
- [ ] P3.M1.T1.S2 Add tests for:
  - malformed maFile JSON;
  - maFile missing `shared_secret`;
  - valid token fallback succeeds.

### P3.M2 - Windows System Proxy Fallback

- [ ] P3.M2.T1.S1 Add Windows system proxy fallback after explicit config/env proxy.
  - Evidence: `node_sidecar/src/proxyConfig.js` reads `config.py` and env vars only.
  - Relevant memory: this machine has historically used Windows Internet Settings proxy `127.0.0.1:15732`.
  - Expected priority: explicit config/env > Windows system proxy > direct.
- [ ] P3.M2.T1.S2 Sanitize proxy logging so credentials are not printed.
- [ ] P3.M2.T1.S3 Add tests for source priority and credential redaction.

### P3.M3 - JSON Store Corruption Safety

- [ ] P3.M3.T1.S1 Distinguish file-not-found from corrupt JSON.
  - Evidence: `node_sidecar/src/jsonStore.js` catches all errors and returns fallback.
- [ ] P3.M3.T1.S2 Avoid overwriting corrupt important stores with empty fallback data.
  - Suggested approach: quarantine/backup corrupt file, or fail loudly for sensitive stores.
- [ ] P3.M3.T1.S3 Use safer writes for important JSON state.
  - Suggested approach: temp file + flush + rename where practical.
- [ ] P3.M3.T1.S4 Add tests for corrupt `login_keys.json` / UI state style files.

### P3.M4 - Raw Fetch Auth/Error Handling

- [ ] P3.M4.T1.S1 Wrap market/trade/Web Inventory raw `fetch()` calls with shared auth-aware handling.
  - Evidence examples:
    - `node_sidecar/ui/app.js` `/api/market/batch-sell`
    - `/api/accounts/send-trade-offer`
    - market confirmation calls
  - Expected fix: check `response.ok` and content type before reading streams; 401 should trigger login/license recovery; 403 should show permission denial.
- [ ] P3.M4.T1.S2 Do not break SSE/progress streaming.
- [ ] P3.M4.T1.S3 Add UI unit tests for 401/403 JSON responses on stream-like operations.

### P3.M5 - Frontend Permission State

- [ ] P3.M5.T1.S1 Add a small client permission helper based on `state.clientAuth.permissions`.
- [ ] P3.M5.T1.S2 Disable or explain restricted feature entries/buttons before users hit backend `403`.
  - Evidence: front-end currently mostly distinguishes guest vs logged-in, while backend gates `craft.use`, `simulation.use`, `inventory.refresh`, `accounts.write`.
- [ ] P3.M5.T1.S3 Keep backend permission gates authoritative.
- [ ] P3.M5.T1.S4 Add tests for expired/no-permission UI states.

### P3.M6 - Admin Device Revoke UX

- [ ] P3.M6.T1.S1 Add confirmation before admin device revoke.
- [ ] P3.M6.T1.S2 Show clear success/failure state and disable the button while the request is running.
- [ ] P3.M6.T1.S3 Add a small UI test.

### P4.M1 - Dependency Audit

- [ ] P4.M1.T1.S1 Run `npm audit --registry=https://registry.npmjs.org --json` in `node_sidecar`.
  - Prior review result: exit 1, 22 vulnerabilities, 3 critical, 11 high.
- [ ] P4.M1.T1.S2 Run the same in `admin_console`.
  - Prior review result: exit 1, 1 high for `nodemailer`.
- [ ] P4.M1.T1.S3 Upgrade/replace dependencies with focused verification.
  - Known candidates: `request`, `electron`, `steam-user`/`protobufjs` chain, `nodemailer`.
- [ ] P4.M1.T1.S4 Do not blindly run major upgrades without checking Steam/auth behavior.

### P4.M2 - Packaging Resource Contract

- [ ] P4.M2.T1.S1 Fix `schema_cache.json` packaging source.
  - Evidence: `node_sidecar/electron-builder.yml` includes `../schema_cache.json`.
  - Evidence: `.gitignore` ignores root `schema_cache.json`, and it is not tracked.
  - Expected fix: version a stable seed resource or generate/check it before packaging.
- [ ] P4.M2.T1.S2 Add a packaging preflight test/check so clean clones fail early with a useful message.
- [ ] P4.M2.T1.S3 Preserve existing seeded DB rule: packaged DB should come from `node_sidecar/build/csgo_skins.seed.db`, not root runtime DB.

### P4.M3 - Test Entrypoints

- [ ] P4.M3.T1.S1 Add a meaningful `npm test` for `node_sidecar`.
  - Prior review: there are many test files but no package `test` script.
- [ ] P4.M3.T1.S2 Expand `admin_console npm test` to include currently omitted tests.
- [ ] P4.M3.T1.S3 Decide whether long/real-network tests are excluded by default and document that.
- [ ] P4.M3.T1.S4 Investigate `node_sidecar/tests/craft-permission-gate.test.js`.
  - UI review reported it failing with `400 !== 200` at line 317.

### P4.M4 - Repo Hygiene / Release Artifacts

- [ ] P4.M4.T1.S1 Decide whether `node_sidecar/dist/` should remain tracked.
  - Prior review found large build outputs tracked.
- [ ] P4.M4.T1.S2 Decide whether `backup/` and `output/playwright/` tracked files are fixtures or runtime outputs.
- [ ] P4.M4.T1.S3 Do not delete or untrack anything without user approval.
- [ ] P4.M4.T1.S4 Narrow `electron-builder.yml` `../keys` resource if possible.
  - Current review only saw public key evidence, but packaging an entire key directory is fragile.

## Suggested Multi-Agent Split

Use subagents in parallel, but avoid overlapping write sets. Every worker must be told: "You are not alone in the codebase; do not revert others' edits; keep your write scope; report exact files changed and tests run."

### Worker A - Release Transport

- Scope: P1.M1 only.
- Write scope:
  - `node_sidecar/build/client_config.release.json`
  - config loader / control-plane auth client tests as needed
  - README/config docs
- Do not touch account scope or admin console.

### Worker B - Account Scope + Component Permissions

- Scope: P1.M2 and P1.M3.
- Write scope:
  - `node_sidecar/src/uiServer.js`
  - `node_sidecar/src/accountStore.js`
  - `node_sidecar/src/appAuthStore.js` only if needed for viewer binding
  - related `node_sidecar/tests/*account*`, `*auth*`, `*component*`
- Do not remove password/maFile fields from `/api/accounts`.

### Worker C - Admin Console Security/UX

- Scope: P1.M4, P1.M5, P3.M6.
- Write scope:
  - `admin_console/src/server.js`
  - `admin_console/src/controlPlaneStore.js`
  - `admin_console/ui/app.js`
  - `admin_console/tests/*`
- Do not touch sidecar client code.

### Worker D - Craft + Inventory Correctness

- Scope: P2.M1, P2.M2, P2.M3.
- Write scope:
  - `node_sidecar/ui/app.js` batch craft areas only
  - `node_sidecar/src/inventoryParser.js`
  - `node_sidecar/src/utils.js` only if needed
  - craft/inventory tests
- Coordinate with Worker F if both need `node_sidecar/ui/app.js`.

### Worker E - Client Reliability

- Scope: P3.M1, P3.M2, P3.M3.
- Write scope:
  - `node_sidecar/src/uiServer.js` Web session fallback area only
  - `node_sidecar/src/maFileParser.js` if needed
  - `node_sidecar/src/jsonStore.js`
  - `node_sidecar/src/proxyConfig.js`
  - related tests
- Do not touch UI app code.

### Worker F - Client UI Auth/Permission Handling

- Scope: P3.M4 and P3.M5.
- Write scope:
  - `node_sidecar/ui/app.js`
  - `node_sidecar/ui/workspaceAccessGuard.js`
  - related UI tests
- Coordinate with Worker D because both may edit `node_sidecar/ui/app.js`.

### Worker G - Release/Test/Dependency Hygiene

- Scope: P4.M1, P4.M2, P4.M3, P4.M4.
- Write scope:
  - `node_sidecar/package.json`
  - `node_sidecar/package-lock.json`
  - `admin_console/package.json`
  - `admin_console/package-lock.json`
  - `node_sidecar/electron-builder.yml`
  - `.gitignore`
  - test runner scripts
- Do not remove tracked artifacts without user approval.

## Suggested Implementation Order

- First wave in parallel: Worker A, C, E, G.
- Second wave in parallel after merge/rebase check: Worker B, D, F.
- Reason: B/E can both touch `uiServer.js`; D/F can both touch `node_sidecar/ui/app.js`. Avoid avoidable conflicts.

## Verification Checklist

- Run focused tests from each worker.
- Then run a repo-level smoke set:
  - `cd node_sidecar; npm test` after Worker G creates it.
  - `cd admin_console; npm test`.
  - `cd node_sidecar; npm audit --registry=https://registry.npmjs.org --json`.
  - `cd admin_console; npm audit --registry=https://registry.npmjs.org --json`.
- For packaging contract:
  - run the new preflight/check command rather than full build first.
- For UI:
  - after source fixes, use real runtime/browser/Electron verification before claiming UI behavior is fixed.
- Do not claim full release readiness unless build/package and runtime smoke were actually run.

## Known Blind Spots

- No real Steam account was used in the audit.
- No real craft, trade, market, deposit, withdraw, or listing operation was run.
- No Electron/browser screenshot verification was done.
- No full build/package was run.
- Other worktrees were not reviewed.

## Next Session Start Instruction

```text
先读 docs/agent/project-audit-fix-handoff-2026-05-29.md、docs/agent/session-log.md 最新段落、docs/agent/memory.md、AGENTS.md，然后运行 git status --short --branch 和 git worktree list --porcelain。先复述：目标是按 2026-05-29 审查清单用多 agent 并行修复剩余问题；问题 3（/api/accounts 返回 password/mafile_content）已被用户确认为单用户本地设计接受项，不在本轮修复清单中。复述当前范围、必须不变项、第一波 worker 拆分和未验证范围。复述后停住，等待用户明确批准；如果用户同一条消息明确说“复述后直接继续实现”，再按 handoff 的 worker split 派多 agent。实现时不要审其它 worktree，不要提交，不要触发真实 Steam/炼金/交易/市场动作，不要清理 runtime/output 文件。每个 worker 返回后先复核证据，再合并，最后运行 focused tests 和 smoke checks。
```
