---
status: archived
target: Restore live craft-assist editor outcome/probability prediction and improve default role and drag feedback.
handoff_id: 20260804-140119-craft-assist-live-prediction
parent_handoff_id: 20260804-104451-craft-assist-editor-corrections-resume
branch: main
worktree: C:/Users/18220/Desktop/cs2_alchemy
allowed_paths:
  - node_sidecar/ui/app.js
  - node_sidecar/ui/index.html
  - node_sidecar/ui/styles.css
  - node_sidecar/src/services/craftOutcomePredictor.js
  - tests/craftOutcomePredictor.test.js
  - tests/craftAssistPresetEditorUi.test.js
  - node_sidecar/tests/craft-predictor-panel-state.test.js
  - node_sidecar/tests/craft-outcome-predictor-route.test.js
  - node_sidecar/tests/craft-assist-three-column-contract.test.js
  - docs/project-cognition-map.md
  - docs/agent/worktrees/20260804-140119-craft-assist-live-prediction.md
forbidden_paths:
  - node_sidecar/src/services/craftAssistService.js
  - node_sidecar/src/services/craftAssistWorker.js
  - node_sidecar/src/services/craftService.js
  - node_sidecar/src/services/craftTradeupWithComponentsService.js
  - node_sidecar/package.json
  - node_sidecar/package-lock.json
  - admin_console/**
  - csgo_skins.db
  - inventory_ui_state.json
  - backup/ui_state/**
must_not_change:
  - Selection and execution behavior, inventory eligibility, saved preset counts, and rarity-tag no-prediction behavior remain unchanged.
  - Known material quantities retain the existing probability calculation; only ambiguous aggregate material groups switch to unknown probability.
  - Database search must continue to allow adding catalog items absent from the current inventory.
  - Existing manual recipe prediction with a concrete average wear must retain its exact wear mapping.
  - Runtime databases, snapshots, credentials, dependencies, and Git history remain outside this task.
dirty_overlap:
  - UI, predictor tests, predictor service, project map, and related craft files already contain preceding uncommitted work; this change extends only the live editor prediction and drag interaction paths.
  - Existing backend selection/service changes and runtime artifacts belong to preceding work or the running application and remain untouched.
created_at: 2026-08-04T14:01:19+08:00
updated_at: 2026-08-04T16:10:00+08:00
last_verified: fresh full sidecar verification passed after the empty-role retention fix; server PID 34672 returned HTTP 200; user confirmed all frontend manual verification passed and authorized committing this conversation's changes.
---

# Craft Assist Live Prediction

Current step: preserve editor role shells and make role quantities complementary without coupling them to item drag operations.

## Required Behavior

- Specific-mode editor predicts products and probabilities as soon as materials are present, including partial counts.
- Without target relative wear, outcome cards omit the wear segment instead of showing a missing-wear placeholder.
- Adding catalog-only items remains supported; legacy material metadata is resolved from the catalog when inventory projections cannot supply it.
- New and edited editors default candidate additions to the main role.
- Cross-role mouse dragging shows a visible card ghost and preserves existing move behavior.
- Ambiguous aggregate material groups still list every possible outcome while omitting probability values.
- Main and auxiliary role groups each occupy half of the available editor height, including when either group has no items.
- Saving an empty role with a positive quantity is blocked by a frontend modal.
- The outcome wear converter has a stable size, no refinement badge, a permanently visible relative-wear row, and a fixed `0.` prefix with digit-only input.
- Moving an item changes only its role membership; the main/auxiliary quantity split and both role shells remain unchanged.
- Editing either role quantity updates the other role to keep a total of 10.
- Quantity inputs clamp main to 1-10 and auxiliary to 0-9, with the complementary side updated immediately so the pair always sums to 10.
- Empty editor role shells keep their quantity, add control, and filter configuration surface visible; only the remove control is hidden for a synthetic placeholder.

## Implemented Contract

- Ambiguous aggregate groups send unique candidate collections with `probability_mode: "unknown"` and the real `current_count`.
- The predictor returns the union of outcomes with `probability: null`, `probability_known: false`, and null probability summary fields while preserving target-wear mapping.
- Known distribution requests keep the existing count-weighted probability path.
- Main and auxiliary editor role groups use two equal-height rows with internal card scrolling.
- Save validation synthesizes missing role placeholders and opens a one-action warning modal when a positive-count role has no item.
- The outcome converter uses a fixed `0.` prefix, digit-only fractional input, an always-visible relative value, stable 440 x 620 desktop dimensions, and no refinement badge.

## Verification

- `node tests/craftOutcomePredictor.test.js`: pass.
- `node --test node_sidecar/tests/craft-predictor-panel-state.test.js`: pass.
- `node tests/craftAssistPresetEditorUi.test.js`: pass.
- `npm test` in `node_sidecar`: pass, 130 tests (fresh run after the empty-role retention fix).
- `node --check` for the edited predictor and UI scripts: pass.
- Empty-role shell retention assertions in `tests/craftAssistPresetEditorUi.test.js`: pass.
- `git diff --check` for task paths: pass; line-ending conversion warnings only.
- Fresh server PID 34672 listens on `127.0.0.1:8788` and returns HTTP 200.
- Browser/application E2E: user confirmed all requested manual verification passed.
