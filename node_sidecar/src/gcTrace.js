const {EventEmitter} = require("node:events");
const GcLanguage = require("globaloffensive/language.js");
const GcProtos = require("globaloffensive/protobufs/generated/_load.js");
const {asString} = require("./utils");
const {decodeRedeemMissionRewardPayload} = require("./redeemMissionReward");
const {
  XP_SHOP_NOTIFY_MSG_TYPE,
  XP_SHOP_ACK_TRACKS_MSG_TYPE,
  decodeNotifyXpShopPayload,
  decodeXpShopObject
} = require("./xpShopMessages");

const GC_TRACE_SCOPE = "gc_trace";
const GC_TRACE_APPID = 730;
const GC_TRACE_STATE = Symbol("cs2.gc.trace");
const GC_ARMORY_STATE_CHANGE = "armory_state_changed";
const GC_TRACE_HISTORY_LIMIT = 200;
const GC_TRACE_NAME_BY_ID = new Map([
  ...Object.entries(GcLanguage).map(([name, id]) => [Number(id), name]),
  [XP_SHOP_NOTIFY_MSG_TYPE, "GC2ClientNotifyXPShop"],
  [XP_SHOP_ACK_TRACKS_MSG_TYPE, "Client2GcAckXPShopTracks"]
]);
const GC_TRACE_ITEM_CUSTOMIZATION_NAME_BY_ID = new Map(
  Object.entries(GcProtos.EGCItemCustomizationNotification || {}).map(([name, id]) => [
    id,
    name.replace(/^k_EGCItemCustomizationNotification_/, "")
  ])
);
const GC_TRACE_MESSAGE_SPECS = new Map([
  [GcLanguage.ClientWelcome, {proto: GcProtos.CMsgClientWelcome, summarize: summarizeClientWelcome}],
  [GcLanguage.SO_Create, {proto: GcProtos.CMsgSOSingleObject, summarize: summarizeSingleSoEnvelope}],
  [GcLanguage.SO_Update, {proto: GcProtos.CMsgSOSingleObject, summarize: summarizeSingleSoEnvelope}],
  [GcLanguage.SO_Destroy, {proto: GcProtos.CMsgSOSingleObject, summarize: summarizeSingleSoEnvelope}],
  [GcLanguage.SO_UpdateMultiple, {proto: GcProtos.CMsgSOMultipleObjects, summarize: summarizeMultiSoEnvelope}],
  [GcLanguage.MatchmakingGC2ClientHello, {proto: GcProtos.CMsgGCCStrike15_v2_MatchmakingGC2ClientHello, summarize: summarizeMatchmakingHello}],
  [GcLanguage.ClientRedeemMissionReward, {decode: decodeRedeemMissionRewardPayload, summarize: summarizeMissionReward}],
  [XP_SHOP_NOTIFY_MSG_TYPE, {decode: decodeNotifyXpShopPayload, summarize: summarizeNotifyXpShop}],
  [XP_SHOP_ACK_TRACKS_MSG_TYPE, {decode: decodeAckXpShopTracksPayload, summarize: summarizeAckXpShopTracks}],
  [GcLanguage.ClientRedeemFreeReward, {proto: GcProtos.CMsgGCCstrike15_v2_ClientRedeemFreeReward, summarize: summarizeFreeReward}],
  [GcLanguage.ItemCustomizationNotification, {proto: GcProtos.CMsgGCItemCustomizationNotification, summarize: summarizeItemCustomizationNotification}]
]);
const GC_TRACE_SO_CANDIDATES = [
  {
    name: "CSOAccountXpShop",
    decode: decodeXpShopObject,
    isMeaningful(message, context = {}) {
      const field1Time = Number(message.field1_time || 0);
      const redeemableBalance = Number(message.redeemable_balance || 0);
      const xpTrackValues = normalizeArray(message.xp_track_values).map((value) => Number(value || 0));
      const hasValidShape = isReasonableUnixTime(field1Time)
        && isWithinRange(redeemableBalance, 0, 100000);
      const hasValidTracks = xpTrackValues.length > 0
        && xpTrackValues.length <= 10
        && xpTrackValues.every((value) => isWithinRange(value, 0, 1000000))
        && xpTrackValues.some((value) => value > 0);
      if (hasValidTracks) {
        return hasValidShape;
      }
      return hasValidShape && Number(context && context.typeId || 0) === 6;
    },
    summarize(message) {
      const parts = [];
      const field1Time = Number(message.field1_time || 0);
      const redeemableBalance = Number(message.redeemable_balance || 0);
      const xpTrackValues = normalizeArray(message.xp_track_values).map((value) => Number(value || 0));
      if (field1Time > 0) {
        parts.push(`field1_time=${field1Time}`);
      }
      parts.push(`redeemable_balance=${redeemableBalance}`);
      if (xpTrackValues.length) {
        parts.push(`xp_tracks_count=${xpTrackValues.length}`);
        parts.push(`xp_track_values=${xpTrackValues.slice(0, 5).join("|")}`);
      }
      return parts;
    }
  },
  {
    name: "CSOAccountXpShopBids",
    decode: decodeXpShopBidsObject,
    isMeaningful(message) {
      const campaignId = Number(message.campaign_id || 0);
      const redeemId = Number(message.redeem_id || 0);
      const expectedCost = Number(message.expected_cost || 0);
      const generationTime = Number(message.generation_time || 0);
      return isWithinRange(campaignId, 1, 10000)
        && isWithinRange(redeemId, 0, 100000)
        && isWithinRange(expectedCost, 1, 100000)
        && isReasonableUnixTime(generationTime);
    },
    summarize(message) {
      return collectNumericParts(message, [
        "campaign_id",
        {name: "redeem_id", includeZero: true},
        "expected_cost",
        "generation_time"
      ]);
    }
  },
  {
    name: "CSOAccountSeasonalOperation",
    proto: GcProtos.CSOAccountSeasonalOperation,
    isMeaningful(message) {
      const seasonValue = Number(message.season_value || 0);
      const tierUnlocked = Number(message.tier_unlocked || 0);
      const premiumTiers = Number(message.premium_tiers || 0);
      const missionId = Number(message.mission_id || 0);
      const missionsCompleted = Number(message.missions_completed || 0);
      const redeemableBalance = Number(message.redeemable_balance || 0);
      const seasonPassTime = Number(message.season_pass_time || 0);
      const hasUsefulState = [
        tierUnlocked,
        premiumTiers,
        missionId,
        missionsCompleted,
        redeemableBalance,
        seasonPassTime
      ].some((value) => value > 0);
      return hasUsefulState
        && isWithinRange(seasonValue, 1, 10000)
        && isWithinRange(tierUnlocked, 0, 5000)
        && isWithinRange(premiumTiers, 0, 5000)
        && isWithinRange(missionId, 0, 1000000)
        && isWithinRange(missionsCompleted, 0, 100000)
        && isWithinRange(redeemableBalance, 0, 100000);
    },
    summarize(message) {
      return collectNumericParts(message, [
        "season_value",
        "tier_unlocked",
        "premium_tiers",
        "mission_id",
        "missions_completed",
        "redeemable_balance",
        "season_pass_time"
      ]);
    }
  },
  {
    name: "CSOAccountItemPersonalStore",
    proto: GcProtos.CSOAccountItemPersonalStore,
    isMeaningful(message) {
      const generationTime = Number(message.generation_time || 0);
      const redeemableBalance = Number(message.redeemable_balance || 0);
      const items = normalizeArray(message.items);
      return isReasonableUnixTime(generationTime)
        && isWithinRange(redeemableBalance, 0, 100000)
        && (items.length > 1 || redeemableBalance > 0);
    },
    summarize(message) {
      const parts = collectNumericParts(message, [
        "generation_time",
        "redeemable_balance"
      ]);
      const items = normalizeArray(message.items);
      if (items.length) {
        parts.push(`items_count=${items.length}`);
        parts.push(`items_preview=${items.slice(0, 4).join("|")}`);
      }
      return parts;
    }
  }
];

