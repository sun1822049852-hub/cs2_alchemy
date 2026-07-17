const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

const {refreshInventory} = require("../src/refreshWorkflow");

async function test_recovery_capable_pool_handles_missing_token_before_inventory_work() {
  const calls = [];
  const sessionPool = {
    hasTokenRecovery() {
      return true;
    },
    async acquire(args) {
      calls.push({type: "acquire", args});
      return {reused: false, csgo: {inventory: []}};
    },
    touch(username) {
      calls.push({type: "touch", username});
    },
    invalidate() {}
  };
  const result = await refreshInventory({
    username: "demo",
    accountStore: {
      getCredentials() {
        return {username: "demo", password: "secret"};
      }
    },
    tokenStore: {get: () => ""},
    schemaStore: {load: () => ({})},
    sessionPool,
    preloadComponentContentsFn: async () => ({
      waiting: 0,
      loaded_items: [],
      expected_total: 0,
      notified: 0
    }),
    parseInventoryFn: () => ({rows: [], hiddenRows: []}),
    saveProcessedSnapshotFn: () => path.join(os.tmpdir(), "recovered-refresh.json")
  });

  assert.equal(result.account, "demo");
  const acquired = calls.find((entry) => entry.type === "acquire");
  assert.equal(acquired.args.refreshToken, "");
  assert.equal(acquired.args.refreshTokenOnly, true);
}

async function main() {
  await test_recovery_capable_pool_handles_missing_token_before_inventory_work();
  console.log("refresh-workflow-token-recovery tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
