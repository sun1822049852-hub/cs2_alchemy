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
  '<header class="topbar account-page-topbar">',
  'id="accountPageSelect"',
  'id="accountPageStatusText"',
  'id="accountPageAddBtn"',
  'id="accountLoginModal"',
  'class="account-list-head-actions"',
  'id="loginSaveBtn"',
  'class="modal-header account-login-brand">',
  'class="account-login-wordmark"',
  'class="account-login-fields"',
  'class="account-login-field">',
  'class="account-login-actions"',
  'class="account-login-status status-text"'
];

for (const fragment of htmlFragments) {
  assert.equal(
    html.includes(fragment),
    true,
    `account page html should include fragment: ${fragment}`
  );
}

assert.equal(
  html.includes('class="account-form-shell"'),
  false,
  "account page should no longer render the inline account form panel"
);

assert.equal(
  html.includes('for="accountRemark"'),
  false,
  "account login modal should not show the remark field anymore"
);

const accountModalStart = html.indexOf('<div id="accountLoginModal"');
const accountModalEnd = html.indexOf('<section class="page hidden" id="craftPage">', accountModalStart);
assert.notEqual(accountModalStart, -1, "account login modal should exist in html");
assert.notEqual(accountModalEnd, -1, "account login modal block should terminate before craft page");
const accountModalHtml = html.slice(accountModalStart, accountModalEnd);

assert.equal(
  accountModalHtml.includes('class="status-box"'),
  false,
  "account login modal should not render the old middle status box"
);

assert.equal(
  accountModalHtml.includes('class="status-title"'),
  false,
  "account login modal should not render the old status title prompt"
);

assert.equal(
  accountModalHtml.includes('class="account-login-brand-mark"'),
  false,
  "account login modal should not render the old brand icon anymore"
);

assert.equal(
  accountModalHtml.includes('id="accountLoginModalClose"'),
  false,
  "account login modal should not render the top-right close button anymore"
);

for (const fieldId of ["accountUsername", "accountPassword", "accountTotp"]) {
  assert.equal(
    new RegExp(`id="${fieldId}"[^>]*placeholder=`, "m").test(accountModalHtml),
    false,
    `account login modal field should not render placeholder text: ${fieldId}`
  );
}

const cssFragments = [
  "body.theme-inkblue #accountPage .account-page-topbar {",
  "body.theme-inkblue #accountPage .account-grid {",
  "body.theme-inkblue #accountPage .account-list-head-actions {",
  ".modal-card.account-login-modal-card {",
  ".account-login-brand {",
  ".account-login-wordmark {",
  "body.theme-inkblue .account-login-modal-card {",
  "body.theme-inkblue .account-login-body {",
  "body.theme-inkblue .account-login-field {",
  "width: min(360px, calc(100vw - 40px));",
  "grid-template-columns: repeat(6, minmax(0, 1fr));",
  "body.theme-inkblue #accountPage .account-card-main {",
  "body.theme-inkblue #accountPage .account-card-side {"
];

for (const fragment of cssFragments) {
  assert.equal(
    css.includes(fragment),
    true,
    `account page css should include fragment: ${fragment}`
  );
}

const appFragments = [
  'accountLoginModal: document.getElementById("accountLoginModal")',
  'accountPageSelect: document.getElementById("accountPageSelect")',
  'accountPageStatusText: document.getElementById("accountPageStatusText")',
  'accountPageAddBtn: document.getElementById("accountPageAddBtn")',
  "const selects = [ui.accountPageSelect, ui.accountSelect, ui.craftAccountSelect].filter(Boolean);",
  "openAccountLoginModal();",
  "closeAccountLoginModal();",
  "ui.accountPageAddBtn.onclick = () => {",
  "ui.accountPageStatusText.onclick = () => {"
];

for (const fragment of appFragments) {
  assert.equal(
    app.includes(fragment),
    true,
    `account page app should include fragment: ${fragment}`
  );
}

assert.equal(
  app.includes('setAccountStatus("请输入新账号信息");'),
  false,
  "opening the account login modal should not inject a default prompt message"
);

console.log("accountPageLayout tests passed");
