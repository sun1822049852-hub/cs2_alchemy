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
  const originalImport = AppAuthStore.prototype.migrateLegacyAccountsOnce;
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
    AppAuthStore.prototype.migrateLegacyAccountsOnce = function trackedImport() {
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
    AppAuthStore.prototype.migrateLegacyAccountsOnce = originalImport;
    cleanup(ctx);
  }
}

function test_account_store_separates_public_projection_from_internal_credentials() {
  const ctx = createFixture();
  try {
    const store = new AccountStore({
      dbPath: ctx.dbPath,
      accountsFilePath: ctx.accountsFilePath,
      viewerUsername: "member_a"
    });
    store.updateSteamGuard("countsteam01", {
      mafile_content: JSON.stringify({shared_secret: "guard-secret"})
    });
    assert.equal(store.setActive("countsteam01"), true);

    const account = store.get("countsteam01");
    const credentials = store.getCredentials("countsteam01");
    const activeCredentials = store.getActiveCredentials();

    assert.equal(Object.hasOwn(account, "password"), false);
    assert.equal(Object.hasOwn(account, "mafile_content"), false);
    assert.equal(account.has_password, true);
    assert.equal(account.has_steam_guard, true);
    assert.equal(credentials.password, "SecretA");
    assert.equal(JSON.parse(credentials.mafile_content).shared_secret, "guard-secret");
    assert.equal(activeCredentials.username, "countsteam01");
    assert.equal(activeCredentials.password, "SecretA");
  } finally {
    cleanup(ctx);
  }
}

function test_guard_only_account_creation_binds_viewer_and_allows_empty_password() {
  const ctx = createFixture();
  try {
    const store = new AccountStore({
      dbPath: ctx.dbPath,
      accountsFilePath: ctx.accountsFilePath,
      viewerUsername: "member_a"
    });
    assert.equal(store.setActive("countsteam01"), true);
    const maFileContent = JSON.stringify({
      account_name: "guard_without_password",
      shared_secret: "guard",
      revocation_code: "R12345",
      Session: null
    });

    assert.equal(store.createGuardOnlyAccount({
      username: "guard_without_password",
      password: "",
      mafile_content: maFileContent,
      steam_id64: "76561198000001001",
      set_active: false
    }), true);

    const publicRow = store.get("guard_without_password");
    const credentials = store.getCredentials("guard_without_password");
    assert.ok(publicRow, "the creating local user must be bound to the new Steam account");
    assert.equal(publicRow.has_password, false);
    assert.equal(publicRow.has_steam_guard, true);
    assert.equal(publicRow.steam_id64, "76561198000001001");
    assert.equal(credentials.password, "");
    assert.equal(store.getActive().username, "countsteam01");

    assert.equal(store.createGuardOnlyAccount({
      username: "guard_with_password",
      password: "VerifiedPassword",
      mafile_content: maFileContent.replace("guard_without_password", "guard_with_password"),
      set_active: true
    }), true);
    assert.equal(store.get("guard_with_password").has_password, true);
    assert.equal(store.getActive().username, "guard_with_password");
  } finally {
    cleanup(ctx);
  }
}

function test_account_store_update_steam_guard_rejects_unscoped_account() {
  const ctx = createFixture();
  try {
    const store = new AccountStore({
      dbPath: ctx.dbPath,
      accountsFilePath: ctx.accountsFilePath,
      viewerUsername: "member_a"
    });

    assert.throws(
      () => store.updateSteamGuard("countsteam02", {
        mafile_content: JSON.stringify({shared_secret: "guard-secret"})
      }),
      /cannot manage this steam account/
    );
  } finally {
    cleanup(ctx);
  }
}

