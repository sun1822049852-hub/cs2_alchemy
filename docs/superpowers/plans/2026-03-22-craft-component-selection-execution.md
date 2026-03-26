# Craft Component Selection Execution Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the optional “use component items” craft flow so component-held craftable items can be selected into recipes, are strictly pre-clipped by main-inventory free space, are reconciled against full inventory on reconnect, and are prepared component-by-component before only ready recipes are submitted to trade-up.

**Architecture:** Keep the existing plain-DOM craft page and existing `/api/craft/tradeup` behavior intact for the default path. Extend the frontend queue model with per-item source metadata and pre-check helpers, then add one dedicated backend orchestration service plus one new HTTP endpoint that performs main-space validation, grouped component withdraw, recipe readiness filtering, and final handoff to `craftService.runTradeUpBatch(...)`.

**Tech Stack:** Browser DOM in `node_sidecar/ui/app.js`, plain CSS, Node HTTP server in `node_sidecar/src/uiServer.js`, existing `componentOpsService` and `craftService`, `node:assert/strict` source-extraction tests, service-level Node tests.

---

> Repo instruction note: do not add git commit steps unless the user explicitly asks. This plan intentionally omits commit tasks.

## File Map

- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`
  - Add the new `craftUseComponentItems` preference, full-inventory candidate builders, strict pre-clip budget helpers, queue source metadata, full-inventory reconcile flow, execute-path branching, and queue status rendering.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/styles.css`
  - Add queue status styling for prepare-failed recipes and any compact metadata text styles needed by the new queue state lines.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js`
  - Register the new `/api/craft/tradeup-with-components` endpoint and wire the new orchestration service into the existing UI server bootstrap.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftTradeupWithComponentsService.js`
  - Implement execution orchestration: space gate, grouped component withdraw, per-recipe readiness classification, and final trade-up batch handoff.
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/componentOpsService.js`
  - Reuse the existing component withdraw behavior rather than reimplementing inventory movement.
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftService.js`
  - Reuse `runTradeUpBatch(...)` for ready recipes instead of duplicating trade-up execution.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-component-selection-ui.test.js`
  - Frontend source-extraction tests for full-inventory candidate logic and strict pre-clip hiding rules.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-component-reconcile.test.js`
  - Frontend source-extraction tests for queue item-source reconciliation against full inventory.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftTradeupWithComponentsService.test.js`
  - Service-level tests for space-gate rejection, grouped withdraw ordering, failed-recipe skipping, and partial-ready execution.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/uiCraftAssistSingleSource.test.js`
  - Only if needed to guard the new UI state fields and keep the front-end single-source assumptions explicit.

## Chunk 1: Frontend Preference And Candidate Budget

### Task 1: Lock the full-inventory candidate toggle and strict pre-clip budget with failing tests

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-component-selection-ui.test.js`
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-queue-preview.test.js`

- [ ] **Step 1: Extract the candidate-source helpers from `node_sidecar/ui/app.js` into a source-extraction test harness**

- [ ] **Step 2: Write a failing test that expects component-held craftable rows to appear only when `craftUseComponentItems` is enabled**

```js
assert.deepEqual(
  pickIds(app.getAllInventoryCraftableRows({rows, includeComponentItems: true})),
  ["main-1", "component-1"]
);
```

- [ ] **Step 3: Write a failing test that expects strict pre-clip to hide unselected component rows once selected component count reaches the current main free-slot budget**

```js
assert.equal(app.shouldHideUnselectedComponentCandidate({
  selectedComponentCount: 3,
  mainFreeSlots: 3,
  isSelected: false
}), true);
```

- [ ] **Step 4: Run `node "./node_sidecar/tests/craft-component-selection-ui.test.js"` and verify it fails because the helpers/state do not exist yet**

### Task 2: Add the frontend preference and candidate-budget helpers

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`

- [ ] **Step 1: Add `craftUseComponentItems` to the craft UI state and to the persisted craft UI prefs load/save path**

- [ ] **Step 2: Add a shared helper that returns all craftable rows from main inventory plus optional component items without ever including `Storage Unit` rows**

- [ ] **Step 3: Add a helper that counts selected component-sourced recipe items across all pending recipes plus the active slot**

- [ ] **Step 4: Add a helper that decides whether an unselected component candidate should be hidden once the strict pre-clip budget is exhausted**

- [ ] **Step 5: Update the left-side craft header text builder so it switches between `主库存可炼金物品` and `全库存可炼金物品（组件已选 X / 可用 Y）`**

### Task 3: Wire the new setting into the craft settings UI

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/styles.css` (only if the new checkbox needs a layout tweak)

