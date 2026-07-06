# 项目审查任务清单（2026-06-06）

覆盖范围：本清单只来自主工作区 `C:/Users/18220/Desktop/cs2_alchemy` 的静态审查。未覆盖其它 worktree、真实 Electron/UI 运行态、真实 Steam/C5/BUFF/远端控制台、真实账号/token/DB 内容。

不纳入范围：原审查问题 4（Steam Guard 令牌详情暴露敏感原始字段）按用户确认属于主动设计，本清单不列为待修问题。

## A1 Web 库存账号列表为空风险

- 状态：已处理
- 优先级：高
- 位置：
  - `node_sidecar/ui/app.js`：`state` 定义和账号加载，约第 26、647、3389 行
  - 原问题位置：`node_sidecar/ui/app.js` 修复前 Web 库存读取 `state.savedAccounts`，约第 16659、16704、16901、16918、16974 行
- 原问题：账号加载只写 `state.accounts`，Web 库存页却读 `state.savedAccounts`。如果没有其它赋值入口，库存管理页账号列表会为空。
- 建议任务：
  - 统一 Web 库存页账号来源，优先改为读取 `state.accounts`。
  - 补一个前端/DOM 测试，确认账号加载后库存管理页账号列表非空。
- 验收：
  - 有账号时库存管理页能展示账号。
  - 相关测试覆盖 `loadAccounts()` 后 Web 库存账号列表渲染。
- 已处理说明：账号来源已统一到 `state.accounts`；Web 库存读取与 GC snapshot 分离，旧弹窗不再走 snapshot/stub。

## A2 正式客户端根配置仍使用公网 HTTP

- 状态：待处理
- 优先级：高
- 位置：
  - `client_config.json`：`control_plane_base_url` 当前为 `http://8.138.39.139`
  - `node_sidecar/src/licenseConfig.js`
  - `node_sidecar/src/controlPlaneUrlPolicy.js`
  - `node_sidecar/tests/client-auth-config.test.js`
  - `README.md`
  - `node_sidecar/README.md`
  - `node_sidecar/build/client_config.release.json`
- 问题：正式远端认证策略只允许 HTTPS 或本机 HTTP；根配置仍是公网 HTTP，文档也有 HTTP/HTTPS 口径不一致。
- 建议任务：
  - 把正式远端默认配置统一为 HTTPS。
  - 同步根 README、`node_sidecar/README.md`、打包 seed 和本地根配置口径。
  - 授权失败提示里明确说明“不允许公网 HTTP 控制面地址”。
- 验收：
  - `client-auth-config` 相关测试仍能证明公网 HTTP 被拒绝、HTTPS 被允许。
  - 用户按根入口启动时不会因为默认地址不合规而失败。

## A3 授权/账号 store 初始化失败时 fail-open

- 状态：待处理
- 优先级：高
- 位置：
  - `node_sidecar/src/uiServer.js`：`resolveRequestAuth()` fallback store，约第 631-677 行
  - 账号范围相关测试：`node_sidecar/tests/account-scope-route.test.js`、`node_sidecar/tests/account-profile-route-scope.test.js`
- 问题：`getAuthStore()` 初始化失败后，fallback 的 `canAccessSteamAccount()` 返回 `true`，可能让异常状态下的账号范围放开。
- 建议任务：
  - 改为 fail-closed：账号 store 不可用时禁止账号列表、刷新、交易、市场、炼金执行等高风险接口继续操作。
  - 补 store 初始化失败场景的账号隔离回归测试。
- 验收：
  - 模拟 auth store 初始化失败时，受账号范围约束的接口不能访问其它账号。
  - 错误响应对用户可理解，并且不泄漏内部细节。

## A5 真实资产动作权限粒度偏粗

- 状态：待确认设计后处理
- 优先级：中高
- 位置：
  - `node_sidecar/src/uiServer.js`：`/api/component/deposit`、`/api/component/withdraw` 使用 `inventory.refresh`，约第 3234、3310 行
  - `node_sidecar/src/uiServer.js`：`/api/accounts/send-trade-offer` 使用 `accounts.write`，约第 4312 行
  - `node_sidecar/src/uiServer.js`：`/api/market/batch-sell`、`/api/market/confirmations`、`/api/market/confirm-listings` 使用 `accounts.write`，约第 4549、4620、4652 行
  - `shared/featureCodes.js`
  - `shared/licensePolicy.js`
  - `shared/craftPermitPolicy.js`
