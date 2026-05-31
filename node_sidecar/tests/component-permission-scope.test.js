const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const {FEATURE_CODES} = require("../../shared/licensePolicy");
const {configureRuntimePaths, PATHS} = require("../src/constants");
const {AppAuthStore} = require("../src/appAuthStore");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "component-permission-scope-"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

function createMutableLicenseRuntime({username, permissions}) {
  let current = {
    username,
    permissions: Array.isArray(permissions) ? permissions.slice() : []
  };
  return {
    setUser(nextUsername, nextPermissions) {
      current = {
        username: nextUsername,
        permissions: Array.isArray(nextPermissions) ? nextPermissions.slice() : []
      };
    },
    getState() {
      return {
        ok: true,
        code: "ready",
        user: {
          id: `user_${current.username}`,
          username: current.username,
          membership_plan: "pro"
        },
        permissions: current.permissions.slice(),
        featureFlags: {},
        expiresAt: "2099-01-01T00:15:00.000Z",
        expiresInMs: 86400000
      };
    },
    stop() {},
    importBundle() {
      return this.getState();
    },
    clear() {
      return this.getState();
    }
  };
}

function loadCreateServer({runMoveDeferred, componentCalls}) {
  const uiServerPath = require.resolve("../src/uiServer");
  const uiServerSourcePath = path.join(__dirname, "..", "src", "uiServer.js");
  const originalLoad = Module._load;
  delete require.cache[uiServerPath];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "steam-session") {
      return {
        LoginSession: class FakeLoginSession {},
        EAuthSessionGuardType: {Unknown: 0, None: 1},
        EAuthTokenPlatformType: {SteamClient: 0}
      };
    }
    if (request === "steam-user") {
      return class FakeSteamUser {};
    }
    if (request === "globaloffensive") {
      return class FakeGlobalOffensive {};
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./services/refreshRuntime") {
      return {
        createRefreshRuntime() {
          const connected = new Set(["countsteam01", "countsteam02"]);
          return {
            start() {},
            handleSseRequest() {},
            emitSse() {},
            isConnected(username) {
              return connected.has(String(username || "").trim());
            },
            removeAccount(username) {
              connected.delete(String(username || "").trim());
            }
          };
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./services/componentOpsService") {
      return {
        createComponentOpsService() {
          return {
            async listDepositCandidates(args) {
              componentCalls.push({kind: "deposit-candidates", ...args});
              return {ok: true, rows: []};
            },
            async runMove(args) {
              componentCalls.push({kind: "move", ...args});
              return runMoveDeferred.promise;
            }
          };
        }
      };
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    const {createServer} = require(uiServerPath);
    return createServer;
  } finally {
    Module._load = originalLoad;
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
    server.on("error", reject);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function requestJson({port, route, method = "GET", body = null}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? "" : JSON.stringify(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path: route,
      headers: payload
        ? {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload)
          }
        : {}
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: res.statusCode || 0,
          body: raw ? JSON.parse(raw) : {}
        });
      });
    });
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function seedAuthStore({dbPath, accountsFilePath}) {
  const store = new AppAuthStore({dbPath, accountsFilePath});
  try {
    store.bootstrapAdmin({password: "Admin!234"});
    store.createUser({
      username: "member_a",
      password: "Member!234",
      roleCodes: ["member"],
      boundSteamUsernames: ["countsteam01"]
    });
    store.createUser({
      username: "member_b",
      password: "Member!234",
      roleCodes: ["member"],
      boundSteamUsernames: ["countsteam02"]
    });
  } finally {
    store.close();
  }
}

