# Steam 现代化认证机制实现总结

## 项目背景

实现 CS2 炼金术工具的 Steam 自动登录功能，要求：
- 支持多账号管理
- 无需每次输入 TOTP（手机令牌）
- 支持断线重连
- 使用现代化的认证机制

## 探索过程中的关键曲折点

### 曲折点 1：废弃的 login_key 机制

**问题**：
- 最初尝试使用 ValvePython/steam 的 `login_key` 参数
- 代码：`client.login(username, login_key=refresh_token)`
- 结果：返回 `InvalidPassword` 错误

**原因分析**：
```python
# ValvePython/steam 源码
if login_key:
    message.body.login_key = login_key  # 设置的是旧字段
```

**关键发现**：
- `login_key` 是 **ClientNewLoginKey 机制**（2022年已废弃）
- 新机制使用 **IAuthenticationService** 和 **JWT tokens**
- `login_key` 字段 ≠ `access_token` 字段

**教训**：
- 不要盲目使用库的参数，要查看源码确认实现
- Steam 在 2022 年进行了重大认证机制升级

---

### 曲折点 2：混淆 refresh_token 和 access_token

**问题**：
- 首次登录使用 access_token 成功
- 后续登录尝试用 refresh_token 作为 access_token 失败

**原因分析**：

两种 token 的结构完全不同：

```json
// refresh_token（长期凭证，200天有效）
{
  "aud": ["client", "web", "renew", "derive"],  // 4个受众
  "exp": 1790720634,  // 200天后过期
  "iss": "steam"
}

// access_token（短期凭证，24小时有效）
{
  "aud": ["client", "web"],  // 只有2个受众
  "exp": 1772521266,  // 24小时后过期
  "iss": "r:0010_27C7D693_DD2BA",  // 引用 refresh_token
  "rt_exp": 1790720634  // 包含 refresh_token 的过期时间
}
```

**关键发现**：
- access_token **不能**作为 refresh_token 使用（缺少 "renew" 和 "derive" 受众）
- refresh_token **可以**直接用于 CM 登录（包含 "client" 受众）

**教训**：
- JWT token 的 `aud`（受众）字段决定了 token 的用途
- 不同类型的 token 不能互相替代

---

### 曲折点 3：GenerateAccessTokenForApp API 返回空响应

**问题**：
- 尝试用 refresh_token 调用 API 获取新的 access_token
- API 返回：`{"response": {}}`（空响应）

**原因分析**：

查阅 node-steam-session 文档发现：

> **截至 2025-04-30**，`GenerateAccessTokenForApp` 方法：
> - ✅ MobileApp 类型：可以通过 HTTPS API 调用
> - ❌ WebBrowser 类型：返回 AccessDenied
> - ❌ **SteamClient 类型：返回 AccessDenied，除非通过已认证的 CM 会话发送**

**关键发现**：
- 我们使用的是 `EAuthTokenPlatformType.SteamClient`（platform_type: "1"）
- SteamClient 类型的 token **无法通过 HTTPS API 刷新**
- 必须通过 **已认证的 CM 会话** 才能调用刷新 API

**教训**：
- 不同平台类型的 token 有不同的限制
- 官方文档很重要，要仔细阅读

---

### 曲折点 4：加密通道建立时机问题

**问题**：
- 连接 CM 服务器后立即发送 ClientLogon
- 结果：在加密握手过程中连接断开

**错误日志**：
```
SteamClient DEBUG Outgoing: <MsgProto(<EMsg.ClientLogon: 5514>)>
SteamClient DEBUG Incoming: <Msg(<EMsg.ChannelEncryptRequest: 1303>)>
SteamClient DEBUG Securing channel
SteamClient DEBUG Outgoing: <Msg(<EMsg.ChannelEncryptResponse: 1304>)>
Connection DEBUG Connection error (reader).  ← 这里断开
Connection DEBUG Disconnected.
```

**原因分析**：

正确的流程应该是：
1. TCP 连接建立
2. **等待加密通道建立**（ChannelEncryptRequest/Response 握手完成）
3. 发送 ClientLogon
4. 接收 ClientLogOnResponse

我们的代码跳过了第 2 步。

**解决方案**：
```python
# 等待加密通道建立
if not client.channel_secured:
    logger.debug("等待加密通道建立...")
    resp = client.wait_event(client.EVENT_CHANNEL_SECURED, timeout=10)
    if resp is None:
        raise ConnectionError("加密通道建立超时")
```

**教训**：
- Steam CM 协议有严格的握手顺序
- 必须等待加密通道建立后才能发送认证消息

---

### 曲折点 5：网络不稳定导致连接失败

**问题**：
- 有时连接成功，有时失败
- 失败时只能获取 2 个 CM 服务器地址（通过 DNS）
- 成功时能获取 81 个 CM 服务器地址（通过 WebAPI）

