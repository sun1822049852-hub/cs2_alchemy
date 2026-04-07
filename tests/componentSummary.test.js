const assert = require("node:assert/strict");

const {buildComponentSummary} = require("../node_sidecar/src/services/componentSummary");

function test_storage_unit_summary_prefers_specific_inventory_name() {
  const result = buildComponentSummary([
    {
      asset_id: "box-1",
      def_index: 1201,
      name: "Storage Unit (A平台出售)",
      alchemy_name: "库存存储组件",
      casket_contained_item_count: 12
    },
    {
      asset_id: "child-1",
      def_index: 7,
      name: "AK-47 | Slate (Field-Tested)",
      casket_id: "box-1"
    }
  ]);

  assert.equal(result.summary_map["box-1"].name, "Storage Unit (A平台出售)");
  assert.equal(result.summary_map["box-1"].loaded_count, 12);
}

function test_component_summary_falls_back_to_alchemy_name_when_inventory_name_missing() {
  const result = buildComponentSummary([
    {
      asset_id: "box-2",
      def_index: 1201,
      name: "",
      alchemy_name: "库存存储组件",
      casket_contained_item_count: 2
    }
  ]);

  assert.equal(result.summary_map["box-2"].name, "库存存储组件");
}

test_storage_unit_summary_prefers_specific_inventory_name();
test_component_summary_falls_back_to_alchemy_name_when_inventory_name_missing();

console.log("componentSummary tests passed");
