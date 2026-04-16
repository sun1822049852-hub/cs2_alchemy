const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");

const Protos = require("globaloffensive/protobufs/generated/_load.js");
const Language = require("globaloffensive/language.js");
const {attachGcTrace, readGcArmoryState, readGcTraceMessages} = require("../src/cs2Session");
const {buildRedeemMissionRewardPayload} = require("../src/redeemMissionReward");
const {
  XP_SHOP_NOTIFY_MSG_TYPE,
  XP_SHOP_ACK_TRACKS_MSG_TYPE
} = require("../src/xpShopMessages");

function createLoggerSink() {
  const lines = [];
  return {
    lines,
    info(scope, text) {
      lines.push(`INFO ${scope} ${text}`);
    },
    warn(scope, text) {
      lines.push(`WARN ${scope} ${text}`);
    },
    error(scope, text) {
      lines.push(`ERROR ${scope} ${text}`);
    }
  };
}

function createFakeSteam(sendImpl) {
  const steam = new EventEmitter();
  steam.sendToGC = typeof sendImpl === "function" ? sendImpl : function sendToGC() {};
  return steam;
}

function encodeVarint(value) {
  let remaining = BigInt(value);
  const bytes = [];
  do {
    let next = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0n) {
      next |= 0x80;
    }
    bytes.push(next);
  } while (remaining > 0n);
  return Buffer.from(bytes);
}

function encodeVarintField(fieldNumber, value) {
  return Buffer.concat([
    encodeVarint((BigInt(fieldNumber) << 3n) | 0n),
    encodeVarint(value)
  ]);
}

function encodeBytesField(fieldNumber, payload) {
  return Buffer.concat([
    encodeVarint((BigInt(fieldNumber) << 3n) | 2n),
    encodeVarint(payload.length),
    payload
  ]);
}

function test_attach_gc_trace_logs_redeem_mission_reward_cost() {
  const logger = createLoggerSink();
  const steam = createFakeSteam();

  attachGcTrace({
    steam,
    logger,
    accountName: "briangordon9576",
    enabled: true
  });

  const payload = Protos.CMsgGCCstrike15_v2_ClientRedeemMissionReward.encode({
    campaign_id: 1,
    redeem_id: 2,
    redeemable_balance: 8,
    expected_cost: 4
  }).finish();

  steam.emit("receivedFromGC", 730, Language.ClientRedeemMissionReward, payload);

  assert.ok(
    logger.lines.some((line) => line.includes("msg=ClientRedeemMissionReward") && line.includes("expected_cost=4")),
    `expected mission reward trace log, got:\n${logger.lines.join("\n")}`
  );
}

function test_attach_gc_trace_logs_redeem_zero_and_bid_control_on_outbound_send() {
  const logger = createLoggerSink();
  const steam = createFakeSteam();

  attachGcTrace({
    steam,
    logger,
    accountName: "x833830262",
    enabled: true
  });

  const payload = buildRedeemMissionRewardPayload({
    campaignId: 11,
    redeemId: 0,
    redeemableBalance: 200,
    expectedCost: 4,
    bidControl: 0
  });

  steam.sendToGC(730, Language.ClientRedeemMissionReward, {}, payload);

  assert.ok(
    logger.lines.some((line) =>
      line.includes("direction=out")
      && line.includes("msg=ClientRedeemMissionReward")
      && line.includes("redeem_id=0")
      && line.includes("bid_control=0")
    ),
    `expected outbound mission reward trace with zero fields, got:\n${logger.lines.join("\n")}`
  );
}

function test_attach_gc_trace_logs_job_callback_response() {
  const logger = createLoggerSink();
  const responsePayload = buildRedeemMissionRewardPayload({
    campaignId: 11,
    redeemId: 0,
    redeemableBalance: 196,
    expectedCost: 4,
    bidControl: 0
  });
  const steam = createFakeSteam((appid, msgType, protoBufHeader, payload, callback) => {
    if (typeof callback === "function") {
      callback(appid, msgType, responsePayload);
    }
  });

  attachGcTrace({
    steam,
    logger,
    accountName: "x833830262",
    enabled: true
  });

  const payload = buildRedeemMissionRewardPayload({
    campaignId: 11,
    redeemId: 0,
    redeemableBalance: 200,
    expectedCost: 4,
    bidControl: 0
  });

  steam.sendToGC(730, Language.ClientRedeemMissionReward, {}, payload, () => {});

  assert.ok(
    logger.lines.some((line) =>
      line.includes("direction=in_callback")
      && line.includes("msg=ClientRedeemMissionReward")
      && line.includes("redeemable_balance=196")
    ),
    `expected callback mission reward trace, got:\n${logger.lines.join("\n")}`
  );
}

