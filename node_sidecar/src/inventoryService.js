/**
 * Steam 库存拉取服务
 * 通过 Web Cookie 从 steamcommunity.com 拉取 CS2 库存
 */
const https = require("https");
const {asString, sleep} = require("./utils");
const {createProxyAgentForUrl} = require("./proxyConfig");

const INVENTORY_PAGE_SIZE = 200;
const INVENTORY_TIMEOUT_MS = 15000;
const INVENTORY_MAX_PAGES = 20;
const INVENTORY_PAGE_DELAY_MS = 500;

function summarizeCookieString(cookieString) {
  const text = asString(cookieString).trim();
  if (!text) {
    return "cookie=empty";
  }
  const parts = text.split(";").map((item) => item.trim()).filter(Boolean);
  let sessionid = "";
  let hasSteamLoginSecure = false;
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx <= 0) {
      continue;
    }
    const name = part.slice(0, eqIdx);
    const value = part.slice(eqIdx + 1);
    if (name === "sessionid") {
      sessionid = value;
    }
    if (name === "steamLoginSecure") {
      hasSteamLoginSecure = true;
    }
  }
  const maskedSessionid = sessionid ? `${sessionid.slice(0, 8)}...` : "missing";
  return `sessionid=${maskedSessionid}; steamLoginSecure=${hasSteamLoginSecure ? "yes" : "no"}; length=${text.length}`;
}

function buildBodySnippet(body) {
  return asString(body).replace(/\s+/g, " ").trim().slice(0, 200);
}

function emitTrace(onTrace, payload) {
  if (typeof onTrace !== "function" || !payload || typeof payload !== "object") {
    return;
  }
  try {
    onTrace({
      ...payload,
      ts: Date.now()
    });
  } catch (_) {
    // ignore trace sink errors
  }
}

/**
 * 拉取单页库存
 * @param {object} opts
 * @param {string} opts.steamId64
 * @param {string} opts.cookieString
 * @param {string} [opts.startAssetId] — 翻页起始 assetid
 * @param {string} [opts.language] — 语言，默认 schinese
 * @param {number} [opts.pageIndex]
 * @param {function} [opts.onTrace]
 * @returns {Promise<object>} Steam 库存 API 原始响应
 */
function fetchInventoryPage({steamId64, cookieString, startAssetId, language, pageIndex = 0, onTrace}) {
  const lang = asString(language).trim() || "schinese";
  const sid = asString(steamId64).trim();
  let url = `https://steamcommunity.com/inventory/${sid}/730/2?l=${lang}&count=${INVENTORY_PAGE_SIZE}`;
  if (startAssetId) {
    url += `&start_assetid=${asString(startAssetId).trim()}`;
  }
  const traceBase = {
    pageIndex: Number(pageIndex) || 0,
    url,
    steamId64: sid,
    startAssetId: asString(startAssetId).trim(),
    language: lang,
    cookieSummary: summarizeCookieString(cookieString)
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    let req = null;
    const finishReject = (error, tracePayload = {}) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      emitTrace(onTrace, {
        phase: "error",
        ...traceBase,
        ...tracePayload,
        message: asString(error && error.message ? error.message : error).trim() || "unknown_error"
      });
      reject(error);
    };
    const finishResolve = (data, tracePayload = {}) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      emitTrace(onTrace, {
        phase: "response",
        ...traceBase,
        ...tracePayload
      });
      resolve(data);
    };
    const timer = setTimeout(() => {
      const error = new Error("库存拉取超时");
      try {
        if (req && typeof req.destroy === "function") {
          req.destroy(error);
        }
      } catch (_) {
        // ignore destroy errors
      }
      finishReject(error, {
        statusCode: 0,
        bodySnippet: ""
      });
    }, INVENTORY_TIMEOUT_MS);

    const parsedUrl = new URL(url);
    emitTrace(onTrace, {
      phase: "request",
      ...traceBase
    });
    const reqOptions = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        Cookie: cookieString,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
        Referer: `https://steamcommunity.com/profiles/${sid}/inventory/`
      }
    };
    const proxyAgent = createProxyAgentForUrl(url);
    if (proxyAgent) {
      reqOptions.agent = proxyAgent;
    }
    req = https.get(reqOptions, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode !== 200) {
          finishReject(new Error(`库存 API 返回 ${res.statusCode}: ${body.slice(0, 200)}`), {
            statusCode: Number(res.statusCode) || 0,
            bodySnippet: buildBodySnippet(body)
          });
          return;
        }
        try {
          const parsed = JSON.parse(body);
          finishResolve(parsed, {
            statusCode: Number(res.statusCode) || 200,
            bodySnippet: buildBodySnippet(body),
            assetCount: Array.isArray(parsed.assets) ? parsed.assets.length : 0,
            descriptionCount: Array.isArray(parsed.descriptions) ? parsed.descriptions.length : 0,
            moreItems: Number(parsed.more_items) || 0,
            lastAssetId: asString(parsed.last_assetid).trim()
          });
        } catch (err) {
          finishReject(new Error(`库存 JSON 解析失败: ${err.message}`), {
            statusCode: Number(res.statusCode) || 200,
            bodySnippet: buildBodySnippet(body)
          });
        }
      });
    });
    req.on("error", (err) => {
      finishReject(err, {
        statusCode: 0,
        bodySnippet: ""
      });
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
 * @param {function} [opts.onTrace]
 * @returns {Promise<Array<object>>} 全部物品
 */
async function fetchFullInventory({steamId64, cookieString, language, onPage, onTrace}) {
  const allItems = [];
  let startAssetId = "";
  let pageIndex = 0;

  while (pageIndex < INVENTORY_MAX_PAGES) {
    const pageData = await fetchInventoryPage({
      steamId64,
      cookieString,
      startAssetId,
      language,
      pageIndex,
      onTrace
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
