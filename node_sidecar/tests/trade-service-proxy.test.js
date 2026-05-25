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
    const req = new EventEmitter();
    req.body = "";
    req.write = (chunk) => {
      req.body += String(chunk || "");
    };
    req.end = () => {
      requests.push({
        options: {...options},
        body: req.body
      });
      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = {};
      process.nextTick(() => {
        callback(res);
        if (String(options.path || "").includes("/new/send")) {
          res.emit("data", JSON.stringify({tradeofferid: "offer_1"}));
        } else {
          res.emit("data", "ok");
        }
        res.emit("end");
      });
    };
    req.destroy = () => {};
    return req;
  };

  return {
    requests,
    restore() {
      https.request = originalRequest;
    }
  };
}

function loadTradeServiceFresh() {
  const modulePath = path.resolve(__dirname, "../src/tradeService.js");
  delete require.cache[modulePath];
  return require(modulePath);
}

async function test_direct_trade_requests_inject_proxy_agent_when_configured() {
  const httpsStub = stubHttpsRequest();

  try {
    await withProxyEnv({HTTPS_PROXY: "http://127.0.0.1:8888"}, async () => {
      const {
        sendTradeOffer,
        acceptTradeOffer,
        cancelTradeOffer
      } = loadTradeServiceFresh();

      const sent = await sendTradeOffer({
        cookieString: "sessionid=abc; steamLoginSecure=fake",
        sessionid: "abc",
        partnerSteamId64: "76561198000000001",
        partnerId: "123",
        tradeToken: "token",
        assetIds: ["asset_1"],
        message: ""
      });
      const accepted = await acceptTradeOffer({
        cookieString: "sessionid=abc; steamLoginSecure=fake",
        sessionid: "abc",
        tradeofferId: "offer_1",
        partnerSteamId64: "76561198000000001"
      });
      const cancelled = await cancelTradeOffer({
        cookieString: "sessionid=abc; steamLoginSecure=fake",
        sessionid: "abc",
        tradeofferId: "offer_1"
      });

      assert.deepEqual(sent, {tradeofferid: "offer_1"});
      assert.equal(accepted, true);
      assert.equal(cancelled, true);
      assert.equal(httpsStub.requests.length, 3);
      for (const request of httpsStub.requests) {
        assert.ok(request.options.agent, `expected proxy agent for ${request.options.path}`);
      }
    });
  } finally {
    httpsStub.restore();
  }
}

async function main() {
  await test_direct_trade_requests_inject_proxy_agent_when_configured();
  console.log("trade-service-proxy tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
