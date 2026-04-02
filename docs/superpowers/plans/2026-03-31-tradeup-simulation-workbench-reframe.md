# Trade-up Simulation Workbench Reframe Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `汰换模拟` page into a single-workbench dual-mode experience with `已保存配方` and `选材页面`, preserving existing resolve logic while replacing the current broken layout and updating preset persistence semantics.

**Architecture:** Keep the existing search and resolve APIs, but reshape the frontend around a new page-internal mode state, a compact workspace header, a saved-preset wall, and a fixed `左产物 / 右材料` workbench. Migrate preset storage from “cached rendered result state” toward “restore keys” by saving `target_item`, `active_anchor_item`, `active_anchor_abs_wear`, and `selected_material_collections`, then re-resolving on load.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, existing Node HTTP routes, Node-based assertion tests

**Repo Notes:** Stay in the main workspace. Do not create commits unless the user explicitly asks after verification.

---

## File Map

- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\index.html`
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\styles.css`
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\app.js`
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\tests\tradeupSimulationUi.test.js`
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\tests\tradeup-simulation-page-state.test.js`

## Chunk 1: Lock The New Frontend Contract First

### Task 1: Rewrite the simulation UI shell test for the dual-mode workbench

**Files:**
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\tests\tradeupSimulationUi.test.js`

- [ ] **Step 1: Replace the old shell assertions with the new approved structure**

Assert the page now contains:
- a mode-tab shell for `已保存配方` / `选材页面`
- a saved-preset wall container
- a workspace header container
- a left-side target dropzone
- separate output and material lane containers
- predictor-style card hooks for saved cards, output cards, and material cards

```js
assert(html.includes('id="simulationModeSavedBtn"'));
assert(html.includes('id="simulationModeWorkspaceBtn"'));
assert(html.includes('id="simulationSavedPresets"'));
assert(html.includes('id="simulationTargetDropzone"'));
assert(html.includes('id="simulationOutputLane"'));
assert(html.includes('id="simulationMaterialLane"'));
```

Also assert legacy fragments are gone from the primary layout contract:

```js
assert.equal(html.includes('id="simulationMainCard"'), false);
assert.equal(html.includes('simulation-setup-grid'), false);
```

- [ ] **Step 2: Add CSS and app contract assertions for the reframe**

Require new selectors and app fragments such as:
- `.simulation-mode-tabs`
- `.simulation-saved-grid`
- `.simulation-workspace-shell`
- `.simulation-target-dropzone`
- `.simulation-anchor-active`
- `simulationViewMode: "workspace"`
- `renderSimulationSavedPresets(`
- `renderSimulationWorkspace(`

- [ ] **Step 3: Run the UI shell test to verify it fails**

Run: `node tests/tradeupSimulationUi.test.js`  
Expected: FAIL because the current markup and render contract still reflect the old one-page layout

### Task 2: Rewrite the simulation page-state test for the new preset semantics

**Files:**
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\tests\tradeup-simulation-page-state.test.js`

- [ ] **Step 1: Replace the old preset-shape assertions**

Cover:
- defaulting `simulationViewMode` to `"workspace"`
- normalizing a legacy preset into the new shape
- preserving `active_anchor_item`
- preserving `active_anchor_abs_wear`
- preserving `selected_material_collections`
- switching from saved mode to workspace mode after activating a preset

```js
const presets = app.normalizeTradeupSimulationPresetList([{
  id: "preset_1",
  target_item: { markethashname: "USP-S | Cortex (Minimal Wear)" },
  active_anchor_item: { markethashname: "USP-S | Cortex (Minimal Wear)" },
  active_anchor_abs_wear: 0.118,
  selected_material_collections: ["猎杀号收藏品"]
}]);
assert.equal(presets[0].active_anchor_abs_wear, 0.118);
assert.deepEqual(presets[0].selected_material_collections, ["猎杀号收藏品"]);
```

- [ ] **Step 2: Add driver-edit and mode-switch assertions**

Cover:
- editing any left output updates `active_anchor_item`
- editing any left output updates `active_anchor_abs_wear`
- loading a preset card switches `simulationViewMode` to `"workspace"`

```js
const updated = app.applyTradeupSimulationAnchorEdit({
  presetId: "preset_1",
  anchorItem: { basemarkethashname: "P250 | 随便玩玩" },
  absoluteWear: 0.1417
});
assert.equal(updated, true);
assert.equal(app.state.simulationPresets[0].active_anchor_item.basemarkethashname, "P250 | 随便玩玩");
```

- [ ] **Step 3: Run the page-state test to verify it fails**

Run: `node node_sidecar/tests/tradeup-simulation-page-state.test.js`  
Expected: FAIL because the current helpers still save the older `active_driver_*` centered shape

## Chunk 2: Rebuild The Simulation Workbench Structure

### Task 3: Replace the old simulation page shell in HTML

**Files:**
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\index.html`

