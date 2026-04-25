# Memory

- 2026-04-16: `craftAssistService` 的成功返回路径带有终局磨损校验。该硬闸只作用于 `below` 模式，`infinite` 模式必须跳过，避免误伤“逼近磨损”选择。若终局校验拦截，失败结果与服务端日志都要带上 `safe_target`、`approach_mode`、`item_ids`，并展开 `selected_items` 明细，其中至少包含每件材料的 `asset_id`、`name`、`absolute_wear`、`relative_wear`。
- 2026-04-19: 仓库根目录桌面入口语义已定版。`main_ui_node_desktop.js` / `run.bat` 属于默认正式入口，默认走 `prod_login`；开发直通必须通过显式入口 `run-dev.bat` 或 `scripts/start-client-dev.ps1` 进入，避免把 `dev_auto_bundle` 混入主启动链。
- 2026-04-25: 上述“正式入口默认 `prod_login`”规则不能覆盖 Node inspector 调试态。若 [main_ui_node_desktop.js](/C:/Users/18220/Desktop/cs2_alchemy/main_ui_node_desktop.js) 是在 `--inspect` / `--inspect-brk` 或 `NODE_OPTIONS` 含 inspect 标记的情况下启动，launcher 必须自动回到 `dev_auto_bundle`，否则本地调试会被 guest/login gate 截断，看起来像“本地账号没加载”，而实际根目录 `csgo_skins.db` / `accounts.json` 数据仍在。
- 2026-04-25: `run-dev` 下若服务端 `/api/client-auth/state` 与 `/api/accounts` 都正常，但页面仍显示“尚未保存账号”或停在空壳，先查 [node_sidecar/ui/app.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js) 启动链是否在 `loadLicenseState()` 前调用了不存在的 helper。此次真实根因是 `init()` 里残留 `initWebInvBindings()`，浏览器直接抛 `ReferenceError`，导致账号加载根本没开始；这类已删 helper 的启动引用必须有静态回归测试兜底。
- 2026-04-20: 仓库根目录只保留桌面入口，不再保留任何 CLI 兼容入口。用户正式入口固定为 `run.bat` / `main_ui_node_desktop.js`，开发入口固定为 `run-dev.bat`；如需命令行链路，必须直接使用 `node node_sidecar/src/main.js ...` 或 `node_sidecar` 内的 `npm run ...`。
- 2026-04-19: Windows packaged 客户端必须自带三份首启种子资源：`client_config.json`、`schema_cache.json`、`csgo_skins.db`。安装包首次启动时要把它们从 `resources/` 复制到 Electron `userData`，避免用户安装后因远端控制台地址或基础数据缺失而不可用。
- 2026-04-19: Windows packaged 运行时不得再直接依赖仓库根目录 `tools/`。凡是 packaged 模式需要的逻辑，必须落在 `node_sidecar/src/**` 或已纳入 `extraResources` 的稳定资源里，否则安装后会在模块解析阶段直接崩溃。
- 2026-04-19: 这台 Windows 机器上，`electron-builder` 的内置 `signAndEditExecutable` 会走 `app-builder.exe rcedit`，实际仍回落到旧版 `winCodeSign-2.6.0` 下载链，容易卡在 symlink 权限或网络超时。当前项目若只为保证安装包可构建与用户可见图标正确，应优先采用“`signAndEditExecutable: false` + packaged `app-icon.ico` + `build/installer.nsh` 重建快捷方式图标 + `BrowserWindow.icon`”的组合，而不是继续依赖内置 EXE 资源编辑。
