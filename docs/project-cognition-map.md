# 项目认知地图 pilot

一句话定位：这是一份覆盖整个 `cs2_alchemy` 项目的认知地图 pilot，适用范围包括但不限于入口、前端、API、数据、外部账号/交易、测试验证、运行态文件；它不是按钮清单、接口清单，也不是事实源。

> 使用前先记住：地图只是 navigation / hypothesis layer，用来帮助后续 AI 更快找到可能相关的链路、职责和风险。代码、测试、契约、真实运行日志、DB/缓存/队列/trace 才是真源。先读地图，再用真源核验。

## 使用规则

- 这份地图说明“可能从哪里开始看”和“哪些地方风险更高”，不替代源码阅读、测试、真实运行态验证或账号侧证据。
- 修改高风险链路前，先看地图，再回到对应源文件、测试、日志、DB、缓存或真实 trace 核验。
- 如果地图和真源冲突，以真源为准，并把地图更新为“已验证的新事实”或“待验证风险”。
- 不要从地图反推未验证结论。例如这里写“可能为空”“未看到加密”“静态已见 / 运行态未证 / 待外查”，都只能作为排查入口，不能直接写成已确认缺陷。

## 覆盖范围与未覆盖范围

- `last verified`: `2026-05-28`
- `scope/coverage`: 覆盖当前主工作区 `C:/Users/18220/Desktop/cs2_alchemy` 的静态只读扫描、已审切片结论，以及 2026-05-28 对 Skin DB 同步/C5 磨损来源链路的定向实现验证。
- `validation method`: 静态路径核对、切片整理、定向 Node 测试；未运行 UI、服务、全量测试或打包流程。
- `未覆盖`: 未检查其它 worktree；未读取真实账号、Steam session、真实 DB 内容或外部交易状态；未访问 Steam、BUFF、SteamDT、C5 等外部服务；未判断当前未提交改动是否正确。
- `其它 worktree 未检查`: `C:/Users/18220/.config/superpowers/worktrees/cs2_alchemy/feature-skin-db-sync`、`C:/Users/18220/Desktop/cs2_alchemy/.worktrees/craft-outcome-predictor`、`C:/Users/18220/Desktop/cs2_alchemy/.worktrees/skin-price-columns`。

## 快速导航总览

| 主题 | 先看哪里 | 注意 |
| --- | --- | --- |
| 桌面入口 | `main_ui_node_desktop.js` -> `node_sidecar/electron-main.js` | Electron 主进程会切到 `node_sidecar`，内嵌模式把 `uiServer` 绑到 `127.0.0.1` 随机端口。 |
| 浏览器/API 入口 | `node_sidecar/src/uiServer.js` | 客户端 UI/API 大入口；直接跑浏览器模式默认 `127.0.0.1:8787`。 |
| 前端工作台 | `node_sidecar/ui/index.html`、`node_sidecar/ui/app.js` | vanilla HTML/CSS/JS，Electron 和浏览器复用。 |
| 后台控制台 | `admin_console/src/server.js` | 独立 admin 服务，和主客户端不是同一个入口。 |
| 数据与运行态路径 | `node_sidecar/src/constants.js` | 开发态默认写项目根；打包态写 Electron `userData`，首启会 seed 核心运行态文件。 |
| 炼金/汰换 | `node_sidecar/src/uiServer.js`、`node_sidecar/src/services/craftService.js`、`node_sidecar/src/services/componentOpsService.js`、`node_sidecar/src/services/tradeupSimulationService.js` | 真实炼金和组件存取是不可逆账号动作。 |
| 外部账号/市场/交易 | `node_sidecar/src/steamWebSession.js`、`node_sidecar/src/steamMarketService.js`、`node_sidecar/src/tradeService.js`、`node_sidecar/src/proxyConfig.js` | 需要真实账号、session、网络和运行态证据补验。 |
| 测试验证 | `tests/`、`node_sidecar/tests/`、`admin_console/tests/` | 当前更像单文件脚本测试，不是统一根 `npm test`。 |
| 运行态文件 | `csgo_skins.db`、`inventory_ui_state.json`、`login_keys.json`、`logs/processed_inventory` | 这些是核心例子，不是完整清单；变脏不一定异常，需先判断是否本地程序正在写入。 |

