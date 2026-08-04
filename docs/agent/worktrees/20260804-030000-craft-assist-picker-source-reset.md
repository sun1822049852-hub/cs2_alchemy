---
status: archived
target: Fix the craft-assist editor so switching to warehouse source shows inventory candidates after an unsuccessful database search.
handoff_id: 20260804-030000-craft-assist-picker-source-reset
parent_handoff_id: 20260804-000001-craft-assist-three-column
branch: main
worktree: C:/Users/18220/Desktop/cs2_alchemy
allowed_paths:
  - node_sidecar/ui/app.js
  - tests/craftAssistPresetEditorUi.test.js
  - docs/agent/worktrees/20260804-030000-craft-assist-picker-source-reset.md
forbidden_paths:
  - node_sidecar/ui/index.html
  - node_sidecar/ui/styles.css
  - node_sidecar/src/**
  - node_sidecar/package.json
  - node_sidecar/package-lock.json
  - csgo_skins.db
  - inventory_ui_state.json
  - backup/ui_state/**
must_not_change:
  - Batch craft and simulation behavior remain unchanged.
  - Candidate eligibility, rarity locking, duplicate filtering, and saved presets remain unchanged.
  - Runtime databases and snapshots remain outside this fix.
  - No commit, push, stash, reset, cleanup, or worktree operation is authorized.
dirty_overlap:
  - node_sidecar/ui/app.js and tests/craftAssistPresetEditorUi.test.js contain this task's preceding uncommitted three-column editor changes; this fix extends those changes in place.
updated_at: 2026-08-04T09:27:57+08:00
last_verified: 2026-08-04 regression test passed; node_sidecar npm test PASS 130/130; app syntax and focused craft-assist tests passed; live 127.0.0.1:8787 reproduced stale-query filtering, then verified source switch clears the query, shows 12 warehouse groups, returns to database source, and finds 50 AUG results with no browser warning/error logs.
---

# Craft Assist Picker Source Reset

Fixed reproduction: entering a database query with no result and then activating the warehouse source clears the database query and immediately displays all eligible warehouse groups. Returning to database source starts from an empty query.
