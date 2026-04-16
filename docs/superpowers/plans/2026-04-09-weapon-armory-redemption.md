# Weapon Armory Redemption Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the missing second half of weapon armory redemption so the app can discover live redemption state, redeem a reward, detect success from GC evidence, and expose the flow through a formal API and CLI.

**Architecture:** Extend the existing GC tracing layer so every Steam session keeps a live armory state snapshot. Build a redemption service on top of `sessionPool` that resolves missing parameters from that state, sends the redeem request, and waits for concrete GC success evidence before returning. Reuse that service from both `uiServer` and the existing CLI entrypoint.

**Tech Stack:** Node.js CommonJS, `globaloffensive` generated protobufs, existing `sessionPool`, plain Node tests, PowerShell test execution.

---

## Chunk 1: GC State Tracking

### Task 1: Track live armory state in `gcTrace`

**Files:**
- Modify: `node_sidecar/src/gcTrace.js`
- Test: `node_sidecar/tests/cs2-session-gc-trace.test.js`

- [ ] Step 1: Write failing tests for cached armory state snapshots and update propagation.
- [ ] Step 2: Run `node .\tests\cs2-session-gc-trace.test.js` and confirm the new assertions fail for the expected missing state reason.
- [ ] Step 3: Implement live armory state storage in `gcTrace`, including seasonal balance, XP shop notify payload, bids, and item customization notifications.
- [ ] Step 4: Export a read helper so other modules can consume the cached armory state.
- [ ] Step 5: Re-run `node .\tests\cs2-session-gc-trace.test.js` and confirm it passes.

## Chunk 2: Redemption Service

### Task 2: Add a formal weapon armory redemption service

**Files:**
- Create: `node_sidecar/src/services/weaponArmoryService.js`
- Modify: `node_sidecar/src/redeemMissionRewardWorkflow.js`
- Modify: `node_sidecar/src/redeemMissionReward.js`
- Modify: `node_sidecar/src/xpShopMessages.js`
- Test: `node_sidecar/tests/weapon-armory-service.test.js`

- [ ] Step 1: Write failing service tests for auto-resolving missing params, ambiguous bid handling, and success detection from GC evidence.
- [ ] Step 2: Run `node .\tests\weapon-armory-service.test.js` and confirm it fails before implementation.
- [ ] Step 3: Implement the new service using `sessionPool`, current account/token resolution, optional `ack_tracks`, and success/failure waiting.
- [ ] Step 4: Refactor the old debug workflow to delegate to the new service while preserving debug output fields.
- [ ] Step 5: Re-run `node .\tests\weapon-armory-service.test.js` and the existing mission reward tests until all pass.

## Chunk 3: Formal API / CLI

### Task 3: Expose redemption through `uiServer` and CLI

**Files:**
- Modify: `node_sidecar/src/uiServer.js`
- Modify: `node_sidecar/src/main.js`
- Modify: `node_sidecar/src/main_ui.js` (only if a menu entry is needed)
- Test: `node_sidecar/tests/weapon-armory-route.test.js`

- [ ] Step 1: Write failing route tests for the new POST endpoint, permission handling, and service wiring.
- [ ] Step 2: Run `node .\tests\weapon-armory-route.test.js` and confirm it fails for the expected missing route/service reasons.
- [ ] Step 3: Implement the API route and wire the CLI command to the formal service path.
- [ ] Step 4: Re-run `node .\tests\weapon-armory-route.test.js` and confirm it passes.

## Chunk 4: Docs And Verification

### Task 4: Document and verify the finished flow

**Files:**
- Modify: `node_sidecar/README.md`

- [ ] Step 1: Update README with the redemption command and API usage note.
- [ ] Step 2: Run the targeted regression set:
  - `node .\tests\redeem-mission-reward.test.js`
  - `node .\tests\xp-shop-messages.test.js`
  - `node .\tests\cs2-session-gc-trace.test.js`
  - `node .\tests\weapon-armory-service.test.js`
  - `node .\tests\weapon-armory-route.test.js`
- [ ] Step 3: Review the JSON output shape from the CLI command to ensure it includes success evidence, resolved parameters, and observed GC state.
