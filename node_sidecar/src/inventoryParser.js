const {QUALITY_MAP, RARITY_MAP, STORAGE_UNIT_DEF_INDEX, PATHS} = require("./constants");
const {fetchSkinMetadataMap} = require("./skinMetaStore");
const {asString, toFloat, toInt} = require("./utils");

function wearNameFromFloat(floatValue) {
  const v = toFloat(floatValue, 0);
  if (v <= 0.07) return "Factory New";
  if (v <= 0.15) return "Minimal Wear";
  if (v <= 0.38) return "Field-Tested";
  if (v <= 0.45) return "Well-Worn";
  return "Battle-Scarred";
}

function buildItemDisplayName({weaponName, skinName, itemName, floatValue, customName, hasWear}) {
  const weapon = asString(weaponName).trim();
  const skin = asString(skinName).trim();
  const item = asString(itemName).trim();
  const custom = asString(customName).trim();

  let base = "";
  if (weapon) {
    base = skin ? `${weapon} | ${skin}` : weapon;
    if (hasWear) {
      base = `${base} (${wearNameFromFloat(floatValue)})`;
    }
  } else {
    base = item || "Unknown Item";
  }

  if (custom && custom !== base) {
    return `${base} (${custom})`;
  }
  return base;
}

function iterItemAttributes(item) {
  const attrs = item && (item.attribute || item.attributes);
  return Array.isArray(attrs) ? attrs : [];
}

function toBuffer(value) {
  if (!value) {
    return Buffer.alloc(0);
  }
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (typeof value === "object" && value.type === "Buffer" && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }
  if (Array.isArray(value)) {
    return Buffer.from(value);
  }
  return Buffer.alloc(0);
}

function getAttrBytes(item, defIndex) {
  const target = toInt(defIndex, 0);
  for (const attr of iterItemAttributes(item)) {
    if (toInt(attr.def_index, 0) !== target) {
      continue;
    }
    const raw = toBuffer(attr.value_bytes);
    if (raw.length > 0) {
      return raw;
    }
    const valueInt = toInt(attr.value, 0);
    if (valueInt > 0) {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(valueInt >>> 0, 0);
      return b;
    }
    return Buffer.alloc(0);
  }
  return Buffer.alloc(0);
}

function hasAttr(item, defIndex) {
  const target = toInt(defIndex, 0);
  for (const attr of iterItemAttributes(item)) {
    if (toInt(attr.def_index, 0) === target) {
      return true;
    }
  }
  return false;
}

function getAttrFloat(item, defIndex) {
  const b = getAttrBytes(item, defIndex);
  if (b.length >= 4) {
    return b.readFloatLE(0);
  }
  return 0;
}

function getAttrUint32(item, defIndex, {decodeFloatEncoded = true} = {}) {
  const b = getAttrBytes(item, defIndex);
  if (b.length < 4) {
    return 0;
  }
  const rawUint = b.readUInt32LE(0) >>> 0;
  if (!decodeFloatEncoded) {
    return rawUint;
  }
  if (rawUint <= 2_000_000) {
    return rawUint;
  }
  const asFloat = b.readFloatLE(0);
  if (Number.isFinite(asFloat) && asFloat >= 0 && asFloat <= 2_000_000) {
    return Math.round(asFloat);
  }
  return rawUint;
}

function readVarInt(buffer, offset) {
  let value = 0;
  let shift = 0;
  let idx = offset;
  while (idx < buffer.length) {
    const byte = buffer[idx];
    value |= (byte & 0x7f) << shift;
    idx += 1;
    if ((byte & 0x80) === 0) {
      return {ok: true, value, offset: idx};
    }
    shift += 7;
    if (shift > 35) {
      break;
    }
  }
  return {ok: false, value: 0, offset: idx};
}

function decodeProtoStringAttr(raw) {
  let offset = 0;
  while (offset < raw.length) {
    const key = readVarInt(raw, offset);
    if (!key.ok) {
      return "";
    }
    offset = key.offset;
    const wireType = key.value & 0x7;
    const fieldNumber = key.value >>> 3;

    if (wireType === 2) {
      const lenInfo = readVarInt(raw, offset);
      if (!lenInfo.ok) {
        return "";
      }
      offset = lenInfo.offset;
      const end = offset + lenInfo.value;
      if (end > raw.length) {
        return "";
      }
      const chunk = raw.subarray(offset, end);
      offset = end;
      if (fieldNumber === 1) {
        return chunk.toString("utf8").trim();
      }
      continue;
    }

    if (wireType === 0) {
      const skip = readVarInt(raw, offset);
      if (!skip.ok) {
        return "";
      }
      offset = skip.offset;
      continue;
    }
    if (wireType === 5) {
      offset += 4;
      continue;
    }
    if (wireType === 1) {
      offset += 8;
      continue;
    }
    return "";
  }
  return "";
}

