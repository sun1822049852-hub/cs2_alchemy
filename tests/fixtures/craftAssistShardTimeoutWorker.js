const {parentPort} = require("node:worker_threads");

if (!parentPort) {
  throw new Error("craftAssistShardTimeoutWorker requires parentPort");
}

parentPort.on("message", (message) => {
  if (!message || message.type !== "prefilter") return;
  setInterval(() => {}, 1000);
});
