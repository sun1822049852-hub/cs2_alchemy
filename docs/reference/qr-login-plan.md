# QR 二维码登录 — 实现计划

> 冻结时间：2026-04-24 | 状态：待实现 | 前置：邮箱验证码二阶段已完成

## 依赖安装

```bash
cd node_sidecar && npm install qrcode
```

## 改动清单（6 文件，按顺序执行）

### 1. authService.js — 新增 QR session 管理（4 个函数）

在现有 `pendingSessions`（邮箱验证码用）之后，新增独立的 `pendingQrSessions` Map。

**新增函数**：
- `startQrLoginSession({logger, timeout})` — 调用 `session.startWithQR()`，监听 `remoteInteraction`/`authenticated`/`timeout`/`error` 四个事件，缓存到 Map，返回 `{qrUrl, sessionKey}`
- `getQrLoginStatus(sessionKey)` — 返回 `{status, accountName, refreshToken, steamId64, error}`
- `consumeQrLogin(sessionKey, {tokenStore})` — 认证成功后取出结果，存 token，清理 session
- `cancelQrLogin(sessionKey)` — 取消并清理

**关键参数**：
- `QR_SESSION_TTL_MS = 3 * 60 * 1000`（3分钟自动清理）
- `session.loginTimeout = 150000`（2.5分钟）
- `EAuthTokenPlatformType.SteamClient`（与现有一致）

**exports 新增**：`startQrLoginSession, getQrLoginStatus, consumeQrLogin, cancelQrLogin`

### 2. uiServer.js — 新增 4 个 API 端点

在 `login-submit-code` 端点之后、`login-save` 端点之前插入。

#### `POST /api/accounts/qr-login-start`
- 调用 `startQrLoginSession({logger})`
- 用 `QRCode.toDataURL(qrUrl, {width: 256, margin: 2})` 生成 data URL
- 返回 `{ok: true, qrImage, qrUrl, sessionKey}`

#### `GET /api/accounts/qr-login-poll?key=xxx`
- SSE 流，每 1.5s 推送 `getQrLoginStatus(key)` 结果
- 终态（authenticated/expired/error/not_found）时关闭流
- `req.on("close")` 清理 interval

#### `POST /api/accounts/qr-login-consume`
- body: `{sessionKey, remark?}`
- 调用 `consumeQrLogin(sessionKey, {tokenStore})`
- 复用 login-save 的账号 upsert + binding check 逻辑
- 返回 `{ok: true, done: true, active, accounts}`

#### `POST /api/accounts/qr-login-cancel`
- body: `{sessionKey}`
- 调用 `cancelQrLogin(sessionKey)`
- 返回 `{ok: true}`

### 3. index.html — 登录模态框增加 tab 切换

在 `accountLoginModal` 的 `.account-login-brand` 之后、`.account-login-body` 开头插入 tab 栏：

```html
<div class="account-login-tabs">
  <button id="loginTabCredential" class="account-login-tab is-active" type="button">账号密码</button>
  <button id="loginTabQr" class="account-login-tab" type="button">扫码登录</button>
</div>
```

在 `.account-login-body` 内部，将现有表单包裹在 `<div id="loginPanelCredential">` 中，新增：

```html
<div id="loginPanelQr" class="hidden">
  <div class="qr-login-container">
    <div id="qrLoginImage" class="qr-login-image">
      <!-- img 或 loading spinner -->
    </div>
    <div id="qrLoginStatus" class="qr-login-status">请使用 Steam 手机客户端扫描二维码</div>
    <button id="qrLoginRefreshBtn" class="hidden" type="button">重新生成</button>
  </div>
</div>
```

### 4. app.js — QR 登录前端逻辑

**新增 state 字段**：
- `state.qrSessionKey` — 当前 QR session key
- `state.qrEventSource` — SSE EventSource 实例

**新增函数**：
- `switchLoginTab(tab)` — 切换 "credential" / "qr"，切换时取消对方的进行中状态
- `startQrLogin()` — 调用 `/api/accounts/qr-login-start`，渲染 QR 图片，开启 SSE 轮询
- `handleQrStatusUpdate(data)` — 处理 SSE 推送：
  - `pending` → "等待扫码..."
  - `scanned` → "已扫码，请在手机上确认"
  - `authenticated` → 调用 consume API → `finishLoginSuccess(accountName)`
  - `expired` → "二维码已过期" + 显示重新生成按钮
  - `error` → 显示错误
- `cancelQrLogin()` — 关闭 SSE + 调用 cancel API + 清理 state
- 模态框关闭时调用 `cancelQrLogin()`

**事件绑定**：
- `loginTabCredential.onclick` → `switchLoginTab("credential")`
- `loginTabQr.onclick` → `switchLoginTab("qr")`
- `qrLoginRefreshBtn.onclick` → `startQrLogin()`
- 切换到 QR tab 时自动调用 `startQrLogin()`

### 5. styles.css — QR 登录样式

```css
/* Tab 栏 */
.account-login-tabs { display: flex; gap: 0; border-bottom: 1px solid rgba(220,164,76,0.18); margin-bottom: 1rem; }
.account-login-tab { flex: 1; padding: 0.6rem; background: none; border: none; border-bottom: 2px solid transparent; color: rgba(255,255,255,0.5); cursor: pointer; font-size: 0.95rem; }
.account-login-tab.is-active { color: #dca44c; border-bottom-color: #dca44c; }
.account-login-tab:hover { color: rgba(255,255,255,0.8); }

/* QR 容器 */
.qr-login-container { display: flex; flex-direction: column; align-items: center; padding: 1.5rem 0; gap: 1rem; }
.qr-login-image { width: 220px; height: 220px; background: #fff; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
.qr-login-image img { width: 100%; height: 100%; border-radius: 8px; }
.qr-login-status { color: rgba(255,255,255,0.7); font-size: 0.9rem; text-align: center; }
.qr-login-status.is-scanned { color: #f3c779; }
.qr-login-status.is-error { color: #e74c3c; }
```

### 6. electron-main.js — 无需改动

QR 登录走 HTTP API，不涉及 Electron 主进程。

## 执行顺序与依赖

```
[1] npm install qrcode
[2] authService.js（无依赖）
[3] uiServer.js（依赖 [2]）
[4] index.html（无依赖）
[5] styles.css（无依赖）
[6] app.js（依赖 [3][4][5]）
```

其中 [2]+[4]+[5] 可并行，[3] 等 [2]，[6] 等 [3][4][5]。

## 验证方案

1. 打开登录模态框 → 看到两个 tab
2. 点"扫码登录" → QR 码生成并显示
3. 用 Steam 手机客户端扫码 → 状态变为"已扫码，请确认"
4. 手机确认 → 自动登录成功，账号入库
5. 不扫码等 2.5 分钟 → 显示"已过期" + 重新生成按钮
6. 关闭模态框 → QR session 被取消
7. 原有账号密码+TOTP 登录不受影响
8. 邮箱验证码二阶段登录不受影响

## 回切第一刀

下次会话开始时：
1. 读此文件确认计划
2. `cd node_sidecar && npm install qrcode`
3. 按顺序改 authService → uiServer → index.html + styles.css → app.js
4. 可用 TeamCreate 拉 2-3 个 agent 并行（后端一路、前端一路）
