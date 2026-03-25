const {parentPort} = require("node:worker_threads");

if (!parentPort) {
  throw new Error("craftAssistShardCrashWorker requires parentPort");
}

parentPort.on("message", (message) => {
  if (!message || message.type !== "prefilter") return;
  throw new Error("fixture shard crash");
});
