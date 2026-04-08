# 会员分级、体验版与 Steam 绑定资格设计稿

日期：2026-04-08
状态：已确认设计，待魔尊审阅 spec 后进入实现计划
范围：客户端体验版与会员分级、Steam 账号绑定数量限制、防删除/重装套利、服务端绑定资格收口

## 1. 背景

当前项目已经具备两套与本需求直接相关的基础设施：

- 客户端本地账号管理与删除链路
  - `node_sidecar/src/uiServer.js`
  - `node_sidecar/ui/app.js`
- 远端 control plane 的会员方案、设备绑定、授权快照与 `refresh_session`
  - `admin_console/src/controlPlaneStore.js`
  - `admin_console/src/server.js`
  - `admin_console/src/entitlementSigner.js`

但现状仍有一个明显缺口：

- 授权快照只有 `membership_plan`、`permissions`、`feature_flags`
- 本地 `/api/accounts/login-save` 可直接新增 Steam 账号
- 本地 `/api/accounts/delete` 可直接删除 Steam 账号与 token

这意味着如果只在客户端做“隐藏删除按钮”或“本地限制数量”，用户依然可以通过删除程序、清空本地数据、重新安装来绕过绑定数量限制。

本轮目标已经确认：

- 新用户注册后，自动获得 `7` 天体验版
- 体验版采用普通版的单账号绑定规则，并在有效期内拥有普通版权限：
  - 只能绑定 `1` 个 Steam 账号
  - 首绑后锁定到首个 `steam_id64`
- 付费档位分两档：
  - 普通版：只能绑定 `1` 个 Steam 账号
  - 会员版：可绑定无限个 Steam 账号
- 只有拥有会员权限的状态才允许使用炼金功能
- 普通版不能通过删除本地账号、卸载重装、重新登录其他 Steam 账号来实现多人共用
- 普通版首次绑定错号时，不在客户端开放自助换绑，默认走后台人工处理

## 2. 已确认业务规则

### 2.1 会员分级

- `trial`
  - 中文展示：体验版
  - 新用户注册后自动发放
  - 有效期：注册成功起 `7` 天
  - 权限语义：等同普通版
  - 允许绑定 Steam 账号数量：`1`
  - 授予 `craft.use`
- `standard`
  - 中文展示：普通版
  - 允许绑定 Steam 账号数量：`1`
  - 授予 `craft.use`
- `member`
  - 中文展示：会员版
  - 允许绑定 Steam 账号数量：无限
  - 授予 `craft.use`

若当前系统仍保留 `free / pro / elite` 等旧 plan code，本轮不强制立刻删旧 code，但客户端与 control plane 的有效业务语义要统一收口到 `trial / standard / member / inactive` 这组新语义。

### 2.2 功能权限规则

- `trial`
  - 在 `7` 天有效期内允许使用炼金功能
- `standard`
  - 允许使用炼金功能
- `member`
  - 允许使用炼金功能
- `inactive`
  - 不允许使用炼金功能
  - 客户端应隐藏或禁用炼金入口
  - 本地 API 若收到炼金请求，仍要返回权限拒绝，不能只靠前端隐藏

结论：

- `craft.use` 应发给仍处于会员有效期内的 `trial / standard / member`
- 只有 `inactive` 不得拥有 `craft.use`

### 2.3 体验版生命周期规则

- 每个新注册用户默认只获得一次 `7` 天体验版
- 体验期起点以 control plane 注册成功时间为准，不以客户端首次启动或首次绑定时间为准
- 删除程序、重装客户端、更换本地目录都不会重置体验期
- 体验版到期后，自动降为“待开通”状态，不再继续享有普通版权限
- 体验版到期后，不释放已占用的首绑 Steam 资格
- 用户后续购买普通版或会员版时，沿用同一用户账号下的 Steam 绑定历史

### 2.4 绑定资格规则

体验版与普通版都采用“首绑锁定”规则：

