const crypto = require("node:crypto");
const {DatabaseSync} = require("node:sqlite");
const {PATHS} = require("./constants");
const {readJson, writeJson} = require("./jsonStore");
const {asString} = require("./utils");

const ALL_PERMISSION_CODES = [
  "accounts.read",
  "accounts.write",
  "inventory.read",
  "inventory.refresh",
  "craft.use",
  "simulation.use",
  "rbac.manage",
  "membership.manage"
];

function nowSqlText() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function hashPassword(password) {
  const secret = asString(password).trim();
  if (!secret) {
    throw new Error("password is required");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = crypto.scryptSync(secret, salt, 64).toString("hex");
  return `scrypt$${salt}$${digest}`;
}

function verifyPassword(password, encoded) {
  const secret = asString(password).trim();
  const stored = asString(encoded).trim();
  const [algo, salt, digest] = stored.split("$");
  if (algo !== "scrypt" || !salt || !digest || !secret) {
    return false;
  }
  const computed = crypto.scryptSync(secret, salt, 64);
  const expected = Buffer.from(digest, "hex");
  if (computed.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(computed, expected);
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(asString(token)).digest("hex");
}

function sanitizeUser(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id) || 0,
    username: asString(row.username).trim(),
    display_name: asString(row.display_name).trim(),
    status: asString(row.status).trim() || "active",
    is_super_admin: Number(row.is_super_admin) === 1,
    active_steam_username: asString(row.active_steam_username).trim(),
    last_login_at: asString(row.last_login_at).trim(),
    created_at: asString(row.created_at).trim(),
    updated_at: asString(row.updated_at).trim()
  };
}

function sanitizeSteamAccount(row, activeUsername = "") {
  if (!row) {
    return null;
  }
  const username = asString(row.username).trim();
  return {
    username,
    password: asString(row.password).trim(),
    remark: asString(row.remark).trim(),
    steam_name: asString(row.steam_name).trim(),
    steam_id: asString(row.steam_id).trim(),
    avatar_url: asString(row.avatar_url).trim(),
    is_active: !!username && username === asString(activeUsername).trim()
  };
}

