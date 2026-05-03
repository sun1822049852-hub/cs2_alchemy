# Craft Assist Raw Below Target Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变用户十进制输入手感和后端 float32 hard contract 的前提下，把 craft assist / predictor 的 `below` 语义改为基于用户原始 raw decimal 判断，并让新旧 preset、单账号、batch、predictor 统一走同一条双字段 contract。

**Architecture:** 方案采用双字段目标契约：`target_wear_raw` 保存用户原始十进制文本，`target_wear` 保存 `Math.fround(Number(target_wear_raw))` 得到的机器 float32 台阶。共享的 raw-aware helper 负责把这两个字段解析成最终 `targetStepSpec`，backend 继续严守 `target_wear` 必须为 exact float32，frontend 只在 craft assist 专用链路做迁移、保存和请求拼装，不全局改通用 wear parsing helper。

**Tech Stack:** Node.js, Electron renderer, plain JavaScript modules, existing craft assist service/search/shard pipeline, Node built-in test runner via `node --test`.

---

## Current State

- 已审阅范围仅限当前主工作区 `C:/Users/18220/Desktop/cs2_alchemy`：
  - `docs/superpowers/specs/2026-05-02-craft-assist-raw-below-target-design.md`
  - `docs/agent/memory.md` 顶部 craft assist 相关条目
  - `docs/agent/session-log.md` 最新 `2026-05-02 handoff update - raw decimal below semantics spec drafted`
  - `git status --short --branch`
- 当前工作区本来就有未提交脏文件，包含已有 service/test/UI 改动、`AGENTS.md`，以及 `backup/ui_state/` 下的运行态快照 churn；实现时只能在本计划指定文件内增量修改，不能回滚或覆盖无关改动。
- 本计划默认不检查其他 worktree，也不把“当前 root worktree”说成“完整 repo 状态”。
- 本计划是 implementation plan only；当前没有重新运行 UI、没有跑测试、没有提交、没有 stage。
- 实现完成后也保持变更为 unstaged / uncommitted，直到用户明确要求下一步。

## Must Not Change

- 用户仍然输入 `[0,1]` 内普通十进制目标磨损，不要求用户理解 float32。
- 后端机器字段 `target_wear` 的 hard contract 不变：`Math.fround(target_wear) === target_wear`。
- `below` 仍然是严格小于；等于 raw 不算 below。
- `raw === 0` 时 `below` 仍然不可达。
- 不全局修改被其他页面复用的 generic wear parsing helper。
- 不能丢掉现有 single-account、batch、preset、draft、predictor、offset 行为。
- 本轮实现不重做 UI visibility verification，也不把静态断言伪装成 UI 已验收。

## Resolved Contract Decisions

1. 新保存的 craft assist preset，以及新的 `/api/craft/assist-select` 请求，必须同时携带：
   - `target_wear: number`，且必须是 exact float32 machine step
   - `target_wear_raw: string`，保存用户 raw decimal 文本
   - 派生规则固定为：`target_wear = Math.fround(Number(target_wear_raw))`
   - 新路径门禁：所有新保存 / 新请求 builder 都必须带 `target_wear_raw`；只有 legacy 兼容回退才允许缺失 raw，缺失 raw 不能被当成新路径合格输入。
2. `raw_vs_step` 不是对外 persisted/request field；如实现上有帮助，只能作为内部 helper return detail 存在。
3. Backend transition 行为固定为：
   - 若 `target_wear_raw` 存在：校验其可解析、finite、落在 `[0,1]`；计算 `expectedStep = Math.fround(Number(target_wear_raw))`；再校验 `target_wear` 是 exact float32 且等于 `expectedStep`；不一致则返回清晰 validation error。
   - 若 `target_wear_raw` 缺失：兼容 legacy，按“`target_wear` 同时视作 raw 和 machine step”处理；此路径保兼容，但不能恢复已经丢失的 raw intent。
