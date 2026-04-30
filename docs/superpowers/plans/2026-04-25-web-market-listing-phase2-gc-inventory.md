# Web Market Listing Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `Web Inventory` 上架链路的物品来源从 Steam Community inventory API 切到 GC 快照行数据，并支持从存储单元(组件)中选择物品后自动取出再上架。

**Architecture:** 前端 `Web Inventory` 页不再依赖 `/api/accounts/:username/inventory` 的轻量 Web 物品结构，而是改读 `/api/snapshot/account` 返回的 GC 快照 `rows + component`，在前端构建适合上架页的展示/选择模型。后端保留现有 `/api/market/batch-sell` 主入口，但扩展其输入，允许携带组件来源元数据；若命中组件物品，先通过 `componentOpsService.runMove(action="withdraw")` 取出，再复用现有 `sellItem()` 上架。

**Tech Stack:** `node_sidecar/ui/app.js`, `node_sidecar/src/uiServer.js`, `node_sidecar/src/services/componentOpsService.js`, `node_sidecar/src/steamMarketService.js`, `node_sidecar/src/refreshWorkflow.js`, `node_sidecar/tests/*.test.js`, 真实 Electron/Web 运行态手测。

---

## Ground Truth

- `memory/market-listing-confirm.md` 在当前仓库中不存在。本轮承接依据改为：
  - `C:/Users/18220/Desktop/cs2_alchemy/docs/agent/memory.md`
  - `C:/Users/18220/Desktop/cs2_alchemy/docs/agent/session-log.md`
  - `C:/Users/18220/Desktop/cs2_alchemy/docs/agent/steam-market-listing-id-mapping.md`
- 现状中的 `Web Inventory` 页仍在调用 `fetch(`/api/accounts/${encodeURIComponent(username)}/inventory`)`。
  - 该路由落到 `uiServer.js -> fetchFullInventory() -> inventoryService.js`
  - 返回的是 Steam Community inventory API 轻量结构：`assetid/name/market_hash_name/icon_url/tradable/...`
- GC 快照链路已经存在且稳定：
  - 刷新生成：`POST /api/refresh` -> `refreshRuntime.runRefreshJob()` -> `refreshInventory()` -> `parseInventory()` -> `saveProcessedSnapshot()`
  - 快照读取：`GET /api/snapshot/account?username=...` -> `loadSnapshotSafe()` -> `loadSnapshotRows()`
- `state.rows` 是 GC 解析后的完整行，不是 Web inventory 卡片结构。
  - 当前真实快照 `inventory_processed_20260425_113739.json` 共 `2020` 行
  - 其中主库存 `700` 行，组件内物品 `1320` 行，Storage Unit 本体 `2` 行
  - 行字段已包含 `asset_id/casket_id/market_hash_name/name/goods_icon_url/is_craftable/hidden_reason/tradable_after/...`
- `state.component.summary_map` 以组件 `asset_id` 为 key；`state.component.item_map` 以 `casket_id` 分组组件内条目。
- `componentOpsService.runMove("withdraw")` 当前返回：
  - `rows`
  - `component`
  - `snapshot_path`
  - `op.success_ids`
- 前端 `applyComponentMoveDelta()` 与相关测试都默认“取出后仍沿用原 `asset_id`，仅 `casket_id` 从组件号变成空字符串”。
- 但当前仓库里已被清理的旧快照缺口，使“取出后 `asset_id` 绝不变化”还没有拿到运行态前后快照实证。
  - 这条只能视为**基于现有代码和测试的高概率假设**
  - Phase 2 实现必须补一层运行时校验，不能直接把该假设当事实写死

## File Map

### Modify

- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`
- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js`
- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/web-inventory-bootstrap.test.js`

### Create

- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/marketListingFromGcService.js`
- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/market-listing-from-gc-service.test.js`
- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/web-inventory-gc-source.test.js`

### Reference Only

- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/componentOpsService.js`
- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/steamMarketService.js`
- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/refreshWorkflow.js`
- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/componentSummary.js`

## Invariants

- 不删除 `/api/accounts/:username/inventory` 旧路由。
- 不删除前端旧 Web inventory 拉取逻辑，只允许“注释禁用并标记 legacy fallback”。
- `Storage Unit` 本体永远不能作为上架候选。
- `转移选中` 不因本次需求自动获得“组件内物品也可直接转移”的新能力。
  - 若选中集中含组件物品，本轮至少要做阻断或提示，避免误触旧 trade-offer 链路
