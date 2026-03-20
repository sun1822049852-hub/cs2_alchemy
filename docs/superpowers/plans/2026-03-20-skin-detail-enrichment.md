# Skin Detail Enrichment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `rebuildSkinDb` so it first imports base skin rows from `info`, then immediately enriches missing `collection` / `rarity` fields from detail APIs while keeping `csgo_skins.db` as the only valid database target in this repo.

**Architecture:** Keep `skinDbSync` as the base-import authority and run detail enrichment after the base transaction commits. Add a dedicated enrichment service that groups missing rows by family, selects one representative `buffid` per family, calls a BUFF detail provider, writes family-wide updates plus detail-status metadata, and recalculates affected `alchemy_type` values.

**Tech Stack:** Node.js CommonJS, `node:sqlite`, built-in `fetch`, `AbortController`, existing `node:assert/strict` tests, current `tools/rebuildSkinDb.js` entrypoint.

---

## File Map

- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/skinDbSync.js`
  - Keep base import flow, add detail-status schema support, call enrichment after base commit, print merged stats.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/skinFamilyKey.js`
  - Shared family-key normalization used by base metadata reuse and detail enrichment.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/buffSkinDetailProvider.js`
  - BUFF two-step detail lookup with timeout, retry, and normalized output.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/skinDetailEnrichmentService.js`
  - Missing-row scan, family grouping, representative selection, concurrency control, status updates, family-wide writeback, affected `alchemy_type` recalculation.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tools/rebuildSkinDb.js`
  - Keep command contract intact, surface enrichment stats after base import.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDbSync.test.js`
  - Extend end-to-end sync coverage for two-stage import.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/buffSkinDetailProvider.test.js`
  - Provider-only parsing, timeout, and retry tests using stubbed `fetch`.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDetailEnrichmentService.test.js`
  - Family grouping, representative selection, success/failure state transitions, no-rollback behavior.

## Chunk 1: Lock Database And Family-Key Rules With Tests

### Task 1: Add failing tests for detail-status schema expectations

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDbSync.test.js`
- Reference: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/skinDbSync.js`

- [ ] **Step 1: Add a failing test that creates a temporary `skin` table without detail columns and asserts sync adds them**

```js
const cols = verify.prepare("PRAGMA table_info(skin)").all().map((row) => row.name);
assert(cols.includes("detail_status"));
assert(cols.includes("detail_source"));
assert(cols.includes("detail_checked_at"));
assert(cols.includes("detail_error"));
assert(cols.includes("detail_attempts"));
```

- [ ] **Step 2: Add assertions that the repo database name is driven by the provided `dbPath`, not hardcoded `steam_skins.db`**

```js
syncSkinDb({dbPath, items: []});
assert(fs.existsSync(dbPath));
assert.equal(fs.existsSync(path.join(tempDir, "steam_skins.db")), false);
```

- [ ] **Step 3: Run the focused test file to verify it fails because detail columns are not created yet**

Run: `node ".\\tests\\skinDbSync.test.js"`
Expected: FAIL with missing `detail_status` / related columns

### Task 2: Add failing tests for shared family-key behavior

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDetailEnrichmentService.test.js`
- Reference: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/skinDbSync.js`

- [ ] **Step 1: Write a failing test that groups normal and `StatTrak` variants into the same family**

```js
assert.equal(
  buildSkinFamilyKey("★ Butterfly Knife | Blue Steel"),
  buildSkinFamilyKey("★ StatTrak™ Butterfly Knife | Blue Steel")
);
```

- [ ] **Step 2: Write a failing test that different wear variants still map to the same family**

```js
assert.equal(
  buildSkinFamilyKey("AWP | Doodle Lore"),
  buildSkinFamilyKey("AWP | Doodle Lore")
);
```

- [ ] **Step 3: Run the new test file to verify it fails because the shared helper does not exist yet**

Run: `node ".\\tests\\skinDetailEnrichmentService.test.js"`
Expected: FAIL with module-not-found or missing export for family-key helper

## Chunk 2: Extract Shared Family-Key Logic

### Task 3: Move family normalization into a reusable helper

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/skinFamilyKey.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/skinDbSync.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDetailEnrichmentService.test.js`

- [ ] **Step 1: Create the helper with the current `StatTrak`/star-prefix normalization logic**

```js
function buildSkinFamilyKey(text) {
  // move current normalizeSkinFamily logic here
}
```

- [ ] **Step 2: Rewire `skinDbSync.js` to use the new helper for metadata reuse buckets**

- [ ] **Step 3: Run the family-key tests and ensure they pass**

Run: `node ".\\tests\\skinDetailEnrichmentService.test.js"`
Expected: PASS for family-key assertions, remaining enrichment tests still absent or failing

- [ ] **Step 4: Run `node --check` on touched files**

Run: `node --check node_sidecar/src/services/skinFamilyKey.js`
Expected: PASS

Run: `node --check node_sidecar/src/skinDbSync.js`
Expected: PASS

## Chunk 3: Add Detail-Status Schema Support To Base Sync

### Task 4: Extend schema migration and base row defaults

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/skinDbSync.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDbSync.test.js`