4. Legacy preset migration 分型固定为：
   - raw-decimal legacy：只有 `target_wear`，且它不是 exact float32；这是**唯一**还能从 `target_wear` 反推出原始 raw intent 的 legacy 情况。按旧值的字符串形式补 `target_wear_raw=String(old)`，再把 `target_wear` 改成 `Math.fround(Number(target_wear_raw))`。
   - f32-step-only legacy：只有 `target_wear`，且它已经是 exact float32；raw intent 已经丢失，只能做保守 fallback：补 `target_wear_raw=String(target_wear)`，`target_wear` 保持不变。这里的 `below` 语义只能按 `raw=String(step)` 重新解释，所以等于 step 时仍然要走 `prevFloat32(step)`，**不能**恢复原始 `0.21` 之类的 raw intent。
   - 若 preset 已带 `target_wear_raw`，但与 `target_wear` 不匹配：frontend sanitize/load 优先相信 raw 并重写 `target_wear`；backend 对传入请求必须拒绝 mismatch。
   - 若 `target_wear_raw` 无法解析：preset/request 都应视为无效并给出清晰错误，不能静默猜测。
5. Predictor 必须和 craft assist 共用同一套 raw-aware below helper；不能假设 predictor 当前已经正确。`raw=0.21` 且 `Math.fround(raw) < raw` 必须先写失败测试。
6. Offset 语义必须保留当前 window 规则；这次只改 primary below target resolution。若实现时发现 offset 规则依赖旧 primary step，先补回归测试，再最小改动适配。

## File Ownership Map

- Shared raw-aware target semantics
  - Modify: `node_sidecar/src/services/craftAssistFloat32Step.js`
  - Test: `tests/craftAssistFloat32Step.test.js`
- Backend assist-select contract and service integration
  - Modify: `node_sidecar/src/uiServer.js`
  - Modify: `node_sidecar/src/services/craftAssistService.js`
  - Modify only if contract shape requires it: `node_sidecar/src/services/craftAssistSearch.js`
  - Modify only if contract shape requires it: `node_sidecar/src/services/craftAssistShardPrefilter.js`
  - Modify only if contract shape requires it: `node_sidecar/src/services/craftAssistShardWorker.js`
  - Test: `node_sidecar/tests/craft-assist-route.test.js`
  - Test: `tests/craftAssistService.test.js`
  - Test: `tests/craftAssistSearch.test.js`
  - Test: `tests/craftAssistShardPrefilter.test.js`
- Frontend state / preset / draft / request dual-field preservation
  - Modify: `node_sidecar/ui/app.js`
  - Test: `node_sidecar/tests/craft-assist-target-wear-step.test.js`
  - Test: `node_sidecar/tests/craft-assist-preset-apply.test.js`
  - Test: `node_sidecar/tests/craft-assist-preset-editing.test.js`
  - Test: `node_sidecar/tests/craft-assist-autoselect-writeback.test.js`
  - Test: `node_sidecar/tests/batch-craft-assist-select.test.js`
- Predictor alignment
  - Modify: `node_sidecar/src/services/craftOutcomePredictor.js`
  - Modify if predictor route normalization needs the new field: `node_sidecar/src/uiServer.js`
  - Test: `tests/craftOutcomePredictor.test.js`
  - Test if request/UI state shape needs adjustment: `node_sidecar/tests/craft-predictor-panel-state.test.js`
- Handoff / progress logging after implementation
  - Update only after code + verification are complete: `docs/agent/session-log.md`
  - Update `docs/agent/memory.md` only if a new stable long-term constraint is actually discovered

## Chunk 1: P1 Shared Raw-Aware Target Semantics

### Phase P1 - Shared raw-aware target semantics and tests

#### Milestone P1.M1 - Replace unconditional `prevFloat32(inputStep)` below logic

##### Task P1.M1.T1 - Add failing helper coverage for raw-aware below resolution

