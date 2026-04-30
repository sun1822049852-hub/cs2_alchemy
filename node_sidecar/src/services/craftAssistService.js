const {asString} = require("../utils");
const {compareScoreTuples, searchCraftAssistBestSolution} = require("./craftAssistSearch");
const {resolvePrefilterOptions, resolveShardCount, runPrefilterPhase} = require("./craftAssistShardPrefilter");
const {
  buildCraftAssistCandidateCacheKeyTuple,
  normalizeCraftAssistMaterialListCanonical,
  projectCraftAssistTraceMaterial,
  resolveCraftAssistRequiredCount
} = require("../../ui/craftAssistItemWearShared");
const {DedupLogger} = require("../logger");
const craftAssistLogger = new DedupLogger({windowMs: 800});

const WEAR_INPUT_DECIMALS = 16;
const DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT = 5;
const EPSILON = 1e-14;
// Leave a tiny guard band so live craft results do not cross the requested
// relative-wear cap due to float jitter such as 0.2700000107.
const CRAFT_ASSIST_OUTCOME_RELATIVE_GUARD = 1e-14;
const RARITY_MAP = {
  1: "Consumer",
  2: "Industrial",
  3: "Mil-Spec",
  4: "Restricted",
  5: "Classified",
  6: "Covert",
  7: "Contraband"
};

function clampWear01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return Math.max(0, Math.min(1, Number(fallback) || 0));
  }
  return Math.max(0, Math.min(1, n));
}

function truncateNumber(value, decimals = WEAR_INPUT_DECIMALS) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const d = Math.max(0, Math.trunc(Number(decimals) || 0));
  const scale = 10 ** d;
  if (!Number.isFinite(scale) || scale <= 0) return n;
  if (n >= 0) return Math.floor(n * scale + 1e-9) / scale;
  return Math.ceil(n * scale - 1e-9) / scale;
}

function numberTextTrunc(value, decimals = WEAR_INPUT_DECIMALS) {
  const d = Math.max(0, Math.trunc(Number(decimals) || 0));
  const t = truncateNumber(value, d);
  if (t == null) return "-";
  return t.toFixed(d);
}

function parseOptionalWear01(value) {
  const raw = asString(value == null ? "" : value).trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.max(0, Math.min(1, n));
  return truncateNumber(clamped, WEAR_INPUT_DECIMALS);
}

function getCraftAssistOutcomeSafeTarget(targetValue) {
  const target = Number(targetValue);
  if (!Number.isFinite(target)) return targetValue;
  return Math.max(0, target - CRAFT_ASSIST_OUTCOME_RELATIVE_GUARD);
}

function validateCraftAssistFinalOverall({
  overall,
  targetValue,
  safeTargetValue,
  approachMode = "below",
  itemIds = [],
  selectedItems = []
} = {}) {
  if (normalizeCraftAssistApproachMode(approachMode) !== "below") {
    return {ok: true};
  }
  const numericOverall = Number(overall);
  const numericTarget = Number(targetValue);
  const numericSafeTarget = Number(safeTargetValue);
  const normalizedItemIds = normalizeCraftRecipeItemIds(itemIds);
  const normalizedSelectedItems = Array.isArray(selectedItems) ? selectedItems : [];
  if (!Number.isFinite(numericOverall) || !Number.isFinite(numericTarget)) {
    return {
      ok: false,
      code: "final_result_invalid",
      safe_target: numericSafeTarget,
      approach_mode: normalizeCraftAssistApproachMode(approachMode),
      item_ids: normalizedItemIds,
      selected_items: normalizedSelectedItems,
      message: "终局校验失败：结果均值无效，请调整材料范围"
    };
  }
  // Validate against original targetValue, not safeTargetValue
  // safeTargetValue is only used during search to give algorithm headroom
  // below mode requires strictly less than target (not equal)
  // Direct comparison without EPSILON to preserve 14-digit precision
  if (numericOverall < numericTarget) {
    return {ok: true};
  }
  return {
    ok: false,
    code: "final_result_exceeds_target",
    overall: numericOverall,
    target: numericTarget,
    safe_target: numericSafeTarget,
    approach_mode: normalizeCraftAssistApproachMode(approachMode),
    item_ids: normalizedItemIds,
    selected_items: normalizedSelectedItems,
    message: `终局校验拦截超过目标磨损：当前 ${numberTextTrunc(numericOverall, WEAR_INPUT_DECIMALS)}，目标 ${numberTextTrunc(targetValue, WEAR_INPUT_DECIMALS)}`
  };
}

function buildCraftAssistFailureLogText(result = {}) {
  const code = asString(result && result.code || "").trim() || "unknown_error";
  const parts = [`code=${code}`];
  const rawMsg = asString(result && result.message || "").trim();
  if (rawMsg && (code === "unknown_error" || code.startsWith("final_result_"))) {
    parts.push(`msg=${encodeURIComponent(rawMsg)}`);
  }
  if (Number.isFinite(Number(result && result.overall))) {
    parts.push(`overall=${numberTextTrunc(result.overall, WEAR_INPUT_DECIMALS)}`);
  }
  if (Number.isFinite(Number(result && result.target))) {
    parts.push(`target=${numberTextTrunc(result.target, WEAR_INPUT_DECIMALS)}`);
  }
  if (Number.isFinite(Number(result && result.safe_target))) {
    parts.push(`safe_target=${numberTextTrunc(result.safe_target, WEAR_INPUT_DECIMALS)}`);
  }
  if (Number.isFinite(Number(result && result.delta))) {
    parts.push(`delta=${numberTextTrunc(result.delta, WEAR_INPUT_DECIMALS)}`);
  }
  if (Number.isFinite(Number(result && result.threshold))) {
    parts.push(`threshold=${numberTextTrunc(result.threshold, WEAR_INPUT_DECIMALS)}`);
  }
  if (Number.isFinite(Number(result && result.lower_bound_overall))) {
    parts.push(`lower_bound=${numberTextTrunc(result.lower_bound_overall, WEAR_INPUT_DECIMALS)}`);
  }
  if (Number.isFinite(Number(result && result.lower_bound_rarity))) {
    parts.push(`lower_bound_rarity=${Number(result.lower_bound_rarity)}`);
  }
  const approachMode = asString(result && result.approach_mode || "").trim();
  if (approachMode) {
    parts.push(`approach_mode=${approachMode}`);
  }
  const itemIds = normalizeCraftRecipeItemIds(result && (result.item_ids || result.itemIds));
  if (itemIds.length) {
    parts.push(`item_ids=${itemIds.join(",")}`);
  }
  const selectedItems = Array.isArray(result && result.selected_items)
    ? result.selected_items
    : [];
  if (selectedItems.length) {
    parts.push(`selected_items=${JSON.stringify(selectedItems)}`);
  }
  return parts.join(" ");
}

function normalizeItemId(value) {
  return asString(value).trim();
}

function normalizeCraftRecipeItemIds(ids) {
  return Array.from(new Set((Array.isArray(ids) ? ids : [])
    .map((id) => normalizeItemId(id))
    .filter(Boolean)));
}

function rowAssetId(row) {
  if (!row || typeof row !== "object") return "";
  const candidates = [row.asset_id, row.assetid, row.item_id, row.id, row.component_id];
  for (const value of candidates) {
    const key = normalizeItemId(value);
    if (key) return key;
  }
  return "";
}

