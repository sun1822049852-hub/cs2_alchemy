const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  DevFileLogSink,
  isDevFileLogEnabled,
  localDateKey,
  redactSensitiveText
} = require("../src/devFileLog");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cs2-dev-file-log-"));
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function test_switch_is_enabled_only_by_exact_one() {
  assert.equal(isDevFileLogEnabled({CS2_DEV_FILE_LOG: "1"}), true);
  assert.equal(isDevFileLogEnabled({CS2_DEV_FILE_LOG: "true"}), false);
  assert.equal(isDevFileLogEnabled({CS2_DEV_FILE_LOG: "0"}), false);
  assert.equal(isDevFileLogEnabled({}), false);
}

function test_disabled_sink_does_not_create_files() {
  const tempDir = makeTempDir();
  const logDir = path.join(tempDir, "logs", "dev");
  const sink = new DevFileLogSink({env: {}, logDir});

  assert.equal(sink.write({level: "INFO", scope: "test", message: "hello"}), false);
  assert.equal(fs.existsSync(logDir), false);
}

function test_enabled_sink_writes_redacted_daily_jsonl_without_hiding_error_codes() {
  const tempDir = makeTempDir();
  const logDir = path.join(tempDir, "logs", "dev");
  const now = new Date(2026, 6, 18, 12, 34, 56, 789);
  const sink = new DevFileLogSink({
    env: {CS2_DEV_FILE_LOG: "1"},
    logDir,
    now: () => now,
    pid: 4321
  });
  const message = [
    "login failed",
    "password=hunter2",
    "access_token=access-secret",
    "refreshToken=refresh-secret",
    "Cookie: cookie-secret",
    "Authorization: Bearer bearer-secret",
    "shared_secret=shared-secret",
    "identitySecret=identity-secret",
    "revocation_code=R12345",
    "mafile_content=mafile-secret",
    "guard_code=ABCDE",
    "emailCode=99999",
    "code=15",
    "eresult=15"
  ].join(" ");

  assert.equal(sink.write({level: "ERROR", scope: "auth", message}), true);

  const filePath = path.join(logDir, `backend-${localDateKey(now)}.jsonl`);
  const [entry] = readJsonl(filePath);
  assert.equal(entry.pid, 4321);
  assert.equal(entry.level, "ERROR");
  assert.equal(entry.scope, "auth");
  assert.equal(entry.timestamp, now.toISOString());
  assert.match(entry.message, /code=15/);
  assert.match(entry.message, /eresult=15/);
  assert.match(entry.message, /\[REDACTED\]/);
  for (const secret of [
    "hunter2",
    "access-secret",
    "refresh-secret",
    "cookie-secret",
    "bearer-secret",
    "shared-secret",
    "identity-secret",
    "R12345",
    "mafile-secret",
    "ABCDE",
    "99999"
  ]) {
    assert.equal(entry.message.includes(secret), false, `secret leaked: ${secret}`);
  }
}

function test_redaction_handles_json_style_fields() {
  const redacted = redactSensitiveText(
    '{"password":"secret-a","shared_secret":"secret-b","code":15,"eresult":15}'
  );

  assert.equal(redacted.includes("secret-a"), false);
  assert.equal(redacted.includes("secret-b"), false);
  assert.match(redacted, /"code":15/);
  assert.match(redacted, /"eresult":15/);
}

function test_cleanup_keeps_current_and_previous_two_local_dates_only() {
  const tempDir = makeTempDir();
  const logDir = path.join(tempDir, "logs", "dev");
  fs.mkdirSync(logDir, {recursive: true});
  for (const name of [
    "backend-2026-07-18.jsonl",
    "backend-2026-07-17.jsonl",
    "backend-2026-07-16.jsonl",
    "backend-2026-07-15.jsonl"
  ]) {
    fs.writeFileSync(path.join(logDir, name), "{}\n", "utf8");
  }
  fs.writeFileSync(path.join(logDir, "keep-me.txt"), "unrelated", "utf8");

  const sink = new DevFileLogSink({
    env: {CS2_DEV_FILE_LOG: "1"},
    logDir,
    now: () => new Date(2026, 6, 18, 10, 0, 0)
  });
  assert.equal(sink.write({level: "INFO", scope: "cleanup", message: "run"}), true);

  assert.equal(fs.existsSync(path.join(logDir, "backend-2026-07-18.jsonl")), true);
  assert.equal(fs.existsSync(path.join(logDir, "backend-2026-07-17.jsonl")), true);
  assert.equal(fs.existsSync(path.join(logDir, "backend-2026-07-16.jsonl")), true);
  assert.equal(fs.existsSync(path.join(logDir, "backend-2026-07-15.jsonl")), false);
  assert.equal(fs.existsSync(path.join(logDir, "keep-me.txt")), true);
}

function test_day_rollover_uses_new_file_and_repeats_cleanup() {
  const tempDir = makeTempDir();
  const logDir = path.join(tempDir, "logs", "dev");
  let current = new Date(2026, 6, 18, 23, 59, 59);
  const sink = new DevFileLogSink({
    env: {CS2_DEV_FILE_LOG: "1"},
    logDir,
    now: () => current
  });

  assert.equal(sink.write({level: "INFO", scope: "rollover", message: "day one"}), true);
  fs.writeFileSync(path.join(logDir, "backend-2026-07-16.jsonl"), "{}\n", "utf8");
  current = new Date(2026, 6, 19, 0, 0, 1);
  assert.equal(sink.write({level: "INFO", scope: "rollover", message: "day two"}), true);

  assert.equal(fs.existsSync(path.join(logDir, "backend-2026-07-19.jsonl")), true);
  assert.equal(fs.existsSync(path.join(logDir, "backend-2026-07-18.jsonl")), true);
  assert.equal(fs.existsSync(path.join(logDir, "backend-2026-07-16.jsonl")), false);
}

function test_write_failure_is_reported_without_throwing() {
  const errors = [];
  const sink = new DevFileLogSink({
    env: {CS2_DEV_FILE_LOG: "1"},
    logDir: "\0",
    onError: (error) => errors.push(error)
  });

  assert.doesNotThrow(() => {
    assert.equal(sink.write({level: "ERROR", scope: "test", message: "failure"}), false);
  });
  assert.equal(errors.length, 1);
}

function main() {
  test_switch_is_enabled_only_by_exact_one();
  test_disabled_sink_does_not_create_files();
  test_enabled_sink_writes_redacted_daily_jsonl_without_hiding_error_codes();
  test_redaction_handles_json_style_fields();
  test_cleanup_keeps_current_and_previous_two_local_dates_only();
  test_day_rollover_uses_new_file_and_repeats_cleanup();
  test_write_failure_is_reported_without_throwing();
  console.log("dev-file-log tests passed");
}

main();
