const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const uiServerPath = path.join(__dirname, "..", "node_sidecar", "src", "uiServer.js");
const workerPath = path.join(__dirname, "..", "node_sidecar", "src", "services", "craftAssistWorker.js");

const uiServerSource = fs.readFileSync(uiServerPath, "utf8");
const workerSource = fs.readFileSync(workerPath, "utf8");

assert.equal(
  uiServerSource.includes("snapshotPath: loaded.snapshot_path"),
  true,
  "uiServer must pass snapshotPath to craft-assist workers so large candidate pools are not cloned across threads"
);

assert.equal(
  uiServerSource.includes("candidateRows: candidateContext.candidateRows"),
  false,
  "uiServer must not pass inline candidateRows to craft-assist workers"
);

assert.equal(
  workerSource.includes('const {buildCraftCandidateContext} = require("./craftCandidateService");'),
  true,
  "craftAssistWorker must rebuild candidate context from snapshot rows"
);

assert.equal(
  workerSource.includes("buildCraftCandidateContext({"),
  true,
  "craftAssistWorker must rebuild candidate rows inside the worker when snapshotPath is used"
);

console.log("craftAssistWorkerWiring tests passed");
