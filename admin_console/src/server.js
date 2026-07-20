const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const {ControlPlaneStore} = require("./controlPlaneStore");
const {getMailConfig} = require("./mailConfig");
const {createMailService} = require("./mailService");
const {createEntitlementSigner} = require("./entitlementSigner");
const {DEFAULTS, PATHS} = require("./constants");
const {validatePassword, validateUsername} = require("../../shared/validation");
const {asString} = require("../../node_sidecar/src/utils");

const JSON_BODY_LIMIT_BYTES = 64 * 1024;
const ADMIN_SESSION_COOKIE = "admin_session";
const ADMIN_CSRF_COOKIE = "admin_csrf";
const ADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8"
};

const EMAIL_CODE_SCENES = new Set(["register", "reset_password"]);

function isValidEmail(value) {
  const text = asString(value).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

function writeBody(res, status, contentType, body) {
  const payload = Buffer.from(body || "", "utf8");
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": payload.byteLength
  });
  res.end(payload);
}

function writeJson(res, status, payload) {
  writeBody(res, status, "application/json; charset=utf-8", JSON.stringify(payload));
}

function writeError(res, status, reason, message) {
  writeJson(res, status, {
    ok: false,
    reason: asString(reason).trim(),
    message: asString(message).trim()
  });
}

function readJsonBody(req) {
  if (req._jsonBodyPromise) {
    return req._jsonBodyPromise;
  }
  req._jsonBodyPromise = new Promise((resolve, reject) => {
    const chunks = [];
    let byteLength = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      byteLength += chunk.byteLength;
      if (byteLength > JSON_BODY_LIMIT_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        const error = new Error("JSON body exceeds 64KiB");
        error.code = "request_body_too_large";
        reject(error);
        return;
      }
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        const error = new Error("invalid JSON body");
        error.code = "invalid_json";
        reject(error);
      }
    });
    req.on("error", reject);
  });
  return req._jsonBodyPromise;
}

function createCodeGenerator() {
  return () => String(crypto.randomInt(100000, 1000000));
}

function readCookie(req, name) {
  const raw = asString(req && req.headers && req.headers.cookie);
  for (const item of raw.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch (_) {
      return "";
    }
  }
  return "";
}

