const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {stableJsonStringify, FEATURE_CODES} = require("../../shared/licensePolicy");
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
    membership_plan: "pro",
    permissions: [FEATURE_CODES.ACCOUNTS_READ],
    feature_flags: {},
    policy_version: 1,
    jti: "snap_1",
    iat: "2026-04-04T12:00:00.000Z",
    exp,
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

async function main() {
  await test_scheduler_refreshes_when_expiry_window_is_near();
  await test_scheduler_reports_expired_state_without_refresh_fn();
  console.log("license-scheduler tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