function assetIdNumber(row) {
  const n = Number(rowAssetId(row));
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function itemDisplayName(row) {
  return asString((row && row.alchemy_name) || "").trim() || asString((row && row.name) || "").trim();
}

function getAbsoluteWearValue(row) {
  if (!row || typeof row !== "object") return null;
  const wear = Number(row.float_value);
  if (!Number.isFinite(wear)) return null;
  return Math.max(0, Math.min(1, wear));
}

function getRelativeWearValue(row) {
  if (!row || typeof row !== "object") return null;
  const wear = getAbsoluteWearValue(row);
  const min = Number(row.minfloat);
  const max = Number(row.maxfloat);
  if (wear == null || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  const value = (wear - min) / (max - min);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function craftRarityValue(row) {
  const n = Number(row && row.rarity);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

function craftRarityLabel(value) {
  const rarity = Math.trunc(Number(value) || 0);
  return RARITY_MAP[rarity] || `R${rarity || 0}`;
}

function isRowStatTrak(row) {
  if (Number(row && row.quality || 0) === 9) return true;
  const qualityText = asString(row && row.quality_name || "").toLowerCase();
  return qualityText.includes("stattrak");
}

function normalizeCraftAssistEntryCount(value, fallback = 1) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return Math.max(1, Math.min(10, Math.trunc(Number(fallback) || 1)));
  return Math.max(1, Math.min(10, n));
}

function normalizeCraftAssistRole(role) {
  return asString(role).trim() === "aux" ? "aux" : "main";
}

function normalizeCraftAssistFilterMode(mode) {
  return asString(mode).trim() === "absolute" ? "absolute" : "relative";
}

function normalizeCraftAssistApproachMode(mode) {
  return asString(mode).trim() === "infinite" ? "infinite" : "below";
}

function normalizeCraftAssistWearOffsetPct(value, fallback = DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT) {
  const fallbackNum = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNum)
    ? Math.max(0, Math.min(100, fallbackNum))
    : DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT;
  const n = Number(value);
  if (!Number.isFinite(n)) return safeFallback;
  const clamped = Math.max(0, Math.min(100, n));
  return Math.round(clamped * 100) / 100;
}

function craftAssistWearOffsetPctText(value) {
  const n = normalizeCraftAssistWearOffsetPct(value, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT);
  return Number.isInteger(n) ? String(n) : String(n.toFixed(2)).replace(/\.?0+$/, "");
}

function getCraftAssistWearOffsetByTarget(targetValue, wearOffsetPct = DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT) {
  const pct = normalizeCraftAssistWearOffsetPct(wearOffsetPct, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT);
  const target = Number(targetValue);
  if (!Number.isFinite(target) || target <= 0 || pct <= 0) return 0;
  return target * (pct / 100);
}

function getCraftAssistOffsetSettingHintText(wearOffsetPct = DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT) {
  const pctText = craftAssistWearOffsetPctText(wearOffsetPct);
  return `当前产物偏移阈值 ${pctText}%（可在炼金设置中调整）`;
}

function craftAssistMaterialLabel(material) {
  return projectCraftAssistTraceMaterial(material).label || "-";
}

function normalizeCraftAssistMaterialsForRun(materials, {rows = null, legacyWearFilterMode = "relative"} = {}) {
  return normalizeCraftAssistMaterialListCanonical(materials, {
    rows,
    source: "renormalize",
    legacyWearFilterMode
  });
}

function nthWeekdayOfMonthUtc(year, month, weekday, nth) {
  const first = new Date(Date.UTC(year, month, 1));
  const firstWeekday = first.getUTCDay();
  return 1 + ((7 + weekday - firstWeekday) % 7) + (nth - 1) * 7;
}

function isUsPacificDst(unlockTs) {
  if (!Number.isFinite(unlockTs) || unlockTs <= 0) return false;
  const d = new Date(unlockTs * 1000);
  const year = d.getUTCFullYear();
  const marchDay = nthWeekdayOfMonthUtc(year, 2, 0, 2);
  const novDay = nthWeekdayOfMonthUtc(year, 10, 0, 1);
  const startUtcTs = Math.floor(Date.UTC(year, 2, marchDay, 10, 0, 0) / 1000);
  const endUtcTs = Math.floor(Date.UTC(year, 10, novDay, 9, 0, 0) / 1000);
  return unlockTs >= startUtcTs && unlockTs < endUtcTs;
}

function normalizeTradableAfterTs(value) {
  const baseTs = Number(value);
  if (!Number.isFinite(baseTs) || baseTs <= 0) return 0;
  const secTs = baseTs > 1e12 ? Math.floor(baseTs / 1000) : Math.floor(baseTs);
  return isUsPacificDst(secTs) ? secTs : secTs + 3600;
}

function parseTradableAfterTs(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return 0;
    if (/^\d+$/.test(text)) {
      const num = Number(text);
      if (!Number.isFinite(num)) return 0;
      return normalizeTradableAfterTs(num);
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? normalizeTradableAfterTs(Math.floor(parsed / 1000)) : 0;
  }
  return normalizeTradableAfterTs(value);
}

function coolingUnlockTs(row) {
  const ts = parseTradableAfterTs(row && row.tradable_after);
  return ts <= Math.floor(Date.now() / 1000) ? 0 : ts;
}

function isCoolingRow(row) {
  return coolingUnlockTs(row) > 0;
}

function isYellowShieldBlockedRow(row) {
  if (!row || typeof row !== "object") return false;
  if (row.yellow_shield_blocked === true) return true;
  const lockKind = asString(row.trade_lock_kind || "").trim().toLowerCase();
  if (lockKind === "yellow_shield") return true;
  const hiddenReason = asString(row.hidden_reason || "").trim();
  return hiddenReason === "flags=24" || hiddenReason === "attr#277" || hiddenReason === "attr#312";
}

function isMainInventoryCraftableRow(row) {
  if (!row || typeof row !== "object") return false;
  if (asString(row.casket_id || "").trim()) return false;
  if (asString(row.hidden_reason || "").trim()) return false;
  if (isYellowShieldBlockedRow(row)) return false;
  if (row.is_craftable !== true) return false;
  return true;
}

function getCraftCandidates(rows, {includeCooling = false} = {}) {
  const allRows = sortCraftAssistCandidateRows((Array.isArray(rows) ? rows : [])
    .filter((row) => isMainInventoryCraftableRow(row)));
  if (includeCooling) return allRows;
  return allRows.filter((row) => !isCoolingRow(row));
}

function sortCraftAssistCandidateRows(rows) {
  return (Array.isArray(rows) ? [...rows] : [])
    .sort((a, b) => {
      const ra = Number(a && a.rarity || 0);
      const rb = Number(b && b.rarity || 0);
      if (ra !== rb) return rb - ra;
      const sa = isRowStatTrak(a) ? 1 : 0;
      const sb = isRowStatTrak(b) ? 1 : 0;
      if (sa !== sb) return sb - sa;
      const wa = Number(a && a.float_value || 0);
      const wb = Number(b && b.float_value || 0);
      if (wa !== wb) return wa - wb;
      return assetIdNumber(a) - assetIdNumber(b);
    });
}

function buildCraftAssistRowsByName(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = rowAssetId(row);
    if (!id) continue;
    const name = itemDisplayName(row);
    if (!name) continue;
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(row);
  }
  return map;
}

function buildRowsByAssetId(rows) {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = rowAssetId(row);
    if (id && !out.has(id)) out.set(id, row);
  }
  return out;
}

function buildCraftAssistSelectionRowSignatureToken(row) {
  return [
    rowAssetId(row),
    itemDisplayName(row),
    numberTextTrunc(row && row.float_value),
    numberTextTrunc(row && row.minfloat),
    numberTextTrunc(row && row.maxfloat),
    String(Math.trunc(Number(row && row.rarity) || 0)),
    String(Math.trunc(Number(row && row.quality) || 0)),
    asString(row && row.quality_name || "").trim(),
    asString(row && row.casket_id || "").trim(),
    asString(row && row.hidden_reason || "").trim(),
    row && row.is_craftable === true ? "1" : "0",
    row && row.yellow_shield_blocked === true ? "1" : "0",
    asString(row && row.trade_lock_kind || "").trim(),
    asString(row && row.tradable_after || "").trim()
  ].join("\u001f");
}

function buildCraftAssistSelectionSourceSignature(candidateRows, {includeCooling = false} = {}) {
  return [
    includeCooling ? "1" : "0",
    ...(Array.isArray(candidateRows) ? candidateRows : []).map((row) => buildCraftAssistSelectionRowSignatureToken(row))
  ].join("\u001e");
}

function buildCraftAssistSelectionContextFromCandidateRows(candidateRows, {includeCooling = false} = {}) {
  const normalizedRows = sortCraftAssistCandidateRows(candidateRows);
  return {
    includeCooling: !!includeCooling,
    candidateRows: normalizedRows,
    rowsByName: buildCraftAssistRowsByName(normalizedRows),
    rowsById: buildRowsByAssetId(normalizedRows),
    candidateCache: new Map(),
    sourceSignature: buildCraftAssistSelectionSourceSignature(normalizedRows, {
      includeCooling: !!includeCooling
    })
  };
}

function buildCraftAssistSelectionContext({rows, includeCooling = false} = {}) {
  return buildCraftAssistSelectionContextFromCandidateRows(
    getCraftCandidates(rows, {includeCooling: !!includeCooling}),
    {includeCooling}
  );
}

function isReusableCraftAssistSelectionContext(selectionContext, {includeCooling = false, sourceSignature = ""} = {}) {
  if (
    !selectionContext
    || typeof selectionContext !== "object"
    || selectionContext.includeCooling !== !!includeCooling
    || !Array.isArray(selectionContext.candidateRows)
    || !(selectionContext.rowsByName instanceof Map)
    || !(selectionContext.rowsById instanceof Map)
  ) {
    return false;
  }
  if (!(selectionContext.candidateCache instanceof Map)) {
    selectionContext.candidateCache = new Map();
  }
  if (!selectionContext.sourceSignature) {
    selectionContext.sourceSignature = buildCraftAssistSelectionSourceSignature(selectionContext.candidateRows, {
      includeCooling: !!includeCooling
    });
  }
  if (!sourceSignature) {
    return true;
  }
  return selectionContext.sourceSignature === sourceSignature;
}

function resolveCraftAssistSelectionContext({
  selectionContext,
  rows,
  candidateRows,
  includeCooling = false
} = {}) {
  if (Array.isArray(candidateRows)) {
    const expectedSignature = buildCraftAssistSelectionSourceSignature(candidateRows, {
      includeCooling: !!includeCooling
    });
    if (isReusableCraftAssistSelectionContext(selectionContext, {
      includeCooling,
      sourceSignature: expectedSignature
    })) {
      return selectionContext;
    }
    return buildCraftAssistSelectionContextFromCandidateRows(candidateRows, {includeCooling});
  }
  if (Array.isArray(rows)) {
    const derivedCandidateRows = getCraftCandidates(rows, {includeCooling: !!includeCooling});
    const expectedSignature = buildCraftAssistSelectionSourceSignature(derivedCandidateRows, {
      includeCooling: !!includeCooling
    });
    if (isReusableCraftAssistSelectionContext(selectionContext, {
      includeCooling,
      sourceSignature: expectedSignature
    })) {
      return selectionContext;
    }
    return buildCraftAssistSelectionContextFromCandidateRows(derivedCandidateRows, {includeCooling});
  }
  if (isReusableCraftAssistSelectionContext(selectionContext, {includeCooling})) {
    return selectionContext;
  }
  return buildCraftAssistSelectionContext({rows, includeCooling});
}

function craftAssistCandidateComparator(a, b, target) {
  const da = Math.abs(Number(a && a.value) - target);
  const db = Math.abs(Number(b && b.value) - target);
  if (da !== db) return da - db;
  const va = Number(a && a.value);
  const vb = Number(b && b.value);
  if (va !== vb) return va - vb;
  return asString(a && a.id || "").localeCompare(asString(b && b.id || ""));
}

function buildCraftAssistCandidateCacheKey(material, targetValue, useRelativeFilter) {
  void useRelativeFilter;
  return buildCraftAssistCandidateCacheKeyTuple(material, targetValue).join("\u001f");
}

