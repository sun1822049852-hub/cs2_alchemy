const assert = require("node:assert/strict");
const http = require("node:http");

const {createServer} = require("../src/uiServer");

const SHARED_SECRET = Buffer.from("route-coexist-shared").toString("base64");
const IDENTITY_SECRET = Buffer.from("route-coexist-identity").toString("base64");

function createReadyLicenseRuntime() {
  const state = {
    ok: true,
    code: "ready",
    user: {id: "user_test", username: "member_test", membership_plan: "pro"},
    permissions: ["accounts.read", "accounts.write"],
    featureFlags: {},
    expiresAt: "2099-01-01T00:15:00.000Z",
    expiresInMs: 86400000
  };
  return {getState: () => state, stop() {}, importBundle: () => state, clear: () => state};
}

function createAccountStore({failWrites = false} = {}) {
  const rows = new Map([
    ["existing", {
      username: "existing",
      password: "stored-password",
      remark: "keep-remark",
      steam_name: "Keep Name",
      steam_id: "76561198000000001",
      steam_id64: "76561198000000001",
      avatar_url: "keep-avatar",
      mafile_content: "",
      balance: "88.00"
    }],
    ["local-guard", {
      username: "local-guard",
      password: "stored-password",
      remark: "guarded",
      steam_name: "Guarded",
      steam_id: "76561198000000002",
      steam_id64: "76561198000000002",
      avatar_url: "guard-avatar",
      mafile_content: JSON.stringify({
        shared_secret: SHARED_SECRET,
        identity_secret: IDENTITY_SECRET,
        revocation_code: "R-LOCAL",
        device_id: "android:12345678-1234-4123-8123-123456789abc",
        account_name: "local-guard"
      })
    }],
    ["local-incomplete-guard", {
      username: "local-incomplete-guard",
      password: "stored-password",
      remark: "incomplete",
      steam_name: "Incomplete",
      steam_id: "76561198000000003",
      steam_id64: "76561198000000003",
      avatar_url: "",
      mafile_content: JSON.stringify({shared_secret: SHARED_SECRET})
    }]
  ]);
  let active = "existing";
  const writes = [];
  const project = (row) => row && ({
    username: row.username,
    remark: row.remark,
    steam_name: row.steam_name,
    steam_id: row.steam_id,
    steam_id64: row.steam_id64,
    avatar_url: row.avatar_url,
    balance: row.balance || "",
    has_steam_guard: !!row.mafile_content,
    is_active: row.username === active
  });
  return {
    rows,
    writes,
    list: () => [...rows.values()].map(project),
    get: (username) => project(rows.get(username)),
    getActive: () => project(rows.get(active)),
    getCredentials: (username) => rows.get(username) ? {...rows.get(username)} : null,
    updateSteamGuard(username, payload) {
      if (failWrites) throw new Error("database unavailable");
      const current = rows.get(username);
      if (!current) throw new Error("account not found");
      writes.push({type: "updateGuard", username, payload: {...payload}});
      current.mafile_content = payload.mafile_content;
      if (!current.steam_id64 && payload.steam_id64) current.steam_id64 = payload.steam_id64;
    },
    createGuardOnlyAccount(payload) {
      if (failWrites) throw new Error("database unavailable");
      writes.push({type: "createGuardOnly", payload: {...payload}});
      rows.set(payload.username, {
        username: payload.username,
        password: payload.password,
        remark: payload.remark || "",
        steam_name: "",
        steam_id: payload.steam_id64 || "",
        steam_id64: payload.steam_id64 || "",
        avatar_url: "",
        mafile_content: payload.mafile_content || ""
      });
      if (payload.set_active) active = payload.username;
    },
    upsert() {
      throw new Error("legacy upsert path must not be used");
    },
    setActive(username) {
      if (!rows.has(username)) return false;
      active = username;
      return true;
    }
  };
}

