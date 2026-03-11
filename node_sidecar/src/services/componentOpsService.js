const GlobalOffensive = require("globaloffensive");
const {AccountStore} = require("../accountStore");
const {TokenStore} = require("../tokenStore");
const {UiStateStore} = require("../uiStateStore");
const {SchemaStore} = require("../schemaStore");
const {parseInventory} = require("../inventoryParser");
const {saveProcessedSnapshot} = require("../snapshotStore");
const {STORAGE_UNIT_DEF_INDEX} = require("../constants");
const {asString, nowString, toInt, sleep, withTimeout} = require("../utils");

const NOTIFICATION = GlobalOffensive.ItemCustomizationNotification || {};
const ACTION_TEXT = {deposit: "存入", withdraw: "取出"};

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

function getInventoryItem(csgo, itemId) {
  const key = asString(itemId).trim();
  return (csgo.inventory || []).find((item) => asString(item.id || "").trim() === key) || null;
}

function notificationErrorMessage(notificationType) {
  if (notificationType === NOTIFICATION.CasketTooFull) return "组件空间已满";
  if (notificationType === NOTIFICATION.CasketInvFull) return "主仓库空间已满";
  return `组件操作失败（通知=${notificationType}）`;
}

function moveSuccessType(action) {
  return action === "deposit" ? NOTIFICATION.CasketAdded : NOTIFICATION.CasketRemoved;
}

function isMoveDone(csgo, action, componentId, itemId) {
  const item = getInventoryItem(csgo, itemId);
  if (!item) return false;
  const casketId = asString(item.casket_id || "").trim();
  if (action === "deposit") return casketId === componentId;
  return !casketId;
}

async function waitForCasketMove({csgo, action, componentId, itemId, timeoutMs = 15000, pollMs = 120}) {
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
      const target = asString(ids[0] || "").trim();
      if (target && target !== componentId) return;
      if (notificationType === NOTIFICATION.CasketTooFull || notificationType === NOTIFICATION.CasketInvFull) {
        finish(new Error(notificationErrorMessage(notificationType)));
        return;
      }
      if (notificationType === moveSuccessType(action)) {
        pollState();
      }
    }

    timeoutTimer = setTimeout(() => {
      finish(new Error(`${ACTION_TEXT[action] || "组件操作"}超时: item=${itemId}`));
    }, Math.max(1000, Number(timeoutMs) || 15000));

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
  const summaryMap = {};
  const itemMap = {};
  for (const row of rows) {
    const cid = asString(row.casket_id || "").trim();
    if (!cid) continue;
    if (!itemMap[cid]) itemMap[cid] = [];
    itemMap[cid].push(row);
  }
  for (const row of rows) {
    if (toInt(row.def_index, 0) !== STORAGE_UNIT_DEF_INDEX) continue;
    const id = asString(row.asset_id || "").trim();
    if (!id) continue;
    summaryMap[id] = {
      component_id: id,
      name: asString(row.alchemy_name || row.name || `Component ${id}`),
      expected_count: toInt(row.casket_contained_item_count, 0),
      loaded_count: (itemMap[id] || []).length
    };
  }
  return {summary_map: summaryMap, item_map: itemMap};
}

