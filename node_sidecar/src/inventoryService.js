/**
 * Steam 库存拉取服务
 * 通过 Web Cookie 从 steamcommunity.com 拉取 CS2 库存
 */
const https = require("https");
const {asString, sleep} = require("./utils");

const INVENTORY_PAGE_SIZE = 200;
const INVENTORY_TIMEOUT_MS = 15000;
const INVENTORY_MAX_PAGES = 20;
const INVENTORY_PAGE_DELAY_MS = 500;

/**
 * 拉取单页库存
 * @param {object} opts
 * @param {string} opts.steamId64
 * @param {string} opts.cookieString
 * @param {string} [opts.startAssetId] — 翻页起始 assetid
 * @param {string} [opts.language] — 语言，默认 schinese
 * @returns {Promise<object>} Steam 库存 API 原始响应
 */
function fetchInventoryPage({steamId64, cookieString, startAssetId, language}) {
  const lang = asString(language).trim() || "schinese";
  const sid = asString(steamId64).trim();
  let url = `https://steamcommunity.com/inventory/${sid}/730/2?l=${lang}&count=${INVENTORY_PAGE_SIZE}`;
  if (startAssetId) {
    url += `&start_assetid=${asString(startAssetId).trim()}`;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("库存拉取超时")), INVENTORY_TIMEOUT_MS);

    const parsedUrl = new URL(url);
    const req = https.get({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        Cookie: cookieString,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
        Referer: `https://steamcommunity.com/profiles/${sid}/inventory/`
      }
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        clearTimeout(timer);
        if (res.statusCode !== 200) {
          reject(new Error(`库存 API 返回 ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`库存 JSON 解析失败: ${err.message}`));
        }
      });
    });
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * 合并 assets + descriptions
 * @param {object} pageData — Steam 库存 API 单页响应
 * @returns {Array<object>} 合并后的物品列表
 */
function mergeAssetsWithDescriptions(pageData) {
  if (!pageData || typeof pageData !== "object") {
    return [];
  }
  const assets = Array.isArray(pageData.assets) ? pageData.assets : [];
  const descriptions = Array.isArray(pageData.descriptions) ? pageData.descriptions : [];

  // 建立 classid+instanceid → description 映射
  const descMap = new Map();
  for (const desc of descriptions) {
    const key = `${desc.classid}_${desc.instanceid || "0"}`;
    descMap.set(key, desc);
  }

  return assets.map((asset) => {
    const key = `${asset.classid}_${asset.instanceid || "0"}`;
    const desc = descMap.get(key) || {};
    return {
      assetid: asString(asset.assetid).trim(),
      classid: asString(asset.classid).trim(),
      instanceid: asString(asset.instanceid || "0").trim(),
      amount: asString(asset.amount || "1").trim(),
      // 描述字段
      market_hash_name: asString(desc.market_hash_name || "").trim(),
      name: asString(desc.name || "").trim(),
      name_color: asString(desc.name_color || "").trim(),
      icon_url: asString(desc.icon_url || "").trim(),
      tradable: Number(desc.tradable) || 0,
      marketable: Number(desc.marketable) || 0,
      type: asString(desc.type || "").trim(),
      // 标签
      tags: Array.isArray(desc.tags) ? desc.tags.map((t) => ({
        category: asString(t.category || "").trim(),
        internal_name: asString(t.internal_name || "").trim(),
        localized_tag_name: asString(t.localized_tag_name || "").trim()
      })) : []
    };
  });
}

/**
 * 拉取完整库存（自动翻页）
 * @param {object} opts
 * @param {string} opts.steamId64
 * @param {string} opts.cookieString
 * @param {string} [opts.language]
 * @param {function} [opts.onPage] — 每页回调 (pageIndex, items, totalSoFar)
 * @returns {Promise<Array<object>>} 全部物品
 */
async function fetchFullInventory({steamId64, cookieString, language, onPage}) {
  const allItems = [];
  let startAssetId = "";
  let pageIndex = 0;

  while (pageIndex < INVENTORY_MAX_PAGES) {
    const pageData = await fetchInventoryPage({
      steamId64,
      cookieString,
      startAssetId,
      language
    });

    const items = mergeAssetsWithDescriptions(pageData);
    allItems.push(...items);

    if (typeof onPage === "function") {
      onPage(pageIndex, items, allItems.length);
    }

    // 检查是否还有下一页
    const moreItems = Number(pageData.more_items) || 0;
    const lastAssetId = asString(pageData.last_assetid || "").trim();

    if (!moreItems || !lastAssetId) {
      break;
    }

    startAssetId = lastAssetId;
    pageIndex++;

    // 翻页间隔，避免限流
    if (pageIndex < INVENTORY_MAX_PAGES) {
      await sleep(INVENTORY_PAGE_DELAY_MS);
    }
  }

  return allItems;
}

module.exports = {
  fetchInventoryPage,
  mergeAssetsWithDescriptions,
  fetchFullInventory
};
