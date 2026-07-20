const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const HTML_PATH = path.resolve(__dirname, "../ui/index.html");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");
const HTML_SOURCE = fs.readFileSync(HTML_PATH, "utf8");

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

function loadPreflightPartitioner() {
  const source = extractBlock(
    "function partitionBatchImportPreflightItems(",
    "function groupBatchImportResolutionItems("
  );
  const context = {String};
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context.partitionBatchImportPreflightItems;
}

function loadResolutionGrouper() {
  const source = extractBlock(
    "function groupBatchImportResolutionItems(",
    "function batchImportPasswordForFile("
  );
  const context = {Array, Map, String};
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context.groupBatchImportResolutionItems;
}

function loadFinishedClientIdCollector() {
  const source = extractBlock(
    "function collectBatchImportFinishedClientIds(",
    "async function overwriteSelectedBatchImportDuplicates("
  );
  const context = {Set};
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context.collectBatchImportFinishedClientIds;
}

function loadPreflightCompleter() {
  const source = extractBlock(
    "function completeBatchImportPreflightItems(",
    "function partitionBatchImportPreflightItems("
  );
  const context = {Array, Map, String};
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context.completeBatchImportPreflightItems;
}

function testPreflightPartitionsImmediateResolutionAndInvalidRows() {
  const partition = loadPreflightPartitioner();
  const result = partition([
    {client_id: "a", status: "ready", target_action: "create", account_name: "alice"},
    {client_id: "b", status: "password_confirmation_required", target_action: "attach", account_name: "bob", password_differs: true},
    {client_id: "c", status: "duplicate_existing", target_action: "overwrite", account_name: "carol"},
    {client_id: "d", status: "selection_required", target_action: "create", account_name: "dave"},
    {client_id: "d", status: "invalid", account_name: ""}
  ]);

  assert.deepEqual(Array.from(result.ready, (row) => row.client_id), ["a"]);
  assert.deepEqual(Array.from(result.resolution, (row) => row.client_id), ["b", "c", "d"]);
  assert.equal(result.blocking.length, 1);
}

