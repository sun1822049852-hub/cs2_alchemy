const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const LOG_DIR = path.join(ROOT_DIR, "logs");
const PROCESSED_DIR = path.join(LOG_DIR, "processed_inventory");
const RAW_DIR = path.join(LOG_DIR, "raw_inventory");
const COMPONENT_DIR = path.join(LOG_DIR, "component_contents");

const PATHS = {
  ROOT_DIR,
  LOG_DIR,
  PROCESSED_DIR,
  RAW_DIR,
  COMPONENT_DIR,
  ACCOUNTS_FILE: path.join(ROOT_DIR, "accounts.json"),
  TOKENS_FILE: path.join(ROOT_DIR, "login_keys.json"),
  UI_STATE_FILE: path.join(ROOT_DIR, "inventory_ui_state.json"),
  SCHEMA_CACHE_FILE: path.join(ROOT_DIR, "schema_cache.json"),
  SKIN_DB_FILE: path.join(ROOT_DIR, "csgo_skins.db")
};

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

module.exports = {
  PATHS,
  QUALITY_MAP,
  RARITY_MAP,
  STORAGE_UNIT_DEF_INDEX
};
