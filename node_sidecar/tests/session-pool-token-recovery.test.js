const assert = require("node:assert/strict");

const {createSessionPool} = require("../src/services/sessionPool");

async function test_session_pool_connects_through_shared_token_recovery() {
  const calls = [];
  class FakeSession {
    constructor({tokenStore}) {
      this.tokenStore = tokenStore;
      calls.push({type: "construct"});
    }
    async connect(args) {
      calls.push({type: "connect", args});
      return {steam: {on() {}}, csgo: {inventory: []}};
    }
    disconnect() {
      calls.push({type: "disconnect"});
    }
  }
  const tokenRecoveryService = {
    async withTokenRecovery(username, operation) {
      calls.push({type: "recovery", username});
      return operation("recovered-refresh-token");
    }
  };
  const pool = createSessionPool({
    SessionClass: FakeSession,
    tokenRecoveryService,
    cleanupEnabled: false
  });
  try {
    const result = await pool.acquire({
      username: "demo",
      password: "must-not-be-used",
      refreshToken: "expired-token",
      tokenStore: {get() {}, set() {}},
      refreshTokenOnly: true
    });
    assert.equal(result.reused, false);
    assert.equal(pool.hasTokenRecovery(), true);
    assert.equal(calls.filter((entry) => entry.type === "recovery").length, 1);
    const connect = calls.find((entry) => entry.type === "connect");
    assert.equal(connect.args.refreshToken, "recovered-refresh-token");
    assert.equal(connect.args.refreshTokenOnly, true);
  } finally {
    pool.shutdown();
  }
}

async function main() {
  await test_session_pool_connects_through_shared_token_recovery();
  console.log("session-pool-token-recovery tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