**Files:**
- Modify: `tests/craftAssistFloat32Step.test.js`
- Modify later in same task: `node_sidecar/src/services/craftAssistFloat32Step.js`

- [ ] **P1.M1.T1.S1 Write failing helper tests**
  - 在 `tests/craftAssistFloat32Step.test.js` 增加 table-driven cases，覆盖：
    - raw `0.21` 且 `Math.fround(raw) < raw` 时，`below.targetStep === Math.fround(raw)`
    - raw `0.18` 且 `Math.fround(raw) > raw` 时，`below.targetStep === prevFloat32(Math.fround(raw))`
    - raw 恰好等于 exact float32 text 时，`below.targetStep === prevFloat32(step)`
    - raw `0` 时抛 unreachable-below error
    - `infinite` 仍然命中 `Math.fround(raw)`
  - 测试命名要直接体现 raw-aware 语义，避免继续沿用“below always previous step”的旧口径。

- [ ] **P1.M1.T1.S2 Run the focused helper test and confirm it fails**
  - Run: `node --test .\tests\craftAssistFloat32Step.test.js`
  - Expected: FAIL，失败点应明确暴露当前 helper 仍把 `below` 无条件解析为 `prevFloat32(inputStep)`，至少 `raw=0.21` 断言会失败。

- [ ] **P1.M1.T1.S3 Implement the minimal shared helper change**
  - 在 `node_sidecar/src/services/craftAssistFloat32Step.js` 增加或改造一个 raw-aware resolver，输入至少能接收：
    - `inputStep`
    - `inputRaw` 或等价 `target_wear_raw`
    - `approachMode`
    - 现有 offset 参数
  - 解析规则严格落地为：
    - `step < raw` => `belowTarget = step`
    - `step >= raw` => `belowTarget = prevFloat32(step)`
    - `raw === 0` => reject unreachable
  - 保持 `targetStepSpec` 对 search/shard consumers 的消费接口尽量稳定；不要让 downstream 自己重复 parse raw。

- [ ] **P1.M1.T1.S4 Re-run the focused helper test**
  - Run: `node --test .\tests\craftAssistFloat32Step.test.js`
  - Expected: PASS，且 helper 输出继续满足现有 float32/priority/range helper 断言。

##### Task P1.M1.T2 - Lock offset semantics before backend/frontend接入

**Files:**
- Modify: `tests/craftAssistFloat32Step.test.js`
- Modify only if needed: `node_sidecar/src/services/craftAssistFloat32Step.js`

- [ ] **P1.M1.T2.S1 Add offset regression tests before touching service callers**
  - 增加覆盖，确认 active `wear_offset_pct` 下：
    - 主 target step 改为 raw-aware 结果
    - offset window 仍遵守当前方向性和窗口规则
    - `below` 不会因为 raw-aware 改动而额外放宽或缩窄 secondary window
  - 重点加入 `raw=0.21` 的 offset case，防止 primary 命中改对了，但窗口边界被带偏。

- [ ] **P1.M1.T2.S2 Run helper tests again and confirm any new offset assertions fail first**
  - Run: `node --test .\tests\craftAssistFloat32Step.test.js`
  - Expected: 若 offset 逻辑尚未适配，新断言 FAIL；若 helper 层本来已兼容，则此步可直接 PASS，并在任务备注里说明“offset helper contract 未需改动”。

- [ ] **P1.M1.T2.S3 Apply the smallest helper adjustment needed for offset compatibility**
  - 仅在测试证明有偏差时修改 helper。
  - 不新增新的公开 persisted/request field。
  - 不把 offset 语义改造成全新模型。

- [ ] **P1.M1.T2.S4 Re-run helper tests**
  - Run: `node --test .\tests\craftAssistFloat32Step.test.js`
  - Expected: PASS，raw-aware no-offset 与 raw-aware offset cases 同时通过。

