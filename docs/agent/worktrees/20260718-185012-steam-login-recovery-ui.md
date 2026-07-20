---
status: archived
target: Expose saved Steam passwords to the authorized frontend, restore the editable prefilled manual Guard login flow for accounts without maFile, and restrict automatic token recovery to accounts with maFile while localizing login-expiry errors by login mode.
handoff_id: 20260718-185012-steam-login-recovery-ui
parent_handoff_id: 20260718-171039-steam-guard-coexist-live-fix
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
allowed_paths:
  - node_sidecar/src/appAuthStore.js
  - node_sidecar/src/accountStore.js
  - node_sidecar/src/authService.js
  - node_sidecar/src/cs2Session.js
  - node_sidecar/src/refreshWorkflow.js
  - node_sidecar/src/services/sessionPool.js
  - node_sidecar/src/services/refreshRuntime.js
  - node_sidecar/src/tokenRecoveryService.js
  - node_sidecar/src/uiServer.js
  - node_sidecar/ui/app.js
  - node_sidecar/ui/index.html
  - node_sidecar/ui/styles.css
  - node_sidecar/tests/account-card-render.test.js
  - node_sidecar/tests/account-relogin-modal.test.js
  - node_sidecar/tests/account-scope-route.test.js
  - node_sidecar/tests/app-auth-store.test.js
  - node_sidecar/tests/auth-service-coexist.test.js
  - node_sidecar/tests/refresh-auth-route.test.js
  - node_sidecar/tests/session-pool-token-recovery.test.js
  - node_sidecar/tests/steam-guard-ui-contract.test.js
  - node_sidecar/tests/steam-guard-token-route.test.js
  - node_sidecar/tests/token-recovery-service.test.js
  - docs/project-cognition-map.md
  - docs/agent/worktrees/20260718-171039-steam-guard-coexist-live-fix.md
  - docs/agent/worktrees/20260718-185012-steam-login-recovery-ui.md
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
  - node_sidecar/tests/steam-guard-coexist-steam-adapter.test.js
  - node_sidecar/tests/steam-guard-coexist-worker.test.js
  - csgo_skins.db
  - inventory_ui_state.json
  - accounts.json
  - login_keys.json
  - client_config.json
  - package.json
  - node_sidecar/package.json
  - node_sidecar/package-lock.json
updated_at: 2026-07-18T19:36:02+08:00
last_verified: PASS 115 node_sidecar tests in 49.9s. Runtime PID 8008 listens on 127.0.0.1:8799 using this worktree's code with the main workspace runtime data. The real page shows 登录过期 instead of the raw LoginKey error; /api/accounts returned 11 scoped rows with 11 non-empty password projections, Cache-Control no-store, and zero mafile_content fields. The password control is editable, type=password, and autocomplete=current-password. No Steam login or credential submission was performed during runtime verification.
---

# Steam Login Recovery And Manual Guard UI

Persisted account credentials remain owned by AppAuthStore. The authorized account projection must include the saved password because the user explicitly requires the frontend to prefill an editable manual-login form. Accounts with local maFile may use automatic password plus generated Guard-code recovery; accounts without maFile must never enter automatic recovery and must return to the manual Guard login UI. Raw Steam errors must be normalized by login context and must not be displayed directly.