- [ ] **Step 1: Remove the old simulation hero/config shell**

Delete the layout contract centered on:
- `simulationMainCard`
- `simulation-setup-grid`
- the old “button + wear input + anchor shell” stack as the top-level body structure

- [ ] **Step 2: Add the approved dual-mode shell**

Insert:
- a mode tab bar
- a compact workspace summary bar
- a saved preset grid region
- a workspace shell with:
  - left target dropzone and output lane
  - right material lane
- a reused picker panel mounted near the dropzone

```html
<div class="simulation-mode-tabs">
  <button id="simulationModeSavedBtn" type="button">已保存配方</button>
  <button id="simulationModeWorkspaceBtn" type="button">选材页面</button>
</div>
<section id="simulationSavedPresets" class="simulation-saved-grid"></section>
<section id="simulationWorkspace" class="simulation-workspace-shell">
  <div id="simulationTargetDropzone" class="simulation-target-dropzone"></div>
  <div id="simulationOutputLane" class="simulation-output-lane"></div>
  <div id="simulationMaterialLane" class="simulation-material-lane"></div>
</section>
```

- [ ] **Step 3: Run the UI shell test**

Run: `node tests/tradeupSimulationUi.test.js`  
Expected: still FAIL until `app.js` and CSS catch up

### Task 4: Migrate frontend state and preset normalization to the new workbench semantics

**Files:**
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\app.js`
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\tests\tradeup-simulation-page-state.test.js`

- [ ] **Step 1: Add the new state slice pieces**

Add state for:
- `simulationViewMode`
- saved preset card selection behavior
- compact workspace header fields
- selected material collection summary

```js
simulationViewMode: "workspace",
simulationPresets: [],
simulationActivePresetId: "",
simulationLoading: false,
simulationPersisting: false,
```

- [ ] **Step 2: Normalize legacy and new presets into one frontend shape**

Implement a single normalized shape such as:

```js
{
  id,
  name,
  target_item,
  active_anchor_item,
  active_anchor_abs_wear,
  selected_material_collections,
  rows,
  warnings,
  dirty,
  updated_at
}
```

Migration rules:
- if only `active_driver_item_key` / `active_driver_markethashname` exist, convert them into `active_anchor_item`
- if only `anchors` exist, derive `selected_material_collections` from the collection-style anchors
- preserve old presets instead of dropping them

- [ ] **Step 3: Replace the old driver-edit helper with anchor-edit semantics**

Introduce a helper such as:

```js
function applyTradeupSimulationAnchorEdit({presetId, anchorItem, absoluteWear} = {}) {
  // updates active_anchor_item + active_anchor_abs_wear + dirty
}
```

Keep it responsible only for frontend state updates; the network resolve stays separate.

- [ ] **Step 4: Update preset persistence helpers**

When saving:
- write the normalized preset list to local storage
- sync the same normalized list to `/api/ui-state/tradeup-simulation-presets`
- store only the fields needed to restore the page quickly

- [ ] **Step 5: Run the page-state test**

Run: `node node_sidecar/tests/tradeup-simulation-page-state.test.js`  
Expected: still FAIL until render and interaction wiring are updated

### Task 5: Rebuild the simulation render and interaction flow around saved/workspace modes

