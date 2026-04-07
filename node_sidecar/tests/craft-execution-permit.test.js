const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  buildCraftPermitPayload,
  hashCraftPermitPayload,
  validateCraftPermitSnapshot,
  isCraftPermitExpired
} = require("../../shared/craftPermitPolicy");
const {stableJsonStringify} = require("../../shared/licensePolicy");
const {createCraftPermitEnforcer} = require("../src/craftPermitEnforcer");

function createSnapshot(overrides = {}) {
  return {
    sub: "user_1",
    username: "member_a",
    device_id: "device_alpha",
    action: "craft.tradeup.execute",
    account_username: "steam_account_a",
    payload_hash: "sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    jti: "permit_1",
    iat: "2026-04-07T03:00:00.000Z",
    exp: "2026-04-07T03:00:30.000Z",
    ...overrides
  };
}

function test_validate_snapshot_accepts_expected_shape() {
  const result = validateCraftPermitSnapshot(createSnapshot());
  assert.equal(result.ok, true);
}

function test_validate_snapshot_rejects_missing_device_id() {
  const result = validateCraftPermitSnapshot(createSnapshot({
    device_id: ""
  }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "device_id_missing");
}

function test_validate_snapshot_rejects_missing_payload_hash() {
  const result = validateCraftPermitSnapshot(createSnapshot({
    payload_hash: ""
  }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "payload_hash_missing");
}

function test_expiry_helper_detects_expired_permit() {
  const snapshot = createSnapshot();
  assert.equal(isCraftPermitExpired(snapshot, "2026-04-07T03:00:15.000Z"), false);
  assert.equal(isCraftPermitExpired(snapshot, "2026-04-07T03:00:31.000Z"), true);
}

function test_hash_builder_excludes_password_and_stable_fields() {
  const first = hashCraftPermitPayload("craft.tradeup.execute", {
    username: "steam_account_a",
    allow_cooling: true,
    password: "secret_1",
    item_ids: ["1", "2", "3"]
  });
  const second = hashCraftPermitPayload("craft.tradeup.execute", {
    username: "steam_account_a",
    allow_cooling: true,
    password: "secret_2",
    item_ids: ["1", "2", "3"]
  });
  assert.equal(first, second);

  const payload = buildCraftPermitPayload("craft.tradeup.execute", {
    username: "steam_account_a",
    allow_cooling: true,
    password: "secret_1",
    item_ids: ["1", "2", "3"]
  });
  assert.equal(payload.password, undefined);
  assert.equal(payload.username, "steam_account_a");
}

function createSignedPermit(snapshotOverrides = {}) {
  const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
  const snapshot = createSnapshot(snapshotOverrides);
  return {
    permit: {
      snapshot,
      signature: crypto.sign(null, Buffer.from(stableJsonStringify(snapshot)), privateKey).toString("base64")
    },
    publicKey
  };
}

function test_enforcer_accepts_valid_signed_permit() {
  const {permit, publicKey} = createSignedPermit();
  const result = createCraftPermitEnforcer({
    publicKey,
    deviceId: "device_alpha"
  }).evaluatePermit(permit, {
    action: "craft.tradeup.execute",
    accountUsername: "steam_account_a",
    payloadHash: "sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    now: "2026-04-07T03:00:10.000Z"
  });
  assert.equal(result.ok, true);
}

function test_enforcer_rejects_payload_hash_mismatch() {
  const {permit, publicKey} = createSignedPermit();
  const result = createCraftPermitEnforcer({
    publicKey,
    deviceId: "device_alpha"
  }).evaluatePermit(permit, {
    action: "craft.tradeup.execute",
    accountUsername: "steam_account_a",
    payloadHash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    now: "2026-04-07T03:00:10.000Z"
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "payload_hash_mismatch");
}

function test_enforcer_rejects_device_mismatch() {
  const {permit, publicKey} = createSignedPermit();
  const result = createCraftPermitEnforcer({
    publicKey,
    deviceId: "device_beta"
  }).evaluatePermit(permit, {
    action: "craft.tradeup.execute",
    accountUsername: "steam_account_a",
    payloadHash: "sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    now: "2026-04-07T03:00:10.000Z"
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "device_mismatch");
}

function test_enforcer_rejects_expired_permit() {
  const {permit, publicKey} = createSignedPermit();
  const result = createCraftPermitEnforcer({
    publicKey,
    deviceId: "device_alpha"
  }).evaluatePermit(permit, {
    action: "craft.tradeup.execute",
    accountUsername: "steam_account_a",
    payloadHash: "sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    now: "2026-04-07T03:00:31.000Z"
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "permit_expired");
}

function main() {
  test_validate_snapshot_accepts_expected_shape();
  test_validate_snapshot_rejects_missing_device_id();
  test_validate_snapshot_rejects_missing_payload_hash();
  test_expiry_helper_detects_expired_permit();
  test_hash_builder_excludes_password_and_stable_fields();
  test_enforcer_accepts_valid_signed_permit();
  test_enforcer_rejects_payload_hash_mismatch();
  test_enforcer_rejects_device_mismatch();
  test_enforcer_rejects_expired_permit();
  console.log("craft-execution-permit tests passed");
}

main();
