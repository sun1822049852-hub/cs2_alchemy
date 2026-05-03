const {projectCraftAssistTraceMaterial} = require("../../ui/craftAssistItemWearShared");
const {
  isMeanOnTargetStep,
  isMeanOnPrimaryTargetStep,
  targetStepPriorityTuple,
  compareMeanToTargetRange,
  distanceFromMeanToTargetRange,
  quantizeMeanToTargetDomain
} = require("./craftAssistFloat32Step");

const EPSILON = 1e-14;
const INITIAL_WINDOW_EXTRA_CAP = 24;
const WINDOW_BOUNDARY_MARGIN = 4;

function normalizeRole(role) {
  return String(role || "").trim() === "aux" ? "aux" : "main";
}

function normalizeApproachMode(value) {
  return String(value || "").trim() === "infinite" ? "infinite" : "below";
}

function isBelowTarget(overall, targetValue) {
  return Number(overall) < Number(targetValue) - EPSILON;
}

function hasTargetStepSpec(targetStepSpec) {
  return !!(
    targetStepSpec
    && typeof targetStepSpec === "object"
    && Number.isFinite(Number(targetStepSpec.targetStep))
  );
}

function resolveSearchTargetValue(targetValue, targetStepSpec) {
  return hasTargetStepSpec(targetStepSpec) ? Number(targetStepSpec.targetStep) : Number(targetValue);
}

function primaryOnlyTargetStepSpec(targetStepSpec) {
  if (!hasTargetStepSpec(targetStepSpec)) return targetStepSpec;
  return {
    ...targetStepSpec,
    lowerTargetStep: Number(targetStepSpec.targetStep),
    upperTargetStep: Number(targetStepSpec.targetStep)
  };
}

function resolveBelowTargetCeiling(targetValue, targetStepSpec = null) {
  const rawInput = targetStepSpec
    ? (targetStepSpec.inputRaw ?? targetStepSpec.targetWearRaw)
    : null;
  const raw = rawInput === null || rawInput === undefined || rawInput === ""
    ? NaN
    : Number(rawInput);
  if (Number.isFinite(raw)) return raw;
  const inputStep = Number(targetStepSpec && targetStepSpec.inputStep);
  if (Number.isFinite(inputStep)) return inputStep;
  return Number(targetValue);
}

function buildApproachTuplePrefix(overall, targetValue, approachMode, targetStepSpec = null) {
  if (hasTargetStepSpec(targetStepSpec)) {
    if (
      normalizeApproachMode(targetStepSpec && targetStepSpec.approachMode) === "below"
      && !isBelowTarget(overall, resolveBelowTargetCeiling(targetValue, targetStepSpec))
    ) {
      return null;
    }
    return targetStepPriorityTuple(overall, targetStepSpec);
  }
  const normalizedMode = normalizeApproachMode(approachMode);
  const numericOverall = Number(overall);
  if (!Number.isFinite(numericOverall)) return null;
  if (normalizedMode === "below") {
    if (!isBelowTarget(numericOverall, targetValue)) return null;
    return [Number(targetValue) - numericOverall];
  }
  return [
    Math.abs(Number(targetValue) - numericOverall),
    numericOverall > Number(targetValue) + EPSILON ? 1 : 0
  ];
}

function compareScoreTuples(a, b) {
  const len = Math.max(Array.isArray(a) ? a.length : 0, Array.isArray(b) ? b.length : 0);
  for (let i = 0; i < len; i += 1) {
    const diff = Number((a && a[i]) || 0) - Number((b && b[i]) || 0);
    if (Math.abs(diff) > 1e-12) return diff;
  }
  return 0;
}

function calcVariance(values) {
  const list = Array.isArray(values) ? values : [];
  if (!list.length) return 0;
  const mean = list.reduce((sum, value) => sum + Number(value || 0), 0) / list.length;
  return list.reduce((sum, value) => {
    const diff = Number(value || 0) - mean;
    return sum + diff * diff;
  }, 0) / list.length;
}

function resolveSearchMode(groups) {
  const list = Array.isArray(groups) ? groups : [];
  if (list.length <= 1) return "single_material";
  const roles = new Set(list.map((group) => normalizeRole(group && group.material && group.material.role)));
  return roles.size >= 2 ? "multi_material_role" : "multi_material_neutral";
}

function makeSearchCandidate({candidate, groupIndex, role, targetValue, targetStepSpec = null}) {
  const value = Number(candidate && candidate.value);
  const searchTarget = resolveSearchTargetValue(targetValue, targetStepSpec);
  const side = hasTargetStepSpec(targetStepSpec)
    ? compareMeanToTargetRange(value, targetStepSpec)
    : (value > searchTarget + EPSILON ? 1 : (value < searchTarget - EPSILON ? -1 : 0));
  return {
    ...candidate,
    groupIndex,
    role,
    value,
    targetPriorityTuple: hasTargetStepSpec(targetStepSpec)
      ? targetStepPriorityTuple(value, targetStepSpec)
      : null,
    distance: hasTargetStepSpec(targetStepSpec)
      ? distanceFromMeanToTargetRange(value, targetStepSpec)
      : Math.abs(value - searchTarget),
    side: side > 0
      ? "above"
      : (side < 0 ? "below" : "equal")
  };
}

function compareCandidateTargetPriority(a, b) {
  if (Array.isArray(a && a.targetPriorityTuple) || Array.isArray(b && b.targetPriorityTuple)) {
    return compareScoreTuples(a && a.targetPriorityTuple, b && b.targetPriorityTuple);
  }
  return 0;
}

function compareByDistanceThenValueAsc(a, b) {
  const priorityDiff = compareCandidateTargetPriority(a, b);
  if (priorityDiff !== 0) return priorityDiff;
  const da = Number(a && a.distance || 0);
  const db = Number(b && b.distance || 0);
  if (da !== db) return da - db;
  const va = Number(a && a.value || 0);
  const vb = Number(b && b.value || 0);
  if (va !== vb) return va - vb;
  return String(a && a.id || "").localeCompare(String(b && b.id || ""));
}

function compareByDistanceThenRoleBias(role, a, b) {
  const priorityDiff = compareCandidateTargetPriority(a, b);
  if (priorityDiff !== 0) return priorityDiff;
  const da = Number(a && a.distance || 0);
  const db = Number(b && b.distance || 0);
  if (da !== db) return da - db;
  const va = Number(a && a.value || 0);
  const vb = Number(b && b.value || 0);
  if (va !== vb) return role === "aux" ? va - vb : vb - va;
  return String(a && a.id || "").localeCompare(String(b && b.id || ""));
}

function candidateWrongSidePenalty(role, candidate) {
  const side = String(candidate && candidate.side || "");
  if (role === "main") return side === "below" ? 1 : 0;
  if (role === "aux") return side === "above" ? 1 : 0;
  return 0;
}

function compareByTargetPriorityThenRoleBias(role, a, b) {
  const priorityDiff = compareCandidateTargetPriority(a, b);
  if (priorityDiff !== 0) return priorityDiff;
  const penaltyDiff = candidateWrongSidePenalty(role, a) - candidateWrongSidePenalty(role, b);
  if (penaltyDiff !== 0) return penaltyDiff;
  const va = Number(a && a.value || 0);
  const vb = Number(b && b.value || 0);
  if (va !== vb) return role === "aux" ? va - vb : vb - va;
  return String(a && a.id || "").localeCompare(String(b && b.id || ""));
}

function buildOrderedCandidates(group, targetValue, mode, targetStepSpec = null) {
  const role = normalizeRole(group && group.material && group.material.role);
  const searchTarget = resolveSearchTargetValue(targetValue, targetStepSpec);
  const base = (Array.isArray(group && group.candidates) ? group.candidates : [])
    .map((candidate) => makeSearchCandidate({
      candidate,
      groupIndex: Number(group && group.index || 0),
      role,
      targetValue: searchTarget,
      targetStepSpec
    }))
    .filter((candidate) => Number.isFinite(candidate.value));
  if (mode === "single_material" || mode === "multi_material_neutral") {
    return base.sort(compareByDistanceThenValueAsc).map((candidate, index) => ({
      ...candidate,
      orderedIndex: index
    }));
  }
  if (hasTargetStepSpec(targetStepSpec)) {
    return base.sort((a, b) => compareByTargetPriorityThenRoleBias(role, a, b))
      .map((candidate, index) => ({
        ...candidate,
        orderedIndex: index
      }));
  }
  const preferred = [];
  const fallback = [];
  for (const candidate of base) {
    const isPreferred = role === "aux"
      ? candidate.side !== "above"
      : candidate.side !== "below";
    (isPreferred ? preferred : fallback).push(candidate);
  }
  preferred.sort((a, b) => compareByDistanceThenRoleBias(role, a, b));
  fallback.sort((a, b) => compareByDistanceThenRoleBias(role, a, b));
  return preferred.concat(fallback).map((candidate, index) => ({
    ...candidate,
    orderedIndex: index
  }));
}

function scoreCraftAssistSolutionSingleMaterial({selected, targetValue, approachMode = "below", targetStepSpec = null}) {
  const values = (Array.isArray(selected) ? selected : []).map((item) => Number(item && item.value || 0));
  if (!values.length) return null;
  const overall = values.reduce((sum, value) => sum + value, 0) / values.length;
  const searchTarget = resolveSearchTargetValue(targetValue, targetStepSpec);
  const radius = Math.max(...values.map((value) => Math.abs(value - searchTarget)));
  const above = values.filter((value) => value > searchTarget + EPSILON).length;
  const below = values.filter((value) => value < searchTarget - EPSILON).length;
  const meanDistance = values.reduce((sum, value) => sum + Math.abs(value - searchTarget), 0) / values.length;
  if (hasTargetStepSpec(targetStepSpec)) {
    const prefix = buildApproachTuplePrefix(overall, searchTarget, approachMode, targetStepSpec);
    if (!prefix) return null;
    return {
      overall,
      predictedStepMean: quantizeMeanToTargetDomain(overall),
      tuple: [
        ...prefix,
        radius,
        Math.abs(above - below),
        calcVariance(values),
        meanDistance
      ]
    };
  }
  if (normalizeApproachMode(approachMode) === "below") {
    if (!isBelowTarget(overall, targetValue)) return null;
    return {
      overall,
      tuple: [
        radius,
        Number(targetValue) - overall,
        Math.abs(above - below),
        calcVariance(values),
        meanDistance
      ]
    };
  }
  const prefix = buildApproachTuplePrefix(overall, targetValue, approachMode);
  if (!prefix) return null;
  return {
    overall,
    tuple: [
      ...prefix,
      radius,
      Math.abs(above - below),
      calcVariance(values),
      meanDistance
    ]
  };
}

function scoreCraftAssistSolutionNeutral({selected, targetValue, approachMode = "below", targetStepSpec = null}) {
  const values = (Array.isArray(selected) ? selected : []).map((item) => Number(item && item.value || 0));
  if (!values.length) return null;
  const overall = values.reduce((sum, value) => sum + value, 0) / values.length;
  const searchTarget = resolveSearchTargetValue(targetValue, targetStepSpec);
  const radius = Math.max(...values.map((value) => Math.abs(value - searchTarget)));
  const meanDistance = values.reduce((sum, value) => sum + Math.abs(value - searchTarget), 0) / values.length;
  if (hasTargetStepSpec(targetStepSpec)) {
    const prefix = buildApproachTuplePrefix(overall, searchTarget, approachMode, targetStepSpec);
    if (!prefix) return null;
    return {
      overall,
      predictedStepMean: quantizeMeanToTargetDomain(overall),
      tuple: [
        ...prefix,
        radius,
        calcVariance(values),
        meanDistance
      ]
    };
  }
  if (normalizeApproachMode(approachMode) === "below") {
    if (!isBelowTarget(overall, targetValue)) return null;
    return {
      overall,
      tuple: [
        Number(targetValue) - overall,
        radius,
        calcVariance(values),
        meanDistance
      ]
    };
  }
  const prefix = buildApproachTuplePrefix(overall, targetValue, approachMode);
  if (!prefix) return null;
  return {
    overall,
    tuple: [
      ...prefix,
      radius,
      calcVariance(values),
      meanDistance
    ]
  };
}

function scoreCraftAssistSolutionMultiMaterial({selected, targetValue, approachMode = "below", targetStepSpec = null}) {
  const list = Array.isArray(selected) ? selected : [];
  const values = list.map((item) => Number(item && item.value || 0));
  if (!values.length) return null;
  const overall = values.reduce((sum, value) => sum + value, 0) / values.length;
  const searchTarget = resolveSearchTargetValue(targetValue, targetStepSpec);
  const mains = list
    .filter((item) => normalizeRole(item && item.role) === "main")
    .map((item) => Number(item.value || 0));
  const auxes = list
    .filter((item) => normalizeRole(item && item.role) === "aux")
    .map((item) => Number(item.value || 0));
  const wrongSidePenalty = mains.filter((value) => value < searchTarget - EPSILON).length
    + auxes.filter((value) => value > searchTarget + EPSILON).length;
  const mainMean = mains.length ? mains.reduce((sum, value) => sum + value, 0) / mains.length : 0;
  const auxMean = auxes.length ? auxes.reduce((sum, value) => sum + value, 0) / auxes.length : 0;
  const radius = Math.max(...values.map((value) => Math.abs(value - searchTarget)));
  if (hasTargetStepSpec(targetStepSpec)) {
    const prefix = buildApproachTuplePrefix(overall, searchTarget, approachMode, targetStepSpec);
    if (!prefix) return null;
    return {
      overall,
      predictedStepMean: quantizeMeanToTargetDomain(overall),
      tuple: [
        ...prefix,
        wrongSidePenalty,
        -mainMean,
        auxMean,
        radius
      ]
    };
  }
  if (normalizeApproachMode(approachMode) === "below") {
    if (!isBelowTarget(overall, targetValue)) return null;
    return {
      overall,
      tuple: [
        Number(targetValue) - overall,
        wrongSidePenalty,
        -mainMean,
        auxMean,
        radius
      ]
    };
  }
  const prefix = buildApproachTuplePrefix(overall, targetValue, approachMode);
  if (!prefix) return null;
  return {
    overall,
    tuple: [
      ...prefix,
      wrongSidePenalty,
      -mainMean,
      auxMean,
      radius
    ]
  };
}

