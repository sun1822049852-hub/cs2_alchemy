const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  listVpkEntries,
  readVpkEntry,
  extractVpkEntry,
  runVpkDevCommand
} = require("../src/vpkDevTools");

class FakeVPK {
  constructor(filePath) {
    this.filePath = filePath;
    this._files = [
      "panorama/layout/xpshop.vxml_c",
      "panorama/scripts/xpshop.vts_c",
      "panorama/images/backgrounds/xpshop/set_train_2025_thumbnail_png.vtex_c",
      "panorama/layout/mainmenu_play.vxml_c"
    ];
    this._buffers = new Map([
      ["panorama/layout/xpshop.vxml_c", Buffer.from("<layout>xpshop</layout>", "utf8")],
      ["panorama/scripts/xpshop.vts_c", Buffer.from("console.log('xpshop');", "utf8")]
    ]);
  }

  isValid() {
    return this.filePath.endsWith(".vpk");
  }

  load() {}

  get files() {
    return this._files.slice();
  }

  getFile(entryPath) {
    return this._buffers.get(entryPath) || null;
  }
}

function createWritableCollector() {
  const chunks = [];
  return {
    stream: {
      write(chunk) {
        chunks.push(String(chunk));
      }
    },
    read() {
      return chunks.join("");
    }
  };
}

function test_list_vpk_entries_filters_and_limits_matches() {
  const entries = listVpkEntries("pak01_dir.vpk", {
    pattern: "xpshop",
    limit: 2,
    VPKClass: FakeVPK
  });

  assert.deepEqual(entries, [
    "panorama/images/backgrounds/xpshop/set_train_2025_thumbnail_png.vtex_c",
    "panorama/layout/xpshop.vxml_c"
  ]);
}

function test_read_vpk_entry_supports_text_and_hex() {
  assert.equal(
    readVpkEntry("pak01_dir.vpk", "panorama/layout/xpshop.vxml_c", {
      encoding: "utf8",
      VPKClass: FakeVPK
    }),
    "<layout>xpshop</layout>"
  );

  assert.equal(
    readVpkEntry("pak01_dir.vpk", "panorama/layout/xpshop.vxml_c", {
      encoding: "hex",
      VPKClass: FakeVPK
    }),
    Buffer.from("<layout>xpshop</layout>", "utf8").toString("hex")
  );
}

function test_extract_vpk_entry_writes_file_and_returns_metadata() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vpk-dev-tools-"));
  const outputPath = path.join(tempDir, "nested", "xpshop.vxml_c");

  const result = extractVpkEntry("pak01_dir.vpk", "panorama/layout/xpshop.vxml_c", outputPath, {
    VPKClass: FakeVPK
  });

  assert.equal(result.output_path, outputPath);
  assert.equal(result.bytes, Buffer.byteLength("<layout>xpshop</layout>"));
  assert.equal(fs.readFileSync(outputPath, "utf8"), "<layout>xpshop</layout>");
}

function test_run_vpk_dev_command_lists_matches_to_stdout() {
  const stdout = createWritableCollector();
  const stderr = createWritableCollector();

  const exitCode = runVpkDevCommand([
    "list",
    "--file",
    "pak01_dir.vpk",
    "--pattern",
    "xpshop",
    "--limit",
    "1"
  ], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    VPKClass: FakeVPK
  });

  assert.equal(exitCode, 0);
  assert.match(stdout.read(), /panorama\/images\/backgrounds\/xpshop\/set_train_2025_thumbnail_png\.vtex_c/);
  assert.equal(stderr.read(), "");
}

function main() {
  test_list_vpk_entries_filters_and_limits_matches();
  test_read_vpk_entry_supports_text_and_hex();
  test_extract_vpk_entry_writes_file_and_returns_metadata();
  test_run_vpk_dev_command_lists_matches_to_stdout();
  console.log("vpk-dev-tools tests passed");
}

main();
