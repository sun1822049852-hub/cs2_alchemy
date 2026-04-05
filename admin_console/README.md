# Admin Console

控制台服务现在承担两部分职责：

- 终端用户认证：邮箱验证码、注册、登录、刷新、重置密码
- 管理控制面：管理员登录、用户列表、会员计划、权限覆盖、设备会话吊销

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

## 测试

```powershell
cd admin_console
npm test
```
