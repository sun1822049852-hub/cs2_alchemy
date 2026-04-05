const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");

const PATHS = {
  ROOT_DIR,
  DEFAULT_ENV_FILE: path.join(ROOT_DIR, "tmp", "qq-mail.local.env"),
  DEFAULT_DB_FILE: path.join(ROOT_DIR, "tmp", "control_plane_auth.db"),
  DEFAULT_PRIVATE_KEY_FILE: path.join(ROOT_DIR, "tmp", "client_license_private.pem"),
  UI_DIR: path.join(ROOT_DIR, "admin_console", "ui")
};

const DEFAULTS = {
  AUTH_SERVICE_HOST: "127.0.0.1",
  AUTH_SERVICE_PORT: 8787,
  AUTH_CODE_TTL_MINUTES: 5,
  AUTH_CODE_COOLDOWN_SECONDS: 60,
  SNAPSHOT_TTL_MINUTES: 15,
  REFRESH_SESSION_DAYS: 30,
  ADMIN_SESSION_HOURS: 12
};

module.exports = {
  PATHS,
  DEFAULTS
};
