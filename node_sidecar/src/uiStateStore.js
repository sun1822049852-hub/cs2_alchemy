const fs = require("fs");
const path = require("path");
const {PATHS} = require("./constants");
const {readJson, writeJson} = require("./jsonStore");
const {asString} = require("./utils");

class UiStateStore {
  constructor(filePath = PATHS.UI_STATE_FILE, options = {}) {
    this.filePath = filePath;
    this.viewerUsername = asString(options && options.viewerUsername ? options.viewerUsername : "").trim();
    this.data = this._load();
    this.processedDir = path.resolve(PATHS.PROCESSED_DIR);
  }

  _load() {
    const raw = readJson(this.filePath, {});
    const accounts = raw && typeof raw.accounts === "object" && raw.accounts ? raw.accounts : {};
    const appUsers = raw && typeof raw.app_users === "object" && raw.app_users ? raw.app_users : {};
    return {
      accounts,
      app_users: appUsers
    };
  }

  save() {
    writeJson(this.filePath, this.data);
  }

  _viewerKey() {
    return this.viewerUsername || "__global__";
  }

  _viewerBucket() {
    const key = this._viewerKey();
    if (!this.data.app_users || typeof this.data.app_users !== "object") {
      this.data.app_users = {};
    }
    if (!this.data.app_users[key] || typeof this.data.app_users[key] !== "object") {
      this.data.app_users[key] = {};
    }
    const bucket = this.data.app_users[key];
    if (!Array.isArray(bucket.craft_assist_presets)) {
      bucket.craft_assist_presets = [];
    }
    if (!Array.isArray(bucket.tradeup_simulation_presets)) {
      bucket.tradeup_simulation_presets = [];
    }
    if (typeof bucket.last_selected_username !== "string") {
      bucket.last_selected_username = "";
    }
    return bucket;
  }

  _normalizeSnapshotPath(filePath) {
    const text = asString(filePath).trim();
    if (!text) return "";
    return path.resolve(text);
  }

  _isManagedProcessedSnapshot(filePath) {
    const full = this._normalizeSnapshotPath(filePath);
    if (!full) return false;
    const normalizedBase = this.processedDir.endsWith(path.sep) ? this.processedDir : `${this.processedDir}${path.sep}`;
    const fullCmp = process.platform === "win32" ? full.toLowerCase() : full;
    const baseCmp = process.platform === "win32" ? normalizedBase.toLowerCase() : normalizedBase;
    return fullCmp.startsWith(baseCmp);
  }

  _isSnapshotReferencedByOtherAccount(snapshotPath, excludeUsername) {
    const target = this._normalizeSnapshotPath(snapshotPath);
    const excluded = asString(excludeUsername).trim();
    if (!target) return false;
    const targetCmp = process.platform === "win32" ? target.toLowerCase() : target;
    for (const [username, item] of Object.entries(this.data.accounts || {})) {
      if (username === excluded) continue;
      const ref = this._normalizeSnapshotPath(item && item.snapshot_path ? item.snapshot_path : "");
      const refCmp = process.platform === "win32" ? ref.toLowerCase() : ref;
      if (refCmp && refCmp === targetCmp) return true;
    }
    return false;
  }

  _cleanupOldSnapshot(snapshotPath, excludeUsername) {
    const full = this._normalizeSnapshotPath(snapshotPath);
    if (!full) return;
    if (!this._isManagedProcessedSnapshot(full)) return;
    if (this._isSnapshotReferencedByOtherAccount(full, excludeUsername)) return;
    try {
      if (fs.existsSync(full)) fs.unlinkSync(full);
    } catch (_) {
      // ignore cleanup errors
    }
  }

  getAccount(username) {
    const key = asString(username).trim();
    if (!key) {
      return null;
    }
    const item = this.data.accounts[key];
    if (!item || typeof item !== "object") {
      return null;
    }
    return {
      snapshot_path: asString(item.snapshot_path || "").trim(),
      fetch_time: asString(item.fetch_time || "").trim()
    };
  }

  setAccountSnapshot(username, snapshotPath, fetchTime) {
    const key = asString(username).trim();
    if (!key) {
      return;
    }
    const oldPath = asString(this.data.accounts[key] && this.data.accounts[key].snapshot_path ? this.data.accounts[key].snapshot_path : "").trim();
    const nextPath = asString(snapshotPath || "").trim();
    this.data.accounts[key] = {
      snapshot_path: nextPath,
      fetch_time: asString(fetchTime || "").trim()
    };
    this.save();
    if (oldPath && oldPath !== nextPath) {
      this._cleanupOldSnapshot(oldPath, key);
    }
  }

  removeAccount(username) {
    const key = asString(username).trim();
    if (!key) {
      return;
    }
    const oldPath = asString(this.data.accounts[key] && this.data.accounts[key].snapshot_path ? this.data.accounts[key].snapshot_path : "").trim();
    if (Object.prototype.hasOwnProperty.call(this.data.accounts, key)) {
      delete this.data.accounts[key];
    }
    if (this.data.last_selected_username === key) {
      this.data.last_selected_username = "";
    }
    this.save();
    if (oldPath) {
      this._cleanupOldSnapshot(oldPath, key);
    }
  }

  setLastSelected(username) {
    this._viewerBucket().last_selected_username = asString(username).trim();
    this.save();
  }

  getLastSelected() {
    return asString(this._viewerBucket().last_selected_username || "").trim();
  }

  getCraftAssistPresets() {
    try {
      const list = Array.isArray(this._viewerBucket().craft_assist_presets) ? this._viewerBucket().craft_assist_presets : [];
      return JSON.parse(JSON.stringify(list));
    } catch (_) {
      return [];
    }
  }

  setCraftAssistPresets(presets) {
    this._viewerBucket().craft_assist_presets = Array.isArray(presets) ? presets : [];
    this.save();
  }

  getTradeupSimulationPresets() {
    try {
      const list = Array.isArray(this._viewerBucket().tradeup_simulation_presets)
        ? this._viewerBucket().tradeup_simulation_presets
        : [];
      return JSON.parse(JSON.stringify(list));
    } catch (_) {
      return [];
    }
  }

  setTradeupSimulationPresets(presets) {
    this._viewerBucket().tradeup_simulation_presets = Array.isArray(presets) ? presets : [];
    this.save();
  }
}

module.exports = {
  UiStateStore
};