function formatTraceError(err) {
  const message = asString(err && err.message ? err.message : err).trim() || "unknown_error";
  const code = asString(err && (err.eresult || err.code || "")).trim();
  return code ? `${message} code=${code}` : message;
}

function isGcTraceEnabled(explicitEnabled) {
  if (typeof explicitEnabled === "boolean") {
    return explicitEnabled;
  }
  return asString(process.env.CS2_GC_TRACE).trim() === "1";
}

function normalizeGcPayload(payload) {
  if (Buffer.isBuffer(payload)) {
    return payload;
  }
  if (payload instanceof Uint8Array) {
    return Buffer.from(payload);
  }
  if (typeof payload === "string") {
    const normalized = asString(payload).trim();
    if (!normalized) {
      return null;
    }
    try {
      return Buffer.from(normalized, "base64");
    } catch (_) {
      return null;
    }
  }
  if (payload && typeof payload.toBuffer === "function") {
    try {
      return Buffer.from(payload.toBuffer());
    } catch (_) {
      return null;
    }
  }
  return null;
}

function resolveGcMessageName(msgType) {
  return GC_TRACE_NAME_BY_ID.get(msgType) || `msg_${msgType}`;
}

function cloneTraceSoObjects(soObjects) {
  return normalizeArray(soObjects).map((entry) => {
    const cloned = {
      group: asString(entry && entry.group).trim(),
      index: Number(entry && entry.index || 0),
      type_id: Number(entry && entry.type_id || 0),
      object_data_hex: asString(entry && entry.object_data_hex).trim()
    };
    if (entry && Object.prototype.hasOwnProperty.call(entry, "cache_index")) {
      cloned.cache_index = Number(entry.cache_index || 0);
    }
    if (entry && Object.prototype.hasOwnProperty.call(entry, "cache_object_index")) {
      cloned.cache_object_index = Number(entry.cache_object_index || 0);
    }
    return cloned;
  });
}

function cloneTraceMessage(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  return {
    timestamp: asString(entry.timestamp).trim(),
    direction: asString(entry.direction).trim(),
    msg_type: Number(entry.msg_type || 0),
    msg_name: asString(entry.msg_name).trim(),
    bytes: Number(entry.bytes || 0),
    lines: normalizeArray(entry.lines).map((line) => asString(line).trim()),
    payload_hex: asString(entry.payload_hex).trim(),
    raw_payload_base64: asString(entry.raw_payload_base64).trim(),
    payload_hex_preview: asString(entry.payload_hex_preview).trim(),
    so_objects: cloneTraceSoObjects(entry.so_objects)
  };
}