function scoreCompleteSelection(selected, targetValue, mode, approachMode = "below", targetStepSpec = null) {
  if (mode === "single_material") return scoreCraftAssistSolutionSingleMaterial({selected, targetValue, approachMode, targetStepSpec});
  if (mode === "multi_material_role") return scoreCraftAssistSolutionMultiMaterial({selected, targetValue, approachMode, targetStepSpec});
  return scoreCraftAssistSolutionNeutral({selected, targetValue, approachMode, targetStepSpec});
}

function compareByValueDesc(a, b) {
  const va = Number(a && a.value || 0);
  const vb = Number(b && b.value || 0);
  if (va !== vb) return vb - va;
  return String(a && a.id || "").localeCompare(String(b && b.id || ""));
}

function compareByValueAsc(a, b) {
  const va = Number(a && a.value || 0);
  const vb = Number(b && b.value || 0);
  if (va !== vb) return va - vb;
  return String(a && a.id || "").localeCompare(String(b && b.id || ""));
}

function bumpRoleAwareDebugStat(debugStats, key, amount = 1) {
  if (!debugStats || typeof debugStats !== "object") return;
  debugStats[key] = Number(debugStats[key] || 0) + Number(amount || 0);
}

function buildRoleAwareRefinementContext(currentResults, debugStats = null) {
  return (Array.isArray(currentResults) ? currentResults : []).map((entry) => {
    const available = Array.isArray(entry && entry.available) ? entry.available : [];
    const availableAsc = available.slice().sort(compareByValueAsc);
    const availableDesc = available.slice().sort(compareByValueDesc);
    bumpRoleAwareDebugStat(debugStats, "roleAwareAvailableSorts", 2);
    return {
      availableAsc,
      availableDesc
    };
  });
}

function getRoleAwareAvailableList(refinementContext, entryIndex, direction) {
  const entryState = Array.isArray(refinementContext) ? refinementContext[entryIndex] : null;
  if (!entryState) return [];
  return direction === "desc"
    ? (Array.isArray(entryState.availableDesc) ? entryState.availableDesc : [])
    : (Array.isArray(entryState.availableAsc) ? entryState.availableAsc : []);
}

function buildSingleMaterialSelection({below, upper, state}) {
  const nextState = state || {};
  return [
    ...(Array.isArray(below) ? below : []).slice(
      Number(nextState.belowStart || 0),
      Number(nextState.belowStart || 0) + Number(nextState.belowCount || 0)
    ),
    ...(Array.isArray(upper) ? upper : []).slice(
      Number(nextState.upperStart || 0),
      Number(nextState.upperStart || 0) + Number(nextState.upperCount || 0)
    )
  ];
}

function countSingleMaterialSides(selected, targetValue) {
  const list = Array.isArray(selected) ? selected : [];
  let belowCount = 0;
  let equalCount = 0;
  let aboveCount = 0;
  for (const candidate of list) {
    const value = Number(candidate && candidate.value || 0);
    if (value < Number(targetValue) - EPSILON) {
      belowCount += 1;
    } else if (value > Number(targetValue) + EPSILON) {
      aboveCount += 1;
    } else {
      equalCount += 1;
    }
  }
  return {belowCount, equalCount, aboveCount};
}

function scoreSingleMaterialSearchSelection({selected, targetValue}) {
  const values = (Array.isArray(selected) ? selected : []).map((item) => Number(item && item.value || 0));
  if (!values.length) return null;
  const overall = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (!(overall < Number(targetValue) - EPSILON)) return null;
  const radius = Math.max(...values.map((value) => Math.abs(value - Number(targetValue))));
  const above = values.filter((value) => value > Number(targetValue) + EPSILON).length;
  const below = values.filter((value) => value < Number(targetValue) - EPSILON).length;
  const meanDistance = values.reduce((sum, value) => sum + Math.abs(value - Number(targetValue)), 0) / values.length;
  return {
    overall,
    tuple: [
      Number(targetValue) - overall,
      radius,
      Math.abs(above - below),
      calcVariance(values),
      meanDistance
    ]
  };
}

function scoreSingleMaterialPushState({below, upper, state, targetValue}) {
  const selected = buildSingleMaterialSelection({below, upper, state});
  const values = selected.map((candidate) => Number(candidate && candidate.value || 0));
  if (!values.length) return null;
  const overall = values.reduce((sum, value) => sum + value, 0) / values.length;
  const scored = scoreSingleMaterialSearchSelection({selected, targetValue});
  return {
    state,
    selected,
    overall,
    scoreTuple: scored ? scored.tuple : null
  };
}

function replaceSingleMaterialCandidates(selected, replacementsByOldId) {
  return (Array.isArray(selected) ? selected : []).map((candidate) => {
    const key = String(candidate && candidate.id || "");
    return replacementsByOldId instanceof Map && replacementsByOldId.has(key)
      ? replacementsByOldId.get(key)
      : candidate;
  });
}

function calcSelectedMean(selected) {
  const values = (Array.isArray(selected) ? selected : []).map((item) => Number(item && item.value || 0));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function refineSingleMaterialCompensation({selected, below, upper, targetValue, maxIterations = 2} = {}) {
  let currentSelected = Array.isArray(selected) ? selected : [];
  let currentScore = scoreSingleMaterialSearchSelection({selected: currentSelected, targetValue});
  if (!currentScore) return null;
  const traceSteps = [];
  const allCandidatesById = new Map();
  for (const candidate of [...(Array.isArray(below) ? below : []), ...(Array.isArray(upper) ? upper : [])]) {
    const id = String(candidate && candidate.id || "");
    if (id && !allCandidatesById.has(id)) {
      allCandidatesById.set(id, candidate);
    }
  }

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const selectedIdSet = new Set(
      currentSelected.map((candidate) => String(candidate && candidate.id || "")).filter(Boolean)
    );
    const selectedBelow = currentSelected
      .filter((candidate) => Number(candidate && candidate.value || 0) < Number(targetValue) - EPSILON)
      .sort(compareByValueDesc);
    const unusedUpper = (Array.isArray(upper) ? upper : [])
      .filter((candidate) => !selectedIdSet.has(String(candidate && candidate.id || "")));
    if (!selectedBelow.length || !unusedUpper.length) break;

    let bestImprovement = null;
    const iterationDebug = {
      iteration: iteration + 1,
      currentOverall: Number(currentScore.overall),
      firstSwapAttempts: [],
      summary: {
        firstSwapAttempts: 0,
        secondSwapEvaluated: 0,
        secondSwapImproved: 0,
        rejected: {
          over_target: 0,
          not_better: 0
        }
      }
    };

    for (const oldBelowUp of selectedBelow) {
      const oldBelowUpId = String(oldBelowUp && oldBelowUp.id || "");
      if (!oldBelowUpId) continue;

      for (const newUpper of unusedUpper) {
        const newUpperId = String(newUpper && newUpper.id || "");
        if (!newUpperId) continue;
        const raise = Number(newUpper && newUpper.value || 0) - Number(oldBelowUp && oldBelowUp.value || 0);
        if (!(raise > EPSILON)) continue;

        const singleSwapMap = new Map([[oldBelowUpId, newUpper]]);
        const singleSwapSelected = replaceSingleMaterialCandidates(currentSelected, singleSwapMap);
        const singleSwapOverall = calcSelectedMean(singleSwapSelected);
        const singleSwapScore = scoreSingleMaterialSearchSelection({selected: singleSwapSelected, targetValue});
        const firstSwapAttempt = {
          firstSwap: {
            removedId: oldBelowUpId,
            removedValue: Number(oldBelowUp && oldBelowUp.value || 0),
            addedId: newUpperId,
            addedValue: Number(newUpper && newUpper.value || 0),
            overall: singleSwapOverall,
            delta: raise,
            accepted: false,
            rejectedReason: singleSwapScore
              ? "not_better"
              : "over_target"
          },
          secondSwap: {
            evaluated: 0,
            improved: 0,
            rejected: {
              over_target: 0,
              not_better: 0
            },
            best: null
          }
        };
        iterationDebug.summary.firstSwapAttempts += 1;
        if (
          singleSwapScore
          && compareScoreTuples(singleSwapScore.tuple, currentScore.tuple) < 0
          && (
            !bestImprovement
            || compareScoreTuples(singleSwapScore.tuple, bestImprovement.scoreTuple) < 0
          )
        ) {
          firstSwapAttempt.firstSwap.accepted = true;
          firstSwapAttempt.firstSwap.rejectedReason = null;
          bestImprovement = {
            selected: singleSwapSelected,
            overall: singleSwapScore.overall,
            scoreTuple: singleSwapScore.tuple,
            changes: [{
              removedIds: [oldBelowUpId],
                addedIds: [newUpperId]
              }]
          };
        }

        const usedAfterUpper = new Set(
          singleSwapSelected.map((candidate) => String(candidate && candidate.id || "")).filter(Boolean)
        );
        const availableAfterUpper = [...allCandidatesById.values()]
          .filter((candidate) => !usedAfterUpper.has(String(candidate && candidate.id || "")));
        if (!availableAfterUpper.length) {
          iterationDebug.firstSwapAttempts.push(firstSwapAttempt);
          continue;
        }

        let bestSecondSwapForAttempt = null;

        for (const oldCandidate of singleSwapSelected) {
          const oldCandidateId = String(oldCandidate && oldCandidate.id || "");
          if (!oldCandidateId) continue;

          for (const newCandidate of availableAfterUpper) {
            const newCandidateId = String(newCandidate && newCandidate.id || "");
            if (!newCandidateId) continue;

            firstSwapAttempt.secondSwap.evaluated += 1;
            iterationDebug.summary.secondSwapEvaluated += 1;
            const nextSelected = replaceSingleMaterialCandidates(
              singleSwapSelected,
              new Map([[oldCandidateId, newCandidate]])
            );
            const nextOverall = calcSelectedMean(nextSelected);
            const nextScore = scoreSingleMaterialSearchSelection({selected: nextSelected, targetValue});
            if (!nextScore) {
              firstSwapAttempt.secondSwap.rejected.over_target += 1;
              iterationDebug.summary.rejected.over_target += 1;
              continue;
            }
            if (compareScoreTuples(nextScore.tuple, currentScore.tuple) >= 0) {
              firstSwapAttempt.secondSwap.rejected.not_better += 1;
              iterationDebug.summary.rejected.not_better += 1;
              continue;
            }
            firstSwapAttempt.secondSwap.improved += 1;
            iterationDebug.summary.secondSwapImproved += 1;
            if (
              !bestSecondSwapForAttempt
              || compareScoreTuples(nextScore.tuple, bestSecondSwapForAttempt.scoreTuple) < 0
            ) {
              bestSecondSwapForAttempt = {
                removedId: oldCandidateId,
                removedValue: Number(oldCandidate && oldCandidate.value || 0),
                addedId: newCandidateId,
                addedValue: Number(newCandidate && newCandidate.value || 0),
                overall: nextOverall,
                gap: Number(targetValue) - Number(nextScore.overall),
                scoreTuple: nextScore.tuple
              };
            }
            if (
              !bestImprovement
              || compareScoreTuples(nextScore.tuple, bestImprovement.scoreTuple) < 0
            ) {
              bestImprovement = {
                selected: nextSelected,
                overall: nextScore.overall,
                scoreTuple: nextScore.tuple,
                changes: [
                  {
                    removedIds: [oldBelowUpId],
                    addedIds: [newUpperId]
                  },
                  {
                    removedIds: [oldCandidateId],
                    addedIds: [newCandidateId]
                  }
                ]
              };
            }
          }
        }

        firstSwapAttempt.secondSwap.best = bestSecondSwapForAttempt
          ? {
              removedId: bestSecondSwapForAttempt.removedId,
              removedValue: bestSecondSwapForAttempt.removedValue,
              addedId: bestSecondSwapForAttempt.addedId,
              addedValue: bestSecondSwapForAttempt.addedValue,
              overall: bestSecondSwapForAttempt.overall,
              gap: bestSecondSwapForAttempt.gap
            }
          : null;
        iterationDebug.firstSwapAttempts.push(firstSwapAttempt);
      }
    }

    if (!bestImprovement) break;
    currentSelected = bestImprovement.selected;
    currentScore = {
      overall: bestImprovement.overall,
      tuple: bestImprovement.scoreTuple
    };
    traceSteps.push({
      selected: currentSelected,
      overall: bestImprovement.overall,
      changes: bestImprovement.changes,
      debug: iterationDebug
    });
  }

  return {
    selected: currentSelected,
    overall: currentScore.overall,
    scoreTuple: currentScore.tuple,
    traceSteps
  };
}

