"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const {performance} = require("node:perf_hooks");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SAMPLE_INDEX_PATH = path.join(__dirname, "craft-assist-multi-sample-benchmark-samples.json");
const OUTPUT_DIR = __dirname;
const DEFAULT_SAMPLE_ID = "eight-preserved-hunting-02142";
const PROFILE_FORBIDDEN_KEYS = new Set([
  "candidate",
  "candidates",
  "state",
  "states",
  "selected",
  "usedIds",
  "selectedIdsByGroup"
]);
const FROZEN_SAMPLE_ARTIFACT_PATHS = {
  "eight-preserved-hunting-02142": path.join(__dirname, "eight-sunset-02142-optimal-vs-optimized-benchmark-20260506T095827Z.json"),
  "eight-preserved-hunting-train-37-027": path.join(__dirname, "train-hunting-037-027-anchor-20260506_100641-fast-optin-offline-final-current-20260506T103158Z.json"),
  "eight-preserved-hunting-train-28-024": path.join(__dirname, "train-hunting-028-024-anchor-20260506_100641-preset-028-024-fast-optin-offline-final-current-20260506T105900Z.json")
};
const SUPPORTED_SAMPLE_IDS = new Set(Object.keys(FROZEN_SAMPLE_ARTIFACT_PATHS));
const CRAFT_ASSIST_SEARCH_MODULE_PATH = path.join(PROJECT_ROOT, "node_sidecar/src/services/craftAssistSearch.js");
const CRAFT_ASSIST_SERVICE_MODULE_PATH = path.join(PROJECT_ROOT, "node_sidecar/src/services/craftAssistService.js");
const CRAFT_CANDIDATE_SERVICE_MODULE_PATH = path.join(PROJECT_ROOT, "node_sidecar/src/services/craftCandidateService.js");
const CRAFT_FLOAT32_MODULE_PATH = path.join(PROJECT_ROOT, "node_sidecar/src/services/craftAssistFloat32Step.js");

function asString(value) {
  return String(value == null ? "" : value);
}

function readJson(filePath, label = "JSON file") {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`Failed to read ${label} at ${filePath}: ${error && error.message ? error.message : error}`, {cause: error});
  }
}

function writeTextAtomic(filePath, text) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, text, "utf8");
  fs.renameSync(tempPath, filePath);
}

