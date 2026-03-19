const fs = require("node:fs");
const path = require("node:path");
const {DatabaseSync} = require("node:sqlite");
const {asString} = require("./utils");

const DEFAULT_JSON_DIR = "C:/Users/18220/Desktop/smelter/data";
const DEFAULT_JSON_PATH = "C:/Users/18220/Desktop/smelter/data/steam_base_info_20260315_232059.json";

const WEAR_SUFFIX_MAP = [
  {cn: "崭新出厂", en: "Factory New"},
  {cn: "略有磨损", en: "Minimal Wear"},
  {cn: "久经沙场", en: "Field-Tested"},
  {cn: "破损不堪", en: "Well-Worn"},
  {cn: "战痕累累", en: "Battle-Scarred"}
];

const DEFAULT_RARITY_RANKS = new Map([
  ["消费级", 1],
  ["白", 1],
  ["工业级", 2],
  ["浅蓝", 2],
  ["军规级", 3],
  ["蓝", 3],
  ["受限", 4],
  ["紫", 4],
  ["保密", 5],
  ["粉", 5],
  ["隐秘", 6],
  ["红", 6],
  ["金", 7],
  ["金色", 7],
  ["违禁", 7]
]);

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

const COLLECTION_NAME_ALIASES = new Map([
  ["cs:go weapon case", "CS:GO Weapon Case"],
  ["反恐精英武器箱", "CS:GO Weapon Case"],
  ["cs:go weapon case 2", "CS:GO Weapon Case 2"],
  ["反恐精英 2 号武器箱", "CS:GO Weapon Case 2"],
  ["cs:go weapon case 3", "CS:GO Weapon Case 3"],
  ["反恐精英 3 号武器箱", "CS:GO Weapon Case 3"],
  ["operation bravo case", "Operation Bravo Case"],
  ["“英勇大行动”武器箱", "Operation Bravo Case"],
  ["operation phoenix weapon case", "Operation Phoenix Weapon Case"],
  ["“凤凰大行动”武器箱", "Operation Phoenix Weapon Case"],
  ["operation vanguard weapon case", "Operation Vanguard Weapon Case"],
  ["“先锋大行动”武器箱", "Operation Vanguard Weapon Case"],
  ["revolver case", "Revolver Case"],
  ["左轮武器箱", "Revolver Case"],
  ["winter offensive weapon case", "Winter Offensive Weapon Case"],
  ["冬季攻势武器箱", "Winter Offensive Weapon Case"],
  ["esports 2013 case", "eSports 2013 Case"],
  ["电竞 2013 武器箱", "eSports 2013 Case"],
  ["esports 2013 winter case", "eSports 2013 Winter Case"],
  ["电竞 2013 冬季武器箱", "eSports 2013 Winter Case"],
  ["esports 2014 summer case", "eSports 2014 Summer Case"],
  ["电竞 2014 夏季武器箱", "eSports 2014 Summer Case"],
  ["chroma case", "Chroma Case"],
  ["幻彩武器箱", "Chroma Case"],
  ["chroma 2 case", "Chroma 2 Case"],
  ["幻彩 2 号武器箱", "Chroma 2 Case"],
  ["chroma 3 case", "Chroma 3 Case"],
  ["幻彩 3 号武器箱", "Chroma 3 Case"],
  ["gamma case", "Gamma Case"],
  ["伽玛武器箱", "Gamma Case"],
  ["gamma 2 case", "Gamma 2 Case"],
  ["伽玛 2 号武器箱", "Gamma 2 Case"],
  ["spectrum case", "Spectrum Case"],
  ["光谱武器箱", "Spectrum Case"],
  ["spectrum 2 case", "Spectrum 2 Case"],
  ["光谱 2 号武器箱", "Spectrum 2 Case"],
  ["prisma case", "Prisma Case"],
  ["棱彩武器箱", "Prisma Case"],
  ["prisma 2 case", "Prisma 2 Case"],
  ["棱彩2号武器箱", "Prisma 2 Case"],
  ["horizon case", "Horizon Case"],
  ["地平线武器箱", "Horizon Case"],
  ["danger zone case", "Danger Zone Case"],
  ["命悬一线武器箱", "Danger Zone Case"],
  ["dreams & nightmares case", "Dreams & Nightmares Case"],
  ["梦魇武器箱", "Dreams & Nightmares Case"],
  ["operation riptide case", "Operation Riptide Case"],
  ["“激流大行动”武器箱", "Operation Riptide Case"],
  ["recoil case", "Recoil Case"],
  ["反冲武器箱", "Recoil Case"],
  ["snakebite case", "Snakebite Case"],
  ["蛇噬武器箱", "Snakebite Case"],
  ["operation broken fang case", "Operation Broken Fang Case"],
  ["“狂牙大行动”武器箱", "Operation Broken Fang Case"],
  ["fracture case", "Fracture Case"],
  ["裂空武器箱", "Fracture Case"],
  ["shattered web case", "Shattered Web Case"],
  ["“裂网大行动”武器箱", "Shattered Web Case"],
  ["clutch case", "Clutch Case"],
  ["“头号特训”武器箱", "Clutch Case"],
  ["revolution case", "Revolution Case"],
  ["变革武器箱", "Revolution Case"],
  ["glove case", "Glove Case"],
  ["手套武器箱", "Glove Case"],
  ["operation hydra case", "Operation Hydra Case"],
  ["“九头蛇大行动”武器箱", "Operation Hydra Case"],
  ["falchion case", "Falchion Case"],
  ["弯曲猎手武器箱", "Falchion Case"],
  ["huntsman weapon case", "Huntsman Weapon Case"],
  ["猎杀者武器箱", "Huntsman Weapon Case"],
  ["operation breakout weapon case", "Operation Breakout Weapon Case"],
  ["“突围大行动”武器箱", "Operation Breakout Weapon Case"],
  ["operation wildfire case", "Operation Wildfire Case"],
  ["“野火大行动”武器箱", "Operation Wildfire Case"],
  ["shadow case", "Shadow Case"],
  ["暗影武器箱", "Shadow Case"],
  ["cs20 case", "CS20 Case"],
  ["反恐精英20周年武器箱", "CS20 Case"],
  ["fever case", "Fever Case"],
  ["热潮武器箱", "Fever Case"],
  ["gallery case", "Gallery Case"],
  ["画廊武器箱", "Gallery Case"],
  ["kilowatt case", "Kilowatt Case"],
  ["千瓦武器箱", "Kilowatt Case"]
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

function normalizeSkinFamily(text) {
  let out = stripWearSuffix(text, WEAR_SUFFIX_MAP.map((x) => x.en));
  let changed = true;
  while (changed) {
    changed = false;
    const next = asString(out)
      .trim()
      .replace(/^\u2605\s+/, "")
      .replace(/^(Souvenir|StatTrak(?:\u2122)?|Genuine)\s+/i, "")
      .trim();
    if (next !== out) {
      out = next;
      changed = true;
    }
  }
  return asString(out).trim();
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

function joinCollectionNames(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    for (const name of splitCollectionNames(value)) {
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

function loadExistingMetadataMaps(db) {
  const rows = db.prepare(
    "SELECT markethashname, basemarkethashname, collection, rarity, minfloat, maxfloat, wear_range FROM skin"
  ).all();
  const exact = new Map();
  const familyBuckets = new Map();
  for (const row of rows) {
    const metadata = {
      collection: asString(row.collection).trim(),
      rarity: asString(row.rarity).trim(),
      minfloat: normalizeFloat(row.minfloat),
      maxfloat: normalizeFloat(row.maxfloat),
      wear_range: normalizeFloat(row.wear_range)
    };
    const marketHashName = asString(row.markethashname).trim();
    exact.set(marketHashName, metadata);

    const familyKey = normalizeSkinFamily(asString(row.basemarkethashname).trim() || marketHashName);
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
      wear_range: pickFirstNonNull(bucket.map((row) => row.wear_range))
    });
  }
  return {exact, family};
}

function splitCollectionNames(value) {
  return asString(value)
    .split("/")
    .map((name) => normalizeCollectionKey(name))
    .filter(Boolean);
}

function normalizeCollectionKey(name) {
  const raw = asString(name).trim();
  if (!raw) {
    return "";
  }
  return COLLECTION_NAME_ALIASES.get(raw.toLowerCase()) || raw;
}

function assignAlchemyTypes(records, options = {}) {
  const rarityOrder = Array.isArray(options.rarityOrder) ? options.rarityOrder : [];
  const orderMap = rarityOrder.length
    ? new Map(rarityOrder.map((name, index) => [asString(name).trim(), index + 1]))
    : DEFAULT_RARITY_RANKS;
  const out = records.map((row) => ({...row}));
  const byCollection = new Map();

  for (const row of out) {
    const collections = splitCollectionNames(row.collection);
    const rarity = asString(row.rarity).trim();
    if (!collections.length || !rarity || !orderMap.has(rarity)) {
      row.alchemy_type = "不能炼金";
      continue;
    }
    for (const collection of collections) {
      if (!byCollection.has(collection)) {
        byCollection.set(collection, new Set());
      }
      byCollection.get(collection).add(rarity);
    }
  }

  const collectionMeta = new Map();
  for (const [collection, raritySet] of byCollection.entries()) {
    const sorted = [...raritySet].sort((a, b) => orderMap.get(a) - orderMap.get(b));
    collectionMeta.set(collection, {
      top: sorted[sorted.length - 1] || "",
      second: sorted.length > 1 ? sorted[sorted.length - 2] : "",
      hasGoldTop: ["金", "金色", "违禁"].includes(sorted[sorted.length - 1] || "")
    });
  }

  for (const row of out) {
    const collections = splitCollectionNames(row.collection);
    const rarity = asString(row.rarity).trim();
    const metas = collections.map((collection) => collectionMeta.get(collection)).filter(Boolean);
    if (!metas.length || !rarity) {
      row.alchemy_type = "不能炼金";
      continue;
    }
    if (metas.some((meta) => rarity === meta.top)) {
      row.alchemy_type = "不能炼金";
      continue;
    }
    if (metas.some((meta) => meta.hasGoldTop && rarity === meta.second)) {
      row.alchemy_type = "5合1材料";
      continue;
    }
    row.alchemy_type = "10合1";
  }

  return out;
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
  const familyKey = normalizeSkinFamily(record.basemarkethashname || record.markethashname);
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
        : null
  };
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
    parsed.push(row);
  }
  return assignAlchemyTypes(parsed, options);
}

function syncSkinDb({dbPath, items, rarityOrder} = {}) {
  const db = new DatabaseSync(dbPath);
  try {
    ensureAlchemyTypeColumn(db);
    const existingMetadata = loadExistingMetadataMaps(db);
    const targetRows = buildTargetRecords(items, {existingMetadata, rarityOrder});
    const existingKeys = [...existingMetadata.exact.keys()];
    const targetKeys = targetRows.map((row) => row.markethashname);
    const targetKeySet = new Set(targetKeys);

    const upsert = db.prepare(`
      INSERT INTO skin (
        markethashname, name, basemarkethashname, basename, collection, rarity,
        wearlevel, minfloat, maxfloat, isstattrak, buffid, c5id, youpinid, wear_range, alchemy_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        alchemy_type = excluded.alchemy_type
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
          asString(row.alchemy_type).trim() || "不能炼金"
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

    return {
      totalItems: Array.isArray(items) ? items.length : 0,
      importedItems: targetRows.length,
      deleted: existingKeys.filter((key) => !targetKeySet.has(key)).length,
      missingCollectionOrRarity: targetRows.filter((row) => !asString(row.collection).trim() || !asString(row.rarity).trim()).length,
      alchemyStats: targetRows.reduce((acc, row) => {
        const key = asString(row.alchemy_type).trim() || "不能炼金";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})
    };
  } finally {
    db.close();
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
  assignAlchemyTypes,
  syncSkinDb,
  buildCliOptions,
  loadItemsFromJson,
  findLatestSteamBaseInfoJson
};
