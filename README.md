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

## 皮肤库更新

项目根目录已经保存了数据库重建脚本：

- `tools/rebuildSkinDb.js`
- `update_skin_db.bat`

用途：把 `steam_base_info_*.json` 里的全量饰品数据按当前数据库格式重建到 `csgo_skins.db`，并自动过滤非枪械物品（胶囊、音乐盒、探员、Sticker Slab、裸刀等）。

脚本每次执行前会自动备份当前数据库。

命令行用法：

```powershell
node tools/rebuildSkinDb.js --json "C:/Users/18220/Desktop/smelter/data/steam_base_info_20260315_232059.json" --db "C:/Users/18220/Desktop/cs2_alchemy/csgo_skins.db"
```

Windows 一键用法：

```powershell
.\update_skin_db.bat
```

默认直接双击或执行 `.\update_skin_db.bat` 时，会自动选 `C:\Users\18220\Desktop\smelter\data` 目录下最新的 `steam_base_info_*.json`。

如果要指定新的 JSON 文件：

```powershell
.\update_skin_db.bat "C:\你的新数据\steam_base_info_xxx.json"
```
