# Admin Console Membership Control Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real admin control plane with admin sessions, membership plans, per-user permission overrides, device session revocation, and a minimal web console UI.

**Architecture:** Extend `admin_console`'s SQLite store into a full control-plane schema. Keep end-user auth APIs unchanged on the surface, but switch bundle signing to use resolved entitlements instead of hardcoded full permissions. Expose a small admin web app from the same Node server so administrators can log in, inspect users, adjust plans and permissions, and revoke device sessions.

**Tech Stack:** Node.js CommonJS, `node:sqlite`, built-in `http`/`crypto`, plain HTML/CSS/JS frontend, `node:assert` tests.

---

## Chunk 1: Store Model

### Task 1: Add failing store tests for admin auth, plans, overrides, and device sessions

**Files:**
- Modify: `admin_console/tests/control-plane-store.test.js`
- Modify: `admin_console/src/controlPlaneStore.js`

- [ ] Write failing assertions for default membership plans and resolved entitlements.
- [ ] Run `node admin_console/tests/control-plane-store.test.js` and confirm failure.
- [ ] Implement minimal schema and store methods.
- [ ] Re-run `node admin_console/tests/control-plane-store.test.js` until green.

## Chunk 2: Admin API And Signed Entitlements

### Task 2: Add failing server tests for bootstrap, login, user management, and device revoke

**Files:**
- Modify: `admin_console/tests/control-plane-server.test.js`
- Modify: `admin_console/src/server.js`
- Modify: `admin_console/src/entitlementSigner.js`

- [ ] Write failing assertions for admin bootstrap/login/session/user update/device revoke flows.
- [ ] Run `node admin_console/tests/control-plane-server.test.js` and confirm failure.
- [ ] Implement minimal admin HTTP API and wire bundle signing to store entitlements.
- [ ] Re-run `node admin_console/tests/control-plane-server.test.js` until green.

## Chunk 3: Admin UI And Operator Tooling

### Task 3: Add console UI shell and bootstrap script

**Files:**
- Create: `admin_console/ui/index.html`
- Create: `admin_console/ui/app.js`
- Create: `admin_console/ui/styles.css`
- Create: `tools/initControlPlaneAdmin.js`
- Modify: `admin_console/README.md`
- Modify: `admin_console/package.json`

- [ ] Add a minimal admin login + user management UI served by `admin_console`.
- [ ] Add a CLI entrypoint to create or reset the first control-plane admin account.
- [ ] Document startup and bootstrap steps for operators.
- [ ] Run focused verification after wiring the UI shell.

## Verification

- Run: `node admin_console/tests/control-plane-store.test.js`
- Run: `node admin_console/tests/control-plane-server.test.js`
- Run: `node node_sidecar/tests/control-plane-auth-client.test.js`

## Notes

- Keep secrets in ignored `tmp/*.env` files only.
- Do not revert unrelated pending changes elsewhere in the repository.
- Preserve the existing client contract for `/api/auth/*` responses while changing how permissions are resolved internally.
