/**
 * Steam 交易报价服务
 * 发送交易报价 + 自动确认（A号确认 + B号接受确认）
 */
const https = require("https");
const SteamCommunity = require("steamcommunity");
const {asString, sleep, withTimeout} = require("./utils");
const {generateConfirmationKey, getServerTime} = require("./maFileParser");
const {createProxyAgentForUrl, getSteamCommunityOptions} = require("./proxyConfig");

const TRADE_SEND_TIMEOUT_MS = 20000;
const CONFIRM_TIMEOUT_MS = 15000;
const CONFIRM_RETRY_DELAY_MS = 3000;
const CONFIRM_MAX_RETRIES = 3;

function addProxyAgent(options, targetUrl) {
  const proxyAgent = createProxyAgentForUrl(targetUrl);
  if (proxyAgent) {
    options.agent = proxyAgent;
  }
  return options;
}

function createSteamCommunity() {
  return new SteamCommunity(getSteamCommunityOptions());
}

/**
 * 解析交易链接
 * @param {string} tradeUrl — https://steamcommunity.com/tradeoffer/new/?partner=xxx&token=xxx
 * @returns {{ partnerId: string, tradeToken: string }}
 */
function parseTradeUrl(tradeUrl) {
  const url = asString(tradeUrl).trim();
  if (!url) {
    throw new Error("交易链接为空");
  }
  const match = url.match(/[?&]partner=(\d+)/);
  const tokenMatch = url.match(/[?&]token=([a-zA-Z0-9_-]+)/);
  if (!match) {
    throw new Error("交易链接格式错误：缺少 partner 参数");
  }
  return {
    partnerId: match[1],
    tradeToken: tokenMatch ? tokenMatch[1] : ""
  };
}

/**
 * 发送交易报价
 * @param {object} opts
 * @param {string} opts.cookieString — 发送方 Cookie
 * @param {string} opts.sessionid — 发送方 sessionid
 * @param {string} opts.partnerSteamId64 — 接收方 SteamID64
 * @param {string} opts.partnerId — 接收方 partner ID (32位)
 * @param {string} opts.tradeToken — 交易令牌
 * @param {Array<string>} opts.assetIds — 要发送的物品 assetid 列表
 * @param {string} [opts.message] — 交易消息
 * @returns {Promise<{ tradeofferid: string }>}
 */
