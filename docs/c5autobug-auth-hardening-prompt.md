# C5autobug 认证体系安全加固 — AI 执行指令

> 本文档是一份完整的技术指令，供 AI 助手对 C5autobug（C5 交易助手）项目执行认证安全加固。
> 参考来源：CS2 Alchemy 项目已完成的同类加固方案。

---

## 如何开始

把下面这段话直接发给 AI（Claude / ChatGPT / Cursor 等），然后把本文档全文粘贴在后面：

```
我需要你对我的项目进行认证安全加固。下面是一份完整的技术指令文档，包含了所有需要修复的安全缺陷、具体修复方案（含代码）、实施顺序和验证清单。

请你：
1. 先通读整份文档，理解项目结构和所有缺陷
2. 按照"实施顺序"章节的优先级，逐个修复
3. 每完成一个缺陷的修复，用"验证检查清单"中对应的条目自检
4. 所有修改必须保持向后兼容——不能破坏现有用户的登录和数据

我的项目根目录是：C:\Users\18220\Desktop\C5autobug更新接口 - 副本 (2)

以下是完整指令文档：
```

然后把本文档从"你的角色"章节开始的全部内容粘贴上去即可。

如果你用的是 Claude Code CLI，可以直接执行：
```bash
cd "C:\Users\18220\Desktop\C5autobug更新接口 - 副本 (2)"
# 把本文档放到项目根目录下方便引用
cp "C:\Users\18220\Desktop\cs2_alchemy\docs\c5autobug-auth-hardening-prompt.md" ./docs/

# 然后在 Claude Code 中发送：
# "请阅读 docs/c5autobug-auth-hardening-prompt.md 并按照其中的指令执行安全加固"
```

---

## 你的角色

你是一个安全工程 AI 助手。你的任务是对 C5autobug 项目的认证体系进行全面安全加固。所有修改必须保持向后兼容，不破坏现有用户的登录状态和数据。

---

## 项目概况

C5autobug 是一个 CS2 皮肤自动扫货桌面应用，采用三层架构：

- **Python 后端**（`app_backend/`）：FastAPI，本地运行，代理认证请求到远端控制面
- **Electron 前端**（`app_desktop_web/`）：React SPA
- **远端控制面**（`program_admin_console/`）：Node.js HTTP 服务器 + SQLite，部署在阿里云

### 技术栈
- 控制面：Node.js（原生 `node:http`），SQLite（`node:sqlite` 的 `DatabaseSync`），nodemailer
- 后端：Python 3，FastAPI，httpx
- 前端：React，Vite

### 关键文件路径
```
program_admin_console/src/server.js           — 控制面 HTTP 服务器（所有 auth 路由）
program_admin_console/src/controlPlaneStore.js — SQLite 数据层
program_admin_console/src/constants.js         — 默认配置、会员计划定义
program_admin_console/src/entitlementSigner.js — License Bundle 签发
program_admin_console/src/mailService.js       — 邮件发送

app_backend/api/routes/program_auth.py         — FastAPI 认证路由（代理层）
app_backend/api/schemas/program_auth.py        — Pydantic 请求/响应模型
app_backend/infrastructure/program_access/remote_entitlement_gateway.py — 认证网关
app_backend/infrastructure/program_access/remote_control_plane_client.py — HTTP 客户端

app_desktop_web/src/api/program_auth_client.js — 前端认证 API 客户端
app_desktop_web/src/program_access/program_access_provider.jsx — React 认证上下文
```

---

## 安全缺陷清单

以下是经审计确认的安全缺陷，全部需要修复：

### 缺陷 1：登录无暴力破解防护 [Critical]

**现状**：`server.js` 的 `/api/auth/login`（约第 991 行）和 `/api/admin/login`（约第 456 行）无任何失败计数、锁定或延迟机制。攻击者可无限次尝试密码。

**修复方案**：

1. 在 `controlPlaneStore.js` 的 `ensureSchema()` 中新增表：

```sql
CREATE TABLE IF NOT EXISTS login_attempt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempt_username_created
  ON login_attempt(username, created_at);
```

2. 在 `ControlPlaneStore` 类中新增方法：

