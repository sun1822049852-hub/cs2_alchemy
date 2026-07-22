const crypto = require("crypto");

const STEAM_VERIFICATION_CODE_PATTERN = /^[A-Z0-9]{5}$/;
const ALREADY_HAS_AUTHENTICATOR_COOLDOWN_MS = 60 * 1000;

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function isRetryableVerification(result) {
  return result && result.ok === false
    && ["app_code_mismatch", "time_sync_failed", "invalid_code_format"].includes(text(result.reason));
}

function isRetryableEmailCode(result) {
  return result && result.ok === false
    && ["invalid_email_code", "invalid_code_format"].includes(text(result.reason));
}

class SteamGuardCoexistService {
  constructor({
    processAdapter,
    completeBinding = null,
    randomUUID = crypto.randomUUID,
    now = Date.now,
    alreadyHasAuthenticatorCooldownMs = ALREADY_HAS_AUTHENTICATOR_COOLDOWN_MS
  } = {}) {
    if (
      !processAdapter
      || typeof processAdapter.start !== "function"
      || typeof processAdapter.submitEmailCode !== "function"
      || typeof processAdapter.verifyAppCode !== "function"
      || typeof processAdapter.cancel !== "function"
    ) {
      throw new Error("processAdapter start/submitEmailCode/verifyAppCode/cancel are required");
    }
    if (completeBinding !== null && typeof completeBinding !== "function") {
      throw new Error("completeBinding must be a function");
    }
    this.processAdapter = processAdapter;
    this.completeBinding = completeBinding;
    this.randomUUID = randomUUID;
    this.now = now;
    this.alreadyHasAuthenticatorCooldownMs = Math.max(
      1000,
      Number(alreadyHasAuthenticatorCooldownMs) || ALREADY_HAS_AUTHENTICATOR_COOLDOWN_MS
    );
    this.flows = new Map();
    this.alreadyHasAuthenticatorCooldowns = new Map();
  }

  async start({mode, username, password, remark = "", accountId = null} = {}) {
    const normalizedMode = text(mode).toLowerCase();
    const accountName = text(username);
    const accountPassword = password === undefined || password === null ? "" : String(password);
    if (!["existing", "new"].includes(normalizedMode)) return {ok: false, reason: "invalid_mode"};
    if (!accountName) return {ok: false, reason: "username_required"};
    if (!accountPassword) return {ok: false, reason: "password_required"};
    const cooldown = this._getAuthenticatorCooldown(accountName);
    if (cooldown) return cooldown;

    const flowId = text(this.randomUUID());
    const flow = {
      flowId,
      mode: normalizedMode,
      accountId,
      username: accountName,
      remark: text(remark),
      state: "starting"
    };
    this.flows.set(flowId, flow);

    let result;
    try {
      result = await this.processAdapter.start({
        flowId,
        username: accountName,
        password: accountPassword
      });
    } catch (_) {
      this._destroyFlow(flowId);
      return {ok: false, reason: "coexist_worker_failed"};
    }
    if (!this.flows.has(flowId)) return {ok: false, reason: "flow_not_found"};
    if (!result || result.ok === false) {
      result = this._recordAuthenticatorCooldown(flow, result);
      this._destroyFlow(flowId);
      return result && typeof result === "object" ? result : {ok: false, reason: "coexist_worker_failed"};
    }
    if (text(result.flow_id) !== flowId) {
      this._destroyFlow(flowId);
      return {ok: false, reason: "coexist_worker_invalid_response"};
    }
    flow.state = text(result.state);
    return result;
  }

  async submitEmailCode({flowId, code, accountId} = {}) {
    const flow = this._getActiveFlow(flowId, accountId);
    if (!flow) return {ok: false, reason: "flow_not_found"};
    if (flow.state !== "email_code_required") return {ok: false, reason: "invalid_flow_state"};
    if (!STEAM_VERIFICATION_CODE_PATTERN.test(text(code))) {
      return {ok: false, reason: "invalid_code_format"};
    }
    flow.state = "submitting_email_code";

    let result;
    try {
      result = await this.processAdapter.submitEmailCode({flowId: flow.flowId, code: text(code)});
    } catch (_) {
      this._destroyFlow(flow.flowId);
      return {ok: false, reason: "coexist_worker_failed"};
    }
    if (!this.flows.has(flow.flowId)) return {ok: false, reason: "flow_not_found"};
    if (isRetryableEmailCode(result)) {
      flow.state = "email_code_required";
      return result;
    }
    if (!result || result.ok === false) {
      result = this._recordAuthenticatorCooldown(flow, result);
      this._destroyFlow(flow.flowId);
      return result && typeof result === "object" ? result : {ok: false, reason: "coexist_worker_failed"};
    }
    flow.state = text(result.state);
    return result;
  }

