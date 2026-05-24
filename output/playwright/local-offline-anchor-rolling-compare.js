"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {performance} = require("node:perf_hooks");

const {
  createCraftAssistService,
  buildCraftAssistSelectionContext,
  buildCraftAssistSelectionContextFromCandidateRows,
  __test: craftAssistServiceTest
} = require("../../node_sidecar/src/services/craftAssistService");
const {
  buildCraftCandidateContext
} = require("../../node_sidecar/src/services/craftCandidateService");
const {
  compareScoreTuples,
  searchCraftAssistBestSolution,
  searchSlidingAnchorDiagnostic
} = require("../../node_sidecar/src/services/craftAssistSearch");
const {
  resolveCraftAssistTargetStepSpec,
  targetStepPriorityTuple
} = require("../../node_sidecar/src/services/craftAssistFloat32Step");
const {
  normalizeCraftAssistMaterialListCanonical
} = require("../../node_sidecar/ui/craftAssistItemWearShared");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SAMPLE_INDEX_PATH = path.join(__dirname, "craft-assist-multi-sample-benchmark-samples.json");
const UI_STATE_PATH = path.join(PROJECT_ROOT, "inventory_ui_state.json");
const OUTPUT_DIR = __dirname;
const DEFAULT_SAMPLE_ID = "eight-preserved-hunting-train-28-024";
const SUPPORTED_SAMPLE_IDS = new Set([DEFAULT_SAMPLE_ID]);
const DEFAULT_WEAR_OFFSET_PCT = 5;
const FILTER_PAD = 24;
const EPSILON = 1e-14;

function asString(value) {
  return String(value == null ? "" : value);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function normalizeName(value) {
  return asString(value).replace(/\s+/g, " ").trim();
}

function normalizeItemId(value) {
  return asString(value).trim();
}

function normalizeItemIds(ids) {
  return Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => normalizeItemId(id)).filter(Boolean)));
}

function orderedItemIds(ids) {
  return (Array.isArray(ids) ? ids : []).map((id) => normalizeItemId(id)).filter(Boolean);
}

function rowAssetId(row) {
  if (!row || typeof row !== "object") return "";
  const candidates = [row.asset_id, row.assetid, row.item_id, row.id, row.component_id];
  for (const value of candidates) {
    const id = normalizeItemId(value);
    if (id) return id;
  }
  return "";
}

function itemDisplayName(row) {
  return asString((row && row.alchemy_name) || (row && row.name)).trim();
}

function getAbsoluteWearValue(row) {
  if (!row || typeof row !== "object") return null;
  const wear = Number(row.float_value);
  if (!Number.isFinite(wear)) return null;
  return Math.max(0, Math.min(1, wear));
}

