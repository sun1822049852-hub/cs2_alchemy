# Trade-up Simulation Workbench Design

Date: 2026-03-31
Status: Approved in discussion, pending implementation plan

## Summary

Add a new top-level navigation page called `汰换模拟` that is completely independent from the existing `炼金汰换` page.

This new page is a simulation-only workbench for finding candidate trade-up recipes by starting from a target output item and a user-entered absolute float, then working backward to infer:

- the shared relative wear used by the simulated recipe
- the absolute float of all related output items
- the absolute float of all related lower-tier material items

The page is for exploration and recipe discovery only. It does not execute trade-ups, does not require inventory ownership, and does not yet sync with the existing craft queue.

## Goals

- Add a dedicated `汰换模拟` navigation entry and page
- Use the full skin database as the data source rather than the current account inventory
- Let the user choose one concrete target item without pre-filtering by wear tier
- Constrain target absolute float input by the chosen item's `minfloat` and `maxfloat`
- Auto-match and display the wear tier after the user enters the target absolute float
- Support anchor inputs that help constrain related output / material branches:
  - collection anchors
  - concrete auxiliary output anchors
  - lower-tier anchors derived from an auxiliary output branch
- Return all related outputs and all related materials with inferred absolute float values
- Reuse the existing craft predictor card language where it helps the user read the result quickly

## Non-Goals

- No direct linkage to the current `炼金汰换` queue in the first phase
- No execution, account connection, or inventory availability checks
- No probability model in the first phase
- No quantity balancing or exact executable recipe validation in the first phase
- No persistence to backend storage in the first phase
- No automatic import from or export to the existing craft assist preset system in the first phase

## Confirmed Product Decisions

### Independent Feature Boundary

- `汰换模拟` is a new page, not a mode inside the current craft page
- the current `炼金汰换` flow stays unchanged
- any relationship between simulation and live craft execution will be designed later

### Target Item Model

- the user selects one concrete output item from the global skin database
- the user does not first choose a wear tier
- the user enters an absolute float value for that selected item
- the input range is restricted by the selected item's own `minfloat` and `maxfloat`
- after input, the UI automatically derives and shows:
  - absolute float
  - relative wear
  - wear tier

### Anchor Model

Anchors do not carry their own user-entered float values.

Instead, anchors are used to constrain which related branches are included in the simulation. Once the target item's shared relative wear is derived, that same relative wear is applied to all relevant outputs and then to their lower-tier materials.

Supported anchor types:

- collection anchor
- concrete auxiliary output anchor
- lower-tier anchor derived from an auxiliary output branch

### Result Scope

The final result must include:

- all related outputs selected by the target item plus anchors
- all related lower-tier material items implied by those output branches
- inferred absolute float for every resolvable item

Items with missing wear bounds are still shown, but their float display is degraded instead of removing the whole simulation.

## Chosen UX

### Page Layout

Use a workbench layout rather than a wizard.

- left rail: simulation recipe list
- main workbench: target item, target absolute float, anchor editor
- right result area: output cards and material cards

This is intentionally optimized for repeated iteration. Users should be able to compare multiple simulation recipes without re-entering the whole setup each time.

### Simulation Recipe List

Each recipe entry is a simulation-only draft and shows:

- target item name
- target absolute float
- derived wear tier
- anchor count

Supported actions:

- add simulation recipe
- switch active recipe
- delete simulation recipe

The page always renders one active recipe at a time.

### Add Recipe Flow

Inside the new `汰换模拟` page:

1. click `新增配方`
2. open a target item picker backed by the full skin database
3. after item selection, create a new simulation recipe entry
4. focus the target absolute float input for immediate editing

This button does not reuse the current craft-page `新增配方` behavior.

### Workbench Flow

### Target Item Section

- choose one concrete target item from the full database
- show item art, collection, rarity, and wear bounds
- enter absolute float within the allowed range
- show the derived wear tier immediately after the value becomes valid

### Anchor Section

The user can add multiple anchor cards.

Each anchor card stores:

- anchor type
- anchor display label
- normalized lookup key
- resolution status

Anchor entry types:

- collection
- auxiliary output item
- lower-tier branch derived from an auxiliary output

Anchor changes trigger recalculation for the active simulation recipe.

### Result Section

Split the results into two groups:

- related outputs
- related materials

Each result card reuses the visual grammar of the current craft predictor cards where possible:

- item art
- item name
- collection
- rarity
- wear bar
- absolute float
- relative wear
- role badge such as `目标`, `锚定产物`, `辅料`

The goal is visual continuity, not direct CSS coupling.

## Core Domain Model

### Shared Wear Derivation

The target item drives the simulation.

Given:

- chosen target item
- target absolute float
- target item `minfloat`
- target item `maxfloat`

Compute:

`relative_wear = (target_absolute_float - minfloat) / (maxfloat - minfloat)`

This relative wear becomes the shared simulation wear for all related branches.

Validation rules:

- reject values below `minfloat`
- reject values above `maxfloat`
- reject calculation when wear bounds are missing
- reject calculation when `maxfloat <= minfloat`

### Output Expansion

After deriving shared relative wear:

1. build the set of related output branches from:
   - the target item itself
   - collection anchors
   - auxiliary output anchors
   - lower-tier anchors that resolve back to an auxiliary branch
2. for each related output item with wear bounds:
   - compute absolute float from shared relative wear
3. preserve unresolved items in the response with explicit degraded status

### Material Expansion

