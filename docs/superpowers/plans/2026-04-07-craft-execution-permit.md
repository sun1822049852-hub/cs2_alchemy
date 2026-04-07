# Craft Execution Permit Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the existing `15-minute` signed entitlement bundle, but require a short-lived remote `craft permit` immediately before real craft execution so the control plane can re-authorize each run.

**Architecture:** Reuse the current control-plane refresh session as the authenticated channel. The local `uiServer` computes a canonical, secret-free payload hash for each craft request, asks the control plane for a `30-60 second` signed permit, verifies that permit locally with the shipped public key, and only then enters the actual craft services. Browser UI does not see the refresh token or permit payload.

**Tech Stack:** Node.js CommonJS, built-in `crypto`, existing HTTP server flow, existing signed bundle infrastructure, plain JS tests with `node:assert`.

**Execution note:** Keep changes uncommitted in this workspace unless the user explicitly asks for a commit.

---

## File Structure

**Create**

- `shared/craftPermitPolicy.js`
- `node_sidecar/src/craftPermitEnforcer.js`
- `node_sidecar/tests/craft-execution-permit.test.js`
- `docs/superpowers/specs/2026-04-07-craft-execution-permit-design.md`

**Modify**

- `admin_console/src/constants.js`
- `admin_console/src/controlPlaneStore.js`
- `admin_console/src/entitlementSigner.js`
- `admin_console/src/server.js`
- `admin_console/tests/control-plane-store.test.js`
- `admin_console/tests/control-plane-server.test.js`
- `node_sidecar/src/controlPlaneAuthClient.js`
- `node_sidecar/src/licenseConfig.js`
- `node_sidecar/src/uiServer.js`
- `node_sidecar/tests/control-plane-auth-client.test.js`
- `node_sidecar/tests/craft-permission-gate.test.js`

---

## Chunk 1: Shared Permit Contract

### Task 1: Define the signed craft permit shape and canonical hash helpers

**Files:**
- Create: `shared/craftPermitPolicy.js`
- Create: `node_sidecar/tests/craft-execution-permit.test.js`

- [ ] **Step 1: Write the failing permit policy test**

Cover:

- valid permit snapshot shape
- invalid when `device_id` is missing
- invalid when `payload_hash` is missing
- expired permit detection
- canonical hash excludes `password`

- [ ] **Step 2: Run the new test to verify it fails**

Run: `node node_sidecar/tests/craft-execution-permit.test.js`  
Expected: FAIL because `shared/craftPermitPolicy.js` does not exist.

- [ ] **Step 3: Implement the shared permit policy**

Export:

- `stableJsonStringify()` reuse or wrapper
- `buildCraftPermitPayload(action, body)`
- `hashCraftPermitPayload(action, body)`
- `validateCraftPermitSnapshot(snapshot)`
- `isCraftPermitExpired(snapshot, now)`

Rules:

- required fields: `sub`, `username`, `device_id`, `action`, `account_username`, `payload_hash`, `jti`, `iat`, `exp`
- `payload_hash` format is `sha256:<hex>`
- hash input must exclude `password` and any transient client-only fields

- [ ] **Step 4: Re-run the permit policy test**

Run: `node node_sidecar/tests/craft-execution-permit.test.js`  
Expected: PASS.

- [ ] **Step 5: Local verification checkpoint**

Review the canonical hash structure and confirm it covers:

- plain craft payloads
- recipe batch payloads
- component-source payloads

without leaking secrets into logs or signatures.

---

## Chunk 2: Control Plane Permit Issuance

### Task 2: Extend signing utilities to issue short-lived craft permits

**Files:**
- Modify: `admin_console/src/constants.js`
- Modify: `admin_console/src/entitlementSigner.js`
- Test: `admin_console/tests/control-plane-server.test.js`

- [ ] **Step 1: Write or extend the failing signer coverage**

Add assertions that:

- permit TTL defaults to `30` or `60` seconds
- permit snapshot contains `action`, `account_username`, and `payload_hash`
- permit signature verifies with the shipped public key

- [ ] **Step 2: Run the control-plane server test to verify failure**

Run: `node admin_console/tests/control-plane-server.test.js`  
Expected: FAIL because craft permit signing is not implemented.

