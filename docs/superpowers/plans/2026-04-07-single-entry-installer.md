# Single Entry Installer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Windows installer present CS2 Alchemy as a single end-user entry point, without exposing install-directory choices or requiring users to open internal runtime files.

**Architecture:** Keep Electron's normal multi-file runtime under the hood, but tighten NSIS packaging so users only interact with the installer and the application shortcut. Lock the desired installer behavior with a tiny regression test that asserts the required builder flags remain in place.

**Tech Stack:** Electron, electron-builder, NSIS, Node.js `assert`, plain YAML/text config.

---

## Chunk 1: NSIS Entry Experience

### Task 1: Lock the installer UX with a regression test and update packaging config

**Files:**
- Create: `node_sidecar/tests/windows-installer-entrypoint.test.js`
- Modify: `node_sidecar/electron-builder.yml`

- [ ] **Step 1: Write the failing packaging-config test**

```js
assert.match(configText, /oneClick:\s*true/);
assert.match(configText, /allowToChangeInstallationDirectory:\s*false/);
assert.match(configText, /createDesktopShortcut:\s*always/);
assert.match(configText, /createStartMenuShortcut:\s*true/);
assert.match(configText, /runAfterFinish:\s*true/);
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `node node_sidecar/tests/windows-installer-entrypoint.test.js`
Expected: FAIL because the current config still exposes directory choice and does not explicitly lock shortcut behavior.

- [ ] **Step 3: Apply the minimal NSIS config change**

```yaml
nsis:
  oneClick: true
  allowToChangeInstallationDirectory: false
  createDesktopShortcut: always
  createStartMenuShortcut: true
  runAfterFinish: true
```

- [ ] **Step 4: Re-run the targeted test**

Run: `node node_sidecar/tests/windows-installer-entrypoint.test.js`
Expected: PASS

- [ ] **Step 5: Run the Windows packaging build**

Run: `npm --prefix node_sidecar run build:win`
Expected: PASS and output a refreshed `node_sidecar/dist/CS2 Alchemy Setup 0.1.0.exe`
