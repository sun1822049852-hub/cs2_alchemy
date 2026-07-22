---
status: archived
target: Make EResult 15 irreversibly invalidate the old token/session, use exactly one password-plus-local-Guard recovery attempt when maFile exists, and otherwise require manual login without reusing stale authentication data.
handoff_id: 20260718-222538-steam-access-denied-latched-fallback
parent_handoff_id: 20260718-211833-steam-access-denied-e2e
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
allowed_paths:
  - node_sidecar/src/tokenRecoveryService.js
  - node_sidecar/src/uiServer.js
  - node_sidecar/src/refreshWorkflow.js
  - node_sidecar/ui/app.js
  - node_sidecar/tests/token-recovery-service.test.js
  - node_sidecar/tests/account-relogin-modal.test.js
  - node_sidecar/tests/refresh-workflow-token-recovery.test.js
  - node_sidecar/tests/refresh-auth-route.test.js
  - node_sidecar/tests/steam-guard-token-route.test.js
  - docs/project-cognition-map.md
  - docs/agent/worktrees/20260718-211833-steam-access-denied-e2e.md
  - docs/agent/worktrees/20260718-222538-steam-access-denied-latched-fallback.md
forbidden_paths:
  - C:/Users/18220/Desktop/cs2_alchemy/**
  - node_sidecar/src/authService.js
  - node_sidecar/src/accountStore.js
  - node_sidecar/src/appAuthStore.js
  - node_sidecar/src/steamGuardCoexistProcessAdapter.js
  - node_sidecar/src/steamGuardCoexistService.js
  - node_sidecar/src/steamGuardCoexistWorker.js
  - node_sidecar/src/steamGuardCoexistWorkerCore.js
  - node_sidecar/src/steamGuardImportService.js
  - node_sidecar/src/steamGuardSteamAdapter.js
  - node_sidecar/src/steamGuardTokenService.js
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
updated_at: 2026-07-18T22:55:16+08:00
last_verified: User E2E exposed the real Steam error envelope `steam error: AccessDenied code=15`. It bypassed refreshWorkflow classification, so auth_invalid was not persisted and the manual relogin modal did not open. Superseded by 20260718-225516-steam-access-denied-message-envelope.
---

# Latched EResult 15 Fallback

The old refresh token and runtime session become invalid immediately when an operation returns EResult 15. TokenRecoveryService remains the only recovery owner. Accounts with a complete local maFile may perform exactly one saved-password plus generated-Guard login; accounts without maFile must go directly to editable manual login. If the one automatic credential login also returns EResult 15, its persisted password is cleared before the UI is instructed to prompt, so later clicks cannot reuse the same rejected credential. Account, maFile and profile data remain unchanged.
