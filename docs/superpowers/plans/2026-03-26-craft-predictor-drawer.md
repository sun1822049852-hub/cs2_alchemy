# Craft Predictor Drawer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the craft outcome predictor into a bottom-half overlay drawer on top of the right-panel candidate preview so it stays independent from craft assist visibility and follows the currently selected recipe context.

**Architecture:** Keep the existing predictor API and rendering pipeline, but split predictor state into two independent concerns: drawer visibility and recipe-oriented display context. Keep the right-panel middle region as one full-height candidate viewport, then add an absolutely positioned bottom-half predictor stage with a right-edge overlay drawer, and route queue-card clicks plus draft editing through the predictor context helpers.

**Tech Stack:** Vanilla JS frontend in `node_sidecar/ui`, CSS in `styles.css`, static contract tests in `tests/`, VM-based state tests in `node_sidecar/tests/`

## Revision 2

The executed variant differs from the first plan draft:

- the predictor drawer now lives in an overlay stage that covers only the bottom half of the candidate viewport
- the candidate / queue preview remains one uninterrupted full-height surface beneath it
- the drawer handle sits on the right edge
- the drawer opens as an overlay and must not squeeze neighboring content

---

## Chunk 1: Red Tests For New Drawer Contract

### Task 1: Update static UI contract tests for the new drawer structure

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftPredictorDrawerUi.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftPredictorDrawerUi.test.js`

- [ ] **Step 1: Rewrite the failing static assertions**

```js
const htmlFragments = [
  'id="craftPreviewViewport"',
  'id="craftPredictorPanel"',
  'id="craftPredictorHandle"',
  'id="craftPredictorDrawer"'
];

