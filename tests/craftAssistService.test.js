const assert = require("node:assert/strict");

const {selectCraftAssistForRecipe} = require("../node_sidecar/src/services/craftAssistService");

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

function runSelect({rows, targetWear, materials}) {
  return selectCraftAssistForRecipe({
    rows,
    targetWear,
    wearFilterMode: "relative",
    materials,
    blockedIds: [],
    includeCooling: false,
    wearOffsetPct: 100
  });
}

function pickedIds(result) {
  return Array.isArray(result && result.item_ids) ? [...result.item_ids].sort() : [];
}

function test_over_target_prefers_squeezing_aux_before_main() {
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
  const result = runSelect({
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

function test_under_target_prioritizes_closer_overall_before_aux_low_bias() {
  const rows = [];
  for (let i = 1; i <= 9; i += 1) {
    rows.push(makeRow({id: `m${i}`, name: "Main", relative: 0.13}));
  }
  rows.push(makeRow({id: "a1", name: "Aux", relative: 0.02}));
  rows.push(makeRow({id: "a2", name: "Aux", relative: 0.06}));
  rows.push(makeRow({id: "a3", name: "Aux", relative: 0.09}));

  const result = runSelect({
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

function test_under_target_allows_above_slot_target_when_it_is_the_only_legal_raise() {
  const rows = [];
  for (let i = 1; i <= 9; i += 1) {
    rows.push(makeRow({id: `m${i}`, name: "Main", relative: 0.13}));
  }
  rows.push(makeRow({id: "a1", name: "Aux", relative: 0.02}));
  rows.push(makeRow({id: "a3", name: "Aux", relative: 0.09}));

  const result = runSelect({
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

function test_all_main_items_use_single_side_branch() {
  const rows = [];
  for (let i = 1; i <= 10; i += 1) {
    rows.push(makeRow({id: `s${i}`, name: "Solo", relative: 0.01}));
  }
  rows.push(makeRow({id: "s11", name: "Solo", relative: 0.09}));

  const result = runSelect({
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

function test_under_target_never_uses_candidate_that_pushes_overall_across_target() {
  const rows = [];
  for (let i = 1; i <= 9; i += 1) {
    rows.push(makeRow({id: `m${i}`, name: "Main", relative: 0.16}));
  }
  rows.push(makeRow({id: "a1", name: "Aux", relative: 0.02}));
  rows.push(makeRow({id: "a2", name: "Aux", relative: 0.90}));

  const result = runSelect({
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

function test_single_material_falls_back_when_balanced_split_side_is_short() {
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

  const result = runSelect({
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

function test_single_material_non_unit_interval_still_uses_relative_centering() {
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

  const result = runSelect({
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

function test_single_material_returns_selection_trace() {
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

  const result = runSelect({
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

function test_single_material_starts_with_balanced_split_then_pushes_upward() {
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

  const result = runSelect({
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

function test_multi_material_allows_cross_side_compensation_for_closer_overall() {
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

  const result = runSelect({
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

function test_multi_material_allows_cross_side_fill_when_preferred_side_is_short() {
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

  const result = runSelect({
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

function test_multi_material_returns_selection_trace() {
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

  const result = runSelect({
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

test_over_target_prefers_squeezing_aux_before_main();
test_under_target_prioritizes_closer_overall_before_aux_low_bias();
test_under_target_allows_above_slot_target_when_it_is_the_only_legal_raise();
test_all_main_items_use_single_side_branch();
test_under_target_never_uses_candidate_that_pushes_overall_across_target();
test_single_material_falls_back_when_balanced_split_side_is_short();
test_single_material_non_unit_interval_still_uses_relative_centering();
test_single_material_returns_selection_trace();
test_single_material_starts_with_balanced_split_then_pushes_upward();
test_multi_material_allows_cross_side_compensation_for_closer_overall();
test_multi_material_allows_cross_side_fill_when_preferred_side_is_short();
test_multi_material_returns_selection_trace();
console.log("craftAssistService tests passed");
