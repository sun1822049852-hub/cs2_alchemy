const path = require("path");
const {Worker} = require("worker_threads");

const DEFAULT_WORKER_PATH = path.resolve(__dirname, "craftAssistWorker.js");

function asError(err, fallback = "craft assist worker failed") {
  if (err instanceof Error) return err;
  const message = err && err.message ? String(err.message) : String(err || fallback);
  return new Error(message || fallback);
}

function createCraftAssistWorkerPool({
  size = 2,
  requestTimeoutMs = 30000,
  workerPath = DEFAULT_WORKER_PATH,
  maxTaskRetries = 1,
  logger = null
} = {}) {
  const poolSize = Math.max(1, Math.min(4, Math.trunc(Number(size) || 0) || 2));
  const timeoutMs = Math.max(1, Math.trunc(Number(requestTimeoutMs) || 0) || 30000);
  const retryLimit = Math.max(0, Math.trunc(Number(maxTaskRetries) || 0));
  const resolvedWorkerPath = path.resolve(workerPath || DEFAULT_WORKER_PATH);
  const queue = [];
  const workers = [];
  let closed = false;
  let requestSeq = 0;

  function log(level, message) {
    if (!logger || typeof logger[level] !== "function") return;
    logger[level]("craft_assist_worker", message);
  }

  function nextRequestId() {
    requestSeq += 1;
    return `craft_assist_${Date.now()}_${requestSeq}`;
  }

  function normalizePayload(args = {}) {
    const payload = args && typeof args === "object" ? {...args} : {};
    payload.snapshotPath = String(payload.snapshotPath || "").trim();
    return payload;
  }

  function spawnWorker(state) {
    if (closed) return;
    const worker = new Worker(resolvedWorkerPath);
    state.worker = worker;
    state.busy = false;
    state.activeTask = null;
    worker.on("message", (message) => {
      if (state.worker !== worker) return;
      handleWorkerMessage(state, worker, message);
    });
    worker.on("error", (err) => {
      if (state.worker !== worker) return;
      retireWorker(state, worker, asError(err, "craft assist worker error"), {requeue: true});
    });
    worker.on("exit", (code) => {
      if (state.worker !== worker) return;
      if (closed) {
        state.worker = null;
        state.busy = false;
        state.activeTask = null;
        return;
      }
      const reason = code === 0
        ? new Error("craft assist worker exited unexpectedly")
        : new Error(`craft assist worker exited with code ${code}`);
      retireWorker(state, worker, reason, {requeue: true});
    });
  }

  function dispatch() {
    if (closed) return;
    for (const state of workers) {
      if (!queue.length) break;
      if (!state.worker || state.busy) continue;
      const task = queue.shift();
      if (!task || task.done) continue;
      assignTask(state, task);
    }
  }

  function settleTask(task, err, result) {
    if (!task || task.done) return;
    task.done = true;
    if (task.timeoutId) {
      clearTimeout(task.timeoutId);
      task.timeoutId = null;
    }
    if (err) task.reject(asError(err));
    else task.resolve(result);
  }

  function assignTask(state, task) {
    state.busy = true;
    state.activeTask = task;
    task.timeoutId = setTimeout(() => {
      if (state.activeTask !== task || !state.worker) return;
      const worker = state.worker;
      state.activeTask = null;
      state.busy = false;
      settleTask(task, new Error(`craft assist worker timeout after ${timeoutMs}ms`));
      state.worker = null;
      log("warn", `timeout request=${task.requestId} worker=${state.id}`);
      void worker.terminate().catch(() => {});
      spawnWorker(state);
      dispatch();
    }, timeoutMs);
    log("info", `dispatch request=${task.requestId} worker=${state.id}`);
    state.worker.postMessage({
      type: "select",
      requestId: task.requestId,
      payload: task.payload
    });
  }

  function maybeRetryTask(task) {
    if (!task || task.done) return false;
    if (task.retriesRemaining <= 0) return false;
    task.retriesRemaining -= 1;
    if (task.timeoutId) {
      clearTimeout(task.timeoutId);
      task.timeoutId = null;
    }
    queue.unshift(task);
    return true;
  }

  function retireWorker(state, worker, err, {requeue = false} = {}) {
    const task = state.activeTask;
    state.activeTask = null;
    state.busy = false;
    state.worker = null;
    if (task && task.timeoutId) {
      clearTimeout(task.timeoutId);
      task.timeoutId = null;
    }
    const retried = requeue && maybeRetryTask(task);
    if (!retried && task) {
      settleTask(task, err);
    }
    log("warn", `worker_retire worker=${state.id} reason=${asError(err).message}`);
    void worker.terminate().catch(() => {});
    spawnWorker(state);
    dispatch();
  }

  function handleWorkerMessage(state, worker, message) {
    const task = state.activeTask;
    if (!task) return;
    if (!message || message.type !== "result") return;
    if (String(message.requestId || "").trim() !== task.requestId) return;
    state.activeTask = null;
    state.busy = false;
    if (task.timeoutId) {
      clearTimeout(task.timeoutId);
      task.timeoutId = null;
    }
    log("info", `done request=${task.requestId} worker=${state.id}`);
    if (message.ok === false) {
      settleTask(task, new Error(String(message.error && message.error.message || "craft assist worker failed")));
    } else {
      settleTask(task, null, message.result);
    }
    dispatch();
  }

  for (let i = 0; i < poolSize; i += 1) {
    const state = {
      id: i + 1,
      worker: null,
      busy: false,
      activeTask: null
    };
    workers.push(state);
    spawnWorker(state);
  }

  function selectForRecipe(args = {}) {
    if (closed) {
      return Promise.reject(new Error("craft assist worker pool is closed"));
    }
    const payload = normalizePayload(args);
    if (!payload.snapshotPath) {
      return Promise.reject(new Error("snapshotPath is required"));
    }
    return new Promise((resolve, reject) => {
      const task = {
        requestId: nextRequestId(),
        payload,
        resolve,
        reject,
        retriesRemaining: retryLimit,
        timeoutId: null,
        done: false
      };
      log("info", `enqueue request=${task.requestId}`);
      queue.push(task);
      dispatch();
    });
  }

  async function close() {
    if (closed) return;
    closed = true;
    while (queue.length) {
      const task = queue.shift();
      settleTask(task, new Error("craft assist worker pool is closing"));
    }
    const shutdowns = [];
    for (const state of workers) {
      if (state.activeTask) {
        settleTask(state.activeTask, new Error("craft assist worker pool is closing"));
        state.activeTask = null;
      }
      state.busy = false;
      const worker = state.worker;
      state.worker = null;
      if (worker) shutdowns.push(worker.terminate().catch(() => {}));
    }
    await Promise.allSettled(shutdowns);
  }

  return {
    selectForRecipe,
    close
  };
}

module.exports = {
  createCraftAssistWorkerPool
};
