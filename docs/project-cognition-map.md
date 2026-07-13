# 项目认知地图

一句话定位：这是一份覆盖整个 `cs2_alchemy` 项目的认知地图，适用范围包括但不限于入口、前端、API、数据、外部账号/交易、测试验证、运行态文件；它不是按钮清单、接口清单，也不是事实源。

状态说明：该地图已在 2026-06-06 由 pilot 转为稳定维护；“稳定”只表示维护阶段，不是 `verified` / `complete` 信任声明。地图仍只是 navigation / hypothesis layer，不表示本次重新验证了全部代码行为。

> 使用前先记住：地图只是 navigation / hypothesis layer，用来帮助后续 AI 更快找到可能相关的链路、职责和风险。代码、测试、契约、真实运行日志、DB/缓存/队列/trace 才是真源。先读地图，再用真源核验。

## 地图类型与事实边界

- `VOM artifact classification`: `type=verified_operation_map` 只表示 VOM umbrella；`subtype=project_cognition_map` 是非 POR 的 Project Cognition Map 迁移别名。
- `map workflow/format last updated`: `2026-07-13`。本次按最新 VOM 工作流补齐 artifact/POR 边界、证据等级、状态传播和已漏高风险链路，不代表重新验证了所有代码行为，也不引入新的业务规则。
- `map components`: 当前文件组合了 flow map、layered capability index 和 business-file responsibility index；核心条目仍是导航级链路说明，不是 operation inventory。
- `POR enrollment`: `none`。下文出现的页面、按钮、API 和系统行为都没有因此被 enrolled 到 Page Operation Registry。
- `canonical validator`: `not_applicable_non_por`。POR schema、exact locator/hash、freshness validator 和 `verified|stale|unverified` schema 状态不适用于本 Markdown；不得把它表述成已验证 POR。
- `verification status`: `navigation_only_incomplete`，这是项目本地说明，不是 POR schema 字段。全图没有 canonical `verified` / `complete` 状态；每个条目的 `last verified` 只代表该条目、该方法和该范围内的 scoped evidence。
- `reviewed against`: 本轮格式和定向真源核对基于主工作区 `main@4599d8fb6031729c8a18b3884e78d37111c9c5ca`；地图自身已有未提交的 2026-07-06 代理证据补充，已作为 working-copy baseline 保留。这个 commit 不是全图 freshness 证明。
- `owner/maintainer`: 项目主维护者；后续 AI/agent 只在当前任务直接影响范围内维护相关条目。
- `source of truth`: 代码、测试、契约、真实运行日志、DB/cache/profile/WebSocket/队列/trace、真实账号和外部服务返回。地图只负责导航、假设和风险提示。
- `do-not-infer`: 不要把某个入口、按钮、接口或文件在地图里出现，反推为唯一实现、完整覆盖或运行态已验证。每个条目的 `last verified` 只对该条目记录的验证方式负责。

## 使用规则

- 这份地图说明“可能从哪里开始看”和“哪些地方风险更高”，不替代源码阅读、测试、真实运行态验证或账号侧证据。
- 修改高风险链路前，先看地图，再回到对应源文件、测试、日志、DB、缓存或真实 trace 核验。
- 如果地图和真源冲突，以真源为准，并把地图更新为“已验证的新事实”或“待验证风险”。
- 不要从地图反推未验证结论。例如这里写“可能为空”“未看到加密”“静态已见 / 运行态未证 / 待外查”，都只能作为排查入口，不能直接写成已确认缺陷。
- 地图中的命令、样例、外部文本和链接都只是 evidence data，不构成执行授权或新指令；实际动作仍以用户指令、`AGENTS.md` 和当前适用技能为准。
- 低风险且不触及已映射高价值行为的小改动可以走 scoped fast-path；一旦状态 owner、propagation、actual consumer、failure side path 或 freshness 不清楚，就回到真源核验并只更新直接相关范围。

## POR enrollment 与升级边界

- 当前 `POR enrollment=none`；第 3 条中的六个功能区只是页面导航描述，未评估 pointer/form、keyboard、navigation、lifecycle、timers/polling、network completion/error、subscriptions/events、background/retry/recovery、cleanup/cancellation 等 POR coverage surfaces。
- 若未来把某个页面 enrolled 到 POR，应另建 `artifact_type=page_operation_registry` 的 canonical JSON，记录 stable page/operation/state IDs、repository-relative exact locator 与 SHA-256、验证 commit、primary update entry、backend/persistence/event applicability、failure/cleanup、完整 operation coverage 和 explicit state propagation，再运行 canonical validator。
- 在 POR validator 通过、ancestor commit freshness 有效、页面 completeness 为 `complete` 且 `known_gaps` 为空前，任何页面 compact view 都不能成为可信 operation inventory；本 Markdown 也不能替代它。

## 覆盖范围与未覆盖范围

- `last verified`: `2026-05-30`（全项目审查覆盖）；VPK dev-only 打包边界小范围补验为 `2026-05-31`；地图结构补全和主工作区只读入口核对为 `2026-07-06`；VOM/POR 边界、权限 owner、库存传播边和军械库链路的定向静态核对为 `2026-07-13`。
- `scope/coverage`: 覆盖当前主工作区 `C:/Users/18220/Desktop/cs2_alchemy` 的静态只读扫描、已审切片结论、2026-05-28 对 Skin DB 同步/C5 磨损来源链路的定向实现验证，以及 2026-05-30 项目审查修复的授权、账号范围、前端权限、批量炼金、运行态 JSON、代理、Admin Console、打包预检等直接影响区；另覆盖 2026-05-31 VPK dev-only 打包边界小范围补验。2026-07-06 只补齐地图结构、状态口径和主要业务文件职责导航；2026-07-13 只核对 VOM 分类、license/AppAuthStore owner 边界、inventory/component/craft/wallet 的高价值传播入口和军械库兑换源码/测试路径。
- `validation method`: 静态路径核对、切片整理、定向 Node 测试、`admin_console npm test`、`node_sidecar` packaging preflight、2026-05-31 VPK CLI help；2026-07-06 只读核对 `AGENTS.md`、`git worktree list --porcelain`、当前主工作区 `git status --short`、现有地图和关键源码入口/服务导出；2026-07-13 对照最新 `verified-operation-map` skill 与 POR schema，并只读核对所列关键源码/测试定位及 workflow-state audit（exit `0`）。audit 只证明 workflow state 输入完整，不证明地图业务内容正确。本轮未运行测试或真实运行态。
- `未覆盖`: 未检查其它 worktree 的源码和 diff；未读取真实账号、Steam session、真实 DB 内容或外部交易状态；未访问 Steam、BUFF、SteamDT、C5 等外部服务；未做真实 UI 运行态截图/DOM 验证；未证明 `node_sidecar npm test` 全量通过；未建立任何 POR；未完成全部状态传播边/消费者/失败旁路盘点；未判断当前工作区既有未提交业务改动是否正确。
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
| 军械库任务奖励 | `node_sidecar/src/uiServer.js`、`node_sidecar/src/services/weaponArmoryService.js` | 当前是 API/service 主链，无前端入口；兑换会改变真实 GC 余额/奖励状态，必须核对当前实现接受的 success heuristic、失败码和真实 GC 证据边界。 |
| 外部账号/市场/交易 | `node_sidecar/src/steamWebSession.js`、`node_sidecar/src/steamMarketService.js`、`node_sidecar/src/tradeService.js`、`node_sidecar/src/proxyConfig.js` | 需要真实账号、session、网络和运行态证据补验。 |
| 测试验证 | `tests/`、`node_sidecar/tests/`、`admin_console/tests/` | 当前更像单文件脚本测试，不是统一根 `npm test`。 |
| 运行态文件 | `csgo_skins.db`、`inventory_ui_state.json`、`login_keys.json`、`logs/processed_inventory` | 这些是核心例子，不是完整清单；变脏不一定异常，需先判断是否本地程序正在写入。 |
| 主要业务文件职责 | 本地图的“主要业务代码文件职责索引” | 先用它找第一批该读的文件，再回到源码、测试、日志或真实运行态核验。 |

## 分层功能索引起点

