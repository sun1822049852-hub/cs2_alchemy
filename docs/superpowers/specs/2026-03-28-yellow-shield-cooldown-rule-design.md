# 黄盾冷却与 Steam 购买冷却分流设计

> 状态：已用 live raw GC 快照核对
> 日期：2026-03-28
> 范围：主页面组件存入、炼金候选过滤、炼金执行校验
> 类型：判定规则修复，不改 UI 布局

## 目标

修复当前把所有 `tradable_after` 未来时间物品都当成“黄盾禁用”的错误行为。

本次改动要同时满足：

- 黄盾物品不能存入组件
- 黄盾物品不能参与炼金
- 炼金页勾选“显示/使用冷却物品”后，黄盾物品也不能出现
- Steam 市场购买的普通冷却物品可以存入组件
- Steam 市场购买的普通冷却物品可以按现有冷却规则参与炼金

## live raw 结论

本次以最新 raw GC 快照为准：

- `logs/raw_inventory/inventory_raw_20260328_182142.json`

当前主库存可见且仍在未来冷却中的物品共有 94 件：

- 93 件共享 attrs `[6,7,8,75,312]`
- 1 件 Steam 市场购买物品 `asset_id=50687988314` attrs 为 `[6,7,8,75]`

额外确认：

- 这 93 件 `attr#312` 物品当前全部都仍在未来冷却中
- 当前未发现“已过期但仍残留 `attr#312`”的主库存可见样本
- `attr#277` 与 `flags=24` 依然应继续视为禁用类标记
- `attr#272/273` 代表组件内条目，不属于本次黄盾判定

## 设计结论

统一新增“黄盾禁用”判定，规则为：

- `flags === 24`
- 或存在 `attr#277`
- 或存在 `attr#312`

统一新增“普通冷却”判定，规则为：

- `tradable_after > now`

两者必须拆开，不能再互相代替。

## 改动范围

### parser

在 `node_sidecar/src/inventoryParser.js` 中把 raw attrs 判定折叠成行级字段，供前后端统一消费。

建议新增：

- `trade_lock_kind`
- `yellow_shield_blocked`

其中：

- 黄盾禁用物品：`trade_lock_kind = "yellow_shield"`
- 其他物品：`trade_lock_kind = ""`

### 组件存入

`node_sidecar/src/services/componentOpsService.js`

- 不再用“未来冷却”阻止存入组件
- 改为只阻止 `yellow_shield_blocked === true`

`node_sidecar/ui/app.js`

- 主页面组件存入选择同样只禁黄盾

### 炼金候选与执行

`node_sidecar/src/services/craftCandidateService.js`

- 黄盾物品永远不进入候选
- `includeCooling` 只控制普通冷却物品

`node_sidecar/src/services/craftAssistService.js`

- 辅助选材候选复用同一规则

`node_sidecar/src/services/craftService.js`

- 执行时继续允许普通冷却的 `allowCooling`
- 无论 `allowCooling` 是否开启，黄盾都必须拒绝

## 测试策略

- parser：验证 `attr#312` 被标成黄盾，`attr#75` 单独存在时不被标黄盾
- 组件存入：验证普通冷却允许存入，黄盾拒绝存入
- 炼金候选：验证 `includeCooling=true` 时普通冷却出现、黄盾不出现
- 前端选择：验证主页面 `isInventoryRowSelectable()` 对黄盾返回 false

## 非目标

- 不修改现有冷却展示文案
- 不新增新页面或新筛选开关
- 不清理历史快照
