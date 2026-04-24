/**
 * steamMarketService.js — Steam Community Market 交易服务
 *
 * 上架出售、价格查询、买卖价格互算。
 */

"use strict";

const SteamCommunity = require("steamcommunity");
const { generateConfirmationKey, getServerTime } = require("./maFileParser");
const { withTimeout, sleep, asString } = require("./utils");
const { enhanceCookieString, buildSteamHeaders, steamPost, steamGet } = require("./steamHttpClient");

// ─── 费率计算 ───────────────────────────────────────────

/**
 * 卖家到手价 → 买家支付价（含 Steam 10% + 游戏 5% 手续费）
 * @param {number} sellerReceiveCents 卖家到手（分）
 * @returns {number} 买家需支付（分）
 */
function calculateBuyerPrice(sellerReceiveCents) {
  let steamFee = Math.floor(sellerReceiveCents * 0.1);
  if (steamFee < 1) steamFee = 1;
  let gameFee = Math.floor(sellerReceiveCents * 0.05);
  if (gameFee < 1) gameFee = 1;
  return sellerReceiveCents + steamFee + gameFee;
}

/**
 * 买家支付价 → 卖家最高到手价（反推）
 * @param {number} buyerPayCents 买家支付（分）
 * @returns {number} 卖家到手（分）
 */
function calculateSellerPrice(buyerPayCents) {
  for (let base = Math.floor(buyerPayCents / 1.15) - 2; base <= buyerPayCents; base++) {
    if (base <= 0) continue;
    if (calculateBuyerPrice(base) >= buyerPayCents) {
      return calculateBuyerPrice(base) === buyerPayCents ? base : base - 1;
    }
  }
  return Math.max(1, Math.floor(buyerPayCents / 1.15));
}

// ─── 市场 API ───────────────────────────────────────────

/**
 * 上架出售物品
 * @param {Object} opts
 * @param {string} opts.cookieString
 * @param {string} opts.sessionid
 * @param {string} opts.steamId64
 * @param {string|number} opts.assetId
 * @param {number} opts.priceInCents  卖家到手价（分）
 * @param {number} opts.currency      1=USD, 23=CNY
 * @returns {Promise<{success:boolean, message:string, requiresConfirmation:boolean}>}
 */
async function sellItem({ cookieString, sessionid, steamId64, assetId, priceInCents, currency }) {
  const enhanced = enhanceCookieString(cookieString, { steamId64, domain: "community" });
  const referer = `https://steamcommunity.com/profiles/${steamId64}/inventory/`;
  const headers = buildSteamHeaders({ cookieString: enhanced, sessionid, steamId64, referer });

  const body = new URLSearchParams({
    sessionid,
    appid: "730",
    contextid: "2",
    assetid: String(assetId),
    amount: "1",
    price: String(priceInCents),
    currency: String(currency),
  }).toString();

  const res = await steamPost({ url: "https://steamcommunity.com/market/sellitem/", body, headers });

  const json = res.json;
  if (!json) {
    return { success: false, message: "响应解析失败", requiresConfirmation: false };
  }

  return {
    success: !!json.success,
    message: json.message || (json.success ? "上架成功" : "上架失败"),
    requiresConfirmation: !!json.requires_confirmation,
  };
}

/**
 * 查询市场价格概览（公开 API，无需 cookie）
 * @param {Object} opts
 * @param {string} opts.marketHashName
 * @param {number} opts.currency  1=USD, 23=CNY
 * @returns {Promise<{success:boolean, lowestPrice?:string, medianPrice?:string, volume?:string, message?:string}>}
 */
async function getPriceOverview({ marketHashName, currency }) {
  const url =
    `https://steamcommunity.com/market/priceoverview/` +
    `?appid=730&currency=${currency}&market_hash_name=${encodeURIComponent(marketHashName)}`;

  let res;
  try {
    res = await steamGet({ url });
  } catch (err) {
    return { success: false, message: `请求失败: ${err.message}` };
  }

  const json = res.json;
  if (!json || !json.success) {
    return { success: false, message: (json && json.message) || "Steam 返回失败" };
  }

  return {
    success: true,
    lowestPrice: json.lowest_price || null,
    medianPrice: json.median_price || null,
    volume: json.volume || null,
  };
}

// ─── 市场确认 ─────────────────────────────────────────────

