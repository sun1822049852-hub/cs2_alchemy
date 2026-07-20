---
status: continuation_started
target: Simplify the relogin modal feedback by removing redundant relogin title/hint and inline status, using an account/password verification overlay title, and showing error messages without an automatic 错误： prefix.
handoff_id: 20260719-004901-relogin-feedback-cleanup
parent_handoff_id: 20260719-003117-sse-protocol-retirement
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
allowed_paths:
  - node_sidecar/ui/app.js
  - node_sidecar/tests/account-relogin-modal.test.js
  - node_sidecar/tests/steam-guard-ui-contract.test.js
  - docs/project-cognition-map.md
  - docs/agent/worktrees/20260719-003117-sse-protocol-retirement.md
  - docs/agent/worktrees/20260719-004901-relogin-feedback-cleanup.md
forbidden_paths:
  - C:/Users/18220/Desktop/cs2_alchemy/**
  - node_sidecar/ui/index.html
  - node_sidecar/ui/styles.css
  - node_sidecar/src/**
  - node_sidecar/tests/refresh-auth-route.test.js
  - node_sidecar/tests/token-recovery-service.test.js
  - csgo_skins.db
  - inventory_ui_state.json
  - accounts.json
  - login_keys.json
  - client_config.json
must_not_change:
  - Saved-password prefill in the relogin form.
  - Backend invalid_password classification, password persistence/clearing, Guard flow, token recovery and SSE protocol behavior.
  - Add-account modal title/hint and guard-code phase feedback.
dirty_overlap:
  - app.js, account-relogin-modal.test.js, steam-guard-ui-contract.test.js and the project map already contain approved Guard/auth/UI work; preserve it and modify only relogin feedback rendering plus the shared toast prefix.
updated_at: 2026-07-19T01:41:58+08:00
child_handoff_id: 20260719-014158-dev-file-logging-integration
last_verified: The live invalid-password response contract was confirmed from the route as HTTP 401 with reason=invalid_password, detail=InvalidPassword and message=账号或密码错误，请确认后重试; LOVE has no local maFile so password_cleared is absent. RED reproduced the toast 错误： prefix and old relogin title/hint/overlay/inline contracts. GREEN hides the relogin title and hint, suppresses accountStatus only in relogin mode, uses 正在验证账号和密码 for the phase-1 overlay, and renders toast messages without an automatic prefix. The real 127.0.0.1:8799 modal visibly contains only STEAM plus fields/actions; title and hint are absent and accountStatus is empty. A safe local validation attempt did not submit to Steam; the page was reloaded afterward so saved-password prefill is restored. account-relogin-modal and steam-guard-ui-contract tests pass; the second full npm test exits 0. The first full run failed only on the superseded static requirement that the deleted local-Guard hint remain visible. User confirmation of the wrong-password toast and overlay wording is pending.
---

# Relogin Feedback Cleanup

This continuation changes only the visible feedback contract for relogin. Backend response data and saved credentials remain unchanged.
