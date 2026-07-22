const assert = require("node:assert/strict");
const test = require("node:test");

const {createSteamGuardCoexistWorkerCore} = require("../src/steamGuardCoexistWorkerCore");

const SHARED_SECRET = Buffer.from("worker-shared-secret").toString("base64");
const IDENTITY_SECRET = Buffer.from("worker-identity-secret").toString("base64");

function validAuthenticator() {
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
    secret_1: Buffer.from("secret-one").toString("base64"),
    steamguard_scheme: 2
  };
}

function createHarness(overrides = {}) {
  const calls = [];
  let syncFailure = null;
  let emailFailure = overrides.emailError || null;
  let expectedCode = "ABCDE";
  const core = createSteamGuardCoexistWorkerCore({
    loginController: {
      async start(input) {
        calls.push({type: "login_start", input});
        if (overrides.startError) throw overrides.startError;
        return overrides.startResult || {
          status: "Authenticated",
          refreshToken: "temporary-refresh",
          accessToken: "temporary-access",
          steamId64: "76561198000000001"
        };
      },
      async submitEmailCode(input) {
        calls.push({type: "email", input});
        if (emailFailure) throw emailFailure;
        return overrides.emailResult || {
          status: "Authenticated",
          refreshToken: "temporary-refresh",
          accessToken: "temporary-access",
          steamId64: "76561198000000001"
        };
      },
      cancel() {
        calls.push({type: "cancel"});
      }
    },
    addAuthenticator: async (input) => {
      calls.push({type: "add", input});
      return overrides.authenticator || validAuthenticator();
    },
    syncTimeOffset: async () => {
      calls.push({type: "sync_time"});
      if (syncFailure) throw syncFailure;
      return 37;
    },
    generateTotpCode: (secret, offsetSeconds) => {
      calls.push({type: "generate_totp", secret, offsetSeconds});
      return expectedCode;
    },
    randomUUID: () => "11111111-2222-4333-8444-555555555555"
  });
  return {
    calls,
    core,
    failSync(error) {
      syncFailure = error;
    },
    recoverSync() {
      syncFailure = null;
    },
    recoverEmail() {
      emailFailure = null;
    },
    setExpectedCode(value) {
      expectedCode = value;
    }
  };
}

test("邮箱验证码在同一 worker 登录会话内续接并获取 Guard 候选数据", async () => {
  const harness = createHarness({
    startResult: {status: "RequiresEmailAuth", guardHint: "m***@example.com"}
  });
  assert.deepEqual(await startReady(harness.core), {
    ok: true,
    state: "email_code_required",
    flow_id: "flow-a",
    guard_hint: "m***@example.com"
  });

  const continued = await harness.core.submitEmailCode({code: "EML01"});
  assert.equal(continued.ok, true);
  assert.equal(continued.state, "steam_app_binding_required");
  assert.equal(harness.calls.filter((call) => call.type === "add").length, 1);
});

test("错误邮箱验证码保留诊断并允许在同一 Steam 会话继续重试", async () => {
  const steamError = new Error("must-not-be-persisted");
  steamError.eresult = 88;
  steamError.code = "InvalidLoginAuthCode";
  steamError.statusCode = 401;
  steamError.password = "must-not-leak";
  const harness = createHarness({
    startResult: {status: "RequiresEmailAuth", guardHint: "m***@example.com"},
    emailError: steamError
  });
  await startReady(harness.core);

  const result = await harness.core.submitEmailCode({code: "WRNG1"});

  assert.deepEqual(result, {
    ok: false,
    reason: "invalid_email_code",
    diagnostic: {
      stage: "email_code_submit",
      eresult: 88,
      code: "InvalidLoginAuthCode",
      http_status: 401,
      steam_status: null,
      error_name: "Error"
    }
  });
  assert.doesNotMatch(JSON.stringify(result), /must-not-be-persisted|must-not-leak/);
  harness.recoverEmail();
  const continued = await harness.core.submitEmailCode({code: "RIGHT"});
  assert.equal(continued.ok, true);
  assert.equal(continued.state, "steam_app_binding_required");
});

test("非验证码类 Steam 邮箱提交错误仍然终止流程", async () => {
  const steamError = new Error("access denied");
  steamError.code = "AccessDenied";
  const harness = createHarness({
    startResult: {status: "RequiresEmailAuth", guardHint: "m***@example.com"},
    emailError: steamError
  });
  await startReady(harness.core);

  assert.equal((await harness.core.submitEmailCode({code: "EML01"})).reason, "login_failed");
  assert.deepEqual(await harness.core.submitEmailCode({code: "EML01"}), {
    ok: false,
    reason: "flow_not_found"
  });
});

