const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sse-protocol-route-"));
const {configureRuntimePaths} = require("../src/constants");
configureRuntimePaths({projectRoot: tempDir, userDataDir: tempDir, isPackaged: false});
const {createServer} = require("../src/uiServer");

function createReadyLicenseRuntime() {
  const state = {
    ok: true,
    code: "ready",
    user: {
      id: "sse-user",
      username: "sse-user",
      membership_plan: "pro"
    },
    permissions: [],
    featureFlags: {},
    expiresAt: "2099-01-01T00:00:00.000Z",
    expiresInMs: 86400000
  };
  return {
    getState() {
      return state;
    },
    stop() {}
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
    server.on("error", reject);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  });
}

function requestRaw(port, route) {
  return new Promise((resolve, reject) => {
    const req = http.request({hostname: "127.0.0.1", port, path: route, method: "GET"}, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        statusCode: Number(res.statusCode || 0),
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function test_legacy_event_stream_is_retired_with_204() {
  const calls = [];
  const refreshRuntime = {
    start() {},
    handleSseRequest(req, res, username) {
      calls.push({username});
      res.writeHead(200, {"Content-Type": "text/event-stream; charset=utf-8"});
      res.end("event: connected\ndata: {}\n\n");
    },
    isConnected() {
      return false;
    },
    removeAccount() {}
  };
  const server = createServer({
    refreshRuntime,
    licenseRuntimeFactory: () => createReadyLicenseRuntime()
  });

  try {
    const address = await listen(server);
    const legacy = await requestRaw(address.port, "/api/events");
    assert.equal(legacy.statusCode, 204, "legacy EventSource clients must receive the stop-reconnect status");
    assert.equal(legacy.body, "");
    assert.equal(calls.length, 0, "legacy clients must not consume a refreshRuntime SSE slot");

    const current = await requestRaw(address.port, "/api/events?stream_version=2");
    assert.equal(current.statusCode, 200);
    assert.equal(calls.length, 1, "the current protocol should keep using the existing refreshRuntime handler");
    assert.equal(calls[0].username, "");
  } finally {
    await closeServer(server);
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

test_legacy_event_stream_is_retired_with_204()
  .then(() => console.log("sse-protocol-route tests passed"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
