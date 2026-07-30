const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

const {refreshInventory} = require("../src/refreshWorkflow");

async function test_recovery_capable_pool_handles_missing_token_before_inventory_work() {
  const calls = [];
  const licenseStatuses = [];
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
        return {username: "demo", password: "secret", mafile_content: JSON.stringify({shared_secret: "guard"})};
      }
    },
    tokenStore: {get: () => ""},
    schemaStore: {load: () => ({})},
    sessionPool,
    onConnectionProgress(payload) {
      licenseStatuses.push(payload);
    },
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
  assert.equal(acquired.args.allowTokenRecovery, true);
  assert.equal(typeof acquired.args.onLicenseStatus, "function");
  acquired.args.onLicenseStatus({stage: "checking"});
  assert.deepEqual(licenseStatuses, [{stage: "checking"}]);
}

async function test_raw_eresult_15_without_mafile_clears_token_and_returns_manual_relogin() {
  const calls = [];
  const diagnostics = [];
  let token = "stale-refresh-token";
  const sessionPool = {
    hasTokenRecovery() {
      return true;
    },
    async acquire() {
      throw new Error("steam error: AccessDenied code=15");
    },
    invalidate(username, reason) {
      calls.push({type: "invalidate", username, reason});
    }
  };

  await assert.rejects(
    () => refreshInventory({
      username: "manual-account",
      accountStore: {
        getCredentials() {
          return {username: "manual-account", password: "secret", mafile_content: ""};
        }
      },
      tokenStore: {
        get() {
          return token;
        },
        remove(username) {
          calls.push({type: "remove_token", username});
          token = "";
        }
      },
      schemaStore: {load: () => ({})},
      sessionPool,
      authDiagnosticWriter(event) {
        diagnostics.push(event);
        const error = new Error("diagnostic disk full");
        error.code = "ENOSPC";
        throw error;
      }
    }),
    (err) => {
      assert.equal(err && err.reason, "login_key_invalid");
      assert.equal(err && err.auth_state, "auth_invalid");
      return true;
    }
  );

  assert.equal(token, "");
  assert.equal(calls.filter((entry) => entry.type === "remove_token").length, 1);
  assert.equal(calls.filter((entry) => entry.type === "invalidate").length, 1);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].stage, "refresh_connect");
  assert.equal(diagnostics[0].reason, "login_key_invalid");
  assert.equal(diagnostics[0].tokenCleared, true);
  assert.equal(diagnostics[0].recoveryMode, "manual_login");
  assert.equal(diagnostics[0].error.message, "steam error: AccessDenied code=15");
}

async function test_access_denied_without_explicit_result_15_does_not_clear_token() {
  let token = "current-refresh-token";
  let removeCalls = 0;
  let diagnosticCalls = 0;
  const sourceError = new Error("AccessDenied from unrelated upstream policy");
  const sessionPool = {
    hasTokenRecovery() {
      return true;
    },
    async acquire() {
      throw sourceError;
    },
    invalidate() {}
  };

  await assert.rejects(
    () => refreshInventory({
      username: "manual-account",
      accountStore: {
        getCredentials() {
          return {username: "manual-account", password: "secret", mafile_content: ""};
        }
      },
      tokenStore: {
        get() {
          return token;
        },
        remove() {
          removeCalls += 1;
          token = "";
        }
      },
      schemaStore: {load: () => ({})},
      sessionPool,
      authDiagnosticWriter() {
        diagnosticCalls += 1;
      }
    }),
    (err) => err === sourceError
  );

  assert.equal(token, "current-refresh-token");
  assert.equal(removeCalls, 0);
  assert.equal(diagnosticCalls, 0);
}

async function test_license_access_denied_does_not_clear_refresh_token() {
  let token = "current-refresh-token";
  let removeCalls = 0;
  const licenseError = new Error("CS2 领取失败：Steam 拒绝了免费许可请求（EResult 15）");
  licenseError.code = "cs2_license_claim_access_denied";
  licenseError.reason = "cs2_license_claim_access_denied";
  licenseError.stage = "steam_app_license";
  licenseError.eresult = 15;
  const sessionPool = {
    hasTokenRecovery() {
      return true;
    },
    async acquire() {
      throw licenseError;
    },
    invalidate() {}
  };

  await assert.rejects(
    () => refreshInventory({
      username: "license-account",
      accountStore: {
        getCredentials() {
          return {username: "license-account", password: "secret", mafile_content: ""};
        }
      },
      tokenStore: {
        get() {
          return token;
        },
        remove() {
          removeCalls += 1;
          token = "";
        }
      },
      schemaStore: {load: () => ({})},
      sessionPool
    }),
    (err) => err === licenseError
  );
  assert.equal(token, "current-refresh-token");
  assert.equal(removeCalls, 0);
}

async function main() {
  await test_recovery_capable_pool_handles_missing_token_before_inventory_work();
  await test_raw_eresult_15_without_mafile_clears_token_and_returns_manual_relogin();
  await test_access_denied_without_explicit_result_15_does_not_clear_token();
  await test_license_access_denied_does_not_clear_refresh_token();
  console.log("refresh-workflow-token-recovery tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
