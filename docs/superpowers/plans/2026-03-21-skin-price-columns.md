# Skin Price Columns Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-platform price and price-updated-at columns to `skin`, storing prices as integer fen values without breaking rebuild or sync flows.

**Architecture:** Extend the existing `skin` table schema in one place, reuse the current "ensure column exists" migration pattern for older databases, and thread the new fields through sync upsert logic as nullable metadata. Keep all price fields untouched unless explicitly provided.

**Tech Stack:** Node.js, `node:sqlite`, plain JS tests

---

## Chunk 1: Schema And Upsert

### Task 1: Add failing schema coverage

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDbSync.test.js`

- [ ] **Step 1: Write a failing test**
  - Add a test that runs `syncSkinDb()` on a fresh DB and asserts the new columns exist:
    - `buffprice`
    - `c5price`
    - `youpinprice`
    - `buffprice_updated_at`
    - `c5price_updated_at`
    - `youpinprice_updated_at`
  - Also assert a newly imported row keeps those values as `NULL`.

- [ ] **Step 2: Run the targeted test to verify it fails**
  - Run: `node .\tests\skinDbSync.test.js`
  - Expected: failure because the new columns do not exist yet.

### Task 2: Implement schema support

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/skinDbSync.js`

- [ ] **Step 1: Extend create-table SQL**
  - Add the six new columns to `ensureSkinTable()`.

- [ ] **Step 2: Extend additive migration logic**
  - Update the existing column-ensure path so older DBs get the six columns with `ALTER TABLE`.

- [ ] **Step 3: Thread new nullable fields through metadata loading and upsert**
  - Include the new fields when reading existing metadata.
  - Preserve existing values on reuse.
  - Include the new fields in the `INSERT ... ON CONFLICT DO UPDATE` statement and bound parameters.

- [ ] **Step 4: Re-run the targeted test**
  - Run: `node .\tests\skinDbSync.test.js`
  - Expected: `skinDbSync tests passed`

## Chunk 2: Test Fixtures

### Task 3: Keep test fixture schemas aligned

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/fillMissingSkinImages.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDetailEnrichmentService.test.js`

- [ ] **Step 1: Update temporary `skin` table schemas**
  - Add the same six columns to each test helper `CREATE TABLE skin (...)`.

- [ ] **Step 2: Update helper insert statements only as needed**
  - Add nullable placeholders for the new fields so inserts remain explicit and stable.

- [ ] **Step 3: Run the affected tests**
  - Run: `node .\tests\skinDetailEnrichmentService.test.js`
  - Run: `node .\tests\fillMissingSkinImages.test.js`
  - Expected: both test files pass.

## Chunk 3: Final Verification

### Task 4: Verify the full touched surface

**Files:**
- Verify only

- [ ] **Step 1: Re-run all touched tests**
  - Run: `node .\tests\skinDbSync.test.js`
  - Run: `node .\tests\skinDetailEnrichmentService.test.js`
  - Run: `node .\tests\fillMissingSkinImages.test.js`
  - Expected: all pass.

- [ ] **Step 2: Inspect git diff**
  - Run: `git status --short`
  - Run: `git diff -- node_sidecar/src/skinDbSync.js tests/skinDbSync.test.js tests/skinDetailEnrichmentService.test.js tests/fillMissingSkinImages.test.js docs/superpowers/plans/2026-03-21-skin-price-columns.md`
  - Expected: only the intended schema/test/plan changes appear.
