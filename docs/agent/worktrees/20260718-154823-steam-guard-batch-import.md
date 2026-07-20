---
status: archived
target: Implement approved Guard-only batch maFile import, duplicate overwrite UI, not-logged-in card state, and local token deletion.
handoff_id: 20260718-154823-steam-guard-batch-import
parent_handoff_id: 20260718-135149-steam-guard-main-merge
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
allowed_paths:
  - node_sidecar/src/accountStore.js
  - node_sidecar/src/appAuthStore.js
  - node_sidecar/src/maFileParser.js
  - node_sidecar/src/steamGuardTokenService.js
  - node_sidecar/src/steamGuardImportService.js
  - node_sidecar/src/uiServer.js
  - node_sidecar/ui/app.js
  - node_sidecar/ui/index.html
  - node_sidecar/ui/styles.css
  - node_sidecar/tests/account-card-render.test.js
  - node_sidecar/tests/account-store-sqlite.test.js
  - node_sidecar/tests/app-auth-store.test.js
  - node_sidecar/tests/steam-guard-batch-import-route.test.js
  - node_sidecar/tests/steam-guard-batch-import-ui.test.js
  - node_sidecar/tests/steam-guard-token-route.test.js
  - node_sidecar/tests/steam-guard-token-service.test.js
  - node_sidecar/tests/steam-guard-ui-contract.test.js
  - docs/project-cognition-map.md
  - docs/agent/session-log.md
  - docs/agent/handoffs/20260718-154823-steam-guard-batch-import.md
  - docs/agent/worktrees/20260718-154823-steam-guard-batch-import.md
forbidden_paths:
  - C:/Users/18220/Desktop/cs2_alchemy/**
  - package.json
  - node_sidecar/package.json
  - node_sidecar/package-lock.json
  - csgo_skins.db
  - inventory_ui_state.json
  - accounts.json
  - login_keys.json
  - client_config.json
  - backup/ui_state/**
  - node_sidecar/src/steamGuardCoexistService.js
  - node_sidecar/src/steamGuardSteamAdapter.js
  - node_sidecar/src/tokenRecoveryService.js
  - node_sidecar/src/services/craftAssistService.js
  - node_sidecar/src/services/tradeupSimulationService.js
  - admin_console/**
updated_at: 2026-07-18T16:40:00+08:00
last_verified: 2026-07-18; implementation complete and uncommitted; npm test passed 113 default Node tests in 50.5s; 14 JS syntax checks passed; desktop and 390px synthetic-data browser QA passed; no real Steam or production database operation.
---

# Worktree Registry

The approved implementation completed only in the isolated Guard worktree. The dirty main worktree remained forbidden and untouched. This registry is archived; the uncommitted diff remains in the worktree pending explicit user commit or integration authority.
