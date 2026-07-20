---
status: continuation_started
target: Retire stale pre-lifecycle inventory SSE clients so old hidden pages cannot reconnect indefinitely and starve the visible page before Steam login.
handoff_id: 20260719-003117-sse-protocol-retirement
parent_handoff_id: 20260718-232045-disconnect-others-timeout
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
allowed_paths:
  - node_sidecar/src/uiServer.js
  - node_sidecar/ui/app.js
  - node_sidecar/tests/manual-connect-progress-overlay.test.js
  - node_sidecar/tests/sse-protocol-route.test.js
  - docs/project-cognition-map.md
  - docs/agent/worktrees/20260718-232045-disconnect-others-timeout.md
  - docs/agent/worktrees/20260719-003117-sse-protocol-retirement.md
forbidden_paths:
  - C:/Users/18220/Desktop/cs2_alchemy/**
  - node_sidecar/src/authService.js
  - node_sidecar/src/refreshWorkflow.js
  - node_sidecar/src/tokenRecoveryService.js
  - node_sidecar/src/services/sessionPool.js
  - node_sidecar/src/services/refreshRuntime.js
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
must_not_change:
  - Steam authentication classification, token recovery, Guard coexist, batch import, account persistence and backend Session Pool behavior.
  - The v2 SSE payload/event names and refreshRuntime ownership.
dirty_overlap:
  - uiServer.js, app.js and the project map already contain approved Guard/auth/UI work; preserve it and touch only the SSE handshake/version boundary.
temporary_compatibility:
  owner: /api/events route
  behavior: HTTP 204 for clients without stream_version=2 so EventSource stops reconnecting
  deletion_trigger: all supported packaged/browser clients are known to emit stream_version=2 and no legacy reconnects appear in runtime evidence
updated_at: 2026-07-19T00:49:01+08:00
child_handoff_id: 20260719-004901-relogin-feedback-cleanup
last_verified: RED proved the frontend omitted stream_version=2 and the server accepted legacy /api/events with 200. GREEN makes the frontend request v2 and returns HTTP 204 before refreshRuntime registration for legacy clients. After restarting PID 47704, old browser connections drained from six to one. The actual user tab at 127.0.0.1:8799 was reloaded, and clicking LOVE's 登录过期 badge opened the 重新登录 dialog without a disconnect-others timeout. Targeted frontend/route tests pass; full npm test passes 117 node_sidecar tests in 53.4s. Backend health remains to be checked in the final verification pass; user visual confirmation is pending.
---

# SSE Protocol Retirement

The visible frontend will request stream_version=2. The server will return HTTP 204 to legacy EventSource clients, which is the protocol signal to stop reconnecting, while v2 clients continue through the existing refreshRuntime handler unchanged.
