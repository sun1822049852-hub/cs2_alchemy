const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "..", "node_sidecar", "ui", "index.html");
const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");

const html = fs.readFileSync(htmlPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");

assert.equal(
  html.includes('<section class="page" id="accountPage">'),
  true,
  "account page scope root should exist in the UI shell"
);

const requiredFragments = [
  "body.theme-inkblue #accountPage {",
  "--account-page-bg:",
  "--account-accent-foreground:",
  "--account-focus-outline:",
  "--account-disabled-text:",
  "body.theme-inkblue .sidebar {",
  "body.theme-inkblue .sidebar-title {",
  "background: linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, rgba(18, 20, 24, 0.92) 100%);",
  "body.theme-inkblue .nav-btn.active {",
  "body.theme-inkblue .workspace {",
  "body.theme-inkblue .page:not(.hidden) {",
  "body.theme-inkblue #accountPage .account-form-panel,",
  "body.theme-inkblue #accountPage #loginSaveBtn {",
  "body.theme-inkblue #accountPage #clearAccountBtn,",
  "body.theme-inkblue #accountPage .account-card.selected {",
  "body.theme-inkblue #accountPage :is(input, button):focus-visible {",
  "body.theme-inkblue #accountPage #savedAccountsWrap {",
  "body.theme-inkblue #accountPage #savedAccountsWrap::-webkit-scrollbar {",
  "body.theme-inkblue #accountPage #savedAccountsWrap::-webkit-scrollbar-thumb {"
];

for (const fragment of requiredFragments) {
  assert.equal(
    css.includes(fragment),
    true,
    `missing account-page style fragment: ${fragment}`
  );
}

console.log("accountPageStyleScope tests passed");
