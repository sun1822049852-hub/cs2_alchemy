const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const RUNNER_PATH = path.resolve(__dirname, "../output/playwright/local-offline-anchor-rolling-compare.js");

function loadRunnerOrNull() {
  try {
    return require(RUNNER_PATH);
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND" && String(error.message || "").includes(RUNNER_PATH)) {
      return null;
    }
    throw error;
  }
}

test("runner exports a callable comparison entry", () => {
  const runner = loadRunnerOrNull();
  assert.equal(!!runner, true, "runner module should exist");
  assert.equal(typeof runner.runLocalOfflineAnchorRollingCompare, "function");
});

test("default baseline selection context keeps allowed component candidates", () => {
  const runner = loadRunnerOrNull();
  assert.equal(!!runner, true, "runner module should exist");
  assert.equal(typeof runner.buildDefaultSelectionContextFromRows, "function");

  const rows = [
    {
      asset_id: "main-1",
      name: "Main Candidate",
      alchemy_name: "Main Candidate",
      float_value: 0.2,
      minfloat: 0,
      maxfloat: 1,
      rarity: 2,
      quality: 0,
      quality_name: "Normal",
      is_craftable: true,
      hidden_reason: "",
      casket_id: "",
      tradable_after: 0
    },
    {
      asset_id: "component-1",
      name: "Component Candidate",
      alchemy_name: "Component Candidate",
      float_value: 0.21,
      minfloat: 0,
      maxfloat: 1,
      rarity: 2,
      quality: 0,
      quality_name: "Normal",
      is_craftable: true,
      hidden_reason: "attr#272/273",
      casket_id: "storage-1",
      tradable_after: 0
    }
  ];

  const context = runner.buildDefaultSelectionContextFromRows(rows);
  const candidateIds = context.candidateRows.map((row) => String(row.asset_id));
  assert.deepEqual(candidateIds.sort(), ["component-1", "main-1"]);
  assert.equal(context.candidateContextStats.visible_candidate_count, 2);
  assert.equal(context.candidateContextStats.include_component_items, true);
});

test("optimized pipeline is labeled anchor rolling and never flips enableFastCraftAssist on", async () => {
  const runner = loadRunnerOrNull();
  assert.equal(!!runner, true, "runner module should exist");

  const selectCalls = [];
  const result = await runner.runLocalOfflineAnchorRollingCompare({
    sampleId: "eight-preserved-hunting-train-28-024"
  }, {
    loadSampleDefinition() {
      return {
        id: "eight-preserved-hunting-train-28-024",
        snapshot_path: "backup/processed_inventory/fake.json",
        preset_name: "Fake preset"
      };
    },
    loadSnapshotRows() {
      return [];
    },
    loadPreset() {
      return {
        name: "Fake preset",
        target_wear: 0.23999999463558197,
        target_wear_raw: "0.24",
        materials: []
      };
    },
    createBaselineService() {
      return {
        async selectForRecipe(args) {
          selectCalls.push(args);
          return {
            ok: true,
            overall: 0.239,
            item_ids: ["baseline-a", "baseline-b"]
          };
        }
      };
    },
    buildSelectionContext() {
      return {
        candidateRows: [],
        rowsByName: new Map(),
        rowsById: new Map(),
        candidateCache: new Map()
      };
    },
    runAnchorRollingPipeline() {
      return {
        variant: "anchor_rolling_filtered_baseline",
        ok: true,
        overall: 0.239,
        item_ids: ["baseline-a", "baseline-b"],
        fallback: false,
        fallback_reason: "",
        completion_passes: [
          {pass: 1, ok: true, improved: true, item_ids: ["seed-a"], reason: ""},
          {pass: 2, ok: true, improved: false, item_ids: ["seed-a"], reason: ""}
        ]
      };
    },
    now() {
      return 1000;
    },
    writeArtifacts() {
      return null;
    }
  });

  assert.equal(selectCalls.length, 1);
  assert.equal(selectCalls[0].enableFastCraftAssist, false);
  assert.equal(result.optimized.variant, "anchor_rolling_filtered_baseline");
});

