---
status: complete
handoff_id: 20260717-234730-project-architecture-selector
parent_handoff_id: null
branch: main
worktree: C:/Users/18220/Desktop/cs2_alchemy
updated_at: 2026-07-18T01:16:10+08:00
---

# Goal

Create and install an independent `choosing-project-architecture` skill that establishes a project architecture baseline before initial implementation, then commit that skill separately from the completed trade-up simulation fix.

# Scope

- Canonical skill source: `C:/Users/18220/codex-working-rules/skills/choosing-project-architecture/**`
- Live skill copy: `C:/Users/18220/.codex/skills/choosing-project-architecture/**`
- Completed simulation fix paths are limited to the archived `20260717-221753-simulation-zero-wear` registry.
- This handoff and its registry record may be updated as task state.

# Must Not Change

- Existing `AGENTS.md`, `workflow-manual.md`, and `working-principles.md` changes in the rules repository.
- Existing skills other than the new `choosing-project-architecture` directory.
- Project runtime database, UI-state snapshots, unrelated dirty files, and sibling worktrees.
- Limited-edition and mixed-rarity picker filtering semantics or predictor core behavior.

# RED Baseline

Five independent no-skill scenarios were run under schedule and authority pressure. The responses could usually name a plausible architecture, but did not produce a stable decision contract:

- One selected Electron without comparing alternatives or defining verification and rollback.
- One produced good module boundaries but no confidence/status decision record.
- One locked Next.js, PostgreSQL, Redis, and managed services before hosting and paid-service constraints were known.
- One moved directly toward a skeleton without an explicit architecture acceptance gate.
- The strongest sample stopped for three hardware questions, but still omitted a consistent option matrix, ADR shape, and architecture verification plan.

The recurring failure is inconsistent decision shape rather than inability to name an architecture.

# Constraint Benchmark

- Microsoft Architecture Center: an architecture style constrains elements and relationships; every style carries benefits, challenges, and trade-offs.
- AWS Well-Architected: architecture review should consistently examine the pros and cons of decisions against business context and best practices.
- Microsoft and AWS ADR guidance: record context, options, decision, consequences, trade-offs, confidence/status, and superseding decisions.
- C4: use only valuable abstraction levels; system context and container boundaries are sufficient for most teams.

# Completed

- Created a canonical `choosing-project-architecture` skill with a compact core workflow, selection reference, durable baseline template, and UI metadata.
- Installed the live copy at `C:/Users/18220/.codex/skills/choosing-project-architecture`.
- Kept the skill architecture-neutral while requiring candidate comparison, module/state ownership, dependency direction, runtime/delivery boundaries, evolution triggers, and explicit acceptance before first code generation.
- Preserved existing rules, other skills, runtime files, filtering semantics, and unrelated dirty changes.
- Committed the zero-wear simulation fix through an exact index-only staged subset.

# Verification

- Skill RED: five no-skill pressure scenarios exposed inconsistent decision contracts.
- Skill GREEN: five pre-refactor and four post-refactor scenarios passed; one timed-out sample was excluded, and a fifth post-refactor fresh thread could not be created because the native agent thread limit was reached.
- Canonical and live `quick_validate.py` passed; `SKILL.md` is 488 words, begins with `2D-2D-2D`, has no BOM, and all four files are ASCII.
- Canonical and live file SHA-256 values matched exactly; credential-pattern scans had no findings.
- Workflow-state audit passed twice with exit 0 and no findings.
- A Git-index export of the simulation commit passed `node --check`, five focused/adjacent Node test files, and the complete real-browser picker interaction test in 59.6 seconds.
- Staged diff checks confirmed that limited-edition and mixed-rarity hiding changes and 2026-07-15 map changes were excluded from the simulation commit.

# Commits

- `3ddb552 feat: add environment provisioning and architecture guidance` created the initial canonical skill files in a concurrent rules-repository commit.
- `a200975 docs: refine project architecture selector` committed the final compact skill wording.
- `289fb79 fix: handle zero-wear simulation material selection` committed the exact simulation fix and archived simulation handoff.

# Remaining Limits

- No push or PR was performed.
- The full project test suite and real Steam operations were not run.
- Google Cloud architecture framework retrieval timed out; Microsoft, AWS, and C4 official sources were verified directly.
- Unrelated dirty files and sibling worktrees were not reviewed or committed.
