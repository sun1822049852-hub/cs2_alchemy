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
6. 若搜索失败或结果不达标，按策略执行 expand retry 或 `rarity full fallback`
7. 在所有 rarity 结果中继续沿用原有最优解比较逻辑

### 核心原则

1. 预筛只缩小候选，不决定最终解
2. 最终解依旧由现有搜索器产出
3. 超大组才触发新路径
4. 有失败放宽与全量回退，避免成功率突然下降

## 接口与数据结构

### `targetValue` 定义

预筛使用的 `targetValue` 与总搜索完全同源，不额外引入第二个目标值。

具体定义为：

1. 来源于 `runCraftAssistSelectionForRecipe` 中已经计算出的 `safeTargetValue`
2. 作用域是“当前 recipe、当前 rarity 求解尝试”
3. 对同一次 rarity 求解中的所有 group 保持相同
4. 与现有候选字段 `candidate.value` 使用同一口径，均为相对磨损 `0~1`

因此：

- `center overlap` 的中心位置，以 `candidate.value` 与该 `targetValue` 的距离计算
- shard 内“距离目标最近”的判断，也统一使用 `abs(candidate.value - targetValue)`

### `Group` 输入结构

预筛看到的 group 与现有总搜索保持同型：

```js
{
  index: number,
  material: {
    name: string,
    role?: "main" | "aux",
    count: number,
    ...existingMaterialFields
  },
  candidates: Array<{
    id: string,
    value: number,
    relative_value: number,
    row: object,
    ...existingCandidateFields
  }>
}
```

### 不可变约束

`prefilterOversizedGroups` 不直接修改传入的 `groups` 或其中的 candidate 对象。

规则为：

1. 输入 `groups` 视为只读
2. 非 oversized group 原样透传
3. oversized group 返回新的浅拷贝 group，替换其 `candidates`
4. candidate 对象本身不重建，只按原对象引用组装新数组

### `prefilterOversizedGroups` 接口

实现时应落为一个可直接测试的 service 级接口：

```js
async function prefilterOversizedGroups({
  groups,
  targetValue,
  recipeContext,
  options
}) {
  return {
    groups: prefilteredGroups,
    prefilterTrace,
    retryMode: "none" | "expand" | "rarity_full",
    prefilteredIndexes: number[],
    groupFallbackIndexes: number[],
    usedRarityFullFallback: boolean
  };
}
```

其中：

```js
recipeContext = {
  recipeNo: number,
  rarity: number,
  modeHint: "single_material" | "multi_material_role" | "multi_material_neutral",
  sourceText: string
}
```

`options` 至少包含：

```js
{
  oversized2ShardsThreshold: number,
  oversized4ShardsThreshold: number,
  topK: number,
  edgeKeepPerSide: number,
  expandTopK: number,
  expandEdgeKeepPerSide: number,
  shortlistMin: number,
  shortlistPerRequired: number,
  shortlistHardMax: number,
  centerOverlapRatio: number,
  centerOverlapMin: number,
  centerOverlapMax: number,
  shardJobTimeoutMs: number,
  prefilterGroupTimeoutMs: number,
  prefilterCallTimeoutMs: number
}
```

`options` 的优先级固定为：

`显式函数传参 > env 覆盖 > 内部默认常量`

### role 归一化规则

shard payload 中的 `role` 不直接照抄 `material.role`，而是按当前 `modeHint` 归一化：

```js
normalizeShardRole({modeHint, materialRole}) {
  if (modeHint === "single_material") return "neutral";
  if (modeHint === "multi_material_neutral") return "neutral";
  return materialRole === "aux" ? "aux" : "main";
}
```

因此：

1. `single_material` 一律传 `neutral`
2. `multi_material_neutral` 一律传 `neutral`
3. `multi_material_role` 下，`material.role === "aux"` 传 `aux`
4. `multi_material_role` 下，其余情况一律按 `main` 处理

### shard job payload/response

为减少线程间复制成本，shard worker 不接收完整 row 对象，只接收最小摘要字段。

payload：

