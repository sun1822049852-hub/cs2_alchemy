const assert = require("node:assert/strict");

const {createC5SkinDetailProvider} = require("../node_sidecar/src/services/c5SkinDetailProvider");
const {createSteamFirstSkinDetailProvider} = require("../node_sidecar/src/services/steamFirstSkinDetailProvider");

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
  return `<script>window.__NUXT__={state:{relatedList:[${related}]}};</script>`;
}

async function test_provider_prefers_local_static_image_provider_before_steam() {
  const callOrder = [];
  const provider = createSteamFirstSkinDetailProvider({
    buffProvider: {
      async fetchByGoodsId() {
        throw new Error("not used");
      },
      async fetchWearRangeByGoodsId() {
        throw new Error("not used");
      },
      async fetchGoodsImageByGoodsId() {
        callOrder.push("buff-goods-id-image");
        throw new Error("not used");
      }
    },
    steamImageProvider: {
      async fetchGoodsImage() {
        callOrder.push("steam");
        return {
          goods_icon_url: "https://steam.example/sticker-shooter.png",
          goods_original_icon_url: "https://steam.example/sticker-shooter.png",
          goods_share_thumbnail_url: "https://steam.example/sticker-shooter.png"
        };
      }
    },
    staticImageProvider: {
      async fetchGoodsImage(context = {}) {
        callOrder.push(`static:${String(context.marketHashName || "")}`);
        return {
          goods_icon_url: "https://static.example/sticker-shooter.png",
          goods_original_icon_url: "https://static.example/sticker-shooter.png",
          goods_share_thumbnail_url: "https://static.example/sticker-shooter.png"
        };
      }
    }
  });

  const result = await provider.fetchGoodsImage({
    marketHashName: "Sticker | Shooter"
  });

  assert.deepEqual(callOrder, [
    "static:Sticker | Shooter"
  ]);
  assert.deepEqual(result, {
    goods_icon_url: "https://static.example/sticker-shooter.png",
    goods_original_icon_url: "https://static.example/sticker-shooter.png",
    goods_share_thumbnail_url: "https://static.example/sticker-shooter.png"
  });
}

async function test_provider_falls_back_to_steam_after_local_static_miss() {
  const callOrder = [];
  const provider = createSteamFirstSkinDetailProvider({
    buffProvider: {
      async fetchByGoodsId() {
        throw new Error("not used");
      },
      async fetchWearRangeByGoodsId() {
        throw new Error("not used");
      },
      async fetchGoodsImageByGoodsId() {
        callOrder.push("buff-goods-id-image");
        throw new Error("not used");
      }
    },
    steamImageProvider: {
      async fetchGoodsImage(context = {}) {
        callOrder.push(`steam:${String(context.marketHashName || "")}`);
        return {
          goods_icon_url: "https://steam.example/ak-blue-laminate.png",
          goods_original_icon_url: "https://steam.example/ak-blue-laminate.png",
          goods_share_thumbnail_url: "https://steam.example/ak-blue-laminate.png"
        };
      }
    },
    staticImageProvider: {
      async fetchGoodsImage(context = {}) {
        callOrder.push(`static:${String(context.marketHashName || "")}`);
        throw new Error("local static image unavailable");
      }
    }
  });

  const result = await provider.fetchGoodsImage({
    marketHashName: "AK-47 | Blue Laminate (Factory New)",
    baseMarketHashName: "AK-47 | Blue Laminate"
  });

  assert.deepEqual(callOrder, [
    "static:AK-47 | Blue Laminate (Factory New)",
    "steam:AK-47 | Blue Laminate (Factory New)"
  ]);
  assert.deepEqual(result, {
    goods_icon_url: "https://steam.example/ak-blue-laminate.png",
    goods_original_icon_url: "https://steam.example/ak-blue-laminate.png",
    goods_share_thumbnail_url: "https://steam.example/ak-blue-laminate.png"
  });
}

