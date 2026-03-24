# Craft Assist Oversized Material Prefilter Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an oversized-material shard prefilter path that cuts large craft-assist candidate groups down before final search while preserving existing solver semantics and providing deterministic fallbacks.

**Architecture:** Keep `searchCraftAssistBestSolution(...)` as the final authority and insert a service-layer prefilter only when a rarity-filtered material group crosses the oversized thresholds. Implement the prefilter as a new service module plus a dedicated shard worker entrypoint, let `craftAssistService` orchestrate base/expand/rarity-full fallback phases, and verify the whole path through pure helper tests, worker-orchestration tests, service integration tests, and request-worker-pool regression tests.

**Tech Stack:** Node.js CommonJS, `worker_threads`, plain JavaScript, `node:assert/strict` test scripts, existing craft-assist service/search code, existing worker-pool patterns, existing `tests/fixtures` worker fixtures.

---

**Spec:** `C:/Users/18220/Desktop/cs2_alchemy/docs/superpowers/specs/2026-03-24-craft-assist-oversized-material-prefilter-design.md`

**Execution skills:** `@test-driven-development` `@systematic-debugging` `@verification-before-completion`

## File Map

- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistShardPrefilter.js`
  - Service-layer oversized-group detector, env/config parsing, role normalization, shard construction, worker orchestration, merge/trace/fallback state machine.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistShardWorker.js`
  - `worker_threads` entrypoint that receives one shard payload, applies deterministic core/edge selection, and returns `selectedIds + stats`.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistService.js`
  - Call the prefilter before `searchCraftAssistBestSolution(...)` for each rarity attempt, pass config/trace through, and preserve old behavior when the feature is disabled or skipped.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistWorker.js`
  - Await the now-async service selection path inside the request worker before posting the result back to the parent request-worker pool.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js`
  - Await direct `craftAssistService.selectForRecipe(...)` calls so the HTTP route keeps working when no request-worker pool is enabled.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistShardPrefilter.test.js`
  - Pure-helper and orchestration tests for thresholds, role normalization, overlap sizing, merge limits, duplicate IDs, worker crash/timeout, and fallback transitions.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/fixtures/craftAssistShardTimeoutWorker.js`
  - Dedicated fixture worker that never responds so per-shard/group/call timeout handling can be tested deterministically.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/fixtures/craftAssistShardCrashWorker.js`
  - Dedicated fixture worker that exits or throws immediately so `group full fallback` behavior can be asserted.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/fixtures/craftAssistOversizedPrefilterRows.js`
  - Deterministic row builders for medium/large oversized groups, `expand retry`, `rarity full fallback`, and fixed-sample comparison recipes.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/fixtures/craftAssistCrashOnceWorker.js`
  - Await the async craft-assist service call so the request-worker crash-retry fixture still returns real selection payloads after the service integration changes.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`
  - Service-level regression coverage for 2-shard and 4-shard prefilter paths, `group full fallback`, `rarity full fallback`, and trace fields.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistWorkerPool.test.js`
  - Verify nested shard workers still work when craft assist runs inside the existing request worker pool.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistOversizedPrefilterCompare.test.js`
  - Fixed-sample comparison gate that runs `ENABLE_OVERSIZED_PREFILTER=false` vs enabled-on override, reports success-rate / overall-gap / timing deltas, and enforces the rollout thresholds from the spec.

## Chunk 1: Build And Lock The Prefilter Core

### Task 1: Add failing oversized-prefilter helper tests

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistShardPrefilter.test.js`
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/docs/superpowers/specs/2026-03-24-craft-assist-oversized-material-prefilter-design.md`

- [ ] **Step 1: Add shared candidate/group builders so the tests can generate deterministic oversized groups without touching production rows**

```js
function makeCandidate(id, value, {rarity = 4} = {}) {
  return {
    id: String(id),
    value,
    relative_value: value,
    row: {asset_id: String(id), rarity}
  };
}

