const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const {createServer} = require("../src/server");
const {FEATURE_CODES} = require("../../shared/featureCodes");
const {stableJsonStringify} = require("../../shared/licensePolicy");
const {validateCraftPermitSnapshot} = require("../../shared/craftPermitPolicy");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-control-plane-server-"));
}

const FIXED_NOW = "2026-04-05T00:00:00.000Z";

async function startServer() {
  const tempDir = makeTempDir();
  const dbPath = path.join(tempDir, "control-plane-auth.db");
  const sentMessages = [];
  let nextCode = 123456;
  const server = createServer({
    dbPath,
    codeGenerator() {
      const value = String(nextCode);
      nextCode += 111111;
      return value;
    },
    mailConfigFactory() {
      return {
        configured: true,
        fromName: "CS2 Tools",
        fromAddress: "3812776827@qq.com",
        testTo: "430158438@qq.com",
        authCodeTtlMinutes: 5,
        refreshSessionDays: 30,
        adminSessionHours: 12
      };
    },
    now() {
      return new Date(FIXED_NOW);
    },
    mailServiceFactory() {
      return {
        getCapabilities() {
          return {configured: true};
        },
        async sendVerificationCode(payload) {
          sentMessages.push({kind: "verification", ...payload});
          return {messageId: `msg_${sentMessages.length}`};
        },
        async sendTestMail(payload) {
          sentMessages.push({kind: "test", ...payload});
          return {messageId: `msg_${sentMessages.length}`};
        }
      };
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    tempDir,
    sentMessages,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function stopServer(ctx) {
  await new Promise((resolve) => ctx.server.close(resolve));
  fs.rmSync(ctx.tempDir, {recursive: true, force: true});
}

async function requestJson(ctx, method, route, body = null, headers = null) {
  const rawBody = body ? JSON.stringify(body) : "";
  const url = new URL(route, ctx.baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(rawBody),
        ...(headers && typeof headers === "object" ? headers : {})
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let parsed = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch (_) {
          parsed = {};
        }
        resolve({
          status: res.statusCode || 0,
          body: parsed,
          text: raw
        });
      });
    });
    req.on("error", reject);
    if (rawBody) {
      req.write(rawBody);
    }
    req.end();
  });
}

