# Web Inventory Management Page + Account Tools Implementation Plan

> **Provenance:** Imported from local Claude Code plan `C:/Users/18220/.claude/plans/purring-cooking-kernighan.md`.
> Related Claude session: `2f6441b5-5c46-4806-8559-9b04fb5dc770`.
> Reference project recorded in the original plan: `hjkkjh-hhh/steam-uu-c5-scratch-account_tool`.
> Related implementation commit in this repo: `f71e1ae` (`feat(web-inventory): add web inventory management page with Steam market integration`).

## Context

`cs2_alchemy` had already completed maFile batch import, Web inventory fetch, and inventory transfer fundamentals. This plan records the next migration stage from the reference project `steam-uu-c5-scratch-account_tool`: add a dedicated `Web Inventory` sidebar page and migrate the following account/web-market tools into the local app:

1. Steam market batch listing
2. Ban check (including red-trust / economy-ban signal, merged into one flow)
3. Wallet balance query
4. Trade URL refresh

---

## Review Findings Folded Into The Plan

| # | Problem | Planned solution |
|---|---------|------------------|
| 1 | Steam market listing can be rejected if cookies lack browser-simulation fields | Create `steamHttpClient.js` to build full headers/cookies |
| 2 | `store.steampowered.com` token audience may not match | Balance query should prefer `GetClientWalletDetails/v1`, then fall back to HTML parsing |
| 3 | No local `STEAM_API_KEY` storage exists | Reuse `secretStore.js` and add a UI config entry |
| 4 | Red-trust and ban detection are two interpretations of the same Steam data | Merge into one `checkBanStatus` flow |
| 5 | Existing `webInventoryModal` overlaps with the new page | Change account-card `Web库存` button to jump into the new page |
| 6 | `upsertSteamAccount` cannot update the new fields independently | Add dedicated `UPDATE` helpers |
| 7 | Dark-gold theme selectors do not include the new page | Add `#webInventoryPage` to the CSS selector scope |

---

## Implementation Steps

### Step 0: Shared Infrastructure

#### Create `node_sidecar/src/steamHttpClient.js`

Encapsulate shared Steam HTTP behavior:

```js
// Enhance cookies with browser-simulation fields
function enhanceCookieString(baseCookie) -> cookieString
// Includes Steam_Language=schinese, timezoneOffset=28800, browserid=random

// Build browser-like request headers
function buildSteamHeaders({ cookieString, sessionid, steamId64, referer }) -> headers
// Includes sec-ch-ua, sec-fetch-*, X-Requested-With, Origin, Referer

// Shared POST helper with retry + 429 backoff
function steamPost({ url, body, headers, maxRetries, retryDelayMs }) -> response
// 429 backoff: 1.5s -> 3s -> 6s, max 3 retries

// Shared GET helper
function steamGet({ url, headers, maxRetries }) -> response
```

Reference noted in the original Claude plan:
- `steam-uu-c5-scratch-account_tool/server/fetchers.js:106-139` (proxy routing)
- `steam-uu-c5-scratch-account_tool/server/index.js:4202-4215` (full headers)

#### SQLite schema changes

In `appAuthStore.js`, append these fields inside `_ensureSteamAccountTable()`:

```sql
ALTER TABLE steam_account ADD COLUMN ban_status TEXT DEFAULT '';
ALTER TABLE steam_account ADD COLUMN trade_url TEXT DEFAULT '';
ALTER TABLE steam_account ADD COLUMN balance TEXT DEFAULT '';
```

Also add dedicated update helpers:

```js
updateSteamAccountField(username, field, value)
updateSteamAccountBanStatus(username, banStatus)
updateSteamAccountTradeUrl(username, tradeUrl)
updateSteamAccountBalance(username, balance)
```

#### Steam API Key storage

Reuse `secretStore.js` to store `steam_api_key`, and add an optional UI input in settings.

---

### Step 1: Add The `Web Inventory` Page Skeleton

#### `index.html`

Add the sidebar nav button:

```html
<button class="nav-btn" data-page="webInventoryPage" id="navWebInventory">库存管理</button>
```

Add a new page section after `batchCraftPage`, using the same 3-column grid pattern as `batch-craft-main`:

