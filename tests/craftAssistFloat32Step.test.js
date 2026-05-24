const assert = require("node:assert/strict");

const {
  toFloat32,
  prevFloat32,
  nextFloat32,
  resolveCraftAssistTargetStepSpec,
  isMeanOnTargetStep,
  isMeanOnPrimaryTargetStep,
  targetStepPriorityTuple,
  compareMeanToTargetRange,
  distanceFromMeanToTargetRange
} = require("../node_sidecar/src/services/craftAssistFloat32Step");

function assertRejectsWithCode(run, code) {
  assert.throws(run, (err) => err && err.code === code);
}

function assertRejectsWithCodeAndMessage(run, code, messagePattern) {
  assert.throws(run, (err) => (
    err &&
    err.code === code &&
    messagePattern.test(String(err.message || ""))
  ));
}

function comparePriorityTuple(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue !== rightValue) return leftValue < rightValue ? -1 : 1;
  }
  return 0;
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

function test_resolve_below_raw_decimal_uses_conservative_target_when_float32_step_is_below_raw() {
  const raw = 0.21;
  const inputStep = Math.fround(raw);

  assert.equal(inputStep < raw, true);

  const spec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below"
  });

  assert.equal(spec.targetStep, Math.fround(raw - 0.0000001));
  assert.equal(spec.approachMode, "below");
}

function test_resolve_below_raw_target_uses_one_tenth_micro_lower_conservative_target() {
  const raw = 0.21;
  const conservativeTarget = raw - 0.0000001;
  const inputStep = Math.fround(raw);
  const currentPreviousStep = prevFloat32(inputStep);

  const spec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below"
  });

  assert.equal(spec.targetStep, Math.fround(conservativeTarget));
  assert.equal(spec.targetStep < currentPreviousStep, true);
}

function test_resolve_below_raw_decimal_uses_conservative_target_when_float32_step_is_above_raw() {
  const raw = 0.18;
  const inputStep = Math.fround(raw);

  assert.equal(inputStep > raw, true);

  const spec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below"
  });

  assert.equal(spec.targetStep, Math.fround(raw - 0.0000001));
  assert.equal(spec.approachMode, "below");
}

function test_resolve_below_raw_decimal_uses_conservative_target_for_exact_float32_raw_text() {
  const raw = 0.125;
  const inputStep = Math.fround(raw);

  assert.equal(inputStep, raw);

  const spec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below"
  });

  assert.equal(spec.targetStep, Math.fround(raw - 0.0000001));
  assert.equal(spec.approachMode, "below");
}

function test_resolve_below_rejects_raw_zero() {
  assertRejectsWithCode(() => resolveCraftAssistTargetStepSpec({
    inputStep: 0,
    inputRaw: 0,
    approachMode: "below"
  }), "unreachable_below_target");
}

function test_resolve_below_raw_at_or_below_one_tenth_micro_rejects_unreachable_target() {
  for (const raw of [0.0000001, 0.00000009]) {
    assertRejectsWithCode(() => resolveCraftAssistTargetStepSpec({
      inputStep: Math.fround(raw),
      inputRaw: raw,
      approachMode: "below"
    }), "unreachable_below_target");
  }
}

function test_resolve_below_rejects_raw_that_is_not_above_one_tenth_micro_even_when_float32_underflows_to_zero() {
  const raw = Number.MIN_VALUE;
  const inputStep = Math.fround(raw);

  assert.equal(inputStep, 0);
  assert.equal(raw > 0, true);

  assertRejectsWithCode(() => resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below"
  }), "unreachable_below_target");
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

function test_resolve_infinite_keeps_float32_step_for_raw_aware_input() {
  const raw = 0.21;
  const inputStep = Math.fround(raw);

  const spec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "infinite"
  });

  assert.equal(spec.inputStep, inputStep);
  assert.equal(spec.targetStep, inputStep);
  assert.equal(spec.approachMode, "infinite");
}

function test_resolve_infinite_rejects_raw_step_mismatch() {
  assertRejectsWithCodeAndMessage(() => resolveCraftAssistTargetStepSpec({
    inputStep: Math.fround(0.22),
    inputRaw: "0.21",
    approachMode: "infinite"
  }), "invalid_target_step", /raw wear/i);
}

