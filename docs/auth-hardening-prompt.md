# CS2 Alchemy 认证体系加固 — AI 执行提示词

> 本文档是一份完整的技术指令，供 AI 助手在 CS2 Alchemy 项目中继续执行认证体系修复工作。
> 生成日期：2026-04-24

---

## 项目背景

CS2 Alchemy 是一个 Node.js/Electron 桌面应用，用于 CS2 皮肤管理和炼金（Trade-Up Contract）。项目采用 client-server 架构：

- **控制面（Admin Console）**：远端 Node.js HTTP 服务器，负责用户注册/登录/授权签发
- **客户端（Node Sidecar）**：本地 Electron 应用，通过 HTTP 代理层与控制面通信
- **前端（UI）**：单页应用，运行在 Electron webview 中

### 技术栈
- Node.js（原生 `node:http`，无框架）
- SQLite（`node:sqlite` 的 `DatabaseSync`）
- Ed25519 签名的 License Bundle
- Electron 桌面壳

### 关键文件路径
```
admin_console/src/server.js          — 控制面 HTTP 服务器（所有 auth 路由）
admin_console/src/controlPlaneStore.js — SQLite 数据层（用户/会话/验证码管理）
admin_console/src/entitlementSigner.js — License Bundle 签发
shared/validation.js                  — 密码/用户名校验（新建）
shared/featureCodes.js                — 权限码常量
shared/licensePolicy.js               — License 快照校验
node_sidecar/src/controlPlaneAuthClient.js — 控制面 HTTP 客户端
node_sidecar/src/uiServer.js          — 本地代理服务器
node_sidecar/src/licenseStore.js       — 凭证持久化
node_sidecar/src/secretStore.js        — DPAPI 加密（新建）
node_sidecar/src/licenseEnforcer.js    — License 验签
node_sidecar/ui/app.js                — 前端 UI
```

---

## 已完成的修改

以下修改已经在代码中实施，你需要理解它们以便继续后续工作：

### P1: 登录暴力破解防护 ✅
- `controlPlaneStore.js` 新增 `login_attempt` 表 + `recordLoginAttempt()` / `getRecentFailedAttempts()` / `isLoginLocked()` 方法
- `server.js` 的 `/api/auth/login` 路由：登录前检查锁定状态（5次失败/15分钟窗口），登录后记录结果
- 锁定返回 `429 login_locked`

### P2: 注册三步流程 ✅（服务端 + 代理层）
- `controlPlaneStore.js` 新增 `register_session` 和 `verification_ticket` 表
- 新增方法：`createRegisterSession()` / `verifyCodeAndIssueTicket()` / `consumeVerificationTicket()`
- `server.js` 新增路由：
  - `GET /api/auth/register/readiness` → 返回 `{registration_flow_version: 3}`
  - `POST /api/auth/register/verify-code` → 验证码校验，发放 ticket
  - `POST /api/auth/register/complete` → 消费 ticket + 建账 + 自动签发 access_bundle
  - 旧 `POST /api/auth/register`（v2）保留兼容，已加密码/用户名校验
- `controlPlaneAuthClient.js` 新增：`getRegistrationReadiness()` / `verifyRegisterCode()` / `completeRegister()`
- `uiServer.js` 新增代理路由：`/api/client-auth/register/readiness` / `verify-code` / `complete`

### P3+P4: 密码/用户名校验 ✅
- `shared/validation.js` 新建：`validatePassword()` (≥8字符, 含字母+数字) / `validateUsername()` (3-20字符, 字母数字下划线)
- `server.js` 的注册和密码重置路由已集成校验

### P5: 凭证加密存储 ✅
- `node_sidecar/src/secretStore.js` 新建：Windows DPAPI 加密/解密，非 Windows 降级为明文
- `licenseStore.js` 已改造：保存时加密 refresh_credential，读取时解密，向后兼容自动升级

---

## 待完成的工作

### 1. 前端 UI 三步注册向导

**文件**: `node_sidecar/ui/app.js`

当前前端注册 UI 仍是旧的两步流程（输入邮箱+验证码+用户名+密码一次提交）。需要改造为三步向导：

**步骤 1 — 输入邮箱**
- 用户输入邮箱，点击"发送验证码"
- 调用 `POST /api/client-auth/register/send-code`
- 成功后保存返回的 `register_session_id`，显示 `masked_email`
- 进入步骤 2

**步骤 2 — 输入验证码**
- 显示 `masked_email` 和验证码输入框
- 用户输入验证码，点击"验证"
- 调用 `POST /api/client-auth/register/verify-code`，传 `{email, code, register_session_id}`
- 成功后保存返回的 `verification_ticket`
- 进入步骤 3

**步骤 3 — 设置用户名和密码**
- 显示用户名和密码输入框
- 前端实时校验：用户名 3-20 字符（字母数字下划线），密码 ≥8 字符（含字母+数字）
- 用户点击"完成注册"
- 调用 `POST /api/client-auth/register/complete`，传 `{email, verification_ticket, username, password, device_id}`
- 成功后自动登录（用返回的 `access_bundle` 更新 license 状态）
- 刷新 UI 显示已登录状态

**UI 要求**：
- 三步之间有明确的视觉进度指示（如步骤条 1/2/3）
- 每步有"返回上一步"按钮（步骤 1 除外）
- 验证码输入框显示倒计时（`code_expires_in_seconds`）
- 重发验证码按钮有冷却倒计时（`resend_after_seconds`）
- 错误信息实时显示在表单下方