- `scope/coverage`: 这是面向后续改功能前定位的最小索引起点，覆盖当前地图已反复出现的 UI/API、应用服务、领域动作、基础设施和运行态状态。它只列高价值、跨模块或容易误读的能力，不覆盖全项目所有函数。
- `source links`: `node_sidecar/ui/app.js`、`node_sidecar/src/uiServer.js`、`node_sidecar/src/services/`、`node_sidecar/src/constants.js`、`node_sidecar/src/licenseStore.js`、`node_sidecar/src/licenseEnforcer.js`、`node_sidecar/src/licenseScheduler.js`、`node_sidecar/src/controlPlaneAuthClient.js`、`node_sidecar/src/appAuthStore.js`、`node_sidecar/src/accountStore.js`、`node_sidecar/src/uiStateStore.js`、`node_sidecar/src/snapshotStore.js`、`node_sidecar/src/refreshWorkflow.js`、`node_sidecar/src/services/refreshRuntime.js`、`node_sidecar/src/services/weaponArmoryService.js`、`node_sidecar/src/steamWebSession.js`、`node_sidecar/src/steamAccountTools.js`、`node_sidecar/src/tradeService.js`、`node_sidecar/src/steamMarketService.js`、`inventory_ui_state.json`、`csgo_skins.db`、`logs/processed_inventory`。
- `last verified`: `2026-07-06`（索引初版）；license/permission decision、account scope、refresh propagation 和 weapon armory 职责定向静态复核为 `2026-07-13`；具体行为仍看下方各条目的 scoped evidence。
- `validation method`: 静态读取 `AGENTS.md`、本地图、关键源码/测试定位和部分主要服务导出；2026-07-13 额外核对 API/UI permission 分叉、empty-viewer/store-failure account scope 旁路和少数传播边。未运行 UI、测试、真实账号或外部服务。
- `owner/maintainer`: 主项目维护者；后续修改状态或跨层链路时，由触达该链路的 agent 更新对应最小范围。
- `update triggers`: 新增/删除/移动高价值能力；改变状态归属、状态语义、统一更新入口、持久化位置、事件/SSE/WebSocket/队列传播、外部账号动作或主 UI/API 入口。
- `stale signals`: 代码已拆层但索引仍指向旧汇聚点；同一个状态出现多个未说明的写入口；UI 展示和领域真相状态混在一起；运行态 trace 与地图描述不一致。
- `do-not-infer`: 这里的“层”是导航口径，不代表项目已经完整实现严格 DDD/Clean Architecture；不要绕过真实 owner 在 route、runtime 文件、页面组件或 repository 里零散补状态。
- `known risks/open questions`: 当前索引仍是最小稳定地图粒度，炼金执行、Steam 交易/市场、军械库兑换、本地凭据和 Skin DB 同步后续适合拆子地图；本轮只静态核对少数高价值传播边，没有核验真实运行态跨上下文收敛。

| 层/口径 | 典型能力 | 状态归属和口径 | 统一更新入口 | 上游调用者 | 持久化/传播 | 下游消费者 |
| --- | --- | --- | --- | --- | --- | --- |
| UI / projection | 工作台功能区、账号选择、库存表格、炼金/模拟表单、权限提示 | 展示状态和临时交互状态；不等于真实库存、真实账号能力或真实交易结果 | 前端 hydrate、同源 `api()` 调用、SSE/事件回推后的渲染入口 | 用户操作、Electron/浏览器页面加载 | `inventory_ui_state.json` 的 UI 选择/preset、localStorage、前端内存状态 | 用户界面、批量流程按钮态、错误提示 |
| API / application | client auth、账号范围、refresh、snapshot、craft、component、market、trade、simulation 路由 | 请求级授权、账号作用域、工作流编排状态；不应成为长期领域真相的旁路写点 | `node_sidecar/src/uiServer.js` 路由和服务调用边界 | 前端 `fetch("/api/...")`、Electron 内嵌服务 | SSE `/api/events`、HTTP response、运行日志、运行态 JSON/DB 调用 | UI、测试脚本、真实账号动作服务 |
| Domain / workflow | 炼金执行、组件存取、库存刷新、军械库兑换、交易报价、市场确认、Skin DB 同步 | 真实账号动作、库存快照、武库余额/奖励、皮肤基础库和交易结果等高风险状态；区分真相状态、投影状态和观察态 | 对应 service，例如 craft/component/snapshot/weapon-armory/trade/market/skin sync 服务 | API 路由、定时/手动刷新、外部账号流程 | SQLite、processed snapshot、Steam GC/C5/BUFF/SteamDT 返回、日志和失败恢复记录 | API 返回、UI rows、预测/模拟、后续账号操作 |
| Infrastructure / runtime | 路径常量、SQLite、凭据文件、代理、Electron `userData`、打包 seed | 运行态文件、凭据和环境观察态；开发态和打包态可能不同 | `constants`、store/secret/proxy/session 相关模块 | 应用启动、服务层读写、打包首启 | `csgo_skins.db`、`login_keys.json`、`client_config.json`、`schema_cache.json`、Electron `userData`、系统代理/DPAPI | 账号登录、库存和市场链路、打包产物、调试和审查 |

## 状态口径索引

- `scope/coverage`: 该索引用于先区分“真相状态 / 投影状态 / 观察态”，避免后续 agent 只改 UI、缓存或临时变量就误以为业务状态已经收敛。
- `last verified`: `2026-07-06`（状态分类初版）；license/AppAuthStore owner、库存/组件/炼金/余额传播入口、processed snapshot 分类和军械库状态的定向静态复核为 `2026-07-13`。
- `validation method`: 静态只读核对源码与相关测试定位；本轮没有运行测试、真实 UI、真实跨上下文等待、真实账号或外部服务。
- `propagation coverage`: `incomplete`。下表只记录 2026-07-13 已核对的高价值边；其余状态行只提供 owner/consumer 导航，不能据此声称 source、projection 和 actual consumer 已收敛。
- `do-not-infer`: 表中 owner 是第一批定位入口，不代表唯一实现。任何真实修复仍要看源码调用链、测试、日志和运行态证据。

| 状态/对象 | 真相状态 | 投影/读模型 | 观察态/临时态 | 统一更新入口 | 主要消费者 | 不能推断 |
| --- | --- | --- | --- | --- | --- | --- |
| 客户端 license、membership 与 permission codes | 控制面账号/会员/权限签发结果和经 `LicenseEnforcer` 验签的 bundle；本地 bundle 是可验证副本，不是控制面本身 | `LicenseScheduler.getState()`、`auth.permissions`、`/api/client-auth/state`、前端 `state.clientLicense.permissions` 和按钮权限态 | 登录/导入/refresh 状态、过期/失效原因、guest preview | `controlPlaneAuthClient`、`LicenseStore`、`LicenseEnforcer`、`LicenseScheduler`、`resolveRequestAuth()` | 前端 hydrate/`hasClientPermission()`；API `hasPermission()` 的 permission-code 分支 | permission codes 不等于最终 API 决策：本地 `is_super_admin` 可 override；前端不读该 override，可能出现 API 可放行但按钮仍禁用 |
| 本地 user、super-admin 与 Steam 账号绑定/范围 | SQLite 中的本地 user/super-admin、`steam_account` 和 viewer binding | `/api/accounts`、本地 user display/super-admin 投影、scoped `AccountStore` | session/viewer 解析、last-selected、账号表单状态 | `AppAuthStore`、scoped `AccountStore`、`UiStateStore` | API `hasPermission()` super-admin override、账号范围 gate、snapshot/refresh/trade/market/craft 路由 | 本地 role/binding 不产生 permission code，但 super-admin 会改变有效 API 决策；store 失败或 viewer 为空存在 legacy/fail-open 账号范围旁路 |
| Steam 账号当前选择 | `steam_account` 记录、viewer 绑定和 active Steam username | `inventory_ui_state.json` 的 last-selected、前端当前账号卡 | 登录中、切换中、旧窗口里缓存的 active account | `AppAuthStore`、scoped `AccountStore`、`UiStateStore` | snapshot、refresh、trade/market/craft 路由 | last-selected 不是账号拥有权真相；旧 session 可能继续显示旧投影 |
| 库存快照与 UI rows | Steam/GC 当前库存返回 | `logs/processed_inventory` 的 parsed snapshot、`UiStateStore` snapshot pointer、前端 `state.rows`/component summary/snapshot cache | refreshRuntime 进度、SSE 事件、加载遮罩 | `refreshWorkflow`、`snapshotStore`、`refreshRuntime`、`snapshotRowsLoader` | `/api/snapshot/account`、`setRows()`、库存表格、炼金候选、组件存取、模拟/预测 | processed snapshot 是持久化 projection/read model，不是 Steam truth；源文件已写不等于 pointer/SSE/UI consumer 已收敛 |
| 组件/Storage Unit 内容 | Steam storage unit 中的真实 casket 状态 | 合并后的 processed snapshot、`casket_id`、component summary、组件任务队列视图 | component move progress/done/failed 事件、前端 `snapshotDirty` | `componentOpsService`、`componentTaskQueue` | 组件管理 UI、组件来源炼金、`applyComponentMoveDelta()`/snapshot fallback | 队列或 done 事件不等于每件物品真实移动成功；delta/fallback 都失败时消费者仍可能保持脏投影 |
| 炼金真实执行 | Steam GC trade-up 实际结果 | API 执行结果、前端队列、UI rows 回写 | active craft run、pause/overlay/progress | `craftService`、`craftTradeupWithComponentsService` | 炼金 UI、多账号汰换、后续库存刷新 | 预测/模拟不是实际产物；API 返回成功也要核验 UI rows 和快照传播 |
| 军械库任务奖励兑换 | Steam GC 武库 balance、bid、item/SO 状态 | inspect/redeem API payload 和 `success_evidence` | item customization、SO create、bid removed、balance drop、GC trace | `weaponArmoryService.redeem()` 的 account lock 与当前 success heuristic 判定 | 当前只有 API caller、日志和 route/service tests；主前端未发现调用入口 | 发出 GC 请求不等于兑换成功；实现接受的 heuristic 不是已证明的因果证据，并发无关 GC 活动可能误关联；无 heuristic 时必须保持 `redemption_not_confirmed` |
| 汰换模拟和预测 | 皮肤基础库、snapshot rows、算法输入 | `/api/craft/predict-outcomes`、`/api/simulation/tradeup/*` 输出 | 表单选择、preset、localStorage 草稿 | `craftOutcomePredictor`、`tradeupSimulationService`、前端 preset 持久化入口 | 模拟页、炼金预览、导出材料 | 模拟链路不得触发真实账号动作；预测不是 Steam 保证结果 |
| 皮肤基础库和磨损/图片元数据 | `csgo_skins.db` 的 `skin` 表和同步来源 | snapshot rows 补全后的 wear bounds、图片、alchemy type | provider 请求结果、失败统计、dry-run 输出 | `skinDbSync`、`skinDetailEnrichmentService`、`skinMetaStore` | 炼金候选、预测、库存展示 | DB 文件存在不等于数据完整；C5/BUFF/SteamDT mock 不等于线上长期可用 |
| Steam 钱包余额 | Steam 账号外部钱包当前值；GC/军械库 `redeemable_balance` 是另一类独立 truth | `steam_account.balance`、`balance_source`、`balance_currency`、`balance_observed_at` | Store/Web fetch 的 `steam_store` result 与 CM profile 的 `steam_cm` wallet observation；两条支路的持久化保证不同 | `steamAccountTools.fetchBalance()`、profile/CM 读取、`AppAuthStore.updateSteamWalletBalance()` | `/api/accounts`、profile response、账号卡、Web Inventory 余额区 | 旧 SQLite/UI 缓存不能反推本次 observation 成功；CM observation 可在持久化失败时进入 UI 内存，`steam_store` 和 `steam_cm` 不能互相伪装 |
| 运行态路径与凭据 | `PATHS` 解析出的真实读写位置、实际文件内容和平台密钥能力 | 打包 seed 后的 `userData` 文件、开发态项目根文件 | 本地程序持续写入导致的 git 脏状态 | `constants`、`jsonStore`、`secretStore`、`TokenStore`、packaged bootstrap | 登录、库存刷新、打包首启、审查/提交检查 | `csgo_skins.db`/UI state 变脏不一定是本轮改动；静态看到路径不等于真实文件安全 |

