const SteamTotp = require("steam-totp");

class TokenRecoveryError extends Error {
  constructor(reason, message, {cause = null} = {}) {
    super(message);
    this.name = "TokenRecoveryError";
    this.code = "token_recovery_needs_attention";
    this.reason = reason;
    this.auth_state = "needs_attention";
    this.status = 409;
    if (cause) {
      Object.defineProperty(this, "cause", {
        value: cause,
        enumerable: false,
        configurable: true
      });
    }
  }
}

function asTrimmedString(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value).trim();
  }
  return "";
}

function isRecoverableTokenError(err) {
  const code = asTrimmedString(err && (
    err.reason || err.code || err.eresult || err.result || err.statusCode || err.status
  )).toLowerCase();
  const message = asTrimmedString(err && err.message ? err.message : err).toLowerCase();
  const explicitCodes = new Set([
    "login_key_missing",
    "login_key_invalid",
    "refresh_token_missing",
    "refresh_token_invalid",
    "refresh_token_rejected",
    "refresh_token_expired",
    "token_missing",
    "token_invalid",
    "token_rejected",
    "token_expired",
    "invalidpassword",
    "accessdenied",
    "accountlogondenied",
    "invalidloginauthcode",
    "5",
    "15",
    "63",
    "65",
    "401",
    "403"
  ]);
  if (explicitCodes.has(code)) {
    return true;
  }
  return [
    "login key missing",
    "login key invalid",
    "refresh token missing",
    "refresh token invalid",
    "refresh token rejected",
    "refresh token expired",
    "token rejected",
    "token expired"
  ].some((text) => message.includes(text)) || /(?:http|api(?:\s*返回)?|status(?:code)?[=: ]+)\s*(401|403)\b/i.test(message);
}

function isManualVerificationError(err) {
  const code = asTrimmedString(err && (err.reason || err.code || err.eresult || err.result)).toLowerCase();
  const guardType = asTrimmedString(err && (err.guard_type || err.guardType)).toLowerCase();
  const message = asTrimmedString(err && err.message ? err.message : err).toLowerCase();
  return [
    "requires2fa",
    "requiresemailauth",
    "devicecode",
    "deviceconfirmation",
    "emailcode",
    "emailconfirmation",
    "manual_verification_required"
  ].includes(code) || [
    "email_code",
    "device_code",
    "device_confirmation",
    "email_confirmation"
  ].includes(guardType) || [
    "email code required",
    "device confirmation required",
    "manual verification required"
  ].some((text) => message.includes(text));
}

function isInvalidCredentialsError(err) {
  const code = asTrimmedString(err && (err.reason || err.code || err.eresult || err.result)).toLowerCase();
  const message = asTrimmedString(err && err.message ? err.message : err).toLowerCase();
  return ["invalidpassword", "incorrectpassword", "5"].includes(code) ||
    message.includes("invalidpassword") || message.includes("incorrect password");
}

function parseGuardData(account) {
  const source = account && (
    account.mafile_content || account.maFileContent || account.maFile || account.mafile
  );
  if (!source) {
    throw new TokenRecoveryError("steam_guard_missing", "该账号没有本地 Steam Guard");
  }

  let guard;
  try {
    guard = typeof source === "string" ? JSON.parse(source) : source;
  } catch (err) {
    throw new TokenRecoveryError("steam_guard_invalid", "本地 Steam Guard 数据无法解析", {cause: err});
  }

  const requiredFields = ["shared_secret", "identity_secret", "revocation_code", "device_id"];
  const missingFields = requiredFields.filter((field) => !asTrimmedString(guard && guard[field]));
  if (missingFields.length) {
    throw new TokenRecoveryError("steam_guard_incomplete", "本地 Steam Guard 数据不完整");
  }
  return guard;
}

