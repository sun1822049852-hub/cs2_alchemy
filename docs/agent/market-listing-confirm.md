# 市场上架确认功能 — Claude 冻结断点同步

> 来源：`C:/Users/18220/.claude/projects/c--Users-18220-Desktop-cs2-alchemy/memory/market-listing-confirm.md`
>
> 同步时间：2026-04-25
>
> 注：下文是 Claude Code 在 2026-04-24 留下的冻结断点，保留其原始表述。其中文中提到的 `POST /api/steam/single-inventory` 属于当时记录；当前仓库现状已漂到 `/api/accounts/:username/inventory`，使用时以仓库现场代码为准。

# 市场上架确认功能 — 冻结断点

## 状态：Phase 1 已完成，Phase 2 规划中（plan mode 未退出）

---

## 已完成 (Phase 1): 上架后手动批量确认

### 后端
1. `node_sidecar/src/steamMarketService.js` — 新增两个函数：
   - `getMarketConfirmations({cookieString, identitySecret})` — 拉取待确认市场上架列表，过滤 type===3 (MarketListing)
   - `confirmMarketListings({cookieString, identitySecret, confirmationIds})` — 逐个确认用户勾选的项，间隔1秒
   - 已导出到 module.exports

2. `node_sidecar/src/uiServer.js` — 新增两个路由（在 batch-sell 和 price 之间，约3569-3633行）：
   - `POST /api/market/confirmations` — 获取待确认列表，返回 JSON {ok, confirmations}
   - `POST /api/market/confirm-listings` — 批量确认，返回 JSON {ok, results: [{id, success, message}]}

### 前端
3. `node_sidecar/ui/index.html` — 新增 `#marketConfirmModal` 弹窗（在 steamApiKeyModal 之前）
   - 工具栏：刷新按钮 + 全选checkbox + 待确认计数
   - 物品列表：每行有checkbox + 图标 + 标题 + 描述
   - 进度条 + 底部汇总 + "确认选中"按钮

4. `node_sidecar/ui/app.js` — 新增：
   - DOM元素注册（marketConfirm* 系列，在 marketSell* 之后）
   - `openMarketConfirmModal()` — 打开弹窗并拉取列表
   - `marketConfirmRefresh()` — 调用 /api/market/confirmations 刷新列表
   - `updateMarketConfirmSummary()` — 更新已选计数
   - `marketConfirmStart()` — 调用 /api/market/confirm-listings 批量确认
   - 上架完成(done事件) 后 setTimeout 2秒自动弹出确认弹窗
   - bindWebInvEvents 中绑定了 marketConfirm* 事件

5. `node_sidecar/ui/styles.css` — 新增 .market-confirm-* 样式 + dark gold 主题适配

### 语法检查：三文件全部通过 `node -c`

---

## 未完成 (Phase 2): 魔尊新需求 — 用GC库存替代Web库存

### 需求描述
魔尊要求：
1. **Web库存页的物品来源改为GC库存**（而非Steam Community API）
2. **Web端库存获取代码保守回退**（不删除，注释/禁用，后续可能重新启用）
3. **支持从存储单元(组件)中选择物品上架** — 先从组件取出物品，再上架

### 已勘察的关键信息

#### GC库存数据结构 (inventoryParser.js:parseOne)
```text
asset_id, def_index, paint_index, paint_seed, float_value, quality, rarity,
name, market_hash_name, casket_id, tradable_after, goods_icon_url,
alchemy_name, collection, alchemy_rarity, minfloat, maxfloat, is_craftable...
```

#### 关键关联
- GC `asset_id` === Web `assetid` — 同一个物品同一个ID
- `market_hash_name` 两边一致
- 上架API只需 `assetid` + `appid:730` + `contextid:"2"` + `price` + `currency`

#### GC库存存储
- 内存: `csgo.inventory` 数组
- JSON快照: `logs/processed_inventory/inventory_processed_{timestamp}.json`
- UI状态: `inventory_ui_state.json` 记录每账号最后 snapshot_path

#### 前端GC库存获取
- 库存页通过 refreshWorkflow 连接GC拉取
- 前端 state 中有完整的 rows 数组和 component item_map
- `state.component.item_map[componentId]` 存储各组件内物品

#### 存储单元(组件)取出
- 组件 def_index === 1201
- 物品的 casket_id 标识所属组件
- 需要搜索 moveFromCasket / retrieveFromCasket 相关函数（尚未完成勘察）

#### 当前Web库存获取流程（需要回退的代码）
- `webInvFetchInventory()` in app.js:16105 — 调用 `POST /api/steam/single-inventory`
- `renderWebInvItemGrid()` in app.js:16044 — 渲染Web库存物品卡片
- `webInvState.inventoryCache` — Map缓存Web库存数据
- 物品卡片使用字段: `icon_url`(Steam CDN), `market_hash_name`, `name`, `tradable`, `assetid`

### 实施方案（待确认）

1. **回退Web库存获取**：
   - `webInvFetchInventory()` 改名为 `webInvFetchInventory_web_disabled()` 或加 `// [DISABLED]` 注释
   - "拉取库存"按钮改为从GC快照/state中读取

2. **GC库存接入Web库存页**：
   - 新增函数从 state.rows 或 GC快照加载物品到 webInvState.inventoryCache
   - renderWebInvItemGrid 需要适配GC字段（asset_id→assetid, goods_icon_url→icon_url 等）
   - 或者在加载时做字段映射转换

3. **组件物品上架**：
   - 添加组件选择器（类似库存页的组件下拉）
   - 选中组件内物品后，先调用取出API，等取出完成后再走上架流程
   - 需要勘察 componentOpsService 中的取出函数

### 待勘察
- [ ] componentOpsService.js 中取出物品的完整API和流程
- [ ] 前端 state.rows 的完整结构和获取时机
- [ ] GC库存快照的加载API路由
- [ ] 组件物品取出后 asset_id 是否会变化（关键！）
