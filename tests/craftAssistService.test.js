const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

const {
  createCraftAssistService,
  selectCraftAssistForRecipe,
  buildCraftAssistSelectionContext,
  buildCraftAssistSelectionContextFromCandidateRows,
  __test
} = require("../node_sidecar/src/services/craftAssistService");
const {
  prevFloat32,
  nextFloat32,
  resolveCraftAssistTargetStepSpec
} = require("../node_sidecar/src/services/craftAssistFloat32Step");

const RUNTIME_DEFAULT_CRAFT_ASSIST_WEAR_OFFSET = 0.00001;

function defaultWearOffsetArgs(extraArgs = {}) {
  if (
    Object.prototype.hasOwnProperty.call(extraArgs, "wearOffset")
    || Object.prototype.hasOwnProperty.call(extraArgs, "wearOffsetPct")
  ) {
    return {};
  }
  return {wearOffset: RUNTIME_DEFAULT_CRAFT_ASSIST_WEAR_OFFSET};
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

function makeCandidate(id, value, groupIndex, role) {
  return {
    id: String(id),
    value: Number(value),
    relative_value: Number(value),
    groupIndex: Number(groupIndex),
    role: String(role || ""),
    row: {
      asset_id: String(id),
      rarity: 4
    }
  };
}

function inputStepForBelowTargetStep(targetStep) {
  return nextFloat32(Math.fround(targetStep));
}

function runSelect({rows, targetWear, materials, ...extraArgs}) {
  return selectCraftAssistForRecipe({
    rows,
    targetWear,
    wearFilterMode: "relative",
    materials,
    blockedIds: [],
    includeCooling: false,
    ...defaultWearOffsetArgs(extraArgs),
    ...extraArgs
  });
}

function runSelectWithContext({selectionContext, targetWear, materials, blockedIds = [], ...extraArgs}) {
  return selectCraftAssistForRecipe({
    selectionContext,
    targetWear,
    wearFilterMode: "relative",
    materials,
    blockedIds,
    includeCooling: false,
    ...defaultWearOffsetArgs(extraArgs),
    ...extraArgs
  });
}

async function inspectMatchedContextRefine({fastResult, targetWear, rows, materials, ...extraArgs}) {
  const inspection = await __test.inspectCraftAssistContextRefineMatchForSelection({
    rows,
    targetWear,
    wearFilterMode: "relative",
    materials,
    blockedIds: [],
    includeCooling: false,
    ...defaultWearOffsetArgs(extraArgs),
    matchedRarity: fastResult && fastResult.rarity,
    matchedOverall: fastResult && fastResult.overall,
    ...extraArgs
  });
  assert.equal(inspection.ok, true);
  return inspection;
}

function makeSeedRelaySingleGroup(values, count = 10) {
  return [{
    index: 0,
    material: {name: "Solo", role: "main", count},
    candidates: values.map((value, index) => makeCandidate(`seed-solo-${index + 1}`, value, 0, "main"))
  }];
}

function makeSeedRelayDualGroups(mainValues, auxValues, mainCount = 8, auxCount = 2) {
  return [
    {
      index: 0,
      material: {name: "Main", role: "main", count: mainCount},
      candidates: mainValues.map((value, index) => makeCandidate(`seed-main-${index + 1}`, value, 0, "main"))
    },
    {
      index: 1,
      material: {name: "Aux", role: "aux", count: auxCount},
      candidates: auxValues.map((value, index) => makeCandidate(`seed-aux-${index + 1}`, value, 1, "aux"))
    }
  ];
}

function pickedIds(result) {
  return Array.isArray(result && result.item_ids) ? [...result.item_ids].sort() : [];
}

function rawPickedIds(result) {
  return Array.isArray(result && result.item_ids) ? [...result.item_ids] : [];
}

function pickedAssetIds(result) {
  return Array.isArray(result && result.picks)
    ? result.picks.map((entry) => String(entry && entry.asset_id || "")).filter(Boolean)
    : [];
}

function traceEntrySummary(entry) {
  return {
    index: Number(entry && entry.index || 0),
    materialName: String(entry && entry.materialName || ""),
    primary_name: String(entry && entry.primary_name || ""),
    item_names: Array.isArray(entry && entry.item_names) ? [...entry.item_names] : [],
    label: String(entry && entry.label || ""),
    role: String(entry && entry.role || ""),
    selectedIds: Array.isArray(entry && entry.selectedIds) ? [...entry.selectedIds] : [],
    removedIds: Array.isArray(entry && entry.removedIds) ? [...entry.removedIds] : [],
    addedIds: Array.isArray(entry && entry.addedIds) ? [...entry.addedIds] : []
  };
}

function traceParitySummary(result) {
  const trace = result && result.selection_trace;
  return {
    steps: Array.isArray(trace && trace.steps)
      ? trace.steps.map((step) => ({
          stage: String(step && step.stage || ""),
          overall: Number.isFinite(Number(step && step.overall)) ? Number(step.overall) : null,
          selectedIds: Array.isArray(step && step.selectedIds) ? [...step.selectedIds] : [],
          groups: Array.isArray(step && step.groups) ? step.groups.map(traceEntrySummary) : [],
          changes: Array.isArray(step && step.changes) ? step.changes.map(traceEntrySummary) : []
        }))
      : []
  };
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

function loadCraftAssistServiceWithOverrides({searchOverrides = null, shardOverrides = null} = {}) {
  const servicePath = require.resolve("../node_sidecar/src/services/craftAssistService");
  const serviceSourcePath = path.join(__dirname, "..", "node_sidecar", "src", "services", "craftAssistService.js");
  const actualSearch = require("../node_sidecar/src/services/craftAssistSearch");
  const actualShardPrefilter = require("../node_sidecar/src/services/craftAssistShardPrefilter");
  const originalLoad = Module._load;
  delete require.cache[servicePath];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (parent && parent.filename === serviceSourcePath && request === "./craftAssistSearch") {
      return {
        ...actualSearch,
        ...(searchOverrides && typeof searchOverrides === "object" ? searchOverrides : {})
      };
    }
    if (parent && parent.filename === serviceSourcePath && request === "./craftAssistShardPrefilter") {
      return {
        ...actualShardPrefilter,
        ...(shardOverrides && typeof shardOverrides === "object" ? shardOverrides : {})
      };
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    return require(servicePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[servicePath];
  }
}

async function runSelectWithCapturedSearchCalls({
  selectArgs = {},
  searchOverrides = null,
  shardOverrides = null
} = {}) {
  const actualSearch = require("../node_sidecar/src/services/craftAssistSearch");
  const searchOverrideMap = searchOverrides && typeof searchOverrides === "object"
    ? searchOverrides
    : {};
  const delegatedSearch = typeof searchOverrideMap.searchCraftAssistBestSolution === "function"
    ? searchOverrideMap.searchCraftAssistBestSolution
    : actualSearch.searchCraftAssistBestSolution;
  const searchCalls = [];
  const service = loadCraftAssistServiceWithOverrides({
    searchOverrides: {
      ...searchOverrideMap,
      searchCraftAssistBestSolution(args = {}) {
        searchCalls.push({
          kind: classifyCraftAssistSearchGroups(args.groups),
          enableRawBelowTopKFastPath: args.enableRawBelowTopKFastPath === true,
          hasTargetStepSpec: !!args.targetStepSpec,
          approachMode: String(args.approachMode || "")
        });
        return delegatedSearch(args);
      }
    },
    shardOverrides
  });
  const result = await service.selectCraftAssistForRecipe(selectArgs);
  return {
    result,
    searchCalls
  };
}

function classifyCraftAssistSearchGroups(groups) {
  const candidateIds = (Array.isArray(groups) ? groups : [])
    .flatMap((group) => Array.isArray(group && group.candidates) ? group.candidates : [])
    .map((candidate) => String(candidate && candidate.id || ""))
    .filter(Boolean);
  if (!candidateIds.length) return "unknown";
  if (candidateIds.every((id) => id.startsWith("base-"))) return "base";
  if (candidateIds.every((id) => id.startsWith("expand-"))) return "expand";
  if (candidateIds.every((id) => id.startsWith("full-"))) return "full";
  return "unknown";
}

function makeSolvedFromGroups(groups, overall) {
  return {
    overall: Number(overall),
    scoreTuple: [0, 0, Number(overall)],
    materialResults: (Array.isArray(groups) ? groups : []).map((group) => ({
      material: group && group.material ? {...group.material} : {},
      selected: Array.isArray(group && group.candidates)
        ? group.candidates
          .slice(0, Number(group && group.material && group.material.count || 0))
          .map((candidate) => ({
            ...candidate,
            row: candidate && candidate.row ? {...candidate.row} : {asset_id: String(candidate && candidate.id || ""), rarity: 4}
          }))
        : []
    }))
  };
}

async function captureConsoleLogs(run) {
  const originalLog = console.log;
  const originalError = console.error;
  const logs = [];
  console.log = (...args) => {
    logs.push(args.map((part) => String(part)).join(" "));
  };
  console.error = (...args) => {
    logs.push(args.map((part) => String(part)).join(" "));
  };
  try {
    const result = await run();
    return {result, logs};
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function makeOversizedPrefilterRows() {
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

function makeContextRefineRows() {
  const rows = [];
  const main = [
    0.223665, 0.255113, 0.22595, 0.254604, 0.254294, 0.228814,
    0.227922, 0.21527, 0.217003, 0.240858, 0.223913, 0.240308
  ];
  const auxA = [
    0.189141, 0.181506, 0.190596, 0.193409, 0.212041, 0.226366,
    0.177782, 0.210399, 0.177017, 0.189009, 0.193335, 0.198675,
    0.191073, 0.18157, 0.195927, 0.178727, 0.170813, 0.21663,
    0.211009, 0.185929, 0.210246, 0.216364, 0.171529, 0.181645,
    0.178797, 0.181253, 0.182063, 0.176562, 0.174258, 0.208559,
    0.220978, 0.204282, 0.179617, 0.177588, 0.177791, 0.186291,
    0.2074, 0.176138, 0.22877, 0.218079, 0.225689, 0.19386,
    0.218424, 0.172643, 0.224274, 0.215841, 0.195974, 0.199726,
    0.197247, 0.212934, 0.196952, 0.216197, 0.183963, 0.197855,
    0.192333, 0.210281, 0.203657, 0.173117, 0.218882, 0.174867
  ];
  const auxB = [
    0.223163, 0.172805, 0.228611, 0.223355, 0.189331, 0.207907,
    0.209509, 0.173308, 0.179485, 0.22744, 0.225744, 0.212715,
    0.179428, 0.17413, 0.198213, 0.201144, 0.224822, 0.174647,
    0.195061, 0.192168, 0.192561, 0.190311, 0.173833, 0.22092,
    0.204177, 0.174603, 0.223953, 0.194436, 0.192865, 0.201617,
    0.194507, 0.209525, 0.210154, 0.200687, 0.209083, 0.18088,
    0.196817, 0.224977, 0.181623, 0.202709, 0.200641, 0.202861,
    0.202848, 0.206837, 0.206288, 0.196076, 0.183793, 0.202936,
    0.226162, 0.220426, 0.200992, 0.195037, 0.21161, 0.214895,
    0.198857, 0.208593, 0.219399, 0.172193, 0.19523, 0.207934
  ];
  for (let index = 0; index < main.length; index += 1) {
    rows.push(makeRow({id: `m${index + 1}`, name: "Main", relative: main[index]}));
  }
  for (let index = 0; index < auxA.length; index += 1) {
    rows.push(makeRow({id: `a${index + 1}`, name: "AuxA", relative: auxA[index]}));
  }
  for (let index = 0; index < auxB.length; index += 1) {
    rows.push(makeRow({id: `b${index + 1}`, name: "AuxB", relative: auxB[index]}));
  }
  return rows;
}

async function test_over_target_prefers_squeezing_aux_before_main() {
  const rows = [
    makeRow({id: "m1", name: "Main", relative: 0.62}),
    makeRow({id: "m2", name: "Main", relative: 0.61}),
    makeRow({id: "m3", name: "Main", relative: 0.60}),
    makeRow({id: "m4", name: "Main", relative: 0.59}),
    makeRow({id: "m5", name: "Main", relative: 0.58}),
    makeRow({id: "m6", name: "Main", relative: 0.40}),
    makeRow({id: "a1", name: "Aux", relative: 0.49}),
    makeRow({id: "a2", name: "Aux", relative: 0.48}),
    makeRow({id: "a3", name: "Aux", relative: 0.47}),
    makeRow({id: "a4", name: "Aux", relative: 0.46}),
    makeRow({id: "a5", name: "Aux", relative: 0.45}),
    makeRow({id: "a6", name: "Aux", relative: 0.30}),
    makeRow({id: "a7", name: "Aux", relative: 0.28})
  ];
  const result = await runSelect({
    rows,
    targetWear: inputStepForBelowTargetStep(0.52),
    wearOffsetPct: 0,
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 5, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 5, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), Math.fround(0.52));
  assert.equal(result.item_ids.includes("m6"), false);
  assert.equal(result.item_ids.includes("a6") || result.item_ids.includes("a7"), true);
}

async function test_under_target_prioritizes_closer_overall_before_aux_low_bias() {
  const rows = [];
  for (let i = 1; i <= 9; i += 1) {
    rows.push(makeRow({id: `m${i}`, name: "Main", relative: 0.13}));
  }
  rows.push(makeRow({id: "a1", name: "Aux", relative: 0.02}));
  rows.push(makeRow({id: "a2", name: "Aux", relative: 0.06}));
  rows.push(makeRow({id: "a3", name: "Aux", relative: 0.09}));

  const result = await runSelect({
    rows,
    targetWear: inputStepForBelowTargetStep(0.126),
    wearOffsetPct: 0,
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 9, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 1, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), Math.fround(0.126));
  assert.equal(result.item_ids.includes("a3"), true);
  assert.equal(result.item_ids.includes("a2"), false);
}

async function test_under_target_allows_above_slot_target_when_it_is_the_only_legal_raise() {
  const rows = [];
  for (let i = 1; i <= 9; i += 1) {
    rows.push(makeRow({id: `m${i}`, name: "Main", relative: 0.13}));
  }
  rows.push(makeRow({id: "a1", name: "Aux", relative: 0.02}));
  rows.push(makeRow({id: "a3", name: "Aux", relative: 0.09}));

  const result = await runSelect({
    rows,
    targetWear: inputStepForBelowTargetStep(0.126),
    wearOffsetPct: 0,
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 9, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 1, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), Math.fround(0.126));
  assert.equal(result.item_ids.includes("a3"), true);
}

async function test_all_main_items_use_single_side_branch() {
  const rows = [];
  for (let i = 1; i <= 10; i += 1) {
    rows.push(makeRow({id: `s${i}`, name: "Solo", relative: 0.01}));
  }
  rows.push(makeRow({id: "s11", name: "Solo", relative: 0.09}));

  const result = await runSelect({
    rows,
    targetWear: inputStepForBelowTargetStep(0.018),
    wearOffsetPct: 0,
    materials: [
      {name: "Solo", names: ["Solo"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), Math.fround(0.018));
  assert.equal(result.item_ids.includes("s11"), true);
}

async function test_under_target_never_uses_candidate_that_pushes_overall_across_target() {
  const rows = [];
  for (let i = 1; i <= 9; i += 1) {
    rows.push(makeRow({id: `m${i}`, name: "Main", relative: 0.16}));
  }
  rows.push(makeRow({id: "a1", name: "Aux", relative: 0.02}));
  rows.push(makeRow({id: "a2", name: "Aux", relative: 0.90}));

  const result = await runSelect({
    rows,
    targetWear: inputStepForBelowTargetStep(0.146),
    wearOffsetPct: 0,
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 9, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 1, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), Math.fround(0.146));
  assert.equal(result.item_ids.includes("a1"), true);
  assert.equal(result.item_ids.includes("a2"), false);
}

async function test_single_material_falls_back_when_balanced_split_side_is_short() {
  const rows = [
    makeRow({id: "x0", name: "Solo", relative: 0.160173}),
    makeRow({id: "x1", name: "Solo", relative: 0.184536}),
    makeRow({id: "x2", name: "Solo", relative: 0.207035}),
    makeRow({id: "x3", name: "Solo", relative: 0.161542}),
    makeRow({id: "x4", name: "Solo", relative: 0.190318}),
    makeRow({id: "x5", name: "Solo", relative: 0.160919}),
    makeRow({id: "x6", name: "Solo", relative: 0.204406}),
    makeRow({id: "x7", name: "Solo", relative: 0.242605}),
    makeRow({id: "x8", name: "Solo", relative: 0.228639}),
    makeRow({id: "x9", name: "Solo", relative: 0.275832}),
    makeRow({id: "x10", name: "Solo", relative: 0.174511}),
    makeRow({id: "x11", name: "Solo", relative: 0.166667})
  ];

  const result = await runSelect({
    rows,
    targetWear: inputStepForBelowTargetStep(0.2036091),
    wearOffsetPct: 0,
    materials: [
      {name: "Solo", names: ["Solo"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), Math.fround(0.2036091));
  assert.equal(pickedIds(result).includes("x9"), true);
  assert.equal(pickedIds(result).includes("x0"), false);
}

async function test_single_material_non_unit_interval_still_uses_relative_centering() {
  const rows = [
    makeRow({id: "r1", name: "Shifted", relative: 0.19, min: 0.06, max: 0.80}),
    makeRow({id: "r2", name: "Shifted", relative: 0.20, min: 0.06, max: 0.80}),
    makeRow({id: "r3", name: "Shifted", relative: 0.21, min: 0.06, max: 0.80}),
    makeRow({id: "r4", name: "Shifted", relative: 0.22, min: 0.06, max: 0.80}),
    makeRow({id: "r5", name: "Shifted", relative: 0.23, min: 0.06, max: 0.80}),
    makeRow({id: "r6", name: "Shifted", relative: 0.24, min: 0.06, max: 0.80}),
    makeRow({id: "r7", name: "Shifted", relative: 0.25, min: 0.06, max: 0.80}),
    makeRow({id: "r8", name: "Shifted", relative: 0.26, min: 0.06, max: 0.80}),
    makeRow({id: "r9", name: "Shifted", relative: 0.27, min: 0.06, max: 0.80}),
    makeRow({id: "r10", name: "Shifted", relative: 0.28, min: 0.06, max: 0.80}),
    makeRow({id: "r11", name: "Shifted", relative: 0.33, min: 0.06, max: 0.80})
  ];

  const result = await runSelect({
    rows,
    targetWear: inputStepForBelowTargetStep(0.249),
    wearOffsetPct: 0,
    materials: [
      {name: "Shifted", names: ["Shifted"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), Math.fround(0.249));
  assert.equal(pickedIds(result).includes("r11"), true);
  assert.equal(pickedIds(result).includes("r1"), false);
}

async function test_single_material_returns_step_target_selection() {
  const rows = [
    makeRow({id: "x0", name: "Solo", relative: 0.160173}),
    makeRow({id: "x1", name: "Solo", relative: 0.184536}),
    makeRow({id: "x2", name: "Solo", relative: 0.207035}),
    makeRow({id: "x3", name: "Solo", relative: 0.161542}),
    makeRow({id: "x4", name: "Solo", relative: 0.190318}),
    makeRow({id: "x5", name: "Solo", relative: 0.160919}),
    makeRow({id: "x6", name: "Solo", relative: 0.204406}),
    makeRow({id: "x7", name: "Solo", relative: 0.242605}),
    makeRow({id: "x8", name: "Solo", relative: 0.228639}),
    makeRow({id: "x9", name: "Solo", relative: 0.275832}),
    makeRow({id: "x10", name: "Solo", relative: 0.174511}),
    makeRow({id: "x11", name: "Solo", relative: 0.166667})
  ];

  const result = await runSelect({
    rows,
    targetWear: inputStepForBelowTargetStep(0.2036091),
    wearOffsetPct: 0,
    materials: [
      {name: "Solo", names: ["Solo"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), Math.fround(0.2036091));
  assert.equal(pickedIds(result).length, 10);
}

async function test_infinite_mode_allows_cross_target_when_it_is_closer() {
  const rows = [
    makeRow({id: "b1", name: "Solo", relative: 0.47}),
    makeRow({id: "b2", name: "Solo", relative: 0.47}),
    makeRow({id: "b3", name: "Solo", relative: 0.47}),
    makeRow({id: "b4", name: "Solo", relative: 0.47}),
    makeRow({id: "b5", name: "Solo", relative: 0.47}),
    makeRow({id: "u1", name: "Solo", relative: 0.53}),
    makeRow({id: "u2", name: "Solo", relative: 0.53}),
    makeRow({id: "u3", name: "Solo", relative: 0.53}),
    makeRow({id: "u4", name: "Solo", relative: 0.53}),
    makeRow({id: "u5", name: "Solo", relative: 0.51}),
    makeRow({id: "u6", name: "Solo", relative: 0.531})
  ];
  const materials = [
    {name: "Solo", names: ["Solo"], role: "main", count: 10, wear_min: 0, wear_max: 1}
  ];

  const belowOnly = await runSelect({
    rows,
    targetWear: inputStepForBelowTargetStep(0.498),
    wearOffsetPct: 0,
    materials
  });
  const infinite = await runSelect({
    rows,
    targetWear: Math.fround(0.5041),
    wearOffsetPct: 0,
    materials,
    wearApproachMode: "infinite"
  });

  assert.equal(belowOnly.ok, true);
  assert.equal(infinite.ok, true);
  assert.equal(Math.fround(belowOnly.overall), Math.fround(0.498));
  assert.equal(Math.fround(infinite.overall), Math.fround(0.5041));
  assert.equal(belowOnly.item_ids.includes("b5"), true);
  assert.equal(belowOnly.item_ids.includes("u6"), false);
  assert.equal(infinite.item_ids.includes("u6"), true);
  assert.equal(infinite.item_ids.includes("u1"), true);
}

async function test_single_material_starts_with_balanced_split_then_pushes_upward() {
  const rows = [
    makeRow({id: "b1", name: "Solo", relative: 0.193232}),
    makeRow({id: "b2", name: "Solo", relative: 0.192819}),
    makeRow({id: "b3", name: "Solo", relative: 0.192762}),
    makeRow({id: "b4", name: "Solo", relative: 0.192562}),
    makeRow({id: "b5", name: "Solo", relative: 0.192551}),
    makeRow({id: "b6", name: "Solo", relative: 0.192545}),
    makeRow({id: "a1", name: "Solo", relative: 0.223043}),
    makeRow({id: "a2", name: "Solo", relative: 0.223948}),
    makeRow({id: "a3", name: "Solo", relative: 0.224158}),
    makeRow({id: "a4", name: "Solo", relative: 0.224728}),
    makeRow({id: "a5", name: "Solo", relative: 0.224758}),
    makeRow({id: "a6", name: "Solo", relative: 0.224877}),
    makeRow({id: "a7", name: "Solo", relative: 0.224927})
  ];

  const result = await runSelect({
    rows,
    targetWear: inputStepForBelowTargetStep(0.2148097),
    wearOffsetPct: 0,
    materials: [
      {name: "Solo", names: ["Solo"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), Math.fround(0.2148097));
  assert.equal(result.item_ids.includes("a7"), true);
  assert.equal(result.item_ids.includes("b6"), true);
}

async function test_single_material_applies_compensation_refinement_after_push_limit() {
  const rows = [
    makeRow({id: "b1", name: "Solo", relative: 0.193232}),
    makeRow({id: "b2", name: "Solo", relative: 0.192819}),
    makeRow({id: "b3", name: "Solo", relative: 0.192762}),
    makeRow({id: "b4", name: "Solo", relative: 0.192562}),
    makeRow({id: "b5", name: "Solo", relative: 0.192551}),
    makeRow({id: "b6", name: "Solo", relative: 0.168917}),
    makeRow({id: "a1", name: "Solo", relative: 0.223043}),
    makeRow({id: "a2", name: "Solo", relative: 0.227207}),
    makeRow({id: "a3", name: "Solo", relative: 0.227340}),
    makeRow({id: "a4", name: "Solo", relative: 0.227395}),
    makeRow({id: "a5", name: "Solo", relative: 0.227439}),
    makeRow({id: "a6", name: "Solo", relative: 0.227508}),
    makeRow({id: "a7", name: "Solo", relative: 0.227533})
  ];

  const result = await runSelect({
    rows,
    targetWear: inputStepForBelowTargetStep(0.2135797),
    wearOffsetPct: 0,
    materials: [
      {name: "Solo", names: ["Solo"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), Math.fround(0.2135797));
  assert.equal(result.item_ids.includes("a7"), true);
  assert.equal(result.item_ids.includes("b1"), true);
}

async function test_single_material_accepts_step_target_near_target_edge_without_margin() {
  const rows = [];
  for (let i = 1; i <= 9; i += 1) {
    rows.push(makeRow({id: `e${i}`, name: "Solo", relative: 0.27}));
  }
  rows.push(makeRow({id: "tight", name: "Solo", relative: 0.2699999}));
  rows.push(makeRow({id: "safe", name: "Solo", relative: 0.2699997}));

  const result = await runSelect({
    rows,
    targetWear: inputStepForBelowTargetStep(0.26999996),
    wearOffsetPct: 0,
    materials: [
      {name: "Solo", names: ["Solo"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), Math.fround(0.26999996));
  assert.equal(result.item_ids.includes("safe"), true);
  assert.equal(result.item_ids.includes("tight"), true);
}

async function test_multi_material_allows_cross_side_compensation_for_closer_overall() {
  const rows = [
    makeRow({id: "m0", name: "Main", relative: 0.201757}),
    makeRow({id: "m1", name: "Main", relative: 0.257854}),
    makeRow({id: "m2", name: "Main", relative: 0.207325}),
    makeRow({id: "m3", name: "Main", relative: 0.237616}),
    makeRow({id: "m4", name: "Main", relative: 0.23802}),
    makeRow({id: "m5", name: "Main", relative: 0.238558}),
    makeRow({id: "a0", name: "Aux", relative: 0.160775}),
    makeRow({id: "a1", name: "Aux", relative: 0.192693}),
    makeRow({id: "a2", name: "Aux", relative: 0.192811}),
    makeRow({id: "a3", name: "Aux", relative: 0.228513}),
    makeRow({id: "a4", name: "Aux", relative: 0.168621}),
    makeRow({id: "a5", name: "Aux", relative: 0.191669})
  ];

  const result = await runSelect({
    rows,
    targetWear: inputStepForBelowTargetStep(0.2140266),
    wearOffsetPct: 0,
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 5, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 5, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), Math.fround(0.2140266));
  assert.equal(pickedIds(result).includes("m1"), true);
  assert.equal(pickedIds(result).includes("a3"), true);
}

async function test_multi_material_allows_cross_side_fill_when_preferred_side_is_short() {
  const rows = [
    makeRow({id: "m1", name: "Main", relative: 0.22}),
    makeRow({id: "m2", name: "Main", relative: 0.221}),
    makeRow({id: "m3", name: "Main", relative: 0.222}),
    makeRow({id: "a1", name: "Aux", relative: 0.18}),
    makeRow({id: "a2", name: "Aux", relative: 0.181}),
    makeRow({id: "a3", name: "Aux", relative: 0.182}),
    makeRow({id: "a4", name: "Aux", relative: 0.183}),
    makeRow({id: "a5", name: "Aux", relative: 0.184}),
    makeRow({id: "a6", name: "Aux", relative: 0.216}),
    makeRow({id: "a7", name: "Aux", relative: 0.217})
  ];

  const result = await runSelect({
    rows,
    targetWear: inputStepForBelowTargetStep(0.2006),
    wearOffsetPct: 0,
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 3, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 7, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), Math.fround(0.2006));
  assert.equal(pickedIds(result).includes("a6"), true);
  assert.equal(pickedIds(result).includes("a7"), true);
}

async function test_multi_material_returns_step_target_selection_without_legacy_trace() {
  const rows = [
    makeRow({id: "m1", name: "Main", relative: 0.24}),
    makeRow({id: "m2", name: "Main", relative: 0.245}),
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

  const result = await runSelect({
    rows,
    targetWear: inputStepForBelowTargetStep(0.21),
    wearOffsetPct: 0,
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 2, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 8, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    pickedIds(result),
    ["a10", "a11", "a12", "a2", "a6", "a7", "a8", "a9", "m1", "m2"]
  );
  assert.equal(Math.fround(result.overall), Math.fround(0.21));
  assert.equal(!!(result.selection_trace && result.selection_trace.seed), true);
  assert.equal(result.selection_trace.seed.kind, "seed_hit");
  assert.equal(result.selection_trace.seed.mode, "multi_material_role");
}

async function test_prebuilt_selection_context_matches_direct_selection_even_with_blocked_ids() {
  const rows = [
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
  const materials = [
    {name: "Main", names: ["Main"], role: "main", count: 2, wear_min: 0, wear_max: 1},
    {name: "Aux", names: ["Aux"], role: "aux", count: 8, wear_min: 0, wear_max: 1}
  ];
  const blockedIds = ["m3"];
  const direct = await selectCraftAssistForRecipe({
    rows,
    targetWear: inputStepForBelowTargetStep(0.21),
    wearFilterMode: "relative",
    materials,
    blockedIds,
    includeCooling: false,
    wearOffsetPct: 100
  });
  const selectionContext = buildCraftAssistSelectionContext({rows, includeCooling: false});
  const cached = await runSelectWithContext({
    selectionContext,
    targetWear: inputStepForBelowTargetStep(0.21),
    wearOffsetPct: 0,
    materials,
    blockedIds
  });

  assert.equal(direct.ok, true);
  assert.equal(cached.ok, true);
  assert.deepEqual(rawPickedIds(cached), rawPickedIds(direct));
  assert.deepEqual(pickedAssetIds(cached), pickedAssetIds(direct));
  assert.deepEqual(cached.picks, direct.picks);
  assert.deepEqual(pickedIds(cached), pickedIds(direct));
  assert.equal(cached.overall, direct.overall);
  assert.equal(cached.rarity, direct.rarity);
  assert.equal(cached.approach_mode, direct.approach_mode);
  assert.equal(cached.recipe_ok, direct.recipe_ok);
  assert.equal(cached.recipe_reason, direct.recipe_reason);
  assert.equal(cached.recipe_text, direct.recipe_text);
  assert.deepEqual(traceParitySummary(cached), traceParitySummary(direct));
}

async function test_candidate_rows_sibling_rebuilds_stale_selection_context_even_when_asset_ids_match() {
  const staleCandidateRows = [
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
    makeRow({id: "a10", name: "Aux", relative: 0.200})
  ];
  const freshCandidateRows = staleCandidateRows.map((row) => {
    if (String(row && row.alchemy_name || "") !== "Aux") return {...row};
    return {
      ...row,
      name: "Aux Fresh",
      alchemy_name: "Aux Fresh"
    };
  });
  const selectionContext = buildCraftAssistSelectionContextFromCandidateRows(staleCandidateRows, {
    includeCooling: false
  });
  const request = {
    targetWear: inputStepForBelowTargetStep(0.2135),
    wearFilterMode: "relative",
    materials: [
      {role: "main", count: 2, items: [{name: "Main", wear_filter_mode: "relative", wear_min: 0, wear_max: 1}]},
      {role: "aux", count: 8, items: [{name: "Aux Fresh", wear_filter_mode: "relative", wear_min: 0, wear_max: 1}]}
    ],
    blockedIds: [],
    includeCooling: false,
    wearOffsetPct: 100
  };
  const expected = await selectCraftAssistForRecipe({
    candidateRows: freshCandidateRows,
    ...request
  });

  const result = await selectCraftAssistForRecipe({
    selectionContext,
    candidateRows: freshCandidateRows,
    ...request
  });

  assert.equal(expected.ok, true);
  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), Math.fround(0.2135));
  assert.deepEqual(rawPickedIds(result), rawPickedIds(expected));
  assert.deepEqual(traceParitySummary(result), traceParitySummary(expected));
}

async function test_service_rebuilds_cached_context_when_rows_mutate_in_place() {
  const service = createCraftAssistService({logger: null});
  const rows = [];
  for (let index = 0; index < 10; index += 1) {
    rows.push(makeRow({
      id: `s${index + 1}`,
      name: "Solo",
      relative: 0.05 + index * 0.01
    }));
  }
  rows.push(makeRow({id: "s11", name: "Solo", relative: 0.4}));
  const baseArgs = {
    rows,
    wearFilterMode: "relative",
    materials: [
      {role: "main", count: 10, items: [{name: "Solo", wear_filter_mode: "relative", wear_min: 0, wear_max: 1}]}
    ],
    blockedIds: [],
    includeCooling: false,
    wearOffsetPct: 100
  };

  const first = await service.selectForRecipe({
    ...baseArgs,
    targetWear: inputStepForBelowTargetStep(0.13)
  });
  assert.equal(first.ok, true);
  assert.equal(Number.isFinite(Number(first.overall)), true);

  rows[0].float_value = 0.95;
  rows[10].float_value = 0.199;

  const args = {
    ...baseArgs,
    targetWear: inputStepForBelowTargetStep(0.1099)
  };
  const expected = await selectCraftAssistForRecipe(args);
  const actual = await service.selectForRecipe(args);

  assert.equal(expected.ok, true);
  assert.equal(actual.ok, true);
  assert.equal(Math.fround(actual.overall), Math.fround(expected.overall));
  assert.notDeepEqual(rawPickedIds(expected), rawPickedIds(first));
  assert.deepEqual(rawPickedIds(actual), rawPickedIds(expected));
  assert.deepEqual(traceParitySummary(actual), traceParitySummary(expected));
}

async function test_quantity_shortfall_returns_cooling_filtered_code_when_only_cooling_items_fill_gap() {
  const coolingUnlockTs = Math.floor(Date.now() / 1000) + 86400;
  const rows = [
    makeRow({id: "s1", name: "Solo", relative: 0.10}),
    makeRow({id: "s2", name: "Solo", relative: 0.11}),
    makeRow({id: "s3", name: "Solo", relative: 0.12}),
    makeRow({id: "s4", name: "Solo", relative: 0.13}),
    makeRow({id: "s5", name: "Solo", relative: 0.14}),
    makeRow({id: "s6", name: "Solo", relative: 0.15}),
    makeRow({id: "s7", name: "Solo", relative: 0.16}),
    makeRow({id: "s8", name: "Solo", relative: 0.17}),
    {...makeRow({id: "s9", name: "Solo", relative: 0.18}), tradable_after: coolingUnlockTs},
    {...makeRow({id: "s10", name: "Solo", relative: 0.19}), tradable_after: coolingUnlockTs}
  ];

  const result = await selectCraftAssistForRecipe({
    rows,
    targetWear: inputStepForBelowTargetStep(0.145),
    wearFilterMode: "relative",
    materials: [
      {role: "main", count: 10, items: [{name: "Solo", wear_filter_mode: "relative", wear_min: 0, wear_max: 1}]}
    ],
    blockedIds: [],
    includeCooling: false,
    wearOffsetPct: 100
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "material_quantity_insufficient_cooling_filtered");
  assert.match(result.message, /父类材料【Solo】可用数量不足：需10，仅8/);
}

async function test_quantity_shortfall_returns_blocked_code_when_only_blocked_items_fill_gap() {
  const rows = [
    makeRow({id: "s1", name: "Solo", relative: 0.10}),
    makeRow({id: "s2", name: "Solo", relative: 0.11}),
    makeRow({id: "s3", name: "Solo", relative: 0.12}),
    makeRow({id: "s4", name: "Solo", relative: 0.13}),
    makeRow({id: "s5", name: "Solo", relative: 0.14}),
    makeRow({id: "s6", name: "Solo", relative: 0.15}),
    makeRow({id: "s7", name: "Solo", relative: 0.16}),
    makeRow({id: "s8", name: "Solo", relative: 0.17}),
    makeRow({id: "s9", name: "Solo", relative: 0.18}),
    makeRow({id: "s10", name: "Solo", relative: 0.19})
  ];

  const result = await selectCraftAssistForRecipe({
    rows,
    targetWear: inputStepForBelowTargetStep(0.145),
    wearFilterMode: "relative",
    materials: [
      {role: "main", count: 10, items: [{name: "Solo", wear_filter_mode: "relative", wear_min: 0, wear_max: 1}]}
    ],
    blockedIds: ["s9", "s10"],
    includeCooling: false,
    wearOffsetPct: 100
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "material_quantity_insufficient_blocked");
  assert.match(result.message, /父类材料【Solo】可用数量不足：需10，仅8/);
}

async function test_fast_flag_true_returns_after_expand_step_hit() {
  const rows = makeOversizedPrefilterRows();
  await withEnv({
    ENABLE_OVERSIZED_PREFILTER: "0",
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
    const materials = [
      {name: "Main", names: ["Main"], role: "main", count: 2, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 8, wear_min: 0, wear_max: 1}
    ];
    const slow = await runSelect({
      rows,
      targetWear: inputStepForBelowTargetStep(0.21),
      enableFastCraftAssist: false,
      materials,
      wearOffsetPct: 0
    });
    const fast = await runSelect({
      rows,
      targetWear: inputStepForBelowTargetStep(0.21),
      enableFastCraftAssist: true,
      materials,
      wearOffsetPct: 0
    });

    assert.equal(slow.ok, true);
    assert.equal(fast.ok, true);
    assert.equal(Math.fround(slow.overall), Math.fround(0.21));
    assert.equal(Math.fround(fast.overall), Math.fround(0.21));
    assert.equal(Math.fround(fast.overall), Math.fround(slow.overall));
    assert.equal(!!(fast.selection_trace && fast.selection_trace.prefilter), true);
    assert.equal(fast.selection_trace.prefilter.retryMode, "expand");
    assert.equal(Array.isArray(fast.selection_trace.prefilter.phases), true);
    assert.equal(fast.selection_trace.prefilter.phases.length, 2);
    assert.deepEqual(
      fast.selection_trace.prefilter.phases.map((phase) => phase.phaseName),
      ["prefilter/base", "prefilter/expand"]
    );
    assert.deepEqual(fast.selection_trace.prefilter.phases[0].prefilteredIndexes, [1]);
    assert.equal(fast.selection_trace.prefilter.phases[0].groups[0].candidateCountBefore, 60);
    assert.equal(fast.selection_trace.prefilter.phases[0].groups[0].candidateCountAfter <= 80, true);
    assert.equal(fast.selection_trace.prefilter.contextRefine, null);
  });
}

async function test_fast_flag_false_forces_old_logic_even_when_env_enabled() {
  const rows = makeOversizedPrefilterRows();
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
    const result = await runSelect({
      rows,
      targetWear: inputStepForBelowTargetStep(0.21),
      enableFastCraftAssist: false,
      materials: [
        {name: "Main", names: ["Main"], role: "main", count: 2, wear_min: 0, wear_max: 1},
        {name: "Aux", names: ["Aux"], role: "aux", count: 8, wear_min: 0, wear_max: 1}
      ],
      wearOffsetPct: 0
    });

    assert.equal(result.ok, true);
    assert.equal(Math.fround(result.overall), Math.fround(0.21));
    assert.equal(!!(result.selection_trace && result.selection_trace.prefilter), false);
  });
}

async function test_fast_flag_true_enables_single_material_raw_below_top_k_fast_path() {
  const raw = "0.214285";
  const targetStep = resolveCraftAssistTargetStepSpec({
    inputStep: Math.fround(Number(raw)),
    inputRaw: raw,
    approachMode: "below",
    offsetValue: 0
  }).targetStep;
  const rows = [
    ...makeUniformStepRows({
      prefix: "raw-fast-hit-target",
      name: "Raw Fast Hit",
      relative: targetStep
    }),
    ...makeSingleMaterialRowsFromValues({
      prefix: "raw-fast-hit-lower",
      name: "Raw Fast Hit",
      values: [targetStep - 0.000001, targetStep - 0.000002]
    })
  ];

  const result = await runSelect({
    rows,
    targetWear: Math.fround(Number(raw)),
    targetWearRaw: raw,
    wearApproachMode: "below",
    wearOffsetPct: 0,
    enableFastCraftAssist: true,
    materials: [
      uniformStepMaterial("Raw Fast Hit")
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.selection_trace && result.selection_trace.mode, "single_material_raw_below_top_k");
  assert.equal(result.selection_trace.steps[0].stage, "exact_top_k_all_below_raw");
  assert.equal(Math.fround(result.overall), targetStep);
  assert.deepEqual(
    pickedIds(result),
    Array.from({length: 10}, (_, index) => `raw-fast-hit-target-${index + 1}`).sort()
  );
}

async function test_fast_flag_false_keeps_single_material_raw_below_top_k_fast_path_disabled() {
  const raw = "0.214285";
  const targetStep = resolveCraftAssistTargetStepSpec({
    inputStep: Math.fround(Number(raw)),
    inputRaw: raw,
    approachMode: "below",
    offsetValue: 0
  }).targetStep;
  const rows = [
    ...makeUniformStepRows({
      prefix: "raw-fast-opt-out-target",
      name: "Raw Fast Opt Out",
      relative: targetStep
    }),
    ...makeSingleMaterialRowsFromValues({
      prefix: "raw-fast-opt-out-lower",
      name: "Raw Fast Opt Out",
      values: [targetStep - 0.000001, targetStep - 0.000002]
    })
  ];

  const result = await runSelect({
    rows,
    targetWear: Math.fround(Number(raw)),
    targetWearRaw: raw,
    wearApproachMode: "below",
    wearOffsetPct: 0,
    enableFastCraftAssist: false,
    materials: [
      uniformStepMaterial("Raw Fast Opt Out")
    ]
  });

  assert.equal(result.ok, true);
  assert.notEqual(result.selection_trace && result.selection_trace.mode, "single_material_raw_below_top_k");
  assert.equal(Math.fround(result.overall), targetStep);
  assert.deepEqual(
    pickedIds(result),
    Array.from({length: 10}, (_, index) => `raw-fast-opt-out-target-${index + 1}`).sort()
  );
}

async function test_fast_flag_true_raw_below_top_k_falls_back_when_offset_window_exists() {
  const raw = "0.214285";
  const targetWindow = targetWindowSpecForTest({
    inputStep: Math.fround(Number(raw)),
    inputRaw: raw,
    approachMode: "below",
    wearOffsetPct: 1
  });
  const rows = [
    ...makeUniformStepRows({
      prefix: "raw-fast-offset-high",
      name: "Raw Fast Offset",
      relative: targetWindow.upperTargetStep
    }),
    ...makeUniformStepRows({
      prefix: "raw-fast-offset-low",
      name: "Raw Fast Offset",
      relative: targetWindow.lowerTargetStep,
      count: 1
    })
  ];

  const slow = await runSelect({
    rows,
    targetWear: Math.fround(Number(raw)),
    targetWearRaw: raw,
    wearApproachMode: "below",
    wearOffsetPct: 1,
    enableFastCraftAssist: false,
    materials: [
      uniformStepMaterial("Raw Fast Offset")
    ]
  });
  const {result: fast, searchCalls} = await runSelectWithCapturedSearchCalls({
    selectArgs: {
      rows,
      targetWear: Math.fround(Number(raw)),
      targetWearRaw: raw,
      wearFilterMode: "relative",
      wearApproachMode: "below",
      wearOffsetPct: 1,
      enableFastCraftAssist: true,
      materials: [
        uniformStepMaterial("Raw Fast Offset")
      ],
      blockedIds: [],
      includeCooling: false
    }
  });

  assert.equal(slow.ok, true);
  assert.equal(fast.ok, true);
  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0].enableRawBelowTopKFastPath, true);
  assert.equal(searchCalls[0].hasTargetStepSpec, true);
  assert.notEqual(fast.selection_trace && fast.selection_trace.mode, "single_material_raw_below_top_k");
  assert.deepEqual(pickedIds(fast), pickedIds(slow));
  assert.equal(Math.fround(fast.overall), Math.fround(slow.overall));
  assert.equal(pickedIds(fast).includes("raw-fast-offset-low-1"), false);
}

async function test_fast_flag_true_raw_below_top_k_falls_back_when_any_candidate_reaches_raw_ceiling() {
  const raw = "0.214285";
  const targetStep = Math.fround(Number(raw) - 0.0000001);
  const rows = [
    ...makeUniformStepRows({
      prefix: "raw-fast-ceiling-safe",
      name: "Raw Fast Ceiling",
      relative: targetStep
    }),
    makeRow({
      id: "raw-fast-ceiling-blocker",
      name: "Raw Fast Ceiling",
      relative: Number(raw)
    })
  ];

  const slow = await runSelect({
    rows,
    targetWear: Math.fround(Number(raw)),
    targetWearRaw: raw,
    wearApproachMode: "below",
    wearOffsetPct: 0,
    enableFastCraftAssist: false,
    materials: [
      uniformStepMaterial("Raw Fast Ceiling")
    ]
  });
  const {result: fast, searchCalls} = await runSelectWithCapturedSearchCalls({
    selectArgs: {
      rows,
      targetWear: Math.fround(Number(raw)),
      targetWearRaw: raw,
      wearFilterMode: "relative",
      wearApproachMode: "below",
      wearOffsetPct: 0,
      enableFastCraftAssist: true,
      materials: [
        uniformStepMaterial("Raw Fast Ceiling")
      ],
      blockedIds: [],
      includeCooling: false
    }
  });

  assert.equal(slow.ok, true);
  assert.equal(fast.ok, true);
  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0].enableRawBelowTopKFastPath, true);
  assert.equal(searchCalls[0].hasTargetStepSpec, true);
  assert.notEqual(fast.selection_trace && fast.selection_trace.mode, "single_material_raw_below_top_k");
  assert.deepEqual(pickedIds(fast), pickedIds(slow));
  assert.equal(Math.fround(fast.overall), Math.fround(slow.overall));
  assert.equal(pickedIds(fast).includes("raw-fast-ceiling-blocker"), false);
}

async function test_seed_relay_short_circuits_single_material_when_seed_proves_no_raw_solution() {
  const relay = __test.runCraftAssistBaselineRelay({
    groups: makeSeedRelaySingleGroup(Array.from({length: 10}, (_, index) => 0.51 + index * 0.001)),
    targetValue: 0.5,
    approachMode: "below",
    baselineApproachMode: "below"
  });

  assert.equal(relay && relay.solved, null);
  assert.equal(relay && relay.seedSummary && relay.seedSummary.kind, "seed_proved_no_raw_solution");
  assert.equal(relay && relay.seedSummary && relay.seedSummary.mode, "single_material");
}

async function test_seed_relay_short_circuits_dual_material_when_seed_proves_no_raw_solution() {
  const relay = __test.runCraftAssistBaselineRelay({
    groups: makeSeedRelayDualGroups(
      Array.from({length: 8}, (_, index) => 0.56 + index * 0.001),
      Array.from({length: 2}, (_, index) => 0.55 + index * 0.001)
    ),
    targetValue: 0.5,
    approachMode: "below",
    baselineApproachMode: "below"
  });

  assert.equal(relay && relay.solved, null);
  assert.equal(relay && relay.seedSummary && relay.seedSummary.kind, "seed_proved_no_raw_solution");
  assert.equal(relay && relay.seedSummary && relay.seedSummary.mode, "multi_material_role");
}

async function test_seed_hit_attaches_seed_trace_on_single_material_success() {
  const result = await runSelect({
    rows: [
      makeRow({id: "s1", name: "Solo", relative: 0.44}),
      makeRow({id: "s2", name: "Solo", relative: 0.45}),
      makeRow({id: "s3", name: "Solo", relative: 0.46}),
      makeRow({id: "s4", name: "Solo", relative: 0.47}),
      makeRow({id: "s5", name: "Solo", relative: 0.48}),
      makeRow({id: "s6", name: "Solo", relative: 0.49}),
      makeRow({id: "s7", name: "Solo", relative: 0.491}),
      makeRow({id: "s8", name: "Solo", relative: 0.492}),
      makeRow({id: "s9", name: "Solo", relative: 0.493}),
      makeRow({id: "s10", name: "Solo", relative: 0.494}),
      makeRow({id: "s11", name: "Solo", relative: 0.501}),
      makeRow({id: "s12", name: "Solo", relative: 0.502}),
      makeRow({id: "s13", name: "Solo", relative: 0.503})
    ],
    targetWear: 0.5,
    wearApproachMode: "below",
    wearOffsetPct: 0,
    materials: [
      {name: "Solo", names: ["Solo"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(!!(result.selection_trace && result.selection_trace.seed), true);
  assert.equal(result.selection_trace.seed.kind, "seed_hit");
  assert.equal(result.selection_trace.seed.mode, "single_material");
}

async function test_seed_hit_keeps_target_step_handling_in_baseline() {
  const inputStep = Math.fround(0.27);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below",
    offsetValue: 0.01
  });
  const result = await runSelect({
    rows: [
      ...Array.from({length: 10}, (_, index) => makeRow({id: `lower-${index + 1}`, name: "Solo", relative: targetStepSpec.lowerTargetStep})),
      ...Array.from({length: 10}, (_, index) => makeRow({id: `target-${index + 1}`, name: "Solo", relative: targetStepSpec.targetStep}))
    ],
    targetWear: inputStep,
    wearApproachMode: "below",
    wearOffsetPct: (0.01 / inputStep) * 100,
    materials: [
      {name: "Solo", names: ["Solo"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), targetStepSpec.targetStep);
  assert.equal(!!(result.selection_trace && result.selection_trace.seed), true);
  assert.equal(result.selection_trace.seed.kind, "seed_hit");
}

async function test_step_target_prefilter_window_hit_stops_before_expand_when_best_is_not_primary() {
  const rows = makeContextRefineRows();
  await withEnv({
    ENABLE_OVERSIZED_PREFILTER: "1",
    OVERSIZED_2_SHARDS_THRESHOLD: "20",
    OVERSIZED_4_SHARDS_THRESHOLD: "999",
    SHARD_TOP_K: "2",
    SHARD_EDGE_KEEP_PER_SIDE: "0",
    EXPAND_SHARD_TOP_K: "2",
    EXPAND_SHARD_EDGE_KEEP_PER_SIDE: "0",
    SHORTLIST_MIN: "22",
    SHORTLIST_PER_REQUIRED: "4",
    SHORTLIST_HARD_MAX: "64"
  }, async () => {
    const materials = [
      {name: "Main", names: ["Main"], role: "main", count: 2, wear_min: 0, wear_max: 1},
      {name: "AuxA", names: ["AuxA"], role: "aux", count: 4, wear_min: 0, wear_max: 1},
      {name: "AuxB", names: ["AuxB"], role: "aux", count: 4, wear_min: 0, wear_max: 1}
    ];
    const targetWear = inputStepForBelowTargetStep(0.2142);
    const targetWindow = targetWindowSpecForTest({
      inputStep: targetWear,
      approachMode: "below",
      wearOffsetPct: 100
    });
    const fast = await runSelect({
      rows,
      targetWear,
      enableFastCraftAssist: true,
      wearOffsetPct: 100,
      materials
    });

    assert.equal(fast.ok, true);
    assert.equal(Math.fround(fast.overall) >= targetWindow.lowerTargetStep, true);
    assert.equal(Math.fround(fast.overall) <= targetWindow.targetStep, true);
    assert.notEqual(Math.fround(fast.overall), targetWindow.targetStep);
    assert.equal(!!(fast.selection_trace && fast.selection_trace.prefilter), true);
    assert.equal(fast.selection_trace.prefilter.retryMode, "base");
    assert.equal(fast.selection_trace.prefilter.contextRefine, null);
    assert.deepEqual(
      fast.selection_trace.prefilter.phases.map((phase) => phase.phaseName),
      ["prefilter/base"]
    );
  });
}

async function test_step_target_solved_candidate_requires_exact_target_step_even_in_infinite_mode() {
  const inputStep = Math.fround(0.30000001192092896);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below"
  });
  const wrongStepSolved = {
    overall: nextFloat32(targetStepSpec.targetStep),
    materialResults: [{selected: []}]
  };
  const legacyInfiniteSolved = {
    overall: 0.9,
    materialResults: [{selected: []}]
  };

  assert.equal(
    __test.isCraftAssistSolvedCandidate(
      wrongStepSolved,
      targetStepSpec.targetStep,
      "infinite",
      targetStepSpec
    ),
    false
  );
  assert.equal(
    __test.isCraftAssistSolvedCandidate(
      legacyInfiniteSolved,
      0.3,
      "infinite"
    ),
    true
  );
}

async function test_step_target_below_without_offset_candidate_accepts_any_result_under_original_target() {
  const inputStep = Math.fround(0.27);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below"
  });
  const belowStrictStepSolved = {
    overall: prevFloat32(targetStepSpec.targetStep),
    materialResults: [{selected: []}]
  };

  assert.equal(targetStepSpec.hasOffsetWindow, false);
  assert.equal(belowStrictStepSolved.overall < inputStep, true);
  assert.equal(
    __test.isCraftAssistSolvedCandidate(
      belowStrictStepSolved,
      inputStep,
      "below",
      targetStepSpec
    ),
    true
  );
}

async function test_step_target_fast_base_hit_returns_before_expand_and_context_refine() {
  const targetStep = Math.fround(0.2142);
  const rows = [];
  for (let index = 1; index <= 10; index += 1) {
    rows.push(makeRow({id: `base-hit-${index}`, name: "Base Hit", relative: targetStep}));
  }

  await withEnv({
    ENABLE_OVERSIZED_PREFILTER: "1",
    OVERSIZED_2_SHARDS_THRESHOLD: "5",
    OVERSIZED_4_SHARDS_THRESHOLD: "999",
    SHARD_TOP_K: "10",
    SHARD_EDGE_KEEP_PER_SIDE: "1",
    EXPAND_SHARD_TOP_K: "10",
    EXPAND_SHARD_EDGE_KEEP_PER_SIDE: "1",
    SHORTLIST_MIN: "10",
    SHORTLIST_PER_REQUIRED: "1",
    SHORTLIST_HARD_MAX: "16"
  }, async () => {
    const fast = await runSelect({
      rows,
      targetWear: inputStepForBelowTargetStep(targetStep),
      enableFastCraftAssist: true,
      materials: [
        {name: "Base Hit", names: ["Base Hit"], role: "main", count: 10, wear_min: 0, wear_max: 1}
      ],
      wearOffsetPct: 0
    });

    assert.equal(fast.ok, true);
    assert.equal(Math.fround(fast.overall), targetStep);
    assert.equal(!!(fast.selection_trace && fast.selection_trace.prefilter), true);
    assert.equal(fast.selection_trace.prefilter.retryMode, "base");
    assert.deepEqual(
      fast.selection_trace.prefilter.phases.map((phase) => phase.phaseName),
      ["prefilter/base"]
    );
    assert.equal(fast.selection_trace.prefilter.contextRefine, null);
  });
}

async function test_step_target_fast_base_window_hit_returns_before_expand_after_batch() {
  const rows = makeContextRefineRows();
  await withEnv({
    ENABLE_OVERSIZED_PREFILTER: "1",
    OVERSIZED_2_SHARDS_THRESHOLD: "20",
    OVERSIZED_4_SHARDS_THRESHOLD: "999",
    SHARD_TOP_K: "2",
    SHARD_EDGE_KEEP_PER_SIDE: "0",
    EXPAND_SHARD_TOP_K: "2",
    EXPAND_SHARD_EDGE_KEEP_PER_SIDE: "0",
    SHORTLIST_MIN: "22",
    SHORTLIST_PER_REQUIRED: "4",
    SHORTLIST_HARD_MAX: "64"
  }, async () => {
    const targetWear = inputStepForBelowTargetStep(0.2142);
    const targetWindow = targetWindowSpecForTest({
      inputStep: targetWear,
      approachMode: "below",
      wearOffsetPct: 100
    });
    const fast = await runSelect({
      rows,
      targetWear,
      enableFastCraftAssist: true,
      wearOffsetPct: 100,
      materials: [
        {name: "Main", names: ["Main"], role: "main", count: 2, wear_min: 0, wear_max: 1},
        {name: "AuxA", names: ["AuxA"], role: "aux", count: 4, wear_min: 0, wear_max: 1},
        {name: "AuxB", names: ["AuxB"], role: "aux", count: 4, wear_min: 0, wear_max: 1}
      ]
    });

    assert.equal(fast.ok, true);
    assert.equal(Math.fround(fast.overall) >= targetWindow.lowerTargetStep, true);
    assert.equal(Math.fround(fast.overall) <= targetWindow.targetStep, true);
    assert.notEqual(Math.fround(fast.overall), targetWindow.targetStep);
    assert.equal(!!(fast.selection_trace && fast.selection_trace.prefilter), true);
    assert.equal(fast.selection_trace.prefilter.retryMode, "base");
    assert.deepEqual(
      fast.selection_trace.prefilter.phases.map((phase) => phase.phaseName),
      ["prefilter/base"]
    );
    assert.equal(fast.selection_trace.prefilter.contextRefine, null);
  });
}

async function test_target_step_without_prefilter_does_not_rerun_full_baseline() {
  const inputStep = Math.fround(0.5);
  const targetWindow = targetWindowSpecForTest({
    inputStep,
    approachMode: "below",
    wearOffsetPct: 1
  });
  const rows = makeUniformStepRows({
    prefix: "full-no-prefilter",
    name: "No Prefilter",
    relative: targetWindow.lowerTargetStep,
    count: 12
  });
  const searchCalls = [];
  const service = loadCraftAssistServiceWithOverrides({
    searchOverrides: {
      searchCraftAssistSeed() {
        return null;
      },
      searchCraftAssistBestSolution({groups, targetStepSpec}) {
        const kind = classifyCraftAssistSearchGroups(groups);
        assert.notEqual(kind, "unknown");
        searchCalls.push(kind);
        return makeSolvedFromGroups(groups, targetStepSpec.lowerTargetStep);
      }
    }
  });

  const result = await service.selectCraftAssistForRecipe({
    rows,
    targetWear: inputStep,
    wearFilterMode: "relative",
    wearApproachMode: "below",
    wearOffsetPct: 1,
    materials: [
      uniformStepMaterial("No Prefilter")
    ],
    blockedIds: [],
    includeCooling: false,
    enableFastCraftAssist: false
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), targetWindow.lowerTargetStep);
  assert.deepEqual(searchCalls, ["full"]);
}

async function test_service_passes_existing_wear_offset_as_search_entry_window() {
  const targetWear = Math.fround(0.21);
  const wearOffsetPct = 1;
  const expectedEntryOffsetValue = Number(targetWear) * (wearOffsetPct / 100);
  const targetWindow = targetWindowSpecForTest({
    inputStep: targetWear,
    inputRaw: "0.21",
    approachMode: "below",
    wearOffsetPct
  });
  const rows = makeUniformStepRows({
    prefix: "entry-window-service",
    name: "Entry Window Service",
    relative: targetWindow.targetStep,
    count: 12
  });
  const selectArgs = {
    rows,
    targetWear,
    targetWearRaw: "0.21",
    wearFilterMode: "relative",
    wearApproachMode: "below",
    wearOffsetPct,
    enableFastCraftAssist: false,
    materials: [
      uniformStepMaterial("Entry Window Service")
    ],
    blockedIds: [],
    includeCooling: false
  };
  assert.equal(Object.prototype.hasOwnProperty.call(selectArgs, "entryOffsetValue"), false);

  const searchCalls = [];
  const service = loadCraftAssistServiceWithOverrides({
    searchOverrides: {
      searchCraftAssistSeed() {
        return null;
      },
      searchCraftAssistBestSolution(args = {}) {
        searchCalls.push({
          approachMode: String(args.approachMode || ""),
          entryApproachMode: args.entryApproachMode == null ? null : String(args.entryApproachMode),
          entryOffsetValue: args.entryOffsetValue
        });
        return makeSolvedFromGroups(args.groups, args.targetStepSpec.targetStep);
      }
    }
  });
  const result = await service.selectCraftAssistForRecipe(selectArgs);

  assert.equal(result.ok, true);
  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0].approachMode, "infinite");
  assert.equal(searchCalls[0].entryApproachMode, "below");
  assert.equal(
    Math.abs(Number(searchCalls[0].entryOffsetValue) - expectedEntryOffsetValue) < 1e-12,
    true
  );
}

async function test_service_treats_wear_offset_as_fixed_value() {
  const targetWear = Math.fround(0.21);
  const fixedWearOffset = 0.01;
  const targetWindow = resolveCraftAssistTargetStepSpec({
    inputStep: targetWear,
    inputRaw: "0.21",
    approachMode: "below",
    offsetValue: fixedWearOffset
  });
  const searchCalls = [];
  const service = loadCraftAssistServiceWithOverrides({
    searchOverrides: {
      searchCraftAssistSeed() {
        return null;
      },
      searchCraftAssistBestSolution(args = {}) {
        searchCalls.push({
          entryOffsetValue: args.entryOffsetValue
        });
        return makeSolvedFromGroups(args.groups, args.targetStepSpec.targetStep);
      }
    }
  });

  const result = await service.selectCraftAssistForRecipe({
    rows: makeUniformStepRows({
      prefix: "fixed-entry-window-service",
      name: "Fixed Entry Window Service",
      relative: targetWindow.targetStep,
      count: 12
    }),
    targetWear,
    targetWearRaw: "0.21",
    wearFilterMode: "relative",
    wearApproachMode: "below",
    wearOffset: fixedWearOffset,
    enableFastCraftAssist: false,
    materials: [
      uniformStepMaterial("Fixed Entry Window Service")
    ],
    blockedIds: [],
    includeCooling: false
  });

  assert.equal(result.ok, true);
  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0].entryOffsetValue, fixedWearOffset);
}

async function test_target_step_rarity_full_prefilter_fallback_does_not_rerun_full_baseline() {
  const inputStep = Math.fround(0.5);
  const targetWindow = targetWindowSpecForTest({
    inputStep,
    approachMode: "below",
    wearOffsetPct: 1
  });
  const rows = makeUniformStepRows({
    prefix: "full-rarity-fallback",
    name: "Rarity Fallback",
    relative: targetWindow.lowerTargetStep,
    count: 12
  });
  const searchCalls = [];
  const service = loadCraftAssistServiceWithOverrides({
    searchOverrides: {
      searchCraftAssistSeed() {
        return null;
      },
      searchCraftAssistBestSolution({groups, targetStepSpec, enableRawBelowTopKFastPath}) {
        const kind = classifyCraftAssistSearchGroups(groups);
        assert.notEqual(kind, "unknown");
        searchCalls.push({
          kind,
          enableRawBelowTopKFastPath: enableRawBelowTopKFastPath === true
        });
        return makeSolvedFromGroups(groups, targetStepSpec.lowerTargetStep);
      }
    },
    shardOverrides: {
      resolvePrefilterOptions() {
        return {enableOversizedPrefilter: true};
      },
      resolveShardCount() {
        return 1;
      },
      async runPrefilterPhase({phaseName}) {
        return {
          kind: "phase_unavailable",
          prefilterTrace: {phaseName}
        };
      }
    }
  });

  const result = await service.selectCraftAssistForRecipe({
    rows,
    targetWear: inputStep,
    wearFilterMode: "relative",
    wearApproachMode: "below",
    wearOffsetPct: 1,
    materials: [
      uniformStepMaterial("Rarity Fallback")
    ],
    blockedIds: [],
    includeCooling: false,
    enableFastCraftAssist: true
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), targetWindow.lowerTargetStep);
  assert.deepEqual(searchCalls, [{
    kind: "full",
    enableRawBelowTopKFastPath: true
  }]);
  assert.equal(!!(result.selection_trace && result.selection_trace.prefilter), true);
  assert.equal(result.selection_trace.prefilter.retryMode, "rarity_full");
  assert.equal(result.selection_trace.prefilter.usedRarityFullFallback, true);
}

async function test_target_step_base_window_hit_still_keeps_outer_full_fallback() {
  const inputStep = Math.fround(0.5);
  const targetWindow = targetWindowSpecForTest({
    inputStep,
    approachMode: "below",
    wearOffsetPct: 1
  });
  const rows = makeUniformStepRows({
    prefix: "full-base-window",
    name: "Base Window",
    relative: targetWindow.targetStep,
    count: 12
  });
  const baseGroups = [{
    index: 0,
    material: {name: "Base Window", names: ["Base Window"], role: "main", count: 10, wear_min: 0, wear_max: 1},
    candidates: Array.from({length: 10}, (_, index) => makeCandidate(
      `base-window-${index + 1}`,
      targetWindow.lowerTargetStep,
      0,
      "main"
    ))
  }];
  const searchCalls = [];
  const service = loadCraftAssistServiceWithOverrides({
    searchOverrides: {
      searchCraftAssistSeed() {
        return null;
      },
      searchCraftAssistBestSolution({groups, targetStepSpec, enableRawBelowTopKFastPath}) {
        const kind = classifyCraftAssistSearchGroups(groups);
        assert.notEqual(kind, "unknown");
        searchCalls.push({
          kind,
          enableRawBelowTopKFastPath: enableRawBelowTopKFastPath === true
        });
        if (kind === "base") {
          return makeSolvedFromGroups(groups, targetStepSpec.lowerTargetStep);
        }
        return makeSolvedFromGroups(groups, targetStepSpec.targetStep);
      }
    },
    shardOverrides: {
      resolvePrefilterOptions() {
        return {enableOversizedPrefilter: true};
      },
      resolveShardCount() {
        return 1;
      },
      async runPrefilterPhase({phaseName}) {
        return {
          kind: phaseName === "prefilter/base" ? "phase_ready" : "phase_unavailable",
          groups: phaseName === "prefilter/base" ? baseGroups : null,
          prefilterTrace: {phaseName}
        };
      }
    }
  });

  const result = await service.selectCraftAssistForRecipe({
    rows,
    targetWear: inputStep,
    wearFilterMode: "relative",
    wearApproachMode: "below",
    wearOffsetPct: 1,
    materials: [
      uniformStepMaterial("Base Window")
    ],
    blockedIds: [],
    includeCooling: false,
    enableFastCraftAssist: true
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), targetWindow.targetStep);
  assert.deepEqual(searchCalls, [
    {kind: "base", enableRawBelowTopKFastPath: true},
    {kind: "full", enableRawBelowTopKFastPath: true}
  ]);
  assert.equal(!!(result.selection_trace && result.selection_trace.prefilter), true);
  assert.equal(result.selection_trace.prefilter.retryMode, "base");
  assert.equal(result.selection_trace.prefilter.usedRarityFullFallback, false);
}

async function test_target_step_expand_window_hit_still_keeps_outer_full_fallback() {
  const inputStep = Math.fround(0.5);
  const targetWindow = targetWindowSpecForTest({
    inputStep,
    approachMode: "below",
    wearOffsetPct: 1
  });
  const belowWindowStep = prevFloat32(targetWindow.lowerTargetStep);
  const rows = makeUniformStepRows({
    prefix: "full-expand-window",
    name: "Expand Window",
    relative: targetWindow.targetStep,
    count: 12
  });
  const baseGroups = [{
    index: 0,
    material: {name: "Expand Window", names: ["Expand Window"], role: "main", count: 10, wear_min: 0, wear_max: 1},
    candidates: Array.from({length: 10}, (_, index) => makeCandidate(
      `base-miss-${index + 1}`,
      belowWindowStep,
      0,
      "main"
    ))
  }];
  const expandGroups = [{
    index: 0,
    material: {name: "Expand Window", names: ["Expand Window"], role: "main", count: 10, wear_min: 0, wear_max: 1},
    candidates: Array.from({length: 10}, (_, index) => makeCandidate(
      `expand-window-${index + 1}`,
      targetWindow.lowerTargetStep,
      0,
      "main"
    ))
  }];
  const searchCalls = [];
  const service = loadCraftAssistServiceWithOverrides({
    searchOverrides: {
      searchCraftAssistSeed() {
        return null;
      },
      searchCraftAssistBestSolution({groups, targetStepSpec, enableRawBelowTopKFastPath}) {
        const kind = classifyCraftAssistSearchGroups(groups);
        assert.notEqual(kind, "unknown");
        searchCalls.push({
          kind,
          enableRawBelowTopKFastPath: enableRawBelowTopKFastPath === true
        });
        if (kind === "base") {
          return makeSolvedFromGroups(groups, belowWindowStep);
        }
        if (kind === "expand") {
          return makeSolvedFromGroups(groups, targetStepSpec.lowerTargetStep);
        }
        return makeSolvedFromGroups(groups, targetStepSpec.targetStep);
      }
    },
    shardOverrides: {
      resolvePrefilterOptions() {
        return {enableOversizedPrefilter: true};
      },
      resolveShardCount() {
        return 1;
      },
      async runPrefilterPhase({phaseName}) {
        if (phaseName === "prefilter/base") {
          return {
            kind: "phase_ready",
            groups: baseGroups,
            prefilterTrace: {phaseName}
          };
        }
        return {
          kind: "phase_ready",
          groups: expandGroups,
          prefilterTrace: {phaseName}
        };
      }
    }
  });

  const result = await service.selectCraftAssistForRecipe({
    rows,
    targetWear: inputStep,
    wearFilterMode: "relative",
    wearApproachMode: "below",
    wearOffsetPct: 1,
    materials: [
      uniformStepMaterial("Expand Window")
    ],
    blockedIds: [],
    includeCooling: false,
    enableFastCraftAssist: true
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), targetWindow.targetStep);
  assert.deepEqual(searchCalls, [
    {kind: "base", enableRawBelowTopKFastPath: true},
    {kind: "expand", enableRawBelowTopKFastPath: true},
    {kind: "full", enableRawBelowTopKFastPath: true}
  ]);
  assert.equal(!!(result.selection_trace && result.selection_trace.prefilter), true);
  assert.equal(result.selection_trace.prefilter.retryMode, "expand");
  assert.equal(result.selection_trace.prefilter.usedRarityFullFallback, false);
}

async function test_step_target_fast_expands_after_base_window_miss_and_stops_on_expand_window_hit() {
  const inputStep = Math.fround(0.5);
  const targetWindow = targetWindowSpecForTest({
    inputStep,
    approachMode: "below",
    wearOffsetPct: 1
  });
  const rows = [
    ...Array.from({length: 10}, (_, index) => makeRow({
      id: `lower-${index + 1}`,
      name: "Solo",
      relative: targetWindow.lowerTargetStep
    })),
    ...Array.from({length: 60}, (_, index) => makeRow({
      id: `below-${index + 1}`,
      name: "Solo",
      relative: Math.fround(targetWindow.lowerTargetStep - 0.03 - index * 0.0001)
    }))
  ];

  await withEnv({
    ENABLE_OVERSIZED_PREFILTER: "1",
    OVERSIZED_2_SHARDS_THRESHOLD: "10",
    OVERSIZED_4_SHARDS_THRESHOLD: "999",
    SHARD_TOP_K: "8",
    SHARD_EDGE_KEEP_PER_SIDE: "4",
    EXPAND_SHARD_TOP_K: "20",
    EXPAND_SHARD_EDGE_KEEP_PER_SIDE: "4",
    SHARD_CENTER_OVERLAP_MIN: "0",
    SHARD_CENTER_OVERLAP_MAX: "0",
    SHORTLIST_MIN: "10",
    SHORTLIST_PER_REQUIRED: "1",
    SHORTLIST_HARD_MAX: "30"
  }, async () => {
    const fast = await runSelect({
      rows,
      targetWear: inputStep,
      enableFastCraftAssist: true,
      wearOffsetPct: 1,
      materials: [
        {name: "Solo", names: ["Solo"], role: "main", count: 10, wear_min: 0, wear_max: 1}
      ]
    });

    assert.equal(fast.ok, true);
    assert.equal(Math.fround(fast.overall) >= targetWindow.lowerTargetStep, true);
    assert.equal(Math.fround(fast.overall) <= targetWindow.targetStep, true);
    assert.notEqual(Math.fround(fast.overall), targetWindow.targetStep);
    assert.equal(!!(fast.selection_trace && fast.selection_trace.prefilter), true);
    assert.equal(fast.selection_trace.prefilter.retryMode, "expand");
    assert.deepEqual(
      fast.selection_trace.prefilter.phases.map((phase) => phase.phaseName),
      ["prefilter/base", "prefilter/expand"]
    );
  });
}

async function test_item_level_material_items_support_mixed_relative_absolute_filters_and_preserve_candidate_ordering() {
  const rows = [
    makeRow({id: "fill-1", name: "Filler", relative: 0.10}),
    makeRow({id: "fill-2", name: "Filler", relative: 0.11}),
    makeRow({id: "fill-3", name: "Filler", relative: 0.12}),
    makeRow({id: "fill-4", name: "Filler", relative: 0.13}),
    makeRow({id: "fill-5", name: "Filler", relative: 0.14}),
    makeRow({id: "fill-6", name: "Filler", relative: 0.15}),
    makeRow({id: "fill-7", name: "Filler", relative: 0.16}),
    makeRow({id: "fill-8", name: "Filler", relative: 0.17}),
    makeRow({id: "rel-1", name: "Rel Skin", relative: 0.31}),
    makeRow({id: "abs-close", name: "Abs Skin", relative: 0.55, min: 0.5, max: 0.9}),
    makeRow({id: "abs-far", name: "Abs Skin", relative: 0.95, min: 0.5, max: 0.9})
  ];

  const result = await runSelect({
    rows,
    targetWear: inputStepForBelowTargetStep(0.194),
    wearOffsetPct: 0,
    materials: [
      {
        id: "mixed-main",
        role: "main",
        count: 2,
        names: ["Rel Skin", "Abs Skin"],
        wear_min: 0.30,
        wear_max: 0.34,
        custom_range: true,
        items: [
          {
            id: "rel-card",
            name: "Rel Skin",
            wear_filter_mode: "relative",
            wear_min: 0.30,
            wear_max: 0.34,
            custom_range: true
          },
          {
            id: "abs-card",
            name: "Abs Skin",
            wear_filter_mode: "absolute",
            wear_min: 0.70,
            wear_max: 0.85,
            custom_range: true
          },
          {
            id: "rel-card-duplicate",
            name: "Rel Skin",
            wear_filter_mode: "relative",
            wear_min: 0.30,
            wear_max: 0.34,
            custom_range: true
          }
        ]
      },
      {
        id: "fill-aux",
        role: "aux",
        count: 8,
        names: ["Filler"],
        wear_min: 0,
        wear_max: 1
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), Math.fround(0.194));
  assert.deepEqual(result.item_ids, [
    "rel-1",
    "abs-close",
    "fill-8",
    "fill-7",
    "fill-6",
    "fill-5",
    "fill-4",
    "fill-3",
    "fill-2",
    "fill-1"
  ]);
  assert.equal(new Set(result.item_ids).size, result.item_ids.length);
}

async function test_prefilter_trace_uses_primary_name_projection_for_multi_item_materials() {
  const rows = makeContextRefineRows();
  await withEnv({
    ENABLE_OVERSIZED_PREFILTER: "1",
    OVERSIZED_2_SHARDS_THRESHOLD: "20",
    OVERSIZED_4_SHARDS_THRESHOLD: "999",
    SHARD_TOP_K: "2",
    SHARD_EDGE_KEEP_PER_SIDE: "0",
    EXPAND_SHARD_TOP_K: "2",
    EXPAND_SHARD_EDGE_KEEP_PER_SIDE: "0",
    SHORTLIST_MIN: "22",
    SHORTLIST_PER_REQUIRED: "4",
    SHORTLIST_HARD_MAX: "64"
  }, async () => {
    const request = {
      rows,
      targetWear: inputStepForBelowTargetStep(0.2142),
      enableFastCraftAssist: true,
      wearOffsetPct: 100,
      materials: [
        {
          name: "Main",
          names: ["Main"],
          role: "main",
          count: 2,
          wear_min: 0,
          wear_max: 1,
          items: [
            {
              id: "main-card",
              name: "Main",
              wear_filter_mode: "relative",
              wear_min: 0,
              wear_max: 1,
              custom_range: false
            }
          ]
        },
        {
          name: "AuxA Variant",
          names: ["AuxA Variant", "AuxA"],
          role: "aux",
          count: 4,
          wear_min: 0,
          wear_max: 1,
          items: [
            {
              id: "aux-a-base",
              name: "AuxA",
              wear_filter_mode: "relative",
              wear_min: 0,
              wear_max: 1,
              custom_range: false
            },
            {
              id: "aux-a-variant",
              name: "AuxA Variant",
              wear_filter_mode: "relative",
              wear_min: 0,
              wear_max: 1,
              custom_range: false
            }
          ]
        },
        {
          name: "AuxB Variant",
          names: ["AuxB Variant", "AuxB"],
          role: "aux",
          count: 4,
          wear_min: 0,
          wear_max: 1,
          items: [
            {
              id: "aux-b-base",
              name: "AuxB",
              wear_filter_mode: "relative",
              wear_min: 0,
              wear_max: 1,
              custom_range: false
            },
            {
              id: "aux-b-variant",
              name: "AuxB Variant",
              wear_filter_mode: "relative",
              wear_min: 0,
              wear_max: 1,
              custom_range: false
            }
          ]
        }
      ]
    };
    const result = await runSelect(request);
    const targetWindow = targetWindowSpecForTest({
      inputStep: request.targetWear,
      approachMode: "below",
      wearOffsetPct: 100
    });

    assert.equal(result.ok, true);
    assert.equal(Math.fround(result.overall) >= targetWindow.lowerTargetStep, true);
    assert.equal(Math.fround(result.overall) <= targetWindow.targetStep, true);
    assert.notEqual(Math.fround(result.overall), targetWindow.targetStep);
    assert.equal(!!(result.selection_trace && result.selection_trace.prefilter), true);
    assert.equal(result.selection_trace.prefilter.retryMode, "base");
    assert.equal(result.selection_trace.prefilter.contextRefine, null);
    const prefilterGroups = result.selection_trace.prefilter.phases.flatMap((phase) => phase.groups || []);
    const auxAGroup = prefilterGroups.find((group) => group && group.primary_name === "AuxA");
    assert.equal(!!auxAGroup, true);
    assert.deepEqual(auxAGroup.item_names, ["AuxA", "AuxA Variant"]);
    assert.equal(auxAGroup.label, "AuxA / AuxA Variant");
  });
}

async function test_duplicate_names_across_materials_fail_after_canonicalize_reduces_total_count() {
  const rows = [];
  for (let index = 0; index < 10; index += 1) {
    rows.push(makeRow({id: `same-${index + 1}`, name: "Same", relative: 0.1 + index * 0.01}));
  }

  const result = await runSelect({
    rows,
    targetWear: inputStepForBelowTargetStep(0.25),
    wearOffsetPct: 0,
    materials: [
      {id: "main-same", role: "main", count: 5, names: ["Same"], wear_min: 0, wear_max: 1},
      {id: "aux-same", role: "aux", count: 5, names: ["Same"], wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /材料数量之和必须等于 10，当前 5/);
}

async function test_zero_count_auxiliary_material_is_inactive() {
  const q = Math.fround(0.27);
  const targetStep = prevFloat32(q);
  const rows = [];
  for (let index = 1; index <= 10; index += 1) {
    rows.push(makeRow({id: `zero-aux-main-${index}`, name: "Main Skin", relative: targetStep}));
  }

  const result = await runSelect({
    rows,
    targetWear: q,
    wearApproachMode: "below",
    wearOffsetPct: 0,
    materials: [
      {role: "main", count: 10, names: ["Main Skin"], wear_min: 0, wear_max: 1},
      {role: "aux", count: 0, names: ["Catalog Only Auxiliary"], wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.item_ids.length, 10);
}

async function test_catalog_market_name_matches_localized_inventory_rows() {
  const q = Math.fround(0.27);
  const targetStep = prevFloat32(q);
  const rows = [];
  for (let index = 1; index <= 10; index += 1) {
    const row = makeRow({id: `localized-catalog-${index}`, name: "FAMAS | Half Sleeve (Field-Tested)", relative: targetStep});
    row.alchemy_name = "法玛斯 | 半袖式 (久经沙场)";
    rows.push(row);
  }

  const result = await runSelect({
    rows,
    targetWear: q,
    wearApproachMode: "below",
    wearOffsetPct: 0,
    materials: [
      {role: "main", count: 10, names: ["FAMAS | Half Sleeve (Field-Tested)"], wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.item_ids.length, 10);
}

async function test_step_target_below_searches_previous_float32_step() {
  const q = Math.fround(0.27);
  const targetStep = prevFloat32(q);
  const rows = [];
  for (let index = 1; index <= 10; index += 1) {
    rows.push(makeRow({id: `step-${index}`, name: "Step Skin", relative: targetStep}));
  }

  const result = await runSelect({
    rows,
    targetWear: q,
    wearApproachMode: "below",
    wearOffsetPct: 0,
    materials: [
      {name: "Step Skin", names: ["Step Skin"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), targetStep);
}

async function test_step_target_infinite_accepts_raw_mean_on_target_float32_step() {
  const q = Math.fround(0.27);
  const rows = [];
  for (let index = 1; index <= 9; index += 1) {
    rows.push(makeRow({id: `target-${index}`, name: "Step Skin", relative: q}));
  }
  rows.push(makeRow({id: "target-10", name: "Step Skin", relative: q + 10 * Number.EPSILON}));

  const rawMean = rows.reduce((sum, row) => sum + Number(row.float_value), 0) / rows.length;
  assert.notEqual(rawMean, q);
  assert.equal(Math.fround(rawMean), q);

  const result = await runSelect({
    rows,
    targetWear: q,
    wearApproachMode: "infinite",
    wearOffsetPct: 0,
    materials: [
      {name: "Step Skin", names: ["Step Skin"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), q);
}

async function test_step_target_rejects_non_float32_target() {
  const rows = [];
  for (let index = 1; index <= 10; index += 1) {
    rows.push(makeRow({id: `invalid-${index}`, name: "Step Skin", relative: 0.05}));
  }

  const result = await runSelect({
    rows,
    targetWear: 0.1,
    wearOffsetPct: 0,
    materials: [
      {name: "Step Skin", names: ["Step Skin"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_target_step");
}

async function test_step_target_rejects_below_zero_target() {
  const rows = [];
  for (let index = 1; index <= 10; index += 1) {
    rows.push(makeRow({id: `zero-${index}`, name: "Step Skin", relative: 0}));
  }

  const result = await runSelect({
    rows,
    targetWear: 0,
    wearApproachMode: "below",
    wearOffsetPct: 0,
    materials: [
      {name: "Step Skin", names: ["Step Skin"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "unreachable_below_target");
}

async function test_step_target_final_validation_allows_below_result_under_original_target() {
  const q = Math.fround(0.27);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep: q,
    approachMode: "below"
  });

  const onTarget = __test.validateCraftAssistFinalOverall({
    overall: targetStepSpec.targetStep + Number.EPSILON,
    targetValue: q,
    searchTargetValue: targetStepSpec.targetStep,
    approachMode: "below",
    targetStepSpec
  });
  const belowTargetStep = __test.validateCraftAssistFinalOverall({
    overall: prevFloat32(targetStepSpec.targetStep),
    targetValue: q,
    searchTargetValue: targetStepSpec.targetStep,
    approachMode: "below",
    targetStepSpec
  });

  assert.equal(Math.fround(targetStepSpec.targetStep + Number.EPSILON), targetStepSpec.targetStep);
  assert.equal(Math.fround(prevFloat32(targetStepSpec.targetStep)), prevFloat32(targetStepSpec.targetStep));
  assert.deepEqual(onTarget, {ok: true});
  assert.deepEqual(belowTargetStep, {ok: true});
}

async function test_step_target_final_validation_failure_log_includes_window_diagnostics() {
  const q = Math.fround(0.5);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep: q,
    approachMode: "infinite",
    offsetValue: 0.005
  });
  const belowWindowStep = prevFloat32(targetStepSpec.lowerTargetStep);
  const wrongStep = __test.validateCraftAssistFinalOverall({
    overall: belowWindowStep,
    targetValue: q,
    searchTargetValue: targetStepSpec.targetStep,
    approachMode: "infinite",
    targetStepSpec
  });
  const text = __test.buildCraftAssistFailureLogText(wrongStep);

  assert.equal(targetStepSpec.lowerTargetStep < targetStepSpec.targetStep, true);
  assert.equal(targetStepSpec.targetStep < targetStepSpec.upperTargetStep, true);
  assert.equal(wrongStep.ok, false);
  assert.equal(wrongStep.code, "final_result_not_on_target_step");
  assert.equal(wrongStep.input_step, targetStepSpec.inputStep);
  assert.equal(wrongStep.target_step, targetStepSpec.targetStep);
  assert.equal(wrongStep.lower_target_step, targetStepSpec.lowerTargetStep);
  assert.equal(wrongStep.upper_target_step, targetStepSpec.upperTargetStep);
  assert.equal(wrongStep.quantized_overall, Math.fround(belowWindowStep));
  assert.match(text, /input_step=/);
  assert.match(text, /target_step=/);
  assert.match(text, /lower_target_step=/);
  assert.match(text, /upper_target_step=/);
  assert.match(text, /quantized_overall=/);
}

function targetWindowSpecForTest({inputStep, inputRaw, approachMode, wearOffsetPct}) {
  return resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw,
    approachMode,
    offsetValue: Number(inputStep) * (Number(wearOffsetPct) / 100)
  });
}

function makeUniformStepRows({prefix, name, relative, count = 10}) {
  const rows = [];
  for (let index = 1; index <= count; index += 1) {
    rows.push(makeRow({id: `${prefix}-${index}`, name, relative}));
  }
  return rows;
}

function uniformStepMaterial(name, count = 10) {
  return {name, names: [name], role: "main", count, wear_min: 0, wear_max: 1};
}

function makeSingleMaterialRowsFromValues({prefix, name, values}) {
  return (Array.isArray(values) ? values : []).map((value, index) => (
    makeRow({
      id: `${prefix}-${index + 1}`,
      name,
      relative: Number(value)
    })
  ));
}

async function test_raw_aware_below_uses_one_tenth_micro_lower_target_when_float32_step_is_below_raw() {
  const raw = "0.21";
  const step = Math.fround(Number(raw));
  const expectedTargetStep = Math.fround(Number(raw) - 0.0000001);
  assert.equal(step < Number(raw), true);
  const result = await runSelect({
    rows: makeUniformStepRows({prefix: "raw-below-step", name: "Raw Below Step", relative: expectedTargetStep}),
    targetWear: step,
    targetWearRaw: raw,
    wearApproachMode: "below",
    wearOffsetPct: 0,
    materials: [
      uniformStepMaterial("Raw Below Step")
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), expectedTargetStep);
  assert.equal(result.overall < Number(raw), true);
}

async function test_raw_aware_below_uses_one_tenth_micro_lower_target_when_float32_step_is_above_raw() {
  const raw = "0.18";
  const step = Math.fround(Number(raw));
  const targetStep = Math.fround(Number(raw) - 0.0000001);
  assert.equal(step > Number(raw), true);
  const result = await runSelect({
    rows: makeUniformStepRows({prefix: "raw-above-prev", name: "Raw Above Prev", relative: targetStep}),
    targetWear: step,
    targetWearRaw: raw,
    wearApproachMode: "below",
    wearOffsetPct: 0,
    materials: [
      uniformStepMaterial("Raw Above Prev")
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), targetStep);
  assert.equal(result.overall < Number(raw), true);
}

async function test_raw_aware_below_exact_step_raw_uses_one_tenth_micro_lower_target() {
  const step = Math.fround(0.5);
  const targetStep = Math.fround(Number(step) - 0.0000001);
  const result = await runSelect({
    rows: makeUniformStepRows({prefix: "raw-exact-prev", name: "Raw Exact Prev", relative: targetStep}),
    targetWear: step,
    targetWearRaw: String(step),
    wearApproachMode: "below",
    wearOffsetPct: 0,
    materials: [
      uniformStepMaterial("Raw Exact Prev")
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), targetStep);
  assert.equal(result.overall < step, true);
}

async function test_raw_aware_below_at_or_below_one_tenth_micro_raw_rejects_unreachable_target() {
  for (const raw of ["0", "0.0000001"]) {
    const result = await runSelect({
      rows: makeUniformStepRows({prefix: `raw-unreachable-${raw}`, name: "Raw Unreachable", relative: Math.fround(Number(raw))}),
      targetWear: Math.fround(Number(raw)),
      targetWearRaw: raw,
      wearApproachMode: "below",
      wearOffsetPct: 0,
      materials: [
        uniformStepMaterial("Raw Unreachable")
      ]
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "unreachable_below_target");
  }
}

async function test_raw_aware_infinite_uses_input_step() {
  const raw = "0.21";
  const step = Math.fround(Number(raw));
  const result = await runSelect({
    rows: makeUniformStepRows({prefix: "raw-infinite-step", name: "Raw Infinite Step", relative: step}),
    targetWear: step,
    targetWearRaw: raw,
    wearApproachMode: "infinite",
    wearOffsetPct: 0,
    materials: [
      uniformStepMaterial("Raw Infinite Step")
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), step);
}

async function test_service_target_step_log_keeps_raw_input_text_separate_from_machine_step() {
  const service = createCraftAssistService({logger: null});
  const raw = "0.2100001";
  const step = Math.fround(Number(raw));
  const expectedTargetStep = Math.fround(Number(raw) - 0.0000001);
  const {result, logs} = await captureConsoleLogs(() => service.selectForRecipe({
    rows: makeUniformStepRows({prefix: "raw-log", name: "Raw Log", relative: expectedTargetStep}),
    targetWear: step,
    targetWearRaw: raw,
    wearFilterMode: "relative",
    wearApproachMode: "below",
    wearOffsetPct: 0,
    materials: [
      uniformStepMaterial("Raw Log")
    ],
    blockedIds: [],
    includeCooling: false
  }));

  assert.equal(result.ok, true);
  const targetStepLog = logs.find((line) => line.includes("目标台阶:"));
  assert.ok(targetStepLog, "expected target step log line");
  assert.match(targetStepLog, /raw=0\.2100001(\s|$)/);
  assert.match(targetStepLog, /input_step=0\.2100000977516174/);
  assert.equal(targetStepLog.includes(`target_step=${expectedTargetStep}`), true);
}

async function test_legacy_below_without_raw_keeps_step_only_previous_step_behavior() {
  const step = Math.fround(0.21);
  const targetStep = prevFloat32(step);
  const result = await runSelect({
    rows: makeUniformStepRows({prefix: "legacy-prev", name: "Legacy Prev", relative: targetStep}),
    targetWear: step,
    wearApproachMode: "below",
    wearOffsetPct: 0,
    materials: [
      uniformStepMaterial("Legacy Prev")
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), targetStep);
}

async function test_raw_aware_below_offset_keeps_window_semantics_while_primary_uses_raw() {
  const raw = "0.21";
  const step = Math.fround(Number(raw));
  const expectedTargetStep = Math.fround(Number(raw) - 0.0000001);
  const rawAwareSpec = targetWindowSpecForTest({
    inputStep: step,
    inputRaw: raw,
    approachMode: "below",
    wearOffsetPct: 1
  });
  const result = await runSelect({
    rows: makeUniformStepRows({
      prefix: "raw-offset-lower",
      name: "Raw Offset Lower",
      relative: rawAwareSpec.lowerTargetStep
    }),
    targetWear: step,
    targetWearRaw: raw,
    wearApproachMode: "below",
    wearOffsetPct: 1,
    materials: [
      uniformStepMaterial("Raw Offset Lower")
    ]
  });

  assert.equal(rawAwareSpec.targetStep, expectedTargetStep);
  assert.equal(rawAwareSpec.lowerTargetStep < rawAwareSpec.targetStep, true);
  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), rawAwareSpec.lowerTargetStep);
}

async function test_raw_aware_below_offset_keeps_final_quantized_result_at_or_below_primary_target() {
  const raw = "0.27";
  const step = Math.fround(Number(raw));
  const rawAwareSpec = targetWindowSpecForTest({
    inputStep: step,
    inputRaw: raw,
    approachMode: "below",
    wearOffsetPct: 1
  });
  const upperSideStep = prevFloat32(step);
  const result = await runSelect({
    rows: [
      ...makeUniformStepRows({
        prefix: "raw-offset-lower-window",
        name: "Raw Offset Window",
        relative: rawAwareSpec.lowerTargetStep
      }),
      ...makeUniformStepRows({
        prefix: "raw-offset-upper-window",
        name: "Raw Offset Window",
        relative: upperSideStep
      })
    ],
    targetWear: step,
    targetWearRaw: raw,
    wearApproachMode: "below",
    wearOffsetPct: 1,
    materials: [
      uniformStepMaterial("Raw Offset Window")
    ]
  });

  assert.equal(step > Number(raw), true);
  assert.equal(upperSideStep > rawAwareSpec.targetStep, true);
  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall) <= rawAwareSpec.targetStep, true);
  assert.notEqual(Math.fround(result.overall), upperSideStep, "final quantized result should not stay on upper-side step");
}

async function test_step_target_zero_offset_accepts_any_result_under_original_target() {
  const q = Math.fround(0.5);
  const targetStep = resolveCraftAssistTargetStepSpec({
    inputStep: q,
    approachMode: "below",
    offsetValue: 0
  }).targetStep;
  const lowerStep = prevFloat32(targetStep);
  const rows = [];
  for (let index = 1; index <= 10; index += 1) {
    rows.push(makeRow({id: `offset-primary-${index}`, name: "Primary Step", relative: targetStep}));
    rows.push(makeRow({id: `offset-lower-${index}`, name: "Lower Step", relative: lowerStep}));
  }
  const materials = [
    {name: "Lower Step", names: ["Lower Step"], role: "main", count: 10, wear_min: 0, wear_max: 1}
  ];

  const noOffset = await runSelect({
    rows,
    targetWear: q,
    wearApproachMode: "below",
    wearOffsetPct: 0,
    materials
  });
  const primaryOnly = await runSelect({
    rows,
    targetWear: q,
    wearApproachMode: "below",
    wearOffsetPct: 0,
    materials: [
      {name: "Primary Step", names: ["Primary Step"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(noOffset.ok, true);
  assert.equal(Math.fround(noOffset.overall), lowerStep);
  assert.equal(primaryOnly.ok, true);
  assert.equal(Math.fround(primaryOnly.overall), targetStep);
}

async function test_step_target_below_zero_offset_fast_public_flow_accepts_lower_off_step_result() {
  const q = Math.fround(0.5);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep: q,
    approachMode: "below",
    offsetValue: 0
  });
  const lowerOffStep = prevFloat32(targetStepSpec.targetStep);
  const rows = [];
  for (let index = 1; index <= 10; index += 1) {
    rows.push(makeRow({id: `fallback-lower-${index}`, name: "Fallback Lower", relative: lowerOffStep}));
  }
  for (let index = 1; index <= 40; index += 1) {
    rows.push(makeRow({
      id: `fallback-high-${index}`,
      name: "Fallback Lower",
      relative: 0.8 + index * 0.0001
    }));
  }

  await withEnv({
    ENABLE_OVERSIZED_PREFILTER: "1",
    OVERSIZED_2_SHARDS_THRESHOLD: "10",
    OVERSIZED_4_SHARDS_THRESHOLD: "999",
    SHARD_TOP_K: "10",
    SHARD_EDGE_KEEP_PER_SIDE: "0",
    EXPAND_SHARD_TOP_K: "10",
    EXPAND_SHARD_EDGE_KEEP_PER_SIDE: "0",
    SHARD_CENTER_OVERLAP_MIN: "1",
    SHARD_CENTER_OVERLAP_MAX: "1",
    SHORTLIST_MIN: "10",
    SHORTLIST_PER_REQUIRED: "1",
    SHORTLIST_HARD_MAX: "20"
  }, async () => {
    const result = await runSelect({
      rows,
      targetWear: q,
      wearApproachMode: "below",
      wearOffsetPct: 0,
      enableFastCraftAssist: true,
      materials: [
        {name: "Fallback Lower", names: ["Fallback Lower"], role: "main", count: 10, wear_min: 0, wear_max: 1}
      ]
    });

    assert.equal(result.ok, true);
    assert.equal(Math.fround(result.overall), lowerOffStep);
    assert.equal(lowerOffStep < targetStepSpec.targetStep, true);
    assert.equal(result.overall < q, true);
    assert.equal(rawPickedIds(result).every((id) => String(id).startsWith("fallback-lower-")), true);
  });
}

async function test_step_target_below_offset_accepts_lower_allowed_step_when_primary_unavailable() {
  const q = Math.fround(0.5);
  const spec = targetWindowSpecForTest({
    inputStep: q,
    approachMode: "below",
    wearOffsetPct: 1
  });
  const rows = [];
  for (let index = 1; index <= 10; index += 1) {
    rows.push(makeRow({id: `lower-allowed-${index}`, name: "Lower Allowed", relative: spec.lowerTargetStep}));
  }
  const result = await runSelect({
    rows,
    targetWear: q,
    wearApproachMode: "below",
    wearOffsetPct: 1,
    materials: [
      {name: "Lower Allowed", names: ["Lower Allowed"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), spec.lowerTargetStep);
}

async function test_step_target_below_offset_rejects_result_below_lower_boundary() {
  const q = Math.fround(0.5);
  const spec = targetWindowSpecForTest({
    inputStep: q,
    approachMode: "below",
    wearOffsetPct: 1
  });
  const belowWindowStep = prevFloat32(spec.lowerTargetStep);
  const rows = [];
  for (let index = 1; index <= 10; index += 1) {
    rows.push(makeRow({id: `below-window-${index}`, name: "Below Window", relative: belowWindowStep}));
  }
  const result = await runSelect({
    rows,
    targetWear: q,
    wearApproachMode: "below",
    wearOffsetPct: 1,
    materials: [
      {name: "Below Window", names: ["Below Window"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "overall_not_below_target");

  const finalValidation = __test.validateCraftAssistFinalOverall({
    overall: belowWindowStep,
    targetValue: q,
    searchTargetValue: spec.targetStep,
    approachMode: "below",
    targetStepSpec: spec
  });
  assert.equal(finalValidation.ok, false);
  assert.equal(finalValidation.code, "final_result_not_on_target_step");
  assert.equal(finalValidation.target_step, spec.targetStep);
  assert.equal(finalValidation.lower_target_step, spec.lowerTargetStep);
  assert.equal(finalValidation.upper_target_step, spec.upperTargetStep);
  assert.equal(finalValidation.quantized_overall, Math.fround(belowWindowStep));
}

async function test_step_target_infinite_offset_accepts_higher_side_step_when_input_and_lower_unavailable() {
  const q = Math.fround(0.5);
  const spec = targetWindowSpecForTest({
    inputStep: q,
    approachMode: "infinite",
    wearOffsetPct: 1
  });
  const rows = [];
  for (let index = 1; index <= 10; index += 1) {
    rows.push(makeRow({id: `higher-allowed-${index}`, name: "Higher Allowed", relative: spec.upperTargetStep}));
  }
  const result = await runSelect({
    rows,
    targetWear: q,
    wearApproachMode: "infinite",
    wearOffsetPct: 1,
    materials: [
      {name: "Higher Allowed", names: ["Higher Allowed"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), spec.upperTargetStep);
}

async function test_step_target_below_offset_keeps_non_primary_hit_as_fallback_across_rarities() {
  const q = Math.fround(0.5);
  const spec = targetWindowSpecForTest({
    inputStep: q,
    approachMode: "below",
    wearOffsetPct: 1
  });
  const rows = [];
  for (let index = 1; index <= 10; index += 1) {
    rows.push(makeRow({
      id: `lower-fallback-${index}`,
      name: "Window Candidate",
      relative: spec.lowerTargetStep,
      rarity: 3
    }));
    rows.push(makeRow({
      id: `primary-preferred-${index}`,
      name: "Window Candidate",
      relative: spec.targetStep,
      rarity: 4
    }));
  }

  const result = await runSelect({
    rows,
    targetWear: q,
    wearApproachMode: "below",
    wearOffsetPct: 1,
    materials: [
      {name: "Window Candidate", names: ["Window Candidate"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Math.fround(result.overall), spec.targetStep);
  assert.equal(rawPickedIds(result).every((id) => String(id).startsWith("primary-preferred-")), true);
}

async function test_step_target_context_refine_can_promote_non_primary_window_hit_to_primary_step() {
  const q = Math.fround(0.5);
  const spec = targetWindowSpecForTest({
    inputStep: q,
    approachMode: "infinite",
    wearOffsetPct: 1
  });
  const lowerSelected = [];
  const groups = [0, 1].map((groupIndex) => {
    const lowerCandidates = [];
    const primaryCandidates = [];
    for (let index = 0; index < 5; index += 1) {
      const lower = {
        id: `refine-g${groupIndex}-lower-${index}`,
        value: spec.lowerTargetStep,
        row: makeRow({
          id: `refine-g${groupIndex}-lower-${index}`,
          name: `Refine ${groupIndex}`,
          relative: spec.lowerTargetStep
        })
      };
      lowerCandidates.push(lower);
      lowerSelected.push(lower);
      primaryCandidates.push({
        id: `refine-g${groupIndex}-primary-${index}`,
        value: spec.targetStep,
        row: makeRow({
          id: `refine-g${groupIndex}-primary-${index}`,
          name: `Refine ${groupIndex}`,
          relative: spec.targetStep
        })
      });
    }
    const filler = [];
    for (let index = 0; index < 20; index += 1) {
      filler.push({
        id: `refine-g${groupIndex}-filler-${index}`,
        value: spec.lowerTargetStep,
        row: makeRow({
          id: `refine-g${groupIndex}-filler-${index}`,
          name: `Refine ${groupIndex}`,
          relative: spec.lowerTargetStep
        })
      });
    }
    return {
      index: groupIndex,
      material: {name: `Refine ${groupIndex}`, role: groupIndex === 0 ? "main" : "aux", count: 5},
      candidates: lowerCandidates.concat(primaryCandidates, filler)
    };
  });
  const initialSolved = {
    materialResults: groups.map((group, groupIndex) => ({
      material: group.material,
      selected: lowerSelected.slice(groupIndex * 5, groupIndex * 5 + 5)
    })),
    overall: spec.lowerTargetStep,
    scoreTuple: [1, spec.targetStep - spec.lowerTargetStep, spec.lowerTargetStep]
  };

  const refined = __test.runCraftAssistContextRefine({
    groups,
    targetValue: spec.targetStep,
    initialSolved,
    approachMode: "infinite",
    targetStepSpec: spec,
    prefilterOptions: {
      enableOversizedPrefilter: true,
      oversized2ShardsThreshold: 20,
      oversized4ShardsThreshold: 999
    }
  });

  assert.equal(Math.fround(initialSolved.overall), spec.lowerTargetStep);
  assert.equal(Math.fround(refined.solved.overall), spec.targetStep);
  assert.equal(refined.summary.entered, true);
  assert.equal(refined.summary.acceptedCount > 0, true);
}

async function test_final_validation_blocks_below_mode_when_result_crosses_original_target() {
  const result = __test.validateCraftAssistFinalOverall({
    overall: 0.27000001072883606,
    targetValue: 0.27,
    searchTargetValue: 0.26999998,
    approachMode: "below"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "final_result_exceeds_target");
  assert.equal(result.overall, 0.27000001072883606);
}

async function test_final_validation_below_raw_rejects_normalized_overall_between_conservative_and_original_target() {
  const rawTarget = 0.21;
  const conservativeTarget = rawTarget - 0.0000001;
  const normalizedOverall = 0.20999995;
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep: Math.fround(rawTarget),
    inputRaw: rawTarget,
    approachMode: "below"
  });

  assert.equal(normalizedOverall < rawTarget, true);
  assert.equal(normalizedOverall > conservativeTarget, true);

  const result = __test.validateCraftAssistFinalOverall({
    overall: normalizedOverall,
    targetValue: rawTarget,
    searchTargetValue: conservativeTarget,
    targetStepSpec,
    approachMode: "below"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "final_result_not_on_target_step");
  assert.equal(result.quantized_overall, Math.fround(normalizedOverall));
  assert.equal(result.target_step, targetStepSpec.targetStep);
}

async function test_final_validation_skips_infinite_mode_cross_target_guard() {
  const result = __test.validateCraftAssistFinalOverall({
    overall: 0.27000001072883606,
    targetValue: 0.27,
    searchTargetValue: 0.26999998,
    approachMode: "infinite"
  });

  assert.deepEqual(result, {ok: true});
}

async function test_failure_log_text_includes_final_validation_diagnostics() {
  const text = __test.buildCraftAssistFailureLogText({
    code: "final_result_exceeds_target",
    overall: 0.27000001072883606,
    target: 0.27,
    safe_target: 0.26999998,
    approach_mode: "below",
    item_ids: ["a1", "a2", "a3"],
    selected_items: [
      {
        asset_id: "a1",
        name: "AK-47 | Redline",
        absolute_wear: "0.123456",
        relative_wear: "0.234567"
      },
      {
        asset_id: "a2",
        name: "M4A4 | Buzz Kill",
        absolute_wear: "0.223344",
        relative_wear: "0.255566"
      }
    ]
  });

  assert.match(text, /code=final_result_exceeds_target/);
  assert.match(text, /overall=0\.270000/);
  assert.match(text, /target=0\.270000/);
  assert.match(text, /safe_target=0\.269999/);
  assert.match(text, /approach_mode=below/);
  assert.match(text, /item_ids=a1,a2,a3/);
  assert.match(text, /selected_items=\[\{"asset_id":"a1","name":"AK-47 \| Redline","absolute_wear":"0\.123456","relative_wear":"0\.234567"\},\{"asset_id":"a2","name":"M4A4 \| Buzz Kill","absolute_wear":"0\.223344","relative_wear":"0\.255566"\}\]/);
}

(async () => {
  await test_step_target_below_searches_previous_float32_step();
  await test_step_target_infinite_accepts_raw_mean_on_target_float32_step();
  await test_step_target_rejects_non_float32_target();
  await test_step_target_rejects_below_zero_target();
  await test_step_target_final_validation_allows_below_result_under_original_target();
  await test_step_target_final_validation_failure_log_includes_window_diagnostics();
  await test_raw_aware_below_uses_one_tenth_micro_lower_target_when_float32_step_is_below_raw();
  await test_raw_aware_below_uses_one_tenth_micro_lower_target_when_float32_step_is_above_raw();
  await test_raw_aware_below_exact_step_raw_uses_one_tenth_micro_lower_target();
  await test_raw_aware_below_at_or_below_one_tenth_micro_raw_rejects_unreachable_target();
  await test_raw_aware_infinite_uses_input_step();
  await test_service_target_step_log_keeps_raw_input_text_separate_from_machine_step();
  await test_legacy_below_without_raw_keeps_step_only_previous_step_behavior();
  await test_raw_aware_below_offset_keeps_window_semantics_while_primary_uses_raw();
  await test_raw_aware_below_offset_keeps_final_quantized_result_at_or_below_primary_target();
  await test_step_target_zero_offset_accepts_any_result_under_original_target();
  await test_step_target_below_zero_offset_fast_public_flow_accepts_lower_off_step_result();
  await test_step_target_below_offset_accepts_lower_allowed_step_when_primary_unavailable();
  await test_step_target_below_offset_rejects_result_below_lower_boundary();
  await test_step_target_infinite_offset_accepts_higher_side_step_when_input_and_lower_unavailable();
  await test_step_target_below_offset_keeps_non_primary_hit_as_fallback_across_rarities();
  await test_step_target_context_refine_can_promote_non_primary_window_hit_to_primary_step();
  await test_step_target_below_without_offset_candidate_accepts_any_result_under_original_target();
  await test_over_target_prefers_squeezing_aux_before_main();
  await test_under_target_prioritizes_closer_overall_before_aux_low_bias();
  await test_under_target_allows_above_slot_target_when_it_is_the_only_legal_raise();
  await test_all_main_items_use_single_side_branch();
  await test_under_target_never_uses_candidate_that_pushes_overall_across_target();
  await test_single_material_falls_back_when_balanced_split_side_is_short();
  await test_single_material_non_unit_interval_still_uses_relative_centering();
  await test_single_material_returns_step_target_selection();
  await test_infinite_mode_allows_cross_target_when_it_is_closer();
  await test_single_material_starts_with_balanced_split_then_pushes_upward();
  await test_single_material_applies_compensation_refinement_after_push_limit();
  await test_single_material_accepts_step_target_near_target_edge_without_margin();
  await test_multi_material_allows_cross_side_compensation_for_closer_overall();
  await test_multi_material_allows_cross_side_fill_when_preferred_side_is_short();
  await test_multi_material_returns_step_target_selection_without_legacy_trace();
  await test_prebuilt_selection_context_matches_direct_selection_even_with_blocked_ids();
  await test_candidate_rows_sibling_rebuilds_stale_selection_context_even_when_asset_ids_match();
  await test_service_rebuilds_cached_context_when_rows_mutate_in_place();
  await test_quantity_shortfall_returns_cooling_filtered_code_when_only_cooling_items_fill_gap();
  await test_quantity_shortfall_returns_blocked_code_when_only_blocked_items_fill_gap();
  await test_fast_flag_true_returns_after_expand_step_hit();
  await test_fast_flag_false_forces_old_logic_even_when_env_enabled();
  await test_fast_flag_true_enables_single_material_raw_below_top_k_fast_path();
  await test_fast_flag_false_keeps_single_material_raw_below_top_k_fast_path_disabled();
  await test_fast_flag_true_raw_below_top_k_falls_back_when_offset_window_exists();
  await test_fast_flag_true_raw_below_top_k_falls_back_when_any_candidate_reaches_raw_ceiling();
  await test_seed_relay_short_circuits_single_material_when_seed_proves_no_raw_solution();
  await test_seed_relay_short_circuits_dual_material_when_seed_proves_no_raw_solution();
  await test_seed_hit_attaches_seed_trace_on_single_material_success();
  await test_seed_hit_keeps_target_step_handling_in_baseline();
  await test_target_step_without_prefilter_does_not_rerun_full_baseline();
  await test_service_passes_existing_wear_offset_as_search_entry_window();
  await test_service_treats_wear_offset_as_fixed_value();
  await test_target_step_rarity_full_prefilter_fallback_does_not_rerun_full_baseline();
  await test_target_step_base_window_hit_still_keeps_outer_full_fallback();
  await test_target_step_expand_window_hit_still_keeps_outer_full_fallback();
  await test_step_target_fast_expands_after_base_window_miss_and_stops_on_expand_window_hit();
  await test_step_target_prefilter_window_hit_stops_before_expand_when_best_is_not_primary();
  await test_step_target_solved_candidate_requires_exact_target_step_even_in_infinite_mode();
  await test_step_target_fast_base_hit_returns_before_expand_and_context_refine();
  await test_step_target_fast_base_window_hit_returns_before_expand_after_batch();
  await test_item_level_material_items_support_mixed_relative_absolute_filters_and_preserve_candidate_ordering();
  await test_prefilter_trace_uses_primary_name_projection_for_multi_item_materials();
  await test_duplicate_names_across_materials_fail_after_canonicalize_reduces_total_count();
  await test_zero_count_auxiliary_material_is_inactive();
  await test_catalog_market_name_matches_localized_inventory_rows();
  await test_final_validation_blocks_below_mode_when_result_crosses_original_target();
  await test_final_validation_below_raw_rejects_normalized_overall_between_conservative_and_original_target();
  await test_final_validation_skips_infinite_mode_cross_target_guard();
  await test_failure_log_text_includes_final_validation_diagnostics();
  console.log("craftAssistService tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
