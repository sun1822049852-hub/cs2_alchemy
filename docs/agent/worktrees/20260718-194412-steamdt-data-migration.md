status: archived
target: Finish the skin base-info migration by removing runtime dependence on the legacy smelter data directory.
handoff_id: 20260718-194412-steamdt-data-migration
parent_handoff_id: null
branch: main
worktree: C:/Users/18220/Desktop/cs2_alchemy
allowed_paths:
  - node_sidecar/src/skinDbSync.js
  - tests/skinDbSync.test.js
  - README.md
  - docs/agent/worktrees/20260718-194412-steamdt-data-migration.md
forbidden_paths:
  - all other paths
must_not_change:
  - SteamDT provider, endpoint, response-field mapping, and enrichment providers
  - csgo_skins.db, data snapshots, runtime artifacts, and batch entrypoints
  - existing user or parallel-session changes
truth_source: SteamDT /open/cs2/v1/base response; an explicitly supplied JSON may only replay a saved SteamDT response snapshot.
allowed_fallbacks: latest steam_base_info timestamp snapshot under this repository's data directory, or an explicit --json path.
forbidden_fallbacks: legacy smelter paths and any silent cross-project fallback.
updated_at: 2026-07-18T19:49:31+08:00
last_verified: 2026-07-18T19:49:31+08:00; skinDbSync, fetchAndRebuildSkinDb, and steamdtBaseInfoProvider tests passed; syntax and diff checks passed; real CLI missing-snapshot behavior rejected before DB creation; runtime source scan found no legacy smelter references. Real SteamDT and the live database were not exercised.
