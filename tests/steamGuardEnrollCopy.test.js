const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const HTML_PATH = path.resolve(__dirname, "../node_sidecar/ui/index.html");
const APP_PATH = path.resolve(__dirname, "../node_sidecar/ui/app.js");
const HTML = fs.readFileSync(HTML_PATH, "utf8");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function extractBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return source.slice(start, end);
}

function test_warning_copy_describes_backend_mode_decision() {
  assert.match(HTML, /系统会在验证后判断是首次绑定还是替换旧令牌/);
  assert.doesNotMatch(HTML, /可直接替换原有令牌/);
}

function test_enroll_frontend_tracks_backend_mode_and_replace_copy() {
  const enrollStateSource = extractBlock(APP_SOURCE, "let enrollState =", "function initSteamGuardEnroll(");
  const enrollActionSource = extractBlock(APP_SOURCE, "async function handleEnrollAction()", "// ═══ Steam Guard 令牌详情 ═══");

  assert.match(enrollStateSource, /mode\s*:/);
  assert.match(enrollActionSource, /data\.mode/);
  assert.match(enrollActionSource, /旧令牌替换验证已开始/);
  assert.match(enrollActionSource, /旧令牌已替换为新令牌/);
  assert.doesNotMatch(
    enrollActionSource,
    /await\s+resp\.json\(\)/,
    "Steam Guard enroll/finalize flow must not call .json() on the parsed api() result"
  );
}

function main() {
  test_warning_copy_describes_backend_mode_decision();
  test_enroll_frontend_tracks_backend_mode_and_replace_copy();
  console.log("steamGuardEnrollCopy tests passed");
}

main();
