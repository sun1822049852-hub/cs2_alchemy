"use strict";

const {parentPort} = require("node:worker_threads");
const {
  compareMeanToTargetRange,
  distanceFromMeanToTargetRange,
  targetStepPriorityTuple
} = require("./craftAssistFloat32Step");

const EPSILON = 1e-9;

if (!parentPort) {
  throw new Error("craftAssistShardWorker requires parentPort");
}

function asFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asNonNegativeInt(value, fallback = 0) {
  const n = Math.trunc(asFiniteNumber(value, fallback));
  return n >= 0 ? n : fallback;
}

function normalizeRole(role) {
  const text = String(role || "").trim();
  if (text === "aux" || text === "neutral") return text;
  return "main";
}

function compareTuple(left, right) {
  const len = Math.max(Array.isArray(left) ? left.length : 0, Array.isArray(right) ? right.length : 0);
  for (let index = 0; index < len; index += 1) {
    const diff = asFiniteNumber(left && left[index], 0) - asFiniteNumber(right && right[index], 0);
    if (Math.abs(diff) > 1e-12) return diff;
  }
  return 0;
}

function candidateSide(value, targetValue) {
  if (value < targetValue - EPSILON) return "below";
  if (value > targetValue + EPSILON) return "above";
  return "equal";
}

function resolveCandidateSide(value, targetValue, targetStepSpec = null) {
  if (!hasTargetStepSpec(targetStepSpec)) return candidateSide(value, targetValue);
  const side = compareMeanToTargetRange(value, targetStepSpec);
  if (side < 0) return "below";
  if (side > 0) return "above";
  return "equal";
}

function hasTargetStepSpec(targetStepSpec) {
  return !!(
    targetStepSpec
    && typeof targetStepSpec === "object"
    && Number.isFinite(Number(targetStepSpec.targetStep))
  );
}

function buildScoreTuple(candidate, {role, targetValue, targetStepSpec = null}) {
  const value = asFiniteNumber(candidate && candidate.value, 0);
  const orderedIndex = asNonNegativeInt(candidate && candidate.orderedIndex, 0);
  const distance = hasTargetStepSpec(targetStepSpec)
    ? distanceFromMeanToTargetRange(value, targetStepSpec)
    : Math.abs(value - targetValue);
  const targetPriority = hasTargetStepSpec(targetStepSpec)
    ? targetStepPriorityTuple(value, targetStepSpec)
    : [distance];
  if (role === "neutral") {
    return [...targetPriority, orderedIndex];
  }
  const side = resolveCandidateSide(value, targetValue, targetStepSpec);
  const wrongSidePenalty = role === "main"
    ? (side === "below" ? 1 : 0)
    : (side === "above" ? 1 : 0);
  if (hasTargetStepSpec(targetStepSpec)) {
    return role === "main"
      ? [...targetPriority, wrongSidePenalty, -value, orderedIndex]
      : [...targetPriority, wrongSidePenalty, value, orderedIndex];
  }
  if (role === "main") {
    return [wrongSidePenalty, ...targetPriority, -value, orderedIndex];
  }
  return [wrongSidePenalty, ...targetPriority, value, orderedIndex];
}

function compareByOrderedIndex(left, right) {
  return asNonNegativeInt(left && left.orderedIndex, 0) - asNonNegativeInt(right && right.orderedIndex, 0);
}

