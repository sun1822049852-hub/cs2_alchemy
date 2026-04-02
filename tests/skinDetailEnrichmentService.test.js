const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {DatabaseSync} = require("node:sqlite");

const {buildSkinFamilyKey} = require("../node_sidecar/src/services/skinFamilyKey");
const {createSkinDetailEnrichmentService} = require("../node_sidecar/src/services/skinDetailEnrichmentService");

function createTempSkinDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-skin-detail-"));
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
      row.detail_status || "pending",
      row.detail_source || "",
      row.detail_checked_at || null,
      row.detail_error || "",
      row.detail_attempts == null ? 0 : row.detail_attempts
    );
  }
}

async function test_enrichment_updates_whole_family_once() {
  const {dbPath, db} = createTempSkinDb();
  insertSkinRows(db, [
    {
      markethashname: "★ Butterfly Knife | Blue Steel (Battle-Scarred)",
      basemarkethashname: "★ Butterfly Knife | Blue Steel",
      collection: "",
      rarity: "",
      wearlevel: "Battle-Scarred",
      buffid: "201",
      detail_status: "pending"
    },
    {
      markethashname: "★ StatTrak™ Butterfly Knife | Blue Steel (Factory New)",
      basemarkethashname: "★ StatTrak™ Butterfly Knife | Blue Steel",
      isstattrak: 1,
      collection: "",
      rarity: "",
      wearlevel: "Factory New",
      buffid: "202",
      detail_status: "pending"
    }
  ]);
  db.close();

  const providerCalls = [];
  const service = createSkinDetailEnrichmentService({
    dbPath,
    provider: {
      async fetchByGoodsId(goodsId) {
        providerCalls.push(String(goodsId));
        return {collection: "Gallery Case", rarity: "隐秘", detail_source: "buff"};
      }
    }
  });

  const result = await service.enrichMissingDetails();
  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const rows = verify.prepare(`
    SELECT collection, rarity, detail_status, detail_source, detail_attempts
    FROM skin
    ORDER BY markethashname
  `).all();
  verify.close();

  assert.equal(providerCalls.length, 1);
  assert.equal(result.families_pending, 1);
  assert.equal(result.families_ok, 1);
  assert.equal(result.rows_filled, 2);
  assert.equal(rows.every((row) => row.collection === "Gallery Case"), true);
  assert.equal(rows.every((row) => row.rarity === "隐秘"), true);
  assert.equal(rows.every((row) => row.detail_status === "ok"), true);
  assert.equal(rows.every((row) => row.detail_source === "buff"), true);
  assert.equal(rows.every((row) => row.detail_attempts === 1), true);
}

