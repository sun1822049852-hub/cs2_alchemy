---
status: archived
target: Isolate Steam Guard coexist authentication in a dedicated child process, fully synchronize Steam time before App-code verification, and preserve ordinary login/session behavior.
handoff_id: 20260718-171039-steam-guard-coexist-live-fix
parent_handoff_id: 20260718-154823-steam-guard-batch-import
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
allowed_paths:
  - node_sidecar/src/authService.js
  - node_sidecar/src/steamGuardCoexistService.js
  - node_sidecar/src/steamGuardSteamAdapter.js
  - node_sidecar/src/steamGuardCoexistProcessAdapter.js
  - node_sidecar/src/steamGuardCoexistWorker.js
  - node_sidecar/src/steamGuardCoexistWorkerCore.js
  - node_sidecar/src/uiServer.js
  - node_sidecar/tests/auth-service-coexist.test.js
  - node_sidecar/tests/steam-guard-coexist-route.test.js
  - node_sidecar/tests/steam-guard-coexist-service.test.js
  - node_sidecar/tests/steam-guard-steam-adapter.test.js
  - node_sidecar/tests/steam-guard-coexist-process-adapter.test.js
  - node_sidecar/tests/steam-guard-coexist-worker.test.js
  - node_sidecar/src/appAuthStore.js
  - node_sidecar/src/accountStore.js
  - node_sidecar/src/steamGuardImportService.js
  - node_sidecar/ui/app.js
  - node_sidecar/ui/index.html
  - node_sidecar/ui/styles.css
  - node_sidecar/tests/app-auth-store.test.js
  - node_sidecar/tests/account-store-sqlite.test.js
  - node_sidecar/tests/steam-guard-batch-import-route.test.js
  - node_sidecar/tests/steam-guard-batch-import-ui.test.js
  - docs/agent/worktrees/20260718-171039-steam-guard-coexist-live-fix.md
forbidden_paths:
  - C:/Users/18220/Desktop/cs2_alchemy/**
  - node_sidecar/src/steamGuardTokenService.js
  - node_sidecar/src/tokenRecoveryService.js
  - csgo_skins.db
  - inventory_ui_state.json
  - accounts.json
  - login_keys.json
  - client_config.json
  - package.json
  - node_sidecar/package.json
  - node_sidecar/package-lock.json
updated_at: 2026-07-18T18:46:43+08:00
last_verified: Coexist authentication now runs one dedicated child process per flow_id and no longer imports ordinary authService, TokenStore, SessionPool, Web Session or refreshRuntime. App-code verification queries Steam QueryTime through the existing proxy-aware HTTP layer before every comparison; synchronization failure keeps the candidate and all three attempts. TDD covered same-username process isolation, real fork IPC, email continuation, existing authenticator states, status=29, response validation, time-sync retry semantics, persistence ordering and ordinary-login regression. Full npm test passed 115 tests in 48.6s. Updated backend is running on 127.0.0.1:8799 with PID 9832 and zero idle coexist workers. Real Steam E2E remains pending.
---

# Steam Guard Coexist Live Fix

Preserve runtime credential data and ordinary login behavior. Each coexist flow must own its LoginSession, temporary tokens, candidate Guard data, Steam time offset, timeout and cleanup in a dedicated child process keyed by flow_id. It must not access ordinary pendingSessions, TokenStore, SessionPool, Web Session or refreshRuntime. App-code verification must synchronize Steam time before comparison; synchronization failure must not consume an App-code attempt. Batch import behavior remains unchanged.

## Current Result

- `steamGuardCoexistWorker.js` is the isolated runtime boundary; credentials are sent over IPC, never command-line arguments.
- `steamGuardCoexistWorkerCore.js` owns MobileApp login continuation, AddAuthenticator data, time synchronization and App-code attempts.
- `steamGuardCoexistProcessAdapter.js` owns child lifecycle and routes commands strictly by `flow_id`.
- `steamGuardCoexistService.js` retains only account authorization/persistence metadata and reports success only after `completeBinding` succeeds.
- Ordinary `authService.js` content matches the branch baseline; its SteamClient session and return contract were not expanded.
