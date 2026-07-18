const assert = require("node:assert/strict");
const {
  normalizeCraftAssistMaterialListCanonical,
  projectCraftAssistPersistedMaterials
} = require("../ui/craftAssistItemWearShared");

function test_optional_display_name_survives_normalize_and_persist_projection() {
  const normalized = normalizeCraftAssistMaterialListCanonical([{
    id: "material-main",
    role: "main",
    count: 7,
    items: [{
      id: "material-main__1",
      name: "FAMAS | Half Sleeve (Field-Tested)",
      display_name: "法玛斯 | 半袖式 (久经沙场)",
      wear_filter_mode: "relative",
      wear_min: 0.15,
      wear_max: 0.38,
      custom_range: true
    }]
  }], {source: "load"});

  assert.equal(normalized[0].items[0].name, "FAMAS | Half Sleeve (Field-Tested)");
  assert.equal(normalized[0].items[0].display_name, "法玛斯 | 半袖式 (久经沙场)");

  const persisted = projectCraftAssistPersistedMaterials(normalized);
  assert.equal(persisted[0].items[0].name, "FAMAS | Half Sleeve (Field-Tested)");
  assert.equal(persisted[0].items[0].display_name, "法玛斯 | 半袖式 (久经沙场)");
}

test_optional_display_name_survives_normalize_and_persist_projection();
console.log("craft-assist-item-display-name tests passed");