function pickBestSingleMaterialShift(candidates, targetValue, {keepBelow} = {}) {
  let bestSameSide = null;
  let bestCrossSide = null;
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate) continue;
    const staysBelow = Number(candidate.overall) < Number(targetValue) - EPSILON;
    if (staysBelow === !!keepBelow) {
      if (!bestSameSide || compareOverallTowardsTarget(candidate, bestSameSide, targetValue, true) < 0) {
        bestSameSide = candidate;
      }
    } else if (!bestCrossSide || compareOverallTowardsTarget(candidate, bestCrossSide, targetValue, true) < 0) {
      bestCrossSide = candidate;
    }
  }
  return bestSameSide || bestCrossSide;
}

function searchSingleMaterialExact({group, targetValue}) {
  const material = group && group.material ? group.material : {};
  const count = Math.max(0, Number(material && material.count || 0));
  const candidates = Array.isArray(group && group.candidates) ? group.candidates : [];
  if (count <= 0 || candidates.length < count) return null;

  const prepared = candidates
    .map((candidate) => makeSearchCandidate({
      candidate,
      groupIndex: Number(group && group.index || 0),
      role: normalizeRole(material && material.role),
      targetValue
    }))
    .filter((candidate) => Number.isFinite(candidate.value));
  if (prepared.length < count) return null;

  const below = prepared
    .filter((candidate) => candidate.value < Number(targetValue) - EPSILON)
    .sort(compareByValueDesc);
  const upper = prepared
    .filter((candidate) => candidate.value >= Number(targetValue) - EPSILON)
    .sort(compareByValueAsc);

  let belowCount = Math.min(Math.floor(count / 2), below.length);
  let upperCount = Math.min(count - belowCount, upper.length);
  if (belowCount + upperCount < count) {
    const extraBelow = Math.min(count - belowCount - upperCount, Math.max(0, below.length - belowCount));
    belowCount += extraBelow;
  }
  if (belowCount + upperCount < count) {
    const extraUpper = Math.min(count - belowCount - upperCount, Math.max(0, upper.length - upperCount));
    upperCount += extraUpper;
  }
  if (belowCount + upperCount !== count) return null;

  let current = scoreSingleMaterialPushState({
    below,
    upper,
    state: {
      belowStart: 0,
      belowCount,
      upperStart: 0,
      upperCount
    },
    targetValue
  });
  if (!current) return null;

  const initialSides = countSingleMaterialSides(current.selected, targetValue);
  const trace = {
    mode: "single_material_balanced_push",
    steps: [
      makeSelectionTraceStep({
        stage: "initial",
        materialResults: [{
          material,
          available: candidates,
          selected: current.selected
        }],
        overall: current.overall,
        extra: {
          strategy: "balanced_center_push",
          ...initialSides
        }
      })
    ]
  };

  let bestBelow = Array.isArray(current.scoreTuple)
    ? {
        selected: current.selected,
        overall: current.overall,
        scoreTuple: current.scoreTuple
      }
    : null;
  const startedBelow = Number(current.overall) < Number(targetValue) - EPSILON;

  while (true) {
    const nextCandidates = [];
    if (Number(current.overall) < Number(targetValue) - EPSILON) {
      if (Number(current.state.upperStart) + Number(current.state.upperCount) < upper.length) {
        nextCandidates.push({
          ...scoreSingleMaterialPushState({
            below,
            upper,
            state: {
              ...current.state,
              upperStart: Number(current.state.upperStart) + 1
            },
            targetValue
          }),
          move: "upper_up"
        });
      }
      if (
        Number(current.state.belowCount) > 0
        && Number(current.state.upperStart) + Number(current.state.upperCount) < upper.length
      ) {
        nextCandidates.push({
          ...scoreSingleMaterialPushState({
            below,
            upper,
            state: {
              ...current.state,
              belowCount: Number(current.state.belowCount) - 1,
              upperCount: Number(current.state.upperCount) + 1
            },
            targetValue
          }),
          move: "split_up"
        });
      }
    } else {
      if (Number(current.state.belowStart) + Number(current.state.belowCount) < below.length) {
        nextCandidates.push({
          ...scoreSingleMaterialPushState({
            below,
            upper,
            state: {
              ...current.state,
              belowStart: Number(current.state.belowStart) + 1
            },
            targetValue
          }),
          move: "below_down"
        });
      }
      if (
        Number(current.state.upperCount) > 0
        && Number(current.state.belowStart) + Number(current.state.belowCount) < below.length
      ) {
        nextCandidates.push({
          ...scoreSingleMaterialPushState({
            below,
            upper,
            state: {
              ...current.state,
              belowCount: Number(current.state.belowCount) + 1,
              upperCount: Number(current.state.upperCount) - 1
            },
            targetValue
          }),
          move: "split_down"
        });
      }
    }

    const next = pickBestSingleMaterialShift(nextCandidates, targetValue, {
      keepBelow: Number(current.overall) < Number(targetValue) - EPSILON
    });
    if (!next) break;
    current = next;
    const sides = countSingleMaterialSides(current.selected, targetValue);
    trace.steps.push(makeSelectionTraceStep({
      stage: "push",
      materialResults: [{
        material,
        available: candidates,
        selected: current.selected
      }],
      overall: current.overall,
      extra: {
        strategy: "balanced_center_push",
        move: String(current.move || ""),
        ...sides
      }
    }));

    if (
      Array.isArray(current.scoreTuple)
      && (
        !bestBelow
        || compareScoreTuples(current.scoreTuple, bestBelow.scoreTuple) < 0
      )
    ) {
      bestBelow = {
        selected: current.selected,
        overall: current.overall,
        scoreTuple: current.scoreTuple
      };
    }

    const isBelow = Number(current.overall) < Number(targetValue) - EPSILON;
    if (startedBelow ? !isBelow : isBelow) break;
  }

  if (!bestBelow) return null;
  const compensated = refineSingleMaterialCompensation({
    selected: bestBelow.selected,
    below,
    upper,
    targetValue
  });
  if (compensated && compareScoreTuples(compensated.scoreTuple, bestBelow.scoreTuple) < 0) {
    bestBelow = {
      selected: compensated.selected,
      overall: compensated.overall,
      scoreTuple: compensated.scoreTuple
    };
    for (const step of Array.isArray(compensated.traceSteps) ? compensated.traceSteps : []) {
      const stepSides = countSingleMaterialSides(step.selected, targetValue);
      trace.steps.push(makeSelectionTraceStep({
        stage: "refine_compensate",
        materialResults: [{
          material,
          available: candidates,
          selected: step.selected
        }],
        overall: step.overall,
        extra: {
          strategy: "balanced_center_push",
          changes: Array.isArray(step.changes) ? step.changes : [],
          debug: step && step.debug ? step.debug : null,
          ...stepSides
        }
      }));
    }
  }
  const materialResults = [{
    material,
    available: candidates,
    selected: bestBelow.selected
  }];
  const finalSides = countSingleMaterialSides(bestBelow.selected, targetValue);
  trace.steps.push(makeSelectionTraceStep({
    stage: "final",
    materialResults,
    overall: bestBelow.overall,
    extra: {
      strategy: "balanced_center_push",
      ...finalSides
    }
  }));
  return {
    materialResults,
    overall: Number(bestBelow.overall),
    scoreTuple: bestBelow.scoreTuple,
    windowExtra: 0,
    trace
  };
}

function sortCandidatesByValueAsc(candidates) {
  return [...(Array.isArray(candidates) ? candidates : [])].sort(compareByValueAsc);
}

function calcSelectedOverallFromMaterialResults(materialResults) {
  const values = [];
  for (const entry of Array.isArray(materialResults) ? materialResults : []) {
    for (const candidate of Array.isArray(entry && entry.selected) ? entry.selected : []) {
      values.push(Number(candidate && candidate.value || 0));
    }
  }
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildRoleAwarePushGroups(groups, targetValue) {
  return (Array.isArray(groups) ? groups : []).map((group, index) => {
    const material = group && group.material ? group.material : {};
    const role = normalizeRole(material && material.role);
    const ordered = sortCandidatesByValueAsc(
      (Array.isArray(group && group.candidates) ? group.candidates : [])
        .map((candidate) => makeSearchCandidate({
          candidate,
          groupIndex: Number(group && group.index != null ? group.index : index),
          role,
          targetValue
        }))
        .filter((candidate) => Number.isFinite(candidate.value))
    );
    const count = Math.max(0, Number(material && material.count || 0));
    if (ordered.length < count || count <= 0) {
      return {
        index: Number(group && group.index != null ? group.index : index),
        material,
        ordered,
        start: 0,
        end: -1,
        valid: false
      };
    }
    const split = lowerBoundByValueAsc(ordered, Number(targetValue));
    let start = 0;
    if (role === "aux") {
      const belowCount = Math.min(count, split);
      start = Math.max(0, split - belowCount);
    } else {
      const aboveCount = Math.min(count, ordered.length - split);
      const belowCount = count - aboveCount;
      start = Math.max(0, split - belowCount);
    }
    return {
      index: Number(group && group.index != null ? group.index : index),
      material,
      ordered,
      start,
      end: start + count - 1,
      valid: true
    };
  });
}

function materialResultsFromPushGroups(pushGroups) {
  return (Array.isArray(pushGroups) ? pushGroups : []).map((group) => ({
    material: group.material,
    available: group.ordered,
    selected: group.ordered.slice(group.start, group.end + 1)
  }));
}

function collectSelectedIdsFromMaterialResults(materialResults) {
  const ids = [];
  for (const entry of Array.isArray(materialResults) ? materialResults : []) {
    for (const candidate of Array.isArray(entry && entry.selected) ? entry.selected : []) {
      const id = String(candidate && candidate.id || "");
      if (id) ids.push(id);
    }
  }
  return ids.sort();
}

function buildTraceMaterialFields(material) {
  const projection = projectCraftAssistTraceMaterial(material);
  return {
    materialName: projection.materialName,
    primary_name: projection.primary_name,
    item_names: projection.item_names,
    label: projection.label
  };
}

function buildTraceGroupsFromMaterialResults(materialResults) {
  return (Array.isArray(materialResults) ? materialResults : []).map((entry, index) => ({
    index,
    ...buildTraceMaterialFields(entry && entry.material),
    role: normalizeRole(entry && entry.material && entry.material.role),
    selectedIds: (Array.isArray(entry && entry.selected) ? entry.selected : [])
      .map((candidate) => String(candidate && candidate.id || ""))
      .filter(Boolean)
      .sort()
  }));
}

function describeMaterialResultsDelta(beforeResults, afterResults) {
  const changes = [];
  const beforeList = Array.isArray(beforeResults) ? beforeResults : [];
  const afterList = Array.isArray(afterResults) ? afterResults : [];
  const maxLen = Math.max(beforeList.length, afterList.length);
  for (let index = 0; index < maxLen; index += 1) {
    const beforeIds = new Set(
      (Array.isArray(beforeList[index] && beforeList[index].selected) ? beforeList[index].selected : [])
        .map((candidate) => String(candidate && candidate.id || ""))
        .filter(Boolean)
    );
    const afterIds = new Set(
      (Array.isArray(afterList[index] && afterList[index].selected) ? afterList[index].selected : [])
        .map((candidate) => String(candidate && candidate.id || ""))
        .filter(Boolean)
    );
    const removedIds = [...beforeIds].filter((id) => !afterIds.has(id)).sort();
    const addedIds = [...afterIds].filter((id) => !beforeIds.has(id)).sort();
    if (!removedIds.length && !addedIds.length) continue;
    changes.push({
      index,
      ...buildTraceMaterialFields(
        afterList[index] && afterList[index].material
        || beforeList[index] && beforeList[index].material
      ),
      role: normalizeRole(
        afterList[index] && afterList[index].material && afterList[index].material.role
        || beforeList[index] && beforeList[index].material && beforeList[index].material.role
      ),
      removedIds,
      addedIds
    });
  }
  return changes;
}

function makeSelectionTraceStep({stage, materialResults, overall, extra} = {}) {
  return {
    stage: String(stage || "").trim() || "unknown",
    overall: Number(overall),
    selectedIds: collectSelectedIdsFromMaterialResults(materialResults),
    groups: buildTraceGroupsFromMaterialResults(materialResults),
    ...(extra && typeof extra === "object" ? extra : {})
  };
}

function scorePushGroupsBelowTarget(pushGroups, targetValue) {
  const materialResults = materialResultsFromPushGroups(pushGroups);
  const overall = calcSelectedOverallFromMaterialResults(materialResults);
  if (overall == null || !(overall < Number(targetValue) - EPSILON)) return null;
  const selected = [];
  for (const entry of materialResults) {
    selected.push(...entry.selected);
  }
  const scored = scoreCraftAssistSolutionMultiMaterial({selected, targetValue});
  if (!scored) return null;
  return {
    pushGroups,
    materialResults,
    overall: scored.overall,
    scoreTuple: scored.tuple
  };
}

function clonePushGroupsWithShift(pushGroups, groupIndex, direction) {
  return (Array.isArray(pushGroups) ? pushGroups : []).map((group, index) => {
    if (index !== groupIndex) return group;
    if (direction === "down") {
      return {
        ...group,
        start: group.start - 1,
        end: group.end - 1
      };
    }
    return {
      ...group,
      start: group.start + 1,
      end: group.end + 1
    };
  });
}

function canShiftPushGroup(group, direction) {
  if (!group || group.valid === false) return false;
  if (direction === "down") return Number(group.start) > 0;
  return Number(group.end) + 1 < (Array.isArray(group.ordered) ? group.ordered.length : 0);
}

function compareOverallTowardsTarget(a, b, targetValue, preferBelow) {
  const gapA = Math.abs(Number(targetValue) - Number(a && a.overall));
  const gapB = Math.abs(Number(targetValue) - Number(b && b.overall));
  if (Math.abs(gapA - gapB) > 1e-12) return gapA - gapB;
  const belowA = Number(a && a.overall) < Number(targetValue) - EPSILON;
  const belowB = Number(b && b.overall) < Number(targetValue) - EPSILON;
  if (belowA !== belowB) return preferBelow ? (belowA ? -1 : 1) : (belowA ? 1 : -1);
  if (belowA && belowB && Array.isArray(a && a.scoreTuple) && Array.isArray(b && b.scoreTuple)) {
    return compareScoreTuples(a.scoreTuple, b.scoreTuple);
  }
  return 0;
}

function compareDirectionalCandidates(a, b, targetValue) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const keepBelow = !!(a.phase && a.phase.keepBelow);
  const sameSideA = (Number(a && a.overall) < Number(targetValue) - EPSILON) === keepBelow;
  const sameSideB = (Number(b && b.overall) < Number(targetValue) - EPSILON) === keepBelow;
  if (sameSideA !== sameSideB) return sameSideA ? -1 : 1;
  const overallCmp = compareOverallTowardsTarget(a, b, targetValue, keepBelow);
  if (overallCmp !== 0) return overallCmp;
  if (Array.isArray(a && a.scoreTuple) && Array.isArray(b && b.scoreTuple)) {
    return compareScoreTuples(a.scoreTuple, b.scoreTuple);
  }
  return 0;
}

