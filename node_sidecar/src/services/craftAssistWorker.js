const {parentPort} = require("worker_threads");

const {createCraftAssistService} = require("./craftAssistService");
const {createSnapshotRowsLoader} = require("./snapshotRowsLoader");

if (!parentPort) {
  throw new Error("craftAssistWorker requires parentPort");
}

const craftAssistService = createCraftAssistService({logger: null});
const snapshotRowsLoader = createSnapshotRowsLoader({limit: 6});

function errorPayload(err) {
  return {
    message: err && err.message ? String(err.message) : String(err || "unknown worker error")
  };
}

parentPort.on("message", async (message) => {
  if (!message || message.type !== "select") return;
  const requestId = String(message.requestId || "").trim();
  const payload = message.payload && typeof message.payload === "object" ? message.payload : {};
  try {
    const snapshotPath = String(payload.snapshotPath || "").trim();
    if (!requestId) throw new Error("requestId is required");
    if (!snapshotPath) throw new Error("snapshotPath is required");
    const rows = await snapshotRowsLoader.loadSnapshotRowsAsync(snapshotPath);
    const result = craftAssistService.selectForRecipe({
      targetWear: payload.targetWear,
      wearFilterMode: payload.wearFilterMode,
      materials: payload.materials,
      blockedIds: payload.blockedIds,
      includeCooling: payload.includeCooling,
      wearOffsetPct: payload.wearOffsetPct,
      rows
    });
    parentPort.postMessage({
      type: "result",
      requestId,
      ok: true,
      result
    });
  } catch (err) {
    parentPort.postMessage({
      type: "result",
      requestId,
      ok: false,
      error: errorPayload(err)
    });
  }
});
