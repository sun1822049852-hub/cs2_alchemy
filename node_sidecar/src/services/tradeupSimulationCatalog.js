const fs = require("node:fs");
const {DatabaseSync} = require("node:sqlite");
const {PATHS} = require("../constants");
const {asString, toInt} = require("../utils");
const {normalizeCollectionKey} = require("./skinAlchemyRules");

function normalizeFloat(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeSimulationSearchText(value) {
  return asString(value)
    .replace(/™/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const SIMULATION_SEARCH_WEAR_PRIORITY = new Map([
  ["Factory New", 0],
  ["Minimal Wear", 1],
  ["Field-Tested", 2],
  ["Well-Worn", 3],
  ["Battle-Scarred", 4]
]);

function normalizeSimulationItemRow(row) {
  return {
    markethashname: asString(row && row.markethashname).trim(),
    name: asString((row && row.name) || (row && row.markethashname)).trim(),
    basemarkethashname: asString(row && row.basemarkethashname).trim(),
    basename: asString((row && row.basename) || (row && row.basemarkethashname)).trim(),
    collection: normalizeCollectionKey(row && row.collection),
    rarity: asString(row && row.rarity).trim(),
    wearlevel: asString(row && row.wearlevel).trim(),
    minfloat: normalizeFloat(row && row.minfloat),
    maxfloat: normalizeFloat(row && row.maxfloat),
    wear_range: normalizeFloat(row && row.wear_range),
    isstattrak: toInt(row && row.isstattrak, 0),
    goods_icon_url: asString(row && row.goods_icon_url).trim(),
    goods_original_icon_url: asString(row && row.goods_original_icon_url).trim(),
    goods_share_thumbnail_url: asString(row && row.goods_share_thumbnail_url).trim()
  };
}

function getSimulationSearchItemKey(item) {
  return asString(item && item.basemarkethashname).trim()
    || asString(item && item.basename).trim()
    || asString(item && item.markethashname).trim();
}

function getSimulationSearchItemScore(item) {
  const hasImage = Boolean(
    asString(item && item.goods_original_icon_url).trim()
    || asString(item && item.goods_icon_url).trim()
    || asString(item && item.goods_share_thumbnail_url).trim()
  );
  const wearRank = SIMULATION_SEARCH_WEAR_PRIORITY.has(asString(item && item.wearlevel).trim())
    ? SIMULATION_SEARCH_WEAR_PRIORITY.get(asString(item && item.wearlevel).trim())
    : Number.MAX_SAFE_INTEGER;
  return {
    hasImage: hasImage ? 1 : 0,
    wearRank,
    markethashname: asString(item && item.markethashname).trim()
  };
}

function preferSimulationSearchItem(currentItem, nextItem) {
  if (!currentItem) return nextItem;
  if (!nextItem) return currentItem;
  const current = getSimulationSearchItemScore(currentItem);
  const next = getSimulationSearchItemScore(nextItem);
  if (current.hasImage !== next.hasImage) {
    return next.hasImage > current.hasImage ? nextItem : currentItem;
  }
  if (current.wearRank !== next.wearRank) {
    return next.wearRank < current.wearRank ? nextItem : currentItem;
  }
  if (current.markethashname !== next.markethashname) {
    return next.markethashname.localeCompare(current.markethashname) < 0 ? nextItem : currentItem;
  }
  return currentItem;
}

function dedupeSimulationSearchItems(rows, limit) {
  const uniqueItems = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const item = normalizeSimulationItemRow(row);
    const key = getSimulationSearchItemKey(item);
    if (!key) continue;
    uniqueItems.set(key, preferSimulationSearchItem(uniqueItems.get(key), item));
    if (uniqueItems.size >= limit && uniqueItems.size >= (Array.isArray(rows) ? rows.length : 0)) {
      break;
    }
  }
  return Array.from(uniqueItems.values()).slice(0, limit);
}

function appendSimulationSearchItems(uniqueItems, rows) {
  for (const row of Array.isArray(rows) ? rows : []) {
    const item = normalizeSimulationItemRow(row);
    const key = getSimulationSearchItemKey(item);
    if (!key) continue;
    uniqueItems.set(key, preferSimulationSearchItem(uniqueItems.get(key), item));
  }
}

function withDb(dbPath, runner) {
  if (!dbPath || !fs.existsSync(dbPath)) {
    return runner(null);
  }
  const db = new DatabaseSync(dbPath, {open: true, readOnly: true});
  try {
    return runner(db);
  } finally {
    db.close();
  }
}

function createTradeupSimulationCatalog({dbPath = PATHS.SKIN_DB_FILE} = {}) {
  return {
    searchItems(query, {limit = 50} = {}) {
      const rawQuery = asString(query).trim();
      if (!rawQuery) return [];
      const normalizedQuery = normalizeCollectionKey(rawQuery);
      const normalizedRawQuery = normalizeSimulationSearchText(rawQuery);
      const normalizedAliasQuery = normalizeSimulationSearchText(normalizedQuery);
      if (!normalizedRawQuery && !normalizedAliasQuery) return [];
      const loweredRaw = `%${normalizedRawQuery}%`;
      const loweredNormalized = `%${normalizedAliasQuery}%`;
      const normalizedLimit = Math.max(1, Math.trunc(Number(limit) || 0) || 50);
      const rawLimit = Math.max(normalizedLimit * 8, 80);
      return withDb(dbPath, (db) => {
        if (!db) return [];
        const stmt = db.prepare(`
          SELECT markethashname, name, basemarkethashname, basename, collection, rarity, wearlevel,
                 minfloat, maxfloat, wear_range, isstattrak,
                   goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url
          FROM skin
          WHERE LOWER(REPLACE(COALESCE(markethashname, ''), '™', '')) LIKE ?
             OR LOWER(REPLACE(COALESCE(name, ''), '™', '')) LIKE ?
             OR LOWER(REPLACE(COALESCE(basemarkethashname, ''), '™', '')) LIKE ?
             OR LOWER(COALESCE(collection, '')) LIKE ?
             OR LOWER(REPLACE(COALESCE(markethashname, ''), '™', '')) LIKE ?
             OR LOWER(REPLACE(COALESCE(name, ''), '™', '')) LIKE ?
             OR LOWER(REPLACE(COALESCE(basemarkethashname, ''), '™', '')) LIKE ?
             OR LOWER(COALESCE(collection, '')) LIKE ?
            ORDER BY markethashname ASC
            LIMIT ? OFFSET ?
          `);
        const uniqueItems = new Map();
        let offset = 0;
        while (uniqueItems.size < normalizedLimit) {
          const rows = stmt.all(
            loweredRaw, loweredRaw, loweredRaw, loweredRaw,
            loweredNormalized, loweredNormalized, loweredNormalized, loweredNormalized,
            rawLimit,
            offset
          );
          if (!rows.length) break;
          appendSimulationSearchItems(uniqueItems, rows);
          if (rows.length < rawLimit) break;
          offset += rows.length;
        }
        return Array.from(uniqueItems.values()).slice(0, normalizedLimit);
      });
    },

    getItemByMarketHashName(markethashname) {
      const key = asString(markethashname).trim();
      if (!key) return null;
      return withDb(dbPath, (db) => {
        if (!db) return null;
        const row = db.prepare(`
          SELECT markethashname, name, basemarkethashname, basename, collection, rarity, wearlevel,
                 minfloat, maxfloat, wear_range, isstattrak,
                 goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url
          FROM skin
          WHERE markethashname = ?
          LIMIT 1
        `).get(key);
        return row ? normalizeSimulationItemRow(row) : null;
      });
    }
  };
}

module.exports = {
  createTradeupSimulationCatalog
};
