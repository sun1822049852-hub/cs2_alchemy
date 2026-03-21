# 皮肤磨损区间 HTML 主源补全设计

## 1. 背景

当前仓库已经具备基础入库和详情补全链，但 `minfloat` / `maxfloat` 的补全仍主要依赖 `paintwear_rank`。真实数据验证表明，这条链路并不稳定：

- `GET /api/market/goods/info` 当前容易返回 `403`
- `paintwear_rank` 对部分刀、Fade、Doppler 等商品会返回空结果
- 商品页本身却仍能展示顶部磨损筛选区间

魔尊已经确认：数据库仍是中心状态，`info` 只负责基础信息入库；磨损详情应在入库后补回数据库，而不是反写 `info`。

同时，商品页 HTML 已被验证包含两类关键主源信息：

- `paintwear_choices`
- `relative_goods_ids.push("...")`

其中：

- `paintwear_choices` 的真实初始化数据位于 `var filter_data_selling = { ... }`
- `relative_goods_ids` 表示同一家族的关联商品成员，但真实页面会混入 `StatTrak` 镜像成员

因此，本设计将磨损补全主链调整为：

1. 商品页 HTML 内嵌 `paintwear_choices` 作为主源
2. `paintwear_rank` 作为补源和校对源
3. 两者冲突时取更大区间，并落 `warn` 日志

## 2. 目标

本次设计目标如下：

1. 将 `fetchWearRangeByGoodsId(goodsId)` 的主源改为商品页 HTML
2. 从任意家族成员页出发，稳定恢复该家族的磨损上下界
3. 明确避免无限递推和重复抓取
4. 保留 `paintwear_rank`，但只作为补源和冲突校对源
5. 将最终 `minfloat`、`maxfloat`、`wear_range` 写回数据库

## 3. 非目标

本次不做以下事情：

1. 不恢复 `goods/info` 作为主链
2. 不新增数据库字段保存冲突状态
3. 不引入浏览器自动化或 DOM 解析依赖
4. 不修改基础 `info -> 入库` 的职责边界
5. 不在本设计中处理价格更新逻辑

## 4. 关键约束

### 4.1 数据职责边界

- `info` 只负责基础字段入库
- 磨损上下界以后续数据库状态为准
- 详情补全链必须跟着入库跑，也应允许独立补跑

### 4.2 家族规模上限

一个皮肤家族最多对应 5 个同轨成员，也就是最多 5 个磨损区间版本。

真实探针已经证明：

- 原始 `relative_goods_ids` 可能返回 `6` 个 id
- 第 `6` 个常见情况不是第 `6` 个磨损档位，而是 `StatTrak` 镜像成员

因此：

- 先按 `seed goods_id` 的 `StatTrak` 属性过滤同轨成员
- 过滤后的有效家族成员上限固定为 `5`
- 若同轨成员仍超出 `5`，视为页面数据异常或解析误判，必须落 `warn`

### 4.3 避免无限递推

魔尊已经明确：同一家族成员页再次访问时，仍会重复返回整组家族成员 id。

因此家族恢复策略不能采用无限闭包扩张，而必须采用：

1. 用第一页一次性定族
2. 定族后逐页采样
3. 后续页面返回的家族成员 id 只做一致性校验，不再继续扩张

同时，真实页面在连续探针后可能返回 `429 Too Many Requests`。因此家族页采样必须保持低频，并复用现有请求重试与退避策略，不能把整族页面高并发扫完。

## 5. 方案对比

### 方案 A：继续以 `paintwear_rank` 为主源

优点：

- 已有代码和测试基础较多

缺点：

- 真实数据下会缺边
- 某些家族直接返回空排行
- 无法解释“页面有区间、接口无数据”的情况

### 方案 B：商品页 HTML 为主源，`paintwear_rank` 为补源

优点：

- 与页面真实展示一致
- 可以从任一成员页恢复整族
- 即使 `goods/info` 被限流，主链仍可用

缺点：

- 需要新增 HTML 解析逻辑
- 需要处理家族一致性与补源冲突

### 方案 C：只用页面当前单页的 `paintwear_choices`

优点：

- 请求最少

缺点：

- 单页往往只暴露局部区间
- 无法恢复整族真实上下界

推荐采用方案 B。

## 6. 总体架构

### 6.1 主源链

`fetchWearRangeByGoodsId(seedGoodsId)` 改为以下流程：

1. 请求 `GET /goods/<seedGoodsId>?tab=selling&page_num=1`
2. 解析第一页中的：
   - `filter_data_selling.paintwear_choices`
   - `relative_goods_ids`
3. 基于 `seed goods_id` 的 `StatTrak` 属性过滤同轨成员
4. 用第一页一次性确定 `familyGoodsIds`
5. 逐个访问 `familyGoodsIds` 的成员页
6. 对所有成功页面的 `paintwear_choices` 取并集
7. 得到 `main_min` / `main_max`

### 6.2 补源链

在家族成员集合已经固定后：

