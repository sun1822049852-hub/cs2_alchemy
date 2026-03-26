# Craft Outcome Predictor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a backend-only craft outcome predictor that estimates real-time trade-up outcomes, probabilities, and predicted floats from collection-count recipe templates.

**Architecture:** Add a new read-only predictor service plus a cached catalog loader on top of `csgo_skins.db`, and expose them through a new `POST /api/craft/predict-outcomes` route. Reuse existing collection alias and rarity rules from the skin alchemy layer, aggregate candidate outcomes by base skin, then remap each predicted float back to a concrete wear-tier skin row.

**Tech Stack:** Node.js CommonJS, `node:sqlite` `DatabaseSync`, existing `uiServer` HTTP router, standalone Node test files with `node` execution

---

## File Structure

### New Files

- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftOutcomeCatalog.js`
  - Loads `skin` rows from SQLite
  - Expands merged collections
  - Normalizes collection aliases
  - Builds cached base-outcome and wear-mapping indexes
- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftOutcomePredictor.js`
  - Validates request payload
  - Calculates per-outcome probability
  - Calculates predicted float and wear mapping
  - Returns invalid states and summary payloads
- `C:/Users/18220/Desktop/cs2_alchemy/tests/craftOutcomePredictor.test.js`
  - Service-level tests for catalog loading, invalid states, probability math, float math, wear mapping, and cache refresh
- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-outcome-predictor-route.test.js`
  - Route wiring and HTTP response-shape coverage for `/api/craft/predict-outcomes`

### Modified Files

- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/skinAlchemyRules.js`
  - Export normalized collection helper(s)
  - Export shared rarity-rank helper(s)
- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js`
  - Instantiate predictor service
  - Add `POST /api/craft/predict-outcomes`
  - Return structured invalid/success payloads

### Existing References

- `C:/Users/18220/Desktop/cs2_alchemy/docs/superpowers/specs/2026-03-26-craft-outcome-predictor-design.md`
- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/skinAlchemyRules.js`
- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/skinMetaStore.js`
- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js`
- `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDbSync.test.js`

## Chunk 1: Shared Collection And Rarity Helpers

### Task 1: Expose shared normalization helpers

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/skinAlchemyRules.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftOutcomePredictor.test.js`

- [ ] **Step 1: Write the failing helper test**

```js
assert.equal(normalizeCollectionKey("裂空武器箱"), "Fracture Case");
assert.equal(normalizeRarityRank("军规级"), 3);
assert.equal(normalizeRarityRank("蓝"), 3);
assert.equal(rarityLabelFromRank(4), "受限");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: FAIL with missing export or helper-not-found error.

- [ ] **Step 3: Export minimal shared helpers**

```js
function normalizeRarityRank(value, rarityOrder = []) {
  const orderMap = rarityOrder.length
    ? new Map(rarityOrder.map((name, index) => [asString(name).trim(), index + 1]))
    : DEFAULT_RARITY_RANKS;
  return orderMap.get(asString(value).trim()) || 0;
}

function rarityLabelFromRank(rank, rarityOrder = []) {
  if (rarityOrder.length) return rarityOrder[Number(rank) - 1] || "";
  for (const [label, value] of DEFAULT_RARITY_RANKS.entries()) {
    if (value === Number(rank) && !["白", "浅蓝", "蓝", "紫", "粉", "红", "金", "金色"].includes(label)) {
      return label;
    }
  }
  return "";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: PASS for helper assertions.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/services/skinAlchemyRules.js tests/craftOutcomePredictor.test.js
git commit -m "refactor(craft): export shared collection and rarity helpers"
```

## Chunk 2: Catalog Loader And Cache

