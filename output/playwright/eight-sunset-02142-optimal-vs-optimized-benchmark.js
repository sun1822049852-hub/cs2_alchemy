"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Module = require("node:module");
const {spawn} = require("node:child_process");
const {performance} = require("node:perf_hooks");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = __dirname;
const STAMP = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const ARTIFACT_PREFIX = "eight-sunset-02142-optimal-vs-optimized-benchmark";
const JSON_PATH = path.join(OUT_DIR, `${ARTIFACT_PREFIX}-${STAMP}.json`);
const MD_PATH = path.join(OUT_DIR, `${ARTIFACT_PREFIX}-${STAMP}.md`);
const STAGE_LOG_PATH = path.join(OUT_DIR, `${ARTIFACT_PREFIX}-${STAMP}.stage.jsonl`);
const CHILD_RESULT_PATH = path.join(OUT_DIR, `${ARTIFACT_PREFIX}-${STAMP}.child-result.json`);
const SNAPSHOT_PATH = path.join(
  PROJECT_ROOT,
  "backup/processed_inventory/inventory_processed_20260506_100641.preserved_for_eight_anchor_20260506_100912.json"
);
const EXPECTED_SNAPSHOT_SHA256 = "74F6FE8FE252C9268BB53008A5FBE7CE52EAB918AC532102D9FAD4B6A094E461";
const BASELINE_OVERALL = 0.19996105134487152;
const UI_STATE_PATH = path.join(PROJECT_ROOT, "inventory_ui_state.json");
const PRESET_NAME = "狩猎0.2142";
const TARGET_WEAR_APPROACH_MODE = "below";
const DEFAULT_WEAR_FILTER_MODE = "relative";
const DEFAULT_INCLUDE_COOLING = false;
const DEFAULT_USE_COMPONENT_ITEMS = true;
const DEFAULT_ENABLE_FAST_CRAFT_ASSIST = false;
const DEFAULT_WEAR_OFFSET_PCT = 1;
const OPTIMIZED_EVALUATION_MODE = "ignore_wear_offset_pct_for_baseline_comparison";
const EPSILON = 1e-14;
const ORACLE_TIME_LIMIT_MS = 15 * 60 * 1000;
const OPTIMIZED_CHILD_TIMEOUT_MS = Number(process.env.OPTIMIZED_CHILD_TIMEOUT_MS || 180000);
const searchEvents = [];
const searchProfileEvents = [];
let searchCallCount = 0;
let activeStageRecord = null;

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

function appendJsonl(filePath, payload) {
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return {phase: "parse_error", raw: line};
      }
    });
}

