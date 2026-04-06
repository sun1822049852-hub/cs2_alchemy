# 辅助选材 item 粒度磨损下沉设计

## 背景

当前辅助选材的 `material` 条目同时承担两类职责：

1. 用 `count` 表示该组材料需要贡献多少件
2. 用 `wear_min` / `wear_max` / `custom_range` 约束该组下所有候选物品

这套结构在“一个 material 只对应一个父类材料名”时还勉强成立，但在当前 UI 中，一个 `material` 可以挂多个已选物品名 `names[]`。结果就是：

1. 同一个 `material` 里的所有物品共享同一组磨损范围
2. 无法让某个物品单独切换 `相对/绝对` 模式
3. 无法给不同物品单独设置 `Minwear / Maxwear`
4. UI 里“条件设置”和“已选材料”职责重叠，语义已经不再匹配真实需求

本设计将磨损约束从 `material` 下沉到内部 `item` 粒度，同时保留 `material` 作为“数量与角色容器”。

## 目标

1. `material` 只负责 `role`、`count` 与内部 `items[]`
2. 每个 `item` 可以独立配置 `相对/绝对` 模式与 `wear_min / wear_max`
3. 前端 UI 改为“material 容器 + item 小卡片”结构
4. 后端按 `item` 粒度过滤候选，并在同一 `material` 内合并候选池
5. 旧的 preset、草稿、运行数据可以自动升格为新结构
6. 不破坏现有选材求解主流程、角色语义、去重与 recipe 校验逻辑

## 非目标

1. 不重写现有 `craftAssistSearch.js` 的搜索评分逻辑
2. 不改变“主料 / 辅料”角色含义
3. 不新增新的求解模式或用户侧高级开关
4. 不改变 `target_wear` 仍然是全局“目标相对磨损”的定义
5. 不把同一个 `material` 再拆成多个独立业务组

## 已确认约束

### 1. 数据边界

- 所有 `material` 都下沉到 `item` 粒度，不区分 `main` / `aux`
- `material` 本身不再承载 `wear_min` / `wear_max` / `custom_range`
- `count` 表示“该 material 在最终配方中应贡献多少件”

### 2. UI 边界

- 保留“条件设置”这一层容器
- `数量` 移到条件设置头部右侧
- 原“已选材料”大区域删除
- 已选物品改为归属于当前 `material` 的小卡片
- 每张小卡片内包含独立的 `相对/绝对` 开关与 `Minwear / Maxwear`

### 3. material 生命周期

- 不保留空的 persisted `material` 容器
- 新建 `material` 仍通过顶部“开始添加主料/辅料”的入口触发，第一次选中物品时才真正创建该组
- 已存在的 `material` 只能追加新的 item 卡片，不能先手工创建一个空组
- 删除某个 `material` 的最后一张 item 卡片时，自动删除整个 `material`
- 新建 `material` 时，默认 `count = 1`
- 若当前剩余可分配数量小于 `1`，则禁止新建
- 若存在剩余配额，则新建 `material.count = min(1, remainingRequiredCount)`，也就是当前实现语义下固定为 `1`
- 因此：
  - 编辑中的 live panel 可以暂时“总数量不足”
  - 但不会存在“空组仍停留在列表中等待后续补卡”的状态

### 4. 模式切换规则

- 小卡片的 `相对/绝对` 模式是逐卡独立的
- 某张卡片切换模式时：
  - 直接重置为该物品在新模式下的默认范围
  - `custom_range = false`
  - 不尝试保留旧模式数值

### 5. 兼容策略

- 旧结构 `{name|names, wear_min, wear_max, custom_range}` 必须能继续读取
- 新结构写回后只保存 `items[]`
- 顶层旧字段 `wear_filter_mode` 仅作为 legacy 兼容输入保留，新结构不再依赖它驱动 UI

### 6. 数量校验边界

- live 编辑态允许 `sum(material.count) < 配方需求数`
- save preset、独立编辑保存、apply/run 前置校验都必须满足 `sum(material.count) === 配方需求数`
- 前端先拦截，不满足时不给保存或运行
- 后端继续保留同样的硬校验，防止绕过前端
- `sum(material.count) > 配方需求数` 与 `sum(material.count) < 配方需求数` 都视为无效

## 方案对比

### 方案 A：硬切到新结构

直接把前后端与 preset 全部切到 `items[]`，不兼容旧结构。

优点：

1. 实现最干净
2. 后续维护成本最低

缺点：

1. 旧 preset、旧草稿、旧测试会同时失效
2. 上线切换风险高

结论：不采用。

### 方案 B：兼容迁移到新结构

内部真源切到 `items[]`，但在归一化入口自动兼容旧结构。

优点：

1. 新旧数据可以平滑过渡
2. UI、preset、运行 payload 可以逐步收敛
3. 风险最低

缺点：

1. 归一化逻辑会暂时变厚

结论：采用本方案。

### 方案 C：把每个 item 直接拆成独立 material 行

优点：

1. 后端不需要理解嵌套结构

缺点：

1. `count` 语义会散掉
2. UI 会退化为“物品行列表”，不符合当前交互目标

结论：不采用。

## 总体设计

### 总体原则

1. `material` 是业务容器，只负责角色、数量与 item 集合
2. `item` 是磨损配置单元，负责名字、过滤模式与磨损范围
3. 后端候选过滤以 `item` 为最小粒度
4. 一个 `material` 的可用候选 = 内部多个 `item` 过滤结果的并集去重
5. 求解器仍然基于 `material.count` 消耗该组候选，不感知 UI 小卡布局

### 新数据结构

#### 前端状态 / preset / 运行 payload 真源

```js
material = {
  id: string,
  role: "main" | "aux",
  count: number,
  direction?: string,
  disable_direction_limit?: boolean,
  items: [
    {
      id: string,
      name: string,
      wear_filter_mode: "relative" | "absolute",
      wear_min: number,
      wear_max: number,
      custom_range: boolean
    }
  ]
}
```

#### 约束

1. `material.count` 必须为正整数
2. `material.items.length >= 1` 才视为有效材料组
3. `item.name` 在整个辅助选材表单中必须全局唯一，避免同一物品名出现在多个 `material`
4. `item.id` 视为 persisted truth：
   - 输入已提供时必须 round-trip 保留
   - 缺失时必须按确定性规则补齐，禁止用随机值
   - mint 时机固定为：material 内去重折叠完成后、跨 material 去重前
   - 确定性补齐算法固定为：`material.id`（缺失时回退稳定 material 索引）+ 归一化后的 `item.name` + material 内去重后稳定顺序
   - 其中“稳定 material 索引”固定指 entry-level 结构归一化后、跨 material first-win 去重之前、且仍按原输入顺序保留的位置索引；后续空组删除、count clamp 或总量裁剪不得回溯改变已 minted 的 `item.id`
5. `item.wear_min <= item.wear_max`
6. `wear_min / wear_max` 始终存储为 `0~1` 浮点值
7. 新结构写回时不再保存 material 级 `name` / `names` / `wear_min` / `wear_max` / `custom_range`
8. 所有 `wear_min / wear_max` 的 state / snapshot / payload / cache tuple 都必须先执行同一套数值归一化：
   - clamp 到 `0~1`
   - 以当前基线 `WEAR_INPUT_DECIMALS = 6` 截断
   - 比较默认值与用户输入时，先做同样截断后再比较，避免 UI 把显示出来的默认值重新输入后误判为 `custom_range = true`
