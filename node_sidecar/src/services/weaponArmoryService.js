const Language = require("globaloffensive/language.js");
const GcProtos = require("globaloffensive/protobufs/generated/_load.js");
const {AccountStore} = require("../accountStore");
const {TokenStore} = require("../tokenStore");
const {asString} = require("../utils");
const {sendRedeemMissionReward} = require("../redeemMissionReward");
const {
  XP_SHOP_ACK_TRACKS_MSG_TYPE,
  XP_SHOP_NOTIFY_MSG_TYPE,
  decodeNotifyXpShopPayload,
  sendAckXpShopTracks
} = require("../xpShopMessages");
const {observeGcArmoryState, readGcArmoryState, readGcTraceMessages} = require("../gcTrace");
const {cloneCatalogEntry, findCatalogEntry, loadLocalXpShopCatalog} = require("../xpShopCatalog");

const GC_MSG_NAME_BY_ID = new Map([
  ...Object.entries(Language).map(([name, id]) => [Number(id), name]),
  [XP_SHOP_NOTIFY_MSG_TYPE, "GC2ClientNotifyXPShop"],
  [XP_SHOP_ACK_TRACKS_MSG_TYPE, "Client2GcAckXPShopTracks"]
]);

function badRequest(message, code = "bad_request") {
  const err = new Error(message);
  err.code = code;
  return err;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function summarizeGcMessage(msgType, payload) {
  const numericMsgType = Number(msgType);
  const buffer = Buffer.isBuffer(payload)
    ? payload
    : payload instanceof Uint8Array
      ? Buffer.from(payload)
      : null;
  const summary = {
    msg_type: numericMsgType,
    msg_name: GC_MSG_NAME_BY_ID.get(numericMsgType) || `msg_${numericMsgType}`,
    bytes: buffer ? buffer.length : 0
  };

  if (numericMsgType === XP_SHOP_NOTIFY_MSG_TYPE && buffer) {
    const decoded = decodeNotifyXpShopPayload(buffer);
    if (decoded) {
      summary.notify = decoded;
    }
  }

  if (numericMsgType === Language.SO_Create && buffer) {
    const soCreateItem = decodeSoCreateItem(buffer);
    if (soCreateItem) {
      summary.so_create_item = soCreateItem;
    }
  }

  return summary;
}

function cloneJson(value, fallback) {
  if (value == null) {
    return fallback;
  }
  return JSON.parse(JSON.stringify(value));
}

function decodeProtoToObject(proto, payload) {
  if (!proto || !payload) {
    return null;
  }
  const decoded = proto.decode(payload);
  return proto.toObject(decoded, {
    defaults: true,
    longs: String
  });
}

function normalizeSoCreateItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  return {
    id: asString(item.id).trim(),
    account_id: Number(item.account_id || 0),
    inventory: Number(item.inventory || 0),
    def_index: Number(item.def_index || 0),
    quantity: Number(item.quantity || 0),
    level: Number(item.level || 0),
    quality: Number(item.quality || 0),
    flags: Number(item.flags || 0),
    origin: Number(item.origin || 0),
    rarity: Number(item.rarity || 0)
  };
}

function decodeSoCreateItem(payload) {
  try {
    const envelope = decodeProtoToObject(GcProtos.CMsgSOSingleObject, payload);
    if (!envelope || Number(envelope.type_id || 0) !== 1 || !envelope.object_data) {
      return null;
    }
    const item = decodeProtoToObject(GcProtos.CSOEconItem, envelope.object_data);
    return normalizeSoCreateItem(item);
  } catch (_) {
    return null;
  }
}

function hasNumericValue(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string" && !value.trim()) {
    return false;
  }
  return Number.isFinite(Number(value));
}

function readBalanceFromState(state) {
  if (!state || typeof state !== "object") {
    return null;
  }
  const directCandidates = [
    state.notify && state.notify.postmatch && state.notify.postmatch.redeemable_balance,
    state.notify && state.notify.prematch && state.notify.prematch.redeemable_balance,
    state.seasonal_operation && state.seasonal_operation.redeemable_balance,
    state.xp_shop && state.xp_shop.redeemable_balance
  ];
  for (const candidate of directCandidates) {
    if (hasNumericValue(candidate)) {
      return Number(candidate);
    }
  }
  return null;
}

