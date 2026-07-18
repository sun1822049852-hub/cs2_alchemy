(function initCraftAssistItemWearShared(root, factory) {
  const api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  if (root && typeof root === "object") root.craftAssistItemWearShared = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createCraftAssistItemWearShared() {
  "use strict";

  const WEAR_INPUT_DECIMALS = 16;
  const REQUIRED_COUNT = 10;
  const WEAR_SUFFIX_RANGES = [
    {keys: ["崭新出厂", "崭新", "factory new", "factorynew"], min: 0, max: 0.07},
    {keys: ["略有磨损", "略磨", "minimal wear", "minimalwear"], min: 0.07, max: 0.15},
    {keys: ["久经沙场", "久经", "field tested", "field-tested", "fieldtested"], min: 0.15, max: 0.38},
    {keys: ["破损不堪", "破损", "well worn", "well-worn", "wellworn"], min: 0.38, max: 0.45},
    {keys: ["战痕累累", "战痕", "battle scarred", "battle-scarred", "battlescarred"], min: 0.45, max: 1}
  ];

  function asString(value) {
    return String(value == null ? "" : value);
  }

  function hasOwn(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  function clampWear01(value, fallback) {
    const fallbackValue = Number.isFinite(Number(fallback)) ? Number(fallback) : 0;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return Math.max(0, Math.min(1, fallbackValue));
    return Math.max(0, Math.min(1, numeric));
  }

  function truncateNumber(value, decimals) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const safeDecimals = Math.max(0, Math.trunc(Number(decimals) || 0));
    const scale = 10 ** safeDecimals;
    if (!Number.isFinite(scale) || scale <= 0) return numeric;
    if (numeric >= 0) return Math.floor(numeric * scale + 1e-9) / scale;
    return Math.ceil(numeric * scale - 1e-9) / scale;
  }

  function numberTextTrunc(value) {
    const truncated = truncateNumber(value, WEAR_INPUT_DECIMALS);
    return truncated == null ? "-" : truncated.toFixed(WEAR_INPUT_DECIMALS);
  }

  function normalizeWearToken(text) {
    return asString(text).toLowerCase().replace(/[\s_\-（）()]/g, "");
  }

  function normalizeCraftAssistFilterMode(mode) {
    return asString(mode).trim() === "absolute" ? "absolute" : "relative";
  }

  function normalizeCraftAssistRole(role) {
    return asString(role).trim() === "aux" ? "aux" : "main";
  }

  function normalizeCraftAssistDirection(role, direction) {
    const fallback = normalizeCraftAssistRole(role) === "aux" ? "lt" : "gt";
    const normalized = asString(direction).trim();
    return normalized === "lt" || normalized === "gt" ? normalized : fallback;
  }

  function resolveCraftAssistRequiredCount() {
    return REQUIRED_COUNT;
  }

  function normalizeCraftAssistEntryCount(value, fallback) {
    const numeric = Math.trunc(Number(value));
    const fallbackValue = Math.max(1, Math.min(REQUIRED_COUNT, Math.trunc(Number(fallback) || 1)));
    if (!Number.isFinite(numeric)) return fallbackValue;
    return Math.max(1, Math.min(REQUIRED_COUNT, numeric));
  }

  function normalizeCraftAssistRoleCount(value, role, fallback) {
    if (normalizeCraftAssistRole(role) !== "aux") {
      return normalizeCraftAssistEntryCount(value, fallback);
    }
    const numeric = Math.trunc(Number(value));
    const fallbackValue = Math.max(0, Math.min(REQUIRED_COUNT, Math.trunc(Number(fallback) || 0)));
    if (!Number.isFinite(numeric)) return fallbackValue;
    return Math.max(0, Math.min(REQUIRED_COUNT, numeric));
  }

  function normalizePersistedId(value) {
    return asString(value).trim();
  }

  function normalizeCraftAssistSource(source) {
    const normalized = asString(source).trim();
    return ["load", "restore", "renormalize", "mode-switch"].includes(normalized)
      ? normalized
      : "renormalize";
  }

  function isLegacyAbsoluteMode(value) {
    if (value === true || value === 1) return true;
    if (typeof value !== "string") return false;
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }

  function resolveLegacyMaterialFilterMode(entry, fallbackMode) {
    if (hasOwn(entry, "wear_filter_mode")) return normalizeCraftAssistFilterMode(entry && entry.wear_filter_mode);
    if (isLegacyAbsoluteMode(entry && entry.use_absolute_wear)) return "absolute";
    return normalizeCraftAssistFilterMode(fallbackMode);
  }

  function itemDisplayName(row) {
    return asString((row && row.alchemy_name) || "").trim() || asString((row && row.name) || "").trim();
  }

  function inferWearSuffixRangeByName(name) {
    const normalized = normalizeWearToken(name);
    if (!normalized) return null;
    for (const rule of WEAR_SUFFIX_RANGES) {
      if (rule.keys.some((key) => normalized.includes(normalizeWearToken(key)))) {
        return {min: rule.min, max: rule.max};
      }
    }
    return null;
  }

  function getCraftMaterialFloatBoundsByName(name, rows) {
    const key = asString(name).trim();
    if (!key) return null;
    let min = null;
    let max = null;
    for (const row of Array.isArray(rows) ? rows : []) {
      const rowNames = [itemDisplayName(row), asString(row && row.name).trim()];
      if (!rowNames.includes(key)) continue;
      const rowMin = Number(row && row.minfloat);
      const rowMax = Number(row && row.maxfloat);
      if (!Number.isFinite(rowMin) || !Number.isFinite(rowMax) || rowMax <= rowMin) continue;
      min = min == null ? clampWear01(rowMin, 0) : Math.min(min, clampWear01(rowMin, 0));
      max = max == null ? clampWear01(rowMax, 1) : Math.max(max, clampWear01(rowMax, 1));
    }
    return min == null || max == null || max < min ? null : {min, max};
  }

  function resolveCraftMaterialWearConstraintByName(name, {wearFilterMode, rows} = {}) {
    const useRelative = normalizeCraftAssistFilterMode(wearFilterMode) !== "absolute";
    const suffixRange = inferWearSuffixRangeByName(name);
    const floatBounds = getCraftMaterialFloatBoundsByName(name, rows);
    if (!suffixRange && !floatBounds) return null;
    let min = 0;
    let max = 1;
    if (suffixRange && floatBounds) {
      const interMin = Math.max(suffixRange.min, floatBounds.min);
      const interMax = Math.min(suffixRange.max, floatBounds.max);
      if (interMax >= interMin) {
        min = interMin;
        max = interMax;
      } else {
        min = floatBounds.min;
        max = floatBounds.max;
      }
    } else if (suffixRange) {
      min = suffixRange.min;
      max = suffixRange.max;
    } else if (floatBounds) {
      min = floatBounds.min;
      max = floatBounds.max;
    }
    if (useRelative && floatBounds && floatBounds.max > floatBounds.min) {
      const denom = floatBounds.max - floatBounds.min;
      min = (min - floatBounds.min) / denom;
      max = (max - floatBounds.min) / denom;
    }
    min = clampWear01(min, 0);
    max = clampWear01(max, 1);
    if (max < min) {
      const tmp = min;
      min = max;
      max = tmp;
    }
    return {wear_min: truncateNumber(min, WEAR_INPUT_DECIMALS), wear_max: truncateNumber(max, WEAR_INPUT_DECIMALS)};
  }

  function normalizeFiniteStoredRangePair(storedRange) {
    if (!storedRange || typeof storedRange !== "object") return null;
    const min = Number(storedRange.wear_min);
    const max = Number(storedRange.wear_max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    let wearMin = truncateNumber(clampWear01(min, 0), WEAR_INPUT_DECIMALS);
    let wearMax = truncateNumber(clampWear01(max, 1), WEAR_INPUT_DECIMALS);
    if (wearMax < wearMin) {
      const tmp = wearMin;
      wearMin = wearMax;
      wearMax = tmp;
    }
    return {wear_min: wearMin, wear_max: wearMax};
  }

  function fullWearRange() {
    return {wear_min: 0, wear_max: 1};
  }

  function clampRangeToBounds(range, bounds) {
    if (!range) return null;
    if (!bounds) {
      return {
        wear_min: truncateNumber(clampWear01(range.wear_min, 0), WEAR_INPUT_DECIMALS),
        wear_max: truncateNumber(clampWear01(range.wear_max, 1), WEAR_INPUT_DECIMALS)
      };
    }
    let wearMin = truncateNumber(
      Math.max(Number(bounds.wear_min), Math.min(Number(bounds.wear_max), Number(range.wear_min))),
      WEAR_INPUT_DECIMALS
    );
    let wearMax = truncateNumber(
      Math.max(Number(bounds.wear_min), Math.min(Number(bounds.wear_max), Number(range.wear_max))),
      WEAR_INPUT_DECIMALS
    );
    if (wearMax < wearMin) {
      const tmp = wearMin;
      wearMin = wearMax;
      wearMax = tmp;
    }
    return {wear_min: wearMin, wear_max: wearMax};
  }

  function resolveCraftAssistItemDefaultRange(name, opts) {
    const options = opts && typeof opts === "object" ? opts : {};
    const mode = normalizeCraftAssistFilterMode(options.wearFilterMode);
    const source = normalizeCraftAssistSource(options.source);
    const currentRange = resolveCraftMaterialWearConstraintByName(name, {wearFilterMode: mode, rows: options.rows});
    const storedRange = normalizeFiniteStoredRangePair(options.storedRange);
    if (options.customRange) {
      if (storedRange) {
        const resolved = mode === "absolute" ? clampRangeToBounds(storedRange, currentRange) : clampRangeToBounds(storedRange, null);
        return {wear_min: resolved.wear_min, wear_max: resolved.wear_max, usedStoredFallback: false, resolvedCustomRange: true};
      }
      const fallback = currentRange || fullWearRange();
      return {wear_min: fallback.wear_min, wear_max: fallback.wear_max, usedStoredFallback: false, resolvedCustomRange: false};
    }
    if (currentRange) {
      return {wear_min: currentRange.wear_min, wear_max: currentRange.wear_max, usedStoredFallback: false, resolvedCustomRange: false};
    }
    if (source !== "mode-switch" && storedRange) {
      return {wear_min: storedRange.wear_min, wear_max: storedRange.wear_max, usedStoredFallback: true, resolvedCustomRange: false};
    }
    const fallback = fullWearRange();
    return {wear_min: fallback.wear_min, wear_max: fallback.wear_max, usedStoredFallback: false, resolvedCustomRange: false};
  }

  function normalizeCraftAssistNameList(value) {
    const source = Array.isArray(value) ? value : (value == null ? [] : [value]);
    const out = [];
    const seen = new Set();
    for (const item of source) {
      const name = asString(item).trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
    return out;
  }

  function buildTraceProjectionFromNames(names, fallbackLabel) {
    const itemNames = normalizeCraftAssistNameList(names);
    const label = itemNames.length ? itemNames.join(" / ") : asString(fallbackLabel).trim();
    const primaryName = itemNames[0] || "";
    return {materialName: primaryName, primary_name: primaryName, item_names: itemNames, label, name: primaryName, names: itemNames.slice()};
  }

  function projectCraftAssistTraceMaterial(material) {
    const names = Array.isArray(material && material.item_names)
      ? material.item_names
      : Array.isArray(material && material.items)
        ? material.items.map((item) => item && item.name)
        : Array.isArray(material && material.names)
          ? material.names
          : [material && (material.primary_name || material.name)];
    const projection = buildTraceProjectionFromNames(names, material && material.label);
    if (projection.item_names.length) return projection;
    const fallbackPrimary = asString(material && (material.primary_name || material.name)).trim();
    if (!fallbackPrimary) return projection;
    return {materialName: fallbackPrimary, primary_name: fallbackPrimary, item_names: [fallbackPrimary], label: fallbackPrimary, name: fallbackPrimary, names: [fallbackPrimary]};
  }

  function slugifyStableName(name) {
    const normalized = normalizeWearToken(name).replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "");
    return normalized || "item";
  }

  function hashStableText(value) {
    const text = asString(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function mintCraftAssistMaterialId(args) {
    const names = [];
    const seen = new Set();
    for (const rawItem of Array.isArray(args && args.rawItems) ? args.rawItems : []) {
      const name = asString(rawItem && rawItem.name).trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    const seed = [
      normalizeCraftAssistRole(args && args.role),
      names.join("\u001f")
    ].join("\u001e");
    return `craft-assist-material-${hashStableText(seed || "material")}`;
  }

  function mintCraftAssistItemId(args) {
    return `${normalizePersistedId(args.materialId) || mintCraftAssistMaterialId(args)}__${slugifyStableName(args.name)}__${Number(args.itemIndex) + 1}`;
  }

  function projectCraftAssistPersistedMaterials(materials) {
    const out = [];
    for (const material of Array.isArray(materials) ? materials : []) {
      const items = [];
      for (const item of Array.isArray(material && material.items) ? material.items : []) {
        const name = asString(item && item.name).trim();
        if (!name) continue;
        const persistedItem = {
          id: normalizePersistedId(item && item.id),
          name,
          wear_filter_mode: normalizeCraftAssistFilterMode(item && item.wear_filter_mode),
          wear_min: truncateNumber(clampWear01(item && item.wear_min, 0), WEAR_INPUT_DECIMALS),
          wear_max: truncateNumber(clampWear01(item && item.wear_max, 1), WEAR_INPUT_DECIMALS),
          custom_range: !!(item && item.custom_range)
        };
        const displayName = asString(item && item.display_name).trim();
        if (displayName) persistedItem.display_name = displayName;
        const rarity = asString(item && item.rarity).trim();
        if (rarity) persistedItem.rarity = rarity;
        const collection = asString(item && item.collection).trim();
        if (collection) persistedItem.collection = collection;
        items.push(persistedItem);
      }
      if (!items.length) continue;
      const role = normalizeCraftAssistRole(material && material.role);
      const entry = {id: normalizePersistedId(material && material.id), role, count: normalizeCraftAssistRoleCount(material && material.count, role, role === "aux" ? 0 : 1), items};
      if (hasOwn(material, "direction")) entry.direction = normalizeCraftAssistDirection(entry.role, material && material.direction);
      if (material && material.disable_direction_limit === true) entry.disable_direction_limit = true;
      out.push(entry);
    }
    return out;
  }

  function buildCraftAssistCandidateCacheKeyTuple(material, targetValue) {
    const tuple = [numberTextTrunc(targetValue)];
    const items = Array.isArray(material && material.items) ? material.items : [];
    if (items.length) {
      for (const item of items) {
        tuple.push(asString(item && item.name).trim());
        tuple.push(normalizeCraftAssistFilterMode(item && item.wear_filter_mode));
        tuple.push(numberTextTrunc(item && item.wear_min));
        tuple.push(numberTextTrunc(item && item.wear_max));
      }
      return tuple;
    }
    const legacyMode = resolveLegacyMaterialFilterMode(material, "relative");
    for (const name of normalizeCraftAssistNameList(material && material.names)) {
      tuple.push(name, legacyMode, numberTextTrunc(material && material.wear_min), numberTextTrunc(material && material.wear_max));
    }
    return tuple;
  }

  function normalizeCraftAssistMaterialListCanonical(materials, options) {
    const opts = options && typeof options === "object" ? options : {};
    const rows = opts.rows;
    const source = normalizeCraftAssistSource(opts.source);
    const legacyWearFilterMode = normalizeCraftAssistFilterMode(opts.legacyWearFilterMode);
    const normalized = [];
    const seenNames = new Set();
    for (let materialIndex = 0; materialIndex < (Array.isArray(materials) ? materials.length : 0); materialIndex += 1) {
      const entry = materials[materialIndex];
      const role = normalizeCraftAssistRole(entry && entry.role);
      const rawItems = Array.isArray(entry && entry.items) && entry.items.length > 0
        ? entry.items.map((item) => ({
          id: normalizePersistedId(item && item.id),
          name: item && item.name,
          display_name: item && item.display_name,
          rarity: item && item.rarity,
          collection: item && item.collection,
          wear_filter_mode: normalizeCraftAssistFilterMode(item && item.wear_filter_mode),
          wear_min: item && item.wear_min,
          wear_max: item && item.wear_max,
          custom_range: !!(item && item.custom_range)
        }))
        : normalizeCraftAssistNameList(entry && (entry.names != null ? entry.names : entry && entry.name)).map((name) => ({
          id: "",
          name,
          wear_filter_mode: resolveLegacyMaterialFilterMode(entry, legacyWearFilterMode),
          wear_min: entry && entry.wear_min,
          wear_max: entry && entry.wear_max,
          custom_range: !!(entry && entry.custom_range)
        }));
      const materialId = normalizePersistedId(entry && entry.id) || mintCraftAssistMaterialId({
        role,
        rawItems
      });
      const localSeen = new Set();
      const items = [];
      for (const rawItem of rawItems) {
        const name = asString(rawItem && rawItem.name).trim();
        if (!name || localSeen.has(name) || seenNames.has(name)) continue;
        localSeen.add(name);
        seenNames.add(name);
        const resolved = resolveCraftAssistItemDefaultRange(name, {
          wearFilterMode: rawItem && rawItem.wear_filter_mode,
          rows,
          storedRange: rawItem,
          customRange: !!(rawItem && rawItem.custom_range),
          source
        });
        const normalizedItem = {
          id: normalizePersistedId(rawItem && rawItem.id) || mintCraftAssistItemId({materialId, materialIndex, itemIndex: items.length, name}),
          name,
          wear_filter_mode: normalizeCraftAssistFilterMode(rawItem && rawItem.wear_filter_mode),
          wear_min: resolved.wear_min,
          wear_max: resolved.wear_max,
          custom_range: resolved.resolvedCustomRange
        };
        const displayName = asString(rawItem && rawItem.display_name).trim();
        if (displayName) normalizedItem.display_name = displayName;
        const rarity = asString(rawItem && rawItem.rarity).trim();
        if (rarity) normalizedItem.rarity = rarity;
        const collection = asString(rawItem && rawItem.collection).trim();
        if (collection) normalizedItem.collection = collection;
        items.push(normalizedItem);
      }
      if (!items.length) continue;
      const projection = buildTraceProjectionFromNames(items.map((item) => item.name), "");
      const material = {
        id: materialId,
        role,
        count: normalizeCraftAssistRoleCount(
          entry && (entry.count_limit != null ? entry.count_limit : entry && entry.count),
          role,
          role === "aux" ? 0 : 1
        ),
        items,
        item_names: projection.item_names,
        primary_name: projection.primary_name,
        label: projection.label,
        name: projection.primary_name,
        names: projection.item_names.slice()
      };
      if (hasOwn(entry, "direction")) material.direction = normalizeCraftAssistDirection(role, entry && entry.direction);
      if (entry && entry.disable_direction_limit === true) material.disable_direction_limit = true;
      normalized.push(material);
    }
    return normalized;
  }

  return {
    normalizeCraftAssistMaterialListCanonical,
    resolveCraftAssistItemDefaultRange,
    resolveCraftAssistRequiredCount,
    projectCraftAssistPersistedMaterials,
    buildCraftAssistCandidateCacheKeyTuple,
    projectCraftAssistTraceMaterial
  };
}));
