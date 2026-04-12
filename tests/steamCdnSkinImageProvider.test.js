const assert = require("node:assert/strict");

const {createSteamCdnSkinImageProvider} = require("../node_sidecar/src/services/steamCdnSkinImageProvider");

async function test_provider_builds_steam_image_url_from_items_game_and_english() {
  const provider = createSteamCdnSkinImageProvider({
    itemsGameText: `
      "set_esports"
      {
        "items"
        {
          "[hy_ak47lam]weapon_ak47" "1"
          "[hy_blam_simple]weapon_awp" "1"
        }
      }
    `,
    englishText: `
      "PaintKit_hy_ak47lam_Tag" "Blue Laminate"
      "PaintKit_hy_blam_simple_Tag" "Pit Viper"
    `
  });

  const result = await provider.fetchGoodsImage({
    marketHashName: "AK-47 | Blue Laminate (Factory New)",
    baseMarketHashName: "AK-47 | Blue Laminate"
  });

  assert.deepEqual(result, {
    goods_icon_url: "https://community.akamai.steamstatic.com/economy/image/econ/default_generated/weapon_ak47_hy_ak47lam_light_large",
    goods_original_icon_url: "https://community.akamai.steamstatic.com/economy/image/econ/default_generated/weapon_ak47_hy_ak47lam_light_large",
    goods_share_thumbnail_url: "https://community.akamai.steamstatic.com/economy/image/econ/default_generated/weapon_ak47_hy_ak47lam_light_large"
  });
}

async function test_provider_rejects_when_market_hash_has_no_steam_icon_mapping() {
  const provider = createSteamCdnSkinImageProvider({
    itemsGameText: `
      "set_esports"
      {
        "items"
        {
          "[hy_ak47lam]weapon_ak47" "1"
        }
      }
    `,
    englishText: `
      "PaintKit_hy_ak47lam_Tag" "Blue Laminate"
    `
  });

  await assert.rejects(
    () => provider.fetchGoodsImage({
      marketHashName: "AWP | Pit Viper (Minimal Wear)",
      baseMarketHashName: "AWP | Pit Viper"
    }),
    /steam icon path unavailable/i
  );
}

(async () => {
  await test_provider_builds_steam_image_url_from_items_game_and_english();
  await test_provider_rejects_when_market_hash_has_no_steam_icon_mapping();
  console.log("steamCdnSkinImageProvider tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
