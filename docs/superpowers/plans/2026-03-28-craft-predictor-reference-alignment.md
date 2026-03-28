# Craft Predictor Reference Alignment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the craft predictor drawer UI with the approved companion draft by removing status/nav/price chrome, switching to compact outcome tiles, and updating the short tab handle without changing predictor backend behavior.

**Architecture:** Keep the existing predictor drawer overlay and recipe-context data flow, but simplify the DOM and renderer so the drawer becomes a single scrolling result surface. The implementation will tighten scope to the predictor HTML/CSS/JS and update UI tests first so the approved layout becomes the enforced contract.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Node-based string-assert UI tests

---

## File Map

- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\index.html`
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\styles.css`
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\app.js`
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\tests\craftPredictorDrawerUi.test.js`
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\tests\craft-predictor-panel-state.test.js`

## Chunk 1: Lock The Approved UI Contract In Tests

### Task 1: Tighten the drawer shell expectations

**Files:**
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\tests\craftPredictorDrawerUi.test.js`

- [ ] **Step 1: Write the failing test expectations**

Add assertions that require:
- no `craftPredictorStatus` node in HTML
- no `craftPredictorNav` node in HTML
- no `.craft-predictor-status`, `.craft-predictor-nav`, `.craft-predictor-outcome-price-slot` CSS blocks
- no `ui.craftPredictorStatus`, `ui.craftPredictorNav`, or price-slot DOM creation in `app.js`
- presence of compact tile hooks such as a three-column grid, short tab handle chrome, and a result-head block

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/craftPredictorDrawerUi.test.js`
Expected: FAIL because current drawer code still includes status/nav/price artifacts

### Task 2: Keep predictor state coverage intact while removing old render dependencies

**Files:**
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\tests\craft-predictor-panel-state.test.js`

- [ ] **Step 1: Extend the failing test harness**

Update the extracted function context so `renderCraftPredictorPanel()` no longer requires removed `status/nav` nodes and still preserves:
- recipe context targeting
- assist toggle isolation
- draft focus behavior

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_sidecar/tests/craft-predictor-panel-state.test.js`
Expected: FAIL if the production render logic still depends on removed status/nav nodes or stale helper names

## Chunk 2: Implement The Approved Drawer Layout

### Task 3: Simplify the predictor drawer markup

**Files:**
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\index.html`

- [ ] **Step 1: Remove stale drawer chrome**

Delete the old status block and right-side nav container from the predictor drawer markup while keeping:
- `craftPredictorStage`
- `craftPredictorPanel`
- `craftPredictorHandle`
- `craftPredictorDrawer`
- `craftPredictorTitle`
- `craftPredictorSubtitle`
- `craftPredictorList`

- [ ] **Step 2: Run the focused HTML test**

Run: `node tests/craftPredictorDrawerUi.test.js`
Expected: still FAIL, now on CSS/JS expectations rather than stale HTML fragments

### Task 4: Rebuild the drawer CSS around the companion draft

**Files:**
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\styles.css`

- [ ] **Step 1: Replace old status/nav/price styles with compact tile styles**

Implement:
- short gold tab handle
- flat dark result surface
- compact predictor head
- three-column outcome grid at regular widths
- vertical result tiles with art area, wear chip, probability badge, float row, wear bar, and name
- no down-press / Y-axis sink motion

- [ ] **Step 2: Run the focused UI contract test**

Run: `node tests/craftPredictorDrawerUi.test.js`
Expected: still FAIL until JS renderer matches the new hooks

### Task 5: Rebuild predictor rendering with minimal DOM output

**Files:**
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\app.js`

- [ ] **Step 1: Remove stale DOM dependencies**

Update the `ui` map and `renderCraftPredictorPanel()` guard so the renderer no longer depends on removed status/nav nodes.

- [ ] **Step 2: Build the approved head copy**

Render:
- title as `模拟结果`
- subtitle from active recipe label, relative wear, count, and rarity transition when available
- empty/error copy inside `craftPredictorList` instead of a separate status banner

- [ ] **Step 3: Build compact outcome tiles**

Render each group as:
- group head with title and light arrow glyph
- compact grid of outcome tiles

Render each tile with:
- art block
- wear label
- probability badge
- predicted float line
- wear bar marker
- name

Do not render:
- price slot
- right-side group nav buttons
- old horizontal chip/footer composition

- [ ] **Step 4: Run both focused tests**

Run:
- `node tests/craftPredictorDrawerUi.test.js`
- `node node_sidecar/tests/craft-predictor-panel-state.test.js`

Expected: PASS

## Chunk 3: Verify The Approved Scope

### Task 6: Re-run the drawer verification set

**Files:**
- Modify: none

- [ ] **Step 1: Run the final verification commands**

Run:
- `node tests/craftPredictorDrawerUi.test.js`
- `node node_sidecar/tests/craft-predictor-panel-state.test.js`

Expected:
- both commands exit `0`
- no lingering references to removed status/nav/price chrome in predictor files

- [ ] **Step 2: Summarize residual risks**

Record any remaining non-blocking risks, especially:
- exact visual fidelity still needing live UI eyeballing
- responsive density at narrow widths
- whether `mapped_skin_missing` needs a later compact hint treatment
