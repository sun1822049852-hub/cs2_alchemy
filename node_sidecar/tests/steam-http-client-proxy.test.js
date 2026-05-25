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

function stubHttpsRequest() {
  const https = require("https");
  const originalRequest = https.request;
  const requests = [];

  https.request = (options, callback) => {
    requests.push({...options});
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = {};
      process.nextTick(() => {
        callback(res);
        res.emit("data", Buffer.from(JSON.stringify({success: true}), "utf8"));
        res.emit("end");
      });
    };
    req.on = req.on.bind(req);
    return req;
  };

  return {
    requests,
    restore() {
      https.request = originalRequest;
    }
  };
}

function loadSteamHttpClientFresh() {
  const modulePath = path.resolve(__dirname, "../src/steamHttpClient.js");
  delete require.cache[modulePath];
  return require(modulePath);
}

async function test_steam_get_injects_proxy_agent_when_proxy_configured() {
  const httpsStub = stubHttpsRequest();
  try {
    await withProxyEnv({HTTPS_PROXY: "http://127.0.0.1:8888"}, async () => {
      const {steamGet} = loadSteamHttpClientFresh();
      const result = await steamGet({
        url: "https://steamcommunity.com/market/priceoverview/?appid=730",
        maxRetries: 0
      });

      assert.equal(result.statusCode, 200);
      assert.equal(httpsStub.requests.length, 1);
      assert.ok(httpsStub.requests[0].agent, "steamGet should pass proxy agent to https.request");
    });
  } finally {
    httpsStub.restore();
  }
}

async function test_bad_proxy_config_prevents_https_request() {
  const httpsStub = stubHttpsRequest();
  try {
    await withProxyEnv({HTTPS_PROXY: "http://%"}, async () => {
      const {steamGet} = loadSteamHttpClientFresh();
      const result = await steamGet({
        url: "https://steamcommunity.com/market/priceoverview/?appid=730",
        maxRetries: 0
      });

      assert.equal(result.statusCode, 0);
      assert.match(result.body, /Invalid proxy configuration/);
      assert.equal(httpsStub.requests.length, 0, "bad proxy config should fail before https.request");
    });
  } finally {
    httpsStub.restore();
  }
}

async function main() {
  await test_steam_get_injects_proxy_agent_when_proxy_configured();
  await test_bad_proxy_config_prevents_https_request();
  console.log("steam-http-client-proxy tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
