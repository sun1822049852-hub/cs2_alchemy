# Craft Assist Entry Window Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a target-plus-offset entry window for craft assist candidate comparison without changing final validation.

**Architecture:** Keep final validation as-is. Add a small search-layer entry-window predicate, pass the existing service-computed offset into search, and gate candidate scoring / `bestBelow` updates through that predicate. Tests lock the closed-window boundaries and prove UI/API shape stays unchanged.

**Tech Stack:** Node.js CommonJS, existing craft assist search/service modules, built-in `node` tests.

---

## Source Spec

- `docs/superpowers/specs/2026-05-24-craft-assist-entry-window-design.md`

## Files

- Modify: `node_sidecar/src/services/craftAssistSearch.js`
  - Add entry-window helper.
  - Thread entry-window options through scoring and `searchSingleMaterialExact`.
  - Keep discard reason lightweight and local to search diagnostics.
- Modify: `node_sidecar/src/services/craftAssistService.js`
  - Pass existing `offsetValue` / mode into `searchCraftAssistBestSolution`.
  - Do not change final validation or request/response shape.
- Modify: `tests/craftAssistSearch.test.js`
  - Add helper tests via the existing vm internals loader.
  - Add focused search behavior tests.
- Modify: `tests/craftAssistService.test.js`
  - Add service plumbing tests proving existing `wearOffsetPct` reaches search behavior.
- Optional modify: `docs/agent/session-log.md`
  - Record final implementation and verification outcome if the task is executed in a long session.

## Must Not Change

- Do not change final validation. Entry-window pass is not final success.
- Do not change material candidate collection, inventory filtering, blocked ID behavior, or craftability checks.
- Do not change fast prefilter strategy.
- Do not change UI controls, API field names, request payload shape, or response shape.
- Do not change `target_wear`, `target_wear_raw`, or float32 target-step validation.
- Do not add price, profit, probability, or target-skin logic.
- Do not use `targetStepSpec.lowerTargetStep / upperTargetStep` as the only source for this rule unless implementation proves it exactly matches `target ± offset`; prefer an explicit entry-window option.
- Do not commit unless the user explicitly asks.

---

## Phase P1: Lock Entry Window Semantics

### Milestone P1.M1: Helper Contract

**Files:**
- Modify: `tests/craftAssistSearch.test.js`
- Modify: `node_sidecar/src/services/craftAssistSearch.js`

- [ ] **P1.M1.T1.S1: Add RED tests for a pure entry-window helper**

  Extend `loadCraftAssistSearchInternals()` so tests can access the new helper after implementation, for example:

  ```js
  module.exports.__classifyCraftAssistEntryWindowForTest = classifyCraftAssistEntryWindow;
  ```

  Add table-driven tests for:

  ```text
  below:    [target - offset, target]
  infinite: [target - offset, target + offset]
  ```

  Required cases:

  | mode | target | offset | overall | expected |
  | --- | --- | --- | --- | --- |
  | below | 0.21 | 0.01 | 0.20 | entry |
  | below | 0.21 | 0.01 | 0.21 | entry |
  | below | 0.21 | 0.01 | 0.199999 | entry_window_low |
  | below | 0.21 | 0.01 | 0.210001 | entry_window_high |
  | infinite | 0.21 | 0.01 | 0.20 | entry |
  | infinite | 0.21 | 0.01 | 0.22 | entry |
  | infinite | 0.21 | 0.01 | 0.199999 | entry_window_low |
  | infinite | 0.21 | 0.01 | 0.220001 | entry_window_high |

- [ ] **P1.M1.T1.S2: Run helper tests and confirm RED**

  Run:

  ```powershell
  node tests/craftAssistSearch.test.js
  ```

  Expected: FAIL because `classifyCraftAssistEntryWindow` is not implemented/exported to the test sandbox yet.

- [ ] **P1.M1.T1.S3: Implement the minimal helper**

  In `node_sidecar/src/services/craftAssistSearch.js`, add a small helper near scoring helpers:

  ```js
  function classifyCraftAssistEntryWindow({overall, targetValue, approachMode = "below", offsetValue = 0} = {}) {
    const value = Number(overall);
    const target = Number(targetValue);
    const offset = Math.max(0, Number(offsetValue) || 0);
    if (!Number.isFinite(value) || !Number.isFinite(target)) return "entry_window_invalid";
    const lower = target - offset;
    const upper = normalizeApproachMode(approachMode) === "infinite"
      ? target + offset
      : target;
    if (value < lower) return "entry_window_low";
    if (value > upper) return "entry_window_high";
    return "entry";
  }
  ```

  Keep the boundary closed: use `< lower` and `> upper`, not `<=` / `>=`.

