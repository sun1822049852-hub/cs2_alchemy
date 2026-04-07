const {STORAGE_UNIT_CAPACITY, STORAGE_UNIT_DEF_INDEX} = require("../constants");
const {asString, toInt} = require("../utils");

function buildComponentSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const summaryMap = {};
  const itemMap = {};
  for (const row of list) {
    const cid = asString(row && row.casket_id).trim();
    if (!cid) continue;
    if (!itemMap[cid]) itemMap[cid] = [];
    itemMap[cid].push(row);
  }
  for (const row of list) {
    if (toInt(row && row.def_index, 0) !== STORAGE_UNIT_DEF_INDEX) continue;
    const id = asString(row && row.asset_id).trim();
    if (!id) continue;
    const expected = toInt(row && row.casket_contained_item_count, 0);
    const loaded = Math.max((itemMap[id] || []).length, expected);
    summaryMap[id] = {
      component_id: id,
      name: asString((row && (row.name || row.alchemy_name)) || `Component ${id}`),
      expected_count: Math.max(STORAGE_UNIT_CAPACITY, expected),
      loaded_count: loaded
    };
  }
  return {summary_map: summaryMap, item_map: itemMap};
}

module.exports = {
  buildComponentSummary
};
