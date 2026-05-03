"use strict";

const os = require("node:os");
const path = require("node:path");
const {Worker} = require("node:worker_threads");
const {projectCraftAssistTraceMaterial} = require("../../ui/craftAssistItemWearShared");
const {
  targetStepPriorityTuple
} = require("./craftAssistFloat32Step");

const DEFAULT_WORKER_PATH = path.resolve(__dirname, "craftAssistShardWorker.js");

const DEFAULT_OPTIONS = Object.freeze({
  enableOversizedPrefilter: false,
  oversized2ShardsThreshold: 500,
  oversized4ShardsThreshold: 1500,
  topK: 40,
  edgeKeepPerSide: 4,
  expandTopK: 80,
  expandEdgeKeepPerSide: 8,
  centerOverlapRatio: 0.1,
  centerOverlapMin: 24,
  centerOverlapMax: 120,
  shortlistMin: 100,
  shortlistPerRequired: 20,
  shortlistHardMax: 240,
  shardJobTimeoutMs: 5000,
  prefilterGroupTimeoutMs: 15000,
  prefilterCallTimeoutMs: 30000,
  workerPath: DEFAULT_WORKER_PATH
});

const ENV_CONFIG = [
  ["enableOversizedPrefilter", "ENABLE_OVERSIZED_PREFILTER", "bool"],
  ["oversized2ShardsThreshold", "OVERSIZED_2_SHARDS_THRESHOLD", "int"],
  ["oversized4ShardsThreshold", "OVERSIZED_4_SHARDS_THRESHOLD", "int"],
  ["topK", "SHARD_TOP_K", "int"],
  ["edgeKeepPerSide", "SHARD_EDGE_KEEP_PER_SIDE", "int"],
  ["expandTopK", "EXPAND_SHARD_TOP_K", "int"],
  ["expandEdgeKeepPerSide", "EXPAND_SHARD_EDGE_KEEP_PER_SIDE", "int"],
  ["centerOverlapRatio", "SHARD_CENTER_OVERLAP_RATIO", "float"],
  ["centerOverlapMin", "SHARD_CENTER_OVERLAP_MIN", "int"],
  ["centerOverlapMax", "SHARD_CENTER_OVERLAP_MAX", "int"],
  ["shortlistMin", "SHORTLIST_MIN", "int"],
  ["shortlistPerRequired", "SHORTLIST_PER_REQUIRED", "int"],
  ["shortlistHardMax", "SHORTLIST_HARD_MAX", "int"],
  ["shardJobTimeoutMs", "SHARD_JOB_TIMEOUT_MS", "int"],
  ["prefilterGroupTimeoutMs", "PREFILTER_GROUP_TIMEOUT_MS", "int"],
  ["prefilterCallTimeoutMs", "PREFILTER_CALL_TIMEOUT_MS", "int"]
];

function asString(value) {
  return String(value == null ? "" : value);
}