function normalizeBids(state) {
  return Array.isArray(state && state.xp_shop_bids)
    ? state.xp_shop_bids
      .map((entry) => ({
        campaign_id: Number(entry && entry.campaign_id || 0),
        redeem_id: Number(entry && entry.redeem_id || 0),
        expected_cost: Number(entry && entry.expected_cost || 0),
        generation_time: Number(entry && entry.generation_time || 0)
      }))
      .filter((entry) => entry.campaign_id > 0 && entry.expected_cost > 0)
    : [];
}

function buildArmoryOptions(state, catalog) {
  const redeemableBalance = readBalanceFromState(state);
  return normalizeBids(state).map((entry) => {
    const normalizedBalance = hasNumericValue(redeemableBalance) ? Number(redeemableBalance) : null;
    const balanceAfterRedeem = normalizedBalance == null
      ? null
      : normalizedBalance - Number(entry.expected_cost || 0);
    const schema = findCatalogEntry(catalog, entry.campaign_id, entry.redeem_id);
    return {
      campaign_id: Number(entry.campaign_id || 0),
      redeem_id: Number(entry.redeem_id || 0),
      expected_cost: Number(entry.expected_cost || 0),
      generation_time: Number(entry.generation_time || 0),
      redeemable_balance: normalizedBalance,
      balance_after_redeem: balanceAfterRedeem,
      affordable: balanceAfterRedeem == null ? null : balanceAfterRedeem >= 0,
      ...(schema ? {schema: cloneCatalogEntry(schema)} : {})
    };
  });
}

function buildArmoryInspectPayload(state, accountName = "") {
  const catalog = loadLocalXpShopCatalog();
  return {
    ok: true,
    account: asString(accountName).trim(),
    updated_at: asString(state && state.updated_at || "").trim(),
    redeemable_balance: hasNumericValue(readBalanceFromState(state)) ? Number(readBalanceFromState(state)) : null,
    options: buildArmoryOptions(state, catalog),
    catalog: Array.isArray(catalog && catalog.entries)
      ? catalog.entries.map((entry) => cloneCatalogEntry(entry))
      : [],
    catalog_source: catalog
      ? {
        loaded: Boolean(catalog.loaded),
        ...cloneJson(catalog.source, {})
      }
      : null,
    armory_state: cloneJson(state, {})
  };
}

function findMatchingBid(state, {campaignId, redeemId, expectedCost} = {}) {
  let bids = normalizeBids(state);
  if (hasNumericValue(campaignId)) {
    bids = bids.filter((entry) => entry.campaign_id === Number(campaignId));
  }
  if (hasNumericValue(redeemId)) {
    bids = bids.filter((entry) => entry.redeem_id === Number(redeemId));
  }
  if (hasNumericValue(expectedCost)) {
    bids = bids.filter((entry) => entry.expected_cost === Number(expectedCost));
  }
  if (!bids.length) {
    return null;
  }
  if (bids.length === 1) {
    return bids[0];
  }
  throw badRequest("检测到多个可兑换武库条目，请显式提供 campaign_id / redeem_id", "armory_bid_ambiguous");
}

