const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const Protos = require("globaloffensive/protobufs/generated/_load.js");
const Language = require("globaloffensive/language.js");
const {attachGcTrace} = require("../src/cs2Session");
const {XP_SHOP_NOTIFY_MSG_TYPE, XP_SHOP_ACK_TRACKS_MSG_TYPE} = require("../src/xpShopMessages");
const {
  redeemMissionRewardWithSteam,
  inspectWeaponArmoryWithSteam,
  probeWeaponArmoryWithSteam
} = require("../src/services/weaponArmoryService");

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

function writeLocalXpShopFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xpshop-catalog-"));
  const itemsGamePath = path.join(tempDir, "items_game.txt");
  const schinesePath = path.join(tempDir, "csgo_schinese.txt");
  const englishPath = path.join(tempDir, "csgo_english.txt");

  fs.writeFileSync(itemsGamePath, [
    "\"seasonaloperations\"",
    "{",
    "  \"11\"",
    "  {",
    "    \"redeemable_goods\"    \"xpshop\"",
    "    \"operational_point_redeemable\"",
    "    {",
    "      \"points\"    \"4\"",
    "      \"item_name\"    \"lootlist:set_train_2025\"",
    "      \"ui_order\"    \"2\"",
    "      \"callout\"    \"#CSGO_set_train_2025_short\"",
    "      \"ui_image_thumbnail\"    \"backgrounds/xpshop/set_train_2025_thumbnail\"",
    "    }",
    "    \"operational_point_redeemable\"",
    "    {",
    "      \"points\"    \"2\"",
    "      \"flags\"    \"2\"",
    "      \"item_name\"    \"crate_community_35\"",
    "      \"callout\"    \"#CSGO_crate_community_35\"",
    "      \"ui_image_thumbnail\"    \"backgrounds/xpshop/crate_community_35_thumbnail\"",
    "      \"ui_order\"    \"3\"",
    "    }",
    "  }",
    "}",
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(schinesePath, [
    "\"lang\"",
    "{",
    "  \"Tokens\"",
    "  {",
    "    \"CSGO_set_train_2025_short\"    \"2025 列车停放站收藏品\"",
    "    \"CSGO_crate_community_35\"    \"热潮武器箱\"",
    "  }",
    "}",
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(englishPath, [
    "\"lang\"",
    "{",
    "  \"Tokens\"",
    "  {",
    "    \"CSGO_set_train_2025_short\"    \"Train 2025 Collection\"",
    "    \"CSGO_crate_community_35\"    \"Fever Case\"",
    "  }",
    "}",
    ""
  ].join("\n"), "utf8");

  return {
    tempDir,
    itemsGamePath,
    schinesePath,
    englishPath
  };
}

async function withLocalXpShopFixture(run) {
  const fixture = writeLocalXpShopFixture();
  const previousEnv = {
    itemsGame: process.env.CS2_XP_SHOP_ITEMS_GAME_FILE,
    schinese: process.env.CS2_XP_SHOP_SCHINESE_FILE,
    english: process.env.CS2_XP_SHOP_ENGLISH_FILE
  };

  process.env.CS2_XP_SHOP_ITEMS_GAME_FILE = fixture.itemsGamePath;
  process.env.CS2_XP_SHOP_SCHINESE_FILE = fixture.schinesePath;
  process.env.CS2_XP_SHOP_ENGLISH_FILE = fixture.englishPath;

  try {
    return await run(fixture);
  } finally {
    if (previousEnv.itemsGame === undefined) {
      delete process.env.CS2_XP_SHOP_ITEMS_GAME_FILE;
    } else {
      process.env.CS2_XP_SHOP_ITEMS_GAME_FILE = previousEnv.itemsGame;
    }
    if (previousEnv.schinese === undefined) {
      delete process.env.CS2_XP_SHOP_SCHINESE_FILE;
    } else {
      process.env.CS2_XP_SHOP_SCHINESE_FILE = previousEnv.schinese;
    }
    if (previousEnv.english === undefined) {
      delete process.env.CS2_XP_SHOP_ENGLISH_FILE;
    } else {
      process.env.CS2_XP_SHOP_ENGLISH_FILE = previousEnv.english;
    }
    fs.rmSync(fixture.tempDir, {recursive: true, force: true});
  }
}

async function withDisabledLocalXpShopCatalog(run) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xpshop-disabled-"));
  const previousEnv = {
    itemsGame: process.env.CS2_XP_SHOP_ITEMS_GAME_FILE,
    schinese: process.env.CS2_XP_SHOP_SCHINESE_FILE,
    english: process.env.CS2_XP_SHOP_ENGLISH_FILE
  };

  process.env.CS2_XP_SHOP_ITEMS_GAME_FILE = path.join(tempDir, "missing_items_game.txt");
  process.env.CS2_XP_SHOP_SCHINESE_FILE = path.join(tempDir, "missing_schinese.txt");
  process.env.CS2_XP_SHOP_ENGLISH_FILE = path.join(tempDir, "missing_english.txt");

  try {
    return await run();
  } finally {
    if (previousEnv.itemsGame === undefined) {
      delete process.env.CS2_XP_SHOP_ITEMS_GAME_FILE;
    } else {
      process.env.CS2_XP_SHOP_ITEMS_GAME_FILE = previousEnv.itemsGame;
    }
    if (previousEnv.schinese === undefined) {
      delete process.env.CS2_XP_SHOP_SCHINESE_FILE;
    } else {
      process.env.CS2_XP_SHOP_SCHINESE_FILE = previousEnv.schinese;
    }
    if (previousEnv.english === undefined) {
      delete process.env.CS2_XP_SHOP_ENGLISH_FILE;
    } else {
      process.env.CS2_XP_SHOP_ENGLISH_FILE = previousEnv.english;
    }
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
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

function makeClientWelcomePayload({redeemableBalance = 8, bids = [{campaign_id: 11, redeem_id: 0, expected_cost: 4}]}) {
  const seasonalOperation = Protos.CSOAccountSeasonalOperation.encode({
    season_value: 2025,
    tier_unlocked: 3,
    premium_tiers: 1,
    mission_id: 77,
    missions_completed: 11,
    redeemable_balance: redeemableBalance,
    season_pass_time: 123456
  }).finish();
  const bidObjects = bids.map((bid) => Buffer.concat([
    encodeVarintField(1, bid.campaign_id),
    encodeVarintField(2, bid.redeem_id),
    encodeVarintField(3, bid.expected_cost),
    encodeVarintField(4, 1775285012)
  ]));

  return Protos.CMsgClientWelcome.encode({
    outofdate_subscribed_caches: [{
      objects: [{
        type_id: 9999,
        object_data: [seasonalOperation, ...bidObjects]
      }]
    }]
  }).finish();
}

function makeXpShopNotifyPayload({prematchBalance = 8, postmatchBalance = 4, currentLevel = 42}) {
  const prematch = Buffer.concat([
    encodeVarintField(1, 1775285012),
    encodeVarintField(2, prematchBalance),
    encodeVarintField(3, 12000),
    encodeVarintField(3, 12000),
    encodeVarintField(3, 12000)
  ]);
  const postmatch = Buffer.concat([
    encodeVarintField(1, 1775285013),
    encodeVarintField(2, postmatchBalance),
    encodeVarintField(3, 12000),
    encodeVarintField(3, 12000),
    encodeVarintField(3, 12000)
  ]);
  return Buffer.concat([
    encodeBytesField(1, prematch),
    encodeBytesField(2, postmatch),
    encodeVarintField(3, 54321),
    encodeVarintField(4, currentLevel)
  ]);
}

function createFakeSteam(sendImpl) {
  const steam = new EventEmitter();
  steam.sendToGC = function sendToGC(appid, msgType, protoBufHeader, payload, callback) {
    if (typeof sendImpl === "function") {
      return sendImpl(appid, msgType, protoBufHeader, payload, callback);
    }
    if (msgType === XP_SHOP_ACK_TRACKS_MSG_TYPE) {
      if (typeof callback === "function") {
        callback(appid, msgType, Buffer.alloc(0));
      }
      return;
    }
    if (msgType === Language.ClientRedeemMissionReward) {
      const soCreatePayload = Protos.CMsgSOSingleObject.encode({
        type_id: 1,
        version: "29789614050941784",
        object_data: Protos.CSOEconItem.encode({
          id: "50957382752",
          account_id: 795034680,
          inventory: 3221226007,
          def_index: 7007,
          quantity: 0,
          level: 1,
          quality: 4,
          flags: 0,
          origin: 23,
          rarity: 1
        }).finish()
      }).finish();
      const notifyPayload = makeXpShopNotifyPayload({
        prematchBalance: 8,
        postmatchBalance: 4,
        currentLevel: 42
      });
      const itemCustomizationPayload = Protos.CMsgGCItemCustomizationNotification.encode({
        item_id: ["123456789012345678"],
        request: Language.ClientRedeemMissionReward,
        extra_data: ["11", "0"]
      }).finish();
      setImmediate(() => {
        steam.emit("receivedFromGC", 730, Language.SO_Create, soCreatePayload);
        steam.emit("receivedFromGC", 730, XP_SHOP_NOTIFY_MSG_TYPE, notifyPayload);
        steam.emit("receivedFromGC", 730, Language.ItemCustomizationNotification, itemCustomizationPayload);
        if (typeof callback === "function") {
          callback(appid, msgType, payload);
        }
      });
    }
  };
  return steam;
}

async function test_redeem_service_auto_resolves_live_bid_and_confirms_success() {
  const logger = createLoggerSink();
  let sentPayloadHex = "";
  const steam = createFakeSteam();
  const originalSendToGC = steam.sendToGC.bind(steam);
  steam.sendToGC = function wrappedSendToGC(appid, msgType, protoBufHeader, payload, callback) {
    if (msgType === Language.ClientRedeemMissionReward) {
      sentPayloadHex = Buffer.from(payload).toString("hex");
    }
    return originalSendToGC(appid, msgType, protoBufHeader, payload, callback);
  };

  attachGcTrace({
    steam,
    logger,
    accountName: "x833830262",
    enabled: true
  });
  steam.emit("receivedFromGC", 730, Language.ClientWelcome, makeClientWelcomePayload({}));

  const result = await redeemMissionRewardWithSteam({
    steam,
    accountName: "x833830262",
    logger,
    ackTracks: true,
    ackWaitMs: 0,
    waitMs: 500
  });

  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.equal(result.payload_hex, "080b100018082004");
  assert.equal(sentPayloadHex, "080b100018082004");
  assert.deepEqual(result.resolved, {
    campaign_id: 11,
    redeem_id: 0,
    redeemable_balance: 8,
    expected_cost: 4,
    bid_control: 0
  });
  assert.deepEqual(result.success_evidence.so_create_item, {
    id: "50957382752",
    account_id: 795034680,
    inventory: 3221226007,
    def_index: 7007,
    quantity: 0,
    level: 1,
    quality: 4,
    flags: 0,
    origin: 23,
    rarity: 1
  });
  assert.equal(result.success_evidence.item_customization.request, Language.ClientRedeemMissionReward);
  assert.equal(result.success_evidence.balance_before, 8);
  assert.equal(result.success_evidence.balance_after, 4);
}

async function test_redeem_service_rejects_ambiguous_bid_selection_without_explicit_ids() {
  const logger = createLoggerSink();
  const steam = createFakeSteam();

  attachGcTrace({
    steam,
    logger,
    accountName: "x833830262",
    enabled: true
  });
  steam.emit("receivedFromGC", 730, Language.ClientWelcome, makeClientWelcomePayload({
    bids: [
      {campaign_id: 11, redeem_id: 0, expected_cost: 4},
      {campaign_id: 11, redeem_id: 1, expected_cost: 4}
    ]
  }));

  await assert.rejects(
    () => redeemMissionRewardWithSteam({
      steam,
      accountName: "x833830262",
      logger,
      ackTracks: false,
      waitMs: 50
    }),
    (err) => {
      assert.match(String(err && err.message || ""), /redeem|campaign|multiple|ambiguous/i);
      assert.equal(err && err.code, "armory_bid_ambiguous");
      assert.equal(err && err.redemption_payload && err.redemption_payload.reason, "armory_bid_ambiguous");
      assert.equal(Array.isArray(err && err.redemption_payload && err.redemption_payload.options), true);
      assert.equal(err.redemption_payload.options.length, 2);
      return true;
    }
  );
}

async function test_inspect_weapon_armory_returns_live_bid_options() {
  await withDisabledLocalXpShopCatalog(async () => {
    const logger = createLoggerSink();
    const steam = createFakeSteam();

    attachGcTrace({
      steam,
      logger,
      accountName: "x833830262",
      enabled: true
    });
    steam.emit("receivedFromGC", 730, Language.ClientWelcome, makeClientWelcomePayload({
      redeemableBalance: 8,
      bids: [
        {campaign_id: 11, redeem_id: 0, expected_cost: 4},
        {campaign_id: 11, redeem_id: 1, expected_cost: 8}
      ]
    }));

    const result = await inspectWeaponArmoryWithSteam({
      steam,
      accountName: "x833830262"
    });

    assert.equal(result.ok, true);
    assert.equal(result.account, "x833830262");
    assert.equal(result.redeemable_balance, 8);
    assert.equal(Array.isArray(result.options), true);
    assert.deepEqual(result.options, [
      {
        campaign_id: 11,
        redeem_id: 0,
        expected_cost: 4,
        generation_time: 1775285012,
        redeemable_balance: 8,
        balance_after_redeem: 4,
        affordable: true
      },
      {
        campaign_id: 11,
        redeem_id: 1,
        expected_cost: 8,
        generation_time: 1775285012,
        redeemable_balance: 8,
        balance_after_redeem: 0,
        affordable: true
      }
    ]);
    assert.equal(result.armory_state.xp_shop_bids.length, 2);
  });
}

async function test_inspect_weapon_armory_exposes_local_catalog_without_live_bids() {
  await withLocalXpShopFixture(async () => {
    const logger = createLoggerSink();
    const steam = createFakeSteam();

    attachGcTrace({
      steam,
      logger,
      accountName: "x833830262",
      enabled: true
    });
    steam.emit("receivedFromGC", 730, Language.ClientWelcome, makeClientWelcomePayload({
      redeemableBalance: 8,
      bids: []
    }));

    const result = await inspectWeaponArmoryWithSteam({
      steam,
      accountName: "x833830262"
    });

    assert.equal(Array.isArray(result.catalog), true);
    assert.deepEqual(
      result.catalog.map((entry) => ({
        campaign_id: entry.campaign_id,
        shop_index: entry.shop_index,
        points: entry.points,
        item_name: entry.item_name,
        display_name: entry.display_name
      })),
      [
        {
          campaign_id: 11,
          shop_index: 0,
          points: 4,
          item_name: "lootlist:set_train_2025",
          display_name: "2025 列车停放站收藏品"
        },
        {
          campaign_id: 11,
          shop_index: 1,
          points: 2,
          item_name: "crate_community_35",
          display_name: "热潮武器箱"
        }
      ]
    );
  });
}

async function test_inspect_weapon_armory_enriches_live_bid_options_with_local_catalog() {
  await withLocalXpShopFixture(async () => {
    const logger = createLoggerSink();
    const steam = createFakeSteam();

    attachGcTrace({
      steam,
      logger,
      accountName: "x833830262",
      enabled: true
    });
    steam.emit("receivedFromGC", 730, Language.ClientWelcome, makeClientWelcomePayload({
      redeemableBalance: 8,
      bids: [
        {campaign_id: 11, redeem_id: 0, expected_cost: 4},
        {campaign_id: 11, redeem_id: 1, expected_cost: 2}
      ]
    }));

    const result = await inspectWeaponArmoryWithSteam({
      steam,
      accountName: "x833830262"
    });

    assert.equal(result.options[0].schema.shop_index, 0);
    assert.equal(result.options[0].schema.display_name, "2025 列车停放站收藏品");
    assert.equal(result.options[0].schema.display_name_english, "Train 2025 Collection");
    assert.equal(result.options[1].schema.shop_index, 1);
    assert.equal(result.options[1].schema.display_name, "热潮武器箱");
    assert.equal(result.options[1].schema.points, 2);
  });
}

async function test_probe_weapon_armory_returns_recent_gc_history_without_redeeming() {
  const logger = createLoggerSink();
  let steam = null;
  steam = createFakeSteam((appid, msgType, protoBufHeader, payload, callback) => {
    if (msgType === XP_SHOP_ACK_TRACKS_MSG_TYPE) {
      setImmediate(() => {
        steam.emit("receivedFromGC", 730, 9173, Buffer.from("0801", "hex"));
        if (typeof callback === "function") {
          callback(appid, msgType, Buffer.alloc(0));
        }
      });
      return;
    }
  });

  attachGcTrace({
    steam,
    logger,
    accountName: "x833830262",
    enabled: true
  });

  const result = await probeWeaponArmoryWithSteam({
    steam,
    accountName: "x833830262",
    logger,
    ackTracks: true,
    ackWaitMs: 0,
    waitMs: 30
  });

  assert.equal(result.ok, true);
  assert.equal(result.ack_tracks.sent, true);
  assert.equal(Array.isArray(result.observed_gc_messages), true);
  assert.ok(
    result.observed_gc_messages.some((entry) => entry.direction === "out" && entry.msg_type === XP_SHOP_ACK_TRACKS_MSG_TYPE),
    `expected outbound ack message, got:\n${JSON.stringify(result.observed_gc_messages, null, 2)}`
  );
  assert.ok(
    result.observed_gc_messages.some((entry) => entry.direction === "in" && entry.msg_type === 9173),
    `expected inbound follow-up message, got:\n${JSON.stringify(result.observed_gc_messages, null, 2)}`
  );
  assert.equal(result.before_state.notify, null);
  assert.equal(result.after_state.notify, null);
}

async function main() {
  await test_inspect_weapon_armory_returns_live_bid_options();
  await test_inspect_weapon_armory_exposes_local_catalog_without_live_bids();
  await test_inspect_weapon_armory_enriches_live_bid_options_with_local_catalog();
  await test_probe_weapon_armory_returns_recent_gc_history_without_redeeming();
  await test_redeem_service_auto_resolves_live_bid_and_confirms_success();
  await test_redeem_service_rejects_ambiguous_bid_selection_without_explicit_ids();
  console.log("weapon-armory-service tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
