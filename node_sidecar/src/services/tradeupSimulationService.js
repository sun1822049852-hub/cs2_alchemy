const {asString} = require("../utils");
const {normalizeCollectionKey, normalizeRarityRank} = require("./skinAlchemyRules");
const {outputWearFromRelativeFloat32} = require("./wearFloat32Math");

const FLOAT_PRECISION = 12;

function roundNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Number(numeric.toFixed(FLOAT_PRECISION));
}

function predictedWearLevel(value) {
  if (!Number.isFinite(Number(value))) {
    return "";
  }
  const numeric = Number(value);
  if (numeric < 0.07) return "Factory New";
  if (numeric < 0.15) return "Minimal Wear";
  if (numeric < 0.38) return "Field-Tested";
  if (numeric < 0.45) return "Well-Worn";
  return "Battle-Scarred";
}

function hasWearBounds(item) {
  return item
    && item.minfloat !== null
    && item.maxfloat !== null
    && item.wear_range !== null
    && Number.isFinite(Number(item.minfloat))
    && Number.isFinite(Number(item.maxfloat))
    && Number.isFinite(Number(item.wear_range))
    && Number(item.maxfloat) > Number(item.minfloat);
}

function invalidResult(invalid_reason, message, extras = {}) {
  return {
    ok: false,
    invalid_reason,
    message,
    warnings: [],
    rows: [],
    ...extras
  };
}

function normalizeWarning(type, message, extra = {}) {
  return {
    type: asString(type).trim() || "warning",
    message: asString(message).trim() || "warning",
    ...extra
  };
}

function buildResolvedItemEntry(candidate, {absoluteWear, editable, role, snapshot, warnings}) {
  const baseKey = asString(candidate && candidate.basemarkethashname).trim();
  const entry = {
    role: asString(role).trim() || "item",
    editable: !!editable,
    collection: asString(candidate && (candidate.collection_display || candidate.collection_key)).trim(),
    rarity: asString(candidate && candidate.rarity_text).trim(),
    base_name: asString(candidate && candidate.base_name).trim(),
    basemarkethashname: baseKey,
    markethashname: "",
    name: asString(candidate && candidate.base_name).trim(),
    absolute_wear: absoluteWear,
    wear_label: absoluteWear == null ? "" : predictedWearLevel(absoluteWear),
    minfloat: candidate && candidate.minfloat != null ? Number(candidate.minfloat) : null,
    maxfloat: candidate && candidate.maxfloat != null ? Number(candidate.maxfloat) : null,
    wear_range: candidate && candidate.wear_range != null ? Number(candidate.wear_range) : null,
    goods_icon_url: asString(candidate && candidate.goods_icon_url).trim(),
    goods_original_icon_url: asString(candidate && candidate.goods_original_icon_url).trim(),
    goods_share_thumbnail_url: asString(candidate && candidate.goods_share_thumbnail_url).trim(),
    missing_wear_bounds: false,
    mapped_skin_missing: false
  };

  if (absoluteWear == null) {
    entry.missing_wear_bounds = true;
    warnings.push(normalizeWarning("missing_wear_bounds", `缺少磨损边界：${entry.base_name}`, {
      item: entry.base_name,
      role: entry.role
    }));
    return entry;
  }

  const wearMap = snapshot && snapshot.wearMap instanceof Map ? snapshot.wearMap : null;
  const concrete = wearMap && baseKey ? wearMap.get(baseKey)?.get(entry.wear_label) : null;
  if (concrete) {
    entry.markethashname = asString(concrete.markethashname).trim();
    entry.name = asString(concrete.name || concrete.markethashname).trim();
  } else {
    entry.markethashname = baseKey;
    entry.mapped_skin_missing = true;
    warnings.push(normalizeWarning("mapped_skin_missing", `缺少具体磨损品级映射：${entry.base_name}`, {
      item: entry.base_name,
      wear_label: entry.wear_label,
      role: entry.role
    }));
  }
  return entry;
}

function normalizeAnchors(anchors) {
  return Array.isArray(anchors) ? anchors : [];
}

function resolveOutputAbsoluteWear(candidate, sharedRelativeWear) {
  return hasWearBounds(candidate)
    ? roundNumber(outputWearFromRelativeFloat32(sharedRelativeWear, candidate.minfloat, candidate.maxfloat))
    : null;
}

