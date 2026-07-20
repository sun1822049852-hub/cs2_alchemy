const assert = require("node:assert/strict");

const {DedupLogger} = require("../src/logger");

function captureConsole(run) {
  const originalLog = console.log;
  const originalError = console.error;
  const calls = {log: [], error: []};
  console.log = (...args) => calls.log.push(args.join(" "));
  console.error = (...args) => calls.error.push(args.join(" "));
  try {
    run(calls);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return calls;
}

function test_deduped_console_event_is_written_to_sink_once() {
  const records = [];
  const logger = new DedupLogger({
    windowMs: 5000,
    fileSink: {write: (record) => records.push(record)}
  });

  const calls = captureConsole(() => {
    logger.info("auth", "code=15");
    logger.info("auth", "code=15");
  });

  assert.equal(calls.log.length, 1);
  assert.equal(calls.error.length, 0);
  assert.match(calls.log[0], / auth INFO code=15$/);
  assert.deepEqual(records, [{level: "INFO", scope: "auth", message: "code=15"}]);
}

function test_warn_and_error_keep_using_console_error() {
  const records = [];
  const logger = new DedupLogger({
    windowMs: 0,
    fileSink: {write: (record) => records.push(record)}
  });

  const calls = captureConsole(() => {
    logger.warn("network", "warn text");
    logger.error("network", "error text");
  });

  assert.equal(calls.log.length, 0);
  assert.equal(calls.error.length, 2);
  assert.deepEqual(records.map((record) => record.level), ["WARN", "ERROR"]);
}

function test_forced_log_still_bypasses_deduplication() {
  const records = [];
  const logger = new DedupLogger({
    windowMs: 5000,
    fileSink: {write: (record) => records.push(record)}
  });

  const calls = captureConsole(() => {
    logger.infoAlways("flow", "same");
    logger.infoAlways("flow", "same");
  });

  assert.equal(calls.log.length, 2);
  assert.equal(records.length, 2);
}

function test_sink_failure_never_changes_console_behavior() {
  const logger = new DedupLogger({
    windowMs: 0,
    fileSink: {write: () => { throw new Error("disk unavailable"); }}
  });

  const calls = captureConsole(() => {
    assert.doesNotThrow(() => logger.info("runtime", "continues"));
  });

  assert.equal(calls.log.length, 1);
  assert.match(calls.log[0], / runtime INFO continues$/);
}

function main() {
  test_deduped_console_event_is_written_to_sink_once();
  test_warn_and_error_keep_using_console_error();
  test_forced_log_still_bypasses_deduplication();
  test_sink_failure_never_changes_console_behavior();
  console.log("logger tests passed");
}

main();
