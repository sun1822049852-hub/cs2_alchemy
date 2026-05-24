const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");

const {
  refineRoleAwareMaterialResults,
  refineSingleMaterialCompensation,
  searchCraftAssistSeed,
  searchCraftAssistBestSolution,
  searchSlidingAnchorDiagnostic,
  searchRoleAwarePushSolution,
  scoreCraftAssistSolutionSingleMaterial
} = require("../node_sidecar/src/services/craftAssistSearch");
const {
  prevFloat32,
  resolveCraftAssistTargetStepSpec
} = require("../node_sidecar/src/services/craftAssistFloat32Step");

let craftAssistSearchInternals = null;

function loadCraftAssistSearchInternals() {
  if (craftAssistSearchInternals) return craftAssistSearchInternals;
  const filePath = path.resolve(__dirname, "../node_sidecar/src/services/craftAssistSearch.js");
  const source = fs.readFileSync(filePath, "utf8");
  const moduleForTest = {exports: {}};
  const localRequire = Module.createRequire(filePath);
  const sandbox = {
    module: moduleForTest,
    exports: moduleForTest.exports,
    require: localRequire,
    __dirname: path.dirname(filePath),
    __filename: filePath,
    console,
    process,
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  vm.runInNewContext(
    `${source}
module.exports.__scorePartialStateForTest = scorePartialState;
module.exports.__buildEmptyPartialStatsForTest = buildEmptyPartialStats;
module.exports.__extendPartialStatsForTest = extendPartialStats;
module.exports.__calcVarianceFromPartialStatsForTest = calcVarianceFromPartialStats;
module.exports.__classifyCraftAssistEntryWindowForTest = classifyCraftAssistEntryWindow;
module.exports.__scoreSingleMaterialSearchSelectionForTest = scoreSingleMaterialSearchSelection;
`,
    sandbox,
    {filename: filePath}
  );
  craftAssistSearchInternals = {
    scorePartialState: moduleForTest.exports.__scorePartialStateForTest,
    buildEmptyPartialStats: moduleForTest.exports.__buildEmptyPartialStatsForTest,
    extendPartialStats: moduleForTest.exports.__extendPartialStatsForTest,
    calcVarianceFromPartialStats: moduleForTest.exports.__calcVarianceFromPartialStatsForTest,
    classifyCraftAssistEntryWindow: moduleForTest.exports.__classifyCraftAssistEntryWindowForTest,
    scoreSingleMaterialSearchSelection: moduleForTest.exports.__scoreSingleMaterialSearchSelectionForTest
  };
  return craftAssistSearchInternals;
}

function makeCandidate(id, value, groupIndex, role) {
  return {
    id,
    value,
    relative_value: value,
    groupIndex,
    role,
    row: {
      asset_id: String(id),
      rarity: 4
    }
  };
}

function pickedIds(result) {
  const selected = [];
  for (const entry of Array.isArray(result && result.materialResults) ? result.materialResults : []) {
    selected.push(...(Array.isArray(entry && entry.selected) ? entry.selected : []));
  }
  return selected.map((item) => String(item && item.id || "")).sort();
}

function resultTraceStages(result) {
  return (Array.isArray(result && result.trace && result.trace.steps) ? result.trace.steps : [])
    .map((step) => String(step && step.stage || ""));
}

function traceStages(result) {
  return (Array.isArray(result && result.trace && result.trace.steps) ? result.trace.steps : [])
    .map((step) => String(step && step.stage || ""));
}

function assertFiniteNonNegativeNumber(value, label) {
  assert.equal(Number.isFinite(Number(value)), true, `${label} should be finite`);
  assert.equal(Number(value) >= 0, true, `${label} should be non-negative`);
}

function assertAlmostEqual(actual, expected, tolerance = 1e-12, label = "value") {
  assert.equal(Number.isFinite(Number(actual)), true, `${label} actual should be finite`);
  assert.equal(Number.isFinite(Number(expected)), true, `${label} expected should be finite`);
  assert.equal(
    Math.abs(Number(actual) - Number(expected)) < tolerance,
    true,
    `${label} should match within ${tolerance}: got ${actual}, expected ${expected}`
  );
}

function assertScoreTupleAlmostEqual(actual, expected, tolerance = 1e-12, label = "score tuple") {
  assert.equal(Array.isArray(actual), true, `${label} actual should be an array`);
  assert.equal(Array.isArray(expected), true, `${label} expected should be an array`);
  assert.equal(actual.length, expected.length, `${label} length should match`);
  for (let index = 0; index < actual.length; index += 1) {
    assertAlmostEqual(actual[index], expected[index], tolerance, `${label}[${index}]`);
  }
}

function calcVarianceFromCandidates(selected) {
  const values = (Array.isArray(selected) ? selected : []).map((item) => Number(item && item.value || 0));
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => {
    const diff = value - mean;
    return sum + diff * diff;
  }, 0) / values.length;
}

function buildPartialStatsForTest(selected, targetValue, targetStepSpec = null) {
  const {
    buildEmptyPartialStats,
    extendPartialStats
  } = loadCraftAssistSearchInternals();
  const searchTarget = targetStepSpec
    ? Number(targetStepSpec.targetStep)
    : Number(targetValue);
  let partialStats = buildEmptyPartialStats();
  for (const candidate of Array.isArray(selected) ? selected : []) {
    partialStats = extendPartialStats(partialStats, candidate, searchTarget);
  }
  return partialStats;
}

function assertIncrementalPartialStatsScoreMatchesSlowPath({
  selected,
  totalSlots,
  targetValue,
  mode,
  approachMode,
  targetStepSpec = null,
  label
}) {
  const {scorePartialState} = loadCraftAssistSearchInternals();
  const partialStats = buildPartialStatsForTest(selected, targetValue, targetStepSpec);
  const slowScore = scorePartialState({
    selected,
    sum: selected.reduce((sum, candidate) => sum + Number(candidate && candidate.value || 0), 0)
  }, totalSlots, targetValue, mode, approachMode, targetStepSpec);
  const fastScore = scorePartialState({
    selected,
    sum: partialStats.sum,
    partialStats
  }, totalSlots, targetValue, mode, approachMode, targetStepSpec);

  assertScoreTupleAlmostEqual(fastScore, slowScore, 1e-12, label);
}

const BEAM_PROFILE_EVENT_KEYS = new Set([
  "phase",
  "capExtra",
  "totalSlots",
  "innerExtras",
  "cacheHits",
  "cacheMisses",
  "reusedInnerExtras",
  "stopReason",
  "elapsedMs"
]);

function test_entry_window_helper_classifies_closed_boundaries() {
  const {classifyCraftAssistEntryWindow} = loadCraftAssistSearchInternals();
  const cases = [
    ["below", 0.21, 0.01, 0.20, "entry"],
    ["below", 0.21, 0.01, 0.21, "entry"],
    ["below", 0.21, 0.01, 0.199999, "entry_window_low"],
    ["below", 0.21, 0.01, 0.210001, "entry_window_high"],
    ["infinite", 0.21, 0.01, 0.20, "entry"],
    ["infinite", 0.21, 0.01, 0.22, "entry"],
    ["infinite", 0.21, 0.01, 0.199999, "entry_window_low"],
    ["infinite", 0.21, 0.01, 0.220001, "entry_window_high"]
  ];

  for (const [approachMode, targetValue, offsetValue, overall, expected] of cases) {
    assert.equal(
      classifyCraftAssistEntryWindow({overall, targetValue, approachMode, offsetValue}),
      expected,
      `${approachMode} overall=${overall}`
    );
  }
}

function test_entry_window_gates_single_material_search_scoring() {
  const {scoreSingleMaterialSearchSelection} = loadCraftAssistSearchInternals();
  const makeSelected = (overall) => Array.from({length: 10}, (_, index) => (
    makeCandidate(`entry-score-${overall}-${index + 1}`, overall, 0, "main")
  ));

  assert.equal(
    scoreSingleMaterialSearchSelection({
      selected: makeSelected(0.199999),
      targetValue: 0.21,
      approachMode: "below",
      entryOffsetValue: 0.01
    }),
    null
  );
  assert.equal(
    !!scoreSingleMaterialSearchSelection({
      selected: makeSelected(0.20),
      targetValue: 0.21,
      approachMode: "below",
      entryOffsetValue: 0.01
    }),
    true
  );
  assert.equal(
    !!scoreSingleMaterialSearchSelection({
      selected: makeSelected(0.21),
      targetValue: 0.21,
      approachMode: "below",
      entryOffsetValue: 0.01
    }),
    true
  );
  assert.equal(
    scoreSingleMaterialSearchSelection({
      selected: makeSelected(0.210001),
      targetValue: 0.21,
      approachMode: "below",
      entryOffsetValue: 0.01
    }),
    null
  );
  assert.equal(
    scoreSingleMaterialSearchSelection({
      selected: makeSelected(0.21),
      targetValue: 0.21,
      approachMode: "below"
    }),
    null,
    "omitting entryOffsetValue should preserve legacy strict-below scoring"
  );
}

function test_entry_window_gates_single_material_balanced_push_search() {
  const lowOnly = searchCraftAssistBestSolution({
    groups: [{
      index: 0,
      material: {name: "Entry Solo Low", role: "main", count: 2},
      candidates: [
        makeCandidate("entry-low-1", 0.199999, 0, "main"),
        makeCandidate("entry-low-2", 0.199999, 0, "main"),
        makeCandidate("entry-low-3", 0.19, 0, "main")
      ]
    }],
    targetValue: 0.21,
    approachMode: "below",
    entryOffsetValue: 0.01
  });
  assert.equal(lowOnly, null);

  const lowerBound = searchCraftAssistBestSolution({
    groups: [{
      index: 0,
      material: {name: "Entry Solo Lower", role: "main", count: 2},
      candidates: [
        makeCandidate("entry-lower-1", 0.20, 0, "main"),
        makeCandidate("entry-lower-2", 0.20, 0, "main")
      ]
    }],
    targetValue: 0.21,
    approachMode: "below",
    entryOffsetValue: 0.01
  });
  assert.equal(!!lowerBound, true);
  assertAlmostEqual(lowerBound.overall, 0.20, 1e-12, "lower-bound entry overall");

  const targetBoundary = searchCraftAssistBestSolution({
    groups: [{
      index: 0,
      material: {name: "Entry Solo Target", role: "main", count: 2},
      candidates: [
        makeCandidate("entry-target-1", 0.21, 0, "main"),
        makeCandidate("entry-target-2", 0.21, 0, "main")
      ]
    }],
    targetValue: 0.21,
    approachMode: "below",
    entryOffsetValue: 0.01
  });
  assert.equal(!!targetBoundary, true);
  assertAlmostEqual(targetBoundary.overall, 0.21, 1e-12, "target-boundary entry overall");

  const legacyTargetBoundary = searchCraftAssistBestSolution({
    groups: [{
      index: 0,
      material: {name: "Entry Solo Legacy", role: "main", count: 2},
      candidates: [
        makeCandidate("entry-legacy-1", 0.21, 0, "main"),
        makeCandidate("entry-legacy-2", 0.21, 0, "main")
      ]
    }],
    targetValue: 0.21,
    approachMode: "below"
  });
  assert.equal(legacyTargetBoundary, null, "omitting entryOffsetValue should preserve legacy final search entry");
}

function test_entry_window_gates_generic_infinite_search_scoring() {
  const run = (overall, entryOffsetValue = 0.01) => searchCraftAssistBestSolution({
    groups: [{
      index: 0,
      material: {name: `Entry Infinite ${overall}`, role: "main", count: 2},
      candidates: [
        makeCandidate(`entry-infinite-${overall}-1`, overall, 0, "main"),
        makeCandidate(`entry-infinite-${overall}-2`, overall, 0, "main")
      ]
    }],
    targetValue: 0.21,
    approachMode: "infinite",
    entryOffsetValue
  });

  assert.equal(run(0.199999), null);
  assert.equal(!!run(0.20), true);
  assertAlmostEqual(run(0.20).overall, 0.20, 1e-12, "infinite lower-bound entry overall");
  assert.equal(!!run(0.22), true);
  assertAlmostEqual(run(0.22).overall, 0.22, 1e-12, "infinite upper-bound entry overall");
  assert.equal(run(0.220001), null);
  assert.equal(
    !!searchCraftAssistBestSolution({
      groups: [{
        index: 0,
        material: {name: "Entry Infinite Legacy", role: "main", count: 2},
        candidates: [
          makeCandidate("entry-infinite-legacy-1", 0.220001, 0, "main"),
          makeCandidate("entry-infinite-legacy-2", 0.220001, 0, "main")
        ]
      }],
      targetValue: 0.21,
      approachMode: "infinite"
    }),
    true,
    "omitting entryOffsetValue should preserve legacy infinite scoring"
  );
}

function test_entry_window_zero_offset_preserves_direct_search_legacy_behavior() {
  const makeBelowTargetBoundaryOptions = (extra = {}) => ({
    groups: [{
      index: 0,
      material: {name: "Entry Zero Below", role: "main", count: 2},
      candidates: [
        makeCandidate("entry-zero-below-1", 0.21, 0, "main"),
        makeCandidate("entry-zero-below-2", 0.21, 0, "main")
      ]
    }],
    targetValue: 0.21,
    approachMode: "below",
    ...extra
  });
  const belowWithoutOffset = searchCraftAssistBestSolution(makeBelowTargetBoundaryOptions());
  const belowWithZeroOffset = searchCraftAssistBestSolution(
    makeBelowTargetBoundaryOptions({entryOffsetValue: 0})
  );
  assert.equal(belowWithoutOffset, null);
  assert.equal(
    belowWithZeroOffset,
    null,
    "entryOffsetValue: 0 should not enable the closed target-boundary entry window"
  );

  const makeInfiniteOptions = (extra = {}) => ({
    groups: [{
      index: 0,
      material: {name: "Entry Zero Infinite", role: "main", count: 2},
      candidates: [
        makeCandidate("entry-zero-infinite-1", 0.220001, 0, "main"),
        makeCandidate("entry-zero-infinite-2", 0.220001, 0, "main")
      ]
    }],
    targetValue: 0.21,
    approachMode: "infinite",
    ...extra
  });
  const infiniteWithoutOffset = searchCraftAssistBestSolution(makeInfiniteOptions());
  const infiniteWithZeroOffset = searchCraftAssistBestSolution(
    makeInfiniteOptions({entryOffsetValue: 0})
  );
  assert.equal(!!infiniteWithoutOffset, true);
  assert.equal(
    !!infiniteWithZeroOffset,
    true,
    "entryOffsetValue: 0 should not narrow infinite direct search to the exact target"
  );
  assertAlmostEqual(
    infiniteWithZeroOffset.overall,
    infiniteWithoutOffset.overall,
    1e-12,
    "zero-offset infinite overall"
  );
  assert.deepEqual(pickedIds(infiniteWithZeroOffset), pickedIds(infiniteWithoutOffset));
}
const BEAM_PROFILE_INNER_KEYS = new Set([
  "extra",
  "windowSizes",
  "slotCount",
  "beamInputStates",
  "beamOutputStates",
  "candidateAttempts",
  "duplicateSkips",
  "nextStates",
  "partialScoreAttempts",
  "partialPrunedStates",
  "completeScoreAttempts",
  "cacheHit",
  "stopReason",
  "elapsedMs"
]);
const BEAM_PROFILE_FORBIDDEN_KEYS = new Set([
  "candidate",
  "candidates",
  "item_ids",
  "itemIds",
  "state",
  "states",
  "selected",
  "usedIds",
  "selectedIdsByGroup"
]);

