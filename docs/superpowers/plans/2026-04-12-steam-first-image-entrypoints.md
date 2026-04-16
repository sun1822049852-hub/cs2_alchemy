# Steam-First Image Entrypoints Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every image-enrichment entrypoint uses the same `Steam first -> Buff fallback` provider chain.

**Architecture:** Keep image resolution logic centralized in `createSteamFirstSkinDetailProvider`, and make remaining tool entrypoints consume that provider instead of constructing a Buff-only provider directly. Add a tool-level regression test that proves a no-`buffid` row can still be enriched via Steam static mapping.

**Tech Stack:** Node.js, `node:sqlite`, existing enrichment services and tests.

---

### Task 1: Lock the remaining tool entrypoint with a failing test

**Files:**
- Modify: `tests/enrichMissingImagesTool.test.js`

- [ ] Add a regression test that creates a temp `skin` DB row with no `buffid`, missing images, and a Steam-resolvable skin family.
- [ ] Run `node .\tests\enrichMissingImagesTool.test.js` and verify the new test fails before implementation.

### Task 2: Switch the tool to the shared Steam-first provider

**Files:**
- Modify: `tools/enrichMissingImages.js`

- [ ] Replace the Buff-only provider construction with `createSteamFirstSkinDetailProvider`.
- [ ] Pass through `steamImageOptions` so tests can feed deterministic static fixtures.
- [ ] Re-run `node .\tests\enrichMissingImagesTool.test.js` and verify it passes.

### Task 3: Re-run the affected verification set

**Files:**
- No code changes expected

- [ ] Run `node .\tests\skinDetailEnrichmentService.test.js`
- [ ] Run `node .\tests\fillMissingSkinImages.test.js`
- [ ] Run `node .\tests\enrichInventoryDisplayOnlyImagesTool.test.js`
- [ ] Report the actual outputs and any residual coverage gaps.
