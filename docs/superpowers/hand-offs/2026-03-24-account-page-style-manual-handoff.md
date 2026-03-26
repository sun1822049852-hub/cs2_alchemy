# 账号页样式手工修改交接单

> 日期：2026-03-24
> 范围：仅账号页
> 目标：保留当前账号页结构与交互，只把视觉风格中度迁移到目标项目的深炭黑 + 琥珀金体系
> 说明：此文档用于魔尊手工修改，吾不再继续自动实现

## 一句话结论

只改 `账号页` 的视觉皮肤，不改 `app.js` 逻辑，不改 `index.html` 结构，不处理“设备连续性”问题。

## 不处理项

- 不处理“设备连续性”相关问题
- 不处理库存页样式
- 不处理炼金页样式
- 不处理账号页 DOM 结构重排
- 不处理登录逻辑、保存逻辑、账号卡数据结构

## 建议改动文件

### 必改

- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/styles.css`
- `C:/Users/18220/Desktop/cs2_alchemy/tests/inkBlueDarkTheme.test.js`

### 新增

- `C:/Users/18220/Desktop/cs2_alchemy/tests/accountPageStyleScope.test.js`

### 只读参考

- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/index.html`
- `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/account-card-render.test.js`
- `C:/Users/18220/Desktop/cs2_alchemy/docs/superpowers/specs/2026-03-24-account-page-style-alignment-design.md`
- `C:/Users/18220/Desktop/cs2_alchemy/docs/superpowers/plans/2026-03-24-account-page-style-alignment.md`

## 必须守住的边界

- 所有新样式都必须限制在 `body.theme-inkblue #accountPage` 下面
- 不要把新 token 写到 `:root`
- 不要把账号页的新颜色直接覆盖到全局 `.panel`、`input`、`button`、`.account-card`
- 不要删除或改名这些现有钩子：
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

## 先改测试，再改样式

### 1. 缩小全局主题测试边界

文件：`tests/inkBlueDarkTheme.test.js`

当前问题：

- 这个测试把账号页也当成全局蓝色主题的一部分
- 但这次需求是账号页单独换成琥珀系，其他页面继续蓝色

处理方式：

- 保留这些全局断言：
  - `body.theme-inkblue {`
  - `--bg: #06101d;`
  - `--panel: #0d1726;`
  - `body.theme-inkblue .sidebar {`
  - `body.theme-inkblue .nav-btn {`
  - `body.theme-inkblue .panel,`
  - `body.theme-inkblue input,`
  - `body.theme-inkblue .group-table th,`
  - `body.theme-inkblue .card,`
  - `body.theme-inkblue .craft-assist-panel,`
  - `body.theme-inkblue .modal-card,`

- 删除或移出这些账号页专属断言：
  - `body.theme-inkblue .account-card,`
  - 账号页 connected / disconnected status 的蓝色主题断言

目的：

- 让这个测试只验证“非账号页仍是 ink blue 全局主题”

### 2. 新增账号页局部样式测试

文件：`tests/accountPageStyleScope.test.js`

最低应断言这些片段存在：

```js
const requiredFragments = [
  "body.theme-inkblue #accountPage {",
  "--account-page-bg:",
  "--account-accent-foreground:",
  "--account-focus-outline:",
  "--account-disabled-text:",
  "body.theme-inkblue #accountPage .account-form-panel,",
  "body.theme-inkblue #accountPage #loginSaveBtn {",
  "body.theme-inkblue #accountPage #clearAccountBtn {",
  "body.theme-inkblue #accountPage .account-card.selected {",
  "body.theme-inkblue #accountPage :is(input, button):focus-visible {"
];
```

这个测试的意义：

- 锁住账号页 scoped token
- 锁住琥珀主按钮
- 锁住 focus 可见性
- 锁住 selected 琥珀状态
- 防止你后面把样式又写回全局

## 样式主改法

### 1. 在 `styles.css` 末尾现有 `body.theme-inkblue` 覆写区附近，加账号页专属 token