const MARKET_CONFIRM_TIMEOUT_MS = 15000;
const MARKET_LISTING_TYPE = 3; // SteamCommunity confirmation type for MarketListing

/**
 * 获取所有待确认的市场上架项
 * @param {Object} opts
 * @param {string} opts.cookieString
 * @param {string} opts.identitySecret
 * @returns {Promise<Array<{id:string, key:string, creator:string, title:string, description:string, icon:string, type:number|string}>>}
 */
async function getMarketConfirmations({ cookieString, identitySecret }) {
  if (!identitySecret) {
    throw new Error("identity_secret 为空，无法获取市场确认");
  }

  const community = new SteamCommunity();
  const cookies = cookieString.split("; ").map((c) => c.trim()).filter(Boolean);
  community.setCookies(cookies);

  return withTimeout(new Promise((resolve, reject) => {
    const time = getServerTime();
    const confKey = generateConfirmationKey(identitySecret, "conf", time);

    community.getConfirmations(time, confKey.key, (err, confirmations) => {
      if (err) {
        reject(err);
        return;
      }
      if (!Array.isArray(confirmations) || confirmations.length === 0) {
        resolve([]);
        return;
      }

      // 过滤 MarketListing 类型（兼容数字 3 和字符串 "MarketListing"）
      const marketItems = confirmations.filter((c) => {
        return c.type === MARKET_LISTING_TYPE
          || c.type === "MarketListing"
          || String(c.type) === String(MARKET_LISTING_TYPE);
      });

      resolve(marketItems.map((c) => ({
        id: asString(c.id || ""),
        key: asString(c.key || ""),
        creator: asString(c.creator || ""),
        title: asString(c.title || ""),
        description: asString(c.description || ""),
        icon: asString(c.icon || ""),
        type: c.type,
      })));
    });
  }), MARKET_CONFIRM_TIMEOUT_MS, "获取市场确认列表超时");
}

/**
 * 批量确认指定的市场上架项
 * @param {Object} opts
 * @param {string} opts.cookieString
 * @param {string} opts.identitySecret
 * @param {Array<string>} opts.confirmationIds — 要确认的 confirmation id 数组
 * @returns {Promise<{results: Array<{id:string, success:boolean, message:string}>}>}
 */
async function confirmMarketListings({ cookieString, identitySecret, confirmationIds }) {
  if (!identitySecret) {
    throw new Error("identity_secret 为空，无法确认市场上架");
  }
  if (!Array.isArray(confirmationIds) || confirmationIds.length === 0) {
    return { results: [] };
  }

  const community = new SteamCommunity();
  const cookies = cookieString.split("; ").map((c) => c.trim()).filter(Boolean);
  community.setCookies(cookies);

  // 拉取完整确认列表
  const confirmations = await withTimeout(new Promise((resolve, reject) => {
    const time = getServerTime();
    const confKey = generateConfirmationKey(identitySecret, "conf", time);

    community.getConfirmations(time, confKey.key, (err, list) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(Array.isArray(list) ? list : []);
    });
  }), MARKET_CONFIRM_TIMEOUT_MS, "拉取确认列表超时");

  const results = [];
  const idSet = new Set(confirmationIds.map((id) => asString(id).trim()));

  for (const confId of idSet) {
    const target = confirmations.find((c) => asString(c.id || "").trim() === confId);
    if (!target) {
      results.push({ id: confId, success: false, message: "确认列表中未找到该项" });
      continue;
    }

    try {
      await withTimeout(new Promise((resolve, reject) => {
        const allowTime = getServerTime();
        const allowKey = generateConfirmationKey(identitySecret, "allow", allowTime);

        target.respond(allowTime, allowKey.key, true, (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      }), MARKET_CONFIRM_TIMEOUT_MS, "确认市场上架超时");

      results.push({ id: confId, success: true, message: "确认成功" });
    } catch (err) {
      results.push({ id: confId, success: false, message: err.message || String(err) });
    }

    // 逐个确认之间间隔 1 秒（最后一个不等）
    if (results.length < idSet.size) {
      await sleep(1000);
    }
  }

  return { results };
}

// ─── 导出 ───────────────────────────────────────────────

module.exports = {
  sellItem,
  getPriceOverview,
  calculateBuyerPrice,
  calculateSellerPrice,
  getMarketConfirmations,
  confirmMarketListings,
};
