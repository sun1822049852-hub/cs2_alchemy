/**
 * Steam Web Session 管理
 * 从 maFile 的 access_token / refresh_token 刷新 Web Cookie
 * 优先向 steam-session 的 LoginSession 对齐，失败再兜底手工 cookie。
 */
const https = require("https");
const crypto = require("crypto");
const {URL} = require("url");
const {asString, withTimeout} = require("./utils");
const {getProxyUrl} = require("./networkPrecheck");
const {enhanceCookieString} = require("./steamHttpClient");

const TOKEN_REFRESH_TIMEOUT_MS = 15000;
const STEAM_COUNTRY_COOKIE = "steamCountry=CN%7C0";

function createProxyAgent() {
  const proxyUrl = asString(getProxyUrl()).trim();
  if (!proxyUrl) {
    return null;
  }
  try {
    const {HttpsProxyAgent} = require("https-proxy-agent");
    return new HttpsProxyAgent(proxyUrl, {keepAlive: false});
  } catch (_) {
    return null;
  }
}

function appendCookieIfMissing(cookieString, cookiePrefix, cookieValue) {
  if (new RegExp(`(?:^|;\\s*)${cookiePrefix}=`).test(cookieString)) {
    return cookieString;
  }
  return cookieString ? `${cookieString}; ${cookieValue}` : cookieValue;
}

function readCookieValue(cookieString, name) {
  const parts = asString(cookieString).split(";").map((item) => item.trim()).filter(Boolean);
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx <= 0) {
      continue;
    }
    if (part.slice(0, eqIdx) === name) {
      return part.slice(eqIdx + 1);
    }
  }
  return "";
}

function finalizeCookiePayload({cookieArray, steamId64, accessToken, isFallbackCookie}) {
  const sid = asString(steamId64).trim();
  const normalizedCookieArray = Array.isArray(cookieArray)
    ? cookieArray.map((item) => asString(item).trim()).filter(Boolean)
    : [];
  let cookieString = normalizedCookieArray.join("; ");
  cookieString = appendCookieIfMissing(cookieString, "steamCountry", STEAM_COUNTRY_COOKIE);
  cookieString = enhanceCookieString(cookieString, {steamId64: sid, domain: "community"});

  return {
    cookieArray: normalizedCookieArray,
    cookieString,
    sessionid: readCookieValue(cookieString, "sessionid"),
    steamLoginSecure: readCookieValue(cookieString, "steamLoginSecure"),
    steamId64: sid,
    accessToken: asString(accessToken).trim(),
    isFallbackCookie: !!isFallbackCookie
  };
}

function buildFallbackCookieArray({steamId64, accessToken}) {
  const sid = asString(steamId64).trim();
  const token = asString(accessToken).trim();
  if (!sid || !token) {
    throw new Error("steamId64 或 accessToken 为空");
  }
  const sessionid = crypto.randomBytes(12).toString("hex");
  const steamLoginSecure = encodeURIComponent(`${sid}||${token}`);
  return [
    `steamLoginSecure=${steamLoginSecure}`,
    `sessionid=${sessionid}`
  ];
}

async function getWebCookiesViaSteamSession({refreshToken, accessToken}) {
  const token = asString(refreshToken).trim();
  if (!token) {
    throw new Error("refresh_token 为空");
  }
  const {LoginSession, EAuthTokenPlatformType} = require("steam-session");
  const session = new LoginSession(EAuthTokenPlatformType.MobileApp);
  session.refreshToken = token;
  if (asString(accessToken).trim()) {
    session.accessToken = asString(accessToken).trim();
  }
  const cookieArray = await session.getWebCookies();
  return {
    cookieArray,
    accessToken: asString(session.accessToken || accessToken).trim()
  };
}

/**
 * 通过 refresh_token 换取新的 access_token
 * 使用 IAuthenticationService/GenerateAccessTokenForApp
 */
async function refreshAccessToken(refreshToken, steamId64) {
  const token = asString(refreshToken).trim();
  const sid = asString(steamId64).trim();
  if (!token) {
    throw new Error("refresh_token 为空");
  }

  const postData = sid
    ? `refresh_token=${encodeURIComponent(token)}&steamid=${encodeURIComponent(sid)}`
    : `refresh_token=${encodeURIComponent(token)}`;
  const url = new URL("https://api.steampowered.com/IAuthenticationService/GenerateAccessTokenForApp/v1/");
  const proxyAgent = createProxyAgent();

  return withTimeout(new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData)
      }
    };
    if (proxyAgent) {
      reqOptions.agent = proxyAgent;
    }
    const req = https.request(reqOptions, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          const resp = data && data.response;
          if (!resp || !resp.access_token) {
            reject(new Error(`刷新 access_token 失败: ${body.slice(0, 200)}`));
            return;
          }
          resolve(resp.access_token);
        } catch (err) {
          reject(new Error(`解析 access_token 响应失败: ${err.message}`));
        }
      });
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  }), TOKEN_REFRESH_TIMEOUT_MS, "刷新 access_token 超时");
}

