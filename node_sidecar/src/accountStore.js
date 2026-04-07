const {PATHS} = require("./constants");
const {AppAuthStore} = require("./appAuthStore");
const {asString} = require("./utils");

function normalizeOptions(options) {
  if (typeof options === "string") {
    return {
      dbPath: PATHS.SKIN_DB_FILE,
      accountsFilePath: options,
      viewerUsername: ""
    };
  }
  const value = options && typeof options === "object" ? options : {};
  return {
    dbPath: value.dbPath || PATHS.SKIN_DB_FILE,
    accountsFilePath: value.accountsFilePath || PATHS.ACCOUNTS_FILE,
    viewerUsername: asString(value.viewerUsername).trim()
  };
}

class AccountStore {
  constructor(options = {}) {
    this.options = normalizeOptions(options);
  }

  _withStore(fn, {readOnly = false} = {}) {
    const store = new AppAuthStore({
      dbPath: this.options.dbPath,
      accountsFilePath: this.options.accountsFilePath,
      readOnly,
      initialize: !readOnly
    });
    try {
      return fn(store);
    } finally {
      store.close();
    }
  }

  list() {
    return this._withStore(
      (store) => store.listSteamAccountsForUser(this.options.viewerUsername),
      {readOnly: true}
    );
  }

  get(username) {
    return this._withStore(
      (store) => store.getSteamAccountForUser(this.options.viewerUsername, username, {
        includeAll: !this.options.viewerUsername
      }),
      {readOnly: true}
    );
  }

  getActive() {
    return this._withStore(
      (store) => store.getActiveSteamAccount(this.options.viewerUsername),
      {readOnly: true}
    );
  }

  setActive(username) {
    return this._withStore((store) => store.setActiveSteamAccount(this.options.viewerUsername, username));
  }

  upsert(payload) {
    return this._withStore((store) => store.upsertSteamAccount(payload, {
      viewerUsername: this.options.viewerUsername,
      setActive: true
    }));
  }

  updateRemark(username, remark) {
    return this._withStore((store) => store.updateSteamRemark(this.options.viewerUsername, username, remark));
  }

  remove(username) {
    return this._withStore((store) => store.removeSteamAccount(this.options.viewerUsername, username));
  }
}

module.exports = {
  AccountStore
};
