# Steam QR 二维码登录 — 技术方案

> 基于 `steam-session@1.9.4`，项目 CS2 Alchemy

## 一、steam-session QR API 清单

### 核心方法

```js
const {LoginSession, EAuthTokenPlatformType} = require("steam-session");

// 创建 session（用 SteamClient 平台类型，与现有 authService 一致）
const session = new LoginSession(EAuthTokenPlatformType.SteamClient);
session.loginTimeout = 120000; // 2 分钟超时（默认 30s 太短）

// 发起 QR 登录
const result = await session.startWithQR();
// result.qrChallengeUrl — 编码到二维码的 URL
// result.actionRequired — 始终 true
// result.validActions — ["DeviceConfirmation", 可能有 "DeviceCode"]
```

### 核心事件

| 事件 | 触发时机 | 可用属性 |
|------|----------|----------|
| `remoteInteraction` | 用户扫码（尚未确认） | 无 |
| `authenticated` | 用户在手机端确认登录 | `session.steamID`, `session.accountName`, `session.refreshToken` |
| `timeout` | `loginTimeout` 到期 | 无 |
| `error` | 轮询/认证失败 | `err.message`, `err.eresult` |

### 生命周期

```
startWithQR() → 自动轮询 → [remoteInteraction] → [authenticated] → 获取 refreshToken
                         ↘ [timeout] → 需要重新生成
                         ↘ [error] → 需要重新生成
```

- QR URL 有效期约 **2-3 分钟**（Steam 服务端控制）
- `session.cancelLoginAttempt()` 可主动取消
- 认证成功后 `session.refreshToken` 即可用，与密码登录获取的 token 格式一致

## 二、后端实现方案

### 2.1 新增函数：`startQrLoginSession` / `pollQrLoginStatus`

在 `authService.js` 中新增，复用现有的 `pendingSessions` Map（或独立的 `pendingQrSessions` Map）。

```js
// ---- authService.js 新增 ----

const QR_SESSION_TTL_MS = 3 * 60 * 1000; // 3 分钟
const pendingQrSessions = new Map();

/**
 * 第一阶段：生成 QR 登录 session，返回 qrChallengeUrl
 * @returns {Promise<{qrUrl: string, sessionKey: string}>}
 */
async function startQrLoginSession({logger, timeout = 150000} = {}) {
  const session = new LoginSession(EAuthTokenPlatformType.SteamClient);
  session.loginTimeout = timeout;

  const startResult = await session.startWithQR();
  const sessionKey = `qr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // 缓存 session，等待扫码
  const entry = {
    session,
    startedAt: Date.now(),
    status: "pending",    // pending → scanned → authenticated → expired → error
    accountName: null,
    refreshToken: null,
    steamId64: null,
    error: null
  };

  session.on("remoteInteraction", () => {
    entry.status = "scanned";
    if (logger) logger.info("auth", `qr-login scanned: key=${sessionKey}`);
  });

  session.on("authenticated", () => {
    entry.status = "authenticated";
    entry.accountName = session.accountName || null;
    entry.refreshToken = session.refreshToken || null;
    entry.steamId64 = getSteamId64(session);
    if (logger) logger.info("auth", `qr-login authenticated: key=${sessionKey} account=${entry.accountName}`);
  });

  session.on("timeout", () => {
    entry.status = "expired";
    if (logger) logger.info("auth", `qr-login expired: key=${sessionKey}`);
  });

  session.on("error", (err) => {
    entry.status = "error";
    entry.error = err && err.message || "unknown";
    if (logger) logger.warn("auth", `qr-login error: key=${sessionKey} error=${entry.error}`);
  });

  pendingQrSessions.set(sessionKey, entry);

  // 自动清理
  setTimeout(() => {
    if (pendingQrSessions.has(sessionKey)) {
      try { session.cancelLoginAttempt(); } catch (_) {}
      pendingQrSessions.delete(sessionKey);
    }
  }, QR_SESSION_TTL_MS);

  return {
    qrUrl: startResult.qrChallengeUrl,
    sessionKey
  };
}

/**
 * 轮询 QR 登录状态
 * @returns {{status, accountName?, refreshToken?, error?}}
 */
function getQrLoginStatus(sessionKey) {
  const entry = pendingQrSessions.get(sessionKey);
  if (!entry) return {status: "not_found"};
  return {
    status: entry.status,
    accountName: entry.accountName,
    refreshToken: entry.refreshToken,
    steamId64: entry.steamId64,
    error: entry.error
  };
}

