const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildCliOptions,
  buildSchemaCacheFromApiDir
} = require("../tools/rebuildSchemaCacheFromCsgoApi");

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function createFixtureApiDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-schema-cache-"));
  const apiDir = path.join(tempDir, "public", "api", "en");
  fs.mkdirSync(apiDir, {recursive: true});

  writeJson(path.join(apiDir, "base_weapons.json"), [
    {def_index: "7", name: "AK-47"},
    {def_index: "42", name: "Knife"},
    {def_index: "43", name: "Flashbang"}
  ]);
  writeJson(path.join(apiDir, "skins.json"), [
    {name: "AK-47 | Spruce DDPAT", paint_index: 10010, weapon: {weapon_id: "7", name: "AK-47"}},
    {name: "AUG | Spruce DDPAT", paint_index: 10010, weapon: {weapon_id: "8", name: "AUG"}},
    {name: "Hand Wraps | Cobalt Skulls", paint_index: 10006, weapon: {weapon_id: "5032", name: "Hand Wraps"}},
    {name: "AWP", paint_index: null, weapon: {weapon_id: "9", name: "AWP"}}
  ]);
  writeJson(path.join(apiDir, "crates.json"), [
    {def_index: "1210", name: "Gift Package"},
    {def_index: "4009", name: "Winter Offensive Weapon Case"}
  ]);
  writeJson(path.join(apiDir, "keys.json"), [
    {def_index: "1203", name: "CS:GO Case Key"}
  ]);
  writeJson(path.join(apiDir, "patches.json"), [
    {def_index: "4550", name: "Patch | Crazy Banana"},
    {def_index: "5105", name: "Patch | Movers"}
  ]);
  writeJson(path.join(apiDir, "stickers.json"), [
    {def_index: "1210", name: "Sticker | pyth | MLG Columbus 2016"},
    {def_index: "1203", name: "Sticker | GuardiaN (Gold) | MLG Columbus 2016"},
    {def_index: "4550", name: "Sticker | Crazy Banana"},
    {def_index: "4883", name: "Sticker | Dr. Dazzles"},
    {def_index: "77", name: "Sticker | Virtus.Pro | Katowice 2014"}
  ]);
  writeJson(path.join(apiDir, "keychains.json"), [
    {def_index: "77", name: "Charm | Lil' Yeti"}
  ]);
  writeJson(path.join(apiDir, "collectibles.json"), [
    {def_index: "4550", name: "Operation Shattered Web Challenge Coin"},
    {def_index: "4883", name: "Paris 2023 Viewer Pass"}
  ]);
  writeJson(path.join(apiDir, "agents.json"), [
    {def_index: "5105", name: "Ground Rebel  | Elite Crew"}
  ]);
  writeJson(path.join(apiDir, "music_kits.json"), [
    {def_index: "3", name: "Music Kit | Daniel Sadowski, Crimson Assault"},
    {def_index: "3", name: "StatTrak™ Music Kit | Daniel Sadowski, Crimson Assault"}
  ]);
  writeJson(path.join(apiDir, "graffiti.json"), [
    {def_index: "4009", name: "Sealed Graffiti | OMG (Brick Red)"},
    {def_index: "4009", name: "Sealed Graffiti | OMG (Shark White)"}
  ]);
  writeJson(path.join(apiDir, "tools.json"), [
    {def_index: "1201", name: "Storage Unit"},
    {def_index: "1324", name: "StatTrak™ Swap Tool"}
  ]);

  return {tempDir, apiDir};
}

function test_build_cli_options_uses_safe_defaults() {
  const options = buildCliOptions([]);

  assert.ok(options.sourceDir.startsWith(path.join(path.resolve(__dirname, ".."), ".tmp_upstream")));
  assert.ok(options.baseWeaponsFile.endsWith(".json"));
  assert.ok(options.skinsFile.endsWith(".json"));
  assert.equal(
    options.outputPath,
    path.join(path.resolve(__dirname, ".."), "tmp", "schema_cache.from_csgo_api.json")
  );
}

function test_build_cli_options_accepts_source_output_and_verify_paths() {
  const options = buildCliOptions([
    "--source-dir", "C:\\temp\\api\\en",
    "--base-weapons-file", "C:\\temp\\base_weapons.json",
    "--skins-file", "C:\\temp\\skins.json",
    "--out", "C:\\temp\\schema_cache.generated.json",
    "--verify", "C:\\temp\\schema_cache.json"
  ]);

  assert.equal(options.sourceDir, path.resolve("C:\\temp\\api\\en"));
  assert.equal(options.baseWeaponsFile, path.resolve("C:\\temp\\base_weapons.json"));
  assert.equal(options.skinsFile, path.resolve("C:\\temp\\skins.json"));
  assert.equal(options.outputPath, path.resolve("C:\\temp\\schema_cache.generated.json"));
  assert.equal(options.verifyPath, path.resolve("C:\\temp\\schema_cache.json"));
}

function test_build_schema_cache_from_api_dir_preserves_category_maps_and_stable_flat_names() {
  const {apiDir} = createFixtureApiDir();
  const schema = buildSchemaCacheFromApiDir(apiDir);

  assert.deepEqual(schema.weapons, {
    "7": "AK-47",
    "8": "AUG",
    "9": "AWP",
    "5032": "Hand Wraps"
  });
  assert.deepEqual(schema.paints, {
    "10010": "Spruce DDPAT",
    "10006": "Cobalt Skulls"
  });
  assert.deepEqual(schema.item_defs_by_category, {
    crates: {
      "1210": "Gift Package",
      "4009": "Winter Offensive Weapon Case"
    },
    keys: {
      "1203": "CS:GO Case Key"
    },
    patches: {
      "4550": "Patch | Crazy Banana",
      "5105": "Patch | Movers"
    },
    stickers: {
      "77": "Sticker | Virtus.Pro | Katowice 2014",
      "1203": "Sticker | GuardiaN (Gold) | MLG Columbus 2016",
      "1210": "Sticker | pyth | MLG Columbus 2016",
      "4550": "Sticker | Crazy Banana",
      "4883": "Sticker | Dr. Dazzles"
    },
    keychains: {
      "77": "Charm | Lil' Yeti"
    },
    collectibles: {
      "4550": "Operation Shattered Web Challenge Coin",
      "4883": "Paris 2023 Viewer Pass"
    },
    agents: {
      "5105": "Ground Rebel  | Elite Crew"
    },
    music_kits: {
      "3": "Music Kit | Daniel Sadowski, Crimson Assault"
    },
    graffiti: {
      "4009": "Sealed Graffiti | OMG (Brick Red)"
    },
    tools: {
      "1201": "Storage Unit",
      "1324": "StatTrak™ Swap Tool"
    }
  });
  assert.deepEqual(schema.item_defs, {
    "77": "Charm | Lil' Yeti",
    "3": "Music Kit | Daniel Sadowski, Crimson Assault",
    "1201": "Storage Unit",
    "1203": "CS:GO Case Key",
    "1210": "Gift Package",
    "1324": "StatTrak™ Swap Tool",
    "4009": "Winter Offensive Weapon Case",
    "4550": "Operation Shattered Web Challenge Coin",
    "4883": "Paris 2023 Viewer Pass",
    "5105": "Ground Rebel  | Elite Crew"
  });
}

test_build_cli_options_uses_safe_defaults();
test_build_cli_options_accepts_source_output_and_verify_paths();
test_build_schema_cache_from_api_dir_preserves_category_maps_and_stable_flat_names();

console.log("rebuildSchemaCacheFromCsgoApi tests passed");
