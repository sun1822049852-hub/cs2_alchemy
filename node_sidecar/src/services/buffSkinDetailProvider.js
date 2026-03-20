const {asString} = require("../utils");
const {buildSkinFamilyKey} = require("./skinFamilyKey");

const DEFAULT_BASE_URL = "https://buff.163.com";
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_RETRY_LIMIT = 3;
const DEFAULT_RETRY_DELAY_MS = 1500;

function isRetryableStatus(status) {
  const code = Math.trunc(Number(status) || 0);
  return code === 429 || (code >= 500 && code < 600);
}

function isAbortLikeError(err) {
  const text = asString(err && err.message ? err.message : err).toLowerCase();
  return /abort|aborted|timeout/.test(text);
}

function createRequestError(message, {retryable = false} = {}) {
  const error = new Error(asString(message).trim() || "buff detail request failed");
  error.retryable = !!retryable;
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
          {retryable: isRetryableStatus(response.status)}
        );
        error.retryAfterMs = readRetryAfterMs(response);
        throw error;
      }
      if (!payload || asString(payload.code).trim() !== "OK") {
        throw createRequestError(`${label} api=${asString(payload && payload.msg).trim() || "invalid_payload"}`);
      }
      return payload;
    } catch (err) {
      const timeoutMsText = Math.max(1, Math.trunc(Number(timeoutMs) || 0) || DEFAULT_TIMEOUT_MS);
      if (isAbortLikeError(err)) {
        lastError = createRequestError(`${label} timeout(${timeoutMsText}ms)`, {retryable: true});
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
          {retryable: isRetryableStatus(response.status)}
        );
        error.retryAfterMs = readRetryAfterMs(response);
        throw error;
      }
      return text;
    } catch (err) {
      const timeoutMsText = Math.max(1, Math.trunc(Number(timeoutMs) || 0) || DEFAULT_TIMEOUT_MS);
      if (isAbortLikeError(err)) {
        lastError = createRequestError(`${label} timeout(${timeoutMsText}ms)`, {retryable: true});
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

function buildItemFamilyKey(item) {
  return buildSkinFamilyKey(
    asString(
      (item && item.localized_name) ||
      (item && item.goods && item.goods.name) ||
      ""
    ).trim()
  );
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
      ? list.find((item) => buildItemFamilyKey(item) === expectedBaseName)
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
    throw createRequestError("goods page rarity missing");
  }
  return rarity;
}

function createBuffSkinDetailProvider({
  fetchImpl = global.fetch,
  logger = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryLimit = DEFAULT_RETRY_LIMIT,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetchImpl must be a function");
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
    fetchByGoodsId
  };
}

module.exports = {
  createBuffSkinDetailProvider
};
