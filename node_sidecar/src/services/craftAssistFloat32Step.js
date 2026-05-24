const FLOAT32_BUFFER = new ArrayBuffer(4);
const FLOAT32_VIEW = new DataView(FLOAT32_BUFFER);
const MIN_FLOAT32_SUBNORMAL_BITS = 0x00000001;
const MAX_FLOAT32_BITS = 0x7f7fffff;
const BELOW_TARGET_SAFE_OFFSET = 0.0000001;

function toFloat32(value) {
  return Math.fround(value);
}

function float32ToBits(value) {
  FLOAT32_VIEW.setFloat32(0, Math.fround(value), false);
  return FLOAT32_VIEW.getUint32(0, false);
}

function bitsToFloat32(bits) {
  FLOAT32_VIEW.setUint32(0, bits >>> 0, false);
  return FLOAT32_VIEW.getFloat32(0, false);
}

function prevFloat32(step) {
  const value = Math.fround(step);
  if (Number.isNaN(value) || value === -Infinity) return value;
  if (value === Infinity) return bitsToFloat32(MAX_FLOAT32_BITS);
  if (Object.is(value, 0) || Object.is(value, -0)) {
    return bitsToFloat32(0x80000000 | MIN_FLOAT32_SUBNORMAL_BITS);
  }

  const bits = float32ToBits(value);
  return bitsToFloat32(value > 0 ? bits - 1 : bits + 1);
}

function nextFloat32(step) {
  const value = Math.fround(step);
  if (Number.isNaN(value) || value === Infinity) return value;
  if (value === -Infinity) return bitsToFloat32(0xff800001);
  if (Object.is(value, 0) || Object.is(value, -0)) {
    return bitsToFloat32(MIN_FLOAT32_SUBNORMAL_BITS);
  }

  const bits = float32ToBits(value);
  return bitsToFloat32(value > 0 ? bits + 1 : bits - 1);
}

function makeCraftAssistStepError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function assertValidTargetInputStep(inputStep) {
  if (
    typeof inputStep !== "number" ||
    !Number.isFinite(inputStep) ||
    inputStep < 0 ||
    inputStep > 1 ||
    Math.fround(inputStep) !== inputStep
  ) {
    throw makeCraftAssistStepError(
      "invalid_target_step",
      "Craft assist target step must be a finite float32 value in [0, 1]."
    );
  }
}

function normalizeTargetInputRaw(inputRaw) {
  if (inputRaw === undefined || inputRaw === null || inputRaw === "") return null;

  const value = Number(inputRaw);
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw makeCraftAssistStepError(
      "invalid_target_raw",
      "Craft assist target raw wear must be a finite value in [0, 1]."
    );
  }

  return value;
}

function normalizeApproachMode(approachMode) {
  return String(approachMode || "").trim() === "infinite" ? "infinite" : "below";
}

function buildRawMeanGuidanceRange(targetStep) {
  const prevStep = prevFloat32(targetStep);
  const nextStep = nextFloat32(targetStep);
  const lowerBound = Math.max(0, (Number(prevStep) + Number(targetStep)) / 2);
  const upperBound = Math.min(1, (Number(targetStep) + Number(nextStep)) / 2);

  return {
    prevStep,
    nextStep,
    lowerBound,
    upperBound
  };
}

