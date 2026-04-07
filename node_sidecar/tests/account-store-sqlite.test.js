const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {AppAuthStore} = require("../src/appAuthStore");
const {AccountStore} = require("../src/accountStore");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-account-store-"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function createFixture() {
  const tempDir = makeTempDir();
  const dbPath = path.join(tempDir, "auth.db");
  const accountsFilePath = path.join(tempDir, "accounts.json");
  writeJson(accountsFilePath, {
    accounts: {
      countsteam01: {
        password: "SecretA",
        remark: "主号A",
        steam_name: "Alpha",
        steam_id: "steamid-alpha",
        avatar_url: "https://example.com/a.png"
      },
      countsteam02: {
        password: "SecretB",
        remark: "主号B",
        steam_name: "Beta",
        steam_id: "steamid-beta",
        avatar_url: "https://example.com/b.png"
      }
    },
    active: "countsteam01"
  });
  const authStore = new AppAuthStore({dbPath, accountsFilePath});
  authStore.bootstrapAdmin({password: "Admin!234"});
  authStore.createUser({
    username: "member_a",
    password: "Member!234",
    roleCodes: ["member"],
    boundSteamUsernames: ["countsteam01"]
  });
  authStore.close();
  return {tempDir, dbPath, accountsFilePath};
}

function cleanup(ctx) {
  fs.rmSync(ctx.tempDir, {recursive: true, force: true});
}

function test_account_store_lists_sqlite_accounts_for_viewer_scope() {
  const ctx = createFixture();
  try {
    const adminStore = new AccountStore({
      dbPath: ctx.dbPath,
      accountsFilePath: ctx.accountsFilePath,
      viewerUsername: "admin"
    });
    const memberStore = new AccountStore({
      dbPath: ctx.dbPath,
      accountsFilePath: ctx.accountsFilePath,
      viewerUsername: "member_a"
    });
    assert.equal(adminStore.list().length, 2);
    assert.deepEqual(memberStore.list().map((row) => row.username), ["countsteam01"]);
    assert.equal(memberStore.setActive("countsteam01"), true);
    assert.equal(memberStore.getActive().username, "countsteam01");
  } finally {
    cleanup(ctx);
  }
}

function test_account_store_reads_do_not_run_write_side_effects() {
  const ctx = createFixture();
  const originalEnsure = AppAuthStore.prototype.ensureSchema;
  const originalSeed = AppAuthStore.prototype.seedSystemData;
  const originalImport = AppAuthStore.prototype.importLegacyAccountsIfNeeded;
  let ensureCalls = 0;
  let seedCalls = 0;
  let importCalls = 0;
  try {
    AppAuthStore.prototype.ensureSchema = function trackedEnsure() {
      ensureCalls += 1;
    };
    AppAuthStore.prototype.seedSystemData = function trackedSeed() {
      seedCalls += 1;
    };
    AppAuthStore.prototype.importLegacyAccountsIfNeeded = function trackedImport() {
      importCalls += 1;
    };

    const store = new AccountStore({
      dbPath: ctx.dbPath,
      accountsFilePath: ctx.accountsFilePath,
      viewerUsername: ""
    });

    assert.equal(store.list().length, 2);
    assert.equal(store.get("countsteam01").username, "countsteam01");
    assert.equal(store.getActive().username, "countsteam01");
    assert.equal(ensureCalls, 0);
    assert.equal(seedCalls, 0);
    assert.equal(importCalls, 0);
  } finally {
    AppAuthStore.prototype.ensureSchema = originalEnsure;
    AppAuthStore.prototype.seedSystemData = originalSeed;
    AppAuthStore.prototype.importLegacyAccountsIfNeeded = originalImport;
    cleanup(ctx);
  }
}

function main() {
  test_account_store_lists_sqlite_accounts_for_viewer_scope();
  test_account_store_reads_do_not_run_write_side_effects();
  console.log("account-store-sqlite tests passed");
}

main();