- 若组件取出后无法在返回的 `rows` 中用原 `asset_id` 找到“已回到主库存”的物品，必须中止上架并返回显式错误，不得盲继续调用 `/market/sellitem/`

## Chunk 1: 切换 Web Inventory 页的数据源

### Task 1: 将前端 Web Inventory 数据模型切到 GC 快照

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/web-inventory-bootstrap.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/web-inventory-gc-source.test.js`

- [ ] **Step 1: 先补红灯测试，锁定 Web Inventory 不再把 Community inventory 路由当主入口**

Run: `node node_sidecar/tests/web-inventory-bootstrap.test.js`

Expected:
- 先改测试后红灯
- 新断言要求主入口使用 `/api/snapshot/account`
- 新断言允许旧 `/api/accounts/:username/inventory` 只存在于注释禁用块，不再作为活代码主路径

- [ ] **Step 2: 在 `app.js` 增加 GC 快照到 Web Inventory 卡片的适配 helper**

Required helper responsibilities:
- 过滤掉 `Storage Unit` 本体
- 保留组件内物品
- 将 row 规范成 Web 页使用的轻量对象
- 映射字段至少包含：
  - `assetid`
  - `market_hash_name`
  - `name`
  - `image_url`
  - `source_scope` (`main` / `component`)
  - `source_component_id`
  - `source_component_name`
  - `is_component_item`
  - `can_transfer`
  - `can_list`
  - `block_reason`

- [ ] **Step 3: 将 `webInvFetchInventory()` 改为读取 `/api/snapshot/account`**

Implementation notes:
- 旧 `fetch('/api/accounts/${encodeURIComponent(username)}/inventory')` 保留为注释禁用块
- 新逻辑读取 `{rows, component, fetch_time, snapshot}`
- 通过新 helper 写入 `webInvState.inventoryCache`
- 缓存结构改为同时保留：
  - 原始 `rows`
  - `component`
  - 适配后的 `items`
  - `fetchTime`
  - `snapshotPath`

- [ ] **Step 4: 在 Web Inventory 卡片上展示来源信息并保护旧 transfer 按钮**

Required UI behaviors:
- 组件物品卡片显示来源组件名
- 组件物品与主库存物品可同时被选中
- 若选中集中包含组件物品：
  - `上架选中` 允许
  - `转移选中` 显式阻断或提示“组件内物品需先取出，本轮未扩展 trade transfer”

- [ ] **Step 5: 运行前端源码级测试**

Run:
- `node node_sidecar/tests/web-inventory-bootstrap.test.js`
- `node node_sidecar/tests/web-inventory-gc-source.test.js`

Expected:
- PASS

## Chunk 2: 扩展市场上架后端，支持组件物品先取出再上架

### Task 2: 新建组合服务，封装“withdraw -> verify -> sell”

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/services/marketListingFromGcService.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/market-listing-from-gc-service.test.js`

- [ ] **Step 1: 先写服务层红灯测试**

Test cases to add:
- 主库存物品直上架，不调用 `componentOpsService.runMove`
- 组件物品按 `source_component_id` 分组取出后再上架
- 组件取出部分失败时，仅成功取出的主/组件物品进入 sell 阶段
- 取出成功但返回 `rows` 中找不到原 `asset_id` 或仍带 `casket_id` 时，返回 `asset_id_reconcile_failed`
- `Storage Unit` 本体或缺失 `market_hash_name` 的条目直接拒绝

Run: `node node_sidecar/tests/market-listing-from-gc-service.test.js`

Expected:
- FAIL，提示新服务或新保护逻辑尚不存在

- [ ] **Step 2: 实现组合服务**

Suggested signature:

```js
async function runMarketListingFromGc({
  username,
  password,
  webSession,
  items,
  componentOpsService,
  sellItem,
  onProgress
}) {}
```

Required stages:
- 规范化请求项
- 拒绝 `Storage Unit` 本体
- 主库存项直接进入待上架队列
- 组件项先按 `source_component_id` 分组 withdraw
- 读取 `componentOpsService.runMove()` 返回的 `rows/op.success_ids`
- 对每个取出成功项执行校验：
  - `asset_id` 仍可找到
  - `casket_id` 已为空