function getRelativeWearValue(row) {
  const wear = getAbsoluteWearValue(row);
  const min = Number(row && row.minfloat);
  const max = Number(row && row.maxfloat);
  if (wear == null || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  const value = (wear - min) / (max - min);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function craftRarityValue(row) {
  const value = Number(row && row.rarity);
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function craftAssistCandidateComparator(a, b, targetValue) {
  const da = Math.abs(Number(a && a.value) - Number(targetValue));
  const db = Math.abs(Number(b && b.value) - Number(targetValue));
  if (da !== db) return da - db;
  const va = Number(a && a.value);
  const vb = Number(b && b.value);
  if (va !== vb) return va - vb;
  return asString(a && a.id).localeCompare(asString(b && b.id));
}

function sameItemIds(left, right) {
  const a = orderedItemIds(left);
  const b = orderedItemIds(right);
  return JSON.stringify(a) === JSON.stringify(b);
}

function roundMs(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function createEmptyTrialTimings() {
  return {
    seed_ms: 0,
    completion_pass_1_ms: 0,
    completion_pass_2_ms: 0,
    filtered_baseline_ms: 0,
    total_ms: 0
  };
}

function finalizeTrialTimings(timings, totalMs) {
  const base = timings && typeof timings === "object" ? timings : {};
  return {
    seed_ms: roundMs(base.seed_ms),
    completion_pass_1_ms: roundMs(base.completion_pass_1_ms),
    completion_pass_2_ms: roundMs(base.completion_pass_2_ms),
    filtered_baseline_ms: roundMs(base.filtered_baseline_ms),
    total_ms: roundMs(totalMs)
  };
}

function normalizeTrialTimings(timings, fallbackTotalMs) {
  const base = timings && typeof timings === "object" ? timings : {};
  const normalized = createEmptyTrialTimings();
  normalized.seed_ms = roundMs(base.seed_ms);
  normalized.completion_pass_1_ms = roundMs(base.completion_pass_1_ms);
  normalized.completion_pass_2_ms = roundMs(base.completion_pass_2_ms);
  normalized.filtered_baseline_ms = roundMs(base.filtered_baseline_ms);
  normalized.total_ms = roundMs(
    Number.isFinite(Number(base.total_ms))
      ? Number(base.total_ms)
      : fallbackTotalMs
  );
  return normalized;
}

function resolvedPath(projectRelativePath) {
  return path.isAbsolute(projectRelativePath)
    ? projectRelativePath
    : path.join(PROJECT_ROOT, projectRelativePath);
}

function findPresetRecursive(value, presetName) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPresetRecursive(item, presetName);
      if (found) return found;
    }
    return null;
  }
  if (normalizeName(value.name) === normalizeName(presetName)) return value;
  for (const child of Object.values(value)) {
    const found = findPresetRecursive(child, presetName);
    if (found) return found;
  }
  return null;
}

function buildPayload({sample, preset, candidateRows}) {
  return {
    username: asString(sample && sample.username).trim(),
    target_wear_raw: asString(preset && preset.target_wear_raw),
    target_wear: Number(preset && preset.target_wear),
    wear_filter_mode: "relative",
    wear_approach_mode: "below",
    use_component_items: true,
    include_component_items: true,
    include_cooling: false,
    wear_offset_pct: DEFAULT_WEAR_OFFSET_PCT,
    enable_fast_craft_assist: false,
    blocked_ids: [],
    selected_item_ids: [],
    materials: normalizeCraftAssistMaterialListCanonical(preset && preset.materials, {
      rows: Array.isArray(candidateRows) ? candidateRows : null,
      source: "renormalize",
      legacyWearFilterMode: "relative"
    })
  };
}

function collectCandidatesForMaterial(material, rowsByName, blockedIds, targetValue) {
  const unique = new Map();
  for (const item of Array.isArray(material && material.items) ? material.items : []) {
    const name = asString(item && item.name).trim();
    if (!name) continue;
    const useRelativeItemFilter = asString(item && item.wear_filter_mode).trim() !== "absolute";
    for (const row of rowsByName.get(name) || []) {
      const id = rowAssetId(row);
      if (!id || blockedIds.has(id) || unique.has(id)) continue;
      const relativeValue = getRelativeWearValue(row);
      const absoluteValue = getAbsoluteWearValue(row);
      const rangeValue = useRelativeItemFilter ? relativeValue : absoluteValue;
      if (relativeValue == null || rangeValue == null) continue;
      if (rangeValue < Number(item && item.wear_min) - EPSILON) continue;
      if (rangeValue > Number(item && item.wear_max) + EPSILON) continue;
      unique.set(id, {id, row, value: relativeValue, relative_value: relativeValue});
    }
  }
  return [...unique.values()].sort((a, b) => craftAssistCandidateComparator(a, b, targetValue));
}

function buildRawGroups({payload, selectionContext, searchTargetValue}) {
  const blockedIds = new Set(normalizeItemIds(payload && payload.blocked_ids));
  return (Array.isArray(payload && payload.materials) ? payload.materials : []).map((material, index) => ({
    index,
    material,
    candidates: collectCandidatesForMaterial(
      material,
      selectionContext.rowsByName instanceof Map ? selectionContext.rowsByName : new Map(),
      blockedIds,
      searchTargetValue
    )
  }));
}

function resolveSharedRarities(groups) {
  let shared = null;
  for (const group of Array.isArray(groups) ? groups : []) {
    const countByRarity = new Map();
    for (const candidate of Array.isArray(group && group.candidates) ? group.candidates : []) {
      const rarity = craftRarityValue(candidate && candidate.row);
      if (rarity <= 0) continue;
      countByRarity.set(rarity, (countByRarity.get(rarity) || 0) + 1);
    }
    const requiredCount = Math.max(0, Number(group && group.material && group.material.count || 0));
    const feasible = new Set(
      [...countByRarity.entries()]
        .filter((entry) => entry[1] >= requiredCount)
        .map((entry) => entry[0])
    );
    if (shared == null) {
      shared = feasible;
      continue;
    }
    shared = new Set([...shared].filter((rarity) => feasible.has(rarity)));
  }
  return [...(shared || [])]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
}

function buildGroupsForRarity(groups, rarity) {
  return (Array.isArray(groups) ? groups : []).map((group) => ({
    index: Number(group && group.index || 0),
    material: group && group.material ? {...group.material} : {},
    candidates: (Array.isArray(group && group.candidates) ? group.candidates : [])
      .filter((candidate) => craftRarityValue(candidate && candidate.row) === Number(rarity))
  }));
}

function pickBetterSolvedCandidate(currentBest, nextCandidate, targetStepSpec) {
  if (!currentBest) return nextCandidate || null;
  if (!nextCandidate) return currentBest;
  if (targetStepSpec) {
    const currentPriority = targetStepPriorityTuple(currentBest.overall, targetStepSpec);
    const nextPriority = targetStepPriorityTuple(nextCandidate.overall, targetStepSpec);
    const priorityDiff = compareScoreTuples(nextPriority, currentPriority);
    if (priorityDiff < 0) return nextCandidate;
    if (priorityDiff > 0) return currentBest;
  }
  if (Array.isArray(currentBest.scoreTuple) && Array.isArray(nextCandidate.scoreTuple)) {
    return compareScoreTuples(nextCandidate.scoreTuple, currentBest.scoreTuple) < 0
      ? nextCandidate
      : currentBest;
  }
  return Number(nextCandidate.overall) > Number(currentBest.overall) ? nextCandidate : currentBest;
}

function solvedItemIds(solved) {
  const itemIds = [];
  for (const entry of Array.isArray(solved && solved.materialResults) ? solved.materialResults : []) {
    for (const selected of Array.isArray(entry && entry.selected) ? entry.selected : []) {
      const id = normalizeItemId(selected && selected.id);
      if (id) itemIds.push(id);
    }
  }
  return normalizeItemIds(itemIds);
}

function buildFrozenGroupFromSolved(materialResult, groupIndex) {
  return {
    index: groupIndex,
    material: materialResult && materialResult.material ? {...materialResult.material} : {},
    candidates: Array.isArray(materialResult && materialResult.selected)
      ? materialResult.selected.map((candidate) => ({...candidate}))
      : []
  };
}

function buildCompletionGroups(groups, solved, openGroupIndex) {
  return groups.map((group, groupIndex) => {
    if (groupIndex === openGroupIndex) return group;
    const materialResult = Array.isArray(solved && solved.materialResults) ? solved.materialResults[groupIndex] : null;
    return materialResult ? buildFrozenGroupFromSolved(materialResult, groupIndex) : group;
  });
}

function runCompletionPass({
  passNumber,
  groups,
  targetValue,
  targetStepSpec,
  initialSolved,
  allowFullGroupsFallback,
  searchCraftAssistBestSolutionFn = searchCraftAssistBestSolution,
  isCraftAssistSolvedCandidateFn = craftAssistServiceTest.isCraftAssistSolvedCandidate
}) {
  let currentSolved = initialSolved || null;
  let improved = false;
  const mode = targetStepSpec ? "infinite" : "below";
  const openableIndexes = groups.reduce((list, group, index) => {
    const requiredCount = Math.max(0, Number(group && group.material && group.material.count || 0));
    const candidateCount = Array.isArray(group && group.candidates) ? group.candidates.length : 0;
    if (candidateCount > requiredCount) list.push(index);
    return list;
  }, []);

  for (const openGroupIndex of openableIndexes) {
    const candidate = searchCraftAssistBestSolutionFn({
      groups: buildCompletionGroups(groups, currentSolved, openGroupIndex),
      targetValue,
      targetStepSpec,
      approachMode: mode
    });
    const accepted = isCraftAssistSolvedCandidateFn(candidate, targetValue, "below", targetStepSpec)
      ? pickBetterSolvedCandidate(currentSolved, candidate, targetStepSpec)
      : currentSolved;
    if (accepted !== currentSolved) {
      currentSolved = accepted;
      improved = true;
    }
  }

  let reason = improved ? "open_group_improved" : "no_improvement";
  if (!improved && allowFullGroupsFallback) {
    const fullCandidate = searchCraftAssistBestSolutionFn({
      groups,
      targetValue,
      targetStepSpec,
      approachMode: mode
    });
    if (isCraftAssistSolvedCandidateFn(fullCandidate, targetValue, "below", targetStepSpec)) {
      const accepted = pickBetterSolvedCandidate(currentSolved, fullCandidate, targetStepSpec);
      if (accepted !== currentSolved) {
        currentSolved = accepted;
        improved = true;
        reason = "full_groups_improved";
      } else {
        reason = "full_groups_no_improvement";
      }
    } else {
      reason = "full_groups_invalid";
    }
  }

  return {
    pass: passNumber,
    ok: !!currentSolved,
    improved,
    item_ids: solvedItemIds(currentSolved),
    reason,
    solved: currentSolved
  };
}

function buildFilteredGroups(groups, solved, pad = FILTER_PAD) {
  const selectedByGroup = Array.isArray(solved && solved.materialResults) ? solved.materialResults : [];
  return groups.map((group, groupIndex) => {
    const candidates = Array.isArray(group && group.candidates) ? group.candidates : [];
    const selectedIds = new Set(
      (Array.isArray(selectedByGroup[groupIndex] && selectedByGroup[groupIndex].selected)
        ? selectedByGroup[groupIndex].selected
        : [])
        .map((candidate) => normalizeItemId(candidate && candidate.id))
        .filter(Boolean)
    );
    const hitIndexes = [];
    for (let index = 0; index < candidates.length; index += 1) {
      if (selectedIds.has(normalizeItemId(candidates[index] && candidates[index].id))) {
        hitIndexes.push(index);
      }
    }
    if (!hitIndexes.length) {
      return {
        index: Number(group && group.index || 0),
        material: group && group.material ? {...group.material} : {},
        candidates
      };
    }
    const start = Math.max(0, Math.min(...hitIndexes) - pad);
    const end = Math.min(candidates.length, Math.max(...hitIndexes) + pad + 1);
    return {
      index: Number(group && group.index || 0),
      material: group && group.material ? {...group.material} : {},
      candidates: candidates.slice(start, end),
      filtered_window: {start, end, pad}
    };
  });
}

function extractSeedWindows(seed) {
  const steps = Array.isArray(seed && seed.trace && seed.trace.steps) ? seed.trace.steps : [];
  if (!steps.length) return [];
  const latest = steps[steps.length - 1];
  const extra = latest && latest.extra && typeof latest.extra === "object" ? latest.extra : {};
  return Object.entries(extra)
    .filter((entry) => entry[0].endsWith("Start"))
    .map((entry) => ({key: entry[0], value: Number(entry[1])}));
}

function compareAgainstBaseline(trialSolved, baselineReference, targetStepSpec) {
  if (!trialSolved) return false;
  if (!baselineReference || !Number.isFinite(Number(baselineReference.overall))) return true;
  const baselineItemIds = orderedItemIds(baselineReference.item_ids);
  const trialItemIds = orderedItemIds(trialSolved.item_ids);
  if (JSON.stringify(trialItemIds) !== JSON.stringify(baselineItemIds)) {
    return false;
  }
  return Math.abs(Number(trialSolved.overall) - Number(baselineReference.overall)) <= EPSILON;
}

function runAnchorRollingPipelineInternal({
  rawGroups,
  targetValue,
  targetStepSpec,
  baselineReference
}, deps = {}) {
  const nowMs = typeof deps.nowMs === "function"
    ? deps.nowMs
    : () => performance.now();
  const searchSlidingAnchorDiagnosticFn = typeof deps.searchSlidingAnchorDiagnostic === "function"
    ? deps.searchSlidingAnchorDiagnostic
    : searchSlidingAnchorDiagnostic;
  const searchCraftAssistBestSolutionFn = typeof deps.searchCraftAssistBestSolution === "function"
    ? deps.searchCraftAssistBestSolution
    : searchCraftAssistBestSolution;
  const isCraftAssistSolvedCandidateFn = typeof deps.isCraftAssistSolvedCandidate === "function"
    ? deps.isCraftAssistSolvedCandidate
    : craftAssistServiceTest.isCraftAssistSolvedCandidate;
  const rarities = resolveSharedRarities(rawGroups);
  let bestTrial = null;
  let lastFallbackReason = "seed_unavailable";
  let lastDiagnostic = null;
  let lastTrialResult = null;
  const timings = createEmptyTrialTimings();
  const totalStarted = nowMs();

  function measureStage(key, fn) {
    const started = nowMs();
    const result = fn();
    timings[key] += Math.max(0, nowMs() - started);
    return result;
  }

  for (const rarity of rarities) {
    const groups = buildGroupsForRarity(rawGroups, rarity);
    if (groups.some((group) => group.candidates.length < Number(group.material && group.material.count || 0))) {
      continue;
    }
    const preparedGroups = groups.map((group) => ({...group, ordered: group.candidates}));
    const seed = measureStage("seed_ms", () => searchSlidingAnchorDiagnosticFn({
      groupsWithOrdered: preparedGroups,
      targetValue,
      targetStepSpec,
      mode: "multi_material_role"
    }));
    const seedTrace = {
      mode: "anchor",
      ok: !!seed,
      item_ids: solvedItemIds(seed),
      windows: extractSeedWindows(seed),
      raw_ceiling_ok: !!seed,
      reason: seed ? "" : "seed_unavailable"
    };
    if (!seed) {
      lastDiagnostic = {
        rarity,
        seed: seedTrace,
        completion_passes: [
          {pass: 1, ok: false, improved: false, item_ids: [], reason: "skipped_after_seed_failure"},
          {pass: 2, ok: false, improved: false, item_ids: [], reason: "skipped_after_seed_failure"}
        ],
        filtered_baseline: {ok: false, reason: "skipped_after_seed_failure", pad: FILTER_PAD}
      };
      lastFallbackReason = "seed_unavailable";
      continue;
    }

    const pass1 = measureStage("completion_pass_1_ms", () => runCompletionPass({
      passNumber: 1,
      groups,
      targetValue,
      targetStepSpec,
      initialSolved: seed,
      allowFullGroupsFallback: false,
      searchCraftAssistBestSolutionFn,
      isCraftAssistSolvedCandidateFn
    }));
    const pass2 = measureStage("completion_pass_2_ms", () => runCompletionPass({
      passNumber: 2,
      groups,
      targetValue,
      targetStepSpec,
      initialSolved: pass1.solved || seed,
      allowFullGroupsFallback: !pass1.improved,
      searchCraftAssistBestSolutionFn,
      isCraftAssistSolvedCandidateFn
    }));
    const completedSolved = pass2.solved || pass1.solved || seed;
    const filteredGroups = buildFilteredGroups(groups, completedSolved, FILTER_PAD);
    const filteredSolved = measureStage("filtered_baseline_ms", () => {
      const filteredCandidate = searchCraftAssistBestSolutionFn({
        groups: filteredGroups,
        targetValue,
        targetStepSpec,
        approachMode: "infinite"
      });
      return isCraftAssistSolvedCandidateFn(filteredCandidate, targetValue, "below", targetStepSpec)
        ? {
            ...filteredCandidate,
            item_ids: solvedItemIds(filteredCandidate)
          }
        : null;
    });
    lastTrialResult = filteredSolved
      ? {
          ok: true,
          overall: Number(filteredSolved.overall),
          item_ids: filteredSolved.item_ids
        }
      : {
          ok: false,
          overall: null,
          item_ids: []
        };

    const diagnostic = {
      rarity,
      seed: seedTrace,
      completion_passes: [
        {
          pass: 1,
          ok: pass1.ok,
          improved: pass1.improved,
          item_ids: pass1.item_ids,
          reason: pass1.reason
        },
        {
          pass: 2,
          ok: pass2.ok,
          improved: pass2.improved,
          item_ids: pass2.item_ids,
          reason: pass2.reason
        }
      ],
      filtered_baseline: {
        ok: !!filteredSolved,
        reason: filteredSolved ? "" : "filtered_baseline_no_result",
        pad: FILTER_PAD,
        item_ids: filteredSolved ? filteredSolved.item_ids : []
      }
    };
    lastDiagnostic = diagnostic;

    if (!filteredSolved) {
      lastFallbackReason = "filtered_baseline_no_result";
      continue;
    }
    if (!compareAgainstBaseline(filteredSolved, baselineReference, targetStepSpec)) {
      lastFallbackReason = "accelerated_path_result_mismatch";
      continue;
    }
    const acceptedTrial = {
      variant: "anchor_rolling_filtered_baseline",
      ok: true,
      overall: Number(filteredSolved.overall),
      item_ids: filteredSolved.item_ids,
      fallback: false,
      fallback_reason: "",
      diagnostic,
      completion_passes: diagnostic.completion_passes,
      filtered_baseline: diagnostic.filtered_baseline
    };
    bestTrial = pickBetterSolvedCandidate(bestTrial, acceptedTrial, targetStepSpec) || acceptedTrial;
    if (bestTrial === acceptedTrial) {
      bestTrial = acceptedTrial;
    }
  }

  const finalizedTimings = finalizeTrialTimings(timings, Math.max(0, nowMs() - totalStarted));
  if (bestTrial) {
    return {
      ...bestTrial,
      timings: finalizedTimings
    };
  }
  return {
    variant: "anchor_rolling_filtered_baseline",
    ok: !!(lastTrialResult && lastTrialResult.ok),
    overall: lastTrialResult && Number.isFinite(Number(lastTrialResult.overall))
      ? Number(lastTrialResult.overall)
      : null,
    item_ids: orderedItemIds(lastTrialResult && lastTrialResult.item_ids),
    fallback: true,
    fallback_reason: lastFallbackReason,
    diagnostic: lastDiagnostic,
    completion_passes: lastDiagnostic ? lastDiagnostic.completion_passes : [
      {pass: 1, ok: false, improved: false, item_ids: [], reason: "not_run"},
      {pass: 2, ok: false, improved: false, item_ids: [], reason: "not_run"}
    ],
    filtered_baseline: lastDiagnostic ? lastDiagnostic.filtered_baseline : {ok: false, reason: "not_run", pad: FILTER_PAD},
    timings: finalizedTimings
  };
}

function createDefaultArtifactWriter(outDir) {
  return function writeArtifacts(result, options = {}) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const sampleId = asString(options && options.sampleId || result && result.sample_id || "sample").replace(/[^\w.-]+/g, "-");
    const jsonPath = path.join(outDir, `local-offline-anchor-rolling-compare-${sampleId}-${stamp}.json`);
    fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    return {jsonPath};
  };
}

