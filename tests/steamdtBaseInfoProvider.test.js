const assert = require("node:assert/strict");

const {createSteamdtBaseInfoProvider} = require("../node_sidecar/src/services/steamdtBaseInfoProvider");

function makeResponse({status = 200, body = {}, headers = {}} = {}) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return normalizedHeaders.get(String(name).toLowerCase()) || null;
      }
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
    async json() {
      return typeof body === "string" ? JSON.parse(body) : body;
    }
  };
}

async function test_provider_fetches_base_info_list() {
  const calls = [];
  const provider = createSteamdtBaseInfoProvider({
    apiKey: "test-key",
    fetchImpl: async (url, options = {}) => {
      calls.push({
        url: String(url),
        headers: options.headers || {}
      });
      return makeResponse({
        body: {
          success: true,
          data: {
            list: [
              {name: "AK-47 | Redline (Field-Tested)"},
              {name: "AWP | Asiimov (Battle-Scarred)"}
            ]
          }
        }
      });
    }
  });

  const result = await provider.fetchBaseInfo();

  assert.deepEqual(result, [
    {name: "AK-47 | Redline (Field-Tested)"},
    {name: "AWP | Asiimov (Battle-Scarred)"}
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://open.steamdt.com/open/cs2/v1/base");
  assert.equal(calls[0].headers.Authorization, "Bearer test-key");
}

async function test_provider_rejects_on_http_error() {
  const provider = createSteamdtBaseInfoProvider({
    apiKey: "test-key",
    fetchImpl: async () => makeResponse({
      status: 502,
      body: {success: false, errorMsg: "bad gateway"}
    })
  });

  await assert.rejects(() => provider.fetchBaseInfo(), /http=502/i);
}

async function test_provider_rejects_on_invalid_payload() {
  const provider = createSteamdtBaseInfoProvider({
    apiKey: "test-key",
    fetchImpl: async () => makeResponse({
      body: {
        success: false,
        errorMsg: "empty"
      }
    })
  });

  await assert.rejects(() => provider.fetchBaseInfo(), /empty|invalid/i);
}

(async () => {
  await test_provider_fetches_base_info_list();
  await test_provider_rejects_on_http_error();
  await test_provider_rejects_on_invalid_payload();
  console.log("steamdtBaseInfoProvider tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
