const assert = require("node:assert/strict");
const path = require("node:path");

const { enhanceCookieString } = require("../src/steamHttpClient");

function loadSteamAccountToolsWithHttpClientStub(stubExports) {
  const modulePath = path.resolve(__dirname, "../src/steamAccountTools.js");
  const httpClientPath = path.resolve(__dirname, "../src/steamHttpClient.js");
  const originalHttpClient = require.cache[httpClientPath];

  delete require.cache[modulePath];
  require.cache[httpClientPath] = {
    id: httpClientPath,
    filename: httpClientPath,
    loaded: true,
    exports: stubExports
  };

  try {
    return require(modulePath);
  } finally {
    delete require.cache[modulePath];
    if (originalHttpClient) {
      require.cache[httpClientPath] = originalHttpClient;
    } else {
      delete require.cache[httpClientPath];
    }
  }
}

function test_enhance_cookie_string_injects_sessionid_when_missing() {
  const result = enhanceCookieString(
    "steamLoginSecure=76561197960265729%7C%7Cheader.payload.sig",
    { steamId64: "76561197960265729", domain: "community" }
  );

  assert.match(
    result,
    /(?:^|;\s)sessionid=[0-9a-f]{24}(?:;|$)/,
    "enhanceCookieString should inject a random sessionid when the source cookie does not have one"
  );
}

async function test_fetch_trade_url_uses_access_token_fallback_before_giving_up() {
  const requests = [];
  const { fetchTradeUrl } = loadSteamAccountToolsWithHttpClientStub({
    enhanceCookieString(cookieString) {
      return cookieString;
    },
    buildSteamHeaders({ cookieString }) {
      return { Cookie: cookieString };
    },
    async steamGet({ url, headers }) {
      requests.push({ url, headers });
      if (url.includes("GetTradeOfferAccessToken")) {
        return {
          json: {
            response: {
              trade_offer_access_token: "open_source_token"
            }
          },
          body: ""
        };
      }
      if (url.includes("/tradeoffers/privacy")) {
        return {
          json: null,
          body: "<html><body>no trade url here</body></html>"
        };
      }
      throw new Error(`unexpected url: ${url}`);
    }
  });

  const result = await fetchTradeUrl({
    cookieString: "sessionid=abc123; steamLoginSecure=76561197960265729%7C%7Cheader.payload.sig",
    steamId64: "76561197960265729"
  });

  assert.equal(result.success, true);
  assert.equal(
    result.tradeUrl,
    "https://steamcommunity.com/tradeoffer/new/?partner=1&token=open_source_token"
  );
  assert.equal(
    requests.some((entry) => entry.url.includes("GetTradeOfferAccessToken")),
    true,
    "fetchTradeUrl should try the official trade-offer token API when steamLoginSecure contains an access token"
  );
}

async function main() {
  test_enhance_cookie_string_injects_sessionid_when_missing();
  await test_fetch_trade_url_uses_access_token_fallback_before_giving_up();
  console.log("steam-web-alignment tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
