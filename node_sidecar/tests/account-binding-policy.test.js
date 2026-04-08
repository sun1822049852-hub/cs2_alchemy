const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const {FEATURE_CODES} = require("../../shared/licensePolicy");
const {resolveDeviceId} = require("../src/deviceIdentity");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cs2-account-binding-"));
}

function createLicenseRuntime({
  membershipPlan = "trial",
  refreshCredential = "remote_refresh_token"
} = {}) {
  const permissions = [
    FEATURE_CODES.ACCOUNTS_READ,
    FEATURE_CODES.ACCOUNTS_WRITE,
    FEATURE_CODES.CRAFT_USE,
    FEATURE_CODES.INVENTORY_READ,
    FEATURE_CODES.INVENTORY_REFRESH,
    FEATURE_CODES.SIMULATION_USE
  ];
  return {
    getState() {
      return {
        ok: true,
        code: "ready",
        user: {
          id: "user_1",
          username: "member_remote",
          membership_plan: membershipPlan
        },
        permissions,
        featureFlags: {
          simulation_enabled: true,
          craft_enabled: permissions.includes(FEATURE_CODES.CRAFT_USE),
          steam_binding_mode: membershipPlan === "member" ? "unlimited" : "single_locked",
          steam_binding_limit: membershipPlan === "member" ? -1 : 1,
          trial_active: membershipPlan === "trial",
          trial_expires_at: membershipPlan === "trial" ? "2026-04-15T00:00:00.000Z" : ""
        },
        expiresAt: "2099-01-01T00:15:00.000Z",
        expiresInMs: 86400000
      };
    },
    readBundle() {
      return {
        refresh_credential: refreshCredential
      };
    },
    stop() {},
    importBundle() {
      return this.getState();
    },
    clear() {
      return {
        ok: false,
        code: "license_missing",
        user: null,
        permissions: [],
        featureFlags: {},
        expiresAt: "",
        expiresInMs: 0
      };
    }
  };
}

