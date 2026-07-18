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

function loadEditorFns() {
  const source = extractBlock(
    "function getBatchCraftPresetMaterialItems(",
    "function showBatchCraftPresetPopover("
  );
  const context = {
    String,
    Number,
    Array,
    Object,
    Set,
    Map,
    console,
    normalizeCraftAssistRole(role) {
      return String(role || "").trim() === "aux" ? "aux" : "main";
    },
    buildCraftAssistParentGroups() {
      return [];
    },
    saveCraftAssistPresetsToStorage() {
      context.saveCount = (context.saveCount || 0) + 1;
    }
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function test_batch_preset_editor_separates_eligible_catalog_search_from_warehouse_quick_picks() {
  const app = loadEditorFns();
  const preset = {
    materials: [{
      id: "main_bucket",
      role: "main",
      count: 7,
      items: [{name: "AUG | 钢铁哨兵 (久经沙场)", wear_filter_mode: "relative", wear_min: 0.15, wear_max: 0.38}]
    }]
  };
  const groups = [
    {name: "AUG | 钢铁哨兵 (久经沙场)", count: 285, rarity: "军规级", collection: "狩猎运动收藏品"},
    {name: "P90 | 满昏作品 (久经沙场)", count: 303, rarity: "军规级", collection: "狩猎运动收藏品"},
    {name: "法玛斯 | 半袖式 (久经沙场)", count: 144, rarity: "军规级", collection: "狩猎运动收藏品"}
  ];

  const filtered = app.getBatchCraftPresetPickerGroups(preset, "aux", "半袖", groups);
  assert.deepEqual(Array.from(filtered, (entry) => entry.name), ["法玛斯 | 半袖式 (久经沙场)"]);

  const catalogItems = [
    {
      markethashname: "FAMAS | Half Sleeve (Field-Tested)",
      name: "法玛斯 | 半袖式 (久经沙场)",
      rarity: "军规级",
      collection: "狩猎运动收藏品",
      is_tradeup_restricted: false
    },
    {
      markethashname: "AK-47 | Wrong Rarity (Field-Tested)",
      name: "AK-47 | 错误稀有度 (久经沙场)",
      rarity: "受限",
      collection: "测试收藏品",
      is_tradeup_restricted: false
    },
    {
      markethashname: "FAMAS | Restricted (Field-Tested)",
      name: "法玛斯 | 受限物品 (久经沙场)",
      rarity: "军规级",
      collection: "狩猎运动收藏品",
      is_tradeup_restricted: true,
      tradeup_restriction_reason: "不能加入炼金"
    }
  ];
  const catalogFiltered = app.getBatchCraftPresetCatalogItems(preset, "aux", "半袖", catalogItems, groups);
  assert.deepEqual(Array.from(catalogFiltered, (entry) => entry.markethashname), ["FAMAS | Half Sleeve (Field-Tested)"]);

  assert.equal(app.addBatchCraftPresetMaterialName(preset, "aux", catalogFiltered[0].markethashname, {
    display_name: catalogFiltered[0].name,
    rarity: catalogFiltered[0].rarity,
    collection: catalogFiltered[0].collection
  }), true);
  assert.equal(preset.materials[1].role, "aux");
  assert.equal(preset.materials[1].count, 0);
  assert.equal(preset.materials[1].items[0].name, "FAMAS | Half Sleeve (Field-Tested)");
  assert.equal(preset.materials[1].items[0].display_name, "法玛斯 | 半袖式 (久经沙场)");
  assert.equal(preset.materials[1].items[0].rarity, "军规级");
  assert.equal(app.addBatchCraftPresetMaterialName(preset, "aux", catalogFiltered[0].markethashname), false);
  assert.equal(app.removeBatchCraftPresetMaterialName(preset, "aux", catalogFiltered[0].markethashname), true);
  assert.equal(preset.materials.some((entry) => entry.role === "aux"), false);
  assert.equal(app.saveCount, 2);
}

function test_batch_preset_role_count_allows_optional_auxiliary_but_not_zero_main() {
  const app = loadEditorFns();
  assert.equal(app.normalizeBatchCraftPresetRoleCount(undefined, "aux", false), 0);
  assert.equal(app.normalizeBatchCraftPresetRoleCount(0, "aux", true), 0);
  assert.equal(app.normalizeBatchCraftPresetRoleCount(-1, "aux", true), 0);
  assert.equal(app.normalizeBatchCraftPresetRoleCount(10, "aux", true), 9);
  assert.equal(app.normalizeBatchCraftPresetRoleCount(0, "main", true), 1);
}

function makeComplementPreset({main = 10, aux = null} = {}) {
  const materials = [{
    id: "main_bucket",
    role: "main",
    count: main,
    items: [{name: "Main Skin"}]
  }];
  if (aux != null) {
    materials.push({
      id: "aux_bucket",
      role: "aux",
      count: aux,
      items: [{name: "Aux Skin"}]
    });
  }
  return {materials};
}

function test_batch_preset_role_counts_always_complement_to_ten() {
  const app = loadEditorFns();

  const legacy = makeComplementPreset({main: 10, aux: 3});
  assert.deepEqual(
    {...app.syncBatchCraftPresetRoleCounts(legacy)},
    {main_count: 7, aux_count: 3, changed: true}
  );
  assert.equal(legacy.materials[0].count, 7);
  assert.equal(legacy.materials[1].count, 3);

  legacy.materials[0].count = 6;
  assert.deepEqual(
    {...app.syncBatchCraftPresetRoleCounts(legacy, "main")},
    {main_count: 6, aux_count: 4, changed: true}
  );

  legacy.materials[1].count = 0;
  assert.deepEqual(
    {...app.syncBatchCraftPresetRoleCounts(legacy, "aux")},
    {main_count: 10, aux_count: 0, changed: true}
  );
}

function test_batch_preset_main_count_is_locked_while_auxiliary_is_zero() {
  const app = loadEditorFns();

  const withoutAux = makeComplementPreset({main: 4});
  assert.deepEqual(
    {...app.syncBatchCraftPresetRoleCounts(withoutAux)},
    {main_count: 10, aux_count: 0, changed: true}
  );
  assert.equal(app.isBatchCraftPresetRoleCountEditable(withoutAux, "main"), false);
  assert.equal(app.isBatchCraftPresetRoleCountEditable(withoutAux, "aux"), false);

  const zeroAux = makeComplementPreset({main: 10, aux: 0});
  assert.equal(app.isBatchCraftPresetRoleCountEditable(zeroAux, "main"), false);
  assert.equal(app.isBatchCraftPresetRoleCountEditable(zeroAux, "aux"), true);

  zeroAux.materials[1].count = 3;
  app.syncBatchCraftPresetRoleCounts(zeroAux, "aux");
  assert.equal(app.isBatchCraftPresetRoleCountEditable(zeroAux, "main"), true);
  assert.equal(app.isBatchCraftPresetRoleCountEditable(zeroAux, "aux"), true);
}

function test_batch_preset_popover_repositions_after_picker_height_changes() {
  const source = extractBlock(
    "function showBatchCraftPresetPopover(",
    "function renderBatchCraftQueue("
  );
  assert.match(source, /const positionPopover = \(\) => \{/);
  assert.match(
    source,
    /pickerPanel\.classList\.remove\("hidden"\);[\s\S]*?renderPickerResults\(\);[\s\S]*?positionPopover\(\);[\s\S]*?requestAnimationFrame\(\(\) => pickerInput\.focus\(\)\);/
  );
  assert.match(
    source,
    /pickerPanel\.classList\.add\("hidden"\);[\s\S]*?activePickerRole = "";[\s\S]*?positionPopover\(\);/
  );
  assert.match(source, /\/api\/simulation\/tradeup\/search-items\?q=/);
  assert.match(source, /全部符合物品/);
  assert.match(source, /仓库快捷选择/);
  assert.match(source, /搜索全部符合的枪械/);
  assert.match(source, /const countEditable = isBatchCraftPresetRoleCountEditable\(preset, role\)/);
  assert.match(source, /qtyInput\.disabled = !countEditable/);
  assert.match(source, /syncBatchCraftPresetRoleCounts\(preset, role\)/);
}

test_batch_preset_editor_separates_eligible_catalog_search_from_warehouse_quick_picks();
test_batch_preset_role_count_allows_optional_auxiliary_but_not_zero_main();
test_batch_preset_role_counts_always_complement_to_ten();
test_batch_preset_main_count_is_locked_while_auxiliary_is_zero();
test_batch_preset_popover_repositions_after_picker_height_changes();
console.log("batch-craft-preset-editor tests passed");
