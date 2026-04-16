const Language = require("globaloffensive/language.js");
const {asString} = require("./utils");

const GC_APP_ID = 730;

function parseRequiredInt(value, label, {allowZero = false, defaultValue} = {}) {
  const raw = value == null ? "" : asString(value).trim();
  if (!raw) {
    if (defaultValue != null) {
      return Number(defaultValue);
    }
    throw new Error(`${label} required`);
  }
  const numeric = Number(raw);
  if (!Number.isInteger(numeric) || (!allowZero && numeric <= 0) || (allowZero && numeric < 0)) {
    throw new Error(`${label} must be ${allowZero ? ">= 0" : "> 0"}`);
  }
  return numeric;
}

function parseOptionalInt(value, label, {allowZero = false, defaultValue} = {}) {
  const raw = value == null ? "" : asString(value).trim();
  if (!raw) {
    if (defaultValue != null) {
      return Number(defaultValue);
    }
    return undefined;
  }
  const numeric = Number(raw);
  if (!Number.isInteger(numeric) || (!allowZero && numeric <= 0) || (allowZero && numeric < 0)) {
    throw new Error(`${label} must be ${allowZero ? ">= 0" : "> 0"}`);
  }
  return numeric;
}

function parseBooleanFlag(value, label, defaultValue = false) {
  const raw = value == null ? "" : asString(value).trim().toLowerCase();
  if (!raw) {
    return Boolean(defaultValue);
  }
  if (raw === "true" || raw === "1" || raw === "yes") {
    return true;
  }
  if (raw === "false" || raw === "0" || raw === "no") {
    return false;
  }
  throw new Error(`${label} must be true|false`);
}

function normalizeRedeemMissionRewardOptions(args = {}, {allowMissing = false} = {}) {
  const parseIntField = allowMissing ? parseOptionalInt : parseRequiredInt;
  return {
    accountName: asString(args.account || "").trim(),
    campaignId: parseIntField(args["campaign-id"], "campaign-id"),
    redeemId: parseIntField(args["redeem-id"], "redeem-id", {allowZero: true}),
    redeemableBalance: parseIntField(args.balance, "balance", {allowZero: true}),
    expectedCost: parseIntField(args.cost, "cost", {defaultValue: allowMissing ? undefined : 4}),
    bidControl: parseIntField(args["bid-control"], "bid-control", {allowZero: true, defaultValue: 0}),
    ackTracks: parseBooleanFlag(args["ack-tracks"], "ack-tracks", false),
    ackWaitMs: parseRequiredInt(args["ack-wait-ms"], "ack-wait-ms", {allowZero: true, defaultValue: 500}),
    waitMs: parseRequiredInt(args["wait-ms"], "wait-ms", {allowZero: true, defaultValue: 8000})
  };
}

function encodeVarintUint32(value) {
  let remaining = Number(value);
  if (!Number.isInteger(remaining) || remaining < 0 || remaining > 0xffffffff) {
    throw new Error(`uint32 expected, got ${value}`);
  }
  const bytes = [];
  do {
    let next = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining > 0) {
      next |= 0x80;
    }
    bytes.push(next);
  } while (remaining > 0);
  return Buffer.from(bytes);
}

function encodeVarintField(fieldNumber, value) {
  return Buffer.concat([
    encodeVarintUint32((Number(fieldNumber) << 3) | 0),
    encodeVarintUint32(value)
  ]);
}

function readVarintUint32(payload, initialOffset) {
  let offset = initialOffset;
  let shift = 0;
  let value = 0;

  while (offset < payload.length && shift <= 28) {
    const byte = payload[offset];
    offset += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return {value: value >>> 0, offset};
    }
    shift += 7;
  }

  return null;
}

function decodeVarintFields(payload) {
  if (!Buffer.isBuffer(payload) || !payload.length) {
    return null;
  }

  const fields = new Map();
  let offset = 0;

  while (offset < payload.length) {
    const tagResult = readVarintUint32(payload, offset);
    if (!tagResult) {
      return null;
    }
    const tag = tagResult.value;
    offset = tagResult.offset;

    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x7;
    if (!fieldNumber || wireType !== 0) {
      return null;
    }

    const valueResult = readVarintUint32(payload, offset);
    if (!valueResult) {
      return null;
    }
    offset = valueResult.offset;

    const values = fields.get(fieldNumber) || [];
    values.push(valueResult.value >>> 0);
    fields.set(fieldNumber, values);
  }

  return fields;
}

function decodeRedeemMissionRewardPayload(payload) {
  const fields = decodeVarintFields(payload);
  if (!fields) {
    return null;
  }

  return {
    campaign_id: Number((fields.get(1) || [0])[0] || 0),
    redeem_id: Number((fields.get(2) || [0])[0] || 0),
    redeemable_balance: Number((fields.get(3) || [0])[0] || 0),
    expected_cost: Number((fields.get(4) || [0])[0] || 0),
    bid_control: Number((fields.get(5) || [0])[0] || 0)
  };
}

function buildRedeemMissionRewardPayload({
  campaignId,
  redeemId,
  redeemableBalance,
  expectedCost,
  bidControl = 0
}) {
  const parts = [
    encodeVarintField(1, Number(campaignId)),
    encodeVarintField(2, Number(redeemId)),
    encodeVarintField(3, Number(redeemableBalance)),
    encodeVarintField(4, Number(expectedCost))
  ];
  if (Number(bidControl) !== 0) {
    parts.push(encodeVarintField(5, Number(bidControl)));
  }
  return Buffer.concat(parts);
}

function sendRedeemMissionReward({
  steam,
  campaignId,
  redeemId,
  redeemableBalance,
  expectedCost,
  bidControl = 0,
  onResponse
}) {
  if (!steam || typeof steam.sendToGC !== "function") {
    throw new Error("steam.sendToGC unavailable");
  }

  const payload = buildRedeemMissionRewardPayload({
    campaignId,
    redeemId,
    redeemableBalance,
    expectedCost,
    bidControl
  });

  steam.sendToGC(
    GC_APP_ID,
    Language.ClientRedeemMissionReward,
    {},
    payload,
    typeof onResponse === "function" ? onResponse : undefined
  );

  return payload;
}

module.exports = {
  normalizeRedeemMissionRewardOptions,
  buildRedeemMissionRewardPayload,
  decodeRedeemMissionRewardPayload,
  sendRedeemMissionReward
};
