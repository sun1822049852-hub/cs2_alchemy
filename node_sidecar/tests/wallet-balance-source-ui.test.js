const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const JS = fs.readFileSync(path.resolve(__dirname, "../ui/app.js"), "utf8");

function readFunctionSource(name) {
  const marker = `function ${name}(`;
  const start = JS.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const paramsOpen = JS.indexOf("(", start);
  assert.notEqual(paramsOpen, -1, `${name} should have parameters`);
  let parenDepth = 0;
  let paramsEnd = -1;
  let quote = "";
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = paramsOpen; i < JS.length; i += 1) {
    const ch = JS[i];
    const next = JS[i + 1] || "";
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = "";
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") parenDepth += 1;
    if (ch === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        paramsEnd = i;
        break;
      }
    }
  }
  assert.notEqual(paramsEnd, -1, `${name} parameters should be closed`);
  const open = JS.indexOf("{", paramsEnd);
  assert.notEqual(open, -1, `${name} should have a body`);
  let depth = 0;
  quote = "";
  escaped = false;
  inLineComment = false;
  inBlockComment = false;
  for (let i = open; i < JS.length; i += 1) {
    const ch = JS[i];
    const next = JS[i + 1] || "";
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = "";
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return JS.slice(start, i + 1);
    }
  }
  assert.fail(`${name} body was not closed`);
}

function test_merge_account_identity_carries_balance_metadata_only_with_balance() {
  const source = readFunctionSource("mergeAccountIdentity");
  assert.match(source, /balanceSource\s*=\s*""/, "mergeAccountIdentity should accept balanceSource");
  assert.match(source, /balanceCurrency\s*=\s*""/, "mergeAccountIdentity should accept balanceCurrency");
  assert.match(source, /balanceObservedAt\s*=\s*""/, "mergeAccountIdentity should accept balanceObservedAt");
  assert.match(source, /nextBalanceSource/, "mergeAccountIdentity should normalize balance source");
  assert.match(source, /currentBalanceSource/, "mergeAccountIdentity should preserve current balance source");
  assert.match(source, /balance_source/, "mergeAccountIdentity should write balance_source");
  assert.match(source, /balance_currency/, "mergeAccountIdentity should write balance_currency");
  assert.match(source, /balance_observed_at/, "mergeAccountIdentity should write balance_observed_at");
  assert.match(
    source,
    /mergedBalanceSource\s*=\s*nextBalance\s*\?\s*\(nextBalanceSource\s*\|\|\s*currentBalanceSource\)\s*:\s*currentBalanceSource/,
    "balance source metadata must only move forward when a non-empty balance is merged"
  );
  assert.match(
    source,
    /mergedBalanceCurrency\s*=\s*nextBalance\s*\?\s*\(nextBalanceCurrency\s*\|\|\s*currentBalanceCurrency\)\s*:\s*currentBalanceCurrency/,
    "balance currency metadata must only move forward when a non-empty balance is merged"
  );
  assert.match(
    source,
    /mergedBalanceObservedAt\s*=\s*nextBalance\s*\?\s*\(nextBalanceObservedAt\s*\|\|\s*currentBalanceObservedAt\)\s*:\s*currentBalanceObservedAt/,
    "balance observed_at metadata must only move forward when a non-empty balance is merged"
  );
}

function test_profile_hydration_only_merges_wallet_metadata_with_wallet_balance() {
  const source = readFunctionSource("ensureAccountProfile");
  assert.match(source, /const walletBalance\s*=/, "ensureAccountProfile should derive walletBalance once");
  assert.match(source, /balance:\s*walletBalance/, "profile wallet_balance should feed account balance");
  assert.match(
    source,
    /balanceSource:\s*walletBalance\s*\?\s*String\(profile && profile\.wallet_source \|\| ""\)\.trim\(\)\s*:\s*""/,
    "CM wallet_source should only merge when wallet_balance is present"
  );
  assert.match(
    source,
    /balanceCurrency:\s*walletBalance\s*\?\s*String\(profile && profile\.wallet_currency \|\| ""\)\.trim\(\)\s*:\s*""/,
    "CM wallet_currency should only merge when wallet_balance is present"
  );
  assert.match(
    source,
    /balanceObservedAt:\s*walletBalance\s*\?\s*String\(profile && profile\.wallet_observed_at \|\| ""\)\.trim\(\)\s*:\s*""/,
    "CM wallet_observed_at should only merge when wallet_balance is present"
  );
  assert.doesNotMatch(
    source,
    /wallet_source:\s*"steam_store"/,
    "profile hydration must not turn cached Web/Store metadata into CM wallet success"
  );
}

function test_web_inventory_balance_refresh_requires_persisted_source_success() {
  const source = readFunctionSource("webInvFetchBalance");
  assert.match(
    source,
    /if\s*\(\s*r\.success\s*&&\s*r\.persisted\s*===\s*true\s*&&\s*r\.source\s*&&\s*r\.observed_at\s*\)/,
    "webInvFetchBalance should only update account cache on explicit persisted source success"
  );
  assert.match(source, /acc\.balance\s*=\s*r\.balance/, "Web/Store source success should update cached balance");
  assert.match(source, /acc\.balance_source\s*=\s*r\.source/, "Web/Store source success should update cached source");
  assert.match(
    source,
    /acc\.balance_currency\s*=\s*String\(r\.currency \|\| ""\)\.trim\(\)/,
    "Web/Store source success should update cached currency"
  );
  assert.match(source, /acc\.balance_observed_at\s*=\s*r\.observed_at/, "Web/Store source success should update cached observed_at");
  assert.doesNotMatch(source, /r\.balance\s*=\s*acc\.balance/, "failure result must not copy cached balance");
  assert.doesNotMatch(source, /r\.source\s*=\s*acc\.balance_source/, "failure result must not copy cached source");
}

function test_balance_display_exposes_source_metadata() {
  assert.match(JS, /function formatWalletBalanceSourceMeta\(/, "UI should have a compact formatter for wallet source metadata");
  const accountCards = readFunctionSource("renderSavedAccounts");
  const webInfo = readFunctionSource("renderWebInvAccountInfo");
  assert.match(accountCards, /formatWalletBalanceSourceMeta\(row\)/, "account cards should read source metadata");
  assert.match(accountCards, /sub\.title\s*=\s*balanceMeta/, "account cards should expose source metadata in title");
  assert.match(webInfo, /formatWalletBalanceSourceMeta\(acc\)/, "Web inventory account info should read source metadata");
  assert.match(webInfo, /ui\.webInvAccBalance\.title\s*=\s*balanceMeta/, "Web inventory balance should expose source metadata in title");
}

function main() {
  test_merge_account_identity_carries_balance_metadata_only_with_balance();
  test_profile_hydration_only_merges_wallet_metadata_with_wallet_balance();
  test_web_inventory_balance_refresh_requires_persisted_source_success();
  test_balance_display_exposes_source_metadata();
  console.log("wallet-balance-source-ui tests passed");
}

main();
