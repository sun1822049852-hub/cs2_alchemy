const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const path = require("node:path");

async function withProxyEnv(envValues, fn) {
  const keys = ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy"];
  const original = {};
  for (const key of keys) {
    original[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(envValues || {})) {
    process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  }
}

function loadAuthServiceWithStubs(sessionInstances) {
  const authServicePath = path.resolve(__dirname, "../src/authService.js");
  const networkPrecheckPath = path.resolve(__dirname, "../src/networkPrecheck.js");
  const steamSessionPath = require.resolve("steam-session", {
    paths: [path.resolve(__dirname, "..")]
  });

  const originalAuthService = require.cache[authServicePath];
  const originalNetworkPrecheck = require.cache[networkPrecheckPath];
  const originalSteamSession = require.cache[steamSessionPath];
  delete require.cache[authServicePath];

  require.cache[networkPrecheckPath] = {
    id: networkPrecheckPath,
    filename: networkPrecheckPath,
    loaded: true,
    exports: {
      ensureAuthApiReachable: async () => ({ok: true})
    }
  };

  require.cache[steamSessionPath] = {
    id: steamSessionPath,
    filename: steamSessionPath,
    loaded: true,
    exports: {
      EAuthTokenPlatformType: {
        SteamClient: "steam-client"
      },
      EAuthSessionGuardType: {
        Unknown: 0,
        None: 1,
        EmailCode: 2,
        DeviceCode: 3,
        DeviceConfirmation: 4,
        EmailConfirmation: 5,
        MachineToken: 6,
        LegacyMachineAuth: 7
      },
      LoginSession: class FakeLoginSession extends EventEmitter {
        constructor(platformType, options) {
          super();
          this.platformType = platformType;
          this.options = options || {};
          this.refreshToken = "refresh_token_from_fake_session";
          sessionInstances.push(this);
        }

        async startWithCredentials() {
          process.nextTick(() => {
            this.emit("authenticated");
          });
          return {
            actionRequired: false,
            validActions: []
          };
        }

        cancelLoginAttempt() {}
      }
    }
  };

  return {
    module: require(authServicePath),
    restore() {
      delete require.cache[authServicePath];
      if (originalAuthService) {
        require.cache[authServicePath] = originalAuthService;
      }
      if (originalNetworkPrecheck) {
        require.cache[networkPrecheckPath] = originalNetworkPrecheck;
      } else {
        delete require.cache[networkPrecheckPath];
      }
      if (originalSteamSession) {
        require.cache[steamSessionPath] = originalSteamSession;
      } else {
        delete require.cache[steamSessionPath];
      }
    }
  };
}

async function test_login_and_start_session_pass_proxy_options_to_login_session() {
  const sessionInstances = [];
  const stub = loadAuthServiceWithStubs(sessionInstances);

  try {
    await withProxyEnv({HTTPS_PROXY: "http://127.0.0.1:8888"}, async () => {
      await stub.module.loginAndSaveToken({
        username: "account_a",
        password: "password_a",
        twoFactorCode: "12345",
        tokenStore: {set() {}},
        timeoutMs: 5000
      });
      const startResult = await stub.module.startLoginSession({
        username: "account_b",
        password: "password_b",
        tokenStore: {set() {}},
        timeoutMs: 5000
      });

      assert.equal(startResult.ok, true);
      assert.equal(startResult.done, true);
      assert.equal(sessionInstances.length, 2);
      assert.deepEqual(sessionInstances[0].options, {
        httpProxy: "http://127.0.0.1:8888"
      });
      assert.deepEqual(sessionInstances[1].options, {
        httpProxy: "http://127.0.0.1:8888"
      });
    });
  } finally {
    stub.restore();
  }
}

async function main() {
  await test_login_and_start_session_pass_proxy_options_to_login_session();
  console.log("auth-service-proxy tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
