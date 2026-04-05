const {PATHS} = require("./constants");
const {readJson, writeJson} = require("./jsonStore");
const {asString} = require("./utils");

function normalizeState(value) {
  const data = value && typeof value === "object" ? value : {};
  return {
    snapshot: data.snapshot && typeof data.snapshot === "object" ? data.snapshot : null,
    signature: asString(data.signature).trim(),
    refresh_credential: asString(data.refresh_credential).trim(),
    imported_at: asString(data.imported_at).trim(),
    source: asString(data.source).trim()
  };
}

class LicenseStore {
  constructor(filePath = PATHS.LICENSE_STATE_FILE) {
    this.filePath = filePath;
  }

  read() {
    return normalizeState(readJson(this.filePath, {}));
  }

  saveBundle(bundle = {}) {
    const current = normalizeState(bundle);
    writeJson(this.filePath, {
      ...current,
      imported_at: current.imported_at || new Date().toISOString()
    });
    return this.read();
  }

  clear() {
    writeJson(this.filePath, normalizeState({}));
    return this.read();
  }
}

module.exports = {
  LicenseStore
};
