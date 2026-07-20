const fs = require("node:fs");
const path = require("node:path");

const {PATHS} = require("./constants");

const DEV_FILE_LOG_ENV = "CS2_DEV_FILE_LOG";
const DEFAULT_RETENTION_DAYS = 3;
const DEFAULT_MAX_MESSAGE_LENGTH = 16 * 1024;
const DEFAULT_MAX_SCOPE_LENGTH = 256;
const LOG_FILE_PATTERN = /^backend-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const SENSITIVE_FIELDS = [
  "password",
  "passwd",
  "pwd",
  "token",
  "access[_-]?token",
  "refresh[_-]?token",
  "authorization",
  "cookie",
  "set[_-]?cookie",
  "steam[_-]?login[_-]?secure",
  "login[_-]?key",
  "session[_-]?id",
  "shared[_-]?secret",
  "identity[_-]?secret",
  "revocation[_-]?code",
  "mafile[_-]?content",
  "guard[_-]?code",
  "two[_-]?factor[_-]?code",
  "one[_-]?time[_-]?code",
  "email[_-]?code",
  "device[_-]?code",
  "totp",
  "client[_-]?secret",
  "api[_-]?key"
];
const SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(
  `(^|[^A-Za-z0-9_])((?:["']?)(?:${SENSITIVE_FIELDS.join("|")})(?:["']?)\\s*(?:=|:)\\s*)` +
    `(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\s,;&}\\]]+)`,
  "gi"
);
const BEARER_PATTERN = /(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi;

function isDevFileLogEnabled(env = process.env) {
  return Boolean(env) && env[DEV_FILE_LOG_ENV] === "1";
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function shiftLocalDate(value, days) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12, 0, 0, 0);
}

function redactSensitiveText(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return text
    .replace(BEARER_PATTERN, "$1[REDACTED]")
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, "$1$2[REDACTED]");
}

function truncateText(value, maxLength) {
  const text = String(value || "");
  const limit = Math.max(1, Number(maxLength) || 1);
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 12))}[TRUNCATED]`;
}

class DevFileLogSink {
  constructor({
    env = process.env,
    logDir = null,
    now = () => new Date(),
    pid = process.pid,
    retentionDays = DEFAULT_RETENTION_DAYS,
    maxMessageLength = DEFAULT_MAX_MESSAGE_LENGTH,
    maxScopeLength = DEFAULT_MAX_SCOPE_LENGTH,
    fsImpl = fs,
    onError = null
  } = {}) {
    this.enabled = isDevFileLogEnabled(env);
    this.logDir = logDir ? path.resolve(logDir) : null;
    this.now = typeof now === "function" ? now : () => new Date();
    this.pid = Number.isFinite(Number(pid)) ? Number(pid) : process.pid;
    this.retentionDays = Math.max(1, Math.trunc(Number(retentionDays) || DEFAULT_RETENTION_DAYS));
    this.maxMessageLength = Math.max(1, Number(maxMessageLength) || DEFAULT_MAX_MESSAGE_LENGTH);
    this.maxScopeLength = Math.max(1, Number(maxScopeLength) || DEFAULT_MAX_SCOPE_LENGTH);
    this.fs = fsImpl;
    this.onError = typeof onError === "function" ? onError : null;
    this.preparedKey = "";
    this.lastErrorKey = "";
  }

  _resolveLogDir() {
    return this.logDir || path.join(PATHS.LOG_DIR, "dev");
  }

  _reportError(error, dateKey) {
    if (!this.onError || this.lastErrorKey === dateKey) {
      return;
    }
    this.lastErrorKey = dateKey;
    try {
      this.onError(error);
    } catch (_) {
      // Logging must never change application control flow.
    }
  }

  _cleanup(logDir, now, dateKey) {
    const allowed = new Set();
    for (let offset = 0; offset < this.retentionDays; offset += 1) {
      allowed.add(localDateKey(shiftLocalDate(now, -offset)));
    }
    let firstError = null;
    for (const name of this.fs.readdirSync(logDir)) {
      const match = LOG_FILE_PATTERN.exec(name);
      if (!match || allowed.has(match[1])) {
        continue;
      }
      try {
        this.fs.unlinkSync(path.join(logDir, name));
      } catch (error) {
        firstError = firstError || error;
      }
    }
    if (firstError) {
      this._reportError(firstError, dateKey);
    }
  }

  _prepare(logDir, now, dateKey) {
    const preparedKey = `${logDir}|${dateKey}`;
    if (this.preparedKey === preparedKey) {
      return;
    }
    this.fs.mkdirSync(logDir, {recursive: true});
    this._cleanup(logDir, now, dateKey);
    this.preparedKey = preparedKey;
  }

  write({level = "INFO", scope = "app", message = ""} = {}) {
    if (!this.enabled) {
      return false;
    }
    const now = this.now();
    const dateKey = localDateKey(now);
    const logDir = this._resolveLogDir();
    try {
      this._prepare(logDir, now, dateKey);
      const entry = {
        timestamp: now.toISOString(),
        pid: this.pid,
        level: truncateText(redactSensitiveText(level).toUpperCase(), 16),
        scope: truncateText(redactSensitiveText(scope), this.maxScopeLength),
        message: truncateText(redactSensitiveText(message), this.maxMessageLength)
      };
      const filePath = path.join(logDir, `backend-${dateKey}.jsonl`);
      this.fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");
      return true;
    } catch (error) {
      this._reportError(error, dateKey);
      return false;
    }
  }
}

module.exports = {
  DEV_FILE_LOG_ENV,
  DevFileLogSink,
  isDevFileLogEnabled,
  localDateKey,
  redactSensitiveText
};