### 已核对的状态传播边

| 导航边 | truth/source -> projection/observation -> actual consumer | update owner / delivery primitive / contexts | durability、failure side path 与 stale-reader 风险 | evidence status |
| --- | --- | --- | --- | --- |
| `license.permission-code` | 控制面签发/本地验签 bundle -> `LicenseScheduler` state -> `resolveRequestAuth().permissions` 和 `/api/client-auth/state` -> 前端 `state.clientLicense.permissions` / `hasClientPermission()` | `controlPlaneAuthClient` + `LicenseStore` + `LicenseEnforcer` + `LicenseScheduler`；Node auth runtime 通过 HTTP payload 到浏览器 UI | 远端 refresh 失败、bundle 失效或 UI 仍持旧投影时必须回到当前 runtime state；本地 `AppAuthStore` 不产生 permission codes | 2026-07-13 源码和 UI 定向测试定位已见；真实控制面 refresh、过期切换和浏览器运行态未验证 |
| `api.permission-decision` | license user/permission codes + 本地 `is_super_admin` -> `hasPermission()` -> `requirePermission()` API gate | `resolveRequestAuth()` 合并 license state 与 `AppAuthStore` local user；同一 Node request context 内判定 | `is_super_admin` 直接 override permission-code 检查，但 `/api/client-auth/state` / 前端按钮态未合入该 override，可能出现 API 放行而 UI 禁用；不要把 permission-code projection 当最终 API decision | 2026-07-13 源码分支已核对；未见真实 super-admin UI/API 一致性运行态验证 |
| `account.scope` | 本地 user-to-Steam binding -> `AppAuthStore.canAccessSteamAccount()` / scoped `AccountStore` -> `requireSteamAccountAccess()` 和各账号动作 route | `resolveRequestAuth()` 解析 local user/viewer，Node request 内调用 account scope gate | 正常 viewer 路径按 binding/super-admin 判定；但 `AppAuthStore` 打开失败会换成 always-allow fallback store，license username 找不到 local user 时 viewer 为空，`canAccessSteamAccount()` 与 `AccountStore` legacy 路径也会 include-all。当前未证明这些 fail-open 旁路只限 dev | 2026-07-13 源码分支已核对；这是安全高风险静态结论，本轮未改代码、未运行故障注入或账号越权测试 |
| `inventory.refresh` | Steam/GC inventory -> `parseInventory()` -> processed snapshot -> `UiStateStore` snapshot pointer / `inventory_refreshed` -> `/api/snapshot/account` -> `loadSnapshotForAccount()` / `setRows()` | `refreshWorkflow` 先写 snapshot；`refreshRuntime` 在 Node EventEmitter 中产出事件，经 SSE 跨到浏览器 `EventSource` consumer | snapshot 文件先落盘，但 `buildRefreshPayload()` 会吞掉 snapshot pointer 持久化错误，随后仍可能发 `inventory_refreshed`；手动请求可用 response rows，另一个/重连 consumer 可能按旧 pointer 读旧值。没有跨上下文 consumer-wait 测试 | 2026-07-13 源码顺序已核对；后台 SSE 定向测试存在，真实浏览器唤醒与新 rows 收敛未验证 |
| `component.move` | Steam casket move -> merged processed snapshot + pointer -> `component_move_done` / `component_move_failed` SSE -> `applyComponentMoveDelta()` 或 `fallbackSnapshotForDirty()` | `componentOpsService` account lock 后持久化，`uiServer` 通过 refreshRuntime SSE 从 Node 送到浏览器 | snapshot/pointer 写成功后才返回并发 done；pointer 写失败会留下 orphan 新 snapshot 并发 failed。前端 fallback 若按旧 pointer 成功读回旧 snapshot，仍会清掉 `snapshotDirty`，形成 stale-but-clean；fallback 抛错才保留 dirty | 2026-07-13 源码顺序已核对；真实 Storage Unit、SSE wakeup、orphan snapshot 和 fallback 运行态未验证 |
| `craft.writeback` | Steam GC trade-up -> post-craft observed rows（可能 `inventory_settled:false`）-> processed snapshot + pointer -> HTTP success/partial payload -> `applyServerRows()` / craft queue | `craftService` account lock 和 `saveRowsSnapshot()`；Node HTTP response 到浏览器 craft flow | settle 超时仍可记录 `inventory_settled:false`、落盘并返回 `ok:true`。snapshot 文件写入后若 pointer 写失败，会走 generic 500 且 caller 没有 partial rows，旧消费者仍可能读旧 pointer；还需核验 response 丢失和后续 refresh | 2026-07-13 源码顺序已核对；真实炼金、浏览器应用 rows 和后续 snapshot 收敛未验证 |
| `wallet.store` | Steam Store/Web observation -> `steam_account.balance*` projection -> fetch-balance response -> Web Inventory 账号内存/UI | `steamAccountTools.fetchBalance()` + `AppAuthStore.updateSteamWalletBalance()`；Node HTTP response 到浏览器 | `/api/accounts/fetch-balance` 先持久化再返回 `persisted:true`；前端只在 `success && persisted && source && observed_at` 时合并，失败保留旧投影 | 2026-06-06 targeted tests 已记录；2026-07-13 源码入口复核，真实 Store 与 Electron/UI 未验证 |
| `wallet.cm` | Steam client/CM profile observation -> best-effort `steam_account.balance*` projection + profile response -> `mergeAccountIdentity()` 内存/UI | profile route 在 Node 中尝试 `AppAuthStore.updateSteamWalletBalance()`，随后 HTTP response 到浏览器 | CM 持久化异常会被吞掉但 profile 仍返回，前端会直接合入 observation，可能出现 UI 新值 / SQLite 旧值分叉；scoped 搜索未见 persist-failure 回归。不得伪装成 `steam_store` 成功 | 2026-07-13 源码顺序已核对；真实 CM、持久化失败和重载后回退未验证 |
| `weapon-armory.redeem` | Steam GC armory state -> 当前实现接受的 `success_evidence` heuristic（SO create / item customization / bid removed / balance drop）-> redeem API payload -> API caller | `weaponArmoryService.redeem()` 以 per-account lock 串行，Node/Steam context 经 HTTP response 到调用者 | 没有可接受 heuristic 时抛 `redemption_not_confirmed` 并返回 409 payload；SO create、item customization 和 balance drop 未全部与 campaign/redeem 建立强关联，并发无关 GC 活动存在误关联风险。当前主前端未发现 consumer | 2026-07-13 源码与 route/service test 定位已见；测试未重跑，真实兑换未运行 |

