# 辅助选材超大材料组预筛并行设计

## 背景

当前辅助选材主流程会先为每个材料组收集候选，再按共享 rarity 构造 `groups`，最后调用 `searchCraftAssistBestSolution` 计算结果。

这套设计在语义上是正确的，但当某个材料组的候选数非常大时，单个 recipe 的计算时间会明显拉长。最近运行日志里，辅助选材请求已经出现持续一百秒以上的耗时，说明问题已经从“理论上的组合增长”变成“实际可感知的等待”。

现有后端虽然已经有 request 级 worker pool，但单个 recipe 在 worker 内仍是单线程求解。也就是说：

1. 多个 recipe 可以并行
2. 一个 recipe 内部的超大候选组不会自动拆分
3. 真正拖慢单次选材的，仍然是单个 recipe 内部的大候选空间

本设计的目标不是重写现有搜索器，而是在保持原有求解语义的前提下，为“单个材料组候选过大”的场景增加一层近似预筛，换取 2 到 4 倍的提速，并接受极小误差。

## 目标

1. 当单个材料组候选数非常大时，显著缩短单次辅助选材耗时
2. 保持现有 `searchCraftAssistBestSolution` 作为最终总搜索器，不直接改写求解语义
3. 仅在超大候选组场景触发近似预筛，小候选组路径保持不变
4. 在允许极小偏差的前提下，尽量保持成功率和 `overall` 结果稳定
5. 为新路径提供可观测日志、自动放宽重试与全量回退能力
6. 将实现影响面控制在 service 层与新增 prefilter/worker 模块，避免继续膨胀 `craftAssistSearch.js`

## 非目标

1. 不重写现有 `single_material` / `multi_material_role` / `multi_material_neutral` 的核心评分逻辑
2. 不把一个材料组真正拆成两个或四个新的业务 group
3. 不在本次设计里改 UI 配置项或新增用户侧开关
4. 不试图把所有 recipe 都改成内部多线程
5. 不承诺绝对最优解，只承诺在设定误差门槛内尽量逼近旧路径结果

## 已确认约束

### 1. 触发阈值

- 某个材料组在 rarity 过滤后的候选数 `<= 500`：不触发预筛
- 候选数 `501 ~ 1500`：切成 2 片
- 候选数 `> 1500`：切成 4 片

### 2. 语义边界

- 分片只用于“候选压缩”
- 最终仍回到原来的单个材料组
- 不给每个分片额外分配固定 `count`
- 不改变最终搜索器看到的业务约束

### 3. 精度与速度取舍

- 用户接受极小偏差
- 目标是换取约 2 到 4 倍提速
- 当近似筛选可能伤及成功率时，系统应自动放宽并在必要时回退到旧路径

### 4. 并行落点

- 不复用现有 request worker pool 承载 recipe 内部分片
- 新增独立 shard prefilter worker
- request worker 负责 orchestration，shard worker 负责单片预筛

## 方案对比

### 方案 A：把超大材料组拆成多个真实 group

思路是把一个大材料组切成两个或四个子组，再并行跑现有搜索。

优点：

1. 表面上最直观
2. 看起来容易复用已有 group 搜索逻辑

缺点：

1. 会把“一个组内任选 `count` 件”的语义改成“每个子组必须各出若干件”
2. 很容易漏掉原问题中的最优组合
3. 速度提升和结果质量都不可控

结论：不采用。

### 方案 B：对超大材料组做分片并行预筛，再回到原组总搜索

思路是仅将超大材料组的候选做临时分片，分片结果只用于产出 shortlist，最后仍以原业务 group 进入总搜索。

优点：

1. 不改变原始 group 语义
2. 速度收益集中在候选压缩阶段
3. 新旧路径边界清晰，容易回退
4. 最终决策仍由现有总搜索器完成

缺点：

1. 需要新增分片 worker 与调度模块
2. shortlist 参数需要调优

结论：采用本方案。

### 方案 C：单线程抽样压缩后直接总搜索

思路是对大候选组做 stride 抽样或窗口抽样，压缩后直接交给原搜索器，不做内部并行。

优点：