function assertBeamProfilePayloadShape(event) {
  assert.equal(!!event && typeof event === "object" && !Array.isArray(event), true);
  assert.deepEqual(Object.keys(event).sort(), [...BEAM_PROFILE_EVENT_KEYS].sort());
  for (const key of Object.keys(event)) {
    assert.equal(BEAM_PROFILE_FORBIDDEN_KEYS.has(key), false, `profile event should not include ${key}`);
  }
  assertFiniteNonNegativeNumber(event.cacheHits, "cacheHits");
  assertFiniteNonNegativeNumber(event.cacheMisses, "cacheMisses");
  assertFiniteNonNegativeNumber(event.reusedInnerExtras, "reusedInnerExtras");
  assert.equal(Array.isArray(event.innerExtras), true);
  for (const inner of event.innerExtras) {
    assert.equal(!!inner && typeof inner === "object" && !Array.isArray(inner), true);
    assert.deepEqual(Object.keys(inner).sort(), [...BEAM_PROFILE_INNER_KEYS].sort());
    for (const key of Object.keys(inner)) {
      assert.equal(BEAM_PROFILE_FORBIDDEN_KEYS.has(key), false, `profile inner should not include ${key}`);
    }
    assert.equal(typeof inner.cacheHit, "boolean");
  }
}

function sumBeamProfileField(events, field) {
  return (Array.isArray(events) ? events : []).reduce((total, event) => {
    const innerTotal = (Array.isArray(event && event.innerExtras) ? event.innerExtras : [])
      .reduce((sum, inner) => sum + Number(inner && inner[field] || 0), 0);
    return total + innerTotal;
  }, 0);
}

function countBeamProfileInnerWhere(events, predicate) {
  return (Array.isArray(events) ? events : []).reduce((total, event) => {
    return total + (Array.isArray(event && event.innerExtras) ? event.innerExtras : [])
      .filter(predicate)
      .length;
  }, 0);
}

function enumerateCombinations(items, count) {
  const values = Array.isArray(items) ? items : [];
  const targetCount = Math.max(0, Number(count) || 0);
  const combinations = [];
  function visit(start, selected) {
    if (selected.length === targetCount) {
      combinations.push(selected.slice());
      return;
    }
    const remaining = targetCount - selected.length;
    for (let index = start; index <= values.length - remaining; index += 1) {
      selected.push(values[index]);
      visit(index + 1, selected);
      selected.pop();
    }
  }
  visit(0, []);
  return combinations;
}

function meanCandidateValue(selected) {
  const values = (Array.isArray(selected) ? selected : []).map((item) => Number(item && item.value || 0));
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sortedCandidateIds(selected) {
  return (Array.isArray(selected) ? selected : [])
    .map((item) => String(item && item.id || ""))
    .sort();
}

function findUniqueRawBelowExactMeanCombination(candidates, pickCount, expectedOverall, rawCeiling) {
  const expected = Number(expectedOverall);
  const raw = Number(rawCeiling);
  const matches = enumerateCombinations(candidates, pickCount)
    .map((selected) => ({
      pickedIds: sortedCandidateIds(selected),
      overall: meanCandidateValue(selected)
    }))
    .filter((entry) => (
      Number(entry.overall) < raw
      && Math.abs(Number(entry.overall) - expected) < 1e-12
    ));
  assert.equal(
    matches.length,
    1,
    `fixture should have one raw-below exact mean combination, found ${matches.length}`
  );
  return matches[0];
}

function countCombinations(total, pickCount) {
  const n = Math.max(0, Math.trunc(Number(total) || 0));
  const k = Math.trunc(Number(pickCount) || 0);
  if (k < 0 || k > n) return 0;
  const reducedK = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= reducedK; index += 1) {
    result = result * (n - reducedK + index) / index;
  }
  return Math.round(result);
}

function countSingleGroupCombinationLevelNextStates(candidateCount, slotCount) {
  const candidateTotal = Math.max(0, Math.trunc(Number(candidateCount) || 0));
  const slotTotal = Math.max(0, Math.trunc(Number(slotCount) || 0));
  let total = 0;
  for (let pickedCount = 1; pickedCount <= Math.min(candidateTotal, slotTotal); pickedCount += 1) {
    total += countCombinations(candidateTotal, pickedCount);
  }
  return total;
}

function sumSingleGroupCombinationLevelNextStates(events) {
  return (Array.isArray(events) ? events : []).reduce((total, event) => {
    const innerTotal = (Array.isArray(event && event.innerExtras) ? event.innerExtras : [])
      .reduce((sum, inner) => {
        const windowSizes = Array.isArray(inner && inner.windowSizes) ? inner.windowSizes : [];
        if (windowSizes.length !== 1) return sum;
        return sum + countSingleGroupCombinationLevelNextStates(
          windowSizes[0],
          inner && inner.slotCount
        );
      }, 0);
    return total + innerTotal;
  }, 0);
}

function testCalcVariance(values) {
  const list = Array.isArray(values) ? values : [];
  if (!list.length) return 0;
  const mean = list.reduce((sum, value) => sum + Number(value || 0), 0) / list.length;
  return list.reduce((sum, value) => {
    const diff = Number(value || 0) - mean;
    return sum + diff * diff;
  }, 0) / list.length;
}

function testCompareScoreTuples(a, b) {
  const len = Math.max(Array.isArray(a) ? a.length : 0, Array.isArray(b) ? b.length : 0);
  for (let index = 0; index < len; index += 1) {
    const diff = Number((a && a[index]) || 0) - Number((b && b[index]) || 0);
    if (Math.abs(diff) > 1e-12) return diff;
  }
  return 0;
}

function scoreNeutralCombinationForTest(selected, targetValue, approachMode = "below") {
  const values = (Array.isArray(selected) ? selected : []).map((item) => Number(item && item.value || 0));
  if (!values.length) return null;
  const overall = values.reduce((sum, value) => sum + value, 0) / values.length;
  const radius = Math.max(...values.map((value) => Math.abs(value - Number(targetValue))));
  const meanDistance = values.reduce((sum, value) => sum + Math.abs(value - Number(targetValue)), 0) / values.length;
  if (String(approachMode || "").trim() === "below") {
    if (!(Number(overall) < Number(targetValue) - 1e-14)) return null;
    return {
      overall,
      tuple: [
        Number(targetValue) - overall,
        radius,
        testCalcVariance(values),
        meanDistance
      ]
    };
  }
  return {
    overall,
    tuple: [
      Math.abs(Number(targetValue) - overall),
      overall > Number(targetValue) + 1e-14 ? 1 : 0,
      radius,
      testCalcVariance(values),
      meanDistance
    ]
  };
}

function enumerateGroupedSelections(groups) {
  const list = Array.isArray(groups) ? groups : [];
  const perGroupSelections = list.map((group) => enumerateCombinations(
    Array.isArray(group && group.candidates) ? group.candidates : [],
    Math.max(0, Number(group && group.material && group.material.count || 0))
  ));
  const selections = [];
  function visit(groupIndex, selected) {
    if (groupIndex >= perGroupSelections.length) {
      selections.push(selected.flat());
      return;
    }
    for (const groupSelection of perGroupSelections[groupIndex]) {
      selected.push(groupSelection);
      visit(groupIndex + 1, selected);
      selected.pop();
    }
  }
  visit(0, []);
  return selections;
}

function findBestNeutralMultiGroupCombination(groups, targetValue, approachMode = "below") {
  const legalSelections = enumerateGroupedSelections(groups)
    .map((selected) => {
      const scored = scoreNeutralCombinationForTest(selected, targetValue, approachMode);
      if (!scored) return null;
      return {
        pickedIds: sortedCandidateIds(selected),
        overall: scored.overall,
        scoreTuple: scored.tuple
      };
    })
    .filter(Boolean);
  let best = null;
  for (const entry of legalSelections) {
    if (!best || testCompareScoreTuples(entry.scoreTuple, best.scoreTuple) < 0) {
      best = entry;
    }
  }
  return {
    best,
    legalSelections
  };
}

function makeSlidingAnchorFixture() {
  return [
    {
      index: 0,
      material: {name: "Sliding Main", role: "main", count: 8},
      candidates: [
        makeCandidate("m-low-1", 0.00, 0, "main"),
        makeCandidate("m-low-2", 0.01, 0, "main"),
        makeCandidate("m-low-3", 0.02, 0, "main"),
        makeCandidate("m-high-1", 0.560, 0, "main"),
        makeCandidate("m-high-2", 0.561, 0, "main"),
        makeCandidate("m-high-3", 0.562, 0, "main"),
        makeCandidate("m-high-4", 0.563, 0, "main"),
        makeCandidate("m-high-5", 0.564, 0, "main"),
        makeCandidate("m-high-6", 0.565, 0, "main"),
        makeCandidate("m-high-7", 0.566, 0, "main"),
        makeCandidate("m-high-8", 0.567, 0, "main"),
        makeCandidate("m-high-9", 0.568, 0, "main")
      ]
    },
    {
      index: 1,
      material: {name: "Sliding Aux", role: "aux", count: 2},
      candidates: [
        makeCandidate("a-low-1", 0.10, 1, "aux"),
        makeCandidate("a-low-2", 0.11, 1, "aux"),
        makeCandidate("a-rollback-1", 0.30, 1, "aux"),
        makeCandidate("a-rollback-2", 0.31, 1, "aux"),
        makeCandidate("a-mid-1", 0.40, 1, "aux"),
        makeCandidate("a-mid-2", 0.41, 1, "aux"),
        makeCandidate("a-high-1", 0.47, 1, "aux"),
        makeCandidate("a-high-2", 0.48, 1, "aux")
      ]
    }
  ];
}

function makeSlidingAnchorTargetStepSpec({raw = "0.5", offsetValue = 0} = {}) {
  const inputStep = Math.fround(Number(raw));
  return resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below",
    offsetValue
  });
}

function test_seed_single_material_returns_no_material_when_candidates_are_less_than_ten() {
  assert.equal(typeof searchCraftAssistSeed, "function");

  const result = searchCraftAssistSeed({
    groups: [{
      index: 0,
      material: {name: "Solo", role: "main", count: 10},
      candidates: Array.from({length: 9}, (_, index) => (
        makeCandidate(`single-no-material-${index + 1}`, 0.45 + index * 0.001, 0, "main")
      ))
    }],
    targetValue: 0.50
  });

  assert.equal(result && result.kind, "seed_no_material");
}

function test_seed_single_material_returns_proved_no_raw_solution_when_lowest_window_is_still_not_below_raw() {
  assert.equal(typeof searchCraftAssistSeed, "function");

  const result = searchCraftAssistSeed({
    groups: [{
      index: 0,
      material: {name: "Solo", role: "main", count: 10},
      candidates: Array.from({length: 10}, (_, index) => (
        makeCandidate(`single-no-raw-${index + 1}`, 0.51 + index * 0.001, 0, "main")
      ))
    }],
    targetValue: 0.50
  });

  assert.equal(result && result.kind, "seed_proved_no_raw_solution");
}

function test_seed_single_material_returns_hit_with_raw_below_window() {
  assert.equal(typeof searchCraftAssistSeed, "function");

  const result = searchCraftAssistSeed({
    groups: [{
      index: 0,
      material: {name: "Solo", role: "main", count: 10},
      candidates: [
        makeCandidate("single-hit-1", 0.44, 0, "main"),
        makeCandidate("single-hit-2", 0.45, 0, "main"),
        makeCandidate("single-hit-3", 0.46, 0, "main"),
        makeCandidate("single-hit-4", 0.47, 0, "main"),
        makeCandidate("single-hit-5", 0.48, 0, "main"),
        makeCandidate("single-hit-6", 0.49, 0, "main"),
        makeCandidate("single-hit-7", 0.491, 0, "main"),
        makeCandidate("single-hit-8", 0.492, 0, "main"),
        makeCandidate("single-hit-9", 0.493, 0, "main"),
        makeCandidate("single-hit-10", 0.494, 0, "main"),
        makeCandidate("single-hit-11", 0.501, 0, "main"),
        makeCandidate("single-hit-12", 0.502, 0, "main"),
        makeCandidate("single-hit-13", 0.503, 0, "main")
      ]
    }],
    targetValue: 0.50
  });

  assert.equal(result && result.kind, "seed_hit");
  assert.equal(result && result.overall < 0.50, true);
  assert.deepEqual(pickedIds(result), [
    "single-hit-10",
    "single-hit-11",
    "single-hit-12",
    "single-hit-13",
    "single-hit-4",
    "single-hit-5",
    "single-hit-6",
    "single-hit-7",
    "single-hit-8",
    "single-hit-9"
  ]);
}

