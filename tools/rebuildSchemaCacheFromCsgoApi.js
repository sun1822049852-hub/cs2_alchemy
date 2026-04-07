const fs = require("node:fs");
const path = require("node:path");
const {isDeepStrictEqual} = require("node:util");

const KNOWN_SCHEMA_CACHE_COMMIT = "3c2eb515004ba400677d898e1ef028d8a50d26d1";
const ITEM_DEF_CATEGORY_ORDER = [
  "crates",
  "keys",
  "patches",
  "stickers",
  "keychains",
  "collectibles",
  "agents",
  "music_kits",
  "graffiti",
  "tools"
];
const ITEM_DEF_DIRECT_PRIORITY_ORDER = [
  "crates",
  "keys",
  "tools",
  "keychains",
  "collectibles",
  "agents",
  "graffiti",
  "stickers",
  "patches",
  "music_kits"
];

const EXCLUDED_WEAPON_DEF_INDEXES = new Set([
  "42",
  "43",
  "44",
  "45",
  "46",
  "47",
  "48",
  "49",
  "57",
  "59",
  "5028",
  "5029"
]);

function asString(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function resolveExistingPath(candidates, fallback) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return fallback;
}

function resolveDefaultSourceDir(rootDir) {
  return resolveExistingPath([
    path.join(rootDir, ".tmp_upstream", "3c2eb_categories"),
    path.join(rootDir, ".tmp_upstream", "CSGO-API", "public", "api", "en")
  ], path.join(rootDir, ".tmp_upstream", "CSGO-API", "public", "api", "en"));
}

function resolveDefaultBaseWeaponsFile(rootDir, sourceDir) {
  return resolveExistingPath([
    path.join(rootDir, ".tmp_upstream", `base_weapons.${KNOWN_SCHEMA_CACHE_COMMIT}.json`),
    path.join(sourceDir, "base_weapons.json")
  ], path.join(sourceDir, "base_weapons.json"));
}

function resolveDefaultSkinsFile(rootDir, sourceDir) {
  return resolveExistingPath([
    path.join(rootDir, ".tmp_upstream", `skins.${KNOWN_SCHEMA_CACHE_COMMIT}.json`),
    path.join(sourceDir, "skins.json")
  ], path.join(sourceDir, "skins.json"));
}

function buildCliOptions(argv = []) {
  const args = Array.isArray(argv) ? [...argv] : [];
  const rootDir = path.resolve(__dirname, "..");
  const options = {
    sourceDir: "",
    baseWeaponsFile: "",
    skinsFile: "",
    outputPath: path.join(rootDir, "tmp", "schema_cache.from_csgo_api.json"),
    verifyPath: ""
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = asString(args[index]).trim();
    const next = asString(args[index + 1]).trim();
    if (arg === "--source-dir" && next) {
      options.sourceDir = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--base-weapons-file" && next) {
      options.baseWeaponsFile = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--skins-file" && next) {
      options.skinsFile = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--out" && next) {
      options.outputPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--verify" && next) {
      options.verifyPath = path.resolve(next);
      index += 1;
    }
  }

  options.sourceDir = options.sourceDir || resolveDefaultSourceDir(rootDir);
  options.baseWeaponsFile = options.baseWeaponsFile || resolveDefaultBaseWeaponsFile(rootDir, options.sourceDir);
  options.skinsFile = options.skinsFile || resolveDefaultSkinsFile(rootDir, options.sourceDir);

  return options;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonArray(filePath) {
  const data = readJsonFile(filePath);
  if (!Array.isArray(data)) {
    throw new Error(`expected JSON array: ${filePath}`);
  }
  return data;
}

function readApiArray(sourceDir, fileName) {
  const filePath = path.join(sourceDir, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`missing API file: ${filePath}`);
  }
  return readJsonArray(filePath);
}

function extractPaintName(name) {
  const raw = asString(name).trim();
  if (!raw) {
    return "";
  }
  const separatorIndex = raw.indexOf(" | ");
  if (separatorIndex < 0) {
    return raw;
  }
  return raw.slice(separatorIndex + 3).trim();
}

function buildWeapons(baseWeapons, skins) {
  const weapons = {};

  for (const item of baseWeapons) {
    const defIndex = asString(item && item.def_index).trim();
    const name = asString(item && item.name).trim();
    if (!defIndex || !name || EXCLUDED_WEAPON_DEF_INDEXES.has(defIndex)) {
      continue;
    }
    weapons[defIndex] = name;
  }

  for (const skin of skins) {
    const weapon = skin && skin.weapon ? skin.weapon : {};
    const weaponId = asString(weapon.weapon_id).trim();
    const weaponName = asString(weapon.name).trim();
    if (!weaponId || !weaponName || weapons[weaponId]) {
      continue;
    }
    weapons[weaponId] = weaponName;
  }

  return weapons;
}

