const crypto = require("node:crypto");
const fs = require("node:fs");
const {parseTimeMs, stableJsonStringify} = require("../../shared/licensePolicy");
const {validateCraftPermitSnapshot} = require("../../shared/craftPermitPolicy");
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
    code: "permit_missing",
    message: "缺少炼金执行授权",
    snapshot: null,
    signature: "",
    expiresAt: "",
    expiresInMs: 0,
    ...base
  };
}

function createCraftPermitEnforcer({publicKey = null, publicKeyFile = "", deviceId = ""} = {}) {
  const key = resolvePublicKey(publicKey, publicKeyFile);
  const localDeviceId = asString(deviceId).trim();

  return {
    evaluatePermit(permit = {}, {action = "", accountUsername = "", payloadHash = "", now = Date.now()} = {}) {
      const payload = permit && typeof permit === "object" ? permit : {};
      const snapshot = payload.snapshot && typeof payload.snapshot === "object" ? payload.snapshot : null;
      const signature = asString(payload.signature).trim();
      if (!snapshot || !signature) {
        return buildResult();
      }
      const validation = validateCraftPermitSnapshot(snapshot);
      if (!validation.ok) {
        return buildResult({
          code: "permit_invalid",
          message: `执行授权无效: ${validation.reason}`,
          snapshot,
          signature
        });
      }
      if (!key) {
        return buildResult({
          code: "public_key_missing",
          message: "缺少客户端公钥，无法验证执行授权",
          snapshot,
          signature
        });
      }
      const validSignature = crypto.verify(
        null,
        Buffer.from(stableJsonStringify(snapshot)),
        key,
        Buffer.from(signature, "base64")
      );
      if (!validSignature) {
        return buildResult({
          code: "invalid_signature",
          message: "执行授权签名校验失败",
          snapshot,
          signature
        });
      }
      if (localDeviceId && asString(snapshot.device_id).trim() !== localDeviceId) {
        return buildResult({
          code: "device_mismatch",
          message: "执行授权不属于当前设备",
          snapshot,
          signature
        });
      }
      if (asString(action).trim() && asString(snapshot.action).trim() !== asString(action).trim()) {
        return buildResult({
          code: "action_mismatch",
          message: "执行授权动作不匹配",
          snapshot,
          signature
        });
      }
      if (asString(accountUsername).trim() && asString(snapshot.account_username).trim() !== asString(accountUsername).trim()) {
        return buildResult({
          code: "account_username_mismatch",
          message: "执行授权账号不匹配",
          snapshot,
          signature
        });
      }
      if (asString(payloadHash).trim() && asString(snapshot.payload_hash).trim() !== asString(payloadHash).trim()) {
        return buildResult({
          code: "payload_hash_mismatch",
          message: "执行授权请求内容不匹配",
          snapshot,
          signature
        });
      }
      const expiresAt = asString(snapshot.exp).trim();
      const expiresInMs = parseTimeMs(expiresAt) - (typeof now === "number" ? now : parseTimeMs(now));
      if (expiresInMs <= 0) {
        return buildResult({
          code: "permit_expired",
          message: "执行授权已过期",
          snapshot,
          signature,
          expiresAt,
          expiresInMs
        });
      }
      return buildResult({
        ok: true,
        code: "ready",
        message: "执行授权有效",
        snapshot,
        signature,
        expiresAt,
        expiresInMs
      });
    }
  };
}

module.exports = {
  createCraftPermitEnforcer
};
