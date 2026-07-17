---
status: archived
target: Implement Steam Guard coexist binding, token management, and refresh-token self-healing.
handoff_id: 20260717-201357-steam-guard-coexist
parent_handoff_id: null
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
allowed_paths:
  - node_sidecar/src/authService.js
  - node_sidecar/src/appAuthStore.js
  - node_sidecar/src/accountStore.js
  - node_sidecar/src/tokenStore.js
  - node_sidecar/src/refreshWorkflow.js
  - node_sidecar/src/services/refreshRuntime.js
  - node_sidecar/src/steamWebSession.js
  - node_sidecar/src/steamAccountTools.js
  - node_sidecar/src/cs2Session.js
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
  - node_sidecar/tests/**
  - tests/**
  - docs/project-cognition-map.md
  - docs/agent/handoffs/20260717-201357-steam-guard-coexist.md
  - docs/agent/worktrees/20260717-201357-steam-guard-coexist.md
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
updated_at: 2026-07-18T00:28:50+08:00
last_verified: focused Steam Guard/auth/account/session/refresh/Web/UI tests passed; desktop and 390px UI checked at 127.0.0.1:8791; full npm test blocked by four documented unrelated baseline UI/recipe tests; real Steam accounts not tested
---

# Worktree Registry

This session uses the user-requested isolated worktree. The main worktree contains unrelated uncommitted UI/recipe changes and remains untouched.

The `uiServer.js` batch maFile import route is explicitly outside the behavioral scope even though the same integration file is allowed for the new Steam Guard APIs.

Continuation moved to `20260718-002850-steam-guard-tests-commit` after explicit user approval to repair the three baseline tests and commit the Guard work.
