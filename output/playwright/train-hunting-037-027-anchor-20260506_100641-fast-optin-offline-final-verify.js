"use strict";

process.env.SHARD_JOB_TIMEOUT_MS = process.env.SHARD_JOB_TIMEOUT_MS || "120000";
process.env.PREFILTER_GROUP_TIMEOUT_MS = process.env.PREFILTER_GROUP_TIMEOUT_MS || "300000";
process.env.PREFILTER_CALL_TIMEOUT_MS = process.env.PREFILTER_CALL_TIMEOUT_MS || "600000";

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const {performance} = require("node:perf_hooks");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = __dirname;
const VARIANT = String(process.env.CRAFT_ASSIST_BENCH_VARIANT || process.argv[2] || "current").trim();
const BASELINE_TAG = "anchor-20260506_100641-fast-optin";
const STAMP = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const PREFIX = `train-hunting-037-027-${BASELINE_TAG}-offline-final-${VARIANT}`;
const JSON_PATH = path.join(OUT_DIR, `${PREFIX}-${STAMP}.json`);
const MD_PATH = path.join(OUT_DIR, `${PREFIX}-${STAMP}.md`);
const PROFILE_PREFIX = `train-hunting-037-027-${BASELINE_TAG}-offline-profile-${VARIANT}`;
const PROFILE_JSON_PATH = path.join(OUT_DIR, `${PROFILE_PREFIX}-${STAMP}.json`);
const PROFILE_MD_PATH = path.join(OUT_DIR, `${PROFILE_PREFIX}-${STAMP}.md`);

const SNAPSHOT_PATH = path.join(PROJECT_ROOT, "backup/processed_inventory/inventory_processed_20260506_100641.preserved_for_eight_anchor_20260506_100912.json");
const SNAPSHOT_SHA256 = "74F6FE8FE252C9268BB53008A5FBE7CE52EAB918AC532102D9FAD4B6A094E461";
const UI_STATE_PATH = path.join(PROJECT_ROOT, "inventory_ui_state.json");
const PRESET_NAME = "狩猎列车37 0.27";