- [ ] **Step 1: Write a failing test asserting rows with reused metadata become `detail_status = 'ok'`**

```js
const row = verify.prepare("SELECT detail_status FROM skin WHERE markethashname = ?").get(name);
assert.equal(row.detail_status, "ok");
```

- [ ] **Step 2: Write a failing test asserting rows still missing metadata become `pending` or `failed` based on supported platform IDs**

```js
assert.equal(missingWithBuff.detail_status, "pending");
assert.equal(missingWithoutIds.detail_status, "failed");
assert.equal(missingWithoutIds.detail_error, "no_supported_platform_id");
```

- [ ] **Step 3: Implement a schema helper that adds the five detail columns if absent**

```js
function ensureSkinDetailColumns(db) { ... }
```

- [ ] **Step 4: Set base defaults while building target rows**

```js
row.detail_status = hasMetadata ? "ok" : (hasSupportedId ? "pending" : "failed");
```

- [ ] **Step 5: Include the new columns in `INSERT ... ON CONFLICT DO UPDATE`**

- [ ] **Step 6: Re-run the sync tests**

Run: `node ".\\tests\\skinDbSync.test.js"`
Expected: PASS for schema/default-status assertions, FAIL later because enrichment stage not wired yet

## Chunk 4: Build The BUFF Detail Provider

### Task 5: Add provider-level failing tests

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/buffSkinDetailProvider.test.js`
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/buffSkinDetailProvider.js`

- [ ] **Step 1: Write a failing success-path test using stubbed `fetch` responses for both BUFF APIs**

```js
assert.deepEqual(result, {
  collection: "Operation Breakout Weapon Case",
  rarity: "Gold",
  detail_source: "buff"
});
```

- [ ] **Step 2: Write failing tests for timeout, empty containers, and target item not found**

```js
await assert.rejects(() => provider.fetchByGoodsId("1"), /timeout/i);
await assert.rejects(() => provider.fetchByGoodsId("1"), /containers/i);
await assert.rejects(() => provider.fetchByGoodsId("1"), /not found/i);
```

- [ ] **Step 3: Run the provider test file to verify it fails because the provider does not exist yet**

Run: `node ".\\tests\\buffSkinDetailProvider.test.js"`
Expected: FAIL with module-not-found or missing method errors

### Task 6: Implement the BUFF provider with timeout and one retry

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/buffSkinDetailProvider.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/buffSkinDetailProvider.test.js`

- [ ] **Step 1: Add `fetchByGoodsId(goodsId)` with injected `fetchImpl` for tests**

```js
function createBuffSkinDetailProvider({fetchImpl = fetch, logger = null, timeoutMs = 12000} = {}) { ... }
```

- [ ] **Step 2: Call `csgo_goods_containers` first and select API/display containers following the proven Python logic**

- [ ] **Step 3: Call `csgo_container`, find the target `goods_id`, and normalize `{collection, rarity, detail_source}`**

- [ ] **Step 4: Add timeout handling and a single retry for timeout/5xx failures**

- [ ] **Step 5: Run provider tests**

Run: `node ".\\tests\\buffSkinDetailProvider.test.js"`
Expected: PASS

- [ ] **Step 6: Run syntax check**

Run: `node --check node_sidecar/src/services/buffSkinDetailProvider.js`
Expected: PASS

## Chunk 5: Build The Detail Enrichment Service

### Task 7: Add failing service tests for family-level enrichment

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDetailEnrichmentService.test.js`
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/skinDetailEnrichmentService.js`

- [ ] **Step 1: Add a failing test that scans pending rows, chooses one representative `buffid`, and writes back the whole family**

```js
assert.equal(providerCalls.length, 1);
assert.equal(updatedRows.every((row) => row.collection === "Gallery Case"), true);
```

- [ ] **Step 2: Add a failing test that marks an entire family `failed` when the provider rejects**

```js
assert.equal(rows.every((row) => row.detail_status === "failed"), true);
```

- [ ] **Step 3: Add a failing test proving rows with `detail_status = ok` are skipped**

```js
assert.equal(providerCalls.length, 0);
```

- [ ] **Step 4: Run the service test file and verify it fails because the service is not implemented**

Run: `node ".\\tests\\skinDetailEnrichmentService.test.js"`
Expected: FAIL with module-not-found or missing export errors

### Task 8: Implement enrichment orchestration and family writeback

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/skinDetailEnrichmentService.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDetailEnrichmentService.test.js`

- [ ] **Step 1: Add a loader that reads `pending` families from the current `dbPath`**

```js
SELECT markethashname, basemarkethashname, buffid, collection, rarity, detail_status
FROM skin
WHERE detail_status = 'pending'
```

- [ ] **Step 2: Group rows by shared family key and choose a single representative `buffid`**

- [ ] **Step 3: Run provider requests with fixed concurrency `2`**

- [ ] **Step 4: On success, batch-update the whole family's missing rows and clear errors**