function buildDefaultSelectionContextFromRows(rows) {
  const candidateContext = buildCraftCandidateContext({
    rows,
    includeComponentItems: true,
    includeCooling: false,
    selectedItemIds: []
  });
  const selectionContext = buildCraftAssistSelectionContextFromCandidateRows(
    candidateContext.candidateRows,
    {includeCooling: false}
  );
  selectionContext.candidateContextStats = candidateContext.stats;
  return selectionContext;
}

async function runLocalOfflineAnchorRollingCompare(options = {}, deps = {}) {
  const sampleId = asString(options.sampleId || DEFAULT_SAMPLE_ID).trim() || DEFAULT_SAMPLE_ID;
  if (!SUPPORTED_SAMPLE_IDS.has(sampleId)) {
    throw new Error(`unsupported sample id: ${sampleId}`);
  }
  const loadSampleDefinition = typeof deps.loadSampleDefinition === "function"
    ? deps.loadSampleDefinition
    : function defaultLoadSampleDefinition(currentSampleId) {
        const samples = readJson(SAMPLE_INDEX_PATH);
        const found = (Array.isArray(samples) ? samples : []).find((entry) => normalizeName(entry && entry.id) === normalizeName(currentSampleId));
        if (!found) {
          throw new Error(`sample not found: ${currentSampleId}`);
        }
        return found;
      };
  const loadSnapshotRows = typeof deps.loadSnapshotRows === "function"
    ? deps.loadSnapshotRows
    : function defaultLoadSnapshotRows(snapshotPath) {
        const snapshot = readJson(resolvedPath(snapshotPath));
        if (Array.isArray(snapshot)) return snapshot;
        if (Array.isArray(snapshot && snapshot.items)) return snapshot.items;
        throw new Error(`snapshot rows not found: ${snapshotPath}`);
      };
  const loadPreset = typeof deps.loadPreset === "function"
    ? deps.loadPreset
    : function defaultLoadPreset(presetName) {
        const uiState = readJson(UI_STATE_PATH);
        const preset = findPresetRecursive(uiState, presetName);
        if (!preset) {
          throw new Error(`preset not found: ${presetName}`);
        }
        return preset;
      };
  const createBaselineService = typeof deps.createBaselineService === "function"
    ? deps.createBaselineService
    : function defaultCreateBaselineService() {
        return createCraftAssistService({logger: null});
      };
  const buildSelectionContextFn = typeof deps.buildSelectionContext === "function"
    ? deps.buildSelectionContext
    : buildDefaultSelectionContextFromRows;
  const runAnchorRollingPipeline = typeof deps.runAnchorRollingPipeline === "function"
    ? deps.runAnchorRollingPipeline
    : runAnchorRollingPipelineInternal;
  const now = typeof deps.now === "function" ? deps.now : () => Date.now();
  const writeArtifacts = typeof deps.writeArtifacts === "function"
    ? deps.writeArtifacts
    : createDefaultArtifactWriter(OUTPUT_DIR);

  const sample = loadSampleDefinition(sampleId);
  const snapshotPath = resolvedPath(sample.snapshot_path);
  const rows = loadSnapshotRows(sample.snapshot_path);
  const preset = loadPreset(sample.preset_name);
  const selectionContext = buildSelectionContextFn(rows);
  const payload = buildPayload({
    sample,
    preset,
    candidateRows: Array.isArray(selectionContext && selectionContext.candidateRows) ? selectionContext.candidateRows : []
  });
  const targetValue = Number(payload.target_wear);
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep: payload.target_wear,
    inputRaw: payload.target_wear_raw,
    approachMode: payload.wear_approach_mode,
    offsetValue: Number(payload.target_wear) * (Number(payload.wear_offset_pct) / 100)
  });
  const searchTargetValue = targetStepSpec && Number.isFinite(Number(targetStepSpec.targetStep))
    ? Number(targetStepSpec.targetStep)
    : targetValue;
  const rawGroups = buildRawGroups({
    payload,
    selectionContext,
    searchTargetValue
  });

  const baselineService = createBaselineService();
  const baselineStarted = performance.now();
  const baseline = await baselineService.selectForRecipe({
    candidateRows: Array.isArray(selectionContext.candidateRows) ? selectionContext.candidateRows : [],
    targetWear: payload.target_wear,
    targetWearRaw: payload.target_wear_raw,
    wearFilterMode: payload.wear_filter_mode,
    wearApproachMode: payload.wear_approach_mode,
    materials: payload.materials,
    blockedIds: payload.blocked_ids,
    includeCooling: payload.include_cooling,
    wearOffsetPct: payload.wear_offset_pct,
    enableFastCraftAssist: false
  });
  const baselineMs = roundMs(performance.now() - baselineStarted);
  const baselineReference = {
    overall: Number.isFinite(Number(baseline && baseline.overall)) ? Number(baseline.overall) : null,
    item_ids: normalizeItemIds(baseline && baseline.item_ids)
  };

  const optimizedStarted = performance.now();
  const optimizedTrial = runAnchorRollingPipeline({
    rawGroups,
    targetValue: searchTargetValue,
    targetStepSpec,
    baselineReference
  });
  const optimizedMs = roundMs(performance.now() - optimizedStarted);
  const optimizedTimings = normalizeTrialTimings(optimizedTrial && optimizedTrial.timings, optimizedMs);

  const completionPasses = Array.isArray(optimizedTrial && optimizedTrial.completion_passes)
    ? optimizedTrial.completion_passes
    : [
        {pass: 1, ok: false, improved: false, item_ids: [], reason: "not_run"},
        {pass: 2, ok: false, improved: false, item_ids: [], reason: "not_run"}
      ];
  const optimizedItemIds = orderedItemIds(optimizedTrial && optimizedTrial.item_ids);
  const optimizedOverall = optimizedTrial && Number.isFinite(Number(optimizedTrial.overall))
    ? Number(optimizedTrial.overall)
    : null;
  const finalSource = optimizedTrial && optimizedTrial.fallback ? "baseline" : "optimized";

  const result = {
    generated_at_ms: now(),
    sample_id: sample.id,
    snapshot_path: snapshotPath,
    preset: sample.preset_name,
    baseline: {
      ok: !!(baseline && baseline.ok),
      overall: baselineReference.overall,
      ms: baselineMs,
      item_ids: baselineReference.item_ids
    },
    optimized: {
      variant: asString(optimizedTrial && optimizedTrial.variant).trim() || "anchor_rolling_filtered_baseline",
      ok: !!(optimizedTrial && optimizedTrial.ok),
      overall: optimizedOverall,
      ms: optimizedTimings.total_ms,
      total_ms: optimizedTimings.total_ms,
      timings: optimizedTimings,
      item_ids: optimizedItemIds
    },
    item_ids_same: sameItemIds(baselineReference.item_ids, optimizedItemIds),
    fallback: !!(optimizedTrial && optimizedTrial.fallback),
    fallback_reason: asString(optimizedTrial && optimizedTrial.fallback_reason).trim(),
    final_source: finalSource,
    completion_passes: completionPasses,
    filtered_baseline: optimizedTrial && optimizedTrial.filtered_baseline ? optimizedTrial.filtered_baseline : null,
    diagnostic: optimizedTrial && optimizedTrial.diagnostic ? optimizedTrial.diagnostic : null
  };

  const artifacts = writeArtifacts(result, {sampleId});
  if (artifacts && typeof artifacts === "object") {
    result.artifacts = artifacts;
  }
  return result;
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const options = {sampleId: DEFAULT_SAMPLE_ID};
  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || "");
    if (token === "--only" && args[index + 1]) {
      options.sampleId = String(args[index + 1]);
      index += 1;
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runLocalOfflineAnchorRollingCompare(options);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildDefaultSelectionContextFromRows,
  runAnchorRollingPipelineInternal,
  runLocalOfflineAnchorRollingCompare
};
