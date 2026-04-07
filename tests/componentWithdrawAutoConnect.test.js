const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const app = fs.readFileSync(appPath, "utf8");

const fragments = [
  "async function ensureConnectedForComponentWithdraw() {",
  "const withdrawBlocked = busy;",
  "ui.componentWithdrawBtn.title = \"未连接时将在取出前自动连接并刷新库存\";",
  "const connected = await ensureConnectedForComponentWithdraw();",
  "const componentStillExists = listComponentChoices().some((choice) => String(choice && choice.id || \"\").trim() === currentComponentId);"
];

for (const fragment of fragments) {
  assert.equal(
    app.includes(fragment),
    true,
    `component withdraw auto-connect should include fragment: ${fragment}`
  );
}

console.log("componentWithdrawAutoConnect tests passed");
