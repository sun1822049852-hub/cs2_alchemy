const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {selectCraftAssistForRecipe} = require("../node_sidecar/src/services/craftAssistService");
const {createCraftAssistWorkerPool} = require("../node_sidecar/src/services/craftAssistWorkerPool");

const CRASH_FIXTURE_PATH = path.join(__dirname, "fixtures", "craftAssistCrashOnceWorker.js");
const TIMEOUT_FIXTURE_PATH = path.join(__dirname, "fixtures", "craftAssistTimeoutWorker.js");

function makeRow({
  id,
  name,
  relative,
  rarity = 4,
  min = 0,
  max = 1
}) {
  return {
    asset_id: String(id),
    name,
    alchemy_name: name,
    float_value: min + (max - min) * relative,
    minfloat: min,
    maxfloat: max,
    rarity,
    quality: 0,
    quality_name: "Normal",
    is_craftable: true,
    hidden_reason: "",
    casket_id: "",
    tradable_after: 0
  };
}

function writeSnapshot(filePath, items) {
  fs.writeFileSync(filePath, JSON.stringify({
    format: 1,
    generated_at: "test",
    item_count: items.length,
    items
  }, null, 2));
}

async function withTempDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "craft-assist-worker-pool-"));
  try {
    return await run(dir);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

async function withEnv(envMap, run) {
  const prev = new Map();
  for (const [key, value] of Object.entries(envMap || {})) {
    prev.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of prev.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function makeDirectArgs(rows, overrides = {}) {
  return {
    rows,
    targetWear: 0.21,
    wearFilterMode: "relative",
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 2, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 8, wear_min: 0, wear_max: 1}
    ],
    blockedIds: [],
    includeCooling: false,
    wearOffsetPct: 100,
    ...overrides
  };
}

function makeSnapshotArgs(snapshotPath, overrides = {}) {
  return {
    snapshotPath,
    targetWear: 0.21,
    wearFilterMode: "relative",
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 2, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 8, wear_min: 0, wear_max: 1}
    ],
    blockedIds: [],
    includeCooling: false,
    wearOffsetPct: 100,
    ...overrides
  };
}

function makeInlineCandidateArgs(rows, overrides = {}) {
  return {
    candidateRows: rows,
    targetWear: 0.21,
    wearFilterMode: "relative",
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 2, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 8, wear_min: 0, wear_max: 1}
    ],
    blockedIds: [],
    includeCooling: false,
    wearOffsetPct: 100,
    ...overrides
  };
}

function baseRows() {
  return [
    makeRow({id: "m1", name: "Main", relative: 0.24}),
    makeRow({id: "m2", name: "Main", relative: 0.245}),
    makeRow({id: "m3", name: "Main", relative: 0.246}),
    makeRow({id: "a1", name: "Aux", relative: 0.209}),
    makeRow({id: "a2", name: "Aux", relative: 0.208}),
    makeRow({id: "a3", name: "Aux", relative: 0.207}),
    makeRow({id: "a4", name: "Aux", relative: 0.206}),
    makeRow({id: "a5", name: "Aux", relative: 0.205}),
    makeRow({id: "a6", name: "Aux", relative: 0.204}),
    makeRow({id: "a7", name: "Aux", relative: 0.203}),
    makeRow({id: "a8", name: "Aux", relative: 0.202}),
    makeRow({id: "a9", name: "Aux", relative: 0.201}),
    makeRow({id: "a10", name: "Aux", relative: 0.200}),
    makeRow({id: "a11", name: "Aux", relative: 0.199}),
    makeRow({id: "a12", name: "Aux", relative: 0.198})
  ];
}

function oversizedRows() {
  const rows = [
    makeRow({id: "m1", name: "Main", relative: 0.245}),
    makeRow({id: "m2", name: "Main", relative: 0.244}),
    makeRow({id: "m3", name: "Main", relative: 0.243})
  ];
  for (let index = 0; index < 60; index += 1) {
    rows.push(makeRow({
      id: `a${index + 1}`,
      name: "Aux",
      relative: 0.198 + index * 0.00035
    }));
  }
  return rows;
}

async function test_worker_pool_matches_direct_selection() {
  await withTempDir(async (dir) => {
    const rows = baseRows();
    const snapshotPath = path.join(dir, "snapshot.json");
    writeSnapshot(snapshotPath, rows);
    const pool = createCraftAssistWorkerPool({size: 2, requestTimeoutMs: 2000});
    try {
      const direct = await selectCraftAssistForRecipe(makeDirectArgs(rows));
      const viaPool = await pool.selectForRecipe(makeSnapshotArgs(snapshotPath));
      assert.deepEqual(viaPool, direct);
    } finally {
      await pool.close();
    }
  });
}

async function test_worker_pool_accepts_inline_candidate_rows() {
  const rows = baseRows();
  const pool = createCraftAssistWorkerPool({size: 1, requestTimeoutMs: 2000});
  try {
    const direct = await selectCraftAssistForRecipe(makeDirectArgs(rows));
    const viaPool = await pool.selectForRecipe(makeInlineCandidateArgs(rows));
    assert.deepEqual(viaPool, direct);
  } finally {
    await pool.close();
  }
}

