const {asString} = require("../utils");
const {estimateMainInventoryFreeSlots} = require("./craftCandidateService");

const MAIN_INVENTORY_CAPACITY = 1000;
const MAX_RECIPE_COUNT = 50;

function badRequest(message) {
  const err = new Error(message);
  err.code = "bad_request";
  return err;
}

function normalizeAssetId(value) {
  return asString(value).trim();
}

function buildRowMap(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = normalizeAssetId(row && row.asset_id);
    if (id && !map.has(id)) map.set(id, row);
  }
  return map;
}

function countMainFreeSlots(rows) {
  // Execution must reuse the same withdrawable-budget calculation as the
  // candidate-selection stage. Otherwise the UI may show hundreds of items as
  // "实际可从组件中取出", while execution blocks with a much smaller number.
  const info = estimateMainInventoryFreeSlots(rows);
  return Math.max(0, Number(info && info.freeSlots) || 0);
}

function normalizeItemSources(rawSources, itemIds) {
  const out = {};
  const sourceMap = rawSources && typeof rawSources === "object" ? rawSources : {};
  for (const id of itemIds) {
    const raw = sourceMap[id] && typeof sourceMap[id] === "object" ? sourceMap[id] : {};
    const sourceScope = asString(raw.source_scope).trim().toLowerCase() === "component" ? "component" : "main";
    const sourceComponentId = sourceScope === "component" ? asString(raw.source_component_id).trim() : "";
    out[id] = {
      source_scope: sourceScope,
      source_component_id: sourceComponentId,
      source_component_name: sourceScope === "component" ? asString(raw.source_component_name).trim() : ""
    };
  }
  return out;
}

function normalizeRecipes(recipes) {
  const list = Array.isArray(recipes) ? recipes : [];
  if (!list.length) throw badRequest("recipes 不能为空");
  if (list.length > MAX_RECIPE_COUNT) {
    throw badRequest(`单次最多执行 ${MAX_RECIPE_COUNT} 组配方，当前为 ${list.length} 组`);
  }
  const globalSeen = new Map();
  return list.map((entry, index) => {
    const recipeNo = index + 1;
    const queueIndexRaw = Number(entry && entry.queue_index);
    const queueIndex = Number.isFinite(queueIndexRaw) ? Math.max(0, Math.trunc(queueIndexRaw)) : index;
    const idsRaw = Array.isArray(entry && entry.item_ids) ? entry.item_ids : [];
    if (idsRaw.length !== 10) {
      throw badRequest(`第${recipeNo}组需要正好 10 件物品，当前为 ${idsRaw.length} 件`);
    }
    const seen = new Set();
    const itemIds = [];
    for (const rawId of idsRaw) {
      const id = normalizeAssetId(rawId);
      if (!id) throw badRequest(`第${recipeNo}组存在无效物品 ID`);
      if (seen.has(id)) throw badRequest(`第${recipeNo}组存在重复物品：${id}`);
      if (globalSeen.has(id)) {
        throw badRequest(`物品不能重复用于多组配方：${id}（第${globalSeen.get(id)}组与第${recipeNo}组冲突）`);
      }
      seen.add(id);
      globalSeen.set(id, recipeNo);
      itemIds.push(id);
    }
    return {
      index: recipeNo,
      queue_index: queueIndex,
      item_ids: itemIds,
      item_sources: normalizeItemSources(entry && entry.item_sources, itemIds)
    };
  });
}

function normalizeRowsPayload(payload) {
  if (Array.isArray(payload)) {
    return {
      rows: payload,
      fetch_time: "",
      snapshot_path: ""
    };
  }
  const obj = payload && typeof payload === "object" ? payload : {};
  return {
    rows: Array.isArray(obj.rows) ? obj.rows : [],
    fetch_time: asString(obj.fetch_time).trim(),
    snapshot_path: asString(obj.snapshot_path).trim()
  };
}

function buildItemSourcesFromRows(itemIds, rowMap) {
  const map = rowMap instanceof Map ? rowMap : new Map();
  const out = {};
  for (const itemId of Array.isArray(itemIds) ? itemIds : []) {
    const key = normalizeAssetId(itemId);
    if (!key) continue;
    const row = map.get(key);
    const componentId = asString(row && row.casket_id).trim();
    out[key] = componentId
      ? {
          source_scope: "component",
          source_component_id: componentId,
          source_component_name: componentId
        }
      : {
          source_scope: "main",
          source_component_id: "",
          source_component_name: ""
        };
  }
  return out;
}

function buildPrepareEntry(recipe, status, prepareMessage, itemSources = null, prepareStatus = "") {
  return {
    queue_index: recipe.queue_index,
    item_ids: [...recipe.item_ids],
    item_sources: itemSources && typeof itemSources === "object" ? {...itemSources} : {...recipe.item_sources},
    status,
    prepare_status: asString(prepareStatus).trim() || (status === "ready" ? "ready" : "failed"),
    prepare_message: asString(prepareMessage).trim()
  };
}

