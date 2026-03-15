const {AccountStore} = require("../accountStore");
const {TokenStore} = require("../tokenStore");
const {UiStateStore} = require("../uiStateStore");
const {SchemaStore} = require("../schemaStore");
const {parseInventory} = require("../inventoryParser");
const {saveProcessedSnapshot} = require("../snapshotStore");
const {asString, toInt, nowString} = require("../utils");

const RARITY_NAME_MAP = {
  1: "Consumer",
  2: "Industrial",
  3: "Mil-Spec",
  4: "Restricted",
  5: "Classified",
  6: "Covert"
};
const MAX_RECIPE_COUNT = 50;

function badRequest(message) {
  const err = new Error(message);
  err.code = "bad_request";
  return err;
}

function normalizeAssetId(value) {
  const key = asString(value).trim();
  if (!/^\d+$/.test(key)) {
    return "";
  }
  return key;
}

function parseRecipeItemIds(rawIds, recipeIndex) {
  const idsRaw = Array.isArray(rawIds) ? rawIds : [];
  if (idsRaw.length !== 10) {
    throw badRequest(`第${recipeIndex}组需要正好 10 件物品，当前为 ${idsRaw.length} 件`);
  }
  const ids = [];
  const seen = new Set();
  for (const rawId of idsRaw) {
    const id = normalizeAssetId(rawId);
    if (!id) {
      throw badRequest(`第${recipeIndex}组存在无效物品 ID：${asString(rawId) || "(empty)"}`);
    }
    if (seen.has(id)) {
      throw badRequest(`第${recipeIndex}组存在重复物品：${id}`);
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function normalizeRecipeRequests({itemIds, recipes}) {
  let reqs = [];
  if (Array.isArray(recipes) && recipes.length > 0) {
    reqs = recipes.map((entry, index) => {
      const recipeIndex = index + 1;
      const ids = parseRecipeItemIds(entry && entry.item_ids, recipeIndex);
      return {
        index: recipeIndex,
        item_ids: ids
      };
    });
  } else {
    reqs = [
      {
        index: 1,
        item_ids: parseRecipeItemIds(itemIds, 1)
      }
    ];
  }
  if (reqs.length > MAX_RECIPE_COUNT) {
    throw badRequest(`单次最多执行 ${MAX_RECIPE_COUNT} 组配方，当前为 ${reqs.length} 组`);
  }

  const globalSeen = new Map();
  for (const req of reqs) {
    for (const id of req.item_ids) {
      const prev = globalSeen.get(id);
      if (prev) {
        throw badRequest(`物品不能重复用于多组配方：${id}（第${prev}组与第${req.index}组冲突）`);
      }
      globalSeen.set(id, req.index);
    }
  }
  return reqs;
}

function isStatTrakRow(row) {
  const quality = toInt(row && row.quality, 0);
  if (quality === 9) return true;
  const qn = asString(row && row.quality_name).toLowerCase();
  return qn.includes("stattrak");
}

function describeRecipe({rarity, stattrak}) {
  const from = RARITY_NAME_MAP[rarity] || `R${rarity}`;
  const to = RARITY_NAME_MAP[rarity + 1] || `R${rarity + 1}`;
  const prefix = stattrak ? "StatTrak " : "";
  return `Trade-Up: 10x ${prefix}${from} -> 1x ${prefix}${to}`;
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
  const unlockTs = parseTradableAfterTs(row && row.tradable_after);
  return unlockTs > Math.floor(Date.now() / 1000);
}

function resolveTradeUpRecipe(rows, {allowCooling = false} = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length !== 10) {
    throw badRequest(`汰换需要正好 10 件物品，当前为 ${list.length} 件`);
  }

  const badInComponent = list.find((row) => asString(row.casket_id).trim());
  if (badInComponent) {
    throw badRequest("仅支持主库存物品参与汰换");
  }

  const hiddenRow = list.find((row) => asString(row && row.hidden_reason).trim());
  if (hiddenRow) {
    const reason = asString(hiddenRow.hidden_reason).trim();
    throw badRequest(`隐藏条目不可参与汰换：${reason}`);
  }

  const notCraftable = list.find((row) => !row || row.is_craftable === false);
  if (notCraftable) {
    const reason = asString(notCraftable && notCraftable.craftable_reason).trim() || "unknown";
    throw badRequest(`存在不可汰换物品：${reason}`);
  }

  if (!allowCooling) {
    const coolingRow = list.find((row) => isCoolingRow(row));
    if (coolingRow) {
      const itemId = asString(coolingRow.asset_id).trim() || "-";
      throw badRequest(`存在冷却中的物品，未开启“使用冷却中的物品”：${itemId}`);
    }
  }

  const raritySet = new Set(list.map((row) => toInt(row && row.rarity, 0)));
  if (raritySet.size !== 1) {
    throw badRequest("汰换物品稀有度必须一致");
  }
  const rarity = Array.from(raritySet)[0];
  if (rarity < 1 || rarity > 5) {
    throw badRequest(`当前稀有度不支持汰换：${rarity}`);
  }

  const stSet = new Set(list.map((row) => (isStatTrakRow(row) ? 1 : 0)));
  if (stSet.size !== 1) {
    throw badRequest("汰换物品必须全部同为 StatTrak 或全部普通");
  }
  const stattrak = Array.from(stSet)[0] === 1;
  const recipe = stattrak ? rarity + 9 : rarity - 1;
  return {
    recipe,
    rarity,
    stattrak,
    recipe_name: describeRecipe({rarity, stattrak})
  };
}

function makeRows(csgo, schemaStore) {
  const schema = schemaStore.load();
  const raw = Array.isArray(csgo && csgo.inventory) ? [...csgo.inventory] : [];
  const parsed = parseInventory(raw, schema, {includeHidden: true});
  return parsed.rows || [];
}

function buildRowMap(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = asString(row && row.asset_id).trim();
    if (key && !map.has(key)) {
      map.set(key, row);
    }
  }
  return map;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function dedupIds(ids) {
  const out = new Set();
  for (const raw of Array.isArray(ids) ? ids : []) {
    const key = normalizeAssetId(raw);
    if (key) {
      out.add(key);
    }
  }
  return [...out];
}

function analyzeCraftRows(rows, {spentIds, gainedIds}) {
  const rowMap = buildRowMap(rows);
  const spentRemaining = [];
  const gainedPresent = [];
  for (const id of Array.isArray(spentIds) ? spentIds : []) {
    if (rowMap.has(id)) {
      spentRemaining.push(id);
    }
  }
  for (const id of Array.isArray(gainedIds) ? gainedIds : []) {
    if (rowMap.has(id)) {
      gainedPresent.push(id);
    }
  }
  return {spentRemaining, gainedPresent};
}

async function waitRowsSettledAfterCraft({
  csgo,
  schemaStore,
  spentIds,
  gainedIds,
  timeoutMs = 12000,
  pollMs = 220
}) {
  const expectedSpent = dedupIds(spentIds);
  const expectedGained = dedupIds(gainedIds);
  const timeout = Math.max(1000, Number(timeoutMs) || 12000);
  const interval = Math.max(80, Number(pollMs) || 220);
  const deadline = Date.now() + timeout;
  let attempts = 0;
  let rows = [];
  let state = {
    spentRemaining: [...expectedSpent],
    gainedPresent: []
  };

  while (true) {
    attempts += 1;
    rows = makeRows(csgo, schemaStore);
    state = analyzeCraftRows(rows, {
      spentIds: expectedSpent,
      gainedIds: expectedGained
    });
    const spentSettled = state.spentRemaining.length === 0;
    const gainedSettled = expectedGained.length === 0 || state.gainedPresent.length === expectedGained.length;
    if (spentSettled && gainedSettled) {
      return {
        settled: true,
        attempts,
        rows,
        spent_remaining_ids: state.spentRemaining,
        gained_present_ids: state.gainedPresent,
        missing_gained_ids: expectedGained.filter((id) => !state.gainedPresent.includes(id))
      };
    }
    if (Date.now() >= deadline) {
      return {
        settled: false,
        attempts,
        rows,
        spent_remaining_ids: state.spentRemaining,
        gained_present_ids: state.gainedPresent,
        missing_gained_ids: expectedGained.filter((id) => !state.gainedPresent.includes(id))
      };
    }
    await sleep(interval);
  }
}

function waitCraftingComplete(csgo, recipe, itemIds, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let done = false;
    let timer = null;

    function cleanup() {
      if (timer) clearTimeout(timer);
      csgo.off("craftingComplete", onCraftingComplete);
    }

    function finish(err, payload) {
      if (done) return;
      done = true;
      cleanup();
      if (err) reject(err);
      else resolve(payload);
    }

    function onCraftingComplete(blueprint, itemsGained) {
      const gained = Array.isArray(itemsGained) ? itemsGained.map((x) => asString(x).trim()).filter(Boolean) : [];
      finish(null, {
        blueprint: toInt(blueprint, -1),
        gained_ids: gained
      });
    }

    timer = setTimeout(() => {
      finish(new Error("汰换超时：未收到 craftingComplete"));
    }, Math.max(1000, Number(timeoutMs) || 30000));

    csgo.on("craftingComplete", onCraftingComplete);
    try {
      csgo.craft(itemIds, recipe);
    } catch (err) {
      finish(err);
    }
  });
}

