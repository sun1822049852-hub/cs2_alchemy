# Admin Console

控制台服务现在承担两部分职责：

- 终端用户认证：邮箱验证码、注册、登录、刷新、重置密码
- 管理控制面：用户与权限、激活码、充值商品、批量授权、订单查看

## 启动

```powershell
cd admin_console
npm install
npm start
```

默认监听：

- `http://127.0.0.1:8787`
- 控制台前端：`http://127.0.0.1:8787/admin`

## 本地配置

默认读取：

- `tmp/qq-mail.local.env`

至少需要：

- QQ SMTP 发信配置
- `AUTH_SERVICE_BASE_URL`
- `CONTROL_PLANE_PRIVATE_KEY_FILE`（未配置时默认 `tmp/client_license_private.pem`）

## 初始化管理员

首次启动后可以在浏览器里直接初始化超级管理员，也可以命令行执行：

```powershell
node tools/initControlPlaneAdmin.js --password "你的控制台密码"
```

可选参数：

```powershell
node tools/initControlPlaneAdmin.js --username admin --password "你的控制台密码"
```

重复执行会重置同名管理员密码。

## 本地边界

控制台只监听本机 loopback，不提供 SSH 连接器、远端部署脚本或公网兼容路径。客户端与管理员页面都直接访问本地 `127.0.0.1:8787`。

## 测试

```powershell
cd admin_console
npm test
```

## 首版权限发放规则

当前首版不接支付接口，管理员授权与激活码兑换是会员发放来源。

默认策略：

- 新注册用户默认获得账号、库存、刷新与汰换模拟权限
- 真实炼金执行默认不开放
- `inactive` 默认不含 `craft.use`，`member` 默认包含全部当前权限
- 可通过激活码或批量授权为用户增加指定会员天数
- 如需紧急回收能力，可关闭 `craft.use` 或直接吊销设备会话
