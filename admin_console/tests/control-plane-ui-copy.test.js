const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const INDEX_SOURCE = fs.readFileSync(path.resolve(__dirname, "../ui/index.html"), "utf8");
const APP_SOURCE = fs.readFileSync(path.resolve(__dirname, "../ui/app.js"), "utf8");

function test_admin_console_exposes_the_four_work_areas() {
  ["用户管理", "激活码管理", "充值商品", "订单管理"].forEach((label) => {
    assert.equal(INDEX_SOURCE.includes(label), true, `控制台应提供“${label}”工作区`);
  });
  ["usersView", "activationCodesView", "productsView", "ordersView"].forEach((id) => {
    assert.equal(INDEX_SOURCE.includes(`id="${id}"`), true, `控制台应提供 ${id} 页面容器`);
  });
}

function test_user_management_exposes_creation_bulk_grant_and_account_actions() {
  [
    "createUserForm",
    "bulkGrantForm",
    "resetPasswordForm",
    "generatePasswordButton",
    "archiveUserButton",
    "restoreUserButton"
  ].forEach((id) => {
    assert.equal(INDEX_SOURCE.includes(`id="${id}"`), true, `用户管理应提供 ${id}`);
  });
  assert.equal(APP_SOURCE.includes("/api/admin/users/bulk-grant"), true);
  assert.equal(APP_SOURCE.includes("/reset-password"), true);
  assert.equal(APP_SOURCE.includes("/restore"), true);
}

function test_membership_copy_matches_inactive_and_member_model() {
  assert.equal(APP_SOURCE.includes("Inactive：可使用除真实炼金外的全部当前功能。"), true);
  assert.equal(APP_SOURCE.includes("Member：拥有全部当前功能，包括真实炼金。"), true);
  assert.equal(APP_SOURCE.includes("Trial："), false, "控制台不得继续展示 trial 计划说明");
  assert.equal(APP_SOURCE.includes("standard"), false, "控制台不得继续展示 standard 计划");
}

function test_business_workspaces_expose_complete_empty_and_action_states() {
  [
    "/api/admin/activation-codes",
    "/api/admin/products",
    "/api/admin/orders"
  ].forEach((route) => assert.equal(APP_SOURCE.includes(route), true, `缺少接口 ${route}`));
  ["当前没有激活码", "当前没有充值商品", "当前没有订单"].forEach((copy) => {
    assert.equal(APP_SOURCE.includes(copy), true, `缺少空状态：${copy}`);
  });
  assert.equal(INDEX_SOURCE.includes("activationResult"), true, "生成结果应有一次性展示区");
  assert.equal(INDEX_SOURCE.includes("导出激活码"), true, "生成结果应允许导出");
}

function main() {
  test_admin_console_exposes_the_four_work_areas();
  test_user_management_exposes_creation_bulk_grant_and_account_actions();
  test_membership_copy_matches_inactive_and_member_model();
  test_business_workspaces_expose_complete_empty_and_action_states();
  console.log("control-plane-ui-copy tests passed");
}

main();
