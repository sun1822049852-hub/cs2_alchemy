const path = require("node:path");

const {createBuffSkinDetailProvider} = require("../node_sidecar/src/services/buffSkinDetailProvider");
const {createSkinDetailEnrichmentService} = require("../node_sidecar/src/services/skinDetailEnrichmentService");
const {asString} = require("../node_sidecar/src/utils");
const {backupDbFile} = require("./rebuildSkinDb");

function parseInteger(value, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildCliOptions(argv = []) {
  const args = Array.isArray(argv) ? [...argv] : [];
  const rootDir = path.resolve(__dirname, "..");
  const options = {
    dbPath: path.join(rootDir, "csgo_skins.db"),
    delayMs: 3000,
    limitFamilies: 0,
    retryLimit: 0,
    retryDelayMs: 1500,
    backup: true
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = asString(args[index]).trim();
    const next = asString(args[index + 1]).trim();
    if (arg === "--db" && next) {
      options.dbPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--delay-ms" && next) {
      options.delayMs = Math.max(0, parseInteger(next, options.delayMs));
      index += 1;
      continue;
    }
    if (arg === "--limit" && next) {
      options.limitFamilies = Math.max(0, parseInteger(next, options.limitFamilies));
      index += 1;
      continue;
    }
    if (arg === "--retry-limit" && next) {
      options.retryLimit = Math.max(0, parseInteger(next, options.retryLimit));
      index += 1;
      continue;
    }
    if (arg === "--retry-delay-ms" && next) {
      options.retryDelayMs = Math.max(0, parseInteger(next, options.retryDelayMs));
      index += 1;
      continue;
    }
    if (arg === "--no-backup") {
      options.backup = false;
    }
  }
  return options;
}

function printImageFillStats(stats) {
  console.log("缺图补齐统计:");
  console.log(`  本轮待补图片行数: ${Number(stats && stats.image_rows_pending || 0)}`);
  console.log(`  本轮成功图片行数: ${Number(stats && stats.image_rows_ok || 0)}`);
  console.log(`  本轮失败图片行数: ${Number(stats && stats.image_rows_failed || 0)}`);
  console.log(`  当前仍缺失图片行数: ${Number(stats && stats.image_rows_still_missing || 0)}`);
}

async function fillMissingSkinImages({
  dbPath,
  delayMs = 3000,
  limitFamilies = 0,
  retryLimit = 3,
  retryDelayMs = 1500,
  backup = true,
  provider = null,
  logger = null
} = {}) {
  const imageProvider = provider || createBuffSkinDetailProvider({
    logger,
    retryLimit,
    retryDelayMs,
    imageRetryLimit: retryLimit,
    imageRetryDelayMs: retryDelayMs
  });
  const service = createSkinDetailEnrichmentService({
    dbPath,
    provider: imageProvider,
    logger,
    concurrency: 1,
    imageBaseDelayMs: delayMs,
    imageRateLimitBackoffMs: Math.max(1000, parseInteger(retryDelayMs, 1500)),
    imageRateLimitMaxDelayMs: Math.max(15000, parseInteger(delayMs, 3000)),
    imageDelayRelaxStepMs: Math.max(100, Math.trunc(parseInteger(delayMs, 3000) / 5)),
    imageDelayRelaxAfterSuccesses: 5
  });
  const backupPath = backup ? backupDbFile(dbPath) : "";
  const stats = await service.enrichMissingImages({
    delayMs,
    limitFamilies
  });
  return {
    backupPath,
    stats,
    options: {
      dbPath,
      delayMs,
      limitFamilies,
      retryLimit,
      retryDelayMs,
      backup
    }
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = buildCliOptions(argv);
  const result = await fillMissingSkinImages(options);
  if (result.backupPath) {
    console.log(`备份文件: ${result.backupPath}`);
  }
  printImageFillStats(result.stats);
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
  printImageFillStats,
  fillMissingSkinImages,
  main
};