for (const status of ["Requires2FA", "DeviceCode", "DeviceConfirmation"]) {
  test(`${status} 在独立 worker 内终止为已有令牌`, async () => {
    const harness = createHarness({startResult: {status}});
    assert.deepEqual(await startReady(harness.core), {
      ok: false,
      reason: "already_has_authenticator"
    });
    assert.equal(harness.calls.some((call) => call.type === "add"), false);
  });
}

test("AddAuthenticator status=29 终止为已有令牌", async () => {
  const harness = createHarness({authenticator: {status: 29}});
  assert.deepEqual(await startReady(harness.core), {
    ok: false,
    reason: "already_has_authenticator"
  });
});

test("AddAuthenticator 缺少 Guard 必需字段时返回字段清单", async () => {
  const harness = createHarness({
    authenticator: {...validAuthenticator(), identity_secret: ""}
  });
  assert.deepEqual(await startReady(harness.core), {
    ok: false,
    reason: "invalid_authenticator_response",
    missing_fields: ["identity_secret"]
  });
});

async function startReady(core) {
  return core.start({
    flowId: "flow-a",
    username: "demo",
    password: "password-secret"
  });
}

test("每次 App 动态码校验前同步 Steam 时间并使用同步偏移生成 TOTP", async () => {
  const harness = createHarness();
  const started = await startReady(harness.core);
  assert.equal(started.state, "steam_app_binding_required");

  const verified = await harness.core.verifyAppCode({code: "ABCDE"});

  assert.equal(verified.ok, true);
  assert.equal(verified.state, "verified");
  assert.equal(verified.password, "password-secret");
  assert.equal(verified.maFile.shared_secret, SHARED_SECRET);
  assert.deepEqual(
    harness.calls.filter((call) => ["sync_time", "generate_totp"].includes(call.type)),
    [
      {type: "sync_time"},
      {type: "generate_totp", secret: SHARED_SECRET, offsetSeconds: 37}
    ]
  );
});

test("Steam 时间同步失败时保留候选数据且不消耗 App 动态码次数", async () => {
  const harness = createHarness();
  await startReady(harness.core);
  harness.failSync(new Error("Steam time unavailable"));

  assert.deepEqual(await harness.core.verifyAppCode({code: "ABCDE"}), {
    ok: false,
    reason: "time_sync_failed"
  });

  harness.recoverSync();
  harness.setExpectedCode("RIGHT");
  assert.deepEqual(await harness.core.verifyAppCode({code: "WRONG"}), {
    ok: false,
    reason: "app_code_mismatch"
  });
  assert.equal(harness.calls.filter((call) => call.type === "sync_time").length, 2);
});

test("App 动态码任意次数不匹配都保留候选数据直到校验成功", async () => {
  const harness = createHarness();
  await startReady(harness.core);
  harness.setExpectedCode("RIGHT");

  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.deepEqual(await harness.core.verifyAppCode({code: "WRONG"}), {
      ok: false,
      reason: "app_code_mismatch"
    });
  }
  assert.equal((await harness.core.verifyAppCode({code: "RIGHT"})).state, "verified");
});

test("worker 对邮箱码和 App 码强制执行五位大写字母数字格式", async () => {
  const emailHarness = createHarness({
    startResult: {status: "RequiresEmailAuth", guardHint: "m***@example.com"}
  });
  await startReady(emailHarness.core);
  const emailCallCount = emailHarness.calls.filter((call) => call.type === "email").length;
  assert.deepEqual(await emailHarness.core.submitEmailCode({code: "abc12"}), {
    ok: false,
    reason: "invalid_code_format"
  });
  assert.equal(emailHarness.calls.filter((call) => call.type === "email").length, emailCallCount);
  assert.equal((await emailHarness.core.submitEmailCode({code: "ABC12"})).state, "steam_app_binding_required");

  const appHarness = createHarness();
  await startReady(appHarness.core);
  const syncCallCount = appHarness.calls.filter((call) => call.type === "sync_time").length;
  assert.deepEqual(await appHarness.core.verifyAppCode({code: "A-123"}), {
    ok: false,
    reason: "invalid_code_format"
  });
  assert.equal(appHarness.calls.filter((call) => call.type === "sync_time").length, syncCallCount);
});