function decodeAttrString(item, defIndex) {
  const raw = getAttrBytes(item, defIndex);
  if (!raw.length) {
    return "";
  }
  const parsed = decodeProtoStringAttr(raw);
  if (parsed) {
    return parsed;
  }
  return raw.toString("utf8").replace(/\0+/g, "").trim();
}

function hiddenReason(item) {
  if (toInt(item.flags, 0) === 24) {
    return "flags=24";
  }
  if (hasAttr(item, 277)) {
    return "attr#277";
  }
  if (hasAttr(item, 272) || hasAttr(item, 273)) {
    return "attr#272/273";
  }
  return null;
}

function yellowShieldBlockReason(item) {
  if (toInt(item && item.flags, 0) === 24) {
    return "flags=24";
  }
  if (hasAttr(item, 277)) {
    return "attr#277";
  }
  if (hasAttr(item, 312)) {
    return "attr#312";
  }
  return "";
}

function decodeCasketId(item) {
  const direct = asString(item.casket_id || "").trim();
  if (/^\d+$/.test(direct) && direct !== "0") {
    return direct;
  }

  const low = getAttrUint32(item, 272, {decodeFloatEncoded: false});
  const high = getAttrUint32(item, 273, {decodeFloatEncoded: false});
  if (low > 0 || high > 0) {
    return ((BigInt(high) << 32n) | BigInt(low)).toString();
  }

  if (toInt(item.flags, 0) === 24) {
    const itemId = asString(item.id || "").trim();
    const originalId = asString(item.original_id || "").trim();
    if (/^\d+$/.test(originalId) && originalId !== "0" && originalId !== itemId) {
      return originalId;
    }
  }
  return "";
}

function getCasketContainedItemCount(item) {
  if (toInt(item.def_index, 0) !== STORAGE_UNIT_DEF_INDEX) {
    return 0;
  }
  return getAttrUint32(item, 270, {decodeFloatEncoded: false});
}

function resolveSpecialItemName(item, itemDefs) {
  const styleId = getAttrUint32(item, 113);
  if (styleId > 0) {
    const name = asString(itemDefs[String(styleId)] || "").trim();
    if (name) {
      return name;
    }
  }

  const musicId = getAttrUint32(item, 166);
  if (musicId > 0) {
    const musicName = asString(itemDefs[String(musicId)] || "").trim();
    if (musicName) {
      if (musicName.toLowerCase().startsWith("music kit")) {
        return musicName;
      }
      return `Music Kit | ${musicName}`;
    }
  }
  return "";
}

function resolveDisplayParts(item, schema) {
  const weapons = schema.weapons || {};
  const paints = schema.paints || {};
  const itemDefs = schema.item_defs || {};
  const defIndex = toInt(item.def_index, 0);
  const paintIndex = getAttrUint32(item, 6);
  const resolvedWeapon = asString(weapons[String(defIndex)] || "").trim();
  const resolvedItem = asString(itemDefs[String(defIndex)] || "").trim();
  const hasWear = Boolean(resolvedWeapon);

  if (resolvedWeapon) {
    return {
      weapon_name: resolvedWeapon,
      skin_name: asString(paints[String(paintIndex)] || "").trim(),
      item_name: "",
      paint_index: paintIndex,
      has_wear: true
    };
  }

  const specialName = resolveSpecialItemName(item, itemDefs);
  return {
    weapon_name: "",
    skin_name: asString(paints[String(paintIndex)] || "").trim(),
    item_name: specialName || resolvedItem || `def#${defIndex}`,
    paint_index: paintIndex,
    has_wear: hasWear
  };
}

function isCraftableBySkinMeta(meta) {
  if (!meta) {
    return {isCraftable: false, reason: "meta_not_found"};
  }
  if (!asString(meta.collection).trim()) {
    return {isCraftable: false, reason: "missing_collection"};
  }
  if (!asString(meta.rarity).trim()) {
    return {isCraftable: false, reason: "missing_rarity"};
  }
  if (meta.minfloat === null || meta.maxfloat === null) {
    return {isCraftable: false, reason: "missing_float_range"};
  }
  return {isCraftable: true, reason: "ok"};
}

