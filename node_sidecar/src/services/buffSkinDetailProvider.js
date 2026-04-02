const {asString} = require("../utils");
const {buildSkinFamilyKey} = require("./skinFamilyKey");

const DEFAULT_BASE_URL = "https://buff.163.com";
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_RETRY_LIMIT = 3;
const DEFAULT_RETRY_DELAY_MS = 1500;
const MAX_WEAR_RAW_CANDIDATES = 6;
const MAX_WEAR_FAMILY_MEMBERS = 5;

function isRetryableStatus(status) {
  const code = Math.trunc(Number(status) || 0);
  return code === 429 || (code >= 500 && code < 600);
}

function isAbortLikeError(err) {
  const text = asString(err && err.message ? err.message : err).toLowerCase();
  return /abort|aborted|timeout/.test(text);
}

function createRequestError(message, {
  retryable = false,
  statusCode = 0,
  kind = "generic"
} = {}) {
  const error = new Error(asString(message).trim() || "buff detail request failed");
  error.retryable = !!retryable;
  error.kind = asString(kind).trim() || "generic";
  if (Number.isFinite(Number(statusCode)) && Number(statusCode) > 0) {
    error.statusCode = Math.trunc(Number(statusCode));
  }
  return error;
}

function buildUrl(pathname, query = {}) {
  const url = new URL(pathname, DEFAULT_BASE_URL);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, asString(value).trim());
  }
  return url.toString();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Math.trunc(Number(ms) || 0)));
  });
}

function getHeader(response, name) {
  if (!response || !response.headers || typeof response.headers.get !== "function") {
    return "";
  }
  return asString(response.headers.get(name)).trim();
}

function readRetryAfterMs(response) {
  const raw = getHeader(response, "retry-after");
  if (!raw) {
    return 0;
  }
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const at = Date.parse(raw);
  if (Number.isFinite(at)) {
    return Math.max(0, at - Date.now());
  }
  return 0;
}

function log(logger, level, message) {
  if (!logger || typeof logger[level] !== "function") {
    return;
  }
  logger[level]("skin_detail_provider", message);
}

