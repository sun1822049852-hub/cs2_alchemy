# Craft Assist Float32 Step Selection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available and explicitly authorized) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将炼金辅助选材从 raw mean 十进制目标改为 `float32` 台阶命中目标。

**Architecture:** 新增独立 helper 负责 `float32` 台阶、前后台阶和 raw mean 指导区间；service 只解析并传递 `targetStepSpec`；search/prefilter/worker 用同一套 step-aware scoring 与 solved 判定。最终命中条件只以 `Math.fround(raw_mean) === targetStep` 为准，区间距离只用于排序和修正方向。

**Tech Stack:** Node.js CommonJS, built-in `assert`, existing plain Node test scripts.

---

## Must Not Change

- 不改前端交互、路由 API 形状或配方输出 UI contract。
- 不讨论、不修正磨损区间数据库。
- 当前 phase 忽略 offset 输入，不进行 offset window correction。
- 不把每件材料候选先统一做 `float32` 预处理。
- 命中目标台阶后立即返回，不在同台阶内继续优选。
- 不创建 git worktree，直接在主工作区 `C:/Users/18220/Desktop/cs2_alchemy` 修改。

## Current Code Conflicts With Spec

- `craftAssistService.js` 仍有 `STEAM_PRECISION_MARGIN`、`getCraftAssistOutcomeSafeTarget(...)`、`safeTargetValue` 和 raw `< target` 终局校验。
- `craftAssistSearch.js` 仍用 scalar `targetValue` 做 solved、score、beam pruning、role-aware correction。
- `craftAssistShardPrefilter.js` / `craftAssistShardWorker.js` 仍用 scalar distance 和 side 判断做 center overlap 与 shard ranking。
- 现有测试仍断言 below 模式是 raw `< target`，需要用新语义替换对应断言。

## Phase P1: Implementation Plan And Baseline

### Milestone P1.M1: Lock Scope And Test Entry Points

**Files:**
- Read: `node_sidecar/src/services/craftAssistService.js`
- Read: `node_sidecar/src/services/craftAssistSearch.js`
- Read: `node_sidecar/src/services/craftAssistShardPrefilter.js`
- Read: `node_sidecar/src/services/craftAssistShardWorker.js`
- Read: `tests/craftAssistService.test.js`
- Read: `tests/craftAssistSearch.test.js`
- Read: `tests/craftAssistShardPrefilter.test.js`

- [x] **P1.M1.T1.S1: Confirm exact old-target references**

  Run:
  ```powershell
  rg -n "STEAM_PRECISION_MARGIN|safeTargetValue|getCraftAssistOutcomeSafeTarget|targetValue|overall <|overall_not_below_target" node_sidecar/src/services tests
  ```

  Expected: old scalar target references are present before implementation.

- [x] **P1.M1.T1.S2: Run focused baseline tests if needed**

  Run:
  ```powershell
  node tests/craftAssistSearch.test.js
  node tests/craftAssistService.test.js
  node tests/craftAssistShardPrefilter.test.js
  ```

  Expected: existing tests describe old behavior; after RED tests are added, focused commands must fail for the new assertions first.

## Phase P2: Float32 Step Helper

### Milestone P2.M1: Add Step Math Contract

**Files:**
- Create: `node_sidecar/src/services/craftAssistFloat32Step.js`
- Create: `tests/craftAssistFloat32Step.test.js`

- [x] **P2.M1.T1.S1: Write failing helper tests**

  Cover:
  - `toFloat32(value)` returns `Math.fround(value)`.
  - `prevFloat32(step)` and `nextFloat32(step)` move one representable `float32` step.
  - `resolveCraftAssistTargetStepSpec({inputStep, approachMode: "infinite"})` targets input step.
  - `resolveCraftAssistTargetStepSpec({inputStep, approachMode: "below"})` targets previous step.
  - non-float32 input rejects with `invalid_target_step`.
  - `below` at zero rejects with `unreachable_below_target`.
  - `isMeanOnTargetStep(mean, spec)` uses `Math.fround(mean) === targetStep`.
  - `distanceFromMeanToTargetRange(mean, spec)` returns zero inside the target step preimage and positive outside.

  Run:
  ```powershell
  node tests/craftAssistFloat32Step.test.js
  ```

  Expected: FAIL because helper does not exist yet.

- [x] **P2.M1.T1.S2: Implement helper**

  Implement:
  - `toFloat32`
  - `prevFloat32`
  - `nextFloat32`
  - `resolveCraftAssistTargetStepSpec`
  - `quantizeMeanToTargetDomain`
  - `isMeanOnTargetStep`
  - `compareMeanToTargetRange`
  - `distanceFromMeanToTargetRange`

- [x] **P2.M1.T1.S3: Verify helper tests pass**

  Run:
  ```powershell
  node tests/craftAssistFloat32Step.test.js
  ```

  Expected: PASS.

## Phase P3: Service Target Step Plumbing

### Milestone P3.M1: Remove Safety Margin And Offset Path

