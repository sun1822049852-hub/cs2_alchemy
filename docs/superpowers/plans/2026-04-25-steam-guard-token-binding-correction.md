# Steam Guard Token Binding Correction Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the Steam Guard token binding feature so the same stored Steam login can either enroll a first authenticator or replace an existing one, while ensuring the generated `maFile` is compatible with the project's current parser, Web-session refresh path, and token-detail UI.

**Architecture:** Keep the current two-step UI (`enroll` -> `finalize`) and the existing local API surface, but split the backend into two explicit branches: `new_enroll` via `steam-user.enableTwoFactor/finalizeTwoFactor`, and `replace_existing` via authenticated CM unified messages `TwoFactor.RemoveAuthenticatorViaChallengeStart/Continue`. Centralize both branches behind one normalized `maFile` builder that matches the project's real consumption contract: `Session.SteamID`, `Session.SteamLoginSecure`, top-level `access_token`, `identity_secret`, and `fully_enrolled`.

**Tech Stack:** Node.js CommonJS, `steam-user`, `steamcommunity`, built-in `http`/`crypto`/`node:sqlite`, plain HTML/CSS/JS, `node:assert` tests run with `node <test-file>`.

---

**Workspace Policy:** This repository stays uncommitted unless the user explicitly asks. Replace commit steps with diff checkpoints and verification runs. Do not create commits while executing this plan unless the user later requests it.

## File Structure

- Modify: `node_sidecar/src/steamGuardEnrollService.js`
  Own the corrected state machine, the `new_enroll` vs `replace_existing` branch split, authenticated CM wrappers for `RemoveAuthenticatorViaChallenge*`, and the single normalized `maFile` builder.
- Modify: `node_sidecar/src/uiServer.js`
  Own the `/api/accounts/enroll-steam-guard`, `/api/accounts/finalize-steam-guard`, and `/api/accounts/token-detail` route behavior, scoped account persistence, and incomplete-`maFile` Web-session fallback.
- Modify: `node_sidecar/ui/index.html`
  Own the corrected modal copy and any step-specific status placeholders for “new binding” vs “replace binding”.
- Modify: `node_sidecar/ui/app.js`
  Own the frontend mode handling for the enroll modal, the replace-flow SMS prompt behavior, and the token-detail modal’s data consumption.
- Modify: `node_sidecar/ui/styles.css`
  Own any small layout/copy adjustments required by the corrected enroll-mode messaging.
- Create: `node_sidecar/tests/steam-guard-enroll-service.test.js`
  Lock the backend branch split, replacement-token normalization, and `maFile` output contract.
- Create: `node_sidecar/tests/token-detail-route.test.js`
  Lock the token-detail route payload shape, redaction rules, and TOTP data contract.
- Create: `node_sidecar/tests/steam-guard-web-session-fallback.test.js`
  Lock the runtime fallback behavior when `mafile_content` exists but lacks usable token fields.
- Create: `tests/steamGuardEnrollCopy.test.js`
  Lock the corrected UI copy so the feature no longer promises replacement without a real backend replacement path.

## Chunk 1: Lock The Corrected Contract

### Task 1: Add failing tests for new-vs-replace backend behavior

**Files:**
- Create: `node_sidecar/tests/steam-guard-enroll-service.test.js`

- [ ] **Step 1: Write the failing “existing authenticator starts replace flow” test**

```js
async function test_enroll_status_29_starts_replace_flow_instead_of_terminal_error() {
  const calls = [];
  const fakeSteam = {
    logOn() {
      setImmediate(() => this._loggedOn());
    },
    once(event, handler) {
      if (event === "loggedOn") this._loggedOn = handler;
      if (event === "error") this._error = handler;
    },
    enableTwoFactor(callback) {
      calls.push("enableTwoFactor");
      callback(null, {status: 29});
    },
    _sendUnified(method, payload, callback) {
      calls.push({method, payload});
      if (method === "TwoFactor.RemoveAuthenticatorViaChallengeStart#1") {
        callback({success: true});
      }
    },
    logOff() {}
  };

  const result = await enrollSteamGuard({
    username: "demo",
    refreshToken: "refresh_1",
    logger: null,
    timeoutMs: 5000,
    SteamUserClass: function FakeSteamUser() { return fakeSteam; }
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "replace");
  assert.equal(result.requires_sms, true);
  assert.deepEqual(calls.map((x) => typeof x === "string" ? x : x.method), [
    "enableTwoFactor",
    "TwoFactor.RemoveAuthenticatorViaChallengeStart#1"
  ]);
}
```