## Chunk 2: P2 Backend Assist-Select Contract and Service Integration

### Phase P2 - Backend assist-select contract and service integration

#### Milestone P2.M1 - Route-level validation and normalization

##### Task P2.M1.T1 - Add failing route tests for dual-field request contract

**Files:**
- Modify: `node_sidecar/tests/craft-assist-route.test.js`
- Modify later in same task: `node_sidecar/src/uiServer.js`

- [ ] **P2.M1.T1.S1 Write failing route tests**
  - 为 `/api/craft/assist-select` 增加请求级测试，至少覆盖：
    - 新请求同时带 `target_wear_raw="0.21"` 和 `target_wear=Math.fround(0.21)` 时可通过
    - 作为新路径构造出的请求如果缺少 `target_wear_raw`，必须失败；只有 legacy compatibility 路径才能接受缺失 raw
    - `target_wear_raw` 与 `target_wear` mismatch 时被拒绝，且报 clear validation error
    - `target_wear_raw` 无法解析时被拒绝
    - 缺失 `target_wear_raw` 时 legacy fallback 仍可走通
  - 若 route 也负责 predictor 请求规范化，则把 predictor dual-field case 单独标成待后续 P4 接入，不在此任务混做。

- [ ] **P2.M1.T1.S2 Run the route test and confirm it fails**
  - Run: `node --test .\node_sidecar\tests\craft-assist-route.test.js`
  - Expected: FAIL，失败原因应体现当前 route 尚未强校验 `target_wear_raw` / `target_wear` 一致性，或未把 raw 传入 service。

- [ ] **P2.M1.T1.S3 Implement minimal route normalization and validation**
  - 在 `node_sidecar/src/uiServer.js` 中：
    - 保留 `target_wear` exact float32 validation
    - 新增 `target_wear_raw` parse + range + expectedStep 校验
    - legacy 缺失 raw 时按 `target_wear` 同时视作 raw/step
    - mismatch 直接拒绝，不静默纠正请求
  - 错误映射要继续走现有人话风格，但 message 要明确指出是 `target_wear` / `target_wear_raw` 不一致或 raw 无效。

- [ ] **P2.M1.T1.S4 Re-run the route test**
  - Run: `node --test .\node_sidecar\tests\craft-assist-route.test.js`
  - Expected: PASS。

#### Milestone P2.M2 - Service uses shared raw-aware helper without leaking raw parsing downstream

##### Task P2.M2.T1 - Add failing service tests for raw-aware selection semantics

**Files:**
- Modify: `tests/craftAssistService.test.js`
- Modify later in same task: `node_sidecar/src/services/craftAssistService.js`

- [ ] **P2.M2.T1.S1 Write failing service tests**
  - 新增或改写 service cases，覆盖：
    - `below` + raw `0.21` 命中 `step` 本身，不再降一级
    - `below` + raw `0.18` 命中 `prevFloat32(step)`
    - `below` + exact step raw 命中 `prevFloat32(step)`
    - `below` + raw `0` 被拒绝
    - `infinite` 仍命中 `step`
    - legacy fallback 仅有 `target_wear` 时仍保留旧 step-only 行为
    - 若 `wear_offset_pct` 激活，主目标变更但窗口语义不回归

- [ ] **P2.M2.T1.S2 Run the focused service test and confirm it fails**
  - Run: `node --test .\tests\craftAssistService.test.js`
  - Expected: FAIL，至少 `raw=0.21` case 会暴露 service 仍按旧 below 语义组装 `targetStepSpec`。

- [ ] **P2.M2.T1.S3 Implement minimal service integration**
  - 在 `node_sidecar/src/services/craftAssistService.js` 中把 target 解析统一委托给共享 helper。
  - service 只消费 route/调用方已规范化的 `target_wear` 与 `target_wear_raw`；不要在 search/shard 层重复解析 raw 字符串。
  - 若 `targetStepSpec` 新增内部字段，保证 search/shard consumers 只读其需要的 step/range 信息。