function createHarness({failWrites = false} = {}) {
  const accountStore = createAccountStore({failWrites});
  const calls = [];
  const processFlows = new Map();
  const processAdapter = {
    async start(input) {
      calls.push({type: "process_start", input});
      if (input.username === "remote-guard") {
        return {ok: false, reason: "already_has_authenticator"};
      }
      processFlows.set(input.flowId, {username: input.username, password: input.password});
      return {
        ok: true,
        state: "email_code_required",
        flow_id: input.flowId,
        guard_hint: "m***@example.com",
        expires_in_seconds: 300
      };
    },
    async submitEmailCode({flowId, code}) {
      calls.push({type: "process_email", flowId, code});
      return {
        ok: true,
        state: "steam_app_binding_required",
        flow_id: flowId,
        expires_in_seconds: 300
      };
    },
    async verifyAppCode({flowId, code}) {
      calls.push({type: "process_verify", flowId, code});
      const flow = processFlows.get(flowId);
      if (flow.username === "time-fails") {
        return {ok: false, reason: "time_sync_failed", attempts_remaining: 3};
      }
      const steamId64 = flow.username === "existing" ? "76561198000000001" : "76561198000000999";
      const maFile = {
        shared_secret: SHARED_SECRET,
        identity_secret: IDENTITY_SECRET,
        secret_1: Buffer.from("secret-1").toString("base64"),
        serial_number: "123456",
        revocation_code: "R-ROUTE",
        account_name: flow.username,
        token_gid: "gid",
        uri: "otpauth://route",
        steamid: steamId64,
        Session: null
      };
      return {
        ok: true,
        state: "verified",
        flow_id: flowId,
        account_name: flow.username,
        steam_id64: steamId64,
        password: flow.password,
        file_name: `${flow.username}.maFile`,
        maFile,
        maFileContent: JSON.stringify(maFile)
      };
    },
    cancel(flowId) {
      calls.push({type: "process_cancel", flowId});
      processFlows.delete(flowId);
      return {ok: true};
    }
  };
  const options = {
    licenseRuntimeFactory: () => createReadyLicenseRuntime(),
    accountStoreFactory: () => accountStore,
    uiStateStoreFactory: () => ({
      getLastSelected: () => activeUsername(),
      setLastSelected() {},
      getAccount: () => null
    }),
    tokenStoreFactory: () => ({get: () => ""}),
    steamGuardProcessAdapter: processAdapter
  };
  function activeUsername() {
    const row = accountStore.getActive();
    return row ? row.username : "";
  }
  return {accountStore, calls, options};
}

async function startServer(options) {
  const server = createServer(options);
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {server, port: server.address().port};
}