function collectCraftAssistCandidatesForMaterial(material, rowsByName, blockedIds, targetValue, {useRelativeFilter = true, candidateCache = null} = {}) {
  void useRelativeFilter;
  const cacheKey = candidateCache instanceof Map
    ? buildCraftAssistCandidateCacheKey(material, targetValue, useRelativeFilter)
    : "";
  const cached = cacheKey ? candidateCache.get(cacheKey) : null;
  if (Array.isArray(cached)) {
    if (!(blockedIds instanceof Set) || blockedIds.size <= 0) return cached;
    return cached.filter((item) => !blockedIds.has(item.id));
  }
  const unique = new Map();
  for (const item of Array.isArray(material && material.items) ? material.items : []) {
    const name = asString(item && item.name || "").trim();
    if (!name) continue;
    const useRelativeItemFilter = asString(item && item.wear_filter_mode || "").trim() !== "absolute";
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
  const list = [...unique.values()];
  list.sort((a, b) => craftAssistCandidateComparator(a, b, targetValue));
  if (cacheKey) candidateCache.set(cacheKey, list);
  if (!(blockedIds instanceof Set) || blockedIds.size <= 0) return list;
  return list.filter((item) => !blockedIds.has(item.id));
}

function pickCraftAssistClosest(candidates, count, targetValue) {
  const need = Math.max(0, Number(count) || 0);
  if (need <= 0) return [];
  return (Array.isArray(candidates) ? candidates : []).slice(0, need);
}

function pickCraftAssistByRolePriority(candidates, material, targetValue) {
  const list = Array.isArray(candidates) ? candidates : [];
  const need = Math.max(0, Number(material && material.count || 0));
  if (need <= 0 || !list.length) return [];
  const role = normalizeCraftAssistRole(material && material.role);
  const preferred = (role === "aux"
    ? list.filter((item) => Number(item && item.value) < Number(targetValue) - EPSILON)
    : list.filter((item) => Number(item && item.value) > Number(targetValue) + EPSILON))
    .sort((a, b) => {
      const va = Number(a && a.value || 0);
      const vb = Number(b && b.value || 0);
      if (va !== vb) return role === "aux" ? va - vb : vb - va;
      return asString(a && a.id || "").localeCompare(asString(b && b.id || ""));
    });
  const selected = preferred.slice(0, need);
  if (selected.length >= need) return selected;
  const used = new Set(selected.map((item) => asString(item && item.id || "").trim()).filter(Boolean));
  for (const item of list) {
    if (selected.length >= need) break;
    const id = asString(item && item.id || "").trim();
    if (!id || used.has(id)) continue;
    used.add(id);
    selected.push(item);
  }
  return selected.slice(0, need);
}

function pickCraftAssistBySplit(candidates, count, targetValue) {
  const need = Math.max(0, Number(count) || 0);
  const list = Array.isArray(candidates) ? candidates : [];
  if (need <= 0 || !list.length) return [];
  if (need === 1) return pickCraftAssistClosest(list, 1, targetValue);

  const above = list
    .filter((x) => Number(x.value) > targetValue + EPSILON)
    .sort((a, b) => craftAssistCandidateComparator(a, b, targetValue));
  const below = list
    .filter((x) => Number(x.value) < targetValue - EPSILON)
    .sort((a, b) => craftAssistCandidateComparator(a, b, targetValue));

  const makeOption = (upCount, downCount) => {
    const selected = [];
    const used = new Set();
    const pushFrom = (arr, n) => {
      let remain = Math.max(0, Number(n) || 0);
      for (const item of arr) {
        if (selected.length >= need || remain <= 0) break;
        if (used.has(item.id)) continue;
        used.add(item.id);
        selected.push(item);
        remain -= 1;
      }
      return remain;
    };
    let remainUp = Math.max(0, Math.min(need, Number(upCount) || 0));
    let remainDown = Math.max(0, Math.min(need - remainUp, Number(downCount) || 0));
    remainUp = pushFrom(above, remainUp);
    remainDown = pushFrom(below, remainDown);
    void remainUp;
    void remainDown;
    const rest = list
      .filter((item) => !used.has(item.id))
      .sort((a, b) => craftAssistCandidateComparator(a, b, targetValue));
    for (const item of rest) {
      if (selected.length >= need) break;
      selected.push(item);
    }
    return selected.slice(0, need);
  };

  const low = Math.floor(need / 2);
  const high = Math.ceil(need / 2);
  const options = [makeOption(high, low)];
  if (high !== low) options.push(makeOption(low, high));

  let best = [];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const option of options) {
    if (option.length !== need) continue;
    const avg = option.reduce((sum, item) => sum + Number(item.value), 0) / need;
    const score = Math.abs(avg - targetValue) + (avg >= targetValue ? 1e-8 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = option;
    }
  }
  if (best.length === need) return best;
  return pickCraftAssistClosest(list, need, targetValue);
}

function calcCraftAssistOverallMean(materialResults) {
  let total = 0;
  let count = 0;
  for (const item of Array.isArray(materialResults) ? materialResults : []) {
    const picks = Array.isArray(item && item.selected) ? item.selected : [];
    for (const pick of picks) {
      const value = Number(pick && pick.value);
      if (!Number.isFinite(value)) continue;
      total += value;
      count += 1;
    }
  }
  if (count <= 0) return null;
  return total / count;
}

function calcCraftAssistTotalSelectedCount(materialResults) {
  let count = 0;
  for (const item of Array.isArray(materialResults) ? materialResults : []) {
    const picks = Array.isArray(item && item.selected) ? item.selected : [];
    count += picks.length;
  }
  return count;
}

function craftAssistRoleOrderForOverall(materialResults, overall, targetValue) {
  const roles = Array.from(new Set(
    (Array.isArray(materialResults) ? materialResults : [])
      .map((entry) => normalizeCraftAssistRole(entry && entry.material && entry.material.role))
      .filter(Boolean)
  ));
  if (roles.length <= 1) return roles;
  return Number(overall) > Number(targetValue) + EPSILON ? ["aux", "main"] : ["main", "aux"];
}

function buildCraftAssistSelectedIdSet(materialResults) {
  const out = new Set();
  for (const entry of Array.isArray(materialResults) ? materialResults : []) {
    for (const item of Array.isArray(entry && entry.selected) ? entry.selected : []) {
      const id = asString(item && item.id || "").trim();
      if (id) out.add(id);
    }
  }
  return out;
}

function collectCraftAssistSelectedItemIds(materialResults) {
  const out = [];
  for (const entry of Array.isArray(materialResults) ? materialResults : []) {
    for (const item of Array.isArray(entry && entry.selected) ? entry.selected : []) {
      out.push(asString(item && item.id || "").trim());
    }
  }
  return normalizeCraftRecipeItemIds(out);
}

function collectCraftAssistSelectedItemDiagnostics(materialResults) {
  const out = [];
  for (const entry of Array.isArray(materialResults) ? materialResults : []) {
    for (const item of Array.isArray(entry && entry.selected) ? entry.selected : []) {
      const row = item && item.row && typeof item.row === "object" ? item.row : null;
      const assetId = rowAssetId(row) || asString(item && item.id || "").trim();
      if (!assetId) continue;
      out.push({
        asset_id: assetId,
        name: itemDisplayName(row) || assetId,
        absolute_wear: numberTextTrunc(getAbsoluteWearValue(row), WEAR_INPUT_DECIMALS),
        relative_wear: numberTextTrunc(Number(item && item.value), WEAR_INPUT_DECIMALS)
      });
    }
  }
  return out;
}

function craftAssistCandidateComparatorForBranch(branch, slotTarget, a, b) {
  const ta = Number(slotTarget);
  const va = Number(a && a.value);
  const vb = Number(b && b.value);
  const rankA = branch === "under"
    ? (va <= ta + EPSILON ? 0 : 1)
    : (va >= ta - EPSILON ? 0 : 1);
  const rankB = branch === "under"
    ? (vb <= ta + EPSILON ? 0 : 1)
    : (vb >= ta - EPSILON ? 0 : 1);
  if (rankA !== rankB) return rankA - rankB;
  const distA = Math.abs(va - ta);
  const distB = Math.abs(vb - ta);
  if (distA !== distB) return distA - distB;
  if (va !== vb) return branch === "under" ? vb - va : va - vb;
  return asString(a && a.id || "").localeCompare(asString(b && b.id || ""));
}

function buildCraftAssistRoleReplacementPlan({materialResults, targetValue, role}) {
  const entries = Array.isArray(materialResults) ? materialResults : [];
  const overall = calcCraftAssistOverallMean(entries);
  const totalSelected = calcCraftAssistTotalSelectedCount(entries);
  if (overall == null || totalSelected <= 0) return {branch: "", replacements: []};
  const target = Number(targetValue);
  if (!Number.isFinite(target)) return {branch: "", replacements: []};
  const branch = Number(overall) > target + EPSILON ? "over" : (Number(overall) < target - EPSILON ? "under" : "");
  if (!branch) return {branch, replacements: []};
  const diff = target - Number(overall);
  const selectedIds = buildCraftAssistSelectedIdSet(entries);
  const replacements = [];
  let projectedOverall = Number(overall);
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex];
    if (normalizeCraftAssistRole(entry && entry.material && entry.material.role) !== role) continue;
    const selected = Array.isArray(entry && entry.selected) ? entry.selected : [];
    const available = Array.isArray(entry && entry.available) ? entry.available : [];
    for (const oldItem of selected) {
      const oldId = asString(oldItem && oldItem.id || "").trim();
      const oldValue = Number(oldItem && oldItem.value);
      if (!oldId || !Number.isFinite(oldValue)) continue;
      const slotTarget = oldValue + diff;
      const pool = available
        .filter((cand) => {
          const candId = asString(cand && cand.id || "").trim();
          if (!candId || candId === oldId) return false;
          return !selectedIds.has(candId);
        })
        .sort((a, b) => craftAssistCandidateComparatorForBranch(branch, slotTarget, a, b));
      let chosen = null;
      for (const cand of pool) {
        const nextValue = Number(cand && cand.value);
        if (!Number.isFinite(nextValue)) continue;
        if (branch === "under" && !(nextValue > oldValue + EPSILON)) continue;
        if (branch === "over" && !(nextValue < oldValue - EPSILON)) continue;
        const nextOverall = projectedOverall + (nextValue - oldValue) / totalSelected;
        if (branch === "under" && !(nextOverall < target - EPSILON)) continue;
        chosen = {entryIndex, oldId, next: cand, nextOverall};
        break;
      }
      if (!chosen) continue;
      selectedIds.delete(oldId);
      selectedIds.add(asString(chosen.next && chosen.next.id || "").trim());
      replacements.push(chosen);
      projectedOverall = chosen.nextOverall;
    }
  }
  return {branch, replacements};
}