async function test_worker_pool_reloads_snapshot_after_file_change() {
  await withTempDir(async (dir) => {
    const snapshotPath = path.join(dir, "snapshot.json");
    const firstRows = baseRows();
    writeSnapshot(snapshotPath, firstRows);
    const pool = createCraftAssistWorkerPool({size: 1, requestTimeoutMs: 2000});
    try {
      const first = await pool.selectForRecipe(makeSnapshotArgs(snapshotPath));
      const secondRows = baseRows();
      secondRows[0] = makeRow({id: "m1", name: "Main", relative: 0.21});
      secondRows[1] = makeRow({id: "m2", name: "Main", relative: 0.211});
      writeSnapshot(snapshotPath, secondRows);
      const now = new Date(Date.now() + 2000);
      fs.utimesSync(snapshotPath, now, now);
      const second = await pool.selectForRecipe(makeSnapshotArgs(snapshotPath));
      const direct = await selectCraftAssistForRecipe(makeDirectArgs(secondRows));
      assert.notDeepEqual(second.item_ids, first.item_ids);
      assert.deepEqual(second, direct);
    } finally {
      await pool.close();
    }
  });
}

async function test_worker_pool_times_out_and_rejects() {
  await withTempDir(async (dir) => {
    const snapshotPath = path.join(dir, "snapshot.json");
    writeSnapshot(snapshotPath, baseRows());
    const pool = createCraftAssistWorkerPool({
      size: 1,
      requestTimeoutMs: 50,
      workerPath: TIMEOUT_FIXTURE_PATH
    });
    try {
      await assert.rejects(
        () => pool.selectForRecipe({
          ...makeSnapshotArgs(snapshotPath),
          delayMs: 200
        }),
        /timeout/i
      );
    } finally {
      await pool.close();
    }
  });
}

async function test_worker_pool_retries_once_after_worker_crash() {
  await withTempDir(async (dir) => {
    const rows = baseRows();
    const snapshotPath = path.join(dir, "snapshot.json");
    const crashMarkerPath = path.join(dir, "crash-once.marker");
    writeSnapshot(snapshotPath, rows);
    const direct = await selectCraftAssistForRecipe(makeDirectArgs(rows));
    const pool = createCraftAssistWorkerPool({
      size: 1,
      requestTimeoutMs: 2000,
      workerPath: CRASH_FIXTURE_PATH,
      maxTaskRetries: 1
    });
    try {
      const result = await pool.selectForRecipe({
        ...makeSnapshotArgs(snapshotPath),
        crashMarkerPath
      });
      assert.deepEqual(result, direct);
    } finally {
      await pool.close();
    }
  });
}

async function test_worker_pool_handles_nested_prefilter_workers() {
  await withEnv({
    ENABLE_OVERSIZED_PREFILTER: "1",
    OVERSIZED_2_SHARDS_THRESHOLD: "20",
    OVERSIZED_4_SHARDS_THRESHOLD: "9999",
    SHARD_TOP_K: "20",
    SHARD_EDGE_KEEP_PER_SIDE: "2",
    EXPAND_SHARD_TOP_K: "40",
    EXPAND_SHARD_EDGE_KEEP_PER_SIDE: "4",
    SHORTLIST_MIN: "24",
    SHORTLIST_PER_REQUIRED: "4",
    SHORTLIST_HARD_MAX: "80"
  }, async () => {
    await withTempDir(async (dir) => {
      const rows = oversizedRows();
      const snapshotPath = path.join(dir, "oversized.json");
      writeSnapshot(snapshotPath, rows);
      const pool = createCraftAssistWorkerPool({size: 1, requestTimeoutMs: 4000});
      try {
        const direct = await selectCraftAssistForRecipe(makeDirectArgs(rows, {enableFastCraftAssist: true}));
        const viaPool = await pool.selectForRecipe(makeSnapshotArgs(snapshotPath, {enableFastCraftAssist: true}));
        assert.equal(!!(direct.selection_trace && direct.selection_trace.prefilter), true);
        assert.equal(!!(viaPool.selection_trace && viaPool.selection_trace.prefilter), true);
        assert.deepEqual(viaPool.item_ids, direct.item_ids);
        assert.equal(viaPool.overall, direct.overall);
        assert.equal(viaPool.rarity, direct.rarity);
        assert.equal(viaPool.recipe_text, direct.recipe_text);
      } finally {
        await pool.close();
      }
    });
  });
}

(async () => {
  await test_worker_pool_matches_direct_selection();
  await test_worker_pool_accepts_inline_candidate_rows();
  await test_worker_pool_reloads_snapshot_after_file_change();
  await test_worker_pool_times_out_and_rejects();
  await test_worker_pool_retries_once_after_worker_crash();
  await test_worker_pool_handles_nested_prefilter_workers();
  console.log("craftAssistWorkerPool tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