1. 改动最小
2. 逻辑简单

缺点：

1. 提速上限不高
2. 更依赖抽样质量
3. 无法充分利用多核

结论：作为未来的降级思路保留，不作为首选实现。

## 总体设计

### 总体流程

对每个 rarity 的 `groups`，主流程调整为：

1. 生成 rarity 过滤后的原始 `groups`
2. 遍历每个 group，识别是否为 oversized
3. 对非 oversized group 直接透传
4. 对 oversized group 执行 shard prefilter，得到压缩后的候选集
5. 用“压缩后的 groups”调用现有 `searchCraftAssistBestSolution`
6. 若搜索失败或结果不达标，按策略执行 expand retry 或 full fallback
7. 在所有 rarity 结果中继续沿用原有最优解比较逻辑

### 核心原则

1. 预筛只缩小候选，不决定最终解
2. 最终解依旧由现有搜索器产出
3. 超大组才触发新路径
4. 有失败放宽与全量回退，避免成功率突然下降

## 分片预筛设计

### 分片输入

预筛针对“单个材料组在当前 rarity 下的已排序候选列表”工作，输入包含：

- `material`
- 当前 rarity 下的 `sortedCandidates`
- `targetValue`
- 当前 group 的 `count`
- 当前 recipe 的 mode hint

这里的 `sortedCandidates` 沿用现有候选排序结果，不新增第二套排序标准。

### 分片数量规则

- `501 ~ 1500`：2 片
- `> 1500`：4 片

### 分片方式

首版采用 `stride + center overlap`：

1. 先保留原始排序顺序
2. 用 `index % shardCount` 做均匀切片
3. 再为每个 shard 注入一段公共 `center overlap`

其中 `center overlap` 指排序序列中最靠近 `targetValue` 的核心区间。其作用是避免最可能产出优解的一簇候选被完全打散，导致所有 shard 都只看到稀疏视图。

### overlap 规则

首版使用固定比例：

- `centerOverlapRatio = 0.1`

对应做法为：

1. 找到全量排序结果中最接近 `targetValue` 的中心位置
2. 取总候选数约 10% 的中心区间
3. 将这段中心区间追加到每个 shard 的视图中
4. shard 内部按 ID 去重，保持局部顺序稳定

### shard 输出

每个 shard 不直接给最终选材结果，只输出本片优先候选 `topK`。

首版参数：

- `topK = 40`

每个 shard 返回：

- `candidates`
- `candidateIds`
- `trace`
- `prefilterScore`

其中 `trace` 仅用于诊断，不参与最终评分。

## shortlist 合并策略

### 合并流程

所有 shard 完成后，对结果执行：

1. 合并所有 shard 的 `topK`
2. 以 ID 去重
3. 按原始候选排序重新排序
4. 应用最终 shortlist 上限

### shortlist 上限

首版建议：

- `shortlistMin = 100`
- `shortlistPerRequired = 20`
- `shortlistMax = max(shortlistMin, material.count * shortlistPerRequired)`

这样一个 oversized group 合并后通常会被压到约 100 到 200 个候选，既明显小于原始大列表，又能给总搜索器留下足够空间。

### 为什么要回到原排序

预筛阶段的使命是“缩圈”，不是重建全局优先级。重新套用原排序可以保证：

1. 与现有搜索器的窗口展开逻辑兼容
2. 降低预筛分数与总搜索分数冲突的风险
3. 减少新旧路径行为差异

## shard worker 设计

### 模块拆分

新增两个模块：

1. `node_sidecar/src/services/craftAssistShardPrefilter.js`
2. `node_sidecar/src/services/craftAssistShardWorker.js`

### `craftAssistShardPrefilter.js` 职责

负责：

1. 判断 group 是否 oversized
2. 构造 shards
3. 分发 shard worker 任务
4. 聚合、去重、重排、截断 shortlist
5. 记录 prefilter trace
6. 执行 expand retry 与 full fallback orchestration

不负责：

1. 直接产出最终 `materialResults`
2. 替代 `searchCraftAssistBestSolution`
3. 修改 rarity 选择逻辑

### `craftAssistShardWorker.js` 职责

