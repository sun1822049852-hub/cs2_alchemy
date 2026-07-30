const {AccountStore} = require("./accountStore");
const {TokenStore} = require("./tokenStore");
const {SchemaStore} = require("./schemaStore");
const {CS2Session} = require("./cs2Session");
const {parseInventory} = require("./inventoryParser");
const {preloadComponentContents} = require("./componentLoader");
const {saveProcessedSnapshot, saveRawSnapshot} = require("./snapshotStore");
const {appendSteamAuthDiagnostic} = require("./steamAuthDiagnosticLog");
const {asString} = require("./utils");

function rawItemKey(item) {
  return asString(
    item && (item.id || item.itemid || item.assetid || item.original_id || "")
  ).trim();
}

function mergeRawItem(baseItem, patchItem) {
  const base = baseItem && typeof baseItem === "object" ? baseItem : {};
  const patch = patchItem && typeof patchItem === "object" ? patchItem : {};
  const merged = {...base, ...patch};
  const patchCasketId = asString(patch.casket_id || "").trim();
  if (patchCasketId) {
    merged.casket_id = patchCasketId;
  }
  return merged;
}

function createRefreshAuthError(code, message, {
  status = 409,
  authState = "login_required",
  cause = null,
  credentialState = "",
  passwordCleared = false
} = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.reason = code;
  err.auth_state = authState;
  if (credentialState) err.credential_state = credentialState;
  if (passwordCleared) err.password_cleared = true;
  if (cause) {
    err.cause = cause;
    const rawCode = asString(cause && (cause.code || cause.eresult || cause.result || "")).trim();
    if (rawCode) {
      err.raw_code = rawCode;
    }
    const rawMessage = asString(cause && cause.message ? cause.message : cause).trim();
    if (rawMessage) {
      err.raw_message = rawMessage;
    }
  }
  return err;
}

function isLoginKeyInvalidError(err) {
  const errorStage = asString(err && err.stage || "").trim();
  const errorReason = asString(err && (err.reason || err.code) || "").trim();
  if (errorStage === "steam_app_license" || errorReason.startsWith("cs2_license_")) {
    return false;
  }
  const message = asString(err && err.message ? err.message : err).trim().toLowerCase();
  const rawCode = asString(err && (err.code || err.eresult || err.result || "")).trim().toLowerCase();
  const numericCode = Number(rawCode);
  if (!message && !rawCode) {
    return false;
  }
  if (["invalidpassword", "login_key_invalid", "refresh_token_invalid", "refresh_token_rejected", "refresh_token_expired"].includes(rawCode)) {
    return true;
  }
  if (Number.isFinite(numericCode) && [5, 15].includes(numericCode)) {
    return true;
  }
  if (/(?:^|[\s,;])(?:eresult|result|code)\s*[=:]\s*15\b/i.test(message)) {
    return true;
  }
  return [
    "invalidpassword",
    "invalid password",
    "login key invalid",
    "refresh token rejected",
    "token rejected",
    "token expired"
  ].some((part) => message.includes(part));
}

async function clearRejectedRefreshToken(tokenStore, accountName) {
  try {
    if (typeof tokenStore.remove !== "function") {
      throw new Error("TokenStore cannot remove the stale token");
    }
    const removeResult = await tokenStore.remove(accountName);
    if (removeResult === false || asString(await tokenStore.get(accountName)).trim()) {
      throw new Error("TokenStore rejected the removal");
    }
  } catch (err) {
    throw createRefreshAuthError("token_store_clear_failed", "过期 refresh token 清理失败", {
      status: 500,
      authState: "needs_attention",
      cause: err
    });
  }
}

