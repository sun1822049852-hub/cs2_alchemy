const assert = require("node:assert/strict");

const {
  refineSingleMaterialCompensation,
  searchCraftAssistBestSolution,
  searchRoleAwarePushSolution
} = require("../node_sidecar/src/services/craftAssistSearch");

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

function traceStages(result) {
  return (Array.isArray(result && result.trace && result.trace.steps) ? result.trace.steps : [])
    .map((step) => String(step && step.stage || ""));
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

test_role_aware_push_slides_aux_window_down_when_over_target();
test_role_aware_push_slides_main_window_up_when_under_target();
test_role_aware_push_prefers_closer_aux_raise_when_main_raise_would_block_it();
test_role_aware_push_returns_selection_trace();
test_role_aware_push_applies_aux_compensation_refinement();
test_single_material_compensation_chooses_closest_global_second_swap();
test_single_material_compensation_exposes_second_swap_pruning_trace();
test_search_best_solution_infinite_mode_can_cross_target_for_closer_single_material_match();
console.log("craftAssistSearch tests passed");
