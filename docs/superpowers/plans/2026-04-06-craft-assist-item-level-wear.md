# Craft Assist Item-Level Wear Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move craft-assist wear filtering from material-level to item-level, keep solver semantics by `material.count`, and ship the partial UI reshuffle with per-card relative/absolute toggles.

**Architecture:** Introduce one browser+Node shared helper that owns canonical material normalization, item default-range resolution, persisted projection, cache-key tuple generation, and trace projection. Keep `craftAssistService` as the filtering/selection authority, but make `app.js`, `uiServer.js`, worker/service wrappers, search/prefilter traces, presets/drafts, and predictor all consume the same item-level shape and helper seams.

**Tech Stack:** Node.js CommonJS, browser plain JavaScript, static `index.html` script loading, existing `node:assert/strict` test files, existing `uiServer` API, no new dependencies.

---

> Repo instruction note: do not add git commit steps unless the user explicitly asks. This plan intentionally omits commit tasks and keeps work in the main workspace.

## File Map

- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/craftAssistItemWearShared.js`
  - UMD-style shared helper for canonical normalize, `resolveCraftAssistItemDefaultRange(...)`, `resolveCraftAssistRequiredCount()`, persisted projection, cache-key tuple, and trace projection.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistItemWearShared.test.js`
  - Pure helper regression tests for legacy upgrade, deterministic `item.id`, runtime-only fields, persisted projection, cache tuple, and trace projection.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-assist-route.test.js`
  - Route-level worker/direct parity tests for `/api/craft/assist-select`.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/index.html`
  - Load the shared helper before `app.js`.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`
  - Replace material-level wear truth with `material.items[]`, rework save/load/restore/predictor/request payloads, and render item cards.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistService.js`
  - Consume canonical normalized materials, cache-key tuple helper, trace projection helper, and strict stale-context rebuild rules.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistWorker.js`
  - Keep worker path aligned with the shared normalize + route contract.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js`
  - Build one route-level normalized request body and feed worker/direct branches identically.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistSearch.js`
  - Stop recomputing `materialName`; consume shared trace projection.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistShardPrefilter.js`
  - Stop recomputing `materialName`; consume shared trace projection.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistSearch.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistShardPrefilter.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistWorkerPool.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistWorkerWiring.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftOutcomePredictor.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/uiCraftAssistSingleSource.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-assist-panel-render.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-assist-preset-apply.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-assist-autoselect-writeback.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-assist-account-state.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-predictor-panel-state.test.js`

## Chunk 1: Shared Contract And Backend Parity

### Task 1: Lock the shared item-level contract with failing tests

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistItemWearShared.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistSearch.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistShardPrefilter.test.js`

- [ ] **Step 1: Add fixtures for legacy material payloads, new `items[]` payloads, and dirty duplicate inputs**

```js
const legacyMain = {role: "main", count: 2, names: ["A", "B"], wear_min: 0.1, wear_max: 0.2, custom_range: true};
const newMain = {role: "main", count: 2, items: [{name: "A", wear_filter_mode: "relative", wear_min: 0.1, wear_max: 0.2, custom_range: true}]};
```

- [ ] **Step 2: Add failing shared-helper assertions for canonical normalize, deterministic `item.id`, runtime-only fields, persisted projection, cache-key tuple, and trace projection**
- [ ] **Step 3: Add explicit failing resolver-matrix tests for `resolveCraftAssistItemDefaultRange(...)`, covering `source = load | restore | renormalize | mode-switch`, `customRange = true | false`, bad `storedRange` salvage vs downgrade, `usedStoredFallback`, `resolvedCustomRange`, rows+metadata merge behavior, and one named row proving `source = "mode-switch"` never falls back to `storedRange`**
- [ ] **Step 4: Run `node "./tests/craftAssistItemWearShared.test.js"` and confirm it fails because the shared helper/default-range resolver does not exist yet**
- [ ] **Step 5: Add failing service/search/prefilter tests that prove item-level candidate filtering now works per `material.items[]`, supports mixed `relative/absolute`, unions by `asset_id`, preserves comparator ordering, and exposes `materialName === primary_name` with stable `item_names` / `label`**
- [ ] **Step 6: Run `node "./tests/craftAssistService.test.js"`, `node "./tests/craftAssistSearch.test.js"`, and `node "./tests/craftAssistShardPrefilter.test.js"` and confirm they fail on old material-level filtering/trace behavior**