assert.equal(html.includes('id="craftPredictorRail"'), false);
assert.match(css, /\.craft-predictor-panel\s*\{[\s\S]*left:\s*0;/m);
assert.match(css, /\.craft-predictor-panel\.collapsed\s*\{[\s\S]*translateX\(-/m);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/craftPredictorDrawerUi.test.js`
Expected: FAIL because the current HTML/CSS still uses `craftQueueMain`, right-edge rail placement, and old predictor ids.

### Task 2: Update predictor state tests around recipe-oriented context

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-predictor-panel-state.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-predictor-panel-state.test.js`

- [ ] **Step 1: Replace config-key expectations with context expectations**

```js
state: {
  craftPredictorOpen: false,
  craftPredictorContextType: "",
  craftPredictorContextId: "",
  craftPredictorContextLabel: ""
}

app.selectCraftPredictorContext({type: "recipe", id: "r1", label: "#1"});
assert.equal(app.state.craftPredictorContextType, "recipe");
assert.equal(app.state.craftPredictorContextId, "r1");
```

- [ ] **Step 2: Add a failing test that assist toggle no longer auto-opens predictor**

```js
app.state.craftPredictorOpen = false;
app.state.craftPredictorContextType = "recipe";
app.state.craftPredictorContextId = "r1";
app.setCraftAssistPanelOpen(true);
assert.equal(app.state.craftPredictorOpen, false);
```

- [ ] **Step 3: Add a failing test that explicit recipe context survives assist open**

```js
app.selectCraftPredictorContext({type: "recipe", id: "r1", label: "#1"});
app.setCraftAssistPanelOpen(true);
assert.equal(app.state.craftPredictorContextType, "recipe");
assert.equal(app.state.craftPredictorContextId, "r1");
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node node_sidecar/tests/craft-predictor-panel-state.test.js`
Expected: FAIL because current app state still uses `craftPredictorSelectedConfigKey` and assist open logic still rebinds predictor config.

## Chunk 2: Refactor Layout And State Model

### Task 3: Reshape the right-panel middle region HTML

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/index.html`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftPredictorDrawerUi.test.js`

- [ ] **Step 1: Introduce a dedicated preview viewport container**

```html
<div id="craftPreviewViewport" class="craft-preview-viewport">
  <div id="craftQueueList" class="craft-queue-list"></div>
  <section id="craftPredictorPanel" class="craft-predictor-panel collapsed" aria-live="polite">
    <button id="craftPredictorHandle" class="craft-predictor-handle" type="button"></button>
    <div id="craftPredictorDrawer" class="craft-predictor-drawer">
      ...
    </div>
  </section>
</div>
```

- [ ] **Step 2: Keep the top header and bottom execute row unchanged**

Run: review `index.html` and confirm only the middle region changed.

### Task 4: Replace predictor config state with predictor context state

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-predictor-panel-state.test.js`

- [ ] **Step 1: Update root state and scoped snapshot fields**

```js
craftPredictorOpen: false,
craftPredictorContextType: "",
craftPredictorContextId: "",
craftPredictorContextLabel: "",
```

- [ ] **Step 2: Add context helpers and remove assist-owned selection helpers**

```js
function clearCraftPredictorContext() {
  state.craftPredictorContextType = "";
  state.craftPredictorContextId = "";
  state.craftPredictorContextLabel = "";
}

function selectCraftPredictorContext({type = "", id = "", label = ""} = {}) {
  state.craftPredictorContextType = type;
  state.craftPredictorContextId = String(id || "").trim();
  state.craftPredictorContextLabel = String(label || "").trim();
}
```

- [ ] **Step 3: Make assist open/close preserve predictor visibility and context**

```js
function setCraftAssistPanelOpen(open, {expandOnOpen = true} = {}) {
  state.craftAssistOpen = !!open;
  renderCraftAssistPanel();
  if (typeof refreshCraftPredictorPreview === "function") void refreshCraftPredictorPreview();
}
```

- [ ] **Step 4: Run state test to verify it passes**

Run: `node node_sidecar/tests/craft-predictor-panel-state.test.js`
Expected: PASS

## Chunk 3: Wire Recipe Selection Into Predictor Refresh

### Task 5: Add recipe-based predictor request assembly

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-predictor-panel-state.test.js`

- [ ] **Step 1: Add a helper that builds predictor payload from a queue recipe**

```js
function buildCraftPredictorRequestFromRecipeEntry(entry, rowsById) {
  const itemIds = normalizeCraftRecipeItemIds(entry && entry.item_ids);
  const groups = new Map();
  // derive collection, rarity, stattrak, target_relative_wear from real rows
  return {ok: true, payload: {...}};
}
```

- [ ] **Step 2: Route predictor refresh by context type**

```js
if (state.craftPredictorContextType === "recipe") {
  draft = buildCraftPredictorRequestFromRecipeEntry(findCraftRecipeById(state.craftPredictorContextId), rowsById);
} else if (state.craftPredictorContextType === "draft") {
  draft = buildCraftPredictorRequestFromDraft(...);
}
```

- [ ] **Step 3: Add queue activation hook to update predictor context**

```js
onActivate: () => {
  setActiveCraftRecipe(entryId);
  selectCraftPredictorContext({type: "recipe", id: entryId, label: title});
  renderCraftPage();
}
```

- [ ] **Step 4: Keep current draft context refreshed while editing**

```js
if (state.craftPredictorContextType === "draft") {
  void refreshCraftPredictorPreview({force: true});
}
```

- [ ] **Step 5: Run state test suite again**

Run: `node node_sidecar/tests/craft-predictor-panel-state.test.js`
Expected: PASS with recipe context and assist-independence assertions green.

## Chunk 4: Implement Drawer Styling And Rendering

### Task 6: Restyle predictor into a left-handle middle drawer

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/styles.css`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftPredictorDrawerUi.test.js`

- [ ] **Step 1: Add new viewport and drawer styles**

```css
.craft-preview-viewport {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}

.craft-predictor-panel {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: min(52%, 420px);
}

.craft-predictor-panel.collapsed {
  transform: translateX(calc(-100% + 28px));
}
```

- [ ] **Step 2: Replace the old right-edge rail with a left-edge handle**

```css
.craft-predictor-handle {
  position: absolute;
  left: 100%;
  top: 50%;
  transform: translateY(-50%);
}
```

- [ ] **Step 3: Keep dark theme styling aligned with the current craft page**

Run: review the `theme-inkblue` override block and keep predictor colors inside the existing dark palette.

- [ ] **Step 4: Run the static UI contract test**

Run: `node tests/craftPredictorDrawerUi.test.js`
Expected: PASS

### Task 7: Update predictor render and button bindings

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftPredictorDrawerUi.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-predictor-panel-state.test.js`

- [ ] **Step 1: Update DOM bindings to use the new handle/drawer nodes**

```js
craftPreviewViewport: document.getElementById("craftPreviewViewport"),
craftPredictorHandle: document.getElementById("craftPredictorHandle"),
craftPredictorDrawer: document.getElementById("craftPredictorDrawer"),
```

- [ ] **Step 2: Render neutral state when there is no active context**

```js
const hasContext = !!state.craftPredictorContextType;
ui.craftPredictorPanel.classList.remove("hidden");
ui.craftPredictorPanel.classList.toggle("collapsed", !state.craftPredictorOpen);
if (!hasContext) ui.craftPredictorStatus.textContent = "请选择一个配方查看产物预测";
```

- [ ] **Step 3: Bind the handle toggle without changing predictor context**

```js
ui.craftPredictorHandle.onclick = () => {
  setCraftPredictorPanelOpen(!state.craftPredictorOpen, {manual: true});
};
```

- [ ] **Step 4: Run both focused test suites**

Run: `node tests/craftPredictorDrawerUi.test.js`
Expected: PASS

Run: `node node_sidecar/tests/craft-predictor-panel-state.test.js`
Expected: PASS

## Chunk 5: Final Verification

### Task 8: Run the relevant regression checks

**Files:**
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftQueueHeaderLayout.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftPredictorDrawerUi.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-predictor-panel-state.test.js`

- [ ] **Step 1: Run queue header regression**

Run: `node tests/craftQueueHeaderLayout.test.js`
Expected: PASS

- [ ] **Step 2: Run predictor drawer UI regression**

Run: `node tests/craftPredictorDrawerUi.test.js`
Expected: PASS

- [ ] **Step 3: Run predictor panel state regression**

Run: `node node_sidecar/tests/craft-predictor-panel-state.test.js`
Expected: PASS

- [ ] **Step 4: Review diff scope**

Run: `git diff -- docs/superpowers/specs/2026-03-26-craft-predictor-drawer-design.md docs/superpowers/plans/2026-03-26-craft-predictor-drawer.md node_sidecar/ui/index.html node_sidecar/ui/styles.css node_sidecar/ui/app.js tests/craftPredictorDrawerUi.test.js node_sidecar/tests/craft-predictor-panel-state.test.js tests/craftQueueHeaderLayout.test.js`
Expected: only predictor drawer spec/plan, UI layout, and related tests changed.

## Notes

- Per workspace instructions, do not create a git commit unless the user explicitly asks for one.
- Keep the implementation focused on pending recipe / draft prediction. Do not expand scope into backend contract changes.