function applyCraftAssistRoleReplacementPlan(materialResults, plan) {
  const replacements = Array.isArray(plan && plan.replacements) ? plan.replacements : [];
  if (!replacements.length) return materialResults;
  for (const item of replacements) {
    const entry = materialResults[item.entryIndex];
    if (!entry || !Array.isArray(entry.selected)) continue;
    entry.selected = entry.selected.map((selectedItem) => {
      const id = asString(selectedItem && selectedItem.id || "").trim();
      return id === item.oldId ? item.next : selectedItem;
    });
  }
  return materialResults;
}

function applyCraftAssistRoleAwareCorrection({materialResults, targetValue}) {
  let overall = calcCraftAssistOverallMean(materialResults);
  if (overall == null) return null;
  const roles = craftAssistRoleOrderForOverall(materialResults, overall, targetValue);
  for (const role of roles) {
    const plan = buildCraftAssistRoleReplacementPlan({
      materialResults,
      targetValue,
      role
    });
    if (!plan.replacements.length) continue;
    applyCraftAssistRoleReplacementPlan(materialResults, plan);
    overall = calcCraftAssistOverallMean(materialResults);
    if (overall == null) return null;
    if (plan.branch === "over" && overall < Number(targetValue) - EPSILON) break;
  }
  return overall;
}

function applyCraftAssistDeficitCorrection({selected, candidates, targetValue, count}) {
  const need = Math.max(0, Number(count) || 0);
  const chosen = Array.isArray(selected) ? [...selected] : [];
  if (need <= 0 || chosen.length !== need) return chosen;
  const threshold = Number(targetValue) - EPSILON;
  const pool = Array.isArray(candidates) ? candidates : [];
  if (!pool.length) return chosen;

  const calcAvg = (list) => list.reduce((sum, item) => sum + Number(item && item.value || 0), 0) / need;
  let avg = calcAvg(chosen);
  if (!(avg < threshold)) return chosen;

  let iterations = 0;
  const maxIterations = 80;
  while (avg < threshold && iterations < maxIterations) {
    const gap = threshold - avg;
    const selectedIds = new Set(chosen.map((item) => asString(item && item.id || "").trim()).filter(Boolean));
    let bestMove = null;
    for (let idx = 0; idx < chosen.length; idx += 1) {
      const oldItem = chosen[idx];
      const oldValue = Number(oldItem && oldItem.value);
      if (!Number.isFinite(oldValue)) continue;
      for (const candidate of pool) {
        const nextId = asString(candidate && candidate.id || "").trim();
        if (!nextId || selectedIds.has(nextId)) continue;
        const nextValue = Number(candidate && candidate.value);
        if (!Number.isFinite(nextValue) || !(nextValue > oldValue + EPSILON)) continue;
        const deltaAvg = (nextValue - oldValue) / need;
        if (!(deltaAvg > 1e-12) || deltaAvg > gap + 1e-12) continue;
        if (!bestMove || deltaAvg > bestMove.deltaAvg) {
          bestMove = {idx, next: candidate, deltaAvg};
        }
      }
    }
    if (!bestMove) break;
    chosen[bestMove.idx] = bestMove.next;
    avg = calcAvg(chosen);
    iterations += 1;
  }
  return chosen;
}

function applyCraftAssistOverflowCorrection({materialResults, targetValue, maxIterations = 80}) {
  const entries = Array.isArray(materialResults) ? materialResults : [];
  if (!entries.length) return entries;
  const totalSelected = calcCraftAssistTotalSelectedCount(entries);
  if (totalSelected <= 0) return entries;
  const threshold = Number(targetValue) - EPSILON;
  let overall = calcCraftAssistOverallMean(entries);
  if (overall == null) return entries;
  let iterations = 0;
  while (!(overall < threshold) && iterations < Math.max(1, Number(maxIterations) || 80)) {
    const needDrop = overall - threshold;
    const moves = [];
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex];
      const selected = Array.isArray(entry && entry.selected) ? entry.selected : [];
      const available = Array.isArray(entry && entry.available) ? entry.available : [];
      if (!selected.length || !available.length) continue;
      const selectedIds = new Set(selected.map((item) => asString(item && item.id || "").trim()).filter(Boolean));
      const pool = available.filter((cand) => !selectedIds.has(asString(cand && cand.id || "").trim()));
      if (!pool.length) continue;
      for (const oldItem of selected) {
        const oldValue = Number(oldItem && oldItem.value);
        if (!Number.isFinite(oldValue)) continue;
        for (const candidate of pool) {
          const nextValue = Number(candidate && candidate.value);
          if (!Number.isFinite(nextValue)) continue;
          if (!(nextValue < oldValue - EPSILON)) continue;
          const deltaOverall = (oldValue - nextValue) / totalSelected;
          if (!(deltaOverall > 1e-12)) continue;
          moves.push({
            entryIndex,
            oldId: asString(oldItem && oldItem.id || "").trim(),
            next: candidate,
            drop: deltaOverall
          });
        }
      }
    }
    if (!moves.length) break;
    const underMoves = moves.filter((move) => move.drop <= needDrop + 1e-12);
    let chosen = null;
    if (underMoves.length) {
      underMoves.sort((a, b) => Number(b.drop) - Number(a.drop));
      chosen = underMoves[0];
    } else {
      moves.sort((a, b) => Number(a.drop) - Number(b.drop));
      chosen = moves[0];
    }
    if (!chosen) break;
    const entry = entries[chosen.entryIndex];
    entry.selected = (Array.isArray(entry.selected) ? entry.selected : []).map((item) => {
      const id = asString(item && item.id || "").trim();
      return id === chosen.oldId ? chosen.next : item;
    });
    overall = calcCraftAssistOverallMean(entries);
    if (overall == null) break;
    iterations += 1;
  }
  return entries;
}

function applyCraftAssistOffsetWindowCorrection({materialResults, targetValue, maxOffset, maxIterations = 120}) {
  const entries = Array.isArray(materialResults) ? materialResults : [];
  if (!entries.length) return entries;
  const totalSelected = calcCraftAssistTotalSelectedCount(entries);
  if (totalSelected <= 0) return entries;
  const target = Number(targetValue);
  const offset = Number(maxOffset);
  if (!Number.isFinite(target) || !Number.isFinite(offset) || offset <= 0) return entries;
  const lowerBound = target - offset;
  const cap = target - EPSILON;
  let overall = calcCraftAssistOverallMean(entries);
  if (overall == null) return entries;
  let iterations = 0;
  const limit = Math.max(1, Number(maxIterations) || 120);
  while (overall < lowerBound - EPSILON && iterations < limit) {
    const needRaise = lowerBound - overall;
    const moves = [];
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex];
      const selected = Array.isArray(entry && entry.selected) ? entry.selected : [];
      const available = Array.isArray(entry && entry.available) ? entry.available : [];
      if (!selected.length || !available.length) continue;
      const selectedIds = new Set(selected.map((item) => asString(item && item.id || "").trim()).filter(Boolean));
      const pool = available.filter((cand) => !selectedIds.has(asString(cand && cand.id || "").trim()));
      if (!pool.length) continue;
      for (const oldItem of selected) {
        const oldValue = Number(oldItem && oldItem.value);
        if (!Number.isFinite(oldValue)) continue;
        for (const candidate of pool) {
          const nextValue = Number(candidate && candidate.value);
          if (!Number.isFinite(nextValue)) continue;
          if (!(nextValue > oldValue + EPSILON)) continue;
          const deltaOverall = (nextValue - oldValue) / totalSelected;
          if (!(deltaOverall > 1e-12)) continue;
          const nextOverall = overall + deltaOverall;
          if (!(nextOverall < cap)) continue;
          moves.push({
            entryIndex,
            oldId: asString(oldItem && oldItem.id || "").trim(),
            next: candidate,
            raise: deltaOverall
          });
        }
      }
    }
    if (!moves.length) break;
    const underMoves = moves.filter((move) => move.raise <= needRaise + 1e-12);
    let chosen = null;
    if (underMoves.length) {
      underMoves.sort((a, b) => Number(b.raise) - Number(a.raise));
      chosen = underMoves[0];
    } else {
      moves.sort((a, b) => Number(a.raise) - Number(b.raise));
      chosen = moves[0];
    }
    if (!chosen) break;
    const entry = entries[chosen.entryIndex];
    entry.selected = (Array.isArray(entry.selected) ? entry.selected : []).map((item) => {
      const id = asString(item && item.id || "").trim();
      return id === chosen.oldId ? chosen.next : item;
    });
    overall = calcCraftAssistOverallMean(entries);
    if (overall == null) break;
    iterations += 1;
  }
  return entries;
}

