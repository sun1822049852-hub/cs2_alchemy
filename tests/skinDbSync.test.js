const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {DatabaseSync} = require("node:sqlite");

const {
  isImportableSkin,
  syncSkinDb,
  assignAlchemyTypes,
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

function runTests() {
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
  assert.equal(isImportableSkin({marketHashName: "Souvenir Glock-18 | Groundwater (Factory New)"}), false);

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
      ('★ Butterfly Knife', '蝴蝶刀（★）', '★ Butterfly Knife', '蝴蝶刀（★）', '', '', 'Unknown', 0, '4')
  `);
  db.close();

  syncSkinDb({
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
  const rows = verify.prepare("SELECT markethashname FROM skin ORDER BY markethashname").all();
  verify.close();

  assert.deepEqual(
    rows.map((row) => row.markethashname),
    [
      "AK-47 | Redline (Field-Tested)",
      "★ Bayonet | Autotronic (Factory New)"
    ]
  );

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

  syncSkinDb({
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
}

runTests();
console.log("skinDbSync tests passed");
