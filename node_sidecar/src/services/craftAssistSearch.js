const EPSILON = 1e-9;
const INITIAL_WINDOW_EXTRA_CAP = 24;
const WINDOW_BOUNDARY_MARGIN = 4;

function normalizeRole(role) {
  return String(role || "").trim() === "aux" ? "aux" : "main";
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

function makeSearchCandidate({candidate, groupIndex, role, targetValue}) {
  const value = Number(candidate && candidate.value);
  return {
    ...candidate,
    groupIndex,
    role,
    value,
    distance: Math.abs(value - Number(targetValue)),
    side: value > Number(targetValue) + EPSILON
      ? "above"
      : (value < Number(targetValue) - EPSILON ? "below" : "equal")
  };
}

function compareByDistanceThenValueAsc(a, b) {
  const da = Number(a && a.distance || 0);
  const db = Number(b && b.distance || 0);
  if (da !== db) return da - db;
  const va = Number(a && a.value || 0);
  const vb = Number(b && b.value || 0);
  if (va !== vb) return va - vb;
  return String(a && a.id || "").localeCompare(String(b && b.id || ""));
}

function compareByDistanceThenRoleBias(role, a, b) {
  const da = Number(a && a.distance || 0);
  const db = Number(b && b.distance || 0);
  if (da !== db) return da - db;
  const va = Number(a && a.value || 0);
  const vb = Number(b && b.value || 0);
  if (va !== vb) return role === "aux" ? va - vb : vb - va;
  return String(a && a.id || "").localeCompare(String(b && b.id || ""));
}

function buildOrderedCandidates(group, targetValue, mode) {
  const role = normalizeRole(group && group.material && group.material.role);
  const base = (Array.isArray(group && group.candidates) ? group.candidates : [])
    .map((candidate) => makeSearchCandidate({
      candidate,
      groupIndex: Number(group && group.index || 0),
      role,
      targetValue
    }))
    .filter((candidate) => Number.isFinite(candidate.value));
  if (mode === "single_material" || mode === "multi_material_neutral") {
    return base.sort(compareByDistanceThenValueAsc);
  }
  const preferred = [];
  const fallback = [];
  for (const candidate of base) {
    const isPreferred = role === "aux"
      ? candidate.value <= Number(targetValue) + EPSILON
      : candidate.value >= Number(targetValue) - EPSILON;
    (isPreferred ? preferred : fallback).push(candidate);
  }
  preferred.sort((a, b) => compareByDistanceThenRoleBias(role, a, b));
  fallback.sort((a, b) => compareByDistanceThenRoleBias(role, a, b));
  return preferred.concat(fallback).map((candidate, index) => ({
    ...candidate,
    orderedIndex: index
  }));
}

function scoreCraftAssistSolutionSingleMaterial({selected, targetValue}) {
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
      radius,
      Number(targetValue) - overall,
      Math.abs(above - below),
      calcVariance(values),
      meanDistance
    ]
  };
}