function createTradeupSimulationService({catalog, outcomeCatalog, rarityOrder = []} = {}) {
  if (!catalog || typeof catalog.getItemByMarketHashName !== "function") {
    throw new Error("catalog.getItemByMarketHashName is required");
  }
  if (!outcomeCatalog || typeof outcomeCatalog.getSnapshot !== "function") {
    throw new Error("outcomeCatalog.getSnapshot is required");
  }
  return {
    resolve(payload = {}) {
      const targetKey = asString(payload && payload.target_item && payload.target_item.markethashname).trim();
      if (!targetKey) {
        return invalidResult("missing_target_item", "缺少目标产物");
      }
      const target = catalog.getItemByMarketHashName(targetKey);
      if (!target) {
        return invalidResult("target_item_not_found", `找不到目标产物：${targetKey}`);
      }

      const driverKey = asString(payload && payload.active_driver_item && payload.active_driver_item.markethashname).trim()
        || target.markethashname;
      const driver = catalog.getItemByMarketHashName(driverKey);
      if (!driver) {
        return invalidResult("driver_item_not_found", `找不到驱动产物：${driverKey}`);
      }
      if (!hasWearBounds(driver)) {
        return invalidResult("driver_wear_bounds_missing", `驱动产物缺少合法磨损边界：${driver.markethashname}`);
      }

      const activeDriverAbsWear = Number(
        payload && payload.active_driver_abs_wear != null ? payload.active_driver_abs_wear : payload && payload.target_abs_wear
      );
      if (!Number.isFinite(activeDriverAbsWear)) {
        return invalidResult("invalid_driver_absolute_wear", "驱动绝对磨损非法");
      }
      if (activeDriverAbsWear < Number(driver.minfloat) || activeDriverAbsWear > Number(driver.maxfloat)) {
        return invalidResult("invalid_driver_absolute_wear", "驱动绝对磨损越界", {
          driver: {
            markethashname: driver.markethashname,
            minfloat: driver.minfloat,
            maxfloat: driver.maxfloat
          }
        });
      }

      const targetCollection = normalizeCollectionKey(target.collection);
      if (!targetCollection) {
        return invalidResult("collection_mismatch", "目标产物缺少合法收藏品");
      }

      const outputRarityRank = normalizeRarityRank(target.rarity, rarityOrder);
      if (outputRarityRank <= 0) {
        return invalidResult("invalid_output_rarity", "目标产物稀有度非法");
      }
      const inputRarityRank = outputRarityRank - 1;
      if (inputRarityRank <= 0) {
        return invalidResult("missing_input_rarity", "当前产物已无下一级材料");
      }

      const snapshot = outcomeCatalog.getSnapshot();
      const stattrak = Number(target.isstattrak) ? 1 : 0;
      const outputs = snapshot.baseBuckets.get(`${targetCollection}|${outputRarityRank}|${stattrak}`) || [];
      const materials = snapshot.baseBuckets.get(`${targetCollection}|${inputRarityRank}|${stattrak}`) || [];
      if (!outputs.length) {
        return invalidResult("output_collection_missing", "目标收藏品下未找到同级产物");
      }

      const sharedRelativeWear = roundNumber(
        (activeDriverAbsWear - Number(driver.minfloat)) / (Number(driver.maxfloat) - Number(driver.minfloat))
      );
      const warnings = [];

      const resolvedOutputs = outputs.map((candidate) => {
        const absoluteWear = resolveOutputAbsoluteWear(candidate, sharedRelativeWear);
        const role = asString(candidate && candidate.basemarkethashname).trim() === asString(target.basemarkethashname).trim()
          ? "target"
          : asString(candidate && candidate.basemarkethashname).trim() === asString(driver.basemarkethashname).trim()
            ? "driver"
            : "output";
        return buildResolvedItemEntry(candidate, {absoluteWear, editable: true, role, snapshot, warnings});
      });

      const resolvedMaterials = materials.map((candidate) => {
        const absoluteWear = resolveOutputAbsoluteWear(candidate, sharedRelativeWear);
        return buildResolvedItemEntry(candidate, {absoluteWear, editable: false, role: "material", snapshot, warnings});
      });

      for (const anchor of normalizeAnchors(payload && payload.anchors)) {
        warnings.push(normalizeWarning("anchor_not_yet_resolved", "锚定暂未参与首期分支计算", {anchor}));
      }

      const targetAbsoluteWear = target.markethashname === driver.markethashname
        ? roundNumber(activeDriverAbsWear)
        : resolveOutputAbsoluteWear(target, sharedRelativeWear);
      const targetWearLabel = targetAbsoluteWear == null ? "" : predictedWearLevel(targetAbsoluteWear);

      return {
        ok: true,
        invalid_reason: "",
        message: "",
        target: {
          ...target,
          absolute_wear: targetAbsoluteWear,
          wear_label: targetWearLabel,
          editable: true
        },
        driver: {
          ...driver,
          absolute_wear: roundNumber(activeDriverAbsWear),
          wear_label: predictedWearLevel(activeDriverAbsWear),
          editable: true
        },
        rows: [{
          collection: targetCollection,
          collection_key: targetCollection,
          sharedRelativeWear,
          outputs: resolvedOutputs,
          materials: resolvedMaterials,
          warnings: [...warnings]
        }],
        warnings
      };
    }
  };
}

module.exports = {
  createTradeupSimulationService
};
