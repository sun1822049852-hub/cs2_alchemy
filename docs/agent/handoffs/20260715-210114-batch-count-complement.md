---
handoff_id: 20260715-210114-batch-count-complement
parent_handoff_id: 20260715-184955-batch-aux-search
status: complete
created_at: 2026-07-15T21:01:14+08:00
updated_at: 2026-07-15T22:11:51+08:00
project_root: C:/Users/18220/Desktop/cs2_alchemy
worktree: C:/Users/18220/Desktop/cs2_alchemy
branch: main
task: Make batch preset main/auxiliary quantities dynamically complement to ten and disable main quantity controls whenever auxiliary count is zero.
must_not_change:
  - Catalog and warehouse search behavior, material item membership, and localized display names.
  - Real craft execution, account actions, credentials, database schema, port 8787, and unrelated runtime artifacts.
  - Main material remains required; auxiliary material remains optional and may be zero.
next_first_step: User validates the already-running UI at http://127.0.0.1:8788/; commit only after explicit confirmation.
known_incomplete:
  - Full node_sidecar test suite was not run; verification is scoped to the direct and adjacent batch/craft-assist tests.
---

# Initial Marker

Current evidence shows each role count is normalized and saved independently. An existing preset can therefore render `main=10` and `aux=3`, while main controls remain enabled solely because the main material bucket exists.

# Completion

- Added complementary count normalization so `main + aux = 10`, with the side being edited treated as authoritative.
- Kept auxiliary optional: no auxiliary material forces `aux=0/main=10`; selected auxiliary material may remain at zero and can be increased again.
- Disabled main count input and step controls whenever auxiliary count is zero.
- Added direct tests for normalization, role authority, bounds, editability, and UI wiring.
- Browser runtime verified `7+3 -> 8+2 -> 9+1 -> 10+0`, main lock at zero auxiliary, restoration to `7+3`, and persistence after reload. Browser console logs were empty.
- No real craft or account action was executed; no service, database, credential, or runtime-artifact file was changed by this task.