- 问题：组件存取、交易报价、市场上架/确认都是真实资产动作，但权限名偏泛，后续授权管理容易误判风险。
- 建议任务：
  - 先确认产品授权语义是否允许当前粗粒度。
  - 如不允许，拆出明确权限，例如 `component.write`、`trade.use`、`market.sell`。
  - 补接口权限测试，覆盖无权限、低权限、有权限三类场景。
- 验收：
  - 权限名能直接表达资产动作风险。
  - 真实资产动作默认 fail-closed。

## A6 运行态数据库仍被 Git 跟踪

- 状态：待处理
- 优先级：中高
- 位置：
  - `csgo_skins.db`
  - `.gitignore`：已忽略 `csgo_skins.db`
  - `node_sidecar/build/csgo_skins.seed.db`
  - `AGENTS.md`
  - `docs/project-cognition-map.md`
- 问题：`csgo_skins.db` 按项目规则属于运行态/数据产物，但仍在 Git 索引里，容易污染 diff、提交和发布判断。
- 建议任务：
  - 确认是否只保留 `node_sidecar/build/csgo_skins.seed.db` 作为打包 seed。
  - 如确认，执行索引治理：从 Git 跟踪中移除根 `csgo_skins.db`，保留本地文件。
  - 补发布/提交前检查，防止运行态 DB 混入提交。
- 验收：
  - 本地运行态 DB 变化不再出现在普通代码 diff 中。
  - 打包 seed 仍可被 packaging preflight 找到。

## A7 主前端和主 API 入口过大

- 状态：长期治理
- 优先级：中
- 位置：
  - `node_sidecar/ui/app.js`：约 18175 行
  - `node_sidecar/src/uiServer.js`：约 5182 行
  - `docs/project-cognition-map.md`
- 问题：账号、库存、炼金、模拟、市场、令牌、授权等逻辑集中在大文件中，改动容易产生跨功能回归。
- 建议任务：
  - 不做一次性大重构。
  - 按高风险链路逐步拆：授权/账号、库存刷新、真实炼金执行、交易/市场确认、本地运行态文件。
  - 每拆一条链路，同步补最小子地图和测试。
- 验收：
  - 新功能不再继续向大入口塞无边界状态。
  - 每条高风险链路有明确 owner、统一更新入口和测试。

## A8 测试入口分散，缺少顶层验证口径

- 状态：待处理
- 优先级：中
- 位置：
  - 根目录：无 `package.json`
  - `tests/`
  - `node_sidecar/package.json`
  - `node_sidecar/scripts/runNodeTests.js`
  - `node_sidecar/tests/`
  - `admin_console/package.json`
  - `admin_console/tests/`
- 问题：测试很多，但入口分散；不同人容易只跑局部测试，并误以为全项目已验证。
- 建议任务：
  - 增加顶层验证说明或只读汇总脚本。
  - 明确区分纯单测、浏览器/UI 测试、真实账号/外部服务测试、打包预检。
  - 给核心链路建立覆盖清单或覆盖率报告。
- 验收：
  - 新 agent 或维护者能一眼知道“改哪类功能该跑哪些验证”。
  - 不再把局部测试通过包装成全项目通过。

## A9 SSE 断线静默

- 状态：待处理
- 优先级：中
- 位置：
  - `node_sidecar/ui/app.js`：`EventSource` 和 `stream.onerror`，约第 2339、2512 行
- 问题：库存/刷新事件流断线时前端静默等待重连，用户可能不知道实时更新已经中断。
- 建议任务：
  - 保留自动重连。
  - 超过短时间未恢复时提示“实时更新连接中断，可手动刷新”。
  - 避免把旧库存/旧进度表现成刚更新。
- 验收：
  - 模拟 SSE 断开时，页面给出可理解提示。
  - 重连成功后提示消失或状态恢复。

## A10-1 Steam 凭据落盘保护不足