function enrichAlchemyMetadata(rows, hiddenRows, dbPath) {
  const targetRows = [...rows, ...hiddenRows];
  const marketHashNames = new Set();
  for (const row of targetRows) {
    const mh = asString(row.market_hash_name || row.name || "").trim();
    if (mh) {
      marketHashNames.add(mh);
    }
  }
  const metaMap = fetchSkinMetadataMap([...marketHashNames], dbPath);

  for (const row of targetRows) {
    const mh = asString(row.market_hash_name || row.name || "").trim();
    row.market_hash_name = mh;
    const meta = metaMap.get(mh);
    if (meta) {
      row.alchemy_name = meta.name || mh;
      row.collection = meta.collection;
      row.alchemy_rarity = meta.rarity;
      row.minfloat = meta.minfloat;
      row.maxfloat = meta.maxfloat;
      row.isstattrak = toInt(meta.isstattrak, 0);
      row.wear_range = meta.wear_range;
      row.goods_icon_url = asString(meta.goods_icon_url).trim();
      row.goods_original_icon_url = asString(meta.goods_original_icon_url).trim();
      row.goods_share_thumbnail_url = asString(meta.goods_share_thumbnail_url).trim();
    } else {
      row.alchemy_name = "";
      row.collection = "";
      row.alchemy_rarity = "";
      row.minfloat = null;
      row.maxfloat = null;
      row.isstattrak = 0;
      row.wear_range = null;
      row.goods_icon_url = "";
      row.goods_original_icon_url = "";
      row.goods_share_thumbnail_url = "";
    }
    const craftable = isCraftableBySkinMeta(meta);
    row.is_craftable = craftable.isCraftable;
    row.craftable_reason = craftable.reason;
  }
}

function parseOne(item, schema) {
  const parts = resolveDisplayParts(item, schema);
  const floatValue = getAttrFloat(item, 8);
  const defIndex = toInt(item.def_index, 0);
  const quality = toInt(item.quality, 0);
  const rarity = toInt(item.rarity, 0);
  const inventoryRaw = toInt(item.inventory, 0);
  const yellowShieldReason = yellowShieldBlockReason(item);

  let customName = asString(item.custom_name || "").trim();
  if (!customName) {
    customName = decodeAttrString(item, 111);
  }

  const name = buildItemDisplayName({
    weaponName: parts.weapon_name,
    skinName: parts.skin_name,
    itemName: parts.item_name,
    floatValue,
    customName,
    hasWear: parts.has_wear
  });

  const marketHashName = buildItemDisplayName({
    weaponName: parts.weapon_name,
    skinName: parts.skin_name,
    itemName: parts.item_name,
    floatValue,
    customName: "",
    hasWear: parts.has_wear
  }).trim();

  return {
    asset_id: toInt(item.id, 0),
    def_index: defIndex,
    paint_index: toInt(parts.paint_index, 0),
    paint_seed: getAttrUint32(item, 7),
    float_value: floatValue,
    quality,
    rarity,
    origin: toInt(item.origin, 0),
    flags: toInt(item.flags, 0),
    inventory: inventoryRaw,
    tradable_after: getAttrUint32(item, 75, {decodeFloatEncoded: false}),
    trade_lock_kind: yellowShieldReason ? "yellow_shield" : "",
    yellow_shield_blocked: !!yellowShieldReason,
    name,
    market_hash_name: marketHashName,
    alchemy_name: "",
    collection: "",
    alchemy_rarity: "",
    minfloat: null,
    maxfloat: null,
    isstattrak: 0,
    wear_range: null,
    goods_icon_url: "",
    goods_original_icon_url: "",
    goods_share_thumbnail_url: "",
    is_craftable: false,
    craftable_reason: "meta_not_loaded",
    casket_id: decodeCasketId(item),
    casket_contained_item_count: getCasketContainedItemCount(item),
    hidden_reason: null,
    quality_name: QUALITY_MAP[quality] || `Unknown(${quality})`,
    rarity_name: RARITY_MAP[rarity] || `Unknown(${rarity})`
  };
}

function sortRowsByAssetId(rows) {
  rows.sort((a, b) => {
    const av = toInt(a.asset_id, 0);
    const bv = toInt(b.asset_id, 0);
    return av - bv;
  });
}

function parseInventory(inventory, schema, {includeHidden = true, dbPath = PATHS.SKIN_DB_FILE} = {}) {
  const visible = [];
  const hidden = [];
  for (const item of inventory || []) {
    const row = parseOne(item, schema);
    const reason = hiddenReason(item);
    if (reason) {
      row.hidden_reason = reason;
      hidden.push(row);
      if (!includeHidden) {
        continue;
      }
    }
    visible.push(row);
  }

  sortRowsByAssetId(visible);
  sortRowsByAssetId(hidden);
  enrichAlchemyMetadata(visible, hidden, dbPath);
  return {rows: visible, hiddenRows: hidden};
}

module.exports = {
  wearNameFromFloat,
  buildItemDisplayName,
  parseInventory,
  hiddenReason,
  decodeCasketId,
  getAttrBytes,
  getAttrUint32,
  decodeAttrString
};