function writeJson(filePath, payload) {
  writeTextAtomic(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function roundMs(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function normalizeItemId(value) {
  return asString(value).trim();
}

function normalizeItemIds(ids) {
  return (Array.isArray(ids) ? ids : [])
    .map((value) => normalizeItemId(value))
    .filter(Boolean);
}

function resolvedPath(projectRelativePath) {
  return path.isAbsolute(projectRelativePath)
    ? projectRelativePath
    : path.resolve(PROJECT_ROOT, projectRelativePath);
}

function clonePlain(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function sanitizeProfilePayload(value) {
  if (Array.isArray(value)) return value.map((item) => sanitizeProfilePayload(item));
  if (!value || typeof value !== "object") return value;
  const sanitized = {};
  for (const [key, inner] of Object.entries(value)) {
    if (PROFILE_FORBIDDEN_KEYS.has(key)) continue;
    sanitized[key] = sanitizeProfilePayload(inner);
  }
  return sanitized;
}

function summarizeBeamProfile(events, searchCallCount) {
  const phaseCounts = {};
  const topStopReasons = {};
  for (const event of Array.isArray(events) ? events : []) {
    const phase = asString(event && event.phase).trim() || "unknown";
    phaseCounts[phase] = (phaseCounts[phase] || 0) + 1;
    const stopReason = asString(event && (event.stopReason || event.reason)).trim();
    if (stopReason) topStopReasons[stopReason] = (topStopReasons[stopReason] || 0) + 1;
  }
  return {
    search_call_count: Number(searchCallCount) || 0,
    event_count: Array.isArray(events) ? events.length : 0,
    phase_counts: Object.entries(phaseCounts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([phase, count]) => ({phase, count})),
    top_stop_reasons: Object.entries(topStopReasons)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([reason, count]) => ({reason, count}))
  };
}

function isPreservedSnapshotPath(snapshotPath) {
  const normalized = asString(snapshotPath).replace(/\\/g, "/").toLowerCase();
  return /(?:\.preserved_|preserved_for_)/i.test(normalized);
}

function assertPreservedSnapshotPath(snapshotPath, {sampleId, sourceLabel}) {
  if (isPreservedSnapshotPath(snapshotPath)) return;
  throw new Error(`Expected preserved snapshot path for sample ${sampleId} from ${sourceLabel}: ${snapshotPath}`);
}

function clearModuleFromRequireCache(modulePath) {
  delete require.cache[modulePath];
}

function clearProductionModuleCaches() {
  clearModuleFromRequireCache(CRAFT_ASSIST_SEARCH_MODULE_PATH);
  clearModuleFromRequireCache(CRAFT_ASSIST_SERVICE_MODULE_PATH);
  clearModuleFromRequireCache(CRAFT_CANDIDATE_SERVICE_MODULE_PATH);
  clearModuleFromRequireCache(CRAFT_FLOAT32_MODULE_PATH);
}

function validateFrozenArtifactField(value, fieldPath, sampleId, {allowArray = false} = {}) {
  if (allowArray) {
    if (Array.isArray(value)) return;
    throw new Error(`Missing or invalid frozen artifact field ${fieldPath} for sample ${sampleId}`);
  }
  if (value === null || value === undefined) {
    throw new Error(`Missing or invalid frozen artifact field ${fieldPath} for sample ${sampleId}`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`Missing or invalid frozen artifact field ${fieldPath} for sample ${sampleId}`);
  }
  if (typeof value === "string" && !value.trim()) {
    throw new Error(`Missing or invalid frozen artifact field ${fieldPath} for sample ${sampleId}`);
  }
  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
    throw new Error(`Missing or invalid frozen artifact field ${fieldPath} for sample ${sampleId}`);
  }
}

function validateFrozenArtifact(frozenArtifact, sampleId) {
  validateFrozenArtifactField(frozenArtifact && frozenArtifact.snapshot_path, "snapshot_path", sampleId);
  validateFrozenArtifactField(frozenArtifact && frozenArtifact.payload, "payload", sampleId);
  validateFrozenArtifactField(frozenArtifact && frozenArtifact.payload && frozenArtifact.payload.target_wear, "payload.target_wear", sampleId);
  validateFrozenArtifactField(frozenArtifact && frozenArtifact.payload && frozenArtifact.payload.target_wear_raw, "payload.target_wear_raw", sampleId);
  validateFrozenArtifactField(frozenArtifact && frozenArtifact.payload && frozenArtifact.payload.wear_filter_mode, "payload.wear_filter_mode", sampleId);
  validateFrozenArtifactField(frozenArtifact && frozenArtifact.payload && frozenArtifact.payload.wear_approach_mode, "payload.wear_approach_mode", sampleId);
  validateFrozenArtifactField(frozenArtifact && frozenArtifact.payload && frozenArtifact.payload.wear_offset_pct, "payload.wear_offset_pct", sampleId);
  validateFrozenArtifactField(frozenArtifact && frozenArtifact.payload && frozenArtifact.payload.materials, "payload.materials", sampleId, {allowArray: true});
}

function loadProductionRuntime() {
  const {buildCraftCandidateContext} = require(CRAFT_CANDIDATE_SERVICE_MODULE_PATH);
  const {createCraftAssistService} = require(CRAFT_ASSIST_SERVICE_MODULE_PATH);
  const {resolveCraftAssistTargetStepSpec} = require(CRAFT_FLOAT32_MODULE_PATH);
  return {
    buildCraftCandidateContext,
    createCraftAssistService,
    resolveCraftAssistTargetStepSpec
  };
}

function createDefaultBeamProfileCollector() {
  const events = [];
  let searchCallCount = 0;
  const originalLoad = Module._load;
  const searchModuleSuffix = path.normalize(path.join("node_sidecar", "src", "services", "craftAssistSearch.js"));

  function wrapSearchModule(loaded) {
    const originalSearch = loaded && loaded.searchCraftAssistBestSolution;
    if (typeof originalSearch !== "function" || originalSearch.__baselineReplayWrapped) {
      return loaded;
    }
    loaded.searchCraftAssistBestSolution = function tracedSearchCraftAssistBestSolution(args = {}) {
      const searchIndex = searchCallCount;
      searchCallCount += 1;
      const originalOnSearchProfile = typeof args.onSearchProfile === "function" ? args.onSearchProfile : null;
      return originalSearch.call(this, {
        ...args,
        onSearchProfile(event) {
          const sanitized = sanitizeProfilePayload(clonePlain(event));
          events.push({
            search_index: searchIndex,
            ...(sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
              ? sanitized
              : {value: sanitized})
          });
          if (originalOnSearchProfile) originalOnSearchProfile(event);
        }
      });
    };
    loaded.searchCraftAssistBestSolution.__baselineReplayWrapped = true;
    return loaded;
  }

  Module._load = function patchedLoad(request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);
    let resolved = "";
    try {
      resolved = Module._resolveFilename(request, parent, isMain);
    } catch (error) {
      resolved = "";
    }
    if (!resolved || !path.normalize(resolved).endsWith(searchModuleSuffix)) {
      return loaded;
    }
    return wrapSearchModule(loaded);
  };

  return {
    prepareRuntimeLoading() {
      clearProductionModuleCaches();
    },
    summarize() {
      return summarizeBeamProfile(events, searchCallCount);
    },
    restore() {
      Module._load = originalLoad;
      clearProductionModuleCaches();
    }
  };
}

function defaultLoadSampleDefinition(sampleId) {
  const samples = readJson(SAMPLE_INDEX_PATH, "sample index");
  const sample = (Array.isArray(samples) ? samples : []).find((entry) => asString(entry && entry.id).trim() === sampleId);
  if (!sample) {
    throw new Error(`sample not found in sample index at ${SAMPLE_INDEX_PATH}: ${sampleId}`);
  }
  return sample;
}

function defaultLoadFrozenArtifact(sampleId) {
  const filePath = FROZEN_SAMPLE_ARTIFACT_PATHS[sampleId];
  if (!filePath) {
    throw new Error(`frozen artifact path not configured for sample ${sampleId}`);
  }
  return readJson(filePath, `frozen artifact for sample ${sampleId}`);
}

function defaultLoadSnapshotRows(snapshotPath) {
  const resolved = resolvedPath(snapshotPath);
  const snapshot = readJson(resolved, "preserved snapshot");
  if (Array.isArray(snapshot)) return snapshot;
  if (Array.isArray(snapshot && snapshot.items)) return snapshot.items;
  throw new Error(`snapshot rows not found in preserved snapshot at ${resolved}`);
}

function defaultBuildCandidateContext(rows, runtime) {
  return runtime.buildCraftCandidateContext({
    rows,
    includeComponentItems: true,
    includeCooling: false,
    selectedItemIds: []
  });
}

function createDefaultArtifactWriter(outputDir) {
  return function writeArtifacts(payload, {sampleId} = {}) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const safeSampleId = asString(sampleId).trim() || "sample";
    const prefix = `craft-assist-baseline-replay-${safeSampleId}-${stamp}`;
    const jsonPath = path.join(outputDir, `${prefix}.json`);
    const mdPath = path.join(outputDir, `${prefix}.md`);
    const artifacts = {
      script: __filename,
      json: jsonPath,
      md: mdPath
    };
    const finalPayload = {...payload, artifacts};
    writeJson(jsonPath, finalPayload);
    writeTextAtomic(mdPath, renderMarkdown(finalPayload));
    return artifacts;
  };
}

