const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {FEATURE_CODES, stableJsonStringify} = require("../../shared/licensePolicy");
const {createLicenseEnforcer} = require("../src/licenseEnforcer");

function createSnapshot(overrides = {}) {
  return {
    sub: "user_1",
    username: "member_a",
    device_id: "device_alpha",
    membership_plan: "pro",
    permissions: [FEATURE_CODES.ACCOUNTS_READ, FEATURE_CODES.CRAFT_USE],
    feature_flags: {
      simulation_enabled: false
    },
    policy_version: 1,
    jti: "snap_1",
    iat: "2026-04-04T12:00:00.000Z",
    exp: "2026-04-04T12:15:00.000Z",
    ...overrides
  };
}

function createSignedBundle(snapshotOverrides = {}) {
  const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
  const snapshot = createSnapshot(snapshotOverrides);
  const signature = crypto.sign(null, Buffer.from(stableJsonStringify(snapshot)), privateKey).toString("base64");
  return {
    bundle: {
      snapshot,
      signature
    },
    publicKey
  };
}

function test_accepts_valid_signed_bundle() {
  const {bundle, publicKey} = createSignedBundle();
  const enforcer = createLicenseEnforcer({
    publicKey,
    deviceId: "device_alpha"
  });
  const result = enforcer.evaluateBundle(bundle, {
    now: "2026-04-04T12:05:00.000Z"
  });
  assert.equal(result.ok, true);
  assert.equal(result.permissions.includes(FEATURE_CODES.CRAFT_USE), true);
  assert.equal(result.user.username, "member_a");
}

function test_rejects_device_mismatch() {
  const {bundle, publicKey} = createSignedBundle();
  const enforcer = createLicenseEnforcer({
    publicKey,
    deviceId: "device_beta"
  });
  const result = enforcer.evaluateBundle(bundle, {
    now: "2026-04-04T12:05:00.000Z"
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "device_mismatch");
}

function test_rejects_expired_bundle() {
  const {bundle, publicKey} = createSignedBundle();
  const enforcer = createLicenseEnforcer({
    publicKey,
    deviceId: "device_alpha"
  });
  const result = enforcer.evaluateBundle(bundle, {
    now: "2026-04-04T12:16:00.000Z"
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "license_expired");
}

function main() {
  test_accepts_valid_signed_bundle();
  test_rejects_device_mismatch();
  test_rejects_expired_bundle();
  console.log("license-gate tests passed");
}

main();