function setAdminCookies(res, sessionToken, csrfToken, maxAgeSeconds) {
  const suffix = `Path=/; SameSite=Strict; Max-Age=${Math.max(0, Number(maxAgeSeconds) || 0)}`;
  res.setHeader("Set-Cookie", [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; HttpOnly; ${suffix}`,
    `${ADMIN_CSRF_COOKIE}=${encodeURIComponent(csrfToken)}; ${suffix}`
  ]);
}

function setSecurityHeaders(res) {
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function validateLocalApiRequest(req) {
  const host = asString(req && req.headers && req.headers.host).trim().toLowerCase();
  const localPort = Number(req && req.socket && req.socket.localPort) || 0;
  const allowedHosts = new Set([
    `127.0.0.1:${localPort}`,
    `localhost:${localPort}`,
    `[::1]:${localPort}`
  ]);
  if (!localPort || !allowedHosts.has(host)) {
    return {status: 403, reason: "local_host_required", message: "本地 API 仅接受回环地址请求"};
  }
  const method = asString(req && req.method).toUpperCase();
  const origin = asString(req && req.headers && req.headers.origin).trim();
  const fetchSite = asString(req && req.headers && req.headers["sec-fetch-site"]).trim().toLowerCase();
  if ((origin && origin !== `http://${host}`) || fetchSite === "cross-site") {
    return {status: 403, reason: "cross_origin_request_denied", message: "拒绝跨站本地请求"};
  }
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return null;
  const declaredLength = Number(req && req.headers && req.headers["content-length"]) || 0;
  const hasBody = declaredLength > 0 || !!(req && req.headers && req.headers["transfer-encoding"]);
  const contentType = asString(req && req.headers && req.headers["content-type"]).trim().toLowerCase();
  if (hasBody && !/^application\/json(?:\s*;|$)/.test(contentType)) {
    return {status: 415, reason: "json_content_type_required", message: "请求体必须使用 application/json"};
  }
  return null;
}

function resolveAdminAsset(urlPath = "") {
  const pathname = asString(urlPath).trim();
  const relative = pathname === "/admin" || pathname === "/admin/"
    ? "index.html"
    : pathname.replace(/^\/admin\/?/, "");
  const target = path.resolve(PATHS.UI_DIR, relative);
  if (!target.startsWith(path.resolve(PATHS.UI_DIR))) {
    return "";
  }
  return target;
}

function serveAdminAsset(res, urlPath = "") {
  const filePath = resolveAdminAsset(urlPath);
  if (!filePath || !fs.existsSync(filePath)) {
    writeError(res, 404, "not_found", "route not found");
    return true;
  }
  const extname = path.extname(filePath).toLowerCase();
  writeBody(res, 200, MIME_TYPES[extname] || "text/plain; charset=utf-8", fs.readFileSync(filePath, "utf8"));
  return true;
}

function createServer({
  dbPath = "",
  storeFactory = null,
  mailConfigFactory = null,
  mailServiceFactory = null,
  codeGenerator = null,
  now = () => new Date()
} = {}) {
  const store = typeof storeFactory === "function"
    ? storeFactory({dbPath})
    : new ControlPlaneStore({dbPath});
  const config = typeof mailConfigFactory === "function"
    ? mailConfigFactory()
    : getMailConfig();
  const mailService = typeof mailServiceFactory === "function"
    ? mailServiceFactory(config)
    : createMailService({config});
  const signer = createEntitlementSigner({
    privateKeyFile: config.privateKeyFile,
    snapshotTtlMinutes: config.snapshotTtlMinutes,
    now
  });
  const nextCode = typeof codeGenerator === "function" ? codeGenerator : createCodeGenerator();

  function issueUserBundle({user, deviceId, refreshCredential, source}) {
    const entitlements = store.resolveUserEntitlements({userId: user.id, now: now()});
    if (!entitlements) {
      throw new Error("entitlements_missing");
    }
    return signer.issueBundle({
      user: {
        ...user,
        membership_plan: entitlements.membership_plan,
        membership_expires_at: entitlements.membership_expires_at
      },
      deviceId,
      permissions: entitlements.permissions,
      featureFlags: entitlements.feature_flags,
      refreshCredential,
      source
    });
  }

  function resolveAdminSessionFromRequest(req) {
    const token = readCookie(req, ADMIN_SESSION_COOKIE);
    if (!token) {
      return {ok: false, reason: "admin_auth_required"};
    }
    return store.resolveAdminSession({
      sessionToken: token,
      idleTimeoutMs: ADMIN_IDLE_TIMEOUT_MS,
      now: now()
    });
  }

  function requireAdminSession(req, res, {superAdmin = false} = {}) {
    const resolved = resolveAdminSessionFromRequest(req);
    if (!resolved.ok) {
      writeError(res, 401, resolved.reason, "请先登录控制台管理员账号");
      return null;
    }
    if (superAdmin && !resolved.user.is_super_admin) {
      writeError(res, 403, "super_admin_required", "该操作仅限超级管理员");
      return null;
    }
    return resolved;
  }

  function requireAdminCsrf(req, res, admin) {
    const csrfToken = asString(req && req.headers && req.headers["x-csrf-token"]);
    if (!csrfToken || !store.verifyAdminCsrf({sessionId: admin.session.id, csrfToken})) {
      writeError(res, 403, "csrf_invalid", "CSRF 校验失败");
      return false;
    }
    return true;
  }

  function getClientIp(req) {
    return asString(req.socket && req.socket.remoteAddress).trim();
  }

  function getLoginRateLimit(scene, username, req) {
    return store.getLoginRateLimit({
      scene,
      username,
      ip: getClientIp(req),
      windowMs: LOGIN_WINDOW_MS,
      now: now()
    });
  }

  function recordLogin(scene, username, req, success) {
    store.recordLoginAttempt({
      scene,
      username,
      success,
      ip: getClientIp(req),
      now: now()
    });
  }

  function maskEmail(email) {
    const [local, domain] = asString(email).split("@");
    if (!local || !domain) return email;
    const visible = local.length <= 2 ? local[0] : local.slice(0, 2);
    return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
  }

  async function handleSendCode(res, body, scene) {
    const email = asString(body && body.email).trim().toLowerCase();
    const sceneText = asString(scene).trim() || "register";
    if (!isValidEmail(email)) {
      writeError(res, 400, "email_invalid", "邮箱格式不正确");
      return;
    }
    if (!EMAIL_CODE_SCENES.has(sceneText)) {
      writeError(res, 400, "email_code_scene_invalid", "验证码场景无效");
      return;
    }
    if (!config.configured) {
      writeError(res, 503, "mail_service_not_configured", "邮件服务未配置");
      return;
    }
    const cooldownMs = Math.max(1, Number(config.authCodeCooldownSeconds) || DEFAULTS.AUTH_CODE_COOLDOWN_SECONDS) * 1000;
    if (!store.canSendCode({email, scene: sceneText, cooldownMs, now: now()})) {
      writeError(res, 429, "email_code_rate_limited", "验证码发送过于频繁，请稍后再试");
      return;
    }
    const code = String(nextCode()).trim();
    const codeTtlMs = Math.max(1, Number(config.authCodeTtlMinutes) || DEFAULTS.AUTH_CODE_TTL_MINUTES) * 60 * 1000;
    const row = store.createEmailCode({
      email,
      scene: sceneText,
      code,
      ttlMs: codeTtlMs,
      now: now()
    });
    try {
      await mailService.sendVerificationCode({
        to: email,
        code,
        scene: sceneText,
        ttlMinutes: config.authCodeTtlMinutes
      });
    } catch (err) {
      store.deleteEmailCode(row.id);
      writeError(res, 502, "mail_send_failed", asString(err && err.message).trim() || "验证码邮件发送失败");
      return;
    }
    const expiresInSeconds = Math.max(1, Number(config.authCodeTtlMinutes) || DEFAULTS.AUTH_CODE_TTL_MINUTES) * 60;
    const responsePayload = {
      ok: true,
      message: sceneText === "reset_password" ? "重置验证码已发送，请查收邮箱。" : "注册验证码已发送，请查收邮箱。",
      expires_in_seconds: expiresInSeconds
    };
    if (sceneText === "register") {
      const session = store.createRegisterSession({email, ttlMs: codeTtlMs, now: now()});
      responsePayload.register_session_id = session.session_id;
      responsePayload.masked_email = maskEmail(email);
      responsePayload.code_length = code.length;
      responsePayload.code_expires_in_seconds = expiresInSeconds;
      responsePayload.resend_after_seconds = Math.ceil(cooldownMs / 1000);
    }
    writeJson(res, 200, responsePayload);
  }

  function listAdminUsersPayload({includeArchived = false} = {}) {
    return store.listClientUsers({now: now(), includeArchived}).map((user) => ({
      ...user,
      entitlements: store.resolveUserEntitlements({userId: user.id, now: now()}),
      active_device_count: store.listUserDeviceSessions({userId: user.id}).length
    }));
  }

  function normalizeProduct(product) {
    return product ? {...product, enabled: !!product.is_enabled} : null;
  }

  const server = http.createServer(async (req, res) => {
    setSecurityHeaders(res);
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = url.pathname;
    try {
      const method = asString(req.method).toUpperCase();
      if (pathname.startsWith("/api/")) {
        const apiRequestError = validateLocalApiRequest(req);
        if (apiRequestError) {
          writeError(res, apiRequestError.status, apiRequestError.reason, apiRequestError.message);
          return;
        }
      }
      if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        const declaredLength = Number(req.headers["content-length"]) || 0;
        if (declaredLength > JSON_BODY_LIMIT_BYTES) {
          writeError(res, 413, "request_body_too_large", "JSON 请求体不能超过 64KiB");
          return;
        }
        await readJsonBody(req);
      }

      if (pathname === "/admin" || pathname === "/admin/" || pathname.startsWith("/admin/")) {
        serveAdminAsset(res, pathname);
        return;
      }

      if (req.method === "GET" && pathname === "/api/health") {
        writeJson(res, 200, {ok: true, service: "admin_console"});
        return;
      }

      if (req.method === "GET" && pathname === "/api/mail/config") {
        writeJson(res, 200, {
          ok: true,
          configured: !!config.configured,
          from_name: asString(config.fromName).trim(),
          from_address: asString(config.fromAddress).trim(),
          auth_service_base_url: asString(config.authServiceBaseUrl).trim()
        });
        return;
      }

      if (req.method === "GET" && pathname === "/api/admin/bootstrap/state") {
        writeJson(res, 200, {
          ok: true,
          needs_bootstrap: store.needsAdminBootstrap()
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/admin/bootstrap") {
        if (!store.needsAdminBootstrap()) {
          writeError(res, 409, "admin_already_exists", "管理员已初始化");
          return;
        }
        const body = await readJsonBody(req);
        const username = asString(body && body.username).trim() || "admin";
        const password = asString(body && body.password);
        const passwordCheck = validatePassword(password);
        if (!passwordCheck.ok) {
          writeError(res, 400, passwordCheck.reason, passwordCheck.message);
          return;
        }
        const user = store.createOrUpdateAdminUser({
          username,
          password,
          isSuperAdmin: true,
          now: now()
        });
        writeJson(res, 200, {
          ok: true,
          message: "管理员初始化成功",
          user
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/admin/login") {
        const body = await readJsonBody(req);
        const username = asString(body && body.username).trim() || "admin";
        const password = asString(body && body.password);
        if (!password) {
          writeError(res, 400, "password_required", "管理员密码不能为空");
          return;
        }
        const limit = getLoginRateLimit("admin", username, req);
        if (limit.limited) {
          writeError(res, 429, "login_rate_limited", "登录失败次数过多，请15分钟后再试");
          return;
        }
        const auth = store.authenticateAdminUser({username, password});
        recordLogin("admin", username, req, auth.ok);
        if (!auth.ok) {
          store.appendAuditEvent({
            actorType: "anonymous", action: "admin.login_failed", targetType: "admin_user",
            targetId: username, ip: getClientIp(req), now: now()
          });
          writeError(res, 401, auth.reason, "管理员账号或密码错误");
          return;
        }
        const session = store.createAdminSession({
          adminUserId: auth.user.id,
          ttlHours: Math.min(8, Math.max(1, Number(config.adminSessionHours) || 8)),
          now: now()
        });
        store.appendAuditEvent({
          actorType: "admin", actorId: auth.user.id, action: "admin.login_succeeded",
          targetType: "admin_user", targetId: auth.user.id, ip: getClientIp(req), now: now()
        });
        const maxAgeSeconds = Math.min(8, Math.max(1, Number(config.adminSessionHours) || 8)) * 60 * 60;
        setAdminCookies(res, session.session_token, session.csrf_token, maxAgeSeconds);
        writeJson(res, 200, {
          ok: true,
          message: "管理员登录成功",
          user: auth.user,
          csrf_token: session.csrf_token,
          expires_at: session.expires_at
        });
        return;
      }

      if (req.method === "GET" && pathname === "/api/admin/session") {
        const token = readCookie(req, ADMIN_SESSION_COOKIE);
        if (!token) {
          writeJson(res, 200, {
            ok: true,
            authenticated: false,
            needs_bootstrap: store.needsAdminBootstrap()
          });
          return;
        }
        const resolved = store.resolveAdminSession({
          sessionToken: token,
          idleTimeoutMs: ADMIN_IDLE_TIMEOUT_MS,
          now: now()
        });
        if (!resolved.ok) {
          writeError(res, 401, resolved.reason, "控制台登录态已失效");
          return;
        }
        const csrfToken = readCookie(req, ADMIN_CSRF_COOKIE);
        writeJson(res, 200, {
          ok: true,
          authenticated: true,
          user: resolved.user,
          csrf_token: store.verifyAdminCsrf({sessionId: resolved.session.id, csrfToken}) ? csrfToken : "",
          expires_at: resolved.session.expires_at
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/admin/logout") {
        const token = readCookie(req, ADMIN_SESSION_COOKIE);
        if (!token) {
          setAdminCookies(res, "", "", 0);
          writeJson(res, 200, {ok: true, message: "已退出"});
          return;
        }
        const admin = requireAdminSession(req, res);
        if (!admin || !requireAdminCsrf(req, res, admin)) {
          return;
        }
        store.revokeAdminSession({sessionToken: token, now: now()});
        setAdminCookies(res, "", "", 0);
        writeJson(res, 200, {ok: true, message: "已退出"});
        return;
      }

      if (pathname.startsWith("/api/admin/")) {
        const admin = requireAdminSession(req, res, {superAdmin: true});
        if (!admin) {
          return;
        }
        if (!["GET", "HEAD", "OPTIONS"].includes(asString(req.method).toUpperCase())
          && !requireAdminCsrf(req, res, admin)) {
          return;
        }

        if (req.method === "GET" && pathname === "/api/admin/overview") {
          const users = store.listClientUsers({now: now()});
          const products = store.listProducts();
          writeJson(res, 200, {
            ok: true,
            stats: {
              total_users: users.length,
              active_users: users.filter((item) => item.status === "active").length,
              plans: store.listMembershipPlans().length,
              enabled_products: products.filter((item) => item.is_enabled).length
            },
            admin: admin.user
          });
          return;
        }

        if (req.method === "GET" && pathname === "/api/admin/plans") {
          writeJson(res, 200, {
            ok: true,
            items: store.listMembershipPlans()
          });
          return;
        }

        if (req.method === "GET" && pathname === "/api/admin/users") {
          writeJson(res, 200, {
            ok: true,
            items: listAdminUsersPayload({includeArchived: url.searchParams.get("include_archived") === "1"})
          });
          return;
        }

        if (req.method === "POST" && pathname === "/api/admin/users") {
          const body = await readJsonBody(req);
          const email = asString(body && body.email).trim().toLowerCase();
          const username = asString(body && body.username).trim();
          const password = asString(body && body.password);
          if (!isValidEmail(email)) {
            writeError(res, 400, "email_invalid", "邮箱格式不正确");
            return;
          }
          const usernameCheck = validateUsername(username);
          if (!usernameCheck.ok) {
            writeError(res, 400, usernameCheck.reason, usernameCheck.message);
            return;
          }
          const passwordCheck = validatePassword(password);
          if (!passwordCheck.ok) {
            writeError(res, 400, passwordCheck.reason, passwordCheck.message);
            return;
          }
          if (store.getClientUserByEmail(email) || store.getClientUserByUsername(username)) {
            writeError(res, 409, "user_already_exists", "邮箱或用户名已存在");
            return;
          }
          const result = store.createManagedClientUser({
            email,
            username,
            password,
            membershipDays: Number(body && body.membership_days) || 0,
            adminUserId: admin.user.id,
            now: now()
          });
          if (!result.ok) {
            writeError(res, 400, result.reason, "创建用户失败");
            return;
          }
          writeJson(res, 201, {ok: true, user: result.user});
          return;
        }

        if (req.method === "POST" && pathname === "/api/admin/users/bulk-grant") {
          const body = await readJsonBody(req);
          const result = store.bulkGrantMembership({
            userIds: body && body.user_ids,
            days: body && body.days,
            adminUserId: admin.user.id,
            now: now()
          });
          if (!result.ok) {
            writeError(res, result.reason === "user_not_found" ? 404 : 400, result.reason, "批量授权失败");
            return;
          }
          writeJson(res, 200, {ok: true, items: result.items});
          return;
        }

        if (req.method === "GET" && pathname === "/api/admin/activation-codes") {
          writeJson(res, 200, {
            ok: true,
            items: store.listActivationCodes({
              status: asString(url.searchParams.get("status")).trim(),
              batchId: asString(url.searchParams.get("batch_id")).trim(),
              now: now()
            })
          });
          return;
        }

        if (req.method === "POST" && pathname === "/api/admin/activation-codes") {
          const body = await readJsonBody(req);
          const result = store.generateActivationCodes({
            count: body && body.count,
            days: body && body.days,
            expiresAt: body && body.expires_at,
            adminUserId: admin.user.id,
            now: now()
          });
          if (!result.ok) {
            writeError(res, 400, result.reason, "激活码生成失败");
            return;
          }
          writeJson(res, 201, result);
          return;
        }

        const activationCodeRevokeMatch = pathname.match(/^\/api\/admin\/activation-codes\/(\d+)\/revoke$/);
        if (req.method === "POST" && activationCodeRevokeMatch) {
          const result = store.revokeActivationCode({
            activationCodeId: Number(activationCodeRevokeMatch[1]) || 0,
            adminUserId: admin.user.id,
            now: now()
          });
          if (!result.ok) {
            writeError(res, result.reason === "activation_code_not_found" ? 404 : 409, result.reason, "激活码撤销失败");
            return;
          }
          writeJson(res, 200, {ok: true});
          return;
        }

        if (req.method === "GET" && pathname === "/api/admin/products") {
          writeJson(res, 200, {ok: true, items: store.listProducts().map(normalizeProduct)});
          return;
        }

        if (req.method === "POST" && pathname === "/api/admin/products") {
          const body = await readJsonBody(req);
          const product = store.createProduct({
            name: body && body.name,
            description: body && body.description,
            membershipDays: body && body.membership_days,
            priceCents: body && body.price_cents,
            isEnabled: body && body.is_enabled === undefined ? body && body.enabled : body && body.is_enabled,
            sortOrder: body && body.sort_order,
            adminUserId: admin.user.id,
            now: now()
          });
          writeJson(res, 201, {ok: true, product: normalizeProduct(product)});
          return;
        }

        const productMatch = pathname.match(/^\/api\/admin\/products\/(\d+)$/);
        if (req.method === "DELETE" && productMatch) {
          const result = store.deleteProduct({
            productId: Number(productMatch[1]) || 0,
            adminUserId: admin.user.id,
            now: now()
          });
          if (!result.ok) {
            writeError(res, result.reason === "product_not_found" ? 404 : 409, result.reason,
              result.reason === "product_in_use" ? "商品已被订单引用，只能停用" : "商品不存在");
            return;
          }
          writeJson(res, 200, {ok: true});
          return;
        }
        if (req.method === "PATCH" && productMatch) {
          const body = await readJsonBody(req);
          const product = store.updateProduct({
            productId: Number(productMatch[1]) || 0,
            name: body && body.name,
            description: body && body.description,
            membershipDays: body && body.membership_days,
            priceCents: body && body.price_cents,
            isEnabled: body && body.is_enabled === undefined ? body && body.enabled : body && body.is_enabled,
            sortOrder: body && body.sort_order,
            adminUserId: admin.user.id,
            now: now()
          });
          if (!product) {
            writeError(res, 404, "product_not_found", "商品不存在");
            return;
          }
          writeJson(res, 200, {ok: true, product: normalizeProduct(product)});
          return;
        }

        if (req.method === "GET" && pathname === "/api/admin/orders") {
          writeJson(res, 200, {ok: true, items: store.listOrders()});
          return;
        }

        const deviceRevokeMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/devices\/(\d+)\/revoke$/);
        if (req.method === "POST" && deviceRevokeMatch) {
          const userId = Number(deviceRevokeMatch[1]) || 0;
          const sessionId = Number(deviceRevokeMatch[2]) || 0;
          const target = store.listUserDeviceSessions({userId}).find((item) => item.id === sessionId);
          if (!target) {
            writeError(res, 404, "device_session_not_found", "设备会话不存在");
            return;
          }
          const revoked = store.revokeRefreshSessionById({
            sessionId,
            now: now()
          });
          if (!revoked.ok) {
            writeError(res, 404, revoked.reason, "设备会话不存在");
            return;
          }
          writeJson(res, 200, {ok: true, message: "设备已吊销"});
          return;
        }

        const devicesMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/devices$/);
        if (req.method === "GET" && devicesMatch) {
          const userId = Number(devicesMatch[1]) || 0;
          const user = store.getClientUserById(userId, {now: now()});
          if (!user) {
            writeError(res, 404, "user_not_found", "用户不存在");
            return;
          }
          writeJson(res, 200, {
            ok: true,
            user,
            items: store.listUserDeviceSessions({userId})
          });
          return;
        }

        const userRestoreMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/restore$/);
        if (req.method === "POST" && userRestoreMatch) {
          const result = store.restoreClientUser({
            userId: Number(userRestoreMatch[1]) || 0,
            adminUserId: admin.user.id,
            now: now()
          });
          if (!result.ok) {
            writeError(res, result.reason === "user_not_found" ? 404 : 409, result.reason, "恢复用户失败");
            return;
          }
          writeJson(res, 200, {ok: true, user: result.user});
          return;
        }

        const userResetPasswordMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/reset-password$/);
        if (req.method === "POST" && userResetPasswordMatch) {
          const body = await readJsonBody(req);
          const generated = body && body.generate === true;
          const newPassword = generated
            ? crypto.randomBytes(18).toString("base64url")
            : asString(body && (body.new_password === undefined ? body.password : body.new_password));
          const passwordCheck = validatePassword(newPassword);
          if (!passwordCheck.ok) {
            writeError(res, 400, passwordCheck.reason, passwordCheck.message);
            return;
          }
          const result = store.resetClientUserPassword({
            userId: Number(userResetPasswordMatch[1]) || 0,
            newPassword,
            adminUserId: admin.user.id,
            now: now()
          });
          if (!result.ok) {
            writeError(res, 404, result.reason, "用户不存在");
            return;
          }
          writeJson(res, 200, {
            ok: true,
            user: result.user,
            ...(generated ? {generated_password: newPassword} : {})
          });
          return;
        }

        const userMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
        if (req.method === "DELETE" && userMatch) {
          const result = store.archiveClientUser({
            userId: Number(userMatch[1]) || 0,
            adminUserId: admin.user.id,
            now: now()
          });
          if (!result.ok) {
            writeError(res, 404, result.reason, "用户不存在");
            return;
          }
          writeJson(res, 200, {ok: true, user: result.user});
          return;
        }
        if (req.method === "PATCH" && userMatch) {
          const userId = Number(userMatch[1]) || 0;
          const body = await readJsonBody(req);
          const updated = store.updateClientUserControl({
            userId,
            status: asString(body && body.status).trim(),
            membershipPlan: asString(body && body.membership_plan).trim(),
            membershipExpiresAt: asString(body && body.membership_expires_at).trim(),
            permissionOverrides: Array.isArray(body && body.permission_overrides) ? body.permission_overrides : null,
            adminUserId: admin.user.id,
            auditIp: getClientIp(req),
            now: now()
          });
          if (!updated.ok) {
            const status = updated.reason === "user_not_found" ? 404 : 400;
            writeError(res, status, updated.reason, "用户更新失败");
            return;
          }
          writeJson(res, 200, {
            ok: true,
            message: "用户权限已更新",
            user: updated.user,
            entitlements: updated.entitlements
          });
          return;
        }

        writeError(res, 404, "not_found", "route not found");
        return;
      }

      if (req.method === "GET" && pathname === "/api/auth/membership/products") {
        writeJson(res, 200, {ok: true, items: store.listProducts({enabledOnly: true}).map(normalizeProduct)});
        return;
      }

      if (req.method === "POST" && pathname === "/api/auth/email/send-code") {
        const body = await readJsonBody(req);
        const scene = asString(body && body.scene).trim() || "register";
        await handleSendCode(res, body, scene);
        return;
      }

      if (req.method === "GET" && pathname === "/api/auth/register/readiness") {
        writeJson(res, 200, {ok: true, ready: true, registration_flow_version: 3});
        return;
      }

      if (req.method === "POST" && pathname === "/api/auth/register/verify-code") {
        const body = await readJsonBody(req);
        const email = asString(body && body.email).trim().toLowerCase();
        const code = asString(body && body.code).trim();
        const registerSessionId = asString(body && body.register_session_id).trim();
        if (!isValidEmail(email)) {
          writeError(res, 400, "email_invalid", "邮箱格式不正确");
          return;
        }
        if (!code || !registerSessionId) {
          writeError(res, 400, "verify_code_payload_invalid", "验证码和注册会话ID不能为空");
          return;
        }
        const result = store.verifyCodeAndIssueTicket({
          email, code, sessionId: registerSessionId,
          ticketTtlMs: 10 * 60 * 1000,
          now: now()
        });
        if (!result.ok) {
          writeError(res, 400, result.reason, "验证码校验失败");
          return;
        }
        writeJson(res, 200, {
          ok: true,
          message: "验证码校验成功",
          verification_ticket: result.ticket,
          ticket_expires_in_seconds: 600
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/auth/register/complete") {
        const body = await readJsonBody(req);
        const email = asString(body && body.email).trim().toLowerCase();
        const verificationTicket = asString(body && body.verification_ticket).trim();
        const username = asString(body && body.username).trim();
        const password = asString(body && body.password);
        const deviceId = asString(body && body.device_id).trim();
        if (!isValidEmail(email)) {
          writeError(res, 400, "email_invalid", "邮箱格式不正确");
          return;
        }
        if (!verificationTicket || !username || !password) {
          writeError(res, 400, "register_complete_payload_invalid", "注册参数不完整");
          return;
        }
        const usernameCheck = validateUsername(username);
        if (!usernameCheck.ok) {
          writeError(res, 400, usernameCheck.reason, usernameCheck.message);
          return;
        }
        const passwordCheck = validatePassword(password);
        if (!passwordCheck.ok) {
          writeError(res, 400, passwordCheck.reason, passwordCheck.message);
          return;
        }
        const ticketResult = store.consumeVerificationTicket({email, ticket: verificationTicket, now: now()});
        if (!ticketResult.ok) {
          writeError(res, 400, ticketResult.reason, "验证票据无效或已过期");
          return;
        }
        if (store.getClientUserByEmail(email)) {
          writeError(res, 409, "email_already_exists", "该邮箱已注册");
          return;
        }
        if (store.getClientUserByUsername(username)) {
          writeError(res, 409, "username_already_exists", "用户名已存在");
          return;
        }
        const registerNow = now();
        const user = store.createClientUser({
          email, username, password,
          membershipPlan: "inactive",
          membershipExpiresAt: "",
          now: registerNow
        });
        const session = store.createRefreshSession({
          userId: user.id,
          deviceId: deviceId || "unknown",
          ttlDays: config.refreshSessionDays,
          now: registerNow
        });
        writeJson(res, 200, {
          ok: true,
          message: "注册成功",
          user,
          access_bundle: issueUserBundle({
            user,
            deviceId: deviceId || "unknown",
            refreshCredential: session.refresh_token,
            source: "local_register"
          }),
          refresh_token: session.refresh_token
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/auth/register") {
        const body = await readJsonBody(req);
        const email = asString(body && body.email).trim().toLowerCase();
        const code = asString(body && body.code).trim();
        const username = asString(body && body.username).trim();
        const password = asString(body && body.password);
        if (!isValidEmail(email)) {
          writeError(res, 400, "email_invalid", "邮箱格式不正确");
          return;
        }
        if (!code || !username || !password) {
          writeError(res, 400, "register_payload_invalid", "注册参数不完整");
          return;
        }
        const usernameCheck = validateUsername(username);
        if (!usernameCheck.ok) {
          writeError(res, 400, usernameCheck.reason, usernameCheck.message);
          return;
        }
        const passwordCheck = validatePassword(password);
        if (!passwordCheck.ok) {
          writeError(res, 400, passwordCheck.reason, passwordCheck.message);
          return;
        }
        const verified = store.verifyEmailCode({email, scene: "register", code, now: now()});
        if (!verified.ok) {
          writeError(res, 400, verified.reason, "注册验证码无效或已过期");
          return;
        }
        if (store.getClientUserByEmail(email)) {
          writeError(res, 409, "email_already_exists", "该邮箱已注册");
          return;
        }
        if (store.getClientUserByUsername(username)) {
          writeError(res, 409, "username_already_exists", "用户名已存在");
          return;
        }
        const registerNow = now();
        const user = store.createClientUser({
          email, username, password,
          membershipPlan: "inactive",
          membershipExpiresAt: "",
          now: registerNow
        });
        writeJson(res, 200, {
          ok: true,
          message: "注册成功",
          user
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/auth/login") {
        const body = await readJsonBody(req);
        const username = asString(body && body.username).trim();
        const password = asString(body && body.password);
        const deviceId = asString(body && body.device_id).trim();
        if (!username || !password || !deviceId) {
          writeError(res, 400, "login_payload_invalid", "用户名、密码、device_id 不能为空");
          return;
        }
        const limit = getLoginRateLimit("client", username, req);
        if (limit.limited) {
          writeError(res, 429, "login_rate_limited", "登录失败次数过多，请15分钟后再试");
          return;
        }
        const auth = store.authenticateClientUser({username, password});
        recordLogin("client", username, req, auth.ok);
        if (!auth.ok) {
          writeError(res, 401, auth.reason, "用户名或密码错误");
          return;
        }
        const session = store.createRefreshSession({
          userId: auth.user.id,
          deviceId,
          ttlDays: config.refreshSessionDays,
          now: now()
        });
        writeJson(res, 200, {
          ok: true,
          message: "登录成功",
          user: auth.user,
          access_bundle: issueUserBundle({
            user: auth.user,
            deviceId,
            refreshCredential: session.refresh_token,
            source: "local_login"
          }),
          refresh_token: session.refresh_token
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/auth/refresh") {
        const body = await readJsonBody(req);
        const refreshToken = asString(body && body.refresh_token).trim();
        const deviceId = asString(body && body.device_id).trim();
        if (!refreshToken || !deviceId) {
          writeError(res, 400, "refresh_payload_invalid", "refresh_token 与 device_id 不能为空");
          return;
        }
        const rotated = store.rotateRefreshSession({
          refreshToken,
          deviceId,
          ttlDays: config.refreshSessionDays,
          now: now()
        });
        if (!rotated.ok) {
          const status = rotated.reason === "device_mismatch" ? 409 : 401;
          writeError(res, status, rotated.reason, rotated.reason === "device_mismatch" ? "设备绑定不匹配" : "refresh_token 无效");
          return;
        }
        writeJson(res, 200, {
          ok: true,
          message: "授权已刷新",
          user: rotated.user,
          access_bundle: issueUserBundle({
            user: rotated.user,
            deviceId,
            refreshCredential: rotated.refresh_token,
            source: "local_refresh"
          }),
          refresh_token: rotated.refresh_token
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/auth/membership/redeem") {
        const body = await readJsonBody(req);
        const refreshToken = asString(body && body.refresh_token).trim();
        const deviceId = asString(body && body.device_id).trim();
        const code = asString(body && body.code).trim();
        if (!refreshToken || !deviceId || !code) {
          writeError(res, 400, "activation_code_payload_invalid", "refresh_token、device_id 与激活码不能为空");
          return;
        }
        const access = store.resolveClientAccess({
          refreshToken,
          deviceId,
          now: now()
        });
        if (!access.ok) {
          const status = access.reason === "device_mismatch" ? 409 : 401;
          writeError(res, status, access.reason, access.reason === "device_mismatch" ? "设备绑定不匹配" : "refresh_token 无效");
          return;
        }
        const redeemed = store.redeemActivationCode({userId: access.user.id, code, now: now()});
        if (!redeemed.ok) {
          const status = redeemed.reason === "activation_code_not_found" ? 404 : 409;
          writeError(res, status, redeemed.reason, "激活码无效、不可用或已兑换");
          return;
        }
        writeJson(res, 200, {
          ok: true,
          message: "激活码兑换成功",
          user: redeemed.user,
          access_bundle: issueUserBundle({
            user: redeemed.user,
            deviceId,
            refreshCredential: refreshToken,
            source: "activation_code_redeem"
          }),
          refresh_token: refreshToken
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/auth/payment/checkout") {
        const body = await readJsonBody(req);
        const refreshToken = asString(body && body.refresh_token).trim();
        const deviceId = asString(body && body.device_id).trim();
        if (!refreshToken || !deviceId) {
          writeError(res, 400, "checkout_payload_invalid", "refresh_token 与 device_id 不能为空");
          return;
        }
        const access = store.resolveClientAccess({
          refreshToken,
          deviceId,
          now: now()
        });
        if (!access.ok) {
          const status = access.reason === "device_mismatch" ? 409 : 401;
          writeError(res, status, access.reason, access.reason === "device_mismatch" ? "设备绑定不匹配" : "refresh_token 无效");
          return;
        }
        writeError(res, 501, "payment_not_configured", "支付方式暂未开放");
        return;
      }

      if (req.method === "POST" && pathname === "/api/auth/logout") {
        const body = await readJsonBody(req);
        const refreshToken = asString(body && body.refresh_token).trim();
        if (!refreshToken) {
          writeJson(res, 200, {ok: true, message: "已退出"});
          return;
        }
        const revoked = store.revokeRefreshSession({
          refreshToken,
          now: now()
        });
        if (!revoked.ok) {
          writeError(res, 401, revoked.reason, "refresh_token 无效");
          return;
        }
        writeJson(res, 200, {ok: true, message: "已退出"});
        return;
      }

      if (req.method === "POST" && pathname === "/api/auth/password/send-reset-code") {
        await handleSendCode(res, await readJsonBody(req), "reset_password");
        return;
      }

      if (req.method === "POST" && pathname === "/api/auth/password/reset") {
        const body = await readJsonBody(req);
        const email = asString(body && body.email).trim().toLowerCase();
        const code = asString(body && body.code).trim();
        const newPassword = asString(body && body.new_password);
        if (!isValidEmail(email)) {
          writeError(res, 400, "email_invalid", "邮箱格式不正确");
          return;
        }
        if (!code || !newPassword) {
          writeError(res, 400, "reset_payload_invalid", "重置参数不完整");
          return;
        }
        const passwordCheck = validatePassword(newPassword);
        if (!passwordCheck.ok) {
          writeError(res, 400, passwordCheck.reason, passwordCheck.message);
          return;
        }
        const verified = store.verifyEmailCode({email, scene: "reset_password", code, now: now()});
        if (!verified.ok) {
          writeError(res, 400, verified.reason, "重置验证码无效或已过期");
          return;
        }
        const updated = store.updateClientPassword({
          email,
          newPassword,
          ip: getClientIp(req),
          now: now()
        });
        if (!updated.ok) {
          writeError(res, 404, updated.reason, "用户不存在");
          return;
        }
        writeJson(res, 200, {ok: true, message: "密码已重置"});
        return;
      }

      if (req.method === "POST" && pathname === "/api/dev/mail/test") {
        const admin = requireAdminSession(req, res, {superAdmin: true});
        if (!admin || !requireAdminCsrf(req, res, admin)) {
          return;
        }
        if (!config.configured) {
          writeError(res, 503, "mail_service_not_configured", "邮件服务未配置");
          return;
        }
        const body = await readJsonBody(req);
        const to = asString(body && body.to).trim() || asString(config.testTo).trim();
        if (!isValidEmail(to)) {
          writeError(res, 400, "email_invalid", "测试收件邮箱无效");
          return;
        }
        const result = await mailService.sendTestMail({to});
        writeJson(res, 200, {
          ok: true,
          message: "测试邮件已发送",
          message_id: asString(result && result.messageId).trim()
        });
        return;
      }

      writeError(res, 404, "not_found", "route not found");
    } catch (err) {
      if (err && err.code === "invalid_json") {
        writeError(res, 400, "invalid_json", "JSON 请求体格式不正确");
        return;
      }
      if (err && err.code === "request_body_too_large") {
        writeError(res, 413, "request_body_too_large", "JSON 请求体不能超过 64KiB");
        return;
      }
      const message = asString(err && err.message).trim();
      if (["membership_days_invalid", "price_cents_invalid", "product name is required"].includes(message)) {
        writeError(res, 400, message.replaceAll(" ", "_"), "请求参数无效");
        return;
      }
      writeError(res, 500, "internal_error", asString(err && err.message).trim() || "internal error");
    }
  });

  server.on("close", () => {
    store.close();
  });

  return server;
}

async function main() {
  const config = getMailConfig();
  const server = createServer({
    mailConfigFactory: () => config
  });
  await new Promise((resolve) => server.listen(config.port, config.host, resolve));
  console.log(`[admin_console] listening on ${config.host}:${config.port}`);
  console.log(`[admin_console] ui: http://${config.host}:${config.port}/admin`);
  console.log(`[admin_console] env file: ${config.envFile}`);
  console.log(`[admin_console] mail configured: ${config.configured ? "yes" : "no"}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  createServer
};
