# 账号页 UI 风格中度迁移设计

> 状态：已确认
> 日期：2026-03-24
> 范围：仅 `账号页`
> 迁移级别：中度迁移 / Token 轻迁

## 目标

在不改变当前账号页结构、交互顺序、业务逻辑与信息密度的前提下，使当前项目账号页的视觉语言向目标项目靠拢。

本次只迁移以下内容：

- 配色
- 文本层级
- 圆角
- 边框
- 阴影
- 按钮语气
- 输入框与 focus 反馈
- 提示区、状态区、账号卡片的视觉语法

本次明确不做以下事项：

- 不重做页面骨架
- 不重排左右分栏
- 不修改表单字段顺序
- 不改变账号卡片信息结构
- 不扩散到库存页、炼金页
- 不新增业务功能

## 参考来源

### 当前项目

- `node_sidecar/ui/index.html`
- `node_sidecar/ui/styles.css`
- `node_sidecar/ui/app.js`

账号页现有结构：

- 左侧 `account-form-panel`
- 右侧 `account-list-panel`
- 表单区包含 `form-row`、`account-actions`、`tips`、`status-box`
- 右侧列表区包含 `saved-accounts` 与 `account-card`

### 目标项目

- `C:/Users/18220/Desktop/C5autobug更新接口 - 副本 (2)/app_desktop_web/src/styles/app.css`
- `C:/Users/18220/Desktop/C5autobug更新接口 - 副本 (2)/app_desktop_web/src/features/account-center/account_center_page.jsx`

目标项目最值得借鉴的视觉特征：

- 深炭黑渐变背景
- 暖白文字层级
- 琥珀金 accent
- 大圆角但克制的 panel 体系
- 深色面板上的细描边与厚阴影
- 按钮、badge、状态条语气统一
- hover/focus 反馈克制，不做重动画

## 约束

### 功能约束

- 保持现有账号页 DOM 结构与交互流程可用
- 保留所有现有 `id`、主要 class 与事件绑定点
- 不影响账号登录、保存、清空、状态展示、列表操作等功能

### 风格约束

- 不直接照搬目标项目 24px 超厚圆角壳体
- 不把当前紧凑桌面工具页改成大留白运营面板
- 不保留账号页中的冷蓝高亮作为主 accent

### 变更边界

- 优先通过账号页局部样式与可复用 token 完成视觉迁移
- 避免把库存页、炼金页一并改色
- 若存在通用按钮/输入框样式调整，必须确认只影响账号页需要的外观

### 作用域护栏

- 允许的作用域根节点仅限 `#accountPage` 及其后代
- 如实现需要新增命名空间钩子，只允许在 `#accountPage` 上新增一个 page-level class 或 `data-*` 属性
- 禁止重命名或删除以下现有选择器：
  - `#accountPage`
  - `.account-grid`
  - `.account-form-panel`
  - `.account-list-panel`
  - `.form-row`
  - `.account-actions`
  - `.tips`
  - `.status-box`
  - `.status-title`
  - `.status-text`
  - `#accountStatus`
  - `#savedAccountsWrap`
  - `.saved-accounts`
  - `.account-card`
  - `.account-card-avatar`
  - `.account-card-title`
  - `.account-card-sub`
  - `.account-card-state`
  - `.account-card-actions`
  - `#loginSaveBtn`
  - `#clearAccountBtn`
- 禁止直接重写全局 `input`、`button`、`.panel`、`.status-text` 来完成账号页换皮，除非选择器被明确限制在 `#accountPage` 内
- 新增 CSS custom properties 可以存在，但必须挂在 `#accountPage` 或新增的账号页命名空间钩子下，不能挂到 `:root` 或 `body` 级别污染其他页面

## 设计原则

1. 第一眼更像目标项目
2. 第二眼仍然是当前项目的紧凑桌面工具
3. 改皮不改骨
4. 一页内所有控件必须说同一种视觉语言
5. 所有 hover、focus、selected、success、danger 状态统一收敛

## 视觉 Token 映射

### 背景与表面

账号页整体视觉从当前冷蓝暗底，迁移到更克制的深炭黑体系：

