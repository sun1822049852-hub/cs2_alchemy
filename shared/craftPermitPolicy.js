const crypto = require("node:crypto");
const {parseTimeMs, stableJsonStringify} = require("./licensePolicy");

function asString(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function normalizeBoolean(value) {
  return value === true || value === 1 || String(value || "").trim().toLowerCase() === "true" || String(value || "").trim() === "1";
}

function normalizeList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((value) => {
    if (Array.isArray(value)) {
      return normalizeList(value);
    }
    if (value && typeof value === "object") {
      return normalizeObject(value);
    }
    return value;
  });
}

function normalizeObject(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const output = {};
  for (const key of Object.keys(input).sort()) {
    if (key === "password") {
      continue;
    }
    const current = input[key];
    if (Array.isArray(current)) {
      output[key] = normalizeList(current);
      continue;
    }
    if (current && typeof current === "object") {
      output[key] = normalizeObject(current);
      continue;
    }
    output[key] = current;
  }
  return output;
}

function buildCraftPermitPayload(action = "", body = {}) {
  const actionCode = asString(action).trim();
  const source = body && typeof body === "object" ? body : {};
  const payload = {
    action: actionCode,
    username: asString(source.username).trim(),
    allow_cooling: normalizeBoolean(source.allow_cooling)
  };
  if (actionCode === "craft.tradeup.execute") {
    if (Array.isArray(source.item_ids) && source.item_ids.length) {
      payload.item_ids = source.item_ids.map((item) => asString(item).trim());
    }
    if (Array.isArray(source.recipes) && source.recipes.length) {
      payload.recipes = normalizeList(source.recipes);
    }
  }
  if (actionCode === "craft.tradeup.with_components.execute") {
    payload.prepare_only = normalizeBoolean(source.prepare_only);
    payload.recipes = normalizeList(source.recipes);
  }
  return payload;
}

function hashCraftPermitPayload(action = "", body = {}) {
  const payload = buildCraftPermitPayload(action, body);
  return `sha256:${crypto.createHash("sha256").update(stableJsonStringify(payload)).digest("hex")}`;
}

function validateCraftPermitSnapshot(snapshot) {
  const value = snapshot && typeof snapshot === "object" ? snapshot : null;
  if (!value) {
    return {ok: false, reason: "snapshot_missing"};
  }
  const requiredKeys = ["sub", "username", "device_id", "action", "account_username", "payload_hash", "jti", "iat", "exp"];
  for (const key of requiredKeys) {
    if (!asString(value[key]).trim()) {
      return {ok: false, reason: `${key}_missing`};
    }
  }
  if (!/^sha256:[0-9a-f]{64}$/i.test(asString(value.payload_hash).trim())) {
    return {ok: false, reason: "payload_hash_invalid"};
  }
  const issuedAt = parseTimeMs(value.iat);
  const expiresAt = parseTimeMs(value.exp);
  if (!issuedAt || !expiresAt) {
    return {ok: false, reason: "time_invalid"};
  }
  if (expiresAt <= issuedAt) {
    return {ok: false, reason: "time_window_invalid"};
  }
  return {ok: true};
}

function isCraftPermitExpired(snapshot, nowValue = Date.now()) {
  const expiresAt = parseTimeMs(snapshot && snapshot.exp);
  const nowMs = typeof nowValue === "number" ? nowValue : parseTimeMs(nowValue);
  if (!expiresAt || !nowMs) {
    return true;
  }
  return nowMs > expiresAt;
}

module.exports = {
  buildCraftPermitPayload,
  hashCraftPermitPayload,
  validateCraftPermitSnapshot,
  isCraftPermitExpired
};
