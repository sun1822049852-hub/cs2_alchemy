const assert = require("node:assert/strict");
const path = require("node:path");
const {Worker} = require("node:worker_threads");

const TIMEOUT_FIXTURE_PATH = path.join(__dirname, "fixtures", "craftAssistShardTimeoutWorker.js");
const CRASH_FIXTURE_PATH = path.join(__dirname, "fixtures", "craftAssistShardCrashWorker.js");
const SHARD_WORKER_PATH = path.join(__dirname, "..", "node_sidecar", "src", "services", "craftAssistShardWorker.js");

const {
  buildStrideShardsWithCenterOverlap,
  mergeShardSelections,
  normalizeShardRole,
  resolvePrefilterOptions,
  resolveShardCount,
  runPrefilterPhase
} = require("../node_sidecar/src/services/craftAssistShardPrefilter");
const {
  prevFloat32,
  resolveCraftAssistTargetStepSpec
} = require("../node_sidecar/src/services/craftAssistFloat32Step");

function makeCandidate(id, value, {rarity = 4, name = "Aux"} = {}) {
  return {
    id: String(id),
    value,
    relative_value: value,
    row: {
      asset_id: String(id),
      rarity,
      name,
      alchemy_name: name
    }
  };
}

function makeGroup(candidates, {
  index = 0,
  name = "Aux",
  count = 5,
  role = "main"
} = {}) {
  return {
    index,
    material: {
      name,
      names: [name],
      count,
      role,
      wear_min: 0,
      wear_max: 1
    },
    candidates
  };
}

function makeRangeCandidates(total, {
  start = 0,
  step = 0.001,
  rarity = 4,
  name = "Aux"
} = {}) {
  return Array.from({length: total}, (_, index) => makeCandidate(
    `${name}-${index + 1}`,
    start + index * step,
    {rarity, name}
  ));
}

function makeBaseOptions(overrides = {}) {
  return {
    enableOversizedPrefilter: true,
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
    shardJobTimeoutMs: 100,
    prefilterGroupTimeoutMs: 250,
    prefilterCallTimeoutMs: 500,
    ...overrides
  };
}

function assertCandidateIds(group, expectedIds) {
  assert.deepEqual(group.candidates.map((candidate) => candidate.id), expectedIds);
}