function test_attach_gc_trace_logs_seasonal_operation_balance_from_client_welcome() {
  const logger = createLoggerSink();
  const steam = createFakeSteam();

  attachGcTrace({
    steam,
    logger,
    accountName: "briangordon9576",
    enabled: true
  });

  const seasonalOperation = Protos.CSOAccountSeasonalOperation.encode({
    season_value: 2025,
    tier_unlocked: 3,
    premium_tiers: 1,
    mission_id: 77,
    missions_completed: 11,
    redeemable_balance: 8,
    season_pass_time: 123456
  }).finish();

  const payload = Protos.CMsgClientWelcome.encode({
    outofdate_subscribed_caches: [{
      objects: [{
        type_id: 9999,
        object_data: [seasonalOperation]
      }]
    }]
  }).finish();

  steam.emit("receivedFromGC", 730, Language.ClientWelcome, payload);

  assert.ok(
    logger.lines.some((line) => line.includes("candidate=CSOAccountSeasonalOperation") && line.includes("redeemable_balance=8")),
    `expected seasonal operation trace log, got:\n${logger.lines.join("\n")}`
  );
}

function test_attach_gc_trace_ignores_low_confidence_personal_store_candidates() {
  const logger = createLoggerSink();
  const steam = createFakeSteam();

  attachGcTrace({
    steam,
    logger,
    accountName: "briangordon9576",
    enabled: true
  });

  const noisyObject = Protos.CSOAccountItemPersonalStore.encode({
    generation_time: 12,
    redeemable_balance: 12,
    items: ["1"]
  }).finish();

  const payload = Protos.CMsgClientWelcome.encode({
    outofdate_subscribed_caches: [{
      objects: [{
        type_id: 1,
        object_data: [noisyObject]
      }]
    }]
  }).finish();

  steam.emit("receivedFromGC", 730, Language.ClientWelcome, payload);

  assert.ok(
    logger.lines.every((line) => !line.includes("candidate=CSOAccountItemPersonalStore")),
    `expected low-confidence personal store candidate to be ignored, got:\n${logger.lines.join("\n")}`
  );
}

function test_attach_gc_trace_prefers_xpshop_candidate_over_personal_store_shape() {
  const logger = createLoggerSink();
  const steam = createFakeSteam();

  attachGcTrace({
    steam,
    logger,
    accountName: "x833830262",
    enabled: true
  });

  const xpShopLikeObject = Buffer.concat([
    encodeVarintField(1, 1775285012),
    encodeVarintField(2, 200),
    encodeVarintField(3, 12000),
    encodeVarintField(3, 12000),
    encodeVarintField(3, 12000),
    encodeVarintField(3, 12000),
    encodeVarintField(3, 12000)
  ]);

  const payload = Protos.CMsgClientWelcome.encode({
    outofdate_subscribed_caches: [{
      objects: [{
        type_id: 6,
        object_data: [xpShopLikeObject]
      }]
    }]
  }).finish();

  steam.emit("receivedFromGC", 730, Language.ClientWelcome, payload);

  assert.ok(
    logger.lines.some((line) => line.includes("candidate=CSOAccountXpShop") && line.includes("xp_track_values=12000|12000|12000|12000")),
    `expected xpshop candidate trace log, got:\n${logger.lines.join("\n")}`
  );
  assert.ok(
    logger.lines.every((line) => !line.includes("candidate=CSOAccountItemPersonalStore")),
    `expected xpshop-shaped object not to be mislabeled as personal store, got:\n${logger.lines.join("\n")}`
  );
}