function asNonNegativeInt(value, fallback = 0) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function asPositiveInt(value, fallback = 1) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function asFiniteFloat(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseEnvBool(name) {
  const raw = asString(process.env[name]).trim().toLowerCase();
  if (!raw) return undefined;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return undefined;
}

function parseEnvNumber(name, kind) {
  const raw = asString(process.env[name]).trim();
  if (!raw) return undefined;
  const num = kind === "int" ? Math.trunc(Number(raw)) : Number(raw);
  if (!Number.isFinite(num)) return undefined;
  return num;
}

function resolvePrefilterOptions(overrides = {}) {
  const envResolved = {};
  for (const [key, envName, kind] of ENV_CONFIG) {
    if (kind === "bool") {
      const value = parseEnvBool(envName);
      if (value !== undefined) envResolved[key] = value;
      continue;
    }
    const value = parseEnvNumber(envName, kind);
    if (value !== undefined) envResolved[key] = value;
  }
  const merged = {
    ...DEFAULT_OPTIONS,
    ...envResolved,
    ...(overrides && typeof overrides === "object" ? overrides : {})
  };
  merged.enableOversizedPrefilter = !!merged.enableOversizedPrefilter;
  merged.oversized2ShardsThreshold = asNonNegativeInt(
    merged.oversized2ShardsThreshold,
    DEFAULT_OPTIONS.oversized2ShardsThreshold
  );
  merged.oversized4ShardsThreshold = Math.max(
    merged.oversized2ShardsThreshold,
    asNonNegativeInt(merged.oversized4ShardsThreshold, DEFAULT_OPTIONS.oversized4ShardsThreshold)
  );
  merged.topK = asPositiveInt(merged.topK, DEFAULT_OPTIONS.topK);
  merged.edgeKeepPerSide = asNonNegativeInt(merged.edgeKeepPerSide, DEFAULT_OPTIONS.edgeKeepPerSide);
  merged.expandTopK = Math.max(merged.topK, asPositiveInt(merged.expandTopK, DEFAULT_OPTIONS.expandTopK));
  merged.expandEdgeKeepPerSide = Math.max(
    merged.edgeKeepPerSide,
    asNonNegativeInt(merged.expandEdgeKeepPerSide, DEFAULT_OPTIONS.expandEdgeKeepPerSide)
  );
  merged.centerOverlapRatio = Math.max(0, Math.min(1, asFiniteFloat(
    merged.centerOverlapRatio,
    DEFAULT_OPTIONS.centerOverlapRatio
  )));
  merged.centerOverlapMin = asNonNegativeInt(merged.centerOverlapMin, DEFAULT_OPTIONS.centerOverlapMin);
  merged.centerOverlapMax = Math.max(
    merged.centerOverlapMin,
    asNonNegativeInt(merged.centerOverlapMax, DEFAULT_OPTIONS.centerOverlapMax)
  );
  merged.shortlistMin = asPositiveInt(merged.shortlistMin, DEFAULT_OPTIONS.shortlistMin);
  merged.shortlistPerRequired = asPositiveInt(
    merged.shortlistPerRequired,
    DEFAULT_OPTIONS.shortlistPerRequired
  );
  merged.shortlistHardMax = Math.max(
    1,
    asPositiveInt(merged.shortlistHardMax, DEFAULT_OPTIONS.shortlistHardMax)
  );
  merged.shardJobTimeoutMs = asPositiveInt(merged.shardJobTimeoutMs, DEFAULT_OPTIONS.shardJobTimeoutMs);
  merged.prefilterGroupTimeoutMs = asPositiveInt(
    merged.prefilterGroupTimeoutMs,
    DEFAULT_OPTIONS.prefilterGroupTimeoutMs
  );
  merged.prefilterCallTimeoutMs = asPositiveInt(
    merged.prefilterCallTimeoutMs,
    DEFAULT_OPTIONS.prefilterCallTimeoutMs
  );
  merged.workerPath = path.resolve(asString(merged.workerPath).trim() || DEFAULT_WORKER_PATH);
  return merged;
}

function resolveShardCount(candidateCount, options = DEFAULT_OPTIONS) {
  const resolved = options && typeof options === "object" ? options : DEFAULT_OPTIONS;
  if (!resolved.enableOversizedPrefilter) return 0;
  const count = asNonNegativeInt(candidateCount, 0);
  if (count > asNonNegativeInt(resolved.oversized4ShardsThreshold, DEFAULT_OPTIONS.oversized4ShardsThreshold)) {
    return 4;
  }
  if (count > asNonNegativeInt(resolved.oversized2ShardsThreshold, DEFAULT_OPTIONS.oversized2ShardsThreshold)) {
    return 2;
  }
  return 0;
}

function normalizeMaterialRole(role) {
  return asString(role).trim() === "aux" ? "aux" : "main";
}

function normalizeShardRole({modeHint, materialRole}) {
  if (modeHint === "single_material" || modeHint === "multi_material_neutral") return "neutral";
  return normalizeMaterialRole(materialRole) === "aux" ? "aux" : "main";
}

function resolveModeHint(groups) {
  const list = Array.isArray(groups) ? groups : [];
  if (list.length <= 1) return "single_material";
  const roles = new Set(list.map((group) => normalizeMaterialRole(group && group.material && group.material.role)));
  return roles.size >= 2 ? "multi_material_role" : "multi_material_neutral";
}

function buildOrderedCandidateSummaries(group) {
  return (Array.isArray(group && group.candidates) ? group.candidates : [])
    .map((candidate, orderedIndex) => ({
      id: asString(candidate && candidate.id).trim(),
      value: asFiniteFloat(candidate && candidate.value, 0),
      orderedIndex
    }))
    .filter((candidate) => candidate.id);
}

function resolveCenterOverlapSize(totalCount, options) {
  const raw = Math.round(totalCount * asFiniteFloat(options.centerOverlapRatio, DEFAULT_OPTIONS.centerOverlapRatio));
  const clamped = Math.max(
    asNonNegativeInt(options.centerOverlapMin, DEFAULT_OPTIONS.centerOverlapMin),
    Math.min(
      asNonNegativeInt(options.centerOverlapMax, DEFAULT_OPTIONS.centerOverlapMax),
      raw
    )
  );
  return Math.max(1, Math.min(totalCount, clamped));
}

function hasTargetStepSpec(targetStepSpec) {
  return !!(
    targetStepSpec
    && typeof targetStepSpec === "object"
    && Number.isFinite(Number(targetStepSpec.targetStep))
  );
}

function resolveStepTargetValue(targetValue, targetStepSpec) {
  return hasTargetStepSpec(targetStepSpec) ? Number(targetStepSpec.targetStep) : asFiniteFloat(targetValue, 0);
}

function compareTuple(left, right) {
  const len = Math.max(Array.isArray(left) ? left.length : 0, Array.isArray(right) ? right.length : 0);
  for (let index = 0; index < len; index += 1) {
    const diff = asFiniteFloat(left && left[index], 0) - asFiniteFloat(right && right[index], 0);
    if (Math.abs(diff) > 1e-12) return diff;
  }
  return 0;
}

function candidateTargetPriorityTuple(candidate, targetValue, targetStepSpec = null) {
  const value = asFiniteFloat(candidate && candidate.value, 0);
  if (hasTargetStepSpec(targetStepSpec)) {
    return targetStepPriorityTuple(value, targetStepSpec);
  }
  return [Math.abs(value - asFiniteFloat(targetValue, 0))];
}

function buildCenterWindow(orderedCandidates, targetValue, options, targetStepSpec = null) {
  const list = Array.isArray(orderedCandidates) ? orderedCandidates : [];
  if (!list.length) return {centerOverlapSize: 0, candidates: []};
  let centerIndex = 0;
  let bestTuple = null;
  for (let index = 0; index < list.length; index += 1) {
    const tuple = candidateTargetPriorityTuple(list[index], targetValue, targetStepSpec);
    if (!bestTuple || compareTuple(tuple, bestTuple) < 0) {
      bestTuple = tuple;
      centerIndex = index;
    }
  }
  const centerOverlapSize = resolveCenterOverlapSize(list.length, options);
  const half = Math.floor(centerOverlapSize / 2);
  let start = centerIndex - half;
  let end = start + centerOverlapSize;
  if (start < 0) {
    end += -start;
    start = 0;
  }
  if (end > list.length) {
    start = Math.max(0, start - (end - list.length));
    end = list.length;
  }
  return {
    centerOverlapSize,
    candidates: list.slice(start, end)
  };
}

function buildStrideShardsWithCenterOverlap({orderedCandidates, shardCount, targetValue, targetStepSpec = null, options = DEFAULT_OPTIONS}) {
  const list = Array.isArray(orderedCandidates) ? orderedCandidates : [];
  const count = Math.max(1, asPositiveInt(shardCount, 1));
  if (!list.length) return Array.from({length: count}, (_, shardIndex) => ({
    shardIndex,
    candidates: [],
    centerOverlapSize: 0
  }));
  const centerWindow = buildCenterWindow(list, targetValue, options, targetStepSpec);
  const centerCandidates = centerWindow.candidates;
  const centerOverlapSize = centerWindow.centerOverlapSize;
  return Array.from({length: count}, (_, shardIndex) => {
    const picked = [];
    const seen = new Set();
    for (let index = shardIndex; index < list.length; index += count) {
      const candidate = list[index];
      const id = asString(candidate && candidate.id).trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      picked.push(candidate);
    }
    for (const candidate of centerCandidates) {
      const id = asString(candidate && candidate.id).trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      picked.push(candidate);
    }
    picked.sort((left, right) => asNonNegativeInt(left && left.orderedIndex, 0) - asNonNegativeInt(right && right.orderedIndex, 0));
    return {
      shardIndex,
      shardCount: count,
      centerOverlapSize,
      candidates: picked
    };
  });
}

function resolveBaseShortlistMax(group, options) {
  const requiredCount = Math.max(0, Number(group && group.material && group.material.count || 0));
  return Math.min(
    asPositiveInt(options.shortlistHardMax, DEFAULT_OPTIONS.shortlistHardMax),
    Math.max(
      asPositiveInt(options.shortlistMin, DEFAULT_OPTIONS.shortlistMin),
      requiredCount * asPositiveInt(options.shortlistPerRequired, DEFAULT_OPTIONS.shortlistPerRequired)
    )
  );
}

function mergeShardSelections({group, selectedIds, options = DEFAULT_OPTIONS}) {
  const materialCount = Math.max(0, Number(group && group.material && group.material.count || 0));
  if (materialCount > asPositiveInt(options.shortlistHardMax, DEFAULT_OPTIONS.shortlistHardMax)) {
    return {
      ...group,
      candidates: group && group.candidates ? group.candidates : [],
      usedGroupFallback: true
    };
  }
  const byId = new Map();
  const ordered = Array.isArray(group && group.candidates) ? group.candidates : [];
  for (let orderedIndex = 0; orderedIndex < ordered.length; orderedIndex += 1) {
    const candidate = ordered[orderedIndex];
    const id = asString(candidate && candidate.id).trim();
    if (!id || byId.has(id)) {
      return {
        ...group,
        candidates: group && group.candidates ? group.candidates : [],
        usedGroupFallback: true
      };
    }
    byId.set(id, {candidate, orderedIndex});
  }
  const shortlistMax = Number.isFinite(Number(options.shortlistMaxOverride))
    ? Math.max(materialCount, Math.trunc(Number(options.shortlistMaxOverride)))
    : resolveBaseShortlistMax(group, options);
  const seen = new Set();
  const shortlist = [];
  for (const rawId of Array.isArray(selectedIds) ? selectedIds : []) {
    const id = asString(rawId).trim();
    if (!id || seen.has(id) || !byId.has(id)) {
      return {
        ...group,
        candidates: group && group.candidates ? group.candidates : [],
        usedGroupFallback: true
      };
    }
    seen.add(id);
    shortlist.push(byId.get(id));
  }
  shortlist.sort((left, right) => left.orderedIndex - right.orderedIndex);
  const candidates = shortlist
    .slice(0, shortlistMax)
    .map((entry) => entry.candidate);
  if (candidates.length < materialCount) {
    return {
      ...group,
      candidates: group && group.candidates ? group.candidates : [],
      usedGroupFallback: true
    };
  }
  return {
    ...group,
    candidates,
    usedGroupFallback: false
  };
}

function buildPhaseTrace({phaseName, options, targetValue, targetStepSpec = null}) {
  const stepAware = hasTargetStepSpec(targetStepSpec);
  return {
    enabled: !!options.enableOversizedPrefilter,
    phaseName: asString(phaseName).trim() || "prefilter/base",
    retryMode: phaseName === "prefilter/expand" ? "expand" : "none",
    targetValue: asFiniteFloat(targetValue, 0),
    inputStep: stepAware ? Number(targetStepSpec.inputStep) : null,
    targetStep: stepAware ? Number(targetStepSpec.targetStep) : null,
    prefilteredIndexes: [],
    groupFallbackIndexes: [],
    groups: [],
    prefilterMs: 0
  };
}

function makeTaggedError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function terminateWorker(worker) {
  if (!worker || typeof worker.terminate !== "function") return Promise.resolve();
  return worker.terminate().catch(() => {});
}

function resolveMaxShardConcurrency(shardCount) {
  const count = Math.max(1, asPositiveInt(shardCount, 1));
  if (typeof os.availableParallelism === "function") {
    return Math.max(1, Math.min(count, 4, os.availableParallelism() - 1));
  }
  return Math.max(1, Math.min(count, 2));
}

async function runShardJobs({
  workerPath,
  shardPayloads,
  shardJobTimeoutMs,
  groupTimeoutMs,
  callTimeoutMs
}) {
  const queue = Array.isArray(shardPayloads) ? shardPayloads.slice() : [];
  const maxConcurrency = resolveMaxShardConcurrency(queue.length);
  const runningWorkers = new Set();
  const shardResults = [];
  let activeCount = 0;
  let settled = false;
  let callTimer = null;
  let groupTimer = null;

  return new Promise((resolve, reject) => {
    function cleanup() {
      if (callTimer) {
        clearTimeout(callTimer);
        callTimer = null;
      }
      if (groupTimer) {
        clearTimeout(groupTimer);
        groupTimer = null;
      }
    }

    async function fail(err) {
      if (settled) return;
      settled = true;
      cleanup();
      const terminations = [];
      for (const worker of runningWorkers) {
        terminations.push(terminateWorker(worker));
      }
      runningWorkers.clear();
      await Promise.allSettled(terminations);
      reject(err);
    }

    function maybeResolve() {
      if (settled) return;
      if (queue.length > 0) return;
      if (activeCount > 0) return;
      settled = true;
      cleanup();
      resolve(shardResults);
    }

    function launchNext() {
      if (settled) return;
      while (activeCount < maxConcurrency && queue.length > 0 && !settled) {
        const payload = queue.shift();
        const requestId = `prefilter_${Date.now()}_${payload.groupIndex}_${payload.shardIndex}_${Math.random().toString(36).slice(2, 8)}`;
        const worker = new Worker(workerPath);
        runningWorkers.add(worker);
        activeCount += 1;
        let shardDone = false;
        function markShardSettled() {
          if (shardDone || settled) return false;
          shardDone = true;
          clearTimeout(jobTimer);
          runningWorkers.delete(worker);
          activeCount -= 1;
          return true;
        }
        const jobTimer = setTimeout(() => {
          if (!markShardSettled()) return;
          void terminateWorker(worker);
          void fail(makeTaggedError(
            "group_fallback",
            `prefilter shard timeout after ${shardJobTimeoutMs}ms`
          ));
        }, shardJobTimeoutMs);

        worker.on("message", (message) => {
          if (!markShardSettled()) return;
          if (!message || message.type !== "result") {
            void terminateWorker(worker);
            void fail(makeTaggedError("group_fallback", "invalid shard worker response"));
            return;
          }
          if (String(message.requestId || "").trim() !== requestId) {
            void terminateWorker(worker);
            void fail(makeTaggedError("group_fallback", "mismatched shard worker response id"));
            return;
          }
          if (message.ok === false) {
            void terminateWorker(worker);
            void fail(makeTaggedError(
              "group_fallback",
              asString(message.error && message.error.message).trim() || "prefilter shard worker failed"
            ));
            return;
          }
          shardResults.push(message.result);
          launchNext();
          maybeResolve();
          void terminateWorker(worker);
        });
        worker.on("error", (err) => {
          if (!markShardSettled()) return;
          void terminateWorker(worker);
          void fail(makeTaggedError(
            "group_fallback",
            asString(err && err.message).trim() || "prefilter shard worker crashed"
          ));
        });
        worker.on("exit", (code) => {
          if (!markShardSettled()) return;
          if (code === 0) {
            void fail(makeTaggedError("group_fallback", "prefilter shard worker exited early"));
            return;
          }
          void fail(makeTaggedError("group_fallback", `prefilter shard worker exited with code ${code}`));
        });
        worker.postMessage({
          type: "prefilter",
          requestId,
          payload
        });
      }
    }

    callTimer = setTimeout(() => {
      void fail(makeTaggedError("call_timeout", `prefilter call timeout after ${callTimeoutMs}ms`));
    }, callTimeoutMs);
    groupTimer = setTimeout(() => {
      void fail(makeTaggedError("group_fallback", `prefilter group timeout after ${groupTimeoutMs}ms`));
    }, groupTimeoutMs);
    launchNext();
    maybeResolve();
  });
}

async function processOversizedGroup({
  group,
  groupIndex,
  targetValue,
  targetStepSpec = null,
  modeHint,
  phaseName,
  options,
  remainingCallTimeoutMs
}) {
  const originalCandidates = Array.isArray(group && group.candidates) ? group.candidates : [];
  const traceMaterial = projectCraftAssistTraceMaterial(group && group.material);
  const groupTrace = {
    groupIndex,
    materialName: traceMaterial.materialName,
    primary_name: traceMaterial.primary_name,
    item_names: traceMaterial.item_names,
    label: traceMaterial.label,
    shardCount: 0,
    candidateCountBefore: originalCandidates.length,
    candidateCountAfter: originalCandidates.length,
    centerOverlapSize: 0,
    shardStats: []
  };
  if (Math.max(0, Number(group && group.material && group.material.count || 0)) > options.shortlistHardMax) {
    return {group, usedGroupFallback: true, groupTrace};
  }
  const orderedCandidates = buildOrderedCandidateSummaries(group);
  if (orderedCandidates.length !== originalCandidates.length) {
    return {group, usedGroupFallback: true, groupTrace};
  }
  const uniqueIds = new Set(orderedCandidates.map((candidate) => candidate.id));
  if (uniqueIds.size !== orderedCandidates.length) {
    return {group, usedGroupFallback: true, groupTrace};
  }
  const shardCount = resolveShardCount(orderedCandidates.length, options);
  if (shardCount <= 0) {
    return {group, usedGroupFallback: false, groupTrace};
  }
  const shards = buildStrideShardsWithCenterOverlap({
    orderedCandidates,
    shardCount,
    targetValue,
    targetStepSpec,
    options
  });
  groupTrace.shardCount = shardCount;
  groupTrace.centerOverlapSize = shards[0] ? shards[0].centerOverlapSize : 0;
  const isExpandPhase = phaseName === "prefilter/expand";
  const workerResults = await runShardJobs({
    workerPath: options.workerPath,
    shardPayloads: shards.map((shard) => ({
      recipeNo: asNonNegativeInt(phaseName && phaseName.recipeNo, 0),
      groupIndex,
      shardIndex: shard.shardIndex,
      shardCount,
      role: normalizeShardRole({
        modeHint,
        materialRole: group && group.material && group.material.role
      }),
      targetValue,
      targetStepSpec,
      topK: isExpandPhase ? options.expandTopK : options.topK,
      edgeKeepPerSide: isExpandPhase ? options.expandEdgeKeepPerSide : options.edgeKeepPerSide,
      candidates: shard.candidates
    })),
    shardJobTimeoutMs: options.shardJobTimeoutMs,
    groupTimeoutMs: Math.max(1, Math.min(options.prefilterGroupTimeoutMs, remainingCallTimeoutMs)),
    callTimeoutMs: Math.max(1, remainingCallTimeoutMs)
  });
  const mergedIds = [];
  const seen = new Set();
  for (const result of workerResults.sort((left, right) => asNonNegativeInt(left && left.shardIndex, 0) - asNonNegativeInt(right && right.shardIndex, 0))) {
    groupTrace.shardStats.push({
      shardIndex: asNonNegativeInt(result && result.shardIndex, 0),
      inputCount: asNonNegativeInt(result && result.stats && result.stats.inputCount, 0),
      outputCount: asNonNegativeInt(result && result.stats && result.stats.outputCount, 0),
      preferredSideCount: asNonNegativeInt(result && result.stats && result.stats.preferredSideCount, 0),
      oppositeSideCount: asNonNegativeInt(result && result.stats && result.stats.oppositeSideCount, 0)
    });
    for (const id of Array.isArray(result && result.selectedIds) ? result.selectedIds : []) {
      const key = asString(id).trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      mergedIds.push(key);
    }
  }
  const baseShortlistMax = resolveBaseShortlistMax(group, options);
  const shortlistMaxOverride = isExpandPhase
    ? Math.min(options.shortlistHardMax, baseShortlistMax * 2)
    : baseShortlistMax;
  const merged = mergeShardSelections({
    group,
    selectedIds: mergedIds,
    options: {
      ...options,
      shortlistMaxOverride
    }
  });
  if (merged.usedGroupFallback) {
    return {group, usedGroupFallback: true, groupTrace};
  }
  groupTrace.candidateCountAfter = Array.isArray(merged.candidates) ? merged.candidates.length : originalCandidates.length;
  return {
    group: {
      ...group,
      material: group && group.material ? {...group.material} : {},
      candidates: merged.candidates
    },
    usedGroupFallback: false,
    groupTrace
  };
}

async function runPrefilterPhase({
  groups,
  targetValue,
  targetStepSpec = null,
  recipeContext = {},
  phaseName = "prefilter/base",
  options = {}
}) {
  const startMs = Date.now();
  const sourceGroups = Array.isArray(groups) ? groups : [];
  const resolvedOptions = resolvePrefilterOptions(options);
  const prefilterTrace = buildPhaseTrace({
    phaseName,
    options: resolvedOptions,
    targetValue,
    targetStepSpec
  });
  if (!resolvedOptions.enableOversizedPrefilter) {
    prefilterTrace.prefilterMs = Date.now() - startMs;
    return {
      kind: "phase_ready",
      groups: sourceGroups,
      prefilterTrace,
      retryMode: prefilterTrace.retryMode,
      prefilteredIndexes: [],
      groupFallbackIndexes: [],
      usedRarityFullFallback: false
    };
  }
  const modeHint = asString(recipeContext && recipeContext.modeHint).trim() || resolveModeHint(sourceGroups);
  const nextGroups = sourceGroups.slice();
  let changed = false;
  for (let groupIndex = 0; groupIndex < sourceGroups.length; groupIndex += 1) {
    const remainingCallTimeoutMs = resolvedOptions.prefilterCallTimeoutMs - (Date.now() - startMs);
    if (remainingCallTimeoutMs <= 0) {
      prefilterTrace.retryMode = "rarity_full";
      prefilterTrace.prefilterMs = Date.now() - startMs;
      return {
        kind: "call_timeout",
        groups: sourceGroups,
        prefilterTrace,
        retryMode: "rarity_full",
        prefilteredIndexes: [],
        groupFallbackIndexes: [],
        usedRarityFullFallback: true
      };
    }
    const group = sourceGroups[groupIndex];
    const shardCount = resolveShardCount(
      Array.isArray(group && group.candidates) ? group.candidates.length : 0,
      resolvedOptions
    );
    if (shardCount <= 0) continue;
    try {
      const processed = await processOversizedGroup({
        group,
        groupIndex,
        targetValue,
        targetStepSpec,
        modeHint,
        phaseName,
        options: resolvedOptions,
        remainingCallTimeoutMs
      });
      prefilterTrace.groups.push(processed.groupTrace);
      if (processed.usedGroupFallback) {
        prefilterTrace.groupFallbackIndexes.push(groupIndex);
        continue;
      }
      nextGroups[groupIndex] = processed.group;
      changed = changed || nextGroups[groupIndex] !== group;
      prefilterTrace.prefilteredIndexes.push(groupIndex);
    } catch (err) {
      if (err && err.code === "call_timeout") {
        prefilterTrace.retryMode = "rarity_full";
        prefilterTrace.prefilterMs = Date.now() - startMs;
        return {
          kind: "call_timeout",
          groups: sourceGroups,
          prefilterTrace,
          retryMode: "rarity_full",
          prefilteredIndexes: [],
          groupFallbackIndexes: [],
          usedRarityFullFallback: true
        };
      }
      prefilterTrace.groupFallbackIndexes.push(groupIndex);
    }
  }
  prefilterTrace.prefilterMs = Date.now() - startMs;
  return {
    kind: "phase_ready",
    groups: changed ? nextGroups : sourceGroups,
    prefilterTrace,
    retryMode: prefilterTrace.retryMode,
    prefilteredIndexes: prefilterTrace.prefilteredIndexes.slice(),
    groupFallbackIndexes: prefilterTrace.groupFallbackIndexes.slice(),
    usedRarityFullFallback: false
  };
}

module.exports = {
  buildStrideShardsWithCenterOverlap,
  mergeShardSelections,
  normalizeShardRole,
  resolvePrefilterOptions,
  resolveShardCount,
  runPrefilterPhase,
  prefilterOversizedGroups: runPrefilterPhase
};
