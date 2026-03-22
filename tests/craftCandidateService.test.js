const assert = require("node:assert/strict");

const {
  buildCraftCandidateContext
} = require("../node_sidecar/src/services/craftCandidateService");

function makeRow({
  id,
  name,
  casketId = "",
  craftable = true,
  hiddenReason = "",
  rarity = 3,
  quality = 0,
  qualityName = "Normal",
  floatValue = 0.2,
  defIndex = 7,
  tradableAfter = 0
}) {
  return {
    asset_id: String(id),
    name,
    alchemy_name: name,
    casket_id: String(casketId || ""),
    is_craftable: craftable,
    hidden_reason: hiddenReason,
    rarity,
    quality,
    quality_name: qualityName,
    float_value: floatValue,
    def_index: defIndex,
    tradable_after: tradableAfter
  };
}

function pickIds(rows) {
  return Array.from((Array.isArray(rows) ? rows : []), (row) => String(row.asset_id || "")).sort();
}

function test_component_candidates_only_appear_when_enabled() {
  const rows = [
    makeRow({id: "main-1", name: "Main Craft"}),
    makeRow({id: "component-1", name: "Component Craft", casketId: "box-1"}),
    makeRow({id: "component-2", name: "Component Hidden By Attr", casketId: "box-1", hiddenReason: "attr#272/273"}),
    makeRow({id: "component-hidden", name: "Hidden Component Craft", casketId: "box-1", hiddenReason: "manual"}),
    makeRow({id: "box-1", name: "Storage Unit | Blue", defIndex: 1201, craftable: false})
  ];

  const mainOnly = buildCraftCandidateContext({
    rows,
    includeComponentItems: false,
    includeCooling: false,
    selectedItemIds: []
  });
  const withComponents = buildCraftCandidateContext({
    rows,
    includeComponentItems: true,
    includeCooling: false,
    selectedItemIds: []
  });

  assert.deepEqual(pickIds(mainOnly.candidateRows), ["main-1"]);
  assert.deepEqual(pickIds(withComponents.candidateRows), ["component-1", "component-2", "main-1"]);
}

function test_strict_preclip_hides_unselected_component_candidates_when_budget_is_full() {
  const rows = [
    makeRow({id: "main-1", name: "Main Craft"}),
    makeRow({id: "main-2", name: "Main Craft"}),
    makeRow({id: "component-1", name: "Component Craft A", casketId: "box-1"}),
    makeRow({id: "component-2", name: "Component Craft B", casketId: "box-1"}),
    makeRow({id: "box-1", name: "Storage Unit | Blue", defIndex: 1201, craftable: false})
  ];
  for (let i = 0; i < 996; i += 1) {
    rows.push(makeRow({id: `fill-${i}`, name: `Fill ${i}`, craftable: false}));
  }

  const context = buildCraftCandidateContext({
    rows,
    includeComponentItems: true,
    includeCooling: false,
    selectedItemIds: ["component-1"]
  });

  assert.equal(context.stats.main_free_slots, 1);
  assert.equal(context.stats.selected_component_count, 1);
  assert.deepEqual(pickIds(context.candidateRows), ["component-1", "main-1", "main-2"]);
}

function main() {
  test_component_candidates_only_appear_when_enabled();
  test_strict_preclip_hides_unselected_component_candidates_when_budget_is_full();
  console.log("craftCandidateService tests passed");
}

main();