9. 浮点比较容差沿用当前基线 `EPSILON = 1e-9`；spec 中凡提到“相等”“非默认”“range 未变”，均以这套统一归一化后的结果为准
10. `target_wear` 也必须沿用同一套 clamp + 6 位截断规则进入 state / snapshot / predictor payload / candidate cache key，避免前后端在 target 维度出现 `1e-6` 级漂移
11. 新结构 item 级 `wear_filter_mode` 的 sanitize 规则与 legacy 顶层字段完全一致：
   - 只认字面值 `"absolute"` 与 `"relative"`
   - 其它值一律归一化为 `"relative"`
   - item 级 mode 一旦存在，即为该 item 的最终真源，不再受任何 legacy 顶层 alias 影响

### legacy 结构升格

旧结构：

```js
{
  id,
  role,
  count,
  names: ["A", "B"],
  name: "A",
  wear_min: 0.1,
  wear_max: 0.4,
  custom_range: true
}
```

升格后：

```js
{
  id,
  role,
  count,
  items: [
    {
      id: "...",
      name: "A",
      wear_filter_mode: normalizeCraftAssistFilterMode(legacyWearFilterMode),
      wear_min: 0.1,
      wear_max: 0.4,
      custom_range: true
    },
    {
      id: "...",
      name: "B",
      wear_filter_mode: normalizeCraftAssistFilterMode(legacyWearFilterMode),
      wear_min: 0.1,
      wear_max: 0.4,
      custom_range: true
    }
  ]
}
```

说明：

1. 旧顶层 `wear_filter_mode` 只在升格时读取
2. legacy `names[]` 为主；若缺失则回退读取单值 `name`
3. 新结构写回后不再生成 `name`、`names`、`wear_min`、`wear_max`、`custom_range`
4. 若旧结构未提供 `wear_filter_mode`，默认按 `relative` 处理

### legacy 重名冲突规则

legacy 升格时可能遇到同一物品名在多个 `material` 中重复出现。

为避免前后端归一化结果漂移，规则固定为：

1. 按输入顺序稳定处理，先到先得
2. 第一次出现的 `item.name` 保留
3. 后续跨 `material` 的重名 item 直接丢弃
4. 同一 `material` 内的重复名字也折叠为一张卡
5. 若某个 legacy `material` 在去重后无 item 存活，则整个 `material` 丢弃

前端在加载 preset / 草稿时应给出非阻塞提示，说明存在重复项已被自动忽略；后端若收到未清洗的 legacy 输入，也必须执行同样的稳定规则。对于新结构 `items[]` 本身的脏数据，也沿用同样的“先到先得、后续丢弃”规则，避免前后端归一化结果漂移。

### 新旧字段迁移矩阵

| 链路 | 旧读入 | 新写出 | 说明 |
|------|--------|--------|------|
| account-scoped UI state | 读取 `craftAssistUseAbsoluteWear` 作为 account-state 专属 legacy 升格提示；读取 `craftAssistMainCount` / `craftAssistAuxCount` 仅用于兼容旧快照 | 不再写出 `craftAssistUseAbsoluteWear`、`craftAssistMainCount`、`craftAssistAuxCount` | 新状态只依赖 `craftAssistMaterials[].items[]` |
| draft snapshot | 读取顶层 `wear_filter_mode` / `use_absolute_wear` 作为 legacy 升格提示 | 不再写出顶层 `wear_filter_mode` / `use_absolute_wear` | 新 draft 只写 `target_wear`、`materials`、`pick_role` |
| preset | 读取顶层 `wear_filter_mode` / `use_absolute_wear` 作为 legacy 升格提示 | 不再写出顶层 `wear_filter_mode` / `use_absolute_wear` | 新 preset 只以 `materials[].items[]` 保存模式 |
| comparable snapshot | 可读取 legacy 字段用于旧数据对比 | 不再写出 legacy 顶层字段 | 防止 diff 继续被全局模式污染 |
| API payload | 接受 legacy `wear_filter_mode` / `use_absolute_wear` | 新前端不再发送这两个顶层字段 | server 以 `materials[].items[]` 为准；`craftAssistUseAbsoluteWear` 不属于 API contract |

说明：

1. `use_absolute_wear` 视为 `wear_filter_mode === "absolute"` 的 legacy alias
2. `use_absolute_wear` 的解析规则也必须固定：
   - 仅 `true` / `"true"` / `1` / `"1"` 视为 absolute
   - 其它值（`false`、`"false"`、`0`、`""`、`"foo"`、`null`、缺失）一律视为 relative
3. 新结构下每个 item 自己携带 `wear_filter_mode`
4. 顶层 legacy 字段只保留读取兼容，不再参与新版本状态与序列化
5. account-scoped UI state 升格时，若 legacy 顶层模式字段同时出现且互相冲突，优先级固定为：
   - 显式 `wear_filter_mode`
   - `use_absolute_wear`
   - account-state 的 `craftAssistUseAbsoluteWear`
   - 缺省回退到 `relative`
6. draft / preset / API payload 升格时，优先级固定为：
   - 显式 `wear_filter_mode`
   - `use_absolute_wear`
   - 缺省回退到 `relative`
7. 当 legacy 顶层 `wear_filter_mode` 字段“存在但非法”时，行为也必须固定：
   - 只认字面值 `"absolute"` 与 `"relative"`
   - 其它值（空串、`"foo"`、`null` 序列化残留等）一律归一化为 `"relative"`
   - 一旦该字段存在，即视为显式模式输入，不再继续回退 `use_absolute_wear` 或 `craftAssistUseAbsoluteWear`
8. 因此，只要 `wear_filter_mode` 字段明确存在，其它 legacy alias 一律视为被覆盖，不得再改写升格结果
9. `craftAssistMainCount` / `craftAssistAuxCount` 仅作为 legacy state 读入兼容保留；升格后不再驱动 UI，也不再写回任何新状态或快照

### normalize 决策矩阵

| 输入形态 | 规则 | 输出要求 |
|----------|------|----------|
| 只有 legacy `names[]` 或单值 `name` | 升格为 `items[]` | 每个 name 生成一个 item；`names[]` 缺失时回退 `name` |
| 同时存在 `items[]` 与 legacy `name` / `names[]` | 新结构优先 | 只使用 `items[]`，忽略 legacy `name` / `names[]` |
| 同时存在 `wear_filter_mode` 与 `use_absolute_wear` | 显式 `wear_filter_mode` 优先 | alias 不得覆盖显式模式 |
| `wear_filter_mode` 字段存在但值非法 | 归一化为 `relative` | 同时屏蔽后续 alias fallback |
| item 级 `wear_filter_mode` 值非法 | 归一化为 `relative` | 该 item 不再回退 legacy 顶层 alias |
| account-state 同时还存在 `craftAssistUseAbsoluteWear` | 仅 account-state restore 参与优先级 | 不影响 draft / preset / API 升格 |
| 顶层模式字段全缺失 | 回退 `relative` | item 默认模式为 `relative` |
| legacy / new 数据跨 material 重名 | 先到先得 | 后续重复项丢弃 |
| 同一 material 内重复 name | 折叠去重 | 同名只保留一张卡 |
| 去重后 material 无 item 存活 | 自动丢弃空 material | 不允许留下空组 |

