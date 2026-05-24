const fs = require("node:fs");
const path = require("node:path");

const {PATHS} = require("./constants");

function asText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeItemIds(ids) {
  return (Array.isArray(ids) ? ids : [])
    .map((value) => asText(value))
    .filter(Boolean);
}

function compareItemIds(a, b) {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) {
    const aBig = BigInt(a);
    const bBig = BigInt(b);
    if (aBig < bBig) return -1;
    if (aBig > bBig) return 1;
    return 0;
  }
  if (aNumeric !== bNumeric) {
    return aNumeric ? -1 : 1;
  }
  return a.localeCompare(b);
}

function buildCraftDebugItemIdsKey(itemIds) {
  return normalizeItemIds(itemIds)
    .sort(compareItemIds)
    .join("|");
}

function formatDatePart(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function buildCraftDebugLogFilePath({logDir = PATHS.LOG_DIR, generatedAt = new Date()} = {}) {
  const date = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);
  const safeDate = Number.isFinite(date.getTime()) ? date : new Date();
  return path.join(logDir, "craft_debug", `craft_debug_${formatDatePart(safeDate)}.jsonl`);
}

function finiteNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstText(...values) {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return "";
}

function projectCraftDebugItem(row, {index = null} = {}) {
  const assetId = firstText(row && row.asset_id, row && row.assetid, row && row.item_id, row && row.id, row && row.component_id);
  const floatValue = finiteNumberOrNull(row && row.float_value);
  const minFloat = finiteNumberOrNull(row && row.minfloat);
  const maxFloat = finiteNumberOrNull(row && row.maxfloat);
  const relWear = floatValue != null && minFloat != null && maxFloat != null && maxFloat > minFloat
    ? (floatValue - minFloat) / (maxFloat - minFloat)
    : null;
  const item = {
    id: assetId,
    asset_id: assetId,
    name: firstText(row && row.alchemy_name, row && row.name, row && row.market_hash_name),
    float_value: floatValue,
    abs_wear: floatValue,
    absolute_wear: floatValue,
    rel_wear: finiteNumberOrNull(relWear),
    relative_wear: finiteNumberOrNull(relWear),
    minfloat: minFloat,
    maxfloat: maxFloat,
    collection: firstText(row && row.collection, row && row.collection_name),
    collection_name: firstText(row && row.collection_name, row && row.collection),
    rarity: finiteNumberOrNull(row && row.rarity),
    rarity_name: firstText(row && row.rarity_name),
    quality: finiteNumberOrNull(row && row.quality),
    quality_name: firstText(row && row.quality_name)
  };
  if (index != null) {
    item.index = Number(index);
  }
  return item;
}

function buildRowsById(rows) {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = firstText(row && row.asset_id, row && row.assetid, row && row.item_id, row && row.id, row && row.component_id);
    if (id && !out.has(id)) {
      out.set(id, row);
    }
  }
  return out;
}

