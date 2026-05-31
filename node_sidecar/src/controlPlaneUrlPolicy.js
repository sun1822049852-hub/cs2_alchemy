const {asString} = require("./utils");

function buildControlPlaneUrlError({
  code = "invalid_control_plane_base_url",
  message = "远端认证服务地址无效",
  status = 400
} = {}) {
  const error = new Error(asString(message).trim() || "远端认证服务地址无效");
  error.code = asString(code).trim() || "invalid_control_plane_base_url";
  error.status = Number(status) || 400;
  return error;
}

function normalizeHostname(hostname) {
  return asString(hostname).trim().toLowerCase().replace(/^\[|\]$/g, "");
}

function isLoopbackHostname(hostname) {
  const host = normalizeHostname(hostname);
  if (host === "localhost" || host === "::1") {
    return true;
  }
  if (/^127(?:\.\d{1,3}){0,3}$/.test(host)) {
    return true;
  }
  return false;
}

function parseControlPlaneUrl(value) {
  const text = asString(value).trim();
  if (!text) {
    return null;
  }
  try {
    return new URL(text);
  } catch (_) {
    throw buildControlPlaneUrlError({
      code: "invalid_control_plane_base_url",
      message: "远端认证服务地址格式无效",
      status: 400
    });
  }
}

function assertSecureControlPlaneBaseUrl(value) {
  const parsed = parseControlPlaneUrl(value);
  if (!parsed) {
    return "";
  }
  if (parsed.protocol === "https:") {
    return asString(value).trim().replace(/\/+$/g, "");
  }
  if (parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname)) {
    return asString(value).trim().replace(/\/+$/g, "");
  }
  if (parsed.protocol === "http:") {
    throw buildControlPlaneUrlError({
      code: "insecure_control_plane_base_url",
      message: "正式远端认证服务地址必须使用 HTTPS；HTTP 仅允许 localhost/127.0.0.1 本机隧道",
      status: 400
    });
  }
  throw buildControlPlaneUrlError({
    code: "invalid_control_plane_base_url",
    message: "远端认证服务地址只支持 HTTPS，或本机 HTTP 隧道",
    status: 400
  });
}

module.exports = {
  assertSecureControlPlaneBaseUrl,
  isLoopbackHostname
};
