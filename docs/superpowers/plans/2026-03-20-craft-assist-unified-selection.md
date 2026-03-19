# Unified Craft Assist Selection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current craft-assist greedy solver with a unified relative-wear search flow that supports single-material symmetric target convergence and multi-material main-high/aux-low convergence while preserving the existing API contract.

**Architecture:** Keep `node_sidecar/src/services/craftAssistService.js` as the API-facing entry and data-normalization layer, but move the new search logic into a dedicated helper module so window expansion, Beam Search, and scoring stay isolated from request parsing and result shaping. Drive the refactor with backend-first regression tests that lock both single-material and multi-material behavior before removing the old greedy path.

**Tech Stack:** Node.js CommonJS, plain JavaScript, existing `node:assert/strict` test scripts, existing `uiServer` API, existing browser-side `app.js`

---

> Repo instruction note: do not add git commit steps unless the user explicitly asks. This plan intentionally omits commit tasks.

## File Map

- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistService.js`
  - Keep request normalization, candidate collection, API result shaping, and final validation.
  - Remove solver ownership from this file and delegate to the new search helper.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistSearch.js`
  - Own candidate window building, single-material and multi-material scoring, Beam Search, and cross-rarity best-solution selection.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`
  - Replace the current role-aware-only assertions with the new single-material and multi-material regression coverage.
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js`
  - Confirm `/api/craft/assist-select` request and response shape remain unchanged.
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`
  - UI stays API-driven; no new local solver logic should be added.
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/docs/superpowers/specs/2026-03-20-craft-assist-unified-selection-design.md`
  - Source-of-truth design for scoring priority, window expansion rules, and acceptance criteria.

## Chunk 1: Lock The New Behavior With Tests

### Task 1: Rewrite the backend test harness around the new target semantics

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`

- [ ] **Step 1: Keep the plain Node harness, but replace the current role-aware-only fixture comments with helpers that make relative-wear intent obvious**

```js
const assert = require("node:assert/strict");
const {selectCraftAssistForRecipe} = require("../node_sidecar/src/services/craftAssistService");

