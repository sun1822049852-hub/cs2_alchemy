"use strict";

const { enhanceCookieString, buildSteamHeaders, steamGet } = require("./steamHttpClient");

// ---------------------------------------------------------------------------
// 1. Ban Detection
// ---------------------------------------------------------------------------

const BAN_BATCH_LIMIT = 100;

function throwIfAuthRejected(response) {
  const statusCode = Number(response && response.statusCode) || 0;
  if (statusCode !== 401 && statusCode !== 403) return;
  const error = new Error("Steam 拒绝当前 Web 登录凭据");
  error.code = "refresh_token_rejected";
  error.statusCode = statusCode;
  throw error;
}

/**
 * Batch ban check via Steam Web API.
 * @param {string[]} steamId64List — up to 100 per call (auto-chunked)
 * @param {string} apiKey — Steam Web API key
 * @returns {Promise<Map<string, object>>} Map<steamId64, banInfo>
 */
async function checkBansBatch(steamId64List, apiKey) {
  const result = new Map();
  const chunks = [];
  for (let i = 0; i < steamId64List.length; i += BAN_BATCH_LIMIT) {
    chunks.push(steamId64List.slice(i, i + BAN_BATCH_LIMIT));
  }

  for (const chunk of chunks) {
    const csv = chunk.join(",");
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${apiKey}&steamids=${csv}`;
    const resp = await steamGet({ url });
    const players = resp.json?.players ?? [];
    for (const p of players) {
      result.set(p.SteamId, {
        steamId64: p.SteamId,
        communityBanned: p.CommunityBanned,
        vacBanned: p.VACBanned,
        numberOfVACBans: p.NumberOfVACBans,
        numberOfGameBans: p.NumberOfGameBans,
        economyBan: p.EconomyBan,
        daysSinceLastBan: p.DaysSinceLastBan,
      });
    }
  }

  return result;
}

/**
 * Single account ban check by scraping profile page (no API key needed).
 * @param {{ cookieString: string, steamId64: string }} opts
 * @returns {Promise<object>} banInfo (best-effort)
 */
async function checkBanSingle({ cookieString, steamId64 }) {
  const enhanced = enhanceCookieString(cookieString, { steamId64, domain: "community" });
  const url = `https://steamcommunity.com/profiles/${steamId64}`;
  const headers = buildSteamHeaders({ cookieString: enhanced, steamId64, referer: `https://steamcommunity.com/profiles/${steamId64}` });
  const resp = await steamGet({ url, headers });
  throwIfAuthRejected(resp);
  const body = resp.body || "";

  const banInfo = {
    steamId64,
    communityBanned: false,
    vacBanned: false,
    numberOfVACBans: 0,
    numberOfGameBans: 0,
    economyBan: "none",
    daysSinceLastBan: 0,
  };

  // Look for ban status block
  const banMatch = body.match(/class="profile_ban_status"[^>]*>([\s\S]*?)<\/div>/i)
    || body.match(/class="profile_ban"[^>]*>([\s\S]*?)<\/div>/i);

  if (banMatch) {
    const text = banMatch[1];
    if (/vac\s*ban/i.test(text)) {
      banInfo.vacBanned = true;
      const countMatch = text.match(/(\d+)\s*vac\s*ban/i);
      banInfo.numberOfVACBans = countMatch ? parseInt(countMatch[1], 10) : 1;
      const daysMatch = text.match(/(\d+)\s*day/i);
      if (daysMatch) banInfo.daysSinceLastBan = parseInt(daysMatch[1], 10);
    }
    if (/game\s*ban/i.test(text)) {
      const gbMatch = text.match(/(\d+)\s*game\s*ban/i);
      banInfo.numberOfGameBans = gbMatch ? parseInt(gbMatch[1], 10) : 1;
    }
    if (/trade\s*ban/i.test(text)) {
      banInfo.economyBan = "banned";
    } else if (/trade\s*probation/i.test(text) || /probation/i.test(text)) {
      banInfo.economyBan = "probation";
    }
    if (/community\s*ban/i.test(text)) {
      banInfo.communityBanned = true;
    }
  }

  return banInfo;
}

/**
 * Format ban status to readable string.
 * @param {object} banInfo
 * @returns {string}
 */
function formatBanStatus(banInfo) {
  const parts = [];

  if (banInfo.communityBanned) {
    parts.push("🔴 社区封禁");
  }
  if (banInfo.vacBanned) {
    const days = banInfo.daysSinceLastBan > 0 ? `(${banInfo.daysSinceLastBan}天前)` : "";
    parts.push(`🔴 VAC封禁×${banInfo.numberOfVACBans}${days}`);
  }
  if (banInfo.numberOfGameBans > 0) {
    parts.push(`🟡 游戏封禁×${banInfo.numberOfGameBans}`);
  }
  if (banInfo.economyBan === "banned") {
    parts.push("🔴 交易封禁");
  } else if (banInfo.economyBan === "probation") {
    parts.push("🟡 交易观察期");
  }

  return parts.length > 0 ? parts.join(" | ") : "✅ 正常";
}

// ---------------------------------------------------------------------------
// 2. Balance Query
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOLS = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
  SGD: "S$",
  HKD: "HK$",
};

function extractAccessTokenFromCookieString(cookieString) {
  const raw = String(cookieString || "").trim();
  if (!raw) return "";

  for (const part of raw.split(";")) {
    const cookie = part.trim();
    if (!cookie.startsWith("steamLoginSecure=")) continue;
    const value = cookie.slice("steamLoginSecure=".length);
    try {
      const decoded = decodeURIComponent(value);
      if (!decoded.includes("||")) continue;
      return decoded.split("||").slice(1).join("||").trim();
    } catch (_) {
      continue;
    }
  }

  return "";
}