## 核心地图条目

### 1. 项目形态与入口

- `scope/coverage`: 项目当前主链路是 Node/Electron 为主的 CS2 工具；用户可见能力包括账号登录、库存刷新、炼金/汰换辅助、产物预测、组件存取、Steam 市场/报价相关操作、桌面和浏览器 UI。Python 旧端不是当前主链路，当前主实现集中在 `node_sidecar/`。Electron 内嵌模式把 `uiServer` 绑到 `127.0.0.1` 随机端口；直接跑浏览器模式时默认 `127.0.0.1:8787`。
- `source links`: `main_ui_node_desktop.js`、`node_sidecar/electron-main.js`、`node_sidecar/src/uiServer.js`、`node_sidecar/package.json`。
- `last verified`: `2026-05-25`
- `validation method`: 静态只读扫描和关键路径存在性核对。
- `owner/maintainer`: 主客户端维护者；涉及桌面启动时同时关注 Electron 主进程和 `uiServer`。
- `update triggers`: 改启动入口、切换主技术栈、改 Electron 主进程启动逻辑、改浏览器模式入口、改 cwd 或本地端口绑定方式。
- `stale signals`: 新增主入口但地图仍指向旧入口；Python 服务重新成为主链路；`package.json` scripts 或 Electron 配置显著变化。
- `do-not-infer`: 不要因为历史 Python 文件存在就推断 Python 是当前主服务；不要因为浏览器模式可用就忽略 Electron 启动链路。
- `known risks/open questions`: Electron 桌面、浏览器模式和打包态路径可能出现行为差异，需要真实启动和打包验证。当前端口结论来自静态扫描，运行态未证。

### 2. 客户端 UI/API 汇聚点

- `scope/coverage`: `node_sidecar/src/uiServer.js` 是客户端 UI/API 大入口，覆盖 client auth、license、accounts、refresh、inventory redeem、component、craft、simulation、snapshot、trade、market、Steam Guard、settings 等路由。
- `source links`: `node_sidecar/src/uiServer.js`、`node_sidecar/electron-main.js`。
- `last verified`: `2026-05-25`
- `validation method`: 静态切片整理；未运行服务。
- `owner/maintainer`: 主客户端 API 维护者。
- `update triggers`: 新增或拆分 API 路由、改授权 gate、改 SSE、改账号/库存/炼金/市场相关接口。
- `stale signals`: 路由被拆出但地图仍说集中在 `uiServer.js`；非 public API 授权行为变化；前端不再同源 `fetch("/api/...")`。
- `do-not-infer`: 地图列出的路由覆盖不是完整 API 目录；改任何一个路由前仍要读真实路由定义和调用方。
- `known risks/open questions`: 文件职责大，单点改动可能影响多个功能区；需要用调用链和运行态证据确认实际影响。

### 3. Electron 与浏览器双模式前端

- `scope/coverage`: 前端是 Electron/浏览器两用的 vanilla HTML/CSS/JS 工作台。主页面有 6 个功能区：账号管理、库存总览、炼金汰换、汰换模拟、多账号汰换、库存管理。
- `source links`: `node_sidecar/ui/index.html`、`node_sidecar/ui/app.js`、`node_sidecar/electron-preload.js`。
- `last verified`: `2026-05-25`
- `validation method`: 静态切片整理；未做浏览器或 Electron 运行态验证。
- `owner/maintainer`: 主前端维护者。
- `update triggers`: 改主页面结构、功能区、前端状态模型、Electron preload、同源 API 调用方式。
- `stale signals`: 前端改用框架或打包器；`electron-preload.js` 开始暴露 IPC 桥；功能区数量或主导航变化。
- `do-not-infer`: 不要仅凭静态 HTML/JS 判断真实 UI 已生效；前端体验必须用浏览器或 Electron 运行态验证。
- `known risks/open questions`: `node_sidecar/ui/app.js` 约 17419 行，状态和渲染职责集中，局部改动可能产生远端副作用。

### 4. 授权、账号与库存刷新主链路

