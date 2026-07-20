const assert = require("node:assert/strict");
const test = require("node:test");

const {createSteamGuardCoexistService} = require("../src/steamGuardCoexistService");

const SHARED_SECRET = Buffer.from("service-shared-secret").toString("base64");
const IDENTITY_SECRET = Buffer.from("service-identity-secret").toString("base64");

function verifiedResult(flowId, overrides = {}) {
  const maFile = {
    shared_secret: SHARED_SECRET,
    identity_secret: IDENTITY_SECRET,
    serial_number: "123456789",
    revocation_code: "R12345",
    account_name: "demo",
    steamid: "76561198000000001",
    Session: null
  };
  return {
    ok: true,
    state: "verified",
    flow_id: flowId,
    account_name: "demo",
    steam_id64: "76561198000000001",
    password: "password-secret",
    file_name: "demo.maFile",
    maFile,
    maFileContent: JSON.stringify(maFile),
    ...overrides
  };
}

function createHarness(overrides = {}) {
  const calls = [];
  let uuidIndex = 0;
  const processAdapter = {
    async start(input) {
      calls.push({type: "start", input});
      if (overrides.startResult) return overrides.startResult(input);
      return {
        ok: true,
        state: "email_code_required",
        flow_id: input.flowId,
        guard_hint: "m***@example.com",
        expires_in_seconds: 300
      };
    },
    async submitEmailCode(input) {
      calls.push({type: "email", input});
      if (overrides.emailResult) return overrides.emailResult(input);
      return {
        ok: true,
        state: "steam_app_binding_required",
        flow_id: input.flowId,
        expires_in_seconds: 300
      };
    },
    async verifyAppCode(input) {
      calls.push({type: "verify", input});
      if (overrides.verifyResult) return overrides.verifyResult(input);
      return verifiedResult(input.flowId);
    },
    cancel(flowId) {
      calls.push({type: "cancel", flowId});
      return {ok: true};
    },
    cleanupExpired() {
      return 0;
    }
  };
  let persisted = null;
  const service = createSteamGuardCoexistService({
    processAdapter,
    completeBinding: async (payload) => {
      if (overrides.completeBinding) return overrides.completeBinding(payload);
      persisted = payload;
    },
    randomUUID: () => `flow-${++uuidIndex}`,
    now: overrides.now || Date.now,
    ttlMs: overrides.ttlMs
  });
  return {calls, processAdapter, service, getPersisted: () => persisted};
}

function startDefault(service, overrides = {}) {
  return service.start({
    mode: "new",
    username: "demo",
    password: "password-secret",
    remark: "test account",
    accountId: "member-a",
    ...overrides
  });
}

test("服务为同一用户名创建不同 flow_id 并分别启动独立进程", async () => {
  const harness = createHarness();
  const [first, second] = await Promise.all([
    startDefault(harness.service),
    startDefault(harness.service)
  ]);

  assert.equal(first.flow_id, "flow-1");
  assert.equal(second.flow_id, "flow-2");
  assert.deepEqual(
    harness.calls.filter((call) => call.type === "start").map((call) => call.input.flowId),
    ["flow-1", "flow-2"]
  );
});
test("邮箱码和 App 码只能由创建流程的本地用户提交", async () => {
  const harness = createHarness();
  const started = await startDefault(harness.service);

  assert.deepEqual(await harness.service.submitEmailCode({
    flowId: started.flow_id,
    code: "EML01",
    accountId: "member-b"
  }), {ok: false, reason: "flow_not_found"});
  assert.deepEqual(await harness.service.verifyAppCode({
    flowId: started.flow_id,
    code: "APP01",
    accountId: "member-b"
  }), {ok: false, reason: "flow_not_found"});
  assert.equal(harness.calls.some((call) => call.type === "email" || call.type === "verify"), false);
});

test("本地时间推进不会淘汰联合绑定流程", async () => {
  let currentTime = 1000;
  const harness = createHarness({
    now: () => currentTime,
    ttlMs: 1000
  });
  const started = await startDefault(harness.service);
  currentTime += 24 * 60 * 60 * 1000;

  assert.equal(harness.service.cleanupExpired(), 0);
  const continued = await harness.service.submitEmailCode({
    flowId: started.flow_id,
    code: "EML01",
    accountId: "member-a"
  });
  assert.equal(continued.state, "steam_app_binding_required");
  assert.equal(harness.calls.some((call) => call.type === "cancel"), false);
  assert.equal(Object.hasOwn(harness.calls.find((call) => call.type === "start").input, "ttlMs"), false);
});

test("邮箱验证码错误保留原流程并允许同一会话重试", async () => {
  let attempts = 0;
  const harness = createHarness({
    emailResult: (input) => {
      attempts += 1;
      if (attempts === 1) return {ok: false, reason: "invalid_email_code"};
      return {ok: true, state: "steam_app_binding_required", flow_id: input.flowId};
    }
  });
  const started = await startDefault(harness.service);

  assert.deepEqual(await harness.service.submitEmailCode({
    flowId: started.flow_id,
    code: "WRNG1",
    accountId: "member-a"
  }), {ok: false, reason: "invalid_email_code"});
  assert.equal(harness.calls.some((call) => call.type === "cancel"), false);
  assert.equal((await harness.service.submitEmailCode({
    flowId: started.flow_id,
    code: "RIGHT",
    accountId: "member-a"
  })).state, "steam_app_binding_required");
});

