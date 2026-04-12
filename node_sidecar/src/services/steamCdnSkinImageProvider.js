const fs = require("node:fs");
const path = require("node:path");

const {parseLocalizationTokens} = require("../xpShopCatalog");
const {asString} = require("../utils");
const {buildSkinFamilyKey} = require("./skinFamilyKey");

const DEFAULT_IMAGE_BASE_URL = "https://community.akamai.steamstatic.com/economy/image";

const MARKET_HEAD_BY_ITEM_CLASS = {
  weapon_ak47: "AK-47",
  weapon_aug: "AUG",
  weapon_awp: "AWP",
  weapon_cz75a: "CZ75-Auto",
  weapon_deagle: "Desert Eagle",
  weapon_elite: "Dual Berettas",
  weapon_famas: "FAMAS",
  weapon_fiveseven: "Five-SeveN",
  weapon_g3sg1: "G3SG1",
  weapon_galilar: "Galil AR",
  weapon_glock: "Glock-18",
  weapon_m249: "M249",
  weapon_m4a1: "M4A4",
  weapon_m4a1_silencer: "M4A1-S",
  weapon_mac10: "MAC-10",
  weapon_mag7: "MAG-7",
  weapon_mp5sd: "MP5-SD",
  weapon_mp7: "MP7",
  weapon_mp9: "MP9",
  weapon_negev: "Negev",
  weapon_nova: "Nova",
  weapon_hkp2000: "P2000",
  weapon_p250: "P250",
  weapon_p90: "P90",
  weapon_bizon: "PP-Bizon",
  weapon_revolver: "R8 Revolver",
  weapon_sawedoff: "Sawed-Off",
  weapon_scar20: "SCAR-20",
  weapon_sg556: "SG 553",
  weapon_ssg08: "SSG 08",
  weapon_tec9: "Tec-9",
  weapon_ump45: "UMP-45",
  weapon_usp_silencer: "USP-S",
  weapon_xm1014: "XM1014",
  weapon_taser: "Zeus x27",
  weapon_bayonet: "Bayonet",
  weapon_knife_css: "Classic Knife",
  weapon_knife_flip: "Flip Knife",
  weapon_knife_gut: "Gut Knife",
  weapon_knife_karambit: "Karambit",
  weapon_knife_m9_bayonet: "M9 Bayonet",
  weapon_knife_tactical: "Huntsman Knife",
  weapon_knife_falchion: "Falchion Knife",
  weapon_knife_survival_bowie: "Bowie Knife",
  weapon_knife_butterfly: "Butterfly Knife",
  weapon_knife_push: "Shadow Daggers",
  weapon_knife_cord: "Paracord Knife",
  weapon_knife_canis: "Survival Knife",
  weapon_knife_ursus: "Ursus Knife",
  weapon_knife_gypsy_jackknife: "Navaja Knife",
  weapon_knife_outdoor: "Nomad Knife",
  weapon_knife_stiletto: "Stiletto Knife",
  weapon_knife_widowmaker: "Talon Knife",
  weapon_knife_skeleton: "Skeleton Knife",
  weapon_knife_kukri: "Kukri Knife",
  studded_bloodhound_gloves: "Bloodhound Gloves",
  studded_brokenfang_gloves: "Broken Fang Gloves",
  slick_gloves: "Driver Gloves",
  leather_handwraps: "Hand Wraps",
  studded_hydra_gloves: "Hydra Gloves",
  motorcycle_gloves: "Moto Gloves",
  specialist_gloves: "Specialist Gloves",
  sporty_gloves: "Sport Gloves"
};

function readUtf8IfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function uniquePaths(values = []) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = asString(value).trim();
    if (!normalized) {
      continue;
    }
    const resolved = path.resolve(normalized);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}

function resolveDefaultSourcePaths({
  itemsGamePath = process.env.CS2_SKIN_IMAGE_ITEMS_GAME_FILE || "",
  englishPath = process.env.CS2_SKIN_IMAGE_ENGLISH_FILE || ""
} = {}) {
  const projectRoot = path.resolve(__dirname, "..", "..", "..");
  const candidateDirs = [
    path.join(projectRoot, "node_sidecar", "tmp"),
    path.join(projectRoot, "tmp"),
    path.resolve(projectRoot, "..", "cs2_armory_delivery", "tmp")
  ];
  const itemsCandidates = uniquePaths([
    itemsGamePath,
    ...candidateDirs.map((dir) => path.join(dir, "items_game.txt"))
  ]);
  const englishCandidates = uniquePaths([
    englishPath,
    ...candidateDirs.map((dir) => path.join(dir, "csgo_english.txt"))
  ]);

  const resolvedItemsGamePath = itemsCandidates.find((filePath) => fs.existsSync(filePath)) || "";
  const resolvedEnglishPath = englishCandidates.find((filePath) => fs.existsSync(filePath)) || "";
  return {
    itemsGamePath: resolvedItemsGamePath,
    englishPath: resolvedEnglishPath
  };
}

