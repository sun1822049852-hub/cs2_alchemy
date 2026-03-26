# Craft Outcome Predictor Design

Date: 2026-03-26
Status: Approved in discussion, pending implementation plan

## Summary

Add a new backend-only predictor that estimates trade-up outcomes from a recipe template, without requiring a concrete set of 10 items from inventory.

The predictor must:

- accept a global input rarity
- accept a global `stattrak` flag
- accept grouped collection counts such as `{collection, count}`
- support runtime `required_count` so the same core logic can power current `10`-item recipes and future `5`-item recipes
- return real-time outcome probability per item
- return real-time predicted output float per item when wear bounds exist
- keep outcomes even when wear bounds are missing, but leave predicted float empty
- invalidate the whole recipe when required outcome pools are missing or the recipe is not craftable by rule

This predictor is intentionally separate from inventory candidate selection and from live craft execution.

## Goals

- Predict outcomes from `collection + count + input_rarity + stattrak + target_relative_wear`
- Reuse existing skin database and collection alias rules
- Return normalized backend data that the frontend can group by collection later
- Avoid coupling predictor logic to current craft assist UI layout
- Keep the design extensible for future `5`-item trade-up flows

## Non-Goals

- No frontend placement or rendering decisions in this phase
- No changes to live craft execution logic
- No database string migration for existing `alchemy_type` values
- No dependency on account snapshot or inventory ownership for prediction

## Chosen Architecture

### New Modules

- `node_sidecar/src/services/craftOutcomePredictor.js`
  - validates requests
  - performs probability and float prediction
  - handles invalid states
  - builds final response payload
- `node_sidecar/src/services/craftOutcomeCatalog.js`
  - loads and caches normalized outcome candidates from `csgo_skins.db`
  - exposes lookup APIs for predictor use

### Existing Rules to Reuse

- collection alias normalization must come from the same source of truth as `skinAlchemyRules`
- skin metadata comes from the existing `skin` SQLite table

### New API

- `POST /api/craft/predict-outcomes`

This route is independent from `/api/craft/assist/select`.

## Request Contract

```json
{
  "required_count": 10,
  "target_relative_wear": 0.2142,
  "input_rarity": "军规级",
  "stattrak": false,
  "groups": [
    {"collection": "裂空武器箱", "count": 7},
    {"collection": "头号特训武器箱", "count": 3}
  ]
}
```

## Response Contract

### Success

```json
{
  "ok": true,
  "invalid_reason": "",
  "message": "",
  "required_count": 10,
  "current_count": 10,
  "target_relative_wear": 0.2142,
  "input_rarity": "军规级",
  "output_rarity": "受限",
  "stattrak": false,
  "summary": {
    "probability_total": 1.0,
    "probability_missing": 0.0
  },
  "outcomes": [
    {
      "collection_key": "Fracture Case",
      "collection_display": "裂空武器箱",
      "base_name": "Desert Eagle | Printstream",
      "name": "Desert Eagle | Printstream (Minimal Wear)",
      "markethashname": "Desert Eagle | Printstream (Minimal Wear)",
      "predicted_wearlevel": "Minimal Wear",
      "predicted_float": 0.17136,
      "probability": 0.2333333333,
      "minfloat": 0.0,
      "maxfloat": 0.8,
      "wear_range": 0.8,
      "missing_wear_bounds": false,
      "mapped_skin_missing": false,
      "goods_icon_url": "..."
    }
  ]
}
```

### Invalid

```json
{
  "ok": false,
  "invalid_reason": "collection_outcomes_missing",
  "message": "配方无效：存在武器箱在当前稀有度下查不到上一级产物",
  "required_count": 10,
  "current_count": 8,
  "outcomes": []
}
```

## Core Domain Rules

### Input Model

- `input_rarity` is global for the whole recipe
- `stattrak` is global for the whole recipe
- `groups` only carry `{collection, count}`
- `required_count` is runtime input, not a hard-coded constant

### Probability

For each concrete predicted outcome:

`probability = collection_count / required_count / collection_candidate_count`

Where:

- `collection_count` is the current count for that normalized collection
- `required_count` is `10` today and must support `5` later
- `collection_candidate_count` is the number of base outcomes in that collection for the target rarity and `stattrak` pool

Important:

- probabilities are real-time
- recipe does not need to be filled to `required_count`
- probability total may be less than `1`
- backend must not force totals to `100%`

### Float Prediction

For each predicted base outcome:

`predicted_float = target_relative_wear * wear_range + minfloat`

If any of `minfloat`, `maxfloat`, or `wear_range` is missing:

- keep the outcome
- keep the probability
- set `predicted_float = null`
- set `missing_wear_bounds = true`

### Wear Mapping

When `predicted_float` exists, map to output wear level using global thresholds:

- `< 0.07` => `Factory New`
- `< 0.15` => `Minimal Wear`
- `< 0.38` => `Field-Tested`
- `< 0.45` => `Well-Worn`
- `>= 0.45` => `Battle-Scarred`

Then map the base outcome back to a concrete skin row by:

- `basemarkethashname + predicted_wearlevel`

If the concrete row does not exist:

- keep the outcome
- keep `predicted_wearlevel`
- keep `predicted_float`
- set `mapped_skin_missing = true`

## Invalid States

The whole recipe must be invalid and return `ok: false` with empty outcomes when any of these conditions occurs:

- `invalid_required_count`
- `invalid_target_relative_wear`
- `invalid_input_rarity`
- `invalid_group_count`
- `no_higher_rarity_outcomes`
- `collection_outcomes_missing`

Additional upstream rule:

- mixed rarity and mixed `StatTrak` recipes should be blocked before predictor request assembly

## Catalog Design

The database stores separate rows per wear tier. Predictor logic must not use those rows as direct probability units.

### Layer 1: Base Outcome Index

Index key:

- `normalized_collection`
- `rarity_rank`
- `stattrak`
- `basemarkethashname`

This layer represents one base outcome candidate per skin family.

Suggested stored fields:

- `collection_key`
- `collection_display`
- `rarity_text`
- `rarity_rank`
- `stattrak`
- `base_name`
- `basemarkethashname`
- `minfloat`
- `maxfloat`
- `wear_range`
- `goods_icon_url`
- `goods_original_icon_url`
- `goods_share_thumbnail_url`

### Layer 2: Concrete Wear Mapping Index

Index key:

- `basemarkethashname`
- `wearlevel`

This layer maps a predicted wear level back to a concrete `markethashname`.

### Collection Expansion

Some database rows contain merged collections. Catalog load must:

- split merged collection fields
- normalize aliases
- insert the same skin into multiple collection buckets when required

## Predictor Algorithm

1. Validate request shape and scalar values
2. Normalize and merge collection groups
3. Compute `current_count`
4. Convert `input_rarity` text to internal numeric rank
5. Compute `output_rarity_rank = input_rarity_rank + 1`
6. If no higher rank exists, return `no_higher_rarity_outcomes`
7. For each normalized collection, load base candidates for:
   - `collection`
   - `output_rarity_rank`
   - `stattrak`
8. If any collection has no candidates, return `collection_outcomes_missing`
9. For each base candidate, compute:
   - `probability`
   - `predicted_float`
   - `predicted_wearlevel`
10. Map to concrete skin row when possible
11. Build response summary:
   - `probability_total`
   - `probability_missing`
12. Return flat `outcomes` with no backend sort guarantees

## Rarity Handling

Predictor must use numeric rarity ranks internally.

- request text rarity -> numeric rank
- catalog rows store both display text and rank
- response maps rank back to display text

This avoids alias drift and keeps tests stable.

## Caching Strategy

First version uses in-process read-only caching.

- build catalog once on first request
- refresh automatically when `csgo_skins.db` file `mtime` changes

No external cache is needed for v1.

## Testing Plan

Minimum backend coverage for v1:

1. rarity rank conversion and `output_rarity` derivation
2. top rarity invalidation via `no_higher_rarity_outcomes`
3. collection alias normalization
4. merged collection split handling
5. collection count merge after normalization
6. invalidation when any collection has no higher-rarity outcome pool
7. real-time probability math when recipe is not full
8. `summary.probability_total` and `summary.probability_missing`
9. `StatTrak` pool isolation
10. base-skin aggregation so wear rows do not split probability
11. float formula correctness
12. wear boundary mapping at `0.07`, `0.15`, `0.38`, `0.45`
13. missing wear bounds keep probability but clear predicted float
14. concrete wear-level row mapping
15. fallback when concrete mapped row is missing
16. catalog cache refresh on database `mtime` change

## Implementation Notes

- Do not change existing database `alchemy_type` strings in this phase
- Predictor must remain backend-only for now
- Frontend grouping and placement will be decided later
- Implementation should prefer structured runtime fields over stringly-typed craft labels

## Acceptance Criteria

The backend design is considered ready for implementation when:

- predictor API contract is stable
- invalid-state behavior is fully specified
- base outcome aggregation and concrete wear remapping are both specified
- catalog alias normalization is shared with existing collection rules
- tests cover probability, wear, invalidation, and cache refresh paths