function makeTraceSoObject(group, index, typeId, payload, extra = {}) {
  const buffer = normalizeGcPayload(payload);
  if (!buffer || !buffer.length) {
    return null;
  }
  const entry = {
    group: asString(group).trim(),
    index: Number(index || 0),
    type_id: Number(typeId || 0),
    object_data_hex: buffer.toString("hex")
  };
  if (Object.prototype.hasOwnProperty.call(extra, "cacheIndex")) {
    entry.cache_index = Number(extra.cacheIndex || 0);
  }
  if (Object.prototype.hasOwnProperty.call(extra, "cacheObjectIndex")) {
    entry.cache_object_index = Number(extra.cacheObjectIndex || 0);
  }
  return entry;
}

function extractClientWelcomeSoObjects(message) {
  const entries = [];
  normalizeArray(message && message.outofdate_subscribed_caches).forEach((cache, cacheIndex) => {
    normalizeArray(cache && cache.objects).forEach((cacheObject, cacheObjectIndex) => {
      normalizeArray(cacheObject && cacheObject.object_data).forEach((objectData, objectIndex) => {
        const soObject = makeTraceSoObject(
          "outofdate_subscribed_caches",
          objectIndex,
          cacheObject && cacheObject.type_id,
          objectData,
          {
            cacheIndex,
            cacheObjectIndex
          }
        );
        if (soObject) {
          entries.push(soObject);
        }
      });
    });
  });
  return entries;
}

function extractSingleEnvelopeSoObjects(message) {
  const soObject = makeTraceSoObject("object_data", 0, message && message.type_id, message && message.object_data);
  return soObject ? [soObject] : [];
}

function extractMultiEnvelopeSoObjects(message) {
  const entries = [];
  const groups = [
    ["objects_modified", normalizeArray(message && message.objects_modified)],
    ["objects_added", normalizeArray(message && message.objects_added)],
    ["objects_removed", normalizeArray(message && message.objects_removed)]
  ];

  groups.forEach(([groupName, objects]) => {
    objects.forEach((entry, index) => {
      const soObject = makeTraceSoObject(groupName, index, entry && entry.type_id, entry && entry.object_data);
      if (soObject) {
        entries.push(soObject);
      }
    });
  });

  return entries;
}

function extractTraceSoObjects(msgType, message) {
  if (!message || typeof message !== "object") {
    return [];
  }
  if (msgType === GcLanguage.ClientWelcome) {
    return extractClientWelcomeSoObjects(message);
  }
  if (
    msgType === GcLanguage.SO_Create
    || msgType === GcLanguage.SO_Update
    || msgType === GcLanguage.SO_Destroy
  ) {
    return extractSingleEnvelopeSoObjects(message);
  }
  if (msgType === GcLanguage.SO_UpdateMultiple) {
    return extractMultiEnvelopeSoObjects(message);
  }
  return [];
}

function buildTraceMessageEntry({direction, msgType, payload}) {
  const buffer = normalizeGcPayload(payload);
  if (!buffer) {
    return null;
  }

  const numericMsgType = Number(msgType || 0);
  const spec = GC_TRACE_MESSAGE_SPECS.get(numericMsgType);
  const entry = {
    timestamp: new Date().toISOString(),
    direction: asString(direction).trim(),
    msg_type: numericMsgType,
    msg_name: resolveGcMessageName(numericMsgType),
    bytes: buffer.length,
    lines: [],
    payload_hex: buffer.toString("hex"),
    raw_payload_base64: buffer.toString("base64"),
    so_objects: [],
    payload_hex_preview: buffer.subarray(0, Math.min(buffer.length, 32)).toString("hex")
  };

  if (!spec) {
    entry.lines = [`bytes=${buffer.length}`];
    return entry;
  }

  try {
    const decoded = typeof spec.decode === "function"
      ? spec.decode(buffer)
      : decodeProtoToObject(spec.proto, buffer);
    const linePartsList = normalizeArray(spec.summarize(decoded));
    entry.lines = linePartsList.map((parts) =>
      normalizeArray(parts)
        .map((part) => asString(part).trim())
        .filter(Boolean)
        .join(" ")
    );
    entry.so_objects = extractTraceSoObjects(numericMsgType, decoded);
    return entry;
  } catch (err) {
    entry.lines = [[`decode_error=${formatTraceError(err)}`, `bytes=${buffer.length}`].join(" ")];
    return entry;
  }
}

function rememberTraceMessage(traceState, entry) {
  if (!traceState || !entry) {
    return;
  }
  if (!Array.isArray(traceState.recentMessages)) {
    traceState.recentMessages = [];
  }
  traceState.recentMessages.push(entry);
  if (traceState.recentMessages.length > GC_TRACE_HISTORY_LIMIT) {
    traceState.recentMessages.splice(0, traceState.recentMessages.length - GC_TRACE_HISTORY_LIMIT);
  }
}

