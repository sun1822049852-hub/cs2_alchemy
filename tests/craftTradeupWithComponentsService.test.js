const assert = require("node:assert/strict");

const {
  createCraftTradeupWithComponentsService
} = require("../node_sidecar/src/services/craftTradeupWithComponentsService");

function makeRow({
  id,
  casketId = "",
  craftable = true,
  hiddenReason = "",
  tradableAfter = 0,
  rarity = 3,
  quality = 0,
  qualityName = "Normal"
}) {
  return {
    asset_id: String(id),
    casket_id: String(casketId || ""),
    is_craftable: craftable,
    hidden_reason: hiddenReason,
    tradable_after: tradableAfter,
    rarity,
    quality,
    quality_name: qualityName
  };
}

function makeMainRows(count, start = 1) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push(makeRow({id: start + i}));
  }
  return rows;
}

function buildRecipe(queueIndex, itemIds, componentMap = {}) {
  const sources = {};
  for (const id of itemIds) {
    const key = String(id);
    const componentId = componentMap[key] || "";
    sources[key] = componentId
      ? {
          source_scope: "component",
          source_component_id: String(componentId),
          source_component_name: `Box ${componentId}`
        }
      : {
          source_scope: "main",
          source_component_id: "",
          source_component_name: ""
        };
  }
  return {
    queue_index: queueIndex,
    item_ids: itemIds.map((id) => String(id)),
    item_sources: sources
  };
}

function cloneRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({...row}));
}