async function requestJson({
  fetchImpl,
  url,
  timeoutMs,
  label,
  headers,
  retryLimit = DEFAULT_RETRY_LIMIT,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  logger
}) {
  let lastError = null;
  const attempts = Math.max(0, Math.trunc(Number(retryLimit) || 0)) + 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const abortController = new AbortController();
    const timer = setTimeout(() => {
      abortController.abort();
    }, Math.max(1, Math.trunc(Number(timeoutMs) || 0) || DEFAULT_TIMEOUT_MS));

    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers,
        signal: abortController.signal
      });
      const text = typeof response.text === "function"
        ? await response.text()
        : JSON.stringify(typeof response.json === "function" ? await response.json() : {});
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch (_) {
        payload = null;
      }
      if (!response.ok) {
        const error = createRequestError(
          `${label} http=${response.status || 0}`,
          {
            retryable: isRetryableStatus(response.status),
            statusCode: response.status,
            kind: "request"
          }
        );
        error.retryAfterMs = readRetryAfterMs(response);
        throw error;
      }
      if (!payload || asString(payload.code).trim() !== "OK") {
        throw createRequestError(
          `${label} api=${asString(payload && payload.msg).trim() || "invalid_payload"}`,
          {kind: "request"}
        );
      }
      return payload;
    } catch (err) {
      const timeoutMsText = Math.max(1, Math.trunc(Number(timeoutMs) || 0) || DEFAULT_TIMEOUT_MS);
      if (isAbortLikeError(err)) {
        lastError = createRequestError(
          `${label} timeout(${timeoutMsText}ms)`,
          {retryable: true, kind: "request"}
        );
      } else {
        lastError = err instanceof Error ? err : createRequestError(err);
      }
      const retryable = Boolean(lastError && lastError.retryable);
      if (retryable && attempt < attempts) {
        const waitMs = Math.max(
          Number(lastError && lastError.retryAfterMs || 0) || 0,
          Math.max(0, Math.trunc(Number(retryDelayMs) || 0)) * attempt
        );
        log(logger, "warn", `${label} retry attempt=${attempt} reason=${asString(lastError.message).trim()}`);
        if (waitMs > 0) {
          await sleep(waitMs);
        }
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || createRequestError(`${label} failed`);
}

async function requestText({
  fetchImpl,
  url,
  timeoutMs,
  label,
  headers,
  retryLimit = DEFAULT_RETRY_LIMIT,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  logger
}) {
  let lastError = null;
  const attempts = Math.max(0, Math.trunc(Number(retryLimit) || 0)) + 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const abortController = new AbortController();
    const timer = setTimeout(() => {
      abortController.abort();
    }, Math.max(1, Math.trunc(Number(timeoutMs) || 0) || DEFAULT_TIMEOUT_MS));

    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers,
        signal: abortController.signal
      });
      const text = await response.text();
      if (!response.ok) {
        const error = createRequestError(
          `${label} http=${response.status || 0}`,
          {
            retryable: isRetryableStatus(response.status),
            statusCode: response.status,
            kind: "request"
          }
        );
        error.retryAfterMs = readRetryAfterMs(response);
        throw error;
      }
      return text;
    } catch (err) {
      const timeoutMsText = Math.max(1, Math.trunc(Number(timeoutMs) || 0) || DEFAULT_TIMEOUT_MS);
      if (isAbortLikeError(err)) {
        lastError = createRequestError(
          `${label} timeout(${timeoutMsText}ms)`,
          {retryable: true, kind: "request"}
        );
      } else {
        lastError = err instanceof Error ? err : createRequestError(err);
      }
      const retryable = Boolean(lastError && lastError.retryable);
      if (retryable && attempt < attempts) {
        const waitMs = Math.max(
          Number(lastError && lastError.retryAfterMs || 0) || 0,
          Math.max(0, Math.trunc(Number(retryDelayMs) || 0)) * attempt
        );
        log(logger, "warn", `${label} retry attempt=${attempt} reason=${asString(lastError.message).trim()}`);
        if (waitMs > 0) {
          await sleep(waitMs);
        }
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || createRequestError(`${label} failed`);
}

function chooseContainers(containers = []) {
  const list = Array.isArray(containers) ? containers : [];
  if (!list.length) {
    throw createRequestError("containers empty");
  }
  const apiContainer = list[0];
  const displayContainer = list.find((entry) => asString(entry && entry.container).trim() !== "armory") || apiContainer;
  const apiContainerName = asString(apiContainer && apiContainer.container).trim();
  const displayName = asString(displayContainer && displayContainer.name).trim();
  if (!apiContainerName) {
    throw createRequestError("container name missing");
  }
  if (!displayName) {
    throw createRequestError("collection missing");
  }
  return {
    apiContainerName,
    displayName
  };
}

function listItemFamilyKeys(item) {
  return uniqueTrimmedValues([
    item && item.localized_name,
    item && item.goods && item.goods.short_name,
    item && item.goods && item.goods.name,
    item && item.goods && item.goods.market_hash_name
  ]).map((value) => buildSkinFamilyKey(value)).filter(Boolean);
}

function extractTargetItem(items, goodsId, options = {}) {
  const targetId = asString(goodsId).trim();
  const expectedBaseName = buildSkinFamilyKey(asString(options && options.expectedBaseName).trim());
  const list = Array.isArray(items) ? items : [];
  const target = list.find((item) => {
    const directId = asString(item && item.goods_id).trim();
    const nestedId = asString(item && item.goods && item.goods.goods_id).trim();
    return directId === targetId || nestedId === targetId;
  }) || (
    expectedBaseName
      ? list.find((item) => listItemFamilyKeys(item).includes(expectedBaseName))
      : null
  );
  if (!target) {
    throw createRequestError(`goods ${targetId} not found`);
  }
  const rarity = asString(
    target && target.goods && target.goods.tags &&
    target.goods.tags.rarity && target.goods.tags.rarity.localized_name
  ).trim();
  if (!rarity) {
    throw createRequestError(`goods ${targetId} rarity missing`);
  }
  return {rarity};
}

function extractRarityFromGoodsPageHtml(html) {
  const text = asString(html);
  const match = text.match(/<label>\s*(?:品质|Quality)\s*\|<\/label>\s*([^<]+)\s*<\/span>/i);
  const rarity = asString(match && match[1]).trim();
  if (!rarity) {
    throw createRequestError("goods page rarity missing", {kind: "parse"});
  }
  return rarity;
}

function extractGoodsImageFromGoodsPageHtml(html) {
  const text = asString(html);
  const detailImageMatch = text.match(
    /<div[^>]+class=["'][^"']*\bdetail-pic\b[^"']*["'][\s\S]*?<img[^>]+src=["'](https?:\/\/[^"'<>]+)["']/i
  );
  const directImageUrl = asString(detailImageMatch && detailImageMatch[1]).trim();
  if (directImageUrl) {
    return {
      goods_icon_url: directImageUrl,
      goods_original_icon_url: directImageUrl,
      goods_share_thumbnail_url: directImageUrl
    };
  }

  const fileImageMatch = text.match(
    /<img[^>]+src=["'](https?:\/\/market\.fp\.ps\.netease\.com\/file\/[^"'<>]+)["']/i
  );
  const fileImageUrl = asString(fileImageMatch && fileImageMatch[1]).trim();
  if (fileImageUrl) {
    return {
      goods_icon_url: fileImageUrl,
      goods_original_icon_url: fileImageUrl,
      goods_share_thumbnail_url: fileImageUrl
    };
  }

  const metaMatch = text.match(
    /<meta\s+(?:property=["']og:image["']\s+content=["']([^"']+)["']|content=["']([^"']+)["']\s+property=["']og:image["'])/i
  );
  const imageUrl = asString((metaMatch && (metaMatch[1] || metaMatch[2])) || "").trim();
  if (!imageUrl) {
    throw createRequestError("goods page image missing", {kind: "parse"});
  }
  return {
    goods_icon_url: imageUrl,
    goods_original_icon_url: imageUrl,
    goods_share_thumbnail_url: imageUrl
  };
}

function extractPaintwearValue(payload, label) {
  const ranks = payload && payload.data && payload.data.ranks;
  const raw = asString(((Array.isArray(ranks) ? ranks[0] : null) || {}).paintwear).trim();
  if (!raw) {
    throw createRequestError(`${label} paintwear missing`, {kind: "parse"});
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw createRequestError(`${label} paintwear missing`, {kind: "parse"});
  }
  return value;
}

function roundFloat2(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw createRequestError("paintwear invalid", {kind: "parse"});
  }
  return Math.round(numeric * 100) / 100;
}

function uniqueTrimmedValues(values = []) {
  const list = Array.isArray(values) ? values : [];
  const seen = new Set();
  const result = [];
  for (const value of list) {
    const text = asString(value).trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
  }
  return result;
}

function extractGoodsPageTitle(html) {
  const match = asString(html).match(/<title>([^<]*)<\/title>/i);
  return asString(match && match[1]).trim();
}

function isStatTrakGoodsPageTitle(title) {
  return /StatTrak/i.test(asString(title));
}

function extractRelativeGoodsIdsFromGoodsPageHtml(html) {
  const text = asString(html);
  const result = [];
  const pattern = /relative_goods_ids\.push\(["'](\d+)["']\)/g;
  let match = null;
  while ((match = pattern.exec(text)) !== null) {
    result.push(asString(match[1]).trim());
  }
  return uniqueTrimmedValues(result);
}

function extractBalancedSegment(text, startIndex, openChar, closeChar) {
  const source = asString(text);
  const start = Math.max(0, Math.trunc(Number(startIndex) || 0));
  if (!source || start >= source.length || source[start] !== openChar) {
    return "";
  }
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const ch = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = "";
      }
      continue;
    }
    if (ch === "'" || ch === "\"") {
      quote = ch;
      continue;
    }
    if (ch === openChar) {
      depth += 1;
      continue;
    }
    if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  return "";
}

function extractPaintwearChoicesFromGoodsPageHtml(html) {
  const text = asString(html);
  const rootMatch = text.match(/var\s+filter_data_selling\s*=\s*\{/i);
  if (!rootMatch) {
    return [];
  }
  const rootIndex = Math.max(0, Number(rootMatch.index) || 0);
  const paintwearIndex = text.indexOf("paintwear_choices", rootIndex);
  if (paintwearIndex < 0) {
    return [];
  }
  const arrayStart = text.indexOf("[", paintwearIndex);
  if (arrayStart < 0) {
    return [];
  }
  const arrayText = extractBalancedSegment(text, arrayStart, "[", "]");
  if (!arrayText) {
    return [];
  }
  const result = [];
  const pairPattern = /\[\s*["']([0-9.]+)["']\s*,\s*["']([0-9.]+)["']\s*\]/g;
  let match = null;
  while ((match = pairPattern.exec(arrayText)) !== null) {
    result.push({
      min: Number(match[1]),
      max: Number(match[2])
    });
  }
  return result;
}

function summarizePaintwearChoices(choices) {
  const list = Array.isArray(choices) ? choices : [];
  if (!list.length) {
    return null;
  }
  let minfloat = Number.POSITIVE_INFINITY;
  let maxfloat = Number.NEGATIVE_INFINITY;
  for (const choice of list) {
    const min = Number(choice && choice.min);
    const max = Number(choice && choice.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 1 || max < min) {
      throw createRequestError("paintwear choice invalid", {kind: "parse"});
    }
    if (min < minfloat) {
      minfloat = min;
    }
    if (max > maxfloat) {
      maxfloat = max;
    }
  }
  if (!Number.isFinite(minfloat) || !Number.isFinite(maxfloat)) {
    return null;
  }
  const normalizedMin = roundFloat2(minfloat);
  const normalizedMax = roundFloat2(maxfloat);
  return {
    minfloat: normalizedMin,
    maxfloat: normalizedMax,
    wear_range: roundFloat2(normalizedMax - normalizedMin)
  };
}

function mergeWearInfoList(values = []) {
  const list = (Array.isArray(values) ? values : []).filter(Boolean);
  if (!list.length) {
    return null;
  }
  let minfloat = Number.POSITIVE_INFINITY;
  let maxfloat = Number.NEGATIVE_INFINITY;
  for (const value of list) {
    const currentMin = Number(value && value.minfloat);
    const currentMax = Number(value && value.maxfloat);
    if (!Number.isFinite(currentMin) || !Number.isFinite(currentMax)) {
      continue;
    }
    if (currentMin < minfloat) {
      minfloat = currentMin;
    }
    if (currentMax > maxfloat) {
      maxfloat = currentMax;
    }
  }
  if (!Number.isFinite(minfloat) || !Number.isFinite(maxfloat)) {
    return null;
  }
  const normalizedMin = roundFloat2(minfloat);
  const normalizedMax = roundFloat2(maxfloat);
  return {
    minfloat: normalizedMin,
    maxfloat: normalizedMax,
    wear_range: roundFloat2(normalizedMax - normalizedMin)
  };
}

function isFullWearRange(wearInfo) {
  return Boolean(
    wearInfo &&
    Number.isFinite(Number(wearInfo.minfloat)) &&
    Number.isFinite(Number(wearInfo.maxfloat)) &&
    Number(wearInfo.minfloat) <= 0 &&
    Number(wearInfo.maxfloat) >= 1
  );
}

function buildGoodsPageHeaders(goodsId) {
  const targetId = asString(goodsId).trim();
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Referer: `${DEFAULT_BASE_URL}/goods/${targetId}`,
    "User-Agent": "Mozilla/5.0"
  };
}

function formatGoodsIdList(values = []) {
  const list = uniqueTrimmedValues(values);
  return list.length ? list.join(",") : "-";
}

function formatWearRangeForLog(wearInfo) {
  if (!wearInfo) {
    return "-";
  }
  const min = Number(wearInfo.minfloat);
  const max = Number(wearInfo.maxfloat);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return "-";
  }
  return `${min.toFixed(2)}-${max.toFixed(2)}`;
}

function buildWearLogPrefix(familyKey, seedGoodsId) {
  return `wear family=${asString(familyKey).trim() || "-"} seed_goods_id=${asString(seedGoodsId).trim() || "-"}`;
}

function haveSameGoodsIdSet(left, right) {
  const leftList = uniqueTrimmedValues(left);
  const rightList = uniqueTrimmedValues(right);
  if (leftList.length !== rightList.length) {
    return false;
  }
  const rightSet = new Set(rightList);
  return leftList.every((value) => rightSet.has(value));
}

function createBuffSkinDetailProvider({
  fetchImpl = global.fetch,
  logger = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryLimit = DEFAULT_RETRY_LIMIT,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  imageRetryLimit = 0,
  imageRetryDelayMs = DEFAULT_RETRY_DELAY_MS
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetchImpl must be a function");
  }

  async function fetchGoodsImageByGoodsId(goodsId) {
    const targetId = asString(goodsId).trim();
    if (!targetId) {
      throw new Error("goodsId is required");
    }
    const goodsPageHtml = await requestText({
      fetchImpl,
      timeoutMs,
      retryLimit: Math.max(0, Math.trunc(Number(imageRetryLimit) || 0)),
      retryDelayMs: Math.max(0, Math.trunc(Number(imageRetryDelayMs) || 0)),
      logger,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        Referer: `${DEFAULT_BASE_URL}/goods/${targetId}`,
        "User-Agent": "Mozilla/5.0"
      },
      label: `buff goods page goods_id=${targetId}`,
      url: `${DEFAULT_BASE_URL}/goods/${targetId}`
    });
    return extractGoodsImageFromGoodsPageHtml(goodsPageHtml);
  }

  async function fetchGoodsPageWearDataByGoodsId(goodsId) {
    const targetId = asString(goodsId).trim();
    const goodsPageHtml = await requestText({
      fetchImpl,
      timeoutMs,
      retryLimit,
      retryDelayMs,
      logger,
      headers: buildGoodsPageHeaders(targetId),
      label: `buff wear goods page goods_id=${targetId}`,
      url: `${DEFAULT_BASE_URL}/goods/${targetId}?tab=selling&page_num=1`
    });
    const title = extractGoodsPageTitle(goodsPageHtml);
    return {
      goodsId: targetId,
      title,
      isStatTrak: isStatTrakGoodsPageTitle(title),
      relativeGoodsIds: extractRelativeGoodsIdsFromGoodsPageHtml(goodsPageHtml),
      wearInfo: summarizePaintwearChoices(extractPaintwearChoicesFromGoodsPageHtml(goodsPageHtml))
    };
  }

  async function fetchRankWearInfoByGoodsId(goodsId) {
    const targetId = asString(goodsId).trim();
    if (!targetId) {
      throw new Error("goodsId is required");
    }
    const headers = {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "zh-CN,zh;q=0.9",
      Referer: `${DEFAULT_BASE_URL}/goods/${targetId}`,
      "User-Agent": "Mozilla/5.0"
    };
    const timestamp = Date.now();
    const [minPayload, maxPayload] = await Promise.all([
      requestJson({
        fetchImpl,
        timeoutMs,
        retryLimit,
        retryDelayMs,
        logger,
        headers,
        label: `buff paintwear goods_id=${targetId} order=min`,
        url: buildUrl("/api/market/paintwear_rank", {
          game: "csgo",
          goods_id: targetId,
          page_num: "1",
          rank_type: "0",
          _: String(timestamp)
        })
      }),
      requestJson({
        fetchImpl,
        timeoutMs,
        retryLimit,
        retryDelayMs,
        logger,
        headers,
        label: `buff paintwear goods_id=${targetId} order=max`,
        url: buildUrl("/api/market/paintwear_rank", {
          game: "csgo",
          goods_id: targetId,
          page_num: "1",
          rank_type: "0",
          order_type: "1",
          _: String(timestamp + 1)
        })
      })
    ]);
    const minfloat = roundFloat2(
      extractPaintwearValue(minPayload, `buff paintwear goods_id=${targetId} order=min`)
    );
    const maxfloat = roundFloat2(
      extractPaintwearValue(maxPayload, `buff paintwear goods_id=${targetId} order=max`)
    );
    return {
      minfloat,
      maxfloat,
      wear_range: roundFloat2(maxfloat - minfloat)
    };
  }

  async function fetchWearRangeByGoodsId(goodsId, options = {}) {
    const targetId = asString(goodsId).trim();
    if (!targetId) {
      throw new Error("goodsId is required");
    }
    const familyKey = asString(options && options.familyKey).trim();
    const logPrefix = buildWearLogPrefix(familyKey, targetId);
    const rawPages = new Map();
    let rawCandidateIds = [targetId];
    let seedIsStatTrak = false;
    let seedPageError = null;

    try {
      const seedPage = await fetchGoodsPageWearDataByGoodsId(targetId);
      rawPages.set(targetId, seedPage);
      seedIsStatTrak = seedPage.isStatTrak;
      rawCandidateIds = uniqueTrimmedValues([targetId, ...seedPage.relativeGoodsIds]);
      if (rawCandidateIds.length > MAX_WEAR_RAW_CANDIDATES) {
        rawCandidateIds = rawCandidateIds.slice(0, MAX_WEAR_RAW_CANDIDATES);
      }
    } catch (error) {
      seedPageError = error;
    }

    for (const candidateId of rawCandidateIds) {
      if (candidateId === targetId || rawPages.has(candidateId)) {
        continue;
      }
      try {
        rawPages.set(candidateId, await fetchGoodsPageWearDataByGoodsId(candidateId));
      } catch (error) {
        rawPages.set(candidateId, {
          goodsId: candidateId,
          title: "",
          isStatTrak: null,
          relativeGoodsIds: [],
          wearInfo: null,
          error
        });
      }
    }

    for (const candidateId of rawCandidateIds) {
      const page = rawPages.get(candidateId);
      if (!page || !page.relativeGoodsIds.length) {
        continue;
      }
      const pageCandidateIds = uniqueTrimmedValues([candidateId, ...page.relativeGoodsIds]);
      if (!haveSameGoodsIdSet(pageCandidateIds, rawCandidateIds)) {
        log(
          logger,
          "warn",
          `${logPrefix} closure_goods_ids=${formatGoodsIdList(rawCandidateIds)} page_goods_id=${candidateId} parsed_relative_goods_ids=${formatGoodsIdList(pageCandidateIds)} warn=family_goods_mismatch`
        );
      }
    }

    let familyPages = rawCandidateIds
      .map((candidateId) => rawPages.get(candidateId))
      .filter(Boolean)
      .filter((page) => page.goodsId === targetId || page.isStatTrak === seedIsStatTrak);
    if (familyPages.length > MAX_WEAR_FAMILY_MEMBERS) {
      log(
        logger,
        "warn",
        `${logPrefix} candidate_goods_ids=${formatGoodsIdList(rawCandidateIds)} filtered_goods_ids=${formatGoodsIdList(familyPages.map((page) => page.goodsId))} warn=family_size_exceeded`
      );
      familyPages = familyPages.slice(0, MAX_WEAR_FAMILY_MEMBERS);
    }
    if (!familyPages.length) {
      familyPages = rawPages.has(targetId)
        ? [rawPages.get(targetId)]
        : [{
          goodsId: targetId,
          title: "",
          isStatTrak: seedIsStatTrak,
          relativeGoodsIds: [],
          wearInfo: null
        }];
    }

    const mainWearInfo = mergeWearInfoList(
      familyPages.map((page) => page && page.wearInfo).filter(Boolean)
    );
    if (isFullWearRange(mainWearInfo)) {
      log(
        logger,
        "warn",
        `${logPrefix} closure_goods_ids=${formatGoodsIdList(familyPages.map((page) => page.goodsId))} final_range=${formatWearRangeForLog(mainWearInfo)} warn=rank_bypass_full_range`
      );
      return mainWearInfo;
    }

    const rankGoodsIds = familyPages
      .map((page) => asString(page && page.goodsId).trim())
      .filter(Boolean);
    const rankWearInfos = [];
    let rankSuccessCount = 0;
    let rankFailure = null;
    for (const candidateId of rankGoodsIds) {
      try {
        rankWearInfos.push(await fetchRankWearInfoByGoodsId(candidateId));
        rankSuccessCount += 1;
      } catch (error) {
        rankFailure = rankFailure || error;
      }
    }
    const rankComplete = rankGoodsIds.length > 0 && rankSuccessCount === rankGoodsIds.length;
    if (rankComplete) {
      const rankWearInfo = mergeWearInfoList(rankWearInfos);
      if (mainWearInfo) {
        const finalWearInfo = mergeWearInfoList([mainWearInfo, rankWearInfo]);
        const expandedMin = Number(finalWearInfo && finalWearInfo.minfloat) < Number(mainWearInfo.minfloat);
        const expandedMax = Number(finalWearInfo && finalWearInfo.maxfloat) > Number(mainWearInfo.maxfloat);
        if (expandedMin || expandedMax) {
          const side = expandedMin && expandedMax ? "both" : (expandedMin ? "min" : "max");
          log(
            logger,
            "warn",
            `${logPrefix} closure_goods_ids=${formatGoodsIdList(familyPages.map((page) => page.goodsId))} main_range=${formatWearRangeForLog(mainWearInfo)} rank_range=${formatWearRangeForLog(rankWearInfo)} final_range=${formatWearRangeForLog(finalWearInfo)} side=${side} warn=range_expanded`
          );
        }
        return finalWearInfo;
      }
      return rankWearInfo;
    }

    if (mainWearInfo) {
      if (rankGoodsIds.length > 0 && rankSuccessCount < rankGoodsIds.length) {
        log(
          logger,
          "warn",
          `${logPrefix} closure_goods_ids=${formatGoodsIdList(familyPages.map((page) => page.goodsId))} rank_success=${rankSuccessCount} rank_total=${rankGoodsIds.length} warn=rank_incomplete`
        );
      }
      return mainWearInfo;
    }

    if (rankFailure) {
      throw rankFailure;
    }
    if (seedPageError) {
      throw seedPageError;
    }
    throw createRequestError(`wear range unavailable goods_id=${targetId}`, {kind: "parse"});
  }

  async function fetchByGoodsId(goodsId, options = {}) {
    const targetId = asString(goodsId).trim();
    if (!targetId) {
      throw new Error("goodsId is required");
    }
    const headers = {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${DEFAULT_BASE_URL}/goods/${targetId}`,
      "User-Agent": "Mozilla/5.0"
    };

    const containersPayload = await requestJson({
      fetchImpl,
      timeoutMs,
      retryLimit,
      retryDelayMs,
      logger,
      headers,
      label: `buff containers goods_id=${targetId}`,
      url: buildUrl("/api/market/csgo_goods_containers", {
        goods_id: targetId,
        _: String(Date.now())
      })
    });
    const containerType = asString(
      containersPayload && containersPayload.data && containersPayload.data.container_type
    ).trim() || "weaponcase";
    const selected = chooseContainers(
      containersPayload && containersPayload.data && containersPayload.data.containers
    );

    const containerPayload = await requestJson({
      fetchImpl,
      timeoutMs,
      retryLimit,
      retryDelayMs,
      logger,
      headers,
      label: `buff container goods_id=${targetId}`,
      url: buildUrl("/api/market/csgo_container", {
        container: selected.apiContainerName,
        is_container: "0",
        container_type: containerType,
        _: String(Date.now())
      })
    });
    try {
      const target = extractTargetItem(
        containerPayload && containerPayload.data && containerPayload.data.items,
        targetId,
        options
      );
      return {
        collection: selected.displayName,
        rarity: target.rarity,
        detail_source: "buff"
      };
    } catch (error) {
      const allowGoodsPageFallback = Boolean(
        containerPayload &&
        containerPayload.data &&
        containerPayload.data.has_unusual
      );
      if (!/not found/i.test(asString(error && error.message)) || !allowGoodsPageFallback) {
        throw error;
      }
      const goodsPageHtml = await requestText({
        fetchImpl,
        timeoutMs,
        retryLimit,
        retryDelayMs,
        logger,
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9",
          Referer: `${DEFAULT_BASE_URL}/goods/${targetId}`,
          "User-Agent": "Mozilla/5.0"
        },
        label: `buff goods page goods_id=${targetId}`,
        url: `${DEFAULT_BASE_URL}/goods/${targetId}`
      });
      return {
        collection: selected.displayName,
        rarity: extractRarityFromGoodsPageHtml(goodsPageHtml),
        detail_source: "buff_goods_page"
      };
    }
  }

  return {
    fetchByGoodsId,
    fetchGoodsImageByGoodsId,
    fetchWearRangeByGoodsId
  };
}

module.exports = {
  createBuffSkinDetailProvider
};