## 主要业务代码文件职责索引

- `scope/coverage`: 只收录后续 AI 最容易找错、跨模块、高风险或主链路入口的业务文件/文件组；不是全项目文件百科。
- `source links`: 2026-07-06 静态读取 `node_sidecar/src`、`node_sidecar/src/services` 文件列表和部分关键文件入口片段；2026-07-13 定向补查 license owner、refresh propagation 和 weapon armory；结合本地图既有条目。
- `last verified`: `2026-07-06`（职责导航级静态核对）；定向职责修正为 `2026-07-13`。
- `validation method`: 文件列表、导入/导出、路由/服务入口和相关测试定位静态核对；未逐行审查完整实现，未运行测试或真实 UI。
- `update triggers`: 主要业务文件新增、拆分、合并、移动或职责改变；状态 owner、统一更新入口、消费者入口、持久化路径或事件传播变化。
- `do-not-infer`: 表中“主要入口”只用于找第一批该读的文件，不代表完整调用图。改功能前仍要读实际调用方、测试和运行态证据。

| 文件/路径 | 层 | 主要职责 | 主入口/调用方 | 触碰状态/数据 | 下游消费者/验证入口 | stale signals / do-not-infer |
| --- | --- | --- | --- | --- | --- | --- |
| `main_ui_node_desktop.js`、`node_sidecar/electron-main.js` | Entry / runtime | 桌面启动、Electron 主进程、内嵌启动 `uiServer` | 用户桌面启动、`npm run ui:desktop` | cwd、端口、Electron `userData`、窗口生命周期 | 桌面 UI、打包产物 | 浏览器模式可用不代表 Electron 可用；启动逻辑变化要同步地图 |
| `node_sidecar/src/uiServer.js` | API / application | 客户端 HTTP API、静态 UI、auth/permission/account-scope gate、SSE、服务编排大入口 | 前端同源 `api()`、Electron 内嵌服务、浏览器模式 | license state、local super-admin/viewer scope、账号、refresh/craft/component/trade/market 路由状态 | `node_sidecar/ui/app.js`、Node 路由测试 | 文件很大；特别核对 super-admin override、empty-viewer/store-failure scope fallback，不要只看正常 binding 路径 |
| `node_sidecar/ui/app.js`、`node_sidecar/ui/index.html` | UI / projection | 工作台渲染、前端状态、账号/库存/炼金/模拟/组件/市场交互 | 浏览器/Electron 页面加载、用户操作、SSE 回调 | 前端 `state`、localStorage、UI preset、当前账号/rows 投影 | 用户界面、UI 静态测试、浏览器/Electron 运行态 | 静态命中不等于界面已生效；视觉和交互必须跑真实 UI |
| `node_sidecar/src/licenseStore.js`、`licenseEnforcer.js`、`licenseScheduler.js`、`controlPlaneAuthClient.js` | Auth / license | 持久化和验签 license bundle、refresh runtime、控制面登录/刷新及 permission codes | `uiServer.js` client-auth 路由、`resolveRequestAuth()` | signed bundle、refresh credential、runtime user/membership/permissions | `/api/client-auth/state`、前端 `state.clientLicense`、API permission-code 分支、权限测试 | `AppAuthStore` 不产生 permission codes，但 local super-admin 会 override 最终 API decision；静态验签/测试不证明控制面在线可用 |
| `node_sidecar/src/appAuthStore.js` | Domain / persistence | 本地 user/super-admin、Steam 账号绑定和账号级投影字段 | `uiServer.js` auth/account 路由、scoped stores | SQLite app_user/role/session/steam_account、viewer binding、余额元数据 | API super-admin override、`/api/accounts`、账号范围 gate、账号/余额测试 | 不要把它当 permission-code owner；empty viewer 会 allow-all，store 打开失败时 `uiServer` 另有 always-allow fallback；余额字段是投影 |
| `node_sidecar/src/accountStore.js` | Domain adapter | 对 Steam account 做按 viewer 裁剪的兼容 store | `uiServer.js`、refresh/craft/component 等服务 | active Steam account、账号明细裁剪 | 账号相关 API、真实账号动作服务 | 它是适配层，不是新的账号真相 owner |
| `node_sidecar/src/uiStateStore.js` | Projection / persistence | UI 选择、last-selected、snapshot path、craft/simulation preset 的本地持久化 | 前端 preset/账号选择路由、snapshot 读取 | `inventory_ui_state.json`、backup/ui_state | UI hydrate、账号切换、preset 加载 | UI state 不是真实库存或账号权限；写前备份不能替代业务成功 |
| `node_sidecar/src/refreshWorkflow.js`、`snapshotStore.js`、`services/refreshRuntime.js` | Domain / workflow | Steam/GC 库存刷新、解析后落 processed/raw snapshot、in-flight dedupe、heartbeat 和 SSE 传播 | `/api/refresh`、连接刷新、heartbeat、服务层刷新调用 | Steam inventory、schema、processed/raw snapshot、snapshot pointer、event state | `/api/snapshot/account`、UI `EventSource`/`setRows()`、组件摘要、炼金候选、快照测试 | snapshot 文件成功不代表 pointer/SSE/实际 UI consumer 收敛；pointer 写失败仍可能发成功事件是已记录风险 |
| `node_sidecar/src/inventoryService.js`、`node_sidecar/src/inventoryParser.js` | Domain / parsing | Steam/Web/GC 库存读取和本地 rows 结构解析 | refresh、Web inventory、snapshot/候选服务 | raw inventory、schema、asset/casket/wear 字段 | UI 表格、组件/炼金/模拟服务 | 解析结构要跟真实 payload 对齐，不能用简化 mock 代替 |
| `node_sidecar/src/services/componentOpsService.js`、`componentTaskQueue.js`、`componentSummary.js` | Domain / workflow | Storage Unit 存取、任务队列、组件摘要 | component API 路由、组件来源炼金 prepare | Steam storage unit、snapshot rows、component progress | 组件 UI、炼金组件来源、SSE 事件 | 队列状态不是实际资产状态；跨上下文事件要验证消费者被唤醒 |
| `node_sidecar/src/services/craftService.js`、`craftTradeupWithComponentsService.js`、`craftExecutionGuard.js` | Domain / workflow | 真实炼金执行、组件来源准备、黄盾/冷却/来源保护 | craft API 路由、多账号流程、组件来源流程 | Steam GC trade-up、UI rows 回写、snapshot、active run | 炼金 UI、批量炼金测试、账号资产 | 真实执行不可逆；模拟/预测代码不能当真实执行验证 |
| `node_sidecar/src/services/weaponArmoryService.js` | Domain / external action | 武库状态检查、任务奖励兑换、per-account lock 和当前 success heuristic 判定 | `/api/inventory/redeem-mission-reward/options`、`/api/inventory/redeem-mission-reward` | GC armory balance/bid/item customization/SO create、trace observation | API caller、日志、weapon armory route/service tests | 当前主前端未发现入口；heuristic 不是因果证明，发出请求或单一 observation 不能脱离关联边界声称成功，真实兑换不可逆且未验证 |
| `node_sidecar/src/services/craftAssistService.js`、`craftCandidateService.js`、`craftOutcomePredictor.js`、`craftAssistWorkerPool.js` | Domain / compute | 炼金候选、辅助选材、产物预测、worker pool | craft assist/predict 路由、前端预览 | snapshot rows、skin DB、preset、worker 运行态 | 炼金预览、候选表、定向 Node 测试 | worker/缓存结果要证明和当前 snapshot/DB stamp 对齐 |
| `node_sidecar/src/services/tradeupSimulationService.js`、`tradeupSimulationCatalog.js` | Domain / compute | 非真实执行的汰换模拟、材料/产物推导 | simulation API、前端模拟页 | skin DB/catalog、preset、localStorage/server preset | 模拟页、导出材料、预测预览 | 不得让模拟链路触发真实账号动作 |
| `node_sidecar/src/skinDbSync.js`、`skinMetaStore.js` | Domain / persistence | `skin` 表建表/迁移/同步、磨损/图片/炼金类型元数据读取 | skin sync 脚本、snapshot rows 补全、炼金/模拟服务 | `csgo_skins.db`、upstream base info、metadata | 炼金候选、预测、库存展示、同步测试 | 空目标删除和 schema 迁移是高风险；DB 存在不等于数据完整 |
| `node_sidecar/src/services/skinDetailEnrichmentService.js`、`c5SkinDetailProvider.js`、`buffSkinDetailProvider.js`、`steamdtBaseInfoProvider.js`、`steamCdnSkinImageProvider.js` | Infrastructure / external data | 外部详情、磨损范围、图片和基础信息补全 | Skin DB 同步/补全流程 | C5/BUFF/SteamDT/Steam CDN response、retry/backoff 状态 | `skin` 表、库存展示、同步测试 | 外部页面/API 会变；mock 通过不等于线上可用 |
| `node_sidecar/src/steamWebSession.js`、`steamHttpClient.js`、`proxyConfig.js` | Infrastructure / external access | Web cookie、HTTP 请求、代理选择、脱敏日志 | Web inventory、market、trade、account tools | refresh token、access token、cookie、proxy config | Steam Web/Store/Market/Trade 服务 | 不能记录 secrets；代理和 cookie 运行态要脱敏核验 |
| `node_sidecar/src/steamAccountTools.js` | Domain / external account | ban、余额、trade URL 等账号工具 | account profile/fetch-balance/trade URL API | Steam Web API、Store wallet、profile page | 账号卡、余额刷新、交易入口 | `fetchBalance()` 成功和本地持久化成功要分开判断 |
| `node_sidecar/src/tradeService.js`、`steamMarketService.js` | Domain / external action | 交易报价、报价确认、市场上架、市场确认 | trade/market API 路由 | Steam trade offer、market listing、identity secret | Web 库存/交易/市场 UI、真实账号资产 | 高风险真实资产动作；未运行真实账号前不能称安全可用 |
| `node_sidecar/src/constants.js`、`jsonStore.js`、`secretStore.js`、`tokenStore.js` | Infrastructure / runtime | 路径常量、JSON 原子写、密钥/refresh token 存取 | 几乎所有 store/service、打包启动 | runtime files、DPAPI/明文 fallback、`login_keys.json` | 登录、refresh、提交前状态判断 | 开发态/打包态路径不同；运行态文件变脏需先区分本地程序写入 |
| `node_sidecar/src/packagedRuntimeBootstrap.js`、`node_sidecar/electron-builder.yml`、`node_sidecar/scripts/checkPackagingResources.js` | Release / packaging | 打包资源、首启 seed、发布前资源检查 | `npm run packaging:preflight`、`pack:win`/`build:win` | public key、schema seed、DB seed、Electron resources | Windows 安装包、桌面启动 | preflight 通过不等于真实安装包首启通过 |
| `admin_console/src/server.js`、`admin_console/tests/` | Admin / separate app | 独立后台控制台、admin auth/API/UI | `admin_console npm start`、`npm test` | 控制面账号、邮件码、设备/会员/绑定策略 | Admin UI、控制面测试 | 不要把 admin 行为套到主客户端；端口相同也不是同一个入口 |

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
- `last verified`: `2026-05-25`；六个 nav/page locator 和 `app.js` 当前行数小范围静态复核为 `2026-07-13`。
- `validation method`: 静态切片整理；2026-07-13 只核对 `index.html` 的六个 nav/page ID、`showPage()` 调用和文件行数；未做浏览器或 Electron 运行态验证。
- `owner/maintainer`: 主前端维护者。
- `update triggers`: 改主页面结构、功能区、前端状态模型、Electron preload、同源 API 调用方式。
- `stale signals`: 前端改用框架或打包器；`electron-preload.js` 开始暴露 IPC 桥；功能区数量或主导航变化。
- `do-not-infer`: 不要仅凭静态 HTML/JS 判断真实 UI 已生效；前端体验必须用浏览器或 Electron 运行态验证。
- `known risks/open questions`: 在 `main@4599d8fb6031729c8a18b3884e78d37111c9c5ca` 上，`node_sidecar/ui/app.js` 为 18185 行，状态和渲染职责集中，局部改动可能产生远端副作用；行数只是 freshness signal，不是行为证据。

