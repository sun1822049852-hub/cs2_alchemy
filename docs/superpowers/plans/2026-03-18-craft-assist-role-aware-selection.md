# Role-Aware Craft Assist Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement backend-only, role-aware craft assist selection that uses asymmetric `overall > target` / `overall < target` refinement while preserving the existing API contract and final validation rules.

**Architecture:** Keep `node_sidecar/src/services/craftAssistService.js` as the single source of truth. Replace the current split/overflow/offset correction path with a role-aware initial picker plus side-specific refinement loop, then keep the existing final recipe and offset validation as the last gate. Frontend stays responsible only for material ranges, request payloads, and rendering backend results.

**Tech Stack:** Node.js CommonJS, plain JavaScript, `node:assert/strict`, existing `uiServer` API, existing browser-side `app.js`

---

> Repo instruction note: do not add git commit steps unless the user explicitly asks. This plan intentionally omits commit tasks.

## File Map

- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistService.js`
  - Replace the current selection core with role-aware candidate pools, role-aware initial picks, and asymmetric refinement.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`
  - Remove or downgrade the dead mirrored craft-assist solver code so the frontend is clearly API-only for selection logic.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`
  - Backend behavior-lock tests for role-aware selection and edge cases.
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js`
  - API contract stays unchanged; only confirm no request/response changes are needed.
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/docs/superpowers/specs/2026-03-18-craft-assist-role-aware-selection-design.md`
  - Source-of-truth design for implementation decisions.

## Chunk 1: Lock Backend Behavior With Tests

### Task 1: Create craft assist test harness and first over-target regression

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`

- [ ] **Step 1: Write fixture builders and the first failing test**

```js
const assert = require("node:assert/strict");
const {selectCraftAssistForRecipe} = require("../node_sidecar/src/services/craftAssistService");

function makeRow({
  id,
  name,
  relative,
  rarity = 4,
  min = 0,
  max = 1
}) {
  return {
    asset_id: String(id),
    name,
    alchemy_name: name,
    float_value: min + (max - min) * relative,
    minfloat: min,
    maxfloat: max,
    rarity,
    quality: 0,
    quality_name: "Normal",
    is_craftable: true,
    hidden_reason: "",
    casket_id: "",
    tradable_after: 0
  };
}

function runSelect({rows, targetWear, materials}) {
  return selectCraftAssistForRecipe({
    rows,
    targetWear,
    wearFilterMode: "relative",
    materials,
    blockedIds: [],
    includeCooling: false,
    wearOffsetPct: 100
  });
}

function test_over_target_squeezes_aux_before_main() {
  const rows = [
    makeRow({id: "m1", name: "Main", relative: 0.62}),
    makeRow({id: "m2", name: "Main", relative: 0.61}),
    makeRow({id: "m3", name: "Main", relative: 0.60}),
    makeRow({id: "m4", name: "Main", relative: 0.59}),
    makeRow({id: "m5", name: "Main", relative: 0.58}),
    makeRow({id: "m6", name: "Main", relative: 0.40}),
    makeRow({id: "a1", name: "Aux", relative: 0.49}),
    makeRow({id: "a2", name: "Aux", relative: 0.48}),
    makeRow({id: "a3", name: "Aux", relative: 0.47}),
    makeRow({id: "a4", name: "Aux", relative: 0.46}),
    makeRow({id: "a5", name: "Aux", relative: 0.45}),
    makeRow({id: "a6", name: "Aux", relative: 0.30}),
    makeRow({id: "a7", name: "Aux", relative: 0.28})
  ];
  const result = runSelect({
    rows,
    targetWear: 0.50,
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 5, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 5, wear_min: 0, wear_max: 1}
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.overall < 0.50, true);
  assert.equal(result.item_ids.includes("m6"), false);
  assert.equal(result.item_ids.includes("a6") || result.item_ids.includes("a7"), true);
}
```

- [ ] **Step 2: Run the new test file and verify it fails**

Run: `node "./tests/craftAssistService.test.js"`

Expected: `AssertionError` showing the current solver still uses the old split/overflow path.

- [ ] **Step 3: Keep the test file executable as a plain Node script**

```js
test_over_target_squeezes_aux_before_main();
console.log("craftAssistService tests passed");
```

- [ ] **Step 4: Re-run to confirm the failure is deterministic**

Run: `node "./tests/craftAssistService.test.js"`

