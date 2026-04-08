const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {ControlPlaneStore} = require("../src/controlPlaneStore");
const {FEATURE_CODES} = require("../../shared/featureCodes");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-control-plane-store-"));
}

function sortText(values) {
  return [...values].sort((left, right) => String(left).localeCompare(String(right)));
}

function main() {
  const tempDir = makeTempDir();
  const dbPath = path.join(tempDir, "control-plane-auth.db");
  const store = new ControlPlaneStore({dbPath});
  try {
    assert.equal(store.needsAdminBootstrap(), true);

    const bootstrapAdmin = store.createOrUpdateAdminUser({
      username: "admin",
      password: "Root123!",
      isSuperAdmin: true,
      now: "2026-04-05T04:59:00.000Z"
    });
    assert.equal(bootstrapAdmin.username, "admin");
    assert.equal(bootstrapAdmin.is_super_admin, true);
    assert.equal(store.needsAdminBootstrap(), false);

    const adminAuth = store.authenticateAdminUser({
      username: "admin",
      password: "Root123!"
    });
    assert.equal(adminAuth.ok, true);
    assert.equal(adminAuth.user.username, "admin");

    const adminSession = store.createAdminSession({
      adminUserId: adminAuth.user.id,
      ttlHours: 12,
      now: "2026-04-05T05:00:00.000Z"
    });
    assert.equal(typeof adminSession.session_token, "string");
    assert.equal(adminSession.session_token.length > 10, true);

    const resolvedAdminSession = store.resolveAdminSession({
      sessionToken: adminSession.session_token,
      now: "2026-04-05T05:01:00.000Z"
    });
    assert.equal(resolvedAdminSession.ok, true);
    assert.equal(resolvedAdminSession.user.username, "admin");

    const plans = store.listMembershipPlans();
    assert.deepEqual(plans.map((item) => item.code), ["inactive", "member", "standard", "trial"]);

    const inactivePlan = plans.find((item) => item.code === "inactive");
    assert.deepEqual(sortText(inactivePlan.permissions), sortText([
      FEATURE_CODES.ACCOUNTS_READ,
      FEATURE_CODES.ACCOUNTS_WRITE,
      FEATURE_CODES.INVENTORY_READ,
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.SIMULATION_USE
    ]));

    const standardPlan = plans.find((item) => item.code === "standard");
    assert.deepEqual(sortText(standardPlan.permissions), sortText([
      FEATURE_CODES.ACCOUNTS_READ,
      FEATURE_CODES.ACCOUNTS_WRITE,
      FEATURE_CODES.CRAFT_USE,
      FEATURE_CODES.INVENTORY_READ,
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.SIMULATION_USE
    ]));

    const memberPlan = plans.find((item) => item.code === "member");
    assert.deepEqual(sortText(memberPlan.permissions), sortText([
      FEATURE_CODES.ACCOUNTS_READ,
      FEATURE_CODES.ACCOUNTS_WRITE,
      FEATURE_CODES.CRAFT_USE,
      FEATURE_CODES.INVENTORY_READ,
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.SIMULATION_USE
    ]));

    const trialPlan = plans.find((item) => item.code === "trial");
    assert.deepEqual(sortText(trialPlan.permissions), sortText([
      FEATURE_CODES.ACCOUNTS_READ,
      FEATURE_CODES.ACCOUNTS_WRITE,
      FEATURE_CODES.CRAFT_USE,
      FEATURE_CODES.INVENTORY_READ,
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.SIMULATION_USE
    ]));

    assert.equal(store.canSendCode({
      email: "alice@example.com",
      scene: "register",
      cooldownMs: 60 * 1000,
      now: "2026-04-05T05:00:00.000Z"
    }), true);

    const created = store.createEmailCode({
      email: "alice@example.com",
      scene: "register",
      code: "123456",
      ttlMs: 5 * 60 * 1000,
      now: "2026-04-05T05:00:00.000Z"
    });
    assert.equal(created.email, "alice@example.com");
    assert.equal(created.scene, "register");
    assert.equal(created.expires_at, "2026-04-05T05:05:00.000Z");

    const active = store.getLatestActiveCode({
      email: "alice@example.com",
      scene: "register",
      now: "2026-04-05T05:01:00.000Z"
    });
    assert.ok(active);
    assert.equal(active.email, "alice@example.com");
    assert.equal(active.scene, "register");
    assert.equal(typeof active.code_hash, "string");
    assert.equal(active.code_hash.length > 10, true);

    assert.equal(store.canSendCode({
      email: "alice@example.com",
      scene: "register",
      cooldownMs: 60 * 1000,
      now: "2026-04-05T05:00:30.000Z"
    }), false);

    assert.equal(store.canSendCode({
      email: "alice@example.com",
      scene: "register",
      cooldownMs: 60 * 1000,
      now: "2026-04-05T05:01:30.000Z"
    }), true);

    const verified = store.verifyEmailCode({
      email: "alice@example.com",
      scene: "register",
      code: "123456",
      now: "2026-04-05T05:01:30.000Z"
    });
    assert.equal(verified.ok, true);
    assert.equal(verified.reason, "verified");

    const repeated = store.verifyEmailCode({
      email: "alice@example.com",
      scene: "register",
      code: "123456",
      now: "2026-04-05T05:01:35.000Z"
    });
    assert.equal(repeated.ok, false);
    assert.equal(repeated.reason, "code_not_found");

    const user = store.createClientUser({
      email: "alice@example.com",
      username: "alice",
      password: "Secret123!"
    });
    assert.equal(user.username, "alice");
    assert.equal(user.membership_plan, "inactive");
    assert.equal(user.membership_expires_at, "");
    assert.equal(user.remaining_membership_days, 0);

    const defaultEntitlements = store.resolveUserEntitlements({
      userId: user.id,
      now: "2026-04-05T05:01:40.000Z"
    });
    assert.equal(defaultEntitlements.membership_plan, "inactive");
    assert.equal(defaultEntitlements.assigned_membership_plan, "inactive");
    assert.deepEqual(sortText(defaultEntitlements.permissions), sortText([
      FEATURE_CODES.ACCOUNTS_READ,
      FEATURE_CODES.ACCOUNTS_WRITE,
      FEATURE_CODES.INVENTORY_READ,
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.SIMULATION_USE
    ]));
    assert.equal(defaultEntitlements.feature_flags.simulation_enabled, true);
    assert.equal(defaultEntitlements.feature_flags.craft_enabled, false);
    assert.equal(defaultEntitlements.feature_flags.steam_binding_mode, "single_locked");
    assert.equal(defaultEntitlements.feature_flags.steam_binding_limit, 0);
    assert.equal(defaultEntitlements.feature_flags.trial_active, false);
    assert.equal(defaultEntitlements.feature_flags.trial_expires_at, "");
    assert.equal(defaultEntitlements.remaining_membership_days, 0);
    assert.equal(defaultEntitlements.membership_active, false);

    const trialUser = store.createClientUser({
      email: "trial@example.com",
      username: "trial_user",
      password: "Secret123!",
      membershipPlan: "trial",
      membershipExpiresAt: "2026-04-15T00:00:00.000Z",
      now: "2026-04-05T05:01:45.000Z"
    });
    const trialEntitlements = store.resolveUserEntitlements({
      userId: trialUser.id,
      now: "2026-04-08T00:00:00.000Z"
    });
    assert.equal(trialEntitlements.membership_plan, "trial");
    assert.equal(trialEntitlements.assigned_membership_plan, "trial");
    assert.equal(trialEntitlements.membership_active, true);
    assert.equal(trialEntitlements.permissions.includes(FEATURE_CODES.CRAFT_USE), true);
    assert.equal(trialEntitlements.feature_flags.craft_enabled, true);
    assert.equal(trialEntitlements.feature_flags.steam_binding_limit, 1);
    assert.equal(trialEntitlements.feature_flags.trial_active, true);
    assert.equal(trialEntitlements.feature_flags.trial_expires_at, "2026-04-15T00:00:00.000Z");

    const expiredTrialEntitlements = store.resolveUserEntitlements({
      userId: trialUser.id,
      now: "2026-04-20T00:00:00.000Z"
    });
    assert.equal(expiredTrialEntitlements.membership_plan, "inactive");
    assert.equal(expiredTrialEntitlements.assigned_membership_plan, "trial");
    assert.equal(expiredTrialEntitlements.membership_active, false);
    assert.equal(expiredTrialEntitlements.permissions.includes(FEATURE_CODES.CRAFT_USE), false);
    assert.equal(expiredTrialEntitlements.feature_flags.craft_enabled, false);
    assert.equal(expiredTrialEntitlements.feature_flags.steam_binding_limit, 0);
    assert.equal(expiredTrialEntitlements.feature_flags.trial_active, false);
    assert.equal(expiredTrialEntitlements.feature_flags.trial_expires_at, "");

    const updatedEntitlements = store.updateClientUserEntitlements({
      userId: user.id,
      membershipPlan: "standard",
      membershipExpiresAt: "2026-04-20T00:00:00.000Z",
      permissionOverrides: [
        {featureCode: FEATURE_CODES.CRAFT_USE, enabled: true}
      ],
      now: "2026-04-05T05:01:50.000Z"
    });
    assert.equal(updatedEntitlements.ok, true);
    assert.equal(updatedEntitlements.user.membership_plan, "standard");
    assert.equal(updatedEntitlements.user.membership_expires_at, "2026-04-20T00:00:00.000Z");
    assert.equal(updatedEntitlements.user.remaining_membership_days, 15);
    assert.deepEqual(sortText(updatedEntitlements.entitlements.permissions), sortText([
      FEATURE_CODES.ACCOUNTS_READ,
      FEATURE_CODES.ACCOUNTS_WRITE,
      FEATURE_CODES.INVENTORY_READ,
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.SIMULATION_USE,
      FEATURE_CODES.CRAFT_USE
    ]));
    assert.equal(updatedEntitlements.entitlements.feature_flags.simulation_enabled, true);
    assert.equal(updatedEntitlements.entitlements.feature_flags.craft_enabled, true);
    assert.equal(updatedEntitlements.entitlements.feature_flags.steam_binding_mode, "single_locked");
    assert.equal(updatedEntitlements.entitlements.feature_flags.steam_binding_limit, 1);
    assert.equal(updatedEntitlements.entitlements.feature_flags.trial_active, false);
    assert.equal(updatedEntitlements.entitlements.feature_flags.trial_expires_at, "");
    assert.equal(updatedEntitlements.entitlements.membership_active, true);
    assert.equal(updatedEntitlements.entitlements.remaining_membership_days, 15);

    const expiredEntitlements = store.resolveUserEntitlements({
      userId: user.id,
      now: "2026-04-25T00:00:00.000Z"
    });
    assert.equal(expiredEntitlements.membership_plan, "inactive");
    assert.equal(expiredEntitlements.assigned_membership_plan, "standard");
    assert.equal(expiredEntitlements.membership_active, false);
    assert.equal(expiredEntitlements.remaining_membership_days, 0);
    assert.deepEqual(sortText(expiredEntitlements.permissions), sortText([
      FEATURE_CODES.ACCOUNTS_READ,
      FEATURE_CODES.ACCOUNTS_WRITE,
      FEATURE_CODES.INVENTORY_READ,
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.SIMULATION_USE
    ]));

    const login = store.authenticateClientUser({
      username: "alice",
      password: "Secret123!"
    });
    assert.equal(login.ok, true);
    assert.equal(login.user.username, "alice");

    const session = store.createRefreshSession({
      userId: login.user.id,
      deviceId: "device_alpha",
      now: "2026-04-05T05:02:00.000Z"
    });
    assert.equal(typeof session.refresh_token, "string");
    assert.equal(session.refresh_token.length > 10, true);

    const resolved = store.resolveRefreshSession({
      refreshToken: session.refresh_token,
      deviceId: "device_alpha",
      now: "2026-04-05T05:03:00.000Z"
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.user.username, "alice");
    assert.equal(resolved.user.membership_plan, "standard");

    const access = store.resolveClientAccess({
      refreshToken: session.refresh_token,
      deviceId: "device_alpha",
      now: "2026-04-05T05:03:10.000Z"
    });
    assert.equal(access.ok, true);
    assert.equal(access.user.username, "alice");
    assert.equal(access.entitlements.membership_plan, "standard");
    assert.equal(access.entitlements.permissions.includes(FEATURE_CODES.CRAFT_USE), true);

    const accessWithoutCraft = store.resolveClientAccess({
      refreshToken: session.refresh_token,
      deviceId: "device_alpha",
      now: "2026-04-25T00:00:00.000Z"
    });
    assert.equal(accessWithoutCraft.ok, true);
    assert.equal(accessWithoutCraft.entitlements.membership_plan, "inactive");
    assert.equal(accessWithoutCraft.entitlements.permissions.includes(FEATURE_CODES.CRAFT_USE), false);

    const rotated = store.rotateRefreshSession({
      refreshToken: session.refresh_token,
      deviceId: "device_alpha",
      now: "2026-04-05T05:04:00.000Z"
    });
    assert.equal(rotated.ok, true);
    assert.notEqual(rotated.refresh_token, session.refresh_token);

    const oldToken = store.resolveRefreshSession({
      refreshToken: session.refresh_token,
      deviceId: "device_alpha",
      now: "2026-04-05T05:04:30.000Z"
    });
    assert.equal(oldToken.ok, false);
    assert.equal(oldToken.reason, "refresh_token_not_found");

    const revoked = store.revokeRefreshSession({
      refreshToken: rotated.refresh_token,
      now: "2026-04-05T05:05:00.000Z"
    });
    assert.equal(revoked.ok, true);

    const afterRevoke = store.resolveRefreshSession({
      refreshToken: rotated.refresh_token,
      deviceId: "device_alpha",
      now: "2026-04-05T05:05:10.000Z"
    });
    assert.equal(afterRevoke.ok, false);
    assert.equal(afterRevoke.reason, "refresh_token_not_found");

    const sessionBeta = store.createRefreshSession({
      userId: login.user.id,
      deviceId: "device_beta",
      now: "2026-04-05T05:05:30.000Z"
    });
    assert.equal(typeof sessionBeta.refresh_token, "string");

    const userSessions = store.listUserDeviceSessions({
      userId: login.user.id
    });
    assert.deepEqual(userSessions.map((item) => item.device_id), ["device_beta"]);

    const revokedById = store.revokeRefreshSessionById({
      sessionId: userSessions[0].id,
      now: "2026-04-05T05:06:00.000Z"
    });
    assert.equal(revokedById.ok, true);

    const afterRevokeById = store.resolveRefreshSession({
      refreshToken: sessionBeta.refresh_token,
      deviceId: "device_beta",
      now: "2026-04-05T05:06:10.000Z"
    });
    assert.equal(afterRevokeById.ok, false);
    assert.equal(afterRevokeById.reason, "refresh_token_not_found");

    const adminLogout = store.revokeAdminSession({
      sessionToken: adminSession.session_token,
      now: "2026-04-05T05:06:30.000Z"
    });
    assert.equal(adminLogout.ok, true);

    const afterAdminLogout = store.resolveAdminSession({
      sessionToken: adminSession.session_token,
      now: "2026-04-05T05:06:40.000Z"
    });
    assert.equal(afterAdminLogout.ok, false);
    assert.equal(afterAdminLogout.reason, "admin_session_not_found");
  } finally {
    store.close();
    fs.rmSync(tempDir, {recursive: true, force: true});
  }

  console.log("control-plane-store tests passed");
}

main();