function test_resolve_infinite_accepts_string_target_wear_raw_when_step_matches() {
  const raw = "0.21";
  const inputStep = Math.fround(Number(raw));

  const spec = resolveCraftAssistTargetStepSpec({
    inputStep,
    targetWearRaw: raw,
    approachMode: "infinite"
  });

  assert.equal(spec.inputStep, inputStep);
  assert.equal(spec.targetStep, inputStep);
  assert.equal(spec.approachMode, "infinite");
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

function test_below_with_offset_targets_window_from_offset_step_to_previous_input_step() {
  const inputStep = Math.fround(0.2142);
  const offsetValue = 0.01;

  const spec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below",
    offsetValue
  });

  assert.equal(spec.hasOffsetWindow, true);
  assert.equal(spec.targetStep, prevFloat32(inputStep));
  assert.equal(spec.upperTargetStep, spec.targetStep);
  assert.equal(spec.lowerTargetStep <= Math.fround(inputStep - offsetValue), true);
}

function test_below_with_offset_uses_raw_aware_conservative_primary_target_without_changing_window_rules() {
  const raw = 0.21;
  const inputStep = Math.fround(raw);
  const offsetValue = 0.01;

  const spec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below",
    offsetValue
  });

  assert.equal(spec.hasOffsetWindow, true);
  assert.equal(spec.targetStep, Math.fround(raw - 0.0000001));
  assert.equal(spec.upperTargetStep, spec.targetStep);
  assert.equal(spec.lowerTargetStep <= Math.fround(inputStep - offsetValue), true);
}

function test_below_with_offset_does_not_expand_raw_aware_upper_target_step_above_primary_target() {
  const raw = 0.27;
  const inputStep = Math.fround(raw);
  const offsetValue = raw * 0.01;

  const spec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below",
    offsetValue
  });

  assert.equal(inputStep > raw, true);
  assert.equal(spec.targetStep, Math.fround(raw - 0.0000001));
  assert.equal(prevFloat32(inputStep) > spec.targetStep, true);
  assert.equal(spec.upperTargetStep, spec.targetStep);
}

function test_infinite_with_offset_includes_lower_and_upper_target_steps() {
  const inputStep = Math.fround(0.2142);
  const offsetValue = 0.01;

  const spec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "infinite",
    offsetValue
  });

  assert.equal(spec.hasOffsetWindow, true);
  assert.equal(spec.targetStep, inputStep);
  assert.equal(spec.lowerTargetStep <= Math.fround(inputStep - offsetValue), true);
  assert.equal(spec.upperTargetStep >= Math.fround(inputStep + offsetValue), true);
  assert.equal(isMeanOnTargetStep(spec.lowerTargetStep, spec), true);
  assert.equal(isMeanOnTargetStep(spec.upperTargetStep, spec), true);
}

function test_no_offset_spec_stays_single_step() {
  const inputStep = Math.fround(0.2142);

  const spec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "infinite"
  });

  assert.equal(spec.hasOffsetWindow, false);
  assert.equal(spec.lowerTargetStep, inputStep);
  assert.equal(spec.upperTargetStep, inputStep);
  assert.equal(isMeanOnTargetStep(prevFloat32(inputStep), spec), false);
  assert.equal(isMeanOnTargetStep(inputStep, spec), true);
  assert.equal(isMeanOnTargetStep(nextFloat32(inputStep), spec), false);
}

function test_below_no_offset_spec_stays_single_step() {
  const inputStep = Math.fround(0.2142);
  const targetStep = prevFloat32(inputStep);

  const spec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below"
  });

  assert.equal(spec.hasOffsetWindow, false);
  assert.equal(spec.targetStep, targetStep);
  assert.equal(spec.lowerTargetStep, targetStep);
  assert.equal(spec.upperTargetStep, targetStep);
  assert.equal(isMeanOnTargetStep(prevFloat32(targetStep), spec), false);
  assert.equal(isMeanOnTargetStep(targetStep, spec), true);
  assert.equal(isMeanOnTargetStep(nextFloat32(targetStep), spec), false);
}

function test_primary_step_priority_wins_over_offset_step_priority() {
  const inputStep = Math.fround(0.2142);
  const spec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "infinite",
    offsetValue: 0.01
  });
  const primaryTuple = targetStepPriorityTuple(inputStep, spec);
  const offsetTuple = targetStepPriorityTuple(spec.lowerTargetStep, spec);

  assert.equal(isMeanOnPrimaryTargetStep(inputStep, spec), true);
  assert.equal(isMeanOnPrimaryTargetStep(spec.lowerTargetStep, spec), false);
  assert.equal(comparePriorityTuple(primaryTuple, offsetTuple) < 0, true);
}

