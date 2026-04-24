# Launcher Entry Consolidation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the desktop launch flow so the repo-root default entry behaves like the user-facing release path while development keeps an explicit separate entry.

**Architecture:** Keep a single Electron runtime base and separate behavior only at the launcher boundary. `main_ui_node_desktop.js` and `run.bat` become the default release-facing entrypoints, while a new root `run-dev.bat` explicitly delegates into the existing dev bootstrap flow. Documentation must reflect how remote control-plane configuration is supplied for local-vs-server testing.

**Tech Stack:** Node.js CommonJS, Electron, Windows batch scripts, PowerShell, `node:assert/strict`

---

## Chunk 1: Lock Launcher Semantics With Tests

### Task 1: Update launcher tests to describe the desired split

**Files:**
- Modify: `tests/main-ui-node-desktop-launcher.test.js`

- [ ] **Step 1: Change the workspace launcher expectation**

```js
function test_workspace_launcher_defaults_to_prod_login() {
  let capturedOptions = null;
  startDesktopLauncher({
    baseEnv: {},
    spawnImpl(_command, _args, options) {
      capturedOptions = options;
      return { on() {} };
    }
  });
  assert.equal(capturedOptions.env.CLIENT_AUTH_MODE, "prod_login");
}
```

- [ ] **Step 2: Add a root dev-entry smoke test**

```js
function test_run_dev_batch_delegates_to_explicit_dev_bootstrap() {
  const batchFile = path.resolve(__dirname, "..", "run-dev.bat");
  assert.equal(fs.existsSync(batchFile), true);
  assert.match(fs.readFileSync(batchFile, "utf8"), /start-client-dev\.ps1/i);
}
```

- [ ] **Step 3: Run the launcher test file and verify RED**

Run: `node tests/main-ui-node-desktop-launcher.test.js`
Expected: FAIL because the current workspace launcher still injects `dev_auto_bundle` and `run-dev.bat` does not exist yet.

## Chunk 2: Implement Explicit Release And Dev Entries

### Task 2: Make the repo-root launcher default to release semantics

**Files:**
- Modify: `main_ui_node_desktop.js`

- [ ] **Step 1: Change the launcher mode to release**

```js
env: buildDesktopLauncherEnv(baseEnv, {projectRoot: __dirname, mode: "release"})
```

- [ ] **Step 2: Keep explicit env overrides intact**

No additional branching; rely on `buildDesktopLauncherEnv()` to preserve a caller-provided `CLIENT_AUTH_MODE`.

### Task 3: Add a distinct root dev entry

**Files:**
- Create: `run-dev.bat`
- Reference: `scripts/start-client-dev.ps1`

- [ ] **Step 1: Add the new batch launcher**

```bat
@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File ".\scripts\start-client-dev.ps1" %*
if errorlevel 1 (
  echo [Error] Node desktop dev launcher failed.
)
pause
```

## Chunk 3: Align Docs And Project Memory

### Task 4: Update user-facing docs

**Files:**
- Modify: `README.md`
- Modify: `node_sidecar/README.md`

- [ ] **Step 1: Document the new launcher split**
- [ ] **Step 2: Clarify how `CONTROL_PLANE_BASE_URL` / `client_config.json` drive remote server testing**

### Task 5: Record the decision

**Files:**
- Modify: `docs/agent/session-log.md`
- Modify: `docs/agent/memory.md`

- [ ] **Step 1: Log the launcher consolidation work**
- [ ] **Step 2: Record the stable rule that repo-root default launchers are release-facing and dev bootstrap is explicit**

## Chunk 4: Verify

### Task 6: Run targeted verification

**Files:**
- Test: `tests/main-ui-node-desktop-launcher.test.js`

- [ ] **Step 1: Run launcher tests**

Run: `node tests/main-ui-node-desktop-launcher.test.js`
Expected: PASS

- [ ] **Step 2: Re-read changed docs and log entries**

Confirm the documented launch commands and remote control-plane notes match the implemented behavior.
