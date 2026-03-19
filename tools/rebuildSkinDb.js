const fs = require("node:fs");
const path = require("node:path");
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
  console.log("炼金类型分布:");
  for (const [key, value] of Object.entries(stats.alchemyStats || {})) {
    console.log(`  ${key}: ${Number(value || 0)}`);
  }
}

const options = buildCliOptions(process.argv.slice(2));
const backupPath = backupDbFile(options.dbPath);
const items = loadItemsFromJson(options.jsonPath);
const stats = syncSkinDb({
  dbPath: options.dbPath,
  items
});
if (backupPath) {
  console.log(`备份文件: ${backupPath}`);
}
printStats(stats);
