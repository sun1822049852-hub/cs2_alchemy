# Craft Assist Raw Decimal Below Target Design

Date: 2026-05-02
Status: Draft for review

## Summary

The user-facing target wear input is a decimal number in `[0, 1]`, usually typed as a normal `0.x` value such as `0.21`, `0.18`, or `0.214285`.

The program must keep the user experience as decimal input, but internally it must preserve enough information to decide `below` mode correctly against float32 steps.

The key product rule is:

```text
below = the highest float32 step that is strictly lower than the user's original decimal input
```

This is not always the same as:

```text
prevFloat32(Math.fround(raw))
```

If `Math.fround(raw)` is already lower than the raw decimal input, that f32 step is the correct `below` target. Dropping one more step is too low.

## Goals

- Keep the user's input behavior simple: users type normal decimal target wear values in `[0, 1]`.
- Store a machine-valid float32 value so backend strict validation can still require `Math.fround(value) === value`.
- Preserve the user's original decimal input, or an equivalent raw-vs-step relationship, so `below` mode can choose the correct target step.
- Migrate existing saved craft assist presets without requiring the user to recreate them manually.
- Cover both single-account craft assist and batch craft assist.
- Keep `infinite` mode behavior clear and separate from `below`.

## Non-Goals

- No UI redesign.
- No change to material relative-wear candidate generation.
- No relaxing of backend float32 validation for the machine target value.
- No project-wide review.
- No changes to unrelated pages, unrelated saved state, or worktrees.

## Must Not Change

- Users should still feel like they are entering ordinary decimal wear values.
- Backend service logic must not accept arbitrary non-float32 machine target values as if they were valid steps.
- `below` must remain strict: equal to the user's raw input does not count as below.
- `raw === 0` remains unreachable for `below` in the non-negative `[0, 1]` wear domain.
- Do not globally change generic wear parsing helpers if they are used by unrelated wear ranges or pages.

## Problem Statement

The earlier float32 persistence fix made saved `target_wear` values valid for the backend by storing `Math.fround(raw)`.

That fixed this class of error:

```text
invalid_target_step
```

But it did not fully preserve `below` semantics. Once only `Math.fround(raw)` remains, the program can no longer tell whether the user's original decimal input was:

- above the f32 step,
- below the f32 step,
- or exactly equal to the f32 step.

That difference matters.

Example:

```text
raw = 0.21
step = Math.fround(raw) = 0.20999999344348907
```

Here `step < raw`, so `step` itself is already strictly below the user's input. `below` should be allowed to target `step`.

If the program instead always does:

```text
prevFloat32(step)
```

then `below` becomes one step lower than necessary.

## Domain Model

### User Raw Target

`target_wear_raw` means the user's original decimal input.

Recommended storage type:

```text
string
```

Reason: user input can have many decimal digits, and keeping the original text avoids losing intent before comparing it to a float32 step.

Examples:

```json
{
  "target_wear_raw": "0.21"
}
```

### Machine Target Step

`target_wear` means the machine-valid float32 step derived from the raw input.

Storage type:

```text
number
```

It must satisfy:

```text
Math.fround(target_wear) === target_wear
```

Example:

```json
{
  "target_wear": 0.20999999344348907
}
```

### Optional Raw Relation

If storing full raw text is not desired in every runtime path, the program may store an equivalent relation:

```text
raw_vs_step = "above" | "equal" | "below"
```

Where:

- `"above"` means `raw > Math.fround(raw)`
- `"equal"` means `raw === Math.fround(raw)`
- `"below"` means `raw < Math.fround(raw)`

However, saved presets should prefer `target_wear_raw` because it is easier to display and audit.

## Correct Below Rule

Let:

```text
raw = Number(target_wear_raw)
step = Math.fround(raw)
```

Then:

| Case | Meaning | Correct below target |
| --- | --- | --- |
| `step < raw` | the f32 step is already below the user input | `step` |
| `step > raw` | the f32 step is above the user input | `prevFloat32(step)` |
| `step === raw` | equal is not below | `prevFloat32(step)` |
| `raw === 0` | no valid lower wear step in `[0, 1]` | reject as unreachable |

Equivalent rule:

```text
if Math.fround(raw) < raw:
  below_target = Math.fround(raw)
else:
  below_target = prevFloat32(Math.fround(raw))
```

## Infinite Rule

`infinite` mode continues to target the machine step:

```text
infinite_target = Math.fround(raw)
```

`infinite` does not need to be strictly below raw.

## Persistence Contract

Saved craft assist presets should store both values:

```json
{
  "target_wear": 0.20999999344348907,
  "target_wear_raw": "0.21"
}
```

Meaning:

- `target_wear_raw` is the user's decimal target.
- `target_wear` is the nearest float32 step for backend validation and machine use.

Do not treat `target_wear` alone as enough to reconstruct `below` intent.

## Migration Contract

Existing presets may only have:

```json
{
  "target_wear": 0.21
}
```

For these legacy presets:

1. Treat the old `target_wear` value as the best available raw decimal input.
2. Write `target_wear_raw = String(old_target_wear)` during normalization or migration.
3. Rewrite `target_wear = Math.fround(Number(target_wear_raw))`.
4. Preserve materials, names, timestamps, and other unrelated fields.

