const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {fork} = require("child_process");

const {PATHS} = require("./constants");

const DEFAULT_REQUEST_TIMEOUT_MS = 60 * 1000;

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function diagnosticValue(value) {
  if (value === undefined || value === null) return null;
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  if (typeof value === "bigint") return value.toString();
  return text(value) || null;
}

function publicResult(result) {
  if (!result || typeof result !== "object") {
    return {ok: false, reason: "coexist_worker_invalid_response"};
  }
  const output = {...result};
  delete output.diagnostic;
  return output;
}

class SteamGuardCoexistProcessAdapter {
  constructor({
    forkProcess = fork,
    workerPath = path.join(__dirname, "steamGuardCoexistWorker.js"),
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    randomUUID = crypto.randomUUID,
    now = Date.now,
    diagnosticLogPath = path.join(PATHS.LOG_DIR, "steam_guard_coexist", "diagnostics.jsonl"),
    fileSystem = fs.promises
  } = {}) {
    this.forkProcess = forkProcess;
    this.workerPath = workerPath;
    this.requestTimeoutMs = Math.max(1000, Number(requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS);
    this.randomUUID = randomUUID;
    this.now = now;
    this.diagnosticLogPath = path.resolve(diagnosticLogPath);
    this.fileSystem = fileSystem;
    this.diagnosticWriteQueue = Promise.resolve();
    this.flows = new Map();
  }

  async start({flowId, username, password} = {}) {
    const key = text(flowId);
    if (!key) return {ok: false, reason: "flow_id_required"};
    if (this.flows.has(key)) return {ok: false, reason: "flow_exists"};

    const child = this.forkProcess(this.workerPath, [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
      env: {...process.env, ELECTRON_RUN_AS_NODE: "1"}
    });
    const entry = {
      flowId: key,
      child,
      pending: new Map(),
      closed: false
    };
    this.flows.set(key, entry);
    this._bindChild(entry);

    try {
      const result = await this._request(entry, {
        type: "start",
        flow_id: key,
        username: text(username),
        password: password === undefined || password === null ? "" : String(password)
      });
      if (!result || result.ok === false) this.cancel(key);
      return result;
    } catch (err) {
      this.cancel(key);
      throw err;
    }
  }

  submitEmailCode({flowId, code} = {}) {
    return this._requestByFlow(flowId, {
      type: "submit_email_code",
      flow_id: text(flowId),
      code: text(code)
    });
  }

  verifyAppCode({flowId, code} = {}) {
    return this._requestByFlow(flowId, {
      type: "verify_app_code",
      flow_id: text(flowId),
      code: text(code)
    });
  }

  cancel(flowId) {
    const key = text(flowId);
    const entry = this.flows.get(key);
    if (!entry) return {ok: false, reason: "flow_not_found"};
    this._closeEntry(entry, new Error("coexist flow cancelled"));
    return {ok: true};
  }

  cleanupExpired() {
    return 0;
  }

  shutdown() {
    for (const entry of [...this.flows.values()]) {
      this._closeEntry(entry, new Error("coexist service shutdown"));
    }
  }

  _requestByFlow(flowId, message) {
    const entry = this.flows.get(text(flowId));
    if (!entry) return Promise.resolve({ok: false, reason: "flow_not_found"});
    return this._request(entry, message);
  }

  _request(entry, message) {
    if (!entry || entry.closed || !entry.child || entry.child.connected === false) {
      return Promise.resolve({ok: false, reason: "flow_not_found"});
    }
    const requestId = text(this.randomUUID());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.pending.delete(requestId);
        const error = new Error("Steam Guard coexist worker request timed out");
        error.code = "coexist_worker_timeout";
        reject(error);
        this._closeEntry(entry, error);
      }, this.requestTimeoutMs);
      if (timer && typeof timer.unref === "function") timer.unref();
      entry.pending.set(requestId, {resolve, reject, timer, requestType: text(message.type)});
      try {
        entry.child.send({...message, request_id: requestId});
      } catch (err) {
        clearTimeout(timer);
        entry.pending.delete(requestId);
        reject(err);
        this._closeEntry(entry, err);
      }
    });
  }

  _bindChild(entry) {
    entry.child.on("message", (message) => {
      if (!message || typeof message !== "object") return;
      if (message.type !== "result") return;
      const requestId = text(message.request_id);
      const pending = entry.pending.get(requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      entry.pending.delete(requestId);
      const result = message.result && typeof message.result === "object"
        ? message.result
        : {ok: false, reason: "coexist_worker_invalid_response"};
      this._persistDiagnostic(entry.flowId, pending.requestType, result)
        .then(() => pending.resolve(publicResult(result)));
    });
    entry.child.on("error", (err) => this._closeEntry(entry, err));
    entry.child.on("exit", (code, signal) => {
      const error = new Error(`Steam Guard coexist worker exited (${code ?? "null"}/${signal || "none"})`);
      error.code = "coexist_worker_exited";
      this._closeEntry(entry, error, {kill: false});
    });
  }

  _persistDiagnostic(flowId, requestType, result) {
    const diagnostic = result && result.diagnostic;
    if (!diagnostic || typeof diagnostic !== "object") return Promise.resolve();
    const record = {
      timestamp: new Date(this.now()).toISOString(),
      flow_id: text(flowId),
      request_type: text(requestType),
      reason: text(result.reason),
      stage: text(diagnostic.stage),
      eresult: diagnosticValue(diagnostic.eresult),
      code: diagnosticValue(diagnostic.code),
      http_status: diagnosticValue(diagnostic.http_status),
      steam_status: diagnosticValue(diagnostic.steam_status),
      error_name: diagnosticValue(diagnostic.error_name)
    };
    const line = `${JSON.stringify(record)}\n`;
    const write = this.diagnosticWriteQueue.then(async () => {
      await this.fileSystem.mkdir(path.dirname(this.diagnosticLogPath), {recursive: true});
      await this.fileSystem.appendFile(this.diagnosticLogPath, line, "utf8");
    });
    this.diagnosticWriteQueue = write.catch((err) => {
      const errorCode = text(err && err.code) || "unknown";
      console.error(`[steam-guard-coexist] diagnostic log write failed (${errorCode})`);
    });
    return this.diagnosticWriteQueue;
  }

  _closeEntry(entry, error, {kill = true} = {}) {
    if (!entry || entry.closed) return;
    entry.closed = true;
    this.flows.delete(entry.flowId);
    for (const pending of entry.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    entry.pending.clear();
    if (kill && entry.child && !entry.child.killed) {
      try { entry.child.kill(); } catch (_) {}
    }
  }
}

function createSteamGuardCoexistProcessAdapter(options) {
  return new SteamGuardCoexistProcessAdapter(options);
}

module.exports = {
  SteamGuardCoexistProcessAdapter,
  createSteamGuardCoexistProcessAdapter
};
