# Node Sidecar

`node_sidecar/` 是当前仓库的 Node 主实现，负责账号登录、库存刷新、组件存取、炼金配方编辑、辅助选材、产物预测，以及桌面 / 浏览器 UI 启动。

## 功能概览

- 账号加载与 token 复用：读取 `accounts.json`、`login_keys.json`
- Steam + CS2 GC 连接与库存快照导出
- 组件物品存入 / 取出与任务队列同步
- 炼金配方编辑、辅助选材、组件取料联动
- 产物 predictor drawer、离线草稿上下文、配方锁定与 busy mask
- Browser UI、CLI UI、Electron desktop UI 三种入口

## 目录结构

```text
node_sidecar/
├─ src/                  核心服务、CLI、刷新流程、状态存储
├─ ui/                   前端页面、样式、交互脚本
├─ tests/                前端与路由层的 Node 回归测试
├─ electron-main.js      Electron 主进程入口
├─ electron-preload.js   Electron preload
├─ package.json          Node/Electron 依赖与脚本
└─ README.md             当前模块说明
```

## 安装

在 `node_sidecar/` 目录执行：

```powershell
npm install
```

## 常用命令

刷新指定账号库存：

```powershell
npm run refresh -- --account <username>
```

兑换武库奖励（缺省字段可由 live GC 状态自动补齐）：

```powershell
node src/main.js redeem-mission-reward --account <username> --ack-tracks true
node src/main.js redeem-mission-reward --account <username> --redeem-id 0 --ack-tracks true
```

启动浏览器模式 UI：

```powershell
npm run ui
```

启动桌面版 UI：

```powershell
npm run ui:desktop
```

说明：

- 仓库根目录的 `main_ui_node_desktop.js` / `run.bat` 现在默认按正式入口启动，默认 `prod_login`
- 如需显式走开发直通 `dev_auto_bundle`，请使用仓库根目录 `run-dev.bat`，或执行 `powershell -ExecutionPolicy Bypass -File .\scripts\start-client-dev.ps1`
- `npm run ui:desktop` 仍是直接调 Electron 的底层开发入口；若要复现正式登录链，请显式设置 `CLIENT_AUTH_MODE=prod_login`

release / 安装包说明：

- packaged 客户端默认走 `prod_login`
- release 配置不内置 control plane 地址
- packaged 首次启动时，会把 `client_config.json`、`schema_cache.json`、`csgo_skins.db` 从安装包资源复制到 Electron `userData` 目录
- 当前版本只连接本机 control plane，不保留远端服务兼容路径

示例：

```json
{
  "control_plane_base_url": "http://127.0.0.1:8787"
}
```

从仓库根目录一键启动开发直通模式：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-client-dev.ps1
```

如需覆盖开发身份或会员档位：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-client-dev.ps1 `
  -Username dev_local `
  -Plan member `
  -TtlMinutes 43200
```

启动 CLI 菜单：

```powershell
npm run ui:cli
```

账号管理：

```powershell
node src/main.js accounts list
node src/main.js accounts use --account <username>
node src/main.js accounts delete --account <username>
node src/main.js tokens clear --account <username>
```

Browser / desktop UI 若需正式触发武库兑换，可调用：

```http
POST /api/inventory/redeem-mission-reward
Content-Type: application/json

{
  "username": "your_account",
  "redeem_id": 0,
  "ack_tracks": true
}
```

说明：

- 当前账号必须已连接并完成一次库存刷新
- `campaign_id`、`redeemable_balance`、`expected_cost` 缺省时会优先从当前会话缓存的武库状态自动补齐
- 返回结果会带上 `resolved`、`success_evidence`、`armory_state_before`、`armory_state_after`

正式兑换前，如需先读取当前账号可选的武库兑换项，可调用：

```http
GET /api/inventory/redeem-mission-reward/options?username=your_account
```

说明：

- 返回结果会带上当前 `redeemable_balance`
- `options` 中每项会包含 `campaign_id`、`redeem_id`、`expected_cost`、`balance_after_redeem`、`affordable`
- 若直接调用兑换接口但当前存在多个候选项，`409` 响应也会带回同样的 `options` 供选择

## 炼金 UI 说明

当前炼金页由 `ui/app.js` + `ui/styles.css` 驱动，重点能力包括：

- 右侧配方队列与当前编辑配方自动联动
- 左侧辅助选材面板与 predictor drawer 并行工作
- 组件取 / 存时复用左侧 blur busy mask，并锁定配方编辑
- 离线状态下仍保留当前草稿与 predictor context
- 配方槽位支持图片、磨损覆盖层、卡片删除与锁定规则

## 测试

`node_sidecar/tests/` 下的测试默认都是可直接执行的 Node 脚本，适合做快速回归。常用命令：

```powershell
node tests/craft-assist-busy-mask-render.test.js
node tests/craft-predictor-panel-state.test.js
node tests/craft-predictor-offline-render.test.js
node tests/craft-queue-slot-remove-guard.test.js
node tests/redeem-mission-reward.test.js
node tests/cs2-session-gc-trace.test.js
node tests/weapon-armory-service.test.js
node tests/weapon-armory-route.test.js
```

如果要在仓库根目录执行跨模块回归，可运行：

```powershell
node tests/craftOutcomePredictor.test.js
node tests/craftPredictorDrawerUi.test.js
```

## 运行产物

- 库存快照：`logs/processed_inventory/*.json`
- UI 入口服务：`src/uiServer.js`
- Electron 入口：`electron-main.js`

## 备注

- 当前模块不依赖 Python Steam 库
- 若要从项目根目录启动桌面 UI，可使用仓库根下的 `main_ui_node_desktop.js` 或 `run.bat`

## VPK 开发工具

当前仓库内已内置一个面向开发调试的 VPK CLI，适合直接列目录、读取资源、抽取文件，不再依赖系统外部 `vpk.exe`。

先在 `node_sidecar/` 目录安装依赖：

```powershell
npm install
```

常用命令：

```powershell
npm run vpk:list -- --file "D:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive\game\csgo\pak01_dir.vpk" --pattern xpshop
npm run vpk:cat -- --file "D:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive\game\csgo\pak01_dir.vpk" --entry "panorama/layout/xpshop.vxml_c" --encoding hex
npm run vpk:extract -- --file "D:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive\game\csgo\pak01_dir.vpk" --entry "panorama/scripts/xpshop.vts_c" --output ".\\tmp\\xpshop.vts_c"
```

说明：

- 支持 CS2 常见的 split VPK 结构，例如 `pak01_dir.vpk` 搭配 `pak01_000.vpk`
- `vpk:list` 可配合 `--pattern`、`--limit` 快速筛路径
- `vpk:cat` 支持 `utf8`、`hex`、`base64`
- `vpk:extract` 会自动创建输出目录
