---
handoff_id: 20260718-142705-project-wiki-main-sync
parent_handoff_id: null
status: complete
created_at: 2026-07-18T14:27:05+08:00
updated_at: 2026-07-18T14:45:49+08:00
project_root: C:/Users/18220/codex-working-rules
worktree: C:/Users/18220/codex-working-rules
branch: main
task: Apply and harden the project-wiki and knowledge-first workflow package on canonical main.
---
Goal: Apply the completed project-wiki and knowledge-first workflow package to canonical main without changing business repositories or VOM tooling contracts.
Done: Applied the package to canonical main; fixed ambiguous project-wiki writes, handoff/registry schema drift, and missing mirror/radar contract coverage; synchronized owned live assets.
Current: Canonical main and owned live mirrors contain the hardened package and remain uncommitted.
Next: User reviews the diff and chooses commit, a new handoff, or leaving it uncommitted.
Blockers: None for implementation. Official Codex manual and official-domain fallback returned HTTP 403/404, so current official Codex benchmark remains an explicit evidence gap.
Verified: Canonical and installed workflow 63/63 each; project-wiki 12/12 each; VOM 46 passed plus one Windows symlink skip each; 10 skill validators, workflow-state audit, mirror hashes, encoding, secret scan, forbidden-path diff, and diff check passed.
Must not change: cs2_alchemy business/runtime files, VOM schema/scripts/generator/validator, friend reference files, dependencies, hardware target, or Git history.
