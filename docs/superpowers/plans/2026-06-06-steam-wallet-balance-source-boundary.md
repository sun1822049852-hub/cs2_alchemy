# Steam Wallet Balance Source Boundary Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the account-level Steam wallet balance keep its latest successful source metadata while preventing Steam client/CM and Web/Store queries from using each other as fallbacks.

**Architecture:** Keep one account-level current Steam wallet balance value for compatibility, and add source metadata to the same account state. Web/Store and Steam client/CM are independent observation sources; either successful source may update the current value, but a failed source must not return, persist, or display the other source's old value as this attempt's success.

**Tech Stack:** Node.js CommonJS, local SQLite through `node:sqlite`, `AppAuthStore`, `uiServer` HTTP routes, static Node tests.

---

## Must Not Change

- Do not split the user-facing Steam wallet balance into two separate account balances. The current displayed account balance remains one account-level value.
- Do not use Web/Store as fallback for Steam client/CM wallet reads, and do not use Steam client/CM as fallback for Web/Store balance queries.
- Do not change GC inventory, Web inventory, market listing, trade offer, or CS2 GC `redeemable_balance` semantics.
- Do not rename or remove the existing `balance` field returned by `/api/accounts`; keep compatibility for existing UI code.
- Do not access real Steam accounts, real cookies, real maFiles, or real remote services during tests.
- Do not commit or include runtime artifacts such as `csgo_skins.db` or `output/`.
- Do not treat the existing full-suite failure in `account-relogin-modal.test.js` as caused by this task unless fresh evidence proves it.

## State Boundary

- State identity: persisted account-level Steam wallet balance projection: `balance` plus source metadata.
- Owner: `AppAuthStore` owns persisted `steam_account` rows.
- Update entries:
  - Web/Store active query: `POST /api/accounts/fetch-balance` using `fetchBalance()`.
  - Steam client/CM observation: `/api/accounts/profile` after `resolveAccountProfile()` reads `steam.wallet`.
- Consumers:
  - `/api/accounts` account list.
  - `/api/accounts/profile` response.
  - Web inventory account info and balance refresh button in `node_sidecar/ui/app.js`.
  - Account cards that display `余额`.
- Forbidden precision loss: a stored current value may be shown as a cached account value, but it must not be presented as a newly successful result from a failed source.

## Files

- Modify: `node_sidecar/src/appAuthStore.js`
  - Add balance source metadata columns.
  - Add a source-aware wallet balance update method.
  - Return metadata from sanitized account rows.
- Modify: `node_sidecar/src/uiServer.js`
  - Persist Web/Store success with `source=steam_store`.
  - Persist Steam client/CM success with `source=steam_cm`.
  - Return source metadata in relevant route responses.
  - Preserve source failure as failure without fallback.
- Modify: `node_sidecar/ui/app.js`
  - Merge and display account balance source metadata.
  - Update local account state only on successful source results.
  - Do not overwrite local metadata on failed source attempts.
- Modify: `node_sidecar/tests/app-auth-store.test.js`
  - Cover schema and source-aware persistence.
- Modify: `node_sidecar/tests/account-scope-route.test.js`
  - Cover Web/Store success and failure-no-fallback behavior.
- Modify: `node_sidecar/tests/account-profile-route-scope.test.js`
  - Cover Steam client/CM success and unavailable-no-fallback behavior.
- Modify or create: `node_sidecar/tests/web-inventory-bootstrap.test.js` or `node_sidecar/tests/wallet-balance-source-ui.test.js`
  - Cover front-end state update rules statically or through existing DOM helpers.
- Modify: `docs/project-cognition-map.md`
  - Record the balance source ownership and no-cross-fallback rule.
- Modify: `docs/agent/project-audit-task-checklist-2026-06-06.md`
  - Mark A11 implemented only after tests pass and map is updated.

---

## Phase P1: Persist Source Metadata

### Milestone P1.M1: Define Account Balance Metadata Contract

#### Task P1.M1.T1: Add Store Tests First

- [ ] **Step P1.M1.T1.S1: Write failing tests in `node_sidecar/tests/app-auth-store.test.js`**

