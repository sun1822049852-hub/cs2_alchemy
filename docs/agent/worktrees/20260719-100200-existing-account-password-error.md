---
status: continuation_started
target: Report Steam InvalidPassword code=5 as a password-only error for an existing local account while preserving the generic account-or-password message for a new account.
handoff_id: 20260719-100200-existing-account-password-error
parent_handoff_id: 20260719-014158-dev-file-logging-integration
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
allowed_paths:
  - node_sidecar/src/uiServer.js
  - node_sidecar/ui/app.js
  - node_sidecar/tests/refresh-auth-route.test.js
  - node_sidecar/tests/account-relogin-modal.test.js
  - docs/project-cognition-map.md
  - docs/agent/worktrees/20260719-014158-dev-file-logging-integration.md
  - docs/agent/worktrees/20260719-100200-existing-account-password-error.md
forbidden_paths:
  - C:/Users/18220/Desktop/cs2_alchemy/**
  - node_sidecar/src/authService.js
  - node_sidecar/src/tokenRecoveryService.js
  - node_sidecar/src/refreshWorkflow.js
  - node_sidecar/src/services/**
  - node_sidecar/src/accountStore.js
  - node_sidecar/src/appAuthStore.js
  - node_sidecar/src/steamGuard*.js
  - node_sidecar/ui/index.html
  - node_sidecar/ui/styles.css
  - node_sidecar/package.json
  - node_sidecar/package-lock.json
  - csgo_skins.db
  - inventory_ui_state.json
  - accounts.json
  - login_keys.json
must_not_change:
  - Keep reason=invalid_password, HTTP 401, password clearing, Guard recovery, token/session invalidation and the new-account message unchanged.
  - Do not infer a new Steam result code or alter ordinary login transport.
dirty_overlap:
  - uiServer.js, app.js and both tests already contain approved Guard/relogin changes from this same lineage; edit only the contextual code=5 message path and its focused tests.
updated_at: 2026-07-19T10:20:00+08:00
last_verified: Live log for the user's retry showed raw InvalidPassword code=5 and reason=invalid_password/status=401. RED tests proved the existing-account backend message and relogin formatter were generic. After the scoped fix, refresh-auth-route and account-relogin-modal tests pass, including the new-account contrast; full npm test passes 119/119. Restarted 8799 from this Guard worktree with CS2_DEV_FILE_LOG=1 as PID 48040 and health ok. Continued in child handoff 20260719-102000-login-guard-code-format after the user requested strict five-character Guard code handling. No commit was created.
---

# Existing Account Password Error

Use RED/GREEN tests to prove existing local accounts receive a password-only message and new accounts retain the generic account-or-password message. Restart the real 8799 Guard backend and verify the live relogin toast after implementation.