function renderMarkdown(payload) {
  const lines = [
    "# Craft Assist Baseline Replay",
    "",
    `- sample_id: ${payload.sample_id}`,
    `- snapshot_path: ${payload.snapshot_path}`,
    `- preset: ${asString(payload && payload.preset && payload.preset.name).trim() || asString(payload && payload.preset_name).trim() || "-"}`,
    `- duration_ms: ${payload.duration_ms}`,
    `- service_duration_ms: ${payload.service_duration_ms}`,
    `- baseline.ok: ${payload && payload.baseline && payload.baseline.ok === true}`,
    `- baseline.overall: ${payload && payload.baseline && payload.baseline.overall != null ? payload.baseline.overall : "-"}`,
    `- baseline.item_ids: ${Array.isArray(payload && payload.baseline && payload.baseline.item_ids) ? payload.baseline.item_ids.join(",") : "-"}`,
    `- beam_profile_search_calls: ${payload && payload.beam_profile_summary ? payload.beam_profile_summary.search_call_count : 0}`,
    `- beam_profile_events: ${payload && payload.beam_profile_summary ? payload.beam_profile_summary.event_count : 0}`,
    "",
    "## Path",
    "",
    "- Preserved snapshot only.",
    "- Frozen payload and frozen target_step_spec only.",
    "- Production candidate builder.",
    "- Production baseline service path only.",
    "- Beam profile summary records aggregated beam_cap events only.",
    "- No oracle, no anchor rolling, no optimized comparison.",
    "- `enableFastCraftAssist` forced to `false`."
  ];
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const options = {sampleId: DEFAULT_SAMPLE_ID};
  for (let index = 0; index < args.length; index += 1) {
    const token = asString(args[index]).trim();
    if (token === "--only" && args[index + 1]) {
      options.sampleId = asString(args[index + 1]).trim();
      index += 1;
    }
  }
  return options;
}