function addTraceMessageConsumer(traceState, consumer) {
  if (!traceState || typeof consumer !== "function") {
    return;
  }
  if (!Array.isArray(traceState.messageConsumers)) {
    traceState.messageConsumers = [];
  }
  if (!traceState.messageConsumers.includes(consumer)) {
    traceState.messageConsumers.push(consumer);
  }
}

function publishTraceMessage(traceState, entry) {
  if (!traceState || !entry) {
    return;
  }
  rememberTraceMessage(traceState, entry);
  const consumers = Array.isArray(traceState.messageConsumers) ? traceState.messageConsumers : [];
  if (!consumers.length) {
    return;
  }
  const clonedEntry = cloneTraceMessage(entry);
  consumers.forEach((consumer) => {
    try {
      consumer(clonedEntry);
    } catch (_) {}
  });
}

function decodeProtoToObject(proto, payload) {
  if (!proto || !payload || !payload.length) {
    return null;
  }
  const decoded = proto.decode(payload);
  return proto.toObject(decoded, {
    defaults: true,
    longs: String
  });
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function createEmptyArmoryState() {
  return {
    seasonal_operation: null,
    xp_shop: null,
    xp_shop_bids: [],
    notify: null,
    last_item_customization: null,
    last_redeem_response: null,
    updated_at: ""
  };
}

function cloneArmoryState(state) {
  return JSON.parse(JSON.stringify(state || createEmptyArmoryState()));
}

function normalizeXpShopState(message) {
  if (!message || typeof message !== "object") {
    return null;
  }
  return {
    generation_time: Number(message.generation_time || message.field1_time || 0),
    redeemable_balance: Number(message.redeemable_balance || 0),
    xp_tracks: normalizeArray(message.xp_track_values || message.xp_tracks).map((value) => Number(value || 0))
  };
}

function normalizeXpShopBid(message) {
  if (!message || typeof message !== "object") {
    return null;
  }
  return {
    campaign_id: Number(message.campaign_id || 0),
    redeem_id: Number(message.redeem_id || 0),
    expected_cost: Number(message.expected_cost || 0),
    generation_time: Number(message.generation_time || 0)
  };
}

function normalizeSeasonalOperationState(message) {
  if (!message || typeof message !== "object") {
    return null;
  }
  return {
    season_value: Number(message.season_value || 0),
    tier_unlocked: Number(message.tier_unlocked || 0),
    premium_tiers: Number(message.premium_tiers || 0),
    mission_id: Number(message.mission_id || 0),
    missions_completed: Number(message.missions_completed || 0),
    redeemable_balance: Number(message.redeemable_balance || 0),
    season_pass_time: Number(message.season_pass_time || 0)
  };
}

function normalizeNotifyXpShopState(message) {
  if (!message || typeof message !== "object") {
    return null;
  }
  return {
    prematch: normalizeXpShopState(message.prematch),
    postmatch: normalizeXpShopState(message.postmatch),
    current_xp: Number(message.current_xp || 0),
    current_level: Number(message.current_level || 0)
  };
}

function normalizeItemCustomizationNotificationState(message) {
  if (!message || typeof message !== "object") {
    return null;
  }
  const request = Number(message.request || 0);
  return {
    item_ids: normalizeArray(message.item_id).map((value) => asString(value).trim()).filter(Boolean),
    request,
    request_name: GC_TRACE_ITEM_CUSTOMIZATION_NAME_BY_ID.get(request) || "",
    extra_data: normalizeArray(message.extra_data).map((value) => asString(value).trim()).filter(Boolean)
  };
}

function isArmoryCandidateName(name) {
  return name === "CSOAccountXpShop"
    || name === "CSOAccountXpShopBids"
    || name === "CSOAccountSeasonalOperation";
}

function selectSoCandidatesForTypeId(typeId) {
  const numericTypeId = Number(typeId || 0);
  if (numericTypeId === 6) {
    return GC_TRACE_SO_CANDIDATES.filter((candidate) =>
      candidate.name === "CSOAccountXpShop" || candidate.name === "CSOAccountXpShopBids"
    );
  }
  if (numericTypeId === 4) {
    return GC_TRACE_SO_CANDIDATES.filter((candidate) => candidate.name === "CSOAccountItemPersonalStore");
  }
  return GC_TRACE_SO_CANDIDATES;
}

function decodeArmoryCandidate(payload, context = {}) {
  const buffer = normalizeGcPayload(payload);
  if (!buffer || !buffer.length) {
    return null;
  }
  for (const candidate of selectSoCandidatesForTypeId(context.typeId)) {
    if (!isArmoryCandidateName(candidate.name)) {
      continue;
    }
    try {
      const decoded = typeof candidate.decode === "function"
        ? candidate.decode(buffer)
        : decodeProtoToObject(candidate.proto, buffer);
      if (!decoded || !candidate.isMeaningful(decoded, context)) {
        continue;
      }
      return {
        name: candidate.name,
        message: decoded
      };
    } catch (_) {}
  }
  return null;
}

function upsertArmoryBid(list, bid) {
  const items = Array.isArray(list) ? list.slice() : [];
  const nextBid = normalizeXpShopBid(bid);
  if (!nextBid) {
    return items;
  }
  const next = items.filter((entry) =>
    !(Number(entry && entry.campaign_id || 0) === nextBid.campaign_id
      && Number(entry && entry.redeem_id || 0) === nextBid.redeem_id)
  );
  next.push(nextBid);
  next.sort((left, right) => {
    if (left.campaign_id !== right.campaign_id) {
      return left.campaign_id - right.campaign_id;
    }
    return left.redeem_id - right.redeem_id;
  });
  return next;
}

function removeArmoryBid(list, bid) {
  const target = normalizeXpShopBid(bid);
  if (!target) {
    return Array.isArray(list) ? list.slice() : [];
  }
  return (Array.isArray(list) ? list : []).filter((entry) =>
    !(Number(entry && entry.campaign_id || 0) === target.campaign_id
      && Number(entry && entry.redeem_id || 0) === target.redeem_id)
  );
}

function applyArmoryCandidateToState(state, candidate, action = "upsert") {
  if (!state || !candidate || !candidate.name) {
    return false;
  }
  if (candidate.name === "CSOAccountXpShop") {
    if (action === "remove") {
      return false;
    }
    state.xp_shop = normalizeXpShopState(candidate.message);
    return true;
  }
  if (candidate.name === "CSOAccountXpShopBids") {
    state.xp_shop_bids = action === "remove"
      ? removeArmoryBid(state.xp_shop_bids, candidate.message)
      : upsertArmoryBid(state.xp_shop_bids, candidate.message);
    return true;
  }
  if (candidate.name === "CSOAccountSeasonalOperation") {
    if (action === "remove") {
      return false;
    }
    state.seasonal_operation = normalizeSeasonalOperationState(candidate.message);
    return true;
  }
  return false;
}

function mutateArmoryState(traceState, source, mutator) {
  if (!traceState || typeof mutator !== "function") {
    return;
  }
  const before = JSON.stringify(traceState.armoryState);
  mutator(traceState.armoryState);
  const after = JSON.stringify(traceState.armoryState);
  if (before === after) {
    return;
  }
  traceState.armoryState.updated_at = new Date().toISOString();
  if (traceState.events) {
    traceState.events.emit(GC_ARMORY_STATE_CHANGE, cloneArmoryState(traceState.armoryState), {source});
  }
}

function readProtoVarint(payload, initialOffset) {
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

function decodeVarintFields(payload) {
  if (!payload || !payload.length) {
    return null;
  }
  const fields = new Map();
  let offset = 0;
  while (offset < payload.length) {
    const tagResult = readProtoVarint(payload, offset);
    if (!tagResult) {
      return null;
    }
    const tag = tagResult.value;
    offset = tagResult.offset;
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x7n);
    if (!fieldNumber) {
      return null;
    }
    if (wireType === 0) {
      const valueResult = readProtoVarint(payload, offset);
      if (!valueResult) {
        return null;
      }
      offset = valueResult.offset;
      const values = fields.get(fieldNumber) || [];
      values.push(Number(valueResult.value));
      fields.set(fieldNumber, values);
      continue;
    }
    if (wireType === 1) {
      offset += 8;
      continue;
    }
    if (wireType === 2) {
      const lengthResult = readProtoVarint(payload, offset);
      if (!lengthResult) {
        return null;
      }
      offset = lengthResult.offset + Number(lengthResult.value);
      continue;
    }
    if (wireType === 5) {
      offset += 4;
      continue;
    }
    return null;
  }
  return fields;
}

function decodeAckXpShopTracksPayload(payload) {
  const buffer = normalizeGcPayload(payload) || Buffer.alloc(0);
  return {
    bytes: buffer.length
  };
}

function decodeXpShopBidsObject(payload) {
  if (!payload || !payload.length) {
    return null;
  }

  const fields = new Map();
  let offset = 0;

  while (offset < payload.length) {
    const tagResult = readProtoVarint(payload, offset);
    if (!tagResult) {
      return null;
    }
    const tag = Number(tagResult.value);
    offset = tagResult.offset;

    const fieldNumber = tag >> 3;
    const wireType = tag & 0x7;
    if (wireType !== 0 || fieldNumber < 1 || fieldNumber > 4) {
      return null;
    }

    const valueResult = readProtoVarint(payload, offset);
    if (!valueResult) {
      return null;
    }
    offset = valueResult.offset;

    const values = fields.get(fieldNumber) || [];
    values.push(Number(valueResult.value || 0));
    fields.set(fieldNumber, values);
  }

  return {
    campaign_id: Number((fields.get(1) || [0])[0] || 0),
    redeem_id: Number((fields.get(2) || [0])[0] || 0),
    expected_cost: Number((fields.get(3) || [0])[0] || 0),
    generation_time: Number((fields.get(4) || [0])[0] || 0)
  };
}

function collectNumericParts(message, fields) {
  const parts = [];
  for (const field of fields) {
    const spec = typeof field === "string" ? {name: field, includeZero: false} : field;
    const value = Number(message[spec.name] || 0);
    if (value > 0 || (spec.includeZero && value === 0)) {
      parts.push(`${spec.name}=${value}`);
    }
  }
  return parts;
}

function isWithinRange(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function isReasonableUnixTime(value) {
  return isWithinRange(value, 1700000000, 2000000000);
}

function pushIfTruthy(parts, key, value) {
  const normalized = asString(value).trim();
  if (normalized) {
    parts.push(`${key}=${normalized}`);
  }
}

function summarizeMissionReward(message) {
  return [collectNumericParts(message, [
    "campaign_id",
    {name: "redeem_id", includeZero: true},
    {name: "redeemable_balance", includeZero: true},
    {name: "expected_cost", includeZero: true},
    {name: "bid_control", includeZero: true}
  ])];
}

function summarizeNotifyXpShop(message) {
  const parts = [];
  const prematchBalance = Number(message && message.prematch && message.prematch.redeemable_balance || 0);
  const postmatchBalance = Number(message && message.postmatch && message.postmatch.redeemable_balance || 0);
  const currentXp = Number(message && message.current_xp || 0);
  const currentLevel = Number(message && message.current_level || 0);

  if (prematchBalance > 0) {
    parts.push(`prematch_balance=${prematchBalance}`);
  }
  if (postmatchBalance > 0) {
    parts.push(`postmatch_balance=${postmatchBalance}`);
  }
  if (currentXp > 0) {
    parts.push(`current_xp=${currentXp}`);
  }
  if (currentLevel > 0) {
    parts.push(`current_level=${currentLevel}`);
  }

  const prematchTracks = normalizeArray(message && message.prematch && message.prematch.xp_track_values);
  if (prematchTracks.length) {
    parts.push(`prematch_tracks=${prematchTracks.slice(0, 5).join("|")}`);
  }

  const postmatchTracks = normalizeArray(message && message.postmatch && message.postmatch.xp_track_values);
  if (postmatchTracks.length) {
    parts.push(`postmatch_tracks=${postmatchTracks.slice(0, 5).join("|")}`);
  }

  return [parts];
}

function summarizeAckXpShopTracks(message) {
  return [[`bytes=${Number(message && message.bytes || 0)}`]];
}

function summarizeFreeReward(message) {
  const parts = collectNumericParts(message, [
    "generation_time",
    "redeemable_balance"
  ]);
  const items = normalizeArray(message.items);
  if (items.length) {
    parts.push(`items_count=${items.length}`);
    parts.push(`items_preview=${items.slice(0, 4).join("|")}`);
  }
  return [parts];
}

function summarizeMatchmakingHello(message) {
  const parts = [];
  if (Number(message.account_id || 0) > 0) {
    parts.push(`account_id=${message.account_id}`);
  }
  if (Number(message.player_level || 0) > 0) {
    parts.push(`player_level=${message.player_level}`);
  }
  if (Number(message.player_cur_xp || 0) > 0) {
    parts.push(`player_cur_xp=${message.player_cur_xp}`);
  }
  if (Number(message.operation_reward || 0) > 0) {
    parts.push(`operation_reward=${message.operation_reward}`);
  }
  return [parts];
}

function summarizeItemCustomizationNotification(message) {
  const parts = [];
  const itemIds = normalizeArray(message.item_id);
  if (itemIds.length) {
    parts.push(`item_ids=${itemIds.slice(0, 4).join("|")}`);
  }
  if (message.request != null) {
    parts.push(`request=${message.request}`);
    const requestName = GC_TRACE_ITEM_CUSTOMIZATION_NAME_BY_ID.get(Number(message.request));
    if (requestName) {
      parts.push(`request_name=${requestName}`);
    }
  }
  return [parts];
}

function summarizeClientWelcome(message) {
  const lines = [];
  const caches = normalizeArray(message.outofdate_subscribed_caches);
  lines.push([`outofdate_cache_count=${caches.length}`]);

  caches.forEach((cache, cacheIndex) => {
    const objects = normalizeArray(cache.objects);
    objects.forEach((cacheObject) => {
      const baseParts = [
        `cache_index=${cacheIndex}`,
        `type_id=${cacheObject.type_id}`,
        `object_count=${normalizeArray(cacheObject.object_data).length}`
      ];
      lines.push(baseParts);
      lines.push(...summarizeCandidateObjects(cacheObject.object_data, baseParts, {
        typeId: cacheObject.type_id
      }));
    });
  });

  return lines;
}

function summarizeSingleSoEnvelope(message) {
  const baseParts = [];
  if (message.type_id != null) {
    baseParts.push(`type_id=${message.type_id}`);
  }
  if (message.version != null) {
    pushIfTruthy(baseParts, "version", message.version);
  }
  const lines = [baseParts];
  if (message.object_data) {
    lines.push(...summarizeCandidateObjects([message.object_data], baseParts, {
      typeId: message.type_id
    }));
  }
  return lines;
}

function summarizeMultiSoEnvelope(message) {
  const lines = [];
  const groups = [
    ["objects_modified", normalizeArray(message.objects_modified)],
    ["objects_added", normalizeArray(message.objects_added)],
    ["objects_removed", normalizeArray(message.objects_removed)]
  ];

  groups.forEach(([groupName, objects]) => {
    if (!objects.length) {
      return;
    }
    lines.push([`${groupName}=${objects.length}`]);
    objects.forEach((entry, objectIndex) => {
      const baseParts = [
        `group=${groupName}`,
        `object_index=${objectIndex}`
      ];
      if (entry.type_id != null) {
        baseParts.push(`type_id=${entry.type_id}`);
      }
      lines.push(baseParts);
      if (entry.object_data) {
        lines.push(...summarizeCandidateObjects([entry.object_data], baseParts, {
          typeId: entry.type_id
        }));
      }
    });
  });

  if (!lines.length) {
    lines.push(["object_groups=0"]);
  }

  return lines;
}

function summarizeCandidateObjects(objectDataList, baseParts, context = {}) {
  const lines = [];
  normalizeArray(objectDataList).forEach((rawObject, objectIndex) => {
    const payload = normalizeGcPayload(rawObject);
    if (!payload || !payload.length) {
      return;
    }
    for (const candidate of selectSoCandidatesForTypeId(context.typeId)) {
      try {
        const decoded = typeof candidate.decode === "function"
          ? candidate.decode(payload)
          : decodeProtoToObject(candidate.proto, payload);
        if (!decoded || !candidate.isMeaningful(decoded, context)) {
          continue;
        }
        const parts = [...baseParts];
        parts.push(`object_index=${objectIndex}`);
        parts.push(`candidate=${candidate.name}`);
        parts.push(...candidate.summarize(decoded));
        lines.push(parts);
        break;
      } catch (_) {}
    }
  });
  return lines;
}

function applyArmoryStateFromClientWelcome(traceState, payload) {
  const message = decodeProtoToObject(GcProtos.CMsgClientWelcome, payload);
  if (!message) {
    return;
  }
  mutateArmoryState(traceState, "ClientWelcome", (state) => {
    const caches = normalizeArray(message.outofdate_subscribed_caches);
    caches.forEach((cache) => {
      normalizeArray(cache.objects).forEach((cacheObject) => {
        normalizeArray(cacheObject.object_data).forEach((objectData) => {
          const candidate = decodeArmoryCandidate(objectData, {
            typeId: cacheObject.type_id
          });
          if (candidate) {
            applyArmoryCandidateToState(state, candidate, "upsert");
          }
        });
      });
    });
  });
}

function applyArmoryStateFromSingleEnvelope(traceState, payload, action) {
  const message = decodeProtoToObject(GcProtos.CMsgSOSingleObject, payload);
  if (!message || !message.object_data) {
    return;
  }
  const candidate = decodeArmoryCandidate(message.object_data, {
    typeId: message.type_id
  });
  if (!candidate) {
    return;
  }
  mutateArmoryState(traceState, `SO_${action}`, (state) => {
    applyArmoryCandidateToState(state, candidate, action);
  });
}

function applyArmoryStateFromMultiEnvelope(traceState, payload) {
  const message = decodeProtoToObject(GcProtos.CMsgSOMultipleObjects, payload);
  if (!message) {
    return;
  }
  mutateArmoryState(traceState, "SO_UpdateMultiple", (state) => {
    const applyGroup = (items, action) => {
      normalizeArray(items).forEach((entry) => {
        const candidate = decodeArmoryCandidate(entry && entry.object_data, {
          typeId: entry && entry.type_id
        });
        if (candidate) {
          applyArmoryCandidateToState(state, candidate, action);
        }
      });
    };
    applyGroup(message.objects_modified, "upsert");
    applyGroup(message.objects_added, "upsert");
    applyGroup(message.objects_removed, "remove");
  });
}

function applyArmoryStateFromNotify(traceState, payload) {
  const decoded = decodeNotifyXpShopPayload(payload);
  if (!decoded) {
    return;
  }
  mutateArmoryState(traceState, "GC2ClientNotifyXPShop", (state) => {
    state.notify = normalizeNotifyXpShopState(decoded);
  });
}

function applyArmoryStateFromItemCustomization(traceState, payload) {
  const message = decodeProtoToObject(GcProtos.CMsgGCItemCustomizationNotification, payload);
  if (!message) {
    return;
  }
  mutateArmoryState(traceState, "ItemCustomizationNotification", (state) => {
    state.last_item_customization = normalizeItemCustomizationNotificationState(message);
  });
}

function applyArmoryStateFromRedeemResponse(traceState, payload) {
  const decoded = decodeRedeemMissionRewardPayload(payload);
  if (!decoded) {
    return;
  }
  mutateArmoryState(traceState, "ClientRedeemMissionReward", (state) => {
    state.last_redeem_response = decoded;
  });
}

function applyArmoryStateMessage(traceState, msgType, payload, direction) {
  if (!traceState) {
    return;
  }
  const buffer = normalizeGcPayload(payload);
  if (!buffer) {
    return;
  }
  try {
    if (msgType === GcLanguage.ClientWelcome) {
      applyArmoryStateFromClientWelcome(traceState, buffer);
      return;
    }
    if (msgType === GcLanguage.SO_Create || msgType === GcLanguage.SO_Update) {
      applyArmoryStateFromSingleEnvelope(traceState, buffer, "upsert");
      return;
    }
    if (msgType === GcLanguage.SO_Destroy) {
      applyArmoryStateFromSingleEnvelope(traceState, buffer, "remove");
      return;
    }
    if (msgType === GcLanguage.SO_UpdateMultiple) {
      applyArmoryStateFromMultiEnvelope(traceState, buffer);
      return;
    }
    if (msgType === XP_SHOP_NOTIFY_MSG_TYPE) {
      applyArmoryStateFromNotify(traceState, buffer);
      return;
    }
    if (msgType === GcLanguage.ItemCustomizationNotification) {
      applyArmoryStateFromItemCustomization(traceState, buffer);
      return;
    }
    if (msgType === GcLanguage.ClientRedeemMissionReward && direction === "in_callback") {
      applyArmoryStateFromRedeemResponse(traceState, buffer);
    }
  } catch (_) {}
}

function traceGcMessage({logger, accountName, direction, msgType, payload, logUnknown = false}) {
  const entry = buildTraceMessageEntry({direction, msgType, payload});
  if (!entry) {
    return null;
  }

  if (!logger || typeof logger.info !== "function") {
    return entry;
  }

  const commonParts = [
    `account=${accountName}`,
    `direction=${entry.direction}`,
    `msg=${entry.msg_name}`
  ];

  if (!GC_TRACE_MESSAGE_SPECS.has(entry.msg_type) && !logUnknown) {
    return entry;
  }

  if (!entry.lines.length) {
    logger.info(GC_TRACE_SCOPE, commonParts.join(" "));
    return entry;
  }

  for (const line of entry.lines) {
    logger.info(GC_TRACE_SCOPE, line ? [...commonParts, line].join(" ") : commonParts.join(" "));
  }

  return entry;
}

function attachGcTrace({steam, logger, accountName, enabled, onMessage} = {}) {
  if (!steam || !isGcTraceEnabled(enabled)) {
    return null;
  }

  if (steam[GC_TRACE_STATE]) {
    addTraceMessageConsumer(steam[GC_TRACE_STATE], onMessage);
    return steam[GC_TRACE_STATE];
  }

  const traceState = {
    enabled: true,
    onReceivedFromGC: null,
    events: new EventEmitter(),
    armoryState: createEmptyArmoryState(),
    recentMessages: [],
    messageConsumers: []
  };
  addTraceMessageConsumer(traceState, onMessage);

  const onReceivedFromGC = (appid, msgType, payload) => {
    if (appid !== GC_TRACE_APPID) {
      return;
    }
    applyArmoryStateMessage(traceState, msgType, payload, "in");
    const traceEntry = traceGcMessage({
      logger,
      accountName,
      direction: "in",
      msgType,
      payload
    });
    publishTraceMessage(traceState, traceEntry);
  };
  traceState.onReceivedFromGC = onReceivedFromGC;

  const originalSendToGC = typeof steam.sendToGC === "function" ? steam.sendToGC.bind(steam) : null;
  if (originalSendToGC) {
    steam.sendToGC = function tracedSendToGC(appid, msgType, protoBufHeader, payload, callback) {
      if (appid === GC_TRACE_APPID) {
        const traceEntry = traceGcMessage({
          logger,
          accountName,
          direction: "out",
          msgType,
          payload
        });
        publishTraceMessage(traceState, traceEntry);
      }
      const tracedCallback = typeof callback === "function"
        ? function gcTraceCallback(callbackAppid, callbackMsgType, callbackPayload) {
          if (callbackAppid === GC_TRACE_APPID) {
            applyArmoryStateMessage(traceState, callbackMsgType, callbackPayload, "in_callback");
            const traceEntry = traceGcMessage({
              logger,
              accountName,
              direction: "in_callback",
              msgType: callbackMsgType,
              payload: callbackPayload,
              logUnknown: true
            });
            publishTraceMessage(traceState, traceEntry);
          }
          return callback.apply(this, arguments);
        }
        : callback;
      return originalSendToGC(appid, msgType, protoBufHeader, payload, tracedCallback);
    };
  }

  steam.on("receivedFromGC", onReceivedFromGC);
  steam[GC_TRACE_STATE] = traceState;

  if (logger && typeof logger.info === "function") {
    logger.info(GC_TRACE_SCOPE, `enabled: account=${accountName}`);
  }

  return traceState;
}

function readGcArmoryState(steam) {
  return cloneArmoryState(steam && steam[GC_TRACE_STATE] && steam[GC_TRACE_STATE].armoryState);
}

function readGcTraceMessages(steam, {limit} = {}) {
  const recentMessages = steam && steam[GC_TRACE_STATE] && steam[GC_TRACE_STATE].recentMessages;
  if (!Array.isArray(recentMessages) || !recentMessages.length) {
    return [];
  }

  const normalizedLimit = Number(limit);
  const sliceCount = Number.isFinite(normalizedLimit) && normalizedLimit > 0
    ? Math.floor(normalizedLimit)
    : recentMessages.length;
  return recentMessages
    .slice(Math.max(0, recentMessages.length - sliceCount))
    .map((entry) => cloneTraceMessage(entry))
    .filter(Boolean);
}

function observeGcArmoryState(steam, listener) {
  const traceState = steam && steam[GC_TRACE_STATE];
  if (!traceState || !traceState.events || typeof listener !== "function") {
    return () => {};
  }
  const wrapped = (state, meta) => {
    listener(cloneArmoryState(state), meta || {});
  };
  traceState.events.on(GC_ARMORY_STATE_CHANGE, wrapped);
  return () => {
    traceState.events.off(GC_ARMORY_STATE_CHANGE, wrapped);
  };
}

module.exports = {
  attachGcTrace,
  observeGcArmoryState,
  readGcArmoryState,
  readGcTraceMessages
};