test("Steam 判定已有令牌后同一账号冷却 60 秒且不再启动 worker", async () => {
  let currentTime = 10_000;
  const harness = createHarness({
    now: () => currentTime,
    startResult: () => ({ok: false, reason: "already_has_authenticator"})
  });

  assert.deepEqual(await startDefault(harness.service), {
    ok: false,
    reason: "already_has_authenticator",
    retry_after_seconds: 60
  });
  assert.deepEqual(await startDefault(harness.service), {
    ok: false,
    reason: "already_has_authenticator_cooldown",
    retry_after_seconds: 60
  });
  assert.equal(harness.calls.filter((call) => call.type === "start").length, 1);

  currentTime += 59_001;
  assert.deepEqual(await startDefault(harness.service), {
    ok: false,
    reason: "already_has_authenticator_cooldown",
    retry_after_seconds: 1
  });
  assert.equal(harness.calls.filter((call) => call.type === "start").length, 1);

  currentTime += 999;
  assert.equal((await startDefault(harness.service)).reason, "already_has_authenticator");
  assert.equal(harness.calls.filter((call) => call.type === "start").length, 2);
});

test("AddAuthenticator 阶段判定已有令牌也会建立账号冷却", async () => {
  let currentTime = 20_000;
  const harness = createHarness({
    now: () => currentTime,
    emailResult: () => ({ok: false, reason: "already_has_authenticator"})
  });
  const started = await startDefault(harness.service);

  assert.deepEqual(await harness.service.submitEmailCode({
    flowId: started.flow_id,
    code: "EML01",
    accountId: "member-a"
  }), {
    ok: false,
    reason: "already_has_authenticator",
    retry_after_seconds: 60
  });
  assert.deepEqual(await startDefault(harness.service), {
    ok: false,
    reason: "already_has_authenticator_cooldown",
    retry_after_seconds: 60
  });
  assert.equal(harness.calls.filter((call) => call.type === "start").length, 1);
});

test("进程返回时间同步失败时保留流程并原样返回可重试状态", async () => {
  const harness = createHarness({
    startResult: (input) => ({
      ok: true,
      state: "steam_app_binding_required",
      flow_id: input.flowId,
      expires_in_seconds: 300
    }),
    verifyResult: () => ({
      ok: false,
      reason: "time_sync_failed",
      attempts_remaining: 3
    })
  });
  const started = await startDefault(harness.service);

  assert.deepEqual(await harness.service.verifyAppCode({
    flowId: started.flow_id,
    code: "APP01",
    accountId: "member-a"
  }), {
    ok: false,
    reason: "time_sync_failed",
    attempts_remaining: 3
  });
  assert.equal(harness.service.cancel(started.flow_id, {accountId: "member-a"}).ok, true);
});

test("App 动态码验证成功后持久化，且不把密码返回给 API 层", async () => {
  const harness = createHarness({
    startResult: (input) => ({
      ok: true,
      state: "steam_app_binding_required",
      flow_id: input.flowId,
      expires_in_seconds: 300
    })
  });
  const started = await startDefault(harness.service);
  const result = await harness.service.verifyAppCode({
    flowId: started.flow_id,
    code: "APP01",
    accountId: "member-a"
  });

  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result, "password"), false);
  assert.equal(harness.getPersisted().password, "password-secret");
  assert.equal(harness.getPersisted().maFile.shared_secret, SHARED_SECRET);
  assert.deepEqual(
    await harness.service.verifyAppCode({flowId: started.flow_id, code: "APP01", accountId: "member-a"}),
    {ok: false, reason: "flow_not_found"}
  );
});

test("持久化失败时取消子进程且不返回成功", async () => {
  const harness = createHarness({
    startResult: (input) => ({
      ok: true,
      state: "steam_app_binding_required",
      flow_id: input.flowId,
      expires_in_seconds: 300
    }),
    completeBinding: async () => {
      throw new Error("database unavailable");
    }
  });
  const started = await startDefault(harness.service);

  assert.deepEqual(await harness.service.verifyAppCode({
    flowId: started.flow_id,
    code: "APP01",
    accountId: "member-a"
  }), {ok: false, reason: "persistence_failed"});
  assert.equal(harness.calls.some((call) => call.type === "cancel" && call.flowId === started.flow_id), true);
});

test("同一流程并发验证时只允许一次持久化", async () => {
  let persistCount = 0;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const harness = createHarness({
    startResult: (input) => ({
      ok: true,
      state: "steam_app_binding_required",
      flow_id: input.flowId,
      expires_in_seconds: 300
    }),
    completeBinding: async () => {
      persistCount += 1;
      await blocked;
    }
  });
  const started = await startDefault(harness.service);

  const first = harness.service.verifyAppCode({flowId: started.flow_id, code: "APP01", accountId: "member-a"});
  await Promise.resolve();
  const second = harness.service.verifyAppCode({flowId: started.flow_id, code: "APP01", accountId: "member-a"});
  await Promise.resolve();
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.ok, true);
  assert.deepEqual(secondResult, {ok: false, reason: "invalid_flow_state"});
  assert.equal(persistCount, 1);
});
