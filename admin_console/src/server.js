const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const {ControlPlaneStore} = require("./controlPlaneStore");
const {getMailConfig} = require("./mailConfig");
const {createMailService} = require("./mailService");
const {createEntitlementSigner} = require("./entitlementSigner");
const {DEFAULTS, PATHS} = require("./constants");
const {FEATURE_CODES} = require("../../shared/featureCodes");
const {validatePassword, validateUsername} = require("../../shared/validation");
const {asString} = require("../../node_sidecar/src/utils");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8"
};

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
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function createCodeGenerator() {
  return () => String(Math.floor(100000 + Math.random() * 900000));
}

function readBearerToken(req) {
  const auth = asString(req && req.headers && req.headers.authorization).trim();
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
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
    return signer.issueBundle({
      user: {
        ...user,
        membership_plan: entitlements ? entitlements.membership_plan : user.membership_plan
      },
      deviceId,
      permissions: entitlements ? entitlements.permissions : undefined,
      featureFlags: entitlements ? entitlements.feature_flags : undefined,
      refreshCredential,
      source
    });
  }

  function issueCraftPermit({user, deviceId, action, accountUsername, payloadHash}) {
    return signer.issueCraftPermit({
      user,
      deviceId,
      action,
      accountUsername,
      payloadHash,
      ttlSeconds: Math.max(1, Number(config.craftPermitTtlSeconds) || DEFAULTS.CRAFT_PERMIT_TTL_SECONDS),
      source: "remote_craft_permit"
    });
  }

  function resolveAdminSessionFromRequest(req) {
    const token = readBearerToken(req);
    if (!token) {
      return {ok: false, reason: "admin_auth_required"};
    }
    return store.resolveAdminSession({
      sessionToken: token,
      now: now()
    });
  }

  function requireAdminSession(req, res) {
    const resolved = resolveAdminSessionFromRequest(req);
    if (!resolved.ok) {
      writeError(res, 401, resolved.reason, "请先登录控制台管理员账号");
      return null;
    }
    return resolved;
  }

  function maskEmail(email) {
    const [local, domain] = asString(email).split("@");
    if (!local || !domain) return email;
    const visible = local.length <= 2 ? local[0] : local.slice(0, 2);
    return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
  }

  async function handleSendCode(res, body, scene) {
    const email = asString(body && body.email).trim().toLowerCase();
    if (!isValidEmail(email)) {
      writeError(res, 400, "email_invalid", "邮箱格式不正确");
      return;
    }
    if (!config.configured) {
      writeError(res, 503, "mail_service_not_configured", "邮件服务未配置");
      return;
    }
    const cooldownMs = Math.max(1, Number(config.authCodeCooldownSeconds) || DEFAULTS.AUTH_CODE_COOLDOWN_SECONDS) * 1000;
    if (!store.canSendCode({email, scene, cooldownMs, now: now()})) {
      writeError(res, 429, "email_code_rate_limited", "验证码发送过于频繁，请稍后再试");
      return;
    }
    const code = String(nextCode()).trim();
    const codeTtlMs = Math.max(1, Number(config.authCodeTtlMinutes) || DEFAULTS.AUTH_CODE_TTL_MINUTES) * 60 * 1000;
    const row = store.createEmailCode({
      email,
      scene,
      code,
      ttlMs: codeTtlMs,
      now: now()
    });
    try {
      await mailService.sendVerificationCode({
        to: email,
        code,
        scene,
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
      message: scene === "reset_password" ? "重置验证码已发送，请查收邮箱。" : "注册验证码已发送，请查收邮箱。",
      expires_in_seconds: expiresInSeconds
    };
    if (scene === "register") {
      const session = store.createRegisterSession({email, ttlMs: codeTtlMs, now: now()});
      responsePayload.register_session_id = session.session_id;
      responsePayload.masked_email = maskEmail(email);
      responsePayload.code_length = code.length;
      responsePayload.code_expires_in_seconds = expiresInSeconds;
      responsePayload.resend_after_seconds = Math.ceil(cooldownMs / 1000);
    }
    writeJson(res, 200, responsePayload);
  }

  function listAdminUsersPayload() {
    return store.listClientUsers({now: now()}).map((user) => ({
      ...user,
      entitlements: store.resolveUserEntitlements({userId: user.id, now: now()}),
      active_device_count: store.listUserDeviceSessions({userId: user.id}).length
    }));
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const pathname = url.pathname;
    try {
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
        const password = asString(body && body.password).trim();
        if (!password) {
          writeError(res, 400, "password_required", "管理员密码不能为空");
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
        const password = asString(body && body.password).trim();
        if (!password) {
          writeError(res, 400, "password_required", "管理员密码不能为空");
          return;
        }
        const auth = store.authenticateAdminUser({username, password});
        if (!auth.ok) {
          writeError(res, 401, auth.reason, "管理员账号或密码错误");
          return;
        }
        const session = store.createAdminSession({
          adminUserId: auth.user.id,
          ttlHours: config.adminSessionHours,
          now: now()
        });
        writeJson(res, 200, {
          ok: true,
          message: "管理员登录成功",
          user: auth.user,
          session_token: session.session_token,
          expires_at: session.expires_at
        });
        return;
      }

      if (req.method === "GET" && pathname === "/api/admin/session") {
        const token = readBearerToken(req);
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
          now: now()
        });
        if (!resolved.ok) {
          writeError(res, 401, resolved.reason, "控制台登录态已失效");
          return;
        }
        writeJson(res, 200, {
          ok: true,
          authenticated: true,
          user: resolved.user,
          expires_at: resolved.session.expires_at
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/admin/logout") {
        const token = readBearerToken(req);
        if (!token) {
          writeJson(res, 200, {ok: true, message: "已退出"});
          return;
        }
        const result = store.revokeAdminSession({
          sessionToken: token,
          now: now()
        });
        if (!result.ok) {
          writeError(res, 401, result.reason, "控制台登录态已失效");
          return;
        }
        writeJson(res, 200, {ok: true, message: "已退出"});
        return;
      }

      if (pathname.startsWith("/api/admin/")) {
        const admin = requireAdminSession(req, res);
        if (!admin) {
          return;
        }

        if (req.method === "GET" && pathname === "/api/admin/overview") {
          const users = store.listClientUsers({now: now()});
          writeJson(res, 200, {
            ok: true,
            stats: {
              total_users: users.length,
              active_users: users.filter((item) => item.status === "active").length,
              plans: store.listMembershipPlans().length
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
            items: listAdminUsersPayload()
          });
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

        const steamBindingRevokeMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/steam-bindings\/(\d+)\/revoke$/);
        if (req.method === "POST" && steamBindingRevokeMatch) {
          const userId = Number(steamBindingRevokeMatch[1]) || 0;
          const bindingId = Number(steamBindingRevokeMatch[2]) || 0;
          const user = store.getClientUserById(userId, {now: now()});
          if (!user) {
            writeError(res, 404, "user_not_found", "用户不存在");
            return;
          }
          const body = await readJsonBody(req);
          const revoked = store.revokeUserSteamBindingById({
            userId,
            bindingId,
            note: asString(body && body.note).trim(),
            now: now()
          });
          if (!revoked.ok) {
            writeError(res, 404, revoked.reason, "Steam 绑定资格不存在");
            return;
          }
          writeJson(res, 200, {ok: true, message: "Steam 绑定资格已解除"});
          return;
        }

        const steamBindingsMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/steam-bindings$/);
        if (req.method === "GET" && steamBindingsMatch) {
          const userId = Number(steamBindingsMatch[1]) || 0;
          const user = store.getClientUserById(userId, {now: now()});
          if (!user) {
            writeError(res, 404, "user_not_found", "用户不存在");
            return;
          }
          writeJson(res, 200, {
            ok: true,
            user,
            items: store.listUserSteamBindings({userId})
          });
          return;
        }

        const userMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
        if (req.method === "PATCH" && userMatch) {
          const userId = Number(userMatch[1]) || 0;
          const body = await readJsonBody(req);
          const updated = store.updateClientUserControl({
            userId,
            status: asString(body && body.status).trim(),
            membershipPlan: asString(body && body.membership_plan).trim(),
            membershipExpiresAt: asString(body && body.membership_expires_at).trim(),
            permissionOverrides: Array.isArray(body && body.permission_overrides) ? body.permission_overrides : null,
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
        const password = asString(body && body.password).trim();
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
        const trialExpiresAt = new Date(registerNow.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const user = store.createClientUser({
          email, username, password,
          membershipPlan: "trial",
          membershipExpiresAt: trialExpiresAt,
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
            source: "remote_register"
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
        const password = asString(body && body.password).trim();
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
        const trialExpiresAt = new Date(registerNow.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const user = store.createClientUser({
          email, username, password,
          membershipPlan: "trial",
          membershipExpiresAt: trialExpiresAt,
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
        const password = asString(body && body.password).trim();
        const deviceId = asString(body && body.device_id).trim();
        if (!username || !password || !deviceId) {
          writeError(res, 400, "login_payload_invalid", "用户名、密码、device_id 不能为空");
          return;
        }
        const clientIp = asString(req.socket && req.socket.remoteAddress).trim();
        if (store.isLoginLocked({username, maxAttempts: 5, windowMs: 15 * 60 * 1000, now: now()})) {
          writeError(res, 429, "login_locked", "登录失败次数过多，请15分钟后再试");
          return;
        }
        const auth = store.authenticateClientUser({username, password});
        store.recordLoginAttempt({username, success: auth.ok, ip: clientIp, now: now()});
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
            source: "remote_login"
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
            source: "remote_refresh"
          }),
          refresh_token: rotated.refresh_token
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/auth/craft-permit") {
        const body = await readJsonBody(req);
        const refreshToken = asString(body && body.refresh_token).trim();
        const deviceId = asString(body && body.device_id).trim();
        const action = asString(body && body.action).trim();
        const accountUsername = asString(body && body.account_username).trim();
        const payloadHash = asString(body && body.payload_hash).trim();
        if (!refreshToken || !deviceId || !action || !accountUsername || !payloadHash) {
          writeError(res, 400, "craft_permit_payload_invalid", "refresh_token、device_id、action、account_username、payload_hash 不能为空");
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
        const permissions = Array.isArray(access.entitlements && access.entitlements.permissions)
          ? access.entitlements.permissions
          : [];
        if (!permissions.includes(FEATURE_CODES.CRAFT_USE)) {
          writeError(res, 403, "craft_permission_denied", "当前账号未获得炼金执行授权");
          return;
        }
        writeJson(res, 200, {
          ok: true,
          permit: issueCraftPermit({
            user: access.user,
            deviceId,
            action,
            accountUsername,
            payloadHash
          })
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/auth/steam-binding/check-or-bind") {
        const body = await readJsonBody(req);
        const refreshToken = asString(body && body.refresh_token).trim();
        const deviceId = asString(body && body.device_id).trim();
        const steamId = asString(body && body.steam_id).trim();
        const steamAccountName = asString(body && body.steam_account_name).trim();
        if (!refreshToken || !deviceId || !steamId) {
          writeError(res, 400, "steam_binding_payload_invalid", "refresh_token、device_id、steam_id 不能为空");
          return;
        }
        const requestNow = now();
        const access = store.resolveClientAccess({
          refreshToken,
          deviceId,
          now: requestNow
        });
        if (!access.ok) {
          const status = access.reason === "device_mismatch" ? 409 : 401;
          writeError(res, status, access.reason, access.reason === "device_mismatch" ? "设备绑定不匹配" : "refresh_token 无效");
          return;
        }
        const result = store.checkOrBindSteamAccount({
          userId: access.user.id,
          steamId,
          steamAccountName,
          now: requestNow
        });
        writeJson(res, result && result.ok ? 200 : 409, result);
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
        const newPassword = asString(body && body.new_password).trim();
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
