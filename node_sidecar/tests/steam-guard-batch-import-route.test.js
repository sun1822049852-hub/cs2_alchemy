const assert = require("node:assert/strict");
const http = require("node:http");

const {createServer} = require("../src/uiServer");

function makeMaFile(accountName, overrides = {}) {
  return JSON.stringify({
    account_name: accountName,
    shared_secret: Buffer.from(`shared-${accountName}`).toString("base64"),
    identity_secret: Buffer.from(`identity-${accountName}`).toString("base64"),
    revocation_code: "R12345",
    fully_enrolled: false,
    status: 0,
    access_token: "must-not-leak-access",
    refresh_token: "must-not-leak-refresh",
    Session: {SteamLoginSecure: "must-not-leak-cookie", WebCookie: "must-not-leak-cookie"},
    ...overrides
  });
}

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

function makeAccountStore() {
  const rows = new Map([
    ["existing", {
      username: "existing",
      remark: "本地备注",
      steam_name: "Display only",
      has_steam_guard: true,
      password: "old-password",
      mafile_content: makeMaFile("existing")
    }],
    ["without_guard", {
      username: "without_guard",
      remark: "保留备注",
      steam_name: "Preserved profile",
      steam_id64: "76561198000000002",
      has_steam_guard: false,
      password: "saved-password",
      mafile_content: ""
    }],
    ["without_guard_replace", {
      username: "without_guard_replace",
      remark: "覆盖密码",
      steam_name: "Preserved replacement profile",
      steam_id64: "76561198000000003",
      has_steam_guard: false,
      password: "replace-old-password",
      mafile_content: ""
    }],
    ["without_guard_same", {
      username: "without_guard_same",
      remark: "相同密码",
      steam_name: "Same password profile",
      steam_id64: "76561198000000004",
      has_steam_guard: false,
      password: "saved-password",
      mafile_content: ""
    }]
  ]);
  const calls = {attached: [], created: [], overwritten: []};
  return {
    calls,
    rows,
    list: () => [...rows.values()].map(({password, mafile_content, ...row}) => ({...row})),
    getActive: () => null,
    get: (username) => {
      const row = rows.get(username);
      if (!row) return null;
      const {password, mafile_content, ...publicRow} = row;
      return {...publicRow};
    },
    getCredentials: (username) => rows.get(username) || null,
    createGuardOnlyAccount: (payload) => {
      if (rows.has(payload.username)) {
        const err = new Error("duplicate");
        err.code = "duplicate_existing";
        throw err;
      }
      calls.created.push(payload);
      rows.set(payload.username, {
        username: payload.username,
        password: payload.password,
        mafile_content: payload.mafile_content,
        remark: "",
        steam_name: "",
        has_steam_guard: true,
        has_password: Boolean(String(payload.password || "").trim())
      });
      return true;
    },
    createSteamGuardImport: () => {
      throw new Error("legacy createSteamGuardImport path must not be used");
    },
    attachSteamGuardImport: (username, payload) => {
      const current = rows.get(username);
      if (!current) {
        const err = new Error("not found");
        err.code = "account_not_found";
        throw err;
      }
      if (current.has_steam_guard || String(current.mafile_content || "").trim()) {
        const err = new Error("guard exists");
        err.code = "duplicate_existing";
        throw err;
      }
      calls.attached.push({username, ...payload});
      rows.set(username, {
        ...current,
        password: payload.password_action === "overwrite" ? payload.password : current.password,
        mafile_content: payload.mafile_content,
        has_steam_guard: true
      });
      return true;
    },
    overwriteSteamGuardImport: (username, payload) => {
      const current = rows.get(username);
      if (!current) throw new Error("not found");
      calls.overwritten.push({username, ...payload});
      rows.set(username, {
        ...current,
        password: payload.password_action === "overwrite" ? payload.password : current.password,
        mafile_content: payload.mafile_content
      });
      return true;
    }
  };
}