function test_seed_dual_material_returns_proved_no_raw_solution_when_downward_space_is_exhausted() {
  assert.equal(typeof searchCraftAssistSeed, "function");

  const result = searchCraftAssistSeed({
    groups: [
      {
        index: 0,
        material: {name: "Main", role: "main", count: 1},
        candidates: [
          makeCandidate("dual-no-raw-main-1", 0.51, 0, "main"),
          makeCandidate("dual-no-raw-main-2", 0.52, 0, "main")
        ]
      },
      {
        index: 1,
        material: {name: "Aux", role: "aux", count: 1},
        candidates: [
          makeCandidate("dual-no-raw-aux-1", 0.53, 1, "aux"),
          makeCandidate("dual-no-raw-aux-2", 0.54, 1, "aux")
        ]
      }
    ],
    targetValue: 0.50
  });

  assert.equal(result && result.kind, "seed_proved_no_raw_solution");
}

function test_seed_dual_material_alternates_upward_probes_until_both_sides_are_stuck() {
  assert.equal(typeof searchCraftAssistSeed, "function");

  const result = searchCraftAssistSeed({
    groups: [
      {
        index: 0,
        material: {name: "Main", role: "main", count: 1},
        candidates: [
          makeCandidate("dual-alt-main-low", 0.4791, 0, "main"),
          makeCandidate("dual-alt-main-hit", 0.5204, 0, "main"),
          makeCandidate("dual-alt-main-high", 0.5205, 0, "main")
        ]
      },
      {
        index: 1,
        material: {name: "Aux", role: "aux", count: 1},
        candidates: [
          makeCandidate("dual-alt-aux-1", 0.4796, 1, "aux"),
          makeCandidate("dual-alt-aux-2", 0.4797, 1, "aux"),
          makeCandidate("dual-alt-aux-3", 0.4798, 1, "aux"),
          makeCandidate("dual-alt-aux-4", 0.4799, 1, "aux"),
          makeCandidate("dual-alt-aux-above", 0.60, 1, "aux")
        ]
      }
    ],
    targetValue: 0.50
  });

  assert.equal(result && result.kind, "seed_hit");
  assert.equal(result && result.overall < 0.50, true);
  const probeAttempts = (Array.isArray(result && result.trace && result.trace.steps) ? result.trace.steps : [])
    .filter((step) => step && step.stage === "seed_probe_attempt")
    .map((step) => ({
      side: String(step.side || ""),
      accepted: !!step.accepted
    }));

  assert.equal(probeAttempts.length >= 4, true);
  assert.deepEqual(probeAttempts.slice(0, 4), [
    {side: "aux", accepted: true},
    {side: "main", accepted: false},
    {side: "aux", accepted: true},
    {side: "main", accepted: false}
  ]);
}

function test_role_aware_push_slides_aux_window_down_when_over_target() {
  const groups = [
    {
      index: 0,
      material: {name: "Main", role: "main", count: 2},
      candidates: [
        makeCandidate("m1", 0.24, 0, "main"),
        makeCandidate("m2", 0.245, 0, "main")
      ]
    },
    {
      index: 1,
      material: {name: "Aux", role: "aux", count: 8},
      candidates: [
        makeCandidate("a1", 0.209, 1, "aux"),
        makeCandidate("a2", 0.208, 1, "aux"),
        makeCandidate("a3", 0.207, 1, "aux"),
        makeCandidate("a4", 0.206, 1, "aux"),
        makeCandidate("a5", 0.205, 1, "aux"),
        makeCandidate("a6", 0.204, 1, "aux"),
        makeCandidate("a7", 0.203, 1, "aux"),
        makeCandidate("a8", 0.202, 1, "aux"),
        makeCandidate("a9", 0.201, 1, "aux"),
        makeCandidate("a10", 0.200, 1, "aux"),
        makeCandidate("a11", 0.199, 1, "aux"),
        makeCandidate("a12", 0.198, 1, "aux")
      ]
    }
  ];

  const result = searchRoleAwarePushSolution({
    groups,
    targetValue: 0.21
  });

  assert.equal(result.overall < 0.21, true);
  assert.equal(pickedIds(result).includes("a10"), true);
  assert.equal(pickedIds(result).includes("a11"), true);
  assert.equal(pickedIds(result).includes("a12"), true);
  assert.equal(pickedIds(result).includes("a1"), false);
  assert.equal(pickedIds(result).includes("a2"), false);
  assert.equal(pickedIds(result).includes("a3"), false);
}

function test_role_aware_push_slides_main_window_up_when_under_target() {
  const groups = [
    {
      index: 0,
      material: {name: "Main", role: "main", count: 2},
      candidates: [
        makeCandidate("m1", 0.23, 0, "main"),
        makeCandidate("m2", 0.235, 0, "main"),
        makeCandidate("m3", 0.24, 0, "main"),
        makeCandidate("m4", 0.245, 0, "main")
      ]
    },
    {
      index: 1,
      material: {name: "Aux", role: "aux", count: 8},
      candidates: [
        makeCandidate("a1", 0.205, 1, "aux"),
        makeCandidate("a2", 0.204, 1, "aux"),
        makeCandidate("a3", 0.203, 1, "aux"),
        makeCandidate("a4", 0.202, 1, "aux"),
        makeCandidate("a5", 0.201, 1, "aux"),
        makeCandidate("a6", 0.200, 1, "aux"),
        makeCandidate("a7", 0.199, 1, "aux"),
        makeCandidate("a8", 0.198, 1, "aux")
      ]
    }
  ];

  const result = searchRoleAwarePushSolution({
    groups,
    targetValue: 0.21
  });

  assert.equal(result.overall < 0.21, true);
  assert.deepEqual(pickedIds(result), [
    "a1",
    "a2",
    "a3",
    "a4",
    "a5",
    "a6",
    "a7",
    "a8",
    "m3",
    "m4"
  ]);
}

function test_role_aware_push_prefers_closer_aux_raise_when_main_raise_would_block_it() {
  const groups = [
    {
      index: 0,
      material: {name: "Main", role: "main", count: 1},
      candidates: [
        makeCandidate("m1", 0.60, 0, "main"),
        makeCandidate("m2", 0.70, 0, "main")
      ]
    },
    {
      index: 1,
      material: {name: "Aux", role: "aux", count: 9},
      candidates: [
        makeCandidate("a1", 0.4666667, 1, "aux"),
        makeCandidate("a2", 0.4666667, 1, "aux"),
        makeCandidate("a3", 0.4666667, 1, "aux"),
        makeCandidate("a4", 0.4666667, 1, "aux"),
        makeCandidate("a5", 0.4666667, 1, "aux"),
        makeCandidate("a6", 0.4666667, 1, "aux"),
        makeCandidate("a7", 0.4666667, 1, "aux"),
        makeCandidate("a8", 0.4666667, 1, "aux"),
        makeCandidate("a9", 0.4666667, 1, "aux"),
        makeCandidate("a10", 0.6166667, 1, "aux")
      ]
    }
  ];

  const result = searchRoleAwarePushSolution({
    groups,
    targetValue: 0.50
  });

  assert.equal(result.overall < 0.50, true);
  assert.equal(Math.abs(result.overall - 0.495) < 1e-6, true);
  assert.equal(pickedIds(result).includes("a10"), true);
  assert.equal(pickedIds(result).includes("m2"), false);
}

function test_role_aware_push_returns_selection_trace() {
  const groups = [
    {
      index: 0,
      material: {name: "Main", role: "main", count: 2},
      candidates: [
        makeCandidate("m1", 0.24, 0, "main"),
        makeCandidate("m2", 0.245, 0, "main")
      ]
    },
    {
      index: 1,
      material: {name: "Aux", role: "aux", count: 8},
      candidates: [
        makeCandidate("a1", 0.209, 1, "aux"),
        makeCandidate("a2", 0.208, 1, "aux"),
        makeCandidate("a3", 0.207, 1, "aux"),
        makeCandidate("a4", 0.206, 1, "aux"),
        makeCandidate("a5", 0.205, 1, "aux"),
        makeCandidate("a6", 0.204, 1, "aux"),
        makeCandidate("a7", 0.203, 1, "aux"),
        makeCandidate("a8", 0.202, 1, "aux"),
        makeCandidate("a9", 0.201, 1, "aux"),
        makeCandidate("a10", 0.200, 1, "aux"),
        makeCandidate("a11", 0.199, 1, "aux"),
        makeCandidate("a12", 0.198, 1, "aux")
      ]
    }
  ];

  const result = searchRoleAwarePushSolution({
    groups,
    targetValue: 0.21
  });

  const stages = traceStages(result);
  assert.equal(stages[0], "initial");
  assert.equal(stages.includes("push"), true);
  assert.equal(stages[stages.length - 1], "final");
  assert.equal(Array.isArray(result.trace.steps[0].groups), true);
  assert.deepEqual(result.trace.steps[result.trace.steps.length - 1].selectedIds, pickedIds(result));
}

function test_role_aware_push_applies_aux_compensation_refinement() {
  const groups = [
    {
      index: 0,
      material: {name: "Main", role: "main", count: 1},
      candidates: [
        makeCandidate("m1", 0.70, 0, "main")
      ]
    },
    {
      index: 1,
      material: {name: "Aux", role: "aux", count: 9},
      candidates: [
        makeCandidate("a0", 0.3666667, 1, "aux"),
        makeCandidate("a1", 0.4666667, 1, "aux"),
        makeCandidate("a2", 0.4666667, 1, "aux"),
        makeCandidate("a3", 0.4666667, 1, "aux"),
        makeCandidate("a4", 0.4666667, 1, "aux"),
        makeCandidate("a5", 0.4666667, 1, "aux"),
        makeCandidate("a6", 0.4666667, 1, "aux"),
        makeCandidate("a7", 0.4666667, 1, "aux"),
        makeCandidate("a8", 0.4666667, 1, "aux"),
        makeCandidate("a9", 0.4666667, 1, "aux"),
        makeCandidate("a10", 0.6166667, 1, "aux")
      ]
    }
  ];

  const result = searchRoleAwarePushSolution({
    groups,
    targetValue: 0.50
  });

  assert.equal(result.overall < 0.50, true);
  assert.equal(Math.abs(result.overall - 0.495) < 1e-6, true);
  assert.equal(pickedIds(result).includes("a0"), true);
  assert.equal(pickedIds(result).includes("a10"), true);
  assert.equal(result.trace.steps.some((step) => step.stage === "refine_swap" && step.pattern === "aux_up_aux_down"), true);
}

function test_single_material_compensation_chooses_closest_global_second_swap() {
  const selected = [
    makeCandidate("b1", 0.49, 0, "main"),
    makeCandidate("b2", 0.30, 0, "main"),
    makeCandidate("b3", 0.30, 0, "main"),
    makeCandidate("b4", 0.30, 0, "main"),
    makeCandidate("u1", 0.561, 0, "main"),
    makeCandidate("u2", 0.562, 0, "main"),
    makeCandidate("u3", 0.563, 0, "main"),
    makeCandidate("u4", 0.564, 0, "main"),
    makeCandidate("u5", 0.565, 0, "main"),
    makeCandidate("u6", 0.566, 0, "main")
  ];
  const below = [
    makeCandidate("b1", 0.49, 0, "main"),
    makeCandidate("b2", 0.30, 0, "main"),
    makeCandidate("b3", 0.30, 0, "main"),
    makeCandidate("b4", 0.30, 0, "main"),
    makeCandidate("b5", 0.10, 0, "main")
  ];
  const upper = [
    makeCandidate("x0", 0.558, 0, "main"),
    makeCandidate("x1", 0.560, 0, "main"),
    makeCandidate("u1", 0.561, 0, "main"),
    makeCandidate("u2", 0.562, 0, "main"),
    makeCandidate("u3", 0.563, 0, "main"),
    makeCandidate("u4", 0.564, 0, "main"),
    makeCandidate("u5", 0.565, 0, "main"),
    makeCandidate("u6", 0.566, 0, "main"),
    makeCandidate("x9", 0.726, 0, "main")
  ];

  const result = refineSingleMaterialCompensation({
    selected,
    below,
    upper,
    targetValue: 0.50
  });

  const ids = (Array.isArray(result && result.selected) ? result.selected : [])
    .map((candidate) => String(candidate && candidate.id || ""))
    .sort();
  assert.equal(result.overall < 0.50, true);
  assert.equal(Math.abs(result.overall - 0.4999) < 1e-6, true);
  assert.equal(ids.includes("x9"), true);
  assert.equal(ids.includes("x0"), true);
  assert.equal(ids.includes("b5"), false);
}

function test_single_material_compensation_exposes_second_swap_pruning_trace() {
  const selected = [
    makeCandidate("b1", 0.49, 0, "main"),
    makeCandidate("b2", 0.30, 0, "main"),
    makeCandidate("b3", 0.30, 0, "main"),
    makeCandidate("b4", 0.30, 0, "main"),
    makeCandidate("u1", 0.561, 0, "main"),
    makeCandidate("u2", 0.562, 0, "main"),
    makeCandidate("u3", 0.563, 0, "main"),
    makeCandidate("u4", 0.564, 0, "main"),
    makeCandidate("u5", 0.565, 0, "main"),
    makeCandidate("u6", 0.566, 0, "main")
  ];
  const below = [
    makeCandidate("b1", 0.49, 0, "main"),
    makeCandidate("b2", 0.30, 0, "main"),
    makeCandidate("b3", 0.30, 0, "main"),
    makeCandidate("b4", 0.30, 0, "main"),
    makeCandidate("b5", 0.10, 0, "main")
  ];
  const upper = [
    makeCandidate("x0", 0.558, 0, "main"),
    makeCandidate("x1", 0.560, 0, "main"),
    makeCandidate("u1", 0.561, 0, "main"),
    makeCandidate("u2", 0.562, 0, "main"),
    makeCandidate("u3", 0.563, 0, "main"),
    makeCandidate("u4", 0.564, 0, "main"),
    makeCandidate("u5", 0.565, 0, "main"),
    makeCandidate("u6", 0.566, 0, "main"),
    makeCandidate("x9", 0.726, 0, "main")
  ];

  const result = refineSingleMaterialCompensation({
    selected,
    below,
    upper,
    targetValue: 0.50
  });

  const step = Array.isArray(result && result.traceSteps) ? result.traceSteps[0] : null;
  assert.equal(!!(step && step.debug), true);
  assert.equal(Array.isArray(step.debug.firstSwapAttempts), true);

  const attempt = step.debug.firstSwapAttempts.find((entry) => (
    entry
    && entry.firstSwap
    && entry.firstSwap.removedId === "b1"
    && entry.firstSwap.addedId === "x9"
  ));
  assert.equal(!!attempt, true);
  assert.equal(attempt.firstSwap.rejectedReason, "over_target");
  assert.equal(Number(attempt.secondSwap && attempt.secondSwap.evaluated || 0) > 0, true);
  assert.equal(Number(attempt.secondSwap && attempt.secondSwap.rejected && attempt.secondSwap.rejected.over_target || 0) > 0, true);
  assert.equal(attempt.secondSwap && attempt.secondSwap.best && attempt.secondSwap.best.removedId, "u6");
  assert.equal(attempt.secondSwap && attempt.secondSwap.best && attempt.secondSwap.best.addedId, "x0");
}

