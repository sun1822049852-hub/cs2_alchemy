---
status: continuation_started
target: Classify the real Steam message envelope `steam error: AccessDenied code=15` as login_key_invalid so stale authentication is cleared, auth_invalid is persisted, and manual relogin opens instead of allowing repeated old-session clicks.
handoff_id: 20260718-225516-steam-access-denied-message-envelope
parent_handoff_id: 20260718-222538-steam-access-denied-latched-fallback
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
allowed_paths:
  - node_sidecar/src/refreshWorkflow.js
  - node_sidecar/src/steamAuthDiagnosticLog.js
  - node_sidecar/tests/refresh-workflow-token-recovery.test.js
  - node_sidecar/tests/refresh-auth-route.test.js
  - node_sidecar/tests/steam-auth-diagnostic-log.test.js
  - docs/project-cognition-map.md
  - docs/agent/worktrees/20260718-222538-steam-access-denied-latched-fallback.md
  - docs/agent/worktrees/20260718-225516-steam-access-denied-message-envelope.md
forbidden_paths:
  - C:/Users/18220/Desktop/cs2_alchemy/**
  - node_sidecar/src/authService.js
  - node_sidecar/src/tokenRecoveryService.js
  - node_sidecar/src/uiServer.js
  - node_sidecar/src/services/sessionPool.js
  - node_sidecar/src/services/refreshRuntime.js
  - node_sidecar/ui/app.js
  - node_sidecar/src/steamGuardCoexistProcessAdapter.js
  - node_sidecar/src/steamGuardCoexistService.js
  - node_sidecar/src/steamGuardCoexistWorker.js
  - node_sidecar/src/steamGuardCoexistWorkerCore.js
  - node_sidecar/src/steamGuardImportService.js
  - node_sidecar/src/steamGuardSteamAdapter.js
  - node_sidecar/src/steamGuardTokenService.js
  - csgo_skins.db
  - inventory_ui_state.json
  - accounts.json
  - login_keys.json
  - client_config.json
updated_at: 2026-07-18T23:20:45+08:00
child_handoff_id: 20260718-232045-disconnect-others-timeout
last_verified: RED reproduced the exact message-only `steam error: AccessDenied code=15`; GREEN recognizes only explicit code/eresult/result=15 while plain AccessDenied remains negative. Refresh token clearing, downstream auth_invalid persistence, repeat-click blocking and relogin UI tests pass. Sanitized JSONL diagnostics and log-write failure isolation pass. Full npm test passes 116 node_sidecar tests in 52.8s. Runtime PID 42400 is healthy on 127.0.0.1:8799; the page reloads without console errors. The diagnostic file is created lazily on the next real auth failure, so the corrected real-account flow remains user E2E.
---

# AccessDenied Message Envelope

Only the error-envelope classifier changes. The accepted message form must include an explicit Steam result marker and numeric 15; unrelated AccessDenied text, network failures, and other Steam result codes must retain their existing behavior. Existing token/session invalidation, auth-state persistence and frontend manual-relogin consumers remain the authoritative downstream path.