Add tests for these behaviors:

```js
function test_wallet_balance_source_metadata_is_persisted() {
  const ctx = createStore();
  try {
    ctx.store.updateSteamWalletBalance("countsteam01", {
      balance: "¥ 12.34",
      source: "steam_store",
      currency: "CNY",
      observedAt: "2026-06-06T12:00:00.000Z"
    });

    const row = ctx.store.getSteamAccountForUser("", "countsteam01", {includeAll: true});
    assert.equal(row.balance, "¥ 12.34");
    assert.equal(row.balance_source, "steam_store");
    assert.equal(row.balance_currency, "CNY");
    assert.equal(row.balance_observed_at, "2026-06-06T12:00:00.000Z");
  } finally {
    cleanup(ctx);
  }
}

function test_wallet_balance_latest_successful_source_replaces_current_value() {
  const ctx = createStore();
  try {
    ctx.store.updateSteamWalletBalance("countsteam01", {
      balance: "¥ 12.34",
      source: "steam_store",
      currency: "CNY",
      observedAt: "2026-06-06T12:00:00.000Z"
    });
    ctx.store.updateSteamWalletBalance("countsteam01", {
      balance: "¥ 15.00",
      source: "steam_cm",
      currency: "CNY",
      observedAt: "2026-06-06T12:05:00.000Z"
    });

    const row = ctx.store.getSteamAccountForUser("", "countsteam01", {includeAll: true});
    assert.equal(row.balance, "¥ 15.00");
    assert.equal(row.balance_source, "steam_cm");
    assert.equal(row.balance_currency, "CNY");
    assert.equal(row.balance_observed_at, "2026-06-06T12:05:00.000Z");
  } finally {
    cleanup(ctx);
  }
}
```

- [ ] **Step P1.M1.T1.S2: Run the store test and verify RED**

Run:

```powershell
node tests/app-auth-store.test.js
```

Expected: FAIL because `updateSteamWalletBalance` and/or metadata fields do not exist.

#### Task P1.M1.T2: Implement Minimal Store Support

- [ ] **Step P1.M1.T2.S1: Add metadata columns in `AppAuthStore.ensureSchema()`**

Add compatible columns:

```sql
ALTER TABLE steam_account ADD COLUMN balance_source TEXT NOT NULL DEFAULT ''
ALTER TABLE steam_account ADD COLUMN balance_currency TEXT NOT NULL DEFAULT ''
ALTER TABLE steam_account ADD COLUMN balance_observed_at TEXT NOT NULL DEFAULT ''
```

- [ ] **Step P1.M1.T2.S2: Return metadata from `sanitizeSteamAccount()`**

Return:

```js
balance_source: asString(row.balance_source || ""),
balance_currency: asString(row.balance_currency || ""),
balance_observed_at: asString(row.balance_observed_at || ""),
```

- [ ] **Step P1.M1.T2.S3: Add source-aware update method**

Add `updateSteamWalletBalance(username, {balance, source, currency = "", observedAt = ""})`.

Rules:

- `username` must be non-empty.
- `balance` must be non-empty for a success update.
- `source` must be one of `steam_store` or `steam_cm`.
- `observedAt` defaults to current timestamp if omitted.
- Method updates `balance`, `balance_source`, `balance_currency`, `balance_observed_at`, and `updated_at`.

Keep the old `updateSteamAccountBalance(username, balance)` only if needed for compatibility, but do not use it from the two wallet source routes after this task.

- [ ] **Step P1.M1.T2.S4: Run the store test and verify GREEN**

Run:

```powershell
node tests/app-auth-store.test.js
```

Expected: PASS.

---

## Phase P2: Web/Store Source Contract

### Milestone P2.M1: Web/Store Success Updates Latest Account Balance

#### Task P2.M1.T1: Add Route Test For Web/Store Success

- [ ] **Step P2.M1.T1.S1: Extend `account-scope-route.test.js` fixture**

Allow the fake `fetchBalance()` result to be configured per test, while keeping the default current success result for existing tests.

- [ ] **Step P2.M1.T1.S2: Write failing Web/Store success assertion**

