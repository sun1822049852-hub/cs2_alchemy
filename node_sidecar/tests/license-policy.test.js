const assert = require("node:assert/strict");

const {
  FEATURE_CODES,
  LICENSE_SNAPSHOT_POLICY,
  stableJsonStringify,
  validateSnapshot,
  isSnapshotExpired,
  hasFeature
} = require("../../shared/licensePolicy");

function createSnapshot(overrides = {}) {
  return {
    sub: "user_1",
    username: "member_a",
    device_id: "device_alpha",
    membership_plan: "member",
    permissions: [FEATURE_CODES.ACCOUNTS_READ, FEATURE_CODES.CRAFT_USE],
    feature_flags: {
      simulation_enabled: false
    },
    policy_version: 1,
    jti: "snap_1",
    iat: "2026-04-04T12:00:00.000Z",
    exp: "2026-04-04T12:15:00.000Z",
    iss: LICENSE_SNAPSHOT_POLICY.issuer,
    aud: LICENSE_SNAPSHOT_POLICY.audience,
    token_type: LICENSE_SNAPSHOT_POLICY.tokenType,
    key_id: LICENSE_SNAPSHOT_POLICY.keyId,
    ...overrides
  };
}

function test_validate_snapshot_accepts_expected_shape() {
  const result = validateSnapshot(createSnapshot());
  assert.equal(result.ok, true);
}

function test_validate_snapshot_rejects_unknown_permission() {
  const result = validateSnapshot(createSnapshot({
    permissions: ["root.everything"]
  }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "permissions_invalid");
}

function test_snapshot_expiry_and_permission_helpers() {
  const snapshot = createSnapshot();
  assert.equal(isSnapshotExpired(snapshot, "2026-04-04T12:14:59.000Z"), false);
  assert.equal(isSnapshotExpired(snapshot, "2026-04-04T12:15:01.000Z"), true);
  assert.equal(hasFeature(snapshot, FEATURE_CODES.CRAFT_USE), true);
  assert.equal(hasFeature(snapshot, FEATURE_CODES.SIMULATION_USE), false);
}

function test_stable_stringify_is_deterministic() {
  const a = stableJsonStringify({b: 2, a: 1, c: {z: 3, y: 2}});
  const b = stableJsonStringify({c: {y: 2, z: 3}, a: 1, b: 2});
  assert.equal(a, b);
}

function main() {
  test_validate_snapshot_accepts_expected_shape();
  test_validate_snapshot_rejects_unknown_permission();
  test_snapshot_expiry_and_permission_helpers();
  test_stable_stringify_is_deterministic();
  console.log("license-policy tests passed");
}

main();