- [ ] **Step 5: On failure, mark the whole family `failed` and persist the summarized error**

- [ ] **Step 6: Return summary stats**

```js
{
  families_pending,
  families_ok,
  families_failed,
  rows_filled,
  rows_still_missing,
  rows_no_supported_platform
}
```

- [ ] **Step 7: Run service tests**

Run: `node ".\\tests\\skinDetailEnrichmentService.test.js"`
Expected: PASS

- [ ] **Step 8: Run syntax check**

Run: `node --check node_sidecar/src/services/skinDetailEnrichmentService.js`
Expected: PASS

## Chunk 6: Recalculate Affected Alchemy Types

### Task 9: Add failing tests for partial `alchemy_type` recalculation

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDetailEnrichmentService.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/skinDbSync.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/skinDetailEnrichmentService.js`

- [ ] **Step 1: Add a failing test showing a row becomes craftable after enrichment fills `collection` and `rarity`**

```js
assert.equal(row.alchemy_type, "10合1");
```

- [ ] **Step 2: Run the service test file to verify it fails because enriched rows do not recalculate `alchemy_type` yet**

Run: `node ".\\tests\\skinDetailEnrichmentService.test.js"`
Expected: FAIL with stale `alchemy_type`

### Task 10: Extract or expose targeted alchemy-type recalculation

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/skinDbSync.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/skinDetailEnrichmentService.js`

- [ ] **Step 1: Extract the existing `assignAlchemyTypes`/metadata shaping into a reusable helper for subsets of rows**

- [ ] **Step 2: Recompute only the affected families after successful enrichment**

- [ ] **Step 3: Re-run service tests**

Run: `node ".\\tests\\skinDetailEnrichmentService.test.js"`
Expected: PASS

## Chunk 7: Wire Enrichment Into Base Sync And CLI Output

### Task 11: Add failing end-to-end sync tests for two-stage import

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDbSync.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/skinDbSync.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tools/rebuildSkinDb.js`

- [ ] **Step 1: Add a failing sync test that injects a fake provider and asserts enrichment runs after base commit**

```js
assert.equal(result.detailStats.families_ok, 1);
assert.equal(finalRow.collection, "Gallery Case");
```

- [ ] **Step 2: Add a failing sync test that confirms base rows persist even when enrichment fails**

```js
assert.equal(finalRow.markethashname, targetName);
assert.equal(finalRow.detail_status, "failed");
```

- [ ] **Step 3: Run the sync test file and verify it fails because enrichment is not yet wired into `syncSkinDb`**

Run: `node ".\\tests\\skinDbSync.test.js"`
Expected: FAIL on missing `detailStats` or unchanged rows

### Task 12: Wire enrichment after base transaction commit

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/skinDbSync.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tools/rebuildSkinDb.js`

- [ ] **Step 1: Inject the enrichment service into `syncSkinDb` with sensible defaults**

```js
async function syncSkinDb({dbPath, items, rarityOrder, detailProvider, logger} = {}) { ... }
```

- [ ] **Step 2: Run base import transaction exactly as today, commit it, then call enrichment**

- [ ] **Step 3: Merge base stats and detail-enrichment stats into the return payload**

- [ ] **Step 4: Update `tools/rebuildSkinDb.js` to print the new detail stats**

- [ ] **Step 5: Re-run the sync tests**

Run: `node ".\\tests\\skinDbSync.test.js"`
Expected: PASS

## Chunk 8: Full Verification

### Task 13: Run the full regression set

**Files:**
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDbSync.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDetailEnrichmentService.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/buffSkinDetailProvider.test.js`

- [ ] **Step 1: Run the provider tests**

Run: `node ".\\tests\\buffSkinDetailProvider.test.js"`
Expected: PASS

- [ ] **Step 2: Run the enrichment service tests**

Run: `node ".\\tests\\skinDetailEnrichmentService.test.js"`
Expected: PASS

- [ ] **Step 3: Run the full sync tests**

Run: `node ".\\tests\\skinDbSync.test.js"`
Expected: PASS

- [ ] **Step 4: Run syntax checks on all changed runtime files**

Run: `node --check node_sidecar/src/skinDbSync.js`
Expected: PASS

Run: `node --check node_sidecar/src/services/skinFamilyKey.js`
Expected: PASS

Run: `node --check node_sidecar/src/services/buffSkinDetailProvider.js`
Expected: PASS

Run: `node --check node_sidecar/src/services/skinDetailEnrichmentService.js`
Expected: PASS

Run: `node --check tools/rebuildSkinDb.js`
Expected: PASS

## Notes

- Never hardcode `steam_skins.db` anywhere in the implementation or tests.
- All runtime and test paths must flow from the current repo's `dbPath` or current default `csgo_skins.db`.
- Keep network enrichment best-effort: base import success must not be rolled back by enrichment failure.
- First implementation only needs BUFF provider support, but the service API should allow later provider expansion.

Plan complete and saved to `docs/superpowers/plans/2026-03-20-skin-detail-enrichment.md`. Ready to execute?
