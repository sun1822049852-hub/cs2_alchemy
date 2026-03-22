const assert = require("node:assert/strict");

const {
  recipeUsesComponentSources,
  requestUsesComponentSourceRecipes
} = require("../node_sidecar/src/services/craftExecutionGuard");

function testRecipeUsesComponentSources() {
  assert.equal(
    recipeUsesComponentSources({
      item_ids: ["1", "2"],
      item_sources: {
        "1": {
          source_scope: "component",
          source_component_id: "5001",
          source_component_name: "Box 5001"
        }
      }
    }),
    true
  );
  assert.equal(
    recipeUsesComponentSources({
      item_ids: ["1", "2"],
      item_sources: {
        "1": {
          source_scope: "main",
          source_component_id: "",
          source_component_name: ""
        }
      }
    }),
    false
  );
}

function testRequestUsesComponentSourceRecipes() {
  assert.equal(
    requestUsesComponentSourceRecipes({
      recipes: [
        {
          item_ids: ["1"],
          item_sources: {
            "1": {
              source_scope: "component",
              source_component_id: "5001",
              source_component_name: "Box 5001"
            }
          }
        }
      ]
    }),
    true
  );
  assert.equal(
    requestUsesComponentSourceRecipes({
      item_ids: ["1"],
      item_sources: {
        "1": {
          source_scope: "component",
          source_component_id: "5001",
          source_component_name: "Box 5001"
        }
      }
    }),
    true
  );
  assert.equal(
    requestUsesComponentSourceRecipes({
      recipes: [
        {
          item_ids: ["1"],
          item_sources: {
            "1": {
              source_scope: "main",
              source_component_id: "",
              source_component_name: ""
            }
          }
        }
      ]
    }),
    false
  );
}

function main() {
  testRecipeUsesComponentSources();
  testRequestUsesComponentSourceRecipes();
  console.log("craftExecutionGuard tests passed");
}

main();