### 归一化管线与所有权

为避免前后端把 list-level 规则分散到多个 entry helper，归一化职责必须拆成两层：

1. entry-level helper 只负责单个 `material` / `item` 的结构性 sanitize：
   - 读取 legacy `name` / `names[]`
   - 归一化 `role`、`count`、`wear_filter_mode`
   - 归一化单 item 的 `wear_min / wear_max / custom_range`
   - 在返回前完成同一 material 内部重复名折叠
2. list-level helper 才负责所有需要 `materials[]` 全局上下文的规则：
   - 跨 material 的 first-win 去重
   - 去重后的空 material 删除
   - surviving materials 的 count clamp
   - 总量超额时按输入顺序稳定裁剪
   - predictor / solver / cache key 最终消费的 list 输出

normalize pipeline 顺序固定为：

1. 先做 entry-level 结构归一化，并在 entry-level 返回前完成“同一 material 内 item 去重”
2. 再做跨 material first-win 去重
3. 再删除去重后已空的 material
4. 再对 surviving materials 执行 count clamp
5. 最后才做总量超额裁剪与最终 requiredCount 校验

补充：若某个 item 需要依赖“稳定 material 索引”补齐 `item.id`，该索引必须在步骤 1 完成时就冻结；步骤 2~5 即便删掉前序 material，也不得导致后续 surviving item 的 minted id 改变。

因此：

1. `normalizeCraftAssistMaterialEntry(...)` / `normalizeCraftAssistMaterialForRun(entry)` 不得独自承担跨 material 去重或总量裁剪
2. `normalizeCraftAssistMaterialList(...)` / `normalizeCraftAssistMaterialsForRun(...)` 必须是前后端各自的 list-level 单一入口
3. cache key builder、predictor draft 输入、run payload 都必须消费 list-level 归一化后的最终材料列表，而不是原始 payload
4. list-level helper 还必须统一产出 runtime 只读派生视图，供仍需要名字投影的读侧复用：
   - `item_names`: 去重后的最终 item 名字顺序
   - `primary_name`: `item_names[0] || ""`
   - `label`: `item_names.join(" / ")`
5. 这些派生字段只允许由 list-level helper 统一生成，label / prefilter trace / candidate cache key / 调试日志不得各自重算名字顺序
6. implementation 还必须提供可断言的 shared read-side seam，至少包括：
   - cache key tuple helper：返回参与最终 candidate cache key 的规范化 tuple，再由调用方决定如何 join 成字符串
   - trace projection helper：返回至少 `primary_name`、`item_names`、`label`；若读侧仍保留 legacy `materialName`，它只能是 `primary_name` 的 alias，不能再独立拼装

示意：

```js
canonicalNormalizedMaterial = {
  id,
  role,
  count,
  direction,
  disable_direction_limit,
  items,
  item_names,
  primary_name,
  label,
  name,  // runtime-only compatibility alias, equals primary_name
  names  // runtime-only compatibility alias, equals item_names
}
```

读侧约束：

1. `craftAssistMaterialNames(...)`、label 生成、prefilter trace、candidate cache key、debug/logging consumer 必须只读复用这份 canonical normalized material 视图
2. 上述 consumer 不得再次从 `items[]` 自行拼接名字顺序，避免 first-win 结果在不同调用点漂移
3. `item_names` / `primary_name` / `label` 与 `name` / `names` 都属于 runtime-only derived view：可驻留于 normalize 输出供读侧复用，但都不是 persisted truth
4. API payload、worker IPC payload、preset、account-state、draft/comparable snapshot 的写出必须再投影一次，只保留 persisted truth 字段；上述 derived fields 一律不得 serialize

## UI 设计

### 顶部区域

顶部只保留：

1. `目标相对磨损`
2. `保存当前`
3. `按配置选材`

原全局 `相对/绝对` 开关移除。

补充语义说明：

1. `目标相对磨损` 仍然只描述全局 outcome target，不会因为某张 item 卡切到 `absolute` 而改成“全局绝对目标”
2. item 卡上的 `relative / absolute` 只影响该卡自己的候选过滤维度
3. 上述语义必须至少有一处可见文案直接说明；tooltip / aria-label 只能作为补充，不能替代可见说明

### 条件设置容器

每个 `material` 仍渲染为一个“条件设置”卡片，但头部信息改为：

1. 左侧：`条件设置（已选 N）`
2. 右侧：`数量` 输入框、`主料/辅料` 标记、`+` 按钮、删除按钮

其中：

1. `数量` 表示该 material 在最终配方中计划贡献的件数
2. `已选 N` 表示该 material 下已存在多少张 item 小卡
3. `+` 按钮打开 picker，并将新选父类材料添加为当前 material 的一张 item 卡片
4. 需要通过可见文案明确区分：
   - `已选 N` 是卡片数量
   - `数量` 是 solver 最终要从该组消耗的贡献件数
5. tooltip / aria-label 可以继续补充，但不能替代上述可见文案

### item 小卡片

原“已选材料”大区域删除，改为在当前 `material` 容器内部渲染 `items[]` 小卡片列表。

每张卡片包含：

1. 名称
2. 删除按钮
3. `相对 / 绝对` 开关
4. `Minwear`
5. `Maxwear`

行为规则：

1. 新增卡片时默认进入 `relative`
2. 默认范围取该物品在当前模式下的默认约束
3. 输入框留空表示回到默认范围，并将 `custom_range` 置为 `false`
   - 该路径与“新建卡默认范围”“切换模式重置默认范围”共用同一套“显式回到当前默认范围”语义：只取当前约束，失败时回退 `0~1`，不回退旧 storedRange
4. 输入任一非默认值后，`custom_range = true`
5. 切换模式时直接重置为新模式默认范围，并将 `custom_range = false`
6. 删除最后一张卡片时，整个 `material` 自动从列表中移除

### picker 行为

当前 picker 的语义从“向 material.names[] 添加名字”改为“向 material.items[] 添加一张新卡”。

规则：

1. 同一个名字不能出现在多个 `material`
2. 若目标 `material` 已包含同名卡片，则忽略重复点击
3. 新卡片默认：

```js
{
  id,
  name,
  wear_filter_mode: "relative",
  wear_min: defaultRelativeMin,
  wear_max: defaultRelativeMax,
  custom_range: false
}
```

### 默认范围回退规则

`resolveCraftAssistItemDefaultRange(...)` 的回退顺序必须固定：

1. 优先使用当前可用的物品约束数据：
   - 已加载的 inventory rows
   - 当前可解析的皮肤元数据
2. 若当前约束不可用，但该 item 来自已保存的数据且携带有限的 `wear_min / wear_max`，则回退到已存值
3. 若两者都不可用，则回退到 `0~1`

同时：

1. 对 `custom_range = false` 的 item：
   - 在每次重新归一化时优先重算默认值
   - 仅在重算失败时使用已存值或 `0~1`
2. 对 `custom_range = true` 的 item：
   - 以已存值为准
   - 若当前约束可用，则对已存值执行 clamp
   - 若当前约束不可用，则仅按 `0~1` clamp
   - 若已存值坏到无法形成有效双边 finite 区间，则视为失效 custom range，回退到默认范围并把 `custom_range` 纠正为 `false`