function runShardWorkerPayload(payload) {
  return new Promise((resolve, reject) => {
    const requestId = `test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const worker = new Worker(SHARD_WORKER_PATH);
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error("worker test timed out"));
    }, 2000);
    worker.on("message", (message) => {
      clearTimeout(timer);
      void worker.terminate();
      if (!message || message.ok === false) {
        reject(new Error("worker returned failure"));
        return;
      }
      resolve(message.result);
    });
    worker.on("error", (err) => {
      clearTimeout(timer);
      void worker.terminate();
      reject(err);
    });
    worker.postMessage({
      type: "prefilter",
      requestId,
      payload
    });
  });
}

function test_resolve_shard_count_and_role_mapping() {
  const defaults = resolvePrefilterOptions({enableOversizedPrefilter: true});
  assert.equal(resolveShardCount(500, defaults), 0);
  assert.equal(resolveShardCount(501, defaults), 2);
  assert.equal(resolveShardCount(1501, defaults), 4);
  assert.equal(normalizeShardRole({modeHint: "single_material", materialRole: "main"}), "neutral");
  assert.equal(normalizeShardRole({modeHint: "multi_material_neutral", materialRole: "aux"}), "neutral");
  assert.equal(normalizeShardRole({modeHint: "multi_material_role", materialRole: "aux"}), "aux");
  assert.equal(normalizeShardRole({modeHint: "multi_material_role", materialRole: "main"}), "main");
}

function test_build_stride_shards_with_center_overlap_preserves_center_and_size() {
  const orderedCandidates = Array.from({length: 600}, (_, orderedIndex) => ({
    id: String(orderedIndex + 1),
    value: orderedIndex / 1000,
    orderedIndex
  }));
  const options = makeBaseOptions();
  const shards = buildStrideShardsWithCenterOverlap({
    orderedCandidates,
    shardCount: 2,
    targetValue: 0.42,
    options
  });
  assert.equal(shards.length, 2);
  assert.equal(shards[0].centerOverlapSize, 60);
  assert.equal(shards[1].centerOverlapSize, 60);
  assert.equal(shards[0].candidates.some((item) => item.orderedIndex === 420), true);
  assert.equal(shards[1].candidates.some((item) => item.orderedIndex === 420), true);
}

function test_center_overlap_uses_target_step_range_not_input_scalar() {
  const inputStep = Math.fround(0.27);
  const targetStep = prevFloat32(inputStep);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below"
  });
  const orderedCandidates = [
    {id: "low", value: 0.1, orderedIndex: 0},
    {id: "target-step", value: targetStep, orderedIndex: 1},
    {id: "input-step", value: inputStep, orderedIndex: 2},
    {id: "middle", value: 0.5, orderedIndex: 3},
    {id: "high", value: 0.9, orderedIndex: 4}
  ];
  const shards = buildStrideShardsWithCenterOverlap({
    orderedCandidates,
    shardCount: 2,
    targetValue: inputStep,
    targetStepSpec,
    options: makeBaseOptions({
      centerOverlapRatio: 0,
      centerOverlapMin: 1,
      centerOverlapMax: 1
    })
  });

  assert.equal(shards[0].candidates.some((candidate) => candidate.id === "target-step"), true);
}

function test_center_overlap_prefers_primary_step_over_lower_allowed_offset_step() {
  const inputStep = Math.fround(0.27);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below",
    offsetValue: 0.01
  });
  const orderedCandidates = [
    {id: "lower-offset-step", value: targetStepSpec.lowerTargetStep, orderedIndex: 0},
    {id: "target-step", value: targetStepSpec.targetStep, orderedIndex: 1},
    {id: "below-window", value: Math.fround(Number(targetStepSpec.lowerTargetStep) - 0.005), orderedIndex: 2}
  ];
  const shards = buildStrideShardsWithCenterOverlap({
    orderedCandidates,
    shardCount: 2,
    targetValue: inputStep,
    targetStepSpec,
    options: makeBaseOptions({
      centerOverlapRatio: 0,
      centerOverlapMin: 1,
      centerOverlapMax: 1
    })
  });

  assert.equal(shards[0].candidates.some((candidate) => candidate.id === "target-step"), true);
}

function test_center_overlap_without_step_spec_preserves_first_equal_distance_candidate() {
  const orderedCandidates = [
    {id: "first-high", value: 0.6, orderedIndex: 0},
    {id: "second-low", value: 0.4, orderedIndex: 1}
  ];
  const shards = buildStrideShardsWithCenterOverlap({
    orderedCandidates,
    shardCount: 2,
    targetValue: 0.5,
    options: makeBaseOptions({
      centerOverlapRatio: 0,
      centerOverlapMin: 1,
      centerOverlapMax: 1
    })
  });

  assert.equal(shards.every((shard) => shard.candidates.some((candidate) => candidate.id === "first-high")), true);
}

function test_merge_shard_selections_clips_to_shortlist_max_in_original_order() {
  const group = makeGroup(Array.from({length: 20}, (_, orderedIndex) => ({
    id: String(orderedIndex + 1),
    value: orderedIndex / 100,
    orderedIndex
  })), {count: 4});
  const result = mergeShardSelections({
    group,
    selectedIds: ["9", "4", "11", "3", "15", "14"],
    options: makeBaseOptions({
      shortlistMin: 4,
      shortlistPerRequired: 1,
      shortlistHardMax: 4
    })
  });
  assert.equal(result.usedGroupFallback, false);
  assertCandidateIds(result, ["3", "4", "9", "11"]);
}

function test_merge_shard_selections_rejects_duplicate_ids() {
  const group = makeGroup(Array.from({length: 12}, (_, orderedIndex) => ({
    id: String(orderedIndex + 1),
    value: orderedIndex / 100,
    orderedIndex
  })), {count: 4});
  const result = mergeShardSelections({
    group,
    selectedIds: ["2", "2", "5"],
    options: makeBaseOptions({
      shortlistMin: 4,
      shortlistPerRequired: 2,
      shortlistHardMax: 8
    })
  });
  assert.equal(result.usedGroupFallback, true);
  assert.equal(result.candidates, group.candidates);
}

async function test_phase_group_fallback_when_shortlist_hard_max_too_small() {
  const group = makeGroup(makeRangeCandidates(520), {count: 5, role: "neutral"});
  const result = await runPrefilterPhase({
    groups: [group],
    targetValue: 0.42,
    recipeContext: {recipeNo: 1},
    phaseName: "prefilter/base",
    options: makeBaseOptions({shortlistHardMax: 4})
  });
  assert.equal(result.kind, "phase_ready");
  assert.deepEqual(result.groupFallbackIndexes, [0]);
  assert.equal(result.groups[0], group);
}

async function test_phase_does_not_mutate_oversized_input_groups() {
  const group = makeGroup(makeRangeCandidates(520), {count: 5, role: "neutral"});
  const args = {
    groups: [group],
    targetValue: 0.42,
    recipeContext: {recipeNo: 1},
    phaseName: "prefilter/base",
    options: makeBaseOptions()
  };
  Object.freeze(args.groups);
  Object.freeze(group);
  Object.freeze(group.material);
  Object.freeze(group.candidates);
  Object.freeze(group.candidates[0]);
  const result = await runPrefilterPhase(args);
  assert.notEqual(result.groups, args.groups);
  assert.notEqual(result.groups[0], group);
  assert.equal(group.candidates[0].orderedIndex, undefined);
}

async function test_phase_keeps_non_oversized_group_identity() {
  const smallGroup = makeGroup(makeRangeCandidates(12), {count: 4, role: "neutral"});
  const result = await runPrefilterPhase({
    groups: [smallGroup],
    targetValue: 0.42,
    recipeContext: {recipeNo: 1},
    phaseName: "prefilter/base",
    options: makeBaseOptions()
  });
  assert.equal(result.kind, "phase_ready");
  assert.equal(result.groups[0], smallGroup);
}

async function test_group_full_fallback_on_shard_timeout() {
  const group = makeGroup(makeRangeCandidates(520), {count: 5, role: "neutral"});
  const result = await runPrefilterPhase({
    groups: [group],
    targetValue: 0.42,
    recipeContext: {recipeNo: 1},
    phaseName: "prefilter/base",
    options: makeBaseOptions({
      workerPath: TIMEOUT_FIXTURE_PATH,
      shardJobTimeoutMs: 30,
      prefilterGroupTimeoutMs: 120,
      prefilterCallTimeoutMs: 500
    })
  });
  assert.equal(result.kind, "phase_ready");
  assert.deepEqual(result.groupFallbackIndexes, [0]);
  assert.equal(result.groups[0], group);
}

async function test_group_full_fallback_on_worker_crash() {
  const group = makeGroup(makeRangeCandidates(520), {count: 5, role: "neutral"});
  const result = await runPrefilterPhase({
    groups: [group],
    targetValue: 0.42,
    recipeContext: {recipeNo: 1},
    phaseName: "prefilter/base",
    options: makeBaseOptions({
      workerPath: CRASH_FIXTURE_PATH,
      shardJobTimeoutMs: 50,
      prefilterGroupTimeoutMs: 150
    })
  });
  assert.equal(result.kind, "phase_ready");
  assert.deepEqual(result.groupFallbackIndexes, [0]);
  assert.equal(result.groups[0], group);
}

async function test_group_full_fallback_on_group_timeout() {
  const group = makeGroup(makeRangeCandidates(520), {count: 5, role: "neutral"});
  const result = await runPrefilterPhase({
    groups: [group],
    targetValue: 0.42,
    recipeContext: {recipeNo: 1},
    phaseName: "prefilter/base",
    options: makeBaseOptions({
      workerPath: TIMEOUT_FIXTURE_PATH,
      shardJobTimeoutMs: 500,
      prefilterGroupTimeoutMs: 20,
      prefilterCallTimeoutMs: 500
    })
  });
  assert.equal(result.kind, "phase_ready");
  assert.deepEqual(result.groupFallbackIndexes, [0]);
}

async function test_call_timeout_discards_partial_prefilter_results() {
  const groups = [
    makeGroup(makeRangeCandidates(520, {name: "Aux"}), {index: 0, name: "Aux", count: 5, role: "neutral"}),
    makeGroup(makeRangeCandidates(520, {name: "Main"}), {index: 1, name: "Main", count: 5, role: "neutral"})
  ];
  const result = await runPrefilterPhase({
    groups,
    targetValue: 0.42,
    recipeContext: {recipeNo: 1},
    phaseName: "prefilter/base",
    options: makeBaseOptions({
      workerPath: TIMEOUT_FIXTURE_PATH,
      shardJobTimeoutMs: 500,
      prefilterGroupTimeoutMs: 500,
      prefilterCallTimeoutMs: 5
    })
  });
  assert.equal(result.kind, "call_timeout");
  assert.equal(result.usedRarityFullFallback, true);
  assert.equal(result.groups, groups);
  assert.deepEqual(result.prefilterTrace.groupFallbackIndexes, []);
}

async function test_prefilter_trace_uses_shared_material_projection() {
  const group = {
    index: 0,
    material: {
      role: "neutral",
      count: 5,
      primary_name: "Aux Alpha",
      item_names: ["Aux Alpha", "Aux Beta"],
      label: "Aux Alpha / Aux Beta"
    },
    candidates: makeRangeCandidates(520, {name: "Aux Alpha"})
  };
  const result = await runPrefilterPhase({
    groups: [group],
    targetValue: 0.42,
    recipeContext: {recipeNo: 1},
    phaseName: "prefilter/base",
    options: makeBaseOptions()
  });

  assert.equal(result.kind, "phase_ready");
  assert.equal(result.prefilterTrace.groups[0].materialName, "Aux Alpha");
  assert.deepEqual(result.prefilterTrace.groups[0].item_names, ["Aux Alpha", "Aux Beta"]);
  assert.equal(result.prefilterTrace.groups[0].label, "Aux Alpha / Aux Beta");
}

async function test_shard_worker_uses_target_step_spec_for_ranking() {
  const inputStep = Math.fround(0.27);
  const targetStep = prevFloat32(inputStep);
  const result = await runShardWorkerPayload({
    groupIndex: 0,
    shardIndex: 0,
    role: "neutral",
    targetValue: inputStep,
    targetStepSpec: resolveCraftAssistTargetStepSpec({
      inputStep,
      approachMode: "below"
    }),
    topK: 1,
    edgeKeepPerSide: 0,
    candidates: [
      {id: "input-step", value: inputStep, orderedIndex: 0},
      {id: "target-step", value: targetStep, orderedIndex: 1}
    ]
  });

  assert.deepEqual(result.selectedIds, ["target-step"]);
}

async function test_shard_worker_prefers_primary_step_over_lower_allowed_offset_step() {
  const inputStep = Math.fround(0.27);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below",
    offsetValue: 0.01
  });
  const result = await runShardWorkerPayload({
    groupIndex: 0,
    shardIndex: 0,
    role: "neutral",
    targetValue: inputStep,
    targetStepSpec,
    topK: 1,
    edgeKeepPerSide: 0,
    candidates: [
      {id: "lower-offset-step", value: targetStepSpec.lowerTargetStep, orderedIndex: 0},
      {id: "target-step", value: targetStepSpec.targetStep, orderedIndex: 1},
      {id: "below-window", value: Math.fround(Number(targetStepSpec.lowerTargetStep) - 0.005), orderedIndex: 2}
    ]
  });

  assert.deepEqual(result.selectedIds, ["target-step"]);
}

function test_center_overlap_uses_raw_aware_primary_target_step_from_target_step_spec() {
  const raw = 0.21;
  const inputStep = Math.fround(raw);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below"
  });
  const previousStep = prevFloat32(targetStepSpec.targetStep);
  const orderedCandidates = [
    {id: "prev-step", value: previousStep, orderedIndex: 0},
    {id: "target-step", value: targetStepSpec.targetStep, orderedIndex: 1},
    {id: "far", value: 0.9, orderedIndex: 2}
  ];
  const shards = buildStrideShardsWithCenterOverlap({
    orderedCandidates,
    shardCount: 2,
    targetValue: inputStep,
    targetStepSpec,
    options: makeBaseOptions({
      centerOverlapRatio: 0,
      centerOverlapMin: 1,
      centerOverlapMax: 1
    })
  });

  assert.equal(targetStepSpec.targetStep, inputStep);
  assert.equal(shards[0].candidates.some((candidate) => candidate.id === "target-step"), true);
}

async function test_shard_worker_uses_raw_aware_offset_window_from_target_step_spec() {
  const raw = 0.21;
  const inputStep = Math.fround(raw);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below",
    offsetValue: 0.01
  });
  const result = await runShardWorkerPayload({
    groupIndex: 0,
    shardIndex: 0,
    role: "neutral",
    targetValue: inputStep,
    targetStepSpec,
    topK: 1,
    edgeKeepPerSide: 0,
    candidates: [
      {id: "lower-offset-step", value: targetStepSpec.lowerTargetStep, orderedIndex: 0},
      {id: "target-step", value: targetStepSpec.targetStep, orderedIndex: 1},
      {id: "below-window", value: Math.fround(Number(targetStepSpec.lowerTargetStep) - 0.005), orderedIndex: 2}
    ]
  });

  assert.equal(targetStepSpec.targetStep, inputStep);
  assert.equal(targetStepSpec.lowerTargetStep < targetStepSpec.targetStep, true);
  assert.deepEqual(result.selectedIds, ["target-step"]);
}

async function test_shard_worker_role_aware_outside_window_sorts_by_target_distance_before_side_bias() {
  const inputStep = Math.fround(0.27);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below",
    offsetValue: 0.01
  });
  const result = await runShardWorkerPayload({
    groupIndex: 0,
    shardIndex: 0,
    role: "main",
    targetValue: inputStep,
    targetStepSpec,
    topK: 1,
    edgeKeepPerSide: 0,
    candidates: [
      {id: "closer-below-window", value: Math.fround(Number(targetStepSpec.lowerTargetStep) - 0.0001), orderedIndex: 0},
      {id: "farther-above-window", value: Math.fround(inputStep + 0.01), orderedIndex: 1}
    ]
  });

  assert.deepEqual(result.selectedIds, ["closer-below-window"]);
}

async function test_shard_worker_treats_raw_values_inside_target_step_as_equal_side() {
  const inputStep = Math.fround(0.27);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below"
  });
  const insideTargetStepRange = (Number(targetStepSpec.targetStep) + Number(targetStepSpec.upperBound)) / 2;
  assert.equal(Math.fround(insideTargetStepRange), targetStepSpec.targetStep);
  assert.equal(insideTargetStepRange > targetStepSpec.targetStep, true);

  const result = await runShardWorkerPayload({
    groupIndex: 0,
    shardIndex: 0,
    role: "aux",
    targetValue: targetStepSpec.targetStep,
    targetStepSpec,
    topK: 3,
    edgeKeepPerSide: 1,
    candidates: [
      {id: "target-step", value: targetStepSpec.targetStep, orderedIndex: 0},
      {id: "inside-target-step-range", value: insideTargetStepRange, orderedIndex: 1},
      {id: "preferred-below", value: targetStepSpec.lowerBound - 0.0001, orderedIndex: 2}
    ]
  });

  assert.deepEqual(result.selectedIds, ["target-step", "inside-target-step-range", "preferred-below"]);
  assert.equal(result.stats.preferredSideCount, 1);
  assert.equal(result.stats.oppositeSideCount, 0);
}

async function test_prefilter_trace_includes_step_target() {
  const inputStep = Math.fround(0.42);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below"
  });
  const group = makeGroup(makeRangeCandidates(12), {count: 4, role: "neutral"});
  const result = await runPrefilterPhase({
    groups: [group],
    targetValue: inputStep,
    targetStepSpec,
    recipeContext: {recipeNo: 1},
    phaseName: "prefilter/base",
    options: makeBaseOptions()
  });

  assert.equal(result.prefilterTrace.inputStep, inputStep);
  assert.equal(result.prefilterTrace.targetStep, targetStepSpec.targetStep);
}

(async () => {
  test_resolve_shard_count_and_role_mapping();
  test_build_stride_shards_with_center_overlap_preserves_center_and_size();
  test_center_overlap_uses_target_step_range_not_input_scalar();
  test_center_overlap_prefers_primary_step_over_lower_allowed_offset_step();
  test_center_overlap_uses_raw_aware_primary_target_step_from_target_step_spec();
  test_center_overlap_without_step_spec_preserves_first_equal_distance_candidate();
  test_merge_shard_selections_clips_to_shortlist_max_in_original_order();
  test_merge_shard_selections_rejects_duplicate_ids();
  await test_phase_group_fallback_when_shortlist_hard_max_too_small();
  await test_phase_does_not_mutate_oversized_input_groups();
  await test_phase_keeps_non_oversized_group_identity();
  await test_group_full_fallback_on_shard_timeout();
  await test_group_full_fallback_on_worker_crash();
  await test_group_full_fallback_on_group_timeout();
  await test_call_timeout_discards_partial_prefilter_results();
  await test_prefilter_trace_uses_shared_material_projection();
  await test_shard_worker_uses_target_step_spec_for_ranking();
  await test_shard_worker_prefers_primary_step_over_lower_allowed_offset_step();
  await test_shard_worker_uses_raw_aware_offset_window_from_target_step_spec();
  await test_shard_worker_role_aware_outside_window_sorts_by_target_distance_before_side_bias();
  await test_shard_worker_treats_raw_values_inside_target_step_as_equal_side();
  await test_prefilter_trace_includes_step_target();
  console.log("craftAssistShardPrefilter tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