function pickBestPhaseDirectionalShift(pushGroups, targetValue, phases) {
  let best = null;
  for (const phase of Array.isArray(phases) ? phases : []) {
    const candidate = pickBestDirectionalShift(pushGroups, targetValue, phase);
    if (!candidate) continue;
    const enriched = {
      ...candidate,
      phase
    };
    if (!best || compareDirectionalCandidates(enriched, best, targetValue) < 0) {
      best = enriched;
    }
  }
  return best;
}

function pickBestDirectionalShift(pushGroups, targetValue, {role, direction, keepBelow} = {}) {
  let bestSameSide = null;
  let bestCrossSide = null;
  for (let index = 0; index < pushGroups.length; index += 1) {
    const group = pushGroups[index];
    if (normalizeRole(group && group.material && group.material.role) !== normalizeRole(role)) continue;
    if (!canShiftPushGroup(group, direction)) continue;
    const nextGroups = clonePushGroupsWithShift(pushGroups, index, direction);
    const nextMaterialResults = materialResultsFromPushGroups(nextGroups);
    const nextOverall = calcSelectedOverallFromMaterialResults(nextMaterialResults);
    if (nextOverall == null) continue;
    const nextBelowScore = scorePushGroupsBelowTarget(nextGroups, targetValue);
    const candidate = {
      pushGroups: nextGroups,
      materialResults: nextMaterialResults,
      overall: Number(nextOverall),
      scoreTuple: nextBelowScore ? nextBelowScore.scoreTuple : null
    };
    const staysBelow = Number(nextOverall) < Number(targetValue) - EPSILON;
    if (staysBelow === !!keepBelow) {
      if (!bestSameSide || compareOverallTowardsTarget(candidate, bestSameSide, targetValue, true) < 0) {
        bestSameSide = candidate;
      }
    } else if (!bestCrossSide || compareOverallTowardsTarget(candidate, bestCrossSide, targetValue, true) < 0) {
      bestCrossSide = candidate;
    }
  }
  return bestSameSide || bestCrossSide;
}

function searchRoleAwarePushSolution({groups, targetValue} = {}) {
  const pushGroups = buildRoleAwarePushGroups(groups, targetValue);
  if (!pushGroups.length || pushGroups.some((group) => group.valid === false)) return null;

  let currentGroups = pushGroups;
  let currentMaterialResults = materialResultsFromPushGroups(currentGroups);
  let currentOverall = calcSelectedOverallFromMaterialResults(currentMaterialResults);
  if (currentOverall == null) return null;
  const trace = {
    mode: "multi_material_role_push",
    steps: [
      makeSelectionTraceStep({
        stage: "initial",
        materialResults: currentMaterialResults,
        overall: currentOverall
      })
    ]
  };

  let bestBelow = scorePushGroupsBelowTarget(currentGroups, targetValue);
  const startedBelow = Number(currentOverall) < Number(targetValue) - EPSILON;
  const primary = startedBelow
    ? {role: "main", direction: "up", keepBelow: true}
    : {role: "aux", direction: "down", keepBelow: false};
  const secondary = startedBelow
    ? {role: "aux", direction: "up", keepBelow: true}
    : {role: "main", direction: "down", keepBelow: false};

  while (true) {
    const next = pickBestPhaseDirectionalShift(currentGroups, targetValue, [primary, secondary]);
    if (!next) break;
    const previousMaterialResults = currentMaterialResults;
    currentGroups = next.pushGroups;
    currentMaterialResults = next.materialResults;
    currentOverall = next.overall;
    const isBelow = Number(currentOverall) < Number(targetValue) - EPSILON;
    trace.steps.push(makeSelectionTraceStep({
      stage: "push",
      materialResults: currentMaterialResults,
      overall: currentOverall,
      extra: {
        role: String(next.phase && next.phase.role || ""),
        direction: String(next.phase && next.phase.direction || ""),
        crossedTarget: startedBelow ? !isBelow : isBelow,
        changes: describeMaterialResultsDelta(previousMaterialResults, currentMaterialResults)
      }
    }));
    const nextBelow = scorePushGroupsBelowTarget(currentGroups, targetValue);
    if (nextBelow && (!bestBelow || compareScoreTuples(nextBelow.scoreTuple, bestBelow.scoreTuple) < 0)) {
      bestBelow = nextBelow;
    }
    if (startedBelow ? !isBelow : isBelow) break;
  }

  if (!bestBelow) return null;

  let refined = bestBelow;
  while (true) {
    let bestSingle = null;
    for (const phase of [
      {role: "main", direction: "up", keepBelow: true},
      {role: "aux", direction: "up", keepBelow: true}
    ]) {
      const candidate = pickBestDirectionalShift(refined.pushGroups, targetValue, phase);
      if (!candidate) continue;
      const scored = scorePushGroupsBelowTarget(candidate.pushGroups, targetValue);
      if (!scored) continue;
      if (
        compareScoreTuples(scored.scoreTuple, refined.scoreTuple) < 0
        && (!bestSingle || compareScoreTuples(scored.scoreTuple, bestSingle.scoreTuple) < 0)
      ) {
        bestSingle = {
          ...scored,
          phase,
          changes: describeMaterialResultsDelta(refined.materialResults, scored.materialResults)
        };
      }
    }
    if (!bestSingle) break;
    trace.steps.push(makeSelectionTraceStep({
      stage: "refine_shift",
      materialResults: bestSingle.materialResults,
      overall: bestSingle.overall,
      extra: {
        role: String(bestSingle.phase && bestSingle.phase.role || ""),
        direction: String(bestSingle.phase && bestSingle.phase.direction || ""),
        changes: bestSingle.changes
      }
    }));
    refined = bestSingle;
  }

  const polished = refineRoleAwareMaterialResults({
    materialResults: refined.materialResults,
    targetValue,
    approachMode: "below"
  });
  if (polished && compareScoreTuples(polished.scoreTuple, refined.scoreTuple) < 0) {
    for (const step of Array.isArray(polished.traceSteps) ? polished.traceSteps : []) {
      trace.steps.push(makeSelectionTraceStep({
        stage: "refine_swap",
        materialResults: step.materialResults,
        overall: step.overall,
        extra: {
          pattern: String(step.pattern || ""),
          changes: Array.isArray(step.changes) ? step.changes : []
        }
      }));
    }
    trace.steps.push(makeSelectionTraceStep({
      stage: "final",
      materialResults: polished.materialResults,
      overall: polished.overall
    }));
    return {
      ...polished,
      trace
    };
  }
  trace.steps.push(makeSelectionTraceStep({
    stage: "final",
    materialResults: refined.materialResults,
    overall: refined.overall
  }));
  return {
    ...refined,
    trace
  };
}

function scorePartialState(state, totalSlots, targetValue, mode, approachMode = "below", targetStepSpec = null) {
  const selected = Array.isArray(state && state.selected) ? state.selected : [];
  const count = selected.length;
  const searchTarget = resolveSearchTargetValue(targetValue, targetStepSpec);
  if (count <= 0) {
    if (hasTargetStepSpec(targetStepSpec)) {
      const emptyGap = distanceFromMeanToTargetRange(0, targetStepSpec);
      if (mode === "multi_material_role") return [emptyGap, 0, 0, 0, 0, 0];
      if (mode === "single_material") return [emptyGap, 0, 0, 0, 0, 0];
      return [emptyGap, 0, 0, 0, 0];
    }
    if (normalizeApproachMode(approachMode) === "infinite") {
      const emptyGap = Math.abs(Number(targetValue));
      if (mode === "single_material") return [emptyGap, 0, 0, 0, 0, 0];
      if (mode === "multi_material_role") return [emptyGap, 0, 0, 0, 0, 0];
      return [emptyGap, 0, 0, 0, 0];
    }
    if (mode === "single_material") return [0, Number(targetValue), 0, 0, 0];
    return [Number(targetValue), 0, 0, 0, 0];
  }
  const values = selected.map((item) => Number(item && item.value || 0));
  const projectedOverall = (
    values.reduce((sum, value) => sum + value, 0)
    + searchTarget * Math.max(0, totalSlots - count)
  ) / totalSlots;
  const radius = Math.max(...values.map((value) => Math.abs(value - searchTarget)));
  if (hasTargetStepSpec(targetStepSpec)) {
    const projectedPriority = targetStepPriorityTuple(projectedOverall, primaryOnlyTargetStepSpec(targetStepSpec));
    if (mode === "single_material") {
      const above = values.filter((value) => value > searchTarget + EPSILON).length;
      const below = values.filter((value) => value < searchTarget - EPSILON).length;
      return [
        ...projectedPriority,
        radius,
        Math.abs(above - below),
        calcVariance(values),
        values.reduce((sum, value) => sum + Math.abs(value - searchTarget), 0) / values.length
      ];
    }
    if (mode === "multi_material_role") {
      const mains = selected
        .filter((item) => normalizeRole(item && item.role) === "main")
        .map((item) => Number(item.value || 0));
      const auxes = selected
        .filter((item) => normalizeRole(item && item.role) === "aux")
        .map((item) => Number(item.value || 0));
      const wrongSidePenalty = mains.filter((value) => value < searchTarget - EPSILON).length
        + auxes.filter((value) => value > searchTarget + EPSILON).length;
      const mainMean = mains.length ? mains.reduce((sum, value) => sum + value, 0) / mains.length : 0;
      const auxMean = auxes.length ? auxes.reduce((sum, value) => sum + value, 0) / auxes.length : 0;
      return [
        ...projectedPriority,
        wrongSidePenalty,
        -mainMean,
        auxMean,
        radius
      ];
    }
    return [
      ...projectedPriority,
      radius,
      calcVariance(values),
      values.reduce((sum, value) => sum + Math.abs(value - searchTarget), 0) / values.length
    ];
  }
  if (normalizeApproachMode(approachMode) === "infinite") {
    const projectedGap = Math.abs(Number(targetValue) - projectedOverall);
    const projectedAbovePenalty = projectedOverall > Number(targetValue) + EPSILON ? 1 : 0;
    if (mode === "single_material") {
      const above = values.filter((value) => value > Number(targetValue) + EPSILON).length;
      const below = values.filter((value) => value < Number(targetValue) - EPSILON).length;
      return [
        projectedGap,
        projectedAbovePenalty,
        radius,
        Math.abs(above - below),
        calcVariance(values),
        values.reduce((sum, value) => sum + Math.abs(value - Number(targetValue)), 0) / values.length
      ];
    }
    if (mode === "multi_material_role") {
      const mains = selected
        .filter((item) => normalizeRole(item && item.role) === "main")
        .map((item) => Number(item.value || 0));
      const auxes = selected
        .filter((item) => normalizeRole(item && item.role) === "aux")
        .map((item) => Number(item.value || 0));
      const wrongSidePenalty = mains.filter((value) => value < Number(targetValue) - EPSILON).length
        + auxes.filter((value) => value > Number(targetValue) + EPSILON).length;
      const mainMean = mains.length ? mains.reduce((sum, value) => sum + value, 0) / mains.length : 0;
      const auxMean = auxes.length ? auxes.reduce((sum, value) => sum + value, 0) / auxes.length : 0;
      return [
        projectedGap,
        projectedAbovePenalty,
        wrongSidePenalty,
        -mainMean,
        auxMean,
        radius
      ];
    }
    return [
      projectedGap,
      projectedAbovePenalty,
      radius,
      calcVariance(values),
      values.reduce((sum, value) => sum + Math.abs(value - Number(targetValue)), 0) / values.length
    ];
  }
  if (mode === "single_material") {
    const above = values.filter((value) => value > Number(targetValue) + EPSILON).length;
    const below = values.filter((value) => value < Number(targetValue) - EPSILON).length;
    return [
      radius,
      Math.abs(Number(targetValue) - projectedOverall),
      Math.abs(above - below),
      calcVariance(values),
      values.reduce((sum, value) => sum + Math.abs(value - Number(targetValue)), 0) / values.length
    ];
  }
  if (mode === "multi_material_role") {
    const mains = selected
      .filter((item) => normalizeRole(item && item.role) === "main")
      .map((item) => Number(item.value || 0));
    const auxes = selected
      .filter((item) => normalizeRole(item && item.role) === "aux")
      .map((item) => Number(item.value || 0));
    const wrongSidePenalty = mains.filter((value) => value < Number(targetValue) - EPSILON).length
      + auxes.filter((value) => value > Number(targetValue) + EPSILON).length;
    const mainMean = mains.length ? mains.reduce((sum, value) => sum + value, 0) / mains.length : 0;
    const auxMean = auxes.length ? auxes.reduce((sum, value) => sum + value, 0) / auxes.length : 0;
    return [
      Math.abs(Number(targetValue) - projectedOverall),
      wrongSidePenalty,
      -mainMean,
      auxMean,
      radius
    ];
  }
  return [
    Math.abs(Number(targetValue) - projectedOverall),
    radius,
    calcVariance(values),
    values.reduce((sum, value) => sum + Math.abs(value - Number(targetValue)), 0) / values.length
  ];
}

