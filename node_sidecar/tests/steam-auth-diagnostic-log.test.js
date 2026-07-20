const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  appendSteamAuthDiagnostic,
  buildSteamAuthDiagnosticRecord
} = require("../src/steamAuthDiagnosticLog");

test("writes a sanitized Steam auth diagnostic with embedded code=15", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "steam-auth-diagnostic-"));
  const logPath = path.join(tempDir, "diagnostics.jsonl");
  const error = new Error("steam error: AccessDenied code=15 password=must-not-leak");
  error.password = "must-not-leak";
  error.refresh_token = "must-not-leak-token";
  error.mafile_content = "must-not-leak-mafile";

  const writtenPath = appendSteamAuthDiagnostic({
    stage: "refresh_connect",
    username: "countsteam02",
    reason: "login_key_invalid",
    authState: "auth_invalid",
    error,
    hasSteamGuard: false,
    tokenCleared: true,
    recoveryMode: "manual_login"
  }, {
    logPath,
    now: () => Date.parse("2026-07-18T14:00:00.000Z")
  });

  assert.equal(writtenPath, logPath);
  const line = fs.readFileSync(logPath, "utf8").trim();
  const record = JSON.parse(line);
  assert.deepEqual(record, {
    timestamp: "2026-07-18T14:00:00.000Z",
    stage: "refresh_connect",
    account_ref: record.account_ref,
    reason: "login_key_invalid",
    auth_state: "auth_invalid",
    eresult: null,
    code: 15,
    error_name: "Error",
    has_steam_guard: false,
    token_cleared: true,
    recovery_mode: "manual_login"
  });
  assert.match(record.account_ref, /^[a-f0-9]{16}$/);
  assert.doesNotMatch(
    line,
    /countsteam02|must-not-leak|refresh_token|mafile|password|shared_secret|steam error/i
  );

  fs.rmSync(tempDir, {recursive: true, force: true});
});

test("extracts structured eresult separately and ignores unknown input fields", () => {
  const error = new Error("must-not-be-persisted");
  error.eresult = 15;
  const record = buildSteamAuthDiagnosticRecord({
    stage: "credential_login",
    username: "sensitive-account-name",
    reason: "login_key_invalid",
    error,
    password: "must-not-leak",
    access_token: "must-not-leak"
  }, {
    now: () => Date.parse("2026-07-18T14:01:00.000Z")
  });

  assert.equal(record.eresult, 15);
  assert.equal(record.code, null);
  assert.equal(Object.hasOwn(record, "password"), false);
  assert.equal(Object.hasOwn(record, "access_token"), false);
  assert.equal(JSON.stringify(record).includes("sensitive-account-name"), false);
  assert.equal(JSON.stringify(record).includes("must-not"), false);
});
