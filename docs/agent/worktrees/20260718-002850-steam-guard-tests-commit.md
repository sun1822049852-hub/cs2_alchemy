---
status: archived
target: Repair three stale baseline tests, verify the Steam Guard plan, and commit the isolated Guard changes.
handoff_id: 20260718-002850-steam-guard-tests-commit
parent_handoff_id: 20260717-201357-steam-guard-coexist
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
allowed_paths:
  - node_sidecar/src/authService.js
  - node_sidecar/src/appAuthStore.js
  - node_sidecar/src/accountStore.js
  - node_sidecar/src/refreshWorkflow.js
  - node_sidecar/src/services/refreshRuntime.js
  - node_sidecar/src/steamWebSession.js
  - node_sidecar/src/steamAccountTools.js
  - node_sidecar/src/gcSessionCaptureWorkflow.js
  - node_sidecar/src/redeemMissionRewardWorkflow.js
  - node_sidecar/src/uiServer.js
  - node_sidecar/src/services/sessionPool.js
  - node_sidecar/src/services/componentOpsService.js
  - node_sidecar/src/services/craftService.js
  - node_sidecar/src/services/weaponArmoryService.js
  - node_sidecar/src/steamGuardEnrollService.js
  - node_sidecar/src/steamGuardCoexistService.js
  - node_sidecar/src/steamGuardSteamAdapter.js
  - node_sidecar/src/steamGuardTokenService.js
  - node_sidecar/src/tokenRecoveryService.js
  - node_sidecar/ui/app.js
  - node_sidecar/ui/index.html
  - node_sidecar/ui/styles.css
  - node_sidecar/scripts/runNodeTests.js
  - node_sidecar/tests/**
  - tests/**
  - docs/project-cognition-map.md
  - docs/agent/session-log.md
  - docs/agent/handoffs/20260717-201357-steam-guard-coexist.md
  - docs/agent/worktrees/20260717-201357-steam-guard-coexist.md
  - docs/agent/handoffs/20260718-002850-steam-guard-tests-commit.md
  - docs/agent/worktrees/20260718-002850-steam-guard-tests-commit.md
forbidden_paths:
  - package.json
  - node_sidecar/package.json
  - node_sidecar/package-lock.json
  - csgo_skins.db
  - inventory_ui_state.json
  - accounts.json
  - login_keys.json
  - client_config.json
  - backup/ui_state/**
  - node_sidecar/src/services/craftAssistService.js
  - node_sidecar/src/services/tradeupSimulationService.js
  - admin_console/**
updated_at: 2026-07-18T01:15:45+08:00
last_verified: 2026-07-18; npm test passed 111 default Node tests in 46.1s, node --check passed for 42 changed/new JavaScript files, git diff --check passed, and no forbidden paths changed. Browser interaction tests and real Steam accounts were not verified.
---

# Worktree Registry

This continuation remains in the user-requested isolated Guard worktree. The main worktree and its unrelated UI, recipe, runtime, and workflow changes are forbidden for writes and commit staging.
