---
status: continuation_started
target: Implement optional-password Guard-only maFile import with explicit differing-password resolution, transactional local-user binding, no-password account projection, and unified retryable five-slot Steam verification-code UX across ordinary login and coexist binding.
handoff_id: 20260719-182000-guard-only-import-code-flow
parent_handoff_id: 20260719-102000-login-guard-code-format
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
  - docs/agent/worktrees/20260719-102000-login-guard-code-format.md
  - docs/agent/worktrees/20260719-182000-guard-only-import-code-flow.md
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
  - Existing-account maFile attach/overwrite preserves password unless the imported non-empty password differs and the user explicitly selects overwrite; profile, balance, ban data, refresh token, Session and active-account selection always remain unchanged.
  - Coexist authentication remains isolated per flow in a dedicated child process; retryable email/App-code failures must not share or mutate ordinary connected sessions.
  - Account-list and code APIs must not expose maFile secrets, shared_secret, recovery code or new plaintext credential fields.
  - No dependency, schema, packaging or runtime-data changes.
dirty_overlap:
  - All allowed source and test files already contain approved Guard/import/relogin work from this same lineage. Preserve those changes and edit only the newly approved persistence, import, coexist lifecycle and verification-code surfaces.
updated_at: 2026-07-19T18:20:00+08:00
last_verified: Continued in child handoff 20260719-215809-guard-only-import-code-flow-resume after implementing the approved optional-password import, differing-password decision, transactional Guard-only persistence, no-password projection, isolated no-TTL coexist retry state and shared five-slot verification-code UI.
---

# Guard-only Import And Code Flow

Implement with RED/GREEN tests. Runtime completion requires the real 127.0.0.1:8799 page, desktop and narrow viewport evidence, and user-driven Steam credential/code entry for authenticated steps.
