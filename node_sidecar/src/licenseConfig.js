const path = require("path");
const {PATHS} = require("./constants");

function resolveNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }
  return Math.trunc(number);
}

function resolveAuthMode(value) {
  const mode = String(value || "").trim();
  if (mode === "prod_login") {
    return "prod_login";
  }
  if (mode === "dev_auto_bundle") {
    return "dev_auto_bundle";
  }
  return "debug_bundle";
}

function getLicenseConfig(overrides = {}) {
  const value = overrides && typeof overrides === "object" ? overrides : {};
  const controlPlaneBaseUrl = value.controlPlaneBaseUrl || process.env.CONTROL_PLANE_BASE_URL || "";
  const authMode = resolveAuthMode(value.authMode || process.env.CLIENT_AUTH_MODE || "");
  const publicKeyFile = value.publicKeyFile
    || process.env.CONTROL_PLANE_PUBLIC_KEY_FILE
    || path.join(PATHS.ROOT_DIR, "keys", "client_license_public.pem");
  const devLicensePrivateKeyFile = value.devLicensePrivateKeyFile
    || process.env.CLIENT_DEV_LICENSE_PRIVATE_KEY_FILE
    || path.join(PATHS.ROOT_DIR, "tmp", "client_license_private.pem");
  const machineIdFile = value.machineIdFile || process.env.CLIENT_MACHINE_ID_FILE || PATHS.MACHINE_ID_FILE;
  const licenseStateFile = value.licenseStateFile || process.env.CLIENT_LICENSE_STATE_FILE || PATHS.LICENSE_STATE_FILE;
  return {
    authMode,
    allowManualImport: authMode === "debug_bundle",
    controlPlaneBaseUrl: String(controlPlaneBaseUrl || "").trim(),
    publicKeyFile: path.resolve(publicKeyFile),
    devLicensePrivateKeyFile: path.resolve(devLicensePrivateKeyFile),
    machineIdFile: path.resolve(machineIdFile),
    licenseStateFile: path.resolve(licenseStateFile),
    refreshIntervalMs: resolveNumber(value.refreshIntervalMs || process.env.LICENSE_REFRESH_MS, 5 * 60 * 1000),
    snapshotTtlMs: resolveNumber(value.snapshotTtlMs || process.env.LICENSE_SNAPSHOT_TTL_MS, 15 * 60 * 1000),
    devLicenseTtlMinutes: resolveNumber(value.devLicenseTtlMinutes || process.env.CLIENT_DEV_LICENSE_TTL_MINUTES, 30 * 24 * 60),
    devLicenseUsername: String(value.devLicenseUsername || process.env.CLIENT_DEV_LICENSE_USERNAME || "dev_local").trim() || "dev_local",
    devLicenseUserId: String(value.devLicenseUserId || process.env.CLIENT_DEV_LICENSE_USER_ID || "dev_local_user").trim() || "dev_local_user",
    devLicenseMembershipPlan: String(value.devLicenseMembershipPlan || process.env.CLIENT_DEV_LICENSE_PLAN || "elite").trim() || "elite"
  };
}

module.exports = {
  getLicenseConfig
};
