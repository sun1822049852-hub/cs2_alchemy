const {PATHS} = require("./constants");
const {readJson, writeJson} = require("./jsonStore");
const {asString} = require("./utils");

class TokenStore {
  constructor(filePath = PATHS.TOKENS_FILE) {
    this.filePath = filePath;
  }

  _load() {
    const data = readJson(this.filePath, {});
    if (!data || typeof data !== "object") {
      return {};
    }
    return data;
  }

  get(username) {
    const key = asString(username).trim();
    if (!key) {
      return "";
    }
    const data = this._load();
    return asString(data[key] || "").trim();
  }

  set(username, token) {
    const key = asString(username).trim();
    const value = asString(token).trim();
    if (!key || !value) {
      return;
    }
    const data = this._load();
    data[key] = value;
    writeJson(this.filePath, data);
  }

  remove(username) {
    const key = asString(username).trim();
    if (!key) {
      return;
    }
    const data = this._load();
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      delete data[key];
      writeJson(this.filePath, data);
    }
  }
}

module.exports = {
  TokenStore
};
