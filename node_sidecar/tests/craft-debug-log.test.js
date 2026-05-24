const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  appendCraftDebugEvent,
  buildCraftAssistSelectionEvent,
  buildCraftDebugItemIdsKey,
  buildCraftDebugLogFilePath,
  buildTradeupExecutionEvent,
  projectCraftDebugItem
} = require("../src/craftDebugLog");

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function test_append_event_writes_jsonl_to_daily_craft_debug_file() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "craft-debug-log-"));
  const generatedAt = new Date("2026-05-04T07:08:09.123Z");

  const ok = appendCraftDebugEvent({
    event: "craft_assist_selection",
    generatedAt,
    logDir: path.join(tempDir, "logs"),
    account: "acc-a",
    index: 2,
    total: 5,
    item_ids_ordered: ["9", "11", "10"],
    target_raw: "0.2142",
    picks: [{asset_id: "9", name: "A", float_value: 0.12}]
  });

  assert.equal(ok, true);
  const filePath = path.join(tempDir, "logs", "craft_debug", "craft_debug_20260504.jsonl");
  assert.equal(buildCraftDebugLogFilePath({logDir: path.join(tempDir, "logs"), generatedAt}), filePath);
  const [event] = readJsonl(filePath);
  assert.equal(event.event, "craft_assist_selection");
  assert.equal(event.generated_at, "2026-05-04T07:08:09.123Z");
  assert.equal(event.account, "acc-a");
  assert.equal(event.index, 2);
  assert.equal(event.total, 5);
  assert.deepEqual(event.item_ids_ordered, ["9", "11", "10"]);
  assert.equal(event.item_ids_key, "9|10|11");
  assert.equal(event.target_raw, "0.2142");
  assert.deepEqual(event.picks, [{asset_id: "9", name: "A", float_value: 0.12}]);
}

function test_item_ids_key_sorts_numeric_ids_stably_without_changing_ordered_ids() {
  const ordered = ["100", "9", "11", "10"];
  const key = buildCraftDebugItemIdsKey(ordered);

  assert.equal(key, "9|10|11|100");
  assert.deepEqual(ordered, ["100", "9", "11", "10"]);
}

function test_project_item_keeps_available_debug_fields_and_wear_values() {
  const item = projectCraftDebugItem({
    asset_id: "123",
    alchemy_name: "AK-47 | Redline",
    float_value: 0.25,
    minfloat: 0.1,
    maxfloat: 0.6,
    collection: "The Phoenix Collection",
    collection_name: "Phoenix",
    rarity: 4,
    rarity_name: "Restricted",
    quality: 9,
    quality_name: "StatTrak"
  }, {index: 3});

  assert.deepEqual(item, {
    index: 3,
    id: "123",
    asset_id: "123",
    name: "AK-47 | Redline",
    float_value: 0.25,
    abs_wear: 0.25,
    absolute_wear: 0.25,
    rel_wear: 0.3,
    relative_wear: 0.3,
    minfloat: 0.1,
    maxfloat: 0.6,
    collection: "The Phoenix Collection",
    collection_name: "Phoenix",
    rarity: 4,
    rarity_name: "Restricted",
    quality: 9,
    quality_name: "StatTrak"
  });
}

