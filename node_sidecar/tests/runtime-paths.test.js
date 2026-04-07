const assert = require("node:assert/strict");
const path = require("node:path");

const {
  PATHS,
  resolveRuntimePaths,
  configureRuntimePaths
} = require("../src/constants");

function test_dev_mode_paths_stay_in_project_root() {
  const projectRoot = path.resolve("C:/tmp/cs2-alchemy-dev");
  const userDataDir = path.resolve("C:/tmp/cs2-alchemy-user-data");
  const paths = resolveRuntimePaths({
    isPackaged: false,
    projectRoot,
    userDataDir
  });

  assert.equal(paths.ROOT_DIR, projectRoot);
  assert.equal(paths.LICENSE_STATE_FILE, path.join(projectRoot, "client_license_state.json"));
  assert.equal(paths.UI_STATE_FILE, path.join(projectRoot, "inventory_ui_state.json"));
  assert.equal(paths.SKIN_DB_FILE, path.join(projectRoot, "csgo_skins.db"));
}

function test_packaged_mode_paths_move_to_user_data() {
  const projectRoot = path.resolve("C:/tmp/cs2-alchemy-app");
  const userDataDir = path.resolve("C:/tmp/cs2-alchemy-user-data");
  const paths = resolveRuntimePaths({
    isPackaged: true,
    projectRoot,
    userDataDir
  });

  assert.equal(paths.ROOT_DIR, projectRoot);
  assert.equal(paths.LICENSE_STATE_FILE, path.join(userDataDir, "client_license_state.json"));
  assert.equal(paths.UI_STATE_FILE, path.join(userDataDir, "inventory_ui_state.json"));
  assert.equal(paths.SKIN_DB_FILE, path.join(userDataDir, "csgo_skins.db"));
  assert.equal(paths.MACHINE_ID_FILE, path.join(userDataDir, "machine_id.bin"));
}

function test_configure_runtime_paths_mutates_shared_paths() {
  const original = {
    LICENSE_STATE_FILE: PATHS.LICENSE_STATE_FILE,
    UI_STATE_FILE: PATHS.UI_STATE_FILE,
    SKIN_DB_FILE: PATHS.SKIN_DB_FILE,
    MACHINE_ID_FILE: PATHS.MACHINE_ID_FILE
  };
  const projectRoot = path.resolve("C:/tmp/cs2-alchemy-app");
  const userDataDir = path.resolve("C:/tmp/cs2-alchemy-user-data");

  try {
    const configured = configureRuntimePaths({
      isPackaged: true,
      projectRoot,
      userDataDir
    });
    assert.equal(PATHS.LICENSE_STATE_FILE, configured.LICENSE_STATE_FILE);
    assert.equal(PATHS.UI_STATE_FILE, configured.UI_STATE_FILE);
    assert.equal(PATHS.SKIN_DB_FILE, configured.SKIN_DB_FILE);
    assert.equal(PATHS.MACHINE_ID_FILE, configured.MACHINE_ID_FILE);
  } finally {
    Object.assign(PATHS, original);
  }
}

function main() {
  test_dev_mode_paths_stay_in_project_root();
  test_packaged_mode_paths_move_to_user_data();
  test_configure_runtime_paths_mutates_shared_paths();
  console.log("runtime-paths tests passed");
}

main();
