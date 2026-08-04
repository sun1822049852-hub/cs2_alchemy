const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {parseInventory} = require("../src/inventoryParser");
const {buildCraftCandidateContext} = require("../src/services/craftCandidateService");
const {buildCraftAssistSelectionContext} = require("../src/services/craftAssistService");

const COMPONENT_OPS_PATH = path.resolve(__dirname, "../src/services/componentOpsService.js");
const COMPONENT_OPS_SOURCE = fs.readFileSync(COMPONENT_OPS_PATH, "utf8");
const CRAFT_SERVICE_PATH = path.resolve(__dirname, "../src/services/craftService.js");
const CRAFT_SERVICE_SOURCE = fs.readFileSync(CRAFT_SERVICE_PATH, "utf8");

const FUTURE_TS = 2000000000;
const EMPTY_SCHEMA = {
  weapons: {},
  paints: {},
  item_defs: {}
};

function extractBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return source.slice(start, end);
}

function loadComponentRuleFns() {
  const source = [
    "const STORAGE_UNIT_DEF_INDEX = 1201;",
    "const HARD_BLOCKED_MARKET_HASHES = new Set();",
    "function asString(value) { return value == null ? '' : String(value); }",
    "function toInt(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? Math.trunc(n) : fallback; }",
    extractBlock(COMPONENT_OPS_SOURCE, "function nthWeekdayOfMonthUtc(", "function rowWearValueForSort(")
  ].join("\n");
  const context = {
    Math,
    Number,
    String,
    Date,
    Array,
    Object,
    Set
  };
  vm.runInNewContext(source, context, {filename: COMPONENT_OPS_PATH});
  return context;
}

function loadResolveTradeUpRecipe() {
  const source = [
    "const RARITY_NAME_MAP = {1:'Consumer',2:'Industrial',3:'Mil-Spec',4:'Restricted',5:'Classified',6:'Covert'};",
    "function badRequest(message) { const err = new Error(message); err.code = 'bad_request'; return err; }",
    "function asString(value) { return value == null ? '' : String(value); }",
    "function toInt(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? Math.trunc(n) : fallback; }",
    extractBlock(CRAFT_SERVICE_SOURCE, "function isStatTrakRow(", "function makeRows(")
  ].join("\n");
  const context = {
    Math,
    Number,
    String,
    Date,
    Array,
    Object,
    Set
  };
  vm.runInNewContext(source, context, {filename: CRAFT_SERVICE_PATH});
  return context.resolveTradeUpRecipe;
}

function makeUintAttr(defIndex, value) {
  return {
    def_index: defIndex,
    value
  };
}

function makeRawItem({
  id,
  attrs = [],
  defIndex = 7,
  quality = 0,
  rarity = 3,
  origin = 0,
  flags = 0,
  inventory = 3221225475
}) {
  return {
    id,
    def_index: defIndex,
    quality,
    rarity,
    origin,
    flags,
    inventory,
    attribute: attrs
  };
}

function parseSingleRow(item) {
  const parsed = parseInventory([item], EMPTY_SCHEMA, {dbPath: path.resolve(__dirname, "__missing_skin_meta__.db")});
  assert.equal(parsed.rows.length, 1, "expected exactly one parsed row");
  return parsed.rows[0];
}

function makeCraftRow({
  id,
  tradableAfter = 0,
  tradable_after = undefined,
  yellowShieldBlocked = false,
  yellow_shield_blocked = undefined,
  tradeLockKind = "",
  trade_lock_kind = undefined,
  casketId = "",
  hiddenReason = "",
  craftable = true
} = {}) {
  const resolvedTradableAfter = tradable_after !== undefined ? tradable_after : tradableAfter;
  const resolvedYellowShieldBlocked = yellow_shield_blocked !== undefined ? yellow_shield_blocked : yellowShieldBlocked;
  const resolvedTradeLockKind = trade_lock_kind !== undefined ? trade_lock_kind : tradeLockKind;
  return {
    asset_id: String(id),
    name: `Item ${id}`,
    market_hash_name: `Item ${id}`,
    tradable_after: resolvedTradableAfter,
    yellow_shield_blocked: resolvedYellowShieldBlocked,
    trade_lock_kind: resolvedTradeLockKind,
    casket_id: String(casketId || ""),
    hidden_reason: hiddenReason,
    is_craftable: craftable,
    craftable_reason: craftable ? "ok" : "blocked",
    rarity: 3,
    quality: 0,
    quality_name: "Normal",
    float_value: 0.2
  };
}

function makeRecipeRows(firstRowOverrides = {}) {
  return Array.from({length: 10}, (_, index) => makeCraftRow({
    id: 1000 + index,
    ...(index === 0 ? firstRowOverrides : null)
  }));
}

function pickIds(rows) {
  return Array.from((Array.isArray(rows) ? rows : []), (row) => String(row.asset_id || "")).sort();
}

function testParserMarksAttr312AsYellowShieldBlocked() {
  const row = parseSingleRow(makeRawItem({
    id: 5001,
    origin: 23,
    attrs: [
      makeUintAttr(75, FUTURE_TS),
      makeUintAttr(312, 1)
    ]
  }));

  assert.equal(row.yellow_shield_blocked, true);
  assert.equal(row.trade_lock_kind, "yellow_shield");
}

