const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");
const HTML_PATH = path.resolve(__dirname, "../ui/index.html");
const HTML_SOURCE = fs.readFileSync(HTML_PATH, "utf8");
const CSS_PATH = path.resolve(__dirname, "../ui/styles.css");
const CSS_SOURCE = fs.readFileSync(CSS_PATH, "utf8");

function main() {
  assert.equal(
    HTML_SOURCE.includes('id="craftAssistBusyMask"'),
    true,
    "craft assist panel should include a local busy mask node"
  );
  assert.equal(
    CSS_SOURCE.includes(".craft-assist-busy-mask"),
    true,
    "craft assist busy mask styles should exist"
  );
  assert.equal(
    APP_SOURCE.includes("function renderCraftAssistBusyMask("),
    true,
    "frontend should render a local craft assist busy mask"
  );
  console.log("craft-assist-local-busy-mask tests passed");
}

main();
