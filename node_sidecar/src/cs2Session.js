const readline = require("readline");
const SteamUser = require("steam-user");
const GlobalOffensive = require("globaloffensive");
const {withTimeout, asString} = require("./utils");
const {AccountStore} = require("./accountStore");
const {attachGcTrace, observeGcArmoryState, readGcArmoryState, readGcTraceMessages} = require("./gcTrace");
const {probeCmReachability} = require("./networkPrecheck");

const CS2_APP_ID = 730;
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;
const DEFAULT_OWNERSHIP_TIMEOUT_MS = 30000;

const CLAIM_ERROR_DETAILS = new Map([
  [2, {code: "cs2_license_claim_failed", detail: "Steam 返回通用错误", retryable: true}],
  [3, {code: "cs2_license_claim_no_connection", detail: "与 Steam 的连接已断开，请检查网络后重试", retryable: true}],
  [15, {code: "cs2_license_claim_access_denied", detail: "Steam 拒绝了免费许可请求，请在 Steam 商店确认账号可领取 CS2", retryable: false}],
  [16, {code: "cs2_license_claim_timeout", detail: "Steam 许可请求超时，请稍后重试", retryable: true}],
  [20, {code: "cs2_license_claim_service_unavailable", detail: "Steam 许可服务暂时不可用，请稍后重试", retryable: true}],
  [24, {code: "cs2_license_claim_insufficient_privilege", detail: "当前账号权限不足，Steam 未授予免费许可", retryable: false}],
  [25, {code: "cs2_license_claim_limit_exceeded", detail: "当前账号已达到 Steam 免费许可领取限制，请稍后重试", retryable: true}],
  [83, {code: "cs2_license_claim_region_locked", detail: "当前区服不允许领取该许可，请检查 Steam 商店区服状态", retryable: false}],
  [84, {code: "cs2_license_claim_rate_limited", detail: "请求过于频繁，请稍后重试", retryable: true}],
  [112, {code: "cs2_license_claim_limited_account", detail: "当前 Steam 账号受限，暂不允许领取免费许可", retryable: false}]
]);

function createCs2LicenseError(code, message, {cause = null, eresult = 0, retryable = false} = {}) {
  const err = new Error(message);
  err.code = code;
  err.reason = code;
  err.stage = "steam_app_license";
  err.status = 409;
  err.retryable = Boolean(retryable);
  const numericResult = Number(eresult);
  if (Number.isFinite(numericResult) && numericResult > 0) {
    err.eresult = numericResult;
    err.steam_eresult = numericResult;
  }
  if (cause) err.cause = cause;
  return err;
}