function resolveRedeemRequest({
  state,
  campaignId,
  redeemId,
  redeemableBalance,
  expectedCost,
  bidControl = 0
}) {
  const matchedBid = findMatchingBid(state, {campaignId, redeemId, expectedCost});
  const fallbackBalance = readBalanceFromState(state);
  const resolved = {
    campaign_id: hasNumericValue(campaignId) ? Number(campaignId) : Number(matchedBid && matchedBid.campaign_id || 0),
    redeem_id: hasNumericValue(redeemId) ? Number(redeemId) : Number(matchedBid && matchedBid.redeem_id || 0),
    redeemable_balance: hasNumericValue(redeemableBalance)
      ? Number(redeemableBalance)
      : Number(fallbackBalance),
    expected_cost: hasNumericValue(expectedCost)
      ? Number(expectedCost)
      : Number(matchedBid && matchedBid.expected_cost || 0),
    bid_control: hasNumericValue(bidControl) ? Number(bidControl) : 0
  };

  if (!Number.isInteger(resolved.campaign_id) || resolved.campaign_id <= 0) {
    throw badRequest("缺少有效的 campaign_id，当前会话没有可用武库状态", "armory_state_unavailable");
  }
  if (!Number.isInteger(resolved.redeem_id) || resolved.redeem_id < 0) {
    throw badRequest("缺少有效的 redeem_id，当前会话没有可用武库状态", "armory_state_unavailable");
  }
  if (!Number.isInteger(resolved.redeemable_balance) || resolved.redeemable_balance < 0) {
    throw badRequest("缺少有效的 redeemable_balance，当前会话没有可用武库余额", "armory_state_unavailable");
  }
  if (!Number.isInteger(resolved.expected_cost) || resolved.expected_cost <= 0) {
    throw badRequest("缺少有效的 expected_cost，当前会话没有可用武库价格", "armory_state_unavailable");
  }
  if (!Number.isInteger(resolved.bid_control) || resolved.bid_control < 0) {
    throw badRequest("bid_control 必须 >= 0");
  }

  return resolved;
}

function findBidSnapshot(state, resolved) {
  const campaignId = Number(resolved && resolved.campaign_id || 0);
  const redeemId = Number(resolved && resolved.redeem_id || 0);
  return normalizeBids(state).find((entry) => entry.campaign_id === campaignId && entry.redeem_id === redeemId) || null;
}

function buildSuccessEvidence(beforeState, afterState, resolved) {
  const beforeBalance = readBalanceFromState(beforeState);
  const afterBalance = readBalanceFromState(afterState);
  const matchedBidBefore = findBidSnapshot(beforeState, resolved);
  const matchedBidAfter = findBidSnapshot(afterState, resolved);
  const itemCustomization = afterState
    && afterState.last_item_customization
    && Number(afterState.last_item_customization.request || 0) === Language.ClientRedeemMissionReward
      ? cloneJson(afterState.last_item_customization, null)
      : null;
  const hasBalanceDrop = hasNumericValue(beforeBalance) && hasNumericValue(afterBalance)
    && Number(afterBalance) < Number(beforeBalance);
  const bidRemoved = Boolean(matchedBidBefore && !matchedBidAfter);
  const successKind = itemCustomization
    ? "item_customization"
    : (bidRemoved ? "bid_removed" : (hasBalanceDrop ? "balance_drop" : ""));

  const success = Boolean(successKind);

  return {
    success,
    success_kind: successKind,
    evidence: {
      item_customization: itemCustomization,
      balance_before: hasNumericValue(beforeBalance) ? Number(beforeBalance) : null,
      balance_after: hasNumericValue(afterBalance) ? Number(afterBalance) : null,
      matched_bid_before: matchedBidBefore ? cloneJson(matchedBidBefore, null) : null,
      matched_bid_after: matchedBidAfter ? cloneJson(matchedBidAfter, null) : null,
      notify: afterState && afterState.notify ? cloneJson(afterState.notify, null) : null
    }
  };
}

function inferSuccessKindFromEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") {
    return "";
  }
  if (evidence.so_create_item) {
    return "so_create_item";
  }
  if (evidence.item_customization) {
    return "item_customization";
  }
  if (evidence.matched_bid_before && !evidence.matched_bid_after) {
    return "bid_removed";
  }
  const beforeBalance = Number(evidence.balance_before);
  const afterBalance = Number(evidence.balance_after);
  if (Number.isFinite(beforeBalance) && Number.isFinite(afterBalance) && afterBalance < beforeBalance) {
    return "balance_drop";
  }
  return "";
}

function mergeRedemptionEvidence(baseEvidence, observedGcMessages) {
  const soCreateMessage = Array.isArray(observedGcMessages)
    ? observedGcMessages.find((entry) => entry && entry.so_create_item)
    : null;
  const soCreateItem = soCreateMessage ? cloneJson(soCreateMessage.so_create_item, null) : null;
  const evidence = {
    ...(cloneJson(baseEvidence, {}) || {}),
    so_create_item: soCreateItem
  };
  const successKind = inferSuccessKindFromEvidence(evidence);
  return {
    success: Boolean(successKind),
    success_kind: successKind,
    evidence
  };
}

