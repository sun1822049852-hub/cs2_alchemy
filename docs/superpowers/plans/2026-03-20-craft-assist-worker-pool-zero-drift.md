# Craft Assist Worker Pool Zero-Drift Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `/api/craft/assist-select` off the main thread into a fixed-size worker pool without changing any craft-assist selection results.

**Architecture:** Keep the current `craftAssistService` solver as the single authority for all selection logic and run that same module inside dedicated worker threads. Route `uiServer` requests through a small worker-pool service that sends `snapshotPath + request args` to workers, lets each worker load and cache snapshot rows locally, and preserves the current HTTP contract byte-for-byte at the API boundary.

**Tech Stack:** Node.js CommonJS, `worker_threads`, plain JavaScript, existing `node:assert/strict` test scripts, existing `uiServer` API, existing craft-assist service/cache helpers.

---

> Repo instruction note: do not add git commit steps unless the user explicitly asks. This plan intentionally omits commit tasks.

## File Map

- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/snapshotRowsLoader.js`
  - Shared snapshot read/parse/cache helper used by both `uiServer` and craft-assist workers.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistWorker.js`
  - Worker thread entrypoint that loads snapshot rows and calls `createCraftAssistService({logger: null})`.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistWorkerPool.js`
  - Fixed-size worker pool, FIFO queue, timeout handling, worker restart, stale-response dropping.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js`
  - Replace main-thread `craftAssistService.selectForRecipe(...)` execution with worker-pool dispatch while preserving the same request validation and response shape.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistService.js`
  - Only if needed to expose a stable worker-facing entry or shared helpers; do not alter solver behavior.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistWorkerPool.test.js`
  - Regression tests for zero-drift worker results, snapshot cache invalidation, timeout, and worker restart behavior.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`
  - Keep existing service-level solver regression coverage green.

## Chunk 1: Lock Zero-Drift Behavior With Tests

### Task 1: Add the worker-pool regression harness

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistWorkerPool.test.js`
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`

- [ ] **Step 1: Write a temporary-snapshot helper that saves deterministic test rows to disk**

```js
function writeSnapshot(filePath, items) {
  fs.writeFileSync(filePath, JSON.stringify({
    format: 1,
    generated_at: "test",
    item_count: items.length,
    items
  }, null, 2));
}
```

- [ ] **Step 2: Write a failing test that compares direct solver output with worker-pool output**

```js
async function test_worker_pool_matches_direct_selection() {
  const direct = selectCraftAssistForRecipe({...args, rows});
  const viaPool = await pool.selectForRecipe({...args, snapshotPath});
  assert.deepEqual(viaPool, direct);
}
```

- [ ] **Step 3: Run the new test file to verify it fails because the worker pool does not exist yet**

Run: `node "./tests/craftAssistWorkerPool.test.js"`

Expected: FAIL with module-not-found or missing-function error for the new worker-pool module.

### Task 2: Add failing cache-invalidation and recovery tests

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistWorkerPool.test.js`

- [ ] **Step 1: Add a snapshot rewrite test that updates the same `snapshotPath` and expects the worker result to change to the new direct result**

```js
async function test_worker_pool_reloads_snapshot_after_file_change() {
  writeSnapshot(snapshotPath, firstItems);
  const first = await pool.selectForRecipe({...args, snapshotPath});
  writeSnapshot(snapshotPath, secondItems);
  const second = await pool.selectForRecipe({...args, snapshotPath});
  assert.notDeepEqual(second.item_ids, first.item_ids);
  assert.deepEqual(second, selectCraftAssistForRecipe({...args, rows: secondItems}));
}
```

- [ ] **Step 2: Add a timeout test using a dedicated slow worker fixture**

```js
await assert.rejects(
  () => pool.selectForRecipe({snapshotPath, debugMode: "delay"}),
  /timeout/i
);
```

- [ ] **Step 3: Add a worker-crash recovery test using a dedicated crashing worker fixture**

```js
const result = await pool.selectForRecipe({snapshotPath, debugMode: "crash_once"});
assert.deepEqual(result, direct);
```

- [ ] **Step 4: Run the test file again and verify the failures are still feature-missing failures**

Run: `node "./tests/craftAssistWorkerPool.test.js"`

Expected: FAIL because the worker pool/recovery path is not implemented yet, not because the tests are syntactically broken.

## Chunk 2: Build Shared Snapshot Loading And Worker Execution

