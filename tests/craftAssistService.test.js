const assert = require("node:assert/strict");

const {
  selectCraftAssistForRecipe,
  buildCraftAssistSelectionContext
} = require("../node_sidecar/src/services/craftAssistService");

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

function runSelect({rows, targetWear, materials, ...extraArgs}) {
  return selectCraftAssistForRecipe({
    rows,
    targetWear,
    wearFilterMode: "relative",
    materials,
    blockedIds: [],
    includeCooling: false,
    wearOffsetPct: 100,
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
    wearOffsetPct: 100,
    ...extraArgs
  });
}

function pickedIds(result) {
  return Array.isArray(result && result.item_ids) ? [...result.item_ids].sort() : [];
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
    targetWear: 0.52,
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 5, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 5, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.overall < 0.52, true);
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
    targetWear: 0.169,
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 9, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 1, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.overall < 0.169, true);
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
    targetWear: 0.169,
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 9, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 1, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.overall < 0.169, true);
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
    targetWear: 0.20,
    materials: [
      {name: "Solo", names: ["Solo"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.overall < 0.20, true);
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
    targetWear: 0.169,
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 9, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 1, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.overall < 0.169, true);
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
    targetWear: 0.2142,
    materials: [
      {name: "Solo", names: ["Solo"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.overall < 0.2142, true);
  assert.equal(result.selection_trace.steps[0].belowCount, 7);
  assert.equal(result.selection_trace.steps[0].aboveCount, 3);
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
    targetWear: 0.29,
    materials: [
      {name: "Shifted", names: ["Shifted"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.overall < 0.29, true);
  assert.equal(pickedIds(result).includes("r11"), true);
  assert.equal(pickedIds(result).includes("r1"), false);
}

async function test_single_material_returns_selection_trace() {
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
    targetWear: 0.2142,
    materials: [
      {name: "Solo", names: ["Solo"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Array.isArray(result.selection_trace && result.selection_trace.steps), true);
  assert.equal(result.selection_trace.steps[0].stage, "initial");
  assert.equal(result.selection_trace.steps[result.selection_trace.steps.length - 1].stage, "final");
  assert.deepEqual(
    result.selection_trace.steps[result.selection_trace.steps.length - 1].selectedIds,
    pickedIds(result)
  );
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
    targetWear: 0.50,
    materials
  });
  const infinite = await runSelect({
    rows,
    targetWear: 0.50,
    materials,
    wearApproachMode: "infinite"
  });

  assert.equal(belowOnly.ok, true);
  assert.equal(infinite.ok, true);
  assert.equal(belowOnly.overall < 0.50, true);
  assert.equal(infinite.overall > 0.50, true);
  assert.equal(belowOnly.item_ids.includes("u5"), true);
  assert.equal(belowOnly.item_ids.includes("u1"), false);
  assert.equal(infinite.item_ids.includes("u5"), false);
  assert.equal(infinite.item_ids.includes("u1"), true);
  assert.equal(Math.abs(infinite.overall - 0.50) < Math.abs(belowOnly.overall - 0.50), true);
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
    targetWear: 0.2142,
    materials: [
      {name: "Solo", names: ["Solo"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.overall < 0.2142, true);
  assert.equal(result.item_ids.includes("a7"), true);
  assert.equal(result.item_ids.includes("a1"), false);
  assert.equal(result.selection_trace.steps[0].belowCount, 5);
  assert.equal(result.selection_trace.steps[0].aboveCount, 5);
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
    targetWear: 0.2142,
    materials: [
      {name: "Solo", names: ["Solo"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.overall < 0.2142, true);
  assert.equal(Math.abs(result.overall - 0.2141963) < 1e-6, true);
  assert.equal(result.item_ids.includes("a1"), true);
  assert.equal(result.item_ids.includes("b6"), true);
  assert.equal(result.item_ids.includes("b1"), false);
  assert.equal(result.selection_trace.steps.some((step) => step.stage === "refine_compensate"), true);
  const refineStep = result.selection_trace.steps.find((step) => step.stage === "refine_compensate");
  assert.equal(!!(refineStep && refineStep.debug), true);
  assert.equal(Array.isArray(refineStep.debug.firstSwapAttempts), true);
  assert.equal(refineStep.debug.firstSwapAttempts.length > 0, true);
}

async function test_single_material_keeps_hard_relative_cap_margin_near_target_edge() {
  const rows = [];
  for (let i = 1; i <= 9; i += 1) {
    rows.push(makeRow({id: `e${i}`, name: "Solo", relative: 0.27}));
  }
  rows.push(makeRow({id: "tight", name: "Solo", relative: 0.2699999}));
  rows.push(makeRow({id: "safe", name: "Solo", relative: 0.2699997}));

  const result = await runSelect({
    rows,
    targetWear: 0.27,
    materials: [
      {name: "Solo", names: ["Solo"], role: "main", count: 10, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.overall < 0.26999998, true);
  assert.equal(result.item_ids.includes("safe"), true);
  assert.equal(result.item_ids.includes("tight"), false);
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
    targetWear: 0.2142,
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 5, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 5, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.overall < 0.2142, true);
  assert.equal(0.2142 - result.overall < 0.002, true);
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
    targetWear: 0.2142,
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 3, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 7, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.overall < 0.2142, true);
  assert.equal(pickedIds(result).includes("a6"), true);
  assert.equal(pickedIds(result).includes("a7"), true);
}

async function test_multi_material_returns_selection_trace() {
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
    targetWear: 0.21,
    materials: [
      {name: "Main", names: ["Main"], role: "main", count: 2, wear_min: 0, wear_max: 1},
      {name: "Aux", names: ["Aux"], role: "aux", count: 8, wear_min: 0, wear_max: 1}
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(Array.isArray(result.selection_trace && result.selection_trace.steps), true);
  assert.equal(result.selection_trace.steps[0].stage, "initial");
  assert.equal(result.selection_trace.steps[result.selection_trace.steps.length - 1].stage, "final");
  assert.deepEqual(
    result.selection_trace.steps[result.selection_trace.steps.length - 1].selectedIds,
    pickedIds(result)
  );
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
    targetWear: 0.21,
    wearFilterMode: "relative",
    materials,
    blockedIds,
    includeCooling: false,
    wearOffsetPct: 100
  });
  const selectionContext = buildCraftAssistSelectionContext({rows, includeCooling: false});
  const cached = await runSelectWithContext({
    selectionContext,
    targetWear: 0.21,
    materials,
    blockedIds
  });

  assert.equal(direct.ok, true);
  assert.equal(cached.ok, true);
  assert.deepEqual(pickedIds(cached), pickedIds(direct));
  assert.equal(cached.overall, direct.overall);
  assert.equal(cached.rarity, direct.rarity);
  assert.deepEqual(cached.selection_trace, direct.selection_trace);
}

async function test_fast_flag_true_runs_expand_correction_before_returning() {
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
      targetWear: 0.21,
      enableFastCraftAssist: false,
      materials
    });
    const fast = await runSelect({
      rows,
      targetWear: 0.21,
      enableFastCraftAssist: true,
      materials
    });

    assert.equal(slow.ok, true);
    assert.equal(fast.ok, true);
    assert.equal(slow.overall < 0.21, true);
    assert.equal(fast.overall, slow.overall);
    assert.deepEqual(pickedIds(fast), pickedIds(slow));
    assert.equal(!!(fast.selection_trace && fast.selection_trace.prefilter), true);
    assert.equal(fast.selection_trace.prefilter.retryMode, "expand");
    assert.equal(Array.isArray(fast.selection_trace.prefilter.phases), true);
    assert.equal(fast.selection_trace.prefilter.phases.length, 2);
    assert.deepEqual(
      fast.selection_trace.prefilter.phases.map((phase) => phase.phaseName),
      ["prefilter/base", "prefilter/expand"]
    );
    assert.deepEqual(fast.selection_trace.prefilter.phases[0].prefilteredIndexes, [1]);
    assert.deepEqual(fast.selection_trace.prefilter.phases[1].prefilteredIndexes, [1]);
    assert.equal(fast.selection_trace.prefilter.phases[0].groups[0].candidateCountBefore, 60);
    assert.equal(fast.selection_trace.prefilter.phases[0].groups[0].candidateCountAfter <= 80, true);
    assert.equal(
      fast.selection_trace.prefilter.phases[1].groups[0].candidateCountAfter
      > fast.selection_trace.prefilter.phases[0].groups[0].candidateCountAfter,
      true
    );
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
      targetWear: 0.21,
      enableFastCraftAssist: false,
      materials: [
        {name: "Main", names: ["Main"], role: "main", count: 2, wear_min: 0, wear_max: 1},
        {name: "Aux", names: ["Aux"], role: "aux", count: 8, wear_min: 0, wear_max: 1}
      ]
    });

    assert.equal(result.ok, true);
    assert.equal(result.overall < 0.21, true);
    assert.equal(!!(result.selection_trace && result.selection_trace.prefilter), false);
  });
}

async function test_fast_flag_runs_context_refine_after_expand_improves_multi_oversized_groups() {
  const rows = makeContextRefineRows();
  await withEnv({
    ENABLE_OVERSIZED_PREFILTER: "1",
    OVERSIZED_2_SHARDS_THRESHOLD: "20",
    OVERSIZED_4_SHARDS_THRESHOLD: "999",
    SHARD_TOP_K: "18",
    SHARD_EDGE_KEEP_PER_SIDE: "2",
    EXPAND_SHARD_TOP_K: "28",
    EXPAND_SHARD_EDGE_KEEP_PER_SIDE: "4",
    SHORTLIST_MIN: "22",
    SHORTLIST_PER_REQUIRED: "4",
    SHORTLIST_HARD_MAX: "64"
  }, async () => {
    const materials = [
      {name: "Main", names: ["Main"], role: "main", count: 2, wear_min: 0, wear_max: 1},
      {name: "AuxA", names: ["AuxA"], role: "aux", count: 4, wear_min: 0, wear_max: 1},
      {name: "AuxB", names: ["AuxB"], role: "aux", count: 4, wear_min: 0, wear_max: 1}
    ];
    const slow = await runSelect({
      rows,
      targetWear: 0.2142,
      enableFastCraftAssist: false,
      materials
    });
    const fast = await runSelect({
      rows,
      targetWear: 0.2142,
      enableFastCraftAssist: true,
      materials
    });

    assert.equal(slow.ok, true);
    assert.equal(fast.ok, true);
    assert.equal(slow.overall > fast.overall, false);
    assert.equal(Math.abs(fast.overall - slow.overall) < 1e-12, true);
    assert.equal(!!(fast.selection_trace && fast.selection_trace.prefilter), true);
    assert.equal(!!(fast.selection_trace.prefilter && fast.selection_trace.prefilter.contextRefine), true);
    assert.equal(fast.selection_trace.prefilter.contextRefine.entered, true);
    assert.equal(fast.selection_trace.prefilter.contextRefine.rounds.length, 1);
    assert.equal(fast.selection_trace.prefilter.contextRefine.rounds[0].attempts.length, 2);
    assert.equal(fast.selection_trace.prefilter.contextRefine.acceptedCount >= 1, true);
  });
}

(async () => {
  await test_over_target_prefers_squeezing_aux_before_main();
  await test_under_target_prioritizes_closer_overall_before_aux_low_bias();
  await test_under_target_allows_above_slot_target_when_it_is_the_only_legal_raise();
  await test_all_main_items_use_single_side_branch();
  await test_under_target_never_uses_candidate_that_pushes_overall_across_target();
  await test_single_material_falls_back_when_balanced_split_side_is_short();
  await test_single_material_non_unit_interval_still_uses_relative_centering();
  await test_single_material_returns_selection_trace();
  await test_infinite_mode_allows_cross_target_when_it_is_closer();
  await test_single_material_starts_with_balanced_split_then_pushes_upward();
  await test_single_material_applies_compensation_refinement_after_push_limit();
  await test_single_material_keeps_hard_relative_cap_margin_near_target_edge();
  await test_multi_material_allows_cross_side_compensation_for_closer_overall();
  await test_multi_material_allows_cross_side_fill_when_preferred_side_is_short();
  await test_multi_material_returns_selection_trace();
  await test_prebuilt_selection_context_matches_direct_selection_even_with_blocked_ids();
  await test_fast_flag_true_runs_expand_correction_before_returning();
  await test_fast_flag_false_forces_old_logic_even_when_env_enabled();
  await test_fast_flag_runs_context_refine_after_expand_improves_multi_oversized_groups();
  console.log("craftAssistService tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
