const {asString} = require("../utils");

const DEFAULT_BASE_URL = "https://open.steamdt.com";
const DEFAULT_TIMEOUT_MS = 60000;

function createRequestError(message) {
  return new Error(asString(message).trim() || "steamdt base info request failed");
}

async function readJsonResponse(response, label) {
  const text = typeof response.text === "function"
    ? await response.text()
    : JSON.stringify(typeof response.json === "function" ? await response.json() : {});
  try {
    return JSON.parse(text);
  } catch (_) {
    throw createRequestError(`${label} invalid_json`);
  }
}

function extractBaseInfoList(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && payload.success === true) {
    const data = payload.data;
    if (Array.isArray(data)) {
      return data;
    }
    if (Array.isArray(data && data.list)) {
      return data.list;
    }
  }
  const errorMsg = asString(payload && (payload.errorMsg || payload.message || payload.msg)).trim();
  throw createRequestError(errorMsg || "invalid_payload");
}

function createSteamdtBaseInfoProvider({
  apiKey,
  fetchImpl = global.fetch,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  if (!asString(apiKey).trim()) {
    throw new Error("apiKey is required");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("fetchImpl must be a function");
  }

  async function fetchBaseInfo() {
    const abortController = new AbortController();
    const timer = setTimeout(() => {
      abortController.abort();
    }, Math.max(1, Math.trunc(Number(timeoutMs) || 0) || DEFAULT_TIMEOUT_MS));
    const url = new URL("/open/cs2/v1/base", asString(baseUrl).trim() || DEFAULT_BASE_URL);

    try {
      const response = await fetchImpl(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${asString(apiKey).trim()}`,
          "Content-Type": "application/json"
        },
        signal: abortController.signal
      });
      if (!response || !response.ok) {
        throw createRequestError(`steamdt base info http=${response && response.status || 0}`);
      }
      const payload = await readJsonResponse(response, "steamdt base info");
      return extractBaseInfoList(payload);
    } catch (error) {
      const message = asString(error && error.message ? error.message : error).trim();
      if (/abort|timeout/i.test(message)) {
        throw createRequestError(`steamdt base info timeout(${Math.max(1, Math.trunc(Number(timeoutMs) || 0) || DEFAULT_TIMEOUT_MS)}ms)`);
      }
      throw error instanceof Error ? error : createRequestError(error);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    fetchBaseInfo
  };
}

module.exports = {
  createSteamdtBaseInfoProvider
};
