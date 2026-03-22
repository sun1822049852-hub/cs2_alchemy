const {asString} = require("../utils");

function recipeUsesComponentSources(recipe) {
  const itemSources = recipe && typeof recipe.item_sources === "object" && recipe.item_sources && !Array.isArray(recipe.item_sources)
    ? recipe.item_sources
    : {};
  return Object.values(itemSources).some((source) => {
    if (!source || typeof source !== "object") return false;
    if (asString(source.source_scope).trim().toLowerCase() === "component") return true;
    return !!asString(source.source_component_id).trim();
  });
}

function requestUsesComponentSourceRecipes(body) {
  const payload = body && typeof body === "object" ? body : {};
  const recipes = Array.isArray(payload.recipes) ? payload.recipes : [];
  if (recipes.some((recipe) => recipeUsesComponentSources(recipe))) {
    return true;
  }
  return recipeUsesComponentSources({
    item_ids: Array.isArray(payload.item_ids) ? payload.item_ids : [],
    item_sources: payload.item_sources
  });
}

module.exports = {
  recipeUsesComponentSources,
  requestUsesComponentSourceRecipes
};
