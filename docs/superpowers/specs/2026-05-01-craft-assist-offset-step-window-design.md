# Craft Assist Offset Step Window Design

## Goal

Make the existing positive wear-offset input participate in float32-step craft assist selection without bringing back the old raw safety-margin behavior.

## Scope

This follow-up only changes backend target-step selection semantics for `/api/craft/assist-select`.

Must not change:

- UI field names or route payload shape.
- Wear-range database values.
- Per-material relative-wear calculation.
- The final authoritative hit rule: `Math.fround(raw_mean)` must match an allowed target step.
- First-hit behavior for the no-offset single-step case.

## User-Facing Semantics

The offset input is always a positive tolerance. Direction comes from the approach mode.

For `below`:

- primary target step is still `prevFloat32(inputStep)`.
- positive offset expands the allowed target steps downward.
- allowed window is:
  - upper step: `prevFloat32(inputStep)`
  - lower step: `Math.fround(max(0, inputStep - offsetValue))`
- priority is from high to low: first try the nearest below step, then the next lower step, and so on until the lower offset boundary is covered.

For `infinite`:

- primary target step is still `inputStep`.
- positive offset expands the allowed target steps on both sides.
- allowed window is:
  - lower step: `Math.fround(max(0, inputStep - offsetValue))`
  - upper step: `Math.fround(min(1, inputStep + offsetValue))`
- priority is closest to `inputStep` first.
- if the lower and higher sides are equally close, prefer the lower-wear side.

The existing UI sends `wear_offset_pct`. Backend continues to convert that percentage into an absolute offset value using the existing `target * pct / 100` rule.

## Architecture

Extend `craftAssistFloat32Step` from a single target-step spec into a target-window spec while keeping the existing `targetStep` field as the primary target.

Add helper behavior:

- `lowerTargetStep` and `upperTargetStep` describe the allowed quantized-step window.
- `isMeanOnTargetStep(mean, spec)` returns true when `Math.fround(mean)` is inside the allowed window.
- `isMeanOnPrimaryTargetStep(mean, spec)` returns true only for the primary step.
- scoring helpers rank allowed hits by target-step priority:
  - `below`: larger step first, because it is closer to the input step.
  - `infinite`: smaller absolute distance to input first, tie goes lower.

Search and prefilter continue to use interval distance for candidates outside the window, but allowed hits are ordered by target-step priority before normal tie-breakers.

## Service Behavior

`selectCraftAssistForRecipe(...)` must build `targetStepSpec` with:

- parsed `inputStep`
- normalized approach mode
- absolute offset value from `getCraftAssistWearOffsetByTarget(targetValue, wearOffsetPct)`

Across rarity branches:

- a primary-step hit can return immediately.
- an allowed non-primary offset hit is kept as a fallback.
- later rarity branches may replace it only if they hit a higher-priority target step.
- if no allowed hit exists, return the existing failure shape.

Final validation accepts any allowed target step in the window and logs:

- `input_step`
- `target_step`
- `lower_target_step`
- `upper_target_step`
- `quantized_overall`

## Testing

Required focused coverage:

- helper resolves `below` offset window downward from `prevFloat32(inputStep)`.
- helper resolves `infinite` offset window on both sides of `inputStep`.
- helper priority ranks `below` primary before lower offset steps.
- helper priority ranks `infinite` input first, then nearest lower, then nearest higher on equal distance.
- service no-offset behavior still targets only one step.
- service `below` with offset accepts a lower allowed step when primary is unavailable.
- service `below` with offset rejects a result below the lower offset boundary.
- search prefers the primary allowed step when both primary and lower offset hits are available.
- search can return a lower offset hit when the primary step is unavailable.
- prefilter / shard worker ranking use the same window-aware distance and priority.

## Acceptance Criteria

- Offset is no longer ignored in craft assist.
- `below` expands only toward lower wear.
- `infinite` expands to both sides.
- The first usable solution is selected according to target-step priority, not raw decimal distance alone.
- The old `safeTargetValue` / `STEAM_PRECISION_MARGIN` chain remains absent.
- Existing predictor float32 quantization remains unchanged.
