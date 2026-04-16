const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TMP_DIR = path.resolve(__dirname, "..", "tmp");
const DEFAULT_ITEMS_GAME_FILE = path.join(DEFAULT_TMP_DIR, "items_game.txt");
const DEFAULT_SCHINESE_FILE = path.join(DEFAULT_TMP_DIR, "csgo_schinese.txt");
const DEFAULT_ENGLISH_FILE = path.join(DEFAULT_TMP_DIR, "csgo_english.txt");

let cachedCatalog = null;
let cachedSignature = "";

function fileSignature(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${filePath}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  } catch {
    return `${filePath}:missing`;
  }
}

function resolveCatalogSourcePaths({
  itemsGamePath = process.env.CS2_XP_SHOP_ITEMS_GAME_FILE || DEFAULT_ITEMS_GAME_FILE,
  schinesePath = process.env.CS2_XP_SHOP_SCHINESE_FILE || DEFAULT_SCHINESE_FILE,
  englishPath = process.env.CS2_XP_SHOP_ENGLISH_FILE || DEFAULT_ENGLISH_FILE
} = {}) {
  return {
    items_game_file: path.resolve(itemsGamePath),
    schinese_file: path.resolve(schinesePath),
    english_file: path.resolve(englishPath)
  };
}

function readUtf8IfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function countChar(text, char) {
  let count = 0;
  for (const next of text) {
    if (next === char) {
      count += 1;
    }
  }
  return count;
}

function findNextBraceIndex(lines, startIndex) {
  for (let index = Math.max(0, Number(startIndex) || 0); index < lines.length; index += 1) {
    if (lines[index].includes("{")) {
      return index;
    }
  }
  return -1;
}

function parseKeyValueBlock(lines, openIndex) {
  const fields = {};
  let depth = 1;
  let index = openIndex + 1;

  while (index < lines.length && depth > 0) {
    const trimmed = lines[index].trim();
    const pairMatch = trimmed.match(/^"([^"]+)"\s+"([^"]*)"$/);
    if (depth === 1 && pairMatch) {
      fields[pairMatch[1]] = pairMatch[2];
    }
    depth += countChar(lines[index], "{");
    depth -= countChar(lines[index], "}");
    index += 1;
  }

  return {
    fields,
    endIndex: Math.max(openIndex, index - 1)
  };
}

function normalizeOptionalInt(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const normalized = Number(value);
  return Number.isInteger(normalized) ? normalized : null;
}

function normalizeCalloutToken(callout) {
  const normalized = typeof callout === "string" ? callout.trim() : "";
  if (!normalized) {
    return "";
  }
  return normalized.startsWith("#") ? normalized.slice(1) : normalized;
}

function normalizeCatalogEntry(rawEntry) {
  return {
    campaign_id: Number(rawEntry.campaign_id || 0),
    shop_index: Number(rawEntry.shop_index || 0),
    points: Number(rawEntry.points || 0),
    item_name: typeof rawEntry.item_name === "string" ? rawEntry.item_name : "",
    callout: typeof rawEntry.callout === "string" ? rawEntry.callout : "",
    callout_token: normalizeCalloutToken(rawEntry.callout),
    ui_order: normalizeOptionalInt(rawEntry.ui_order),
    ui_image_thumbnail: typeof rawEntry.ui_image_thumbnail === "string" ? rawEntry.ui_image_thumbnail : "",
    ui_set_image: typeof rawEntry.ui_set_image === "string" ? rawEntry.ui_set_image : "",
    item_name_groups: typeof rawEntry.item_name_groups === "string" ? rawEntry.item_name_groups : "",
    flags: normalizeOptionalInt(rawEntry.flags),
    limited_until: normalizeOptionalInt(rawEntry.limited_until),
    ui_show_new_tag: normalizeOptionalInt(rawEntry.ui_show_new_tag),
    bidding_cycle: normalizeOptionalInt(rawEntry.bidding_cycle),
    bidding_close: normalizeOptionalInt(rawEntry.bidding_close),
    bidding_pause: normalizeOptionalInt(rawEntry.bidding_pause),
    bidding_batch: normalizeOptionalInt(rawEntry.bidding_batch)
  };
}

function parseCampaignXpShopEntries(lines, campaignId, openIndex) {
  const entries = [];
  let depth = 1;
  let index = openIndex + 1;
  let isXpShopCampaign = false;

  while (index < lines.length && depth > 0) {
    const trimmed = lines[index].trim();

    if (depth === 1 && /^"redeemable_goods"\s+"xpshop"$/.test(trimmed)) {
      isXpShopCampaign = true;
      index += 1;
      continue;
    }

    if (depth === 1 && isXpShopCampaign && /^"operational_point_redeemable"$/.test(trimmed)) {
      const rewardOpenIndex = findNextBraceIndex(lines, index + 1);
      if (rewardOpenIndex < 0) {
        break;
      }
      const reward = parseKeyValueBlock(lines, rewardOpenIndex);
      entries.push(normalizeCatalogEntry({
        campaign_id: campaignId,
        shop_index: entries.length,
        ...reward.fields
      }));
      index = reward.endIndex + 1;
      continue;
    }

    depth += countChar(lines[index], "{");
    depth -= countChar(lines[index], "}");
    index += 1;
  }

  return {
    entries,
    endIndex: Math.max(openIndex, index - 1)
  };
}

