const crypto = require("node:crypto");
const {DatabaseSync} = require("node:sqlite");
const {ALL_FEATURE_CODES, FEATURE_CODES} = require("../../shared/featureCodes");
const {PATHS} = require("./constants");
const {asString} = require("../../node_sidecar/src/utils");

const LEGACY_MEMBERSHIP_PLAN_CODE_MAP = Object.freeze({
  free: "inactive",
  trial: "member",
  standard: "member",
  pro: "member",
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
    description: "Membership with craft execution",
    permissions: [...DEFAULT_ACTIVE_PERMISSIONS]
  }
];

const EMAIL_CODE_MAX_FAILED_ATTEMPTS = 5;

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

function hashPassword(password, {enforcePolicy = true} = {}) {
  const secret = asString(password);
  const length = [...secret].length;
  if (enforcePolicy && (length < 12 || length > 128)) {
    throw new Error("password_length_invalid");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const params = {N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024};
  const digest = crypto.scryptSync(secret, salt, 64, params).toString("hex");
  return `scrypt$v2$${params.N}$${params.r}$${params.p}$${salt}$${digest}`;
}

function verifyPassword(password, encoded) {
  const secret = asString(password);
  const stored = asString(encoded).trim();
  if (!secret) {
    return false;
  }
  const parts = stored.split("$");
  let salt = "";
  let digest = "";
  let options = undefined;
  if (parts.length === 3 && parts[0] === "scrypt") {
    [, salt, digest] = parts;
  } else if (parts.length === 7 && parts[0] === "scrypt" && parts[1] === "v2") {
    const [, , n, r, p, storedSalt, storedDigest] = parts;
    salt = storedSalt;
    digest = storedDigest;
    options = {N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024};
  }
  if (!salt || !digest) {
    return false;
  }
  const computed = crypto.scryptSync(secret, salt, 64, options);
  const expected = Buffer.from(digest, "hex");
  if (computed.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(computed, expected);
}

function passwordHashNeedsUpgrade(encoded) {
  return !asString(encoded).trim().startsWith("scrypt$v2$");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(asString(token).trim()).digest("hex");
}

function addDays(base, days) {
  return new Date(parseTimeMs(base) + Number(days) * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeActivationCode(value) {
  return asString(value).trim().toUpperCase();
}

function generateActivationCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(16);
  const text = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
  return `CS2-${text.slice(0, 4)}-${text.slice(4, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}`;
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
  if (code !== "member") {
    return false;
  }
  const expiresAtMs = parseTimeMs(expiresAt);
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
    consumed_at: asString(row.consumed_at).trim(),
    failed_attempts: Number(row.failed_attempts) || 0
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
    archived_at: asString(row.archived_at).trim(),
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
    ,family_id: asString(row.family_id).trim()
    ,parent_session_id: Number(row.parent_session_id) || 0
  };
}

class ControlPlaneStore {
  constructor({dbPath = PATHS.DEFAULT_DB_FILE} = {}) {
    this.dbPath = dbPath;
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.ensureSchema();
    this.migrateRefreshSessionFamilies();
    this.migrateLegacyMembershipPlans();
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
        consumed_at TEXT NOT NULL DEFAULT '',
        failed_attempts INTEGER NOT NULL DEFAULT 0
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
        archived_at TEXT NOT NULL DEFAULT '',
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
        family_id TEXT NOT NULL DEFAULT '',
        parent_session_id INTEGER,
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
        csrf_token_hash TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (admin_user_id) REFERENCES admin_user(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS login_attempt (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scene TEXT NOT NULL DEFAULT 'client',
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

      CREATE TABLE IF NOT EXISTS membership_grant (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        source TEXT NOT NULL,
        source_ref TEXT NOT NULL DEFAULT '',
        days INTEGER NOT NULL,
        previous_expires_at TEXT NOT NULL DEFAULT '',
        new_expires_at TEXT NOT NULL,
        admin_user_id INTEGER,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES client_user(id),
        FOREIGN KEY (admin_user_id) REFERENCES admin_user(id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_grant_source_ref
      ON membership_grant(source, source_ref) WHERE source_ref != '';

      CREATE TABLE IF NOT EXISTS activation_code (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL,
        code_hash TEXT NOT NULL UNIQUE,
        code_mask TEXT NOT NULL,
        days INTEGER NOT NULL,
        expires_at TEXT NOT NULL DEFAULT '',
        created_by_admin_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT NOT NULL DEFAULT '',
        redeemed_at TEXT NOT NULL DEFAULT '',
        redeemed_by_user_id INTEGER,
        FOREIGN KEY (created_by_admin_id) REFERENCES admin_user(id),
        FOREIGN KEY (redeemed_by_user_id) REFERENCES client_user(id)
      );

      CREATE TABLE IF NOT EXISTS membership_product (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        membership_days INTEGER NOT NULL,
        price_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'CNY',
        is_enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payment_order (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_no TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL,
        product_id INTEGER,
        product_name TEXT NOT NULL,
        membership_days INTEGER NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'CNY',
        status TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT '',
        external_transaction_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        paid_at TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (user_id) REFERENCES client_user(id),
        FOREIGN KEY (product_id) REFERENCES membership_product(id)
      );

      CREATE TABLE IF NOT EXISTS audit_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_type TEXT NOT NULL,
        actor_id INTEGER,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT '',
        target_id TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        ip TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
    `);
    this.ensureClientUserColumn("membership_expires_at", "TEXT NOT NULL DEFAULT ''");
    this.ensureClientUserColumn("archived_at", "TEXT NOT NULL DEFAULT ''");
    this.ensureEmailCodeColumn("failed_attempts", "INTEGER NOT NULL DEFAULT 0");
    this.ensureTableColumn("refresh_session", "family_id", "TEXT NOT NULL DEFAULT ''");
    this.ensureTableColumn("refresh_session", "parent_session_id", "INTEGER");
    this.ensureTableColumn("admin_session", "csrf_token_hash", "TEXT NOT NULL DEFAULT ''");
    this.ensureTableColumn("login_attempt", "scene", "TEXT NOT NULL DEFAULT 'client'");
  }

  ensureTableColumn(tableName, columnName, definition) {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
    if (columns.some((item) => asString(item && item.name).trim() === columnName)) {
      return;
    }
    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  ensureClientUserColumn(columnName, definition) {
    const columns = this.db.prepare("PRAGMA table_info(client_user)").all();
    if (columns.some((item) => asString(item && item.name).trim() === columnName)) {
      return;
    }
    this.db.exec(`ALTER TABLE client_user ADD COLUMN ${columnName} ${definition}`);
  }

  ensureEmailCodeColumn(columnName, definition) {
    const columns = this.db.prepare("PRAGMA table_info(email_code)").all();
    if (columns.some((item) => asString(item && item.name).trim() === columnName)) {
      return;
    }
    this.db.exec(`ALTER TABLE email_code ADD COLUMN ${columnName} ${definition}`);
  }

  migrateRefreshSessionFamilies() {
    const rows = this.db.prepare("SELECT id, family_id, parent_session_id FROM refresh_session ORDER BY id").all();
    const byId = new Map(rows.map((row) => [Number(row.id), row]));
    const adjacent = new Map(rows.map((row) => [Number(row.id), new Set()]));
    for (const row of rows) {
      const id = Number(row.id);
      const parentId = Number(row.parent_session_id) || 0;
      if (parentId && byId.has(parentId)) {
        adjacent.get(id).add(parentId);
        adjacent.get(parentId).add(id);
      }
    }
    const visited = new Set();
    this.runInTransaction(() => {
      const update = this.db.prepare("UPDATE refresh_session SET family_id = ? WHERE id = ? AND family_id = ''");
      for (const row of rows) {
        const startId = Number(row.id);
        if (visited.has(startId)) continue;
        const pending = [startId];
        const component = [];
        const existingFamilies = [];
        while (pending.length) {
          const id = pending.pop();
          if (visited.has(id)) continue;
          visited.add(id);
          const item = byId.get(id);
          if (!item) continue;
          component.push(item);
          const familyId = asString(item.family_id).trim();
          if (familyId) existingFamilies.push(familyId);
          for (const neighbor of adjacent.get(id) || []) pending.push(neighbor);
        }
        const familyId = existingFamilies[0] || crypto.randomUUID();
        for (const item of component) {
          if (!asString(item.family_id).trim()) update.run(familyId, item.id);
        }
      }
    });
  }

  migrateLegacyMembershipPlans() {
    this.runInTransaction(() => {
      for (const [legacyCode, nextCode] of Object.entries(LEGACY_MEMBERSHIP_PLAN_CODE_MAP)) {
        this.db.prepare("UPDATE client_user SET membership_plan = ? WHERE lower(membership_plan) = ?")
          .run(nextCode, legacyCode);
      }
    });
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
      for (const legacyCode of [...Object.keys(LEGACY_MEMBERSHIP_PLAN_CODE_MAP), "standard", "trial"]) {
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
      INSERT INTO email_code(email, scene, code_hash, expires_at, created_at, consumed_at, failed_attempts)
      VALUES(?, ?, ?, ?, ?, '', 0)
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
      const failedAttempts = active.failed_attempts + 1;
      const consumedAt = failedAttempts >= EMAIL_CODE_MAX_FAILED_ATTEMPTS ? toIsoString(now) : "";
      this.db.prepare(`
        UPDATE email_code
        SET failed_attempts = ?, consumed_at = CASE WHEN ? != '' THEN ? ELSE consumed_at END
        WHERE id = ?
      `).run(failedAttempts, consumedAt, consumedAt, active.id);
      if (failedAttempts >= EMAIL_CODE_MAX_FAILED_ATTEMPTS) {
        return {ok: false, reason: "code_attempt_limit_exceeded"};
      }
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

  listClientUsers({now = new Date(), includeArchived = false} = {}) {
    const rows = includeArchived
      ? this.db.prepare("SELECT * FROM client_user ORDER BY created_at ASC").all()
      : this.db.prepare("SELECT * FROM client_user WHERE status != 'archived' ORDER BY created_at ASC").all();
    return rows.map((row) => sanitizeClientUser(row, {now}));
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
    if (passwordHashNeedsUpgrade(row.password_hash)) {
      this.db.prepare("UPDATE client_user SET password_hash = ?, updated_at = ? WHERE id = ?")
        .run(hashPassword(password, {enforcePolicy: false}), toIsoString(), row.id);
    }
    return {ok: true, user: sanitizeClientUser(row)};
  }

  updateClientPassword({email = "", newPassword = "", ip = "", now = new Date()} = {}) {
    const user = this.getClientUserByEmail(email, {now});
    if (!user) {
      return {ok: false, reason: "user_not_found"};
    }
    const stamp = toIsoString(now);
    this.runInTransaction(() => {
      this.db.prepare(`
        UPDATE client_user SET password_hash = ?, updated_at = ? WHERE id = ?
      `).run(hashPassword(newPassword), stamp, user.id);
      this.revokeAllUserRefreshSessions({userId: user.id, now: stamp});
      this.appendAuditEvent({
        actorType: "client_user",
        actorId: user.id,
        action: "user.password_reset",
        targetType: "client_user",
        targetId: user.id,
        ip,
        now: stamp
      });
    });
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
        craft_enabled: resolvedPermissions.includes(FEATURE_CODES.CRAFT_USE)
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
    adminUserId = 0,
    auditIp = "",
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
      if (nextStatus === "disabled") {
        this.revokeAllUserRefreshSessions({userId: user.id, now: stamp});
      }
      this.appendAuditEvent({
        actorType: "admin",
        actorId: adminUserId,
        action: "user.access_updated",
        targetType: "client_user",
        targetId: user.id,
        metadata: {
          status: nextStatus,
          membership_plan: plan.code,
          membership_expires_at: expiresAt,
          permission_overrides_changed: Array.isArray(permissionOverrides)
        },
        ip: auditIp,
        now: stamp
      });
    });
    return {
      ok: true,
      user: this.getClientUserById(user.id, {now}),
      entitlements: this.resolveUserEntitlements({userId: user.id, now})
    };
  }

  createRefreshSession({userId = 0, deviceId = "", ttlDays = 30, now = new Date(), familyId = "", parentSessionId = null} = {}) {
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
    const resolvedFamilyId = asString(familyId).trim() || crypto.randomUUID();
    const result = this.db.prepare(`
      INSERT INTO refresh_session(
        token_hash, user_id, device_id, status, created_at, updated_at, last_used_at, expires_at,
        revoked_at, family_id, parent_session_id
      )
      VALUES(?, ?, ?, 'active', ?, ?, ?, ?, '', ?, ?)
    `).run(hashToken(refreshToken), user.id, deviceText, stamp, stamp, stamp, expiresAt,
      resolvedFamilyId, Number(parentSessionId) || null);
    return {
      id: Number(result.lastInsertRowid) || 0,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      family_id: resolvedFamilyId,
      parent_session_id: Number(parentSessionId) || 0
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
    const stamp = toIsoString(now);
    const row = this.db.prepare(`
      SELECT rs.*, cu.status AS user_status
      FROM refresh_session rs
      JOIN client_user cu ON cu.id = rs.user_id
      WHERE rs.token_hash = ? LIMIT 1
    `).get(hashToken(refreshToken));
    if (!row) {
      return {ok: false, reason: "refresh_token_not_found"};
    }
    if (asString(row.status).trim() === "rotated") {
      this.revokeRefreshFamily({familyId: row.family_id, now: stamp});
      return {ok: false, reason: "refresh_token_reused"};
    }
    if (asString(row.status).trim() !== "active" || asString(row.revoked_at).trim()) {
      return {ok: false, reason: "refresh_token_not_found"};
    }
    if (asString(row.device_id).trim() !== asString(deviceId).trim()) {
      return {ok: false, reason: "device_mismatch"};
    }
    if (parseTimeMs(row.expires_at) <= parseTimeMs(stamp)) {
      return {ok: false, reason: "refresh_token_expired"};
    }
    if (asString(row.user_status).trim() !== "active") {
      return {ok: false, reason: "user_disabled"};
    }
    return this.runInTransaction(() => {
      const familyId = asString(row.family_id).trim() || crypto.randomUUID();
      if (!asString(row.family_id).trim()) {
        this.db.prepare("UPDATE refresh_session SET family_id = ? WHERE id = ?")
          .run(familyId, row.id);
      }
      const changed = this.db.prepare(`
        UPDATE refresh_session SET status = 'rotated', updated_at = ?
        WHERE id = ? AND status = 'active' AND revoked_at = ''
      `).run(stamp, row.id);
      if (Number(changed.changes) !== 1) {
        throw new Error("refresh session rotation conflict");
      }
      const next = this.createRefreshSession({
        userId: row.user_id,
        deviceId,
        ttlDays,
        now: stamp,
        familyId,
        parentSessionId: row.id
      });
      return {
        ok: true,
        user: this.getClientUserById(row.user_id, {now}),
        refresh_token: next.refresh_token,
        expires_at: next.expires_at,
        family_id: next.family_id,
        parent_session_id: next.parent_session_id
      };
    });
  }

  revokeRefreshFamily({familyId = "", now = new Date()} = {}) {
    const resolvedFamilyId = asString(familyId).trim();
    if (!resolvedFamilyId) {
      return {ok: false, reason: "refresh_family_id_required", revoked_count: 0};
    }
    const stamp = toIsoString(now);
    const result = this.db.prepare(`
      UPDATE refresh_session SET status = 'revoked', revoked_at = ?, updated_at = ?
      WHERE family_id = ? AND status != 'revoked'
    `).run(stamp, stamp, resolvedFamilyId);
    return {ok: true, revoked_count: Number(result.changes) || 0};
  }

  revokeAllUserRefreshSessions({userId = 0, now = new Date()} = {}) {
    const stamp = toIsoString(now);
    const result = this.db.prepare(`
      UPDATE refresh_session SET status = 'revoked', revoked_at = ?, updated_at = ?
      WHERE user_id = ? AND status = 'active' AND revoked_at = ''
    `).run(stamp, stamp, Number(userId) || 0);
    return {ok: true, revoked_count: Number(result.changes) || 0};
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

  appendAuditEvent({actorType = "system", actorId = null, action = "", targetType = "", targetId = "", metadata = {}, ip = "", now = new Date()} = {}) {
    const actionText = asString(action).trim();
    if (!actionText) {
      throw new Error("audit action is required");
    }
    const result = this.db.prepare(`
      INSERT INTO audit_event(actor_type, actor_id, action, target_type, target_id, metadata_json, ip, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      asString(actorType).trim() || "system",
      Number(actorId) || null,
      actionText,
      asString(targetType).trim(),
      asString(targetId).trim(),
      JSON.stringify(metadata && typeof metadata === "object" ? metadata : {}),
      asString(ip).trim(),
      toIsoString(now)
    );
    return Number(result.lastInsertRowid) || 0;
  }

  listAuditEvents({limit = 200} = {}) {
    return this.db.prepare("SELECT * FROM audit_event ORDER BY id DESC LIMIT ?")
      .all(Math.max(1, Math.min(1000, Number(limit) || 200)))
      .map((row) => ({
        id: Number(row.id) || 0,
        actor_type: asString(row.actor_type).trim(),
        actor_id: Number(row.actor_id) || 0,
        action: asString(row.action).trim(),
        target_type: asString(row.target_type).trim(),
        target_id: asString(row.target_id).trim(),
        metadata: JSON.parse(asString(row.metadata_json).trim() || "{}"),
        ip: asString(row.ip).trim(),
        created_at: asString(row.created_at).trim()
      }));
  }

  grantMembership({userId = 0, days = 0, source = "admin", sourceRef = "", adminUserId = null, now = new Date()} = {}) {
    const normalizedDays = Number(days);
    if (!Number.isInteger(normalizedDays) || normalizedDays < 1 || normalizedDays > 3650) {
      return {ok: false, reason: "membership_days_invalid"};
    }
    const user = this.getClientUserById(userId, {now});
    if (!user || user.status === "archived") {
      return {ok: false, reason: "user_not_found"};
    }
    const stamp = toIsoString(now);
    const base = parseTimeMs(user.membership_expires_at) > parseTimeMs(stamp)
      ? user.membership_expires_at
      : stamp;
    const expiresAt = addDays(base, normalizedDays);
    this.db.prepare(`
      UPDATE client_user SET membership_plan = 'member', membership_expires_at = ?, updated_at = ? WHERE id = ?
    `).run(expiresAt, stamp, user.id);
    const result = this.db.prepare(`
      INSERT INTO membership_grant(
        user_id, source, source_ref, days, previous_expires_at, new_expires_at, admin_user_id, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, asString(source).trim() || "admin", asString(sourceRef).trim(), normalizedDays,
      user.membership_expires_at, expiresAt, Number(adminUserId) || null, stamp);
    return {
      ok: true,
      grant_id: Number(result.lastInsertRowid) || 0,
      user: this.getClientUserById(user.id, {now})
    };
  }

  listMembershipGrants({userId = 0} = {}) {
    const rows = Number(userId)
      ? this.db.prepare("SELECT * FROM membership_grant WHERE user_id = ? ORDER BY id ASC").all(Number(userId))
      : this.db.prepare("SELECT * FROM membership_grant ORDER BY id ASC").all();
    return rows.map((row) => ({
      id: Number(row.id) || 0,
      user_id: Number(row.user_id) || 0,
      source: asString(row.source).trim(),
      source_ref: asString(row.source_ref).trim(),
      days: Number(row.days) || 0,
      previous_expires_at: asString(row.previous_expires_at).trim(),
      new_expires_at: asString(row.new_expires_at).trim(),
      admin_user_id: Number(row.admin_user_id) || 0,
      created_at: asString(row.created_at).trim()
    }));
  }

  createManagedClientUser({email = "", username = "", password = "", membershipDays = 0, adminUserId = 0, now = new Date()} = {}) {
    const days = Number(membershipDays) || 0;
    if (!Number.isInteger(days) || days < 0 || days > 3650) {
      return {ok: false, reason: "membership_days_invalid"};
    }
    return this.runInTransaction(() => {
      const user = this.createClientUser({email, username, password, now});
      let nextUser = user;
      if (days > 0) {
        nextUser = this.grantMembership({
          userId: user.id,
          days,
          source: "admin_create",
          sourceRef: `user:${user.id}`,
          adminUserId,
          now
        }).user;
      }
      this.appendAuditEvent({
        actorType: "admin", actorId: adminUserId, action: "user.created",
        targetType: "client_user", targetId: user.id, metadata: {membership_days: days}, now
      });
      return {ok: true, user: nextUser};
    });
  }

  archiveClientUser({userId = 0, adminUserId = 0, now = new Date()} = {}) {
    const user = this.getClientUserById(userId, {now});
    if (!user) return {ok: false, reason: "user_not_found"};
    if (user.status === "archived") return {ok: true, user};
    const stamp = toIsoString(now);
    return this.runInTransaction(() => {
      this.db.prepare("UPDATE client_user SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?")
        .run(stamp, stamp, user.id);
      this.revokeAllUserRefreshSessions({userId: user.id, now: stamp});
      this.appendAuditEvent({actorType: "admin", actorId: adminUserId, action: "user.archived", targetType: "client_user", targetId: user.id, now: stamp});
      return {ok: true, user: this.getClientUserById(user.id, {now})};
    });
  }

  restoreClientUser({userId = 0, adminUserId = 0, now = new Date()} = {}) {
    const user = this.getClientUserById(userId, {now});
    if (!user) return {ok: false, reason: "user_not_found"};
    if (user.status !== "archived") return {ok: false, reason: "user_not_archived"};
    const stamp = toIsoString(now);
    return this.runInTransaction(() => {
      this.db.prepare("UPDATE client_user SET status = 'active', archived_at = '', updated_at = ? WHERE id = ?")
        .run(stamp, user.id);
      this.appendAuditEvent({actorType: "admin", actorId: adminUserId, action: "user.restored", targetType: "client_user", targetId: user.id, now: stamp});
      return {ok: true, user: this.getClientUserById(user.id, {now})};
    });
  }

  resetClientUserPassword({userId = 0, newPassword = "", adminUserId = 0, now = new Date()} = {}) {
    const user = this.getClientUserById(userId, {now});
    if (!user) return {ok: false, reason: "user_not_found"};
    const stamp = toIsoString(now);
    return this.runInTransaction(() => {
      this.db.prepare("UPDATE client_user SET password_hash = ?, updated_at = ? WHERE id = ?")
        .run(hashPassword(newPassword), stamp, user.id);
      this.revokeAllUserRefreshSessions({userId: user.id, now: stamp});
      this.appendAuditEvent({actorType: "admin", actorId: adminUserId, action: "user.password_reset", targetType: "client_user", targetId: user.id, now: stamp});
      return {ok: true, user: this.getClientUserById(user.id, {now})};
    });
  }

  bulkGrantMembership({userIds = [], days = 0, adminUserId = 0, now = new Date()} = {}) {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map((id) => Number(id) || 0))];
    const normalizedDays = Number(days);
    if (!ids.length) return {ok: false, reason: "user_ids_required"};
    if (!Number.isInteger(normalizedDays) || normalizedDays < 1 || normalizedDays > 3650) {
      return {ok: false, reason: "membership_days_invalid"};
    }
    const users = ids.map((id) => this.getClientUserById(id, {now}));
    if (users.some((user) => !user || user.status === "archived")) {
      return {ok: false, reason: "user_not_found"};
    }
    return this.runInTransaction(() => {
      const results = users.map((user) => this.grantMembership({
        userId: user.id, days: normalizedDays, source: "admin_bulk",
        sourceRef: `${crypto.randomUUID()}:${user.id}`, adminUserId, now
      }));
      this.appendAuditEvent({
        actorType: "admin", actorId: adminUserId, action: "membership.bulk_granted",
        targetType: "client_user", metadata: {user_ids: ids, days: normalizedDays}, now
      });
      return {ok: true, items: results.map((item) => item.user)};
    });
  }

  generateActivationCodes({count = 1, days = 0, expiresAt = "", adminUserId = 0, now = new Date()} = {}) {
    const normalizedCount = Number(count);
    const normalizedDays = Number(days);
    const expiry = asString(expiresAt).trim();
    if (!Number.isInteger(normalizedCount) || normalizedCount < 1 || normalizedCount > 500) {
      return {ok: false, reason: "activation_code_count_invalid"};
    }
    if (!Number.isInteger(normalizedDays) || normalizedDays < 1 || normalizedDays > 3650) {
      return {ok: false, reason: "membership_days_invalid"};
    }
    if (expiry && (!parseTimeMs(expiry) || parseTimeMs(expiry) <= parseTimeMs(toIsoString(now)))) {
      return {ok: false, reason: "activation_code_expiry_invalid"};
    }
    const batchId = crypto.randomUUID();
    const stamp = toIsoString(now);
    return this.runInTransaction(() => {
      const codes = [];
      for (let index = 0; index < normalizedCount; index += 1) {
        const code = generateActivationCode();
        const mask = `${code.slice(0, 8)}-****-****-${code.slice(-4)}`;
        const result = this.db.prepare(`
          INSERT INTO activation_code(
            batch_id, code_hash, code_mask, days, expires_at, created_by_admin_id, created_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?)
        `).run(batchId, hashToken(normalizeActivationCode(code)), mask, normalizedDays, expiry, Number(adminUserId) || 0, stamp);
        codes.push({id: Number(result.lastInsertRowid) || 0, code, code_mask: mask, days: normalizedDays, expires_at: expiry});
      }
      this.appendAuditEvent({
        actorType: "admin", actorId: adminUserId, action: "activation_codes.generated",
        targetType: "activation_code_batch", targetId: batchId,
        metadata: {count: normalizedCount, days: normalizedDays, expires_at: expiry}, now: stamp
      });
      return {ok: true, batch_id: batchId, codes};
    });
  }

  listActivationCodes({status = "", batchId = "", now = new Date()} = {}) {
    const rows = this.db.prepare(`
      SELECT * FROM activation_code
      WHERE (? = '' OR batch_id = ?)
      ORDER BY id DESC
    `).all(asString(batchId).trim(), asString(batchId).trim());
    const stampMs = parseTimeMs(toIsoString(now));
    return rows.map((row) => {
      let resolvedStatus = "available";
      if (asString(row.redeemed_at).trim()) resolvedStatus = "used";
      else if (asString(row.revoked_at).trim()) resolvedStatus = "revoked";
      else if (parseTimeMs(row.expires_at) && parseTimeMs(row.expires_at) <= stampMs) resolvedStatus = "expired";
      return {
        id: Number(row.id) || 0,
        batch_id: asString(row.batch_id).trim(),
        code_mask: asString(row.code_mask).trim(),
        days: Number(row.days) || 0,
        status: resolvedStatus,
        expires_at: asString(row.expires_at).trim(),
        created_at: asString(row.created_at).trim(),
        revoked_at: asString(row.revoked_at).trim(),
        redeemed_at: asString(row.redeemed_at).trim(),
        redeemed_by_user_id: Number(row.redeemed_by_user_id) || 0
      };
    }).filter((row) => !status || row.status === status);
  }

  revokeActivationCode({activationCodeId = 0, adminUserId = 0, now = new Date()} = {}) {
    const stamp = toIsoString(now);
    return this.runInTransaction(() => {
      const row = this.db.prepare("SELECT * FROM activation_code WHERE id = ?").get(Number(activationCodeId) || 0);
      if (!row) return {ok: false, reason: "activation_code_not_found"};
      if (asString(row.redeemed_at).trim()) return {ok: false, reason: "activation_code_used"};
      if (asString(row.revoked_at).trim()) return {ok: true};
      this.db.prepare("UPDATE activation_code SET revoked_at = ? WHERE id = ? AND redeemed_at = ''")
        .run(stamp, row.id);
      this.appendAuditEvent({actorType: "admin", actorId: adminUserId, action: "activation_code.revoked", targetType: "activation_code", targetId: row.id, now: stamp});
      return {ok: true};
    });
  }

  redeemActivationCode({userId = 0, code = "", now = new Date()} = {}) {
    const normalizedCode = normalizeActivationCode(code);
    if (!normalizedCode) return {ok: false, reason: "activation_code_required"};
    const stamp = toIsoString(now);
    return this.runInTransaction(() => {
      const row = this.db.prepare("SELECT * FROM activation_code WHERE code_hash = ?")
        .get(hashToken(normalizedCode));
      if (!row) return {ok: false, reason: "activation_code_not_found"};
      if (asString(row.redeemed_at).trim()) return {ok: false, reason: "activation_code_used"};
      if (asString(row.revoked_at).trim()) return {ok: false, reason: "activation_code_revoked"};
      if (parseTimeMs(row.expires_at) && parseTimeMs(row.expires_at) <= parseTimeMs(stamp)) {
        return {ok: false, reason: "activation_code_expired"};
      }
      const changed = this.db.prepare(`
        UPDATE activation_code SET redeemed_at = ?, redeemed_by_user_id = ?
        WHERE id = ? AND redeemed_at = '' AND revoked_at = ''
      `).run(stamp, Number(userId) || 0, row.id);
      if (Number(changed.changes) !== 1) return {ok: false, reason: "activation_code_used"};
      const granted = this.grantMembership({
        userId, days: row.days, source: "activation_code", sourceRef: String(row.id), now: stamp
      });
      if (!granted.ok) throw new Error(granted.reason);
      this.appendAuditEvent({
        actorType: "client_user", actorId: userId, action: "activation_code.redeemed",
        targetType: "activation_code", targetId: row.id,
        metadata: {days: Number(row.days) || 0}, now: stamp
      });
      return {ok: true, user: granted.user, grant_id: granted.grant_id};
    });
  }

  sanitizeProduct(row) {
    if (!row) return null;
    return {
      id: Number(row.id) || 0,
      name: asString(row.name).trim(),
      description: asString(row.description).trim(),
      membership_days: Number(row.membership_days) || 0,
      price_cents: Number(row.price_cents) || 0,
      currency: asString(row.currency).trim() || "CNY",
      is_enabled: Number(row.is_enabled) === 1,
      sort_order: Number(row.sort_order) || 0,
      created_at: asString(row.created_at).trim(),
      updated_at: asString(row.updated_at).trim()
    };
  }

  createProduct({name = "", description = "", membershipDays = 0, priceCents = 0, isEnabled = true, sortOrder = 0, adminUserId = 0, now = new Date()} = {}) {
    const nameText = asString(name).trim();
    const days = Number(membershipDays);
    const cents = Number(priceCents);
    if (!nameText) throw new Error("product name is required");
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("membership_days_invalid");
    if (!Number.isInteger(cents) || cents < 0) throw new Error("price_cents_invalid");
    const stamp = toIsoString(now);
    const result = this.db.prepare(`
      INSERT INTO membership_product(name, description, membership_days, price_cents, is_enabled, sort_order, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `).run(nameText, asString(description).trim(), days, cents, isEnabled ? 1 : 0, Number(sortOrder) || 0, stamp, stamp);
    this.appendAuditEvent({actorType: "admin", actorId: adminUserId, action: "product.created", targetType: "membership_product", targetId: result.lastInsertRowid, now: stamp});
    return this.sanitizeProduct(this.db.prepare("SELECT * FROM membership_product WHERE id = ?").get(result.lastInsertRowid));
  }

  updateProduct({productId = 0, name, description, membershipDays, priceCents, isEnabled, sortOrder, adminUserId = 0, now = new Date()} = {}) {
    const row = this.db.prepare("SELECT * FROM membership_product WHERE id = ?").get(Number(productId) || 0);
    if (!row) return null;
    const next = {
      name: name === undefined ? row.name : asString(name).trim(),
      description: description === undefined ? row.description : asString(description).trim(),
      days: membershipDays === undefined ? Number(row.membership_days) : Number(membershipDays),
      cents: priceCents === undefined ? Number(row.price_cents) : Number(priceCents),
      enabled: isEnabled === undefined ? Number(row.is_enabled) : (isEnabled ? 1 : 0),
      sort: sortOrder === undefined ? Number(row.sort_order) : Number(sortOrder)
    };
    if (!next.name) throw new Error("product name is required");
    if (!Number.isInteger(next.days) || next.days < 1 || next.days > 3650) throw new Error("membership_days_invalid");
    if (!Number.isInteger(next.cents) || next.cents < 0) throw new Error("price_cents_invalid");
    const stamp = toIsoString(now);
    this.db.prepare(`
      UPDATE membership_product SET name = ?, description = ?, membership_days = ?, price_cents = ?,
        is_enabled = ?, sort_order = ?, updated_at = ? WHERE id = ?
    `).run(next.name, next.description, next.days, next.cents, next.enabled, next.sort, stamp, row.id);
    this.appendAuditEvent({actorType: "admin", actorId: adminUserId, action: "product.updated", targetType: "membership_product", targetId: row.id, now: stamp});
    return this.sanitizeProduct(this.db.prepare("SELECT * FROM membership_product WHERE id = ?").get(row.id));
  }

  deleteProduct({productId = 0, adminUserId = 0, now = new Date()} = {}) {
    const id = Number(productId) || 0;
    const row = this.db.prepare("SELECT * FROM membership_product WHERE id = ?").get(id);
    if (!row) return {ok: false, reason: "product_not_found"};
    const referenced = this.db.prepare("SELECT COUNT(1) AS count FROM payment_order WHERE product_id = ?").get(id);
    if ((Number(referenced && referenced.count) || 0) > 0) {
      return {ok: false, reason: "product_in_use"};
    }
    return this.runInTransaction(() => {
      this.db.prepare("DELETE FROM membership_product WHERE id = ?").run(id);
      this.appendAuditEvent({
        actorType: "admin", actorId: adminUserId, action: "product.deleted",
        targetType: "membership_product", targetId: id, now
      });
      return {ok: true};
    });
  }

  listProducts({enabledOnly = false} = {}) {
    const rows = enabledOnly
      ? this.db.prepare("SELECT * FROM membership_product WHERE is_enabled = 1 ORDER BY sort_order ASC, id ASC").all()
      : this.db.prepare("SELECT * FROM membership_product ORDER BY sort_order ASC, id ASC").all();
    return rows.map((row) => this.sanitizeProduct(row));
  }

  listOrders({limit = 500} = {}) {
    return this.db.prepare("SELECT * FROM payment_order ORDER BY id DESC LIMIT ?")
      .all(Math.max(1, Math.min(1000, Number(limit) || 500)))
      .map((row) => ({
        id: Number(row.id) || 0,
        order_no: asString(row.order_no).trim(),
        user_id: Number(row.user_id) || 0,
        product_id: Number(row.product_id) || 0,
        product_name: asString(row.product_name).trim(),
        membership_days: Number(row.membership_days) || 0,
        amount_cents: Number(row.amount_cents) || 0,
        currency: asString(row.currency).trim() || "CNY",
        status: asString(row.status).trim(),
        provider: asString(row.provider).trim(),
        external_transaction_id: asString(row.external_transaction_id).trim(),
        created_at: asString(row.created_at).trim(),
        updated_at: asString(row.updated_at).trim(),
        paid_at: asString(row.paid_at).trim()
      }));
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
    if (passwordHashNeedsUpgrade(row.password_hash)) {
      this.db.prepare("UPDATE admin_user SET password_hash = ?, updated_at = ? WHERE id = ?")
        .run(hashPassword(password, {enforcePolicy: false}), toIsoString(), row.id);
    }
    return {ok: true, user: sanitizeAdminUser(row)};
  }

  createAdminSession({adminUserId = 0, ttlHours = 8, now = new Date()} = {}) {
    const user = sanitizeAdminUser(this.db.prepare("SELECT * FROM admin_user WHERE id = ?").get(Number(adminUserId) || 0));
    if (!user) {
      throw new Error("admin user not found");
    }
    const sessionToken = crypto.randomBytes(24).toString("base64url");
    const csrfToken = crypto.randomBytes(24).toString("base64url");
    const stamp = toIsoString(now);
    const expiresAt = new Date(parseTimeMs(stamp) + Math.max(1, Number(ttlHours) || 1) * 60 * 60 * 1000).toISOString();
    this.runInTransaction(() => {
      this.db.prepare(`
        INSERT INTO admin_session(
          token_hash, admin_user_id, status, created_at, updated_at, last_used_at, expires_at, revoked_at, csrf_token_hash
        ) VALUES(?, ?, 'active', ?, ?, ?, ?, '', ?)
      `).run(hashToken(sessionToken), user.id, stamp, stamp, stamp, expiresAt, hashToken(csrfToken));
      this.db.prepare("UPDATE admin_user SET last_login_at = ?, updated_at = ? WHERE id = ?").run(stamp, stamp, user.id);
    });
    return {
      session_token: sessionToken,
      csrf_token: csrfToken,
      expires_at: expiresAt
    };
  }

  resolveAdminSession({sessionToken = "", idleTimeoutMs = 30 * 60 * 1000, now = new Date()} = {}) {
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
    const stamp = toIsoString(now);
    if (parseTimeMs(row.expires_at) <= parseTimeMs(stamp)
      || parseTimeMs(row.last_used_at) + Math.max(1, Number(idleTimeoutMs) || 1) <= parseTimeMs(stamp)) {
      this.db.prepare("UPDATE admin_session SET status = 'expired', revoked_at = ?, updated_at = ? WHERE id = ?")
        .run(stamp, stamp, row.id);
      return {ok: false, reason: "admin_session_expired"};
    }
    this.db.prepare("UPDATE admin_session SET last_used_at = ?, updated_at = ? WHERE id = ?").run(stamp, stamp, row.id);
    return {
      ok: true,
      session: {
        id: Number(row.id) || 0,
        admin_user_id: Number(row.admin_user_id) || 0,
        expires_at: asString(row.expires_at).trim(),
        last_used_at: stamp
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

  verifyAdminCsrf({sessionId = 0, csrfToken = ""} = {}) {
    const row = this.db.prepare("SELECT csrf_token_hash FROM admin_session WHERE id = ?").get(Number(sessionId) || 0);
    const actual = Buffer.from(hashToken(csrfToken), "hex");
    const expected = Buffer.from(asString(row && row.csrf_token_hash).trim(), "hex");
    return actual.length === expected.length && actual.length > 0 && crypto.timingSafeEqual(actual, expected);
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

  recordLoginAttempt({scene = "client", username = "", success = false, ip = "", now = new Date()} = {}) {
    const sceneText = asString(scene).trim() || "client";
    const usernameText = asString(username).trim().toLowerCase();
    if (success) {
      this.db.prepare("DELETE FROM login_attempt WHERE scene = ? AND username = ? AND success = 0")
        .run(sceneText, usernameText);
      return;
    }
    this.db.prepare(`
      INSERT INTO login_attempt(scene, username, success, ip, created_at)
      VALUES(?, ?, 0, ?, ?)
    `).run(sceneText, usernameText, asString(ip).trim(), toIsoString(now));
  }

  getRecentFailedAttempts({scene = "client", username = "", ip = "", windowMs = 15 * 60 * 1000, now = new Date()} = {}) {
    const nowMs = parseTimeMs(toIsoString(now));
    const cutoff = new Date(nowMs - windowMs).toISOString();
    const sceneText = asString(scene).trim() || "client";
    const usernameText = asString(username).trim().toLowerCase();
    const ipText = asString(ip).trim();
    if (ipText && !usernameText) {
      const row = this.db.prepare(`
        SELECT COUNT(*) AS cnt FROM login_attempt
        WHERE scene = ? AND ip = ? AND success = 0 AND created_at >= ?
      `).get(sceneText, ipText, cutoff);
      return Number(row && row.cnt) || 0;
    }
    const row = this.db.prepare(`
      SELECT COUNT(*) AS cnt FROM login_attempt
      WHERE scene = ? AND username = ? AND success = 0 AND created_at >= ?
    `).get(sceneText, usernameText, cutoff);
    return Number(row && row.cnt) || 0;
  }

  getLoginRateLimit({scene = "client", username = "", ip = "", windowMs = 15 * 60 * 1000, now = new Date()} = {}) {
    const accountFailures = this.getRecentFailedAttempts({scene, username, windowMs, now});
    const ipFailures = this.getRecentFailedAttempts({scene, ip, windowMs, now});
    if (accountFailures >= 5) return {limited: true, reason: "account_login_rate_limited"};
    if (ipFailures >= 20) return {limited: true, reason: "ip_login_rate_limited"};
    return {limited: false, reason: ""};
  }

  isLoginLocked({scene = "client", username = "", ip = "", maxAttempts = 5, windowMs = 15 * 60 * 1000, now = new Date()} = {}) {
    if (Number(maxAttempts) !== 5) {
      return this.getRecentFailedAttempts({scene, username, windowMs, now}) >= Number(maxAttempts);
    }
    return this.getLoginRateLimit({scene, username, ip, windowMs, now}).limited;
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