**失败日志**：
```
CMServerList ERROR WebAPI boostrap failed: Read timed out. (read timeout=3)
CMServerList DEBUG Attempting bootstrap via DNS
CMServerList DEBUG Added 2 new CM addresses.
Connection DEBUG Attempting connection to ('162.254.193.6', 27017)
SteamClient DEBUG Failed to connect. Retrying...
```

**成功日志**：
```
CMServerList DEBUG Attempting bootstrap via WebAPI
urllib3.connectionpool DEBUG https://api.steampowered.com:443 "GET /ISteamDirectory/GetCMList/v1/?cellid=0&format=json HTTP/1.1" 200 612
CMServerList DEBUG Received 81 servers from WebAPI
CMServerList DEBUG Added 81 new CM addresses.
Connection DEBUG Attempting connection to ('155.133.238.195', 27017)
Connection DEBUG Connected.
```

**解决方案**：
```python
def _connect(client: SteamClient, max_retries: int = 3) -> bool:
    """连接到 Steam CM 服务器（带重试机制）"""
    for attempt in range(max_retries):
        if attempt > 0:
            logger.info("重试连接 (%d/%d)...", attempt + 1, max_retries)
            gevent.sleep(2)  # 等待 2 秒后重试

        try:
            with gevent.Timeout(60):
                success = client.connect()
                if success:
                    return True
        except:
            pass  # 继续重试

    return False
```

**教训**：
- 网络操作必须有重试机制
- WebAPI 获取服务器列表比 DNS 更可靠（服务器数量多）

---

## 最终解决方案

### 核心发现

**refresh_token 可以直接用于 CM 登录！**

原因：
- refresh_token 的 `aud` 包含 `"client"`，满足 CM 登录要求
- refresh_token 有效期长（200天），无需频繁刷新
- 简化了登录流程，无需每次获取 access_token

### 实现流程

#### 1. 首次登录（获取 refresh_token）

```python
def login_with_totp(username: str, password: str, totp_code: str) -> SteamClient:
    # 步骤 1: 通过 HTTPS API 获取 tokens
    refresh_token, access_token = _get_tokens_via_totp(username, password, totp_code)

    # 步骤 2: 保存 refresh_token
    _save_token(username, refresh_token)

    # 步骤 3: 连接 CM
    client = SteamClient()
    client.connect()

    # 步骤 4: 等待加密通道建立
    if not client.channel_secured:
        client.wait_event(client.EVENT_CHANNEL_SECURED, timeout=10)

    # 步骤 5: 使用 access_token 登录
    _login_with_access_token(client, username, access_token)

    return client
```

#### 2. 后续登录（使用 refresh_token）

```python
def login(username: str, password: str) -> SteamClient:
    # 步骤 1: 读取 refresh_token
    refresh_token = _load_token(username)

    # 步骤 2: 连接 CM
    client = SteamClient()
    client.connect()

    # 步骤 3: 等待加密通道建立
    if not client.channel_secured:
        client.wait_event(client.EVENT_CHANNEL_SECURED, timeout=10)

    # 步骤 4: 直接使用 refresh_token 登录
    _login_with_access_token(client, username, refresh_token)

    return client
```

#### 3. 手动构造 ClientLogon 消息

```python
def _login_with_access_token(client: SteamClient, username: str, token: str) -> EResult:
    # 从 JWT 解析 SteamID
    steamid = _steamid_from_jwt(token)

    # 构造 ClientLogon 消息
    message = MsgProto(EMsg.ClientLogon)
    message.header.steamid = SteamID(int(steamid))
    message.body.protocol_version = 65580
    message.body.client_package_version = 1561159470
    message.body.client_os_type = EOSType.Windows10
    message.body.account_name = username
    message.body.access_token = token  # 可以是 access_token 或 refresh_token
    message.body.machine_id = _get_or_create_machine_id()

    # 发送消息
    client.send(message)

    # 等待响应
    resp = client.wait_msg(EMsg.ClientLogOnResponse, timeout=30)
    return EResult(resp.body.eresult)
```

### 关键技术点

1. **IAuthenticationService API 调用**
   ```python
   # 获取 RSA 公钥
   POST /IAuthenticationService/GetPasswordRSAPublicKey/v1/

   # 开始认证会话
   POST /IAuthenticationService/BeginAuthSessionViaCredentials/v1/
   {
       "account_name": username,
       "encrypted_password": base64(rsa_encrypt(password)),
       "encryption_timestamp": timestamp,
       "platform_type": 1,  # SteamClient
       "device_friendly_name": "CS2 Alchemy Tool"
   }

   # 提交 TOTP 码
   POST /IAuthenticationService/UpdateAuthSessionWithSteamGuardCode/v1/
   {
       "client_id": client_id,
       "steamid": steamid,
       "code": totp_code,
       "code_type": 3  # TOTP
   }

   # 轮询获取 tokens
   POST /IAuthenticationService/PollAuthSessionStatus/v1/
   {
       "client_id": client_id,
       "request_id": request_id
   }
   # 返回: { "refresh_token": "...", "access_token": "..." }
   ```

