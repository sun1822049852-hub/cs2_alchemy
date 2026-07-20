const path = require("path");

function normalizeText(value) {
  return String(value || "").trim();
}

function buildDesktopLauncherEnv(baseEnv = process.env, {
  projectRoot = path.resolve(__dirname, "..", ".."),
  mode = "release"
} = {}) {
  const env = {
    ...baseEnv
  };
  const authMode = normalizeText(env.CLIENT_AUTH_MODE);
  if (!authMode) {
    env.CLIENT_AUTH_MODE = normalizeText(mode).toLowerCase() === "dev"
      ? "dev_auto_bundle"
      : "prod_login";
  }
  if (normalizeText(env.CLIENT_AUTH_MODE) === "prod_login" && !normalizeText(env.CONTROL_PLANE_BASE_URL)) {
    env.CONTROL_PLANE_BASE_URL = "http://127.0.0.1:8787";
  }
  if (normalizeText(env.CLIENT_AUTH_MODE) !== "dev_auto_bundle") {
    return env;
  }
  if (!normalizeText(env.CLIENT_DEV_LICENSE_PRIVATE_KEY_FILE)) {
    env.CLIENT_DEV_LICENSE_PRIVATE_KEY_FILE = path.join(projectRoot, "tmp", "client_license_private.pem");
  }
  if (!normalizeText(env.CONTROL_PLANE_PUBLIC_KEY_FILE)) {
    env.CONTROL_PLANE_PUBLIC_KEY_FILE = path.join(projectRoot, "keys", "client_license_public.pem");
  }
  if (!normalizeText(env.CLIENT_DEV_LICENSE_USERNAME)) {
    env.CLIENT_DEV_LICENSE_USERNAME = "dev_local";
  }
  if (!normalizeText(env.CLIENT_DEV_LICENSE_PLAN)) {
    env.CLIENT_DEV_LICENSE_PLAN = "member";
  }
  if (!normalizeText(env.CLIENT_DEV_LICENSE_TTL_MINUTES)) {
    env.CLIENT_DEV_LICENSE_TTL_MINUTES = "43200";
  }
  return env;
}

module.exports = {
  buildDesktopLauncherEnv
};
