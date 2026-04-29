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

## 远程连接

控制台部署在远端 ECS，本地通过 SSH 隧道访问。

双击连接（自动开浏览器，关浏览器自动断隧道）：

```powershell
tools\connectAdminConsole.cmd
```

如果你想直接在仓库根目录双击，也可以用：

```powershell
..\connect console.cmd
```

仅建隧道不开浏览器：

```powershell
tools\connectAdminConsole.cmd -NoBrowser
```

自定义本地端口：

```powershell
tools\connectAdminConsole.cmd -LocalPort 9999
```

预检（不实际连接，打印参数）：

```powershell
tools\connectAdminConsole.cmd -DryRun
```

## 远端部署加固

当前项目的安全口径是：

- `cs2-admin` 源站只绑定服务器本机 `127.0.0.1:8787 -> 8787`
- 公网 `:80` 只允许 `/api/auth/*` 和 `/api/health`
- `/admin`、`/api/admin/*`、`/api/mail/config`、`/api/dev/mail/test` 不对公网开放
- 管理员只通过 SSH 隧道访问 `http://127.0.0.1:8787/admin`

仓库内已经提供远端加固脚本和网关配置：

- `deploy/harden_remote_access.sh`
- `deploy/cs2-auth-gateway.nginx.conf`

脚本会按当前端口参数自动渲染网关配置到：

- `tmp/cs2-auth-gateway.rendered.conf`

在远端服务器同步当前仓库后执行：

```bash
cd /opt/cs2_alchemy/cs2_alchemy
sudo bash admin_console/deploy/harden_remote_access.sh
```

执行后会：

1. 重新创建 `cs2-admin`，改成仅宿主机本机可达
2. 新建 `cs2-auth-gateway` 公网网关容器
3. 先用候选本机端口做健康检查，再切换正式端口
4. 自动安装 `admin_console` 运行依赖，并让公网只保留认证业务接口，不再直接暴露后台控制面

可选环境变量：

- `APP_ROOT`：远端仓库根目录，默认 `/opt/cs2_alchemy/cs2_alchemy`
- `ENV_FILE`：控制台环境文件，默认 `$APP_ROOT/tmp/qq-mail.local.env`
- `ADMIN_HOST_PORT`：后台源站本机端口，默认 `8787`
- `PUBLIC_HOST_PORT`：公网认证网关端口，默认 `80`

最小验证命令：

```bash
curl -i http://127.0.0.1:8787/admin
curl -i http://127.0.0.1/api/health
curl -i http://8.138.39.139/admin
curl -i http://8.138.39.139/api/admin/session
curl -i http://8.138.39.139/api/auth/register/readiness
```

## 测试

```powershell
cd admin_console
npm test
```

## 首版权限发放规则

当前首版不接支付接口，控制台就是唯一授权源。

默认策略：

- 新注册用户默认获得账号、库存、刷新与汰换模拟权限
- 真实炼金执行默认不开放
- 如需开放真实炼金，请在控制台给目标用户下发 `craft.use`
- 如需紧急回收能力，可关闭 `craft.use` 或直接吊销设备会话
