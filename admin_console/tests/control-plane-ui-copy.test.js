const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function test_trial_and_inactive_copy_explain_membership_lifecycle() {
  assert.equal(
    APP_SOURCE.includes("Trial：新注册用户默认获得 7 天普通版权限，期间允许炼金。"),
    true,
    "trial 文案应明确说明新注册用户默认获得 7 天体验期且体验期内允许炼金"
  );
  assert.equal(
    APP_SOURCE.includes("Inactive：体验到期或未开通，不能炼金，但保留既有 Steam 绑定资格。"),
    true,
    "inactive 文案应明确说明到期后不能炼金且不会释放已占用的 Steam 绑定资格"
  );
}

function main() {
  test_trial_and_inactive_copy_explain_membership_lifecycle();
  console.log("control-plane-ui-copy tests passed");
}

main();