### Task 3: Extract shared snapshot read/parse/cache logic

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/snapshotRowsLoader.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js`

- [ ] **Step 1: Move the current `snapshotRowsCache` logic out of `uiServer.js` into a reusable factory**

```js
function createSnapshotRowsLoader({limit = 6} = {}) {
  const cache = new Map();
  return {
    loadSnapshotRows(snapshotPath) { ... },
    loadSnapshotRowsAsync(snapshotPath) { ... }
  };
}
```

- [ ] **Step 2: Rewire `uiServer.js` to use the shared loader without changing its external behavior**

Run: `node --check node_sidecar/src/uiServer.js`

Expected: PASS

### Task 4: Implement the craft-assist worker entrypoint

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistWorker.js`
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistService.js`

- [ ] **Step 1: Create a `worker_threads` entry that listens on `parentPort`**

```js
parentPort.on("message", async (message) => {
  if (!message || message.type !== "select") return;
  ...
});
```

- [ ] **Step 2: Load rows by `snapshotPath` inside the worker and call the existing service solver**

```js
const rows = await snapshotRowsLoader.loadSnapshotRowsAsync(snapshotPath);
const result = craftAssistService.selectForRecipe({...payload, rows});
```

- [ ] **Step 3: Return `{requestId, ok, result}` or `{requestId, ok: false, error}` without changing result fields**

Run: `node --check node_sidecar/src/services/craftAssistWorker.js`

Expected: PASS

## Chunk 3: Build The Fixed-Size Worker Pool And Wire The API

### Task 5: Implement the worker pool

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/craftAssistWorkerPool.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistWorkerPool.test.js`

- [ ] **Step 1: Build a fixed-size worker pool with FIFO queue and per-worker busy state**

```js
function createCraftAssistWorkerPool({size = 2, requestTimeoutMs = 30000, workerPath = DEFAULT_WORKER_PATH} = {}) {
  return {
    selectForRecipe(args) { ... },
    close() { ... }
  };
}
```

- [ ] **Step 2: Add timeout handling that rejects the active request, terminates the worker, and respawns it**

- [ ] **Step 3: Add one-time retry on worker crash for in-flight tasks**

- [ ] **Step 4: Drop stale responses by `requestId` so timed-out/retired workers cannot write back old results**

- [ ] **Step 5: Run the worker-pool tests and make them pass**

Run: `node "./tests/craftAssistWorkerPool.test.js"`

Expected: PASS

### Task 6: Wire `/api/craft/assist-select` to the worker pool with a fallback switch

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js`

- [ ] **Step 1: Instantiate the worker pool near other long-lived services**

```js
const craftAssistWorkerPool = createCraftAssistWorkerPool({logger});
const CRAFT_ASSIST_USE_WORKER_POOL = process.env.CRAFT_ASSIST_USE_WORKER_POOL !== "0";
```

- [ ] **Step 2: Change `/api/craft/assist-select` to dispatch to the pool when enabled**

```js
const result = CRAFT_ASSIST_USE_WORKER_POOL
  ? await craftAssistWorkerPool.selectForRecipe({snapshotPath, ...workerArgs})
  : craftAssistService.selectForRecipe({...workerArgs, rows: loaded.rows});
```

- [ ] **Step 3: Keep the current response shape and status handling exactly the same**

- [ ] **Step 4: Shut down the pool during process exit**

Run: `node --check node_sidecar/src/uiServer.js`

Expected: PASS

## Chunk 4: Verify Zero-Drift Results And Stability

### Task 7: Run the full regression gates

**Files:**
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistWorkerPool.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistService.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/craftAssistSearch.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/uiCraftAssistSingleSource.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-queue-preview.test.js`

- [ ] **Step 1: Run the new worker-pool regression suite**

Run: `node "./tests/craftAssistWorkerPool.test.js"`

Expected: PASS

- [ ] **Step 2: Re-run existing craft-assist backend suites**

Run: `node "./tests/craftAssistService.test.js"`

Expected: PASS

Run: `node "./tests/craftAssistSearch.test.js"`

Expected: PASS

- [ ] **Step 3: Re-run UI-facing guard tests**

Run: `node "./tests/uiCraftAssistSingleSource.test.js"`

Expected: PASS

Run: `node "./node_sidecar/tests/craft-queue-preview.test.js"`

Expected: PASS

### Task 8: Check real-snapshot zero-drift parity

**Files:**
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/inventory_ui_state.json`
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/logs/processed_inventory/`

- [ ] **Step 1: Compare direct vs worker-pool results for at least one single-material preset and one multi-material preset using the current saved snapshot**

Run: custom `node -e` parity script comparing `111` and `555555`

Expected: identical `item_ids / overall / rarity / selection_trace`

- [ ] **Step 2: Capture timing deltas so the implementation can be evaluated honestly**

Run: custom `node -e` benchmark for `direct_rows` vs `worker_pool`

Expected: main-thread path no longer blocks on worker execution; total result parity preserved.

## Plan Notes

- Do not change `craftAssistService` selection semantics while building the worker pool.
- Do not add approximation, candidate pruning, or scoring changes in this pass.
- Prefer tiny worker-pool internals over a generic job framework; YAGNI applies.
- If any worker-pool test reveals result drift, stop and fix parity before pursuing performance tuning.
