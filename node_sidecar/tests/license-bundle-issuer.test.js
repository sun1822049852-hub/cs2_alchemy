const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {FEATURE_CODES, LICENSE_SNAPSHOT_POLICY} = require("../../shared/licensePolicy");
const {createLicenseEnforcer} = require("../src/licenseEnforcer");
const {createSignedLicenseBundle} = require("../src/licenseBundleIssuer");

function test_issuer_creates_bundle_that_enforcer_accepts() {
  const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
  const bundle = createSignedLicenseBundle({
    privateKey,
    snapshot: {
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
      exp: "2026-04-04T12:15:00.000Z"
      ,iss: LICENSE_SNAPSHOT_POLICY.issuer
      ,aud: LICENSE_SNAPSHOT_POLICY.audience
      ,token_type: LICENSE_SNAPSHOT_POLICY.tokenType
      ,key_id: LICENSE_SNAPSHOT_POLICY.keyId
    }
  });
  const result = createLicenseEnforcer({
    publicKey,
    deviceId: "device_alpha"
  }).evaluateBundle(bundle, {
    now: "2026-04-04T12:05:00.000Z"
  });
  assert.equal(result.ok, true);
  assert.equal(result.user.username, "member_a");
}

function main() {
  test_issuer_creates_bundle_that_enforcer_accepts();
  console.log("license-bundle-issuer tests passed");
}

main();
