const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");

const {createRefreshRuntime} = require("../node_sidecar/src/services/refreshRuntime");

function createDeferred() {
  let resolve = null;
  let reject = null;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

function createSseClient() {
  const req = new EventEmitter();
  const writes = [];
  const res = {
    writeHead() {},
    flushHeaders() {},
    write(chunk) {
      writes.push(String(chunk));
    }
  };
  return {req, res, writes};
}

function parseSseEvents(writes) {
  const text = Array.isArray(writes) ? writes.join("") : "";
  return text
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const event = (lines.find((line) => line.startsWith("event: ")) || "").slice(7).trim();
      const dataLine = lines.find((line) => line.startsWith("data: "));
      let data = {};
      if (dataLine) {
        try {
          data = JSON.parse(dataLine.slice(6));
        } catch (_) {
          data = {};
        }
      }
      return {event, data};
    });
}

async function waitForAsyncTurn() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function test_refresh_runtime_runs_post_refresh_task_in_background_and_allows_custom_sse() {
  const deferred = createDeferred();
  const postRefreshCalls = [];
  const runtime = createRefreshRuntime({
    logger: null,
    refreshInventoryFn: async ({username}) => ({
      account: username,
      snapshot_path: "snapshot.json"
    }),
    accountStoreFactory: () => ({
      getActive() {
        return {username: "alice"};
      },
      get(username) {
        return {username};
      }
    }),
    uiStateStoreFactory: () => ({
      getAccount() {
        return null;
      }
    }),
    resolveRefreshTarget: (username) => username || "alice",
    buildRefreshPayload: async (result) => ({
      result,
      fetch_time: "2026-04-07 16:00:00",
      rows: [{id: 1}],
      component: {}
    }),
    runPostRefreshTask: async ({username, source, payload, emitSse}) => {
      postRefreshCalls.push({username, source, rows: payload.rows.length});
      await deferred.promise;
      emitSse("inventory_display_images_enriched", {
        username,
        source,
        refreshed_rows: payload.rows.length
      });
    },
    heartbeatCheckMs: 60 * 1000,
    sseKeepaliveMs: 60 * 1000
  });

  runtime.start();
  const sse = createSseClient();
  runtime.handleSseRequest(sse.req, sse.res, "alice");

  const payload = await runtime.runRefreshJob({
    username: "alice",
    source: "manual"
  });

  assert.equal(payload.rows.length, 1);
  assert.deepEqual(postRefreshCalls, [{
    username: "alice",
    source: "manual",
    rows: 1
  }]);

  const eventsBefore = parseSseEvents(sse.writes);
  assert(eventsBefore.some((entry) => entry.event === "inventory_refreshed"));
  assert.equal(eventsBefore.some((entry) => entry.event === "inventory_display_images_enriched"), false);

  deferred.resolve();
  await waitForAsyncTurn();

  const eventsAfter = parseSseEvents(sse.writes);
  const enrichEvent = eventsAfter.find((entry) => entry.event === "inventory_display_images_enriched");
  assert(enrichEvent);
  assert.equal(enrichEvent.data.username, "alice");
  assert.equal(enrichEvent.data.source, "manual");
  assert.equal(enrichEvent.data.refreshed_rows, 1);
}

(async () => {
  await test_refresh_runtime_runs_post_refresh_task_in_background_and_allows_custom_sse();
  console.log("refreshRuntime tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
