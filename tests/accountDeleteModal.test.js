const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const source = fs.readFileSync(appPath, "utf8");

assert.match(
  source,
  /const ok = await openConfirmModal\(\{[\s\S]*title:\s*"确认删除账号"[\s\S]*message:\s*`确认删除账号“\$\{row\.remark \|\| row\.username\}（\$\{row\.username\}）”\？\\n该操作只会移除本地保存的密码与账号记录，不会释放会员绑定资格。`[\s\S]*confirmText:\s*"确认删除"[\s\S]*cancelText:\s*"取消"[\s\S]*\}\);/m,
  "account deletion should explain that local deletion does not release remote Steam binding eligibility"
);

assert.doesNotMatch(
  source,
  /const ok = window\.confirm\(`确认删除账号“\$\{row\.remark \|\| row\.username\}（\$\{row\.username\}）”\？\\n该操作只会移除本地保存的密码与账号记录，不会释放会员绑定资格。`\);/m,
  "account deletion should stop using the browser-native confirm dialog"
);

console.log("accountDeleteModal tests passed");
