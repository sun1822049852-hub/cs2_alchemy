const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const {PATHS} = require("../src/constants");

function createReadyLicenseRuntime() {
  const state = {
    ok: true,
    code: "ready",
    user: {
      id: "user_test",
      username: "member_test",
      membership_plan: "pro"
    },
    permissions: ["accounts.read", "accounts.write"],
    featureFlags: {},
    expiresAt: "2099-01-01T00:15:00.000Z",
    expiresInMs: 86400000
  };
  return {
    getState() {
      return state;
    },
    stop() {},
    importBundle() {
      return state;
    },
    clear() {
      return state;
    }
  };
}

function requestJson(ctx, method, route, {body = null} = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? "" : JSON.stringify(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port: ctx.port,
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

function loadUiServerWithEnrollStub(enrollSteamGuard) {
  const uiServerPath = require.resolve("../src/uiServer");
  const uiServerSourcePath = path.join(__dirname, "..", "src", "uiServer.js");
  const originalLoad = Module._load;
  delete require.cache[uiServerPath];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (parent && parent.filename === uiServerSourcePath && request === "./steamGuardEnrollService") {
      return {
        enrollSteamGuard,
        finalizeSteamGuard: async () => ({ok: false, reason: "not_used"})
      };
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    return require(uiServerPath);
  } finally {
    Module._load = originalLoad;
  }
}

async function startServer(createServer) {
  const server = createServer({
    licenseRuntimeFactory: () => createReadyLicenseRuntime()
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.on("error", reject);
  });
  return {
    server,
    port: server.address().port
  };
}

async function stopServer(ctx) {
  await new Promise((resolve) => ctx.server.close(resolve));
}

async function test_enroll_route_reads_refresh_token_without_requiring_token_store_close() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-enroll-route-"));
  const originalPaths = {...PATHS};
  const projectRoot = path.resolve(__dirname, "..", "..");
  Object.assign(PATHS, {
    ...PATHS,
    ROOT_DIR: projectRoot,
    WRITABLE_ROOT: tempDir,
    LOG_DIR: path.join(tempDir, "logs"),
    PROCESSED_DIR: path.join(tempDir, "logs", "processed_inventory"),
    RAW_DIR: path.join(tempDir, "logs", "raw_inventory"),
    COMPONENT_DIR: path.join(tempDir, "logs", "component_contents"),
    MACHINE_ID_FILE: path.join(tempDir, "machine_id.bin"),
    ACCOUNTS_FILE: path.join(tempDir, "accounts.json"),
    TOKENS_FILE: path.join(tempDir, "login_keys.json"),
    CLIENT_CONFIG_FILE: path.join(tempDir, "client_config.json"),
    LICENSE_STATE_FILE: path.join(tempDir, "client_license_state.json"),
    UI_STATE_FILE: path.join(tempDir, "inventory_ui_state.json"),
    SCHEMA_CACHE_FILE: path.join(tempDir, "schema_cache.json"),
    SKIN_DB_FILE: path.join(tempDir, "csgo_skins.db")
  });
  fs.writeFileSync(PATHS.TOKENS_FILE, JSON.stringify({demo: "refresh_demo"}), "utf8");

  const {createServer} = loadUiServerWithEnrollStub(async ({username, refreshToken}) => ({
    ok: true,
    mode: "new_enroll",
    requires_sms: true,
    username,
    hasRefreshToken: refreshToken === "refresh_demo"
  }));

  let ctx = null;
  try {
    ctx = await startServer(createServer);
    const response = await requestJson(ctx, "POST", "/api/accounts/enroll-steam-guard", {
      body: {username: "demo"}
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.mode, "new_enroll");
    assert.equal(response.body.username, "demo");
    assert.equal(response.body.hasRefreshToken, true);
  } finally {
    if (ctx) {
      await stopServer(ctx);
    }
    Object.assign(PATHS, originalPaths);
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

async function main() {
  await test_enroll_route_reads_refresh_token_without_requiring_token_store_close();
  console.log("steam-guard-enroll-route tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
