const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {DatabaseSync} = require("node:sqlite");

const {
  enrichInventoryDisplayOnlyImages
} = require("../tools/enrichInventoryDisplayOnlyImages");

function createTempSkinDb(tempDir) {
  const dbPath = path.join(tempDir, "skins.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE skin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      markethashname TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      buffid TEXT,
      inventory_display_only INTEGER DEFAULT 0,
      goods_icon_url TEXT DEFAULT '',
      goods_original_icon_url TEXT DEFAULT '',
      goods_share_thumbnail_url TEXT DEFAULT ''
    )
  `);
  return {dbPath, db};
}

function insertSkinRow(db, row) {
  db.prepare(`
    INSERT INTO skin (
      markethashname, name, buffid, inventory_display_only,
      goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.markethashname,
    row.name || row.markethashname,
    row.buffid || "",
    Number(row.inventory_display_only) ? 1 : 0,
    row.goods_icon_url || "",
    row.goods_original_icon_url || "",
    row.goods_share_thumbnail_url || ""
  );
}

function writeSnapshot(snapshotPath, items) {
  fs.writeFileSync(snapshotPath, JSON.stringify({
    format: "processed_inventory_v1",
    generated_at: "2026-04-07 14:20:00",
    item_count: items.length,
    items
  }, null, 2), "utf8");
}

async function test_tool_only_targets_latest_snapshot_display_only_rows_missing_images() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-inventory-image-tool-"));
  const processedDir = path.join(tempDir, "logs", "processed_inventory");
  fs.mkdirSync(processedDir, {recursive: true});
  const {dbPath, db} = createTempSkinDb(tempDir);

  insertSkinRow(db, {
    markethashname: "Sticker | Miami Stabbyfish",
    buffid: "2101",
    inventory_display_only: 1
  });
  insertSkinRow(db, {
    markethashname: "Sticker | KSCERATO (Holo) | Austin 2025",
    buffid: "2103",
    inventory_display_only: 1
  });
  insertSkinRow(db, {
    markethashname: "Music Kit | Valve, CS:GO",
    buffid: "",
    inventory_display_only: 1
  });
  insertSkinRow(db, {
    markethashname: "AK-47 | Redline (Field-Tested)",
    buffid: "3101",
    inventory_display_only: 0
  });
  insertSkinRow(db, {
    markethashname: "Global Offensive Badge",
    buffid: "4101",
    inventory_display_only: 1,
    goods_icon_url: "https://img.example/badge/icon.webp",
    goods_original_icon_url: "https://img.example/badge/original.webp",
    goods_share_thumbnail_url: "https://img.example/badge/share.webp"
  });
  db.close();

  const olderSnapshotPath = path.join(processedDir, "inventory_processed_20260407_140000.json");
  const latestSnapshotPath = path.join(processedDir, "inventory_processed_20260407_142000.json");
  writeSnapshot(olderSnapshotPath, [
    {market_hash_name: "Sticker | KSCERATO (Holo) | Austin 2025"}
  ]);
  writeSnapshot(latestSnapshotPath, [
    {market_hash_name: "Sticker | Miami Stabbyfish"},
    {market_hash_name: "Music Kit | Valve, CS:GO"},
    {market_hash_name: "AK-47 | Redline (Field-Tested)"},
    {market_hash_name: "Global Offensive Badge"}
  ]);
  fs.utimesSync(olderSnapshotPath, new Date("2026-04-07T14:00:00.000Z"), new Date("2026-04-07T14:00:00.000Z"));
  fs.utimesSync(latestSnapshotPath, new Date("2026-04-07T14:20:00.000Z"), new Date("2026-04-07T14:20:00.000Z"));

  const captured = [];
  const result = await enrichInventoryDisplayOnlyImages({
    dbPath,
    processedDir
  }, {
    createService(options) {
      return {
        async enrichMissingImages(serviceOptions = {}) {
          captured.push({
            options,
            serviceOptions
          });
          return {
            image_rows_pending: Array.isArray(serviceOptions.targetMarketHashNames)
              ? serviceOptions.targetMarketHashNames.length
              : 0,
            image_rows_ok: Array.isArray(serviceOptions.targetMarketHashNames)
              ? serviceOptions.targetMarketHashNames.length
              : 0,
            image_rows_failed: 0,
            image_rows_still_missing: 0
          };
        }
      };
    }
  });

  assert.equal(captured.length, 1);
  assert.equal(result.snapshotPath, latestSnapshotPath);
  assert.deepEqual(result.targetMarketHashNames, [
    "Sticker | Miami Stabbyfish",
    "Music Kit | Valve, CS:GO"
  ]);
  assert.deepEqual(captured[0].serviceOptions.targetMarketHashNames, [
    "Sticker | Miami Stabbyfish",
    "Music Kit | Valve, CS:GO"
  ]);
  assert.equal(result.result.image_rows_ok, 2);
}

(async () => {
  await test_tool_only_targets_latest_snapshot_display_only_rows_missing_images();
  console.log("enrichInventoryDisplayOnlyImagesTool tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
