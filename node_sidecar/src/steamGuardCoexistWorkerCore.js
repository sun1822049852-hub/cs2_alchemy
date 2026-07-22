const crypto = require("crypto");

const STEAM_VERIFICATION_CODE_PATTERN = /^[A-Z0-9]{5}$/;
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
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  return text(value);
}

function diagnosticValue(value) {
  if (value === undefined || value === null) return null;
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  if (typeof value === "bigint") return value.toString();
  return text(value) || null;
}

function errorDiagnostic(stage, error) {
  const source = error && typeof error === "object" ? error : {};
  const cause = source.cause && typeof source.cause === "object" ? source.cause : {};
  const field = (name) => source[name] ?? cause[name];
  return {
    stage,
    eresult: diagnosticValue(field("eresult")),
    code: diagnosticValue(field("code")),
    http_status: diagnosticValue(field("statusCode") ?? field("http_status")),
    steam_status: diagnosticValue(field("steam_status")),
    error_name: text(source.name || cause.name) || null
  };
}

function isInvalidEmailCodeError(error) {
  const source = error && typeof error === "object" ? error : {};
  const cause = source.cause && typeof source.cause === "object" ? source.cause : {};
  const code = text(source.code ?? cause.code).replace(/[^a-z0-9]/gi, "").toLowerCase();
  const name = text(source.name ?? cause.name).replace(/[^a-z0-9]/gi, "").toLowerCase();
  const eresult = Number(source.eresult ?? cause.eresult);
  return code.includes("invalidloginauthcode")
    || code.includes("invalidauthcode")
    || name.includes("invalidloginauthcode")
    || [65, 88].includes(eresult);
}

function normalizeLoginStatus(result) {
  const raw = text(result && (result.status || result.guardType || result.guard_type || result.state)).toLowerCase();
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
  if (["authenticated", "success", "done"].includes(raw)) return "authenticated";
  return "unknown";
}

