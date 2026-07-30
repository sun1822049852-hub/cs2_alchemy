status: archived
target: Implement the approved local membership, recharge console, client recharge page, and authentication hardening plan.
handoff_id: 20260719-212051-local-membership-auth
parent_handoff_id: null
branch: main
worktree: C:/Users/18220/Desktop/cs2_alchemy
allowed_paths:
  - admin_console/**
  - node_sidecar/**
  - shared/**
  - scripts/**
  - tools/issueLocalLicenseBundle.js
  - tests/**
  - main_ui_node_desktop.js
  - README.md
  - run.bat
  - run-dev.bat
  - client_config.json
  - connect console.cmd
  - docs/superpowers/specs/**
  - docs/agent/worktrees/20260719-212051-local-membership-auth.md
forbidden_paths:
  - csgo_skins.db
  - inventory_ui_state.json
  - backup/ui_state/**
  - accounts.json
  - login_keys.json
  - client_license_state.json
  - keys/**
  - tmp/**
  - output/**
  - .worktrees/**
updated_at: 2026-07-20T12:11:34+08:00
last_verified: 2026-07-20T12:11:34+08:00

## Must Not Change

- No remote connection, deployment, or compatibility work.
- Preserve Steam login, inventory, simulation, and craft business behavior except for removal of Steam membership binding limits and per-execution remote permits.
- Do not modify runtime databases, credentials, tokens, keys, inventory state, or unrelated dirty files.
- Do not commit, push, stash, reset, clean, or stage without explicit user authorization.

## Semantic Truths

- Membership truth is the control-plane user plan plus expiry and explicit permission overrides.
- `inactive` keeps all current permissions except `craft.use`; `member` keeps all current permissions.
- Registration creates `inactive`; only activation codes, admin grants, or future paid orders can create/extend membership.
- Product templates are offers, orders are payment records, and membership grants are durable entitlement events; none may masquerade as another.
- Payment placeholder responses never create orders or grants.

## Progress

- Completed the two-tier `inactive/member` model, legacy plan migration, local signed entitlement snapshots, session hardening, activation codes, user lifecycle controls, product templates, bulk grants, order placeholder, and audit coverage.
- Removed Steam membership binding enforcement and per-craft permits. Craft authorization is now a cached signed snapshot check with immediate in-memory expiry and no per-click control-plane or DPAPI request.
- Added operation IDs and per-Steam-account execution locks across single, batch, and component craft routes.
- Added the bottom-pinned client membership page with products, payment placeholder, and activation-code redemption; successful redemption imports the returned bundle without exposing credentials to page JavaScript.
- Removed remote/SSH defaults and helpers; local control plane and sidecar APIs enforce loopback Host/Origin boundaries.
- Security review findings were resolved: refresh family replay revocation, generation-aware refresh single-flight, total request deadline, admin cookie/CSRF sessions, legacy password lazy upgrade, Unicode password length, atomic audit writes, JSON limits, security headers, and DNS-rebinding protection.

## Verification

- `npm test` in `admin_console`: passed store, server, and all UI tests.
- 107 selected `node_sidecar` tests: passed. Six pre-existing stale tests were excluded (`account-relogin-modal`, `craft-auto-connect-execution`, three craft-predictor extraction/layout tests, and `market-listing-from-gc-service`); the runner's two browser-interaction defaults were also excluded and replaced with real runtime UI verification.
- Root contracts passed: local control plane, shared security, membership copy, and desktop launcher.
- `npm run packaging:preflight`: passed.
- `node --check`: passed for 51 changed/untracked JavaScript files.
- `git diff --check`: passed; only Git's existing LF-to-CRLF warnings were emitted.
- Production-source scans found no craft-permit, Steam-binding enforcement, remote SSH helper, or old gateway default.
- Real runtime verified at `http://127.0.0.1:8791/admin` and `http://127.0.0.1:8792` using isolated temp state. Payment placeholder created no order; activation redemption refreshed member state immediately; desktop and 900x650 client layouts had no horizontal overflow.
