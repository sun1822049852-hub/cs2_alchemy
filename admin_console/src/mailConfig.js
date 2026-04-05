const fs = require("node:fs");
const {PATHS, DEFAULTS} = require("./constants");
const {asString} = require("../../node_sidecar/src/utils");

function parseBoolean(value, fallback = false) {
  const text = asString(value).trim().toLowerCase();
  if (!text) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(text)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(text)) {
    return false;
  }
  return fallback;
}

function parseInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }
  return Math.trunc(number);
}

function parseEnvFile(filePath) {
  const target = asString(filePath).trim();
  if (!target || !fs.existsSync(target)) {
    return {};
  }
  const raw = fs.readFileSync(target, "utf8");
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const text = String(line || "").trim();
    if (!text || text.startsWith("#")) {
      continue;
    }
    const index = text.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const key = text.slice(0, index).trim();
    const value = text.slice(index + 1).trim();
    if (!key) {
      continue;
    }
    values[key] = value;
  }
  return values;
}

function getMailConfig({env = process.env, envFile = ""} = {}) {
  const filePath = asString(envFile || env.CONTROL_PLANE_ENV_FILE).trim() || PATHS.DEFAULT_ENV_FILE;
  const fileEnv = parseEnvFile(filePath);
  const source = {
    ...fileEnv,
    ...(env && typeof env === "object" ? env : {})
  };
  const fromAddress = asString(source.MAIL_FROM).trim();
  const smtpUser = asString(source.QQ_SMTP_USER).trim();
  const smtpPass = asString(source.QQ_SMTP_PASS).trim();
  const config = {
    envFile: filePath,
    provider: asString(source.MAIL_PROVIDER).trim() || "qq",
    fromName: asString(source.MAIL_FROM_NAME).trim() || "CS2 Tools",
    fromAddress,
    smtpHost: asString(source.QQ_SMTP_HOST).trim() || "smtp.qq.com",
    smtpPort: parseInteger(source.QQ_SMTP_PORT, 465),
    smtpSecure: parseBoolean(source.QQ_SMTP_SECURE, true),
    smtpUser,
    smtpPass,
    testTo: asString(source.MAIL_TEST_TO).trim(),
    authServiceBaseUrl: asString(source.AUTH_SERVICE_BASE_URL).trim() || `http://${DEFAULTS.AUTH_SERVICE_HOST}:${DEFAULTS.AUTH_SERVICE_PORT}`,
    authCodeTtlMinutes: parseInteger(source.AUTH_CODE_TTL_MINUTES, DEFAULTS.AUTH_CODE_TTL_MINUTES),
    authCodeCooldownSeconds: parseInteger(source.AUTH_CODE_COOLDOWN_SECONDS, DEFAULTS.AUTH_CODE_COOLDOWN_SECONDS),
    snapshotTtlMinutes: parseInteger(source.LICENSE_SNAPSHOT_TTL_MINUTES, DEFAULTS.SNAPSHOT_TTL_MINUTES),
    refreshSessionDays: parseInteger(source.AUTH_REFRESH_SESSION_DAYS, DEFAULTS.REFRESH_SESSION_DAYS),
    adminSessionHours: parseInteger(source.ADMIN_SESSION_HOURS, DEFAULTS.ADMIN_SESSION_HOURS),
    privateKeyFile: asString(source.CONTROL_PLANE_PRIVATE_KEY_FILE).trim() || PATHS.DEFAULT_PRIVATE_KEY_FILE,
    host: asString(source.AUTH_SERVICE_HOST).trim() || DEFAULTS.AUTH_SERVICE_HOST,
    port: parseInteger(source.AUTH_SERVICE_PORT, DEFAULTS.AUTH_SERVICE_PORT)
  };
  return {
    ...config,
    configured: !!(config.fromAddress && config.smtpUser && config.smtpPass)
  };
}

module.exports = {
  getMailConfig
};