async function startServer(accountStore, {loginAndSaveTokenFn} = {}) {
  const refreshRuntime = {
    start() {},
    stop() {},
    isConnected: (username) => username === "existing",
    handleSseRequest() {},
    emitSse() {},
    removeAccount() {}
  };
  const server = createServer({
    licenseRuntimeFactory: () => createReadyLicenseRuntime(),
    authStoreFactory: () => ({
      getUserByUsername: () => null,
      canAccessSteamAccount: () => true,
      close() {}
    }),
    accountStoreFactory: () => accountStore,
    refreshRuntime,
    loginAndSaveTokenFn: loginAndSaveTokenFn || (async () => {
      throw new Error("batch import must not log in");
    }),
    tokenStoreFactory: () => ({
      get: () => "",
      set: () => { throw new Error("batch import must not write TokenStore"); }
    })
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {server, port: server.address().port};
}

function request(ctx, method, route, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: ctx.port,
      method,
      path: route,
      headers: {"Content-Type": "application/json"}
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        statusCode: res.statusCode || 0,
        headers: res.headers,
        raw: Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(payload || {}));
  });
}

function parseJson(response) {
  return JSON.parse(response.raw || "{}");
}

function parseSse(response) {
  return response.raw.trim().split(/\n\n+/).filter(Boolean).map((block) => {
    const lines = block.split("\n");
    return {
      event: lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "",
      data: JSON.parse(lines.find((line) => line.startsWith("data:"))?.slice(5).trim() || "{}")
    };
  });
}

