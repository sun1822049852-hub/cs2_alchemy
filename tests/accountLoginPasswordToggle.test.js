const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "..", "node_sidecar", "ui", "index.html");
const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");
const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");

const html = fs.readFileSync(htmlPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const app = fs.readFileSync(appPath, "utf8");

const htmlFragments = [
  'class="account-password-field-wrap"',
  'id="accountPasswordToggle"',
  'class="account-password-toggle"',
  'class="account-password-toggle-icon"'
];

for (const fragment of htmlFragments) {
  assert.equal(
    html.includes(fragment),
    true,
    `account login password html should include fragment: ${fragment}`
  );
}

const cssFragments = [
  ".account-password-field-wrap {",
  ".account-password-toggle {",
  ".account-password-toggle-icon::before {",
  "body.theme-inkblue .account-password-toggle {"
];

for (const fragment of cssFragments) {
  assert.equal(
    css.includes(fragment),
    true,
    `account login password css should include fragment: ${fragment}`
  );
}

const appFragments = [
  'accountPasswordToggle: document.getElementById("accountPasswordToggle")',
  "function syncAccountPasswordVisibility() {",
  "ui.accountPassword.type = state.accountPasswordVisible ? \"text\" : \"password\";",
  "state.accountPasswordVisible = !state.accountPasswordVisible;",
  'ui.accountTotp.addEventListener("keydown", (evt) => {',
  'setAccountStatus("正在登录，请稍候...");'
];

for (const fragment of appFragments) {
  assert.equal(
    app.includes(fragment),
    true,
    `account login password app should include fragment: ${fragment}`
  );
}

assert.doesNotMatch(
  app,
  /ui\.accountLoginModal\.addEventListener\("click",\s*\(evt\)\s*=>\s*\{[\s\S]*clearAccountForm\(\);[\s\S]*\}\);/m,
  "account login modal should no longer close from backdrop clicks"
);

assert.doesNotMatch(
  app,
  /ui\.accountTotp\.addEventListener\("keydown",\s*\(evt\)\s*=>\s*\{[\s\S]*evt\.key === "Escape"[\s\S]*clearAccountForm\(\);[\s\S]*\}\);/m,
  "account totp field should no longer close the modal on Escape"
);

assert.doesNotMatch(
  app,
  /ui\.accountLoginModal\.addEventListener\("keydown",\s*\(evt\)\s*=>\s*\{[\s\S]*evt\.key !== "Escape"[\s\S]*clearAccountForm\(\);[\s\S]*\}\);/m,
  "account login modal should no longer close on Escape"
);

assert.equal(
  app.includes("正在登录并获取 token，请稍候..."),
  false,
  "account login status should no longer mention fetching token"
);

console.log("accountLoginPasswordToggle tests passed");
