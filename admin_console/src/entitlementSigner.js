const crypto = require("node:crypto");
const fs = require("node:fs");
const {FEATURE_CODES} = require("../../shared/featureCodes");
const {createSignedLicenseBundle} = require("../../node_sidecar/src/licenseBundleIssuer");
const {LICENSE_SNAPSHOT_POLICY} = require("../../shared/licensePolicy");
const {PATHS, DEFAULTS} = require("./constants");
const {asString} = require("../../node_sidecar/src/utils");

function resolvePrivateKey(privateKeyFile = "") {
  const filePath = asString(privateKeyFile).trim() || PATHS.DEFAULT_PRIVATE_KEY_FILE;
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`private key not found: ${filePath}`);
  }
  return crypto.createPrivateKey(fs.readFileSync(filePath, "utf8"));
}

function createEntitlementSigner({
  privateKeyFile = "",
  now = () => new Date(),
  snapshotTtlMinutes = DEFAULTS.SNAPSHOT_TTL_MINUTES
} = {}) {
  function resolveNow() {
    const current = now();
    return current instanceof Date ? current : new Date(current);
  }

  return {
    issueBundle({
      user = null,
      deviceId = "",
      permissions = [],
      featureFlags = null,
      refreshCredential = "",
      source = "local_login"
    } = {}) {
      const account = user && typeof user === "object" ? user : null;
      if (!account) {
        throw new Error("user is required");
      }
      const device = asString(deviceId).trim();
      if (!device) {
        throw new Error("device_id is required");
      }
      const iat = resolveNow();
      const requestedTtlMs = Math.max(1, Number(snapshotTtlMinutes) || DEFAULTS.SNAPSHOT_TTL_MINUTES) * 60 * 1000;
      const exp = new Date(iat.getTime() + Math.min(requestedTtlMs, LICENSE_SNAPSHOT_POLICY.maxTtlMs));
      const resolvedPermissions = Array.isArray(permissions) ? [...permissions] : [];
      const resolvedFeatureFlags = featureFlags && typeof featureFlags === "object"
        ? {...featureFlags}
        : {simulation_enabled: resolvedPermissions.includes(FEATURE_CODES.SIMULATION_USE)};
      resolvedFeatureFlags.membership_expires_at = asString(account.membership_expires_at).trim();
      return createSignedLicenseBundle({
        privateKey: resolvePrivateKey(privateKeyFile),
        refreshCredential,
        source,
        snapshot: {
          sub: asString(account.id).trim(),
          username: asString(account.username).trim(),
          device_id: device,
          membership_plan: asString(account.membership_plan).trim() || "inactive",
          permissions: resolvedPermissions,
          feature_flags: resolvedFeatureFlags,
          iss: LICENSE_SNAPSHOT_POLICY.issuer,
          aud: LICENSE_SNAPSHOT_POLICY.audience,
          token_type: LICENSE_SNAPSHOT_POLICY.tokenType,
          key_id: LICENSE_SNAPSHOT_POLICY.keyId,
          policy_version: 1,
          jti: crypto.randomUUID(),
          iat: iat.toISOString(),
          exp: exp.toISOString()
        }
      });
    }
  };
}

module.exports = {
  createEntitlementSigner
};
