const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {attachGcTrace} = require("../src/cs2Session");
const {
  buildGcCaptureOutputPath,
  captureGcSession
} = require("../src/gcSessionCaptureWorkflow");

function createLoggerSink() {
  const lines = [];
  return {
    lines,
    info(scope, text) {
      lines.push(`INFO ${scope} ${text}`);
    },
    warn(scope, text) {
      lines.push(`WARN ${scope} ${text}`);
    },
    error(scope, text) {
      lines.push(`ERROR ${scope} ${text}`);
    }
  };
}

function createFakeSteam() {
  const steam = new EventEmitter();
  steam.sendToGC = function sendToGC() {};
  return steam;
}

function test_build_gc_capture_output_path_uses_tmp_jsonl_convention() {
  const outputPath = buildGcCaptureOutputPath({
    accountName: "x883830262",
    baseDir: "C:\\repo\\node_sidecar",
    stamp: "20260411_123456"
  });

  assert.equal(
    outputPath,
    path.resolve("C:\\repo\\node_sidecar", "tmp", "gc-session-20260411_123456-x883830262.jsonl")
  );
}

async function test_capture_gc_session_writes_full_raw_entries_to_jsonl() {
  const logger = createLoggerSink();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-session-capture-"));
  const steam = createFakeSteam();
  let disconnected = false;

  class FakeSession {
    constructor() {
      this.steam = null;
    }

    async connect({username, gcTrace}) {
      attachGcTrace({
        steam,
        logger,
        accountName: username,
        enabled: Boolean(gcTrace && gcTrace.enabled),
        onMessage: gcTrace && gcTrace.onMessage
      });
      this.steam = steam;
      return {steam, csgo: {}};
    }

    disconnect() {
      disconnected = true;
    }
  }

  const result = await captureGcSession({
    accountName: "x883830262",
    durationMs: 0,
    ackTracks: false,
    outputDir: tempDir,
    logger,
    accountStore: {
      get(username) {
        return {username, password: "pw"};
      }
    },
    tokenStore: {
      get() {
        return "refresh-token";
      }
    },
    SessionClass: FakeSession,
    probeFn: async ({steam: activeSteam}) => {
      activeSteam.emit("receivedFromGC", 730, 65535, Buffer.from("deadbeefcafebabe", "hex"));
      activeSteam.emit("receivedFromGC", 730, 9173, Buffer.from("0801", "hex"));
      return {ok: true};
    }
  });

  const rawLines = fs.readFileSync(result.output_path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const unknownEntry = rawLines.find((entry) => entry.msg_type === 65535);

  assert.equal(result.account, "x883830262");
  assert.equal(result.messages_written, rawLines.length);
  assert.equal(disconnected, true);
  assert.ok(unknownEntry, `expected unknown GC entry in capture, got:\n${JSON.stringify(rawLines, null, 2)}`);
  assert.equal(unknownEntry.account, "x883830262");
  assert.equal(unknownEntry.payload_hex, "deadbeefcafebabe");
  assert.equal(unknownEntry.raw_payload_base64, Buffer.from("deadbeefcafebabe", "hex").toString("base64"));
}

async function main() {
  test_build_gc_capture_output_path_uses_tmp_jsonl_convention();
  await test_capture_gc_session_writes_full_raw_entries_to_jsonl();
  console.log("gc-session-capture tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