建议直接新增：

```css
body.theme-inkblue #accountPage {
  --account-page-bg: linear-gradient(180deg, #16181c 0%, #0f1114 100%);
  --account-surface-main: linear-gradient(180deg, rgba(24, 28, 34, 0.94), rgba(16, 19, 24, 0.96));
  --account-surface-subtle: linear-gradient(180deg, rgba(31, 36, 43, 0.88), rgba(22, 26, 32, 0.92));
  --account-text-main: #f7f3e8;
  --account-text-soft: #b9c0cb;
  --account-text-dim: #8892a1;
  --account-accent: #dca44c;
  --account-accent-strong: #f3c779;
  --account-accent-foreground: #19140b;
  --account-border-soft: rgba(243, 199, 121, 0.14);
  --account-border-strong: rgba(220, 164, 76, 0.36);
  --account-shadow-panel: 0 20px 48px rgba(0, 0, 0, 0.34);
  --account-shadow-hover: 0 12px 28px rgba(0, 0, 0, 0.24);
  --account-focus-outline: 2px solid #f3c779;
  --account-focus-outline-offset: 2px;
  --account-focus-halo: 0 0 0 4px rgba(243, 199, 121, 0.22);
  --account-selected-halo: 0 0 0 2px rgba(220, 164, 76, 0.22);
  --account-success-text: #80d6a4;
  --account-success-tint: rgba(128, 214, 164, 0.12);
  --account-danger-text: #ff8a8a;
  --account-danger-tint: rgba(255, 138, 138, 0.12);
  --account-placeholder-text: #9aa3af;
  --account-disabled-text: #96a0ae;
  --account-disabled-surface: rgba(255, 255, 255, 0.035);
  --account-disabled-border: rgba(243, 199, 121, 0.08);
  --account-disabled-chrome-opacity: 0.72;
}
```

### 2. 给账号页主区域换背景

只在 `#accountPage` 下做：

```css
body.theme-inkblue #accountPage {
  background: var(--account-page-bg);
}
```

### 3. 重做账号页 panel 语法

目标对象：

- `.account-form-panel`
- `.account-list-panel`
- `.tips`
- `.status-box`

建议规则：

```css
body.theme-inkblue #accountPage .account-form-panel,
body.theme-inkblue #accountPage .account-list-panel,
body.theme-inkblue #accountPage .tips,
body.theme-inkblue #accountPage .status-box {
  background: var(--account-surface-main);
  border-color: var(--account-border-soft);
  color: var(--account-text-main);
  box-shadow: var(--account-shadow-panel);
}
```

补充：

- `h2` 改暖白
- `.status-title` 改次级说明色
- `.status-text` 改为主文本体系
- `tips` 不要再保留浅色提示盒气质

### 4. 重做输入框与 focus

目标对象：

- `.form-row input`
- `:focus-visible`
- placeholder

建议规则：

```css
body.theme-inkblue #accountPage .form-row input {
  background: rgba(10, 12, 16, 0.52);
  border-color: var(--account-border-soft);
  color: var(--account-text-main);
}

body.theme-inkblue #accountPage .form-row input::placeholder {
  color: var(--account-placeholder-text);
}

body.theme-inkblue #accountPage :is(input, button):focus-visible {
  outline: var(--account-focus-outline);
  outline-offset: var(--account-focus-outline-offset);
  box-shadow: var(--account-focus-halo);
}
```

硬要求：

- 不要继续用蓝色 focus
- focus 不能只靠轻微色差
- 必须有 outline + offset

### 5. 区分主按钮和次按钮

目标对象：

- `#loginSaveBtn`
- `#clearAccountBtn`
- `.account-card-actions button`

建议规则：