async function waitForRedemptionEvidence({steam, beforeState, resolved, waitMs = 8000}) {
  const initialState = readGcArmoryState(steam);
  const initialOutcome = buildSuccessEvidence(beforeState, initialState, resolved);
  if (initialOutcome.success && initialOutcome.success_kind !== "balance_drop") {
    return {
      success: true,
      state: initialState,
      evidence: initialOutcome.evidence
    };
  }
  let bestSuccess = initialOutcome.success
    ? {
      state: initialState,
      evidence: initialOutcome.evidence,
      successKind: initialOutcome.success_kind
    }
    : null;

  const timeout = Math.max(100, Number(waitMs) || 8000);
  return new Promise((resolve) => {
    let done = false;
    const finish = (success, state, evidence) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve({success, state, evidence});
    };
    const unsubscribe = observeGcArmoryState(steam, (state) => {
      const outcome = buildSuccessEvidence(beforeState, state, resolved);
      if (!outcome.success) {
        return;
      }
      if (!bestSuccess || bestSuccess.successKind === "balance_drop") {
        bestSuccess = {
          state,
          evidence: outcome.evidence,
          successKind: outcome.success_kind
        };
      }
      if (outcome.success_kind !== "balance_drop") {
        finish(true, state, outcome.evidence);
      }
    });
    const timer = setTimeout(() => {
      if (bestSuccess) {
        finish(true, bestSuccess.state, bestSuccess.evidence);
        return;
      }
      const state = readGcArmoryState(steam);
      const outcome = buildSuccessEvidence(beforeState, state, resolved);
      finish(false, state, outcome.evidence);
    }, timeout);
  });
}

