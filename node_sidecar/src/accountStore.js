const {PATHS} = require("./constants");
const {readJson, writeJson} = require("./jsonStore");
const {asString} = require("./utils");

class AccountStore {
  constructor(filePath = PATHS.ACCOUNTS_FILE) {
    this.filePath = filePath;
    this.data = this._load();
  }

  _normalizeAccount(username, info) {
    const key = asString(username).trim();
    const value = info && typeof info === "object" ? info : {};
    const rawRemark = asString(value.remark || "").trim();
    const normalizedRemark = rawRemark && rawRemark !== key ? rawRemark : "";
    return {
      password: asString(value.password || ""),
      remark: normalizedRemark,
      steam_name: asString(value.steam_name || value.persona_name || value.steam_persona || "").trim(),
      steam_id: asString(value.steam_id || value.steamid || "").trim(),
      avatar_url: asString(value.avatar_url || value.avatar || "").trim()
    };
  }

  _load() {
    const raw = readJson(this.filePath, {accounts: {}, active: null});
    const accounts = {};
    const source = raw && typeof raw === "object" ? raw.accounts : {};
    if (source && typeof source === "object") {
      for (const [username, info] of Object.entries(source)) {
        const key = asString(username).trim();
        if (!key) {
          continue;
        }
        accounts[key] = this._normalizeAccount(key, info);
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
        remark: asString(info.remark || "").trim(),
        steam_name: asString(info.steam_name || "").trim(),
        steam_id: asString(info.steam_id || "").trim(),
        avatar_url: asString(info.avatar_url || "").trim(),
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
      remark: asString(info.remark || "").trim(),
      steam_name: asString(info.steam_name || "").trim(),
      steam_id: asString(info.steam_id || "").trim(),
      avatar_url: asString(info.avatar_url || "").trim(),
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

  upsert(payload) {
    const data = payload && typeof payload === "object" ? payload : {};
    const username = data.username;
    const password = data.password;
    const remark = data.remark;
    const steamName = data.steamName;
    const steamId = data.steamId;
    const avatarUrl = data.avatarUrl;
    const key = asString(username).trim();
    if (!key) {
      throw new Error("username is empty");
    }
    const existed = this.data.accounts[key] || null;
    const hasRemark = Object.prototype.hasOwnProperty.call(data, "remark");
    const incomingSteamName = asString(steamName || "").trim();
    const incomingSteamId = asString(steamId || "").trim();
    const incomingAvatarUrl = asString(avatarUrl || "").trim();
    this.data.accounts[key] = {
      password: asString(password || (existed ? existed.password : "")),
      remark: hasRemark ? asString(remark || "").trim() : asString(existed && existed.remark ? existed.remark : "").trim(),
      steam_name: incomingSteamName || asString(existed && existed.steam_name ? existed.steam_name : "").trim(),
      steam_id: incomingSteamId || asString(existed && existed.steam_id ? existed.steam_id : "").trim(),
      avatar_url: incomingAvatarUrl || asString(existed && existed.avatar_url ? existed.avatar_url : "").trim()
    };
    this.data.active = key;
    this.save();
  }

  updateRemark(username, remark) {
    const key = asString(username).trim();
    if (!key || !this.data.accounts[key]) {
      return false;
    }
    this.data.accounts[key].remark = asString(remark || "").trim();
    this.save();
    return true;
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