function test_search_best_solution_infinite_mode_can_cross_target_for_closer_single_material_match() {
  const groups = [
    {
      index: 0,
      material: {name: "Solo", role: "main", count: 10},
      candidates: [
        makeCandidate("b1", 0.47, 0, "main"),
        makeCandidate("b2", 0.47, 0, "main"),
        makeCandidate("b3", 0.47, 0, "main"),
        makeCandidate("b4", 0.47, 0, "main"),
        makeCandidate("b5", 0.47, 0, "main"),
        makeCandidate("u1", 0.53, 0, "main"),
        makeCandidate("u2", 0.53, 0, "main"),
        makeCandidate("u3", 0.53, 0, "main"),
        makeCandidate("u4", 0.53, 0, "main"),
        makeCandidate("u5", 0.51, 0, "main"),
        makeCandidate("u6", 0.531, 0, "main")
      ]
    }
  ];

  const belowOnly = searchCraftAssistBestSolution({
    groups,
    targetValue: 0.50
  });
  const infinite = searchCraftAssistBestSolution({
    groups,
    targetValue: 0.50,
    approachMode: "infinite"
  });

  assert.equal(!!belowOnly, true);
  assert.equal(!!infinite, true);
  assert.equal(belowOnly.overall < 0.50, true);
  assert.equal(infinite.overall > 0.50, true);
  assert.equal(pickedIds(belowOnly).includes("u5"), true);
  assert.equal(pickedIds(belowOnly).includes("u1"), false);
  assert.equal(pickedIds(infinite).includes("u5"), false);
  assert.equal(pickedIds(infinite).includes("u1"), true);
  assert.equal(Math.abs(infinite.overall - 0.50) < Math.abs(belowOnly.overall - 0.50), true);
}

function test_search_beam_profile_is_optional_and_preserves_result() {
  const groups = [
    {
      index: 0,
      material: {name: "Solo", role: "main", count: 10},
      candidates: [
        makeCandidate("b1", 0.47, 0, "main"),
        makeCandidate("b2", 0.47, 0, "main"),
        makeCandidate("b3", 0.47, 0, "main"),
        makeCandidate("b4", 0.47, 0, "main"),
        makeCandidate("b5", 0.47, 0, "main"),
        makeCandidate("u1", 0.53, 0, "main"),
        makeCandidate("u2", 0.53, 0, "main"),
        makeCandidate("u3", 0.53, 0, "main"),
        makeCandidate("u4", 0.53, 0, "main"),
        makeCandidate("u5", 0.51, 0, "main"),
        makeCandidate("u6", 0.531, 0, "main")
      ]
    }
  ];
  const baseline = searchCraftAssistBestSolution({
    groups,
    targetValue: 0.50,
    approachMode: "infinite",
    beamWidth: 12
  });
  const profileEvents = [];
  const profiled = searchCraftAssistBestSolution({
    groups,
    targetValue: 0.50,
    approachMode: "infinite",
    beamWidth: 12,
    onSearchProfile(event) {
      profileEvents.push(event);
    }
  });

  assert.equal(!!baseline, true);
  assert.equal(!!profiled, true);
  assert.equal(Object.prototype.hasOwnProperty.call(baseline, "profile"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(profiled, "profile"), false);
  assert.deepEqual(pickedIds(profiled), pickedIds(baseline));
  assert.equal(profiled.overall, baseline.overall);
  assert.deepEqual(profiled.scoreTuple, baseline.scoreTuple);
  assert.equal(profiled.windowExtra, baseline.windowExtra);
  assert.equal(profileEvents.length > 0, true);

  const event = profileEvents.find((entry) => entry && entry.phase === "beam_cap");
  assert.equal(!!event, true);
  assertFiniteNonNegativeNumber(event.capExtra, "capExtra");
  assertFiniteNonNegativeNumber(event.totalSlots, "totalSlots");
  assertFiniteNonNegativeNumber(event.elapsedMs, "elapsedMs");
  assert.equal(typeof event.stopReason, "string");
  assert.equal(Array.isArray(event.innerExtras), true);
  assert.equal(event.innerExtras.length > 0, true);

  const inner = event.innerExtras[0];
  assertFiniteNonNegativeNumber(inner.extra, "inner.extra");
  assert.equal(Array.isArray(inner.windowSizes), true);
  assert.equal(inner.windowSizes.every((value) => Number.isFinite(Number(value)) && Number(value) >= 0), true);
  assertFiniteNonNegativeNumber(inner.slotCount, "inner.slotCount");
  assertFiniteNonNegativeNumber(inner.beamInputStates, "inner.beamInputStates");
  assertFiniteNonNegativeNumber(inner.beamOutputStates, "inner.beamOutputStates");
  assertFiniteNonNegativeNumber(inner.candidateAttempts, "inner.candidateAttempts");
  assertFiniteNonNegativeNumber(inner.duplicateSkips, "inner.duplicateSkips");
  assertFiniteNonNegativeNumber(inner.nextStates, "inner.nextStates");
  assertFiniteNonNegativeNumber(inner.partialScoreAttempts, "inner.partialScoreAttempts");
  assertFiniteNonNegativeNumber(inner.partialPrunedStates, "inner.partialPrunedStates");
  assertFiniteNonNegativeNumber(inner.completeScoreAttempts, "inner.completeScoreAttempts");
  assertFiniteNonNegativeNumber(inner.elapsedMs, "inner.elapsedMs");
  assert.equal(typeof inner.stopReason, "string");
  assertBeamProfilePayloadShape(event);
}

function test_search_beam_profile_collapses_canonical_duplicates_before_partial_scoring() {
  const raw = "0.214285";
  const inputStep = Math.fround(Number(raw));
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below",
    offsetValue: Number(raw) * 0.01
  });
  const primaryHigh = (
    Number(targetStepSpec.targetStep) * 3
    - Number(targetStepSpec.lowerTargetStep) * 2
  );
  const groups = [
    {
      index: 0,
      material: {name: "Solo", role: "main", count: 3},
      // This intentionally creates different slot orders for the same group candidates.
      candidates: [
        makeCandidate("lower-1", targetStepSpec.lowerTargetStep, 0, "main"),
        makeCandidate("lower-2", targetStepSpec.lowerTargetStep, 0, "main"),
        makeCandidate("lower-3", targetStepSpec.lowerTargetStep, 0, "main"),
        makeCandidate("primary-high", primaryHigh, 0, "main"),
        makeCandidate("distant", Math.fround(targetStepSpec.lowerTargetStep - 0.01), 0, "main")
      ]
    }
  ];
  const baseline = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec,
    beamWidth: 8
  });
  const profileEvents = [];
  const profiled = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec,
    beamWidth: 8,
    onSearchProfile(event) {
      profileEvents.push(event);
    }
  });

  assert.equal(!!baseline, true);
  assert.equal(!!profiled, true);
  assert.equal(targetStepSpec.inputRaw, null);
  assert.equal(targetStepSpec.targetStep < inputStep, true);
  assert.deepEqual(pickedIds(profiled), pickedIds(baseline));
  assert.equal(profiled.overall, baseline.overall);
  assert.deepEqual(profiled.scoreTuple, baseline.scoreTuple);
  assert.equal(profiled.windowExtra, baseline.windowExtra);
  assert.deepEqual(profiled.materialResults, baseline.materialResults);
  assert.equal(profiled.overall < inputStep, true);
  assert.equal(profileEvents.length > 0, true);
  assert.equal(sumBeamProfileField(profileEvents, "nextStates") > 0, true);
  assert.equal(
    sumBeamProfileField(profileEvents, "partialScoreAttempts")
      === sumBeamProfileField(profileEvents, "nextStates"),
    true
  );
  for (const event of profileEvents) {
    assertBeamProfilePayloadShape(event);
  }
}

function test_search_beam_collapses_single_group_repeated_slot_permutations_during_generation() {
  const raw = "0.214285";
  const inputStep = Math.fround(Number(raw));
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below",
    offsetValue: Number(raw) * 0.01
  });
  const targetStep = Number(targetStepSpec.targetStep);
  const lowerTargetStep = Number(targetStepSpec.lowerTargetStep);
  const primaryHigh = targetStep * 3 - lowerTargetStep * 2;
  const groups = [
    {
      index: 0,
      material: {name: "Solo", role: "main", count: 3},
      candidates: [
        makeCandidate("near-1", Math.fround(targetStep - 0.0002), 0, "main"),
        makeCandidate("near-2", Math.fround(targetStep - 0.0004), 0, "main"),
        makeCandidate("near-3", Math.fround(targetStep - 0.0006), 0, "main"),
        makeCandidate("lower-1", lowerTargetStep, 0, "main"),
        makeCandidate("lower-2", lowerTargetStep, 0, "main"),
        makeCandidate("primary-high", primaryHigh, 0, "main")
      ]
    }
  ];
  const baseline = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec,
    beamWidth: 100
  });
  const profileEvents = [];
  const profiled = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec,
    beamWidth: 100,
    onSearchProfile(event) {
      profileEvents.push(event);
    }
  });

  assert.equal(!!baseline, true);
  assert.equal(!!profiled, true);
  assert.equal(targetStepSpec.targetStep < Number(raw), true);
  const oracle = findUniqueRawBelowExactMeanCombination(
    groups[0].candidates,
    groups[0].material.count,
    targetStep,
    raw
  );
  assert.deepEqual(oracle.pickedIds, ["lower-1", "lower-2", "primary-high"]);
  assert.deepEqual(pickedIds(profiled), oracle.pickedIds);
  assert.equal(profiled.overall, oracle.overall);
  assert.deepEqual(pickedIds(profiled), pickedIds(baseline));
  assert.equal(profiled.overall, baseline.overall);
  assert.deepEqual(profiled.scoreTuple, baseline.scoreTuple);
  assert.equal(profiled.windowExtra, baseline.windowExtra);
  assert.deepEqual(profiled.materialResults, baseline.materialResults);
  assert.equal(profiled.overall < Number(raw), true);
  assert.equal(profileEvents.length > 0, true);
  assert.equal(
    profileEvents.some((event) => Array.isArray(event && event.innerExtras)
      && event.innerExtras.some((inner) => Array.isArray(inner && inner.windowSizes)
        && inner.windowSizes.includes(6))),
    true
  );

  const nextStates = sumBeamProfileField(profileEvents, "nextStates");
  const combinationLevelNextStates = sumSingleGroupCombinationLevelNextStates(profileEvents);
  assert.equal(combinationLevelNextStates > 0, true);
  assert.equal(
    nextStates <= combinationLevelNextStates,
    true,
    `same-group generation should stay at combination level: ${nextStates} > ${combinationLevelNextStates}`
  );
  for (const event of profileEvents) {
    assertBeamProfilePayloadShape(event);
  }
}

function test_search_beam_collapses_multi_group_repeated_slot_permutations_during_generation() {
  const groups = [
    {
      index: 0,
      material: {name: "Main", role: "main", count: 2},
      candidates: [
        makeCandidate("main-low", 0.40, 0, "main"),
        makeCandidate("main-mid", 0.50, 0, "main"),
        makeCandidate("main-high", 0.60, 0, "main")
      ]
    },
    {
      index: 1,
      material: {name: "Anchor", role: "main", count: 1},
      candidates: [
        makeCandidate("anchor-low", 0.45, 1, "main"),
        makeCandidate("anchor-high", 0.55, 1, "main")
      ]
    }
  ];
  const baseline = searchCraftAssistBestSolution({
    groups,
    targetValue: 0.50,
    approachMode: "infinite",
    beamWidth: 8
  });
  const profileEvents = [];
  const profiled = searchCraftAssistBestSolution({
    groups,
    targetValue: 0.50,
    approachMode: "infinite",
    beamWidth: 8,
    onSearchProfile(event) {
      profileEvents.push(event);
    }
  });
  const oracle = findBestNeutralMultiGroupCombination(groups, 0.50, "infinite");

  assert.equal(!!baseline, true);
  assert.equal(!!profiled, true);
  assert.equal(oracle.legalSelections.length > 1, true, "fixture should expose multiple legal final combinations");
  assert.equal(!!oracle.best, true);
  assert.deepEqual(oracle.best.pickedIds, ["anchor-high", "main-low", "main-mid"]);
  assert.deepEqual(pickedIds(profiled), pickedIds(baseline));
  assert.deepEqual(pickedIds(profiled), oracle.best.pickedIds);
  assert.equal(profiled.overall, baseline.overall);
  assert.equal(profiled.overall, oracle.best.overall);
  assert.deepEqual(profiled.scoreTuple, baseline.scoreTuple);
  assert.deepEqual(profiled.scoreTuple, oracle.best.scoreTuple);
  assert.equal(profiled.windowExtra, baseline.windowExtra);
  assert.deepEqual(profiled.materialResults, baseline.materialResults);
  assert.equal(profileEvents.length > 0, true);

  const widenedInner = profileEvents.flatMap((event) => (
    Array.isArray(event && event.innerExtras) ? event.innerExtras : []
  )).find((inner) => (
    Array.isArray(inner && inner.windowSizes)
    && inner.windowSizes.length === 2
    && Number(inner.windowSizes[0]) === 3
    && Number(inner.windowSizes[1]) === 2
  ));
  assert.equal(!!widenedInner, true);
  assert.equal(Number(widenedInner && widenedInner.nextStates || 0), 14);

  const nextStates = sumBeamProfileField(profileEvents, "nextStates");
  assert.equal(
    nextStates,
    18,
    `multi-group generation should collapse canonical-equivalent repeated-slot states before push: ${nextStates}`
  );
  for (const event of profileEvents) {
    assertBeamProfilePayloadShape(event);
  }
}

