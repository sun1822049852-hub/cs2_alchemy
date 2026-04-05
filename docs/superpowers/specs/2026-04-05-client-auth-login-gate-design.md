# 客户端登录收口与调试导包隔离设计稿

日期：2026-04-05  
状态：已确认，进入第一阶段实现  
范围：客户端认证入口收口、调试导包隔离、后续邮箱验证码认证接入契约

## 1. 背景

当前客户端已经从本地 `admin` 登录门切换到本地签名授权包模式：

- 启动后通过 `/api/license/state` 检查授权
- 通过 `/api/license/import` 手工导入授权包
- 本地验签并放行业务 API

这套模式适合内部调试，但不适合最终用户交付。用户不应该手工接触授权包 JSON，也不应该理解签名快照。

当前新目标已经明确：

- 正式用户登录入口为 `用户名 + 密码`
- 注册时用 `邮箱 + 验证码` 验证邮箱所有权
- 找回密码时用 `邮箱 + 验证码` 重置密码
- 调试包继续保留手工导包方式
- 正式包移除手工导包入口

## 2. 非目标

- 本轮不实现完整远程控制台前端
- 本轮不实现最终 QQ 邮箱发送逻辑
- 本轮不把业务数据迁移到远端
- 本轮不替换现有本地 license 验签内核

## 3. 总体方案

客户端认证入口拆成两种运行模式：

- `debug_bundle`
  - 面向内部调试
  - 保留手工导包入口
  - 允许直接通过本地签名授权包进入工作台
- `prod_login`
  - 面向正式用户
  - 禁止手工导包
  - 只允许通过登录 / 注册 / 找回密码流程换取签名授权快照

两种模式共用同一套本地授权内核：

- 本地 `licenseStore`
- 本地 `licenseEnforcer`
- 本地 `licenseScheduler`
- 本地业务 API gate

区别只在“授权从哪里来”：

- `debug_bundle`：由人工导入 JSON
- `prod_login`：由远端认证服务发回 `access bundle`

## 4. 认证边界

### 4.1 客户端本地职责

客户端只负责：

- 展示登录 / 注册 / 找回密码 UI
- 调用本地 sidecar API
- sidecar 再请求远端认证服务
- 保存远端返回的签名授权包与刷新凭证
- 本地验签和本地功能放行

### 4.2 远端认证服务职责

远端服务负责：

- 邮箱验证码发送
- 邮箱验证码校验
- 账号注册
- 用户名/密码登录
- 密码重置
- 签发短期 `access bundle`
- 发放和轮换 `refresh_token`

### 4.3 邮箱验证码的安全语义

邮箱验证码只能证明“这个邮箱当前可收信”，不能证明“是人类”。  
因此仍需要最小风控：

- 同邮箱限流
- 同 IP 限流
- 验证码短时效
- 验证码一次性使用

## 5. 客户端模式配置

新增客户端认证配置：

- `CLIENT_AUTH_MODE`
  - `debug_bundle`
  - `prod_login`
- `CONTROL_PLANE_BASE_URL`
  - 远端认证服务地址

行为定义：

- 未配置 `CLIENT_AUTH_MODE` 时默认 `debug_bundle`
- `prod_login` 模式下：
  - `/api/license/import` 返回禁用错误
  - UI 不显示导包输入框
  - gate 默认显示登录页
- `debug_bundle` 模式下：
  - 保持当前导包行为

## 6. 远端接口契约

本轮客户端先约定接口，不强耦合具体邮件服务商。

### 6.1 登录

`POST /api/auth/login`

请求：

```json
{
  "username": "alice",
  "password": "secret",
  "device_id": "device_xxx",
  "client_version": "1.0.0"
}
```

响应：

```json
{
  "ok": true,
  "user": {
    "id": "user_1",
    "username": "alice",
    "email": "alice@example.com"
  },
  "access_bundle": {
    "snapshot": {},
    "signature": ""
  },
  "refresh_token": "opaque_refresh_token"
}
```

### 6.2 注册发送验证码

`POST /api/auth/email/send-code`

请求：

```json
{
  "email": "alice@example.com",
  "scene": "register"
}
```