async function redeemMissionRewardWithSteam({
  steam,
  accountName = "",
  campaignId,
  redeemId,
  redeemableBalance,
  expectedCost,
  bidControl = 0,
  ackTracks = false,
  ackWaitMs = 500,
  waitMs = 8000,
  logger
} = {}) {
  if (!steam || typeof steam.sendToGC !== "function") {
    throw badRequest("steam.sendToGC unavailable", "steam_unavailable");
  }

  const resolvedAccount = asString(accountName).trim();
  const observedGcMessages = [];
  const callbackGcMessages = [];
  const onReceivedFromGC = (appid, msgType, payload) => {
    if (appid !== 730 || !captureAfterSend) {
      return;
    }
    observedGcMessages.push(summarizeGcMessage(msgType, payload));
  };

  let captureAfterSend = false;
  let ackPayload = null;
  steam.on("receivedFromGC", onReceivedFromGC);
  try {
    if (logger) {
      const startParts = [
        `account=${resolvedAccount || "-"}`,
        `campaign_id=${asString(campaignId)}`,
        `redeem_id=${asString(redeemId)}`,
        `balance=${asString(redeemableBalance)}`,
        `expected_cost=${asString(expectedCost)}`,
        `bid_control=${asString(bidControl)}`,
        `ack_tracks=${ackTracks ? 1 : 0}`
      ];
      logger.info(
        "weapon_armory",
        `redeem start: ${startParts.join(" ")}`
      );
    }

    if (ackTracks) {
      ackPayload = sendAckXpShopTracks({
        steam,
        onResponse(appid, msgType, responsePayload) {
          if (appid !== 730) {
            return;
          }
          callbackGcMessages.push(summarizeGcMessage(msgType, responsePayload));
        }
      });
      if (logger) {
        logger.info(
          "weapon_armory",
          [
            "redeem ack-tracks:",
            `account=${resolvedAccount || "-"}`,
            `wait_ms=${ackWaitMs}`,
            `payload_hex=${ackPayload.toString("hex")}`
          ].join(" ")
        );
      }
      await sleep(ackWaitMs);
    }

    const beforeState = readGcArmoryState(steam);
    let resolved = null;
    try {
      resolved = resolveRedeemRequest({
        state: beforeState,
        campaignId,
        redeemId,
        redeemableBalance,
        expectedCost,
        bidControl
      });
    } catch (err) {
      const code = asString(err && err.code || "").trim();
      if (
        err
        && !err.redemption_payload
        && (code === "armory_bid_ambiguous" || code === "armory_state_unavailable")
      ) {
        err.redemption_payload = {
          ...buildArmoryInspectPayload(beforeState, resolvedAccount),
          ok: false,
          reason: code || "weapon_armory_redeem_failed",
          message: asString(err && err.message ? err.message : err)
        };
      }
      throw err;
    }

    captureAfterSend = true;
    const confirmationPromise = waitForRedemptionEvidence({
      steam,
      beforeState,
      resolved,
      waitMs
    });
    const payload = sendRedeemMissionReward({
      steam,
      campaignId: resolved.campaign_id,
      redeemId: resolved.redeem_id,
      redeemableBalance: resolved.redeemable_balance,
      expectedCost: resolved.expected_cost,
      bidControl: resolved.bid_control,
      onResponse(appid, msgType, responsePayload) {
        if (appid !== 730) {
          return;
        }
        callbackGcMessages.push(summarizeGcMessage(msgType, responsePayload));
      }
    });

    if (logger) {
      const sentParts = [
        `account=${resolvedAccount || "-"}`,
        `campaign_id=${resolved.campaign_id}`,
        `redeem_id=${resolved.redeem_id}`,
        `balance=${resolved.redeemable_balance}`,
        `expected_cost=${resolved.expected_cost}`,
        `bid_control=${resolved.bid_control}`,
        `payload_hex=${payload.toString("hex")}`
      ];
      logger.info(
        "weapon_armory",
        `redeem sent: ${sentParts.join(" ")}`
      );
    }

    const confirmation = await confirmationPromise;
    const mergedEvidence = mergeRedemptionEvidence(confirmation.evidence, observedGcMessages);
    const result = {
      ok: mergedEvidence.success,
      success: mergedEvidence.success,
      success_kind: mergedEvidence.success_kind,
      account: resolvedAccount,
      ack_tracks: ackTracks
        ? {
          sent: true,
          wait_ms: Math.max(0, Number(ackWaitMs) || 0),
          payload_hex: ackPayload ? ackPayload.toString("hex") : ""
        }
        : {
          sent: false,
          wait_ms: Math.max(0, Number(ackWaitMs) || 0),
          payload_hex: ""
        },
      resolved,
      sent: cloneJson(resolved, {}),
      payload_hex: payload.toString("hex"),
      wait_ms: Math.max(0, Number(waitMs) || 0),
      armory_state_before: beforeState,
      armory_state_after: confirmation.state,
      success_evidence: mergedEvidence.evidence,
      observed_gc_messages: observedGcMessages,
      callback_gc_messages: callbackGcMessages,
      message: mergedEvidence.success ? "武库奖励兑换成功" : "未在等待窗口内确认武库奖励兑换成功"
    };

    if (!mergedEvidence.success) {
      const err = badRequest(result.message, "redemption_not_confirmed");
      err.redemption_payload = result;
      throw err;
    }

    return result;
  } finally {
    steam.off("receivedFromGC", onReceivedFromGC);
  }
}

async function inspectWeaponArmoryWithSteam({
  steam,
  accountName = ""
} = {}) {
  if (!steam || typeof steam.sendToGC !== "function") {
    throw badRequest("steam.sendToGC unavailable", "steam_unavailable");
  }
  const state = readGcArmoryState(steam);
  return buildArmoryInspectPayload(state, accountName);
}