function buildPaints(skins) {
  const paints = {};

  for (const skin of skins) {
    const paintIndex = skin && skin.paint_index;
    if (paintIndex === null || paintIndex === undefined) {
      continue;
    }
    const key = asString(paintIndex).trim();
    const value = extractPaintName(skin && skin.name);
    if (!key || !value || paints[key]) {
      continue;
    }
    paints[key] = value;
  }

  return paints;
}

function buildFirstWinMap(items) {
  const result = {};
  for (const item of items) {
    const defIndex = asString(item && item.def_index).trim();
    const name = asString(item && item.name).trim();
    if (!defIndex || !name || result[defIndex]) {
      continue;
    }
    result[defIndex] = name;
  }
  return result;
}

function buildItemDefsByCategory(sourceDir) {
  const itemDefsByCategory = {};
  for (const category of ITEM_DEF_CATEGORY_ORDER) {
    const items = readApiArray(sourceDir, `${category}.json`);
    itemDefsByCategory[category] = buildFirstWinMap(items);
  }
  return itemDefsByCategory;
}

function buildItemDefs(itemDefsByCategory, priorityOrder = ITEM_DEF_DIRECT_PRIORITY_ORDER) {
  const source = itemDefsByCategory && typeof itemDefsByCategory === "object" ? itemDefsByCategory : {};
  const orderedCategories = [
    ...priorityOrder,
    ...Object.keys(source).filter((category) => !priorityOrder.includes(category))
  ];
  const itemDefs = {};
  for (const category of orderedCategories) {
    const categoryMap = source[category];
    if (!categoryMap || typeof categoryMap !== "object") {
      continue;
    }
    for (const [defIndex, name] of Object.entries(categoryMap)) {
      if (!itemDefs[defIndex] && asString(name).trim()) {
        itemDefs[defIndex] = name;
      }
    }
  }
  return itemDefs;
}

function buildSchemaCacheFromApiDir(sourceDir, options = {}) {
  const baseWeaponsFile = asString(options.baseWeaponsFile).trim() || path.join(sourceDir, "base_weapons.json");
  const skinsFile = asString(options.skinsFile).trim() || path.join(sourceDir, "skins.json");
  const baseWeapons = readJsonArray(baseWeaponsFile);
  const skins = readJsonArray(skinsFile);
  const itemDefsByCategory = buildItemDefsByCategory(sourceDir);
  return {
    weapons: buildWeapons(baseWeapons, skins),
    paints: buildPaints(skins),
    item_defs_by_category: itemDefsByCategory,
    item_defs: buildItemDefs(itemDefsByCategory)
  };
}

function writeSchemaCache(schema, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), {recursive: true});
  fs.writeFileSync(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
}

function summarizeSchema(schema) {
  return {
    weapons: Object.keys(schema && schema.weapons || {}).length,
    paints: Object.keys(schema && schema.paints || {}).length,
    item_defs: Object.keys(schema && schema.item_defs || {}).length
  };
}

function verifySchema(schema, verifyPath) {
  const expected = readJsonFile(verifyPath);
  return {
    matches: isDeepStrictEqual(schema, expected),
    expected: summarizeSchema(expected),
    actual: summarizeSchema(schema)
  };
}

function printSummary(outputPath, summary) {
  console.log("schema_cache 重建完成:");
  console.log(`  输出文件: ${outputPath}`);
  console.log(`  weapons: ${summary.weapons}`);
  console.log(`  paints: ${summary.paints}`);
  console.log(`  item_defs: ${summary.item_defs}`);
}

async function main(argv = process.argv.slice(2)) {
  const options = buildCliOptions(argv);
  const schema = buildSchemaCacheFromApiDir(options.sourceDir, options);
  writeSchemaCache(schema, options.outputPath);
  const summary = summarizeSchema(schema);
  printSummary(options.outputPath, summary);
  console.log(`  item_defs source: ${options.sourceDir}`);
  console.log(`  base_weapons source: ${options.baseWeaponsFile}`);
  console.log(`  skins source: ${options.skinsFile}`);

  if (options.verifyPath) {
    const verification = verifySchema(schema, options.verifyPath);
    console.log(`  verify: ${verification.matches ? "exact match" : "mismatch"}`);
    if (!verification.matches) {
      const actualSummary = JSON.stringify(verification.actual);
      const expectedSummary = JSON.stringify(verification.expected);
      const mismatchSummary = `actual=${actualSummary} expected=${expectedSummary}`;
      throw new Error(
        `schema cache mismatch: ${mismatchSummary}`
      );
    }
  }

  return {
    outputPath: options.outputPath,
    summary
  };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  KNOWN_SCHEMA_CACHE_COMMIT,
  ITEM_DEF_CATEGORY_ORDER,
  ITEM_DEF_DIRECT_PRIORITY_ORDER,
  EXCLUDED_WEAPON_DEF_INDEXES,
  buildCliOptions,
  buildFirstWinMap,
  buildItemDefsByCategory,
  buildItemDefs,
  buildPaints,
  buildSchemaCacheFromApiDir,
  buildWeapons,
  extractPaintName,
  main,
  printSummary,
  summarizeSchema,
  verifySchema,
  writeSchemaCache
};