1. 对固定的 `familyGoodsIds` 逐个调用 `paintwear_rank`
2. 仅在整族成员全部成功时，生成 `rank_min` / `rank_max`
3. 与主源区间做扩边合并

### 6.3 最终输出

provider 最终仍返回统一结构：

```js
{
  minfloat: number,
  maxfloat: number,
  wear_range: number
}
```

## 7. HTML 主源设计

### 7.1 第一跳定族

主源流程的第一步只信任 `seedGoodsId` 页面。

第一页承担两件事：

1. 提供当前页可见的 `paintwear_choices`
2. 一次性给出该家族的关联成员 id

定族规则：

- 先得到 `candidateGoodsIds = unique(seedGoodsId + relative_goods_ids)`
- 原始候选集合允许出现 `StatTrak` 镜像成员，因此允许临时达到 `6` 个
- 需要基于 `seed goods_id` 的 `StatTrak` 属性，过滤出与 `seed` 同轨的候选成员
- `familyGoodsIds = filteredSameTrackGoodsIds`
- 若第一页没有解析出 `relative_goods_ids`，则退化为只包含 `seedGoodsId`
- 若过滤后的唯一成员数大于 `5`，截到前 `5` 个并落 `warn=family_size_exceeded`

一旦 `familyGoodsIds` 定下来，后续不再允许扩张。

### 7.2 逐页采样

对 `familyGoodsIds` 中的每个成员页：

- 每个 `goods_id` 最多访问一次
- 只解析 `paintwear_choices`
- 需同时解析页面标题中的 `StatTrak` 属性，用于和 `seed` 做同轨校验
- 若页面中再次返回家族成员 id，只与第一页定下的集合比较
- 若不一致，落 `warn=family_goods_mismatch`
- 不因为后续页面的新 id 再次入队或递推

因此整族请求上界固定为：

- 原始候选探测最多 `6` 页
- 有效同轨家族采样最多 `5` 页

### 7.3 `paintwear_choices` 解析规则

解析器只提取页面内联脚本中的磨损桶数组，不依赖 DOM 树结构。

真实页面同时存在：

- 模板片段中的 `paintwear_choices`
- 初始化对象 `var filter_data_selling = { ... paintwear_choices: ... }`

因此解析时不能抓到第一个同名字符串就停止，必须明确锚定 `filter_data_selling` 初始化对象中的 `paintwear_choices`。

目标数据形态示意：

```js
var filter_data_selling = {
  paintwear_choices: [["0.10","0.11"],["0.11","0.12"]],
  fade_choices: ...
}
```

解析后统一转为：

```js
[
  {min: 0.10, max: 0.11},
  {min: 0.11, max: 0.12}
]
```

页面级校验规则：

- 桶数组不能为空
- `min` / `max` 必须是有限数
- `0 <= min <= max <= 1`

页面级区间汇总规则：

- `pageMin = 所有桶下界的最小值`
- `pageMax = 所有桶上界的最大值`

### 7.4 主源并集规则

只要整族中至少有一页成功解析出有效 `paintwear_choices`，就认定主源有效。

整族主源区间计算：

- `main_min = 所有成功页面 pageMin 的最小值`
- `main_max = 所有成功页面 pageMax 的最大值`
- `main_range = main_max - main_min`

如果原始关联页里混入了 `StatTrak` 镜像成员，则这些页面只用于识别和过滤轨道，不参与非同轨整族区间并集。

## 8. 补源 `paintwear_rank` 设计

### 8.1 触发时机

补源只在家族已经固定后运行，不允许用补源发现新成员。

即：

1. 先定族
2. 再逐页采主源
3. 最后对同一组固定成员跑 `paintwear_rank`

### 8.2 完整性要求

补源采用整族一致性硬规则：

- 只有当 `familyGoodsIds` 中所有成员都成功返回排行区间时，补源才视为有效
- 只要任一成员失败、空结果、缺上下界或解析失败，整族 `rank` 结果全部作废

原因：

- 部分成员成功会漏边
- 局部极值不能当整族极值使用

### 8.3 `0~1` 豁免

存在一种允许绕过补源完整性要求的情形：

- 当前已拿到的有效区间已经是完整 `0~1`

判定规则：

- `minfloat <= 0`
- `maxfloat >= 1`

若主源已经得到完整 `0~1`，则直接判整族成功，不再要求 `paintwear_rank` 整族全成功。

这条豁免只认：

- 主源本轮成功得到的完整区间
- 或数据库中该家族已存在的完整有效区间

不认“部分成功的排行结果恰好看起来像 `0~1`”这种情况。

### 8.4 补源并集规则

当且仅当整族排行结果完整时：

- `rank_min = 全成员排行 minfloat 的最小值`
- `rank_max = 全成员排行 maxfloat 的最大值`
- `rank_range = rank_max - rank_min`

## 9. 主源与补源合并规则

最终合并规则如下：

1. 主源有效且主源已是 `0~1`
   - 直接成功
   - 可跳过补源完整性约束
