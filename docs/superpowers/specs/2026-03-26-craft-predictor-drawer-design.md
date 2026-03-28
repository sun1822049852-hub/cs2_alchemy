# Craft Predictor Drawer Design

Date: 2026-03-26
Status: Approved in discussion, implemented with final bottom-overlay variant

## Revision 2

The final approved variant changed the drawer geometry after the first review round:

- the right-panel middle region stays as one full-height candidate preview area
- a predictor stage is absolutely positioned over the bottom half of that candidate area
- the predictor drawer is hidden by default and expands from the right edge
- opening the drawer overlays the lower half of the candidate area instead of reserving a permanent lower band

## Summary

Refactor the current craft outcome predictor panel into an independent drawer that belongs only to the middle preview region of the right-hand craft panel.

The drawer must:

- be hidden by default
- leave a persistent right-edge arrow handle when hidden
- stop coupling its visibility to the craft assist overlay
- follow the currently selected recipe context instead of the current assist preset key
- show the predicted outcomes for the recipe being configured
- still show the current selected recipe's outcomes when craft assist is opened
- keep the top empty-state block and bottom execute button outside the drawer area

This change is a frontend interaction redesign. The existing backend predictor route stays in use.

## Goals

- Match the confirmed sketch: middle-region drawer only, not full right panel
- Keep the drawer available even when craft assist is closed
- Make recipe selection the single source of truth for what the drawer shows
- Preserve quick access with a visible arrow handle while hidden
- Avoid breaking current queue creation, execution, and assist selection flows

## Non-Goals

- No redesign of the top empty-state block
- No redesign of the bottom execute bar
- No backend predictor contract changes in this phase
- No forced auto-open when craft assist opens
- No new predictor support for completed recipes beyond existing card result display

## Current Problems

1. The predictor panel is anchored to the far right edge of the queue shell and visually feels like a side rail rather than a drawer for the preview region.
2. Visibility depends on `craftPredictorSelectedConfigKey`, which is currently driven by craft assist draft or preset state instead of the user's selected recipe.
3. Opening craft assist can auto-open and re-target the predictor, which makes the panel feel owned by assist mode instead of by the recipe preview.
4. When no assist config is selected, the predictor disappears entirely, even if the user has an active recipe in the queue.

## Confirmed UX Direction

### Chosen Layout

Use one full-height middle preview region for the candidate / queue preview list, then attach a predictor overlay stage that only occupies the bottom half of that region.

The right panel is split into three vertical bands:

1. queue header and empty-state / summary area at the top
2. middle preview region that contains:
   - one full-height candidate preview area
   - one bottom-half predictor overlay stage layered on top
3. bottom execution row with the execute button

Only band 2 participates in the drawer motion.

### Hidden State

- The drawer is closed by default
- A narrow arrow handle remains visible on the right edge of the candidate preview region
- The candidate list remains fully usable while the drawer is hidden

### Open State

- The drawer slides out from right to left inside the bottom-half overlay stage
- The drawer covers the lower half of the candidate region rather than pushing nearby content aside
- The top area and bottom execute bar do not shift

## Interaction Model

### Single Source of Truth

The predictor must stop following craft assist visibility and instead follow a dedicated display context:

- `recipe:<id>` for a pending queue recipe selected from the preview list
- `draft` for the in-progress recipe currently being edited when no explicit queue recipe is selected

The drawer open/closed state is separate from the display context.

### Context Priority

When deciding what the drawer should render, use this order:

1. explicit recipe card clicked by the user
2. current active pending recipe in the queue
3. current draft recipe being edited
4. empty state with handle only

### Trigger Rules

1. Clicking a pending recipe card:
   - marks that recipe as the active display context
   - refreshes predictor data for that recipe
   - does not require craft assist to be open
2. Creating or editing the current recipe:
   - keeps the current draft / active recipe as predictor context
   - allows the drawer to show updated predicted outcomes while configuration changes
3. Opening craft assist:
   - must not force predictor open
   - must not clear the current predictor context
   - if a current recipe is already selected, the drawer continues to target that recipe
4. Closing craft assist:
   - must not close or reset the predictor drawer
5. Clicking the drawer arrow:
   - toggles only the drawer open state
   - must not change the selected recipe context

## Data Model Changes

### Replace Assist-Owned Predictor Selection

The current state fields:

- `craftPredictorSelectedConfigKey`
- `craftPredictorSelectedConfigLabel`
- `craftPredictorDismissedConfigKeys`

are too tied to assist preset identity.

Replace or repurpose predictor targeting around a recipe-oriented state:

- `craftPredictorContextType`: `"recipe"` or `"draft"` or `""`
- `craftPredictorContextId`: selected recipe id when type is `recipe`
- `craftPredictorContextLabel`: UI label for subtitle rendering
- `craftPredictorOpen`: drawer visibility only

Persist these with the existing account-scoped craft state.

### Request Assembly Sources

Two predictor request builders are needed:

1. `buildCraftPredictorRequestFromDraft(...)`
   - used when showing the current in-progress configuration
   - keeps using assist target wear and assist materials
2. `buildCraftPredictorRequestFromRecipeEntry(...)`
   - used when a pending queue recipe is selected
   - derives the predictor payload from actual recipe `item_ids` and current inventory rows
   - computes grouped collections, global rarity, `stattrak`, `required_count`, and current relative wear from the real recipe items

The renderer should choose the builder based on predictor context type.

## Layout Changes

### HTML Structure

Keep the current top header and bottom execute row in place.

Refactor the middle area under `craftQueueMain` into a dedicated preview viewport shell:

- the queue / candidate list remains the full-height base content
- a dedicated predictor stage is positioned over the bottom half only
- the predictor drawer becomes an overlay inside that bottom-half stage
- the arrow handle sits on the far right edge of the overlay

### CSS Direction

Required visual changes:

- predictor drawer width should match the candidate preview width when open
- predictor drawer height should feel like roughly half of the candidate preview height
- hidden state should leave only a thin arrow stub visible
- animation direction should read as right-to-left expansion from the drawer handle
- the drawer surface should visually match the existing dark craft page styling instead of reintroducing light glass cards

### Responsiveness

On narrower widths:

- keep the handle visible
- allow the drawer to cover more of the preview region if needed
- do not let the drawer overlap the bottom execute row

## Rendering Rules

### Subtitle

Subtitle should reflect the current context:

- selected queue recipe title when context type is `recipe`
- `当前配置` when context type is `draft`

### Status Text

Status behavior:

- loading: show prediction-in-progress text
- invalid recipe/draft: show rule failure reason
- valid recipe/draft: show predicted outcome count
- no active context: show neutral empty prompt

### Empty State

If there is no predictor context yet:

- keep the drawer hidden
- keep the arrow handle visible
- opening the drawer shows a neutral prompt instead of stale results

## Event Flow

### Queue Card Activation

When a pending queue card is activated:

1. keep existing active recipe selection behavior
2. set predictor context to that recipe id
3. refresh predictor preview from the recipe entry
4. re-render the queue and drawer

### Draft Editing Flow

When the active draft changes because the user adds or removes items:

1. if predictor context currently points to `draft`, refresh from draft inputs
2. if predictor context points to a specific queue recipe, do not steal focus back to draft

### Assist Toggle Flow

When assist opens:

1. do not call predictor auto-open logic
2. do not overwrite predictor context with assist preset keys
3. refresh the current predictor context only if the visible data source changed

## Testing Strategy

Follow TDD for this behavior change.

### HTML / CSS / UI Contract Tests

Add or update UI contract tests to assert:

- the predictor drawer lives inside the middle preview region container
- the arrow handle is left-edge oriented
- the default predictor state is hidden
- the old assist-owned predictor rail wording / placement is removed

### Logic Tests

Add focused assertions for:

- clicking a queue recipe updates predictor context to that recipe
- opening assist does not force predictor open
- opening assist does not clear predictor context
- draft edits refresh prediction only when context is `draft`
- recipe selection keeps working when assist is closed

### Regression Scope

Keep existing queue header, queue execution, and predictor API route tests passing.

## Acceptance Criteria

The redesign is complete when all of the following are true:

1. The predictor drawer is hidden by default and shows a persistent arrow handle.
2. The drawer occupies only the middle preview region of the right craft panel.
3. The drawer is no longer controlled by craft assist open/close state.
4. Clicking a pending recipe card updates the drawer to that recipe's predicted outcomes.
5. While configuring a recipe, the drawer can show the current recipe's outcomes.
6. Opening craft assist still lets the user see the current selected recipe's outcomes without forcing a visibility change.
7. Top empty-state content and bottom execute controls remain outside the drawer region.

## Implementation Notes

- Prefer small pure helpers for predictor context selection and request assembly
- Reuse existing row metadata helpers where possible for rarity, collection, and relative wear derivation
- Keep drawer open state and predictor target state independent to avoid repeated regressions
- Per workspace policy, this spec should remain uncommitted unless the user explicitly asks for a commit