- [ ] **Step 1: Add the new checkbox node lookups for both craft settings surfaces and keep them mirrored like the cooling toggle**

- [ ] **Step 2: Add the change handler that updates `craftUseComponentItems`, clears stale craft status text, and re-renders the craft page**

- [ ] **Step 3: Update craft list rendering so component candidates can be displayed, annotated with component source text, and hidden by the strict pre-clip helper without affecting main-inventory candidates**

- [ ] **Step 4: Re-run `node "./node_sidecar/tests/craft-component-selection-ui.test.js"` and verify it now passes**

## Chunk 2: Queue Metadata And Full-Inventory Reconcile

### Task 4: Lock queue source metadata and reconnect reconcile with failing tests

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-component-reconcile.test.js`

- [ ] **Step 1: Extract the queue reconcile helpers from `node_sidecar/ui/app.js` into a dedicated source-extraction test**

- [ ] **Step 2: Write a failing test that expects a component-sourced queued item to survive reconnect reconcile when it still exists in component inventory**

```js
assert.deepEqual(entry.item_ids, ["component-1", "main-1"]);
assert.equal(entry.item_sources["component-1"].source_component_id, "box-1");
```

- [ ] **Step 3: Write a failing test that expects a missing item to be removed from the recipe while leaving the recipe entry itself intact and marked as needing refill**

```js
assert.deepEqual(entry.item_ids, ["main-1"]);
assert.equal(entry.removed_missing_count, 1);
```

- [ ] **Step 4: Run `node "./node_sidecar/tests/craft-component-reconcile.test.js"` and verify it fails against the current main-only reconcile logic**

### Task 5: Extend queue entries with per-item source metadata

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`

- [ ] **Step 1: Extend the queue-entry creation/update helpers so every added `item_id` also stores an `item_sources[itemId]` record with `source_scope`, `source_component_id`, and `source_component_name`**

- [ ] **Step 2: Update remove-item flows so removing an item from a recipe also deletes its `item_sources` metadata**

- [ ] **Step 3: Add `prepare_status` and `prepare_message` fields to pending recipe entries, but keep them inert during ordinary manual selection**

### Task 6: Replace main-only reconcile with full-inventory reconcile

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`

- [ ] **Step 1: Replace `reconcileCraftQueueWithInventory()` with a full-inventory variant that validates against main + component craftable rows**

- [ ] **Step 2: Preserve queued items that still exist in components, refresh their `item_sources` when `casket_id` changed, and remove only truly missing ids**

- [ ] **Step 3: Record a lightweight per-entry note such as removed-missing count or `prepare_message` text so the UI can explain why a recipe now has fewer than 10 items**

- [ ] **Step 4: Call the new reconcile flow from the connect/refresh craft render path without changing the current “offline preselect is allowed” behavior**

- [ ] **Step 5: Re-run `node "./node_sidecar/tests/craft-component-reconcile.test.js"` and verify it passes**

### Task 7: Show queued preparation state in the craft queue UI

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/styles.css`

- [ ] **Step 1: Add queue metadata lines for `组件取料：N件待准备`, reconnect reconcile removals, and `组件取出失败，已跳过`**

- [ ] **Step 2: Add a dedicated visual style for `prepare_failed` queue groups so they remain visible and clearly marked without looking like completed recipes**

- [ ] **Step 3: Make sure `getCraftExecutableEntries()` excludes `prepare_failed` recipes and recipes with fewer than 10 items**

## Chunk 3: Backend Orchestrator And Endpoint

### Task 8: Lock the component-aware execution orchestration with failing service tests

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftTradeupWithComponentsService.test.js`
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`

- [ ] **Step 1: Create a service-level test harness with fake `componentOpsService` and fake `craftService` dependencies**

- [ ] **Step 2: Write a failing test that expects execution to reject the whole batch before any withdraw when component-needed items exceed the current main free-slot count**

```js
assert.equal(result.ok, false);
assert.equal(withdrawCalls.length, 0);
assert.equal(tradeupCalls.length, 0);
```

- [ ] **Step 3: Write a failing test that expects grouped component withdraw to run serially in component-id order and to leave failed recipe indexes out of the final trade-up batch**

```js
assert.deepEqual(withdrawCalls.map((x) => x.componentId), ["box-1", "box-2"]);
assert.deepEqual(tradeupCalls[0].recipes.map((x) => x.queue_index), [0, 2]);
```

- [ ] **Step 4: Write a failing test that expects failed component items to remain reported as prepare-failed while successful ready recipes still execute**