当 rows 与 metadata 同时存在时，默认范围的合并规则必须沿用现有 `resolveCraftMaterialWearConstraintByName(...)` 语义：

1. 优先计算两者交集
2. 若交集有效，则使用交集
3. 若交集无效，则优先使用物品自身 `minfloat / maxfloat` 对应的 `floatBounds`
4. 若仅存在一侧，则使用该侧

因此：

1. mode switch 重置到“新模式默认范围”时，必须先走这套确定性规则
2. 若切换当下无法为新模式产出默认约束，则直接回退到 `0~1`
3. mode switch 不得复用切换前旧模式的 live 输入值，避免形成“伪保留旧模式数值”
4. “回退到已存值”仅用于加载 / restore / 重新归一化已有数据，不用于用户刚刚执行的模式切换动作

这保证：

1. preset / 草稿 round-trip 时结果稳定
2. 没有 rows 或元数据时 UI 仍可安全打开
3. inventory 刷新后，非自定义卡片可以自动回到最新默认约束

## 前端实现边界

### 归一化职责

`node_sidecar/ui/app.js` 需要把以下职责改为 `items[]` 真源：

1. 当前状态归一化
2. preset 读写
3. 草稿快照
4. 运行前 payload 归一化
5. UI 渲染与编辑

`source` 与真实调用场景的绑定必须固定：

| source | 仅用于这些场景 |
|--------|----------------|
| `load` | preset load、preset hydrate、comparable snapshot hydrate、任何“从持久化数据首次装载到内存只读态”的流程 |
| `restore` | account-state restore、draft restore、用户显式恢复某份已保存草稿到 live 编辑态 |
| `renormalize` | inventory 刷新后的 live 材料重算、run 前 normalize、server normalize、worker normalize、predictor draft 输入 normalize |
| `mode-switch` | 用户在单张 item 卡上切换 `relative / absolute`、新建 item 卡时生成默认范围、以及把 `Minwear / Maxwear` 清空后显式回到当前默认范围 |

不得把 `load`、`restore`、`renormalize` 混并为同一路径名称来规避这套 source 语义。

### 默认范围解析

新增或复用 helper：

```js
resolveCraftAssistItemDefaultRange(name, {
  wearFilterMode: "relative" | "absolute",
  rows,
  storedRange: { wear_min, wear_max } | null,
  customRange: boolean,
  source: "load" | "restore" | "renormalize" | "mode-switch"
})
```

其中 `wearFilterMode` 参数表示“当前 item 自己的已归一化过滤模式”；legacy 顶层 `wear_filter_mode` / `use_absolute_wear` 若仍存在，必须先在升格阶段折算成每张 item 卡的最终 mode，再传入该 helper。

返回：

```js
{
  wear_min,
  wear_max,
  usedStoredFallback: boolean,
  resolvedCustomRange: boolean
}
```

该 helper 的 contract 必须覆盖以下语义：

1. 只按单个物品名求默认约束，不再对整个 material 做多名字交集
2. 返回值本身必须已经完成 clamp + `WEAR_INPUT_DECIMALS = 6` 截断，保证前后端消费同一精度基线
3. `resolvedCustomRange` 表示“归一化后该 item 是否仍应保留 custom range 语义”：
   - 正常 custom 输入保持 `true`
   - 因坏数据降级到默认范围时强制返回 `false`
4. `source = "mode-switch"` 时，不得回退旧 live 值；只允许使用当前约束，失败时直接回退 `0~1`
5. `source = "load" | "restore" | "renormalize"` 时：
   - `customRange = false` 先取当前约束，再回退 `storedRange`，最后回退 `0~1`
   - `customRange = true` 以 `storedRange` 为主，再做必要 clamp
6. 对 `customRange = false`，若需要回退 `storedRange` 而该值是坏数据：
   - 两端 finite 时，按统一数值归一化后再必要时交换 min/max
   - 只有一端 finite、两端都缺失、或任一端为 `NaN` / 非 finite 时，视为“stored fallback 不可用”
   - 对不可用的 stored fallback，直接继续回退 `0~1`
7. 若 `customRange = true` 但 `storedRange` 是坏数据：
   - 两端都 finite 时，按统一数值归一化后再必要时交换 min/max
   - 只有一端 finite、两端都缺失、或任一端为 `NaN` / 非 finite 时，视为“失效 custom range”
   - 对失效 custom range，统一回退到当前默认范围；若当前默认范围也不可得，则回退 `0~1`，并强制把 `custom_range` 纠正为 `false`
8. caller 在 load / restore / renormalize 路径中，必须使用返回值里的 `resolvedCustomRange` 覆盖原 `custom_range`，不得自行再猜测是否保留 custom 语义
9. 前端 restore / normalize 与后端有效范围解析必须复用同一套决策语义，避免 UI 与 server 漂移
10. implementation 必须抽出 shared resolver module，而不是前端 / 后端各写一份近似逻辑：
   - shared resolver 与 metadata provider 必须放在 UI / service / worker 都能 import 的 shared module 中
   - resolver 的输入数据源固定为当前 inventory rows + 与 `resolveCraftMaterialWearConstraintByName(...)` 同源的皮肤 metadata 解析结果
   - worker 不通过 payload 传 metadata；而是与 server / UI import 同一个 metadata provider
   - UI、server、worker 必须直接复用同一个 shared resolver；测试夹具只作为附加 parity gate，不能替代 shared resolver 本身
11. 一次 normalize / select 流程只能存在一份 authoritative candidate row family，其定义固定为“后续候选过滤、cache key 与 trace 真正消费的 candidateRows”
12. shared resolver 的 authoritative rows source 必须按调用入口固定：
   - UI live 面板必须基于当前 live inventory craftable rows 调 `resolveCraftAssistSelectionContext(...)` / `buildCraftAssistSelectionContext(...)`，并以产出的 `selectionContext.candidateRows` 作为 authoritative rows
   - server/service 若入口拿到 `selectionContext`，则以下游实际消费的 `selectionContext.candidateRows` 为 authoritative rows；若入口拿到 `{rows}` 或 inline `candidateRows`，必须先构造 fresh `selectionContext`，之后下游只再传 `selectionContext`
   - worker 的 snapshot 路径必须先 `snapshot rows -> candidateRows -> selectionContext`；inline 路径必须先 `payload.candidateRows -> selectionContext`；两条路径后续都只消费该次 `selectionContext.candidateRows`
13. 若 `selectionContext` 与 sibling `rows` / `candidateRows` 同时存在，则一律视为 mixed-source call：必须丢弃旧 `selectionContext` / `candidateCache`，并按 sibling source 重建 fresh `selectionContext`；禁止用“same asset-id / same order”之类弱等价条件继续复用旧 context
14. 只有 `selectionContext` 作为唯一 rows 真源被单独传递时，才允许复用现成 context；且其 `candidateRows` 必须被视为 immutable snapshot，任何会影响下游消费的字段（至少 `asset_id`、`alchemy_name/name`、`float_value`、`minfloat`、`maxfloat`、`includeCooling` 语义）一旦变化，都必须整体重建 `selectionContext` 与 `candidateCache`
15. `createCraftAssistService()` 这类按 `rows` 引用缓存 `selectionContext` 的 seam，也必须把 `rows` 视为 immutable snapshot：一旦 inventory rows 内容变化，调用方必须替换数组引用或显式重建 context；对同一数组原地 mutate 后继续复用缓存属于禁止行为
16. 不允许在同一次 normalize / select 流程里一边用 full inventory rows 求默认范围，一边用另一份 filtered rows 做候选过滤