function test_search_beam_profile_target_step_stop_reason_preserves_result() {
  const inputStep = Math.fround(0.27);
  const targetStep = prevFloat32(inputStep);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below"
  });
  const groups = [
    {
      index: 0,
      material: {name: "Solo", role: "main", count: 10},
      candidates: [
        ...Array.from({length: 10}, (_, index) => makeCandidate(`input-${index + 1}`, inputStep, 0, "main")),
        ...Array.from({length: 10}, (_, index) => makeCandidate(`target-${index + 1}`, targetStep, 0, "main"))
      ]
    }
  ];
  const baseline = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec,
    beamWidth: 12
  });
  const profileEvents = [];
  const profiled = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec,
    beamWidth: 12,
    onSearchProfile(event) {
      profileEvents.push(event);
    }
  });

  assert.equal(!!baseline, true);
  assert.equal(!!profiled, true);
  assert.deepEqual(pickedIds(profiled), pickedIds(baseline));
  assert.equal(profiled.overall, baseline.overall);
  assert.deepEqual(profiled.scoreTuple, baseline.scoreTuple);
  assert.equal(profiled.windowExtra, baseline.windowExtra);
  assert.equal(profileEvents.length > 0, true);
  const stopReasons = profileEvents.flatMap((event) => [
    String(event && event.stopReason || ""),
    ...(Array.isArray(event && event.innerExtras)
      ? event.innerExtras.map((inner) => String(inner && inner.stopReason || ""))
      : [])
  ]);
  assert.equal(
    stopReasons.includes("primary_target_step") || stopReasons.includes("stable_target_window_fallback"),
    true
  );
  for (const event of profileEvents) {
    assertBeamProfilePayloadShape(event);
  }
}

function test_search_beam_reuses_inner_extra_across_cap_expansion_without_result_change() {
  const raw = "0.214285";
  const inputStep = Math.fround(Number(raw));
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below",
    offsetValue: Number(raw) * 0.01
  });
  const primaryHigh = (
    Number(targetStepSpec.targetStep) * 10
    - Number(targetStepSpec.lowerTargetStep) * 9
  );
  const groups = [
    {
      index: 0,
      material: {name: "Aux", role: "aux", count: 9},
      candidates: Array.from({length: 9}, (_, index) => (
        makeCandidate(`aux-lower-${index + 1}`, targetStepSpec.lowerTargetStep, 0, "aux")
      ))
    },
    {
      index: 1,
      material: {name: "Main", role: "main", count: 1},
      candidates: [
        ...Array.from({length: 25}, (_, index) => (
          makeCandidate(`main-lower-${index + 1}`, targetStepSpec.lowerTargetStep, 1, "main")
        )),
        makeCandidate("main-primary-high", primaryHigh, 1, "main")
      ]
    }
  ];
  const baseline = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec,
    beamWidth: 2
  });
  const attemptedCaps = [];
  const profileEvents = [];
  const profiled = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec,
    beamWidth: 2,
    onSearchProgress(event) {
      if (event && event.phase === "cap") attemptedCaps.push(Number(event.capExtra));
    },
    onSearchProfile(event) {
      profileEvents.push(event);
    }
  });

  assert.equal(!!baseline, true);
  assert.equal(!!profiled, true);
  assert.deepEqual(pickedIds(profiled), pickedIds(baseline));
  assert.equal(profiled.overall, baseline.overall);
  assert.deepEqual(profiled.scoreTuple, baseline.scoreTuple);
  assert.equal(profiled.windowExtra, baseline.windowExtra);
  assert.equal(Math.max(...attemptedCaps) > 24, true);
  assert.equal(profileEvents.length >= 2, true);
  assert.equal(countBeamProfileInnerWhere(profileEvents, (inner) => inner && inner.cacheHit === true) > 0, true);
  assert.equal(
    countBeamProfileInnerWhere(profileEvents, (inner) => (
      inner && inner.cacheHit === true && String(inner.stopReason || "").endsWith("_cached")
    )),
    0
  );
  assert.equal(profileEvents.reduce((sum, event) => sum + Number(event && event.reusedInnerExtras || 0), 0) > 0, true);
  assert.equal(sumBeamProfileField(profileEvents, "candidateAttempts") < 5000, true);
  assert.equal(sumBeamProfileField(profileEvents, "partialScoreAttempts") < 3000, true);
  assert.equal(sumBeamProfileField(profileEvents, "completeScoreAttempts") < 60, true);
  for (const event of profileEvents) {
    assertBeamProfilePayloadShape(event);
  }
}

function test_search_step_target_below_uses_previous_float32_step() {
  const inputStep = Math.fround(0.27);
  const targetStep = prevFloat32(inputStep);
  const groups = [
    {
      index: 0,
      material: {name: "Solo", role: "main", count: 10},
      candidates: [
        ...Array.from({length: 10}, (_, index) => makeCandidate(`input-${index + 1}`, inputStep, 0, "main")),
        ...Array.from({length: 10}, (_, index) => makeCandidate(`target-${index + 1}`, targetStep, 0, "main"))
      ]
    }
  ];

  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec: resolveCraftAssistTargetStepSpec({
      inputStep,
      approachMode: "below"
    })
  });

  assert.equal(!!result, true);
  assert.equal(Math.fround(result.overall), targetStep);
  assert.equal(pickedIds(result).every((id) => id.startsWith("target-")), true);
}

function test_search_offset_window_prefers_primary_below_step_over_lower_allowed_step() {
  const inputStep = Math.fround(0.27);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below",
    offsetValue: 0.01
  });
  const groups = [
    {
      index: 0,
      material: {name: "Solo", role: "main", count: 10},
      candidates: [
        ...Array.from({length: 10}, (_, index) => makeCandidate(`lower-${index + 1}`, targetStepSpec.lowerTargetStep, 0, "main")),
        ...Array.from({length: 10}, (_, index) => makeCandidate(`target-${index + 1}`, targetStepSpec.targetStep, 0, "main"))
      ]
    }
  ];

  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec
  });

  assert.equal(!!result, true);
  assert.equal(Math.fround(result.overall), targetStepSpec.targetStep);
  assert.equal(pickedIds(result).every((id) => id.startsWith("target-")), true);
}

function test_search_offset_window_returns_lower_allowed_step_when_primary_unavailable() {
  const inputStep = Math.fround(0.27);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below",
    offsetValue: 0.01
  });
  const belowWindow = Math.fround(Number(targetStepSpec.lowerTargetStep) - 0.005);
  const groups = [
    {
      index: 0,
      material: {name: "Solo", role: "main", count: 10},
      candidates: [
        ...Array.from({length: 10}, (_, index) => makeCandidate(`outside-${index + 1}`, belowWindow, 0, "main")),
        ...Array.from({length: 10}, (_, index) => makeCandidate(`lower-${index + 1}`, targetStepSpec.lowerTargetStep, 0, "main"))
      ]
    }
  ];

  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec
  });

  assert.equal(!!result, true);
  assert.equal(Math.fround(result.overall), targetStepSpec.lowerTargetStep);
  assert.equal(pickedIds(result).every((id) => id.startsWith("lower-")), true);
  assert.equal(result.windowExtra, 0);
}

function test_search_target_step_prepares_candidates_once_per_group() {
  const inputStep = Math.fround(0.27);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below",
    offsetValue: 0.01
  });
  let valueReadCount = 0;
  const candidates = Array.from({length: 10}, (_, index) => {
    const candidate = makeCandidate(`target-${index + 1}`, targetStepSpec.targetStep, 0, "main");
    Object.defineProperty(candidate, "value", {
      enumerable: true,
      get() {
        valueReadCount += 1;
        return targetStepSpec.targetStep;
      }
    });
    return candidate;
  });
  const groups = [
    {
      index: 0,
      material: {name: "Solo", role: "main", count: 10},
      candidates
    }
  ];

  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec
  });

  assert.equal(!!result, true);
  assert.equal(Math.fround(result.overall), targetStepSpec.targetStep);
  const available = result.materialResults[0].available;
  const selected = result.materialResults[0].selected;
  const availableIds = new Set(available.map((candidate) => String(candidate && candidate.id || "")));
  assert.equal(selected.every((candidate) => availableIds.has(String(candidate && candidate.id || ""))), true);
  assert.equal(valueReadCount, candidates.length * 2);
}

function test_score_partial_state_prefers_incremental_stats_without_rescanning_selected_values() {
  const {scorePartialState} = loadCraftAssistSearchInternals();
  let valueReadCount = 0;
  const specs = [
    {id: "main-low", value: 0.40, groupIndex: 0, role: "main"},
    {id: "main-high", value: 0.58, groupIndex: 0, role: "main"},
    {id: "aux-mid", value: 0.48, groupIndex: 1, role: "aux"}
  ];
  const selected = specs.map(({id, value, groupIndex, role}) => {
    const candidate = makeCandidate(id, value, groupIndex, role);
    Object.defineProperty(candidate, "value", {
      enumerable: true,
      get() {
        valueReadCount += 1;
        return value;
      }
    });
    return candidate;
  });
  const partialStats = {
    count: 3,
    sum: 1.46,
    sumSquares: 0.7268,
    radiusToSearchTarget: Math.max(
      Math.abs(0.40 - 0.50),
      Math.abs(0.58 - 0.50),
      Math.abs(0.48 - 0.50)
    ),
    absDistanceSumToSearchTarget: (
      Math.abs(0.40 - 0.50)
      + Math.abs(0.58 - 0.50)
      + Math.abs(0.48 - 0.50)
    ),
    aboveCount: 1,
    belowCount: 2,
    mainCount: 2,
    mainSum: 0.98,
    auxCount: 1,
    auxSum: 0.48,
    mainBelowCount: 1,
    auxAboveCount: 0
  };

  const expected = scorePartialState({
    selected,
    sum: partialStats.sum
  }, 3, 0.50, "multi_material_role", "infinite");

  assert.equal(valueReadCount > 0, true);

  valueReadCount = 0;
  const actual = scorePartialState({
    selected,
    sum: partialStats.sum,
    partialStats
  }, 3, 0.50, "multi_material_role", "infinite");

  assertScoreTupleAlmostEqual(
    actual,
    expected,
    1e-12,
    "manual partialStats fast path should stay tolerance-equivalent to slow path"
  );
  assert.equal(valueReadCount, 0);
}

function test_score_partial_state_incremental_stats_matches_slow_path_for_single_material_infinite() {
  const selected = [
    makeCandidate("single-low", 0.41, 0, "main"),
    makeCandidate("single-mid", 0.48, 0, "main"),
    makeCandidate("single-high", 0.57, 0, "main")
  ];

  assertIncrementalPartialStatsScoreMatchesSlowPath({
    selected,
    totalSlots: 5,
    targetValue: 0.50,
    mode: "single_material",
    approachMode: "infinite",
    label: "single_material infinite partial score"
  });
}

function test_score_partial_state_incremental_stats_matches_slow_path_for_multi_material_role_infinite() {
  const selected = [
    makeCandidate("main-low", 0.40, 0, "main"),
    makeCandidate("aux-mid", 0.48, 1, "aux"),
    makeCandidate("main-high", 0.58, 0, "main")
  ];

  assertIncrementalPartialStatsScoreMatchesSlowPath({
    selected,
    totalSlots: 4,
    targetValue: 0.50,
    mode: "multi_material_role",
    approachMode: "infinite",
    label: "multi_material_role infinite partial score"
  });
}

function test_score_partial_state_incremental_stats_matches_slow_path_for_single_material_target_step() {
  const inputStep = Math.fround(0.27);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below"
  });
  const selected = [
    makeCandidate("step-low", Math.fround(targetStepSpec.targetStep - 0.004), 0, "main"),
    makeCandidate("step-mid", targetStepSpec.targetStep, 0, "main"),
    makeCandidate("step-high", Math.fround(targetStepSpec.targetStep + 0.002), 0, "main")
  ];

  assertIncrementalPartialStatsScoreMatchesSlowPath({
    selected,
    totalSlots: 5,
    targetValue: inputStep,
    mode: "single_material",
    approachMode: "below",
    targetStepSpec,
    label: "single_material targetStep partial score"
  });
}

function test_score_partial_state_incremental_stats_matches_slow_path_for_multi_material_role_target_step() {
  const inputStep = Math.fround(0.27);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below"
  });
  const selected = [
    makeCandidate("main-near", Math.fround(targetStepSpec.targetStep - 0.001), 0, "main"),
    makeCandidate("aux-low", Math.fround(targetStepSpec.targetStep - 0.003), 1, "aux"),
    makeCandidate("main-high", Math.fround(targetStepSpec.targetStep + 0.002), 0, "main")
  ];

  assertIncrementalPartialStatsScoreMatchesSlowPath({
    selected,
    totalSlots: 4,
    targetValue: inputStep,
    mode: "multi_material_role",
    approachMode: "below",
    targetStepSpec,
    label: "multi_material_role targetStep partial score"
  });
}

function test_partial_stats_variance_matches_scan_with_tolerance() {
  const {calcVarianceFromPartialStats} = loadCraftAssistSearchInternals();
  const selected = [
    makeCandidate("variance-1", 0.401, 0, "main"),
    makeCandidate("variance-2", 0.487, 0, "main"),
    makeCandidate("variance-3", 0.573, 1, "aux")
  ];
  const partialStats = buildPartialStatsForTest(selected, 0.50);
  const scannedVariance = calcVarianceFromCandidates(selected);
  const statsVariance = calcVarianceFromPartialStats(partialStats);

  assertAlmostEqual(
    statsVariance,
    scannedVariance,
    1e-12,
    "variance from partial stats should stay tolerance-equivalent to scanned variance"
  );
}

function test_search_raw_aware_below_prefers_primary_target_step_from_target_step_spec() {
  const raw = 0.21;
  const inputStep = Math.fround(raw);
  const expectedTargetStep = Math.fround(raw - 0.0000001);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below"
  });
  const previousStep = prevFloat32(targetStepSpec.targetStep);
  const groups = [
    {
      index: 0,
      material: {name: "Solo", role: "main", count: 10},
      candidates: [
        ...Array.from({length: 10}, (_, index) => makeCandidate(`prev-${index + 1}`, previousStep, 0, "main")),
        ...Array.from({length: 10}, (_, index) => makeCandidate(`target-${index + 1}`, targetStepSpec.targetStep, 0, "main"))
      ]
    }
  ];

  assert.equal(targetStepSpec.targetStep, expectedTargetStep);

  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: raw,
    targetStepSpec
  });

  assert.equal(!!result, true);
  assert.equal(Math.fround(result.overall), targetStepSpec.targetStep);
  assert.equal(pickedIds(result).every((id) => id.startsWith("target-")), true);
}