function test_build_craft_assist_selection_event_includes_target_recipe_and_picks() {
  const event = buildCraftAssistSelectionEvent({
    account: "acc-a",
    targetRaw: "0.2142",
    target: 0.21419999,
    approachMode: "below",
    predictedOverall: 0.2141,
    quantizedOverall: 0.21409999,
    recipeInfo: {recipe: 3, rarity: 4, stattrak: false},
    itemIdsOrdered: ["2", "1"],
    rows: [
      {asset_id: "1", name: "One", float_value: 0.1, minfloat: 0, maxfloat: 1, rarity: 4},
      {asset_id: "2", name: "Two", float_value: 0.2, minfloat: 0, maxfloat: 1, rarity: 4}
    ]
  });

  assert.equal(event.event, "craft_assist_selection");
  assert.equal(event.account, "acc-a");
  assert.equal(event.target_raw, "0.2142");
  assert.equal(event.target, 0.21419999);
  assert.equal(event.approach_mode, "below");
  assert.equal(event.predicted_overall, 0.2141);
  assert.equal(event.quantized_overall, 0.21409999);
  assert.equal(event.recipe, 3);
  assert.equal(event.rarity, 4);
  assert.equal(event.stattrak, false);
  assert.deepEqual(event.item_ids_ordered, ["2", "1"]);
  assert.equal(event.item_ids_key, "1|2");
  assert.deepEqual(event.picks.map((item) => item.id), ["2", "1"]);
}

function test_build_tradeup_execution_event_keeps_execution_order_and_gained_details() {
  const event = buildTradeupExecutionEvent({
    account: "acc-b",
    index: 1,
    total: 3,
    recipeInfo: {recipe: 12, recipe_name: "Trade-Up", rarity: 3, stattrak: true},
    itemIdsOrdered: ["9", "7"],
    materialRows: [
      {asset_id: "7", name: "Seven", float_value: 0.7, minfloat: 0, maxfloat: 1, rarity: 3},
      {asset_id: "9", name: "Nine", float_value: 0.9, minfloat: 0, maxfloat: 1, rarity: 3}
    ],
    gainedIds: ["99"],
    gainedPresentIds: ["99"],
    gainedRows: [{asset_id: "99", name: "Prize", float_value: 0.31, minfloat: 0, maxfloat: 1, rarity: 4}]
  });

  assert.equal(event.event, "tradeup_execution");
  assert.equal(event.step, "1/3");
  assert.deepEqual(event.item_ids_ordered, ["9", "7"]);
  assert.equal(event.item_ids_key, "7|9");
  assert.deepEqual(event.materials.map((item) => item.id), ["9", "7"]);
  assert.equal(event.recipe, 12);
  assert.equal(event.recipe_name, "Trade-Up");
  assert.equal(event.rarity, 3);
  assert.equal(event.stattrak, true);
  assert.deepEqual(event.gained_ids, ["99"]);
  assert.deepEqual(event.gained_present_ids, ["99"]);
  assert.deepEqual(event.gained_items.map((item) => item.id), ["99"]);
}

function test_append_failure_warns_and_does_not_throw() {
  const warnCalls = [];
  const ok = appendCraftDebugEvent({
    event: "tradeup_execution",
    logDir: "\0",
    account: "acc-b",
    item_ids_ordered: ["1", "2"],
    logger: {
      warn(scope, text) {
        warnCalls.push({scope, text});
      }
    }
  });

  assert.equal(ok, false);
  assert.equal(warnCalls.length, 1);
  assert.equal(warnCalls[0].scope, "craft_debug");
  assert.match(warnCalls[0].text, /failed to write craft debug log/i);
}

function test_append_failure_returns_false_when_warn_throws() {
  const ok = appendCraftDebugEvent({
    event: "tradeup_execution",
    logDir: "\0",
    account: "acc-c",
    item_ids_ordered: ["1", "2"],
    logger: {
      warn() {
        throw new Error("warn failed");
      }
    }
  });

  assert.equal(ok, false);
}

function main() {
  test_append_event_writes_jsonl_to_daily_craft_debug_file();
  test_item_ids_key_sorts_numeric_ids_stably_without_changing_ordered_ids();
  test_project_item_keeps_available_debug_fields_and_wear_values();
  test_build_craft_assist_selection_event_includes_target_recipe_and_picks();
  test_build_tradeup_execution_event_keeps_execution_order_and_gained_details();
  test_append_failure_warns_and_does_not_throw();
  test_append_failure_returns_false_when_warn_throws();
  console.log("craft-debug-log tests passed");
}

main();
