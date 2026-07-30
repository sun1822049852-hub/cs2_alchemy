const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");

const {createRefreshRuntime} = require("../src/services/refreshRuntime");

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

function parseSseEvents(writes) {
  return writes
    .join("")
    .split("\n\n")
    .map((block) => String(block || "").trim())
    .filter(Boolean)
    .map((block) => {
      const eventLine = block.split("\n").find((line) => line.startsWith("event: "));
      return eventLine ? eventLine.slice("event: ".length).trim() : "";
    })
    .filter(Boolean);
}

function parseSsePayloads(writes, eventName) {
  return writes
    .join("")
    .split("\n\n")
    .map((block) => String(block || "").trim())
    .filter((block) => block.includes(`event: ${eventName}`))
    .map((block) => {
      const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
      return JSON.parse(dataLine.slice("data: ".length));
    });
}

function attachSseClient(runtime, username) {
  const req = new EventEmitter();
  const writes = [];
  const res = {
    writeHead() {},
    flushHeaders() {},
    write(chunk) {
      writes.push(String(chunk || ""));
    }
  };
  runtime.handleSseRequest(req, res, username);
  return {req, writes};
}

async function test_run_refresh_job_emits_connection_ready_before_inventory_refreshed() {
  const refreshDeferred = createDeferred();
  const runtime = createRefreshRuntime({
    refreshInventoryFn: async (args = {}) => {
      assert.equal(typeof args.onConnectionReady, "function", "refresh runtime should pass a connection-ready callback into refreshInventory");
      assert.equal(typeof args.onConnectionProgress, "function", "refresh runtime should pass license progress into refreshInventory");
      await args.onConnectionProgress({stage: "checking", app_id: 730, message: "正在检查 CS2 入库"});
      await args.onConnectionProgress({stage: "claiming", app_id: 730, message: "正在领取 CS2"});
      await args.onConnectionReady({account: "acc-a"});
      await refreshDeferred.promise;
      return {
        account: "acc-a",
        snapshot_path: "snapshot.json",
        message: "ok"
      };
    },
    accountStoreFactory: () => ({
      getActive() {
        return {username: "acc-a"};
      }
    }),
    uiStateStoreFactory: () => ({
      getAccount() {
        return null;
      },
      clearAccountAuthState() {}
    }),
    resolveRefreshTarget: () => "acc-a",
    buildRefreshPayload: async (result) => ({
      result,
      fetch_time: "2026-04-12 20:15:00",
      rows: [],
      component: {
        summary_map: {},
        item_map: {}
      }
    })
  });

  runtime.start();
  const client = attachSseClient(runtime, "acc-a");
  const task = runtime.runRefreshJob({username: "acc-a", source: "manual"});

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    parseSseEvents(client.writes),
    ["connected", "steam_app_license_status", "steam_app_license_status", "inventory_connection_ready"],
    "SSE should publish connection readiness before the full refresh payload finishes"
  );

  refreshDeferred.resolve();
  await task;
  assert.deepEqual(
    parseSseEvents(client.writes),
    ["connected", "steam_app_license_status", "steam_app_license_status", "inventory_connection_ready", "inventory_refreshed"]
  );
  assert.deepEqual(
    parseSsePayloads(client.writes, "steam_app_license_status").map((payload) => ({
      username: payload.username,
      source: payload.source,
      stage: payload.stage,
      app_id: payload.app_id
    })),
    [
      {username: "acc-a", source: "manual", stage: "checking", app_id: 730},
      {username: "acc-a", source: "manual", stage: "claiming", app_id: 730}
    ]
  );
  client.req.emit("close");
}

async function main() {
  await test_run_refresh_job_emits_connection_ready_before_inventory_refreshed();
  console.log("refresh-runtime-connection-ready tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
