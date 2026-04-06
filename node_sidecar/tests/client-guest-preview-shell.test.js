const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const HTML = fs.readFileSync(path.resolve(__dirname, "../ui/index.html"), "utf8");
const JS = fs.readFileSync(path.resolve(__dirname, "../ui/app.js"), "utf8");

function test_guest_workspace_shell_exists() {
  assert.match(HTML, /id="guestWorkspaceNotice"/);
  assert.match(HTML, /id="guestWorkspaceNoticeText"/);
  assert.match(HTML, /id="guestWorkspaceLoginBtn"/);
}

function test_app_js_restores_guest_preview_wiring() {
  assert.match(JS, /applyGuestWorkspacePreview/);
  assert.match(JS, /renderGuestWorkspaceNotice/);
  assert.match(JS, /openClientAuthModal/);
  assert.match(JS, /workspaceAccessGuard/);
  assert.match(JS, /guestPreviewProvider/);
  assert.doesNotMatch(JS, /window\.location\.reload\(\)/);
}

function test_restricted_actions_are_guarded_in_guest_mode() {
  assert.match(JS, /async function loginAndSave\(\)\s*{[\s\S]*?guardGuestAction\(/);
  assert.match(JS, /function addCurrentSelectionToCraftQueue\(\)\s*{[\s\S]*?guardGuestAction\(/);
  assert.match(JS, /function clearCraftQueue\(\)\s*{[\s\S]*?guardGuestAction\(/);
  assert.match(JS, /async function saveActiveTradeupSimulationPreset\(\)\s*{[\s\S]*?guardGuestAction\(/);
  assert.match(JS, /async function searchTradeupSimulationItems\(query\)\s*{[\s\S]*?guardGuestAction\(/);
  assert.match(JS, /function openTradeupSimulationRoleSlotPicker\(slotName\)\s*{[\s\S]*?guardGuestAction\(/);
  assert.match(JS, /async function resolveTradeupSimulationPreset\(presetId\)\s*{[\s\S]*?guardGuestAction\(/);
  assert.match(JS, /async function runCraftTradeUpQueue\(\)\s*{[\s\S]*?guardGuestAction\(/);
  assert.match(JS, /async function runComponentMove\(action, itemIds, componentIdOverride = \"\"\)\s*{[\s\S]*?guardGuestAction\(/);
  assert.match(JS, /async function disconnectCurrentSession\(\{usernameOverride = \"\"\} = \{\}\)\s*{[\s\S]*?guardGuestAction\(/);
}

function test_guest_shell_controls_open_and_close_login_modal() {
  assert.match(JS, /guestWorkspaceLoginBtn[\s\S]*openClientAuthModal/);
  assert.match(JS, /clientAuthModalCloseBtn[\s\S]*closeClientAuthModal/);
}

function test_guest_notice_copy_is_stable() {
  const blockMatch = JS.match(/function getGuestWorkspaceNoticeMessage\(\)\s*{[\s\S]*?^}/m);
  assert.ok(blockMatch, "missing getGuestWorkspaceNoticeMessage");
  const block = blockMatch[0];
  assert.doesNotMatch(block, /clientAuthModalOpen/);
  assert.doesNotMatch(block, /clientAuthPromptHint/);
}

function main() {
  test_guest_workspace_shell_exists();
  test_app_js_restores_guest_preview_wiring();
  test_restricted_actions_are_guarded_in_guest_mode();
  test_guest_shell_controls_open_and_close_login_modal();
  test_guest_notice_copy_is_stable();
  console.log("client-guest-preview-shell tests passed");
}

main();