function expandMaterialSlots(groups, windows) {
  const ordered = (Array.isArray(groups) ? groups : [])
    .map((group, index) => ({
      index,
      count: Math.max(0, Number(group && group.material && group.material.count || 0)),
      width: Array.isArray(windows && windows[index]) ? windows[index].length : 0
    }))
    .sort((a, b) => a.width - b.width || a.count - b.count || a.index - b.index);
  const slots = [];
  for (const entry of ordered) {
    for (let i = 0; i < entry.count; i += 1) {
      slots.push(entry.index);
    }
  }
  return slots;
}

function buildCanonicalStateKey(state) {
  const slotIndex = Number(state && state.slotIndex || 0);
  const groups = Array.isArray(state && state.selectedIdsByGroup) ? state.selectedIdsByGroup : [];
  const groupKey = groups.map((ids) => (Array.isArray(ids) ? ids.join(",") : "")).join(";");
  return `${slotIndex}|${groupKey}`;
}

function pruneBeam(states, beamWidth, totalSlots, targetValue, mode, approachMode = "below", targetStepSpec = null) {
  const bestByKey = new Map();
  for (const state of Array.isArray(states) ? states : []) {
    const score = scorePartialState(state, totalSlots, targetValue, mode, approachMode, targetStepSpec);
    const key = buildCanonicalStateKey(state);
    const existing = bestByKey.get(key);
    if (!existing || compareScoreTuples(score, existing.score) < 0) {
      bestByKey.set(key, {state, score});
    }
  }
  const scored = [...bestByKey.values()];
  scored.sort((a, b) => compareScoreTuples(a.score, b.score));
  return scored.slice(0, Math.max(1, Number(beamWidth) || 1)).map((entry) => entry.state);
}

function pickBestCompleteSolution(states, targetValue, mode, approachMode = "below", targetStepSpec = null, profileStats = null) {
  let best = null;
  for (const state of Array.isArray(states) ? states : []) {
    if (profileStats && typeof profileStats === "object") {
      profileStats.completeScoreAttempts = Number(profileStats.completeScoreAttempts || 0) + 1;
    }
    const scored = scoreCompleteSelection(state.selected, targetValue, mode, approachMode, targetStepSpec);
    if (!scored) continue;
    const candidate = {
      selected: state.selected,
      overall: scored.overall,
      predictedStepMean: scored.predictedStepMean,
      scoreTuple: scored.tuple
    };
    if (hasTargetStepSpec(targetStepSpec) && isMeanOnPrimaryTargetStep(scored.overall, targetStepSpec)) {
      return candidate;
    }
    if (!best || compareScoreTuples(scored.tuple, best.scoreTuple) < 0) {
      best = candidate;
    }
  }
  return best;
}

function cloneBeamSearchSolution(solution) {
  if (!solution) return null;
  return {
    ...solution,
    selected: Array.isArray(solution.selected) ? solution.selected.slice() : [],
    scoreTuple: Array.isArray(solution.scoreTuple) ? solution.scoreTuple.slice() : solution.scoreTuple
  };
}

function buildTargetStepFallbackRefinementScore(selected, targetValue, targetStepSpec) {
  const scored = scoreCraftAssistSolutionSingleMaterial({
    selected,
    targetValue,
    approachMode: "infinite",
    targetStepSpec
  });
  if (!scored || isMeanOnPrimaryTargetStep(scored.overall, targetStepSpec)) return null;
  if (!isMeanOnTargetStep(scored.overall, targetStepSpec)) return null;
  return scored;
}

function refineSingleMaterialTargetStepFallback({selected, candidates, targetValue, targetStepSpec} = {}) {
  const currentSelected = Array.isArray(selected) ? selected : [];
  const allCandidates = Array.isArray(candidates) ? candidates : [];
  if (!currentSelected.length || !allCandidates.length || !hasTargetStepSpec(targetStepSpec)) return null;
  let bestScore = buildTargetStepFallbackRefinementScore(currentSelected, targetValue, targetStepSpec);
  if (!bestScore) return null;
  let bestSelected = currentSelected;
  let scoredAttempts = 0;
  let skippedByWindow = 0;
  let skippedByRawGap = 0;
  const selectedValues = currentSelected.map((candidate) => Number(candidate && candidate.value || 0));
  const selectedSum = selectedValues.reduce((sum, value) => sum + value, 0);
  const selectedCount = currentSelected.length;
  const rawTarget = Number(targetStepSpec && (targetStepSpec.inputRaw ?? targetStepSpec.targetWearRaw));
  const canPrefilterByRawGap = (
    Number.isFinite(rawTarget)
    && normalizeApproachMode(targetStepSpec && targetStepSpec.approachMode) === "below"
  );
  const lowerBound = Number(targetStepSpec && targetStepSpec.lowerBound);
  const upperBound = Number(targetStepSpec && targetStepSpec.upperBound);
  const cannotImproveBestRawGap = (nextMean) => (
    canPrefilterByRawGap
    && Number(nextMean) < Number(bestScore.overall) - 1e-12
  );
  const cannotReachFallbackTargetStep = (nextMean) => {
    if (!Number.isFinite(nextMean)) return true;
    if (canPrefilterByRawGap && !isBelowTarget(nextMean, rawTarget)) return true;
    if (Number.isFinite(lowerBound) && nextMean < lowerBound - EPSILON) return true;
    if (Number.isFinite(upperBound) && nextMean > upperBound + EPSILON) return true;
    return false;
  };
  const selectedIdSet = new Set(
    currentSelected.map((candidate) => String(candidate && candidate.id || "")).filter(Boolean)
  );
  const unused = allCandidates.filter((candidate) => {
    const id = String(candidate && candidate.id || "");
    return id && !selectedIdSet.has(id);
  });

  for (let removeIndex = 0; removeIndex < currentSelected.length; removeIndex += 1) {
    for (const addCandidate of unused) {
      const nextMean = (selectedSum - selectedValues[removeIndex] + Number(addCandidate && addCandidate.value || 0)) / selectedCount;
      if (cannotReachFallbackTargetStep(nextMean)) {
        skippedByWindow += 1;
        continue;
      }
      if (cannotImproveBestRawGap(nextMean)) {
        skippedByRawGap += 1;
        continue;
      }
      const nextSelected = currentSelected.slice();
      nextSelected[removeIndex] = addCandidate;
      scoredAttempts += 1;
      const nextScore = buildTargetStepFallbackRefinementScore(nextSelected, targetValue, targetStepSpec);
      if (nextScore && compareScoreTuples(nextScore.tuple, bestScore.tuple) < 0) {
        bestScore = nextScore;
        bestSelected = nextSelected;
      }
    }
  }

  for (let firstRemove = 0; firstRemove < currentSelected.length; firstRemove += 1) {
    for (let secondRemove = firstRemove + 1; secondRemove < currentSelected.length; secondRemove += 1) {
      for (let firstAdd = 0; firstAdd < unused.length; firstAdd += 1) {
        for (let secondAdd = firstAdd + 1; secondAdd < unused.length; secondAdd += 1) {
          const nextMean = (
            selectedSum
            - selectedValues[firstRemove]
            - selectedValues[secondRemove]
            + Number(unused[firstAdd] && unused[firstAdd].value || 0)
            + Number(unused[secondAdd] && unused[secondAdd].value || 0)
          ) / selectedCount;
          if (cannotReachFallbackTargetStep(nextMean)) {
            skippedByWindow += 1;
            continue;
          }
          if (cannotImproveBestRawGap(nextMean)) {
            skippedByRawGap += 1;
            continue;
          }
          const nextSelected = currentSelected.slice();
          nextSelected[firstRemove] = unused[firstAdd];
          nextSelected[secondRemove] = unused[secondAdd];
          scoredAttempts += 1;
          const nextScore = buildTargetStepFallbackRefinementScore(nextSelected, targetValue, targetStepSpec);
          if (nextScore && compareScoreTuples(nextScore.tuple, bestScore.tuple) < 0) {
            bestScore = nextScore;
            bestSelected = nextSelected;
          }
        }
      }
    }
  }

  return {
    selected: bestSelected,
    overall: bestScore.overall,
    predictedStepMean: bestScore.predictedStepMean,
    scoreTuple: bestScore.tuple,
    refinementStats: {
      scoredAttempts,
      skippedByWindow,
      skippedByRawGap,
      skippedAttempts: skippedByWindow + skippedByRawGap
    }
  };
}

function buildSingleMaterialTargetStepFallbackRefinementCacheKey({selected, candidates, targetValue, targetStepSpec} = {}) {
  const encodeCandidate = (candidate) => [
    String(candidate && candidate.id || ""),
    Number(candidate && candidate.value || 0)
  ].join(":");
  const selectedKey = (Array.isArray(selected) ? selected : []).map(encodeCandidate).join(",");
  const candidatesKey = (Array.isArray(candidates) ? candidates : []).map(encodeCandidate).join(",");
  const specKey = [
    Number(targetValue),
    Number(targetStepSpec && targetStepSpec.inputStep),
    Number(targetStepSpec && (targetStepSpec.inputRaw ?? targetStepSpec.targetWearRaw)),
    Number(targetStepSpec && targetStepSpec.targetStep),
    Number(targetStepSpec && targetStepSpec.lowerTargetStep),
    Number(targetStepSpec && targetStepSpec.upperTargetStep),
    Number(targetStepSpec && targetStepSpec.lowerBound),
    Number(targetStepSpec && targetStepSpec.upperBound),
    String(targetStepSpec && targetStepSpec.approachMode || "")
  ].join("|");
  return `${specKey}|${selectedKey}|${candidatesKey}`;
}

function candidateTouchesCapBoundary(selected, groupsWithOrdered, capExtra) {
  const list = Array.isArray(selected) ? selected : [];
  for (const candidate of list) {
    const groupIndex = Number(candidate && candidate.groupIndex || 0);
    const group = groupsWithOrdered[groupIndex];
    if (!group) continue;
    const need = Math.max(0, Number(group && group.material && group.material.count || 0));
    const limit = Math.min(group.ordered.length, need + capExtra);
    const boundaryIndex = Math.max(0, limit - WINDOW_BOUNDARY_MARGIN);
    if (Number(candidate && candidate.orderedIndex || 0) >= boundaryIndex) {
      return true;
    }
  }
  return false;
}

function shouldStopTargetStepExpansion({solved, groupsWithOrdered, capExtra, targetStepSpec}) {
  if (!hasTargetStepSpec(targetStepSpec) || !solved) return false;
  return isMeanOnPrimaryTargetStep(solved.overall, targetStepSpec);
}

function shouldStopAfterStableTargetWindowFallback({solved, groupsWithOrdered, capExtra, targetStepSpec}) {
  if (!Array.isArray(groupsWithOrdered) || groupsWithOrdered.length !== 1) return false;
  if (!hasTargetStepSpec(targetStepSpec) || !solved) return false;
  if (!isMeanOnTargetStep(solved.overall, targetStepSpec)) return false;
  if (isMeanOnPrimaryTargetStep(solved.overall, targetStepSpec)) return false;
  if (Number(capExtra) < INITIAL_WINDOW_EXTRA_CAP) return false;
  return !candidateTouchesCapBoundary(solved.selected, groupsWithOrdered, capExtra);
}

function shouldStopAfterBoundedTargetWindowFallback({best, solved, groupsWithOrdered, capExtra, targetStepSpec}) {
  if (!shouldStopAfterStableTargetWindowFallback({solved: best, groupsWithOrdered, capExtra, targetStepSpec})) {
    return false;
  }
  if (!solved) return true;
  return !candidateTouchesCapBoundary(solved.selected, groupsWithOrdered, capExtra);
}