- 状态：已核验，待处理
- 优先级：高
- 位置：
  - `node_sidecar/src/tokenStore.js`：Steam refresh token 直接 JSON 读写，约第 27 行
  - `node_sidecar/src/authService.js`：登录成功后写入 token store，约第 284 行
  - `node_sidecar/src/accountStore.js`：Steam 账号写入入口，约第 67 行
  - `node_sidecar/src/appAuthStore.js`：`steam_account.password`、`steam_account.mafile_content` 为普通文本字段，约第 183 行
  - `node_sidecar/src/steamApiKeyStore.js`：Steam API key 路径为 `node_sidecar/data/steam_api_key.enc`，约第 5 行
  - `.gitignore`
- 核验结论：
  - `login_keys.json` 中 Steam refresh token 当前按普通 JSON 保存，未经过 `secretStore`。
  - Steam 账号密码和 maFile 内容在账号库中按普通文本字段保存。
  - `node_sidecar/data/steam_api_key.enc` 未被 `.gitignore` 覆盖。
  - 应用自身登录密码和 session token 已有保护：密码走 `scrypt`，session token 只存 hash；不要把这部分误判为同一问题。
- 建议任务：
  - 对 Steam refresh token、Steam 账号密码、maFile 内容建立统一加密/解密入口。
  - 明确 Windows DPAPI 失败或非 Windows 环境的 fallback 策略，不能静默降级到用户难以察觉的明文。
  - 把 `node_sidecar/data/steam_api_key.enc` 加入 `.gitignore` 或改到明确运行态目录。
  - 补账号删除后的 token/maFile/密码残留测试。
- 验收：
  - 不读取真实秘密内容，只检查写盘格式或前缀即可证明敏感字段不再明文保存。
  - 删除账号后对应 token 和账号敏感材料同步清理。

## A10-2 Admin Console 公网边界依赖部署层

- 状态：已核验，待补部署级验证
- 优先级：中高
- 位置：
  - `admin_console/src/server.js`：同一个服务承载 `/admin`、`/api/admin/*`、`/api/auth/*`、`/api/dev/mail/test`，约第 249、270、377、890、928 行
  - `admin_console/src/constants.js`：默认 `AUTH_SERVICE_HOST` 为 `127.0.0.1`，约第 14 行
  - `admin_console/src/mailConfig.js`：host/port 可由环境配置覆盖，约第 81 行
  - `admin_console/deploy/cs2-auth-gateway.nginx.conf`
  - `admin_console/deploy/harden_remote_access.sh`
  - `admin_console/tests/control-plane-ui-security.test.js`
- 核验结论：
  - 默认本地监听是 `127.0.0.1:8787`，已有保护。
  - nginx 配置只转发 `/api/auth/*` 和 `/api/health`，并对 `/admin`、`/api/admin/*`、`/api/mail/config`、`/api/dev/mail/test` 返回 404，已有保护。
  - 加固脚本把后台源站端口绑定到宿主机 `127.0.0.1`，已有保护。
  - 应用层本身没有禁止公网 host，也没有在代码里硬拦公网访问后台路径；如果绕过部署脚本或 env 配成公网监听，后台控制面会随服务暴露。
- 建议任务：
  - 增加部署边界自动化测试或预检，覆盖 nginx 路径阻断和源站 loopback 绑定。
  - 对 `AUTH_SERVICE_HOST=0.0.0.0` 或公网地址增加明确风险提示，必要时生产模式 fail-closed。
  - 线上补验运行中容器端口映射和实际 nginx 配置。
- 验收：
  - 公网访问 `/admin`、`/api/admin/session`、`/api/dev/mail/test` 返回不可用。
  - 公网访问 `/api/auth/register/readiness` 和 `/api/health` 符合预期。
  - 后台源站只绑定本机或内网受控地址。

## A10-3 Web Inventory 未复用共享 HTTP client

- 状态：已核验，待处理
- 优先级：中高
- 位置：
  - `node_sidecar/src/inventoryService.js`：直接 `https.get()`，约第 5、115、145、149 行
  - `node_sidecar/src/steamHttpClient.js`：已有 retry/backoff/解压/统一失败返回，约第 171、183、240 行
  - `node_sidecar/src/proxyConfig.js`
  - `node_sidecar/tests/inventory-service.test.js`
  - `node_sidecar/tests/steam-http-client-proxy.test.js`
  - `docs/agent/web-inventory-upstream-implementation-index.md`
