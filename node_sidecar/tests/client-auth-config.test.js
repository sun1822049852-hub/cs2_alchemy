const assert = require("node:assert/strict");
const path = require("node:path");
const {getLicenseConfig} = require("../src/licenseConfig");

function withEnv(overrides, run) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value === null || value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  try {
    run();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

function test_defaults_to_debug_bundle_mode() {
  withEnv({
    CLIENT_AUTH_MODE: null,
    CONTROL_PLANE_BASE_URL: null
  }, () => {
    const config = getLicenseConfig();
    assert.equal(config.authMode, "debug_bundle");
    assert.equal(config.allowManualImport, true);
    assert.equal(config.controlPlaneBaseUrl, "");
  });
}

function test_reads_prod_login_mode_from_env() {
  withEnv({
    CLIENT_AUTH_MODE: "prod_login",
    CONTROL_PLANE_BASE_URL: "https://auth.example.com"
  }, () => {
    const config = getLicenseConfig();
    assert.equal(config.authMode, "prod_login");
    assert.equal(config.allowManualImport, false);
    assert.equal(config.controlPlaneBaseUrl, "https://auth.example.com");
  });
}

function test_reads_dev_auto_bundle_mode_from_env() {
  withEnv({
    CLIENT_AUTH_MODE: "dev_auto_bundle",
    CLIENT_DEV_LICENSE_PRIVATE_KEY_FILE: "C:/tmp/dev-private.pem"
  }, () => {
    const config = getLicenseConfig();
    assert.equal(config.authMode, "dev_auto_bundle");
    assert.equal(config.allowManualImport, false);
    assert.equal(path.basename(String(config.devLicensePrivateKeyFile || "")), "dev-private.pem");
  });
}

function main() {
  test_defaults_to_debug_bundle_mode();
  test_reads_prod_login_mode_from_env();
  test_reads_dev_auto_bundle_mode_from_env();
  console.log("client-auth-config tests passed");
}

main();
