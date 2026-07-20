const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {stableJsonStringify, FEATURE_CODES, LICENSE_SNAPSHOT_POLICY} = require("../../shared/licensePolicy");
const {LicenseStore} = require("../src/licenseStore");
const {createLicenseEnforcer} = require("../src/licenseEnforcer");
const {createLicenseScheduler} = require("../src/licenseScheduler");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-license-scheduler-"));
}

function createSnapshot(exp, overrides = {}) {
  return {
    sub: "user_1",
    username: "member_a",
    device_id: "device_alpha",
    membership_plan: "member",
    permissions: [FEATURE_CODES.ACCOUNTS_READ],
    feature_flags: {},
    policy_version: 1,
    jti: "snap_1",
    iat: "2026-04-04T12:00:00.000Z",
    exp,
    iss: LICENSE_SNAPSHOT_POLICY.issuer,
    aud: LICENSE_SNAPSHOT_POLICY.audience,
    token_type: LICENSE_SNAPSHOT_POLICY.tokenType,
    key_id: LICENSE_SNAPSHOT_POLICY.keyId,
    ...overrides
  };
}

function createBundle(privateKey, exp, overrides = {}) {
  const snapshot = createSnapshot(exp, overrides);
  return {
    snapshot,
    signature: crypto.sign(null, Buffer.from(stableJsonStringify(snapshot)), privateKey).toString("base64")
  };
}

