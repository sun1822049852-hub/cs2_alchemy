# 辅助选材统一求解设计

## 背景

当前辅助选材后端主流程位于 `node_sidecar/src/services/craftAssistService.js`，核心行为是：

1. 先按材料范围过滤候选
2. 再以相对磨损均值 `overall` 逼近目标
3. 通过 role-aware 贪心替换、下探兜底、偏移回拉得到结果

这套实现能保证“结果均值低于目标”，但与实际使用诉求存在偏差：

1. 单一物品场景中，用户期望的是“以目标为中线，从两边最近的材料开始取，逐步向两边扩”
2. 多物品场景中，用户期望的是“先让整体尽量贴近目标，再尽量让主料更高、辅料更低”
3. 当前求解器只优化均值，不优化分布半径、两侧平衡和主辅消耗倾向
4. 当前初选与修正都以局部贪心为主，容易卡在局部最优

本设计将辅助选材改为统一相对磨损空间下的全局搜索求解器，显式支持：

- 单一物品的对称中心线逼近
- 多物品的主辅异侧逼近
- 在“整体更贴近 target”前提下，优先消耗高磨损主料与低磨损辅料

## 目标

1. 核心计算统一使用相对磨损 `0~1`
2. 保留绝对磨损展示与绝对磨损筛选输入习惯
3. 单一物品场景，结果应围绕 `target` 中线向两边紧凑展开
4. 多物品场景，结果应先整体贴近 `target`，再尽量满足“主料高、辅料低”
5. 替换当前局部贪心主链，减少明显不符合直觉的选材结果
6. 保留同稀有度、去重、冷却过滤、数量约束、最终 `< target` 校验

## 非目标

1. 不修改当前 UI 里物品显示绝对磨损的方式
2. 不修改现有 `/api/craft/assist-select` 请求的必填字段
3. 不在本次设计里重做炼金产物预测逻辑
4. 不把前端重新变成第二套本地 solver

## 已确认的业务规则

### 1. 坐标系规则

- 所有求解与评分，统一在相对磨损空间进行
- 相对磨损定义保持不变：

`relative = (float_value - minfloat) / (maxfloat - minfloat)`

- 不论物品原始磨损区间是否为 `0~1`，进入求解器后都映射为相对磨损 `0~1`

### 2. 展示与筛选规则

- UI 继续显示绝对磨损，方便用户识别物品
- 材料范围筛选仍可沿用当前 `wear_filter_mode`
- 但候选一旦进入求解器，统一转换并保存相对磨损值
- 求解排序、搜索、评分、校验均只使用相对磨损

### 3. 单一物品规则

单一物品场景指：

- 只有一个父类材料组
- 或等价地，10 个槽位都来自同一个逻辑材料池

此时应按以下直觉选材：

1. 以 `target` 为中心线
2. 从中心线最近的两边材料开始取
3. 当前半径下无合格解时，再向两边同步扩张
4. 优先得到“围绕目标紧凑分布”的结果，而不是远距离对冲得到相似均值

说明：

- 单一物品场景下，按绝对磨损离目标绝对中线排序，与按相对磨损离 `target` 排序是等价的
- 实现仍统一使用相对磨损，避免在多物品场景中切换坐标系

### 4. 多物品规则

多物品场景指：

- 存在两个及以上父类材料组

若同时存在 `main` 与 `aux`：

1. 第一优先级：整体结果尽量贴近 `target`
2. 第二优先级：主料尽量更高、辅料尽量更低
3. 只有在偏好侧材料不足时，才允许跨到目标另一侧补位

若多物品但只有单一角色：

- 不使用“主高辅低”偏置
- 退化为整体贴近目标的中性模式

## 核心问题重定义

给定：

- 目标相对磨损 `target`
- 若干材料组 `materials`
- 每组数量约束 `count`
- 每组允许的相对磨损范围
- 全局同稀有度约束
- 物品不能重复

目标是在每个 rarity 候选空间中找到一组 10 件材料，使得：

1. `overall < target`
2. 结果满足场景对应的评分目标
3. 如果当前窗口无解，则逐步扩大候选窗口继续搜索

其中：

`overall = selected_relative_sum / selected_count`

## 统一求解架构

### 总体流程

后端新主流程建议改为：

