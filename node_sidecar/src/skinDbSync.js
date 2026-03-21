const fs = require("node:fs");
const path = require("node:path");
const {DatabaseSync} = require("node:sqlite");
const {asString} = require("./utils");
const {
  assignAlchemyTypes: assignAlchemyTypesShared,
  splitCollectionNames: splitCollectionNamesShared
} = require("./services/skinAlchemyRules");
const {createSkinDetailEnrichmentService} = require("./services/skinDetailEnrichmentService");
const {buildSkinFamilyKey} = require("./services/skinFamilyKey");

const DEFAULT_JSON_DIR = "C:/Users/18220/Desktop/smelter/data";
const DEFAULT_JSON_PATH = "C:/Users/18220/Desktop/smelter/data/steam_base_info_20260315_232059.json";

const WEAR_SUFFIX_MAP = [
  {cn: "崭新出厂", en: "Factory New"},
  {cn: "略有磨损", en: "Minimal Wear"},
  {cn: "久经沙场", en: "Field-Tested"},
  {cn: "破损不堪", en: "Well-Worn"},
  {cn: "战痕累累", en: "Battle-Scarred"}
];

const ALLOWED_HEADS = new Set([
  "AK-47",
  "AUG",
  "AWP",
  "CZ75-Auto",
  "Desert Eagle",
  "Dual Berettas",
  "FAMAS",
  "Five-SeveN",
  "G3SG1",
  "Galil AR",
  "Glock-18",
  "M249",
  "M4A1-S",
  "M4A4",
  "MAC-10",
  "MAG-7",
  "MP5-SD",
  "MP7",
  "MP9",
  "Negev",
  "Nova",
  "P2000",
  "P250",
  "P90",
  "PP-Bizon",
  "R8 Revolver",
  "Sawed-Off",
  "SCAR-20",
  "SG 553",
  "SSG 08",
  "Tec-9",
  "UMP-45",
  "USP-S",
  "XM1014",
  "Zeus x27",
  "Bayonet",
  "Bowie Knife",
  "Butterfly Knife",
  "Classic Knife",
  "Falchion Knife",
  "Flip Knife",
  "Gut Knife",
  "Huntsman Knife",
  "Karambit",
  "Kukri Knife",
  "M9 Bayonet",
  "Navaja Knife",
  "Nomad Knife",
  "Paracord Knife",
  "Shadow Daggers",
  "Skeleton Knife",
  "Stiletto Knife",
  "Survival Knife",
  "Talon Knife",
  "Ursus Knife",
  "Bloodhound Gloves",
  "Broken Fang Gloves",
  "Driver Gloves",
  "Hand Wraps",
  "Hydra Gloves",
  "Moto Gloves",
  "Specialist Gloves",
  "Sport Gloves"
]);

function stripWearSuffix(text, suffixes) {
  const raw = asString(text).trim();
  for (const suffix of suffixes) {
    const token = ` (${suffix})`;
    if (raw.endsWith(token)) {
      return raw.slice(0, -token.length).trim();
    }
  }
  return raw;
}

function detectWearLevel(name, marketHashName) {
  const cn = asString(name).trim();
  const en = asString(marketHashName).trim();
  for (const pair of WEAR_SUFFIX_MAP) {
    if (cn.endsWith(` (${pair.cn})`) || en.endsWith(` (${pair.en})`)) {
      return pair.en;
    }
  }
  return "Unknown";
}

function normalizePlatformIds(platformList) {
  const out = {buffid: "", c5id: "", youpinid: ""};
  for (const row of Array.isArray(platformList) ? platformList : []) {
    const name = asString(row && row.name).trim().toUpperCase();
    const itemId = asString(row && row.itemId).trim();
    if (!itemId) continue;
    if (name === "BUFF") out.buffid = itemId;
    if (name === "C5") out.c5id = itemId;
    if (name === "YOUPIN") out.youpinid = itemId;
  }
  return out;
}

function normalizeSkinHead(text) {
  let out = asString(text).trim();
  let changed = true;
  while (changed) {
    changed = false;
    const next = out
      .replace(/^★\s+/, "")
      .replace(/^(Souvenir|StatTrak(?:™)?|Genuine)\s+/i, "")
      .trim();
    if (next !== out) {
      out = next;
      changed = true;
    }
  }
  return out;
}