function makeRow({id, name, relative, rarity = 4, min = 0, max = 1}) {
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

function runSelect({rows, targetWear, materials, wearOffsetPct = 100}) {
  return selectCraftAssistForRecipe({
    rows,
    targetWear,
    wearFilterMode: "relative",
    materials,
    blockedIds: [],
    includeCooling: false,
    wearOffsetPct
  });
}
```

- [ ] **Step 2: Add a helper that extracts picked rows for easier assertions**

```js
function pickedIds(result) {
  return Array.isArray(result && result.item_ids) ? [...result.item_ids].sort() : [];
}
```

- [ ] **Step 3: Run the existing file once before changing assertions to capture the current baseline**

Run: `node "./tests/craftAssistService.test.js"`

Expected: PASS against the current greedy solver.

### Task 2: Add failing single-material regression coverage

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`

- [ ] **Step 1: Add a single-material test that prefers a tight band around `target` over a wide low/high counterweight**

```js
function test_single_material_prefers_tight_band_around_target() {
  const rows = [
    makeRow({id: "wide1", name: "Solo", relative: 0.160943}),
    makeRow({id: "wide2", name: "Solo", relative: 0.161053}),
    makeRow({id: "wide3", name: "Solo", relative: 0.161124}),
    makeRow({id: "wide4", name: "Solo", relative: 0.161222}),
    makeRow({id: "wide5", name: "Solo", relative: 0.161313}),
    makeRow({id: "wide6", name: "Solo", relative: 0.161549}),
    makeRow({id: "wide7", name: "Solo", relative: 0.161681}),
    makeRow({id: "near1", name: "Solo", relative: 0.204872}),
    makeRow({id: "near2", name: "Solo", relative: 0.205452}),
    makeRow({id: "near3", name: "Solo", relative: 0.206723}),
    makeRow({id: "near4", name: "Solo", relative: 0.220783}),
    makeRow({id: "near5", name: "Solo", relative: 0.222609}),
    makeRow({id: "near6", name: "Solo", relative: 0.223414}),
    makeRow({id: "near7", name: "Solo", relative: 0.223558}),
    makeRow({id: "near8", name: "Solo", relative: 0.223715})
  ];
  const result = runSelect({
    rows,
    targetWear: 0.2142,
    materials: [
      {name: "Solo", names: ["Solo"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.overall < 0.2142, true);
  assert.equal(pickedIds(result).includes("wide1"), false);
  assert.equal(pickedIds(result).includes("near1"), true);
}
```

- [ ] **Step 2: Add the non-`0~1` interval equivalence test so relative-space ordering is protected**

```js
function test_single_material_non_unit_interval_matches_relative_ordering() {
  const rows = [
    makeRow({id: "r1", name: "Shifted", relative: 0.19, min: 0.06, max: 0.80}),
    makeRow({id: "r2", name: "Shifted", relative: 0.20, min: 0.06, max: 0.80}),
    makeRow({id: "r3", name: "Shifted", relative: 0.21, min: 0.06, max: 0.80}),
    makeRow({id: "r4", name: "Shifted", relative: 0.22, min: 0.06, max: 0.80}),
    makeRow({id: "r5", name: "Shifted", relative: 0.23, min: 0.06, max: 0.80}),
    makeRow({id: "r6", name: "Shifted", relative: 0.24, min: 0.06, max: 0.80}),
    makeRow({id: "r7", name: "Shifted", relative: 0.25, min: 0.06, max: 0.80}),
    makeRow({id: "r8", name: "Shifted", relative: 0.26, min: 0.06, max: 0.80}),
    makeRow({id: "r9", name: "Shifted", relative: 0.27, min: 0.06, max: 0.80}),
    makeRow({id: "r10", name: "Shifted", relative: 0.28, min: 0.06, max: 0.80}),
    makeRow({id: "r11", name: "Shifted", relative: 0.33, min: 0.06, max: 0.80})
  ];
  const result = runSelect({
    rows,
    targetWear: 0.29,
    materials: [
      {name: "Shifted", names: ["Shifted"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.overall < 0.29, true);
  assert.equal(pickedIds(result).includes("r11"), false);
}
```

- [ ] **Step 3: Run the test file and verify at least one new assertion fails against the current solver**

Run: `node "./tests/craftAssistService.test.js"`

Expected: FAIL showing the current solver still accepts a wide counterweight composition or does not preserve the intended ordering.

### Task 3: Add failing multi-material regression coverage

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`

- [ ] **Step 1: Add a multi-material test where the closer overall solution must beat the more extreme main/aux split**

```js
function test_multi_material_prioritizes_closer_overall_before_role_bias() {
  const rows = [
    makeRow({id: "m1", name: "Main", relative: 0.24}),
    makeRow({id: "m2", name: "Main", relative: 0.241}),
    makeRow({id: "m3", name: "Main", relative: 0.242}),
    makeRow({id: "m4", name: "Main", relative: 0.243}),
    makeRow({id: "m5", name: "Main", relative: 0.255}),
    makeRow({id: "a1", name: "Aux", relative: 0.18}),
    makeRow({id: "a2", name: "Aux", relative: 0.181}),
    makeRow({id: "a3", name: "Aux", relative: 0.182}),
    makeRow({id: "a4", name: "Aux", relative: 0.183}),
    makeRow({id: "a5", name: "Aux", relative: 0.184}),
    makeRow({id: "a6", name: "Aux", relative: 0.10})
  ];
  const result = runSelect({
    rows,
    targetWear: 0.2142,
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 5, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 5, wear_min: 0, wear_max: 1}
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.overall < 0.2142, true);
  assert.equal(pickedIds(result).includes("a6"), false);
}
```

- [ ] **Step 2: Add a tie-break test where equal overall closeness must prefer higher mains and lower auxes**

```js
function test_multi_material_breaks_ties_with_main_high_aux_low_bias() {
  const rows = [
    makeRow({id: "m1", name: "Main", relative: 0.23}),
    makeRow({id: "m2", name: "Main", relative: 0.231}),
    makeRow({id: "m3", name: "Main", relative: 0.232}),
    makeRow({id: "m4", name: "Main", relative: 0.233}),
    makeRow({id: "m5", name: "Main", relative: 0.234}),
    makeRow({id: "m6", name: "Main", relative: 0.236}),
    makeRow({id: "a1", name: "Aux", relative: 0.194}),
    makeRow({id: "a2", name: "Aux", relative: 0.195}),
    makeRow({id: "a3", name: "Aux", relative: 0.196}),
    makeRow({id: "a4", name: "Aux", relative: 0.197}),
    makeRow({id: "a5", name: "Aux", relative: 0.198}),
    makeRow({id: "a6", name: "Aux", relative: 0.202})
  ];
  const result = runSelect({
    rows,
    targetWear: 0.2142,
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 5, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 5, wear_min: 0, wear_max: 1}
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.item_ids.includes("m6"), true);
  assert.equal(result.item_ids.includes("a6"), false);
}
```

- [ ] **Step 3: Add a cross-side fallback test to prove biased windows can still complete the recipe**

```js
function test_multi_material_allows_cross_side_fill_when_preferred_side_is_short() {
  const rows = [
    makeRow({id: "m1", name: "Main", relative: 0.22}),
    makeRow({id: "m2", name: "Main", relative: 0.221}),
    makeRow({id: "m3", name: "Main", relative: 0.222}),
    makeRow({id: "a1", name: "Aux", relative: 0.18}),
    makeRow({id: "a2", name: "Aux", relative: 0.181}),
    makeRow({id: "a3", name: "Aux", relative: 0.182}),
    makeRow({id: "a4", name: "Aux", relative: 0.183}),
    makeRow({id: "a5", name: "Aux", relative: 0.184}),
    makeRow({id: "a6", name: "Aux", relative: 0.216}),
    makeRow({id: "a7", name: "Aux", relative: 0.217})
  ];
  const result = runSelect({
    rows,
    targetWear: 0.2142,
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 3, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 7, wear_min: 0, wear_max: 1}
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.item_ids.length, 10);
}
```

- [ ] **Step 4: Add a same-role multi-material neutrality test**

```js
function test_multi_material_same_role_uses_neutral_tightness_scoring() {
  const rows = [
    makeRow({id: "a1", name: "A", relative: 0.20}),
    makeRow({id: "a2", name: "A", relative: 0.205}),
    makeRow({id: "a3", name: "A", relative: 0.24}),
    makeRow({id: "b1", name: "B", relative: 0.204}),
    makeRow({id: "b2", name: "B", relative: 0.206}),
    makeRow({id: "b3", name: "B", relative: 0.245})
  ];
  const result = runSelect({
    rows,
    targetWear: 0.2142,
    materials: [
      {name: "A", names: ["A"], role: "main", count: 3, wear_min: 0, wear_max: 1},
      {name: "B", names: ["B"], role: "main", count: 3, wear_min: 0, wear_max: 1}
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.item_ids.includes("a3"), false);
  assert.equal(result.item_ids.includes("b3"), false);
}
```

- [ ] **Step 5: Run the expanded test file and verify the current solver fails on the new multi-material cases**

Run: `node "./tests/craftAssistService.test.js"`

Expected: FAIL with one or more assertion errors in the new multi-material regressions.

## Chunk 2: Extract The Search Engine And Keep The Service Entry Thin

### Task 4: Create the new search helper module

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistSearch.js`
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistService.js`

- [ ] **Step 1: Add a module skeleton that exports the new search entrypoint and pure helpers**

```js
module.exports = {
  searchCraftAssistBestSolution,
  scoreCraftAssistSolutionSingleMaterial,
  scoreCraftAssistSolutionMultiMaterial
};
```

- [ ] **Step 2: Move pure comparison primitives into the helper first**

```js
function compareNumberAsc(a, b) {
  return Number(a) - Number(b);
}

function compareNumberDesc(a, b) {
  return Number(b) - Number(a);
}
```

- [ ] **Step 3: Add a normalized candidate shape so later search code never re-derives the same fields**

```js
function makeSearchCandidate({candidate, groupIndex, role, targetValue}) {
  const value = Number(candidate && candidate.value);
  return {
    ...candidate,
    groupIndex,
    role,
    value,
    distance: Math.abs(value - Number(targetValue)),
    side: value > Number(targetValue) ? "above" : (value < Number(targetValue) ? "below" : "equal")
  };
}
```

### Task 5: Build candidate windows for single-material and multi-material modes

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistSearch.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`

- [ ] **Step 1: Add a detector that chooses single-material vs multi-material scoring mode**

```js
function resolveSearchMode(materialGroups) {
  if ((Array.isArray(materialGroups) ? materialGroups : []).length === 1) return "single_material";
  return "multi_material";
}
```

- [ ] **Step 2: Add the symmetric window builder for single-material mode**

```js
function buildSymmetricWindow(candidates, targetValue, radius) {
  const sorted = [...candidates].sort((a, b) => a.distance - b.distance || a.value - b.value);
  return sorted.slice(0, Math.min(sorted.length, Math.max(1, radius)));
}
```

- [ ] **Step 3: Add the role-biased window builder for multi-material mode**

```js
function buildRoleBiasedWindow(candidates, role, targetValue, radius) {
  const preferred = [];
  const fallback = [];
  for (const candidate of candidates) {
    const isPreferred = role === "aux"
      ? candidate.value <= Number(targetValue)
      : candidate.value >= Number(targetValue);
    (isPreferred ? preferred : fallback).push(candidate);
  }
  preferred.sort((a, b) => a.distance - b.distance || b.value - a.value);
  fallback.sort((a, b) => a.distance - b.distance || a.value - b.value);
  return preferred.slice(0, radius).concat(fallback.slice(0, Math.max(0, radius - preferred.length)));
}
```

- [ ] **Step 4: Replace the placeholder logic with a per-group window-expansion helper that never duplicates IDs**

```js
function buildGroupWindow(group, targetValue, radius, mode) {
  const base = group.candidates.map((candidate) => makeSearchCandidate({
    candidate,
    groupIndex: group.index,
    role: group.material.role,
    targetValue
  }));
  return mode === "single_material"
    ? buildSymmetricWindow(base, targetValue, radius)
    : buildRoleBiasedWindow(base, group.material.role, targetValue, radius);
}
```

- [ ] **Step 5: Run the backend tests and keep them failing only on missing search behavior, not syntax**

Run: `node "./tests/craftAssistService.test.js"`

Expected: FAIL in behavior assertions, not module load errors.

### Task 6: Add solution scoring primitives before wiring search

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistSearch.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`

- [ ] **Step 1: Implement single-material score tuple generation**

```js
function scoreCraftAssistSolutionSingleMaterial({selected, targetValue}) {
  const values = selected.map((item) => Number(item.value));
  const overall = values.reduce((sum, value) => sum + value, 0) / values.length;
  const radius = Math.max(...values.map((value) => Math.abs(value - Number(targetValue))));
  const above = values.filter((value) => value > Number(targetValue)).length;
  const below = values.filter((value) => value < Number(targetValue)).length;
  return {
    overall,
    tuple: [
      Number(targetValue) - overall,
      radius,
      Math.abs(above - below)
    ]
  };
}
```

- [ ] **Step 2: Implement multi-material score tuple generation**

```js
function scoreCraftAssistSolutionMultiMaterial({selected, targetValue}) {
  const values = selected.map((item) => Number(item.value));
  const overall = values.reduce((sum, value) => sum + value, 0) / values.length;
  const mains = selected.filter((item) => item.role === "main").map((item) => Number(item.value));
  const auxes = selected.filter((item) => item.role === "aux").map((item) => Number(item.value));
  const wrongSidePenalty = mains.filter((value) => value < Number(targetValue)).length
    + auxes.filter((value) => value > Number(targetValue)).length;
  const mainMean = mains.length ? mains.reduce((sum, value) => sum + value, 0) / mains.length : 0;
  const auxMean = auxes.length ? auxes.reduce((sum, value) => sum + value, 0) / auxes.length : 0;
  return {
    overall,
    tuple: [
      Number(targetValue) - overall,
      wrongSidePenalty,
      -mainMean,
      auxMean
    ]
  };
}
```

- [ ] **Step 3: Add a tuple comparator used by both partial states and complete solutions**

```js
function compareScoreTuples(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const diff = Number(a[i] || 0) - Number(b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
```

## Chunk 3: Replace The Old Greedy Path With Windowed Beam Search

### Task 7: Implement the Beam Search core in the new helper

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistSearch.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`

- [ ] **Step 1: Flatten material counts into deterministic slot order**

```js
function expandMaterialSlots(groups) {
  const slots = [];
  for (const group of groups) {
    for (let i = 0; i < Number(group.material.count || 0); i += 1) {
      slots.push(group);
    }
  }
  return slots;
}
```

- [ ] **Step 2: Add a partial-state builder that tracks used IDs, sums, and role stats**

```js
function createSearchState() {
  return {
    slotIndex: 0,
    selected: [],
    usedIds: new Set(),
    sum: 0
  };
}
```

- [ ] **Step 3: Implement one-slot expansion using the current group window**

```js
function expandSearchState(state, slotGroup, windowCandidates) {
  const nextStates = [];
  for (const candidate of windowCandidates) {
    if (state.usedIds.has(candidate.id)) continue;
    const usedIds = new Set(state.usedIds);
    usedIds.add(candidate.id);
    nextStates.push({
      slotIndex: state.slotIndex + 1,
      selected: [...state.selected, candidate],
      usedIds,
      sum: state.sum + Number(candidate.value)
    });
  }
  return nextStates;
}
```

- [ ] **Step 4: Keep only the top partial states by heuristic score**

```js
function pruneBeam(states, beamWidth, targetValue, mode) {
  const scored = states.map((state) => ({
    state,
    score: mode === "single_material"
      ? scoreCraftAssistSolutionSingleMaterial({selected: state.selected, targetValue}).tuple
      : scoreCraftAssistSolutionMultiMaterial({selected: state.selected, targetValue}).tuple
  }));
  scored.sort((a, b) => compareScoreTuples(a.score, b.score));
  return scored.slice(0, beamWidth).map((item) => item.state);
}
```

- [ ] **Step 5: Implement the complete search loop over increasing window radii**

```js
function searchCraftAssistBestSolution({groups, targetValue, beamWidth = 200}) {
  const mode = resolveSearchMode(groups);
  const slots = expandMaterialSlots(groups);
  for (let radius = 1; radius <= getMaxRadius(groups); radius += 1) {
    const windows = groups.map((group) => buildGroupWindow(group, targetValue, radius, mode));
    let beam = [createSearchState()];
    for (const slotGroup of slots) {
      const groupWindow = windows[slotGroup.index];
      beam = pruneBeam(
        beam.flatMap((state) => expandSearchState(state, slotGroup, groupWindow)),
        beamWidth,
        targetValue,
        mode
      );
      if (!beam.length) break;
    }
    const best = pickBestCompleteSolution(beam, targetValue, mode);
    if (best) return {...best, windowRadius: radius};
  }
  return null;
}
```

- [ ] **Step 6: Run the backend test file and keep iterating until the new assertions pass**

Run: `node "./tests/craftAssistService.test.js"`

Expected: PASS once the new search path is returning the expected compositions.

### Task 8: Wire the service entrypoint to the new helper and remove the old greedy ownership

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistService.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistSearch.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`

- [ ] **Step 1: Import the new search helper at the top of the service file**

```js
const {searchCraftAssistBestSolution} = require("./craftAssistSearch");
```

- [ ] **Step 2: Replace the current `runCraftAssistSelectionForRecipe(...)` internals with group preparation plus helper delegation**

```js
const preparedGroups = materials.map((material, index) => ({
  index,
  material,
  candidates: collectCraftAssistCandidatesForMaterial(material, rowsByName, blocked, targetValue, {useRelativeFilter})
}));

const solved = searchCraftAssistBestSolution({
  groups: preparedGroups,
  targetValue
});
```

- [ ] **Step 3: Keep the existing final response contract and recipe validation**

```js
return {
  ok: true,
  itemIds: normalizeCraftRecipeItemIds(resultIds),
  overall,
  rarity: selectedRarity
};
```

- [ ] **Step 4: Remove or dead-code-eliminate the old greedy-only helpers once the new path is green**

```js
// Delete helpers that are no longer used by the main selection path:
// pickCraftAssistClosest
// pickCraftAssistByRolePriority
// applyCraftAssistRoleAwareCorrection
// applyCraftAssistDeficitCorrection
// applyCraftAssistOverflowCorrection
// applyCraftAssistOffsetWindowCorrection
// findCraftAssistFallbackBelowTargetSolution
```

- [ ] **Step 5: Re-run the backend test file after cleanup**

Run: `node "./tests/craftAssistService.test.js"`

Expected: PASS with no missing-function regressions.

### Task 9: Re-check API compatibility and keep the frontend API-only

**Files:**
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js`
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`

- [ ] **Step 1: Verify `/api/craft/assist-select` still forwards the same request fields**

Run: `rg -n "target_wear|wear_filter_mode|materials|blocked_ids|include_cooling|wear_offset_pct" node_sidecar/src/uiServer.js`

Expected: same request field list, no API contract drift.

- [ ] **Step 2: Verify the frontend still consumes only backend results and does not regain local solver logic**

Run: `rg -n "/api/craft/assist-select|run.overall|recipe_ok|recipe_reason" node_sidecar/ui/app.js`

Expected: UI still builds the request and renders backend output only.

- [ ] **Step 3: Run the backend tests one final time as the release gate**

Run: `node "./tests/craftAssistService.test.js"`

Expected: PASS

- [ ] **Step 4: Run the single-source guard test if it still exists**

Run: `node "./tests/uiCraftAssistSingleSource.test.js"`

Expected: PASS

## Plan Notes

- Keep all calculations in relative wear space even when source rows come from non-`0~1` absolute intervals.
- Do not change UI labels or request fields in this implementation pass unless a backend-only change becomes impossible to explain without a UI clarification.
- Prefer removing dead greedy helpers after the new search path is passing rather than carrying two solvers in parallel.
- If Beam Search proves too slow in practice, optimize pruning and window growth before weakening the scoring rules.

