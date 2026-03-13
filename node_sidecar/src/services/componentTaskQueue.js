const {asString, nowString} = require("../utils");

function normalizeAction(action) {
  return asString(action).trim() === "withdraw" ? "withdraw" : "deposit";
}

function createComponentTaskQueue({logger, onStateChanged} = {}) {
  const queued = [];
  const jobMap = new Map();
  let running = null;
  let seq = 0;

  function buildJobId() {
    seq += 1;
    return `component_task_${Date.now()}_${seq}`;
  }

  function toPublicJob(job, queuePosition = 0) {
    if (!job) {
      return null;
    }
    return {
      job_id: job.id,
      username: job.username,
      action: job.action,
      component_id: job.componentId,
      requested: job.requested,
      status: job.status,
      created_at: job.createdAt,
      started_at: job.startedAt || "",
      queue_position: Math.max(0, Number(queuePosition) || 0)
    };
  }

  function getSnapshot(username = "") {
    const key = asString(username).trim();
    const queueItems = [];
    for (let i = 0; i < queued.length; i += 1) {
      const job = queued[i];
      if (key && job.username !== key) {
        continue;
      }
      queueItems.push(toPublicJob(job, i + 1));
    }
    const runningJob = running && (!key || running.username === key) ? toPublicJob(running, 0) : null;
    return {
      username: key,
      running: runningJob,
      queued: queueItems,
      queued_count: queueItems.length,
      total_queued: queued.length,
      updated_at: nowString()
    };
  }

  function emitState() {
    if (typeof onStateChanged !== "function") {
      return;
    }
    try {
      onStateChanged(getSnapshot(""));
    } catch (_) {
      // ignore listener errors
    }
  }

  function runNext() {
    if (running || queued.length <= 0) {
      return;
    }
    const job = queued.shift();
    if (!job) {
      return;
    }
    running = job;
    job.status = "running";
    job.startedAt = nowString();
    emitState();

    Promise.resolve()
      .then(() => job.execute({job_id: job.id}))
      .then((result) => {
        job.status = "done";
        job.resolve(result);
      })
      .catch((err) => {
        job.status = "failed";
        job.reject(err);
      })
      .finally(() => {
        jobMap.delete(job.id);
        running = null;
        emitState();
        runNext();
      });
  }

  function enqueue({username, action, componentId, itemIds, execute}) {
    const account = asString(username).trim();
    if (!account) {
      throw new Error("username is required");
    }
    if (typeof execute !== "function") {
      throw new Error("execute is required");
    }
    const normalizedAction = normalizeAction(action);
    const componentKey = asString(componentId).trim();
    const requested = Array.isArray(itemIds) ? itemIds.length : 0;
    const jobId = buildJobId();

    let resolvePromise = null;
    let rejectPromise = null;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    promise.catch(() => {});

    const job = {
      id: jobId,
      username: account,
      action: normalizedAction,
      componentId: componentKey,
      requested,
      status: "queued",
      createdAt: nowString(),
      startedAt: "",
      execute,
      resolve: resolvePromise,
      reject: rejectPromise,
      promise
    };

    queued.push(job);
    jobMap.set(jobId, job);
    if (logger) {
      logger.info(
        "component_queue",
        `enqueue: job=${jobId} account=${account} action=${normalizedAction} component=${componentKey} requested=${requested} queued=${queued.length}`
      );
    }
    emitState();
    runNext();

    const snapshot = getSnapshot(account);
    const queuedView = snapshot.queued.find((x) => x.job_id === jobId);
    const runningView = snapshot.running && snapshot.running.job_id === jobId ? snapshot.running : null;
    return {
      job: queuedView || runningView || toPublicJob(job, 0),
      promise,
      snapshot
    };
  }

  function cancel(jobId) {
    const key = asString(jobId).trim();
    if (!key) {
      return {ok: false, code: "invalid_job_id", message: "job_id is required"};
    }
    if (running && running.id === key) {
      return {ok: false, code: "running", message: "任务正在执行，不能取消"};
    }
    const idx = queued.findIndex((x) => x.id === key);
    if (idx < 0) {
      return {ok: false, code: "not_found", message: "任务不存在或已完成"};
    }
    const [job] = queued.splice(idx, 1);
    job.status = "cancelled";
    jobMap.delete(job.id);
    job.reject(new Error("任务已取消"));
    if (logger) {
      logger.info("component_queue", `cancel: job=${job.id} account=${job.username}`);
    }
    emitState();
    return {ok: true, job: toPublicJob(job, 0)};
  }

  function cancelByUsername(username) {
    const key = asString(username).trim();
    if (!key) {
      return 0;
    }
    let count = 0;
    for (let i = queued.length - 1; i >= 0; i -= 1) {
      const job = queued[i];
      if (job.username !== key) {
        continue;
      }
      queued.splice(i, 1);
      job.status = "cancelled";
      jobMap.delete(job.id);
      job.reject(new Error("账号已删除，任务取消"));
      count += 1;
    }
    if (count > 0) {
      if (logger) {
        logger.info("component_queue", `cancel_by_account: account=${key} count=${count}`);
      }
      emitState();
    }
    return count;
  }

  return {
    enqueue,
    cancel,
    cancelByUsername,
    getSnapshot
  };
}

module.exports = {
  createComponentTaskQueue
};
