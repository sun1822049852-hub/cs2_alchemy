const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {UiStateStore} = require("../src/uiStateStore");

function makeTempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-ui-state-"));
  return {
    dir,
    filePath: path.join(dir, "inventory_ui_state.json")
  };
}

function cleanup(ctx) {
  fs.rmSync(ctx.dir, {recursive: true, force: true});
}

function test_last_selected_and_presets_are_scoped_by_app_user() {
  const ctx = makeTempFile();
  try {
    const adminStore = new UiStateStore(ctx.filePath, {viewerUsername: "admin"});
    const memberStore = new UiStateStore(ctx.filePath, {viewerUsername: "member_a"});
    adminStore.setLastSelected("steam_admin");
    memberStore.setLastSelected("steam_member");
    adminStore.setCraftAssistPresets([{id: "preset_admin"}]);
    memberStore.setCraftAssistPresets([{id: "preset_member"}]);
    assert.equal(adminStore.getLastSelected(), "steam_admin");
    assert.equal(memberStore.getLastSelected(), "steam_member");
    assert.deepEqual(adminStore.getCraftAssistPresets(), [{id: "preset_admin"}]);
    assert.deepEqual(memberStore.getCraftAssistPresets(), [{id: "preset_member"}]);
  } finally {
    cleanup(ctx);
  }
}

function test_legacy_top_level_presets_migrate_into_current_viewer_bucket() {
  const ctx = makeTempFile();
  try {
    fs.writeFileSync(ctx.filePath, JSON.stringify({
      accounts: {},
      craft_assist_presets: [{id: "legacy_craft"}],
      tradeup_simulation_presets: [{id: "legacy_trade"}],
      last_selected_username: "legacy_steam"
    }, null, 2));
    const store = new UiStateStore(ctx.filePath, {viewerUsername: "dev_local"});
    assert.deepEqual(store.getCraftAssistPresets(), [{id: "legacy_craft"}]);
    assert.deepEqual(store.getTradeupSimulationPresets(), [{id: "legacy_trade"}]);
    assert.equal(store.getLastSelected(), "legacy_steam");
    store.setLastSelected("migrated_steam");
    const saved = JSON.parse(fs.readFileSync(ctx.filePath, "utf8"));
    assert.deepEqual(saved.app_users.dev_local.craft_assist_presets, [{id: "legacy_craft"}]);
    assert.deepEqual(saved.app_users.dev_local.tradeup_simulation_presets, [{id: "legacy_trade"}]);
    assert.equal(saved.app_users.dev_local.last_selected_username, "migrated_steam");
  } finally {
    cleanup(ctx);
  }
}

function test_missing_viewer_bucket_reads_existing_global_presets() {
  const ctx = makeTempFile();
  try {
    fs.writeFileSync(ctx.filePath, JSON.stringify({
      accounts: {},
      app_users: {
        __global__: {
          craft_assist_presets: [{id: "global_craft"}],
          tradeup_simulation_presets: [{id: "global_trade"}],
          last_selected_username: "global_steam"
        }
      }
    }, null, 2));
    const store = new UiStateStore(ctx.filePath, {viewerUsername: "dev_local"});
    assert.deepEqual(store.getCraftAssistPresets(), [{id: "global_craft"}]);
    assert.deepEqual(store.getTradeupSimulationPresets(), [{id: "global_trade"}]);
    assert.equal(store.getLastSelected(), "global_steam");
  } finally {
    cleanup(ctx);
  }
}

function test_save_creates_backup_before_overwriting_existing_state() {
  const ctx = makeTempFile();
  try {
    const original = {
      accounts: {},
      app_users: {
        dev_local: {
          craft_assist_presets: [{id: "preset_before_save"}],
          tradeup_simulation_presets: [{id: "trade_before_save"}],
          last_selected_username: "steam_before_save"
        }
      }
    };
    fs.writeFileSync(ctx.filePath, JSON.stringify(original, null, 2));
    const store = new UiStateStore(ctx.filePath, {viewerUsername: "dev_local"});
    store.setCraftAssistPresets([{id: "preset_after_save"}]);
    const backupDir = path.join(ctx.dir, "backup", "ui_state");
    const backups = fs.readdirSync(backupDir);
    assert.equal(backups.length, 1);
    const backup = JSON.parse(fs.readFileSync(path.join(backupDir, backups[0]), "utf8"));
    assert.deepEqual(backup, original);
  } finally {
    cleanup(ctx);
  }
}

function main() {
  test_last_selected_and_presets_are_scoped_by_app_user();
  test_legacy_top_level_presets_migrate_into_current_viewer_bucket();
  test_missing_viewer_bucket_reads_existing_global_presets();
  test_save_creates_backup_before_overwriting_existing_state();
  console.log("ui-state-store-auth-scope tests passed");
}

main();