async function sendTradeOffer({cookieString, sessionid, partnerSteamId64, partnerId, tradeToken, assetIds, message}) {
  if (!Array.isArray(assetIds) || assetIds.length === 0) {
    throw new Error("assetIds 为空");
  }

  // 构建 trade_offer_create_params
  const myItems = assetIds.map((id) => ({
    appid: 730,
    contextid: "2",
    amount: 1,
    assetid: asString(id).trim()
  }));

  const tradeOfferParams = {
    newversion: true,
    version: 4,
    me: {assets: myItems, currency: [], ready: false},
    them: {assets: [], currency: [], ready: false}
  };

  const formData = new URLSearchParams();
  formData.append("sessionid", sessionid);
  formData.append("serverid", "1");
  formData.append("partner", asString(partnerSteamId64).trim());
  formData.append("tradeoffermessage", asString(message || "").trim());
  formData.append("json_tradeoffer", JSON.stringify(tradeOfferParams));
  formData.append("captcha", "");
  formData.append("trade_offer_create_params", JSON.stringify({
    trade_offer_access_token: asString(tradeToken).trim()
  }));

  const postBody = formData.toString();
  const referer = `https://steamcommunity.com/tradeoffer/new/?partner=${asString(partnerId).trim()}&token=${asString(tradeToken).trim()}`;

  return withTimeout(new Promise((resolve, reject) => {
    const requestPath = "/tradeoffer/new/send";
    const req = https.request(addProxyAgent({
      hostname: "steamcommunity.com",
      path: requestPath,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postBody),
        Cookie: cookieString,
        Referer: referer,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    }, `https://steamcommunity.com${requestPath}`), (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          if (data.tradeofferid) {
            resolve({tradeofferid: asString(data.tradeofferid).trim()});
          } else {
            reject(new Error(`发送报价失败: ${asString(data.strError || body).slice(0, 200)}`));
          }
        } catch (err) {
          reject(new Error(`解析报价响应失败: ${err.message} body=${body.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(postBody);
    req.end();
  }), TRADE_SEND_TIMEOUT_MS, "发送交易报价超时");
}

/**
 * 使用 steamcommunity 库确认交易
 * @param {object} opts
 * @param {string} opts.cookieString — Cookie 字符串
 * @param {string} opts.steamId64
 * @param {string} opts.identitySecret
 * @param {string} opts.tradeofferId — 要确认的报价 ID
 * @returns {Promise<boolean>}
 */
async function confirmTradeOffer({cookieString, steamId64, identitySecret, tradeofferId}) {
  if (!identitySecret) {
    throw new Error("identity_secret 为空，无法确认交易");
  }

  const community = createSteamCommunity();

  // 设置 Cookie
  const cookies = cookieString.split("; ").map((c) => c.trim()).filter(Boolean);
  community.setCookies(cookies);

  for (let attempt = 0; attempt < CONFIRM_MAX_RETRIES; attempt++) {
    try {
      const result = await withTimeout(new Promise((resolve, reject) => {
        const time = getServerTime();
        const confKey = generateConfirmationKey(identitySecret, "conf", time);

        community.getConfirmations(time, confKey.key, (err, confirmations) => {
          if (err) {
            reject(err);
            return;
          }
          if (!Array.isArray(confirmations) || confirmations.length === 0) {
            resolve(false);
            return;
          }

          // 找到匹配的确认
          const target = confirmations.find((c) => {
            const creator = asString(c.creator || "").trim();
            return creator === asString(tradeofferId).trim();
          });

          if (!target) {
            resolve(false);
            return;
          }

          // 确认
          const allowTime = getServerTime();
          const allowKey = generateConfirmationKey(identitySecret, "allow", allowTime);

          target.respond(allowTime, allowKey.key, true, (err2) => {
            if (err2) {
              reject(err2);
              return;
            }
            resolve(true);
          });
        });
      }), CONFIRM_TIMEOUT_MS, "确认交易超时");

      if (result) {
        return true;
      }

      // 确认列表中没找到，等待后重试
      if (attempt < CONFIRM_MAX_RETRIES - 1) {
        await sleep(CONFIRM_RETRY_DELAY_MS);
      }
    } catch (err) {
      if (attempt >= CONFIRM_MAX_RETRIES - 1) {
        throw err;
      }
      await sleep(CONFIRM_RETRY_DELAY_MS);
    }
  }

  return false;
}

/**
 * 接受交易报价
 * @param {object} opts
 * @param {string} opts.cookieString — 接收方 Cookie
 * @param {string} opts.sessionid — 接收方 sessionid
 * @param {string} opts.tradeofferId — 报价 ID
 * @param {string} opts.partnerSteamId64 — 发送方 SteamID64
 * @returns {Promise<boolean>}
 */
async function acceptTradeOffer({cookieString, sessionid, tradeofferId, partnerSteamId64}) {
  const offerId = asString(tradeofferId).trim();
  if (!offerId) {
    throw new Error("tradeofferId 为空");
  }

  const formData = new URLSearchParams();
  formData.append("sessionid", sessionid);
  formData.append("serverid", "1");
  formData.append("tradeofferid", offerId);
  formData.append("partner", asString(partnerSteamId64).trim());
  formData.append("captcha", "");

  const postBody = formData.toString();

  return withTimeout(new Promise((resolve, reject) => {
    const requestPath = `/tradeoffer/${offerId}/accept`;
    const req = https.request(addProxyAgent({
      hostname: "steamcommunity.com",
      path: requestPath,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postBody),
        Cookie: cookieString,
        Referer: `https://steamcommunity.com/tradeoffer/${offerId}/`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    }, `https://steamcommunity.com${requestPath}`), (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          reject(new Error(`接受报价失败 HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(postBody);
    req.end();
  }), TRADE_SEND_TIMEOUT_MS, "接受交易报价超时");
}

/**
 * 取消已发出的交易报价
 * @param {object} opts
 * @param {string} opts.cookieString
 * @param {string} opts.sessionid
 * @param {string} opts.tradeofferId
 * @returns {Promise<boolean>}
 */
async function cancelTradeOffer({cookieString, sessionid, tradeofferId}) {
  const offerId = asString(tradeofferId).trim();
  if (!offerId) {
    throw new Error("tradeofferId 为空");
  }

  const formData = new URLSearchParams();
  formData.append("sessionid", sessionid);

  const postBody = formData.toString();

  return withTimeout(new Promise((resolve, reject) => {
    const requestPath = `/tradeoffer/${offerId}/cancel`;
    const req = https.request(addProxyAgent({
      hostname: "steamcommunity.com",
      path: requestPath,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postBody),
        Cookie: cookieString,
        Referer: `https://steamcommunity.com/tradeoffer/${offerId}/`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    }, `https://steamcommunity.com${requestPath}`), (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          reject(new Error(`取消报价失败 HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(postBody);
    req.end();
  }), TRADE_SEND_TIMEOUT_MS, "取消交易报价超时");
}

/**
 * SteamID64 → 32位 partner ID
 */
function steamId64ToAccountId(steamId64) {
  const id = BigInt(asString(steamId64).trim());
  return String(id - BigInt("76561197960265728"));
}

module.exports = {
  parseTradeUrl,
  sendTradeOffer,
  confirmTradeOffer,
  acceptTradeOffer,
  cancelTradeOffer,
  steamId64ToAccountId
};
