const crypto = require("node:crypto");
const fs = require("node:fs");
const {ALL_FEATURE_CODES, FEATURE_CODES} = require("../../shared/featureCodes");
const {createSignedLicenseBundle} = require("../../node_sidecar/src/licenseBundleIssuer");
const {stableJsonStringify} = require("../../shared/licensePolicy");
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

  function signSnapshot(snapshot) {
    return crypto.sign(null, Buffer.from(stableJsonStringify(snapshot)), resolvePrivateKey(privateKeyFile)).toString("base64");
  }

  return {
    issueBundle({
      user = null,
      deviceId = "",
      permissions = ALL_FEATURE_CODES,
      featureFlags = {simulation_enabled: true},
      refreshCredential = "",
      source = "remote_login"
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
      const exp = new Date(iat.getTime() + Math.max(1, Number(snapshotTtlMinutes) || DEFAULTS.SNAPSHOT_TTL_MINUTES) * 60 * 1000);
      const resolvedPermissions = Array.isArray(permissions) ? [...permissions] : [...ALL_FEATURE_CODES];
      return createSignedLicenseBundle({
        privateKey: resolvePrivateKey(privateKeyFile),
        refreshCredential,
        source,
        snapshot: {
          sub: asString(account.id).trim(),
          username: asString(account.username).trim(),
          device_id: device,
          membership_plan: asString(account.membership_plan).trim() || "pro",
          permissions: resolvedPermissions,
          feature_flags: featureFlags && typeof featureFlags === "object"
            ? {...featureFlags}
            : {simulation_enabled: resolvedPermissions.includes(FEATURE_CODES.SIMULATION_USE)},
          policy_version: 1,
          jti: crypto.randomUUID(),
          iat: iat.toISOString(),
          exp: exp.toISOString()
        }
      });
    },
    issueCraftPermit({
      user = null,
      deviceId = "",
      action = "",
      accountUsername = "",
      payloadHash = "",
      ttlSeconds = DEFAULTS.CRAFT_PERMIT_TTL_SECONDS,
      source = "remote_craft_permit"
    } = {}) {
      const account = user && typeof user === "object" ? user : null;
      if (!account) {
        throw new Error("user is required");
      }
      const device = asString(deviceId).trim();
      if (!device) {
        throw new Error("device_id is required");
      }
      const actionCode = asString(action).trim();
      if (!actionCode) {
        throw new Error("action is required");
      }
      const steamAccount = asString(accountUsername).trim();
      if (!steamAccount) {
        throw new Error("account_username is required");
      }
      const hash = asString(payloadHash).trim();
      if (!hash) {
        throw new Error("payload_hash is required");
      }
      const iat = resolveNow();
      const exp = new Date(iat.getTime() + Math.max(1, Number(ttlSeconds) || DEFAULTS.CRAFT_PERMIT_TTL_SECONDS) * 1000);
      const snapshot = {
        sub: asString(account.id).trim(),
        username: asString(account.username).trim(),
        device_id: device,
        action: actionCode,
        account_username: steamAccount,
        payload_hash: hash,
        jti: crypto.randomUUID(),
        iat: iat.toISOString(),
        exp: exp.toISOString()
      };
      return {
        snapshot,
        signature: signSnapshot(snapshot),
        source: asString(source).trim() || "remote_craft_permit"
      };
    }
  };
}

module.exports = {
  createEntitlementSigner
};