function test_attach_gc_trace_detects_xpshop_bids_candidate() {
  const logger = createLoggerSink();
  const steam = createFakeSteam();

  attachGcTrace({
    steam,
    logger,
    accountName: "x833830262",
    enabled: true
  });

  const xpShopBidsObject = Buffer.concat([
    encodeVarintField(1, 11),
    encodeVarintField(2, 0),
    encodeVarintField(3, 4),
    encodeVarintField(4, 1775285012)
  ]);

  const payload = Protos.CMsgClientWelcome.encode({
    outofdate_subscribed_caches: [{
      objects: [{
        type_id: 6,
        object_data: [xpShopBidsObject]
      }]
    }]
  }).finish();

  steam.emit("receivedFromGC", 730, Language.ClientWelcome, payload);

  assert.ok(
    logger.lines.some((line) =>
      line.includes("candidate=CSOAccountXpShopBids")
      && line.includes("campaign_id=11")
      && line.includes("redeem_id=0")
      && line.includes("expected_cost=4")
    ),
    `expected xpshop bids candidate trace log, got:\n${logger.lines.join("\n")}`
  );
}

function test_attach_gc_trace_detects_live_type6_balance_only_object_as_xpshop() {
  const logger = createLoggerSink();
  const steam = createFakeSteam();

  attachGcTrace({
    steam,
    logger,
    accountName: "x833830262",
    enabled: true
  });

  const liveType6BalanceOnlyObject = Buffer.from("08bdafdcce0610c601", "hex");
  const payload = Protos.CMsgClientWelcome.encode({
    outofdate_subscribed_caches: [{
      objects: [{
        type_id: 6,
        object_data: [liveType6BalanceOnlyObject]
      }]
    }]
  }).finish();

  steam.emit("receivedFromGC", 730, Language.ClientWelcome, payload);

  assert.ok(
    logger.lines.some((line) =>
      line.includes("candidate=CSOAccountXpShop")
      && line.includes("redeemable_balance=198")
    ),
    `expected live type6 balance-only object to be classified as xpshop, got:\n${logger.lines.join("\n")}`
  );
  assert.ok(
    logger.lines.every((line) => !line.includes("candidate=CSOAccountItemPersonalStore")),
    `expected live type6 balance-only object not to be mislabeled as personal store, got:\n${logger.lines.join("\n")}`
  );

  const state = readGcArmoryState(steam);
  assert.equal(state.xp_shop && state.xp_shop.redeemable_balance, 198);
  assert.deepEqual(state.xp_shop && state.xp_shop.xp_tracks, []);
}

function test_attach_gc_trace_does_not_mislabel_live_type2_object_as_xpshop_bids() {
  const logger = createLoggerSink();
  const steam = createFakeSteam();

  attachGcTrace({
    steam,
    logger,
    accountName: "x833830262",
    enabled: true
  });

  const liveType2Object = Buffer.from("08041206080c100c200c18012090c6fbce062801", "hex");
  const payload = Protos.CMsgClientWelcome.encode({
    outofdate_subscribed_caches: [{
      objects: [{
        type_id: 2,
        object_data: [liveType2Object]
      }]
    }]
  }).finish();

  steam.emit("receivedFromGC", 730, Language.ClientWelcome, payload);

  assert.ok(
    logger.lines.every((line) => !line.includes("candidate=CSOAccountXpShopBids")),
    `expected live type_id=2 object not to be mislabeled as xpshop bids, got:\n${logger.lines.join("\n")}`
  );
}

function test_attach_gc_trace_logs_xpshop_ack_message_name() {
  const logger = createLoggerSink();
  const steam = createFakeSteam();

  attachGcTrace({
    steam,
    logger,
    accountName: "x833830262",
    enabled: true
  });

  steam.sendToGC(730, XP_SHOP_ACK_TRACKS_MSG_TYPE, {}, Buffer.alloc(0));

  assert.ok(
    logger.lines.some((line) =>
      line.includes("direction=out")
      && line.includes("msg=Client2GcAckXPShopTracks")
      && line.includes("bytes=0")
    ),
    `expected ack tracks trace log, got:\n${logger.lines.join("\n")}`
  );
}