function requestJson(ctx, method, route, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? "" : JSON.stringify(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port: ctx.port,
      method,
      path: route,
      headers: payload ? {"Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload)} : {}
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({statusCode: res.statusCode || 0, body: raw ? JSON.parse(raw) : {}});
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function test_local_guard_still_uses_steam_as_remote_truth() {
  const harness = createHarness();
  const ctx = await startServer(harness.options);
  try {
    const response = await requestJson(ctx, "POST", "/api/accounts/steam-guard/coexist/start", {
      mode: "existing",
      username: "local-guard"
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.state, "email_code_required");
    assert.equal(harness.calls.filter((entry) => entry.type === "process_start").length, 1);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_incomplete_local_guard_also_uses_steam_as_remote_truth() {
  const harness = createHarness();
  const ctx = await startServer(harness.options);
  try {
    const response = await requestJson(ctx, "POST", "/api/accounts/steam-guard/coexist/start", {
      mode: "existing",
      username: "local-incomplete-guard"
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.state, "email_code_required");
    assert.equal(harness.calls.filter((entry) => entry.type === "process_start").length, 1);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_remote_authenticator_is_reported_without_add_call() {
  const harness = createHarness();
  const ctx = await startServer(harness.options);
  try {
    const response = await requestJson(ctx, "POST", "/api/accounts/steam-guard/coexist/start", {
      mode: "new",
      username: "remote-guard",
      password: "secret"
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.reason, "already_has_authenticator");
    assert.equal(response.body.retry_after_seconds, 60);
    assert.equal(harness.calls.filter((entry) => entry.type === "process_start").length, 1);

    const blocked = await requestJson(ctx, "POST", "/api/accounts/steam-guard/coexist/start", {
      mode: "new",
      username: "remote-guard",
      password: "secret"
    });
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.body.reason, "already_has_authenticator_cooldown");
    assert.equal(blocked.body.retry_after_seconds, 60);
    assert.equal(harness.calls.filter((entry) => entry.type === "process_start").length, 1);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function completeFlow(ctx, startBody) {
  const start = await requestJson(ctx, "POST", "/api/accounts/steam-guard/coexist/start", startBody);
  assert.equal(start.statusCode, 200);
  assert.equal(start.body.state, "email_code_required");
  const continued = await requestJson(ctx, "POST", "/api/accounts/steam-guard/coexist/submit-email-code", {
    flow_id: start.body.flow_id,
    code: "EML01"
  });
  assert.equal(continued.statusCode, 200);
  assert.equal(continued.body.state, "steam_app_binding_required");
  return requestJson(ctx, "POST", "/api/accounts/steam-guard/coexist/verify-app-code", {
    flow_id: start.body.flow_id,
    code: "APP01"
  });
}

async function test_coexist_code_routes_reject_invalid_format_before_worker_calls() {
  const harness = createHarness();
  const ctx = await startServer(harness.options);
  try {
    const start = await requestJson(ctx, "POST", "/api/accounts/steam-guard/coexist/start", {
      mode: "new",
      username: "format-check",
      password: "secret"
    });
    const emailCalls = harness.calls.filter((entry) => entry.type === "process_email").length;
    const invalidEmail = await requestJson(ctx, "POST", "/api/accounts/steam-guard/coexist/submit-email-code", {
      flow_id: start.body.flow_id,
      code: "abc12"
    });
    assert.equal(invalidEmail.statusCode, 400);
    assert.equal(invalidEmail.body.reason, "invalid_code_format");
    assert.equal(harness.calls.filter((entry) => entry.type === "process_email").length, emailCalls);

    const continued = await requestJson(ctx, "POST", "/api/accounts/steam-guard/coexist/submit-email-code", {
      flow_id: start.body.flow_id,
      code: "ABC12"
    });
    assert.equal(continued.statusCode, 200);
    const verifyCalls = harness.calls.filter((entry) => entry.type === "process_verify").length;
    const invalidApp = await requestJson(ctx, "POST", "/api/accounts/steam-guard/coexist/verify-app-code", {
      flow_id: start.body.flow_id,
      code: "A-123"
    });
    assert.equal(invalidApp.statusCode, 400);
    assert.equal(invalidApp.body.reason, "invalid_code_format");
    assert.equal(harness.calls.filter((entry) => entry.type === "process_verify").length, verifyCalls);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_new_guard_only_account_persists_only_after_verify() {
  const harness = createHarness();
  const ctx = await startServer(harness.options);
  try {
    const response = await completeFlow(ctx, {
      mode: "new",
      username: "guard-only",
      password: "new-password",
      remark: "new remark"
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(Object.hasOwn(response.body, "maFile"), false);
    assert.equal(Object.hasOwn(response.body, "maFileContent"), false);
    assert.equal(JSON.stringify(response.body).includes(SHARED_SECRET), false);
    const write = harness.accountStore.writes.find((entry) => entry.type === "createGuardOnly");
    assert.equal(write.payload.username, "guard-only");
    assert.equal(write.payload.password, "new-password");
    assert.equal(write.payload.set_active, true);
    const saved = harness.accountStore.getCredentials("guard-only");
    assert.equal(JSON.parse(saved.mafile_content).Session, null);
    assert.equal(harness.accountStore.getActive().username, "guard-only");
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_existing_account_only_updates_guard() {
  const harness = createHarness();
  const before = harness.accountStore.getCredentials("existing");
  const ctx = await startServer(harness.options);
  try {
    const response = await completeFlow(ctx, {mode: "existing", username: "existing"});
    assert.equal(response.statusCode, 200);
    const writes = harness.accountStore.writes;
    assert.equal(writes.filter((entry) => entry.type === "updateGuard").length, 1);
    assert.equal(writes.some((entry) => entry.type === "createGuardOnly"), false);
    const after = harness.accountStore.getCredentials("existing");
    assert.equal(after.password, before.password);
    assert.equal(after.remark, before.remark);
    assert.equal(after.steam_name, before.steam_name);
    assert.equal(after.avatar_url, before.avatar_url);
    assert.equal(after.balance, before.balance);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_persistence_failure_never_returns_success() {
  const harness = createHarness({failWrites: true});
  const ctx = await startServer(harness.options);
  try {
    const response = await completeFlow(ctx, {
      mode: "new",
      username: "write-fails",
      password: "new-password"
    });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, {
      ok: false,
      reason: "persistence_failed",
      message: "令牌保存失败"
    });
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_time_sync_failure_is_retryable_without_attempt_limit() {
  const harness = createHarness();
  const ctx = await startServer(harness.options);
  try {
    const start = await requestJson(ctx, "POST", "/api/accounts/steam-guard/coexist/start", {
      mode: "new",
      username: "time-fails",
      password: "new-password"
    });
    await requestJson(ctx, "POST", "/api/accounts/steam-guard/coexist/submit-email-code", {
      flow_id: start.body.flow_id,
      code: "EML01"
    });
    const response = await requestJson(ctx, "POST", "/api/accounts/steam-guard/coexist/verify-app-code", {
      flow_id: start.body.flow_id,
      code: "APP01"
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.reason, "time_sync_failed");
    assert.equal(Object.hasOwn(response.body, "attempts_remaining"), false);
    assert.match(response.body.message, /检查网络后重试/);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function main() {
  await test_local_guard_still_uses_steam_as_remote_truth();
  await test_incomplete_local_guard_also_uses_steam_as_remote_truth();
  await test_remote_authenticator_is_reported_without_add_call();
  await test_coexist_code_routes_reject_invalid_format_before_worker_calls();
  await test_new_guard_only_account_persists_only_after_verify();
  await test_existing_account_only_updates_guard();
  await test_persistence_failure_never_returns_success();
  await test_time_sync_failure_is_retryable_without_attempt_limit();
  console.log("steam-guard-coexist-route tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
