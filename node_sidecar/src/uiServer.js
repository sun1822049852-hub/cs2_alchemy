const fs = require("fs");
const path = require("path");
const http = require("http");
const {randomUUID} = require("node:crypto");
const {URL} = require("url");
const {execSync} = require("child_process");
const {AccountStore} = require("./accountStore");
const {AppAuthStore} = require("./appAuthStore");
const {TokenStore} = require("./tokenStore");
const {UiStateStore} = require("./uiStateStore");
const {loginAndSaveToken, startLoginSession, submitGuardCode, removePendingSession} = require("./authService");
const {precheckAuthApi} = require("./networkPrecheck");
const {parseMaFile} = require("./maFileParser");
const {normalizeMaFileForExport, readSteamGuardSummary} = require("./steamGuardTokenService");
const {createSteamGuardImportService} = require("./steamGuardImportService");
const {createSteamGuardCoexistService} = require("./steamGuardCoexistService");
const {createSteamGuardCoexistProcessAdapter} = require("./steamGuardCoexistProcessAdapter");
const {TokenRecoveryError, createTokenRecoveryService, isRecoverableTokenError} = require("./tokenRecoveryService");
const {refreshAccessToken, refreshWebCookie, refreshWebCookieFromToken} = require("./steamWebSession");
const {fetchFullInventory} = require("./inventoryService");
const {parseTradeUrl, sendTradeOffer, confirmTradeOffer, acceptTradeOffer, cancelTradeOffer, steamId64ToAccountId} = require("./tradeService");
const {refreshInventory} = require("./refreshWorkflow");
const {createRefreshRuntime} = require("./services/refreshRuntime");
const {createSessionPool} = require("./services/sessionPool");
const {createComponentOpsService} = require("./services/componentOpsService");
const {createComponentTaskQueue} = require("./services/componentTaskQueue");
const {createCraftService} = require("./services/craftService");
const {createCraftTradeupWithComponentsService} = require("./services/craftTradeupWithComponentsService");
const {createWeaponArmoryService} = require("./services/weaponArmoryService");
const {requestUsesComponentSourceRecipes} = require("./services/craftExecutionGuard");
const {
  createCraftAssistService
} = require("./services/craftAssistService");
const {createCraftAssistWorkerPool} = require("./services/craftAssistWorkerPool");
const {quantizeMeanToTargetDomain} = require("./services/craftAssistFloat32Step");
const {buildCraftCandidateContext} = require("./services/craftCandidateService");
const {
  appendCraftDebugEvent,
  buildCraftAssistSelectionEvent
} = require("./craftDebugLog");
const {normalizeCraftAssistMaterialListCanonical} = require("../ui/craftAssistItemWearShared");
const {createCraftOutcomeCatalog} = require("./services/craftOutcomeCatalog");
const {createCraftOutcomePredictor} = require("./services/craftOutcomePredictor");
const {createTradeupSimulationCatalog} = require("./services/tradeupSimulationCatalog");
const {createTradeupSimulationService} = require("./services/tradeupSimulationService");
const {createSnapshotRowsLoader} = require("./services/snapshotRowsLoader");
const {buildComponentSummary: buildSharedComponentSummary} = require("./services/componentSummary");
const {saveWebInventoryFetchArtifact} = require("./services/webInventoryFetchArtifactStore");
const {
  enrichInventoryDisplayOnlyImages
} = require("./services/inventoryDisplayImageEnrichment");
const {DedupLogger} = require("./logger");
const {getLicenseConfig} = require("./licenseConfig");
const {createControlPlaneAuthClient} = require("./controlPlaneAuthClient");
const {resolveDeviceId} = require("./deviceIdentity");
const {LicenseStore} = require("./licenseStore");
const {createLicenseEnforcer} = require("./licenseEnforcer");
const {createLicenseScheduler} = require("./licenseScheduler");
const {bootstrapDevLicense, createDevLicenseBundle} = require("./devLicenseBootstrap");
const {asString, toInt, nowString} = require("./utils");
const {PATHS, STORAGE_UNIT_DEF_INDEX, STORAGE_UNIT_CAPACITY} = require("./constants");
const { sellItem, getPriceOverview, calculateBuyerPrice, calculateSellerPrice, getMarketConfirmations, confirmMarketListings } = require("./steamMarketService");
const { checkBansBatch, checkBanSingle, formatBanStatus, fetchBalance, fetchTradeUrl } = require("./steamAccountTools");
const { getSteamApiKey, setSteamApiKey } = require("./steamApiKeyStore");

const UI_DIR = path.resolve(__dirname, "..", "ui");
const SESSION_COOKIE_NAME = "cs2_alchemy_session";
const SESSION_TTL_DAYS = 7;
const logger = new DedupLogger({windowMs: 800});
let sessionPool = null;
const recoveryTokenStore = {
  get(username) {
    return new TokenStore().get(username);
  },
  set(username, token) {
    return new TokenStore().set(username, token);
  },
  remove(username) {
    return new TokenStore().remove(username);
  }
};
const defaultTokenRecoveryService = createTokenRecoveryService({
  tokenStore: recoveryTokenStore,
  accountCredentialsProvider: async (username) => new AccountStore().getCredentials(username),
  loginWithCredentials: async ({username, password, guardCode}) => loginAndSaveToken({
    username,
    password,
    twoFactorCode: guardCode,
    persistToken: false,
    logger
  }),
  invalidateSessions: async (username) => {
    if (sessionPool) sessionPool.invalidate(username, "token_recovered");
  },
  clearStoredPassword: async (username) => {
    return new AccountStore().clearPassword(username);
  }
});
sessionPool = createSessionPool({logger, tokenRecoveryService: defaultTokenRecoveryService});
const componentOpsService = createComponentOpsService({sessionPool, logger});
const craftService = createCraftService({sessionPool, logger});
const weaponArmoryService = createWeaponArmoryService({sessionPool, logger});
const craftTradeupWithComponentsService = createCraftTradeupWithComponentsService({
  loadRowsForAccount: async ({username}) => loadRowsForAccountFromSnapshot(username),
  componentOpsService,
  craftService,
  logger
});
const craftAssistService = createCraftAssistService({logger});
const CRAFT_ASSIST_USE_WORKER_POOL = process.env.CRAFT_ASSIST_USE_WORKER_POOL !== "0";
const CRAFT_ASSIST_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
let craftAssistWorkerPool = null;
const snapshotRowsLoader = createSnapshotRowsLoader({limit: 6});
const activeCraftRuns = new Map();
const craftOperationRecords = new Map();
const CRAFT_OPERATION_RECORD_LIMIT = 1000;
const CRAFT_OPERATION_RECORD_TTL_MS = 60 * 60 * 1000;
let shutdownHooksInstalled = false;
let runtimeBootstrapped = false;
let defaultCraftOutcomePredictor = null;
let defaultTradeupSimulationCatalog = null;
let defaultTradeupSimulationService = null;

function getCraftOutcomePredictor(service) {
  if (service && typeof service.predict === "function") {
    return service;
  }
  if (!defaultCraftOutcomePredictor) {
    defaultCraftOutcomePredictor = createCraftOutcomePredictor({
      catalog: createCraftOutcomeCatalog({dbPath: PATHS.SKIN_DB_FILE})
    });
  }
  return defaultCraftOutcomePredictor;
}

function getTradeupSimulationCatalog(service) {
  if (service && typeof service.searchItems === "function") {
    return service;
  }
  if (!defaultTradeupSimulationCatalog) {
    defaultTradeupSimulationCatalog = createTradeupSimulationCatalog({dbPath: PATHS.SKIN_DB_FILE});
  }
  return defaultTradeupSimulationCatalog;
}

function getTradeupSimulationService(service, catalog) {
  if (service && typeof service.resolve === "function") {
    return service;
  }
  if (!defaultTradeupSimulationService) {
    defaultTradeupSimulationService = createTradeupSimulationService({
      catalog: catalog || getTradeupSimulationCatalog(),
      outcomeCatalog: createCraftOutcomeCatalog({dbPath: PATHS.SKIN_DB_FILE})
    });
  }
  return defaultTradeupSimulationService;
}

function getAuthStore(deps = {}, options = {}) {
  if (typeof deps.authStoreFactory === "function") {
    return deps.authStoreFactory(options);
  }
  return new AppAuthStore(options);
}

function getUiStateStore(deps = {}, viewerUsername = "") {
  if (typeof deps.uiStateStoreFactory === "function") {
    return deps.uiStateStoreFactory({viewerUsername});
  }
  return new UiStateStore(undefined, {viewerUsername});
}

function resolveAccountViewerUsername(auth) {
  if (auth && Object.prototype.hasOwnProperty.call(auth, "accountViewerUsername")) {
    return asString(auth.accountViewerUsername).trim();
  }
  return asString(auth && auth.user && auth.user.username ? auth.user.username : "").trim();
}

function getViewerAccountStore(auth, deps = {}) {
  const viewerUsername = resolveAccountViewerUsername(auth);
  if (typeof deps.accountStoreFactory === "function") {
    const custom = deps.accountStoreFactory({viewerUsername});
    if (custom) {
      return custom;
    }
  }
  return new AccountStore({
    dbPath: auth && auth.store ? auth.store.dbPath : PATHS.SKIN_DB_FILE,
    accountsFilePath: auth && auth.store ? auth.store.accountsFilePath : PATHS.ACCOUNTS_FILE,
    viewerUsername
  });
}

/**
 * 为任意账号解析 Web Session（优先 maFile，fallback 到 TokenStore refresh_token）
 * @param {object} account — accountStore.get() 返回的行
 * @returns {{ webSession, hasMaFile: boolean }}
 */
async function resolveWebSessionForAccount(account, {tokenRecoveryService = null} = {}) {
  if (!account) throw new Error("账号不存在");
  const username = asString(account.username).trim();

  // 优先 maFile
  if (account.mafile_content) {
    let maData = null;
    try {
      maData = parseMaFile(account.mafile_content);
    } catch (err) {
      logMaFileParseFallback(username, err);
      return refreshWebSessionFromTokenStore(account, {
        username,
        maData: null,
        hasMaFile: false,
        tokenRecoveryService
      });
    }
    try {
      const webSession = await refreshWebCookie(maData);
      return {webSession, hasMaFile: true, maData};
    } catch (err) {
      return refreshWebSessionFromTokenStore(account, {
        username,
        maData,
        hasMaFile: true,
        fallbackError: err,
        tokenRecoveryService
      });
    }
  }

  // fallback: TokenStore refresh_token
  return refreshWebSessionFromTokenStore(account, {
    username,
    maData: null,
    hasMaFile: false,
    tokenRecoveryService
  });
}

function getTokenStore(deps = {}) {
  if (typeof deps.tokenStoreFactory === "function") {
    const custom = deps.tokenStoreFactory();
    if (custom) return custom;
  }
  return new TokenStore();
}

function getAccountCredentials(accountStore, username) {
  if (accountStore && typeof accountStore.getCredentials === "function") {
    return accountStore.getCredentials(username);
  }
  return accountStore && typeof accountStore.get === "function" ? accountStore.get(username) : null;
}

function createServerSteamGuardCoexistService(options = {}) {
  if (options.steamGuardCoexistService) return options.steamGuardCoexistService;
  const processAdapter = options.steamGuardProcessAdapter || createSteamGuardCoexistProcessAdapter();

  return createSteamGuardCoexistService({
    processAdapter,
    completeBinding: async ({mode, accountId, accountName, password, remark, steamId64, maFileContent}) => {
      const viewerUsername = asString(accountId).trim();
      const accountStore = typeof options.accountStoreFactory === "function"
        ? options.accountStoreFactory({viewerUsername})
        : new AccountStore({viewerUsername});
      if (mode === "existing") {
        accountStore.updateSteamGuard(accountName, {
          mafile_content: maFileContent,
          steam_id64: steamId64
        });
        return;
      }
      if (getAccountCredentials(accountStore, accountName)) {
        throw new Error("local_account_exists");
      }
      accountStore.createGuardOnlyAccount({
        username: accountName,
        password,
        remark,
        steam_id64: steamId64,
        mafile_content: maFileContent,
        set_active: true
      });
      const uiState = typeof options.uiStateStoreFactory === "function"
        ? options.uiStateStoreFactory({viewerUsername})
        : new UiStateStore(undefined, {viewerUsername});
      if (uiState && typeof uiState.setLastSelected === "function") {
        uiState.setLastSelected(accountName);
      }
    }
  });
}

function steamGuardCoexistMessage(reason) {
  const messages = {
    local_guard_exists: "该账号本地已保存 Steam Guard，请使用令牌管理",
    local_account_exists: "该账号已保存，请改用选择已有账号",
    already_has_authenticator: "该 Steam 账号已经绑定令牌，联合绑定仅支持尚未绑定令牌的账号；不会移除或替换现有令牌",
    already_has_authenticator_cooldown: "该账号刚被 Steam 判定为已绑定令牌，请等待60秒后重试",
    email_code_required: "请输入邮箱验证码",
    invalid_email_code: "邮箱验证码错误，请重新输入",
    invalid_code_format: "验证码必须为5位大写字母或数字",
    app_code_mismatch: "动态码不一致，请确认已在 Steam App 中完成绑定",
    time_sync_failed: "Steam 服务器时间同步失败，请检查网络后重试",
    flow_not_found: "绑定进程已不存在，请重新开始",
    persistence_failed: "令牌保存失败",
    access_token_missing: "Steam 登录成功但未返回 MobileApp access token，请重新开始绑定",
    refresh_token_missing: "Steam 登录成功但未返回 refresh token，请重新开始绑定",
    steam_id_missing: "Steam 登录成功但未返回 SteamID，请重新开始绑定",
    add_authenticator_failed: "Steam Guard 令牌数据获取失败，请稍后重试",
    invalid_authenticator_response: "Steam 返回的令牌数据不完整，请重新开始绑定",
    coexist_worker_failed: "Steam Guard 独立绑定进程异常结束，请重新开始绑定",
    coexist_worker_invalid_response: "Steam Guard 独立绑定进程返回异常，请重新开始绑定",
    totp_generation_failed: "本地令牌数据无效，无法计算动态码",
    password_required: "password is required",
    username_required: "username is required"
  };
  return messages[reason] || "Steam Guard 联合绑定失败";
}

function steamGuardCoexistStatus(result) {
  if (result && result.ok) return 200;
  const reason = asString(result && result.reason).trim();
  if (["local_guard_exists", "local_account_exists", "already_has_authenticator"].includes(reason)) return 409;
  if (reason === "already_has_authenticator_cooldown") return 429;
  if (reason === "flow_not_found") return 410;
  if (reason === "app_code_mismatch") return 422;
  if (["invalid_email_code", "invalid_code_format"].includes(reason)) return 400;
  if (reason === "time_sync_failed") return 503;
  if (reason === "persistence_failed") return 500;
  if ([
    "login_failed",
    "access_token_missing",
    "refresh_token_missing",
    "steam_id_missing",
    "add_authenticator_failed",
    "invalid_authenticator_response",
    "coexist_worker_failed",
    "coexist_worker_invalid_response"
  ].includes(reason)) return 502;
  return 400;
}

function buildSteamGuardCoexistResponse(result) {
  const value = result && typeof result === "object" ? result : {ok: false, reason: "unknown_error"};
  const payload = {
    ok: !!value.ok,
    state: asString(value.state).trim(),
    reason: asString(value.reason).trim(),
    message: value.ok ? "" : steamGuardCoexistMessage(value.reason),
    flow_id: asString(value.flow_id).trim(),
    guard_hint: asString(value.guard_hint).trim(),
    retry_after_seconds: Number(value.retry_after_seconds) || 0,
    mode: asString(value.mode).trim(),
    account_name: asString(value.account_name).trim(),
    steam_id64: asString(value.steam_id64).trim(),
    file_name: asString(value.file_name).trim()
  };
  if (Number(value.http_status)) payload.http_status = Number(value.http_status);
  if (Number(value.steam_status)) payload.steam_status = Number(value.steam_status);
  if (Array.isArray(value.missing_fields) && value.missing_fields.length) {
    payload.missing_fields = value.missing_fields.map((field) => asString(field).trim()).filter(Boolean);
  }
  for (const key of Object.keys(payload)) {
    if (payload[key] === "" || payload[key] === 0) delete payload[key];
  }
  return payload;
}

function maFileParseFailureReason(err) {
  const message = asString(err && err.message ? err.message : err).trim();
  if (/shared_secret/i.test(message)) {
    return "missing_shared_secret";
  }
  if (/json|parse|unexpected/i.test(message)) {
    return "invalid_json";
  }
  return "invalid_mafile";
}

function logMaFileParseFallback(username, err) {
  logger.warn(
    "web_session",
    `mafile parse skipped: account=${sanitizeLogValue(username) || "-"} reason=${maFileParseFailureReason(err)}`
  );
}

async function refreshWebSessionFromTokenStore(account, {
  username,
  maData = null,
  hasMaFile = false,
  fallbackError = null,
  tokenRecoveryService = null
} = {}) {
  const tokenStore = new TokenStore();
  const createWebSession = async (refreshToken) => {
    // 需要 steamId64 — 从 maFile 或 account 的 steam_id64 / steam_id 字段取
    let steamId64 = asString(maData && maData.steamId64 ? maData.steamId64 : "").trim();
    if (!steamId64) {
      steamId64 = asString(account.steam_id64 || "").trim();
    }
    if (!steamId64) {
      steamId64 = asString(account.steam_id || "").trim();
    }
    if (!steamId64) {
      if (fallbackError) {
        throw fallbackError;
      }
      throw new Error(`账号 ${username} 缺少 steamId64，无法组装 Web Cookie（请先通过连接刷新获取）`);
    }

    const webSession = await refreshWebCookieFromToken(refreshToken, steamId64);
    return {webSession, hasMaFile: Boolean(hasMaFile), maData: maData || null};
  };
  if (tokenRecoveryService && typeof tokenRecoveryService.withTokenRecovery === "function") {
    return tokenRecoveryService.withTokenRecovery(username, createWebSession);
  }
  const refreshToken = tokenStore.get(username);
  if (!refreshToken) {
    if (fallbackError) throw fallbackError;
    throw new Error(`账号 ${username} 既无 maFile 也无 refresh_token，无法获取 Web Session`);
  }
  return createWebSession(refreshToken);
}

async function runAccountWebOperation(account, {tokenRecoveryService = null} = {}, operation) {
  if (typeof operation !== "function") {
    throw new TypeError("operation must be a function");
  }
  const username = asString(account && account.username).trim();
  const initialSession = await resolveWebSessionForAccount(account, {tokenRecoveryService});
  try {
    return await operation(initialSession);
  } catch (err) {
    if (
      !isRecoverableTokenError(err)
      || !tokenRecoveryService
      || typeof tokenRecoveryService.recoverToken !== "function"
    ) {
      throw err;
    }

    const replacementToken = await tokenRecoveryService.recoverToken(username);
    let maData = initialSession.maData || null;
    if (!maData && account && account.mafile_content) {
      try {
        maData = parseMaFile(account.mafile_content);
      } catch (_) {
        maData = null;
      }
    }
    const steamId64 = asString(
      (maData && maData.steamId64)
      || (account && account.steam_id64)
      || (account && account.steam_id)
    ).trim();
    if (!steamId64) {
      throw new TokenRecoveryError("steam_id_missing", "该账号缺少 SteamID，无法恢复 Web 登录", {cause: err});
    }
    const retrySession = {
      webSession: await refreshWebCookieFromToken(replacementToken, steamId64),
      hasMaFile: Boolean(initialSession.hasMaFile),
      maData
    };
    try {
      return await operation(retrySession);
    } catch (retryErr) {
      if (isRecoverableTokenError(retryErr)) {
        throw new TokenRecoveryError(
          "refresh_token_rejected_after_recovery",
          "Steam 仍拒绝新的登录凭据，请检查账号密码或 Guard",
          {cause: retryErr}
        );
      }
      throw retryErr;
    }
  }
}

function sanitizeLogValue(value) {
  return asString(value).replace(/\s+/g, " ").trim();
}

function maskLogValue(value, keep = 8) {
  const text = sanitizeLogValue(value);
  if (!text) {
    return "-";
  }
  if (text.length <= keep) {
    return text;
  }
  return `${text.slice(0, keep)}...`;
}

function summarizeWebSessionForLog(webSession) {
  const session = webSession && typeof webSession === "object" ? webSession : {};
  return [
    `steam_id=${sanitizeLogValue(session.steamId64) || "-"}`,
    `fallback=${session.isFallbackCookie ? "yes" : "no"}`,
    `sessionid=${maskLogValue(session.sessionid)}`,
    `cookie_len=${sanitizeLogValue(String((session.cookieString || "").length)) || "0"}`
  ].join(" ");
}

function logWebInventoryFetchTrace({username, mode, trace}) {
  const account = sanitizeLogValue(username) || "-";
  const fetchMode = sanitizeLogValue(mode) || "single";
  const payload = trace && typeof trace === "object" ? trace : {};
  const page = Number.isFinite(Number(payload.pageIndex)) ? Number(payload.pageIndex) + 1 : 1;
  const scope = "web_inventory_fetch";
  if (payload.phase === "request") {
    logger.info(
      scope,
      `account=${account} mode=${fetchMode} phase=request page=${page} start_assetid=${sanitizeLogValue(payload.startAssetId) || "-"} url=${sanitizeLogValue(payload.url) || "-"} cookie=${sanitizeLogValue(payload.cookieSummary) || "-"}`
    );
    return;
  }
  if (payload.phase === "response") {
    logger.info(
      scope,
      `account=${account} mode=${fetchMode} phase=response page=${page} status=${Number(payload.statusCode) || 0} assets=${Number(payload.assetCount) || 0} descriptions=${Number(payload.descriptionCount) || 0} more=${Number(payload.moreItems) || 0} last_assetid=${sanitizeLogValue(payload.lastAssetId) || "-"} body=${sanitizeLogValue(payload.bodySnippet) || "-"}`
    );
    return;
  }
  if (payload.phase === "error") {
    logger.warn(
      scope,
      `account=${account} mode=${fetchMode} phase=error page=${page} status=${Number(payload.statusCode) || 0} message=${sanitizeLogValue(payload.message) || "-"} body=${sanitizeLogValue(payload.bodySnippet) || "-"}`
    );
  }
}

function getLicenseRuntime(deps = {}) {
  if (deps.__licenseRuntime) {
    return deps.__licenseRuntime;
  }
  const config = getClientLicenseConfig(deps);
  if (typeof deps.licenseRuntimeFactory === "function") {
    deps.__licenseRuntime = deps.licenseRuntimeFactory();
    return deps.__licenseRuntime;
  }
  const store = new LicenseStore(config.licenseStateFile);
  const deviceId = resolveDeviceId(config.machineIdFile);
  const enforcer = createLicenseEnforcer({
    publicKeyFile: config.publicKeyFile,
    deviceId
  });
  const scheduler = createLicenseScheduler({
    store,
    enforcer,
    refreshIntervalMs: config.refreshIntervalMs,
    refreshThresholdMs: config.refreshIntervalMs,
    refreshFn: async () => {
      if (config.authMode === "dev_auto_bundle") {
        return createDevLicenseBundle({config, deviceId});
      }
      const authClient = getControlPlaneAuthClient(deps);
      if (!authClient || typeof authClient.refresh !== "function") {
        return null;
      }
      const currentBundle = store.read();
      const refreshCredential = asString(currentBundle && currentBundle.refresh_credential).trim();
      if (!refreshCredential) {
        return null;
      }
      try {
        const result = await authClient.refresh({
          refreshCredential,
          deviceId
        });
        if (!result || !result.bundle || typeof result.bundle !== "object") {
          return null;
        }
        return {
          ...result.bundle,
          refresh_credential: asString(result.refreshCredential || refreshCredential).trim() || refreshCredential,
          source: "local_control_plane_refresh"
        };
      } catch (err) {
        logger.warn("ui_server", `license refresh failed: ${asString(err && err.message ? err.message : err)}`);
        return null;
      }
    }
  });
  bootstrapDevLicense({
    config,
    scheduler,
    deviceId
  });
  scheduler.start();
  deps.__licenseRuntime = scheduler;
  return deps.__licenseRuntime;
}

function getClientLicenseConfig(deps = {}) {
  if (deps.__licenseConfig) {
    return deps.__licenseConfig;
  }
  deps.__licenseConfig = getLicenseConfig(typeof deps.licenseConfigFactory === "function" ? deps.licenseConfigFactory() : {});
  return deps.__licenseConfig;
}

function getClientDeviceId(deps = {}) {
  if (deps.__clientDeviceId) {
    return deps.__clientDeviceId;
  }
  deps.__clientDeviceId = resolveDeviceId(getClientLicenseConfig(deps).machineIdFile);
  return deps.__clientDeviceId;
}

function getControlPlaneAuthClient(deps = {}) {
  if (deps.__controlPlaneAuthClient) {
    return deps.__controlPlaneAuthClient;
  }
  if (typeof deps.controlPlaneAuthClientFactory === "function") {
    deps.__controlPlaneAuthClient = deps.controlPlaneAuthClientFactory({
      config: getClientLicenseConfig(deps)
    });
    return deps.__controlPlaneAuthClient;
  }
  const config = getClientLicenseConfig(deps);
  deps.__controlPlaneAuthClient = createControlPlaneAuthClient({
    baseUrl: config.controlPlaneBaseUrl
  });
  return deps.__controlPlaneAuthClient;
}

