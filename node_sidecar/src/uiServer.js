const fs = require("fs");
const path = require("path");
const http = require("http");
const {URL} = require("url");
const {execSync} = require("child_process");
const {AccountStore} = require("./accountStore");
const {AppAuthStore} = require("./appAuthStore");
const {TokenStore} = require("./tokenStore");
const {UiStateStore} = require("./uiStateStore");
const {loginAndSaveToken} = require("./authService");
const {refreshInventory} = require("./refreshWorkflow");
const {createRefreshRuntime} = require("./services/refreshRuntime");
const {createSessionPool} = require("./services/sessionPool");
const {createComponentOpsService} = require("./services/componentOpsService");
const {createComponentTaskQueue} = require("./services/componentTaskQueue");
const {createCraftService} = require("./services/craftService");
const {createCraftTradeupWithComponentsService} = require("./services/craftTradeupWithComponentsService");
const {requestUsesComponentSourceRecipes} = require("./services/craftExecutionGuard");
const {
  createCraftAssistService
} = require("./services/craftAssistService");
const {createCraftAssistWorkerPool} = require("./services/craftAssistWorkerPool");
const {buildCraftCandidateContext} = require("./services/craftCandidateService");
const {normalizeCraftAssistMaterialListCanonical} = require("../ui/craftAssistItemWearShared");
const {createCraftOutcomeCatalog} = require("./services/craftOutcomeCatalog");
const {createCraftOutcomePredictor} = require("./services/craftOutcomePredictor");
const {createTradeupSimulationCatalog} = require("./services/tradeupSimulationCatalog");
const {createTradeupSimulationService} = require("./services/tradeupSimulationService");
const {createSnapshotRowsLoader} = require("./services/snapshotRowsLoader");
const {buildComponentSummary: buildSharedComponentSummary} = require("./services/componentSummary");
const {
  enrichInventoryDisplayOnlyImages
} = require("../../tools/enrichInventoryDisplayOnlyImages");
const {DedupLogger} = require("./logger");
const {hashCraftPermitPayload} = require("../../shared/craftPermitPolicy");
const {getLicenseConfig} = require("./licenseConfig");
const {createControlPlaneAuthClient} = require("./controlPlaneAuthClient");
const {createCraftPermitEnforcer} = require("./craftPermitEnforcer");
const {resolveDeviceId} = require("./deviceIdentity");
const {LicenseStore} = require("./licenseStore");
const {createLicenseEnforcer} = require("./licenseEnforcer");
const {createLicenseScheduler} = require("./licenseScheduler");
const {bootstrapDevLicense} = require("./devLicenseBootstrap");
const {asString, toInt, nowString} = require("./utils");
const {PATHS, STORAGE_UNIT_DEF_INDEX, STORAGE_UNIT_CAPACITY} = require("./constants");

const UI_DIR = path.resolve(__dirname, "..", "ui");
const SESSION_COOKIE_NAME = "cs2_alchemy_session";
const SESSION_TTL_DAYS = 7;
const logger = new DedupLogger({windowMs: 800});
const sessionPool = createSessionPool({logger});
const componentOpsService = createComponentOpsService({sessionPool, logger});
const craftService = createCraftService({sessionPool, logger});
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

function getAuthStore(deps = {}) {
  if (typeof deps.authStoreFactory === "function") {
    return deps.authStoreFactory();
  }
  return new AppAuthStore();
}

function getUiStateStore(deps = {}, viewerUsername = "") {
  if (typeof deps.uiStateStoreFactory === "function") {
    return deps.uiStateStoreFactory({viewerUsername});
  }
  return new UiStateStore(undefined, {viewerUsername});
}

function getViewerAccountStore(auth, deps = {}) {
  const viewerUsername = auth && Object.prototype.hasOwnProperty.call(auth, "accountViewerUsername")
    ? asString(auth.accountViewerUsername).trim()
    : asString(auth && auth.user && auth.user.username ? auth.user.username : "").trim();
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
          source: "remote_refresh"
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

function getCraftPermitEnforcer(deps = {}) {
  if (deps.__craftPermitEnforcer) {
    return deps.__craftPermitEnforcer;
  }
  const config = getClientLicenseConfig(deps);
  deps.__craftPermitEnforcer = createCraftPermitEnforcer({
    publicKeyFile: config.publicKeyFile,
    deviceId: getClientDeviceId(deps)
  });
  return deps.__craftPermitEnforcer;
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
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error(`invalid json body: ${err.message}`));
      }
    });
    req.on("error", reject);
  });
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
    || pathname === "/api/client-auth/register"
    || pathname === "/api/client-auth/password/send-reset-code"
    || pathname === "/api/client-auth/password/reset";
}

