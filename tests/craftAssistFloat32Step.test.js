const assert = require("node:assert/strict");

const {
  toFloat32,
  prevFloat32,
  nextFloat32,
  resolveCraftAssistTargetStepSpec,
  isMeanOnTargetStep,
  distanceFromMeanToTargetRange
} = require("../node_sidecar/src/services/craftAssistFloat32Step");

function assertRejectsWithCode(run, code) {
  assert.throws(run, (err) => err && err.code === code);
}

function test_to_float32_returns_math_fround_value() {
  const values = [
    0,
    0.1,
    0.2142,
    1 / 3,
    1
  ];

  for (const value of values) {
    assert.equal(toFloat32(value), Math.fround(value));
  }
}

function test_prev_and_next_float32_move_one_representable_step() {
  const step = Math.fround(0.2142);
  const previous = prevFloat32(step);
  const next = nextFloat32(step);

  assert.equal(Math.fround(previous), previous);
  assert.equal(Math.fround(next), next);
  assert.equal(previous < step, true);
  assert.equal(next > step, true);
  assert.equal(nextFloat32(previous), step);
  assert.equal(prevFloat32(next), step);
}

function test_resolve_infinite_targets_input_step() {
  const inputStep = Math.fround(0.2142);

  const spec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "infinite"
  });

  assert.equal(spec.inputStep, inputStep);
  assert.equal(spec.targetStep, inputStep);
  assert.equal(spec.approachMode, "infinite");
}

function test_resolve_below_targets_previous_step() {
  const inputStep = Math.fround(0.2142);

  const spec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below"
  });

  assert.equal(spec.inputStep, inputStep);
  assert.equal(spec.targetStep, prevFloat32(inputStep));
  assert.equal(spec.approachMode, "below");
}

function test_resolve_rejects_non_float32_input_step() {
  assertRejectsWithCode(() => resolveCraftAssistTargetStepSpec({
    inputStep: 0.1,
    approachMode: "infinite"
  }), "invalid_target_step");

  assertRejectsWithCode(() => resolveCraftAssistTargetStepSpec({
    inputStep: Infinity,
    approachMode: "infinite"
  }), "invalid_target_step");

  assertRejectsWithCode(() => resolveCraftAssistTargetStepSpec({
    inputStep: -Math.fround(0.1),
    approachMode: "infinite"
  }), "invalid_target_step");

  assertRejectsWithCode(() => resolveCraftAssistTargetStepSpec({
    inputStep: Math.fround(1.1),
    approachMode: "infinite"
  }), "invalid_target_step");
}

function test_resolve_below_at_zero_rejects_unreachable_below_target() {
  assertRejectsWithCode(() => resolveCraftAssistTargetStepSpec({
    inputStep: 0,
    approachMode: "below"
  }), "unreachable_below_target");
}

function test_is_mean_on_target_step_uses_float32_authoritative_hit() {
  const targetStep = Math.fround(0.2142);
  const spec = resolveCraftAssistTargetStepSpec({
    inputStep: targetStep,
    approachMode: "infinite"
  });
  const meanOnStep = Number(targetStep) + Number.EPSILON;
  const meanOffStep = nextFloat32(targetStep);

  assert.equal(Math.fround(meanOnStep), targetStep);
  assert.equal(isMeanOnTargetStep(meanOnStep, spec), true);
  assert.equal(isMeanOnTargetStep(meanOffStep, spec), false);
}

function test_distance_from_mean_to_target_range_is_zero_inside_preimage_and_positive_outside() {
  const targetStep = Math.fround(0.2142);
  const spec = resolveCraftAssistTargetStepSpec({
    inputStep: targetStep,
    approachMode: "infinite"
  });
  const inside = Number(targetStep) + Number.EPSILON;
  const belowOutside = prevFloat32(targetStep);
  const aboveOutside = nextFloat32(targetStep);

  assert.equal(Math.fround(inside), targetStep);
  assert.equal(distanceFromMeanToTargetRange(inside, spec), 0);
  assert.equal(distanceFromMeanToTargetRange(belowOutside, spec) > 0, true);
  assert.equal(distanceFromMeanToTargetRange(aboveOutside, spec) > 0, true);
}

test_to_float32_returns_math_fround_value();
test_prev_and_next_float32_move_one_representable_step();
test_resolve_infinite_targets_input_step();
test_resolve_below_targets_previous_step();
test_resolve_rejects_non_float32_input_step();
test_resolve_below_at_zero_rejects_unreachable_below_target();
test_is_mean_on_target_step_uses_float32_authoritative_hit();
test_distance_from_mean_to_target_range_is_zero_inside_preimage_and_positive_outside();
console.log("craftAssistFloat32Step tests passed");
