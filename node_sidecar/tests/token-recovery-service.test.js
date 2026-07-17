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
    {
      type: "login",
      args: {
        username: "countsteam01",
        password: "SecretA",
        guardCode: "ABCDE",
        persistToken: false
      }
    },
    {type: "invalidate", username: "countsteam01"},
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
    }
  });

  await assert.rejects(
    () => service.recoverToken("countsteam01"),
    (err) => {
      assert.equal(err && err.code, "token_recovery_needs_attention");
      assert.equal(err && err.reason, "invalid_credentials");
      assert.equal(err && err.auth_state, "needs_attention");
      assert.doesNotMatch(err && err.message, /WrongPassword/);
      return true;
    }
  );
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
  assert.equal(invalidateCalls, 0);
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
