const assert = require("node:assert/strict");
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

function loadModuleWithSteamCommunityStub(moduleRelativePath, instances) {
  const modulePath = path.resolve(__dirname, moduleRelativePath);
  const steamCommunityPath = require.resolve("steamcommunity", {
    paths: [path.resolve(__dirname, "..")]
  });
  const originalModule = require.cache[modulePath];
  const originalSteamCommunity = require.cache[steamCommunityPath];

  delete require.cache[modulePath];
  require.cache[steamCommunityPath] = {
    id: steamCommunityPath,
    filename: steamCommunityPath,
    loaded: true,
    exports: class FakeSteamCommunity {
      constructor(options) {
        this.options = options || {};
        instances.push(this);
      }

      setCookies(cookies) {
        this.cookies = cookies;
      }

      getConfirmations(time, key, callback) {
        callback(null, []);
      }
    }
  };

  return {
    module: require(modulePath),
    restore() {
      delete require.cache[modulePath];
      if (originalModule) {
        require.cache[modulePath] = originalModule;
      }
      if (originalSteamCommunity) {
        require.cache[steamCommunityPath] = originalSteamCommunity;
      } else {
        delete require.cache[steamCommunityPath];
      }
    }
  };
}

async function test_trade_and_market_confirmations_use_http_proxy_request_option() {
  await withProxyEnv({HTTPS_PROXY: "http://127.0.0.1:8888"}, async () => {
    const tradeInstances = [];
    const tradeStub = loadModuleWithSteamCommunityStub("../src/tradeService.js", tradeInstances);
    try {
      const confirmed = await tradeStub.module.confirmTradeOffer({
        cookieString: "steamLoginSecure=76561198000000000%7C%7Ctoken; sessionid=abc",
        steamId64: "76561198000000000",
        identitySecret: "secret",
        tradeofferId: "offer_1"
      });

      assert.equal(confirmed, false);
      assert.equal(tradeInstances.length, 1);
      assert.equal(tradeInstances[0].options.requestProxy, "http://127.0.0.1:8888");
    } finally {
      tradeStub.restore();
    }

    const marketInstances = [];
    const marketStub = loadModuleWithSteamCommunityStub("../src/steamMarketService.js", marketInstances);
    try {
      const confirmations = await marketStub.module.getMarketConfirmations({
        cookieString: "steamLoginSecure=76561198000000000%7C%7Ctoken; sessionid=abc",
        identitySecret: "secret"
      });

      assert.deepEqual(confirmations, []);
      assert.equal(marketInstances.length, 1);
      assert.equal(marketInstances[0].options.requestProxy, "http://127.0.0.1:8888");
    } finally {
      marketStub.restore();
    }
  });
}

async function test_steamcommunity_socks_proxy_rejects_trade_confirmation_before_instance_creation() {
  await withProxyEnv({HTTPS_PROXY: "socks5://127.0.0.1:1080"}, async () => {
    const tradeInstances = [];
    const tradeStub = loadModuleWithSteamCommunityStub("../src/tradeService.js", tradeInstances);
    try {
      await assert.rejects(
        () => tradeStub.module.confirmTradeOffer({
          cookieString: "steamLoginSecure=76561198000000000%7C%7Ctoken; sessionid=abc",
          steamId64: "76561198000000000",
          identitySecret: "secret",
          tradeofferId: "offer_1"
        }),
        /SteamCommunity does not support SOCKS proxy/
      );

      assert.equal(tradeInstances.length, 0);
    } finally {
      tradeStub.restore();
    }
  });
}

async function test_steamcommunity_socks_proxy_rejects_market_confirmation_before_instance_creation() {
  await withProxyEnv({HTTPS_PROXY: "socks5://127.0.0.1:1080"}, async () => {
    const marketInstances = [];
    const marketStub = loadModuleWithSteamCommunityStub("../src/steamMarketService.js", marketInstances);
    try {
      await assert.rejects(
        () => marketStub.module.getMarketConfirmations({
          cookieString: "steamLoginSecure=76561198000000000%7C%7Ctoken; sessionid=abc",
          identitySecret: "secret"
        }),
        /SteamCommunity does not support SOCKS proxy/
      );

      await assert.rejects(
        () => marketStub.module.confirmMarketListings({
          cookieString: "steamLoginSecure=76561198000000000%7C%7Ctoken; sessionid=abc",
          identitySecret: "secret",
          confirmationIds: ["conf_1"]
        }),
        /SteamCommunity does not support SOCKS proxy/
      );

      assert.equal(marketInstances.length, 0);
    } finally {
      marketStub.restore();
    }
  });
}

async function main() {
  await test_trade_and_market_confirmations_use_http_proxy_request_option();
  await test_steamcommunity_socks_proxy_rejects_trade_confirmation_before_instance_creation();
  await test_steamcommunity_socks_proxy_rejects_market_confirmation_before_instance_creation();
  console.log("steam-community-proxy tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