function loadCreateServer({
  loginResponse = {username: "steam_account_a", refresh_token: "steam_refresh_token"},
  profile = {
    steamId64: "76561198000000001",
    steamId3: "[U:1:39734273]",
    personaName: "Alpha",
    avatarUrl: "https://example.com/a.png"
  }
} = {}) {
  const state = {
    accounts: new Map(),
    activeUsername: "",
    upsertCalls: [],
    removeCalls: [],
    lastSelected: ""
  };
  const uiServerPath = require.resolve("../src/uiServer");
  const uiServerSourcePath = path.join(__dirname, "..", "src", "uiServer.js");
  const originalLoad = Module._load;
  delete require.cache[uiServerPath];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (parent && parent.filename === uiServerSourcePath && request === "./authService") {
      return {
        async loginAndSaveToken(args = {}) {
          return {
            username: String(args.username || loginResponse.username || "").trim(),
            refresh_token: String(loginResponse.refresh_token || "").trim()
          };
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./accountStore") {
      return {
        AccountStore: class FakeAccountStore {
          list() {
            return Array.from(state.accounts.values()).map((item) => ({
              ...item,
              is_active: item.username === state.activeUsername
            }));
          }
          get(username) {
            const key = String(username || "").trim();
            const item = state.accounts.get(key);
            return item ? {...item, is_active: key === state.activeUsername} : null;
          }
          getActive() {
            return state.activeUsername ? this.get(state.activeUsername) : null;
          }
          setActive(username) {
            const key = String(username || "").trim();
            if (!state.accounts.has(key)) {
              return false;
            }
            state.activeUsername = key;
            return true;
          }
          upsert({username, password, remark = "", steamName = "", steamId = "", avatarUrl = ""} = {}) {
            const key = String(username || "").trim();
            const next = {
              username: key,
              password: String(password || ""),
              remark: String(remark || ""),
              steam_name: String(steamName || ""),
              steam_id: String(steamId || ""),
              avatar_url: String(avatarUrl || "")
            };
            state.accounts.set(key, next);
            if (!state.activeUsername) {
              state.activeUsername = key;
            }
            state.upsertCalls.push({
              username: key,
              steamName: next.steam_name,
              steamId: next.steam_id,
              avatarUrl: next.avatar_url
            });
            return true;
          }
          updateRemark(username, remark) {
            const current = this.get(username);
            if (!current) {
              return false;
            }
            state.accounts.set(current.username, {
              ...current,
              remark: String(remark || "")
            });
            return true;
          }
          remove(username) {
            const key = String(username || "").trim();
            state.removeCalls.push(key);
            const removed = state.accounts.delete(key);
            if (state.activeUsername === key) {
              state.activeUsername = Array.from(state.accounts.keys())[0] || "";
            }
            return removed;
          }
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./tokenStore") {
      return {
        TokenStore: class FakeTokenStore {
          constructor() {
            this.tokens = new Map();
          }
          get(username) {
            return this.tokens.get(String(username || "").trim()) || "";
          }
          set(username, refreshToken) {
            this.tokens.set(String(username || "").trim(), String(refreshToken || "").trim());
          }
          remove(username) {
            this.tokens.delete(String(username || "").trim());
          }
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./uiStateStore") {
      return {
        UiStateStore: class FakeUiStateStore {
          setLastSelected(username) {
            state.lastSelected = String(username || "").trim();
          }
          getLastSelected() {
            return state.lastSelected;
          }
          removeAccount(username) {
            if (state.lastSelected === String(username || "").trim()) {
              state.lastSelected = "";
            }
          }
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./services/sessionPool") {
      return {
        createSessionPool() {
          return {
            async acquire() {
              const steamId64 = String(profile.steamId64 || "").trim();
              return {
                reused: false,
                steam: {
                  steamID: {
                    getSteamID64() {
                      return steamId64;
                    },
                    getSteam3RenderedID() {
                      return String(profile.steamId3 || "").trim();
                    }
                  },
                  async getPersonas() {
                    return {
                      personas: {
                        [steamId64]: {
                          player_name: String(profile.personaName || "").trim(),
                          avatar_url_full: String(profile.avatarUrl || "").trim()
                        }
                      }
                    };
                  },
                  users: {},
                  accountInfo: {
                    name: String(profile.personaName || "").trim()
                  }
                },
                csgo: {
                  accountData: {}
                }
              };
            },
            shutdown() {
              return true;
            }
          };
        }
      };
    }
    if (parent && parent.filename === uiServerSourcePath && request === "./services/refreshRuntime") {
      return {
        createRefreshRuntime() {
          return {
            start() {},
            handleSseRequest() {},
            emitSse() {},
            async runRefreshJob() {
              throw new Error("runRefreshJob not implemented in test");
            },
            isConnected() {
              return false;
            },
            removeAccount() {}
          };
        }
      };
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    return {
      createServer: require(uiServerPath).createServer,
      state
    };
  } finally {
    Module._load = originalLoad;
  }
}

async function startServer({
  authClient,
  membershipPlan = "trial",
  refreshCredential = "remote_refresh_token",
  loginResponse,
  profile
} = {}) {
  const tempDir = makeTempDir();
  const machineIdFile = path.join(tempDir, "machine_id.bin");
  fs.writeFileSync(machineIdFile, Buffer.from("binding-device", "utf8"));
  const {createServer, state} = loadCreateServer({
    loginResponse,
    profile
  });
  const runtime = createLicenseRuntime({membershipPlan, refreshCredential});
  const server = createServer({
    licenseRuntimeFactory: () => runtime,
    controlPlaneAuthClientFactory: () => authClient,
    licenseConfigFactory: () => ({
      authMode: "prod_login",
      controlPlaneBaseUrl: "https://auth.example.com",
      machineIdFile
    })
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    tempDir,
    machineIdFile,
    deviceId: resolveDeviceId(machineIdFile),
    state,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function stopServer(ctx) {
  await new Promise((resolve) => ctx.server.close(resolve));
  fs.rmSync(ctx.tempDir, {recursive: true, force: true});
  delete require.cache[require.resolve("../src/uiServer")];
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
            statusCode: res.statusCode || 0,
            body: raw ? JSON.parse(raw) : {}
          });
        });
      }
    );
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function test_login_save_rejects_second_trial_binding_without_writing_local_account() {
  const checkCalls = [];
  const error = new Error("当前账号允许绑定的 Steam 数量已达上限");
  error.code = "steam_binding_limit_reached";
  error.status = 409;
  const ctx = await startServer({
    authClient: {
      getCapabilities() {
        return {configured: true, baseUrl: "https://auth.example.com"};
      },
      async checkOrBindSteamAccount(args = {}) {
        checkCalls.push({...args});
        throw error;
      }
    },
    loginResponse: {
      username: "steam_account_b",
      refresh_token: "steam_refresh_token_b"
    },
    profile: {
      steamId64: "76561198000000002",
      steamId3: "[U:1:39734274]",
      personaName: "Bravo",
      avatarUrl: "https://example.com/b.png"
    }
  });

  try {
    const response = await requestJson(ctx, "POST", "/api/accounts/login-save", {
      body: {
        username: "steam_account_b",
        password: "pw",
        totp: "123456"
      }
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.reason, "steam_binding_limit_reached");
    assert.equal(ctx.state.accounts.has("steam_account_b"), false);
    assert.equal(ctx.state.upsertCalls.length, 0);
    assert.equal(checkCalls.length, 1);
  } finally {
    await stopServer(ctx);
  }
}

async function test_login_save_reuses_license_refresh_credential_for_binding_check() {
  const checkCalls = [];
  const ctx = await startServer({
    refreshCredential: "remote_refresh_token",
    authClient: {
      getCapabilities() {
        return {configured: true, baseUrl: "https://auth.example.com"};
      },
      async checkOrBindSteamAccount(args = {}) {
        checkCalls.push({...args});
        return {
          ok: true,
          bindingMode: "single_locked",
          bindingLimit: 1,
          boundCount: 1,
          matchedExisting: false,
          message: "Steam 绑定资格已确认"
        };
      }
    }
  });

  try {
    const response = await requestJson(ctx, "POST", "/api/accounts/login-save", {
      body: {
        username: "steam_account_a",
        password: "pw",
        totp: "123456"
      }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(checkCalls.length, 1);
    assert.equal(checkCalls[0].refreshCredential, "remote_refresh_token");
    assert.equal(checkCalls[0].deviceId, ctx.deviceId);
    assert.equal(checkCalls[0].steamId, "76561198000000001");
    assert.equal(checkCalls[0].steamAccountName, "steam_account_a");
    assert.equal(ctx.state.accounts.has("steam_account_a"), true);
  } finally {
    await stopServer(ctx);
  }
}

async function main() {
  await test_login_save_rejects_second_trial_binding_without_writing_local_account();
  await test_login_save_reuses_license_refresh_credential_for_binding_check();
  console.log("account-binding-policy tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