旧 helper / seam 的迁移约束也必须写死：

1. UI 侧现有默认范围 helper 链（如 `makeCraftAssistDefaultRange(...)`、material normalize / refresh 相关包装）必须删除或退化为 shared resolver 的薄委托
2. server 侧 `normalizeCraftAssistMaterialForRun(...)` / `normalizeCraftAssistMaterialsForRun(...)` 不得再内嵌独立默认范围推导；必须委托 shared resolver
3. `createCraftAssistService().selectForRecipe(...)`、`resolveCraftAssistSelectionContext(...)` 与 worker 入口只能消费 shared resolver + list-level normalize 的结果，不得额外复制一套默认范围纠偏逻辑
4. 旧的 request-scoped global `wearFilterMode` / `getCraftAssistFilterMode()` / worker `wearFilterMode` 参数链只允许停留在 legacy 升格边界：
   - 仅用于把旧顶层字段升格成 item 级最终 `wear_filter_mode`
   - 一旦 `materials[].items[]` 已存在或 canonical normalized material 已生成，后续 UI -> worker -> service -> resolver / cache / filtering / trace 链不得再让全局 mode 影响 item 过滤、默认范围解析、candidate cache key 或任何名字投影

### 需要删除或降级的旧职责

以下语义需要消失或改写：

1. `material.names[]` 作为运行真源
2. `material.wear_min / wear_max / custom_range`
3. 顶部全局 `wear_filter_mode` 驱动所有 material
4. 以“多名字交集”方式推导一个 material 的统一范围

### 受影响消费者清单

除了 panel 本身，以下读侧路径也必须一起迁移，不能只改 solver：

1. account-scoped state 的 build / normalize / apply 流程
2. draft snapshot 与 restore 流程
3. preset sanitize / save / load / comparable snapshot 流程
4. picker 中的“已选名字去重”与 rarity 锁定逻辑
5. `normalizeCraftPredictorMaterialNames(...)`、`buildCraftPredictorRequestFromDraft(...)`、`buildCraftPredictorRequestFromRecipeEntry(...)` 及其后续 craft predictor context / subtitle / status fallback
6. run payload 的 `normalizeCraftAssistMaterialsForRun(...)`
7. 后端 `craftAssistMaterialNames(...)`、label 生成与 candidate cache key
8. `craftAssistSearch.js` 中使用 `material.name/names/label` 的 selection trace / debug / logging 路径
9. `craftAssistShardPrefilter.js` 中使用材料名字投影的 prefilter trace 路径
10. `craftAssistService.js` 中挂到最终 `selection_trace.prefilter.contextRefine.rounds[].attempts[].materialName` 的 service-side trace 拼装路径
11. `createCraftAssistService().selectForRecipe(...)` 与 `resolveCraftAssistSelectionContext(...)` 的 `selectionContext` 复用 seam

implementation plan 必须把这些消费者明确列入改造范围，否则会出现“面板结构已换，但比较快照、predictor、trace 或 restore 仍读旧字段”的回归。

### craft predictor 消费语义

predictor 在本次改造中保留现有“按 material 聚合”的语义，不把 item 卡直接展平成计数单元。

规则固定为：

1. predictor 读取某个 `material` 时，名字来源从 `material.names[]` 改为 `material.items[].name`
2. 同一 `material` 内的多个 item 只用于提供“候选名字集合”，不拆分 `material.count`
3. predictor 继续把 `material.count` 视为该组贡献件数
4. 若同一 `material` 内的多个 item 落到不同 collection、rarity 或 StatTrak 池，则继续报 `ambiguous_material_group`
5. 因此，predictor 的 collection 计数逻辑仍然是“按 material 聚合后再累计 count”，不是“按 item 张数累计”
6. predictor 的请求构建必须按 context 分流：
   - `draft` context 走 `buildCraftPredictorRequestFromDraft(...)`
   - `recipe` context 才走 `buildCraftPredictorRequestFromRecipeEntry(...)`
7. `refreshCraftPredictorPreview(...)`、`renderCraftPredictorPanel()` 的 fallback draft / subtitle / status / `requiredCount` / `currentCount` / `targetWear` 推导，也必须按同一 context 分流，不允许继续无条件走 recipe builder
8. `draft` context 的唯一输入源必须固定为“已归一化的 live craft-assist draft state”，至少包含：
   - `targetWear = 当前 live target_wear`
   - `requiredCount = resolveCraftAssistRequiredCount()`
   - `materials = list-level normalize 后的 live craft-assist materials`
   - `parentGroups = buildCraftAssistParentGroups(...)` 基于同一份 list-level normalized materials 或其只读派生视图同步生成的结果
9. `draft` preview 的可用性不得再依赖 recipe entry 是否可解析；只要 live draft state 有效，就必须可以独立构建 predictor 请求
10. `getCraftPredictorResolvedContext()` 即便继续返回 `entry` 用于 label / id，也不得让 `draft` builder 再回头读取 recipe entry、stale cache、原始未归一化 live state，或 recipe-derived parentGroups 充当材料真源
11. implementation plan 必须把上述 context 分流调用点单独列为改造项，否则即便 helper 已支持 `items[]`，draft predictor 仍可能绕过新语义

## 后端设计

### 输入结构

后端 `selectCraftAssistForRecipe(...)` 与 worker payload 的 `materials` 改为接受：

```js
[
  {
    id,
    role,
    count,
    direction,
    disable_direction_limit,
    items: [
      {
        id,
        name,
        wear_filter_mode,
        wear_min,
        wear_max,
        custom_range
      }
    ]
  }
]
```

出站投影规则必须固定：

1. front / server / worker 在内存中的 canonical normalized material 可以携带完整 runtime derived view：`item_names`、`primary_name`、`label`，以及 runtime-only compatibility alias `name` / `names`
2. 上述 5 个字段都属于 process-local derived fields，不是 persisted truth；API payload、worker IPC payload、preset、account-state、draft snapshot、comparable snapshot 的写出都必须从 canonical normalized material 再投影一次，只保留 `id` / `role` / `count` / `direction` / `disable_direction_limit` / `items[]`
3. 因而，任何 persisted / wire payload 都不允许 serialize `item_names` / `primary_name` / `label` / `name` / `names`；若接收侧需要 trace/debug 名字投影，必须在接收侧基于 canonical normalized material 的 runtime derived view 生成，而不是把这些派生字段扩散成新的 wire contract

同时继续兼容 legacy 输入：

```js
{
  names,
  wear_min,
  wear_max,
  custom_range
}
```

### 后端归一化

`normalizeCraftAssistMaterialForRun(entry)` 改为：

1. 先判断 `entry.items[]` 是否存在
2. 若存在，逐 item 归一化，并把这些 item 视为新结构真源
3. 若不存在，则按 legacy 结构升格为 `items[]`
4. 仅处理单个 material 内部的结构问题，不承担跨 `material` 规则
5. 返回的新结构始终包含 `items[]`

