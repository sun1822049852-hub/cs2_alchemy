# Memory

- 2026-04-16: `craftAssistService` 的成功返回路径带有终局磨损校验。该硬闸只作用于 `below` 模式，`infinite` 模式必须跳过，避免误伤“逼近磨损”选择。若终局校验拦截，失败结果与服务端日志都要带上 `safe_target`、`approach_mode`、`item_ids`，并展开 `selected_items` 明细，其中至少包含每件材料的 `asset_id`、`name`、`absolute_wear`、`relative_wear`。
- 2026-04-19: 仓库根目录桌面入口语义已定版。`main_ui_node_desktop.js` / `run.bat` 属于默认正式入口，默认走 `prod_login`；开发直通必须通过显式入口 `run-dev.bat` 或 `scripts/start-client-dev.ps1` 进入，避免把 `dev_auto_bundle` 混入主启动链。
- 2026-04-20: 仓库根目录只保留桌面入口，不再保留任何 CLI 兼容入口。用户正式入口固定为 `run.bat` / `main_ui_node_desktop.js`，开发入口固定为 `run-dev.bat`；如需命令行链路，必须直接使用 `node node_sidecar/src/main.js ...` 或 `node_sidecar` 内的 `npm run ...`。
- 2026-04-19: Windows packaged 客户端必须自带三份首启种子资源：`client_config.json`、`schema_cache.json`、`csgo_skins.db`。安装包首次启动时要把它们从 `resources/` 复制到 Electron `userData`，避免用户安装后因远端控制台地址或基础数据缺失而不可用。
- 2026-04-19: Windows packaged 运行时不得再直接依赖仓库根目录 `tools/`。凡是 packaged 模式需要的逻辑，必须落在 `node_sidecar/src/**` 或已纳入 `extraResources` 的稳定资源里，否则安装后会在模块解析阶段直接崩溃。
- 2026-04-19: 这台 Windows 机器上，`electron-builder` 的内置 `signAndEditExecutable` 会走 `app-builder.exe rcedit`，实际仍回落到旧版 `winCodeSign-2.6.0` 下载链，容易卡在 symlink 权限或网络超时。当前项目若只为保证安装包可构建与用户可见图标正确，应优先采用“`signAndEditExecutable: false` + packaged `app-icon.ico` + `build/installer.nsh` 重建快捷方式图标 + `BrowserWindow.icon`”的组合，而不是继续依赖内置 EXE 资源编辑。