### Task 2: Implement the shared helper and rewire backend read-side consumers

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/craftAssistItemWearShared.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistService.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistSearch.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistShardPrefilter.js`

- [ ] **Step 1: Create a UMD-style shared helper that exports one object to both `module.exports` and `window`**

```js
const api = {normalizeCraftAssistMaterialListCanonical, resolveCraftAssistItemDefaultRange, projectCraftAssistPersistedMaterials, buildCraftAssistCandidateCacheKeyTuple, projectCraftAssistTraceMaterial};
```

- [ ] **Step 2: Move canonical list-level normalize, deterministic `item.id` mint, `resolveCraftAssistItemDefaultRange(...)`, `resolveCraftAssistRequiredCount()`, runtime-only projections, persisted projection, and trace projection into that helper**
- [ ] **Step 3: Make `craftAssistService.js` consume the helper for normalize, default-range resolution, `resolveCraftAssistRequiredCount()`, cache-key tuple/string generation, and service-side `selection_trace.prefilter.contextRefine.rounds[].attempts[].materialName`**
- [ ] **Step 4: Explicitly rework `collectCraftAssistCandidatesForMaterial(...)` to filter per item, respect each item card's mode/range, union by `asset_id`, and then keep the existing comparator/sort semantics**
- [ ] **Step 5: Make `craftAssistSearch.js` and `craftAssistShardPrefilter.js` stop recomputing `materialName` and instead read the shared trace projection**
- [ ] **Step 6: If the candidate filtering or route-normalize diff starts ballooning `craftAssistService.js`, extract one small pure helper instead of growing the monolith further**
- [ ] **Step 7: Run `node "./tests/craftAssistItemWearShared.test.js"`, `node "./tests/craftAssistService.test.js"`, `node "./tests/craftAssistSearch.test.js"`, and `node "./tests/craftAssistShardPrefilter.test.js"`; expect PASS**

### Task 3: Lock and implement route/worker/service parity for stale-context handling

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-assist-route.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistWorkerPool.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistWorkerWiring.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistWorker.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistService.js`

- [ ] **Step 1: Add failing stale-context tests proving sibling `rows`/`candidateRows` force a fresh `selectionContext` rebuild even when asset ids stay the same**
- [ ] **Step 2: Add a failing `tests/craftAssistService.test.js` case that exercises `createCraftAssistService().selectForRecipe({rows, ...})` directly and proves stale-context rebuild + candidate-cache invalidation when `alchemy_name/name`, `float_value`, `minfloat`, `maxfloat`, or `includeCooling` semantics change**
- [ ] **Step 3: Add a route-level failing test that compares worker/direct branch request derivation for `targetWear`, `wearApproachMode`, `materials`, `blockedIds`, `selectedItemIds`, `includeCooling`, `includeComponentItems`, `wearOffsetPct`, `enableFastCraftAssist`, and legacy mode upgrade**
- [ ] **Step 4: Add failing route assertions that the worker/direct branches also match on downstream observable outputs: candidate cache-key tuple, `selection_trace`, and prefilter trace shape/order, including one fixture where `items[]` already exists but conflicting legacy top-level mode fields are still present**
- [ ] **Step 5: Run `node "./node_sidecar/tests/craft-assist-route.test.js"`, `node "./tests/craftAssistService.test.js"`, `node "./tests/craftAssistWorkerPool.test.js"`, and `node "./tests/craftAssistWorkerWiring.test.js"` and confirm they fail before implementation**
- [ ] **Step 6: Implement route-level normalized request construction in `uiServer.js`, then feed both branches from that one object**
- [ ] **Step 7: Tighten `resolveCraftAssistSelectionContext(...)` so mixed-source calls always rebuild a fresh context and immutable-snapshot changes invalidate cached context**
- [ ] **Step 8: Run `node "./node_sidecar/tests/craft-assist-route.test.js"`, `node "./tests/craftAssistService.test.js"`, `node "./tests/craftAssistWorkerPool.test.js"`, and `node "./tests/craftAssistWorkerWiring.test.js"`; expect PASS**

## Chunk 2: Frontend State, UI, Predictor, And Regression

> `resolveCraftAssistRequiredCount()` lands in this chunk on the browser side because draft state, predictor preview, count input guards, and request-body assembly all read the same required-count truth.