- `scope/coverage`: 授权是工作台总入口。前端先查 `/api/client-auth/state`，授权成功后才 hydrate 真实账号/库存状态；未授权进入 guest preview。未登录访问非 public API 会先被 `401` 拦住；已登录但缺权限的接口再由 `requirePermission` 返回 `403`。账号/库存主链路需要谨慎理解：初始化会先读 `/api/ui-state` 和 `/api/accounts` 获取账号与上次选择；切换账号时写 `/api/ui-state/last-selected`、读取 `/api/snapshot/account`；连接刷新时走 `/api/refresh`，SSE `/api/events` 持续回推刷新结果。
- `source links`: `node_sidecar/src/uiServer.js`、`node_sidecar/ui/app.js`、`inventory_ui_state.json`。
- `last verified`: `2026-05-25`
- `validation method`: 静态切片整理；未使用真实账号或运行态事件流验证。
- `owner/maintainer`: client auth、账号管理、库存刷新链路维护者。
- `update triggers`: 改登录/授权、last selected account、snapshot、refresh、SSE、前端缓存或重渲染逻辑。
- `stale signals`: guest preview 行为变化；`401`/`403` gate 策略变化；前端不再按该顺序 hydrate；SSE 事件名或刷新状态变化。
- `do-not-infer`: 不要把 `inventory_ui_state.json` 当作唯一真实库存；真实库存还需看 processed snapshot、DB、Steam 返回和运行日志。
- `known risks/open questions`: 授权、账号状态、SSE 刷新和 UI 缓存强相关，静态阅读无法证明刷新体验正确。

### 5. 炼金、预测、模拟与多账号汰换

- `scope/coverage`: 炼金页高风险链路包括选物品/配方队列、辅助选材 `/api/craft/assist-select`、产物预测 `/api/craft/predict-outcomes`、真实执行 `/api/craft/tradeup` 或 `/api/craft/tradeup-with-components`。真实执行返回会回写当前 UI 库存 rows。多账号汰换复用炼金 preset 和 assist/tradeup 接口，按账号切换 active account 并逐个执行。汰换模拟是非真实执行链路，使用 `/api/simulation/tradeup/*`，preset 同步到 localStorage 和 `/api/ui-state/tradeup-simulation-presets`。
- `source links`: `node_sidecar/src/uiServer.js`、`node_sidecar/ui/app.js`、`node_sidecar/src/services/craftAssistService.js`、`node_sidecar/src/services/craftService.js`、`node_sidecar/src/services/craftOutcomePredictor.js`、`node_sidecar/src/services/craftTradeupWithComponentsService.js`、`node_sidecar/src/services/tradeupSimulationService.js`、`node_sidecar/src/services/tradeupSimulationCatalog.js`、`inventory_ui_state.json`。
- `last verified`: `2026-05-25`
- `validation method`: 静态切片整理；未执行真实炼金、模拟或多账号流程。
- `owner/maintainer`: 炼金、模拟和多账号工作流维护者。
- `update triggers`: 改 craft preset、assist-select、predict-outcomes、tradeup 执行、模拟 preset、UI rows 回写、账号锁或多账号切换。
- `stale signals`: 模拟链路开始触发真实账号动作；真实执行不再回写 UI rows；preset 存储位置变化；多账号流程改为并发执行。
- `do-not-infer`: 不要把模拟接口当真实执行；也不要把预测结果当 Steam 实际产物。真实炼金是不可逆动作，必须用运行态、账号锁和日志确认。
- `known risks/open questions`: 真实执行、UI 回写、快照刷新和多账号切换之间容易出现状态错配；后续建议单独补“炼金/汰换子地图”。

### 6. 组件存取与库存快照

