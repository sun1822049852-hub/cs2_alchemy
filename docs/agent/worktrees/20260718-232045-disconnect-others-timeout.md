---
status: continuation_started
target: Prevent manual account connection from remaining indefinitely at 40% when hidden pages exhaust the local SSE connection pool or the disconnect-others request never settles; hidden pages release SSE and the connect overlay/busy state has a bounded retryable timeout.
handoff_id: 20260718-232045-disconnect-others-timeout
parent_handoff_id: 20260718-225516-steam-access-denied-message-envelope
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
allowed_paths:
  - node_sidecar/ui/app.js
  - node_sidecar/tests/manual-connect-progress-overlay.test.js
  - docs/project-cognition-map.md
  - docs/agent/worktrees/20260718-225516-steam-access-denied-message-envelope.md
  - docs/agent/worktrees/20260718-232045-disconnect-others-timeout.md
forbidden_paths:
  - C:/Users/18220/Desktop/cs2_alchemy/**
  - node_sidecar/src/authService.js
  - node_sidecar/src/refreshWorkflow.js
  - node_sidecar/src/tokenRecoveryService.js
  - node_sidecar/src/uiServer.js
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
  - Steam authentication classification, token recovery, Guard coexist and batch import behavior.
  - Backend disconnect/session ownership and persisted account/runtime data.
dirty_overlap:
  - node_sidecar/ui/app.js and the project map already contain the approved Steam Guard/auth/UI work; preserve those edits and make a minimal additive change.
updated_at: 2026-07-19T00:31:17+08:00
child_handoff_id: 20260719-003117-sse-protocol-retirement
last_verified: Sanitized runtime request tracing proved five hidden/old pages automatically reconnected GET /api/events and exhausted the Chromium same-origin connection pool; POST /api/session/disconnect-others itself returned 200 in 104ms. RED reproduced both the unbounded local request and hidden-page SSE creation. GREEN adds a 5s disconnect-others timeout plus visibilitychange/pagehide ownership so hidden pages close SSE and a visible page restores only its current-account stream. A clean localhost:8799 runtime crossed 40% to 68%, reached /api/refresh, received real Steam code=15, persisted login_key_invalid with token_cleared=true/recovery_mode=manual_login, and opened the manual relogin modal. Full npm test passes 116 node_sidecar tests in 50.1s. User should retry from a freshly loaded page; old hidden pages running pre-fix JS require reload/close or a different origin until their SSE sockets are gone.
---

# Disconnect-Others Timeout

This continuation bounds the local pre-refresh disconnect request and owns the per-page inventory SSE lifecycle so hidden pages cannot starve ordinary API requests. It does not alter Steam login/recovery or backend session semantics.