function makeGroup(candidates, {count = 5, role = "main"} = {}) {
  return {
    material: {count, role},
    candidates
  };
}
```

- [ ] **Step 2: Add a failing test for threshold resolution and role normalization**

```js
function test_resolve_shard_count_and_role_mapping() {
  assert.equal(resolveShardCount(500, defaults), 0);
  assert.equal(resolveShardCount(501, defaults), 2);
  assert.equal(resolveShardCount(1501, defaults), 4);
  assert.equal(normalizeShardRole({modeHint: "single_material", materialRole: "main"}), "neutral");
  assert.equal(normalizeShardRole({modeHint: "multi_material_neutral", materialRole: "aux"}), "neutral");
  assert.equal(normalizeShardRole({modeHint: "multi_material_role", materialRole: "aux"}), "aux");
  assert.equal(normalizeShardRole({modeHint: "multi_material_role", materialRole: "main"}), "main");
}
```

- [ ] **Step 3: Add failing tests for `center overlap`, `orderedIndex` preservation, and merge clipping**

```js
function test_build_stride_shards_with_center_overlap_preserves_ordered_index() {
  const orderedCandidates = Array.from({length: 600}, (_, orderedIndex) => ({
    id: String(orderedIndex + 1),
    value: orderedIndex / 1000,
    orderedIndex
  }));
  const options = {centerOverlapRatio: 0.1, centerOverlapMin: 24, centerOverlapMax: 120};
  const shards = buildStrideShardsWithCenterOverlap({orderedCandidates, shardCount: 2, targetValue: 0.42, options});
  const centerIndex = 420;
  const sharedIndexes = shards.reduce((set, shard, shardIndex) => {
    if (shardIndex === 0) return new Set(shard.candidates.map((item) => item.orderedIndex));
    return new Set(shard.candidates.map((item) => item.orderedIndex).filter((index) => set.has(index)));
  }, new Set());
  assert.equal(shards.length, 2);
  assert.equal(shards[0].candidates.some((item) => item.orderedIndex === centerIndex), true);
  assert.equal(shards[1].candidates.some((item) => item.orderedIndex === centerIndex), true);
  assert.equal(sharedIndexes.size, 60);
}

function test_merge_shard_selections_clips_to_shortlist_max_in_original_order() {
  const group = makeGroup(Array.from({length: 20}, (_, orderedIndex) => ({
    id: String(orderedIndex + 1),
    value: orderedIndex / 100,
    orderedIndex
  })));
  const result = mergeShardSelections({
    group,
    selectedIds: ["9", "4", "11", "3", "15", "14"],
    options: {shortlistMin: 4, shortlistPerRequired: 1, shortlistHardMax: 4}
  });
  assert.deepEqual(result.candidates.map((item) => item.id), ["3", "4", "9", "11"]);
}
```

- [ ] **Step 4: Add failing tests for `material.count > shortlistHardMax`, duplicate IDs, and `group full fallback`**

```js
async function test_prefilter_skips_group_when_shortlist_hard_max_cannot_fit_count() {
  const result = await prefilterOversizedGroups({...args});
  assert.deepEqual(result.groupFallbackIndexes, [0]);
}

function test_merge_shard_selections_rejects_duplicate_ids() {
  const group = makeGroup(Array.from({length: 12}, (_, orderedIndex) => ({
    id: String(orderedIndex + 1),
    value: orderedIndex / 100,
    orderedIndex
  })));
  const result = mergeShardSelections({
    group,
    selectedIds: ["2", "2", "5"],
    options: {shortlistMin: 4, shortlistPerRequired: 2, shortlistHardMax: 8}
  });
  assert.equal(result.usedGroupFallback, true);
}
```

- [ ] **Step 5: Add a failing non-mutation test that freezes `groups` and candidate objects before calling `prefilterOversizedGroups(...)`**

```js
async function test_prefilter_does_not_mutate_input_groups() {
  const group = makeGroup(Array.from({length: 520}, (_, index) => makeCandidate(index + 1, index / 1000)), {count: 5});
  const args = {groups: [group], targetValue: 0.42, recipeContext: {recipeNo: 1}, options: {oversized2ShardsThreshold: 500}};
  Object.freeze(args.groups);
  Object.freeze(group);
  Object.freeze(group.material);
  Object.freeze(group.candidates);
  Object.freeze(group.candidates[0]);
  const result = await prefilterOversizedGroups({...args});
  assert.notEqual(result.groups, args.groups);
  assert.notEqual(result.groups[0], group);
  assert.equal(group.candidates[0].orderedIndex, undefined);
}

async function test_prefilter_keeps_non_oversized_group_identity() {
  const smallGroup = makeGroup(Array.from({length: 12}, (_, index) => makeCandidate(index + 1, index / 100)), {count: 4});
  const result = await prefilterOversizedGroups({
    groups: [smallGroup],
    targetValue: 0.42,
    recipeContext: {recipeNo: 1},
    options: {oversized2ShardsThreshold: 500}
  });
  assert.equal(result.groups[0], smallGroup);
}
```

- [ ] **Step 6: Run the new test file to confirm it fails because the prefilter module does not exist yet**

Run: `node "./tests/craftAssistShardPrefilter.test.js"`

Expected: FAIL with module-not-found or missing-export errors for `craftAssistShardPrefilter.js`.

### Task 2: Implement the pure prefilter helpers

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistShardPrefilter.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistShardPrefilter.test.js`