**Files:**
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\app.js`

- [ ] **Step 1: Split the render path into mode-aware sections**

Add focused renderers:
- `renderSimulationModeTabs()`
- `renderSimulationSavedPresets()`
- `renderSimulationWorkspaceHeader()`
- `renderSimulationTargetDropzone()`
- `renderSimulationOutputGrid()`
- `renderSimulationMaterialGrid()`
- `renderSimulationWorkspace()`

- [ ] **Step 2: Make saved preset cards load into the workspace**

On card click:
- set the active preset
- switch `simulationViewMode` to `"workspace"`
- re-render
- call the existing resolve flow to refresh rows using the saved target + anchor state

- [ ] **Step 3: Make the target dropzone the primary target selector**

The dropzone should:
- show the current target item summary when present
- show an empty dashed-state prompt when absent
- open the existing picker panel on click

- [ ] **Step 4: Wire left-output edits to become the new active anchor**

When any editable left output changes:
- promote that card to `active_anchor_item`
- save `active_anchor_abs_wear`
- mark the preset dirty
- re-resolve the preset so the entire left/right workbench refreshes

- [ ] **Step 5: Keep material cards read-only and driven by the current anchor**

Render material cards from the resolve result only. Do not attach editable inputs to them.

- [ ] **Step 6: Make save write the approved restore keys**

`覆盖保存` should persist:
- `target_item`
- `active_anchor_item`
- `active_anchor_abs_wear`
- `selected_material_collections`
- metadata such as `name` / `updated_at`

- [ ] **Step 7: Run the focused frontend tests**

Run:
- `node tests/tradeupSimulationUi.test.js`
- `node node_sidecar/tests/tradeup-simulation-page-state.test.js`

Expected: PASS

## Chunk 3: Restyle The Workbench And Run Regression Verification

### Task 6: Replace the current simulation look with the predictor-inspired dark workbench

**Files:**
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\styles.css`

- [ ] **Step 1: Remove the white-board visual structure**

Delete or rewrite the rules that make:
- the result board bright white
- the old hero/config shell look detached from the rest of the page
- the output and material cards look like pale floating forms

- [ ] **Step 2: Add the new workbench shells**

Style:
- `.simulation-mode-tabs`
- `.simulation-saved-grid`
- `.simulation-workspace-shell`
- `.simulation-workspace-header`
- `.simulation-target-dropzone`
- `.simulation-output-lane`
- `.simulation-material-lane`

Keep the desktop workbench stable with a fixed `左产物 / 右材料` split where width allows.

- [ ] **Step 3: Restyle cards to match the target-predictor visual language**

Saved preset cards:
- compact summary cards
- target image + name + anchor summary + material collection summary

Output cards:
- dark card body
- stronger image band
- editable wear field
- visible anchor-active state

Material cards:
- same family look
- read-only wear display
- locked state badge

- [ ] **Step 4: Add the anchor-active highlight and responsive fallback**

Desktop:
- strong anchor highlight
- equalized left/right visual weight

Narrower widths:
- graceful collapse to single column
- preserve target dropzone and workspace summary readability

- [ ] **Step 5: Run the UI shell test**

Run: `node tests/tradeupSimulationUi.test.js`  
Expected: PASS

### Task 7: Run focused verification and adjacent regressions

**Files:**
- Modify: none

- [ ] **Step 1: Run the full simulation-focused verification set**

Run:
- `node tests/tradeupSimulationUi.test.js`
- `node node_sidecar/tests/tradeup-simulation-page-state.test.js`
- `node tests/tradeupSimulationCatalog.test.js`
- `node tests/tradeupSimulationService.test.js`
- `node node_sidecar/tests/tradeup-simulation-route.test.js`

Expected:
- all commands exit `0`
- the new shell, preset state migration, and existing resolve/search contracts all pass

- [ ] **Step 2: Run adjacent regression checks**

Run:
- `node tests/craftOutcomePredictor.test.js`
- `node node_sidecar/tests/craft-outcome-predictor-route.test.js`
- `node tests/inventoryCraftStyleScope.test.js`
- `node --check node_sidecar/ui/app.js`
- `git diff --check`

Expected:
- craft predictor behavior still passes
- no syntax errors
- no whitespace / patch-format regressions

- [ ] **Step 3: Manually verify the approved UX**

In the running app, confirm:
- `已保存配方` and `选材页面` are visually distinct
- clicking a saved preset loads it into the workspace
- the dashed target box is the main target-entry point
- the workspace clearly shows left outputs and right materials
- editing any left output visibly promotes it to the active anchor
- save persists the current anchor and selected material collections
- the page no longer has the glaring white lower panel shown in the rejection screenshot

- [ ] **Step 4: Record residual risks**

Call out any non-blocking gaps such as:
- `selected_material_collections` may still be a summary-only first version if the current anchor UI is intentionally minimal
- additional card compaction may be needed if one collection has many outputs on smaller laptop widths
- a later round may still extract simulation render helpers out of `app.js` if the file grows too much

