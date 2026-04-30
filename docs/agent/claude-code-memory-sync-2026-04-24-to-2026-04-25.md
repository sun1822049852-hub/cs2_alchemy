# Claude Code Memory Sync (2026-04-24 to 2026-04-25)

> 同步时间：2026-04-25
> 用途：把外部 Claude Code 记忆压成仓库内摘要，后续会话优先读本文件，不再默认翻 `.claude`。
> 说明：魔尊口中的“cloud code”按现场痕迹映射为本机 `C:/Users/18220/.claude` 下的 Claude Code 项目记忆与计划。

## 来源

- [C:/Users/18220/.claude/projects/c--Users-18220-Desktop-cs2-alchemy/memory/MEMORY.md](/C:/Users/18220/.claude/projects/c--Users-18220-Desktop-cs2-alchemy/memory/MEMORY.md)
- [C:/Users/18220/.claude/projects/c--Users-18220-Desktop-cs2-alchemy/memory/login-system-audit.md](/C:/Users/18220/.claude/projects/c--Users-18220-Desktop-cs2-alchemy/memory/login-system-audit.md)
- [C:/Users/18220/.claude/projects/c--Users-18220-Desktop-cs2-alchemy/memory/sim-export-craft.md](/C:/Users/18220/.claude/projects/c--Users-18220-Desktop-cs2-alchemy/memory/sim-export-craft.md)
- [C:/Users/18220/.claude/projects/c--Users-18220-Desktop-cs2-alchemy/memory/craft-predictor-global.md](/C:/Users/18220/.claude/projects/c--Users-18220-Desktop-cs2-alchemy/memory/craft-predictor-global.md)
- [C:/Users/18220/.claude/projects/c--Users-18220-Desktop-cs2-alchemy/memory/market-listing-confirm.md](/C:/Users/18220/.claude/projects/c--Users-18220-Desktop-cs2-alchemy/memory/market-listing-confirm.md)
- [C:/Users/18220/.claude/plans/purring-cooking-kernighan.md](/C:/Users/18220/.claude/plans/purring-cooking-kernighan.md)

## 已同步的稳定信息

- `Web Inventory` / `Market Listing` 这条昨日主线，仓库内优先阅读顺序已经固定为：
  - [web-inventory-upstream-implementation-index.md](/C:/Users/18220/Desktop/cs2_alchemy/docs/agent/web-inventory-upstream-implementation-index.md)
  - [2026-04-24-web-inventory-management-page.md](/C:/Users/18220/Desktop/cs2_alchemy/docs/superpowers/plans/2026-04-24-web-inventory-management-page.md)
  - [market-listing-confirm.md](/C:/Users/18220/Desktop/cs2_alchemy/docs/agent/market-listing-confirm.md)
- `Batch Craft` 与普通 `Craft Assist` 的前端设置是分离的：批量页偏好走 `batch_craft_ui_prefs_v1`，普通炼金页走 `craft_ui_prefs_v2`。后续若只改一边，默认不要互相串写。
- `Simulation -> Craft Assist Export` 在外部 Claude 会话里已被标记为“功能完成 + Playwright 全链路验证通过”；若后续回归，先查 `state.simulationPresets` 初始化时序与 `initSimulationPage()` 调用链，不要先怀疑导出映射本身。
- `Craft Predictor` 不是只挂在 `#craftPage` 里的局部面板了，而是 body 级 fixed 浮动面板；它已扩到 `#batchCraftPage` 可用。若后续再调位置或交互，先记住 handle 几何当前是 CSS 主导，`updateCraftPredictorHandleGeometry()` 在该外部记忆里被明确改成 no-op。
- 登录体系应按“两层门控 + 三条 Steam 路径”理解：
  - 第一层是 `Client Auth` 应用授权门控。
  - 第二层是 Steam 账号认证。
  - Steam 路径分为 TOTP、一前一后两阶段验证码、以及 `maFile/refresh_token -> Web Session` 消费链。
  - `QR` 登录截至 2026-04-25 仍只停留在方案与研究文档，不应假定已经落地。
- 2026-04-25 的外部登录审计把以下项记为仍需警惕的安全/清理债：
  - `steam_account.password` 仍是明文。
  - `steam_account.mafile_content` 仍是明文。
  - `login_keys.json` 里的 refresh token 仍是明文。
  - `accounts.json` legacy 状态仍在链路里。
  以上结论用于后续清债排程；若要实际删除旧链或改存储契约，先按现场代码再复核一次。

## 使用方式

- 后续若只是承接昨日 Claude Code 语境，先读本文件与 [memory.md](/C:/Users/18220/Desktop/cs2_alchemy/docs/agent/memory.md)，不要再从零翻 `.claude`。
- 只有当需要追原文措辞、原始冻结断点或外部会话的细节上下文时，才回到上面的外部来源文件。
