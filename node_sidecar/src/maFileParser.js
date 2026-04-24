/**
 * maFile 解析 + TOTP 生成
 * 从 Steam Guard maFile 中提取关键字段，自动生成登录令牌码
 */
const SteamTotp = require("steam-totp");
const {asString} = require("./utils");

/**
 * 解析 maFile JSON 内容
 * @param {string|object} content — maFile 原始内容（JSON 字符串或已解析对象）
 * @returns {{ steamId64, accountName, sharedSecret, identitySecret, deviceId, refreshToken, uri }}
 */
function parseMaFile(content) {
  let data;
  if (typeof content === "string") {
    try {
      data = JSON.parse(content);
    } catch (err) {
      throw new Error(`maFile JSON 解析失败: ${err.message}`);
    }
  } else if (content && typeof content === "object") {
    data = content;
  } else {
    throw new Error("maFile 内容为空");
  }

  const sharedSecret = asString(data.shared_secret || "").trim();
  const identitySecret = asString(data.identity_secret || "").trim();
  const accountName = asString(data.account_name || "").trim();
  const deviceId = asString(data.device_id || "").trim();

  // steamId64 可能在 Session.SteamID 或顶层
  let steamId64 = "";
  if (data.Session && data.Session.SteamID) {
    steamId64 = asString(data.Session.SteamID).trim();
  }
  if (!steamId64 && data.steamid) {
    steamId64 = asString(data.steamid).trim();
  }

  // refreshToken 可能在 Session 中
  let refreshToken = "";
  if (data.Session) {
    // 有些 maFile 存了 SteamLoginSecure 里的 JWT
    const loginSecure = asString(data.Session.SteamLoginSecure || "").trim();
    if (loginSecure) {
      // 格式: steamLoginSecure=steamid%7C%7Cjwt  或直接是 jwt
      const parts = loginSecure.split("%7C%7C");
      if (parts.length >= 2) {
        refreshToken = parts[parts.length - 1];
      }
    }
  }

  // access_token 顶层
  const accessToken = asString(data.access_token || "").trim();

  if (!sharedSecret) {
    throw new Error("maFile 缺少 shared_secret");
  }

  return {
    steamId64,
    accountName,
    sharedSecret,
    identitySecret,
    deviceId,
    refreshToken,
    accessToken,
    uri: asString(data.uri || "").trim(),
    revocationCode: asString(data.revocation_code || "").trim(),
    raw: data
  };
}

/**
 * 用 shared_secret 生成当前 TOTP 令牌码
 * @param {string} sharedSecret — base64 编码的 shared_secret
 * @returns {string} 5位令牌码
 */
function generateTotp(sharedSecret) {
  if (!sharedSecret) {
    throw new Error("shared_secret 为空，无法生成 TOTP");
  }
  return SteamTotp.generateAuthCode(sharedSecret);
}

/**
 * 生成交易确认密钥
 * @param {string} identitySecret — base64 编码的 identity_secret
 * @param {string} tag — 确认标签 ("conf", "allow", "details" 等)
 * @param {number} [time] — Unix 时间戳（秒），默认当前时间
 * @returns {{ key: string, time: number }}
 */
function generateConfirmationKey(identitySecret, tag, time) {
  if (!identitySecret) {
    throw new Error("identity_secret 为空，无法生成确认密钥");
  }
  const t = time || SteamTotp.time();
  const key = SteamTotp.getConfirmationKey(identitySecret, t, tag);
  return {key, time: t};
}

/**
 * 获取 Steam 服务器时间
 * @returns {number} Unix 时间戳（秒）
 */
function getServerTime() {
  return SteamTotp.time();
}

module.exports = {
  parseMaFile,
  generateTotp,
  generateConfirmationKey,
  getServerTime
};
