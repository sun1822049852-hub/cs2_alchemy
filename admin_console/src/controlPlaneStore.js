const crypto = require("node:crypto");
const {DatabaseSync} = require("node:sqlite");
const {ALL_FEATURE_CODES, FEATURE_CODES} = require("../../shared/featureCodes");
const {PATHS} = require("./constants");
const {asString} = require("../../node_sidecar/src/utils");

const LEGACY_MEMBERSHIP_PLAN_CODE_MAP = Object.freeze({
  free: "inactive",
  pro: "standard",
  elite: "member"
});

const DEFAULT_INACTIVE_PERMISSIONS = [
  FEATURE_CODES.ACCOUNTS_READ,
  FEATURE_CODES.ACCOUNTS_WRITE,
  FEATURE_CODES.INVENTORY_READ,
  FEATURE_CODES.INVENTORY_REFRESH,
  FEATURE_CODES.SIMULATION_USE
];

const DEFAULT_ACTIVE_PERMISSIONS = [
  FEATURE_CODES.ACCOUNTS_READ,
  FEATURE_CODES.ACCOUNTS_WRITE,
  FEATURE_CODES.CRAFT_USE,
  FEATURE_CODES.INVENTORY_READ,
  FEATURE_CODES.INVENTORY_REFRESH,
  FEATURE_CODES.SIMULATION_USE
];

const DEFAULT_MEMBERSHIP_PLANS = [
  {
    code: "inactive",
    name: "Inactive",
    description: "Expired or unopened membership without craft execution",
    permissions: [...DEFAULT_INACTIVE_PERMISSIONS]
  },
  {
    code: "member",
    name: "Member",
    description: "Unlimited Steam bindings with craft execution",
    permissions: [...DEFAULT_ACTIVE_PERMISSIONS]
  },
  {
    code: "standard",
    name: "Standard",
    description: "Single Steam binding with craft execution",
    permissions: [...DEFAULT_ACTIVE_PERMISSIONS]
  },
  {
    code: "trial",
    name: "Trial",
    description: "Seven-day single-binding trial with craft execution",
    permissions: [...DEFAULT_ACTIVE_PERMISSIONS]
  }
];

function toIsoString(value = new Date()) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const text = asString(value).trim();
  return text || new Date().toISOString();
}

function parseTimeMs(value) {
  const text = asString(value).trim();
  if (!text) {
    return 0;
  }
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeMembershipPlanCode(value = "", fallback = "inactive") {
  const raw = asString(value).trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  return LEGACY_MEMBERSHIP_PLAN_CODE_MAP[raw] || raw;
}

function hashCode(code) {
  return crypto.createHash("sha256").update(asString(code).trim()).digest("hex");
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

function hashToken(token) {
  return crypto.createHash("sha256").update(asString(token).trim()).digest("hex");
}

function normalizeFeatureCode(value) {
  const code = asString(value).trim();
  if (!ALL_FEATURE_CODES.includes(code)) {
    throw new Error(`feature_code invalid: ${code}`);
  }
  return code;
}

function sortText(values = []) {
  return [...values].sort((left, right) => String(left).localeCompare(String(right)));
}

function calculateRemainingMembershipDays(expiresAt = "", now = new Date()) {
  const expiresAtMs = parseTimeMs(expiresAt);
  const nowMs = parseTimeMs(toIsoString(now));
  if (!expiresAtMs || !nowMs || expiresAtMs <= nowMs) {
    return 0;
  }
  return Math.ceil((expiresAtMs - nowMs) / (24 * 60 * 60 * 1000));
}

function isMembershipActive(planCode = "", expiresAt = "", now = new Date()) {
  const code = normalizeMembershipPlanCode(planCode);
  if (code === "inactive") {
    return false;
  }
  const expiresAtMs = parseTimeMs(expiresAt);
  if (code === "trial" && !expiresAtMs) {
    return false;
  }
  if (!expiresAtMs) {
    return true;
  }
  return expiresAtMs > parseTimeMs(toIsoString(now));
}

function sanitizeCodeRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id) || 0,
    email: asString(row.email).trim(),
    scene: asString(row.scene).trim(),
    code_hash: asString(row.code_hash).trim(),
    expires_at: asString(row.expires_at).trim(),
    created_at: asString(row.created_at).trim(),
    consumed_at: asString(row.consumed_at).trim()
  };
}

function sanitizeClientUser(row, {now = new Date()} = {}) {
  if (!row) {
    return null;
  }
  const membershipPlan = normalizeMembershipPlanCode(row.membership_plan);
  const membershipExpiresAt = asString(row.membership_expires_at).trim();
  return {
    id: Number(row.id) || 0,
    email: asString(row.email).trim(),
    username: asString(row.username).trim(),
    status: asString(row.status).trim() || "active",
    membership_plan: membershipPlan,
    membership_expires_at: membershipExpiresAt,
    remaining_membership_days: calculateRemainingMembershipDays(membershipExpiresAt, now),
    membership_active: isMembershipActive(membershipPlan, membershipExpiresAt, now),
    created_at: asString(row.created_at).trim(),
    updated_at: asString(row.updated_at).trim()
  };
}

function sanitizeAdminUser(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id) || 0,
    username: asString(row.username).trim(),
    status: asString(row.status).trim() || "active",
    is_super_admin: Number(row.is_super_admin) === 1,
    created_at: asString(row.created_at).trim(),
    updated_at: asString(row.updated_at).trim(),
    last_login_at: asString(row.last_login_at).trim()
  };
}

