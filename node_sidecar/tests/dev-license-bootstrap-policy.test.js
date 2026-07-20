const assert = require("node:assert/strict");

const {LICENSE_SNAPSHOT_POLICY, validateSnapshot} = require("../../shared/licensePolicy");
const {createDevSnapshot} = require("../src/devLicenseBootstrap");

function test_dev_snapshot_matches_the_same_short_lived_policy_as_remote_snapshots() {
  const issuedAt = new Date("2026-07-19T12:00:00.000Z");
  const snapshot = createDevSnapshot({
    devLicenseTtlMinutes: 30 * 24 * 60,
    devLicenseUserId: "dev_user",
    devLicenseUsername: "dev_local"
  }, "device-local", issuedAt);

  assert.equal(snapshot.iss, LICENSE_SNAPSHOT_POLICY.issuer);
  assert.equal(snapshot.aud, LICENSE_SNAPSHOT_POLICY.audience);
  assert.equal(snapshot.token_type, LICENSE_SNAPSHOT_POLICY.tokenType);
  assert.equal(snapshot.key_id, LICENSE_SNAPSHOT_POLICY.keyId);
  assert.equal(snapshot.membership_plan, "member");
  assert.equal(snapshot.feature_flags.craft_enabled, true);
  assert.equal(Date.parse(snapshot.exp) - Date.parse(snapshot.iat), LICENSE_SNAPSHOT_POLICY.maxTtlMs);
  assert.deepEqual(validateSnapshot(snapshot, {now: issuedAt.getTime()}), {ok: true});
}

function main() {
  test_dev_snapshot_matches_the_same_short_lived_policy_as_remote_snapshots();
  console.log("dev-license-bootstrap-policy tests passed");
}

main();