function test_search_below_raw_allows_normalized_overall_between_conservative_and_original_target() {
  const rawTarget = 0.21;
  const conservativeTarget = rawTarget - 0.0000001;
  const normalizedOverall = 0.20999995;
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep: Math.fround(rawTarget),
    inputRaw: rawTarget,
    approachMode: "below"
  });
  const selected = Array.from({length: 10}, (_, index) => makeCandidate(
    `normalized-${index + 1}`,
    normalizedOverall,
    0,
    "main"
  ));

  assert.equal(normalizedOverall < rawTarget, true);
  assert.equal(normalizedOverall > conservativeTarget, true);

  const scored = scoreCraftAssistSolutionSingleMaterial({
    selected,
    targetValue: rawTarget,
    approachMode: "below",
    targetStepSpec
  });

  assert.equal(!!scored, true, "normalized result below original target should stay legal");
  assert.equal(Math.abs(scored.overall - normalizedOverall) < 1e-12, true);
}

function test_search_raw_aware_offset_window_uses_target_step_spec_without_raw_parsing() {
  const raw = 0.21;
  const inputStep = Math.fround(raw);
  const expectedTargetStep = Math.fround(raw - 0.0000001);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below",
    offsetValue: 0.01
  });
  const groups = [
    {
      index: 0,
      material: {name: "Solo", role: "main", count: 10},
      candidates: [
        ...Array.from({length: 10}, (_, index) => makeCandidate(`lower-${index + 1}`, targetStepSpec.lowerTargetStep, 0, "main")),
        ...Array.from({length: 10}, (_, index) => makeCandidate(`target-${index + 1}`, targetStepSpec.targetStep, 0, "main"))
      ]
    }
  ];

  assert.equal(targetStepSpec.targetStep, expectedTargetStep);
  assert.equal(targetStepSpec.lowerTargetStep < targetStepSpec.targetStep, true);

  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: raw,
    targetStepSpec
  });

  assert.equal(!!result, true);
  assert.equal(Math.fround(result.overall), targetStepSpec.targetStep);
  assert.equal(pickedIds(result).every((id) => id.startsWith("target-")), true);
}

function test_search_raw_aware_below_offset_expands_past_lower_window_hit_for_primary_step() {
  const raw = "0.214285";
  const inputStep = Math.fround(Number(raw));
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below",
    offsetValue: Number(raw) * 0.01
  });
  const primaryHigh = (
    Number(targetStepSpec.targetStep) * 10
    - Number(targetStepSpec.lowerTargetStep) * 9
  );
  const groups = [
    {
      index: 0,
      material: {name: "Solo", role: "main", count: 10},
      candidates: [
        ...Array.from({length: 15}, (_, index) => makeCandidate(`lower-${index + 1}`, targetStepSpec.lowerTargetStep, 0, "main")),
        makeCandidate("primary-high", primaryHigh, 0, "main")
      ]
    }
  ];

  assert.equal(targetStepSpec.targetStep < Number(raw), true);
  assert.equal(targetStepSpec.lowerTargetStep < targetStepSpec.targetStep, true);
  assert.equal(Math.fround((targetStepSpec.lowerTargetStep * 9 + primaryHigh) / 10), targetStepSpec.targetStep);

  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec
  });

  assert.equal(!!result, true);
  assert.equal(Math.fround(result.overall), targetStepSpec.targetStep);
  assert.equal(pickedIds(result).includes("primary-high"), true);
}

function test_search_raw_aware_below_offset_stops_after_stable_fallback_without_primary() {
  const raw = "0.214285";
  const inputStep = Math.fround(Number(raw));
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below",
    offsetValue: Number(raw) * 0.01
  });
  const fallbackValue = targetStepSpec.lowerTargetStep;
  const groups = [
    {
      index: 0,
      material: {name: "Solo", role: "main", count: 10},
      candidates: [
        ...Array.from({length: 10}, (_, index) => makeCandidate(`fallback-${index + 1}`, fallbackValue, 0, "main")),
        ...Array.from({length: 110}, (_, index) => makeCandidate(
          `distant-${index + 1}`,
          Math.fround(fallbackValue - 0.01 - index * 0.0001),
          0,
          "main"
        ))
      ]
    }
  ];
  const attemptedCaps = [];

  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec,
    onSearchProgress(event) {
      if (event && event.phase === "cap") attemptedCaps.push(Number(event.capExtra));
    }
  });

  assert.equal(!!result, true);
  assert.equal(Math.fround(result.overall), fallbackValue);
  assert.equal(pickedIds(result).every((id) => id.startsWith("fallback-")), true);
  assert.equal(result.windowExtra <= 24, true);
  assert.equal(Math.max(...attemptedCaps) <= 24, true);
}

function test_search_raw_aware_below_offset_single_material_keeps_searching_for_closer_fallback_after_initial_cap() {
  const raw = "0.214285";
  const inputStep = Math.fround(Number(raw));
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below",
    offsetValue: Number(raw) * 0.01
  });
  const lowerFallback = 0.21318830996751786;
  const closerFallback = prevFloat32(targetStepSpec.targetStep);
  const closerHigh = closerFallback * 10 - lowerFallback * 9;
  const groups = [
    {
      index: 0,
      material: {name: "Solo", role: "main", count: 10},
      candidates: [
        ...Array.from({length: 34}, (_, index) => makeCandidate(`lower-${index + 1}`, lowerFallback, 0, "main")),
        makeCandidate("closer-high", closerHigh, 0, "main")
      ]
    }
  ];
  assert.equal(targetStepSpec.targetStep < Number(raw), true);
  assert.equal(Math.fround(lowerFallback) >= targetStepSpec.lowerTargetStep, true);
  assert.equal(Math.fround(closerFallback) >= targetStepSpec.lowerTargetStep, true);
  assert.equal(Math.fround(closerFallback) <= targetStepSpec.upperTargetStep, true);
  assert.equal(closerFallback < Number(targetStepSpec.targetStep), true);
  assert.equal(closerHigh > Number(raw), true);

  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec,
    beamWidth: 64
  });

  assert.equal(!!result, true);
  assert.equal(pickedIds(result).includes("closer-high"), true);
  assert.equal(Math.abs(result.overall - closerFallback) < 1e-12, true);
  assert.equal(result.overall < Number(raw), true);
  assert.equal(Number(raw) - result.overall < Number(raw) - lowerFallback, true);
}

function test_search_raw_aware_below_single_material_fallback_refinement_stays_within_budget() {
  const raw = "0.214285";
  const inputStep = Math.fround(Number(raw));
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below",
    offsetValue: Number(raw) * 0.01
  });
  const fallbackValue = targetStepSpec.lowerTargetStep;
  const groups = [
    {
      index: 0,
      material: {name: "Solo", role: "main", count: 10},
      candidates: [
        ...Array.from({length: 10}, (_, index) => makeCandidate(`fallback-${index + 1}`, fallbackValue, 0, "main")),
        ...Array.from({length: 25}, (_, index) => makeCandidate(
          `distant-${index + 1}`,
          Math.fround(fallbackValue - 0.01 - index * 0.0001),
          0,
          "main"
        ))
      ]
    }
  ];
  const refinementEvents = [];
  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec,
    beamWidth: 64,
    onSearchProgress(event) {
      if (event && event.phase === "target_step_fallback_refinement") {
        refinementEvents.push(event);
      }
    }
  });

  assert.equal(!!result, true);
  assert.equal(Math.fround(result.overall), fallbackValue);
  assert.equal(result.overall < Number(raw), true);
  assert.equal(refinementEvents.length > 0, true);
  const scoredAttempts = refinementEvents.reduce((sum, event) => sum + Number(event.scoredAttempts || 0), 0);
  assert.equal(scoredAttempts <= 250, true, `expected fallback refinement scored attempts within budget, got ${scoredAttempts}`);
}

function test_search_raw_aware_below_single_material_no_offset_fast_path_returns_top_k_when_all_candidates_are_below_raw() {
  const raw = "0.214285";
  const inputStep = Math.fround(Number(raw));
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below",
    offsetValue: 0
  });
  const count = 10;
  const values = Array.from({length: 602}, (_, index) => Number(raw) - ((index + 1) * 0.000001));
  const groups = [
    {
      index: 0,
      material: {name: "Solo", role: "main", count},
      candidates: values.map((value, index) => makeCandidate(`candidate-${index + 1}`, value, 0, "main"))
    }
  ];
  const progressEvents = [];

  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec,
    enableRawBelowTopKFastPath: true,
    onSearchProgress(event) {
      progressEvents.push(event);
    }
  });

  const expectedSelected = values
    .slice(0, count)
    .map((value, index) => makeCandidate(`candidate-${index + 1}`, value, 0, "main"));
  const expectedOverall = expectedSelected.reduce((sum, candidate) => sum + Number(candidate.value || 0), 0) / count;

  assert.equal(!!result, true);
  assert.equal(progressEvents.length, 0);
  assert.equal(Math.fround(result.overall) < Number(raw), true);
  assert.equal(Math.abs(result.overall - expectedOverall) < 1e-12, true);
  assert.deepEqual(
    (Array.isArray(result.materialResults) ? result.materialResults[0].selected : []).map((candidate) => String(candidate && candidate.id || "")),
    expectedSelected.map((candidate) => String(candidate && candidate.id || ""))
  );
}

function test_search_raw_aware_below_single_material_no_offset_fast_path_is_opt_in() {
  const raw = "0.214285";
  const inputStep = Math.fround(Number(raw));
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below",
    offsetValue: 0
  });
  const count = 3;
  const values = Array.from({length: 12}, (_, index) => Number(raw) - ((index + 1) * 0.000001));
  const groups = [
    {
      index: 0,
      material: {name: "Solo", role: "main", count},
      candidates: values.map((value, index) => makeCandidate(`candidate-${index + 1}`, value, 0, "main"))
    }
  ];
  const progressEvents = [];

  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec,
    onSearchProgress(event) {
      progressEvents.push(event);
    }
  });

  assert.equal(!!result, true);
  assert.equal(progressEvents.some((event) => event && event.phase === "cap"), true);
}

function test_search_raw_aware_below_single_material_offset_window_skips_no_offset_fast_path() {
  const raw = "0.214285";
  const inputStep = Math.fround(Number(raw));
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below",
    offsetValue: Number(raw) * 0.01
  });
  const highValue = targetStepSpec.upperTargetStep;
  const lowValue = targetStepSpec.lowerTargetStep;
  const groups = [
    {
      index: 0,
      material: {name: "Solo", role: "main", count: 10},
      candidates: [
        ...Array.from({length: 10}, (_, index) => makeCandidate(`high-${index + 1}`, highValue, 0, "main")),
        makeCandidate("low-window", lowValue, 0, "main")
      ]
    }
  ];
  const progressEvents = [];

  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec,
    enableRawBelowTopKFastPath: true,
    onSearchProgress(event) {
      progressEvents.push(event);
    }
  });

  assert.equal(!!result, true);
  assert.equal(targetStepSpec.hasOffsetWindow, true);
  assert.equal(progressEvents.some((event) => event && event.phase === "cap"), true);
  assert.equal(pickedIds(result).includes("low-window"), false);
}

function test_search_sliding_anchor_diagnostic_does_not_change_prefix_baseline() {
  const raw = "0.5";
  const groups = makeSlidingAnchorFixture();
  const targetStepSpec = makeSlidingAnchorTargetStepSpec({raw});
  const baseline = searchCraftAssistBestSolution({
    groups,
    targetValue: Number(raw),
    targetStepSpec,
    beamWidth: 80
  });
  const progressEvents = [];
  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: Number(raw),
    targetStepSpec,
    beamWidth: 80,
    enableSlidingAnchorSearch: true,
    onSearchProgress(event) {
      progressEvents.push(event);
    }
  });

  assert.equal(!!baseline, true);
  assert.equal(!!result, true);
  assert.deepEqual(pickedIds(result), pickedIds(baseline));
  assert.equal(result.overall, baseline.overall);
  assert.deepEqual(result.scoreTuple, baseline.scoreTuple);
  assert.equal(result.overall < Number(raw), true);
  assert.equal(!!(result.trace && result.trace.mode === "sliding_anchor"), false);
  assert.equal(progressEvents.some((event) => event && event.phase === "sliding_anchor" && event.status === "accepted"), false);
  assert.equal(progressEvents.some((event) => event && event.phase === "cap"), true);
}

function test_search_sliding_anchor_diagnostic_rolls_back_to_boundary_after_dynamic_overshoot() {
  const raw = "0.5";
  const groups = makeSlidingAnchorFixture();
  const targetStepSpec = makeSlidingAnchorTargetStepSpec({raw});
  const preparedGroups = groups.map((group) => ({
    ...group,
    ordered: group.candidates
  }));
  const result = searchSlidingAnchorDiagnostic({
    groupsWithOrdered: preparedGroups,
    targetValue: Number(raw),
    targetStepSpec,
    mode: "multi_material_role"
  });

  assert.equal(!!result, true);
  assert.equal(result.rolledBack, true);
  assert.equal(result.rawCeiling, Number(raw));
  assert.equal(result.rawOvershootOverall > Number(raw), true);
  assert.equal(result.overall < result.rawOvershootOverall, true);
  assert.equal(result.overall < Number(raw), true);
  assert.equal(result.boundaryProbe && result.boundaryProbe.direction, "higher");
  assert.equal(result.boundaryProbe.valid === false || result.boundaryProbe.overall >= Number(raw), true);
  assert.equal(resultTraceStages(result).includes("sliding_anchor_overshoot"), true);
  assert.equal(resultTraceStages(result).includes("sliding_anchor_rollback"), true);
}

