const {FEATURE_CODES, ALL_FEATURE_CODES} = require("./featureCodes");

function asString(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function stableJsonStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseTimeMs(value) {
  const text = asString(value).trim();
  if (!text) {
    return 0;
  }
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : 0;
}

function validateSnapshot(snapshot) {
  const value = snapshot && typeof snapshot === "object" ? snapshot : null;
  if (!value) {
    return {ok: false, reason: "snapshot_missing"};
  }
  const requiredKeys = ["sub", "username", "device_id", "membership_plan", "jti", "iat", "exp"];
  for (const key of requiredKeys) {
    if (!asString(value[key]).trim()) {
      return {ok: false, reason: `${key}_missing`};
    }
  }
  if (!Array.isArray(value.permissions)) {
    return {ok: false, reason: "permissions_missing"};
  }
  const invalidPermission = value.permissions.find((code) => !ALL_FEATURE_CODES.includes(asString(code).trim()));
  if (invalidPermission) {
    return {ok: false, reason: "permissions_invalid"};
  }
  if (!value.feature_flags || typeof value.feature_flags !== "object" || Array.isArray(value.feature_flags)) {
    return {ok: false, reason: "feature_flags_invalid"};
  }
  const issuedAt = parseTimeMs(value.iat);
  const expiresAt = parseTimeMs(value.exp);
  if (!issuedAt || !expiresAt) {
    return {ok: false, reason: "time_invalid"};
  }
  if (expiresAt <= issuedAt) {
    return {ok: false, reason: "time_window_invalid"};
  }
  const policyVersion = Number(value.policy_version);
  if (!Number.isInteger(policyVersion) || policyVersion < 1) {
    return {ok: false, reason: "policy_version_invalid"};
  }
  return {ok: true};
}

function isSnapshotExpired(snapshot, nowValue = Date.now()) {
  const expiresAt = parseTimeMs(snapshot && snapshot.exp);
  const nowMs = typeof nowValue === "number" ? nowValue : parseTimeMs(nowValue);
  if (!expiresAt || !nowMs) {
    return true;
  }
  return nowMs > expiresAt;
}

function hasFeature(snapshot, code) {
  const permissions = Array.isArray(snapshot && snapshot.permissions) ? snapshot.permissions : [];
  return permissions.includes(asString(code).trim());
}

module.exports = {
  FEATURE_CODES,
  ALL_FEATURE_CODES,
  stableJsonStringify,
  parseTimeMs,
  validateSnapshot,
  isSnapshotExpired,
  hasFeature
};