function asString(value) {
  return String(value == null ? "" : value);
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundMs(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "null";
  return Number.isFinite(Number(value)) ? String(Number(value)) : "null";
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").toUpperCase();
}

function createStageRecorder(role, filePath) {
  return function recordStage(phase, details = {}) {
    const event = {
      role,
      phase,
      timestamp: new Date().toISOString(),
      ...clonePlain(details)
    };
    appendJsonl(filePath, event);
    return event;
  };
}

function rowAssetId(row) {
  if (!row || typeof row !== "object") return "";
  return asString(row.asset_id || row.assetid || row.item_id || row.id || row.component_id).trim();
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

function materialCandidateValue(row, materialItem) {
  const mode = asString(materialItem && materialItem.wear_filter_mode).trim() === "absolute"
    ? "absolute"
    : "relative";
  return mode === "absolute" ? absoluteWear(row) : relativeWear(row);
}

function isMaterialCandidateRow(row, materialItem) {
  if (itemDisplayName(row) !== asString(materialItem && materialItem.name).trim()) return false;
  const value = materialCandidateValue(row, materialItem);
  if (value == null) return false;
  const min = Number(materialItem && materialItem.wear_min);
  const max = Number(materialItem && materialItem.wear_max);
  if (Number.isFinite(min) && value < min - EPSILON) return false;
  if (Number.isFinite(max) && value > max + EPSILON) return false;
  return true;
}

function makeOracleSolution(selected, pickCount, targetRaw, detail = {}) {
  if (!Array.isArray(selected) || selected.length !== pickCount) return null;
  const itemIds = selected.map((item) => item.id);
  if (new Set(itemIds).size !== itemIds.length) return null;
  const sum = selected.reduce((total, item) => total + Number(item.value), 0);
  const overall = sum / pickCount;
  if (!(overall < targetRaw - EPSILON)) return null;
  return {
    oracle_status: "optimal",
    oracle_type: detail.oracle_type || "exact_branch_and_bound_single_material",
    detail,
    overall,
    raw_gap: targetRaw - overall,
    sum,
    item_ids: itemIds,
    values: selected.map((item) => item.value)
  };
}

function pickBetterOracle(best, candidate) {
  if (!candidate) return best;
  if (!best) return candidate;
  if (candidate.sum > best.sum + EPSILON) return candidate;
  if (Math.abs(candidate.sum - best.sum) <= EPSILON) {
    return candidate.item_ids.join(",").localeCompare(best.item_ids.join(",")) < 0 ? candidate : best;
  }
  return best;
}

function findExactBestBelowSingleMaterial(candidates, pickCount, targetRaw, options = {}) {
  const started = performance.now();
  const timeLimitMs = Number(options.timeLimitMs || ORACLE_TIME_LIMIT_MS);
  const progressEveryMs = Number(options.progressEveryMs || 30000);
  const progress = typeof options.onProgress === "function" ? options.onProgress : null;
  const normalized = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({
      id: asString(candidate && candidate.id).trim(),
      value: Number(candidate && candidate.value),
      row: candidate && candidate.row
    }))
    .filter((candidate) => candidate.id && Number.isFinite(candidate.value));
  const unique = [];
  const seen = new Set();
  for (const candidate of normalized) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    unique.push(candidate);
  }
  if (!Number.isFinite(targetRaw) || !Number.isInteger(pickCount) || pickCount <= 0 || unique.length < pickCount) {
    return {
      oracle_status: "bounded_or_inconclusive",
      oracle_type: "exact_branch_and_bound_single_material",
      reason: "invalid_input_or_insufficient_candidates",
      duration_ms: roundMs(performance.now() - started),
      candidate_count: unique.length,
      pick_count: pickCount
    };
  }

  const targetSum = targetRaw * pickCount;
  const sortedDesc = [...unique].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  const topK = sortedDesc.slice(0, pickCount);
  const allCandidatesBelowTarget = sortedDesc.every((item) => item.value < targetRaw - EPSILON);
  const topKSum = topK.reduce((sum, item) => sum + item.value, 0);
  if (allCandidatesBelowTarget && topKSum < targetSum - EPSILON) {
    const solution = makeOracleSolution(topK, pickCount, targetRaw, {
      oracle_type: "exact_top_k_all_candidates_below_raw",
      proof: "all_candidates_individually_below_target_so_top_k_values_maximize_below_sum",
      searched_nodes: 0,
      pruned_nodes: 0,
      shortcut: "top_k_all_below"
    });
    return {
      ...solution,
      duration_ms: roundMs(performance.now() - started),
      candidate_count: unique.length,
      pick_count: pickCount
    };
  }

  const n = sortedDesc.length;
  const suffixMax = Array.from({length: pickCount + 1}, () => Array(n + 1).fill(-Infinity));
  const suffixMin = Array.from({length: pickCount + 1}, () => Array(n + 1).fill(Infinity));
  for (let i = 0; i <= n; i += 1) {
    suffixMax[0][i] = 0;
    suffixMin[0][i] = 0;
  }
  for (let need = 1; need <= pickCount; need += 1) {
    for (let i = n - 1; i >= 0; i -= 1) {
      suffixMax[need][i] = suffixMax[need][i + 1];
      suffixMin[need][i] = suffixMin[need][i + 1];
      const withMax = sortedDesc[i].value + suffixMax[need - 1][i + 1];
      const withMin = sortedDesc[i].value + suffixMin[need - 1][i + 1];
      if (withMax > suffixMax[need][i]) suffixMax[need][i] = withMax;
      if (withMin < suffixMin[need][i]) suffixMin[need][i] = withMin;
    }
  }

  let best = null;
  let nodes = 0;
  let pruned = 0;
  let timedOut = false;
  let lastProgress = performance.now();
  const selected = [];

  function dfs(start, need, sum) {
    nodes += 1;
    const now = performance.now();
    if (now - started > timeLimitMs) {
      timedOut = true;
      return;
    }
    if (progress && now - lastProgress >= progressEveryMs) {
      lastProgress = now;
      progress({nodes, pruned, best_gap: best ? targetRaw - best.overall : null});
    }
    if (need === 0) {
      if (sum < targetSum - EPSILON) {
        best = pickBetterOracle(best, makeOracleSolution([...selected], pickCount, targetRaw, {
          proof: "complete_depth_first_branch_and_bound",
          searched_nodes: nodes,
          pruned_nodes: pruned
        }));
      }
      return;
    }
    if (n - start < need) return;
    if (sum + suffixMin[need][start] >= targetSum - EPSILON) {
      pruned += 1;
      return;
    }
    if (best && sum + suffixMax[need][start] <= best.sum + EPSILON) {
      pruned += 1;
      return;
    }
    for (let i = start; i <= n - need; i += 1) {
      if (timedOut) return;
      const nextSum = sum + sortedDesc[i].value;
      if (nextSum + suffixMin[need - 1][i + 1] >= targetSum - EPSILON) {
        pruned += 1;
        continue;
      }
      if (best && nextSum + suffixMax[need - 1][i + 1] <= best.sum + EPSILON) {
        pruned += 1;
        continue;
      }
      selected.push(sortedDesc[i]);
      dfs(i + 1, need - 1, nextSum);
      selected.pop();
    }
  }

  dfs(0, pickCount, 0);
  if (timedOut) {
    return {
      oracle_status: "bounded_or_inconclusive",
      oracle_type: "exact_branch_and_bound_single_material",
      reason: "time_limit_exceeded",
      best_found: best,
      duration_ms: roundMs(performance.now() - started),
      candidate_count: unique.length,
      pick_count: pickCount,
      nodes,
      pruned
    };
  }
  if (!best) {
    return {
      oracle_status: "optimal",
      oracle_type: "exact_branch_and_bound_single_material",
      reason: "no_below_solution",
      overall: null,
      raw_gap: null,
      item_ids: [],
      values: [],
      duration_ms: roundMs(performance.now() - started),
      candidate_count: unique.length,
      pick_count: pickCount,
      nodes,
      pruned
    };
  }
  best.detail = {
    ...best.detail,
    proof: "complete_depth_first_branch_and_bound",
    searched_nodes: nodes,
    pruned_nodes: pruned
  };
  return {
    ...best,
    duration_ms: roundMs(performance.now() - started),
    candidate_count: unique.length,
    pick_count: pickCount,
    nodes,
    pruned
  };
}