function getCraftAssistWorkerPool() {
  if (!CRAFT_ASSIST_USE_WORKER_POOL) {
    return null;
  }
  if (!craftAssistWorkerPool) {
    craftAssistWorkerPool = createCraftAssistWorkerPool({logger, requestTimeoutMs: CRAFT_ASSIST_REQUEST_TIMEOUT_MS});
  }
  return craftAssistWorkerPool;
}

async function closeCraftAssistWorkerPool() {
  if (!craftAssistWorkerPool || typeof craftAssistWorkerPool.close !== "function") {
    return;
  }
  const pool = craftAssistWorkerPool;
  craftAssistWorkerPool = null;
  await pool.close();
}

function createActiveCraftRunController({username, runId}) {
  return {
    username: asString(username).trim(),
    runId: asString(runId).trim(),
    pauseRequested: false,
    requestPause() {
      this.pauseRequested = true;
    },
    shouldPause() {
      return this.pauseRequested;
    }
  };
}

function registerActiveCraftRun({username, runId}) {
  const key = asString(username).trim();
  if (!key) return null;
  if (activeCraftRuns.has(key)) return null;
  const controller = createActiveCraftRunController({username: key, runId});
  activeCraftRuns.set(key, controller);
  return controller;
}

function getActiveCraftRun(username) {
  const key = asString(username).trim();
  if (!key) return null;
  return activeCraftRuns.get(key) || null;
}

function releaseActiveCraftRun(username, controller) {
  const key = asString(username).trim();
  if (!key) return;
  if (activeCraftRuns.get(key) === controller) {
    activeCraftRuns.delete(key);
  }
}

function resolveCraftOperationId(body = {}) {
  const supplied = asString(body && body.operation_id).trim();
  if (!supplied) {
    return randomUUID();
  }
  if (supplied.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(supplied)) {
    const err = new Error("operation_id 格式无效");
    err.code = "invalid_operation_id";
    throw err;
  }
  return supplied;
}

function pruneCraftOperationRecords(now = Date.now()) {
  for (const [operationId, record] of craftOperationRecords.entries()) {
    if (record.completedAt && now - record.completedAt > CRAFT_OPERATION_RECORD_TTL_MS) {
      craftOperationRecords.delete(operationId);
    }
  }
  while (craftOperationRecords.size > CRAFT_OPERATION_RECORD_LIMIT) {
    const oldestCompleted = Array.from(craftOperationRecords.entries())
      .filter(([, record]) => record.completedAt)
      .sort((left, right) => left[1].completedAt - right[1].completedAt)[0];
    if (!oldestCompleted) break;
    craftOperationRecords.delete(oldestCompleted[0]);
  }
}

async function runCraftOperation({username, operationId, execute}) {
  pruneCraftOperationRecords();
  const existing = craftOperationRecords.get(operationId);
  if (existing) {
    if (existing.username !== username) {
      return {
        status: 409,
        payload: {
          ok: false,
          reason: "operation_id_conflict",
          message: "operation_id 已被其他账号使用",
          operation_id: operationId
        }
      };
    }
    return existing.promise;
  }

  const controller = registerActiveCraftRun({username, runId: operationId});
  if (!controller) {
    return {
      status: 409,
      payload: {
        ok: false,
        reason: "craft_already_running",
        message: "当前 Steam 账号已有炼金任务正在执行",
        operation_id: operationId
      }
    };
  }

  const record = {username, completedAt: 0, promise: null};
  record.promise = (async () => {
    try {
      return await execute(controller);
    } finally {
      record.completedAt = Date.now();
      releaseActiveCraftRun(username, controller);
      pruneCraftOperationRecords();
    }
  })();
  craftOperationRecords.set(operationId, record);
  return record.promise;
}

function logEncodingEnvironment() {
  const locale = asString(process.env.LC_ALL || process.env.LANG || process.env.LC_CTYPE || "").trim();
  let codePage = "";
  if (process.platform === "win32") {
    try {
      const out = execSync("chcp", {stdio: ["ignore", "pipe", "ignore"]}).toString("utf8");
      const m = out.match(/:\s*(\d+)/);
      codePage = m ? m[1] : "";
    } catch (_) {
      codePage = "";
    }
  }
  const localeUtf8 = /utf-?8/i.test(locale);
  const cpUtf8 = !codePage || codePage === "65001";
  if (localeUtf8 || cpUtf8) {
    logger.info("encoding", `encoding check passed: locale=${locale || "-"} codepage=${codePage || "-"}`);
  } else {
    logger.warn(
      "encoding",
      `encoding check failed: locale=${locale || "-"} codepage=${codePage || "-"}, 建议使用 UTF-8（Windows 可执行 chcp 65001）`
    );
  }
}

function ensureRuntimeBootstrapped() {
  if (runtimeBootstrapped) {
    return;
  }
  runtimeBootstrapped = true;
  refreshRuntime.start();
  if (!shutdownHooksInstalled) {
    shutdownHooksInstalled = true;
    const shutdown = () => {
      sessionPool.shutdown();
      void closeCraftAssistWorkerPool();
    };
    process.once("exit", shutdown);
    process.once("SIGINT", () => {
      shutdown();
      process.exit(0);
    });
    process.once("SIGTERM", () => {
      shutdown();
      process.exit(0);
    });
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let byteLength = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      byteLength += chunk.byteLength;
      if (byteLength > 64 * 1024) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        const error = new Error("JSON body exceeds 64KiB");
        error.code = "request_body_too_large";
        reject(error);
        return;
      }
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        const error = new Error(`invalid json body: ${err.message}`);
        error.code = "invalid_json";
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function validateLocalApiRequest(req) {
  const host = asString(req && req.headers && req.headers.host).trim().toLowerCase();
  const localPort = Number(req && req.socket && req.socket.localPort) || 0;
  const allowedHosts = new Set([
    `127.0.0.1:${localPort}`,
    `localhost:${localPort}`,
    `[::1]:${localPort}`
  ]);
  if (!localPort || !allowedHosts.has(host)) {
    return {status: 403, reason: "local_host_required", message: "本地 API 仅接受回环地址请求"};
  }
  const method = asString(req && req.method).toUpperCase();
  const origin = asString(req && req.headers && req.headers.origin).trim();
  const fetchSite = asString(req && req.headers && req.headers["sec-fetch-site"]).trim().toLowerCase();
  if ((origin && origin !== `http://${host}`) || fetchSite === "cross-site") {
    return {status: 403, reason: "cross_origin_request_denied", message: "拒绝跨站本地请求"};
  }
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return null;
  const declaredLength = Number(req && req.headers && req.headers["content-length"]) || 0;
  if (declaredLength > 64 * 1024) {
    return {status: 413, reason: "request_body_too_large", message: "JSON 请求体不能超过 64KiB"};
  }
  const hasBody = declaredLength > 0 || !!(req && req.headers && req.headers["transfer-encoding"]);
  const contentType = asString(req && req.headers && req.headers["content-type"]).trim().toLowerCase();
  if (hasBody && !/^application\/json(?:\s*;|$)/.test(contentType)) {
    return {status: 415, reason: "json_content_type_required", message: "请求体必须使用 application/json"};
  }
  return null;
}

function writeJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}

function isTruthyQueryFlag(value) {
  const text = asString(value).trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "on";
}

function attachWebInventoryStubArtifact(payload, {urlObj, pathname, username, snapshot, rows, component, fetchTime, connected, authState, authReason} = {}) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  if (!urlObj || !isTruthyQueryFlag(urlObj.searchParams.get("save_stub"))) {
    return payload;
  }
  try {
    const artifact = saveWebInventoryFetchArtifact({
      username,
      source: asString(urlObj.searchParams.get("source") || "").trim() || "unknown",
      route: pathname,
      snapshot,
      rows,
      component,
      fetchTime,
      connected,
      authState,
      authReason
    });
    payload.stub_artifact = {
      stub_path: artifact.stubPath,
      latest_stub_path: artifact.latestStubPath,
      log_path: artifact.logPath
    };
  } catch (err) {
    logger.warn("web_inventory_stub", `save failed: ${asString(err && err.message ? err.message : err)}`);
  }
  return payload;
}

function parseCookies(headerValue) {
  const raw = asString(headerValue).trim();
  if (!raw) {
    return {};
  }
  const out = {};
  for (const item of raw.split(";")) {
    const [key, ...rest] = item.split("=");
    const name = asString(key).trim();
    if (!name) {
      continue;
    }
    out[name] = decodeURIComponent(rest.join("="));
  }
  return out;
}

function buildSessionCookie(token, expiresAt) {
  const tokenText = encodeURIComponent(asString(token).trim());
  const parsed = Date.parse(asString(expiresAt).trim().replace(" ", "T"));
  const expires = Number.isFinite(parsed) ? new Date(parsed).toUTCString() : new Date(Date.now() + 7 * 86400000).toUTCString();
  return `${SESSION_COOKIE_NAME}=${tokenText}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`;
}

function buildExpiredSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function isPublicApiRoute(pathname) {
  return pathname === "/api/health"
    || pathname === "/api/license/state"
    || pathname === "/api/license/import"
    || pathname === "/api/license/clear"
    || pathname === "/api/client-auth/state"
    || pathname === "/api/client-auth/login"
    || pathname === "/api/client-auth/logout"
    || pathname === "/api/client-auth/register/send-code"
    || pathname === "/api/client-auth/register/verify-code"
    || pathname === "/api/client-auth/register/complete"
    || pathname === "/api/client-auth/register/readiness"
    || pathname === "/api/client-auth/register"
    || pathname === "/api/client-auth/password/send-reset-code"
    || pathname === "/api/client-auth/password/reset";
}

function resolveRequestAuth(req, deps = {}) {
  const runtime = getLicenseRuntime(deps);
  const state = runtime && typeof runtime.getState === "function" ? runtime.getState() : null;
  const fallbackStore = {
    dbPath: PATHS.SKIN_DB_FILE,
    accountsFilePath: PATHS.ACCOUNTS_FILE,
    canAccessSteamAccount() {
      return true;
    },
    close() {}
  };
  let store = null;
  try {
    store = getAuthStore(deps, {readOnly: true, initialize: false});
  } catch (_) {
    store = null;
  }
  const stateUsername = state && state.ok && state.user
    ? asString(state.user.username).trim()
    : "";
  const user = state && state.ok && state.user
    ? {
        username: stateUsername,
        display_name: asString(state.user.username).trim()
      }
    : null;
  return {
    store: store || fallbackStore,
    token: "",
    session: null,
    licenseState: state,
    licenseRuntime: runtime,
    user,
    permissions: Array.isArray(state && state.permissions) ? state.permissions : [],
    membership: state && state.user && state.user.membership_plan ? [state.user.membership_plan] : [],
    accountViewerUsername: ""
  };
}

function hasPermission(auth, code) {
  if (!auth || !auth.user) {
    return false;
  }
  return auth.permissions.includes(asString(code).trim());
}

function requirePermission(res, auth, code, message = "当前登录用户无权执行该操作") {
  if (hasPermission(auth, code)) {
    return true;
  }
  writeJson(res, 403, {ok: false, reason: "permission_denied", message});
  return false;
}

function parseOptionalIntegerBodyValue(value, label, {allowZero = true} = {}) {
  const raw = asString(value).trim();
  if (!raw) {
    return undefined;
  }
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`${label} must be an integer`);
  }
  const numeric = Number(raw);
  if (!Number.isInteger(numeric) || (!allowZero && numeric <= 0) || (allowZero && numeric < 0)) {
    throw new Error(`${label} must be ${allowZero ? ">= 0" : "> 0"}`);
  }
  return numeric;
}

function parseBooleanBodyValue(value, defaultValue = false) {
  const raw = asString(value).trim().toLowerCase();
  if (!raw) {
    return !!defaultValue;
  }
  if (raw === "1" || raw === "true" || raw === "yes") {
    return true;
  }
  if (raw === "0" || raw === "false" || raw === "no") {
    return false;
  }
  return !!defaultValue;
}

function buildLicenseStatePayload(state) {
  const value = state && typeof state === "object" ? state : {};
  return {
    ok: true,
    authenticated: !!value.ok,
    code: asString(value.code || "license_missing").trim() || "license_missing",
    message: asString(value.message || "缺少客户端授权").trim() || "缺少客户端授权",
    user: value.user && typeof value.user === "object" ? value.user : null,
    permissions: Array.isArray(value.permissions) ? value.permissions : [],
    membership: value.user && value.user.membership_plan ? [value.user.membership_plan] : [],
    feature_flags: value.featureFlags && typeof value.featureFlags === "object" ? value.featureFlags : {},
    expires_at: asString(value.expiresAt).trim(),
    expires_in_ms: Number(value.expiresInMs) || 0
  };
}

function buildClientAuthStatePayload(state, deps = {}) {
  const config = getClientLicenseConfig(deps);
  const authClient = getControlPlaneAuthClient(deps);
  const capabilities = authClient && typeof authClient.getCapabilities === "function"
    ? authClient.getCapabilities()
    : {configured: false, baseUrl: ""};
  return {
    ...buildLicenseStatePayload(state),
    auth_mode: asString(config.authMode || "debug_bundle").trim() || "debug_bundle",
    allow_manual_import: !!config.allowManualImport,
    auth_service_configured: !!capabilities.configured,
    auth_service_base_url: asString(capabilities.baseUrl || "").trim()
  };
}

function writeClientAuthError(res, err, fallbackMessage = "认证请求失败") {
  const status = Math.max(400, Number(err && err.status) || 500);
  writeJson(res, status, {
    ok: false,
    reason: asString(err && err.code || "auth_request_failed").trim() || "auth_request_failed",
    message: asString(err && err.message || fallbackMessage).trim() || fallbackMessage
  });
}

function requireSteamAccountAccess(res, auth, username) {
  const key = asString(username).trim();
  if (!key) {
    writeJson(res, 400, {ok: false, message: "username is required"});
    return false;
  }
  if (canAccessSteamAccount(auth, key)) {
    return true;
  }
  writeJson(res, 403, {ok: false, reason: "account_scope_denied", message: "当前登录用户无权访问该 Steam 账号"});
  return false;
}

function requireExistingSteamAccountAccess(res, auth, username) {
  const key = asString(username).trim();
  if (!key) {
    writeJson(res, 400, {ok: false, message: "username is required"});
    return false;
  }
  const store = auth && auth.store;
  if (!store || typeof store.getSteamAccountForUser !== "function") {
    return requireSteamAccountAccess(res, auth, key);
  }
  let existing = null;
  try {
    existing = store.getSteamAccountForUser("", key, {includeAll: true});
  } catch (_) {
    writeJson(res, 500, {ok: false, reason: "account_scope_check_failed", message: "Steam 账号权限校验失败"});
    return false;
  }
  if (!existing) {
    return true;
  }
  return requireSteamAccountAccess(res, auth, key);
}

function canAccessSteamAccount(auth, username) {
  const key = asString(username).trim();
  return !!(auth && auth.user && key);
}

function filterComponentTaskSnapshotForAuth(snapshot, auth) {
  const value = snapshot && typeof snapshot === "object" ? snapshot : {};
  const canViewJob = (job) => {
    const username = asString(job && job.username).trim();
    return !username || canAccessSteamAccount(auth, username);
  };
  const queued = (Array.isArray(value.queued) ? value.queued : [])
    .filter(canViewJob)
    .map((job, index) => ({
      ...job,
      queue_position: index + 1
    }));
  const running = value.running && canViewJob(value.running) ? value.running : null;
  return {
    ...value,
    running,
    queued,
    queued_count: queued.length,
    total_queued: queued.length
  };
}

function findComponentTaskJob(jobId) {
  const key = asString(jobId).trim();
  if (!key) {
    return null;
  }
  const snapshot = componentTaskQueue.getSnapshot("");
  const candidates = [
    snapshot && snapshot.running,
    ...(Array.isArray(snapshot && snapshot.queued) ? snapshot.queued : [])
  ].filter(Boolean);
  return candidates.find((job) => asString(job && job.job_id).trim() === key) || null;
}

function parseLooseBoolean(value) {
  if (value === true || value === 1) return true;
  const text = asString(value).trim().toLowerCase();
  return text === "1" || text === "true";
}

function normalizeRouteItemIds(ids) {
  return Array.from(new Set((Array.isArray(ids) ? ids : [])
    .map((value) => asString(value).trim())
    .filter(Boolean)));
}

function createCraftAssistRouteValidationError(code, message) {
  const err = new Error(message);
  err.code = code;
  err.status = 400;
  return err;
}

function normalizeCraftAssistRouteTarget(body, {allowEmpty = false} = {}) {
  const payload = body && typeof body === "object" ? body : {};
  const hasRaw = Object.prototype.hasOwnProperty.call(payload, "target_wear_raw");
  const hasTarget = Object.prototype.hasOwnProperty.call(payload, "target_wear");
  const rawCandidate = hasRaw ? asString(payload.target_wear_raw).trim() : "";
  const targetCandidate = hasTarget ? asString(payload.target_wear).trim() : "";
  if (allowEmpty && !rawCandidate && !targetCandidate) {
    return {targetWear: null, targetWearRaw: ""};
  }
  let rawText = "";
  let rawValue = null;
  if (hasRaw) {
    rawText = asString(payload.target_wear_raw).trim();
    rawValue = Number(rawText);
    if (!rawText || !Number.isFinite(rawValue) || rawValue < 0 || rawValue > 1) {
      throw createCraftAssistRouteValidationError(
        "invalid_target_wear",
        "target_wear_raw must be a finite number in [0, 1]"
      );
    }
  }

  const targetWear = Number(payload.target_wear);
  if (
    !Number.isFinite(targetWear) ||
    targetWear < 0 ||
    targetWear > 1 ||
    Math.fround(targetWear) !== targetWear
  ) {
    throw createCraftAssistRouteValidationError(
      "invalid_target_step",
      "target_wear must be an exact float32 number in [0, 1]"
    );
  }

  if (!hasRaw) {
    return {
      targetWear,
      targetWearRaw: String(targetWear)
    };
  }

  const expectedStep = Math.fround(rawValue);
  if (targetWear !== expectedStep) {
    throw createCraftAssistRouteValidationError(
      "invalid_target_step",
      "target_wear must equal Math.fround(Number(target_wear_raw))"
    );
  }

  return {
    targetWear,
    targetWearRaw: rawText
  };
}

function buildCraftAssistSelectRoutePayload(body, {rows = []} = {}) {
  const materialMode = asString(body && body.material_mode).trim().toLowerCase() === "rarity_tag"
    ? "rarity_tag"
    : "specific";
  const rarityTag = Math.trunc(Number(body && body.rarity_tag) || 0);
  if (materialMode === "rarity_tag" && (rarityTag < 1 || rarityTag > 3)) {
    throw createCraftAssistRouteValidationError("invalid_rarity_tag", "rarity_tag must be 1, 2, or 3");
  }
  const target = normalizeCraftAssistRouteTarget(body, {allowEmpty: materialMode === "rarity_tag"});
  const includeComponentItems = parseLooseBoolean(
    Object.prototype.hasOwnProperty.call(body || {}, "include_component_items")
      ? body.include_component_items
      : body && body.use_component_items
  );
  const includeCooling = parseLooseBoolean(body && body.include_cooling);
  const enableFastCraftAssist = parseLooseBoolean(body && body.enable_fast_craft_assist);
  const blockedIds = normalizeRouteItemIds(body && body.blocked_ids);
  const selectedItemIds = normalizeRouteItemIds(body && body.selected_item_ids);
  const effectiveSelectedItemIds = selectedItemIds.length ? selectedItemIds : blockedIds;
  const candidateRows = buildCraftCandidateContext({
    rows,
    includeComponentItems,
    includeCooling,
    selectedItemIds: effectiveSelectedItemIds
  }).candidateRows;
  return {
    request: {
      targetWear: target.targetWear,
      targetWearRaw: target.targetWearRaw,
      wearFilterMode: body && body.wear_filter_mode,
      wearApproachMode: body && body.wear_approach_mode,
      materials: normalizeCraftAssistMaterialListCanonical(body && body.materials, {
        rows: candidateRows,
        legacyWearFilterMode: body && body.wear_filter_mode,
        source: "renormalize"
      }),
      blockedIds,
      selectedItemIds: effectiveSelectedItemIds,
      includeComponentItems,
      includeCooling,
      wearOffset: body && body.wear_offset,
      wearOffsetPct: body && body.wear_offset_pct,
      enableFastCraftAssist,
      materialMode,
      rarityTag: materialMode === "rarity_tag" ? rarityTag : 0,
      previewOnly: parseLooseBoolean(body && body.preview_only),
      normalizeSpecialQuality: parseLooseBoolean(body && body.normalize_special_quality)
    },
    candidateRows
  };
}

function isCraftAssistPlainLanguageMessage(message) {
  const text = asString(message).trim();
  if (!text) {
    return false;
  }
  if (!/[\u4e00-\u9fff]/.test(text)) {
    return false;
  }
  return !/(float32|quantized|worker|snapshotpath|safetargetvalue|steam_precision_margin|candidaterows|target_wear|wear_filter_mode|wear_offset_pct|enable_fast_craft_assist|use_component_items|include_component_items|include_cooling)/i.test(text);
}

function parseCraftAssistBracketMaterialName(text) {
  const match = asString(text).match(/父类材料【([^】]+)】/);
  return match && match[1] ? match[1].trim() : "";
}

function parseCraftAssistQuantityShortfall(text) {
  const match = asString(text).match(/父类材料【([^】]+)】可用数量不足[:：]\s*需\s*(\d+)\s*[，,]\s*仅\s*(\d+)/);
  if (!match) {
    return null;
  }
  const materialName = asString(match[1]).trim();
  const requiredCount = Number(match[2]);
  const availableCount = Number(match[3]);
  if (!materialName || !Number.isFinite(requiredCount) || !Number.isFinite(availableCount)) {
    return null;
  }
  return {
    materialName,
    requiredCount,
    availableCount
  };
}

