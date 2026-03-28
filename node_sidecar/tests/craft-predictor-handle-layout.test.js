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
    /id="craftPredictorStage"[\s\S]*id="craftPredictorPanel"[\s\S]*id="craftPredictorDrawer"[\s\S]*id="craftExecuteQueueBtn"[\s\S]*<button id="craftPredictorHandle"/m,
    "predictor handle should sit outside the predictor stage so it can attach to the whole right panel edge"
  );
  assert.match(
    CSS_SOURCE,
    /\.craft-right-panel\s*\{[\s\S]*position:\s*relative;[\s\S]*--craft-predictor-handle-top:\s*50%;[\s\S]*--craft-predictor-handle-height:\s*156px;[\s\S]*--craft-predictor-handle-width:\s*24px;/m,
    "craft right panel should own the predictor handle geometry variables"
  );
  assert.match(
    CSS_SOURCE,
    /\.craft-right-panel\s*>\s*\.craft-predictor-handle\s*\{[\s\S]*right:\s*0;[\s\S]*top:\s*var\(--craft-predictor-handle-top\);[\s\S]*width:\s*var\(--craft-predictor-handle-width\);[\s\S]*height:\s*var\(--craft-predictor-handle-height\);[\s\S]*clip-path:\s*polygon\(0 12%,\s*100% 0,\s*100% 100%,\s*0 88%\);/m,
    "predictor handle should mirror the left rail tab shape and derive its top/width/height from live geometry vars"
  );
  assert.match(
    CSS_SOURCE,
    /body\.theme-inkblue #craftPage \.craft-predictor-handle\s*\{[\s\S]*background:\s*linear-gradient\(180deg,\s*rgba\(36,\s*31,\s*23,\s*0\.96\)\s*0%,\s*rgba\(14,\s*16,\s*20,\s*0\.98\)\s*100%\);[\s\S]*color:\s*#f3c779;/m,
    "predictor handle should reuse the left rail's dark tab styling in inkblue theme"
  );
  assert.match(
    CSS_SOURCE,
    /\.craft-predictor-drawer\s*\{[\s\S]*padding:\s*16px 14px 18px 14px;/m,
    "predictor drawer should not keep extra right padding after the tab leaves the slot area"
  );
  assert.match(
    CSS_SOURCE,
    /\.craft-right-panel\s*>\s*\.craft-predictor-handle:active\s*\{[^}]*transform:\s*translateY\(-50%\);/m,
    "predictor handle active state must stay still when clicked"
  );
  assert.match(
    CSS_SOURCE,
    /\.craft-right-panel\s*>\s*\.craft-predictor-handle\[aria-expanded="true"\]\s+\.craft-predictor-handle-arrow\s*\{[^}]*transform:\s*rotate\(45deg\)\s*translateX\(-1px\);/m,
    "predictor handle arrow should still flip after the tab moves to the panel edge"
  );
  assert.match(
    APP_SOURCE,
    /function updateCraftPredictorHandleGeometry\(\)\s*\{[\s\S]*--craft-predictor-handle-top[\s\S]*--craft-predictor-handle-height[\s\S]*--craft-predictor-handle-width[\s\S]*\}/m,
    "predictor handle geometry should be computed from the predictor card center and the outer edge gap"
  );
  assert.match(
    APP_SOURCE,
    /function renderCraftPredictorPanel\(\)\s*\{[\s\S]*updateCraftPredictorHandleGeometry\(\);[\s\S]*\}/m,
    "predictor handle geometry should refresh whenever the predictor panel re-renders"
  );
  assert.match(
    APP_SOURCE,
    /window\.addEventListener\("resize",\s*\(\)\s*=>\s*\{[\s\S]*updateCraftPredictorHandleGeometry\(\);[\s\S]*\}\);/m,
    "predictor handle geometry should refresh on window resize"
  );
  console.log("craft-predictor-handle-layout tests passed");
}

main();