**Files:**
- Modify: `node_sidecar/src/services/craftAssistService.js`
- Modify: `tests/craftAssistService.test.js`

- [x] **P3.M1.T1.S1: Write failing service tests**

  Cover:
  - below target `q` searches for `prevFloat32(q)`, not `q - STEAM_PRECISION_MARGIN`.
  - infinite target `q` accepts a raw mean whose `Math.fround(raw_mean) === q`.
  - non-float32 target is rejected.
  - below with `0` is rejected.
  - final validation rejects raw mean unless `Math.fround(overall) === targetStep`.
  - offset input is ignored in this phase.

  Run:
  ```powershell
  node tests/craftAssistService.test.js
  ```

  Expected: FAIL for new step-target assertions.

- [x] **P3.M1.T1.S2: Replace service target plumbing**

  Change:
  - parse target then build `targetStepSpec`.
  - remove `STEAM_PRECISION_MARGIN`.
  - remove `safeTargetValue`.
  - pass `targetStepSpec` through candidate collection, rarity solving, prefilter, search, final validation.
  - skip offset correction in current phase.
  - log both raw mean and quantized step mean.

- [x] **P3.M1.T1.S3: First-hit return across rarity loop**

  Change:
  - if a rarity branch returns a solved hit, return it immediately.
  - do not keep comparing same-step hits across later rarities.

## Phase P4: Search Step Solved, Scoring, Correction

### Milestone P4.M1: Convert Search To Step-Target

**Files:**
- Modify: `node_sidecar/src/services/craftAssistSearch.js`
- Modify: `tests/craftAssistSearch.test.js`

- [x] **P4.M1.T1.S1: Write failing search tests**

  Cover:
  - `searchCraftAssistBestSolution` returns the first complete candidate whose `Math.fround(overall)` hits target step.
  - below mode targets previous step through `targetStepSpec`.
  - scoring ranks pre-hit candidates by distance to target step raw range.
  - role-aware correction direction uses quantized mean side, not raw `< target`.
  - no same-step post-hit refinement changes the first hit.

  Run:
  ```powershell
  node tests/craftAssistSearch.test.js
  ```

  Expected: FAIL for new step semantics.

- [x] **P4.M1.T1.S2: Update scoring and solved helpers**

  Change:
  - replace scalar point distance with `distanceFromMeanToTargetRange`.
  - include `predictedStepMean` / quantized mean on scored complete candidates.
  - make solved complete candidates score first and stop immediately.
  - preserve existing stable value/id tie-breaks before hit.

- [x] **P4.M1.T1.S3: Update beam and refinements**

  Change:
  - `runBeamSearchWithinCap` returns immediately on a solved complete selection.
  - role-aware and single-material refinements stop before mutating a solved hit.
  - correction `gap` uses range direction/magnitude instead of `targetValue - overall`.

## Phase P5: Prefilter And Shard Worker Step Awareness

### Milestone P5.M1: Align Prefilter Ranking With Step Target

**Files:**
- Modify: `node_sidecar/src/services/craftAssistShardPrefilter.js`
- Modify: `node_sidecar/src/services/craftAssistShardWorker.js`
- Modify: `tests/craftAssistShardPrefilter.test.js`

- [x] **P5.M1.T1.S1: Write failing prefilter tests**

  Cover:
  - center overlap chooses candidates nearest target step raw range.
  - shard worker role side uses target step comparison semantics.
  - worker payload accepts `targetStepSpec`.
  - scalar `targetValue` remains only as compatibility fallback during transition if needed.

  Run:
  ```powershell
  node tests/craftAssistShardPrefilter.test.js
  ```

  Expected: FAIL for new step-aware assertions.

- [x] **P5.M1.T1.S2: Update prefilter and worker payloads**

  Change:
  - pass `targetStepSpec` into `runPrefilterPhase`, `processOversizedGroup`, shard payloads, and `selectShardCandidates`.
  - update trace to include `targetStep` and `inputStep`.
  - rank candidates by helper distance/side.

## Phase P6: Verification And Handoff

### Milestone P6.M1: Regression Coverage And Logs

**Files:**
- Modify: `docs/agent/session-log.md`

- [x] **P6.M1.T1.S1: Run focused verification**

  Run:
  ```powershell
  node tests/craftAssistFloat32Step.test.js
  node tests/craftAssistSearch.test.js
  node tests/craftAssistService.test.js
  node tests/craftAssistShardPrefilter.test.js
  ```

  Expected: all focused tests pass.

- [x] **P6.M1.T1.S2: Confirm old safety chain removed**

  Run:
  ```powershell
  rg -n "STEAM_PRECISION_MARGIN|safeTargetValue|getCraftAssistOutcomeSafeTarget" node_sidecar/src/services tests
  ```

  Expected: no matches in implementation/tests except historical docs if searched outside source/tests.

- [x] **P6.M1.T1.S3: Update session log**

  Append:
  - implemented helper/search/service/prefilter changes
  - tests run and exact result
  - any remaining known risk or follow-up