async function testRejectsWholeBatchBeforeWithdrawWhenMainSpaceIsInsufficient() {
  const withdrawCalls = [];
  const tradeupCalls = [];
  const rows = [
    ...makeMainRows(999, 2000),
    makeRow({id: 10001, casketId: "5001"}),
    makeRow({id: 10002, casketId: "5002"})
  ];
  const service = createCraftTradeupWithComponentsService({
    loadRowsForAccount: async () => ({rows: cloneRows(rows)}),
    componentOpsService: {
      runMove: async (payload) => {
        withdrawCalls.push(payload);
        return {ok: true, rows: cloneRows(rows), op: {success_ids: [], failed: []}};
      }
    },
    craftService: {
      runTradeUpBatch: async (payload) => {
        tradeupCalls.push(payload);
        return {ok: true, rows: cloneRows(rows), steps: []};
      }
    },
    logger: null
  });

  const result = await service.runTradeUpWithComponents({
    username: "demo",
    recipes: [
      buildRecipe(0, [10001, 2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008], {"10001": "5001"}),
      buildRecipe(1, [10002, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017], {"10002": "5002"})
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "main_inventory_space_insufficient");
  assert.equal(withdrawCalls.length, 0);
  assert.equal(tradeupCalls.length, 0);
}

async function testUsesRealAvailableWithdrawCapacityForHiddenAndCoolingRows() {
  const withdrawCalls = [];
  const tradeupCalls = [];
  const futureTs = Math.floor(Date.now() / 1000) + 86400;
  let workingRows = cloneRows([
    ...makeMainRows(998, 5000),
    makeRow({id: 59998, hiddenReason: "manual"}),
    makeRow({id: 59999, tradableAfter: futureTs}),
    makeRow({id: 13001, casketId: "8101"}),
    makeRow({id: 13002, casketId: "8102"})
  ]);
  const service = createCraftTradeupWithComponentsService({
    loadRowsForAccount: async () => ({rows: cloneRows(workingRows)}),
    componentOpsService: {
      runMove: async ({componentId, itemIds}) => {
        withdrawCalls.push({componentId, itemIds: [...itemIds]});
        for (const id of itemIds) {
          const row = workingRows.find((item) => String(item.asset_id) === String(id));
          if (row) row.casket_id = "";
        }
        return {
          ok: true,
          rows: cloneRows(workingRows),
          op: {
            success_ids: itemIds.map((id) => String(id)),
            failed: []
          }
        };
      }
    },
    craftService: {
      runTradeUpBatch: async (payload) => {
        tradeupCalls.push(payload);
        return {
          ok: true,
          account: payload.username,
          recipe_count: payload.recipes.length,
          steps: payload.recipes.map((recipe, index) => ({
            index: index + 1,
            spent_ids: [...recipe.item_ids],
            gained_ids: [`gain-${index + 1}`],
            missing_gained_ids: []
          })),
          rows: cloneRows(workingRows),
          fetch_time: "2026-03-22 13:00:00",
          snapshot_path: "snapshot-capacity.json"
        };
      }
    },
    logger: null
  });

  const result = await service.runTradeUpWithComponents({
    username: "demo",
    recipes: [
      buildRecipe(0, [13001, 5000, 5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008], {"13001": "8101"}),
      buildRecipe(1, [13002, 5009, 5010, 5011, 5012, 5013, 5014, 5015, 5016, 5017], {"13002": "8102"})
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(withdrawCalls.length, 2);
  assert.equal(tradeupCalls.length, 1);
  assert.deepEqual(tradeupCalls[0].recipes.map((entry) => entry.queue_index), [0, 1]);
}

async function testGroupedWithdrawRunsSeriallyAndSkipsFailedRecipes() {
  const withdrawCalls = [];
  const tradeupCalls = [];
  let workingRows = cloneRows([
    ...makeMainRows(970, 2000),
    makeRow({id: 10001, casketId: "5001"}),
    makeRow({id: 10002, casketId: "5002"}),
    makeRow({id: 10003, casketId: "5001"})
  ]);
  const service = createCraftTradeupWithComponentsService({
    loadRowsForAccount: async () => ({rows: cloneRows(workingRows)}),
    componentOpsService: {
      runMove: async ({componentId, itemIds}) => {
        withdrawCalls.push({componentId, itemIds: [...itemIds]});
        const successIds = [];
        const failed = [];
        for (const id of itemIds) {
          const row = workingRows.find((item) => String(item.asset_id) === String(id));
          if (!row) {
            failed.push({item_id: String(id), reason: "missing"});
            continue;
          }
          if (String(componentId) === "5002") {
            failed.push({item_id: String(id), reason: "mock withdraw fail"});
            continue;
          }
          row.casket_id = "";
          successIds.push(String(id));
        }
        return {
          ok: true,
          rows: cloneRows(workingRows),
          op: {success_ids: successIds, failed}
        };
      }
    },
    craftService: {
      runTradeUpBatch: async (payload) => {
        tradeupCalls.push({
          recipes: payload.recipes.map((recipe) => ({
            queue_index: recipe.queue_index,
            item_ids: [...recipe.item_ids]
          }))
        });
        return {
          ok: true,
          account: payload.username,
          recipe_count: payload.recipes.length,
          steps: payload.recipes.map((recipe, index) => ({
            index: index + 1,
            spent_ids: [...recipe.item_ids],
            gained_ids: [`gained-${recipe.queue_index}`],
            missing_gained_ids: []
          })),
          rows: cloneRows(workingRows),
          fetch_time: "2026-03-22 12:00:00",
          snapshot_path: "snapshot.json"
        };
      }
    },
    logger: null
  });

  const result = await service.runTradeUpWithComponents({
    username: "demo",
    recipes: [
      buildRecipe(0, [10001, 2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008], {"10001": "5001"}),
      buildRecipe(1, [10002, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017], {"10002": "5002"}),
      buildRecipe(2, [10003, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026], {"10003": "5001"})
    ]
  });

  assert.deepEqual(withdrawCalls.map((entry) => entry.componentId), ["5001", "5002"]);
  assert.deepEqual(tradeupCalls[0].recipes.map((entry) => entry.queue_index), [0, 2]);
  assert.equal(result.ok, true);
  assert.equal(result.prepare_results.find((entry) => entry.queue_index === 1).status, "prepare_failed");
}

async function testPrepareFailedRecipesStayReportedWhileReadyRecipesStillExecute() {
  const tradeupCalls = [];
  let workingRows = cloneRows([
    ...makeMainRows(980, 3000),
    makeRow({id: 11001, casketId: "6001"})
  ]);
  const service = createCraftTradeupWithComponentsService({
    loadRowsForAccount: async () => ({rows: cloneRows(workingRows)}),
    componentOpsService: {
      runMove: async ({itemIds}) => ({
        ok: true,
        rows: cloneRows(workingRows),
        op: {
          success_ids: [],
          failed: itemIds.map((id) => ({item_id: String(id), reason: "withdraw blocked"}))
        }
      })
    },
    craftService: {
      runTradeUpBatch: async (payload) => {
        tradeupCalls.push(payload);
        return {
          ok: true,
          account: payload.username,
          recipe_count: payload.recipes.length,
          steps: payload.recipes.map((recipe, index) => ({
            index: index + 1,
            spent_ids: [...recipe.item_ids],
            gained_ids: [`gain-${index + 1}`],
            missing_gained_ids: []
          })),
          rows: cloneRows(workingRows),
          fetch_time: "2026-03-22 12:30:00",
          snapshot_path: "snapshot-ready.json"
        };
      }
    },
    logger: null
  });

  const result = await service.runTradeUpWithComponents({
    username: "demo",
    recipes: [
      buildRecipe(0, [11001, 3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008], {"11001": "6001"}),
      buildRecipe(1, [3009, 3010, 3011, 3012, 3013, 3014, 3015, 3016, 3017, 3018])
    ]
  });

  assert.equal(tradeupCalls.length, 1);
  assert.deepEqual(tradeupCalls[0].recipes.map((entry) => entry.queue_index), [1]);
  const failedRecipe = result.prepare_results.find((entry) => entry.queue_index === 0);
  assert.equal(failedRecipe.status, "prepare_failed");
  assert.match(failedRecipe.prepare_message, /withdraw blocked/);
  assert.deepEqual(result.steps.map((step) => step.queue_index), [1]);
}

async function testEmitsPrepareAndCraftProgressEvents() {
  const events = [];
  let workingRows = cloneRows([
    ...makeMainRows(980, 4000),
    makeRow({id: 12001, casketId: "7001"})
  ]);
  const service = createCraftTradeupWithComponentsService({
    loadRowsForAccount: async () => ({rows: cloneRows(workingRows)}),
    componentOpsService: {
      runMove: async ({itemIds, onProgress}) => {
        if (typeof onProgress === "function") {
          onProgress({phase: "start", processed: 0, total: itemIds.length, success: 0, failed: 0});
        }
        for (const id of itemIds) {
          const row = workingRows.find((item) => String(item.asset_id) === String(id));
          if (row) row.casket_id = "";
        }
        if (typeof onProgress === "function") {
          onProgress({phase: "item", processed: itemIds.length, total: itemIds.length, success: itemIds.length, failed: 0});
        }
        return {
          ok: true,
          rows: cloneRows(workingRows),
          op: {
            success_ids: itemIds.map((id) => String(id)),
            failed: []
          }
        };
      }
    },
    craftService: {
      runTradeUpBatch: async (payload) => {
        if (typeof payload.onProgress === "function") {
          payload.onProgress({phase: "start", index: 1, total: 1, completed: 0});
          payload.onProgress({phase: "done", index: 1, total: 1, completed: 1});
        }
        return {
          ok: true,
          account: payload.username,
          recipe_count: payload.recipes.length,
          steps: payload.recipes.map((recipe, index) => ({
            index: index + 1,
            spent_ids: [...recipe.item_ids],
            gained_ids: [`gain-${index + 1}`],
            missing_gained_ids: []
          })),
          rows: cloneRows(workingRows),
          fetch_time: "2026-03-22 13:00:00",
          snapshot_path: "snapshot-progress.json"
        };
      }
    },
    logger: null
  });

  const result = await service.runTradeUpWithComponents({
    username: "demo",
    recipes: [
      buildRecipe(0, [12001, 4000, 4001, 4002, 4003, 4004, 4005, 4006, 4007, 4008], {"12001": "7001"})
    ],
    onProgress: (event) => {
      events.push({
        stage: String(event && event.stage || ""),
        phase: String(event && event.phase || ""),
        processed: Number(event && event.processed || 0),
        total: Number(event && event.total || 0)
      });
    }
  });

  assert.equal(result.ok, true);
  assert.equal(events.some((event) => event.stage === "prepare" && event.phase === "start"), true);
  assert.equal(events.some((event) => event.stage === "prepare" && event.phase === "item" && event.processed === 1 && event.total === 1), true);
  assert.equal(events.some((event) => event.stage === "prepare" && event.phase === "done"), true);
  assert.equal(events.some((event) => event.stage === "craft" && event.phase === "start"), true);
  assert.equal(events.some((event) => event.stage === "craft" && event.phase === "done"), true);
}

async function main() {
  await testRejectsWholeBatchBeforeWithdrawWhenMainSpaceIsInsufficient();
  await testUsesRealAvailableWithdrawCapacityForHiddenAndCoolingRows();
  await testGroupedWithdrawRunsSeriallyAndSkipsFailedRecipes();
  await testPrepareFailedRecipesStayReportedWhileReadyRecipesStillExecute();
  await testEmitsPrepareAndCraftProgressEvents();
  console.log("craftTradeupWithComponentsService tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