function steamResultCode(err) {
  const value = Number(err && (err.eresult || err.result || err.steam_eresult || 0));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function emitLicenseStatus({onStatus, logger, username}, payload) {
  if (typeof onStatus !== "function") return;
  try {
    await onStatus({
      username: asString(username).trim(),
      app_id: CS2_APP_ID,
      ...payload
    });
  } catch (err) {
    if (logger && typeof logger.warn === "function") {
      logger.warn("auth", `cs2 license status callback failed: account=${asString(username).trim()} error=${formatError(err)}`);
    }
  }
}

async function readStoredLicenseVerification(verificationStore, username) {
  if (!verificationStore || typeof verificationStore.isSteamAppLicenseVerified !== "function") {
    throw createCs2LicenseError(
      "cs2_license_state_unavailable",
      "CS2 入库验证状态存储不可用"
    );
  }
  try {
    return Boolean(await verificationStore.isSteamAppLicenseVerified(username, CS2_APP_ID));
  } catch (err) {
    if (err && err.stage === "steam_app_license") throw err;
    throw createCs2LicenseError(
      "cs2_license_state_read_failed",
      `CS2 入库验证状态读取失败：${asString(err && err.message ? err.message : err).trim() || "unknown_error"}`,
      {cause: err, retryable: true}
    );
  }
}

async function persistLicenseVerification(verificationStore, username) {
  if (!verificationStore || typeof verificationStore.markSteamAppLicenseVerified !== "function") {
    throw createCs2LicenseError(
      "cs2_license_state_unavailable",
      "CS2 入库验证状态存储不可用"
    );
  }
  try {
    const saved = await verificationStore.markSteamAppLicenseVerified(username, CS2_APP_ID);
    if (saved === false) throw new Error("verification store rejected the write");
  } catch (err) {
    if (err && err.stage === "steam_app_license") throw err;
    throw createCs2LicenseError(
      "cs2_license_state_write_failed",
      `CS2 已入库，但本地验证状态保存失败：${asString(err && err.message ? err.message : err).trim() || "unknown_error"}`,
      {cause: err, retryable: true}
    );
  }
}

function waitForOwnershipCache(steam, timeoutMs) {
  if (steam && steam.picsCache && steam.picsCache.ownershipModified) {
    return Promise.resolve();
  }
  const timeout = Math.max(1, Number(timeoutMs) || DEFAULT_OWNERSHIP_TIMEOUT_MS);
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (steam && typeof steam.removeListener === "function") {
        steam.removeListener("ownershipCached", onCached);
        steam.removeListener("disconnected", onDisconnected);
      }
    };
    const finish = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve();
    };
    const onCached = () => finish();
    const onDisconnected = (eresult, message) => {
      const numericResult = Number(eresult) || 0;
      const suffix = numericResult > 0 ? `（EResult ${numericResult}）` : "";
      const detail = asString(message).trim();
      finish(createCs2LicenseError(
        "cs2_license_check_disconnected",
        `CS2 入库检查中断：Steam 连接已断开${suffix}${detail ? `，${detail}` : ""}`,
        {eresult: numericResult, retryable: true}
      ));
    };
    if (!steam || typeof steam.once !== "function") {
      finish(createCs2LicenseError("cs2_license_check_failed", "CS2 入库检查失败：Steam 会话不可用"));
      return;
    }
    steam.once("ownershipCached", onCached);
    steam.once("disconnected", onDisconnected);
    timer = setTimeout(() => finish(createCs2LicenseError(
      "cs2_license_check_timeout",
      `CS2 入库检查超时（${Math.ceil(timeout / 1000)} 秒）：Steam 未返回游戏许可数据，请稍后重试`,
      {retryable: true}
    )), timeout);
  });
}

function mapClaimError(err) {
  const eresult = steamResultCode(err);
  const detail = CLAIM_ERROR_DETAILS.get(eresult);
  if (detail) {
    return createCs2LicenseError(
      detail.code,
      `CS2 领取失败：${detail.detail}（EResult ${eresult}）`,
      {cause: err, eresult, retryable: detail.retryable}
    );
  }
  const rawMessage = asString(err && err.message ? err.message : err).trim() || "unknown_error";
  return createCs2LicenseError(
    "cs2_license_claim_failed",
    `CS2 领取失败：${rawMessage}${eresult ? `（EResult ${eresult}）` : ""}`,
    {cause: err, eresult, retryable: true}
  );
}