function createTokenRecoveryService({
  tokenStore,
  accountCredentialsProvider,
  loginWithCredentials,
  invalidateSessions = async () => {},
  generateGuardCode = (sharedSecret) => SteamTotp.generateAuthCode(sharedSecret),
  shouldRecoverFromError = isRecoverableTokenError
} = {}) {
  if (!tokenStore || typeof tokenStore.get !== "function" || typeof tokenStore.set !== "function") {
    throw new TypeError("tokenStore with get/set is required");
  }
  if (typeof accountCredentialsProvider !== "function") {
    throw new TypeError("accountCredentialsProvider is required");
  }
  if (typeof loginWithCredentials !== "function") {
    throw new TypeError("loginWithCredentials is required");
  }
  if (typeof invalidateSessions !== "function") {
    throw new TypeError("invalidateSessions must be a function");
  }
  if (typeof shouldRecoverFromError !== "function") {
    throw new TypeError("shouldRecoverFromError must be a function");
  }

  const recoveries = new Map();

  async function performRecovery(username) {
    const requestedUsername = asTrimmedString(username);
    const account = await accountCredentialsProvider(requestedUsername);
    if (!account) {
      throw new TokenRecoveryError("account_not_found", "未找到本地账号");
    }
    const accountName = asTrimmedString(account.username) || requestedUsername;
    const password = asTrimmedString(account.password);
    if (!password) {
      throw new TokenRecoveryError("password_missing", "该账号没有保存密码");
    }
    const guard = parseGuardData(account);

    let guardCode;
    try {
      guardCode = asTrimmedString(await generateGuardCode(guard.shared_secret));
    } catch (err) {
      throw new TokenRecoveryError("steam_guard_code_failed", "无法生成 Steam Guard 令牌码", {cause: err});
    }
    if (!guardCode) {
      throw new TokenRecoveryError("steam_guard_code_failed", "无法生成 Steam Guard 令牌码");
    }

    let loginResult;
    try {
      loginResult = await loginWithCredentials({
        username: accountName,
        password,
        guardCode,
        persistToken: false
      });
    } catch (err) {
      if (isManualVerificationError(err)) {
        throw new TokenRecoveryError(
          "manual_verification_required",
          "Steam 要求额外人工验证，请手动重新登录"
        );
      }
      if (isInvalidCredentialsError(err)) {
        throw new TokenRecoveryError("invalid_credentials", "已保存的 Steam 账号或密码无效");
      }
      throw err;
    }
    const refreshToken = asTrimmedString(
      loginResult && (loginResult.refreshToken || loginResult.refresh_token)
    );
    if (!refreshToken) {
      throw new TokenRecoveryError("refresh_token_missing", "Steam 登录未返回 refresh token");
    }

    try {
      const writeResult = await tokenStore.set(accountName, refreshToken);
      if (writeResult === false) {
        throw new Error("TokenStore rejected the write");
      }
      const storedToken = asTrimmedString(await tokenStore.get(accountName));
      if (storedToken !== refreshToken) {
        throw new Error("TokenStore verification failed");
      }
    } catch (err) {
      throw new TokenRecoveryError("token_store_write_failed", "refresh token 保存失败", {cause: err});
    }

    try {
      await invalidateSessions(accountName);
    } catch (err) {
      throw new TokenRecoveryError("session_invalidation_failed", "旧登录会话失效失败", {cause: err});
    }
    return refreshToken;
  }

  function recoverToken(username) {
    const accountName = asTrimmedString(username);
    if (!accountName) {
      return Promise.reject(new TypeError("username is required"));
    }
    const recoveryKey = accountName.toLowerCase();
    const existing = recoveries.get(recoveryKey);
    if (existing) {
      return existing;
    }
    const pending = performRecovery(accountName).finally(() => {
      if (recoveries.get(recoveryKey) === pending) {
        recoveries.delete(recoveryKey);
      }
    });
    recoveries.set(recoveryKey, pending);
    return pending;
  }

  async function withTokenRecovery(username, operation) {
    const accountName = asTrimmedString(username);
    if (!accountName) {
      throw new TypeError("username is required");
    }
    if (typeof operation !== "function") {
      throw new TypeError("operation must be a function");
    }
    const runRecoveredOperation = async (refreshToken) => {
      try {
        return await operation(refreshToken);
      } catch (err) {
        if (shouldRecoverFromError(err)) {
          throw new TokenRecoveryError(
            "refresh_token_rejected_after_recovery",
            "Steam 仍拒绝新的登录凭据，请检查账号密码或 Guard",
            {cause: err}
          );
        }
        throw err;
      }
    };

    const currentToken = asTrimmedString(await tokenStore.get(accountName));
    if (!currentToken) {
      return runRecoveredOperation(await recoverToken(accountName));
    }
    try {
      return await operation(currentToken);
    } catch (err) {
      if (!shouldRecoverFromError(err)) {
        throw err;
      }
      const latestToken = asTrimmedString(await tokenStore.get(accountName));
      if (latestToken && latestToken !== currentToken) {
        return runRecoveredOperation(latestToken);
      }
      const replacementToken = await recoverToken(accountName);
      return runRecoveredOperation(replacementToken);
    }
  }

  return {
    recoverToken,
    withTokenRecovery
  };
}

module.exports = {
  TokenRecoveryError,
  createTokenRecoveryService,
  isRecoverableTokenError,
  isManualVerificationError,
  isInvalidCredentialsError
};
