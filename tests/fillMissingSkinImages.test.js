const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {DatabaseSync} = require("node:sqlite");

const {
  buildCliOptions,
  fillMissingSkinImages
} = require("../tools/fillMissingSkinImages");

function createTempSkinDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-fill-images-"));
  const dbPath = path.join(tempDir, "skins.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE skin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      markethashname TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      basemarkethashname TEXT NOT NULL,
      basename TEXT NOT NULL,
      collection TEXT,
      rarity TEXT,
      wearlevel TEXT NOT NULL,
      minfloat REAL,
      maxfloat REAL,
      isstattrak INTEGER DEFAULT 0,
      buffid TEXT,
      c5id TEXT,
      youpinid TEXT,
      buffprice INTEGER,
      c5price INTEGER,
      youpinprice INTEGER,
      buffprice_updated_at DATETIME,
      c5price_updated_at DATETIME,
      youpinprice_updated_at DATETIME,
      createdat DATETIME DEFAULT CURRENT_TIMESTAMP,
      wear_range REAL,
      goods_icon_url TEXT DEFAULT '',
      goods_original_icon_url TEXT DEFAULT '',
      goods_share_thumbnail_url TEXT DEFAULT '',
      alchemy_type TEXT DEFAULT '不能炼金',
      detail_status TEXT DEFAULT 'pending',
      detail_source TEXT DEFAULT '',
      detail_checked_at DATETIME,
      detail_error TEXT DEFAULT '',
      detail_attempts INTEGER DEFAULT 0
    )
  `);
  return {dbPath, db};
}

function insertSkinRows(db, rows) {
  const stmt = db.prepare(`
    INSERT INTO skin (
      markethashname, name, basemarkethashname, basename, collection, rarity,
      wearlevel, minfloat, maxfloat, isstattrak, buffid, c5id, youpinid,
      buffprice, c5price, youpinprice, buffprice_updated_at, c5price_updated_at, youpinprice_updated_at,
      wear_range, goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url,
      alchemy_type, detail_status, detail_source, detail_checked_at, detail_error, detail_attempts
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    stmt.run(
      row.markethashname,
      row.name || row.markethashname,
      row.basemarkethashname,
      row.basename || row.basemarkethashname,
      row.collection || "",
      row.rarity || "",
      row.wearlevel || "Factory New",
      row.minfloat == null ? null : row.minfloat,
      row.maxfloat == null ? null : row.maxfloat,
      Number(row.isstattrak) ? 1 : 0,
      row.buffid || "",
      row.c5id || "",
      row.youpinid || "",
      row.buffprice == null ? null : row.buffprice,
      row.c5price == null ? null : row.c5price,
      row.youpinprice == null ? null : row.youpinprice,
      row.buffprice_updated_at || null,
      row.c5price_updated_at || null,
      row.youpinprice_updated_at || null,
      row.wear_range == null ? null : row.wear_range,
      row.goods_icon_url || "",
      row.goods_original_icon_url || "",
      row.goods_share_thumbnail_url || "",
      row.alchemy_type || "不能炼金",
      row.detail_status || "ok",
      row.detail_source || "existing_metadata",
      row.detail_checked_at || null,
      row.detail_error || "",
      row.detail_attempts == null ? 0 : row.detail_attempts
    );
  }
}

function test_build_cli_options_parses_image_fill_flags() {
  const options = buildCliOptions([
    "--db", "C:\\temp\\skins.db",
    "--delay-ms", "2500",
    "--limit", "12",
    "--retry-limit", "5",
    "--retry-delay-ms", "4200",
    "--no-backup"
  ]);
  assert.equal(path.basename(options.dbPath), "skins.db");
  assert.equal(options.delayMs, 2500);
  assert.equal(options.limitFamilies, 12);
  assert.equal(options.retryLimit, 5);
  assert.equal(options.retryDelayMs, 4200);
  assert.equal(options.backup, false);
}

async function test_fill_missing_skin_images_runs_image_only_batch() {
  const {dbPath, db} = createTempSkinDb();
  insertSkinRows(db, [
    {
      markethashname: "AK-47 | Redline (Field-Tested)",
      basemarkethashname: "AK-47 | Redline",
      collection: "Operation Phoenix Weapon Case",
      rarity: "保密",
      wearlevel: "Field-Tested",
      buffid: "7001"
    },
    {
      markethashname: "AK-47 | Redline (Minimal Wear)",
      basemarkethashname: "AK-47 | Redline",
      collection: "Operation Phoenix Weapon Case",
      rarity: "保密",
      wearlevel: "Minimal Wear",
      buffid: "7002"
    },
    {
      markethashname: "AWP | Asiimov (Field-Tested)",
      basemarkethashname: "AWP | Asiimov",
      collection: "Operation Phoenix Weapon Case",
      rarity: "隐秘",
      wearlevel: "Field-Tested",
      buffid: "8001"
    }
  ]);
  db.close();

  const imageCalls = [];
  const result = await fillMissingSkinImages({
    dbPath,
    delayMs: 0,
    limitFamilies: 1,
    backup: false,
    provider: {
      async fetchByGoodsId() {
        throw new Error("should not call detail endpoint");
      },
      async fetchGoodsImageByGoodsId(goodsId) {
        imageCalls.push(String(goodsId));
        return {
          goods_icon_url: `https://img.example/${goodsId}/icon.webp`,
          goods_original_icon_url: `https://img.example/${goodsId}/original.webp`,
          goods_share_thumbnail_url: `https://img.example/${goodsId}/share.webp`
        };
      }
    }
  });

  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const rows = verify.prepare(`
    SELECT markethashname, goods_original_icon_url
    FROM skin
    ORDER BY markethashname
  `).all();
  verify.close();

  assert.equal(result.backupPath, "");
  assert.deepEqual(imageCalls, ["7001"]);
  assert.equal(result.stats.image_rows_pending, 2);
  assert.equal(result.stats.image_rows_ok, 2);
  assert.equal(result.stats.image_rows_failed, 0);
  assert.equal(result.stats.image_rows_still_missing, 1);
  assert.equal(rows[0].goods_original_icon_url, "https://img.example/7001/original.webp");
  assert.equal(rows[1].goods_original_icon_url, "https://img.example/7001/original.webp");
  assert.equal(rows[2].goods_original_icon_url, "");
}

(async () => {
  test_build_cli_options_parses_image_fill_flags();
  await test_fill_missing_skin_images_runs_image_only_batch();
  console.log("fillMissingSkinImages tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