- 核验结论：
  - Web Inventory 已经走共享 `proxyConfig`，不是“完全没代理”。
  - Web Inventory 没有复用共享 `steamHttpClient`，因此没有吃到统一的 429/5xx/timeout retry、gzip/br/deflate 解压和统一失败返回。
  - 坏代理配置的失败路径和 `steamHttpClient` 不统一。
- 建议任务：
  - 把 Web Inventory 库存请求迁到共享 `steamHttpClient` 或抽出同等能力的统一请求层。
  - 补坏代理、429/5xx、timeout、压缩 JSON 的本地测试。
  - 修复后更新 `docs/agent/web-inventory-upstream-implementation-index.md` 对应风险记录。
- 验收：
  - 库存请求仍能注入代理。
  - 库存请求在 429/5xx/timeout 下有统一 retry/backoff 行为。
  - 压缩响应能按共享 HTTP client 逻辑处理。

## A10-4 Skin DB 空目标会清空 `skin` 表

- 状态：已核验，待处理
- 优先级：高
- 位置：
  - `node_sidecar/src/skinDbSync.js`：生成 `targetRows`，约第 649 行；`targetKeys` 为空时执行 `DELETE FROM skin`，约第 732 行；JSON 校验只要求数组，约第 835、841 行
  - `tools/rebuildSkinDb.js`：读取 JSON 后调用 `syncSkinDb`，约第 63 行
  - `tools/fetchAndRebuildSkinDb.js`：抓取结果只检查是不是数组，约第 46、47 行
  - `tests/skinDbSync.test.js`
  - `tests/fetchAndRebuildSkinDb.test.js`
  - `docs/project-cognition-map.md`
- 核验结论：
  - 上游返回 `[]`，或输入数组全部被过滤成空目标时，已有 `skin` 表会被清空。
  - CLI 重建和在线抓取重建都没有空结果闸门。
  - 重建前备份 DB 是已有保护，但只是事后恢复，不是清表前保护。
- 建议任务：
  - 空目标默认 fail-closed，不清表。
  - 增加最小数量阈值、外部源成功标志，或 staged rebuild + 显式确认。
  - 补“已有记录 + 输入空数组不应清表”的回归测试。
  - 补“在线抓取返回空数组不应进入重建”的工具测试。
- 验收：
  - 空数组或过滤后空目标不能删除已有 `skin` 表数据。
  - 真正需要清表时必须有明确、可审计的强制参数。

## A10-5 `request@2.88.2` 废弃依赖仍在主链路代理分支

- 状态：已核验，待评估替换
- 优先级：中
- 位置：
  - `node_sidecar/package.json`：`request` 是生产依赖，约第 30 行
  - `node_sidecar/package-lock.json`
  - `node_sidecar/src/proxyConfig.js`：`require("request")`，约第 232 行
  - `node_sidecar/src/tradeService.js`
  - `node_sidecar/src/steamMarketService.js`
  - `node_sidecar/src/uiServer.js`
  - `node_sidecar/tests/proxy-config.test.js`
  - `node_sidecar/tests/steam-community-proxy.test.js`
- 核验结论：
  - `request@2.88.2` 仍是 `node_sidecar` 的生产依赖。
  - 项目代码有一处直接 `require("request")`，在 HTTP/HTTPS 代理存在时传给 `steamcommunity`。
  - 交易确认、市场确认等主功能链路会创建 `SteamCommunity(getSteamCommunityOptions())`，所以有代理时废弃依赖进入主链路。
  - 不是全仓大量直接使用；项目直接使用主要在代理分支。
  - `steamcommunity@3.50.0` 自身也依赖 `request`，即使移除项目直接依赖，也要评估上游库限制。
- 建议任务：
  - 先确认 `steamcommunity` 是否必须使用 `request` 才能支持代理。
  - 如果可以，改用更现代的 request adapter 或库支持的替代配置。
  - 如果短期无法替换，把风险写进依赖审查清单，并锁定代理分支测试。
- 验收：
  - 代理场景下交易/市场确认仍可用。
  - 依赖审查能清楚说明 `request` 是暂时保留、可替换，还是由上游库强制带入。

## A11 Steam 钱包余额来源边界未清晰/需统一