### Task 2: Create the base-outcome catalog test scaffold

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftOutcomeCatalog.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftOutcomePredictor.test.js`

- [ ] **Step 1: Write failing SQLite-backed catalog tests**

```js
const catalog = createCraftOutcomeCatalog({dbPath});
const snapshot = catalog.getSnapshot();
assert.equal(snapshot.baseBuckets.has("Fracture Case|4|0"), true);
assert.equal(snapshot.wearMap.get("AK-47 | Ice Coaled").has("Minimal Wear"), true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: FAIL with `createCraftOutcomeCatalog is not a function` or similar.

- [ ] **Step 3: Implement minimal catalog skeleton**

```js
function createCraftOutcomeCatalog({dbPath}) {
  return {
    getSnapshot() {
      return {
        dbPath,
        baseBuckets: new Map(),
        wearMap: new Map()
      };
    }
  };
}
```

- [ ] **Step 4: Run test to verify the failure becomes structural**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: FAIL on missing bucket data, not on missing module export.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/services/craftOutcomeCatalog.js tests/craftOutcomePredictor.test.js
git commit -m "test(craft): scaffold outcome catalog coverage"
```

### Task 3: Build normalized base-outcome and wear-tier indexes

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftOutcomeCatalog.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftOutcomePredictor.test.js`

- [ ] **Step 1: Expand the failing test for merged collections and base aggregation**

```js
assert.equal(snapshot.baseBuckets.get("Fracture Case|4|0").length, 2);
assert.equal(snapshot.baseBuckets.get("Clutch Case|4|0").length, 1);
assert.equal(snapshot.baseBuckets.get("Fracture Case|4|0")[0].base_name, "AK-47 | Ice Coaled");
```

- [ ] **Step 2: Run test to verify it fails on missing aggregation**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: FAIL with empty or wrong bucket contents.

- [ ] **Step 3: Implement catalog indexing**

```js
const rows = db.prepare(`
  SELECT markethashname, basemarkethashname, basename, collection, rarity, wearlevel,
         minfloat, maxfloat, wear_range, isstattrak,
         goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url
  FROM skin
`).all();
```

Build:

- `baseBuckets: Map<string, Array<BaseOutcome>>`
- `wearMap: Map<string, Map<string, ConcreteWearRow>>`

with keys:

- base bucket: `${collectionKey}|${rarityRank}|${stattrak}`
- wear map: `basemarkethashname -> wearlevel -> concrete row`

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: PASS for alias normalization, merged collection expansion, and wear-map assertions.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/services/craftOutcomeCatalog.js tests/craftOutcomePredictor.test.js
git commit -m "feat(craft): build cached outcome catalog indexes"
```

### Task 4: Add cache invalidation on database mtime change

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftOutcomeCatalog.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftOutcomePredictor.test.js`

- [ ] **Step 1: Write the failing cache refresh test**

```js
const first = catalog.getSnapshot();
fs.utimesSync(dbPath, nextAtime, nextMtime);
const second = catalog.getSnapshot();
assert.notEqual(first.loadedAtMs, second.loadedAtMs);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: FAIL because snapshot is reused after mtime changes.

- [ ] **Step 3: Implement lazy cache refresh**

```js
function statDb(dbPath) {
  const stat = fs.statSync(dbPath);
  return {mtimeMs: Number(stat.mtimeMs) || 0};
}
```

Refresh snapshot when cached `mtimeMs` differs from current `mtimeMs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: PASS for cache refresh path.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/services/craftOutcomeCatalog.js tests/craftOutcomePredictor.test.js
git commit -m "feat(craft): refresh outcome catalog on db changes"
```

## Chunk 3: Predictor Core

### Task 5: Add request validation and invalid-state coverage

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftOutcomePredictor.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftOutcomePredictor.test.js`

- [ ] **Step 1: Write failing invalid-state tests**

```js
assert.equal(predict({required_count: 10, target_relative_wear: 0.2, input_rarity: "金", stattrak: false, groups}).ok, false);
assert.equal(predict({required_count: 3, target_relative_wear: 0.2, input_rarity: "军规级", stattrak: false, groups}).invalid_reason, "invalid_required_count");
assert.equal(predict({required_count: 10, target_relative_wear: 2, input_rarity: "军规级", stattrak: false, groups}).invalid_reason, "invalid_target_relative_wear");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: FAIL with missing predictor module or invalid-state mismatch.

- [ ] **Step 3: Implement minimal predictor validation shell**

```js
function createCraftOutcomePredictor({catalog, rarityOrder = []} = {}) {
  return {
    predict(payload = {}) {
      return {ok: false, invalid_reason: "invalid_request", message: "not implemented", outcomes: []};
    }
  };
}
```

- [ ] **Step 4: Run test to verify failures narrow to rule mismatches**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: FAIL on expected invalid reasons.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/services/craftOutcomePredictor.js tests/craftOutcomePredictor.test.js
git commit -m "test(craft): add predictor invalid-state coverage"
```

### Task 6: Implement normalized group merging and target rarity derivation

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftOutcomePredictor.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftOutcomePredictor.test.js`

- [ ] **Step 1: Extend failing tests for merged group counts**

```js
const result = predictor.predict({
  required_count: 10,
  target_relative_wear: 0.2142,
  input_rarity: "军规级",
  stattrak: false,
  groups: [
    {collection: "裂空武器箱", count: 2},
    {collection: "Fracture Case", count: 3}
  ]
});
assert.equal(result.current_count, 5);
assert.equal(result.output_rarity, "受限");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: FAIL because collection merging and output rarity are not implemented.

- [ ] **Step 3: Implement request normalization**

```js
const normalizedGroups = mergeCollectionGroups(payload.groups.map((group) => ({
  collection_key: normalizeCollectionKey(group.collection),
  count: Number(group.count)
})));
```

Also derive:

- `input_rarity_rank`
- `output_rarity_rank`
- `output_rarity`
- `current_count`

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: PASS for count merge and output rarity derivation.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/services/craftOutcomePredictor.js tests/craftOutcomePredictor.test.js
git commit -m "feat(craft): normalize predictor input groups"
```

### Task 7: Implement per-collection candidate lookup and invalidation

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftOutcomePredictor.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftOutcomePredictor.test.js`

- [ ] **Step 1: Add failing test for `collection_outcomes_missing`**

```js
const result = predictor.predict({
  required_count: 10,
  target_relative_wear: 0.2,
  input_rarity: "军规级",
  stattrak: false,
  groups: [{collection: "Missing Case", count: 4}]
});
assert.equal(result.ok, false);
assert.equal(result.invalid_reason, "collection_outcomes_missing");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: FAIL because missing collection pools are not yet checked.

- [ ] **Step 3: Implement collection pool loading**

```js
const bucketKey = `${collectionKey}|${outputRarityRank}|${stattrak ? 1 : 0}`;
const candidates = snapshot.baseBuckets.get(bucketKey) || [];
if (!candidates.length) {
  return invalid("collection_outcomes_missing", "配方无效：存在武器箱在当前稀有度下查不到上一级产物");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: PASS for missing-outcome invalidation.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/services/craftOutcomePredictor.js tests/craftOutcomePredictor.test.js
git commit -m "feat(craft): invalidate predictor when collection outcome pools are missing"
```

### Task 8: Implement real-time probability math

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftOutcomePredictor.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftOutcomePredictor.test.js`

- [ ] **Step 1: Add failing probability tests for full and partial recipes**

```js
assert.equal(result.summary.probability_total < 1, true);
assert.equal(result.summary.probability_missing, 0.5);
assert.equal(result.outcomes[0].probability, 0.15);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: FAIL on missing or wrong probability math.

- [ ] **Step 3: Implement probability computation**

```js
const collectionShare = group.count / requiredCount;
const probability = collectionShare / collectionCandidates.length;
```

Summarize:

```js
const probabilityTotal = outcomes.reduce((sum, item) => sum + item.probability, 0);
const probabilityMissing = Math.max(0, 1 - probabilityTotal);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: PASS for partial recipe totals and per-outcome probabilities.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/services/craftOutcomePredictor.js tests/craftOutcomePredictor.test.js
git commit -m "feat(craft): calculate realtime outcome probabilities"
```

### Task 9: Implement predicted float and wear-tier remapping

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftOutcomePredictor.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftOutcomePredictor.test.js`

- [ ] **Step 1: Add failing float and wear-boundary tests**

```js
assert.equal(result.outcomes[0].predicted_wearlevel, "Minimal Wear");
assert.equal(Math.abs(result.outcomes[0].predicted_float - 0.07) < 1e-9, true);
assert.equal(result.outcomes[0].markethashname.endsWith("(Minimal Wear)"), true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: FAIL on missing float output or wrong wear-level mapping.

- [ ] **Step 3: Implement float computation and wear mapping**

```js
function predictedWearLevel(value) {
  if (value < 0.07) return "Factory New";
  if (value < 0.15) return "Minimal Wear";
  if (value < 0.38) return "Field-Tested";
  if (value < 0.45) return "Well-Worn";
  return "Battle-Scarred";
}
```

Then resolve concrete row via `snapshot.wearMap`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: PASS for float math and wear-tier remapping.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/services/craftOutcomePredictor.js tests/craftOutcomePredictor.test.js
git commit -m "feat(craft): remap predictor outcomes by predicted wear tier"
```

### Task 10: Preserve candidates with missing wear bounds

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftOutcomePredictor.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftOutcomePredictor.test.js`

- [ ] **Step 1: Add failing test for missing wear-bound handling**

```js
assert.equal(result.outcomes[0].probability > 0, true);
assert.equal(result.outcomes[0].predicted_float, null);
assert.equal(result.outcomes[0].missing_wear_bounds, true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: FAIL because missing wear bounds still drop or mis-handle the candidate.

- [ ] **Step 3: Implement missing-bounds fallback**

```js
if (!hasWearBounds(candidate)) {
  return {
    ...candidate,
    probability,
    predicted_float: null,
    predicted_wearlevel: "",
    missing_wear_bounds: true
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: PASS for missing-wear fallback.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/services/craftOutcomePredictor.js tests/craftOutcomePredictor.test.js
git commit -m "feat(craft): keep outcomes when wear bounds are missing"
```

### Task 11: Preserve outcomes when mapped concrete wear rows are missing

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftOutcomePredictor.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftOutcomePredictor.test.js`

- [ ] **Step 1: Add failing test for missing mapped wear-tier rows**

```js
assert.equal(result.outcomes[0].mapped_skin_missing, true);
assert.equal(result.outcomes[0].base_name, "AK-47 | Ice Coaled");
assert.equal(result.outcomes[0].predicted_wearlevel, "Battle-Scarred");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: FAIL because missing concrete rows still drop or corrupt the outcome.

- [ ] **Step 3: Implement mapped-row fallback**

```js
const concrete = wearMap.get(baseKey)?.get(predictedWearlevel) || null;
return concrete
  ? {...resolvedFields, mapped_skin_missing: false}
  : {...baseFields, name: baseFields.base_name, markethashname: "", mapped_skin_missing: true};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: PASS for missing concrete-row fallback.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/services/craftOutcomePredictor.js tests/craftOutcomePredictor.test.js
git commit -m "feat(craft): keep predictor outcomes when concrete wear rows are missing"
```

## Chunk 4: HTTP Route Integration

### Task 12: Add route-level failing test

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js`
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-outcome-predictor-route.test.js`

- [ ] **Step 1: Write the failing route test**

```js
const response = await postJson("/api/craft/predict-outcomes", payload);
assert.equal(response.statusCode, 200);
assert.equal(response.body.ok, true);
assert.equal(Array.isArray(response.body.outcomes), true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_sidecar/tests/craft-outcome-predictor-route.test.js`
Expected: FAIL with 404 or route-not-found response.

- [ ] **Step 3: Add route scaffold and predictor wiring**

```js
if (pathname === "/api/craft/predict-outcomes" && req.method === "POST") {
  const body = await readJsonBody(req);
  const result = craftOutcomePredictor.predict(body);
  writeJson(res, result.ok ? 200 : 400, result);
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_sidecar/tests/craft-outcome-predictor-route.test.js`
Expected: PASS for successful route wiring.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/uiServer.js node_sidecar/tests/craft-outcome-predictor-route.test.js
git commit -m "feat(craft): add outcome predictor route"
```

### Task 13: Add route-level invalid response coverage

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-outcome-predictor-route.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js`

- [ ] **Step 1: Write the failing invalid-response test**

```js
const response = await postJson("/api/craft/predict-outcomes", invalidPayload);
assert.equal(response.statusCode, 400);
assert.equal(response.body.ok, false);
assert.equal(response.body.invalid_reason, "collection_outcomes_missing");
assert.deepEqual(response.body.outcomes, []);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_sidecar/tests/craft-outcome-predictor-route.test.js`
Expected: FAIL because route does not yet preserve invalid payload shape.

- [ ] **Step 3: Return predictor invalid payloads without reshaping them away**

```js
writeJson(res, result.ok ? 200 : 400, result);
```

Ensure route keeps:

- `invalid_reason`
- `message`
- `required_count`
- `current_count`
- `outcomes`

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_sidecar/tests/craft-outcome-predictor-route.test.js`
Expected: PASS for invalid response shape.

- [ ] **Step 5: Commit**

```bash
git add node_sidecar/src/uiServer.js node_sidecar/tests/craft-outcome-predictor-route.test.js
git commit -m "fix(craft): preserve predictor invalid response payloads"
```

## Chunk 5: Verification And Documentation Sync

### Task 14: Run full targeted verification

**Files:**
- Modify: none
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftOutcomePredictor.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-outcome-predictor-route.test.js`
- Reference: `C:/Users/18220/Desktop/cs2_alchemy/docs/superpowers/specs/2026-03-26-craft-outcome-predictor-design.md`

- [ ] **Step 1: Run service tests**

Run: `node tests/craftOutcomePredictor.test.js`
Expected: PASS

- [ ] **Step 2: Run route tests**

Run: `node node_sidecar/tests/craft-outcome-predictor-route.test.js`
Expected: PASS

- [ ] **Step 3: Re-run nearby regression tests that share collection and DB helpers**

Run: `node tests/skinDbSync.test.js`
Expected: PASS

Run: `node tests/skinDetailEnrichmentService.test.js`
Expected: PASS

- [ ] **Step 4: Inspect final diff against the spec**

Run: `git diff --stat HEAD~1..HEAD`
Expected: only predictor, catalog, helper, route, and test files changed for the final chunk

- [ ] **Step 5: Commit final verification-safe state**

```bash
git add node_sidecar/src/services/craftOutcomeCatalog.js \
        node_sidecar/src/services/craftOutcomePredictor.js \
        node_sidecar/src/services/skinAlchemyRules.js \
        node_sidecar/src/uiServer.js \
        tests/craftOutcomePredictor.test.js \
        node_sidecar/tests/craft-outcome-predictor-route.test.js
git commit -m "feat(craft): add backend outcome predictor"
```

## Notes For The Implementer

- Keep predictor logic backend-only in this plan
- Do not touch current frontend placement yet
- Do not mutate existing `alchemy_type` strings in the database
- Keep the implementation parameterized by `required_count`
- Prefer small pure helpers in predictor and catalog code so edge-case tests remain local and fast
- Use the existing SQLite temp-db test style from `tests/skinDbSync.test.js`

## Execution Order

1. Shared helpers
2. Catalog indexes and cache
3. Predictor validation and outcome math
4. HTTP route wiring
5. Verification and final commit

Plan complete and saved to `docs/superpowers/plans/2026-03-26-craft-outcome-predictor.md`. Ready to execute?
