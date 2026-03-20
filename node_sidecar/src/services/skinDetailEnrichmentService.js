const {DatabaseSync} = require("node:sqlite");

const {asString} = require("../utils");
const {assignAlchemyTypes, splitCollectionNames} = require("./skinAlchemyRules");
const {buildSkinFamilyKey} = require("./skinFamilyKey");

function log(logger, level, message) {
  if (!logger || typeof logger[level] !== "function") {
    return;
  }
  logger[level]("skin_detail_enrichment", message);
}

function createSummary() {
  return {
    families_pending: 0,
    families_ok: 0,
    families_failed: 0,
    rows_filled: 0,
    rows_still_missing: 0,
    rows_no_supported_platform: 0
  };
}

function mapWithConcurrency(items, concurrency, iteratee) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.trunc(Number(concurrency) || 0) || 1);
  let index = 0;
  async function worker() {
    while (index < list.length) {
      const currentIndex = index;
      index += 1;
      await iteratee(list[currentIndex], currentIndex);
    }
  }
  return Promise.all(Array.from({length: Math.min(limit, list.length || 1)}, () => worker()));
}

function summarizeError(err) {
  const text = asString(err && err.message ? err.message : err).trim();
  return text || "detail_enrichment_failed";
}

function recalculateAlchemyTypesForCollections(db, affectedCollections, options = {}) {
  const targets = affectedCollections instanceof Set ? affectedCollections : new Set();
  if (!targets.size) {
    return 0;
  }
  const rows = db.prepare(`
    SELECT id, collection, rarity, alchemy_type
    FROM skin
    WHERE TRIM(COALESCE(collection, '')) <> ''
  `).all().filter((row) => {
    const collections = splitCollectionNames(row.collection);
    return collections.some((collection) => targets.has(collection));
  });
  if (!rows.length) {
    return 0;
  }

  const recalculated = assignAlchemyTypes(rows, {rarityOrder: options.rarityOrder});
  const update = db.prepare("UPDATE skin SET alchemy_type = ? WHERE id = ?");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of recalculated) {
      update.run(
        asString(row.alchemy_type).trim() || "不能炼金",
        Number(row.id)
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return recalculated.length;
}

function createSkinDetailEnrichmentService({
  dbPath,
  provider,
  logger = null,
  concurrency = 2,
  rarityOrder = []
} = {}) {
  if (!asString(dbPath).trim()) {
    throw new Error("dbPath is required");
  }
  if (!provider || typeof provider.fetchByGoodsId !== "function") {
    throw new Error("provider.fetchByGoodsId is required");
  }

  function loadPendingFamilies(db) {
    const rows = db.prepare(`
      SELECT id, markethashname, basemarkethashname, buffid, collection, rarity, detail_status
      FROM skin
      WHERE detail_status = 'pending'
      ORDER BY id
    `).all();
    const families = new Map();
    for (const row of rows) {
      const key = buildSkinFamilyKey(asString(row.basemarkethashname).trim() || asString(row.markethashname).trim());
      if (!key) {
        continue;
      }
      if (!families.has(key)) {
        families.set(key, []);
      }
      families.get(key).push(row);
    }
    return [...families.entries()].map(([familyKey, members]) => ({
      familyKey,
      rows: members,
      representativeGoodsId: asString(
        (members.find((row) => asString(row && row.buffid).trim()) || {}).buffid
      ).trim()
    }));
  }

  function markFamilyFailed(db, family, errorText) {
    const ids = family.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
    if (!ids.length) {
      return 0;
    }
    const placeholders = ids.map(() => "?").join(",");
    const checkedAt = new Date().toISOString();
    const stmt = db.prepare(`
      UPDATE skin
      SET detail_status = 'failed',
          detail_error = ?,
          detail_checked_at = ?,
          detail_attempts = COALESCE(detail_attempts, 0) + 1
      WHERE id IN (${placeholders})
    `);
    stmt.run(errorText, checkedAt, ...ids);
    return ids.length;
  }

  function markFamilyOk(db, family, detail) {
    const ids = family.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
    if (!ids.length) {
      return 0;
    }
    const placeholders = ids.map(() => "?").join(",");
    const checkedAt = new Date().toISOString();
    const stmt = db.prepare(`
      UPDATE skin
      SET collection = ?,
          rarity = ?,
          detail_status = 'ok',
          detail_source = ?,
          detail_checked_at = ?,
          detail_error = '',
          detail_attempts = COALESCE(detail_attempts, 0) + 1
      WHERE id IN (${placeholders})
    `);
    stmt.run(
      asString(detail && detail.collection).trim(),
      asString(detail && detail.rarity).trim(),
      asString(detail && detail.detail_source).trim() || "buff",
      checkedAt,
      ...ids
    );
    return ids.length;
  }

  async function enrichMissingDetails() {
    const summary = createSummary();
    const families = [];
    const affectedCollections = new Set();
    let db = new DatabaseSync(dbPath);
    try {
      for (const family of loadPendingFamilies(db)) {
        families.push(family);
      }
      summary.families_pending = families.length;
    } finally {
      db.close();
    }

    await mapWithConcurrency(families, concurrency, async (family) => {
      let workerDb = new DatabaseSync(dbPath);
      try {
        if (!family.representativeGoodsId) {
          const affected = markFamilyFailed(workerDb, family, "no_supported_platform_id");
          summary.rows_no_supported_platform += affected;
          summary.families_failed += 1;
          return;
        }
        const representative = family.rows[0] || {};
        const detail = await provider.fetchByGoodsId(family.representativeGoodsId, {
          expectedBaseName: asString(representative.basemarkethashname).trim() ||
            asString(representative.markethashname).trim()
        });
        const affected = markFamilyOk(workerDb, family, detail);
        for (const collection of splitCollectionNames(detail && detail.collection)) {
          affectedCollections.add(collection);
        }
        summary.families_ok += 1;
        summary.rows_filled += affected;
        log(logger, "info", `family=${family.familyKey} goods_id=${family.representativeGoodsId} rows=${affected} status=ok`);
      } catch (err) {
        const errorText = summarizeError(err);
        markFamilyFailed(workerDb, family, errorText);
        summary.families_failed += 1;
        log(logger, "warn", `family=${family.familyKey} goods_id=${family.representativeGoodsId || "-"} status=failed err=${errorText}`);
      } finally {
        workerDb.close();
      }
    });

    db = new DatabaseSync(dbPath);
    try {
      recalculateAlchemyTypesForCollections(db, affectedCollections, {rarityOrder});
      const row = db.prepare(`
        SELECT COUNT(*) AS count
        FROM skin
        WHERE TRIM(COALESCE(collection, '')) = '' OR TRIM(COALESCE(rarity, '')) = ''
      `).get();
      summary.rows_still_missing = Number(row && row.count || 0) || 0;
    } finally {
      db.close();
    }
    return summary;
  }

  return {
    enrichMissingDetails
  };
}

module.exports = {
  createSkinDetailEnrichmentService
};
