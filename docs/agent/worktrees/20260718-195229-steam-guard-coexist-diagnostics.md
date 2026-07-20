---
status: archived
target: Persist sanitized Steam Guard coexist login diagnostics, including the raw Steam eresult/code, so the next real login attempt can be analyzed without changing ordinary login or batch import behavior.
handoff_id: 20260718-195229-steam-guard-coexist-diagnostics
parent_handoff_id: 20260718-185012-steam-login-recovery-ui
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
allowed_paths:
  - node_sidecar/src/steamGuardCoexistProcessAdapter.js
  - node_sidecar/src/steamGuardCoexistWorker.js
  - node_sidecar/src/steamGuardCoexistWorkerCore.js
  - node_sidecar/tests/steam-guard-coexist-process-adapter.test.js
  - node_sidecar/tests/steam-guard-coexist-worker.test.js
  - C:/Users/18220/Desktop/cs2_alchemy/logs/steam_guard_coexist/diagnostics.jsonl
  - docs/agent/worktrees/20260718-185012-steam-login-recovery-ui.md
  - docs/agent/worktrees/20260718-195229-steam-guard-coexist-diagnostics.md
forbidden_paths:
  - C:/Users/18220/Desktop/cs2_alchemy/**
  - node_sidecar/src/authService.js
  - node_sidecar/src/uiServer.js
  - node_sidecar/src/steamGuardCoexistService.js
  - node_sidecar/src/steamGuardImportService.js
  - node_sidecar/src/tokenRecoveryService.js
  - node_sidecar/ui/**
  - csgo_skins.db
  - inventory_ui_state.json
  - accounts.json
  - login_keys.json
  - client_config.json
  - package.json
  - node_sidecar/package.json
  - node_sidecar/package-lock.json
updated_at: 2026-07-18T20:04:14+08:00
last_verified: Diagnostics RED/GREEN completed; 14 targeted worker/process tests pass and diff-check is clean. Full npm test is blocked by the pre-existing account-relogin-modal test expecting a missing fetchLocalSteamGuardCode function in ui/app.js, outside this task boundary. Updated backend PID 48372 is healthy on 127.0.0.1:8799. The runtime JSONL will be created at C:/Users/18220/Desktop/cs2_alchemy/logs/steam_guard_coexist/diagnostics.jsonl on the next worker error.
---

# Steam Guard Coexist Diagnostics

The dedicated coexist child remains the authentication state owner. It may expose only a sanitized diagnostic envelope (`stage`, raw `eresult`/`code`, HTTP/Steam status and error type) to its parent. The parent process owns durable JSONL diagnostics. No credential, account name, email code, token, maFile or secret may be logged. Diagnostic write failure must not alter the coexist state-machine result.
