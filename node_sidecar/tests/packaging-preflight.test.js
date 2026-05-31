const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = path.resolve(__dirname, "../scripts/checkPackagingResources.js");
const VPK_PACKAGE_NAME = "@lowly1337/vpk";

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.copyFileSync(source, target);
}

function makePackagingFixture({omit = []} = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cs2-packaging-preflight-"));
  const omitted = new Set(omit);
  const files = [
    "node_sidecar/electron-builder.yml",
    "node_sidecar/package.json",
    "node_sidecar/build/client_config.release.json",
    "node_sidecar/build/icon.ico",
    "node_sidecar/build/csgo_skins.seed.db",
    "node_sidecar/build/schema_cache.seed.json",
    "shared/licensePolicy.js",
    "shared/featureCodes.js",
    "shared/craftPermitPolicy.js",
    "keys/client_license_public.pem"
  ];

  for (const relativePath of files) {
    if (!omitted.has(relativePath)) {
      copyFile(path.join(PROJECT_ROOT, relativePath), path.join(tempRoot, relativePath));
    }
  }
  return tempRoot;
}

function runPreflight(projectRoot) {
  return spawnSync(process.execPath, [SCRIPT_PATH, "--project-root", projectRoot], {
    encoding: "utf8"
  });
}

function writeJson(relativeRoot, relativePath, value) {
  const target = path.join(relativeRoot, relativePath);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function test_packaging_preflight_rejects_vpk_production_dependency() {
  const tempRoot = makePackagingFixture();
  try {
    const packagePath = path.join(tempRoot, "node_sidecar/package.json");
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    packageJson.dependencies = {
      ...(packageJson.dependencies || {}),
      [VPK_PACKAGE_NAME]: "^0.2.6"
    };
    delete (packageJson.devDependencies || {})[VPK_PACKAGE_NAME];
    writeJson(tempRoot, "node_sidecar/package.json", packageJson);

    const result = runPreflight(tempRoot);
    assert.notEqual(result.status, 0, "preflight should fail when VPK is a production dependency");
    assert.match(result.stderr, /VPK development tooling must not be a production dependency/);
  } finally {
    fs.rmSync(tempRoot, {recursive: true, force: true});
  }
}

function test_packaging_preflight_rejects_packaged_vpk_dev_sources() {
  const tempRoot = makePackagingFixture();
  try {
    const builderPath = path.join(tempRoot, "node_sidecar/electron-builder.yml");
    let configText = fs.readFileSync(builderPath, "utf8");
    configText = configText.replace(/\r?\n\s*-\s*["']?!src\/vpkDevTools\.js["']?/g, "");
    configText = configText.replace(/\r?\n\s*-\s*["']?!src\/vpkDevCli\.js["']?/g, "");
    fs.writeFileSync(builderPath, configText);

    const result = runPreflight(tempRoot);
    assert.notEqual(result.status, 0, "preflight should fail when VPK dev source files can be packaged");
    assert.match(result.stderr, /electron-builder\.yml must exclude VPK development source files/);
  } finally {
    fs.rmSync(tempRoot, {recursive: true, force: true});
  }
}

function test_packaging_preflight_fails_clearly_when_schema_seed_is_missing() {
  const tempRoot = makePackagingFixture({
    omit: ["node_sidecar/build/schema_cache.seed.json"]
  });
  try {
    const result = runPreflight(tempRoot);
    assert.notEqual(result.status, 0, "preflight should fail when schema seed is missing");
    assert.match(result.stderr, /Missing packaging resource/);
    assert.match(result.stderr, /node_sidecar[\\/]build[\\/]schema_cache\.seed\.json/);
    assert.doesNotMatch(result.stderr, /schema_cache\.json\)/, "error should point at the tracked seed resource, not the root runtime file");
  } finally {
    fs.rmSync(tempRoot, {recursive: true, force: true});
  }
}

function test_packaging_preflight_accepts_tracked_seed_resources() {
  const tempRoot = makePackagingFixture();
  try {
    const result = runPreflight(tempRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Packaging resources OK/);
  } finally {
    fs.rmSync(tempRoot, {recursive: true, force: true});
  }
}

function main() {
  test_packaging_preflight_rejects_vpk_production_dependency();
  test_packaging_preflight_rejects_packaged_vpk_dev_sources();
  test_packaging_preflight_fails_clearly_when_schema_seed_is_missing();
  test_packaging_preflight_accepts_tracked_seed_resources();
  console.log("packaging-preflight tests passed");
}

main();