function test_search_sliding_anchor_diagnostic_keeps_descending_after_raw_ceiling_probe() {
  const raw = "0.5";
  const groups = [
    {
      index: 0,
      material: {name: "Sliding Main", role: "main", count: 8},
      candidates: Array.from({length: 8}, (_, index) => (
        makeCandidate(`m-high-${index + 1}`, 0.502, 0, "main")
      ))
    },
    {
      index: 1,
      material: {name: "Sliding Aux", role: "aux", count: 2},
      candidates: [
        makeCandidate("a-drop-0", 0.485, 1, "aux"),
        makeCandidate("a-drop-1", 0.491, 1, "aux"),
        makeCandidate("a-still-high-2", 0.4955, 1, "aux"),
        makeCandidate("a-still-high-3", 0.496, 1, "aux"),
        makeCandidate("a-still-high-4", 0.496, 1, "aux"),
        makeCandidate("a-above-raw", 0.6, 1, "aux")
      ]
    }
  ];
  const targetStepSpec = makeSlidingAnchorTargetStepSpec({raw});
  const preparedGroups = groups.map((group) => ({
    ...group,
    ordered: group.candidates
  }));
  const diagnostic = searchSlidingAnchorDiagnostic({
    groupsWithOrdered: preparedGroups,
    targetValue: Number(raw),
    targetStepSpec,
    mode: "multi_material_role"
  });

  assert.equal(!!diagnostic, true);
  assert.equal(diagnostic.overall < Number(raw), true);
  assert.equal(diagnostic.boundaryProbe && diagnostic.boundaryProbe.reason, "raw_ceiling");
  assert.equal(resultTraceStages(diagnostic).includes("sliding_anchor_overshoot"), true);
  const auxResult = diagnostic.materialResults.find((entry) => (
    entry && entry.material && entry.material.role === "aux"
  ));
  assert.deepEqual(
    (auxResult && Array.isArray(auxResult.selected) ? auxResult.selected : []).map((candidate) => candidate.id),
    ["a-drop-0", "a-drop-1"]
  );
}

function test_search_sliding_anchor_rejects_duplicate_ids_and_falls_back_to_prefix_expansion() {
  const raw = "0.5";
  const groups = makeSlidingAnchorFixture();
  groups[1].candidates[1] = makeCandidate("m-high-1", 0.11, 1, "aux");
  const targetStepSpec = makeSlidingAnchorTargetStepSpec({raw});
  const baseline = searchCraftAssistBestSolution({
    groups,
    targetValue: Number(raw),
    targetStepSpec,
    beamWidth: 80
  });
  const progressEvents = [];
  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: Number(raw),
    targetStepSpec,
    beamWidth: 80,
    enableSlidingAnchorSearch: true,
    onSearchProgress(event) {
      progressEvents.push(event);
    }
  });

  assert.equal(!!baseline, true);
  assert.equal(!!result, true);
  assert.deepEqual(pickedIds(result), pickedIds(baseline));
  assert.equal(result.overall, baseline.overall);
  assert.equal(progressEvents.some((event) => event && event.phase === "sliding_anchor"), false);
  assert.equal(progressEvents.some((event) => event && event.phase === "cap"), true);
}

function test_search_sliding_anchor_rejects_raw_ceiling_and_falls_back() {
  const raw = "0.5";
  const groups = makeSlidingAnchorFixture();
  groups[1].candidates[1] = makeCandidate("a-low-2-too-high", 0.492, 1, "aux");
  groups[1].candidates[2] = makeCandidate("a-rollback-1-too-high", 0.493, 1, "aux");
  const targetStepSpec = makeSlidingAnchorTargetStepSpec({raw});
  const progressEvents = [];
  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: Number(raw),
    targetStepSpec,
    beamWidth: 80,
    enableSlidingAnchorSearch: true,
    onSearchProgress(event) {
      progressEvents.push(event);
    }
  });

  assert.equal(!!result, true);
  assert.equal(result.overall < Number(raw), true);
  const preparedGroups = groups.map((group) => ({
    ...group,
    ordered: group.candidates
  }));
  const diagnostic = searchSlidingAnchorDiagnostic({
    groupsWithOrdered: preparedGroups,
    targetValue: Number(raw),
    targetStepSpec,
    mode: "multi_material_role"
  });
  assert.equal(!!diagnostic, true);
  assert.equal(diagnostic.rawOvershootOverall >= Number(raw), true);
  assert.equal(diagnostic.boundaryProbe && diagnostic.boundaryProbe.reason, "raw_ceiling");
  assert.equal(progressEvents.some((event) => event && event.phase === "sliding_anchor"), false);
  assert.equal(progressEvents.some((event) => event && event.phase === "cap"), true);
}

function test_search_sliding_anchor_rejects_offset_window_and_falls_back() {
  const raw = "0.5";
  const groups = makeSlidingAnchorFixture();
  const targetStepSpec = makeSlidingAnchorTargetStepSpec({raw, offsetValue: 0.01});
  const progressEvents = [];
  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: Number(raw),
    targetStepSpec,
    beamWidth: 80,
    enableSlidingAnchorSearch: true,
    onSearchProgress(event) {
      progressEvents.push(event);
    }
  });

  assert.equal(!!result, true);
  assert.equal(result.overall < Number(raw), true);
  const preparedGroups = groups.map((group) => ({
    ...group,
    ordered: group.candidates
  }));
  const diagnostic = searchSlidingAnchorDiagnostic({
    groupsWithOrdered: preparedGroups,
    targetValue: Number(raw),
    targetStepSpec,
    mode: "multi_material_role"
  });
  assert.equal(!!diagnostic, true);
  assert.equal(diagnostic.overall < Number(raw), true);
  assert.equal(progressEvents.some((event) => event && event.phase === "sliding_anchor"), false);
  assert.equal(progressEvents.some((event) => event && event.phase === "cap"), true);
}

function test_search_raw_aware_below_rejects_closer_above_raw_outside_window() {
  const raw = "0.214285";
  const inputStep = Math.fround(Number(raw));
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below",
    offsetValue: Number(raw) * 0.01
  });
  const aboveRawOutsideWindow = Math.fround(Number(raw) + 0.00001);
  const belowRawOutsideWindow = Math.fround(Number(targetStepSpec.lowerTargetStep) - 0.0005);
  const groups = [
    {
      index: 0,
      material: {name: "Solo", role: "main", count: 1},
      candidates: [
        makeCandidate("above-raw", aboveRawOutsideWindow, 0, "main"),
        makeCandidate("below-raw", belowRawOutsideWindow, 0, "main")
      ]
    }
  ];

  assert.equal(targetStepSpec.targetStep < Number(raw), true);
  assert.equal(Math.fround(aboveRawOutsideWindow) >= inputStep, true);
  assert.equal(aboveRawOutsideWindow > Number(raw), true);
  assert.equal(belowRawOutsideWindow < Number(raw), true);

  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec
  });

  assert.equal(!!result, true);
  assert.equal(Math.fround(result.overall) < inputStep, true);
  assert.equal(Math.fround(result.overall) < Number(raw), true);
  assert.deepEqual(pickedIds(result), ["below-raw"]);
}

function test_search_raw_aware_below_multi_group_does_not_stop_on_window_fallback() {
  const raw = "0.214285";
  const inputStep = Math.fround(Number(raw));
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below",
    offsetValue: Number(raw) * 0.01
  });
  const primaryHigh = (
    Number(targetStepSpec.targetStep) * 10
    - Number(targetStepSpec.lowerTargetStep) * 9
  );
  const groups = [
    {
      index: 0,
      material: {name: "Aux", role: "aux", count: 9},
      candidates: Array.from({length: 9}, (_, index) => (
        makeCandidate(`aux-lower-${index + 1}`, targetStepSpec.lowerTargetStep, 0, "aux")
      ))
    },
    {
      index: 1,
      material: {name: "Main", role: "main", count: 1},
      candidates: [
        ...Array.from({length: 25}, (_, index) => makeCandidate(
          `main-lower-${index + 1}`,
          targetStepSpec.lowerTargetStep,
          1,
          "main"
        )),
        makeCandidate("main-primary-high", primaryHigh, 1, "main")
      ]
    }
  ];
  const attemptedCaps = [];

  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec,
    beamWidth: 2,
    onSearchProgress(event) {
      if (event && event.phase === "cap") attemptedCaps.push(Number(event.capExtra));
    }
  });

  assert.equal(!!result, true);
  assert.equal(Math.max(...attemptedCaps) > 24, true);
  assert.equal(result.windowExtra, 25);
  assert.equal(Math.fround(result.overall), targetStepSpec.targetStep);
  assert.equal(pickedIds(result).includes("main-primary-high"), true);
}

function test_search_role_aware_below_offset_refines_lower_window_hit_to_primary_step() {
  const raw = "0.214285";
  const inputStep = Math.fround(Number(raw));
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below",
    offsetValue: Number(raw) * 0.01
  });
  const primaryHigh = (
    Number(targetStepSpec.targetStep) * 10
    - Number(targetStepSpec.lowerTargetStep) * 9
  );
  const groups = [
    {
      index: 0,
      material: {name: "Aux", role: "aux", count: 9},
      candidates: Array.from({length: 9}, (_, index) => (
        makeCandidate(`aux-lower-${index + 1}`, targetStepSpec.lowerTargetStep, 0, "aux")
      ))
    },
    {
      index: 1,
      material: {name: "Main", role: "main", count: 1},
      candidates: [
        makeCandidate("main-lower", targetStepSpec.lowerTargetStep, 1, "main"),
        makeCandidate("main-primary-high", primaryHigh, 1, "main")
      ]
    }
  ];

  assert.equal(targetStepSpec.targetStep < Number(raw), true);
  assert.equal(targetStepSpec.lowerTargetStep < targetStepSpec.targetStep, true);
  assert.equal(Math.fround((targetStepSpec.lowerTargetStep * 9 + primaryHigh) / 10), targetStepSpec.targetStep);

  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec,
    beamWidth: 1
  });

  assert.equal(!!result, true);
  assert.equal(Math.fround(result.overall), targetStepSpec.targetStep);
  assert.equal(pickedIds(result).includes("main-primary-high"), true);
}

function test_search_role_aware_step_spec_orders_outside_window_by_target_priority_before_side_bias() {
  const inputStep = Math.fround(0.27);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below",
    offsetValue: 0.01
  });
  const closerBelow = Math.fround(Number(targetStepSpec.lowerTargetStep) - 0.0001);
  const groups = [
    {
      index: 0,
      material: {name: "Main", role: "main", count: 1},
      candidates: [
        ...Array.from({length: 30}, (_, index) => makeCandidate(
          `farther-above-${index + 1}`,
          Math.fround(inputStep + 0.01 + index * 0.001),
          0,
          "main"
        )),
        makeCandidate("closer-below-window", closerBelow, 0, "main")
      ]
    },
    {
      index: 1,
      material: {name: "Aux", role: "aux", count: 0},
      candidates: []
    }
  ];

  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec,
    beamWidth: 1
  });

  assert.equal(!!result, true);
  assert.deepEqual(pickedIds(result), ["closer-below-window"]);
  assert.equal(result.windowExtra, 0);
}

function test_refine_role_aware_stops_when_current_mean_is_on_target_step() {
  const targetStep = Math.fround(0.5);
  const onStepButRawHigh = targetStep + 1e-8;
  const materialResults = [
    {
      material: {name: "Main", role: "main", count: 2},
      available: [
        makeCandidate("m1", onStepButRawHigh, 0, "main"),
        makeCandidate("m2", onStepButRawHigh, 0, "main")
      ],
      selected: [
        makeCandidate("m1", onStepButRawHigh, 0, "main"),
        makeCandidate("m2", onStepButRawHigh, 0, "main")
      ]
    },
    {
      material: {name: "Aux", role: "aux", count: 8},
      available: [
        makeCandidate("a1", onStepButRawHigh, 1, "aux"),
        makeCandidate("a2", onStepButRawHigh, 1, "aux"),
        makeCandidate("a3", onStepButRawHigh, 1, "aux"),
        makeCandidate("a4", onStepButRawHigh, 1, "aux"),
        makeCandidate("a5", onStepButRawHigh, 1, "aux"),
        makeCandidate("a6", onStepButRawHigh, 1, "aux"),
        makeCandidate("a7", onStepButRawHigh, 1, "aux"),
        makeCandidate("a8", onStepButRawHigh, 1, "aux"),
        makeCandidate("a_exact", targetStep - 9e-8, 1, "aux")
      ],
      selected: [
        makeCandidate("a1", onStepButRawHigh, 1, "aux"),
        makeCandidate("a2", onStepButRawHigh, 1, "aux"),
        makeCandidate("a3", onStepButRawHigh, 1, "aux"),
        makeCandidate("a4", onStepButRawHigh, 1, "aux"),
        makeCandidate("a5", onStepButRawHigh, 1, "aux"),
        makeCandidate("a6", onStepButRawHigh, 1, "aux"),
        makeCandidate("a7", onStepButRawHigh, 1, "aux"),
        makeCandidate("a8", onStepButRawHigh, 1, "aux")
      ]
    }
  ];

  assert.equal(Math.fround(onStepButRawHigh), targetStep);

  const result = refineRoleAwareMaterialResults({
    materialResults,
    targetValue: targetStep,
    approachMode: "infinite",
    targetStepSpec: resolveCraftAssistTargetStepSpec({
      inputStep: targetStep,
      approachMode: "infinite"
    })
  });

  assert.equal(!!result, true);
  assert.equal(Math.fround(result.overall), targetStep);
  assert.equal(pickedIds(result).includes("a_exact"), false);
  assert.equal(Array.isArray(result.traceSteps) && result.traceSteps.length, 0);
}

function test_refine_role_aware_caches_available_sorts_per_iteration() {
  const materialResults = [
    {
      material: {name: "Main", role: "main", count: 1},
      available: [
        makeCandidate("m1", 0.40, 0, "main"),
        makeCandidate("m2", 0.50, 0, "main"),
        makeCandidate("m3", 0.60, 0, "main")
      ],
      selected: [makeCandidate("m1", 0.40, 0, "main")]
    },
    {
      material: {name: "Aux", role: "aux", count: 1},
      available: [
        makeCandidate("a1", 0.30, 1, "aux"),
        makeCandidate("a2", 0.20, 1, "aux"),
        makeCandidate("a3", 0.10, 1, "aux")
      ],
      selected: [makeCandidate("a1", 0.30, 1, "aux")]
    }
  ];
  const debugStats = {roleAwareAvailableSorts: 0, roleAwareFilteredSorts: 0};

  const result = refineRoleAwareMaterialResults({
    materialResults,
    targetValue: 0.40,
    maxIterations: 1,
    approachMode: "below",
    debugStats
  });

  assert.ok(result);
  assert.equal(debugStats.roleAwareAvailableSorts, 4);
  assert.equal(debugStats.roleAwareFilteredSorts, 0);
}