async function test_preflight_distinguishes_attach_overwrite_and_manual_file_selection() {
  const store = makeAccountStore();
  const ctx = await startServer(store);
  try {
    const response = await request(ctx, "POST", "/api/accounts/batch-import/preflight", {accounts: [
      {client_id: "ready", file_name: "same.maFile", maFileContent: makeMaFile("ready")},
      {client_id: "existing", file_name: "existing.maFile", password: "different-password", maFileContent: makeMaFile("existing")},
      {client_id: "without-guard", file_name: "without-guard.maFile", password: "different-password", maFileContent: makeMaFile("without_guard")},
      {client_id: "without-guard-same", file_name: "without-guard-same.maFile", password: "saved-password", maFileContent: makeMaFile("without_guard_same")},
      {client_id: "batch-a", file_name: "a.maFile", maFileContent: makeMaFile("duplicate")},
      {client_id: "batch-b", file_name: "b.maFile", maFileContent: makeMaFile("duplicate")},
      {client_id: "invalid", file_name: "invalid.maFile", maFileContent: makeMaFile("invalid", {revocation_code: "12345"})},
      {client_id: "invalid-json", file_name: "invalid-json.maFile", maFileContent: "not-json"},
      {client_id: "mixed-valid", file_name: "mixed-valid.maFile", maFileContent: makeMaFile("mixed")},
      {client_id: "mixed-invalid", file_name: "mixed-invalid.maFile", maFileContent: makeMaFile("mixed", {revocation_code: "12345"})},
      {client_id: "other-name", file_name: "same.maFile", maFileContent: makeMaFile("other")}
    ]});
    assert.equal(response.statusCode, 200);
    const body = parseJson(response);
    const byId = new Map(body.items.map((item) => [item.client_id, item]));
    assert.equal(byId.get("ready").status, "ready");
    assert.equal(byId.get("other-name").status, "ready");
    assert.equal(byId.get("ready").target_action, "create");
    assert.deepEqual(byId.get("existing"), {
      client_id: "existing",
      file_name: "existing.maFile",
      account_name: "existing",
      status: "duplicate_existing",
      target_action: "overwrite",
      existing_has_steam_guard: true,
      existing_remark: "本地备注",
      connected: true,
      password_differs: true
    });
    assert.deepEqual(byId.get("without-guard"), {
      client_id: "without-guard",
      file_name: "without-guard.maFile",
      account_name: "without_guard",
      status: "password_confirmation_required",
      target_action: "attach",
      existing_has_steam_guard: false,
      existing_remark: "保留备注",
      connected: false,
      password_differs: true
    });
    assert.equal(byId.get("without-guard-same").status, "ready");
    assert.equal(byId.get("without-guard-same").password_differs, false);
    assert.equal(byId.get("batch-a").status, "selection_required");
    assert.equal(byId.get("batch-b").status, "selection_required");
    assert.equal(byId.get("batch-a").target_action, "create");
    assert.equal(byId.get("batch-a").selection_group, "duplicate");
    assert.equal(byId.get("batch-a").group_size, 2);
    assert.equal(byId.get("invalid").status, "invalid");
    assert.equal(byId.get("invalid").reason, "invalid_mafile_format");
    assert.equal(byId.get("invalid").account_name, "invalid");
    assert.equal(byId.get("invalid").message, "令牌文件格式错误");
    assert.equal(byId.get("invalid-json").status, "invalid");
    assert.equal(byId.get("invalid-json").account_name, "");
    assert.equal(byId.get("mixed-valid").status, "ready");
    assert.equal(byId.get("mixed-valid").target_action, "create");
    assert.equal(byId.get("mixed-invalid").status, "invalid");
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("must-not-leak"), false);
    assert.equal(serialized.includes("shared-"), false);
    assert.equal(serialized.includes("old-password"), false);
    assert.equal(serialized.includes("different-password"), false);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_batch_import_creates_new_attaches_missing_guard_and_defers_existing_guard() {
  const store = makeAccountStore();
  let loginCalls = 0;
  const ctx = await startServer(store, {loginAndSaveTokenFn: async () => { loginCalls += 1; }});
  try {
    const response = await request(ctx, "POST", "/api/accounts/batch-import", {accounts: [
      {client_id: "ready", file_name: "ready.maFile", password: "ready-password", maFileContent: makeMaFile("ready")},
      {client_id: "ready-empty", file_name: "ready-empty.maFile", maFileContent: makeMaFile("ready_empty")},
      {client_id: "without-guard", file_name: "without-guard.maFile", password: "fresh-password", password_action: "discard", maFileContent: makeMaFile("without_guard")},
      {client_id: "without-guard-replace", file_name: "without-guard-replace.maFile", password: "replacement-password", password_action: "overwrite", maFileContent: makeMaFile("without_guard_replace")},
      {client_id: "existing", file_name: "existing.maFile", password: "next-password", maFileContent: makeMaFile("existing")}
    ]});
    assert.match(String(response.headers["content-type"] || ""), /text\/event-stream/);
    const events = parseSse(response);
    const results = events.filter((item) => item.event === "account_result").map((item) => item.data);
    assert.equal(results.find((item) => item.client_id === "ready").status, "added");
    assert.equal(results.find((item) => item.client_id === "ready-empty").status, "added");
    assert.equal(results.find((item) => item.client_id === "without-guard").status, "attached");
    assert.equal(results.find((item) => item.client_id === "without-guard-replace").status, "attached");
    assert.deepEqual(results.find((item) => item.client_id === "existing"), {
      client_id: "existing",
      file_name: "existing.maFile",
      account_name: "existing",
      username: "existing",
      ok: false,
      status: "password_confirmation_required",
      reason: "password_confirmation_required",
      message: "导入密码与本地密码不同，请选择覆盖或丢弃导入密码",
      existing_remark: "本地备注",
      connected: true,
      password_differs: true,
      existing_has_steam_guard: true,
      target_action: "overwrite",
      done: 5,
      total: 5
    });
    assert.equal(loginCalls, 0);
    assert.equal(store.calls.created.length, 2);
    assert.equal(store.calls.attached.length, 2);
    assert.equal(store.calls.attached[0].username, "without_guard");
    assert.equal(store.rows.get("without_guard").password, "saved-password");
    assert.equal(store.rows.get("without_guard").remark, "保留备注");
    assert.equal(store.rows.get("without_guard").steam_name, "Preserved profile");
    assert.equal(store.rows.get("without_guard").steam_id64, "76561198000000002");
    assert.equal(store.rows.get("without_guard_replace").password, "replacement-password");
    assert.equal(store.rows.get("without_guard_replace").remark, "覆盖密码");
    assert.equal(store.rows.get("ready_empty").password, "");
    const saved = JSON.parse(store.calls.created.find((entry) => entry.username === "ready").mafile_content);
    assert.equal(saved.account_name, "ready");
    assert.equal(saved.Session, null);
    assert.equal(Object.hasOwn(saved, "access_token"), false);
    assert.equal(Object.hasOwn(saved, "refresh_token"), false);
    assert.equal(JSON.stringify(saved).includes("must-not-leak-cookie"), false);
    assert.equal(store.calls.overwritten.length, 0);
    const done = events.find((item) => item.event === "done").data;
    assert.equal(done.pending_confirmation, 1);
    assert.equal(done.skipped, 0);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_batch_import_requires_manual_selection_then_applies_only_selected_file() {
  const store = makeAccountStore();
  const ctx = await startServer(store);
  try {
    const blocked = await request(ctx, "POST", "/api/accounts/batch-import", {accounts: [
      {client_id: "overwrite", file_name: "existing.maFile", password: "next-password", password_action: "overwrite", maFileContent: makeMaFile("existing"), overwrite: true},
      {client_id: "batch-a", file_name: "a.maFile", password: "a", maFileContent: makeMaFile("same-batch")},
      {client_id: "batch-b", file_name: "b.maFile", password: "b", maFileContent: makeMaFile("same-batch")},
      {client_id: "mixed-valid", file_name: "mixed-valid.maFile", password: "valid", maFileContent: makeMaFile("mixed")},
      {client_id: "mixed-invalid", file_name: "mixed-invalid.maFile", password: "invalid", maFileContent: makeMaFile("mixed", {revocation_code: "12345"})}
    ]});
    const events = parseSse(blocked);
    const results = events.filter((item) => item.event === "account_result").map((item) => item.data);
    assert.equal(results.find((item) => item.client_id === "overwrite").status, "overwritten");
    assert.equal(results.find((item) => item.client_id === "batch-a").status, "selection_required");
    assert.equal(results.find((item) => item.client_id === "batch-b").status, "selection_required");
    assert.equal(results.find((item) => item.client_id === "mixed-valid").status, "added");
    assert.equal(results.find((item) => item.client_id === "mixed-invalid").status, "invalid");
    assert.equal(store.calls.overwritten.length, 1);
    assert.equal(store.calls.created.length, 1);
    assert.equal(store.rows.has("same-batch"), false);
    assert.equal(store.rows.get("existing").remark, "本地备注");
    assert.equal(store.rows.get("existing").password, "next-password");
    const done = events.find((item) => item.event === "done").data;
    assert.equal(done.added, 1);
    assert.equal(done.overwritten, 1);
    assert.equal(done.pending_selection, 1);
    assert.equal(done.skipped, 0);
    assert.equal(done.failed, 1);

    const selected = await request(ctx, "POST", "/api/accounts/batch-import", {accounts: [
      {client_id: "batch-b", file_name: "b.maFile", password: "b", maFileContent: makeMaFile("same-batch")}
    ]});
    const selectedResult = parseSse(selected).find((item) => item.event === "account_result").data;
    assert.equal(selectedResult.status, "added");
    assert.equal(store.rows.get("same-batch").password, "b");
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function test_execution_rechecks_preflight_and_does_not_leak_persistence_errors() {
  const store = makeAccountStore();
  const ctx = await startServer(store);
  try {
    const preflight = await request(ctx, "POST", "/api/accounts/batch-import/preflight", {accounts: [
      {client_id: "raced", file_name: "raced.maFile", maFileContent: makeMaFile("raced")}
    ]});
    assert.equal(parseJson(preflight).items[0].status, "ready");
    store.rows.set("raced", {
      username: "raced",
      password: "existing-password",
      mafile_content: "",
      remark: "并发新增",
      has_steam_guard: false
    });

    const raced = await request(ctx, "POST", "/api/accounts/batch-import", {accounts: [
      {client_id: "raced", file_name: "raced.maFile", password: "next", maFileContent: makeMaFile("raced")}
    ]});
    const racedResult = parseSse(raced).find((item) => item.event === "account_result").data;
    assert.equal(racedResult.status, "password_confirmation_required");
    assert.equal(store.rows.get("raced").remark, "并发新增");
    assert.equal(store.rows.get("raced").password, "existing-password");

    const racedDiscard = await request(ctx, "POST", "/api/accounts/batch-import", {accounts: [
      {client_id: "raced", file_name: "raced.maFile", password: "next", password_action: "discard", maFileContent: makeMaFile("raced")}
    ]});
    const racedDiscardResult = parseSse(racedDiscard).find((item) => item.event === "account_result").data;
    assert.equal(racedDiscardResult.status, "attached");
    assert.equal(store.rows.get("raced").password, "existing-password");

    store.rows.set("raced-guard", {
      username: "raced-guard",
      password: "existing-password",
      mafile_content: makeMaFile("raced-guard"),
      remark: "并发令牌",
      has_steam_guard: true
    });
    const racedGuard = await request(ctx, "POST", "/api/accounts/batch-import", {accounts: [
      {client_id: "raced-guard", file_name: "raced-guard.maFile", password: "next", maFileContent: makeMaFile("raced-guard")}
    ]});
    const racedGuardResult = parseSse(racedGuard).find((item) => item.event === "account_result").data;
    assert.equal(racedGuardResult.status, "password_confirmation_required");
    assert.equal(racedGuardResult.existing_has_steam_guard, true);
    assert.equal(racedGuardResult.password_differs, true);

    const originalGet = store.get;
    const originalCreate = store.createGuardOnlyAccount;
    store.get = (username) => username === "hidden-race" ? null : originalGet(username);
    store.createGuardOnlyAccount = (payload) => {
      if (payload.username === "hidden-race") {
        const duplicate = new Error("duplicate but not visible");
        duplicate.code = "duplicate_existing";
        throw duplicate;
      }
      return originalCreate(payload);
    };
    const hiddenRace = await request(ctx, "POST", "/api/accounts/batch-import", {accounts: [
      {client_id: "hidden-race", file_name: "hidden-race.maFile", password: "next", maFileContent: makeMaFile("hidden-race")}
    ]});
    const hiddenRaceResult = parseSse(hiddenRace).find((item) => item.event === "account_result").data;
    assert.equal(hiddenRaceResult.status, "failed");
    assert.equal(hiddenRaceResult.reason, "account_state_changed");
    assert.equal(Object.hasOwn(hiddenRaceResult, "existing_has_steam_guard"), false);
    store.get = originalGet;
    store.createGuardOnlyAccount = originalCreate;

    const dangerous = "database error contained shared_secret=TOP_SECRET";
    store.createGuardOnlyAccount = () => { throw new Error(dangerous); };
    const failed = await request(ctx, "POST", "/api/accounts/batch-import", {accounts: [
      {client_id: "failure", file_name: "failure.maFile", password: "next", maFileContent: makeMaFile("failure")}
    ]});
    const failedResult = parseSse(failed).find((item) => item.event === "account_result").data;
    assert.equal(failedResult.reason, "persistence_failed");
    assert.equal(failed.raw.includes("TOP_SECRET"), false);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

async function main() {
  await test_preflight_distinguishes_attach_overwrite_and_manual_file_selection();
  await test_batch_import_creates_new_attaches_missing_guard_and_defers_existing_guard();
  await test_batch_import_requires_manual_selection_then_applies_only_selected_file();
  await test_execution_rechecks_preflight_and_does_not_leak_persistence_errors();
  console.log("steam-guard-batch-import-route tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