const searchEvents = [];
const searchProfileEvents = [];
let searchCallCount = 0;
const PROFILE_FORBIDDEN_KEYS = new Set([
  "candidate",
  "candidates",
  "state",
  "states",
  "selected",
  "usedIds",
  "selectedIdsByGroup"
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function clonePlain(value) {
  if (!value || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

function sanitizeProfilePayload(value) {
  if (Array.isArray(value)) return value.map(sanitizeProfilePayload);
  if (!value || typeof value !== "object") return value;
  const sanitized = {};
  for (const [key, inner] of Object.entries(value)) {
    if (PROFILE_FORBIDDEN_KEYS.has(key)) continue;
    sanitized[key] = sanitizeProfilePayload(inner);
  }
  return sanitized;
}

function decorateSearchProfileEvent(event, searchIndex) {
  const cloned = sanitizeProfilePayload(clonePlain(event));
  const payload = cloned && typeof cloned === "object" && !Array.isArray(cloned) ? cloned : {value: cloned};
  return {
    variant: VARIANT,
    search_index: searchIndex,
    event_index: searchProfileEvents.length,
    timestamp: new Date().toISOString(),
    ...payload
  };
}

function countSearchCalls(events) {
  return events.filter((event) => event && event.phase === "search_enter").length;
}

function summarizeSearchProfile(events) {
  const beamEvents = events.filter((event) => event && event.phase === "beam_cap");
  const topStopReasons = {};
  let totalCandidateAttempts = 0;
  let nextStates = 0;
  let partialScoreAttempts = 0;
  let partialPrunedStates = 0;
  let beamInputStates = 0;
  let beamOutputStates = 0;
  let completeScoreAttempts = 0;
  for (const event of beamEvents) {
    const reason = String(event.stopReason || "unknown");
    topStopReasons[reason] = (topStopReasons[reason] || 0) + 1;
    for (const inner of Array.isArray(event.innerExtras) ? event.innerExtras : []) {
      totalCandidateAttempts += Number(inner && inner.candidateAttempts || 0);
      nextStates += Number(inner && inner.nextStates || 0);
      partialScoreAttempts += Number(inner && inner.partialScoreAttempts || 0);
      partialPrunedStates += Number(inner && inner.partialPrunedStates || 0);
      beamInputStates += Number(inner && inner.beamInputStates || 0);
      beamOutputStates += Number(inner && inner.beamOutputStates || 0);
      completeScoreAttempts += Number(inner && inner.completeScoreAttempts || 0);
      const innerReason = String(inner && inner.stopReason || "");
      if (innerReason) topStopReasons[innerReason] = (topStopReasons[innerReason] || 0) + 1;
    }
  }
  return {
    search_call_count: countSearchCalls(searchEvents),
    event_count: events.length,
    beam_cap_event_count: beamEvents.length,
    total_candidate_attempts: totalCandidateAttempts,
    candidateAttempts: totalCandidateAttempts,
    nextStates,
    partialScoreAttempts,
    partialPrunedStates,
    beamInputStates,
    beamOutputStates,
    complete_score_attempts: completeScoreAttempts,
    completeScoreAttempts,
    top_stop_reasons: Object.entries(topStopReasons)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([reason, count]) => ({reason, count}))
  };
}

function asString(value) {
  return String(value == null ? "" : value);
}

function itemDisplayName(row) {
  return asString((row && row.alchemy_name) || (row && row.name)).trim();
}

function absoluteWear(row) {
  const value = Number(row && row.float_value);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

function relativeWear(row) {
  const wear = absoluteWear(row);
  const min = Number(row && row.minfloat);
  const max = Number(row && row.maxfloat);
  if (wear == null || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  return Math.max(0, Math.min(1, (wear - min) / (max - min)));
}

function rarityValue(row) {
  const value = Number(row && row.rarity);
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function findPreset(value) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPreset(item);
      if (found) return found;
    }
    return null;
  }
  if (value.name === PRESET_NAME) return value;
  for (const child of Object.values(value)) {
    const found = findPreset(child);
    if (found) return found;
  }
  return null;
}

function buildPayload() {
  const state = readJson(UI_STATE_PATH);
  const preset = findPreset(state);
  if (!preset) throw new Error(`Preset not found: ${PRESET_NAME}`);
  const userState = state && state.app_users && state.app_users.dev_local ? state.app_users.dev_local : {};
  const username = asString(userState.last_selected_username || userState.selected_username || "430158438") || "430158438";
  return {
    username,
    target_wear_raw: asString(preset.target_wear_raw || "0.27"),
    target_wear: Number(preset.target_wear),
    wear_filter_mode: "relative",
    wear_approach_mode: "below",
    use_component_items: true,
    include_component_items: true,
    include_cooling: false,
    wear_offset_pct: 1,
    enable_fast_craft_assist: String(process.env.CRAFT_ASSIST_ENABLE_FAST || "").trim() === "1" || VARIANT === "fast-optin",
    blocked_ids: [],
    selected_item_ids: [],
    materials: Array.isArray(preset.materials) ? preset.materials : []
  };
}

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Unable to transform craftAssistSearch.js for ${label}`);
  return source.replace(from, to);
}

function transformNoRoleSortCache(source) {
  let transformed = source;
  transformed = replaceOnce(
    transformed,
`      const sortedAvailable = getRoleAwareAvailableList(refinementContext, entryIndex, "asc");`,
`      const sortedAvailable = (Array.isArray(entry && entry.available) ? entry.available : [])
        .slice()
        .sort(compareByValueAsc);`,
    "individual sorted available"
  );
  transformed = replaceOnce(
    transformed,
`        const higherMains = mainAvailableDesc
          .filter((candidate) => {
            const id = String(candidate && candidate.id || "");
            return id
              && !usedWithoutMain.has(id)
              && Number(candidate && candidate.value || 0) > Number(oldMain && oldMain.value || 0) + EPSILON;
          });`,
`        const higherMains = (Array.isArray(mainEntry && mainEntry.available) ? mainEntry.available : [])
          .filter((candidate) => {
            const id = String(candidate && candidate.id || "");
            return id
              && !usedWithoutMain.has(id)
              && Number(candidate && candidate.value || 0) > Number(oldMain && oldMain.value || 0) + EPSILON;
          })
          .sort(compareByValueDesc);`,
    "higher mains filtered sort"
  );
  transformed = replaceOnce(
    transformed,
`              const lowerAuxes = auxAvailableAsc
                .filter((candidate) => {
                  const id = String(candidate && candidate.id || "");
                  return id
                    && !usedWithoutPair.has(id)
                    && Number(candidate && candidate.value || 0) < Number(oldAux && oldAux.value || 0) - EPSILON;
                });`,
`              const lowerAuxes = (Array.isArray(auxEntry && auxEntry.available) ? auxEntry.available : [])
                .filter((candidate) => {
                  const id = String(candidate && candidate.id || "");
                  return id
                    && !usedWithoutPair.has(id)
                    && Number(candidate && candidate.value || 0) < Number(oldAux && oldAux.value || 0) - EPSILON;
                })
                .sort(compareByValueAsc);`,
    "lower auxes filtered sort"
  );
  transformed = replaceOnce(
    transformed,
`        const lowerMains = mainAvailableDesc
          .filter((candidate) => {
            const id = String(candidate && candidate.id || "");
            return id
              && !usedWithoutMain.has(id)
              && Number(candidate && candidate.value || 0) < Number(oldMain && oldMain.value || 0) - EPSILON;
          })
          .slice(0, 4);`,
`        const lowerMains = (Array.isArray(mainEntry && mainEntry.available) ? mainEntry.available : [])
          .filter((candidate) => {
            const id = String(candidate && candidate.id || "");
            return id
              && !usedWithoutMain.has(id)
              && Number(candidate && candidate.value || 0) < Number(oldMain && oldMain.value || 0) - EPSILON;
          })
          .sort(compareByValueDesc)
          .slice(0, 4);`,
    "lower mains filtered sort"
  );
  transformed = replaceOnce(
    transformed,
`              const higherAuxes = auxAvailableAsc
                .filter((candidate) => {
                  const id = String(candidate && candidate.id || "");
                  return id
                    && !usedWithoutPair.has(id)
                    && Number(candidate && candidate.value || 0) > Number(oldAux && oldAux.value || 0) + EPSILON;
                });`,
`              const higherAuxes = (Array.isArray(auxEntry && auxEntry.available) ? auxEntry.available : [])
                .filter((candidate) => {
                  const id = String(candidate && candidate.id || "");
                  return id
                    && !usedWithoutPair.has(id)
                    && Number(candidate && candidate.value || 0) > Number(oldAux && oldAux.value || 0) + EPSILON;
                })
                .sort(compareByValueAsc);`,
    "higher auxes pair filtered sort"
  );
  transformed = replaceOnce(
    transformed,
`        const higherAuxes = auxUpAvailableAsc
          .filter((candidate) => {
            const id = String(candidate && candidate.id || "");
            return id
              && !usedWithoutUp.has(id)
              && Number(candidate && candidate.value || 0) > Number(oldAuxUp && oldAuxUp.value || 0) + EPSILON;
          });`,
`        const higherAuxes = (Array.isArray(auxUpEntry && auxUpEntry.available) ? auxUpEntry.available : [])
          .filter((candidate) => {
            const id = String(candidate && candidate.id || "");
            return id
              && !usedWithoutUp.has(id)
              && Number(candidate && candidate.value || 0) > Number(oldAuxUp && oldAuxUp.value || 0) + EPSILON;
          })
          .sort(compareByValueAsc);`,
    "higher auxes aux-up filtered sort"
  );
  transformed = replaceOnce(
    transformed,
`              const lowerAuxes = auxDownAvailableAsc
                .filter((candidate) => {
                  const id = String(candidate && candidate.id || "");
                  return id
                    && !usedWithoutPair.has(id)
                    && Number(candidate && candidate.value || 0) < Number(oldAuxDown && oldAuxDown.value || 0) - EPSILON;
                });`,
`              const lowerAuxes = (Array.isArray(auxDownEntry && auxDownEntry.available) ? auxDownEntry.available : [])
                .filter((candidate) => {
                  const id = String(candidate && candidate.id || "");
                  return id
                    && !usedWithoutPair.has(id)
                    && Number(candidate && candidate.value || 0) < Number(oldAuxDown && oldAuxDown.value || 0) - EPSILON;
                })
                .sort(compareByValueAsc);`,
    "lower auxes aux-down filtered sort"
  );
  return transformed;
}

function installSearchHook() {
  const originalLoad = Module._load;
  let transformedSearchModule = null;
  Module._load = function patchedLoad(request, parent, isMain) {
    let resolved = "";
    try {
      resolved = path.resolve(Module._resolveFilename(request, parent, isMain));
    } catch (_) {
      resolved = "";
    }
    const isSearchModule = resolved.endsWith(path.normalize("node_sidecar/src/services/craftAssistSearch.js"));
    if (!isSearchModule) return originalLoad.apply(this, arguments);

    let loaded;
    if (VARIANT === "no-role-sort-cache") {
      if (!transformedSearchModule) {
        const source = fs.readFileSync(resolved, "utf8");
        const transformed = transformNoRoleSortCache(source);
        const moduleInstance = new Module(resolved, parent);
        moduleInstance.filename = resolved;
        moduleInstance.paths = Module._nodeModulePaths(path.dirname(resolved));
        transformedSearchModule = moduleInstance;
        moduleInstance._compile(transformed, resolved);
      }
      loaded = transformedSearchModule.exports;
    } else {
      loaded = originalLoad.apply(this, arguments);
    }

    const originalSearch = loaded.searchCraftAssistBestSolution;
    if (typeof originalSearch !== "function" || originalSearch.__train037Wrapped) return loaded;
    loaded.searchCraftAssistBestSolution = function tracedSearchCraftAssistBestSolution(args = {}) {
      const groups = Array.isArray(args.groups) ? args.groups : [];
      const started = performance.now();
      const searchIndex = searchCallCount;
      searchCallCount += 1;
      const originalOnSearchProfile = typeof args.onSearchProfile === "function" ? args.onSearchProfile : null;
      const tracedArgs = {
        ...args,
        onSearchProfile(event) {
          searchProfileEvents.push(decorateSearchProfileEvent(event, searchIndex));
          if (originalOnSearchProfile) originalOnSearchProfile(event);
        }
      };
      searchEvents.push({
        phase: "search_enter",
        variant: VARIANT,
        search_index: searchIndex,
        targetValue: Number(args.targetValue),
        approachMode: args.approachMode || "below",
        hasTargetStepSpec: !!args.targetStepSpec,
        targetStepSpec: args.targetStepSpec || null,
        groupCounts: groups.map((group, index) => ({
          index,
          role: asString(group && group.material && group.material.role || "main"),
          count: Number(group && group.material && group.material.count || 0),
          candidates: Array.isArray(group && group.candidates) ? group.candidates.length : 0
        }))
      });
      try {
        const result = originalSearch.call(this, tracedArgs);
        searchEvents.push({
          phase: "search_exit",
          variant: VARIANT,
          search_index: searchIndex,
          duration_ms: Math.round((performance.now() - started) * 1000) / 1000,
          ok: !!result,
          overall: result && Number.isFinite(Number(result.overall)) ? Number(result.overall) : null,
          fround: result && Number.isFinite(Number(result.overall)) ? Math.fround(Number(result.overall)) : null,
          windowExtra: result && Number.isFinite(Number(result.windowExtra)) ? Number(result.windowExtra) : null,
          selectedCount: result && Array.isArray(result.materialResults)
            ? result.materialResults.reduce((sum, entry) => sum + (Array.isArray(entry.selected) ? entry.selected.length : 0), 0)
            : 0
        });
        return result;
      } catch (err) {
        searchEvents.push({
          phase: "search_throw",
          variant: VARIANT,
          search_index: searchIndex,
          duration_ms: Math.round((performance.now() - started) * 1000) / 1000,
          error: String(err && err.stack || err)
        });
        throw err;
      }
    };
    loaded.searchCraftAssistBestSolution.__train037Wrapped = true;
    return loaded;
  };
}

function summarizeMaterialCandidates(rows, payload) {
  return payload.materials.map((material, materialIndex) => ({
    materialIndex,
    role: material.role,
    count: material.count,
    items: (Array.isArray(material.items) ? material.items : []).map((item) => {
      const materialRows = rows.filter((row) => itemDisplayName(row) === item.name);
      const filtered = materialRows.filter((row) => {
        const rel = relativeWear(row);
        return rel != null && rel >= Number(item.wear_min) - 1e-14 && rel <= Number(item.wear_max) + 1e-14;
      });
      const byRarity = {};
      for (const row of filtered) {
        const key = String(rarityValue(row));
        byRarity[key] = (byRarity[key] || 0) + 1;
      }
      return {
        name: item.name,
        wear_min: item.wear_min,
        wear_max: item.wear_max,
        materialRows: materialRows.length,
        filteredCount: filtered.length,
        filteredByRarity: byRarity,
        filteredRelativeWear: filtered.length
          ? {
              min: Math.min(...filtered.map(relativeWear)),
              max: Math.max(...filtered.map(relativeWear))
            }
          : null
      };
    })
  }));
}

function renderReport(artifact) {
  const r = artifact.result || {};
  const lines = [
    `Status: ${artifact.status}`,
    "",
    "Artifacts:",
    `- JSON: ${artifact.artifacts.json}`,
    `- MD: ${artifact.artifacts.md}`,
    `- Script: ${artifact.artifacts.script}`,
    "",
    "Run summary:",
    `- variant: ${artifact.variant}`,
    `- duration_ms: ${artifact.duration_ms}`,
    `- service_duration_ms: ${artifact.service_duration_ms}`,
    `- ok: ${r.ok === true}`,
    `- overall: ${artifact.overall == null ? "-" : artifact.overall}`,
    `- fround: ${artifact.fround == null ? "-" : artifact.fround}`,
    `- below_raw: ${artifact.below_raw}`,
    `- item_ids: ${Array.isArray(artifact.item_ids) ? artifact.item_ids.join(",") : "-"}`,
    `- baseline: ${BASELINE_TAG}`,
    `- snapshot: ${SNAPSHOT_PATH}`,
    `- expected_sha256: ${SNAPSHOT_SHA256}`,
    "",
    "Route-equivalent path:",
    "- Loaded preserved inventory_processed_20260506_100641 snapshot.",
    "- Built production candidate rows with include_component_items/use_component_items=true.",
    "- Called createCraftAssistService().selectForRecipe directly.",
    "- Hooked craftAssistSearch search calls and durations.",
    "",
    "Limitations:",
    ...artifact.limitations.map((line) => `- ${line}`)
  ];
  fs.writeFileSync(MD_PATH, `${lines.join("\n")}\n`, "utf8");
}

function renderProfileReport(profileArtifact) {
  const summary = profileArtifact.search_profile_summary || {};
  const result = profileArtifact.result_summary || {};
  const lines = [
    `Status: ${profileArtifact.status}`,
    "",
    "Profile artifact:",
    `- JSON: ${profileArtifact.artifacts.json}`,
    `- MD: ${profileArtifact.artifacts.md}`,
    `- Source final JSON: ${profileArtifact.source_artifact_path || "-"}`,
    "",
    "Search profile summary:",
    `- search call count: ${summary.search_call_count || 0}`,
    `- profile event count: ${summary.event_count || 0}`,
    `- beam cap event count: ${summary.beam_cap_event_count || 0}`,
    `- total candidate attempts: ${summary.total_candidate_attempts || 0}`,
    `- nextStates: ${summary.nextStates || 0}`,
    `- partialScoreAttempts: ${summary.partialScoreAttempts || 0}`,
    `- partialPrunedStates: ${summary.partialPrunedStates || 0}`,
    `- beamInputStates: ${summary.beamInputStates || 0}`,
    `- beamOutputStates: ${summary.beamOutputStates || 0}`,
    `- complete score attempts: ${summary.complete_score_attempts || 0}`,
    `- top stop reasons: ${Array.isArray(summary.top_stop_reasons) && summary.top_stop_reasons.length ? summary.top_stop_reasons.map((entry) => `${entry.reason}=${entry.count}`).join(", ") : "-"}`,
    "",
    "Result summary:",
    `- ok: ${result.ok === true}`,
    `- overall: ${result.overall == null ? "-" : result.overall}`,
    "",
    "Limitations:",
    ...profileArtifact.limitations.map((line) => `- ${line}`)
  ];
  fs.writeFileSync(PROFILE_MD_PATH, `${lines.join("\n")}\n`, "utf8");
}

function writeProfileArtifacts({status, timestamp, durationMs, serviceDurationMs, result, finalJsonPath, finalMdPath, limitations}) {
  const resultSummary = {
    ok: result && result.ok === true,
    overall: result && Number.isFinite(Number(result.overall)) ? Number(result.overall) : null
  };
  const artifact = {
    status,
    schema_version: "beam_profile_v1",
    timestamp,
    baseline: BASELINE_TAG,
    variant: VARIANT,
    snapshot_path: SNAPSHOT_PATH,
    snapshot_sha256_expected: SNAPSHOT_SHA256,
    source_artifact_path: finalJsonPath,
    source_artifact_md_path: finalMdPath,
    duration_ms: durationMs,
    service_duration_ms: serviceDurationMs,
    result_summary: resultSummary,
    search_profile_events: searchProfileEvents,
    search_profile_summary: summarizeSearchProfile(searchProfileEvents),
    artifacts: {
      script: __filename,
      json: PROFILE_JSON_PATH,
      md: PROFILE_MD_PATH,
      source_json: finalJsonPath,
      source_md: finalMdPath
    },
    limitations: [
      "Offline route-equivalent verification, not an HTTP request through uiServer authentication and worker-pool timeout handling.",
      "Search profile artifact records aggregated beam_cap counters only; per-item search internals are intentionally excluded."
    ]
  };
  writeJson(PROFILE_JSON_PATH, artifact);
  renderProfileReport(artifact);
  return artifact;
}

async function main() {
  installSearchHook();

  const started = performance.now();
  const payload = buildPayload();
  const snapshot = readJson(SNAPSHOT_PATH);
  const rows = Array.isArray(snapshot.items) ? snapshot.items : [];

  const {buildCraftCandidateContext} = require(path.join(PROJECT_ROOT, "node_sidecar/src/services/craftCandidateService"));
  const {createCraftAssistService} = require(path.join(PROJECT_ROOT, "node_sidecar/src/services/craftAssistService"));
  const {resolveCraftAssistTargetStepSpec, quantizeMeanToTargetDomain} = require(path.join(PROJECT_ROOT, "node_sidecar/src/services/craftAssistFloat32Step"));

  const candidateContext = buildCraftCandidateContext({
    rows,
    includeComponentItems: true,
    includeCooling: false,
    selectedItemIds: []
  });
  const targetStepSpec = resolveCraftAssistTargetStepSpec({
    inputStep: payload.target_wear,
    inputRaw: payload.target_wear_raw,
    approachMode: payload.wear_approach_mode,
    offsetValue: Number(payload.target_wear) * (Number(payload.wear_offset_pct) / 100)
  });
  const service = createCraftAssistService({logger: null});
  const serviceStarted = performance.now();
  const result = await service.selectForRecipe({
    candidateRows: candidateContext.candidateRows,
    targetWear: payload.target_wear,
    targetWearRaw: payload.target_wear_raw,
    wearFilterMode: payload.wear_filter_mode,
    wearApproachMode: payload.wear_approach_mode,
    materials: payload.materials,
    blockedIds: payload.blocked_ids,
    includeCooling: payload.include_cooling,
    wearOffsetPct: payload.wear_offset_pct,
    enableFastCraftAssist: payload.enable_fast_craft_assist
  });
  const serviceDurationMs = Math.round((performance.now() - serviceStarted) * 1000) / 1000;
  const durationMs = Math.round((performance.now() - started) * 1000) / 1000;
  const overall = result && Number.isFinite(Number(result.overall)) ? Number(result.overall) : null;
  const fround = overall == null ? null : Math.fround(overall);
  const belowRaw = overall != null && overall < Number(payload.target_wear_raw);
  const status = result && result.ok && belowRaw ? "PASS" : "FAIL";

  const artifact = {
    status,
    timestamp: new Date().toISOString(),
    baseline: BASELINE_TAG,
    variant: VARIANT,
    duration_ms: durationMs,
    service_duration_ms: serviceDurationMs,
    snapshot_path: SNAPSHOT_PATH,
    snapshot_sha256_expected: SNAPSHOT_SHA256,
    payload,
    env_timeouts: {
      SHARD_JOB_TIMEOUT_MS: process.env.SHARD_JOB_TIMEOUT_MS,
      PREFILTER_GROUP_TIMEOUT_MS: process.env.PREFILTER_GROUP_TIMEOUT_MS,
      PREFILTER_CALL_TIMEOUT_MS: process.env.PREFILTER_CALL_TIMEOUT_MS
    },
    candidate_context_stats: candidateContext.stats,
    material_candidate_summary: summarizeMaterialCandidates(candidateContext.candidateRows, payload),
    target_step_spec: targetStepSpec,
    result,
    overall,
    fround,
    quantized_overall: overall == null ? null : quantizeMeanToTargetDomain(overall),
    below_raw: belowRaw,
    item_ids: result && Array.isArray(result.item_ids) ? result.item_ids : [],
    search_events: searchEvents,
    search_profile_summary: summarizeSearchProfile(searchProfileEvents),
    artifacts: {
      script: __filename,
      json: JSON_PATH,
      md: MD_PATH,
      profile_json: PROFILE_JSON_PATH,
      profile_md: PROFILE_MD_PATH
    },
    limitations: [
      "Offline route-equivalent verification, not an HTTP request through uiServer authentication and worker-pool timeout handling.",
      "The script sets long shard/prefilter timeout environment variables before service modules are loaded.",
      "Variant no-role-sort-cache uses an in-memory craftAssistSearch transform to approximate the pre sort-cache role-aware refinement behavior.",
      "Temporary benchmark script derived from train-hunting-037-027-new-baseline-20260504_131128-offline-final-verify.js because listed snapshot files are absent in this workspace."
    ]
  };

  writeJson(JSON_PATH, artifact);
  renderReport(artifact);
  const profileArtifact = writeProfileArtifacts({
    status,
    timestamp: artifact.timestamp,
    durationMs,
    serviceDurationMs,
    result,
    finalJsonPath: JSON_PATH,
    finalMdPath: MD_PATH,
    limitations: artifact.limitations
  });
  console.log(JSON.stringify({
    status,
    variant: VARIANT,
    duration_ms: durationMs,
    service_duration_ms: serviceDurationMs,
    overall,
    fround,
    below_raw: belowRaw,
    item_ids: artifact.item_ids,
    json: JSON_PATH,
    md: MD_PATH,
    profile_event_count: profileArtifact.search_profile_summary.event_count,
    profile_json: PROFILE_JSON_PATH,
    profile_md: PROFILE_MD_PATH
  }, null, 2));
  process.exit(status === "PASS" ? 0 : 1);
}

main().catch((err) => {
  const artifact = {
    status: "BLOCKED",
    timestamp: new Date().toISOString(),
    variant: VARIANT,
    error: String(err && err.stack || err),
    artifacts: {
      script: __filename,
      json: JSON_PATH,
      md: MD_PATH
    },
    limitations: [
      "Verification script failed before producing a service result."
    ]
  };
  try {
    writeJson(JSON_PATH, artifact);
    renderReport({
      ...artifact,
      duration_ms: null,
      service_duration_ms: null,
      result: null,
      overall: null,
      fround: null,
      below_raw: null,
      item_ids: [],
      limitations: artifact.limitations
    });
  } catch (_) {}
  console.error(JSON.stringify({status: "BLOCKED", variant: VARIANT, error: artifact.error, json: JSON_PATH, md: MD_PATH}, null, 2));
  process.exit(2);
});

