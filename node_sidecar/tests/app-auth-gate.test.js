const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const HTML = fs.readFileSync(path.resolve(__dirname, "../ui/index.html"), "utf8");
const JS = fs.readFileSync(path.resolve(__dirname, "../ui/app.js"), "utf8");
const CSS = fs.readFileSync(path.resolve(__dirname, "../ui/styles.css"), "utf8");

function test_index_renders_license_gate_shell() {
  assert.match(HTML, /id="licenseGate"/);
  assert.match(HTML, /id="clientLoginUsername"/);
  assert.match(HTML, /id="clientLoginPassword"/);
  assert.match(HTML, /id="clientLoginSubmitBtn"/);
  assert.match(HTML, /id="clientRegisterPanel"/);
  assert.match(HTML, /id="clientResetPanel"/);
  assert.match(HTML, /id="licenseBundleInput"/);
}

function test_app_js_bootstraps_license_state_and_handlers() {
  assert.match(JS, /\/api\/client-auth\/state/);
  assert.match(JS, /\/api\/client-auth\/login/);
  assert.match(JS, /submitClientLogin/);
  assert.match(JS, /clientAuthView/);
  assert.match(JS, /clientAuthModalOpen/);
  assert.match(JS, /clientAuthPromptTitle/);
  assert.match(JS, /clientAuthPromptHint/);
  assert.match(JS, /\/api\/license\/import/);
  assert.match(JS, /__cs2AlchemyHandleApiLicenseFailure/);
}

function test_styles_include_license_gate_scope() {
  assert.match(CSS, /\.app-auth-gate/);
  assert.match(CSS, /\.app-auth-card/);
  assert.match(CSS, /\.app-auth-mode-tabs/);
  assert.match(CSS, /\.app-auth-panel/);
}

function main() {
  test_index_renders_license_gate_shell();
  test_app_js_bootstraps_license_state_and_handlers();
  test_styles_include_license_gate_scope();
  console.log("app-auth-gate tests passed");
}

main();
