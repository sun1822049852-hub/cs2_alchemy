---
status: continuation_started
target: Restrict the account login Guard code to exactly five A-Z/0-9 characters with frontend sanitization and backend validation on every account-login code entry point.
handoff_id: 20260719-102000-login-guard-code-format
parent_handoff_id: 20260719-100200-existing-account-password-error
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
allowed_paths:
  - node_sidecar/ui/index.html
  - node_sidecar/ui/app.js
  - node_sidecar/ui/styles.css
  - node_sidecar/src/uiServer.js
  - node_sidecar/src/accountStore.js
  - node_sidecar/src/appAuthStore.js
  - node_sidecar/tests/account-relogin-modal.test.js
  - node_sidecar/tests/account-binding-policy.test.js
  - node_sidecar/tests/account-store-sqlite.test.js
  - node_sidecar/tests/refresh-auth-route.test.js
  - node_sidecar/tests/steam-guard-ui-contract.test.js
  - docs/project-cognition-map.md
  - docs/agent/worktrees/20260719-100200-existing-account-password-error.md
  - docs/agent/worktrees/20260719-102000-login-guard-code-format.md
forbidden_paths:
  - C:/Users/18220/Desktop/cs2_alchemy/**
  - node_sidecar/src/authService.js
  - node_sidecar/src/tokenRecoveryService.js
  - node_sidecar/src/refreshWorkflow.js
  - node_sidecar/src/services/**
  - node_sidecar/src/steamGuard*.js
  - node_sidecar/ui/styles.css
  - node_sidecar/package.json
  - node_sidecar/package-lock.json
  - csgo_skins.db
  - inventory_ui_state.json
  - accounts.json
  - login_keys.json
must_not_change:
  - Do not alter account/password login, Guard type selection, local maFile code generation, coexist binding App-code validation or Steam authentication session ownership.
  - Keep valid five-character email/device codes and the pending-login password contract unchanged.
  - Phase-one credential persistence must not write TokenStore, change the active account, or overwrite remark/profile/SteamID/maFile fields on an existing account.
dirty_overlap:
  - index.html, app.js, uiServer.js and the focused tests already contain approved Guard/relogin changes from this same lineage; edit only the account login Guard input normalization, length attributes, validation and tests.
updated_at: 2026-07-19T18:20:00+08:00
last_verified: The real input is accountTotp. RED tests prove the previous HTML and backend accepted six/invalid characters. The user added a Phase 1 persistence requirement: account/password truth is owned by AccountStore/AppAuthStore; generic upsertSteamAccount is unsafe for partial updates because omitted remark/profile fields overwrite existing values. The five-character login-code and phase-one credential persistence implementation passed the full 119-test suite. Continued in child handoff 20260719-182000-guard-only-import-code-flow for optional-password import, transactional local binding, reusable code-slot UI and coexist retry lifecycle.
---

# Login Guard Code Format

Use RED/GREEN tests for input/paste sanitization, exact five-character client blocking and strict backend rejection before Steam/auth service calls. Restart 8799 and verify the real input attributes and typed/pasted value in the live modal.