In the existing `/api/accounts/fetch-balance` test or a new focused test:

- Stub `fetchBalance()` to return `{success: true, balance: "¥ 12.34", currency: "CNY"}`.
- Call `POST /api/accounts/fetch-balance`.
- Assert the response result contains:
  - `success: true`
  - `balance: "¥ 12.34"`
  - `source: "steam_store"`
  - `currency: "CNY"`
  - non-empty `observed_at`
- Read the account row and assert:
  - `balance === "¥ 12.34"`
  - `balance_source === "steam_store"`
  - `balance_currency === "CNY"`
  - `balance_observed_at` is non-empty.

- [ ] **Step P2.M1.T1.S3: Run the route test and verify RED**

Run:

```powershell
node tests/account-scope-route.test.js
```

Expected: FAIL because response/store metadata is not implemented.

#### Task P2.M1.T2: Persist Web/Store Metadata

- [ ] **Step P2.M1.T2.S1: Update `/api/accounts/fetch-balance` success branch**

When `balResult.success` is true:

- compute `observedAt`;
- call `updateSteamWalletBalance(u, {balance: balResult.balance, currency: balResult.currency || "", source: "steam_store", observedAt})`;
- push response result with `source: "steam_store"` and `observed_at: observedAt`.

- [ ] **Step P2.M1.T2.S2: Keep failure as failure**

When `balResult.success` is false:

- do not call any balance update method;
- do not read stored account balance to fill `balance`;
- return the failure from `fetchBalance()` with no fallback source.

- [ ] **Step P2.M1.T2.S3: Run the route test and verify GREEN**

Run:

```powershell
node tests/account-scope-route.test.js
```

Expected: PASS.

### Milestone P2.M2: Web/Store Failure Does Not Fall Back To Steam CM

#### Task P2.M2.T1: Add Negative Route Test

- [ ] **Step P2.M2.T1.S1: Seed an existing Steam CM balance**

Before calling the route, set:

```js
store.updateSteamWalletBalance("countsteam01", {
  balance: "¥ 99.00",
  source: "steam_cm",
  currency: "CNY",
  observedAt: "2026-06-06T11:00:00.000Z"
});
```

- [ ] **Step P2.M2.T1.S2: Stub Web/Store failure**

Make fake `fetchBalance()` return:

```js
{success: false, balance: null, currency: null, message: "store unavailable"}
```

- [ ] **Step P2.M2.T1.S3: Assert no fallback**

Expected route behavior:

- response result for `countsteam01` has `success: false`;
- response result does not include `balance: "¥ 99.00"`;
- response result does not include `source: "steam_cm"`;
- stored row remains unchanged with `balance_source === "steam_cm"`.

- [ ] **Step P2.M2.T1.S4: Run the test RED then GREEN after implementation**

Run:

```powershell
node tests/account-scope-route.test.js
```

Expected before P2.M1 implementation: FAIL. Expected after implementation: PASS.

---

## Phase P3: Steam Client/CM Source Contract

### Milestone P3.M1: CM Wallet Success Updates Latest Account Balance

#### Task P3.M1.T1: Add Profile Route Test For CM Success

- [ ] **Step P3.M1.T1.S1: Extend fake session in `account-profile-route-scope.test.js`**

Allow the fake `sessionPool.acquire()` to return a `steam.wallet` object for focused tests:

```js
wallet: {
  hasWallet: true,
  currency: 23,
  balance: 15
}
```

- [ ] **Step P3.M1.T1.S2: Write failing assertions**

Call:

```powershell
GET /api/accounts/profile?username=selenomorphology
```

Assert:

- `profile.wallet_balance === "¥ 15.00"`;
- `profile.wallet_source === "steam_cm"`;
- `profile.wallet_currency === "CNY"` or the chosen normalized equivalent;
- stored row has `balance === "¥ 15.00"`;
- stored row has `balance_source === "steam_cm"`;
- stored row has non-empty `balance_observed_at`.

- [ ] **Step P3.M1.T1.S3: Run profile route test and verify RED**

Run:

```powershell
node tests/account-profile-route-scope.test.js
```

