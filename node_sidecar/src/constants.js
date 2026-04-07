const path = require("path");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "..");

function resolveRuntimePaths({
  projectRoot = DEFAULT_PROJECT_ROOT,
  userDataDir = projectRoot,
  isPackaged = false
} = {}) {
  const rootDir = path.resolve(projectRoot);
  const writableRoot = path.resolve(isPackaged ? (userDataDir || projectRoot) : projectRoot);
  const logDir = path.join(writableRoot, "logs");
  return {
    ROOT_DIR: rootDir,
    WRITABLE_ROOT: writableRoot,
    LOG_DIR: logDir,
    PROCESSED_DIR: path.join(logDir, "processed_inventory"),
    RAW_DIR: path.join(logDir, "raw_inventory"),
    COMPONENT_DIR: path.join(logDir, "component_contents"),
    MACHINE_ID_FILE: path.join(writableRoot, "machine_id.bin"),
    ACCOUNTS_FILE: path.join(writableRoot, "accounts.json"),
    TOKENS_FILE: path.join(writableRoot, "login_keys.json"),
    CLIENT_CONFIG_FILE: path.join(writableRoot, "client_config.json"),
    LICENSE_STATE_FILE: path.join(writableRoot, "client_license_state.json"),
    UI_STATE_FILE: path.join(writableRoot, "inventory_ui_state.json"),
    SCHEMA_CACHE_FILE: path.join(writableRoot, "schema_cache.json"),
    SKIN_DB_FILE: path.join(writableRoot, "csgo_skins.db")
  };
}

const PATHS = resolveRuntimePaths();

function configureRuntimePaths(options = {}) {
  Object.assign(PATHS, resolveRuntimePaths(options));
  return PATHS;
}

const QUALITY_MAP = {
  1: "Genuine",
  4: "Normal",
  9: "StatTrak",
  11: "Souvenir"
};

const RARITY_MAP = {
  1: "Consumer",
  2: "Industrial",
  3: "Mil-Spec",
  4: "Restricted",
  5: "Classified",
  6: "Covert",
  7: "Contraband"
};

const STORAGE_UNIT_DEF_INDEX = 1201;
const STORAGE_UNIT_CAPACITY = 1000;

module.exports = {
  PATHS,
  resolveRuntimePaths,
  configureRuntimePaths,
  QUALITY_MAP,
  RARITY_MAP,
  STORAGE_UNIT_DEF_INDEX,
  STORAGE_UNIT_CAPACITY
};
