const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {createLocalStaticItemImageProvider} = require("../node_sidecar/src/services/localStaticItemImageProvider");

function createTempCategoryDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-static-item-image-provider-"));
  fs.writeFileSync(path.join(dir, "stickers.json"), JSON.stringify([
    {
      name: "Sticker | Shooter",
      image: "https://cdn.steamstatic.com/apps/730/icons/econ/stickers/dreamhack/dh_gologo1.hash.png"
    }
  ], null, 2));
  fs.writeFileSync(path.join(dir, "graffiti.json"), JSON.stringify([
    {
      name: "Sealed Graffiti | Blood Boiler",
      image: "https://community.akamai.steamstatic.com/economy/image/example-graffiti"
    }
  ], null, 2));
  fs.writeFileSync(path.join(dir, "tools.json"), JSON.stringify([
    {
      name: "Name Tag",
      image: "https://cdn.steamstatic.com/apps/730/icons/econ/tools/tag.hash.png"
    }
  ], null, 2));
  fs.writeFileSync(path.join(dir, "crates.json"), JSON.stringify([
    {
      name: "Masterminds Music Kit Box",
      image: "https://cdn.steamstatic.com/apps/730/icons/econ/crates/masterminds.hash.png"
    },
    {
      name: "StatTrak™ Masterminds Music Kit Box",
      image: "https://cdn.steamstatic.com/apps/730/icons/econ/crates/masterminds-stattrak.hash.png"
    }
  ], null, 2));
  return dir;
}

async function test_provider_returns_image_for_exact_market_name_from_local_category_cache() {
  const categoryDir = createTempCategoryDir();
  const provider = createLocalStaticItemImageProvider({
    sourceDir: categoryDir
  });

  const result = await provider.fetchGoodsImage({
    marketHashName: "Sticker | Shooter"
  });

  assert.deepEqual(result, {
    goods_icon_url: "https://cdn.steamstatic.com/apps/730/icons/econ/stickers/dreamhack/dh_gologo1.hash.png",
    goods_original_icon_url: "https://cdn.steamstatic.com/apps/730/icons/econ/stickers/dreamhack/dh_gologo1.hash.png",
    goods_share_thumbnail_url: "https://cdn.steamstatic.com/apps/730/icons/econ/stickers/dreamhack/dh_gologo1.hash.png"
  });
}

async function test_provider_can_use_base_market_hash_name_for_non_weapon_items() {
  const categoryDir = createTempCategoryDir();
  const provider = createLocalStaticItemImageProvider({
    sourceDir: categoryDir
  });

  const result = await provider.fetchGoodsImage({
    marketHashName: "Name Tag",
    baseMarketHashName: "Name Tag"
  });

  assert.deepEqual(result, {
    goods_icon_url: "https://cdn.steamstatic.com/apps/730/icons/econ/tools/tag.hash.png",
    goods_original_icon_url: "https://cdn.steamstatic.com/apps/730/icons/econ/tools/tag.hash.png",
    goods_share_thumbnail_url: "https://cdn.steamstatic.com/apps/730/icons/econ/tools/tag.hash.png"
  });
}

async function test_provider_rejects_when_local_category_cache_has_no_match() {
  const categoryDir = createTempCategoryDir();
  const provider = createLocalStaticItemImageProvider({
    sourceDir: categoryDir
  });

  await assert.rejects(
    () => provider.fetchGoodsImage({
      marketHashName: "Patch | Missing"
    }),
    /local static image unavailable/i
  );
}

async function test_provider_keeps_distinct_exact_names_for_display_only_items() {
  const categoryDir = createTempCategoryDir();
  const provider = createLocalStaticItemImageProvider({
    sourceDir: categoryDir
  });

  const normal = await provider.fetchGoodsImage({
    marketHashName: "Masterminds Music Kit Box"
  });
  const stattrak = await provider.fetchGoodsImage({
    marketHashName: "StatTrak™ Masterminds Music Kit Box"
  });

  assert.equal(
    normal.goods_original_icon_url,
    "https://cdn.steamstatic.com/apps/730/icons/econ/crates/masterminds.hash.png"
  );
  assert.equal(
    stattrak.goods_original_icon_url,
    "https://cdn.steamstatic.com/apps/730/icons/econ/crates/masterminds-stattrak.hash.png"
  );
}

async function test_provider_prefers_exact_market_hash_name_over_base_name() {
  const categoryDir = createTempCategoryDir();
  const provider = createLocalStaticItemImageProvider({
    sourceDir: categoryDir
  });

  const result = await provider.fetchGoodsImage({
    marketHashName: "StatTrak™ Masterminds Music Kit Box",
    baseMarketHashName: "Masterminds Music Kit Box",
    familyKey: "Masterminds Music Kit Box"
  });

  assert.equal(
    result.goods_original_icon_url,
    "https://cdn.steamstatic.com/apps/730/icons/econ/crates/masterminds-stattrak.hash.png"
  );
}

(async () => {
  await test_provider_returns_image_for_exact_market_name_from_local_category_cache();
  await test_provider_can_use_base_market_hash_name_for_non_weapon_items();
  await test_provider_rejects_when_local_category_cache_has_no_match();
  await test_provider_keeps_distinct_exact_names_for_display_only_items();
  await test_provider_prefers_exact_market_hash_name_over_base_name();
  console.log("localStaticItemImageProvider tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
