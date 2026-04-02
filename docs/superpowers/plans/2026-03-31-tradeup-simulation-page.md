# Trade-up Simulation Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the new `汰换模拟` page with saved sample switching, collection-row simulation results, editable output cards, read-only material cards, backend search/resolve APIs, and local persisted presets.

**Architecture:** Keep the new feature isolated from the existing `craftPage` by adding a dedicated navigation target, a dedicated frontend state slice, and dedicated backend services. Reuse the existing skin DB, `UiStateStore`, `skinAlchemyRules`, and `craftOutcomeCatalog` conventions so search, collection normalization, wear math, and preset persistence stay aligned with the rest of the app.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Node HTTP server, Node SQLite helpers, Node-based assertion tests

**Repo Notes:** Follow the workspace rule for this repo: stay in the main workspace and do not create commits unless the user explicitly asks for one after verification.

---

## File Map

- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\index.html`
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\styles.css`
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\app.js`
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\src\uiServer.js`
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\src\uiStateStore.js`
- Create: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\src\services\tradeupSimulationCatalog.js`
- Create: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\src\services\tradeupSimulationService.js`
- Create: `C:\Users\18220\Desktop\cs2_alchemy\tests\tradeupSimulationCatalog.test.js`
- Create: `C:\Users\18220\Desktop\cs2_alchemy\tests\tradeupSimulationService.test.js`
- Create: `C:\Users\18220\Desktop\cs2_alchemy\tests\tradeupSimulationUi.test.js`
- Create: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\tests\tradeup-simulation-route.test.js`
- Create: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\tests\tradeup-simulation-page-state.test.js`

## Chunk 1: Lock The Backend Contract First

### Task 1: Add search catalog tests for full skin lookup

**Files:**
- Create: `C:\Users\18220\Desktop\cs2_alchemy\tests\tradeupSimulationCatalog.test.js`

- [ ] **Step 1: Write the failing catalog tests**

Add focused assertions for:
- query by partial item name
- query by Chinese collection alias still returns normalized collection display
- results include `markethashname`, `basemarkethashname`, `collection`, `rarity`, `minfloat`, `maxfloat`, `goods_icon_url`
- duplicate wear variants collapse correctly only when the UI needs a concrete item picker record

```js
const results = catalog.searchItems("AK-47 | Slate");
assert.equal(results[0].markethashname, "AK-47 | Slate (Minimal Wear)");
assert.equal(results[0].collection, "Snakebite Case");
assert.equal(results[0].minfloat, 0);
assert.equal(results[0].maxfloat, 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/tradeupSimulationCatalog.test.js`
Expected: FAIL with `Cannot find module '../node_sidecar/src/services/tradeupSimulationCatalog'` or missing method errors

### Task 2: Add resolve-service tests for collection rows, absolute wear, and read-only materials

**Files:**
- Create: `C:\Users\18220\Desktop\cs2_alchemy\tests\tradeupSimulationService.test.js`

- [ ] **Step 1: Write the failing resolve tests**

Cover:
- selecting one concrete output item plus absolute wear produces one `rows[0]`
- `rows[0].outputs[*].absolute_wear` are recomputed from shared relative wear
- `rows[0].materials[*].absolute_wear` are recomputed from the same shared relative wear
- `driver` switches when a different left-side output is supplied as the active driver
- missing wear bounds degrade a card instead of dropping the whole row
- invalid absolute wear returns `ok: false`

```js
const result = service.resolve({
  target_item: {markethashname: "AK-47 | Slate (Minimal Wear)"},
  active_driver_item: {markethashname: "USP-S | The Traitor (Minimal Wear)"},
  active_driver_abs_wear: 0.1417,
  anchors: []
});
assert.equal(result.ok, true);
assert.equal(result.rows.length, 1);
assert.equal(result.rows[0].materials[0].editable, false);
assert.equal(typeof result.rows[0].outputs[0].absolute_wear, "number");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/tradeupSimulationService.test.js`
Expected: FAIL because the simulation service does not exist yet

### Task 3: Add route tests for search, resolve, and preset persistence endpoints

**Files:**
- Create: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\tests\tradeup-simulation-route.test.js`

- [ ] **Step 1: Write the failing route tests**

Add route coverage for:
- `GET /api/simulation/tradeup/search-items?q=slate`
- `POST /api/simulation/tradeup/resolve`
- `GET /api/ui-state/tradeup-simulation-presets`
- `POST /api/ui-state/tradeup-simulation-presets`

```js
const response = await requestJson({
  port: address.port,
  method: "GET",
  path: "/api/simulation/tradeup/search-items?q=slate"
});
assert.equal(response.statusCode, 200);
assert.equal(Array.isArray(response.body.items), true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_sidecar/tests/tradeup-simulation-route.test.js`
Expected: FAIL with `404` or missing handler assertions

- [ ] **Step 3: Record the red-test checkpoint without committing**

Capture the touched files and failing commands in the working notes, but keep the worktree uncommitted until the user asks for a commit.

## Chunk 2: Implement Catalog, Resolver, And Preset Persistence

### Task 4: Build the searchable skin catalog service

**Files:**
- Create: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\src\services\tradeupSimulationCatalog.js`
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\src\uiServer.js`

- [ ] **Step 1: Implement the catalog searcher**

Create a focused service that:
- opens the skin DB read-only
- queries by `markethashname`, `name`, `basemarkethashname`, and collection text
- normalizes collection labels with `normalizeCollectionKey`
- returns concrete picker rows with icon and wear bounds

```js
function createTradeupSimulationCatalog({dbPath} = {}) {
  return {
    searchItems(query) {
      const q = asString(query).trim();
      if (!q) return [];
      // SELECT ... FROM skin WHERE markethashname LIKE ? OR name LIKE ? ...
      return rows.map(normalizeSimulationSearchRow);
    }
  };
}
```

- [ ] **Step 2: Run the catalog test**

Run: `node tests/tradeupSimulationCatalog.test.js`
Expected: PASS

### Task 5: Build the simulation resolver around collection rows

**Files:**
- Create: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\src\services\tradeupSimulationService.js`
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\src\services\craftOutcomeCatalog.js`

- [ ] **Step 1: Extend the catalog snapshot only where necessary**

If the current `craftOutcomeCatalog` snapshot lacks enough metadata to expand lower-tier material families for a collection row, add the smallest safe extension:
- keep `baseBuckets` intact
- optionally add a same-shape bucket for input rarity families
- do not break existing predictor consumers

```js
return {
  dbPath,
  loadedAtMs: Date.now(),
  mtimeMs,
  baseBuckets,
  wearMap,
  simulationBuckets
};
```

- [ ] **Step 2: Implement the resolve service**

The resolver should:
- validate target and active-driver wear bounds
- derive `sharedRelativeWear`
- build one or more `rows`
- emit `outputs` and `materials` with `absolute_wear`, `wear_label`, `editable`, `role`, and warning flags
- keep materials read-only

```js
const relativeWear = (driverAbsWear - minfloat) / (maxfloat - minfloat);
const absoluteWear = item.minfloat + (item.maxfloat - item.minfloat) * relativeWear;
return {
  ok: true,
  target,
  driver,
  rows: [{collection, sharedRelativeWear: relativeWear, outputs, materials, warnings}],
  warnings
};
```

- [ ] **Step 3: Run the resolve-service test**

Run: `node tests/tradeupSimulationService.test.js`
Expected: PASS

### Task 6: Wire API routes and persisted preset storage

**Files:**
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\src\uiServer.js`
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\src\uiStateStore.js`

- [ ] **Step 1: Add preset getters/setters to `UiStateStore`**

Extend the JSON payload with a new `tradeup_simulation_presets` array and expose safe clone helpers.

```js
getTradeupSimulationPresets() {
  return JSON.parse(JSON.stringify(this.data.tradeup_simulation_presets || []));
}

setTradeupSimulationPresets(presets) {
  this.data.tradeup_simulation_presets = Array.isArray(presets) ? presets : [];
  this.save();
}
```

- [ ] **Step 2: Add the new routes to `uiServer`**

Add:
- `GET /api/simulation/tradeup/search-items`
- `POST /api/simulation/tradeup/resolve`
- `GET /api/ui-state/tradeup-simulation-presets`
- `POST /api/ui-state/tradeup-simulation-presets`

Ensure route responses mirror the tested shapes and return `400` on invalid simulation requests.

- [ ] **Step 3: Run the focused backend verification**

Run:
- `node tests/tradeupSimulationCatalog.test.js`
- `node tests/tradeupSimulationService.test.js`
- `node node_sidecar/tests/tradeup-simulation-route.test.js`

Expected: PASS

- [ ] **Step 4: Record the backend checkpoint without committing**

List the changed backend files and passing commands in the work log, but leave the tree dirty for user validation.

## Chunk 3: Lock The Frontend Contract In Tests

### Task 7: Add UI shell tests for nav entry, page skeleton, and single-row layout hooks

**Files:**
- Create: `C:\Users\18220\Desktop\cs2_alchemy\tests\tradeupSimulationUi.test.js`

- [ ] **Step 1: Write the failing UI shell assertions**

Require:
- `id="navSimulation"` and `id="simulationPage"` in `index.html`
- top toolbar hooks for sample switching, `新增配方`, and `覆盖保存`
- collection row hooks such as `.simulation-collection-row`, `.simulation-output-strip`, `.simulation-material-strip`
- no dedicated left recipe rail container
- both output and material cards expose absolute-wear fields

```js
assert(html.includes('id="navSimulation"'));
assert(html.includes('id="simulationPage"'));
assert(html.includes('simulation-output-strip'));
assert(!html.includes('simulation-recipe-rail'));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/tradeupSimulationUi.test.js`
Expected: FAIL because the page shell does not exist yet

### Task 8: Add page-state tests for preset loading and output-driven recalculation

**Files:**
- Create: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\tests\tradeup-simulation-page-state.test.js`

- [ ] **Step 1: Write the failing app-state tests**

Extract and assert the smallest reusable helpers needed for:
- nav page registration
- preset load/save normalization
- setting the active preset
- updating the active driver item from a left-side card edit
- recomputing an entire collection row after a driver change

```js
const next = applySimulationDriverEdit(state, {
  presetId: "preset_1",
  itemKey: "usp_traitor",
  absoluteWear: 0.1417
});
assert.equal(next.simulationActivePresetId, "preset_1");
assert.equal(next.simulationPresets[0].activeDriverItemKey, "usp_traitor");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_sidecar/tests/tradeup-simulation-page-state.test.js`
Expected: FAIL because the frontend simulation helpers do not exist yet

- [ ] **Step 3: Record the red frontend checkpoint without committing**

Note the failing UI/state tests and changed files, but do not create a commit.

## Chunk 4: Implement Navigation, State, And Collection-Row UI

### Task 9: Add the new navigation entry and simulation page shell

**Files:**
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\index.html`
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\styles.css`

- [ ] **Step 1: Add the HTML shell**

Insert:
- `navSimulation` beside the existing nav buttons
- `simulationPage` beside `craftPage`
- toolbar markup for preset switching and save actions
- setup area for target selection and anchors
- results area with collection-row containers

```html
<button class="nav-btn" data-page="simulationPage" id="navSimulation">汰换模拟</button>
<section class="page hidden" id="simulationPage">
  <header class="topbar simulation-topbar">...</header>
  <div id="simulationRows" class="simulation-rows"></div>
</section>
```

- [ ] **Step 2: Add the page-level CSS**

Implement:
- topbar chrome matching `theme-inkblue`
- one-row collection layout with fixed left/right lanes
- output and material strips that favor single-row display on desktop
- compact responsive fallback at narrower widths

- [ ] **Step 3: Run the shell test**

Run: `node tests/tradeupSimulationUi.test.js`
Expected: still FAIL until `app.js` wires state/rendering

### Task 10: Add frontend state, preset storage sync, and API clients

**Files:**
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\app.js`

- [ ] **Step 1: Add the new state slice and DOM refs**

Add:
- `state.simulationPresets`
- `state.simulationActivePresetId`
- `state.simulationPickerOpen`
- `state.simulationLoading`
- `state.simulationPersisting`
- matching `ui.*` refs

Also add a dedicated storage key and helper family mirroring the craft-assist preset flow.

```js
const TRADEUP_SIMULATION_PRESETS_KEY = "cs2alchemy.tradeupSimulationPresets";
state.simulationPresets = [];
state.simulationActivePresetId = "";
```

- [ ] **Step 2: Add preset load/save helpers**

Implement:
- read local presets
- write local presets
- sync presets to `/api/ui-state/tradeup-simulation-presets`
- load remote presets on boot
- mark presets dirty on edits

- [ ] **Step 3: Add search and resolve API helpers**

Implement:
- `searchTradeupSimulationItems(query)`
- `resolveTradeupSimulationPreset(preset)`
- request-key guards to avoid stale writes

- [ ] **Step 4: Run the page-state test**

Run: `node node_sidecar/tests/tradeup-simulation-page-state.test.js`
Expected: still FAIL until renderer and event wiring exist

### Task 11: Render the page, collection rows, and editable absolute-wear cards

**Files:**
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\app.js`
- Modify: `C:\Users\18220\Desktop\cs2_alchemy\node_sidecar\ui\styles.css`

- [ ] **Step 1: Register the page in `showPage()` and boot flow**

Extend nav/page wiring so `simulationPage` renders without affecting `craftPage`.

```js
for (const [id, btn] of [["accountPage", ui.navAccount], ["inventoryPage", ui.navInventory], ["craftPage", ui.navCraft], ["simulationPage", ui.navSimulation]]) {
  // ...
}
if (pageId === "simulationPage") renderSimulationPage();
```

- [ ] **Step 2: Render toolbar and setup panel**

Render:
- active preset summary / dropdown label
- `新增配方`
- `覆盖保存`
- current main card with large image
- target picker entry
- anchor editor entry points

- [ ] **Step 3: Render collection rows**

Each row must render:
- row summary
- left output strip with editable absolute-wear inputs
- right material strip with read-only absolute-wear display
- warning pills when degradation exists

```js
function renderSimulationCollectionRow(row) {
  return `
    <section class="simulation-collection-row">
      <div class="simulation-output-strip">${renderOutputs(row.outputs)}</div>
      <div class="simulation-material-strip">${renderMaterials(row.materials)}</div>
    </section>
  `;
}
```

- [ ] **Step 4: Wire interactions**

Support:
- create preset from selected target item
- switch active preset from the dropdown
- edit any left-side output card absolute wear
- re-resolve the active preset after each valid driver edit
- keep material cards locked and non-editable

- [ ] **Step 5: Run the focused frontend verification**

Run:
- `node tests/tradeupSimulationUi.test.js`
- `node node_sidecar/tests/tradeup-simulation-page-state.test.js`

Expected: PASS

- [ ] **Step 6: Record the frontend checkpoint without committing**

Summarize the updated UI files and passing focused tests, but keep all changes uncommitted until the user explicitly requests a commit.

## Chunk 5: Final Verification And Manual UI Check

### Task 12: Run the complete focused verification set

**Files:**
- Modify: none

- [ ] **Step 1: Run all focused automated checks**

Run:
- `node tests/tradeupSimulationCatalog.test.js`
- `node tests/tradeupSimulationService.test.js`
- `node node_sidecar/tests/tradeup-simulation-route.test.js`
- `node tests/tradeupSimulationUi.test.js`
- `node node_sidecar/tests/tradeup-simulation-page-state.test.js`

Expected:
- all commands exit `0`
- search, resolve, route, preset storage, and page state contracts all pass

- [ ] **Step 2: Run adjacent regression checks**

Run:
- `node tests/craftOutcomePredictor.test.js`
- `node node_sidecar/tests/craft-outcome-predictor-route.test.js`
- `node tests/inventoryCraftStyleScope.test.js`

Expected:
- existing craft predictor and shared page styling still pass

- [ ] **Step 3: Manually verify the approved UX**

In the running app, confirm:
- nav contains `汰换模拟`
- top dropdown switches saved samples in-place
- `新增配方` creates a new sample from a picked output item
- the large main card follows the active sample
- a collection row shows outputs on the left and materials on the right
- desktop width keeps the material cards on one row when space allows
- editing any left-side output absolute wear updates the entire row
- material cards show absolute wear, matching wear tier, and lock state

- [ ] **Step 4: Summarize residual risks before merge**

Record any non-blocking follow-ups, especially:
- anchor UX still being phase-one basic compared with future expansion
- narrow-width fallback density if a collection contains many cards
- whether future export-to-craft flow should reuse or replace the saved sample shape
