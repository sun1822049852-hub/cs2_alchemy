const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const uiServerPath = path.join(__dirname, "..", "node_sidecar", "src", "uiServer.js");
const workerPoolPath = path.join(__dirname, "..", "node_sidecar", "src", "services", "craftAssistWorkerPool.js");
const source = fs.readFileSync(uiServerPath, "utf8");
const workerPoolSource = fs.readFileSync(workerPoolPath, "utf8");

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

assert.equal(
  workerPoolSource.includes("requestTimeoutMs = 5 * 60 * 1000,"),
  true,
  "craft assist worker pool should default to the same 5-minute timeout so fallback calls do not regress to 30000ms"
);

assert.match(
  workerPoolSource,
  /const timeoutMs = Math\.max\(1,\s*Math\.trunc\(Number\(requestTimeoutMs\) \|\| 0\) \|\| 5 \* 60 \* 1000\);/m,
  "craft assist worker pool timeout normalization should also fall back to the 5-minute default"
);

console.log("craftAssistTimeoutConfig tests passed");
