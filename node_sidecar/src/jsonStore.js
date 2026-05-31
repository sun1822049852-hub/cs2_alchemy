const fs = require("fs");
const path = require("path");

function ensureDirFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
}

class JsonStoreCorruptionError extends Error {
  constructor(filePath, cause) {
    super(`Corrupt JSON store: ${filePath}`);
    this.name = "JsonStoreCorruptionError";
    this.filePath = filePath;
    this.cause = cause;
  }
}

function isJsonParseError(err) {
  return err instanceof SyntaxError;
}

function shouldThrowOnCorrupt(filePath, throwOnCorrupt) {
  if (typeof throwOnCorrupt === "boolean") {
    return throwOnCorrupt;
  }
  return path.basename(String(filePath || "")).toLowerCase() === "login_keys.json";
}

function readJson(filePath, fallbackValue, options = {}) {
  const fsImpl = options.fsImpl || fs;
  try {
    if (!fsImpl.existsSync(filePath)) {
      return fallbackValue;
    }
    const text = fsImpl.readFileSync(filePath, "utf8");
    return JSON.parse(text);
  } catch (err) {
    if (isJsonParseError(err) && shouldThrowOnCorrupt(filePath, options.throwOnCorrupt)) {
      throw new JsonStoreCorruptionError(filePath, err);
    }
    if (err && err.code === "ENOENT") {
      return fallbackValue;
    }
    return fallbackValue;
  }
}

function tempFilePath(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const unique = `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
  return path.join(dir, `.${base}.${unique}.tmp`);
}

function timestampForFileName() {
  const now = new Date();
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "_",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    "_",
    pad(now.getMilliseconds(), 3)
  ].join("");
}

function corruptBackupPath(filePath) {
  const ext = path.extname(filePath) || ".json";
  const base = path.basename(filePath, ext);
  if (path.basename(filePath).toLowerCase() === "inventory_ui_state.json") {
    return path.join(
      path.dirname(filePath),
      "backup",
      "ui_state",
      `${base}.corrupt_${timestampForFileName()}${ext}`
    );
  }
  return path.join(path.dirname(filePath), `${base}.corrupt_${timestampForFileName()}${ext}`);
}

function detectCorruptJson(filePath, fsImpl) {
  try {
    if (!fsImpl.existsSync(filePath)) {
      return null;
    }
    const text = fsImpl.readFileSync(filePath, "utf8");
    JSON.parse(text);
    return null;
  } catch (err) {
    if (!isJsonParseError(err)) {
      return null;
    }
    return err;
  }
}

function handleCorruptJsonBeforeOverwrite(filePath, fsImpl, options = {}) {
  const err = detectCorruptJson(filePath, fsImpl);
  if (!err) {
    return "";
  }
  if (shouldThrowOnCorrupt(filePath, options.throwOnCorrupt)) {
    throw new JsonStoreCorruptionError(filePath, err);
  }
  try {
    const backupPath = corruptBackupPath(filePath);
    ensureDirForWithFs(backupPath, fsImpl);
    fsImpl.writeFileSync(backupPath, fsImpl.readFileSync(filePath, "utf8"), "utf8");
    return backupPath;
  } catch (_) {
    return "";
  }
}

function writeJson(filePath, value, options = {}) {
  const fsImpl = options.fsImpl || fs;
  ensureDirForWithFs(filePath, fsImpl);
  handleCorruptJsonBeforeOverwrite(filePath, fsImpl, options);
  const tempPath = tempFilePath(filePath);
  const text = JSON.stringify(value, null, 2);
  try {
    fsImpl.writeFileSync(tempPath, text, "utf8");
    fsImpl.renameSync(tempPath, filePath);
  } catch (err) {
    try {
      if (fsImpl.existsSync(tempPath)) {
        fsImpl.unlinkSync(tempPath);
      }
    } catch (_) {
      // ignore temp cleanup failures
    }
    throw err;
  }
}

function ensureDirForWithFs(filePath, fsImpl) {
  fsImpl.mkdirSync(path.dirname(filePath), {recursive: true});
}

module.exports = {
  readJson,
  writeJson,
  ensureDirFor,
  JsonStoreCorruptionError
};
