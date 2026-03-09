const {AccountStore} = require("./accountStore");
const {TokenStore} = require("./tokenStore");
const {SchemaStore} = require("./schemaStore");
const {CS2Session} = require("./cs2Session");
const {parseInventory} = require("./inventoryParser");
const {preloadComponentContents} = require("./componentLoader");
const {saveProcessedSnapshot, saveRawSnapshot} = require("./snapshotStore");
const {asString} = require("./utils");

async function refreshInventory({
  username,
  password,
  includeHidden = true,
  dumpRaw = false,
  logger,
  sessionPool = null
}) {
  const accounts = new AccountStore();
  const active = username ? accounts.get(username) : accounts.getActive();
  if (!active) {
    throw new Error(`account not found: ${username || "(active)"}`);
  }
  const accountName = active.username;
  const accountPassword = asString(password || active.password || "").trim();
  const tokenStore = new TokenStore();
  const refreshToken = tokenStore.get(accountName);
  if (!refreshToken && !accountPassword) {
    throw new Error(`password missing: ${accountName}`);
  }
  const schemaStore = new SchemaStore();
  const schema = schemaStore.load();

  const session = sessionPool ? null : new CS2Session({logger, tokenStore});
  const usingSessionPool = Boolean(sessionPool);
  let pooledReused = false;
  let connected = false;
  try {
    if (logger) {
      logger.info("workflow", `refresh start: account=${accountName}`);
    }
    let csgo = null;
    if (usingSessionPool) {
      const acquired = await sessionPool.acquire({
        username: accountName,
        password: accountPassword,
        refreshToken,
        tokenStore
      });
      csgo = acquired.csgo;
      pooledReused = Boolean(acquired.reused);
      if (logger) {
        logger.info("workflow", `session mode=pool reused=${acquired.reused ? "true" : "false"}`);
      }
    } else {
      const connectedSession = await session.connect({
        username: accountName,
        password: accountPassword,
        refreshToken
      });
      csgo = connectedSession.csgo;
      if (logger) {
        logger.info("workflow", "session mode=ephemeral");
      }
    }
    connected = true;

    if (logger) {
      logger.info("workflow", "phase=base-inventory");
    }
    const baseRaw = Array.isArray(csgo.inventory) ? [...csgo.inventory] : [];

    if (logger) {
      logger.info("workflow", "phase=component-preload");
    }
    const componentStats = await preloadComponentContents(csgo, logger, {requestIntervalMs: 80});
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
      mergedById.set(asString(item.id || ""), item);
    }
    for (const item of componentStats.loaded_items || []) {
      const key = asString(item.id || "");
      if (!key || mergedById.has(key)) {
        continue;
      }
      mergedById.set(key, item);
    }
    const mergedRaw = Array.from(mergedById.values());
    // 快照始终保存全量（含隐藏），UI 再根据开关本地过滤，避免组件条目丢失。
    const parsed = parseInventory(mergedRaw, schema, {includeHidden: true});
    const rows = parsed.rows;
    const snapshotPath = saveProcessedSnapshot(rows);
    let rawPath = "";
    if (dumpRaw) {
      rawPath = saveRawSnapshot(finalRaw);
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