- `scope/coverage`: 组件存取是真实账号动作。`componentOpsService` 对 storage unit 执行 deposit/withdraw，带账号锁、容量检查、规则过滤，完成后合并旧快照并落新快照。库存筛选/排序/分组主要是前端内存状态和渲染缓存，依赖 `state.rows` 和 component summary。
- `source links`: `node_sidecar/src/services/componentOpsService.js`、`node_sidecar/src/services/componentSummary.js`、`node_sidecar/src/services/componentTaskQueue.js`、`node_sidecar/src/componentLoader.js`、`node_sidecar/src/uiServer.js`、`node_sidecar/ui/app.js`、`logs/processed_inventory`、`inventory_ui_state.json`。
- `last verified`: `2026-05-25`
- `validation method`: 静态切片整理；未读取真实 storage unit 或 processed snapshot 内容。
- `owner/maintainer`: 组件管理和库存快照维护者。
- `update triggers`: 改 deposit/withdraw、storage unit 容量规则、component summary、snapshot 合并、前端筛选/排序/分组。
- `stale signals`: 快照格式变化；component summary 字段变化；前端不再依赖 `state.rows`；组件操作不再合并旧快照。
- `do-not-infer`: 不要从 UI rows 直接推断真实 Steam 库存；需要核验 processed snapshot、DB stamp、mtime 和真实刷新日志。
- `known risks/open questions`: 组件操作和库存快照同时涉及真实账号动作与本地缓存，失败恢复和快照合并需要运行态补验。

### 7. 本地数据、凭据与运行态文件

- `scope/coverage`: 运行态核心文件包括 `csgo_skins.db`、`inventory_ui_state.json`、`login_keys.json`、`logs/processed_inventory`。这只是核心例子，不是完整清单；`accounts.json`、`machine_id.bin`、`client_config.json`、`client_license_state.json`、`schema_cache.json` 等运行态文件也需要按任务核对。账号/权限/Steam 账号数据共用 SQLite；`steam_account.password` 有明文字段，应用登录密码是 hash，session token 存 hash。Steam refresh token 当前实现写 `login_keys.json`，静态扫描结论是直接 JSON 读写，未读取真实文件内容。Steam API key 的代码约定路径是 `node_sidecar/data/steam_api_key.enc`；Windows 下用 DPAPI，非 Windows 回退明文。开发态可写运行态文件写项目根；打包态写 Electron `userData`，打包首启会从打包资源 seed `client_config.json`、`schema_cache.json`、`csgo_skins.db` 到 `userData`。
- `source links`: `node_sidecar/src/constants.js`、`node_sidecar/src/accountStore.js`、`node_sidecar/src/authService.js`、`node_sidecar/src/licenseStore.js`、`node_sidecar/src/snapshotStore.js`、`node_sidecar/src/steamApiKeyStore.js`、`node_sidecar/src/secretStore.js`、`csgo_skins.db`、`inventory_ui_state.json`、`login_keys.json`、`.gitignore`。
- `last verified`: `2026-05-25`
- `validation method`: 静态切片整理；未读取真实 DB 内容或真实凭据文件内容。
- `owner/maintainer`: 数据持久化、账号安全和运行态路径维护者。
- `update triggers`: 改运行态路径、账号表、登录凭据存储、token 存储、DPAPI 策略、`.gitignore`、打包 userData 迁移。
- `stale signals`: 运行态文件位置变化；`login_keys.json` 加密策略变化；SQLite schema 迁移；打包态和开发态路径不一致。
- `do-not-infer`: 不要把静态扫描的“未看到加密”写成已确认安全漏洞；需要看实际实现、文件内容、平台分支和运行态行为。
- `known risks/open questions`: 凭据、session、DB 和运行态文件是高风险区；任何改动都需要明确备份、回滚和安全验证。以上属于静态已见，真实文件内容和平台分支行为运行态未证。

### 8. 皮肤基础库、同步与快照缓存

