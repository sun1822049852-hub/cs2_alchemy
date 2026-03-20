# 皮肤基础入库后详情补全设计

## 1. 背景

当前仓库的 `skin` 基础库来自 `info` API 输出的基础字段导入。该基础数据只稳定提供：

- `name`
- `marketHashName`
- `platformList`

它不负责承载 `collection`、`rarity`、`minfloat`、`maxfloat` 等详情字段。

现有实现会先把基础字段写入 `skin` 表，再尝试从旧库复用部分 metadata。对于旧库中没有历史记录的新皮肤家族，`collection` 和 `rarity` 会保留为空，进而导致运行时库存行被标记为 `missing_collection` / `missing_rarity`。

同时，魔尊已经确认：手动浏览器点击时使用的详情接口可以拿到收藏品与稀有度信息。因此正确的数据链路不应是“把详情反写回 `info`”，而应是：

1. `info` 只负责基础信息入库
2. 数据库作为中心状态
3. 入库后立刻扫描缺口记录
4. 调用详情接口补齐数据库

## 2. 关键约束

### 2.1 数据职责边界

- 不修改 `info` 的结构和职责
- 不把详情字段回写到 `info`
- 详情补全以后续数据库状态为准

### 2.2 数据库命名与路径

本次实现必须以当前仓库的数据库为准，不允许把旧仓库硬编码直接带入。

明确要求：

- 当前目标数据库是 `csgo_skins.db`
- 运行时应优先使用当前仓库传入的 `dbPath`
- 命令行入口应继续尊重 `--db`
- 若未显式传参，则使用当前仓库默认数据库路径
- 禁止在新实现中硬编码旧仓库的 `steam_skins.db`
- 禁止硬编码旧仓库目录路径

说明：

- 旧 Python 脚本来自其他仓库，只能参考接口顺序和字段提取方式
- 旧脚本中的库名、默认路径、日志路径不能直接复用

### 2.3 执行方式

- 详情补全必须跟随入库流程自动执行
- 不拆成单独人工命令作为主路径
- 但实现上应保留内部可复用能力，便于后续测试和补跑

### 2.4 一致性要求

- 基础入库成功后，即使详情补全部分失败，也不回滚基础库
- 详情补全属于 best-effort 阶段
- 失败必须留痕，可在后续再次入库时继续补

## 3. 目标

本次要实现的目标如下：

1. 保留现有 `info -> 基础字段入库` 主流程
2. 在基础入库完成后自动执行详情补全
3. 对缺少 `collection` / `rarity` 的皮肤家族调用已验证的两个详情接口
4. 将详情结果批量写回当前数据库
5. 让运行时库存解析继续只依赖数据库，不直接调详情接口
6. 为详情补全增加状态字段、错误留痕与统计输出

## 4. 总体架构

采用“单命令双阶段”结构：

### 阶段一：基础入库

仍由现有 `skinDbSync` 负责：

- 从 `info` JSON 读取基础数据
- 过滤出武器皮肤体系记录
- 解析基础字段
- 复用旧库 exact / family metadata
- 执行 `skin` 表 upsert
- 计算基础 `alchemy_type`

### 阶段二：详情补全

在基础入库 `COMMIT` 完成后执行：

- 扫描 `collection` / `rarity` 仍为空的记录
- 按皮肤家族分组
- 每个家族选一个代表记录作为详情查询入口
- 调用两个详情接口获取收藏品和稀有度
- 将同一家族下的缺失记录批量补齐
- 更新详情状态字段
- 重算受影响记录的 `alchemy_type`

### 为什么不把网络补全放进同一个事务

原因如下：

- 网络调用可能超时、失败或限流
- 长事务会放大锁持有时间
- 基础库构建和详情补全的失败语义不同

因此正确边界是：

- 阶段一：数据库事务型操作
- 阶段二：事务外网络补全 + 小批量数据库写回

## 5. 家族分组规则

详情补全不能按单个磨损版本逐条请求，而应按家族归并。

归并目标：

- 普通版与 `StatTrak` 版归为同一家族
- 同一武器皮肤不同磨损版本归为同一家族
- 一次详情成功后，整族缺失记录一起补齐

分组键应复用当前仓库已有的 family 归一化逻辑，不允许详情补全独立发明另一套名称处理规则。

建议做法：

- 抽出共享的 family key helper
- 基础入库与详情补全共用该 helper

## 6. 详情接口设计

第一版只实现魔尊已经验证成功的 BUFF 两接口链。

接口顺序：

1. 通过 `goods_id` 请求容器列表接口
2. 再用容器信息请求容器详情接口
3. 在容器详情中定位目标 `goods_id`
4. 提取：
   - `collection`
   - `rarity`

输出统一标准化为：

```js
{
  collection: string,
  rarity: string,
  detail_source: "buff"
}
```

第一版不实现：

- C5 详情补全
- 有品详情补全
- 多 provider 优先级切换

但 provider 层要保留可扩展接口，后续可以新增 `c5` / `youpin` provider。

## 7. 数据库状态字段

为保证详情补全过程可观测，建议在 `skin` 表新增以下字段：

