const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const path = require("node:path");

function loadAuthServiceWithLoginSession(FakeLoginSession) {
  const authServicePath = path.resolve(__dirname, "../src/authService.js");
  const networkPrecheckPath = path.resolve(__dirname, "../src/networkPrecheck.js");
  const steamSessionPath = require.resolve("steam-session", {
    paths: [path.resolve(__dirname, "..")]
  });
  const originals = new Map([
    [authServicePath, require.cache[authServicePath]],
    [networkPrecheckPath, require.cache[networkPrecheckPath]],
    [steamSessionPath, require.cache[steamSessionPath]]
  ]);
  delete require.cache[authServicePath];
  require.cache[networkPrecheckPath] = {
    id: networkPrecheckPath,
    filename: networkPrecheckPath,
    loaded: true,
    exports: {ensureAuthApiReachable: async () => ({ok: true})}
  };
  require.cache[steamSessionPath] = {
    id: steamSessionPath,
    filename: steamSessionPath,
    loaded: true,
    exports: {
      EAuthTokenPlatformType: {SteamClient: "steam-client"},
      EAuthSessionGuardType: {
        Unknown: 0,
        None: 1,
        EmailCode: 2,
        DeviceCode: 3,
        DeviceConfirmation: 4,
        EmailConfirmation: 5,
        MachineToken: 6,
        LegacyMachineAuth: 7
      },
      LoginSession: FakeLoginSession
    }
  };
  return {
    module: require(authServicePath),
    restore() {
      delete require.cache[authServicePath];
      for (const [filePath, original] of originals) {
        if (original) require.cache[filePath] = original;
        else delete require.cache[filePath];
      }
    }
  };
}

class EmailLoginSession extends EventEmitter {
  constructor(platformType) {
    super();
    EmailLoginSession.lastPlatformType = platformType;
    this.refreshToken = "temporary_refresh";
    this.accessToken = "temporary_access";
    this.steamID = {getSteamID64: () => "76561198000000001"};
  }
  async startWithCredentials() {
    return {
      actionRequired: true,
      validActions: [{type: 2, detail: "m***@example.com"}]
    };
  }
  async submitSteamGuardCode() {
    process.nextTick(() => this.emit("authenticated"));
  }
  cancelLoginAttempt() {}
}

class ExistingGuardLoginSession extends EventEmitter {
  constructor() {
    super();
    this.refreshToken = "must_not_be_used";
  }
  async startWithCredentials() {
    return {
      actionRequired: true,
      validActions: [{type: 3}]
    };
  }
  cancelLoginAttempt() {
    this.cancelled = true;
  }
}

async function test_ordinary_email_login_keeps_original_steam_client_contract() {
  const writes = [];
  const stub = loadAuthServiceWithLoginSession(EmailLoginSession);
  try {
    const phase1 = await stub.module.startLoginSession({
      username: "demo",
      password: "secret",
      persistToken: false,
      tokenStore: {set(username, token) { writes.push({username, token}); }},
      timeoutMs: 5000
    });
    assert.equal(phase1.guard_type, "email_code");
    const phase2 = await stub.module.submitGuardCode({
      username: "demo",
      code: "ABC12",
      persistToken: false,
      timeoutMs: 5000
    });
    assert.equal(phase2.result.refresh_token, "temporary_refresh");
    assert.equal(phase2.authenticated_password, "secret");
    assert.equal(Object.hasOwn(phase2.result, "access_token"), false);
    assert.equal(phase2.result.steam_id64, "76561198000000001");
    assert.equal(EmailLoginSession.lastPlatformType, "steam-client");
    assert.deepEqual(writes, [], "persistToken=false must not write the temporary refresh token");
  } finally {
    stub.restore();
  }
}

async function test_existing_mobile_authenticator_is_reported_and_session_is_removed() {
  const stub = loadAuthServiceWithLoginSession(ExistingGuardLoginSession);
  try {
    const result = await stub.module.startLoginSession({
      username: "guarded",
      password: "secret",
      persistToken: false,
      rejectAuthenticatorGuard: true,
      timeoutMs: 5000
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "already_has_authenticator");
    await assert.rejects(
      () => stub.module.submitGuardCode({username: "guarded", code: "AAAAA", persistToken: false}),
      /会话已过期|不存在/
    );
  } finally {
    stub.restore();
  }
}

async function main() {
  await test_ordinary_email_login_keeps_original_steam_client_contract();
  await test_existing_mobile_authenticator_is_reported_and_session_is_removed();
  console.log("auth-service-coexist tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
