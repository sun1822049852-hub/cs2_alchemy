const {PATHS} = require("./constants");
const {readJson, writeJson} = require("./jsonStore");
const {asString} = require("./utils");
const {encryptSecret, decryptSecret, isDpapiEncrypted} = require("./secretStore");

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
    const raw = normalizeState(readJson(this.filePath, {}));
    if (raw.refresh_credential && isDpapiEncrypted(raw.refresh_credential)) {
      raw.refresh_credential = decryptSecret(raw.refresh_credential);
    } else if (raw.refresh_credential) {
      this._upgradeEncryption(raw);
    }
    return raw;
  }

  saveBundle(bundle = {}) {
    const current = normalizeState(bundle);
    const toWrite = {
      ...current,
      imported_at: current.imported_at || new Date().toISOString()
    };
    if (toWrite.refresh_credential) {
      toWrite.refresh_credential = encryptSecret(toWrite.refresh_credential);
    }
    writeJson(this.filePath, toWrite);
    return this.read();
  }

  clear() {
    writeJson(this.filePath, normalizeState({}));
    return this.read();
  }

  _upgradeEncryption(state) {
    try {
      const encrypted = encryptSecret(state.refresh_credential);
      if (encrypted !== state.refresh_credential) {
        const raw = readJson(this.filePath, {});
        raw.refresh_credential = encrypted;
        writeJson(this.filePath, raw);
      }
    } catch (_) {
      // silent fallback
    }
  }
}

module.exports = {
  LicenseStore
};