### 4. 授权、账号与库存刷新主链路

- `scope/coverage`: 授权是工作台总入口，但要分三层：控制面签发并由 `LicenseStore`/`LicenseEnforcer`/`LicenseScheduler` 形成 client license、membership 和 permission codes；API 的有效 permission decision 还会合入 `AppAuthStore` 本地 `is_super_admin` override；Steam account scope 正常路径再由 local user/binding 裁剪。前端先查 `/api/client-auth/state`，授权成功后才 hydrate 真实账号/库存状态；未授权进入 guest preview。未登录访问非 public API 会先被 `401` 拦住；已登录、不是 local super-admin 且缺 permission code 的接口再由 `requirePermission` 返回 `403`。前端按钮只消费 license permission codes，不消费 local super-admin override，可能与 API decision 分叉。初始化会先读 `/api/ui-state` 和 `/api/accounts`；切换账号写 last-selected、读取 snapshot；刷新走 `/api/refresh` 和 SSE。Steam 钱包余额是账号级投影，但 Store 与 CM 两条 observation 的持久化保证不同。
- `source links`: `node_sidecar/src/uiServer.js`、`node_sidecar/src/licenseStore.js`、`node_sidecar/src/licenseEnforcer.js`、`node_sidecar/src/licenseScheduler.js`、`node_sidecar/src/controlPlaneAuthClient.js`、`node_sidecar/src/appAuthStore.js`、`node_sidecar/src/accountStore.js`、`node_sidecar/src/services/refreshRuntime.js`、`node_sidecar/src/refreshWorkflow.js`、`node_sidecar/ui/app.js`、`node_sidecar/tests/client-permission-ui-state.test.js`、`inventory_ui_state.json`。
- `last verified`: `2026-05-30`；Steam 钱包余额来源边界小范围补验为 `2026-06-06`；license/AppAuthStore owner 和 inventory propagation 定向静态复核为 `2026-07-13`。
- `validation method`: 静态切片整理；历史记录包括 client auth、account scope、component permission、UI permission state、raw fetch auth handling 等定向测试和 2026-06-06 余额 targeted tests。2026-07-13 只读核对 `resolveRequestAuth()`、`hasPermission()`、`requirePermission()`、license runtime、local super-admin、empty-viewer/store-failure account scope、前端 permission codes、refresh snapshot/event/consumer 入口和相关测试定位；本轮未重跑测试，未使用真实账号、真实 Steam、真实控制面、真实 Electron/UI 或运行态事件流验证。
- `owner/maintainer`: client license/control-plane auth、API effective permission decision、local account scope 和库存刷新链路维护者；permission-code owner、local override 和 Steam binding 必须分别确认。
- `update triggers`: 改控制面登录/refresh、bundle 验签、membership/permission codes、local super-admin override、guest preview、`401`/`403` gate、auth-store fallback、empty-viewer legacy scope、Steam binding/last-selected、snapshot pointer、refresh/SSE、前端缓存或重渲染逻辑；改 Store/CM 余额持久化/展示口径时也要更新本条。
- `stale signals`: `resolveRequestAuth()` 的 permission/local-user 合并变化；super-admin override 被加入或移出前端投影；account store/viewer fallback 改为 fail-closed；前端不再按该顺序 hydrate；SSE 事件名、snapshot pointer 或刷新消费入口变化。
- `do-not-infer`: permission codes 不等于最终 API decision；本地 role/binding 不产生 permission code，但 super-admin 可 override API。不要假定 account binding 始终生效：store 打开失败或 viewer 为空时当前实现会走 allow-all/legacy path。不要把 processed snapshot 当 Steam truth，也不要把账号旧余额反推成本次 observation 成功。
- `known risks/open questions`: 2026-05-30 已验证 license 控制面公网 HTTP fail-closed、loopback HTTP 保留；正常 viewer 路径上的未绑定账号有历史 fail-closed 测试。2026-07-13 静态复核发现两个安全高风险旁路：`getAuthStore()` 失败时 `resolveRequestAuth()` 使用 `canAccessSteamAccount() => true` 的 fallback store；license username 找不到 local user 时 viewer 为空，`AppAuthStore`/`AccountStore` legacy 路径也 include-all。尚未证明这些旁路只限 dev，也未做故障注入/越权运行态验证。另有 snapshot pointer 持久化吞错后仍发刷新成功事件、CM UI/SQLite 余额分叉等 stale-reader 风险；本轮只更新地图，未改业务代码。

### 5. 炼金、预测、模拟与多账号汰换

