const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");

const {ensureCs2License} = require("../src/cs2Session");

function createSteam({owned = false, claimResult = {grantedPackageIds: [1], grantedAppIds: [730]}, claimError = null} = {}) {
  const steam = new EventEmitter();
  steam.ownsAppCalls = 0;
  steam.claimCalls = 0;
  steam.ownsApp = (appId) => {
    steam.ownsAppCalls += 1;
    assert.equal(appId, 730);
    return owned;
  };
  steam.requestFreeLicense = async (appIds) => {
    steam.claimCalls += 1;
    assert.deepEqual(appIds, [730]);
    if (claimError) throw claimError;
    return claimResult;
  };
  return steam;
}

function createVerificationStore(initial = false) {
  return {
    verified: initial,
    marks: 0,
    isSteamAppLicenseVerified(username, appId) {
      assert.equal(username, "demo");
      assert.equal(appId, 730);
      return this.verified;
    },
    markSteamAppLicenseVerified(username, appId) {
      assert.equal(username, "demo");
      assert.equal(appId, 730);
      this.marks += 1;
      this.verified = true;
      return true;
    }
  };
}

async function test_cached_verification_skips_steam_ownership_and_claim_calls() {
  const steam = createSteam();
  const store = createVerificationStore(true);
  const statuses = [];

  const result = await ensureCs2License({
    steam,
    username: "demo",
    verificationStore: store,
    onStatus: (payload) => statuses.push(payload)
  });

  assert.equal(result.source, "verified_cache");
  assert.equal(steam.ownsAppCalls, 0);
  assert.equal(steam.claimCalls, 0);
  assert.equal(store.marks, 0);
  assert.deepEqual(statuses, []);
}

async function test_owned_app_is_persisted_before_owned_status() {
  const steam = createSteam({owned: true});
  const store = createVerificationStore(false);
  const statuses = [];

  const task = ensureCs2License({
    steam,
    username: "demo",
    verificationStore: store,
    onStatus(payload) {
      if (payload.stage === "owned") assert.equal(store.verified, true);
      statuses.push(payload.stage);
    }
  });
  setImmediate(() => steam.emit("ownershipCached"));
  const result = await task;

  assert.equal(result.source, "steam_ownership");
  assert.equal(store.marks, 1);
  assert.equal(steam.claimCalls, 0);
  assert.deepEqual(statuses, ["checking", "owned"]);
}

async function test_missing_app_is_claimed_and_persisted_before_claimed_status() {
  const steam = createSteam({owned: false});
  const store = createVerificationStore(false);
  const statuses = [];

  const task = ensureCs2License({
    steam,
    username: "demo",
    verificationStore: store,
    onStatus(payload) {
      if (payload.stage === "claimed") assert.equal(store.verified, true);
      statuses.push(payload.stage);
    }
  });
  setImmediate(() => steam.emit("ownershipCached"));
  const result = await task;

  assert.equal(result.source, "free_license_grant");
  assert.equal(store.marks, 1);
  assert.equal(steam.claimCalls, 1);
  assert.deepEqual(statuses, ["checking", "claiming", "claimed"]);
}

async function test_already_owned_claim_response_is_treated_as_verified() {
  const alreadyOwned = new Error("AlreadyOwned");
  alreadyOwned.eresult = 30;
  const steam = createSteam({owned: false, claimError: alreadyOwned});
  const store = createVerificationStore(false);
  const statuses = [];

  const task = ensureCs2License({
    steam,
    username: "demo",
    verificationStore: store,
    onStatus: (payload) => statuses.push(payload.stage)
  });
  setImmediate(() => steam.emit("ownershipCached"));
  const result = await task;

  assert.equal(result.source, "claim_already_owned");
  assert.equal(store.marks, 1);
  assert.deepEqual(statuses, ["checking", "claiming", "owned"]);
}

async function test_claim_failure_has_detailed_reason_and_never_marks_verified() {
  const rateLimited = new Error("RateLimitExceeded");
  rateLimited.eresult = 84;
  const steam = createSteam({owned: false, claimError: rateLimited});
  const store = createVerificationStore(false);
  const statuses = [];

  const task = ensureCs2License({
    steam,
    username: "demo",
    verificationStore: store,
    onStatus: (payload) => statuses.push(payload)
  });
  setImmediate(() => steam.emit("ownershipCached"));

  await assert.rejects(task, (err) => {
    assert.equal(err.code, "cs2_license_claim_rate_limited");
    assert.equal(err.reason, "cs2_license_claim_rate_limited");
    assert.equal(err.eresult, 84);
    assert.match(err.message, /请求过于频繁/);
    assert.match(err.message, /EResult 84/);
    return true;
  });
  assert.equal(store.marks, 0);
  assert.equal(store.verified, false);
  assert.deepEqual(statuses.map((payload) => payload.stage), ["checking", "claiming", "failed"]);
  assert.equal(statuses.at(-1).reason, "cs2_license_claim_rate_limited");
  assert.equal(statuses.at(-1).eresult, 84);
}

