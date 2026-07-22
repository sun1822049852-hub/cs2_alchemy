---
status: archived
target: Finish verification and review for optional-password Guard-only import, explicit differing-password resolution, transactional local-user binding, no-password projection, isolated coexist retry lifecycle, and shared five-slot Steam verification-code UI.
handoff_id: 20260719-215809-guard-only-import-code-flow-resume
parent_handoff_id: 20260719-182000-guard-only-import-code-flow
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
allowed_paths:
  - node_sidecar/src/appAuthStore.js
  - node_sidecar/src/accountStore.js
  - node_sidecar/src/steamGuardImportService.js
  - node_sidecar/src/steamGuardCoexistService.js
  - node_sidecar/src/steamGuardCoexistProcessAdapter.js
  - node_sidecar/src/steamGuardCoexistWorker.js
  - node_sidecar/src/steamGuardCoexistWorkerCore.js
  - node_sidecar/src/uiServer.js
  - node_sidecar/ui/index.html
  - node_sidecar/ui/app.js
  - node_sidecar/ui/styles.css
  - node_sidecar/tests/app-auth-store.test.js
  - node_sidecar/tests/account-store-sqlite.test.js
  - node_sidecar/tests/account-card-render.test.js
  - node_sidecar/tests/account-scope-route.test.js
  - node_sidecar/tests/account-relogin-modal.test.js
  - node_sidecar/tests/steam-guard-batch-import-route.test.js
  - node_sidecar/tests/steam-guard-batch-import-ui.test.js
  - node_sidecar/tests/steam-guard-coexist-route.test.js
  - node_sidecar/tests/steam-guard-coexist-service.test.js
  - node_sidecar/tests/steam-guard-coexist-process-adapter.test.js
  - node_sidecar/tests/steam-guard-coexist-worker.test.js
  - node_sidecar/tests/steam-guard-ui-contract.test.js
  - docs/project-cognition-map.md
  - docs/agent/worktrees/20260719-182000-guard-only-import-code-flow.md
  - docs/agent/worktrees/20260719-215809-guard-only-import-code-flow-resume.md
forbidden_paths:
  - C:/Users/18220/Desktop/cs2_alchemy/**
  - node_sidecar/src/authService.js
  - node_sidecar/src/tokenRecoveryService.js
  - node_sidecar/src/refreshWorkflow.js
  - node_sidecar/src/services/**
  - node_sidecar/src/tokenStore.js
  - node_sidecar/package.json
  - node_sidecar/package-lock.json
  - csgo_skins.db
  - inventory_ui_state.json
  - accounts.json
  - login_keys.json
must_not_change:
  - Ordinary Steam login and TokenStore/session-recovery behavior remain unchanged; batch import never contacts Steam and never writes refresh/access tokens or Session.
  - Password confirmation occurs only when an imported item matches an existing account, carries a non-empty password, and differs from the stored password; same or empty passwords never prompt or write.
  - Existing-account maFile attach/overwrite preserves profile, balance, ban data, refresh token, Session and active-account selection.
  - Coexist authentication remains isolated per flow in a dedicated child process; retryable email/App-code failures must not share or mutate ordinary connected sessions.
  - Account-list and code APIs must not expose maFile secrets, shared_secret, recovery code or new plaintext credential fields.
  - No dependency, schema, packaging or runtime-data changes; no commit without explicit user instruction.
dirty_overlap:
  - All allowed source and test files contain approved Guard/import/relogin work from the same lineage. Preserve these changes and do not touch unrelated dirty paths.
updated_at: 2026-07-20T10:15:00+08:00
child_handoff_id: 20260720-162348-deleted-account-legacy-reimport
last_verified: Targeted coexist route regression passed and a fresh `npm test` completed with `PASS 119 node_sidecar tests in 68.9s`. Existing accounts with complete or incomplete local maFile now start the isolated coexist process and leave remote authenticator detection to Steam. Desktop and 390x844 live UI evidence covers import/duplicate/token-management/account-state surfaces without horizontal overflow. The diff/security review excludes `.playwright-cli`, runtime databases, account stores and TokenStore data. Real Steam email/App-code binding, remote already-authenticator rejection and first Guard-only login remain user-driven E2E scope.
---

# Guard-only Import And Code Flow Resume

User explicitly approved continuing after interruption. Do not submit real Steam passwords or verification codes during automated runtime inspection.