- [ ] **Step 3: Implement permit issuance**

In `admin_console/src/constants.js`, expose:

- `CRAFT_PERMIT_TTL_SECONDS`

In `admin_console/src/entitlementSigner.js`, add:

- `issueCraftPermit({user, deviceId, action, accountUsername, payloadHash, ttlSeconds, source})`

Implementation requirements:

- reuse the existing private key loader
- create a signed snapshot separate from the regular bundle format
- keep permit TTL independent from the `15-minute` bundle TTL

- [ ] **Step 4: Re-run the control-plane server test**

Run: `node admin_console/tests/control-plane-server.test.js`  
Expected: permit signing assertions PASS.

### Task 3: Add a store helper to resolve client access from refresh session

**Files:**
- Modify: `admin_console/src/controlPlaneStore.js`
- Test: `admin_console/tests/control-plane-store.test.js`

- [ ] **Step 1: Write the failing store test**

Cover:

- valid `refresh_token + device_id` resolves active user, session, and entitlements
- revoked or expired refresh session fails
- user without `craft.use` resolves but is marked not permitted for craft

- [ ] **Step 2: Run the store test to verify it fails**

Run: `node admin_console/tests/control-plane-store.test.js`  
Expected: FAIL because the resolver helper does not exist.

- [ ] **Step 3: Implement the resolver helper**

Add a focused method such as:

- `resolveClientAccess({refreshToken, deviceId, now})`

It should:

- reuse `resolveRefreshSession()`
- load the current user
- resolve current entitlements
- return `{ok, user, session, entitlements}`

Do not add a new table in this round; reuse existing refresh-session state.

- [ ] **Step 4: Re-run the store test**

Run: `node admin_console/tests/control-plane-store.test.js`  
Expected: PASS.

### Task 4: Expose `POST /api/auth/craft-permit`

**Files:**
- Modify: `admin_console/src/server.js`
- Test: `admin_console/tests/control-plane-server.test.js`

- [ ] **Step 1: Write the failing server route test**

Add coverage for:

- success path with valid `refresh_token`, `device_id`, and `payload_hash`
- `403` when current entitlements lack `craft.use`
- `401` when refresh session is invalid
- `409` when `device_id` mismatches
- `400` when required fields are missing

- [ ] **Step 2: Run the server test to verify it fails**

Run: `node admin_console/tests/control-plane-server.test.js`  
Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement the route**

Add:

- `POST /api/auth/craft-permit`

Request fields:

- `refresh_token`
- `device_id`
- `action`
- `account_username`
- `payload_hash`

Behavior:

- resolve client access from refresh session
- reject if `craft.use` is absent
- sign and return the permit
- do not log raw `refresh_token`
- log only user id, device id, action, and result

- [ ] **Step 4: Re-run the server test**

Run: `node admin_console/tests/control-plane-server.test.js`  
Expected: PASS.

---

## Chunk 3: Client Permit Request And Local Enforcement

### Task 5: Add a control-plane auth client method for craft permits

**Files:**
- Modify: `node_sidecar/src/controlPlaneAuthClient.js`
- Test: `node_sidecar/tests/control-plane-auth-client.test.js`

- [ ] **Step 1: Write the failing client test**

Cover:

- normalizes `issueCraftPermit()` request payload
- returns `permit` on success
- surfaces normalized `reason/message/status` on refusal

- [ ] **Step 2: Run the client test to verify it fails**

Run: `node node_sidecar/tests/control-plane-auth-client.test.js`  
Expected: FAIL because `issueCraftPermit()` does not exist.

- [ ] **Step 3: Implement the client method**

Add:

- `issueCraftPermit({refreshCredential, deviceId, action, accountUsername, payloadHash})`

Map fields to:

- `refresh_token`
- `device_id`
- `action`
- `account_username`
- `payload_hash`

- [ ] **Step 4: Re-run the client test**

Run: `node node_sidecar/tests/control-plane-auth-client.test.js`  
Expected: PASS.

### Task 6: Add local craft permit verification

**Files:**
- Create: `node_sidecar/src/craftPermitEnforcer.js`
- Test: `node_sidecar/tests/craft-execution-permit.test.js`