Expected: FAIL because CM metadata is not persisted/returned yet.

#### Task P3.M1.T2: Persist CM Metadata

- [ ] **Step P3.M1.T2.S1: Normalize CM wallet currency**

In `resolveAccountProfile()`, keep current display formatting and add a normalized wallet currency field. Use known Steam currency IDs:

```js
{1: "USD", 2: "GBP", 3: "EUR", 23: "CNY", 13: "SGD", 29: "HKD"}
```

If unknown, store a clear raw marker such as `steam_currency:<id>` rather than pretending it is a known code.

- [ ] **Step P3.M1.T2.S2: Return CM metadata in profile**

Add `wallet_currency` and `wallet_observed_at` only when wallet balance is actually present, with `wallet_source: "steam_cm"`.

- [ ] **Step P3.M1.T2.S3: Update `/api/accounts/profile` persistence**

When `profile.wallet_balance` is non-empty:

- call `updateSteamWalletBalance(profile.username, {balance: profile.wallet_balance, currency: profile.wallet_currency, source: "steam_cm", observedAt: profile.wallet_observed_at})`;
- do not update balance metadata when wallet is unavailable.

- [ ] **Step P3.M1.T2.S4: Run profile route test and verify GREEN**

Run:

```powershell
node tests/account-profile-route-scope.test.js
```

Expected: PASS.

### Milestone P3.M2: CM Wallet Unavailable Does Not Fall Back To Web/Store

#### Task P3.M2.T1: Add Negative Profile Route Test

- [ ] **Step P3.M2.T1.S1: Seed an existing Web/Store balance**

Set stored balance before the profile request:

```js
store.updateSteamWalletBalance("selenomorphology", {
  balance: "¥ 88.00",
  source: "steam_store",
  currency: "CNY",
  observedAt: "2026-06-06T11:00:00.000Z"
});
```

- [ ] **Step P3.M2.T1.S2: Fake CM wallet unavailable**

Return a fake `steam` object without `wallet`, or with `wallet.hasWallet === false`.

- [ ] **Step P3.M2.T1.S3: Assert no fallback**

Expected:

- profile response has no successful `wallet_balance` from CM;
- profile response does not report `wallet_source: "steam_store"`;
- stored row remains `balance_source === "steam_store"`;
- no new `balance_observed_at` is written for a failed CM read.

- [ ] **Step P3.M2.T1.S4: Run profile route test**

Run:

```powershell
node tests/account-profile-route-scope.test.js
```

Expected: PASS after P3.M1 implementation.

---

## Phase P4: Frontend Display And State Rules

### Milestone P4.M1: UI Carries Source Metadata Without Fallback

#### Task P4.M1.T1: Add Frontend Guard Test

- [ ] **Step P4.M1.T1.S1: Add or extend a static UI test**

Preferred file: create `node_sidecar/tests/wallet-balance-source-ui.test.js` if existing DOM harnesses are too heavy.

Test for these source-level rules in `node_sidecar/ui/app.js`:

- `webInvFetchBalance()` only mutates account balance on `r.success`;
- success branch copies `r.source`, `r.currency`, and `r.observed_at` or equivalent fields into the selected account;
- failure branch does not copy existing `acc.balance` into a fake result;
- `mergeAccountIdentity()` only updates wallet metadata when `profile.wallet_balance` is non-empty.

- [ ] **Step P4.M1.T1.S2: Run UI test and verify RED**

Run:

```powershell
node tests/wallet-balance-source-ui.test.js
```

Expected: FAIL until UI metadata handling exists.

#### Task P4.M1.T2: Implement Minimal UI Metadata Handling

- [ ] **Step P4.M1.T2.S1: Extend `mergeAccountIdentity()`**

Accept `balanceSource`, `balanceCurrency`, `balanceObservedAt`. If `balance` is empty, do not update any balance metadata.

- [ ] **Step P4.M1.T2.S2: Extend profile hydration**

When `ensureAccountProfile()` receives CM wallet data, merge:

- `profile.wallet_balance`
- `profile.wallet_source`
- `profile.wallet_currency`
- `profile.wallet_observed_at`

