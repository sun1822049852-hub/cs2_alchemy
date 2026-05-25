const {LoginSession, EAuthSessionGuardType, EAuthTokenPlatformType} = require("steam-session");
const {asString, withTimeout} = require("./utils");
const {ensureAuthApiReachable} = require("./networkPrecheck");
const {getSteamSessionProxyOptions} = require("./proxyConfig");

const GUARD_TYPE_NAMES = {
  [EAuthSessionGuardType.Unknown]: "Unknown",
  [EAuthSessionGuardType.None]: "None",
  [EAuthSessionGuardType.EmailCode]: "EmailCode",
  [EAuthSessionGuardType.DeviceCode]: "DeviceCode",
  [EAuthSessionGuardType.DeviceConfirmation]: "DeviceConfirmation",
  [EAuthSessionGuardType.EmailConfirmation]: "EmailConfirmation",
  [EAuthSessionGuardType.MachineToken]: "MachineToken",
  [EAuthSessionGuardType.LegacyMachineAuth]: "LegacyMachineAuth"
};

const ERR_TOTP_REQUIRED = "\u9700\u8981\u4ee4\u724c\u7801\uff085\u4f4d\uff09";
const ERR_LOGIN_TIMEOUT = "\u767b\u5f55\u8d85\u65f6\uff1a\u8bf7\u5728 Steam \u5ba2\u6237\u7aef\u786e\u8ba4\u540e\u91cd\u8bd5";
const ERR_REFRESH_TOKEN_MISSING = "\u767b\u5f55\u6210\u529f\u4f46\u672a\u83b7\u53d6\u5230 refresh_token";
const ERR_GUARD_ACTION_MISSING =
  "\u767b\u5f55\u9700\u8981\u989d\u5916\u9a8c\u8bc1\uff0c\u4f46\u672a\u8fd4\u56de\u53ef\u7528\u9a8c\u8bc1\u65b9\u5f0f";

// ---------------------------------------------------------------------------
// Pending session cache for two-phase login (email guard / device code)
// ---------------------------------------------------------------------------
const PENDING_SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const pendingSessions = new Map();

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [key, entry] of pendingSessions) {
    if (now - entry.startedAt > PENDING_SESSION_TTL_MS) {
      try { entry.session.cancelLoginAttempt(); } catch (_) {}
      if (entry.waitAuth) entry.waitAuth.catch(() => {});
      pendingSessions.delete(key);
    }
  }
}

function removePendingSession(username) {
  const entry = pendingSessions.get(username);
  if (!entry) return;
  try { entry.session.cancelLoginAttempt(); } catch (_) {}
  if (entry.waitAuth) entry.waitAuth.catch(() => {});
  pendingSessions.delete(username);
}

function formatError(err) {
  const message = asString(err && err.message ? err.message : err).trim() || "unknown_error";
  const code = asString(err && (err.eresult || err.code || "")).trim();
  return code ? `${message} code=${code}` : message;
}

function toGuardName(type) {
  const n = Number(type);
  if (!Number.isFinite(n)) {
    return "Unknown";
  }
  return GUARD_TYPE_NAMES[n] || `GuardType(${n})`;
}

function formatValidActions(validActions) {
  if (!Array.isArray(validActions) || !validActions.length) {
    return "";
  }
  return validActions
    .map((x) => {
      const detail = asString(x && x.detail ? x.detail : "").trim();
      const name = toGuardName(x && x.type);
      return detail ? `${name}(${detail})` : name;
    })
    .join(",");
}

function hasGuard(validActions, guardType) {
  if (!Array.isArray(validActions) || !validActions.length) {
    return false;
  }
  return validActions.some((x) => Number(x && x.type) === Number(guardType));
}

function remainingTimeoutMs(startedAt, timeoutMs) {
  const elapsed = Math.max(0, Date.now() - startedAt);
  return Math.max(1000, Math.max(1, Number(timeoutMs) || 1) - elapsed);
}

function getSteamId64(session) {
  try {
    if (session && session.steamID && typeof session.steamID.getSteamID64 === "function") {
      return asString(session.steamID.getSteamID64()).trim();
    }
    return asString(session && session.steamID ? session.steamID : "").trim();
  } catch (_) {
    return "";
  }
}