- [ ] **Step 2: Add the failing replacement-token normalization test**

```js
async function test_finalize_replace_builds_project_compatible_mafile() {
  const result = await finalizeSteamGuard({
    username: "demo",
    activationCode: "123456",
    logger: null,
    sessionStore: new Map([["demo", {
      mode: "replace",
      refreshToken: "refresh_1",
      steamId64: "76561198000000001",
      accountName: "demo",
      deviceId: "android:test-device",
      steam: {
        _sendUnified(method, payload, callback) {
          callback({
            success: true,
            replacement_token: {
              shared_secret: Buffer.from("abc"),
              serial_number: "123",
              revocation_code: "R12345",
              uri: "otpauth://totp/Steam:demo?secret=...",
              server_time: 1777000000,
              account_name: "demo",
              token_gid: "gid_1",
              identity_secret: Buffer.from("xyz"),
              secret_1: Buffer.from("qwe"),
              status: 1,
              steamguard_scheme: 2,
              steamid: "76561198000000001"
            }
          });
        },
        logOff() {}
      }
    }]]),
    refreshAccessTokenFn: async () => "access_1"
  });

  const ma = JSON.parse(result.maFileContent);
  assert.equal(ma.Session.SteamID, "76561198000000001");
  assert.equal(ma.Session.SteamLoginSecure, "steamLoginSecure=76561198000000001%7C%7Crefresh_1");
  assert.equal(ma.access_token, "access_1");
  assert.equal(ma.fully_enrolled, true);
  assert.equal(ma.identity_secret, Buffer.from("xyz").toString("base64"));
}
```

- [ ] **Step 3: Add the failing first-enroll normalization test**

```js
async function test_finalize_new_enroll_uses_same_mafile_contract_as_replace_flow() {
  // Same shape assertions as replace path, but sourced from cached enableTwoFactor response
}
```

- [ ] **Step 4: Run the new service test file to verify failure**

Run: `node node_sidecar/tests/steam-guard-enroll-service.test.js`
Expected: FAIL because the current service returns `already_has_authenticator` on status `29`, has no replacement wrappers, and writes `Session: {}`.

- [ ] **Step 5: Checkpoint**

Run: `git diff -- node_sidecar/tests/steam-guard-enroll-service.test.js`
Expected: only the new failing service tests appear.

### Task 2: Add failing contract tests for route payloads and broken-`maFile` fallback

**Files:**
- Create: `node_sidecar/tests/token-detail-route.test.js`
- Create: `node_sidecar/tests/steam-guard-web-session-fallback.test.js`
- Create: `tests/steamGuardEnrollCopy.test.js`

- [ ] **Step 1: Write the failing token-detail route test**

```js
async function test_token_detail_redacts_raw_tokens_but_keeps_totp_contract() {
  const response = await requestJson(ctx, "GET", "/api/accounts/token-detail?username=demo");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(typeof response.body.currentTotp, "string");
  assert.equal(response.body.period, 30);
  assert.equal(response.body.steamData.access_token, "[REDACTED]");
  assert.equal(response.body.steamData.Session.SteamLoginSecure, "[REDACTED]");
}
```

- [ ] **Step 2: Write the failing Web-session fallback test**

```js
async function test_incomplete_mafile_falls_back_to_token_store_refresh_token() {
  const account = {
    username: "demo",
    steam_id64: "76561198000000001",
    mafile_content: JSON.stringify({
      shared_secret: "abc",
      identity_secret: "xyz",
      Session: {}
    })
  };

  const result = await resolveWebSessionForAccount(account);
  assert.equal(result.webSession.steamId64, "76561198000000001");
}
```

- [ ] **Step 3: Write the failing UI copy test**

```js
const APP_SOURCE = fs.readFileSync("node_sidecar/ui/index.html", "utf8");
assert.match(APP_SOURCE, /系统会在验证后判断是首次绑定还是替换旧令牌/);
assert.doesNotMatch(APP_SOURCE, /可直接替换原有令牌/);
```

- [ ] **Step 4: Run the targeted tests to verify failure**

Run: `node node_sidecar/tests/token-detail-route.test.js`
Expected: FAIL because the current route returns raw `mafile_content` and raw decryption material.

Run: `node node_sidecar/tests/steam-guard-web-session-fallback.test.js`
Expected: FAIL because the current `resolveWebSessionForAccount()` hard-fails on incomplete `mafile_content` and never falls back to `TokenStore`.

Run: `node tests/steamGuardEnrollCopy.test.js`
Expected: FAIL because current copy promises “可直接替换原有令牌”.

