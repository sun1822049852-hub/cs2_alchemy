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

function extractCssBlock(selector) {
  const start = CSS_SOURCE.indexOf(selector);
  assert.notEqual(start, -1, `missing css selector: ${selector}`);
  const open = CSS_SOURCE.indexOf("{", start);
  assert.notEqual(open, -1, `missing css block start for: ${selector}`);
  const close = CSS_SOURCE.indexOf("}", open);
  assert.notEqual(close, -1, `missing css block end for: ${selector}`);
  return CSS_SOURCE.slice(open + 1, close);
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
  const frameQueue = [];
  const liveFrames = new Map();
  let nextFrameId = 1;
  const context = {
    Math,
    Number,
    String,
    state: {
      craftProgressEnabled: true,
      craftProgressVisible: false,
      craftProgressTitle: "",
      craftProgressDetail: "",
      craftProgressMode: "",
      craftProgressPercent: 0,
      craftProgressPercentTarget: 0
    },
    ui: {
      craftExecutionOverlay: {classList: createClassList()},
      craftExecutionProgress: {
        classList: createClassList(),
        style: {
          values: new Map(),
          setProperty(name, value) {
            this.values.set(String(name), String(value));
          }
        }
      },
      craftExecutionOverlayPercent: {textContent: ""},
      craftExecutionOverlayTitle: {textContent: ""},
      craftExecutionOverlayDetail: {textContent: ""}
    },
    console,
    requestAnimationFrame(callback) {
      const id = nextFrameId++;
      liveFrames.set(id, callback);
      frameQueue.push(id);
      return id;
    },
    cancelAnimationFrame(id) {
      liveFrames.delete(id);
    }
  };
  context.flushAnimationFrames = (count = 1) => {
    for (let i = 0; i < count; i += 1) {
      const id = frameQueue.shift();
      if (!id) break;
      const callback = liveFrames.get(id);
      if (!callback) continue;
      liveFrames.delete(id);
      callback();
    }
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
  assert.equal(app.ui.craftExecutionProgress.classList.contains("hidden"), true);
  assert.equal(app.ui.craftExecutionOverlayTitle.textContent, "正在执行第 1/2 组汰换");
  assert.equal(app.ui.craftExecutionOverlayDetail.textContent, "已完成 0/2 组");

  app.clearCraftExecutionOverlayState();
  assert.equal(app.state.craftProgressEnabled, false);
  assert.equal(app.ui.craftExecutionOverlay.classList.contains("hidden"), true);
}

function testConnectingOverlayShowsPercentRing() {
  const app = loadCraftProgressHelpers();
  app.setCraftExecutionOverlayState({
    visible: true,
    mode: "connecting",
    percent: 80,
    title: "正在连接账号",
    detail: "正在建立连接并刷新库存..."
  });

  assert.equal(app.state.craftProgressMode, "connecting");
  assert.equal(app.state.craftProgressPercentTarget, 80);
  assert.equal(app.state.craftProgressPercent, 0);
  assert.equal(app.ui.craftExecutionOverlay.classList.contains("hidden"), false);
  assert.equal(app.ui.craftExecutionProgress.classList.contains("hidden"), false);
  assert.equal(app.ui.craftExecutionOverlayPercent.textContent, "0%");
  assert.equal(app.ui.craftExecutionOverlayTitle.textContent, "正在连接账号");
  assert.equal(app.ui.craftExecutionOverlayDetail.textContent, "正在建立连接并刷新库存...");

  app.flushAnimationFrames(4);
  const earlyPercent = Number.parseInt(app.ui.craftExecutionOverlayPercent.textContent, 10);
  assert.equal(Number.isFinite(earlyPercent), true);
  assert.equal(earlyPercent > 0 && earlyPercent < 80, true, "connecting percent should animate upward instead of jumping directly to the target");

  app.flushAnimationFrames(4);
  const midPercent = Number.parseInt(app.ui.craftExecutionOverlayPercent.textContent, 10);
  app.flushAnimationFrames(4);
  const laterPercent = Number.parseInt(app.ui.craftExecutionOverlayPercent.textContent, 10);
  const earlyDelta = midPercent - earlyPercent;
  const laterDelta = laterPercent - midPercent;
  assert.equal(laterDelta > earlyDelta, true, "connecting percent should speed up in the later half instead of using the same fast step from the start");

  app.flushAnimationFrames(60);
  assert.equal(app.ui.craftExecutionOverlayPercent.textContent, "80%");
}

function testSourceWiresCenteredOverlayAndSseListener() {
  const overlayBlock = extractCssBlock(".craft-execution-overlay");
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
    HTML_SOURCE.includes('id="craftExecutionProgress"') && HTML_SOURCE.includes('id="craftExecutionOverlayPercent"'),
    true,
    "html should include the centered percentage ring nodes for auto-connect progress"
  );
  assert.equal(
    CSS_SOURCE.includes(".craft-execution-overlay") && CSS_SOURCE.includes("place-items: center"),
    true,
    "css should center the craft execution overlay on screen"
  );
  assert.match(
    overlayBlock,
    /pointer-events:\s*none;/,
    "craft execution overlay should not intercept clicks so pause remains usable"
  );
  assert.doesNotMatch(
    overlayBlock,
    /backdrop-filter\s*:/,
    "craft execution overlay should not blur the screen during component withdraw"
  );
  assert.match(
    overlayBlock,
    /background:\s*transparent;/,
    "craft execution overlay should keep the page visible behind the centered status card"
  );
  assert.match(
    CSS_SOURCE,
    /body\.theme-inkblue\s+\.craft-execution-overlay\s*\{[^}]*background:\s*transparent;/m,
    "inkblue theme should not reintroduce a dark full-screen overlay"
  );
  assert.match(
    CSS_SOURCE,
    /\.craft-execution-progress-ring::after\s*\{[\s\S]*animation:\s*craft-execution-ring-spin/m,
    "connecting overlay should animate only the outer ring layer so the embedded number stays fixed"
  );
  assert.doesNotMatch(
    extractCssBlock(".craft-execution-progress-ring"),
    /animation\s*:/,
    "connecting overlay should keep the ring container itself static so the embedded percent text does not rotate"
  );
  assert.match(
    CSS_SOURCE,
    /\.craft-execution-overlay\.connecting\s+\.craft-execution-card\s*\{[\s\S]*background:\s*transparent;[\s\S]*border:\s*0;[\s\S]*box-shadow:\s*none;/m,
    "connecting overlay should remove the floating card chrome and keep the window fully transparent"
  );
  assert.match(
    CSS_SOURCE,
    /\.craft-execution-overlay\.connecting\s+\.craft-execution-detail\s*\{[\s\S]*display:\s*none;/m,
    "connecting overlay should hide the secondary detail line so only the centered ring and title remain"
  );
}

function main() {
  testProgressHelperFormatsPrepareAndCraftStages();
  testOverlayApplyAndClearBehavior();
  testConnectingOverlayShowsPercentRing();
  testSourceWiresCenteredOverlayAndSseListener();
  console.log("craft-component-progress-overlay tests passed");
}

main();
