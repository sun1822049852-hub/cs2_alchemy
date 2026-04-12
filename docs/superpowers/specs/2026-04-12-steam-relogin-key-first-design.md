# Steam 重登 Key-First 设计稿

日期：2026-04-12  
状态：已确认，待用户审阅  
范围：Steam 账号连接/刷新链路、失效态展示、重登弹层、`loginKey` 复用与失效绕过  
关系：本设计覆盖本轮先前的“Steam Guard challenge 弹层”思路；账号重登统一改为先看 `loginKey`，缺失或失效时复用现有 `login-save` 登录拿新 key，再继续刷新。

## 1. 背景

当前项目里有两条分裂的 Steam 登录路径：

- 刷新/连接链路：优先用本地 `loginKey`，缺失时回退到 `steam-user` 的密码登录，再在运行中处理 `steamGuard`
- 添加账号链路：走现有 `login-save`，要求 `账号 + 密码 + 令牌`，目标是拿到并保存新的 `loginKey`

这会造成三个问题：

- 同样叫“重登”，底层却不是一套逻辑
- UI 不清楚何时该弹令牌、何时该弹添加账号
- `loginKey` 失效时，用户还会继续看到“未连接”，并重复试旧 key

本轮目标不是给密码回退链路补一个更华丽的 Steam Guard 弹窗，而是直接统一设计方向：

- 刷新链路只负责“用 key 连接”
- 缺 key 或 key 失效时，不再走 `steam-user` 密码直连
- 改为复用现有 `login-save` 登录，先重新拿到新 key，再回到刷新链路

## 2. 目标

- 建立单一的 Steam 重登逻辑：`key-first`
- 刷新链路默认只尝试 `loginKey`
- 当 `loginKey` 不存在或被判定失效时，统一走“重登弹层 -> login-save -> 保存新 key -> 再刷新”
- 账号进入失效态后，UI 角标显示 `登录失效`，不再显示 `未连接`
- 自动拉起的重登弹层必须锁定账号，不允许用户修改目标账号

## 3. 非目标

- 本轮不保留“刷新过程中再弹 Steam Guard challenge”的方案
- 本轮不让刷新链路直接吃 `password`
- 本轮不改客户端授权快照、会员权限、绑定规则
- 本轮不重做账号页整体视觉

## 4. 方案选择

### 4.1 方案A：保留密码回退登录，再补 UI Guard 弹层

优点：

- 保留现有刷新链路改动较少

缺点：

- 登录入口继续分裂
- 刷新链路仍然承担“认证 + 连接”双重职责
- 与当前确认方向不符

### 4.2 方案B：Key-First + 复用 login-save（推荐）

流程为：

- 先尝试本地 `loginKey`
- 若 `loginKey` 缺失或失效，则打开重登弹层
- 重登弹层复用现有 `login-save`
- 成功拿到并保存新 key 后，再重新执行刷新

优点：

- 认证职责收束到一条链路
- UI 更清楚：刷新只刷新，重登只重登
- `loginKey` 失效态可以明确定义

缺点：

- 需要重构刷新链路，不再直接用密码登录 Steam

### 4.3 结论

选择方案B。  
本轮后续设计与实现都按 `key-first` 方案推进。

## 5. 用户体验

### 5.1 正常有可用 `loginKey`

- 用户点击“连接并刷新库存”
- 系统尝试本地 `loginKey`
- 成功则直接连接并刷新
- UI 不弹任何重登弹层

### 5.2 本地没有 `loginKey`

- 用户点击“连接并刷新库存”
- 系统发现本地没有该账号的 `loginKey`
- 不再使用密码直接连 Steam
- 自动打开“重登”弹层
- 弹层展示：
  - 锁定账号
  - 密码输入
  - 令牌输入
- 用户提交后，复用现有 `login-save` 获取并保存新 key
- 拿到新 key 后关闭弹层，并自动回到刷新链路重新尝试

### 5.3 本地 `loginKey` 已失效

- 用户点击“连接并刷新库存”
- 系统尝试旧 `loginKey`，被判定为认证失效
- 当前账号状态转为 `登录失效`
- UI 角标与顶部状态显示 `登录失效`
- 下一次连接不再尝试这个旧 `loginKey`
- 直接打开重登弹层
- 账号保持锁定，不能修改
- 交互焦点默认落在 `guard` 输入框
- 若本地有保存密码，则沿用本地密码，仅要求用户补令牌
- 若本地没有保存密码，则允许用户补填密码后再提交

### 5.4 账号或密码错误

- 用户在重登弹层中提交
- 若返回 `invalid_password`
- 弹层保留打开
- 账号仍然锁定
- 密码和令牌由用户重新输入
- 状态文案提示“账号或密码错误，请重新登录”

## 6. 前端设计

### 6.1 弹层策略

不新增独立的 Steam Guard challenge 弹层。  
统一复用现有 `#accountLoginModal`，但增加一种“重登模式”。

### 6.2 重登模式行为

重登模式下：

- 标题从“添加账号”改为“重新登录”
- 账号输入框自动填入目标账号
- 账号输入框为锁定态，例如 `readOnly`
- 密码输入框优先沿用本地已保存密码；若本地没有密码则保持空白
- 令牌输入框清空
- 焦点落在 `guard` 输入框
- 提交按钮文案可改为“重新登录”

### 6.3 添加账号模式与重登模式的区别

添加账号模式：

- 用户主动点“添加账号”
- 账号可编辑
- 成功后保存该账号与 key