- [ ] **P2.M2.T1.S4 Re-run the focused service test**
  - Run: `node --test .\tests\craftAssistService.test.js`
  - Expected: PASS。

##### Task P2.M2.T2 - Add downstream regression tests before changing consumer files

**Files:**
- Modify: `tests/craftAssistSearch.test.js`
- Modify: `tests/craftAssistShardPrefilter.test.js`
- Modify only if tests prove necessary: `node_sidecar/src/services/craftAssistSearch.js`
- Modify only if tests prove necessary: `node_sidecar/src/services/craftAssistShardPrefilter.js`
- Modify only if tests prove necessary: `node_sidecar/src/services/craftAssistShardWorker.js`

- [ ] **P2.M2.T2.S1 Write regression tests that prove consumers still honor the updated targetStepSpec**
  - 在 search / prefilter regression 中增加至少一个 raw-aware primary step case 和一个 offset case。
  - 目标不是让这些层 parse raw，而是验证它们在共享 helper 产出的 `targetStepSpec` 下行为不变或只按预期改变。

- [ ] **P2.M2.T2.S2 Run downstream focused tests and confirm failure only if consumer assumptions were too rigid**
  - Run: `node --test .\tests\craftAssistSearch.test.js`
  - Run: `node --test .\tests\craftAssistShardPrefilter.test.js`
  - Expected: 理想情况是 PASS；若 FAIL，应只暴露 consumer 对旧 primary step 假设过死，而不是新引入解析问题。

- [ ] **P2.M2.T2.S3 Apply the smallest consumer-side compatibility patch only where tests demand it**
  - 只修 consumer 对 `targetStepSpec` 的读取，不让它们接触 raw parsing。
  - 不扩散改动范围到无关 shard ranking / candidate parsing 路径。

- [ ] **P2.M2.T2.S4 Re-run downstream focused tests**
  - Run: `node --test .\tests\craftAssistSearch.test.js`
  - Run: `node --test .\tests\craftAssistShardPrefilter.test.js`
  - Expected: PASS。

## Chunk 3: P3 Frontend State, Preset, Draft, and Request Dual-Field Preservation

### Phase P3 - Frontend state, preset, draft, single/batch request dual-field preservation

#### Milestone P3.M1 - Sanitize/load migration and dual-field persistence

##### Task P3.M1.T1 - Add failing frontend preset migration tests

**Files:**
- Modify: `node_sidecar/tests/craft-assist-target-wear-step.test.js`
- Modify: `node_sidecar/tests/craft-assist-preset-editing.test.js`
- Modify later in same task: `node_sidecar/ui/app.js`

- [ ] **P3.M1.T1.S1 Write failing preset migration tests**
  - 覆盖四类 preset sanitize/load 行为：
    - raw-decimal legacy：`target_wear=0.21`、无 `target_wear_raw` => 迁移后 `target_wear_raw==="0.21"`，`target_wear===Math.fround(0.21)`，并且 `below` 对原始 raw 的判断必须能命中 `step` 本身而不是再降一级
    - f32-step-only legacy：无 raw、且 `target_wear` 已是 exact float32 => 补 `target_wear_raw=String(target_wear)`，`below` 必须按 `raw=String(step)` 解释，所以等于 step 时要落到 `prevFloat32(step)`；这类迁移**不能**恢复原始 `0.21` 之类的 raw intent
    - mismatched dual-field preset：frontend load 优先 raw 并重写 step
    - unparsable raw：标记 invalid，并给出 clear failure path
  - 额外覆盖“新建/编辑 preset 保存时必须写入双字段”。

