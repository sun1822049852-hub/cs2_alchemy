const {asString} = require("../utils");

const DEFAULT_PAGE_BASE_URL = "https://www.c5game.com";
const DEFAULT_API_BASE_URL = "https://api.c5game.com";
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_RETRY_LIMIT = 3;
const DEFAULT_RETRY_DELAY_MS = 1500;
const PAGE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const RANGE_ACCEPT = "application/json, text/plain, */*";
const BROWSER_USER_AGENT = "Mozilla/5.0";

const WEAR_ORDER = [
  ["Factory New", "崭新出厂"],
  ["Minimal Wear", "略有磨损"],
  ["Field-Tested", "久经沙场"],
  ["Well-Worn", "破损不堪"],
  ["Battle-Scarred", "战痕累累"]
];
const WEAR_RANK_BY_EN = new Map(WEAR_ORDER.map(([en], index) => [en, index]));
const WEAR_EN_BY_ZH = new Map(WEAR_ORDER.map(([en, zh]) => [zh, en]));
const VERSION_OR_QUALITY_LABELS = new Set([
  "普通版",
  "普通",
  "Normal",
  "normal",
  "暗金",
  "StatTrak",
  "StatTrak™",
  "StatTrak\u2122",
  "纪念品",
  "Souvenir",
  "souvenir"
]);

function createRequestError(message, {
  retryable = false,
  statusCode = 0,
  kind = "generic"
} = {}) {
  const error = new Error(asString(message).trim() || "c5 detail request failed");
  error.retryable = !!retryable;
  error.kind = asString(kind).trim() || "generic";
  if (Number.isFinite(Number(statusCode)) && Number(statusCode) > 0) {
    error.statusCode = Math.trunc(Number(statusCode));
  }
  return error;
}

function isRetryableStatus(status) {
  const code = Math.trunc(Number(status) || 0);
  return code === 429 || (code >= 500 && code < 600);
}

function isAbortLikeError(err) {
  const text = asString(err && err.message ? err.message : err).toLowerCase();
  return /abort|aborted|timeout/.test(text);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Math.trunc(Number(ms) || 0)));
  });
}

function readRetryAfterMs(response) {
  if (!response || !response.headers || typeof response.headers.get !== "function") {
    return 0;
  }
  const raw = asString(response.headers.get("retry-after")).trim();
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
  logger[level]("c5_skin_detail_provider", message);
}

function normalizeText(value) {
  return asString(value).trim();
}

function parseFloatValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalWear(value) {
  const text = normalizeText(value);
  if (WEAR_RANK_BY_EN.has(text)) {
    return text;
  }
  return WEAR_EN_BY_ZH.get(text) || null;
}

function roundFloat(value) {
  return Number(Number(value).toFixed(6));
}

function buildSellUrl(c5id, options = {}, pageBaseUrl = DEFAULT_PAGE_BASE_URL) {
  const targetId = normalizeText(c5id);
  if (!targetId) {
    throw new Error("c5id is required");
  }
  const name = normalizeText(options.basename)
    || normalizeText(options.baseName)
    || normalizeText(options.name);
  if (!name) {
    throw createRequestError("c5 sell page display name is required", {kind: "input"});
  }
  return `${asString(pageBaseUrl).trim() || DEFAULT_PAGE_BASE_URL}/CSGO/${encodeURIComponent(targetId)}/${encodeURIComponent(name)}/sell`;
}

