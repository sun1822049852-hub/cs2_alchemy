const assert = require("node:assert/strict");

const {
  XP_SHOP_NOTIFY_MSG_TYPE,
  XP_SHOP_ACK_TRACKS_MSG_TYPE,
  sendAckXpShopTracks,
  decodeNotifyXpShopPayload
} = require("../src/xpShopMessages");

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

function buildXpShopObject({field1Time, redeemableBalance, xpTrackValues}) {
  return Buffer.concat([
    encodeVarintField(1, field1Time),
    encodeVarintField(2, redeemableBalance),
    ...xpTrackValues.map((value) => encodeVarintField(3, value))
  ]);
}

function test_send_ack_xpshop_tracks_uses_9222_empty_payload_and_callback() {
  const calls = [];
  const steam = {
    sendToGC(appid, msgType, protoBufHeader, payload, callback) {
      calls.push({appid, msgType, protoBufHeader, payload, callback});
    }
  };

  const onResponse = () => {};
  const payload = sendAckXpShopTracks({
    steam,
    onResponse
  });

  assert.equal(XP_SHOP_NOTIFY_MSG_TYPE, 9221);
  assert.equal(XP_SHOP_ACK_TRACKS_MSG_TYPE, 9222);
  assert.equal(payload.length, 0);
  assert.equal(calls.length, 1, `expected one GC send, got ${calls.length}`);
  assert.equal(calls[0].appid, 730);
  assert.equal(calls[0].msgType, 9222);
  assert.deepEqual(calls[0].protoBufHeader, {});
  assert.equal(calls[0].payload.length, 0);
  assert.equal(calls[0].callback, onResponse);
}

function test_decode_notify_xpshop_payload_decodes_shop_state() {
  const prematch = buildXpShopObject({
    field1Time: 1775285012,
    redeemableBalance: 200,
    xpTrackValues: [12000, 12000, 12000]
  });
  const postmatch = buildXpShopObject({
    field1Time: 1775285012,
    redeemableBalance: 196,
    xpTrackValues: [12000, 12000, 12000]
  });
  const payload = Buffer.concat([
    encodeBytesField(1, prematch),
    encodeBytesField(2, postmatch),
    encodeVarintField(3, 54321),
    encodeVarintField(4, 42)
  ]);

  assert.deepEqual(decodeNotifyXpShopPayload(payload), {
    prematch: {
      field1_time: 1775285012,
      redeemable_balance: 200,
      xp_track_values: [12000, 12000, 12000]
    },
    postmatch: {
      field1_time: 1775285012,
      redeemable_balance: 196,
      xp_track_values: [12000, 12000, 12000]
    },
    current_xp: 54321,
    current_level: 42
  });
}

function main() {
  test_send_ack_xpshop_tracks_uses_9222_empty_payload_and_callback();
  test_decode_notify_xpshop_payload_decodes_shop_state();
  console.log("xp-shop-messages tests passed");
}

main();
