const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");
const HTML_PATH = path.resolve(__dirname, "../ui/index.html");
const HTML_SOURCE = fs.readFileSync(HTML_PATH, "utf8");
const CSS_PATH = path.resolve(__dirname, "../ui/styles.css");
const CSS_SOURCE = fs.readFileSync(CSS_PATH, "utf8");

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

function createClassList() {
  const values = new Set(["hidden"]);
  return {
    add(name) {
      values.add(String(name));
    },
    remove(name) {
      values.delete(String(name));
    },
    toggle(name, force) {
      const key = String(name);
      if (force === undefined) {
        if (values.has(key)) values.delete(key);
        else values.add(key);
        return values.has(key);
      }
      if (force) values.add(key);
      else values.delete(key);
      return !!force;
    },
    contains(name) {
      return values.has(String(name));
    }
  };
}

function loadCraftProgressHelpers() {
  const source = extractBlock("function buildCraftComponentProgressDisplay(", "function syncCraftSettingsControls(");
  const context = {
    Math,
    Number,
    String,
    state: {
      craftProgressEnabled: true,
      craftProgressVisible: false,
      craftProgressTitle: "",
      craftProgressDetail: ""
    },
    ui: {
      craftExecutionOverlay: {classList: createClassList()},
      craftExecutionOverlayTitle: {textContent: ""},
      craftExecutionOverlayDetail: {textContent: ""}
    },
    console
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function testProgressHelperFormatsPrepareAndCraftStages() {
  const app = loadCraftProgressHelpers();
  const prepare = app.buildCraftComponentProgressDisplay({
    stage: "prepare",
    phase: "item",
    processed: 3,
    total: 5,
    success: 3,
    failed: 0
  });
  assert.equal(prepare.title, "正在从组件中取出物品 3/5");
  assert.equal(prepare.detail, "成功 3，失败 0");

  const craft = app.buildCraftComponentProgressDisplay({
    stage: "craft",
    phase: "start",
    index: 2,
    total: 4,
    completed: 1
  });
  assert.equal(craft.title, "正在执行第 2/4 组汰换");
  assert.equal(craft.detail, "已完成 1/4 组");
}

function testOverlayApplyAndClearBehavior() {
  const app = loadCraftProgressHelpers();
  app.applyCraftComponentProgressEvent({
    stage: "craft",
    phase: "start",
    index: 1,
    total: 2,
    completed: 0
  });

  assert.equal(app.state.craftProgressVisible, true);
  assert.equal(app.ui.craftExecutionOverlay.classList.contains("hidden"), false);
  assert.equal(app.ui.craftExecutionOverlayTitle.textContent, "正在执行第 1/2 组汰换");
  assert.equal(app.ui.craftExecutionOverlayDetail.textContent, "已完成 0/2 组");

  app.clearCraftExecutionOverlayState();
  assert.equal(app.state.craftProgressEnabled, false);
  assert.equal(app.ui.craftExecutionOverlay.classList.contains("hidden"), true);
}

function testSourceWiresCenteredOverlayAndSseListener() {
  assert.equal(
    APP_SOURCE.includes('stream.addEventListener("craft_component_progress", (evt) => {'),
    true,
    "frontend should listen for backend craft component progress SSE"
  );
  assert.equal(
    HTML_SOURCE.includes('id="craftExecutionOverlay"'),
    true,
    "html should include centered craft execution overlay root"
  );
  assert.equal(
    CSS_SOURCE.includes(".craft-execution-overlay") && CSS_SOURCE.includes("place-items: center"),
    true,
    "css should center the craft execution overlay on screen"
  );
}

function main() {
  testProgressHelperFormatsPrepareAndCraftStages();
  testOverlayApplyAndClearBehavior();
  testSourceWiresCenteredOverlayAndSseListener();
  console.log("craft-component-progress-overlay tests passed");
}

main();
