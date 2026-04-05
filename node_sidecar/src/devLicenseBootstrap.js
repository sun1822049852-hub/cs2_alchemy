const crypto = require("node:crypto");
const fs = require("node:fs");
const {ALL_FEATURE_CODES} = require("../../shared/featureCodes");
const {createSignedLicenseBundle} = require("./licenseBundleIssuer");
const {asString} = require("./utils");

function createDevSnapshot(config = {}, deviceId = "", nowValue = new Date()) {
  const issuedAt = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const ttlMinutes = Math.max(1, Number(config.devLicenseTtlMinutes) || (30 * 24 * 60));
  const expiresAt = new Date(issuedAt.getTime() + ttlMinutes * 60 * 1000);
  return {
    sub: asString(config.devLicenseUserId).trim() || "dev_local_user",
    username: asString(config.devLicenseUsername).trim() || "dev_local",
    device_id: asString(deviceId).trim(),
    membership_plan: asString(config.devLicenseMembershipPlan).trim() || "elite",
    permissions: [...ALL_FEATURE_CODES],
    feature_flags: {
      simulation_enabled: true
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
  const privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyFile, "utf8"));
  const bundle = createSignedLicenseBundle({
    privateKey,
    source: "dev_auto_bundle",
    snapshot: createDevSnapshot(config, resolvedDeviceId, now())
  });
  return scheduler.importBundle(bundle);
}

module.exports = {
  bootstrapDevLicense
};
