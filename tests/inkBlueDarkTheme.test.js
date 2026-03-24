const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "..", "node_sidecar", "ui", "index.html");
const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");

const html = fs.readFileSync(htmlPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");

assert.equal(
  html.includes('<body class="theme-inkblue">'),
  true,
  "ui root should opt into the ink blue dark theme"
);

const cssFragments = [
  "body.theme-inkblue {",
  "--bg: #06101d;",
  "--panel: #0d1726;",
  "body.theme-inkblue .sidebar {",
  "body.theme-inkblue .nav-btn {",
  "body.theme-inkblue .panel,",
  "body.theme-inkblue input,",
  "body.theme-inkblue .group-table th,",
  "body.theme-inkblue .card,",
  "body.theme-inkblue .craft-assist-panel,",
  "body.theme-inkblue .modal-card,"
];

for (const fragment of cssFragments) {
  assert.equal(
    css.includes(fragment),
    true,
    `ink blue dark theme css should include fragment: ${fragment}`
  );
}

console.log("inkBlueDarkTheme tests passed");