- 第一次成功识别到 `steam_id64` 时，占用唯一绑定资格
- 后续允许继续登录同一个 `steam_id64`
- 后续禁止登录任意不同的 `steam_id64`
- 本地删除账号记录不会释放该绑定资格
- 卸载、重装、清理本地数据库不会释放该绑定资格

会员版规则：

- 可绑定多个 `steam_id64`
- 删除本地账号只影响本地显示与 token，不影响服务端已记录的历史绑定
- 不限制绑定数量

### 2.5 删除语义

体验版、普通版和会员版都保留“删除本地账号”能力，但语义明确改为：

- 只删除本地保存的账号、token、UI 快照
- 不删除服务端绑定资格
- 不等于换绑

换绑属于单独的后台管理动作，不属于客户端自助能力。

### 2.6 后台例外能力

需要保留后台人工解锁或重置普通版绑定资格的管理能力，用于处理：

- 用户首次绑错号
- 用户账号被盗后需要重新绑定
- 客服审核通过后的人工迁移

客户端本轮不提供“申请换绑”流程，只做能力预留。

## 3. 方案对比

### 3.1 方案 A：只禁用客户端删除按钮

做法：

- 普通版 UI 不显示删除按钮
- 后端继续保留现有 `accounts/delete`

优点：

- 改动最小
- 前端很快能看到效果

缺点：

- 无法防止删除程序、重装、清理本地文件
- 不能防止直接调用本地 API
- 本质上没有建立真正的绑定资格边界

结论：

- 拒绝采用，安全价值不足

### 3.2 方案 B：把绑定资格只落在客户端本地数据库

做法：

- 本地额外保存“首个已绑定 SteamID”
- 普通版只允许再次登录同一 SteamID

优点：

- 不必改远端 control plane
- 本地实现较快

缺点：

- 用户删除程序目录或更换机器后即可绕过
- 无法跨重装、跨目录、跨环境稳定约束
- 只能提高成本，不能真正收口

结论：

- 不作为最终方案，可作为短时调试兜底，但不能作为正式会员边界

### 3.3 方案 C：服务端记录绑定资格，客户端只做展示与拦截

做法：

- control plane 新增用户与 `steam_id64` 绑定记录
- 登录或绑定成功后由服务端写入绑定资格
- 普通版只能存在 `1` 个有效绑定 SteamID
- 本地删除只删本地数据，不释放服务端绑定

优点：

- 能防止删除程序、重装、本地清库套利
- 与现有 `membership_plan`、`device_id`、`refresh_session` 体系一致
- 管理员可人工审计、人工重置

缺点：

- 需要同时调整 control plane、客户端授权快照和本地账号写入链路
- 需要补一套后台管理操作

结论：

- 采用此方案

## 4. 推荐定版

本轮定版采用：

`注册即发 7 天体验版 + 服务端绑定资格 + 体验版/普通版首绑锁定 + 客户端删除仅删本地 + 后台人工解锁`

最终业务语义如下：

- 体验版：
  - 新用户注册即发放 `7` 天
  - 权限与普通版一致
  - 首次成功绑定后，锁到首个 `steam_id64`
  - 到期后自动降为待开通状态
  - 到期不释放首绑 Steam 资格
- 普通版：
  - 首次成功绑定后，永久锁到首个 `steam_id64`
  - 只能重复使用同一 Steam 账号
  - 允许使用炼金功能
  - 删除本地账号不释放资格
  - 换绑只能后台人工处理
- 会员版：
  - 可绑定无限个 Steam 账号
  - 允许使用炼金功能
  - 本地删除仅清理本地，不影响服务端历史绑定记录

## 5. 数据模型设计

### 5.1 Control Plane 新增表

建议在 `admin_console` 数据库新增一张绑定资格表：

- `client_user_steam_binding`
  - `id`
  - `user_id`
  - `steam_id`
  - `steam_account_name`
  - `first_bound_at`
  - `last_seen_at`
  - `source`
  - `status`
  - `note`

