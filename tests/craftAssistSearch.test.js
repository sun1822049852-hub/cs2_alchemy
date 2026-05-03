const assert = require("node:assert/strict");

const {
  refineRoleAwareMaterialResults,
  refineSingleMaterialCompensation,
  searchCraftAssistBestSolution,
  searchRoleAwarePushSolution
} = require("../node_sidecar/src/services/craftAssistSearch");
const {
  prevFloat32,
  resolveCraftAssistTargetStepSpec
} = require("../node_sidecar/src/services/craftAssistFloat32Step");

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

function test_search_raw_aware_below_prefers_primary_target_step_from_target_step_spec() {
  const raw = 0.21;
  const inputStep = Math.fround(raw);
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

  assert.equal(targetStepSpec.targetStep, inputStep);

  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
    targetStepSpec
  });

  assert.equal(!!result, true);
  assert.equal(Math.fround(result.overall), targetStepSpec.targetStep);
  assert.equal(pickedIds(result).every((id) => id.startsWith("target-")), true);
}

function test_search_raw_aware_offset_window_uses_target_step_spec_without_raw_parsing() {
  const raw = 0.21;
  const inputStep = Math.fround(raw);
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

  assert.equal(targetStepSpec.targetStep, inputStep);
  assert.equal(targetStepSpec.lowerTargetStep < targetStepSpec.targetStep, true);

  const result = searchCraftAssistBestSolution({
    groups,
    targetValue: inputStep,
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
  const closerFallback = 0.21428491771221161;
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
  assert.equal(closerFallback < Number(raw), true);
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
test_single_material_compensation_chooses_closest_global_second_swap();
test_single_material_compensation_exposes_second_swap_pruning_trace();
test_search_best_solution_infinite_mode_can_cross_target_for_closer_single_material_match();
test_search_step_target_below_uses_previous_float32_step();
test_search_offset_window_prefers_primary_below_step_over_lower_allowed_step();
test_search_offset_window_returns_lower_allowed_step_when_primary_unavailable();
test_search_raw_aware_below_prefers_primary_target_step_from_target_step_spec();
test_search_raw_aware_offset_window_uses_target_step_spec_without_raw_parsing();
test_search_raw_aware_below_offset_expands_past_lower_window_hit_for_primary_step();
test_search_raw_aware_below_offset_stops_after_stable_fallback_without_primary();
test_search_raw_aware_below_offset_single_material_keeps_searching_for_closer_fallback_after_initial_cap();
test_search_raw_aware_below_rejects_closer_above_raw_outside_window();
test_search_raw_aware_below_multi_group_does_not_stop_on_window_fallback();
test_search_role_aware_below_offset_refines_lower_window_hit_to_primary_step();
test_search_role_aware_step_spec_orders_outside_window_by_target_priority_before_side_bias();
test_refine_role_aware_stops_when_current_mean_is_on_target_step();
test_role_aware_push_trace_uses_shared_material_projection();
test_refine_individual_slots_below_mode_improves_main_up();
test_refine_individual_slots_infinite_mode_approaches_target();
console.log("craftAssistSearch tests passed");