- [ ] **Step 1: Add config/default helpers for thresholds, shortlist limits, env parsing, and explicit-option precedence with the full spec key set**

```js
function resolvePrefilterOptions(overrides = {}) {
  return {
    enableOversizedPrefilter: false,
    oversized2ShardsThreshold: 500,
    oversized4ShardsThreshold: 1500,
    topK: 40,
    edgeKeepPerSide: 4,
    expandTopK: 80,
    expandEdgeKeepPerSide: 8,
    centerOverlapRatio: 0.1,
    centerOverlapMin: 24,
    centerOverlapMax: 120,
    shortlistMin: 100,
    shortlistPerRequired: 20,
    shortlistHardMax: 240,
    shardJobTimeoutMs: 5000,
    prefilterGroupTimeoutMs: 15000,
    prefilterCallTimeoutMs: 30000
  };
}
```

- [ ] **Step 2: Add a config precedence test that proves `explicit param > env > defaults` and invalid env values fall back to defaults without triggering `group full fallback`**

```js
function test_resolve_prefilter_options_prefers_explicit_over_env_and_defaults() {
  const prevThreshold = process.env.OVERSIZED_2_SHARDS_THRESHOLD;
  const prevEnabled = process.env.ENABLE_OVERSIZED_PREFILTER;
  const prevShortlistHardMax = process.env.SHORTLIST_HARD_MAX;
  try {
    process.env.OVERSIZED_2_SHARDS_THRESHOLD = "777";
    process.env.ENABLE_OVERSIZED_PREFILTER = "false";
    process.env.SHORTLIST_HARD_MAX = "not-a-number";
    const resolved = resolvePrefilterOptions({oversized2ShardsThreshold: 555});
    assert.equal(resolved.oversized2ShardsThreshold, 555);
    assert.equal(resolved.enableOversizedPrefilter, false);
    assert.equal(resolved.shortlistHardMax, 240);
  } finally {
    if (prevThreshold === undefined) delete process.env.OVERSIZED_2_SHARDS_THRESHOLD;
    else process.env.OVERSIZED_2_SHARDS_THRESHOLD = prevThreshold;
    if (prevEnabled === undefined) delete process.env.ENABLE_OVERSIZED_PREFILTER;
    else process.env.ENABLE_OVERSIZED_PREFILTER = prevEnabled;
    if (prevShortlistHardMax === undefined) delete process.env.SHORTLIST_HARD_MAX;
    else process.env.SHORTLIST_HARD_MAX = prevShortlistHardMax;
  }
}
```

- [ ] **Step 3: Add `normalizeShardRole(...)`, `resolveShardCount(...)`, and `buildStrideShardsWithCenterOverlap(...)` exactly as described in the spec**

```js
function normalizeShardRole({modeHint, materialRole}) {
  if (modeHint === "single_material" || modeHint === "multi_material_neutral") return "neutral";
  return String(materialRole || "").trim() === "aux" ? "aux" : "main";
}
```

- [ ] **Step 4: Export a minimal `prefilterOversizedGroups(...)` API that preserves input immutability, passes through non-oversized groups unchanged, and short-circuits `material.count > shortlistHardMax` to `group full fallback`**

```js
async function prefilterOversizedGroups({groups, targetValue, recipeContext, options}) {
  const resolvedOptions = resolvePrefilterOptions(options);
  const prefilterTrace = {
    groups: [],
    prefilteredIndexes: [],
    groupFallbackIndexes: [],
    retryMode: "none",
    usedRarityFullFallback: false
  };
  const nextGroups = groups.map((group, groupIndex) => {
    const isOversized = group.candidates.length > resolvedOptions.oversized2ShardsThreshold;
    if (!isOversized) return group;
    const clonedGroup = {
      ...group,
      material: {...group.material},
      candidates: group.candidates.slice()
    };
    if (clonedGroup.material.count > resolvedOptions.shortlistHardMax) {
      prefilterTrace.groupFallbackIndexes.push(groupIndex);
    }
    return clonedGroup;
  });
  return {
    groups: nextGroups,
    prefilterTrace,
    retryMode: prefilterTrace.retryMode,
    prefilteredIndexes: prefilterTrace.prefilteredIndexes,
    groupFallbackIndexes: prefilterTrace.groupFallbackIndexes,
    usedRarityFullFallback: prefilterTrace.usedRarityFullFallback
  };
}
```

