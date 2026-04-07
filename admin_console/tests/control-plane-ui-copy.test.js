const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function test_free_plan_copy_explains_baseline_access_without_real_craft() {
  assert.equal(
    APP_SOURCE.includes("默认开放账号、库存、刷新与汰换模拟；真实炼金执行需单独授权。"),
    true,
    "free/default 文案应明确说明非 craft 功能默认开放，真实炼金需单独授权"
  );
}

function test_paid_plan_copy_explains_permissions_can_be_overridden() {
  assert.equal(
    APP_SOURCE.includes("当前计划：${user.membership_plan}，可按需覆盖单项权限。"),
    true,
    "非 free 计划文案应明确说明仍可按用户覆盖权限"
  );
}

function main() {
  test_free_plan_copy_explains_baseline_access_without_real_craft();
  test_paid_plan_copy_explains_permissions_can_be_overridden();
  console.log("control-plane-ui-copy tests passed");
}

main();