function extractAuthenticatorPayload(response) {
  if (response && response.response && typeof response.response === "object") return response.response;
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

class SteamGuardCoexistWorkerCore {
  constructor({
    loginController,
    addAuthenticator,
    syncTimeOffset,
    generateTotpCode,
    randomUUID = crypto.randomUUID
  } = {}) {
    if (!loginController || typeof loginController.start !== "function" || typeof loginController.submitEmailCode !== "function") {
      throw new Error("loginController.start and loginController.submitEmailCode are required");
    }
    if (typeof addAuthenticator !== "function") throw new Error("addAuthenticator is required");
    if (typeof syncTimeOffset !== "function") throw new Error("syncTimeOffset is required");
    if (typeof generateTotpCode !== "function") throw new Error("generateTotpCode is required");

    this.loginController = loginController;
    this.addAuthenticator = addAuthenticator;
    this.syncTimeOffset = syncTimeOffset;
    this.generateTotpCode = generateTotpCode;
    this.randomUUID = randomUUID;
    this.flow = null;
  }

  async start({flowId, username, password} = {}) {
    if (this.flow) return {ok: false, reason: "invalid_flow_state"};
    const normalizedFlowId = text(flowId);
    const accountName = text(username);
    const accountPassword = password === undefined || password === null ? "" : String(password);
    if (!normalizedFlowId) return {ok: false, reason: "flow_id_required"};
    if (!accountName) return {ok: false, reason: "username_required"};
    if (!accountPassword) return {ok: false, reason: "password_required"};

    this.flow = {
      flowId: normalizedFlowId,
      username: accountName,
      password: accountPassword,
      state: "logging_in",
      steamId64: "",
      deviceId: `android:${text(this.randomUUID())}`,
      candidate: null
    };

    try {
      return await this._continueFromLogin(await this.loginController.start({
        username: accountName,
        password: accountPassword
      }));
    } catch (err) {
      this._destroy();
      return {
        ok: false,
        reason: "login_failed",
        diagnostic: errorDiagnostic("login_start", err)
      };
    }
  }

  async submitEmailCode({code} = {}) {
    if (!this.flow) return {ok: false, reason: "flow_not_found"};
    if (this.flow.state !== "email_code_required") return {ok: false, reason: "invalid_flow_state"};
    if (!STEAM_VERIFICATION_CODE_PATTERN.test(text(code))) {
      return {ok: false, reason: "invalid_code_format"};
    }
    this.flow.state = "submitting_email_code";
    try {
      return await this._continueFromLogin(await this.loginController.submitEmailCode({code: text(code)}));
    } catch (err) {
      if (isInvalidEmailCodeError(err)) {
        this.flow.state = "email_code_required";
        return {
          ok: false,
          reason: "invalid_email_code",
          diagnostic: errorDiagnostic("email_code_submit", err)
        };
      }
      this._destroy();
      return {
        ok: false,
        reason: "login_failed",
        diagnostic: errorDiagnostic("email_code_submit", err)
      };
    }
  }

  async verifyAppCode({code} = {}) {
    const flow = this.flow;
    if (!flow) return {ok: false, reason: "flow_not_found"};
    if (flow.state !== "steam_app_binding_required" || !flow.candidate) {
      return {ok: false, reason: "invalid_flow_state"};
    }
    if (!STEAM_VERIFICATION_CODE_PATTERN.test(text(code))) {
      return {ok: false, reason: "invalid_code_format"};
    }
    flow.state = "verifying_app_code";

    let offsetSeconds;
    try {
      offsetSeconds = Number(await this.syncTimeOffset());
      if (!Number.isFinite(offsetSeconds)) throw new Error("Steam time offset is invalid");
    } catch (_) {
      flow.state = "steam_app_binding_required";
      return {
        ok: false,
        reason: "time_sync_failed"
      };
    }

    let expectedCode;
    try {
      expectedCode = this.generateTotpCode(flow.candidate.shared_secret, offsetSeconds);
    } catch (_) {
      this._destroy();
      return {ok: false, reason: "totp_generation_failed"};
    }

    if (!constantTimeCodeMatch(code, expectedCode)) {
      flow.state = "steam_app_binding_required";
      return {
        ok: false,
        reason: "app_code_mismatch"
      };
    }

    const maFile = this._buildMaFile(flow);
    const result = {
      ok: true,
      state: "verified",
      flow_id: flow.flowId,
      account_name: flow.username,
      steam_id64: flow.steamId64,
      password: flow.password,
      file_name: `${flow.username}.maFile`,
      maFile,
      maFileContent: JSON.stringify(maFile)
    };
    this._destroy();
    return result;
  }

  cancel() {
    if (!this.flow) return {ok: false, reason: "flow_not_found"};
    this._destroy();
    return {ok: true};
  }

  async _continueFromLogin(loginResult) {
    const flow = this.flow;
    if (!flow) return {ok: false, reason: "flow_not_found"};
    const status = normalizeLoginStatus(loginResult);
    if (status === "email_required") {
      flow.state = "email_code_required";
      return {
        ok: true,
        state: "email_code_required",
        flow_id: flow.flowId,
        guard_hint: text(loginResult && (loginResult.guardHint || loginResult.guard_hint))
      };
    }
    if (status === "already_has_authenticator") {
      this._destroy();
      return {ok: false, reason: "already_has_authenticator"};
    }
    if (status !== "authenticated") {
      this._destroy();
      return {ok: false, reason: "unsupported_login_state"};
    }

    const refreshToken = text(loginResult && (loginResult.refreshToken || loginResult.refresh_token));
    const accessToken = text(loginResult && (loginResult.accessToken || loginResult.access_token));
    flow.steamId64 = text(loginResult && (loginResult.steamId64 || loginResult.steam_id64 || loginResult.steamid));
    if (!refreshToken) {
      this._destroy();
      return {ok: false, reason: "refresh_token_missing"};
    }
    if (!accessToken) {
      this._destroy();
      return {ok: false, reason: "access_token_missing"};
    }
    if (!flow.steamId64) {
      this._destroy();
      return {ok: false, reason: "steam_id_missing"};
    }

    let response;
    try {
      response = await this.addAuthenticator({
        accessToken,
        steamId64: flow.steamId64,
        deviceId: flow.deviceId
      });
    } catch (err) {
      const result = {
        ok: false,
        reason: "add_authenticator_failed"
      };
      if (err && err.code) result.error_code = text(err.code);
      if (err && Number(err.statusCode)) result.http_status = Number(err.statusCode);
      this._destroy();
      return result;
    }

    const responsePayload = extractAuthenticatorPayload(response);
    const statusCode = Number(responsePayload.status ?? (response && response.status));
    if (statusCode === 29) {
      this._destroy();
      return {ok: false, reason: "already_has_authenticator"};
    }
    if (Number.isFinite(statusCode) && statusCode !== 1) {
      this._destroy();
      return {ok: false, reason: "add_authenticator_failed", steam_status: statusCode};
    }

    const candidate = normalizeAuthenticatorPayload(response);
    const missingFields = AUTHENTICATOR_REQUIRED_FIELDS.filter((field) => !candidate[field]);
    if (missingFields.length) {
      this._destroy();
      return {
        ok: false,
        reason: "invalid_authenticator_response",
        missing_fields: missingFields
      };
    }

    flow.candidate = candidate;
    flow.state = "steam_app_binding_required";
    this._releaseLogin();
    return {
      ok: true,
      state: "steam_app_binding_required",
      flow_id: flow.flowId
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

  _releaseLogin() {
    try {
      if (this.loginController && typeof this.loginController.cancel === "function") {
        this.loginController.cancel();
      }
    } catch (_) {
      // Child process teardown is the final cleanup boundary.
    }
  }

  _destroy() {
    const flow = this.flow;
    this.flow = null;
    this._releaseLogin();
    if (!flow) return;
    flow.password = "";
    if (flow.candidate) {
      for (const key of Object.keys(flow.candidate)) flow.candidate[key] = "";
    }
    flow.candidate = null;
  }
}

function createSteamGuardCoexistWorkerCore(options) {
  return new SteamGuardCoexistWorkerCore(options);
}

module.exports = {
  STEAM_VERIFICATION_CODE_PATTERN,
  SteamGuardCoexistWorkerCore,
  createSteamGuardCoexistWorkerCore
};