function sanitizeMembershipPlan(row, permissions = []) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id) || 0,
    code: asString(row.code).trim(),
    name: asString(row.name).trim(),
    description: asString(row.description).trim(),
    is_enabled: Number(row.is_enabled) === 1,
    permissions: sortText(permissions),
    created_at: asString(row.created_at).trim(),
    updated_at: asString(row.updated_at).trim()
  };
}

function sanitizeDeviceSession(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id) || 0,
    user_id: Number(row.user_id) || 0,
    device_id: asString(row.device_id).trim(),
    status: asString(row.status).trim(),
    created_at: asString(row.created_at).trim(),
    updated_at: asString(row.updated_at).trim(),
    last_used_at: asString(row.last_used_at).trim(),
    expires_at: asString(row.expires_at).trim(),
    revoked_at: asString(row.revoked_at).trim()
  };
}

class ControlPlaneStore {
  constructor({dbPath = PATHS.DEFAULT_DB_FILE} = {}) {
    this.dbPath = dbPath;
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.ensureSchema();
    this.ensureDefaultMembershipPlans();
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }

  runInTransaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS email_code (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        scene TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        consumed_at TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_email_code_email_scene_created
      ON email_code(email, scene, created_at DESC);

      CREATE TABLE IF NOT EXISTS client_user (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        membership_plan TEXT NOT NULL DEFAULT 'inactive',
        membership_expires_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_user (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        is_super_admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS membership_plan (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        is_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS membership_plan_feature (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id INTEGER NOT NULL,
        feature_code TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(plan_id, feature_code),
        FOREIGN KEY (plan_id) REFERENCES membership_plan(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS client_user_feature_override (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        feature_code TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, feature_code),
        FOREIGN KEY (user_id) REFERENCES client_user(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS refresh_session (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL,
        device_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (user_id) REFERENCES client_user(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_refresh_session_user_device
      ON refresh_session(user_id, device_id, status);

      CREATE TABLE IF NOT EXISTS client_user_steam_binding (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        steam_id TEXT NOT NULL,
        steam_account_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        first_bound_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'client_login_save',
        note TEXT NOT NULL DEFAULT '',
        UNIQUE(user_id, steam_id),
        FOREIGN KEY (user_id) REFERENCES client_user(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_client_user_steam_binding_user_status
      ON client_user_steam_binding(user_id, status, first_bound_at DESC);

      CREATE TABLE IF NOT EXISTS admin_session (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT NOT NULL UNIQUE,
        admin_user_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (admin_user_id) REFERENCES admin_user(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS login_attempt (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        success INTEGER NOT NULL DEFAULT 0,
        ip TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_login_attempt_username_created
      ON login_attempt(username, created_at);

      CREATE TABLE IF NOT EXISTS register_session (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS verification_ticket (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT NOT NULL DEFAULT ''
      );
    `);
    this.ensureClientUserColumn("membership_expires_at", "TEXT NOT NULL DEFAULT ''");
  }

  ensureClientUserColumn(columnName, definition) {
    const columns = this.db.prepare("PRAGMA table_info(client_user)").all();
    if (columns.some((item) => asString(item && item.name).trim() === columnName)) {
      return;
    }
    this.db.exec(`ALTER TABLE client_user ADD COLUMN ${columnName} ${definition}`);
  }

  ensureDefaultMembershipPlans() {
    this.runInTransaction(() => {
      for (const item of DEFAULT_MEMBERSHIP_PLANS) {
        const now = toIsoString();
        const existing = this.db.prepare("SELECT * FROM membership_plan WHERE code = ?").get(item.code);
        let planId = 0;
        if (existing) {
          planId = Number(existing.id) || 0;
          this.db.prepare(`
            UPDATE membership_plan
            SET name = ?, description = ?, is_enabled = 1, updated_at = ?
            WHERE id = ?
          `).run(item.name, item.description, now, planId);
        } else {
          const result = this.db.prepare(`
            INSERT INTO membership_plan(code, name, description, is_enabled, created_at, updated_at)
            VALUES(?, ?, ?, 1, ?, ?)
          `).run(item.code, item.name, item.description, now, now);
          planId = Number(result.lastInsertRowid) || 0;
        }
        this.db.prepare("DELETE FROM membership_plan_feature WHERE plan_id = ?").run(planId);
        for (const featureCode of sortText(item.permissions)) {
          this.db.prepare(`
            INSERT INTO membership_plan_feature(plan_id, feature_code, enabled, created_at, updated_at)
            VALUES(?, ?, 1, ?, ?)
          `).run(planId, featureCode, now, now);
        }
      }
      for (const legacyCode of Object.keys(LEGACY_MEMBERSHIP_PLAN_CODE_MAP)) {
        this.db.prepare("DELETE FROM membership_plan WHERE code = ?").run(legacyCode);
      }
    });
  }

  createEmailCode({email = "", scene = "", code = "", ttlMs = 5 * 60 * 1000, now = new Date()} = {}) {
    const emailText = asString(email).trim().toLowerCase();
    const sceneText = asString(scene).trim();
    const codeText = asString(code).trim();
    if (!emailText || !sceneText || !codeText) {
      throw new Error("email/scene/code are required");
    }
    const createdAt = toIsoString(now);
    const expiresAt = new Date(parseTimeMs(createdAt) + Math.max(1, Number(ttlMs) || 0)).toISOString();
    this.db.prepare(`
      UPDATE email_code
      SET consumed_at = ?
      WHERE email = ? AND scene = ? AND consumed_at = ''
    `).run(createdAt, emailText, sceneText);
    const result = this.db.prepare(`
      INSERT INTO email_code(email, scene, code_hash, expires_at, created_at, consumed_at)
      VALUES(?, ?, ?, ?, ?, '')
    `).run(emailText, sceneText, hashCode(codeText), expiresAt, createdAt);
    return sanitizeCodeRow(this.db.prepare("SELECT * FROM email_code WHERE id = ?").get(result.lastInsertRowid));
  }

  deleteEmailCode(id) {
    this.db.prepare("DELETE FROM email_code WHERE id = ?").run(Number(id) || 0);
  }

  getLatestActiveCode({email = "", scene = "", now = new Date()} = {}) {
    const row = this.db.prepare(`
      SELECT * FROM email_code
      WHERE email = ? AND scene = ? AND consumed_at = ''
      ORDER BY created_at DESC
      LIMIT 1
    `).get(asString(email).trim().toLowerCase(), asString(scene).trim());
    const code = sanitizeCodeRow(row);
    if (!code || parseTimeMs(code.expires_at) <= parseTimeMs(toIsoString(now))) {
      return null;
    }
    return code;
  }

  canSendCode({email = "", scene = "", cooldownMs = 60 * 1000, now = new Date()} = {}) {
    const row = this.db.prepare(`
      SELECT created_at FROM email_code
      WHERE email = ? AND scene = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(asString(email).trim().toLowerCase(), asString(scene).trim());
    if (!row) {
      return true;
    }
    return (parseTimeMs(toIsoString(now)) - parseTimeMs(row.created_at)) >= Math.max(0, Number(cooldownMs) || 0);
  }

  verifyEmailCode({email = "", scene = "", code = "", now = new Date()} = {}) {
    const active = this.getLatestActiveCode({email, scene, now});
    if (!active) {
      return {ok: false, reason: "code_not_found"};
    }
    if (active.code_hash !== hashCode(code)) {
      return {ok: false, reason: "code_mismatch"};
    }
    this.db.prepare("UPDATE email_code SET consumed_at = ? WHERE id = ?").run(toIsoString(now), active.id);
    return {ok: true, reason: "verified", code: active};
  }

  listMembershipPlans() {
    const rows = this.db.prepare("SELECT * FROM membership_plan ORDER BY code ASC").all();
    const features = this.db.prepare(`
      SELECT mpf.plan_id, mpf.feature_code
      FROM membership_plan_feature mpf
      JOIN membership_plan mp ON mp.id = mpf.plan_id
      WHERE mpf.enabled = 1
      ORDER BY mpf.feature_code ASC
    `).all();
    const featureMap = new Map();
    for (const row of features) {
      const key = Number(row.plan_id) || 0;
      const bucket = featureMap.get(key) || [];
      bucket.push(asString(row.feature_code).trim());
      featureMap.set(key, bucket);
    }
    return rows.map((row) => sanitizeMembershipPlan(row, featureMap.get(Number(row.id) || 0) || []));
  }

  getMembershipPlanByCode(code = "") {
    const normalizedCode = normalizeMembershipPlanCode(code, "");
    const row = this.db.prepare("SELECT * FROM membership_plan WHERE code = ?").get(normalizedCode);
    if (!row) {
      return null;
    }
    const permissions = this.db.prepare(`
      SELECT feature_code FROM membership_plan_feature
      WHERE plan_id = ? AND enabled = 1
      ORDER BY feature_code ASC
    `).all(row.id).map((item) => asString(item.feature_code).trim());
    return sanitizeMembershipPlan(row, permissions);
  }

  getClientUserById(userId = 0, {now = new Date()} = {}) {
    return sanitizeClientUser(this.db.prepare("SELECT * FROM client_user WHERE id = ?").get(Number(userId) || 0), {now});
  }

  getClientUserByUsername(username = "", {now = new Date()} = {}) {
    return sanitizeClientUser(this.db.prepare("SELECT * FROM client_user WHERE username = ?").get(asString(username).trim()), {now});
  }

  getClientUserByEmail(email = "", {now = new Date()} = {}) {
    return sanitizeClientUser(this.db.prepare("SELECT * FROM client_user WHERE email = ?").get(asString(email).trim().toLowerCase()), {now});
  }

  listClientUsers({now = new Date()} = {}) {
    return this.db.prepare("SELECT * FROM client_user ORDER BY created_at ASC").all().map((row) => sanitizeClientUser(row, {now}));
  }

  createClientUser({email = "", username = "", password = "", membershipPlan = "inactive", membershipExpiresAt = "", now = new Date()} = {}) {
    const emailText = asString(email).trim().toLowerCase();
    const usernameText = asString(username).trim();
    const plan = this.getMembershipPlanByCode(membershipPlan) || this.getMembershipPlanByCode("inactive");
    if (!emailText || !usernameText) {
      throw new Error("email and username are required");
    }
    const stamp = toIsoString(now);
    const expiresAt = plan.code === "inactive" ? "" : asString(membershipExpiresAt).trim();
    const result = this.db.prepare(`
      INSERT INTO client_user(email, username, password_hash, status, membership_plan, membership_expires_at, created_at, updated_at)
      VALUES(?, ?, ?, 'active', ?, ?, ?, ?)
    `).run(emailText, usernameText, hashPassword(password), plan.code, expiresAt, stamp, stamp);
    return this.getClientUserById(result.lastInsertRowid, {now});
  }

  authenticateClientUser({username = "", password = ""} = {}) {
    const row = this.db.prepare("SELECT * FROM client_user WHERE username = ?").get(asString(username).trim());
    if (!row || asString(row.status).trim() !== "active" || !verifyPassword(password, row.password_hash)) {
      return {ok: false, reason: "invalid_credentials"};
    }
    return {ok: true, user: sanitizeClientUser(row)};
  }

  updateClientPassword({email = "", newPassword = "", now = new Date()} = {}) {
    const user = this.getClientUserByEmail(email, {now});
    if (!user) {
      return {ok: false, reason: "user_not_found"};
    }
    this.db.prepare(`
      UPDATE client_user SET password_hash = ?, updated_at = ? WHERE id = ?
    `).run(hashPassword(newPassword), toIsoString(now), user.id);
    return {ok: true, user: this.getClientUserById(user.id, {now})};
  }

  replaceUserPermissionOverrides({userId = 0, permissionOverrides = [], baselinePermissions = [], now = new Date()} = {}) {
    const normalized = new Map();
    const baseline = new Set(Array.isArray(baselinePermissions) ? baselinePermissions : []);
    for (const item of permissionOverrides) {
      const featureCode = normalizeFeatureCode(item && (item.featureCode || item.feature_code));
      const enabled = item && item.enabled ? 1 : 0;
      const baselineEnabled = baseline.has(featureCode) ? 1 : 0;
      if (enabled !== baselineEnabled) {
        normalized.set(featureCode, enabled);
      }
    }
    const stamp = toIsoString(now);
    this.db.prepare("DELETE FROM client_user_feature_override WHERE user_id = ?").run(Number(userId) || 0);
    for (const featureCode of sortText([...normalized.keys()])) {
      this.db.prepare(`
        INSERT INTO client_user_feature_override(user_id, feature_code, enabled, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?)
      `).run(Number(userId) || 0, featureCode, normalized.get(featureCode), stamp, stamp);
    }
  }

  resolveUserEntitlements({userId = 0, now = new Date()} = {}) {
    const user = this.getClientUserById(userId, {now});
    if (!user) {
      return null;
    }
    const assignedPlan = this.getMembershipPlanByCode(user.membership_plan) || this.getMembershipPlanByCode("inactive");
    const membershipActive = user.membership_active;
    const effectivePlan = membershipActive
      ? assignedPlan
      : (this.getMembershipPlanByCode("inactive") || assignedPlan);
    const effectivePlanCode = effectivePlan ? effectivePlan.code : "inactive";
    const permissions = new Set(effectivePlan ? effectivePlan.permissions : []);
    const overrides = this.db.prepare(`
      SELECT feature_code, enabled
      FROM client_user_feature_override
      WHERE user_id = ?
      ORDER BY feature_code ASC
    `).all(user.id);
    for (const item of overrides) {
      const featureCode = asString(item.feature_code).trim();
      if (Number(item.enabled) === 1) {
        permissions.add(featureCode);
      } else {
        permissions.delete(featureCode);
      }
    }
    const resolvedPermissions = sortText([...permissions]);
    return {
      membership_plan: effectivePlanCode,
      assigned_membership_plan: user.membership_plan,
      membership_expires_at: user.membership_expires_at,
      remaining_membership_days: user.remaining_membership_days,
      membership_active: membershipActive,
      permissions: resolvedPermissions,
      feature_flags: {
        simulation_enabled: resolvedPermissions.includes(FEATURE_CODES.SIMULATION_USE),
        craft_enabled: resolvedPermissions.includes(FEATURE_CODES.CRAFT_USE),
        steam_binding_mode: effectivePlanCode === "member" ? "unlimited" : "single_locked",
        steam_binding_limit: effectivePlanCode === "member" ? -1 : (effectivePlanCode === "inactive" ? 0 : 1),
        trial_active: effectivePlanCode === "trial",
        trial_expires_at: effectivePlanCode === "trial" ? user.membership_expires_at : ""
      }
    };
  }

  updateClientUserEntitlements({userId = 0, membershipPlan = "", membershipExpiresAt = "", permissionOverrides = [], now = new Date()} = {}) {
    const user = this.getClientUserById(userId, {now});
    if (!user) {
      return {ok: false, reason: "user_not_found"};
    }
    const plan = this.getMembershipPlanByCode(membershipPlan || user.membership_plan);
    if (!plan) {
      return {ok: false, reason: "membership_plan_invalid"};
    }
    const stamp = toIsoString(now);
    const expiresAt = plan.code === "inactive" ? "" : asString(membershipExpiresAt).trim();
    this.runInTransaction(() => {
      this.db.prepare(`
        UPDATE client_user
        SET membership_plan = ?, membership_expires_at = ?, updated_at = ?
        WHERE id = ?
      `).run(plan.code, expiresAt, stamp, user.id);
      if (Array.isArray(permissionOverrides)) {
        this.replaceUserPermissionOverrides({
          userId: user.id,
          baselinePermissions: plan.permissions,
          permissionOverrides,
          now: stamp
        });
      }
    });
    return {
      ok: true,
      user: this.getClientUserById(user.id, {now}),
      entitlements: this.resolveUserEntitlements({userId: user.id, now})
    };
  }

  updateClientUserControl({
    userId = 0,
    status = "",
    membershipPlan = "",
    membershipExpiresAt = "",
    permissionOverrides = null,
    now = new Date()
  } = {}) {
    const user = this.getClientUserById(userId, {now});
    if (!user) {
      return {ok: false, reason: "user_not_found"};
    }
    const nextStatus = asString(status).trim() || user.status;
    if (!["active", "disabled"].includes(nextStatus)) {
      return {ok: false, reason: "status_invalid"};
    }
    const plan = this.getMembershipPlanByCode(membershipPlan || user.membership_plan);
    if (!plan) {
      return {ok: false, reason: "membership_plan_invalid"};
    }
    const stamp = toIsoString(now);
    const expiresAt = plan.code === "inactive" ? "" : asString(membershipExpiresAt || user.membership_expires_at).trim();
    this.runInTransaction(() => {
      this.db.prepare(`
        UPDATE client_user
        SET status = ?, membership_plan = ?, membership_expires_at = ?, updated_at = ?
        WHERE id = ?
      `).run(nextStatus, plan.code, expiresAt, stamp, user.id);
      if (Array.isArray(permissionOverrides)) {
        this.replaceUserPermissionOverrides({
          userId: user.id,
          baselinePermissions: plan.permissions,
          permissionOverrides,
          now: stamp
        });
      }
    });
    return {
      ok: true,
      user: this.getClientUserById(user.id, {now}),
      entitlements: this.resolveUserEntitlements({userId: user.id, now})
    };
  }

  listUserSteamBindings({userId = 0, activeOnly = true} = {}) {
    const normalizedUserId = Number(userId) || 0;
    const rows = activeOnly
      ? this.db.prepare(`
        SELECT * FROM client_user_steam_binding
        WHERE user_id = ? AND status = 'active'
        ORDER BY first_bound_at ASC, id ASC
      `).all(normalizedUserId)
      : this.db.prepare(`
        SELECT * FROM client_user_steam_binding
        WHERE user_id = ?
        ORDER BY first_bound_at ASC, id ASC
      `).all(normalizedUserId);
    return rows.map((row) => ({
      id: Number(row.id) || 0,
      user_id: Number(row.user_id) || 0,
      steam_id: asString(row.steam_id).trim(),
      steam_account_name: asString(row.steam_account_name).trim(),
      status: asString(row.status).trim() || "active",
      first_bound_at: asString(row.first_bound_at).trim(),
      last_seen_at: asString(row.last_seen_at).trim(),
      source: asString(row.source).trim() || "client_login_save",
      note: asString(row.note).trim()
    }));
  }

  revokeUserSteamBindingById({userId = 0, bindingId = 0, note = "", now = new Date()} = {}) {
    const targetUserId = Number(userId) || 0;
    const targetBindingId = Number(bindingId) || 0;
    const binding = this.db.prepare(`
      SELECT * FROM client_user_steam_binding
      WHERE id = ? AND user_id = ? AND status = 'active'
      LIMIT 1
    `).get(targetBindingId, targetUserId);
    if (!binding) {
      return {ok: false, reason: "steam_binding_not_found"};
    }
    const stamp = toIsoString(now);
    const result = this.db.prepare(`
      UPDATE client_user_steam_binding
      SET status = 'revoked', last_seen_at = ?, note = ?
      WHERE id = ? AND user_id = ? AND status = 'active'
    `).run(stamp, asString(note).trim(), targetBindingId, targetUserId);
    if (Number(result.changes) <= 0) {
      return {ok: false, reason: "steam_binding_not_found"};
    }
    return {ok: true};
  }

  checkOrBindSteamAccount({userId = 0, steamId = "", steamAccountName = "", now = new Date()} = {}) {
    const user = this.getClientUserById(userId, {now});
    if (!user) {
      return {ok: false, reason: "user_not_found"};
    }
    const normalizedSteamId = asString(steamId).trim();
    if (!normalizedSteamId) {
      return {ok: false, reason: "steam_id_required"};
    }
    const entitlements = this.resolveUserEntitlements({userId: user.id, now});
    const bindingMode = asString(entitlements && entitlements.feature_flags && entitlements.feature_flags.steam_binding_mode).trim()
      || "single_locked";
    const bindingLimit = Number(entitlements && entitlements.feature_flags && entitlements.feature_flags.steam_binding_limit);
    const activeBindings = this.listUserSteamBindings({userId: user.id, activeOnly: true});
    const matchedExisting = activeBindings.find((item) => item.steam_id === normalizedSteamId) || null;
    const baseResult = {
      binding_mode: bindingMode,
      binding_limit: Number.isFinite(bindingLimit) ? bindingLimit : 0,
      bound_count: activeBindings.length,
      matched_existing: !!matchedExisting
    };
    if (!entitlements || entitlements.membership_plan === "inactive" || baseResult.binding_limit === 0) {
      return {
        ok: false,
        reason: "membership_inactive",
        message: "当前账号未开通会员权限，无法绑定新的 Steam 账号",
        ...baseResult
      };
    }
    if (matchedExisting) {
      const stamp = toIsoString(now);
      const nextSteamAccountName = asString(steamAccountName).trim() || matchedExisting.steam_account_name;
      this.db.prepare(`
        UPDATE client_user_steam_binding
        SET steam_account_name = ?, last_seen_at = ?
        WHERE id = ?
      `).run(nextSteamAccountName, stamp, matchedExisting.id);
      return {
        ok: true,
        ...baseResult,
        message: "已匹配既有 Steam 绑定"
      };
    }
    if (baseResult.binding_limit > 0 && activeBindings.length >= baseResult.binding_limit) {
      return {
        ok: false,
        reason: "steam_binding_limit_reached",
        message: "当前账号允许绑定的 Steam 数量已达上限",
        ...baseResult
      };
    }
    const stamp = toIsoString(now);
    this.db.prepare(`
      INSERT INTO client_user_steam_binding(
        user_id, steam_id, steam_account_name, status, first_bound_at, last_seen_at, source, note
      )
      VALUES(?, ?, ?, 'active', ?, ?, 'client_login_save', '')
    `).run(user.id, normalizedSteamId, asString(steamAccountName).trim(), stamp, stamp);
    return {
      ok: true,
      binding_mode: bindingMode,
      binding_limit: baseResult.binding_limit,
      bound_count: activeBindings.length + 1,
      matched_existing: false,
      message: "Steam 绑定资格已确认"
    };
  }

  createRefreshSession({userId = 0, deviceId = "", ttlDays = 30, now = new Date()} = {}) {
    const user = this.getClientUserById(userId);
    if (!user) {
      throw new Error("user not found");
    }
    const deviceText = asString(deviceId).trim();
    if (!deviceText) {
      throw new Error("device_id is required");
    }
    const refreshToken = crypto.randomBytes(24).toString("base64url");
    const stamp = toIsoString(now);
    const expiresAt = new Date(parseTimeMs(stamp) + Math.max(1, Number(ttlDays) || 1) * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.prepare(`
      INSERT INTO refresh_session(token_hash, user_id, device_id, status, created_at, updated_at, last_used_at, expires_at, revoked_at)
      VALUES(?, ?, ?, 'active', ?, ?, ?, ?, '')
    `).run(hashToken(refreshToken), user.id, deviceText, stamp, stamp, stamp, expiresAt);
    return {
      id: Number(result.lastInsertRowid) || 0,
      refresh_token: refreshToken,
      expires_at: expiresAt
    };
  }

  resolveRefreshSession({refreshToken = "", deviceId = "", now = new Date()} = {}) {
    const row = this.db.prepare(`
      SELECT rs.*, cu.email, cu.username, cu.status AS user_status, cu.membership_plan
      FROM refresh_session rs
      JOIN client_user cu ON cu.id = rs.user_id
      WHERE rs.token_hash = ?
      LIMIT 1
    `).get(hashToken(refreshToken));
    if (!row || asString(row.status).trim() !== "active" || asString(row.revoked_at).trim()) {
      return {ok: false, reason: "refresh_token_not_found"};
    }
    if (asString(deviceId).trim() !== asString(row.device_id).trim()) {
      return {ok: false, reason: "device_mismatch"};
    }
    if (parseTimeMs(row.expires_at) <= parseTimeMs(toIsoString(now))) {
      return {ok: false, reason: "refresh_token_expired"};
    }
    if (asString(row.user_status).trim() !== "active") {
      return {ok: false, reason: "user_disabled"};
    }
    const stamp = toIsoString(now);
    this.db.prepare("UPDATE refresh_session SET last_used_at = ?, updated_at = ? WHERE id = ?")
      .run(stamp, stamp, row.id);
    return {
      ok: true,
      session: sanitizeDeviceSession(row),
      user: {
        id: Number(row.user_id) || 0,
        email: asString(row.email).trim(),
        username: asString(row.username).trim(),
        membership_plan: normalizeMembershipPlanCode(row.membership_plan)
      }
    };
  }

  resolveClientAccess({refreshToken = "", deviceId = "", now = new Date()} = {}) {
    const resolved = this.resolveRefreshSession({refreshToken, deviceId, now});
    if (!resolved.ok) {
      return resolved;
    }
    return {
      ok: true,
      session: resolved.session,
      user: this.getClientUserById(resolved.user.id, {now}),
      entitlements: this.resolveUserEntitlements({userId: resolved.user.id, now})
    };
  }

  rotateRefreshSession({refreshToken = "", deviceId = "", ttlDays = 30, now = new Date()} = {}) {
    const resolved = this.resolveRefreshSession({refreshToken, deviceId, now});
    if (!resolved.ok) {
      return resolved;
    }
    const stamp = toIsoString(now);
    this.db.prepare(`
      UPDATE refresh_session
      SET status = 'rotated', revoked_at = ?, updated_at = ?
      WHERE id = ?
    `).run(stamp, stamp, resolved.session.id);
    const next = this.createRefreshSession({
      userId: resolved.user.id,
      deviceId,
      ttlDays,
      now
    });
    return {
      ok: true,
      user: resolved.user,
      refresh_token: next.refresh_token,
      expires_at: next.expires_at
    };
  }

  revokeRefreshSession({refreshToken = "", now = new Date()} = {}) {
    const result = this.db.prepare(`
      UPDATE refresh_session
      SET status = 'revoked', revoked_at = ?, updated_at = ?
      WHERE token_hash = ? AND status = 'active' AND revoked_at = ''
    `).run(toIsoString(now), toIsoString(now), hashToken(refreshToken));
    return Number(result.changes) > 0 ? {ok: true} : {ok: false, reason: "refresh_token_not_found"};
  }

  revokeRefreshSessionById({sessionId = 0, now = new Date()} = {}) {
    const result = this.db.prepare(`
      UPDATE refresh_session
      SET status = 'revoked', revoked_at = ?, updated_at = ?
      WHERE id = ? AND status = 'active' AND revoked_at = ''
    `).run(toIsoString(now), toIsoString(now), Number(sessionId) || 0);
    return Number(result.changes) > 0 ? {ok: true} : {ok: false, reason: "refresh_session_not_found"};
  }

  listUserDeviceSessions({userId = 0, activeOnly = true} = {}) {
    const rows = activeOnly
      ? this.db.prepare(`
        SELECT * FROM refresh_session
        WHERE user_id = ? AND status = 'active' AND revoked_at = ''
        ORDER BY last_used_at DESC, created_at DESC
      `).all(Number(userId) || 0)
      : this.db.prepare(`
        SELECT * FROM refresh_session
        WHERE user_id = ?
        ORDER BY last_used_at DESC, created_at DESC
      `).all(Number(userId) || 0);
    return rows.map((row) => sanitizeDeviceSession(row));
  }

  needsAdminBootstrap() {
    const row = this.db.prepare("SELECT COUNT(1) AS count FROM admin_user").get();
    return (Number(row && row.count) || 0) === 0;
  }

  getAdminUserByUsername(username = "") {
    return sanitizeAdminUser(this.db.prepare("SELECT * FROM admin_user WHERE username = ?").get(asString(username).trim()));
  }

  createOrUpdateAdminUser({username = "admin", password = "", isSuperAdmin = true, now = new Date()} = {}) {
    const usernameText = asString(username).trim() || "admin";
    const stamp = toIsoString(now);
    const existing = this.db.prepare("SELECT * FROM admin_user WHERE username = ?").get(usernameText);
    if (existing) {
      this.db.prepare(`
        UPDATE admin_user
        SET password_hash = ?, status = 'active', is_super_admin = ?, updated_at = ?
        WHERE id = ?
      `).run(hashPassword(password), isSuperAdmin ? 1 : 0, stamp, existing.id);
      return this.getAdminUserByUsername(usernameText);
    }
    const result = this.db.prepare(`
      INSERT INTO admin_user(username, password_hash, status, is_super_admin, created_at, updated_at, last_login_at)
      VALUES(?, ?, 'active', ?, ?, ?, '')
    `).run(usernameText, hashPassword(password), isSuperAdmin ? 1 : 0, stamp, stamp);
    return sanitizeAdminUser(this.db.prepare("SELECT * FROM admin_user WHERE id = ?").get(result.lastInsertRowid));
  }

  authenticateAdminUser({username = "", password = ""} = {}) {
    const row = this.db.prepare("SELECT * FROM admin_user WHERE username = ?").get(asString(username).trim());
    if (!row || asString(row.status).trim() !== "active" || !verifyPassword(password, row.password_hash)) {
      return {ok: false, reason: "invalid_credentials"};
    }
    return {ok: true, user: sanitizeAdminUser(row)};
  }

  createAdminSession({adminUserId = 0, ttlHours = 12, now = new Date()} = {}) {
    const user = sanitizeAdminUser(this.db.prepare("SELECT * FROM admin_user WHERE id = ?").get(Number(adminUserId) || 0));
    if (!user) {
      throw new Error("admin user not found");
    }
    const sessionToken = crypto.randomBytes(24).toString("base64url");
    const stamp = toIsoString(now);
    const expiresAt = new Date(parseTimeMs(stamp) + Math.max(1, Number(ttlHours) || 1) * 60 * 60 * 1000).toISOString();
    this.runInTransaction(() => {
      this.db.prepare(`
        INSERT INTO admin_session(token_hash, admin_user_id, status, created_at, updated_at, last_used_at, expires_at, revoked_at)
        VALUES(?, ?, 'active', ?, ?, ?, ?, '')
      `).run(hashToken(sessionToken), user.id, stamp, stamp, stamp, expiresAt);
      this.db.prepare("UPDATE admin_user SET last_login_at = ?, updated_at = ? WHERE id = ?").run(stamp, stamp, user.id);
    });
    return {
      session_token: sessionToken,
      expires_at: expiresAt
    };
  }

  resolveAdminSession({sessionToken = "", now = new Date()} = {}) {
    const row = this.db.prepare(`
      SELECT s.*, u.username, u.status AS user_status, u.is_super_admin, u.created_at AS user_created_at,
             u.updated_at AS user_updated_at, u.last_login_at
      FROM admin_session s
      JOIN admin_user u ON u.id = s.admin_user_id
      WHERE s.token_hash = ?
      LIMIT 1
    `).get(hashToken(sessionToken));
    if (!row || asString(row.status).trim() !== "active" || asString(row.revoked_at).trim()) {
      return {ok: false, reason: "admin_session_not_found"};
    }
    if (asString(row.user_status).trim() !== "active") {
      return {ok: false, reason: "admin_user_disabled"};
    }
    if (parseTimeMs(row.expires_at) <= parseTimeMs(toIsoString(now))) {
      return {ok: false, reason: "admin_session_expired"};
    }
    const stamp = toIsoString(now);
    this.db.prepare("UPDATE admin_session SET last_used_at = ?, updated_at = ? WHERE id = ?").run(stamp, stamp, row.id);
    return {
      ok: true,
      session: {
        id: Number(row.id) || 0,
        admin_user_id: Number(row.admin_user_id) || 0,
        expires_at: asString(row.expires_at).trim()
      },
      user: sanitizeAdminUser({
        id: row.admin_user_id,
        username: row.username,
        status: row.user_status,
        is_super_admin: row.is_super_admin,
        created_at: row.user_created_at,
        updated_at: row.user_updated_at,
        last_login_at: row.last_login_at
      })
    };
  }

  revokeAdminSession({sessionToken = "", now = new Date()} = {}) {
    const result = this.db.prepare(`
      UPDATE admin_session
      SET status = 'revoked', revoked_at = ?, updated_at = ?
      WHERE token_hash = ? AND status = 'active' AND revoked_at = ''
    `).run(toIsoString(now), toIsoString(now), hashToken(sessionToken));
    return Number(result.changes) > 0 ? {ok: true} : {ok: false, reason: "admin_session_not_found"};
  }

  // --- P1: Login brute-force protection ---

  recordLoginAttempt({username = "", success = false, ip = "", now = new Date()} = {}) {
    this.db.prepare(`
      INSERT INTO login_attempt(username, success, ip, created_at)
      VALUES(?, ?, ?, ?)
    `).run(asString(username).trim(), success ? 1 : 0, asString(ip).trim(), toIsoString(now));
  }

  getRecentFailedAttempts({username = "", windowMs = 15 * 60 * 1000, now = new Date()} = {}) {
    const cutoff = new Date(now.getTime() - windowMs).toISOString();
    const row = this.db.prepare(`
      SELECT COUNT(*) AS cnt FROM login_attempt
      WHERE username = ? AND success = 0 AND created_at >= ?
    `).get(asString(username).trim(), cutoff);
    return Number(row && row.cnt) || 0;
  }

  isLoginLocked({username = "", maxAttempts = 5, windowMs = 15 * 60 * 1000, now = new Date()} = {}) {
    return this.getRecentFailedAttempts({username, windowMs, now}) >= maxAttempts;
  }

  // --- P2: Three-step registration ---

  createRegisterSession({email = "", ttlMs = 10 * 60 * 1000, now = new Date()} = {}) {
    const emailText = asString(email).trim().toLowerCase();
    if (!emailText) {
      throw new Error("email is required for register session");
    }
    const sessionId = crypto.randomUUID();
    const stamp = toIsoString(now);
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    this.db.prepare(`
      UPDATE register_session SET status = 'expired'
      WHERE email = ? AND status = 'pending'
    `).run(emailText);
    this.db.prepare(`
      INSERT INTO register_session(session_id, email, status, created_at, expires_at)
      VALUES(?, ?, 'pending', ?, ?)
    `).run(sessionId, emailText, stamp, expiresAt);
    return {session_id: sessionId, email: emailText, expires_at: expiresAt};
  }

  verifyCodeAndIssueTicket({email = "", code = "", sessionId = "", ticketTtlMs = 10 * 60 * 1000, now = new Date()} = {}) {
    const emailText = asString(email).trim().toLowerCase();
    const codeText = asString(code).trim();
    const sessionIdText = asString(sessionId).trim();
    if (!emailText || !codeText || !sessionIdText) {
      return {ok: false, reason: "verify_payload_incomplete"};
    }
    const session = this.db.prepare(`
      SELECT * FROM register_session WHERE session_id = ? AND email = ? AND status = 'pending'
    `).get(sessionIdText, emailText);
    if (!session) {
      return {ok: false, reason: "register_session_not_found"};
    }
    if (parseTimeMs(session.expires_at) <= now.getTime()) {
      this.db.prepare("UPDATE register_session SET status = 'expired' WHERE id = ?").run(session.id);
      return {ok: false, reason: "register_session_expired"};
    }
    const verified = this.verifyEmailCode({email: emailText, scene: "register", code: codeText, now});
    if (!verified.ok) {
      return {ok: false, reason: verified.reason};
    }
    this.db.prepare("UPDATE register_session SET status = 'verified' WHERE id = ?").run(session.id);
    const ticket = crypto.randomUUID();
    const stamp = toIsoString(now);
    const ticketExpiresAt = new Date(now.getTime() + ticketTtlMs).toISOString();
    this.db.prepare(`
      INSERT INTO verification_ticket(ticket, session_id, email, created_at, expires_at)
      VALUES(?, ?, ?, ?, ?)
    `).run(ticket, sessionIdText, emailText, stamp, ticketExpiresAt);
    return {ok: true, ticket, expires_at: ticketExpiresAt};
  }

  consumeVerificationTicket({email = "", ticket = "", now = new Date()} = {}) {
    const emailText = asString(email).trim().toLowerCase();
    const ticketText = asString(ticket).trim();
    if (!emailText || !ticketText) {
      return {ok: false, reason: "ticket_payload_incomplete"};
    }
    const row = this.db.prepare(`
      SELECT * FROM verification_ticket WHERE ticket = ? AND email = ? AND consumed_at = ''
    `).get(ticketText, emailText);
    if (!row) {
      return {ok: false, reason: "ticket_not_found"};
    }
    if (parseTimeMs(row.expires_at) <= now.getTime()) {
      return {ok: false, reason: "ticket_expired"};
    }
    this.db.prepare(`
      UPDATE verification_ticket SET consumed_at = ? WHERE id = ?
    `).run(toIsoString(now), row.id);
    return {ok: true, reason: "consumed"};
  }
}

module.exports = {
  ControlPlaneStore
};
