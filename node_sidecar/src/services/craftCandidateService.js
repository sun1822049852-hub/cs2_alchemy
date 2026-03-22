const {asString} = require("../utils");

const MAIN_INVENTORY_CAPACITY = 1000;
const STORAGE_UNIT_DEF_INDEX = 1201;

function normalizeItemId(value) {
  return asString(value).trim();
}

function normalizeItemIds(ids) {
  return Array.from(new Set((Array.isArray(ids) ? ids : [])
    .map((value) => normalizeItemId(value))
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

function isComponentRow(row) {
  if (!row || typeof row !== "object") return false;
  const defIndex = Number(row.def_index || 0);
  if (defIndex === STORAGE_UNIT_DEF_INDEX) return true;
  const name = asString(row.name || row.alchemy_name || "").toLowerCase();
  return name.includes("storage unit");
}

function isRowStatTrak(row) {
  if (Number(row && row.quality || 0) === 9) return true;
  const qualityText = asString(row && row.quality_name || "").toLowerCase();
  return qualityText.includes("stattrak");
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

function isAllowedComponentCraftHiddenReason(row) {
  if (!row || typeof row !== "object") return false;
  const casketId = asString(row.casket_id || "").trim();
  const hiddenReason = asString(row.hidden_reason || "").trim();
  if (!casketId || !hiddenReason) return false;
  return hiddenReason === "attr#272/273";
}

function isCraftCandidateRow(row, {includeComponentItems = false} = {}) {
  if (!row || typeof row !== "object") return false;
  if (isComponentRow(row)) return false;
  const inComponent = !!asString(row.casket_id || "").trim();
  const hiddenReason = asString(row.hidden_reason || "").trim();
  if (hiddenReason && !isAllowedComponentCraftHiddenReason(row)) return false;
  if (row.is_craftable !== true) return false;
  if (inComponent && !includeComponentItems) return false;
  return true;
}

function sortCraftCandidateRows(rows) {
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

function buildRowsByAssetId(rows) {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = rowAssetId(row);
    if (id && !out.has(id)) out.set(id, row);
  }
  return out;
}

function estimateMainInventoryFreeSlots(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const mainRows = sourceRows.filter((row) => !asString(row && row.casket_id || "").trim());
  const hiddenCount = mainRows.filter((row) => asString(row && row.hidden_reason || "").trim()).length;
  const coolingCount = mainRows.filter((row) => coolingUnlockTs(row) > 0).length;
  // This is the "actual withdrawable component-item budget", not the naive
  // physical empty-slot count from "1000 - current main inventory items".
  // In current real usage, hidden rows and cooling rows are excluded from
  // occupiedSlots, so they do not continue to consume the component-withdraw
  // budget shown in UI. The returned freeSlots is used for:
  // 1. component candidate pre-clipping during selection;
  // 2. UI hints such as "实际可从组件中取出";
  // 3. execution-time prechecks, so selection and execution share one meaning.
  const occupiedSlots = Math.max(0, mainRows.length - hiddenCount - coolingCount);
  const capacity = MAIN_INVENTORY_CAPACITY;
  const freeSlots = Math.max(0, capacity - occupiedSlots);
  return {
    freeSlots,
    capacity,
    occupiedSlots,
    totalMainItems: mainRows.length,
    hiddenCount,
    coolingCount,
    reliable: true
  };
}

function shouldHideUnselectedComponentCandidate({selectedComponentCount = 0, mainFreeSlots = 0, isSelected = false} = {}) {
  if (isSelected) return false;
  const selected = Math.max(0, Number(selectedComponentCount) || 0);
  const free = Math.max(0, Number(mainFreeSlots) || 0);
  // Once the selected component-item count reaches the withdrawable budget,
  // we hide the remaining unselected component candidates. This prevents the
  // user from selecting more component items than can actually be withdrawn.
  return selected >= free;
}

function buildCraftCandidateContext({
  rows,
  includeComponentItems = false,
  includeCooling = false,
  selectedItemIds = []
} = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const normalizedSelectedIds = normalizeItemIds(selectedItemIds);
  const selectedSet = new Set(normalizedSelectedIds);
  const allCraftableRows = sortCraftCandidateRows(sourceRows.filter((row) => isCraftCandidateRow(row, {includeComponentItems})));
  const rowsById = buildRowsByAssetId(allCraftableRows);
  const slotInfo = estimateMainInventoryFreeSlots(sourceRows);
  let selectedComponentCount = 0;
  for (const id of selectedSet) {
    const row = rowsById.get(id);
    if (row && asString(row.casket_id || "").trim()) selectedComponentCount += 1;
  }
  const coolingCount = allCraftableRows.filter((row) => coolingUnlockTs(row) > 0).length;
  let candidateRows = includeCooling
    ? [...allCraftableRows]
    : allCraftableRows.filter((row) => coolingUnlockTs(row) <= 0);
  if (includeComponentItems) {
    candidateRows = candidateRows.filter((row) => {
      const inComponent = !!asString(row && row.casket_id || "").trim();
      if (!inComponent) return true;
      return !shouldHideUnselectedComponentCandidate({
        selectedComponentCount,
        mainFreeSlots: slotInfo.freeSlots,
        isSelected: selectedSet.has(rowAssetId(row))
      });
    });
  }
  return {
    candidateRows,
    allCraftableRows,
    rowsById,
    selectedItemIds: normalizedSelectedIds,
    slotInfo,
    stats: {
      include_component_items: !!includeComponentItems,
      include_cooling: !!includeCooling,
      total_craftable_count: allCraftableRows.length,
      visible_candidate_count: candidateRows.length,
      cooling_count: coolingCount,
      selected_component_count: selectedComponentCount,
      main_free_slots: slotInfo.freeSlots,
      main_capacity: slotInfo.capacity,
      main_occupied_slots: slotInfo.occupiedSlots,
      main_hidden_count: slotInfo.hiddenCount,
      main_cooling_count: slotInfo.coolingCount
    }
  };
}

module.exports = {
  MAIN_INVENTORY_CAPACITY,
  STORAGE_UNIT_DEF_INDEX,
  buildCraftCandidateContext,
  buildRowsByAssetId,
  coolingUnlockTs,
  estimateMainInventoryFreeSlots,
  isAllowedComponentCraftHiddenReason,
  isComponentRow,
  rowAssetId,
  shouldHideUnselectedComponentCandidate,
  sortCraftCandidateRows
};
