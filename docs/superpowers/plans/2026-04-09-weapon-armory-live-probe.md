# Weapon Armory Live Probe Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only debug probe that captures login-stage weapon armory GC messages and prints state snapshots plus observed trace data without spending stars.

**Architecture:** Extend the existing `gcTrace` layer with a small in-memory history buffer for armory-relevant GC traffic so the session can preserve evidence from the moment `CS2Session.connect()` attaches tracing. Build a probe method in `weaponArmoryService` that reads this history, optionally sends `ack_tracks`, waits for more traffic, and returns structured debug output through a CLI command.

**Tech Stack:** Node.js CommonJS, existing `globaloffensive` protobufs, `sessionPool`, `gcTrace`, plain Node tests, PowerShell verification.

---

## Chunk 1: Trace History

### Task 1: Preserve armory-relevant GC message history

**Files:**
- Modify: `node_sidecar/src/gcTrace.js`
- Modify: `node_sidecar/src/cs2Session.js`
- Test: `node_sidecar/tests/cs2-session-gc-trace.test.js`

- [ ] Step 1: Write the failing test for reading recent armory GC history from `gcTrace`.
- [ ] Step 2: Run `node .\tests\cs2-session-gc-trace.test.js` and confirm the new assertion fails for the missing history reader.
- [ ] Step 3: Add a bounded recent-history buffer that records armory-relevant message summaries from inbound, outbound, and callback directions.
- [ ] Step 4: Export a read helper via `gcTrace` and re-export it from `cs2Session`.
- [ ] Step 5: Re-run `node .\tests\cs2-session-gc-trace.test.js` and confirm it passes.

## Chunk 2: Probe Service

### Task 2: Add a read-only armory probe workflow

**Files:**
- Modify: `node_sidecar/src/services/weaponArmoryService.js`
- Test: `node_sidecar/tests/weapon-armory-service.test.js`

- [ ] Step 1: Write the failing test for a probe method that returns `before_state`, `after_state`, and `observed_gc_messages`.
- [ ] Step 2: Run `node .\tests\weapon-armory-service.test.js` and confirm the new probe assertion fails before implementation.
- [ ] Step 3: Implement a read-only probe helper that optionally sends `ack_tracks`, waits, and returns trace history plus armory snapshots.
- [ ] Step 4: Expose the probe helper through `createWeaponArmoryService`.
- [ ] Step 5: Re-run `node .\tests\weapon-armory-service.test.js` and confirm it passes.

## Chunk 3: CLI Entry

### Task 3: Expose the probe from `main.js`

**Files:**
- Modify: `node_sidecar/src/main.js`

- [ ] Step 1: Add a CLI command such as `weapon-armory-probe` / `xpshop-probe`.
- [ ] Step 2: Reuse existing account/token resolution and print probe JSON.
- [ ] Step 3: Update help output so the command is discoverable.

## Chunk 4: Verification

### Task 4: Verify with tests and a live read-only probe

**Files:**
- None

- [ ] Step 1: Run `node .\tests\cs2-session-gc-trace.test.js`.
- [ ] Step 2: Run `node .\tests\weapon-armory-service.test.js`.
- [ ] Step 3: Run `node .\src\main.js weapon-armory-probe --account x833830262 --wait-ms 6000`.
- [ ] Step 4: Confirm the output is read-only and includes `before_state`, `after_state`, and captured GC message summaries.
