const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {createSteamGuardCoexistProcessAdapter} = require("../src/steamGuardCoexistProcessAdapter");

test("联合绑定 worker 不依赖普通登录和已连接会话状态模块", () => {
  const workerSource = fs.readFileSync(path.resolve(__dirname, "../src/steamGuardCoexistWorker.js"), "utf8");
  assert.doesNotMatch(workerSource, /authService|TokenStore|sessionPool|refreshRuntime|steamWebSession/);
  assert.doesNotMatch(workerSource, /DEFAULT_FLOW_TTL_MS|expiryTimer|ttl_ms|expires_in_seconds/);
});

test("父进程适配器不会按本地时钟淘汰仍在等待验证码的 child process", async () => {
  let currentTime = 1000;
  const child = new FakeChild("no-local-expiry");
  const adapter = createSteamGuardCoexistProcessAdapter({
    forkProcess: () => child,
    now: () => currentTime
  });
  try {
    assert.equal((await adapter.start({
      flowId: "flow-no-expiry",
      username: "demo",
      password: "secret"
    })).state, "email_code_required");
    currentTime += 7 * 24 * 60 * 60 * 1000;
    assert.equal(adapter.cleanupExpired(), 0);
    assert.equal(child.killed, false);
    assert.equal(Object.hasOwn(child.messages[0], "ttl_ms"), false);
  } finally {
    adapter.shutdown();
  }
});

class FakeChild extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.connected = true;
    this.killed = false;
    this.messages = [];
  }

  send(message) {
    this.messages.push(message);
    queueMicrotask(() => {
      this.emit("message", {
        type: "result",
        request_id: message.request_id,
        result: message.type === "start"
          ? {ok: true, state: "email_code_required", flow_id: message.flow_id}
          : {ok: true, state: "steam_app_binding_required", flow_id: message.flow_id}
      });
    });
  }

  kill() {
    this.killed = true;
    this.connected = false;
    this.emit("exit", 0, null);
  }
}

test("同一用户名的联合绑定流程使用不同 child process 并按 flow_id 路由", async () => {
  const children = [];
  const forkCalls = [];
  const adapter = createSteamGuardCoexistProcessAdapter({
    forkProcess: (workerPath, args, options) => {
      forkCalls.push({workerPath, args, options});
      const child = new FakeChild(`child-${children.length + 1}`);
      children.push(child);
      return child;
    }
  });

  const [first, second] = await Promise.all([
    adapter.start({flowId: "flow-a", username: "same-user", password: "secret-a"}),
    adapter.start({flowId: "flow-b", username: "same-user", password: "secret-b"})
  ]);

  assert.equal(first.flow_id, "flow-a");
  assert.equal(second.flow_id, "flow-b");
  assert.equal(children.length, 2);
  assert.notEqual(children[0], children[1]);
  assert.deepEqual(forkCalls[0].options.stdio, ["ignore", "ignore", "ignore", "ipc"]);
  assert.equal(forkCalls[0].options.windowsHide, true);
  assert.equal(forkCalls[0].options.env.ELECTRON_RUN_AS_NODE, "1");

  await adapter.submitEmailCode({flowId: "flow-b", code: "EMAIL-B"});
  assert.equal(children[0].messages.some((message) => message.type === "submit_email_code"), false);
  assert.equal(children[1].messages.at(-1).type, "submit_email_code");
  assert.equal(children[1].messages.at(-1).code, "EMAIL-B");

  assert.deepEqual(adapter.cancel("flow-a"), {ok: true});
  assert.equal(children[0].killed, true);
  assert.equal(children[1].killed, false);
  adapter.shutdown();
  assert.equal(children[1].killed, true);
});

test("默认适配器可以与真实 worker 完成 IPC 且凭据不会出现在进程参数中", async () => {
  const adapter = createSteamGuardCoexistProcessAdapter({requestTimeoutMs: 5000});
  try {
    const result = await adapter.start({
      flowId: "real-worker-flow",
      username: "",
      password: "must-not-be-an-argv-value"
    });
    assert.deepEqual(result, {ok: false, reason: "username_required"});
  } finally {
    adapter.shutdown();
  }
});

test("父进程将 worker 原始错误码脱敏落盘且不向调用方返回诊断对象", async () => {
  class DiagnosticChild extends FakeChild {
    send(message) {
      this.messages.push(message);
      queueMicrotask(() => {
        this.emit("message", {
          type: "result",
          request_id: message.request_id,
          result: {
            ok: false,
            reason: "login_failed",
            diagnostic: {
              stage: "email_code_submit",
              eresult: 88,
              code: "InvalidLoginAuthCode",
              http_status: 401,
              steam_status: null,
              error_name: "Error",
              message: "must-not-be-persisted",
              password: "must-not-leak",
              access_token: "must-not-leak"
            }
          }
        });
      });
    }
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "steam-guard-coexist-log-"));
  const diagnosticLogPath = path.join(tempDir, "diagnostics.jsonl");
  const adapter = createSteamGuardCoexistProcessAdapter({
    forkProcess: () => new DiagnosticChild("diagnostic-child"),
    diagnosticLogPath,
    now: () => Date.parse("2026-07-18T12:00:00.000Z")
  });
  try {
    const result = await adapter.start({
      flowId: "flow-log",
      username: "must-not-be-persisted",
      password: "must-not-leak"
    });

    assert.deepEqual(result, {ok: false, reason: "login_failed"});
    const lines = fs.readFileSync(diagnosticLogPath, "utf8").trim().split(/\r?\n/);
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), {
      timestamp: "2026-07-18T12:00:00.000Z",
      flow_id: "flow-log",
      request_type: "start",
      reason: "login_failed",
      stage: "email_code_submit",
      eresult: 88,
      code: "InvalidLoginAuthCode",
      http_status: 401,
      steam_status: null,
      error_name: "Error"
    });
    assert.doesNotMatch(lines[0], /must-not-be-persisted|must-not-leak|access_token|password|message/);
  } finally {
    adapter.shutdown();
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
});
