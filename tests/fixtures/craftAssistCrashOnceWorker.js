const fs = require("fs");
const {parentPort} = require("worker_threads");

const {createCraftAssistService} = require("../../node_sidecar/src/services/craftAssistService");
const {createSnapshotRowsLoader} = require("../../node_sidecar/src/services/snapshotRowsLoader");

if (!parentPort) {
  throw new Error("craftAssistCrashOnceWorker requires parentPort");
}

const craftAssistService = createCraftAssistService({logger: null});
const snapshotRowsLoader = createSnapshotRowsLoader({limit: 2});

parentPort.on("message", async (message) => {
  if (!message || message.type !== "select") return;
  const requestId = String(message.requestId || "").trim();
  const payload = message.payload && typeof message.payload === "object" ? message.payload : {};
  const crashMarkerPath = String(payload.crashMarkerPath || "").trim();
  if (crashMarkerPath && !fs.existsSync(crashMarkerPath)) {
    fs.writeFileSync(crashMarkerPath, "1");
    process.exit(1);
    return;
  }
  try {
    const rows = await snapshotRowsLoader.loadSnapshotRowsAsync(payload.snapshotPath);
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
      error: {
        message: err && err.message ? String(err.message) : String(err || "crash-once worker failed")
      }
    });
  }
});