function test_below_offset_range_helpers_keep_allowed_hits_ahead_of_outside_misses() {
  const inputStep = Math.fround(0.2142);
  const spec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "below",
    offsetValue: 0.01
  });
  const belowWindow = prevFloat32(spec.lowerTargetStep);
  const aboveWindow = nextFloat32(spec.targetStep);

  assert.equal(compareMeanToTargetRange(spec.lowerTargetStep, spec), 0);
  assert.equal(compareMeanToTargetRange(spec.targetStep, spec), 0);
  assert.equal(compareMeanToTargetRange(belowWindow, spec), -1);
  assert.equal(compareMeanToTargetRange(aboveWindow, spec), 1);

  assert.equal(distanceFromMeanToTargetRange(spec.lowerTargetStep, spec), 0);
  assert.equal(distanceFromMeanToTargetRange(spec.targetStep, spec), 0);
  assert.equal(distanceFromMeanToTargetRange(belowWindow, spec) > 0, true);
  assert.equal(distanceFromMeanToTargetRange(aboveWindow, spec) > 0, true);

  assert.equal(isMeanOnTargetStep(spec.lowerTargetStep, spec), true);
  assert.equal(isMeanOnTargetStep(aboveWindow, spec), false);
  assert.equal(
    comparePriorityTuple(
      targetStepPriorityTuple(spec.lowerTargetStep, spec),
      targetStepPriorityTuple(aboveWindow, spec)
    ) < 0,
    true
  );
}

function test_below_offset_same_step_above_primary_target_is_not_on_target() {
  const raw = "0.214285";
  const inputStep = Math.fround(Number(raw));
  const spec = resolveCraftAssistTargetStepSpec({
    inputStep,
    inputRaw: raw,
    approachMode: "below",
    offsetValue: Number(raw) * 0.01
  });
  const fartherFallback = 0.214284905;
  const closerFallback = 0.21428491771221161;

  assert.equal(Math.fround(fartherFallback), Math.fround(closerFallback));
  assert.equal(isMeanOnTargetStep(fartherFallback, spec), false);
  assert.equal(isMeanOnTargetStep(closerFallback, spec), false);
  assert.equal(isMeanOnPrimaryTargetStep(fartherFallback, spec), false);
  assert.equal(isMeanOnPrimaryTargetStep(closerFallback, spec), false);
  assert.equal(Math.fround(closerFallback) > spec.targetStep, true);
}

function test_infinite_equal_distance_tie_prefers_lower_wear() {
  const inputStep = Math.fround(0.2142);
  const spec = resolveCraftAssistTargetStepSpec({
    inputStep,
    approachMode: "infinite",
    offsetValue: 0.01
  });
  const lower = prevFloat32(inputStep);
  const upper = nextFloat32(inputStep);

  assert.equal(lower < upper, true);
  assert.equal(
    comparePriorityTuple(
      targetStepPriorityTuple(lower, spec),
      targetStepPriorityTuple(upper, spec)
    ) < 0,
    true
  );
}

test_to_float32_returns_math_fround_value();
test_prev_and_next_float32_move_one_representable_step();
test_resolve_infinite_targets_input_step();
test_resolve_below_targets_previous_step();
test_resolve_below_raw_decimal_uses_conservative_target_when_float32_step_is_below_raw();
test_resolve_below_raw_target_uses_one_tenth_micro_lower_conservative_target();
test_resolve_below_raw_decimal_uses_conservative_target_when_float32_step_is_above_raw();
test_resolve_below_raw_decimal_uses_conservative_target_for_exact_float32_raw_text();
test_resolve_below_rejects_raw_zero();
test_resolve_below_raw_at_or_below_one_tenth_micro_rejects_unreachable_target();
test_resolve_below_rejects_raw_that_is_not_above_one_tenth_micro_even_when_float32_underflows_to_zero();
test_resolve_rejects_non_float32_input_step();
test_resolve_below_at_zero_rejects_unreachable_below_target();
test_resolve_infinite_keeps_float32_step_for_raw_aware_input();
test_resolve_infinite_rejects_raw_step_mismatch();
test_resolve_infinite_accepts_string_target_wear_raw_when_step_matches();
test_is_mean_on_target_step_uses_float32_authoritative_hit();
test_distance_from_mean_to_target_range_is_zero_inside_preimage_and_positive_outside();
test_below_with_offset_targets_window_from_offset_step_to_previous_input_step();
test_below_with_offset_uses_raw_aware_conservative_primary_target_without_changing_window_rules();
test_below_with_offset_does_not_expand_raw_aware_upper_target_step_above_primary_target();
test_infinite_with_offset_includes_lower_and_upper_target_steps();
test_no_offset_spec_stays_single_step();
test_below_no_offset_spec_stays_single_step();
test_primary_step_priority_wins_over_offset_step_priority();
test_below_offset_range_helpers_keep_allowed_hits_ahead_of_outside_misses();
test_below_offset_same_step_above_primary_target_is_not_on_target();
test_infinite_equal_distance_tie_prefers_lower_wear();
console.log("craftAssistFloat32Step tests passed");