function solveCraftAssistMinCostAssignmentForRarity({prepared, rarity}) {
  const sourceList = Array.isArray(prepared) ? prepared : [];
  const entries = [];
  let totalNeed = 0;
  for (const item of sourceList) {
    const material = item && item.material ? item.material : null;
    if (!material) return null;
    const need = normalizeCraftAssistEntryCount(material && material.count, 1);
    const available = (Array.isArray(item && item.candidates) ? item.candidates : [])
      .filter((cand) => craftRarityValue(cand && cand.row) === Number(rarity));
    if (available.length < need) return null;
    entries.push({material, need, available});
    totalNeed += need;
  }
  if (!entries.length || totalNeed <= 0) return null;

  const candidateMap = new Map();
  for (const entry of entries) {
    for (const cand of entry.available) {
      const id = asString(cand && cand.id || "").trim();
      if (!id || candidateMap.has(id)) continue;
      candidateMap.set(id, cand);
    }
  }
  const candidateIds = [...candidateMap.keys()];
  if (!candidateIds.length) return null;
  const candidateIndexMap = new Map(candidateIds.map((id, idx) => [id, idx]));

  const sourceNode = 0;
  const materialNodeStart = 1;
  const candidateNodeStart = materialNodeStart + entries.length;
  const sinkNode = candidateNodeStart + candidateIds.length;
  const nodeCount = sinkNode + 1;
  const graph = Array.from({length: nodeCount}, () => []);

  const addEdge = (from, to, capacity, cost, meta = null) => {
    const fwd = {to, rev: 0, cap: capacity, cost, meta};
    const rev = {to: from, rev: 0, cap: 0, cost: -cost, meta: null};
    fwd.rev = graph[to].length;
    rev.rev = graph[from].length;
    graph[from].push(fwd);
    graph[to].push(rev);
    return fwd;
  };

  const assignmentEdges = [];
  const COST_SCALE = 1e6;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const materialNode = materialNodeStart + i;
    addEdge(sourceNode, materialNode, entry.need, 0);
    for (const cand of entry.available) {
      const candId = asString(cand && cand.id || "").trim();
      const candIdx = candidateIndexMap.get(candId);
      if (!candId || candIdx == null) continue;
      const value = Number(cand && cand.value);
      if (!Number.isFinite(value)) continue;
      const candidateNode = candidateNodeStart + candIdx;
      const unitCost = Math.round(value * COST_SCALE);
      const edge = addEdge(materialNode, candidateNode, 1, unitCost, {materialIndex: i, candidateId: candId});
      assignmentEdges.push(edge);
    }
  }
  for (let i = 0; i < candidateIds.length; i += 1) {
    addEdge(candidateNodeStart + i, sinkNode, 1, 0);
  }

  const potential = Array(nodeCount).fill(0);
  const dist = Array(nodeCount).fill(0);
  const prevNode = Array(nodeCount).fill(-1);
  const prevEdge = Array(nodeCount).fill(-1);
  const pushHeap = (heap, item) => {
    heap.push(item);
    let idx = heap.length - 1;
    while (idx > 0) {
      const parent = Math.floor((idx - 1) / 2);
      if (heap[parent][0] <= heap[idx][0]) break;
      const tmp = heap[parent];
      heap[parent] = heap[idx];
      heap[idx] = tmp;
      idx = parent;
    }
  };
  const popHeap = (heap) => {
    if (!heap.length) return null;
    const out = heap[0];
    const tail = heap.pop();
    if (!heap.length) return out;
    heap[0] = tail;
    let idx = 0;
    while (true) {
      const left = idx * 2 + 1;
      const right = left + 1;
      let smallest = idx;
      if (left < heap.length && heap[left][0] < heap[smallest][0]) smallest = left;
      if (right < heap.length && heap[right][0] < heap[smallest][0]) smallest = right;
      if (smallest === idx) break;
      const tmp = heap[smallest];
      heap[smallest] = heap[idx];
      heap[idx] = tmp;
      idx = smallest;
    }
    return out;
  };

  let flow = 0;
  while (flow < totalNeed) {
    dist.fill(Number.POSITIVE_INFINITY);
    prevNode.fill(-1);
    prevEdge.fill(-1);
    dist[sourceNode] = 0;
    const heap = [];
    pushHeap(heap, [0, sourceNode]);

    while (heap.length) {
      const top = popHeap(heap);
      if (!top) break;
      const currentDist = top[0];
      const node = top[1];
      if (currentDist !== dist[node]) continue;
      const edges = graph[node];
      for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
        const edge = edges[edgeIndex];
        if (!edge || edge.cap <= 0) continue;
        const next = edge.to;
        const reducedCost = edge.cost + potential[node] - potential[next];
        const nextDist = currentDist + reducedCost;
        if (nextDist + EPSILON >= dist[next]) continue;
        dist[next] = nextDist;
        prevNode[next] = node;
        prevEdge[next] = edgeIndex;
        pushHeap(heap, [nextDist, next]);
      }
    }

    if (!Number.isFinite(dist[sinkNode])) return null;
    for (let node = 0; node < nodeCount; node += 1) {
      if (!Number.isFinite(dist[node])) continue;
      potential[node] += dist[node];
    }

    let addFlow = totalNeed - flow;
    for (let node = sinkNode; node !== sourceNode; node = prevNode[node]) {
      if (node < 0 || prevNode[node] < 0 || prevEdge[node] < 0) return null;
      const edge = graph[prevNode[node]][prevEdge[node]];
      addFlow = Math.min(addFlow, edge.cap);
    }
    if (!(addFlow > 0)) return null;

    for (let node = sinkNode; node !== sourceNode; node = prevNode[node]) {
      const from = prevNode[node];
      const edge = graph[from][prevEdge[node]];
      edge.cap -= addFlow;
      graph[node][edge.rev].cap += addFlow;
    }
    flow += addFlow;
  }

  if (flow < totalNeed) return null;

  const selectedByMaterial = entries.map(() => []);
  for (const edge of assignmentEdges) {
    if (!edge || edge.cap > 0 || !edge.meta) continue;
    const materialIndex = Number(edge.meta.materialIndex);
    const candidateId = asString(edge.meta.candidateId || "").trim();
    if (!Number.isFinite(materialIndex) || materialIndex < 0 || materialIndex >= selectedByMaterial.length || !candidateId) continue;
    const cand = candidateMap.get(candidateId);
    if (!cand) continue;
    selectedByMaterial[materialIndex].push(cand);
  }

  const materialResults = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const selected = selectedByMaterial[i];
    if (!Array.isArray(selected) || selected.length !== entry.need) return null;
    materialResults.push({
      material: entry.material,
      selected: [...selected],
      available: entry.available
    });
  }
  const overall = calcCraftAssistOverallMean(materialResults);
  if (overall == null) return null;
  return {
    rarity: Number(rarity),
    materialResults,
    overall
  };
}

function findCraftAssistFallbackBelowTargetSolution({prepared, raritySet, targetValue}) {
  const threshold = Number(targetValue) - EPSILON;
  const rarities = [...(raritySet instanceof Set ? raritySet : new Set())]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!rarities.length) return null;
  let best = null;
  for (const rarity of rarities) {
    const solved = solveCraftAssistMinCostAssignmentForRarity({
      prepared,
      rarity
    });
    if (!solved || solved.overall == null) continue;
    if (!(Number(solved.overall) < threshold)) continue;
    const gap = Number(targetValue) - Number(solved.overall);
    if (!best || gap < best.gap - 1e-12 || (Math.abs(gap - best.gap) <= 1e-12 && Number(solved.rarity) < Number(best.rarity))) {
      best = {
        rarity: Number(solved.rarity),
        materialResults: solved.materialResults,
        overall: Number(solved.overall),
        gap
      };
    }
  }
  if (!best) return null;
  return {
    rarity: best.rarity,
    materialResults: best.materialResults,
    overall: best.overall
  };
}

function findCraftAssistBestFeasibleSolution({prepared, raritySet}) {
  const rarities = [...(raritySet instanceof Set ? raritySet : new Set())]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!rarities.length) return null;
  let best = null;
  for (const rarity of rarities) {
    const solved = solveCraftAssistMinCostAssignmentForRarity({
      prepared,
      rarity
    });
    if (!solved || solved.overall == null) continue;
    if (!best || Number(solved.overall) < Number(best.overall) - 1e-12 || (
      Math.abs(Number(solved.overall) - Number(best.overall)) <= 1e-12 && Number(solved.rarity) < Number(best.rarity)
    )) {
      best = {
        rarity: Number(solved.rarity),
        overall: Number(solved.overall)
      };
    }
  }
  return best;
}

function resolveCraftAssistSearchModeHint(groups) {
  const list = Array.isArray(groups) ? groups : [];
  if (list.length <= 1) return "single_material";
  const roles = new Set(list.map((group) => normalizeCraftAssistRole(group && group.material && group.material.role)));
  return roles.size >= 2 ? "multi_material_role" : "multi_material_neutral";
}

function hasOversizedCraftAssistGroup(groups, options) {
  return (Array.isArray(groups) ? groups : []).some((group) => resolveShardCount(
    Array.isArray(group && group.candidates) ? group.candidates.length : 0,
    options
  ) > 0);
}

function isCraftAssistSolvedCandidate(solved, targetValue, approachMode = "below") {
  const normalizedApproachMode = normalizeCraftAssistApproachMode(approachMode);
  return !!(
    solved
    && Array.isArray(solved.materialResults)
    && Number.isFinite(Number(solved.overall))
    && (
      normalizedApproachMode === "infinite"
      || Number(solved.overall) < Number(targetValue) - EPSILON
    )
  );
}

