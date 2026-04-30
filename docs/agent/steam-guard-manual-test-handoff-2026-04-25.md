# Steam Guard Manual Test Handoff (2026-04-25)

## 当前目标

- 总目标：完成 `Steam Guard` 绑定令牌纠偏主线的真实手工烟测，确认 `new_enroll / replace_existing`、`token-detail`、以及破损 `maFile` 的 Web Session fallback 在真实运行态可用。
- 当前方案 / plan：
  [docs/superpowers/plans/2026-04-25-steam-guard-token-binding-correction.md](/C:/Users/18220/Desktop/cs2_alchemy/docs/superpowers/plans/2026-04-25-steam-guard-token-binding-correction.md)

## 进度断点

- 当前 chunk：Chunk 4 / Focused Verification
- 当前 task：真实手工烟测尚未完成
- 已完成内容：
  - 代码与自动化回归已提交到 `ffe1060`:
    `Fix Steam Guard token flows and detail modal`
  - 后端已支持：
    - `new_enroll`
    - `replace_existing`
    - 统一 `maFile` builder
    - `/api/accounts/token-detail` 脱敏
    - 破损 `maFile` -> `TokenStore` fallback
  - 前端已支持：
    - 绑定弹窗 mode 文案
    - 令牌详情弹窗 parser fallback
    - 真实运行态修复 `api()` 二次 `.json()` 导致的 `resp.json is not a function`
  - 自动验证已跑过：
    - `node node_sidecar/tests/steam-guard-enroll-service.test.js`
    - `node node_sidecar/tests/token-detail-route.test.js`
    - `node node_sidecar/tests/steam-guard-web-session-fallback.test.js`
    - `node tests/tokenDetailModalDisplay.test.js`
    - `node tests/steamGuardEnrollCopy.test.js`
- 正在等待内容：
  - 真实账号手工验证首次绑定链
  - 真实账号手工验证替换旧令牌链
  - 真实 UI 下再次确认 token detail、Web Session 相关调用是否正常

## 现场状态

- 工作目录：
  `C:/Users/18220/Desktop/cs2_alchemy`
- 当前分支：
  `main`
- 已提交断点：
  `ffe1060 Fix Steam Guard token flows and detail modal`
- 当前工作树仍有大量未提交改动，且不是本 handoff 主线，主要包括：
  - `Web Inventory` 相关代码与测试
  - `old-contract-cleanup` 相关文档
  - `backup/ui_state/*` 运行态噪音
- 关键提醒：
  - 不要为了继续 `Steam Guard` 手测把这些无关脏项一起提交
  - 若需要继续改 `Steam Guard`，优先基于 `ffe1060` 之后增量推进

## 错误与约束

- 已查明并修复的坑：
  - `token detail` 在真实 Electron 窗口里显示 `ERROR` 的根因不是后端没更新，而是前端 `api()` helper 已返回 JSON，但调用侧又写了 `await resp.json()`。
  - Electron 窗口内嵌 `uiServer` 使用随机端口；独立 `node node_sidecar/src/uiServer.js` 的 `8787` 进程可能同时存在，排查时不能把两条链混看。
- 后续不要再犯：
  - 凡是 `node_sidecar/ui/app.js` 里调用 `api(...)`，不要再写 `const resp = await api(...); await resp.json()`
  - 不要把 `8787` 独立进程误当成 Electron 当前窗口后端
- 必须保持不变的关键行为：
  - `status=29` 必须走 `replace_existing`，不能回退成终态错误
  - 成功生成的 `maFile` 必须保留：
    - `Session.SteamID`
    - `Session.SteamLoginSecure`
    - 顶层 `access_token`
    - `identity_secret`
    - `fully_enrolled`
  - `token-detail` 必须继续返回 parser fallback 所需的 `shared_secret`
  - 前端必须先显示服务端 `currentTotp`，再尝试本地重算

## 验证状态

- 已执行验证：
  - 自动测试全绿，见上方列表
  - 真实运行态通过 CDP 连到 Electron 同源端口，执行：
    `openTokenDetailModal('gb840489')`
    成功得到有效码与脱敏后的原始 JSON
- 尚未覆盖的验证缺口：
  - 未完成真实账号 “首次绑定” 全流程人工确认
  - 未完成真实账号 “替换旧令牌” 全流程人工确认
  - 未确认旧破损 `maFile` 账号在真实桌面流程里是否成功走到 fallback，而不仅是测试脚本覆盖

## 下一步第一刀

1. 先在真实桌面窗口里手测 `Steam Guard`：
   - 找一个未绑定令牌的账号，跑一次 `new_enroll`
   - 找一个已绑定旧令牌的账号，跑一次 `replace_existing`
2. 每做完一条链，立刻验证：
   - 绑定成功后打开令牌详情弹窗
   - 确认 TOTP 码正常滚动，不再是 `ERROR`
   - 再触发一条依赖 Web Session 的动作，确认 `maFile` 消费链正常
3. 若任一步失败：
   - 先记录账号名、窗口端口、弹窗错误文本
   - 再抓运行态，不要回到静态猜测

## 下个会话启动指令

```text
先读 docs/agent/steam-guard-manual-test-handoff-2026-04-25.md、
docs/superpowers/plans/2026-04-25-steam-guard-token-binding-correction.md、
docs/agent/memory.md 和当前 git status。
先复述当前目标、已完成断点（commit ffe1060）、未完成的手工验证项与下一步动作。
不要重做已通过的自动测试实现；若文档与现场冲突，先指出差异再收敛。
继续手工测试后，把结果补回 docs/agent/session-log.md 或新的 handoff 文件。
```

## 补充提醒

- 本 handoff 只覆盖 `Steam Guard` 主线，不覆盖 `Web Inventory`、`old-contract-cleanup`、market listing 等其他脏线。
- 若要再启动 Electron 排查运行态，优先先确认当前窗口实际监听端口，而不是先打固定 `8787`。