负责：

1. 读取单片候选
2. 执行轻量预筛逻辑
3. 输出本片 `topK` 候选

不负责：

1. 访问整个 recipe 的所有 group
2. 做最终全局组合搜索
3. 使用现有 request worker pool

### 并行边界

每个 recipe 内最多只并行 shard prefilter 阶段。

最终总搜索仍在 request worker 内单次执行，原因是：

1. 总搜索依赖全局候选集
2. 并行全局搜索会引入更复杂的合并问题
3. 本设计只需把最大耗时点从“超大候选组”搬走即可

## 预筛算法

### 目标

预筛算法只需回答一个问题：

“在不看完整全局组合的前提下，本 shard 内哪些候选最值得保留下来给总搜索器？”

### 首版策略

首版不引入复杂新评分器，采用“靠近 target 的局部保留”思路：

1. 保留距离 `targetValue` 最近的一批候选
2. 对 role-aware group 额外偏向当前角色的优先侧
3. 对于单角色中性组，不施加主辅偏置
4. 在 shortlist 内保留少量两侧边缘候选，避免只剩中心小团导致补偿能力不足

这意味着 shard prefilter 本质上是一个“近目标、轻角色偏置、保留少量边界”的候选裁剪器。

### 为什么不在 shard 内跑完整搜索

因为单个 shard 看不到其他 group 的全局状态。若在 shard 内求“最终解”，得到的只会是伪全局最优。首版保持预筛简单，能显著降低实现风险。

## 失败放宽与全量回退

### 触发条件

若压缩后的 groups 进入总搜索后发生以下情况之一，则触发回退：

1. 总搜索返回 `null`
2. 无法满足 `< target`
3. 结果不通过现有后处理校验

### 两级回退

首版采用两级兜底：

1. `expand retry`
   - 将命中失败的 oversized group 的 shortlist 上限翻倍
   - 重新执行合并与总搜索

2. `full fallback`
   - 若 expand retry 后仍失败
   - 对失败 group 直接恢复到当前 rarity 下的全量候选
   - 完全回到旧路径执行总搜索

### 设计意图

1. 快路径吃性能红利
2. 慢路径用回退保住成功率
3. 避免把近似误差直接暴露成业务失败

## 接入点设计

### 主接入位置

主接入点在 `runCraftAssistSelectionForRecipe` 构造 rarity `groups` 之后、调用 `searchCraftAssistBestSolution` 之前。

伪流程如下：

1. 收集 rarity 下的原始 `groups`
2. 调用 `prefilterOversizedGroups(groups, targetValue, context)`
3. 得到 `prefilteredGroups` 与 `prefilterTrace`
4. 使用 `prefilteredGroups` 调用 `searchCraftAssistBestSolution`
5. 失败则按回退策略调整并重试
6. 成功后把 `prefilterTrace` 附加到 recipe 级 trace/log

### 为什么不直接改 `craftAssistSearch.js`

因为 `craftAssistSearch.js` 已承载：

1. mode 分流
2. 窗口扩张
3. Beam Search
4. role-aware push
5. 多种 refine 路径

把预筛硬塞进去会继续抬高复杂度，也会让搜索器同时承担“候选压缩”和“全局搜索”两类职责。将预筛留在 service 层更清晰。

## 配置项

首版以常量或 env 控制，不暴露到 UI。

建议参数：

- `OVERSIZED_2_SHARDS_THRESHOLD = 500`
- `OVERSIZED_4_SHARDS_THRESHOLD = 1500`
- `SHARD_TOP_K = 40`
- `SHARD_CENTER_OVERLAP_RATIO = 0.1`
- `SHORTLIST_MIN = 100`
- `SHORTLIST_PER_REQUIRED = 20`
- `ENABLE_OVERSIZED_PREFILTER = true|false`

其中 `ENABLE_OVERSIZED_PREFILTER` 用于一键回到旧路径。

## 日志与 Trace

### 必要日志字段

每次命中预筛路径时，记录：

