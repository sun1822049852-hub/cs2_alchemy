const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {assertSecureControlPlaneBaseUrl} = require("../node_sidecar/src/controlPlaneUrlPolicy");
const {getMailConfig} = require("../admin_console/src/mailConfig");
const {DEFAULTS} = require("../admin_console/src/constants");

const ROOT = path.resolve(__dirname, "..");
const LOOPBACK_BASE_URL = "http://127.0.0.1:8787";

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function test_client_configs_only_target_the_local_control_plane() {
  const localConfig = JSON.parse(read("client_config.json"));
  assert.equal(localConfig.control_plane_base_url, LOOPBACK_BASE_URL);

  const releaseConfig = JSON.parse(read("node_sidecar/build/client_config.release.json"));
  assert.equal("control_plane_base_url" in releaseConfig, false);
}

function test_remote_console_and_deployment_helpers_are_removed() {
  for (const relativePath of [
    "connect console.cmd",
    "admin_console/tools/connectAdminConsole.cmd",
    "admin_console/tools/connectAdminConsole.ps1",
    "admin_console/deploy/harden_remote_access.sh",
    "admin_console/deploy/cs2-auth-gateway.nginx.conf"
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, relativePath)), false, relativePath);
  }
}

function test_user_facing_docs_do_not_retain_the_retired_server() {
  const documentation = ["README.md", "admin_console/README.md", "node_sidecar/README.md"]
    .map(read)
    .join("\n");
  assert.doesNotMatch(documentation, /8\.138\.39\.139/);
  assert.doesNotMatch(documentation, /connectAdminConsole|harden_remote_access|cs2-auth-gateway|通过 SSH 隧道|部署在远端/i);
}

function test_active_client_sources_use_local_control_plane_language() {
  const source = [
    "node_sidecar/src/uiServer.js",
    "node_sidecar/ui/app.js"
  ].map(read).join("\n");
  assert.doesNotMatch(source, /远端认证|远程认证|remote_login|remote_refresh/);
}

function test_runtime_rejects_non_loopback_control_plane_urls() {
  assert.equal(assertSecureControlPlaneBaseUrl(LOOPBACK_BASE_URL), LOOPBACK_BASE_URL);
  assert.throws(
    () => assertSecureControlPlaneBaseUrl("https://auth.example.com"),
    (error) => error && error.code === "non_local_control_plane_base_url"
  );
}

function test_control_plane_listener_and_session_defaults_are_local_only() {
  const config = getMailConfig({
    env: {AUTH_SERVICE_HOST: "0.0.0.0"},
    envFile: path.join(ROOT, "missing-control-plane.env")
  });
  assert.equal(config.host, "127.0.0.1");
  assert.equal(DEFAULTS.ADMIN_SESSION_HOURS, 8);
  assert.equal("CRAFT_PERMIT_TTL_SECONDS" in DEFAULTS, false);
}

function main() {
  test_client_configs_only_target_the_local_control_plane();
  test_remote_console_and_deployment_helpers_are_removed();
  test_user_facing_docs_do_not_retain_the_retired_server();
  test_active_client_sources_use_local_control_plane_language();
  test_runtime_rejects_non_loopback_control_plane_urls();
  test_control_plane_listener_and_session_defaults_are_local_only();
  console.log("local-control-plane-contract tests passed");
}

main();