- [ ] **P1.M1.T1.S4: Run helper tests and confirm GREEN**

  Run:

  ```powershell
  node tests/craftAssistSearch.test.js
  ```

  Expected: new helper cases pass.

---

## Phase P2: Gate Single-Material Entry

### Milestone P2.M1: Score Predicate Uses Entry Window

**Files:**
- Modify: `tests/craftAssistSearch.test.js`
- Modify: `node_sidecar/src/services/craftAssistSearch.js`

- [ ] **P2.M1.T1.S1: Add RED tests for single-material scoring entry**

  Add tests through vm internals or exported scoring functions proving:

  - `scoreSingleMaterialSearchSelection` rejects `overall < target - offset`.
  - `scoreSingleMaterialSearchSelection` accepts `overall === target - offset`.
  - `scoreSingleMaterialSearchSelection` accepts `overall === target` at the entry layer.
  - `scoreSingleMaterialSearchSelection` rejects `overall > target`.

  Use deliberately simple selected arrays so the mean is exact enough for the asserted branch.

- [ ] **P2.M1.T1.S2: Run scoring tests and confirm RED**

  Run:

  ```powershell
  node tests/craftAssistSearch.test.js
  ```

  Expected: FAIL because `scoreSingleMaterialSearchSelection` still only knows old `< target` behavior.

- [ ] **P2.M1.T1.S3: Add entry-window parameters to scoring**

  Update `scoreSingleMaterialSearchSelection` to accept:

  ```js
  {
    selected,
    targetValue,
    approachMode = "below",
    entryOffsetValue = null
  }
  ```

  Behavior:

  - If `entryOffsetValue` is finite, use `classifyCraftAssistEntryWindow`.
  - If no entry offset is provided, preserve current behavior for compatibility.
  - Return `null` for non-entry results.
  - Optionally include a local diagnostic reason where practical, but do not build a large tracing system.

- [ ] **P2.M1.T1.S4: Thread options into local callers**

  Update local callers in:

  - `scoreSingleMaterialPushState`
  - `refineSingleMaterialCompensation`
  - `searchSingleMaterialExact`

  so the entry-window options flow through the balanced push and compensation pass.

- [ ] **P2.M1.T1.S5: Run scoring tests and confirm GREEN**

  Run:

  ```powershell
  node tests/craftAssistSearch.test.js
  ```

  Expected: focused scoring tests pass.

### Milestone P2.M2: Balanced Push Behavior

**Files:**
- Modify: `tests/craftAssistSearch.test.js`
- Modify: `node_sidecar/src/services/craftAssistSearch.js`

- [ ] **P2.M2.T1.S1: Add RED balanced-push regression tests**

  Add one or two focused tests using `searchCraftAssistBestSolution` or `searchSingleMaterialExact`:

  - A path that previously would return a low-but-too-far below result now returns `null` or a different in-window result.
  - A path with an exact lower-bound result can return that result.

  Pass an explicit entry offset through the public search function once the planned signature exists.

- [ ] **P2.M2.T1.S2: Run balanced-push tests and confirm RED**

  Run:

  ```powershell
  node tests/craftAssistSearch.test.js
  ```

  Expected: FAIL until search entry options are accepted and threaded.

- [ ] **P2.M2.T1.S3: Add search-level entry options**

  Update signatures conservatively:

  ```js
  searchCraftAssistBestSolution({
    ...,
    entryOffsetValue = null
  })

  searchSingleMaterialExact({
    group,
    targetValue,
    approachMode = "below",
    entryOffsetValue = null
  })
  ```

  Thread `entryOffsetValue` into scoring and compensation. Preserve existing behavior when it is omitted.

- [ ] **P2.M2.T1.S4: Keep final validation untouched**

  Do not change `validateCraftAssistFinalOverall` in `craftAssistService.js`.

- [ ] **P2.M2.T1.S5: Run balanced-push tests and confirm GREEN**

  Run:

  ```powershell
  node tests/craftAssistSearch.test.js
  ```

  Expected: balanced-push entry-window tests pass.

---

## Phase P3: Apply Entry Window To Generic Search Scoring

### Milestone P3.M1: Infinite And Beam-Compatible Entry

**Files:**
- Modify: `tests/craftAssistSearch.test.js`
- Modify: `node_sidecar/src/services/craftAssistSearch.js`

- [ ] **P3.M1.T1.S1: Add RED tests for infinite entry window**

  Add tests proving `infinite` mode scoring:

  - accepts `target - offset`,
  - accepts `target + offset`,
  - rejects values below lower bound,
  - rejects values above upper bound.

  Target the generic scoring path used by `scoreCraftAssistSolutionSingleMaterial`, `scoreCraftAssistSolutionNeutral`, and/or `scoreCompleteSelection`.

