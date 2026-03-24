const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const uiServerPath = path.join(__dirname, "..", "node_sidecar", "src", "uiServer.js");
const source = fs.readFileSync(uiServerPath, "utf8");

assert.equal(
  source.includes("const CRAFT_ASSIST_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;"),
  true,
  "craft assist UI route should declare a dedicated 5-minute timeout constant"
);

assert.match(
  source,
  /createCraftAssistWorkerPool\(\{logger,\s*requestTimeoutMs:\s*CRAFT_ASSIST_REQUEST_TIMEOUT_MS\}\)/m,
  "craft assist worker pool should be created with the dedicated 5-minute timeout"
);

console.log("craftAssistTimeoutConfig tests passed");
