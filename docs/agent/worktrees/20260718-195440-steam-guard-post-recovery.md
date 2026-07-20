---
status: archived
target: Automatically recover an expired existing account immediately after Steam Guard is added, and request editable password re-entry only through an extensible credential-state contract.
handoff_id: 20260718-195440-steam-guard-post-recovery
parent_handoff_id: 20260718-185012-steam-login-recovery-ui
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
allowed_paths:
  - node_sidecar/src/tokenRecoveryService.js
  - node_sidecar/src/uiServer.js
  - node_sidecar/ui/app.js
  - node_sidecar/tests/account-relogin-modal.test.js
  - node_sidecar/tests/steam-guard-token-route.test.js
  - node_sidecar/tests/steam-guard-ui-contract.test.js
  - node_sidecar/tests/token-recovery-service.test.js
  - docs/project-cognition-map.md
  - docs/agent/worktrees/20260718-195440-steam-guard-post-recovery.md
forbidden_paths:
  - C:/Users/18220/Desktop/cs2_alchemy/**
  - node_sidecar/src/steamGuardCoexistProcessAdapter.js
  - node_sidecar/src/steamGuardCoexistService.js
  - node_sidecar/src/steamGuardCoexistWorker.js
  - node_sidecar/src/steamGuardCoexistWorkerCore.js
  - node_sidecar/src/steamGuardImportService.js
  - node_sidecar/src/steamGuardSteamAdapter.js
  - node_sidecar/src/steamGuardTokenService.js
  - node_sidecar/tests/steam-guard-batch-import-route.test.js
  - node_sidecar/tests/steam-guard-batch-import-ui.test.js
  - node_sidecar/tests/steam-guard-coexist-process-adapter.test.js
  - node_sidecar/tests/steam-guard-coexist-route.test.js
  - node_sidecar/tests/steam-guard-coexist-service.test.js
  - node_sidecar/tests/steam-guard-coexist-worker.test.js
  - csgo_skins.db
  - inventory_ui_state.json
  - accounts.json
  - login_keys.json
  - client_config.json
  - package.json
  - node_sidecar/package.json
  - node_sidecar/package-lock.json
updated_at: 2026-07-18T20:27:24+08:00
last_verified: PASS 115 node_sidecar tests in 54.4s, plus 12-file targeted auth/Guard/import regression PASS. Runtime PID 42764 listens on 127.0.0.1:8799 and serves the worktree app.js. The scoped recovery route returns guard_missing before recovery for a real local account without maFile. Real post-binding success and password-reentry states remain unverified because current runtime accounts have no maFile. Reloading the real page also triggered the pre-existing profile hydration path, which attempted Steam login for countSteam5 and received AccessDenied code 15; this was not initiated by the new recovery route.
---

# Steam Guard Post-Binding Recovery

The persisted maFile remains the Guard truth, TokenStore remains the refresh-token truth, and UiStateStore remains the authentication-status projection. Only the unified token recovery service may generate the Guard code and replace the refresh token. The coexist worker protocol and batch import behavior are out of scope.

After Guard persistence succeeds, the frontend may call a scoped recovery API only for an existing account whose persisted UI state was auth_invalid. Successful recovery clears that state. A structured credential_state=password_reentry_required response opens the editable password form; unknown Steam result codes remain unclassified until evidence is available through the injected classifier boundary.
