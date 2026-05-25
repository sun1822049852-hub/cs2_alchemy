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

function skinHasColumn(db, columnName) {
  return db.prepare("PRAGMA table_info(skin)").all().some(
    (row) => asString(row && row.name).trim() === asString(columnName).trim()
  );
}

function stripSouvenirPrefix(value) {
  return asString(value).trim().replace(/^(?:Souvenir|纪念品)\s+/i, "").trim();
}

function stripSouvenirDisplayMarkers(value) {
  return asString(value)
    .trim()
    .replace(/^Souvenir\s+/i, "")
    .replace(/^纪念品\s+/, "")
    .replace(/\s*\(\s*(?:Souvenir|纪念品)\s*\)\s*/gi, " ")
    .replace(/\s*（\s*(?:Souvenir|纪念品)\s*）\s*/gi, " ")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function hasSouvenirMarker(value) {
  const text = asString(value).trim();
  return /^(?:Souvenir|纪念品)\s+/i.test(text)
    || /\(\s*(?:Souvenir|纪念品)\s*\)/i.test(text)
    || /（\s*(?:Souvenir|纪念品)\s*）/i.test(text);
}

function isSouvenirSkinRow(row) {
  return hasSouvenirMarker(row && row.markethashname)
    || hasSouvenirMarker(row && row.basemarkethashname)
    || hasSouvenirMarker(row && row.name)
    || hasSouvenirMarker(row && row.basename);
}

function stripWearSuffix(value) {
  return asString(value).trim().replace(/\s+\([^)]+\)\s*$/, "").trim();
}

function normalizeOutcomeMarketHashName(row) {
  return stripSouvenirPrefix(row && row.markethashname);
}

function normalizeOutcomeBaseMarketHashName(row, normalMarketHashName) {
  return stripSouvenirPrefix(row && row.basemarkethashname)
    || stripWearSuffix(normalMarketHashName);
}

function normalizeOutcomeIdentity(row) {
  const markethashname = normalizeOutcomeMarketHashName(row);
  const basemarkethashname = normalizeOutcomeBaseMarketHashName(row, markethashname);
  const basename = stripSouvenirDisplayMarkers(row && row.basename);
  const name = stripSouvenirDisplayMarkers(row && row.name);
  return {
    ...row,
    basemarkethashname,
    basename: basename || basemarkethashname,
    markethashname,
    name: name || markethashname
  };
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

function upsertBucketRow(bucketMaps, bucketKey, baseKey, row, collectionKey, rarityRank, stattrak) {
  if (!bucketMaps.has(bucketKey)) {
    bucketMaps.set(bucketKey, new Map());
  }
  const bucket = bucketMaps.get(bucketKey);
  bucket.set(baseKey, mergeBaseOutcome(bucket.get(baseKey) || null, row, collectionKey, rarityRank, stattrak));
}

function freezeBuckets(bucketMaps) {
  const buckets = new Map();
  for (const [bucketKey, bucket] of bucketMaps.entries()) {
    buckets.set(bucketKey, [...bucket.values()]);
  }
  return buckets;
}

function buildSnapshot(dbPath) {
  const db = new DatabaseSync(dbPath, {open: true, readOnly: true});
  try {
    const inventoryFilter = skinHasColumn(db, "inventory_display_only")
      ? "WHERE COALESCE(inventory_display_only, 0) = 0"
      : "";
    const rows = db.prepare(`
      SELECT markethashname, name, basemarkethashname, basename, collection, rarity, wearlevel,
             minfloat, maxfloat, isstattrak, wear_range,
             goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url
      FROM skin
      ${inventoryFilter}
      ORDER BY id
    `).all();
    const baseBucketMaps = new Map();
    const outcomeBucketMaps = new Map();
    const wearMap = new Map();
    const outcomeWearMap = new Map();
    for (const row of rows) {
      const baseKey = asString(row.basemarkethashname).trim();
      const wearlevel = asString(row.wearlevel).trim();
      const isSouvenirRow = isSouvenirSkinRow(row);
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

        if (!isSouvenirRow) {
          const outcomeRow = normalizeOutcomeIdentity(row);
          const outcomeBaseKey = asString(outcomeRow.basemarkethashname).trim();
          if (outcomeBaseKey) {
            if (!outcomeWearMap.has(outcomeBaseKey)) {
              outcomeWearMap.set(outcomeBaseKey, new Map());
            }
            outcomeWearMap.get(outcomeBaseKey).set(wearlevel, {
              markethashname: asString(outcomeRow.markethashname).trim(),
              name: asString(outcomeRow.name).trim(),
              basemarkethashname: outcomeBaseKey,
              basename: asString(outcomeRow.basename).trim(),
              wearlevel
            });
          }
        }
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
        upsertBucketRow(baseBucketMaps, bucketKey, baseKey, row, collectionKey, rarityRank, stattrak);
        if (!isSouvenirRow) {
          const outcomeRow = normalizeOutcomeIdentity(row);
          const outcomeBaseKey = asString(outcomeRow.basemarkethashname).trim();
          upsertBucketRow(outcomeBucketMaps, bucketKey, outcomeBaseKey, outcomeRow, collectionKey, rarityRank, stattrak);
        }
      }
    }

    const baseBuckets = freezeBuckets(baseBucketMaps);
    const outcomeBuckets = freezeBuckets(outcomeBucketMaps);

    return {
      dbPath,
      loadedAtMs: Date.now(),
      mtimeMs: Number(fs.statSync(dbPath).mtimeMs) || 0,
      baseBuckets,
      outcomeBuckets,
      outcomeWearMap,
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