function projectCraftDebugItemsByIds(rows, itemIdsOrdered) {
  const rowMap = buildRowsById(rows);
  return normalizeItemIds(itemIdsOrdered)
    .map((id, index) => projectCraftDebugItem(rowMap.get(id) || {asset_id: id}, {index: index + 1}));
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildBaseEvent({event, account, index = null, total = null, itemIdsOrdered = []} = {}) {
  const normalizedIds = normalizeItemIds(itemIdsOrdered);
  const out = {
    event: asText(event),
    account: asText(account),
    item_ids_ordered: normalizedIds,
    item_ids_key: buildCraftDebugItemIdsKey(normalizedIds)
  };
  const numericIndex = Number(index);
  const numericTotal = Number(total);
  if (Number.isFinite(numericIndex)) out.index = numericIndex;
  if (Number.isFinite(numericTotal)) out.total = numericTotal;
  if (Number.isFinite(numericIndex) && Number.isFinite(numericTotal)) {
    out.step = `${numericIndex}/${numericTotal}`;
  }
  return out;
}

function buildCraftAssistSelectionEvent({
  account,
  targetRaw,
  target,
  approachMode,
  predictedOverall,
  quantizedOverall,
  recipeInfo = {},
  itemIdsOrdered = [],
  rows = [],
  index = null,
  total = null
} = {}) {
  return {
    ...buildBaseEvent({
      event: "craft_assist_selection",
      account,
      index,
      total,
      itemIdsOrdered
    }),
    target_raw: asText(targetRaw),
    target: numberOrNull(target),
    approach_mode: asText(approachMode),
    predicted_overall: numberOrNull(predictedOverall),
    quantized_overall: numberOrNull(quantizedOverall),
    recipe: numberOrNull(recipeInfo && recipeInfo.recipe),
    recipe_name: firstText(recipeInfo && recipeInfo.recipe_name, recipeInfo && recipeInfo.text),
    rarity: numberOrNull(recipeInfo && recipeInfo.rarity),
    stattrak: recipeInfo && Object.prototype.hasOwnProperty.call(recipeInfo, "stattrak")
      ? !!recipeInfo.stattrak
      : null,
    picks: projectCraftDebugItemsByIds(rows, itemIdsOrdered)
  };
}

function buildTradeupExecutionEvent({
  account,
  index,
  total,
  recipeInfo = {},
  itemIdsOrdered = [],
  materialRows = [],
  gainedIds = [],
  gainedPresentIds = [],
  gainedRows = []
} = {}) {
  const normalizedGainedIds = normalizeItemIds(gainedIds);
  const normalizedPresentIds = normalizeItemIds(gainedPresentIds);
  return {
    ...buildBaseEvent({
      event: "tradeup_execution",
      account,
      index,
      total,
      itemIdsOrdered
    }),
    recipe: numberOrNull(recipeInfo && recipeInfo.recipe),
    recipe_name: firstText(recipeInfo && recipeInfo.recipe_name, recipeInfo && recipeInfo.text),
    rarity: numberOrNull(recipeInfo && recipeInfo.rarity),
    stattrak: recipeInfo && Object.prototype.hasOwnProperty.call(recipeInfo, "stattrak")
      ? !!recipeInfo.stattrak
      : null,
    materials: projectCraftDebugItemsByIds(materialRows, itemIdsOrdered),
    gained_ids: normalizedGainedIds,
    gained_present_ids: normalizedPresentIds,
    gained_items: projectCraftDebugItemsByIds(gainedRows, normalizedPresentIds)
  };
}

function normalizeCraftDebugEvent(payload = {}) {
  const generatedAt = payload.generatedAt instanceof Date ? payload.generatedAt : new Date(payload.generatedAt || Date.now());
  const safeGeneratedAt = Number.isFinite(generatedAt.getTime()) ? generatedAt : new Date();
  const itemIdsOrdered = normalizeItemIds(payload.item_ids_ordered || payload.itemIdsOrdered || payload.item_ids || payload.itemIds);
  const event = {
    ...payload,
    event: asText(payload.event),
    generated_at: safeGeneratedAt.toISOString(),
    item_ids_ordered: itemIdsOrdered,
    item_ids_key: buildCraftDebugItemIdsKey(itemIdsOrdered)
  };
  delete event.generatedAt;
  delete event.logDir;
  delete event.logger;
  delete event.itemIdsOrdered;
  delete event.itemIds;
  return event;
}

function appendCraftDebugEvent(payload = {}) {
  const logger = payload && payload.logger;
  try {
    const event = normalizeCraftDebugEvent(payload);
    const filePath = buildCraftDebugLogFilePath({
      logDir: payload.logDir || PATHS.LOG_DIR,
      generatedAt: event.generated_at
    });
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
    fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
    return true;
  } catch (err) {
    if (logger && typeof logger.warn === "function") {
      try {
        logger.warn("craft_debug", `failed to write craft debug log: ${err && err.message ? err.message : err}`);
      } catch (_) {
        // Craft debug logging must never affect craft execution.
      }
    }
    return false;
  }
}

module.exports = {
  appendCraftDebugEvent,
  buildCraftAssistSelectionEvent,
  buildCraftDebugItemIdsKey,
  buildCraftDebugLogFilePath,
  buildTradeupExecutionEvent,
  normalizeCraftDebugEvent,
  projectCraftDebugItem,
  projectCraftDebugItemsByIds
};