- [ ] **P3.M1.T1.S2 Run focused frontend tests and confirm failure**
  - Run: `node --test .\node_sidecar\tests\craft-assist-target-wear-step.test.js`
  - Run: `node --test .\node_sidecar\tests\craft-assist-preset-editing.test.js`
  - Expected: FAIL，当前前端只有 float32 step 量化语义，尚未稳定持有 `target_wear_raw`，也未完成 legacy migration 分型。

- [ ] **P3.M1.T1.S3 Implement minimal craft-assist-only frontend migration**
  - 在 `node_sidecar/ui/app.js` 中只修改 craft assist 专用链路：
    - `sanitizeCraftAssistPresetPayload(...)`
    - `buildCurrentCraftAssistPresetSnapshot(...)`
    - `buildCraftAssistDraftSnapshotFromState(...)`
    - `restoreCraftAssistDraftSnapshot(...)`
    - `loadCraftAssistPresetIntoDraft(...)`
  - 规则：
    - 新保存 preset 写双字段
    - 加载 legacy preset 按已定分型迁移
    - dual-field mismatch 时前端 load 侧优先 raw 重写 step
    - 通用 `parseOptionalWear01(...)` 不做全局改造

- [ ] **P3.M1.T1.S4 Re-run focused frontend tests**
  - Run: `node --test .\node_sidecar\tests\craft-assist-target-wear-step.test.js`
  - Run: `node --test .\node_sidecar\tests\craft-assist-preset-editing.test.js`
  - Expected: PASS。

#### Milestone P3.M2 - Single-account / batch request builders preserve both fields

##### Task P3.M2.T1 - Add failing request-builder tests for dual-field payloads

**Files:**
- Modify: `node_sidecar/tests/craft-assist-preset-apply.test.js`
- Modify: `node_sidecar/tests/craft-assist-autoselect-writeback.test.js`
- Modify: `node_sidecar/tests/batch-craft-assist-select.test.js`
- Modify later in same task: `node_sidecar/ui/app.js`

- [ ] **P3.M2.T1.S1 Write failing request-builder tests**
  - 覆盖：
    - 单账号 auto-select 请求体带 `target_wear` + `target_wear_raw`
    - batch account helper 请求体带 `target_wear` + `target_wear_raw`
    - 新路径请求不能退化成单字段：如果 builder 被改成只发 `target_wear`，单账号和 batch 都必须有明确失败断言
    - 从 migrated legacy preset 自动选材时，请求仍保留原始 raw text
    - `below` 不在前端提前下移；发送的 `target_wear` 必须仍是 `Math.fround(Number(target_wear_raw))`
  - 对 `raw=0.21` 显式断言，防止前端又偷偷发送 `prevFloat32(step)`。

- [ ] **P3.M2.T1.S2 Run focused request tests and confirm failure**
  - Run: `node --test .\node_sidecar\tests\craft-assist-preset-apply.test.js`
  - Run: `node --test .\node_sidecar\tests\craft-assist-autoselect-writeback.test.js`
  - Run: `node --test .\node_sidecar\tests\batch-craft-assist-select.test.js`
  - Expected: FAIL，至少一个请求快照仍缺少 `target_wear_raw` 或错误地下移了 `target_wear`。

- [ ] **P3.M2.T1.S3 Implement minimal request-builder updates**
  - 在 `node_sidecar/ui/app.js` 中仅更新 craft assist 相关请求构造点：
    - `applyCraftAssistAutoSelection(...)`
    - `callBatchCraftAssistSelectForAccount(...)`
    - 如有必要，同步 `saveCurrentCraftAssistPreset(...)` / draft restore 上游，以确保请求时总能拿到双字段
  - 不改 unrelated page / unrelated API payload。

- [ ] **P3.M2.T1.S4 Re-run focused request tests**
  - Run: `node --test .\node_sidecar\tests\craft-assist-preset-apply.test.js`
  - Run: `node --test .\node_sidecar\tests\craft-assist-autoselect-writeback.test.js`
  - Run: `node --test .\node_sidecar\tests\batch-craft-assist-select.test.js`
  - Expected: PASS。

