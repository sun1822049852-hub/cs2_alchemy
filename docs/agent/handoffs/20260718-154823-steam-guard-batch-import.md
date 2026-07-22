---
status: implementation_complete_uncommitted
handoff_id: 20260718-154823-steam-guard-batch-import
parent_handoff_id: 20260718-135149-steam-guard-main-merge
branch: codex/steam-guard-coexist
worktree: C:/Users/18220/Desktop/cs2_alchemy/.worktrees/steam-guard-coexist
approved_at: 2026-07-18T15:48:23+08:00
updated_at: 2026-07-18T16:40:00+08:00
---

# Steam Guard Batch Import And Local Token Deletion

## Goal

Replace batch maFile import login behavior with local Guard-only persistence, add preflight and explicit duplicate-account overwrite UI, mark new token-only accounts as not logged in, and add confirmed local maFile deletion without changing the remote Steam authenticator.

## Approved Decisions

- Identity and duplicate detection use the maFile `account_name` only; filenames are display-only and `steamid` is ignored.
- Valid files require non-empty `account_name`, a six-character `revocation_code`, and a usable `shared_secret`; `Session:null`, missing `steamid`, `status=0`, and `fully_enrolled=false` are accepted.
- Ready accounts save immediately. Existing duplicates open a separate checkbox modal after ready items finish; checkboxes default off.
- Duplicate `account_name` entries within the same selected batch are all blocked until the user removes extras.
- Overwrite updates only password and maFile and preserves the existing refresh token and runtime session.
- Local token deletion clears only `mafile_content`; it never calls Steam finalize/remove/replace.

## Boundaries

- Do not change manual account addition or the Steam Guard coexist state machine.
- Do not access real Steam accounts or perform real account, market, trade, inventory, or craft operations.
- Do not mutate main-worktree files or runtime credential/database/snapshot files.
- Do not commit or push without explicit user authority.

## Baseline

- Branch started clean at `58244140d9135c55f9c552ec37af3cf68d5ae21f`.
- `npm test` passed 111 default Node tests in 49.8 seconds before implementation.

## Result

- Batch import now preflights and persists normalized Guard-only maFiles without Steam login or TokenStore writes.
- Same-batch account names are blocked as a group, including a valid file paired with a parseable invalid file using the same `account_name`.
- Ready accounts save first; existing and TOCTOU duplicates enter an independent opt-in overwrite modal. Overwrite changes only password and maFile.
- Guard-only accounts without refresh tokens display `未登录` and do not trigger profile hydration until a refresh succeeds and projects a new token.
- Token management can delete only the local maFile after confirmation; refresh token, runtime session, password and profile are preserved.
- Dynamic account names no longer enter `innerHTML`, and closing the import modal clears raw maFile and password state.

## Verification

- TDD RED was observed for validation, store routes, duplicate UI, not-logged-in state, profile suppression, deletion and review findings before the matching fixes.
- Ten directly affected test scripts passed after implementation.
- Final `npm test`: `PASS 113 node_sidecar tests in 50.5s`.
- Fourteen changed/new JavaScript files passed `node --check`.
- Independent read-only review reported no remaining blockers.
- Real page QA with a temporary database and synthetic account verified desktop and 390px import/token/duplicate modals, no horizontal overflow, delete-confirm z-index, disabled missing-password duplicate, overwrite count, cancel summary and the `未登录` badge. No destructive confirmation was submitted.

## Unverified

- The default runner still excludes three browser-interaction tests.
- No real Steam account, real maFile import, production database, remote authenticator deletion, inventory, market, trade or craft action was used.
- The real first successful Guard-only auto-login and subsequent live profile hydration still require a controlled Steam test account.

## Next Action

Let the user inspect the uncommitted branch diff and decide whether to commit. Do not commit, merge, push or delete this worktree without explicit authority.