function test_attach_gc_trace_logs_notify_xpshop_payload() {
  const logger = createLoggerSink();
  const steam = createFakeSteam();

  attachGcTrace({
    steam,
    logger,
    accountName: "x833830262",
    enabled: true
  });

  const prematch = Buffer.concat([
    encodeVarintField(1, 1775285012),
    encodeVarintField(2, 200),
    encodeVarintField(3, 12000),
    encodeVarintField(3, 12000),
    encodeVarintField(3, 12000)
  ]);
  const payload = Buffer.concat([
    encodeBytesField(1, prematch),
    encodeVarintField(3, 54321),
    encodeVarintField(4, 42)
  ]);

  steam.emit("receivedFromGC", 730, XP_SHOP_NOTIFY_MSG_TYPE, payload);

  assert.ok(
    logger.lines.some((line) =>
      line.includes("direction=in")
      && line.includes("msg=GC2ClientNotifyXPShop")
      && line.includes("prematch_balance=200")
      && line.includes("current_level=42")
    ),
    `expected notify xpshop trace log, got:\n${logger.lines.join("\n")}`
  );
}

function test_attach_gc_trace_preserves_unknown_gc_message_raw_payload() {
  const logger = createLoggerSink();
  const steam = createFakeSteam();

  attachGcTrace({
    steam,
    logger,
    accountName: "x883830262",
    enabled: true
  });

  const payload = Buffer.from("deadbeefcafebabe", "hex");
  steam.emit("receivedFromGC", 730, 65535, payload);

  const history = readGcTraceMessages(steam, {limit: 5});
  const entry = history.find((item) => item.msg_type === 65535);
  assert.ok(entry, "expected unknown GC message to be preserved in history");
  assert.equal(entry.payload_hex, payload.toString("hex"));
  assert.equal(entry.raw_payload_base64, payload.toString("base64"));
}

function test_attach_gc_trace_preserves_full_so_object_data_for_multi_update() {
  const logger = createLoggerSink();
  const steam = createFakeSteam();

  attachGcTrace({
    steam,
    logger,
    accountName: "x883830262",
    enabled: true
  });

  const firstObject = Buffer.from("080b100018c8012004", "hex");
  const secondObject = Buffer.from("080b100118c8012002", "hex");
  const payload = Protos.CMsgSOMultipleObjects.encode({
    objects_modified: [
      {type_id: 20, object_data: firstObject},
      {type_id: 6, object_data: secondObject}
    ]
  }).finish();

  steam.emit("receivedFromGC", 730, Language.SO_UpdateMultiple, payload);

  const history = readGcTraceMessages(steam, {limit: 5});
  const entry = history.find((item) => item.msg_type === Language.SO_UpdateMultiple);
  assert.ok(entry, "expected SO_UpdateMultiple message to be preserved in history");
  assert.deepEqual(
    entry.so_objects,
    [
      {group: "objects_modified", index: 0, type_id: 20, object_data_hex: firstObject.toString("hex")},
      {group: "objects_modified", index: 1, type_id: 6, object_data_hex: secondObject.toString("hex")}
    ],
    "expected raw SO object payloads to be preserved"
  );
}

function test_attach_gc_trace_caches_armory_state_from_client_welcome() {
  const logger = createLoggerSink();
  const steam = createFakeSteam();

  attachGcTrace({
    steam,
    logger,
    accountName: "x833830262",
    enabled: true
  });

  const seasonalOperation = Protos.CSOAccountSeasonalOperation.encode({
    season_value: 2025,
    tier_unlocked: 3,
    premium_tiers: 1,
    mission_id: 77,
    missions_completed: 11,
    redeemable_balance: 8,
    season_pass_time: 123456
  }).finish();
  const xpShopBidsObject = Buffer.concat([
    encodeVarintField(1, 11),
    encodeVarintField(2, 0),
    encodeVarintField(3, 4),
    encodeVarintField(4, 1775285012)
  ]);

  const payload = Protos.CMsgClientWelcome.encode({
    outofdate_subscribed_caches: [{
      objects: [{
        type_id: 9999,
        object_data: [seasonalOperation, xpShopBidsObject]
      }]
    }]
  }).finish();

  steam.emit("receivedFromGC", 730, Language.ClientWelcome, payload);

  const state = readGcArmoryState(steam);
  assert.equal(state.seasonal_operation.redeemable_balance, 8);
  assert.equal(Array.isArray(state.xp_shop_bids), true);
  assert.equal(state.xp_shop_bids.length, 1);
  assert.equal(state.xp_shop_bids[0].campaign_id, 11);
  assert.equal(state.xp_shop_bids[0].expected_cost, 4);
}