### 6.3 注册

`POST /api/auth/register`

请求：

```json
{
  "email": "alice@example.com",
  "code": "123456",
  "username": "alice",
  "password": "secret"
}
```

### 6.4 找回密码发送验证码

`POST /api/auth/password/send-reset-code`

请求：

```json
{
  "email": "alice@example.com"
}
```

### 6.5 重置密码

`POST /api/auth/password/reset`

请求：

```json
{
  "email": "alice@example.com",
  "code": "123456",
  "new_password": "new_secret"
}
```

### 6.6 刷新授权

`POST /api/auth/refresh`

请求：

```json
{
  "refresh_token": "opaque_refresh_token",
  "device_id": "device_xxx"
}
```

响应：

```json
{
  "ok": true,
  "access_bundle": {
    "snapshot": {},
    "signature": ""
  },
  "refresh_token": "rotated_refresh_token"
}
```

## 7. 本地存储策略

继续沿用现有 `client_license_state.json` 结构：

- `snapshot`
- `signature`
- `refresh_credential`
- `imported_at`
- `source`

其中：

- 手工导包时 `source = "manual"`
- 正式登录时 `source = "remote_login"`
- 静默刷新后 `source = "remote_refresh"`

## 8. 本地 sidecar API 设计

新增本地客户端 API：

- `GET /api/client-auth/state`
  - 返回当前认证模式、是否配置远端认证服务、当前授权状态
- `POST /api/client-auth/login`
  - 调远端登录并写入本地授权
- `POST /api/client-auth/logout`
  - 清理本地授权并尽力通知远端吊销刷新 token
- `POST /api/client-auth/register/send-code`
  - 透传到远端注册发码接口
- `POST /api/client-auth/register`
  - 透传到远端注册接口
- `POST /api/client-auth/password/send-reset-code`
  - 透传到远端重置发码接口
- `POST /api/client-auth/password/reset`
  - 透传到远端重置接口

旧行为调整：

- `prod_login` 模式下 `/api/license/import` 禁用
- `/api/license/clear` 继续保留，用于清除本地授权和退出调试态

## 9. UI 设计

原 `licenseGate` 改造成统一认证 gate：

- 顶部显示当前模式对应标题
- `prod_login` 模式：
  - 登录面板
  - 注册面板
  - 找回密码面板
- `debug_bundle` 模式：
  - 保留当前导包面板

UI 原则：

- 正式模式下完全不暴露导包 textarea
- 调试模式下仍可使用原导包 UI
- 登录成功后 gate 自动关闭，进入现有工作台

## 10. 刷新策略

正式模式下，客户端启动流程为：

1. 读取本地 `client_license_state.json`
2. 若存在 `refresh_credential`，先尝试远端刷新
3. 刷新成功则更新本地 bundle
4. 刷新失败时：
   - 若旧 bundle 未过期，可临时放行并继续重试
   - 若已过期，停留在登录 gate

## 11. 打包策略

### 11.1 调试包

- `CLIENT_AUTH_MODE=debug_bundle`
- 保留导包入口
- 保留内部联调用能力

### 11.2 正式包

- `CLIENT_AUTH_MODE=prod_login`
- 不显示导包入口
- 只显示登录 / 注册 / 找回密码入口

## 12. 第一阶段实现范围

本轮先完成：

- 客户端 `auth mode` 配置
- 本地 sidecar `client-auth` API 骨架
- 本地刷新契约与远端认证客户端抽象
- `prod_login` / `debug_bundle` 双模式 gate UI
- 禁止正式模式手工导包

本轮暂不完成：

- 真正远端邮件发送
- 真正用户数据库
- 真正远端注册登录服务

## 13. 验收标准

满足以下条件即视为第一阶段完成：

- `debug_bundle` 模式下原导包能力仍可用
- `prod_login` 模式下用户看不到导包入口
- `prod_login` 模式下导包 API 被后端拒绝
- 客户端已经具备登录 / 注册 / 找回密码 UI 和本地 sidecar API 契约
- 本地授权刷新链已支持后续接远端 `refresh_token`