function runBeamSearchWithinCap({groupsWithOrdered, targetValue, beamWidth, mode, totalSlots, capExtra, approachMode = "below", targetStepSpec = null, onSearchProfile = null, innerExtraResultCache = null}) {
  let best = null;
  const profileEnabled = typeof onSearchProfile === "function";
  const capStartedAt = profileEnabled ? Date.now() : 0;
  const capProfile = profileEnabled
    ? {
      phase: "beam_cap",
      capExtra: Number(capExtra || 0),
      totalSlots: Number(totalSlots || 0),
      innerExtras: [],
      cacheHits: 0,
      cacheMisses: 0,
      reusedInnerExtras: 0,
      stopReason: "",
      elapsedMs: 0
    }
    : null;
  const finishCapProfile = (stopReason) => {
    if (!profileEnabled) return;
    capProfile.stopReason = String(stopReason || "completed_cap");
    capProfile.elapsedMs = Math.max(0, Date.now() - capStartedAt);
    onSearchProfile(capProfile);
  };
  for (let extra = 0; extra <= capExtra; extra += 1) {
    const innerStartedAt = profileEnabled ? Date.now() : 0;
    const windows = groupsWithOrdered.map((group) => {
      const need = Math.max(0, Number(group && group.material && group.material.count || 0));
      const limit = Math.min(group.ordered.length, need + capExtra);
      return group.ordered.slice(0, Math.min(limit, need + extra));
    });
    const innerProfile = profileEnabled
      ? {
        extra: Number(extra),
        windowSizes: windows.map((window) => Array.isArray(window) ? window.length : 0),
        slotCount: 0,
        beamInputStates: 0,
        beamOutputStates: 0,
        candidateAttempts: 0,
        duplicateSkips: 0,
        nextStates: 0,
        partialScoreAttempts: 0,
        partialPrunedStates: 0,
        completeScoreAttempts: 0,
        cacheHit: false,
        stopReason: "",
        elapsedMs: 0
      }
      : null;
    const finishInnerProfile = (stopReason) => {
      if (!profileEnabled) return;
      innerProfile.stopReason = String(stopReason || "complete_scored");
      innerProfile.elapsedMs = Math.max(0, Date.now() - innerStartedAt);
      capProfile.innerExtras.push(innerProfile);
    };
    const cacheKey = Number(extra);
    if (innerExtraResultCache && innerExtraResultCache.has(cacheKey)) {
      const cachedEntry = innerExtraResultCache.get(cacheKey) || {};
      const solved = cloneBeamSearchSolution(cachedEntry.solved);
      if (profileEnabled) {
        innerProfile.windowSizes = Array.isArray(cachedEntry.windowSizes) ? cachedEntry.windowSizes.slice() : [];
        innerProfile.slotCount = Number(cachedEntry.slotCount || 0);
        innerProfile.beamInputStates = Number(cachedEntry.beamInputStates || 0);
        innerProfile.beamOutputStates = Number(cachedEntry.beamOutputStates || 0);
        innerProfile.partialPrunedStates = Number(cachedEntry.partialPrunedStates || 0);
        innerProfile.cacheHit = true;
        capProfile.cacheHits += 1;
        capProfile.reusedInnerExtras += 1;
      }
      if (shouldStopTargetStepExpansion({solved, groupsWithOrdered, capExtra: extra, targetStepSpec})) {
        finishInnerProfile("primary_target_step");
        finishCapProfile("primary_target_step");
        return {
          ...solved,
          windowExtra: extra
        };
      }
      if (shouldStopAfterStableTargetWindowFallback({solved, groupsWithOrdered, capExtra: extra, targetStepSpec})) {
        finishInnerProfile("stable_target_window_fallback");
        finishCapProfile("stable_target_window_fallback");
        return {
          ...solved,
          windowExtra: extra
        };
      }
      if (solved && (!best || compareScoreTuples(solved.scoreTuple, best.scoreTuple) < 0)) {
        best = {
          ...solved,
          windowExtra: extra
        };
      }
      finishInnerProfile(solved ? "complete_scored" : "no_complete_solution");
      continue;
    }
    if (profileEnabled) {
      capProfile.cacheMisses += 1;
    }
    if (windows.some((window, index) => {
      const need = Math.max(0, Number(groupsWithOrdered[index] && groupsWithOrdered[index].material && groupsWithOrdered[index].material.count || 0));
      return window.length < need;
    })) {
      finishInnerProfile("incomplete_window");
      continue;
    }
    const slots = expandMaterialSlots(groupsWithOrdered, windows);
    if (profileEnabled) {
      innerProfile.slotCount = slots.length;
    }
    let beam = [{
      slotIndex: 0,
      selected: [],
      usedIds: new Set(),
      selectedIdsByGroup: groupsWithOrdered.map(() => []),
      sum: 0
    }];
    for (const groupIndex of slots) {
      const nextStates = [];
      const window = windows[groupIndex];
      if (profileEnabled) {
        innerProfile.beamInputStates += beam.length;
      }
      for (const state of beam) {
        for (const candidate of window) {
          if (profileEnabled) {
            innerProfile.candidateAttempts += 1;
          }
          if (state.usedIds.has(candidate.id)) {
            if (profileEnabled) {
              innerProfile.duplicateSkips += 1;
            }
            continue;
          }
          const usedIds = new Set(state.usedIds);
          usedIds.add(candidate.id);
          const selectedIdsByGroup = (Array.isArray(state.selectedIdsByGroup)
            ? state.selectedIdsByGroup.map((ids) => [...ids])
            : groupsWithOrdered.map(() => []));
          selectedIdsByGroup[groupIndex].push(candidate.id);
          selectedIdsByGroup[groupIndex].sort();
          nextStates.push({
            slotIndex: Number(state.slotIndex || 0) + 1,
            selected: [...state.selected, candidate],
            usedIds,
            selectedIdsByGroup,
            sum: Number(state.sum || 0) + Number(candidate.value || 0)
          });
        }
      }
      if (profileEnabled) {
        innerProfile.nextStates += nextStates.length;
        innerProfile.partialScoreAttempts += nextStates.length;
      }
      beam = pruneBeam(nextStates, beamWidth, totalSlots, targetValue, mode, approachMode, targetStepSpec);
      if (profileEnabled) {
        innerProfile.partialPrunedStates += Math.max(0, nextStates.length - beam.length);
        innerProfile.beamOutputStates += beam.length;
      }
      if (!beam.length) break;
    }
    if (!beam.length) {
      finishInnerProfile("beam_exhausted");
      continue;
    }
    const solved = pickBestCompleteSolution(beam, targetValue, mode, approachMode, targetStepSpec, innerProfile);
    if (innerExtraResultCache) {
      innerExtraResultCache.set(cacheKey, {
        solved: cloneBeamSearchSolution(solved),
        windowSizes: profileEnabled ? innerProfile.windowSizes.slice() : windows.map((window) => Array.isArray(window) ? window.length : 0),
        slotCount: profileEnabled ? Number(innerProfile.slotCount || 0) : slots.length,
        beamInputStates: profileEnabled ? Number(innerProfile.beamInputStates || 0) : 0,
        beamOutputStates: profileEnabled ? Number(innerProfile.beamOutputStates || 0) : 0,
        partialPrunedStates: profileEnabled ? Number(innerProfile.partialPrunedStates || 0) : 0
      });
    }
    if (shouldStopTargetStepExpansion({solved, groupsWithOrdered, capExtra: extra, targetStepSpec})) {
      finishInnerProfile("primary_target_step");
      finishCapProfile("primary_target_step");
      return {
        ...solved,
        windowExtra: extra
      };
    }
    if (shouldStopAfterStableTargetWindowFallback({solved, groupsWithOrdered, capExtra: extra, targetStepSpec})) {
      finishInnerProfile("stable_target_window_fallback");
      finishCapProfile("stable_target_window_fallback");
      return {
        ...solved,
        windowExtra: extra
      };
    }
    if (solved && (!best || compareScoreTuples(solved.scoreTuple, best.scoreTuple) < 0)) {
      best = {
        ...solved,
        windowExtra: extra
      };
    }
    finishInnerProfile(solved ? "complete_scored" : "no_complete_solution");
  }
  finishCapProfile(best ? "completed_cap" : "no_solution");
  return best;
}