```html
<section class="page hidden" id="webInventoryPage">
  <div class="web-inv-layout">
    <aside class="web-inv-account-panel" id="webInvAccountPanel">
      <div class="web-inv-account-head">
        <span>账号列表</span>
        <button id="webInvBatchBanCheck" title="批量封禁检测">封禁检测</button>
        <button id="webInvBatchTradeUrl" title="批量刷新交易链接">刷新链接</button>
      </div>
      <div id="webInvAccountList" class="web-inv-account-list"></div>
    </aside>
    <div class="web-inv-split-bar" id="webInvSplitBar"></div>
    <main class="web-inv-main" id="webInvMain">
      <div id="webInvAccountInfo" class="web-inv-account-info hidden">
        <span id="webInvAccName"></span>
        <span id="webInvAccBalance"></span>
        <span id="webInvAccBanStatus"></span>
        <span id="webInvAccTradeUrl"></span>
        <button id="webInvBalanceBtn">查询余额</button>
      </div>
      <div class="web-inv-toolbar">
        <button id="webInvFetchBtn">拉取库存</button>
        <label><input type="checkbox" id="webInvTradableOnly"> 仅可交易</label>
        <button id="webInvSelectAll">全选</button>
        <span id="webInvSelectedCount">已选 0 件</span>
      </div>
      <div id="webInvItemGrid" class="web-inv-item-grid"></div>
      <div id="webInvActionBar" class="web-inv-action-bar hidden">
        <span id="webInvActionCount"></span>
        <button id="webInvTransferBtn">转移选中</button>
        <button id="webInvSellBtn">上架选中</button>
      </div>
    </main>
  </div>
</section>
```

#### `app.js`

Planned changes:

1. Register the new DOM refs in `ui`
2. Extend `showPage()` page list with `["webInventoryPage", ui.navWebInventory]`
3. Add a `renderWebInventoryPage()` callback
4. Bind click handlers
5. Change the account-card `Web库存` button to `showPage("webInventoryPage"); webInvSelectAccount(row.username)`
6. Deprecate `#webInventoryModal` as a launch entrypoint while keeping code temporarily

#### State model

```js
const webInvState = {
  selectedAccount: null,
  inventoryCache: new Map(),
  selectedAssetIds: new Set(),
  cacheTtlMs: 5 * 60 * 1000
};
```

#### `styles.css`

- `.web-inv-layout` uses the same 3-column grid concept as `batch-craft-main`
- Dark-gold theme selectors must include `#webInventoryPage`
- `.web-inv-action-bar` should use `position: sticky; bottom: 0`
- Item-grid rendering should prefer `replaceChildren()`

---

### Step 2: Steam Market Batch Listing

#### Create `node_sidecar/src/steamMarketService.js`

```js
async function sellItem({ cookieString, sessionid, steamId64, assetId, priceInCents, currency })
// POST https://steamcommunity.com/market/sellitem/
// Body: sessionid, appid=730, contextid=2, assetid, amount=1, price, currency
// Headers: browser-like headers from steamHttpClient.buildSteamHeaders
// Returns: { success, message, listingId, requiresConfirmation }

async function getPriceOverview({ marketHashName, currency })
// GET https://steamcommunity.com/market/priceoverview/?appid=730&currency={id}&market_hash_name={name}
// Returns: { lowestPrice, medianPrice, volume }

function calculateBuyerPrice(sellerReceiveCents)
function calculateSellerPrice(buyerPayCents)
// Steam fee 10% (minimum 1 cent) + game fee 5% (minimum 1 cent)
```

#### Add server routes in `uiServer.js`

`POST /api/market/batch-sell`:

```json
{ "username": "xxx", "items": [{ "assetId": "123", "priceInCents": 500 }] }
```

Flow:
- `resolveWebSessionForAccount()`
- call `sellItem()` per item
- push progress via SSE
- use a 2-second interval between listings
- apply exponential backoff on 429

`GET /api/market/price?market_hash_name=xxx&currency=23`

`POST /api/market/batch-price`:

```json
{ "items": [{ "marketHashName": "AK-47 | Redline (Field-Tested)" }] }
```

Use SSE and a 1.5-second interval between queries.

#### Frontend

`#marketSellModal`:
- table rows: icon + name + market reference price + seller-receive input + buyer-pay display
- quick-fill pricing by percentage of lowest market price
- footer summary with count + estimated income + confirm button
- SSE progress

---

### Step 3: Ban Check (Including Red-Trust Signal)

#### Add to `node_sidecar/src/steamAccountTools.js`

```js
async function checkBansBatch(steamId64List, apiKey)
// GET https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key={apiKey}&steamids={csv}
// Up to 100 accounts per call
// Returns: [{ steamId64, vacBanned, gameBanCount, communityBanned, economyBan, daysSinceLastBan }]
// Red-trust rule: communityBanned || economyBan === 'banned'

async function checkBanSingle({ cookieString, steamId64 })
// GET https://steamcommunity.com/profiles/{steamId64}
// Parse .profile_ban-ish blocks from HTML
```