function testParserKeepsPlainSteamCooldownOutOfYellowShieldBucket() {
  const row = parseSingleRow(makeRawItem({
    id: 5002,
    origin: 24,
    attrs: [
      makeUintAttr(75, FUTURE_TS)
    ]
  }));

  assert.equal(Number(row.tradable_after) > 0, true);
  assert.equal(row.yellow_shield_blocked, false);
  assert.notEqual(row.trade_lock_kind, "yellow_shield");
}

function testComponentRulesAllowNormalCooldownButBlockYellowShield() {
  const componentFns = loadComponentRuleFns();
  const steamCooling = makeCraftRow({
    id: "steam-cooling",
    tradableAfter: FUTURE_TS
  });
  const yellowShield = makeCraftRow({
    id: "yellow-shield",
    tradableAfter: FUTURE_TS,
    yellowShieldBlocked: true,
    tradeLockKind: "yellow_shield"
  });

  assert.equal(componentFns.ensureCanOperateItemByRules(steamCooling, "box-1").ok, true);
  const blocked = componentFns.ensureCanOperateItemByRules(yellowShield, "box-1");
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /黄盾/);
}

function testCraftCandidatesExcludeYellowShieldEvenWhenCoolingIncluded() {
  const rows = [
    makeCraftRow({id: "plain"}),
    makeCraftRow({id: "steam-cooling", tradableAfter: FUTURE_TS}),
    makeCraftRow({
      id: "yellow-shield",
      tradableAfter: FUTURE_TS,
      yellowShieldBlocked: true,
      tradeLockKind: "yellow_shield"
    })
  ];

  const withoutCooling = buildCraftCandidateContext({rows, includeCooling: false});
  assert.deepEqual(pickIds(withoutCooling.candidateRows), ["plain"]);

  const withCooling = buildCraftCandidateContext({rows, includeCooling: true});
  assert.deepEqual(pickIds(withCooling.allCraftableRows), ["plain", "steam-cooling"]);
  assert.deepEqual(pickIds(withCooling.candidateRows), ["plain", "steam-cooling"]);
}

function testCraftAssistCandidatesExcludeYellowShieldEvenWhenCoolingIncluded() {
  const rows = [
    makeCraftRow({id: "plain"}),
    makeCraftRow({id: "steam-cooling", tradableAfter: FUTURE_TS}),
    makeCraftRow({
      id: "yellow-shield",
      tradableAfter: FUTURE_TS,
      yellowShieldBlocked: true,
      tradeLockKind: "yellow_shield"
    })
  ];

  const selectionContext = buildCraftAssistSelectionContext({rows, includeCooling: true});
  assert.deepEqual(pickIds(selectionContext.candidateRows), ["plain", "steam-cooling"]);
}

function testTradeUpStillRejectsYellowShieldWhenCoolingAllowed() {
  const resolveTradeUpRecipe = loadResolveTradeUpRecipe();

  assert.doesNotThrow(() => {
    resolveTradeUpRecipe(makeRecipeRows({
      tradable_after: FUTURE_TS
    }), {allowCooling: true});
  });

  assert.throws(
    () => resolveTradeUpRecipe(makeRecipeRows({
      tradable_after: FUTURE_TS,
      yellow_shield_blocked: true,
      trade_lock_kind: "yellow_shield"
    }), {allowCooling: true}),
    /黄盾|交易保护/
  );
}

function testTradeUpKeepsLegacyStatTrakRulesByDefault() {
  const resolveTradeUpRecipe = loadResolveTradeUpRecipe();
  const statTrakRows = makeRecipeRows().map((row) => ({
    ...row,
    quality: 9,
    quality_name: "StatTrak"
  }));
  const statTrakResult = resolveTradeUpRecipe(statTrakRows);
  assert.equal(statTrakResult.recipe, 12);
  assert.equal(statTrakResult.rarity, 3);
  assert.equal(statTrakResult.stattrak, true);

  const rows = makeRecipeRows();
  rows[1] = {
    ...rows[1],
    quality: 9,
    quality_name: "StatTrak"
  };
  rows[2] = {
    ...rows[2],
    quality: 11,
    quality_name: "Souvenir"
  };

  assert.throws(
    () => resolveTradeUpRecipe(rows),
    /StatTrak|全部普通/
  );
}

function testMainCraftCanNormalizeSpecialQualitiesToNormalRecipe() {
  const resolveTradeUpRecipe = loadResolveTradeUpRecipe();
  const rows = makeRecipeRows();
  rows[1] = {
    ...rows[1],
    quality: 9,
    quality_name: "StatTrak"
  };
  rows[2] = {
    ...rows[2],
    quality: 11,
    quality_name: "Souvenir"
  };

  const result = resolveTradeUpRecipe(rows, {normalizeSpecialQuality: true});
  assert.equal(result.recipe, 2);
  assert.equal(result.rarity, 3);
  assert.equal(result.stattrak, false);
  assert.doesNotMatch(result.recipe_name, /StatTrak/i);
}

function main() {
  testParserMarksAttr312AsYellowShieldBlocked();
  testParserKeepsPlainSteamCooldownOutOfYellowShieldBucket();
  testComponentRulesAllowNormalCooldownButBlockYellowShield();
  testCraftCandidatesExcludeYellowShieldEvenWhenCoolingIncluded();
  testCraftAssistCandidatesExcludeYellowShieldEvenWhenCoolingIncluded();
  testTradeUpStillRejectsYellowShieldWhenCoolingAllowed();
  testTradeUpKeepsLegacyStatTrakRulesByDefault();
  testMainCraftCanNormalizeSpecialQualitiesToNormalRecipe();
  console.log("yellow-shield-rules tests passed");
}

main();
