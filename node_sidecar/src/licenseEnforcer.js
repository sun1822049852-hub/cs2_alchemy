const crypto = require("node:crypto");
const fs = require("node:fs");
const {hasFeature, parseTimeMs, stableJsonStringify, validateSnapshot} = require("../../shared/licensePolicy");
const {asString} = require("./utils");

function resolvePublicKey(publicKey, publicKeyFile) {
  if (publicKey) {
    return publicKey;
  }
  const filePath = asString(publicKeyFile).trim();
  if (!filePath) {
    return null;
  }
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath, "utf8");
  } catch (_) {
    return null;
  }
}

function buildResult(base = {}) {
  return {
    ok: false,
    code: "license_missing",
    message: "缺少客户端授权",
    authenticated: false,
    user: null,
    permissions: [],
    featureFlags: {},
    snapshot: null,
    signature: "",
    expiresAt: "",
    expiresInMs: 0,
    ...base
  };
}

function createLicenseEnforcer({publicKey = null, publicKeyFile = "", deviceId = ""} = {}) {
  const key = resolvePublicKey(publicKey, publicKeyFile);
  const localDeviceId = asString(deviceId).trim();

  return {
    evaluateBundle(bundle = {}, {now = Date.now()} = {}) {
      const payload = bundle && typeof bundle === "object" ? bundle : {};
      const snapshot = payload.snapshot && typeof payload.snapshot === "object" ? payload.snapshot : null;
      const signature = asString(payload.signature).trim();
      if (!snapshot || !signature) {
        return buildResult();
      }
      const validation = validateSnapshot(snapshot);
      if (!validation.ok) {
        return buildResult({
          code: "license_invalid",
          message: `授权快照无效: ${validation.reason}`,
          snapshot,
          signature
        });
      }
      if (!key) {
        return buildResult({
          code: "public_key_missing",
          message: "缺少客户端公钥，无法验证授权",
          snapshot,
          signature
        });
      }
      const data = Buffer.from(stableJsonStringify(snapshot));
      const validSignature = crypto.verify(null, data, key, Buffer.from(signature, "base64"));
      if (!validSignature) {
        return buildResult({
          code: "invalid_signature",
          message: "授权签名校验失败",
          snapshot,
          signature
        });
      }
      if (localDeviceId && asString(snapshot.device_id).trim() !== localDeviceId) {
        return buildResult({
          code: "device_mismatch",
          message: "授权不属于当前设备",
          snapshot,
          signature
        });
      }
      const expiresAt = asString(snapshot.exp).trim();
      const expiresInMs = parseTimeMs(expiresAt) - (typeof now === "number" ? now : parseTimeMs(now));
      if (expiresInMs <= 0) {
        return buildResult({
          code: "license_expired",
          message: "客户端授权已过期",
          snapshot,
          signature,
          expiresAt,
          expiresInMs
        });
      }
      return buildResult({
        ok: true,
        code: "ready",
        message: "客户端授权有效",
        authenticated: true,
        user: {
          id: asString(snapshot.sub).trim(),
          username: asString(snapshot.username).trim(),
          membership_plan: asString(snapshot.membership_plan).trim()
        },
        permissions: Array.isArray(snapshot.permissions) ? [...snapshot.permissions] : [],
        featureFlags: snapshot.feature_flags && typeof snapshot.feature_flags === "object" ? {...snapshot.feature_flags} : {},
        snapshot,
        signature,
        expiresAt,
        expiresInMs
      });
    },
    hasPermission(state, code) {
      if (!state || !state.ok || !state.snapshot) {
        return false;
      }
      return hasFeature(state.snapshot, code);
    }
  };
}

module.exports = {
  createLicenseEnforcer
};
