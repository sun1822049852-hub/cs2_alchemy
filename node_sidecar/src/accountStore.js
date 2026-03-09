const {PATHS} = require("./constants");
const {readJson, writeJson} = require("./jsonStore");
const {asString} = require("./utils");

class AccountStore {
  constructor(filePath = PATHS.ACCOUNTS_FILE) {
    this.filePath = filePath;
    this.data = this._load();
  }

  _load() {
    const raw = readJson(this.filePath, {accounts: {}, active: null});
    const accounts = {};
    const source = raw && typeof raw === "object" ? raw.accounts : {};
    if (source && typeof source === "object") {
      for (const [username, info] of Object.entries(source)) {
        const value = info && typeof info === "object" ? info : {};
        accounts[asString(username)] = {
          password: asString(value.password || ""),
          remark: asString(value.remark || username)
        };
      }
    }
    const active = asString(raw && raw.active ? raw.active : "");
    return {
      accounts,
      active: active && accounts[active] ? active : null
    };
  }

  save() {
    writeJson(this.filePath, this.data);
  }

  list() {
    const rows = [];
    for (const [username, info] of Object.entries(this.data.accounts)) {
      rows.push({
        username,
        password: asString(info.password || ""),
        remark: asString(info.remark || username),
        is_active: username === this.data.active
      });
    }
    rows.sort((a, b) => {
      if (a.is_active !== b.is_active) {
        return a.is_active ? -1 : 1;
      }
      return a.username.localeCompare(b.username);
    });
    return rows;
  }

  get(username) {
    const key = asString(username).trim();
    if (!key || !this.data.accounts[key]) {
      return null;
    }
    const info = this.data.accounts[key];
    return {
      username: key,
      password: asString(info.password || ""),
      remark: asString(info.remark || key),
      is_active: key === this.data.active
    };
  }

  getActive() {
    const key = asString(this.data.active || "");
    if (!key) {
      return null;
    }
    return this.get(key);
  }

  setActive(username) {
    const key = asString(username).trim();
    if (!this.data.accounts[key]) {
      return false;
    }
    this.data.active = key;
    this.save();
    return true;
  }

  upsert({username, password, remark}) {
    const key = asString(username).trim();
    if (!key) {
      throw new Error("username is empty");
    }
    this.data.accounts[key] = {
      password: asString(password || ""),
      remark: asString(remark || key)
    };
    this.data.active = key;
    this.save();
  }

  remove(username) {
    const key = asString(username).trim();
    if (!this.data.accounts[key]) {
      return false;
    }
    delete this.data.accounts[key];
    if (this.data.active === key) {
      this.data.active = null;
    }
    this.save();
    return true;
  }
}

module.exports = {
  AccountStore
};