- 页面主背景：`linear-gradient(180deg, #16181c 0%, #0f1114 100%)`
- 主面板背景：`linear-gradient(180deg, rgba(24, 28, 34, 0.94), rgba(16, 19, 24, 0.96))`
- 次级面板背景：`linear-gradient(180deg, rgba(31, 36, 43, 0.88), rgba(22, 26, 32, 0.92))`

### 文本

- 主标题 / 主文案：`#f7f3e8`
- 次级说明：`#b9c0cb`
- 弱提示：`#8892a1`
- 不再使用偏荧光的冷白作为主要正文色

### Accent 与语义色

- 主 accent：`#dca44c`
- 强调 accent：`#f3c779`
- accent 前景文字：`#19140b`
- success 文本：`#80d6a4`
- success 染色：`rgba(128, 214, 164, 0.12)`
- danger 文本：`#ff8a8a`
- danger 染色：`rgba(255, 138, 138, 0.12)`

### 圆角与阴影

- 主 panel：`18px`
- 卡片：`16px`
- 按钮 / 输入框：`12px`
- 主描边：`rgba(243, 199, 121, 0.14)`
- 强描边：`rgba(220, 164, 76, 0.36)`
- 主阴影：`0 20px 48px rgba(0, 0, 0, 0.34)`
- 悬浮轻阴影：`0 12px 28px rgba(0, 0, 0, 0.24)`
- focus outline：`2px solid #f3c779`
- focus outline offset：`2px`
- focus halo：`0 0 0 4px rgba(243, 199, 121, 0.22)`
- selected halo：`0 0 0 2px rgba(220, 164, 76, 0.22)`
- placeholder 前景：`#9aa3af`
- disabled 前景：`#96a0ae`
- disabled 表面：`rgba(255, 255, 255, 0.035)`
- disabled 边框：`rgba(243, 199, 121, 0.08)`
- disabled chrome opacity：`0.72`，仅允许用于图标、边框或非关键信息装饰，不允许整块文本或整控件直接继承降透明度

### Token 表

| Token | 值 | 用途 |
|------|----|------|
| `--account-page-bg` | `linear-gradient(180deg, #16181c 0%, #0f1114 100%)` | 账号页背景 |
| `--account-surface-main` | `linear-gradient(180deg, rgba(24, 28, 34, 0.94), rgba(16, 19, 24, 0.96))` | 主 panel / 主卡片 |
| `--account-surface-subtle` | `linear-gradient(180deg, rgba(31, 36, 43, 0.88), rgba(22, 26, 32, 0.92))` | `tips` / `status-box` / 次级层 |
| `--account-text-main` | `#f7f3e8` | 主文案 |
| `--account-text-soft` | `#b9c0cb` | 次级说明 |
| `--account-text-dim` | `#8892a1` | 弱提示 / placeholder |
| `--account-accent` | `#dca44c` | 主 accent |
| `--account-accent-strong` | `#f3c779` | 强调 / hover / focus |
| `--account-accent-foreground` | `#19140b` | 琥珀按钮上的文字 / icon |
| `--account-border-soft` | `rgba(243, 199, 121, 0.14)` | 默认边框 |
| `--account-border-strong` | `rgba(220, 164, 76, 0.36)` | active / selected / strong hover |
| `--account-shadow-panel` | `0 20px 48px rgba(0, 0, 0, 0.34)` | 主面板阴影 |
| `--account-shadow-hover` | `0 12px 28px rgba(0, 0, 0, 0.24)` | hover 阴影 |
| `--account-focus-outline` | `2px solid #f3c779` | 键盘 focus 主轮廓 |
| `--account-focus-outline-offset` | `2px` | focus 轮廓偏移 |
| `--account-focus-halo` | `0 0 0 4px rgba(243, 199, 121, 0.22)` | focus 外层 halo |
| `--account-selected-halo` | `0 0 0 2px rgba(220, 164, 76, 0.22)` | 已选卡片 |
| `--account-success-text` | `#80d6a4` | 成功状态文本 |
| `--account-success-tint` | `rgba(128, 214, 164, 0.12)` | 成功 pill 染色 |
| `--account-danger-text` | `#ff8a8a` | 错误/危险文本 |
| `--account-danger-tint` | `rgba(255, 138, 138, 0.12)` | 错误/危险染色 |
| `--account-placeholder-text` | `#9aa3af` | placeholder / 低强调可读文本 |
| `--account-disabled-text` | `#96a0ae` | disabled 文本 |
| `--account-disabled-surface` | `rgba(255, 255, 255, 0.035)` | disabled 控件表面 |
| `--account-disabled-border` | `rgba(243, 199, 121, 0.08)` | disabled 边框 |
| `--account-disabled-chrome-opacity` | `0.72` | disabled 图标 / 边框 / 非关键装饰 |