test("item_ids_same uses exact ordered comparison instead of sorted set comparison", async () => {
  const runner = loadRunnerOrNull();
  assert.equal(!!runner, true, "runner module should exist");

  const result = await runner.runLocalOfflineAnchorRollingCompare({
    sampleId: "eight-preserved-hunting-train-28-024"
  }, {
    loadSampleDefinition() {
      return {
        id: "eight-preserved-hunting-train-28-024",
        snapshot_path: "backup/processed_inventory/fake.json",
        preset_name: "Fake preset"
      };
    },
    loadSnapshotRows() {
      return [];
    },
    loadPreset() {
      return {
        name: "Fake preset",
        target_wear: 0.23999999463558197,
        target_wear_raw: "0.24",
        materials: []
      };
    },
    createBaselineService() {
      return {
        async selectForRecipe() {
          return {
            ok: true,
            overall: 0.239,
            item_ids: ["a", "b", "c"]
          };
        }
      };
    },
    buildSelectionContext() {
      return {
        candidateRows: [],
        rowsByName: new Map(),
        rowsById: new Map(),
        candidateCache: new Map(),
        candidateContextStats: {}
      };
    },
    runAnchorRollingPipeline() {
      return {
        variant: "anchor_rolling_filtered_baseline",
        ok: true,
        overall: 0.239,
        item_ids: ["b", "a", "c"],
        fallback: false,
        fallback_reason: "",
        completion_passes: [
          {pass: 1, ok: true, improved: false, item_ids: [], reason: ""},
          {pass: 2, ok: true, improved: false, item_ids: [], reason: ""}
        ]
      };
    },
    now() {
      return 1000;
    },
    writeArtifacts() {
      return null;
    }
  });

  assert.equal(result.item_ids_same, false);
  assert.equal(result.final_source, "optimized");
});

test("fallback preserves the trial's own optimized status and marks final source separately", async () => {
  const runner = loadRunnerOrNull();
  assert.equal(!!runner, true, "runner module should exist");

  const result = await runner.runLocalOfflineAnchorRollingCompare({
    sampleId: "eight-preserved-hunting-train-28-024"
  }, {
    loadSampleDefinition() {
      return {
        id: "eight-preserved-hunting-train-28-024",
        snapshot_path: "backup/processed_inventory/fake.json",
        preset_name: "Fake preset"
      };
    },
    loadSnapshotRows() {
      return [];
    },
    loadPreset() {
      return {
        name: "Fake preset",
        target_wear: 0.23999999463558197,
        target_wear_raw: "0.24",
        materials: []
      };
    },
    createBaselineService() {
      return {
        async selectForRecipe() {
          return {
            ok: true,
            overall: 0.239,
            item_ids: ["baseline-a", "baseline-b"]
          };
        }
      };
    },
    buildSelectionContext() {
      return {
        candidateRows: [],
        rowsByName: new Map(),
        rowsById: new Map(),
        candidateCache: new Map(),
        candidateContextStats: {}
      };
    },
    runAnchorRollingPipeline() {
      return {
        variant: "anchor_rolling_filtered_baseline",
        ok: false,
        overall: 0.111,
        item_ids: ["trial-a", "trial-b"],
        fallback: true,
        fallback_reason: "seed_unavailable",
        completion_passes: [
          {pass: 1, ok: false, improved: false, item_ids: [], reason: "not_run"},
          {pass: 2, ok: false, improved: false, item_ids: [], reason: "not_run"}
        ]
      };
    },
    now() {
      return 1000;
    },
    writeArtifacts() {
      return null;
    }
  });

  assert.equal(result.optimized.ok, false);
  assert.equal(result.optimized.overall, 0.111);
  assert.deepEqual(result.optimized.item_ids, ["trial-a", "trial-b"]);
  assert.equal(result.fallback, true);
  assert.equal(result.final_source, "baseline");
});