function resolveRequestAuth(req, deps = {}) {
  const runtime = getLicenseRuntime(deps);
  const state = runtime && typeof runtime.getState === "function" ? runtime.getState() : null;
  const user = state && state.ok && state.user
    ? {
        username: asString(state.user.username).trim(),
        display_name: asString(state.user.username).trim(),
        is_super_admin: false
      }
    : null;
  return {
    store: {
      dbPath: PATHS.SKIN_DB_FILE,
      accountsFilePath: PATHS.ACCOUNTS_FILE,
      canAccessSteamAccount() {
        return true;
      },
      close() {}
    },
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
  if (auth.user.is_super_admin) {
    return true;
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

function normalizeCraftPermitFailure(result) {
  const code = asString(result && result.code).trim() || "craft_permission_denied";
  const message = asString(result && result.message).trim() || "当前账号未获得炼金执行授权";
  if (code === "permit_expired") {
    return {status: 410, reason: code, message};
  }
  if ([
    "device_mismatch",
    "action_mismatch",
    "account_username_mismatch",
    "payload_hash_mismatch"
  ].includes(code)) {
    return {status: 409, reason: code, message};
  }
  if (["public_key_missing", "invalid_signature", "permit_invalid"].includes(code)) {
    return {status: 502, reason: code, message};
  }
  return {status: 403, reason: code, message};
}

async function requireCraftExecutionPermit(res, auth, deps, action, body = {}) {
  const config = getClientLicenseConfig(deps);
  if (!config.requireRemoteCraftPermit) {
    return true;
  }
  const runtime = auth && auth.licenseRuntime;
  const currentBundle = runtime && typeof runtime.readBundle === "function" ? runtime.readBundle() : null;
  const refreshCredential = asString(currentBundle && currentBundle.refresh_credential).trim();
  if (!refreshCredential) {
    writeJson(res, 503, {
      ok: false,
      reason: "craft_permit_unavailable",
      message: "当前客户端缺少执行授权凭证，请重新登录"
    });
    return false;
  }
  const authClient = getControlPlaneAuthClient(deps);
  if (!authClient || typeof authClient.issueCraftPermit !== "function") {
    writeJson(res, 503, {
      ok: false,
      reason: "craft_auth_unavailable",
      message: "认证服务暂时不可用，暂无法执行炼金"
    });
    return false;
  }
  const accountUsername = asString(body && body.username).trim();
  const deviceId = getClientDeviceId(deps);
  const payloadHash = hashCraftPermitPayload(action, body);
  let permit = null;
  try {
    const response = await authClient.issueCraftPermit({
      refreshCredential,
      deviceId,
      action,
      accountUsername,
      payloadHash
    });
    permit = response && response.permit && typeof response.permit === "object" ? response.permit : null;
  } catch (err) {
    writeJson(res, Math.max(400, Number(err && err.status) || 503), {
      ok: false,
      reason: asString(err && err.code || "craft_auth_unavailable").trim() || "craft_auth_unavailable",
      message: asString(err && err.message || "认证服务暂时不可用，暂无法执行炼金").trim() || "认证服务暂时不可用，暂无法执行炼金"
    });
    return false;
  }
  const evaluation = getCraftPermitEnforcer(deps).evaluatePermit(permit, {
    action,
    accountUsername,
    payloadHash
  });
  if (evaluation.ok) {
    return true;
  }
  const failure = normalizeCraftPermitFailure(evaluation);
  writeJson(res, failure.status, {
    ok: false,
    reason: failure.reason,
    message: failure.message
  });
  return false;
}

function requireSteamAccountAccess(res, auth, username) {
  const key = asString(username).trim();
  if (!key) {
    writeJson(res, 400, {ok: false, message: "username is required"});
    return false;
  }
  if (auth && auth.store && auth.store.canAccessSteamAccount(auth.user && auth.user.username, key)) {
    return true;
  }
  writeJson(res, 403, {ok: false, reason: "account_scope_denied", message: "当前登录用户无权访问该 Steam 账号"});
  return false;
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

function buildCraftAssistSelectRoutePayload(body, {rows = []} = {}) {
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
      targetWear: body && body.target_wear,
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
      wearOffsetPct: body && body.wear_offset_pct,
      enableFastCraftAssist
    },
    candidateRows
  };
}

function normalizeLoginSaveError(err) {
  const raw = asString(err && err.message ? err.message : err).trim();
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

async function resolveAccountProfile({username, password = "", viewerUsername = "", accountStoreOptions = {}} = {}) {
  const accountStore = new AccountStore({
    ...accountStoreOptions,
    viewerUsername
  });
  const account = username ? accountStore.get(username) : accountStore.getActive();
  if (!account) {
    throw new Error(`account not found: ${username || "(active)"}`);
  }
  const accountName = asString(account.username).trim();
  const tokenStore = new TokenStore();
  const refreshToken = tokenStore.get(accountName);
  const accountPassword = asString(password || account.password || "").trim();
  logger.info("ui_server", `profile resolve start: account=${accountName}`);

  const acquired = await sessionPool.acquire({
    username: accountName,
    password: accountPassword,
    refreshToken,
    tokenStore
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
    gc_player_cur_xp: gcPlayerCurXp > 0 ? gcPlayerCurXp : 0
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
  const viewerUsername = asString(auth && auth.user && auth.user.username ? auth.user.username : "").trim();
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
      const password = asString(body && body.password).trim();
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
          writeJson(res, 502, {ok: false, reason: "bundle_missing", message: "远端认证成功但未返回授权包"});
          return true;
        }
        const state = auth.licenseRuntime.importBundle({
          ...result.bundle,
          refresh_credential: asString(result.refreshCredential).trim(),
          source: "remote_login"
        });
        if (!state || !state.ok) {
          writeJson(res, 502, {
            ok: false,
            reason: asString(state && state.code || "license_invalid").trim() || "license_invalid",
            message: asString(state && state.message || "远端授权写入本地失败").trim() || "远端授权写入本地失败"
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
          password: asString(body && body.password).trim()
        });
        writeJson(res, 200, result && typeof result === "object" ? result : {ok: true});
      } catch (err) {
        writeClientAuthError(res, err, "注册失败");
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
          newPassword: asString(body && body.new_password).trim()
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

    if (pathname === "/api/events" && req.method === "GET") {
      const username = asString(urlObj.searchParams.get("username") || "").trim();
      if (username && !requireSteamAccountAccess(res, auth, username)) {
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
      writeJson(res, 200, {
        accounts: store.list(),
        active: store.getActive(),
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
        viewerUsername,
        accountStoreOptions: {
          dbPath: auth.store.dbPath,
          accountsFilePath: auth.store.accountsFilePath
        }
      });
      try {
        const accountStore = getViewerAccountStore(auth, deps);
        const existed = accountStore.get(profile.username);
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
      logger.info(
        "ui_server",
        `account profile: account=${profile.username} steamid=${profile.steam_id64 || "-"} avatar=${profile.avatar_url_full ? "yes" : "no"} source=${profile.avatar_source}`
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

    logger.info("ui_server", `login-save request: account=${username} totp=yes`);
    try {
      const tokenStore = new TokenStore();
      const result = await loginAndSaveToken({
        username,
        password,
        twoFactorCode: totp,
        tokenStore,
        logger
      });

      const accountStore = getViewerAccountStore(auth, deps);
      const existed = accountStore.get(username);
      const finalRemark = asString(body.remark).trim() || (existed ? asString(existed.remark || "").trim() : "");

      accountStore.upsert({
        username,
        password,
        remark: finalRemark,
        steamName: existed ? existed.steam_name : "",
        steamId: existed ? existed.steam_id : "",
        avatarUrl: existed ? existed.avatar_url : ""
      });

      let profile = null;
      try {
        profile = await resolveAccountProfile({
          username,
          password,
          viewerUsername,
          accountStoreOptions: {
            dbPath: auth.store.dbPath,
            accountsFilePath: auth.store.accountsFilePath
          }
        });
      } catch (profileErr) {
        logger.warn(
          "ui_server",
          `profile resolve skipped: account=${username} message=${asString(profileErr && profileErr.message ? profileErr.message : profileErr)}`
        );
      }
      if (profile) {
        const nextSteamName = asString(profile.persona_name || "").trim();
        const nextSteamId = asString(profile.steam_id64 || "").trim();
        const nextAvatarUrl = pickProfileAvatarUrl(profile);
        accountStore.upsert({
          username,
          password,
          remark: finalRemark,
          steamName: nextSteamName || (existed ? existed.steam_name : ""),
          steamId: nextSteamId || (existed ? existed.steam_id : ""),
          avatarUrl: nextAvatarUrl || (existed ? existed.avatar_url : "")
        });
      }

      const uiState = getUiStateStore(deps, viewerUsername);
      uiState.setLastSelected(username);
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
        detail: normalized.raw
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
    const existed = store.get(username);
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
      writeJson(res, 500, {
        ok: false,
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
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    const componentId = asString(body.component_id).trim();
    if (!username || !refreshRuntime.isConnected(username)) {
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
    const username = asString(urlObj.searchParams.get("username") || "").trim();
    const componentId = asString(urlObj.searchParams.get("component_id") || "").trim();
    const includeExcluded = asString(urlObj.searchParams.get("include_excluded") || "").trim() === "1";
    if (!username || !refreshRuntime.isConnected(username)) {
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
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    const componentId = asString(body.component_id).trim();
    if (!username || !refreshRuntime.isConnected(username)) {
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
    const normalizedAssist = buildCraftAssistSelectRoutePayload(body, {
      rows: loaded.rows
    });
    const workerArgs = normalizedAssist.request;
    const workerPool = getCraftAssistWorkerPool();
    const result = workerPool
      ? await workerPool.selectForRecipe({
        snapshotPath: loaded.snapshot_path,
        ...workerArgs
      })
      : await craftAssistService.selectForRecipe({
        rows: loaded.rows,
        candidateRows: normalizedAssist.candidateRows,
        ...workerArgs
      });
    if (!result.ok) {
      writeJson(res, 400, {
        ok: false,
        message: asString(result.message || "").trim() || "辅助选材失败"
      });
      return true;
    }
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
    if (!await requireCraftExecutionPermit(res, auth, deps, "craft.tradeup.with_components.execute", body)) {
      return true;
    }
    try {
      const allowCoolingRaw = body.allow_cooling;
      const allowCoolingText = asString(allowCoolingRaw).trim().toLowerCase();
      const allowCooling = allowCoolingRaw === true || allowCoolingRaw === 1 || allowCoolingText === "1" || allowCoolingText === "true";
      const prepareOnlyRaw = body.prepare_only;
      const prepareOnlyText = asString(prepareOnlyRaw).trim().toLowerCase();
      const prepareOnly = prepareOnlyRaw === true || prepareOnlyRaw === 1 || prepareOnlyText === "1" || prepareOnlyText === "true";
      const recipeCount = Array.isArray(body.recipes) ? body.recipes.length : 0;
      const progressRunId = `craft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const activeRun = registerActiveCraftRun({username, runId: progressRunId});
      logger.info(
        "ui_server",
        `craft-with-components request: account=${username} recipes=${recipeCount} allow_cooling=${allowCooling ? 1 : 0} prepare_only=${prepareOnly ? 1 : 0}`
      );
      try {
        const payload = await craftTradeupWithComponentsService.runTradeUpWithComponents({
          username,
          password: body.password,
          recipes: body.recipes,
          allowCooling,
          prepareOnly,
          shouldPause: activeRun && typeof activeRun.shouldPause === "function" ? () => activeRun.shouldPause() : null,
          onProgress: (progress) => {
            refreshRuntime.emitSse("craft_component_progress", {
              username,
              run_id: progressRunId,
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
        writeJson(res, status, {
          ok: status === 200,
          ...payload,
          component: buildComponentSummary(payload.rows || [])
        });
      } finally {
        releaseActiveCraftRun(username, activeRun);
      }
    } catch (err) {
      if (err && err.craft_payload) {
        const payload = err.craft_payload;
        logger.warn(
          "ui_server",
          `craft-with-components partial: account=${username} completed=${Array.isArray(payload && payload.completed_steps) ? payload.completed_steps.length : 0} msg=${asString(err && err.message ? err.message : err)}`
        );
        writeJson(res, 409, {
          ok: false,
          ...payload,
          component: buildComponentSummary(payload.rows || []),
          message: asString(err && err.message ? err.message : err)
        });
        return true;
      }
      const status = err && err.code === "snapshot_missing"
        ? 409
        : (err && err.code === "bad_request" ? 400 : 500);
      logger.warn("ui_server", `craft-with-components failed: account=${username} status=${status} msg=${asString(err && err.message ? err.message : err)}`);
      writeJson(res, status, {
        ok: false,
        message: asString(err && err.message ? err.message : err)
      });
    }
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
    if (!requestUsesComponentSourceRecipes(body) && !await requireCraftExecutionPermit(res, auth, deps, "craft.tradeup.execute", body)) {
      return true;
    }
    try {
      const allowCoolingRaw = body.allow_cooling;
      const allowCoolingText = asString(allowCoolingRaw).trim().toLowerCase();
      const allowCooling = allowCoolingRaw === true || allowCoolingRaw === 1 || allowCoolingText === "1" || allowCoolingText === "true";
      const hasRecipes = Array.isArray(body.recipes) && body.recipes.length > 0;
      const recipeCount = hasRecipes ? body.recipes.length : (Array.isArray(body.item_ids) && body.item_ids.length ? 1 : 0);
      if (requestUsesComponentSourceRecipes(body)) {
        const message = "检测到组件来源物品，必须走“先取出组件物品再汰换”的执行链，请重新执行";
        logger.warn("ui_server", `craft blocked: account=${username} reason=component_route_required recipes=${recipeCount}`);
        writeJson(res, 409, {
          ok: false,
          reason: "component_route_required",
          message
        });
        return true;
      }
      logger.info("ui_server", `craft request: account=${username} recipes=${recipeCount} allow_cooling=${allowCooling ? 1 : 0}`);
      const payload = hasRecipes
        ? await craftService.runTradeUpBatch({
          username,
          password: body.password,
          recipes: body.recipes,
          allowCooling
        })
        : await craftService.runTradeUp({
          username,
          password: body.password,
          itemIds: body.item_ids,
          allowCooling
        });
      logger.info(
        "ui_server",
        `craft success: account=${username} recipes=${toInt(payload && payload.recipe_count, 0)} steps=${Array.isArray(payload && payload.steps) ? payload.steps.length : 0} gained=${Array.isArray(payload && payload.gained_ids) ? payload.gained_ids.length : 0}`
      );
      writeJson(res, 200, {
        ok: true,
        ...payload,
        component: buildComponentSummary(payload.rows || [])
      });
    } catch (err) {
      if (err && err.craft_payload) {
        const payload = err.craft_payload;
        logger.warn(
          "ui_server",
          `craft partial: account=${username} completed=${Array.isArray(payload && payload.completed_steps) ? payload.completed_steps.length : 0} failed_step=${toInt(payload && payload.failed_step, 0)} msg=${asString(err && err.message ? err.message : err)}`
        );
        writeJson(res, 409, {
          ok: false,
          ...payload,
          component: buildComponentSummary(payload.rows || []),
          message: asString(err && err.message ? err.message : err)
        });
        return true;
      }
      const status = err && err.code === "bad_request" ? 400 : 500;
      logger.warn("ui_server", `craft failed: account=${username} status=${status} msg=${asString(err && err.message ? err.message : err)}`);
      writeJson(res, status, {
        ok: false,
        message: asString(err && err.message ? err.message : err)
      });
    }
    return true;
  }

  if (pathname === "/api/component/tasks" && req.method === "GET") {
    const username = asString(urlObj.searchParams.get("username") || "").trim();
    writeJson(res, 200, {
      ok: true,
      ...componentTaskQueue.getSnapshot(username)
    });
    return true;
  }

  if (pathname === "/api/component/tasks/cancel" && req.method === "POST") {
    const body = await readJsonBody(req);
    const jobId = asString(body.job_id).trim();
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
    if (!accountCache || !accountCache.snapshot_path) {
      writeJson(res, 200, {
        ok: true,
        snapshot: null,
        rows: [],
        component: {summary_map: {}, item_map: {}},
        fetch_time: "",
        connected: refreshRuntime.isConnected(username)
      });
      return true;
    }
    const loaded = loadSnapshotSafe(accountCache.snapshot_path);
    if (!loaded.snapshot) {
      writeJson(res, 200, {
        ok: true,
        snapshot: null,
        rows: [],
        component: {summary_map: {}, item_map: {}},
        fetch_time: asString(accountCache.fetch_time || ""),
        connected: refreshRuntime.isConnected(username)
      });
      return true;
    }
    const component = buildComponentSummary(loaded.rows);
    writeJson(res, 200, {
      ok: true,
      snapshot: loaded.snapshot,
      rows: loaded.rows,
      component,
      fetch_time: asString(accountCache.fetch_time || ""),
      connected: refreshRuntime.isConnected(username)
    });
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
    usernames = usernames.filter((username) => auth.store.canAccessSteamAccount(viewerUsername, username));
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
  const apiDeps = {
    accountStoreFactory: options.accountStoreFactory,
    authStoreFactory: options.authStoreFactory,
    craftOutcomePredictor: options.craftOutcomePredictor,
    controlPlaneAuthClientFactory: options.controlPlaneAuthClientFactory,
    licenseConfigFactory: options.licenseConfigFactory,
    licenseRuntimeFactory: options.licenseRuntimeFactory,
    tradeupSimulationCatalog: options.tradeupSimulationCatalog,
    tradeupSimulationService: options.tradeupSimulationService,
    uiStateStoreFactory: options.uiStateStoreFactory
  };
  const server = http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url, "http://127.0.0.1");
      if (urlObj.pathname.startsWith("/api/")) {
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





