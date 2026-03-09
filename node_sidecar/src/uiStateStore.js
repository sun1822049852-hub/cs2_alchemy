const {PATHS} = require("./constants");
const {readJson, writeJson} = require("./jsonStore");
const {asString} = require("./utils");

class UiStateStore {
  constructor(filePath = PATHS.UI_STATE_FILE) {
    this.filePath = filePath;
    this.data = this._load();
  }

  _load() {
    const raw = readJson(this.filePath, {});
    const accounts = raw && typeof raw.accounts === "object" && raw.accounts ? raw.accounts : {};
    const lastSelected = asString(raw && raw.last_selected_username ? raw.last_selected_username : "").trim();
    return {
      accounts,
      last_selected_username: lastSelected
    };
  }

  save() {
    writeJson(this.filePath, this.data);
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
    this.data.accounts[key] = {
      snapshot_path: asString(snapshotPath || "").trim(),
      fetch_time: asString(fetchTime || "").trim()
    };
    this.save();
  }

  removeAccount(username) {
    const key = asString(username).trim();
    if (!key) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(this.data.accounts, key)) {
      delete this.data.accounts[key];
    }
    if (this.data.last_selected_username === key) {
      this.data.last_selected_username = "";
    }
    this.save();
  }

  setLastSelected(username) {
    this.data.last_selected_username = asString(username).trim();
    this.save();
  }

  getLastSelected() {
    return asString(this.data.last_selected_username || "").trim();
  }
}

module.exports = {
  UiStateStore
};