/**
 * 消费 QR 登录结果（认证成功后调用，存 token 并清理）
 */
function consumeQrLogin(sessionKey, {tokenStore} = {}) {
  const entry = pendingQrSessions.get(sessionKey);
  if (!entry) return null;
  if (entry.status !== "authenticated" || !entry.refreshToken) return null;

  if (tokenStore && entry.accountName) {
    tokenStore.set(entry.accountName, entry.refreshToken);
  }

  try { entry.session.cancelLoginAttempt(); } catch (_) {}
  pendingQrSessions.delete(sessionKey);

  return {
    username: entry.accountName,
    refresh_token: entry.refreshToken,
    steam_id64: entry.steamId64
  };
}

function cancelQrLogin(sessionKey) {
  const entry = pendingQrSessions.get(sessionKey);
  if (!entry) return;
  try { entry.session.cancelLoginAttempt(); } catch (_) {}
  pendingQrSessions.delete(sessionKey);
}
```

### 2.2 新增 API 端点（uiServer.js）

推荐用 **SSE** 实现实时推送，避免前端轮询：

```
POST /api/accounts/qr-login-start   → 返回 {qrUrl, sessionKey}
GET  /api/accounts/qr-login-poll    → SSE 流，推送状态变化直到 authenticated/expired/error
POST /api/accounts/qr-login-consume → 认证成功后消费结果，执行账号入库
POST /api/accounts/qr-login-cancel  → 取消 QR 登录
```

#### SSE 方案（推荐）

```js
// GET /api/accounts/qr-login-poll?key=xxx
// SSE 流，每 1.5s 推送一次状态
res.writeHead(200, {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive"
});

const interval = setInterval(() => {
  const result = getQrLoginStatus(sessionKey);
  res.write(`data: ${JSON.stringify(result)}\n\n`);

  if (["authenticated", "expired", "error", "not_found"].includes(result.status)) {
    clearInterval(interval);
    res.end();
  }
}, 1500);

req.on("close", () => clearInterval(interval));
```

#### 替代方案：前端短轮询

如果 SSE 复杂度不值得，前端每 2s 调一次 `GET /api/accounts/qr-login-poll?key=xxx`（非 SSE，普通 JSON）也可以。QR 登录场景下轮询频率低，开销可接受。

### 2.3 与现有架构的关系

- QR 登录获取的 `refreshToken` 与密码登录完全一致，复用 `TokenStore.set()`
- 账号入库逻辑复用 `login-save` / `login-start` 中的 upsert 流程
- `pendingQrSessions` 独立于 `pendingSessions`（邮箱验证码用），互不干扰

## 三、前端实现方案

### 3.1 登录模态框改造

在 `accountLoginModal` 中增加 tab 切换：

```
┌─────────────────────────────────────┐
│  [账号密码登录]  [扫码登录]          │
├─────────────────────────────────────┤
│                                     │
│     ┌───────────┐                   │
│     │  QR Code  │                   │
│     │           │                   │
│     └───────────┘                   │
│                                     │
│   请使用 Steam 手机客户端扫描       │
│                                     │
│   状态：等待扫码...                 │
│                                     │
│   [取消]                            │
└─────────────────────────────────────┘
```

### 3.2 QR 码渲染

**推荐方案**：使用纯前端 QR 生成库，无需服务端渲染。

选项 A — **qrcode** npm 包（项目已有 node_modules，可直接用）：
```js
import QRCode from "qrcode";
const canvas = document.getElementById("qrCanvas");
await QRCode.toCanvas(canvas, qrChallengeUrl, {width: 200, margin: 2});
```

选项 B — **内联轻量方案**（无额外依赖）：
使用 `qr-creator`（~4KB gzip）或直接用 Google Chart API（需网络）。

选项 C — **Canvas 内联实现**：
项目如果不想加依赖，可以用一个 ~200 行的内联 QR 编码器。

**推荐选项 A**，因为 `qrcode` 是成熟库且体积小。但考虑到这是 Electron 桌面应用，也可以在 node 侧生成 data URL 返回给前端，避免前端加依赖。

### 3.3 状态流转

```
[点击"扫码登录" tab]
  → 调用 POST /api/accounts/qr-login-start
  → 获取 qrUrl，渲染二维码
  → 开启 SSE 监听 /api/accounts/qr-login-poll

