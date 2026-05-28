const {createBuffSkinDetailProvider} = require("./buffSkinDetailProvider");
const {createC5SkinDetailProvider} = require("./c5SkinDetailProvider");
const {createLocalStaticItemImageProvider} = require("./localStaticItemImageProvider");
const {createSteamCdnSkinImageProvider} = require("./steamCdnSkinImageProvider");

function createSteamFirstSkinDetailProvider({
  buffProvider = null,
  c5Provider = null,
  steamImageProvider = null,
  staticImageProvider = null,
  c5Options = {},
  steamImageOptions = {},
  staticImageOptions = {},
  ...buffOptions
} = {}) {
  const resolvedBuffProvider = buffProvider || createBuffSkinDetailProvider(buffOptions);
  const resolvedC5Provider = c5Provider || createC5SkinDetailProvider({
    ...buffOptions,
    ...c5Options
  });
  const resolvedSteamImageProvider = steamImageProvider || createSteamCdnSkinImageProvider(steamImageOptions);
  const resolvedStaticImageProvider = staticImageProvider || createLocalStaticItemImageProvider(staticImageOptions);

  function hasCompleteWearInfo(value) {
    const minfloat = value && value.minfloat;
    const maxfloat = value && value.maxfloat;
    const wearRange = value && value.wear_range;
    return Number.isFinite(Number(minfloat))
      && Number.isFinite(Number(maxfloat))
      && Number.isFinite(Number(wearRange));
  }

  async function fetchWearRangeByGoodsId(goodsId, context = {}) {
    const c5id = String(context && context.c5id || context && context.representativeC5Id || "").trim();
    let c5Error = null;
    if (c5id && resolvedC5Provider && typeof resolvedC5Provider.fetchWearRangeByC5Id === "function") {
      try {
        const c5WearInfo = await resolvedC5Provider.fetchWearRangeByC5Id(c5id, context);
        if (hasCompleteWearInfo(c5WearInfo)) {
          return c5WearInfo;
        }
        c5Error = new Error("c5 wear range incomplete");
      } catch (error) {
        c5Error = error;
      }
    }
    if (resolvedBuffProvider && typeof resolvedBuffProvider.fetchWearRangeByGoodsId === "function") {
      return resolvedBuffProvider.fetchWearRangeByGoodsId(goodsId, context);
    }
    if (c5Error) {
      throw c5Error;
    }
    throw new Error("wear range provider unavailable");
  }

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
    fetchWearRangeByGoodsId: (
      (resolvedC5Provider && typeof resolvedC5Provider.fetchWearRangeByC5Id === "function")
      || (resolvedBuffProvider && typeof resolvedBuffProvider.fetchWearRangeByGoodsId === "function")
    )
      ? fetchWearRangeByGoodsId
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
