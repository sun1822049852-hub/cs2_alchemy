const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const {stableJsonStringify, FEATURE_CODES} = require("../../shared/licensePolicy");
const {createServer} = require("../src/uiServer");
const {resolveDeviceId} = require("../src/deviceIdentity");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cs2-auth-lifecycle-"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function createSignedBundle(privateKey, deviceId, {
  jti,
  expMsFromNow,
  username = "member_remote",
  membershipPlan = "free",
  permissions = [
    FEATURE_CODES.ACCOUNTS_READ,
    FEATURE_CODES.ACCOUNTS_WRITE,
    FEATURE_CODES.INVENTORY_READ,
    FEATURE_CODES.INVENTORY_REFRESH,
    FEATURE_CODES.SIMULATION_USE
  ]
} = {}) {
  const issuedAt = new Date();
  const expiresAt = new Date(Date.now() + Math.max(1, Number(expMsFromNow) || 1));
  const snapshot = {
    sub: "user_1",
    username,
    device_id: deviceId,
    membership_plan: membershipPlan,
    permissions,
    feature_flags: {
      simulation_enabled: permissions.includes(FEATURE_CODES.SIMULATION_USE)
    },
    policy_version: 1,
    jti: String(jti || "snap_default"),
    iat: issuedAt.toISOString(),
    exp: expiresAt.toISOString()
  };
  return {
    snapshot,
    signature: crypto.sign(null, Buffer.from(stableJsonStringify(snapshot)), privateKey).toString("base64")
  };
}

async function startServer({
  refreshIntervalMs = 60,
  authClientFactory
} = {}) {
  const tempDir = makeTempDir();
  const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
  const publicKeyFile = path.join(tempDir, "client_license_public.pem");
  const machineIdFile = path.join(tempDir, "machine_id.bin");
  const licenseStateFile = path.join(tempDir, "client_license_state.json");
  const clientConfigFile = path.join(tempDir, "client_config.json");
  fs.writeFileSync(publicKeyFile, publicKey.export({format: "pem", type: "spki"}), "utf8");
  fs.writeFileSync(machineIdFile, Buffer.from("test-machine", "utf8"));
  writeJson(licenseStateFile, {});
  writeJson(clientConfigFile, {});

  const deviceId = resolveDeviceId(machineIdFile);
  const authClient = typeof authClientFactory === "function"
    ? authClientFactory({privateKey, deviceId})
    : null;
  const server = createServer({
    licenseConfigFactory: () => ({
      authMode: "prod_login",
      configFile: clientConfigFile,
      controlPlaneBaseUrl: "https://auth.example.com",
      publicKeyFile,
      machineIdFile,
      licenseStateFile,
      refreshIntervalMs
    }),
    controlPlaneAuthClientFactory: () => authClient
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    tempDir,
    privateKey,
    publicKeyFile,
    machineIdFile,
    licenseStateFile,
    deviceId,
    authClient,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function stopServer(ctx) {
  await new Promise((resolve) => ctx.server.close(resolve));
  fs.rmSync(ctx.tempDir, {recursive: true, force: true});
}

async function requestJson(ctx, method, route, {body = null} = {}) {
  const payload = body == null ? "" : JSON.stringify(body);
  const url = new URL(route, ctx.baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode || 0,
            body: raw ? JSON.parse(raw) : {}
          });
        });
      }
    );
    req.on("error", (err) => {
      err.message = `${method} ${route}: ${err.message}`;
      reject(err);
    });
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function readSavedBundle(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, {timeoutMs = 1500, intervalMs = 50} = {}) {
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || 1);
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await sleep(intervalMs);
  }
  return !!(await predicate());
}

async function test_client_refreshes_bundle_before_expiry_using_saved_refresh_credential() {
  const refreshCalls = [];
  const ctx = await startServer({
    refreshIntervalMs: 60,
    authClientFactory: ({privateKey, deviceId}) => ({
      getCapabilities() {
        return {
          configured: true,
          baseUrl: "https://auth.example.com"
        };
      },
      async login() {
        return {
          user: {
            id: "user_1",
            username: "member_remote"
          },
          bundle: createSignedBundle(privateKey, deviceId, {
            jti: "snap_1",
            // The scheduler floors intervals to 1000ms, so this enters the 60ms refresh window on the first tick.
            expMsFromNow: 1000
          }),
          refreshCredential: "refresh_token_1"
        };
      },
      async refresh({refreshCredential, deviceId: refreshDeviceId}) {
        refreshCalls.push({
          refreshCredential,
          deviceId: refreshDeviceId
        });
        return {
          bundle: createSignedBundle(privateKey, deviceId, {
            jti: "snap_2",
            expMsFromNow: 5 * 60 * 1000
          }),
          refreshCredential: "refresh_token_2"
        };
      },
      async logout() {
        return {ok: true};
      }
    })
  });

  try {
    const login = await requestJson(ctx, "POST", "/api/client-auth/login", {
      body: {
        username: "member_remote",
        password: "secret"
      }
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.authenticated, true);

    const refreshed = await waitFor(() => refreshCalls.length > 0, {
      timeoutMs: 1500,
      intervalMs: 50
    });

    const state = await requestJson(ctx, "GET", "/api/license/state");
    assert.equal(state.status, 200);
    assert.equal(state.body.authenticated, true);

    const saved = readSavedBundle(ctx.licenseStateFile);
    assert.equal(refreshed, true);
    assert.deepEqual(refreshCalls, [{
      refreshCredential: "refresh_token_1",
      deviceId: ctx.deviceId
    }]);
    assert.equal(saved.refresh_credential, "refresh_token_2");
    assert.equal(saved.snapshot.jti, "snap_2");
  } finally {
    await stopServer(ctx);
  }
}

async function test_client_logout_sends_saved_refresh_credential_to_remote_service() {
  const logoutCalls = [];
  const ctx = await startServer({
    authClientFactory: ({privateKey, deviceId}) => ({
      getCapabilities() {
        return {
          configured: true,
          baseUrl: "https://auth.example.com"
        };
      },
      async login() {
        return {
          user: {
            id: "user_1",
            username: "member_remote"
          },
          bundle: createSignedBundle(privateKey, deviceId, {
            jti: "snap_logout",
            expMsFromNow: 5 * 60 * 1000
          }),
          refreshCredential: "refresh_token_logout"
        };
      },
      async refresh() {
        throw new Error("refresh should not be called");
      },
      async logout({refreshCredential}) {
        logoutCalls.push({refreshCredential});
        return {ok: true};
      }
    })
  });

  try {
    const login = await requestJson(ctx, "POST", "/api/client-auth/login", {
      body: {
        username: "member_remote",
        password: "secret"
      }
    });
    assert.equal(login.status, 200);

    const logout = await requestJson(ctx, "POST", "/api/client-auth/logout");
    assert.equal(logout.status, 200);
    assert.equal(logout.body.authenticated, false);
    assert.deepEqual(logoutCalls, [{
      refreshCredential: "refresh_token_logout"
    }]);
  } finally {
    await stopServer(ctx);
  }
}

async function main() {
  await test_client_refreshes_bundle_before_expiry_using_saved_refresh_credential();
  await test_client_logout_sends_saved_refresh_credential_to_remote_service();
  console.log("client-auth-session-lifecycle tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