状态机：
  generating  → 正在生成二维码...
  pending     → 请使用 Steam 手机客户端扫描
  scanned     → 已扫描，请在手机上确认登录
  authenticated → 登录成功！正在同步账号...
                → 调用 POST /api/accounts/qr-login-consume
                → 执行 loadAccounts + switchAccountView
  expired     → 二维码已过期 [重新生成]
  error       → 登录失败：xxx [重新生成]
```

### 3.4 前端代码骨架

```js
// app.js 新增

async function startQrLogin() {
  setQrLoginStatus("generating");
  try {
    const resp = await api("/api/accounts/qr-login-start", {method: "POST"});
    const {qrUrl, sessionKey} = resp.data;
    state.qrSessionKey = sessionKey;

    // 渲染 QR 码（后端返回 data URL 或前端生成）
    renderQrCode(qrUrl);
    setQrLoginStatus("pending");

    // 开启 SSE 轮询
    pollQrStatus(sessionKey);
  } catch (err) {
    setQrLoginStatus("error", err.message);
  }
}

function pollQrStatus(sessionKey) {
  const es = new EventSource(`/api/accounts/qr-login-poll?key=${encodeURIComponent(sessionKey)}`);
  state.qrEventSource = es;

  es.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    setQrLoginStatus(data.status);

    if (data.status === "scanned") {
      // 更新 UI：已扫描，等待确认
    }

    if (data.status === "authenticated") {
      es.close();
      // 消费结果
      await api("/api/accounts/qr-login-consume", {
        method: "POST",
        body: JSON.stringify({sessionKey})
      });
      await finishLoginSuccess(data.accountName);
    }

    if (data.status === "expired" || data.status === "error") {
      es.close();
    }
  };

  es.onerror = () => {
    es.close();
    setQrLoginStatus("error", "连接中断");
  };
}

function cancelQrLogin() {
  if (state.qrEventSource) {
    state.qrEventSource.close();
    state.qrEventSource = null;
  }
  if (state.qrSessionKey) {
    api("/api/accounts/qr-login-cancel", {
      method: "POST",
      body: JSON.stringify({sessionKey: state.qrSessionKey})
    }).catch(() => {});
    state.qrSessionKey = null;
  }
  setQrLoginStatus("idle");
}
```

## 四、错误处理

| 场景 | 处理 |
|------|------|
| QR 过期 | 前端显示"已过期"+ 重新生成按钮 |
| 用户取消（关闭模态框/切换 tab） | 调用 cancel API，关闭 SSE |
| 网络中断 | SSE onerror → 显示错误 + 重试按钮 |
| Steam 服务不可用 | startWithQR 抛异常 → 前端显示错误 |
| 同时多个 QR session | 新建时自动取消旧的 |
| 扫码后手机端拒绝 | Steam 不会发 reject 事件，会走 timeout |

## 五、QR 码生成依赖选择

| 方案 | 大小 | 优劣 |
|------|------|------|
| 后端 `qrcode` 包生成 data URL | ~100KB | 前端零依赖，后端 `QRCode.toDataURL(url)` 一行搞定 |
| 前端 `qrcode` 包 | ~33KB gzip | 需要打包或 CDN |
| 后端生成 SVG 字符串 | ~100KB | 前端直接 innerHTML |

**推荐**：后端用 `qrcode` 包生成 data URL，随 `qr-login-start` 响应一起返回。前端直接 `<img src="${dataUrl}">` 渲染，零前端依赖。

```bash
cd node_sidecar && npm install qrcode
```

```js
// 后端生成
const QRCode = require("qrcode");
const dataUrl = await QRCode.toDataURL(qrChallengeUrl, {width: 256, margin: 2});
// 返回给前端: {qrUrl: qrChallengeUrl, qrImage: dataUrl, sessionKey}
```

## 六、实现优先级

1. **authService.js** — `startQrLoginSession`, `getQrLoginStatus`, `consumeQrLogin`, `cancelQrLogin`
2. **uiServer.js** — 4 个 API 端点
3. **安装 qrcode 依赖** — `npm install qrcode`
4. **index.html** — 登录模态框增加 tab 切换 + QR 显示区
5. **app.js** — QR 登录前端逻辑
6. **styles.css** — QR 登录相关样式