- [ ] **Step 5: Checkpoint**

Run: `git diff -- node_sidecar/tests/token-detail-route.test.js node_sidecar/tests/steam-guard-web-session-fallback.test.js tests/steamGuardEnrollCopy.test.js`
Expected: only the new failing contract tests appear.

## Chunk 2: Correct The Backend Branch Split

### Task 3: Refactor `steamGuardEnrollService.js` into explicit `new_enroll` and `replace_existing` modes

**Files:**
- Modify: `node_sidecar/src/steamGuardEnrollService.js`
- Reference: `node_sidecar/node_modules/steam-user/components/twofactor.js`
- Reference: `node_sidecar/node_modules/steam-user/protobufs/steammessages_twofactor.steamclient.proto`

- [ ] **Step 1: Add small helper wrappers around `_sendUnified` for replacement**

```js
function sendUnified(steam, method, payload) {
  return new Promise((resolve, reject) => {
    try {
      steam._sendUnified(method, payload, (body) => resolve(body));
    } catch (err) {
      reject(err);
    }
  });
}

async function startReplaceAuthenticator(steam) {
  const body = await sendUnified(steam, "TwoFactor.RemoveAuthenticatorViaChallengeStart#1", {});
  if (!body || body.success !== true) {
    throw new Error("replace_start_failed");
  }
  return body;
}

async function continueReplaceAuthenticator(steam, smsCode) {
  const body = await sendUnified(steam, "TwoFactor.RemoveAuthenticatorViaChallengeContinue#1", {
    sms_code: smsCode,
    generate_new_token: true,
    version: 1
  });
  if (!body || body.success !== true || !body.replacement_token) {
    throw new Error("replace_finalize_failed");
  }
  return body;
}
```

- [ ] **Step 2: Normalize replacement-token buffers exactly once**

```js
function normalizeReplacementToken(token = {}) {
  return {
    ...token,
    shared_secret: Buffer.isBuffer(token.shared_secret) ? token.shared_secret.toString("base64") : asString(token.shared_secret).trim(),
    identity_secret: Buffer.isBuffer(token.identity_secret) ? token.identity_secret.toString("base64") : asString(token.identity_secret).trim(),
    secret_1: Buffer.isBuffer(token.secret_1) ? token.secret_1.toString("base64") : asString(token.secret_1).trim()
  };
}
```

- [ ] **Step 3: Replace the current `status === 29` terminal error with cached `replace` mode**

```js
if (response.status === 29) {
  await startReplaceAuthenticator(steam);
  enrollingSessions.set(username, {
    mode: "replace",
    steam,
    refreshToken,
    steamId64: asString(steam.steamID && steam.steamID.getSteamID64 ? steam.steamID.getSteamID64() : "").trim(),
    accountName: username,
    timestamp: Date.now()
  });
  return {
    ok: true,
    mode: "replace",
    requires_sms: true
  };
}
```

- [ ] **Step 4: Add one normalized `maFile` builder used by both branches**

```js
async function buildProjectCompatibleMaFile({
  tokenPayload,
  accountName,
  steamId64,
  refreshToken,
  deviceId,
  refreshAccessTokenFn
}) {
  const accessToken = await refreshAccessTokenFn(refreshToken);
  return {
    uri: asString(tokenPayload.uri).trim(),
    status: Number(tokenPayload.status) || 1,
    Session: {
      SteamID: asString(steamId64).trim(),
      SteamLoginSecure: `steamLoginSecure=${steamId64}%7C%7C${refreshToken}`
    },
    secret_1: asString(tokenPayload.secret_1).trim(),
    device_id: asString(deviceId).trim(),
    token_gid: asString(tokenPayload.token_gid).trim(),
    server_time: String(tokenPayload.server_time || ""),
    access_token: asString(accessToken).trim(),
    account_name: asString(tokenPayload.account_name || accountName).trim(),
    serial_number: String(tokenPayload.serial_number || ""),
    shared_secret: asString(tokenPayload.shared_secret).trim(),
    fully_enrolled: true,
    identity_secret: asString(tokenPayload.identity_secret).trim(),
    revocation_code: asString(tokenPayload.revocation_code).trim()
  };
}
```

- [ ] **Step 5: Update `finalizeSteamGuard()` to branch on cached `mode`**

```js
if (session.mode === "new_enroll") {
  await steam.finalizeTwoFactor(sharedSecretBuffer, activationCode, callback);
  const maFile = await buildProjectCompatibleMaFile({...});
}

if (session.mode === "replace") {
  const replaceBody = await continueReplaceAuthenticator(steam, activationCode);
  const tokenPayload = normalizeReplacementToken(replaceBody.replacement_token);
  const maFile = await buildProjectCompatibleMaFile({...});
}
```

