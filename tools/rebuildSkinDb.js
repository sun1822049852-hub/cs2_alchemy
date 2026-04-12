const fs = require("node:fs");
const path = require("node:path");
const {createSteamFirstSkinDetailProvider} = require("../node_sidecar/src/services/steamFirstSkinDetailProvider");
const {
  buildCliOptions,
  loadItemsFromJson,
  syncSkinDb
} = require("../node_sidecar/src/skinDbSync");

function pad2(value) {
  return String(value).padStart(2, "0");
}

function nowStamp() {
  const d = new Date();
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

function backupDbFile(dbPath) {
  if (!fs.existsSync(dbPath)) {
    return "";
  }
  const parsed = path.parse(dbPath);
  const backupPath = path.join(parsed.dir, `${parsed.name}.backup_before_rebuild_${nowStamp()}${parsed.ext}`);
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function printStats(stats) {
  console.log(`JSON 总记录数: ${Number(stats.totalItems || 0)}`);
  console.log(`导入目标数: ${Number(stats.importedItems || 0)}`);
  console.log(`删除旧记录数: ${Number(stats.deleted || 0)}`);
  console.log(`缺少收藏品/品质数: ${Number(stats.missingCollectionOrRarity || 0)}`);
  console.log("详情补齐统计:");
  console.log(`  待补 family: ${Number(stats.detailStats && stats.detailStats.families_pending || 0)}`);
  console.log(`  补齐成功 family: ${Number(stats.detailStats && stats.detailStats.families_ok || 0)}`);
  console.log(`  补齐失败 family: ${Number(stats.detailStats && stats.detailStats.families_failed || 0)}`);
  console.log(`  补齐行数: ${Number(stats.detailStats && stats.detailStats.rows_filled || 0)}`);
  console.log(`  仍缺失行数: ${Number(stats.detailStats && stats.detailStats.rows_still_missing || 0)}`);
  console.log(`  无可用平台ID行数: ${Number(stats.detailStats && stats.detailStats.rows_no_supported_platform || 0)}`);
  console.log("磨损区间补齐统计:");
  console.log(`  待补磨损行数: ${Number(stats.detailStats && stats.detailStats.wear_rows_pending || 0)}`);
  console.log(`  磨损补齐成功行数: ${Number(stats.detailStats && stats.detailStats.wear_rows_ok || 0)}`);
  console.log(`  磨损补齐失败行数: ${Number(stats.detailStats && stats.detailStats.wear_rows_failed || 0)}`);
  console.log(`  仍缺失磨损行数: ${Number(stats.detailStats && stats.detailStats.wear_rows_still_missing || 0)}`);
  console.log("图片补齐统计:");
  console.log(`  待补图片行数: ${Number(stats.detailStats && stats.detailStats.image_rows_pending || 0)}`);
  console.log(`  图片补齐成功行数: ${Number(stats.detailStats && stats.detailStats.image_rows_ok || 0)}`);
  console.log(`  图片补齐失败行数: ${Number(stats.detailStats && stats.detailStats.image_rows_failed || 0)}`);
  console.log(`  仍缺失图片行数: ${Number(stats.detailStats && stats.detailStats.image_rows_still_missing || 0)}`);
  if (stats.detailStats && stats.detailStats.error) {
    console.log(`  补齐异常: ${stats.detailStats.error}`);
  }
  console.log("炼金类型分布:");
  for (const [key, value] of Object.entries(stats.alchemyStats || {})) {
    console.log(`  ${key}: ${Number(value || 0)}`);
  }
}

async function runRebuildSkinDb(options = {}) {
  const backupPath = backupDbFile(options.dbPath);
  const items = loadItemsFromJson(options.jsonPath);
  const stats = await syncSkinDb({
    dbPath: options.dbPath,
    items,
    detailProvider: createSteamFirstSkinDetailProvider(),
    detailConcurrency: 1
  });
  return {
    backupPath,
    stats,
    options
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = buildCliOptions(argv);
  const result = await runRebuildSkinDb(options);
  if (result.backupPath) {
    console.log(`备份文件: ${result.backupPath}`);
  }
  printStats(result.stats);
  return result;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  backupDbFile,
  printStats,
  runRebuildSkinDb,
  main
};
