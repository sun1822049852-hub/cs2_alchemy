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
    this.backupDir = path.resolve(path.dirname(this.filePath), "backup", "ui_state");
  }

  _cloneJson(value, fallback) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return fallback;
    }
  }

  _normalizeViewerBucket(value) {
    const source = value && typeof value === "object" ? value : {};
    const bucket = {...source};
    bucket.craft_assist_presets = Array.isArray(source.craft_assist_presets)
      ? this._cloneJson(source.craft_assist_presets, [])
      : [];
    bucket.tradeup_simulation_presets = Array.isArray(source.tradeup_simulation_presets)
      ? this._cloneJson(source.tradeup_simulation_presets, [])
      : [];
    bucket.last_selected_username = asString(source.last_selected_username || "").trim();
    return bucket;
  }

  _bucketHasPersistedState(value) {
    const bucket = this._normalizeViewerBucket(value);
    return bucket.craft_assist_presets.length > 0
      || bucket.tradeup_simulation_presets.length > 0
      || !!bucket.last_selected_username;
  }

  _withMergedViewerBucket(target, source) {
    const bucket = this._normalizeViewerBucket(target);
    const incoming = this._normalizeViewerBucket(source);
    bucket.craft_assist_presets = this._cloneJson(incoming.craft_assist_presets, []);
    bucket.tradeup_simulation_presets = this._cloneJson(incoming.tradeup_simulation_presets, []);
    bucket.last_selected_username = incoming.last_selected_username;
    return bucket;
  }

  _buildLegacyViewerBucket(raw) {
    const value = raw && typeof raw === "object" ? raw : {};
    return this._normalizeViewerBucket({
      craft_assist_presets: value.craft_assist_presets,
      tradeup_simulation_presets: value.tradeup_simulation_presets,
      last_selected_username: value.last_selected_username
    });
  }

  _backupFilePrefix() {
    const ext = path.extname(this.filePath) || ".json";
    const base = path.basename(this.filePath, ext);
    return `${base}.backup_`;
  }

  _backupFileName() {
    const now = new Date();
    const pad = (value, size = 2) => String(value).padStart(size, "0");
    const stamp = [
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
    return `${this._backupFilePrefix()}${stamp}.json`;
  }

  _pruneBackups(limit = 12) {
    try {
      if (!fs.existsSync(this.backupDir)) {
        return;
      }
      const prefix = this._backupFilePrefix();
      const files = fs.readdirSync(this.backupDir)
        .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
        .map((name) => {
          const full = path.join(this.backupDir, name);
          return {
            name,
            full,
            mtimeMs: fs.statSync(full).mtimeMs
          };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const extra of files.slice(Math.max(0, limit))) {
        try {
          fs.unlinkSync(extra.full);
        } catch (_) {
          // ignore backup prune failures
        }
      }
    } catch (_) {
      // ignore backup prune failures
    }
  }

  _writeBackupIfNeeded() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return;
      }
      const currentText = fs.readFileSync(this.filePath, "utf8");
      const nextText = JSON.stringify(this.data, null, 2);
      if (!asString(currentText).trim() || currentText === nextText) {
        return;
      }
      fs.mkdirSync(this.backupDir, {recursive: true});
      fs.writeFileSync(path.join(this.backupDir, this._backupFileName()), currentText, "utf8");
      this._pruneBackups();
    } catch (_) {
      // ignore backup write failures
    }
  }

  _load() {
    const raw = readJson(this.filePath, {});
    const accounts = raw && typeof raw.accounts === "object" && raw.accounts ? raw.accounts : {};
    const appUsersRaw = raw && typeof raw.app_users === "object" && raw.app_users ? raw.app_users : {};
    const appUsers = {};
    for (const [key, value] of Object.entries(appUsersRaw)) {
      const normalizedKey = asString(key).trim();
      if (!normalizedKey) {
        continue;
      }
      appUsers[normalizedKey] = this._normalizeViewerBucket(value);
    }
    const legacyBucket = this._buildLegacyViewerBucket(raw);
    if (this._bucketHasPersistedState(legacyBucket)) {
      if (!this._bucketHasPersistedState(appUsers.__global__)) {
        appUsers.__global__ = this._withMergedViewerBucket(appUsers.__global__, legacyBucket);
      }
      const viewerKey = this._viewerKey();
      if (viewerKey !== "__global__" && !Object.prototype.hasOwnProperty.call(appUsers, viewerKey)) {
        appUsers[viewerKey] = this._withMergedViewerBucket(appUsers[viewerKey], legacyBucket);
      }
    }
    const viewerKey = this._viewerKey();
    if (
      viewerKey !== "__global__"
      && !Object.prototype.hasOwnProperty.call(appUsers, viewerKey)
      && this._bucketHasPersistedState(appUsers.__global__)
    ) {
      appUsers[viewerKey] = this._withMergedViewerBucket(appUsers[viewerKey], appUsers.__global__);
    }
    return {
      accounts,
      app_users: appUsers
    };
  }

  save() {
    this._writeBackupIfNeeded();
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
    this.data.app_users[key] = this._normalizeViewerBucket(this.data.app_users[key]);
    return this.data.app_users[key];
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