async function main() {
  const ctx = await startServer();
  try {
    const health = await requestJson(ctx, "GET", "/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);

    const adminBootstrapState = await requestJson(ctx, "GET", "/api/admin/bootstrap/state");
    assert.equal(adminBootstrapState.status, 200);
    assert.equal(adminBootstrapState.body.ok, true);
    assert.equal(adminBootstrapState.body.needs_bootstrap, true);

    const adminBootstrap = await requestJson(ctx, "POST", "/api/admin/bootstrap", {
      username: "admin",
      password: "Root123!"
    });
    assert.equal(adminBootstrap.status, 200);
    assert.equal(adminBootstrap.body.ok, true);
    assert.equal(adminBootstrap.body.user.username, "admin");

    const adminLogin = await requestJson(ctx, "POST", "/api/admin/login", {
      username: "admin",
      password: "Root123!"
    });
    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.body.ok, true);
    assert.equal(typeof adminLogin.body.session_token, "string");
    assert.equal(adminLogin.body.user.username, "admin");

    const adminHeaders = {
      Authorization: `Bearer ${adminLogin.body.session_token}`
    };

    const adminSession = await requestJson(ctx, "GET", "/api/admin/session", null, adminHeaders);
    assert.equal(adminSession.status, 200);
    assert.equal(adminSession.body.ok, true);
    assert.equal(adminSession.body.authenticated, true);
    assert.equal(adminSession.body.user.username, "admin");

    const plans = await requestJson(ctx, "GET", "/api/admin/plans", null, adminHeaders);
    assert.equal(plans.status, 200);
    assert.equal(plans.body.ok, true);
    assert.deepEqual(plans.body.items.map((item) => item.code), ["inactive", "member", "standard", "trial"]);

    const register = await requestJson(ctx, "POST", "/api/auth/email/send-code", {
      email: "alice@example.com"
    });
    assert.equal(register.status, 200);
    assert.equal(register.body.ok, true);
    assert.equal(register.body.expires_in_seconds, 300);
    assert.equal(ctx.sentMessages.length, 1);
    assert.equal(ctx.sentMessages[0].kind, "verification");
    assert.equal(ctx.sentMessages[0].scene, "register");
    assert.equal(ctx.sentMessages[0].to, "alice@example.com");
    assert.equal(ctx.sentMessages[0].code, "123456");

    const invalidScene = await requestJson(ctx, "POST", "/api/auth/email/send-code", {
      email: "mallory@example.com",
      scene: "admin_unlock"
    });
    assert.equal(invalidScene.status, 400);
    assert.equal(invalidScene.body.reason, "email_code_scene_invalid");
    assert.equal(ctx.sentMessages.length, 1);

    const bruteForceRegisterCode = await requestJson(ctx, "POST", "/api/auth/email/send-code", {
      email: "brute@example.com"
    });
    assert.equal(bruteForceRegisterCode.status, 200);
    assert.equal(bruteForceRegisterCode.body.ok, true);
    assert.equal(ctx.sentMessages.length, 2);
    assert.equal(ctx.sentMessages[1].scene, "register");
    assert.equal(ctx.sentMessages[1].code, "234567");

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const wrongRegisterCode = await requestJson(ctx, "POST", "/api/auth/register", {
        email: "brute@example.com",
        code: "000000",
        username: "brute",
        password: "Secret123!"
      });
      assert.equal(wrongRegisterCode.status, 400);
      assert.equal(wrongRegisterCode.body.reason, "code_mismatch");
    }

    const lockedRegisterCode = await requestJson(ctx, "POST", "/api/auth/register", {
      email: "brute@example.com",
      code: "000000",
      username: "brute",
      password: "Secret123!"
    });
    assert.equal(lockedRegisterCode.status, 400);
    assert.equal(lockedRegisterCode.body.reason, "code_attempt_limit_exceeded");

    const consumedAfterWrongAttempts = await requestJson(ctx, "POST", "/api/auth/register", {
      email: "brute@example.com",
      code: "234567",
      username: "brute",
      password: "Secret123!"
    });
    assert.equal(consumedAfterWrongAttempts.status, 400);
    assert.equal(consumedAfterWrongAttempts.body.reason, "code_not_found");

    const registered = await requestJson(ctx, "POST", "/api/auth/register", {
      email: "alice@example.com",
      code: "123456",
      username: "alice",
      password: "Secret123!"
    });
    assert.equal(registered.status, 200);
    assert.equal(registered.body.ok, true);
    assert.equal(registered.body.user.username, "alice");
    assert.equal(registered.body.user.membership_plan, "trial");
    assert.equal(registered.body.user.membership_expires_at, "2026-04-12T00:00:00.000Z");
    assert.equal(registered.body.user.remaining_membership_days, 7);

    const userList = await requestJson(ctx, "GET", "/api/admin/users", null, adminHeaders);
    assert.equal(userList.status, 200);
    assert.equal(userList.body.ok, true);
    assert.equal(userList.body.items.length, 1);
    assert.equal(userList.body.items[0].username, "alice");
    assert.equal(userList.body.items[0].membership_plan, "trial");
    assert.equal(userList.body.items[0].membership_expires_at, "2026-04-12T00:00:00.000Z");
    assert.equal(userList.body.items[0].remaining_membership_days, 7);
    assert.deepEqual(userList.body.items[0].entitlements.permissions, [
      FEATURE_CODES.ACCOUNTS_READ,
      FEATURE_CODES.ACCOUNTS_WRITE,
      FEATURE_CODES.CRAFT_USE,
      FEATURE_CODES.INVENTORY_READ,
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.SIMULATION_USE
    ]);
    assert.equal(userList.body.items[0].entitlements.feature_flags.craft_enabled, true);
    assert.equal(userList.body.items[0].entitlements.feature_flags.steam_binding_limit, 1);
    assert.equal(userList.body.items[0].entitlements.feature_flags.trial_active, true);
    assert.equal(userList.body.items[0].entitlements.feature_flags.trial_expires_at, "2026-04-12T00:00:00.000Z");

    const updatedUser = await requestJson(ctx, "PATCH", `/api/admin/users/${userList.body.items[0].id}`, {
      membership_plan: "standard",
      membership_expires_at: "2026-04-20T00:00:00.000Z",
      permission_overrides: [
        {feature_code: FEATURE_CODES.CRAFT_USE, enabled: true}
      ]
    }, adminHeaders);
    assert.equal(updatedUser.status, 200);
    assert.equal(updatedUser.body.ok, true);
    assert.equal(updatedUser.body.user.membership_plan, "standard");
    assert.equal(updatedUser.body.user.membership_expires_at, "2026-04-20T00:00:00.000Z");
    assert.equal(updatedUser.body.user.remaining_membership_days, 15);
    assert.deepEqual(updatedUser.body.entitlements.permissions, [
      FEATURE_CODES.ACCOUNTS_READ,
      FEATURE_CODES.ACCOUNTS_WRITE,
      FEATURE_CODES.CRAFT_USE,
      FEATURE_CODES.INVENTORY_READ,
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.SIMULATION_USE
    ]);
    assert.equal(updatedUser.body.entitlements.feature_flags.simulation_enabled, true);
    assert.equal(updatedUser.body.entitlements.feature_flags.craft_enabled, true);
    assert.equal(updatedUser.body.entitlements.feature_flags.steam_binding_mode, "single_locked");
    assert.equal(updatedUser.body.entitlements.feature_flags.steam_binding_limit, 1);
    assert.equal(updatedUser.body.entitlements.feature_flags.trial_active, false);
    assert.equal(updatedUser.body.entitlements.feature_flags.trial_expires_at, "");
    assert.equal(updatedUser.body.entitlements.membership_active, true);
    assert.equal(updatedUser.body.entitlements.remaining_membership_days, 15);

    const login = await requestJson(ctx, "POST", "/api/auth/login", {
      username: "alice",
      password: "Secret123!",
      device_id: "device_alpha",
      client_version: "1.0.0"
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.ok, true);
    assert.equal(login.body.user.username, "alice");
    assert.equal(typeof login.body.refresh_token, "string");
    assert.equal(login.body.refresh_token.length > 10, true);
    assert.equal(login.body.access_bundle.snapshot.username, "alice");
    assert.equal(login.body.access_bundle.snapshot.device_id, "device_alpha");
    assert.deepEqual(login.body.access_bundle.snapshot.permissions, [
      FEATURE_CODES.ACCOUNTS_READ,
      FEATURE_CODES.ACCOUNTS_WRITE,
      FEATURE_CODES.CRAFT_USE,
      FEATURE_CODES.INVENTORY_READ,
      FEATURE_CODES.INVENTORY_REFRESH,
      FEATURE_CODES.SIMULATION_USE
    ]);
    assert.equal(login.body.access_bundle.snapshot.feature_flags.simulation_enabled, true);
    assert.equal(login.body.access_bundle.snapshot.feature_flags.craft_enabled, true);
    assert.equal(login.body.access_bundle.snapshot.feature_flags.steam_binding_limit, 1);
    assert.equal(login.body.access_bundle.snapshot.feature_flags.trial_active, false);

    const firstBinding = await requestJson(ctx, "POST", "/api/auth/steam-binding/check-or-bind", {
      refresh_token: login.body.refresh_token,
      device_id: "device_alpha",
      steam_id: "76561198000000001",
      steam_account_name: "steam_account_a"
    });
    assert.equal(firstBinding.status, 200);
    assert.equal(firstBinding.body.ok, true);
    assert.equal(firstBinding.body.binding_limit, 1);
    assert.equal(firstBinding.body.bound_count, 1);
    assert.equal(firstBinding.body.matched_existing, false);

    const sameBinding = await requestJson(ctx, "POST", "/api/auth/steam-binding/check-or-bind", {
      refresh_token: login.body.refresh_token,
      device_id: "device_alpha",
      steam_id: "76561198000000001",
      steam_account_name: "steam_account_a"
    });
    assert.equal(sameBinding.status, 200);
    assert.equal(sameBinding.body.ok, true);
    assert.equal(sameBinding.body.matched_existing, true);
    assert.equal(sameBinding.body.bound_count, 1);

    const rejectedSecondBinding = await requestJson(ctx, "POST", "/api/auth/steam-binding/check-or-bind", {
      refresh_token: login.body.refresh_token,
      device_id: "device_alpha",
      steam_id: "76561198000000002",
      steam_account_name: "steam_account_b"
    });
    assert.equal(rejectedSecondBinding.status, 409);
    assert.equal(rejectedSecondBinding.body.reason, "steam_binding_limit_reached");

    const adminBindings = await requestJson(
      ctx,
      "GET",
      `/api/admin/users/${userList.body.items[0].id}/steam-bindings`,
      null,
      adminHeaders
    );
    assert.equal(adminBindings.status, 200);
    assert.equal(adminBindings.body.ok, true);
    assert.equal(adminBindings.body.items.length, 1);
    assert.equal(adminBindings.body.items[0].steam_id, "76561198000000001");

    const revokeBinding = await requestJson(
      ctx,
      "POST",
      `/api/admin/users/${userList.body.items[0].id}/steam-bindings/${adminBindings.body.items[0].id}/revoke`,
      {note: "manual_reset"},
      adminHeaders
    );
    assert.equal(revokeBinding.status, 200);
    assert.equal(revokeBinding.body.ok, true);

    const reboundAfterAdminReset = await requestJson(ctx, "POST", "/api/auth/steam-binding/check-or-bind", {
      refresh_token: login.body.refresh_token,
      device_id: "device_alpha",
      steam_id: "76561198000000002",
      steam_account_name: "steam_account_b"
    });
    assert.equal(reboundAfterAdminReset.status, 200);
    assert.equal(reboundAfterAdminReset.body.ok, true);
    assert.equal(reboundAfterAdminReset.body.bound_count, 1);

    const memberUser = await requestJson(ctx, "PATCH", `/api/admin/users/${userList.body.items[0].id}`, {
      membership_plan: "member",
      membership_expires_at: "",
      permission_overrides: []
    }, adminHeaders);
    assert.equal(memberUser.status, 200);
    assert.equal(memberUser.body.ok, true);

    const memberSecondBinding = await requestJson(ctx, "POST", "/api/auth/steam-binding/check-or-bind", {
      refresh_token: login.body.refresh_token,
      device_id: "device_alpha",
      steam_id: "76561198000000003",
      steam_account_name: "steam_account_c"
    });
    assert.equal(memberSecondBinding.status, 200);
    assert.equal(memberSecondBinding.body.ok, true);
    assert.equal(memberSecondBinding.body.binding_limit, -1);
    assert.equal(memberSecondBinding.body.bound_count, 2);
    assert.equal(memberSecondBinding.body.matched_existing, false);

    const craftPermit = await requestJson(ctx, "POST", "/api/auth/craft-permit", {
      refresh_token: login.body.refresh_token,
      device_id: "device_alpha",
      action: "craft.tradeup.execute",
      account_username: "steam_account_a",
      payload_hash: "sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
    });
    assert.equal(craftPermit.status, 200);
    assert.equal(craftPermit.body.ok, true);
    assert.equal(craftPermit.body.permit.snapshot.username, "alice");
    assert.equal(craftPermit.body.permit.snapshot.device_id, "device_alpha");
    assert.equal(craftPermit.body.permit.snapshot.action, "craft.tradeup.execute");
    assert.equal(craftPermit.body.permit.snapshot.account_username, "steam_account_a");
    assert.equal(
      validateCraftPermitSnapshot(craftPermit.body.permit.snapshot).ok,
      true
    );
    const publicKey = fs.readFileSync(path.join(__dirname, "..", "..", "keys", "client_license_public.pem"), "utf8");
    const permitVerified = crypto.verify(
      null,
      Buffer.from(stableJsonStringify(craftPermit.body.permit.snapshot)),
      publicKey,
      Buffer.from(craftPermit.body.permit.signature, "base64")
    );
    assert.equal(permitVerified, true);

    const craftPermitDeviceMismatch = await requestJson(ctx, "POST", "/api/auth/craft-permit", {
      refresh_token: login.body.refresh_token,
      device_id: "device_beta",
      action: "craft.tradeup.execute",
      account_username: "steam_account_a",
      payload_hash: "sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
    });
    assert.equal(craftPermitDeviceMismatch.status, 409);
    assert.equal(craftPermitDeviceMismatch.body.reason, "device_mismatch");

    const craftPermitMissingToken = await requestJson(ctx, "POST", "/api/auth/craft-permit", {
      refresh_token: "",
      device_id: "device_alpha",
      action: "craft.tradeup.execute",
      account_username: "steam_account_a",
      payload_hash: "sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
    });
    assert.equal(craftPermitMissingToken.status, 400);
    assert.equal(craftPermitMissingToken.body.reason, "craft_permit_payload_invalid");

    const downgradedUser = await requestJson(ctx, "PATCH", `/api/admin/users/${userList.body.items[0].id}`, {
      membership_plan: "inactive",
      membership_expires_at: "",
      permission_overrides: []
    }, adminHeaders);
    assert.equal(downgradedUser.status, 200);
    assert.equal(downgradedUser.body.ok, true);

    const inactiveBinding = await requestJson(ctx, "POST", "/api/auth/steam-binding/check-or-bind", {
      refresh_token: login.body.refresh_token,
      device_id: "device_alpha",
      steam_id: "76561198000000001",
      steam_account_name: "steam_account_a"
    });
    assert.equal(inactiveBinding.status, 409);
    assert.equal(inactiveBinding.body.reason, "membership_inactive");

    const craftPermitDenied = await requestJson(ctx, "POST", "/api/auth/craft-permit", {
      refresh_token: login.body.refresh_token,
      device_id: "device_alpha",
      action: "craft.tradeup.execute",
      account_username: "steam_account_a",
      payload_hash: "sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
    });
    assert.equal(craftPermitDenied.status, 403);
    assert.equal(craftPermitDenied.body.reason, "craft_permission_denied");

    const refreshed = await requestJson(ctx, "POST", "/api/auth/refresh", {
      refresh_token: login.body.refresh_token,
      device_id: "device_alpha"
    });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.ok, true);
    assert.equal(typeof refreshed.body.refresh_token, "string");
    assert.notEqual(refreshed.body.refresh_token, login.body.refresh_token);
    assert.equal(refreshed.body.access_bundle.snapshot.username, "alice");

    const devices = await requestJson(ctx, "GET", `/api/admin/users/${userList.body.items[0].id}/devices`, null, adminHeaders);
    assert.equal(devices.status, 200);
    assert.equal(devices.body.ok, true);
    assert.equal(devices.body.items.length, 1);
    assert.equal(devices.body.items[0].device_id, "device_alpha");

    const revokeDevice = await requestJson(ctx, "POST", `/api/admin/users/${userList.body.items[0].id}/devices/${devices.body.items[0].id}/revoke`, {}, adminHeaders);
    assert.equal(revokeDevice.status, 200);
    assert.equal(revokeDevice.body.ok, true);

    const refreshAfterDeviceRevoke = await requestJson(ctx, "POST", "/api/auth/refresh", {
      refresh_token: refreshed.body.refresh_token,
      device_id: "device_alpha"
    });
    assert.equal(refreshAfterDeviceRevoke.status, 401);
    assert.equal(refreshAfterDeviceRevoke.body.reason, "refresh_token_not_found");

    const reset = await requestJson(ctx, "POST", "/api/auth/password/send-reset-code", {
      email: "alice@example.com"
    });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.ok, true);
    assert.equal(ctx.sentMessages.length, 3);
    assert.equal(ctx.sentMessages[2].scene, "reset_password");
    assert.equal(ctx.sentMessages[2].code, "345678");

    const resetDone = await requestJson(ctx, "POST", "/api/auth/password/reset", {
      email: "alice@example.com",
      code: "345678",
      new_password: "Secret456!"
    });
    assert.equal(resetDone.status, 200);
    assert.equal(resetDone.body.ok, true);

    const loginAfterReset = await requestJson(ctx, "POST", "/api/auth/login", {
      username: "alice",
      password: "Secret456!",
      device_id: "device_alpha"
    });
    assert.equal(loginAfterReset.status, 200);
    assert.equal(loginAfterReset.body.ok, true);
    assert.equal(loginAfterReset.body.user.username, "alice");

    const logout = await requestJson(ctx, "POST", "/api/auth/logout", {
      refresh_token: loginAfterReset.body.refresh_token
    });
    assert.equal(logout.status, 200);
    assert.equal(logout.body.ok, true);

    const refreshAfterLogout = await requestJson(ctx, "POST", "/api/auth/refresh", {
      refresh_token: loginAfterReset.body.refresh_token,
      device_id: "device_alpha"
    });
    assert.equal(refreshAfterLogout.status, 401);
    assert.equal(refreshAfterLogout.body.reason, "refresh_token_not_found");

    const testMail = await requestJson(ctx, "POST", "/api/dev/mail/test", {
      to: "430158438@qq.com"
    });
    assert.equal(testMail.status, 200);
    assert.equal(testMail.body.ok, true);
    assert.equal(ctx.sentMessages.length, 4);
    assert.equal(ctx.sentMessages[3].kind, "test");
    assert.equal(ctx.sentMessages[3].to, "430158438@qq.com");

    const adminHtml = await requestJson(ctx, "GET", "/admin");
    assert.equal(adminHtml.status, 200);
    assert.match(adminHtml.text, /adminConsoleApp/);
    assert.doesNotMatch(adminHtml.text, /cdn\.jsdelivr\.net/);
    assert.match(adminHtml.text, /\/admin\/vendor\/tabler\/tabler\.min\.css/);
    assert.match(adminHtml.text, /\/admin\/vendor\/tabler\/tabler\.min\.js/);
  } finally {
    await stopServer(ctx);
  }

  console.log("control-plane-server tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