test("runner rejects unsupported sample ids in this minimal one-sample version", async () => {
  const runner = loadRunnerOrNull();
  assert.equal(!!runner, true, "runner module should exist");

  let sampleLoaded = false;
  await assert.rejects(
    runner.runLocalOfflineAnchorRollingCompare({sampleId: "sun-current-hunting-train-28-024"}, {
      loadSampleDefinition() {
        sampleLoaded = true;
        return null;
      }
    }),
    /unsupported sample id/i
  );
  assert.equal(sampleLoaded, false);
});

test("internal fallback keeps the trial filtered result instead of baseline backfill", () => {
  const runner = loadRunnerOrNull();
  assert.equal(!!runner, true, "runner module should exist");
  assert.equal(typeof runner.runAnchorRollingPipelineInternal, "function");

  function makeSolved(ids, overall) {
    return {
      overall,
      materialResults: [
        {
          material: {role: "main", count: 1},
          selected: ids.map((id) => ({
            id,
            value: overall,
            row: {rarity: 2}
          }))
        }
      ]
    };
  }

  let searchCall = 0;
  const result = runner.runAnchorRollingPipelineInternal({
    rawGroups: [
      {
        index: 0,
        material: {role: "main", count: 1},
        candidates: [
          {id: "candidate-a", value: 0.1, row: {rarity: 2}},
          {id: "candidate-b", value: 0.2, row: {rarity: 2}}
        ]
      }
    ],
    targetValue: 0.2,
    targetStepSpec: null,
    baselineReference: {
      overall: 0.19,
      item_ids: ["baseline-a", "baseline-b"]
    }
  }, {
    searchSlidingAnchorDiagnostic() {
      return {
        ...makeSolved(["seed-a"], 0.17),
        trace: {steps: []}
      };
    },
    searchCraftAssistBestSolution() {
      searchCall += 1;
      if (searchCall >= 3) {
        return makeSolved(["trial-a", "trial-b"], 0.18);
      }
      return makeSolved(["trial-a", "trial-b"], 0.18);
    },
    isCraftAssistSolvedCandidate(candidate) {
      return !!candidate;
    }
  });

  assert.equal(result.fallback, true);
  assert.equal(result.fallback_reason, "accelerated_path_result_mismatch");
  assert.equal(result.ok, true);
  assert.equal(result.overall, 0.18);
  assert.deepEqual(result.item_ids, ["trial-a", "trial-b"]);
});

test("internal pipeline reports stage timings from injected clock values", () => {
  const runner = loadRunnerOrNull();
  assert.equal(!!runner, true, "runner module should exist");
  assert.equal(typeof runner.runAnchorRollingPipelineInternal, "function");

  function makeSolved(ids, overall) {
    return {
      overall,
      materialResults: [
        {
          material: {role: "main", count: 1},
          selected: ids.map((id) => ({
            id,
            value: overall,
            row: {rarity: 2}
          }))
        }
      ]
    };
  }

  const nowValues = [0, 5, 11, 20, 24, 30, 39, 50, 60, 70];
  let nowIndex = 0;
  const result = runner.runAnchorRollingPipelineInternal({
    rawGroups: [
      {
        index: 0,
        material: {role: "main", count: 1},
        candidates: [
          {id: "candidate-a", value: 0.1, row: {rarity: 2}},
          {id: "candidate-b", value: 0.2, row: {rarity: 2}}
        ]
      }
    ],
    targetValue: 0.2,
    targetStepSpec: null,
    baselineReference: null
  }, {
    nowMs() {
      const value = nowValues[nowIndex];
      nowIndex += 1;
      return value;
    },
    searchSlidingAnchorDiagnostic() {
      return {
        ...makeSolved(["seed-a"], 0.17),
        trace: {steps: []}
      };
    },
    searchCraftAssistBestSolution() {
      return makeSolved(["trial-a"], 0.18);
    },
    isCraftAssistSolvedCandidate(candidate) {
      return !!candidate;
    }
  });

  assert.deepEqual(result.timings, {
    seed_ms: 6,
    completion_pass_1_ms: 4,
    completion_pass_2_ms: 9,
    filtered_baseline_ms: 10,
    total_ms: 70
  });
});
