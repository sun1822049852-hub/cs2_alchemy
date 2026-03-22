const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

function loadDisplayAccountName() {
  const source = extractBlock("function displayAccountName(", "function optionAccountLabel(");
  const context = {String};
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context.displayAccountName;
}

function testDisplayAccountNameAppendsRemarkAfterSteamName() {
  const displayAccountName = loadDisplayAccountName();
  assert.equal(
    displayAccountName({username: "alice", steam_name: "AliceSteam", remark: "主号"}),
    "AliceSteam（主号）"
  );
}

function testDisplayAccountNameAppendsRemarkAfterUsernameWhenNoSteamName() {
  const displayAccountName = loadDisplayAccountName();
  assert.equal(
    displayAccountName({username: "alice", steam_name: "", remark: "主号"}),
    "alice（主号）"
  );
}

function testDisplayAccountNameAvoidsDuplicateRemark() {
  const displayAccountName = loadDisplayAccountName();
  assert.equal(
    displayAccountName({username: "alice", steam_name: "AliceSteam", remark: "alice"}),
    "AliceSteam"
  );
  assert.equal(
    displayAccountName({username: "alice", steam_name: "", remark: "alice"}),
    "alice"
  );
}

function testSavedAccountCardSourceUsesDisplayNameAndNoSetCurrentButton() {
  const renderSource = extractBlock("function renderSavedAccounts(", "async function persistLastSelected(");
  assert.equal(
    renderSource.includes("const displayName = displayAccountName(row) || accountName || \"-\";"),
    true,
    "saved account cards should use the shared displayAccountName formatter"
  );
  assert.equal(
    renderSource.includes("设为当前"),
    false,
    "saved account cards should not render the set-current button anymore"
  );
}

function main() {
  testDisplayAccountNameAppendsRemarkAfterSteamName();
  testDisplayAccountNameAppendsRemarkAfterUsernameWhenNoSteamName();
  testDisplayAccountNameAvoidsDuplicateRemark();
  testSavedAccountCardSourceUsesDisplayNameAndNoSetCurrentButton();
  console.log("account-card-render tests passed");
}

main();
