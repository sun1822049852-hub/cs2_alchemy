const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

function createSteamUserClass(factory) {
  return class FakeSteamUser {
    constructor() {
      Object.assign(this, factory());
    }
  };
}

function loadService(overrides = {}) {
  const servicePath = require.resolve("../src/steamGuardEnrollService");
  const serviceSourcePath = path.join(__dirname, "..", "src", "steamGuardEnrollService.js");
  const actualUtils = require("../src/utils");
  const originalLoad = Module._load;
  delete require.cache[servicePath];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (parent && parent.filename === serviceSourcePath && request === "steam-user") {
      return overrides.SteamUserClass || class FakeSteamUser {};
    }
    if (parent && parent.filename === serviceSourcePath && request === "steam-totp") {
      return {
        generateAuthCode() {
          return "ABCDE";
        }
      };
    }
    if (parent && parent.filename === serviceSourcePath && request === "./networkPrecheck") {
      return {
        ensureAuthApiReachable: overrides.ensureAuthApiReachable || (async () => {})
      };
    }
    if (parent && parent.filename === serviceSourcePath && request === "./utils") {
      return {
        ...actualUtils,
        withTimeout: overrides.withTimeout || ((promise) => promise)
      };
    }
    if (parent && parent.filename === serviceSourcePath && request === "./steamWebSession") {
      return {
        refreshAccessToken: overrides.refreshAccessToken || (async () => "access_default")
      };
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    return require(servicePath);
  } finally {
    Module._load = originalLoad;
  }
}

