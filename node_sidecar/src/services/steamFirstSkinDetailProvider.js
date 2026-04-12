const {createBuffSkinDetailProvider} = require("./buffSkinDetailProvider");
const {createLocalStaticItemImageProvider} = require("./localStaticItemImageProvider");
const {createSteamCdnSkinImageProvider} = require("./steamCdnSkinImageProvider");

function createSteamFirstSkinDetailProvider({
  buffProvider = null,
  steamImageProvider = null,
  staticImageProvider = null,
  steamImageOptions = {},
  staticImageOptions = {},
  ...buffOptions
} = {}) {
  const resolvedBuffProvider = buffProvider || createBuffSkinDetailProvider(buffOptions);
  const resolvedSteamImageProvider = steamImageProvider || createSteamCdnSkinImageProvider(steamImageOptions);
  const resolvedStaticImageProvider = staticImageProvider || createLocalStaticItemImageProvider(staticImageOptions);

  async function fetchGoodsImage(context = {}) {
    const errors = [];
    if (resolvedStaticImageProvider && typeof resolvedStaticImageProvider.fetchGoodsImage === "function") {
      try {
        return await resolvedStaticImageProvider.fetchGoodsImage(context);
      } catch (error) {
        errors.push(error);
      }
    }
    if (resolvedSteamImageProvider && typeof resolvedSteamImageProvider.fetchGoodsImage === "function") {
      try {
        return await resolvedSteamImageProvider.fetchGoodsImage(context);
      } catch (error) {
        errors.push(error);
      }
    }
    throw errors[errors.length - 1] || new Error("image unavailable");
  }

  return {
    fetchByGoodsId: typeof resolvedBuffProvider.fetchByGoodsId === "function"
      ? resolvedBuffProvider.fetchByGoodsId.bind(resolvedBuffProvider)
      : undefined,
    fetchWearRangeByGoodsId: typeof resolvedBuffProvider.fetchWearRangeByGoodsId === "function"
      ? resolvedBuffProvider.fetchWearRangeByGoodsId.bind(resolvedBuffProvider)
      : undefined,
    fetchGoodsImage: (
      (resolvedSteamImageProvider && typeof resolvedSteamImageProvider.fetchGoodsImage === "function")
      || (resolvedStaticImageProvider && typeof resolvedStaticImageProvider.fetchGoodsImage === "function")
    )
      ? fetchGoodsImage
      : undefined,
    fetchGoodsImageByGoodsId: typeof resolvedBuffProvider.fetchGoodsImageByGoodsId === "function"
      ? resolvedBuffProvider.fetchGoodsImageByGoodsId.bind(resolvedBuffProvider)
      : undefined
  };
}

module.exports = {
  createSteamFirstSkinDetailProvider
};
