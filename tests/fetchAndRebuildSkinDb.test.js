const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  fetchAndRebuildSkinDb,
  buildCliOptions
} = require("../tools/fetchAndRebuildSkinDb");

async function test_fetch_and_rebuild_runs_in_order_and_persists_json() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-trilogy-"));
  const dbPath = path.join(tempDir, "skins.db");
  const jsonPath = path.join(tempDir, "steam_base_info_20260320_120000.json");
  const calls = [];

  const result = await fetchAndRebuildSkinDb({
    dbPath,
    jsonPath,
    baseInfoProvider: {
      async fetchBaseInfo() {
        calls.push("fetchBaseInfo");
        return [
          {name: "AK-47 | Redline (Field-Tested)", marketHashName: "AK-47 | Redline (Field-Tested)"}
        ];
      }
    },
    runRebuild: async (options) => {
      calls.push({
        type: "runRebuild",
        options
      });
      const saved = JSON.parse(fs.readFileSync(options.jsonPath, "utf8"));
      assert.equal(options.dbPath, dbPath);
      assert.deepEqual(saved, [
        {name: "AK-47 | Redline (Field-Tested)", marketHashName: "AK-47 | Redline (Field-Tested)"}
      ]);
      return {importedItems: saved.length};
    }
  });

  assert.deepEqual(calls, [
    "fetchBaseInfo",
    {
      type: "runRebuild",
      options: {
        dbPath,
        jsonPath
      }
    }
  ]);
  assert.equal(fs.existsSync(jsonPath), true);
  assert.equal(result.savedJsonPath, jsonPath);
  assert.equal(result.fetchCount, 1);
  assert.deepEqual(result.rebuildStats, {importedItems: 1});
}

function test_build_cli_options_defaults_to_repo_data_dir() {
  const options = buildCliOptions([]);
  assert.equal(path.basename(options.dbPath), "csgo_skins.db");
  assert.equal(path.basename(path.dirname(options.jsonPath)), "data");
  assert.equal(path.basename(options.jsonPath).startsWith("steam_base_info_"), true);
}

(async () => {
  await test_fetch_and_rebuild_runs_in_order_and_persists_json();
  test_build_cli_options_defaults_to_repo_data_dir();
  console.log("fetchAndRebuildSkinDb tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