- 只有校验通过的条目才能进入 `sellItem()`

- [ ] **Step 3: 在服务层保留资产 ID 风险保险丝**

Required behavior:
- 若任意组件物品命中 `asset_id_reconcile_failed`
  - 该物品不进入 sell 阶段
  - SSE/结果里明确回传 `asset_id`、`source_component_id`、失败原因
- 这一步是当前唯一缺少运行态实证的关键保护，不允许省略

- [ ] **Step 4: 跑服务层测试**

Run: `node node_sidecar/tests/market-listing-from-gc-service.test.js`

Expected:
- PASS

## Chunk 3: 接回 `uiServer` 路由与前端上架弹窗

### Task 3: 扩展 `/api/market/batch-sell` 输入契约，并让前端提交 GC 来源元数据

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`

- [ ] **Step 1: 扩展 `/api/market/batch-sell` 的 `items` 输入结构**

New item payload must tolerate:

```json
{
  "assetId": "48757551266",
  "priceInCents": 123,
  "currency": 23,
  "sourceScope": "component",
  "sourceComponentId": "48969275571",
  "sourceComponentName": "炼金材料2"
}
```

Compatibility rule:
- 若未携带 `sourceScope/sourceComponentId`，保持旧主库存直上架逻辑

- [ ] **Step 2: 将路由接到新组合服务**

Route flow:
- `resolveWebSessionForAccount()`
- 调用 `runMarketListingFromGc()`
- 将 withdraw / verify / sell 过程都通过 SSE 回传
- 现有成功后自动弹确认框逻辑保持不变

- [ ] **Step 3: 修改前端上架弹窗提交数据**

Front-end changes:
- `openMarketSellModal()` 不再只信任旧 `cached.items`
- 读取 GC 适配项里的：
  - `assetid`
  - `market_hash_name`
  - `image_url`
  - `source_scope`
  - `source_component_id`
  - `source_component_name`
- `marketSellStart()` 提交扩展后的 item payload

- [ ] **Step 4: 前端用 GC 图片字段，不再依赖 Community `icon_url`**

Preferred order:
- `goods_original_icon_url`
- `goods_icon_url`
- `goods_share_thumbnail_url`

- [ ] **Step 5: 跑路由/前端回归**

Run:
- `node node_sidecar/tests/web-inventory-bootstrap.test.js`
- `node node_sidecar/tests/web-inventory-gc-source.test.js`
- `node node_sidecar/tests/market-listing-from-gc-service.test.js`

Expected:
- PASS

## Manual Verification

- [ ] **Step 1: 真实运行态打开 Web Inventory 页**

Verify:
- 选中账号后点击“拉取库存”
- 页面数据来自 GC 快照，而不是 Community inventory API
- 组件内物品出现来源标记

- [ ] **Step 2: 只选主库存物品做一轮上架**

Verify:
- 不触发 withdraw
- 正常调用 `/market/sellitem/`
- 上架完成后确认弹窗仍能弹出

- [ ] **Step 3: 只选组件物品做一轮上架**

Verify:
- 先看到 withdraw 进度
- 取出成功后再进入 sell 进度
- 若任一物品取出后无法用原 `asset_id` 对上，流程明确报错并停止该物品上架

- [ ] **Step 4: 混选主库存 + 组件物品**

Verify:
- 主库存项可直接卖
- 组件项先取出后卖
- SSE 进度与最终统计正确

- [ ] **Step 5: 组件物品选中后点 `转移选中`**

Verify:
- 不进入旧 trade-offer 流程
- 有显式阻断/提示

## Residual Risks

- 当前没有保留下来的同账号前后快照实物，无法在计划阶段拿到“真实取出后 `asset_id` 不变”的直接证据。
- `goods_*_icon_url` 来自本地元数据，不是 Steam Community icon；视觉可能与旧 Web inventory 卡片略有差异，但足够满足选择/上架。
- 若用户随后要求“组件物品也支持直接交易转移”，那是另一条功能链，不能混进本 Phase 2。

## Execution Order

1. Chunk 1: 先切数据源，让页面真的看到 GC 行与组件来源
2. Chunk 2: 再补后端 withdraw -> verify -> sell 组合链
3. Chunk 3: 最后接回路由、弹窗和运行态验证
