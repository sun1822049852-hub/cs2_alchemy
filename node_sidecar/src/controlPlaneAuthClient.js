const {asString} = require("./utils");
const {assertSecureControlPlaneBaseUrl} = require("./controlPlaneUrlPolicy");

function buildClientAuthError({
  code = "auth_request_failed",
  message = "认证请求失败",
  status = 500,
  data = null
} = {}) {
  const error = new Error(asString(message).trim() || "认证请求失败");
  error.code = asString(code).trim() || "auth_request_failed";
  error.status = Number(status) || 500;
  error.data = data;
  return error;
}

function joinUrl(baseUrl, pathname) {
  const base = asString(baseUrl).trim().replace(/\/+$/g, "");
  const nextPath = `/${asString(pathname).trim().replace(/^\/+/g, "")}`;
  return `${base}${nextPath}`;
}

function normalizeBundleAndRefresh(data = {}) {
  const value = data && typeof data === "object" ? data : {};
  const rawBundle = value.access_bundle && typeof value.access_bundle === "object"
    ? value.access_bundle
    : (value.bundle && typeof value.bundle === "object" ? value.bundle : null);
  const refreshCredential = asString(
    value.refresh_token
    || value.refresh_credential
    || (rawBundle && rawBundle.refresh_credential)
    || ""
  ).trim();
  return {
    bundle: rawBundle ? {...rawBundle} : null,
    refreshCredential
  };
}

async function readJsonResponse(response) {
  let data = {};
  try {
    data = await response.json();
  } catch (_) {
    data = {};
  }
  return data && typeof data === "object" ? data : {};
}

