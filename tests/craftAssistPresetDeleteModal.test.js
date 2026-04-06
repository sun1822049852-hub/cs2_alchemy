const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const source = fs.readFileSync(appPath, "utf8");

assert.match(
  source,
  /openConfirmModal\(\{[\s\S]*title:\s*"确认删除配置"[\s\S]*message:\s*`确定要删除配置【\$\{String\(preset && preset\.name \|\| ""\)\.trim\(\) \|\| "该配置"\}】吗？`[\s\S]*confirmText:\s*"确认删除"[\s\S]*cancelText:\s*"取消"[\s\S]*\}\)/m,
  "craft assist preset deletion should use the in-app confirmation modal with the approved delete copy"
);

assert.doesNotMatch(
  source,
  /确认删除配置【\$\{String\(preset && preset\.name \|\| ""\)\.trim\(\)\}】/,
  "craft assist preset deletion should stop using the browser-native confirm dialog copy"
);

console.log("craftAssistPresetDeleteModal tests passed");