其中新结构 `items[]` 进入 server 后的权威口径固定为：

1. `item.wear_filter_mode` 永远视为前端已确定的真源
2. 对 `custom_range = true` 的 item：
   - `wear_min / wear_max` 视为用户显式范围真源
   - server 只允许做结构性 sanitize：空名丢弃、`0~1` clamp、必要时交换 min/max、重名去重、空 material 丢弃
   - 若显式范围本身已坏到无法形成有效双边 finite 区间，则按 shared resolver contract 降级为默认范围，并强制纠正为 `custom_range = false`
3. 对 `custom_range = false` 的 item：
   - server 必须用与前端同一套 `resolveCraftAssistItemDefaultRange(...)` 语义重新求“当前有效范围”
   - 若当前约束可用，则以当前约束为准
   - 若当前约束不可用，才回退 payload 中携带的 `wear_min / wear_max` 或 `0~1`
4. 因而，新结构 `items[]` 中的 `wear_min / wear_max` 只在以下两种情况充当 server 输入真源：
   - `custom_range = true`
   - `custom_range = false` 且当前约束不可用时的 fallback
5. 只有 legacy 输入在升格为 `items[]` 的过程中，才允许应用 legacy 模式推导与兼容回退规则

而 `normalizeCraftAssistMaterialsForRun(materials)` 必须作为 server 侧 list-level 单一入口，负责：

1. 调用 entry-level helper 生成初步 `materials[]`
2. 执行跨 `material` first-win 去重
3. 删除去重后空 material
4. 对 surviving materials 执行 count clamp 与总量稳定裁剪
5. 产出供 solver、worker、cache key 共同消费的最终 list

示意：

```js
canonicalNormalizedMaterial = {
  id,
  role,
  count,
  direction,
  disable_direction_limit,
  items: normalizedItems,
  item_names,
  primary_name,
  label,
  name,   // runtime-only compatibility alias, equals primary_name
  names   // runtime-only compatibility alias, equals item_names
}
```

说明：

1. server / worker 的 list-level normalize 输出也必须包含这份 runtime derived view，但仅限内存态 canonical normalized material，不构成 wire / persisted contract
2. front / back / worker 的 parity golden 必须同时比较：
   - `items` tuple 及顺序
   - `item_names`
   - `primary_name`
   - `label`
   - runtime-only `name` / `names` alias

### 候选过滤

当前 `collectCraftAssistCandidatesForMaterial(material, ...)` 以 material 级范围过滤。

改造后逻辑应为：

1. 遍历 `material.items`
2. 对每个 item：
   - 读取 `rowsByName.get(item.name)`
   - 按 `item.wear_filter_mode` 选择过滤值：
     - `relative` 用相对磨损
     - `absolute` 用绝对磨损
   - 按该 item 归一化后的有效 `wear_min / wear_max` 过滤
3. 把所有 item 命中的候选合并
4. 按 `asset_id` 去重
5. 继续按现有 comparator 排序

这样：

- `material.count` 仍然决定该组最终取几件
- 但该组的候选来源于多个 item 卡片的并集

### cache key

当前 cache key 基于 material 级：

1. 全局模式
2. `target_wear`
3. material 范围
4. names 列表

改造后必须改为 item 级展开，例如：

```js
[
  target_wear,
  item.name,
  item.wear_filter_mode,
  item.wear_min,
  item.wear_max
]
```

按稳定顺序拼接后再参与 cache key 计算。

补充规则：

1. cache key 必须基于 server 最终归一化后的 item tuple 计算，而不是原始 payload
2. 这里的“最终归一化”只包含：
   - 新结构 item 的结构性 sanitize
   - `custom_range = false` item 的默认范围重算
   - legacy 升格后的 item 归一化
   - 稳定顺序去重后的 material/items 列表
3. 因此前端若提交显式 `wear_min / wear_max`：
   - `custom_range = true` 时，server 与 cache key 都不得擅自改写其语义
   - `custom_range = false` 时，server 与 cache key 应以“当前有效默认范围”而不是旧 payload 值为准
4. `target_wear` 必须以同一套 clamp + 6 位截断规则参与 key；同一组 item tuple 在不同 `target_wear` 下不得复用候选缓存
5. 一旦 `materials[].items[]` 已存在，legacy 顶层 `wear_filter_mode` / `use_absolute_wear` 即便仍被透传，也不得改变最终 item tuple、candidate cache key、`selection_trace` 或 prefilter trace；相关回归必须按 byte-for-byte 无差异校验
6. implementation 必须让 cache key 的“规范化 tuple”成为可断言 seam：shared helper 先返回 tuple，最终字符串 key 只是该 tuple 的稳定序列化；跨 UI/server/worker 的 parity 测试应优先断言 tuple，而不是各处私下重算字符串

### API 兼容

`node_sidecar/src/uiServer.js` 仍可继续接收 legacy 顶层 `wear_filter_mode`，但规则调整为：

1. 若 `materials[].items[]` 存在，则以 item 自身模式为准
2. legacy 顶层 `wear_filter_mode` 只用于升格旧结构
3. 新前端请求可以不再依赖全局 `wear_filter_mode`
4. `use_absolute_wear` 视为 legacy alias，在 server 入口先按固定布尔归一化规则解析，再统一归并到 `wear_filter_mode`
5. `craftAssistUseAbsoluteWear` 仅属于 account-scoped UI state 兼容字段，不属于 server / API 入口 contract
6. `uiServer` 的 worker 分支与 direct service 分支必须从同一份 route-level normalized request body 派生参数；route 回归测试必须显式比较两条分支转发出去的 `targetWear` / `wearApproachMode` / `materials` / `blockedIds` / 派生 `selectedItemIds` / `includeCooling` / `includeComponentItems` / `wearOffsetPct` / `enableFastCraftAssist` / legacy mode 处理结果，并确认 direct 分支据此构造出的 `candidateRows` 输入语义与 worker 分支一致，确保不会因为分支不同而漂移

### 运行前数量校验

数量校验规则在前后端必须一致：

1. 本次 scope 只覆盖当前 craft-assist 的 `10` 件配方路径，不在本次改造中重新开放或推广 `5` 件路径
2. 为避免前后端漂移，implementation 需要新增单一真源 helper，例如 `resolveCraftAssistRequiredCount()`，当前固定返回 `10`
3. 以下消费者必须全部改为依赖这一真源 helper，而不是各自硬编码：
   - live panel 的总可分配件数、picker limit、新建 material 默认 count 分配，以及 `数量` 输入框的 `max` 展示与交互约束
   - `normalizeCraftAssistMaterialEntry(...)`、`normalizeCraftAssistMaterialList(...)` 等前端数量归一化路径中的 count clamp、非法值回退与总量裁剪
   - panel save / apply 校验
   - account-scoped draft restore / run payload 校验与数量归一化
   - craft predictor 的 craft-assist draft context requiredCount 归一化与缺省回退
   - `buildCraftPredictorRequestFromDraft(...)` 与 `buildCraftPredictorRequestFromRecipeEntry(...)`
   - predictor subtitle / status fallback 中展示的 `requiredCount`
   - 与 craft-assist recipe 有关的 UI / service 端 recipe-length / requiredCount 本地校验函数
   - 后端 `selectCraftAssistForRecipe(...)` 入口校验
