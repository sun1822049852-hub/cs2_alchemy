# Skin Wear HTML Main Source Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace BUFF wear-range enrichment’s primary source with goods-page HTML `paintwear_choices`, keep `paintwear_rank` as a guarded fallback/calibration source, and preserve the existing family-level DB writeback contract.

**Architecture:** Keep the current `skinDetailEnrichmentService -> provider -> DB writeback` boundary. Concentrate the behavior change inside `buffSkinDetailProvider.js`: one-hop family discovery from the seed goods page, filter raw related goods by the seed page’s `StatTrak` track, then sample at most five same-track member pages. Parse `paintwear_choices` only from `filter_data_selling`, keep strict rank completeness rules, and emit warning logs for mismatches or expansions. `skinDetailEnrichmentService.js` should only pass family context needed for logging and continue writing one final range per family.

**Tech Stack:** Node.js CommonJS, built-in `fetch`, `node:sqlite`, existing BUFF provider/service modules, plain Node test files.

---

## Spec Reference

- Spec: `C:/Users/18220/Desktop/cs2_alchemy/docs/superpowers/specs/2026-03-21-skin-wear-html-main-source-design.md`

## File Structure

### Files To Modify

- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/buffSkinDetailProvider.js`
  - Own the new HTML parsing helpers, one-hop family discovery, fixed family-page sampling, rank merge rules, and provider-side `warn` logs.
- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/skinDetailEnrichmentService.js`
  - Keep family batching and DB updates unchanged except for passing family context into the wear provider and preserving existing success/failure accounting.
- `C:/Users/18220/Desktop/cs2_alchemy/tests/buffSkinDetailProvider.test.js`
  - Add provider-level regression tests for HTML parsing, page fan-out limits, rank completeness, `0~1` bypass, and warning emission.
- `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDetailEnrichmentService.test.js`
  - Add regression coverage proving family-level writeback still happens once per family with the updated provider contract.

### Files Expected To Stay Unchanged

- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/skinDbSync.js`
  - No schema or orchestration changes are planned for this feature.
- `C:/Users/18220/Desktop/cs2_alchemy/tools/rebuildSkinDb.js`
  - CLI output shape should stay as-is; this feature changes only the underlying wear lookup behavior.

---

## Chunk 1: Lock The New Provider Behavior With Failing Tests

### Task 1: Add failing tests for one-hop family discovery, `StatTrak` filtering, and fixed page fan-out

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/buffSkinDetailProvider.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/buffSkinDetailProvider.js`

- [ ] **Step 1: Add a failing test where the seed goods page returns six raw related ids, with one `StatTrak` mirror member, expecting the provider to keep only the five same-track members for wear-range aggregation**
- [ ] **Step 2: Add a failing test where member pages repeat the same family ids, expecting the provider not to fetch any extra pages beyond the original raw candidate set and the filtered five-page aggregation set**
- [ ] **Step 3: Run `node .\\tests\\buffSkinDetailProvider.test.js`**
  - Expected: `FAIL` because `fetchWearRangeByGoodsId()` still calls `/api/market/paintwear_rank` directly and does not parse goods-page HTML yet

### Task 2: Implement seed-page family discovery and HTML range summarization

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/buffSkinDetailProvider.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/buffSkinDetailProvider.test.js`

- [ ] **Step 1: Add `extractRelativeGoodsIdsFromGoodsPageHtml(html)` to parse repeated `relative_goods_ids.push("...")` entries into a unique ordered goods-id list**
- [ ] **Step 2: Add `extractPaintwearChoicesFromGoodsPageHtml(html)` to parse `paintwear_choices` specifically from `var filter_data_selling = { ... }`, not from template fragments earlier in the HTML**
- [ ] **Step 3: Add `summarizePaintwearChoices(choices)` to validate bucket values and return `pageMin/pageMax`**
- [ ] **Step 4: Replace direct rank-only wear lookup with goods-page fetching that:**
  - reads the seed page once
  - builds a raw candidate set from `seed + relative_goods_ids`
  - filters candidates by the seed page’s `StatTrak` track
  - caps the filtered same-track family set at five members
  - keeps family-page sampling low-frequency and serial enough to respect observed BUFF `429` behavior
  - visits each member page at most once
  - merges successful page summaries into `main_min/main_max`
- [ ] **Step 5: Re-run `node .\\tests\\buffSkinDetailProvider.test.js`**
  - Expected: the new fan-out tests pass, while rank-merge tests still fail because guarded rank logic has not been updated yet

### Task 3: Commit Chunk 1

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/buffSkinDetailProvider.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/buffSkinDetailProvider.js`