async function refreshInventory({
  username,
  password,
  includeHidden = true,
  dumpRaw = false,
  logger,
  onConnectionReady = null,
  onConnectionProgress = null,
  sessionPool = null,
  accountStore = null,
  tokenStore = null,
  schemaStore = null,
  SessionClass = CS2Session,
  parseInventoryFn = parseInventory,
  preloadComponentContentsFn = preloadComponentContents,
  saveProcessedSnapshotFn = saveProcessedSnapshot,
  saveRawSnapshotFn = saveRawSnapshot,
  authDiagnosticWriter = appendSteamAuthDiagnostic
}) {
  const accounts = accountStore || new AccountStore();
  const active = username
    ? (typeof accounts.getCredentials === "function" ? accounts.getCredentials(username) : accounts.get(username))
    : (typeof accounts.getActiveCredentials === "function" ? accounts.getActiveCredentials() : accounts.getActive());
  if (!active) {
    throw new Error(`account not found: ${username || "(active)"}`);
  }
  const accountName = active.username;
  const accountPassword = asString(password || active.password || "").trim();
  const hasLocalSteamGuard = !!asString(active.mafile_content || "").trim();
  const tokens = tokenStore || new TokenStore();
  const refreshToken = tokens.get(accountName);
  const poolCanRecover = !!(
    hasLocalSteamGuard
    &&
    sessionPool
    && typeof sessionPool.hasTokenRecovery === "function"
    && sessionPool.hasTokenRecovery()
  );
  const createLoginKeyInvalidError = async (error) => {
    let tokenCleared = false;
    if (!hasLocalSteamGuard) {
      await clearRejectedRefreshToken(tokens, accountName);
      tokenCleared = true;
    }
    try {
      await authDiagnosticWriter({
        stage: "refresh_connect",
        username: accountName,
        reason: "login_key_invalid",
        authState: "auth_invalid",
        error,
        hasSteamGuard: hasLocalSteamGuard,
        tokenCleared,
        recoveryMode: !hasLocalSteamGuard || asString(error && error.credential_state).trim() === "password_reentry_required"
          ? "manual_login"
          : "guard_auto_failed"
      });
    } catch (diagnosticError) {
      if (logger && typeof logger.warn === "function") {
        const errorCode = asString(diagnosticError && diagnosticError.code).trim() || "unknown";
        logger.warn("steam_auth", `diagnostic log write failed: code=${errorCode}`);
      }
    }
    return createRefreshAuthError("login_key_invalid", `login key invalid: ${accountName}`, {
      authState: "auth_invalid",
      cause: error,
      credentialState: asString(error && error.credential_state).trim(),
      passwordCleared: error && error.password_cleared === true
    });
  };
  if (!refreshToken && !poolCanRecover) {
    throw createRefreshAuthError("login_key_missing", `login key missing: ${accountName}`);
  }
  const schemas = schemaStore || new SchemaStore();
  const schema = schemas.load();

  const session = sessionPool ? null : new SessionClass({logger, tokenStore: tokens});
  const usingSessionPool = Boolean(sessionPool);
  let pooledReused = false;
  let connected = false;
  try {
    if (logger) {
      logger.info("workflow", `refresh start: account=${accountName}`);
    }
    let csgo = null;
    if (usingSessionPool) {
      let acquired;
      try {
        acquired = await sessionPool.acquire({
          username: accountName,
          password: accountPassword,
          refreshToken,
          tokenStore: tokens,
          refreshTokenOnly: true,
          allowTokenRecovery: poolCanRecover,
          onLicenseStatus: onConnectionProgress
        });
      } catch (err) {
        if (isLoginKeyInvalidError(err)) {
          throw await createLoginKeyInvalidError(err);
        }
        throw err;
      }
      csgo = acquired.csgo;
      pooledReused = Boolean(acquired.reused);
      if (logger) {
        logger.info("workflow", `session mode=pool reused=${acquired.reused ? "true" : "false"}`);
      }
    } else {
      let connectedSession;
      try {
        connectedSession = await session.connect({
          username: accountName,
          password: accountPassword,
          refreshToken,
          refreshTokenOnly: true,
          onLicenseStatus: onConnectionProgress
        });
      } catch (err) {
        if (isLoginKeyInvalidError(err)) {
          throw await createLoginKeyInvalidError(err);
        }
        throw err;
      }
      csgo = connectedSession.csgo;
      if (logger) {
        logger.info("workflow", "session mode=ephemeral");
      }
    }
    connected = true;
    if (typeof onConnectionReady === "function") {
      await onConnectionReady({
        username: accountName,
        connected: true
      });
    }

    if (logger) {
      logger.info("workflow", "phase=base-inventory");
    }
    const baseRaw = Array.isArray(csgo.inventory) ? [...csgo.inventory] : [];

    if (logger) {
      logger.info("workflow", "phase=component-preload");
    }
    const componentStats = await preloadComponentContentsFn(csgo, logger, {requestIntervalMs: 80});
    if (
      usingSessionPool &&
      pooledReused &&
      componentStats.waiting > 0 &&
      componentStats.loaded_total === 0 &&
      sessionPool
    ) {
      if (logger) {
        logger.warn("workflow", "component preload empty on reused session, invalidate pooled session");
      }
      sessionPool.invalidate(accountName, "component_preload_empty");
    }

    if (logger) {
      logger.info("workflow", "phase=final-inventory");
    }
    const finalRaw = Array.isArray(csgo.inventory) ? [...csgo.inventory] : [];
    const mergedById = new Map();
    for (const item of finalRaw) {
      const key = rawItemKey(item);
      if (!key) continue;
      mergedById.set(key, item);
    }
    for (const item of componentStats.loaded_items || []) {
      const key = rawItemKey(item);
      if (!key) {
        continue;
      }
      const existing = mergedById.get(key);
      if (!existing) {
        mergedById.set(key, item);
        continue;
      }
      mergedById.set(key, mergeRawItem(existing, item));
    }
    const mergedRaw = Array.from(mergedById.values());
    // 快照始终保存全量（含隐藏），UI 再根据开关本地过滤，避免组件条目丢失。
    const parsed = parseInventoryFn(mergedRaw, schema, {includeHidden: true});
    const rows = parsed.rows;
    const snapshotPath = saveProcessedSnapshotFn(rows);
    let rawPath = "";
    if (dumpRaw) {
      rawPath = saveRawSnapshotFn(finalRaw);
    }

    const componentExpected = componentStats.expected_total;
    const componentLoaded = mergedRaw.filter((x) => asString(x.casket_id || "").trim()).length;

    const result = {
      account: accountName,
      snapshot_path: snapshotPath,
      raw_snapshot_path: rawPath,
      rows: rows.length,
      hidden_rows: parsed.hiddenRows.length,
      component_stats: {
        components: componentStats.waiting,
        loaded_items: componentLoaded,
        expected_items: componentExpected,
        notifications: componentStats.notified
      }
    };
    if (logger) {
      const componentRows = rows.filter((x) => Number(x.def_index || 0) === 1201);
      const componentIds = componentRows.map((x) => asString(x.asset_id || "").trim()).filter(Boolean);
      const itemInComponent = rows.filter((x) => asString(x.casket_id || "").trim());
      const loadedByComponent = new Map();
      for (const row of itemInComponent) {
        const cid = asString(row.casket_id || "").trim();
        if (!cid) continue;
        loadedByComponent.set(cid, (loadedByComponent.get(cid) || 0) + 1);
      }
      const breakdown = componentIds.map((cid) => {
        const comp = componentRows.find((x) => asString(x.asset_id || "").trim() === cid);
        const expected = Number(comp && comp.casket_contained_item_count != null ? comp.casket_contained_item_count : 0) || 0;
        const loaded = loadedByComponent.get(cid) || 0;
        return `${cid}:${loaded}/${expected}`;
      }).join(" | ");
      logger.info("workflow", `component snapshot check: components=${componentIds.length} loaded_items=${itemInComponent.length}${breakdown ? ` | ${breakdown}` : ""}`);
    }
    if (logger) {
      logger.info(
        "workflow",
        `refresh done: rows=${result.rows} components=${result.component_stats.components} loaded=${result.component_stats.loaded_items} expected=${result.component_stats.expected_items}`
      );
      logger.info("workflow", `snapshot=${snapshotPath}`);
    }
    if (usingSessionPool) {
      sessionPool.touch(accountName);
    }
    return result;
  } catch (err) {
    if (usingSessionPool && sessionPool) {
      sessionPool.invalidate(accountName, "refresh_failed");
    }
    throw err;
  } finally {
    if (!usingSessionPool && connected && logger) {
      logger.info("workflow", "disconnecting session");
    }
    if (!usingSessionPool && session) {
      session.disconnect();
    }
  }
}

module.exports = {
  refreshInventory
};

