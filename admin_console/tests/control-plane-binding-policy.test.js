const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {ControlPlaneStore} = require("../src/controlPlaneStore");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-control-plane-binding-"));
}

function makeUser(store, {
  email,
  username,
  membershipPlan,
  membershipExpiresAt = "",
  now = "2026-04-08T00:00:00.000Z"
} = {}) {
  return store.createClientUser({
    email,
    username,
    password: "Secret123!",
    membershipPlan,
    membershipExpiresAt,
    now
  });
}

function main() {
  const tempDir = makeTempDir();
  const dbPath = path.join(tempDir, "control-plane-binding.db");
  const store = new ControlPlaneStore({dbPath});
  try {
    const trialUser = makeUser(store, {
      email: "trial@example.com",
      username: "trial_user",
      membershipPlan: "trial",
      membershipExpiresAt: "2026-04-15T00:00:00.000Z"
    });

    const firstTrialBind = store.checkOrBindSteamAccount({
      userId: trialUser.id,
      steamId: "76561198000000001",
      steamAccountName: "steam_account_a",
      now: "2026-04-08T00:00:00.000Z"
    });
    assert.equal(firstTrialBind.ok, true);
    assert.equal(firstTrialBind.binding_limit, 1);
    assert.equal(firstTrialBind.bound_count, 1);
    assert.equal(firstTrialBind.matched_existing, false);

    const secondTrialBind = store.checkOrBindSteamAccount({
      userId: trialUser.id,
      steamId: "76561198000000002",
      steamAccountName: "steam_account_b",
      now: "2026-04-08T00:05:00.000Z"
    });
    assert.equal(secondTrialBind.ok, false);
    assert.equal(secondTrialBind.reason, "steam_binding_limit_reached");
    assert.equal(secondTrialBind.binding_limit, 1);
    assert.equal(secondTrialBind.bound_count, 1);

    const sameTrialBind = store.checkOrBindSteamAccount({
      userId: trialUser.id,
      steamId: "76561198000000001",
      steamAccountName: "steam_account_a",
      now: "2026-04-08T00:10:00.000Z"
    });
    assert.equal(sameTrialBind.ok, true);
    assert.equal(sameTrialBind.matched_existing, true);
    assert.equal(sameTrialBind.bound_count, 1);

    const trialBindings = store.listUserSteamBindings({userId: trialUser.id});
    assert.equal(trialBindings.length, 1);
    assert.equal(trialBindings[0].steam_id, "76561198000000001");
    assert.equal(trialBindings[0].status, "active");

    const revokedBinding = store.revokeUserSteamBindingById({
      userId: trialUser.id,
      bindingId: trialBindings[0].id,
      note: "manual_reset",
      now: "2026-04-08T00:12:00.000Z"
    });
    assert.equal(revokedBinding.ok, true);

    const bindingsAfterRevoke = store.listUserSteamBindings({userId: trialUser.id});
    assert.equal(bindingsAfterRevoke.length, 0);

    const reboundTrialBind = store.checkOrBindSteamAccount({
      userId: trialUser.id,
      steamId: "76561198000000002",
      steamAccountName: "steam_account_b",
      now: "2026-04-08T00:15:00.000Z"
    });
    assert.equal(reboundTrialBind.ok, true);
    assert.equal(reboundTrialBind.bound_count, 1);

    const memberUser = makeUser(store, {
      email: "member@example.com",
      username: "member_user",
      membershipPlan: "member",
      now: "2026-04-08T00:00:00.000Z"
    });

    const firstMemberBind = store.checkOrBindSteamAccount({
      userId: memberUser.id,
      steamId: "76561198000000003",
      steamAccountName: "steam_account_c",
      now: "2026-04-08T00:15:00.000Z"
    });
    assert.equal(firstMemberBind.ok, true);
    assert.equal(firstMemberBind.binding_limit, -1);
    assert.equal(firstMemberBind.bound_count, 1);

    const secondMemberBind = store.checkOrBindSteamAccount({
      userId: memberUser.id,
      steamId: "76561198000000004",
      steamAccountName: "steam_account_d",
      now: "2026-04-08T00:20:00.000Z"
    });
    assert.equal(secondMemberBind.ok, true);
    assert.equal(secondMemberBind.binding_limit, -1);
    assert.equal(secondMemberBind.bound_count, 2);
  } finally {
    store.close();
    fs.rmSync(tempDir, {recursive: true, force: true});
  }

  console.log("control-plane-binding-policy tests passed");
}

main();