function test_refine_role_aware_uses_sorted_cached_available_for_lower_bound_probe() {
  const materialResults = [
    {
      material: {name: "Unused", role: "aux", count: 0},
      available: [],
      selected: []
    },
    {
      material: {name: "Aux", role: "aux", count: 1},
      available: [
        makeCandidate("a_high_endpoint", 0.60, 1, "aux"),
        makeCandidate("a_low_endpoint", 0.10, 1, "aux"),
        makeCandidate("a_decoy_low", 0.20, 1, "aux"),
        makeCandidate("a_selected", 0.70, 1, "aux"),
        makeCandidate("a_near_ideal", 0.39, 1, "aux"),
        makeCandidate("a_above_target", 0.41, 1, "aux")
      ],
      selected: [makeCandidate("a_selected", 0.70, 1, "aux")]
    },
    {
      material: {name: "Main", role: "main", count: 1},
      available: [
        makeCandidate("m_old", 0.20, 2, "main"),
        makeCandidate("m_raise", 0.60, 2, "main")
      ],
      selected: [makeCandidate("m_old", 0.20, 2, "main")]
    }
  ];
  const debugStats = {roleAwareAvailableSorts: 0, roleAwareFilteredSorts: 0};

  const result = refineRoleAwareMaterialResults({
    materialResults,
    targetValue: 0.50,
    maxIterations: 1,
    approachMode: "below",
    debugStats
  });

  assert.ok(result);
  assert.equal(result.overall, 0.495);
  assert.deepEqual(pickedIds(result), ["a_near_ideal", "m_raise"]);
  assert.equal(result.traceSteps[0].pattern, "main_up_aux_down");
  assert.deepEqual(result.traceSteps[0].changes.map((change) => change.addedIds), [
    ["m_raise"],
    ["a_near_ideal"]
  ]);
  assert.equal(debugStats.roleAwareFilteredSorts, 0);
}

function test_role_aware_push_trace_uses_shared_material_projection() {
  const groups = [
    {
      index: 0,
      material: {
        role: "main",
        count: 2,
        primary_name: "Main Alpha",
        item_names: ["Main Alpha", "Main Beta"],
        label: "Main Alpha / Main Beta"
      },
      candidates: [
        makeCandidate("m1", 0.24, 0, "main"),
        makeCandidate("m2", 0.245, 0, "main")
      ]
    },
    {
      index: 1,
      material: {
        role: "aux",
        count: 8,
        primary_name: "Aux Alpha",
        item_names: ["Aux Alpha", "Aux Beta"],
        label: "Aux Alpha / Aux Beta"
      },
      candidates: [
        makeCandidate("a1", 0.209, 1, "aux"),
        makeCandidate("a2", 0.208, 1, "aux"),
        makeCandidate("a3", 0.207, 1, "aux"),
        makeCandidate("a4", 0.206, 1, "aux"),
        makeCandidate("a5", 0.205, 1, "aux"),
        makeCandidate("a6", 0.204, 1, "aux"),
        makeCandidate("a7", 0.203, 1, "aux"),
        makeCandidate("a8", 0.202, 1, "aux"),
        makeCandidate("a9", 0.201, 1, "aux"),
        makeCandidate("a10", 0.200, 1, "aux"),
        makeCandidate("a11", 0.199, 1, "aux"),
        makeCandidate("a12", 0.198, 1, "aux")
      ]
    }
  ];

  const result = searchRoleAwarePushSolution({
    groups,
    targetValue: 0.21
  });

  assert.equal(result.trace.steps[0].groups[0].materialName, "Main Alpha");
  assert.deepEqual(result.trace.steps[0].groups[0].item_names, ["Main Alpha", "Main Beta"]);
  assert.equal(result.trace.steps[0].groups[0].label, "Main Alpha / Main Beta");
  assert.equal(result.trace.steps[0].groups[1].materialName, "Aux Alpha");
  assert.deepEqual(result.trace.steps[0].groups[1].item_names, ["Aux Alpha", "Aux Beta"]);
  assert.equal(result.trace.steps[0].groups[1].label, "Aux Alpha / Aux Beta");
}

function test_refine_individual_slots_below_mode_improves_main_up() {
  // aux at index 0, main at index 1 to avoid entryIndex=0 swap bug
  // 1 main at 0.40, 9 aux at 0.48 each → overall = (0.40 + 9*0.48)/10 = 0.472
  // target = 0.50, gap = 0.028. Pair swap won't help (no aux to lower).
  // Individual: idealNewValue for main = 0.40 + 0.028*10 = 0.68 → pick m_high (0.65)
  // new overall = (0.65 + 9*0.48)/10 = 0.497 < 0.50 ✓
  const materialResults = [
    {
      material: {name: "Aux", role: "aux", count: 9},
      available: [
        makeCandidate("a1", 0.48, 0, "aux"),
        makeCandidate("a2", 0.48, 0, "aux"),
        makeCandidate("a3", 0.48, 0, "aux"),
        makeCandidate("a4", 0.48, 0, "aux"),
        makeCandidate("a5", 0.48, 0, "aux"),
        makeCandidate("a6", 0.48, 0, "aux"),
        makeCandidate("a7", 0.48, 0, "aux"),
        makeCandidate("a8", 0.48, 0, "aux"),
        makeCandidate("a9", 0.48, 0, "aux")
      ],
      selected: [
        makeCandidate("a1", 0.48, 0, "aux"),
        makeCandidate("a2", 0.48, 0, "aux"),
        makeCandidate("a3", 0.48, 0, "aux"),
        makeCandidate("a4", 0.48, 0, "aux"),
        makeCandidate("a5", 0.48, 0, "aux"),
        makeCandidate("a6", 0.48, 0, "aux"),
        makeCandidate("a7", 0.48, 0, "aux"),
        makeCandidate("a8", 0.48, 0, "aux"),
        makeCandidate("a9", 0.48, 0, "aux")
      ]
    },
    {
      material: {name: "Main", role: "main", count: 1},
      available: [
        makeCandidate("m1", 0.40, 1, "main"),
        makeCandidate("m_high", 0.65, 1, "main"),
        makeCandidate("m_too_high", 0.90, 1, "main")
      ],
      selected: [makeCandidate("m1", 0.40, 1, "main")]
    }
  ];

  const result = refineRoleAwareMaterialResults({
    materialResults,
    targetValue: 0.50,
    approachMode: "below"
  });

  assert.ok(result);
  assert.equal(result.overall < 0.50, true);
  assert.equal(result.overall > 0.472 + 1e-6, true, "should improve beyond initial 0.472");
  const ids = pickedIds(result);
  assert.equal(ids.includes("m_high"), true, "should swap main to m_high");
  assert.equal(
    result.traceSteps.some((s) => s.pattern === "main_up_individual" || s.pattern === "main_up"),
    true,
    "should have main_up or main_up_individual trace"
  );
}

function test_refine_individual_slots_infinite_mode_approaches_target() {
  // infinite mode: overall can be above or below target, goal is minimize |overall - target|
  // 2 main at 0.60, 8 aux at 0.40 → overall = (2*0.60 + 8*0.40)/10 = 0.44
  // target = 0.50, gap = 0.06
  // Individual should push auxes higher to approach 0.50
  const materialResults = [
    {
      material: {name: "Main", role: "main", count: 2},
      available: [
        makeCandidate("m1", 0.60, 0, "main"),
        makeCandidate("m2", 0.60, 0, "main"),
        makeCandidate("m3", 0.80, 0, "main")
      ],
      selected: [
        makeCandidate("m1", 0.60, 0, "main"),
        makeCandidate("m2", 0.60, 0, "main")
      ]
    },
    {
      material: {name: "Aux", role: "aux", count: 8},
      available: [
        makeCandidate("a1", 0.40, 1, "aux"),
        makeCandidate("a2", 0.40, 1, "aux"),
        makeCandidate("a3", 0.40, 1, "aux"),
        makeCandidate("a4", 0.40, 1, "aux"),
        makeCandidate("a5", 0.40, 1, "aux"),
        makeCandidate("a6", 0.40, 1, "aux"),
        makeCandidate("a7", 0.40, 1, "aux"),
        makeCandidate("a8", 0.40, 1, "aux"),
        makeCandidate("a_high", 0.49, 1, "aux"),
        makeCandidate("a_high2", 0.48, 1, "aux"),
        makeCandidate("a_high3", 0.47, 1, "aux")
      ],
      selected: [
        makeCandidate("a1", 0.40, 1, "aux"),
        makeCandidate("a2", 0.40, 1, "aux"),
        makeCandidate("a3", 0.40, 1, "aux"),
        makeCandidate("a4", 0.40, 1, "aux"),
        makeCandidate("a5", 0.40, 1, "aux"),
        makeCandidate("a6", 0.40, 1, "aux"),
        makeCandidate("a7", 0.40, 1, "aux"),
        makeCandidate("a8", 0.40, 1, "aux")
      ]
    }
  ];

  const result = refineRoleAwareMaterialResults({
    materialResults,
    targetValue: 0.50,
    approachMode: "infinite"
  });

  assert.ok(result);
  // Should be closer to 0.50 than initial 0.44
  assert.equal(Math.abs(result.overall - 0.50) < Math.abs(0.44 - 0.50) - 1e-6, true,
    `should approach target: got ${result.overall}`);
  assert.equal(
    result.traceSteps.some((s) => s.pattern === "approach_individual"),
    true,
    "should have approach_individual trace"
  );
}

test_role_aware_push_slides_aux_window_down_when_over_target();
test_role_aware_push_slides_main_window_up_when_under_target();
test_role_aware_push_prefers_closer_aux_raise_when_main_raise_would_block_it();
test_role_aware_push_returns_selection_trace();
test_role_aware_push_applies_aux_compensation_refinement();
test_entry_window_helper_classifies_closed_boundaries();
test_entry_window_gates_single_material_search_scoring();
test_entry_window_gates_single_material_balanced_push_search();
test_entry_window_gates_generic_infinite_search_scoring();
test_entry_window_zero_offset_preserves_direct_search_legacy_behavior();
test_seed_single_material_returns_no_material_when_candidates_are_less_than_ten();
test_seed_single_material_returns_proved_no_raw_solution_when_lowest_window_is_still_not_below_raw();
test_seed_single_material_returns_hit_with_raw_below_window();
test_seed_dual_material_returns_proved_no_raw_solution_when_downward_space_is_exhausted();
test_seed_dual_material_alternates_upward_probes_until_both_sides_are_stuck();
test_single_material_compensation_chooses_closest_global_second_swap();
test_single_material_compensation_exposes_second_swap_pruning_trace();
test_search_best_solution_infinite_mode_can_cross_target_for_closer_single_material_match();
test_search_beam_profile_is_optional_and_preserves_result();
test_search_beam_profile_collapses_canonical_duplicates_before_partial_scoring();
test_search_beam_collapses_single_group_repeated_slot_permutations_during_generation();
test_search_beam_collapses_multi_group_repeated_slot_permutations_during_generation();
test_search_beam_profile_target_step_stop_reason_preserves_result();
test_search_beam_reuses_inner_extra_across_cap_expansion_without_result_change();
test_search_step_target_below_uses_previous_float32_step();
test_search_offset_window_prefers_primary_below_step_over_lower_allowed_step();
test_search_offset_window_returns_lower_allowed_step_when_primary_unavailable();
test_search_target_step_prepares_candidates_once_per_group();
test_score_partial_state_prefers_incremental_stats_without_rescanning_selected_values();
test_score_partial_state_incremental_stats_matches_slow_path_for_single_material_infinite();
test_score_partial_state_incremental_stats_matches_slow_path_for_multi_material_role_infinite();
test_score_partial_state_incremental_stats_matches_slow_path_for_single_material_target_step();
test_score_partial_state_incremental_stats_matches_slow_path_for_multi_material_role_target_step();
test_partial_stats_variance_matches_scan_with_tolerance();
test_search_raw_aware_below_prefers_primary_target_step_from_target_step_spec();
test_search_below_raw_allows_normalized_overall_between_conservative_and_original_target();
test_search_raw_aware_offset_window_uses_target_step_spec_without_raw_parsing();
test_search_raw_aware_below_offset_expands_past_lower_window_hit_for_primary_step();
test_search_raw_aware_below_offset_stops_after_stable_fallback_without_primary();
test_search_raw_aware_below_offset_single_material_keeps_searching_for_closer_fallback_after_initial_cap();
test_search_raw_aware_below_single_material_fallback_refinement_stays_within_budget();
test_search_raw_aware_below_single_material_no_offset_fast_path_returns_top_k_when_all_candidates_are_below_raw();
test_search_raw_aware_below_single_material_no_offset_fast_path_is_opt_in();
test_search_raw_aware_below_single_material_offset_window_skips_no_offset_fast_path();
test_search_sliding_anchor_diagnostic_does_not_change_prefix_baseline();
test_search_sliding_anchor_diagnostic_rolls_back_to_boundary_after_dynamic_overshoot();
test_search_sliding_anchor_diagnostic_keeps_descending_after_raw_ceiling_probe();
test_search_sliding_anchor_rejects_duplicate_ids_and_falls_back_to_prefix_expansion();
test_search_sliding_anchor_rejects_raw_ceiling_and_falls_back();
test_search_sliding_anchor_rejects_offset_window_and_falls_back();
test_search_raw_aware_below_rejects_closer_above_raw_outside_window();
test_search_raw_aware_below_multi_group_does_not_stop_on_window_fallback();
test_search_role_aware_below_offset_refines_lower_window_hit_to_primary_step();
test_search_role_aware_step_spec_orders_outside_window_by_target_priority_before_side_bias();
test_refine_role_aware_stops_when_current_mean_is_on_target_step();
test_refine_role_aware_caches_available_sorts_per_iteration();
test_refine_role_aware_uses_sorted_cached_available_for_lower_bound_probe();
test_role_aware_push_trace_uses_shared_material_projection();
test_refine_individual_slots_below_mode_improves_main_up();
test_refine_individual_slots_infinite_mode_approaches_target();
console.log("craftAssistSearch tests passed");