  async verifyAppCode({flowId, code, accountId} = {}) {
    const flow = this._getActiveFlow(flowId, accountId);
    if (!flow) return {ok: false, reason: "flow_not_found"};
    if (flow.state !== "steam_app_binding_required") return {ok: false, reason: "invalid_flow_state"};
    if (!STEAM_VERIFICATION_CODE_PATTERN.test(text(code))) {
      return {ok: false, reason: "invalid_code_format"};
    }
    flow.state = "verifying_app_code";

    let result;
    try {
      result = await this.processAdapter.verifyAppCode({flowId: flow.flowId, code: text(code)});
    } catch (_) {
      this._destroyFlow(flow.flowId);
      return {ok: false, reason: "coexist_worker_failed"};
    }
    if (!this.flows.has(flow.flowId)) return {ok: false, reason: "flow_not_found"};
    if (isRetryableVerification(result)) {
      flow.state = "steam_app_binding_required";
      return result;
    }
    if (!result || result.ok === false || text(result.state) !== "verified") {
      this._destroyFlow(flow.flowId);
      return result && typeof result === "object" ? result : {ok: false, reason: "coexist_worker_failed"};
    }

    const maFile = result.maFile;
    const maFileContent = text(result.maFileContent);
    try {
      if (this.completeBinding) {
        await this.completeBinding({
          mode: flow.mode,
          accountId: flow.accountId,
          accountName: flow.username,
          password: result.password === undefined || result.password === null ? "" : String(result.password),
          remark: flow.remark,
          steamId64: text(result.steam_id64),
          maFile,
          maFileContent,
          fileName: text(result.file_name) || `${flow.username}.maFile`
        });
      }
    } catch (_) {
      this._destroyFlow(flow.flowId);
      return {ok: false, reason: "persistence_failed"};
    }

    const sanitized = {...result};
    delete sanitized.password;
    this._destroyFlow(flow.flowId);
    return sanitized;
  }

  cancel(flowId, {accountId} = {}) {
    const flow = this._getActiveFlow(flowId, accountId);
    if (!flow) return {ok: false, reason: "flow_not_found"};
    this._destroyFlow(flow.flowId);
    return {ok: true};
  }

  cleanupExpired() {
    return 0;
  }

  shutdown() {
    for (const flow of [...this.flows.values()]) this._destroyFlow(flow.flowId);
    this.alreadyHasAuthenticatorCooldowns.clear();
    if (typeof this.processAdapter.shutdown === "function") {
      try { this.processAdapter.shutdown(); } catch (_) {}
    }
  }

  _getActiveFlow(flowId, accountId) {
    const flow = this.flows.get(text(flowId));
    if (!flow) return null;
    if (accountId !== undefined && accountId !== null && text(flow.accountId) !== text(accountId)) return null;
    return flow;
  }

  _cooldownKey(username) {
    return text(username).toLowerCase();
  }

  _getAuthenticatorCooldown(username) {
    const key = this._cooldownKey(username);
    const expiresAt = Number(this.alreadyHasAuthenticatorCooldowns.get(key)) || 0;
    const remainingMs = expiresAt - this.now();
    if (remainingMs <= 0) {
      this.alreadyHasAuthenticatorCooldowns.delete(key);
      return null;
    }
    return {
      ok: false,
      reason: "already_has_authenticator_cooldown",
      retry_after_seconds: Math.ceil(remainingMs / 1000)
    };
  }

  _recordAuthenticatorCooldown(flow, result) {
    if (!result || result.ok !== false || text(result.reason) !== "already_has_authenticator") {
      return result;
    }
    this.alreadyHasAuthenticatorCooldowns.set(
      this._cooldownKey(flow && flow.username),
      this.now() + this.alreadyHasAuthenticatorCooldownMs
    );
    return {
      ...result,
      retry_after_seconds: Math.ceil(this.alreadyHasAuthenticatorCooldownMs / 1000)
    };
  }

  _destroyFlow(flowId) {
    const key = text(flowId);
    const flow = this.flows.get(key);
    if (!flow) return;
    this.flows.delete(key);
    try { this.processAdapter.cancel(key); } catch (_) {}
    flow.remark = "";
  }
}

function createSteamGuardCoexistService(options) {
  return new SteamGuardCoexistService(options);
}

module.exports = {
  ALREADY_HAS_AUTHENTICATOR_COOLDOWN_MS,
  STEAM_VERIFICATION_CODE_PATTERN,
  SteamGuardCoexistService,
  createSteamGuardCoexistService
};