- 状态：已处理
- 优先级：中高
- 位置：
  - `node_sidecar/src/uiServer.js`：本地余额查询接口 `POST /api/accounts/fetch-balance`
  - `node_sidecar/src/steamAccountTools.js`：`fetchBalance()` 先查 Steam Store API，再解析 Store account 页面兜底
  - `node_sidecar/src/authService.js`、`node_sidecar/src/cs2Session.js`：登录/账号画像链路可能从 Steam client/CM session 的 `steam.wallet` 读到 `wallet_balance`，来源约为 `steam_cm`
  - `node_sidecar/ui/app.js`：余额展示、刷新和账号画像展示入口
  - `docs/project-cognition-map.md`
- 问题：Web/Store 查询到的 Steam 钱包余额、Steam client/CM 账号画像里带出的钱包余额、GC/活动/军械库余额不是同一件事。Steam 钱包余额可以继续挂在账号下，Web/Store 与 Steam client/CM 两种方式都可以作为账号余额来源，并以最新一次成功获取的来源作为当前账号余额值；但两种来源不能互相兜底。Steam client/CM 本次没拿到余额时，不能拿 Web/Store 的旧值当作本次 Steam client/CM 成功结果；Web/Store 本次查询失败时，也不能拿 Steam client/CM 的旧值当作本次 Web/Store 查询成功结果。当前项目需要确认展示、刷新、缓存和覆盖规则，否则用户会分不清当前值来自哪次成功来源，或者把失败来源误认为成功。
- 建议任务：
  - 明确 Steam 钱包余额的来源边界：Web/Store 主动查询、Steam client/CM 画像读取、GC/活动余额分别命名和记录来源。
  - 账号下保留一个当前 Steam 钱包余额值时，同步记录 `source`、`observed_at`、`currency` 或等价元数据，用最新一次成功来源更新当前值。
  - 梳理余额展示、刷新、缓存、过期和覆盖规则：成功来源可以覆盖当前值；失败来源不能用另一来源兜底，也不能把旧值包装成本次成功结果。
  - 如果 UI 同时展示多类余额，给出可理解的来源或更新时间口径，避免混淆 Steam 钱包余额与 GC/活动余额。
  - 补最小测试或运行态验证，覆盖主动刷新、登录画像更新、来源成功覆盖、来源失败不兜底、缓存命中和来源切换场景。
- 验收：
  - 用户能明确区分 Steam 钱包余额、Steam client/CM 画像余额、GC/活动余额。
  - 当前账号余额值来自最新一次成功获取的 Steam 钱包来源，并能看出来源和更新时间。
  - 主动点击 Web/Store 余额刷新失败时，不会返回或保存 Steam client/CM 的旧值作为本次 Web/Store 成功结果。
  - Steam client/CM 画像没有拿到余额时，不会返回或保存 Web/Store 的旧值作为本次 Steam client/CM 成功结果。
  - 账号画像更新时不会把来源不明、失败来源或过期兜底值写成可信新余额。
  - 地图或审查记录说明余额来源、刷新入口、缓存/覆盖规则和未覆盖范围。
- 已处理说明：已为账号级 Steam 钱包余额新增来源元数据口径：`balance_source`、`balance_currency`、`balance_observed_at`，由 `AppAuthStore` 跟随 `steam_account.balance` 持久化。Web/Store 主动查询入口 `POST /api/accounts/fetch-balance` 记为 `steam_store`，成功且本地持久化成功才返回 `persisted:true`、`source`、`observed_at`；查询失败或本地持久化失败不使用 CM 旧值兜底，也不把来源元数据包装成本次成功。Steam client/CM 账号画像入口 `/api/accounts/profile` / `resolveAccountProfile()` 记为 `steam_cm`，CM 没有钱包余额时不使用 Web/Store 旧值兜底。GC/军械库 `redeemable_balance` 仍是独立余额，不参与 Steam 钱包余额。本轮目标测试记录为 `node tests/app-auth-store.test.js`、`node tests/account-scope-route.test.js`、`node tests/account-profile-route-scope.test.js`、`node tests/wallet-balance-source-ui.test.js`、`node tests/web-inventory-bootstrap.test.js` 均已通过；未启动真实 Electron/UI，未访问真实 Steam/真实账号/真实网络，未跑全量 `npm test`。
