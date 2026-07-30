const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");

async function test_default_session_connect_timeout_is_ten_seconds() {
  const sessionPath = require.resolve("../src/cs2Session");
  const utilsPath = require.resolve("../src/utils");
  const precheckPath = require.resolve("../src/networkPrecheck");
  const steamUserPath = require.resolve("steam-user");
  const globalOffensivePath = require.resolve("globaloffensive");
  const paths = [sessionPath, utilsPath, precheckPath, steamUserPath, globalOffensivePath];
  const originals = new Map(paths.map((filePath) => [filePath, require.cache[filePath]]));
  const originalUtils = require(utilsPath);
  let capturedTimeoutMs = 0;

  class FakeSteamUser extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
    }

    logOn(details) {
      this.logOnDetails = details;
    }

    sendToGC() {}
    logOff() {}
  }
  FakeSteamUser.EPersonaState = {Online: 1};

  class FakeGlobalOffensive extends EventEmitter {
    constructor(steam) {
      super();
      this.steam = steam;
      this.inventory = [];
    }
  }

  try {
    delete require.cache[sessionPath];
    require.cache[utilsPath] = {
      id: utilsPath,
      filename: utilsPath,
      loaded: true,
      exports: {
        ...originalUtils,
        withTimeout(_promise, timeoutMs) {
          capturedTimeoutMs = timeoutMs;
          return Promise.resolve();
        }
      }
    };
    require.cache[precheckPath] = {
      id: precheckPath,
      filename: precheckPath,
      loaded: true,
      exports: {
        probeCmReachability: async () => ({reachable: 1, total: 1, fastest: "fixture"})
      }
    };
    require.cache[steamUserPath] = {
      id: steamUserPath,
      filename: steamUserPath,
      loaded: true,
      exports: FakeSteamUser
    };
    require.cache[globalOffensivePath] = {
      id: globalOffensivePath,
      filename: globalOffensivePath,
      loaded: true,
      exports: FakeGlobalOffensive
    };

    const {CS2Session} = require("../src/cs2Session");
    const session = new CS2Session({
      licenseVerificationStore: {
        isSteamAppLicenseVerified: () => true,
        markSteamAppLicenseVerified: () => true
      }
    });
    await session.connect({
      username: "demo",
      refreshToken: "TOKEN",
      refreshTokenOnly: true
    });

    assert.equal(capturedTimeoutMs, 10000);
  } finally {
    delete require.cache[sessionPath];
    for (const filePath of paths.slice(1)) {
      const original = originals.get(filePath);
      if (original) require.cache[filePath] = original;
      else delete require.cache[filePath];
    }
  }
}

test_default_session_connect_timeout_is_ten_seconds()
  .then(() => console.log("cs2-session-default-timeout tests passed"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
