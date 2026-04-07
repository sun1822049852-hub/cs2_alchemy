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

说明：

- 仓库根目录桌面入口默认走 `dev_auto_bundle`，便于开发时直接进入已授权工作台
- 如需验证正式登录流，可显式设置 `CLIENT_AUTH_MODE=prod_login`
- packaged 客户端仍固定走 `prod_login`，不会继承本地开发直通态
- 新注册用户默认开放账号、库存、刷新与汰换模拟
- 真实炼金执行仍需要控制台单独下发 `craft.use`

## 浏览器模式

```powershell
cd node_sidecar
node src/uiServer.js
```

打开 `http://127.0.0.1:8787`。

## 后台 admin 登录

当前版本已增加应用级管理员登录门：

- 首次打开页面时，如果还没有应用用户，会提示初始化 `admin` 超级管理员密码
- 初始化完成后，所有业务 API 都需要先登录 `admin`
- 现有 Steam 账号会从根目录下的 `accounts.json` 自动迁移到 SQLite 鉴权表中

如果想在命令行直接初始化 `admin`：

```powershell
node tools/initAdminUser.js --password "你的管理员密码"
```

## 常用命令

```powershell
cd node_sidecar
npm run refresh -- --account <username>
npm run ui:cli
```

## Windows 打包

在 Windows 上生成桌面安装包：

```powershell
cd node_sidecar
npm install
npm run pack:win
npm run build:win
```

说明：

- `pack:win` 生成 unpacked 目录，便于先做本地烟测
- `build:win` 生成 NSIS 安装包
- packaged 客户端默认使用 `prod_login`
- packaged 客户端默认连接本机 `http://127.0.0.1:8787`
- 如需改成远端认证服务，可编辑用户目录下的 `client_config.json`，写入 `control_plane_base_url`
- packaged 可写状态会落到 Electron `userData` 目录，不再写安装目录

## 皮肤库更新

项目根目录已经保存了数据库重建脚本：

- `tools/fetchAndRebuildSkinDb.js`
- `tools/rebuildSkinDb.js`
- `fetch_and_update_skin_db.bat`
- `update_skin_db.bat`

用途分成两条：

- 完整入口：先调用 SteamDT base info 接口抓取全量基础信息，保存为新的 `steam_base_info_*.json`，再重建 `csgo_skins.db`，最后自动补齐缺失的收藏品/品质、磨损区间、商品图片
- JSON 重建入口：直接把现有 `steam_base_info_*.json` 里的全量饰品数据按当前数据库格式重建到 `csgo_skins.db`，并自动过滤非枪械物品（胶囊、音乐盒、探员、Sticker Slab、裸刀等），随后继续补齐缺失的收藏品/品质、磨损区间、商品图片

脚本每次执行前会自动备份当前数据库。

说明：

- 对用户来说仍是一个重建入口
- 对代码内部来说，当前实际流程是：
  1. 自动创建或迁移 `skin` 表结构
  2. 导入 SteamDT 基础信息
  3. 通过 BUFF 补齐收藏品/品质
  4. 通过 BUFF 补齐磨损区间
  5. 通过 BUFF 补齐商品图片

三部曲命令行用法：

```powershell
node tools/fetchAndRebuildSkinDb.js --db "C:/Users/18220/Desktop/cs2_alchemy/csgo_skins.db"
```

默认会把新抓到的基础信息保存到项目根目录下自动创建的 `data/steam_base_info_时间戳.json`。

如果要指定 JSON 输出路径：

```powershell
node tools/fetchAndRebuildSkinDb.js --json "C:/你的目录/steam_base_info_manual.json" --db "C:/Users/18220/Desktop/cs2_alchemy/csgo_skins.db"
```

Windows 一键三部曲：

```powershell
.\fetch_and_update_skin_db.bat
```

如果要指定 JSON 输出路径：

```powershell
.\fetch_and_update_skin_db.bat "C:\你的目录\steam_base_info_manual.json"
```

JSON 重建命令行用法：

```powershell
node tools/rebuildSkinDb.js --json "C:/Users/18220/Desktop/smelter/data/steam_base_info_20260315_232059.json" --db "C:/Users/18220/Desktop/cs2_alchemy/csgo_skins.db"
```

Windows 一键 JSON 重建：

```powershell
.\update_skin_db.bat
```

默认直接双击或执行 `.\update_skin_db.bat` 时，会自动选 `C:\Users\18220\Desktop\smelter\data` 目录下最新的 `steam_base_info_*.json`。

如果要指定新的 JSON 文件：

```powershell
.\update_skin_db.bat "C:\你的新数据\steam_base_info_xxx.json"
```

说明：

- `tools/rebuildSkinDb.js` / `update_skin_db.bat` 只负责“后两步”，适合已经有 JSON 快照时直接重建
- `tools/fetchAndRebuildSkinDb.js` / `fetch_and_update_skin_db.bat` 负责完整“三部曲”
- 价格更新链当前没有合并进这个流程

## Schema Cache 重建

如果要从开源映射重新生成炼金用的 `schema_cache.json`，可以使用：

```powershell
node tools/rebuildSchemaCacheFromCsgoApi.js
```

默认读取：

- 如果存在已锁定的精确快照，优先使用：
  - `.tmp_upstream/3c2eb_categories`
  - `.tmp_upstream/base_weapons.3c2eb515004ba400677d898e1ef028d8a50d26d1.json`
  - `.tmp_upstream/skins.3c2eb515004ba400677d898e1ef028d8a50d26d1.json`
- 否则回退到当前 checkout：
  - `.tmp_upstream/CSGO-API/public/api/en`

默认输出到：

- `tmp/schema_cache.from_csgo_api.json`

如果要和当前仓库里的缓存做精确对账：

```powershell
node tools/rebuildSchemaCacheFromCsgoApi.js --verify .\schema_cache.json
```

如果要指定开源 API 目录或输出路径：

```powershell
node tools/rebuildSchemaCacheFromCsgoApi.js --source-dir "C:\path\to\CSGO-API\public\api\en" --out "C:\path\to\schema_cache.generated.json"
```

如果要显式指定 `base_weapons.json` 或 `skins.json` 快照：

```powershell
node tools/rebuildSchemaCacheFromCsgoApi.js --source-dir "C:\path\to\categories" --base-weapons-file "C:\path\to\base_weapons.snapshot.json" --skins-file "C:\path\to\skins.snapshot.json"
```
