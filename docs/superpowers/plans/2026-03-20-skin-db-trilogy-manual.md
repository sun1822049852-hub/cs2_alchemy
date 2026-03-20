# Skin DB Trilogy Manual Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual trilogy entrypoint that fetches SteamDT base info, saves it into the current repo, then rebuilds `csgo_skins.db` and enriches missing detail fields.

**Architecture:** Keep the existing `tools/rebuildSkinDb.js` behavior as the stable “step 2 + step 3” path. Add one new SteamDT base-info provider plus one new manual CLI wrapper that performs “fetch -> save JSON -> rebuild + enrich” in order, with the hardcoded API key kept local to the new base-info path only.

**Tech Stack:** Node.js CommonJS, built-in `fetch`, existing `syncSkinDb`, existing BUFF detail provider, Windows batch wrapper, plain Node tests.

---

## Chunk 1: SteamDT Base Info Fetch

### Task 1: Add provider tests first

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/steamdtBaseInfoProvider.test.js`
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/steamdtBaseInfoProvider.js`

- [ ] **Step 1: Write a failing test for successful SteamDT base-info parsing**
- [ ] **Step 2: Run `node .\\tests\\steamdtBaseInfoProvider.test.js` and verify it fails for missing module or behavior**
- [ ] **Step 3: Implement the minimal provider with `fetchBaseInfo()` and response parsing**
- [ ] **Step 4: Re-run `node .\\tests\\steamdtBaseInfoProvider.test.js` and verify it passes**

### Task 2: Cover API failure edges

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/steamdtBaseInfoProvider.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/steamdtBaseInfoProvider.js`

- [ ] **Step 1: Add failing tests for HTTP error and malformed/unsuccessful payload**
- [ ] **Step 2: Run `node .\\tests\\steamdtBaseInfoProvider.test.js` and verify it fails for the expected reason**
- [ ] **Step 3: Implement minimal error handling**
- [ ] **Step 4: Re-run `node .\\tests\\steamdtBaseInfoProvider.test.js` and verify it passes**

## Chunk 2: Manual Trilogy Entrypoint

### Task 3: Add orchestration tests first

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/fetchAndRebuildSkinDb.test.js`
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tools/fetchAndRebuildSkinDb.js`

- [ ] **Step 1: Write a failing test that injects a fake base-info provider and fake `syncSkinDb`, then asserts fetch -> save -> rebuild order**
- [ ] **Step 2: Run `node .\\tests\\fetchAndRebuildSkinDb.test.js` and verify it fails**
- [ ] **Step 3: Implement the minimal exported runner plus CLI guard**
- [ ] **Step 4: Re-run `node .\\tests\\fetchAndRebuildSkinDb.test.js` and verify it passes**

### Task 4: Wire real runtime dependencies

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tools/fetchAndRebuildSkinDb.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tools/rebuildSkinDb.js`

- [ ] **Step 1: Reuse the existing rebuild path instead of re-implementing sync logic**
- [ ] **Step 2: Keep the hardcoded SteamDT API key local to the new fetch path**
- [ ] **Step 3: Default JSON output to repo-local `data/steam_base_info_*.json`**
- [ ] **Step 4: Re-run `node .\\tests\\fetchAndRebuildSkinDb.test.js` and `node .\\tests\\skinDbSync.test.js`**

## Chunk 3: Manual Wrapper And Docs

### Task 5: Add manual Windows wrapper

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy\\fetch_and_update_skin_db.bat`

- [ ] **Step 1: Add a batch wrapper for the new trilogy CLI**
- [ ] **Step 2: Verify the wrapper points to the new Node script and does not mention price update flow**

### Task 6: Update README

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/README.md`

- [ ] **Step 1: Document the trilogy command and the legacy JSON-only rebuild command separately**
- [ ] **Step 2: Note that price update is intentionally excluded**

## Chunk 4: Verification

### Task 7: Run verification suite

**Files:**
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/steamdtBaseInfoProvider.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/fetchAndRebuildSkinDb.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/buffSkinDetailProvider.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDetailEnrichmentService.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/skinDbSync.test.js`

- [ ] **Step 1: Run `node .\\tests\\steamdtBaseInfoProvider.test.js`**
- [ ] **Step 2: Run `node .\\tests\\fetchAndRebuildSkinDb.test.js`**
- [ ] **Step 3: Run `node .\\tests\\buffSkinDetailProvider.test.js`**
- [ ] **Step 4: Run `node .\\tests\\skinDetailEnrichmentService.test.js`**
- [ ] **Step 5: Run `node .\\tests\\skinDbSync.test.js`**
- [ ] **Step 6: Run `node --check tools\\fetchAndRebuildSkinDb.js`**
- [ ] **Step 7: Run `node --check tools\\rebuildSkinDb.js`**
- [ ] **Step 8: Run `node --check node_sidecar\\src\\services\\steamdtBaseInfoProvider.js`**

Plan complete and saved to `docs/superpowers/plans/2026-03-20-skin-db-trilogy-manual.md`. Ready to execute.
