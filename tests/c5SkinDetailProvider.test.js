const assert = require("node:assert/strict");

const {createC5SkinDetailProvider} = require("../node_sidecar/src/services/c5SkinDetailProvider");

function makeResponse({status = 200, body = "", headers = {}} = {}) {
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

function makeNuxtPage(relatedList) {
  const related = relatedList.map((item) => {
    const fields = Object.entries(item).map(([key, value]) => {
      return `${key}:${JSON.stringify(String(value))}`;
    });
    return `{${fields.join(",")}}`;
  }).join(",");
  return `
    <html>
      <body>
        <script>window.__NUXT__={state:{relatedList:[${related}]}};</script>
      </body>
    </html>
  `;
}

function makeProvider(fetchImpl) {
  return createC5SkinDetailProvider({
    fetchImpl,
    timeoutMs: 50,
    retryLimit: 0
  });
}

async function test_c5_provider_ignores_non_wear_labels_and_computes_range_from_wear_levels() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({
      url,
      userAgent: String((options.headers || {})["User-Agent"] || "")
    });
    if (String(url).includes("/sell")) {
      return makeResponse({
        body: makeNuxtPage([
          {itemId: "normal-1", tag: "普通版", enTag: "Normal"},
          {itemId: "stattrak-1", tag: "暗金", enTag: "StatTrak"},
          {itemId: "souvenir-1", tag: "纪念品", enTag: "Souvenir"},
          {itemId: "fn-1", tag: "崭新出厂", enTag: "Factory New"},
          {itemId: "bs-1", tag: "战痕累累", enTag: "Battle-Scarred"},
          {itemId: "mw-1", tag: "略有磨损", enTag: "Minimal Wear"}
        ])
      });
    }
    if (String(url).includes("/fn-1/")) {
      return makeResponse({
        body: {
          data: [
            {begin: "0.00", end: "0.01"},
            {begin: "0.01", end: "0.07"}
          ]
        }
      });
    }
    if (String(url).includes("/bs-1/")) {
      return makeResponse({
        body: {
          data: [
            {begin: "0.45", end: "0.63"},
            {begin: "0.63", end: "0.83"}
          ]
        }
      });
    }
    throw new Error(`unexpected url: ${url}`);
  };

  const result = await makeProvider(fetchImpl).fetchWearRangeByC5Id("c5-main", {
    familyKey: "ak_47_mo_yan",
    basename: "AK-47 | 墨岩",
    rows: [
      {wearlevel: "Factory New", c5id: "c5-main"},
      {wearlevel: "Battle-Scarred", c5id: "bs-1"}
    ]
  });

  assert.deepEqual(result, {
    minfloat: 0,
    maxfloat: 0.83,
    wear_range: 0.83
  });
  assert.equal(calls.length, 3);
  assert.equal(calls.every((call) => call.userAgent.includes("Mozilla/5.0")), true);
  assert.equal(calls[0].url, "https://www.c5game.com/CSGO/c5-main/AK-47%20%7C%20%E5%A2%A8%E5%B2%A9/sell");
  assert.equal(calls.some((call) => call.url.includes("normal-1")), false);
  assert.equal(calls.some((call) => call.url.includes("stattrak-1")), false);
  assert.equal(calls.some((call) => call.url.includes("souvenir-1")), false);
}

async function test_c5_provider_uses_current_item_range_when_related_list_empty_and_family_has_single_wearlevel() {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/sell")) {
      return makeResponse({body: makeNuxtPage([])});
    }
    if (String(url).includes("/current-c5/")) {
      return makeResponse({
        body: {
          data: [
            {begin: "0.07", end: "0.08"}
          ]
        }
      });
    }
    throw new Error(`unexpected url: ${url}`);
  };

  const result = await makeProvider(fetchImpl).fetchWearRangeByC5Id("current-c5", {
    familyKey: "xm1014_pao_pao_pao",
    basename: "XM1014 | 跑跑跑",
    rows: [
      {wearlevel: "Minimal Wear", c5id: "current-c5"}
    ]
  });

  assert.deepEqual(result, {
    minfloat: 0.07,
    maxfloat: 0.08,
    wear_range: 0.01
  });
  assert.deepEqual(calls, [
    "https://www.c5game.com/CSGO/current-c5/XM1014%20%7C%20%E8%B7%91%E8%B7%91%E8%B7%91/sell",
    "https://api.c5game.com/search/v2/item/current-c5/wear/range"
  ]);
}

