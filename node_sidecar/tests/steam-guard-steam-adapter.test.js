const assert = require("node:assert/strict");
const EventEmitter = require("node:events");

const {createSteamGuardSteamAdapter} = require("../src/steamGuardSteamAdapter");

async function test_add_authenticator_uses_only_unified_add_call() {
  const calls = [];
  class FakeSteamUser extends EventEmitter {
    constructor(options) {
      super();
      calls.push({type: "construct", options});
      this.steamID = {getSteamID64: () => "76561198000000001"};
    }
    logOn(details) {
      calls.push({type: "logOn", details});
      process.nextTick(() => this.emit("loggedOn"));
    }
    _sendUnified(method, payload, callback) {
      calls.push({type: "unified", method, payload});
      callback({
        status: 1,
        shared_secret: Buffer.from("shared"),
        identity_secret: Buffer.from("identity"),
        secret_1: Buffer.from("secret-1"),
        serial_number: "123456",
        revocation_code: "R12345",
        account_name: "demo"
      });
    }
    logOff() {
      calls.push({type: "logOff"});
    }
  }

  const adapter = createSteamGuardSteamAdapter({
    SteamUserClass: FakeSteamUser,
    ensureReachable: async () => ({ok: true}),
    timeoutMs: 1000
  });
  const result = await adapter.addAuthenticator({
    refreshToken: "temporary-refresh",
    accessToken: "temporary-access",
    steamId64: "76561198000000001",
    deviceId: "android:12345678-1234-4123-8123-123456789abc"
  });

  assert.equal(result.status, 1);
  assert.equal(result.shared_secret, Buffer.from("shared").toString("base64"));
  assert.equal(result.identity_secret, Buffer.from("identity").toString("base64"));
  assert.deepEqual(calls.find((entry) => entry.type === "logOn").details, {
    refreshToken: "temporary-refresh"
  });
  const unified = calls.find((entry) => entry.type === "unified");
  assert.equal(unified.method, "TwoFactor.AddAuthenticator#1");
  assert.equal(unified.payload.steamid, "76561198000000001");
  assert.equal(unified.payload.device_identifier, "android:12345678-1234-4123-8123-123456789abc");
  assert.equal(calls.some((entry) => /finalize|remove|replace/i.test(String(entry.method || entry.type))), false);
  assert.equal(calls.filter((entry) => entry.type === "logOff").length, 1);
}

async function main() {
  await test_add_authenticator_uses_only_unified_add_call();
  console.log("steam-guard-steam-adapter tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
