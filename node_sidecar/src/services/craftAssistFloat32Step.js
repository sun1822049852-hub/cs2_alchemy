const FLOAT32_BUFFER = new ArrayBuffer(4);
const FLOAT32_VIEW = new DataView(FLOAT32_BUFFER);
const MIN_FLOAT32_SUBNORMAL_BITS = 0x00000001;
const MAX_FLOAT32_BITS = 0x7f7fffff;

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

function resolveCraftAssistTargetStepSpec({inputStep, approachMode} = {}) {
  assertValidTargetInputStep(inputStep);

  const normalizedMode = normalizeApproachMode(approachMode);
  if (normalizedMode === "below" && inputStep === 0) {
    throw makeCraftAssistStepError(
      "unreachable_below_target",
      "Craft assist cannot target a float32 step below zero."
    );
  }

  const targetStep = normalizedMode === "below" ? prevFloat32(inputStep) : inputStep;
  const range = buildRawMeanGuidanceRange(targetStep);

  return {
    inputStep,
    targetStep,
    prevStep: range.prevStep,
    nextStep: range.nextStep,
    lowerBound: range.lowerBound,
    upperBound: range.upperBound,
    approachMode: normalizedMode
  };
}

function quantizeMeanToTargetDomain(mean) {
  return Math.fround(mean);
}

function isMeanOnTargetStep(mean, spec) {
  return quantizeMeanToTargetDomain(mean) === Number(spec && spec.targetStep);
}

function compareMeanToTargetRange(mean, spec) {
  const quantizedMean = quantizeMeanToTargetDomain(mean);
  const targetStep = Number(spec && spec.targetStep);
  if (quantizedMean === targetStep) return 0;
  return quantizedMean < targetStep ? -1 : 1;
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
  compareMeanToTargetRange,
  distanceFromMeanToTargetRange
};
