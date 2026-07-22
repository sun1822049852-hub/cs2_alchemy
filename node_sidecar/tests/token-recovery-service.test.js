const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createTokenRecoveryService,
  isRecoverableTokenError
} = require("../src/tokenRecoveryService");

const COMPLETE_MAFILE = {
  shared_secret: Buffer.from("shared-secret").toString("base64"),
  identity_secret: Buffer.from("identity-secret").toString("base64"),
  revocation_code: "R12345",
  device_id: "android:00000000-0000-0000-0000-000000000001"
};

function createMemoryTokenStore(initialToken = "") {
  let token = initialToken;
  return {
    get() {
      return token;
    },
    set(_username, nextToken) {
      token = nextToken;
    },
    remove() {
      token = "";
    }
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}

test("classifies numeric Steam token rejection codes without classifying network failures", () => {
  assert.equal(isRecoverableTokenError({eresult: 5}), true);
  assert.equal(isRecoverableTokenError(new Error("steam error: InvalidPassword")), true);
  assert.equal(isRecoverableTokenError(new Error("steam disconnected code=5 reason=InvalidPassword")), true);
  assert.equal(isRecoverableTokenError({eresult: 15}), true);
  assert.equal(isRecoverableTokenError({eresult: 63}), false);
  assert.equal(isRecoverableTokenError({eresult: 65}), false);
  assert.equal(isRecoverableTokenError({eresult: 85}), false);
  assert.equal(isRecoverableTokenError({statusCode: 401, message: "inventory unauthorized"}), true);
  assert.equal(isRecoverableTokenError(new Error("库存 API 返回 403")), true);
  assert.equal(isRecoverableTokenError({code: "ETIMEDOUT", message: "connect timeout"}), false);
});

test("recovers a missing token from stored credentials and Guard before running the operation", async () => {
  const calls = [];
  const tokenStore = createMemoryTokenStore();
  const service = createTokenRecoveryService({
    tokenStore,
    accountCredentialsProvider: async () => ({
      username: "countsteam01",
      password: "SecretA",
      mafile_content: JSON.stringify(COMPLETE_MAFILE)
    }),
    generateGuardCode(sharedSecret) {
      assert.equal(sharedSecret, COMPLETE_MAFILE.shared_secret);
      return "ABCDE";
    },
    async loginWithCredentials(args) {
      calls.push({type: "login", args});
      return {refreshToken: "new_refresh_token"};
    },
    async invalidateSessions(username) {
      calls.push({type: "invalidate", username});
    }
  });

  const result = await service.withTokenRecovery("countsteam01", async (refreshToken) => {
    calls.push({type: "operation", refreshToken});
    return "ok";
  });

  assert.equal(result, "ok");
  assert.equal(tokenStore.get("countsteam01"), "new_refresh_token");
  assert.deepEqual(calls, [
    {type: "invalidate", username: "countsteam01"},
    {
      type: "login",
      args: {
        username: "countsteam01",
        password: "SecretA",
        guardCode: "ABCDE",
        persistToken: false
      }
    },
    {type: "operation", refreshToken: "new_refresh_token"}
  ]);
});

test("recovers an explicitly invalid token and retries the operation once", async () => {
  const tokenStore = createMemoryTokenStore("expired_refresh_token");
  let loginCalls = 0;
  const operationTokens = [];
  const service = createTokenRecoveryService({
    tokenStore,
    accountCredentialsProvider: async () => ({
      username: "countsteam01",
      password: "SecretA",
      mafile_content: COMPLETE_MAFILE
    }),
    generateGuardCode: () => "ABCDE",
    async loginWithCredentials() {
      loginCalls += 1;
      return {refresh_token: "replacement_refresh_token"};
    }
  });

  const result = await service.withTokenRecovery("countsteam01", async (refreshToken) => {
    operationTokens.push(refreshToken);
    if (refreshToken === "expired_refresh_token") {
      const err = new Error("refresh token rejected");
      err.code = "login_key_invalid";
      throw err;
    }
    return "retried_ok";
  });

  assert.equal(result, "retried_ok");
  assert.equal(loginCalls, 1);
  assert.deepEqual(operationTokens, ["expired_refresh_token", "replacement_refresh_token"]);
});

test("EResult 15 clears stale session and token before one automatic Guard recovery", async () => {
  const calls = [];
  let token = "stale_refresh_token";
  const service = createTokenRecoveryService({
    tokenStore: {
      get() {
        return token;
      },
      remove(username) {
        calls.push({type: "remove_token", username});
        token = "";
      },
      set(username, nextToken) {
        calls.push({type: "set_token", username, token: nextToken});
        token = nextToken;
      }
    },
    accountCredentialsProvider: async () => ({
      username: "countsteam01",
      password: "SecretA",
      mafile_content: COMPLETE_MAFILE
    }),
    generateGuardCode: () => "ABCDE",
    async invalidateSessions(username) {
      calls.push({type: "invalidate", username});
    },
    async loginWithCredentials(args) {
      calls.push({type: "login", args});
      return {refreshToken: "replacement_refresh_token"};
    }
  });

  const result = await service.withTokenRecovery("countsteam01", async (refreshToken) => {
    calls.push({type: "operation", refreshToken});
    if (refreshToken === "stale_refresh_token") {
      const error = new Error("AccessDenied");
      error.eresult = 15;
      throw error;
    }
    return "recovered";
  });

  assert.equal(result, "recovered");
  assert.equal(token, "replacement_refresh_token");
  assert.deepEqual(calls, [
    {type: "operation", refreshToken: "stale_refresh_token"},
    {type: "invalidate", username: "countsteam01"},
    {type: "remove_token", username: "countsteam01"},
    {
      type: "login",
      args: {
        username: "countsteam01",
        password: "SecretA",
        guardCode: "ABCDE",
        persistToken: false
      }
    },
    {type: "set_token", username: "countsteam01", token: "replacement_refresh_token"},
    {type: "operation", refreshToken: "replacement_refresh_token"}
  ]);
});

test("shares one recovery login across concurrent consumers of the same account", async () => {
  const tokenStore = createMemoryTokenStore("expired_refresh_token");
  const loginGate = createDeferred();
  let loginCalls = 0;
  const service = createTokenRecoveryService({
    tokenStore,
    accountCredentialsProvider: async () => ({
      username: "countsteam01",
      password: "SecretA",
      mafile_content: COMPLETE_MAFILE
    }),
    generateGuardCode: () => "ABCDE",
    async loginWithCredentials() {
      loginCalls += 1;
      return loginGate.promise;
    }
  });

  const operation = async (refreshToken) => {
    if (refreshToken === "expired_refresh_token") {
      const err = new Error("token expired");
      err.code = "login_key_invalid";
      throw err;
    }
    return refreshToken;
  };
  const first = service.withTokenRecovery("countsteam01", operation);
  const second = service.withTokenRecovery("countsteam01", operation);

  await new Promise((resolve) => setImmediate(resolve));
  const callsBeforeRelease = loginCalls;
  loginGate.resolve({refreshToken: "shared_replacement_token"});
  const results = await Promise.all([first, second]);

  assert.equal(callsBeforeRelease, 1);
  assert.equal(loginCalls, 1);
  assert.deepEqual(results, ["shared_replacement_token", "shared_replacement_token"]);
});

test("returns needs_attention when Steam requires additional manual verification", async () => {
  const tokenStore = createMemoryTokenStore();
  const service = createTokenRecoveryService({
    tokenStore,
    accountCredentialsProvider: async () => ({
      username: "countsteam01",
      password: "SecretA",
      mafile_content: COMPLETE_MAFILE
    }),
    generateGuardCode: () => "ABCDE",
    async loginWithCredentials() {
      const err = new Error("email code required");
      err.code = "RequiresEmailAuth";
      err.guard_type = "email_code";
      throw err;
    }
  });

  await assert.rejects(
    () => service.withTokenRecovery("countsteam01", async () => "not reached"),
    (err) => {
      assert.equal(err && err.code, "token_recovery_needs_attention");
      assert.equal(err && err.reason, "manual_verification_required");
      assert.equal(err && err.auth_state, "needs_attention");
      return true;
    }
  );
});

test("returns needs_attention when stored credentials are rejected", async () => {
  const cleared = [];
  const service = createTokenRecoveryService({
    tokenStore: createMemoryTokenStore(),
    accountCredentialsProvider: async () => ({
      username: "countsteam01",
      password: "WrongPassword",
      mafile_content: COMPLETE_MAFILE
    }),
    generateGuardCode: () => "ABCDE",
    async loginWithCredentials() {
      const err = new Error("InvalidPassword");
      err.code = "InvalidPassword";
      throw err;
    },
    async clearStoredPassword(username) {
      cleared.push(username);
    }
  });

  await assert.rejects(
    () => service.recoverToken("countsteam01"),
    (err) => {
      assert.equal(err && err.code, "token_recovery_needs_attention");
      assert.equal(err && err.reason, "invalid_credentials");
      assert.equal(err && err.auth_state, "needs_attention");
      assert.equal(err && err.credential_state, "password_reentry_required");
      assert.equal(err && err.password_cleared, true);
      assert.doesNotMatch(err && err.message, /WrongPassword/);
      return true;
    }
  );
  assert.deepEqual(cleared, ["countsteam01"]);
});

test("does not request password re-entry when clearing the rejected password fails", async () => {
  const service = createTokenRecoveryService({
    tokenStore: createMemoryTokenStore(),
    accountCredentialsProvider: async () => ({
      username: "countsteam01",
      password: "WrongPassword",
      mafile_content: COMPLETE_MAFILE
    }),
    generateGuardCode: () => "ABCDE",
    async loginWithCredentials() {
      const err = new Error("InvalidPassword");
      err.code = "InvalidPassword";
      throw err;
    },
    async clearStoredPassword() {
      throw new Error("database unavailable");
    }
  });

  await assert.rejects(
    () => service.recoverToken("countsteam01"),
    (err) => {
      assert.equal(err && err.reason, "password_clear_failed");
      assert.equal(err && err.auth_state, "needs_attention");
      assert.equal(err && err.credential_state, undefined);
      assert.doesNotMatch(err && err.message, /database unavailable/);
      return true;
    }
  );
});

test("accounts without maFile return to manual login without attempting credential recovery", async () => {
  for (const scenario of [
    {initialToken: "", expectedReason: "login_key_missing", expectedAuthState: "login_required"},
    {initialToken: "expired-token", expectedReason: "login_key_invalid", expectedAuthState: "auth_invalid"}
  ]) {
    let loginCalls = 0;
    const service = createTokenRecoveryService({
      tokenStore: createMemoryTokenStore(scenario.initialToken),
      accountCredentialsProvider: async () => ({
        username: "manual-account",
        password: "SavedPassword",
        mafile_content: ""
      }),
      async loginWithCredentials() {
        loginCalls += 1;
        return {refreshToken: "must-not-be-created"};
      }
    });
    await assert.rejects(
      () => service.withTokenRecovery("manual-account", async (token) => {
        if (token) {
          const err = new Error("steam error: InvalidPassword");
          err.code = "InvalidPassword";
          throw err;
        }
        return "not reached";
      }),
      (err) => {
        assert.equal(err && err.reason, scenario.expectedReason);
        assert.equal(err && err.auth_state, scenario.expectedAuthState);
        assert.equal(err && err.relogin_required, true);
        return true;
      }
    );
    assert.equal(loginCalls, 0);
  }
});

test("EResult 15 returns existing accounts without maFile to manual relogin", async () => {
  const calls = [];
  let token = "stale_refresh_token";
  let loginCalls = 0;
  const service = createTokenRecoveryService({
    tokenStore: {
      get() {
        return token;
      },
      set(_username, nextToken) {
        token = nextToken;
      },
      remove(username) {
        calls.push({type: "remove_token", username});
        token = "";
      }
    },
    accountCredentialsProvider: async () => ({
      username: "manual-account",
      password: "SavedPassword",
      mafile_content: ""
    }),
    async invalidateSessions(username) {
      calls.push({type: "invalidate", username});
    },
    async loginWithCredentials() {
      loginCalls += 1;
      return {refreshToken: "must-not-be-created"};
    }
  });

  await assert.rejects(
    () => service.withTokenRecovery("manual-account", async () => {
      const error = new Error("AccessDenied");
      error.eresult = 15;
      throw error;
    }),
    (err) => {
      assert.equal(err && err.reason, "login_key_invalid");
      assert.equal(err && err.auth_state, "auth_invalid");
      assert.equal(err && err.relogin_required, true);
      return true;
    }
  );
  assert.equal(token, "");
  assert.deepEqual(calls, [
    {type: "invalidate", username: "manual-account"},
    {type: "remove_token", username: "manual-account"}
  ]);
  assert.equal(loginCalls, 0);
});

test("credential-login EResult 15 clears the saved password and prevents another automatic login", async () => {
  const credentials = {
    username: "guard-account",
    password: "SavedPassword",
    mafile_content: COMPLETE_MAFILE
  };
  let loginCalls = 0;
  let clearPasswordCalls = 0;
  const service = createTokenRecoveryService({
    tokenStore: createMemoryTokenStore("stale_refresh_token"),
    accountCredentialsProvider: async () => ({...credentials}),
    generateGuardCode: () => "ABCDE",
    async loginWithCredentials() {
      loginCalls += 1;
      const err = new Error("AccessDenied");
      err.eresult = 15;
      throw err;
    },
    async clearStoredPassword() {
      clearPasswordCalls += 1;
      credentials.password = "";
      return true;
    }
  });

  await assert.rejects(
    () => service.recoverToken("guard-account"),
    (err) => {
      assert.equal(err && err.reason, "login_key_invalid");
      assert.equal(err && err.auth_state, "auth_invalid");
      assert.equal(err && err.relogin_required, true);
      assert.equal(err && err.credential_state, "password_reentry_required");
      assert.equal(err && err.password_cleared, true);
      return true;
    }
  );
  await assert.rejects(
    () => service.recoverToken("guard-account"),
    (err) => {
      assert.equal(err && err.reason, "password_missing");
      assert.equal(err && err.credential_state, "password_reentry_required");
      assert.equal(err && err.relogin_required, true);
      return true;
    }
  );
  assert.equal(loginCalls, 1);
  assert.equal(clearPasswordCalls, 1);
});

test("credential-login Steam results remain distinct from refresh-token expiry", async () => {
  const scenarios = [
    {eresult: 63, reason: "account_logon_denied", message: /额外验证/},
    {eresult: 65, reason: "invalid_login_auth_code", message: /令牌码无效/},
    {eresult: 85, reason: "two_factor_required", message: /两步验证/}
  ];
  for (const scenario of scenarios) {
    const service = createTokenRecoveryService({
      tokenStore: createMemoryTokenStore(),
      accountCredentialsProvider: async () => ({
        username: "guard-account",
        password: "SavedPassword",
        mafile_content: COMPLETE_MAFILE
      }),
      generateGuardCode: () => "ABCDE",
      async loginWithCredentials() {
        const err = new Error(`Steam result ${scenario.eresult}`);
        err.eresult = scenario.eresult;
        throw err;
      }
    });
    await assert.rejects(
      () => service.recoverToken("guard-account"),
      (err) => {
        assert.equal(err && err.code, scenario.errorCode || "token_recovery_needs_attention");
        assert.equal(err && err.reason, scenario.reason);
        assert.equal(err && err.auth_state, scenario.authState || "needs_attention");
        assert.match(err && err.message, scenario.message);
        return true;
      }
    );
  }
});

test("reuses a token refreshed by another consumer before starting a second login", async () => {
  const tokenStore = createMemoryTokenStore("expired_refresh_token");
  const delayedFailure = createDeferred();
  let loginCalls = 0;
  let delayedOldTokenCalls = 0;
  const service = createTokenRecoveryService({
    tokenStore,
    accountCredentialsProvider: async () => ({
      username: "countsteam01",
      password: "SecretA",
      mafile_content: COMPLETE_MAFILE
    }),
    generateGuardCode: () => "ABCDE",
    async loginWithCredentials() {
      loginCalls += 1;
      return {refreshToken: "replacement_refresh_token"};
    }
  });

  const immediateConsumer = service.withTokenRecovery("countsteam01", async (refreshToken) => {
    if (refreshToken === "expired_refresh_token") {
      const err = new Error("token expired");
      err.code = "login_key_invalid";
      throw err;
    }
    return refreshToken;
  });
  const delayedConsumer = service.withTokenRecovery("countsteam01", async (refreshToken) => {
    if (refreshToken === "expired_refresh_token") {
      delayedOldTokenCalls += 1;
      await delayedFailure.promise;
      const err = new Error("token expired");
      err.code = "login_key_invalid";
      throw err;
    }
    return refreshToken;
  });

  assert.equal(await immediateConsumer, "replacement_refresh_token");
  delayedFailure.resolve();
  assert.equal(await delayedConsumer, "replacement_refresh_token");
  assert.equal(delayedOldTokenCalls, 1);
  assert.equal(loginCalls, 1);
});

test("does not recover when the business operation fails with a network error", async () => {
  let credentialReads = 0;
  let loginCalls = 0;
  const networkError = new Error("connect ETIMEDOUT");
  networkError.code = "ETIMEDOUT";
  const service = createTokenRecoveryService({
    tokenStore: createMemoryTokenStore("current_refresh_token"),
    accountCredentialsProvider: async () => {
      credentialReads += 1;
      return null;
    },
    async loginWithCredentials() {
      loginCalls += 1;
      return {refreshToken: "should_not_exist"};
    }
  });

  await assert.rejects(
    () => service.withTokenRecovery("countsteam01", async () => {
      throw networkError;
    }),
    (err) => err === networkError
  );
  assert.equal(credentialReads, 0);
  assert.equal(loginCalls, 0);
});

test("returns needs_attention without recursive recovery when the one allowed retry also rejects the token", async () => {
  let loginCalls = 0;
  let operationCalls = 0;
  const service = createTokenRecoveryService({
    tokenStore: createMemoryTokenStore("expired_refresh_token"),
    accountCredentialsProvider: async () => ({
      username: "countsteam01",
      password: "SecretA",
      mafile_content: COMPLETE_MAFILE
    }),
    generateGuardCode: () => "ABCDE",
    async loginWithCredentials() {
      loginCalls += 1;
      return {refreshToken: "replacement_refresh_token"};
    }
  });

  await assert.rejects(
    () => service.withTokenRecovery("countsteam01", async () => {
      operationCalls += 1;
      const err = new Error("token rejected");
      err.code = "login_key_invalid";
      throw err;
    }),
    (err) => {
      assert.equal(err && err.code, "token_recovery_needs_attention");
      assert.equal(err && err.reason, "refresh_token_rejected_after_recovery");
      assert.equal(err && err.auth_state, "needs_attention");
      return true;
    }
  );
  assert.equal(operationCalls, 2);
  assert.equal(loginCalls, 1);
});

test("does not announce recovery success when TokenStore persistence fails", async () => {
  let invalidateCalls = 0;
  let operationCalls = 0;
  const service = createTokenRecoveryService({
    tokenStore: {
      get() {
        return "";
      },
      set() {
        throw new Error("disk full");
      }
    },
    accountCredentialsProvider: async () => ({
      username: "countsteam01",
      password: "SecretA",
      mafile_content: COMPLETE_MAFILE
    }),
    generateGuardCode: () => "ABCDE",
    async loginWithCredentials() {
      return {refreshToken: "unpersisted_refresh_token"};
    },
    async invalidateSessions() {
      invalidateCalls += 1;
    }
  });

  await assert.rejects(
    () => service.withTokenRecovery("countsteam01", async () => {
      operationCalls += 1;
      return "not reached";
    }),
    (err) => {
      assert.equal(err && err.code, "token_recovery_needs_attention");
      assert.equal(err && err.reason, "token_store_write_failed");
      return true;
    }
  );
  assert.equal(invalidateCalls, 1);
  assert.equal(operationCalls, 0);
});

test("returns needs_attention without logging in when the saved password is missing", async () => {
  let loginCalls = 0;
  const service = createTokenRecoveryService({
    tokenStore: createMemoryTokenStore(),
    accountCredentialsProvider: async () => ({
      username: "countsteam01",
      password: "",
      mafile_content: COMPLETE_MAFILE
    }),
    async loginWithCredentials() {
      loginCalls += 1;
      return {refreshToken: "not reached"};
    }
  });

  await assert.rejects(
    () => service.recoverToken("countsteam01"),
    (err) => {
      assert.equal(err && err.auth_state, "needs_attention");
      assert.equal(err && err.reason, "password_missing");
      return true;
    }
  );
  assert.equal(loginCalls, 0);
});

test("returns needs_attention without logging in when local Guard data is incomplete", async () => {
  let loginCalls = 0;
  const service = createTokenRecoveryService({
    tokenStore: createMemoryTokenStore(),
    accountCredentialsProvider: async () => ({
      username: "countsteam01",
      password: "SecretA",
      mafile_content: JSON.stringify({
        shared_secret: COMPLETE_MAFILE.shared_secret
      })
    }),
    async loginWithCredentials() {
      loginCalls += 1;
      return {refreshToken: "not reached"};
    }
  });

  await assert.rejects(
    () => service.recoverToken("countsteam01"),
    (err) => {
      assert.equal(err && err.auth_state, "needs_attention");
      assert.equal(err && err.reason, "steam_guard_incomplete");
      return true;
    }
  );
  assert.equal(loginCalls, 0);
});

test("supports an extensible password-reentry classifier without guessing future Steam codes", async () => {
  const service = createTokenRecoveryService({
    tokenStore: createMemoryTokenStore(),
    accountCredentialsProvider: async () => ({
      username: "countsteam01",
      password: "SecretA",
      mafile_content: JSON.stringify(COMPLETE_MAFILE)
    }),
    generateGuardCode: () => "ABCDE",
    loginWithCredentials: async () => {
      const error = new Error("future Steam credential rejection");
      error.eresult = 99999;
      throw error;
    },
    passwordReentryRequiredClassifier: (err) => Number(err && err.eresult) === 99999
  });

  await assert.rejects(
    service.recoverToken("countsteam01"),
    (err) => (
      err &&
      err.reason === "invalid_credentials" &&
      err.credential_state === "password_reentry_required" &&
      !String(err.message || "").includes("99999")
    )
  );
});