function buildQuantileEdgeKeep(sideCandidates, edgeKeepPerSide) {
  const list = Array.isArray(sideCandidates) ? sideCandidates : [];
  const keep = asNonNegativeInt(edgeKeepPerSide, 0);
  if (!list.length || keep <= 0) return [];
  if (list.length <= keep) return [...list];
  if (keep === 1) return [list[0]];
  const picked = [];
  const seen = new Set();
  for (let i = 0; i < keep; i += 1) {
    const index = Math.round(i * (list.length - 1) / (keep - 1));
    const candidate = list[index];
    const id = String(candidate && candidate.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    picked.push(candidate);
  }
  return picked;
}

function selectShardCandidates(payload = {}) {
  const role = normalizeRole(payload.role);
  const targetValue = asFiniteNumber(payload.targetValue, 0);
  const targetStepSpec = hasTargetStepSpec(payload.targetStepSpec) ? payload.targetStepSpec : null;
  const topK = Math.max(1, asNonNegativeInt(payload.topK, 40));
  const edgeKeepPerSide = asNonNegativeInt(payload.edgeKeepPerSide, 4);
  const candidates = (Array.isArray(payload.candidates) ? payload.candidates : [])
    .map((candidate) => ({
      id: String(candidate && candidate.id || "").trim(),
      value: asFiniteNumber(candidate && candidate.value, 0),
      orderedIndex: asNonNegativeInt(candidate && candidate.orderedIndex, 0)
    }))
    .filter((candidate) => candidate.id);
  const uniqueById = new Map();
  for (const candidate of candidates) {
    if (!uniqueById.has(candidate.id)) {
      uniqueById.set(candidate.id, candidate);
    }
  }
  const list = [...uniqueById.values()];
  const below = [];
  const above = [];
  const ranked = [...list].sort((left, right) => compareTuple(
    buildScoreTuple(left, {role, targetValue, targetStepSpec}),
    buildScoreTuple(right, {role, targetValue, targetStepSpec})
  ));
  for (const candidate of list) {
    const side = resolveCandidateSide(candidate.value, targetValue, targetStepSpec);
    if (side === "below") {
      below.push(candidate);
    } else if (side === "above") {
      above.push(candidate);
    }
  }
  below.sort(compareByOrderedIndex);
  above.sort(compareByOrderedIndex);
  const coreCount = Math.max(1, topK - edgeKeepPerSide * 2);
  const selected = [];
  const selectedIds = new Set();
  function pushCandidate(candidate) {
    if (!candidate) return false;
    const id = String(candidate.id || "");
    if (!id || selectedIds.has(id)) return false;
    selectedIds.add(id);
    selected.push(candidate);
    return true;
  }
  for (const candidate of ranked) {
    if (selected.length >= coreCount) break;
    pushCandidate(candidate);
  }
  const edgeBelow = buildQuantileEdgeKeep(below, edgeKeepPerSide);
  const edgeAbove = buildQuantileEdgeKeep(above, edgeKeepPerSide);
  for (const candidate of edgeBelow) {
    pushCandidate(candidate);
  }
  for (const candidate of edgeAbove) {
    pushCandidate(candidate);
  }
  for (const candidate of ranked) {
    if (selected.length >= topK) break;
    pushCandidate(candidate);
  }
  selected.sort(compareByOrderedIndex);
  const selectedList = selected.slice(0, topK);
  let preferredSideCount = 0;
  let oppositeSideCount = 0;
  for (const candidate of selectedList) {
    const side = resolveCandidateSide(candidate.value, targetValue, targetStepSpec);
    if (role === "neutral" || side === "equal") continue;
    const preferred = role === "main" ? side === "above" : side === "below";
    if (preferred) preferredSideCount += 1;
    else oppositeSideCount += 1;
  }
  return {
    groupIndex: asNonNegativeInt(payload.groupIndex, 0),
    shardIndex: asNonNegativeInt(payload.shardIndex, 0),
    selectedIds: selectedList.map((candidate) => candidate.id),
    stats: {
      inputCount: list.length,
      outputCount: selectedList.length,
      preferredSideCount,
      oppositeSideCount
    }
  };
}

parentPort.on("message", (message) => {
  if (!message || message.type !== "prefilter") return;
  parentPort.postMessage({
    type: "result",
    requestId: String(message.requestId || "").trim(),
    ok: true,
    result: selectShardCandidates(message.payload || {})
  });
});

module.exports = {
  selectShardCandidates
};
