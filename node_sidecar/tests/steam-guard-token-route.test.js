const assert = require("node:assert/strict");
const http = require("node:http");

const {createServer} = require("../src/uiServer");

const sharedSecret = Buffer.from("route-shared").toString("base64");
const identitySecret = Buffer.from("route-identity").toString("base64");
const maFile = JSON.stringify({
  shared_secret: sharedSecret,
  identity_secret: identitySecret,
  secret_1: Buffer.from("route-secret-1").toString("base64"),
  serial_number: "123456",
  revocation_code: "R-ROUTE",
  account_name: "demo",
  device_id: "android:12345678-1234-4123-8123-123456789abc",
  steamid: "76561198000000001",
  access_token: "must_not_export",
  Session: {
    SteamID: "76561198000000001",
    SteamLoginSecure: "must_not_export"
  }
});

function createReadyLicenseRuntime(permissions = ["accounts.read", "accounts.write"]) {
  const state = {
    ok: true,
    code: "ready",
    user: {id: "user_test", username: "member_test", membership_plan: "pro"},
    permissions,
    featureFlags: {},
    expiresAt: "2099-01-01T00:15:00.000Z",
    expiresInMs: 86400000
  };
  return {getState: () => state, stop() {}, importBundle: () => state, clear: () => state};
}

function makeAccountStore(state = {}) {
  const publicRow = {
    username: "demo",
    remark: "Demo",
    steam_name: "",
    steam_id: "76561198000000001",
    steam_id64: "76561198000000001",
    avatar_url: "",
    has_steam_guard: true,
    is_active: true
  };
  const mutable = {maFile: state.maFile || maFile, password: "secret"};
  const store = {
    list: () => [publicRow],
    getActive: () => publicRow,
    get: (username) => username === "demo" ? publicRow : null,
    getCredentials: (username) => username === "demo"
      ? {...publicRow, password: mutable.password, mafile_content: mutable.maFile}
      : null,
    clearPassword: (username) => {
      state.clearPasswordCalls = (state.clearPasswordCalls || 0) + 1;
      if (state.failPasswordClear) throw new Error("password write failed");
      if (username !== "demo") throw new Error("steam account not found");
      mutable.password = "";
      return true;
    },
    clearSteamGuard: (username) => {
      state.clearCalls = (state.clearCalls || 0) + 1;
      if (username !== "demo") throw new Error("steam account not found");
      mutable.maFile = "";
      return true;
    }
  };
  return store;
}

async function startServer(options = {}) {
  const server = createServer({
    licenseRuntimeFactory: () => options.licenseRuntime || createReadyLicenseRuntime(),
    authStoreFactory: options.authStoreFactory,
    accountStoreFactory: () => options.accountStore || makeAccountStore(),
    tokenStoreFactory: () => ({get: (username) => username === "demo" ? "refresh_token" : ""}),
    tokenRecoveryService: options.tokenRecoveryService,
    uiStateStoreFactory: options.uiStateStoreFactory
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {server, port: server.address().port};
}

function request(ctx, method, route, payload) {
  return new Promise((resolve, reject) => {
    const rawPayload = payload === undefined ? "" : JSON.stringify(payload);
    const req = http.request({
      hostname: "127.0.0.1",
      port: ctx.port,
      method,
      path: route,
      headers: rawPayload ? {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(rawPayload)
      } : undefined
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let body = raw;
        try { body = raw ? JSON.parse(raw) : {}; } catch (_) {}
        resolve({statusCode: res.statusCode || 0, headers: res.headers, body});
      });
    });
    req.on("error", reject);
    req.end(rawPayload || undefined);
  });
}