async function fetchTradeOfferAccessToken(accessToken) {
  const token = String(accessToken || "").trim();
  if (!token) return "";

  const attempts = [
    {
      url: `https://api.steampowered.com/IEconService/GetTradeOfferAccessToken/v1/?access_token=${encodeURIComponent(token)}`,
      headers: {}
    },
    {
      url: "https://api.steampowered.com/IEconService/GetTradeOfferAccessToken/v1/",
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  ];

  for (const attempt of attempts) {
    try {
      const resp = await steamGet(attempt);
      throwIfAuthRejected(resp);
      const tradeToken = String(resp && resp.json && resp.json.response && resp.json.response.trade_offer_access_token || "").trim();
      if (tradeToken) return tradeToken;
    } catch (err) {
      if (err && err.code === "refresh_token_rejected") throw err;
      // fall through to the next attempt
    }
  }

  return "";
}

/**
 * Fetch Steam wallet balance.
 * Primary: GetClientWalletDetails API. Fallback: parse store HTML.
 * @param {{ cookieString: string, accessToken?: string, steamId64: string }} opts
 * @returns {Promise<{ success: boolean, balance: string|null, currency: string|null }>}
 */
async function fetchBalance({ cookieString, accessToken, steamId64 }) {
  // Primary: API
  try {
    const url = "https://store.steampowered.com/api/GetClientWalletDetails/v1/?language=schinese";
    const headers = buildSteamHeaders({ cookieString: enhanceCookieString(cookieString, { steamId64, domain: "store" }), steamId64, referer: "https://store.steampowered.com/" });
    const resp = await steamGet({ url, headers });
    throwIfAuthRejected(resp);
    const wallet = resp.json?.response;

    if (wallet && wallet.has_wallet) {
      const cents = wallet.balance;
      const currencyCode = wallet.currency || "CNY";
      const symbol = CURRENCY_SYMBOLS[currencyCode] || currencyCode + " ";
      const formatted = `${symbol} ${(cents / 100).toFixed(2)}`;
      return { success: true, balance: formatted, currency: currencyCode };
    }
  } catch (primaryErr) {
    if (primaryErr && primaryErr.code === "refresh_token_rejected") throw primaryErr;
    // fall through to fallback
  }

  // Fallback: parse store account page
  try {
    const url = "https://store.steampowered.com/account/";
    const headers = buildSteamHeaders({ cookieString: enhanceCookieString(cookieString, { steamId64, domain: "store" }), steamId64, referer: "https://store.steampowered.com/" });
    const resp = await steamGet({ url, headers });
    throwIfAuthRejected(resp);
    const body = resp.body || "";

    // Match patterns like "¥ 123.45" or "$12.34"
    const walletMatch = body.match(/([¥$€£]|S\$|HK\$)\s*([\d,]+\.?\d*)/);
    if (walletMatch) {
      const balanceText = `${walletMatch[1]} ${walletMatch[2]}`;
      const symbol = walletMatch[1];
      const currency = Object.entries(CURRENCY_SYMBOLS).find(([, v]) => v === symbol)?.[0] || null;
      return { success: true, balance: balanceText, currency };
    }
  } catch (fallbackErr) {
    if (fallbackErr && fallbackErr.code === "refresh_token_rejected") throw fallbackErr;
    // both failed
  }

  return { success: false, balance: null, currency: null };
}

// ---------------------------------------------------------------------------
// 3. Trade URL Refresh
// ---------------------------------------------------------------------------

/**
 * Fetch trade offer URL from privacy settings page.
 * @param {{ cookieString: string, steamId64: string, accessToken?: string }} opts
 * @returns {Promise<{ success: boolean, tradeUrl: string|null }>}
 */
async function fetchTradeUrl({ cookieString, steamId64, accessToken }) {
  const sid = String(steamId64 || "").trim();
  if (!sid) {
    return { success: false, tradeUrl: null };
  }

  try {
    const partnerId = String(BigInt(sid) - 76561197960265728n);
    const tokenFromApi = await fetchTradeOfferAccessToken(accessToken || extractAccessTokenFromCookieString(cookieString));
    if (tokenFromApi) {
      return {
        success: true,
        tradeUrl: `https://steamcommunity.com/tradeoffer/new/?partner=${partnerId}&token=${tokenFromApi}`
      };
    }
  } catch (err) {
    if (err && err.code === "refresh_token_rejected") throw err;
    // fall through to HTML scraping
  }

  try {
    const enhanced = enhanceCookieString(cookieString, { steamId64: sid, domain: "community" });
    const url = `https://steamcommunity.com/profiles/${sid}/tradeoffers/privacy`;
    const headers = buildSteamHeaders({ cookieString: enhanced, steamId64: sid, referer: `https://steamcommunity.com/profiles/${sid}/` });
    const resp = await steamGet({ url, headers });
    throwIfAuthRejected(resp);
    const body = resp.body || "";

    const tokenMatch = body.match(
      /trade_offer_access_url['":\s]+https?:\/\/steamcommunity\.com\/tradeoffer\/new\/\?partner=\d+&token=([A-Za-z0-9_-]+)/
    );

    if (tokenMatch) {
      const accountId32 = String(BigInt(sid) - 76561197960265728n);
      const tradeUrl = `https://steamcommunity.com/tradeoffer/new/?partner=${accountId32}&token=${tokenMatch[1]}`;
      return { success: true, tradeUrl };
    }
  } catch (err) {
    if (err && err.code === "refresh_token_rejected") throw err;
    // parse failed
  }

  return { success: false, tradeUrl: null };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  checkBansBatch,
  checkBanSingle,
  formatBanStatus,
  fetchBalance,
  fetchTradeUrl,
};
