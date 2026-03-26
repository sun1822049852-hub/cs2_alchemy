# Craft Component Withdrawable Budget Note

## 背景

炼金页面在开启“使用组件中物品”后，会显示一组与主库存 `985/1000` 不同的数字，例如：

- 库存页右上角：`985/1000`
- 炼金页标题：`组件已选 215 / 实际可从组件中取出 433`

这两个数字表达的不是同一个概念。

`985/1000` 更接近主库存当前可见占用情况。

“实际可从组件中取出 433” 是组件模式下的**取出预算**，表示：

> 在当前这批库存快照下，系统允许继续从组件中再取出多少件物品参与炼金。

它不是简单的：

```text
1000 - 当前主库存总件数
```

## 当前计算口径

核心实现位于：

- `node_sidecar/src/services/craftCandidateService.js`
  - `estimateMainInventoryFreeSlots(rows)`

当前逻辑：

1. 先取出所有 `casket_id` 为空的条目，视为主库存条目。
2. 统计其中：
   - `hiddenCount`：`hidden_reason` 非空的条目数量
   - `coolingCount`：`tradable_after` 仍在未来的条目数量
3. 计算：

```text
occupiedSlots = mainRows.length - hiddenCount - coolingCount
freeSlots = max(0, 1000 - occupiedSlots)
```

也就是说，这套预算会把 `hidden` 和 `cooling` 条目从“组件取出预算占用”里扣掉。

## 这组数字的真实语义

这里的 `freeSlots` 在当前项目里应理解为：

> 当前规则下，系统认为“还能继续从组件中取出”的物品数量。

所以 UI 已经改成：

- `可取出：N`
- `实际可从组件中取出 N`

而不再只写模糊的“可用：N”。

## 它的用途

这组预算当前被用于 3 个关键位置：

1. 候选预裁剪
   - 文件：`node_sidecar/src/services/craftCandidateService.js`
   - 作用：当组件已选数量达到预算时，隐藏其余未选中的组件候选，防止用户继续超选。

2. 前端提示
   - 文件：`node_sidecar/ui/app.js`
   - 作用：在炼金标题和库存页角标中展示“当前实际可从组件中取出”的数量，帮助用户理解组件模式下还能再拿多少件。

3. 执行前校验
   - 文件：`node_sidecar/src/services/craftTradeupWithComponentsService.js`
   - 作用：真正提交组件取出和炼金前，复用同一套预算算法，避免出现“选材时显示还能取，执行时却被另一套算法拦住”的口径分裂。

## 为什么必须单独说明

如果把这个数字误解成“主库存物理空槽”，会产生两个认知错误：

1. 看到 `985/1000` 就会误以为最多只能再取出 `15` 件。
2. 看到 `433` 又会误以为系统算错了。

但在当前项目中，`433` 表达的是**组件模式可取出预算**，不是库存页表面上的物理空槽数。

## 维护约束

后续如果再调整这套预算算法，必须同时检查下面三处是否仍然一致：

- `craftCandidateService.estimateMainInventoryFreeSlots(...)`
- `ui/app.js` 中所有展示 `实际可从组件中取出` 的文案
- `craftTradeupWithComponentsService.countMainFreeSlots(...)`

只改其中一处，会重新引入：

- 选材阶段显示可取
- 执行阶段却报空间不足

这种认知撕裂问题。
