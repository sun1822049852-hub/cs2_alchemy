const assert = require("node:assert/strict");
const test = require("node:test");

const {generateTotp} = require("../src/maFileParser");
const {createSteamGuardCoexistService} = require("../src/steamGuardCoexistService");

const SHARED_SECRET = Buffer.from("coexist-shared-secret").toString("base64");
const IDENTITY_SECRET = Buffer.from("coexist-identity-secret").toString("base64");

function validAuthenticator(overrides = {}) {
  return {
    status: 1,
    shared_secret: SHARED_SECRET,
    identity_secret: IDENTITY_SECRET,
    serial_number: "123456789",
    revocation_code: "R12345",
    uri: "otpauth://totp/Steam:demo?secret=example",
    server_time: "1777000000",
    account_name: "demo",
    token_gid: "token-gid",
    secret_1: Buffer.from("secret-one"),
    steamguard_scheme: 2,
    ...overrides
  };
}

function createSession() {
  return {
    cancelCount: 0,
    cancelLoginAttempt() {
      this.cancelCount += 1;
    }
  };
}

function createHarness(overrides = {}) {
  const calls = [];
  const session = overrides.session || createSession();
  let now = overrides.now || 1_000_000;
  const loginAdapter = {
    async start(credentials) {
      calls.push({type: "start", credentials});
      return overrides.startResult || {
        status: "Authenticated",
        session,
        refreshToken: "temporary-refresh",
        steamId64: "76561198000000001"
      };
    },
    async submitEmailCode(input) {
      calls.push({type: "submit_email", input});
      return overrides.emailResult || {
        status: "Authenticated",
        session,
        refreshToken: "temporary-refresh",
        steamId64: "76561198000000001"
      };
    },
    async cancel(input) {
      calls.push({type: "cancel", input});
      if (input && input.session && typeof input.session.cancelLoginAttempt === "function") {
        input.session.cancelLoginAttempt();
      }
    }
  };
  const service = createSteamGuardCoexistService({
    loginAdapter,
    exchangeAccessToken: async (refreshToken) => {
      calls.push({type: "exchange", refreshToken});
      return "temporary-access";
    },
    addAuthenticator: async (input) => {
      calls.push({type: "add", input});
      return overrides.authenticator || validAuthenticator();
    },
    completeBinding: overrides.completeBinding,
    now: () => now,
    randomUUID: () => overrides.uuid || "11111111-2222-4333-8444-555555555555",
    ttlMs: overrides.ttlMs
  });

  return {
    calls,
    service,
    session,
    advance(ms) {
      now += ms;
    }
  };
}

async function startDefault(service, overrides = {}) {
  return service.start({
    mode: "new",
    username: "demo",
    password: "password-secret",
    remark: "test account",
    ...overrides
  });
}

test("邮箱验证码续接成功后调用 AddAuthenticator 并进入 Steam App 验证", async () => {
  const session = createSession();
  const harness = createHarness({
    session,
    startResult: {
      status: "RequiresEmailAuth",
      guardHint: "d***@example.com",
      session
    }
  });

  const started = await startDefault(harness.service);
  assert.deepEqual(started, {
    ok: true,
    state: "email_code_required",
    flow_id: "11111111-2222-4333-8444-555555555555",
    guard_hint: "d***@example.com",
    expires_in_seconds: 300
  });
  assert.equal(harness.calls.some((call) => call.type === "add"), false);

  const continued = await harness.service.submitEmailCode({
    flowId: started.flow_id,
    code: "EMAIL1"
  });
  assert.equal(continued.ok, true);
  assert.equal(continued.state, "steam_app_binding_required");
  assert.equal(continued.flow_id, started.flow_id);

  const addCall = harness.calls.find((call) => call.type === "add");
  assert.equal(addCall.input.refreshToken, "temporary-refresh");
  assert.equal(addCall.input.accessToken, "temporary-access");
  assert.equal(addCall.input.steamId64, "76561198000000001");
  assert.match(addCall.input.deviceId, /^android:[0-9a-f-]{36}$/);
  assert.equal(harness.calls.some((call) => call.type === "exchange"), true);
  assert.equal(session.cancelCount, 1);
});

