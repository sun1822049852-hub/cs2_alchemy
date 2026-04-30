const assert = require("node:assert/strict");

const {createMarketListingFromGcService} = require("../src/services/marketListingFromGcService");

function createService() {
  return createMarketListingFromGcService({logger: null});
}

function makeRow({assetId, casketId = "", name = "Item", marketHashName = "Item"}) {
  return {
    asset_id: String(assetId),
    casket_id: String(casketId || ""),
    name,
    market_hash_name: marketHashName
  };
}

async function test_main_inventory_items_sell_without_withdraw() {
  const service = createService();
  const withdrawCalls = [];
  const sellCalls = [];

  const result = await service.runMarketListingFromGc({
    username: "wy19174601720",
    password: "secret",
    webSession: {
      cookieString: "steamLoginSecure=abc",
      sessionid: "sess",
      steamId64: "76561198761816081"
    },
    items: [
      {
        assetId: "main-1",
        priceInCents: 123,
        currency: 23,
        marketHashName: "AK-47 | Redline (Field-Tested)",
        name: "AK-47 | Redline (Field-Tested)"
      }
    ],
    componentOpsService: {
      async runMove(args) {
        withdrawCalls.push(args);
        throw new Error("main inventory path should not call withdraw");
      }
    },
    sellItem: async (args) => {
      sellCalls.push(args);
      return {success: true, message: "ok", requiresConfirmation: true};
    },
    sleepFn: async () => {}
  });

  assert.equal(withdrawCalls.length, 0);
  assert.equal(sellCalls.length, 1);
  assert.equal(sellCalls[0].assetId, "main-1");
  assert.equal(result.successCount, 1);
  assert.equal(result.failCount, 0);
  assert.equal(result.results[0].success, true);
}

async function test_component_items_are_grouped_then_sold_in_original_order() {
  const service = createService();
  const withdrawCalls = [];
  const sellCalls = [];

  const result = await service.runMarketListingFromGc({
    username: "wy19174601720",
    password: "secret",
    webSession: {
      cookieString: "steamLoginSecure=abc",
      sessionid: "sess",
      steamId64: "76561198761816081"
    },
    items: [
      {
        assetId: "component-1",
        priceInCents: 111,
        currency: 23,
        marketHashName: "P90 | Straight Dimes (Field-Tested)",
        name: "P90 | Straight Dimes (Field-Tested)",
        sourceScope: "component",
        sourceComponentId: "box-1",
        sourceComponentName: "炼金材料1"
      },
      {
        assetId: "main-1",
        priceInCents: 222,
        currency: 23,
        marketHashName: "AK-47 | Redline (Field-Tested)",
        name: "AK-47 | Redline (Field-Tested)"
      },
      {
        assetId: "component-2",
        priceInCents: 333,
        currency: 23,
        marketHashName: "P250 | Small Game (Minimal Wear)",
        name: "P250 | Small Game (Minimal Wear)",
        sourceScope: "component",
        sourceComponentId: "box-1",
        sourceComponentName: "炼金材料1"
      }
    ],
    componentOpsService: {
      async runMove(args) {
        withdrawCalls.push(args);
        return {
          rows: [
            makeRow({assetId: "component-1"}),
            makeRow({assetId: "component-2"}),
            makeRow({assetId: "main-1"})
          ],
          op: {
            success_ids: ["component-1", "component-2"],
            failed: []
          }
        };
      }
    },
    sellItem: async (args) => {
      sellCalls.push(args);
      return {success: true, message: "ok", requiresConfirmation: false};
    },
    sleepFn: async () => {}
  });

  assert.equal(withdrawCalls.length, 1);
  assert.deepEqual(withdrawCalls[0].itemIds, ["component-1", "component-2"]);
  assert.deepEqual(sellCalls.map((call) => call.assetId), ["component-1", "main-1", "component-2"]);
  assert.equal(result.successCount, 3);
  assert.equal(result.failCount, 0);
}