- [ ] **Step 5: Add shortlist merge helpers that dedupe by `id`, restore original `orderedIndex`, and return `group full fallback` when `material.count > shortlistHardMax` or duplicate IDs are detected**

```js
function mergeShardSelections({group, selectedIds, options}) {
  const shortlistMax = Math.min(
    options.shortlistHardMax,
    Math.max(options.shortlistMin, group.material.count * options.shortlistPerRequired)
  );
  if (group.material.count > options.shortlistHardMax) {
    return {candidates: group.candidates.slice(), usedGroupFallback: true};
  }
  const seen = new Set();
  const byId = new Map(group.candidates.map((candidate, orderedIndex) => [
    candidate.id,
    {...candidate, orderedIndex}
  ]));
  const shortlist = [];
  for (const id of selectedIds) {
    if (seen.has(id) || !byId.has(id)) {
      return {candidates: group.candidates.slice(), usedGroupFallback: true};
    }
    seen.add(id);
    shortlist.push(byId.get(id));
  }
  shortlist.sort((left, right) => left.orderedIndex - right.orderedIndex);
  return {candidates: shortlist.slice(0, shortlistMax), usedGroupFallback: false};
}
```

- [ ] **Step 6: Re-run the helper test file and make every currently-written test pass**

Run: `node "./tests/craftAssistShardPrefilter.test.js"`

Expected: PASS because the worker/orchestration tests have not been added yet.

### Task 3: Add failing worker-orchestration tests

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistShardPrefilter.test.js`
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/fixtures/craftAssistShardTimeoutWorker.js`
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/fixtures/craftAssistShardCrashWorker.js`

- [ ] **Step 1: Add a failing test that injects a timeout worker and expects `group full fallback`**

```js
async function test_group_full_fallback_on_shard_timeout() {
  const result = await prefilterOversizedGroups({
    ...args,
    options: {...baseOptions, workerPath: TIMEOUT_FIXTURE_PATH}
  });
  assert.deepEqual(result.groupFallbackIndexes, [0]);
}
```

- [ ] **Step 2: Add a failing test that injects a crashing worker and expects the same group-level fallback**

```js
async function test_group_full_fallback_on_worker_crash() {
  const result = await prefilterOversizedGroups({
    ...args,
    options: {...baseOptions, workerPath: CRASH_FIXTURE_PATH}
  });
  assert.deepEqual(result.groupFallbackIndexes, [0]);
}
```

- [ ] **Step 3: Add a failing test that sets `prefilterCallTimeoutMs` to a tiny value with the timeout fixture and expects `retryMode === "rarity_full"` with no mixed-state survivors**

```js
async function test_call_timeout_discards_all_partial_prefilter_results() {
  const result = await prefilterOversizedGroups({
    ...args,
    options: {...baseOptions, workerPath: TIMEOUT_FIXTURE_PATH, prefilterCallTimeoutMs: 5}
  });
  assert.equal(result.retryMode, "rarity_full");
  assert.equal(result.usedRarityFullFallback, true);
  assert.deepEqual(result.prefilteredIndexes, []);
  assert.deepEqual(result.groupFallbackIndexes, []);
}
```

- [ ] **Step 4: Create the timeout fixture worker that receives a `prefilter` message and then hangs forever without replying**

```js
const {parentPort} = require("node:worker_threads");

parentPort.on("message", (message) => {
  if (!message || message.type !== "prefilter") return;
  setInterval(() => {}, 1000);
});
```

- [ ] **Step 5: Create the crash fixture worker that receives a `prefilter` message and immediately throws**

```js
const {parentPort} = require("node:worker_threads");

parentPort.on("message", (message) => {
  if (!message || message.type !== "prefilter") return;
  throw new Error("fixture shard crash");
});
```

- [ ] **Step 6: Keep `options.workerPath` test-only by passing it only through direct `prefilterOversizedGroups(...)` calls inside tests; do not thread it through `craftAssistService.selectForRecipe(...)` or any HTTP/request-worker payload**

- [ ] **Step 7: Run the test file again and verify the remaining failures are still implementation-missing, not syntax errors**

Run: `node "./tests/craftAssistShardPrefilter.test.js"`

Expected: FAIL because the shard worker/orchestration path is still missing.

## Chunk 2: Add Threaded Prefilter Execution And Integrate It

### Task 4: Implement the shard worker entrypoint

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistShardWorker.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistShardPrefilter.test.js`

- [ ] **Step 1: Add a failing worker-level negative test that posts a malformed shard payload and expects `{ok:false}` instead of a thrown crash**

