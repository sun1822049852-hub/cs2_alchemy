# VPK Dev Tooling Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repo-local VPK development toolchain so we can list, read, and extract CS2 split VPK entries without relying on a separately installed `vpk.exe`.

**Architecture:** Add a small Node module that wraps a VPK library behind three stable actions: `list`, `cat`, and `extract`. Expose those actions through package scripts so development workflows can call them directly from `node_sidecar`, and keep the behavior covered by plain Node tests using dependency injection instead of requiring a real CS2 install.

**Tech Stack:** Node.js CommonJS, `@lowly1337/vpk`, plain Node assertion tests, npm scripts.

---

## Chunk 1: VPK Module And Tests

### Task 1: Add failing tests for the minimal VPK workflow

**Files:**
- Create: `node_sidecar/tests/vpk-dev-tools.test.js`
- Create: `node_sidecar/src/vpkDevTools.js`

- [ ] Step 1: Write failing tests for `list`, `cat`, and `extract`.
- [ ] Step 2: Run `node .\tests\vpk-dev-tools.test.js` and confirm failure before implementation.
- [ ] Step 3: Implement the minimal module with dependency injection support.
- [ ] Step 4: Re-run `node .\tests\vpk-dev-tools.test.js` and confirm pass.

## Chunk 2: CLI And Dependency Wiring

### Task 2: Expose the VPK module through npm scripts

**Files:**
- Create: `node_sidecar/src/vpkDevCli.js`
- Modify: `node_sidecar/package.json`
- Modify: `node_sidecar/package-lock.json`

- [ ] Step 1: Add the `@lowly1337/vpk` dependency.
- [ ] Step 2: Add CLI entrypoints for `vpk:list`, `vpk:cat`, and `vpk:extract`.
- [ ] Step 3: Smoke-test the commands against a local CS2 `pak01_dir.vpk`.

## Chunk 3: Docs

### Task 3: Document development usage

**Files:**
- Modify: `node_sidecar/README.md`

- [ ] Step 1: Add a short VPK tooling section with real command examples.
- [ ] Step 2: Re-run the targeted regression and one real VPK list command.