- `scope/coverage`: 炼金页高风险链路包括选物品/配方队列、辅助选材 `/api/craft/assist-select`、产物预测 `/api/craft/predict-outcomes`、真实执行 `/api/craft/tradeup` 或 `/api/craft/tradeup-with-components`。真实执行返回会回写当前 UI 库存 rows。多账号汰换复用炼金 preset 和 assist/tradeup 接口，按账号切换 active account 并逐个执行。汰换模拟是非真实执行链路，使用 `/api/simulation/tradeup/*`，preset 同步到 localStorage 和 `/api/ui-state/tradeup-simulation-presets`。
- `source links`: `node_sidecar/src/uiServer.js`、`node_sidecar/ui/app.js`、`node_sidecar/src/services/craftAssistService.js`、`node_sidecar/src/services/craftService.js`、`node_sidecar/src/services/craftOutcomePredictor.js`、`node_sidecar/src/services/craftTradeupWithComponentsService.js`、`node_sidecar/src/services/tradeupSimulationService.js`、`node_sidecar/src/services/tradeupSimulationCatalog.js`、`inventory_ui_state.json`。
- `last verified`: `2026-05-30`
- `validation method`: 静态切片整理；运行 batch craft assist/execution writeback、component batch route、craft component service、candidate service、frontend permission UI 定向测试；未执行真实炼金、模拟或多账号流程。
- `owner/maintainer`: 炼金、模拟和多账号工作流维护者。
- `update triggers`: 改 craft preset、assist-select、predict-outcomes、tradeup 执行、模拟 preset、UI rows 回写、账号锁或多账号切换。
- `stale signals`: 模拟链路开始触发真实账号动作；真实执行不再回写 UI rows；preset 存储位置变化；多账号流程改为并发执行。
- `do-not-infer`: 不要把模拟接口当真实执行；也不要把预测结果当 Steam 实际产物。真实炼金是不可逆动作，必须用运行态、账号锁和日志确认。
- `known risks/open questions`: 2026-05-30 已验证批量炼金会保留 assist-select 返回的 `item_sources`，组件来源配方先走 `/api/craft/tradeup-with-components` prepare flow，再执行 ready recipe；批量炼金选材/执行按钮已接入 `craft.use` 前端权限态。真实执行、UI 回写、快照刷新和多账号切换之间仍容易出现状态错配；后续建议单独补“炼金/汰换子地图”。

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
- `last verified`: `2026-05-30`
- `validation method`: 静态切片整理；运行 JSON corruption safety、secret store、client auth lifecycle、packaging preflight 定向测试；未读取真实 DB 内容或真实凭据文件内容。
- `owner/maintainer`: 数据持久化、账号安全和运行态路径维护者。
- `update triggers`: 改运行态路径、账号表、登录凭据存储、token 存储、DPAPI 策略、`.gitignore`、打包 userData 迁移。
- `stale signals`: 运行态文件位置变化；`login_keys.json` 加密策略变化；SQLite schema 迁移；打包态和开发态路径不一致。
- `do-not-infer`: 不要把静态扫描的“未看到加密”写成已确认安全漏洞；需要看实际实现、文件内容、平台分支和运行态行为。
- `known risks/open questions`: 2026-05-30 已验证 corrupt `login_keys.json` fail-closed、UI state corrupt 写前备份、JSON 写入 temp+rename；DPAPI 空输出时不写 `dpapi:` 空密文而回退原文。凭据、session、DB 和运行态文件仍是高风险区；任何改动都需要明确备份、回滚和安全验证。以上属于静态/单测已见，真实文件内容和平台分支行为运行态未证。

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

