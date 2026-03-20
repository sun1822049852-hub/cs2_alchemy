const fs = require("node:fs");
const path = require("node:path");

const {nowStamp, asString} = require("../node_sidecar/src/utils");
const {createSteamdtBaseInfoProvider} = require("../node_sidecar/src/services/steamdtBaseInfoProvider");
const {runRebuildSkinDb, printStats} = require("./rebuildSkinDb");

const DEFAULT_STEAMDT_API_KEY = "54bb6f99" + "48a1476db7bf91bb62f10481";

function buildCliOptions(argv = []) {
  const args = Array.isArray(argv) ? [...argv] : [];
  const rootDir = path.resolve(__dirname, "..");
  const options = {
    dbPath: path.join(rootDir, "csgo_skins.db"),
    jsonPath: path.join(rootDir, "data", `steam_base_info_${nowStamp()}.json`)
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = asString(args[i]).trim();
    const next = asString(args[i + 1]).trim();
    if (arg === "--json" && next) {
      options.jsonPath = next;
      i += 1;
      continue;
    }
    if (arg === "--db" && next) {
      options.dbPath = next;
      i += 1;
    }
  }
  return options;
}

function saveBaseInfoJson(items, jsonPath) {
  const targetPath = path.resolve(asString(jsonPath).trim());
  fs.mkdirSync(path.dirname(targetPath), {recursive: true});
  fs.writeFileSync(targetPath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  return targetPath;
}

async function fetchAndRebuildSkinDb({
  dbPath,
  jsonPath,
  baseInfoProvider = createSteamdtBaseInfoProvider({apiKey: DEFAULT_STEAMDT_API_KEY}),
  runRebuild = runRebuildSkinDb
} = {}) {
  const items = await baseInfoProvider.fetchBaseInfo();
  if (!Array.isArray(items)) {
    throw new Error("steamdt base info result must be an array");
  }
  const savedJsonPath = saveBaseInfoJson(items, jsonPath);
  const rebuildResult = await runRebuild({
    dbPath,
    jsonPath: savedJsonPath
  });
  return {
    savedJsonPath,
    fetchCount: items.length,
    rebuildStats: rebuildResult && rebuildResult.stats ? rebuildResult.stats : rebuildResult
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = buildCliOptions(argv);
  const result = await fetchAndRebuildSkinDb(options);
  console.log(`基础信息条数: ${Number(result.fetchCount || 0)}`);
  console.log(`基础信息JSON: ${result.savedJsonPath}`);
  if (result.rebuildStats && typeof result.rebuildStats === "object") {
    printStats(result.rebuildStats);
  }
  return result;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  buildCliOptions,
  saveBaseInfoJson,
  fetchAndRebuildSkinDb,
  main
};