test("邮箱码、App 动态码和取消都不能跨本地用户访问流程", async () => {
  const session = createSession();
  const harness = createHarness({
    session,
    startResult: {
      status: "RequiresEmailAuth",
      session
    }
  });
  const started = await startDefault(harness.service, {accountId: "member-a"});

  assert.deepEqual(
    await harness.service.submitEmailCode({
      flowId: started.flow_id,
      code: "EMAIL1",
      accountId: "member-b"
    }),
    {ok: false, reason: "flow_not_found"}
  );
  assert.deepEqual(
    harness.service.cancel(started.flow_id, {accountId: "member-b"}),
    {ok: false, reason: "flow_not_found"}
  );

  const continued = await harness.service.submitEmailCode({
    flowId: started.flow_id,
    code: "EMAIL1",
    accountId: "member-a"
  });
  assert.equal(continued.state, "steam_app_binding_required");
  assert.deepEqual(
    await harness.service.verifyAppCode({
      flowId: started.flow_id,
      code: generateTotp(SHARED_SECRET),
      accountId: "member-b"
    }),
    {ok: false, reason: "flow_not_found"}
  );
  const verified = await harness.service.verifyAppCode({
    flowId: started.flow_id,
    code: generateTotp(SHARED_SECRET),
    accountId: "member-a"
  });
  assert.equal(verified.ok, true);
});

for (const status of ["Requires2FA", "DeviceCode", "DeviceConfirmation"]) {
  test(`${status} 被映射为已有令牌并立即清理`, async () => {
    const session = createSession();
    const harness = createHarness({
      session,
      startResult: {status, session}
    });

    const result = await startDefault(harness.service);
    assert.deepEqual(result, {
      ok: false,
      reason: "already_has_authenticator"
    });
    assert.equal(session.cancelCount, 1);
    assert.equal(harness.calls.some((call) => call.type === "add"), false);
    assert.deepEqual(
      await harness.service.verifyAppCode({
        flowId: "11111111-2222-4333-8444-555555555555",
        code: "ABCDE"
      }),
      {ok: false, reason: "flow_not_found"}
    );
  });
}

test("AddAuthenticator status=29 被映射为已有令牌且不保留流程", async () => {
  const harness = createHarness({authenticator: {status: 29}});
  const result = await startDefault(harness.service);

  assert.deepEqual(result, {ok: false, reason: "already_has_authenticator"});
  assert.deepEqual(
    await harness.service.submitEmailCode({flowId: result.flow_id, code: "EMAIL1"}),
    {ok: false, reason: "flow_not_found"}
  );
});

test("AddAuthenticator 缺少必需 Guard 字段时失败并清理", async () => {
  const harness = createHarness({
    authenticator: validAuthenticator({identity_secret: ""})
  });
  const result = await startDefault(harness.service);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_authenticator_response");
  assert.deepEqual(result.missing_fields, ["identity_secret"]);
  assert.equal(harness.session.cancelCount, 1);
});

test("正确 App 动态码返回 Guard-only maFile 并清理临时敏感数据", async () => {
  let persisted = null;
  const harness = createHarness({
    completeBinding: async (payload) => {
      persisted = payload;
    }
  });
  const started = await startDefault(harness.service);
  assert.equal(started.state, "steam_app_binding_required");

  const result = await harness.service.verifyAppCode({
    flowId: started.flow_id,
    code: generateTotp(SHARED_SECRET)
  });

  assert.equal(result.ok, true);
  assert.equal(result.state, "verified");
  assert.equal(result.file_name, "demo.maFile");
  assert.equal(result.maFile.Session, null);
  assert.equal(result.maFile.shared_secret, SHARED_SECRET);
  assert.equal(result.maFile.identity_secret, IDENTITY_SECRET);
  assert.equal(result.maFile.secret_1, Buffer.from("secret-one").toString("base64"));
  assert.equal(result.maFile.revocation_code, "R12345");
  assert.equal(result.maFile.device_id, "android:11111111-2222-4333-8444-555555555555");
  assert.equal(result.maFile.steamid, "76561198000000001");
  assert.equal(result.maFile.fully_enrolled, true);
  assert.equal(Object.hasOwn(result.maFile, "refresh_token"), false);
  assert.equal(Object.hasOwn(result.maFile, "access_token"), false);
  assert.equal(JSON.stringify(result.maFile).includes("SteamLoginSecure"), false);
  assert.equal(result.maFileContent, JSON.stringify(result.maFile));

  assert.equal(persisted.mode, "new");
  assert.equal(persisted.accountName, "demo");
  assert.equal(persisted.password, "password-secret");
  assert.equal(persisted.remark, "test account");
  assert.deepEqual(persisted.maFile, result.maFile);
  assert.deepEqual(
    await harness.service.verifyAppCode({flowId: started.flow_id, code: "ABCDE"}),
    {ok: false, reason: "flow_not_found"}
  );
});

