const SteamUser = require("steam-user");
const {asString, withTimeout} = require("./utils");

async function loginAndSaveToken({
  username,
  password,
  twoFactorCode,
  tokenStore,
  logger,
  timeoutMs = 45000
}) {
  const accountName = asString(username).trim();
  const accountPassword = asString(password).trim();
  const totp = asString(twoFactorCode).trim();
  if (!accountName) {
    throw new Error("username required");
  }
  if (!accountPassword) {
    throw new Error("password required");
  }

  const steam = new SteamUser({
    autoRelogin: false,
    renewRefreshTokens: true
  });

  let savedToken = "";
  let settled = false;
  const finish = (resolve, reject, err) => {
    if (settled) {
      return;
    }
    settled = true;
    try {
      steam.logOff();
    } catch (_) {}
    if (err) {
      reject(err);
      return;
    }
    resolve({
      username: accountName,
      refresh_token: savedToken
    });
  };

  const tokenPromise = new Promise((resolve, reject) => {
    steam.on("refreshToken", (token) => {
      savedToken = asString(token).trim();
      if (savedToken && tokenStore) {
        tokenStore.set(accountName, savedToken);
      }
    });

    steam.once("loggedOn", () => {
      if (!savedToken && tokenStore) {
        savedToken = tokenStore.get(accountName);
      }
      if (!savedToken) {
        finish(resolve, reject, new Error("login success but refresh_token not received"));
        return;
      }
      if (logger) {
        logger.info("auth", `login-save success: ${accountName}`);
      }
      finish(resolve, reject, null);
    });

    steam.on("steamGuard", (_domain, callback) => {
      if (!totp) {
        finish(resolve, reject, new Error("需要令牌码（5位）"));
        return;
      }
      callback(totp);
    });

    steam.once("error", (err) => {
      finish(resolve, reject, err instanceof Error ? err : new Error(asString(err)));
    });
  });

  steam.logOn({
    accountName,
    password: accountPassword,
    twoFactorCode: totp || undefined
  });

  return withTimeout(tokenPromise, timeoutMs, "login-save timeout");
}

module.exports = {
  loginAndSaveToken
};