#### Add route

`POST /api/accounts/check-bans`

- With API key: batch mode
- Without API key: fallback to per-account SSE scraping

#### Frontend

- left-side account list shows ban-status badge
- `批量封禁检测` updates badges live
- results persist into `steam_account.ban_status`

---

### Step 4: Wallet Balance Query

#### Add to `steamAccountTools.js`

```js
async function fetchBalance({ cookieString, accessToken, steamId64 })
// Preferred: POST https://store.steampowered.com/api/GetClientWalletDetails/v1
// Fallback: GET https://store.steampowered.com/account/
// Parse wallet balance from HTML if API is unavailable
```

#### Add route

`POST /api/accounts/fetch-balance`

```json
{ "usernames": ["acc1", "acc2"] }
```

#### Frontend

- selected account info bar displays balance
- `查询余额` button triggers lookup
- persist to `steam_account.balance`

---

### Step 5: Trade URL Refresh

#### Add to `steamAccountTools.js`

```js
async function fetchTradeUrl({ cookieString, steamId64 })
// Plan A: GET https://steamcommunity.com/profiles/{steamId64}/tradeoffers/privacy
// Parse trade_offer_access_url from HTML
// Plan B: GET https://api.steampowered.com/IEconService/GetTradeOfferAccessToken/v1/?access_token={token}
```

#### Add route

`POST /api/accounts/refresh-trade-url`

```json
{ "usernames": ["acc1", "acc2"] }
```

Use SSE and an 800ms interval between accounts.

#### Frontend

- selected-account info bar shows truncated trade URL
- hover shows full URL
- click copies URL
- `批量刷新交易链接` refreshes and persists `steam_account.trade_url`

---

### Step 6: Steam API Key Configuration UI

Add a simple settings entry:
- Steam API Key input
- save through `secretStore`
- ban-check feature auto-selects batch mode or fallback mode based on key presence

---

## File Map

### Modify

| File | Planned work |
|------|--------------|
| `node_sidecar/src/uiServer.js` | add 6 routes + imports |
| `node_sidecar/src/appAuthStore.js` | add 3 schema fields + dedicated update helpers |
| `node_sidecar/src/secretStore.js` | add `steam_api_key` storage |
| `node_sidecar/ui/index.html` | add nav button + `webInventoryPage` + `marketSellModal` |
| `node_sidecar/ui/app.js` | add page logic + retire `webInventoryModal` entrypoint |
| `node_sidecar/ui/styles.css` | add `web-inv-*` styling + dark-gold selector updates |

### Create

| File | Responsibility |
|------|----------------|
| `node_sidecar/src/steamHttpClient.js` | Steam HTTP helpers (cookie enhancement + headers + retry) |
| `node_sidecar/src/steamMarketService.js` | listing, price lookup, price math |
| `node_sidecar/src/steamAccountTools.js` | ban check, balance lookup, trade URL refresh |

### Reuse

| Function / module | Location |
|-------------------|----------|
| `resolveWebSessionForAccount()` | `uiServer.js` |
| `AccountStore.upsert/get/list` | `accountStore.js` |
| `secretStore.get/set` | `secretStore.js` |
| `asString(), withTimeout()` | `utils.js` |
| SSE route pattern | `uiServer.js` |
| 3-column grid + drag splitter | `batchCraftPage` UI pattern |

---

## Execution Order

```text
Step 0: shared infrastructure
  ↓
Step 1: page skeleton
  ↓
Step 2: batch listing
  ↓
Step 3: ban check
Step 4: balance query
Step 5: trade URL refresh
Step 6: API key config UI
```

Steps 3-5 can proceed in parallel after Step 2 if the shared infrastructure is stable.

---

## Context Preservation Notes

After each major step:

1. Update project memory / progress notes
2. Sync task progress
3. Record any Steam-specific pitfalls so later sessions do not rediscover them

---

## Verification Targets

1. Page skeleton: sidebar nav works, split layout renders, dark-gold theme scopes correctly
2. Batch listing: select items -> load market price -> set price -> list -> verify Steam market listing appears
3. Ban check: batch check -> badge updates -> persistence works
4. Balance query: fetch -> display -> persistence works
5. Trade URL refresh: fetch -> display -> copy -> persistence works
6. Regression coverage: rerun affected Node tests such as `node --test node_sidecar/tests/app-auth-store.test.js`
