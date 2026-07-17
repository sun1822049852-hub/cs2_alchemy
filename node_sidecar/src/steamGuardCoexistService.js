const crypto = require("crypto");

const {generateTotp} = require("./maFileParser");

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_APP_CODE_ATTEMPTS = 3;
const AUTHENTICATOR_REQUIRED_FIELDS = [
  "shared_secret",
  "identity_secret",
  "serial_number",
  "revocation_code"
];

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function secretToBase64(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString("base64");
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }
  return text(value);
}

function normalizeLoginStatus(result) {
  const raw = text(
    result && (
      result.status ||
      result.guardType ||
      result.guard_type ||
      result.state
    )
  ).toLowerCase();

  if (["requiresemailauth", "emailcode", "email_code", "email_code_required"].includes(raw)) {
    return "email_required";
  }
  if ([
    "requires2fa",
    "requires_2fa",
    "devicecode",
    "device_code",
    "deviceconfirmation",
    "device_confirmation"
  ].includes(raw)) {
    return "already_has_authenticator";
  }
  if (["authenticated", "success", "done"].includes(raw)) {
    return "authenticated";
  }
  if (result && result.ok === true && result.done === false && result.guard_type === "email_code") {
    return "email_required";
  }
  if (result && result.ok === true && result.done === true) {
    return "authenticated";
  }
  return "unknown";
}

function extractRefreshToken(result) {
  return text(
    result && (
      result.refreshToken ||
      result.refresh_token ||
      (result.result && (result.result.refreshToken || result.result.refresh_token))
    )
  );
}

function extractSteamId64(result) {
  return text(
    result && (
      result.steamId64 ||
      result.steam_id64 ||
      result.steamid ||
      (result.result && (result.result.steamId64 || result.result.steam_id64 || result.result.steamid))
    )
  );
}

function extractAuthenticatorPayload(response) {
  if (response && response.response && typeof response.response === "object") {
    return response.response;
  }
  return response && typeof response === "object" ? response : {};
}

function normalizeAuthenticatorPayload(response) {
  const payload = extractAuthenticatorPayload(response);
  return {
    shared_secret: secretToBase64(payload.shared_secret),
    identity_secret: secretToBase64(payload.identity_secret),
    serial_number: text(payload.serial_number),
    revocation_code: text(payload.revocation_code),
    uri: text(payload.uri),
    server_time: text(payload.server_time),
    account_name: text(payload.account_name),
    token_gid: text(payload.token_gid),
    secret_1: secretToBase64(payload.secret_1),
    status: Number(payload.status) || 1,
    steamguard_scheme: Number(payload.steamguard_scheme) || 0
  };
}

