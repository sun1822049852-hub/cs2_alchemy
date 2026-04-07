const assert = require("node:assert/strict");
const path = require("node:path");

const {buildDesktopLauncherEnv} = require("../node_sidecar/src/devDesktopLaunchEnv");
const {startDesktopLauncher} = require("../main_ui_node_desktop");

function test_release_launcher_defaults_to_prod_login() {
  const projectRoot = path.resolve(__dirname, "..");
  const env = buildDesktopLauncherEnv({}, {projectRoot, mode: "release"});
  assert.equal(env.CLIENT_AUTH_MODE, "prod_login");
  assert.equal("CLIENT_DEV_LICENSE_PRIVATE_KEY_FILE" in env, false);
  assert.equal("CONTROL_PLANE_PUBLIC_KEY_FILE" in env, false);
  assert.equal("CLIENT_DEV_LICENSE_USERNAME" in env, false);
  assert.equal("CLIENT_DEV_LICENSE_PLAN" in env, false);
}

function test_dev_launcher_defaults_to_dev_auto_bundle() {
  const projectRoot = path.resolve(__dirname, "..");
  const env = buildDesktopLauncherEnv({}, {projectRoot, mode: "dev"});
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

function test_workspace_launcher_defaults_to_dev_auto_bundle() {
  let capturedOptions = null;
  startDesktopLauncher({
    baseEnv: {},
    spawnImpl(_command, _args, options) {
      capturedOptions = options;
      return {
        on() {}
      };
    }
  });
  assert.ok(capturedOptions, "launcher should invoke spawn");
  assert.equal(capturedOptions.env.CLIENT_AUTH_MODE, "dev_auto_bundle");
}

function main() {
  test_release_launcher_defaults_to_prod_login();
  test_dev_launcher_defaults_to_dev_auto_bundle();
  test_preserves_explicit_auth_mode_from_environment();
  test_workspace_launcher_defaults_to_dev_auto_bundle();
  console.log("main-ui-node-desktop-launcher tests passed");
}

main();