```js
{
  recipeNo: number,
  groupIndex: number,
  shardIndex: number,
  shardCount: number,
  role: "main" | "aux" | "neutral",
  targetValue: number,
  topK: number,
  edgeKeepPerSide: number,
  candidates: Array<{
    id: string,
    value: number,
    orderedIndex: number
  }>
}
```

response：

```js
{
  groupIndex: number,
  shardIndex: number,
  selectedIds: string[],
  stats: {
    inputCount: number,
    outputCount: number,
    preferredSideCount: number,
    oppositeSideCount: number
  }
}
```

父级 prefilter 模块用 `id -> originalCandidate` 的映射恢复原候选对象。

同一 group 内 `candidate.id` 必须唯一。该约束与现有候选收集阶段按资产 ID 去重的行为保持一致。若 prefilter 前检测到重复 ID：

1. 记录错误日志
2. 跳过该 group 的预筛
3. 对该 group 执行 `group full fallback`

## 分片预筛设计

### 分片输入

预筛针对“单个材料组在当前 rarity 下的已排序候选列表”工作，输入包含：

- `material`
- 当前 rarity 下的 `sortedCandidates`
- `targetValue`
- 当前 group 的 `count`
- 当前 recipe 的 mode hint

这里的 `sortedCandidates` 沿用现有候选排序结果，不新增第二套排序标准。排序前置条件明确如下：

1. 候选排序发生在现有 `collectCraftAssistCandidatesForMaterial` 阶段
2. rarity 过滤只做筛选，不重新打乱顺序
3. `orderedIndex` 定义为“当前 rarity 下候选数组中的索引位置”，在分片前一次性生成
4. 预筛恢复原排序时只依赖这个 `orderedIndex`
5. 最终总搜索仍会在 `searchCraftAssistBestSolution` 内按自身 mode 重新建序，预筛并不要求与搜索器内部 comparator 完全相同

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
- `centerOverlapMin = 24`
- `centerOverlapMax = 120`

对应做法为：

1. 找到全量排序结果中最接近 `targetValue` 的中心位置
2. 取总候选数约 10% 的中心区间，并夹在 `[24, 120]`
3. 将这段中心区间追加到每个 shard 的视图中
4. shard 内部按 ID 去重，保持局部顺序稳定

### shard 输出

每个 shard 不直接给最终选材结果，只输出本片优先候选 `topK`。

首版参数：

- `topK = 40`
- `edgeKeepPerSide = 4`

每个 shard 返回：

- `selectedIds`
- `stats.inputCount`
- `stats.outputCount`
- `stats.preferredSideCount`
- `stats.oppositeSideCount`

其中 shard 级 `stats` 仅用于诊断与 trace，不参与最终评分。

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
- `shortlistHardMax = 240`
- `shortlistMax = min(shortlistHardMax, max(shortlistMin, material.count * shortlistPerRequired))`

若 `material.count > shortlistHardMax`，说明该 group 仅靠预筛上限就无法容纳法定选材数量。此时不进入分片预筛，直接对该 group 执行 `group full fallback`。

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
6. 执行 expand retry、`group full fallback` 与 `rarity full fallback` orchestration

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

### 执行模型

首版明确采用 `worker_threads`，不使用 `child_process`。

原因：

1. 当前项目已经使用 `worker_threads` 承载 request 级 worker
2. 预筛任务是 CPU 型短任务，适合线程化
3. `worker_threads` 更容易在本地进程内传递小型摘要 payload

运行时基线定为 Node.js 18+。`availableParallelism()` 来自 `node:os`；若当前环境不存在该 API，则退化到固定并发回退分支。

### 并发与背压

首版不做全局常驻 shard pool，而是在单个 request worker 内为当前 recipe 临时创建 shard worker，并在任务结束后立即回收。

规则为：

1. 单个 recipe 的最大 shard 数只有 2 或 4
2. `maxShardConcurrency = min(shardCount, 4, max(1, availableParallelism() - 1))`
3. 多出来的 shard 按 FIFO 在 recipe 内排队
4. 若某 recipe 命中多个 oversized group，则按 group 顺序逐个预筛，不同时并行多个 group

若当前 Node 运行时不支持 `availableParallelism()`，则退化为：

`maxShardConcurrency = min(shardCount, 2)`

这意味着：

