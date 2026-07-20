const crypto = require("node:crypto");
const fs = require("node:fs");
const {ALL_FEATURE_CODES} = require("../../shared/featureCodes");
const {LICENSE_SNAPSHOT_POLICY} = require("../../shared/licensePolicy");
const {createSignedLicenseBundle} = require("./licenseBundleIssuer");
const {asString} = require("./utils");

function createDevSnapshot(config = {}, deviceId = "", nowValue = new Date()) {
  const issuedAt = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const configuredTtlMs = Math.max(1, Number(config.devLicenseTtlMinutes) || 15) * 60 * 1000;
  const expiresAt = new Date(issuedAt.getTime() + Math.min(configuredTtlMs, LICENSE_SNAPSHOT_POLICY.maxTtlMs));
  return {
    iss: LICENSE_SNAPSHOT_POLICY.issuer,
    aud: LICENSE_SNAPSHOT_POLICY.audience,
    token_type: LICENSE_SNAPSHOT_POLICY.tokenType,
    key_id: LICENSE_SNAPSHOT_POLICY.keyId,
    sub: asString(config.devLicenseUserId).trim() || "dev_local_user",
    username: asString(config.devLicenseUsername).trim() || "dev_local",
    device_id: asString(deviceId).trim(),
    membership_plan: asString(config.devLicenseMembershipPlan).trim() || "member",
    permissions: [...ALL_FEATURE_CODES],
    feature_flags: {
      simulation_enabled: true,
      craft_enabled: true,
      membership_expires_at: ""
    },
    policy_version: 1,
    jti: `dev_auto_${issuedAt.getTime()}`,
    iat: issuedAt.toISOString(),
    exp: expiresAt.toISOString()
  };
}

function bootstrapDevLicense({
  config = {},
  scheduler = null,
  deviceId = "",
  now = () => new Date()
} = {}) {
  if (!scheduler || typeof scheduler.importBundle !== "function") {
    return null;
  }
  if (asString(config.authMode).trim() !== "dev_auto_bundle") {
    return null;
  }
  const privateKeyFile = asString(config.devLicensePrivateKeyFile).trim();
  if (!privateKeyFile || !fs.existsSync(privateKeyFile)) {
    return null;
  }
  const resolvedDeviceId = asString(deviceId).trim();
  if (!resolvedDeviceId) {
    return null;
  }
  const bundle = createDevLicenseBundle({config, deviceId: resolvedDeviceId, now});
  return scheduler.importBundle(bundle);
}

function createDevLicenseBundle({config = {}, deviceId = "", now = () => new Date()} = {}) {
  const privateKeyFile = asString(config.devLicensePrivateKeyFile).trim();
  const resolvedDeviceId = asString(deviceId).trim();
  if (!privateKeyFile || !fs.existsSync(privateKeyFile) || !resolvedDeviceId) {
    return null;
  }
  const privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyFile, "utf8"));
  return createSignedLicenseBundle({
    privateKey,
    source: "dev_auto_bundle",
    snapshot: createDevSnapshot(config, resolvedDeviceId, now())
  });
}

module.exports = {
  bootstrapDevLicense,
  createDevLicenseBundle,
  createDevSnapshot
};
