---
status: archived
target: Migrate legacy accounts.json into SQLite once, persist unscoped active account in SQLite, remove the legacy file and runtime compatibility readers, and preserve current account/password/Guard semantics.
handoff_id: 20260720-165420-accounts-json-one-time-migration
parent_handoff_id: 20260720-162348-deleted-account-legacy-reimport
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
allowed_paths:
  - node_sidecar/src/appAuthStore.js
  - node_sidecar/src/accountStore.js
  - node_sidecar/src/constants.js
  - node_sidecar/src/uiServer.js
  - node_sidecar/tests/app-auth-store.test.js
  - node_sidecar/tests/account-store-sqlite.test.js
  - node_sidecar/tests/account-scope-route.test.js
  - node_sidecar/tests/account-profile-route-scope.test.js
  - node_sidecar/tests/component-permission-scope.test.js
  - node_sidecar/tests/ui-server-auth.test.js
  - node_sidecar/tests/runtime-paths.test.js
  - docs/project-cognition-map.md
  - docs/agent/worktrees/20260720-162348-deleted-account-legacy-reimport.md
  - docs/agent/worktrees/20260720-165420-accounts-json-one-time-migration.md
forbidden_paths:
  - C:/Users/18220/Desktop/cs2_alchemy/**
  - node_sidecar/src/authService.js
  - node_sidecar/src/tokenStore.js
  - node_sidecar/src/tokenRecoveryService.js
  - node_sidecar/src/steamGuardImportService.js
  - node_sidecar/src/steamGuardCoexistService.js
  - node_sidecar/ui/**
  - node_sidecar/package.json
  - node_sidecar/package-lock.json
  - csgo_skins.db
  - inventory_ui_state.json
  - login_keys.json
must_not_change:
  - SQLite account rows, passwords, maFile content, profiles, bindings and TokenStore values are preserved unless the migration explicitly imports a missing legacy row.
  - Existing SQLite values win over legacy accounts.json values; old data cannot overwrite current passwords, profile fields, Guard or active-account state.
  - Batch maFile import, ordinary login, Token recovery and coexist binding behavior remain unchanged.
  - Migration failure must not delete accounts.json or report a completed migration.
dirty_overlap:
  - Existing uncommitted delete-revival fix in appAuthStore.js and its test is part of this migration lineage and must be preserved.
  - node_sidecar/.playwright-cli is an existing untracked runtime artifact and remains outside this task.
updated_at: 2026-07-22T23:50:00+08:00
last_verified: One-time migration uses SQLite app_setting states, imports only missing legacy rows, preserves current SQLite values, persists the unscoped active account in SQLite, retains corrupt legacy input on failure, and deletes accounts.json only after the database transaction commits. Seven directly affected test files pass. A fresh full `npm test` completed with `PASS 119 node_sidecar tests in 104.0s`, including the previously intermittent client-auth-session-lifecycle test. Read-only runtime dry-run found 10 legacy usernames, 12 SQLite usernames, zero missing rows, and an active username already present in SQLite; no credential values were read or printed. Real runtime migration remains pending until the updated backend is restarted.
---

# Accounts JSON One-Time Migration

Implement with RED/GREEN tests using temporary database and legacy files. Do not mutate real runtime files until migration tests and a dry-run metadata check pass.