- [ ] **Step 5: Run `node "./tests/craftTradeupWithComponentsService.test.js"` and verify it fails because the new service does not exist yet**

### Task 9: Implement the component-aware trade-up orchestration service

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftTradeupWithComponentsService.js`
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/componentOpsService.js`
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftService.js`

- [ ] **Step 1: Create the service factory and inject the dependencies it needs: row loader, component ops, craft service, and logger**

- [ ] **Step 2: Implement the main-space gate that computes current main free slots and counts the unique component-held items still needed by the request**

- [ ] **Step 3: Implement grouped withdraw planning so all needed component items are grouped by component id and processed serially**

- [ ] **Step 4: Implement per-recipe readiness classification so any recipe with a missing or failed component item becomes `prepare_failed` and is excluded from trade-up submission**

- [ ] **Step 5: Hand only ready recipes to `craftService.runTradeUpBatch(...)` and return a combined result payload containing prepare results plus final trade-up results**

- [ ] **Step 6: Re-run `node "./tests/craftTradeupWithComponentsService.test.js"` and verify it passes**

### Task 10: Expose the new endpoint in the UI server

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js`

- [ ] **Step 1: Instantiate the new `craftTradeupWithComponentsService` alongside the existing craft services**

- [ ] **Step 2: Add `POST /api/craft/tradeup-with-components` that validates connection state and forwards the normalized recipe payload to the new service**

- [ ] **Step 3: Keep `/api/craft/tradeup` behavior untouched for the default path**

- [ ] **Step 4: Return enough structured response data for the frontend to map each queue entry to `ready`, `prepare_failed`, or `done`**

## Chunk 4: Frontend Execute Path And End-To-End Guards

### Task 11: Route execution through the new endpoint only when needed

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`

- [ ] **Step 1: Add a helper that detects whether any executable pending recipe currently depends on component-sourced items**

- [ ] **Step 2: Update the execute-button handler so disabled/offline/default behavior stays unchanged, but the component-aware path calls `/api/craft/tradeup-with-components` when the new setting is enabled and component-backed recipes exist**

- [ ] **Step 3: Update the queue-result application logic so `prepare_failed` recipes remain in place, are marked red, and never get removed as if they were successful results**

- [ ] **Step 4: Keep successful recipes flowing through the existing result-apply path so completed rows still show gained items and wear lines**

### Task 12: Add or update lightweight frontend guard tests for the new state fields

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/uiCraftAssistSingleSource.test.js` (only if the new craft UI state fragments need coverage)

- [ ] **Step 1: Add any missing assertions for the new craft UI state fields and execute-path guard fragments**

- [ ] **Step 2: Run `node "./tests/uiCraftAssistSingleSource.test.js"` and verify it still passes with the new craft-page state additions**

## Chunk 5: Verification Gates

### Task 13: Run the focused regression suite

**Files:**
- Test: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-component-selection-ui.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-component-reconcile.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftTradeupWithComponentsService.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/uiCraftAssistSingleSource.test.js`

- [ ] **Step 1: Run the new UI candidate-budget test**

Run: `node "./node_sidecar/tests/craft-component-selection-ui.test.js"`

Expected: PASS

- [ ] **Step 2: Run the new full-inventory reconcile test**

Run: `node "./node_sidecar/tests/craft-component-reconcile.test.js"`

Expected: PASS

- [ ] **Step 3: Run the new backend orchestration service test**

Run: `node "./tests/craftTradeupWithComponentsService.test.js"`

Expected: PASS

- [ ] **Step 4: Re-run the existing frontend single-source guard test**

Run: `node "./tests/uiCraftAssistSingleSource.test.js"`

Expected: PASS

- [ ] **Step 5: Run `node --check "./node_sidecar/ui/app.js"` to verify the edited frontend script parses**

Run: `node --check "./node_sidecar/ui/app.js"`

Expected: PASS

- [ ] **Step 6: Run `node --check "./node_sidecar/src/uiServer.js"` to verify the edited server script parses**

Run: `node --check "./node_sidecar/src/uiServer.js"`

Expected: PASS

- [ ] **Step 7: If the new service is plain CommonJS without special bootstrapping, run `node --check "./node_sidecar/src/services/craftTradeupWithComponentsService.js"`**

Run: `node --check "./node_sidecar/src/services/craftTradeupWithComponentsService.js"`

Expected: PASS

Plan complete and saved to `docs/superpowers/plans/2026-03-22-craft-component-selection-execution.md`. Ready to execute?
