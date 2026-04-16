const GC_APP_ID = 730;
const XP_SHOP_NOTIFY_MSG_TYPE = 9221;
const XP_SHOP_ACK_TRACKS_MSG_TYPE = 9222;

function normalizePayload(payload) {
  if (Buffer.isBuffer(payload)) {
    return payload;
  }
  if (payload instanceof Uint8Array) {
    return Buffer.from(payload);
  }
  return null;
}

function readVarint(payload, initialOffset) {
  let offset = initialOffset;
  let shift = 0n;
  let value = 0n;

  while (offset < payload.length) {
    const byte = BigInt(payload[offset]);
    offset += 1;
    value |= (byte & 0x7fn) << shift;
    if ((byte & 0x80n) === 0n) {
      return {value, offset};
    }
    shift += 7n;
  }

  return null;
}

function readLengthDelimited(payload, initialOffset) {
  const lengthResult = readVarint(payload, initialOffset);
  if (!lengthResult) {
    return null;
  }

  const length = Number(lengthResult.value);
  const start = lengthResult.offset;
  const end = start + length;
  if (end > payload.length) {
    return null;
  }

  return {
    payload: payload.subarray(start, end),
    offset: end
  };
}

function skipField(payload, offset, wireType) {
  if (wireType === 0) {
    return readVarint(payload, offset);
  }
  if (wireType === 2) {
    return readLengthDelimited(payload, offset);
  }
  if (wireType === 1) {
    return {offset: offset + 8};
  }
  if (wireType === 5) {
    return {offset: offset + 4};
  }
  return null;
}

function decodeXpShopObject(payload) {
  const buffer = normalizePayload(payload);
  if (!buffer || !buffer.length) {
    return null;
  }

  const fields = new Map();
  let offset = 0;

  while (offset < buffer.length) {
    const tagResult = readVarint(buffer, offset);
    if (!tagResult) {
      return null;
    }
    offset = tagResult.offset;

    const fieldNumber = Number(tagResult.value >> 3n);
    const wireType = Number(tagResult.value & 0x7n);
    if (!fieldNumber || wireType !== 0) {
      return null;
    }

    const valueResult = readVarint(buffer, offset);
    if (!valueResult) {
      return null;
    }
    offset = valueResult.offset;

    const values = fields.get(fieldNumber) || [];
    values.push(Number(valueResult.value));
    fields.set(fieldNumber, values);
  }

  return {
    field1_time: Number((fields.get(1) || [0])[0] || 0),
    redeemable_balance: Number((fields.get(2) || [0])[0] || 0),
    xp_track_values: (fields.get(3) || []).map((value) => Number(value || 0))
  };
}

function decodeNotifyXpShopPayload(payload) {
  const buffer = normalizePayload(payload);
  if (!buffer) {
    return null;
  }

  const message = {
    prematch: null,
    postmatch: null,
    current_xp: 0,
    current_level: 0
  };

  let offset = 0;
  while (offset < buffer.length) {
    const tagResult = readVarint(buffer, offset);
    if (!tagResult) {
      return null;
    }
    offset = tagResult.offset;

    const fieldNumber = Number(tagResult.value >> 3n);
    const wireType = Number(tagResult.value & 0x7n);

    if ((fieldNumber === 1 || fieldNumber === 2) && wireType === 2) {
      const payloadResult = readLengthDelimited(buffer, offset);
      if (!payloadResult) {
        return null;
      }
      offset = payloadResult.offset;
      const decoded = decodeXpShopObject(payloadResult.payload);
      if (!decoded) {
        return null;
      }
      if (fieldNumber === 1) {
        message.prematch = decoded;
      } else {
        message.postmatch = decoded;
      }
      continue;
    }

    if ((fieldNumber === 3 || fieldNumber === 4) && wireType === 0) {
      const valueResult = readVarint(buffer, offset);
      if (!valueResult) {
        return null;
      }
      offset = valueResult.offset;
      const numeric = Number(valueResult.value);
      if (fieldNumber === 3) {
        message.current_xp = numeric;
      } else {
        message.current_level = numeric;
      }
      continue;
    }

    const skipped = skipField(buffer, offset, wireType);
    if (!skipped || skipped.offset > buffer.length) {
      return null;
    }
    offset = skipped.offset;
  }

  return message;
}

function sendAckXpShopTracks({steam, onResponse} = {}) {
  if (!steam || typeof steam.sendToGC !== "function") {
    throw new Error("steam.sendToGC unavailable");
  }

  const payload = Buffer.alloc(0);
  steam.sendToGC(
    GC_APP_ID,
    XP_SHOP_ACK_TRACKS_MSG_TYPE,
    {},
    payload,
    typeof onResponse === "function" ? onResponse : undefined
  );

  return payload;
}

module.exports = {
  XP_SHOP_NOTIFY_MSG_TYPE,
  XP_SHOP_ACK_TRACKS_MSG_TYPE,
  decodeXpShopObject,
  decodeNotifyXpShopPayload,
  sendAckXpShopTracks
};