function buildPaintNameById(englishText) {
  const tokens = parseLocalizationTokens(asString(englishText));
  const lookup = new Map();
  for (const [tokenName, tokenValue] of tokens.entries()) {
    const match = asString(tokenName).match(/^Paint[Kk]it_(.+)_Tag$/);
    if (!match) {
      continue;
    }
    const paintKitName = asString(match[1]).trim();
    const displayName = asString(tokenValue).trim();
    if (!paintKitName || !displayName || lookup.has(paintKitName)) {
      continue;
    }
    lookup.set(paintKitName, displayName);
  }
  return lookup;
}

function buildIconPathLookup(itemsGameText, englishText) {
  const paintNames = buildPaintNameById(englishText);
  const lookup = new Map();
  const pattern = /"\[([^\]]+)\]([^"]+)"\s+"1"/g;
  let match = null;
  while ((match = pattern.exec(asString(itemsGameText))) !== null) {
    const paintKitName = asString(match[1]).trim();
    const itemClass = asString(match[2]).trim();
    const marketHead = MARKET_HEAD_BY_ITEM_CLASS[itemClass];
    const paintName = paintNames.get(paintKitName);
    if (!paintKitName || !marketHead || !paintName) {
      continue;
    }
    const familyKey = buildSkinFamilyKey(`${marketHead} | ${paintName}`);
    if (!familyKey || lookup.has(familyKey)) {
      continue;
    }
    lookup.set(familyKey, `econ/default_generated/${itemClass}_${paintKitName}_light_large`);
  }
  return lookup;
}

function buildImageInfo(imageUrl) {
  const normalized = asString(imageUrl).trim();
  return {
    goods_icon_url: normalized,
    goods_original_icon_url: normalized,
    goods_share_thumbnail_url: normalized
  };
}

function buildSteamImageUrl(iconPath, imageBaseUrl = DEFAULT_IMAGE_BASE_URL) {
  const baseUrl = asString(imageBaseUrl).trim() || DEFAULT_IMAGE_BASE_URL;
  const normalizedIconPath = asString(iconPath).trim().replace(/^\/+/, "");
  if (!normalizedIconPath) {
    return "";
  }
  return `${baseUrl}/${normalizedIconPath}`;
}

function createSteamCdnSkinImageProvider({
  itemsGameText = "",
  englishText = "",
  itemsGamePath = "",
  englishPath = "",
  imageBaseUrl = DEFAULT_IMAGE_BASE_URL
} = {}) {
  let iconPathLookup = null;

  function ensureLookup() {
    if (iconPathLookup) {
      return iconPathLookup;
    }
    const resolvedSources = resolveDefaultSourcePaths({
      itemsGamePath,
      englishPath
    });
    const finalItemsGameText = asString(itemsGameText) || readUtf8IfExists(resolvedSources.itemsGamePath);
    const finalEnglishText = asString(englishText) || readUtf8IfExists(resolvedSources.englishPath);
    iconPathLookup = buildIconPathLookup(finalItemsGameText, finalEnglishText);
    return iconPathLookup;
  }

  async function fetchGoodsImage(context = {}) {
    const familyKey = buildSkinFamilyKey(
      asString(context && context.baseMarketHashName).trim()
      || asString(context && context.marketHashName).trim()
      || asString(context && context.familyKey).trim()
      || asString(context).trim()
    );
    if (!familyKey) {
      throw new Error("steam icon path unavailable");
    }
    const iconPath = ensureLookup().get(familyKey) || "";
    const imageUrl = buildSteamImageUrl(iconPath, imageBaseUrl);
    if (!imageUrl) {
      throw new Error("steam icon path unavailable");
    }
    return buildImageInfo(imageUrl);
  }

  return {
    fetchGoodsImage
  };
}

module.exports = {
  buildSteamImageUrl,
  createSteamCdnSkinImageProvider
};