async function test_enroll_status_29_starts_replace_flow_instead_of_terminal_error() {
  const calls = [];
  const SteamUserClass = createSteamUserClass(() => ({
    steamID: {
      getSteamID64() {
        return "76561198000000001";
      }
    },
    once(event, handler) {
      if (event === "loggedOn") this._loggedOn = handler;
      if (event === "error") this._error = handler;
    },
    logOn() {
      setImmediate(() => this._loggedOn());
    },
    enableTwoFactor(callback) {
      calls.push("enableTwoFactor");
      callback(null, {status: 29});
    },
    _sendUnified(method, payload, callback) {
      calls.push({method, payload});
      if (method === "TwoFactor.RemoveAuthenticatorViaChallengeStart#1") {
        callback({success: true});
        return;
      }
      callback({success: false});
    },
    logOff() {
      calls.push("logOff");
    }
  }));

  const {enrollSteamGuard} = loadService({
    SteamUserClass,
    refreshAccessToken: async () => "access_1"
  });

  const result = await enrollSteamGuard({
    username: "demo",
    refreshToken: "refresh_1",
    logger: null,
    timeoutMs: 5000
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "replace_existing");
  assert.equal(result.requires_sms, true);
  assert.deepEqual(
    calls
      .filter((entry) => typeof entry === "string" || entry.method)
      .map((entry) => (typeof entry === "string" ? entry : entry.method))
      .slice(0, 2),
    [
      "enableTwoFactor",
      "TwoFactor.RemoveAuthenticatorViaChallengeStart#1"
    ]
  );
}

async function test_finalize_replace_builds_project_compatible_mafile() {
  const calls = [];
  const replacementToken = {
    shared_secret: Buffer.from("replace_shared"),
    serial_number: "123",
    revocation_code: "R12345",
    uri: "otpauth://totp/Steam:demo?secret=replace",
    server_time: 1777000000,
    account_name: "demo",
    token_gid: "gid_replace",
    identity_secret: Buffer.from("replace_identity"),
    secret_1: Buffer.from("replace_secret_one"),
    status: 1,
    steamguard_scheme: 2,
    steamid: "76561198000000001"
  };
  const SteamUserClass = createSteamUserClass(() => ({
    steamID: {
      getSteamID64() {
        return "76561198000000001";
      }
    },
    once(event, handler) {
      if (event === "loggedOn") this._loggedOn = handler;
      if (event === "error") this._error = handler;
    },
    logOn() {
      setImmediate(() => this._loggedOn());
    },
    enableTwoFactor(callback) {
      calls.push("enableTwoFactor");
      callback(null, {status: 29});
    },
    _sendUnified(method, payload, callback) {
      calls.push({method, payload});
      if (method === "TwoFactor.RemoveAuthenticatorViaChallengeStart#1") {
        callback({success: true});
        return;
      }
      if (method === "TwoFactor.RemoveAuthenticatorViaChallengeContinue#1") {
        callback({
          success: true,
          replacement_token: replacementToken
        });
        return;
      }
      callback({success: false});
    },
    logOff() {}
  }));
  const {enrollSteamGuard, finalizeSteamGuard} = loadService({
    SteamUserClass,
    refreshAccessToken: async () => "access_replace"
  });

  const enrollResult = await enrollSteamGuard({
    username: "demo",
    refreshToken: "refresh_1",
    logger: null,
    timeoutMs: 5000
  });
  assert.equal(enrollResult.ok, true);

  const result = await finalizeSteamGuard({
    username: "demo",
    activationCode: "123456",
    logger: null
  });

  const ma = JSON.parse(result.maFileContent);
  assert.equal(ma.Session.SteamID, "76561198000000001");
  assert.equal(
    ma.Session.SteamLoginSecure,
    "steamLoginSecure=76561198000000001%7C%7Crefresh_1"
  );
  assert.equal(ma.access_token, "access_replace");
  assert.equal(ma.fully_enrolled, true);
  assert.equal(ma.shared_secret, Buffer.from("replace_shared").toString("base64"));
  assert.equal(ma.identity_secret, Buffer.from("replace_identity").toString("base64"));
}

async function test_finalize_new_enroll_uses_same_mafile_contract_as_replace_flow() {
  const enrollResponse = {
    status: 1,
    shared_secret: Buffer.from("new_shared").toString("base64"),
    serial_number: "234",
    revocation_code: "R23456",
    uri: "otpauth://totp/Steam:demo?secret=new",
    server_time: 1777000001,
    account_name: "demo",
    token_gid: "gid_new",
    identity_secret: Buffer.from("new_identity").toString("base64"),
    secret_1: Buffer.from("new_secret_one").toString("base64")
  };
  const SteamUserClass = createSteamUserClass(() => ({
    steamID: {
      getSteamID64() {
        return "76561198000000001";
      }
    },
    once(event, handler) {
      if (event === "loggedOn") this._loggedOn = handler;
      if (event === "error") this._error = handler;
    },
    logOn() {
      setImmediate(() => this._loggedOn());
    },
    enableTwoFactor(callback) {
      callback(null, enrollResponse);
    },
    finalizeTwoFactor(_sharedSecretBuffer, _activationCode, callback) {
      callback(null);
    },
    logOff() {}
  }));
  const {enrollSteamGuard, finalizeSteamGuard} = loadService({
    SteamUserClass,
    refreshAccessToken: async () => "access_new"
  });

  const enrollResult = await enrollSteamGuard({
    username: "demo",
    refreshToken: "refresh_1",
    logger: null,
    timeoutMs: 5000
  });
  assert.equal(enrollResult.ok, true);

  const result = await finalizeSteamGuard({
    username: "demo",
    activationCode: "654321",
    logger: null
  });

  const ma = JSON.parse(result.maFileContent);
  assert.equal(ma.Session.SteamID, "76561198000000001");
  assert.equal(
    ma.Session.SteamLoginSecure,
    "steamLoginSecure=76561198000000001%7C%7Crefresh_1"
  );
  assert.equal(ma.access_token, "access_new");
  assert.equal(ma.fully_enrolled, true);
  assert.equal(ma.shared_secret, enrollResponse.shared_secret);
  assert.equal(ma.identity_secret, enrollResponse.identity_secret);
}

async function main() {
  await test_enroll_status_29_starts_replace_flow_instead_of_terminal_error();
  await test_finalize_replace_builds_project_compatible_mafile();
  await test_finalize_new_enroll_uses_same_mafile_contract_as_replace_flow();
  console.log("steam-guard-enroll-service tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
