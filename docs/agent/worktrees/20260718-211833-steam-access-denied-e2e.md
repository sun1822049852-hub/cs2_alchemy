---
status: archived
target: Verify and finish the integrated existing-account EResult 15 recovery behavior after the parallel password-clear/backend-Guard implementation completed.
handoff_id: 20260718-211833-steam-access-denied-e2e
parent_handoff_id: 20260718-203253-steam-access-denied-expiry
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
  - docs/agent/worktrees/20260718-203253-steam-access-denied-expiry.md
  - docs/agent/worktrees/20260718-211833-steam-access-denied-e2e.md
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
updated_at: 2026-07-18T22:25:38+08:00
last_verified: User E2E found that repeated EResult 15 responses did not open manual relogin and later clicks could reuse stale saved credentials. Superseded by 20260718-222538-steam-access-denied-latched-fallback.
---

# EResult 15 Integrated Verification

Preserve the parent behavior: existing-account `EResult 15` is `login_key_invalid/auth_invalid`; maFile accounts use the unified backend automatic recovery and accounts without maFile remain on manual relogin. New-account `EResult 15` remains `access_denied`. Guard secrets and generated codes must not reach the frontend.
