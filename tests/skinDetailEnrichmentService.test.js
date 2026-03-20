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
      createdat DATETIME DEFAULT CURRENT_TIMESTAMP,
      wear_range REAL,
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
      wear_range, alchemy_type, detail_status, detail_source, detail_checked_at,
      detail_error, detail_attempts
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      row.wear_range == null ? null : row.wear_range,
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
      detail_source: "existing_metadata"
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
  await test_enrichment_marks_family_failed();
  await test_enrichment_skips_ok_rows();
  await test_enrichment_recalculates_alchemy_type_for_affected_rows();
}

(async () => {
  await runTests();
  console.log("skinDetailEnrichmentService tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