class AppAuthStore {
  constructor({
    dbPath = PATHS.SKIN_DB_FILE,
    accountsFilePath = PATHS.ACCOUNTS_FILE
  } = {}) {
    this.dbPath = dbPath;
    this.accountsFilePath = accountsFilePath;
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.ensureSchema();
    this.seedSystemData();
    this.importLegacyAccountsIfNeeded();
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }

  ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_user (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        is_super_admin INTEGER NOT NULL DEFAULT 0,
        active_steam_username TEXT NOT NULL DEFAULT '',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_login_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS app_role (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_permission (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_role_permission (
        role_id INTEGER NOT NULL,
        permission_id INTEGER NOT NULL,
        PRIMARY KEY (role_id, permission_id),
        FOREIGN KEY (role_id) REFERENCES app_role(id) ON DELETE CASCADE,
        FOREIGN KEY (permission_id) REFERENCES app_permission(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS app_user_role (
        user_id INTEGER NOT NULL,
        role_id INTEGER NOT NULL,
        PRIMARY KEY (user_id, role_id),
        FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE,
        FOREIGN KEY (role_id) REFERENCES app_role(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS membership_plan (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'inactive',
        feature_matrix_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS user_membership (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        plan_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'inactive',
        starts_at DATETIME,
        ends_at DATETIME,
        feature_matrix_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE,
        FOREIGN KEY (plan_id) REFERENCES membership_plan(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS steam_account (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL DEFAULT '',
        remark TEXT NOT NULL DEFAULT '',
        steam_name TEXT NOT NULL DEFAULT '',
        steam_id TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_steam_binding (
        user_id INTEGER NOT NULL,
        steam_account_id INTEGER NOT NULL,
        PRIMARY KEY (user_id, steam_account_id),
        FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE,
        FOREIGN KEY (steam_account_id) REFERENCES steam_account(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS app_session (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        expires_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
      );
    `);
  }

  seedSystemData() {
    const roles = [
      {code: "super_admin", name: "超级管理员"},
      {code: "member", name: "普通会员"}
    ];
    const permissions = [
      {code: "accounts.read", name: "查看 Steam 账号"},
      {code: "accounts.write", name: "编辑 Steam 账号"},
      {code: "inventory.read", name: "查看库存"},
      {code: "inventory.refresh", name: "刷新库存"},
      {code: "craft.use", name: "执行炼金"},
      {code: "simulation.use", name: "使用汰换模拟"},
      {code: "rbac.manage", name: "管理权限绑定"},
      {code: "membership.manage", name: "管理会员计划"}
    ];
    const upsertRole = this.db.prepare("INSERT INTO app_role(code, name) VALUES(?, ?) ON CONFLICT(code) DO UPDATE SET name=excluded.name");
    const upsertPermission = this.db.prepare("INSERT INTO app_permission(code, name) VALUES(?, ?) ON CONFLICT(code) DO UPDATE SET name=excluded.name");
    for (const role of roles) {
      upsertRole.run(role.code, role.name);
    }
    for (const permission of permissions) {
      upsertPermission.run(permission.code, permission.name);
    }

    const superAdminRoleId = this.getRoleId("super_admin");
    const memberRoleId = this.getRoleId("member");
    const permissionRows = this.db.prepare("SELECT id, code FROM app_permission").all();
    const permissionByCode = new Map(permissionRows.map((row) => [asString(row.code).trim(), Number(row.id) || 0]));
    const upsertRolePermission = this.db.prepare(
      "INSERT OR IGNORE INTO app_role_permission(role_id, permission_id) VALUES(?, ?)"
    );
    for (const code of ALL_PERMISSION_CODES) {
      const permissionId = permissionByCode.get(code) || 0;
      if (superAdminRoleId > 0 && permissionId > 0) {
        upsertRolePermission.run(superAdminRoleId, permissionId);
      }
    }
    for (const code of ["accounts.read", "inventory.read", "simulation.use"]) {
      const permissionId = permissionByCode.get(code) || 0;
      if (memberRoleId > 0 && permissionId > 0) {
        upsertRolePermission.run(memberRoleId, permissionId);
      }
    }

    this.db.prepare(
      "INSERT INTO membership_plan(code, name, status, feature_matrix_json) VALUES(?, ?, ?, ?) ON CONFLICT(code) DO NOTHING"
    ).run("placeholder_member", "会员占位方案", "inactive", JSON.stringify({}));
  }

  importLegacyAccountsIfNeeded() {
    const legacy = this.readLegacyAccountsState();
    const accounts = legacy && legacy.accounts && typeof legacy.accounts === "object" ? legacy.accounts : {};
    const upsert = this.db.prepare(`
      INSERT INTO steam_account(username, password, remark, steam_name, steam_id, avatar_url, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        password = excluded.password,
        remark = excluded.remark,
        steam_name = excluded.steam_name,
        steam_id = excluded.steam_id,
        avatar_url = excluded.avatar_url,
        updated_at = excluded.updated_at
    `);
    for (const [username, info] of Object.entries(accounts)) {
      const key = asString(username).trim();
      if (!key) {
        continue;
      }
      const value = info && typeof info === "object" ? info : {};
      upsert.run(
        key,
        asString(value.password).trim(),
        asString(value.remark).trim(),
        asString(value.steam_name || value.persona_name || value.steam_persona).trim(),
        asString(value.steam_id || value.steamid).trim(),
        asString(value.avatar_url || value.avatar).trim(),
        nowSqlText()
      );
    }
  }

  readLegacyAccountsState() {
    const legacy = readJson(this.accountsFilePath, {accounts: {}, active: ""});
    if (!legacy || typeof legacy !== "object") {
      return {accounts: {}, active: ""};
    }
    return {
      ...legacy,
      accounts: legacy.accounts && typeof legacy.accounts === "object" ? legacy.accounts : {},
      active: asString(legacy.active).trim()
    };
  }

  writeLegacyAccountsState(nextValue) {
    const value = nextValue && typeof nextValue === "object" ? nextValue : {accounts: {}, active: ""};
    writeJson(this.accountsFilePath, {
      ...value,
      accounts: value.accounts && typeof value.accounts === "object" ? value.accounts : {},
      active: asString(value.active).trim()
    });
  }

  getLegacyActiveSteamUsername() {
    const active = asString(this.readLegacyAccountsState().active).trim();
    if (!active) {
      return "";
    }
    const row = this.db.prepare("SELECT username FROM steam_account WHERE username = ?").get(active);
    return row ? active : "";
  }

  setLegacyActiveSteamUsername(username) {
    const key = asString(username).trim();
    const legacy = this.readLegacyAccountsState();
    legacy.active = key;
    this.writeLegacyAccountsState(legacy);
  }

  needsBootstrap() {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM app_user").get();
    return Number(row && row.count) === 0;
  }

  bootstrapAdmin({password, displayName = "管理员"} = {}) {
    if (!this.needsBootstrap()) {
      throw new Error("admin already initialized");
    }
    const now = nowSqlText();
    const stmt = this.db.prepare(`
      INSERT INTO app_user(username, password_hash, display_name, status, is_super_admin, created_at, updated_at)
      VALUES(?, ?, ?, 'active', 1, ?, ?)
    `);
    stmt.run("admin", hashPassword(password), asString(displayName).trim() || "管理员", now, now);
    const userId = this.getUserId("admin");
    const roleId = this.getRoleId("super_admin");
    if (userId > 0 && roleId > 0) {
      this.db.prepare("INSERT OR IGNORE INTO app_user_role(user_id, role_id) VALUES(?, ?)").run(userId, roleId);
    }
    return {
      user: this.getUserByUsername("admin")
    };
  }

  createUser({username, password, roleCodes = ["member"], boundSteamUsernames = [], displayName = ""} = {}) {
    const key = asString(username).trim();
    if (!key) {
      throw new Error("username is required");
    }
    const now = nowSqlText();
    this.db.prepare(`
      INSERT INTO app_user(username, password_hash, display_name, status, is_super_admin, created_at, updated_at)
      VALUES(?, ?, ?, 'active', 0, ?, ?)
    `).run(key, hashPassword(password), asString(displayName).trim(), now, now);
    const userId = this.getUserId(key);
    for (const roleCode of Array.isArray(roleCodes) ? roleCodes : []) {
      const roleId = this.getRoleId(roleCode);
      if (userId > 0 && roleId > 0) {
        this.db.prepare("INSERT OR IGNORE INTO app_user_role(user_id, role_id) VALUES(?, ?)").run(userId, roleId);
      }
    }
    this.setUserBindings(key, boundSteamUsernames);
    return this.getUserByUsername(key);
  }

  getRoleId(code) {
    const row = this.db.prepare("SELECT id FROM app_role WHERE code = ?").get(asString(code).trim());
    return Number(row && row.id) || 0;
  }

  getUserId(username) {
    const row = this.db.prepare("SELECT id FROM app_user WHERE username = ?").get(asString(username).trim());
    return Number(row && row.id) || 0;
  }

  getUserByUsername(username) {
    const row = this.db.prepare("SELECT * FROM app_user WHERE username = ?").get(asString(username).trim());
    return sanitizeUser(row);
  }

  authenticateUser({username, password} = {}) {
    const key = asString(username).trim();
    const row = this.db.prepare("SELECT * FROM app_user WHERE username = ?").get(key);
    if (!row || asString(row.status).trim() !== "active") {
      return {ok: false, reason: "user_not_found"};
    }
    if (!verifyPassword(password, row.password_hash)) {
      return {ok: false, reason: "invalid_password"};
    }
    this.db.prepare("UPDATE app_user SET last_login_at = ?, updated_at = ? WHERE id = ?").run(nowSqlText(), nowSqlText(), row.id);
    return {ok: true, user: sanitizeUser(row)};
  }

  createSessionForUser(username, {ttlDays = 7, ipAddress = "", userAgent = ""} = {}) {
    const user = this.getUserByUsername(username);
    if (!user) {
      throw new Error("user not found");
    }
    const token = crypto.randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + Math.max(1, Number(ttlDays) || 7) * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 19);
    const now = nowSqlText();
    this.db.prepare(`
      INSERT INTO app_session(token_hash, user_id, ip_address, user_agent, expires_at, created_at, last_seen_at)
      VALUES(?, ?, ?, ?, ?, ?, ?)
    `).run(hashSessionToken(token), user.id, asString(ipAddress).trim(), asString(userAgent).trim(), expiresAt, now, now);
    return {
      token,
      expires_at: expiresAt
    };
  }

  resolveSession(token) {
    const hashed = hashSessionToken(asString(token).trim());
    const row = this.db.prepare(`
      SELECT s.*, u.username, u.display_name, u.status, u.is_super_admin, u.active_steam_username, u.created_at AS user_created_at,
             u.updated_at AS user_updated_at, u.last_login_at
      FROM app_session s
      JOIN app_user u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `).get(hashed);
    if (!row) {
      return null;
    }
    const expiresAt = Date.parse(String(row.expires_at || "").replace(" ", "T"));
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      this.deleteSession(token);
      return null;
    }
    this.db.prepare("UPDATE app_session SET last_seen_at = ? WHERE token_hash = ?").run(nowSqlText(), hashed);
    const user = sanitizeUser({
      id: row.user_id,
      username: row.username,
      display_name: row.display_name,
      status: row.status,
      is_super_admin: row.is_super_admin,
      active_steam_username: row.active_steam_username,
      created_at: row.user_created_at,
      updated_at: row.user_updated_at,
      last_login_at: row.last_login_at
    });
    return {
      user,
      permissions: this.listPermissionsForUser(user.username),
      membership: this.getMembershipSummary(user.username)
    };
  }

  deleteSession(token) {
    this.db.prepare("DELETE FROM app_session WHERE token_hash = ?").run(hashSessionToken(asString(token).trim()));
  }

  listPermissionsForUser(username) {
    const user = this.getUserByUsername(username);
    if (!user) {
      return [];
    }
    if (user.is_super_admin) {
      return [...ALL_PERMISSION_CODES];
    }
    const rows = this.db.prepare(`
      SELECT DISTINCT p.code
      FROM app_permission p
      JOIN app_role_permission rp ON rp.permission_id = p.id
      JOIN app_user_role ur ON ur.role_id = rp.role_id
      JOIN app_user u ON u.id = ur.user_id
      WHERE u.username = ?
      ORDER BY p.code ASC
    `).all(user.username);
    return rows.map((row) => asString(row.code).trim()).filter(Boolean);
  }

  getMembershipSummary(username) {
    const rows = this.db.prepare(`
      SELECT mp.code, mp.name, um.status, um.starts_at, um.ends_at
      FROM user_membership um
      JOIN app_user u ON u.id = um.user_id
      JOIN membership_plan mp ON mp.id = um.plan_id
      WHERE u.username = ?
      ORDER BY um.id DESC
    `).all(asString(username).trim());
    return rows.map((row) => ({
      code: asString(row.code).trim(),
      name: asString(row.name).trim(),
      status: asString(row.status).trim(),
      starts_at: asString(row.starts_at).trim(),
      ends_at: asString(row.ends_at).trim()
    }));
  }

  isSuperAdmin(username) {
    const user = this.getUserByUsername(username);
    return !!(user && user.is_super_admin);
  }

  setUserBindings(username, steamUsernames) {
    const userId = this.getUserId(username);
    if (!userId) {
      throw new Error(`user not found: ${username}`);
    }
    this.db.prepare("DELETE FROM user_steam_binding WHERE user_id = ?").run(userId);
    const names = [...new Set((Array.isArray(steamUsernames) ? steamUsernames : []).map((value) => asString(value).trim()).filter(Boolean))];
    const bind = this.db.prepare(`
      INSERT OR IGNORE INTO user_steam_binding(user_id, steam_account_id)
      SELECT ?, id FROM steam_account WHERE username = ?
    `);
    for (const steamUsername of names) {
      bind.run(userId, steamUsername);
    }
  }

  canAccessSteamAccount(viewerUsername, steamUsername) {
    const viewer = asString(viewerUsername).trim();
    const target = asString(steamUsername).trim();
    if (!target) {
      return false;
    }
    if (!viewer) {
      return true;
    }
    if (this.isSuperAdmin(viewer)) {
      return true;
    }
    const row = this.db.prepare(`
      SELECT 1
      FROM user_steam_binding ub
      JOIN app_user u ON u.id = ub.user_id
      JOIN steam_account sa ON sa.id = ub.steam_account_id
      WHERE u.username = ? AND sa.username = ?
      LIMIT 1
    `).get(viewer, target);
    return !!row;
  }

  getViewerActiveSteamUsername(viewerUsername) {
    if (!asString(viewerUsername).trim()) {
      return this.getLegacyActiveSteamUsername();
    }
    const viewer = this.getUserByUsername(viewerUsername);
    return viewer ? asString(viewer.active_steam_username).trim() : "";
  }

  listSteamAccountsForUser(viewerUsername, {includeAll = false} = {}) {
    const viewer = asString(viewerUsername).trim();
    const active = this.getViewerActiveSteamUsername(viewer);
    let rows;
    if (includeAll || !viewer || this.isSuperAdmin(viewer)) {
      rows = this.db.prepare("SELECT * FROM steam_account ORDER BY username ASC").all();
    } else {
      rows = this.db.prepare(`
        SELECT sa.*
        FROM steam_account sa
        JOIN user_steam_binding ub ON ub.steam_account_id = sa.id
        JOIN app_user u ON u.id = ub.user_id
        WHERE u.username = ?
        ORDER BY sa.username ASC
      `).all(viewer);
    }
    return rows.map((row) => sanitizeSteamAccount(row, active));
  }

  getSteamAccountForUser(viewerUsername, username, {includeAll = false} = {}) {
    const key = asString(username).trim();
    if (!key) {
      return null;
    }
    if (!includeAll && !this.canAccessSteamAccount(viewerUsername, key)) {
      return null;
    }
    const row = this.db.prepare("SELECT * FROM steam_account WHERE username = ?").get(key);
    return sanitizeSteamAccount(row, this.getViewerActiveSteamUsername(viewerUsername));
  }

  upsertSteamAccount(payload, {viewerUsername = "", setActive = true} = {}) {
    const data = payload && typeof payload === "object" ? payload : {};
    const username = asString(data.username).trim();
    if (!username) {
      throw new Error("username is empty");
    }
    if (viewerUsername && !this.isSuperAdmin(viewerUsername) && !this.canAccessSteamAccount(viewerUsername, username)) {
      throw new Error("viewer cannot manage this steam account");
    }
    this.db.prepare(`
      INSERT INTO steam_account(username, password, remark, steam_name, steam_id, avatar_url, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        password = excluded.password,
        remark = excluded.remark,
        steam_name = excluded.steam_name,
        steam_id = excluded.steam_id,
        avatar_url = excluded.avatar_url,
        updated_at = excluded.updated_at
    `).run(
      username,
      asString(data.password).trim(),
      asString(data.remark).trim(),
      asString(data.steamName || data.steam_name).trim(),
      asString(data.steamId || data.steam_id).trim(),
      asString(data.avatarUrl || data.avatar_url).trim(),
      nowSqlText()
    );
    if (setActive && viewerUsername) {
      this.setActiveSteamAccount(viewerUsername, username);
    }
  }

  updateSteamRemark(viewerUsername, username, remark) {
    if (!this.canAccessSteamAccount(viewerUsername, username)) {
      return false;
    }
    const result = this.db.prepare("UPDATE steam_account SET remark = ?, updated_at = ? WHERE username = ?")
      .run(asString(remark).trim(), nowSqlText(), asString(username).trim());
    return Number(result.changes) > 0;
  }

  removeSteamAccount(viewerUsername, username) {
    const key = asString(username).trim();
    if (!this.canAccessSteamAccount(viewerUsername, key)) {
      return false;
    }
    const row = this.db.prepare("SELECT id FROM steam_account WHERE username = ?").get(key);
    if (!row) {
      return false;
    }
    this.db.prepare("DELETE FROM user_steam_binding WHERE steam_account_id = ?").run(row.id);
    this.db.prepare("UPDATE app_user SET active_steam_username = '' WHERE active_steam_username = ?").run(key);
    if (!asString(viewerUsername).trim() && this.getLegacyActiveSteamUsername() === key) {
      this.setLegacyActiveSteamUsername("");
    }
    const result = this.db.prepare("DELETE FROM steam_account WHERE id = ?").run(row.id);
    return Number(result.changes) > 0;
  }

  setActiveSteamAccount(viewerUsername, username) {
    const viewer = asString(viewerUsername).trim();
    const key = asString(username).trim();
    if (!key) {
      return false;
    }
    if (!viewer) {
      const row = this.db.prepare("SELECT username FROM steam_account WHERE username = ?").get(key);
      if (!row) {
        return false;
      }
      this.setLegacyActiveSteamUsername(key);
      return true;
    }
    if (!this.canAccessSteamAccount(viewer, key)) {
      return false;
    }
    const result = this.db.prepare("UPDATE app_user SET active_steam_username = ?, updated_at = ? WHERE username = ?")
      .run(key, nowSqlText(), viewer);
    return Number(result.changes) > 0;
  }

  getActiveSteamAccount(viewerUsername) {
    const key = this.getViewerActiveSteamUsername(viewerUsername);
    return key ? this.getSteamAccountForUser(viewerUsername, key, {includeAll: this.isSuperAdmin(viewerUsername)}) : null;
  }
}

module.exports = {
  AppAuthStore,
  ALL_PERMISSION_CODES
};