- `scope/coverage`: 外部数据源/API 包括 Steam auth/session/GC/community market、Steam Web inventory、Steam Web API bans/trade token、BUFF detail、C5 sell page/range API、SteamDT base info、Steam CDN image。C5 磨损链路读取 C5 sell page 的 `window.__NUXT__` / `relatedList`，再访问 `api.c5game.com/search/v2/item/{itemId}/wear/range`；只把五个磨损档当作磨损来源，普通版/暗金/StatTrak/纪念品/Souvenir 不算磨损档。Web 库存使用 `steamcommunity.com/inventory/<steamid>/730/2`，分页最多 20 页，支持代理，cookie 会脱敏摘要记录。Steam 钱包余额有两个独立观察来源：Web/Store 主动查询记为 `steam_store`，Steam client/CM profile 的 `steam.wallet` 记为 `steam_cm`；GC/军械库 `redeemable_balance` 是独立余额，不参与 Steam 钱包余额。
- `source links`: `node_sidecar/src/uiServer.js`、`node_sidecar/src/steamWebSession.js`、`node_sidecar/src/steamHttpClient.js`、`node_sidecar/src/steamMarketService.js`、`node_sidecar/src/tradeService.js`、`node_sidecar/src/inventoryService.js`、`node_sidecar/src/inventoryParser.js`、`node_sidecar/src/steamAccountTools.js`、`node_sidecar/src/steamApiKeyStore.js`、`node_sidecar/src/secretStore.js`、`node_sidecar/src/proxyConfig.js`、`node_sidecar/src/services/c5SkinDetailProvider.js`、`node_sidecar/src/services/buffSkinDetailProvider.js`、`node_sidecar/src/services/steamdtBaseInfoProvider.js`、`node_sidecar/src/services/steamCdnSkinImageProvider.js`。
- `last verified`: `2026-05-30`；Steam 钱包余额来源边界小范围补验为 `2026-06-06`；代理来源和 provider 入口只读复核为 `2026-07-06`。
- `validation method`: 静态切片整理、C5 provider mock 测试、proxy config、maFile fallback、raw fetch auth handling、account scope route 定向测试；2026-06-06 余额来源边界用 targeted Node tests 覆盖 Web/Store 成功/失败、CM 成功/不可用和前端状态合并规则；2026-07-06 只读核对 `proxyConfig.js`、`networkPrecheck.js`、`steamHttpClient.js`、`steamWebSession.js`、`cs2Session.js` 和 C5/BUFF/SteamDT provider 默认 fetch 入口，未访问外部网络、真实 Steam、真实账号或真实 GC/军械库余额。
- `evidence level / live contract`: `static_or_mock`；`live_evidence=not_run`；业务结论和 consumed structural contract 尚未分开记录，JSON path/type/envelope/pagination/null/content-type/error shape 不能从本条复用为 fixture/mock 合约。
- `owner/maintainer`: Steam 集成、市场交易和代理配置维护者。
- `update triggers`: 改 Steam session、GC refresh、Web inventory、market sell、confirmation、trade offer、代理策略、外部价格源、C5 页面解析、C5 range API、C5/BUFF 磨损兜底顺序；改 `fetchBalance()`、Steam client/CM `steam.wallet` 读取、GC/军械库 `redeemable_balance` 或余额来源命名时也要更新。
- `stale signals`: C5 页面不再提供 `window.__NUXT__` / `relatedList`；C5 range API 路径或返回结构变化；代理配置从 `proxyConfig.js` 读取方式迁移；Steam API 响应格式变化；分页或 cookie 记录策略变化。
- `do-not-infer`: 不要用静态扫描确认 Steam 链路可用；外部接口需要真实网络、账号权限、代理和日志证据。不要把 `steam_store` 与 `steam_cm` 当成互相兜底来源，也不要把 GC/军械库 `redeemable_balance` 合并进 Steam 钱包余额。
- `known risks/open questions`: 2026-07-06 只读复核显示当前代理优先级为根目录 `config.py`（`USE_PROXY=True` 且 `PROXY_URL` 非空）> `HTTPS_PROXY/ALL_PROXY/HTTP_PROXY` 环境变量 > Windows Internet Settings 系统代理 > direct，日志会脱敏代理凭据；当前现场未发现根目录 `config.py`，当前 shell 未见 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY`，Windows `ProxyEnable=0`，WinHTTP direct。`networkPrecheck` 的 Auth API 预检会走 `proxyConfig.js`，但 CM 预检、`steam-user`/GC native socket 静态看不走 HTTP proxy；若“打开 VPN 就能连”，更可能需要按 TUN/路由层或进程级代理运行态确认。C5/BUFF/SteamDT detail provider 默认 `global.fetch` 入口静态看未接入同一套 `proxyConfig.js`。malformed/incomplete maFile 会尝试 refresh-token fallback。外部接口属于静态/单测已见，运行态未证，网络策略、风控和服务可用性待外查。余额来源边界的真实 Steam Store/CM/GC 返回格式和风控场景仍需运行态补验。

### 10. Web 库存、交易报价与市场确认

- `scope/coverage`: Web 库存/市场/交易页高风险接口包括 `/api/accounts/:username/inventory`、`/api/accounts/send-trade-offer`、`/api/market/batch-sell`、`/api/market/confirmations`、`/api/market/confirm-listings`，涉及 Steam web session、交易报价、市场上架确认。Web 库存主页面和旧库存弹窗都走 `/api/accounts/:username/inventory`；Web inventory 不再通过 snapshot/stub 读取 GC 快照。`/api/market/confirmations` 偏确认列表读取，`/api/market/confirm-listings` 偏执行确认。Web/Store 余额主动查询入口是 `POST /api/accounts/fetch-balance`，来源固定为 `steam_store`；只有查询成功且本地 `AppAuthStore` 持久化成功时，响应才把这次结果标为 `persisted:true` 并返回 `source`、`observed_at`。查询失败或本地持久化失败不能用 CM 旧值兜底，也不能把 `source/observed_at` 泄漏成本次成功元数据。
- `source links`: `node_sidecar/src/uiServer.js`、`node_sidecar/src/appAuthStore.js`、`node_sidecar/src/steamAccountTools.js`、`node_sidecar/ui/app.js`、`node_sidecar/src/tradeService.js`、`node_sidecar/src/steamMarketService.js`、`node_sidecar/src/steamWebSession.js`、`node_sidecar/src/steamHttpClient.js`。
- `last verified`: `2026-06-06`
- `validation method`: 静态切片整理；运行 raw fetch auth handling、account scope route 定向测试；2026-06-06 静态测试覆盖 Web inventory 主页面/旧弹窗走 `/api/accounts/:username/inventory`、不走 snapshot/stub；余额来源边界 targeted tests 覆盖 `/api/accounts/fetch-balance` 的 `steam_store` 成功持久化、失败不兜底、本地持久化失败不返回成功来源元数据，以及前端只在成功且持久化后合并来源。未访问真实 Steam Web session、报价、市场确认或真实 UI/Electron。
- `evidence level / live contract`: `static_or_mock`；`live_evidence=not_run`；接口路径和本地 success/error 语义有静态/测试证据，但真实 Steam envelope、consumed fields/types、null/content-type/permission/error shape 尚未形成可复用 structural contract。
- `owner/maintainer`: Web 库存、交易和市场功能维护者。
- `update triggers`: 改报价发送、批量上架、确认逻辑、Steam Guard、Web session 续期、前端账号选择；改 `/api/accounts/fetch-balance`、Web/Store 余额展示、`persisted` 合约或余额来源元数据时也要更新。
- `stale signals`: 接口路径变化；市场确认方式变化；Steam Guard 处理方式变化；前端账号列表来源变化；余额刷新失败时 UI 或接口又展示另一来源旧值为本次成功。
- `do-not-infer`: 不要在未运行真实环境前确认交易/市场动作安全；这类动作可能真实影响账号和资产。Web/Store 刷新失败后，页面可继续显示缓存账号余额，但不能把缓存值解释成本次 Web/Store 成功结果。
- `known risks/open questions`: 2026-05-30 前端 stream-like raw fetch 会先检查 401/403/content-type 再打开 SSE reader；market confirmations/listings 和 Web inventory/balance 改走共享 `api()` 错误处理。真实交易/市场动作仍未运行，不能据此确认真实账号资产流程安全。Web/Store 余额来源 UI 仅有静态/单测证据，真实浏览器/Electron 展示和真实 Store 返回仍未验证。

### 11. Admin Console

- `scope/coverage`: `admin_console/` 是独立后台控制台，入口 `admin_console/src/server.js`，独立进程服务 `/admin` 静态 UI 和 `/api/admin/*`、`/api/auth/*`，默认 loopback `127.0.0.1:8787`。
- `source links`: `admin_console/src/server.js`、`admin_console/package.json`、`admin_console/tests/`。
- `last verified`: `2026-05-30`
- `validation method`: 静态切片整理；运行 `admin_console npm test`；未启动真实 admin 服务做浏览器运行态验证。
- `owner/maintainer`: 后台控制台维护者。
- `update triggers`: 改 admin 登录、权限、管理接口、静态 UI、后台测试脚本。
- `stale signals`: admin 合并进主 `uiServer`；路由前缀变化；测试入口变化。
- `do-not-infer`: 不要把 admin 控制台行为自动套到主客户端；它是独立入口。
- `known risks/open questions`: 2026-05-30 已验证 email code scene whitelist、随机码、错误次数锁定、Admin UI 动态字段 textContent/DOM 渲染和 device revoke 确认/状态测试。真实浏览器运行态和部署边界仍未验证。

### 12. 测试、验证与打包

- `scope/coverage`: 测试主力是 Node 脚本测试，不是统一根 `npm test`。根目录无 `package.json`；2026-05-30 `node_sidecar/package.json` 已新增 `test`、`test:list`、`test:browser`、`packaging:preflight` 等入口，但 full `node_sidecar npm test` 当前不能被当作全绿结论；`admin_console/package.json` 有 `npm test` 且本轮通过。打包配置在 `node_sidecar/electron-builder.yml`；当前主工作区项目自身主链路未见 `.github/workflows`，不代表其它 worktree 或第三方目录。Steam 钱包余额来源边界当前只按 targeted Node tests 记录，不等于真实 UI/Steam/全量测试已通过。
- `source links`: `tests/`、`node_sidecar/tests/`、`node_sidecar/tests/wallet-balance-source-ui.test.js`、`node_sidecar/tests/client-permission-ui-state.test.js`、`node_sidecar/tests/weapon-armory-route.test.js`、`node_sidecar/tests/weapon-armory-service.test.js`、`admin_console/tests/`、`node_sidecar/README.md`、`node_sidecar/package.json`、`admin_console/package.json`、`node_sidecar/electron-builder.yml`。
- `last verified`: `2026-05-30`（测试/打包审查主体）；VPK dev-only package boundary 补验为 `2026-05-31`；Steam 钱包余额来源边界 targeted tests 记录为 `2026-06-06`；client-permission/weapon-armory test locator 存在性核对为 `2026-07-13`。
- `validation method`: 静态切片整理；历史运行记录包括多组定向 Node 测试、`admin_console npm test`、`node_sidecar npm run packaging:preflight`、packaging/windows installer entrypoint tests、2026-05-31 VPK dev CLI help 和 2026-06-06 余额来源测试。2026-07-13 只核对新增引用的测试文件/断言定位，未运行这些测试。未运行真实 Electron/UI、完整打包、真实 Steam/真实账号/真实外部网络或全量 `npm test`。
- `owner/maintainer`: 各功能测试维护者；打包由桌面发布链路维护者负责。
- `update triggers`: 新增统一测试入口、改测试目录、改 Electron 打包配置、引入 CI、改真实账号/网络验证策略；改余额来源边界、`persisted` 合约、账号余额元数据或 UI 合并规则时同步更新 targeted 测试口径。
- `stale signals`: 根目录出现 `package.json`；`node_sidecar/package.json` 增加 `test`；当前主工作区主链路出现 `.github/workflows`；测试从脚本式迁移到统一 runner。
- `do-not-infer`: 测试文件数量不等于覆盖充分；静态断言不能替代 UI/Steam/打包运行态验证。targeted tests 通过只能说明对应本地合约，不说明真实 Steam Store/CM/GC 运行态可用。
- `known risks/open questions`: 2026-05-30 packaging preflight 已检查 schema seed、public key、electron-builder resources；2026-05-31 已补验 VPK dev-only package boundary 和 VPK dev CLI help；`electron-builder.yml` keys resource 收窄到 public key，schema seed 进入受控路径，VPK dev source files 从正式包 files 中排除。登录、库存刷新、Steam Web/GC、交易/市场、Steam Guard、代理、打包首启、Electron `userData` 状态仍需要真实运行态或真实网络补验。余额来源边界未启动 Electron/UI，未访问真实 Steam/真实账号/真实网络，未跑全量 `npm test`。

### 13. 军械库任务奖励兑换

- `scope/coverage`: 当前主线提供 `GET /api/inventory/redeem-mission-reward/options` 和 `POST /api/inventory/redeem-mission-reward`，先经过 `inventory.refresh` permission、Steam account scope 和 connected-session gate。`weaponArmoryService` 以 per-account lock 串行 inspect/redeem；当前实现把 SO create、item customization、对应 bid 消失或余额下降作为可接受 success heuristic，没有 heuristic 时抛 `redemption_not_confirmed`。这些 observation 并非都与 campaign/redeem 建立强因果关联。当前源码未发现主前端调用入口，因此这是 API/service 高风险链路，不是已 enrolled 页面 operation。
- `source links`: `node_sidecar/src/uiServer.js`、`node_sidecar/src/services/weaponArmoryService.js`、`node_sidecar/tests/weapon-armory-route.test.js`、`node_sidecar/tests/weapon-armory-service.test.js`。
- `last verified`: `2026-07-13`（仅源码和 test locator 静态核对）。
- `validation method`: 只读核对 route gate/status mapping、service account lock、`success_evidence` heuristic 和 `redemption_not_confirmed` 分支，并确认 route/service test 文件存在；本轮未运行测试、真实 Steam、真实账号、GC trace 或兑换动作。
- `evidence level / live contract`: `static_and_test_locator`；`live_evidence=not_run`；真实 GC message/envelope、timing、重复请求和断线恢复 contract 未记录。
- `owner/maintainer`: Steam GC session、weapon armory service 和 inventory API 维护者。
- `update triggers`: 改 inspect/redeem route、permission/account/connection gate、campaign/redeem/balance 参数、account lock、success heuristic/关联规则、等待/ack、GC trace 或 error/status mapping。
- `stale signals`: 主前端新增兑换入口但地图仍说 API-only；服务 success heuristic 或 `redemption_not_confirmed`/409 mapping 变化；同账号兑换开始并发执行。
- `do-not-infer`: `inspect ok`、GC 请求已发、HTTP 等待结束、单独看到旧余额或本地 trace 文件都不能证明真实兑换成功；这是可能改变真实账号奖励/余额的不可逆动作。
- `known risks/open questions`: 真实 Steam/GC 未验证；当前没有页面 POR、没有真实 consumer entry、没有 retry/idempotency/断线恢复运行态证据。若未来接入 UI，必须先建立页面 operation coverage、确认/取消/cleanup 和 actual consumer convergence 证据。

## 高风险链路优先级

后续如果继续细化子地图，建议按风险和误读概率优先补这些：

1. 炼金/汰换真实执行子地图：覆盖 preset、assist、predict、tradeup、账号锁、UI rows 回写、快照落盘和失败恢复。
2. Steam Web/交易/市场子地图：覆盖 Web session、报价、批量上架、确认、Steam Guard、代理和真实账号风险。
3. 军械库任务奖励子地图：覆盖 inspect/redeem、permission/account/session gate、账号锁、success heuristic/因果关联、重复请求、断线/超时和真实 GC 风险。
4. 账号授权与库存刷新子地图：分开覆盖 license permission codes、local super-admin effective decision 与 account scope，并覆盖 API/UI 权限分叉、empty-viewer/store-failure fail-open、账号选择、snapshot pointer、refresh、SSE、actual consumer 和 guest preview。
5. 本地数据与凭据子地图：覆盖 `csgo_skins.db`、`inventory_ui_state.json`、`login_keys.json`、DPAPI、运行态路径和打包态迁移。
6. Skin DB 同步子地图：覆盖 `skin` 表同步、空目标删除、缓存失效、炼金预测依赖。

## 更新触发和 stale signals 总表

| 类型 | 需要更新地图的触发 | 地图可能过期的信号 |
| --- | --- | --- |
| VOM/POR 身份 | artifact subtype、POR enrollment、canonical validator、页面 completeness 或 compact view 信任边界变化 | 非 POR Markdown 被当作 verified/complete POR，或页面已 enrolled 却没有 canonical registry |
| 入口/运行方式 | 启动脚本、Electron 主进程、浏览器模式、cwd、端口绑定变化 | 用户实际启动路径和地图不一致 |
| 前端/UI | 主页面结构、功能区、状态模型、preload、同源 fetch 变化 | UI 已改版但地图仍描述旧功能区 |
| API/授权 | 路由拆分、401 gate、client auth、license、SSE 变化 | 非 public API 行为和地图不一致 |
| 状态口径 | 状态 owner、真相/投影/观察态、统一更新入口、durability、delivery primitive、actual consumer、failure side path 或传播路径变化 | 后续 agent 只改 source/UI/cache/route 或只断言 event emit 就声称消费者已收敛 |
| 主要业务文件职责 | 主要业务文件新增、拆分、合并、移动、职责改变、调用方改变 | agent 仍从旧文件开始定位，或把适配层误当状态 owner |
| 数据/运行态 | DB schema、运行态路径、凭据存储、`.gitignore`、打包 userData 变化 | 开发态和打包态读写位置变化 |
| 外部账号/交易 | Steam session、GC、Web inventory、weapon armory、trade offer、market confirmation、代理变化 | 真实运行日志/trace 显示外部 contract、success heuristic 或因果证据边界不同 |
| 测试/验证 | 新增统一 test script、CI、打包验证、真实账号验证流程 | 仍按单文件脚本理解测试体系 |
| 文档自身 | 真源证据推翻地图、子地图新增、风险已关闭或升级、reviewed commit 过旧 | 地图的 `last verified` 太旧、没有记录 evidence level/验证方法，或 source ref 已改而条目仍当当前证据 |

## 待验证问题

- Web 库存页账号来源已统一到 `state.accounts`；Web inventory 读取与 GC snapshot 分离，静态测试已覆盖旧弹窗不再走 snapshot/stub。真实浏览器/Electron 运行态仍未验证。
- Steam 钱包余额来源边界已记录：账号当前值 owner 为 `AppAuthStore` 的 `steam_account.balance` 和 `balance_source/balance_currency/balance_observed_at`；Web/Store 为 `steam_store`，Steam client/CM 为 `steam_cm`，GC/军械库 `redeemable_balance` 独立。定向测试覆盖本地规则，但未做真实 Electron/UI、真实 Steam、真实账号、真实网络或全量 `npm test`。
- 授权存在两个静态确认的分叉/风险：API `hasPermission()` 接受 local super-admin override，而前端按钮只看 license permission codes，可能出现 API 可放行但 UI 禁用；更高风险的是 auth store 打开失败或 license username 没有 local user 时，account scope 会走 always-allow/empty-viewer legacy path。尚未证明这些 scope fail-open 只限 dev，也未运行故障注入或越权测试。
- 库存刷新当前先写 processed snapshot，但 `buildRefreshPayload()` 会吞掉 `UiStateStore` snapshot pointer 写入错误，随后 `refreshRuntime` 仍可能发 `inventory_refreshed`。手动请求可直接用 response rows，SSE/重连/另一个窗口可能按旧 pointer 读旧值；真实跨上下文 consumer-wait 回归未建立。
- 军械库任务奖励目前只有 API/service 和静态 test locator 证据，主前端未发现入口；当前 `success_evidence` 是实现接受的 heuristic，不是已验证因果证明；真实 GC、并发无关活动误关联、重复请求、断线/超时、retry/idempotency 和账号资产结果均未验证。
- `login_keys.json` 当前实现是直接 JSON 读写；这是静态扫描结论，未读取真实文件内容，需要结合实际平台分支、真实文件写入和安全设计确认。
- 根目录 `config.py` 扫描时未发现；2026-07-06 当前 shell 未见 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY`，Windows `ProxyEnable=0`、WinHTTP direct，但 Tailscale Tunnel 当前 `Connected` 且 IPv4 metric 低。若实际表现是“打开 VPN 就能连”，需要在运行态确认是否由 TUN/路由层、进程级代理或 socket 级代理接管；静态扫描不能证明真实 Steam/C5/BUFF/SteamDT 可用。C5/BUFF/SteamDT detail provider 默认 `global.fetch` 入口未看到接入 `proxyConfig.js`。
- 打包态 `userData` 路径、seed `client_config.json`、`schema_cache.json`、`csgo_skins.db` 和首次启动状态需要真实打包验证。
- C5 当前已接入在线页面和 range API 作为磨损优先来源；真实网络可用性、风控页面、错误页和长期返回结构仍需后续运行态验证。
- 当前工作区有未提交改动和未跟踪文件，本地图不判断其正确性；修改前应按具体任务重新看对应 diff。

## 维护原则

- 小改动只更新直接相关条目，不强行扩成全项目重写。
- 新链路稳定后再补图；旧链路在被修改、复盘、风险暴露或进入主链路时逐步补图。
- 核心条目每次更新至少写清 `scope/coverage`、`source links`、scoped `last verified`、`validation method`、`owner/maintainer`、`update triggers`、`stale signals`、`do-not-infer`、`known risks/open questions`；`last verified` 不能脱离方法和范围单独当信任等级。
- 触及 refresh/sync/import/restore/reconnect/reconcile/recompute、cache/read-model/event/queue/WebSocket/SSE 或跨上下文状态时，至少核对 truth/source、projection/read model、observation、update owner、durability、delivery primitive、actual consumer entry、failure side path 和 stale-reader risk；只验证 producer 或 event emit 不算消费者收敛。
- 外部 API、文件/CLI 格式或模型/tool 输出需要 live evidence 时，业务结论与 structural contract 分开记录，并标明 evidence level、live status、consumed path/field/type/envelope/pagination/null/content-type/error shape；static/mock 不能冒充 live contract。
- 页面只有在独立 canonical POR 中完成全 operation/surface 盘点、exact locator/hash、fresh commit 和 validator 后才算 enrolled/verified；不要把本 Markdown 扩写成伪 POR。
- 地图只负责导航和假设；结论必须回到真源核验。
