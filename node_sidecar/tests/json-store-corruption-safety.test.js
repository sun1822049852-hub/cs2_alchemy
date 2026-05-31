const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {readJson, writeJson} = require("../src/jsonStore");
const {TokenStore} = require("../src/tokenStore");
const {UiStateStore} = require("../src/uiStateStore");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-json-store-"));
}

function test_missing_file_returns_fallback() {
  const tempDir = makeTempDir();
  try {
    const filePath = path.join(tempDir, "missing.json");
    assert.deepEqual(readJson(filePath, {ok: true}), {ok: true});
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

function test_corrupt_login_keys_fails_before_write_and_preserves_file() {
  const tempDir = makeTempDir();
  try {
    const filePath = path.join(tempDir, "login_keys.json");
    fs.writeFileSync(filePath, "{not-json", "utf8");
    const store = new TokenStore(filePath);

    assert.throws(
      () => store.set("demo", "refresh_token"),
      /Corrupt JSON store/
    );
    assert.equal(fs.readFileSync(filePath, "utf8"), "{not-json");
    assert.equal(fs.existsSync(`${filePath}.corrupt`), false);
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

function test_direct_write_to_corrupt_login_keys_fails_and_preserves_file() {
  const tempDir = makeTempDir();
  try {
    const filePath = path.join(tempDir, "login_keys.json");
    fs.writeFileSync(filePath, "{not-json", "utf8");

    assert.throws(
      () => writeJson(filePath, {demo: "refresh_token"}),
      /Corrupt JSON store/
    );
    assert.equal(fs.readFileSync(filePath, "utf8"), "{not-json");
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

function test_corrupt_ui_state_can_fallback_but_does_not_overwrite_corrupt_file_without_backup() {
  const tempDir = makeTempDir();
  try {
    const filePath = path.join(tempDir, "inventory_ui_state.json");
    fs.writeFileSync(filePath, "{not-json", "utf8");
    const store = new UiStateStore(filePath, {viewerUsername: "member_a"});
    assert.equal(store.getLastSelected(), "");

    store.setLastSelected("steam_demo");

    const backupsDir = path.join(tempDir, "backup", "ui_state");
    const backups = fs.readdirSync(backupsDir);
    assert.equal(backups.length >= 1, true);
    assert.equal(
      backups.some((name) => fs.readFileSync(path.join(backupsDir, name), "utf8") === "{not-json"),
      true
    );

    const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.equal(saved.app_users.member_a.last_selected_username, "steam_demo");
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

function test_write_json_uses_temp_file_and_rename() {
  const tempDir = makeTempDir();
  try {
    const filePath = path.join(tempDir, "state.json");
    const operations = [];
    const fakeFs = {
      mkdirSync(...args) {
        operations.push(["mkdirSync", ...args]);
        return fs.mkdirSync(...args);
      },
      writeFileSync(target, value, encoding) {
        operations.push(["writeFileSync", path.basename(target), encoding]);
        return fs.writeFileSync(target, value, encoding);
      },
      renameSync(from, to) {
        operations.push(["renameSync", path.basename(from), path.basename(to)]);
        return fs.renameSync(from, to);
      }
    };

    writeJson(filePath, {ok: true}, {fsImpl: fakeFs});

    assert.deepEqual(
      operations.filter((item) => item[0] === "writeFileSync" || item[0] === "renameSync").map((item) => item[0]),
      ["writeFileSync", "renameSync"]
    );
    const tempWrite = operations.find((item) => item[0] === "writeFileSync");
    assert.match(tempWrite[1], /^\.state\.json\..+\.tmp$/);
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), {ok: true});
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

function main() {
  test_missing_file_returns_fallback();
  test_corrupt_login_keys_fails_before_write_and_preserves_file();
  test_direct_write_to_corrupt_login_keys_fails_and_preserves_file();
  test_corrupt_ui_state_can_fallback_but_does_not_overwrite_corrupt_file_without_backup();
  test_write_json_uses_temp_file_and_rename();
  console.log("json-store-corruption-safety tests passed");
}

main();
