# Account Page Style Alignment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改账号页结构与交互流的前提下，把当前账号页视觉语言迁移到已批准的深炭黑 + 琥珀金风格，并用页面作用域测试锁住不外溢边界。

**Architecture:** 保留 `body.theme-inkblue` 作为全局主题入口，不动 `node_sidecar/ui/app.js` 与账号页 DOM 骨架。把账号页专属 token 和控件覆写全部收束到 `#accountPage` 作用域内，同时把全局主题测试缩回“非账号页共享契约”，再新增一个账号页局部静态样式测试专门验证 amber accent、focus、disabled 与 scoped selector。

**Tech Stack:** 静态 HTML、plain CSS、Node.js CommonJS 测试脚本、`node:assert/strict`

---

> Repo instruction note: do not add git commit steps unless the user explicitly asks. This plan intentionally omits commit tasks.

## File Map

- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/styles.css`
  - 在现有 `theme-inkblue` 主题上新增 `#accountPage` 作用域 token 与账号页 panel / form / button / card 覆写。
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/inkBlueDarkTheme.test.js`
  - 把测试边界收缩为“全局共享 ink blue 主题契约”，不再要求账号页继续沿用蓝色账号卡片语义。
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/accountPageStyleScope.test.js`
  - 静态断言账号页局部 token、作用域选择器、primary amber button、focus outline、disabled token 与 selected amber state。
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/index.html`
  - 账号页作用域根节点 `#accountPage` 与现有 DOM 钩子，不预计修改。
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/account-card-render.test.js`
  - 账号卡渲染逻辑不应回归。
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/docs/superpowers/specs/2026-03-24-account-page-style-alignment-design.md`
  - 已批准设计与验收标准。

## Chunk 1: Lock The Page Boundary First

### Task 1: Narrow the global theme test to shared, non-account-page contracts

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/tests/inkBlueDarkTheme.test.js`
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/styles.css:3638-3908`

- [ ] **Step 1: Remove account-page-only fragments from `inkBlueDarkTheme.test.js` so it no longer blocks the scoped account-page redesign**

Keep shared fragments such as:

```js
const cssFragments = [
  "body.theme-inkblue {",
  "--bg: #06101d;",
  "--panel: #0d1726;",
  "body.theme-inkblue .sidebar {",
  "body.theme-inkblue .nav-btn {",
  "body.theme-inkblue .panel,",
  "body.theme-inkblue input,",
  "body.theme-inkblue .group-table th,",
  "body.theme-inkblue .card,",
  "body.theme-inkblue .craft-assist-panel,",
  "body.theme-inkblue .modal-card,"
];
```

Do not keep account-page-specific expectations like `body.theme-inkblue .account-card,` or account-page status color fragments in this file.

- [ ] **Step 2: Re-run the global theme test before any CSS edit**

Run: `node "./tests/inkBlueDarkTheme.test.js"`

Expected: PASS, proving the narrowed contract still matches the current global theme.

### Task 2: Add a failing account-page-only style scope test

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/tests/accountPageStyleScope.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/accountPageStyleScope.test.js`

- [ ] **Step 1: Write a Node test that reads `styles.css` and asserts the future account-page scope hooks**

Use a static string test in the same style as existing CSS guard tests:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");
const css = fs.readFileSync(cssPath, "utf8");

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

for (const fragment of requiredFragments) {
  assert.equal(css.includes(fragment), true, `missing account-page style fragment: ${fragment}`);
}

console.log("accountPageStyleScope tests passed");
```

- [ ] **Step 2: Run the new test and verify it fails before production CSS changes**

Run: `node "./tests/accountPageStyleScope.test.js"`

Expected: FAIL because the scoped account-page token block and amber control fragments do not exist yet.

## Chunk 2: Add Scoped Account Page Tokens And Surfaces

### Task 3: Introduce page-scoped account tokens under `#accountPage`

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/styles.css:3638-3908`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/accountPageStyleScope.test.js`

- [ ] **Step 1: Add a `body.theme-inkblue #accountPage` token block with the approved concrete values**