async function probeWeaponArmoryWithSteam({
  steam,
  accountName = "",
  ackTracks = false,
  ackWaitMs = 500,
  waitMs = 3000,
  traceLimit = 50,
  logger
} = {}) {
  if (!steam || typeof steam.sendToGC !== "function") {
    throw badRequest("steam.sendToGC unavailable", "steam_unavailable");
  }

  const resolvedAccount = asString(accountName).trim();
  let ackPayload = null;

  if (logger) {
    logger.info(
      "weapon_armory",
      [
        "probe start:",
        `account=${resolvedAccount || "-"}`,
        `ack_tracks=${ackTracks ? 1 : 0}`,
        `ack_wait_ms=${Math.max(0, Number(ackWaitMs) || 0)}`,
        `wait_ms=${Math.max(0, Number(waitMs) || 0)}`
      ].join(" ")
    );
  }

  const beforeState = readGcArmoryState(steam);

  if (ackTracks) {
    ackPayload = sendAckXpShopTracks({steam});
    if (logger) {
      logger.info(
        "weapon_armory",
        [
          "probe ack-tracks:",
          `account=${resolvedAccount || "-"}`,
          `payload_hex=${ackPayload.toString("hex")}`
        ].join(" ")
      );
    }
    await sleep(ackWaitMs);
  }

  await sleep(waitMs);

  const afterState = readGcArmoryState(steam);
  const observedGcMessages = readGcTraceMessages(steam, {limit: traceLimit});

  return {
    ok: true,
    account: resolvedAccount,
    ack_tracks: ackTracks
      ? {
        sent: true,
        wait_ms: Math.max(0, Number(ackWaitMs) || 0),
        payload_hex: ackPayload ? ackPayload.toString("hex") : ""
      }
      : {
        sent: false,
        wait_ms: Math.max(0, Number(ackWaitMs) || 0),
        payload_hex: ""
      },
    wait_ms: Math.max(0, Number(waitMs) || 0),
    before_state: beforeState,
    after_state: afterState,
    observed_gc_messages: observedGcMessages
  };
}

function createWeaponArmoryService({sessionPool, logger} = {}) {
  if (!sessionPool) {
    throw new Error("sessionPool is required");
  }

  const accountLocks = new Map();

  async function withAccountLock(username, task) {
    const key = asString(username).trim();
    if (!key) {
      throw new Error("username is required");
    }
    const prev = accountLocks.get(key) || Promise.resolve();
    const current = prev
      .catch(() => {})
      .then(task)
      .finally(() => {
        if (accountLocks.get(key) === current) {
          accountLocks.delete(key);
        }
      });
    accountLocks.set(key, current);
    return current;
  }

  async function acquireContext({username, password}) {
    const accountStore = new AccountStore();
    const account = username ? accountStore.get(username) : accountStore.getActive();
    if (!account) {
      throw badRequest(`account not found: ${username || "(active)"}`, "account_not_found");
    }
    const accountName = asString(account.username).trim();
    const tokenStore = new TokenStore();
    const refreshToken = tokenStore.get(accountName);
    const accountPassword = asString(password || account.password || "").trim();
    if (!refreshToken && !accountPassword) {
      throw badRequest(`password missing: ${accountName}`, "password_missing");
    }
    const acquired = await sessionPool.acquire({
      username: accountName,
      password: accountPassword,
      refreshToken,
      tokenStore
    });
    if (!acquired || !acquired.steam) {
      throw new Error("steam session not ready");
    }
    return {accountName, steam: acquired.steam};
  }

  async function redeem(args = {}) {
    const {accountName, steam} = await acquireContext(args);
    return withAccountLock(accountName, async () => {
      const result = await redeemMissionRewardWithSteam({
        ...args,
        steam,
        accountName,
        logger: args.logger || logger
      });
      sessionPool.touch(accountName);
      return result;
    });
  }

  async function inspect(args = {}) {
    const {accountName, steam} = await acquireContext(args);
    return withAccountLock(accountName, async () => {
      const result = await inspectWeaponArmoryWithSteam({
        steam,
        accountName
      });
      sessionPool.touch(accountName);
      return result;
    });
  }

  async function probe(args = {}) {
    const {accountName, steam} = await acquireContext(args);
    return withAccountLock(accountName, async () => {
      const result = await probeWeaponArmoryWithSteam({
        ...args,
        steam,
        accountName,
        logger: args.logger || logger
      });
      sessionPool.touch(accountName);
      return result;
    });
  }

  return {
    inspect,
    probe,
    redeem
  };
}

module.exports = {
  createWeaponArmoryService,
  inspectWeaponArmoryWithSteam,
  probeWeaponArmoryWithSteam,
  redeemMissionRewardWithSteam
};
