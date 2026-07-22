"use strict";

const SteamTotp = require("steam-totp");
const {LoginSession, EAuthSessionGuardType, EAuthTokenPlatformType} = require("steam-session");

const {ensureAuthApiReachable} = require("./networkPrecheck");
const {getSteamSessionProxyOptions} = require("./proxyConfig");
const {createSteamGuardCoexistWorkerCore} = require("./steamGuardCoexistWorkerCore");
const {createSteamGuardSteamAdapter} = require("./steamGuardSteamAdapter");
const {asString, withTimeout} = require("./utils");

const LOGIN_TIMEOUT_MS = 45 * 1000;

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function hasGuard(validActions, guardType) {
  return Array.isArray(validActions)
    && validActions.some((entry) => Number(entry && entry.type) === Number(guardType));
}

function steamId64(session) {
  try {
    if (session && session.steamID && typeof session.steamID.getSteamID64 === "function") {
      return text(session.steamID.getSteamID64());
    }
    return text(session && session.steamID);
  } catch (_) {
    return "";
  }
}

function createAuthenticatedWait(session) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      session.removeListener("authenticated", onAuthenticated);
      session.removeListener("timeout", onTimeout);
      session.removeListener("error", onError);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onAuthenticated = () => finish();
    const onTimeout = () => finish(new Error("Steam login timed out"));
    const onError = (error) => finish(error instanceof Error ? error : new Error(text(error)));
    session.once("authenticated", onAuthenticated);
    session.once("timeout", onTimeout);
    session.once("error", onError);
  });
}

function createMobileAppLoginController({timeoutMs = LOGIN_TIMEOUT_MS} = {}) {
  let session = null;
  let waitAuth = null;
  const timeout = Math.max(5000, Number(timeoutMs) || LOGIN_TIMEOUT_MS);

  const authenticatedResult = async () => {
    await withTimeout(waitAuth, timeout, "Steam MobileApp authenticate timeout");
    return {
      status: "Authenticated",
      refreshToken: text(session && session.refreshToken),
      accessToken: text(session && session.accessToken),
      steamId64: steamId64(session)
    };
  };

  return {
    async start({username, password}) {
      await ensureAuthApiReachable({force: true, timeoutMs: Math.min(5000, timeout)});
      session = new LoginSession(EAuthTokenPlatformType.MobileApp, getSteamSessionProxyOptions());
      try { session.loginTimeout = timeout; } catch (_) {}
      waitAuth = createAuthenticatedWait(session);
      waitAuth.catch(() => {});

      const response = await withTimeout(
        session.startWithCredentials({accountName: text(username), password: String(password)}),
        timeout,
        "Steam MobileApp login start timeout"
      );
      const validActions = Array.isArray(response && response.validActions) ? response.validActions : [];
      if (response && response.actionRequired) {
        if (
          hasGuard(validActions, EAuthSessionGuardType.DeviceCode)
          || hasGuard(validActions, EAuthSessionGuardType.DeviceConfirmation)
        ) {
          return {status: "Requires2FA"};
        }
        if (hasGuard(validActions, EAuthSessionGuardType.EmailCode)) {
          const action = validActions.find((entry) => Number(entry && entry.type) === Number(EAuthSessionGuardType.EmailCode));
          return {
            status: "RequiresEmailAuth",
            guardHint: text(action && action.detail)
          };
        }
        if (!hasGuard(validActions, EAuthSessionGuardType.EmailConfirmation)) {
          return {status: "UnsupportedLoginState"};
        }
      }
      return authenticatedResult();
    },

    async submitEmailCode({code}) {
      if (!session || !waitAuth) throw new Error("Steam MobileApp login session is missing");
      await withTimeout(
        session.submitSteamGuardCode(text(code)),
        timeout,
        "Steam MobileApp email code timeout"
      );
      return authenticatedResult();
    },

    cancel() {
      const active = session;
      session = null;
      waitAuth = null;
      if (active) {
        try { active.cancelLoginAttempt(); } catch (_) {}
      }
    }
  };
}

const steamAdapter = createSteamGuardSteamAdapter();
const loginController = createMobileAppLoginController();
const core = createSteamGuardCoexistWorkerCore({
  loginController,
  addAuthenticator: steamAdapter.addAuthenticator,
  syncTimeOffset: steamAdapter.queryTimeOffset,
  generateTotpCode: (sharedSecret, offsetSeconds) => SteamTotp.generateAuthCode(sharedSecret, offsetSeconds)
});

let commandQueue = Promise.resolve();

function safeSend(message, callback) {
  if (typeof process.send !== "function" || !process.connected) {
    if (callback) callback();
    return;
  }
  try {
    process.send(message, callback || (() => {}));
  } catch (_) {
    if (callback) callback();
  }
}

function exitAfterReply(message) {
  safeSend(message, () => setImmediate(() => process.exit(0)));
}

function isTerminal(result) {
  if (!result || result.ok === false) {
    return ![
      "app_code_mismatch",
      "time_sync_failed",
      "email_code_required",
      "invalid_email_code",
      "invalid_code_format"
    ].includes(text(result && result.reason));
  }
  return result.state === "verified";
}

async function handleMessage(message) {
  if (!message || typeof message !== "object") return;
  const requestId = text(message.request_id);
  let result;
  if (message.type === "start") {
    result = await core.start({
      flowId: text(message.flow_id),
      username: text(message.username),
      password: message.password === undefined || message.password === null ? "" : String(message.password)
    });
  } else if (message.type === "submit_email_code") {
    result = await core.submitEmailCode({code: text(message.code)});
  } else if (message.type === "verify_app_code") {
    result = await core.verifyAppCode({code: text(message.code)});
  } else {
    result = {ok: false, reason: "invalid_worker_command"};
  }

  const response = {type: "result", request_id: requestId, result};
  if (isTerminal(result)) exitAfterReply(response);
  else safeSend(response);
}

process.on("message", (message) => {
  commandQueue = commandQueue
    .then(() => handleMessage(message))
    .catch(() => exitAfterReply({
      type: "result",
      request_id: text(message && message.request_id),
      result: {ok: false, reason: "coexist_worker_failed"}
    }));
});

process.on("disconnect", () => {
  core.cancel();
  process.exit(0);
});
