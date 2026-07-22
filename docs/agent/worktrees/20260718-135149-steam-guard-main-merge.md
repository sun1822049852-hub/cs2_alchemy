---
status: archived
target: Merge current main into the completed Steam Guard branch and verify the combined result.
handoff_id: 20260718-135149-steam-guard-main-merge
parent_handoff_id: 20260718-002850-steam-guard-tests-commit
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
allowed_paths:
  - docs/agent/handoffs/20260717-221753-simulation-zero-wear.md
  - docs/agent/handoffs/20260717-234730-project-architecture-selector.md
  - docs/agent/handoffs/20260718-135149-steam-guard-main-merge.md
  - docs/agent/worktrees/20260717-221753-simulation-zero-wear.md
  - docs/agent/worktrees/20260717-234730-project-architecture-selector.md
  - docs/agent/worktrees/20260718-135149-steam-guard-main-merge.md
  - docs/agent/session-log.md
  - docs/project-cognition-map.md
  - node_sidecar/tests/tradeup-simulation-derived-outputs.test.js
  - node_sidecar/tests/tradeup-simulation-page-state.test.js
  - node_sidecar/tests/tradeup-simulation-picker-interaction.test.js
  - node_sidecar/ui/app.js
forbidden_paths:
  - C:/Users/18220/Desktop/cs2_alchemy/**
  - package.json
  - node_sidecar/package.json
  - node_sidecar/package-lock.json
  - csgo_skins.db
  - inventory_ui_state.json
  - accounts.json
  - login_keys.json
  - client_config.json
  - backup/ui_state/**
  - node_sidecar/src/services/craftAssistService.js
  - node_sidecar/src/services/tradeupSimulationService.js
  - admin_console/**
updated_at: 2026-07-18T13:55:49+08:00
last_verified: 2026-07-18; merge completed without conflicts, npm test passed 111 default Node tests in 50.8s, node --check passed for 45 JavaScript files, and git diff --cached --check passed. Browser interaction tests and real Steam accounts were not verified.
---

# Worktree Registry

The user explicitly authorized merging current `main` into the existing isolated Guard branch. The merge completed without conflicts and preserved the committed Guard plan and zero-wear fix. The dirty main worktree was not part of this operation.
