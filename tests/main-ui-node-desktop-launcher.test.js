const assert = require("node:assert/strict");
const path = require("node:path");

const {buildDesktopLauncherEnv} = require("../node_sidecar/src/devDesktopLaunchEnv");

function test_defaults_to_dev_auto_bundle_when_auth_mode_missing() {
  const projectRoot = path.resolve(__dirname, "..");
  const env = buildDesktopLauncherEnv({}, {projectRoot});
  assert.equal(env.CLIENT_AUTH_MODE, "dev_auto_bundle");
  assert.equal(env.CLIENT_DEV_LICENSE_PRIVATE_KEY_FILE, path.join(projectRoot, "tmp", "client_license_private.pem"));
  assert.equal(env.CONTROL_PLANE_PUBLIC_KEY_FILE, path.join(projectRoot, "keys", "client_license_public.pem"));
  assert.equal(env.CLIENT_DEV_LICENSE_USERNAME, "dev_local");
  assert.equal(env.CLIENT_DEV_LICENSE_PLAN, "elite");
}

function test_preserves_explicit_auth_mode_from_environment() {
  const env = buildDesktopLauncherEnv({
    CLIENT_AUTH_MODE: "prod_login",
    CLIENT_DEV_LICENSE_USERNAME: "custom_user"
  });
  assert.equal(env.CLIENT_AUTH_MODE, "prod_login");
  assert.equal(env.CLIENT_DEV_LICENSE_USERNAME, "custom_user");
}

function main() {
  test_defaults_to_dev_auto_bundle_when_auth_mode_missing();
  test_preserves_explicit_auth_mode_from_environment();
  console.log("main-ui-node-desktop-launcher tests passed");
}

main();
