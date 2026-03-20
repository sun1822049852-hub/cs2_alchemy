const assert = require("node:assert/strict");

const {searchRoleAwarePushSolution} = require("../node_sidecar/src/services/craftAssistSearch");

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
  assert.deepEqual(pickedIds(result), [
    "a10",
    "a11",
    "a12",
    "a5",
    "a6",
    "a7",
    "a8",
    "a9",
    "m1",
    "m2"
  ]);
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

test_role_aware_push_slides_aux_window_down_when_over_target();
test_role_aware_push_slides_main_window_up_when_under_target();
test_role_aware_push_prefers_closer_aux_raise_when_main_raise_would_block_it();
test_role_aware_push_returns_selection_trace();
console.log("craftAssistSearch tests passed");