- `detail_status TEXT`
- `detail_source TEXT`
- `detail_checked_at DATETIME`
- `detail_error TEXT`
- `detail_attempts INTEGER DEFAULT 0`

状态定义：

- `pending`
  - 该记录仍缺详情，但存在可尝试的平台 ID
- `ok`
  - 详情已补齐
- `failed`
  - 本轮尝试失败，已记录错误原因

初始写入规则：

- 若基础入库阶段已通过旧库复用拿到 `collection` / `rarity`，则置为 `ok`
- 若仍为空但存在可用 `buffid`，则置为 `pending`
- 若仍为空且没有支持的详情平台 ID，则置为 `failed`
  - `detail_error = "no_supported_platform_id"`

## 8. 详情补全执行规则

### 8.1 代表记录选择

每个 family 只选择一个代表记录请求详情。

第一版选择规则：

1. 优先选择存在 `buffid` 的记录
2. 若家族内存在多个 `buffid`，任选一个稳定代表即可
3. 若没有任何 `buffid`，整族直接记为 `failed`

### 8.2 成功写回

若代表记录查询成功：

- 将结果写回同一家族所有缺少 `collection` / `rarity` 的记录
- 将这些记录的 `detail_status` 置为 `ok`
- 清空 `detail_error`
- 写入 `detail_source`
- 更新 `detail_checked_at`
- `detail_attempts += 1`

### 8.3 失败写回

若代表记录查询失败：

- 该家族所有待补记录统一记为 `failed`
- 写入失败摘要到 `detail_error`
- 更新 `detail_checked_at`
- `detail_attempts += 1`

### 8.4 重算炼金类型

任何成功补齐 `collection` / `rarity` 的记录，补齐后都必须重新计算 `alchemy_type`。

为避免全表重算，建议只重算本轮受影响的家族记录。

## 9. 超时、重试与限流

第一版采用保守策略：

- 并发数固定为 `2`
- 单请求超时 `10-15s`
- 对 `timeout` / `5xx` 做一次立即重试
- 对 `4xx` / `not_found` / `no_buffid` 这类确定性失败不重试

原因：

- 优先保证成功率和稳定性
- 避免 BUFF 接口限流
- 先做可用，再做吞吐优化

## 10. 模块拆分

### 10.1 保留并修改

- `node_sidecar/src/skinDbSync.js`
  - 继续负责基础入库
  - 在基础事务完成后调用详情补全 orchestrator

- `tools/rebuildSkinDb.js`
  - 继续作为入口
  - 输出两阶段统计结果

### 10.2 新增模块

- `node_sidecar/src/services/skinDetailEnrichmentService.js`
  - 负责缺口扫描、family 分组、并发控制、状态流转、结果统计、批量回写

- `node_sidecar/src/services/buffSkinDetailProvider.js`
  - 负责 BUFF 两接口调用和解析

- `node_sidecar/src/services/skinFamilyKey.js`
  - 负责 family key 归一化

## 11. 日志与统计

`rebuildSkinDb` 结束时除现有基础统计外，还应输出：

- `detail families pending`
- `detail families ok`
- `detail families failed`
- `detail rows filled`
- `detail rows still missing`
- `detail rows no supported platform`

同时，日志需记录：

- 当前使用的数据库路径
- 本轮详情补全 provider
- 每个 family 的代表 `goods_id`
- 成功/失败摘要

## 12. 测试要求

### 12.1 基础同步测试

扩展现有 `tests/skinDbSync.test.js`，覆盖：

- 基础入库后会调用详情补全阶段
- 成功补齐后数据库中的 `collection` / `rarity` 被写回
- 成功补齐后 `detail_status = ok`
- 成功补齐后受影响记录的 `alchemy_type` 被重新计算

### 12.2 详情补全服务测试

新增 `tests/skinDetailEnrichmentService.test.js`，覆盖：

- family 分组是否正确归并普通版与 `StatTrak`
- 每个 family 是否只查询一个代表记录
- 单个 family 成功后是否整族回写
- 单个 family 失败后是否整族标记 `failed`
- 详情补全失败时是否不影响基础入库结果

### 12.3 Provider 测试

第一版不打真实网络。

通过 stub `fetch` 返回两个接口样本 JSON，覆盖：

- 正常返回
- 容器列表为空
- 容器详情找不到目标 `goods_id`
- `rarity` 字段缺失
- 请求超时

## 13. 非目标

本次不做以下事项：

- 不修改 `info` 结构
- 不回写详情到 `info`
- 不实现 C5 / 有品详情 provider
- 不让 UI 或运行时直接请求详情接口
- 不做高并发性能优化
- 不尝试猜测缺失收藏品

## 14. 验收标准

满足以下条件即视为本次设计达标：

1. 同一条 `rebuildSkinDb` 命令可完成“基础入库 + 详情补全”
2. 新物品家族不再只依赖旧库 metadata 才有 `collection` / `rarity`
3. 当前仓库实现中不再出现旧仓库 `steam_skins.db` 的硬编码依赖
4. 详情补全失败不会导致基础入库整体失败
5. 数据库能够明确区分 `pending / ok / failed`
6. 运行时仍然只依赖数据库，不直接调详情接口