function constantTimeCodeMatch(actualCode, expectedCode) {
  const expected = Buffer.from(text(expectedCode), "utf8");
  const actual = Buffer.from(text(actualCode), "utf8");
  const comparable = Buffer.alloc(expected.length);
  actual.copy(comparable, 0, 0, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(comparable, expected);
}

class SteamGuardCoexistService {
  constructor({
    loginAdapter,
    exchangeAccessToken,
    addAuthenticator,
    completeBinding = null,
    now = Date.now,
    randomUUID = crypto.randomUUID,
    ttlMs = DEFAULT_TTL_MS,
    generateTotpCode = generateTotp
  } = {}) {
    if (!loginAdapter || typeof loginAdapter.start !== "function" || typeof loginAdapter.submitEmailCode !== "function") {
      throw new Error("loginAdapter.start and loginAdapter.submitEmailCode are required");
    }
    if (typeof exchangeAccessToken !== "function") {
      throw new Error("exchangeAccessToken is required");
    }
    if (typeof addAuthenticator !== "function") {
      throw new Error("addAuthenticator is required");
    }
    if (completeBinding !== null && typeof completeBinding !== "function") {
      throw new Error("completeBinding must be a function");
    }

    this.loginAdapter = loginAdapter;
    this.exchangeAccessToken = exchangeAccessToken;
    this.addAuthenticator = addAuthenticator;
    this.completeBinding = completeBinding;
    this.now = now;
    this.randomUUID = randomUUID;
    this.ttlMs = Math.max(1, Number(ttlMs) || DEFAULT_TTL_MS);
    this.generateTotpCode = generateTotpCode;
    this.flows = new Map();
  }

  async start({mode, username, password, remark = "", accountId = null} = {}) {
    this.cleanupExpired();

    const normalizedMode = text(mode).toLowerCase();
    const accountName = text(username);
    const accountPassword = password === undefined || password === null ? "" : String(password);
    if (!['existing', 'new'].includes(normalizedMode)) {
      return {ok: false, reason: "invalid_mode"};
    }
    if (!accountName) {
      return {ok: false, reason: "username_required"};
    }
    if (!accountPassword) {
      return {ok: false, reason: "password_required"};
    }

    const flowId = text(this.randomUUID());
    const startedAt = this.now();
    const flow = {
      flowId,
      mode: normalizedMode,
      accountId,
      username: accountName,
      password: accountPassword,
      remark: text(remark),
      state: "logging_in",
      session: null,
      refreshToken: "",
      accessToken: "",
      steamId64: "",
      deviceId: `android:${text(this.randomUUID())}`,
      candidate: null,
      attempts: 0,
      startedAt,
      expiresAt: startedAt + this.ttlMs,
      expiryTimer: null
    };
    this.flows.set(flowId, flow);
    flow.expiryTimer = setTimeout(() => {
      this._destroyFlow(flowId);
    }, this.ttlMs);
    if (flow.expiryTimer && typeof flow.expiryTimer.unref === "function") {
      flow.expiryTimer.unref();
    }

    try {
      const loginResult = await this.loginAdapter.start({
        username: accountName,
        password: accountPassword,
        persistToken: false
      });
      return await this._continueFromLogin(flow, loginResult);
    } catch (_) {
      this._destroyFlow(flowId);
      return {ok: false, reason: "login_failed"};
    }
  }

  async submitEmailCode({flowId, code, accountId} = {}) {
    const flow = this._getActiveFlow(flowId, accountId);
    if (!flow) {
      return {ok: false, reason: "flow_not_found"};
    }
    if (flow.state !== "email_code_required") {
      return {ok: false, reason: "invalid_flow_state"};
    }
    if (!text(code)) {
      return {ok: false, reason: "email_code_required"};
    }

    try {
      const loginResult = await this.loginAdapter.submitEmailCode({
        session: flow.session,
        code: text(code),
        persistToken: false
      });
      return await this._continueFromLogin(flow, loginResult);
    } catch (_) {
      this._destroyFlow(flow.flowId);
      return {ok: false, reason: "login_failed"};
    }
  }

  async verifyAppCode({flowId, code, accountId} = {}) {
    const flow = this._getActiveFlow(flowId, accountId);
    if (!flow) {
      return {ok: false, reason: "flow_not_found"};
    }
    if (flow.state !== "steam_app_binding_required" || !flow.candidate) {
      return {ok: false, reason: "invalid_flow_state"};
    }
    flow.state = "verifying_app_code";

    let expectedCode;
    try {
      expectedCode = this.generateTotpCode(flow.candidate.shared_secret);
    } catch (_) {
      this._destroyFlow(flow.flowId);
      return {ok: false, reason: "totp_generation_failed"};
    }

    if (!constantTimeCodeMatch(code, expectedCode)) {
      flow.attempts += 1;
      if (flow.attempts >= MAX_APP_CODE_ATTEMPTS) {
        this._destroyFlow(flow.flowId);
        return {ok: false, reason: "app_code_attempts_exceeded"};
      }
      flow.state = "steam_app_binding_required";
      return {
        ok: false,
        reason: "app_code_mismatch",
        attempts_remaining: MAX_APP_CODE_ATTEMPTS - flow.attempts
      };
    }

    const maFile = this._buildMaFile(flow);
    const maFileContent = JSON.stringify(maFile);
    const result = {
      ok: true,
      state: "verified",
      mode: flow.mode,
      account_id: flow.accountId,
      account_name: flow.username,
      steam_id64: flow.steamId64,
      file_name: `${flow.username}.maFile`,
      maFile,
      maFileContent
    };

    try {
      if (this.completeBinding) {
        await this.completeBinding({
          mode: flow.mode,
          accountId: flow.accountId,
          accountName: flow.username,
          password: flow.password,
          remark: flow.remark,
          steamId64: flow.steamId64,
          maFile,
          maFileContent,
          fileName: result.file_name
        });
      }
    } catch (_) {
      this._destroyFlow(flow.flowId);
      return {ok: false, reason: "persistence_failed"};
    }

    this._destroyFlow(flow.flowId);
    return result;
  }

  cancel(flowId, {accountId} = {}) {
    const key = text(flowId);
    const flow = this.flows.get(key);
    if (!flow || (accountId !== undefined && accountId !== null && text(flow.accountId) !== text(accountId))) {
      return {ok: false, reason: "flow_not_found"};
    }
    this._destroyFlow(key);
    return {ok: true};
  }

  cleanupExpired() {
    const currentTime = this.now();
    let cleaned = 0;
    for (const [flowId, flow] of this.flows) {
      if (currentTime >= flow.expiresAt) {
        this._destroyFlow(flowId);
        cleaned += 1;
      }
    }
    return cleaned;
  }

  async _continueFromLogin(flow, loginResult) {
    if (!this.flows.has(flow.flowId)) {
      return {ok: false, reason: "flow_not_found"};
    }

    if (loginResult && loginResult.session) {
      flow.session = loginResult.session;
    }
    const status = normalizeLoginStatus(loginResult);
    if (status === "email_required") {
      flow.state = "email_code_required";
      return {
        ok: true,
        state: "email_code_required",
        flow_id: flow.flowId,
        guard_hint: text(loginResult && (loginResult.guardHint || loginResult.guard_hint)),
        expires_in_seconds: Math.ceil(this.ttlMs / 1000)
      };
    }
    if (status === "already_has_authenticator") {
      this._destroyFlow(flow.flowId);
      return {ok: false, reason: "already_has_authenticator"};
    }
    if (status !== "authenticated") {
      this._destroyFlow(flow.flowId);
      return {ok: false, reason: "unsupported_login_state"};
    }

    flow.refreshToken = extractRefreshToken(loginResult);
    flow.steamId64 = extractSteamId64(loginResult);
    if (!flow.refreshToken) {
      this._destroyFlow(flow.flowId);
      return {ok: false, reason: "refresh_token_missing"};
    }

    try {
      flow.accessToken = text(await this.exchangeAccessToken(flow.refreshToken));
    } catch (_) {
      this._destroyFlow(flow.flowId);
      return {ok: false, reason: "access_token_exchange_failed"};
    }
    if (!flow.accessToken) {
      this._destroyFlow(flow.flowId);
      return {ok: false, reason: "access_token_missing"};
    }

    let response;
    try {
      response = await this.addAuthenticator({
        refreshToken: flow.refreshToken,
        accessToken: flow.accessToken,
        steamId64: flow.steamId64,
        deviceId: flow.deviceId
      });
    } catch (_) {
      this._destroyFlow(flow.flowId);
      return {ok: false, reason: "add_authenticator_failed"};
    }

    const responsePayload = extractAuthenticatorPayload(response);
    const statusCode = Number(responsePayload.status ?? (response && response.status));
    if (statusCode === 29) {
      this._destroyFlow(flow.flowId);
      return {ok: false, reason: "already_has_authenticator"};
    }
    if (Number.isFinite(statusCode) && statusCode !== 1) {
      this._destroyFlow(flow.flowId);
      return {ok: false, reason: "add_authenticator_failed", status: statusCode};
    }

    const candidate = normalizeAuthenticatorPayload(response);
    const missingFields = AUTHENTICATOR_REQUIRED_FIELDS.filter((field) => !candidate[field]);
    if (missingFields.length) {
      this._destroyFlow(flow.flowId);
      return {
        ok: false,
        reason: "invalid_authenticator_response",
        missing_fields: missingFields
      };
    }

    flow.candidate = candidate;
    flow.state = "steam_app_binding_required";
    this._releaseLoginSession(flow);
    return {
      ok: true,
      state: "steam_app_binding_required",
      flow_id: flow.flowId,
      expires_in_seconds: Math.max(0, Math.ceil((flow.expiresAt - this.now()) / 1000))
    };
  }

  _buildMaFile(flow) {
    const candidate = flow.candidate;
    return {
      shared_secret: candidate.shared_secret,
      serial_number: candidate.serial_number,
      revocation_code: candidate.revocation_code,
      uri: candidate.uri,
      server_time: candidate.server_time,
      account_name: candidate.account_name || flow.username,
      token_gid: candidate.token_gid,
      identity_secret: candidate.identity_secret,
      secret_1: candidate.secret_1,
      status: candidate.status || 1,
      device_id: flow.deviceId,
      fully_enrolled: true,
      steamid: flow.steamId64,
      steamguard_scheme: candidate.steamguard_scheme ? String(candidate.steamguard_scheme) : "",
      Session: null
    };
  }

  _getActiveFlow(flowId, accountId) {
    const key = text(flowId);
    const flow = this.flows.get(key);
    if (!flow) {
      return null;
    }
    if (accountId !== undefined && accountId !== null && text(flow.accountId) !== text(accountId)) {
      return null;
    }
    if (this.now() >= flow.expiresAt) {
      this._destroyFlow(key);
      return null;
    }
    return flow;
  }

  _releaseLoginSession(flow) {
    const session = flow.session;
    flow.refreshToken = "";
    flow.accessToken = "";
    flow.session = null;
    if (!session) {
      return;
    }
    try {
      if (typeof this.loginAdapter.cancel === "function") {
        const pending = this.loginAdapter.cancel({session});
        if (pending && typeof pending.catch === "function") {
          pending.catch(() => {});
        }
      } else if (typeof session.cancelLoginAttempt === "function") {
        session.cancelLoginAttempt();
      }
    } catch (_) {
      // Cleanup is best-effort; references are cleared even if the adapter fails.
    }
  }

  _destroyFlow(flowId) {
    const key = text(flowId);
    const flow = this.flows.get(key);
    if (!flow) {
      return;
    }
    this.flows.delete(key);
    if (flow.expiryTimer) {
      clearTimeout(flow.expiryTimer);
      flow.expiryTimer = null;
    }
    this._releaseLoginSession(flow);
    flow.password = "";
    flow.remark = "";
    if (flow.candidate) {
      for (const field of Object.keys(flow.candidate)) {
        flow.candidate[field] = "";
      }
    }
    flow.candidate = null;
  }
}

function createSteamGuardCoexistService(options) {
  return new SteamGuardCoexistService(options);
}

module.exports = {
  DEFAULT_TTL_MS,
  SteamGuardCoexistService,
  createSteamGuardCoexistService
};
