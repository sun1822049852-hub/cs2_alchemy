# Web Inventory Upstream Implementation Index

## Purpose

This file indexes the upstream implementation that Claude Code used as a reference for the `Web Inventory` feature set, and maps each upstream capability to the current `cs2_alchemy` codebase.

This is not a product spec. It is an implementation cross-reference for follow-up auditing and correction work.

## Source Of Truth Used In This Audit

- Upstream repo recorded in Claude local history:
  - `hjkkjh-hhh/steam-uu-c5-scratch-account_tool`
- Claude local plan:
  - [purring-cooking-kernighan.md](/C:/Users/18220/.claude/plans/purring-cooking-kernighan.md)
- Claude local session:
  - [2f6441b5-5c46-4806-8559-9b04fb5dc770.jsonl](/C:/Users/18220/.claude/projects/c--Users-18220-Desktop-cs2-alchemy/2f6441b5-5c46-4806-8559-9b04fb5dc770.jsonl)
- Cached upstream source snapshots:
  - `C:/Users/18220/.claude/projects/c--Users-18220-Desktop-cs2-alchemy/2f6441b5-5c46-4806-8559-9b04fb5dc770/tool-results/fetchers_clean.js`
  - `C:/Users/18220/.claude/projects/c--Users-18220-Desktop-cs2-alchemy/2f6441b5-5c46-4806-8559-9b04fb5dc770/tool-results/index_extracted2.js`

## Related Local Plan / Commit

- Local archived plan:
  - [2026-04-24-web-inventory-management-page.md](/C:/Users/18220/Desktop/cs2_alchemy/docs/superpowers/plans/2026-04-24-web-inventory-management-page.md)
- Main landing commit:
  - `f71e1ae` `feat(web-inventory): add web inventory management page with Steam market integration`

## Upstream Function Index