2. **JWT Token 解析**
   ```python
   def _steamid_from_jwt(token: str) -> str:
       # JWT 格式: header.payload.signature
       parts = token.split(".")
       if len(parts) != 3:
           return None

       # Base64 解码 payload
       payload = base64.b64decode(parts[1] + "==")
       data = json.loads(payload)

       # 提取 SteamID
       return data.get("sub")  # subject = SteamID
   ```

3. **Machine ID 生成**
   ```python
   def _get_or_create_machine_id() -> bytes:
       # MessageObject 格式
       mid = b'\x00'
       for key in [b'BB3', b'FF2', b'3B3']:
           value = base64.b16encode(os.urandom(20)).lower()
           mid += b'\x01' + key + b'\x00' + value + b'\x00'
       mid += b'\x08'
       return mid
   ```

---

## 测试结果

### ✅ 首次登录测试
```
=== 首次登录（获取 refresh_token）===
✓ 首次登录成功！
  用户名: 1822049852
  Steam ID: 76561198815742059
  已登录: True
refresh_token 已保存到 login_keys.json
```

### ✅ 自动登录测试
```
=== 自动登录（使用 refresh_token）===
✓ 自动登录成功！
  用户名: 1822049852
  Steam ID: 76561198815742059
  已登录: True
保持连接 10 秒测试稳定性...
  连接状态: True
  登录状态: True
```

### ✅ 断联重连测试
```
第一次连接：使用 refresh_token 登录
[OK] 第一次登录成功！
主动断开连接...
[OK] 已断开

第二次连接：断联后重连
[OK] 重连成功！
保持连接 10 秒测试稳定性...
  连接状态: True
  登录状态: True
[OK] 断联重连测试完成
```

---

## 与其他方案的对比

### node-steam-session（Node.js）

**他们的方案**：
- 使用 MobileApp 或 WebBrowser 平台类型
- 可以通过 HTTPS API 刷新 access_token
- 对于 SteamClient 类型，使用 node-steam-user 的 `webLogOn()` 方法

**我们的方案**：
- 使用 SteamClient 平台类型
- **直接用 refresh_token 登录 CM**，无需刷新
- 更简单，无需额外的 API 调用

### 优势

1. **简单直接**：无需复杂的 token 刷新逻辑
2. **有效期长**：200 天无需重新认证
3. **稳定可靠**：已通过多次测试验证
4. **兼容性好**：使用 ValvePython/steam 原生功能

---

## 注意事项

### 1. Token 安全
- `login_keys.json` 包含敏感信息，不要提交到版本控制
- 建议添加到 `.gitignore`

### 2. Token 有效期
- refresh_token 有效期约 200 天
- 过期后需要重新输入 TOTP
- 可以通过解析 JWT 的 `exp` 字段检查有效期

### 3. 网络稳定性
- 加密通道建立超时设置为 10 秒
- 连接超时设置为 60 秒
- 自动重试 3 次

### 4. 平台类型选择
- **SteamClient**（我们使用的）：
  - ✅ 可以直接用 refresh_token 登录 CM
  - ❌ 无法通过 HTTPS API 刷新 token
  - 适合：桌面客户端、长期连接

- **MobileApp**：
  - ✅ 可以通过 HTTPS API 刷新 token
  - ❌ 需要额外的 API 调用
  - 适合：移动应用、短期连接

- **WebBrowser**：
  - ✅ 可以通过 HTTPS API 刷新 token
  - ❌ Token 有效期可能更短
  - 适合：Web 应用

---

## 参考资料

1. **node-steam-session**
   - GitHub: https://github.com/DoctorMcKay/node-steam-session
   - 提供了 Steam 现代化认证机制的参考实现

2. **ValvePython/steam**
   - GitHub: https://github.com/ValvePython/steam
   - Python Steam 客户端库

3. **Steam IAuthenticationService API**
   - 官方认证服务 API
   - 基于 JWT tokens

4. **关键发现来源**
   - node-steam-session README（关于 SteamClient token 的限制）
   - ValvePython/steam 源码（ClientLogon 消息结构）
   - 实际测试验证（refresh_token 可以直接登录）

---

## 总结

通过这次探索，我们：

1. ✅ 理解了 Steam 现代化认证机制（IAuthenticationService + JWT）
2. ✅ 发现了 refresh_token 可以直接用于 CM 登录的关键特性
3. ✅ 解决了加密通道建立时机的问题
4. ✅ 实现了稳定的自动登录和断线重连功能
5. ✅ 添加了完善的错误处理和重试机制

**最重要的发现**：refresh_token 不仅仅是用来刷新 access_token 的，它本身就可以作为长期凭证直接用于 CM 登录！这大大简化了实现，避免了复杂的 token 刷新逻辑。
