# Craft Assist Overlay Clearance Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the craft-assist overlay from covering the material list by reserving synchronized bottom clearance and auto-pushing visible rows upward when the overlay opens or grows.

**Architecture:** Keep the existing absolute bottom overlay, add one UI helper that computes and applies list clearance from the current overlay height, and call that helper from the overlay open/close, resize, drag, and list-render paths. Lock the behavior with a lightweight source-extraction regression test against `node_sidecar/ui/app.js`.

**Tech Stack:** Browser DOM, plain JavaScript, existing `node:assert/strict` source-extraction test style, existing CSS layout.

---

> Repo instruction note: do not add git commit steps unless the user explicitly asks. This plan intentionally omits commit tasks.

## File Map

- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`
  - Add the clearance helper and wire it into the craft-assist overlay lifecycle.
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/styles.css`
  - Add the material-list clearance variable and drag-time transition guard.
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-assist-overlay-clearance.test.js`
  - Regression tests for clearance height and auto-push behavior.

## Chunk 1: Lock The Behavior With A Failing Test

### Task 1: Add the overlay-clearance regression harness

**Files:**
- Create: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-assist-overlay-clearance.test.js`
- Reference only: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-queue-preview.test.js`

- [ ] **Step 1: Extract the new clearance helpers from `app.js`**

- [ ] **Step 2: Write a failing test that expects a closed overlay to produce zero list reserve**

- [ ] **Step 3: Write a failing test that expects an open overlay to apply reserve height and push `scrollTop` upward when the reserve grows**

- [ ] **Step 4: Run `node "./node_sidecar/tests/craft-assist-overlay-clearance.test.js"` and verify it fails because the helper does not exist yet**

## Chunk 2: Implement The Clearance Sync

### Task 2: Add a single source of truth for list clearance

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`

- [ ] **Step 1: Add a helper that computes the current material-list reserve height from craft-assist open state and overlay height**

- [ ] **Step 2: Add a helper that applies the reserve height to `#craftSelectionList` and bumps `scrollTop` when the reserve increases**

- [ ] **Step 3: Make `applyCraftAssistOverlayHeight()` refresh the list reserve**

### Task 3: Wire the helper into UI lifecycle points

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/app.js`

- [ ] **Step 1: Sync the reserve when opening and closing the overlay**

- [ ] **Step 2: Sync the reserve after material-list rerender**

- [ ] **Step 3: Sync the reserve on window resize**

## Chunk 3: Finish Layout And Verify

### Task 4: Add CSS hooks for the reserved space

**Files:**
- Modify: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/ui/styles.css`

- [ ] **Step 1: Add a CSS variable-backed `margin-bottom` to `.craft-selection-list`**

- [ ] **Step 2: Add a short transition for non-drag updates and disable the transition while dragging the overlay**

### Task 5: Run regression gates

**Files:**
- Test: `C:/Users/18220/Desktop/cs2_alchemy/node_sidecar/tests/craft-assist-overlay-clearance.test.js`
- Test: `C:/Users/18220/Desktop/cs2_alchemy/tests/uiCraftAssistSingleSource.test.js`

- [ ] **Step 1: Run the new overlay-clearance regression test**

Run: `node "./node_sidecar/tests/craft-assist-overlay-clearance.test.js"`

Expected: PASS

- [ ] **Step 2: Re-run the existing frontend craft-assist guard test**

Run: `node "./tests/uiCraftAssistSingleSource.test.js"`

Expected: PASS

- [ ] **Step 3: Run `node --check "./node_sidecar/ui/app.js"` to ensure the edited frontend script parses**

Run: `node --check "./node_sidecar/ui/app.js"`

Expected: PASS

Plan complete and saved to `docs/superpowers/plans/2026-03-22-craft-assist-overlay-clearance.md`. Ready to execute?