## 账号页组件设计

### 1. 主 Panel

保留当前双栏 `account-grid` 布局，但把左右两块 panel 调整为同一套深炭面板语法。

适用对象：

- `account-form-panel`
- `account-list-panel`

具体规则：

- 背景为深色渐变 panel
- 标题 `h2` 改为暖白，保留原有层级
- 描边改为暖灰偏金细边
- 阴影改为柔和厚阴影
- 圆角提升，但不使用目标项目 24px 的厚壳体观感

### 2. 表单输入区

适用对象：

- `form-row`
- `form-row input`
- 各输入框 placeholder
- `label`

具体规则：

- 不改变输入框数量、顺序、尺寸逻辑
- 输入框从亮底切换为深色内嵌面
- 边框改为柔和暖灰
- focus 使用 `2px` 琥珀轮廓 + `2px` 外偏移 + 外层 halo，不依赖微弱色差
- placeholder 使用 `--account-placeholder-text`
- label 保持清晰易读，不做装饰化处理

### 3. 按钮体系

适用对象：

- `#loginSaveBtn`
- `#clearAccountBtn`
- `.account-card-actions button`

具体规则：

- `#loginSaveBtn` 为 primary action，改为琥珀金实体按钮，按钮文字与图标固定使用 `--account-accent-foreground`
- `#clearAccountBtn` 为 secondary/ghost，走深色底 + 细描边
- 卡片内按钮不改尺寸体系，只统一语气
- hover 仅做轻微提亮、描边增强、`translateY(-1px)`
- active 仅做轻微回落
- 不使用强烈发光或重动画

### 4. 提示区与状态区

适用对象：

- `tips`
- `status-box`
- `status-title`
- `status-text`

具体规则：

- `tips` 从浅底虚线提示盒改为更内敛的深色辅助 panel
- 若保留虚线，应改为淡金或暖灰虚线
- `status-box` 与主 panel 同族，不另起亮底样式
- 状态成功/失败主要通过文字、pill 或小标记表达，而不是整块高饱和底色

### 5. 已保存账号卡片

适用对象：

- `saved-accounts`
- `account-card`
- `account-card-avatar`
- `account-card-title`
- `account-card-sub`
- `account-card-state`
- `account-card-actions`

具体规则：

- `account-card` 从浅底卡改为深炭底卡
- hover 仅做轻微提亮和边框增强
- `selected` 改为淡琥珀描边与轻 halo
- `connected` 不再整卡泛绿，只在状态 pill 或局部信息中使用 success 色
- 头像容器改为中性深色底，不保留浅蓝块
- 标题为暖白，副标题为灰蓝
- 操作按钮继续保持小尺寸高频操作感

## 状态与交互规则

### Hover

- 所有 hover 保持克制
- panel/card/button 仅做轻微提亮、边框增强、`translateY(-1px)`

### Focus

- 账号页输入框与按钮 focus 统一为琥珀金语义
- 不再出现蓝色 focus ring
- focus 必须同时包含“高对比轮廓 + 外偏移”两种非布局性提示
- focus 轮廓与其紧邻背景的对比度不得低于 `3:1`

### Selected

- 已选中账号卡片使用琥珀金体系表现
- 避免蓝色描边继续留存

### Success / Danger

- success 仅在状态 badge、文本、局部提示中使用
- danger 仅在危险动作与错误提示中使用
- 禁止整卡或整区块大面积高饱和 success / danger 底色

### Disabled

