# Craft Assist 精度修复记录

## 问题概述

在 below 模式下，选材算法预测的材料均值通过验证，但实际合成产物超出用户设定的目标磨损值。

## 根本原因

**浮点数精度差异**：吾的计算与 Steam 服务器端计算存在浮点数精度差异，导致实际产物与预测值之间存在漂移。

### 观察到的案例

#### 案例 1（初次发现）
```
材料均值（预测）: 0.2699999988079071
用户目标: 0.27
验证: PASS (0.2699999988079071 < 0.27)
实际产物: 0.270000010728836060 ❌ 超出目标
漂移: 1.192e-8
```

#### 案例 2（1e-8 边界不足）
```
材料均值（预测）: 0.2699999898672104
调整后目标 (1e-8): 0.2699999900000000
验证: PASS (delta = -1.3e-10)
实际产物: 0.270000010728836060 ❌ 超出用户目标 0.27
漂移: 2.09e-8
```

## 解决方案演进

### 第一次尝试：验证阶段减去边界（失败）

**方法**：在验证时要求 `overall < (target - 1e-8)`

**问题**：
- 选材算法使用原始目标 0.27
- 验证时突然要求 < 0.26999999
- 导致大量合法选材被拒绝，连基本材料都选不出来

**提交**：`da59a25 fix: add safety margin to prevent Steam precision mismatch`

### 第二次尝试：入口调整目标（成功但边界不足）

**方法**：
- below 模式：用户输入 0.27 → 调整为 `0.27 - 1e-8 = 0.26999999`
- above 模式：目标不变
- 选材算法使用调整后的目标
- 验证直接比较 `overall < target`

**优点**：
- 选材算法从一开始就使用更安全的目标
- 验证逻辑简单直接
- 日志透明显示调整过程

**问题**：
- 1e-8 边界不足，观察到 2.09e-8 的漂移

**提交**：`15bc57e fix: apply Steam precision margin at target adjustment, not validation`

### 第三次尝试：增大边界到 3e-8（最终方案）

**方法**：
- 将安全边界从 `1e-8` 增加到 `3e-8`
- below 模式：用户输入 0.27 → 调整为 `0.27 - 3e-8 = 0.26999997`

**验证**：
```
材料均值: 0.2699999898672104
调整后目标 (3e-8): 0.26999997
验证: FAIL ✗ (正确拦截)
实际产物: 0.270000010728836060
观察到的最大漂移: 2.09e-8
新边界覆盖: YES ✓
```

**提交**：`acf2357 fix: increase Steam precision margin from 1e-8 to 3e-8`

## 最终实现

### 代码位置
`node_sidecar/src/services/craftAssistService.js`

### 关键代码
```javascript
// Line ~1918
const STEAM_PRECISION_MARGIN = 3e-8; // 0.00000003 (conservative margin)
const approachMode = normalizeCraftAssistApproachMode(wearApproachMode);
const adjustedTargetValue = approachMode === "below"
  ? targetValue - STEAM_PRECISION_MARGIN
  : targetValue;

if (approachMode === "below") {
  craftAssistLogger.info(
    "craft_assist",
    `below模式：目标调整 ${numberTextTrunc(targetValue, WEAR_INPUT_DECIMALS)} → ${numberTextTrunc(adjustedTargetValue, WEAR_INPUT_DECIMALS)} (margin=${STEAM_PRECISION_MARGIN})`
  );
}
```

### 验证逻辑
```javascript
// Line ~100
// Note: For below mode, targetValue has already been adjusted by
// STEAM_PRECISION_MARGIN in selectCraftAssistForRecipe, so we don't
// need to subtract it again here
const passed = numericOverall < numericTarget;
```

## 影响范围

### 受影响的模式
- ✅ **below 模式**：目标调整 `target - 3e-8`
- ❌ **above 模式**：目标不变（不需要调整）

### 高速选材模式
高速模式通过预过滤（分片+topK）缩小搜索空间，但最终仍调用标准搜索算法 `searchCraftAssistBestSolution`，因此安全边界对高速模式同样生效。

## 相关提交

1. `f313206` - fix: prevent craft assist log deduplication
   - 修复日志去重导致部分配方日志丢失

2. `27c89bc` - fix: show material wear values in craft assist logs
   - 修复材料磨损值未显示的问题

3. `da59a25` - fix: add safety margin to prevent Steam precision mismatch
   - 首次尝试：验证阶段减去边界（失败）

4. `15bc57e` - fix: apply Steam precision margin at target adjustment, not validation
   - 第二次尝试：入口调整目标（成功但边界不足）

5. `acf2357` - fix: increase Steam precision margin from 1e-8 to 3e-8
   - 最终方案：增大边界到 3e-8

## 测试验证

### 测试场景
- 账号：MOON (selenomorphology)
- 目标：列车 0.27
- 配方数量：10 个
- 材料稀有度：2 (久经沙场)

### 验证结果
- ✅ 所有产物磨损值 < 0.27
- ✅ 日志完整显示所有 10 个配方
- ✅ 材料磨损值正确显示
- ✅ 目标调整日志清晰透明

## 经验教训

1. **浮点数精度问题不可忽视**：即使是 1e-8 级别的差异，在实际应用中也可能导致严重后果

2. **安全边界需要基于实际观测**：理论推导的边界可能不足，需要根据生产日志调整

3. **在源头解决问题优于在终点修补**：在入口调整目标比在验证阶段打补丁更清晰、更可靠

4. **日志透明度至关重要**：清晰的日志帮助快速定位问题并验证修复效果

5. **保守估计优于激进优化**：3e-8 的边界虽然比观察到的 2.09e-8 大，但这种保守策略能覆盖未来可能出现的更大漂移

## 未来改进方向

1. **持续监控漂移**：在生产日志中持续监控预测值与实际值的差异，如果发现超过 3e-8 的漂移，需要进一步调整

2. **自适应边界**：考虑根据历史数据动态调整安全边界

3. **精度分析工具**：开发工具分析不同磨损范围、不同稀有度下的漂移特征

---

**记录时间**：2026-04-30 23:15  
**记录者**：Kiro (AI Agent)  
**验证者**：魔尊 (18220)