async function test_c5_provider_rejects_empty_related_list_when_family_has_multiple_wearlevels() {
  let rangeApiCalled = false;
  const fetchImpl = async (url) => {
    if (String(url).includes("/sell")) {
      return makeResponse({body: makeNuxtPage([])});
    }
    rangeApiCalled = true;
    throw new Error(`range API should not be called for multi-wear empty relatedList: ${url}`);
  };

  await assert.rejects(
    () => makeProvider(fetchImpl).fetchWearRangeByC5Id("current-c5", {
      familyKey: "xm1014_pao_pao_pao",
      basename: "XM1014 | 跑跑跑",
      rows: [
        {wearlevel: "Factory New", c5id: "fn-c5"},
        {wearlevel: "Minimal Wear", c5id: "current-c5"}
      ]
    }),
    /relatedList|wear/i
  );
  assert.equal(rangeApiCalled, false);
}

async function test_c5_provider_rejects_related_list_that_does_not_cover_family_wear_extremes() {
  let rangeApiCalled = false;
  const fetchImpl = async (url) => {
    if (String(url).includes("/sell")) {
      return makeResponse({
        body: makeNuxtPage([
          {itemId: "fn-only", tag: "崭新出厂", enTag: "Factory New"},
          {itemId: "mw-only", tag: "略有磨损", enTag: "Minimal Wear"}
        ])
      });
    }
    rangeApiCalled = true;
    throw new Error(`range API should not be called for partial C5 relatedList: ${url}`);
  };

  await assert.rejects(
    () => makeProvider(fetchImpl).fetchWearRangeByC5Id("c5-partial", {
      familyKey: "ak_47_mo_yan",
      basename: "AK-47 | 墨岩",
      rows: [
        {wearlevel: "Factory New", c5id: "c5-partial"},
        {wearlevel: "Battle-Scarred", c5id: "bs-expected"}
      ]
    }),
    /wear|relatedList|cover|missing|磨损/i
  );
  assert.equal(rangeApiCalled, false);
}

async function test_c5_provider_does_not_build_sell_url_from_internal_family_key_or_c5id() {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    throw new Error("fetch should not be called without a real display name");
  };

  await assert.rejects(
    () => makeProvider(fetchImpl).fetchWearRangeByC5Id("c5-no-name", {
      familyKey: "internal_family_key_only"
    }),
    /name|basename|display/i
  );
  assert.equal(called, false);
}

async function test_c5_provider_throws_when_range_api_data_is_empty() {
  const fetchImpl = async (url) => {
    if (String(url).includes("/sell")) {
      return makeResponse({
        body: makeNuxtPage([
          {itemId: "fn-empty", tag: "崭新出厂", enTag: "Factory New"},
          {itemId: "bs-empty", tag: "战痕累累", enTag: "Battle-Scarred"}
        ])
      });
    }
    return makeResponse({body: {data: []}});
  };

  await assert.rejects(
    () => makeProvider(fetchImpl).fetchWearRangeByC5Id("c5-empty", {
      familyKey: "ak_47_empty_range",
      basename: "AK-47 | 空范围",
      rows: [
        {wearlevel: "Factory New", c5id: "fn-empty"},
        {wearlevel: "Battle-Scarred", c5id: "bs-empty"}
      ]
    }),
    /begin\/end|range/i
  );
}

(async () => {
  await test_c5_provider_ignores_non_wear_labels_and_computes_range_from_wear_levels();
  await test_c5_provider_uses_current_item_range_when_related_list_empty_and_family_has_single_wearlevel();
  await test_c5_provider_rejects_empty_related_list_when_family_has_multiple_wearlevels();
  await test_c5_provider_rejects_related_list_that_does_not_cover_family_wear_extremes();
  await test_c5_provider_does_not_build_sell_url_from_internal_family_key_or_c5id();
  await test_c5_provider_throws_when_range_api_data_is_empty();
  console.log("c5SkinDetailProvider tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