function parseItemsGameXpShopCatalog(text) {
  if (typeof text !== "string" || !text.includes("\"redeemable_goods\"")) {
    return [];
  }

  const lines = text.split(/\r?\n/);
  const entries = [];
  const seenCampaigns = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^"redeemable_goods"\s+"xpshop"$/.test(lines[index].trim())) {
      continue;
    }

    let campaignLineIndex = -1;
    let campaignId = 0;

    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const campaignMatch = lines[cursor].trim().match(/^"(\d+)"$/);
      if (!campaignMatch) {
        continue;
      }
      campaignLineIndex = cursor;
      campaignId = Number(campaignMatch[1]);
      break;
    }

    if (campaignLineIndex < 0) {
      continue;
    }

    const campaignOpenIndex = findNextBraceIndex(lines, campaignLineIndex + 1);
    const campaignKey = `${campaignId}:${campaignOpenIndex}`;
    if (campaignOpenIndex < 0 || seenCampaigns.has(campaignKey)) {
      continue;
    }

    const campaign = parseCampaignXpShopEntries(lines, campaignId, campaignOpenIndex);
    seenCampaigns.add(campaignKey);
    entries.push(...campaign.entries);
  }

  return entries;
}

function parseLocalizationTokens(text, tokenNames = []) {
  if (typeof text !== "string" || !text.trim()) {
    return new Map();
  }
  const wanted = new Set(
    Array.from(tokenNames)
      .map((token) => (typeof token === "string" ? token.trim() : ""))
      .filter(Boolean)
  );
  const tokens = new Map();

  for (const line of text.split(/\r?\n/)) {
    const pairMatch = line.trim().match(/^"([^"]+)"\s+"([^"]*)"$/);
    if (!pairMatch) {
      continue;
    }
    const key = pairMatch[1];
    if (!wanted.size || wanted.has(key)) {
      tokens.set(key, pairMatch[2]);
    }
  }

  return tokens;
}

function buildCatalogEntryLookup(entries) {
  const lookup = new Map();
  for (const entry of entries) {
    lookup.set(`${entry.campaign_id}:${entry.shop_index}`, entry);
  }
  return lookup;
}

function cloneCatalogEntry(entry) {
  return entry ? {...entry} : null;
}

function loadLocalXpShopCatalog(options = {}) {
  const source = resolveCatalogSourcePaths(options);
  const signature = [
    fileSignature(source.items_game_file),
    fileSignature(source.schinese_file),
    fileSignature(source.english_file)
  ].join("|");

  if (cachedCatalog && cachedSignature === signature) {
    return cachedCatalog;
  }

  const itemsGameText = readUtf8IfExists(source.items_game_file);
  const baseEntries = parseItemsGameXpShopCatalog(itemsGameText);
  const tokenNames = new Set(baseEntries.map((entry) => entry.callout_token).filter(Boolean));
  const schineseTokens = parseLocalizationTokens(readUtf8IfExists(source.schinese_file), tokenNames);
  const englishTokens = parseLocalizationTokens(readUtf8IfExists(source.english_file), tokenNames);
  const entries = baseEntries.map((entry) => {
    const calloutToken = entry.callout_token;
    const displayNameSchinese = calloutToken ? (schineseTokens.get(calloutToken) || "") : "";
    const displayNameEnglish = calloutToken ? (englishTokens.get(calloutToken) || "") : "";
    return {
      ...entry,
      display_name: displayNameSchinese || displayNameEnglish || entry.item_name,
      display_name_schinese: displayNameSchinese,
      display_name_english: displayNameEnglish
    };
  });

  cachedSignature = signature;
  cachedCatalog = {
    loaded: entries.length > 0,
    source,
    entries,
    byCampaignAndShopIndex: buildCatalogEntryLookup(entries)
  };
  return cachedCatalog;
}

function findCatalogEntry(catalog, campaignId, shopIndex) {
  if (!catalog || !catalog.byCampaignAndShopIndex) {
    return null;
  }
  return catalog.byCampaignAndShopIndex.get(`${Number(campaignId) || 0}:${Number(shopIndex) || 0}`) || null;
}

module.exports = {
  cloneCatalogEntry,
  findCatalogEntry,
  loadLocalXpShopCatalog,
  parseItemsGameXpShopCatalog,
  parseLocalizationTokens,
  resolveCatalogSourcePaths
};