```javascript
recordLoginAttempt({username = "", success = false, ip = "", now = new Date()} = {}) {
  this.db.prepare(`
    INSERT INTO login_attempt(username, success, ip, created_at) VALUES(?, ?, ?, ?)
  `).run(toText(username), success ? 1 : 0, toText(ip), toIsoString(now));
}

getRecentFailedAttempts({username = "", windowMs = 15 * 60 * 1000, now = new Date()} = {}) {
  const cutoff = new Date(now.getTime() - windowMs).toISOString();
  const row = this.db.prepare(`
    SELECT COUNT(*) AS cnt FROM login_attempt
    WHERE username = ? AND success = 0 AND created_at >= ?
  `).get(toText(username), cutoff);
  return Number(row && row.cnt) || 0;
}

isLoginLocked({username = "", maxAttempts = 5, windowMs = 15 * 60 * 1000, now = new Date()} = {}) {
  return this.getRecentFailedAttempts({username, windowMs, now}) >= maxAttempts;
}
```

3. 在 `server.js` 的 `/api/auth/login` 路由中：

```javascript
// 在 authenticateClientUser 调用之前
const clientIp = toText(req.socket && req.socket.remoteAddress);
if (store.isLoginLocked({username, maxAttempts: 5, windowMs: 15 * 60 * 1000, now: now()})) {
  writeError(res, 429, "login_locked", "登录失败次数过多，请15分钟后再试");
  return;
}

const auth = store.authenticateClientUser({username, password});
store.recordLoginAttempt({username, success: auth.ok, ip: clientIp, now: now()});

if (!auth.ok) {
  writeError(res, 401, auth.reason, "invalid credentials");
  return;
}
```

4. 对 `/api/admin/login` 做同样处理。

---

### 缺陷 2：旧版注册路由（v2）缺少密码/用户名校验 [High]

**现状**：`server.js` 约第 957 行的 `/api/auth/register`（v2 旧路由）只检查字段非空，不校验密码强度和用户名格式。v3 的 `/api/auth/register/complete` 路由有 `isStrongPassword()` 检查，但该函数只要求 ≥8 字符 + 字母 + 数字，没有检查用户名格式。

**修复方案**：

1. 新建 `program_admin_console/src/validation.js`：

```javascript
function validatePassword(password) {
  const text = String(password || "").trim();
  if (!text) return {ok: false, reason: "password_required", message: "密码不能为空"};
  if (text.length < 8) return {ok: false, reason: "password_too_short", message: "密码至少需要8个字符"};
  if (text.length > 128) return {ok: false, reason: "password_too_long", message: "密码不能超过128个字符"};
  if (!/[a-zA-Z]/.test(text)) return {ok: false, reason: "password_missing_letter", message: "密码至少需要包含1个字母"};
  if (!/[0-9]/.test(text)) return {ok: false, reason: "password_missing_digit", message: "密码至少需要包含1个数字"};
  return {ok: true, reason: "valid", message: ""};
}

function validateUsername(username) {
  const text = String(username || "").trim();
  if (!text) return {ok: false, reason: "username_required", message: "用户名不能为空"};
  if (text.length < 3) return {ok: false, reason: "username_too_short", message: "用户名至少需要3个字符"};
  if (text.length > 20) return {ok: false, reason: "username_too_long", message: "用户名不能超过20个字符"};
  if (!/^[a-zA-Z0-9_]+$/.test(text)) return {ok: false, reason: "username_invalid_chars", message: "用户名只能包含字母、数字和下划线"};
  return {ok: true, reason: "valid", message: ""};
}

module.exports = {validatePassword, validateUsername};
```

2. 在 `server.js` 中引入并应用到以下路由：
   - `/api/auth/register`（v2，约第 957 行）
   - `/api/auth/register/complete`（v3，替换现有的 `isStrongPassword` 调用）
   - `/api/auth/password/reset`（约第 1098 行）
   - `/api/admin/bootstrap`（约第 438 行）

3. 在 Python 后端 `app_backend/api/routes/program_auth.py` 中也加入前置校验（可选，因为控制面已校验）。

---

### 缺陷 3：密码重置无暴力破解防护 [High]

**现状**：`/api/auth/password/send-reset-code` 和 `/api/auth/password/reset` 没有针对验证码猜测的防护。虽然验证码发送有 cooldown，但验证码验证本身没有尝试次数限制。

