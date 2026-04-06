const assert = require("node:assert/strict");
const path = require("node:path");

const TIMEOUT_FIXTURE_PATH = path.join(__dirname, "fixtures", "craftAssistShardTimeoutWorker.js");
const CRASH_FIXTURE_PATH = path.join(__dirname, "fixtures", "craftAssistShardCrashWorker.js");

const {
  buildStrideShardsWithCenterOverlap,
  mergeShardSelections,
  normalizeShardRole,
  resolvePrefilterOptions,
  resolveShardCount,
  runPrefilterPhase
} = require("../node_sidecar/src/services/craftAssistShardPrefilter");

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

(async () => {
  test_resolve_shard_count_and_role_mapping();
  test_build_stride_shards_with_center_overlap_preserves_center_and_size();
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
  console.log("craftAssistShardPrefilter tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