function lowerBoundByValueAsc(list, targetValue) {
  let lo = 0;
  let hi = Array.isArray(list) ? list.length : 0;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const value = Number(list[mid] && list[mid].value || 0);
    if (value < targetValue) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function makeSelectedIdSet(materialResults) {
  const out = new Set();
  for (const entry of Array.isArray(materialResults) ? materialResults : []) {
    for (const candidate of Array.isArray(entry && entry.selected) ? entry.selected : []) {
      const id = String(candidate && candidate.id || "");
      if (id) out.add(id);
    }
  }
  return out;
}

function cloneMaterialResultsWithSwaps(materialResults, swaps) {
  return (Array.isArray(materialResults) ? materialResults : []).map((entry, entryIndex) => {
    const selected = (Array.isArray(entry && entry.selected) ? entry.selected : []).map((candidate) => {
      const replacement = (Array.isArray(swaps) ? swaps : []).find((swap) => (
        Number(swap && swap.entryIndex || -1) === entryIndex
        && String(swap && swap.oldId || "") === String(candidate && candidate.id || "")
      ));
      return replacement ? replacement.nextCandidate : candidate;
    });
    return {
      ...entry,
      selected
    };
  });
}

function findClosestCandidate(sortedAvailable, idealValue, selectedIds, constraint) {
  const list = Array.isArray(sortedAvailable) ? sortedAvailable : [];
  const pivot = lowerBoundByValueAsc(list, idealValue);
  let bestCandidate = null;
  let bestDist = Infinity;
  const maxProbe = 8;
  for (let dir = -1; dir <= 1; dir += 2) {
    const start = dir < 0 ? pivot - 1 : pivot;
    for (let step = 0; step < maxProbe; step += 1) {
      const idx = start + dir * step;
      if (idx < 0 || idx >= list.length) break;
      const candidate = list[idx];
      if (!candidate) continue;
      const id = String(candidate.id || "");
      if (!id || selectedIds.has(id)) continue;
      const value = Number(candidate.value || 0);
      if (constraint && !constraint(value)) continue;
      const dist = Math.abs(value - idealValue);
      if (dist < bestDist - EPSILON) {
        bestDist = dist;
        bestCandidate = candidate;
      }
    }
  }
  return bestCandidate;
}

function refineIndividualSlots({currentResults, currentScore, targetValue, totalCount, approachMode, targetStepSpec = null, traceSteps, refinementContext = null}) {
  let results = currentResults;
  let score = currentScore;
  let improved = false;
  const normalizedMode = normalizeApproachMode(approachMode);

  const phases = normalizedMode === "below"
    ? [{roles: ["main"], direction: "up"}, {roles: ["aux"], direction: "down"}]
    : [{roles: ["main", "aux"], direction: "approach"}];

  for (const phase of phases) {
    for (let entryIndex = 0; entryIndex < results.length; entryIndex += 1) {
      const entry = results[entryIndex];
      const role = normalizeRole(entry && entry.material && entry.material.role);
      if (!phase.roles.includes(role)) continue;
      const selectedItems = Array.isArray(entry && entry.selected) ? entry.selected : [];
      const sortedAvailable = getRoleAwareAvailableList(refinementContext, entryIndex, "asc");

      for (let slotIndex = 0; slotIndex < selectedItems.length; slotIndex += 1) {
        const currentItem = selectedItems[slotIndex];
        if (!currentItem) continue;
        const currentValue = Number(currentItem.value || 0);
        const gap = Number(targetValue) - Number(score.overall);
        const idealNewValue = currentValue + gap * totalCount;
        const selectedIds = makeSelectedIdSet(results);

        let constraint;
        if (normalizedMode === "below") {
          if (phase.direction === "up") {
            constraint = (v) => v > currentValue + EPSILON;
          } else {
            constraint = (v) => v < currentValue - EPSILON;
          }
        } else {
          constraint = (v) => Math.abs(v - currentValue) > EPSILON;
        }

        const candidate = findClosestCandidate(sortedAvailable, idealNewValue, selectedIds, constraint);
        if (!candidate) continue;

        const nextResults = cloneMaterialResultsWithSwaps(results, [{
          entryIndex,
          oldId: String(currentItem.id || ""),
          nextCandidate: candidate
        }]);
        const nextScore = scoreRoleAwareMaterialResults(nextResults, targetValue, approachMode, targetStepSpec);
        if (!nextScore) continue;
        if (compareScoreTuples(nextScore.scoreTuple, score.scoreTuple) >= 0) continue;

        const patternName = normalizedMode === "below"
          ? (phase.direction === "up" ? "main_up_individual" : "aux_down_individual")
          : "approach_individual";
        traceSteps.push({
          materialResults: nextResults,
          overall: Number(nextScore.overall),
          pattern: patternName,
          changes: [{
            index: entryIndex,
            ...buildTraceMaterialFields(entry && entry.material),
            role,
            removedIds: [String(currentItem.id || "")].filter(Boolean),
            addedIds: [String(candidate.id || "")].filter(Boolean)
          }]
        });
        results = nextResults;
        score = {
          selected: nextScore.selected,
          overall: nextScore.overall,
          scoreTuple: nextScore.scoreTuple
        };
        improved = true;
      }
    }
  }
  return {currentResults: results, currentScore: score, improved};
}

function scoreRoleAwareMaterialResults(materialResults, targetValue, approachMode = "below", targetStepSpec = null) {
  const selected = [];
  for (const entry of Array.isArray(materialResults) ? materialResults : []) {
    selected.push(...(Array.isArray(entry && entry.selected) ? entry.selected : []));
  }
  const scored = scoreCraftAssistSolutionMultiMaterial({
    selected,
    targetValue,
    approachMode: normalizeApproachMode(approachMode),
    targetStepSpec
  });
  if (!scored) return null;
  return {
    selected,
    overall: scored.overall,
    predictedStepMean: scored.predictedStepMean,
    scoreTuple: scored.tuple
  };
}

function refineRoleAwareMaterialResults({materialResults, targetValue, maxIterations = 4, approachMode = "below", targetStepSpec = null, debugStats = null}) {
  bumpRoleAwareDebugStat(debugStats, "roleAwareFilteredSorts", 0);
  const normalizedMode = normalizeApproachMode(approachMode);
  let currentResults = Array.isArray(materialResults) ? materialResults : [];
  let currentScore = scoreRoleAwareMaterialResults(currentResults, targetValue, normalizedMode, targetStepSpec);
  if (!currentScore) return null;
  const totalSelected = currentScore.selected.length;
  if (totalSelected <= 0) return null;
  const traceSteps = [];
  if (hasTargetStepSpec(targetStepSpec) && isMeanOnPrimaryTargetStep(currentScore.overall, targetStepSpec)) {
    return {
      materialResults: currentResults,
      overall: Number(currentScore.overall),
      predictedStepMean: currentScore.predictedStepMean,
      scoreTuple: currentScore.scoreTuple,
      traceSteps
    };
  }

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let iterationImproved = false;
    const refinementContext = buildRoleAwareRefinementContext(currentResults, debugStats);

    // === Step 1: Pair swap (preserved from original) ===
    const selectedIds = makeSelectedIdSet(currentResults);
    const currentGap = Number(targetValue) - Number(currentScore.overall);
    let bestImprovement = null;

    for (let mainEntryIndex = 0; mainEntryIndex < currentResults.length; mainEntryIndex += 1) {
      const mainEntry = currentResults[mainEntryIndex];
      const mainRole = normalizeRole(mainEntry && mainEntry.material && mainEntry.material.role);
      if (mainRole !== "main") continue;
      const selectedMains = Array.isArray(mainEntry && mainEntry.selected) ? mainEntry.selected : [];
      const mainAvailableDesc = getRoleAwareAvailableList(refinementContext, mainEntryIndex, "desc");
      const mainAvailableAsc = getRoleAwareAvailableList(refinementContext, mainEntryIndex, "asc");

      for (const oldMain of selectedMains) {
        const usedWithoutMain = new Set(selectedIds);
        usedWithoutMain.delete(String(oldMain && oldMain.id || ""));
        const higherMains = mainAvailableDesc
          .filter((candidate) => {
            const id = String(candidate && candidate.id || "");
            return id
              && !usedWithoutMain.has(id)
              && Number(candidate && candidate.value || 0) > Number(oldMain && oldMain.value || 0) + EPSILON;
          });

        for (const newMain of higherMains) {
          const singleMainResults = cloneMaterialResultsWithSwaps(currentResults, [{
            entryIndex: mainEntryIndex,
            oldId: String(oldMain && oldMain.id || ""),
            nextCandidate: newMain
          }]);
          const singleMainScore = scoreRoleAwareMaterialResults(singleMainResults, targetValue, normalizedMode, targetStepSpec);
          if (
            singleMainScore
            && compareScoreTuples(singleMainScore.scoreTuple, currentScore.scoreTuple) < 0
            && (
              !bestImprovement
              || compareScoreTuples(singleMainScore.scoreTuple, bestImprovement.scoreTuple) < 0
            )
          ) {
            bestImprovement = {
              materialResults: singleMainResults,
              selected: singleMainScore.selected,
              overall: singleMainScore.overall,
              scoreTuple: singleMainScore.scoreTuple,
                    pattern: "main_up",
                    changes: [{
                      index: mainEntryIndex,
                      ...buildTraceMaterialFields(mainEntry && mainEntry.material),
                      role: "main",
                      removedIds: [String(oldMain && oldMain.id || "")].filter(Boolean),
                      addedIds: [String(newMain && newMain.id || "")].filter(Boolean)
              }]
            };
          }

          for (let auxEntryIndex = 0; auxEntryIndex < currentResults.length; auxEntryIndex += 1) {
            const auxEntry = currentResults[auxEntryIndex];
            const auxRole = normalizeRole(auxEntry && auxEntry.material && auxEntry.material.role);
            if (auxRole !== "aux") continue;
            const selectedAuxes = Array.isArray(auxEntry && auxEntry.selected) ? auxEntry.selected : [];
            const auxAvailableAsc = getRoleAwareAvailableList(refinementContext, auxEntryIndex, "asc");

            for (const oldAux of selectedAuxes) {
              const usedWithoutPair = new Set(selectedIds);
              usedWithoutPair.delete(String(oldMain && oldMain.id || ""));
              usedWithoutPair.delete(String(oldAux && oldAux.id || ""));
              usedWithoutPair.add(String(newMain && newMain.id || ""));

              const lowerAuxes = auxAvailableAsc
                .filter((candidate) => {
                  const id = String(candidate && candidate.id || "");
                  return id
                    && !usedWithoutPair.has(id)
                    && Number(candidate && candidate.value || 0) < Number(oldAux && oldAux.value || 0) - EPSILON;
                });
              if (!lowerAuxes.length) continue;

              const mainRaise = Number(newMain && newMain.value || 0) - Number(oldMain && oldMain.value || 0);
              const desiredAuxValue = Number(oldAux && oldAux.value || 0) + currentGap * totalSelected - mainRaise;
              const pivot = lowerBoundByValueAsc(lowerAuxes, desiredAuxValue);
              const probeIndexes = new Set([
                0,
                Math.max(0, lowerAuxes.length - 1),
                Math.max(0, pivot - 2),
                Math.max(0, pivot - 1),
                Math.min(lowerAuxes.length - 1, pivot),
                Math.min(lowerAuxes.length - 1, pivot + 1),
                Math.min(lowerAuxes.length - 1, pivot + 2)
              ]);

              for (const index of probeIndexes) {
                const newAux = lowerAuxes[index];
                if (!newAux) continue;
                const nextResults = cloneMaterialResultsWithSwaps(currentResults, [
                  {
                    entryIndex: mainEntryIndex,
                    oldId: String(oldMain && oldMain.id || ""),
                    nextCandidate: newMain
                  },
                  {
                    entryIndex: auxEntryIndex,
                    oldId: String(oldAux && oldAux.id || ""),
                    nextCandidate: newAux
                  }
                ]);
                const nextScore = scoreRoleAwareMaterialResults(nextResults, targetValue, normalizedMode, targetStepSpec);
                if (!nextScore) continue;
                if (compareScoreTuples(nextScore.scoreTuple, currentScore.scoreTuple) >= 0) continue;
                if (
                  !bestImprovement
                  || compareScoreTuples(nextScore.scoreTuple, bestImprovement.scoreTuple) < 0
                ) {
                  bestImprovement = {
                    materialResults: nextResults,
                    selected: nextScore.selected,
                    overall: nextScore.overall,
                    scoreTuple: nextScore.scoreTuple,
                    pattern: "main_up_aux_down",
                    changes: [
                      {
                        index: mainEntryIndex,
                        ...buildTraceMaterialFields(mainEntry && mainEntry.material),
                        role: "main",
                        removedIds: [String(oldMain && oldMain.id || "")].filter(Boolean),
                        addedIds: [String(newMain && newMain.id || "")].filter(Boolean)
                      },
                      {
                        index: auxEntryIndex,
                        ...buildTraceMaterialFields(auxEntry && auxEntry.material),
                        role: "aux",
                        removedIds: [String(oldAux && oldAux.id || "")].filter(Boolean),
                        addedIds: [String(newAux && newAux.id || "")].filter(Boolean)
                      }
                    ]
                  };
                }
              }
            }
          }
        }

        const lowerMains = mainAvailableDesc
          .filter((candidate) => {
            const id = String(candidate && candidate.id || "");
            return id
              && !usedWithoutMain.has(id)
              && Number(candidate && candidate.value || 0) < Number(oldMain && oldMain.value || 0) - EPSILON;
          })
          .slice(0, 4);

        for (const newMain of lowerMains) {
          for (let auxEntryIndex = 0; auxEntryIndex < currentResults.length; auxEntryIndex += 1) {
            const auxEntry = currentResults[auxEntryIndex];
            const auxRole = normalizeRole(auxEntry && auxEntry.material && auxEntry.material.role);
            if (auxRole !== "aux") continue;
            const selectedAuxes = Array.isArray(auxEntry && auxEntry.selected) ? auxEntry.selected : [];
            const auxAvailableAsc = getRoleAwareAvailableList(refinementContext, auxEntryIndex, "asc");

            for (const oldAux of selectedAuxes) {
              const usedWithoutPair = new Set(selectedIds);
              usedWithoutPair.delete(String(oldMain && oldMain.id || ""));
              usedWithoutPair.delete(String(oldAux && oldAux.id || ""));
              usedWithoutPair.add(String(newMain && newMain.id || ""));

              const higherAuxes = auxAvailableAsc
                .filter((candidate) => {
                  const id = String(candidate && candidate.id || "");
                  return id
                    && !usedWithoutPair.has(id)
                    && Number(candidate && candidate.value || 0) > Number(oldAux && oldAux.value || 0) + EPSILON;
                });
              if (!higherAuxes.length) continue;

              const mainDelta = Number(newMain && newMain.value || 0) - Number(oldMain && oldMain.value || 0);
              const desiredAuxValue = Number(oldAux && oldAux.value || 0) + currentGap * totalSelected - mainDelta;
              const pivot = lowerBoundByValueAsc(higherAuxes, desiredAuxValue);
              const probeIndexes = new Set([
                0,
                Math.max(0, higherAuxes.length - 1),
                Math.max(0, pivot - 2),
                Math.max(0, pivot - 1),
                Math.min(higherAuxes.length - 1, pivot),
                Math.min(higherAuxes.length - 1, pivot + 1),
                Math.min(higherAuxes.length - 1, pivot + 2)
              ]);

              for (const index of probeIndexes) {
                const newAux = higherAuxes[index];
                if (!newAux) continue;
                const nextResults = cloneMaterialResultsWithSwaps(currentResults, [
                  {
                    entryIndex: mainEntryIndex,
                    oldId: String(oldMain && oldMain.id || ""),
                    nextCandidate: newMain
                  },
                  {
                    entryIndex: auxEntryIndex,
                    oldId: String(oldAux && oldAux.id || ""),
                    nextCandidate: newAux
                  }
                ]);
                const nextScore = scoreRoleAwareMaterialResults(nextResults, targetValue, normalizedMode, targetStepSpec);
                if (!nextScore) continue;
                if (compareScoreTuples(nextScore.scoreTuple, currentScore.scoreTuple) >= 0) continue;
                if (
                  !bestImprovement
                  || compareScoreTuples(nextScore.scoreTuple, bestImprovement.scoreTuple) < 0
                ) {
                  bestImprovement = {
                    materialResults: nextResults,
                    selected: nextScore.selected,
                    overall: nextScore.overall,
                    scoreTuple: nextScore.scoreTuple,
                    pattern: "main_down_aux_up",
                    changes: [
                      {
                        index: mainEntryIndex,
                        ...buildTraceMaterialFields(mainEntry && mainEntry.material),
                        role: "main",
                        removedIds: [String(oldMain && oldMain.id || "")].filter(Boolean),
                        addedIds: [String(newMain && newMain.id || "")].filter(Boolean)
                      },
                      {
                        index: auxEntryIndex,
                        ...buildTraceMaterialFields(auxEntry && auxEntry.material),
                        role: "aux",
                        removedIds: [String(oldAux && oldAux.id || "")].filter(Boolean),
                        addedIds: [String(newAux && newAux.id || "")].filter(Boolean)
                      }
                    ]
                  };
                }
              }
            }
          }
        }
      }
    }

    for (let auxUpEntryIndex = 0; auxUpEntryIndex < currentResults.length; auxUpEntryIndex += 1) {
      const auxUpEntry = currentResults[auxUpEntryIndex];
      const auxUpRole = normalizeRole(auxUpEntry && auxUpEntry.material && auxUpEntry.material.role);
      if (auxUpRole !== "aux") continue;
      const selectedAuxUp = Array.isArray(auxUpEntry && auxUpEntry.selected) ? auxUpEntry.selected : [];
      const auxUpAvailableAsc = getRoleAwareAvailableList(refinementContext, auxUpEntryIndex, "asc");

      for (const oldAuxUp of selectedAuxUp) {
        const oldAuxUpId = String(oldAuxUp && oldAuxUp.id || "");
        if (!oldAuxUpId) continue;
        const usedWithoutUp = new Set(selectedIds);
        usedWithoutUp.delete(oldAuxUpId);

        const higherAuxes = auxUpAvailableAsc
          .filter((candidate) => {
            const id = String(candidate && candidate.id || "");
            return id
              && !usedWithoutUp.has(id)
              && Number(candidate && candidate.value || 0) > Number(oldAuxUp && oldAuxUp.value || 0) + EPSILON;
          });
        if (!higherAuxes.length) continue;

        for (const newAuxUp of higherAuxes) {
          const raise = Number(newAuxUp && newAuxUp.value || 0) - Number(oldAuxUp && oldAuxUp.value || 0);
          const requiredDrop = raise - currentGap * totalSelected;
          if (!(requiredDrop > EPSILON)) continue;

          for (let auxDownEntryIndex = 0; auxDownEntryIndex < currentResults.length; auxDownEntryIndex += 1) {
            const auxDownEntry = currentResults[auxDownEntryIndex];
            const auxDownRole = normalizeRole(auxDownEntry && auxDownEntry.material && auxDownEntry.material.role);
            if (auxDownRole !== "aux") continue;
            const selectedAuxDown = Array.isArray(auxDownEntry && auxDownEntry.selected) ? auxDownEntry.selected : [];
            const auxDownAvailableAsc = getRoleAwareAvailableList(refinementContext, auxDownEntryIndex, "asc");

            for (const oldAuxDown of selectedAuxDown) {
              const oldAuxDownId = String(oldAuxDown && oldAuxDown.id || "");
              if (!oldAuxDownId || oldAuxDownId === oldAuxUpId) continue;

              const usedWithoutPair = new Set(selectedIds);
              usedWithoutPair.delete(oldAuxUpId);
              usedWithoutPair.delete(oldAuxDownId);
              usedWithoutPair.add(String(newAuxUp && newAuxUp.id || ""));

              const lowerAuxes = auxDownAvailableAsc
                .filter((candidate) => {
                  const id = String(candidate && candidate.id || "");
                  return id
                    && !usedWithoutPair.has(id)
                    && Number(candidate && candidate.value || 0) < Number(oldAuxDown && oldAuxDown.value || 0) - EPSILON;
                });
              if (!lowerAuxes.length) continue;

              const maxLowerValue = Math.min(
                Number(oldAuxDown && oldAuxDown.value || 0) - EPSILON,
                Number(oldAuxDown && oldAuxDown.value || 0) - requiredDrop
              );
              const pivot = lowerBoundByValueAsc(lowerAuxes, maxLowerValue + EPSILON);
              const probeIndexes = new Set([
                0,
                Math.max(0, lowerAuxes.length - 1),
                Math.max(0, pivot - 3),
                Math.max(0, pivot - 2),
                Math.max(0, pivot - 1),
                Math.min(lowerAuxes.length - 1, pivot)
              ]);

              for (const index of probeIndexes) {
                const newAuxDown = lowerAuxes[index];
                if (!newAuxDown) continue;
                if (!(Number(newAuxDown && newAuxDown.value || 0) <= maxLowerValue + EPSILON)) continue;

                const nextResults = cloneMaterialResultsWithSwaps(currentResults, [
                  {
                    entryIndex: auxUpEntryIndex,
                    oldId: oldAuxUpId,
                    nextCandidate: newAuxUp
                  },
                  {
                    entryIndex: auxDownEntryIndex,
                    oldId: oldAuxDownId,
                    nextCandidate: newAuxDown
                  }
                ]);
                const nextScore = scoreRoleAwareMaterialResults(nextResults, targetValue, normalizedMode, targetStepSpec);
                if (!nextScore) continue;
                if (compareScoreTuples(nextScore.scoreTuple, currentScore.scoreTuple) >= 0) continue;
                if (
                  !bestImprovement
                  || compareScoreTuples(nextScore.scoreTuple, bestImprovement.scoreTuple) < 0
                ) {
                  bestImprovement = {
                    materialResults: nextResults,
                    selected: nextScore.selected,
                    overall: nextScore.overall,
                    scoreTuple: nextScore.scoreTuple,
                    pattern: "aux_up_aux_down",
                    changes: [
                      {
                        index: auxUpEntryIndex,
                        ...buildTraceMaterialFields(auxUpEntry && auxUpEntry.material),
                        role: "aux",
                        removedIds: [oldAuxUpId],
                        addedIds: [String(newAuxUp && newAuxUp.id || "")].filter(Boolean)
                      },
                      {
                        index: auxDownEntryIndex,
                        ...buildTraceMaterialFields(auxDownEntry && auxDownEntry.material),
                        role: "aux",
                        removedIds: [oldAuxDownId],
                        addedIds: [String(newAuxDown && newAuxDown.id || "")].filter(Boolean)
                      }
                    ]
                  };
                }
              }
            }
          }
        }
      }
    }

    if (bestImprovement) {
      traceSteps.push({
        materialResults: bestImprovement.materialResults,
        overall: Number(bestImprovement.overall),
        pattern: String(bestImprovement.pattern || ""),
        changes: Array.isArray(bestImprovement.changes) ? bestImprovement.changes : []
      });
      currentResults = bestImprovement.materialResults;
      currentScore = {
        selected: Array.isArray(bestImprovement.selected) ? bestImprovement.selected : currentScore.selected,
        overall: bestImprovement.overall,
        scoreTuple: bestImprovement.scoreTuple
      };
      iterationImproved = true;
      if (hasTargetStepSpec(targetStepSpec) && isMeanOnPrimaryTargetStep(currentScore.overall, targetStepSpec)) break;
    }

    // === Step 2: Individual slot refinement ===
    const individualResult = refineIndividualSlots({
      currentResults,
      currentScore,
      targetValue,
      totalCount: totalSelected,
      approachMode: normalizedMode,
      targetStepSpec,
      traceSteps,
      refinementContext
    });
    if (individualResult.improved) {
      currentResults = individualResult.currentResults;
      currentScore = individualResult.currentScore;
      iterationImproved = true;
    }

    if (!iterationImproved) break;
  }

  return {
    materialResults: currentResults,
    overall: Number(currentScore.overall),
    scoreTuple: currentScore.scoreTuple,
    traceSteps
  };
}