For every resolved output branch:

1. identify its lower-tier material family candidates
2. apply the same shared relative wear
3. compute each material's absolute float when wear bounds exist

The first release is a float simulation, not a full recipe solver. It surfaces the branch space and inferred float values but does not yet prove recipe executability.

## Frontend Architecture

### New Navigation Entry

Update the navigation model to include:

- `simulationPage`
- `navSimulation`

The existing page routing must keep `accountPage`, `inventoryPage`, and `craftPage` unchanged.

### New Frontend State

Add a dedicated simulation state slice rather than piggybacking on craft state:

- `simulationRecipes`
- `simulationActiveRecipeId`
- `simulationItemPickerOpen`
- `simulationItemPickerQuery`
- `simulationItemPickerResults`
- `simulationLoading`
- `simulationError`
- `simulationResult`

Each simulation recipe entry should hold:

- `id`
- `target_item`
- `target_abs_wear`
- `target_relative_wear`
- `target_wear_label`
- `anchors`
- `result`
- `error`

### New Frontend Rendering Units

Recommended renderer boundaries:

- `renderSimulationPage()`
- `renderSimulationRecipeList()`
- `renderSimulationWorkbench()`
- `renderSimulationTargetSection()`
- `renderSimulationAnchorSection()`
- `renderSimulationResultSection()`

Keep these separate from the current craft predictor drawer renderers. Shared card-building helpers can be extracted later if the markup proves similar enough.

## Backend Architecture

### New Services

Do not overload the existing `craftOutcomePredictor`.

Recommended new backend modules:

- `node_sidecar/src/services/tradeupSimulationCatalog.js`
  - exposes searchable skin metadata for the simulation page
  - reuses normalized collection / rarity / wear data from the existing skin database
- `node_sidecar/src/services/tradeupSimulationService.js`
  - validates simulation requests
  - derives shared relative wear
  - expands anchored output branches
  - expands lower-tier materials
  - computes absolute float values and degraded statuses

The existing services to reuse as shared foundations:

- `skinAlchemyRules`
- `craftOutcomeCatalog` data conventions where useful
- existing rarity / collection normalization logic

### New Routes

Recommended route set:

- `GET /api/simulation/tradeup/search-items?q=...`
- `POST /api/simulation/tradeup/resolve`

### Search Route Responsibilities

- full-database search by item name
- return normalized item records for picker use
- include:
  - display name
  - base name
  - collection
  - rarity
  - `minfloat`
  - `maxfloat`
  - best available image url

### Resolve Route Request

```json
{
  "target_item": {
    "markethashname": "AK-47 | Ice Coaled (Minimal Wear)"
  },
  "target_abs_wear": 0.1142,
  "anchors": [
    {"type": "collection", "value": "Fracture Case"},
    {"type": "output_item", "value": "USP-S | Cortex"},
    {"type": "lower_tier_branch", "value": "M4A4 | Tooth Fairy"}
  ]
}
```

### Resolve Route Response

```json
{
  "ok": true,
  "message": "",
  "target": {
    "name": "AK-47 | Ice Coaled",
    "collection": "裂空武器箱",
    "rarity": "受限",
    "absolute_float": 0.1142,
    "relative_wear": 0.1142,
    "wear_label": "Minimal Wear"
  },
  "outputs": [
    {
      "role": "target",
      "name": "AK-47 | Ice Coaled",
      "collection": "裂空武器箱",
      "rarity": "受限",
      "absolute_float": 0.1142,
      "relative_wear": 0.1142,
      "wear_label": "Minimal Wear",
      "goods_icon_url": "..."
    }
  ],
  "materials": [
    {
      "role": "material",
      "name": "M4A1-S | Example",
      "collection": "裂空武器箱",
      "rarity": "军规级",
      "absolute_float": 0.1025,
      "relative_wear": 0.1142,
      "wear_label": "Minimal Wear",
      "goods_icon_url": "..."
    }
  ],
  "warnings": []
}
```

## Error Handling

### Hard Failures

Return `ok: false` when:

- target item is missing
- target item wear bounds are missing and relative wear cannot be derived
- target absolute float is out of range
- anchor payload shape is invalid

### Soft Failures

Keep `ok: true` with warnings when:

- some anchors cannot be resolved
- some expanded outputs are missing wear bounds
- some lower-tier materials are missing wear bounds
- some lower-tier branches cannot be expanded

Frontend behavior:

- keep the last valid result visible until a new valid one replaces it
- show per-anchor errors locally when possible
- show global warning summaries in the result section without discarding partial results

## Testing Strategy

Follow TDD.

### Backend Tests

Add focused unit tests for:

- target absolute float range validation
- shared relative wear derivation
- collection anchor expansion
- auxiliary output anchor expansion
- lower-tier branch anchor expansion
- partial results when wear bounds are missing

### Route Tests

Add route coverage for:

- search success
- resolve success
- out-of-range target float
- invalid anchor payload
- partial result with warnings

### Frontend Tests

Add UI contract coverage for:

- new navigation button and page shell
- simulation recipe list behavior
- target item picker open / select flow
- target absolute float bounds messaging
- output and material result grouping
- predictor-style card fields on simulation result cards
- no regression to the existing `craftPage`

## Rollout Notes

- Ship the new page as a standalone workflow first
- do not attempt first-phase linkage into live craft execution
- once the simulation page is stable, a later design can define:
  - export to craft queue
  - import from craft queue
  - save named simulation presets