function isImportableSkin(item) {
  const marketHashName = asString(item && item.marketHashName).trim();
  const displayName = asString(item && item.name).trim();
  if (!marketHashName) {
    return false;
  }
  if (/^Souvenir\s/i.test(marketHashName)) {
    return false;
  }
  const wearlevel = detectWearLevel(displayName, marketHashName);
  if (wearlevel === "Unknown") {
    return false;
  }
  if (!marketHashName.includes("|")) {
    return false;
  }
  const head = normalizeSkinHead(marketHashName.split("|")[0]);
  if (!ALLOWED_HEADS.has(head)) {
    return false;
  }
  return true;
}

function parseSkinRecord(item) {
  const name = asString(item && item.name).trim();
  const markethashname = asString(item && item.marketHashName).trim() || name;
  const wearlevel = detectWearLevel(name, markethashname);
  const ids = normalizePlatformIds(item && item.platformList);
  const basename = stripWearSuffix(name, WEAR_SUFFIX_MAP.map((x) => x.cn));
  const basemarkethashname = stripWearSuffix(markethashname, WEAR_SUFFIX_MAP.map((x) => x.en));
  return {
    markethashname,
    name,
    basemarkethashname,
    basename,
    wearlevel,
    isstattrak: /StatTrak/i.test(markethashname) || /StatTrak/i.test(name) ? 1 : 0,
    buffid: ids.buffid,
    c5id: ids.c5id,
    youpinid: ids.youpinid
  };
}

function normalizeFloat(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function deriveWearRange(row) {
  const min = normalizeFloat(row.minfloat);
  const max = normalizeFloat(row.maxfloat);
  if (min === null || max === null) {
    return null;
  }
  return max - min;
}

function ensureAlchemyTypeColumn(db) {
  const columns = db.prepare("PRAGMA table_info(skin)").all();
  if (columns.some((row) => asString(row.name).trim() === "alchemy_type")) {
    return;
  }
  db.exec("ALTER TABLE skin ADD COLUMN alchemy_type TEXT DEFAULT '不能炼金'");
}

function ensureSkinDetailColumns(db) {
  const columns = new Set(
    db.prepare("PRAGMA table_info(skin)").all().map((row) => asString(row.name).trim())
  );
  if (!columns.has("detail_status")) {
    db.exec("ALTER TABLE skin ADD COLUMN detail_status TEXT DEFAULT 'pending'");
  }
  if (!columns.has("detail_source")) {
    db.exec("ALTER TABLE skin ADD COLUMN detail_source TEXT DEFAULT ''");
  }
  if (!columns.has("detail_checked_at")) {
    db.exec("ALTER TABLE skin ADD COLUMN detail_checked_at DATETIME");
  }
  if (!columns.has("detail_error")) {
    db.exec("ALTER TABLE skin ADD COLUMN detail_error TEXT DEFAULT ''");
  }
  if (!columns.has("detail_attempts")) {
    db.exec("ALTER TABLE skin ADD COLUMN detail_attempts INTEGER DEFAULT 0");
  }
  if (!columns.has("goods_icon_url")) {
    db.exec("ALTER TABLE skin ADD COLUMN goods_icon_url TEXT DEFAULT ''");
  }
  if (!columns.has("goods_original_icon_url")) {
    db.exec("ALTER TABLE skin ADD COLUMN goods_original_icon_url TEXT DEFAULT ''");
  }
  if (!columns.has("goods_share_thumbnail_url")) {
    db.exec("ALTER TABLE skin ADD COLUMN goods_share_thumbnail_url TEXT DEFAULT ''");
  }
}

function summarizeError(err) {
  const text = asString(err && err.message ? err.message : err).trim();
  return text || "detail_enrichment_failed";
}

function createDetailStatsSnapshot(db, extra = {}) {
  const missingRow = db.prepare(`
    SELECT COUNT(*) AS count
    FROM skin
    WHERE TRIM(COALESCE(collection, '')) = '' OR TRIM(COALESCE(rarity, '')) = ''
  `).get();
  const noSupportedPlatformRow = db.prepare(`
    SELECT COUNT(*) AS count
    FROM skin
    WHERE detail_status = 'failed' AND detail_error = 'no_supported_platform_id'
  `).get();
  return {
    families_pending: 0,
    families_ok: 0,
    families_failed: 0,
    rows_filled: 0,
    rows_still_missing: Number(missingRow && missingRow.count || 0) || 0,
    rows_no_supported_platform: Number(noSupportedPlatformRow && noSupportedPlatformRow.count || 0) || 0,
    wear_rows_pending: 0,
    wear_rows_ok: 0,
    wear_rows_failed: 0,
    wear_rows_still_missing: Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM skin
      WHERE TRIM(COALESCE(markethashname, '')) <> ''
        AND (
          minfloat IS NULL
          OR maxfloat IS NULL
          OR wear_range IS NULL
        )
    `).get().count || 0) || 0,
    image_rows_pending: 0,
    image_rows_ok: 0,
    image_rows_failed: 0,
    image_rows_still_missing: Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM skin
      WHERE TRIM(COALESCE(markethashname, '')) <> ''
        AND (
          TRIM(COALESCE(goods_icon_url, '')) = ''
          OR TRIM(COALESCE(goods_original_icon_url, '')) = ''
          OR TRIM(COALESCE(goods_share_thumbnail_url, '')) = ''
        )
    `).get().count || 0) || 0,
    ...extra
  };
}

