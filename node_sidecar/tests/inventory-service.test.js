const assert = require("node:assert/strict");
const EventEmitter = require("node:events");

const {fetchFullInventory} = require("../src/inventoryService");

function withProxyEnv(envValues, fn) {
  const keys = ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy"];
  const original = {};
  for (const key of keys) {
    original[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(envValues || {})) {
    process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  }
}

function stubHttpsGet(responseFactory) {
  const https = require("https");
  const originalGet = https.get;
  const requests = [];

  https.get = (options, callback) => {
    requests.push({...options});
    const req = new EventEmitter();
    req.destroy = () => {};

    process.nextTick(() => {
      const response = responseFactory(options);
      if (response.error) {
        req.emit("error", response.error);
        return;
      }
      const res = new EventEmitter();
      res.statusCode = response.statusCode;
      res.headers = response.headers || {};
      callback(res);
      if (typeof response.body === "string" && response.body.length) {
        res.emit("data", response.body);
      }
      res.emit("end");
    });

    return req;
  };

  return {
    requests,
    restore() {
      https.get = originalGet;
    }
  };
}

async function test_fetch_full_inventory_emits_request_and_response_trace() {
  const httpsStub = stubHttpsGet(() => ({
    statusCode: 200,
    body: JSON.stringify({
      assets: [
        {
          assetid: "asset_1",
          classid: "class_1",
          instanceid: "0",
          amount: "1"
        }
      ],
      descriptions: [
        {
          classid: "class_1",
          instanceid: "0",
          market_hash_name: "AK-47 | Redline (Field-Tested)",
          name: "AK-47 | Redline (Field-Tested)",
          tradable: 1,
          marketable: 1
        }
      ],
      more_items: 0,
      last_assetid: ""
    })
  }));
  const traces = [];

  try {
    const items = await fetchFullInventory({
      steamId64: "76561198000000000",
      cookieString: "sessionid=abcdef1234567890abcdef12; steamLoginSecure=fake",
      onTrace(trace) {
        traces.push(trace);
      }
    });

    assert.equal(items.length, 1);
    assert.equal(traces.length >= 2, true, "expected request and response traces");
    assert.equal(traces[0].phase, "request");
    assert.equal(traces[0].pageIndex, 0);
    assert.match(traces[0].url, /steamcommunity\.com\/inventory\/76561198000000000\/730\/2/);
    assert.match(traces[0].cookieSummary, /sessionid=abcdef12\.\.\./);
    assert.match(traces[0].cookieSummary, /steamLoginSecure=yes/);

    assert.equal(traces[1].phase, "response");
    assert.equal(traces[1].statusCode, 200);
    assert.equal(traces[1].assetCount, 1);
    assert.equal(traces[1].descriptionCount, 1);
    assert.equal(traces[1].moreItems, 0);
    assert.match(traces[1].bodySnippet, /"assets":\[/);
    assert.equal(httpsStub.requests.length, 1);
  } finally {
    httpsStub.restore();
  }
}

async function test_fetch_full_inventory_emits_error_trace_with_response_snippet() {
  const httpsStub = stubHttpsGet(() => ({
    statusCode: 403,
    body: "<html><body>Access denied for this inventory request</body></html>"
  }));
  const traces = [];

  try {
    await assert.rejects(
      () => fetchFullInventory({
        steamId64: "76561198000000000",
        cookieString: "sessionid=abcdef1234567890abcdef12; steamLoginSecure=fake",
        onTrace(trace) {
          traces.push(trace);
        }
      }),
      (error) => {
        assert.match(String(error && error.message), /库存 API 返回 403/);
        assert.match(String(error && error.message), /Access denied/);
        return true;
      }
    );

    assert.equal(traces.length >= 2, true, "expected request and error traces");
    assert.equal(traces[1].phase, "error");
    assert.equal(traces[1].statusCode, 403);
    assert.match(traces[1].bodySnippet, /Access denied for this inventory request/);
    assert.match(traces[1].message, /库存 API 返回 403/);
  } finally {
    httpsStub.restore();
  }
}

async function test_fetch_full_inventory_injects_proxy_agent_when_configured() {
  const httpsStub = stubHttpsGet(() => ({
    statusCode: 200,
    body: JSON.stringify({
      assets: [],
      descriptions: [],
      more_items: 0,
      last_assetid: ""
    })
  }));

  try {
    await withProxyEnv({HTTPS_PROXY: "http://127.0.0.1:8888"}, async () => {
      const items = await fetchFullInventory({
        steamId64: "76561198000000000",
        cookieString: "sessionid=abcdef1234567890abcdef12; steamLoginSecure=fake"
      });

      assert.deepEqual(items, []);
      assert.equal(httpsStub.requests.length, 1);
      assert.ok(httpsStub.requests[0].agent, "inventory https.get should include proxy agent");
    });
  } finally {
    httpsStub.restore();
  }
}

async function main() {
  await test_fetch_full_inventory_emits_request_and_response_trace();
  await test_fetch_full_inventory_emits_error_trace_with_response_snippet();
  await test_fetch_full_inventory_injects_proxy_agent_when_configured();
  console.log("inventory-service tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
