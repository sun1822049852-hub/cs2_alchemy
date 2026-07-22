---
status: archived
target: Prevent a deleted Steam account from being recreated with its old password by repeated legacy accounts.json import before a passwordless maFile import.
handoff_id: 20260720-162348-deleted-account-legacy-reimport
parent_handoff_id: 20260719-215809-guard-only-import-code-flow-resume
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
allowed_paths:
  - node_sidecar/src/appAuthStore.js
  - node_sidecar/tests/account-store-sqlite.test.js
  - docs/project-cognition-map.md
  - docs/agent/worktrees/20260719-215809-guard-only-import-code-flow-resume.md
  - docs/agent/worktrees/20260720-162348-deleted-account-legacy-reimport.md
forbidden_paths:
  - C:/Users/18220/Desktop/cs2_alchemy/**
  - node_sidecar/src/uiServer.js
  - node_sidecar/src/tokenStore.js
  - node_sidecar/src/steamGuardImportService.js
  - node_sidecar/src/authService.js
  - node_sidecar/src/tokenRecoveryService.js
  - node_sidecar/ui/**
  - node_sidecar/package.json
  - node_sidecar/package-lock.json
  - csgo_skins.db
  - inventory_ui_state.json
  - accounts.json
  - login_keys.json
must_not_change:
  - Passwordless maFile import remains offline and creates a has_password=false Guard-only shell when no current SQLite account exists.
  - Existing-account import attachment and explicit password overwrite semantics remain unchanged.
  - Ordinary Steam login, TokenStore, Session Pool and coexist binding behavior remain unchanged.
  - Runtime account, token, UI-state and database files are read-only evidence and must not be edited.
dirty_overlap:
  - node_sidecar/.playwright-cli is an existing untracked runtime artifact and remains outside this task.
updated_at: 2026-07-22T23:50:00+08:00
child_handoff_id: 20260720-165420-accounts-json-one-time-migration
last_verified: Runtime diagnostics proved repeated legacy import recreated a deleted SQLite account with its old password. The narrow dual-store deletion fix was superseded by child handoff 20260720-165420-accounts-json-one-time-migration, which removes the repeated compatibility reader entirely through a versioned one-time migration.
---

# Deleted Account Legacy Reimport

Use RED/GREEN coverage for delete, writable-store reopen and same-name passwordless Guard-only recreation. Do not mutate the real runtime files while reproducing or verifying.
