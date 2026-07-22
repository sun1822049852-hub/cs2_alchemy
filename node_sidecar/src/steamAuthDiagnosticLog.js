const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {PATHS} = require("./constants");

function text(value, maxLength = 80) {
  return value === undefined || value === null
    ? ""
    : String(value).trim().slice(0, maxLength);
}

function diagnosticValue(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return value.toString();
  const normalized = text(value);
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : normalized;
}

function extractSteamResult(error) {
  let eresult = diagnosticValue(error && (error.eresult ?? error.result));
  let code = diagnosticValue(error && error.code);
  const message = text(error && error.message ? error.message : error, 500);
  const embedded = message.match(/(?:^|[\s,;])(eresult|result|code)\s*[=:]\s*(-?\d+)\b/i);
  if (embedded) {
    const value = Number(embedded[2]);
    if (embedded[1].toLowerCase() === "code") {
      if (code === null || typeof code === "string") code = value;
    } else if (eresult === null) {
      eresult = value;
    }
  }
  return {eresult, code};
}

function accountReference(username) {
  const normalized = text(username, 256).toLowerCase();
  if (!normalized) return "";
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16);
}

function buildSteamAuthDiagnosticRecord(event = {}, {now = Date.now} = {}) {
  const {eresult, code} = extractSteamResult(event.error);
  return {
    timestamp: new Date(now()).toISOString(),
    stage: text(event.stage),
    account_ref: accountReference(event.username),
    reason: text(event.reason),
    auth_state: text(event.authState),
    eresult,
    code,
    error_name: text(event.error && event.error.name),
    has_steam_guard: event.hasSteamGuard === true,
    token_cleared: event.tokenCleared === true,
    recovery_mode: text(event.recoveryMode)
  };
}

function appendSteamAuthDiagnostic(event, {
  logPath = path.join(PATHS.LOG_DIR, "steam_auth", "diagnostics.jsonl"),
  now = Date.now,
  fileSystem = fs,
  onWriteError = null
} = {}) {
  try {
    const resolvedPath = path.resolve(logPath);
    const record = buildSteamAuthDiagnosticRecord(event, {now});
    fileSystem.mkdirSync(path.dirname(resolvedPath), {recursive: true});
    fileSystem.appendFileSync(resolvedPath, `${JSON.stringify(record)}\n`, "utf8");
    return resolvedPath;
  } catch (error) {
    if (typeof onWriteError === "function") {
      onWriteError(error);
    } else {
      const errorCode = text(error && error.code) || "unknown";
      console.error(`[steam-auth] diagnostic log write failed (${errorCode})`);
    }
    return "";
  }
}

module.exports = {
  appendSteamAuthDiagnostic,
  buildSteamAuthDiagnosticRecord
};
