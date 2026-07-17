---
status: complete
handoff_id: 20260717-221753-simulation-zero-wear
parent_handoff_id: null
branch: main
worktree: C:/Users/18220/Desktop/cs2_alchemy
updated_at: 2026-07-17T23:17:15+08:00
---

# Goal

Fix trade-up simulation material selection so a selected material is rendered immediately even when derived-output prediction fails, and make zero-relative-wear prediction use a valid boundary mode without changing the predictor's `below` contract.

# Completed

- Selected materials render immediately without waiting for derived outputs.
- Relative wear at or below `1e-7` uses `infinite`; higher values retain default `below` semantics.
- Material changes invalidate stale derived rows and candidates.
- Stale prediction success/failure responses cannot overwrite a newer material selection.
- API errors and missing, invalid, or empty outcome envelopes create escaped visible warnings without dropping selected materials.
- The wide-image interaction fixture now uses a valid non-lowest output item.

# Verification

- `node --check node_sidecar/ui/app.js`
- Five focused and adjacent Node test files passed.
- `node --test node_sidecar/tests/tradeup-simulation-picker-interaction.test.js` passed all 14 real-browser scenarios.
- `git diff --check` passed with line-ending warnings only.
- The existing server at `http://127.0.0.1:8788/` returned the updated `app.js`.

# Must Not Change

- Limited-edition and mixed-rarity picker filtering semantics.
- Predictor core semantics for `below + 0`.
- Runtime database and UI-state artifacts.
- Existing unrelated uncommitted changes.

# Unreviewed Scope

- Full repository test suite.
- Real Steam account operations and real trade-up execution.
- Unrelated existing uncommitted changes and sibling worktrees.
