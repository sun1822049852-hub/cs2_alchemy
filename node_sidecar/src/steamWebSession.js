/**
 * Steam Web Session 管理
 * 从 maFile 的 access_token / refresh_token 刷新 Web Cookie
 */
const https = require("https");
const {URL} = require("url");
const {asString, withTimeout} = require("./utils");
const {getProxyUrl} = require("./networkPrecheck");

const TOKEN_REFRESH_TIMEOUT_MS = 15000;

/**
 * 通过 refresh_token 换取新的 access_token
 * 使用 IAuthenticationService/GenerateAccessTokenForApp
 */
async function refreshAccessToken(refreshToken) {
  const token = asString(refreshToken).trim();
  if (!token) {
    throw new Error("refresh_token 为空");
  }

  const postData = `refresh_token=${encodeURIComponent(token)}`;
  const url = new URL("https://api.steampowered.com/IAuthenticationService/GenerateAccessTokenForApp/v1/");

  return withTimeout(new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData)
      }
    }, (res) => {
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
 * 用 access_token 组装 Steam Web Cookie
 * @param {object} opts
 * @param {string} opts.steamId64
 * @param {string} opts.accessToken — 有效的 JWT access_token
 * @returns {{ cookieString, sessionid, steamLoginSecure }}
 */
function buildWebCookies({steamId64, accessToken}) {
  const sid = asString(steamId64).trim();
  const token = asString(accessToken).trim();
  if (!sid || !token) {
    throw new Error("steamId64 或 accessToken 为空");
  }

  // sessionid 是随机 hex
  const crypto = require("crypto");
  const sessionid = crypto.randomBytes(12).toString("hex");
  const steamLoginSecure = `${sid}%7C%7C${token}`;

  const cookieString = [
    `sessionid=${sessionid}`,
    `steamLoginSecure=${steamLoginSecure}`,
    `steamCountry=CN%7C0`
  ].join("; ");

  return {
    cookieString,
    sessionid,
    steamLoginSecure,
    steamId64: sid
  };
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
    accessToken = await refreshAccessToken(refreshToken);
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

  const cookies = buildWebCookies({steamId64, accessToken});
  return {
    ...cookies,
    accessToken
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
    accessToken = await refreshAccessToken(token);
  } catch (err) {
    // fallback: 直接用 refresh_token 当 access_token 试试
    accessToken = token;
  }

  const cookies = buildWebCookies({steamId64, accessToken});
  return {
    ...cookies,
    accessToken
  };
}

module.exports = {
  refreshAccessToken,
  buildWebCookies,
  refreshWebCookie,
  refreshWebCookieFromToken
};
