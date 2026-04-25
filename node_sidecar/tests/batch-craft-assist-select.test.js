const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

function loadBatchCraftAssistSelect(overrides = {}) {
  const source = extractBlock(
    "async function callBatchCraftAssistSelectForAccount(",
    "async function runBatchCraftAssistSelect("
  );
  const context = {
    Math,
    Number,
    String,
    Boolean,
    Array,
    JSON,
    Date: overrides.Date || Date,
    state: overrides.state,
    getCraftRowsForAccount: overrides.getCraftRowsForAccount,
    normalizeCraftAssistFilterMode: overrides.normalizeCraftAssistFilterMode,
    parseOptionalWear01: overrides.parseOptionalWear01,
    normalizeCraftAssistMaterialsForRun: overrides.normalizeCraftAssistMaterialsForRun,
    craftAssistTargetCountFromMaterials: overrides.craftAssistTargetCountFromMaterials,
    api: overrides.api,
    normalizeCraftRecipeItemIds: overrides.normalizeCraftRecipeItemIds,
    console
  };
  vm.runInNewContext(`${source}\nthis.callBatchCraftAssistSelectForAccount = callBatchCraftAssistSelectForAccount;`, context, {filename: APP_PATH});
  return context;
}

async function test_batch_helper_uses_current_assist_route_contract({DateImpl}) {
  let capturedRequest = null;
  const app = loadBatchCraftAssistSelect({
    Date: DateImpl,
    state: {
      batchCraftUseComponentItems: true,
      batchCraftIncludeCooling: false,
      batchCraftFastMode: true,
      batchCraftApproachMode: true,
      batchCraftWearOffsetPct: 17
    },
    getCraftRowsForAccount(username) {
      assert.equal(username, "acc-a");
      return [{asset_id: "seed-1"}];
    },
    normalizeCraftAssistFilterMode(value) {
      return String(value || "").trim() === "absolute" ? "absolute" : "relative";
    },
    parseOptionalWear01(value) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    },
    normalizeCraftAssistMaterialsForRun({materials, targetWear, wearFilterMode}) {
      assert.equal(targetWear, 0.2142);
      assert.equal(wearFilterMode, "relative");
      return Array.isArray(materials) ? materials : [];
    },
    craftAssistTargetCountFromMaterials(materials) {
      assert.equal(materials.length, 1);
      return 10;
    },
    async api(route, options = {}) {
      assert.equal(route, "/api/craft/assist-select");
      capturedRequest = JSON.parse(String(options.body || "{}"));
      return {
        ok: true,
        item_ids: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
        overall: 0.2141
      };
    },
    normalizeCraftRecipeItemIds(ids) {
      return Array.from(new Set((Array.isArray(ids) ? ids : []).map((value) => String(value || "").trim()).filter(Boolean)));
    }
  });

  const result = await app.callBatchCraftAssistSelectForAccount(
    "acc-a",
    {
      target_wear: 0.2142,
      wear_filter_mode: "relative",
      materials: [{id: "mat-1", role: "main", count: 10, items: [{id: "mat-1__1", name: "AK"}]}]
    },
    ["used-1", "used-2"]
  );

  assert.deepEqual(capturedRequest, {
    username: "acc-a",
    target_wear: 0.2142,
    wear_approach_mode: "infinite",
    materials: [{id: "mat-1", role: "main", count: 10, items: [{id: "mat-1__1", name: "AK"}]}],
    use_component_items: true,
    include_cooling: false,
    wear_offset_pct: 17,
    blocked_ids: ["used-1", "used-2"],
    enable_fast_craft_assist: true
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    id: "batch_1745582400000_4fzzzx",
    item_ids: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
    status: "pending",
    result: null
  });
}

async function main() {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length) {
        super(...args);
        return;
      }
      super("2026-04-25T12:00:00.000Z");
    }

    static now() {
      return 1745582400000;
    }
  }
  const originalRandom = Math.random;
  Math.random = () => 0.123456789;
  try {
    await test_batch_helper_uses_current_assist_route_contract({DateImpl: FakeDate});
  } finally {
    Math.random = originalRandom;
  }
  console.log("batch-craft-assist-select tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
