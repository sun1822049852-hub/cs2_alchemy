const assert = require("node:assert/strict");

const {createSteamFirstSkinDetailProvider} = require("../node_sidecar/src/services/steamFirstSkinDetailProvider");

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

(async () => {
  await test_provider_prefers_local_static_image_provider_before_steam();
  await test_provider_falls_back_to_steam_after_local_static_miss();
  console.log("steamFirstSkinDetailProvider tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