async function withComponentServer(initialUser, run) {
  const tempDir = makeTempDir();
  const originalPaths = {...PATHS};
  const dbPath = path.join(tempDir, "csgo_skins.db");
  const accountsFilePath = path.join(tempDir, "accounts.json");
  const runMoveDeferred = createDeferred();
  const componentCalls = [];
  const runtime = createMutableLicenseRuntime(initialUser);
  try {
    configureRuntimePaths({
      projectRoot: tempDir,
      userDataDir: tempDir,
      isPackaged: false
    });
    writeJson(accountsFilePath, {
      accounts: {
        countsteam01: {
          password: "SecretA",
          remark: "primary"
        },
        countsteam02: {
          password: "SecretB",
          remark: "secondary"
        }
      },
      active: "countsteam01"
    });
    writeJson(path.join(tempDir, "inventory_ui_state.json"), {});
    seedAuthStore({dbPath, accountsFilePath});

    const createServer = loadCreateServer({runMoveDeferred, componentCalls});
    const server = createServer({
      licenseRuntimeFactory: () => runtime,
      licenseConfigFactory: () => ({authMode: "debug_bundle"})
    });
    try {
      const address = await listen(server);
      await run({
        port: address.port,
        runtime,
        componentCalls,
        finishMoves() {
          runMoveDeferred.resolve({
            ok: true,
            rows: [],
            moved: 0
          });
        }
      });
    } finally {
      runMoveDeferred.resolve({
        ok: true,
        rows: [],
        moved: 0
      });
      await closeServer(server);
      delete require.cache[require.resolve("../src/uiServer")];
    }
  } finally {
    configureRuntimePaths({
      projectRoot: originalPaths.ROOT_DIR,
      userDataDir: originalPaths.WRITABLE_ROOT,
      isPackaged: false
    });
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

function fullComponentPermissions() {
  return [
    FEATURE_CODES.ACCOUNTS_READ,
    FEATURE_CODES.ACCOUNTS_WRITE,
    FEATURE_CODES.INVENTORY_READ,
    FEATURE_CODES.INVENTORY_REFRESH,
    FEATURE_CODES.CRAFT_USE,
    FEATURE_CODES.SIMULATION_USE
  ];
}

function readOnlyPermissions() {
  return [
    FEATURE_CODES.ACCOUNTS_READ,
    FEATURE_CODES.INVENTORY_READ
  ];
}

async function expectPermissionDenied(response) {
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.reason, "permission_denied");
}

async function expectAccountScopeDenied(response) {
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.reason, "account_scope_denied");
}

async function test_component_routes_require_inventory_refresh_permission() {
  await withComponentServer({
    username: "member_a",
    permissions: readOnlyPermissions()
  }, async ({port}) => {
    await expectPermissionDenied(await requestJson({
      port,
      method: "POST",
      route: "/api/component/deposit",
      body: {
        username: "countsteam01",
        component_id: "component-1",
        item_ids: ["asset-1"]
      }
    }));
    await expectPermissionDenied(await requestJson({
      port,
      route: "/api/component/deposit-candidates?username=countsteam01&component_id=component-1"
    }));
    await expectPermissionDenied(await requestJson({
      port,
      method: "POST",
      route: "/api/component/withdraw",
      body: {
        username: "countsteam01",
        component_id: "component-1",
        item_ids: ["asset-1"]
      }
    }));
    await expectPermissionDenied(await requestJson({
      port,
      route: "/api/component/tasks?username=countsteam01"
    }));
    await expectPermissionDenied(await requestJson({
      port,
      method: "POST",
      route: "/api/component/tasks/cancel",
      body: {
        job_id: "component_task_missing"
      }
    }));
  });
}

async function test_component_routes_reject_wrong_account_user() {
  await withComponentServer({
    username: "member_a",
    permissions: fullComponentPermissions()
  }, async ({port}) => {
    await expectAccountScopeDenied(await requestJson({
      port,
      method: "POST",
      route: "/api/component/deposit",
      body: {
        username: "countsteam02",
        component_id: "component-1",
        item_ids: ["asset-1"]
      }
    }));
    await expectAccountScopeDenied(await requestJson({
      port,
      route: "/api/component/deposit-candidates?username=countsteam02&component_id=component-1"
    }));
    await expectAccountScopeDenied(await requestJson({
      port,
      method: "POST",
      route: "/api/component/withdraw",
      body: {
        username: "countsteam02",
        component_id: "component-1",
        item_ids: ["asset-1"]
      }
    }));
    await expectAccountScopeDenied(await requestJson({
      port,
      route: "/api/component/tasks?username=countsteam02"
    }));
  });
}

async function test_component_task_cancel_rejects_wrong_account_owner() {
  await withComponentServer({
    username: "member_b",
    permissions: fullComponentPermissions()
  }, async ({port, runtime}) => {
    const queued = await requestJson({
      port,
      method: "POST",
      route: "/api/component/deposit",
      body: {
        username: "countsteam02",
        component_id: "component-2",
        item_ids: ["asset-2"]
      }
    });
    assert.equal(queued.statusCode, 202);
    const jobId = queued.body.job && queued.body.job.job_id;
    assert.equal(typeof jobId, "string");
    assert.notEqual(jobId, "");

    runtime.setUser("member_a", fullComponentPermissions());
    const denied = await requestJson({
      port,
      method: "POST",
      route: "/api/component/tasks/cancel",
      body: {
        job_id: jobId
      }
    });
    await expectAccountScopeDenied(denied);
  });
}

async function main() {
  await test_component_routes_require_inventory_refresh_permission();
  await test_component_routes_reject_wrong_account_user();
  await test_component_task_cancel_rejects_wrong_account_owner();
  console.log("component-permission-scope tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
