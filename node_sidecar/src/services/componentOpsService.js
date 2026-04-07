const GlobalOffensive = require("globaloffensive");
const fs = require("fs");
const {AccountStore} = require("../accountStore");
const {TokenStore} = require("../tokenStore");
const {UiStateStore} = require("../uiStateStore");
const {SchemaStore} = require("../schemaStore");
const {parseInventory, decodeCasketId} = require("../inventoryParser");
const {saveProcessedSnapshot} = require("../snapshotStore");
const {fillMissingWearBounds} = require("../skinMetaStore");
const {preloadComponentContents} = require("../componentLoader");
const {buildComponentSummary: buildSharedComponentSummary} = require("./componentSummary");
const {STORAGE_UNIT_DEF_INDEX, STORAGE_UNIT_CAPACITY} = require("../constants");
const {asString, nowString, toInt, sleep, withTimeout} = require("../utils");

const NOTIFICATION = GlobalOffensive.ItemCustomizationNotification || {};
const ACTION_TEXT = {deposit: "存入", withdraw: "取出"};
const MAIN_INVENTORY_CAPACITY = 1000;

const HARD_BLOCKED_MARKET_HASHES = new Set([
  "global offensive badge",
  "music kit | valve, cs:go",
  "music kit | value"
]);

function normalizeItemIds(itemIds) {
  const out = [];
  const seen = new Set();
  for (const itemId of Array.isArray(itemIds) ? itemIds : []) {
    const key = asString(itemId).trim();
    if (!/^\d+$/.test(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function previewIds(itemIds, limit = 8) {
  const list = Array.isArray(itemIds) ? itemIds : [];
  const max = Math.max(1, Number(limit) || 8);
  const head = list.slice(0, max);
  return `${head.join(",")}${list.length > max ? ",..." : ""}`;
}

function summarizeFailedReasons(failed) {
  const summary = {};
  for (const entry of Array.isArray(failed) ? failed : []) {
    const reason = asString(entry && entry.reason ? entry.reason : "unknown").trim() || "unknown";
    summary[reason] = (summary[reason] || 0) + 1;
  }
  return summary;
}

function getInventoryItem(csgo, itemId) {
  const key = asString(itemId).trim();
  return (
    (csgo.inventory || []).find((item) => {
      const id = asString(item && (item.id || item.itemid || item.assetid || item.original_id || "")).trim();
      return id === key;
    }) || null
  );
}

function getItemCasketId(item) {
  if (!item || typeof item !== "object") return "";
  const direct = asString(item.casket_id || "").trim();
  if (direct) return direct;
  try {
    return asString(decodeCasketId(item) || "").trim();
  } catch (_) {
    return "";
  }
}

function notificationErrorMessage(notificationType) {
  if (notificationType === NOTIFICATION.CasketTooFull) return "组件空间已满";
  if (notificationType === NOTIFICATION.CasketInvFull) return "主库存空间已满";
  return `组件操作失败（通知=${notificationType}）`;
}

function moveSuccessType(action) {
  return action === "deposit" ? NOTIFICATION.CasketAdded : NOTIFICATION.CasketRemoved;
}

async function refreshComponentContentsOnce(csgo, componentId, timeoutMs = 6000) {
  await withTimeout(
    new Promise((resolve, reject) => {
      csgo.getCasketContents(componentId, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    }),
    timeoutMs,
    `refresh component ${componentId} timeout`
  );
}

function isMoveDone(csgo, action, componentId, itemId) {
  const item = getInventoryItem(csgo, itemId);
  if (!item) return false;
  const casketId = getItemCasketId(item);
  if (action === "deposit") return casketId === componentId;
  return !casketId;
}

async function waitForCasketMove({csgo, action, componentId, itemId, timeoutMs = 25000, pollMs = 120}) {
  return new Promise((resolve, reject) => {
    let done = false;
    let timeoutTimer = null;
    let pollTimer = null;

    function cleanup() {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (pollTimer) clearTimeout(pollTimer);
      csgo.off("itemCustomizationNotification", onNotification);
    }

    function finish(err) {
      if (done) return;
      done = true;
      cleanup();
      if (err) reject(err);
      else resolve();
    }

    function pollState() {
      if (done) return;
      if (isMoveDone(csgo, action, componentId, itemId)) {
        finish(null);
        return;
      }
      pollTimer = setTimeout(pollState, pollMs);
    }

    function onNotification(itemIds, notificationType) {
      if (done) return;
      const ids = Array.isArray(itemIds) ? itemIds : [];
      const keys = ids.map((x) => asString(x || "").trim()).filter(Boolean);
      const related = keys.length === 0 || keys.includes(componentId) || keys.includes(itemId);
      if (notificationType === NOTIFICATION.CasketTooFull || notificationType === NOTIFICATION.CasketInvFull) {
        if (!related) return;
        finish(new Error(notificationErrorMessage(notificationType)));
        return;
      }
      if (notificationType === moveSuccessType(action)) {
        // Some responses do not carry stable ids; for casket add/remove we trust success notification.
        finish(null);
      }
    }

        timeoutTimer = setTimeout(async () => {
      try {
        await refreshComponentContentsOnce(csgo, componentId, 6000);
      } catch (_) {
        // ignore refresh failure in timeout fallback
      }
      if (isMoveDone(csgo, action, componentId, itemId)) {
        finish(null);
        return;
      }
      finish(new Error(`${ACTION_TEXT[action] || "组件操作"}超时: item=${itemId}`));
    }, Math.max(1000, Number(timeoutMs) || 25000));

    csgo.on("itemCustomizationNotification", onNotification);
    pollState();

    try {
      if (action === "deposit") csgo.addToCasket(componentId, itemId);
      else csgo.removeFromCasket(componentId, itemId);
    } catch (err) {
      finish(err);
    }
  });
}

async function ensureComponentItemsLoaded(csgo, componentId) {
  await withTimeout(
    new Promise((resolve, reject) => {
      csgo.getCasketContents(componentId, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    }),
    35000,
    `load component ${componentId} timeout`
  );
}

function buildComponentSummary(rows) {
  return buildSharedComponentSummary(rows);
}

function makeParsedRows(csgo, schemaStore) {
  const schema = schemaStore.load();
  const raw = Array.isArray(csgo.inventory) ? [...csgo.inventory] : [];
  const parsed = parseInventory(raw, schema, {includeHidden: true});
  return parsed.rows || [];
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

async function makeParsedRowsWithComponentPreload(csgo, schemaStore, logger) {
  const schema = schemaStore.load();
  const componentStats = await preloadComponentContents(csgo, logger, {requestIntervalMs: 80});
  const finalRaw = Array.isArray(csgo.inventory) ? [...csgo.inventory] : [];
  const mergedById = new Map();
  for (const item of finalRaw) {
    const key = asString(item && (item.id || item.itemid || item.assetid || item.original_id || "")).trim();
    if (!key) continue;
    mergedById.set(key, item);
  }
  for (const item of componentStats.loaded_items || []) {
    const key = asString(item && (item.id || item.itemid || item.assetid || item.original_id || "")).trim();
    if (!key) continue;
    const existing = mergedById.get(key);
    if (!existing) {
      mergedById.set(key, item);
      continue;
    }
    mergedById.set(key, mergeRawItem(existing, item));
  }
  const mergedRaw = Array.from(mergedById.values());
  const parsed = parseInventory(mergedRaw, schema, {includeHidden: true});
  return parsed.rows || [];
}

function hasCompleteComponentCache(csgo) {
  const inventory = Array.isArray(csgo && csgo.inventory) ? csgo.inventory : [];
  if (!inventory.length) return false;
  let expectedTotal = 0;
  for (const item of inventory) {
    if (toInt(item && item.def_index, 0) !== STORAGE_UNIT_DEF_INDEX) continue;
    expectedTotal += Math.max(0, toInt(item && item.casket_contained_item_count, 0));
  }
  if (expectedTotal <= 0) return true;
  let loadedTotal = 0;
  for (const item of inventory) {
    if (asString(item && item.casket_id || "").trim()) loadedTotal += 1;
  }
  return loadedTotal >= expectedTotal;
}

async function buildRowsForSnapshot(csgo, schemaStore, logger, {forceComponentPreload = false} = {}) {
  if (forceComponentPreload || !hasCompleteComponentCache(csgo)) {
    return makeParsedRowsWithComponentPreload(csgo, schemaStore, logger);
  }
  return makeParsedRows(csgo, schemaStore);
}

function findComponentFromRows(rows, componentId) {
  const key = asString(componentId).trim();
  return (
    rows.find(
      (row) =>
        asString(row.asset_id || "").trim() === key && toInt(row.def_index, 0) === STORAGE_UNIT_DEF_INDEX
    ) || null
  );
}

function nthWeekdayOfMonthUtc(year, month, weekday, nth) {
  const first = new Date(Date.UTC(year, month, 1));
  const firstWeekday = first.getUTCDay();
  return 1 + ((7 + weekday - firstWeekday) % 7) + (nth - 1) * 7;
}

function isUsPacificDst(unlockTs) {
  if (!Number.isFinite(unlockTs) || unlockTs <= 0) return false;
  const d = new Date(unlockTs * 1000);
  const year = d.getUTCFullYear();
  const marchDay = nthWeekdayOfMonthUtc(year, 2, 0, 2);
  const novDay = nthWeekdayOfMonthUtc(year, 10, 0, 1);
  const startUtcTs = Math.floor(Date.UTC(year, 2, marchDay, 10, 0, 0) / 1000);
  const endUtcTs = Math.floor(Date.UTC(year, 10, novDay, 9, 0, 0) / 1000);
  return unlockTs >= startUtcTs && unlockTs < endUtcTs;
}

function normalizeTradableAfterTs(value) {
  const baseTs = Number(value);
  if (!Number.isFinite(baseTs) || baseTs <= 0) return 0;
  const secTs = baseTs > 1e12 ? Math.floor(baseTs / 1000) : Math.floor(baseTs);
  return isUsPacificDst(secTs) ? secTs : secTs + 3600;
}

function parseTradableAfterTs(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return 0;
    if (/^\d+$/.test(text)) {
      const num = Number(text);
      if (!Number.isFinite(num)) return 0;
      return normalizeTradableAfterTs(num);
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? normalizeTradableAfterTs(Math.floor(parsed / 1000)) : 0;
  }
  return normalizeTradableAfterTs(value);
}

function isCoolingRow(row) {
  const unlockTs = parseTradableAfterTs(row.tradable_after);
  return unlockTs > Math.floor(Date.now() / 1000);
}

function isYellowShieldBlockedRow(row) {
  if (!row || typeof row !== "object") return false;
  if (row.yellow_shield_blocked === true) return true;
  const lockKind = asString(row.trade_lock_kind || "").trim().toLowerCase();
  if (lockKind === "yellow_shield") return true;
  const hiddenReason = asString(row.hidden_reason || "").trim();
  return hiddenReason === "flags=24" || hiddenReason === "attr#277" || hiddenReason === "attr#312";
}

function isHardBlockedItem(row) {
  const marketHash = asString(row.market_hash_name || row.name || "").trim().toLowerCase();
  return HARD_BLOCKED_MARKET_HASHES.has(marketHash);
}

function isHiddenDisallowedRow(row) {
  const hiddenReason = asString(row.hidden_reason || "").trim();
  const casketId = asString(row.casket_id || "").trim();
  if (!hiddenReason) return false;
  // 组件内条目会带 casket_id，这类允许作为“跨组件转移”候选。
  return !casketId;
}

function ensureCanOperateItemByRules(row, targetComponentId) {
  const assetId = asString(row.asset_id || "").trim();
  if (!assetId) return {ok: false, reason: "物品 asset_id 无效"};
  if (toInt(row.def_index, 0) === STORAGE_UNIT_DEF_INDEX) return {ok: false, reason: "组件不能存入组件"};
  if (isYellowShieldBlockedRow(row)) return {ok: false, reason: "黄盾物品不能存入组件"};
  if (isHiddenDisallowedRow(row)) return {ok: false, reason: "隐藏条目不可存入组件"};
  if (isHardBlockedItem(row)) return {ok: false, reason: "该物品被硬编码禁止存入组件"};
  if (asString(row.casket_id || "").trim() === asString(targetComponentId).trim()) {
    return {ok: false, reason: "物品已在目标组件中"};
  }
  return {ok: true, reason: ""};
}

function rowWearValueForSort(row) {
  const wear = Number(row && row.float_value);
  return Number.isFinite(wear) ? wear : Number.POSITIVE_INFINITY;
}

function compareRowsByWearAsc(a, b) {
  const wa = rowWearValueForSort(a);
  const wb = rowWearValueForSort(b);
  if (wa !== wb) return wa - wb;
  return toInt(a && a.asset_id, 0) - toInt(b && b.asset_id, 0);
}

function buildWithdrawCapacityContext({rows, componentId, requestedItemIds}) {
  const componentKey = asString(componentId).trim();
  const list = Array.isArray(rows) ? rows : [];
  const requestedIds = new Set((Array.isArray(requestedItemIds) ? requestedItemIds : []).map((id) => asString(id).trim()).filter(Boolean));

  const mainRows = list.filter((row) => !asString(row && row.casket_id || "").trim());
  const hiddenCount = mainRows.filter((row) => asString(row && row.hidden_reason || "").trim()).length;
  const coolingCount = mainRows.filter((row) => isCoolingRow(row)).length;
  const occupiedSlots = Math.max(0, mainRows.length - hiddenCount - coolingCount);
  const freeSlots = Math.max(0, MAIN_INVENTORY_CAPACITY - occupiedSlots);

  const requestedRowsInComponent = list
    .filter((row) =>
      asString(row && row.casket_id || "").trim() === componentKey &&
      requestedIds.has(asString(row && row.asset_id || "").trim())
    )
    .sort(compareRowsByWearAsc);

  const allowedIds = requestedRowsInComponent
    .slice(0, freeSlots)
    .map((row) => asString(row && row.asset_id || "").trim())
    .filter(Boolean);
  const clippedIds = requestedRowsInComponent
    .slice(freeSlots)
    .map((row) => asString(row && row.asset_id || "").trim())
    .filter(Boolean);

  return {
    capacity: MAIN_INVENTORY_CAPACITY,
    occupiedSlots,
    freeSlots,
    hiddenCount,
    coolingCount,
    allowedSet: new Set(allowedIds),
    clippedSet: new Set(clippedIds)
  };
}

function createComponentOpsService({sessionPool, logger}) {
  if (!sessionPool) throw new Error("sessionPool is required");

  const accountLocks = new Map();

  async function withAccountLock(username, task) {
    const key = asString(username).trim();
    if (!key) throw new Error("username is required");
    const prev = accountLocks.get(key) || Promise.resolve();
    const current = prev
      .catch(() => {})
      .then(task)
      .finally(() => {
        if (accountLocks.get(key) === current) accountLocks.delete(key);
      });
    accountLocks.set(key, current);
    return current;
  }

  async function acquireContext({username, password}) {
    const accountStore = new AccountStore();
    const account = username ? accountStore.get(username) : accountStore.getActive();
    if (!account) throw new Error(`account not found: ${username || "(active)"}`);
    const accountName = asString(account.username).trim();
    const tokenStore = new TokenStore();
    const refreshToken = tokenStore.get(accountName);
    const accountPassword = asString(password || account.password || "").trim();
    if (!refreshToken && !accountPassword) throw new Error(`password missing: ${accountName}`);
    const acquired = await sessionPool.acquire({
      username: accountName,
      password: accountPassword,
      refreshToken,
      tokenStore
    });
    const csgo = acquired.csgo;
    if (!csgo || !Array.isArray(csgo.inventory)) throw new Error("GC inventory not ready");
    return {accountName, csgo};
  }

  function saveRowsSnapshot({accountName, rows}) {
    const snapshotPath = saveProcessedSnapshot(rows);
    const fetchTime = nowString();
    const uiState = new UiStateStore();
    uiState.setAccountSnapshot(accountName, snapshotPath, fetchTime);
    uiState.setLastSelected(accountName);
    sessionPool.touch(accountName);
    return {snapshotPath, fetchTime};
  }

  function buildDepositCandidateContext({rows, componentId}) {
    const componentRow = findComponentFromRows(rows, componentId);
    if (!componentRow) throw new Error(`component not found: ${componentId}`);
    const expected = STORAGE_UNIT_CAPACITY;
    const loadedByRows = rows.filter((row) => asString(row.casket_id || "").trim() === componentId).length;
    const loadedByCounter = Math.max(0, toInt(componentRow.casket_contained_item_count, 0));
    const loaded = Math.max(loadedByRows, loadedByCounter);
    const freeSlots = Math.max(0, expected - loaded);
    const candidates = [];
    const excluded = [];
    for (const row of rows) {
      const rule = ensureCanOperateItemByRules(row, componentId);
      if (!rule.ok) {
        excluded.push({row, reason: rule.reason || "不满足可存入规则"});
        continue;
      }
      const sourceComponentId = asString(row.casket_id || "").trim();
      candidates.push({
        row,
        action_type: sourceComponentId ? "transfer" : "deposit",
        source_component_id: sourceComponentId
      });
    }
    return {
      expected,
      loaded,
      freeSlots,
      candidateRows: candidates,
      excludedRows: excluded,
      candidateSet: new Set(candidates.map((x) => asString(x.row.asset_id || "").trim()))
    };
  }

  function buildExcludedSummary(excludedRows) {
    const summary = {};
    for (const entry of excludedRows || []) {
      const reason = asString(entry.reason || "未知原因").trim() || "未知原因";
      summary[reason] = (summary[reason] || 0) + 1;
    }
    return summary;
  }

  function readRowsFromProcessedSnapshot(snapshotPath) {
    const full = asString(snapshotPath).trim();
    if (!full || !fs.existsSync(full)) {
      return [];
    }
    try {
      const text = fs.readFileSync(full, "utf8");
      const payload = JSON.parse(text);
      const rows = Array.isArray(payload && payload.items) ? payload.items : [];
      return fillMissingWearBounds(rows);
    } catch (_) {
      return [];
    }
  }

  function sortRowsByAssetId(rows) {
    rows.sort((a, b) => toInt(a && a.asset_id, 0) - toInt(b && b.asset_id, 0));
    return rows;
  }

  function isAffectedRow(row, affectedComponentIds, affectedItemIds) {
    const assetId = asString(row && row.asset_id || "").trim();
    const casketId = asString(row && row.casket_id || "").trim();
    if (assetId && affectedItemIds.has(assetId)) {
      return true;
    }
    if (casketId && affectedComponentIds.has(casketId)) {
      return true;
    }
    if (assetId && affectedComponentIds.has(assetId)) {
      return true;
    }
    return false;
  }

  function mergeRowsWithPreviousSnapshot({accountName, currentRows, affectedComponentIds, affectedItemIds, logger}) {
    const uiState = new UiStateStore();
    const accountCache = uiState.getAccount(accountName);
    const snapshotPath = asString(accountCache && accountCache.snapshot_path ? accountCache.snapshot_path : "").trim();
    const prevRows = readRowsFromProcessedSnapshot(snapshotPath);
    if (!prevRows.length) {
      return null;
    }
    const preserved = prevRows.filter((row) => !isAffectedRow(row, affectedComponentIds, affectedItemIds));
    const patched = (Array.isArray(currentRows) ? currentRows : []).filter((row) =>
      isAffectedRow(row, affectedComponentIds, affectedItemIds)
    );
    const merged = sortRowsByAssetId([...preserved, ...patched]);
    if (logger) {
      logger.info(
        "component_ops",
        `snapshot merge: base=${prevRows.length} preserved=${preserved.length} patched=${patched.length} merged=${merged.length}`
      );
    }
    return merged;
  }

  async function listDepositCandidates({username, password, componentId, includeExcluded = false}) {
    const componentKey = asString(componentId).trim();
    if (!componentKey || !/^\d+$/.test(componentKey)) throw new Error("component_id 无效");
    const {accountName, csgo} = await acquireContext({username, password});
    return withAccountLock(accountName, async () => {
      const schemaStore = new SchemaStore();
      await ensureComponentItemsLoaded(csgo, componentKey);
      const rows = await makeParsedRowsWithComponentPreload(csgo, schemaStore, logger);
      const ctx = buildDepositCandidateContext({rows, componentId: componentKey});
      const candidates = ctx.candidateRows.map((entry) => {
        const row = entry.row;
        return {
          asset_id: row.asset_id,
          name: row.name,
          market_hash_name: row.market_hash_name,
          alchemy_name: row.alchemy_name,
          collection: row.collection,
          rarity: row.rarity,
          rarity_name: row.rarity_name,
          alchemy_rarity: row.alchemy_rarity,
          float_value: row.float_value,
          paint_seed: row.paint_seed,
          def_index: row.def_index,
          casket_id: row.casket_id || "",
          action_type: entry.action_type,
          source_component_id: entry.source_component_id || ""
        };
      });
      const excluded = includeExcluded
        ? ctx.excludedRows.map((entry) => {
          const row = entry.row;
          return {
            asset_id: row.asset_id,
            name: row.name,
            market_hash_name: row.market_hash_name,
            alchemy_name: row.alchemy_name,
            casket_id: row.casket_id || "",
            reason: asString(entry.reason || "").trim() || "不满足可存入规则"
          };
        })
        : [];
      return {
        ok: true,
        account: accountName,
        component_id: componentKey,
        free_slots: ctx.freeSlots,
        loaded_count: ctx.loaded,
        expected_count: ctx.expected,
        candidates,
        excluded,
        excluded_summary: includeExcluded ? buildExcludedSummary(ctx.excludedRows) : {},
        message: ctx.freeSlots <= 0 ? "组件已满，无法继续存入" : `可存入候选：${candidates.length} 件`
      };
    });
  }

  async function runMove({action, username, password, componentId, itemIds, onProgress, shouldPause}) {
    const opAction = action === "withdraw" ? "withdraw" : "deposit";
    const componentKey = asString(componentId).trim();
    if (!componentKey || !/^\d+$/.test(componentKey)) throw new Error("component_id 无效");
    const requestedItems = normalizeItemIds(itemIds);
    if (!requestedItems.length) throw new Error("item_ids 不能为空");
    const totalRequested = requestedItems.length;
    const progressCb = typeof onProgress === "function" ? onProgress : null;
    const pauseCheck = typeof shouldPause === "function" ? shouldPause : null;

    const {accountName, csgo} = await acquireContext({username, password});

    return withAccountLock(accountName, async () => {
      function isPauseRequested() {
        if (!pauseCheck) return false;
        try {
          return !!pauseCheck();
        } catch (_) {
          return false;
        }
      }
      function emitProgress(payload) {
        if (!progressCb) return;
        try {
          progressCb({
            account: accountName,
            action: opAction,
            component_id: componentKey,
            total: totalRequested,
            ...payload
          });
        } catch (_) {
          // ignore progress callback errors
        }
      }

      const schemaStore = new SchemaStore();
      const componentItem = getInventoryItem(csgo, componentKey);
      if (!componentItem || toInt(componentItem.def_index, 0) !== STORAGE_UNIT_DEF_INDEX) {
        throw new Error(`component not found: ${componentKey}`);
      }
      if (opAction === "withdraw") {
        await ensureComponentItemsLoaded(csgo, componentKey);
      }

      let depositContext = null;
      let withdrawCapacityContext = null;
      if (opAction === "deposit") {
        const rows = await buildRowsForSnapshot(csgo, schemaStore, logger, {forceComponentPreload: false});
        depositContext = buildDepositCandidateContext({rows, componentId: componentKey});
      } else {
        const rows = makeParsedRows(csgo, schemaStore);
        withdrawCapacityContext = buildWithdrawCapacityContext({
          rows,
          componentId: componentKey,
          requestedItemIds: requestedItems
        });
      }

      const successIds = [];
      const failed = [];
      let remainFreeSlots = depositContext ? depositContext.freeSlots : 0;
      let processed = 0;
      let withdrawReloadAttempted = false;
      const touchedComponentIds = new Set([componentKey]);
      const clippedByCapacityCount = withdrawCapacityContext ? withdrawCapacityContext.clippedSet.size : 0;
      let paused = false;

      emitProgress({
        phase: "start",
        processed,
        success: 0,
        failed: 0
      });

      for (const itemId of requestedItems) {
        if (isPauseRequested()) {
          paused = true;
          emitProgress({
            phase: "paused",
            processed,
            success: successIds.length,
            failed: failed.length
          });
          break;
        }
        if (opAction === "withdraw" && withdrawCapacityContext && withdrawCapacityContext.clippedSet.has(itemId)) {
          failed.push({
            item_id: itemId,
            reason: `主库存空间不足（服务端预裁剪，仅允许前${withdrawCapacityContext.freeSlots}件）`
          });
          processed += 1;
          emitProgress({
            phase: "item",
            processed,
            success: successIds.length,
            failed: failed.length,
            item_id: itemId,
            item_status: "failed",
            reason: "main_inventory_capacity_clip"
          });
          continue;
        }
        let item = getInventoryItem(csgo, itemId);
        if (!item && opAction === "withdraw" && !withdrawReloadAttempted) {
          withdrawReloadAttempted = true;
          try {
            await ensureComponentItemsLoaded(csgo, componentKey);
            item = getInventoryItem(csgo, itemId);
          } catch (_) {
            // ignore fallback preload errors
          }
        }
        if (!item) {
          failed.push({item_id: itemId, reason: "物品不存在或未加载"});
          processed += 1;
          emitProgress({
            phase: "item",
            processed,
            success: successIds.length,
            failed: failed.length,
            item_id: itemId,
            item_status: "failed",
            reason: "item_missing"
          });
          continue;
        }

        if (opAction === "deposit") {
          if (remainFreeSlots <= 0) {
            failed.push({item_id: itemId, reason: "组件空间已满"});
            processed += 1;
            emitProgress({
              phase: "item",
              processed,
              success: successIds.length,
              failed: failed.length,
              item_id: itemId,
              item_status: "failed",
              reason: "component_full"
            });
            continue;
          }
          if (!depositContext || !depositContext.candidateSet.has(itemId)) {
            failed.push({item_id: itemId, reason: "不满足可存入规则"});
            processed += 1;
            emitProgress({
              phase: "item",
              processed,
              success: successIds.length,
              failed: failed.length,
              item_id: itemId,
              item_status: "failed",
              reason: "rule_blocked"
            });
            continue;
          }

          const sourceCasketId = getItemCasketId(item);
          if (sourceCasketId && sourceCasketId !== componentKey) {
            touchedComponentIds.add(sourceCasketId);
          }
          try {
            if (sourceCasketId && sourceCasketId !== componentKey) {
              await waitForCasketMove({
                csgo,
                action: "withdraw",
                componentId: sourceCasketId,
                itemId
              });
              await sleep(80);
            }

            await waitForCasketMove({
              csgo,
              action: "deposit",
              componentId: componentKey,
              itemId
            });
            successIds.push(itemId);
            remainFreeSlots = Math.max(0, remainFreeSlots - 1);
            processed += 1;
            emitProgress({
              phase: "item",
              processed,
              success: successIds.length,
              failed: failed.length,
              item_id: itemId,
              item_status: "success"
            });
          } catch (err) {
            const reason = asString(err && err.message ? err.message : err) || "未知错误";
            failed.push({item_id: itemId, reason});
            processed += 1;
            emitProgress({
              phase: "item",
              processed,
              success: successIds.length,
              failed: failed.length,
              item_id: itemId,
              item_status: "failed",
              reason
            });
          }
          await sleep(80);
          continue;
        }

        const casketId = getItemCasketId(item);
        if (casketId !== componentKey) {
          failed.push({item_id: itemId, reason: "物品不在当前组件内"});
          processed += 1;
          emitProgress({
            phase: "item",
            processed,
            success: successIds.length,
            failed: failed.length,
            item_id: itemId,
            item_status: "failed",
            reason: "not_in_component"
          });
          continue;
        }

        try {
          await waitForCasketMove({
            csgo,
            action: "withdraw",
            componentId: componentKey,
            itemId
          });
          successIds.push(itemId);
          processed += 1;
          emitProgress({
            phase: "item",
            processed,
            success: successIds.length,
            failed: failed.length,
            item_id: itemId,
            item_status: "success"
          });
        } catch (err) {
          const reason = asString(err && err.message ? err.message : err) || "未知错误";
          failed.push({item_id: itemId, reason});
          processed += 1;
          emitProgress({
            phase: "item",
            processed,
            success: successIds.length,
            failed: failed.length,
            item_id: itemId,
            item_status: "failed",
            reason
          });
        }
        await sleep(80);
      }

      for (const cid of touchedComponentIds) {
        try {
          await ensureComponentItemsLoaded(csgo, cid);
        } catch (err) {
          if (logger) {
            logger.warn(
              "component_ops",
              `post-op component reload failed: id=${cid} err=${asString(err && err.message ? err.message : err)}`
            );
          }
        }
      }

      const currentRows = makeParsedRows(csgo, schemaStore);
      const affectedComponentIds = new Set(touchedComponentIds);
      const affectedItemIds = new Set(requestedItems.map((id) => asString(id).trim()).filter(Boolean));
      const mergedRows = mergeRowsWithPreviousSnapshot({
        accountName,
        currentRows,
        affectedComponentIds,
        affectedItemIds,
        logger
      });
      const finalRows = mergedRows || (await buildRowsForSnapshot(csgo, schemaStore, logger, {forceComponentPreload: false}));
      const snapshot = saveRowsSnapshot({accountName, rows: finalRows});

      const actionText = ACTION_TEXT[opAction] || "组件操作";
      const firstFailed = failed.length ? `${failed[0].item_id}:${failed[0].reason}` : "";
      const reasonSummary = summarizeFailedReasons(failed);
      const clipTail = clippedByCapacityCount > 0 ? `，服务端预裁剪${clippedByCapacityCount}件` : "";
      const pauseTail = paused ? `，已暂停，剩余${Math.max(0, totalRequested - processed)}件未处理` : "";
      const message = `${actionText}完成：成功${successIds.length}，失败${failed.length}${clipTail}${pauseTail}${firstFailed ? `，首个失败 ${firstFailed}` : ""}`;
      if (logger) {
        logger.info(
          "component_ops",
          `${opAction} done: account=${accountName} component=${componentKey} requested=${totalRequested} selected=${previewIds(requestedItems)} success=${successIds.length} failed=${failed.length} clipped=${clippedByCapacityCount} paused=${paused ? 1 : 0} first_failed=${firstFailed || "-"} failed_reasons=${JSON.stringify(reasonSummary)}`
        );
      }

      emitProgress({
        phase: paused ? "paused" : "done",
        processed,
        success: successIds.length,
        failed: failed.length
      });

      return {
        ok: true,
        account: accountName,
        fetch_time: snapshot.fetchTime,
        snapshot_path: snapshot.snapshotPath,
        rows: finalRows,
        component: buildComponentSummary(finalRows),
        message,
        op: {
          action: opAction,
          component_id: componentKey,
          requested: totalRequested,
          paused,
          clipped_count: clippedByCapacityCount,
          success_ids: successIds,
          failed,
          remaining_ids: requestedItems.slice(processed)
        }
      };
    });
  }

  return {listDepositCandidates, runMove};
}

module.exports = {createComponentOpsService};


