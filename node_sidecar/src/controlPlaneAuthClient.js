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
  fetchFn = globalThis.fetch
} = {}) {
  const normalizedBaseUrl = asString(baseUrl).trim().replace(/\/+$/g, "");
  let baseUrlError = null;
  let secureBaseUrl = "";
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
      message: "未配置远端认证服务地址",
      status: 503
    });
  }

  async function postJson(pathname, payload) {
    assertConfigured();
    if (typeof fetchFn !== "function") {
      throw buildClientAuthError({
        code: "fetch_unavailable",
        message: "当前运行时不支持远端认证请求",
        status: 500
      });
    }
    let response;
    try {
      response = await fetchFn(joinUrl(normalizedBaseUrl, pathname), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload || {})
      });
    } catch (err) {
      throw buildClientAuthError({
        code: "auth_service_unreachable",
        message: asString(err && err.message ? err.message : err).trim() || "远端认证服务不可达",
        status: 503
      });
    }
    const data = await readJsonResponse(response);
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
        password: asString(password).trim(),
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
    async issueCraftPermit({
      refreshCredential = "",
      deviceId = "",
      action = "",
      accountUsername = "",
      payloadHash = ""
    } = {}) {
      const data = await postJson("/api/auth/craft-permit", {
        refresh_token: asString(refreshCredential).trim(),
        device_id: asString(deviceId).trim(),
        action: asString(action).trim(),
        account_username: asString(accountUsername).trim(),
        payload_hash: asString(payloadHash).trim()
      });
      return {
        permit: data.permit && typeof data.permit === "object" ? {...data.permit} : null
      };
    },
    async checkOrBindSteamAccount({
      refreshCredential = "",
      deviceId = "",
      steamId = "",
      steamAccountName = ""
    } = {}) {
      const data = await postJson("/api/auth/steam-binding/check-or-bind", {
        refresh_token: asString(refreshCredential).trim(),
        device_id: asString(deviceId).trim(),
        steam_id: asString(steamId).trim(),
        steam_account_name: asString(steamAccountName).trim()
      });
      return {
        ok: data.ok !== false,
        bindingMode: asString(data.binding_mode).trim(),
        bindingLimit: Number(data.binding_limit),
        boundCount: Number(data.bound_count) || 0,
        matchedExisting: !!data.matched_existing,
        message: asString(data.message).trim()
      };
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
        password: asString(password).trim()
      });
    },
    async getRegistrationReadiness() {
      assertConfigured();
      if (typeof fetchFn !== "function") {
        throw buildClientAuthError({code: "fetch_unavailable", message: "当前运行时不支持远端认证请求", status: 500});
      }
      const response = await fetchFn(joinUrl(normalizedBaseUrl, "/api/auth/register/readiness"), {
        method: "GET",
        headers: {"Accept": "application/json"}
      });
      return readJsonResponse(response);
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
        password: asString(password).trim(),
        device_id: asString(deviceId).trim()
      });
      return {
        ...data,
        ...normalizeBundleAndRefresh(data)
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
        new_password: asString(newPassword).trim()
      });
    }
  };
}

module.exports = {
  createControlPlaneAuthClient,
  buildClientAuthError
};