- disabled 按钮和输入框降低对比度与可点击暗示
- 不使用明亮 accent
- disabled 文本使用 `--account-disabled-text`，不得直接依赖整块 opacity 衰减来处理文案
- disabled 控件表面使用 `--account-disabled-surface`，边框使用 `--account-disabled-border`
- 禁止对包含文本的整颗 button、整条 input 或整块状态区直接设置 `opacity < 1`
- disabled 图标、边框、非关键装饰允许使用 `--account-disabled-chrome-opacity`

### 边缘态

- `saved-accounts` 为空时，空态文案必须仍使用深色 panel 语法，不允许回退成浅底占位块
- 长账号名保持现有 ellipsis 行为，不允许撑破卡片布局
- 长状态文本与错误文本必须在 `status-box` 内换行显示，不允许溢出或裁切
- 缺失头像时，fallback 仍需保持可读，不允许出现浅蓝底回潮
- 登录中、保存中、禁用中等中间态保持深色体系，只通过 disabled/状态文字区分，不新增高饱和块状背景

## 响应式与兼容性

- 保持现有账号页响应式行为
- 不改变当前移动/窄宽下的字段折叠逻辑
- 不影响现有 ellipsis、卡片按钮换行、表单宽度收缩

## 可用性与可访问性要求

- 主文案、按钮文案、输入文本在深色背景上的对比度不得低于 `4.5:1`
- 大号标题或大数字类文本对比度不得低于 `3:1`
- 次级说明文字、placeholder、disabled 文本对比度不得低于 `4:1`
- 所有账号页输入框、主次按钮、卡片内按钮必须在键盘导航下显示清晰 focus，focus 不得仅靠颜色微差
- `status-box`、`tips`、空态文案在窄宽下仍需完整可读，不允许因为换皮导致裁切、重叠或对比不足

## 测试与回归要求

本次虽为视觉迁移，仍需保证以下边界稳定：

- 账号页 DOM 主结构不改
- 现有 `id` 与交互入口不改
- 账号卡片渲染、状态展示与按钮操作不回归
- 若测试显式断言旧的 `theme-inkblue` 蓝色语义，只允许把“账号页相关断言”迁移为账号页新风格预期
- 库存页、炼金页的全局蓝色主题契约默认不动

重点关注：

- `node_sidecar/tests/account-card-render.test.js`
- `tests/inkBlueDarkTheme.test.js`
- 与账号页按钮或卡片结构相关的 UI 测试

测试边界说明：

- 若 `tests/inkBlueDarkTheme.test.js` 只验证全局蓝色主题存在，则不应把账号页换皮需求硬塞进该测试
- 若该测试混合了账号页与非账号页视觉断言，应拆分或重定向成“账号页专属断言 + 非账号页全局主题断言”
- 本轮优先新增或调整账号页局部视觉断言，而不是重写其他页面的主题测试

最小可视回归面：

- `#accountPage` 内 token 已作用，且未外溢到库存页、炼金页
- 琥珀 selected 态已替代账号页蓝色 selected 态
- 输入框与主次按钮存在清晰键盘 focus
- 非账号页仍保留原全局蓝色主题契约

## 验收标准

满足以下条件才视为设计达成：

1. 账号页保留原有布局、信息结构、交互流程
2. 账号页不再以冷蓝为主 accent
3. 主背景、panel、按钮、输入框、状态区、账号卡片统一进入深炭黑 + 琥珀金语气
4. 账号卡片 `selected` 从蓝色语义切换为琥珀金语义
5. `connected` 状态不再整卡泛绿
6. 输入框 focus 从蓝色切换为琥珀金
7. primary 琥珀按钮文字与 icon 在按钮背景上的对比度达到 `4.5:1`
8. focus 指示器以轮廓 + 外偏移形式清晰可见，且对比度达到 `3:1`
9. placeholder 与 disabled 文本对比度达到 `4:1`
10. 视觉上明显向目标项目靠拢，但仍保留当前页的紧凑桌面工具感

## 非目标

- 不在本轮统一库存页与炼金页
- 不重构 `app.js` 账号页渲染逻辑
- 不引入新的设计依赖
- 不实现新的导航壳或 hero 区块
- 不把账号页改成目标项目的完整 shell 结构