function resolveFrozenPreset(frozenArtifact, sample) {
  if (frozenArtifact && frozenArtifact.preset && typeof frozenArtifact.preset === "object") {
    return clonePlain(frozenArtifact.preset);
  }
  return {
    name: asString(frozenArtifact && frozenArtifact.preset_name).trim() || asString(sample && sample.preset_name).trim()
  };
}

function resolveTargetStepSpecFromFrozenArtifact({frozenArtifact, payload, sampleId, resolveTargetStepSpec}) {
  if (frozenArtifact && frozenArtifact.target_step_spec && typeof frozenArtifact.target_step_spec === "object") {
    return {
      targetStepSpec: clonePlain(frozenArtifact.target_step_spec),
      source: "frozen_artifact"
    };
  }
  if (typeof resolveTargetStepSpec !== "function") {
    throw new Error(`Missing target_step_spec and resolveTargetStepSpec helper for sample ${sampleId}`);
  }
  return {
    targetStepSpec: resolveTargetStepSpec({
      inputStep: Number(payload.target_wear),
      inputRaw: payload.target_wear_raw,
      approachMode: payload.wear_approach_mode,
      offsetValue: Number(payload.target_wear) * (Number(payload.wear_offset_pct) / 100)
    }),
    source: "recomputed_from_frozen_payload"
  };
}

