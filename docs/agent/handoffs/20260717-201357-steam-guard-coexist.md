---
status: implementation_complete_uncommitted
handoff_id: 20260717-201357-steam-guard-coexist
parent_handoff_id: null
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
updated_at: 2026-07-17T23:05:00+08:00
---

# Steam Guard Coexist Initial Handoff

## Goal

Replace the legacy Steam Guard enrollment/replacement flow with Steam App coexist binding, add backend-only token management, and add refresh-token self-healing for accounts that have a stored password and local Guard data.

## Approved Boundaries

- Existing-account mode reads the stored username/password; new Guard-only mode accepts username/password/optional remark.
- Remote `Requires2FA`, `DeviceCode`, `DeviceConfirmation`, or `AddAuthenticator status=29` means the Steam account already has an authenticator. Stop without finalizing, removing, replacing, or importing that authenticator.
- Candidate Guard data is persisted only after the user completes Steam App binding and the submitted five-character code matches the locally generated code.
- Temporary login refresh/access tokens are never persisted by the coexist flow.
- Batch maFile import remains unchanged.
- Public account projections must not expose plaintext passwords or maFile content.
- Missing or explicitly rejected refresh tokens may self-heal once through stored password + local TOTP; network failures must not trigger credential recovery.

## Must Not Change

- Do not modify runtime account, token, database, inventory state, or backup files.
- Do not change package dependencies.
- Do not change batch maFile import behavior.
- Do not change craft, simulation, inventory, market, confirmation, or ban business semantics except for using the shared authentication recovery entry.
- Do not call Steam authenticator finalize/remove/replace APIs.
- Do not commit, merge, push, or delete the worktree unless the user explicitly asks.

## Current State

- Worktree created from committed `main` at `34b0f08`.
- Legacy SMS/finalize/replacement code and routes are removed. Coexist binding, backend-only token management, safe account projections, token self-healing, session invalidation and single-retry consumers are implemented.
- Existing-account and Guard-only persistence paths are covered; temporary tokens and candidate secrets are not returned by HTTP or written to `TokenStore` during coexist binding.
- Focused Steam Guard/auth/account/session/refresh/Web/UI tests pass, `node --check` and `git diff --check` pass.
- Real UI was checked at `http://127.0.0.1:8791/` in desktop and 390px viewports. Mode switching and cancel/close work, no horizontal overflow or browser console errors were observed. Guest preview prevents opening the real token-management modal without seeding account data.
- Full `npm test` remains blocked by committed-baseline VM/CSS tests outside this plan: `account-relogin-modal.test.js` and `craft-auto-connect-execution.test.js` lack `applyClientPermissionToButton`, `craft-assist-panel-render.test.js` lacks `resolveCraftAssistTargetWearPair`, and `craft-predictor-grid-layout.test.js` expects an unrelated scrollbar selector.
- Real Steam validation with one unbound and one already-bound test account was not run because no test credentials were supplied.
- No commit, merge, push, or main-worktree mutation was performed.