function makeParsedRows(csgo, schemaStore) {
  const schema = schemaStore.load();
  const raw = Array.isArray(csgo.inventory) ? [...csgo.inventory] : [];
  const parsed = parseInventory(raw, schema, {includeHidden: true});
  return parsed.rows || [];
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

function parseTradableAfterTs(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return 0;
    if (/^\d+$/.test(text)) {
      const num = Number(text);
      if (!Number.isFinite(num)) return 0;
      return num > 1e12 ? Math.floor(num / 1000) : Math.floor(num);
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return num > 1e12 ? Math.floor(num / 1000) : Math.floor(num);
}

function isCoolingRow(row) {
  const unlockTs = parseTradableAfterTs(row.tradable_after);
  return unlockTs > Math.floor(Date.now() / 1000);
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
  if (isCoolingRow(row)) return {ok: false, reason: "黄盾冷却中，不能存入组件"};
  if (isHiddenDisallowedRow(row)) return {ok: false, reason: "隐藏条目不可存入组件"};
  if (isHardBlockedItem(row)) return {ok: false, reason: "该物品被硬编码禁止存入组件"};
  if (asString(row.casket_id || "").trim() === asString(targetComponentId).trim()) {
    return {ok: false, reason: "物品已在目标组件中"};
  }
  return {ok: true, reason: ""};
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
    const expected = toInt(componentRow.casket_contained_item_count, 0);
    const loaded = rows.filter((row) => asString(row.casket_id || "").trim() === componentId).length;
    const freeSlots = Math.max(0, expected - loaded);
    const candidates = [];
    for (const row of rows) {
      const rule = ensureCanOperateItemByRules(row, componentId);
      if (!rule.ok) continue;
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
      candidateSet: new Set(candidates.map((x) => asString(x.row.asset_id || "").trim()))
    };
  }

  async function listDepositCandidates({username, password, componentId}) {
    const componentKey = asString(componentId).trim();
    if (!componentKey || !/^\d+$/.test(componentKey)) throw new Error("component_id 无效");
    const {accountName, csgo} = await acquireContext({username, password});
    return withAccountLock(accountName, async () => {
      const schemaStore = new SchemaStore();
      const rows = makeParsedRows(csgo, schemaStore);
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
      return {
        ok: true,
        account: accountName,
        component_id: componentKey,
        free_slots: ctx.freeSlots,
        loaded_count: ctx.loaded,
        expected_count: ctx.expected,
        candidates,
        message: ctx.freeSlots <= 0 ? "组件已满，无法继续存入" : `可存入候选 ${candidates.length} 件`
      };
    });
  }

  async function runMove({action, username, password, componentId, itemIds}) {
    const opAction = action === "withdraw" ? "withdraw" : "deposit";
    const componentKey = asString(componentId).trim();
    if (!componentKey || !/^\d+$/.test(componentKey)) throw new Error("component_id 无效");
    const items = normalizeItemIds(itemIds);
    if (!items.length) throw new Error("item_ids 不能为空");

    const {accountName, csgo} = await acquireContext({username, password});

    return withAccountLock(accountName, async () => {
      const schemaStore = new SchemaStore();
      let rows = makeParsedRows(csgo, schemaStore);
      const componentItem = getInventoryItem(csgo, componentKey);
      if (!componentItem || toInt(componentItem.def_index, 0) !== STORAGE_UNIT_DEF_INDEX) {
        throw new Error(`component not found: ${componentKey}`);
      }
      if (opAction === "withdraw") {
        await ensureComponentItemsLoaded(csgo, componentKey);
        rows = makeParsedRows(csgo, schemaStore);
      }

      let depositContext = null;
      if (opAction === "deposit") {
        depositContext = buildDepositCandidateContext({rows, componentId: componentKey});
      }

      const successIds = [];
      const failed = [];
      let remainFreeSlots = depositContext ? depositContext.freeSlots : 0;

      for (const itemId of items) {
        const item = getInventoryItem(csgo, itemId);
        if (!item) {
          failed.push({item_id: itemId, reason: "物品不存在或未加载"});
          continue;
        }

        if (opAction === "deposit") {
          if (remainFreeSlots <= 0) {
            failed.push({item_id: itemId, reason: "组件空间已满"});
            continue;
          }
          if (!depositContext.candidateSet.has(itemId)) {
            failed.push({item_id: itemId, reason: "不满足可存入规则"});
            continue;
          }
          const casketId = asString(item.casket_id || "").trim();
          try {
            if (casketId && casketId !== componentKey) {
              // 跨组件转移：先从原组件取出，再存入目标组件。
              await waitForCasketMove({
                csgo,
                action: "withdraw",
                componentId: casketId,
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
          } catch (err) {
            const reason = asString(err && err.message ? err.message : err) || "未知错误";
            failed.push({item_id: itemId, reason});
          }
          await sleep(80);
          continue;
        }

        const casketId = asString(item.casket_id || "").trim();
        if (casketId !== componentKey) {
          failed.push({item_id: itemId, reason: "物品不在当前组件中"});
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
        } catch (err) {
          const reason = asString(err && err.message ? err.message : err) || "未知错误";
          failed.push({item_id: itemId, reason});
        }
        await sleep(80);
      }

      const finalRows = makeParsedRows(csgo, schemaStore);
      const snapshot = saveRowsSnapshot({accountName, rows: finalRows});

      const actionText = ACTION_TEXT[opAction] || "组件操作";
      const message = `${actionText}完成：成功${successIds.length}，失败${failed.length}`;
      if (logger) {
        logger.info(
          "component_ops",
          `${opAction} done: account=${accountName} component=${componentKey} success=${successIds.length} failed=${failed.length}`
        );
      }
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
          requested: items.length,
          success_ids: successIds,
          failed
        }
      };
    });
  }

  return {listDepositCandidates, runMove};
}

module.exports = {createComponentOpsService};