function test_account_store_exposes_scoped_guard_import_and_delete_entries() {
  const ctx = createFixture();
  try {
    const store = new AccountStore({
      dbPath: ctx.dbPath,
      accountsFilePath: ctx.accountsFilePath,
      viewerUsername: "member_a"
    });
    const maFileContent = JSON.stringify({account_name: "guard_only", shared_secret: "guard", revocation_code: "R12345"});
    assert.equal(store.createSteamGuardImport({
      username: "guard_only",
      password: "SecretGuard",
      mafile_content: maFileContent
    }), true);
    assert.equal(store.get("guard_only").has_steam_guard, true);

    const replacement = JSON.stringify({account_name: "guard_only", shared_secret: "next", revocation_code: "R54321"});
    assert.equal(store.overwriteSteamGuardImport("guard_only", {
      password: "SecretNext",
      password_action: "overwrite",
      mafile_content: replacement
    }), true);
    assert.equal(store.getCredentials("guard_only").password, "SecretNext");
    assert.equal(store.clearSteamGuard("guard_only"), true);
    assert.equal(store.get("guard_only").has_steam_guard, false);
    assert.equal(store.attachSteamGuardImport("guard_only", {
      password: "SecretAttached",
      password_action: "overwrite",
      mafile_content: maFileContent
    }), true);
    assert.equal(store.getCredentials("guard_only").password, "SecretAttached");
    assert.equal(store.get("guard_only").has_steam_guard, true);
    assert.equal(store.clearPassword("guard_only"), true);
    assert.equal(store.getCredentials("guard_only").password, "");
    assert.equal(store.get("guard_only").has_steam_guard, true);
    assert.throws(
      () => store.attachSteamGuardImport("guard_only", {
        password: "MustNotOverwrite",
        mafile_content: replacement
      }),
      (err) => err && err.code === "duplicate_existing"
    );

    assert.throws(
      () => store.clearSteamGuard("countsteam02"),
      /cannot manage this steam account/
    );
  } finally {
    cleanup(ctx);
  }
}

function test_deleted_legacy_account_stays_deleted_before_passwordless_guard_recreation() {
  const ctx = createFixture();
  try {
    const store = new AccountStore({
      dbPath: ctx.dbPath,
      accountsFilePath: ctx.accountsFilePath,
      viewerUsername: "member_a"
    });

    assert.equal(store.remove("countsteam01"), true);
    assert.equal(fs.existsSync(ctx.accountsFilePath), false);

    const maFileContent = JSON.stringify({
      account_name: "countsteam01",
      shared_secret: "guard",
      revocation_code: "R12345",
      Session: null
    });
    assert.equal(store.createGuardOnlyAccount({
      username: "countsteam01",
      password: "",
      mafile_content: maFileContent,
      set_active: false
    }), true);

    const recreated = store.get("countsteam01");
    assert.equal(recreated.has_password, false);
    assert.equal(recreated.has_steam_guard, true);
    assert.equal(store.getCredentials("countsteam01").password, "");
  } finally {
    cleanup(ctx);
  }
}

function test_account_store_saves_verified_credentials_without_overwriting_profile_or_active_account() {
  const ctx = createFixture();
  try {
    const store = new AccountStore({
      dbPath: ctx.dbPath,
      accountsFilePath: ctx.accountsFilePath,
      viewerUsername: "member_a"
    });
    assert.equal(store.setActive("countsteam01"), true);
    assert.equal(store.saveVerifiedCredentials("countsteam01", "VerifiedNext"), true);

    const existing = store.getCredentials("countsteam01");
    assert.equal(existing.password, "VerifiedNext");
    assert.equal(existing.remark, "主号A");
    assert.equal(existing.steam_name, "Alpha");
    assert.equal(existing.steam_id, "steamid-alpha");
    assert.equal(existing.avatar_url, "https://example.com/a.png");

    assert.equal(store.saveVerifiedCredentials("new_verified_account", "VerifiedNew"), true);
    const created = store.getCredentials("new_verified_account");
    assert.equal(created.password, "VerifiedNew");
    assert.equal(created.remark, "");
    assert.equal(store.getActive().username, "countsteam01");
  } finally {
    cleanup(ctx);
  }
}

function main() {
  test_account_store_lists_sqlite_accounts_for_viewer_scope();
  test_account_store_reads_do_not_run_write_side_effects();
  test_account_store_separates_public_projection_from_internal_credentials();
  test_account_store_update_steam_guard_rejects_unscoped_account();
  test_account_store_exposes_scoped_guard_import_and_delete_entries();
  test_deleted_legacy_account_stays_deleted_before_passwordless_guard_recreation();
  test_guard_only_account_creation_binds_viewer_and_allows_empty_password();
  test_account_store_saves_verified_credentials_without_overwriting_profile_or_active_account();
  console.log("account-store-sqlite tests passed");
}

main();
