const assert = require("node:assert/strict");

const Language = require("globaloffensive/language.js");
const {
  normalizeRedeemMissionRewardOptions,
  buildRedeemMissionRewardPayload,
  decodeRedeemMissionRewardPayload,
  sendRedeemMissionReward
} = require("../src/redeemMissionReward");

function test_normalize_redeem_mission_reward_options_maps_cli_args() {
  const normalized = normalizeRedeemMissionRewardOptions({
    account: "x833830262",
    "campaign-id": "11",
    "redeem-id": "0",
    balance: "200",
    cost: "4",
    "bid-control": "0",
    "ack-tracks": "true",
    "ack-wait-ms": "350",
    "wait-ms": "9000"
  });

  assert.deepEqual(normalized, {
    accountName: "x833830262",
    campaignId: 11,
    redeemId: 0,
    redeemableBalance: 200,
    expectedCost: 4,
    bidControl: 0,
    ackTracks: true,
    ackWaitMs: 350,
    waitMs: 9000
  });
}

function test_normalize_redeem_mission_reward_options_allows_missing_live_fields_when_requested() {
  const normalized = normalizeRedeemMissionRewardOptions({
    account: "x833830262",
    "redeem-id": "0",
    "ack-tracks": "true"
  }, {
    allowMissing: true
  });

  assert.deepEqual(normalized, {
    accountName: "x833830262",
    campaignId: undefined,
    redeemId: 0,
    redeemableBalance: undefined,
    expectedCost: undefined,
    bidControl: 0,
    ackTracks: true,
    ackWaitMs: 500,
    waitMs: 8000
  });
}

function test_build_redeem_mission_reward_payload_omits_zero_bid_control_field() {
  const payload = buildRedeemMissionRewardPayload({
    campaignId: 11,
    redeemId: 0,
    redeemableBalance: 200,
    expectedCost: 4,
    bidControl: 0
  });

  assert.equal(payload.toString("hex"), "080b100018c8012004");
  assert.deepEqual(decodeRedeemMissionRewardPayload(payload), {
    campaign_id: 11,
    redeem_id: 0,
    redeemable_balance: 200,
    expected_cost: 4,
    bid_control: 0
  });
}

function test_build_redeem_mission_reward_payload_keeps_non_zero_bid_control_field() {
  const payload = buildRedeemMissionRewardPayload({
    campaignId: 11,
    redeemId: 0,
    redeemableBalance: 200,
    expectedCost: 4,
    bidControl: 7
  });

  assert.equal(payload.toString("hex"), "080b100018c80120042807");
  assert.deepEqual(decodeRedeemMissionRewardPayload(payload), {
    campaign_id: 11,
    redeem_id: 0,
    redeemable_balance: 200,
    expected_cost: 4,
    bid_control: 7
  });
}

function test_send_redeem_mission_reward_uses_9209_payload_and_callback() {
  const calls = [];
  const steam = {
    sendToGC(appid, msgType, protoBufHeader, payload, callback) {
      calls.push({appid, msgType, protoBufHeader, payload, callback});
    }
  };

  const onResponse = () => {};
  sendRedeemMissionReward({
    steam,
    campaignId: 11,
    redeemId: 0,
    redeemableBalance: 200,
    expectedCost: 4,
    bidControl: 0,
    onResponse
  });

  assert.equal(calls.length, 1, `expected one GC send, got ${calls.length}`);
  assert.equal(calls[0].appid, 730);
  assert.equal(calls[0].msgType, Language.ClientRedeemMissionReward);
  assert.deepEqual(calls[0].protoBufHeader, {});
  assert.equal(calls[0].callback, onResponse);
  assert.deepEqual(decodeRedeemMissionRewardPayload(calls[0].payload), {
    campaign_id: 11,
    redeem_id: 0,
    redeemable_balance: 200,
    expected_cost: 4,
    bid_control: 0
  });
}

function main() {
  test_normalize_redeem_mission_reward_options_maps_cli_args();
  test_normalize_redeem_mission_reward_options_allows_missing_live_fields_when_requested();
  test_build_redeem_mission_reward_payload_omits_zero_bid_control_field();
  test_build_redeem_mission_reward_payload_keeps_non_zero_bid_control_field();
  test_send_redeem_mission_reward_uses_9209_payload_and_callback();
  console.log("redeem-mission-reward tests passed");
}

main();