```js
async function test_shard_worker_rejects_malformed_payload() {
  const {Worker} = require("node:worker_threads");
  const path = require("node:path");
  const worker = new Worker(path.join(__dirname, "..", "node_sidecar", "src", "services", "craftAssistShardWorker.js"));
  const replyPromise = new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
  });
  try {
    worker.postMessage({type: "prefilter", requestId: "bad-1", payload: {groupIndex: 0}});
    const reply = await replyPromise;
    assert.equal(reply.ok, false);
    assert.match(reply.error.message, /invalid shard payload/i);
  } finally {
    await worker.terminate();
  }
}
```

- [ ] **Step 2: Create the `worker_threads` entry and validate every required shard payload field before ranking**

```js
const {parentPort} = require("node:worker_threads");

if (!parentPort) {
  throw new Error("craftAssistShardWorker requires parentPort");
}

function isValidShardPayload(payload) {
  return payload
    && Number.isInteger(payload.recipeNo)
    && Number.isInteger(payload.groupIndex)
    && Number.isInteger(payload.shardIndex)
    && Number.isInteger(payload.shardCount)
    && (payload.role === "main" || payload.role === "aux" || payload.role === "neutral")
    && Number.isFinite(Number(payload.targetValue))
    && Number.isInteger(payload.topK)
    && Number.isInteger(payload.edgeKeepPerSide)
    && Array.isArray(payload.candidates)
    && payload.candidates.every((candidate) => candidate
      && typeof candidate.id === "string"
      && Number.isFinite(Number(candidate.value))
      && Number.isInteger(candidate.orderedIndex));
}

parentPort.on("message", (message) => {
  if (!message || message.type !== "prefilter") return;
  const requestId = String(message.requestId || "").trim();
  const payload = message.payload && typeof message.payload === "object" ? message.payload : null;
  if (!requestId || !isValidShardPayload(payload)) {
    parentPort.postMessage({type: "result", requestId, ok: false, error: {message: "invalid shard payload"}});
    return;
  }
});
```

- [ ] **Step 3: Add a failing golden worker test that posts a valid shard payload and locks `core keep`, `preferred-side bias`, `edge keep`, and the response stats contract**

```js
async function test_shard_worker_prefers_correct_side_and_reports_stats() {
  const reply = await runShardWorkerOnce({
    recipeNo: 1,
    groupIndex: 0,
    shardIndex: 0,
    shardCount: 2,
    role: "main",
    targetValue: 0.21,
    topK: 6,
    edgeKeepPerSide: 2,
    candidates: [
      {id: "a", value: 0.209, orderedIndex: 0},
      {id: "b", value: 0.211, orderedIndex: 1},
      {id: "c", value: 0.212, orderedIndex: 2},
      {id: "d", value: 0.18, orderedIndex: 3},
      {id: "e", value: 0.24, orderedIndex: 4}
    ]
  });
  assert.deepEqual(reply.result.selectedIds, ["b", "c", "a", "d", "e"]);
  assert.equal(reply.result.stats.inputCount, 5);
  assert.equal(reply.result.stats.outputCount, 5);
  assert.equal(reply.result.stats.preferredSideCount >= 1, true);
}
```

- [ ] **Step 4: Implement deterministic shard ranking with `core keep`, `edge keep`, and stats fields named exactly as the spec requires**

```js
const {selectedIds, preferredSideCount, oppositeSideCount} = pickShardCandidates({
  role,
  targetValue,
  topK,
  edgeKeepPerSide,
  candidates
});
const stats = {
  inputCount: candidates.length,
  outputCount: selectedIds.length,
  preferredSideCount,
  oppositeSideCount
};
parentPort.postMessage({type: "result", requestId, ok: true, result: {groupIndex, shardIndex, selectedIds, stats}});
```

- [ ] **Step 5: Run `node --check` on the new worker entry and then re-run the shard-prefilter tests**

Run: `node --check "./node_sidecar/src/services/craftAssistShardWorker.js"`

Expected: PASS

Run: `node "./tests/craftAssistShardPrefilter.test.js"`

Expected: FAIL only on orchestration/service integration cases because `prefilterOversizedGroups(...)` does not spawn the worker yet.

### Task 5: Implement threaded orchestration and fallback state machine

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistShardPrefilter.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistShardPrefilter.test.js`

- [ ] **Step 1: Lock the exact shard-concurrency rule from the spec and add bounded shard execution with `worker_threads`, `availableParallelism()` fallback, per-shard timeout, and per-group timeout**

```js
function resolveShardConcurrency(shardCount) {
  if (typeof availableParallelism !== "function") {
    return Math.min(shardCount, 2);
  }
  return Math.min(shardCount, 4, Math.max(1, availableParallelism() - 1));
}

