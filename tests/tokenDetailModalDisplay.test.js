const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../node_sidecar/ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

function loadTokenDetailHelpers() {
  const source = extractBlock("function parseTokenDetailSteamData(", "async function openTokenDetailModal(");
  const context = {JSON, String};
  vm.runInNewContext(`${source}\nthis.parseTokenDetailSteamData = parseTokenDetailSteamData;\nthis.extractSharedSecretFromTokenDetailData = extractSharedSecretFromTokenDetailData;`, context, {filename: APP_PATH});
  return {
    parseTokenDetailSteamData: context.parseTokenDetailSteamData,
    extractSharedSecretFromTokenDetailData: context.extractSharedSecretFromTokenDetailData
  };
}

function test_extract_shared_secret_from_multiple_token_payload_shapes() {
  const {extractSharedSecretFromTokenDetailData} = loadTokenDetailHelpers();
  assert.equal(extractSharedSecretFromTokenDetailData({shared_secret: "flat_secret"}), "flat_secret");
  assert.equal(extractSharedSecretFromTokenDetailData({response: {shared_secret: "wrapped_secret"}}), "wrapped_secret");
  assert.equal(extractSharedSecretFromTokenDetailData({SharedSecret: "pascal_secret"}), "pascal_secret");
  assert.equal(extractSharedSecretFromTokenDetailData({Response: {SharedSecret: "pascal_wrapped_secret"}}), "pascal_wrapped_secret");
  assert.equal(extractSharedSecretFromTokenDetailData({shared_secret: "[REDACTED]"}), "");
}

function test_parse_token_detail_steam_data_accepts_json_string() {
  const {parseTokenDetailSteamData} = loadTokenDetailHelpers();
  const parsed = parseTokenDetailSteamData("{\"response\":{\"shared_secret\":\"abc\"}}");
  assert.equal(parsed.response.shared_secret, "abc");
}

function test_open_token_detail_modal_uses_server_current_totp_before_local_recompute() {
  const source = extractBlock("async function openTokenDetailModal(username) {", "function initTokenDetailModal()");
  assert.match(
    source,
    /codeEl\.textContent\s*=\s*data\.currentTotp\s*\|\|\s*"-----"/,
    "token detail modal should render server-provided currentTotp before attempting local recompute"
  );
  assert.doesNotMatch(
    source,
    /await\s+resp\.json\(\)/,
    "token detail modal must not call .json() on the parsed api() result"
  );
}

function main() {
  test_extract_shared_secret_from_multiple_token_payload_shapes();
  test_parse_token_detail_steam_data_accepts_json_string();
  test_open_token_detail_modal_uses_server_current_totp_before_local_recompute();
  console.log("tokenDetailModalDisplay tests passed");
}

main();