function pickBetterCraftAssistSolvedCandidate(currentBest, nextCandidate) {
  if (!currentBest) return nextCandidate || null;
  if (!nextCandidate) return currentBest;
  if (Array.isArray(currentBest.scoreTuple) && Array.isArray(nextCandidate.scoreTuple)) {
    return compareScoreTuples(nextCandidate.scoreTuple, currentBest.scoreTuple) < 0
      ? nextCandidate
      : currentBest;
  }
  return Number(nextCandidate.overall) > Number(currentBest.overall)
    ? nextCandidate
    : currentBest;
}

function didCraftAssistSolvedCandidateImprove(previousCandidate, nextCandidate) {
  if (!nextCandidate) return false;
  if (!previousCandidate) return true;
  if (Array.isArray(previousCandidate.scoreTuple) && Array.isArray(nextCandidate.scoreTuple)) {
    return compareScoreTuples(nextCandidate.scoreTuple, previousCandidate.scoreTuple) < 0;
  }
  return Number(nextCandidate.overall) > Number(previousCandidate.overall);
}

function cloneCraftAssistCandidateForSearch(candidate) {
  return candidate && typeof candidate === "object"
    ? {...candidate}
    : candidate;
}

function buildCraftAssistFrozenGroupFromSolved(materialResult, groupIndex) {
  return {
    index: groupIndex,
    material: materialResult && materialResult.material ? {...materialResult.material} : {},
    candidates: Array.isArray(materialResult && materialResult.selected)
      ? materialResult.selected.map((candidate) => cloneCraftAssistCandidateForSearch(candidate))
      : []
  };
}

function buildCraftAssistContextRefineGroups({groups, solved, openGroupIndex}) {
  const sourceGroups = Array.isArray(groups) ? groups : [];
  const materialResults = Array.isArray(solved && solved.materialResults) ? solved.materialResults : [];
  return sourceGroups.map((group, groupIndex) => {
    if (groupIndex === openGroupIndex) return group;
    if (!materialResults[groupIndex]) return group;
    return buildCraftAssistFrozenGroupFromSolved(materialResults[groupIndex], groupIndex);
  });
}

function runCraftAssistContextRefine({
  groups,
  targetValue,
  initialSolved,
  approachMode = "below",
  prefilterOptions,
  maxRounds = 1
}) {
  const sourceGroups = Array.isArray(groups) ? groups : [];
  const oversizedGroupIndexes = sourceGroups.reduce((list, group, groupIndex) => {
    const candidateCount = Array.isArray(group && group.candidates) ? group.candidates.length : 0;
    if (resolveShardCount(candidateCount, prefilterOptions) > 0) {
      list.push(groupIndex);
    }
    return list;
  }, []);
  if (!initialSolved || oversizedGroupIndexes.length <= 1) {
    return {
      solved: initialSolved,
      summary: null
    };
  }
  const startMs = Date.now();
  let currentSolved = initialSolved;
  let acceptedCount = 0;
  const rounds = [];
  for (let roundIndex = 0; roundIndex < Math.max(1, Number(maxRounds) || 1); roundIndex += 1) {
    let roundAcceptedCount = 0;
    const attempts = [];
    for (const groupIndex of oversizedGroupIndexes) {
      const beforeSolved = currentSolved;
      const beforeOverall = Number(beforeSolved && beforeSolved.overall);
      const refineGroups = buildCraftAssistContextRefineGroups({
        groups: sourceGroups,
        solved: beforeSolved,
        openGroupIndex: groupIndex
      });
      const refinedCandidate = searchCraftAssistBestSolution({
        groups: refineGroups,
        targetValue,
        approachMode
      });
      const refinedSolved = isCraftAssistSolvedCandidate(refinedCandidate, targetValue, approachMode)
        ? refinedCandidate
        : null;
      const accepted = didCraftAssistSolvedCandidateImprove(beforeSolved, refinedSolved);
      const traceMaterial = projectCraftAssistTraceMaterial(sourceGroups[groupIndex] && sourceGroups[groupIndex].material);
      attempts.push({
        groupIndex,
        materialName: traceMaterial.materialName,
        item_names: traceMaterial.item_names,
        label: traceMaterial.label,
        candidateCountOpened: Array.isArray(sourceGroups[groupIndex] && sourceGroups[groupIndex].candidates)
          ? sourceGroups[groupIndex].candidates.length
          : 0,
        overallBefore: Number.isFinite(beforeOverall) ? beforeOverall : null,
        overallAfter: refinedSolved && Number.isFinite(Number(refinedSolved.overall))
          ? Number(refinedSolved.overall)
          : null,
        accepted
      });
      if (accepted) {
        currentSolved = refinedSolved;
        acceptedCount += 1;
        roundAcceptedCount += 1;
      }
    }
    rounds.push({
      round: roundIndex + 1,
      acceptedCount: roundAcceptedCount,
      attempts
    });
    if (roundAcceptedCount <= 0) break;
  }
  let jointAttempt = null;
  if (acceptedCount <= 0) {
    const jointSolvedCandidate = searchCraftAssistBestSolution({
      groups: sourceGroups,
      targetValue,
      approachMode
    });
    const jointSolved = isCraftAssistSolvedCandidate(jointSolvedCandidate, targetValue, approachMode)
      ? jointSolvedCandidate
      : null;
    const jointAccepted = didCraftAssistSolvedCandidateImprove(currentSolved, jointSolved);
    jointAttempt = {
      mode: "full_groups",
      overallBefore: currentSolved && Number.isFinite(Number(currentSolved.overall))
        ? Number(currentSolved.overall)
        : null,
      overallAfter: jointSolved && Number.isFinite(Number(jointSolved.overall))
        ? Number(jointSolved.overall)
        : null,
      accepted: jointAccepted
    };
    if (jointAccepted) {
      currentSolved = jointSolved;
      acceptedCount += 1;
    }
  }
  return {
    solved: currentSolved,
    summary: {
      entered: true,
      groupIndexes: oversizedGroupIndexes.slice(),
      acceptedCount,
      rounds,
      jointAttempt,
      contextRefineMs: Date.now() - startMs
    }
  };
}

function buildCraftAssistPrefilterSummary({phaseTraces, retryMode, usedRarityFullFallback, contextRefineSummary = null}) {
  const phases = (Array.isArray(phaseTraces) ? phaseTraces : [])
    .filter((trace) => trace && typeof trace === "object")
    .map((trace) => ({
      ...trace,
      prefilteredIndexes: Array.isArray(trace.prefilteredIndexes) ? [...trace.prefilteredIndexes] : [],
      groupFallbackIndexes: Array.isArray(trace.groupFallbackIndexes) ? [...trace.groupFallbackIndexes] : [],
      groups: Array.isArray(trace.groups) ? trace.groups.map((group) => ({
        ...group,
        shardStats: Array.isArray(group && group.shardStats) ? group.shardStats.map((stats) => ({...stats})) : []
      })) : []
    }));
  return {
    enabled: phases.length > 0,
    retryMode: asString(retryMode || "").trim() || "none",
    usedRarityFullFallback: !!usedRarityFullFallback,
    prefilterMs: phases.reduce((sum, trace) => sum + Math.max(0, Number(trace && trace.prefilterMs || 0)), 0),
    phases,
    contextRefine: contextRefineSummary && typeof contextRefineSummary === "object"
      ? {
        ...contextRefineSummary,
        groupIndexes: Array.isArray(contextRefineSummary.groupIndexes)
          ? [...contextRefineSummary.groupIndexes]
          : [],
        rounds: Array.isArray(contextRefineSummary.rounds)
          ? contextRefineSummary.rounds.map((round) => ({
            ...round,
            attempts: Array.isArray(round && round.attempts)
              ? round.attempts.map((attempt) => ({...attempt}))
              : []
          }))
          : [],
        jointAttempt: contextRefineSummary.jointAttempt && typeof contextRefineSummary.jointAttempt === "object"
          ? {...contextRefineSummary.jointAttempt}
          : null
      }
      : null
  };
}

function attachCraftAssistPrefilterTrace(selectionTrace, prefilterSummary) {
  if (!prefilterSummary) {
    return selectionTrace || null;
  }
  if (selectionTrace && typeof selectionTrace === "object") {
    return {
      ...selectionTrace,
      prefilter: prefilterSummary
    };
  }
  return {
    steps: [],
    prefilter: prefilterSummary
  };
}

