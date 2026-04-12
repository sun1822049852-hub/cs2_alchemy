const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {DatabaseSync} = require("node:sqlite");

const {
  buildCliOptions,
  enrichMissingImages,
  resolveImageThrottleOptions
} = require("../tools/enrichMissingImages");

function createTempSkinDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-enrich-images-"));
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

function insertSkinRow(db, row) {
  db.prepare(`
    INSERT INTO skin (
      markethashname, name, basemarkethashname, basename, collection, rarity,
      wearlevel, minfloat, maxfloat, isstattrak, buffid, c5id, youpinid,
      buffprice, c5price, youpinprice, buffprice_updated_at, c5price_updated_at, youpinprice_updated_at,
      wear_range, goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url,
      alchemy_type, detail_status, detail_source, detail_checked_at, detail_error, detail_attempts
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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

function test_build_cli_options_accepts_no_rate_limit_flag() {
  const options = buildCliOptions([
    "--db", "C:\\temp\\skins.db",
    "--concurrency", "100",
    "--image-max-in-flight", "100",
    "--no-rate-limit"
  ]);

  assert.equal(options.dbPath, "C:\\temp\\skins.db");
  assert.equal(options.concurrency, 100);
  assert.equal(options.imageRequestMaxInFlight, 100);
  assert.equal(options.noRateLimit, true);
}

function test_resolve_image_throttle_options_disables_all_local_rate_limits() {
  const throttle = resolveImageThrottleOptions({
    concurrency: 100,
    imageRequestMaxInFlight: 100,
    imageQps: 60,
    imageBaseDelayMs: 250,
    imageRateLimitBackoffMs: 1200,
    imageRateLimitMaxDelayMs: 10000,
    imageDelayRelaxStepMs: 100,
    imageDelayRelaxAfterSuccesses: 4,
    noRateLimit: true
  });

  assert.deepEqual(throttle, {
    imageBaseDelayMs: 0,
    imageRateLimitBackoffMs: 0,
    imageRateLimitMaxDelayMs: 0,
    imageDelayRelaxStepMs: 0,
    imageDelayRelaxAfterSuccesses: 1,
    imageRequestMaxInFlight: 100
  });
}

async function test_enrich_missing_images_uses_steam_first_provider_chain_by_default() {
  const {dbPath, db} = createTempSkinDb();
  insertSkinRow(db, {
    markethashname: "AK-47 | Blue Laminate (Factory New)",
    basemarkethashname: "AK-47 | Blue Laminate",
    collection: "The eSports 2013 Collection",
    rarity: "受限",
    wearlevel: "Factory New",
    buffid: ""
  });
  db.close();

  const result = await enrichMissingImages({
    dbPath,
    concurrency: 1,
    noRateLimit: true,
    steamImageOptions: {
      itemsGameText: `
        "set_esports"
        {
          "items"
          {
            "[hy_ak47lam]weapon_ak47" "1"
          }
        }
      `,
      englishText: `
        "PaintKit_hy_ak47lam_Tag" "Blue Laminate"
      `
    }
  });

  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const row = verify.prepare(`
    SELECT goods_original_icon_url
    FROM skin
    WHERE markethashname = ?
  `).get("AK-47 | Blue Laminate (Factory New)");
  verify.close();

  assert.equal(result.image_rows_ok, 1);
  assert.equal(result.image_rows_failed, 0);
  assert.equal(
    row.goods_original_icon_url,
    "https://community.akamai.steamstatic.com/economy/image/econ/default_generated/weapon_ak47_hy_ak47lam_light_large"
  );
}

test_build_cli_options_accepts_no_rate_limit_flag();
test_resolve_image_throttle_options_disables_all_local_rate_limits();
(async () => {
  await test_enrich_missing_images_uses_steam_first_provider_chain_by_default();
  console.log("enrichMissingImagesTool tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
