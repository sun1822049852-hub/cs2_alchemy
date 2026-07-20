---
status: archived
target: Complete existing-account login recovery: clear only the persisted password after structured password rejection, hide the verification-code field until Steam requests it, and submit a local maFile code inside the backend without exposing it to the frontend.
handoff_id: 20260718-203253-steam-access-denied-expiry
parent_handoff_id: 20260718-195440-steam-guard-post-recovery
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
allowed_paths:
  - node_sidecar/src/tokenRecoveryService.js
  - node_sidecar/src/uiServer.js
  - node_sidecar/src/accountStore.js
  - node_sidecar/src/appAuthStore.js
  - node_sidecar/ui/app.js
  - node_sidecar/ui/index.html
  - node_sidecar/tests/token-recovery-service.test.js
  - node_sidecar/tests/account-relogin-modal.test.js
  - node_sidecar/tests/account-scope-route.test.js
  - node_sidecar/tests/refresh-auth-route.test.js
  - node_sidecar/tests/steam-guard-token-route.test.js
  - node_sidecar/tests/steam-guard-ui-contract.test.js
  - node_sidecar/tests/account-store-sqlite.test.js
  - node_sidecar/tests/app-auth-store.test.js
  - docs/project-cognition-map.md
  - docs/agent/worktrees/20260718-195229-steam-guard-coexist-diagnostics.md
  - docs/agent/worktrees/20260718-195440-steam-guard-post-recovery.md
  - docs/agent/worktrees/20260718-203253-steam-access-denied-expiry.md
forbidden_paths:
  - C:/Users/18220/Desktop/cs2_alchemy/**
  - node_sidecar/src/authService.js
  - node_sidecar/src/steamGuardCoexistProcessAdapter.js
  - node_sidecar/src/steamGuardCoexistService.js
  - node_sidecar/src/steamGuardCoexistWorker.js
  - node_sidecar/src/steamGuardCoexistWorkerCore.js
  - node_sidecar/src/steamGuardImportService.js
  - node_sidecar/src/steamGuardSteamAdapter.js
  - node_sidecar/src/steamGuardTokenService.js
  - node_sidecar/src/refreshWorkflow.js
  - node_sidecar/src/services/sessionPool.js
  - node_sidecar/src/services/refreshRuntime.js
  - csgo_skins.db
  - inventory_ui_state.json
  - accounts.json
  - login_keys.json
  - client_config.json
  - package.json
  - node_sidecar/package.json
  - node_sidecar/package-lock.json
updated_at: 2026-07-18T21:08:00+08:00
last_verified: RED/GREEN complete, including the direct existing-account InvalidPassword path. Targeted persistence/recovery/login/UI tests pass; full `npm test` passes 115 node_sidecar tests in 58.5s. PID 39932 serves the worktree on 127.0.0.1:8799 and health/static runtime checks confirm the latest password-clear and backend-Guard code. Real browser runtime confirms the initial login modal shows account/password only, `#accountGuardField` is hidden with display:none and 0x0 bounds, and the page has no console errors. A real password+maFile Steam login remains for user E2E because automated verification did not submit credentials to Steam.
---

# Existing Account EResult 15 Recovery

Steam raw `EResult.AccessDenied (15)` remains the external diagnostic fact. For an existing local account it projects to the business state `login_key_invalid/auth_invalid`; a new account keeps `access_denied`. TokenRecoveryService remains the single recovery owner. It chooses automatic credentials plus local Guard when maFile exists and structured manual relogin when it does not. Stale token/session state must be invalidated before the one allowed credential recovery attempt; no recursive recovery is permitted.

The persisted password remains owned by AppAuthStore. A structured `password_reentry_required` result clears only that field before the UI is told to prompt. The normal login route verifies the submitted password first; if Steam then requests a device code and the scoped account has a local maFile, the backend generates and submits the code without returning it to the page. Accounts without maFile retain the manual email/device-code phase.
