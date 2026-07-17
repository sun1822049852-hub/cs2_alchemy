const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const HTML_PATH = path.resolve(__dirname, "../ui/index.html");
const HTML_SOURCE = fs.readFileSync(HTML_PATH, "utf8");
const CSS_PATH = path.resolve(__dirname, "../ui/styles.css");
const CSS_SOURCE = fs.readFileSync(CSS_PATH, "utf8");
const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function main() {
  assert.match(
    HTML_SOURCE,
    /<div id="craftPredictorStage"[^>]*>[\s\S]*<section id="craftPredictorPanel"[\s\S]*id="craftPredictorDrawer"[\s\S]*<\/section>\s*<button id="craftPredictorHandle"/m,
    "global predictor stage should own the panel and its sibling handle"
  );
  assert.match(
    CSS_SOURCE,
    /\.craft-predictor-stage\s*\{[^}]*position:\s*fixed;[^}]*right:\s*0;[^}]*bottom:\s*0;[^}]*width:\s*404px;[^}]*height:\s*50vh;[^}]*pointer-events:\s*none;/m,
    "global predictor stage should own the fixed viewport geometry"
  );
  assert.match(
    CSS_SOURCE,
    /\.craft-predictor-stage\s*>\s*\.craft-predictor-handle\s*\{[^}]*right:\s*0;[^}]*top:\s*50%;[^}]*width:\s*24px;[^}]*height:\s*156px;[^}]*pointer-events:\s*auto;/m,
    "predictor handle should use fixed geometry and remain interactive inside the global stage"
  );
  assert.match(
    CSS_SOURCE,
    /body\.theme-inkblue \.craft-predictor-handle\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*rgba\(36,\s*31,\s*23,\s*0\.96\)\s*0%,\s*rgba\(14,\s*16,\s*20,\s*0\.98\)\s*100%\);[^}]*color:\s*#f3c779;/m,
    "global predictor handle should retain the dark tab styling in inkblue theme"
  );
  assert.match(
    CSS_SOURCE,
    /\.craft-predictor-drawer\s*\{[\s\S]*padding:\s*16px 14px 18px 14px;/m,
    "predictor drawer should not keep extra right padding after the tab leaves the slot area"
  );
  assert.match(
    CSS_SOURCE,
    /\.craft-predictor-stage\s*>\s*\.craft-predictor-handle:active\s*\{[^}]*transform:\s*translateY\(-50%\);/m,
    "predictor handle active state must stay still when clicked"
  );
  assert.match(
    CSS_SOURCE,
    /\.craft-predictor-stage\s*>\s*\.craft-predictor-handle\[aria-expanded="true"\]\s+\.craft-predictor-handle-arrow\s*\{[^}]*transform:\s*rotate\(45deg\)\s*translateX\(-1px\);/m,
    "predictor handle arrow should still flip after the tab moves to the panel edge"
  );
  const geometryFunction = APP_SOURCE.match(/function updateCraftPredictorHandleGeometry\(\)\s*\{[^}]*\}/m);
  assert.ok(geometryFunction, "predictor geometry compatibility function should remain available");
  assert.doesNotMatch(
    geometryFunction[0],
    /--craft-predictor-handle-(?:top|height|width)/,
    "fixed global stage should not write legacy dynamic geometry variables"
  );
  assert.match(
    APP_SOURCE,
    /function renderCraftPredictorPanel\(\)\s*\{[\s\S]*closest\("\.craft-predictor-stage"\)[\s\S]*stage\.classList\.toggle\("collapsed",\s*!open\)[\s\S]*updateCraftPredictorHandleGeometry\(\);[\s\S]*\}/m,
    "predictor render should keep the global stage collapsed state synchronized"
  );
  assert.match(
    APP_SOURCE,
    /window\.addEventListener\("resize",\s*\(\)\s*=>\s*\{[\s\S]*updateCraftPredictorHandleGeometry\(\);[\s\S]*\}\);/m,
    "predictor handle geometry should refresh on window resize"
  );
  console.log("craft-predictor-handle-layout tests passed");
}

main();
