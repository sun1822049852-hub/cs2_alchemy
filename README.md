# CS2 Alchemy (Node)

当前仓库已切换为 **Node 端主实现**，Python 旧端已移除。

## 目录说明

- `node_sidecar/`: Node 主程序（账号、库存、炼金、UI 服务）
- `main_ui_node_desktop.js`: 桌面入口（Electron）
- `main_node.js`: 兼容入口（CLI/旧调用路径）
- `run.bat`: Windows 一键启动桌面 UI

## 快速开始

1. 安装 Node.js（建议 18+）
2. 安装依赖

```powershell
cd node_sidecar
npm install
```

3. 启动桌面 UI（项目根目录）

```powershell
node main_ui_node_desktop.js
```

或双击 `run.bat`。

## 浏览器模式

```powershell
cd node_sidecar
node src/uiServer.js
```

打开 `http://127.0.0.1:8787`。

## 常用命令

```powershell
cd node_sidecar
npm run refresh -- --account <username>
npm run ui:cli
```