## Chunk 4: P4 Predictor Alignment

### Phase P4 - Predictor alignment

#### Milestone P4.M1 - Predictor shares the same raw-aware below helper

##### Task P4.M1.T1 - Add failing predictor tests for raw `0.21`

**Files:**
- Modify: `tests/craftOutcomePredictor.test.js`
- Modify if predictor request shape reaches renderer/server state: `node_sidecar/tests/craft-predictor-panel-state.test.js`
- Modify later in same task: `node_sidecar/src/services/craftOutcomePredictor.js`
- Modify only if route normalization is required for predictor input: `node_sidecar/src/uiServer.js`

- [ ] **P4.M1.T1.S1 Write failing predictor tests**
  - `tests/craftOutcomePredictor.test.js` 至少增加：
    - raw `0.21` + `below` => predictor 用 `Math.fround(raw)`，不是 `prevFloat32(step)`
    - raw exact-step + `below` => predictor 用 `prevFloat32(step)`
    - raw `0` + `below` => predictor 给出不可达失败
    - `infinite` 仍用 `Math.fround(raw)`
  - 若 predictor route 或 UI state 当前没有 `target_wear_raw`，在 `node_sidecar/tests/craft-predictor-panel-state.test.js` 追加失败测试，限定只为 predictor 输入通路补双字段，不扩散到其他 panel。

- [ ] **P4.M1.T1.S2 Run predictor-focused tests and confirm failure**
  - Run: `node --test .\tests\craftOutcomePredictor.test.js`
  - Optional if touched: `node --test .\node_sidecar\tests\craft-predictor-panel-state.test.js`
  - Expected: FAIL，至少 `raw=0.21` case 会暴露 predictor 仍沿用旧 below 语义。

- [ ] **P4.M1.T1.S3 Implement minimal predictor alignment**
  - 在 `node_sidecar/src/services/craftOutcomePredictor.js` 中复用共享 raw-aware helper，而不是再复制一套判断。
  - 只有在测试证明 predictor route 入口缺少 `target_wear_raw` 时，才在 `node_sidecar/src/uiServer.js` 做 predictor 专用双字段 normalization。
  - 保持现有 predictor 其他计算、展示字段和 success shape 不变。

- [ ] **P4.M1.T1.S4 Re-run predictor-focused tests**
  - Run: `node --test .\tests\craftOutcomePredictor.test.js`
  - Optional if touched: `node --test .\node_sidecar\tests\craft-predictor-panel-state.test.js`
  - Expected: PASS。

## Chunk 5: P5 Regression Verification and Handoff

### Phase P5 - End-to-end regression/verification and doc/session handoff

#### Milestone P5.M1 - Focused regression suite for touched behavior

##### Task P5.M1.T1 - Run the focused regression suite only after all code changes land

**Files:**
- No new business-code edits in this task unless a failing regression exposes a real defect
- Update after verification only: `docs/agent/session-log.md`

- [ ] **P5.M1.T1.S1 Run shared helper and backend regressions**
  - Run: `node --test .\tests\craftAssistFloat32Step.test.js`
  - Run: `node --test .\tests\craftAssistService.test.js`
  - Run: `node --test .\tests\craftAssistSearch.test.js`
  - Run: `node --test .\tests\craftAssistShardPrefilter.test.js`
  - Run: `node --test .\node_sidecar\tests\craft-assist-route.test.js`
  - Expected: 全部 PASS。

- [ ] **P5.M1.T1.S2 Run frontend craft-assist regressions**
  - Run: `node --test .\node_sidecar\tests\craft-assist-target-wear-step.test.js`
  - Run: `node --test .\node_sidecar\tests\craft-assist-preset-apply.test.js`
  - Run: `node --test .\node_sidecar\tests\craft-assist-preset-editing.test.js`
  - Run: `node --test .\node_sidecar\tests\craft-assist-autoselect-writeback.test.js`
  - Run: `node --test .\node_sidecar\tests\batch-craft-assist-select.test.js`
  - Expected: 全部 PASS，且请求快照明确带双字段。