- `scope/coverage`: 皮肤基础库 `skin` 表由 `skinDbSync` 创建/迁移/重建。同步会 upsert，并删除不在新目标集合里的旧 `skin` 记录；空目标会 `DELETE FROM skin`。后续同步的磨损范围会优先走 C5 页面和 range API，C5 失败、不完整或页面结构不符合预期时再由 BUFF 兜底；已有旧磨损会在同步时尝试刷新，但 provider 失败时旧值应保留。炼金辅助/预测/模拟主要读库存快照和 `skin` DB；`snapshotRowsLoader` 用文件 mtime + DB stamp 做缓存失效。
- `source links`: `node_sidecar/src/skinDbSync.js`、`node_sidecar/src/skinMetaStore.js`、`node_sidecar/src/services/snapshotRowsLoader.js`、`node_sidecar/src/services/skinDetailEnrichmentService.js`、`node_sidecar/src/services/c5SkinDetailProvider.js`、`node_sidecar/src/services/buffSkinDetailProvider.js`、`node_sidecar/src/services/steamdtBaseInfoProvider.js`、`node_sidecar/src/services/steamCdnSkinImageProvider.js`、`tests/c5SkinDetailProvider.test.js`、`tests/steamFirstSkinDetailProvider.test.js`、`tests/skinDetailEnrichmentService.test.js`、`tests/skinDbSync.test.js`、`csgo_skins.db`。
- `last verified`: `2026-05-28`
- `validation method`: 静态切片整理；运行 `node tests/c5SkinDetailProvider.test.js`、`node tests/steamFirstSkinDetailProvider.test.js`、`node tests/skinDetailEnrichmentService.test.js`、`node tests/skinDbSync.test.js`；未运行真实全库同步或写真实 DB。
- `owner/maintainer`: 皮肤库同步、快照缓存和炼金数据基础维护者。
- `update triggers`: 改 `skin` 表 schema、同步目标集合、删除策略、缓存失效条件、mtime/DB stamp 逻辑。
- `stale signals`: 同步不再删除旧记录；空目标保护逻辑变化；缓存不再看 mtime 或 DB stamp；炼金预测数据源变化；C5/BUFF 磨损优先级、C5 页面结构、range API 路径或失败兜底策略变化。
- `do-not-infer`: 不要仅凭 DB 文件存在判断数据完整；同步目标为空时的删除行为必须特别核验。不要把 C5 dry-run 或 mock 测试当成真实线上长期可用性证明。
- `known risks/open questions`: 空目标导致清空 `skin` 表是高风险维护点；C5 是在线依赖，页面结构、风控、错误页和 range API 空数据都可能导致兜底或失败；后续建议补“skin DB 同步子地图”。

### 9. 外部 Steam/Web/市场链路

- `scope/coverage`: 外部数据源/API 包括 Steam auth/session/GC/community market、Steam Web inventory、Steam Web API bans/trade token、BUFF detail、C5 sell page/range API、SteamDT base info、Steam CDN image。C5 磨损链路读取 C5 sell page 的 `window.__NUXT__` / `relatedList`，再访问 `api.c5game.com/search/v2/item/{itemId}/wear/range`；只把五个磨损档当作磨损来源，普通版/暗金/StatTrak/纪念品/Souvenir 不算磨损档。Web 库存使用 `steamcommunity.com/inventory/<steamid>/730/2`，分页最多 20 页，支持代理，cookie 会脱敏摘要记录。
- `source links`: `node_sidecar/src/steamWebSession.js`、`node_sidecar/src/steamHttpClient.js`、`node_sidecar/src/steamMarketService.js`、`node_sidecar/src/tradeService.js`、`node_sidecar/src/inventoryService.js`、`node_sidecar/src/inventoryParser.js`、`node_sidecar/src/steamAccountTools.js`、`node_sidecar/src/steamApiKeyStore.js`、`node_sidecar/src/secretStore.js`、`node_sidecar/src/proxyConfig.js`、`node_sidecar/src/services/c5SkinDetailProvider.js`、`node_sidecar/src/services/buffSkinDetailProvider.js`、`node_sidecar/src/services/steamdtBaseInfoProvider.js`、`node_sidecar/src/services/steamCdnSkinImageProvider.js`。
- `last verified`: `2026-05-28`
- `validation method`: 静态切片整理和 C5 provider mock 测试；未访问外部网络或真实账号。
- `owner/maintainer`: Steam 集成、市场交易和代理配置维护者。
- `update triggers`: 改 Steam session、GC refresh、Web inventory、market sell、confirmation、trade offer、代理策略、外部价格源、C5 页面解析、C5 range API、C5/BUFF 磨损兜底顺序。
- `stale signals`: C5 页面不再提供 `window.__NUXT__` / `relatedList`；C5 range API 路径或返回结构变化；代理配置从 `proxyConfig.js` 读取方式迁移；Steam API 响应格式变化；分页或 cookie 记录策略变化。
- `do-not-infer`: 不要用静态扫描确认 Steam 链路可用；外部接口需要真实网络、账号权限、代理和日志证据。
- `known risks/open questions`: 当前主工作区未见根目录 `config.py`；代理配置读取代码见 `node_sidecar/src/proxyConfig.js`，但代理实际来源仍需运行态确认。外部接口属于静态已见，运行态未证，网络策略、风控和服务可用性待外查。

