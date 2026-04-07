const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const app = fs.readFileSync(appPath, "utf8");

const fragments = [
  "async function ensureConnectedForComponentDeposit() {",
  "const keepSelectedIds = new Set(state.selectedComponentItemIds);",
  "keepSelectedIds,",
  "const connected = await ensureConnectedForComponentDeposit();",
  "const targetExists = listComponentChoices({excludeId: selectedComponentId()}).some((choice) => String(choice && choice.id || \"\").trim() === targetId);"
];

for (const fragment of fragments) {
  assert.equal(
    app.includes(fragment),
    true,
    `component deposit auto-connect should include fragment: ${fragment}`
  );
}

console.log("componentDepositAutoConnect tests passed");