function createControlPlaneAuthClient({
  baseUrl = "",
  fetchFn = globalThis.fetch,
  requestTimeoutMs = 10 * 1000
} = {}) {
  const normalizedBaseUrl = asString(baseUrl).trim().replace(/\/+$/g, "");
  let baseUrlError = null;
  let secureBaseUrl = "";
  const timeoutMs = Math.max(1, Number(requestTimeoutMs) || 10 * 1000);
  try {
    secureBaseUrl = assertSecureControlPlaneBaseUrl(normalizedBaseUrl);
  } catch (err) {
    baseUrlError = err;
  }

  function assertConfigured() {
    if (baseUrlError) {
      throw baseUrlError;
    }
    if (secureBaseUrl) {
      return;
    }
    throw buildClientAuthError({
      code: "auth_service_not_configured",
      message: "未配置本地控制平面地址",
      status: 503
    });
  }

  function buildTimeoutError() {
    return buildClientAuthError({
      code: "auth_request_timeout",
      message: "本地控制平面请求超时",
      status: 504
    });
  }

  async function requestJsonWithTimeout(url, options = {}) {
    const controller = new AbortController();
    let timeoutId = null;
    let timedOut = false;
    const timeoutError = buildTimeoutError();
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(timeoutError);
      }, timeoutMs);
    });
    try {
      const result = await Promise.race([
        (async () => {
          const response = await fetchFn(url, {...options, signal: controller.signal});
          const data = await readJsonResponse(response);
          return {response, data};
        })(),
        timeout
      ]);
      if (timedOut) throw timeoutError;
      return result;
    } catch (err) {
      if (timedOut) throw timeoutError;
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async function getJson(pathname) {
    assertConfigured();
    if (typeof fetchFn !== "function") {
      throw buildClientAuthError({
        code: "fetch_unavailable",
        message: "当前运行时不支持本地控制平面请求",
        status: 500
      });
    }
    let result;
    try {
      result = await requestJsonWithTimeout(joinUrl(normalizedBaseUrl, pathname), {
        method: "GET",
        headers: {
          "Accept": "application/json"
        }
      });
    } catch (err) {
      if (err && err.code === "auth_request_timeout") throw err;
      throw buildClientAuthError({
        code: "auth_service_unreachable",
        message: asString(err && err.message ? err.message : err).trim() || "本地控制平面不可达",
        status: 503
      });
    }
    const {response, data} = result;
    if (!response.ok || data.ok === false) {
      throw buildClientAuthError({
        code: asString(data.code || data.reason || "auth_request_failed").trim() || "auth_request_failed",
        message: asString(data.message || "控制平面请求失败").trim() || "控制平面请求失败",
        status: Number(response.status) || 500,
        data
      });
    }
    return data;
  }

  async function postJson(pathname, payload) {
    assertConfigured();
    if (typeof fetchFn !== "function") {
      throw buildClientAuthError({
        code: "fetch_unavailable",
        message: "当前运行时不支持本地控制平面请求",
        status: 500
      });
    }
    let result;
    try {
      result = await requestJsonWithTimeout(joinUrl(normalizedBaseUrl, pathname), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload || {})
      });
    } catch (err) {
      if (err && err.code === "auth_request_timeout") throw err;
      throw buildClientAuthError({
        code: "auth_service_unreachable",
        message: asString(err && err.message ? err.message : err).trim() || "本地控制平面不可达",
        status: 503
      });
    }
    const {response, data} = result;
    if (!response.ok || data.ok === false) {
      throw buildClientAuthError({
        code: asString(data.code || data.reason || "auth_request_failed").trim() || "auth_request_failed",
        message: asString(data.message || "认证请求失败").trim() || "认证请求失败",
        status: Number(response.status) || 500,
        data
      });
    }
    return data;
  }

  return {
    getCapabilities() {
      return {
        configured: !!secureBaseUrl && !baseUrlError,
        baseUrl: baseUrlError ? "" : secureBaseUrl
      };
    },
    async login({username = "", password = "", deviceId = "", clientVersion = ""} = {}) {
      const data = await postJson("/api/auth/login", {
        username: asString(username).trim(),
        password: asString(password),
        device_id: asString(deviceId).trim(),
        client_version: asString(clientVersion).trim()
      });
      const normalized = normalizeBundleAndRefresh(data);
      return {
        user: data.user && typeof data.user === "object" ? data.user : null,
        bundle: normalized.bundle,
        refreshCredential: normalized.refreshCredential
      };
    },
    async refresh({refreshCredential = "", deviceId = ""} = {}) {
      const data = await postJson("/api/auth/refresh", {
        refresh_token: asString(refreshCredential).trim(),
        device_id: asString(deviceId).trim()
      });
      const normalized = normalizeBundleAndRefresh(data);
      return {
        bundle: normalized.bundle,
        refreshCredential: normalized.refreshCredential
      };
    },
    async getMembershipProducts() {
      const data = await getJson("/api/auth/membership/products");
      return {
        ...data,
        products: Array.isArray(data.products)
          ? data.products
          : (Array.isArray(data.items) ? data.items : [])
      };
    },
    async redeemActivationCode({
      refreshCredential = "",
      deviceId = "",
      code = ""
    } = {}) {
      const data = await postJson("/api/auth/membership/redeem", {
        refresh_token: asString(refreshCredential).trim(),
        device_id: asString(deviceId).trim(),
        code: asString(code).trim()
      });
      const normalized = normalizeBundleAndRefresh(data);
      return {
        user: data.user && typeof data.user === "object" ? data.user : null,
        bundle: normalized.bundle,
        refreshCredential: normalized.refreshCredential
      };
    },
    async checkoutMembership({refreshCredential = "", deviceId = "", productId = ""} = {}) {
      return postJson("/api/auth/payment/checkout", {
        refresh_token: asString(refreshCredential).trim(),
        device_id: asString(deviceId).trim(),
        product_id: asString(productId).trim()
      });
    },
    async logout({refreshCredential = ""} = {}) {
      return postJson("/api/auth/logout", {
        refresh_token: asString(refreshCredential).trim()
      });
    },
    async sendRegisterCode({email = ""} = {}) {
      return postJson("/api/auth/email/send-code", {
        email: asString(email).trim(),
        scene: "register"
      });
    },
    async register({email = "", code = "", username = "", password = ""} = {}) {
      return postJson("/api/auth/register", {
        email: asString(email).trim(),
        code: asString(code).trim(),
        username: asString(username).trim(),
        password: asString(password)
      });
    },
    async getRegistrationReadiness() {
      return getJson("/api/auth/register/readiness");
    },
    async verifyRegisterCode({email = "", code = "", registerSessionId = ""} = {}) {
      return postJson("/api/auth/register/verify-code", {
        email: asString(email).trim(),
        code: asString(code).trim(),
        register_session_id: asString(registerSessionId).trim()
      });
    },
    async completeRegister({email = "", verificationTicket = "", username = "", password = "", deviceId = ""} = {}) {
      const data = await postJson("/api/auth/register/complete", {
        email: asString(email).trim(),
        verification_ticket: asString(verificationTicket).trim(),
        username: asString(username).trim(),
        password: asString(password),
        device_id: asString(deviceId).trim()
      });
      const normalized = normalizeBundleAndRefresh(data);
      return {
        user: data.user && typeof data.user === "object" ? data.user : null,
        bundle: normalized.bundle,
        refreshCredential: normalized.refreshCredential
      };
    },
    async sendResetCode({email = ""} = {}) {
      return postJson("/api/auth/password/send-reset-code", {
        email: asString(email).trim()
      });
    },
    async resetPassword({email = "", code = "", newPassword = ""} = {}) {
      return postJson("/api/auth/password/reset", {
        email: asString(email).trim(),
        code: asString(code).trim(),
        new_password: asString(newPassword)
      });
    }
  };
}

module.exports = {
  createControlPlaneAuthClient,
  buildClientAuthError
};
