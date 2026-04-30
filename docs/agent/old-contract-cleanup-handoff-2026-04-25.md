# Old Contract Cleanup Handoff (2026-04-25)

## 当前目标

- 总目标：清理 `craft assist` / `batch craft` 周边残留的旧契约，避免调用侧继续混用旧字段或误把本地状态字段当成网络契约。
- 当前相关提交：
  - `c0fc29c` `Fix batch craft assist-select contract`

## 进度断点

- 当前 chunk：
  - `batch craft` 调用侧旧契约修正已完成
  - 全仓旧契约审计与收敛未完成
- 当前 task：
  - 为下个会话交接“旧契约问题”的真实现场和下一刀顺序
- 已完成：
  - 修正 [app.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js) 中 `callBatchCraftAssistSelectForAccount()`，不再发送旧字段 `wear_filter_mode / mode / fast_mode / approach_mode / exclude_item_ids`，改为当前路由契约 `wear_approach_mode / blocked_ids / enable_fast_craft_assist`，并改为直接消费返回 `item_ids`
  - 新增回归 [batch-craft-assist-select.test.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/batch-craft-assist-select.test.js)
  - 用真实本地服务 `127.0.0.1:8787` 验证过多账号 helper：
    - 成功样本存在，说明 batch helper 本身已能选出物品
    - 部分失败样本来自真实材料/阈值约束，不是“整条 batch 链路仍死”
- 未完成：
  - 梳理并决定后端兼容层 [uiServer.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js#L804) 是否继续保留
  - 清点全仓所有仍在使用旧入口名的调用点，区分哪些是“网络契约”、哪些只是“本地存储键/历史材料结构”

## 现场状态

- 工作目录：`C:/Users/18220/Desktop/cs2_alchemy`
- 分支：`main`
- 最新已提交 commit：`c0fc29c4d30c349783efa14b02ac6597f557f734`
- 当前工作树：脏
- 与本 handoff 直接相关的关键文件：
  - [app.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js)
  - [uiServer.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js)
  - [batch-craft-assist-select.test.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/batch-craft-assist-select.test.js)
  - [craft-assist-route.test.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-assist-route.test.js)

## 已确认事实

### 1. 不该再留在调用侧的旧契约

- 已修掉的 batch helper 旧字段：
  - `wear_filter_mode` 顶层传参
  - `mode`
  - `fast_mode`
  - `approach_mode`
  - `exclude_item_ids`
  - `data.runs[0]`
- 当前 `/api/craft/assist-select` 调用侧有效契约，至少对 batch helper 已确认是：
  - `target_wear`
  - `wear_approach_mode`
  - `materials`
  - `use_component_items`
  - `include_cooling`
  - `wear_offset_pct`
  - `blocked_ids`
  - `enable_fast_craft_assist`
  - 响应直接读 `item_ids`

### 2. 现在仍保留的“兼容层”不等于都该删

- [uiServer.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js#L804) 的 `buildCraftAssistSelectRoutePayload()` 当前仍兼容：
  - `include_component_items` 和 `use_component_items`
  - `blocked_ids` 和 `selected_item_ids`
  - 顶层 `wear_filter_mode`，并作为 `legacyWearFilterMode`
- 这些是后端入口兼容层，不是调用侧标准契约

### 3. 有些“看起来像旧契约”的东西其实不是网络契约

- [app.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js#L1939) 一带的 `use_component_items / fast_mode / approach_mode`
  - 这是 `batch_craft_ui_prefs_v1` 的本地偏好键
  - 不能直接把它们当成 `/api/craft/assist-select` 的旧网络字段来一刀切
- `materials[*].wear_filter_mode`
  - 这是材料项自身结构的一部分
  - 不能和顶层旧的 `wear_filter_mode` 混为一谈

### 4. 真实运行态额外线索

- 多账号 helper 在真实服务上已经验证过“可成功选出物品”
- 部分账号失败的真实原因包括：
  - `可用数量不足`
  - `产物相对磨损偏移超阈值`
- 还有一个现场口径问题：
  - 当前成功样本更稳定命中的是 `alchemy_name`（中文名）
  - 直接用快照英文化 `name` 可能失败
  - 这件事和“旧网络契约清理”相关，但不是同一层问题，不要混着改

## 已尝试但不要重做的路径

- 不要再把“多账号快捷选材”误测成单账号直接打 `/api/craft/assist-select`
  - 那只能证明底层接口，不足以证明 batch helper
- 不要再把 batch helper 的失败一律归因于“契约还坏了”
  - 已有真实样本证明 helper 能成功
  - 后续必须区分“契约问题”和“真实材料/阈值无解”
- 不要把 `localStorage` 键名和网络字段名混成一个清理任务

## 验证状态

- 已执行：
  - `node node_sidecar/tests/batch-craft-assist-select.test.js`
  - `node node_sidecar/tests/craft-assist-autoselect-writeback.test.js`
  - `node -c node_sidecar/ui/app.js`
  - 真实本地服务 `127.0.0.1:8787` 的多账号 helper 运行态验证
- 已确认结果：
  - batch helper 契约修正已生效
  - 多账号 helper 存在成功样本
- 验证缺口：
  - 还没完成“全仓旧契约调用点”的系统收敛验证
  - 还没决定是否移除 [uiServer.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js#L804) 的兼容层

## 下一步第一刀

1. 先全仓分类旧契约痕迹，不要直接删：
   - `真正的网络调用字段`
   - `后端兼容层`
   - `本地存储键`
   - `材料持久化结构`
2. 第一优先级只处理 `真正的网络调用字段`
   - 把所有调用 `/api/craft/assist-select` 的地方统一到一套字段
3. 然后再决定后端兼容层是否还需要保留
   - 若保留，要写清“只作过渡兼容”
   - 若删除，先补红灯测试证明没有剩余调用点依赖

## 下个会话启动指令

- 先读：
  - [old-contract-cleanup-handoff-2026-04-25.md](/C:/Users/18220/Desktop/cs2_alchemy/docs/agent/old-contract-cleanup-handoff-2026-04-25.md)
  - [session-log.md](/C:/Users/18220/Desktop/cs2_alchemy/docs/agent/session-log.md)
  - [memory.md](/C:/Users/18220/Desktop/cs2_alchemy/docs/agent/memory.md)
  - 当前 `git status`
- 先复述：
  - 当前目标是“旧契约收敛”，不是继续修 batch helper
  - `c0fc29c` 已经修完 batch helper 调用侧
  - 不要重做已完成的 batch helper 修正
- 第一刀动作：
  - 列出全仓所有 `/api/craft/assist-select` 相关调用点与兼容层
  - 明确哪些字段属于网络契约，哪些只是本地状态或历史数据结构
  - 若文档与现场冲突，先指出差异再动代码

## 补充提醒

- 当前工作树很脏，继续处理旧契约时不要顺手清理无关改动
- 若后续要提交“旧契约清理”，优先拆成小提交：
  - 调用侧收敛
  - 兼容层删除或保留说明
  - 持久化结构与迁移处理
