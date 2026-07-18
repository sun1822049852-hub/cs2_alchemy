---
status: archived
target: Fix zero-wear trade-up simulation material selection and immediate material-card projection.
handoff_id: 20260717-221753-simulation-zero-wear
parent_handoff_id: null
branch: main
worktree: C:/Users/18220/Desktop/cs2_alchemy
allowed_paths:
  - node_sidecar/ui/app.js
  - node_sidecar/tests/tradeup-simulation-derived-outputs.test.js
  - node_sidecar/tests/tradeup-simulation-page-state.test.js
  - node_sidecar/tests/tradeup-simulation-picker-interaction.test.js
  - docs/project-cognition-map.md
  - docs/agent/handoffs/20260717-221753-simulation-zero-wear.md
  - docs/agent/worktrees/20260717-221753-simulation-zero-wear.md
forbidden_paths:
  - csgo_skins.db
  - inventory_ui_state.json
  - accounts.json
  - login_keys.json
  - client_config.json
  - backup/ui_state/**
  - node_sidecar/src/services/craftOutcomePredictor.js
updated_at: 2026-07-17T23:17:15+08:00
last_verified: 2026-07-17T23:17:15+08:00; app syntax, five focused/adjacent test files, full picker interaction browser test, diff check, runtime app.js load, and read-only review passed
---

# Worktree Registry

This session stayed in the main worktree because the requested fix depended on the current uncommitted simulation picker baseline and project rules prefer the main workspace for live UI validation. Existing changes in `node_sidecar/ui/app.js` and simulation tests overlapped by design; edits were limited to the confirmed functions and focused assertions. No commit was created.
