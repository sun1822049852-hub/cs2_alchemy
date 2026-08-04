const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.resolve(__dirname, "../ui/index.html"), "utf8");
const app = fs.readFileSync(path.resolve(__dirname, "../ui/app.js"), "utf8");
const styles = fs.readFileSync(path.resolve(__dirname, "../ui/styles.css"), "utf8");

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
  assert.match(html, /删除令牌文件/);
}

function test_ui_uses_only_new_coexist_routes() {
  assert.match(app, /\/api\/accounts\/steam-guard\/coexist\/start/);
  assert.match(app, /\/api\/accounts\/steam-guard\/coexist\/submit-email-code/);
  assert.match(app, /\/api\/accounts\/steam-guard\/coexist\/verify-app-code/);
  assert.match(app, /\/api\/accounts\/steam-guard\/coexist\/cancel/);
  assert.match(app, /\/api\/accounts\/steam-guard\/code/);
  assert.match(app, /\/api\/accounts\/steam-guard\/recover-login/);
  assert.match(app, /\/api\/accounts\/steam-guard\/recovery-code/);
  assert.match(app, /\/api\/accounts\/steam-guard\/export/);
  assert.match(app, /\/api\/accounts\/steam-guard["'`]/);
  assert.match(app, /method:\s*["']DELETE["']/);
  assert.match(app, /仅删除本地令牌文件/);
  assert.match(app, /不会解除 Steam App 中的令牌/);
  assert.doesNotMatch(app, /\/api\/accounts\/enroll-steam-guard/);
  assert.doesNotMatch(app, /\/api\/accounts\/finalize-steam-guard/);
  assert.doesNotMatch(app, /\/api\/accounts\/token-detail/);
}

function test_frontend_uses_saved_password_but_keeps_local_guard_submission_on_backend() {
  assert.doesNotMatch(app, /encryptedSecret|secretKeyHex|ivHex/);
  assert.doesNotMatch(app, /computeSteamTotp|extractSharedSecretFromTokenDetailData/);
  assert.doesNotMatch(app, /function fetchLocalSteamGuardCode/);
  assert.doesNotMatch(app, /row\.mafile_content|account\.mafile_content/);
  assert.match(app, /account\.password/);
  assert.match(app, /ui\.accountLoginHint\.textContent = reloginMode \? ""/);
  assert.match(app, /ui\.accountLoginHint\.classList\.toggle\("hidden", reloginMode\)/);
  assert.match(html, /id="accountGuardField"[^>]*hidden/);
  assert.match(app, /has_steam_guard/);
  assert.match(app, /has_refresh_token/);
  assert.match(app, /正在重新连接/);
  assert.match(app, /needs_attention/);
  assert.match(app, /password_reentry_required/);
  const verifyBlock = app.slice(
    app.indexOf('api("/api/accounts/steam-guard/coexist/verify-app-code"'),
    app.indexOf("// ═══ Steam Guard 令牌管理 ═══")
  );
  assert.match(verifyBlock, /recoverExpiredAccountWithLocalGuard\(/);
}

function test_delete_confirmation_renders_above_token_management_modal() {
  assert.match(styles, /#confirmModal\s*\{[^}]*z-index:\s*9\d{3,}/s);
}

function test_delete_success_is_not_relabelled_when_account_refresh_fails() {
  assert.match(app, /function refreshAccountsAfterLocalGuardDeletion\(/);
  assert.match(app, /本地令牌文件已删除，但账号列表刷新失败/);
  const source = app.slice(
    app.indexOf("async function deleteLocalSteamGuardFile("),
    app.indexOf("function initTokenDetailModal(")
  );
  assert.match(source, /await refreshAccountsAfterLocalGuardDeletion\(username\)/);
}

function test_all_verification_codes_share_five_slot_uppercase_alphanumeric_ui() {
  for (const id of ["accountTotp", "coexistEmailCode", "coexistAppCode"]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*maxlength="5"`));
    assert.match(html, new RegExp(`id="${id}"[^>]*pattern="\\[A-Z0-9\\]\\{5\\}"`));
  }
  assert.equal((html.match(/class="steam-verification-code-input"/g) || []).length, 3);
  assert.equal((html.match(/class="steam-verification-code-slot"/g) || []).length, 15);
  assert.match(styles, /\.steam-verification-code-slots/);
  assert.match(styles, /\.steam-verification-code-slot[^}]*border-bottom/s);
  assert.match(styles, /\.steam-verification-code-label[^}]*text-align:\s*center/s);
  assert.match(app, /function normalizeSteamVerificationCode\(/);
  assert.match(app, /function initSteamVerificationCodeInput\(/);
  assert.match(app, /coexistEmailCode/);
  assert.match(app, /coexistAppCode/);
}

function test_retryable_coexist_code_errors_do_not_claim_expiry_or_attempt_limits() {
  assert.match(app, /invalid_email_code/);
  assert.doesNotMatch(app, /app_code_attempts_exceeded/);
  assert.doesNotMatch(app, /还可尝试/);
  assert.doesNotMatch(app, /本次绑定已超时或结束/);
}

function test_token_management_exposes_capability_scoped_controls() {
  assert.match(html, /id="tokenCapabilityLabel"/);
  assert.match(app, /steam_guard_type/);
  assert.match(app, /steam_guard_capabilities/);
  assert.match(app, /tokenShowRecoveryBtn/);
  assert.match(app, /steamGuardType === "full" \? "完整令牌" : "令牌不可用"/);
}

function main() {
  test_coexist_modal_exposes_both_account_modes_and_new_steps();
  test_ui_uses_only_new_coexist_routes();
  test_frontend_uses_saved_password_but_keeps_local_guard_submission_on_backend();
  test_delete_confirmation_renders_above_token_management_modal();
  test_delete_success_is_not_relabelled_when_account_refresh_fails();
  test_all_verification_codes_share_five_slot_uppercase_alphanumeric_ui();
  test_retryable_coexist_code_errors_do_not_claim_expiry_or_attempt_limits();
  test_token_management_exposes_capability_scoped_controls();
  console.log("steam-guard-ui-contract tests passed");
}

main();