function normalizeCraftAssistFailure(input, {defaultStatus = 400, defaultCode = ""} = {}) {
  const payload = input && typeof input === "object" ? input : {};
  const explicitMessage = asString(payload.message).trim();
  const explicitDetail = asString(payload.detail).trim();
  const rawCode = asString(payload.code || payload.reason || "").trim();
  const rawDetail = explicitDetail || explicitMessage || asString(payload.error && payload.error.message ? payload.error.message : payload.error).trim();
  const rawMessage = explicitMessage || rawDetail;
  const lower = `${rawCode} ${rawDetail || rawMessage}`.toLowerCase();
  const lowerCode = rawCode.toLowerCase();
  const includesAny = (parts) => parts.some((part) => lower.includes(String(part || "").toLowerCase()));
  const codeIsAny = (codes) => codes.some((code) => lowerCode === String(code || "").toLowerCase());
  const explicitStatus = Math.trunc(Number(payload.status));
  const fallbackStatus = Math.trunc(Number(defaultStatus));
  const safeDefaultStatus = fallbackStatus >= 400 && fallbackStatus <= 599 ? fallbackStatus : 500;
  const resolvedStatus = explicitStatus >= 400 && explicitStatus <= 599 ? explicitStatus : safeDefaultStatus;
  const enableFastCraftAssist = parseLooseBoolean(payload.enableFastCraftAssist);
  const detail = rawDetail || rawMessage || "craft assist failure";
  const genericMessages = {
    parameter: "辅助选材失败：请检查目标磨损和材料数量。",
    inventory: "辅助选材失败：当前库存里没有足够符合条件的材料。",
    target: "辅助选材失败：当前材料组合达不到目标磨损，请放宽磨损范围或更换材料。",
    internal: "辅助选材暂时失败，请重试。"
  };

  if (includesAny(["prefilter"])) {
    return {
      status: resolvedStatus >= 500 ? resolvedStatus : 500,
      payload: {
        ok: false,
        message: "快速选材预筛失败，请关闭快速模式。",
        detail,
        code: rawCode || "craft_assist_prefilter_failed"
      }
    };
  }

  if (codeIsAny(["worker_timeout"]) || includesAny(["craft assist worker timeout", "worker timeout", "timeout after"])) {
    return {
      status: resolvedStatus >= 500 ? resolvedStatus : 500,
      payload: {
        ok: false,
        message: enableFastCraftAssist
          ? "辅助选材计算超时，请缩小材料范围后重试。"
          : "辅助选材计算超时，请缩小材料范围或使用快速选材。",
        detail,
        code: rawCode || "worker_timeout"
      }
    };
  }

  if (codeIsAny(["worker_exited", "worker_crash", "worker_error"]) || includesAny(["worker exited", "worker crash", "worker error"])) {
    return {
      status: resolvedStatus >= 500 ? resolvedStatus : 500,
      payload: {
        ok: false,
        message: "辅助选材后台异常。",
        detail,
        code: rawCode || "craft_assist_worker_error"
      }
    };
  }

  if (codeIsAny(["final_result_not_on_target_step"]) || includesAny(["非目标 float32 台阶"])) {
    return {
      status: resolvedStatus,
      payload: {
        ok: false,
        message: "选材结果未通过最终校验，请放宽目标或更换材料。",
        detail,
        code: rawCode || "final_result_not_on_target_step"
      }
    };
  }

  if (codeIsAny(["account_required", "username_required"]) || includesAny(["username is required"])) {
    return {
      status: resolvedStatus,
      payload: {
        ok: false,
        message: "请先选择要选材的账号。",
        detail,
        code: "account_required"
      }
    };
  }

  if (
    codeIsAny(["target_step_invalid", "invalid_target_step"])
    || includesAny(["target_wear must equal math.fround(number(target_wear_raw))"])
    || includesAny(["exact float32", "target step invalid", "不是可用台阶", "可用台阶"])
  ) {
    return {
      status: resolvedStatus,
      payload: {
        ok: false,
        message: includesAny(["target_wear_raw", "math.fround(number(target_wear_raw))"])
          ? "目标磨损和原始输入不一致，请重新输入目标磨损。"
          : "目标磨损不是可用台阶，请用预测器或输入框生成的目标值。",
        detail,
        code: rawCode || "invalid_target_step"
      }
    };
  }

  if (
    codeIsAny(["invalid_target_wear", "target_wear"])
    || includesAny(["target_wear", "target_wear_raw", "请先输入目标相对磨损", "目标磨损为空", "目标磨损非法"])
    || (includesAny(["目标磨损必须"]) && !includesAny(["float32", "台阶"]))
  ) {
    return {
      status: resolvedStatus,
      payload: {
        ok: false,
        message: "请填写 0 到 1 之间的目标磨损。",
        detail,
        code: "invalid_target_wear"
      }
    };
  }

  if (codeIsAny(["snapshot_missing"]) || includesAny(["snapshot_missing", "库存快照不存在", "库存快照失效", "库存缓存已失效", "库存快照"])) {
    return {
      status: 409,
      payload: {
        ok: false,
        message: "库存缓存已失效，请先刷新该账号库存。",
        detail,
        code: "snapshot_missing"
      }
    };
  }

  if (includesAny(["candidaterows"])) {
    return {
      status: resolvedStatus,
      payload: {
        ok: false,
        message: "辅助选材上下文失效，请刷新库存后重试。",
        detail,
        code: "craft_assist_context_missing"
      }
    };
  }

  if (includesAny(["主库存无可选炼金物品"])) {
    return {
      status: resolvedStatus,
      payload: {
        ok: false,
        message: "当前库存没有可用于炼金的物品。",
        detail,
        code: "inventory_no_candidates"
      }
    };
  }

  const isCoolingShortfall = codeIsAny(["material_quantity_insufficient_cooling_filtered"]);
  const isBlockedShortfall = codeIsAny(["material_quantity_insufficient_blocked"]);
  const isGenericShortfall = codeIsAny(["material_quantity_insufficient"]);
  if (isCoolingShortfall || isBlockedShortfall || isGenericShortfall || includesAny(["可用数量不足"])) {
    const parsedQuantity = parseCraftAssistQuantityShortfall(detail);
    const materialName = parsedQuantity
      ? parsedQuantity.materialName
      : parseCraftAssistBracketMaterialName(detail);
    const fallbackQuantityMessage = parsedQuantity
      ? `材料【${parsedQuantity.materialName}】数量不足：需要 ${parsedQuantity.requiredCount} 件，当前可用 ${parsedQuantity.availableCount} 件。`
      : materialName
        ? `材料【${materialName}】数量不足，请调整材料范围。`
        : "配方要求的材料数量不足，请调整材料范围。";
    const specializedFallbackMessage = isCoolingShortfall
      ? (parsedQuantity
          ? `材料【${parsedQuantity.materialName}】数量不足：需要 ${parsedQuantity.requiredCount} 件，当前可用 ${parsedQuantity.availableCount} 件；有物品仍在冷却中，可勾选包含冷却物品或更换材料。`
          : materialName
            ? `材料【${materialName}】数量不足；有物品仍在冷却中，可勾选包含冷却物品或更换材料。`
            : "配方要求的材料数量不足；有物品仍在冷却中，可勾选包含冷却物品或更换材料。")
      : isBlockedShortfall
        ? (parsedQuantity
            ? `材料【${parsedQuantity.materialName}】数量不足：需要 ${parsedQuantity.requiredCount} 件，当前可用 ${parsedQuantity.availableCount} 件；部分物品已被本批次占用，请减少本批次配方或更换材料。`
            : materialName
              ? `材料【${materialName}】数量不足；部分物品已被本批次占用，请减少本批次配方或更换材料。`
              : "配方要求的材料数量不足；部分物品已被本批次占用，请减少本批次配方或更换材料。")
        : fallbackQuantityMessage;
    return {
      status: resolvedStatus,
      payload: {
        ok: false,
        message: specializedFallbackMessage,
        detail,
        code: rawCode || "material_quantity_insufficient"
      }
    };
  }

  if (includesAny(["无可用材料"])) {
    const materialName = parseCraftAssistBracketMaterialName(detail);
    return {
      status: resolvedStatus,
      payload: {
        ok: false,
        message: materialName
          ? `材料【${materialName}】库存中没有可用件。`
          : "配方要求的材料库存中没有可用件。",
        detail,
        code: "material_missing"
      }
    };
  }

  if (includesAny(["同稀有度数量要求", "稀有度不一致"])) {
    return {
      status: resolvedStatus,
      payload: {
        ok: false,
        message: "当前材料无法凑齐同一稀有度的 10 件。",
        detail,
        code: "rarity_requirement_unmet"
      }
    };
  }

  if (codeIsAny(["final_result_invalid"]) || includesAny(["final_result_invalid", "终局校验失败"])) {
    return {
      status: resolvedStatus,
      payload: {
        ok: false,
        message: "选材结果未通过最终校验，请放宽目标或更换材料。",
        detail,
        code: rawCode || "final_result_invalid"
      }
    };
  }

  if (includesAny([
    "无法找到可用逼近结果",
    "结果均值需小于目标磨损",
    "达不到目标磨损",
    "无法满足目标磨损",
    "cannot target below zero"
  ])) {
    return {
      status: resolvedStatus,
      payload: {
        ok: false,
        message: "当前材料组合达不到目标磨损，请放宽范围或更换材料。",
        detail,
        code: rawCode && rawCode !== "craft_assist_target_unreachable"
          ? rawCode
          : "target_unreachable"
      }
    };
  }

  if (isCraftAssistPlainLanguageMessage(rawMessage)) {
    return {
      status: resolvedStatus,
      payload: {
        ok: false,
        message: rawMessage,
        detail,
        code: rawCode || defaultCode || "craft_assist_failed"
      }
    };
  }

  if (includesAny([
    "craft assist worker",
    "worker timeout",
    "worker pool",
    "snapshotpath",
    "safetargetvalue",
    "steam_precision_margin",
    "timeout after",
    "quantized"
  ])) {
    return {
      status: resolvedStatus >= 500 ? resolvedStatus : 500,
      payload: {
        ok: false,
        message: genericMessages.internal,
        detail,
        code: rawCode || "craft_assist_internal_error"
      }
    };
  }

  if (includesAny([
    "目标磨损必须",
    "float32",
    "wear_filter_mode",
    "wear_offset",
    "wear_offset_pct",
    "enable_fast_craft_assist",
    "use_component_items",
    "include_component_items",
    "include_cooling"
  ]) || (!isCraftAssistPlainLanguageMessage(rawMessage) && includesAny(["invalid", "required", "must be"]))) {
    return {
      status: resolvedStatus,
      payload: {
        ok: false,
        message: isCraftAssistPlainLanguageMessage(rawMessage) ? rawMessage : genericMessages.parameter,
        detail,
        code: rawCode || "craft_assist_invalid_input"
      }
    };
  }

  if (includesAny(["timeout"])) {
    return {
      status: resolvedStatus >= 500 ? resolvedStatus : 500,
      payload: {
        ok: false,
        message: genericMessages.internal,
        detail,
        code: rawCode || "craft_assist_internal_error"
      }
    };
  }

  return {
    status: resolvedStatus >= 500 ? resolvedStatus : 500,
    payload: {
      ok: false,
      message: genericMessages.internal,
      detail,
      code: rawCode || defaultCode || "craft_assist_internal_error"
    }
  };
}

function normalizeLoginSaveError(err) {
  const raw = asString(err && err.message ? err.message : err).trim();
  const explicitReason = asString(err && (err.reason || err.code) || "").trim();
  const errorStage = asString(err && err.stage || "").trim();
  if (errorStage === "steam_app_license" || explicitReason.startsWith("cs2_license_")) {
    return {
      message: raw || "CS2 入库处理失败，请稍后重试",
      reason: explicitReason || "cs2_license_failed",
      status: Math.max(400, Number(err && err.status) || 409),
      raw,
      steam_eresult: Number(err && (err.steam_eresult || err.eresult) || 0) || 0,
      retryable: err && err.retryable === true
    };
  }
  const rawCode = asString(err && (err.eresult || err.code || err.result || "")).trim();
  const lower = raw.toLowerCase();
  const lowerCode = rawCode.toLowerCase();
  const numericCode = Number(rawCode);
  const includesAny = (parts) => parts.some((part) => lower.includes(String(part || "").toLowerCase()));
  const codeIsAny = (codes) => codes.some((code) => lowerCode === String(code || "").toLowerCase());
  const codeNumIsAny = (codes) => Number.isFinite(numericCode) && codes.some((code) => Number(code) === numericCode);
  const textHasCode = (codes) => codes.some((code) => {
    const value = String(code || "").trim();
    if (!value) {
      return false;
    }
    if (/^\d+$/.test(value)) {
      return new RegExp(`\\b(code|eresult)=${value}\\b`, "i").test(raw);
    }
    return new RegExp(`\\b${value}\\b`, "i").test(raw);
  });

  if (!raw && !rawCode) {
    return {
      message: "登录失败：未知错误，请稍后重试",
      reason: "unknown_error",
      status: 500,
      raw: ""
    };
  }

  if (
    includesAny(["steam auth api unreachable", "auth api precheck", "auth api precheck failed"]) ||
    includesAny(["enotfound", "econnrefused", "econnreset", "ehostunreach", "enetunreach", "networkerror", "fetch failed"]) ||
    codeIsAny(["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH"])
  ) {
    return {
      message: "无法连接 Steam 认证服务器，请检查网络或代理配置后重试",
      reason: "auth_api_unreachable",
      status: 503,
      raw
    };
  }
  if (includesAny(["refresh_token not received", "未获取到 refresh_token"]) || raw === "登录成功但未获取到 refresh_token") {
    return {
      message: "登录成功但未获取到 refresh_token，请稍后重试",
      reason: "refresh_token_missing",
      status: 502,
      raw
    };
  }
  if (
    includesAny(["invalidpassword", "incorrect password", "account name or password"]) ||
    textHasCode(["InvalidPassword", "5"]) ||
    codeIsAny(["InvalidPassword"]) ||
    codeNumIsAny([5])
  ) {
    return {
      message: "账号或密码错误，请确认后重试",
      reason: "invalid_password",
      status: 401,
      raw
    };
  }
  if (
    includesAny(["twofactorcodemismatch", "invalid authenticator code", "steam guard code"]) ||
    textHasCode(["TwoFactorCodeMismatch", "88"]) ||
    codeIsAny(["TwoFactorCodeMismatch"]) ||
    codeNumIsAny([88])
  ) {
    return {
      message: "令牌码错误，请输入当前有效的令牌码",
      reason: "totp_mismatch",
      status: 401,
      raw
    };
  }
  if (
    includesAny(["invalidloginauthcode", "email code", "accountlogondenied"]) ||
    textHasCode(["InvalidLoginAuthCode", "AccountLogonDenied", "65", "63"]) ||
    codeIsAny(["InvalidLoginAuthCode", "AccountLogonDenied"]) ||
    codeNumIsAny([65, 63])
  ) {
    return {
      message: "邮箱验证码错误，请输入最新验证码",
      reason: "email_code_mismatch",
      status: 401,
      raw
    };
  }
  if (
    includesAny(["ratelimit", "too many", "too_many_requests", "too many requests"]) ||
    textHasCode(["RateLimitExceeded", "84"]) ||
    codeIsAny(["RateLimitExceeded"]) ||
    codeNumIsAny([84])
  ) {
    return {
      message: "登录过于频繁，请稍后再试",
      reason: "rate_limited",
      status: 429,
      raw
    };
  }
  if (
    includesAny(["accessdenied"]) ||
    textHasCode(["AccessDenied", "15"]) ||
    codeIsAny(["AccessDenied"]) ||
    codeNumIsAny([15])
  ) {
    return {
      message: "登录被 Steam 拒绝，请稍后重试，必要时先在官方客户端完成一次登录确认",
      reason: "access_denied",
      status: 403,
      raw
    };
  }
  if (
    includesAny(["login timeout", "authenticate timeout", "start timeout", "submit guard timeout", "timeout("]) ||
    codeIsAny(["ETIMEDOUT", "ESOCKETTIMEDOUT"]) ||
    includesAny(["timeout"])
  ) {
    return {
      message: "登录超时，请在 Steam 客户端完成确认后重试",
      reason: "login_timeout",
      status: 504,
      raw
    };
  }
  if (includesAny(["deviceconfirmation", "emailconfirmation", "waiting confirmation"])) {
    return {
      message: "需要在 Steam 手机端确认本次登录，请确认后重试",
      reason: "device_confirmation_required",
      status: 401,
      raw
    };
  }
  if (
    includesAny(["totp required", "需要令牌码", "need two-factor"]) ||
    textHasCode(["AccountLoginDeniedNeedTwoFactor", "85"]) ||
    codeIsAny(["AccountLoginDeniedNeedTwoFactor"]) ||
    codeNumIsAny([85])
  ) {
    return {
      message: "缺少令牌码，请输入后重试",
      reason: "totp_required",
      status: 400,
      raw
    };
  }
  if (includesAny(["additional authentication is required", "guard action", "actionrequired"])) {
    return {
      message: "登录需要额外验证，请在 Steam 客户端完成验证后重试",
      reason: "additional_auth_required",
      status: 401,
      raw
    };
  }

  const fallbackMessage = raw || (rawCode ? `steam login failed (${rawCode})` : "登录失败：未知错误，请稍后重试");
  return {
    message: fallbackMessage,
    reason: "login_failed",
    status: 500,
    raw: fallbackMessage
  };
}

function isSteamAppLicenseError(err) {
  const stage = asString(err && err.stage || "").trim();
  const reason = asString(err && (err.reason || err.code) || "").trim();
  return stage === "steam_app_license" || reason.startsWith("cs2_license_");
}

function normalizeContextualLoginError(err, {existingAccount = false} = {}) {
  const normalized = normalizeLoginSaveError(err);
  if (!existingAccount) return normalized;
  if (normalized.reason === "invalid_password") {
    return {
      ...normalized,
      message: "密码错误，请重新输入密码"
    };
  }
  if (normalized.reason !== "access_denied") return normalized;
  return {
    ...normalized,
    message: "登录过期",
    reason: "login_key_invalid",
    status: 409,
    auth_state: "auth_invalid",
    relogin_required: true
  };
}

function isValidAccountGuardCode(value) {
  return /^[A-Z0-9]{5}$/.test(asString(value).trim());
}

function writeInvalidAccountGuardCode(res) {
  writeJson(res, 400, {
    ok: false,
    reason: "invalid_guard_code_format",
    message: "验证码必须为5位大写字母或数字"
  });
}

function normalizeRefreshError(err) {
  const reason = asString(err && (err.reason || err.code) || "").trim();
  const authState = asString(err && err.auth_state || "").trim();
  const credentialState = asString(err && err.credential_state || "").trim();
  const passwordCleared = err && err.password_cleared === true;
  const rawMessage = asString(err && err.message ? err.message : err).trim();
  if (reason === "login_key_missing") {
    return {
      message: "当前账号缺少 loginKey，请重新登录后再刷新",
      reason,
      status: 409,
      auth_state: authState || "login_required",
      relogin_required: true,
      credential_state: credentialState,
      password_cleared: passwordCleared
    };
  }
  if (reason === "login_key_invalid") {
    return {
      message: "登录过期",
      reason,
      status: 409,
      auth_state: authState || "auth_invalid",
      relogin_required: true,
      credential_state: credentialState,
      password_cleared: passwordCleared
    };
  }
  return {
    message: rawMessage || "刷新失败：未知错误，请稍后重试",
    reason: reason || "refresh_failed",
    status: Math.max(400, Number(err && err.status) || 500),
    auth_state: authState,
    relogin_required: credentialState === "password_reentry_required",
    credential_state: credentialState,
    password_cleared: passwordCleared
  };
}

function guessContentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".webp")) return "image/webp";
  if (filePath.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}

function safeUiPath(urlPath) {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const abs = path.resolve(UI_DIR, `.${rel}`);
  if (!abs.startsWith(UI_DIR)) {
    return null;
  }
  return abs;
}