function runSelfTest() {
  const candidates = [
    {id: "a", value: 0.11},
    {id: "b", value: 0.21},
    {id: "c", value: 0.19},
    {id: "d", value: 0.18},
    {id: "e", value: 0.05},
    {id: "f", value: 0.17}
  ];
  const result = findExactBestBelowSingleMaterial(candidates, 3, 0.2, {timeLimitMs: 1000});
  const ids = result.item_ids.join(",");
  if (result.oracle_status !== "optimal" || ids !== "b,c,d") {
    throw new Error(`self-test expected optimal b,c,d, got ${result.oracle_status} ${ids}`);
  }
  if (Math.abs(result.overall - (0.21 + 0.19 + 0.18) / 3) > 1e-15) {
    throw new Error(`self-test unexpected overall ${result.overall}`);
  }
  console.log("[self-test] oracle helper passed");
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
  const stopReasons = {};
  let totalCandidateAttempts = 0;
  let completeScoreAttempts = 0;
  for (const event of beamEvents) {
    const reason = asString(event.stopReason || "unknown");
    stopReasons[reason] = (stopReasons[reason] || 0) + 1;
    for (const inner of Array.isArray(event.innerExtras) ? event.innerExtras : []) {
      totalCandidateAttempts += Number(inner && inner.candidateAttempts || 0);
      completeScoreAttempts += Number(inner && inner.completeScoreAttempts || 0);
      const innerReason = asString(inner && inner.stopReason || "");
      if (innerReason) stopReasons[innerReason] = (stopReasons[innerReason] || 0) + 1;
    }
  }
  return {
    search_call_count: countSearchCalls(searchEvents),
    event_count: events.length,
    beam_cap_event_count: beamEvents.length,
    total_candidate_attempts: totalCandidateAttempts,
    complete_score_attempts: completeScoreAttempts,
    top_stop_reasons: Object.entries(stopReasons)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([reason, count]) => ({reason, count}))
  };
}

function installSearchHook() {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);
    let resolved = "";
    try {
      resolved = path.resolve(Module._resolveFilename(request, parent, isMain));
    } catch (_) {
      resolved = "";
    }
    if (!resolved.endsWith(path.normalize("node_sidecar/src/services/craftAssistSearch.js"))) {
      return loaded;
    }
    const originalSearch = loaded.searchCraftAssistBestSolution;
    if (typeof originalSearch !== "function" || originalSearch.__optimalVsOptimizedWrapped) {
      return loaded;
    }
    loaded.searchCraftAssistBestSolution = function tracedSearchCraftAssistBestSolution(args = {}) {
      const groups = Array.isArray(args.groups) ? args.groups : [];
      const started = performance.now();
      const searchIndex = searchCallCount;
      searchCallCount += 1;
      const originalOnSearchProfile = typeof args.onSearchProfile === "function" ? args.onSearchProfile : null;
      const tracedArgs = {
        ...args,
        enableRawBelowTopKFastPath: true,
        onSearchProfile(event) {
          searchProfileEvents.push(decorateSearchProfileEvent(event, searchIndex));
          if (originalOnSearchProfile) originalOnSearchProfile(event);
        }
      };
      searchEvents.push({
        phase: "search_enter",
          search_index: searchIndex,
          targetValue: numberOrNull(args.targetValue),
          approachMode: args.approachMode || "below",
          enableRawBelowTopKFastPath: true,
          hasTargetStepSpec: !!args.targetStepSpec,
        groupCounts: groups.map((group, index) => ({
          index,
          role: asString(group && group.material && group.material.role || "main"),
          count: Number(group && group.material && group.material.count || 0),
          candidates: Array.isArray(group && group.candidates) ? group.candidates.length : 0
        }))
      });
      if (typeof activeStageRecord === "function") {
        activeStageRecord("search_enter", {
          search_index: searchIndex,
          target_value: numberOrNull(args.targetValue),
          approach_mode: args.approachMode || "below",
          enable_raw_below_top_k_fast_path: true,
          has_target_step_spec: !!args.targetStepSpec,
          group_count: groups.length
        });
      }
      try {
        const result = originalSearch.call(this, tracedArgs);
        searchEvents.push({
          phase: "search_exit",
          search_index: searchIndex,
          duration_ms: roundMs(performance.now() - started),
          ok: !!result,
          overall: result && Number.isFinite(Number(result.overall)) ? Number(result.overall) : null,
          selectedCount: result && Array.isArray(result.materialResults)
            ? result.materialResults.reduce((sum, entry) => sum + (Array.isArray(entry.selected) ? entry.selected.length : 0), 0)
            : 0
        });
        if (typeof activeStageRecord === "function") {
          activeStageRecord("search_exit", {
            search_index: searchIndex,
            duration_ms: roundMs(performance.now() - started),
            ok: !!result,
            overall: result && Number.isFinite(Number(result.overall)) ? Number(result.overall) : null
          });
        }
        return result;
      } catch (err) {
        searchEvents.push({
          phase: "search_throw",
          search_index: searchIndex,
          duration_ms: roundMs(performance.now() - started),
          error: String(err && err.stack || err)
        });
        if (typeof activeStageRecord === "function") {
          activeStageRecord("search_throw", {
            search_index: searchIndex,
            duration_ms: roundMs(performance.now() - started),
            error: String(err && err.stack || err)
          });
        }
        throw err;
      }
    };
    loaded.searchCraftAssistBestSolution.__optimalVsOptimizedWrapped = true;
    return loaded;
  };
}

