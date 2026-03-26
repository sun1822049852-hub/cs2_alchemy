const {asString} = require("../utils");

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

function normalizeCollectionKey(name) {
  const raw = asString(name).trim();
  if (!raw) {
    return "";
  }
  return COLLECTION_NAME_ALIASES.get(raw.toLowerCase()) || raw;
}

function buildRarityOrderMap(rarityOrder = []) {
  return Array.isArray(rarityOrder) && rarityOrder.length
    ? new Map(rarityOrder.map((name, index) => [asString(name).trim(), index + 1]))
    : DEFAULT_RARITY_RANKS;
}

function normalizeRarityRank(value, rarityOrder = []) {
  return buildRarityOrderMap(rarityOrder).get(asString(value).trim()) || 0;
}

function rarityLabelFromRank(rank, rarityOrder = []) {
  const numericRank = Math.trunc(Number(rank) || 0);
  if (numericRank <= 0) {
    return "";
  }
  if (Array.isArray(rarityOrder) && rarityOrder.length) {
    return asString(rarityOrder[numericRank - 1]).trim();
  }
  for (const [label, value] of DEFAULT_RARITY_RANKS.entries()) {
    if (value === numericRank) {
      return label;
    }
  }
  return "";
}

function splitCollectionNames(value) {
  return asString(value)
    .split("/")
    .map((name) => normalizeCollectionKey(name))
    .filter(Boolean);
}

function assignAlchemyTypes(records, options = {}) {
  const rarityOrder = Array.isArray(options.rarityOrder) ? options.rarityOrder : [];
  const orderMap = buildRarityOrderMap(rarityOrder);
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

module.exports = {
  assignAlchemyTypes,
  normalizeCollectionKey,
  normalizeRarityRank,
  rarityLabelFromRank,
  splitCollectionNames,
  DEFAULT_RARITY_RANKS
};