async function test_provider_prefers_c5_wear_before_buff_when_c5_has_complete_range() {
  const callOrder = [];
  const provider = createSteamFirstSkinDetailProvider({
    c5Provider: {
      async fetchWearRangeByC5Id(c5id, context = {}) {
        callOrder.push(`c5:${String(c5id)}:${String(context.familyKey || "")}`);
        return {
          minfloat: 0.02,
          maxfloat: 0.56,
          wear_range: 0.54
        };
      }
    },
    buffProvider: {
      async fetchByGoodsId() {
        throw new Error("not used");
      },
      async fetchWearRangeByGoodsId() {
        callOrder.push("buff");
        throw new Error("BUFF should not be called when C5 has a complete range");
      },
      async fetchGoodsImageByGoodsId() {
        throw new Error("not used");
      }
    },
    steamImageProvider: null,
    staticImageProvider: null
  });

  const result = await provider.fetchWearRangeByGoodsId("buff-701", {
    familyKey: "ak_47_slate",
    c5id: "c5-701"
  });

  assert.deepEqual(callOrder, [
    "c5:c5-701:ak_47_slate"
  ]);
  assert.deepEqual(result, {
    minfloat: 0.02,
    maxfloat: 0.56,
    wear_range: 0.54
  });
}

async function test_provider_falls_back_to_buff_wear_when_c5_fails() {
  const callOrder = [];
  const provider = createSteamFirstSkinDetailProvider({
    c5Provider: {
      async fetchWearRangeByC5Id(c5id) {
        callOrder.push(`c5:${String(c5id)}`);
        throw new Error("c5 range unavailable");
      }
    },
    buffProvider: {
      async fetchByGoodsId() {
        throw new Error("not used");
      },
      async fetchWearRangeByGoodsId(goodsId, context = {}) {
        callOrder.push(`buff:${String(goodsId)}:${String(context.familyKey || "")}`);
        return {
          minfloat: 0,
          maxfloat: 1,
          wear_range: 1
        };
      },
      async fetchGoodsImageByGoodsId() {
        throw new Error("not used");
      }
    },
    steamImageProvider: null,
    staticImageProvider: null
  });

  const result = await provider.fetchWearRangeByGoodsId("buff-801", {
    familyKey: "awp_asiimov",
    c5id: "c5-801"
  });

  assert.deepEqual(callOrder, [
    "c5:c5-801",
    "buff:buff-801:awp_asiimov"
  ]);
  assert.deepEqual(result, {
    minfloat: 0,
    maxfloat: 1,
    wear_range: 1
  });
}

async function test_provider_falls_back_to_buff_when_c5_related_list_is_partial() {
  const callOrder = [];
  const c5FetchImpl = async (url) => {
    if (String(url).includes("/sell")) {
      callOrder.push("c5:sell");
      return makeResponse({
        body: makeNuxtPage([
          {itemId: "fn-only", tag: "崭新出厂", enTag: "Factory New"},
          {itemId: "mw-only", tag: "略有磨损", enTag: "Minimal Wear"}
        ])
      });
    }
    callOrder.push(`c5:range:${String(url)}`);
    throw new Error(`C5 range API should not be called for partial relatedList: ${url}`);
  };
  const provider = createSteamFirstSkinDetailProvider({
    c5Provider: createC5SkinDetailProvider({
      fetchImpl: c5FetchImpl,
      timeoutMs: 50,
      retryLimit: 0
    }),
    buffProvider: {
      async fetchByGoodsId() {
        throw new Error("not used");
      },
      async fetchWearRangeByGoodsId(goodsId, context = {}) {
        callOrder.push(`buff:${String(goodsId)}:${String(context.familyKey || "")}`);
        return {
          minfloat: 0,
          maxfloat: 1,
          wear_range: 1
        };
      },
      async fetchGoodsImageByGoodsId() {
        throw new Error("not used");
      }
    },
    steamImageProvider: null,
    staticImageProvider: null
  });

  const result = await provider.fetchWearRangeByGoodsId("buff-901", {
    familyKey: "ak_47_mo_yan",
    basename: "AK-47 | 墨岩",
    c5id: "c5-901",
    rows: [
      {wearlevel: "Factory New", c5id: "c5-901"},
      {wearlevel: "Battle-Scarred", c5id: "c5-902"}
    ]
  });

  assert.deepEqual(callOrder, [
    "c5:sell",
    "buff:buff-901:ak_47_mo_yan"
  ]);
  assert.deepEqual(result, {
    minfloat: 0,
    maxfloat: 1,
    wear_range: 1
  });
}

(async () => {
  await test_provider_prefers_local_static_image_provider_before_steam();
  await test_provider_falls_back_to_steam_after_local_static_miss();
  await test_provider_prefers_c5_wear_before_buff_when_c5_has_complete_range();
  await test_provider_falls_back_to_buff_wear_when_c5_fails();
  await test_provider_falls_back_to_buff_when_c5_related_list_is_partial();
  console.log("steamFirstSkinDetailProvider tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