约束建议：

- `UNIQUE(user_id, steam_id)`
- 为普通版检查 `user_id` 的有效绑定数量是否超过 `1`

其中：

- `steam_id` 使用 `steam_id64`
- `steam_account_name` 仅作审计辅助，不作为唯一主键
- `status` 允许后续扩展：
  - `active`
  - `revoked`
  - `migrated`

同时需要把 control plane 的 plan 定义收口成：

- `trial`
  - 权限语义等同普通版
  - 必须带 `membership_expires_at`
  - 授予 `craft.use`
- `standard`
  - 长期普通版
  - 授予 `craft.use`
- `member`
  - 长期会员版
  - 授予 `craft.use`

若保留内部过渡态，建议新增或复用一个非销售态：

- `inactive`
  - 体验版到期后或未开通后的有效解析态
  - 不对外售卖
  - 不授予普通版权限

### 5.2 是否复用本地 `steam_account` 表

客户端本地 `steam_account` 表继续保留，用于：

- 保存用户名、密码、备注、头像、本地 token 链接
- 展示账号列表
- 关联本地库存快照

但它不再承担“会员可绑几个 Steam 账号”的最终判定职责。

最终准入边界放在 control plane。

### 5.3 授权快照新增字段

当前授权快照建议补充以下字段。

体验版示例：

```json
{
  "membership_plan": "trial",
  "permissions": [
    "accounts.read",
    "accounts.write",
    "inventory.read",
    "inventory.refresh",
    "simulation.use",
    "craft.use"
  ],
  "feature_flags": {
    "simulation_enabled": true,
    "steam_binding_mode": "single_locked",
    "steam_binding_limit": 1,
    "craft_enabled": true,
    "trial_active": true,
    "trial_expires_at": "2026-04-15T12:00:00.000Z"
  }
}
```

普通版示例：

```json
{
  "membership_plan": "standard",
  "permissions": [
    "accounts.read",
    "accounts.write",
    "inventory.read",
    "inventory.refresh",
    "simulation.use",
    "craft.use"
  ],
  "feature_flags": {
    "simulation_enabled": true,
    "steam_binding_mode": "single_locked",
    "steam_binding_limit": 1,
    "craft_enabled": true,
    "trial_active": false,
    "trial_expires_at": ""
  }
}
```

会员版示例：

```json
{
  "membership_plan": "member",
  "permissions": [
    "accounts.read",
    "accounts.write",
    "inventory.read",
    "inventory.refresh",
    "simulation.use",
    "craft.use"
  ],
  "feature_flags": {
    "simulation_enabled": true,
    "steam_binding_mode": "unlimited",
    "steam_binding_limit": -1,
    "craft_enabled": true,
    "trial_active": false,
    "trial_expires_at": ""
  }
}
```

说明：

- `membership_plan` 用于展示与大类判断
- `steam_binding_mode` 用于前端和本地 API 文案控制
- `steam_binding_limit` 用于本地预判与 UI 展示
- `craft_enabled` 用于 UI 快速收口炼金入口
- `trial_active` 与 `trial_expires_at` 用于客户端倒计时与到期提示
- 真正约束仍由服务端校验，客户端字段只用于减少无意义操作和改善提示

## 6. 核心流程设计

### 6.1 新用户注册与体验版发放

1. 用户完成客户端注册
2. control plane 创建 `client_user`
3. control plane 自动分配 `membership_plan = trial`
4. `membership_expires_at = 注册成功时间 + 7 天`
5. 返回带 `trial` 身份的授权快照
6. 客户端显示体验版剩余时间与“1 个 Steam 账号”限制
7. 客户端在体验期内允许使用炼金

### 6.2 体验版/普通版首次绑定