function normalizeOffsetValue(offsetValue) {
  const value = Number(offsetValue);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function resolveWindowEndpoint(value, fallbackStep, direction) {
  if (!Number.isFinite(value)) return fallbackStep;

  const clamped = Math.min(1, Math.max(0, value));
  const step = Math.fround(clamped);
  if (direction < 0 && Number(step) > clamped) return prevFloat32(step);
  if (direction > 0 && Number(step) < clamped) return nextFloat32(step);
  return step;
}

function resolveBelowTargetStep(inputStep, inputRaw) {
  const target = inputRaw !== null ? Number(inputRaw) : Number(inputStep);
  if (target - BELOW_TARGET_SAFE_OFFSET <= 0) {
    throw makeCraftAssistStepError(
      "unreachable_below_target",
      "Craft assist cannot target a float32 step below zero."
    );
  }

  if (inputRaw !== null) {
    return Math.fround(target - BELOW_TARGET_SAFE_OFFSET);
  }

  return prevFloat32(inputStep);
}

function resolveRangeUpperTargetStep(spec) {
  const upperTargetStep = Number(spec && spec.upperTargetStep);
  if (Number.isFinite(upperTargetStep)) return upperTargetStep;
  return Number(spec && spec.targetStep);
}

function assertTargetStepMatchesRaw(inputStep, inputRaw) {
  if (inputRaw !== null && Math.fround(inputRaw) !== inputStep) {
    throw makeCraftAssistStepError(
      "invalid_target_step",
      "Craft assist target step must match the float32 step derived from raw wear."
    );
  }
}

function resolveCraftAssistTargetStepSpec({inputStep, inputRaw, targetWearRaw, approachMode, offsetValue} = {}) {
  assertValidTargetInputStep(inputStep);

  const normalizedMode = normalizeApproachMode(approachMode);
  const raw = normalizeTargetInputRaw(inputRaw ?? targetWearRaw);
  assertTargetStepMatchesRaw(inputStep, raw);
  const targetStep = normalizedMode === "below"
    ? resolveBelowTargetStep(inputStep, raw)
    : inputStep;
  const offset = normalizeOffsetValue(offsetValue);
  const hasOffsetWindow = offset > 0;
  const lowerTargetStep = hasOffsetWindow
    ? resolveWindowEndpoint(Number(inputStep) - offset, targetStep, -1)
    : targetStep;
  const upperTargetStep = hasOffsetWindow && normalizedMode === "infinite"
    ? resolveWindowEndpoint(Number(inputStep) + offset, targetStep, 1)
    : targetStep;
  const lowerRange = buildRawMeanGuidanceRange(lowerTargetStep);
  const upperRange = buildRawMeanGuidanceRange(upperTargetStep);
  const range = buildRawMeanGuidanceRange(targetStep);

  return {
    inputStep,
    inputRaw: raw,
    targetWearRaw: raw,
    targetStep,
    lowerTargetStep,
    upperTargetStep,
    hasOffsetWindow,
    prevStep: range.prevStep,
    nextStep: range.nextStep,
    lowerBound: lowerRange.lowerBound,
    upperBound: upperRange.upperBound,
    approachMode: normalizedMode
  };
}

function quantizeMeanToTargetDomain(mean) {
  return Math.fround(mean);
}

function isMeanOnTargetStep(mean, spec) {
  const quantizedMean = quantizeMeanToTargetDomain(mean);
  const lowerTargetStep = Number(spec && spec.lowerTargetStep);
  const upperTargetStep = resolveRangeUpperTargetStep(spec);
  const targetStep = Number(spec && spec.targetStep);

  if (Number.isFinite(lowerTargetStep) && Number.isFinite(upperTargetStep)) {
    return quantizedMean >= lowerTargetStep && quantizedMean <= upperTargetStep;
  }
  return quantizedMean === targetStep;
}

function isMeanOnPrimaryTargetStep(mean, spec) {
  return quantizeMeanToTargetDomain(mean) === Number(spec && spec.targetStep);
}

function targetStepPriorityTuple(mean, spec) {
  const quantizedMean = quantizeMeanToTargetDomain(mean);
  const quantizedValue = Number(quantizedMean);
  const inputStep = Number(spec && spec.inputStep);
  const targetStep = Number(spec && spec.targetStep);
  const approachMode = normalizeApproachMode(spec && spec.approachMode);
  if (quantizedMean === targetStep) return [0, 0, quantizedValue];

  if (!isMeanOnTargetStep(quantizedMean, spec)) {
    return [2, distanceFromMeanToTargetRange(quantizedMean, spec), quantizedValue];
  }

  if (approachMode === "below") {
    const rawTarget = Number(spec && (spec.inputRaw ?? spec.targetWearRaw));
    const fallbackGap = Number.isFinite(rawTarget)
      ? rawTarget - Number(mean)
      : targetStep - quantizedValue;
    return [1, fallbackGap, quantizedValue];
  }

  return [1, Math.abs(quantizedValue - inputStep), quantizedValue];
}

function compareMeanToTargetRange(mean, spec) {
  const quantizedMean = quantizeMeanToTargetDomain(mean);
  const lowerTargetStep = Number(spec && spec.lowerTargetStep);
  const upperTargetStep = resolveRangeUpperTargetStep(spec);
  const targetStep = Number(spec && spec.targetStep);
  const lower = Number.isFinite(lowerTargetStep) ? lowerTargetStep : targetStep;
  const upper = Number.isFinite(upperTargetStep) ? upperTargetStep : targetStep;

  if (quantizedMean >= lower && quantizedMean <= upper) return 0;
  return quantizedMean < lower ? -1 : 1;
}

function distanceFromMeanToTargetRange(mean, spec) {
  if (isMeanOnTargetStep(mean, spec)) return 0;

  const value = Number(mean);
  const lowerBound = Number(spec && spec.lowerBound);
  const upperBound = Number(spec && spec.upperBound);

  if (!Number.isFinite(value)) return Infinity;
  if (Number.isFinite(lowerBound) && value < lowerBound) return lowerBound - value;
  if (Number.isFinite(upperBound) && value > upperBound) return value - upperBound;

  const targetStep = Number(spec && spec.targetStep);
  return Math.abs(value - targetStep) || Number.MIN_VALUE;
}

module.exports = {
  toFloat32,
  prevFloat32,
  nextFloat32,
  resolveCraftAssistTargetStepSpec,
  quantizeMeanToTargetDomain,
  isMeanOnTargetStep,
  isMeanOnPrimaryTargetStep,
  targetStepPriorityTuple,
  compareMeanToTargetRange,
  distanceFromMeanToTargetRange
};
