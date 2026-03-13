const {STORAGE_UNIT_DEF_INDEX} = require("./constants");
const {sleep, toInt, asString, withTimeout} = require("./utils");

function collectComponents(inventory) {
  const out = [];
  const seen = new Set();
  for (const item of inventory || []) {
    const defIndex = toInt(item.def_index, 0);
    if (defIndex !== STORAGE_UNIT_DEF_INDEX) {
      continue;
    }
    const id = asString(item.id || "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push({
      id,
      expected_count: toInt(item.casket_contained_item_count, 0)
    });
  }
  return out;
}

function getCasketContents(csgo, casketId, timeoutMs = 35000) {
  return withTimeout(
    new Promise((resolve, reject) => {
      csgo.getCasketContents(casketId, (err, items) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(items || []);
      });
    }),
    timeoutMs,
    `load casket ${casketId} timeout`
  );
}

async function preloadComponentContents(csgo, logger, {requestIntervalMs = 80} = {}) {
  const componentEntries = collectComponents(csgo.inventory || []);
  const loadedItems = [];
  const stats = {
    sent: componentEntries.length,
    waiting: componentEntries.length,
    notified: 0,
    baseline_loaded: (csgo.inventory || []).filter((x) => asString(x.casket_id || "").trim()).length,
    final_loaded: 0,
    expected_total: componentEntries.reduce((a, x) => a + toInt(x.expected_count, 0), 0),
    loaded_total: 0,
    components: [],
    loaded_items: loadedItems
  };
  if (!componentEntries.length) {
    return stats;
  }

  for (const component of componentEntries) {
    const componentId = component.id;
    try {
      const items = await getCasketContents(csgo, componentId, 35000);
      const normalizedItems = (Array.isArray(items) ? items : []).map((item) => {
        const row = item && typeof item === "object" ? item : {};
        const itemId = asString(row.id || row.itemid || row.assetid || row.original_id || "").trim();
        // Force attach source component id so parser can group all component items reliably.
        return {
          ...row,
          ...(itemId ? {id: itemId} : {}),
          casket_id: componentId
        };
      });
      stats.notified += 1;
      stats.loaded_total += normalizedItems.length;
      loadedItems.push(...normalizedItems);
      stats.components.push({
        component_id: componentId,
        expected_count: component.expected_count,
        loaded_count: normalizedItems.length
      });
      if (logger) {
        logger.info("component_loader", `component loaded: id=${componentId} items=${normalizedItems.length}`);
      }
    } catch (err) {
      stats.components.push({
        component_id: componentId,
        expected_count: component.expected_count,
        loaded_count: 0,
        error: asString(err && err.message ? err.message : err)
      });
      if (logger) {
        logger.warn("component_loader", `component load failed: id=${componentId} err=${asString(err && err.message ? err.message : err)}`);
      }
    }
    await sleep(requestIntervalMs);
  }

  stats.final_loaded = (csgo.inventory || []).filter((x) => asString(x.casket_id || "").trim()).length;
  return stats;
}

module.exports = {
  collectComponents,
  preloadComponentContents
};