1. 用户在客户端输入 Steam 账号并执行 `login-save`
2. 客户端完成 Steam 登录并拿到本地 token
3. 客户端解析或补齐 `steam_id64`
4. 客户端调用 control plane 绑定资格检查/登记接口
5. control plane 确认当前 plan 为 `trial` 或 `standard`，且用户当前无绑定记录
6. control plane 写入该 `steam_id64` 为首个有效绑定
7. 客户端继续写本地 `steam_account`
8. 返回成功

### 6.3 体验版/普通版重复登录同一账号

1. 客户端识别到 `steam_id64`
2. control plane 查询到同一用户已绑定同一 `steam_id64`
3. 放行
4. 本地更新备注、头像、token、快照

### 6.4 体验版/普通版尝试换绑其他账号

1. 客户端识别到新的 `steam_id64`
2. control plane 查询到该用户已绑定其他 `steam_id64`
3. 拒绝本次绑定
4. 客户端不给写入新本地账号
5. 返回明确错误：
   - 当前体验版/普通版已绑定其他 Steam 账号
   - 删除本地账号或重装程序不会释放绑定资格
   - 如需换绑，请联系管理员

### 6.5 会员版绑定多个账号

1. 客户端识别到 `steam_id64`
2. control plane 读取用户 plan 为 `member`
3. 若此 `steam_id64` 未记录，则新增绑定历史
4. 放行写入本地账号

### 6.6 体验版到期

1. control plane 在 entitlement 解析时发现 `trial` 已过期
2. 用户有效权限降为 `inactive`
3. 客户端下次刷新授权快照时进入待开通提示
4. 已记录的首绑 `steam_id64` 不被释放
5. 用户后续购买普通版/会员版时继续沿用该绑定历史
6. 炼金入口与 API 同步禁用

### 6.7 删除本地账号

1. 用户点击删除
2. 客户端仍走本地 `/api/accounts/delete`
3. 本地移除：
   - `steam_account`
   - refresh token
   - UI snapshot
4. 不调用服务端释放绑定资格接口
5. 普通版后续仍只能登录原首绑 `steam_id64`

## 7. 接口与职责调整

### 7.1 Control Plane

建议新增接口：

- `POST /api/auth/steam-binding/check-or-bind`
  - 输入：
    - `refresh_token`
    - `device_id`
    - `steam_id`
    - `steam_account_name`
  - 输出：
    - `ok`
    - `binding_mode`
    - `binding_limit`
    - `bound_count`
    - `matched_existing`
    - `message`

职责：

- 校验当前客户端用户身份
- 按会员计划判断是否允许绑定
- 同时识别 `trial / standard / member / inactive`
- 需要时登记新的 `steam_id64`
- 返回标准化的拒绝原因

现有 `craft.use` 发放逻辑也需要同步修正：

- `trial / standard / member` 在有效期内都应返回 `craft.use`
- `inactive` 不得返回 `craft.use`

建议新增后台管理接口：

- 查询某用户当前绑定 SteamID 列表
- 人工撤销/迁移普通版绑定资格

### 7.2 Client Sidecar

`/api/accounts/login-save` 新增一段前置或中置校验：

1. Steam 登录成功
2. 尽快解析 `steam_id64`
3. 在写入本地 `AccountStore` 之前调用远端绑定校验接口
4. 只有远端放行后，才写本地账号

这样可以避免“先写本地再被拒绝”导致的脏数据残留。

### 7.3 UI

客户端 UI 需要同步调整：

- 体验版显示：
  - “新用户体验中，还可使用 7 天普通版权限”
  - “当前最多绑定 1 个 Steam 账号”
  - “体验期内可使用炼金，到期后将失效”
  - “体验到期后将进入待开通状态”
- 普通版显示：
  - “当前版本仅支持绑定 1 个 Steam 账号”
  - “已开通，可使用炼金功能”
  - 若已绑定，显示“已锁定到首个 Steam 账号”
- 会员版显示：
  - “当前版本支持绑定无限个 Steam 账号”
  - “已开通，可使用炼金功能”