**修复方案**：

在 `controlPlaneStore.js` 的 `verifyEmailCode()` 方法中增加尝试次数检查：
- 同一 email + scene 在 5 分钟内验证失败超过 5 次 → 拒绝
- 需要新增一个 `code_verify_attempt` 表或在 `email_code` 表中增加 `attempt_count` 列

---

### 缺陷 4：请求体无大小限制 [Medium]

**现状**：`server.js` 的 `readJsonBody()`（约第 124 行）没有限制请求体大小，可能被用于 DoS 攻击。

**修复方案**：

```javascript
// 在 readJsonBody 中增加大小限制
async function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalSize = 0;
    req.on("data", (chunk) => {
      totalSize += chunk.length;
      if (totalSize > maxBytes) {
        req.destroy();
        reject(new Error("request_body_too_large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (_) {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}
```

---

### 缺陷 5：控制面裸 HTTP 传输 [Critical]

**现状**：控制面部署在 `http://8.138.39.139:18787`，所有密码和 refresh token 在网络上明文传输。README 中推荐了 SSH 隧道用于管理面板访问，但客户端 API 仍是裸 HTTP。

**修复方案**：

在服务器上部署 nginx 反向代理 + TLS：

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # 客户端 API
    location /api/auth/ {
        proxy_pass http://127.0.0.1:18787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 管理面板
    location /admin {
        proxy_pass http://127.0.0.1:18787;
        # 可选：限制管理面板仅允许特定 IP
        # allow 你的IP;
        # deny all;
    }
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}
```

部署步骤：
1. 申请域名，DNS 解析到 `8.138.39.139`
2. `apt install nginx certbot python3-certbot-nginx`
3. `certbot --nginx -d your-domain.com`
4. 修改 Python 后端的 `remote_control_plane_client.py` 中的 base_url 为 `https://your-domain.com`
5. 修改 release 配置中的控制面地址

---

### 缺陷 6：管理员 Bootstrap 无防护 [Medium]

**现状**：`/api/admin/bootstrap`（约第 438 行）允许在无管理员时创建超级管理员，但没有任何 rate limiting。如果数据库被清空，攻击者可以抢先创建管理员。

**修复方案**：
- 增加 IP 白名单检查（仅允许 127.0.0.1 或 SSH 隧道来源）
- 或增加一次性 bootstrap token（从环境变量读取）

---

## 实施顺序

按优先级排列：

1. **缺陷 1：登录暴力破解防护** — 最紧急，直接影响账号安全
2. **缺陷 2：密码/用户名校验** — 基础防线
3. **缺陷 4：请求体大小限制** — 简单改动，防 DoS
4. **缺陷 3：验证码猜测防护** — 中等优先级
5. **缺陷 5：HTTPS 部署** — 需要服务器操作
6. **缺陷 6：Bootstrap 防护** — 低频风险

---

## 验证检查清单

完成所有修改后，逐项验证：

- [ ] 连续 5 次错误密码登录 → 第 6 次返回 429 `login_locked`
- [ ] 锁定期间正确密码也返回 429
- [ ] 15 分钟后解锁，可正常登录
- [ ] 管理员登录同样有暴力破解防护
- [ ] v2 注册路由：密码 "123" 被拒，"ab" 用户名被拒
- [ ] v3 注册路由：同上校验生效
- [ ] 密码重置：新密码 "weak" 被拒
- [ ] 超大请求体（>1MB）被拒绝
- [ ] 验证码连续猜错 5 次后被锁定
- [ ] 现有用户登录不受影响（向后兼容）
- [ ] 现有 v3 三步注册流程不受影响

---

## 注意事项

1. **向后兼容**：所有 SQLite schema 变更使用 `CREATE TABLE IF NOT EXISTS`，不影响现有数据
2. **不引入新依赖**：所有修改使用 Node.js 标准库
3. **保留现有 v3 流程**：v3 三步注册已经实现且运行良好，只需补充校验
4. **Python 后端是代理层**：核心校验在控制面完成，Python 端可选择性增加前置校验
5. **测试**：项目在 `program_admin_console/tests/` 下有测试文件，新增功能需补充对应测试