async function runShardJobs({jobs, workerPath, options}) {
  const maxShardConcurrency = resolveShardConcurrency(jobs.length);
  const results = new Array(jobs.length);
  let cursor = 0;
  async function runNext() {
    const currentIndex = cursor++;
    if (currentIndex >= jobs.length) return;
    results[currentIndex] = await runSingleShardJob({
      job: jobs[currentIndex],
      workerPath,
      shardJobTimeoutMs: options.shardJobTimeoutMs
    });
    await runNext();
  }
  await Promise.all(Array.from({length: maxShardConcurrency}, () => runNext()));
  return results;
}
```

- [ ] **Step 2: Add worker-termination helpers that cancel in-flight shard workers on `shardJobTimeoutMs`, `prefilterGroupTimeoutMs`, and `prefilterCallTimeoutMs`, and ignore any late results after abort**

```js
async function terminateActiveWorkers(activeWorkers) {
  await Promise.all([...activeWorkers].map(async (worker) => {
    try {
      await worker.terminate();
    } catch (_) {}
  }));
  activeWorkers.clear();
}
```

- [ ] **Step 3: Implement a single-phase prefilter executor in `craftAssistShardPrefilter.js` that handles one call (`prefilter/base` or `prefilter/expand`) at a time, including `group full fallback`, single-group timeout fallback, and `call timeout mixed-state forbidden`**

```js
async function runPrefilterPhase({groups, targetValue, recipeContext, phaseName, phaseOptions}) {
  const phaseResult = await runPhaseWorkers({groups, targetValue, recipeContext, phaseName, phaseOptions});
  if (phaseResult.kind === "call_timeout") {
    await terminateActiveWorkers(phaseResult.activeWorkers);
    return {kind: "call_timeout", usedRarityFullFallback: true, groups, prefilterTrace: phaseResult.prefilterTrace};
  }
  return {
    kind: "phase_ready",
    groups: phaseResult.groups,
    prefilterTrace: phaseResult.prefilterTrace,
    groupFallbackIndexes: phaseResult.groupFallbackIndexes,
    usedRarityFullFallback: false
  };
}
```

- [ ] **Step 4: Extend `tests/craftAssistShardPrefilter.test.js` so the single-phase executor covers `prefilterGroupTimeoutMs`, `group full fallback`, `call timeout -> rarity_full`, and the full trace schema (`enabled`, `targetValue`, `candidateCountBefore/After`, `centerOverlapSize`, `prefilterMs`, `usedRarityFullFallback`)**

- [ ] **Step 5: Re-run the shard-prefilter test file and make it pass**

Run: `node "./tests/craftAssistShardPrefilter.test.js"`

Expected: PASS

- [ ] **Step 6: Commit the prefilter module and tests**

```bash
git add node_sidecar/src/services/craftAssistShardPrefilter.js node_sidecar/src/services/craftAssistShardWorker.js tests/craftAssistShardPrefilter.test.js tests/fixtures/craftAssistShardTimeoutWorker.js tests/fixtures/craftAssistShardCrashWorker.js
git commit -m "feat(craft): add oversized material shard prefilter"
```

Expected: Commit succeeds with only the new prefilter files staged.

### Task 6: Integrate prefilter into `craftAssistService`

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/fixtures/craftAssistOversizedPrefilterRows.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistService.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistWorker.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/fixtures/craftAssistCrashOnceWorker.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`

- [ ] **Step 1: Convert the service test helpers and bottom-of-file test runner to `async`/`await`, then add deterministic oversized-row builders whose rarity-filtered candidate counts hit `501~1500` and `>1500` exactly**

```js
const oversizedMaterials = [
  {name: "Aux", names: ["Aux"], role: "neutral", count: 10, wear_min: 0, wear_max: 1}
];

const {
  buildMediumOversizedRows,
  buildLargeOversizedRows,
  buildExpandRetryRows,
  buildRarityFallbackRows
} = require("./fixtures/craftAssistOversizedPrefilterRows");

async function test_prefilter_trace_reports_two_shards_for_medium_oversized_group() {
  const result = await runSelect({rows: buildMediumOversizedRows(), targetWear: 0.21, materials: oversizedMaterials});
  assert.equal(result.ok, true);
  assert.equal(result.selection_trace.prefilter.groups[0].shardCount, 2);
}

async function test_prefilter_trace_reports_four_shards_for_large_oversized_group() {
  const result = await runSelect({rows: buildLargeOversizedRows(), targetWear: 0.21, materials: oversizedMaterials});
  assert.equal(result.ok, true);
  assert.equal(result.selection_trace.prefilter.groups[0].shardCount, 4);
}
```