- [ ] **Step 6: Run the service test file again**

Run: `node node_sidecar/tests/steam-guard-enroll-service.test.js`
Expected: PASS

- [ ] **Step 7: Checkpoint**

Run: `git diff -- node_sidecar/src/steamGuardEnrollService.js node_sidecar/tests/steam-guard-enroll-service.test.js`
Expected: only the service state-machine and normalized `maFile` changes appear.

## Chunk 3: Align Routes, Runtime Fallbacks, And UI

### Task 4: Correct route behavior, scoped persistence, and incomplete-`maFile` fallback

**Files:**
- Modify: `node_sidecar/src/uiServer.js`
- Create: `node_sidecar/tests/token-detail-route.test.js`
- Create: `node_sidecar/tests/steam-guard-web-session-fallback.test.js`

- [ ] **Step 1: Make `/api/accounts/finalize-steam-guard` persist through the viewer-scoped `AccountStore` path**

```js
const accountStore = getViewerAccountStore(auth, deps);
const current = accountStore.get(username);
if (!current) {
  writeJson(res, 404, {ok: false, message: "账号不存在"});
  return true;
}
accountStore.upsert({
  username: current.username,
  password: current.password,
  remark: current.remark,
  steamName: current.steam_name,
  steamId: current.steam_id,
  steamId64: current.steam_id64,
  avatarUrl: current.avatar_url,
  mafileContent: result.maFileContent
});
```

- [ ] **Step 2: Make `resolveWebSessionForAccount()` fall back to `TokenStore` when `mafile_content` is present but incomplete**

```js
if (account.mafile_content) {
  const maData = parseMaFile(account.mafile_content);
  try {
    const webSession = await refreshWebCookie(maData);
    return {webSession, hasMaFile: true, maData};
  } catch (err) {
    const tokenStore = new TokenStore();
    const refreshToken = tokenStore.get(username);
    const steamId64 = asString(maData.steamId64 || account.steam_id64 || account.steam_id).trim();
    if (!refreshToken || !steamId64) throw err;
    const webSession = await refreshWebCookieFromToken(refreshToken, steamId64);
    return {webSession, hasMaFile: true, maData};
  }
}
```

- [ ] **Step 3: Redact raw token fields in `/api/accounts/token-detail` while keeping the TOTP contract**

```js
const raw = typeof acc.mafile_content === "string" ? JSON.parse(acc.mafile_content) : {};
const redacted = {
  ...raw,
  access_token: raw.access_token ? "[REDACTED]" : "",
  Session: raw.Session ? {
    ...raw.Session,
    SteamLoginSecure: raw.Session.SteamLoginSecure ? "[REDACTED]" : ""
  } : {}
};

writeJson(res, 200, {
  ok: true,
  deviceId: parsed.deviceId || "",
  revocationCode: parsed.revocationCode || "",
  accountName: parsed.accountName || username,
  steamId64: parsed.steamId64 || "",
  currentTotp,
  serverTimeDiff,
  period: 30,
  encryptedSecret: encrypted,
  secretKeyHex: secretKey.toString("hex"),
  ivHex: iv.toString("hex"),
  steamData: redacted
});
```

- [ ] **Step 4: Run the route and fallback tests**

Run: `node node_sidecar/tests/token-detail-route.test.js`
Expected: PASS

Run: `node node_sidecar/tests/steam-guard-web-session-fallback.test.js`
Expected: PASS

- [ ] **Step 5: Checkpoint**

Run: `git diff -- node_sidecar/src/uiServer.js node_sidecar/tests/token-detail-route.test.js node_sidecar/tests/steam-guard-web-session-fallback.test.js`
Expected: only route-scoping, redaction, and fallback changes appear.

### Task 5: Correct the enroll modal copy and mode handling

**Files:**
- Modify: `node_sidecar/ui/index.html`
- Modify: `node_sidecar/ui/app.js`
- Modify: `node_sidecar/ui/styles.css`
- Create: `tests/steamGuardEnrollCopy.test.js`

- [ ] **Step 1: Replace the static false promise in the warning copy**

```html
<li>系统会在验证后判断是首次绑定还是替换旧令牌</li>
<li>完成绑定后 <strong>两天内无法交易</strong></li>
<li>如果您尚未绑定过 Steam 令牌，则会有 <strong>15 天的市场交易冷却期</strong></li>
<li>请确保已启用加速器</li>
```