function buildRangeUrl(itemId, apiBaseUrl = DEFAULT_API_BASE_URL) {
  const targetId = normalizeText(itemId);
  if (!targetId) {
    throw new Error("itemId is required");
  }
  return `${asString(apiBaseUrl).trim() || DEFAULT_API_BASE_URL}/search/v2/item/${encodeURIComponent(targetId)}/wear/range`;
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
      const text = typeof response.text === "function"
        ? await response.text()
        : JSON.stringify(typeof response.json === "function" ? await response.json() : {});
      if (!response || !response.ok) {
        const status = response && response.status || 0;
        const error = createRequestError(`${label} http=${status}`, {
          retryable: isRetryableStatus(status),
          statusCode: status,
          kind: "request"
        });
        error.retryAfterMs = readRetryAfterMs(response);
        throw error;
      }
      if (isC5ErrorPage(text)) {
        throw createRequestError(`${label} c5_error_page`, {kind: "parse"});
      }
      return text;
    } catch (err) {
      const timeoutText = Math.max(1, Math.trunc(Number(timeoutMs) || 0) || DEFAULT_TIMEOUT_MS);
      if (isAbortLikeError(err)) {
        lastError = createRequestError(`${label} timeout(${timeoutText}ms)`, {
          retryable: true,
          kind: "request"
        });
      } else {
        lastError = err instanceof Error ? err : createRequestError(err);
      }
      if (lastError.retryable && attempt < attempts) {
        const waitMs = Math.max(
          Number(lastError.retryAfterMs || 0) || 0,
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
  const text = await requestText({
    fetchImpl,
    url,
    timeoutMs,
    label,
    headers,
    retryLimit,
    retryDelayMs,
    logger
  });
  try {
    return JSON.parse(text);
  } catch (_) {
    throw createRequestError(`${label} invalid_json`, {kind: "parse"});
  }
}

function isC5ErrorPage(html) {
  const text = asString(html).toLowerCase();
  return text.includes("/error/500") || text.includes("default-error");
}

function findMatching(text, openIndex, openChar, closeChar) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  throw createRequestError(`no matching ${closeChar} for ${openChar}`, {kind: "parse"});
}

function splitTopLevel(text, delimiter = ",") {
  const parts = [];
  let start = 0;
  let quote = "";
  let escaped = false;
  let round = 0;
  let square = 0;
  let curly = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (char === "(") {
      round += 1;
    } else if (char === ")") {
      round -= 1;
    } else if (char === "[") {
      square += 1;
    } else if (char === "]") {
      square -= 1;
    } else if (char === "{") {
      curly += 1;
    } else if (char === "}") {
      curly -= 1;
    } else if (char === delimiter && round === 0 && square === 0 && curly === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) {
    parts.push(tail);
  }
  return parts;
}

function parseJsStringLiteral(token) {
  const quote = token[0];
  if (quote === "\"") {
    return JSON.parse(token);
  }
  if (quote !== "'") {
    throw createRequestError(`unsupported string token: ${token.slice(0, 20)}`, {kind: "parse"});
  }
  const content = token.slice(1, -1).replace(/\\'/g, "'");
  return JSON.parse(`"${content.replace(/"/g, "\\\"")}"`);
}

function parseJsValue(token, variables = {}) {
  const text = asString(token).trim();
  if (!text) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(variables, text)) {
    return variables[text];
  }
  if (text === "null" || text === "undefined") {
    return null;
  }
  if (text === "true") {
    return true;
  }
  if (text === "false") {
    return false;
  }
  if (text[0] === "'" || text[0] === "\"") {
    return parseJsStringLiteral(text);
  }
  let numeric = text;
  if (numeric.startsWith(".")) {
    numeric = `0${numeric}`;
  } else if (numeric.startsWith("-.")) {
    numeric = `-0${numeric.slice(1)}`;
  }
  if (/^-?\d+$/.test(numeric)) {
    return Number.parseInt(numeric, 10);
  }
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(numeric)) {
    const parsed = Number(numeric);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return text;
}

function extractNuxtScript(html) {
  const marker = "window.__NUXT__=";
  const start = asString(html).indexOf(marker);
  if (start < 0) {
    throw createRequestError("window.__NUXT__ was not found in page HTML", {kind: "parse"});
  }
  const end = asString(html).indexOf("</script>", start);
  if (end < 0) {
    throw createRequestError("window.__NUXT__ script end was not found", {kind: "parse"});
  }
  return asString(html).slice(start, end);
}

function extractIifeVariables(script) {
  const functionMarker = "(function(";
  const functionStart = script.indexOf(functionMarker);
  if (functionStart < 0) {
    return {};
  }
  const paramsOpen = functionStart + "(function".length;
  const paramsClose = findMatching(script, paramsOpen, "(", ")");
  const params = script.slice(paramsOpen + 1, paramsClose)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const bodyOpen = script.indexOf("{", paramsClose);
  if (bodyOpen < 0) {
    return {};
  }
  const bodyClose = findMatching(script, bodyOpen, "{", "}");
  let argsOpen = bodyClose + 1;
  while (argsOpen < script.length && /\s/.test(script[argsOpen])) {
    argsOpen += 1;
  }
  if (argsOpen >= script.length || script[argsOpen] !== "(") {
    return {};
  }
  const argsClose = findMatching(script, argsOpen, "(", ")");
  const argTokens = splitTopLevel(script.slice(argsOpen + 1, argsClose));
  const variables = {};
  for (let index = 0; index < Math.min(params.length, argTokens.length); index += 1) {
    variables[params[index]] = parseJsValue(argTokens[index], {});
  }
  return variables;
}

function parseJsObjectLiteral(objectText, variables = {}) {
  let text = asString(objectText).trim();
  if (text.startsWith("{") && text.endsWith("}")) {
    text = text.slice(1, -1);
  }
  const parsed = {};
  for (const field of splitTopLevel(text)) {
    const colonIndex = field.indexOf(":");
    if (colonIndex < 0) {
      continue;
    }
    const rawKey = field.slice(0, colonIndex).trim();
    const key = rawKey.replace(/^['"]|['"]$/g, "");
    if (!["itemId", "tag", "enTag", "marketHashName"].includes(key)) {
      continue;
    }
    const value = parseJsValue(field.slice(colonIndex + 1), variables);
    parsed[key] = key === "itemId" && value !== null && value !== undefined ? String(value) : value;
  }
  return parsed;
}

function extractRelatedListFromHtml(html) {
  const script = extractNuxtScript(html);
  const variables = extractIifeVariables(script);
  const match = /relatedList\s*:\s*\[/g.exec(script);
  if (!match) {
    throw createRequestError("relatedList was not found in window.__NUXT__", {kind: "parse"});
  }
  const arrayOpen = script.indexOf("[", match.index);
  const arrayClose = findMatching(script, arrayOpen, "[", "]");
  const arrayContent = script.slice(arrayOpen + 1, arrayClose).trim();
  if (!arrayContent) {
    return [];
  }
  return splitTopLevel(arrayContent)
    .map((itemText) => parseJsObjectLiteral(itemText, variables))
    .filter((item) => Object.keys(item).length > 0);
}

function filterWearOptions(relatedList) {
  const seen = new Set();
  const wearOptions = [];
  for (const item of Array.isArray(relatedList) ? relatedList : []) {
    const tag = normalizeText(item && item.tag);
    const enTag = normalizeText(item && item.enTag);
    if (VERSION_OR_QUALITY_LABELS.has(tag) || VERSION_OR_QUALITY_LABELS.has(enTag)) {
      continue;
    }
    const wear = canonicalWear(enTag) || canonicalWear(tag);
    const itemId = normalizeText(item && item.itemId);
    if (!wear || !itemId || seen.has(itemId)) {
      continue;
    }
    seen.add(itemId);
    wearOptions.push({
      ...item,
      itemId,
      canonicalWear: wear,
      wearRank: WEAR_RANK_BY_EN.get(wear)
    });
  }
  return wearOptions.sort((left, right) => left.wearRank - right.wearRank);
}

function extractRangesFromPayload(payload) {
  const data = payload && payload.data;
  const candidates = Array.isArray(data)
    ? data
    : (data && (data.list || data.ranges || data.data)) || [];
  if (!Array.isArray(candidates)) {
    throw createRequestError("wear range payload data is not a list", {kind: "parse"});
  }
  const ranges = [];
  for (const item of candidates) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const begin = parseFloatValue(item.begin);
    const end = parseFloatValue(item.end);
    if (begin === null || end === null) {
      continue;
    }
    ranges.push({begin, end});
  }
  if (!ranges.length) {
    throw createRequestError("wear range payload did not contain numeric begin/end values", {kind: "parse"});
  }
  return ranges;
}

function computeWearRange(lowRanges, highRanges) {
  const lowBegins = lowRanges.map((item) => parseFloatValue(item && item.begin)).filter((value) => value !== null);
  const highEnds = highRanges.map((item) => parseFloatValue(item && item.end)).filter((value) => value !== null);
  if (!lowBegins.length || !highEnds.length) {
    throw createRequestError("cannot compute min/max from empty begin/end lists", {kind: "parse"});
  }
  const minfloat = Math.min(...lowBegins);
  const maxfloat = Math.max(...highEnds);
  return {
    minfloat: roundFloat(minfloat),
    maxfloat: roundFloat(maxfloat),
    wear_range: roundFloat(maxfloat - minfloat)
  };
}

function hasSingleWearLevel(options = {}) {
  const rows = Array.isArray(options.rows) ? options.rows : [];
  const levels = rows
    .map((row) => canonicalWear(row && row.wearlevel))
    .filter(Boolean);
  return levels.length > 0 && new Set(levels).size === 1;
}

function getExpectedWearRankBounds(options = {}) {
  const rows = Array.isArray(options.rows) ? options.rows : [];
  const ranks = rows
    .map((row) => canonicalWear(row && row.wearlevel))
    .filter(Boolean)
    .map((wear) => WEAR_RANK_BY_EN.get(wear))
    .filter((rank) => Number.isFinite(rank));
  if (!ranks.length) {
    return null;
  }
  return {
    lowestRank: Math.min(...ranks),
    highestRank: Math.max(...ranks)
  };
}

function assertRelatedListCoversExpectedWearBounds(wearOptions, options = {}) {
  const expected = getExpectedWearRankBounds(options);
  if (!expected) {
    return;
  }
  const actualRanks = (Array.isArray(wearOptions) ? wearOptions : [])
    .map((item) => Number(item && item.wearRank))
    .filter((rank) => Number.isFinite(rank));
  if (!actualRanks.length) {
    throw createRequestError("relatedList contained no accepted wear labels", {kind: "parse"});
  }
  const actualLowestRank = Math.min(...actualRanks);
  const actualHighestRank = Math.max(...actualRanks);
  if (actualLowestRank > expected.lowestRank || actualHighestRank < expected.highestRank) {
    const expectedLowest = WEAR_ORDER[expected.lowestRank] && WEAR_ORDER[expected.lowestRank][0] || "";
    const expectedHighest = WEAR_ORDER[expected.highestRank] && WEAR_ORDER[expected.highestRank][0] || "";
    const actualLowest = WEAR_ORDER[actualLowestRank] && WEAR_ORDER[actualLowestRank][0] || "";
    const actualHighest = WEAR_ORDER[actualHighestRank] && WEAR_ORDER[actualHighestRank][0] || "";
    throw createRequestError(
      `relatedList wear levels do not cover expected rows expected=${expectedLowest}..${expectedHighest} actual=${actualLowest}..${actualHighest}`,
      {kind: "parse"}
    );
  }
}

function createC5SkinDetailProvider({
  fetchImpl = global.fetch,
  logger = null,
  pageBaseUrl = DEFAULT_PAGE_BASE_URL,
  apiBaseUrl = DEFAULT_API_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryLimit = DEFAULT_RETRY_LIMIT,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetchImpl must be a function");
  }

  async function fetchRangesByItemId(itemId) {
    const payload = await requestJson({
      fetchImpl,
      timeoutMs,
      retryLimit,
      retryDelayMs,
      logger,
      headers: {
        Accept: RANGE_ACCEPT,
        "Accept-Language": "zh-CN,zh;q=0.9",
        "User-Agent": BROWSER_USER_AGENT
      },
      label: `c5 wear range item_id=${normalizeText(itemId)}`,
      url: buildRangeUrl(itemId, apiBaseUrl)
    });
    return extractRangesFromPayload(payload);
  }

  async function fetchWearRangeByC5Id(c5id, options = {}) {
    const targetId = normalizeText(c5id);
    if (!targetId) {
      throw new Error("c5id is required");
    }
    const pageUrl = buildSellUrl(targetId, options, pageBaseUrl);
    const html = await requestText({
      fetchImpl,
      timeoutMs,
      retryLimit,
      retryDelayMs,
      logger,
      headers: {
        Accept: PAGE_ACCEPT,
        "Accept-Language": "zh-CN,zh;q=0.9",
        "User-Agent": BROWSER_USER_AGENT
      },
      label: `c5 sell page c5id=${targetId}`,
      url: pageUrl
    });
    const relatedList = extractRelatedListFromHtml(html);
    const wearOptions = filterWearOptions(relatedList);
    if (!wearOptions.length) {
      if (Array.isArray(relatedList) && relatedList.length > 0) {
        throw createRequestError("relatedList contained no accepted wear labels", {kind: "parse"});
      }
      if (!hasSingleWearLevel(options)) {
        throw createRequestError("relatedList contained no accepted wear labels", {kind: "parse"});
      }
      const ranges = await fetchRangesByItemId(targetId);
      return computeWearRange(ranges, ranges);
    }
    assertRelatedListCoversExpectedWearBounds(wearOptions, options);

    const lowest = wearOptions[0];
    const highest = wearOptions[wearOptions.length - 1];
    const lowRanges = await fetchRangesByItemId(lowest.itemId);
    const highRanges = highest.itemId === lowest.itemId
      ? lowRanges
      : await fetchRangesByItemId(highest.itemId);
    return computeWearRange(lowRanges, highRanges);
  }

  return {
    fetchWearRangeByC5Id
  };
}

module.exports = {
  createC5SkinDetailProvider
};