function findPreset(uiState) {
  const presets = uiState && uiState.app_users && uiState.app_users.dev_local
    ? uiState.app_users.dev_local.craft_assist_presets
    : [];
  return (Array.isArray(presets) ? presets : []).find((preset) => preset && preset.name === PRESET_NAME);
}

function buildPayloadFromPreset(preset) {
  return {
    target_wear_raw: asString(preset && preset.target_wear_raw),
    target_wear: Number(preset && preset.target_wear),
    wear_filter_mode: DEFAULT_WEAR_FILTER_MODE,
    wear_approach_mode: TARGET_WEAR_APPROACH_MODE,
    use_component_items: DEFAULT_USE_COMPONENT_ITEMS,
    include_component_items: DEFAULT_USE_COMPONENT_ITEMS,
    include_cooling: DEFAULT_INCLUDE_COOLING,
    wear_offset_pct: DEFAULT_WEAR_OFFSET_PCT,
    enable_fast_craft_assist: DEFAULT_ENABLE_FAST_CRAFT_ASSIST,
    blocked_ids: [],
    selected_item_ids: [],
    materials: Array.isArray(preset && preset.materials) ? clonePlain(preset.materials) : []
  };
}

function buildOptimizedEvaluationPayload(payload) {
  return {
    ...clonePlain(payload),
    wear_offset_pct: 0,
    optimized_evaluation_mode: OPTIMIZED_EVALUATION_MODE
  };
}

function extractSingleMaterialCandidates(candidateRows, payload) {
  const material = payload.materials[0];
  const materialItem = material && Array.isArray(material.items) ? material.items[0] : null;
  const candidates = [];
  for (const row of Array.isArray(candidateRows) ? candidateRows : []) {
    if (!isMaterialCandidateRow(row, materialItem)) continue;
    const value = materialCandidateValue(row, materialItem);
    candidates.push({
      id: rowAssetId(row),
      value,
      row
    });
  }
  return candidates.filter((candidate) => candidate.id && Number.isFinite(candidate.value));
}