function listProcessedSnapshots() {
  if (!fs.existsSync(PATHS.PROCESSED_DIR)) {
    return [];
  }
  return fs
    .readdirSync(PATHS.PROCESSED_DIR)
    .filter((x) => /^inventory_processed_\d{8}_\d{6}\.json$/i.test(x))
    .map((name) => {
      const full = path.join(PATHS.PROCESSED_DIR, name);
      const stat = fs.statSync(full);
      return {name, full, mtime: stat.mtimeMs};
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function loadSnapshotRows(snapshotPath) {
  return snapshotRowsLoader.loadSnapshotRows(snapshotPath);
}

async function loadSnapshotRowsAsync(snapshotPath) {
  return snapshotRowsLoader.loadSnapshotRowsAsync(snapshotPath);
}

function loadRowsForAccountFromSnapshot(username) {
  const accountName = asString(username).trim();
  const uiState = new UiStateStore();
  const accountCache = uiState.getAccount(accountName);
  const snapshotPath = asString(accountCache && accountCache.snapshot_path ? accountCache.snapshot_path : "").trim();
  if (!snapshotPath) {
    const err = new Error("当前账号暂无库存快照，请先刷新库存");
    err.code = "snapshot_missing";
    throw err;
  }
  if (!fs.existsSync(snapshotPath)) {
    const err = new Error("库存快照不存在或已失效，请先刷新库存");
    err.code = "snapshot_missing";
    throw err;
  }
  return {
    rows: loadSnapshotRows(snapshotPath),
    fetch_time: asString(accountCache && accountCache.fetch_time ? accountCache.fetch_time : "").trim(),
    snapshot_path: snapshotPath
  };
}

function loadSnapshotSafe(snapshotPath) {
  const full = asString(snapshotPath).trim();
  if (!full || !fs.existsSync(full)) {
    return {snapshot: null, rows: []};
  }
  return {
    snapshot: {
      path: full,
      name: path.basename(full)
    },
    rows: loadSnapshotRows(full)
  };
}

async function loadSnapshotSafeAsync(snapshotPath) {
  const full = asString(snapshotPath).trim();
  if (!full || !fs.existsSync(full)) {
    return {snapshot: null, rows: []};
  }
  return {
    snapshot: {
      path: full,
      name: path.basename(full)
    },
    rows: await loadSnapshotRowsAsync(full)
  };
}

function normalizeAvatarHash(value) {
  if (!value) return "";
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (typeof value === "object" && value.type === "Buffer" && Array.isArray(value.data)) {
    return Buffer.from(value.data).toString("hex");
  }
  const text = asString(value).trim();
  if (!text) return "";
  return /^[0-9a-fA-F]{40}$/.test(text) ? text.toLowerCase() : text;
}

async function resolveAccountProfile({
  username,
  password = "",
  viewerUsername = "",
  accountStoreOptions = {},
  onLicenseStatus = null
} = {}) {
  const accountStore = new AccountStore({
    ...accountStoreOptions,
    viewerUsername
  });
  const account = username
    ? getAccountCredentials(accountStore, username)
    : (typeof accountStore.getActiveCredentials === "function"
      ? accountStore.getActiveCredentials()
      : accountStore.getActive());
  const accountName = asString((account && account.username) || username).trim();
  if (!accountName) {
    throw new Error(`account not found: ${username || "(active)"}`);
  }
  const tokenStore = new TokenStore();
  const refreshToken = tokenStore.get(accountName);
  const accountPassword = asString(password || (account && account.password) || "").trim();
  if (!account && !accountPassword && !refreshToken) {
    throw new Error(`account not found: ${username || "(active)"}`);
  }
  logger.info("ui_server", `profile resolve start: account=${accountName}`);

  const acquired = await sessionPool.acquire({
    username: accountName,
    password: accountPassword,
    refreshToken,
    tokenStore,
    onLicenseStatus
  });
  const steam = acquired && acquired.steam ? acquired.steam : null;
  const csgo = acquired && acquired.csgo ? acquired.csgo : null;
  logger.info(
    "ui_server",
    `profile session: account=${accountName} reused=${acquired && acquired.reused ? "true" : "false"} steam=${steam ? "yes" : "no"} csgo=${csgo ? "yes" : "no"} token=${refreshToken ? "yes" : "no"} password=${accountPassword ? "yes" : "no"}`
  );

  let steamId64 = "";
  let steamId3 = "";
  if (steam && steam.steamID) {
    try {
      steamId64 = asString(
        typeof steam.steamID.getSteamID64 === "function" ? steam.steamID.getSteamID64() : steam.steamID
      ).trim();
    } catch (_) {
      steamId64 = "";
    }
    try {
      steamId3 = asString(
        typeof steam.steamID.getSteam3RenderedID === "function" ? steam.steamID.getSteam3RenderedID() : ""
      ).trim();
    } catch (_) {
      steamId3 = "";
    }
  }
  if (!steamId64) {
    logger.warn("ui_server", `profile steamid missing: account=${accountName}`);
  } else {
    logger.info("ui_server", `profile steamid resolved: account=${accountName} steamid=${steamId64}`);
  }

  let persona = null;
  let personaSource = "";
  if (steam && steamId64 && typeof steam.getPersonas === "function") {
    logger.info("ui_server", `profile persona request: account=${accountName} source=steam.getPersonas steamid=${steamId64}`);
    try {
      const result = await steam.getPersonas([steamId64]);
      const personas = result && result.personas && typeof result.personas === "object" ? result.personas : null;
      if (personas && personas[steamId64]) {
        persona = personas[steamId64];
        personaSource = "steam.getPersonas";
        logger.info(
          "ui_server",
          `profile persona loaded: account=${accountName} source=${personaSource} avatar=${persona && (persona.avatar_url_full || persona.avatar_url_medium || persona.avatar_url_icon) ? "yes" : "no"}`
        );
      } else {
        const personaCount = personas ? Object.keys(personas).length : 0;
        logger.warn(
          "ui_server",
          `profile persona empty: account=${accountName} source=steam.getPersonas returned=${personaCount}`
        );
      }
    } catch (err) {
      const msg = asString(err && err.message ? err.message : err).trim();
      logger.warn(
        "ui_server",
        `profile persona error: account=${accountName} source=steam.getPersonas message=${msg || "-"}`
      );
      // fall back to users cache
    }
  }
  if (!persona && steam && steamId64 && steam.users && typeof steam.users === "object" && steam.users[steamId64]) {
    persona = steam.users[steamId64];
    personaSource = "steam.users_cache";
    logger.info(
      "ui_server",
      `profile persona loaded: account=${accountName} source=${personaSource} avatar=${persona && (persona.avatar_url_full || persona.avatar_url_medium || persona.avatar_url_icon) ? "yes" : "no"}`
    );
  }
  if (!persona) {
    const usersSize = steam && steam.users && typeof steam.users === "object" ? Object.keys(steam.users).length : 0;
    logger.warn(
      "ui_server",
      `profile persona unavailable: account=${accountName} steamid=${steamId64 || "-"} users_cache_size=${usersSize}`
    );
  }

  const accountData = csgo && csgo.accountData && typeof csgo.accountData === "object" ? csgo.accountData : null;
  const gcAccountId = toInt(accountData && accountData.account_id, 0);
  const gcPlayerLevel = toInt(accountData && accountData.player_level, 0);
  const gcPlayerCurXp = toInt(accountData && accountData.player_cur_xp, 0);
  const steamId64FromGc = gcAccountId > 0 ? (76561197960265728n + BigInt(gcAccountId)).toString() : "";
  const finalSteamId64 = steamId64 || steamId64FromGc;
  const finalSteamId3 = steamId3 || (gcAccountId > 0 ? `[U:1:${gcAccountId}]` : "");
  if (!steamId64 && steamId64FromGc) {
    logger.info("ui_server", `profile steamid fallback: account=${accountName} source=gc account_id=${gcAccountId}`);
  }

  // --- wallet: layer-1 from steam CM (auto-pushed on login) ---
  let walletBalance = "";
  let walletSource = "";
  let walletCurrency = "";
  let walletObservedAt = "";
  const WALLET_CURRENCY_SYMBOLS = {1: "$", 2: "£", 3: "€", 23: "¥", 13: "S$", 29: "HK$"};
  const WALLET_CURRENCY_CODES = {1: "USD", 2: "GBP", 3: "EUR", 23: "CNY", 13: "SGD", 29: "HKD"};
  if (steam && steam.wallet && steam.wallet.hasWallet) {
    const wBal = steam.wallet.balance;
    const wCur = steam.wallet.currency;
    const sym = WALLET_CURRENCY_SYMBOLS[wCur] || `[${wCur}] `;
    walletBalance = `${sym} ${Number(wBal).toFixed(2)}`;
    walletSource = "steam_cm";
    walletCurrency = WALLET_CURRENCY_CODES[wCur] || `steam_currency:${wCur}`;
    walletObservedAt = new Date().toISOString();
    logger.info(
      "ui_server",
      `profile wallet from CM: account=${accountName} balance=${walletBalance} currency=${wCur}`
    );
  } else {
    logger.info("ui_server", `profile wallet CM unavailable: account=${accountName}`);
  }

  const profile = {
    username: accountName,
    steam_id64: finalSteamId64,
    steam_id3: finalSteamId3,
    persona_name: asString(
      (persona && persona.player_name) || (steam && steam.accountInfo && steam.accountInfo.name) || accountName
    ).trim() || accountName,
    avatar_hash: normalizeAvatarHash(persona && persona.avatar_hash),
    avatar_url_icon: asString(persona && persona.avatar_url_icon).trim(),
    avatar_url_medium: asString(persona && persona.avatar_url_medium).trim(),
    avatar_url_full: asString(persona && persona.avatar_url_full).trim(),
    avatar_source: personaSource || "unavailable",
    gc_account_id: gcAccountId > 0 ? String(gcAccountId) : "",
    gc_player_level: gcPlayerLevel > 0 ? gcPlayerLevel : 0,
    gc_player_cur_xp: gcPlayerCurXp > 0 ? gcPlayerCurXp : 0,
    wallet_balance: walletBalance,
    wallet_source: walletSource,
    wallet_currency: walletCurrency,
    wallet_observed_at: walletObservedAt
  };
  const avatarReady = Boolean(profile.avatar_url_full || profile.avatar_url_medium || profile.avatar_url_icon);
  if (!avatarReady) {
    logger.warn(
      "ui_server",
      `profile avatar missing: account=${accountName} steamid=${profile.steam_id64 || "-"} source=${profile.avatar_source}`
    );
  } else {
    logger.info(
      "ui_server",
      `profile avatar resolved: account=${accountName} steamid=${profile.steam_id64 || "-"} source=${profile.avatar_source}`
    );
  }
  return profile;
}

function pickProfileAvatarUrl(profile) {
  if (!profile || typeof profile !== "object") {
    return "";
  }
  return asString(profile.avatar_url_full || profile.avatar_url_medium || profile.avatar_url_icon || "").trim();
}

function resolveRefreshTarget(username) {
  const key = asString(username).trim();
  if (key) {
    return key;
  }
  const store = new AccountStore();
  const active = store.getActive();
  return active ? asString(active.username).trim() : "";
}

function buildRefreshPayload(result) {
  const rows = loadSnapshotRows(result.snapshot_path);
  const component = buildComponentSummary(rows);
  const fetchTime = nowString();
  try {
    const uiState = new UiStateStore();
    uiState.setAccountSnapshot(result.account, result.snapshot_path, fetchTime);
    uiState.setLastSelected(result.account);
  } catch (_) {
    // ignore cache save errors
  }
  return {
    result,
    fetch_time: fetchTime,
    rows,
    component
  };
}

function mergeAccountAuthState(account, uiState) {
  const row = account && typeof account === "object" ? account : {};
  const username = asString(row.username || "").trim();
  const cache = username && uiState && typeof uiState.getAccount === "function"
    ? uiState.getAccount(username)
    : null;
  return {
    ...row,
    auth_state: asString(cache && cache.auth_state || "").trim() || "normal",
    auth_reason: asString(cache && cache.auth_reason || "").trim()
  };
}

async function runInventoryDisplayImageAutoEnrichment({
  username,
  source,
  result,
  emitSse
}) {
  const account = asString(username).trim();
  const snapshotPath = asString(result && result.snapshot_path).trim();
  if (!account || !snapshotPath) {
    return;
  }
  const outcome = await enrichInventoryDisplayOnlyImages({
    dbPath: PATHS.SKIN_DB_FILE,
    snapshotPath,
    concurrency: 6,
    imageQps: 20,
    imageRequestMaxInFlight: 6
  });
  const summary = outcome && outcome.result ? outcome.result : {};
  const targetCount = Array.isArray(outcome && outcome.targetMarketHashNames)
    ? outcome.targetMarketHashNames.length
    : 0;
  if (logger) {
    logger.info(
      "ui_server",
      `display image enrichment: account=${account} source=${asString(source).trim() || "-"} targets=${targetCount} ok=${Number(summary.image_rows_ok || 0) || 0} failed=${Number(summary.image_rows_failed || 0) || 0}`
    );
  }
  if (
    targetCount <= 0 &&
    (Number(summary.image_rows_ok || 0) || 0) <= 0 &&
    (Number(summary.image_rows_failed || 0) || 0) <= 0
  ) {
    return;
  }
  emitSse("inventory_display_images_enriched", {
    username: account,
    source: asString(source).trim(),
    snapshot_path: outcome.snapshotPath,
    target_market_hash_names_count: targetCount,
    image_rows_pending: Number(summary.image_rows_pending || 0) || 0,
    image_rows_ok: Number(summary.image_rows_ok || 0) || 0,
    image_rows_failed: Number(summary.image_rows_failed || 0) || 0,
    image_rows_still_missing: Number(summary.image_rows_still_missing || 0) || 0
  });
}

const refreshRuntime = createRefreshRuntime({
  logger,
  refreshInventoryFn: (args) => refreshInventory({...args, sessionPool}),
  accountStoreFactory: () => new AccountStore(),
  uiStateStoreFactory: () => new UiStateStore(),
  resolveRefreshTarget,
  buildRefreshPayload,
  runPostRefreshTask: runInventoryDisplayImageAutoEnrichment,
  heartbeatStaleMs: 30 * 60 * 1000,
  heartbeatCheckMs: 60 * 1000,
  sseKeepaliveMs: 25 * 1000
});
const defaultRefreshRuntime = refreshRuntime;

function createServerRefreshRuntime(options = {}) {
  if (options && typeof options.refreshRuntime === "object" && options.refreshRuntime) {
    return options.refreshRuntime;
  }
  if (typeof options.refreshInventoryFn !== "function") {
    return refreshRuntime;
  }
  return createRefreshRuntime({
    logger,
    refreshInventoryFn: options.refreshInventoryFn,
    accountStoreFactory: typeof options.accountStoreFactory === "function"
      ? options.accountStoreFactory
      : () => new AccountStore(),
    uiStateStoreFactory: typeof options.uiStateStoreFactory === "function"
      ? () => options.uiStateStoreFactory({viewerUsername: ""})
      : () => new UiStateStore(),
    resolveRefreshTarget,
    buildRefreshPayload,
    runPostRefreshTask: runInventoryDisplayImageAutoEnrichment,
    heartbeatStaleMs: 30 * 60 * 1000,
    heartbeatCheckMs: 60 * 1000,
    sseKeepaliveMs: 25 * 1000
  });
}

const componentTaskQueue = createComponentTaskQueue({
  logger,
  onStateChanged: (snapshot) => {
    refreshRuntime.emitSse("component_task_queue", snapshot);
  }
});

async function enqueueComponentMoveJob({
  action,
  username,
  password,
  componentId,
  itemIds
}) {
  const actionKey = asString(action).trim() === "withdraw" ? "withdraw" : "deposit";
  const account = asString(username).trim();
  const componentKey = asString(componentId).trim();
  const ids = Array.isArray(itemIds) ? itemIds : [];
  const queued = componentTaskQueue.enqueue({
    username: account,
    action: actionKey,
    componentId: componentKey,
    itemIds: ids,
    execute: async ({job_id}) => {
      try {
        const payload = await componentOpsService.runMove({
          action: actionKey,
          username: account,
          password: asString(password).trim(),
          componentId: componentKey,
          itemIds: ids,
          onProgress: (progress) => {
            refreshRuntime.emitSse("component_move_progress", {
              username: account,
              job_id,
              ...progress
            });
          }
        });
        refreshRuntime.emitSse("component_move_done", {
          username: account,
          job_id,
          action: actionKey,
          component_id: componentKey,
          requested: toInt(payload && payload.op ? payload.op.requested : 0, 0),
          success: Array.isArray(payload && payload.op ? payload.op.success_ids : [])
            ? payload.op.success_ids.length
            : 0,
          failed: Array.isArray(payload && payload.op ? payload.op.failed : [])
            ? payload.op.failed.length
            : 0,
          first_failed_item_id: Array.isArray(payload && payload.op ? payload.op.failed : []) && payload.op.failed[0]
            ? asString(payload.op.failed[0].item_id || "").trim()
            : "",
          first_failed_reason: Array.isArray(payload && payload.op ? payload.op.failed : []) && payload.op.failed[0]
            ? asString(payload.op.failed[0].reason || "").trim()
            : "",
          success_ids: Array.isArray(payload && payload.op ? payload.op.success_ids : [])
            ? payload.op.success_ids.map((id) => asString(id).trim()).filter(Boolean)
            : [],
          failed_items: Array.isArray(payload && payload.op ? payload.op.failed : [])
            ? payload.op.failed.map((entry) => ({
              item_id: asString(entry && entry.item_id ? entry.item_id : "").trim(),
              reason: asString(entry && entry.reason ? entry.reason : "").trim()
            }))
            : [],
          message: asString(payload && payload.message ? payload.message : "").trim(),
          snapshot_path: asString(payload && payload.snapshot_path ? payload.snapshot_path : "").trim(),
          fetch_time: asString(payload && payload.fetch_time ? payload.fetch_time : "").trim()
        });
        return payload;
      } catch (err) {
        refreshRuntime.emitSse("component_move_failed", {
          username: account,
          job_id,
          action: actionKey,
          component_id: componentKey,
          message: asString(err && err.message ? err.message : err)
        });
        throw err;
      }
    }
  });
  return queued;
}

function buildComponentSummary(rows) {
  return buildSharedComponentSummary(rows);
}

async function handleApi(req, res, urlObj, deps = {}) {
  const pathname = urlObj.pathname;
  const auth = resolveRequestAuth(req, deps);
  const config = getClientLicenseConfig(deps);
  const refreshRuntime = deps && deps.refreshRuntime ? deps.refreshRuntime : defaultRefreshRuntime;
  const loginAndSaveTokenFn = typeof deps.loginAndSaveTokenFn === "function" ? deps.loginAndSaveTokenFn : loginAndSaveToken;
  const startLoginSessionFn = typeof deps.startLoginSessionFn === "function" ? deps.startLoginSessionFn : startLoginSession;
  const submitGuardCodeFn = typeof deps.submitGuardCodeFn === "function" ? deps.submitGuardCodeFn : submitGuardCode;
  const tokenRecoveryService = deps.tokenRecoveryService || defaultTokenRecoveryService;
  const resolveAccountWebSession = (account) => resolveWebSessionForAccount(account, {tokenRecoveryService});
  const resolveAccountProfileFn = typeof deps.resolveAccountProfileFn === "function"
    ? deps.resolveAccountProfileFn
    : resolveAccountProfile;
  const viewerUsername = asString(auth && auth.user && auth.user.username ? auth.user.username : "").trim();
  const accountViewerUsername = resolveAccountViewerUsername(auth);
  const createAccountLicenseStatusEmitter = (username, source = "account_login") => async (payload = {}) => {
    if (!refreshRuntime || typeof refreshRuntime.emitSse !== "function") return;
    refreshRuntime.emitSse("steam_app_license_status", {
      ...payload,
      username: asString(username).trim(),
      source
    });
  };
  try {
    if (pathname === "/api/health" && req.method === "GET") {
      writeJson(res, 200, {ok: true});
      return true;
    }

    if (pathname === "/api/license/state" && req.method === "GET") {
      writeJson(res, 200, buildLicenseStatePayload(auth.licenseState));
      return true;
    }

    if (pathname === "/api/client-auth/state" && req.method === "GET") {
      writeJson(res, 200, buildClientAuthStatePayload(auth.licenseState, deps));
      return true;
    }

    if (pathname === "/api/client-auth/login" && req.method === "POST") {
      const body = await readJsonBody(req);
      const username = asString(body && body.username).trim();
      const password = asString(body && body.password);
      if (!username) {
        writeJson(res, 400, {ok: false, reason: "username_required", message: "username is required"});
        return true;
      }
      if (!password) {
        writeJson(res, 400, {ok: false, reason: "password_required", message: "password is required"});
        return true;
      }
      try {
        const authClient = getControlPlaneAuthClient(deps);
        const result = await authClient.login({
          username,
          password,
          deviceId: resolveDeviceId(config.machineIdFile),
          clientVersion: asString(body && body.client_version).trim()
        });
        if (!result || !result.bundle || typeof result.bundle !== "object") {
          writeJson(res, 502, {ok: false, reason: "bundle_missing", message: "本地控制台登录成功但未返回授权包"});
          return true;
        }
        const state = auth.licenseRuntime.importBundle({
          ...result.bundle,
          refresh_credential: asString(result.refreshCredential).trim(),
          source: "local_control_plane_login"
        });
        if (!state || !state.ok) {
          writeJson(res, 502, {
            ok: false,
            reason: asString(state && state.code || "license_invalid").trim() || "license_invalid",
            message: asString(state && state.message || "控制台授权写入本地失败").trim() || "控制台授权写入本地失败"
          });
          return true;
        }
        writeJson(res, 200, buildClientAuthStatePayload(state, deps));
      } catch (err) {
        writeClientAuthError(res, err, "登录失败");
      }
      return true;
    }

    if (pathname === "/api/client-auth/logout" && req.method === "POST") {
      try {
        const authClient = getControlPlaneAuthClient(deps);
        if (authClient && typeof authClient.logout === "function") {
          try {
            const bundle = auth.licenseRuntime && typeof auth.licenseRuntime.readBundle === "function"
              ? auth.licenseRuntime.readBundle()
              : null;
            await authClient.logout({
              refreshCredential: asString(bundle && bundle.refresh_credential).trim()
            });
          } catch (_) {
            // local logout still succeeds even if remote revoke fails
          }
        }
        const state = auth.licenseRuntime.clear();
        writeJson(res, 200, buildClientAuthStatePayload(state, deps));
      } catch (err) {
        writeClientAuthError(res, err, "退出失败");
      }
      return true;
    }

    if (pathname === "/api/client-auth/register/send-code" && req.method === "POST") {
      const body = await readJsonBody(req);
      try {
        const authClient = getControlPlaneAuthClient(deps);
        const result = await authClient.sendRegisterCode({
          email: asString(body && body.email).trim()
        });
        writeJson(res, 200, result && typeof result === "object" ? result : {ok: true});
      } catch (err) {
        writeClientAuthError(res, err, "发送注册验证码失败");
      }
      return true;
    }

    if (pathname === "/api/client-auth/register" && req.method === "POST") {
      const body = await readJsonBody(req);
      try {
        const authClient = getControlPlaneAuthClient(deps);
        const result = await authClient.register({
          email: asString(body && body.email).trim(),
          code: asString(body && body.code).trim(),
          username: asString(body && body.username).trim(),
          password: asString(body && body.password)
        });
        writeJson(res, 200, result && typeof result === "object" ? result : {ok: true});
      } catch (err) {
        writeClientAuthError(res, err, "注册失败");
      }
      return true;
    }

    if (pathname === "/api/client-auth/register/readiness" && req.method === "GET") {
      try {
        const authClient = getControlPlaneAuthClient(deps);
        const result = await authClient.getRegistrationReadiness();
        writeJson(res, 200, result && typeof result === "object" ? result : {ok: true, registration_flow_version: 2});
      } catch (err) {
        writeJson(res, 200, {ok: true, registration_flow_version: 2});
      }
      return true;
    }

    if (pathname === "/api/client-auth/register/verify-code" && req.method === "POST") {
      const body = await readJsonBody(req);
      try {
        const authClient = getControlPlaneAuthClient(deps);
        const result = await authClient.verifyRegisterCode({
          email: asString(body && body.email).trim(),
          code: asString(body && body.code).trim(),
          registerSessionId: asString(body && body.register_session_id).trim()
        });
        writeJson(res, 200, result && typeof result === "object" ? result : {ok: true});
      } catch (err) {
        writeClientAuthError(res, err, "验证码校验失败");
      }
      return true;
    }

    if (pathname === "/api/client-auth/register/complete" && req.method === "POST") {
      const body = await readJsonBody(req);
      try {
        const authClient = getControlPlaneAuthClient(deps);
        const result = await authClient.completeRegister({
          email: asString(body && body.email).trim(),
          verificationTicket: asString(body && body.verification_ticket).trim(),
          username: asString(body && body.username).trim(),
          password: asString(body && body.password),
          deviceId: resolveDeviceId(config.machineIdFile)
        });
        if (!result || !result.bundle || typeof result.bundle !== "object") {
          writeJson(res, 502, {ok: false, reason: "bundle_missing", message: "注册成功但本地控制平面未返回授权包"});
          return true;
        }
        const state = auth.licenseRuntime.importBundle({
          ...result.bundle,
          refresh_credential: asString(result.refreshCredential).trim(),
          source: "local_control_plane_register"
        });
        if (!state || !state.ok) {
          writeJson(res, 502, {
            ok: false,
            reason: asString(state && state.code || "license_invalid").trim() || "license_invalid",
            message: asString(state && state.message || "注册授权写入本地失败").trim() || "注册授权写入本地失败"
          });
          return true;
        }
        writeJson(res, 200, buildClientAuthStatePayload(state, deps));
      } catch (err) {
        writeClientAuthError(res, err, "注册完成失败");
      }
      return true;
    }

    if (pathname === "/api/client-auth/password/send-reset-code" && req.method === "POST") {
      const body = await readJsonBody(req);
      try {
        const authClient = getControlPlaneAuthClient(deps);
        const result = await authClient.sendResetCode({
          email: asString(body && body.email).trim()
        });
        writeJson(res, 200, result && typeof result === "object" ? result : {ok: true});
      } catch (err) {
        writeClientAuthError(res, err, "发送重置验证码失败");
      }
      return true;
    }

    if (pathname === "/api/client-auth/password/reset" && req.method === "POST") {
      const body = await readJsonBody(req);
      try {
        const authClient = getControlPlaneAuthClient(deps);
        const result = await authClient.resetPassword({
          email: asString(body && body.email).trim(),
          code: asString(body && body.code).trim(),
          newPassword: asString(body && body.new_password)
        });
        writeJson(res, 200, result && typeof result === "object" ? result : {ok: true});
      } catch (err) {
        writeClientAuthError(res, err, "重置密码失败");
      }
      return true;
    }

    if (pathname === "/api/license/import" && req.method === "POST") {
      if (!config.allowManualImport) {
        writeJson(res, 403, {
          ok: false,
          reason: "manual_import_disabled",
          message: "正式登录模式下禁止手工导入授权包"
        });
        return true;
      }
      const body = await readJsonBody(req);
      const bundle = body && body.bundle && typeof body.bundle === "object" ? body.bundle : null;
      if (!bundle) {
        writeJson(res, 400, {ok: false, reason: "bundle_required", message: "bundle is required"});
        return true;
      }
      const state = auth.licenseRuntime.importBundle(bundle);
      if (!state || !state.ok) {
        writeJson(res, 400, {
          ok: false,
          reason: asString(state && state.code || "license_invalid").trim() || "license_invalid",
          message: asString(state && state.message || "客户端授权导入失败").trim() || "客户端授权导入失败"
        });
        return true;
      }
      writeJson(res, 200, buildLicenseStatePayload(state));
      return true;
    }

    if (pathname === "/api/license/clear" && req.method === "POST") {
      const state = auth.licenseRuntime.clear();
      writeJson(res, 200, buildLicenseStatePayload(state));
      return true;
    }

    if (pathname === "/api/membership/products" && req.method === "GET") {
      try {
        const authClient = getControlPlaneAuthClient(deps);
        const result = await authClient.getMembershipProducts();
        writeJson(res, 200, result && typeof result === "object" ? result : {ok: true, products: []});
      } catch (err) {
        writeClientAuthError(res, err, "读取充值商品失败");
      }
      return true;
    }

    if (pathname.startsWith("/api/auth/")) {
      writeJson(res, 410, {
        ok: false,
        reason: "client_license_mode",
        message: "当前客户端已切换为本地授权快照模式，旧 admin 登录接口已停用"
      });
      return true;
    }

    if (!isPublicApiRoute(pathname) && !auth.user) {
      const reason = asString(auth && auth.licenseState && auth.licenseState.code || "").trim();
      writeJson(res, 401, {
        ok: false,
        reason: reason === "license_expired" ? "license_expired" : "license_required",
        message: reason === "license_expired" ? "客户端授权已过期，请重新导入或同步授权" : "请先导入有效的客户端授权"
      });
      return true;
    }

    if (pathname === "/api/network/steam-precheck" && req.method === "GET") {
      if (!requirePermission(res, auth, "inventory.read")) return true;
      const checkSteamNetwork = typeof deps.steamNetworkPrecheck === "function"
        ? deps.steamNetworkPrecheck
        : precheckAuthApi;
      const checked = await checkSteamNetwork({logger, force: true, timeoutMs: 4000});
      const reachable = !!(checked && checked.ok);
      writeJson(res, 200, {
        ok: true,
        reachable,
        reason: reachable ? "" : "steam_unreachable"
      });
      return true;
    }

    if (pathname === "/api/membership/redeem" && req.method === "POST") {
      const body = await readJsonBody(req);
      const code = asString(body && body.code).trim().toUpperCase();
      if (!code) {
        writeJson(res, 400, {ok: false, reason: "activation_code_required", message: "请输入激活码"});
        return true;
      }
      const currentBundle = auth.licenseRuntime && typeof auth.licenseRuntime.readBundle === "function"
        ? auth.licenseRuntime.readBundle()
        : null;
      const refreshCredential = asString(currentBundle && currentBundle.refresh_credential).trim();
      if (!refreshCredential) {
        writeJson(res, 401, {ok: false, reason: "refresh_credential_missing", message: "登录状态已失效，请重新登录"});
        return true;
      }
      try {
        const authClient = getControlPlaneAuthClient(deps);
        const result = await authClient.redeemActivationCode({
          refreshCredential,
          deviceId: getClientDeviceId(deps),
          code
        });
        if (!result || !result.bundle || typeof result.bundle !== "object") {
          writeJson(res, 502, {ok: false, reason: "bundle_missing", message: "兑换成功但未返回新的授权包"});
          return true;
        }
        const state = auth.licenseRuntime.importBundle({
          ...result.bundle,
          refresh_credential: asString(result.refreshCredential || refreshCredential).trim(),
          source: "activation_code_redeem"
        });
        if (!state || !state.ok) {
          writeJson(res, 502, {
            ok: false,
            reason: asString(state && state.code || "license_invalid").trim() || "license_invalid",
            message: asString(state && state.message || "新授权包写入本地失败").trim() || "新授权包写入本地失败"
          });
          return true;
        }
        writeJson(res, 200, {
          ...buildClientAuthStatePayload(state, deps),
          message: "激活码兑换成功"
        });
      } catch (err) {
        writeClientAuthError(res, err, "激活码兑换失败");
      }
      return true;
    }

    if (pathname === "/api/membership/checkout" && req.method === "POST") {
      const body = await readJsonBody(req);
      const productId = asString(body && body.product_id).trim();
      if (!productId) {
        writeJson(res, 400, {ok: false, reason: "product_required", message: "请选择充值商品"});
        return true;
      }
      const currentBundle = auth.licenseRuntime && typeof auth.licenseRuntime.readBundle === "function"
        ? auth.licenseRuntime.readBundle()
        : null;
      const refreshCredential = asString(currentBundle && currentBundle.refresh_credential).trim();
      if (!refreshCredential) {
        writeJson(res, 401, {ok: false, reason: "refresh_credential_missing", message: "登录状态已失效，请重新登录"});
        return true;
      }
      try {
        const authClient = getControlPlaneAuthClient(deps);
        const result = await authClient.checkoutMembership({
          refreshCredential,
          deviceId: getClientDeviceId(deps),
          productId
        });
        writeJson(res, 200, result && typeof result === "object" ? result : {ok: true});
      } catch (err) {
        writeClientAuthError(res, err, "创建支付订单失败");
      }
      return true;
    }

    if (pathname === "/api/events" && req.method === "GET") {
      const username = asString(urlObj.searchParams.get("username") || "").trim();
      if (username && !requireSteamAccountAccess(res, auth, username)) {
        return true;
      }
      const streamVersion = asString(urlObj.searchParams.get("stream_version") || "").trim();
      if (streamVersion !== "2") {
        res.writeHead(204, {"Cache-Control": "no-store"});
        res.end();
        return true;
      }
      refreshRuntime.handleSseRequest(req, res, username);
      return true;
    }

    if (pathname === "/api/accounts" && req.method === "GET") {
      if (!requirePermission(res, auth, "accounts.read")) {
        return true;
      }
      const store = getViewerAccountStore(auth, deps);
      const uiState = getUiStateStore(deps, viewerUsername);
      const tokenStore = getTokenStore(deps);
      const mayReadSavedPassword = hasPermission(auth, "accounts.write");
      const decorate = (row) => {
        if (!row || typeof row !== "object") return null;
        const username = asString(row.username).trim();
        const projected = {
          ...mergeAccountAuthState(row, uiState),
          has_refresh_token: !!(username && tokenStore.get(username))
        };
        if (mayReadSavedPassword && username && typeof store.getCredentials === "function") {
          const credentials = store.getCredentials(username);
          projected.password = asString(credentials && credentials.password).trim();
        }
        return projected;
      };
      const accounts = store.list().map(decorate);
      const active = decorate(store.getActive());
      res.setHeader("Cache-Control", "no-store");
      writeJson(res, 200, {
        accounts,
        active,
        last_selected_username: uiState.getLastSelected()
      });
      return true;
    }

  if (pathname === "/api/accounts/profile" && req.method === "GET") {
    if (!requirePermission(res, auth, "accounts.read")) {
      return true;
    }
    const username = asString(urlObj.searchParams.get("username") || "").trim();
    if (username && !requireSteamAccountAccess(res, auth, username)) {
      return true;
    }
    try {
      const profile = await resolveAccountProfile({
        username,
        viewerUsername: accountViewerUsername,
        accountStoreOptions: {
          dbPath: auth.store.dbPath,
          accountsFilePath: auth.store.accountsFilePath
        },
        onLicenseStatus: createAccountLicenseStatusEmitter(username, "account_profile")
      });
      try {
        const accountStore = getViewerAccountStore(auth, deps);
        const existed = getAccountCredentials(accountStore, profile.username);
        if (existed) {
          const nextSteamId = asString(profile.steam_id64 || "").trim();
          const nextSteamName = asString(profile.persona_name || "").trim();
          const nextAvatarUrl = pickProfileAvatarUrl(profile);
          const saveSteamName = nextSteamName || asString(existed.steam_name || "").trim();
          const saveSteamId = nextSteamId || asString(existed.steam_id || "").trim();
          const saveAvatarUrl = nextAvatarUrl || asString(existed.avatar_url || "").trim();
          if (
            saveSteamName !== asString(existed.steam_name || "").trim() ||
            saveSteamId !== asString(existed.steam_id || "").trim() ||
            saveAvatarUrl !== asString(existed.avatar_url || "").trim()
          ) {
            accountStore.upsert({
              username: profile.username,
              password: asString(existed.password || ""),
              remark: asString(existed.remark || "").trim(),
              steamName: saveSteamName,
              steamId: saveSteamId,
              avatarUrl: saveAvatarUrl
            });
            logger.info(
              "ui_server",
              `account profile saved: account=${profile.username} steam=${saveSteamName || "-"} steamid=${saveSteamId || "-"} avatar=${saveAvatarUrl ? "yes" : "no"}`
            );
          }
        }
      } catch (saveErr) {
        logger.warn(
          "ui_server",
          `account profile save skipped: account=${profile.username} message=${asString(saveErr && saveErr.message ? saveErr.message : saveErr)}`
        );
      }
      // persist wallet balance from CM if available
      if (profile.wallet_balance) {
        try {
          const balStore = new AppAuthStore(auth && auth.store ? auth.store.dbPath : PATHS.SKIN_DB_FILE);
          try {
            balStore.updateSteamWalletBalance(profile.username, {
              balance: profile.wallet_balance,
              currency: profile.wallet_currency || "",
              source: "steam_cm",
              observedAt: profile.wallet_observed_at
            });
          } finally {
            balStore.close();
          }
        } catch (_) {}
      }
      logger.info(
        "ui_server",
        `account profile: account=${profile.username} steamid=${profile.steam_id64 || "-"} avatar=${profile.avatar_url_full ? "yes" : "no"} source=${profile.avatar_source} wallet=${profile.wallet_balance || "-"}`
      );
      writeJson(res, 200, {ok: true, profile});
    } catch (err) {
      const message = asString(err && err.message ? err.message : err);
      logger.warn("ui_server", `account profile failed: account=${username || "(active)"} message=${message || "-"}`);
      const status = /account not found|password missing|password required when no refresh_token|username is required/i.test(message)
        ? 400
        : 500;
      writeJson(res, status, {ok: false, message});
    }
    return true;
  }

  if (pathname === "/api/ui-state" && req.method === "GET") {
    const uiState = getUiStateStore(deps, viewerUsername);
    writeJson(res, 200, {
      ok: true,
      last_selected_username: uiState.getLastSelected()
    });
    return true;
  }

  if (pathname === "/api/ui-state/last-selected" && req.method === "POST") {
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    if (username && !requireSteamAccountAccess(res, auth, username)) {
      return true;
    }
    const uiState = getUiStateStore(deps, viewerUsername);
    uiState.setLastSelected(username);
    writeJson(res, 200, {ok: true, last_selected_username: uiState.getLastSelected()});
    return true;
  }

  if (pathname === "/api/ui-state/craft-assist-presets" && req.method === "GET") {
    const uiState = getUiStateStore(deps, viewerUsername);
    writeJson(res, 200, {
      ok: true,
      presets: uiState.getCraftAssistPresets()
    });
    return true;
  }

  if (pathname === "/api/ui-state/craft-assist-presets" && req.method === "POST") {
    const body = await readJsonBody(req);
    const presets = Array.isArray(body && body.presets) ? body.presets : [];
    const uiState = getUiStateStore(deps, viewerUsername);
    uiState.setCraftAssistPresets(presets);
    writeJson(res, 200, {
      ok: true,
      presets: uiState.getCraftAssistPresets()
    });
    return true;
  }

  if (pathname === "/api/ui-state/tradeup-simulation-presets" && req.method === "GET") {
    const uiState = getUiStateStore(deps, viewerUsername);
    writeJson(res, 200, {
      ok: true,
      presets: uiState.getTradeupSimulationPresets()
    });
    return true;
  }

  if (pathname === "/api/ui-state/tradeup-simulation-presets" && req.method === "POST") {
    const body = await readJsonBody(req);
    const presets = Array.isArray(body && body.presets) ? body.presets : [];
    const uiState = getUiStateStore(deps, viewerUsername);
    uiState.setTradeupSimulationPresets(presets);
    writeJson(res, 200, {
      ok: true,
      presets: uiState.getTradeupSimulationPresets()
    });
    return true;
  }

  if (pathname === "/api/accounts/active" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) {
      return true;
    }
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    if (!requireSteamAccountAccess(res, auth, username)) {
      return true;
    }
    const store = getViewerAccountStore(auth, deps);
    if (!store.setActive(username)) {
      writeJson(res, 400, {ok: false, message: `account not found: ${username}`});
      return true;
    }
    const uiState = getUiStateStore(deps, viewerUsername);
    uiState.setLastSelected(username);
    writeJson(res, 200, {ok: true, active: store.getActive()});
    return true;
  }

  // -----------------------------------------------------------------------
  // Two-phase login: Phase 1 — start session, return guard requirement
  // -----------------------------------------------------------------------
  if (pathname === "/api/accounts/login-start" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) {
      return true;
    }
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    const submittedPassword = asString(body.password).trim();
    const submittedTotp = asString(body.totp).trim();
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }
    if (!requireExistingSteamAccountAccess(res, auth, username)) {
      return true;
    }
    const accountStore = getViewerAccountStore(auth, deps);
    const existed = accountStore.get(username);
    const storedCredentials = typeof accountStore.getCredentials === "function"
      ? accountStore.getCredentials(username)
      : existed;
    const password = submittedPassword || asString(storedCredentials && storedCredentials.password).trim();
    const localMaFileContent = asString(storedCredentials && storedCredentials.mafile_content).trim();
    const totp = localMaFileContent ? "" : submittedTotp;
    if (!password) {
      writeJson(res, 400, {ok: false, message: "password is required"});
      return true;
    }
    if (totp && !isValidAccountGuardCode(totp)) {
      writeInvalidAccountGuardCode(res);
      return true;
    }

    logger.info("ui_server", `login-start request: account=${username} totp=${totp ? "yes" : "no"}`);
    try {
      const tokenStore = new TokenStore();
      let phase1 = await startLoginSessionFn({
        username,
        password,
        twoFactorCode: totp,
        tokenStore,
        logger
      });

      if (!phase1.done && phase1.guard_type === "device_code" && localMaFileContent) {
        const guardSummary = readSteamGuardSummary(localMaFileContent);
        phase1 = await submitGuardCodeFn({
          username,
          code: guardSummary.currentTotp,
          tokenStore,
          logger
        });
        logger.info("ui_server", `login-start local Guard accepted: account=${username}`);
      }

      if (phase1.done) {
        // Login completed in one shot (totp was provided or no guard needed)
        const result = phase1.result;
        const finalRemark = asString(body.remark).trim() || (existed ? asString(existed.remark || "").trim() : "");
        const authClient = getControlPlaneAuthClient(deps);
        const requiresBindingCheck = getClientLicenseConfig(deps).authMode === "prod_login";

        let profile = null;
        try {
          profile = await resolveAccountProfileFn({
            username,
            password,
            viewerUsername: accountViewerUsername,
            accountStoreOptions: {
              dbPath: auth.store.dbPath,
              accountsFilePath: auth.store.accountsFilePath
            },
            onLicenseStatus: createAccountLicenseStatusEmitter(username)
          });
        } catch (profileErr) {
          if (isSteamAppLicenseError(profileErr)) throw profileErr;
          logger.warn("ui_server", `profile resolve skipped: account=${username} message=${asString(profileErr && profileErr.message ? profileErr.message : profileErr)}`);
        }
        const nextSteamId = asString(profile && profile.steam_id64 || "").trim();
        const nextSteamName = asString(profile && profile.persona_name || "").trim();
        const nextAvatarUrl = pickProfileAvatarUrl(profile);
        accountStore.upsert({
          username,
          password,
          remark: finalRemark,
          steamName: nextSteamName || (existed ? existed.steam_name : ""),
          steamId: nextSteamId || (existed ? existed.steam_id : ""),
          avatarUrl: nextAvatarUrl || (existed ? existed.avatar_url : "")
        });
        const uiState = getUiStateStore(deps, viewerUsername);
        uiState.setLastSelected(username);
        if (typeof uiState.clearAccountAuthState === "function") uiState.clearAccountAuthState(username);
        logger.info("ui_server", `login-start success (one-shot): account=${username}`);
        writeJson(res, 200, {ok: true, done: true, active: accountStore.getActive(), accounts: accountStore.list()});
      } else {
        // Guard required — session cached, waiting for code
        try {
          if (typeof accountStore.saveVerifiedCredentials !== "function"
            || accountStore.saveVerifiedCredentials(username, password) === false) {
            throw new Error("verified credentials save rejected");
          }
        } catch (saveErr) {
          logger.warn("ui_server", `login-start credential save failed: account=${username} error=${asString(saveErr && saveErr.message ? saveErr.message : saveErr)}`);
          writeJson(res, 500, {
            ok: false,
            reason: "credential_save_failed",
            message: "账号密码保存失败，请重新登录"
          });
          return true;
        }
        logger.info("ui_server", `login-start guard required: account=${username} guard_type=${phase1.guard_type} hint=${phase1.guard_hint || "-"}`);
        writeJson(res, 200, {
          ok: true,
          done: false,
          guard_type: phase1.guard_type,
          guard_hint: phase1.guard_hint || "",
          credentials_saved: true
        });
      }
    } catch (err) {
      const normalized = normalizeContextualLoginError(err, {existingAccount: !!existed});
      if (existed && normalized.reason === "login_key_invalid") {
        try {
          if (!tokenRecoveryService || typeof tokenRecoveryService.invalidateAuthentication !== "function") {
            throw new Error("authentication invalidation unavailable");
          }
          await tokenRecoveryService.invalidateAuthentication(username);
        } catch (_) {
          writeJson(res, 500, {
            ok: false,
            reason: "token_store_clear_failed",
            message: "过期登录状态清理失败，请稍后重试",
            auth_state: "needs_attention"
          });
          return true;
        }
      }
      let passwordCleared = false;
      if (existed && localMaFileContent && normalized.reason === "invalid_password") {
        try {
          if (typeof accountStore.clearPassword !== "function" || accountStore.clearPassword(username) === false) {
            throw new Error("password clear rejected");
          }
          passwordCleared = true;
        } catch (_) {
          writeJson(res, 500, {
            ok: false,
            reason: "password_clear_failed",
            message: "已保存密码清除失败，请稍后重试"
          });
          return true;
        }
      }
      if (existed && normalized.auth_state) {
        try {
          const uiState = getUiStateStore(deps, viewerUsername);
          if (typeof uiState.setAccountAuthState === "function") {
            uiState.setAccountAuthState(username, normalized.auth_state, normalized.reason);
          }
        } catch (_) {
          // The response still carries the authoritative recovery instruction.
        }
      }
      logger.warn("ui_server", `login-start failed: account=${username} reason=${normalized.reason} status=${normalized.status} raw=${normalized.raw || "-"}`);
      const payload = {ok: false, message: normalized.message, reason: normalized.reason, detail: normalized.raw};
      if (normalized.steam_eresult) payload.steam_eresult = normalized.steam_eresult;
      if (typeof normalized.retryable === "boolean") payload.retryable = normalized.retryable;
      if (passwordCleared) payload.password_cleared = true;
      if (normalized.auth_state) payload.auth_state = normalized.auth_state;
      if (normalized.relogin_required) payload.relogin_required = true;
      writeJson(res, normalized.status, payload);
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Two-phase login: Phase 2 — submit guard code
  // -----------------------------------------------------------------------
  if (pathname === "/api/accounts/login-submit-code" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) {
      return true;
    }
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    const code = asString(body.code).trim();
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }
    if (!code) {
      writeJson(res, 400, {ok: false, message: "code is required"});
      return true;
    }
    if (!isValidAccountGuardCode(code)) {
      writeInvalidAccountGuardCode(res);
      return true;
    }
    if (!requireExistingSteamAccountAccess(res, auth, username)) {
      return true;
    }
    const accountStore = getViewerAccountStore(auth, deps);
    const existed = accountStore.get(username);
    const storedCredentials = typeof accountStore.getCredentials === "function"
      ? accountStore.getCredentials(username)
      : existed;

    logger.info("ui_server", `login-submit-code request: account=${username}`);
    try {
      const tokenStore = new TokenStore();
      const phase2 = await submitGuardCodeFn({username, code, tokenStore, logger});
      const result = phase2.result;
      const password = asString(phase2.authenticated_password).trim()
        || asString(storedCredentials && storedCredentials.password).trim();
      if (!password) {
        throw new Error("authenticated password missing from pending login session");
      }

      const finalRemark = asString(body.remark).trim() || (existed ? asString(existed.remark || "").trim() : "");
      const authClient = getControlPlaneAuthClient(deps);
      const requiresBindingCheck = getClientLicenseConfig(deps).authMode === "prod_login";

      let profile = null;
      try {
        profile = await resolveAccountProfileFn({
          username,
          password,
          viewerUsername: accountViewerUsername,
          accountStoreOptions: {
            dbPath: auth.store.dbPath,
            accountsFilePath: auth.store.accountsFilePath
          },
          onLicenseStatus: createAccountLicenseStatusEmitter(username)
        });
      } catch (profileErr) {
        if (isSteamAppLicenseError(profileErr)) throw profileErr;
        logger.warn("ui_server", `profile resolve skipped: account=${username} message=${asString(profileErr && profileErr.message ? profileErr.message : profileErr)}`);
      }
      const nextSteamId = asString(profile && profile.steam_id64 || "").trim();
      const nextSteamName = asString(profile && profile.persona_name || "").trim();
      const nextAvatarUrl = pickProfileAvatarUrl(profile);
      accountStore.upsert({
        username,
        password,
        remark: finalRemark,
        steamName: nextSteamName || (existed ? existed.steam_name : ""),
        steamId: nextSteamId || (existed ? existed.steam_id : ""),
        avatarUrl: nextAvatarUrl || (existed ? existed.avatar_url : "")
      });
      const uiState = getUiStateStore(deps, viewerUsername);
      uiState.setLastSelected(username);
      if (typeof uiState.clearAccountAuthState === "function") uiState.clearAccountAuthState(username);
      logger.info("ui_server", `login-submit-code success: account=${username}`);
      writeJson(res, 200, {ok: true, done: true, active: accountStore.getActive(), accounts: accountStore.list()});
    } catch (err) {
      const normalized = normalizeContextualLoginError(err, {existingAccount: !!existed});
      if (existed && normalized.reason === "login_key_invalid") {
        try {
          if (!tokenRecoveryService || typeof tokenRecoveryService.invalidateAuthentication !== "function") {
            throw new Error("authentication invalidation unavailable");
          }
          await tokenRecoveryService.invalidateAuthentication(username);
        } catch (_) {
          writeJson(res, 500, {
            ok: false,
            reason: "token_store_clear_failed",
            message: "过期登录状态清理失败，请稍后重试",
            auth_state: "needs_attention"
          });
          return true;
        }
      }
      if (existed && normalized.auth_state) {
        try {
          const uiState = getUiStateStore(deps, viewerUsername);
          if (typeof uiState.setAccountAuthState === "function") {
            uiState.setAccountAuthState(username, normalized.auth_state, normalized.reason);
          }
        } catch (_) {
          // The response still carries the authoritative recovery instruction.
        }
      }
      logger.warn("ui_server", `login-submit-code failed: account=${username} reason=${normalized.reason} status=${normalized.status} raw=${normalized.raw || "-"}`);
      const payload = {ok: false, message: normalized.message, reason: normalized.reason, detail: normalized.raw};
      if (normalized.steam_eresult) payload.steam_eresult = normalized.steam_eresult;
      if (typeof normalized.retryable === "boolean") payload.retryable = normalized.retryable;
      if (normalized.auth_state) payload.auth_state = normalized.auth_state;
      if (normalized.relogin_required) payload.relogin_required = true;
      writeJson(res, normalized.status, payload);
    }
    return true;
  }

  if (pathname === "/api/accounts/login-save" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) {
      return true;
    }
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    const password = asString(body.password).trim();
    const totp = asString(body.totp).trim();
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }
    if (!password) {
      writeJson(res, 400, {ok: false, message: "password is required"});
      return true;
    }
    if (!totp) {
      writeJson(res, 400, {ok: false, message: "totp is required"});
      return true;
    }
    if (!isValidAccountGuardCode(totp)) {
      writeInvalidAccountGuardCode(res);
      return true;
    }

    logger.info("ui_server", `login-save request: account=${username} totp=yes`);
    try {
      const tokenStore = new TokenStore();
      const result = await loginAndSaveTokenFn({
        username,
        password,
        twoFactorCode: totp,
        tokenStore,
        logger
      });

      const accountStore = getViewerAccountStore(auth, deps);
      const existed = accountStore.get(username);
      const finalRemark = asString(body.remark).trim() || (existed ? asString(existed.remark || "").trim() : "");
      let profile = null;
      try {
        profile = await resolveAccountProfileFn({
          username,
          password,
          viewerUsername: accountViewerUsername,
          accountStoreOptions: {
            dbPath: auth.store.dbPath,
            accountsFilePath: auth.store.accountsFilePath
          },
          onLicenseStatus: createAccountLicenseStatusEmitter(username)
        });
      } catch (profileErr) {
        if (isSteamAppLicenseError(profileErr)) throw profileErr;
        logger.warn(
          "ui_server",
          `profile resolve skipped: account=${username} message=${asString(profileErr && profileErr.message ? profileErr.message : profileErr)}`
        );
      }
      const nextSteamId = asString(profile && profile.steam_id64 || "").trim();

      const nextSteamName = asString(profile && profile.persona_name || "").trim();
      const nextAvatarUrl = pickProfileAvatarUrl(profile);
      accountStore.upsert({
        username,
        password,
        remark: finalRemark,
        steamName: nextSteamName || (existed ? existed.steam_name : ""),
        steamId: nextSteamId || (existed ? existed.steam_id : ""),
        avatarUrl: nextAvatarUrl || (existed ? existed.avatar_url : "")
      });

      const uiState = getUiStateStore(deps, viewerUsername);
      uiState.setLastSelected(username);
      if (typeof uiState.clearAccountAuthState === "function") {
        uiState.clearAccountAuthState(username);
      }
      logger.info("ui_server", `login-save success: account=${username} token_saved=${Boolean(result.refresh_token)}`);
      writeJson(res, 200, {
        ok: true,
        message: "登录成功，已获取并保存 token",
        result: {
          username: result.username,
          token_saved: Boolean(result.refresh_token)
        },
        active: accountStore.getActive(),
        accounts: accountStore.list()
      });
    } catch (err) {
      const normalized = normalizeLoginSaveError(err);
      logger.warn(
        "ui_server",
        `login-save failed: account=${username} reason=${normalized.reason} status=${normalized.status} message=${normalized.message} raw=${normalized.raw || "-"}`
      );
      writeJson(res, normalized.status, {
        ok: false,
        message: normalized.message,
        reason: normalized.reason,
        detail: normalized.raw,
        ...(normalized.steam_eresult ? {steam_eresult: normalized.steam_eresult} : {}),
        ...(typeof normalized.retryable === "boolean" ? {retryable: normalized.retryable} : {})
      });
    }
    return true;
  }

  if (pathname === "/api/accounts/upsert" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) {
      return true;
    }
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    const password = asString(body.password).trim();
    const remark = asString(body.remark || "").trim();
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }

    const store = getViewerAccountStore(auth, deps);
    const existed = getAccountCredentials(store, username);
    const existedPassword = asString(existed && existed.password ? existed.password : "").trim();
    const finalPassword = password || existedPassword;
    if (!existed && !finalPassword) {
      writeJson(res, 400, {ok: false, message: "password is required"});
      return true;
    }
    const finalRemark = remark || asString(existed && existed.remark ? existed.remark : "").trim();
    store.upsert({username, password: finalPassword, remark: finalRemark});
    const uiState = getUiStateStore(deps, viewerUsername);
    uiState.setLastSelected(username);
    writeJson(res, 200, {
      ok: true,
      active: store.getActive(),
      accounts: store.list()
    });
    return true;
  }

  if (pathname === "/api/accounts/remark" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) {
      return true;
    }
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    const remark = asString(body.remark).trim();
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }

    if (!requireSteamAccountAccess(res, auth, username)) {
      return true;
    }
    const store = getViewerAccountStore(auth, deps);
    const ok = store.updateRemark(username, remark);
    if (!ok) {
      writeJson(res, 404, {ok: false, message: `account not found: ${username}`});
      return true;
    }

    logger.info("ui_server", `account remark updated: account=${username}`);
    const uiState = getUiStateStore(deps, viewerUsername);
    uiState.setLastSelected(username);
    writeJson(res, 200, {
      ok: true,
      active: store.getActive(),
      accounts: store.list()
    });
    return true;
  }

  if (pathname === "/api/accounts/delete" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) {
      return true;
    }
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }
    if (!requireSteamAccountAccess(res, auth, username)) {
      return true;
    }
    const store = getViewerAccountStore(auth, deps);
    if (!store.remove(username)) {
      writeJson(res, 404, {ok: false, message: `account not found: ${username}`});
      return true;
    }
    refreshRuntime.removeAccount(username);
    sessionPool.invalidate(username, "account_deleted");
    componentTaskQueue.cancelByUsername(username);

    // 删除账号时同步清理本地 refresh_token，避免残留冲突。
    try {
      const tokenStore = new TokenStore();
      tokenStore.remove(username);
    } catch (_) {
      // ignore token cleanup errors
    }
    try {
      const uiState = getUiStateStore(deps, viewerUsername);
      uiState.removeAccount(username);
    } catch (_) {
      // ignore ui state cleanup errors
    }

    writeJson(res, 200, {
      ok: true,
      active: store.getActive(),
      accounts: store.list()
    });
    return true;
  }

  if (pathname === "/api/refresh" && req.method === "POST") {
    if (!requirePermission(res, auth, "inventory.refresh")) {
      return true;
    }
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    const password = asString(body.password).trim();
    if (username && !requireSteamAccountAccess(res, auth, username)) {
      return true;
    }
    logger.info("ui_server", `refresh request: account=${username || "<active>"}`);
    try {
      const payload = await refreshRuntime.runRefreshJob({
        username,
        password,
        includeHidden: asString(body.include_hidden || "true") !== "false",
        source: "manual"
      });
      writeJson(res, 200, {
        ok: true,
        result: payload.result,
        fetch_time: payload.fetch_time,
        rows: payload.rows,
        component: payload.component
      });
    } catch (err) {
      const normalized = normalizeRefreshError(err);
      const targetAccount = username || resolveRefreshTarget("");
      if (targetAccount && normalized.auth_state) {
        try {
          const uiState = getUiStateStore(deps, viewerUsername);
          if (normalized.auth_state === "normal" && typeof uiState.clearAccountAuthState === "function") {
            uiState.clearAccountAuthState(targetAccount);
          } else if (typeof uiState.setAccountAuthState === "function") {
            uiState.setAccountAuthState(targetAccount, normalized.auth_state, normalized.reason);
          }
        } catch (_) {
          // ignore auth-state persistence errors
        }
      }
      writeJson(res, normalized.status, {
        ok: false,
        message: normalized.message,
        reason: normalized.reason,
        auth_state: normalized.auth_state,
        relogin_required: normalized.relogin_required,
        ...(normalized.credential_state ? {credential_state: normalized.credential_state} : {}),
        ...(normalized.password_cleared ? {password_cleared: true} : {})
      });
    }
    return true;
  }

  if (pathname === "/api/inventory/redeem-mission-reward/options" && req.method === "GET") {
    if (!requirePermission(res, auth, "inventory.refresh")) {
      return true;
    }
    const username = asString(urlObj.searchParams.get("username") || "").trim();
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }
    if (!requireSteamAccountAccess(res, auth, username)) {
      return true;
    }
    if (!refreshRuntime.isConnected(username)) {
      writeJson(res, 409, {ok: false, message: "当前账号未连接，请先连接并刷新库存"});
      return true;
    }

    try {
      const payload = await weaponArmoryService.inspect({
        username
      });
      writeJson(res, 200, payload);
    } catch (err) {
      const code = asString(err && err.code || "").trim();
      const status = code === "account_not_found"
        ? 400
        : (code === "armory_state_unavailable" ? 409 : 500);
      writeJson(res, status, {
        ok: false,
        reason: code || "weapon_armory_options_failed",
        message: asString(err && err.message ? err.message : err)
      });
    }
    return true;
  }

  if (pathname === "/api/inventory/redeem-mission-reward" && req.method === "POST") {
    if (!requirePermission(res, auth, "inventory.refresh")) {
      return true;
    }
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }
    if (!requireSteamAccountAccess(res, auth, username)) {
      return true;
    }
    if (!refreshRuntime.isConnected(username)) {
      writeJson(res, 409, {ok: false, message: "当前账号未连接，请先连接并刷新库存"});
      return true;
    }

    try {
      const payload = await weaponArmoryService.redeem({
        username,
        password: asString(body.password).trim(),
        campaignId: parseOptionalIntegerBodyValue(body.campaign_id, "campaign_id", {allowZero: false}),
        redeemId: parseOptionalIntegerBodyValue(body.redeem_id, "redeem_id", {allowZero: true}),
        redeemableBalance: parseOptionalIntegerBodyValue(
          body.redeemable_balance,
          "redeemable_balance",
          {allowZero: true}
        ),
        expectedCost: parseOptionalIntegerBodyValue(body.expected_cost, "expected_cost", {allowZero: false}),
        bidControl: parseOptionalIntegerBodyValue(body.bid_control, "bid_control", {allowZero: true}),
        ackTracks: parseBooleanBodyValue(body.ack_tracks, true),
        ackWaitMs: parseOptionalIntegerBodyValue(body.ack_wait_ms, "ack_wait_ms", {allowZero: true}),
        waitMs: parseOptionalIntegerBodyValue(body.wait_ms, "wait_ms", {allowZero: true})
      });
      logger.info(
        "ui_server",
        [
          "weapon-armory redeem success:",
          `account=${username}`,
          `campaign_id=${toInt(payload && payload.resolved && payload.resolved.campaign_id, 0)}`,
          `redeem_id=${toInt(payload && payload.resolved && payload.resolved.redeem_id, 0)}`
        ].join(" ")
      );
      writeJson(res, 200, payload);
    } catch (err) {
      const code = asString(err && err.code || "").trim();
      const status = code === "bad_request"
        ? 400
        : (code === "armory_state_unavailable" || code === "armory_bid_ambiguous" || code === "redemption_not_confirmed"
          ? 409
          : (code === "account_not_found" || code === "password_missing" ? 400 : 500));
      logger.warn(
        "ui_server",
        [
          "weapon-armory redeem failed:",
          `account=${username}`,
          `status=${status}`,
          `code=${code || "-"}`,
          `msg=${asString(err && err.message ? err.message : err)}`
        ].join(" ")
      );
      if (err && err.redemption_payload) {
        writeJson(res, status, err.redemption_payload);
        return true;
      }
      writeJson(res, status, {
        ok: false,
        reason: code || "weapon_armory_redeem_failed",
        message: asString(err && err.message ? err.message : err)
      });
    }
    return true;
  }

  if (pathname === "/api/session/disconnect" && req.method === "POST") {
    if (!requirePermission(res, auth, "inventory.refresh")) {
      return true;
    }
    const body = await readJsonBody(req);
    const username = asString(body.username).trim() || resolveRefreshTarget("");
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }
    if (!requireSteamAccountAccess(res, auth, username)) {
      return true;
    }
    const queueSnapshot = componentTaskQueue.getSnapshot(username);
    if (queueSnapshot.running && asString(queueSnapshot.running.username).trim() === username) {
      writeJson(res, 409, {ok: false, message: "该账号有任务正在执行，请稍后再断开"});
      return true;
    }
    const cancelledCount = componentTaskQueue.cancelByUsername(username);
    sessionPool.invalidate(username, "manual_disconnect");
    refreshRuntime.removeAccount(username);
    writeJson(res, 200, {
      ok: true,
      username,
      cancelled_tasks: cancelledCount,
      connected: false
    });
    return true;
  }

  if (pathname === "/api/session/disconnect-others" && req.method === "POST") {
    if (!requirePermission(res, auth, "inventory.refresh")) {
      return true;
    }
    const body = await readJsonBody(req);
    const username = asString(body.username).trim() || resolveRefreshTarget("");
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }
    const accountStore = getViewerAccountStore(auth, deps);
    const accountNames = accountStore.list()
      .map((row) => asString(row && row.username ? row.username : "").trim())
      .filter(Boolean);
    const blocked = [];
    for (const accountName of accountNames) {
      if (accountName === username) continue;
      if (!refreshRuntime.isConnected(accountName)) continue;
      const queueSnapshot = componentTaskQueue.getSnapshot(accountName);
      if (queueSnapshot.running && asString(queueSnapshot.running.username).trim() === accountName) {
        blocked.push(accountName);
      }
    }
    if (blocked.length) {
      writeJson(res, 409, {
        ok: false,
        message: `账号 ${blocked[0]} 有任务正在执行，请稍后再切换连接`,
        blocked_accounts: blocked
      });
      return true;
    }

    const disconnected = [];
    let cancelledCount = 0;
    for (const accountName of accountNames) {
      if (accountName === username) continue;
      if (!refreshRuntime.isConnected(accountName)) continue;
      cancelledCount += componentTaskQueue.cancelByUsername(accountName);
      sessionPool.invalidate(accountName, "switch_account");
      refreshRuntime.removeAccount(accountName);
      disconnected.push(accountName);
    }
    writeJson(res, 200, {
      ok: true,
      username,
      disconnected,
      cancelled_tasks: cancelledCount
    });
    return true;
  }

  if (pathname === "/api/component/deposit" && req.method === "POST") {
    if (!requirePermission(res, auth, "inventory.refresh")) {
      return true;
    }

    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    const componentId = asString(body.component_id).trim();
    if (!username) {
      writeJson(res, 409, {ok: false, message: "当前账号未连接，请先连接并刷新库存"});
      return true;
    }
    if (!requireSteamAccountAccess(res, auth, username)) {
      return true;
    }
    if (!refreshRuntime.isConnected(username)) {
      writeJson(res, 409, {ok: false, message: "当前账号未连接，请先连接并刷新库存"});
      return true;
    }
    try {
      const queued = await enqueueComponentMoveJob({
        action: "deposit",
        username,
        password: body.password,
        componentId,
        itemIds: body.item_ids
      });
      writeJson(res, 202, {
        ok: true,
        queued: true,
        message: `任务已加入队列：${queued.job.job_id}`,
        job: queued.job,
        queue: queued.snapshot
      });
    } catch (err) {
      writeJson(res, 500, {
        ok: false,
        message: asString(err && err.message ? err.message : err)
      });
    }
    return true;
  }

  if (pathname === "/api/component/deposit-candidates" && req.method === "GET") {
    if (!requirePermission(res, auth, "inventory.refresh")) {
      return true;
    }
    const username = asString(urlObj.searchParams.get("username") || "").trim();
    const componentId = asString(urlObj.searchParams.get("component_id") || "").trim();
    const includeExcluded = asString(urlObj.searchParams.get("include_excluded") || "").trim() === "1";
    if (!username) {
      writeJson(res, 409, {ok: false, message: "当前账号未连接，请先连接并刷新库存"});
      return true;
    }
    if (!requireSteamAccountAccess(res, auth, username)) {
      return true;
    }
    if (!refreshRuntime.isConnected(username)) {
      writeJson(res, 409, {ok: false, message: "当前账号未连接，请先连接并刷新库存"});
      return true;
    }
    try {
      const payload = await componentOpsService.listDepositCandidates({
        username,
        componentId,
        includeExcluded
      });
      writeJson(res, 200, payload);
    } catch (err) {
      writeJson(res, 500, {
        ok: false,
        message: asString(err && err.message ? err.message : err)
      });
    }
    return true;
  }

  if (pathname === "/api/component/withdraw" && req.method === "POST") {
    if (!requirePermission(res, auth, "inventory.refresh")) {
      return true;
    }
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    const componentId = asString(body.component_id).trim();
    if (!username) {
      writeJson(res, 409, {ok: false, message: "当前账号未连接，请先连接并刷新库存"});
      return true;
    }
    if (!requireSteamAccountAccess(res, auth, username)) {
      return true;
    }
    if (!refreshRuntime.isConnected(username)) {
      writeJson(res, 409, {ok: false, message: "当前账号未连接，请先连接并刷新库存"});
      return true;
    }
    try {
      const queued = await enqueueComponentMoveJob({
        action: "withdraw",
        username,
        password: body.password,
        componentId,
        itemIds: body.item_ids
      });
      writeJson(res, 202, {
        ok: true,
        queued: true,
        message: `任务已加入队列：${queued.job.job_id}`,
        job: queued.job,
        queue: queued.snapshot
      });
    } catch (err) {
      writeJson(res, 500, {
        ok: false,
        message: asString(err && err.message ? err.message : err)
      });
    }
    return true;
  }

  if (pathname === "/api/craft/assist-select" && req.method === "POST") {
    if (!requirePermission(res, auth, "simulation.use")) {
      return true;
    }
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    if (!username) {
      const failure = normalizeCraftAssistFailure({
        message: "username is required"
      }, {
        defaultStatus: 400,
        defaultCode: "craft_assist_invalid_input"
      });
      writeJson(res, failure.status, failure.payload);
      return true;
    }
    if (!requireSteamAccountAccess(res, auth, username)) {
      return true;
    }

    let loaded = null;
    try {
      loaded = loadRowsForAccountFromSnapshot(username);
    } catch (err) {
      const failure = normalizeCraftAssistFailure({
        message: asString(err && err.message ? err.message : err),
        code: asString(err && err.code ? err.code : ""),
        status: 409
      }, {
        defaultStatus: 409
      });
      writeJson(res, failure.status, failure.payload);
      return true;
    }
    let normalizedAssist = null;
    try {
      normalizedAssist = buildCraftAssistSelectRoutePayload(body, {
        rows: loaded.rows
      });
    } catch (err) {
      const failure = normalizeCraftAssistFailure({
        message: asString(err && err.message ? err.message : err),
        code: asString(err && err.code ? err.code : ""),
        status: Number(err && err.status) || 400
      }, {
        defaultStatus: 400,
        defaultCode: "craft_assist_invalid_input"
      });
      writeJson(res, failure.status, failure.payload);
      return true;
    }
    const workerArgs = normalizedAssist.request;
    const workerPool = getCraftAssistWorkerPool();
    let result = null;
    try {
      result = workerPool
        ? await workerPool.selectForRecipe({
          snapshotPath: loaded.snapshot_path,
          ...workerArgs
        })
        : await craftAssistService.selectForRecipe({
          rows: loaded.rows,
          candidateRows: normalizedAssist.candidateRows,
          ...workerArgs
        });
    } catch (err) {
      const failure = normalizeCraftAssistFailure({
        message: asString(err && err.message ? err.message : err),
        code: asString(err && err.code ? err.code : ""),
        status: 500,
        enableFastCraftAssist: workerArgs.enableFastCraftAssist
      }, {
        defaultStatus: 500
      });
      writeJson(res, failure.status, failure.payload);
      return true;
    }
    if (!result.ok) {
      const failure = normalizeCraftAssistFailure({
        message: asString(result.message || "").trim() || "辅助选材失败",
        detail: asString(result.detail || "").trim(),
        code: asString(result.code || result.reason || "").trim(),
        status: 400,
        enableFastCraftAssist: workerArgs.enableFastCraftAssist
      }, {
        defaultStatus: 400
      });
      writeJson(res, failure.status, failure.payload);
      return true;
    }
    const recipeMatch = asString(result.recipe_text || "").match(/recipe\s+(-?\d+)/i);
    if (!workerArgs.previewOnly) appendCraftDebugEvent({
      ...buildCraftAssistSelectionEvent({
        account: username,
        targetRaw: workerArgs.targetWearRaw,
        target: workerArgs.targetWear,
        approachMode: result.approach_mode || workerArgs.wearApproachMode,
        predictedOverall: result.overall,
        quantizedOverall: Number.isFinite(Number(result.quantized_overall))
          ? Number(result.quantized_overall)
          : quantizeMeanToTargetDomain(result.overall),
        recipeInfo: {
          recipe: recipeMatch ? Number(recipeMatch[1]) : null,
          recipe_name: result.recipe_text,
          rarity: result.rarity,
          stattrak: /\bStatTrak\b/i.test(asString(result.recipe_text || ""))
        },
        itemIdsOrdered: result.item_ids,
        rows: loaded.rows
      }),
      logger
    });
    writeJson(res, 200, {
      ok: true,
      ...result
    });
    return true;
  }

  if (pathname === "/api/craft/predict-outcomes" && req.method === "POST") {
    if (!requirePermission(res, auth, "simulation.use")) {
      return true;
    }
    const body = await readJsonBody(req);
    try {
      const predictor = getCraftOutcomePredictor(deps.craftOutcomePredictor);
      const result = predictor.predict(body);
      writeJson(res, result && result.ok ? 200 : 400, result);
    } catch (err) {
      writeJson(res, 500, {
        ok: false,
        message: asString(err && err.message ? err.message : err)
      });
    }
    return true;
  }

  if (pathname === "/api/simulation/tradeup/search-items" && req.method === "GET") {
    if (!requirePermission(res, auth, "simulation.use")) {
      return true;
    }
    try {
      const catalog = getTradeupSimulationCatalog(deps.tradeupSimulationCatalog);
      const query = asString(urlObj.searchParams.get("q") || "").trim();
      writeJson(res, 200, {
        ok: true,
        items: catalog.searchItems(query)
      });
    } catch (err) {
      writeJson(res, 500, {
        ok: false,
        message: asString(err && err.message ? err.message : err)
      });
    }
    return true;
  }

  if (pathname === "/api/simulation/tradeup/item" && req.method === "GET") {
    if (!requirePermission(res, auth, "simulation.use")) {
      return true;
    }
    try {
      const catalog = getTradeupSimulationCatalog(deps.tradeupSimulationCatalog);
      const markethashname = asString(urlObj.searchParams.get("markethashname") || "").trim();
      writeJson(res, 200, {
        ok: true,
        item: markethashname ? catalog.getItemByMarketHashName(markethashname) : null
      });
    } catch (err) {
      writeJson(res, 500, {
        ok: false,
        message: asString(err && err.message ? err.message : err)
      });
    }
    return true;
  }

  if (pathname === "/api/simulation/tradeup/resolve" && req.method === "POST") {
    if (!requirePermission(res, auth, "simulation.use")) {
      return true;
    }
    const body = await readJsonBody(req);
    try {
      const catalog = getTradeupSimulationCatalog(deps.tradeupSimulationCatalog);
      const service = getTradeupSimulationService(deps.tradeupSimulationService, catalog);
      const result = service.resolve(body);
      writeJson(res, result && result.ok ? 200 : 400, result || {ok: false, message: "simulation resolve failed"});
    } catch (err) {
      writeJson(res, 500, {
        ok: false,
        message: asString(err && err.message ? err.message : err)
      });
    }
    return true;
  }

  if (pathname === "/api/craft/candidates" && req.method === "POST") {
    if (!requirePermission(res, auth, "simulation.use")) {
      return true;
    }
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }
    if (!requireSteamAccountAccess(res, auth, username)) {
      return true;
    }
    let loaded = null;
    try {
      loaded = loadRowsForAccountFromSnapshot(username);
    } catch (err) {
      writeJson(res, 409, {ok: false, message: asString(err && err.message ? err.message : err)});
      return true;
    }
    const includeComponentItemsRaw = body.include_component_items;
    const includeComponentItemsText = asString(includeComponentItemsRaw).trim().toLowerCase();
    const includeComponentItems = includeComponentItemsRaw === true
      || includeComponentItemsRaw === 1
      || includeComponentItemsText === "1"
      || includeComponentItemsText === "true";
    const context = buildCraftCandidateContext({
      rows: loaded.rows,
      includeComponentItems,
      includeCooling: body.include_cooling,
      selectedItemIds: body.selected_item_ids
    });
    writeJson(res, 200, {
      ok: true,
      rows: context.candidateRows,
      stats: context.stats,
      fetch_time: loaded.fetch_time,
      snapshot_path: loaded.snapshot_path
    });
    return true;
  }

  if (pathname === "/api/craft/tradeup-with-components" && req.method === "POST") {
    if (!requirePermission(res, auth, "craft.use")) {
      return true;
    }
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    if (username && !requireSteamAccountAccess(res, auth, username)) {
      return true;
    }
    if (!username || !refreshRuntime.isConnected(username)) {
      writeJson(res, 409, {ok: false, message: "当前账号未连接，请先连接并刷新库存"});
      return true;
    }
    let operationId = "";
    try {
      operationId = resolveCraftOperationId(body);
    } catch (err) {
      writeJson(res, 400, {ok: false, reason: "invalid_operation_id", message: asString(err && err.message)});
      return true;
    }
    const outcome = await runCraftOperation({
      username,
      operationId,
      execute: async (activeRun) => {
        const allowCoolingRaw = body.allow_cooling;
        const allowCoolingText = asString(allowCoolingRaw).trim().toLowerCase();
        const allowCooling = allowCoolingRaw === true || allowCoolingRaw === 1 || allowCoolingText === "1" || allowCoolingText === "true";
        const normalizeSpecialQuality = parseBooleanBodyValue(body.normalize_special_quality, false);
        const prepareOnlyRaw = body.prepare_only;
        const prepareOnlyText = asString(prepareOnlyRaw).trim().toLowerCase();
        const prepareOnly = prepareOnlyRaw === true || prepareOnlyRaw === 1 || prepareOnlyText === "1" || prepareOnlyText === "true";
        const recipeCount = Array.isArray(body.recipes) ? body.recipes.length : 0;
        logger.info(
          "ui_server",
          `craft-with-components request: account=${username} operation=${operationId} recipes=${recipeCount} allow_cooling=${allowCooling ? 1 : 0} prepare_only=${prepareOnly ? 1 : 0}`
        );
        try {
        const payload = await craftTradeupWithComponentsService.runTradeUpWithComponents({
          username,
          password: body.password,
          recipes: body.recipes,
          allowCooling,
          normalizeSpecialQuality,
          prepareOnly,
          shouldPause: activeRun && typeof activeRun.shouldPause === "function" ? () => activeRun.shouldPause() : null,
          onProgress: (progress) => {
            refreshRuntime.emitSse("craft_component_progress", {
              username,
              run_id: operationId,
              ...progress
            });
          }
        });
        const status = payload && payload.ok === false ? 409 : 200;
        if (status === 200) {
          logger.info(
            "ui_server",
            `craft-with-components success: account=${username} recipes=${toInt(payload && payload.recipe_count, 0)} ready=${toInt(payload && payload.ready_recipe_count, 0)} skipped=${toInt(payload && payload.skipped_recipe_count, 0)} steps=${Array.isArray(payload && payload.steps) ? payload.steps.length : 0}`
          );
        } else {
          logger.warn(
            "ui_server",
            `craft-with-components blocked: account=${username} ready=${toInt(payload && payload.ready_recipe_count, 0)} skipped=${toInt(payload && payload.skipped_recipe_count, 0)} paused=${payload && payload.paused ? 1 : 0} msg=${asString(payload && payload.message ? payload.message : "")}`
          );
        }
          return {
            status,
            payload: {
              ok: status === 200,
              ...payload,
              component: buildComponentSummary(payload.rows || []),
              operation_id: operationId
            }
          };
        } catch (err) {
          if (err && err.craft_payload) {
            const payload = err.craft_payload;
            logger.warn(
              "ui_server",
              `craft-with-components partial: account=${username} completed=${Array.isArray(payload && payload.completed_steps) ? payload.completed_steps.length : 0} msg=${asString(err && err.message ? err.message : err)}`
            );
            return {
              status: 409,
              payload: {
                ok: false,
                ...payload,
                component: buildComponentSummary(payload.rows || []),
                message: asString(err && err.message ? err.message : err),
                operation_id: operationId
              }
            };
          }
          const status = err && err.code === "snapshot_missing"
            ? 409
            : (err && err.code === "bad_request" ? 400 : 500);
          logger.warn("ui_server", `craft-with-components failed: account=${username} status=${status} msg=${asString(err && err.message ? err.message : err)}`);
          return {
            status,
            payload: {
              ok: false,
              message: asString(err && err.message ? err.message : err),
              operation_id: operationId
            }
          };
        }
      }
    });
    writeJson(res, outcome.status, outcome.payload);
    return true;
  }

  if (pathname === "/api/craft/pause" && req.method === "POST") {
    if (!requirePermission(res, auth, "craft.use")) {
      return true;
    }
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }
    if (!requireSteamAccountAccess(res, auth, username)) {
      return true;
    }
    const activeRun = getActiveCraftRun(username);
    if (activeRun && typeof activeRun.requestPause === "function") {
      activeRun.requestPause();
      logger.info("ui_server", `craft pause requested: account=${username} run=${asString(activeRun.runId).trim() || "-"}`);
      writeJson(res, 200, {
        ok: true,
        accepted: true,
        message: "暂停请求已发送"
      });
      return true;
    }
    writeJson(res, 200, {
      ok: true,
      accepted: false,
      message: "当前没有可暂停的炼金任务"
    });
    return true;
  }

  if (pathname === "/api/craft/tradeup" && req.method === "POST") {
    if (!requirePermission(res, auth, "craft.use")) {
      return true;
    }
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    if (username && !requireSteamAccountAccess(res, auth, username)) {
      return true;
    }
    if (!username || !refreshRuntime.isConnected(username)) {
      writeJson(res, 409, {ok: false, message: "当前账号未连接，请先连接并刷新库存"});
      return true;
    }
    let operationId = "";
    try {
      operationId = resolveCraftOperationId(body);
    } catch (err) {
      writeJson(res, 400, {ok: false, reason: "invalid_operation_id", message: asString(err && err.message)});
      return true;
    }
    const outcome = await runCraftOperation({
      username,
      operationId,
      execute: async () => {
        try {
          const allowCoolingRaw = body.allow_cooling;
          const allowCoolingText = asString(allowCoolingRaw).trim().toLowerCase();
          const allowCooling = allowCoolingRaw === true || allowCoolingRaw === 1 || allowCoolingText === "1" || allowCoolingText === "true";
          const normalizeSpecialQuality = parseBooleanBodyValue(body.normalize_special_quality, false);
          const hasRecipes = Array.isArray(body.recipes) && body.recipes.length > 0;
          const recipeCount = hasRecipes ? body.recipes.length : (Array.isArray(body.item_ids) && body.item_ids.length ? 1 : 0);
          if (requestUsesComponentSourceRecipes(body)) {
            const message = "检测到组件来源物品，必须走“先取出组件物品再汰换”的执行链，请重新执行";
            logger.warn("ui_server", `craft blocked: account=${username} reason=component_route_required recipes=${recipeCount}`);
            return {
              status: 409,
              payload: {ok: false, reason: "component_route_required", message, operation_id: operationId}
            };
          }
          logger.info("ui_server", `craft request: account=${username} operation=${operationId} recipes=${recipeCount} allow_cooling=${allowCooling ? 1 : 0}`);
          const payload = hasRecipes
            ? await craftService.runTradeUpBatch({
              username,
              password: body.password,
              recipes: body.recipes,
              allowCooling,
              normalizeSpecialQuality
            })
            : await craftService.runTradeUp({
              username,
              password: body.password,
              itemIds: body.item_ids,
              allowCooling,
              normalizeSpecialQuality
            });
          logger.info(
            "ui_server",
            `craft success: account=${username} recipes=${toInt(payload && payload.recipe_count, 0)} steps=${Array.isArray(payload && payload.steps) ? payload.steps.length : 0} gained=${Array.isArray(payload && payload.gained_ids) ? payload.gained_ids.length : 0}`
          );
          return {
            status: 200,
            payload: {
              ok: true,
              ...payload,
              component: buildComponentSummary(payload.rows || []),
              operation_id: operationId
            }
          };
        } catch (err) {
          if (err && err.craft_payload) {
            const payload = err.craft_payload;
            logger.warn(
              "ui_server",
              `craft partial: account=${username} completed=${Array.isArray(payload && payload.completed_steps) ? payload.completed_steps.length : 0} failed_step=${toInt(payload && payload.failed_step, 0)} msg=${asString(err && err.message ? err.message : err)}`
            );
            return {
              status: 409,
              payload: {
                ok: false,
                ...payload,
                component: buildComponentSummary(payload.rows || []),
                message: asString(err && err.message ? err.message : err),
                operation_id: operationId
              }
            };
          }
          const status = err && err.code === "bad_request" ? 400 : 500;
          logger.warn("ui_server", `craft failed: account=${username} status=${status} msg=${asString(err && err.message ? err.message : err)}`);
          return {
            status,
            payload: {
              ok: false,
              message: asString(err && err.message ? err.message : err),
              operation_id: operationId
            }
          };
        }
      }
    });
    writeJson(res, outcome.status, outcome.payload);
    return true;
  }

  if (pathname === "/api/component/tasks" && req.method === "GET") {
    if (!requirePermission(res, auth, "inventory.refresh")) {
      return true;
    }
    const username = asString(urlObj.searchParams.get("username") || "").trim();
    if (username && !requireSteamAccountAccess(res, auth, username)) {
      return true;
    }
    const snapshot = componentTaskQueue.getSnapshot(username);
    writeJson(res, 200, {
      ok: true,
      ...(username ? snapshot : filterComponentTaskSnapshotForAuth(snapshot, auth))
    });
    return true;
  }

  if (pathname === "/api/component/tasks/cancel" && req.method === "POST") {
    if (!requirePermission(res, auth, "inventory.refresh")) {
      return true;
    }
    const body = await readJsonBody(req);
    const jobId = asString(body.job_id).trim();
    const job = findComponentTaskJob(jobId);
    if (job && !requireSteamAccountAccess(res, auth, job.username)) {
      return true;
    }
    const result = componentTaskQueue.cancel(jobId);
    if (!result.ok) {
      const status = result.code === "running" ? 409 : (result.code === "invalid_job_id" ? 400 : 404);
      writeJson(res, status, {
        ok: false,
        message: result.message
      });
      return true;
    }
    writeJson(res, 200, {
      ok: true,
      message: "任务已取消",
      job: result.job,
      queue: componentTaskQueue.getSnapshot("")
    });
    return true;
  }

  if (pathname === "/api/snapshot/latest" && req.method === "GET") {
    const snapshots = listProcessedSnapshots();
    if (!snapshots.length) {
      writeJson(res, 200, {ok: true, snapshot: null, rows: [], component: {summary_map: {}, item_map: {}}});
      return true;
    }
    const snap = snapshots[0];
    try {
      const rows = loadSnapshotRows(snap.full);
      const component = buildComponentSummary(rows);
      writeJson(res, 200, {
        ok: true,
        snapshot: {
          path: snap.full,
          name: snap.name
        },
        rows,
        component
      });
    } catch (err) {
      writeJson(res, 500, {ok: false, message: asString(err && err.message ? err.message : err)});
    }
    return true;
  }

  if (pathname === "/api/snapshot/account" && req.method === "GET") {
    if (!requirePermission(res, auth, "inventory.read")) {
      return true;
    }
    const username = asString(urlObj.searchParams.get("username") || "").trim();
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }
    if (!requireSteamAccountAccess(res, auth, username)) {
      return true;
    }
    const uiState = getUiStateStore(deps, viewerUsername);
    const accountCache = uiState.getAccount(username);
    const connected = refreshRuntime.isConnected(username);
    const authState = asString(accountCache && accountCache.auth_state || "").trim() || "normal";
    const authReason = asString(accountCache && accountCache.auth_reason || "").trim();
    if (!accountCache || !accountCache.snapshot_path) {
      writeJson(res, 200, attachWebInventoryStubArtifact({
        ok: true,
        snapshot: null,
        rows: [],
        component: {summary_map: {}, item_map: {}},
        fetch_time: "",
        connected,
        auth_state: authState,
        auth_reason: authReason
      }, {
        urlObj,
        pathname,
        username,
        snapshot: null,
        rows: [],
        component: {summary_map: {}, item_map: {}},
        fetchTime: "",
        connected,
        authState,
        authReason
      }));
      return true;
    }
    const loaded = loadSnapshotSafe(accountCache.snapshot_path);
    if (!loaded.snapshot) {
      writeJson(res, 200, attachWebInventoryStubArtifact({
        ok: true,
        snapshot: null,
        rows: [],
        component: {summary_map: {}, item_map: {}},
        fetch_time: asString(accountCache.fetch_time || ""),
        connected,
        auth_state: authState,
        auth_reason: authReason
      }, {
        urlObj,
        pathname,
        username,
        snapshot: null,
        rows: [],
        component: {summary_map: {}, item_map: {}},
        fetchTime: asString(accountCache.fetch_time || ""),
        connected,
        authState,
        authReason
      }));
      return true;
    }
    const component = buildComponentSummary(loaded.rows);
    writeJson(res, 200, attachWebInventoryStubArtifact({
      ok: true,
      snapshot: loaded.snapshot,
      rows: loaded.rows,
      component,
      fetch_time: asString(accountCache.fetch_time || ""),
      connected,
      auth_state: authState,
      auth_reason: authReason
    }, {
      urlObj,
      pathname,
      username,
      snapshot: loaded.snapshot,
      rows: loaded.rows,
      component,
      fetchTime: asString(accountCache.fetch_time || ""),
      connected,
      authState,
      authReason
    }));
    return true;
  }

  if (pathname === "/api/snapshot/accounts" && req.method === "GET") {
    if (!requirePermission(res, auth, "inventory.read")) {
      return true;
    }
    const csv = asString(urlObj.searchParams.get("usernames") || "").trim();
    let usernames = csv
      .split(",")
      .map((x) => asString(x).trim())
      .filter(Boolean);
    if (!usernames.length) {
      const store = getViewerAccountStore(auth, deps);
      usernames = store
        .list()
        .map((x) => asString(x.username).trim())
        .filter(Boolean);
    }
    usernames = usernames.filter((username) => canAccessSteamAccount(auth, username));
    usernames = [...new Set(usernames)];
    if (!usernames.length) {
      writeJson(res, 200, {ok: true, snapshots: []});
      return true;
    }
    const uiState = getUiStateStore(deps, viewerUsername);
    const snapshots = await Promise.all(
      usernames.map(async (username) => {
        const accountCache = uiState.getAccount(username);
        const snapshotPath = asString(accountCache && accountCache.snapshot_path ? accountCache.snapshot_path : "").trim();
        const fetchTime = asString(accountCache && accountCache.fetch_time ? accountCache.fetch_time : "").trim();
        if (!snapshotPath) {
          return {
            username,
            snapshot: null,
            rows: [],
            component: {summary_map: {}, item_map: {}},
            fetch_time: fetchTime,
            connected: refreshRuntime.isConnected(username)
          };
        }
        try {
          const loaded = await loadSnapshotSafeAsync(snapshotPath);
          if (!loaded.snapshot) {
            return {
              username,
              snapshot: null,
              rows: [],
              component: {summary_map: {}, item_map: {}},
              fetch_time: fetchTime,
              connected: refreshRuntime.isConnected(username)
            };
          }
          const component = buildComponentSummary(loaded.rows);
          return {
            username,
            snapshot: loaded.snapshot,
            rows: loaded.rows,
            component,
            fetch_time: fetchTime,
            connected: refreshRuntime.isConnected(username)
          };
        } catch (err) {
          return {
            username,
            snapshot: null,
            rows: [],
            component: {summary_map: {}, item_map: {}},
            fetch_time: fetchTime,
            connected: refreshRuntime.isConnected(username),
            error: asString(err && err.message ? err.message : err)
          };
        }
      })
    );

    writeJson(res, 200, {
      ok: true,
      snapshots
    });
    return true;
  }

  if (pathname === "/api/snapshot/account/meta" && req.method === "GET") {
    if (!requirePermission(res, auth, "inventory.read")) {
      return true;
    }
    const username = asString(urlObj.searchParams.get("username") || "").trim();
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }
    if (!requireSteamAccountAccess(res, auth, username)) {
      return true;
    }
    const uiState = getUiStateStore(deps, viewerUsername);
    const accountCache = uiState.getAccount(username);
    const snapshotPath = asString(accountCache && accountCache.snapshot_path ? accountCache.snapshot_path : "").trim();
    writeJson(res, 200, {
      ok: true,
      username,
      has_snapshot: Boolean(snapshotPath && fs.existsSync(snapshotPath)),
      fetch_time: asString(accountCache && accountCache.fetch_time ? accountCache.fetch_time : "").trim(),
      connected: refreshRuntime.isConnected(username)
    });
    return true;
  }

  if (pathname === "/api/accounts/batch-import/preflight" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) {
      return true;
    }
    const body = await readJsonBody(req);
    const accounts = Array.isArray(body && body.accounts) ? body.accounts : [];
    if (accounts.length === 0) {
      writeJson(res, 400, {ok: false, message: "accounts 列表为空"});
      return true;
    }
    const service = createSteamGuardImportService({
      accountStore: getViewerAccountStore(auth, deps),
      isConnected: (username) => refreshRuntime.isConnected(username)
    });
    writeJson(res, 200, {ok: true, ...service.preflight(accounts)});
    return true;
  }

  if (pathname === "/api/accounts/batch-import" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) {
      return true;
    }
    const body = await readJsonBody(req);
    const accounts = Array.isArray(body && body.accounts) ? body.accounts : [];
    if (accounts.length === 0) {
      writeJson(res, 400, {ok: false, message: "accounts 列表为空"});
      return true;
    }

    // SSE 流式响应
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });

    const sendSse = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendSse("progress", {total: accounts.length, done: 0, message: "开始批量导入..."});

    const accountStore = getViewerAccountStore(auth, deps);
    const service = createSteamGuardImportService({
      accountStore,
      isConnected: (username) => refreshRuntime.isConnected(username)
    });
    const outcome = service.execute(accounts);
    for (let index = 0; index < outcome.results.length; index += 1) {
      const result = outcome.results[index];
      sendSse("account_result", {
        ...result,
        done: index + 1,
        total: accounts.length
      });
      logger.info("ui_server", `batch-import result: account=${result.account_name || "-"} status=${result.status}`);
    }

    sendSse("done", {
      total: accounts.length,
      done: accounts.length,
      ...outcome.summary,
      message: "批量导入完成"
    });
    res.end();
    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // 批量拉取库存（SSE 流式返回）
  // ═══════════════════════════════════════════════════════════════
  if (pathname === "/api/accounts/batch-inventory" && req.method === "POST") {
    if (!requirePermission(res, auth, "inventory.read")) {
      return true;
    }
    const body = await readJsonBody(req);
    const usernames = Array.isArray(body && body.usernames) ? body.usernames : [];
    if (usernames.length === 0) {
      writeJson(res, 400, {ok: false, message: "usernames 列表为空"});
      return true;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });

    const sendSse = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const accountStore = getViewerAccountStore(auth, deps);
    let doneCount = 0;

    for (const uname of usernames) {
      const username = asString(uname).trim();
      if (!username) {
        doneCount++;
        continue;
      }

      try {
        const account = getAccountCredentials(accountStore, username);
        if (!account) {
          throw new Error("账号不存在");
        }
        logger.info("web_inventory_fetch", `account=${username} mode=batch step=start`);

        sendSse("inventory_progress", {username, step: "cookie", message: `${username} 刷新 Cookie...`});

        const items = await runAccountWebOperation(account, {tokenRecoveryService}, async ({webSession}) => {
          logger.info("web_inventory_fetch", `account=${username} mode=batch step=session ${summarizeWebSessionForLog(webSession)}`);
          sendSse("inventory_progress", {username, step: "fetch", message: `${username} 拉取库存...`});
          return fetchFullInventory({
            steamId64: webSession.steamId64,
            cookieString: webSession.cookieString,
            onTrace: (trace) => {
              logWebInventoryFetchTrace({username, mode: "batch", trace});
            },
            onPage: (pageIdx, pageItems, totalSoFar) => {
              sendSse("inventory_page", {username, page: pageIdx, page_count: pageItems.length, total: totalSoFar});
              logger.info("web_inventory_fetch", `account=${username} mode=batch phase=page page=${pageIdx + 1} page_count=${pageItems.length} total=${totalSoFar}`);
            }
          });
        });

        doneCount++;
        sendSse("inventory_result", {
          username,
          ok: true,
          item_count: items.length,
          items,
          done: doneCount,
          total: usernames.length
        });
        logger.info("ui_server", `batch-inventory success: account=${username} items=${items.length}`);
        logger.info("web_inventory_fetch", `account=${username} mode=batch step=done items=${items.length}`);
      } catch (err) {
        doneCount++;
        const msg = asString(err && err.message ? err.message : err).trim() || "未知错误";
        sendSse("inventory_result", {
          username,
          ok: false,
          message: msg,
          items: [],
          done: doneCount,
          total: usernames.length
        });
        logger.warn("ui_server", `batch-inventory failed: account=${username} error=${msg}`);
        logger.warn("web_inventory_fetch", `account=${username} mode=batch step=failed error=${sanitizeLogValue(msg) || "-"}`);
      }
    }

    sendSse("done", {total: usernames.length, done: doneCount});
    res.end();
    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // 单账号库存拉取
  // ═══════════════════════════════════════════════════════════════
  if (pathname.startsWith("/api/accounts/") && pathname.endsWith("/inventory") && req.method === "GET") {
    if (!requirePermission(res, auth, "inventory.read")) {
      return true;
    }
    const parts = pathname.split("/");
    const username = decodeURIComponent(parts[3] || "");
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }

    try {
      const accountStore = getViewerAccountStore(auth, deps);
      const account = getAccountCredentials(accountStore, username);
      if (!account) {
        writeJson(res, 400, {ok: false, message: "账号不存在"});
        return true;
      }
      logger.info("web_inventory_fetch", `account=${username} mode=single step=start`);

      const items = await runAccountWebOperation(account, {tokenRecoveryService}, async ({webSession}) => {
        logger.info("web_inventory_fetch", `account=${username} mode=single step=session ${summarizeWebSessionForLog(webSession)}`);
        return fetchFullInventory({
          steamId64: webSession.steamId64,
          cookieString: webSession.cookieString,
          onTrace: (trace) => {
            logWebInventoryFetchTrace({username, mode: "single", trace});
          },
          onPage: (pageIdx, pageItems, totalSoFar) => {
            logger.info("web_inventory_fetch", `account=${username} mode=single phase=page page=${pageIdx + 1} page_count=${pageItems.length} total=${totalSoFar}`);
          }
        });
      });

      logger.info("web_inventory_fetch", `account=${username} mode=single step=done items=${items.length}`);
      writeJson(res, 200, {ok: true, username, item_count: items.length, items});
    } catch (err) {
      const message = asString(err && err.message ? err.message : err).trim();
      logger.warn("web_inventory_fetch", `account=${username} mode=single step=failed error=${sanitizeLogValue(message) || "-"}`);
      writeJson(res, 500, {ok: false, message});
    }
    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // 发送交易报价（全自动三步：发送 → A确认 → B接受确认）
  // ═══════════════════════════════════════════════════════════════
  if (pathname === "/api/accounts/send-trade-offer" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) {
      return true;
    }
    const body = await readJsonBody(req);
    const fromUsername = asString(body && body.fromUsername).trim();
    const toTradeUrl = asString(body && body.toTradeUrl).trim();
    const assetIds = Array.isArray(body && body.assetIds) ? body.assetIds.map((id) => asString(id).trim()).filter(Boolean) : [];

    if (!fromUsername || !toTradeUrl || assetIds.length === 0) {
      writeJson(res, 400, {ok: false, message: "fromUsername, toTradeUrl, assetIds 均为必填"});
      return true;
    }

    // SSE 流式
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });

    const sendSse = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const accountStore = getViewerAccountStore(auth, deps);
      const fromAccount = getAccountCredentials(accountStore, fromUsername);
      if (!fromAccount) {
        sendSse("error", {message: "发送方账号不存在"});
        res.end();
        return true;
      }

      const {webSession: fromSession, hasMaFile: fromHasMaFile, maData: fromMaData} = await resolveAccountWebSession(fromAccount);
      const {partnerId, tradeToken} = parseTradeUrl(toTradeUrl);

      // 计算接收方 SteamID64
      const partnerSteamId64 = String(BigInt(partnerId) + BigInt("76561197960265728"));

      // Step 1: Cookie 已刷新
      sendSse("step", {step: "cookie", message: "发送方 Cookie 已就绪" + (fromHasMaFile ? "" : "（Token 模式）")});

      // Step 2: 发送报价
      sendSse("step", {step: "send", message: `发送交易报价 (${assetIds.length} 件物品)...`});
      const {tradeofferid} = await sendTradeOffer({
        cookieString: fromSession.cookieString,
        sessionid: fromSession.sessionid,
        partnerSteamId64,
        partnerId,
        tradeToken,
        assetIds,
        message: asString(body.message || "").trim()
      });
      sendSse("step", {step: "sent", message: `报价已发送 ID=${tradeofferid}`, tradeofferid});
      logger.info("ui_server", `trade-offer sent: from=${fromUsername} offer=${tradeofferid} items=${assetIds.length}`);

      // Step 3: A号确认（需要 identity_secret，仅 maFile 账号可自动）
      let confirmed = false;
      if (fromHasMaFile && fromMaData && fromMaData.identitySecret) {
        sendSse("step", {step: "confirm_sender", message: "发送方自动确认交易..."});
        confirmed = await confirmTradeOffer({
          cookieString: fromSession.cookieString,
          steamId64: fromSession.steamId64,
          identitySecret: fromMaData.identitySecret,
          tradeofferId: tradeofferid
        });
        sendSse("step", {step: "sender_confirmed", message: confirmed ? "发送方已自动确认" : "发送方确认未找到（可能需手动确认）", confirmed});
      } else {
        sendSse("step", {step: "sender_manual_confirm", message: "⚠ 发送方无 maFile，请在 Steam 手机 App 中手动确认此交易", needs_manual: true});
      }

      // Step 4: 尝试 B号自动接受（如果B号也在库中）
      let receiverAccepted = false;
      const allAccounts = accountStore.list();
      const receiverAccount = allAccounts.find((a) => {
        const sid = asString(a.steam_id64 || a.steam_id || "").trim();
        return sid === partnerSteamId64;
      });

      if (receiverAccount) {
        try {
          const receiverCredentials = getAccountCredentials(accountStore, receiverAccount.username);
          const {webSession: receiverSession, hasMaFile: recvHasMaFile, maData: recvMaData} = await resolveAccountWebSession(receiverCredentials);
          sendSse("step", {step: "accept_receiver", message: `接收方 ${receiverAccount.username} 自动接受...`});

          await acceptTradeOffer({
            cookieString: receiverSession.cookieString,
            sessionid: receiverSession.sessionid,
            tradeofferId: tradeofferid,
            partnerSteamId64: fromSession.steamId64
          });

          // B号确认
          if (recvHasMaFile && recvMaData && recvMaData.identitySecret) {
            const receiverConfirmed = await confirmTradeOffer({
              cookieString: receiverSession.cookieString,
              steamId64: receiverSession.steamId64,
              identitySecret: recvMaData.identitySecret,
              tradeofferId: tradeofferid
            });
            receiverAccepted = true;
            sendSse("step", {step: "receiver_confirmed", message: "接收方已接受并自动确认", confirmed: receiverConfirmed});
          } else {
            sendSse("step", {step: "receiver_accepted_no_confirm", message: `接收方 ${receiverAccount.username} 已接受，但无 maFile，请在 Steam 手机 App 中手动确认`, needs_manual: true});
          }
        } catch (recvErr) {
          sendSse("step", {step: "receiver_failed", message: `接收方自动接受失败: ${asString(recvErr.message || recvErr).slice(0, 200)}`});
        }
      } else {
        sendSse("step", {step: "receiver_manual", message: "接收方不在库中，需手动接受"});
      }

      sendSse("done", {
        ok: true,
        tradeofferid,
        sender_confirmed: confirmed,
        receiver_accepted: receiverAccepted,
        needs_manual_confirm: !fromHasMaFile
      });
    } catch (err) {
      sendSse("error", {message: asString(err && err.message ? err.message : err).trim()});
    }
    res.end();
    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // 接受传入报价
  // ═══════════════════════════════════════════════════════════════
  if (pathname === "/api/accounts/accept-offers" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) {
      return true;
    }
    const body = await readJsonBody(req);
    const username = asString(body && body.username).trim();
    const tradeofferIds = Array.isArray(body && body.tradeofferIds) ? body.tradeofferIds.map((id) => asString(id).trim()).filter(Boolean) : [];

    if (!username || tradeofferIds.length === 0) {
      writeJson(res, 400, {ok: false, message: "username 和 tradeofferIds 均为必填"});
      return true;
    }

    try {
      const accountStore = getViewerAccountStore(auth, deps);
      const account = getAccountCredentials(accountStore, username);
      if (!account) {
        writeJson(res, 400, {ok: false, message: "账号不存在"});
        return true;
      }

      const {webSession, hasMaFile, maData} = await resolveAccountWebSession(account);
      const results = [];

      for (const offerId of tradeofferIds) {
        try {
          await acceptTradeOffer({
            cookieString: webSession.cookieString,
            sessionid: webSession.sessionid,
            tradeofferId: offerId,
            partnerSteamId64: ""
          });

          let confirmed = false;
          if (hasMaFile && maData && maData.identitySecret) {
            confirmed = await confirmTradeOffer({
              cookieString: webSession.cookieString,
              steamId64: webSession.steamId64,
              identitySecret: maData.identitySecret,
              tradeofferId: offerId
            });
          }

          results.push({tradeofferid: offerId, ok: true, confirmed, needs_manual_confirm: !hasMaFile});
        } catch (err) {
          results.push({tradeofferid: offerId, ok: false, message: asString(err.message || err).slice(0, 200)});
        }
      }

      writeJson(res, 200, {ok: true, results, needs_manual_confirm: !hasMaFile});
    } catch (err) {
      writeJson(res, 500, {ok: false, message: asString(err && err.message ? err.message : err).trim()});
    }
    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // 撤销已发出报价
  // ═══════════════════════════════════════════════════════════════
  if (pathname === "/api/accounts/cancel-sent-offers" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) {
      return true;
    }
    const body = await readJsonBody(req);
    const username = asString(body && body.username).trim();
    const tradeofferIds = Array.isArray(body && body.tradeofferIds) ? body.tradeofferIds.map((id) => asString(id).trim()).filter(Boolean) : [];

    if (!username || tradeofferIds.length === 0) {
      writeJson(res, 400, {ok: false, message: "username 和 tradeofferIds 均为必填"});
      return true;
    }

    try {
      const accountStore = getViewerAccountStore(auth, deps);
      const account = getAccountCredentials(accountStore, username);
      if (!account) {
        writeJson(res, 400, {ok: false, message: "账号不存在"});
        return true;
      }

      const {webSession} = await resolveAccountWebSession(account);
      const results = [];

      for (const offerId of tradeofferIds) {
        try {
          await cancelTradeOffer({
            cookieString: webSession.cookieString,
            sessionid: webSession.sessionid,
            tradeofferId: offerId
          });
          results.push({tradeofferid: offerId, ok: true});
        } catch (err) {
          results.push({tradeofferid: offerId, ok: false, message: asString(err.message || err).slice(0, 200)});
        }
      }

      writeJson(res, 200, {ok: true, results});
    } catch (err) {
      writeJson(res, 500, {ok: false, message: asString(err && err.message ? err.message : err).trim()});
    }
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Steam Market / Account Tools
  // ═══════════════════════════════════════════════════════════════════════

  if (pathname === "/api/market/batch-sell" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) return true;
    try {
      const body = await readJsonBody(req);
      const username = asString(body.username || "").trim();
      const items = Array.isArray(body.items) ? body.items : [];
      if (!username || items.length === 0) {
        writeJson(res, 400, {ok: false, message: "缺少 username 或 items"});
        return true;
      }

      const accountStore = getViewerAccountStore(auth, deps);
      const account = getAccountCredentials(accountStore, username);
      if (!account) { writeJson(res, 404, {ok: false, message: "账号不存在"}); return true; }

      const {webSession} = await resolveAccountWebSession(account);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      const sendSse = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      let successCount = 0, failCount = 0;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const assetId = asString(item.assetId || "").trim();
        const priceInCents = Number(item.priceInCents) || 0;
        const currency = Number(item.currency) || 23;

        sendSse("progress", {index: i, total: items.length, assetId, status: "selling"});

        try {
          const result = await sellItem({
            cookieString: webSession.cookieString,
            sessionid: webSession.sessionid,
            steamId64: webSession.steamId64,
            assetId,
            priceInCents,
            currency
          });
          if (result.success) successCount++; else failCount++;
          sendSse("item-result", {index: i, assetId, ...result});
        } catch (err) {
          failCount++;
          sendSse("item-result", {index: i, assetId, success: false, message: asString(err.message || err).slice(0, 200)});
        }

        // Rate limit: 2s between sells
        if (i < items.length - 1) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      sendSse("done", {successCount, failCount, total: items.length});
      res.end();
    } catch (err) {
      if (!res.headersSent) {
        writeJson(res, 500, {ok: false, message: asString(err && err.message ? err.message : err).trim()});
      } else {
        try { res.end(); } catch (_) {}
      }
    }
    return true;
  }

  // ── 获取市场确认列表 ──────────────────────────────────────
  if (pathname === "/api/market/confirmations" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) return true;
    try {
      const body = await readJsonBody(req);
      const username = asString(body.username || "").trim();
      if (!username) {
        writeJson(res, 400, {ok: false, message: "缺少 username"});
        return true;
      }

      const accountStore = getViewerAccountStore(auth, deps);
      const account = getAccountCredentials(accountStore, username);
      if (!account) { writeJson(res, 404, {ok: false, message: "账号不存在"}); return true; }

      const confirmations = await runAccountWebOperation(account, {tokenRecoveryService}, async ({webSession, hasMaFile, maData}) => {
        if (!hasMaFile || !maData || !maData.identitySecret) {
          const error = new Error("该账号无 maFile 或缺少 identity_secret，无法获取确认列表");
          error.status = 400;
          throw error;
        }
        return getMarketConfirmations({
          cookieString: webSession.cookieString,
          identitySecret: maData.identitySecret
        });
      });
      writeJson(res, 200, {ok: true, confirmations});
    } catch (err) {
      writeJson(res, Math.max(400, Number(err && err.status) || 500), {
        ok: false,
        message: asString(err && err.message ? err.message : err).trim()
      });
    }
    return true;
  }

  // ── 批量确认市场上架 ──────────────────────────────────────
  if (pathname === "/api/market/confirm-listings" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) return true;
    try {
      const body = await readJsonBody(req);
      const username = asString(body.username || "").trim();
      const confirmationIds = Array.isArray(body.confirmationIds) ? body.confirmationIds : [];
      if (!username || confirmationIds.length === 0) {
        writeJson(res, 400, {ok: false, message: "缺少 username 或 confirmationIds"});
        return true;
      }

      const accountStore = getViewerAccountStore(auth, deps);
      const account = getAccountCredentials(accountStore, username);
      if (!account) { writeJson(res, 404, {ok: false, message: "账号不存在"}); return true; }

      const {results} = await runAccountWebOperation(account, {tokenRecoveryService}, async ({webSession, hasMaFile, maData}) => {
        if (!hasMaFile || !maData || !maData.identitySecret) {
          const error = new Error("该账号无 maFile 或缺少 identity_secret，无法确认上架");
          error.status = 400;
          throw error;
        }
        return confirmMarketListings({
          cookieString: webSession.cookieString,
          identitySecret: maData.identitySecret,
          confirmationIds
        });
      });
      writeJson(res, 200, {ok: true, results});
    } catch (err) {
      writeJson(res, Math.max(400, Number(err && err.status) || 500), {
        ok: false,
        message: asString(err && err.message ? err.message : err).trim()
      });
    }
    return true;
  }

  if (pathname === "/api/market/price" && req.method === "GET") {
    try {
      const qs = new URL(req.url, "http://localhost").searchParams;
      const marketHashName = qs.get("market_hash_name") || "";
      const currency = Number(qs.get("currency")) || 23;
      if (!marketHashName) {
        writeJson(res, 400, {ok: false, message: "缺少 market_hash_name"});
        return true;
      }
      const result = await getPriceOverview({marketHashName, currency});
      writeJson(res, 200, {ok: result.success, ...result});
    } catch (err) {
      writeJson(res, 500, {ok: false, message: asString(err && err.message ? err.message : err).trim()});
    }
    return true;
  }

  if (pathname === "/api/market/batch-price" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const items = Array.isArray(body.items) ? body.items : [];
      const currency = Number(body.currency) || 23;
      if (items.length === 0) {
        writeJson(res, 400, {ok: false, message: "缺少 items"});
        return true;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      const sendSse = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      for (let i = 0; i < items.length; i++) {
        const marketHashName = asString(items[i].marketHashName || "").trim();
        if (!marketHashName) { sendSse("price-result", {index: i, success: false, message: "名称为空"}); continue; }
        try {
          const result = await getPriceOverview({marketHashName, currency});
          sendSse("price-result", {index: i, marketHashName, ...result});
        } catch (err) {
          sendSse("price-result", {index: i, marketHashName, success: false, message: asString(err.message || err).slice(0, 200)});
        }
        if (i < items.length - 1) await new Promise(r => setTimeout(r, 1500));
      }

      sendSse("done", {total: items.length});
      res.end();
    } catch (err) {
      if (!res.headersSent) {
        writeJson(res, 500, {ok: false, message: asString(err && err.message ? err.message : err).trim()});
      } else {
        try { res.end(); } catch (_) {}
      }
    }
    return true;
  }

  if (pathname === "/api/accounts/check-bans" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) return true;
    try {
      const body = await readJsonBody(req);
      const usernames = Array.isArray(body.usernames) ? body.usernames : [];
      if (usernames.length === 0) {
        writeJson(res, 400, {ok: false, message: "缺少 usernames"});
        return true;
      }

      const accountStore = getViewerAccountStore(auth, deps);
      const apiKey = getSteamApiKey();

      // Collect steamId64 -> username mapping
      const id64Map = new Map();
      for (const u of usernames) {
        const acc = accountStore.get(u);
        const steamId64 = asString(acc && (acc.steam_id64 || acc.steam_id) || "").trim();
        if (steamId64) id64Map.set(steamId64, u);
      }

      if (id64Map.size === 0) {
        writeJson(res, 400, {ok: false, message: "没有可检测的账号（缺少 steamId64）"});
        return true;
      }

      if (apiKey) {
        // Batch mode — fast, single JSON response
        const banMap = await checkBansBatch([...id64Map.keys()], apiKey);
        const results = [];
        for (const [sid, username] of id64Map) {
          const banInfo = banMap.get(sid) || null;
          const status = banInfo ? formatBanStatus(banInfo) : "未知";
          // Persist
          try {
            const store = new AppAuthStore(auth && auth.store ? auth.store.dbPath : PATHS.SKIN_DB_FILE);
            store.updateSteamAccountBanStatus(username, status);
            store.close();
          } catch (_) {}
          results.push({username, steamId64: sid, banStatus: status, banInfo});
        }
        writeJson(res, 200, {ok: true, results});
      } else {
        // SSE mode — one by one, no API key
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        });
        const sendSse = (event, data) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        let idx = 0;
        for (const [sid, username] of id64Map) {
          sendSse("progress", {index: idx, total: id64Map.size, username});
          try {
            const acc = getAccountCredentials(accountStore, username);
            const banInfo = await runAccountWebOperation(acc, {tokenRecoveryService}, ({webSession}) => (
              checkBanSingle({cookieString: webSession.cookieString, steamId64: sid})
            ));
            const status = formatBanStatus(banInfo);
            try {
              const store = new AppAuthStore(auth && auth.store ? auth.store.dbPath : PATHS.SKIN_DB_FILE);
              store.updateSteamAccountBanStatus(username, status);
              store.close();
            } catch (_) {}
            sendSse("ban-result", {index: idx, username, steamId64: sid, banStatus: status, banInfo});
          } catch (err) {
            sendSse("ban-result", {index: idx, username, steamId64: sid, banStatus: "检测失败", error: asString(err.message || err).slice(0, 200)});
          }
          idx++;
          if (idx < id64Map.size) await new Promise(r => setTimeout(r, 1000));
        }
        sendSse("done", {total: id64Map.size});
        res.end();
      }
    } catch (err) {
      if (!res.headersSent) {
        writeJson(res, 500, {ok: false, message: asString(err && err.message ? err.message : err).trim()});
      } else {
        try { res.end(); } catch (_) {}
      }
    }
    return true;
  }

  if (pathname === "/api/accounts/fetch-balance" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) return true;
    try {
      const body = await readJsonBody(req);
      const usernames = Array.isArray(body.usernames) ? body.usernames : [];
      if (usernames.length === 0) {
        writeJson(res, 400, {ok: false, message: "缺少 usernames"});
        return true;
      }

      const accountStore = getViewerAccountStore(auth, deps);
      const results = [];

      for (const u of usernames) {
        const acc = getAccountCredentials(accountStore, u);
        if (!acc) { results.push({username: u, success: false, message: "账号不存在"}); continue; }
        try {
          const balResult = await runAccountWebOperation(acc, {tokenRecoveryService}, ({webSession}) => (
            fetchBalance({
              cookieString: webSession.cookieString,
              accessToken: webSession.accessToken,
              steamId64: webSession.steamId64
            })
          ));
          if (balResult.success) {
            const observedAt = new Date().toISOString();
            const result = {
              username: u,
              success: true,
              balance: balResult.balance
            };
            if (Object.prototype.hasOwnProperty.call(balResult, "currency")) {
              result.currency = balResult.currency;
            }
            try {
              const store = new AppAuthStore(auth && auth.store ? auth.store.dbPath : PATHS.SKIN_DB_FILE);
              try {
                store.updateSteamWalletBalance(u, {
                  balance: balResult.balance,
                  currency: balResult.currency || "",
                  source: "steam_store",
                  observedAt
                });
                result.source = "steam_store";
                result.observed_at = observedAt;
                result.persisted = true;
              } finally {
                store.close();
              }
            } catch (persistErr) {
              result.persisted = false;
              result.persist_error = asString(persistErr && persistErr.message ? persistErr.message : persistErr).slice(0, 200);
            }
            results.push(result);
            continue;
          }
          const failureResult = {
            username: u,
            success: false,
            balance: Object.prototype.hasOwnProperty.call(balResult, "balance") ? balResult.balance : null
          };
          if (Object.prototype.hasOwnProperty.call(balResult, "currency")) {
            failureResult.currency = balResult.currency;
          }
          if (Object.prototype.hasOwnProperty.call(balResult, "message")) {
            failureResult.message = asString(balResult.message).slice(0, 200);
          }
          results.push(failureResult);
        } catch (err) {
          results.push({username: u, success: false, message: asString(err.message || err).slice(0, 200)});
        }
      }

      writeJson(res, 200, {ok: true, results});
    } catch (err) {
      writeJson(res, 500, {ok: false, message: asString(err && err.message ? err.message : err).trim()});
    }
    return true;
  }

  if (pathname === "/api/accounts/refresh-trade-url" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) return true;
    try {
      const body = await readJsonBody(req);
      const usernames = Array.isArray(body.usernames) ? body.usernames : [];
      if (usernames.length === 0) {
        writeJson(res, 400, {ok: false, message: "缺少 usernames"});
        return true;
      }

      const accountStore = getViewerAccountStore(auth, deps);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      const sendSse = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      let successCount = 0;
      for (let i = 0; i < usernames.length; i++) {
        const u = usernames[i];
        sendSse("progress", {index: i, total: usernames.length, username: u});
        try {
          const acc = getAccountCredentials(accountStore, u);
          if (!acc) { sendSse("url-result", {index: i, username: u, success: false, message: "账号不存在"}); continue; }
          const result = await runAccountWebOperation(acc, {tokenRecoveryService}, ({webSession}) => (
            fetchTradeUrl({cookieString: webSession.cookieString, steamId64: webSession.steamId64})
          ));
          if (result.success) {
            successCount++;
            try {
              const store = new AppAuthStore(auth && auth.store ? auth.store.dbPath : PATHS.SKIN_DB_FILE);
              store.updateSteamAccountTradeUrl(u, result.tradeUrl);
              store.close();
            } catch (_) {}
          }
          sendSse("url-result", {index: i, username: u, ...result});
        } catch (err) {
          sendSse("url-result", {index: i, username: u, success: false, message: asString(err.message || err).slice(0, 200)});
        }
        if (i < usernames.length - 1) await new Promise(r => setTimeout(r, 800));
      }

      sendSse("done", {successCount, total: usernames.length});
      res.end();
    } catch (err) {
      if (!res.headersSent) {
        writeJson(res, 500, {ok: false, message: asString(err && err.message ? err.message : err).trim()});
      } else {
        try { res.end(); } catch (_) {}
      }
    }
    return true;
  }

  if (pathname === "/api/settings/steam-api-key" && req.method === "GET") {
    if (!requirePermission(res, auth, "accounts.write")) return true;
    const key = getSteamApiKey();
    writeJson(res, 200, {ok: true, hasKey: !!key, maskedKey: key ? key.slice(0, 4) + "..." : ""});
    return true;
  }

  if (pathname === "/api/settings/steam-api-key" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) return true;
    try {
      const body = await readJsonBody(req);
      const key = asString(body.key || "").trim();
      setSteamApiKey(key);
      writeJson(res, 200, {ok: true, message: key ? "已保存" : "已清除"});
    } catch (err) {
      writeJson(res, 500, {ok: false, message: asString(err && err.message ? err.message : err).trim()});
    }
    return true;
  }

  // Steam Guard token management intentionally exposes only task-specific fields.
  if (pathname === "/api/accounts/steam-guard/recover-login" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) return true;
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    if (!requireSteamAccountAccess(res, auth, username)) return true;
    const accountStore = getViewerAccountStore(auth, deps);
    const account = getAccountCredentials(accountStore, username);
    if (!account) {
      writeJson(res, 404, {ok: false, reason: "account_not_found", message: "账号不存在"});
      return true;
    }
    if (!asString(account.mafile_content).trim()) {
      writeJson(res, 409, {ok: false, reason: "guard_missing", message: "该账号尚未添加令牌"});
      return true;
    }
    const uiState = getUiStateStore(deps, viewerUsername);
    const persisted = uiState && typeof uiState.getAccount === "function" ? uiState.getAccount(username) : null;
    if (asString(persisted && persisted.auth_state).trim() !== "auth_invalid") {
      writeJson(res, 200, {ok: true, username, reconnected: false, skipped_reason: "account_not_expired"});
      return true;
    }
    try {
      await tokenRecoveryService.recoverToken(username, {manualReason: "login_key_invalid"});
      if (uiState && typeof uiState.clearAccountAuthState === "function") {
        uiState.clearAccountAuthState(username);
      }
      writeJson(res, 200, {ok: true, username, reconnected: true, has_refresh_token: true});
    } catch (err) {
      const reason = asString(err && (err.reason || err.code)).trim() || "token_recovery_failed";
      const credentialState = asString(err && err.credential_state).trim();
      const authState = asString(err && err.auth_state).trim() || "needs_attention";
      if (credentialState === "password_reentry_required") {
        if (!err.password_cleared) {
          try {
            const clearResult = accountStore.clearPassword(username);
            if (clearResult === false) throw new Error("password clear rejected");
          } catch (_) {
            writeJson(res, 500, {
              ok: false,
              reason: "password_clear_failed",
              message: "已保存密码清除失败，请稍后重试",
              auth_state: "needs_attention"
            });
            return true;
          }
        }
        writeJson(res, 409, {
          ok: false,
          reason,
          message: "保存的 Steam 密码已失效，请重新输入密码",
          auth_state: authState,
          credential_state: credentialState,
          password_cleared: true
        });
        return true;
      }
      writeJson(res, Math.max(400, Number(err && err.status) || 409), {
        ok: false,
        reason,
        message: asString(err && err.message).trim() || "本地令牌自动重新登录失败",
        auth_state: authState
      });
    }
    return true;
  }

  if (pathname === "/api/accounts/steam-guard/coexist/start" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) return true;
    const body = await readJsonBody(req);
    const mode = asString(body.mode).trim().toLowerCase();
    const username = asString(body.username).trim();
    const accountStore = getViewerAccountStore(auth, deps);
    let credentials = null;
    if (mode === "existing") {
      if (!requireSteamAccountAccess(res, auth, username)) return true;
      credentials = getAccountCredentials(accountStore, username);
      if (!credentials) {
        writeJson(res, 404, {ok: false, reason: "account_not_found", message: "账号不存在"});
        return true;
      }
    } else if (mode === "new") {
      if (!username || !asString(body.password).trim()) {
        writeJson(res, 400, {
          ok: false,
          reason: username ? "password_required" : "username_required",
          message: username ? "password is required" : "username is required"
        });
        return true;
      }
      if (getAccountCredentials(accountStore, username)) {
        writeJson(res, 409, {
          ok: false,
          reason: "local_account_exists",
          message: steamGuardCoexistMessage("local_account_exists")
        });
        return true;
      }
    } else {
      writeJson(res, 400, {ok: false, reason: "invalid_mode", message: "mode is invalid"});
      return true;
    }
    const result = await deps.steamGuardCoexistService.start({
      mode,
      username,
      password: mode === "existing" ? credentials.password : asString(body.password),
      remark: mode === "existing" ? credentials.remark : asString(body.remark),
      accountId: accountViewerUsername
    });
    writeJson(res, steamGuardCoexistStatus(result), buildSteamGuardCoexistResponse(result));
    return true;
  }

  if (pathname === "/api/accounts/steam-guard/coexist/submit-email-code" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) return true;
    const body = await readJsonBody(req);
    if (!isValidAccountGuardCode(body.code)) {
      writeJson(res, 400, {
        ok: false,
        reason: "invalid_code_format",
        message: steamGuardCoexistMessage("invalid_code_format")
      });
      return true;
    }
    const result = await deps.steamGuardCoexistService.submitEmailCode({
      flowId: asString(body.flow_id).trim(),
      code: asString(body.code).trim(),
      accountId: accountViewerUsername
    });
    writeJson(res, steamGuardCoexistStatus(result), buildSteamGuardCoexistResponse(result));
    return true;
  }

  if (pathname === "/api/accounts/steam-guard/coexist/verify-app-code" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) return true;
    const body = await readJsonBody(req);
    if (!isValidAccountGuardCode(body.code)) {
      writeJson(res, 400, {
        ok: false,
        reason: "invalid_code_format",
        message: steamGuardCoexistMessage("invalid_code_format")
      });
      return true;
    }
    const result = await deps.steamGuardCoexistService.verifyAppCode({
      flowId: asString(body.flow_id).trim(),
      code: asString(body.code).trim(),
      accountId: accountViewerUsername
    });
    writeJson(res, steamGuardCoexistStatus(result), buildSteamGuardCoexistResponse(result));
    return true;
  }

  if (pathname === "/api/accounts/steam-guard/coexist/cancel" && req.method === "POST") {
    if (!requirePermission(res, auth, "accounts.write")) return true;
    const body = await readJsonBody(req);
    const result = deps.steamGuardCoexistService.cancel(asString(body.flow_id).trim(), {
      accountId: accountViewerUsername
    });
    writeJson(res, result.ok ? 200 : 410, buildSteamGuardCoexistResponse(result));
    return true;
  }

  if (pathname === "/api/accounts/steam-guard" && req.method === "DELETE") {
    if (!requirePermission(res, auth, "accounts.write")) return true;
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    if (!requireSteamAccountAccess(res, auth, username)) return true;
    const accountStore = getViewerAccountStore(auth, deps);
    const account = getAccountCredentials(accountStore, username);
    if (!account) {
      writeJson(res, 404, {ok: false, reason: "account_not_found", message: "账号不存在"});
      return true;
    }
    if (!asString(account.mafile_content).trim()) {
      writeJson(res, 409, {ok: false, reason: "guard_missing", message: "该账号尚未添加令牌"});
      return true;
    }
    try {
      accountStore.clearSteamGuard(username);
      writeJson(res, 200, {ok: true, username, has_steam_guard: false});
    } catch (_) {
      writeJson(res, 500, {ok: false, reason: "guard_delete_failed", message: "删除本地令牌文件失败"});
    }
    return true;
  }

  if (
    [
      "/api/accounts/steam-guard/code",
      "/api/accounts/steam-guard/recovery-code",
      "/api/accounts/steam-guard/export"
    ].includes(pathname)
    && req.method === "GET"
  ) {
    if (!requirePermission(res, auth, "accounts.write")) return true;
    const username = asString(urlObj.searchParams.get("username") || "").trim();
    if (!requireSteamAccountAccess(res, auth, username)) return true;
    try {
      const accountStore = getViewerAccountStore(auth, deps);
      const account = getAccountCredentials(accountStore, username);
      if (!account || !account.mafile_content) {
        writeJson(res, 409, {ok: false, reason: "guard_missing", message: "该账号尚未添加令牌"});
        return true;
      }
      const summary = readSteamGuardSummary(account.mafile_content);
      if (pathname === "/api/accounts/steam-guard/code") {
        writeJson(res, 200, {
          ok: true,
          current_code: summary.currentTotp,
          period: summary.period,
          remaining_seconds: summary.remainingSeconds
        });
        return true;
      }
      if (pathname === "/api/accounts/steam-guard/recovery-code") {
        writeJson(res, 200, {ok: true, recovery_code: summary.revocationCode});
        return true;
      }
      const exported = normalizeMaFileForExport(account.mafile_content);
      writeJson(res, 200, exported, {
        "Content-Disposition": `attachment; filename="${encodeURIComponent(username)}.maFile"`,
        "Cache-Control": "no-store"
      });
    } catch (err) {
      writeJson(res, 500, {ok: false, reason: "guard_operation_failed", message: "令牌操作失败"});
    }
    return true;
  }

    return false;
  } finally {
    try {
      if (auth && auth.store && typeof auth.store.close === "function") {
        auth.store.close();
      }
    } catch (_) {
      // ignore auth store close errors
    }
  }
}

