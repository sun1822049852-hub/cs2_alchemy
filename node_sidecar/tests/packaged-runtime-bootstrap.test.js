const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const {
  ensurePackagedRuntimeFiles,
  resolvePackagedDefaultControlPlaneBaseUrl
} = require("../src/packagedRuntimeBootstrap");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function test_resolve_packaged_default_control_plane_base_url_reads_packaged_client_config() {
  const rootDir = makeTempDir("cs2-packaged-root-");
  try {
    const configPath = path.join(rootDir, "client_config.json");
    fs.writeFileSync(configPath, JSON.stringify({
      control_plane_base_url: "http://127.0.0.1:8787"
    }, null, 2), "utf8");
    assert.equal(
      resolvePackagedDefaultControlPlaneBaseUrl({rootDir}),
      "http://127.0.0.1:8787"
    );
  } finally {
    fs.rmSync(rootDir, {recursive: true, force: true});
  }
}

function test_ensure_packaged_runtime_files_copies_seed_resources_to_writable_root() {
  const rootDir = makeTempDir("cs2-packaged-root-");
  const writableRoot = makeTempDir("cs2-packaged-user-");
  try {
    fs.writeFileSync(path.join(rootDir, "client_config.json"), JSON.stringify({
      control_plane_base_url: "http://127.0.0.1:8787"
    }, null, 2), "utf8");
    fs.writeFileSync(path.join(rootDir, "schema_cache.json"), JSON.stringify({
      weapons: {ak47: {id: 7}}
    }, null, 2), "utf8");
    fs.writeFileSync(path.join(rootDir, "csgo_skins.db"), "db-seed", "utf8");

    const seeded = ensurePackagedRuntimeFiles({
      isPackaged: true,
      rootDir,
      writableRoot
    });

    assert.deepEqual(
      seeded.map((item) => path.basename(item.targetPath)).sort(),
      ["client_config.json", "csgo_skins.db", "schema_cache.json"]
    );
    assert.equal(
      readText(path.join(writableRoot, "client_config.json")).includes("127.0.0.1"),
      true
    );
    assert.equal(
      readText(path.join(writableRoot, "schema_cache.json")).includes("\"weapons\""),
      true
    );
    assert.equal(
      readText(path.join(writableRoot, "csgo_skins.db")),
      "db-seed"
    );
  } finally {
    fs.rmSync(rootDir, {recursive: true, force: true});
    fs.rmSync(writableRoot, {recursive: true, force: true});
  }
}

function test_ensure_packaged_runtime_files_preserves_existing_user_config() {
  const rootDir = makeTempDir("cs2-packaged-root-");
  const writableRoot = makeTempDir("cs2-packaged-user-");
  try {
    fs.writeFileSync(path.join(rootDir, "client_config.json"), JSON.stringify({
      control_plane_base_url: "http://127.0.0.1:8787"
    }, null, 2), "utf8");
    fs.writeFileSync(path.join(writableRoot, "client_config.json"), JSON.stringify({
      control_plane_base_url: "https://custom.example.com"
    }, null, 2), "utf8");

    ensurePackagedRuntimeFiles({
      isPackaged: true,
      rootDir,
      writableRoot
    });

    assert.equal(
      readText(path.join(writableRoot, "client_config.json")).includes("custom.example.com"),
      true
    );
  } finally {
    fs.rmSync(rootDir, {recursive: true, force: true});
    fs.rmSync(writableRoot, {recursive: true, force: true});
  }
}

function main() {
  test_resolve_packaged_default_control_plane_base_url_reads_packaged_client_config();
  test_ensure_packaged_runtime_files_copies_seed_resources_to_writable_root();
  test_ensure_packaged_runtime_files_preserves_existing_user_config();
  console.log("packaged-runtime-bootstrap tests passed");
}

main();