Example:

```json
{
  "target_wear": 0.21
}
```

migrates to:

```json
{
  "target_wear": 0.20999999344348907,
  "target_wear_raw": "0.21"
}
```

This migration is not perfect for values that were already f32 machine values but lost their raw source. It is still the best compatibility path because old saved presets came from user-facing decimal input.

## Frontend Input Contract

When the user types a target wear:

1. Keep the input constrained to `[0, 1]`.
2. Keep or derive the user's raw decimal text before f32 quantization.
3. Store `target_wear_raw` as that decimal text.
4. Store `target_wear = Math.fround(Number(target_wear_raw))`.
5. Display should remain user-friendly decimal input, not force the user to understand float32 internals.

The UI may show the raw text while editing and may show a normalized decimal after commit, but it must not lose the raw-vs-step relationship needed by `below`.

## Request Contract

Requests to backend craft assist selection should carry enough data for mode-specific step resolution.

Recommended payload shape:

```json
{
  "target_wear": 0.20999999344348907,
  "target_wear_raw": "0.21",
  "wear_approach_mode": "below"
}
```

Backend behavior:

- Validate `target_wear` as a float32 step.
- Validate `target_wear_raw` as finite and inside `[0, 1]` when present.
- For `below`, resolve the target from `target_wear_raw`.
- For `infinite`, use `target_wear`.

Fallback behavior for missing `target_wear_raw`:

- For legacy callers, treat `target_wear` as both raw and step.
- This preserves compatibility but cannot recover the lost raw-vs-step relation.
- New frontend paths must send `target_wear_raw`.

## Predictor Contract

Craft outcome predictor must use the same raw-based `below` rule.

If predictor receives a decimal target such as `0.21`, `below` should predict against:

```text
highest float32 step strictly below 0.21
```

not blindly:

```text
prevFloat32(Math.fround(0.21))
```

This keeps predictor output aligned with craft assist selection.

## Acceptance Matrix

| User path | Input | Mode | Expected target |
| --- | --- | --- | --- |
| New manual input | `0.21` where `Math.fround(raw) < raw` | below | `Math.fround(raw)` |
| New manual input | `0.18` where `Math.fround(raw) > raw` | below | `prevFloat32(Math.fround(raw))` |
| New manual input | exact f32 text | below | `prevFloat32(raw)` |
| New manual input | `0` | below | unreachable error |
| New manual input | any valid `[0,1]` decimal | infinite | `Math.fround(raw)` |
| Legacy saved preset | only old `target_wear` exists | below | migrate raw from old value, then apply raw-based below rule |
| Saved and reopened preset | has `target_wear` and `target_wear_raw` | below/infinite | same result before and after restart |
| Batch craft assist | saved preset selected | below/infinite | payload carries both machine value and raw value |
| Predictor | decimal target input | below/infinite | same target-step semantics as craft assist |

## Required Tests

### Float32 Step Helper Tests

Add table-driven tests for raw-based below resolution:

- `raw > Math.fround(raw)` returns `Math.fround(raw)`
- `raw < Math.fround(raw)` returns `prevFloat32(Math.fround(raw))`
- `raw === Math.fround(raw)` returns `prevFloat32(raw)`
- `raw === 0` returns an unreachable-below error

### Frontend Tests

Cover:

- manual input stores both `target_wear_raw` and f32 `target_wear`
- saving a preset persists both fields
- loading a legacy preset migrates both fields
- applying a preset sends both fields
- batch craft assist sends both fields

### Backend Service Tests

Cover:

- `below` accepts the f32 step itself when `step < raw`
- `below` targets previous step when `step > raw`
- `below` targets previous step when `step === raw`
- `below` rejects raw `0`
- `infinite` still targets `Math.fround(raw)`

### Predictor Tests

Cover:

- predictor `below` uses `step` when `step < raw`
- predictor `below` uses `prevFloat32(step)` when `step >= raw`
- predictor `infinite` remains `Math.fround(raw)`

## Verification Requirements

Implementation is not complete unless all of these are checked:

- Existing backend float32 contract still rejects invalid machine `target_wear`.
- Old saved presets no longer trigger `invalid_target_step`.
- Old saved presets do not lose intended below behavior when raw can be reconstructed.
- New saved presets keep both raw and machine values.
- Single-account craft assist request carries both values.
- Batch craft assist request carries both values.
- Predictor and craft assist agree on the same below target for the same raw input.

## Known Risks

- Old presets that already stored only a machine f32 value cannot perfectly reveal the original user decimal input. Migration must document that limitation.
- If the frontend displays only the f32 machine value after save, users may see unfamiliar values like `0.20999999344348907`. UI display should prefer raw text or a friendly decimal.
- Extremely long decimal text near a float32 boundary may lose intent if parsed only as JavaScript `Number`. Preserve raw text for audit and future comparison improvements.

## Open Questions

- Should `target_wear_raw` be displayed exactly as typed after reopening, or should the UI display a friendly normalized decimal?
- Should backend require `target_wear_raw` for all new requests, or accept it as optional during a transition period?
- Should saved presets include an explicit schema version for craft assist preset migration?
