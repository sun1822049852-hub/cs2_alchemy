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

function main() {
  test_bootstrap_admin_creates_super_admin_and_imports_legacy_accounts();
  test_regular_user_only_sees_bound_steam_accounts();
  test_legacy_active_account_remains_available_for_unscoped_dev_viewer();
  test_wallet_balance_source_metadata_is_persisted();
  test_wallet_balance_latest_successful_source_replaces_current_value();
  console.log("app-auth-store tests passed");
}

main();
