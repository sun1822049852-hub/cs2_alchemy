# 辅助选材前端单真源清理设计

## 背景

当前辅助选材已经由后端 `node_sidecar/src/services/craftAssistService.js` 承担核心选材逻辑，并且主流程 `applyCraftAssistAutoSelection(...)` 已经通过 `/api/craft/assist-select` 请求后端结果。

但前端 `node_sidecar/ui/app.js` 里仍然保留了一整套本地辅助选材求解器，包括：

- 候选收集与排序
- 初选 split 策略
- deficit / overflow / offset correction
- 本地 `runCraftAssistSelectionForRecipe(...)`
- 同稀有度 fallback 求解

这导致仓库里同时存在前后端两套近似规则。随着“主料 / 辅料感知逼近目标磨损”逻辑已经只在后端演进，前端这套旧求解器继续保留只会制造双真源和后续维护漂移。

## 目标

1. 明确前端不再承载任何辅助选材求解职责。
2. 后端成为辅助选材规则的唯一真源。
3. 前端仅保留配置编辑、请求组装、结果消费和 UI 渲染职责。
4. 删除前端中已失效的本地 solver 代码，避免后续误用。

## 非目标

1. 不修改辅助选材的请求/响应契约。
2. 不调整材料选择 UI、预设 UI、数量与范围输入交互。
3. 不修改后端当前已合入的 role-aware 选材规则。
4. 不新增新的前端选材兜底逻辑。

## 现状分析

当前前端主流程已经具备以下特征：

- 由 `normalizeCraftAssistMaterialsForRun()` 生成材料范围与角色配置。
- 由 `applyCraftAssistAutoSelection(...)` 组织请求体并调用 `/api/craft/assist-select`。
- 根据后端返回的 `item_ids`、`overall`、`rarity`、`recipe_ok`、`recipe_reason` 更新配方和状态文案。

因此，前端本地 solver 当前并不是运行时必需依赖，而是遗留的重复实现。

## 设计决策

### 1. 前端职责边界

前端仅负责：

- 维护辅助选材材料列表、主辅角色、数量与范围配置
- 维护 `target_wear`、`wear_filter_mode`、`blocked_ids`、`include_cooling`、`wear_offset_pct`
- 发起 `/api/craft/assist-select`
- 消费后端返回结果并填充配方
- 展示日志和状态提示

前端不再负责：

- 计算候选优先级
- 进行本地初选
- 做本地 deficit / overflow / offset 修正
- 做本地 rarity fallback 求解
- 推导“哪 10 个材料最合适”

### 2. 删除范围

从 `node_sidecar/ui/app.js` 中删除只为本地辅助选材求解器服务的函数与相关调用链，至少包括这一类能力：

- 本地候选值计算与候选收集
- 本地候选排序与 split 选取
- 本地下探、上抬、偏移回拉修正
- 本地最小成本同稀有度求解
- 本地 `runCraftAssistSelectionForRecipe(...)`

删除后，前端辅助选材路径必须只剩“构造请求 -> 调用接口 -> 应用结果”。

### 3. 接口约束

本次清理不改变接口契约。前端继续发送：

- `username`
- `target_wear`
- `wear_filter_mode`
- `materials`
- `blocked_ids`
- `include_cooling`
- `wear_offset_pct`

前端继续消费后端返回：

- `item_ids`
- `overall`
- `rarity`
- `recipe_ok`
- `recipe_reason`
- `picks`（仅用于日志兼容时可选读取）

### 4. 失败处理

删除本地 solver 后，辅助选材失败只依赖后端返回错误。前端只负责：

- 保留并展示后端错误文案
- 回滚当前临时创建但未成功填充的配方项
- 不再尝试本地再求一次

### 5. 验收标准

满足以下条件即视为完成：

1. `node_sidecar/ui/app.js` 不再包含本地辅助选材求解器主路径。
2. 点击“按配置选材”时仍能正常调用 `/api/craft/assist-select` 并写入返回结果。
3. 现有后端辅助选材测试仍通过。
4. 前端代码中不再残留会误导维护者的镜像选材函数名，例如本地 `runCraftAssistSelectionForRecipe(...)`、本地 correction / fallback solver。

## 风险与控制

### 风险 1：删除过多导致 UI 流程误伤

控制方式：

- 只删除与本地 solver 强绑定的函数
- 保留材料归一化、请求构造、结果日志、状态提示
- 通过搜索调用链确认不存在残余引用

### 风险 2：后续有人再次在前端补算法

控制方式：

- 在文档和代码结果中明确“后端为唯一真源”
- 删除而不是保留 debug 版 solver，减少误复用入口

### 风险 3：接口返回兼容性被误判

控制方式：

- 实现前确认 `uiServer` 与 `craftAssistService` 当前返回字段
- 清理后仅验证主流程依赖的字段仍可完整消费

## 实施建议

推荐按以下顺序执行：

1. 先写一个最小保护测试或静态校验，锁定前端不再引用本地 solver 入口名。
2. 删除 `app.js` 中本地辅助选材求解器及其私有辅助函数。
3. 重新验证前端主流程仍然只通过后端接口工作。
4. 跑后端辅助选材回归测试，确保单真源方案没有引入行为回退。
