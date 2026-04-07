# 炼金执行短时 Permit 设计稿

日期：2026-04-07  
状态：待魔尊确认后进入实现计划  
范围：在保留现有 `15 分钟 signed bundle + 5 分钟 refresh` 的前提下，为真正执行炼金增加一层“临门一脚”远端裁决。

## 1. 背景

当前控制面已经具备：

- 控制台登录、用户管理、会员方案、权限覆盖
- 客户端登录后获取 `15 分钟` 的签名授权快照
- 客户端运行中基于 `refresh_token` 静默续签
- 本地基于 `craft.use` 权限 gate 真实炼金路由

这套方案已经能做到：

- 撤权后最迟约 `15 分钟` 生效
- 普通用户无法靠改本地 JSON 直接开通功能
- 私钥不随客户端分发

但它做不到：

- 阻止懂 Electron/Node 逆向的人 patch 本地 gate
- 在“开始真正炼金”这一刻由控制台再次做最终放行

因此，本轮不推翻现有 bundle 体系，而是在执行链上加一层更短时效的 `craft execution permit`。

## 2. 目标与非目标

### 2.1 目标

- 保留现有 `15 分钟 bundle` 作为日常 UI 权限和静默续签的基础
- 每次真正执行炼金前，由本地 `uiServer` 向控制台申请一次短时 `permit`
- `permit` 绑定：
  - 当前登录用户
  - 当前设备
  - 炼金动作类型
  - 目标 Steam 账号
  - 本次执行 payload hash
- `permit` 默认 `30~60 秒` 过期，过期即作废
- 前端页面不直接接触 `refresh_token` 和 `permit`

### 2.2 非目标

- 不把炼金逻辑整体迁移到控制台执行
- 不把 Steam 凭据上传到控制台
- 不承诺“绝对不可破解”
- 不在本轮引入重型 anti-debug / VM / packer 方案

## 3. 方案对比

### 方案 A：只保留现有 15 分钟 bundle

优点：

- 零额外开发成本
- 离线体验最好
- 现有结构已经跑通

缺点：

- 真正执行炼金时没有再次远端裁决
- 撤权窗口仍然是快照剩余寿命
- 本地 gate 被 patch 后，控制台无法在执行瞬间拦截

判定：不满足“真正执行依赖控制台授权”的目标。

### 方案 B：保留 15 分钟 bundle，再加“单次短时 Permit”

优点：

- 改动最小，能复用现有 `refresh_session`、私钥、公钥和 control plane client
- 真正执行前会再次触发控制台判定
- 前端无需保存新凭证，敏感流量都留在本地 `uiServer`
- 可以把撤权生效窗口从 `15 分钟` 收缩到“下一次执行前”

缺点：

- 真正执行仍在本地，专业逆向者依旧可以 patch 本地 sidecar
- 如果 permit 只绑定短 TTL 而不绑定 payload hash，则会有短窗口重放
- 完全离线时将无法执行真实炼金

判定：推荐。它是本轮“最小改造 / 最大收益”的平衡点。

### 方案 C：把真正执行迁到服务端或让服务端持有必需秘密

优点：

- 抗破解上限最高
- 控制台能成为真正的最终执行者

缺点：

- 架构代价巨大
- 本地 Steam 登录态、库存、二次验证等都会被迫重构
- 与当前“业务数据与执行都在本地”的产品边界冲突

判定：不是本轮方案，只作为长期方向。

## 4. 推荐方案

采用方案 B：

`15 分钟 entitlement bundle + 每次真实炼金前请求 30~60 秒短时 craft permit`

## 5. 组件边界

### 5.1 Admin Console

职责：

- 使用现有 `refresh_session` 识别终端用户与设备
- 解析用户当前 entitlements
- 对 `craft.use` 做实时判定
- 为指定 craft payload 签发短时 permit

本轮不新增控制台 UI 页面，先只加 API。

### 5.2 node_sidecar uiServer

职责：

- 继续做本地 bundle 验签和普通权限 gate
- 在真正执行炼金前，后台向控制台申请 permit
- 在本地立即验签 permit，并校验：
  - `device_id`
  - `sub`
  - `action`
  - `account_username`
  - `payload_hash`
  - `exp`
- 只有 permit 通过后才进入 `craftService` / `craftTradeupWithComponentsService`

### 5.3 Browser UI

职责：

- 无需理解 permit 结构
- 继续只请求本地 `/api/craft/*`
- 只接收“控制台拒绝执行”或“认证服务不可达”的友好错误

## 6. Permit 数据契约

### 6.1 请求