function waitForAuthenticated({session, accountName, logger}) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      session.removeListener("authenticated", onAuthenticated);
      session.removeListener("timeout", onTimeout);
      session.removeListener("error", onError);
      session.removeListener("polling", onPolling);
      session.removeListener("remoteInteraction", onRemoteInteraction);
    };

    const finish = (err, token) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (err) {
        reject(err);
        return;
      }
      resolve(token);
    };

    const onPolling = () => {
      if (logger) {
        logger.info("auth", `login-save polling started: account=${accountName}`);
      }
    };

    const onRemoteInteraction = () => {
      if (logger) {
        logger.info("auth", `login-save remote interaction: account=${accountName}`);
      }
    };

    const onTimeout = () => {
      finish(new Error(ERR_LOGIN_TIMEOUT));
    };

    const onError = (err) => {
      finish(err instanceof Error ? err : new Error(asString(err)));
    };

    const onAuthenticated = () => {
      const token = asString(session.refreshToken || "").trim();
      if (!token) {
        finish(new Error(ERR_REFRESH_TOKEN_MISSING));
        return;
      }
      if (logger) {
        logger.info("auth", `login-save authenticated: account=${accountName} token_len=${token.length}`);
      }
      finish(null, token);
    };

    session.once("authenticated", onAuthenticated);
    session.once("timeout", onTimeout);
    session.once("error", onError);
    session.on("polling", onPolling);
    session.on("remoteInteraction", onRemoteInteraction);
  });
}

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
  const timeout = Math.max(5000, Number(timeoutMs) || 45000);

  if (!accountName) {
    throw new Error("username required");
  }
  if (!accountPassword) {
    throw new Error("password required");
  }
  if (!totp) {
    throw new Error(ERR_TOTP_REQUIRED);
  }

  const startedAt = Date.now();
  if (logger) {
    logger.info("auth", `login-save start: account=${accountName} timeout_ms=${timeout} totp=yes`);
  }

  try {
    await ensureAuthApiReachable({
      logger,
      // Force live precheck for each login attempt to avoid stale proxy/network cache.
      force: true,
      timeoutMs: Math.min(5000, timeout)
    });
  } catch (err) {
    if (logger) {
      logger.warn(
        "auth",
        `login-save precheck failed: account=${accountName} elapsed_ms=${Date.now() - startedAt} error=${formatError(err)}`
      );
    }
    throw err;
  }

  const session = new LoginSession(EAuthTokenPlatformType.SteamClient, getSteamSessionProxyOptions());
  try {
    session.loginTimeout = timeout;
  } catch (_) {
    // ignore invalid timeout assignment and use default
  }

  const waitAuth = waitForAuthenticated({session, accountName, logger});
  let authWaitHandled = false;
  // Prevent unhandled rejection warnings when startWithCredentials fails early.
  waitAuth.catch(() => {});

  try {
    if (logger) {
      logger.info("auth", `login-save auth startWithCredentials: account=${accountName}`);
    }

    const startResponse = await withTimeout(
      session.startWithCredentials({
        accountName,
        password: accountPassword,
        steamGuardCode: totp
      }),
      remainingTimeoutMs(startedAt, timeout),
      "login-save start timeout"
    );

    const validActions = Array.isArray(startResponse && startResponse.validActions) ? startResponse.validActions : [];
    const guards = formatValidActions(validActions);
    const steamId64 = getSteamId64(session);
    if (logger) {
      logger.info(
        "auth",
        `login-save auth session started: account=${accountName} action_required=${startResponse && startResponse.actionRequired ? "yes" : "no"} guards=${guards || "-"}${steamId64 ? ` steamid=${steamId64}` : ""}`
      );
    }

    if (startResponse && startResponse.actionRequired) {
      const needDeviceCode = hasGuard(validActions, EAuthSessionGuardType.DeviceCode);
      const needEmailCode = hasGuard(validActions, EAuthSessionGuardType.EmailCode);
      const needDeviceConfirmation = hasGuard(validActions, EAuthSessionGuardType.DeviceConfirmation);
      const needEmailConfirmation = hasGuard(validActions, EAuthSessionGuardType.EmailConfirmation);

      if (!validActions.length) {
        throw new Error(ERR_GUARD_ACTION_MISSING);
      }

      if (needDeviceCode || needEmailCode) {
        if (!totp) {
          throw new Error(ERR_TOTP_REQUIRED);
        }
        if (logger) {
          logger.info("auth", `login-save submitting steam guard code: account=${accountName}`);
        }
        await withTimeout(
          session.submitSteamGuardCode(totp),
          remainingTimeoutMs(startedAt, timeout),
          "login-save submit guard timeout"
        );
        if (logger) {
          logger.info("auth", `login-save steam guard code accepted: account=${accountName}`);
        }
      }

      if ((needDeviceConfirmation || needEmailConfirmation) && logger) {
        logger.info("auth", `login-save waiting confirmation: account=${accountName} guards=${guards || "-"}`);
      }
    }

    authWaitHandled = true;
    const refreshToken = await withTimeout(
      waitAuth,
      remainingTimeoutMs(startedAt, timeout),
      "login-save authenticate timeout"
    );

    if (tokenStore) {
      tokenStore.set(accountName, refreshToken);
    }
    if (logger) {
      logger.info("auth", `login-save token stored: account=${accountName} token_len=${refreshToken.length}`);
      logger.info("auth", `login-save done: account=${accountName} elapsed_ms=${Date.now() - startedAt}`);
    }

    return {
      username: accountName,
      refresh_token: refreshToken
    };
  } catch (err) {
    if (!authWaitHandled) {
      waitAuth.catch(() => {});
    }
    if (logger) {
      logger.warn(
        "auth",
        `login-save failed: account=${accountName} elapsed_ms=${Date.now() - startedAt} error=${formatError(err)}`
      );
    }
    throw err;
  } finally {
    if (!authWaitHandled) {
      waitAuth.catch(() => {});
    }
    try {
      session.cancelLoginAttempt();
    } catch (_) {
      // ignore cancel errors
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 1: Start login session — returns guard requirement or completes login
// ---------------------------------------------------------------------------
async function startLoginSession({
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
  const timeout = Math.max(5000, Number(timeoutMs) || 45000);

  if (!accountName) throw new Error("username required");
  if (!accountPassword) throw new Error("password required");

  // If totp is provided, delegate to the original one-shot flow
  if (totp) {
    const result = await loginAndSaveToken({username, password, twoFactorCode, tokenStore, logger, timeoutMs});
    return {ok: true, done: true, result};
  }

  const startedAt = Date.now();
  if (logger) {
    logger.info("auth", `login-start begin: account=${accountName} timeout_ms=${timeout}`);
  }

  // Cleanup any stale pending session for this user
  cleanupExpiredSessions();
  removePendingSession(accountName);

  try {
    await ensureAuthApiReachable({logger, force: true, timeoutMs: Math.min(5000, timeout)});
  } catch (err) {
    if (logger) {
      logger.warn("auth", `login-start precheck failed: account=${accountName} error=${formatError(err)}`);
    }
    throw err;
  }

  const session = new LoginSession(EAuthTokenPlatformType.SteamClient, getSteamSessionProxyOptions());
  try { session.loginTimeout = timeout; } catch (_) {}

  const waitAuth = waitForAuthenticated({session, accountName, logger});
  waitAuth.catch(() => {});

  try {
    if (logger) {
      logger.info("auth", `login-start startWithCredentials (no guard code): account=${accountName}`);
    }

    const startResponse = await withTimeout(
      session.startWithCredentials({accountName, password: accountPassword}),
      remainingTimeoutMs(startedAt, timeout),
      "login-start start timeout"
    );

    const validActions = Array.isArray(startResponse && startResponse.validActions) ? startResponse.validActions : [];
    const guards = formatValidActions(validActions);
    const steamId64 = getSteamId64(session);
    if (logger) {
      logger.info(
        "auth",
        `login-start session started: account=${accountName} action_required=${startResponse && startResponse.actionRequired ? "yes" : "no"} guards=${guards || "-"}${steamId64 ? ` steamid=${steamId64}` : ""}`
      );
    }

    if (startResponse && startResponse.actionRequired) {
      const needDeviceCode = hasGuard(validActions, EAuthSessionGuardType.DeviceCode);
      const needEmailCode = hasGuard(validActions, EAuthSessionGuardType.EmailCode);
      const needDeviceConfirmation = hasGuard(validActions, EAuthSessionGuardType.DeviceConfirmation);
      const needEmailConfirmation = hasGuard(validActions, EAuthSessionGuardType.EmailConfirmation);

      if (!validActions.length) {
        throw new Error(ERR_GUARD_ACTION_MISSING);
      }

      // Determine guard type and hint for the caller
      let guardType = null;
      let guardHint = "";
      if (needEmailCode) {
        guardType = "email_code";
        const emailAction = validActions.find((x) => Number(x && x.type) === Number(EAuthSessionGuardType.EmailCode));
        guardHint = asString(emailAction && emailAction.detail ? emailAction.detail : "").trim();
      } else if (needDeviceCode) {
        guardType = "device_code";
      } else if (needDeviceConfirmation || needEmailConfirmation) {
        guardType = "device_confirmation";
      }

      if (guardType === "email_code" || guardType === "device_code") {
        // Cache the session so submitGuardCode can complete it
        pendingSessions.set(accountName, {
          session,
          waitAuth,
          startedAt,
          timeout,
          tokenStore: tokenStore || null,
          logger: logger || null
        });
        if (logger) {
          logger.info("auth", `login-start pending: account=${accountName} guard_type=${guardType} hint=${guardHint || "-"}`);
        }
        return {ok: true, done: false, guard_type: guardType, guard_hint: guardHint};
      }

      // Device/email confirmation — wait for it
      if ((needDeviceConfirmation || needEmailConfirmation) && logger) {
        logger.info("auth", `login-start waiting confirmation: account=${accountName} guards=${guards || "-"}`);
      }
    }

    // No guard needed or confirmation-based — wait for auth
    const refreshToken = await withTimeout(waitAuth, remainingTimeoutMs(startedAt, timeout), "login-start authenticate timeout");
    if (tokenStore) tokenStore.set(accountName, refreshToken);
    if (logger) {
      logger.info("auth", `login-start done (no guard): account=${accountName} token_len=${refreshToken.length}`);
    }
    return {ok: true, done: true, result: {username: accountName, refresh_token: refreshToken}};
  } catch (err) {
    waitAuth.catch(() => {});
    if (logger) {
      logger.warn("auth", `login-start failed: account=${accountName} error=${formatError(err)}`);
    }
    try { session.cancelLoginAttempt(); } catch (_) {}
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Submit guard code for a pending session
// ---------------------------------------------------------------------------
async function submitGuardCode({
  username,
  code,
  tokenStore,
  logger,
  timeoutMs = 45000
}) {
  const accountName = asString(username).trim();
  const guardCode = asString(code).trim();
  if (!accountName) throw new Error("username required");
  if (!guardCode) throw new Error("guard code required");

  cleanupExpiredSessions();

  const entry = pendingSessions.get(accountName);
  if (!entry) {
    throw new Error("\u4f1a\u8bdd\u5df2\u8fc7\u671f\u6216\u4e0d\u5b58\u5728\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55"); // 会话已过期或不存在，请重新登录
  }

  const {session, waitAuth, startedAt} = entry;
  const timeout = Math.max(5000, Number(timeoutMs) || 45000);
  const effectiveTokenStore = tokenStore || entry.tokenStore;
  const effectiveLogger = logger || entry.logger;

  try {
    if (effectiveLogger) {
      effectiveLogger.info("auth", `login-submit-code: account=${accountName}`);
    }

    await withTimeout(
      session.submitSteamGuardCode(guardCode),
      remainingTimeoutMs(startedAt, timeout),
      "login-submit-code guard timeout"
    );

    if (effectiveLogger) {
      effectiveLogger.info("auth", `login-submit-code guard accepted: account=${accountName}`);
    }

    const refreshToken = await withTimeout(
      waitAuth,
      remainingTimeoutMs(startedAt, timeout),
      "login-submit-code authenticate timeout"
    );

    if (effectiveTokenStore) effectiveTokenStore.set(accountName, refreshToken);
    if (effectiveLogger) {
      effectiveLogger.info("auth", `login-submit-code done: account=${accountName} token_len=${refreshToken.length}`);
    }

    pendingSessions.delete(accountName);
    return {ok: true, done: true, result: {username: accountName, refresh_token: refreshToken}};
  } catch (err) {
    if (effectiveLogger) {
      effectiveLogger.warn("auth", `login-submit-code failed: account=${accountName} error=${formatError(err)}`);
    }
    // On failure, remove the pending session — user must restart
    removePendingSession(accountName);
    throw err;
  }
}

module.exports = {
  loginAndSaveToken,
  startLoginSession,
  submitGuardCode,
  removePendingSession
};