async function solveCraftAssistGroupsForRarity({
  groups,
  targetValue,
  approachMode = "below",
  recipeContext,
  prefilterOptionsOverride = null
}) {
  const prefilterOptions = resolvePrefilterOptions(
    prefilterOptionsOverride && typeof prefilterOptionsOverride === "object"
      ? prefilterOptionsOverride
      : {}
  );
  if (!prefilterOptions.enableOversizedPrefilter || !hasOversizedCraftAssistGroup(groups, prefilterOptions)) {
    return {
      solved: searchCraftAssistBestSolution({
        groups,
        targetValue,
        approachMode
      }),
      prefilterSummary: null
    };
  }

  const phaseTraces = [];
  const basePhase = await runPrefilterPhase({
    groups,
    targetValue,
    recipeContext,
    phaseName: "prefilter/base",
    options: prefilterOptions
  });
  phaseTraces.push(basePhase.prefilterTrace);
  if (basePhase.kind !== "phase_ready") {
    return {
      solved: searchCraftAssistBestSolution({
        groups,
        targetValue,
        approachMode
      }),
      prefilterSummary: buildCraftAssistPrefilterSummary({
        phaseTraces,
        retryMode: "rarity_full",
        usedRarityFullFallback: true
      })
    };
  }
  const baseSolvedCandidate = searchCraftAssistBestSolution({
    groups: basePhase.groups,
    targetValue,
    approachMode
  });
  const baseSolved = isCraftAssistSolvedCandidate(baseSolvedCandidate, targetValue, approachMode)
    ? baseSolvedCandidate
    : null;

  const expandPhase = await runPrefilterPhase({
    groups,
    targetValue,
    recipeContext,
    phaseName: "prefilter/expand",
    options: prefilterOptions
  });
  phaseTraces.push(expandPhase.prefilterTrace);
  if (expandPhase.kind === "phase_ready") {
    const expandSolvedCandidate = searchCraftAssistBestSolution({
      groups: expandPhase.groups,
      targetValue,
      approachMode
    });
    const expandSolved = isCraftAssistSolvedCandidate(expandSolvedCandidate, targetValue, approachMode)
      ? expandSolvedCandidate
      : null;
    let bestPrefilterSolved = pickBetterCraftAssistSolvedCandidate(baseSolved, expandSolved);
    if (bestPrefilterSolved) {
      let contextRefineSummary = null;
      if (didCraftAssistSolvedCandidateImprove(baseSolved, expandSolved)) {
        const contextRefined = runCraftAssistContextRefine({
          groups,
          targetValue,
          initialSolved: bestPrefilterSolved,
          approachMode,
          prefilterOptions
        });
        bestPrefilterSolved = pickBetterCraftAssistSolvedCandidate(bestPrefilterSolved, contextRefined.solved);
        contextRefineSummary = contextRefined.summary;
      }
      return {
        solved: bestPrefilterSolved,
        prefilterSummary: buildCraftAssistPrefilterSummary({
          phaseTraces,
          retryMode: "expand",
          usedRarityFullFallback: false,
          contextRefineSummary
        })
      };
    }
  }

  return {
    solved: searchCraftAssistBestSolution({
      groups,
      targetValue,
      approachMode
    }),
    prefilterSummary: buildCraftAssistPrefilterSummary({
      phaseTraces,
      retryMode: "rarity_full",
      usedRarityFullFallback: true
    })
  };
}

async function runCraftAssistSelectionForRecipe({
  materials,
  rowsByName,
  blockedIds,
  targetValue,
  wearApproachMode = "below",
  useRelativeFilter = true,
  wearOffsetPct = DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT,
  candidateCache = null,
  prefilterOptions = null
}) {
  const blocked = blockedIds instanceof Set ? blockedIds : new Set();
  const approachMode = normalizeCraftAssistApproachMode(wearApproachMode);
  const offsetHintText = getCraftAssistOffsetSettingHintText(wearOffsetPct);
  const safeTargetValue = approachMode === "below"
    ? getCraftAssistOutcomeSafeTarget(targetValue)
    : Number(targetValue);
  const prepared = materials.map((material) => {
    const cands = collectCraftAssistCandidatesForMaterial(material, rowsByName, blocked, safeTargetValue, {
      useRelativeFilter,
      candidateCache
    });
    const estimate = pickCraftAssistClosest(cands, material.count, safeTargetValue);
    const estimateDiff = estimate.length
      ? Math.abs(estimate.reduce((sum, item) => sum + Number(item.value), 0) / estimate.length - safeTargetValue)
      : Number.POSITIVE_INFINITY;
    return {material, candidates: cands, estimateDiff};
  });
  const feasibleRaritySets = prepared.map((item) => {
    const countByRarity = new Map();
    for (const cand of item.candidates) {
      const rarity = craftRarityValue(cand.row);
      if (rarity <= 0) continue;
      countByRarity.set(rarity, (countByRarity.get(rarity) || 0) + 1);
    }
    const feasible = new Set(
      [...countByRarity.entries()]
        .filter((entry) => entry[1] >= Number(item.material && item.material.count || 0))
        .map((entry) => entry[0])
    );
    return {material: item.material, feasible, candidateCount: item.candidates.length};
  });
  let sharedRaritySet = null;
  for (const item of feasibleRaritySets) {
    if (!item.feasible.size) {
      const materialName = craftAssistMaterialLabel(item.material);
      const requiredCount = Number(item.material && item.material.count || 0);
      const candidateCount = Math.max(0, Number(item.candidateCount || 0));
      if (candidateCount <= 0) {
        return {ok: false, message: `父类材料【${materialName}】无可用材料，${offsetHintText}`};
      }
      if (requiredCount > 0 && candidateCount < requiredCount) {
        return {ok: false, message: `父类材料【${materialName}】可用数量不足：需${requiredCount}，仅${candidateCount}，${offsetHintText}`};
      }
      return {ok: false, message: `父类材料【${materialName}】在当前条件下无法满足同稀有度数量要求`};
    }
    if (sharedRaritySet == null) {
      sharedRaritySet = new Set(item.feasible);
      continue;
    }
    sharedRaritySet = new Set([...sharedRaritySet].filter((rarity) => item.feasible.has(rarity)));
  }
  if (!sharedRaritySet || !sharedRaritySet.size) {
    return {ok: false, message: "父类材料稀有度不一致，单个配方必须使用同一稀有度材料"};
  }
  let bestSolved = null;
  const rarities = [...sharedRaritySet]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  for (const rarity of rarities) {
    const groups = prepared.map((item, index) => ({
      index,
      material: item.material,
      candidates: item.candidates.filter((cand) => craftRarityValue(cand.row) === rarity)
    }));
    if (groups.some((group) => group.candidates.length < Number(group.material && group.material.count || 0))) continue;
    const {solved, prefilterSummary} = await solveCraftAssistGroupsForRarity({
      groups,
      targetValue: safeTargetValue,
      approachMode,
      recipeContext: {
        recipeNo: 1,
        rarity,
        modeHint: resolveCraftAssistSearchModeHint(groups),
        sourceText: "craft_assist"
      },
      prefilterOptionsOverride: prefilterOptions
    });
    if (!solved || !Array.isArray(solved.materialResults) || solved.overall == null) continue;
    if (!bestSolved
      || compareScoreTuples(solved.scoreTuple, bestSolved.scoreTuple) < 0
      || (
        compareScoreTuples(solved.scoreTuple, bestSolved.scoreTuple) === 0
        && Number(rarity) < Number(bestSolved.rarity)
      )) {
      bestSolved = {
        rarity: Number(rarity),
        materialResults: solved.materialResults,
        overall: Number(solved.overall),
        scoreTuple: solved.scoreTuple,
        trace: attachCraftAssistPrefilterTrace(solved.trace || null, prefilterSummary)
      };
    }
  }
  if (!bestSolved) {
    if (approachMode === "infinite") {
      return {
        ok: false,
        code: "overall_not_close_to_target",
        overall: null,
        target: Number(targetValue),
        message: `当前条件下无法找到可用逼近结果：目标 ${numberTextTrunc(targetValue, WEAR_INPUT_DECIMALS)}`
      };
    }
    const lowerBound = findCraftAssistBestFeasibleSolution({
      prepared,
      raritySet: sharedRaritySet
    });
    const lowerBoundText = lowerBound && Number.isFinite(Number(lowerBound.overall))
      ? `；当前条件下最低可达 ${numberTextTrunc(lowerBound.overall, WEAR_INPUT_DECIMALS)}（稀有度 ${craftRarityLabel(lowerBound.rarity)}）`
      : "";
    return {
      ok: false,
      code: "overall_not_below_target",
      overall: null,
      target: Number(targetValue),
      lower_bound_overall: lowerBound && Number.isFinite(Number(lowerBound.overall)) ? Number(lowerBound.overall) : null,
      lower_bound_rarity: lowerBound && Number.isFinite(Number(lowerBound.rarity)) ? Number(lowerBound.rarity) : null,
      message: `结果均值需小于目标磨损：目标 ${numberTextTrunc(targetValue, WEAR_INPUT_DECIMALS)}${lowerBoundText || `，${offsetHintText}`}`
    };
  }
  let selectedRarity = Number(bestSolved.rarity || 0);
  let materialResults = Array.isArray(bestSolved.materialResults) ? bestSolved.materialResults : [];
  let overall = Number(bestSolved.overall);
  const selectionTrace = bestSolved.trace || null;

  const outputOffset = getCraftAssistWearOffsetByTarget(safeTargetValue, wearOffsetPct);
  if (outputOffset > 0) {
    let needOffsetRetry = false;
    if (approachMode === "below") {
      const offsetLowerBound = Number(safeTargetValue) - Number(outputOffset);
      needOffsetRetry = overall < offsetLowerBound - EPSILON;
      if (needOffsetRetry) {
        applyCraftAssistOffsetWindowCorrection({
          materialResults,
          targetValue: safeTargetValue,
          maxOffset: outputOffset
        });
        overall = calcCraftAssistOverallMean(materialResults);
        if (overall == null) {
          return {ok: false, code: "offset_result_invalid", message: "偏移修正后结果无效，请调整材料范围"};
        }
        // Validate against original targetValue after offset correction
        // below mode requires strictly less than target
        // Direct comparison without EPSILON to preserve 14-digit precision
        if (overall >= Number(targetValue)) {
          return {
            ok: false,
            code: "offset_pullback_exceeds_target",
            overall: Number(overall),
            target: Number(targetValue),
            message: `偏移回拉后超过目标磨损：当前 ${numberTextTrunc(overall, WEAR_INPUT_DECIMALS)}，目标 ${numberTextTrunc(targetValue, WEAR_INPUT_DECIMALS)}`
          };
        }
      }
    }
    const delta = Math.abs(Number(overall) - Number(safeTargetValue));
    if (delta > outputOffset + EPSILON) {
      const retryPrefix = needOffsetRetry ? "已执行偏移回拉重试，" : "";
      return {
        ok: false,
        code: "offset_exceeds_threshold",
        delta: Number(delta),
        threshold: Number(outputOffset),
        message: `${retryPrefix}产物相对磨损偏移超阈值：当前偏移 ${numberTextTrunc(delta, WEAR_INPUT_DECIMALS)}，阈值 ${numberTextTrunc(outputOffset, WEAR_INPUT_DECIMALS)}`
      };
    }
  }

  overall = calcCraftAssistOverallMean(materialResults);
  if (overall == null) {
    return {ok: false, code: "final_result_invalid", message: "终局校验失败：结果均值无效，请调整材料范围"};
  }
  const finalItemIds = collectCraftAssistSelectedItemIds(materialResults);
  const finalSelectedItems = collectCraftAssistSelectedItemDiagnostics(materialResults);

  // Log selected materials and predicted outcome
  craftAssistLogger.info(
    "craft_assist",
    `选材完成: target=${numberTextTrunc(targetValue, WEAR_INPUT_DECIMALS)} predicted_overall=${numberTextTrunc(overall, WEAR_INPUT_DECIMALS)} approach_mode=${approachMode} rarity=${selectedRarity} item_count=${finalItemIds.length}`
  );
  for (let i = 0; i < finalSelectedItems.length; i++) {
    const item = finalSelectedItems[i];
    if (item && item.wear != null) {
      craftAssistLogger.info(
        "craft_assist",
        `  材料[${i + 1}]: id=${item.id} wear=${numberTextTrunc(item.wear, WEAR_INPUT_DECIMALS)} name=${asString(item.name || '').substring(0, 30)}`
      );
    }
  }

  const finalOverallCheck = validateCraftAssistFinalOverall({
    overall,
    targetValue,
    safeTargetValue,
    approachMode,
    itemIds: finalItemIds,
    selectedItems: finalSelectedItems
  });
  if (!finalOverallCheck.ok) {
    return finalOverallCheck;
  }

  const resultIds = [];
  for (const entry of materialResults) {
    const orderedSelected = [...(Array.isArray(entry.selected) ? entry.selected : [])]
      .sort((a, b) => craftAssistCandidateComparator(a, b, safeTargetValue));
    for (const choice of orderedSelected) {
      resultIds.push(choice.id);
    }
  }
  return {
    ok: true,
    itemIds: normalizeCraftRecipeItemIds(resultIds),
    overall,
    rarity: selectedRarity,
    selectionTrace,
    approachMode
  };
}

function getTradeUpRecipeFromRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length !== 10) {
    return {ok: false, reason: `需选择 10 件，当前 ${list.length} 件`, text: "配方：-"};
  }
  const raritySet = new Set(list.map((x) => Number(x && x.rarity || 0)));
  if (raritySet.size !== 1) {
    return {ok: false, reason: "所选 10 件稀有度不一致", text: "配方：稀有度不一致"};
  }
  const rarity = [...raritySet][0];
  if (rarity < 1 || rarity > 5) {
    return {ok: false, reason: `该稀有度不支持汰换（${rarity}）`, text: "配方：当前稀有度不支持"};
  }
  const stSet = new Set(list.map((x) => (isRowStatTrak(x) ? 1 : 0)));
  if (stSet.size !== 1) {
    return {ok: false, reason: "必须全是 StatTrak 或全是普通", text: "配方：品质不一致"};
  }
  const stattrak = [...stSet][0] === 1;
  const recipe = stattrak ? rarity + 9 : rarity - 1;
  const rarityLabel = RARITY_MAP[rarity] || `R${rarity}`;
  const nextLabel = RARITY_MAP[rarity + 1] || `R${rarity + 1}`;
  const prefix = stattrak ? "StatTrak " : "";
  return {
    ok: true,
    recipe,
    rarity,
    stattrak,
    text: `配方：${prefix}${rarityLabel} -> ${prefix}${nextLabel}（recipe ${recipe}）`
  };
}

function buildPickedRowsPayload(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map((row, index) => ({
    index: index + 1,
    asset_id: rowAssetId(row),
    name: itemDisplayName(row),
    relative_wear: numberTextTrunc(getRelativeWearValue(row), WEAR_INPUT_DECIMALS),
    absolute_wear: numberTextTrunc(getAbsoluteWearValue(row), WEAR_INPUT_DECIMALS),
    rarity: craftRarityLabel(craftRarityValue(row))
  }));
}

async function selectCraftAssistForRecipe({
  rows,
  selectionContext,
  candidateRows,
  targetWear,
  wearFilterMode,
  wearApproachMode,
  materials,
  blockedIds,
  includeCooling,
  wearOffsetPct,
  enableFastCraftAssist
} = {}) {
  const targetValue = parseOptionalWear01(targetWear);
  if (targetValue == null) {
    return {ok: false, message: "请先输入目标相对磨损"};
  }
  const context = resolveCraftAssistSelectionContext({
    selectionContext,
    rows,
    candidateRows,
    includeCooling: !!includeCooling
  });
  const contextCandidateRows = Array.isArray(context.candidateRows) ? context.candidateRows : [];
  if (!contextCandidateRows.length) {
    return {ok: false, message: "主库存无可选炼金物品"};
  }
  const normalizedMaterials = normalizeCraftAssistMaterialsForRun(materials, {
    rows: contextCandidateRows,
    legacyWearFilterMode: normalizeCraftAssistFilterMode(wearFilterMode)
  });
  if (!normalizedMaterials.length) {
    return {ok: false, message: "请先添加父类材料并设置数量"};
  }
  const mode = resolveCraftAssistRequiredCount();
  const totalCount = normalizedMaterials.reduce((sum, item) => sum + Number(item.count || 0), 0);
  if (totalCount !== mode) {
    return {ok: false, message: `材料数量之和必须等于 ${mode}，当前 ${totalCount}`};
  }
  const rowsByName = context.rowsByName instanceof Map ? context.rowsByName : buildCraftAssistRowsByName(contextCandidateRows);
  const blocked = new Set(normalizeCraftRecipeItemIds(blockedIds));
  const run = await runCraftAssistSelectionForRecipe({
    materials: normalizedMaterials,
    rowsByName,
    blockedIds: blocked,
    targetValue,
    wearApproachMode: normalizeCraftAssistApproachMode(wearApproachMode),
    useRelativeFilter: normalizeCraftAssistFilterMode(wearFilterMode) !== "absolute",
    wearOffsetPct: normalizeCraftAssistWearOffsetPct(wearOffsetPct, DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT),
    candidateCache: context.candidateCache instanceof Map ? context.candidateCache : null,
    prefilterOptions: typeof enableFastCraftAssist === "boolean"
      ? {enableOversizedPrefilter: enableFastCraftAssist}
      : null
  });
  if (!run.ok) return run;
  const itemIds = normalizeCraftRecipeItemIds(run.itemIds);
  const rowsById = context.rowsById instanceof Map ? context.rowsById : buildRowsByAssetId(contextCandidateRows);
  const selectedRows = itemIds.map((id) => rowsById.get(id)).filter(Boolean);
  const recipeInfo = getTradeUpRecipeFromRows(selectedRows);
  return {
    ok: true,
    item_ids: itemIds,
    overall: Number(run.overall),
    rarity: Number(run.rarity || 0),
    approach_mode: normalizeCraftAssistApproachMode(run.approachMode),
    selection_trace: run.selectionTrace || null,
    recipe_ok: !!recipeInfo.ok,
    recipe_reason: recipeInfo.ok ? "" : asString(recipeInfo.reason || "").trim(),
    recipe_text: asString(recipeInfo.text || "").trim(),
    picks: buildPickedRowsPayload(selectedRows)
  };
}

function createCraftAssistService({logger} = {}) {
  const selectionContextCache = new WeakMap();

  function getCachedSelectionContext(rows, {includeCooling = false} = {}) {
    if (!Array.isArray(rows)) return buildCraftAssistSelectionContext({rows, includeCooling});
    let variants = selectionContextCache.get(rows);
    if (!variants) {
      variants = new Map();
      selectionContextCache.set(rows, variants);
    }
    const key = includeCooling ? "1" : "0";
    const cached = variants.get(key);
    const candidateRows = getCraftCandidates(rows, {includeCooling: !!includeCooling});
    const signature = buildCraftAssistSelectionSourceSignature(candidateRows, {
      includeCooling: !!includeCooling
    });
    if (isReusableCraftAssistSelectionContext(cached, {
      includeCooling,
      sourceSignature: signature
    })) {
      return cached;
    }
    const context = buildCraftAssistSelectionContextFromCandidateRows(candidateRows, {includeCooling});
    variants.set(key, context);
    return context;
  }

  async function selectForRecipe(args = {}) {
    const nextArgs = args && typeof args === "object" ? {...args} : {};
    if (!nextArgs.selectionContext && !Array.isArray(nextArgs.candidateRows) && Array.isArray(nextArgs.rows)) {
      nextArgs.selectionContext = getCachedSelectionContext(nextArgs.rows, {
        includeCooling: !!nextArgs.includeCooling
      });
    }
    const result = await selectCraftAssistForRecipe(nextArgs);
    if (logger && typeof logger.info === "function" && result.ok) {
      logger.info(
        "craft_assist",
        `select success: items=${Array.isArray(result.item_ids) ? result.item_ids.length : 0} rarity=${Number(result.rarity || 0)} overall=${numberTextTrunc(result.overall, WEAR_INPUT_DECIMALS)}`
      );
    }
    if (logger && typeof logger.warn === "function" && !result.ok) {
      logger.warn("craft_assist", `select failed: ${buildCraftAssistFailureLogText(result)}`);
    }
    return result;
  }

  return {
    selectForRecipe
  };
}

module.exports = {
  createCraftAssistService,
  selectCraftAssistForRecipe,
  buildCraftAssistSelectionContext,
  buildCraftAssistSelectionContextFromCandidateRows,
  __test: {
    validateCraftAssistFinalOverall,
    buildCraftAssistFailureLogText
  }
};