- [ ] **Step 1: Run `git diff -- node_sidecar/src/services/buffSkinDetailProvider.js tests/buffSkinDetailProvider.test.js` and verify only HTML-main-source work is included**
- [ ] **Step 2: Commit with `git commit -m "test: lock html wear main-source behavior"`**

---

## Chunk 2: Add Rank Completeness Rules And Warning Logs

### Task 4: Add failing tests for strict rank completeness, `0~1` bypass, and warning emission

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/buffSkinDetailProvider.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/buffSkinDetailProvider.js`

- [ ] **Step 1: Add a failing test where the main HTML range is already `0~1`, expecting success even if one member’s `paintwear_rank` call fails**
- [ ] **Step 2: Add a failing test where the main HTML range is not `0~1` and one member’s `paintwear_rank` call fails, expecting the provider to ignore rank expansion and keep the main range**
- [ ] **Step 3: Add a failing test where complete rank data expands one side of the main range, expecting the provider to return the widened interval and emit `warn=range_expanded`**
- [ ] **Step 4: Add failing log-capture tests for `warn=family_size_exceeded`, `warn=family_goods_mismatch`, and `warn=rank_incomplete`, including the raw-candidate-vs-filtered-member fields introduced by `StatTrak` filtering**
- [ ] **Step 5: Run `node .\\tests\\buffSkinDetailProvider.test.js`**
  - Expected: `FAIL` because the provider does not yet implement the new merge rules or warning logs

### Task 5: Implement guarded rank merge logic in the provider

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/buffSkinDetailProvider.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/buffSkinDetailProvider.test.js`

- [ ] **Step 1: Add a provider-internal helper to fetch a single member’s min/max rank pair and normalize it to rounded floats**
- [ ] **Step 2: Add a helper to evaluate whether the current effective range is already full `0~1` and therefore eligible for the bypass**
- [ ] **Step 3: Update `fetchWearRangeByGoodsId(goodsId, options = {})` so it can accept `familyKey` for log context without changing the final returned wear payload shape**
- [ ] **Step 4: Implement the merge rules exactly as specified:**
  - HTML main-source first
  - raw `relative_goods_ids` may contain one extra `StatTrak` mirror and must be same-track filtered before the family-size cap is applied
  - full-family rank required unless the current effective range is already `0~1`
  - partial rank success must not be merged
  - final range expands outward only
- [ ] **Step 5: Emit provider-side `warn` logs with the agreed `key=value` fields for size overflow, family mismatch, incomplete rank, full-range bypass, and outward expansion**
- [ ] **Step 6: Re-run `node .\\tests\\buffSkinDetailProvider.test.js`**
  - Expected: `PASS` with `buffSkinDetailProvider tests passed`

### Task 6: Commit Chunk 2

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/buffSkinDetailProvider.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/buffSkinDetailProvider.test.js`

- [ ] **Step 1: Run `node --check node_sidecar\\src\\services\\buffSkinDetailProvider.js`**
  - Expected: no output, exit code `0`
- [ ] **Step 2: Commit with `git commit -m "feat: use html main source for skin wear ranges"`**

---

## Chunk 3: Wire Family Context Through The Enrichment Service

### Task 7: Add a failing service regression test for family-context forwarding

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDetailEnrichmentService.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/skinDetailEnrichmentService.js`

