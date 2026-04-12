const fs = require("node:fs");
const path = require("node:path");

const {asString} = require("../utils");

const CATEGORY_FILE_NAMES = [
  "stickers.json",
  "graffiti.json",
  "patches.json",
  "agents.json",
  "music_kits.json",
  "collectibles.json",
  "keychains.json",
  "tools.json",
  "crates.json",
  "keys.json",
  "highlights.json",
  "sticker_slabs.json"
];

function normalizeLookupKey(value) {
  return asString(value).trim().toLowerCase();
}

function buildImageInfo(imageUrl) {
  const normalized = asString(imageUrl).trim();
  return {
    goods_icon_url: normalized,
    goods_original_icon_url: normalized,
    goods_share_thumbnail_url: normalized
  };
}

function readJsonArrayIfExists(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function uniqueExistingDirs(values = []) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = asString(value).trim();
    if (!normalized) {
      continue;
    }
    const resolved = path.resolve(normalized);
    if (seen.has(resolved) || !fs.existsSync(resolved)) {
      continue;
    }
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}

function resolveDefaultSourceDirs({sourceDir = ""} = {}) {
  const projectRoot = path.resolve(__dirname, "..", "..", "..");
  return uniqueExistingDirs([
    sourceDir,
    process.env.CS2_STATIC_ITEM_IMAGE_SOURCE_DIR,
    path.join(projectRoot, ".tmp_upstream", "3c2eb_categories"),
    path.join(projectRoot, ".tmp_upstream", "CSGO-API", "public", "api", "en")
  ]);
}

function buildLookup(sourceDirs) {
  const lookup = new Map();
  for (const sourceDir of sourceDirs) {
    for (const fileName of CATEGORY_FILE_NAMES) {
      const filePath = path.join(sourceDir, fileName);
      if (!fs.existsSync(filePath)) {
        continue;
      }
      for (const item of readJsonArrayIfExists(filePath)) {
        const marketHashName = asString(item && item.name).trim();
        const imageUrl = asString(item && item.image).trim();
        const key = normalizeLookupKey(marketHashName);
        if (!marketHashName || !imageUrl || !key || lookup.has(key)) {
          continue;
        }
        lookup.set(key, imageUrl);
      }
    }
  }
  return lookup;
}

function createLocalStaticItemImageProvider({
  sourceDir = "",
  sourceDirs = []
} = {}) {
  let lookup = null;

  function ensureLookup() {
    if (lookup) {
      return lookup;
    }
    lookup = buildLookup(uniqueExistingDirs([
      ...resolveDefaultSourceDirs({sourceDir}),
      ...sourceDirs
    ]));
    return lookup;
  }

  async function fetchGoodsImage(context = {}) {
    const candidates = [
      asString(context && context.marketHashName).trim(),
      asString(context && context.baseMarketHashName).trim(),
      asString(context && context.familyKey).trim(),
      asString(context).trim()
    ];
    const map = ensureLookup();
    for (const candidate of candidates) {
      const key = normalizeLookupKey(candidate);
      const imageUrl = key ? map.get(key) : "";
      if (imageUrl) {
        return buildImageInfo(imageUrl);
      }
    }
    throw new Error("local static image unavailable");
  }

  return {
    fetchGoodsImage
  };
}

module.exports = {
  createLocalStaticItemImageProvider
};