- [ ] **Step 2: Add deterministic service-level tests that prove solver failure drives `base -> expand -> rarity_full`, while `group full fallback` and `rarity full fallback` still preserve legal results**

```js
async function withPrefilterEnv(patch, run) {
  const previous = new Map(Object.keys(patch).map((key) => [key, process.env[key]]));
  try {
    Object.entries(patch).forEach(([key, value]) => { process.env[key] = value; });
    return await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function buildExpandRetryArgs() {
  return {
    rows: buildExpandRetryRows(),
    targetWear: 0.21,
    materials: oversizedMaterials
  };
}

function buildRarityFullFallbackArgs() {
  return {
    rows: buildRarityFallbackRows(),
    targetWear: 0.21,
    materials: oversizedMaterials
  };
}

async function test_prefilter_group_fallback_preserves_old_solver_result() {
  await withPrefilterEnv({SHORTLIST_HARD_MAX: "4"}, async () => {
    const result = await runSelect({
      rows: buildMediumOversizedRows(),
      targetWear: 0.21,
      materials: [{name: "Aux", names: ["Aux"], role: "neutral", count: 5, wear_min: 0, wear_max: 1}]
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.selection_trace.prefilter.groupFallbackIndexes, [0]);
  });
}

async function test_prefilter_solver_failure_triggers_expand_retry_before_full_fallback() {
  const result = await runSelect(buildExpandRetryArgs());
  assert.equal(result.ok, true);
  assert.equal(result.selection_trace.prefilter.retryMode, "expand");
}

async function test_prefilter_full_fallback_trace_marks_rarity_full() {
  const result = await runSelect(buildRarityFullFallbackArgs());
  assert.equal(result.ok, true);
  assert.equal(result.selection_trace.prefilter.retryMode, "rarity_full");
}
```

- [ ] **Step 3: Keep the outer `base -> search -> judge success -> expand -> search -> rarity_full` control loop in `craftAssistService.js`, using the single-phase prefilter executor from Task 5 and a success judge that matches the spec’s `solved != null && overall < targetValue && post-processing stays valid` rule**

```js
const basePhase = await runPrefilterPhase({groups, targetValue: safeTargetValue, recipeContext, phaseName: "prefilter/base", phaseOptions: baseOptions});
let solved = basePhase.kind === "call_timeout"
  ? searchCraftAssistBestSolution({groups, targetValue: safeTargetValue})
  : searchCraftAssistBestSolution({groups: basePhase.groups, targetValue: safeTargetValue});
if (basePhase.kind !== "call_timeout" && !isSolvedOutcomeAcceptable({solved, targetValue: safeTargetValue, wearOffsetPct})) {
  const expandPhase = await runPrefilterPhase({groups, targetValue: safeTargetValue, recipeContext, phaseName: "prefilter/expand", phaseOptions: expandOptions});
  solved = expandPhase.kind === "call_timeout"
    ? searchCraftAssistBestSolution({groups, targetValue: safeTargetValue})
    : searchCraftAssistBestSolution({groups: expandPhase.groups, targetValue: safeTargetValue});
  if (!isSolvedOutcomeAcceptable({solved, targetValue: safeTargetValue, wearOffsetPct})) {
    solved = searchCraftAssistBestSolution({groups, targetValue: safeTargetValue});
  }
}
```

- [ ] **Step 4: Add explicit trace/log schema work in `craftAssistService.js` and `tests/craftAssistService.test.js`, locking `selection_trace.prefilter` plus logger fields `prefilterMs`, `finalSearchMs`, `totalMs`, `timedOut`, and `usedRarityFullFallback`**

```js
assert.deepEqual(Object.keys(result.selection_trace.prefilter).sort(), [
  "enabled",
  "groups",
  "groupFallbackIndexes",
  "prefilterMs",
  "retryMode",
  "targetValue",
  "usedRarityFullFallback"
]);
assert.deepEqual(Object.keys(result.selection_trace.prefilter.groups[0]).sort(), [
  "candidateCountAfter",
  "candidateCountBefore",
  "centerOverlapSize",
  "groupIndex",
  "materialName",
  "shardCount",
  "shardStats"
]);
assert.equal(logged.prefilter.timedOut, false);
assert.equal(logged.prefilter.usedRarityFullFallback, false);
```

- [ ] **Step 5: Run a call-site sweep for the Promise-returning craft-assist APIs, then update every remaining runtime caller (`craftAssistWorker.js`, `tests/fixtures/craftAssistCrashOnceWorker.js`, `uiServer.js`) to await the service result**

