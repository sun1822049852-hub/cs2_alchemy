const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const app = fs.readFileSync(appPath, "utf8");

const forbiddenFragments = [
  "当前未连接，正在自动连接并刷新库存校对物品...",
  "已自动连接并刷新库存校对，继续执行组件存入",
  "已自动连接并刷新库存校对，继续执行组件取出"
];

for (const fragment of forbiddenFragments) {
  assert.equal(
    app.includes(fragment),
    false,
    `component auto-connect flow should stay silent for auto-connect hint: ${fragment}`
  );
}

console.log("componentAutoConnectNoReconcileError tests passed");