1. 并行只发生在“同一个 oversized group 的多个 shard”之间
2. recipe 级背压由现有 request worker pool 负责
3. shard 级背压由当前 recipe 内的临时队列负责

### 资源隔离

资源隔离规则如下：

1. shard worker 只接收最小候选摘要，不传完整 `row`
2. 单个 shard worker 只处理一个 shard 任务
3. 任一 shard 超时或崩溃，只影响当前 group 的预筛，不拖垮整个进程
4. 预筛决策一旦进入 `rarity full fallback`，尚未完成的 shard worker 全部终止并忽略结果

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

首版不引入复杂新评分器，采用确定性的“三段保留”规则：

1. `core keep`：优先保留距离 `targetValue` 最近的主体候选
2. `preferred-side bias`：对 role-aware group 优先覆盖角色偏好侧
3. `edge keep`：在两侧各保留少量分布边缘点，避免补偿能力被裁没

### 确定性评分规则

对 shard 内每个候选，基于 `candidate.value` 计算：

```js
distance = Math.abs(candidate.value - targetValue)
wrongSidePenalty =
  role === "main" ? (candidate.value < targetValue ? 1 : 0) :
  role === "aux"  ? (candidate.value > targetValue ? 1 : 0) :
  0
```

核心排序 tuple 为：

- `main`：`[wrongSidePenalty, distance, -value, orderedIndex]`
- `aux`：`[wrongSidePenalty, distance, value, orderedIndex]`
- `neutral`：`[distance, orderedIndex]`

### 确定性保留规则

在 `topK = 40`、`edgeKeepPerSide = 4` 的默认下：

1. 先按上面的 tuple 选出 `coreCount = topK - edgeKeepPerSide * 2 = 32`
2. 再从 `< targetValue` 一侧按等距分位点补 `4` 个 `edgeBelow`
3. 再从 `> targetValue` 一侧按等距分位点补 `4` 个 `edgeAbove`
4. 若某一侧不足，则把缺口回补给 `core keep`
5. 最终按 ID 去重，恢复原 `orderedIndex` 顺序输出

所谓“等距分位点”指在该侧的升序列表中按固定索引采样，例如：

```js
index = round(i * (side.length - 1) / (edgeKeepPerSide - 1))
```

`i` 从 `0` 到 `edgeKeepPerSide - 1`。

这保证边缘保留规则可实现、可测试、可复现。

### 预筛伪代码

```js
for each oversized group:
  ordered = existing sorted candidates
  shardCount = resolveShardCount(ordered.length)
  shards = buildStrideShardsWithCenterOverlap(ordered, shardCount, targetValue)
  run shard workers with bounded concurrency
  mergedIds = union(shard.selectedIds)
  mergedCandidates = restore original candidates by id
  mergedCandidates = stable sort by original ordered index
  shortlistMax = min(shortlistHardMax, max(shortlistMin, material.count * shortlistPerRequired))
  shortlist = mergedCandidates.slice(0, shortlistMax)
  replace group.candidates with shortlist
```

### 为什么不在 shard 内跑完整搜索

因为单个 shard 看不到其他 group 的全局状态。若在 shard 内求“最终解”，得到的只会是伪全局最优。首版保持预筛简单，能显著降低实现风险。

## 失败放宽与全量回退

### 回退作用域定义

为避免语义混用，本设计只允许两种回退作用域：

1. `group full fallback`
   - 仅当前 oversized group 恢复为当前 rarity 下的全量候选
   - 触发场景：重复 ID、单 group shard 崩溃、单 group shard 超时、参数不合法

2. `rarity full fallback`
   - 当前 rarity 尝试中所有已命中预筛的 oversized group 全部恢复为全量候选
   - 触发场景：base + expand 之后总搜索仍失败，或本次 prefilter 调用超出总预算

### 触发条件

若压缩后的 groups 进入总搜索后发生以下情况之一，则触发回退：

1. 总搜索返回 `null`
2. 总搜索或后处理得到的 `overall >= targetValue`
3. 结果不通过现有后处理校验

这里的成功判定固定为：

```js
success =
  solved != null
  && Number.isFinite(solved.overall)
  && solved.overall < targetValue
  && existing post-processing / offset correction does not raise overall to >= targetValue
```

