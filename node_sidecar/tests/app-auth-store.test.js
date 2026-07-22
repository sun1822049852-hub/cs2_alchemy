const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {AppAuthStore} = require("../src/appAuthStore");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-auth-store-"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function legacyAccountsFixture() {
  return {
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
  };
}

function createStore() {
  const tempDir = makeTempDir();
  const dbPath = path.join(tempDir, "auth.db");
  const accountsFilePath = path.join(tempDir, "accounts.json");
  writeJson(accountsFilePath, legacyAccountsFixture());
  const store = new AppAuthStore({
    dbPath,
    accountsFilePath
  });
  return {
    tempDir,
    dbPath,
    accountsFilePath,
    store
  };
}

function cleanup({store, tempDir}) {
  try {
    if (store && typeof store.close === "function") {
      store.close();
    }
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

function test_bootstrap_admin_creates_super_admin_and_imports_legacy_accounts() {
  const ctx = createStore();
  try {
    assert.equal(ctx.store.needsBootstrap(), true);
    const imported = ctx.store.listSteamAccountsForUser("", {includeAll: true});
    assert.equal(imported.length, 2);
    assert.equal(imported[0].username, "countsteam01");

    const result = ctx.store.bootstrapAdmin({password: "Admin!234"});
    assert.equal(result.user.username, "admin");
    assert.equal(result.user.is_super_admin, true);

    const auth = ctx.store.authenticateUser({username: "admin", password: "Admin!234"});
    assert.equal(auth.ok, true);
    assert.equal(auth.user.username, "admin");

    const session = ctx.store.createSessionForUser("admin", {
      userAgent: "node-test",
      ipAddress: "127.0.0.1"
    });
    assert.equal(typeof session.token, "string");
    assert.equal(session.token.length > 20, true);

    const resolved = ctx.store.resolveSession(session.token);
    assert.equal(resolved.user.username, "admin");
    assert.equal(resolved.permissions.includes("accounts.read"), true);

    const adminAccounts = ctx.store.listSteamAccountsForUser("admin");
    assert.equal(adminAccounts.length, 2);
  } finally {
    cleanup(ctx);
  }
}

function test_regular_user_only_sees_bound_steam_accounts() {
  const ctx = createStore();
  try {
    ctx.store.bootstrapAdmin({password: "Admin!234"});
    ctx.store.createUser({
      username: "member_a",
      password: "Member!234",
      roleCodes: ["member"],
      boundSteamUsernames: ["countsteam01"]
    });

    const memberAccounts = ctx.store.listSteamAccountsForUser("member_a");
    assert.deepEqual(memberAccounts.map((row) => row.username), ["countsteam01"]);
    assert.equal(ctx.store.canAccessSteamAccount("member_a", "countsteam01"), true);
    assert.equal(ctx.store.canAccessSteamAccount("member_a", "countsteam02"), false);
  } finally {
    cleanup(ctx);
  }
}

function test_legacy_active_account_remains_available_for_unscoped_dev_viewer() {
  const ctx = createStore();
  try {
    const active = ctx.store.getActiveSteamAccount("");
    assert.equal(active && active.username, "countsteam01");
    const rows = ctx.store.listSteamAccountsForUser("", {includeAll: true});
    const activeRow = rows.find((row) => row.username === "countsteam01");
    assert.equal(activeRow && activeRow.is_active, true);
  } finally {
    cleanup(ctx);
  }
}

function test_wallet_balance_source_metadata_is_persisted() {
  const ctx = createStore();
  try {
    ctx.store.updateSteamWalletBalance("countsteam01", {
      balance: "¥ 12.34",
      source: "steam_store",
      currency: "CNY",
      observedAt: "2026-06-06T12:00:00.000Z"
    });

    const row = ctx.store.getSteamAccountForUser("", "countsteam01", {includeAll: true});
    assert.equal(row.balance, "¥ 12.34");
    assert.equal(row.balance_source, "steam_store");
    assert.equal(row.balance_currency, "CNY");
    assert.equal(row.balance_observed_at, "2026-06-06T12:00:00.000Z");
  } finally {
    cleanup(ctx);
  }
}

function test_wallet_balance_latest_successful_source_replaces_current_value() {
  const ctx = createStore();
  try {
    ctx.store.updateSteamWalletBalance("countsteam01", {
      balance: "¥ 12.34",
      source: "steam_store",
      currency: "CNY",
      observedAt: "2026-06-06T12:00:00.000Z"
    });
    ctx.store.updateSteamWalletBalance("countsteam01", {
      balance: "¥ 15.00",
      source: "steam_cm",
      currency: "CNY",
      observedAt: "2026-06-06T12:05:00.000Z"
    });

    const row = ctx.store.getSteamAccountForUser("", "countsteam01", {includeAll: true});
    assert.equal(row.balance, "¥ 15.00");
    assert.equal(row.balance_source, "steam_cm");
    assert.equal(row.balance_currency, "CNY");
    assert.equal(row.balance_observed_at, "2026-06-06T12:05:00.000Z");
  } finally {
    cleanup(ctx);
  }
}

function test_legacy_accounts_migrate_once_and_remove_the_old_file() {
  const ctx = createStore();
  try {
    assert.equal(fs.existsSync(ctx.accountsFilePath), false);
    assert.equal(ctx.store.getViewerActiveSteamUsername(""), "countsteam01");
    assert.deepEqual(
      ctx.store.listSteamAccountsForUser("", {includeAll: true}).map((row) => row.username),
      ["countsteam01", "countsteam02"]
    );
  } finally {
    cleanup(ctx);
  }
}

function test_completed_migration_never_reimports_a_recreated_legacy_file() {
  const ctx = createStore();
  try {
    ctx.store.upsertSteamAccount({
      username: "countsteam01",
      password: "CurrentPassword",
      remark: "current",
      steamName: "Current Name"
    }, {setActive: false});
    writeJson(ctx.accountsFilePath, {
      accounts: {
        countsteam01: {
          password: "StalePassword",
          remark: "stale",
          steam_name: "Stale Name"
        }
      },
      active: "countsteam01"
    });
    ctx.store.close();
    ctx.store = new AppAuthStore({
      dbPath: ctx.dbPath,
      accountsFilePath: ctx.accountsFilePath
    });

    const current = ctx.store.getSteamAccountCredentialsForUser("", "countsteam01");
    assert.equal(current.password, "CurrentPassword");
    assert.equal(current.remark, "current");
    assert.equal(current.steam_name, "Current Name");
    assert.equal(fs.existsSync(ctx.accountsFilePath), false);
  } finally {
    cleanup(ctx);
  }
}

function test_unscoped_active_account_survives_without_accounts_json() {
  const ctx = createStore();
  try {
    if (fs.existsSync(ctx.accountsFilePath)) fs.unlinkSync(ctx.accountsFilePath);
    ctx.store.close();
    ctx.store = new AppAuthStore({
      dbPath: ctx.dbPath,
      accountsFilePath: ctx.accountsFilePath
    });
    assert.equal(ctx.store.getViewerActiveSteamUsername(""), "countsteam01");
    assert.equal(ctx.store.getActiveSteamAccount("").username, "countsteam01");
  } finally {
    cleanup(ctx);
  }
}

function test_corrupt_legacy_accounts_file_blocks_migration_and_is_preserved() {
  const tempDir = makeTempDir();
  const dbPath = path.join(tempDir, "auth.db");
  const accountsFilePath = path.join(tempDir, "accounts.json");
  fs.writeFileSync(accountsFilePath, "{broken-json", "utf8");
  try {
    assert.throws(
      () => new AppAuthStore({dbPath, accountsFilePath}),
      /legacy accounts file is invalid/
    );
    assert.equal(fs.readFileSync(accountsFilePath, "utf8"), "{broken-json");
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

function test_public_steam_account_projection_hides_secrets_and_reports_guard_presence() {
  const ctx = createStore();
  try {
    ctx.store.upsertSteamAccount({
      username: "countsteam01",
      password: "SecretA",
      remark: "主号A",
      steamName: "Alpha",
      steamId: "steamid-alpha",
      avatarUrl: "https://example.com/a.png",
      mafileContent: JSON.stringify({shared_secret: "guard-secret"})
    }, {setActive: false});

    const rows = ctx.store.listSteamAccountsForUser("", {includeAll: true});
    const account = ctx.store.getSteamAccountForUser("", "countsteam01", {includeAll: true});

    assert.equal(Object.hasOwn(rows[0], "password"), false);
    assert.equal(Object.hasOwn(rows[0], "mafile_content"), false);
    assert.equal(Object.hasOwn(account, "password"), false);
    assert.equal(Object.hasOwn(account, "mafile_content"), false);
    assert.equal(account.has_steam_guard, true);
    assert.equal(rows.find((row) => row.username === "countsteam02").has_steam_guard, false);
  } finally {
    cleanup(ctx);
  }
}

function test_internal_steam_account_credentials_remain_available_with_scope_checks() {
  const ctx = createStore();
  try {
    ctx.store.bootstrapAdmin({password: "Admin!234"});
    ctx.store.createUser({
      username: "member_a",
      password: "Member!234",
      roleCodes: ["member"],
      boundSteamUsernames: ["countsteam01"]
    });
    ctx.store.updateSteamGuard("", "countsteam01", {
      mafile_content: JSON.stringify({shared_secret: "guard-secret"})
    });

    const credentials = ctx.store.getSteamAccountCredentialsForUser("member_a", "countsteam01");

    assert.equal(credentials.password, "SecretA");
    assert.equal(JSON.parse(credentials.mafile_content).shared_secret, "guard-secret");
    assert.equal(ctx.store.getSteamAccountCredentialsForUser("member_a", "countsteam02"), null);
  } finally {
    cleanup(ctx);
  }
}

function test_update_steam_guard_only_changes_guard_and_fills_empty_steam_id64() {
  const ctx = createStore();
  try {
    ctx.store.bootstrapAdmin({password: "Admin!234"});
    ctx.store.createUser({
      username: "member_a",
      password: "Member!234",
      roleCodes: ["member"],
      boundSteamUsernames: ["countsteam01"]
    });
    ctx.store.setActiveSteamAccount("member_a", "countsteam01");
    ctx.store.updateSteamWalletBalance("countsteam01", {
      balance: "¥ 12.34",
      source: "steam_store",
      currency: "CNY",
      observedAt: "2026-06-06T12:00:00.000Z"
    });
    const before = ctx.store.db.prepare("SELECT * FROM steam_account WHERE username = ?").get("countsteam01");
    const bindingBefore = ctx.store.db.prepare(`
      SELECT COUNT(*) AS count
      FROM user_steam_binding ub
      JOIN app_user u ON u.id = ub.user_id
      JOIN steam_account sa ON sa.id = ub.steam_account_id
      WHERE u.username = ? AND sa.username = ?
    `).get("member_a", "countsteam01");

    const changed = ctx.store.updateSteamGuard("member_a", "countsteam01", {
      mafile_content: JSON.stringify({shared_secret: "guard-secret"}),
      steam_id64: "76561198000000001"
    });
    const after = ctx.store.db.prepare("SELECT * FROM steam_account WHERE username = ?").get("countsteam01");
    const bindingAfter = ctx.store.db.prepare(`
      SELECT COUNT(*) AS count
      FROM user_steam_binding ub
      JOIN app_user u ON u.id = ub.user_id
      JOIN steam_account sa ON sa.id = ub.steam_account_id
      WHERE u.username = ? AND sa.username = ?
    `).get("member_a", "countsteam01");

    assert.equal(changed, true);
    assert.equal(JSON.parse(after.mafile_content).shared_secret, "guard-secret");
    assert.equal(after.steam_id64, "76561198000000001");
    for (const field of [
      "password", "remark", "steam_name", "steam_id", "avatar_url", "ban_status", "trade_url",
      "balance", "balance_source", "balance_currency", "balance_observed_at"
    ]) {
      assert.equal(after[field], before[field], `${field} must remain unchanged`);
    }
    assert.equal(ctx.store.getViewerActiveSteamUsername("member_a"), "countsteam01");
    assert.equal(bindingAfter.count, bindingBefore.count);

    ctx.store.updateSteamGuard("member_a", "countsteam01", {
      mafile_content: JSON.stringify({shared_secret: "replacement-secret"}),
      steam_id64: "76561198999999999"
    });
    const secondUpdate = ctx.store.db.prepare("SELECT * FROM steam_account WHERE username = ?").get("countsteam01");
    assert.equal(secondUpdate.steam_id64, "76561198000000001");
  } finally {
    cleanup(ctx);
  }
}

function test_update_steam_guard_propagates_database_write_failure() {
  const ctx = createStore();
  try {
    ctx.store.db.exec(`
      CREATE TRIGGER reject_guard_write
      BEFORE UPDATE OF mafile_content ON steam_account
      BEGIN
        SELECT RAISE(ABORT, 'guard write denied');
      END;
    `);

    assert.throws(
      () => ctx.store.updateSteamGuard("", "countsteam01", {
        mafile_content: JSON.stringify({shared_secret: "guard-secret"})
      }),
      /guard write denied/
    );
  } finally {
    cleanup(ctx);
  }
}

function test_guard_import_create_and_overwrite_have_narrow_persistence_boundaries() {
  const ctx = createStore();
  try {
    ctx.store.bootstrapAdmin({password: "Admin!234"});
    ctx.store.createUser({
      username: "member_a",
      password: "Member!234",
      roleCodes: ["member"],
      boundSteamUsernames: ["countsteam01"]
    });
    ctx.store.setActiveSteamAccount("member_a", "countsteam01");

    assert.equal(ctx.store.createSteamGuardImport("member_a", {
      username: "guard_only",
      password: "FirstPassword",
      mafile_content: JSON.stringify({account_name: "guard_only", shared_secret: "first", revocation_code: "R12345"})
    }), true);
    assert.equal(ctx.store.canAccessSteamAccount("member_a", "guard_only"), true);
    assert.equal(ctx.store.getViewerActiveSteamUsername("member_a"), "countsteam01");
    const created = ctx.store.db.prepare("SELECT * FROM steam_account WHERE username = ?").get("guard_only");
    assert.equal(created.password, "FirstPassword");
    assert.equal(created.remark, "");
    assert.equal(created.steam_name, "");
    assert.equal(created.avatar_url, "");

    ctx.store.updateSteamWalletBalance("countsteam01", {
      balance: "¥ 12.34",
      source: "steam_store",
      currency: "CNY",
      observedAt: "2026-06-06T12:00:00.000Z"
    });
    const before = ctx.store.db.prepare("SELECT * FROM steam_account WHERE username = ?").get("countsteam01");
    const attachedMaFile = JSON.stringify({account_name: "countsteam01", shared_secret: "attached", revocation_code: "R11111"});
    assert.equal(ctx.store.attachSteamGuardImport("member_a", "countsteam01", {
      password: "AttachedPassword",
      mafile_content: attachedMaFile
    }), true);
    const attached = ctx.store.db.prepare("SELECT * FROM steam_account WHERE username = ?").get("countsteam01");
    assert.equal(attached.password, before.password);
    assert.equal(attached.mafile_content, attachedMaFile);
    for (const field of [
      "remark", "steam_name", "steam_id", "steam_id64", "avatar_url", "ban_status", "trade_url",
      "balance", "balance_source", "balance_currency", "balance_observed_at", "created_at"
    ]) {
      assert.equal(attached[field], before[field], `${field} must remain unchanged on attach`);
    }
    assert.throws(
      () => ctx.store.attachSteamGuardImport("member_a", "countsteam01", {
        password: "MustNotReplace",
        mafile_content: JSON.stringify({account_name: "countsteam01", shared_secret: "other", revocation_code: "R22222"})
      }),
      (err) => err && err.code === "duplicate_existing"
    );

    const replacement = JSON.stringify({account_name: "countsteam01", shared_secret: "next", revocation_code: "R54321"});
    assert.equal(ctx.store.overwriteSteamGuardImport("member_a", "countsteam01", {
      password: "ReplacementPassword",
      password_action: "overwrite",
      mafile_content: replacement
    }), true);
    const after = ctx.store.db.prepare("SELECT * FROM steam_account WHERE username = ?").get("countsteam01");
    assert.equal(after.password, "ReplacementPassword");
    assert.equal(after.mafile_content, replacement);
    for (const field of [
      "remark", "steam_name", "steam_id", "steam_id64", "avatar_url", "ban_status", "trade_url",
      "balance", "balance_source", "balance_currency", "balance_observed_at", "created_at"
    ]) {
      assert.equal(after[field], before[field], `${field} must remain unchanged`);
    }
    assert.equal(ctx.store.getViewerActiveSteamUsername("member_a"), "countsteam01");

    assert.throws(
      () => ctx.store.createSteamGuardImport("member_a", {
        username: "countsteam01",
        password: "NoOverwrite",
        mafile_content: replacement
      }),
      (err) => err && err.code === "duplicate_existing"
    );
  } finally {
    cleanup(ctx);
  }
}

function test_guard_import_create_rolls_back_when_viewer_binding_disappears_inside_transaction() {
  const ctx = createStore();
  try {
    ctx.store.bootstrapAdmin({password: "Admin!234"});
    ctx.store.createUser({
      username: "member_a",
      password: "Member!234",
      roleCodes: ["member"]
    });
    ctx.store.db.exec(`
      CREATE TRIGGER remove_guard_import_viewer
      AFTER INSERT ON steam_account
      WHEN NEW.username = 'orphan_guard'
      BEGIN
        DELETE FROM app_user WHERE username = 'member_a';
      END;
    `);

    assert.throws(
      () => ctx.store.createSteamGuardImport("member_a", {
        username: "orphan_guard",
        password: "MustRollback",
        mafile_content: JSON.stringify({account_name: "orphan_guard", shared_secret: "guard", revocation_code: "R12345"})
      }),
      /viewer binding failed/
    );
    assert.equal(ctx.store.db.prepare("SELECT 1 FROM steam_account WHERE username = ?").get("orphan_guard"), undefined);
    assert.ok(ctx.store.getUserByUsername("member_a"), "viewer deletion must roll back with the import");
  } finally {
    cleanup(ctx);
  }
}

function test_clear_steam_guard_only_clears_local_mafile() {
  const ctx = createStore();
  try {
    ctx.store.bootstrapAdmin({password: "Admin!234"});
    ctx.store.createUser({
      username: "member_a",
      password: "Member!234",
      roleCodes: ["member"],
      boundSteamUsernames: ["countsteam01"]
    });
    ctx.store.setActiveSteamAccount("member_a", "countsteam01");
    ctx.store.updateSteamGuard("member_a", "countsteam01", {
      mafile_content: JSON.stringify({shared_secret: "guard-secret"})
    });
    const before = ctx.store.db.prepare("SELECT * FROM steam_account WHERE username = ?").get("countsteam01");

    assert.equal(ctx.store.clearSteamGuard("member_a", "countsteam01"), true);
    const after = ctx.store.db.prepare("SELECT * FROM steam_account WHERE username = ?").get("countsteam01");
    assert.equal(after.mafile_content, "");
    for (const field of [
      "password", "remark", "steam_name", "steam_id", "steam_id64", "avatar_url", "ban_status", "trade_url",
      "balance", "balance_source", "balance_currency", "balance_observed_at", "created_at"
    ]) {
      assert.equal(after[field], before[field], `${field} must remain unchanged`);
    }
    assert.equal(ctx.store.getViewerActiveSteamUsername("member_a"), "countsteam01");
  } finally {
    cleanup(ctx);
  }
}

function test_clear_steam_password_only_clears_persisted_password() {
  const ctx = createStore();
  try {
    ctx.store.bootstrapAdmin({password: "Admin!234"});
    ctx.store.createUser({
      username: "member_a",
      password: "Member!234",
      roleCodes: ["member"],
      boundSteamUsernames: ["countsteam01"]
    });
    ctx.store.setActiveSteamAccount("member_a", "countsteam01");
    ctx.store.updateSteamGuard("member_a", "countsteam01", {
      mafile_content: JSON.stringify({shared_secret: "guard-secret"})
    });
    const before = ctx.store.db.prepare("SELECT * FROM steam_account WHERE username = ?").get("countsteam01");

    assert.equal(ctx.store.clearSteamPassword("member_a", "countsteam01"), true);
    const after = ctx.store.db.prepare("SELECT * FROM steam_account WHERE username = ?").get("countsteam01");
    assert.equal(after.password, "");
    for (const field of [
      "mafile_content", "remark", "steam_name", "steam_id", "steam_id64", "avatar_url", "ban_status", "trade_url",
      "balance", "balance_source", "balance_currency", "balance_observed_at", "created_at"
    ]) {
      assert.equal(after[field], before[field], `${field} must remain unchanged`);
    }
    assert.equal(ctx.store.getViewerActiveSteamUsername("member_a"), "countsteam01");
  } finally {
    cleanup(ctx);
  }
}

function main() {
  test_bootstrap_admin_creates_super_admin_and_imports_legacy_accounts();
  test_regular_user_only_sees_bound_steam_accounts();
  test_legacy_active_account_remains_available_for_unscoped_dev_viewer();
  test_legacy_accounts_migrate_once_and_remove_the_old_file();
  test_completed_migration_never_reimports_a_recreated_legacy_file();
  test_unscoped_active_account_survives_without_accounts_json();
  test_corrupt_legacy_accounts_file_blocks_migration_and_is_preserved();
  test_wallet_balance_source_metadata_is_persisted();
  test_wallet_balance_latest_successful_source_replaces_current_value();
  test_public_steam_account_projection_hides_secrets_and_reports_guard_presence();
  test_internal_steam_account_credentials_remain_available_with_scope_checks();
  test_update_steam_guard_only_changes_guard_and_fills_empty_steam_id64();
  test_update_steam_guard_propagates_database_write_failure();
  test_guard_import_create_and_overwrite_have_narrow_persistence_boundaries();
  test_guard_import_create_rolls_back_when_viewer_binding_disappears_inside_transaction();
  test_clear_steam_guard_only_clears_local_mafile();
  test_clear_steam_password_only_clears_persisted_password();
  console.log("app-auth-store tests passed");
}

main();
