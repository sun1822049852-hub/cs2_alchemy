const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const HTML_PATH = path.resolve(__dirname, "../ui/index.html");
const HTML_SOURCE = fs.readFileSync(HTML_PATH, "utf8");
const CSS_PATH = path.resolve(__dirname, "../ui/styles.css");
const CSS_SOURCE = fs.readFileSync(CSS_PATH, "utf8");

function main() {
  assert.match(
    HTML_SOURCE,
    /id="craftSelectionList"[\s\S]*id="craftAssistBusyMask"[\s\S]*id="craftAssistOverlay"/m,
    "craft assist busy mask should live on the left panel layer so it can cover the manual inventory area too"
  );
  assert.match(
    CSS_SOURCE,
    /#craftLeftPanel\s*>\s*\.craft-assist-busy-mask\s*\{[\s\S]*position:\s*absolute;[\s\S]*inset:\s*0;[\s\S]*backdrop-filter:\s*blur\(6px\);/m,
    "left-panel craft assist busy mask should span the whole left half with a blur overlay"
  );
  assert.match(
    CSS_SOURCE,
    /body\.theme-inkblue #craftLeftPanel\s*>\s*\.craft-assist-busy-mask\s*\{[^}]*background:\s*rgba\(12,\s*14,\s*18,\s*0\.78\);/m,
    "inkblue theme should keep the left-panel busy mask covering the left half"
  );
  assert.match(
    CSS_SOURCE,
    /#craftLeftPanel\s*>\s*\.craft-assist-busy-mask\.hidden\s*\{[^}]*display:\s*none;/m,
    "left-panel busy mask hidden state must override the left-panel display rule so stale blur does not stay visible"
  );
  assert.doesNotMatch(
    CSS_SOURCE,
    /\.craft-assist-overlay\s*\{[^}]*backdrop-filter:\s*blur\(/m,
    "normal craft assist overlay should not stay blurred; only the busy mask may blur the left half"
  );
  console.log("craft-assist-left-busy-mask tests passed");
}

main();
