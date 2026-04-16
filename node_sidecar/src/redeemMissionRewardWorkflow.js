const {AccountStore} = require("./accountStore");
const {TokenStore} = require("./tokenStore");
const {CS2Session} = require("./cs2Session");
const {asString} = require("./utils");
const {redeemMissionRewardWithSteam} = require("./services/weaponArmoryService");

async function redeemMissionRewardDebug({
  accountName,
  campaignId,
  redeemId,
  redeemableBalance,
  expectedCost,
  bidControl = 0,
  ackTracks = false,
  ackWaitMs = 500,
  waitMs = 8000,
  logger
}) {
  const accounts = new AccountStore();
  const active = accountName ? accounts.get(accountName) : accounts.getActive();
  if (!active) {
    throw new Error(`account not found: ${accountName || "(active)"}`);
  }

  const resolvedAccount = active.username;
  const password = asString(active.password || "").trim();
  const tokenStore = new TokenStore();
  const refreshToken = tokenStore.get(resolvedAccount);
  if (!refreshToken && !password) {
    throw new Error(`password missing: ${resolvedAccount}`);
  }

  const session = new CS2Session({logger, tokenStore});
  try {
    const {steam} = await session.connect({
      username: resolvedAccount,
      password,
      refreshToken
    });

    return redeemMissionRewardWithSteam({
      steam,
      accountName: resolvedAccount,
      campaignId,
      redeemId,
      redeemableBalance,
      expectedCost,
      bidControl,
      ackTracks,
      ackWaitMs,
      waitMs,
      logger
    });
  } finally {
    session.disconnect();
  }
}

module.exports = {
  redeemMissionRewardDebug
};
