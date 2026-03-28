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

启动浏览器模式 UI：

```powershell
npm run ui
```

启动桌面版 UI：

```powershell
npm run ui:desktop
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