function sameItemIds(left, right) {
  const a = Array.isArray(left) ? left.map(String).sort() : [];
  const b = Array.isArray(right) ? right.map(String).sort() : [];
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function buildCandidateContextOnly({payload, rows, buildCraftCandidateContext}) {
  const candidateContext = buildCraftCandidateContext({
    rows,
    includeComponentItems: !!payload.include_component_items,
    includeCooling: !!payload.include_cooling,
    selectedItemIds: payload.selected_item_ids || []
  });
  return candidateContext;
}

async function runOptimizedService({payload, candidateContext, createCraftAssistService}) {
  const service = createCraftAssistService({logger: null});
  const started = performance.now();
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
  return {
    result,
    duration_ms: roundMs(performance.now() - started)
  };
}

function renderMarkdown(artifact) {
  const lines = [
    "# Eight Sunset 0.2142 optimal vs optimized benchmark",
    "",
    `- status: ${artifact.status}`,
    `- oracle_status: ${artifact.optimal_oracle.oracle_status}`,
    `- oracle_type: ${artifact.optimal_oracle.oracle_type}`,
    `- baseline_overall: ${formatNumber(artifact.baseline_overall)}`,
    `- candidate_count: ${artifact.candidate_count}`,
    `- pick_count: ${artifact.pick_count}`,
    `- target_wear_raw: ${artifact.target_wear_raw}`,
    `- target_wear: ${artifact.target_wear}`,
    `- optimized_evaluation_mode: ${artifact.optimized_evaluation_mode}`,
    `- optimized_payload.wear_offset_pct: ${formatNumber(artifact.optimized_payload && artifact.optimized_payload.wear_offset_pct)}`,
    `- optimal_oracle.overall: ${formatNumber(artifact.optimal_oracle.overall)}`,
    `- optimized.overall: ${formatNumber(artifact.optimized.overall)}`,
    `- optimized_vs_baseline_delta: ${formatNumber(artifact.optimized_vs_baseline_delta)}`,
    `- optimized_vs_baseline_abs_delta: ${formatNumber(artifact.optimized_vs_baseline_abs_delta)}`,
    `- raw_gap_optimal: ${formatNumber(artifact.raw_gap_optimal)}`,
    `- raw_gap_optimized: ${formatNumber(artifact.raw_gap_optimized)}`,
    `- gap_delta: ${formatNumber(artifact.gap_delta)}`,
    `- optimized_over_raw_amount: ${formatNumber(artifact.optimized_over_raw_amount)}`,
    `- item_ids_same: ${artifact.item_ids_same}`,
    `- duration_optimal_ms: ${formatNumber(artifact.duration_optimal_ms)}`,
    `- duration_optimized_ms: ${formatNumber(artifact.duration_optimized_ms)}`,
    `- speedup: ${formatNumber(artifact.speedup)}`,
    `- stage_log_path: ${artifact.artifacts.stage_log}`,
    `- child_result_path: ${artifact.artifacts.child_result}`,
    "",
    "## Baseline / Delta",
    "",
    `- baseline_overall: ${formatNumber(artifact.baseline_overall)}`,
    `- optimized_vs_baseline_delta: ${formatNumber(artifact.optimized_vs_baseline_delta)}`,
    `- optimized_vs_baseline_abs_delta: ${formatNumber(artifact.optimized_vs_baseline_abs_delta)}`,
    "",
    "## Optimized item ids",
    "",
    ...(artifact.optimized.item_ids || []).map((id) => `- ${id}`),
    "",
    "## Oracle item ids",
    "",
    ...(artifact.optimal_oracle.item_ids || []).map((id) => `- ${id}`),
    "",
    "## Notes",
    "",
    ...artifact.limitations.map((item) => `- ${item}`)
  ];
  fs.writeFileSync(MD_PATH, `${lines.join("\n")}\n`, "utf8");
}

function writeCheckpointArtifact(checkpoint) {
  writeJson(JSON_PATH, checkpoint);
  renderMarkdown(checkpoint);
}

function spawnOptimizedChild(checkpointJsonPath, timeoutMs, stageRecord) {
  return new Promise((resolve) => {
    const started = performance.now();
    stageRecord("child_spawn", {
      timeout_ms: timeoutMs,
      checkpoint_json_path: checkpointJsonPath
    });
    const child = spawn(process.execPath, [__filename, "--optimized-child", checkpointJsonPath], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      stageRecord("child_timeout", {
        timeout_ms: timeoutMs,
        pid: child.pid
      });
      resolve({
        optimized_status: "timeout",
        optimized_type: "child_process",
        duration_ms: roundMs(performance.now() - started),
        timeout_ms: timeoutMs,
        exit_code: null,
        signal: "SIGKILL",
        stdout: stdout.slice(-20000),
        stderr: stderr.slice(-20000)
      });
    }, Math.max(1, Number(timeoutMs || 1)));

    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      stageRecord("child_exit", {
        exit_code: code,
        signal,
        pid: child.pid
      });
      let parsed = null;
      if (fs.existsSync(CHILD_RESULT_PATH)) {
        try {
          parsed = readJson(CHILD_RESULT_PATH);
        } catch (_) {
          parsed = null;
        }
      }
      if (code === 0 && parsed && typeof parsed === "object") {
        resolve({
          optimized_status: "ok",
          optimized_type: "child_process",
          duration_ms: roundMs(performance.now() - started),
          timeout_ms: timeoutMs,
          exit_code: code,
          signal,
          stdout: "",
          stderr: stderr.slice(-20000),
          child_payload: parsed
        });
        return;
      }
      resolve({
        optimized_status: "error",
        optimized_type: "child_process",
        duration_ms: roundMs(performance.now() - started),
        timeout_ms: timeoutMs,
        exit_code: code,
        signal,
        stdout: stdout.slice(-20000),
        stderr: stderr.slice(-20000)
      });
    });
  });
}