Run: `rg "selectCraftAssistForRecipe\\(|runCraftAssistSelectionForRecipe\\(|createCraftAssistService\\(" "./node_sidecar" "./tests"`

Expected: Only the reviewed runtime callers and known test call sites remain to be updated.

- [ ] **Step 6: Preserve the old path behavior when the feature flag is at its rollout default (`ENABLE_OVERSIZED_PREFILTER = false`), when no group is oversized, or when a rarity-full fallback is taken, while keeping the async callers wired correctly**

```js
const result = CRAFT_ASSIST_USE_WORKER_POOL && craftAssistWorkerPool
  ? await craftAssistWorkerPool.selectForRecipe({...workerArgs})
  : await craftAssistService.selectForRecipe({...directArgs});
```

- [ ] **Step 7: Run the service regression suite and make it pass**

Run: `node "./tests/craftAssistService.test.js"`

Expected: PASS

### Task 7: Verify nested request-worker compatibility

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistWorkerPool.test.js`

- [ ] **Step 1: Update existing direct-selection comparisons to await the async service call, then add a failing worker-pool test that sends an oversized candidate set through the existing request worker pool and asserts the result matches direct service execution**

```js
async function test_worker_pool_matches_direct_selection_with_oversized_prefilter() {
  const rows = [
    makeRow({id: "main-1", name: "Main", rarity: 4, relative: 0.24}),
    makeRow({id: "main-2", name: "Main", rarity: 4, relative: 0.241}),
    ...Array.from({length: 620}, (_, index) => makeRow({
      id: `aux-${index + 1}`,
      name: "Aux",
      rarity: 4,
      relative: 0.2 + index / 100000
    }))
  ];
  const direct = await selectCraftAssistForRecipe(makeDirectArgs(rows));
  const viaPool = await pool.selectForRecipe(makeInlineCandidateArgs(rows));
  assert.deepEqual(viaPool.item_ids, direct.item_ids);
}
```

- [ ] **Step 2: Re-run the worker-pool test file and verify the new oversized-path assertion passes without breaking existing timeout/retry cases**

Run: `node "./tests/craftAssistWorkerPool.test.js"`

Expected: PASS

- [ ] **Step 3: Commit the service integration and worker-pool verification changes**

```bash
git add node_sidecar/src/services/craftAssistService.js node_sidecar/src/services/craftAssistWorker.js node_sidecar/src/uiServer.js tests/fixtures/craftAssistCrashOnceWorker.js tests/craftAssistService.test.js tests/craftAssistWorkerPool.test.js
git commit -m "feat(craft): wire oversized prefilter into assist selection"
```

Expected: Commit succeeds with only the integration files staged.

### Task 8: Run the full regression gates

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistOversizedPrefilterCompare.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistShardPrefilter.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistSearch.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistWorkerPool.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistTimeoutConfig.test.js`

- [ ] **Step 1: Create the fixed-sample comparison gate that runs the baseline (`ENABLE_OVERSIZED_PREFILTER = false`) against the enabled override on the same recipe set and records success-rate / overall-gap / timing metrics**

```js
const baseline = await runComparisonSuite({enableOversizedPrefilter: false});
const optimized = await runComparisonSuite({enableOversizedPrefilter: true});
assert.equal(optimized.successRate + 0.01 >= baseline.successRate, true);
assert.equal(optimized.overallGapP95 <= 0.001, true);
```

- [ ] **Step 2: Run the new prefilter-focused test suite**

Run: `node "./tests/craftAssistShardPrefilter.test.js"`

Expected: PASS

- [ ] **Step 3: Re-run service, solver, and fixed-sample comparison suites**

Run: `node "./tests/craftAssistService.test.js"`

Expected: PASS

Run: `node "./tests/craftAssistSearch.test.js"`

Expected: PASS

Run: `node "./tests/craftAssistOversizedPrefilterCompare.test.js"`

Expected: PASS with logged acceptance metrics for success rate, overall gap, and mean latency delta.

- [ ] **Step 4: Re-run request-worker stability suites**

Run: `node "./tests/craftAssistWorkerPool.test.js"`

Expected: PASS

Run: `node "./tests/craftAssistTimeoutConfig.test.js"`

Expected: PASS

- [ ] **Step 5: Verify the rollout gate stays closed by default, then run a final diff check so only intended files changed**

Run: `node -e "const mod=require('./node_sidecar/src/services/craftAssistShardPrefilter'); console.log(mod.resolvePrefilterOptions().enableOversizedPrefilter)"`

Expected: Prints `false`

Run: `git status --short`

Expected: Only the new prefilter files, touched tests, and any intentional plan/doc files appear.
