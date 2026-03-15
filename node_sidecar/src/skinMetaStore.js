const fs = require("fs");
const {DatabaseSync} = require("node:sqlite");
const {PATHS} = require("./constants");
const {asString, toInt} = require("./utils");

function normalizeFloat(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fetchSkinMetadataMap(names, dbPath = PATHS.SKIN_DB_FILE) {
  const clean = Array.from(
    new Set(
      (names || [])
        .map((x) => asString(x).trim())
        .filter(Boolean)
    )
  );
  if (!clean.length || !fs.existsSync(dbPath)) {
    return new Map();
  }

  const out = new Map();
  let db = null;
  try {
    db = new DatabaseSync(dbPath, {open: true, readOnly: true});
    const chunkSize = 500;
    for (let i = 0; i < clean.length; i += chunkSize) {
      const chunk = clean.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => "?").join(",");
      const sql =
        "SELECT markethashname, name, collection, rarity, minfloat, maxfloat, isstattrak, wear_range " +
        `FROM skin WHERE markethashname IN (${placeholders})`;
      const stmt = db.prepare(sql);
      const rows = stmt.all(...chunk);
      for (const row of rows) {
        const key = asString(row.markethashname).trim();
        if (!key) {
          continue;
        }
        out.set(key, {
          name: asString(row.name).trim(),
          collection: asString(row.collection).trim(),
          rarity: asString(row.rarity).trim(),
          minfloat: normalizeFloat(row.minfloat),
          maxfloat: normalizeFloat(row.maxfloat),
          isstattrak: toInt(row.isstattrak, 0),
          wear_range: normalizeFloat(row.wear_range)
        });
      }
    }
  } catch (_) {
    return new Map();
  } finally {
    try {
      if (db) {
        db.close();
      }
    } catch (_) {}
  }
  return out;
}

function fillMissingWearBounds(rows, {dbPath = PATHS.SKIN_DB_FILE} = {}) {
  if (!Array.isArray(rows) || !rows.length) {
    return Array.isArray(rows) ? rows : [];
  }

  const missingRows = [];
  const marketHashNames = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }

    row.minfloat = normalizeFloat(row.minfloat);
    row.maxfloat = normalizeFloat(row.maxfloat);
    row.wear_range = normalizeFloat(row.wear_range);

    const key = asString(row.market_hash_name || row.name || "").trim();
    if (!key) {
      continue;
    }
    row.market_hash_name = key;

    if (row.minfloat === null || row.maxfloat === null || row.wear_range === null) {
      missingRows.push({row, key});
      marketHashNames.add(key);
    }
  }

  if (!missingRows.length) {
    return rows;
  }

  const metaMap = fetchSkinMetadataMap([...marketHashNames], dbPath);
  if (!metaMap.size) {
    return rows;
  }

  for (const {row, key} of missingRows) {
    const meta = metaMap.get(key);
    if (!meta) {
      continue;
    }
    if (row.minfloat === null) {
      row.minfloat = meta.minfloat;
    }
    if (row.maxfloat === null) {
      row.maxfloat = meta.maxfloat;
    }
    if (row.wear_range === null) {
      row.wear_range = meta.wear_range;
    }
  }
  return rows;
}

module.exports = {
  fetchSkinMetadataMap,
  fillMissingWearBounds
};