async function runOptimizedChildMode(checkpointJsonPath) {
  const checkpoint = readJson(checkpointJsonPath);
  const payload = checkpoint && checkpoint.payload;
  const optimizedPayload = checkpoint && checkpoint.optimized_payload
    ? checkpoint.optimized_payload
    : buildOptimizedEvaluationPayload(payload);
  const snapshotPath = checkpoint && checkpoint.snapshot_path;
  const expectedSha = checkpoint && checkpoint.snapshot_sha256;
  const stageLogPath = checkpoint && (checkpoint.stage_log_path || (checkpoint.artifacts && checkpoint.artifacts.stage_log));
  const childResultPath = checkpoint && (checkpoint.child_result_path || (checkpoint.artifacts && checkpoint.artifacts.child_result));
  const recordStage = createStageRecorder("child", stageLogPath);
  activeStageRecord = recordStage;
  if (!payload || !snapshotPath || !expectedSha) {
    throw new Error("optimized-child invalid checkpoint payload");
  }
  if (!stageLogPath || !childResultPath) {
    throw new Error("optimized-child missing stage log or child result path");
  }
  recordStage("optimized_evaluation_mode_ready", {
    optimized_evaluation_mode: optimizedPayload && optimizedPayload.optimized_evaluation_mode ? optimizedPayload.optimized_evaluation_mode : OPTIMIZED_EVALUATION_MODE,
    wear_offset_pct: Number(optimizedPayload && optimizedPayload.wear_offset_pct)
  });

  recordStage("child_start", {
    checkpoint_json_path: checkpointJsonPath,
    snapshot_path: snapshotPath
  });
  const actualSha = sha256File(snapshotPath);
  if (String(actualSha).toUpperCase() !== String(expectedSha).toUpperCase()) {
    throw new Error(`optimized-child snapshot SHA mismatch: expected ${expectedSha}, got ${actualSha}`);
  }
  recordStage("snapshot_verified", {
    snapshot_sha256: actualSha
  });

  const snapshot = readJson(snapshotPath);
  const rows = Array.isArray(snapshot.items) ? snapshot.items : [];
  const {buildCraftCandidateContext} = require(path.join(PROJECT_ROOT, "node_sidecar/src/services/craftCandidateService"));
  const {createCraftAssistService} = require(path.join(PROJECT_ROOT, "node_sidecar/src/services/craftAssistService"));

  const candidateContext = buildCandidateContextOnly({payload, rows, buildCraftCandidateContext});
  recordStage("candidate_context_ready", {
    candidate_count: Array.isArray(candidateContext && candidateContext.candidateRows) ? candidateContext.candidateRows.length : 0,
    stats: candidateContext && candidateContext.stats ? candidateContext.stats : null
  });
  const optimizedRun = await runOptimizedService({payload: optimizedPayload, candidateContext, createCraftAssistService});
  const optimizedOverall = optimizedRun.result && Number.isFinite(Number(optimizedRun.result.overall))
    ? Number(optimizedRun.result.overall)
    : null;
  const optimizedItemIds = optimizedRun.result && Array.isArray(optimizedRun.result.item_ids)
    ? optimizedRun.result.item_ids.map(String)
    : [];
  const targetRaw = Number(payload && payload.target_wear_raw);
  const rawGapOptimized = optimizedOverall == null ? null : targetRaw - optimizedOverall;
  const optimizedOverRawAmount = optimizedOverall == null ? null : Math.max(0, optimizedOverall - targetRaw);
  const childPayload = {
    payload,
    optimized_payload: optimizedPayload,
    optimized_evaluation_mode: optimizedPayload && optimizedPayload.optimized_evaluation_mode ? optimizedPayload.optimized_evaluation_mode : OPTIMIZED_EVALUATION_MODE,
    ok: !!(optimizedRun.result && optimizedRun.result.ok),
    overall: optimizedOverall,
    raw_gap: rawGapOptimized,
    optimized_over_raw_amount: optimizedOverRawAmount,
    item_ids: optimizedItemIds,
    duration_ms: optimizedRun.duration_ms,
    result: optimizedRun.result,
    candidate_context_stats: candidateContext.stats,
    optimized_search_events: searchEvents,
    optimized_search_profile_summary: summarizeSearchProfile(searchProfileEvents)
  };
  recordStage("child_result_ready", {
    ok: childPayload.ok,
    overall: childPayload.overall,
    raw_gap: childPayload.raw_gap,
    optimized_over_raw_amount: childPayload.optimized_over_raw_amount,
    duration_ms: childPayload.duration_ms
  });
  writeJson(childResultPath, {
    ...childPayload,
    stage_events: readJsonl(stageLogPath)
  });
  recordStage("child_result_written", {
    child_result_path: childResultPath
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--optimized-child") {
    const checkpointJsonPath = args[1];
    if (!checkpointJsonPath) throw new Error("missing --optimized-child <checkpoint-json>");
    installSearchHook();
    await runOptimizedChildMode(checkpointJsonPath);
    return;
  }

  runSelfTest();
  installSearchHook();

  console.log("[benchmark] checking snapshot sha256");
  const actualSha = sha256File(SNAPSHOT_PATH);
  if (actualSha !== EXPECTED_SNAPSHOT_SHA256) {
    throw new Error(`snapshot SHA mismatch: expected ${EXPECTED_SNAPSHOT_SHA256}, got ${actualSha}`);
  }

  const snapshot = readJson(SNAPSHOT_PATH);
  const rows = Array.isArray(snapshot.items) ? snapshot.items : [];
  const uiState = readJson(UI_STATE_PATH);
  const preset = findPreset(uiState);
  if (!preset) throw new Error(`preset not found: ${PRESET_NAME}`);
  const payload = buildPayloadFromPreset(preset);
  const optimizedPayload = buildOptimizedEvaluationPayload(payload);
  const targetRaw = Number(payload.target_wear_raw);
  const targetWear = Number(payload.target_wear);
  const pickCount = Number(payload.materials[0] && payload.materials[0].count);
  if (!Number.isFinite(targetRaw) || !Number.isFinite(targetWear) || !Number.isInteger(pickCount)) {
    throw new Error("invalid target or pick count");
  }

  const {buildCraftCandidateContext} = require(path.join(PROJECT_ROOT, "node_sidecar/src/services/craftCandidateService"));

  console.log("[benchmark] building shared candidate pool");
  const candidateContext = buildCandidateContextOnly({payload, rows, buildCraftCandidateContext});

  console.log("[benchmark] building exact oracle candidate list");
  const materialCandidates = extractSingleMaterialCandidates(candidateContext.candidateRows, payload);
  console.log(`[benchmark] candidate_count=${materialCandidates.length}, pick_count=${pickCount}`);
  console.log("[benchmark] running exact single-material oracle");
  const oracle = findExactBestBelowSingleMaterial(materialCandidates, pickCount, targetRaw, {
    timeLimitMs: ORACLE_TIME_LIMIT_MS,
    onProgress(event) {
      console.log(`[oracle] nodes=${event.nodes} pruned=${event.pruned} best_gap=${event.best_gap}`);
    }
  });

  const rawGapOptimal = Number.isFinite(Number(oracle.raw_gap)) ? Number(oracle.raw_gap) : null;
  const stageRecord = createStageRecorder("parent", STAGE_LOG_PATH);
  activeStageRecord = stageRecord;
  stageRecord("oracle_complete", {
    oracle_status: oracle.oracle_status,
    oracle_type: oracle.oracle_type,
    overall: oracle.overall,
    raw_gap: rawGapOptimal,
    candidate_count: materialCandidates.length,
    pick_count: pickCount
  });
  const checkpoint = {
    status: oracle.oracle_status === "optimal" ? "ORACLE_COMPLETE" : "ORACLE_INCOMPLETE",
    timestamp: new Date().toISOString(),
    snapshot_path: SNAPSHOT_PATH,
    snapshot_sha256: actualSha,
    preset_name: PRESET_NAME,
    preset,
    payload,
    optimized_payload: optimizedPayload,
    optimized_evaluation_mode: OPTIMIZED_EVALUATION_MODE,
    target_wear_raw: targetRaw,
    target_wear: targetWear,
    candidate_count: materialCandidates.length,
    pick_count: pickCount,
    baseline_overall: BASELINE_OVERALL,
    optimal_oracle: oracle,
    raw_gap_optimal: rawGapOptimal,
    optimized: {
      optimized_status: "not_started",
      optimized_type: "child_process"
    },
    artifacts: {
      script: __filename,
      json: JSON_PATH,
      md: MD_PATH,
      stage_log: STAGE_LOG_PATH,
      child_result: CHILD_RESULT_PATH
    },
    stage_log_path: STAGE_LOG_PATH,
    child_result_path: CHILD_RESULT_PATH,
    limitations: [
      "Checkpoint written immediately after oracle completes so optimized timeouts still preserve oracle evidence.",
      "The oracle is scoped to this single-material preset and this exact production-built candidate pool."
    ]
  };
  writeCheckpointArtifact(checkpoint);

  console.log(`[benchmark] spawning optimized child (timeout=${OPTIMIZED_CHILD_TIMEOUT_MS}ms)`);
  const childOutcome = await spawnOptimizedChild(JSON_PATH, OPTIMIZED_CHILD_TIMEOUT_MS, stageRecord);
  const stageEvents = readJsonl(STAGE_LOG_PATH);
  const childResult = fs.existsSync(CHILD_RESULT_PATH) ? readJson(CHILD_RESULT_PATH) : null;

  const optimizedResultPayload = childOutcome && childOutcome.child_payload
    ? childOutcome.child_payload
    : childResult;
  const optimizedEvaluationPayload = optimizedResultPayload && optimizedResultPayload.optimized_payload
    ? optimizedResultPayload.optimized_payload
    : childResult && childResult.optimized_payload
      ? childResult.optimized_payload
      : optimizedResultPayload && optimizedResultPayload.payload
        ? optimizedResultPayload.payload
        : null;
  const optimizedOverall = optimizedResultPayload && Number.isFinite(Number(optimizedResultPayload.overall))
    ? Number(optimizedResultPayload.overall)
    : null;
  const rawGapOptimized = optimizedOverall == null ? null : targetRaw - optimizedOverall;
  const gapDelta = rawGapOptimal == null || rawGapOptimized == null ? null : rawGapOptimized - rawGapOptimal;
  const optimizedOverRawAmount = optimizedOverall == null ? null : Math.max(0, optimizedOverall - targetRaw);
  const optimizedVsBaselineDelta = optimizedOverall == null ? null : optimizedOverall - BASELINE_OVERALL;
  const optimizedVsBaselineAbsDelta = optimizedVsBaselineDelta == null ? null : Math.abs(optimizedVsBaselineDelta);
  const durationOptimalMs = oracle.duration_ms;
  const durationOptimizedMs = optimizedResultPayload && Number.isFinite(Number(optimizedResultPayload.duration_ms))
    ? Number(optimizedResultPayload.duration_ms)
    : null;
  const speedup = durationOptimizedMs && durationOptimizedMs > 0 ? durationOptimalMs / durationOptimizedMs : null;
  const optimizedItemIds = optimizedResultPayload && Array.isArray(optimizedResultPayload.item_ids)
    ? optimizedResultPayload.item_ids.map(String)
    : [];

  const artifact = {
    status: oracle.oracle_status === "optimal" ? "COMPLETE" : "INCOMPLETE",
    timestamp: new Date().toISOString(),
    snapshot_path: SNAPSHOT_PATH,
    snapshot_sha256: actualSha,
    preset_name: PRESET_NAME,
    preset,
    payload,
    optimized_payload: optimizedEvaluationPayload,
    optimized_evaluation_mode: optimizedEvaluationPayload && optimizedEvaluationPayload.optimized_evaluation_mode
      ? optimizedEvaluationPayload.optimized_evaluation_mode
      : OPTIMIZED_EVALUATION_MODE,
    target_wear_raw: targetRaw,
    target_wear: targetWear,
    candidate_count: materialCandidates.length,
    pick_count: pickCount,
    baseline_overall: BASELINE_OVERALL,
    optimal_oracle: oracle,
    optimized: {
      optimized_status: childOutcome.optimized_status,
      optimized_type: childOutcome.optimized_type,
      timeout_ms: childOutcome.timeout_ms,
      exit_code: childOutcome.exit_code,
      signal: childOutcome.signal,
      ok: !!(optimizedResultPayload && optimizedResultPayload.ok),
      overall: optimizedOverall,
      raw_gap: rawGapOptimized,
      item_ids: optimizedItemIds,
      duration_ms: durationOptimizedMs,
      result: optimizedResultPayload ? optimizedResultPayload.result : null,
      child_stderr_tail: childOutcome.stderr || null,
      child_stdout_tail: childOutcome.stdout || null,
      stage_log_path: STAGE_LOG_PATH,
      child_result_path: CHILD_RESULT_PATH,
      stage_event_count: stageEvents.length,
      stage_events: stageEvents,
      child_result: childResult
    },
    raw_gap_optimal: rawGapOptimal,
    raw_gap_optimized: rawGapOptimized,
    gap_delta: gapDelta,
    optimized_over_raw_amount: optimizedOverRawAmount,
    optimized_vs_baseline_delta: optimizedVsBaselineDelta,
    optimized_vs_baseline_abs_delta: optimizedVsBaselineAbsDelta,
    item_ids_same: sameItemIds(oracle.item_ids, optimizedItemIds),
    duration_optimal_ms: durationOptimalMs,
    duration_optimized_ms: durationOptimizedMs,
    speedup,
    candidate_context_stats: optimizedResultPayload ? optimizedResultPayload.candidate_context_stats : candidateContext.stats,
    optimized_search_events: optimizedResultPayload ? optimizedResultPayload.optimized_search_events : [],
    optimized_search_profile_summary: optimizedResultPayload ? optimizedResultPayload.optimized_search_profile_summary : {search_call_count: 0, event_count: 0},
    artifacts: {
      script: __filename,
      json: JSON_PATH,
      md: MD_PATH,
      stage_log: STAGE_LOG_PATH,
      child_result: CHILD_RESULT_PATH
    },
    stage_log_path: STAGE_LOG_PATH,
    child_result_path: CHILD_RESULT_PATH,
    limitations: [
      "This benchmark uses the offline service path, not an HTTP request through uiServer middleware.",
      "The oracle is scoped to this single-material preset and this exact production-built candidate pool.",
      "The optimized search profile keeps aggregate hook fields only and omits candidate/state details.",
      "Optimized evidence is recovered from a persisted stage log and child result file so timeout runs still preserve progress."
    ]
  };

  writeCheckpointArtifact(artifact);
  console.log(JSON.stringify({
    status: artifact.status,
    oracle_status: artifact.optimal_oracle.oracle_status,
    optimal_overall: artifact.optimal_oracle.overall,
    optimized_overall: artifact.optimized.overall,
    raw_gap_optimal: artifact.raw_gap_optimal,
    raw_gap_optimized: artifact.raw_gap_optimized,
    gap_delta: artifact.gap_delta,
    optimized_over_raw_amount: artifact.optimized_over_raw_amount,
    optimized_vs_baseline_delta: artifact.optimized_vs_baseline_delta,
    optimized_vs_baseline_abs_delta: artifact.optimized_vs_baseline_abs_delta,
    item_ids_same: artifact.item_ids_same,
    duration_optimal_ms: artifact.duration_optimal_ms,
    duration_optimized_ms: artifact.duration_optimized_ms,
    speedup: artifact.speedup,
    optimized_status: artifact.optimized.optimized_status,
    json: JSON_PATH,
    md: MD_PATH
  }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack || err);
  process.exitCode = 1;
});