Expected: same failure every run, no flaky ordering.

### Task 2: Add under-target, slot-target, and same-role failing tests

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`

- [ ] **Step 1: Add an under-target test that raises mains first without crossing the target**

```js
function test_under_target_raises_main_before_aux_without_crossing_target() {
  const rows = [
    makeRow({id: "m1", name: "Main", relative: 0.08}),
    makeRow({id: "m2", name: "Main", relative: 0.08}),
    makeRow({id: "m3", name: "Main", relative: 0.08}),
    makeRow({id: "m4", name: "Main", relative: 0.08}),
    makeRow({id: "m5", name: "Main", relative: 0.08}),
    makeRow({id: "m6", name: "Main", relative: 0.14}),
    makeRow({id: "m7", name: "Main", relative: 0.145}),
    makeRow({id: "a1", name: "Aux", relative: 0.02}),
    makeRow({id: "a2", name: "Aux", relative: 0.02}),
    makeRow({id: "a3", name: "Aux", relative: 0.02}),
    makeRow({id: "a4", name: "Aux", relative: 0.02}),
    makeRow({id: "a5", name: "Aux", relative: 0.02}),
    makeRow({id: "a6", name: "Aux", relative: 0.06})
  ];
  const result = runSelect({
    rows,
    targetWear: 0.15,
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 5, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 5, wear_min: 0, wear_max: 1}
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.overall < 0.15, true);
  assert.equal(result.item_ids.includes("m6") || result.item_ids.includes("m7"), true);
}
```

- [ ] **Step 2: Add the slot-target preference test from the design discussion**

```js
function test_under_target_prefers_candidate_not_exceeding_slot_target() {
  const rows = [
    makeRow({id: "m1", name: "Main", relative: 0.14}),
    makeRow({id: "m2", name: "Main", relative: 0.14}),
    makeRow({id: "m3", name: "Main", relative: 0.14}),
    makeRow({id: "m4", name: "Main", relative: 0.14}),
    makeRow({id: "m5", name: "Main", relative: 0.14}),
    makeRow({id: "a1", name: "Aux", relative: 0.02}),
    makeRow({id: "a2", name: "Aux", relative: 0.02}),
    makeRow({id: "a3", name: "Aux", relative: 0.02}),
    makeRow({id: "a4", name: "Aux", relative: 0.02}),
    makeRow({id: "a5", name: "Aux", relative: 0.02}),
    makeRow({id: "a6", name: "Aux", relative: 0.06}),
    makeRow({id: "a7", name: "Aux", relative: 0.09})
  ];
  const result = runSelect({
    rows,
    targetWear: 0.15,
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 5, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 5, wear_min: 0, wear_max: 1}
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.item_ids.includes("a6"), true);
  assert.equal(result.item_ids.includes("a7"), false);
}
```

- [ ] **Step 3: Add the fallback-above-slot-target test that is still legal because overall stays below target**

```js
function test_under_target_allows_above_slot_target_when_still_below_overall_target() {
  const rows = [
    makeRow({id: "solo1", name: "Solo", relative: 0.01}),
    makeRow({id: "solo2", name: "Solo", relative: 0.01}),
    makeRow({id: "solo3", name: "Solo", relative: 0.01}),
    makeRow({id: "solo4", name: "Solo", relative: 0.01}),
    makeRow({id: "solo5", name: "Solo", relative: 0.01}),
    makeRow({id: "solo6", name: "Solo", relative: 0.01}),
    makeRow({id: "solo7", name: "Solo", relative: 0.01}),
    makeRow({id: "solo8", name: "Solo", relative: 0.01}),
    makeRow({id: "solo9", name: "Solo", relative: 0.01}),
    makeRow({id: "solo10", name: "Solo", relative: 0.01}),
    makeRow({id: "solo11", name: "Solo", relative: 0.09})
  ];
  const result = runSelect({
    rows,
    targetWear: 0.20,
    materials: [
      {name: "Solo", names: ["Solo"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.overall < 0.20, true);
  assert.equal(result.item_ids.includes("solo11"), true);
}
```

- [ ] **Step 4: Add same-role special-case and failure-path tests**

```js
function test_all_main_items_use_single_side_branch() { /* assert 10 mains can refine without aux branch */ }
function test_all_aux_items_use_single_side_branch() { /* assert 10 aux items can refine without main branch */ }
function test_reports_failure_after_both_sides_are_exhausted() { /* assert ok=false with a side-exhausted message */ }
```

- [ ] **Step 5: Run the expanded test file and verify the new assertions fail**

Run: `node "./tests/craftAssistService.test.js"`

Expected: one or more assertion failures proving the old solver does not satisfy the new role-aware rules.

## Chunk 2: Implement the Backend Solver

### Task 3: Add role-aware candidate partition helpers

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistService.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`

- [ ] **Step 1: Add helper functions for role-aware pools and side classification**

```js
function isCandidateAboveTarget(candidate, targetValue) {
  return Number(candidate && candidate.value) > Number(targetValue) + EPSILON;
}

function isCandidateBelowTarget(candidate, targetValue) {
  return Number(candidate && candidate.value) < Number(targetValue) - EPSILON;
}

function buildRoleAwareCandidatePools(candidates, targetValue) {
  return {
    available: [...candidates],
    preferredAbove: candidates.filter((cand) => isCandidateAboveTarget(cand, targetValue)),
    preferredBelow: candidates.filter((cand) => isCandidateBelowTarget(cand, targetValue))
  };
}
```

- [ ] **Step 2: Thread the pool object through the prepared material structure**

```js
return {
  material,
  candidates: cands,
  pools: buildRoleAwareCandidatePools(cands, targetValue),
  estimateDiff
};
```

- [ ] **Step 3: Re-run tests to confirm they still fail on selection behavior, not on missing helpers**

Run: `node "./tests/craftAssistService.test.js"`

Expected: failures move deeper into selection assertions.

### Task 4: Replace initial pick logic with role-aware first picks

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistService.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`

- [ ] **Step 1: Implement a role-aware initial picker**

```js
function buildRoleAwareInitialSelection({material, pools, usedIds}) {
  const need = Number(material.count || 0);
  const primary = material.role === "aux" ? pools.preferredBelow : pools.preferredAbove;
  const primaryPick = primary.filter((cand) => !usedIds.has(cand.id)).slice(0, need);
  if (primaryPick.length === need) return primaryPick;
  const seen = new Set(primaryPick.map((item) => item.id));
  const fallback = pools.available
    .filter((cand) => !usedIds.has(cand.id) && !seen.has(cand.id))
    .slice(0, need - primaryPick.length);
  return primaryPick.concat(fallback);
}
```

- [ ] **Step 2: Replace `pickCraftAssistBySplit` usage in `runCraftAssistSelectionForRecipe`**

```js
let picked = buildRoleAwareInitialSelection({
  material,
  pools: item.pools,
  usedIds
});
```

- [ ] **Step 3: Run tests and make the initial role-priority assertions pass**

Run: `node "./tests/craftAssistService.test.js"`

Expected: the first “aux before main” failure should move from initial pick selection to refinement behavior.

### Task 5: Implement `overall > target` refinement

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistService.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`

- [ ] **Step 1: Add side-plan scoring for the over-target branch**

```js
function scoreOverTargetPlan({targetValue, nextOverall, slotDistance, passesFinal}) {
  return {
    passesFinal: passesFinal ? 0 : 1,
    targetGap: Math.abs(Number(nextOverall) - Number(targetValue)),
    slotDistance,
    descendingProgress: Number(nextOverall)
  };
}
```

- [ ] **Step 2: Implement “squeeze aux to exhaustion, then main”**

```js
function refineOverTarget({materialResults, targetValue}) {
  const order = ["aux", "main"];
  for (const role of order) {
    while (true) {
      const plan = buildSideReplacementPlan({
        materialResults,
        targetValue,
        role,
        branch: "over"
      });
      if (!plan || !plan.improves) break;
      applySideReplacementPlan(materialResults, plan);
      if (plan.passesFinal) return true;
    }
  }
  return false;
}
```

- [ ] **Step 3: Replace `applyCraftAssistOverflowCorrection` usage with the new branch entry point**

Run: `node "./tests/craftAssistService.test.js"`

Expected: over-target tests pass; under-target tests still fail.

### Task 6: Implement `overall < target` refinement with non-overflow guard

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistService.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`

- [ ] **Step 1: Add branch-specific legality checks**

```js
function candidateKeepsUnderTarget({overall, currentValue, nextValue, totalCount, targetValue}) {
  const nextOverall = Number(overall) + (Number(nextValue) - Number(currentValue)) / Number(totalCount);
  return nextOverall < Number(targetValue) - EPSILON;
}
```

- [ ] **Step 2: Encode the “prefer <= slotTarget, else allow > slotTarget if still legal” rule**

```js
function sortUnderTargetCandidates(candidates, slotTarget) {
  const under = candidates.filter((cand) => Number(cand.value) <= Number(slotTarget) + EPSILON);
  const over = candidates.filter((cand) => Number(cand.value) > Number(slotTarget) + EPSILON);
  under.sort((a, b) => Math.abs(Number(a.value) - Number(slotTarget)) - Math.abs(Number(b.value) - Number(slotTarget)));
  over.sort((a, b) => Math.abs(Number(a.value) - Number(slotTarget)) - Math.abs(Number(b.value) - Number(slotTarget)));
  return under.concat(over);
}
```

- [ ] **Step 3: Implement “squeeze main to exhaustion, then aux” without ever crossing the target**

```js
function refineUnderTarget({materialResults, targetValue}) {
  const order = ["main", "aux"];
  for (const role of order) {
    while (true) {
      const plan = buildSideReplacementPlan({
        materialResults,
        targetValue,
        role,
        branch: "under"
      });
      if (!plan || !plan.improves) break;
      applySideReplacementPlan(materialResults, plan);
    }
  }
}
```

- [ ] **Step 4: Run tests and make the under-target, slot-target, and same-role cases pass**

Run: `node "./tests/craftAssistService.test.js"`

Expected: all new craft-assist assertions pass.

### Task 7: Rewire the main service flow and keep the old final validation gate

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistService.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`

- [ ] **Step 1: Replace the old correction sequence in `runCraftAssistSelectionForRecipe`**

```js
if (overall > targetValue + EPSILON) {
  refineOverTarget({materialResults, targetValue});
} else if (overall < targetValue - EPSILON) {
  refineUnderTarget({materialResults, targetValue});
}
overall = calcCraftAssistOverallMean(materialResults);
```

- [ ] **Step 2: Keep `solveCraftAssistMinCostAssignmentForRarity` as a fallback/lower-bound helper, not the main path**

```js
const fallback = findCraftAssistFallbackBelowTargetSolution({
  prepared,
  raritySet: sharedRaritySet,
  targetValue
});
```

- [ ] **Step 3: Preserve the existing final response contract and offset validation**

Run: `node "./tests/craftAssistService.test.js"`

Expected: `craftAssistService tests passed`

- [ ] **Step 4: Run the existing unrelated regression test**

Run: `node "./tests/skinDbSync.test.js"`

Expected: `skinDbSync tests passed`

## Chunk 3: Remove Frontend Drift and Final Verification

### Task 8: Remove or isolate the dead mirrored solver from `app.js`

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`

- [ ] **Step 1: Confirm the local mirrored craft-assist solver is not used by runtime selection**

Run: `rg -n "runCraftAssistSelectionForRecipe\\(|pickCraftAssistBySplit\\(|applyCraftAssistOverflowCorrection\\(" "C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js"`

Expected: only dead helper definitions, not active selection callsites.

- [ ] **Step 2: Remove the dead local selection helpers or fence them off behind a clear comment if deletion is too risky**

```js
// Craft assist selection is backend-only. Keep UI responsibilities limited to
// request building, preset management, and rendering backend results.
```

- [ ] **Step 3: Verify `applyCraftAssistAutoSelection` still only calls the API**

Run: `rg -n "assist-select|run = await api\\(\"/api/craft/assist-select\"" "C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js"`

Expected: the selection path points only at the backend endpoint.

### Task 9: Final verification pass

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistService.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDbSync.test.js`

- [ ] **Step 1: Run backend craft-assist tests**

Run: `node "./tests/craftAssistService.test.js"`

Expected: `craftAssistService tests passed`

- [ ] **Step 2: Run the existing DB sync regression**

Run: `node "./tests/skinDbSync.test.js"`

Expected: `skinDbSync tests passed`

- [ ] **Step 3: Do a quick API-only sanity grep on the frontend**

Run: `rg -n "assist-select|createCraftAssistService|runCraftAssistSelectionForRecipe\\(" "C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js" "C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src"`

Expected: frontend keeps the API call, backend keeps the implementation, no live duplicated solver path remains in the UI.