### Task 4: Add failing state/persist/predictor tests for the new `items[]` truth source

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-assist-account-state.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-assist-preset-apply.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-assist-autoselect-writeback.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-predictor-panel-state.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftOutcomePredictor.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/uiCraftAssistSingleSource.test.js`

- [ ] **Step 1: Add failing tests showing presets, drafts, account-state, comparable snapshots, and API payload builders now persist `materials[].items[]`, no longer write material-level wear fields, and no longer emit top-level legacy fields (`wear_filter_mode`, `use_absolute_wear`, `craftAssistUseAbsoluteWear`, `craftAssistMainCount`, `craftAssistAuxCount`) on new writeback**
- [ ] **Step 2: Add failing predictor tests showing draft context reads live normalized `items[]`, `requiredCount`, and parent groups without falling back to recipe entries or stale recipe-derived state, and that `buildCraftPredictorRequestFromRecipeEntry(...)`, `renderCraftPredictorPanel()` subtitle/status fallback, and `refreshCraftPredictorPreview()` recipe-context fallback also delegate to the same `resolveCraftAssistRequiredCount()` truth**
- [ ] **Step 3: Add a failing single-source test that verifies the frontend request body sends item-level materials, omits legacy top-level writeback fields, and still goes through `/api/craft/assist-select`**
- [ ] **Step 4: Run the touched suites and confirm they fail on old material-level behavior**

### Task 5: Implement frontend state, restore, preset, predictor, and request-body changes

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/index.html`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`

- [ ] **Step 1: Load `craftAssistItemWearShared.js` before `app.js` and read it from `window`**
- [ ] **Step 2: Replace material-level normalize/save/load/restore helpers in `app.js` with item-level canonical normalize + persisted projection from the shared helper**
- [ ] **Step 3: Rework predictor draft builders and `buildCraftPredictorRequestFromRecipeEntry(...)` to read live normalized `items[]`, `resolveCraftAssistRequiredCount()`, and shared name projections**
- [ ] **Step 4: Replace all browser-side required-count consumers with `resolveCraftAssistRequiredCount()`: count input `max`, picker/new-material limits, save/apply blocking, restore/run normalization, plus `renderCraftPredictorPanel()` subtitle/status fallback and `refreshCraftPredictorPreview()` recipe-context fallback**
- [ ] **Step 5: Rebuild the `/api/craft/assist-select` request body from item-level materials while preserving existing auth/concurrency guards**
- [ ] **Step 6: Run `node "./node_sidecar/tests/craft-assist-account-state.test.js"`, `node "./node_sidecar/tests/craft-assist-preset-apply.test.js"`, `node "./node_sidecar/tests/craft-assist-autoselect-writeback.test.js"`, `node "./node_sidecar/tests/craft-predictor-panel-state.test.js"`, `node "./tests/craftOutcomePredictor.test.js"`, and `node "./tests/uiCraftAssistSingleSource.test.js"`; expect PASS**

### Task 6: Add failing panel-render tests for the partial UI reshuffle

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-assist-panel-render.test.js`

- [ ] **Step 1: Add a failing render test that expects `数量` in the condition header instead of the old material-level wear controls**
- [ ] **Step 2: Add a failing render test that expects selected materials to render as item cards under the owning main/aux material card**
- [ ] **Step 3: Add a failing render test that expects each item card to own its own `relative/absolute` switch plus `Minwear/Maxwear` inputs**
- [ ] **Step 4: Add a failing interaction/render test proving one card's mode switch only resets that card to the new-mode default range and does not mutate sibling cards**
- [ ] **Step 5: Add a failing interaction/state test proving new-card creation, mode-toggle reset, and clear-input reset all route through `source = "mode-switch"` and therefore never fall back to stale stored ranges**
- [ ] **Step 6: Add a failing render test that checks the required visible copy distinguishing global target wear, card filter mode, selected-card count, and material count contribution**
- [ ] **Step 7: Add a failing render test that deletes the last item card and expects the whole material group to disappear**
- [ ] **Step 8: Run `node "./node_sidecar/tests/craft-assist-panel-render.test.js"` and confirm the failures describe the new UI contract**

### Task 7: Implement the item-card UI and finish the targeted regression matrix

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/styles.css`

- [ ] **Step 1: Render each material card header as `条件设置（已选 N）` on the left and `数量 + role badge + add/remove` on the right**
- [ ] **Step 2: Remove the old selected-material strip and render item cards inside the owning material**
- [ ] **Step 3: Give every item card its own mode switch, range inputs, default-range reset behavior, and delete action**
- [ ] **Step 4: Ensure mode switches reset to the new-mode default range, clear-to-default sets `custom_range = false`, first item selection creates a material with `count = 1`, and deleting the final card removes the whole material**
- [ ] **Step 5: Run the targeted regression set below and keep all of them green**

Run:
- `node "./node_sidecar/tests/craft-assist-panel-render.test.js"`
- `node "./tests/craftAssistItemWearShared.test.js"`
- `node "./tests/craftAssistService.test.js"`
- `node "./tests/craftAssistSearch.test.js"`
- `node "./tests/craftAssistShardPrefilter.test.js"`
- `node "./tests/craftAssistWorkerPool.test.js"`
- `node "./tests/craftAssistWorkerWiring.test.js"`
- `node "./node_sidecar/tests/craft-assist-route.test.js"`
- `node "./node_sidecar/tests/craft-assist-account-state.test.js"`
- `node "./node_sidecar/tests/craft-assist-preset-apply.test.js"`
- `node "./node_sidecar/tests/craft-assist-autoselect-writeback.test.js"`
- `node "./node_sidecar/tests/craft-predictor-panel-state.test.js"`
- `node "./tests/craftOutcomePredictor.test.js"`
- `node "./tests/uiCraftAssistSingleSource.test.js"`

Expected: PASS for every command above.
