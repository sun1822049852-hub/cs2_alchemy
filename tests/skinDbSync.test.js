const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {DatabaseSync} = require("node:sqlite");

const {
  DEFAULT_JSON_DIR,
  isImportableSkin,
  syncSkinDb,
  assignAlchemyTypes,
  buildCliOptions,
  findLatestSteamBaseInfoJson
} = require("../node_sidecar/src/skinDbSync");

function createTempSkinDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-skin-db-"));
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
      alchemy_type TEXT DEFAULT '不能炼金'
    )
  `);
  return {dbPath, db};
}

async function test_syncSkinDb_enriches_pending_rows_after_base_commit() {
  const {dbPath, db} = createTempSkinDb();
  db.close();

  const result = await syncSkinDb({
    dbPath,
    items: [
      {
        name: "AK-47 | 红线 (久经沙场)",
        marketHashName: "AK-47 | Redline (Field-Tested)",
        platformList: [{name: "BUFF", itemId: "601"}]
      }
    ],
    detailProvider: {
      async fetchByGoodsId(goodsId) {
        assert.equal(String(goodsId), "601");
        return {
          collection: "Gallery Case",
          rarity: "受限",
          detail_source: "buff"
        };
      }
    }
  });

  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const row = verify.prepare(`
    SELECT markethashname, collection, rarity, detail_status, detail_source
    FROM skin
    WHERE markethashname = ?
  `).get("AK-47 | Redline (Field-Tested)");
  verify.close();

  assert.equal(result.importedItems, 1);
  assert.equal(result.detailStats.families_ok, 1);
  assert.equal(row.markethashname, "AK-47 | Redline (Field-Tested)");
  assert.equal(row.collection, "Gallery Case");
  assert.equal(row.rarity, "受限");
  assert.equal(row.detail_status, "ok");
  assert.equal(row.detail_source, "buff");
}

async function test_syncSkinDb_keeps_base_rows_when_enrichment_fails() {
  const {dbPath, db} = createTempSkinDb();
  db.close();

  const result = await syncSkinDb({
    dbPath,
    items: [
      {
        name: "AK-47 | 红线 (久经沙场)",
        marketHashName: "AK-47 | Redline (Field-Tested)",
        platformList: [{name: "BUFF", itemId: "701"}]
      }
    ],
    detailProvider: {
      async fetchByGoodsId() {
        throw new Error("detail api down");
      }
    }
  });

  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const row = verify.prepare(`
    SELECT markethashname, detail_status, detail_error
    FROM skin
    WHERE markethashname = ?
  `).get("AK-47 | Redline (Field-Tested)");
  verify.close();

  assert.equal(result.importedItems, 1);
  assert.equal(result.detailStats.families_failed, 1);
  assert.equal(row.markethashname, "AK-47 | Redline (Field-Tested)");
  assert.equal(row.detail_status, "failed");
  assert.equal(String(row.detail_error || "").includes("detail api down"), true);
}

async function test_syncSkinDb_enriches_missing_wear_range_after_base_commit() {
  const {dbPath, db} = createTempSkinDb();
  db.close();

  const result = await syncSkinDb({
    dbPath,
    items: [
      {
        name: "AK-47 | 红线 (久经沙场)",
        marketHashName: "AK-47 | Redline (Field-Tested)",
        platformList: [{name: "BUFF", itemId: "801"}]
      }
    ],
    detailProvider: {
      async fetchByGoodsId() {
        return {
          collection: "Gallery Case",
          rarity: "受限",
          detail_source: "buff"
        };
      },
      async fetchWearRangeByGoodsId(goodsId) {
        assert.equal(String(goodsId), "801");
        return {
          minfloat: 0.1,
          maxfloat: 0.7,
          wear_range: 0.6
        };
      }
    }
  });

  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const row = verify.prepare(`
    SELECT markethashname, minfloat, maxfloat, wear_range
    FROM skin
    WHERE markethashname = ?
  `).get("AK-47 | Redline (Field-Tested)");
  verify.close();

  assert.equal(result.detailStats.wear_rows_ok, 1);
  assert.equal(row.minfloat, 0.1);
  assert.equal(row.maxfloat, 0.7);
  assert.equal(row.wear_range, 0.6);
}

async function test_syncSkinDb_refreshes_existing_wear_range_during_update() {
  const {dbPath, db} = createTempSkinDb();
  db.exec(`
    INSERT INTO skin (
      markethashname, name, basemarkethashname, basename, collection, rarity,
      wearlevel, minfloat, maxfloat, isstattrak, buffid, c5id, wear_range
    ) VALUES (
      'AK-47 | Slate (Field-Tested)',
      'AK-47 | Slate (Field-Tested)',
      'AK-47 | Slate',
      'AK-47 | Slate',
      'Snakebite Case',
      '受限',
      'Field-Tested',
      0,
      1,
      0,
      'old-buff',
      'old-c5',
      1
    )
  `);
  db.close();

  const wearCalls = [];
  const result = await syncSkinDb({
    dbPath,
    items: [
      {
        name: "AK-47 | Slate (久经沙场)",
        marketHashName: "AK-47 | Slate (Field-Tested)",
        platformList: [
          {name: "BUFF", itemId: "new-buff"},
          {name: "C5", itemId: "new-c5"}
        ]
      }
    ],
    detailProvider: {
      async fetchByGoodsId() {
        throw new Error("detail metadata should already be complete");
      },
      async fetchWearRangeByGoodsId(goodsId, options = {}) {
        wearCalls.push({
          goodsId: String(goodsId),
          c5id: String(options.c5id || ""),
          basename: String(options.basename || "")
        });
        return {
          minfloat: 0,
          maxfloat: 0.7,
          wear_range: 0.7
        };
      }
    }
  });

  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const row = verify.prepare(`
    SELECT minfloat, maxfloat, wear_range, buffid, c5id
    FROM skin
    WHERE markethashname = ?
  `).get("AK-47 | Slate (Field-Tested)");
  verify.close();

  assert.deepEqual(wearCalls, [{
    goodsId: "new-buff",
    c5id: "new-c5",
    basename: "AK-47 | Slate"
  }]);
  assert.equal(result.detailStats.wear_rows_ok, 1);
  assert.equal(row.minfloat, 0);
  assert.equal(row.maxfloat, 0.7);
  assert.equal(row.wear_range, 0.7);
  assert.equal(row.buffid, "new-buff");
  assert.equal(row.c5id, "new-c5");
}

async function test_syncSkinDb_preserves_existing_wear_range_when_refresh_provider_fails() {
  const {dbPath, db} = createTempSkinDb();
  db.exec(`
    INSERT INTO skin (
      markethashname, name, basemarkethashname, basename, collection, rarity,
      wearlevel, minfloat, maxfloat, isstattrak, buffid, c5id, wear_range
    ) VALUES (
      'AK-47 | Slate (Field-Tested)',
      'AK-47 | Slate (Field-Tested)',
      'AK-47 | Slate',
      'AK-47 | Slate',
      'Snakebite Case',
      '受限',
      'Field-Tested',
      0.07,
      0.8,
      0,
      'old-buff',
      'old-c5',
      0.73
    )
  `);
  db.close();

  const result = await syncSkinDb({
    dbPath,
    items: [
      {
        name: "AK-47 | Slate (久经沙场)",
        marketHashName: "AK-47 | Slate (Field-Tested)",
        platformList: [
          {name: "BUFF", itemId: "new-buff"},
          {name: "C5", itemId: "new-c5"}
        ]
      }
    ],
    detailProvider: {
      async fetchByGoodsId() {
        throw new Error("detail metadata should already be complete");
      },
      async fetchWearRangeByGoodsId() {
        throw new Error("wear provider down");
      }
    }
  });

  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const row = verify.prepare(`
    SELECT minfloat, maxfloat, wear_range, buffid, c5id
    FROM skin
    WHERE markethashname = ?
  `).get("AK-47 | Slate (Field-Tested)");
  verify.close();

  assert.equal(result.detailStats.wear_rows_failed, 1);
  assert.equal(row.minfloat, 0.07);
  assert.equal(row.maxfloat, 0.8);
  assert.equal(row.wear_range, 0.73);
  assert.equal(row.buffid, "new-buff");
  assert.equal(row.c5id, "new-c5");
}

async function test_syncSkinDb_refreshes_wear_range_when_platform_list_only_has_c5() {
  const {dbPath, db} = createTempSkinDb();
  db.close();

  const wearCalls = [];
  const result = await syncSkinDb({
    dbPath,
    items: [
      {
        name: "XM1014 | 跑跑跑 (略有磨损)",
        marketHashName: "XM1014 | Run Run Run (Minimal Wear)",
        platformList: [{name: "C5", itemId: "c5-only"}]
      }
    ],
    detailProvider: {
      async fetchByGoodsId() {
        throw new Error("detail metadata should not be called without BUFF id");
      },
      async fetchWearRangeByGoodsId(goodsId, options = {}) {
        wearCalls.push({
          goodsId: String(goodsId),
          c5id: String(options.c5id || ""),
          basename: String(options.basename || "")
        });
        return {
          minfloat: 0.07,
          maxfloat: 0.15,
          wear_range: 0.08
        };
      }
    }
  });

  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const row = verify.prepare(`
    SELECT minfloat, maxfloat, wear_range, buffid, c5id
    FROM skin
    WHERE markethashname = ?
  `).get("XM1014 | Run Run Run (Minimal Wear)");
  verify.close();

  assert.deepEqual(wearCalls, [{
    goodsId: "",
    c5id: "c5-only",
    basename: "XM1014 | 跑跑跑"
  }]);
  assert.equal(result.detailStats.wear_rows_ok, 1);
  assert.equal(row.minfloat, 0.07);
  assert.equal(row.maxfloat, 0.15);
  assert.equal(row.wear_range, 0.08);
  assert.equal(row.buffid, "");
  assert.equal(row.c5id, "c5-only");
}

async function test_syncSkinDb_enriches_images_for_inventory_display_only_rows() {
  const {dbPath, db} = createTempSkinDb();
  db.close();

  const result = await syncSkinDb({
    dbPath,
    items: [
      {
        name: "印花 | 斯塔比鱼（迈阿密）",
        marketHashName: "Sticker | Miami Stabbyfish",
        platformList: [{name: "BUFF", itemId: "1201"}]
      }
    ],
    detailProvider: {
      async fetchByGoodsId() {
        throw new Error("display_only_rows_should_not_fetch_detail");
      },
      async fetchGoodsImageByGoodsId(goodsId) {
        assert.equal(String(goodsId), "1201");
        return {
          goods_icon_url: "https://img.example/miami/icon.webp",
          goods_original_icon_url: "https://img.example/miami/original.webp",
          goods_share_thumbnail_url: "https://img.example/miami/share.webp"
        };
      }
    }
  });

  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const row = verify.prepare(`
    SELECT name, inventory_display_only, goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url
    FROM skin
    WHERE markethashname = ?
  `).get("Sticker | Miami Stabbyfish");
  verify.close();

  assert.equal(result.importedItems, 1);
  assert.equal(result.detailStats.families_pending, 0);
  assert.equal(result.detailStats.image_rows_ok, 1);
  assert.equal(row.name, "印花 | 斯塔比鱼（迈阿密）");
  assert.equal(Number(row.inventory_display_only || 0), 1);
  assert.equal(row.goods_icon_url, "https://img.example/miami/icon.webp");
  assert.equal(row.goods_original_icon_url, "https://img.example/miami/original.webp");
  assert.equal(row.goods_share_thumbnail_url, "https://img.example/miami/share.webp");
}

async function test_syncSkinDb_handles_large_import_without_sql_variable_overflow() {
  const {dbPath, db} = createTempSkinDb();
  db.close();

  const items = Array.from({length: 34000}, (_, index) => ({
    name: `AK-47 | 批量物品 ${index} (久经沙场)`,
    marketHashName: `AK-47 | Bulk Item ${index} (Field-Tested)`,
    platformList: [{name: "BUFF", itemId: String(3000 + index)}]
  }));

  const result = await syncSkinDb({
    dbPath,
    items
  });

  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const countRow = verify.prepare("SELECT COUNT(*) AS count FROM skin").get();
  verify.close();

  assert.equal(result.importedItems, 34000);
  assert.equal(Number(countRow.count || 0), 34000);
}

async function test_syncSkinDb_creates_skin_table_for_empty_db_path() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-skin-db-empty-"));
  const dbPath = path.join(tempDir, "skins.db");

  const result = await syncSkinDb({
    dbPath,
    items: [
      {
        name: "AK-47 | 红线 (久经沙场)",
        marketHashName: "AK-47 | Redline (Field-Tested)",
        platformList: [{name: "BUFF", itemId: "1001"}]
      }
    ]
  });

  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const columns = new Set(
    verify.prepare("PRAGMA table_info(skin)").all().map((row) => String(row.name || "").trim())
  );
  const row = verify.prepare(`
    SELECT markethashname, buffid, goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url
    FROM skin
    WHERE markethashname = ?
  `).get("AK-47 | Redline (Field-Tested)");
  verify.close();

  assert.equal(result.importedItems, 1);
  assert.equal(columns.has("detail_status"), true);
  assert.equal(columns.has("detail_source"), true);
  assert.equal(columns.has("detail_checked_at"), true);
  assert.equal(columns.has("detail_error"), true);
  assert.equal(columns.has("detail_attempts"), true);
  assert.equal(columns.has("goods_icon_url"), true);
  assert.equal(columns.has("goods_original_icon_url"), true);
  assert.equal(columns.has("goods_share_thumbnail_url"), true);
  assert.equal(row.markethashname, "AK-47 | Redline (Field-Tested)");
  assert.equal(row.buffid, "1001");
  assert.equal(row.goods_icon_url, "");
  assert.equal(row.goods_original_icon_url, "");
  assert.equal(row.goods_share_thumbnail_url, "");
}

async function test_syncSkinDb_creates_price_columns_for_empty_db_path() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-skin-db-price-"));
  const dbPath = path.join(tempDir, "skins.db");

  await syncSkinDb({
    dbPath,
    items: [
      {
        name: "M4A1-S | 澎湃之力 (崭新出厂)",
        marketHashName: "M4A1-S | Hyper Beast (Factory New)",
        platformList: [{name: "BUFF", itemId: "1101"}]
      }
    ]
  });

  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const columns = new Set(
    verify.prepare("PRAGMA table_info(skin)").all().map((row) => String(row.name || "").trim())
  );
  const row = verify.prepare(`
    SELECT buffprice, c5price, youpinprice, buffprice_updated_at, c5price_updated_at, youpinprice_updated_at
    FROM skin
    WHERE markethashname = ?
  `).get("M4A1-S | Hyper Beast (Factory New)");
  verify.close();

  assert.equal(columns.has("buffprice"), true);
  assert.equal(columns.has("c5price"), true);
  assert.equal(columns.has("youpinprice"), true);
  assert.equal(columns.has("buffprice_updated_at"), true);
  assert.equal(columns.has("c5price_updated_at"), true);
  assert.equal(columns.has("youpinprice_updated_at"), true);
  assert.equal(row.buffprice, null);
  assert.equal(row.c5price, null);
  assert.equal(row.youpinprice, null);
  assert.equal(row.buffprice_updated_at, null);
  assert.equal(row.c5price_updated_at, null);
  assert.equal(row.youpinprice_updated_at, null);
}

function test_defaultSteamBaseInfoDirectory_isProjectLocal() {
  assert.equal(
    DEFAULT_JSON_DIR,
    path.resolve(__dirname, "..", "data")
  );
}

function test_findLatestSteamBaseInfoJson_rejectsEmptyDirectoryWithoutFallback() {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "steam-base-info-empty-"));
  assert.throws(
    () => findLatestSteamBaseInfoJson(emptyDir),
    (error) => {
      assert.match(error.message, /steamdt_base_info_json_not_found/);
      assert.match(error.message, /fetchAndRebuildSkinDb\.js/);
      assert.match(error.message, /--json/);
      return true;
    }
  );
}

function test_buildCliOptions_acceptsExplicitSteamdtSnapshotWithoutDefaultSnapshot() {
  const explicitJsonPath = path.join(os.tmpdir(), "steam_base_info_manual.json");
  const options = buildCliOptions(["--json", explicitJsonPath]);
  assert.equal(options.jsonPath, explicitJsonPath);
}

async function runTests() {
  test_defaultSteamBaseInfoDirectory_isProjectLocal();
  test_findLatestSteamBaseInfoJson_rejectsEmptyDirectoryWithoutFallback();
  test_buildCliOptions_acceptsExplicitSteamdtSnapshotWithoutDefaultSnapshot();
  assert.equal(isImportableSkin({marketHashName: "AK-47 | Redline (Field-Tested)"}), true);
  assert.equal(isImportableSkin({marketHashName: "StatTrak™ AK-47 | Redline (Field-Tested)"}), true);
  assert.equal(isImportableSkin({marketHashName: "★ Bayonet | Autotronic (Factory New)"}), true);
  assert.equal(isImportableSkin({marketHashName: "★ StatTrak™ Bayonet | Autotronic (Factory New)"}), true);
  assert.equal(isImportableSkin({marketHashName: "★ Specialist Gloves | Field Agent (Field-Tested)"}), true);
  assert.equal(isImportableSkin({marketHashName: "Autograph Capsule | Virtus.Pro | Cologne 2015"}), false);
  assert.equal(isImportableSkin({marketHashName: "StatTrak™ Music Kit | Sasha, LNOE"}), false);
  assert.equal(isImportableSkin({marketHashName: "Sticker Slab | Agent Select"}), false);
  assert.equal(isImportableSkin({marketHashName: "Special Agent Ava | FBI"}), false);
  assert.equal(isImportableSkin({marketHashName: "★ Butterfly Knife"}), false);
  assert.equal(isImportableSkin({marketHashName: "Souvenir Glock-18 | Groundwater (Factory New)"}), true);
  assert.equal(isImportableSkin({marketHashName: "Souvenir Charm | Austin 2025 Highlight | 1 Bullet"}), false);

  const alchemy = assignAlchemyTypes(
    [
      {collection: "伽玛武器箱", rarity: "隐秘"},
      {collection: "伽玛 2 号武器箱", rarity: "隐秘"},
      {collection: "Gamma Case / Gamma 2 Case", rarity: "金"}
    ],
    {rarityOrder: ["军规级", "受限", "保密", "隐秘", "金"]}
  );
  assert.equal(alchemy[0].alchemy_type, "5合1材料");
  assert.equal(alchemy[1].alchemy_type, "5合1材料");
  assert.equal(alchemy[2].alchemy_type, "不能炼金");

  const {dbPath, db} = createTempSkinDb();
  db.exec(`
    INSERT INTO skin (markethashname, name, basemarkethashname, basename, collection, rarity, wearlevel, isstattrak, buffid)
    VALUES
      ('Autograph Capsule | Virtus.Pro | Cologne 2015', 'Autograph Capsule | Virtus.Pro | Cologne 2015', 'Autograph Capsule | Virtus.Pro | Cologne 2015', 'Autograph Capsule | Virtus.Pro | Cologne 2015', '', '', 'Unknown', 0, '1'),
      ('StatTrak™ Music Kit | Sasha, LNOE', 'StatTrak™ 音乐盒 | Sasha - 地球末夜', 'StatTrak™ Music Kit | Sasha, LNOE', 'StatTrak™ 音乐盒 | Sasha - 地球末夜', '', '', 'Unknown', 0, '2'),
      ('Special Agent Ava | FBI', '爱娃特工 | 联邦调查局（FBI）', 'Special Agent Ava | FBI', '爱娃特工 | 联邦调查局（FBI）', '', '', 'Unknown', 0, '3'),
      ('★ Butterfly Knife', '蝴蝶刀（★）', '★ Butterfly Knife', '蝴蝶刀（★）', '', '', 'Unknown', 0, '4'),
      ('Glock-18 | Groundwater (Factory New)', 'Glock-18 | Groundwater (Factory New)', 'Glock-18 | Groundwater', 'Glock-18 | Groundwater', 'The Dust 2 Collection', '军规级', 'Factory New', 0, '5'),
      ('Desert Eagle | Blaze (Factory New)', 'Desert Eagle | Blaze (Factory New)', 'Desert Eagle | Blaze', 'Desert Eagle | Blaze', 'The Dust 2 Collection', '受限', 'Factory New', 0, '6')
  `);
  db.close();

  await syncSkinDb({
    dbPath,
    items: [
      {
        name: "AK-47 | 红线 (久经沙场)",
        marketHashName: "AK-47 | Redline (Field-Tested)",
        platformList: [{name: "BUFF", itemId: "100"}]
      },
      {
        name: "刺刀（★） | 自动化 (崭新出厂)",
        marketHashName: "★ Bayonet | Autotronic (Factory New)",
        platformList: [{name: "BUFF", itemId: "101"}]
      },
      {
        name: "纪念品 Glock-18 | 地下水 (崭新出厂)",
        marketHashName: "Souvenir Glock-18 | Groundwater (Factory New)",
        platformList: [{name: "BUFF", itemId: "104"}]
      },
      {
        name: "Souvenir Charm | Austin 2025 Highlight | 1 Bullet",
        marketHashName: "Souvenir Charm | Austin 2025 Highlight | 1 Bullet",
        platformList: [{name: "BUFF", itemId: "106"}]
      },
      {
        name: "Desert Eagle | Blaze (Factory New)",
        marketHashName: "Desert Eagle | Blaze (Factory New)",
        platformList: [{name: "BUFF", itemId: "105"}]
      },
      {
        name: "Special Agent Ava | FBI",
        marketHashName: "Special Agent Ava | FBI",
        platformList: [{name: "BUFF", itemId: "102"}]
      },
      {
        name: "Autograph Capsule | Virtus.Pro | Cologne 2015",
        marketHashName: "Autograph Capsule | Virtus.Pro | Cologne 2015",
        platformList: [{name: "BUFF", itemId: "103"}]
      }
    ]
  });

  const verify = new DatabaseSync(dbPath, {open: true, readOnly: true});
  const rows = verify.prepare(`
    SELECT markethashname, inventory_display_only, alchemy_type
    FROM skin
    ORDER BY markethashname
  `).all();
  const columns = verify.prepare("PRAGMA table_info(skin)").all().map((row) => row.name);
  verify.close();

  assert.deepEqual(
    rows.map((row) => ({
      markethashname: row.markethashname,
      inventory_display_only: Number(row.inventory_display_only || 0)
    })),
    [
      {
        markethashname: "AK-47 | Redline (Field-Tested)",
        inventory_display_only: 0
      },
      {
        markethashname: "Autograph Capsule | Virtus.Pro | Cologne 2015",
        inventory_display_only: 1
      },
      {
        markethashname: "Desert Eagle | Blaze (Factory New)",
        inventory_display_only: 0
      },
      {
        markethashname: "Souvenir Charm | Austin 2025 Highlight | 1 Bullet",
        inventory_display_only: 1
      },
      {
        markethashname: "Souvenir Glock-18 | Groundwater (Factory New)",
        inventory_display_only: 0
      },
      {
        markethashname: "Special Agent Ava | FBI",
        inventory_display_only: 1
      },
      {
        markethashname: "★ Bayonet | Autotronic (Factory New)",
        inventory_display_only: 0
      }
    ]
  );
  const souvenirRow = rows.find((row) => row.markethashname === "Souvenir Glock-18 | Groundwater (Factory New)");
  assert.equal(souvenirRow.alchemy_type, "10合1");
  const souvenirCharmRow = rows.find((row) => row.markethashname === "Souvenir Charm | Austin 2025 Highlight | 1 Bullet");
  assert.equal(souvenirCharmRow.alchemy_type, "不能炼金");
  assert(columns.includes("detail_status"));
  assert(columns.includes("detail_source"));
  assert(columns.includes("detail_checked_at"));
  assert(columns.includes("detail_error"));
  assert(columns.includes("detail_attempts"));
  assert(columns.includes("goods_icon_url"));
  assert(columns.includes("goods_original_icon_url"));
  assert(columns.includes("goods_share_thumbnail_url"));
  assert(columns.includes("inventory_display_only"));

  const {dbPath: familyDbPath, db: familyDb} = createTempSkinDb();
  familyDb.exec(`
    INSERT INTO skin (
      markethashname, name, basemarkethashname, basename, collection, rarity,
      wearlevel, minfloat, maxfloat, isstattrak, wear_range
    )
    VALUES
      (
        '★ Butterfly Knife | Blue Steel (Battle-Scarred)',
        '★ Butterfly Knife | Blue Steel (Battle-Scarred)',
        '★ Butterfly Knife | Blue Steel',
        '★ Butterfly Knife | Blue Steel',
        'Operation Breakout Weapon Case',
        'Gold',
        'Battle-Scarred',
        0.00,
        1.00,
        0,
        1.00
      ),
      (
        '★ StatTrak™ Butterfly Knife | Blue Steel (Factory New)',
        '★ StatTrak™ Butterfly Knife | Blue Steel (Factory New)',
        '★ StatTrak™ Butterfly Knife | Blue Steel',
        '★ StatTrak™ Butterfly Knife | Blue Steel',
        '',
        '',
        'Factory New',
        NULL,
        NULL,
        1,
        NULL
      )
  `);
  familyDb.close();

  await syncSkinDb({
    dbPath: familyDbPath,
    items: [
      {
        name: "★ Butterfly Knife | Blue Steel (Battle-Scarred)",
        marketHashName: "★ Butterfly Knife | Blue Steel (Battle-Scarred)",
        platformList: [{name: "BUFF", itemId: "201"}]
      },
      {
        name: "★ StatTrak™ Butterfly Knife | Blue Steel (Factory New)",
        marketHashName: "★ StatTrak™ Butterfly Knife | Blue Steel (Factory New)",
        platformList: [{name: "BUFF", itemId: "202"}]
      }
    ],
    rarityOrder: ["Restricted", "Covert", "Gold"]
  });

  const familyVerify = new DatabaseSync(familyDbPath, {open: true, readOnly: true});
  const familyRow = familyVerify.prepare(`
    SELECT collection, rarity, minfloat, maxfloat, wear_range
    FROM skin
    WHERE markethashname = ?
  `).get("★ StatTrak™ Butterfly Knife | Blue Steel (Factory New)");
  familyVerify.close();

  assert.equal(familyRow.collection, "Operation Breakout Weapon Case");
  assert.equal(familyRow.rarity, "Gold");
  assert.equal(familyRow.minfloat, 0);
  assert.equal(familyRow.maxfloat, 1);
  assert.equal(familyRow.wear_range, 1);

  const latestDir = fs.mkdtempSync(path.join(os.tmpdir(), "steam-base-info-"));
  fs.writeFileSync(path.join(latestDir, "steam_base_info_20260315_232059.json"), "[]", "utf8");
  fs.writeFileSync(path.join(latestDir, "steam_base_info_20260318_101010.json"), "[]", "utf8");
  assert.equal(
    path.basename(findLatestSteamBaseInfoJson(latestDir)),
    "steam_base_info_20260318_101010.json"
  );
  assert.equal(fs.existsSync(path.join(path.dirname(dbPath), "steam_skins.db")), false);

  const {dbPath: imageDbPath, db: imageDb} = createTempSkinDb();
  imageDb.exec(`
    ALTER TABLE skin ADD COLUMN goods_icon_url TEXT DEFAULT '';
    ALTER TABLE skin ADD COLUMN goods_original_icon_url TEXT DEFAULT '';
    ALTER TABLE skin ADD COLUMN goods_share_thumbnail_url TEXT DEFAULT '';
    INSERT INTO skin (
      markethashname, name, basemarkethashname, basename, collection, rarity,
      wearlevel, isstattrak, buffid, goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url
    ) VALUES (
      'AK-47 | Redline (Field-Tested)',
      'AK-47 | 红线 (久经沙场)',
      'AK-47 | Redline',
      'AK-47 | 红线',
      'Operation Phoenix Weapon Case',
      '保密',
      'Field-Tested',
      0,
      '9001',
      'https://img.example/icon.webp',
      'https://img.example/original.webp',
      'https://img.example/share.webp'
    )
  `);
  imageDb.close();

  await syncSkinDb({
    dbPath: imageDbPath,
    items: [
      {
        name: "StatTrak™ AK-47 | 红线 (崭新出厂)",
        marketHashName: "StatTrak™ AK-47 | Redline (Factory New)",
        platformList: [{name: "BUFF", itemId: "9002"}]
      }
    ]
  });

  const imageVerify = new DatabaseSync(imageDbPath, {open: true, readOnly: true});
  const imageRow = imageVerify.prepare(`
    SELECT goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url
    FROM skin
    WHERE markethashname = ?
  `).get("StatTrak™ AK-47 | Redline (Factory New)");
  imageVerify.close();

  assert.equal(imageRow.goods_icon_url, "https://img.example/icon.webp");
  assert.equal(imageRow.goods_original_icon_url, "https://img.example/original.webp");
  assert.equal(imageRow.goods_share_thumbnail_url, "https://img.example/share.webp");

  await test_syncSkinDb_enriches_pending_rows_after_base_commit();
  await test_syncSkinDb_keeps_base_rows_when_enrichment_fails();
  await test_syncSkinDb_enriches_missing_wear_range_after_base_commit();
  await test_syncSkinDb_refreshes_existing_wear_range_during_update();
  await test_syncSkinDb_preserves_existing_wear_range_when_refresh_provider_fails();
  await test_syncSkinDb_refreshes_wear_range_when_platform_list_only_has_c5();
  await test_syncSkinDb_enriches_images_for_inventory_display_only_rows();
  await test_syncSkinDb_handles_large_import_without_sql_variable_overflow();
  await test_syncSkinDb_creates_skin_table_for_empty_db_path();
  await test_syncSkinDb_creates_price_columns_for_empty_db_path();
}

(async () => {
  await runTests();
  console.log("skinDbSync tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