function testResolutionGroupsKeepOneAccountWithMultipleFileCandidates() {
  const group = loadResolutionGrouper();
  const groups = group([
    {client_id: "a", file_name: "a.maFile", status: "selection_required", account_name: "same", target_action: "overwrite", existing_has_steam_guard: true},
    {client_id: "b", file_name: "b.maFile", status: "selection_required", account_name: "same", target_action: "overwrite", existing_has_steam_guard: true},
    {client_id: "c", file_name: "c.maFile", status: "duplicate_existing", account_name: "other", target_action: "overwrite", existing_has_steam_guard: true}
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(Array.from(groups[0].candidates, (row) => row.client_id), ["a", "b"]);
  assert.equal(groups[0].account_name, "same");
  assert.equal(groups[0].target_action, "overwrite");
  assert.equal(groups[0].existing_has_steam_guard, true);
  assert.deepEqual(Array.from(groups[1].candidates, (row) => row.client_id), ["c"]);
}

function testFailedResolutionGroupKeepsEveryCandidateForRetry() {
  const collect = loadFinishedClientIdCollector();
  const skippedGroups = [{candidates: [{client_id: "skip-a"}, {client_id: "skip-b"}]}];
  const selected = [
    {candidate: {client_id: "success-a"}, group: {candidates: [{client_id: "success-a"}, {client_id: "success-b"}]}},
    {candidate: {client_id: "failed-a"}, group: {candidates: [{client_id: "failed-a"}, {client_id: "failed-b"}]}}
  ];
  const result = collect(skippedGroups, selected, new Set(["success-a"]));
  assert.deepEqual([...result].sort(), ["skip-a", "skip-b", "success-a", "success-b"].sort());
}

function testMissingPreflightResponseBecomesInvalidInsteadOfDisappearing() {
  const complete = loadPreflightCompleter();
  const items = complete(
    [{clientId: "a", name: "a.maFile"}, {clientId: "b", name: "b.maFile"}],
    [{client_id: "a", file_name: "a.maFile", status: "ready", account_name: "alice"}]
  );
  const missing = Array.from(items).find((row) => row.client_id === "b");
  assert.equal(missing.status, "invalid");
  assert.equal(missing.message, "令牌文件格式错误");
}

function testBlockingRowsDoNotPreventReadyRowsFromBeingSaved() {
  const startSource = extractBlock("async function startBatchImport(", "function makeBatchImportRequestAccount(");
  const blockingStart = startSource.indexOf("if (partition.blocking.length)");
  const importableStart = startSource.indexOf("const importable", blockingStart);
  assert.notEqual(blockingStart, -1);
  assert.notEqual(importableStart, -1);
  assert.doesNotMatch(startSource.slice(blockingStart, importableStart), /return;/);
  assert.match(startSource, /partition\.ready\.map/);
}

function testMissingPasswordDoesNotBlockAnyImport() {
  const source = extractBlock("async function startBatchImport(", "function makeBatchImportRequestAccount(");
  assert.doesNotMatch(source, /missingPassword/);
  assert.doesNotMatch(source, /以下账号缺少密码/);
}

function testResolutionWindowUsesPerAccountRadioAndExplicitOverwriteConfirmation() {
  assert.match(HTML_SOURCE, /id="batchImportDuplicateModal"/);
  assert.match(HTML_SOURCE, /id="batchImportDuplicateList"/);
  assert.match(HTML_SOURCE, /id="batchImportDuplicateOverwriteBtn"/);
  assert.doesNotMatch(HTML_SOURCE, /id="batchImportDuplicateSelectAll"/);
  assert.match(HTML_SOURCE, /选择令牌文件/);
  assert.match(APP_SOURCE, /selectedClientIdByAccount:\s*new Map\(\)/);
  assert.match(APP_SOURCE, /confirmedOverwriteAccounts:\s*new Set\(\)/);
  assert.match(APP_SOURCE, /candidateInput\.type = "radio"/);
  assert.match(APP_SOURCE, /确认覆盖已有令牌/);
  assert.match(APP_SOURCE, /处理已选择账号（\$\{selectedCount\}）/);
  const openSource = extractBlock("function openBatchImportDuplicateModal(", "function renderBatchImportDuplicateList(");
  assert.match(openSource, /getElementById\(["']batchImportDuplicateStatus["']\)/);
  assert.match(openSource, /statusEl\.textContent\s*=\s*["']["']/);
}

function testFrontendUsesPreflightThenSendsExplicitOverwriteDecision() {
  assert.match(APP_SOURCE, /\/api\/accounts\/batch-import\/preflight/);
  assert.match(APP_SOURCE, /overwrite:\s*false/);
  assert.match(APP_SOURCE, /overwrite:\s*true/);
  assert.match(APP_SOURCE, /target_action/);
  assert.match(APP_SOURCE, /selection_required/);
  assert.match(APP_SOURCE, /status === "attached"/);
  assert.match(APP_SOURCE, /password_confirmation_required/);
  assert.match(APP_SOURCE, /password_action/);
  assert.match(APP_SOURCE, /duplicate_confirmation_required/);
  assert.match(APP_SOURCE, /duplicate_existing/);
  assert.doesNotMatch(APP_SOURCE, /parsed\.account_name\s*\|\|\s*file\.name/);
}

function testDifferingImportedPasswordIsShownAndRequiresExplicitPerAccountDecision() {
  assert.match(APP_SOURCE, /overwritePasswordAccounts:\s*new Set\(\)/);
  const renderSource = extractBlock(
    "function renderBatchImportDuplicateList(",
    "function finishBatchImportDuplicateStep("
  );
  assert.match(renderSource, /password_differs/);
  assert.match(renderSource, /batch-import-resolution-password/);
  assert.match(renderSource, /type = "text"/);
  assert.match(renderSource, /readOnly = true/);
  assert.match(renderSource, /selectedCandidate\.file\.password/);
  assert.match(renderSource, /使用导入密码覆盖本地密码/);
  assert.match(renderSource, /overwritePasswordAccounts/);
  const submitSource = extractBlock(
    "async function overwriteSelectedBatchImportDuplicates(",
    "// ═══════════════════════════════════════════════════════════════════════════"
  );
  assert.match(submitSource, /password_action:[\s\S]*\? "overwrite" : "discard"/);
}

function testPreflightSendsImportedPasswordOnlyForServerSideDifferenceCheck() {
  const source = extractBlock("async function startBatchImport(", "function makeBatchImportRequestAccount(");
  const preflightBody = source.slice(source.indexOf("/api/accounts/batch-import/preflight"), source.indexOf("const byClientId"));
  assert.match(preflightBody, /password:\s*batchImportPasswordForFile/);
}

function testFileListShowsBothFileNameAndEmbeddedAccountName() {
  const renderSource = extractBlock(
    "function renderBatchImportFileList(",
    "function parseBatchCredentials("
  );
  assert.match(renderSource, /file-name/);
  assert.match(renderSource, /file-account-name/);
  assert.match(renderSource, /f\.name/);
  assert.match(renderSource, /f\.accountName/);
}

function testFileSelectionSnapshotsLiveFileListBeforeAsyncReads() {
  const initSource = extractBlock("function initBatchImport(", "function switchBatchPwdMode(");
  assert.match(initSource, /handleBatchImportFiles\(Array\.from\(fileInput\.files\)\)/);
  assert.match(initSource, /handleBatchImportFiles\(Array\.from\(e\.dataTransfer\.files\)\)/);
}

function testCredentialMatchSummaryDoesNotRenderAccountNamesAsHtml() {
  const source = extractBlock(
    "function renderBatchImportCredentialSummary(",
    "function applyParsedCredentials("
  );
  assert.match(source, /textContent/);
  assert.match(source, /replaceChildren/);
  assert.doesNotMatch(source, /innerHTML/);
}

function testSuccessfulReadyImportsAreRemovedFromPendingFiles() {
  const source = extractBlock("async function startBatchImport(", "function makeBatchImportRequestAccount(");
  assert.match(source, /addedClientIds/);
  assert.match(source, /removeBatchImportFilesByClientIds\(addedClientIds\)/);
}

function testDuplicateCountersOnlySettleAfterOverwriteRequestCompletes() {
  const source = extractBlock(
    "async function overwriteSelectedBatchImportDuplicates(",
    "// ═══════════════════════════════════════════════════════════════════════════"
  );
  const awaitIndex = source.indexOf("await runBatchImportRequest");
  const skippedIndex = source.indexOf("batchImportState.summary.skipped +=");
  const overwrittenIndex = source.indexOf("batchImportState.summary.overwritten +=");
  const attachedIndex = source.indexOf("batchImportState.summary.attached +=");
  assert.notEqual(awaitIndex, -1);
  assert.ok(skippedIndex > awaitIndex, "skipped count must settle only after the request completes");
  assert.ok(overwrittenIndex > awaitIndex, "overwrite count must settle only after the request completes");
  assert.ok(attachedIndex > awaitIndex, "attach count must settle only after the request completes");
}

function testClosingImportModalClearsMafileAndPasswordState() {
  const source = extractBlock("function clearBatchImportSensitiveState(", "function initBatchImport(");
  assert.match(source, /resetBatchImportState\(\)/);
  assert.match(source, /batchImportPasswordInput/);
  assert.match(source, /batchImportPasteArea/);
  assert.match(source, /\.value = ""/);
  const initSource = extractBlock("function initBatchImport(", "function switchBatchPwdMode(");
  assert.match(initSource, /closeBatchImportModal/);
  assert.match(initSource, /clearBatchImportSensitiveState\(\)/);
}

function main() {
  testPreflightPartitionsImmediateResolutionAndInvalidRows();
  testResolutionGroupsKeepOneAccountWithMultipleFileCandidates();
  testFailedResolutionGroupKeepsEveryCandidateForRetry();
  testMissingPreflightResponseBecomesInvalidInsteadOfDisappearing();
  testBlockingRowsDoNotPreventReadyRowsFromBeingSaved();
  testMissingPasswordDoesNotBlockAnyImport();
  testResolutionWindowUsesPerAccountRadioAndExplicitOverwriteConfirmation();
  testFrontendUsesPreflightThenSendsExplicitOverwriteDecision();
  testDifferingImportedPasswordIsShownAndRequiresExplicitPerAccountDecision();
  testPreflightSendsImportedPasswordOnlyForServerSideDifferenceCheck();
  testFileListShowsBothFileNameAndEmbeddedAccountName();
  testFileSelectionSnapshotsLiveFileListBeforeAsyncReads();
  testCredentialMatchSummaryDoesNotRenderAccountNamesAsHtml();
  testSuccessfulReadyImportsAreRemovedFromPendingFiles();
  testDuplicateCountersOnlySettleAfterOverwriteRequestCompletes();
  testClosingImportModalClearsMafileAndPasswordState();
  console.log("steam-guard-batch-import-ui tests passed");
}

main();
