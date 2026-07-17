const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.resolve(__dirname, "../ui/index.html"), "utf8");
const app = fs.readFileSync(path.resolve(__dirname, "../ui/app.js"), "utf8");

function test_coexist_modal_exposes_both_account_modes_and_new_steps() {
  assert.match(html, /选择已有账号/);
  assert.match(html, /只添加令牌/);
  assert.match(html, /邮箱验证码/);
  assert.match(html, /在 Steam App 中完成绑定/);
  assert.match(html, /五位动态码/);
  assert.match(html, /不会移除、替换或接管现有令牌/);
  assert.match(html, /导出 maFile/);
  assert.match(html, /查看令牌码/);
  assert.match(html, /查看恢复码/);
}

function test_ui_uses_only_new_coexist_routes() {
  assert.match(app, /\/api\/accounts\/steam-guard\/coexist\/start/);
  assert.match(app, /\/api\/accounts\/steam-guard\/coexist\/submit-email-code/);
  assert.match(app, /\/api\/accounts\/steam-guard\/coexist\/verify-app-code/);
  assert.match(app, /\/api\/accounts\/steam-guard\/coexist\/cancel/);
  assert.match(app, /\/api\/accounts\/steam-guard\/code/);
  assert.match(app, /\/api\/accounts\/steam-guard\/recovery-code/);
  assert.match(app, /\/api\/accounts\/steam-guard\/export/);
  assert.doesNotMatch(app, /\/api\/accounts\/enroll-steam-guard/);
  assert.doesNotMatch(app, /\/api\/accounts\/finalize-steam-guard/);
  assert.doesNotMatch(app, /\/api\/accounts\/token-detail/);
}

function test_frontend_never_receives_or_computes_shared_secret() {
  assert.doesNotMatch(app, /encryptedSecret|secretKeyHex|ivHex/);
  assert.doesNotMatch(app, /computeSteamTotp|extractSharedSecretFromTokenDetailData/);
  assert.doesNotMatch(app, /row\.password|account\.password|row\.mafile_content|account\.mafile_content/);
  assert.match(app, /has_steam_guard/);
  assert.match(app, /has_refresh_token/);
  assert.match(app, /正在重新连接/);
  assert.match(app, /needs_attention/);
}

function main() {
  test_coexist_modal_exposes_both_account_modes_and_new_steps();
  test_ui_uses_only_new_coexist_routes();
  test_frontend_never_receives_or_computes_shared_secret();
  console.log("steam-guard-ui-contract tests passed");
}

main();