4. 现有 `craftAssistTargetCountFromMaterials()` 与 `normalizeCraftPredictorRequiredCount()` 不允许继续各自维护 `5|10` 或其他独立策略：
   - 要么删除
   - 要么退化为仅委托 `resolveCraftAssistRequiredCount()` 的薄封装
5. 超额脏输入的 count 归一化算法必须固定，前后端共用同一语义：
   - 先把每个 `material.count` 归一化为正整数，再 clamp 到 `1..requiredCount`
   - 再按输入顺序稳定分配剩余额度，前项优先保留原 count，后项只拿剩余额度
   - 若某个 material 被裁剪后 `count <= 0`，则整个 material 丢弃
   - 该规则适用于 legacy restore、preset load、account-scoped state restore、run payload normalize 等“修复脏输入”路径
   - 该规则不表示超额配置合法；save / apply / run 仍必须在最终结果上满足 `sum(material.count) === requiredCount`
6. live 交互态中，用户修改 `数量` 输入框时仍应优先做即时 clamp，避免 UI 暂时制造超额状态；其上限与 restore/normalize 的总量语义必须来自同一个 `requiredCount` 真源
7. `sum(material.count) === requiredCount` 时才允许真正求解
8. 前端在点击保存、独立编辑保存、按配置选材前先做严格校验
9. 后端 `selectCraftAssistForRecipe(...)` 保留相同硬校验，防止 API 直接调用绕过 UI

## 测试设计

### 前端测试

需要新增或改造覆盖：

1. 旧结构读入会自动升格为 `items[]`
2. account-scoped state restore 中，legacy 顶层模式字段冲突时优先级固定为 `wear_filter_mode > use_absolute_wear > craftAssistUseAbsoluteWear > relative`
3. draft / preset / 其他非 account-state 输入的 legacy 模式优先级固定为 `wear_filter_mode > use_absolute_wear > relative`
4. 当新结构 `items[]` 已存在时，legacy `name` / `names[]` 与顶层模式字段只作为脏数据背景存在，不得覆盖 `items[]` 的 item 级模式与范围
5. 只有单值 `name` 的 legacy material 也能被正确升格
6. legacy 跨 material 重名升级时按“先到先得”稳定去重
7. 新结构 `items[]` 自身的脏数据也按同一套规则处理：
   - 同一 material 内重复名折叠
   - 跨 material 重名后项丢弃
8. 去重后若某个 material 已无存活 item，会自动丢弃该空 material
9. account-scoped state / draft / preset / comparable snapshot 不再新写顶层 `wear_filter_mode` / `use_absolute_wear`
10. 保存 preset 时只写新结构
11. 草稿快照与比较快照只基于 `items[]`
12. `数量` 渲染在条件设置头部右侧
13. 原“已选材料”大区域消失
14. 每个 `material` 内会渲染多个 item 小卡
15. 每张卡独立切换 `相对/绝对`
16. 切换模式后范围重置为新模式默认值
17. 默认范围 helper 在 `load` / `mode-switch` / `restore` / `renormalize` 四种 source 下遵循同一 contract，且“新建卡默认范围”“清空输入回默认范围”“切模式重置默认范围”三条 live UI 路径都明确落到 `mode-switch`
18. 删除最后一张卡会自动删掉整个 `material`
19. 默认范围在“有 rows / 无 rows 但有存值 / 全部缺失”三种情况下都按规定回退
20. `数量` 输入框的 `max`、count normalize/clamp、总量限制与新建 material 默认 count 都使用同一个 `requiredCount` 真源
21. 超额脏输入在 preset / draft / account-state restore 与 run payload normalize 时，会按“输入顺序优先保留前项、后项吃剩余额度、裁到 0 删组”的规则稳定裁剪
22. save / apply 在数量未凑满时会被前端拦截，超额时也会被同样拦截
23. `restoreCraftAssistDraftSnapshot(...)` 与 account-scoped state restore 会对 legacy 数据执行同一套升格与 round-trip
24. 新建 material 时默认 `count = 1`，且 legacy `craftAssistMainCount` / `craftAssistAuxCount` 不再写回
25. `wear_filter_mode` 字段存在但值非法时，会被归一化为 `relative`，并且不再继续回退 alias
26. `use_absolute_wear` 的非法值会按固定布尔归一化规则落到 `relative`
27. item 级 `wear_filter_mode` 的非法值会按同一规则归一化为 `relative`
28. 同一默认值经过 clamp + 6 位截断后，重新输入不会误翻成 `custom_range = true`
29. `custom_range = true` 的坏数据会按 spec 降级为默认范围，并通过 `resolvedCustomRange = false` 驱动 caller 清掉 custom flag
30. `custom_range = false` 的坏 `storedRange` 在 fallback 阶段会按同一规则继续回退，不会前后端各自补脑
31. UI 必须存在至少一处可见文案，明确区分“全局目标相对磨损”“卡片过滤模式”“已选卡数”“该组贡献件数”；tooltip / aria 仅作补充
32. 缺失 `item.id` 的 legacy / dirty 输入会按确定性规则补齐，并在 round-trip 后保持稳定
33. 即便前序 material 在跨组去重、删空或总量裁剪中消失，后续 surviving item 的 minted `item.id` 也不会因“稳定 material 索引”漂移而改变

建议优先覆盖：

- `node_sidecar/tests/craft-assist-panel-render.test.js`
- `node_sidecar/tests/craft-assist-preset-apply.test.js`
- `node_sidecar/tests/craft-assist-autoselect-writeback.test.js`
- `node_sidecar/tests/craft-assist-account-state.test.js`
- `node_sidecar/tests/craft-predictor-panel-state.test.js`

其中 `node_sidecar/tests/craft-predictor-panel-state.test.js` 至少要补：

1. `items[].name` 替代旧 `names[]` 后，draft predictor 仍按 material 聚合
2. 同一 material 内多 item 跨 collection / StatTrak 时继续报 `ambiguous_material_group`
3. `draft` context 真正走 `buildCraftPredictorRequestFromDraft(...)`，`recipe` context 才走 `buildCraftPredictorRequestFromRecipeEntry(...)`
4. `buildCraftPredictorRequestFromDraft(...)`、`buildCraftPredictorRequestFromRecipeEntry(...)` 与 subtitle / status fallback 使用同一 `requiredCount`
5. predictor 的 requiredCount 在缺省输入时会回退到 `resolveCraftAssistRequiredCount()`
6. predictor 对 legacy / new `items[]` 两种草稿输入都能稳定读取名字来源
7. draft predictor 的输入源固定为“已归一化 live draft + parentGroups + requiredCount”，而不是 recipe entry

`node_sidecar/tests/craft-assist-account-state.test.js` 至少要补：

1. legacy account-scoped state 恢复时的升格结果
2. 升格后再次保存的 round-trip 不再写回 legacy 顶层模式字段
3. `craftAssistMainCount` / `craftAssistAuxCount` 只读兼容、不再写回
4. 超额脏输入恢复时按稳定裁剪规则处理，且裁到 `0` 的空组不会残留
5. 只有单值 `name` 的 legacy material 也能被正确升格

### 后端测试

需要新增或改造覆盖：