1. 过滤可用候选
2. 统一计算每个候选的相对磨损
3. 按材料组聚合候选
4. 求每个材料组可行 rarity 集
5. 对每个共享 rarity 独立求解
6. 每个 rarity 内使用“窗口扩张 + Beam Search”搜索最优解
7. 在所有 rarity 的可行解中选全局最优解
8. 执行最终合法性校验并返回结果

### 为什么不用当前贪心修正

当前实现的问题不在单个局部规则，而在整体策略：

- 先抓一组初选
- 再基于局部槽位做替换
- 再用偏移回拉兜底

这种结构天然会错过“必须同时调整多槽位才更优”的解。

新设计直接在候选组合层面搜索，不再把“修修补补”当主路径。

## 候选窗口设计

### 单一物品模式：对称窗口

对单一物品材料池：

1. 将候选按相对磨损升序排序
2. 找到最接近 `target` 的左右边界
3. 构造对称扩张窗口：
   - 半径 1：最靠近 `target` 的左右候选
   - 半径 2：再向左右各扩一层
   - 依此类推
4. 每轮仅在当前窗口内求解
5. 当前窗口有可行解后，优先在该窗口内选最优，不立刻跳去更大半径

这里的“对称”不是强制左右数量完全相等，而是：

- 搜索优先在最小半径内完成
- 评分优先惩罚大半径与偏斜分布

### 多物品模式：主辅异侧窗口

对每个材料组，先按角色建立偏好侧：

- `main`：优先使用 `relative >= target` 的候选，按离 `target` 的距离从近到远展开
- `aux`：优先使用 `relative <= target` 的候选，按离 `target` 的距离从近到远展开
- 单角色中性组：按离 `target` 的距离从近到远展开

若偏好侧数量不足：

1. 先完全展开偏好侧
2. 再从目标另一侧按距离递增补位

窗口扩张规则：

- 每个材料组独立维护一个当前窗口
- 全局搜索从各组最小窗口开始
- 当前窗口无解时，优先扩张仍有提升潜力的材料组
- 达到窗口上限或搜索上限前，不进入旧版 fallback 贪心

## 搜索算法

### 推荐方案：Beam Search

对每个 rarity 使用 Beam Search 搜索完整 10 件组合。

每个搜索状态包含：

- 当前已处理到的槽位索引
- 已选物品 ID 集
- 各材料组已选列表
- 已选总和 `sumRelative`
- 已选总数
- `mainSum` / `mainCount`
- `auxSum` / `auxCount`
- 当前最大半径 `maxRadius`
- 错侧计数 `wrongSideCount`

### 槽位展开方式

先将材料组按 count 展平成槽位序列，例如：

- `mainA x4`
- `mainB x1`
- `auxA x3`
- `auxB x2`

每次扩展一个槽位，从对应材料组当前窗口内选择一个未使用候选。

### Beam 保留规则

对部分状态按阶段评分排序，仅保留前 `beamWidth` 个，避免组合爆炸。

建议默认：

- `beamWidth = 200` 起步
- 对单一物品可适当降低
- 对多物品可按窗口大小动态提高

### 剪枝规则

允许以下剪枝：

1. 该材料组剩余候选不足以填满剩余槽位
2. 共享 rarity 被破坏
3. 已出现重复物品
4. 即便剩余槽位都取当前窗口最优值，最终也不可能优于当前最佳完整解
5. 即便剩余槽位都取最小值，最终仍无法满足 `< target`

## 评分函数

### 通用硬约束

完整解必须满足：

1. `overall < target`
2. 数量正确
3. 稀有度一致
4. 不重复
5. 冷却与可选范围约束满足

### 单一物品评分

单一物品模式完整解按以下字典序比较：

1. `target - overall` 越小越好
2. `maxRadius = max(|wear_i - target|)` 越小越好
3. `balance = |countAbove - countBelow|` 越小越好
4. `variance` 越小越好
5. `meanAbsoluteDistance = avg(|wear_i - target|)` 越小越好

这保证结果首先贴近目标，其次尽量围绕目标紧凑分布。

### 多物品评分

多物品且同时存在 `main` 与 `aux` 时，完整解按以下字典序比较：

1. `target - overall` 越小越好
2. `wrongSidePenalty` 越小越好
   - `main` 低于 `target` 记惩罚
   - `aux` 高于 `target` 记惩罚
3. `mainMean` 越大越好
4. `auxMean` 越小越好
5. `mainHighTail` 越大越好
6. `auxLowTail` 越小越好
7. `maxRadius` 越小越好

说明：