function searchCraftAssistBestSolution({groups, targetValue, targetStepSpec = null, beamWidth = 200, approachMode = "below", onSearchProgress = null, onSearchProfile = null} = {}) {
  const sourceGroups = Array.isArray(groups) ? groups : [];
  const mode = resolveSearchMode(sourceGroups);
  const searchTargetValue = resolveSearchTargetValue(targetValue, targetStepSpec);
  const normalizedApproachMode = hasTargetStepSpec(targetStepSpec) ? "infinite" : normalizeApproachMode(approachMode);
  if (mode === "multi_material_role" && normalizedApproachMode === "below" && !hasTargetStepSpec(targetStepSpec)) {
    return searchRoleAwarePushSolution({
      groups: sourceGroups,
      targetValue: searchTargetValue
    });
  }
  const preparedGroups = sourceGroups.map((group, index) => ({
    index,
    material: group && group.material ? group.material : {},
    candidates: buildOrderedCandidates({...group, index}, searchTargetValue, mode, targetStepSpec)
  }));
  if (!preparedGroups.length) return null;
  if (mode === "single_material" && preparedGroups.length === 1 && normalizedApproachMode === "below" && !hasTargetStepSpec(targetStepSpec)) {
    return searchSingleMaterialExact({
      group: preparedGroups[0],
      targetValue: searchTargetValue
    });
  }
  const groupsWithOrdered = preparedGroups.map((group) => ({
    ...group,
    ordered: group.candidates
  }));
  const totalSlots = groupsWithOrdered.reduce((sum, group) => sum + Math.max(0, Number(group && group.material && group.material.count || 0)), 0);
  const maxExtra = groupsWithOrdered.reduce((acc, group) => {
    const need = Math.max(0, Number(group && group.material && group.material.count || 0));
    return Math.max(acc, Math.max(0, group.ordered.length - need));
  }, 0);
  const fallbackRefinementCache = new Map();
  const innerExtraResultCache = new Map();
  const refineSingleMaterialTargetStepFallbackOnce = (args) => {
    const key = buildSingleMaterialTargetStepFallbackRefinementCacheKey(args);
    if (fallbackRefinementCache.has(key)) return fallbackRefinementCache.get(key);
    const refined = refineSingleMaterialTargetStepFallback(args);
    fallbackRefinementCache.set(key, refined || null);
    if (refined && typeof onSearchProgress === "function") {
      const stats = refined.refinementStats || {};
      onSearchProgress({
        phase: "target_step_fallback_refinement",
        scoredAttempts: Number(stats.scoredAttempts || 0),
        skippedAttempts: Number(stats.skippedAttempts || 0),
        skippedByWindow: Number(stats.skippedByWindow || 0),
        skippedByRawGap: Number(stats.skippedByRawGap || 0)
      });
    }
    return refined;
  };

  let best = null;
  let capExtra = Math.min(maxExtra, INITIAL_WINDOW_EXTRA_CAP);
  while (true) {
    if (typeof onSearchProgress === "function") {
      onSearchProgress({
        phase: "cap",
        capExtra,
        maxExtra
      });
    }
    const solved = runBeamSearchWithinCap({
      groupsWithOrdered,
      targetValue: searchTargetValue,
      beamWidth,
      mode,
      totalSlots,
      capExtra,
      approachMode: normalizedApproachMode,
      targetStepSpec,
      onSearchProfile,
      innerExtraResultCache
    });
    if (hasTargetStepSpec(targetStepSpec) && solved && isMeanOnPrimaryTargetStep(solved.overall, targetStepSpec)) {
      best = solved;
      break;
    }
    if (solved && (!best || compareScoreTuples(solved.scoreTuple, best.scoreTuple) < 0)) {
      best = solved;
    }
    if (
      hasTargetStepSpec(targetStepSpec)
      && mode === "single_material"
      && Array.isArray(groupsWithOrdered)
      && groupsWithOrdered.length === 1
      && normalizeApproachMode(targetStepSpec && targetStepSpec.approachMode) === "below"
      && solved
      && isMeanOnTargetStep(solved.overall, targetStepSpec)
      && !isMeanOnPrimaryTargetStep(solved.overall, targetStepSpec)
      && Number(capExtra) >= INITIAL_WINDOW_EXTRA_CAP
    ) {
      const refinedFallback = refineSingleMaterialTargetStepFallbackOnce({
        selected: solved.selected,
        candidates: groupsWithOrdered[0].ordered,
        targetValue: searchTargetValue,
        targetStepSpec
      });
      if (refinedFallback && compareScoreTuples(refinedFallback.scoreTuple, solved.scoreTuple) < 0) {
        best = {
          ...refinedFallback,
          windowExtra: capExtra
        };
        break;
      }
    }
    if (hasTargetStepSpec(targetStepSpec) && shouldStopAfterBoundedTargetWindowFallback({
      best,
      solved,
      groupsWithOrdered,
      capExtra,
      targetStepSpec
    })) {
      break;
    }
    if (capExtra >= maxExtra) break;
    if (solved) {
      if (!hasTargetStepSpec(targetStepSpec) && !candidateTouchesCapBoundary(solved.selected, groupsWithOrdered, capExtra)) {
        break;
      }
      if (hasTargetStepSpec(targetStepSpec) && shouldStopTargetStepExpansion({
        solved,
        groupsWithOrdered,
        capExtra,
        targetStepSpec
      })) {
        break;
      }
    }
    const nextCap = Math.min(
      maxExtra,
      Math.max(capExtra + 1, (capExtra + 1) * 2 - 1)
    );
    if (nextCap === capExtra) break;
    capExtra = nextCap;
  }

  if (!best) return null;
  if (
    hasTargetStepSpec(targetStepSpec)
    && mode === "single_material"
    && !isMeanOnPrimaryTargetStep(best.overall, targetStepSpec)
    && isMeanOnTargetStep(best.overall, targetStepSpec)
    && groupsWithOrdered.length === 1
  ) {
    const refinedFallback = refineSingleMaterialTargetStepFallbackOnce({
      selected: best.selected,
      candidates: groupsWithOrdered[0].ordered,
      targetValue: searchTargetValue,
      targetStepSpec
    });
    if (refinedFallback && compareScoreTuples(refinedFallback.scoreTuple, best.scoreTuple) < 0) {
      best = {
        ...best,
        ...refinedFallback
      };
    }
  }
  const selectedByGroup = groupsWithOrdered.map(() => []);
  for (const candidate of best.selected) {
    const index = Number(candidate && candidate.groupIndex || 0);
    if (selectedByGroup[index]) selectedByGroup[index].push(candidate);
  }
  const materialResults = groupsWithOrdered.map((group, index) => ({
    material: group.material,
    available: group.candidates,
    selected: selectedByGroup[index]
  }));
  if (hasTargetStepSpec(targetStepSpec) && isMeanOnPrimaryTargetStep(best.overall, targetStepSpec)) {
    return {
      materialResults,
      overall: Number(best.overall),
      predictedStepMean: best.predictedStepMean,
      scoreTuple: best.scoreTuple,
      windowExtra: Number(best.windowExtra || 0)
    };
  }
  if (mode === "multi_material_role") {
    const refined = refineRoleAwareMaterialResults({
      materialResults,
      targetValue: searchTargetValue,
      approachMode: normalizedApproachMode,
      targetStepSpec
    });
    if (refined && compareScoreTuples(refined.scoreTuple, best.scoreTuple) < 0) {
      return {
        materialResults: refined.materialResults,
        overall: Number(refined.overall),
        scoreTuple: refined.scoreTuple,
        windowExtra: Number(best.windowExtra || 0)
      };
    }
  }
  return {
    materialResults,
    overall: Number(best.overall),
    scoreTuple: best.scoreTuple,
    windowExtra: Number(best.windowExtra || 0)
  };
}

module.exports = {
  compareScoreTuples,
  refineSingleMaterialCompensation,
  refineRoleAwareMaterialResults,
  searchRoleAwarePushSolution,
  searchCraftAssistBestSolution,
  searchSingleMaterialExact,
  scoreCraftAssistSolutionSingleMaterial,
  scoreCraftAssistSolutionMultiMaterial
};
