const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  validatePassword
} = require("../shared/validation");
const {
  LICENSE_SNAPSHOT_POLICY,
  validateSnapshot
} = require("../shared/licensePolicy");

function makeSnapshot(overrides = {}) {
  return {
    sub: "user-1",
    username: "alice",
    device_id: "device-1",
    membership_plan: "member",
    permissions: [],
    feature_flags: {},
    policy_version: 1,
    jti: "snapshot-1",
    iat: "2026-07-19T12:00:00.000Z",
    exp: "2026-07-19T12:15:00.000Z",
    iss: "cs2-alchemy-control-plane",
    aud: "cs2-alchemy-desktop",
    token_type: "entitlement",
    key_id: "local-ed25519-v1",
    ...overrides
  };
}

function test_password_policy_uses_length_without_composition_rules() {
  assert.equal(validatePassword("abcdefghijk").ok, false);
  assert.equal(validatePassword("abcdefghijkl").ok, true);
  assert.equal(validatePassword("123456789012").ok, true);
  assert.equal(validatePassword(" abcdefghij ").ok, true, "leading and trailing spaces are password data");
  assert.equal(validatePassword("x".repeat(129)).ok, false);
  assert.equal(validatePassword("😀".repeat(11)).ok, false);
  assert.equal(validatePassword("😀".repeat(12)).ok, true);
}

function test_snapshot_policy_requires_fixed_identity_claims() {
  assert.deepEqual(LICENSE_SNAPSHOT_POLICY, {
    issuer: "cs2-alchemy-control-plane",
    audience: "cs2-alchemy-desktop",
    tokenType: "entitlement",
    keyId: "local-ed25519-v1",
    maxTtlMs: 15 * 60 * 1000,
    clockSkewMs: 60 * 1000
  });
  assert.equal(validateSnapshot(makeSnapshot(), {now: "2026-07-19T12:01:00.000Z"}).ok, true);
  assert.equal(validateSnapshot(makeSnapshot({iss: "other"}), {now: "2026-07-19T12:01:00.000Z"}).reason, "issuer_invalid");
  assert.equal(validateSnapshot(makeSnapshot({aud: "other"}), {now: "2026-07-19T12:01:00.000Z"}).reason, "audience_invalid");
  assert.equal(validateSnapshot(makeSnapshot({token_type: "other"}), {now: "2026-07-19T12:01:00.000Z"}).reason, "token_type_invalid");
  assert.equal(validateSnapshot(makeSnapshot({key_id: "other"}), {now: "2026-07-19T12:01:00.000Z"}).reason, "key_id_invalid");
}

function test_snapshot_policy_rejects_excessive_ttl_and_future_issue_time() {
  assert.equal(
    validateSnapshot(makeSnapshot({exp: "2026-07-19T12:15:01.000Z"}), {now: "2026-07-19T12:01:00.000Z"}).reason,
    "ttl_exceeded"
  );
  assert.equal(
    validateSnapshot(makeSnapshot({iat: "2026-07-19T12:02:01.000Z", exp: "2026-07-19T12:10:00.000Z"}), {now: "2026-07-19T12:01:00.000Z"}).reason,
    "issued_in_future"
  );
}

function test_manual_bundle_tool_uses_current_member_snapshot_contract() {
  const source = fs.readFileSync(path.join(__dirname, "..", "tools", "issueLocalLicenseBundle.js"), "utf8");
  assert.match(source, /membershipPlan:\s*"member"/);
  assert.match(source, /LICENSE_SNAPSHOT_POLICY/);
  assert.match(source, /Math\.min\([\s\S]*maxTtlMs/);
}

function main() {
  test_password_policy_uses_length_without_composition_rules();
  test_snapshot_policy_requires_fixed_identity_claims();
  test_snapshot_policy_rejects_excessive_ttl_and_future_issue_time();
  test_manual_bundle_tool_uses_current_member_snapshot_contract();
  console.log("security shared contract tests passed");
}

main();