function scoreCraftAssistSolutionNeutral({selected, targetValue}) {
  const values = (Array.isArray(selected) ? selected : []).map((item) => Number(item && item.value || 0));
  if (!values.length) return null;
  const overall = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (!(overall < Number(targetValue) - EPSILON)) return null;
  const radius = Math.max(...values.map((value) => Math.abs(value - Number(targetValue))));
  const meanDistance = values.reduce((sum, value) => sum + Math.abs(value - Number(targetValue)), 0) / values.length;
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

function scoreCraftAssistSolutionMultiMaterial({selected, targetValue}) {
  const list = Array.isArray(selected) ? selected : [];
  const values = list.map((item) => Number(item && item.value || 0));
  if (!values.length) return null;
  const overall = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (!(overall < Number(targetValue) - EPSILON)) return null;
  const mains = list
    .filter((item) => normalizeRole(item && item.role) === "main")
    .map((item) => Number(item.value || 0));
  const auxes = list
    .filter((item) => normalizeRole(item && item.role) === "aux")
    .map((item) => Number(item.value || 0));
  const wrongSidePenalty = mains.filter((value) => value < Number(targetValue) - EPSILON).length
    + auxes.filter((value) => value > Number(targetValue) + EPSILON).length;
  const mainMean = mains.length ? mains.reduce((sum, value) => sum + value, 0) / mains.length : 0;
  const auxMean = auxes.length ? auxes.reduce((sum, value) => sum + value, 0) / auxes.length : 0;
  const radius = Math.max(...values.map((value) => Math.abs(value - Number(targetValue))));
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

function scoreCompleteSelection(selected, targetValue, mode) {
  if (mode === "single_material") return scoreCraftAssistSolutionSingleMaterial({selected, targetValue});
  if (mode === "multi_material_role") return scoreCraftAssistSolutionMultiMaterial({selected, targetValue});
  return scoreCraftAssistSolutionNeutral({selected, targetValue});
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

function scoreSingleMaterialPushState({below, upper, state, targetValue}) {
  const selected = buildSingleMaterialSelection({below, upper, state});
  const values = selected.map((candidate) => Number(candidate && candidate.value || 0));
  if (!values.length) return null;
  const overall = values.reduce((sum, value) => sum + value, 0) / values.length;
  const scored = scoreCraftAssistSolutionSingleMaterial({selected, targetValue});
  return {
    state,
    selected,
    overall,
    scoreTuple: scored ? scored.tuple : null
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

function buildTraceGroupsFromMaterialResults(materialResults) {
  return (Array.isArray(materialResults) ? materialResults : []).map((entry, index) => ({
    index,
    materialName: String(entry && entry.material && entry.material.name || ""),
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
      materialName: String(afterList[index] && afterList[index].material && afterList[index].material.name
        || beforeList[index] && beforeList[index].material && beforeList[index].material.name
        || ""),
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
    targetValue
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

function scorePartialState(state, totalSlots, targetValue, mode) {
  const selected = Array.isArray(state && state.selected) ? state.selected : [];
  const count = selected.length;
  if (count <= 0) {
    if (mode === "single_material") return [0, Number(targetValue), 0, 0, 0];
    return [Number(targetValue), 0, 0, 0, 0];
  }
  const values = selected.map((item) => Number(item && item.value || 0));
  const projectedOverall = (
    values.reduce((sum, value) => sum + value, 0)
    + Number(targetValue) * Math.max(0, totalSlots - count)
  ) / totalSlots;
  const radius = Math.max(...values.map((value) => Math.abs(value - Number(targetValue))));
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

function pruneBeam(states, beamWidth, totalSlots, targetValue, mode) {
  const bestByKey = new Map();
  for (const state of Array.isArray(states) ? states : []) {
    const score = scorePartialState(state, totalSlots, targetValue, mode);
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

function pickBestCompleteSolution(states, targetValue, mode) {
  let best = null;
  for (const state of Array.isArray(states) ? states : []) {
    const scored = scoreCompleteSelection(state.selected, targetValue, mode);
    if (!scored) continue;
    if (!best || compareScoreTuples(scored.tuple, best.scoreTuple) < 0) {
      best = {
        selected: state.selected,
        overall: scored.overall,
        scoreTuple: scored.tuple
      };
    }
  }
  return best;
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

function runBeamSearchWithinCap({groupsWithOrdered, targetValue, beamWidth, mode, totalSlots, capExtra}) {
  let best = null;
  for (let extra = 0; extra <= capExtra; extra += 1) {
    const windows = groupsWithOrdered.map((group) => {
      const need = Math.max(0, Number(group && group.material && group.material.count || 0));
      const limit = Math.min(group.ordered.length, need + capExtra);
      return group.ordered.slice(0, Math.min(limit, need + extra));
    });
    if (windows.some((window, index) => {
      const need = Math.max(0, Number(groupsWithOrdered[index] && groupsWithOrdered[index].material && groupsWithOrdered[index].material.count || 0));
      return window.length < need;
    })) {
      continue;
    }
    const slots = expandMaterialSlots(groupsWithOrdered, windows);
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
      for (const state of beam) {
        for (const candidate of window) {
          if (state.usedIds.has(candidate.id)) continue;
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
      beam = pruneBeam(nextStates, beamWidth, totalSlots, targetValue, mode);
      if (!beam.length) break;
    }
    if (!beam.length) continue;
    const solved = pickBestCompleteSolution(beam, targetValue, mode);
    if (solved && (!best || compareScoreTuples(solved.scoreTuple, best.scoreTuple) < 0)) {
      best = {
        ...solved,
        windowExtra: extra
      };
    }
  }
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

function scoreRoleAwareMaterialResults(materialResults, targetValue) {
  const selected = [];
  for (const entry of Array.isArray(materialResults) ? materialResults : []) {
    selected.push(...(Array.isArray(entry && entry.selected) ? entry.selected : []));
  }
  const scored = scoreCraftAssistSolutionMultiMaterial({selected, targetValue});
  if (!scored) return null;
  return {
    selected,
    overall: scored.overall,
    scoreTuple: scored.tuple
  };
}

function refineRoleAwareMaterialResults({materialResults, targetValue, maxIterations = 4}) {
  let currentResults = Array.isArray(materialResults) ? materialResults : [];
  let currentScore = scoreRoleAwareMaterialResults(currentResults, targetValue);
  if (!currentScore) return null;
  const totalSelected = currentScore.selected.length;
  if (totalSelected <= 0) return null;
  const traceSteps = [];

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const selectedIds = makeSelectedIdSet(currentResults);
    const currentGap = Number(targetValue) - Number(currentScore.overall);
    let bestImprovement = null;

    for (let mainEntryIndex = 0; mainEntryIndex < currentResults.length; mainEntryIndex += 1) {
      const mainEntry = currentResults[mainEntryIndex];
      const mainRole = normalizeRole(mainEntry && mainEntry.material && mainEntry.material.role);
      if (mainRole !== "main") continue;
      const selectedMains = Array.isArray(mainEntry && mainEntry.selected) ? mainEntry.selected : [];

      for (const oldMain of selectedMains) {
        const usedWithoutMain = new Set(selectedIds);
        usedWithoutMain.delete(String(oldMain && oldMain.id || ""));
        const higherMains = (Array.isArray(mainEntry && mainEntry.available) ? mainEntry.available : [])
          .filter((candidate) => {
            const id = String(candidate && candidate.id || "");
            return id
              && !usedWithoutMain.has(id)
              && Number(candidate && candidate.value || 0) > Number(oldMain && oldMain.value || 0) + EPSILON;
          })
          .sort(compareByValueDesc);

        for (const newMain of higherMains) {
          const singleMainResults = cloneMaterialResultsWithSwaps(currentResults, [{
            entryIndex: mainEntryIndex,
            oldId: String(oldMain && oldMain.id || ""),
            nextCandidate: newMain
          }]);
          const singleMainScore = scoreRoleAwareMaterialResults(singleMainResults, targetValue);
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
                materialName: String(mainEntry && mainEntry.material && mainEntry.material.name || ""),
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

            for (const oldAux of selectedAuxes) {
              const usedWithoutPair = new Set(selectedIds);
              usedWithoutPair.delete(String(oldMain && oldMain.id || ""));
              usedWithoutPair.delete(String(oldAux && oldAux.id || ""));
              usedWithoutPair.add(String(newMain && newMain.id || ""));

              const lowerAuxes = (Array.isArray(auxEntry && auxEntry.available) ? auxEntry.available : [])
                .filter((candidate) => {
                  const id = String(candidate && candidate.id || "");
                  return id
                    && !usedWithoutPair.has(id)
                    && Number(candidate && candidate.value || 0) < Number(oldAux && oldAux.value || 0) - EPSILON;
                })
                .sort(compareByValueAsc);
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
                const nextScore = scoreRoleAwareMaterialResults(nextResults, targetValue);
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
                        materialName: String(mainEntry && mainEntry.material && mainEntry.material.name || ""),
                        role: "main",
                        removedIds: [String(oldMain && oldMain.id || "")].filter(Boolean),
                        addedIds: [String(newMain && newMain.id || "")].filter(Boolean)
                      },
                      {
                        index: auxEntryIndex,
                        materialName: String(auxEntry && auxEntry.material && auxEntry.material.name || ""),
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

        const lowerMains = (Array.isArray(mainEntry && mainEntry.available) ? mainEntry.available : [])
          .filter((candidate) => {
            const id = String(candidate && candidate.id || "");
            return id
              && !usedWithoutMain.has(id)
              && Number(candidate && candidate.value || 0) < Number(oldMain && oldMain.value || 0) - EPSILON;
          })
          .sort(compareByValueDesc)
          .slice(0, 4);

        for (const newMain of lowerMains) {
          for (let auxEntryIndex = 0; auxEntryIndex < currentResults.length; auxEntryIndex += 1) {
            const auxEntry = currentResults[auxEntryIndex];
            const auxRole = normalizeRole(auxEntry && auxEntry.material && auxEntry.material.role);
            if (auxRole !== "aux") continue;
            const selectedAuxes = Array.isArray(auxEntry && auxEntry.selected) ? auxEntry.selected : [];

            for (const oldAux of selectedAuxes) {
              const usedWithoutPair = new Set(selectedIds);
              usedWithoutPair.delete(String(oldMain && oldMain.id || ""));
              usedWithoutPair.delete(String(oldAux && oldAux.id || ""));
              usedWithoutPair.add(String(newMain && newMain.id || ""));

              const higherAuxes = (Array.isArray(auxEntry && auxEntry.available) ? auxEntry.available : [])
                .filter((candidate) => {
                  const id = String(candidate && candidate.id || "");
                  return id
                    && !usedWithoutPair.has(id)
                    && Number(candidate && candidate.value || 0) > Number(oldAux && oldAux.value || 0) + EPSILON;
                })
                .sort(compareByValueAsc);
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
                const nextScore = scoreRoleAwareMaterialResults(nextResults, targetValue);
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
                        materialName: String(mainEntry && mainEntry.material && mainEntry.material.name || ""),
                        role: "main",
                        removedIds: [String(oldMain && oldMain.id || "")].filter(Boolean),
                        addedIds: [String(newMain && newMain.id || "")].filter(Boolean)
                      },
                      {
                        index: auxEntryIndex,
                        materialName: String(auxEntry && auxEntry.material && auxEntry.material.name || ""),
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

    if (!bestImprovement) break;
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
  }

  return {
    materialResults: currentResults,
    overall: Number(currentScore.overall),
    scoreTuple: currentScore.scoreTuple,
    traceSteps
  };
}

function searchCraftAssistBestSolution({groups, targetValue, beamWidth = 200} = {}) {
  const sourceGroups = Array.isArray(groups) ? groups : [];
  const mode = resolveSearchMode(sourceGroups);
  if (mode === "multi_material_role") {
    return searchRoleAwarePushSolution({
      groups: sourceGroups,
      targetValue
    });
  }
  const preparedGroups = sourceGroups.map((group, index) => ({
    index,
    material: group && group.material ? group.material : {},
    candidates: buildOrderedCandidates({...group, index}, targetValue, mode)
  }));
  if (!preparedGroups.length) return null;
  if (mode === "single_material" && preparedGroups.length === 1) {
    return searchSingleMaterialExact({
      group: preparedGroups[0],
      targetValue
    });
  }
  const groupsWithOrdered = preparedGroups.map((group) => ({
    ...group,
    ordered: buildOrderedCandidates(group, targetValue, mode)
  }));
  const totalSlots = groupsWithOrdered.reduce((sum, group) => sum + Math.max(0, Number(group && group.material && group.material.count || 0)), 0);
  const maxExtra = groupsWithOrdered.reduce((acc, group) => {
    const need = Math.max(0, Number(group && group.material && group.material.count || 0));
    return Math.max(acc, Math.max(0, group.ordered.length - need));
  }, 0);

  let best = null;
  let capExtra = Math.min(maxExtra, INITIAL_WINDOW_EXTRA_CAP);
  while (true) {
    const solved = runBeamSearchWithinCap({
      groupsWithOrdered,
      targetValue,
      beamWidth,
      mode,
      totalSlots,
      capExtra
    });
    if (solved && (!best || compareScoreTuples(solved.scoreTuple, best.scoreTuple) < 0)) {
      best = solved;
    }
    if (capExtra >= maxExtra) break;
    if (solved && !candidateTouchesCapBoundary(solved.selected, groupsWithOrdered, capExtra)) {
      break;
    }
    const nextCap = Math.min(
      maxExtra,
      Math.max(capExtra + 1, (capExtra + 1) * 2 - 1)
    );
    if (nextCap === capExtra) break;
    capExtra = nextCap;
  }

  if (!best) return null;
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
  if (mode === "multi_material_role") {
    const refined = refineRoleAwareMaterialResults({
      materialResults,
      targetValue
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
  refineRoleAwareMaterialResults,
  searchRoleAwarePushSolution,
  searchCraftAssistBestSolution,
  searchSingleMaterialExact,
  scoreCraftAssistSolutionSingleMaterial,
  scoreCraftAssistSolutionMultiMaterial
};