```css
body.theme-inkblue #accountPage #loginSaveBtn {
  background: linear-gradient(135deg, #e7ba67, #d49438);
  border-color: rgba(220, 164, 76, 0.45);
  color: var(--account-accent-foreground);
}

body.theme-inkblue #accountPage #clearAccountBtn,
body.theme-inkblue #accountPage .account-card-actions button {
  background: rgba(255, 255, 255, 0.03);
  border-color: var(--account-border-soft);
  color: var(--account-text-main);
}
```

注意：

- 主按钮文字必须用 `#19140b`
- 不然对比度不够
- hover 只做轻微提亮和边框增强

### 6. disabled 不要整控件降透明

这是前面审查里反复卡住的点。

禁止：

- `button:disabled { opacity: 0.56; }`
- `input:disabled { opacity: 0.56; }`

应该改成：

```css
body.theme-inkblue #accountPage :is(input, button):disabled {
  background: var(--account-disabled-surface);
  border-color: var(--account-disabled-border);
  color: var(--account-disabled-text);
  opacity: 1;
}
```

只有图标、边框、非关键装饰，才允许单独降透明。

### 7. 重做账号卡片

目标对象：

- `.account-card`
- `.account-card-avatar`
- `.account-card-title`
- `.account-card-sub`
- `.account-card.selected`
- `.account-card.connected`
- `.account-card-state`

处理原则：

- 卡片整体从浅底改成深炭面
- 标题用暖白
- 副文案用灰蓝
- 头像底去掉浅蓝渐变
- `selected` 改成琥珀边 + halo
- `connected` 不要整卡泛绿
- success 只留在 pill 或局部状态

建议关键规则：

```css
body.theme-inkblue #accountPage .account-card.selected {
  border-color: var(--account-border-strong);
  box-shadow: var(--account-selected-halo), var(--account-shadow-hover);
}

body.theme-inkblue #accountPage .account-card.connected {
  background: var(--account-surface-main);
}

body.theme-inkblue #accountPage .account-card-state.status-connected {
  color: var(--account-success-text);
  background: var(--account-success-tint);
}
```

### 8. 空态和长文本别漏

至少检查：

- 没有账号时 `.saved-accounts` 的空态文案
- 很长的账号名是否仍 ellipsis
- 很长的状态文案是否会换行
- 没头像时 fallback 字母是否仍可读

## 手工验证命令

### 样式作用域测试

```powershell
node "./tests/accountPageStyleScope.test.js"
```

预期：

- `accountPageStyleScope tests passed`

### 全局蓝色主题测试

```powershell
node "./tests/inkBlueDarkTheme.test.js"
```

预期：

- `inkBlueDarkTheme tests passed`

### 账号卡渲染测试

```powershell
node "./node_sidecar/tests/account-card-render.test.js"
```

预期：

- `account-card-render tests passed`

### 手工 grep 检查是否外溢

```powershell
rg -n "body\\.theme-inkblue #accountPage|body\\.theme-inkblue \\.account-card|body\\.theme-inkblue \\.tips|body\\.theme-inkblue \\.status-box" "./node_sidecar/ui/styles.css"
```

你要看到：

- 有很多 `body.theme-inkblue #accountPage ...`
- 但不应该再出现账号页专属样式挂在全局 `body.theme-inkblue .account-card` 之类的写法

## 最终验收标准

- 账号页结构没变
- 登录/清空/保存逻辑没动
- 账号页从冷蓝工具感切到深炭黑 + 琥珀金
- 主按钮变琥珀实体按钮，文字可读
- 输入框 focus 清晰可见，不再是蓝色
- disabled 文本可读，不靠整控件 opacity
- selected 卡片是琥珀语义，不再是蓝色
- connected 状态不再整卡泛绿
- 库存页和炼金页还保持原蓝色主题
- “设备连续性”问题完全忽略，不纳入本轮

## 魔尊可直接照着改的顺序

1. 先改 `tests/inkBlueDarkTheme.test.js`
2. 再新增 `tests/accountPageStyleScope.test.js`
3. 再改 `node_sidecar/ui/styles.css`
4. 跑 3 个 Node 测试
5. 最后手看账号页视觉