- [ ] **P3.M1.T1.S2: Run infinite scoring tests and confirm RED**

  Run:

  ```powershell
  node tests/craftAssistSearch.test.js
  ```

  Expected: FAIL until generic scoring can receive entry-window options.

- [ ] **P3.M1.T1.S3: Add entry-window options to generic scoring**

  Add an optional `entryOffsetValue` parameter to:

  - `buildApproachTuplePrefix`
  - `scoreCraftAssistSolutionSingleMaterial`
  - `scoreCraftAssistSolutionNeutral`
  - `scoreCraftAssistSolutionMultiMaterial`
  - `scoreCompleteSelection`
  - `scorePartialState` only if needed for pruning consistency
  - `pickBestCompleteSolution`
  - `runBeamSearchWithinCap`

  Keep old behavior when `entryOffsetValue` is omitted.

- [ ] **P3.M1.T1.S4: Avoid over-pruning partial states unless proven safe**

  If partial-state pruning cannot safely enforce the final entry window before all slots are selected, leave it unchanged and apply the entry window only to complete scoring. Document that choice in a short code comment only if needed.

- [ ] **P3.M1.T1.S5: Run search tests and confirm GREEN**

  Run:

  ```powershell
  node tests/craftAssistSearch.test.js
  ```

  Expected: all entry-window search tests pass.

---

## Phase P4: Service Plumbing

### Milestone P4.M1: Pass Existing Offset Into Search

**Files:**
- Modify: `node_sidecar/src/services/craftAssistService.js`
- Modify: `tests/craftAssistService.test.js`

- [ ] **P4.M1.T1.S1: Add RED service tests**

  Add focused service tests proving:

  - Existing `wearOffsetPct` creates the search entry window.
  - No new UI/API field is required.
  - A low-too-far candidate that used to be accepted by search is not selected as the entry candidate when offset excludes it.
  - Final validation behavior is unchanged.

- [ ] **P4.M1.T1.S2: Run service tests and confirm RED**

  Run:

  ```powershell
  node tests/craftAssistService.test.js
  ```

  Expected: FAIL until service passes entry offset into search.

- [ ] **P4.M1.T1.S3: Pass `offsetValue` through selection helpers**

  `craftAssistService.js` already computes:

  ```js
  const normalizedWearOffsetPct = normalizeCraftAssistWearOffsetPct(wearOffsetPct, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT);
  const offsetValue = getCraftAssistWearOffsetByTarget(targetValue, normalizedWearOffsetPct);
  ```

  Thread `offsetValue` as `entryOffsetValue` into:

  - `runCraftAssistSelectionForRecipe`
  - `solveCraftAssistGroupsForRarity`
  - `runCraftAssistBaselineRelay`
  - any direct `searchCraftAssistBestSolution` call used in the live selection path

  Keep existing `targetStepSpec` behavior separate.

- [ ] **P4.M1.T1.S4: Run service tests and confirm GREEN**

  Run:

  ```powershell
  node tests/craftAssistService.test.js
  ```

  Expected: focused service tests pass.

---

## Phase P5: Verification And Handoff

### Milestone P5.M1: Focused Verification

**Files:**
- Modify only if needed: `docs/agent/session-log.md`

- [ ] **P5.M1.T1.S1: Run focused search tests**

  Run:

  ```powershell
  node tests/craftAssistSearch.test.js
  ```

  Expected: PASS.

- [ ] **P5.M1.T1.S2: Run focused service tests**

  Run:

  ```powershell
  node tests/craftAssistService.test.js
  ```

  Expected: PASS.

- [ ] **P5.M1.T1.S3: Run float32 helper tests if touched indirectly**

  Run:

  ```powershell
  node tests/craftAssistFloat32Step.test.js
  ```

  Expected: PASS.

- [ ] **P5.M1.T1.S4: Check diff scope**

  Run:

  ```powershell
  git diff -- node_sidecar/src/services/craftAssistSearch.js node_sidecar/src/services/craftAssistService.js tests/craftAssistSearch.test.js tests/craftAssistService.test.js
  ```

  Expected: diff only covers entry-window predicate, search/service offset plumbing, and focused tests.

- [ ] **P5.M1.T1.S5: Record handoff if work remains**

  If implementation is not completed in one session, update `docs/agent/session-log.md` with:

  - completed steps,
  - last verified command,
  - remaining steps,
  - known risks.

---

## Implementation Notes

- This plan assumes current root worktree `C:/Users/18220/Desktop/cs2_alchemy`.
- Existing worktree is dirty. Do not revert unrelated changes.
- Runtime files under `backup/ui_state/`, `inventory_ui_state.json`, and `csgo_skins.db` may change for unrelated reasons; ignore unless this task directly touches them.
- Because the project rule encourages multi-agent execution after plan approval, use separate implementation/review agents only with clear file ownership.