async function ensureCs2License({
  steam,
  username,
  verificationStore,
  knownVerified,
  onStatus = null,
  logger = null,
  ownershipTimeoutMs = DEFAULT_OWNERSHIP_TIMEOUT_MS
} = {}) {
  const accountName = asString(username).trim();
  try {
    const verified = typeof knownVerified === "boolean"
      ? knownVerified
      : await readStoredLicenseVerification(verificationStore, accountName);
    if (verified) {
      return {app_id: CS2_APP_ID, verified: true, source: "verified_cache"};
    }

    await emitLicenseStatus({onStatus, logger, username: accountName}, {
      stage: "checking",
      message: "正在检查 CS2 是否已加入游戏库"
    });
    await waitForOwnershipCache(steam, ownershipTimeoutMs);

    let owned;
    try {
      owned = Boolean(steam && typeof steam.ownsApp === "function" && steam.ownsApp(CS2_APP_ID));
    } catch (err) {
      throw createCs2LicenseError(
        "cs2_license_check_failed",
        `CS2 入库检查失败：${asString(err && err.message ? err.message : err).trim() || "unknown_error"}`,
        {cause: err, retryable: true}
      );
    }
    if (owned) {
      await persistLicenseVerification(verificationStore, accountName);
      await emitLicenseStatus({onStatus, logger, username: accountName}, {
        stage: "owned",
        message: "CS2 已在游戏库中，正在连接游戏"
      });
      return {app_id: CS2_APP_ID, verified: true, source: "steam_ownership"};
    }

    await emitLicenseStatus({onStatus, logger, username: accountName}, {
      stage: "claiming",
      message: "账号尚未入库，正在领取 CS2 免费许可"
    });
    let claimResult;
    try {
      claimResult = await steam.requestFreeLicense([CS2_APP_ID]);
    } catch (err) {
      if (steamResultCode(err) === 30) {
        await persistLicenseVerification(verificationStore, accountName);
        await emitLicenseStatus({onStatus, logger, username: accountName}, {
          stage: "owned",
          message: "Steam 确认账号已拥有 CS2，正在连接游戏"
        });
        return {app_id: CS2_APP_ID, verified: true, source: "claim_already_owned"};
      }
      throw mapClaimError(err);
    }

    const grantedAppIds = Array.isArray(claimResult && claimResult.grantedAppIds)
      ? claimResult.grantedAppIds.map(Number)
      : [];
    const grantedPackageIds = Array.isArray(claimResult && claimResult.grantedPackageIds)
      ? claimResult.grantedPackageIds.map(Number).filter((value) => Number.isFinite(value) && value > 0)
      : [];
    if (!grantedAppIds.includes(CS2_APP_ID) && grantedPackageIds.length === 0) {
      let nowOwned = false;
      try { nowOwned = Boolean(steam.ownsApp(CS2_APP_ID)); } catch (_) {}
      if (!nowOwned) {
        throw createCs2LicenseError(
          "cs2_license_not_granted",
          "CS2 领取失败：Steam 未返回 App 730 或对应 package 的授权结果，请稍后重试",
          {retryable: true}
        );
      }
    }

    await persistLicenseVerification(verificationStore, accountName);
    await emitLicenseStatus({onStatus, logger, username: accountName}, {
      stage: "claimed",
      message: "CS2 领取成功，已加入游戏库"
    });
    return {app_id: CS2_APP_ID, verified: true, source: "free_license_grant"};
  } catch (err) {
    const normalized = err && err.stage === "steam_app_license"
      ? err
      : createCs2LicenseError(
        "cs2_license_check_failed",
        `CS2 入库检查失败：${asString(err && err.message ? err.message : err).trim() || "unknown_error"}`,
        {cause: err, retryable: true}
      );
    await emitLicenseStatus({onStatus, logger, username: accountName}, {
      stage: "failed",
      message: normalized.message,
      reason: normalized.reason,
      steam_eresult: normalized.steam_eresult || 0,
      eresult: normalized.eresult || 0,
      retryable: normalized.retryable === true
    });
    throw normalized;
  }
}

function normalizeMetaValue(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "object") {
    try {
      return asString(JSON.stringify(value)).trim();
    } catch (_) {
      return asString(value).trim();
    }
  }
  return asString(value).trim();
}

function formatError(err) {
  const message = asString(err && err.message ? err.message : err).trim() || "unknown_error";
  const code = asString(err && (err.eresult || err.code || "")).trim();
  return code ? `${message} code=${code}` : message;
}

function formatLoggedOnMeta(details) {
  if (!details || typeof details !== "object") {
    return "";
  }
  const parts = [];
  const publicIp = normalizeMetaValue(details.public_ip != null ? details.public_ip : details.ip_public);
  const cellId = normalizeMetaValue(details.cell_id != null ? details.cell_id : details.cellID);
  const steamId = normalizeMetaValue(details.client_supplied_steamid || details.steamid || "");
  if (cellId) {
    parts.push(`cell_id=${cellId}`);
  }
  if (publicIp) {
    parts.push(`public_ip=${publicIp}`);
  }
  if (steamId) {
    parts.push(`steamid=${steamId}`);
  }
  if (!parts.length) {
    const keys = Object.keys(details);
    if (keys.length) {
      parts.push(`logon_fields=${keys.length}`);
    }
  }
  return parts.join(" ");
}