async function test_delete_clears_only_local_guard_after_permission_and_scope_checks() {
  const state = {};
  const accountStore = makeAccountStore(state);
  const ctx = await startServer({
    accountStore,
    authStoreFactory: () => ({
      getUserByUsername: () => null,
      canAccessSteamAccount: (_viewer, username) => username === "demo",
      close() {}
    })
  });
  try {
    const response = await request(ctx, "DELETE", "/api/accounts/steam-guard", {username: "demo"});
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {ok: true, username: "demo", has_steam_guard: false});
    assert.equal(state.clearCalls, 1);
    assert.equal(accountStore.getCredentials("demo").password, "secret");
    assert.equal(accountStore.getCredentials("demo").mafile_content, "");

    const repeated = await request(ctx, "DELETE", "/api/accounts/steam-guard", {username: "demo"});
    assert.equal(repeated.statusCode, 409);
    assert.equal(repeated.body.reason, "guard_missing");
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_delete_requires_accounts_write_permission() {
  const state = {};
  const ctx = await startServer({
    licenseRuntime: createReadyLicenseRuntime(["accounts.read"]),
    accountStore: makeAccountStore(state)
  });
  try {
    const response = await request(ctx, "DELETE", "/api/accounts/steam-guard", {username: "demo"});
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.reason, "permission_denied");
    assert.equal(state.clearCalls || 0, 0);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_delete_allows_signed_writer_for_any_local_account() {
  const state = {};
  const ctx = await startServer({
    accountStore: makeAccountStore(state),
    authStoreFactory: () => ({
      getUserByUsername: () => ({username: "member_test", is_super_admin: false}),
      canAccessSteamAccount: () => false,
      close() {}
    })
  });
  try {
    const response = await request(ctx, "DELETE", "/api/accounts/steam-guard", {username: "demo"});
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {ok: true, username: "demo", has_steam_guard: false});
    assert.equal(state.clearCalls, 1);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_writer_account_projection_includes_password_but_not_guard_secret() {
  const ctx = await startServer();
  try {
    const response = await request(ctx, "GET", "/api/accounts");
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    const row = response.body.accounts[0];
    assert.equal(row.has_steam_guard, true);
    assert.equal(row.has_refresh_token, true);
    assert.equal(row.password, "secret");
    assert.equal(row.steam_guard_type, "full");
    assert.deepEqual(row.steam_guard_capabilities, {
      login_code: true,
      confirmation: true,
      recovery_code: true,
      web_session: true
    });
    assert.equal(Object.hasOwn(row, "mafile_content"), false);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_login_only_account_projects_limited_capabilities_and_blocks_recovery_code() {
  const loginOnlyMaFile = JSON.stringify({
    account_name: "demo",
    shared_secret: sharedSecret,
    Session: {SteamID: "76561198000000001"}
  });
  const ctx = await startServer({accountStore: makeAccountStore({maFile: loginOnlyMaFile})});
  try {
    const accounts = await request(ctx, "GET", "/api/accounts");
    assert.equal(accounts.statusCode, 200);
    assert.equal(accounts.body.accounts[0].steam_guard_type, "login_only");
    assert.deepEqual(accounts.body.accounts[0].steam_guard_capabilities, {
      login_code: true,
      confirmation: false,
      recovery_code: false,
      web_session: false
    });

    const code = await request(ctx, "GET", "/api/accounts/steam-guard/code?username=demo");
    assert.equal(code.statusCode, 200);
    const recovery = await request(ctx, "GET", "/api/accounts/steam-guard/recovery-code?username=demo");
    assert.equal(recovery.statusCode, 409);
    assert.equal(recovery.body.reason, "guard_capability_missing");
    assert.equal(JSON.stringify(accounts.body).includes(sharedSecret), false);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_token_code_and_recovery_routes_do_not_leak_secret() {
  const ctx = await startServer();
  try {
    const code = await request(ctx, "GET", "/api/accounts/steam-guard/code?username=demo");
    assert.equal(code.statusCode, 200);
    assert.deepEqual(Object.keys(code.body).sort(), ["current_code", "ok", "period", "remaining_seconds"]);
    assert.equal(code.body.current_code.length, 5);
    assert.equal(JSON.stringify(code.body).includes(sharedSecret), false);

    const recovery = await request(ctx, "GET", "/api/accounts/steam-guard/recovery-code?username=demo");
    assert.equal(recovery.statusCode, 200);
    assert.deepEqual(recovery.body, {ok: true, recovery_code: "R-ROUTE"});
    assert.equal(JSON.stringify(recovery.body).includes(sharedSecret), false);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_expired_guard_account_recovers_login_and_clears_auth_state() {
  const calls = [];
  const ctx = await startServer({
    authStoreFactory: () => ({
      getUserByUsername: () => null,
      canAccessSteamAccount: (_viewer, username) => username === "demo",
      close() {}
    }),
    tokenRecoveryService: {
      async recoverToken(username) {
        calls.push({type: "recover", username});
        return "replacement-refresh-token";
      }
    },
    uiStateStoreFactory: () => ({
      getAccount: () => ({auth_state: "auth_invalid", auth_reason: "login_key_invalid"}),
      clearAccountAuthState(username) {
        calls.push({type: "clear", username});
      }
    })
  });
  try {
    const response = await request(ctx, "POST", "/api/accounts/steam-guard/recover-login", {username: "demo"});
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      ok: true,
      username: "demo",
      reconnected: true,
      has_refresh_token: true
    });
    assert.deepEqual(calls, [
      {type: "recover", username: "demo"},
      {type: "clear", username: "demo"}
    ]);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_expired_guard_account_requests_password_only_from_structured_credential_state() {
  const state = {};
  const accountStore = makeAccountStore(state);
  const ctx = await startServer({
    accountStore,
    authStoreFactory: () => ({
      getUserByUsername: () => null,
      canAccessSteamAccount: (_viewer, username) => username === "demo",
      close() {}
    }),
    tokenRecoveryService: {
      async recoverToken() {
        const error = new Error("saved credential rejected");
        error.reason = "invalid_credentials";
        error.auth_state = "needs_attention";
        error.credential_state = "password_reentry_required";
        error.status = 409;
        throw error;
      }
    },
    uiStateStoreFactory: () => ({
      getAccount: () => ({auth_state: "auth_invalid", auth_reason: "login_key_invalid"}),
      clearAccountAuthState() {
        throw new Error("must not clear failed recovery state");
      }
    })
  });
  try {
    const response = await request(ctx, "POST", "/api/accounts/steam-guard/recover-login", {username: "demo"});
    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.body, {
      ok: false,
      reason: "invalid_credentials",
      message: "保存的 Steam 密码已失效，请重新输入密码",
      auth_state: "needs_attention",
      credential_state: "password_reentry_required",
      password_cleared: true
    });
    assert.equal(state.clearPasswordCalls, 1);
    assert.equal(accountStore.getCredentials("demo").password, "");
    assert.equal(accountStore.getCredentials("demo").mafile_content, maFile);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_password_reentry_response_is_not_sent_when_password_clear_fails() {
  const state = {failPasswordClear: true};
  const ctx = await startServer({
    accountStore: makeAccountStore(state),
    authStoreFactory: () => ({
      getUserByUsername: () => null,
      canAccessSteamAccount: (_viewer, username) => username === "demo",
      close() {}
    }),
    tokenRecoveryService: {
      async recoverToken() {
        const error = new Error("saved credential rejected");
        error.reason = "invalid_credentials";
        error.auth_state = "needs_attention";
        error.credential_state = "password_reentry_required";
        error.status = 409;
        throw error;
      }
    },
    uiStateStoreFactory: () => ({
      getAccount: () => ({auth_state: "auth_invalid", auth_reason: "login_key_invalid"})
    })
  });
  try {
    const response = await request(ctx, "POST", "/api/accounts/steam-guard/recover-login", {username: "demo"});
    assert.equal(response.statusCode, 500);
    assert.equal(response.body.reason, "password_clear_failed");
    assert.equal(Object.hasOwn(response.body, "password_cleared"), false);
    assert.equal(state.clearPasswordCalls, 1);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_guard_recovery_skips_nonexpired_account_without_claiming_token_state() {
  let recoveryCalls = 0;
  const ctx = await startServer({
    authStoreFactory: () => ({
      getUserByUsername: () => null,
      canAccessSteamAccount: (_viewer, username) => username === "demo",
      close() {}
    }),
    tokenRecoveryService: {
      async recoverToken() {
        recoveryCalls += 1;
      }
    },
    uiStateStoreFactory: () => ({
      getAccount: () => ({auth_state: "normal", auth_reason: ""})
    })
  });
  try {
    const response = await request(ctx, "POST", "/api/accounts/steam-guard/recover-login", {username: "demo"});
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      ok: true,
      username: "demo",
      reconnected: false,
      skipped_reason: "account_not_expired"
    });
    assert.equal(recoveryCalls, 0);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_guard_recovery_allows_signed_writer_for_any_local_account() {
  let recoveryCalls = 0;
  const ctx = await startServer({
    authStoreFactory: () => ({
      getUserByUsername: () => ({username: "member_test", is_super_admin: false}),
      canAccessSteamAccount: () => false,
      close() {}
    }),
    tokenRecoveryService: {
      async recoverToken() {
        recoveryCalls += 1;
      }
    }
  });
  try {
    const response = await request(ctx, "POST", "/api/accounts/steam-guard/recover-login", {username: "demo"});
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.reconnected, false);
    assert.equal(response.body.skipped_reason, "account_not_expired");
    assert.equal(recoveryCalls, 0);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_export_is_attachment_and_strips_session_tokens() {
  const ctx = await startServer();
  try {
    const response = await request(ctx, "GET", "/api/accounts/steam-guard/export?username=demo");
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers["content-disposition"] || ""), /demo\.maFile/);
    assert.equal(response.body.Session, null);
    assert.equal(response.body.shared_secret, sharedSecret);
    assert.equal(Object.hasOwn(response.body, "access_token"), false);
    assert.equal(JSON.stringify(response.body).includes("must_not_export"), false);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_legacy_secret_and_enrollment_routes_are_gone() {
  const ctx = await startServer();
  try {
    for (const [method, route] of [
      ["GET", "/api/accounts/token-detail?username=demo"],
      ["POST", "/api/accounts/enroll-steam-guard"],
      ["POST", "/api/accounts/finalize-steam-guard"]
    ]) {
      const response = await request(ctx, method, route);
      assert.equal(response.statusCode, 404, `${method} ${route} must be removed`);
    }
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function main() {
  await test_writer_account_projection_includes_password_but_not_guard_secret();
  await test_login_only_account_projects_limited_capabilities_and_blocks_recovery_code();
  await test_token_code_and_recovery_routes_do_not_leak_secret();
  await test_expired_guard_account_recovers_login_and_clears_auth_state();
  await test_expired_guard_account_requests_password_only_from_structured_credential_state();
  await test_password_reentry_response_is_not_sent_when_password_clear_fails();
  await test_guard_recovery_skips_nonexpired_account_without_claiming_token_state();
  await test_guard_recovery_allows_signed_writer_for_any_local_account();
  await test_export_is_attachment_and_strips_session_tokens();
  await test_legacy_secret_and_enrollment_routes_are_gone();
  await test_delete_clears_only_local_guard_after_permission_and_scope_checks();
  await test_delete_allows_signed_writer_for_any_local_account();
  await test_delete_requires_accounts_write_permission();
  console.log("steam-guard-token-route tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
