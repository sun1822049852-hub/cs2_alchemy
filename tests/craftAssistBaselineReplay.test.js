const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {resolveCraftAssistTargetStepSpec} = require("../node_sidecar/src/services/craftAssistFloat32Step");

const RUNNER_PATH = path.resolve(__dirname, "../output/playwright/craft-assist-baseline-replay.js");
const SEARCH_MODULE_PATH = path.resolve(__dirname, "../node_sidecar/src/services/craftAssistSearch.js");
const PRESERVED_SNAPSHOT_RELATIVE = "backup/processed_inventory/frozen-test.preserved_for_fixture.json";
const PRELOADED_SNAPSHOT_RELATIVE = "backup/processed_inventory/preloaded-test.preserved_for_fixture.json";

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

function makeFrozenArtifact({
  snapshotRelativePath = PRESERVED_SNAPSHOT_RELATIVE,
  presetName = "Frozen preset",
  payload,
  targetStepSpec,
  preset = null
} = {}) {
  return {
    snapshot_path: path.resolve("C:/Users/18220/Desktop/cs2_alchemy", snapshotRelativePath),
    preset_name: presetName,
    preset: preset || {name: presetName},
    payload,
    target_step_spec: targetStepSpec
  };
}

function makeFrozenPayload() {
  return {
    username: "countsteam6",
    target_wear_raw: "0.24",
    target_wear: 0.23999999463558197,
    wear_filter_mode: "relative",
    wear_approach_mode: "below",
    use_component_items: true,
    include_component_items: true,
    include_cooling: false,
    wear_offset_pct: 1,
    enable_fast_craft_assist: false,
    blocked_ids: [],
    selected_item_ids: [],
    materials: [
      {
        id: "material-main",
        role: "main",
        count: 10,
        items: [
          {
            id: "material-main__solo__1",
            name: "Solo",
            wear_filter_mode: "relative",
            wear_min: 0,
            wear_max: 1,
            custom_range: false
          }
        ],
        direction: "gt"
      }
    ]
  };
}

function makeFrozenTargetStepSpec(payload) {
  return resolveCraftAssistTargetStepSpec({
    inputStep: payload.target_wear,
    inputRaw: payload.target_wear_raw,
    approachMode: payload.wear_approach_mode,
    offsetValue: Number(payload.target_wear) * (Number(payload.wear_offset_pct) / 100)
  });
}

test("runner exports a callable baseline replay entry", () => {
  const runner = loadRunnerOrNull();
  assert.equal(!!runner, true, "runner module should exist");
  assert.equal(typeof runner.runCraftAssistBaselineReplay, "function");
  assert.equal(typeof runner.main, "function");
});

test("cli --only selects the requested sample id", async () => {
  const runner = loadRunnerOrNull();
  assert.equal(!!runner, true, "runner module should exist");

  const seen = [];
  await runner.main(["--only", "eight-preserved-hunting-train-37-027"], {
    runCraftAssistBaselineReplay(options) {
      seen.push(options);
      return {sample_id: options.sampleId};
    }
  });

  assert.deepEqual(seen, [{sampleId: "eight-preserved-hunting-train-37-027"}]);
});

test("runner rejects unsupported sample ids before loading sample data", async () => {
  const runner = loadRunnerOrNull();
  assert.equal(!!runner, true, "runner module should exist");

  let sampleLoaded = false;
  await assert.rejects(
    runner.runCraftAssistBaselineReplay({sampleId: "sun-current-hunting-train-28-024"}, {
      loadSampleDefinition() {
        sampleLoaded = true;
        return null;
      }
    }),
    /unsupported sample id/i
  );
  assert.equal(sampleLoaded, false);
});