- 第一优先级始终是整体更贴近目标
- 只有在整体贴近程度相同或足够接近时，才比较主料更高、辅料更低
- 这样既不会牺牲整体精度，也能更积极消耗高磨损主料

### 单角色多物品评分

若有多个材料组但只有同一种 role：

- 忽略 `main/aux` 偏置项
- 使用“整体贴近 + 分布紧凑”的中性评分

## 稀有度选择

当前实现先估算一个 rarity 再深入，会漏掉其他 rarity 的更优解。

新设计改为：

1. 先求共享 rarity 集
2. 对每个 rarity 独立执行完整窗口搜索
3. 取得到的最优完整解
4. 再跨 rarity 比较评分

这样 rarity 不再由预估拍板，而是由最终结果说话。

## 与现有代码的衔接

### 保留的能力

保留以下函数或职责：

- `getRelativeWearValue`
- `getAbsoluteWearValue`
- `getCraftCandidates`
- 按名称聚合候选
- 最终配方合法性检查

### 新增建议函数

建议在 `node_sidecar/src/services/craftAssistService.js` 中新增：

- `buildCraftAssistCandidatePoolsByMaterial(...)`
- `buildSymmetricWindowForSingleMaterial(...)`
- `buildRoleBiasedWindowForMaterial(...)`
- `expandCraftAssistSearchWindow(...)`
- `searchCraftAssistBestSolutionForRarity(...)`
- `scoreCraftAssistSolutionSingleMaterial(...)`
- `scoreCraftAssistSolutionMultiMaterial(...)`
- `compareCraftAssistSolutions(...)`
- `selectCraftAssistBestSolutionAcrossRarities(...)`

### 可降级或删除的旧路径

以下旧函数不再作为主路径：

- `pickCraftAssistClosest`
- `pickCraftAssistByRolePriority`
- `applyCraftAssistRoleAwareCorrection`
- `applyCraftAssistDeficitCorrection`
- `applyCraftAssistOverflowCorrection`
- `applyCraftAssistOffsetWindowCorrection`
- `findCraftAssistFallbackBelowTargetSolution`

`solveCraftAssistMinCostAssignmentForRarity(...)` 可保留，但仅作为：

- 调试下界工具
- 无解时的辅助诊断

不再承担主路径求解职责。

## 错误处理与诊断

需要明确区分以下失败原因：

1. 某材料组候选不足
2. 当前条件下无共享 rarity
3. 当前窗口无解，但可继续扩张
4. 所有窗口扩张完成仍无可行解
5. 有可行解，但偏移阈值校验失败

建议在日志中输出调试字段：

- `overall`
- `target`
- `rarity`
- `window_radius`
- `max_radius`
- `main_mean`
- `aux_mean`
- `wrong_side_count`

接口返回仍可保持现有最小契约，不强制新增用户可见字段。

## 测试设计

至少新增以下回归测试：

1. 单一物品、`0~1` 区间、目标 `0.2142`
   - 同时存在“远距离对冲组合”和“中线紧凑组合”
   - 必须选中线紧凑组合

2. 单一物品、非 `0~1` 原始区间
   - 映射到相对磨损后，应与等价 `0~1` 测试得到同排序结果

3. 多物品主辅场景
   - 两个解都满足 `< target`
   - 应优先选整体更贴近 `target` 的
   - 若整体相同，再选 `main` 更高、`aux` 更低的

4. 多物品偏好侧不足
   - `main` 上方或 `aux` 下方候选不足
   - 应允许跨线补位，而不是直接失败

5. rarity 交叉场景
   - 不同 rarity 都可行
   - 不应因为预估误差错过更优 rarity

6. 单角色多物品场景
   - 应退化为中性模式，不应用主辅偏置

## 验收标准

满足以下条件视为完成：

1. 单一物品场景结果明显围绕 `target` 中线收紧
2. 多物品场景结果先保证整体贴近 `target`，再体现“主高辅低”
3. 相同输入下，不再出现明显远距离对冲却被选中的结果
4. 后端成为唯一真源，前端只负责配置、请求与展示
5. 新增测试稳定覆盖单物品、多物品、非 `0~1` 区间与偏好侧不足场景

## 取舍结论

本设计选择：

- 统一相对磨损求解
- 单一物品对称中心线逼近
- 多物品主辅异侧逼近
- 用 Beam Search + 窗口扩张替代旧版局部贪心主链

这是在结果质量、规则表达能力与实现复杂度之间最均衡的方案。
