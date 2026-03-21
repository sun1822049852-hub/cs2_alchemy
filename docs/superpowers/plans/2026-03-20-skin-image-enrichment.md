# Skin Image Enrichment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save BUFF 商品级图片到 `skin` 表，并在现有详情补齐链之后，按 family 共享同一张商品图自动补回图片字段。

**Architecture:** Keep the current family-based collection/rarity enrichment path unchanged. Reuse the same family key for image enrichment, fetch one representative goods page HTML per family, parse the product image from the page, and broadcast that image to all family members. Keep an image-only backfill script for manual补图场景.

**Tech Stack:** Node.js CommonJS, built-in `fetch`, `node:sqlite`, existing BUFF detail provider/service, plain Node tests.

---

## Chunk 1: Lock Provider Contract

### Task 1: Add failing provider tests for goods-page image parsing

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/buffSkinDetailProvider.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/buffSkinDetailProvider.js`

- [ ] **Step 1: Write a failing test for `fetchGoodsImageByGoodsId()` success parsing from goods page HTML**
- [ ] **Step 2: Cover fallback order: `detail-pic img` -> NetEase file URL -> `og:image`**
- [ ] **Step 3: Run `node .\\tests\\buffSkinDetailProvider.test.js` and verify it fails**
- [ ] **Step 4: Implement goods page HTML request and image extraction**
- [ ] **Step 5: Re-run `node .\\tests\\buffSkinDetailProvider.test.js` and verify it passes**

## Chunk 2: Lock DB Schema And Metadata Reuse

### Task 2: Extend DB sync for image columns and family reuse

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDbSync.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/skinDbSync.js`

- [ ] **Step 1: Add `goods_icon_url`, `goods_original_icon_url`, `goods_share_thumbnail_url` columns if absent**
- [ ] **Step 2: Extend metadata reuse tests to prove family image values can seed later imports**
- [ ] **Step 3: Include image columns in `INSERT ... ON CONFLICT DO UPDATE`**
- [ ] **Step 4: Run `node .\\tests\\skinDbSync.test.js` and verify it passes**

## Chunk 3: Add Family-Level Image Enrichment

### Task 3: Add failing service tests for family-shared image fill

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDetailEnrichmentService.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/skinDetailEnrichmentService.js`

- [ ] **Step 1: Write a failing test showing one family is fetched once and all members share the same image**
- [ ] **Step 2: Write a failing test showing rows already `ok` but missing image still get image补齐**
- [ ] **Step 3: Write a failing test showing image-only resume works from existing DB state**
- [ ] **Step 4: Run `node .\\tests\\skinDetailEnrichmentService.test.js` and verify it fails**

### Task 4: Implement image enrichment after detail and wear enrichment

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/skinDetailEnrichmentService.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/buffSkinDetailProvider.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDetailEnrichmentService.test.js`

- [ ] **Step 1: Group pending image rows by family key**
- [ ] **Step 2: Fetch image once via `fetchGoodsImageByGoodsId(representativeGoodsId)`**
- [ ] **Step 3: Write the same image info back to all family members**
- [ ] **Step 4: Return image fill stats together with existing detail stats**
- [ ] **Step 5: Re-run `node .\\tests\\skinDetailEnrichmentService.test.js` and verify it passes**

## Chunk 4: Add Image-Only Manual Backfill Entry

### Task 5: Keep a standalone image-only补齐脚本 for manual repair

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tools/fillMissingSkinImages.js`
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/fillMissingSkinImages.test.js`

- [ ] **Step 1: Add CLI flags for DB path, delay, limit, retry, and backup**
- [ ] **Step 2: Wire the script to `service.enrichMissingImages()`**
- [ ] **Step 3: Add a test proving one family fetch fills all rows in that family**
- [ ] **Step 4: Run `node .\\tests\\fillMissingSkinImages.test.js` and verify it passes**

## Chunk 5: Surface Runtime Output

### Task 6: Print image enrichment stats in rebuild CLI

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tools/rebuildSkinDb.js`

- [ ] **Step 1: Add image stats output without breaking current detail stats format**
- [ ] **Step 2: Run `node --check tools\\rebuildSkinDb.js` and verify it passes**

## Chunk 6: Verification

### Task 7: Run the regression set

**Files:**
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/buffSkinDetailProvider.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDetailEnrichmentService.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDbSync.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/fillMissingSkinImages.test.js`

- [ ] **Step 1: Run `node .\\tests\\buffSkinDetailProvider.test.js`**
- [ ] **Step 2: Run `node .\\tests\\skinDetailEnrichmentService.test.js`**
- [ ] **Step 3: Run `node .\\tests\\skinDbSync.test.js`**
- [ ] **Step 4: Run `node .\\tests\\fillMissingSkinImages.test.js`**
- [ ] **Step 5: Run `node --check node_sidecar\\src\\services\\buffSkinDetailProvider.js`**
- [ ] **Step 6: Run `node --check node_sidecar\\src\\services\\skinDetailEnrichmentService.js`**
- [ ] **Step 7: Run `node --check node_sidecar\\src\\skinDbSync.js`**
- [ ] **Step 8: Run `node --check tools\\rebuildSkinDb.js`**
- [ ] **Step 9: Run `node --check tools\\fillMissingSkinImages.js`**

Plan complete and saved to `docs/superpowers/plans/2026-03-20-skin-image-enrichment.md`. Ready to execute.
