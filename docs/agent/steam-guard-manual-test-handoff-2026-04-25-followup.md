# Steam Guard Manual Test Handoff (2026-04-25 Follow-up)

## 当前目标

- 总目标：完成 `Steam Guard` 绑定令牌纠偏主线的真实手工烟测，确认 `new_enroll / replace_existing`、`token-detail`、以及破损 `maFile` 的 Web Session fallback 在真实运行态可用。
- 当前方案 / plan：
  [docs/superpowers/plans/2026-04-25-steam-guard-token-binding-correction.md](/C:/Users/18220/Desktop/cs2_alchemy/docs/superpowers/plans/2026-04-25-steam-guard-token-binding-correction.md)

## 进度断点

- 当前 chunk：Chunk 4 / Focused Verification
- 当前 task：真实手工烟测仍未完成，但本轮已把两个 live blocker 收敛到“样本条件不足”
- 已完成内容：
  - 已确认 `HEAD` 仍是 `ffe1060 Fix Steam Guard token flows and detail modal`
  - 已继续验证并确认 `token-detail` 在真实页面可用：`gb840489` 的 TOTP 能正常显示，`rawData` 不再报错
  - 已修复本轮手测中暴露的两个运行态阻塞：
    - `/api/accounts/enroll-steam-guard` 因 `tokenStore.close is not a function` 直接 500
    - 绑定弹窗把真实 `ok:false` 业务态误显示成 `请求失败：http 200`
  - 已新增并跑过：
    - `node node_sidecar/tests/steam-guard-enroll-route.test.js`
    - `node tests/steamGuardEnrollErrorHandling.test.js`
    - `node tests/steamGuardEnrollCopy.test.js`
- 正在等待内容：
  - 至少一个“已绑定手机号”的真实账号样本，用于继续验证 `new_enroll` 或 `replace_existing`
  - 一个现成破损 `maFile` 样本，或一份可丢弃的运行态副本，用于继续验证 Web Session fallback

## 现场状态

- 工作目录：
  `C:/Users/18220/Desktop/cs2_alchemy`
- 当前分支：
  `main`
- 当前工作树：
  - 仍然是脏树，且混有大量非本主线改动：
    - `Web Inventory` 相关代码与测试
    - `old-contract-cleanup` 相关文档
    - `backup/ui_state/*` 运行态噪音
  - 本轮新增 / 更新的 Steam Guard 相关文件：
    - [node_sidecar/src/uiServer.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/src/uiServer.js)
    - [node_sidecar/ui/app.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js)
    - [node_sidecar/tests/steam-guard-enroll-route.test.js](/C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/steam-guard-enroll-route.test.js)
    - [tests/steamGuardEnrollErrorHandling.test.js](/C:/Users/18220/Desktop/cs2_alchemy/tests/steamGuardEnrollErrorHandling.test.js)
    - [docs/agent/session-log.md](/C:/Users/18220/Desktop/cs2_alchemy/docs/agent/session-log.md)
    - [docs/agent/memory.md](/C:/Users/18220/Desktop/cs2_alchemy/docs/agent/memory.md)
- 运行态提醒：
  - 旧的独立 `8787` 进程可能仍在，不能把它当成本轮修补后的后端实例
  - 本轮验证用过临时 `8788`，结束前已手动停止；下轮若还要手测，记得重起一个明确的新实例

## 错误与约束

- 已查明并修复的坑：
  - `TokenStore` 没有 `close()`，不能在 enroll route 无条件调用
  - `api()` 会在 `body.ok === false` 时直接抛错，绑定弹窗必须读 `err.data` 才能显示真实业务错误
- 仍然存在的业务阻塞：
  - 当前 12 个带 refresh token 的真实账号逐个请求 `/api/accounts/enroll-steam-guard`，全部返回 `no_phone_number (status=2)`
  - 当前账户集中只有 `gb840489` 有健康 `maFile`，没有现成破损 `maFile` 样本可做 live fallback 手测
- 后续不要再犯：
  - 不要在后端代码修完后继续拿旧 `8787` 进程结果做裁决
  - 不要把 `HTTP 200 + ok:false` 误判成网络异常；先看 `err.data.reason/message`
  - 不要为了做 fallback 手测直接破坏主运行态数据库；优先复制到临时 runtime 副本
- 必须保持不变的关键行为：
  - `status=29` 必须继续走 `replace_existing`
  - `token-detail` 必须继续保留 parser fallback 所需的 `shared_secret`
  - 前端必须先显示服务端 `currentTotp`

## 验证状态

- 已执行验证：
  - `node node_sidecar/tests/steam-guard-enroll-route.test.js`
  - `node tests/steamGuardEnrollErrorHandling.test.js`
  - `node tests/steamGuardEnrollCopy.test.js`
  - 真实 DOM 验证：
    - `http://127.0.0.1:8788` 上 `openTokenDetailModal('gb840489')` 可显示有效 5 位 Steam TOTP
    - `countsteam002` / `gb840489` 的绑定弹窗都会显示 `该账号未绑定手机号，请先在 Steam 客户端绑定手机`
- 尚未覆盖的验证缺口：
  - 没有真实账号进入 `new_enroll` 验证码步骤
  - 没有真实账号进入 `replace_existing` 验证码步骤
  - 没有 live 破损 `maFile` 样本完成 Web Session fallback 手测

## 下一步第一刀

1. 先确认是否存在至少一个“已绑定手机号”的真实账号样本：
   - 若有，再重起一条新的独立 `uiServer` 实例，继续做 `new_enroll / replace_existing` Step 1 -> Step 2 的真实页面手测
   - 若没有，不要继续盲点现有 12 个账号
2. 若要补 fallback 手测：
   - 先复制主运行态到临时 runtime 副本
   - 在副本中把 `gb840489` 的 `mafile_content` 降成 `Session:{}` 之类的破损结构
   - 再用副本实例触发一条依赖 `resolveWebSessionForAccount()` 的真实路由，确认确实走到了 `TokenStore` fallback
3. 每做完一刀立刻验证：
   - 绑定页是否展示真实业务错误 / Step 2，而不是 generic `请求失败`
   - `token-detail` 是否仍正常
   - 路由所连的后端实例是否真的是新起的，不是旧 `8787`

## 下个会话启动指令

```text
先读 docs/agent/steam-guard-manual-test-handoff-2026-04-25-followup.md、
docs/superpowers/plans/2026-04-25-steam-guard-token-binding-correction.md、
docs/agent/memory.md、docs/agent/session-log.md 和当前 git status。
先复述当前目标、已完成断点（commit ffe1060 以及本轮 route/UI 修补）、未完成的手工验证项与下一步动作。
不要重做已通过的自动测试实现；若文档与现场冲突，先指出差异再收敛。
继续真实手工测试后，把结果补回 docs/agent/session-log.md，并在形成新的稳定约束时更新 docs/agent/memory.md。
```

## 补充提醒

- 当前可确认的是“实现与 UI 不再被运行态契约错配拦住”，不是“整条 Steam Guard 手工烟测已经完成”。
- 若下轮仍要用浏览器/CDP 联调，优先起一条全新的本地端口实例，不要继续复用历史探测页。