function buildReadyRecipePayload(recipe, rowMap) {
  return {
    queue_index: recipe.queue_index,
    item_ids: [...recipe.item_ids],
    item_sources: buildItemSourcesFromRows(recipe.item_ids, rowMap)
  };
}

function buildMessage({readyCount, failedCount}) {
  if (readyCount > 0 && failedCount > 0) {
    return `组件取料完成：可执行${readyCount}组，跳过${failedCount}组`;
  }
  if (readyCount > 0) {
    return `组件取料完成：可执行${readyCount}组`;
  }
  return `组件取料失败：0组可执行，跳过${failedCount}组`;
}

function attachQueueIndexesToSteps(steps, readyRecipes) {
  const list = Array.isArray(steps) ? steps : [];
  return list.map((step, index) => ({
    ...step,
    queue_index: readyRecipes[index] ? readyRecipes[index].queue_index : index
  }));
}

function createCraftTradeupWithComponentsService({
  loadRowsForAccount,
  componentOpsService,
  craftService,
  logger
}) {
  if (typeof loadRowsForAccount !== "function") {
    throw new Error("loadRowsForAccount is required");
  }
  if (!componentOpsService || typeof componentOpsService.runMove !== "function") {
    throw new Error("componentOpsService.runMove is required");
  }
  if (!craftService || typeof craftService.runTradeUpBatch !== "function") {
    throw new Error("craftService.runTradeUpBatch is required");
  }

  async function runTradeUpWithComponents({
    username,
    password,
    recipes,
    allowCooling = false,
    prepareOnly = false,
    onProgress,
    shouldPause
  }) {
    const accountName = asString(username).trim();
    if (!accountName) throw badRequest("username 不能为空");
    const recipeRequests = normalizeRecipes(recipes);
    const progressCb = typeof onProgress === "function" ? onProgress : null;
    const pauseCheck = typeof shouldPause === "function" ? shouldPause : null;
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
          recipe_count: recipeRequests.length,
          ...payload
        });
      } catch (_) {
        // ignore progress callback errors
      }
    }
    const initialPayload = normalizeRowsPayload(await loadRowsForAccount({username: accountName, password}));
    let currentRows = initialPayload.rows;
    let fetchTime = initialPayload.fetch_time;
    let snapshotPath = initialPayload.snapshot_path;
    let rowMap = buildRowMap(currentRows);

    const componentNeededIds = new Set();
    const componentGroups = new Map();
    for (const recipe of recipeRequests) {
      for (const itemId of recipe.item_ids) {
        const row = rowMap.get(itemId);
        const componentId = asString(row && row.casket_id).trim();
        if (!componentId) continue;
        componentNeededIds.add(itemId);
        if (!componentGroups.has(componentId)) componentGroups.set(componentId, []);
        componentGroups.get(componentId).push(itemId);
      }
    }

    const mainFreeSlots = countMainFreeSlots(currentRows);
    if (componentNeededIds.size > mainFreeSlots) {
      return {
        ok: false,
        reason: "main_inventory_space_insufficient",
        message: `主库存可用槽位不足：需取出${componentNeededIds.size}件，当前仅${mainFreeSlots}格`,
        free_slots: mainFreeSlots,
        required_component_items: componentNeededIds.size,
        recipe_count: recipeRequests.length,
        prepare_results: recipeRequests.map((recipe) => ({
          queue_index: recipe.queue_index,
          status: "pending",
          prepare_status: "pending",
          prepare_message: ""
        })),
        withdraw_results: [],
        steps: [],
        rows: currentRows,
        fetch_time: fetchTime,
        snapshot_path: snapshotPath
      };
    }

    const withdrawResults = [];
    const itemFailureMap = new Map();
    const totalPrepareItems = componentNeededIds.size;
    let prepareProcessed = 0;
    let prepareSuccess = 0;
    let prepareFailed = 0;
    let preparePaused = false;
    emitProgress({
      stage: "prepare",
      phase: "start",
      processed: 0,
      total: totalPrepareItems,
      success: 0,
      failed: 0
    });
    const orderedComponentIds = [...componentGroups.keys()].sort((a, b) => a.localeCompare(b));
    for (const componentId of orderedComponentIds) {
      if (isPauseRequested()) {
        preparePaused = true;
        break;
      }
      const itemIds = Array.from(new Set(componentGroups.get(componentId) || []));
      if (!itemIds.length) continue;
      const baseProcessed = prepareProcessed;
      const baseSuccess = prepareSuccess;
      const baseFailed = prepareFailed;
      try {
        const payload = await componentOpsService.runMove({
          action: "withdraw",
          username: accountName,
          password,
          componentId,
          itemIds,
          shouldPause: isPauseRequested,
          onProgress: (progress) => {
            if (asString(progress && progress.phase).trim() !== "item") return;
            emitProgress({
              stage: "prepare",
              phase: "item",
              processed: Math.max(0, baseProcessed + (Number(progress && progress.processed) || 0)),
              total: totalPrepareItems,
              success: Math.max(0, baseSuccess + (Number(progress && progress.success) || 0)),
              failed: Math.max(0, baseFailed + (Number(progress && progress.failed) || 0)),
              component_id: componentId,
              item_id: normalizeAssetId(progress && progress.item_id),
              item_status: asString(progress && progress.item_status).trim(),
              reason: asString(progress && progress.reason).trim()
            });
          }
        });
        const op = payload && typeof payload === "object" ? payload.op || {} : {};
        const successIds = Array.isArray(op.success_ids) ? op.success_ids.map((id) => normalizeAssetId(id)).filter(Boolean) : [];
        const failed = Array.isArray(op.failed)
          ? op.failed.map((entry) => ({
              item_id: normalizeAssetId(entry && entry.item_id),
              reason: asString(entry && entry.reason).trim() || "未知错误"
            }))
          : [];
        withdrawResults.push({
          component_id: componentId,
          success_ids: successIds,
          failed
        });
        const normalizedPayload = normalizeRowsPayload(payload);
        if (normalizedPayload.rows.length) currentRows = normalizedPayload.rows;
        if (normalizedPayload.fetch_time) fetchTime = normalizedPayload.fetch_time;
        if (normalizedPayload.snapshot_path) snapshotPath = normalizedPayload.snapshot_path;
        rowMap = buildRowMap(currentRows);
        for (const failedEntry of failed) {
          if (failedEntry.item_id) itemFailureMap.set(failedEntry.item_id, failedEntry.reason);
        }
        prepareProcessed += Math.max(itemIds.length, successIds.length + failed.length);
        prepareSuccess += successIds.length;
        prepareFailed += failed.length;
        if (op.paused) {
          preparePaused = true;
          break;
        }
      } catch (err) {
        const message = asString(err && err.message ? err.message : err).trim() || "组件取出失败";
        withdrawResults.push({
          component_id: componentId,
          success_ids: [],
          failed: itemIds.map((itemId) => ({item_id: itemId, reason: message}))
        });
        for (const itemId of itemIds) {
          itemFailureMap.set(itemId, message);
        }
        prepareProcessed += itemIds.length;
        prepareFailed += itemIds.length;
      }
    }

    rowMap = buildRowMap(currentRows);
    const prepareResults = [];
    const readyRecipes = [];
    let pausedRecipeCount = 0;
    let failedRecipeCount = 0;
    for (const recipe of recipeRequests) {
      let failureReason = "";
      let pendingByPause = false;
      for (const itemId of recipe.item_ids) {
        const row = rowMap.get(itemId);
        if (!row) {
          const itemFailure = itemFailureMap.get(itemId) || "";
          if (itemFailure) {
            failureReason = itemFailure;
          } else if (preparePaused) {
            pendingByPause = true;
          } else {
            failureReason = `物品不在当前库存中：${itemId}`;
          }
          break;
        }
        const componentId = asString(row.casket_id).trim();
        if (componentId) {
          const itemFailure = itemFailureMap.get(itemId) || "";
          if (itemFailure) {
            failureReason = itemFailure;
          } else if (preparePaused) {
            pendingByPause = true;
          } else {
            failureReason = `物品仍在组件 ${componentId}`;
          }
          break;
        }
      }
      const currentSources = buildItemSourcesFromRows(recipe.item_ids, rowMap);
      if (failureReason) {
        prepareResults.push(buildPrepareEntry(recipe, "prepare_failed", `组件取出失败，已跳过：${failureReason}`, currentSources, "failed"));
        failedRecipeCount += 1;
        continue;
      }
      if (preparePaused && pendingByPause) {
        const hasRemainingComponentItems = recipe.item_ids.some((itemId) => {
          const row = rowMap.get(itemId);
          return !!asString(row && row.casket_id).trim();
        });
        if (hasRemainingComponentItems) {
          prepareResults.push(buildPrepareEntry(recipe, "pending", "已暂停，等待继续", currentSources, "paused"));
          pausedRecipeCount += 1;
          continue;
        }
      }
      prepareResults.push(buildPrepareEntry(recipe, "ready", "", currentSources, "ready"));
      readyRecipes.push(recipe);
    }

    emitProgress({
      stage: "prepare",
      phase: preparePaused ? "paused" : "done",
      processed: preparePaused ? prepareProcessed : prepareProcessed,
      total: totalPrepareItems,
      success: prepareSuccess,
      failed: prepareFailed,
      ready_recipe_count: readyRecipes.length,
      skipped_recipe_count: failedRecipeCount
    });

    if (preparePaused) {
      return {
        ok: false,
        paused: true,
        pause_stage: "prepare",
        partial: prepareSuccess > 0 || prepareFailed > 0,
        account: accountName,
        recipe_count: recipeRequests.length,
        ready_recipe_count: readyRecipes.length,
        skipped_recipe_count: failedRecipeCount,
        remaining_recipe_count: pausedRecipeCount,
        prepare_results: prepareResults,
        withdraw_results: withdrawResults,
        steps: [],
        rows: currentRows,
        fetch_time: fetchTime,
        snapshot_path: snapshotPath,
        message: `已暂停组件取料：可继续${readyRecipes.length}组，待继续${pausedRecipeCount}组${failedRecipeCount > 0 ? `，跳过${failedRecipeCount}组` : ""}`
      };
    }

    if (!readyRecipes.length) {
      return {
        ok: false,
        partial: prepareResults.some((entry) => entry.status === "prepare_failed"),
        account: accountName,
        recipe_count: recipeRequests.length,
        ready_recipe_count: 0,
        skipped_recipe_count: prepareResults.length,
        prepare_results: prepareResults,
        withdraw_results: withdrawResults,
        steps: [],
        rows: currentRows,
        fetch_time: fetchTime,
        snapshot_path: snapshotPath,
        message: buildMessage({readyCount: 0, failedCount: prepareResults.length})
      };
    }

    if (prepareOnly) {
      return {
        ok: true,
        partial: prepareResults.some((entry) => entry.status === "prepare_failed"),
        prepare_only: true,
        account: accountName,
        recipe_count: recipeRequests.length,
        ready_recipe_count: readyRecipes.length,
        skipped_recipe_count: prepareResults.length - readyRecipes.length,
        prepare_results: prepareResults,
        ready_recipes: readyRecipes.map((recipe) => buildReadyRecipePayload(recipe, rowMap)),
        withdraw_results: withdrawResults,
        steps: [],
        rows: currentRows,
        fetch_time: fetchTime,
        snapshot_path: snapshotPath,
        message: buildMessage({readyCount: readyRecipes.length, failedCount: prepareResults.length - readyRecipes.length})
      };
    }

    if (logger) {
      logger.info(
        "craft_component_ops",
        `prepare done: account=${accountName} total=${recipeRequests.length} ready=${readyRecipes.length} skipped=${prepareResults.length - readyRecipes.length}`
      );
    }

    try {
      const craftPayload = await craftService.runTradeUpBatch({
        username: accountName,
        password,
        recipes: readyRecipes.map((recipe) => ({
          queue_index: recipe.queue_index,
          item_ids: [...recipe.item_ids]
        })),
        allowCooling,
        shouldPause: isPauseRequested,
        onProgress: (progress) => {
          emitProgress({
            stage: "craft",
            phase: asString(progress && progress.phase).trim(),
            index: Math.max(0, Number(progress && progress.index) || 0),
            total: Math.max(0, Number(progress && progress.total) || 0),
            completed: Math.max(0, Number(progress && progress.completed) || 0),
            message: asString(progress && progress.message).trim()
          });
        }
      });
      return {
        ok: true,
        partial: prepareResults.some((entry) => entry.status === "prepare_failed"),
        account: asString(craftPayload && craftPayload.account).trim() || accountName,
        recipe_count: recipeRequests.length,
        ready_recipe_count: readyRecipes.length,
        skipped_recipe_count: prepareResults.length - readyRecipes.length,
        prepare_results: prepareResults,
        withdraw_results: withdrawResults,
        steps: attachQueueIndexesToSteps(craftPayload && craftPayload.steps, readyRecipes),
        rows: Array.isArray(craftPayload && craftPayload.rows) ? craftPayload.rows : currentRows,
        fetch_time: asString(craftPayload && craftPayload.fetch_time).trim() || fetchTime,
        snapshot_path: asString(craftPayload && craftPayload.snapshot_path).trim() || snapshotPath,
        message: buildMessage({readyCount: readyRecipes.length, failedCount: prepareResults.length - readyRecipes.length})
      };
    } catch (err) {
      if (err && err.craft_payload) {
        const payload = err.craft_payload;
        payload.prepare_results = prepareResults;
        payload.withdraw_results = withdrawResults;
        payload.ready_recipe_count = readyRecipes.length;
        payload.skipped_recipe_count = prepareResults.length - readyRecipes.length;
        payload.recipe_count = recipeRequests.length;
        payload.completed_steps = attachQueueIndexesToSteps(payload.completed_steps, readyRecipes);
      }
      throw err;
    }
  }

  return {
    runTradeUpWithComponents
  };
}

module.exports = {
  createCraftTradeupWithComponentsService
};