1. `normalizeCraftAssistMaterialForRun` 能兼容新旧结构
2. server 侧 legacy 模式优先级固定为 `wear_filter_mode > use_absolute_wear > relative`
3. 当新结构 `items[]` 已存在时，legacy `name` / `names[]` / 顶层模式字段不会覆盖 item 级真源
4. 只有单值 `name` 的 legacy material 也能被正确升格
5. legacy 跨 material 重名会按稳定顺序去重
6. 新结构 `items[]` 的脏重复输入也会按稳定规则去重，并在 material 为空时整组丢弃
7. 同一 material 下多个 item 的候选会做并集去重
8. `relative` + `absolute` 混合卡片时过滤正确
9. candidate cache key 会因 `target_wear`、item 模式与范围变化而变化
10. legacy payload 仍可成功跑通选材
11. API 入口对 `use_absolute_wear` alias 的兼容生效，且不会误读 `craftAssistUseAbsoluteWear`
12. `custom_range = true` 的新结构 item 在 server 归一化后不会被默认范围逻辑改写
13. `custom_range = false` 的新结构 item 在 server 归一化后会按当前约束重算有效默认范围，约束缺失时才回退存值
14. `custom_range = true` 的坏数据会按 shared resolver contract 降级为默认范围，并通过 `resolvedCustomRange = false` 驱动 caller 清掉 custom flag
15. `custom_range = false` 的坏 `storedRange` 在 fallback 阶段会按同一规则继续回退，不会前后端各自补脑
16. item 级 `wear_filter_mode` 的非法值会按同一规则归一化为 `relative`
17. 超额脏输入在后端 normalize 时按同一稳定裁剪规则处理，裁到 `0` 的空组会被删除
18. 数量不足或超额时后端会拒绝求解
19. 若 `custom_range = false` 且最终有效默认范围未变化，则即便原始 payload 的旧 `wear_min / wear_max` 文本不同，cache key 也保持不变
20. 重复调用 `selectCraftAssistForRecipe({selectionContext, ...})` 时，legacy/new/custom/default-range tuple 不会错误复用同一 candidate cache
21. `createCraftAssistService().selectForRecipe({rows, ...})` 的 service-wrapper 自动 `selectionContext` 复用路径存在专门回归用例
22. worker / IPC 路径、inline candidateRows 路径、snapshot restore 路径都能透传并消费 `items[]`
23. 同一 candidate pool 分别走 UI live normalize、direct `selectionContext`、service-wrapper `{rows}`、worker inline `candidateRows`、worker snapshot rows 五条路径时，必须产出相同的：
   - effective default range
   - `item_names`
   - `primary_name`
   - `label`
   - runtime-only `name` / `names` alias 顺序
   - candidate cache-key tuple
   - `selection_trace` / prefilter trace 的名字顺序
24. `craftAssistSearch.js`、`craftAssistShardPrefilter.js` 以及 `craftAssistService.js` 最终挂到 `selection_trace.prefilter.contextRefine.rounds[].attempts[].materialName` 的 service-side trace 拼装，都必须只读复用 shared trace projection seam；若保留 legacy `materialName` 字段，它只能等于 `primary_name`，而多 item 的有序名字必须通过同一份 `item_names` / `label` 投影被可断言地暴露
25. 所有 persisted / wire serializer 都存在回归用例，确保 `item_names` / `primary_name` / `label` / `name` / `names` 不会写入 API payload、worker IPC、preset、account-state 或各类 snapshot
26. front / back / worker 对同一组 legacy / dirty / new 输入跑出的 normalize 结果存在 golden parity 用例，并显式比较 canonical normalized material shape：
   - `role`
   - `count`
   - `direction`
   - `disable_direction_limit`
   - `items` tuple 及顺序
   - `item_names`
   - `primary_name`
   - `label`
   - runtime-only `name` / `names` alias
   - `item.id` 在输入已提供稳定值时必须直接对齐；若输入缺失并由运行时生成，测试也必须直接断言真实 deterministic mint 结果，覆盖 `material.id` 存在与缺失（stable material index fallback）两类夹具，不得用 stub 掩盖真实 mint 逻辑
27. mixed-source stale-context 回归用例必须覆盖：即便 sibling source 与旧 `selectionContext` 拥有相同 asset-id 集合，只要 `alchemy_name/name`、`float_value`、`minfloat`、`maxfloat` 或 `includeCooling` 语义发生变化，也必须 rebuild fresh `selectionContext` 与 `candidateCache`，不能继续复用旧 context
28. `createCraftAssistService().selectForRecipe({rows, ...})` 的 service-wrapper 自动 `selectionContext` 复用路径存在 stale-context 回归用例：当 sibling `rows` / `candidateRows` 与缓存 context 不同源时，必须 rebuild fresh context，不能继续复用旧 `candidateCache`
29. 一旦 `materials[].items[]` 存在，global `wearFilterMode` 链不再影响 item 过滤或默认范围解析；legacy-only 升格边界之外不得再生效
30. 一旦 `materials[].items[]` 存在，即便 legacy 顶层 `wear_filter_mode` / `use_absolute_wear` 同时存在或被透传，candidate cache key tuple、`selection_trace` 与 prefilter trace 也必须保持 byte-for-byte 不变
31. `uiServer` `/api/craft/assist-select` 路由存在 route-level 回归：worker 分支与 direct service 分支对同一 normalized body 的 `targetWear` / `wearApproachMode` / `materials` / `blockedIds` / `selectedItemIds` / `includeCooling` / `includeComponentItems` / `wearOffsetPct` / `enableFastCraftAssist` / legacy mode 升格结果，以及下游可观察的 tuple / trace 投影都必须一致

建议优先覆盖：

- `tests/craftAssistService.test.js`
- `tests/craftAssistWorkerPool.test.js`
- `tests/craftAssistWorkerWiring.test.js`
- `tests/craftAssistSearch.test.js`
- `tests/craftAssistShardPrefilter.test.js`
- `tests/craftOutcomePredictor.test.js`
- `tests/uiCraftAssistSingleSource.test.js`
- `node_sidecar/tests/craft-assist-route.test.js`

## 实施顺序

1. 先补失败测试，锁定新结构与 UI 语义
2. 改前端归一化与 preset/草稿读写，让 `items[]` 成为真源
3. 改条件设置 UI，把旧“已选材料”区域改为 item 小卡
4. 改后端归一化、候选过滤与 cache key
5. 跑前后端定向回归，确认单卡、多卡、混合模式都稳定

## 验收标准

1. UI 中 `material` 不再显示 material 级磨损输入
2. 每个 item 小卡都有独立 `相对/绝对` 与 `Minwear / Maxwear`
3. item 切换模式后，范围会重置到新模式默认值
4. 保存后重新加载不会回退到旧 `names + material wear` 结构
5. 后端能在单 item、多 item、混合模式下稳定返回正确结果

## 风险与缓解

### 风险 1：旧 preset 升格不完整

缓解：

1. 所有入口统一走同一个升格 helper
2. 用前端测试锁定 preset、草稿、运行 payload 三条链

### 风险 2：item 并集导致候选池扩大，cache 失真

缓解：

1. cache key 改为 item 级展开
2. 测试覆盖不同 item 范围与模式的 key 区分

### 风险 3：UI 结构调整导致已有交互回退

缓解：

1. 只重排条件设置局部布局
2. 保留原 `material` 容器与 picker 流程
3. 用面板渲染测试锁定关键文案与结构
