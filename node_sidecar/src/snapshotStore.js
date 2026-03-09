const fs = require("fs");
const path = require("path");
const {PATHS} = require("./constants");
const {ensureDirFor} = require("./jsonStore");
const {nowStamp, nowString} = require("./utils");

function saveProcessedSnapshot(rows, {outDir = PATHS.PROCESSED_DIR} = {}) {
  const fileName = `inventory_processed_${nowStamp()}.json`;
  const filePath = path.join(outDir, fileName);
  ensureDirFor(filePath);
  const payload = {
    format: "processed_inventory_v1",
    generated_at: nowString(),
    item_count: rows.length,
    items: rows
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

function saveRawSnapshot(items, {outDir = PATHS.RAW_DIR} = {}) {
  const fileName = `inventory_raw_${nowStamp()}.json`;
  const filePath = path.join(outDir, fileName);
  ensureDirFor(filePath);
  const payload = {
    generated_at: nowString(),
    item_count: items.length,
    items
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

module.exports = {
  saveProcessedSnapshot,
  saveRawSnapshot
};
