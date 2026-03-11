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

const ACTION_TEXT = {
  deposit: "存入",
  withdraw: "取出"
};

function normalizeItemIds(itemIds) {
  const out = [];
  const seen = new Set();
  for (const itemId of Array.isArray(itemIds) ? itemIds : []) {
    const key = asString(itemId).trim();
    if (!/^\d+$/.test(key) || seen.has(key)) {
      continue;
    }
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
  if (notificationType === NOTIFICATION.CasketTooFull) {
    return "组件空间已满";
  }
  if (notificationType === NOTIFICATION.CasketInvFull) {
    return "主仓库空间已满";
  }
  return `组件操作失败（通知=${notificationType}）`;
}

function moveSuccessType(action) {
  return action === "deposit" ? NOTIFICATION.CasketAdded : NOTIFICATION.CasketRemoved;
}

function isMoveDone(csgo, action, componentId, itemId) {
  const item = getInventoryItem(csgo, itemId);
  if (!item) {
    return false;
  }
  const casketId = asString(item.casket_id || "").trim();
  if (action === "deposit") {
    return casketId === componentId;
  }
  return !casketId;
}

async function waitForCasketMove({csgo, action, componentId, itemId, timeoutMs = 15000, pollMs = 120}) {
  return new Promise((resolve, reject) => {
    let done = false;
    let timeoutTimer = null;
    let pollTimer = null;

    function cleanup() {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      if (pollTimer) {
        clearTimeout(pollTimer);
      }
      csgo.off("itemCustomizationNotification", onNotification);
    }

    function finish(err) {
      if (done) {
        return;
      }
      done = true;
      cleanup();
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    }

    function pollState() {
      if (done) {
        return;
      }
      if (isMoveDone(csgo, action, componentId, itemId)) {
        finish(null);
        return;
      }
      pollTimer = setTimeout(pollState, pollMs);
    }

    function onNotification(itemIds, notificationType) {
      if (done) {
        return;
      }
      const ids = Array.isArray(itemIds) ? itemIds : [];
      const target = asString(ids[0] || "").trim();
      if (target && target !== componentId) {
        return;
      }
      if (
        notificationType === NOTIFICATION.CasketTooFull ||
        notificationType === NOTIFICATION.CasketInvFull
      ) {
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
      if (action === "deposit") {
        csgo.addToCasket(componentId, itemId);
      } else {
        csgo.removeFromCasket(componentId, itemId);
      }
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
    if (!cid) {
      continue;
    }
    if (!itemMap[cid]) {
      itemMap[cid] = [];
    }
    itemMap[cid].push(row);
  }
  for (const row of rows) {
    if (toInt(row.def_index, 0) !== STORAGE_UNIT_DEF_INDEX) {
      continue;
    }
    const id = asString(row.asset_id || "").trim();
    if (!id) {
      continue;
    }
    summaryMap[id] = {
      component_id: id,
      name: asString(row.alchemy_name || row.name || `Component ${id}`),
      expected_count: toInt(row.casket_contained_item_count, 0),
      loaded_count: (itemMap[id] || []).length
    };
  }
  return {summary_map: summaryMap, item_map: itemMap};
}

function createComponentOpsService({sessionPool, logger}) {
  if (!sessionPool) {
    throw new Error("sessionPool is required");
  }

  const accountLocks = new Map();

  async function withAccountLock(username, task) {
    const key = asString(username).trim();
    if (!key) {
      throw new Error("username is required");
    }
    const prev = accountLocks.get(key) || Promise.resolve();
    const current = prev
      .catch(() => {})
      .then(task)
      .finally(() => {
        if (accountLocks.get(key) === current) {
          accountLocks.delete(key);
        }
      });
    accountLocks.set(key, current);
    return current;
  }

  async function runMove({
    action,
    username,
    password,
    componentId,
    itemIds
  }) {
    const opAction = action === "withdraw" ? "withdraw" : "deposit";
    const componentKey = asString(componentId).trim();
    if (!componentKey || !/^\d+$/.test(componentKey)) {
      throw new Error("component_id 无效");
    }
    const items = normalizeItemIds(itemIds);
    if (!items.length) {
      throw new Error("item_ids 不能为空");
    }

    const accountStore = new AccountStore();
    const account = username ? accountStore.get(username) : accountStore.getActive();
    if (!account) {
      throw new Error(`account not found: ${username || "(active)"}`);
    }
    const accountName = asString(account.username).trim();
    const tokenStore = new TokenStore();
    const refreshToken = tokenStore.get(accountName);
    const accountPassword = asString(password || account.password || "").trim();
    if (!refreshToken && !accountPassword) {
      throw new Error(`password missing: ${accountName}`);
    }

    return withAccountLock(accountName, async () => {
      const acquired = await sessionPool.acquire({
        username: accountName,
        password: accountPassword,
        refreshToken,
        tokenStore
      });
      const csgo = acquired.csgo;
      if (!csgo || !Array.isArray(csgo.inventory)) {
        throw new Error("GC inventory not ready");
      }

      const componentItem = getInventoryItem(csgo, componentKey);
      if (!componentItem || toInt(componentItem.def_index, 0) !== STORAGE_UNIT_DEF_INDEX) {
        throw new Error(`component not found: ${componentKey}`);
      }

      if (opAction === "withdraw") {
        await ensureComponentItemsLoaded(csgo, componentKey);
      }

      const successIds = [];
      const failed = [];
      for (const itemId of items) {
        const item = getInventoryItem(csgo, itemId);
        if (!item) {
          failed.push({item_id: itemId, reason: "物品不存在或未加载"});
          continue;
        }
        const currentCasket = asString(item.casket_id || "").trim();
        if (opAction === "deposit") {
          if (toInt(item.def_index, 0) === STORAGE_UNIT_DEF_INDEX) {
            failed.push({item_id: itemId, reason: "组件不能存入组件"});
            continue;
          }
          if (currentCasket) {
            failed.push({item_id: itemId, reason: "物品已在其他组件中"});
            continue;
          }
        } else if (currentCasket !== componentKey) {
          failed.push({item_id: itemId, reason: "物品不在当前组件中"});
          continue;
        }

        try {
          await waitForCasketMove({
            csgo,
            action: opAction,
            componentId: componentKey,
            itemId
          });
          successIds.push(itemId);
        } catch (err) {
          failed.push({
            item_id: itemId,
            reason: asString(err && err.message ? err.message : err) || "未知错误"
          });
        }
        await sleep(80);
      }

      const schemaStore = new SchemaStore();
      const schema = schemaStore.load();
      const raw = Array.isArray(csgo.inventory) ? [...csgo.inventory] : [];
      const parsed = parseInventory(raw, schema, {includeHidden: true});
      const rows = parsed.rows;
      const snapshotPath = saveProcessedSnapshot(rows);
      const fetchTime = nowString();
      const uiState = new UiStateStore();
      uiState.setAccountSnapshot(accountName, snapshotPath, fetchTime);
      uiState.setLastSelected(accountName);
      sessionPool.touch(accountName);

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
        fetch_time: fetchTime,
        snapshot_path: snapshotPath,
        rows,
        component: buildComponentSummary(rows),
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

  return {
    runMove
  };
}

module.exports = {
  createComponentOpsService
};
