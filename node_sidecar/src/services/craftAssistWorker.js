const {parentPort} = require("worker_threads");

const {
  createCraftAssistService,
  buildCraftAssistSelectionContextFromCandidateRows
} = require("./craftAssistService");
const {buildCraftCandidateContext} = require("./craftCandidateService");
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
    const candidateRows = Array.isArray(payload.candidateRows) ? payload.candidateRows : null;
    if (!requestId) throw new Error("requestId is required");
    if (!snapshotPath && !candidateRows) throw new Error("snapshotPath or candidateRows is required");
    const includeCooling = !!payload.includeCooling;
    const rows = candidateRows || await snapshotRowsLoader.loadSnapshotRowsAsync(snapshotPath);
    const candidateContext = candidateRows
      ? {candidateRows}
      : buildCraftCandidateContext({
        rows,
        includeComponentItems: !!payload.includeComponentItems,
        includeCooling,
        selectedItemIds: payload.selectedItemIds || payload.blockedIds
      });
    const selectionContext = buildCraftAssistSelectionContextFromCandidateRows(candidateContext.candidateRows, {
      includeCooling
    });
    const result = await craftAssistService.selectForRecipe({
      targetWear: payload.targetWear,
      wearFilterMode: payload.wearFilterMode,
      materials: payload.materials,
      blockedIds: payload.blockedIds,
      includeCooling,
      wearOffsetPct: payload.wearOffsetPct,
      enableFastCraftAssist: payload.enableFastCraftAssist,
      rows,
      selectionContext
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