test("App 动态码三次不匹配后销毁候选数据", async () => {
  const harness = createHarness();
  const started = await startDefault(harness.service);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    assert.deepEqual(
      await harness.service.verifyAppCode({flowId: started.flow_id, code: "WRONG"}),
      {
        ok: false,
        reason: "app_code_mismatch",
        attempts_remaining: 3 - attempt
      }
    );
  }
  assert.deepEqual(
    await harness.service.verifyAppCode({flowId: started.flow_id, code: "WRONG"}),
    {ok: false, reason: "app_code_attempts_exceeded"}
  );
  assert.deepEqual(
    await harness.service.verifyAppCode({flowId: started.flow_id, code: generateTotp(SHARED_SECRET)}),
    {ok: false, reason: "flow_not_found"}
  );
});

test("五分钟超时后 cleanupExpired 清理流程", async () => {
  const harness = createHarness();
  const started = await startDefault(harness.service);
  harness.advance(5 * 60 * 1000 + 1);

  assert.equal(harness.service.cleanupExpired(), 1);
  assert.deepEqual(
    await harness.service.verifyAppCode({flowId: started.flow_id, code: generateTotp(SHARED_SECRET)}),
    {ok: false, reason: "flow_not_found"}
  );
});

test("流程在恰好五分钟的 TTL 边界失效", async () => {
  const harness = createHarness();
  const started = await startDefault(harness.service);
  harness.advance(5 * 60 * 1000);

  assert.equal(harness.service.cleanupExpired(), 1);
  assert.deepEqual(
    await harness.service.verifyAppCode({flowId: started.flow_id, code: generateTotp(SHARED_SECRET)}),
    {ok: false, reason: "flow_not_found"}
  );
});

test("无人继续操作时流程也会由 TTL 定时器自动销毁", async () => {
  const harness = createHarness({ttlMs: 10});
  const started = await startDefault(harness.service);
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.deepEqual(
    await harness.service.verifyAppCode({flowId: started.flow_id, code: generateTotp(SHARED_SECRET)}),
    {ok: false, reason: "flow_not_found"}
  );
});

test("取消流程会清理会话且不可继续", async () => {
  const session = createSession();
  const harness = createHarness({
    session,
    startResult: {status: "RequiresEmailAuth", session}
  });
  const started = await startDefault(harness.service, {mode: "existing", accountId: 42});

  assert.deepEqual(harness.service.cancel(started.flow_id), {ok: true});
  assert.equal(session.cancelCount, 1);
  assert.deepEqual(
    await harness.service.submitEmailCode({flowId: started.flow_id, code: "EMAIL1"}),
    {ok: false, reason: "flow_not_found"}
  );
});

test("持久化回调失败时不返回成功且流程被销毁", async () => {
  const harness = createHarness({
    completeBinding: async () => {
      throw new Error("database unavailable");
    }
  });
  const started = await startDefault(harness.service);
  const result = await harness.service.verifyAppCode({
    flowId: started.flow_id,
    code: generateTotp(SHARED_SECRET)
  });

  assert.deepEqual(result, {ok: false, reason: "persistence_failed"});
  assert.deepEqual(
    await harness.service.verifyAppCode({flowId: started.flow_id, code: generateTotp(SHARED_SECRET)}),
    {ok: false, reason: "flow_not_found"}
  );
});

test("同一流程并发验证时只允许一次持久化", async () => {
  let persistCount = 0;
  let releasePersistence;
  const persistenceBlocked = new Promise((resolve) => {
    releasePersistence = resolve;
  });
  const harness = createHarness({
    completeBinding: async () => {
      persistCount += 1;
      await persistenceBlocked;
    }
  });
  const started = await startDefault(harness.service);
  const code = generateTotp(SHARED_SECRET);

  const firstVerification = harness.service.verifyAppCode({flowId: started.flow_id, code});
  await Promise.resolve();
  const secondVerification = harness.service.verifyAppCode({flowId: started.flow_id, code});
  await Promise.resolve();
  const countWhileBlocked = persistCount;
  releasePersistence();
  const [first, second] = await Promise.all([firstVerification, secondVerification]);

  assert.equal(countWhileBlocked, 1);
  assert.equal(first.ok, true);
  assert.deepEqual(second, {ok: false, reason: "invalid_flow_state"});
  assert.equal(persistCount, 1);
});