function test_attach_gc_trace_keeps_recent_gc_message_history_for_probe() {
  const logger = createLoggerSink();
  const steam = createFakeSteam();

  attachGcTrace({
    steam,
    logger,
    accountName: "x833830262",
    enabled: true
  });

  const seasonalOperation = Protos.CSOAccountSeasonalOperation.encode({
    season_value: 2025,
    tier_unlocked: 3,
    premium_tiers: 1,
    mission_id: 77,
    missions_completed: 11,
    redeemable_balance: 8,
    season_pass_time: 123456
  }).finish();
  const payload = Protos.CMsgClientWelcome.encode({
    outofdate_subscribed_caches: [{
      objects: [{
        type_id: 9999,
        object_data: [seasonalOperation]
      }]
    }]
  }).finish();

  steam.emit("receivedFromGC", 730, Language.ClientWelcome, payload);
  steam.sendToGC(730, XP_SHOP_ACK_TRACKS_MSG_TYPE, {}, Buffer.alloc(0));

  const history = readGcTraceMessages(steam, {limit: 10});
  assert.equal(Array.isArray(history), true);
  assert.ok(
    history.some((entry) =>
      entry.direction === "in"
      && entry.msg_name === "ClientWelcome"
      && Array.isArray(entry.lines)
      && entry.lines.some((line) => line.includes("candidate=CSOAccountSeasonalOperation"))
    ),
    `expected client welcome history entry, got:\n${JSON.stringify(history, null, 2)}`
  );
  assert.ok(
    history.some((entry) =>
      entry.direction === "out"
      && entry.msg_name === "Client2GcAckXPShopTracks"
      && entry.bytes === 0
    ),
    `expected ack tracks history entry, got:\n${JSON.stringify(history, null, 2)}`
  );
}

function test_attach_gc_trace_caches_redeem_item_customization_notification() {
  const logger = createLoggerSink();
  const steam = createFakeSteam();

  attachGcTrace({
    steam,
    logger,
    accountName: "x833830262",
    enabled: true
  });

  const payload = Protos.CMsgGCItemCustomizationNotification.encode({
    item_id: ["123456789012345678"],
    request: Language.ClientRedeemMissionReward,
    extra_data: ["11", "0"]
  }).finish();

  steam.emit("receivedFromGC", 730, Language.ItemCustomizationNotification, payload);

  const state = readGcArmoryState(steam);
  assert.equal(state.last_item_customization.request, Language.ClientRedeemMissionReward);
  assert.equal(state.last_item_customization.request_name, "ClientRedeemMissionReward");
  assert.deepEqual(state.last_item_customization.item_ids, ["123456789012345678"]);
}

function main() {
  test_attach_gc_trace_logs_redeem_mission_reward_cost();
  test_attach_gc_trace_logs_redeem_zero_and_bid_control_on_outbound_send();
  test_attach_gc_trace_logs_job_callback_response();
  test_attach_gc_trace_logs_seasonal_operation_balance_from_client_welcome();
  test_attach_gc_trace_ignores_low_confidence_personal_store_candidates();
  test_attach_gc_trace_prefers_xpshop_candidate_over_personal_store_shape();
  test_attach_gc_trace_detects_xpshop_bids_candidate();
  test_attach_gc_trace_detects_live_type6_balance_only_object_as_xpshop();
  test_attach_gc_trace_does_not_mislabel_live_type2_object_as_xpshop_bids();
  test_attach_gc_trace_logs_xpshop_ack_message_name();
  test_attach_gc_trace_logs_notify_xpshop_payload();
  test_attach_gc_trace_preserves_unknown_gc_message_raw_payload();
  test_attach_gc_trace_preserves_full_so_object_data_for_multi_update();
  test_attach_gc_trace_caches_armory_state_from_client_welcome();
  test_attach_gc_trace_keeps_recent_gc_message_history_for_probe();
  test_attach_gc_trace_caches_redeem_item_customization_notification();
  console.log("cs2-session-gc-trace tests passed");
}

main();