- [ ] **Step 2: Make the frontend store and render backend `mode`**

```js
let enrollState = {
  step: 1,
  username: "",
  mode: "",
  revocationCode: "",
  running: false
};

if (data.ok) {
  enrollState.mode = data.mode || "new_enroll";
  const isReplace = enrollState.mode === "replace";
  document.getElementById("enrollRevocationWrap").classList.toggle("hidden", isReplace);
  statusEl.textContent = isReplace ? "旧令牌替换验证已开始，请输入收到的验证码" : "验证码已发送到绑定手机";
}
```

- [ ] **Step 3: Keep `finalize` UX branch-neutral**

```js
if (data.ok) {
  document.getElementById("enrollFinalRevCode").textContent = data.revocation_code || "-";
  document.getElementById("enrollFinalModeText").textContent =
    enrollState.mode === "replace" ? "旧令牌已替换为新令牌" : "Steam Guard 令牌绑定成功";
}
```

- [ ] **Step 4: Run the UI copy test**

Run: `node tests/steamGuardEnrollCopy.test.js`
Expected: PASS

- [ ] **Step 5: Checkpoint**

Run: `git diff -- node_sidecar/ui/index.html node_sidecar/ui/app.js node_sidecar/ui/styles.css tests/steamGuardEnrollCopy.test.js`
Expected: only corrected copy and mode-handling changes appear.

## Chunk 4: Focused Verification

### Task 6: Run the corrected focused regression set

**Files:**
- Reference only: `docs/reference/steam-guard-enroll/BD_WinAuth_SteamAuthenticator.cs`
- Reference only: `docs/reference/steam-guard-enroll/BD_WinAuth_SteamClient.cs`
- Reference only: `docs/reference/steam-guard-enroll/BD_SteamTools_JoinSteamAuthenticatorPageViewModel.cs`

- [ ] **Step 1: Run backend verification**

Run: `node node_sidecar/tests/steam-guard-enroll-service.test.js`
Expected: PASS

Run: `node node_sidecar/tests/token-detail-route.test.js`
Expected: PASS

Run: `node node_sidecar/tests/steam-guard-web-session-fallback.test.js`
Expected: PASS

- [ ] **Step 2: Run UI verification**

Run: `node tests/steamGuardEnrollCopy.test.js`
Expected: PASS

- [ ] **Step 3: Run one adjacent regression already touched by this feature**

Run: `node node_sidecar/tests/account-card-render.test.js`
Expected: PASS

Run: `node node_sidecar/tests/account-store-sqlite.test.js`
Expected: PASS

- [ ] **Step 4: Manual smoke checklist**

```text
1. Pick an account with no existing Steam Guard authenticator.
2. Trigger “绑定令牌”, confirm the backend reports mode=new_enroll.
3. Enter the SMS code and verify the saved maFile can immediately power token detail and Web-session flows.
4. Pick an account that already has a Steam Guard authenticator.
5. Trigger “绑定令牌”, confirm the backend reports mode=replace instead of terminal error.
6. Enter the replacement SMS code and verify the returned revocation code changes and token detail still works.
7. Confirm an older broken maFile row (empty Session object) still reaches Web-session flows through TokenStore fallback.
```

- [ ] **Step 5: Final checkpoint**

Run: `git status --short`
Expected: only the planned files are modified or newly created; do not commit unless the user explicitly requests it.

## Verification

- Run: `node node_sidecar/tests/steam-guard-enroll-service.test.js`
- Run: `node node_sidecar/tests/token-detail-route.test.js`
- Run: `node node_sidecar/tests/steam-guard-web-session-fallback.test.js`
- Run: `node tests/steamGuardEnrollCopy.test.js`
- Run: `node node_sidecar/tests/account-card-render.test.js`
- Run: `node node_sidecar/tests/account-store-sqlite.test.js`

## Notes

- Use the open-source reference only for behavior and field expectations; do not cargo-cult its exact local storage format where it conflicts with this repo’s real parser/runtime contract.
- The corrected plan must treat “new binding” and “replace old token” as two separate backend paths, even if they stay behind the same UI button.
- Do not keep the current false-positive `already_has_authenticator` terminal behavior after the replacement path exists.
- Do not emit another `Session: {}` maFile; the builder must always produce fields that the current project can actually consume.
- Do not write `mafile_content` through raw SQL by username when a viewer-scoped `AccountStore` path is available.
- Token-detail hardening beyond a local-machine threat model is out of scope for this correction; the minimum requirement is that raw token-bearing JSON returned to the UI is redacted.
