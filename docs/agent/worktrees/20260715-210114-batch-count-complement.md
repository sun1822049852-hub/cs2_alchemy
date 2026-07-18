---
status: archived
target: Keep batch preset main and auxiliary counts complementary to ten and lock main controls when auxiliary count is zero.
handoff_id: 20260715-210114-batch-count-complement
parent_handoff_id: 20260715-184955-batch-aux-search
branch: main
worktree: C:/Users/18220/Desktop/cs2_alchemy
allowed_paths:
  - node_sidecar/ui/app.js
  - node_sidecar/tests/batch-craft-preset-editor.test.js
  - docs/project-cognition-map.md
  - docs/agent/handoffs/20260715-210114-batch-count-complement.md
  - docs/agent/worktrees/20260715-210114-batch-count-complement.md
forbidden_paths:
  - csgo_skins.db
  - inventory_ui_state.json
  - accounts.json
  - login_keys.json
  - client_config.json
  - backup/ui_state/**
  - node_sidecar/src/services/**
  - admin_console/**
updated_at: 2026-07-15T22:11:51+08:00
last_verified: 2026-07-15; node syntax check, six direct/adjacent Node tests, browser runtime quantity complement/lock/persistence checks, and empty console log
---

# Worktree Registry

This refinement stayed in the main worktree because the project requires real-runtime UI iteration there. `app.js` and the batch preset test overlap with the immediately preceding uncommitted implementation by design. All runtime artifacts and unrelated user/session changes remained outside this task. No commit was created.
