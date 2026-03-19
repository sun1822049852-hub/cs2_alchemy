# 武器皮肤全量入库与炼金类型设计

## 1. 背景

当前项目使用的数据库为 `C:\Users\18220\Desktop\cs2_alchemy\csgo_skins.db`，核心表为 `skin`。现有库内仅有约 9812 条记录，不足以覆盖 `C:\Users\18220\Desktop\smelter\data\steam_base_info_20260315_232059.json` 中的武器皮肤全集。

历史脚本 `C:\Users\18220\Desktop\smelter\CS2SkinDataCollector1.py` 已经过期，存在过滤范围不完整、字段依赖旧结构的问题，本次不直接复用其导入逻辑，只参考其名称解析思路。

## 2. 目标

本次只解决数据库入库问题，不修改老程序。

目标如下：

1. 从全量 JSON 中筛出武器皮肤体系数据并写入 `skin` 表。
2. 对 `skin` 表执行全量对齐，而不是增量补丁。
3. 为 `skin` 表新增 `alchemy_type` 列，供当前程序后续直接读取。
4. 缺失 `collection`、`rarity`、`minfloat`、`maxfloat`、`wear_range` 的新增记录允许入库，但保留空值。
5. 纪念品物品不入库，不新增纪念品列。

## 3. 范围

### 3.1 入库范围

保留以下武器皮肤体系记录：

- 普通武器皮肤
- StatTrak 武器皮肤
- 刀类皮肤
- 手套类皮肤

### 3.2 排除范围

以下项目不写入 `skin` 表：

- Souvenir / 纪念品物品
- Sticker
- Sealed Graffiti
- Patch
- Music Kit
- 武器箱、钥匙、胶囊、通行证、礼包
- Pin、Agent 等非武器皮肤类市场物品

## 4. 数据库变更

在 `skin` 表新增一列：

- `alchemy_type TEXT DEFAULT '不能炼金'`

本次不新增纪念品字段。

## 5. 导入字段映射

### 5.1 直接解析字段

从 JSON 解析并写入：

- `markethashname`
- `name`
- `basemarkethashname`
- `basename`
- `wearlevel`
- `isstattrak`
- `buffid`
- `c5id`
- `youpinid`

说明：

- `markethashname` 使用 `marketHashName`
- `name` 使用 `name`
- `basemarkethashname` 通过去除磨损后缀得到
- `basename` 通过中文名去除磨损后缀得到
- `wearlevel` 从中英文磨损后缀解析
- `isstattrak` 通过名称中是否包含 `StatTrak` 判断
- 平台 ID 从 `platformList` 提取

### 5.2 复用旧库字段

以下字段优先通过 `markethashname` 匹配现有 `skin` 表并复用：

- `collection`
- `rarity`
- `minfloat`
- `maxfloat`
- `wear_range`

若无法匹配到旧记录，则这些字段保留空值。

其中：

- `wear_range` 在 `minfloat` 和 `maxfloat` 都存在时可重新计算为 `maxfloat - minfloat`
- 若 `minfloat` 或 `maxfloat` 缺失，则 `wear_range` 也保持空值

## 6. 全量同步策略

本次同步以本次导入脚本计算出的“目标武器皮肤全集”为准。

执行顺序如下：

1. 读取 JSON
2. 过滤出允许入库的武器皮肤记录
3. 标准化并解析字段
4. 计算 `alchemy_type`
5. 在事务内执行 upsert
6. 删除 `skin` 表中不属于本次目标全集的旧记录

结果要求：

- 导入完成后，`skin` 表只保留本次定义范围内的武器皮肤体系记录
- 历史残留的过期记录、非目标范围记录一并删除

## 7. 炼金类型规则

`alchemy_type` 仅有三个取值：

- `5合1材料`
- `10合1`
- `不能炼金`

计算规则如下：

1. `collection` 或 `rarity` 为空时，记为 `不能炼金`
2. 同一收藏品内的最高品质，记为 `不能炼金`
3. 如果某个收藏品存在“金色品质”，则该收藏品中金色品质下一级，也就是红色品质，记为 `5合1材料`
4. 其余仍可向上升级的品质，记为 `10合1`

实现原则：

- 规则按同一收藏品内的相对层级计算
- 不把逻辑硬编码到某一个固定中文品质名上
- 若现有元数据不足以判断收藏品内品质层级，则保守写为 `不能炼金`

## 8. 实现方式

使用一个独立同步脚本完成本次任务，而不是修改旧采集器或直接塞进运行时代码。

推荐实现位置：

- `tools/` 或项目内等价的离线脚本目录

脚本职责：

1. 执行 schema 补充
2. 执行全量导入
3. 执行全量对齐删除
4. 输出导入统计信息

## 9. 统计输出

脚本至少输出以下统计项：

- JSON 总记录数
- 过滤后武器皮肤记录数
- 排除的纪念品数量
- 新增数量
- 更新数量
- 删除数量
- 缺少 `collection/rarity` 的数量
- `alchemy_type` 各类型数量

## 10. 风险与约束

### 10.1 已知风险

- 新增的大量武器皮肤没有现成 `collection`、`rarity`、`float` 元数据来源
- 因此这部分记录的 `alchemy_type` 会先保守落为 `不能炼金`
- 后续如果用户指定其他收集器补齐元数据，需要重新运行同步脚本刷新结果

### 10.2 本次不处理

- 不修改老程序
- 不新增纪念品字段
- 不接入外部网络抓取
- 不强行猜测缺失收藏品和品质

## 11. 验证要求

至少验证以下内容：

1. `skin` 表成功新增 `alchemy_type`
2. 导入完成后仅保留目标范围记录
3. 纪念品物品不在库中
4. `markethashname` 保持唯一
5. `alchemy_type` 仅出现三种合法值
6. 缺失元数据的记录可正常入库且保留空字段
