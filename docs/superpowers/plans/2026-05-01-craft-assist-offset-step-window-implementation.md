# Craft Assist Offset Step Window Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make craft assist use the existing positive wear offset as a prioritized float32 target-step window.

**Architecture:** Extend the existing float32 helper so a target spec can describe a primary target step plus an allowed lower/upper step window. Search, service, and prefilter keep using the same `targetStepSpec` object, but scoring and final validation accept any allowed step while ranking allowed hits by priority.

**Tech Stack:** Node.js CommonJS, built-in `assert`, existing plain Node test scripts.

---

## Must Not Change

- Do not change UI controls, API field names, or route response shape.
- Do not change wear-range database values.
- Do not reintroduce `STEAM_PRECISION_MARGIN`, `safeTargetValue`, or raw `< target` as the authoritative step hit rule.
- Do not convert every material candidate to float32 before search.
- Do not touch unrelated dirty UI files in this working tree.
- Do not commit unless the user explicitly asks.

## Phase P1: Helper Contract

### Milestone P1.M1: Target Window Math

**Files:**
- Modify: `node_sidecar/src/services/craftAssistFloat32Step.js`
- Modify: `tests/craftAssistFloat32Step.test.js`

- [ ] **P1.M1.T1.S1: Write failing helper tests**

  Add tests for:
  - `below` with offset has `targetStep = prevFloat32(inputStep)`, `upperTargetStep = targetStep`, and `lowerTargetStep <= Math.fround(inputStep - offsetValue)`.
  - `infinite` with offset includes both lower and upper target steps.
  - no-offset specs remain single-step.
  - primary-step priority beats offset-step priority.
  - `infinite` equal-distance tie prefers lower wear.

  Run:
  ```powershell
  node tests/craftAssistFloat32Step.test.js
  ```

  Expected: FAIL because offset-window helpers do not exist yet.

- [ ] **P1.M1.T1.S2: Implement helper window fields and priority**

  Add:
  - `offsetValue` input to `resolveCraftAssistTargetStepSpec`.
  - `lowerTargetStep`, `upperTargetStep`, `hasOffsetWindow`.
  - `isMeanOnPrimaryTargetStep`.
  - `targetStepPriorityTuple`.
  - window-aware `isMeanOnTargetStep`, `compareMeanToTargetRange`, and `distanceFromMeanToTargetRange`.

- [ ] **P1.M1.T1.S3: Verify helper tests pass**

  Run:
  ```powershell
  node tests/craftAssistFloat32Step.test.js
  ```

  Expected: PASS.

## Phase P2: Search And Prefilter Ranking

### Milestone P2.M1: Prioritized Allowed Hits

**Files:**
- Modify: `node_sidecar/src/services/craftAssistSearch.js`
- Modify: `node_sidecar/src/services/craftAssistShardPrefilter.js`
- Modify: `node_sidecar/src/services/craftAssistShardWorker.js`
- Modify: `tests/craftAssistSearch.test.js`
- Modify: `tests/craftAssistShardPrefilter.test.js`

- [ ] **P2.M1.T1.S1: Write failing search and prefilter tests**

  Cover:
  - search picks primary `below` step over a lower allowed offset step when both exist.
  - search returns lower allowed offset step when primary is unavailable.
  - prefilter / shard worker rank candidates by target-window priority.

  Run:
  ```powershell
  node tests/craftAssistSearch.test.js
  node tests/craftAssistShardPrefilter.test.js
  ```

  Expected: FAIL for offset-window expectations.

- [ ] **P2.M1.T1.S2: Update scoring**

  Change step-aware score prefixes so:
  - primary allowed hit can return immediately.
  - non-primary allowed hit is ranked before outside-window candidates but does not block a later primary hit.
  - outside-window candidates still sort by distance to the allowed target window.

- [ ] **P2.M1.T1.S3: Update prefilter distance and worker scoring**

  Use helper priority for candidates inside the allowed window and helper distance for candidates outside it.

## Phase P3: Service Offset Plumbing

### Milestone P3.M1: Use Existing UI Offset

**Files:**
- Modify: `node_sidecar/src/services/craftAssistService.js`
- Modify: `tests/craftAssistService.test.js`

- [ ] **P3.M1.T1.S1: Write failing service tests**

  Replace the old "offset ignored" test with:
  - no-offset/default zero offset remains single-step.
  - `below` offset accepts a lower allowed step when primary is unavailable.
  - `below` offset rejects a result below the lower target boundary.
  - `infinite` offset can accept a higher-side step when input and lower-side steps are unavailable.

  Run:
  ```powershell
  node tests/craftAssistService.test.js
  ```

  Expected: FAIL until service passes offset into the target spec and final validation accepts the window.

- [ ] **P3.M1.T1.S2: Pass absolute offset into target spec**

  Use:
  ```js
  const offsetValue = getCraftAssistWearOffsetByTarget(targetValue, wearOffsetPct);
  ```

  Then pass `offsetValue` to `resolveCraftAssistTargetStepSpec(...)`.

- [ ] **P3.M1.T1.S3: Keep best allowed offset hit across rarity branches**

  Return immediately only for primary-step hits. Keep non-primary allowed hits as fallback and replace them when a later branch has a better target-step priority.

## Phase P4: Verification And Handoff

### Milestone P4.M1: Focused Regression

**Files:**
- Modify: `docs/agent/session-log.md`
- Modify: `docs/agent/memory.md` if this creates a stable rule.

- [ ] **P4.M1.T1.S1: Run focused tests**

  Run:
  ```powershell
  node tests/craftAssistFloat32Step.test.js
  node tests/craftAssistSearch.test.js
  node tests/craftAssistShardPrefilter.test.js
  node tests/craftAssistService.test.js
  node tests/craftOutcomePredictor.test.js
  ```

  Expected: PASS.

- [ ] **P4.M1.T1.S2: Confirm old safe-target chain stays removed**

  Run:
  ```powershell
  rg -n "STEAM_PRECISION_MARGIN|getCraftAssistOutcomeSafeTarget|safeTargetValue" node_sidecar/src/services tests
  ```

  Expected: no matches.

- [ ] **P4.M1.T1.S3: Update handoff**

  Record:
  - offset-window semantics
  - changed files
  - verification commands and results
  - any residual risk