只要上述任一条件不成立，就视为当前 rarity 尝试失败。

### 两级回退

由于总搜索失败时无法准确归因到“哪一个 oversized group 导致失败”，首版采用“对当前 rarity 尝试中所有预筛 group 统一放宽”的保守策略。

首版采用两级兜底：

1. `expand retry`
   - 重新执行全部 shard worker
   - 将本次 rarity 尝试中所有预筛 oversized group 的 `topK` 从 `40` 提升到 `80`
   - 将 `edgeKeepPerSide` 从 `4` 提升到 `8`
   - 将 `shortlistMax` 在不超过 `SHORTLIST_HARD_MAX` 的前提下翻倍
   - 重新执行合并与总搜索

2. `rarity full fallback`
   - 若 expand retry 后仍失败
   - 对本次 rarity 尝试中所有预筛 oversized group 直接恢复到当前 rarity 下的全量候选
   - 完全回到旧路径执行总搜索

### 设计意图

1. 快路径吃性能红利
2. 慢路径用回退保住成功率
3. 避免把近似误差直接暴露成业务失败

### 回退顺序

对单个 rarity 的一次求解尝试，顺序固定为：

1. `prefilter/base`
2. `prefilter/expand`
3. `rarity full fallback`

不会出现“只对其中一个 oversized group 做 expand、另一个不做”的分裂行为。首版故意牺牲部分精细度，换取实现一致性与更容易测试的状态机。

### Phase 状态机

| Phase | 进入条件 | 成功退出 | 失败退出 | 超时/异常处理 |
|------|----------|----------|----------|---------------|
| `prefilter/base` | 当前 rarity 存在 oversized group，且未命中 group-level fallback | 进入总搜索，若成功则结束该 rarity | 进入 `prefilter/expand` | 若发生 `group full fallback`，仅该 group 回全量后继续本 phase；若发生 call timeout，则直接进入 `rarity full fallback` |
| `prefilter/expand` | base phase 的总搜索失败 | 进入总搜索，若成功则结束该 rarity | 进入 `rarity full fallback` | 本 phase 重新计算 call budget；若发生 call timeout，则直接进入 `rarity full fallback` |
| `rarity full fallback` | base/expand 都失败，或任一 phase 命中 call timeout | 用当前 rarity 下所有 oversized group 的全量候选重跑旧路径 | 若旧路径仍失败，则由外层 rarity 循环继续比较其它 rarity 或最终返回失败 | 进入该 phase 后终止并忽略所有尚未完成的 shard worker 结果 |

### mixed-state 规则

本设计对 mixed-state 的定义明确如下：

1. `group full fallback` 是允许的。也就是同一个 phase 内，部分 group 可保留预筛结果，部分 group 因错误/参数/单组超时回到全量候选。
2. `call timeout mixed-state` 是不允许的。只要某个 phase 命中 `PREFILTER_CALL_TIMEOUT_MS`，该 phase 内所有已完成和未完成的预筛结果一律作废，直接进入 `rarity full fallback`。

## 接入点设计

### 主接入位置

主接入点在 `runCraftAssistSelectionForRecipe` 构造 rarity `groups` 之后、调用 `searchCraftAssistBestSolution` 之前。

伪流程如下：

1. 收集 rarity 下的原始 `groups`
2. 调用 `prefilterOversizedGroups({groups, targetValue, recipeContext, options})`
3. 得到 `prefilteredGroups` 与 `prefilterTrace`
4. 使用 `prefilteredGroups` 调用 `searchCraftAssistBestSolution`
5. 失败则按回退策略调整并重试
6. 成功后把 `prefilterTrace` 附加到 recipe 级 trace/log

### 返回 trace 结构

`prefilterTrace` 至少包含：