Start with a dedicated scoped block near the existing `theme-inkblue` overrides:

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
  --account-placeholder-text: #9aa3af;
  --account-disabled-text: #96a0ae;
  --account-disabled-surface: rgba(255, 255, 255, 0.035);
  --account-disabled-border: rgba(243, 199, 121, 0.08);
  --account-disabled-chrome-opacity: 0.72;
}
```

- [ ] **Step 2: Apply the scoped background and surface language to the account page containers**

Add page-scoped overrides for:

```css
body.theme-inkblue #accountPage {
  background: var(--account-page-bg);
}

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

Keep all selectors inside `#accountPage`; do not move these tokens to `:root` or `body`.

- [ ] **Step 3: Update account-page headings and helper text to the new warm text hierarchy**

Add scoped rules for `.account-form-panel h2`, `.account-list-panel h2`, `.status-title`, `.status-text`, `.tips`, and `.empty` under `#accountPage` so the page no longer inherits the cold blue emphasis.

## Chunk 3: Restyle Inputs, Buttons, Cards, And Edge States

### Task 4: Apply account-page-only input, focus, and button rules

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/styles.css:1027-1075,3747-3787`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/accountPageStyleScope.test.js`

- [ ] **Step 1: Add scoped input rules for dark surfaces, placeholder color, and visible keyboard focus**

Implement the approved accessible focus geometry:

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

- [ ] **Step 2: Split primary and secondary account-page buttons without changing their sizing logic**

Give `#loginSaveBtn` the amber filled treatment and keep `#clearAccountBtn` as the ghost secondary:

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

- [ ] **Step 3: Add disabled-state rules that do not rely on whole-control opacity**

Use dedicated disabled tokens instead of applying `opacity` to full controls:

```css
body.theme-inkblue #accountPage :is(input, button):disabled {
  background: var(--account-disabled-surface);
  border-color: var(--account-disabled-border);
  color: var(--account-disabled-text);
  opacity: 1;
}
```

If any icon-only affordance exists inside a disabled control, fade only the icon chrome with `--account-disabled-chrome-opacity`.

### Task 5: Restyle saved-account cards, selected state, and empty state

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/styles.css:1077-1195,3836-3872`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/accountPageStyleScope.test.js`
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/account-card-render.test.js`

- [ ] **Step 1: Move the saved-account cards to the deep-charcoal surface without changing layout or content structure**

Update `.account-card`, `.account-card-avatar`, `.account-card-title`, and `.account-card-sub` under `#accountPage` only.

- [ ] **Step 2: Convert selected and connected card states to the approved amber + local status treatment**

Use scoped state hooks like:

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

Do not keep the old whole-card green success wash.

- [ ] **Step 3: Add a scoped empty-state rule for `#savedAccountsWrap` / `.saved-accounts .empty`**

Make sure the empty state stays readable on dark surfaces and does not fall back to the old light card styling.

## Chunk 4: Verification Sweep

### Task 6: Run the focused regression gates

**Files:**
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/accountPageStyleScope.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/inkBlueDarkTheme.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/account-card-render.test.js`
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/styles.css`

- [ ] **Step 1: Re-run the new account-page scope test**

Run: `node "./tests/accountPageStyleScope.test.js"`

Expected: `accountPageStyleScope tests passed`

- [ ] **Step 2: Re-run the narrowed global theme contract**

Run: `node "./tests/inkBlueDarkTheme.test.js"`

Expected: `inkBlueDarkTheme tests passed`

- [ ] **Step 3: Re-run the account-card rendering guard**

Run: `node "./node_sidecar/tests/account-card-render.test.js"`

Expected: `account-card-render tests passed`

- [ ] **Step 4: Do a final selector-boundary grep to confirm the new account-page styling is scoped**

Run: `rg -n "body\\.theme-inkblue #accountPage|body\\.theme-inkblue \\.account-card|body\\.theme-inkblue \\.tips|body\\.theme-inkblue \\.status-box" "./node_sidecar/ui/styles.css"`

Expected:
- matches for `body.theme-inkblue #accountPage ...`
- no leftover global account-page-only overrides that would leak beyond `#accountPage`

Plan complete and saved to `docs/superpowers/plans/2026-03-24-account-page-style-alignment.md`. Ready to execute?