2. 主源有效且非 `0~1`，补源整族完整
   - 合并
   - `final_min = min(main_min, rank_min)`
   - `final_max = max(main_max, rank_max)`
3. 主源有效且非 `0~1`，补源不完整
   - 仅使用主源
   - 落 `warn=rank_incomplete`
4. 主源无效，补源整族完整
   - 仅使用补源
5. 主源无效，补源不完整
   - 整族失败

冲突时始终取更大区间，即向外扩边，而不是覆盖较大值或较小值。

## 10. 日志设计

本次不新增数据库字段记录冲突，只写后端日志，级别固定为 `warn`。

### 10.1 家族规模异常

```text
wear family=<familyKey> seed_goods_id=<seed> candidate_goods_ids=<ids> filtered_goods_ids=<ids> warn=family_size_exceeded
```

### 10.2 家族成员不一致

```text
wear family=<familyKey> seed_goods_id=<seed> closure_goods_ids=<ids> page_goods_id=<pageId> parsed_relative_goods_ids=<ids> warn=family_goods_mismatch
```

### 10.3 补源不完整

```text
wear family=<familyKey> seed_goods_id=<seed> closure_goods_ids=<ids> rank_success=<n> rank_total=<n> warn=rank_incomplete
```

### 10.4 补源扩边

```text
wear family=<familyKey> seed_goods_id=<seed> closure_goods_ids=<ids> main_range=<min>-<max> rank_range=<min>-<max> final_range=<min>-<max> side=<min|max|both> warn=range_expanded
```

### 10.5 `0~1` 豁免

```text
wear family=<familyKey> seed_goods_id=<seed> closure_goods_ids=<ids> final_range=0.00-1.00 warn=rank_bypass_full_range
```

## 11. 模块改动

### 11.1 修改

- `node_sidecar/src/services/buffSkinDetailProvider.js`
  - `fetchWearRangeByGoodsId` 改为 HTML 主源 + 排行补源
  - 新增 HTML 解析纯函数
- `node_sidecar/src/services/skinDetailEnrichmentService.js`
  - 保持按 family 调 provider
  - 继续只接收最终磨损区间结果与错误日志
- `tools/rebuildSkinDb.js`
  - 统计输出保持不变，仅消费新的磨损补齐结果

### 11.2 建议新增的 provider 内部纯函数

- `extractRelativeGoodsIdsFromGoodsPageHtml(html)`
- `extractPaintwearChoicesFromGoodsPageHtml(html)`
- `summarizePaintwearChoices(choices)`
- `mergeWearRanges(mainRange, rankRange)`

这些函数不需要暴露给 service 层，但应尽量独立，便于单测。

## 12. 测试设计

### 12.1 provider 测试

在 `tests/buffSkinDetailProvider.test.js` 中新增以下场景：

1. `seed` 页解析出 `6` 个原始成员 id，其中 `1` 个是 `StatTrak` 镜像；过滤同轨后只保留 `5` 个真实磨损成员
2. 后续成员页重复返回同样的家族 id，不触发递推；原始探测页数不超过 `6`，有效采样页数不超过 `5`
3. `seed` 页解析不到家族成员 id，退化为只访问当前 `seed`
4. 主源部分页面失败，但至少一页成功，仍能得到有效主源区间
5. 主源已是 `0~1`，即使排行不完整也判成功
6. 主源非 `0~1`，排行缺任一成员时整组作废并落 `rank_incomplete`
7. 主源与排行冲突时，最终区间向外扩边并落 `range_expanded`
8. 成员页返回的家族成员集合与第一页不一致，落 `family_goods_mismatch`
9. 过滤后的同轨成员仍超过 `5` 个时截断并落 `family_size_exceeded`
10. 页面前部模板片段也包含 `paintwear_choices` 字样时，解析器仍应从 `filter_data_selling` 抽取真实初始化桶

### 12.2 enrichment 测试

在 `tests/skinDetailEnrichmentService.test.js` 中补充以下场景：

1. 同一家族多条记录仍只按 family 维度写回一次最终区间
2. provider 返回 `0~1` 完整区间时，所有家族成员行成功写回
3. provider 抛出主源无效且排行不完整错误时，整族记录记失败

## 13. 验收标准

满足以下条件即视为达标：

1. 磨损补全主链不再依赖 `goods/info`
2. 从任意一个家族成员页出发，都能在原始候选探测最多 `6` 页、有效同轨采样最多 `5` 页的约束内完成整族主源采样
3. 原始 `relative_goods_ids` 混入 `StatTrak` 镜像成员时，系统能正确过滤出与 `seed` 同轨的有效家族成员
4. 同一家族成员页重复返回成员 id 时，不会出现无限递推
5. 主源与补源冲突时，最终区间取更大范围并写 `warn`
6. 补源不完整时，不会把部分排行结果误当整族结果
7. 主源已是 `0~1` 时，可绕过补源完整性要求直接成功
8. 现有数据库写回结构保持不变，只更新 `minfloat`、`maxfloat`、`wear_range`
