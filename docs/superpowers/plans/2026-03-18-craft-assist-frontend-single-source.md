# Craft Assist Frontend Single Source Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the dead mirrored craft-assist solver from the frontend so the backend is the only source of truth for material selection.

**Architecture:** Keep `node_sidecar/src/services/craftAssistService.js` and `/api/craft/assist-select` unchanged as the selection authority. Trim `node_sidecar/ui/app.js` down to configuration normalization, request assembly, result application, and status/log rendering. Add a small static regression test that fails if the frontend solver entry points come back.

**Tech Stack:** Node.js CommonJS, plain JavaScript, `node:assert/strict`, existing browser-side `app.js`

---

> Repo instruction note: do not add git commit steps unless the user explicitly asks. This plan intentionally omits commit tasks.

## File Map

- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`
  - Delete the local craft-assist solver helpers and keep only UI + API orchestration.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/uiCraftAssistSingleSource.test.js`
  - Static guard that blocks reintroduction of frontend solver entry points.
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`
  - Existing backend regression tests that must stay green.
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/docs/superpowers/specs/2026-03-18-craft-assist-frontend-single-source-design.md`
  - Approved scope and acceptance criteria.

## Chunk 1: Lock The Single-Source Boundary

### Task 1: Add a failing static test for forbidden frontend solver symbols

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/uiCraftAssistSingleSource.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/uiCraftAssistSingleSource.test.js`

- [ ] **Step 1: Write a Node test that reads `app.js` as UTF-8 and checks for forbidden solver entry points**

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const source = fs.readFileSync(appPath, "utf8");

const forbiddenSymbols = [
  "function runCraftAssistSelectionForRecipe(",
  "function applyCraftAssistDeficitCorrection(",
  "function applyCraftAssistOverflowCorrection(",
  "function applyCraftAssistOffsetWindowCorrection(",
  "function solveCraftAssistMinCostAssignmentForRarity(",
  "function findCraftAssistFallbackBelowTargetSolution(",
  "function pickCraftAssistBySplit("
];

for (const symbol of forbiddenSymbols) {
  assert.equal(
    source.includes(symbol),
    false,
    `frontend should not keep mirrored craft-assist solver symbol: ${symbol}`
  );
}

assert.equal(
  source.includes('api("/api/craft/assist-select"'),
  true,
  "frontend must still call backend craft assist API"
);

console.log("uiCraftAssistSingleSource tests passed");
```

- [ ] **Step 2: Run the new test and verify it fails before any production edit**

Run: `node "./tests/uiCraftAssistSingleSource.test.js"`

Expected: fail because `app.js` still contains the mirrored solver function names.

## Chunk 2: Remove The Mirrored Frontend Solver

### Task 2: Delete the local solver chain from `app.js`

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/uiCraftAssistSingleSource.test.js`

- [ ] **Step 1: Identify the full solver-only block and its private helpers**

Target the contiguous block that starts near:

```js
function craftAssistRelativeValueOfRow(row) {
```

and runs through:

```js
function runCraftAssistSelectionForRecipe({materials, rowsByName, blockedIds, targetValue}) {
```

Delete only the functions that are exclusively used by the local solver path.

- [ ] **Step 2: Preserve UI-side functions still needed after cleanup**

Keep functions and logic related to:

```js
normalizeCraftAssistMaterialsForRun();
applyCraftAssistAutoSelection(...);
logCraftAssistPickedRows(...);
buildRowsByAssetId(...);
getCraftCandidates(...);
```

The request body and result-handling flow must remain intact.

- [ ] **Step 3: Remove any now-dead local helper references created by the deletion**

Search for leftover calls or identifiers from the deleted block and remove them if they are no longer reachable.

Run: `rg -n "runCraftAssistSelectionForRecipe|applyCraftAssistDeficitCorrection|applyCraftAssistOverflowCorrection|applyCraftAssistOffsetWindowCorrection|solveCraftAssistMinCostAssignmentForRarity|findCraftAssistFallbackBelowTargetSolution|pickCraftAssistBySplit" "node_sidecar/ui/app.js"`

Expected: no matches.

## Chunk 3: Verify The Main Flow Still Works

### Task 3: Run focused verification after cleanup

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/uiCraftAssistSingleSource.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`

- [ ] **Step 1: Re-run the new static single-source test**

Run: `node "./tests/uiCraftAssistSingleSource.test.js"`

Expected: `uiCraftAssistSingleSource tests passed`

- [ ] **Step 2: Re-run the backend craft assist regression test**

Run: `node "./tests/craftAssistService.test.js"`

Expected: `craftAssistService tests passed`

- [ ] **Step 3: Do a final source search to prove the frontend now only orchestrates the backend**

Run: `rg -n "assist-select|runCraftAssistSelectionForRecipe|applyCraftAssistDeficitCorrection|applyCraftAssistOverflowCorrection|applyCraftAssistOffsetWindowCorrection|solveCraftAssistMinCostAssignmentForRarity" "node_sidecar/ui/app.js"`

Expected:
- the API call remains
- the forbidden local solver symbols are gone
