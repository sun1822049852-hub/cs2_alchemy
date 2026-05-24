# Craft Assist Entry Window Design

Date: 2026-05-24
Status: Draft for review

## Summary

辅助选材需要给“组合入场”增加一层窗口约束。

这里的“入场”指候选组合能不能进入后续比较，例如参与 `bestBelow` 或同类 scoring。它不是最终成功校验，也不替代最终返回前的合法性判断。

新规则由用户输入的目标磨损 `target` 和现有偏移值 `offset` 组成：

- `below` 模式只允许目标下方窗口入场。
- `infinite` / 逼近模式允许目标上下双向窗口入场。
- 边界值算窗口内，不丢弃。

## Goals

- 限制“低于目标但低太多”的组合进入 `below` 候选比较。
- 限制“低太多 / 高太多”的组合进入 `infinite` 候选比较。
- 保持窗口边界为闭区间，等于边界时不丢弃。
- 只修改入场条件，不修改最终校验。
- 保持现有 UI 参数形态，继续使用已有目标磨损和偏移值。

## Non-Goals

- 不改最终校验规则。
- 不改材料筛选、库存候选池、配方合法性判断。
- 不改 fast prefilter 的候选缩小策略。
- 不改价格、收益、概率或目标皮肤相关逻辑。
- 不新增 UI 字段。
- 不把本规则扩大成全辅助选材重构。

## Current Behavior

在单材料 `below` 的 `balanced_center_push` 逻辑中，当前只要搜索路径走到的组合均值小于目标，就可以入场参与 `bestBelow` 比较。

现有判断接近：

```text
overall < target
```

这能挡住高于目标的组合，但挡不住“低太多”的组合。低太多的组合虽然通常不会赢过更接近目标的结果，但它仍然会进入比较链路，影响 trace 和后续判断语义。

## New Entry Rule

新增一个统一的入场窗口判断。

`overall` 表示辅助选材内部用于比较的组合相对磨损均值。窗口只决定组合是否有资格进入后续比较；窗口通过不代表最终一定成功。

### Below Mode

`below` 模式的入场窗口是：

```text
[target - offset, target]
```

入场条件：

```text
target - offset <= overall <= target
```

丢弃条件：

- `overall < target - offset`：低于窗口下界，丢弃。
- `overall > target`：高于窗口上界，丢弃。

边界规则：

- `overall === target - offset` 可以入场。
- `overall === target` 可以入场。

注意：本 spec 只改入场条件。即使 `overall === target` 能入场，最终是否通过仍由现有最终校验决定；本次不改变最终校验对等于目标的处理。

### Infinite Mode

`infinite` / 逼近模式的入场窗口是：

```text
[target - offset, target + offset]
```

入场条件：

```text
target - offset <= overall <= target + offset
```

丢弃条件：

- `overall < target - offset`：低太多，丢弃。
- `overall > target + offset`：高太多，丢弃。

边界规则：

- `overall === target - offset` 可以入场。
- `overall === target + offset` 可以入场。

## Impact Scope

- `single-material balanced_center_push`：组合更新 `bestBelow` 或同等最佳候选前，需要先过入场窗口。
- scoring / entry predicate：优先抽出一个清晰的入场判断，避免在多处重复写窗口逻辑。
- trace / diagnostics：丢弃原因应能区分 `entry_window_low` 和 `entry_window_high`，方便确认组合为什么没有参与比较。
- tests：增加 focused tests 覆盖闭区间边界、低太多丢弃、高太多丢弃，以及“不改最终校验”。

## Must Not Change

- 最终校验不变。入场窗口不是最终成功判定。
- 材料候选池不变。单个材料是否进入候选，仍按材料名、磨损范围、可炼金、占用 ID 等现有规则判断。
- fast prefilter 不变。
- UI 请求结构不变。
- `target_wear`、`target_wear_raw`、float32 step 相关校验不变。
- 价格、收益、概率不参与这次规则。

## Acceptance Criteria

- `below` 模式下，只有 `overall` 落在 `[target - offset, target]` 内，才允许进入候选比较。
- `below` 模式下，`overall === target - offset` 不丢弃。
- `below` 模式下，`overall === target` 不因入场窗口丢弃。
- `below` 模式下，`overall < target - offset` 走低侧丢弃分支。
- `below` 模式下，`overall > target` 走高侧丢弃分支。
- `infinite` 模式下，只有 `overall` 落在 `[target - offset, target + offset]` 内，才允许进入候选比较。
- `infinite` 模式下，两个边界相等值都不因入场窗口丢弃。
- 入场窗口通过不改变最终校验结果。
- 用户不需要改 UI 操作方式。

## Test Plan

增加表驱动测试覆盖入场窗口：

| mode | target | offset | overall | expected |
| --- | --- | --- | --- | --- |
| below | 0.21 | 0.01 | 0.20 | entry |
| below | 0.21 | 0.01 | 0.21 | entry |
| below | 0.21 | 0.01 | 0.199999 | discard_low |
| below | 0.21 | 0.01 | 0.210001 | discard_high |
| infinite | 0.21 | 0.01 | 0.20 | entry |
| infinite | 0.21 | 0.01 | 0.22 | entry |
| infinite | 0.21 | 0.01 | 0.199999 | discard_low |
| infinite | 0.21 | 0.01 | 0.220001 | discard_high |

补充测试：

- 单材料 `balanced_center_push`：低于目标但低出 offset 的组合不能更新 `bestBelow`。
- 单材料 `balanced_center_push`：等于窗口下界的组合可以参与比较。
- 单材料 `balanced_center_push`：等于目标的组合不被入场窗口丢弃，但最终校验仍按现有规则执行。
- trace 或 debug 结果能区分低侧窗口丢弃和高侧窗口丢弃。

## Risks

- 容易把闭区间写成开区间，导致边界值被误丢弃。
- 容易误把“入场允许等于目标”理解成“最终允许等于目标”。本次不改最终校验。
- 如果 `offset === 0`，窗口会退化成 `[target, target]`。这会让入场条件比旧规则窄很多，需要测试锁定产品预期。
- 如果 `target - offset < 0` 或 `target + offset > 1`，实现应沿用现有 offset / target 范围处理方式；本 spec 不新增 UI 校验语义。

## Open Questions

- 实现时是否需要把窗口判断做成可复用 helper，供 `below` 和 `infinite` 两条路径共同使用。
- 丢弃 trace 是否只记录计数，还是记录最近一次代表性组合。
