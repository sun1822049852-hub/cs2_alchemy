const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {DatabaseSync} = require("node:sqlite");

const {ControlPlaneStore} = require("../src/controlPlaneStore");
const {FEATURE_CODES} = require("../../shared/featureCodes");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-control-plane-store-"));
}

function sortText(values) {
  return [...values].sort((left, right) => String(left).localeCompare(String(right)));
}

function seedLegacyPlans(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE client_user (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      membership_plan TEXT NOT NULL DEFAULT 'inactive',
      membership_expires_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const insert = db.prepare(`
    INSERT INTO client_user(email, username, password_hash, membership_plan, membership_expires_at, created_at, updated_at)
    VALUES(?, ?, 'legacy', ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `);
  for (const [index, code] of ["trial", "standard", "pro", "elite", "free"].entries()) {
    insert.run(`${code}@example.com`, `legacy_${index}`, code, "2026-08-01T00:00:00.000Z");
  }
  db.close();
}

function testLegacyRefreshFamilyMigration(tempDir) {
  const dbPath = path.join(tempDir, "legacy-refresh-family.db");
  const original = new ControlPlaneStore({dbPath});
  let firstSession;
  let unrelatedSession;
  try {
    const firstUser = original.createClientUser({
      email: "legacy-refresh-a@example.com",
      username: "legacy_refresh_a",
      password: "LegacyRefresh12"
    });
    const unrelatedUser = original.createClientUser({
      email: "legacy-refresh-b@example.com",
      username: "legacy_refresh_b",
      password: "LegacyRefresh34"
    });
    firstSession = original.createRefreshSession({userId: firstUser.id, deviceId: "legacy-device-a"});
    unrelatedSession = original.createRefreshSession({userId: unrelatedUser.id, deviceId: "legacy-device-b"});
    original.db.prepare("UPDATE refresh_session SET family_id = ''").run();
  } finally {
    original.close();
  }

  const migrated = new ControlPlaneStore({dbPath});
  try {
    const families = migrated.db.prepare("SELECT id, family_id FROM refresh_session ORDER BY id").all();
    assert.equal(families.every((row) => String(row.family_id || "").length > 0), true);
    assert.notEqual(families[0].family_id, families[1].family_id);

    const rotated = migrated.rotateRefreshSession({
      refreshToken: firstSession.refresh_token,
      deviceId: "legacy-device-a"
    });
    assert.equal(rotated.ok, true);
    assert.equal(rotated.family_id, families[0].family_id);
    assert.equal(migrated.rotateRefreshSession({
      refreshToken: firstSession.refresh_token,
      deviceId: "legacy-device-a"
    }).reason, "refresh_token_reused");
    assert.equal(migrated.resolveRefreshSession({
      refreshToken: rotated.refresh_token,
      deviceId: "legacy-device-a"
    }).reason, "refresh_token_not_found");
    assert.equal(migrated.resolveRefreshSession({
      refreshToken: unrelatedSession.refresh_token,
      deviceId: "legacy-device-b"
    }).ok, true);
    assert.deepEqual(migrated.revokeRefreshFamily({familyId: ""}), {
      ok: false,
      reason: "refresh_family_id_required",
      revoked_count: 0
    });
  } finally {
    migrated.close();
  }
}

function main() {
  const tempDir = makeTempDir();
  const dbPath = path.join(tempDir, "control-plane-auth.db");
  const legacyDbPath = path.join(tempDir, "legacy.db");
  seedLegacyPlans(legacyDbPath);
  testLegacyRefreshFamilyMigration(tempDir);

  const migratedStore = new ControlPlaneStore({dbPath: legacyDbPath});
  try {
    assert.deepEqual(
      migratedStore.listClientUsers({includeArchived: true}).map((user) => user.membership_plan),
      ["member", "member", "member", "member", "inactive"]
    );
    assert.deepEqual(migratedStore.listMembershipPlans().map((plan) => plan.code), ["inactive", "member"]);
  } finally {
    migratedStore.close();
  }

  const store = new ControlPlaneStore({dbPath});
  try {
    const plans = store.listMembershipPlans();
    assert.deepEqual(plans.map((item) => item.code), ["inactive", "member"]);
    assert.deepEqual(sortText(plans[0].permissions), sortText([
      FEATURE_CODES.ACCOUNTS_READ,
      FEATURE_CODES.ACCOUNTS_WRITE,
      FEATURE_CODES.INVENTORY_READ,
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.SIMULATION_USE
    ]));
    assert.equal(plans[0].permissions.includes(FEATURE_CODES.CRAFT_USE), false);
    assert.deepEqual(sortText(plans[1].permissions), sortText([
      FEATURE_CODES.ACCOUNTS_READ,
      FEATURE_CODES.ACCOUNTS_WRITE,
      FEATURE_CODES.CRAFT_USE,
      FEATURE_CODES.INVENTORY_READ,
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.SIMULATION_USE
    ]));

    const admin = store.createOrUpdateAdminUser({
      username: "admin",
      password: "  root secret  ",
      isSuperAdmin: true,
      now: "2026-04-05T04:59:00.000Z"
    });
    assert.equal(store.authenticateAdminUser({username: "admin", password: "  root secret  "}).ok, true);
    assert.equal(store.authenticateAdminUser({username: "admin", password: "root secret"}).ok, false);
    const adminHash = store.db.prepare("SELECT password_hash FROM admin_user WHERE id = ?").get(admin.id).password_hash;
    assert.match(adminHash, /^scrypt\$v2\$32768\$8\$3\$/);

    const adminSession = store.createAdminSession({
      adminUserId: admin.id,
      ttlHours: 8,
      now: "2026-04-05T05:00:00.000Z"
    });
    assert.equal(store.resolveAdminSession({
      sessionToken: adminSession.session_token,
      idleTimeoutMs: 30 * 60 * 1000,
      now: "2026-04-05T05:29:59.000Z"
    }).ok, true);
    assert.equal(store.resolveAdminSession({
      sessionToken: adminSession.session_token,
      idleTimeoutMs: 30 * 60 * 1000,
      now: "2026-04-05T06:00:00.000Z"
    }).reason, "admin_session_expired");

    const user = store.createClientUser({
      email: "alice@example.com",
      username: "alice",
      password: "  user secret  ",
      now: "2026-04-05T05:00:00.000Z"
    });
    assert.equal(user.membership_plan, "inactive");
    assert.equal(user.membership_expires_at, "");
    assert.equal(store.authenticateClientUser({username: "alice", password: "  user secret  "}).ok, true);
    assert.equal(store.authenticateClientUser({username: "alice", password: "user secret"}).ok, false);

    const legacySalt = "legacy-salt";
    const legacyDigest = crypto.scryptSync("  user secret  ", legacySalt, 64).toString("hex");
    store.db.prepare("UPDATE client_user SET password_hash = ? WHERE id = ?")
      .run(`scrypt$${legacySalt}$${legacyDigest}`, user.id);
    assert.equal(store.authenticateClientUser({username: "alice", password: "  user secret  "}).ok, true);
    assert.match(store.db.prepare("SELECT password_hash FROM client_user WHERE id = ?").get(user.id).password_hash,
      /^scrypt\$v2\$32768\$8\$3\$/);

    const shortLegacyPassword = "short7";
    const shortLegacySalt = "legacy-short-salt";
    const shortLegacyDigest = crypto.scryptSync(shortLegacyPassword, shortLegacySalt, 64).toString("hex");
    store.db.prepare("UPDATE client_user SET password_hash = ? WHERE id = ?")
      .run(`scrypt$${shortLegacySalt}$${shortLegacyDigest}`, user.id);
    assert.equal(store.authenticateClientUser({username: "alice", password: shortLegacyPassword}).ok, true);
    assert.match(store.db.prepare("SELECT password_hash FROM client_user WHERE id = ?").get(user.id).password_hash,
      /^scrypt\$v2\$32768\$8\$3\$/);

    store.db.prepare("UPDATE admin_user SET password_hash = ? WHERE id = ?")
      .run(`scrypt$${shortLegacySalt}$${shortLegacyDigest}`, admin.id);
    assert.equal(store.authenticateAdminUser({username: "admin", password: shortLegacyPassword}).ok, true);
    assert.match(store.db.prepare("SELECT password_hash FROM admin_user WHERE id = ?").get(admin.id).password_hash,
      /^scrypt\$v2\$32768\$8\$3\$/);

    const inactive = store.resolveUserEntitlements({userId: user.id, now: "2026-04-05T05:00:00.000Z"});
    assert.equal(inactive.membership_plan, "inactive");
    assert.equal(inactive.feature_flags.craft_enabled, false);
    assert.equal("steam_binding_limit" in inactive.feature_flags, false);
    assert.equal("trial_active" in inactive.feature_flags, false);

    const firstSession = store.createRefreshSession({
      userId: user.id,
      deviceId: "device-alpha",
      now: "2026-04-05T05:01:00.000Z"
    });
    const rotated = store.rotateRefreshSession({
      refreshToken: firstSession.refresh_token,
      deviceId: "device-alpha",
      now: "2026-04-05T05:02:00.000Z"
    });
    assert.equal(rotated.ok, true);
    assert.equal(rotated.family_id, firstSession.family_id);
    assert.equal(rotated.parent_session_id, firstSession.id);
    const reused = store.rotateRefreshSession({
      refreshToken: firstSession.refresh_token,
      deviceId: "device-alpha",
      now: "2026-04-05T05:03:00.000Z"
    });
    assert.equal(reused.reason, "refresh_token_reused");
    assert.equal(store.resolveRefreshSession({
      refreshToken: rotated.refresh_token,
      deviceId: "device-alpha",
      now: "2026-04-05T05:04:00.000Z"
    }).reason, "refresh_token_not_found");

    const managed = store.createManagedClientUser({
      email: "member@example.com",
      username: "managed",
      password: "managed pass",
      membershipDays: 7,
      adminUserId: admin.id,
      now: "2026-04-06T00:00:00.000Z"
    });
    assert.equal(managed.user.membership_plan, "member");
    assert.equal(managed.user.membership_expires_at, "2026-04-13T00:00:00.000Z");
    assert.equal(store.listMembershipGrants({userId: managed.user.id}).length, 1);

    const bulk = store.bulkGrantMembership({
      userIds: [user.id, managed.user.id],
      days: 5,
      adminUserId: admin.id,
      now: "2026-04-10T00:00:00.000Z"
    });
    assert.equal(bulk.ok, true);
    assert.equal(store.getClientUserById(user.id).membership_expires_at, "2026-04-15T00:00:00.000Z");
    assert.equal(store.getClientUserById(managed.user.id).membership_expires_at, "2026-04-18T00:00:00.000Z");
    assert.equal(store.bulkGrantMembership({userIds: [user.id, 999999], days: 1, adminUserId: admin.id}).reason, "user_not_found");
    assert.equal(store.getClientUserById(user.id).membership_expires_at, "2026-04-15T00:00:00.000Z");

    const sessionBeforeReset = store.createRefreshSession({userId: user.id, deviceId: "reset-device"});
    const reset = store.resetClientUserPassword({
      userId: user.id,
      newPassword: "new pass 123",
      adminUserId: admin.id,
      now: "2026-04-10T01:00:00.000Z"
    });
    assert.equal(reset.ok, true);
    assert.equal(store.resolveRefreshSession({refreshToken: sessionBeforeReset.refresh_token, deviceId: "reset-device"}).reason, "refresh_token_not_found");
    assert.equal(store.authenticateClientUser({username: "alice", password: "new pass 123"}).ok, true);

    const selfReset = store.updateClientPassword({
      email: user.email,
      newPassword: "self reset 12",
      ip: "127.0.0.1",
      now: "2026-04-10T01:30:00.000Z"
    });
    assert.equal(selfReset.ok, true);
    const selfResetAudit = store.listAuditEvents().find((event) =>
      event.action === "user.password_reset" && event.actor_type === "client_user");
    assert.equal(selfResetAudit.actor_id, user.id);
    assert.equal(selfResetAudit.ip, "127.0.0.1");

    const appendAuditEvent = store.appendAuditEvent.bind(store);
    store.appendAuditEvent = () => { throw new Error("audit write failed"); };
    try {
      assert.throws(() => store.updateClientUserControl({
        userId: managed.user.id,
        status: "disabled",
        adminUserId: admin.id,
        now: "2026-04-10T01:45:00.000Z"
      }), /audit write failed/);
    } finally {
      store.appendAuditEvent = appendAuditEvent;
    }
    assert.equal(store.getClientUserById(managed.user.id).status, "active");

    const archived = store.archiveClientUser({userId: managed.user.id, adminUserId: admin.id, now: "2026-04-10T02:00:00.000Z"});
    assert.equal(archived.user.status, "archived");
    assert.equal(store.listClientUsers().some((item) => item.id === managed.user.id), false);
    assert.equal(store.listClientUsers({includeArchived: true}).some((item) => item.id === managed.user.id), true);
    assert.equal(store.restoreClientUser({userId: managed.user.id, adminUserId: admin.id, now: "2026-04-10T03:00:00.000Z"}).user.status, "active");

    const generated = store.generateActivationCodes({
      count: 2,
      days: 30,
      expiresAt: "2026-12-31T00:00:00.000Z",
      adminUserId: admin.id,
      now: "2026-04-11T00:00:00.000Z"
    });
    assert.equal(generated.codes.length, 2);
    assert.match(generated.codes[0].code, /^CS2-[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
    assert.equal(store.db.prepare("SELECT code_hash FROM activation_code WHERE id = ?").get(generated.codes[0].id).code_hash.includes(generated.codes[0].code), false);
    assert.equal(store.listActivationCodes({now: "2026-04-11T00:00:00.000Z"})[0].code, undefined);

    const redeemed = store.redeemActivationCode({
      userId: user.id,
      code: generated.codes[0].code,
      now: "2026-04-12T00:00:00.000Z"
    });
    assert.equal(redeemed.ok, true);
    assert.equal(redeemed.user.membership_plan, "member");
    assert.equal(redeemed.user.membership_expires_at, "2026-05-15T00:00:00.000Z");
    assert.equal(store.redeemActivationCode({userId: managed.user.id, code: generated.codes[0].code}).reason, "activation_code_used");
    assert.equal(store.revokeActivationCode({activationCodeId: generated.codes[1].id, adminUserId: admin.id}).ok, true);
    assert.equal(store.redeemActivationCode({userId: user.id, code: generated.codes[1].code}).reason, "activation_code_revoked");

    const product = store.createProduct({
      name: "30 天会员",
      description: "本地商品",
      membershipDays: 30,
      priceCents: 1990,
      isEnabled: true,
      sortOrder: 10,
      adminUserId: admin.id,
      now: "2026-04-12T00:00:00.000Z"
    });
    assert.equal(product.price_cents, 1990);
    assert.equal(store.listProducts({enabledOnly: true}).length, 1);
    const disabledProduct = store.updateProduct({productId: product.id, isEnabled: false, adminUserId: admin.id});
    assert.equal(disabledProduct.is_enabled, false);
    assert.equal(store.listProducts({enabledOnly: true}).length, 0);
    assert.deepEqual(store.listOrders(), []);

    const removableProduct = store.createProduct({
      name: "可删除商品", membershipDays: 1, priceCents: 100, adminUserId: admin.id
    });
    assert.equal(store.deleteProduct({productId: removableProduct.id, adminUserId: admin.id}).ok, true);
    assert.equal(store.listProducts().some((item) => item.id === removableProduct.id), false);

    store.db.prepare(`
      INSERT INTO payment_order(
        order_no, user_id, product_id, product_name, membership_days, amount_cents,
        currency, status, provider, external_transaction_id, created_at, updated_at, paid_at
      ) VALUES(?, ?, ?, ?, ?, ?, 'CNY', 'pending', '', '', ?, ?, '')
    `).run("TEST-ORDER-1", user.id, product.id, product.name, product.membership_days,
      product.price_cents, "2026-04-12T00:00:00.000Z", "2026-04-12T00:00:00.000Z");
    assert.equal(store.deleteProduct({productId: product.id, adminUserId: admin.id}).reason, "product_in_use");
    assert.equal(store.listProducts().some((item) => item.id === product.id), true);

    const events = store.listAuditEvents();
    assert.equal(events.some((event) => event.action === "activation_codes.generated"), true);
    assert.equal(events.some((event) => event.action === "activation_code.redeemed"), true);
    assert.equal(events.some((event) => event.action === "user.password_reset"), true);
  } finally {
    store.close();
    fs.rmSync(tempDir, {recursive: true, force: true});
  }

  console.log("control-plane-store tests passed");
}

main();
