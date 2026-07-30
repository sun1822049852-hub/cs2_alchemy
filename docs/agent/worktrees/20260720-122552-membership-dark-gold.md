status: archived
target: Restyle the client membership recharge page to match the current dark-gold theme.
handoff_id: 20260720-122552-membership-dark-gold
parent_handoff_id: 20260719-212051-local-membership-auth
branch: main
worktree: C:/Users/18220/Desktop/cs2_alchemy
allowed_paths:
  - node_sidecar/ui/styles.css
  - node_sidecar/tests/membership-ui-contract.test.js
  - docs/agent/worktrees/20260720-122552-membership-dark-gold.md
forbidden_paths:
  - admin_console/**
  - node_sidecar/src/**
  - node_sidecar/ui/app.js
  - node_sidecar/ui/index.html
  - csgo_skins.db
  - inventory_ui_state.json
  - backup/ui_state/**
  - accounts.json
  - login_keys.json
  - client_license_state.json
  - keys/**
  - tmp/**
  - output/**
updated_at: 2026-07-20T12:30:24+08:00
last_verified: 2026-07-20T12:30:24+08:00

## Must Not Change

- Keep membership behavior, APIs, copy, DOM structure, and responsive layout unchanged.
- Do not alter other client pages or the admin console.
- Do not touch runtime databases, credentials, tokens, keys, state snapshots, or unrelated dirty files.
- Do not commit, push, stage, stash, reset, clean, or revert without explicit user authority.

## Result

- Scoped the membership recharge page to the established black/charcoal surfaces, soft gold borders, warm white text, and `#f3c779 -> #dca44c` primary-action gradient used by the current client theme.
- Preserved the existing layout, membership behavior, API calls, text, and responsive breakpoints.

## Verification

- `node tests/membership-ui-contract.test.js`: passed.
- `node tests/clientMembershipCopy.test.js`: passed.
- `git diff --check -- node_sidecar/ui/styles.css node_sidecar/tests/membership-ui-contract.test.js`: passed with only the existing LF-to-CRLF warning.
- Real runtime at `http://127.0.0.1:8792/`: desktop surfaces resolved to dark gradients and gold borders/actions; 900x650 rendered as one column with page `scrollWidth/clientWidth = 847/847` and document `scrollWidth/clientWidth = 885/885`.
