const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const path = require("node:path");

async function withProxyEnv(envValues, fn) {
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
    return await fn();
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

function stubHttpsRequest(responseBody) {
  const https = require("https");
  const originalRequest = https.request;
  const requests = [];

  https.request = (options, callback) => {
    requests.push({...options});
    const req = new EventEmitter();
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = {};
      process.nextTick(() => {
        callback(res);
        res.emit("data", responseBody);
        res.emit("end");
      });
    };
    req.write = () => {};
    req.destroy = () => {};
    req.setTimeout = () => {};
    return req;
  };

  return {
    requests,
    restore() {
      https.request = originalRequest;
    }
  };
}

function loadNetworkPrecheckFresh() {
  const modulePath = path.resolve(__dirname, "../src/networkPrecheck.js");
  delete require.cache[modulePath];
  return require(modulePath);
}

async function test_auth_precheck_uses_proxy_agent_for_configured_proxy() {
  const httpsStub = stubHttpsRequest(JSON.stringify({
    response: {
      publickey_mod: "abc123",
      timestamp: "123456"
    }
  }));
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("fetch should not be used for proxied precheck");
  };

  try {
    await withProxyEnv({HTTPS_PROXY: "http://127.0.0.1:8888"}, async () => {
      const {precheckAuthApi} = loadNetworkPrecheckFresh();
      const result = await precheckAuthApi({force: true, timeoutMs: 1000});

      assert.equal(result.ok, true);
      assert.match(result.detail, /http=200/);
      assert.equal(httpsStub.requests.length, 1);
      assert.ok(httpsStub.requests[0].agent, "precheck request should include proxy agent");
    });
  } finally {
    global.fetch = originalFetch;
    httpsStub.restore();
  }
}

async function main() {
  await test_auth_precheck_uses_proxy_agent_for_configured_proxy();
  console.log("network-precheck-proxy tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