### 10. Web 库存、交易报价与市场确认

- `scope/coverage`: Web 库存/市场/交易页高风险接口包括 `/api/accounts/:username/inventory`、`/api/accounts/send-trade-offer`、`/api/market/batch-sell`、`/api/market/confirmations`、`/api/market/confirm-listings`，涉及 Steam web session、交易报价、市场上架确认。主 Web 库存页走 `/api/accounts/:username/inventory`；另一个库存弹窗走 `/api/snapshot/account?source=web_inventory&save_stub=1`。`/api/market/confirmations` 偏确认列表读取，`/api/market/confirm-listings` 偏执行确认。
- `source links`: `node_sidecar/src/uiServer.js`、`node_sidecar/ui/app.js`、`node_sidecar/src/tradeService.js`、`node_sidecar/src/steamMarketService.js`、`node_sidecar/src/steamWebSession.js`、`node_sidecar/src/steamHttpClient.js`。
- `last verified`: `2026-05-25`
- `validation method`: 静态切片整理；未访问真实 Steam Web session、报价或市场确认。
- `owner/maintainer`: Web 库存、交易和市场功能维护者。
- `update triggers`: 改报价发送、批量上架、确认逻辑、Steam Guard、Web session 续期、前端账号选择。
- `stale signals`: 接口路径变化；市场确认方式变化；Steam Guard 处理方式变化；前端账号列表来源变化。
- `do-not-infer`: 不要在未运行真实环境前确认交易/市场动作安全；这类动作可能真实影响账号和资产。
- `known risks/open questions`: Web 库存页使用 `state.savedAccounts`，但静态扫描未找到赋值点，可能导致该页面账号列表为空；这只是待运行态验证风险，不是已确认 bug。

### 11. Admin Console

- `scope/coverage`: `admin_console/` 是独立后台控制台，入口 `admin_console/src/server.js`，独立进程服务 `/admin` 静态 UI 和 `/api/admin/*`、`/api/auth/*`，默认 loopback `127.0.0.1:8787`。
- `source links`: `admin_console/src/server.js`、`admin_console/package.json`、`admin_console/tests/`。
- `last verified`: `2026-05-25`
- `validation method`: 静态切片整理；未启动 admin 服务或运行 admin 测试。
- `owner/maintainer`: 后台控制台维护者。
- `update triggers`: 改 admin 登录、权限、管理接口、静态 UI、后台测试脚本。
- `stale signals`: admin 合并进主 `uiServer`；路由前缀变化；测试入口变化。
- `do-not-infer`: 不要把 admin 控制台行为自动套到主客户端；它是独立入口。
- `known risks/open questions`: 需要单独确认 admin 的鉴权、配置和部署边界。默认端口结论来自静态扫描，运行态未证。

### 12. 测试、验证与打包

- `scope/coverage`: 测试主力是 Node 脚本测试，不是统一根 `npm test`。根目录无 `package.json`；`node_sidecar/package.json` 没有 `test` script；`node_sidecar/README.md` 推荐逐个 `node tests/*.test.js`；`admin_console/package.json` 有 `npm test`。静态统计有 `tests/` 75 个、`node_sidecar/tests/` 99 个、`admin_console/tests/` 8 个，共 182 个 `.js` 测试文件。打包配置在 `node_sidecar/electron-builder.yml`；当前主工作区项目自身主链路未见 `.github/workflows`，不代表其它 worktree 或第三方目录。
- `source links`: `tests/`、`node_sidecar/tests/`、`admin_console/tests/`、`node_sidecar/README.md`、`node_sidecar/package.json`、`admin_console/package.json`、`node_sidecar/electron-builder.yml`。
- `last verified`: `2026-05-25`
- `validation method`: 静态切片整理；未运行任何测试、服务、UI 或打包流程。
- `owner/maintainer`: 各功能测试维护者；打包由桌面发布链路维护者负责。
- `update triggers`: 新增统一测试入口、改测试目录、改 Electron 打包配置、引入 CI、改真实账号/网络验证策略。
- `stale signals`: 根目录出现 `package.json`；`node_sidecar/package.json` 增加 `test`；当前主工作区主链路出现 `.github/workflows`；测试从脚本式迁移到统一 runner。
- `do-not-infer`: 测试文件数量不等于覆盖充分；静态断言不能替代 UI/Steam/打包运行态验证。
- `known risks/open questions`: 登录、库存刷新、Steam Web/GC、交易/市场、Steam Guard、代理、打包首启、Electron `userData` 状态都需要真实运行态或真实网络补验。

