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
  'id="navShell"',
  'id="navRailTrigger"',
  'class="nav-rail-trigger"',
  'class="nav-rail-arrow"',
  'id="mainSidebar"'
];

for (const fragment of htmlFragments) {
  assert.equal(
    html.includes(fragment),
    true,
    `nav hover drawer html should include fragment: ${fragment}`
  );
}

const appFragments = [
  "navDrawerOpen: false",
  'navShell: document.getElementById("navShell")',
  'navRailTrigger: document.getElementById("navRailTrigger")',
  "function setNavDrawerOpen(open) {",
  'ui.navShell.classList.toggle("nav-open", !!state.navDrawerOpen);',
  'ui.navRailTrigger.setAttribute("aria-expanded", state.navDrawerOpen ? "true" : "false");',
  'if (ui.navShell && ui.navShell.contains(document.activeElement) && typeof document.activeElement.blur === "function") {',
  "document.activeElement.blur();",
  'ui.navShell.addEventListener("mouseenter", () => {',
  'ui.navShell.addEventListener("mouseleave", () => {',
  'if (state.navDrawerOpen && ui.navShell.contains(document.activeElement)) return;',
  'ui.navRailTrigger.onclick = (evt) => {',
  'if (pageId === "craftPage") {',
  "setNavDrawerOpen(false);"
];

for (const fragment of appFragments) {
  assert.equal(
    app.includes(fragment),
    true,
    `nav hover drawer app should include fragment: ${fragment}`
  );
}

const cssFragments = [
  ".nav-shell {",
  ".nav-shell.nav-open .sidebar {",
  ".nav-rail-trigger {",
  ".nav-rail-arrow {",
  ".nav-shell:hover .sidebar {",
  ".nav-shell:focus-within .sidebar {",
  "clip-path: polygon(",
  "body.theme-inkblue .nav-rail-trigger {",
  "body.theme-inkblue .nav-rail-trigger:hover {"
];

for (const fragment of cssFragments) {
  assert.equal(
    css.includes(fragment),
    true,
    `nav hover drawer css should include fragment: ${fragment}`
  );
}

assert.match(
  css,
  /\.sidebar\s*\{[\s\S]*position:\s*absolute;[\s\S]*transform:\s*translateX\(calc\(-100%\s*-\s*14px\)\);/m,
  "sidebar should slide fully off screen when collapsed instead of leaving rounded corners visible"
);

assert.match(
  css,
  /\.nav-rail-trigger\s*\{[\s\S]*position:\s*absolute;[\s\S]*left:\s*0;[\s\S]*top:\s*50%;[\s\S]*clip-path:\s*polygon\(/m,
  "nav drawer trigger should be anchored to the left edge as a trapezoid hover rail"
);

assert.match(
  css,
  /\.nav-shell\s*\{[\s\S]*width:\s*34px;/m,
  "collapsed nav shell should only keep a narrow hover rail active"
);

assert.match(
  css,
  /\.nav-shell\.nav-open,\s*\.nav-shell:hover,\s*\.nav-shell:focus-within\s*\{[\s\S]*width:\s*244px;/m,
  "expanded nav shell should grow only when the drawer is active so mouseleave can collapse it quickly"
);

console.log("navHoverDrawerUi tests passed");