1. `recipe identifier`
2. `material name`
3. `rarity`
4. `candidateCountBefore`
5. `candidateCountAfter`
6. `shardCount`
7. `centerOverlapSize`
8. `prefilterMs`
9. `finalSearchMs`
10. `totalMs`
11. `retryMode = none | expand | full`

### trace 结构

不深改现有 selection trace，仅在外层追加一个 `prefilter` 节点，包含：

- `enabled`
- `oversizedGroups`
- `beforeCounts`
- `afterCounts`
- `shardCountByGroup`
- `retryMode`
- `prefilterMs`

这样既能看出近似路径是否命中，也不会破坏当前 trace 的消费方式。

## 错误处理

### shard worker 异常

若 shard worker 本身报错：

1. 记录错误日志
2. 该 group 直接跳过近似预筛
3. 回到当前 rarity 下的全量候选

### 参数异常

若某些参数导致 shortlist 小于 `material.count`：

1. 视为参数不合法
2. 直接触发 full fallback

### 超时

若预筛并行阶段超时：

1. 终止当前 shard 任务
2. 记录超时日志
3. 对该 group 执行 full fallback

设计原则是：预筛失败不能让原本可行的 recipe 直接失败。

## 测试设计

### 单元测试

覆盖以下内容：

1. `501 ~ 1500` 正确走 2 片
2. `> 1500` 正确走 4 片
3. `center overlap` 大小与范围正确
4. shard 合并去重与原排序恢复正确
5. shortlist 上限正确
6. `expand retry` 触发正确
7. `full fallback` 触发正确
8. 小候选组完全不走预筛

### 集成测试

在 `runCraftAssistSelectionForRecipe` 级别验证：

1. 单个 group 超过阈值时会触发 prefilter
2. 多个 group 中只有 oversized 的 group 会被预筛
3. 预筛后仍能得到合法结果
4. 失败时会自动走 expand retry 与 full fallback

### 对照测试

选取一批固定 recipe 数据，对比：

1. 旧路径成功率
2. 新路径成功率
3. `overall` 差值
4. 运行耗时

建议验收门槛：

1. `overall_gap <= 0.001` 视为可接受
2. 成功率下降不超过 1%
3. 命中 oversized 路径的样本平均耗时下降到原来的 1/2 到 1/4

## 上线与回滚

### 上线步骤

1. 先实现模块、日志、测试，但默认关闭 `ENABLE_OVERSIZED_PREFILTER`
2. 在固定样本集上跑对照测试
3. 若指标达标，再默认开启

### 回滚策略

若线上发现：

1. 成功率异常下降
2. `overall` 结果明显偏离
3. 预筛超时或异常过多

可直接关闭 `ENABLE_OVERSIZED_PREFILTER`，完整回到旧路径，无需修改搜索器内核。

## 风险与缓解

### 风险 1：中心优解簇被切碎

缓解：

1. 使用 `center overlap`
2. 保留少量边界候选
3. 失败时 expand retry

### 风险 2：topK 太小导致好解被提前筛掉

缓解：

1. 首版参数保守
2. 失败时 shortlist 翻倍重试
3. 保留 full fallback

### 风险 3：并行收益不及预期

缓解：

1. 把并行局限在最贵的 oversized group
2. 用日志精确测量 `prefilterMs` 与 `finalSearchMs`
3. 若收益不足，可后续只保留压缩不并行的简化版

### 风险 4：实现复杂度侵入现有搜索器

缓解：

1. 将逻辑放在新的 prefilter 模块
2. `craftAssistSearch.js` 尽量不改或只做极小接口配合

## 最终决策

本次采用的实现方向是：

1. 对 rarity 下超大候选材料组执行 `stride + center overlap` 分片
2. `501 ~ 1500` 用 2 片，`>1500` 用 4 片
3. 通过独立 shard worker 并行做候选预筛
4. 合并成 shortlist 后，仍回到原始 group 语义
5. 用现有 `searchCraftAssistBestSolution` 做最终总搜索
6. 失败时先 expand retry，再 full fallback
7. 用开关、日志和对照测试控制放量与回滚

这保证了：

1. 新路径只优化性能热点
2. 原搜索器的最终决策语义不被直接改写
3. 速度与精度之间的风险可被监控、审计和回退