async function test_scheduler_refreshes_when_expiry_window_is_near() {
  const tempDir = makeTempDir();
  try {
    const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
    const store = new LicenseStore(path.join(tempDir, "license.json"));
    store.saveBundle(createBundle(privateKey, "2026-04-04T12:04:00.000Z"));

    let now = Date.parse("2026-04-04T12:00:00.000Z");
    let refreshCalls = 0;
    const scheduler = createLicenseScheduler({
      store,
      enforcer: createLicenseEnforcer({publicKey, deviceId: "device_alpha"}),
      refreshThresholdMs: 5 * 60 * 1000,
      refreshFn: async () => {
        refreshCalls += 1;
        return createBundle(privateKey, "2026-04-04T12:15:00.000Z", {jti: "snap_2"});
      },
      now: () => now
    });

    let state = scheduler.getState();
    assert.equal(state.ok, true);
    assert.equal(refreshCalls, 0);

    now = Date.parse("2026-04-04T12:01:00.000Z");
    state = await scheduler.tick();
    assert.equal(refreshCalls, 1);
    assert.equal(state.ok, true);
    assert.equal(state.snapshot.jti, "snap_2");
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

async function test_scheduler_reports_expired_state_without_refresh_fn() {
  const tempDir = makeTempDir();
  try {
    const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
    const store = new LicenseStore(path.join(tempDir, "license.json"));
    store.saveBundle(createBundle(privateKey, "2026-04-04T12:15:00.000Z"));
    const scheduler = createLicenseScheduler({
      store,
      enforcer: createLicenseEnforcer({publicKey, deviceId: "device_alpha"}),
      now: () => Date.parse("2026-04-04T12:16:00.000Z")
    });
    const state = await scheduler.tick();
    assert.equal(state.ok, false);
    assert.equal(state.code, "license_expired");
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

async function test_get_state_fails_closed_immediately_after_expiry() {
  const tempDir = makeTempDir();
  try {
    const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
    const store = new LicenseStore(path.join(tempDir, "license.json"));
    store.saveBundle(createBundle(privateKey, "2026-04-04T12:01:00.000Z"));
    let now = Date.parse("2026-04-04T12:00:30.000Z");
    const scheduler = createLicenseScheduler({
      store,
      enforcer: createLicenseEnforcer({publicKey, deviceId: "device_alpha"}),
      now: () => now
    });
    assert.equal(scheduler.getState().ok, true);
    now = Date.parse("2026-04-04T12:01:01.000Z");
    assert.equal(scheduler.getState().code, "license_expired");
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

async function test_get_state_uses_cached_verified_state_without_store_reads() {
  const tempDir = makeTempDir();
  try {
    const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
    const backingStore = new LicenseStore(path.join(tempDir, "license.json"));
    backingStore.saveBundle(createBundle(privateKey, "2026-04-04T12:01:00.000Z"));
    let readCalls = 0;
    const store = {
      read() {
        readCalls += 1;
        return backingStore.read();
      },
      saveBundle(bundle) {
        return backingStore.saveBundle(bundle);
      },
      clear() {
        return backingStore.clear();
      }
    };
    let now = Date.parse("2026-04-04T12:00:30.000Z");
    const scheduler = createLicenseScheduler({
      store,
      enforcer: createLicenseEnforcer({publicKey, deviceId: "device_alpha"}),
      now: () => now
    });

    assert.equal(readCalls, 1);
    assert.equal(scheduler.getState().ok, true);
    assert.equal(scheduler.getState().ok, true);
    assert.equal(readCalls, 1);

    now = Date.parse("2026-04-04T12:01:01.000Z");
    assert.equal(scheduler.getState().code, "license_expired");
    assert.equal(readCalls, 1);
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

async function test_refresh_is_single_flight_and_stale_result_cannot_overwrite_new_state() {
  const tempDir = makeTempDir();
  try {
    const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
    const store = new LicenseStore(path.join(tempDir, "license.json"));
    store.saveBundle({...createBundle(privateKey, "2026-04-04T12:04:00.000Z"), refresh_credential: "refresh_1"});
    let resolveRefresh;
    let refreshCalls = 0;
    const refreshResult = new Promise((resolve) => { resolveRefresh = resolve; });
    const scheduler = createLicenseScheduler({
      store,
      enforcer: createLicenseEnforcer({publicKey, deviceId: "device_alpha"}),
      refreshThresholdMs: 5 * 60 * 1000,
      refreshFn: async () => {
        refreshCalls += 1;
        return refreshResult;
      },
      now: () => Date.parse("2026-04-04T12:00:00.000Z")
    });

    const firstTick = scheduler.tick();
    const secondTick = scheduler.tick();
    assert.equal(refreshCalls, 1);
    scheduler.importBundle({...createBundle(privateKey, "2026-04-04T12:15:00.000Z", {jti: "new_login"}), refresh_credential: "refresh_new"});
    resolveRefresh({...createBundle(privateKey, "2026-04-04T12:15:00.000Z", {jti: "stale_refresh"}), refresh_credential: "refresh_stale"});
    await Promise.all([firstTick, secondTick]);
    assert.equal(store.read().snapshot.jti, "new_login");
    assert.equal(store.read().refresh_credential, "refresh_new");
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

async function test_new_generation_can_refresh_while_old_refresh_is_pending() {
  const tempDir = makeTempDir();
  try {
    const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
    const store = new LicenseStore(path.join(tempDir, "license.json"));
    store.saveBundle({...createBundle(privateKey, "2026-04-04T12:04:00.000Z"), refresh_credential: "refresh_old"});
    let resolveOldRefresh;
    const oldRefresh = new Promise((resolve) => { resolveOldRefresh = resolve; });
    let refreshCalls = 0;
    const scheduler = createLicenseScheduler({
      store,
      enforcer: createLicenseEnforcer({publicKey, deviceId: "device_alpha"}),
      refreshThresholdMs: 5 * 60 * 1000,
      refreshFn: async () => {
        refreshCalls += 1;
        if (refreshCalls === 1) return oldRefresh;
        return {...createBundle(privateKey, "2026-04-04T12:15:00.000Z", {jti: "new_refresh"}), refresh_credential: "refresh_new"};
      },
      now: () => Date.parse("2026-04-04T12:00:00.000Z")
    });

    const oldTick = scheduler.tick();
    scheduler.importBundle({...createBundle(privateKey, "2026-04-04T12:04:30.000Z", {jti: "new_login"}), refresh_credential: "refresh_login"});
    const newState = await scheduler.tick();
    assert.equal(refreshCalls, 2);
    assert.equal(newState.snapshot.jti, "new_refresh");

    resolveOldRefresh({...createBundle(privateKey, "2026-04-04T12:15:00.000Z", {jti: "stale_refresh"}), refresh_credential: "refresh_stale"});
    await oldTick;
    assert.equal(store.read().snapshot.jti, "new_refresh");
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

async function main() {
  await test_scheduler_refreshes_when_expiry_window_is_near();
  await test_scheduler_reports_expired_state_without_refresh_fn();
  await test_get_state_fails_closed_immediately_after_expiry();
  await test_get_state_uses_cached_verified_state_without_store_reads();
  await test_refresh_is_single_flight_and_stale_result_cannot_overwrite_new_state();
  await test_new_generation_can_refresh_while_old_refresh_is_pending();
  console.log("license-scheduler tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