重登模式：

- 系统因缺 key 或 key 失效自动拉起
- 账号不可编辑
- 目标是给当前账号重新拿 key
- 成功后优先恢复该账号的刷新流程

补充规则：

- `loginKey` 缺失时，若没有本地密码，用户需要补填密码和 guard
- `loginKey` 失效时，账号仍锁定，默认焦点落在 guard

### 6.4 失效态文案

当账号处于普通断开状态时：

- 角标：`未连接`

当账号处于认证失效状态时：

- 角标：`登录失效`
- 顶部状态：`登录失效`

这两种状态必须明确区分。

## 7. 后端设计

### 7.1 刷新链路原则

刷新链路只做两件事：

- 选择目标账号
- 使用可用 `loginKey` 完成连接与刷新

刷新链路不再直接承担：

- `账号 + 密码` 直连 Steam
- 运行时 Steam Guard challenge 输入

### 7.2 `loginKey` 选择逻辑

连接前按如下顺序判断：

1. 是否存在本地 `loginKey`
2. 该账号是否被标记为 `auth_invalid`

规则：

- 无 key：直接要求重登
- 有 key 且未失效：允许尝试
- 有 key 但已失效：直接跳过，不再试

### 7.3 `auth_invalid` 标记

后端需为账号维护认证状态，至少包含：

- `normal`
- `auth_invalid`

进入 `auth_invalid` 的条件：

- 使用本地 `loginKey` 登录时，返回可明确归因为凭据失效的认证错误

进入 `auth_invalid` 后的约束：

- 后续刷新不再尝试该旧 key
- 前端显示 `登录失效`
- 直到重新登录成功后，才清除该状态

### 7.4 重登接口

不新增新的底层 Steam 登录接口。  
重登复用现有 `login-save`：

- 前端调用 `/api/accounts/login-save`
- 传入：
  - 锁定账号的 `username`
  - 用户输入的 `password`
  - 用户输入的 `totp`

该接口成功后：

- 保存新 key
- 清除 `auth_invalid`
- 返回成功状态

随后前端再重新发起 `/api/refresh`。

### 7.5 结果意义

新的统一语义应为：

- `/api/accounts/login-save`：只负责认证并拿 key
- `/api/refresh`：只负责使用 key 连接并刷新

这两条职责不能再混。

## 8. 错误语义

### 8.1 刷新链路新增或强化 reason

- `login_key_missing`
- `login_key_invalid`
- `login_required`

### 8.2 重登链路继续沿用

- `invalid_password`
- `totp_mismatch`
- `email_code_mismatch`
- `device_confirmation_required`
- `login_timeout`
- `refresh_token_missing`

### 8.3 前端动作映射

- `login_key_missing`：打开重登弹层
- `login_key_invalid`：设置 `登录失效` 状态并打开重登弹层
- `invalid_password`：重登弹层保持打开并提示错误
- `totp_mismatch`：重登弹层保持打开并提示令牌错误

## 9. 状态机

### 9.1 账号认证状态

- `normal`
- `login_required`
- `auth_invalid`

说明：

- `login_required`：没有 key
- `auth_invalid`：有过旧 key，但已失效

### 9.2 刷新流程状态

- `idle`
- `refreshing`
- `relogin_required`
- `refresh_failed`
- `refresh_succeeded`

规则：

- `relogin_required` 时，刷新按钮不再继续盲试旧 key
- 重登成功后，自动回到 `refreshing`

## 10. 真实运行态验证要求

至少验证：

- 有可用 key 时，点击刷新可直接成功
- 无 key 时，点击刷新会打开重登弹层，而不是直接连接 Steam
- key 失效时，角标显示 `登录失效`
- 进入失效态后，下次刷新会跳过旧 key
- 重登弹层里账号被锁定不可修改
- `loginKey` 失效场景下，重登弹层默认焦点落在 guard 输入框
- 重登成功后会重新刷新并恢复正常状态

## 11. 测试策略

### 11.1 单元/接口测试

至少覆盖：

- `/api/refresh` 在无 key 场景下不再走密码直连
- `/api/refresh` 在 `auth_invalid` 场景下跳过旧 key
- `/api/accounts/login-save` 成功后清除 `auth_invalid`
- `login_key_invalid` 与 `invalid_password` 被正确区分
- `login_key_invalid` 场景下的重登弹层默认聚焦 guard

### 11.2 前端状态测试

至少覆盖：

- 收到 `login_key_missing` 时自动打开重登弹层
- 收到 `login_key_invalid` 时角标切到 `登录失效`
- 自动打开的重登弹层中，账号输入框不可编辑
- `login_key_invalid` 场景下，自动打开的重登弹层焦点落在 guard 输入框
- 重登成功后自动重新发起刷新

### 11.3 真实 UI 验证

在真实桌面应用中验证：

- 正常 key 刷新
- 无 key 重登
- 失效 key 重登
- 密码错误
- 令牌错误

## 12. 验收标准

满足以下条件即视为设计达成：

- 刷新链路只认 `loginKey`
- 缺 key 或 key 失效时，不再走密码直接连接 Steam
- 重登统一复用现有 `login-save`
- `登录失效` 与 `未连接` 被明确区分
- 失效后下次登录不再尝试旧 `loginKey`
- 自动拉起的重登弹层账号不可改
- `loginKey` 失效场景下，重登弹层焦点默认落在 guard 输入框
- 重登成功后能自动回到刷新链路