Only merge those fields when `profile.wallet_balance` is non-empty.

- [ ] **Step P4.M1.T2.S3: Extend Web/Store balance refresh success branch**

When `webInvFetchBalance()` receives a successful result, set:

- `acc.balance`
- `acc.balance_source`
- `acc.balance_currency`
- `acc.balance_observed_at`

On failure, keep the visible cached account value unchanged but show the error for the failed source. Do not call this a successful refresh.

- [ ] **Step P4.M1.T2.S4: Display source metadata lightly**

Keep UI compact. Add source/time to title text or a small secondary label only where balance is already shown:

- Account card balance text may remain `余额：...`.
- Tooltip/title or secondary text should expose source and time when available.
- Web inventory account info should expose source/time near the balance or via title.

- [ ] **Step P4.M1.T2.S5: Run UI test and targeted inventory tests**

Run:

```powershell
node tests/wallet-balance-source-ui.test.js
node tests/web-inventory-bootstrap.test.js
```

Expected: PASS.

---

## Phase P5: Documentation And Verification

### Milestone P5.M1: Update Project Map And Checklist

#### Task P5.M1.T1: Update Map

- [ ] **Step P5.M1.T1.S1: Update `docs/project-cognition-map.md`**

In section 10 or a focused balance note, record:

- account balance current value owner is `AppAuthStore`;
- Web/Store source is `steam_store`;
- Steam client/CM source is `steam_cm`;
- latest successful source may update the account value;
- failed source must not use another source as fallback;
- GC/armory `redeemable_balance` is separate.

- [ ] **Step P5.M1.T1.S2: Update validation method**

Record targeted tests run and explicitly state that real Steam/Web/GC runtime was not exercised unless it actually was.

#### Task P5.M1.T2: Update Checklist

- [ ] **Step P5.M1.T2.S1: Update A11 in `docs/agent/project-audit-task-checklist-2026-06-06.md`**

After implementation and tests:

- change status from `待处理` to `已处理` only if all targeted tests pass;
- add a short handled note listing the source metadata fields and no-cross-fallback tests.

### Milestone P5.M2: Final Verification

#### Task P5.M2.T1: Run Targeted Tests

- [ ] **Step P5.M2.T1.S1: Run source boundary tests**

Run:

```powershell
node tests/app-auth-store.test.js
node tests/account-scope-route.test.js
node tests/account-profile-route-scope.test.js
node tests/wallet-balance-source-ui.test.js
node tests/web-inventory-bootstrap.test.js
```

Expected: PASS.

- [ ] **Step P5.M2.T1.S2: Run broader sidecar test command**

Run:

```powershell
npm test
```

Expected: Ideally PASS. If it fails with the pre-existing `account-relogin-modal.test.js` / `applyClientPermissionToButton is not defined`, report that separately and do not hide it.

#### Task P5.M2.T2: Review Diff Before Delivery

- [ ] **Step P5.M2.T2.S1: Confirm no runtime artifacts are staged**

Run:

```powershell
git status --short
git diff --stat
```

Expected:

- implementation files and docs only;
- no `csgo_skins.db`;
- no `output/`.

- [ ] **Step P5.M2.T2.S2: Re-read original requirement**

Confirm the implementation still satisfies:

- balance hangs under account;
- Web/Store and Steam client/CM are both valid successful sources;
- latest successful source is current value;
- failed source never uses the other source as fallback.

---

## Suggested Commit

After verification, commit only implementation and documentation files:

```powershell
git add node_sidecar/src/appAuthStore.js node_sidecar/src/uiServer.js node_sidecar/ui/app.js node_sidecar/tests/app-auth-store.test.js node_sidecar/tests/account-scope-route.test.js node_sidecar/tests/account-profile-route-scope.test.js node_sidecar/tests/wallet-balance-source-ui.test.js node_sidecar/tests/web-inventory-bootstrap.test.js docs/project-cognition-map.md docs/agent/project-audit-task-checklist-2026-06-06.md
git commit -m "fix: track steam wallet balance source"
```

Do not include `csgo_skins.db` or `output/`.
