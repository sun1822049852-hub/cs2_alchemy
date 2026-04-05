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

function main() {
  test_last_selected_and_presets_are_scoped_by_app_user();
  console.log("ui-state-store-auth-scope tests passed");
}

main();