- [ ] **Step 1: Extend the failing permit test**

Add coverage for:

- signature verification with public key
- device mismatch rejection
- payload hash mismatch rejection
- expired permit rejection

- [ ] **Step 2: Run the permit test to verify it fails**

Run: `node node_sidecar/tests/craft-execution-permit.test.js`  
Expected: FAIL because the enforcer does not exist.

- [ ] **Step 3: Implement the enforcer**

Add:

- `createCraftPermitEnforcer({publicKey, now})`
- `evaluatePermit(bundle, {deviceId, action, accountUsername, payloadHash})`

Reuse:

- existing public key loading pattern
- `crypto.verify`

Return normalized result codes such as:

- `invalid_signature`
- `device_mismatch`
- `payload_hash_mismatch`
- `permit_expired`

- [ ] **Step 4: Re-run the permit test**

Run: `node node_sidecar/tests/craft-execution-permit.test.js`  
Expected: PASS.

### Task 7: Require remote craft permit inside the real craft routes

**Files:**
- Modify: `node_sidecar/src/licenseConfig.js`
- Modify: `node_sidecar/src/uiServer.js`
- Test: `node_sidecar/tests/craft-permission-gate.test.js`

- [ ] **Step 1: Write the failing route tests**

Add coverage for:

- `/api/craft/tradeup` requests remote permit before execution
- `/api/craft/tradeup-with-components` requests remote permit before execution
- missing remote permit blocks with `403` or `503`
- helper routes like prediction/candidates still only require local permissions

- [ ] **Step 2: Run the route test to verify it fails**

Run: `node node_sidecar/tests/craft-permission-gate.test.js`  
Expected: FAIL because craft routes still only use local `requirePermission()`.

- [ ] **Step 3: Implement minimal server changes**

In `node_sidecar/src/licenseConfig.js`, expose a flag such as:

- `requireRemoteCraftPermit`

Recommended default:

- `true` in `prod_login`
- `false` in `debug_bundle`

In `node_sidecar/src/uiServer.js`:

- add a helper that builds the canonical craft payload hash
- read the current `refresh_credential` from the local license store/runtime
- request a permit via `controlPlaneAuthClient`
- verify the permit locally via `craftPermitEnforcer`
- only then call:
  - `craftService.runTradeUp()`
  - `craftService.runTradeUpBatch()`
  - `craftTradeupWithComponentsService.runTradeUpWithComponents()`

Do not send the local Steam password to the control plane.

- [ ] **Step 4: Re-run the route test**

Run: `node node_sidecar/tests/craft-permission-gate.test.js`  
Expected: PASS with real craft routes blocked until remote permit is granted.

---

## Chunk 4: Regression Coverage

### Task 8: Run targeted verification and syntax checks

**Files:**
- Modify: none

- [ ] **Step 1: Run targeted tests**

Run:

- `node admin_console/tests/control-plane-store.test.js`
- `node admin_console/tests/control-plane-server.test.js`
- `node node_sidecar/tests/control-plane-auth-client.test.js`
- `node node_sidecar/tests/craft-execution-permit.test.js`
- `node node_sidecar/tests/craft-permission-gate.test.js`
- `node node_sidecar/tests/client-auth-session-lifecycle.test.js`

Expected: all PASS.

- [ ] **Step 2: Run syntax checks**

Run:

- `node -c admin_console/src/server.js`
- `node -c admin_console/src/entitlementSigner.js`
- `node -c node_sidecar/src/controlPlaneAuthClient.js`
- `node -c node_sidecar/src/craftPermitEnforcer.js`
- `node -c node_sidecar/src/uiServer.js`

Expected: exit `0`.

- [ ] **Step 3: Manual smoke check**

Verify in the packaged desktop app:

- login still succeeds
- simulation and helper routes behave exactly as before
- real craft execution now fails fast when the control plane revokes `craft.use`
- real craft execution succeeds immediately after the control plane re-enables `craft.use`

- [ ] **Step 4: Leave changes uncommitted for user validation**

Do not commit unless the user explicitly asks.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-07-craft-execution-permit.md`. Ready to execute after review.