test("runner uses frozen artifact payload and target step spec without calling loadPreset", async () => {
  const runner = loadRunnerOrNull();
  assert.equal(!!runner, true, "runner module should exist");

  const sampleSnapshotRelative = "backup/processed_inventory/./frozen-test.preserved_for_fixture.json";
  const payload = makeFrozenPayload();
  const targetStepSpec = {
    inputStep: 0.24,
    inputRaw: "0.24",
    targetStep: 0.23999999463558197
  };
  const frozenArtifact = makeFrozenArtifact({
    payload,
    targetStepSpec,
    preset: {id: "preset-1", name: "Frozen preset"}
  });
  const selectCalls = [];
  const snapshotLoadArgs = [];
  let recomputeCalled = false;
  const result = await runner.runCraftAssistBaselineReplay({
    sampleId: "eight-preserved-hunting-train-28-024"
  }, {
    loadSampleDefinition() {
      return {
        id: "eight-preserved-hunting-train-28-024",
        username: "countsteam6",
        snapshot_path: sampleSnapshotRelative,
        preset_name: "Fake preset"
      };
    },
    loadFrozenArtifact() {
      return frozenArtifact;
    },
    loadSnapshotRows(snapshotPath) {
      snapshotLoadArgs.push(snapshotPath);
      return [{asset_id: "candidate-1"}];
    },
    loadPreset() {
      throw new Error("loadPreset should not be called");
    },
    buildCandidateContext() {
      return {
        candidateRows: [{asset_id: "candidate-1"}],
        stats: {
          visible_candidate_count: 1,
          include_component_items: true
        }
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
    resolveTargetStepSpec() {
      recomputeCalled = true;
      return {targetStep: 0.1};
    },
    createSearchProfileCollector() {
      return {
        summarize() {
          return {
            search_call_count: 1,
            event_count: 2,
            phase_counts: [{phase: "beam_cap", count: 2}]
          };
        },
        restore() {}
      };
    },
    nowMs: (() => {
      const values = [100, 130, 142, 180];
      let index = 0;
      return () => {
        const value = values[index];
        index += 1;
        return value;
      };
    })(),
    writeArtifacts(resultPayload) {
      assert.equal(resultPayload.sample_id, "eight-preserved-hunting-train-28-024");
      return {
        script: RUNNER_PATH,
        json: "C:/tmp/baseline.json",
        md: "C:/tmp/baseline.md"
      };
    }
  });

  assert.equal(selectCalls.length, 1);
  assert.equal(recomputeCalled, false);
  assert.deepEqual(snapshotLoadArgs, [frozenArtifact.snapshot_path]);
  assert.equal(selectCalls[0].enableFastCraftAssist, false);
  assert.equal(selectCalls[0].targetWear, payload.target_wear);
  assert.equal(selectCalls[0].targetWearRaw, payload.target_wear_raw);
  assert.deepEqual(selectCalls[0].materials, payload.materials);
  assert.deepEqual(result.target_step_spec, targetStepSpec);
  assert.equal(result.sample_id, "eight-preserved-hunting-train-28-024");
  assert.equal(result.snapshot_path, path.resolve("C:/Users/18220/Desktop/cs2_alchemy", PRESERVED_SNAPSHOT_RELATIVE));
  assert.equal(result.preset.name, "Frozen preset");
  assert.equal(result.baseline.ok, true);
  assert.equal(result.baseline.overall, 0.239);
  assert.deepEqual(result.baseline.item_ids, ["baseline-a", "baseline-b"]);
  assert.equal(result.duration_ms, 80);
  assert.equal(result.service_duration_ms, 12);
  assert.deepEqual(result.candidate_context_stats, {
    visible_candidate_count: 1,
    include_component_items: true
  });
  assert.deepEqual(result.beam_profile_summary, {
    search_call_count: 1,
    event_count: 2,
    phase_counts: [{phase: "beam_cap", count: 2}]
  });
  assert.equal(Object.prototype.hasOwnProperty.call(result, "search_profile_summary"), false);
  assert.deepEqual(result.artifacts, {
    script: RUNNER_PATH,
    json: "C:/tmp/baseline.json",
    md: "C:/tmp/baseline.md"
  });
  assert.equal(result.target_step_spec_source, "frozen_artifact");
});

test("runner rejects snapshot mismatch between sample index and frozen artifact", async () => {
  const runner = loadRunnerOrNull();
  assert.equal(!!runner, true, "runner module should exist");

  let snapshotLoaded = false;
  await assert.rejects(
    runner.runCraftAssistBaselineReplay({
      sampleId: "eight-preserved-hunting-02142"
    }, {
      loadSampleDefinition() {
        return {
          id: "eight-preserved-hunting-02142",
          username: "countsteam6",
          snapshot_path: PRESERVED_SNAPSHOT_RELATIVE,
          preset_name: "Mismatch preset"
        };
      },
      loadFrozenArtifact() {
        return makeFrozenArtifact({
          snapshotRelativePath: "backup/processed_inventory/other.preserved_for_fixture.json",
          payload: makeFrozenPayload(),
          targetStepSpec: {targetStep: 0.1}
        });
      },
      loadSnapshotRows() {
        snapshotLoaded = true;
        return [];
      }
    }),
    /snapshot_path mismatch/i
  );
  assert.equal(snapshotLoaded, false);
});

test("runner rejects non-preserved snapshot paths before loading rows", async () => {
  const runner = loadRunnerOrNull();
  assert.equal(!!runner, true, "runner module should exist");

  let snapshotLoaded = false;
  await assert.rejects(
    runner.runCraftAssistBaselineReplay({
      sampleId: "eight-preserved-hunting-02142"
    }, {
      loadSampleDefinition() {
        return {
          id: "eight-preserved-hunting-02142",
          username: "countsteam6",
          snapshot_path: "backup/processed_inventory/not-preserved.json",
          preset_name: "Bad snapshot"
        };
      },
      loadFrozenArtifact() {
        return makeFrozenArtifact({
          snapshotRelativePath: "backup/processed_inventory/not-preserved.json",
          payload: makeFrozenPayload(),
          targetStepSpec: {targetStep: 0.1}
        });
      },
      loadSnapshotRows() {
        snapshotLoaded = true;
        return [];
      }
    }),
    /preserved snapshot/i
  );
  assert.equal(snapshotLoaded, false);
});

test("runner rejects frozen artifact with missing required payload fields", async () => {
  const runner = loadRunnerOrNull();
  assert.equal(!!runner, true, "runner module should exist");

  const badPayload = makeFrozenPayload();
  delete badPayload.target_wear_raw;

  await assert.rejects(
    runner.runCraftAssistBaselineReplay({
      sampleId: "eight-preserved-hunting-02142"
    }, {
      loadSampleDefinition() {
        return {
          id: "eight-preserved-hunting-02142",
          username: "countsteam6",
          snapshot_path: PRESERVED_SNAPSHOT_RELATIVE,
          preset_name: "Bad payload preset"
        };
      },
      loadFrozenArtifact() {
        return makeFrozenArtifact({
          payload: badPayload,
          targetStepSpec: {targetStep: 0.1}
        });
      }
    }),
    /frozen artifact field payload\.target_wear_raw/i
  );
});

test("runner recomputes target step spec from frozen payload when frozen artifact is missing it", async () => {
  const runner = loadRunnerOrNull();
  assert.equal(!!runner, true, "runner module should exist");

  const payload = makeFrozenPayload();
  const recomputedTargetStepSpec = {
    inputStep: payload.target_wear,
    inputRaw: payload.target_wear_raw,
    targetStep: 0.2399999052286148
  };
  const selectCalls = [];
  let loadPresetCalled = false;
  let recomputeArgs = null;

  const result = await runner.runCraftAssistBaselineReplay({
    sampleId: "eight-preserved-hunting-02142"
  }, {
    loadSampleDefinition() {
      return {
        id: "eight-preserved-hunting-02142",
        username: "countsteam6",
        snapshot_path: PRESERVED_SNAPSHOT_RELATIVE,
        preset_name: "Missing target-step preset"
      };
    },
    loadFrozenArtifact() {
      return {
        snapshot_path: path.resolve("C:/Users/18220/Desktop/cs2_alchemy", PRESERVED_SNAPSHOT_RELATIVE),
        preset_name: "Missing target-step preset",
        payload
      };
    },
    loadSnapshotRows() {
      return [{asset_id: "candidate-1"}];
    },
    loadPreset() {
      loadPresetCalled = true;
      throw new Error("loadPreset should not be called");
    },
    buildCandidateContext() {
      return {
        candidateRows: [{asset_id: "candidate-1"}],
        stats: {
          visible_candidate_count: 1,
          include_component_items: true
        }
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
    resolveTargetStepSpec(args) {
      recomputeArgs = args;
      return recomputedTargetStepSpec;
    },
    createSearchProfileCollector() {
      return {
        summarize() {
          return {
            search_call_count: 0,
            event_count: 0,
            phase_counts: [],
            top_stop_reasons: []
          };
        },
        restore() {}
      };
    },
    writeArtifacts() {
      return {
        script: RUNNER_PATH,
        json: "C:/tmp/recomputed-baseline.json",
        md: "C:/tmp/recomputed-baseline.md"
      };
    }
  });

  assert.equal(loadPresetCalled, false);
  assert.equal(selectCalls.length, 1);
  assert.deepEqual(recomputeArgs, {
    inputStep: payload.target_wear,
    inputRaw: payload.target_wear_raw,
    approachMode: payload.wear_approach_mode,
    offsetValue: Number(payload.target_wear) * (Number(payload.wear_offset_pct) / 100)
  });
  assert.deepEqual(result.target_step_spec, recomputedTargetStepSpec);
  assert.equal(result.target_step_spec_source, "recomputed_from_frozen_payload");
});

test("runner still collects beam profile summary after service and search were preloaded in-process", async () => {
  require("../node_sidecar/src/services/craftAssistSearch");
  require("../node_sidecar/src/services/craftAssistService");

  const runner = loadRunnerOrNull();
  assert.equal(!!runner, true, "runner module should exist");

  const payload = makeFrozenPayload();
  const targetStepSpec = makeFrozenTargetStepSpec(payload);
  const rows = [
    makeRow({id: "solo-01", name: "Solo", relative: 0.20}),
    makeRow({id: "solo-02", name: "Solo", relative: 0.205}),
    makeRow({id: "solo-03", name: "Solo", relative: 0.21}),
    makeRow({id: "solo-04", name: "Solo", relative: 0.215}),
    makeRow({id: "solo-05", name: "Solo", relative: 0.22}),
    makeRow({id: "solo-06", name: "Solo", relative: 0.225}),
    makeRow({id: "solo-07", name: "Solo", relative: 0.23}),
    makeRow({id: "solo-08", name: "Solo", relative: 0.235}),
    makeRow({id: "solo-09", name: "Solo", relative: 0.236}),
    makeRow({id: "solo-10", name: "Solo", relative: 0.237}),
    makeRow({id: "solo-11", name: "Solo", relative: 0.238}),
    makeRow({id: "solo-12", name: "Solo", relative: 0.239})
  ];

  const result = await runner.runCraftAssistBaselineReplay({
    sampleId: "eight-preserved-hunting-02142"
  }, {
    loadSampleDefinition() {
      return {
        id: "eight-preserved-hunting-02142",
        username: "countsteam6",
        snapshot_path: PRELOADED_SNAPSHOT_RELATIVE,
        preset_name: "Preloaded preset"
      };
    },
    loadFrozenArtifact() {
      return makeFrozenArtifact({
        snapshotRelativePath: PRELOADED_SNAPSHOT_RELATIVE,
        presetName: "Preloaded preset",
        payload,
        targetStepSpec
      });
    },
    loadSnapshotRows() {
      return rows;
    },
    writeArtifacts() {
      return {
        script: RUNNER_PATH,
        json: "C:/tmp/preloaded-baseline.json",
        md: "C:/tmp/preloaded-baseline.md"
      };
    }
  });

  assert.equal(typeof result.baseline.ok, "boolean");
  assert.equal(result.beam_profile_summary.event_count > 0, true);
  assert.equal(Array.isArray(result.beam_profile_summary.phase_counts), true);
  assert.equal(result.beam_profile_summary.phase_counts.some((entry) => entry && entry.phase === "beam_cap"), true);
  assert.equal(Array.isArray(result.beam_profile_summary.top_stop_reasons), true);
});

test("runner clears wrapped search module from require cache after restore", async () => {
  const runner = loadRunnerOrNull();
  assert.equal(!!runner, true, "runner module should exist");

  const payload = makeFrozenPayload();
  const targetStepSpec = makeFrozenTargetStepSpec(payload);
  const rows = [
    makeRow({id: "solo-01", name: "Solo", relative: 0.20}),
    makeRow({id: "solo-02", name: "Solo", relative: 0.205}),
    makeRow({id: "solo-03", name: "Solo", relative: 0.21}),
    makeRow({id: "solo-04", name: "Solo", relative: 0.215}),
    makeRow({id: "solo-05", name: "Solo", relative: 0.22}),
    makeRow({id: "solo-06", name: "Solo", relative: 0.225}),
    makeRow({id: "solo-07", name: "Solo", relative: 0.23}),
    makeRow({id: "solo-08", name: "Solo", relative: 0.235}),
    makeRow({id: "solo-09", name: "Solo", relative: 0.236}),
    makeRow({id: "solo-10", name: "Solo", relative: 0.237}),
    makeRow({id: "solo-11", name: "Solo", relative: 0.238}),
    makeRow({id: "solo-12", name: "Solo", relative: 0.239})
  ];

  await runner.runCraftAssistBaselineReplay({
    sampleId: "eight-preserved-hunting-02142"
  }, {
    loadSampleDefinition() {
      return {
        id: "eight-preserved-hunting-02142",
        username: "countsteam6",
        snapshot_path: PRELOADED_SNAPSHOT_RELATIVE,
        preset_name: "Cache cleanup preset"
      };
    },
    loadFrozenArtifact() {
      return makeFrozenArtifact({
        snapshotRelativePath: PRELOADED_SNAPSHOT_RELATIVE,
        presetName: "Cache cleanup preset",
        payload,
        targetStepSpec
      });
    },
    loadSnapshotRows() {
      return rows;
    },
    writeArtifacts() {
      return {
        script: RUNNER_PATH,
        json: "C:/tmp/cache-cleanup-baseline.json",
        md: "C:/tmp/cache-cleanup-baseline.md"
      };
    }
  });

  const searchModule = require(SEARCH_MODULE_PATH);
  assert.equal(typeof searchModule.searchCraftAssistBestSolution, "function");
  assert.equal(searchModule.searchCraftAssistBestSolution.__baselineReplayWrapped === true, false);
});