| Upstream function | Upstream location | Upstream responsibility | Current local mapping | Alignment |
|---|---|---|---|---|
| `prepareCookieHeader` | `fetchers_clean.js:402` | Normalize cookies, select `steamLoginSecure` by audience, inject `Steam_Language`, `timezoneOffset`, `browserid`, and ensure `sessionid` exists | [steamHttpClient.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/steamHttpClient.js#L42) `enhanceCookieString()` + [steamHttpClient.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/steamHttpClient.js#L106) `buildSteamHeaders()` | Partial, recently corrected with `sessionid` injection |
| `fetchSteamPrice` | `fetchers_clean.js:462` | Lightweight `priceoverview` lookup | [steamMarketService.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/steamMarketService.js#L93) `getPriceOverview()` | Mostly aligned, simpler than upstream |
| `fetchSteamItemPrice` | `fetchers_clean.js:649` | Robust price lookup with search + histogram fallback | No direct equivalent | Not aligned |
| `fetchMyActiveListings` | `fetchers_clean.js:1040` | Enumerate current Steam market listings | No direct equivalent in local repo | Not aligned |
| `removeSteamListing` | `fetchers_clean.js:1364` | Cancel an existing Steam market listing | No direct equivalent in local repo | Not aligned |
| `fetchTradeUrlFromCookie` | `fetchers_clean.js:1646` | Resolve trade URL using `steamcommunity`, official API, then HTML scrape fallback | [steamAccountTools.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/steamAccountTools.js#L243) `fetchTradeUrl()` | Partial, corrected with official API fallback, still missing `steamcommunity` first-pass path |
| `steamRefreshSession` | `fetchers_clean.js:1744` | Refresh access token, then use `steam-session` `LoginSession` to obtain Web cookies, with proxy-aware fallback | [steamWebSession.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/steamWebSession.js#L1) `refreshWebCookie()` / `refreshWebCookieFromToken()` | Partial, first-cut aligned: local flow now carries `steamid`, prefers `steam-session`, and keeps a proxy-aware token refresh + fallback cookie path |

## Current Local Implementation Index

| Local module | Key function(s) | Role in current feature set |
|---|---|---|
| [steamHttpClient.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/steamHttpClient.js#L1) | `enhanceCookieString`, `buildSteamHeaders`, `steamGet`, `steamPost` | Shared Steam Web HTTP helpers for market / account tools |
| [steamWebSession.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/steamWebSession.js#L1) | `refreshWebCookie`, `refreshWebCookieFromToken`, `buildWebCookies` | Builds Web cookie/session payloads from maFile or refresh token |
| [inventoryService.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/inventoryService.js#L1) | `fetchInventoryPage`, `fetchFullInventory` | Direct CS2 Web inventory fetch + pagination |
| [steamMarketService.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/steamMarketService.js#L1) | `sellItem`, `getPriceOverview`, `getMarketConfirmations`, `confirmMarketListings` | Market listing + price lookup + confirmation |
| [steamAccountTools.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/steamAccountTools.js#L1) | `checkBansBatch`, `fetchBalance`, `fetchTradeUrl` | Ban / wallet / trade URL account tools |
| [uiServer.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js#L3378) | `/api/accounts/batch-inventory`, `/api/accounts/:username/inventory`, `/api/market/*`, `/api/accounts/check-bans`, `/api/accounts/fetch-balance`, `/api/accounts/refresh-trade-url` | Main API surface for Web inventory feature set |
| [app.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js#L15970) | `webInvState`, `webInvFetchInventory`, `webInvFetchBalance`, `webInvBatchBanCheck`, `webInvBatchTradeUrl` | Browser-side `Web Inventory` page logic |

## Audited Alignment Status

### 1. Fully or Mostly Aligned

- `Web Inventory` page shell:
  - [index.html](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/index.html#L118)
  - [index.html](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/index.html#L740)
  - [app.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js#L15970)
- Batch market listing endpoints:
  - [uiServer.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js#L3735)
  - [uiServer.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js#L3888)
- Ban / balance / trade URL endpoints:
  - [uiServer.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js#L3932)
  - [uiServer.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js#L4018)
  - [uiServer.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js#L4061)

### 2. Corrected During The Current Audit

- `Web Inventory` inventory fetch path drift:
  - current fixed frontend call: [app.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js#L16105)
  - current server route: [uiServer.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js#L3463)
- Cookie `sessionid` guarantee:
  - [steamHttpClient.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/steamHttpClient.js#L61)
- Trade URL official API fallback:
  - [steamAccountTools.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/steamAccountTools.js#L152)
  - [steamAccountTools.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/steamAccountTools.js#L243)
- Regression lock:
  - [steam-web-alignment.test.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/steam-web-alignment.test.js#L1)

### 3. Remaining High-Risk Mismatches

#### A. Web session refresh is only partially aligned

- Upstream:
  - `steamRefreshSession` refreshes access token, then uses `steam-session` `LoginSession` to obtain Web cookies and has a fallback path.
- Local:
  - [steamWebSession.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/steamWebSession.js#L1) 现在会在 token refresh 时带 `steamid`、优先走 `steam-session` `LoginSession(MobileApp).getWebCookies()`、并在失败时退回手工 cookie，同时补 `Steam_Language` / `timezoneOffset` / `browserid` / `steamCountry`。
  - 但上层 [uiServer.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js#L158) 的 `resolveWebSessionForAccount()` 仍把“存在 `mafile_content` 但内容破损”当作硬失败，没有继续回退到 `TokenStore`。
- Risk:
  - 底层 session refresh 已不再是“纯手拼 cookie”，但当 maFile 结构破损、账号来源混杂或上层消费链没有正确 fallback 时，Web Inventory / market / balance / trade URL 仍可能被整条卡死。

#### B. Inventory fetching still bypasses the shared HTTP layer

- Local:
  - [inventoryService.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/inventoryService.js#L34) uses raw `https.get`.
  - It does not reuse `steamHttpClient` retry behavior, cookie enhancement, or future proxy handling.
- Risk:
  - Inventory fetch can diverge from market/account-tool behavior under rate limit, transient failures, or environment-specific network routing.

#### C. Trade URL path still lacks upstream `steamcommunity` first-pass method

- Upstream order:
  - `steamcommunity.getTradeURL()` -> official API -> HTML scrape
- Local order:
  - official API -> HTML scrape
- Current status:
  - better than before, but still not identical to upstream robustness.

#### D. Market pricing path is thinner than upstream

- Upstream:
  - has `fetchSteamItemPrice`, histogram fallback, listing-level search, and more resilient price recovery.
- Local:
  - [steamMarketService.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/steamMarketService.js#L93) only uses `priceoverview`.
- Risk:
  - price lookup is simpler but may be less reliable for low-liquidity or region-sensitive items.

#### E. Listing management parity is incomplete

- Upstream includes:
  - active listing enumeration
  - listing removal
- Local currently has:
  - listing create + confirmations
  - no equivalent “my listings” or “remove listing” feature

## Recommended Correction Order

1. Harden `resolveWebSessionForAccount()` fallback around `steamWebSession`
   Reason: the first-cut `steamWebSession` alignment is in place, but broken `mafile_content` can still block the whole Web session chain before fallback reaches `TokenStore`.

2. Move `inventoryService.js` onto the shared Steam HTTP layer
   Reason: inventory is still the most obvious network-stack outlier.

3. Add `steamcommunity` first-pass trade URL resolution
   Reason: low surface area, improves robustness for trade URL refresh.

4. Decide whether batch price lookup needs upstream-level robustness
   Reason: this is a correctness / UX tradeoff, not a guaranteed bug.

5. Decide whether active-listings / remove-listing parity is needed
   Reason: this is feature parity, not bug parity.

## Verification Already Added

- [steam-web-alignment.test.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/steam-web-alignment.test.js#L1)
  - locks `sessionid` injection in `enhanceCookieString`
  - locks official API fallback in `fetchTradeUrl`
- [web-inventory-bootstrap.test.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/web-inventory-bootstrap.test.js#L1)
  - locks the `Web Inventory` page against regressing to the removed inventory route

## Notes

- This index is intentionally evidence-first.
- If a future audit finds better upstream snapshots than the current Claude cache, update this file instead of scattering the comparison into session logs.