```js
{
  enabled: boolean,
  retryMode: "none" | "expand" | "rarity_full",
  targetValue: number,
  groupFallbackIndexes: number[],
  groups: Array<{
    groupIndex: number,
    materialName: string,
    shardCount: number,
    candidateCountBefore: number,
    candidateCountAfter: number,
    centerOverlapSize: number,
    shardStats: Array<{
      shardIndex: number,
      inputCount: number,
      outputCount: number,
      preferredSideCount: number,
      oppositeSideCount: number
    }>
  }>,
  prefilterMs: number
}
```

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
- `SHARD_EDGE_KEEP_PER_SIDE = 4`
- `EXPAND_SHARD_TOP_K = 80`
- `EXPAND_SHARD_EDGE_KEEP_PER_SIDE = 8`
- `SHARD_CENTER_OVERLAP_RATIO = 0.1`
- `SHARD_CENTER_OVERLAP_MIN = 24`
- `SHARD_CENTER_OVERLAP_MAX = 120`
- `SHORTLIST_MIN = 100`
- `SHORTLIST_PER_REQUIRED = 20`
- `SHORTLIST_HARD_MAX = 240`
- `SHARD_JOB_TIMEOUT_MS = 5000`
- `PREFILTER_GROUP_TIMEOUT_MS = 15000`
- `PREFILTER_CALL_TIMEOUT_MS = 30000`
- `ENABLE_OVERSIZED_PREFILTER = true|false`

其中 `ENABLE_OVERSIZED_PREFILTER` 用于一键回到旧路径。

env 解析规则固定为：

1. number/float/bool 配置统一从 string 解析
2. 合法值覆盖默认常量
3. 非法值只记录 warning，并回退到默认值
4. env 非法值不会触发 `group full fallback`

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
11. `retryMode = none | expand | rarity_full`
12. `timedOut = true | false`
13. `usedRarityFullFallback = true | false`

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

### 建议指标

为了支撑灰度放量，额外统计：

1. `prefilter_timeout_rate`
2. `group_full_fallback_rate`
3. `rarity_full_fallback_rate`
4. `prefilter_expand_retry_rate`
5. `success_rate_delta_vs_full`
6. `overall_gap_p50`
7. `overall_gap_p95`

## 错误处理

### shard worker 异常

若 shard worker 本身报错：

1. 记录错误日志
2. 该 group 直接跳过近似预筛
3. 对该 group 执行 `group full fallback`

### 参数异常

若某些参数导致 shortlist 小于 `material.count`：

1. 视为参数不合法
2. 对该 group 执行 `group full fallback`

### 超时

若预筛并行阶段超时：

1. 单个 shard 超过 `SHARD_JOB_TIMEOUT_MS` 时，立即终止该 shard worker
2. 单组 prefilter 总时长超过 `PREFILTER_GROUP_TIMEOUT_MS` 时，终止该组剩余所有 shard worker
3. 若当前 group 触发单组超时，对该 group 执行 `group full fallback`
4. `PREFILTER_CALL_TIMEOUT_MS` 只覆盖单次 phase 调用，也就是一次 `prefilter/base` 或一次 `prefilter/expand`
5. 若某次 phase 调用命中 `PREFILTER_CALL_TIMEOUT_MS`，放弃该 phase 内所有已完成和未完成的预筛结果，并直接进入 `rarity full fallback`
6. 记录超时日志与超时计数

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
7. `group full fallback` 与 `rarity full fallback` 触发正确
8. 小候选组完全不走预筛
9. `material.count > shortlistHardMax` 时会直接触发 `group full fallback`
10. `normalizeShardRole` 在三种 mode 下映射正确
11. 重复 ID、worker 抛错、单 shard 超时、单 group 超时、phase call 超时都能命中预期状态机

### 集成测试

在 `runCraftAssistSelectionForRecipe` 级别验证：

1. 单个 group 超过阈值时会触发 prefilter
2. 多个 group 中只有 oversized 的 group 会被预筛
3. 预筛后仍能得到合法结果
4. 失败时会自动走 expand retry 与 `rarity full fallback`
5. group-level fallback 与 rarity-level fallback 的 trace 字段正确

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
3. 保留 `group full fallback` 与 `rarity full fallback`

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
6. 失败时先 expand retry，再 `rarity full fallback`
7. 用开关、日志和对照测试控制放量与回滚

这保证了：

1. 新路径只优化性能热点
2. 原搜索器的最终决策语义不被直接改写
3. 速度与精度之间的风险可被监控、审计和回退