### 2. 前端密码强度实时提示

在注册步骤 3 和密码重置表单中：
- 密码输入时实时检查强度
- 显示提示：长度不足 / 缺少字母 / 缺少数字 / 强度合格
- 用户名输入时实时检查格式

### 3. 控制面 HTTPS 部署（P6）

当前控制面通过裸 HTTP 暴露在公网（`http://8.138.39.139`），refresh token 在网络上明文传输。

**推荐方案**：nginx 反向代理 + Let's Encrypt TLS 证书

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}
```

部署步骤：
1. 在阿里云服务器安装 nginx + certbot
2. 申请域名并解析到 `8.138.39.139`
3. `certbot --nginx -d your-domain.com`
4. 修改客户端 `client_config.json` 的 `controlPlaneBaseUrl` 为 `https://your-domain.com`

**SSH 隧道方案**（仅开发/内测）：
```bash
ssh -L 8787:127.0.0.1:8787 user@8.138.39.139
```
然后 `controlPlaneBaseUrl` 改为 `http://127.0.0.1:8787`

### 4. 测试用例

需要为以下场景编写测试：

**P1 测试**：
- 连续 5 次错误密码 → 第 6 次返回 429 `login_locked`
- 锁定期间正确密码也返回 429
- 15 分钟后解锁
- 成功登录不增加失败计数

**P2 测试**：
- 三步注册完整流程：send-code → verify-code → complete → 返回 access_bundle
- 过期的 register_session_id 被拒绝
- 过期的 verification_ticket 被拒绝
- 已消费的 ticket 不能重复使用
- v2 旧流程仍然兼容

**P3+P4 测试**：
- 密码 "123" → 被拒（太短）
- 密码 "abcdefgh" → 被拒（缺数字）
- 密码 "12345678" → 被拒（缺字母）
- 密码 "Abc12345" → 通过
- 用户名 "ab" → 被拒（太短）
- 用户名 "test user!" → 被拒（非法字符）
- 用户名 "test_user" → 通过

**P5 测试**：
- 保存后 JSON 文件中 refresh_credential 以 `dpapi:` 前缀开头（Windows）
- 读取时能正确解密回原文
- 旧格式明文文件读取后自动升级为加密格式

### 5. 登录暴力破解防护增强（可选）

当前实现是基于用户名的。可考虑增加：
- 基于 IP 的 rate limiting（同一 IP 15 分钟内超过 20 次失败 → 锁定该 IP）
- CAPTCHA 集成（失败 3 次后要求验证码）
- 登录失败通知邮件（连续 5 次失败后通知账号所有者）

---

## API 端点参考

### 注册流程 v3（三步）

**Step 1: 发送验证码**
```
POST /api/auth/email/send-code
Body: {"email": "user@example.com", "scene": "register"}
Response: {
  "ok": true,
  "message": "注册验证码已发送，请查收邮箱。",
  "expires_in_seconds": 300,
  "register_session_id": "uuid-string",
  "masked_email": "us***@example.com",
  "code_length": 6,
  "code_expires_in_seconds": 300,
  "resend_after_seconds": 60
}
```

**Step 2: 验证码校验**
```
POST /api/auth/register/verify-code
Body: {"email": "user@example.com", "code": "123456", "register_session_id": "uuid-string"}
Response: {
  "ok": true,
  "message": "验证码校验成功",
  "verification_ticket": "uuid-string",
  "ticket_expires_in_seconds": 600
}
```

**Step 3: 完成注册**
```
POST /api/auth/register/complete
Body: {
  "email": "user@example.com",
  "verification_ticket": "uuid-string",
  "username": "my_username",
  "password": "MyPass123",
  "device_id": "device-uuid"
}
Response: {
  "ok": true,
  "message": "注册成功",
  "user": {...},
  "access_bundle": {"snapshot": {...}, "signature": "...", "refresh_credential": "..."},
  "refresh_token": "..."
}
```

### 注册流程版本探测
```
GET /api/auth/register/readiness
Response: {"ok": true, "ready": true, "registration_flow_version": 3}
```

### 登录（含暴力破解防护）
```
POST /api/auth/login
Body: {"username": "...", "password": "...", "device_id": "..."}
Response (locked): 429 {"code": "login_locked", "message": "登录失败次数过多，请15分钟后再试"}
Response (success): 200 {"ok": true, "user": {...}, "access_bundle": {...}, "refresh_token": "..."}
```

---

## 新增 SQLite 表结构

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

CREATE TABLE IF NOT EXISTS register_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_ticket (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT NOT NULL DEFAULT ''
);
```

---

## 校验规则

### 密码
- 最少 8 字符，最多 128 字符
- 至少包含 1 个字母（a-z 或 A-Z）
- 至少包含 1 个数字（0-9）

### 用户名
- 3-20 字符
- 仅允许字母、数字、下划线
- 正则：`/^[a-zA-Z0-9_]{3,20}$/`

### 邮箱
- 基础格式校验：`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`

---

## 执行优先级

1. **前端三步注册 UI** — 用户可见的最大改进
2. **测试用例** — 确保所有改动可验证
3. **HTTPS 部署** — 运维层面，需要服务器操作
4. **暴力破解增强** — 可选优化