async function runCraftAssistBaselineReplay(options = {}, deps = {}) {
  const sampleId = asString(options && options.sampleId).trim() || DEFAULT_SAMPLE_ID;
  if (!SUPPORTED_SAMPLE_IDS.has(sampleId)) {
    throw new Error(`unsupported sample id: ${sampleId}`);
  }

  const nowMs = typeof deps.nowMs === "function" ? deps.nowMs : () => performance.now();
  const collector = typeof deps.createSearchProfileCollector === "function"
    ? deps.createSearchProfileCollector()
    : createDefaultBeamProfileCollector();

  try {
    if (collector && typeof collector.prepareRuntimeLoading === "function") {
      collector.prepareRuntimeLoading();
    }

    const runtime = typeof deps.loadProductionRuntime === "function"
      ? deps.loadProductionRuntime()
      : loadProductionRuntime();
    const loadSampleDefinition = typeof deps.loadSampleDefinition === "function"
      ? deps.loadSampleDefinition
      : defaultLoadSampleDefinition;
    const loadFrozenArtifact = typeof deps.loadFrozenArtifact === "function"
      ? deps.loadFrozenArtifact
      : defaultLoadFrozenArtifact;
    const loadSnapshotRows = typeof deps.loadSnapshotRows === "function"
      ? deps.loadSnapshotRows
      : defaultLoadSnapshotRows;
    const buildCandidateContext = typeof deps.buildCandidateContext === "function"
      ? deps.buildCandidateContext
      : (rows) => defaultBuildCandidateContext(rows, runtime);
    const resolveTargetStepSpec = typeof deps.resolveTargetStepSpec === "function"
      ? deps.resolveTargetStepSpec
      : runtime.resolveCraftAssistTargetStepSpec;
    const createBaselineService = typeof deps.createBaselineService === "function"
      ? deps.createBaselineService
      : () => runtime.createCraftAssistService({logger: null});
    const writeArtifacts = typeof deps.writeArtifacts === "function"
      ? deps.writeArtifacts
      : createDefaultArtifactWriter(OUTPUT_DIR);

    const startedAt = nowMs();
    const sample = loadSampleDefinition(sampleId);
    const frozenArtifact = loadFrozenArtifact(sampleId);
    validateFrozenArtifact(frozenArtifact, sampleId);
    const sampleSnapshotPath = resolvedPath(sample && sample.snapshot_path);
    const frozenSnapshotPath = resolvedPath(frozenArtifact && frozenArtifact.snapshot_path);

    assertPreservedSnapshotPath(sampleSnapshotPath, {sampleId, sourceLabel: "sample index"});
    assertPreservedSnapshotPath(frozenSnapshotPath, {sampleId, sourceLabel: "frozen artifact"});

    if (path.normalize(sampleSnapshotPath) !== path.normalize(frozenSnapshotPath)) {
      throw new Error(
        `snapshot_path mismatch for sample ${sampleId}: sample index=${sampleSnapshotPath} frozen artifact=${frozenSnapshotPath}`
      );
    }

    const payload = clonePlain(frozenArtifact && frozenArtifact.payload);
    const {targetStepSpec, source: targetStepSpecSource} = resolveTargetStepSpecFromFrozenArtifact({
      frozenArtifact,
      payload,
      sampleId,
      resolveTargetStepSpec
    });
    validateFrozenArtifactField(targetStepSpec, "target_step_spec", sampleId);

    const rows = loadSnapshotRows(frozenArtifact.snapshot_path);
    const candidateContext = buildCandidateContext(rows);
    const baselineService = createBaselineService();
    const serviceStartedAt = nowMs();
    const baselineResult = await baselineService.selectForRecipe({
      candidateRows: Array.isArray(candidateContext && candidateContext.candidateRows) ? candidateContext.candidateRows : [],
      targetWear: Number(payload.target_wear),
      targetWearRaw: payload.target_wear_raw,
      wearFilterMode: payload.wear_filter_mode,
      wearApproachMode: payload.wear_approach_mode,
      materials: Array.isArray(payload.materials) ? payload.materials : [],
      blockedIds: Array.isArray(payload.blocked_ids) ? payload.blocked_ids : [],
      includeCooling: !!payload.include_cooling,
      wearOffsetPct: Number(payload.wear_offset_pct),
      enableFastCraftAssist: false
    });
    const serviceFinishedAt = nowMs();
    const finishedAt = nowMs();

    const result = {
      sample_id: sample.id,
      snapshot_path: frozenSnapshotPath,
      preset_name: asString(frozenArtifact && frozenArtifact.preset_name).trim() || asString(sample && sample.preset_name).trim(),
      preset: resolveFrozenPreset(frozenArtifact, sample),
      baseline: {
        ok: !!(baselineResult && baselineResult.ok),
        overall: Number.isFinite(Number(baselineResult && baselineResult.overall))
          ? Number(baselineResult.overall)
          : null,
        item_ids: normalizeItemIds(baselineResult && baselineResult.item_ids)
      },
      duration_ms: roundMs(finishedAt - startedAt),
      service_duration_ms: roundMs(serviceFinishedAt - serviceStartedAt),
      candidate_context_stats: clonePlain(
        (candidateContext && (candidateContext.stats || candidateContext.candidateContextStats)) || {}
      ),
      target_step_spec: targetStepSpec,
      target_step_spec_source: targetStepSpecSource,
      beam_profile_summary: collector && typeof collector.summarize === "function"
        ? collector.summarize()
        : {search_call_count: 0, event_count: 0, phase_counts: [], top_stop_reasons: []}
    };

    const artifacts = writeArtifacts(result, {sampleId});
    if (artifacts && typeof artifacts === "object") {
      result.artifacts = artifacts;
    }
    return result;
  } finally {
    if (collector && typeof collector.restore === "function") {
      collector.restore();
    }
  }
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  const run = typeof deps.runCraftAssistBaselineReplay === "function"
    ? deps.runCraftAssistBaselineReplay
    : runCraftAssistBaselineReplay;
  return run(options, deps);
}

if (require.main === module) {
  main()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error && error.stack || error);
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_SAMPLE_ID,
  FROZEN_SAMPLE_ARTIFACT_PATHS,
  SUPPORTED_SAMPLE_IDS,
  main,
  parseArgs,
  runCraftAssistBaselineReplay
};
