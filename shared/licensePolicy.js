const {FEATURE_CODES, ALL_FEATURE_CODES} = require("./featureCodes");

const LICENSE_SNAPSHOT_POLICY = Object.freeze({
  issuer: "cs2-alchemy-control-plane",
  audience: "cs2-alchemy-desktop",
  tokenType: "entitlement",
  keyId: "local-ed25519-v1",
  maxTtlMs: 15 * 60 * 1000,
  clockSkewMs: 60 * 1000
});

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

function validateSnapshot(snapshot, {now = null} = {}) {
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
  if (asString(value.iss).trim() !== LICENSE_SNAPSHOT_POLICY.issuer) {
    return {ok: false, reason: "issuer_invalid"};
  }
  if (asString(value.aud).trim() !== LICENSE_SNAPSHOT_POLICY.audience) {
    return {ok: false, reason: "audience_invalid"};
  }
  if (asString(value.token_type).trim() !== LICENSE_SNAPSHOT_POLICY.tokenType) {
    return {ok: false, reason: "token_type_invalid"};
  }
  if (asString(value.key_id).trim() !== LICENSE_SNAPSHOT_POLICY.keyId) {
    return {ok: false, reason: "key_id_invalid"};
  }
  const issuedAt = parseTimeMs(value.iat);
  const expiresAt = parseTimeMs(value.exp);
  if (!issuedAt || !expiresAt) {
    return {ok: false, reason: "time_invalid"};
  }
  if (expiresAt <= issuedAt) {
    return {ok: false, reason: "time_window_invalid"};
  }
  if ((expiresAt - issuedAt) > LICENSE_SNAPSHOT_POLICY.maxTtlMs) {
    return {ok: false, reason: "ttl_exceeded"};
  }
  const nowMs = now === null || now === undefined ? 0 : (typeof now === "number" ? now : parseTimeMs(now));
  if (nowMs && issuedAt > (nowMs + LICENSE_SNAPSHOT_POLICY.clockSkewMs)) {
    return {ok: false, reason: "issued_in_future"};
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
  LICENSE_SNAPSHOT_POLICY,
  stableJsonStringify,
  parseTimeMs,
  validateSnapshot,
  isSnapshotExpired,
  hasFeature
};
