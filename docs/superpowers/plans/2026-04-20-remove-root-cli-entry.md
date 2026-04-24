# Remove Root CLI Entry Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the deprecated root CLI entry so the repository root only exposes the user desktop entry and the explicit dev desktop entry.

**Architecture:** Keep the current desktop launch chain unchanged: `run.bat` and `main_ui_node_desktop.js` remain the formal user-facing release path, while `run-dev.bat` remains the explicit development path. Remove `main_node.js` entirely and update repository-facing documentation and project records so they no longer advertise or preserve a root-level CLI shortcut.

**Tech Stack:** Node.js, Electron launcher scripts, repository docs

---

## Chunk 1: Contract And Removal

### Task 1: Add the failing contract test

**Files:**
- Modify: `tests/main-ui-node-desktop-launcher.test.js`

- [ ] **Step 1: Write the failing test**

```js
function test_repo_root_has_no_cli_entry() {
  const cliEntry = path.resolve(__dirname, "..", "main_node.js");
  assert.equal(fs.existsSync(cliEntry), false);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/main-ui-node-desktop-launcher.test.js`
Expected: FAIL because `main_node.js` still exists.

- [ ] **Step 3: Write minimal implementation**

Delete `main_node.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/main-ui-node-desktop-launcher.test.js`
Expected: PASS.

### Task 2: Remove outward references

**Files:**
- Modify: `README.md`
- Modify: `docs/agent/session-log.md`
- Modify: `docs/agent/memory.md`

- [ ] **Step 1: Remove the root CLI entry from current-facing docs**

Delete or rewrite references that describe `main_node.js` as a supported entrypoint.

- [ ] **Step 2: Record the decision in project memory**

Add the stable rule that the repo root no longer keeps any CLI entry.

- [ ] **Step 3: Record the change in session log**

Capture the files changed, verification performed, and remaining risk.

- [ ] **Step 4: Re-run the affected verification**

Run: `node tests/main-ui-node-desktop-launcher.test.js`
Expected: PASS.