- [ ] **P5.M1.T1.S3 Run predictor regressions**
  - Run: `node --test .\tests\craftOutcomePredictor.test.js`
  - Optional if touched: `node --test .\node_sidecar\tests\craft-predictor-panel-state.test.js`
  - Expected: PASS，且 raw `0.21` below 行为与 craft assist helper 一致。

- [ ] **P5.M1.T1.S4 Run narrow smoke regressions for nearby UI behavior already covered by tests**
  - 说明：`node --test .\tests\craftAssistApproachModeUi.test.js` 只是辅助 smoke，不是本次 raw-below 计划的主验收门槛。
  - Run: `node --test .\tests\craftAssistApproachModeUi.test.js`
  - Expected: PASS，证明 `below` / `infinite` 邻近 UI semantics 未被误伤。

#### Milestone P5.M2 - Handoff without commit/stage

##### Task P5.M2.T1 - Record outcome and preserve dirty-worktree discipline

**Files:**
- Modify: `docs/agent/session-log.md`
- Do not modify unless a new stable rule truly emerged: `docs/agent/memory.md`

- [ ] **P5.M2.T1.S1 Write a session-log handoff after verification**
  - 记录：
    - 当前目标
    - 已完成实现范围
    - 重点测试命令与结果
    - 已知 limitation
    - 下一刀建议
  - 不在 handoff 里声称做过 UI visibility rerun，除非后续真做了并有证据。

- [ ] **P5.M2.T1.S2 Confirm the workspace remains unstaged and uncommitted**
  - Run: `git status --short --branch`
  - Expected: 只看到工作区改动；不出现 `Changes to be committed`。
  - Note: 本项目默认不提交；除非用户明确要求，否则保持 unstaged / uncommitted。

## Verification Command List

按依赖顺序执行：

```powershell
node --test .\tests\craftAssistFloat32Step.test.js
node --test .\node_sidecar\tests\craft-assist-route.test.js
node --test .\tests\craftAssistService.test.js
node --test .\tests\craftAssistSearch.test.js
node --test .\tests\craftAssistShardPrefilter.test.js
node --test .\node_sidecar\tests\craft-assist-target-wear-step.test.js
node --test .\node_sidecar\tests\craft-assist-preset-editing.test.js
node --test .\node_sidecar\tests\craft-assist-preset-apply.test.js
node --test .\node_sidecar\tests\craft-assist-autoselect-writeback.test.js
node --test .\node_sidecar\tests\batch-craft-assist-select.test.js
node --test .\tests\craftOutcomePredictor.test.js
node --test .\node_sidecar\tests\craft-predictor-panel-state.test.js
node --test .\tests\craftAssistApproachModeUi.test.js
git status --short --branch
```

预期结果：

- 在对应任务的“先写测试再实现”阶段，首轮命令应先 FAIL，且失败点与该任务目标直接对应。
- 实现最小代码后，以上命令应全部 PASS。
- `git status --short --branch` 仍显示未提交工作区改动；本轮不 stage、不 commit。

## Known Limitations

- 对于只剩 exact float32 `target_wear` 的 f32-step-only legacy preset，系统无法恢复用户最初输入的 raw decimal；只能保守回填 `target_wear_raw=String(target_wear)`，从而保留旧 step-only 行为，而不能神奇恢复诸如原始 `0.21` 这种已丢失意图。
- Legacy fallback 请求在缺失 `target_wear_raw` 时只能延续旧行为，不能获得新 raw-aware below 语义。
- 本计划故意不包含 UI visibility rerun、真实 Electron 联调、commit、stage 或其他 worktree 检查步骤；这些都超出本次 planning task 范围。