async function test_ownership_cache_timeout_is_specific_and_does_not_claim() {
  const steam = createSteam({owned: false});
  const store = createVerificationStore(false);

  await assert.rejects(
    () => ensureCs2License({
      steam,
      username: "demo",
      verificationStore: store,
      ownershipTimeoutMs: 5
    }),
    (err) => err && err.code === "cs2_license_check_timeout" && /许可数据/.test(err.message)
  );
  assert.equal(steam.claimCalls, 0);
  assert.equal(store.marks, 0);
}

async function test_empty_grant_result_is_not_persisted() {
  const steam = createSteam({
    owned: false,
    claimResult: {grantedPackageIds: [], grantedAppIds: []}
  });
  const store = createVerificationStore(false);
  const task = ensureCs2License({steam, username: "demo", verificationStore: store});
  setImmediate(() => steam.emit("ownershipCached"));

  await assert.rejects(task, (err) => err && err.code === "cs2_license_not_granted");
  assert.equal(store.marks, 0);
  assert.equal(store.verified, false);
}

async function test_known_claim_errors_have_specific_messages_and_codes() {
  const cases = [
    [2, "cs2_license_claim_failed", "通用错误"],
    [3, "cs2_license_claim_no_connection", "连接已断开"],
    [15, "cs2_license_claim_access_denied", "拒绝了免费许可请求"],
    [16, "cs2_license_claim_timeout", "请求超时"],
    [20, "cs2_license_claim_service_unavailable", "服务暂时不可用"],
    [24, "cs2_license_claim_insufficient_privilege", "权限不足"],
    [25, "cs2_license_claim_limit_exceeded", "领取限制"],
    [83, "cs2_license_claim_region_locked", "当前区服"],
    [84, "cs2_license_claim_rate_limited", "请求过于频繁"],
    [112, "cs2_license_claim_limited_account", "账号受限"]
  ];
  for (const [eresult, code, messagePart] of cases) {
    const source = new Error(`Steam result ${eresult}`);
    source.eresult = eresult;
    const steam = createSteam({owned: false, claimError: source});
    const store = createVerificationStore(false);
    const task = ensureCs2License({steam, username: "demo", verificationStore: store});
    setImmediate(() => steam.emit("ownershipCached"));
    await assert.rejects(task, (err) => {
      assert.equal(err.code, code);
      assert.equal(err.eresult, eresult);
      assert.match(err.message, new RegExp(messagePart));
      assert.match(err.message, new RegExp(`EResult ${eresult}`));
      return true;
    });
    assert.equal(store.marks, 0);
  }
}

async function test_verification_write_failure_blocks_success_status() {
  const steam = createSteam({owned: true});
  const statuses = [];
  const store = createVerificationStore(false);
  store.markSteamAppLicenseVerified = () => {
    throw new Error("disk busy");
  };
  const task = ensureCs2License({
    steam,
    username: "demo",
    verificationStore: store,
    onStatus: (payload) => statuses.push(payload.stage)
  });
  setImmediate(() => steam.emit("ownershipCached"));

  await assert.rejects(task, (err) => err && err.code === "cs2_license_state_write_failed" && /disk busy/.test(err.message));
  assert.deepEqual(statuses, ["checking", "failed"]);
}

async function main() {
  await test_cached_verification_skips_steam_ownership_and_claim_calls();
  await test_owned_app_is_persisted_before_owned_status();
  await test_missing_app_is_claimed_and_persisted_before_claimed_status();
  await test_already_owned_claim_response_is_treated_as_verified();
  await test_claim_failure_has_detailed_reason_and_never_marks_verified();
  await test_ownership_cache_timeout_is_specific_and_does_not_claim();
  await test_empty_grant_result_is_not_persisted();
  await test_known_claim_errors_have_specific_messages_and_codes();
  await test_verification_write_failure_blocks_success_status();
  console.log("cs2-session-license tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