async function test_partial_withdraw_failure_only_sells_verified_items() {
  const service = createService();
  const sellCalls = [];

  const result = await service.runMarketListingFromGc({
    username: "wy19174601720",
    password: "secret",
    webSession: {
      cookieString: "steamLoginSecure=abc",
      sessionid: "sess",
      steamId64: "76561198761816081"
    },
    items: [
      {
        assetId: "component-ok",
        priceInCents: 111,
        currency: 23,
        marketHashName: "P90 | Straight Dimes (Field-Tested)",
        name: "P90 | Straight Dimes (Field-Tested)",
        sourceScope: "component",
        sourceComponentId: "box-1",
        sourceComponentName: "炼金材料1"
      },
      {
        assetId: "component-fail",
        priceInCents: 222,
        currency: 23,
        marketHashName: "P250 | Small Game (Minimal Wear)",
        name: "P250 | Small Game (Minimal Wear)",
        sourceScope: "component",
        sourceComponentId: "box-1",
        sourceComponentName: "炼金材料1"
      }
    ],
    componentOpsService: {
      async runMove() {
        return {
          rows: [
            makeRow({assetId: "component-ok"})
          ],
          op: {
            success_ids: ["component-ok"],
            failed: [{item_id: "component-fail", reason: "主库存空间不足"}]
          }
        };
      }
    },
    sellItem: async (args) => {
      sellCalls.push(args);
      return {success: true, message: "ok", requiresConfirmation: false};
    },
    sleepFn: async () => {}
  });

  assert.deepEqual(sellCalls.map((call) => call.assetId), ["component-ok"]);
  assert.equal(result.successCount, 1);
  assert.equal(result.failCount, 1);
  const failed = result.results.find((entry) => entry.assetId === "component-fail");
  assert.equal(failed.success, false);
  assert.equal(failed.code, "withdraw_failed");
}

async function test_reconcile_failure_blocks_sell_when_asset_missing_or_still_in_component() {
  const service = createService();
  const sellCalls = [];

  const result = await service.runMarketListingFromGc({
    username: "wy19174601720",
    password: "secret",
    webSession: {
      cookieString: "steamLoginSecure=abc",
      sessionid: "sess",
      steamId64: "76561198761816081"
    },
    items: [
      {
        assetId: "missing-after-withdraw",
        priceInCents: 111,
        currency: 23,
        marketHashName: "P90 | Straight Dimes (Field-Tested)",
        name: "P90 | Straight Dimes (Field-Tested)",
        sourceScope: "component",
        sourceComponentId: "box-1",
        sourceComponentName: "炼金材料1"
      },
      {
        assetId: "still-in-component",
        priceInCents: 222,
        currency: 23,
        marketHashName: "P250 | Small Game (Minimal Wear)",
        name: "P250 | Small Game (Minimal Wear)",
        sourceScope: "component",
        sourceComponentId: "box-1",
        sourceComponentName: "炼金材料1"
      }
    ],
    componentOpsService: {
      async runMove() {
        return {
          rows: [
            makeRow({assetId: "still-in-component", casketId: "box-1"})
          ],
          op: {
            success_ids: ["missing-after-withdraw", "still-in-component"],
            failed: []
          }
        };
      }
    },
    sellItem: async (args) => {
      sellCalls.push(args);
      return {success: true, message: "ok", requiresConfirmation: false};
    },
    sleepFn: async () => {}
  });

  assert.equal(sellCalls.length, 0);
  assert.equal(result.successCount, 0);
  assert.equal(result.failCount, 2);
  const missing = result.results.find((entry) => entry.assetId === "missing-after-withdraw");
  const stillInComponent = result.results.find((entry) => entry.assetId === "still-in-component");
  assert.equal(missing.code, "asset_id_reconcile_failed");
  assert.equal(stillInComponent.code, "asset_id_reconcile_failed");
}

async function test_storage_unit_and_missing_name_are_rejected_before_sell() {
  const service = createService();
  const sellCalls = [];

  const result = await service.runMarketListingFromGc({
    username: "wy19174601720",
    password: "secret",
    webSession: {
      cookieString: "steamLoginSecure=abc",
      sessionid: "sess",
      steamId64: "76561198761816081"
    },
    items: [
      {
        assetId: "storage-unit",
        priceInCents: 111,
        currency: 23,
        marketHashName: "Storage Unit",
        name: "Storage Unit (炼金材料1)"
      },
      {
        assetId: "missing-name",
        priceInCents: 222,
        currency: 23
      }
    ],
    componentOpsService: {
      async runMove() {
        throw new Error("invalid items should not call withdraw");
      }
    },
    sellItem: async (args) => {
      sellCalls.push(args);
      return {success: true, message: "ok", requiresConfirmation: false};
    },
    sleepFn: async () => {}
  });

  assert.equal(sellCalls.length, 0);
  assert.equal(result.successCount, 0);
  assert.equal(result.failCount, 2);
  const storageUnit = result.results.find((entry) => entry.assetId === "storage-unit");
  const missingName = result.results.find((entry) => entry.assetId === "missing-name");
  assert.equal(storageUnit.code, "storage_unit_not_supported");
  assert.equal(missingName.code, "market_name_missing");
}

async function main() {
  await test_main_inventory_items_sell_without_withdraw();
  await test_component_items_are_grouped_then_sold_in_original_order();
  await test_partial_withdraw_failure_only_sells_verified_items();
  await test_reconcile_failure_blocks_sell_when_asset_missing_or_still_in_component();
  await test_storage_unit_and_missing_name_are_rejected_before_sell();
  console.log("market-listing-from-gc-service tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
