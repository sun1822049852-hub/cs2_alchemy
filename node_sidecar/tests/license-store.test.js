const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {LicenseStore} = require("../src/licenseStore");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-license-store-"));
}

function test_save_read_and_clear_bundle() {
  const tempDir = makeTempDir();
  try {
    const filePath = path.join(tempDir, "license_state.json");
    const store = new LicenseStore(filePath);
    store.saveBundle({
      snapshot: {
        sub: "user_1",
        username: "member_a",
        exp: "2026-04-04T12:15:00.000Z"
      },
      signature: "sig_1",
      refresh_credential: "refresh_1",
      source: "manual"
    });
    const state = store.read();
    assert.equal(state.signature, "sig_1");
    assert.equal(state.refresh_credential, "refresh_1");
    assert.equal(state.snapshot.username, "member_a");

    store.clear();
    const cleared = store.read();
    assert.equal(cleared.signature, "");
    assert.equal(cleared.refresh_credential, "");
    assert.equal(cleared.snapshot, null);
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

function main() {
  test_save_read_and_clear_bundle();
  console.log("license-store tests passed");
}

main();