/**
 * 用 access_token 兜底组装 Steam Web Cookie
 * @param {object} opts
 * @param {string} opts.steamId64
 * @param {string} opts.accessToken — 有效的 JWT access_token
 * @returns {{ cookieArray, cookieString, sessionid, steamLoginSecure, steamId64, accessToken, isFallbackCookie }}
 */
function buildWebCookies({steamId64, accessToken}) {
  return finalizeCookiePayload({
    cookieArray: buildFallbackCookieArray({steamId64, accessToken}),
    steamId64,
    accessToken,
    isFallbackCookie: true
  });
}

/**
 * 完整刷新 Web Cookie 流程
 * 1. 从 maFile 解析数据中取 refreshToken
 * 2. 换 accessToken
 * 3. 组装 Cookie
 *
 * @param {object} maData — parseMaFile() 的返回值
 * @returns {{ cookieString, sessionid, steamLoginSecure, steamId64, accessToken }}
 */
async function refreshWebCookie(maData) {
  if (!maData || typeof maData !== "object") {
    throw new Error("maData 为空");
  }

  // 优先用已有的 accessToken（如果还没过期）
  // 但为安全起见，总是尝试刷新
  let refreshToken = asString(maData.refreshToken).trim();

  // 如果没有 refreshToken，尝试从 raw 数据中提取
  if (!refreshToken && maData.raw && maData.raw.Session) {
    const loginSecure = asString(maData.raw.Session.SteamLoginSecure || "").trim();
    if (loginSecure) {
      const parts = loginSecure.split("%7C%7C");
      if (parts.length >= 2) {
        refreshToken = parts[parts.length - 1];
      }
    }
  }

  // 如果还是没有，尝试用 accessToken 作为 refreshToken
  if (!refreshToken) {
    refreshToken = asString(maData.accessToken).trim();
  }

  if (!refreshToken) {
    throw new Error("无法从 maFile 中提取 refresh_token 或 access_token");
  }

  let accessToken;
  try {
    accessToken = await refreshAccessToken(refreshToken, maData.steamId64);
  } catch (err) {
    // 如果刷新失败，尝试直接用已有的 accessToken
    const fallback = asString(maData.accessToken).trim();
    if (fallback) {
      accessToken = fallback;
    } else {
      throw err;
    }
  }

  const steamId64 = asString(maData.steamId64).trim();
  if (!steamId64) {
    throw new Error("steamId64 为空，无法组装 Cookie");
  }

  try {
    const sessionResult = await getWebCookiesViaSteamSession({refreshToken, accessToken});
    return finalizeCookiePayload({
      cookieArray: sessionResult.cookieArray,
      steamId64,
      accessToken: sessionResult.accessToken || accessToken,
      isFallbackCookie: false
    });
  } catch (_) {
    // ignore and fall back to manual cookie assembly below
  }

  const cookies = buildWebCookies({steamId64, accessToken});
  return {
    ...cookies,
    accessToken,
    isFallbackCookie: true
  };
}

/**
 * 从 TokenStore 的 refresh_token 直接刷新 Web Cookie
 * 用于没有 maFile 的普通登录账号
 *
 * @param {string} refreshToken — TokenStore 中存储的 refresh_token (JWT)
 * @param {string} steamId64 — 账号的 SteamID64
 * @returns {{ cookieString, sessionid, steamLoginSecure, steamId64, accessToken }}
 */
async function refreshWebCookieFromToken(refreshToken, steamId64) {
  const token = asString(refreshToken).trim();
  const sid = asString(steamId64).trim();
  if (!token) {
    throw new Error("refresh_token 为空");
  }
  if (!sid) {
    throw new Error("steamId64 为空，无法组装 Cookie");
  }

  let accessToken;
  try {
    accessToken = await refreshAccessToken(token, sid);
  } catch (err) {
    // fallback: 直接用 refresh_token 当 access_token 试试
    accessToken = token;
  }

  try {
    const sessionResult = await getWebCookiesViaSteamSession({refreshToken: token, accessToken});
    return finalizeCookiePayload({
      cookieArray: sessionResult.cookieArray,
      steamId64: sid,
      accessToken: sessionResult.accessToken || accessToken,
      isFallbackCookie: false
    });
  } catch (_) {
    // ignore and fall back to manual cookie assembly below
  }

  const cookies = buildWebCookies({steamId64: sid, accessToken});
  return {
    ...cookies,
    accessToken,
    isFallbackCookie: true
  };
}

module.exports = {
  refreshAccessToken,
  buildWebCookies,
  refreshWebCookie,
  refreshWebCookieFromToken
};
