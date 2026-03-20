const {parentPort} = require("worker_threads");

if (!parentPort) {
  throw new Error("craftAssistTimeoutWorker requires parentPort");
}

parentPort.on("message", (message) => {
  if (!message || message.type !== "select") return;
  const requestId = String(message.requestId || "").trim();
  const payload = message.payload && typeof message.payload === "object" ? message.payload : {};
  const delayMs = Math.max(1, Math.trunc(Number(payload.delayMs) || 0) || 200);
  setTimeout(() => {
    parentPort.postMessage({
      type: "result",
      requestId,
      ok: true,
      result: {
        ok: true,
        item_ids: [],
        overall: 0,
        rarity: 0,
        selection_trace: null,
        recipe_ok: true,
        recipe_reason: "",
        recipe_text: "",
        picks: []
      }
    });
  }, delayMs);
});