## 高风险链路优先级

后续如果继续细化子地图，建议按风险和误读概率优先补这些：

1. 炼金/汰换真实执行子地图：覆盖 preset、assist、predict、tradeup、账号锁、UI rows 回写、快照落盘和失败恢复。
2. Steam Web/交易/市场子地图：覆盖 Web session、报价、批量上架、确认、Steam Guard、代理和真实账号风险。
3. 账号授权与库存刷新子地图：覆盖 client auth、license、账号选择、snapshot、refresh、SSE、guest preview。
4. 本地数据与凭据子地图：覆盖 `csgo_skins.db`、`inventory_ui_state.json`、`login_keys.json`、DPAPI、运行态路径和打包态迁移。
5. Skin DB 同步子地图：覆盖 `skin` 表同步、空目标删除、缓存失效、炼金预测依赖。

## 更新触发和 stale signals 总表

| 类型 | 需要更新地图的触发 | 地图可能过期的信号 |
| --- | --- | --- |
| 入口/运行方式 | 启动脚本、Electron 主进程、浏览器模式、cwd、端口绑定变化 | 用户实际启动路径和地图不一致 |
| 前端/UI | 主页面结构、功能区、状态模型、preload、同源 fetch 变化 | UI 已改版但地图仍描述旧功能区 |
| API/授权 | 路由拆分、401 gate、client auth、license、SSE 变化 | 非 public API 行为和地图不一致 |
| 数据/运行态 | DB schema、运行态路径、凭据存储、`.gitignore`、打包 userData 变化 | 开发态和打包态读写位置变化 |
| 外部账号/交易 | Steam session、GC、Web inventory、trade offer、market confirmation、代理变化 | 真实运行日志显示外部 API 链路不同 |
| 测试/验证 | 新增统一 test script、CI、打包验证、真实账号验证流程 | 仍按单文件脚本理解测试体系 |
| 文档自身 | 真源证据推翻地图、子地图新增、风险已关闭或升级 | 地图的 `last verified` 太旧，或没有记录验证方法 |

## 待验证问题

- Web 库存页使用 `state.savedAccounts`，静态扫描未找到赋值点；可能导致该页面账号列表为空。需要浏览器/Electron 运行态验证，不应直接定性为 bug。
- `login_keys.json` 当前实现是直接 JSON 读写；这是静态扫描结论，未读取真实文件内容，需要结合实际平台分支、真实文件写入和安全设计确认。
- 根目录 `config.py` 扫描时未发现；代理实际来源需要在运行环境中确认。
- 打包态 `userData` 路径、seed `client_config.json`、`schema_cache.json`、`csgo_skins.db` 和首次启动状态需要真实打包验证。
- C5 当前已接入在线页面和 range API 作为磨损优先来源；真实网络可用性、风控页面、错误页和长期返回结构仍需后续运行态验证。
- 当前工作区有未提交改动和未跟踪文件，本地图不判断其正确性；修改前应按具体任务重新看对应 diff。

## 维护原则

- 小改动只更新直接相关条目，不强行扩成全项目重写。
- 新链路稳定后再补图；旧链路在被修改、复盘、风险暴露或进入主链路时逐步补图。
- 核心条目每次更新至少写清 `scope/coverage`、`source links`、`last verified`、`validation method`、`owner/maintainer`、`update triggers`、`stale signals`、`do-not-infer`、`known risks/open questions`。
- 地图只负责导航和假设；结论必须回到真源核验。