- 体验版/普通版已绑定后：
  - 可选隐藏删除按钮
  - 但即使隐藏失败，也不影响最终安全边界

本轮推荐：

- 删除按钮在普通版保留或隐藏都可以
- 但文案必须明确“删除本地账号不等于换绑”

## 8. 错误处理与边界

### 8.1 首绑时拿不到 `steam_id64`

若登录成功但暂时拿不到 `steam_id64`：

- 不允许体验版或普通版直接写入绑定成功态
- 需要继续补取 profile
- 若最终无法解析 `steam_id64`，整次保存失败

因为体验版/普通版的资格边界必须依赖稳定的 Steam 身份标识，不能只靠用户名。

### 8.2 用户修改 Steam 用户名

最终绑定键必须使用 `steam_id64`，不是账号名。

这样即使 Steam 展示名、登录名、备注变更，也不会破坏绑定判断。

### 8.3 删除程序或清空本地文件

因为绑定资格在 control plane，所以：

- 本地文件丢失只会丢本地缓存
- 不会重置体验版/普通版的首绑资格

### 8.4 换机器

若未来允许用户换设备，但不允许换 Steam 账号：

- 设备绑定和 Steam 绑定应拆开看
- 同一用户可以人工迁移设备
- 但普通版 Steam 首绑资格仍不自动释放

### 8.5 体验版到期后的本地残留

若用户体验期结束，但本地仍保留旧账号、旧快照、旧 UI 状态：

- 不自动删除本地账号展示数据
- 但新授权快照不再允许继续按普通版权限工作
- 炼金功能继续保持关闭
- 绑定资格仍在服务端保留
- 购买正式版后沿用原账号与绑定历史

## 9. 非目标

- 本轮不实现完整自助换绑审批流
- 本轮不实现按次数计费或换绑额度包
- 本轮不清理所有旧 plan code，只要求业务语义统一
- 本轮不把 Steam 凭据上传到 control plane

## 10. 验收标准

以下条件同时满足，视为设计目标达成：

- 新用户注册后，自动获得 `7` 天体验版
- 体验版期间可按普通版规则绑定 `1` 个 Steam 账号
- 体验版期间可以使用炼金功能
- 体验版删除本地账号后，再绑定其他 Steam 账号仍被拒绝
- 体验版卸载重装后，体验期和首绑资格都不会重置
- 体验版到期后，自动失去炼金等会员权限且不释放首绑资格
- 普通版首次绑定 A 号后，可继续登录 A 号
- 普通版首次绑定 A 号后，登录 B 号被拒绝
- 普通版删除本地 A 号后，再登录 B 号仍被拒绝
- 普通版卸载重装后，再登录 B 号仍被拒绝
- 会员版可顺序绑定 A/B/C 多个 Steam 账号
- 客户端文案明确“删除本地账号不等于换绑”
- 后台可查询并人工处理普通版绑定资格

## 11. 实施顺序建议

### 11.1 第一阶段：服务端资格模型

- 新增 `trial` 与 `inactive` 语义
- 新增 `client_user_steam_binding`
- 新增绑定检查/登记接口
- 新增后台查询与人工重置能力
- 扩展 entitlement snapshot 的绑定限制字段
- 注册成功时自动发放 `7` 天体验版
- 调整 entitlement 解析，给有效期内的 `trial / standard / member` 发放 `craft.use`

### 11.2 第二阶段：客户端保存链路收口

- 在 `login-save` 中接入远端绑定校验
- 拒绝未通过资格校验的本地账号写入
- 优化错误提示

### 11.3 第三阶段：UI 收口

- 登录后展示体验版剩余时间与到期提示
- 会员信息展示改成“体验版 / 普通版 / 会员版”
- 删除按钮与提示文案按 plan 调整
- 仅未开通态 `inactive` 隐藏或禁用炼金入口
- 账号页增加绑定上限提示与锁定提示
