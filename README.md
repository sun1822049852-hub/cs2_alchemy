# CS2 炼金自动化工具

基于 Steam GC 协议的 CS2（Counter-Strike 2）物品炼金自动化工具。

## 功能特性

- **多账号管理**: 支持多个 Steam 账号的存储、切换和管理
- **免密登录**: 使用 refresh_token 缓存机制，初始化后无需重复输入密码和令牌
- **WebSocket CM**: 使用 WebSocket 连接 Steam CM 服务器（香港节点），适合中国大陆网络环境
- **完整库存读取**: 从 SO Cache 读取完整物品信息（磨损值、稀有度、皮肤等）
- **炼金框架**: 实现了完整的 GC 炼金协议（Craft Request/Response）

## 项目结构

```
cs2_alchemy/
├── main.py              # 主程序入口，交互式菜单
├── auth.py              # Steam 认证模块（HTTPS API + WebSocket CM）
├── client.py            # CS2 GC 客户端封装
├── account_manager.py   # 账号管理模块
├── inventory.py         # 库存读取和解析
├── schema.py            # 物品 Schema 加载（从 GitHub API）
├── craft.py             # 炼金执行器
├── proto_messages.py    # GC Craft 协议消息定义
├── ws_connection.py     # WebSocket CM 连接实现
└── requirements.txt     # Python 依赖
```

## 核心模块说明

### 1. 认证系统 (auth.py)

使用 Steam 新版 IAuthenticationService API：
- **首次登录**: 账号密码 + TOTP → 获取 refresh_token → 保存缓存
- **后续登录**: 直接用 refresh_token 登录 CM
- **连接方式**: WebSocket CM（wss://162.254.197.42:443）

关键函数：
- `login(username, password)`: 使用缓存的 token 免密登录
- `login_with_totp(username, password, totp_code)`: TOTP 初始化登录

### 2. CS2 客户端 (client.py)

封装 Steam 和 CSGO 客户端，实现：
- **GC 连接**: 自动处理 Hello 消息升级序列（EMsgGCClientHello → R2 → R3 → R4）
- **错误处理**: 自动处理 ClientLogonFatalError (errorcode=4) 并升级协议
- **SO Cache**: 等待 GC 推送完整库存数据

### 3. 物品系统

**Schema 加载 (schema.py)**:
- 从 GitHub ByMykel/CSGO-API 获取武器和皮肤数据
- 缓存到本地 `schema_cache.json`
- 提供 def_index → 武器名、paint_index → 皮肤名映射

**库存管理 (inventory.py)**:
- 从 SO Cache 读取 CSOEconItem
- 解析物品属性（磨损值、图案种子、稀有度等）
- 结合 Schema 填充可读名称

### 4. 炼金执行器 (craft.py)

实现 GC 炼金协议：
- **消息 ID**: 1002 (Craft Request), 1003 (Craft Response)
- **请求参数**: recipe_id (配方 ID), asset_ids (10 件材料)
- **响应数据**: 新物品的 asset_id 列表

### 5. GC 协议消息 (proto_messages.py)

基于 SteamDatabase/Protobufs 的 econ_gcmessages.proto：

```python
class CMsgGCCraft:
    recipe: int32          # 配方 ID
    items: repeated uint64 # 材料 asset_id 列表

class CMsgGCCraftResponse:
    recipe_def_index: int32      # 使用的配方 ID
    item_ids: repeated uint64    # 新物品 asset_id 列表
```

### 6. WebSocket 连接 (ws_connection.py)

实现 Steam CM 的 WebSocket 传输层：
- **协议**: wss:// (TLS over WebSocket)
- **端口**: 443（可绕过防火墙）
- **帧格式**: 标准 WebSocket binary frame
- **服务器**: 香港/新加坡 CM 节点

## 安装和使用

### 1. 安装依赖

```bash
python -m venv .venv
.venv\Scripts\activate  # Windows
pip install -r requirements.txt
```

### 2. 运行程序

```bash
python main.py
```

### 3. 首次使用

1. 选择 "账号管理" → "新增账号"
2. 输入 Steam 用户名和密码
3. 输入手机令牌验证码（5 位数字）
4. 初始化成功后，refresh_token 会保存到 `login_key_cache.json`
5. 后续登录无需再输入密码和令牌

### 4. 进入炼金程序

1. 主菜单选择 "进入炼金程序"
2. 程序会自动连接 Steam CM 和 CS2 GC
3. 读取并显示完整库存信息

## 技术细节

### GC 协议版本

CS2 使用 cstrike15_v2 协议，消息 ID 范围：
- **Base**: 9100
- **Craft**: 1002 (econ_gcmessages)
- **Hello 序列**: 4006 → 4013 → 4014 → 4015

### SO Cache 结构

物品数据存储在 `CSOEconItem` 中：
- `id`: asset_id（物品唯一实例 ID）
- `def_index`: 物品类型 ID（武器种类）
- `quality`: 品质（4=Normal, 9=StatTrak™）
- `rarity`: 稀有度（1~7）
- `attribute`: 属性列表
  - `def_index=6`: paint_index（皮肤 ID）
  - `def_index=7`: paint_seed（图案种子）
  - `def_index=8`: float_value（磨损值）

### WebSocket CM 握手

```http
GET /cmsocket/ HTTP/1.1
Host: 162.254.197.42
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13

HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
```

## 注意事项

1. **网络环境**: 建议使用稳定的网络连接，WebSocket CM 对网络质量要求较高
2. **账号安全**: refresh_token 等同于登录凭证，请妥善保管 `login_key_cache.json`
3. **GC 限流**: 频繁操作可能触发 GC 限流，建议合理控制请求频率
4. **炼金配方**: 配方 ID 需要根据物品的 (quality, rarity) 组合映射，具体映射关系需要逆向分析

## 依赖库

- `steam[client]`: Steam CM 协议客户端
- `csgo`: CS2 GC 协议封装
- `pyotp`: TOTP 双因素认证
- `requests`: HTTP 请求（用于 Schema 加载）
- `gevent`: 协程库（用于异步 I/O）

## 参考资料

- [SteamDatabase/Protobufs](https://github.com/SteamDatabase/Protobufs): Steam 协议 Protobuf 定义
- [ValvePython/steam](https://github.com/ValvePython/steam): Steam CM 客户端库
- [ValvePython/csgo](https://github.com/ValvePython/csgo): CS2 GC 客户端库
- [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API): CS2 物品数据 API

## 许可证

本项目仅供学习和研究使用，请勿用于商业用途或违反 Steam 服务条款的行为。