function promptLine(question) {
  const rl = readline.createInterface({input: process.stdin, output: process.stdout});
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(asString(answer).trim());
    });
  });
}

class CS2Session {
  constructor({logger, tokenStore, licenseVerificationStore} = {}) {
    this.logger = logger;
    this.tokenStore = tokenStore;
    this.licenseVerificationStore = licenseVerificationStore || new AccountStore();
    this.steam = null;
    this.csgo = null;
  }

  async connect({
    username,
    password,
    refreshToken,
    refreshTokenOnly = false,
    timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    gcTrace,
    onLicenseStatus = null
  } = {}) {
    if (!username) {
      throw new Error("username required");
    }
    const accountName = asString(username).trim();
    const startedAt = Date.now();
    const timeout = Math.max(1, Number(timeoutMs) || DEFAULT_CONNECT_TIMEOUT_MS);
    let licenseVerified;
    try {
      licenseVerified = await readStoredLicenseVerification(this.licenseVerificationStore, accountName);
    } catch (err) {
      await emitLicenseStatus({onStatus: onLicenseStatus, logger: this.logger, username: accountName}, {
        stage: "failed",
        message: err.message,
        reason: err.reason,
        retryable: err.retryable === true
      });
      throw err;
    }
    const steam = new SteamUser({
      autoRelogin: false,
      renewRefreshTokens: true,
      enablePicsCache: !licenseVerified
    });
    const csgo = new GlobalOffensive(steam);

    this.steam = steam;
    this.csgo = csgo;

    const gcTraceOptions = gcTrace && typeof gcTrace === "object" ? gcTrace : {};
    attachGcTrace({
      steam,
      logger: this.logger,
      accountName,
      enabled: Object.prototype.hasOwnProperty.call(gcTraceOptions, "enabled")
        ? gcTraceOptions.enabled
        : undefined,
      onMessage: typeof gcTraceOptions.onMessage === "function" ? gcTraceOptions.onMessage : undefined
    });

    let guardAnswered = false;
    let gcStarted = false;
    let connectionAborted = false;

    steam.on("refreshToken", (token) => {
      const tokenValue = asString(token).trim();
      if (this.tokenStore) {
        this.tokenStore.set(accountName, tokenValue);
      }
      if (this.logger) {
        this.logger.info("auth", `refresh token updated: account=${accountName} token_len=${tokenValue.length}`);
      }
    });

    steam.on("steamGuard", async (domain, callback) => {
      guardAnswered = true;
      if (this.logger) {
        const guardFrom = asString(domain).trim();
        this.logger.info(
          "auth",
          `steam guard required: account=${accountName}${guardFrom ? ` domain=${guardFrom}` : " domain=<mobile_or_unknown>"}`
        );
      }
      const code = await promptLine(`Enter Steam Guard code${domain ? ` (${domain})` : ""}: `);
      callback(code);
      if (this.logger) {
        this.logger.info("auth", `steam guard code submitted: account=${accountName}`);
      }
    });

    const waitConnected = withTimeout(
      new Promise((resolve, reject) => {
        steam.once("error", (err) => {
          reject(new Error(`steam error: ${formatError(err)}`));
        });
        steam.once("disconnected", (eresult, msg) => {
          const reason = asString(msg).trim();
          const code = asString(eresult).trim();
          reject(new Error(`steam disconnected${code ? ` code=${code}` : ""}${reason ? ` reason=${reason}` : ""}`));
        });
        steam.once("loggedOn", (details) => {
          if (this.logger) {
            const elapsed = Date.now() - startedAt;
            const meta = formatLoggedOnMeta(details);
            this.logger.info(
              "auth",
              `steam logged on: account=${accountName} elapsed_ms=${elapsed}${meta ? ` ${meta}` : ""}`
            );
          }
          steam.setPersona(SteamUser.EPersonaState.Online);
          void ensureCs2License({
            steam,
            username: accountName,
            verificationStore: this.licenseVerificationStore,
            knownVerified: licenseVerified,
            onStatus: onLicenseStatus,
            logger: this.logger,
            ownershipTimeoutMs: Math.min(DEFAULT_OWNERSHIP_TIMEOUT_MS, Math.max(1, timeout - 1000))
          }).then(() => {
            if (connectionAborted) return;
            steam.gamesPlayed([CS2_APP_ID]);
            if (this.logger) {
              this.logger.info("auth", `steam gamesPlayed set: account=${accountName} app=${CS2_APP_ID}`);
            }
          }).catch((err) => {
            connectionAborted = true;
            reject(err);
          });
        });
        csgo.once("connectedToGC", () => {
          if (gcStarted) {
            return;
          }
          gcStarted = true;
          if (this.logger) {
            const elapsed = Date.now() - startedAt;
            this.logger.info("auth", `cs2 gc connected: account=${accountName} elapsed_ms=${elapsed}`);
          }
          resolve();
        });
        csgo.once("error", (err) => {
          reject(new Error(`cs2 gc error: ${formatError(err)}`));
        });
        csgo.on("disconnectedFromGC", () => {
          if (this.logger) {
            this.logger.warn("auth", `cs2 gc disconnected: account=${accountName}`);
          }
        });
      }),
      timeout,
      "connect timeout"
    );

    const details = {};
    const rt = asString(refreshToken || "").trim();
    const forceRefreshToken = !!refreshTokenOnly;
    const loginMode = rt ? "refresh_token" : (forceRefreshToken ? "refresh_token_only_missing" : "password");
    if (this.logger) {
      this.logger.info("auth", `steamgc login start: account=${accountName} mode=${loginMode} timeout_ms=${timeout}`);
    }

    try {
      const probe = await probeCmReachability({
        logger: this.logger,
        force: false
      });
      if (this.logger) {
        this.logger.info(
          "auth",
          `steamgc precheck: account=${accountName} reachable=${probe.reachable}/${probe.total}${probe.fastest ? ` fastest=${probe.fastest}` : ""}`
        );
        if (!probe.reachable) {
          this.logger.warn(
            "auth",
            `steamgc precheck warning: account=${accountName} no_cm_reachable=true, login may timeout`
          );
        }
      }
    } catch (err) {
      if (this.logger) {
        this.logger.warn(
          "auth",
          `steamgc precheck skipped: account=${accountName} error=${formatError(err)}`
        );
      }
    }

    if (rt) {
      details.refreshToken = rt;
      if (this.logger) {
        this.logger.info("auth", `login using refresh_token: account=${accountName}`);
      }
    } else if (forceRefreshToken) {
      const err = new Error("refresh token required");
      err.code = "refresh_token_required";
      throw err;
    } else {
      details.accountName = accountName;
      details.password = asString(password).trim();
      if (!details.password) {
        throw new Error("password required when no refresh_token");
      }
      if (this.logger) {
        this.logger.info("auth", `login using password: account=${accountName}`);
      }
    }

    if (this.logger) {
      this.logger.info("auth", `steam logOn request sent: account=${accountName} mode=${loginMode}`);
    }
    steam.logOn(details);
    try {
      await waitConnected;
    } catch (err) {
      connectionAborted = true;
      if (this.logger) {
        this.logger.warn(
          "auth",
          `steamgc login failed: account=${accountName} elapsed_ms=${Date.now() - startedAt} error=${formatError(err)}`
        );
      }
      throw err;
    }
    if (guardAnswered && this.logger) {
      this.logger.info("auth", `steam guard flow completed: account=${accountName}`);
    }
    if (this.logger) {
      this.logger.info("auth", `steamgc login ready: account=${accountName} elapsed_ms=${Date.now() - startedAt}`);
    }
    return {steam, csgo};
  }

  disconnect() {
    const steam = this.steam;
    this.steam = null;
    this.csgo = null;
    if (!steam) {
      return;
    }
    try {
      steam.logOff();
    } catch (_) {}
  }
}

module.exports = {
  CS2Session,
  ensureCs2License,
  createCs2LicenseError,
  attachGcTrace,
  observeGcArmoryState,
  readGcArmoryState,
  readGcTraceMessages
};