- [ ] **Step 1: Add a failing test that captures provider calls during wear enrichment and expects one call per pending family with `goodsId` equal to the representative member and `familyKey` equal to the service’s family grouping key**
- [ ] **Step 2: Keep the assertion that successful wear info still writes back to every row in the family exactly once**
- [ ] **Step 3: Run `node .\\tests\\skinDetailEnrichmentService.test.js`**
  - Expected: `FAIL` because the service currently calls `fetchWearRangeByGoodsId(goodsId)` without family context

### Task 8: Update the service call site without changing DB semantics

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/skinDetailEnrichmentService.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDetailEnrichmentService.test.js`

- [ ] **Step 1: Pass `familyKey` into `provider.fetchWearRangeByGoodsId(representativeGoodsId, {familyKey})`**
- [ ] **Step 2: Preserve the existing `hasCompleteWearInfo()` short-circuit so families that already have complete wear info are not re-fetched**
- [ ] **Step 3: Preserve existing summary accounting for `wear_rows_pending`, `wear_rows_ok`, `wear_rows_failed`, and `wear_rows_still_missing`**
- [ ] **Step 4: Re-run `node .\\tests\\skinDetailEnrichmentService.test.js`**
  - Expected: `PASS` with `skinDetailEnrichmentService tests passed`

### Task 9: Commit Chunk 3

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/skinDetailEnrichmentService.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDetailEnrichmentService.test.js`

- [ ] **Step 1: Run `node --check node_sidecar\\src\\services\\skinDetailEnrichmentService.js`**
  - Expected: no output, exit code `0`
- [ ] **Step 2: Commit with `git commit -m "refactor: pass wear family context to provider"`**

---

## Chunk 4: Full Regression And Real-Data Verification

### Task 10: Run the automated regression set

**Files:**
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/buffSkinDetailProvider.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDetailEnrichmentService.test.js`

- [ ] **Step 1: Run `node .\\tests\\buffSkinDetailProvider.test.js`**
  - Expected: `buffSkinDetailProvider tests passed`
- [ ] **Step 2: Run `node .\\tests\\skinDetailEnrichmentService.test.js`**
  - Expected: `skinDetailEnrichmentService tests passed`
- [ ] **Step 3: Run `node --check node_sidecar\\src\\services\\buffSkinDetailProvider.js`**
  - Expected: no output, exit code `0`
- [ ] **Step 4: Run `node --check node_sidecar\\src\\services\\skinDetailEnrichmentService.js`**
  - Expected: no output, exit code `0`

### Task 11: Run the real-data rebuild smoke test

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/csgo_skins.db`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tools/rebuildSkinDb.js`

- [ ] **Step 1: Run `node .\\tools\\rebuildSkinDb.js --db .\\csgo_skins.db --json C:\\Users\\18220\\Desktop\\smelter\\data\\steam_base_info_20260315_232059.json`**
  - Expected: command completes without crashing, prints wear-enrichment stats, and creates a backup DB file before rebuild
- [ ] **Step 2: Inspect the console warnings and confirm they are limited to the designed cases such as `rank_incomplete`, `range_expanded`, `family_goods_mismatch`, or `family_size_exceeded`**
- [ ] **Step 3: Spot-check a previously problematic family in the rebuilt DB or logs to confirm the final range no longer depends solely on partial `paintwear_rank` data**
  - Suggested checks:
  - `★ Bayonet | Doppler` should still produce a valid main-source interval even when `paintwear_rank` max-side is empty
  - `AWP | Exoskeleton` should ignore the extra `StatTrak` mirror member and aggregate only the five same-track wear pages

### Task 12: Final commit

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/buffSkinDetailProvider.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/skinDetailEnrichmentService.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/buffSkinDetailProvider.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDetailEnrichmentService.test.js`

- [ ] **Step 1: Run `git status --short` and verify only intended wear-main-source files plus expected DB artifacts are present**
- [ ] **Step 2: Commit with `git commit -m "feat: use html wear source for skin db enrichment"`**

Plan complete and saved to `docs/superpowers/plans/2026-03-21-skin-wear-html-main-source.md`. Ready to execute.