async function test_enrichment_fills_images_per_family_once() {
  const {dbPath, db} = createTempSkinDb();
  insertSkinRows(db, [
    {
      markethashname: "★ Butterfly Knife | Blue Steel (Battle-Scarred)",
      basemarkethashname: "★ Butterfly Knife | Blue Steel",
      collection: "",
      rarity: "",
      wearlevel: "Battle-Scarred",
      buffid: "201",
      detail_status: "pending"
    },
    {
      markethashname: "★ StatTrak™ Butterfly Knife | Blue Steel (Factory New)",
      basemarkethashname: "★ StatTrak™ Butterfly Knife | Blue Steel",
      isstattrak: 1,
      collection: "",
      rarity: "",
      wearlevel: "Factory New",
      buffid: "202",
      detail_status: "pending"
    }
  ]);
  db.close();

  const detailCalls = [];
  const imageCalls = [];
  const service = createSkinDetailEnrichmentService({
    dbPath,
    provider: {
      async fetchByGoodsId(goodsId) {
        detailCalls.push(String(goodsId));
        return {collection: "Gallery Case", rarity: "隐秘", detail_source: "buff"};
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

  const result = await service.enrichMissingDetails();
  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const rows = verify.prepare(`
    SELECT markethashname, goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url
    FROM skin
    ORDER BY markethashname
  `).all();
  verify.close();

  assert.deepEqual(detailCalls, ["201"]);
  assert.deepEqual(imageCalls, ["201"]);
  assert.equal(result.image_rows_ok, 2);
  assert.equal(rows[0].goods_original_icon_url, "https://img.example/201/original.webp");
  assert.equal(rows[1].goods_original_icon_url, "https://img.example/201/original.webp");
  assert.equal(rows[0].goods_share_thumbnail_url, "https://img.example/201/share.webp");
  assert.equal(rows[1].goods_share_thumbnail_url, "https://img.example/201/share.webp");
}

async function test_enrichment_marks_family_failed() {
  const {dbPath, db} = createTempSkinDb();
  insertSkinRows(db, [
    {
      markethashname: "AWP | Doodle Lore (Field-Tested)",
      basemarkethashname: "AWP | Doodle Lore",
      collection: "",
      rarity: "",
      wearlevel: "Field-Tested",
      buffid: "301",
      detail_status: "pending"
    },
    {
      markethashname: "AWP | Doodle Lore (Factory New)",
      basemarkethashname: "AWP | Doodle Lore",
      collection: "",
      rarity: "",
      wearlevel: "Factory New",
      buffid: "302",
      detail_status: "pending"
    }
  ]);
  db.close();

  const service = createSkinDetailEnrichmentService({
    dbPath,
    provider: {
      async fetchByGoodsId() {
        throw new Error("upstream down");
      }
    }
  });

  const result = await service.enrichMissingDetails();
  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const rows = verify.prepare(`
    SELECT collection, rarity, detail_status, detail_error, detail_attempts
    FROM skin
    ORDER BY markethashname
  `).all();
  verify.close();

  assert.equal(result.families_failed, 1);
  assert.equal(rows.every((row) => row.collection === ""), true);
  assert.equal(rows.every((row) => row.rarity === ""), true);
  assert.equal(rows.every((row) => row.detail_status === "failed"), true);
  assert.equal(rows.every((row) => String(row.detail_error || "").includes("upstream down")), true);
  assert.equal(rows.every((row) => row.detail_attempts === 1), true);
}

async function test_enrichment_refreshes_legacy_english_existing_metadata_rows() {
  const {dbPath, db} = createTempSkinDb();
  insertSkinRows(db, [
    {
      markethashname: "Galil AR | Sky Mandala (Factory New)",
      basemarkethashname: "Galil AR | Sky Mandala",
      collection: "The Harlequin Collection",
      rarity: "Mil-Spec Grade",
      wearlevel: "Factory New",
      buffid: "4201",
      detail_status: "ok",
      detail_source: "existing_metadata"
    },
    {
      markethashname: "Galil AR | Sky Mandala (Minimal Wear)",
      basemarkethashname: "Galil AR | Sky Mandala",
      collection: "The Harlequin Collection",
      rarity: "Mil-Spec Grade",
      wearlevel: "Minimal Wear",
      buffid: "4202",
      detail_status: "ok",
      detail_source: "existing_metadata"
    }
  ]);
  db.close();

  const providerCalls = [];
  const service = createSkinDetailEnrichmentService({
    dbPath,
    provider: {
      async fetchByGoodsId(goodsId) {
        providerCalls.push(String(goodsId));
        return {
          collection: "哈乐昆收藏品",
          rarity: "军规级",
          detail_source: "buff"
        };
      }
    }
  });

  const result = await service.enrichMissingDetails();
  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const rows = verify.prepare(`
    SELECT collection, rarity, detail_status, detail_source, detail_attempts
    FROM skin
    ORDER BY markethashname
  `).all();
  verify.close();

  assert.deepEqual(providerCalls, ["4201"]);
  assert.equal(result.families_pending, 1);
  assert.equal(result.families_ok, 1);
  assert.equal(result.rows_filled, 2);
  assert.equal(rows.every((row) => row.collection === "哈乐昆收藏品"), true);
  assert.equal(rows.every((row) => row.rarity === "军规级"), true);
  assert.equal(rows.every((row) => row.detail_status === "ok"), true);
  assert.equal(rows.every((row) => row.detail_source === "buff"), true);
  assert.equal(rows.every((row) => row.detail_attempts === 1), true);
}

async function test_enrichment_skips_ok_rows() {
  const {dbPath, db} = createTempSkinDb();
  insertSkinRows(db, [
    {
      markethashname: "AK-47 | Redline (Field-Tested)",
      basemarkethashname: "AK-47 | Redline",
      collection: "Operation Phoenix Weapon Case",
      rarity: "保密",
      wearlevel: "Field-Tested",
      buffid: "401",
      detail_status: "ok",
      detail_source: "buff"
    }
  ]);
  db.close();

  const providerCalls = [];
  const service = createSkinDetailEnrichmentService({
    dbPath,
    provider: {
      async fetchByGoodsId(goodsId) {
        providerCalls.push(String(goodsId));
        return {collection: "Gallery Case", rarity: "隐秘", detail_source: "buff"};
      }
    }
  });

  const result = await service.enrichMissingDetails();
  assert.equal(providerCalls.length, 0);
  assert.equal(result.families_pending, 0);
  assert.equal(result.families_ok, 0);
  assert.equal(result.families_failed, 0);
}

async function test_enrichment_fills_images_for_ok_rows_with_missing_image() {
  const {dbPath, db} = createTempSkinDb();
  insertSkinRows(db, [
    {
      markethashname: "AK-47 | Redline (Field-Tested)",
      basemarkethashname: "AK-47 | Redline",
      collection: "Operation Phoenix Weapon Case",
      rarity: "保密",
      wearlevel: "Field-Tested",
      buffid: "401",
      detail_status: "ok",
      detail_source: "buff"
    }
  ]);
  db.close();

  const imageCalls = [];
  const service = createSkinDetailEnrichmentService({
    dbPath,
    provider: {
      async fetchByGoodsId() {
        throw new Error("should not call family detail provider");
      },
      async fetchGoodsImageByGoodsId(goodsId) {
        imageCalls.push(String(goodsId));
        return {
          goods_icon_url: "https://img.example/401/icon.webp",
          goods_original_icon_url: "https://img.example/401/original.webp",
          goods_share_thumbnail_url: "https://img.example/401/share.webp"
        };
      }
    }
  });

  const result = await service.enrichMissingDetails();
  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const row = verify.prepare(`
    SELECT goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url
    FROM skin
    WHERE markethashname = ?
  `).get("AK-47 | Redline (Field-Tested)");
  verify.close();

  assert.deepEqual(imageCalls, ["401"]);
  assert.equal(result.image_rows_ok, 1);
  assert.equal(row.goods_original_icon_url, "https://img.example/401/original.webp");
  assert.equal(row.goods_share_thumbnail_url, "https://img.example/401/share.webp");
}

async function test_enrichment_fills_wear_range_per_family_once() {
  const {dbPath, db} = createTempSkinDb();
  insertSkinRows(db, [
    {
      markethashname: "AK-47 | Slate (Field-Tested)",
      basemarkethashname: "AK-47 | Slate",
      collection: "Snakebite Case",
      rarity: "保密",
      wearlevel: "Field-Tested",
      buffid: "701",
      detail_status: "ok",
      detail_source: "buff"
    },
    {
      markethashname: "AK-47 | Slate (Minimal Wear)",
      basemarkethashname: "AK-47 | Slate",
      collection: "Snakebite Case",
      rarity: "保密",
      wearlevel: "Minimal Wear",
      buffid: "702",
      detail_status: "ok",
      detail_source: "buff"
    }
  ]);
  db.close();

  const wearCalls = [];
  const service = createSkinDetailEnrichmentService({
    dbPath,
    provider: {
      async fetchByGoodsId() {
        throw new Error("should not call family detail provider");
      },
      async fetchWearRangeByGoodsId(goodsId, options = {}) {
        wearCalls.push({
          goodsId: String(goodsId),
          familyKey: String(options.familyKey || "")
        });
        return {
          minfloat: 0,
          maxfloat: 1,
          wear_range: 1
        };
      }
    }
  });

  const result = await service.enrichMissingDetails();
  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const rows = verify.prepare(`
    SELECT markethashname, minfloat, maxfloat, wear_range
    FROM skin
    ORDER BY markethashname
  `).all();
  verify.close();

  assert.deepEqual(wearCalls, [{
    goodsId: "701",
    familyKey: buildSkinFamilyKey("AK-47 | Slate")
  }]);
  assert.equal(result.wear_rows_pending, 2);
  assert.equal(result.wear_rows_ok, 2);
  assert.equal(result.wear_rows_failed, 0);
  assert.equal(result.wear_rows_still_missing, 0);
  assert.equal(rows[0].minfloat, 0);
  assert.equal(rows[0].maxfloat, 1);
  assert.equal(rows[0].wear_range, 1);
  assert.equal(rows[1].minfloat, 0);
  assert.equal(rows[1].maxfloat, 1);
  assert.equal(rows[1].wear_range, 1);
}

async function test_enrichment_images_only_can_resume_from_db_state() {
  const {dbPath, db} = createTempSkinDb();
  insertSkinRows(db, [
    {
      markethashname: "AK-47 | Redline (Field-Tested)",
      basemarkethashname: "AK-47 | Redline",
      collection: "Operation Phoenix Weapon Case",
      rarity: "保密",
      wearlevel: "Field-Tested",
      buffid: "501",
      detail_status: "ok",
      detail_source: "buff"
    },
    {
      markethashname: "AK-47 | Redline (Minimal Wear)",
      basemarkethashname: "AK-47 | Redline",
      collection: "Operation Phoenix Weapon Case",
      rarity: "保密",
      wearlevel: "Minimal Wear",
      buffid: "502",
      detail_status: "ok",
      detail_source: "buff"
    },
    {
      markethashname: "AWP | Asiimov (Field-Tested)",
      basemarkethashname: "AWP | Asiimov",
      collection: "Operation Phoenix Weapon Case",
      rarity: "隐秘",
      wearlevel: "Field-Tested",
      buffid: "601",
      detail_status: "ok",
      detail_source: "buff"
    },
    {
      markethashname: "AWP | Asiimov (Battle-Scarred)",
      basemarkethashname: "AWP | Asiimov",
      collection: "Operation Phoenix Weapon Case",
      rarity: "隐秘",
      wearlevel: "Battle-Scarred",
      buffid: "602",
      detail_status: "ok",
      detail_source: "buff"
    }
  ]);
  db.close();

  const imageCalls = [];
  const service = createSkinDetailEnrichmentService({
    dbPath,
    provider: {
      async fetchByGoodsId() {
        throw new Error("should not call family detail provider");
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

  const first = await service.enrichMissingImages({limitFamilies: 1});
  const midVerify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const midRows = midVerify.prepare(`
    SELECT markethashname, goods_original_icon_url
    FROM skin
    ORDER BY markethashname
  `).all();
  midVerify.close();

  assert.deepEqual(imageCalls, ["501"]);
  assert.equal(first.image_rows_pending, 2);
  assert.equal(first.image_rows_ok, 2);
  assert.equal(first.image_rows_still_missing, 2);
  assert.equal(midRows[0].goods_original_icon_url, "https://img.example/501/original.webp");
  assert.equal(midRows[1].goods_original_icon_url, "https://img.example/501/original.webp");
  assert.equal(midRows[2].goods_original_icon_url, "");
  assert.equal(midRows[3].goods_original_icon_url, "");

  const second = await service.enrichMissingImages();
  const endVerify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const endRows = endVerify.prepare(`
    SELECT markethashname, goods_original_icon_url
    FROM skin
    ORDER BY markethashname
  `).all();
  endVerify.close();

  assert.deepEqual(imageCalls, ["501", "601"]);
  assert.equal(second.image_rows_pending, 2);
  assert.equal(second.image_rows_ok, 2);
  assert.equal(second.image_rows_still_missing, 0);
  assert.equal(endRows[0].goods_original_icon_url, "https://img.example/501/original.webp");
  assert.equal(endRows[1].goods_original_icon_url, "https://img.example/501/original.webp");
  assert.equal(endRows[2].goods_original_icon_url, "https://img.example/601/original.webp");
  assert.equal(endRows[3].goods_original_icon_url, "https://img.example/601/original.webp");
}

async function test_enrichment_recalculates_alchemy_type_for_affected_rows() {
  const {dbPath, db} = createTempSkinDb();
  insertSkinRows(db, [
    {
      markethashname: "AK-47 | Elite Build (Factory New)",
      basemarkethashname: "AK-47 | Elite Build",
      collection: "Gallery Case",
      rarity: "保密",
      wearlevel: "Factory New",
      buffid: "501",
      alchemy_type: "不能炼金",
      detail_status: "ok",
      detail_source: "buff"
    },
    {
      markethashname: "AWP | Doodle Lore (Field-Tested)",
      basemarkethashname: "AWP | Doodle Lore",
      collection: "",
      rarity: "",
      wearlevel: "Field-Tested",
      buffid: "502",
      alchemy_type: "不能炼金",
      detail_status: "pending"
    },
    {
      markethashname: "AWP | Doodle Lore (Minimal Wear)",
      basemarkethashname: "AWP | Doodle Lore",
      collection: "",
      rarity: "",
      wearlevel: "Minimal Wear",
      buffid: "503",
      alchemy_type: "不能炼金",
      detail_status: "pending"
    }
  ]);
  db.close();

  const service = createSkinDetailEnrichmentService({
    dbPath,
    provider: {
      async fetchByGoodsId() {
        return {collection: "Gallery Case", rarity: "受限", detail_source: "buff"};
      }
    }
  });

  await service.enrichMissingDetails();

  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const rows = verify.prepare(`
    SELECT markethashname, alchemy_type
    FROM skin
    WHERE markethashname LIKE 'AWP | Doodle Lore%'
    ORDER BY markethashname
  `).all();
  verify.close();

  assert.equal(rows.every((row) => row.alchemy_type === "10合1"), true);
}

async function test_enrichment_throttles_detail_refresh_requests() {
  const {dbPath, db} = createTempSkinDb();
  insertSkinRows(db, [
    {
      markethashname: "AK-47 | Slate (Field-Tested)",
      basemarkethashname: "AK-47 | Slate",
      collection: "Snakebite Case",
      rarity: "Restricted",
      wearlevel: "Field-Tested",
      buffid: "701",
      detail_status: "ok",
      detail_source: "existing_metadata"
    },
    {
      markethashname: "M4A1-S | Night Terror (Field-Tested)",
      basemarkethashname: "M4A1-S | Night Terror",
      collection: "Dreams & Nightmares Case",
      rarity: "Mil-Spec Grade",
      wearlevel: "Field-Tested",
      buffid: "801",
      detail_status: "ok",
      detail_source: "existing_metadata"
    },
    {
      markethashname: "USP-S | Ticket to Hell (Field-Tested)",
      basemarkethashname: "USP-S | Ticket to Hell",
      collection: "Dreams & Nightmares Case",
      rarity: "Restricted",
      wearlevel: "Field-Tested",
      buffid: "901",
      detail_status: "ok",
      detail_source: "existing_metadata"
    }
  ]);
  db.close();

  const detailCalls = [];
  const sleepCalls = [];
  const service = createSkinDetailEnrichmentService({
    dbPath,
    provider: {
      async fetchByGoodsId(goodsId) {
        detailCalls.push(String(goodsId));
        return {
          collection: "梦魇武器箱",
          rarity: "军规级",
          detail_source: "buff"
        };
      }
    },
    concurrency: 3,
    detailBaseDelayMs: 20,
    detailSleepImpl: async (ms) => {
      sleepCalls.push(ms);
    }
  });

  const result = await service.enrichMissingDetails();

  assert.deepEqual(detailCalls, ["701", "801", "901"]);
  assert.deepEqual(sleepCalls, [20, 20]);
  assert.equal(result.families_ok, 3);
  assert.equal(result.families_failed, 0);
}

async function test_enrichment_increases_delay_after_rate_limit_and_relaxes_after_success() {
  const {dbPath, db} = createTempSkinDb();
  insertSkinRows(db, [
    {
      markethashname: "AK-47 | Slate (Field-Tested)",
      basemarkethashname: "AK-47 | Slate",
      collection: "Snakebite Case",
      rarity: "保密",
      wearlevel: "Field-Tested",
      buffid: "701",
      detail_status: "ok",
      detail_source: "buff"
    },
    {
      markethashname: "M4A1-S | Night Terror (Field-Tested)",
      basemarkethashname: "M4A1-S | Night Terror",
      collection: "Dreams & Nightmares Case",
      rarity: "军规级",
      wearlevel: "Field-Tested",
      buffid: "801",
      detail_status: "ok",
      detail_source: "existing_metadata"
    },
    {
      markethashname: "USP-S | Ticket to Hell (Field-Tested)",
      basemarkethashname: "USP-S | Ticket to Hell",
      collection: "Dreams & Nightmares Case",
      rarity: "受限",
      wearlevel: "Field-Tested",
      buffid: "901",
      detail_status: "ok",
      detail_source: "existing_metadata"
    }
  ]);
  db.close();

  const imageCalls = [];
  const sleepCalls = [];
  const service = createSkinDetailEnrichmentService({
    dbPath,
    provider: {
      async fetchByGoodsId() {
        throw new Error("should not call family detail provider");
      },
      async fetchGoodsImageByGoodsId(goodsId) {
        imageCalls.push(String(goodsId));
        if (String(goodsId) === "701") {
          const err = new Error("buff goods page goods_id=701 http=429");
          err.statusCode = 429;
          throw err;
        }
        return {
          goods_icon_url: `https://img.example/${goodsId}/icon.webp`,
          goods_original_icon_url: `https://img.example/${goodsId}/original.webp`,
          goods_share_thumbnail_url: `https://img.example/${goodsId}/share.webp`
        };
      }
    },
    concurrency: 1,
    imageSleepImpl: async (ms) => {
      sleepCalls.push(ms);
    },
    imageRateLimitBackoffMs: 25,
    imageRateLimitMaxDelayMs: 50,
    imageDelayRelaxStepMs: 10,
    imageDelayRelaxAfterSuccesses: 1
  });

  const result = await service.enrichMissingImages({delayMs: 0});
  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const rows = verify.prepare(`
    SELECT markethashname, goods_original_icon_url
    FROM skin
    ORDER BY markethashname
  `).all();
  verify.close();

  assert.deepEqual(imageCalls, ["701", "801", "901"]);
  assert.deepEqual(sleepCalls, [25, 15]);
  assert.equal(result.image_rows_pending, 3);
  assert.equal(result.image_rows_ok, 2);
  assert.equal(result.image_rows_failed, 1);
  assert.equal(result.image_rows_still_missing, 1);
  assert.equal(rows[0].goods_original_icon_url, "");
  assert.equal(rows[1].goods_original_icon_url, "https://img.example/801/original.webp");
  assert.equal(rows[2].goods_original_icon_url, "https://img.example/901/original.webp");
}

async function runTests() {
  assert.equal(
    buildSkinFamilyKey("★ Butterfly Knife | Blue Steel"),
    buildSkinFamilyKey("★ StatTrak™ Butterfly Knife | Blue Steel")
  );

  assert.equal(
    buildSkinFamilyKey("AWP | Doodle Lore"),
    buildSkinFamilyKey("AWP | Doodle Lore")
  );

  await test_enrichment_updates_whole_family_once();
  await test_enrichment_fills_images_per_family_once();
  await test_enrichment_marks_family_failed();
  await test_enrichment_refreshes_legacy_english_existing_metadata_rows();
  await test_enrichment_skips_ok_rows();
  await test_enrichment_fills_images_for_ok_rows_with_missing_image();
  await test_enrichment_fills_wear_range_per_family_once();
  await test_enrichment_images_only_can_resume_from_db_state();
  await test_enrichment_recalculates_alchemy_type_for_affected_rows();
  await test_enrichment_throttles_detail_refresh_requests();
  await test_enrichment_increases_delay_after_rate_limit_and_relaxes_after_success();
}

(async () => {
  await runTests();
  console.log("skinDetailEnrichmentService tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