function createCraftService({sessionPool, logger}) {
  if (!sessionPool) {
    throw new Error("sessionPool is required");
  }

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

  async function runTradeUp({username, password, itemIds, allowCooling = false}) {
    return runTradeUpBatch({username, password, itemIds, allowCooling});
  }

  async function runTradeUpBatch({username, password, itemIds, recipes, allowCooling = false}) {
    const recipeRequests = normalizeRecipeRequests({itemIds, recipes});
    const {accountName, csgo} = await acquireContext({username, password});

    return withAccountLock(accountName, async () => {
      const schemaStore = new SchemaStore();
      let rows = makeRows(csgo, schemaStore);
      const steps = [];

      for (let i = 0; i < recipeRequests.length; i += 1) {
        const req = recipeRequests[i];
        try {
          const rowMap = buildRowMap(rows);
          const selectedRows = [];
          const missingIds = [];
          for (const id of req.item_ids) {
            const row = rowMap.get(id);
            if (!row) {
              missingIds.push(id);
              continue;
            }
            selectedRows.push(row);
          }
          if (missingIds.length) {
            throw badRequest(
              `第${req.index}组部分物品未在当前库存中找到：${missingIds.slice(0, 5).join(",")}${missingIds.length > 5 ? "..." : ""}`
            );
          }

          const recipeInfo = resolveTradeUpRecipe(selectedRows, {allowCooling});
          if (logger) {
            logger.info(
              "craft_ops",
              `tradeup start: account=${accountName} step=${req.index}/${recipeRequests.length} recipe=${recipeInfo.recipe} ids=${req.item_ids.join(",")}`
            );
          }

          const craftResult = await waitCraftingComplete(csgo, recipeInfo.recipe, req.item_ids, 35000);
          if (toInt(craftResult.blueprint, -1) < 0) {
            const err = new Error(`第${req.index}组汰换失败：GC 返回 blueprint=-1`);
            err.code = "tradeup_failed";
            throw err;
          }

          const settle = await waitRowsSettledAfterCraft({
            csgo,
            schemaStore,
            spentIds: req.item_ids,
            gainedIds: craftResult.gained_ids || [],
            timeoutMs: 12000,
            pollMs: 220
          });
          rows = settle.rows;

          const step = {
            index: req.index,
            total: recipeRequests.length,
            recipe: recipeInfo.recipe,
            recipe_name: recipeInfo.recipe_name,
            rarity: recipeInfo.rarity,
            stattrak: recipeInfo.stattrak,
            spent_ids: [...req.item_ids],
            gained_ids: craftResult.gained_ids || [],
            still_exists_ids: settle.spent_remaining_ids || [],
            gained_present_ids: settle.gained_present_ids || [],
            missing_gained_ids: settle.missing_gained_ids || [],
            inventory_settled: !!settle.settled,
            settle_attempts: toInt(settle.attempts, 0)
          };
          steps.push(step);
          if (logger && !step.inventory_settled) {
            logger.warn(
              "craft_ops",
              `tradeup inventory not fully settled: account=${accountName} step=${req.index}/${recipeRequests.length} missing_gained=${step.missing_gained_ids.join(",")} still_exists=${step.still_exists_ids.join(",")} attempts=${step.settle_attempts}`
            );
          }
          if (logger) {
            logger.info(
              "craft_ops",
              `tradeup done: account=${accountName} step=${req.index}/${recipeRequests.length} recipe=${recipeInfo.recipe} gained=${step.gained_ids.join(",")} gained_present=${step.gained_present_ids.length}/${step.gained_ids.length} still_exists=${step.still_exists_ids.length} settled=${step.inventory_settled} attempts=${step.settle_attempts}`
            );
          }
        } catch (err) {
          const isBad = err && err.code === "bad_request";
          const normalized = err instanceof Error ? err : new Error(asString(err));
          if (!isBad) {
            const message = asString(normalized.message || "").trim();
            if (!message.startsWith(`第${req.index}组`)) {
              normalized.message = `第${req.index}组汰换失败：${message || "未知错误"}`;
            }
            if (!normalized.code) {
              normalized.code = "tradeup_failed";
            }
          }

          const shouldAttachPayload = steps.length > 0 || !isBad;
          if (shouldAttachPayload) {
            // 中途失败时也落快照，保证前端可立即对账并续跑剩余队列。
            const snapshot = saveRowsSnapshot({accountName, rows});
            normalized.craft_payload = {
              ok: false,
              partial: true,
              account: accountName,
              recipe_count: recipeRequests.length,
              allow_cooling: !!allowCooling,
              completed_steps: steps,
              failed_step: req.index,
              fetch_time: snapshot.fetchTime,
              snapshot_path: snapshot.snapshotPath,
              rows
            };
          }
          throw normalized;
        }
      }

      const snapshot = saveRowsSnapshot({accountName, rows});
      const gainedCount = steps.reduce(
        (sum, step) => sum + (Array.isArray(step.gained_ids) ? step.gained_ids.length : 0),
        0
      );
      const message =
        recipeRequests.length === 1
          ? `汰换完成：消耗10件，获得${gainedCount}件`
          : `汰换完成：共执行${recipeRequests.length}组，获得${gainedCount}件`;
      const firstStep = steps[0] || {};

      return {
        ok: true,
        account: accountName,
        recipe_count: recipeRequests.length,
        allow_cooling: !!allowCooling,
        recipe: toInt(firstStep.recipe, 0),
        recipe_name: asString(firstStep.recipe_name),
        rarity: toInt(firstStep.rarity, 0),
        stattrak: !!firstStep.stattrak,
        spent_ids: Array.isArray(firstStep.spent_ids) ? firstStep.spent_ids : [],
        gained_ids: Array.isArray(firstStep.gained_ids) ? firstStep.gained_ids : [],
        still_exists_ids: Array.isArray(firstStep.still_exists_ids) ? firstStep.still_exists_ids : [],
        steps,
        fetch_time: snapshot.fetchTime,
        snapshot_path: snapshot.snapshotPath,
        rows,
        message
      };
    });
  }

  return {
    runTradeUp,
    runTradeUpBatch
  };
}

module.exports = {
  createCraftService
};