本地 `uiServer` 调控制台：

`POST /api/auth/craft-permit`

请求体建议为：

```json
{
  "refresh_token": "rt_xxx",
  "device_id": "machine_xxx",
  "action": "craft.tradeup.execute",
  "account_username": "steam_account_a",
  "payload_hash": "sha256:..."
}
```

说明：

- 复用已有 `refresh_token`，不新增第三种长期凭证
- `payload_hash` 由本地 `uiServer` 基于“去敏后的稳定 payload”生成
- 禁止把 `password`、本地路径、日志字段混入 hash

### 6.2 响应

控制台返回：

```json
{
  "ok": true,
  "permit": {
    "snapshot": {
      "sub": "12",
      "username": "member_a",
      "device_id": "machine_xxx",
      "action": "craft.tradeup.execute",
      "account_username": "steam_account_a",
      "payload_hash": "sha256:...",
      "jti": "permit_xxx",
      "iat": "2026-04-07T03:00:00.000Z",
      "exp": "2026-04-07T03:00:30.000Z"
    },
    "signature": "base64..."
  }
}
```

### 6.3 本地稳定 hash

建议分别定义两类 canonical payload：

- `/api/craft/tradeup`
  - `action`
  - `username`
  - `allow_cooling`
  - `item_ids` 或 `recipes`
- `/api/craft/tradeup-with-components`
  - `action`
  - `username`
  - `allow_cooling`
  - `prepare_only`
  - `recipes`

显式排除：

- `password`
- 前端展示态字段
- run id
- 调试标记

## 7. 运行时流程

### 7.1 批量组件炼金

1. 浏览器调用本地 `/api/craft/tradeup-with-components`
2. `uiServer` 先做现有本地检查：
   - bundle 有效
   - `craft.use`
   - Steam 账号访问权
   - 账号已连接
3. `uiServer` 从本地授权状态读出 `refresh_credential`
4. `uiServer` 生成当前请求的 stable payload hash
5. `uiServer` 调控制台 `/api/auth/craft-permit`
6. 控制台确认：
   - refresh session 有效
   - `device_id` 匹配
   - 用户仍有 `craft.use`
7. 控制台签发短时 permit
8. `uiServer` 立即验签 permit 并核对 hash
9. 验证通过后，才执行 `craftTradeupWithComponentsService.runTradeUpWithComponents()`

### 7.2 普通炼金

`/api/craft/tradeup` 走同一套链路，只是 canonical payload 稍有不同。

## 8. 失败语义

建议统一为以下几类：

- `403 craft_permission_denied`
  - 控制台确认该用户当前不能炼金
- `409 craft_permit_mismatch`
  - permit 与本地请求 hash / device / action 不匹配
- `410 craft_permit_expired`
  - permit 已过期
- `503 craft_auth_unavailable`
  - 控制台不可达或未配置

对前端文案建议保持简短：

- “当前账号未获得炼金执行授权”
- “执行授权已过期，请重试”
- “认证服务暂时不可用，暂无法执行炼金”

## 9. 安全收益与边界

### 9.1 收益

- 从“登录时授权一次”升级为“执行前再授权一次”
- 撤权后，不必等 `15 分钟` 到期，只要用户下一次执行就会被控制台拦截
- permit 绑定 payload hash，可减少短窗口内的跨请求复用
- `refresh_token` 与 permit 都不暴露给浏览器 UI

### 9.2 仍然存在的边界

- 真实炼金逻辑仍在本地 sidecar
- 专业逆向者仍可 patch `uiServer` 跳过 permit 申请或 permit 校验
- 因此，这个方案是“显著抬高成本”，不是“绝对不可破解”

## 10. 最小落地清单

建议只改这些核心点：

- `admin_console/src/entitlementSigner.js`
  - 新增 `issueCraftPermit()`
- `admin_console/src/server.js`
  - 新增 `POST /api/auth/craft-permit`
- `admin_console/src/constants.js`
  - 新增 permit TTL 配置
- `node_sidecar/src/controlPlaneAuthClient.js`
  - 新增 `issueCraftPermit()`
- `node_sidecar/src/uiServer.js`
  - 在两个真实炼金路由前加 permit 获取与校验
- `shared/`
  - 新增 permit contract / validation

## 11. 实施建议

实施顺序建议为：

1. 先把 permit contract 和签名逻辑补齐
2. 再做控制台 API
3. 再把 `uiServer` 两个真实炼金入口切到“先 permit 后执行”
4. 最后补回归测试和错误文案

此稿确认后，进入实现计划。