function collectAlchemyStats(rows) {
  return rows.reduce((acc, row) => {
    const key = asString(row.alchemy_type).trim() || "不能炼金";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function readCurrentSkinStats(db) {
  const rows = db.prepare(`
    SELECT collection, rarity, alchemy_type
    FROM skin
  `).all();
  return {
    missingCollectionOrRarity: rows.filter(
      (row) => !asString(row.collection).trim() || !asString(row.rarity).trim()
    ).length,
    alchemyStats: collectAlchemyStats(rows)
  };
}

function joinCollectionNames(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    for (const name of splitCollectionNamesShared(value)) {
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      out.push(name);
    }
  }
  return out.join(" / ");
}

function pickFirstNonNull(values) {
  for (const value of Array.isArray(values) ? values : []) {
    if (value !== null && value !== undefined) {
      return value;
    }
  }
  return null;
}

function pickMostCommonNonEmpty(values) {
  const counts = new Map();
  for (const raw of Array.isArray(values) ? values : []) {
    const value = asString(raw).trim();
    if (!value) {
      continue;
    }
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  let bestValue = "";
  let bestCount = -1;
  for (const [value, count] of counts.entries()) {
    if (count > bestCount) {
      bestValue = value;
      bestCount = count;
    }
  }
  return bestValue;
}

function pickFirstNonEmpty(values) {
  for (const raw of Array.isArray(values) ? values : []) {
    const value = asString(raw).trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function loadExistingMetadataMaps(db) {
  const rows = db.prepare(
    "SELECT id, markethashname, basemarkethashname, collection, rarity, minfloat, maxfloat, wear_range, goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url FROM skin ORDER BY id"
  ).all();
  const exact = new Map();
  const familyBuckets = new Map();
  for (const row of rows) {
    const metadata = {
      collection: asString(row.collection).trim(),
      rarity: asString(row.rarity).trim(),
      minfloat: normalizeFloat(row.minfloat),
      maxfloat: normalizeFloat(row.maxfloat),
      wear_range: normalizeFloat(row.wear_range),
      goods_icon_url: asString(row.goods_icon_url).trim(),
      goods_original_icon_url: asString(row.goods_original_icon_url).trim(),
      goods_share_thumbnail_url: asString(row.goods_share_thumbnail_url).trim()
    };
    const marketHashName = asString(row.markethashname).trim();
    exact.set(marketHashName, metadata);

    const familyKey = buildSkinFamilyKey(asString(row.basemarkethashname).trim() || marketHashName);
    if (!familyKey) {
      continue;
    }
    if (!familyBuckets.has(familyKey)) {
      familyBuckets.set(familyKey, []);
    }
    familyBuckets.get(familyKey).push(metadata);
  }

  const family = new Map();
  for (const [familyKey, bucket] of familyBuckets.entries()) {
    family.set(familyKey, {
      collection: joinCollectionNames(bucket.map((row) => row.collection)),
      rarity: pickMostCommonNonEmpty(bucket.map((row) => row.rarity)),
      minfloat: pickFirstNonNull(bucket.map((row) => row.minfloat)),
      maxfloat: pickFirstNonNull(bucket.map((row) => row.maxfloat)),
      wear_range: pickFirstNonNull(bucket.map((row) => row.wear_range)),
      goods_icon_url: pickFirstNonEmpty(bucket.map((row) => row.goods_icon_url)),
      goods_original_icon_url: pickFirstNonEmpty(bucket.map((row) => row.goods_original_icon_url)),
      goods_share_thumbnail_url: pickFirstNonEmpty(bucket.map((row) => row.goods_share_thumbnail_url))
    });
  }
  return {exact, family};
}

function reuseExistingMetadata(record, existingMetadata) {
  const exactMap = existingMetadata && existingMetadata.exact instanceof Map
    ? existingMetadata.exact
    : existingMetadata instanceof Map
      ? existingMetadata
      : new Map();
  const familyMap = existingMetadata && existingMetadata.family instanceof Map
    ? existingMetadata.family
    : new Map();
  const current = exactMap.get(record.markethashname) || null;
  const familyKey = buildSkinFamilyKey(record.basemarkethashname || record.markethashname);
  const family = familyMap.get(familyKey) || null;
  return {
    ...record,
    collection: asString((current && current.collection) || (family && family.collection)).trim(),
    rarity: asString((current && current.rarity) || (family && family.rarity)).trim(),
    minfloat: current && current.minfloat !== null && current.minfloat !== undefined
      ? current.minfloat
      : family && family.minfloat !== null && family.minfloat !== undefined
        ? family.minfloat
        : null,
    maxfloat: current && current.maxfloat !== null && current.maxfloat !== undefined
      ? current.maxfloat
      : family && family.maxfloat !== null && family.maxfloat !== undefined
        ? family.maxfloat
        : null,
    wear_range: current && current.wear_range !== null && current.wear_range !== undefined
      ? current.wear_range
        : family && family.wear_range !== null && family.wear_range !== undefined
          ? family.wear_range
          : null,
    goods_icon_url: asString((family && family.goods_icon_url) || (current && current.goods_icon_url)).trim(),
    goods_original_icon_url: asString(
      (family && family.goods_original_icon_url) || (current && current.goods_original_icon_url)
    ).trim(),
    goods_share_thumbnail_url: asString(
      (family && family.goods_share_thumbnail_url) || (current && current.goods_share_thumbnail_url)
    ).trim()
  };
}

function hasSupportedDetailId(record) {
  return Boolean(asString(record && record.buffid).trim());
}

function applyInitialDetailState(record) {
  const out = {
    ...record,
    detail_status: "pending",
    detail_source: "",
    detail_checked_at: null,
    detail_error: "",
    detail_attempts: 0
  };
  const hasCollection = Boolean(asString(record && record.collection).trim());
  const hasRarity = Boolean(asString(record && record.rarity).trim());
  if (hasCollection && hasRarity) {
    out.detail_status = "ok";
    out.detail_source = "existing_metadata";
    return out;
  }
  if (hasSupportedDetailId(record)) {
    out.detail_status = "pending";
    return out;
  }
  out.detail_status = "failed";
  out.detail_error = "no_supported_platform_id";
  return out;
}

function buildTargetRecords(items, options = {}) {
  const existingMetadata = options.existingMetadata || {exact: new Map(), family: new Map()};
  const parsed = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!isImportableSkin(item)) {
      continue;
    }
    const row = reuseExistingMetadata(parseSkinRecord(item), existingMetadata);
    row.wear_range = normalizeFloat(row.wear_range);
    if (row.wear_range === null) {
      row.wear_range = deriveWearRange(row);
    }
    parsed.push(applyInitialDetailState(row));
  }
  return assignAlchemyTypesShared(parsed, options);
}

async function syncSkinDb({
  dbPath,
  items,
  rarityOrder,
  detailProvider = null,
  logger = null,
  detailConcurrency = 1
} = {}) {
  const db = new DatabaseSync(dbPath);
  let baseStats = null;
  try {
    ensureAlchemyTypeColumn(db);
    ensureSkinDetailColumns(db);
    const existingMetadata = loadExistingMetadataMaps(db);
    const targetRows = buildTargetRecords(items, {existingMetadata, rarityOrder});
    const existingKeys = [...existingMetadata.exact.keys()];
    const targetKeys = targetRows.map((row) => row.markethashname);
    const targetKeySet = new Set(targetKeys);

    const upsert = db.prepare(`
      INSERT INTO skin (
        markethashname, name, basemarkethashname, basename, collection, rarity,
        wearlevel, minfloat, maxfloat, isstattrak, buffid, c5id, youpinid, wear_range, alchemy_type,
        detail_status, detail_source, detail_checked_at, detail_error, detail_attempts,
        goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(markethashname) DO UPDATE SET
        name = excluded.name,
        basemarkethashname = excluded.basemarkethashname,
        basename = excluded.basename,
        collection = excluded.collection,
        rarity = excluded.rarity,
        wearlevel = excluded.wearlevel,
        minfloat = excluded.minfloat,
        maxfloat = excluded.maxfloat,
        isstattrak = excluded.isstattrak,
        buffid = excluded.buffid,
        c5id = excluded.c5id,
        youpinid = excluded.youpinid,
        wear_range = excluded.wear_range,
        alchemy_type = excluded.alchemy_type,
        detail_status = excluded.detail_status,
        detail_source = excluded.detail_source,
        detail_checked_at = excluded.detail_checked_at,
        detail_error = excluded.detail_error,
        detail_attempts = excluded.detail_attempts,
        goods_icon_url = excluded.goods_icon_url,
        goods_original_icon_url = excluded.goods_original_icon_url,
        goods_share_thumbnail_url = excluded.goods_share_thumbnail_url
    `);

    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of targetRows) {
        upsert.run(
          row.markethashname,
          row.name,
          row.basemarkethashname,
          row.basename,
          asString(row.collection).trim(),
          asString(row.rarity).trim(),
          row.wearlevel,
          normalizeFloat(row.minfloat),
          normalizeFloat(row.maxfloat),
          Number(row.isstattrak) ? 1 : 0,
          asString(row.buffid).trim(),
          asString(row.c5id).trim(),
          asString(row.youpinid).trim(),
          normalizeFloat(row.wear_range),
          asString(row.alchemy_type).trim() || "不能炼金",
          asString(row.detail_status).trim() || "pending",
          asString(row.detail_source).trim(),
          row.detail_checked_at,
          asString(row.detail_error).trim(),
          Math.max(0, Math.trunc(Number(row.detail_attempts) || 0)),
          asString(row.goods_icon_url).trim(),
          asString(row.goods_original_icon_url).trim(),
          asString(row.goods_share_thumbnail_url).trim()
        );
      }

      if (targetKeys.length) {
        const placeholders = targetKeys.map(() => "?").join(",");
        db.prepare(`DELETE FROM skin WHERE markethashname NOT IN (${placeholders})`).run(...targetKeys);
      } else {
        db.exec("DELETE FROM skin");
      }

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    baseStats = {
      totalItems: Array.isArray(items) ? items.length : 0,
      importedItems: targetRows.length,
      deleted: existingKeys.filter((key) => !targetKeySet.has(key)).length
    };
  } finally {
    db.close();
  }

  let detailStats;
  if (detailProvider) {
    const service = createSkinDetailEnrichmentService({
      dbPath,
      provider: detailProvider,
      logger,
      concurrency: detailConcurrency,
      rarityOrder,
      imageBaseDelayMs: 1200,
      imageRateLimitBackoffMs: 1500,
      imageRateLimitMaxDelayMs: 15000,
      imageDelayRelaxStepMs: 200,
      imageDelayRelaxAfterSuccesses: 5
    });
    try {
      detailStats = await service.enrichMissingDetails();
    } catch (error) {
      const verifyDb = new DatabaseSync(dbPath, {open: true, readOnly: true});
      try {
        detailStats = createDetailStatsSnapshot(verifyDb, {error: summarizeError(error)});
      } finally {
        verifyDb.close();
      }
    }
  } else {
    const verifyDb = new DatabaseSync(dbPath, {open: true, readOnly: true});
    try {
      detailStats = createDetailStatsSnapshot(verifyDb);
    } finally {
      verifyDb.close();
    }
  }

  const finalDb = new DatabaseSync(dbPath, {open: true, readOnly: true});
  try {
    const finalStats = readCurrentSkinStats(finalDb);
    return {
      ...baseStats,
      ...finalStats,
      detailStats
    };
  } finally {
    finalDb.close();
  }
}

function buildCliOptions(argv = []) {
  const args = Array.isArray(argv) ? [...argv] : [];
  const options = {
    jsonPath: findLatestSteamBaseInfoJson(),
    dbPath: path.resolve(__dirname, "..", "..", "csgo_skins.db")
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = asString(args[i]).trim();
    const next = asString(args[i + 1]).trim();
    if (arg === "--json" && next) {
      options.jsonPath = next;
      i += 1;
      continue;
    }
    if (arg === "--db" && next) {
      options.dbPath = next;
      i += 1;
    }
  }
  return options;
}

function loadItemsFromJson(jsonPath) {
  const filePath = asString(jsonPath).trim();
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`json_not_found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error("json_not_array");
  }
  return data;
}

function findLatestSteamBaseInfoJson(dirPath = DEFAULT_JSON_DIR) {
  const targetDir = asString(dirPath).trim();
  if (!targetDir || !fs.existsSync(targetDir)) {
    return DEFAULT_JSON_PATH;
  }
  const files = fs.readdirSync(targetDir)
    .filter((name) => /^steam_base_info_\d{8}_\d{6}\.json$/i.test(name))
    .sort();
  if (!files.length) {
    return DEFAULT_JSON_PATH;
  }
  return path.join(targetDir, files[files.length - 1]);
}

module.exports = {
  DEFAULT_JSON_PATH,
  isImportableSkin,
  assignAlchemyTypes: assignAlchemyTypesShared,
  syncSkinDb,
  buildCliOptions,
  loadItemsFromJson,
  findLatestSteamBaseInfoJson
};