function createServer(options = {}) {
  ensureRuntimeBootstrapped();
  const serverRefreshRuntime = createServerRefreshRuntime(options);
  const steamGuardCoexistService = createServerSteamGuardCoexistService(options);
  if (serverRefreshRuntime && serverRefreshRuntime !== defaultRefreshRuntime && typeof serverRefreshRuntime.start === "function") {
    serverRefreshRuntime.start();
  }
  const apiDeps = {
    accountStoreFactory: options.accountStoreFactory,
    authStoreFactory: options.authStoreFactory,
    craftOutcomePredictor: options.craftOutcomePredictor,
    controlPlaneAuthClientFactory: options.controlPlaneAuthClientFactory,
    licenseConfigFactory: options.licenseConfigFactory,
    licenseRuntimeFactory: options.licenseRuntimeFactory,
    loginAndSaveTokenFn: options.loginAndSaveTokenFn,
    startLoginSessionFn: options.startLoginSessionFn,
    submitGuardCodeFn: options.submitGuardCodeFn,
    tokenStoreFactory: options.tokenStoreFactory,
    tokenRecoveryService: options.tokenRecoveryService || defaultTokenRecoveryService,
    steamGuardCoexistService,
    refreshRuntime: serverRefreshRuntime,
    resolveAccountProfileFn: options.resolveAccountProfileFn,
    steamNetworkPrecheck: options.steamNetworkPrecheck,
    tradeupSimulationCatalog: options.tradeupSimulationCatalog,
    tradeupSimulationService: options.tradeupSimulationService,
    uiStateStoreFactory: options.uiStateStoreFactory
  };
  const server = http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url, "http://127.0.0.1");
      if (urlObj.pathname.startsWith("/api/")) {
        const apiRequestError = validateLocalApiRequest(req);
        if (apiRequestError) {
          writeJson(res, apiRequestError.status, {
            ok: false,
            reason: apiRequestError.reason,
            message: apiRequestError.message
          });
          return;
        }
        const hit = await handleApi(req, res, urlObj, apiDeps);
        if (!hit) {
          writeJson(res, 404, {ok: false, message: "not found"});
        }
        return;
      }

      const filePath = safeUiPath(urlObj.pathname);
      if (!filePath || !fs.existsSync(filePath)) {
        res.writeHead(404, {"Content-Type": "text/plain; charset=utf-8"});
        res.end("404");
        return;
      }
      const buf = fs.readFileSync(filePath);
      res.writeHead(200, {"Content-Type": guessContentType(filePath)});
      res.end(buf);
    } catch (err) {
      if (err && err.code === "request_body_too_large") {
        writeJson(res, 413, {ok: false, reason: "request_body_too_large", message: "JSON 请求体不能超过 64KiB"});
        return;
      }
      if (err && err.code === "invalid_json") {
        writeJson(res, 400, {ok: false, reason: "invalid_json", message: "JSON 请求体格式不正确"});
        return;
      }
      writeJson(res, 500, {ok: false, message: asString(err && err.message ? err.message : err)});
    }
  });
  server.once("close", () => {
    try {
      const runtime = getLicenseRuntime(apiDeps);
      if (runtime && typeof runtime.stop === "function") {
        runtime.stop();
      }
    } catch (_) {
      // ignore license runtime shutdown errors
    }
    try {
      if (steamGuardCoexistService && typeof steamGuardCoexistService.shutdown === "function") {
        steamGuardCoexistService.shutdown();
      }
    } catch (_) {
      // ignore coexist worker shutdown errors
    }
    sessionPool.shutdown();
    void closeCraftAssistWorkerPool();
  });
  return server;
}

function parsePort(argv) {
  const idx = argv.indexOf("--port");
  if (idx >= 0 && idx + 1 < argv.length) {
    return Math.max(1, toInt(argv[idx + 1], 8787));
  }
  return 8787;
}

function start() {
  logEncodingEnvironment();
  const port = parsePort(process.argv);
  const server = createServer();
  server.listen(port, "127.0.0.1", () => {
    logger.info("ui_server", `listening on http://127.0.0.1:${port}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = {
  start,
  createServer
};





