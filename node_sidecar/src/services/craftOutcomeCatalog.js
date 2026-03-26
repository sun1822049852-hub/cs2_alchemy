const fs = require("node:fs");
const {DatabaseSync} = require("node:sqlite");
const {asString} = require("../utils");
const {
  normalizeCollectionKey,
  normalizeRarityRank,
  splitCollectionNames
} = require("./skinAlchemyRules");

function normalizeStattrak(value) {
  return Number(value) ? 1 : 0;
}

function choosePreferredText(values) {
  for (const value of values) {
    const text = asString(value).trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function mergeBaseOutcome(existing, row, collectionKey, rarityRank, stattrak) {
  const minfloat = row.minfloat == null ? existing && existing.minfloat : row.minfloat;
  const maxfloat = row.maxfloat == null ? existing && existing.maxfloat : row.maxfloat;
  const wearRange = row.wear_range == null ? existing && existing.wear_range : row.wear_range;
  return {
    collection_key: collectionKey,
    collection_display: collectionKey,
    rarity_text: choosePreferredText([row.rarity, existing && existing.rarity_text]),
    rarity_rank: rarityRank,
    stattrak,
    base_name: choosePreferredText([row.basename, existing && existing.base_name, row.basemarkethashname]),
    basemarkethashname: choosePreferredText([row.basemarkethashname, existing && existing.basemarkethashname]),
    minfloat: minfloat == null ? null : Number(minfloat),
    maxfloat: maxfloat == null ? null : Number(maxfloat),
    wear_range: wearRange == null ? null : Number(wearRange),
    goods_icon_url: choosePreferredText([existing && existing.goods_icon_url, row.goods_icon_url]),
    goods_original_icon_url: choosePreferredText([existing && existing.goods_original_icon_url, row.goods_original_icon_url]),
    goods_share_thumbnail_url: choosePreferredText([existing && existing.goods_share_thumbnail_url, row.goods_share_thumbnail_url])
  };
}

function buildSnapshot(dbPath) {
  const db = new DatabaseSync(dbPath, {open: true, readOnly: true});
  try {
    const rows = db.prepare(`
      SELECT markethashname, name, basemarkethashname, basename, collection, rarity, wearlevel,
             minfloat, maxfloat, isstattrak, wear_range,
             goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url
      FROM skin
      ORDER BY id
    `).all();
    const baseBucketMaps = new Map();
    const wearMap = new Map();
    for (const row of rows) {
      const baseKey = asString(row.basemarkethashname).trim();
      const wearlevel = asString(row.wearlevel).trim();
      if (baseKey && wearlevel) {
        if (!wearMap.has(baseKey)) {
          wearMap.set(baseKey, new Map());
        }
        wearMap.get(baseKey).set(wearlevel, {
          markethashname: asString(row.markethashname).trim(),
          name: asString(row.name).trim(),
          basemarkethashname: baseKey,
          basename: asString(row.basename).trim(),
          wearlevel
        });
      }

      const rarityRank = normalizeRarityRank(row.rarity);
      if (!baseKey || rarityRank <= 0) {
        continue;
      }
      const stattrak = normalizeStattrak(row.isstattrak);
      const collections = splitCollectionNames(row.collection);
      for (const rawCollection of collections) {
        const collectionKey = normalizeCollectionKey(rawCollection);
        if (!collectionKey) {
          continue;
        }
        const bucketKey = `${collectionKey}|${rarityRank}|${stattrak}`;
        if (!baseBucketMaps.has(bucketKey)) {
          baseBucketMaps.set(bucketKey, new Map());
        }
        const bucket = baseBucketMaps.get(bucketKey);
        bucket.set(baseKey, mergeBaseOutcome(bucket.get(baseKey) || null, row, collectionKey, rarityRank, stattrak));
      }
    }

    const baseBuckets = new Map();
    for (const [bucketKey, bucket] of baseBucketMaps.entries()) {
      baseBuckets.set(bucketKey, [...bucket.values()]);
    }

    return {
      dbPath,
      loadedAtMs: Date.now(),
      mtimeMs: Number(fs.statSync(dbPath).mtimeMs) || 0,
      baseBuckets,
      wearMap
    };
  } finally {
    db.close();
  }
}

function createCraftOutcomeCatalog({dbPath} = {}) {
  let snapshot = null;
  return {
    getSnapshot() {
      const currentMtimeMs = Number(fs.statSync(dbPath).mtimeMs) || 0;
      if (!snapshot || snapshot.mtimeMs !== currentMtimeMs) {
        snapshot = buildSnapshot(dbPath);
      }
      return snapshot;
    }
  };
}

module.exports = {
  createCraftOutcomeCatalog
};
