# Yellow Shield Cooldown Rule Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split yellow-shield blocked items from normal Steam market cooldown items so component deposit and craft flows follow the latest verified raw GC rules.

**Architecture:** Add one parser-level yellow-shield classification derived from raw item attrs, then reuse that single field in UI selection, component deposit rules, craft candidate filtering, craft assist filtering, and craft execution guards. Keep normal `tradable_after` cooldown logic intact for items that are not yellow-shield blocked.

**Tech Stack:** Node.js CommonJS, existing snapshot parser/services, `node`-executed test scripts

---

## Chunk 1: Parser Rule

### Task 1: Add failing parser and service tests

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-component-selection-ui.test.js`
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/yellow-shield-rules.test.js`

- [ ] Write failing tests for `attr#312` yellow-shield classification and plain `attr#75` cooldown classification.
- [ ] Run `node node_sidecar/tests/yellow-shield-rules.test.js` and verify it fails for the missing rule.

### Task 2: Implement parser classification

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/inventoryParser.js`

- [ ] Add parser helpers that classify `flags=24`, `attr#277`, and `attr#312` as yellow-shield blocked.
- [ ] Write row-level fields such as `trade_lock_kind` and `yellow_shield_blocked` in parsed items.
- [ ] Re-run `node node_sidecar/tests/yellow-shield-rules.test.js` and verify the parser assertions pass.

## Chunk 2: Deposit And Candidate Filtering

### Task 3: Add failing selection and candidate tests

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-component-selection-ui.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/yellow-shield-rules.test.js`

- [ ] Add failing tests showing yellow-shield rows are not selectable on the main page.
- [ ] Add failing tests showing normal cooldown rows remain selectable and craft-visible when `includeCooling=true`.

### Task 4: Implement UI and service filtering

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/componentOpsService.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftCandidateService.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistService.js`

- [ ] Change component deposit selection to reject only yellow-shield blocked rows.
- [ ] Change component deposit backend rule to reject only yellow-shield blocked rows.
- [ ] Change craft candidate and craft assist filters so yellow-shield rows never appear, while normal cooldown rows still follow `includeCooling`.
- [ ] Run `node node_sidecar/tests/craft-component-selection-ui.test.js` and `node node_sidecar/tests/yellow-shield-rules.test.js`.

## Chunk 3: Execution Guard

### Task 5: Add failing craft execution guard test

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/yellow-shield-rules.test.js`

- [ ] Add a failing test showing `allowCooling=true` still rejects yellow-shield items but accepts normal cooldown items.

### Task 6: Implement craft execution guard

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftService.js`

- [ ] Add a yellow-shield-specific guard ahead of the normal cooldown guard.
- [ ] Re-run `node node_sidecar/tests/yellow-shield-rules.test.js`.

## Chunk 4: Verification

### Task 7: Run focused regression

**Files:**
- Reference: `C:/Users/18220/Desktop/cs2_alchemy/logs/raw_inventory/inventory_raw_20260328_182142.json`
- Reference: `C:/Users/18220/Desktop/cs2_alchemy/logs/processed_inventory/inventory_processed_20260328_182142.json`

- [ ] Run:
  - `node node_sidecar/tests/yellow-shield-rules.test.js`
  - `node node_sidecar/tests/craft-component-selection-ui.test.js`
  - `node node_sidecar/tests/craft-component-reconcile.test.js`
  - `node node_sidecar/tests/craft-plain-route-guard.test.js`
- [ ] Confirm the verified raw rule remains documented in the new spec and plan.
