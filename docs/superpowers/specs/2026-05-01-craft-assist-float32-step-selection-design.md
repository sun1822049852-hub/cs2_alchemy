# Craft Assist Float32 Step Selection Design

Date: 2026-05-01
Status: Approved in discussion, pending implementation plan

## Summary

Replace the current craft-assist target model from:

- "pick materials whose raw mean is close to a decimal target"

to:

- "pick materials whose raw mean quantizes to a specific float32 step"

The user input is already a concrete float32 step value. The backend must treat that value as the target step directly.

This design removes the current safety-margin approach for `below` mode and replaces it with exact float32-step targeting:

- current backend `infinite` mode (the user-facing "逼近" mode) targets the input step itself
- `below` mode targets the immediate previous float32 step

Selection still happens entirely in **material relative-wear space**. The algorithm must not pre-quantize every material candidate. Instead, it must:

1. compute raw material mean
2. quantize that mean with float32 semantics
3. evaluate success against the chosen target step

Once a candidate set lands on the target step, it is considered solved immediately and search stops. There is no same-step multi-solution ranking.

## Goals

- Remove `STEAM_PRECISION_MARGIN` and the safe-target workaround
- Make craft-assist selection target the same float32 step that Steam will settle on
- Keep existing material candidate generation and local replacement search structure
- Keep all selection math in relative-wear space
- Provide deterministic first-hit behavior

## Non-Goals

- No skin wear-range database correction in this phase
- No changes to outcome predictor or trade-up simulation UI contracts
- No per-material pre-quantization pass
- No "best among multiple same-step hits" search after the first valid hit
- No handling of user-input offset wear values in this phase
- No frontend redesign

## User-Confirmed Constraints

- The input wear value is already a float32 step value, not a free-form continuous target
- `below` mode must target the immediate previous float32 step of the input step
- current backend `infinite` mode (the user-facing "逼近" mode) must target the input step itself
- If search lands on the target step, that is already a valid answer and search must stop immediately
- The algorithm must continue choosing materials by relative wear
- The current safety-margin chain must be removable after this design lands

## Problem Statement

Current craft assist uses raw material mean as the primary optimization target and then applies a safety margin to avoid Steam-side float32 settlement drift.

That model is wrong at the target-definition layer:

- the backend compares raw `mean` against a decimal target
- Steam settles on a float32-quantized result
- therefore a raw mean that appears valid in decimal space may settle onto a different float32 step in Steam

The fix is not to quantize each material independently. Existing evidence shows that the relevant settlement behavior is tied to the **final mean quantization**, not to a "float32 accumulator for every material operation".

The correct comparison object is:

```text
quantized_mean = f32(raw_mean)
```

Selection must target `quantized_mean`, not `raw_mean`.

## Existing Behavior To Replace

The current implementation contains the following concepts which this design replaces:

- `getCraftAssistOutcomeSafeTarget(...)`
- `STEAM_PRECISION_MARGIN`
- `safeTargetValue`
- `below` mode target adjustment `target - margin`
- below-mode solved checks based on `overall < target - EPSILON`

Current search and correction logic still assumes a scalar decimal target and computes deltas such as:

```text
target - overall
```

This design replaces that with step-based solved checks and range-based correction hints.

## Chosen Architecture

### New Helper Module

Add a small helper dedicated to float32 step math:

- `node_sidecar/src/services/craftAssistFloat32Step.js`

Suggested responsibilities:

- `toFloat32(value)`
- `prevFloat32(step)`
- `nextFloat32(step)`
- `resolveCraftAssistTargetStepSpec({inputStep, approachMode})`
- `quantizeMeanToTargetDomain(mean)`
- `isMeanOnTargetStep(mean, targetStep)`
- `compareMeanToTargetRange(mean, rangeSpec)`
- `distanceFromMeanToTargetRange(mean, rangeSpec)`

This keeps the step/interval math isolated from the rest of `craftAssistSearch.js`.

### Existing Modules To Update

- `node_sidecar/src/services/craftAssistService.js`
- `node_sidecar/src/services/craftAssistSearch.js`
- `node_sidecar/src/services/craftAssistShardPrefilter.js`
- `node_sidecar/src/services/craftAssistShardWorker.js`

No new API route is required.

## Core Domain Model

### 1. Input Step

Let:

- `q_input` be the user-provided target value

`q_input` is already a concrete float32 step value. The backend must not reinterpret it as a free-form decimal target that needs rounding to the nearest step.

Backend validation must enforce this contract:

- parse input as number
- reject non-finite values
- reject any value outside relative-wear domain `[0, 1]`
- reject any value for which `Math.fround(value) !== value`

If validation fails, the request must stop early with an explicit invalid-target-step error.

### 2. Mode-Specific Target Step

- current backend `infinite` mode:
  - `q_target = q_input`

- `below` mode:
  - `q_target = prevFloat32(q_input)`

Special case:

- if `below` mode receives `q_input === 0`
  - there is no reachable previous step inside relative-wear domain `[0, 1]`
  - the request must stop early with an explicit unreachable-below-target error

### 3. Raw Mean

For selected material relative wears `r1 ... r10`:

```text
raw_mean = (r1 + r2 + ... + r10) / 10
```

All `ri` values remain the existing material relative-wear values. There is no preprocessing step that rewrites each material candidate to `f32(ri)`.

### 4. Quantized Mean

The authoritative Steam-style comparison value is:

```text
quantized_mean = f32(raw_mean)
```

This value is still in **relative-wear space**.

### 5. Solved Condition

A selection is solved iff:

```text
quantized_mean === q_target
```

This equality check is the authoritative success rule.

## Step Range Model

Although solved detection is defined by exact step equality, search correction benefits from a raw-mean interval for the target step.

For a target step `q_target`, define:

- `q_prev = prevFloat32(q_target)`
- `q_next = nextFloat32(q_target)`

And define a target raw-mean guidance envelope from adjacent float32 steps.

For design purposes, represent it as:

```text
raw_mean ∈ [L, U)
```

Where `[L, U)` is the canonical raw-mean guidance envelope around `q_target` used for distance heuristics.

Implementation note:

- `f32(raw_mean) === q_target` is authoritative
- `[L, U)` is a correction/pruning helper
- midpoint tie behavior must follow IEEE-754 round-to-nearest-even semantics

The helper module must expose a guidance range / distance helper derived from adjacent float32 steps and must encode the midpoint tie rule internally.

Important constraint:

- solved-state must **never** rely on raw interval bounds alone
- midpoint edge cases must always be resolved by direct `f32(raw_mean) === q_target` comparison
- interval bounds are heuristics for direction and distance, not the source of truth for final hit classification
- therefore `[L, U)` is intentionally treated as a guidance envelope, not as the sole exact solved predicate

## Search Semantics

### Primary Search Variable

The search variable remains the selected material set.

The algorithm does **not** search directly in step space. It still:

- swaps materials
- recomputes `raw_mean`
- recomputes `quantized_mean`
- re-evaluates solved state

### Success Rule

The first candidate set for which:

```text
f32(raw_mean) === q_target
```

must be returned immediately.

There is no same-step multi-solution ranking after a hit.

### Stop Propagation Rule

`first hit wins` applies to the **entire service request execution order**, not only to one inner search helper.

Once any phase produces a complete candidate set with:

```text
f32(raw_mean) === q_target
```

the following phases must not continue searching for alternatives:

- later rarity-loop branches
- later base/expand prefilter retries
- later beam-cap expansion rounds
- later context refinements
- later role-aware refinements
- later post-search correction passes

The first complete hit observed in deterministic execution order is the final answer for that request.

For this spec, deterministic execution order includes:

1. prefilter-enabled staged search
2. any immediate solved return produced by that staged search
3. if no solved hit is produced, fallback full unfiltered search
4. if the fallback full search hits, immediate return

This means `first hit` is defined against the actual approved staged execution plan, not against a hypothetical always-full traversal.

### Determinism

Because the first hit wins, determinism comes from stable traversal order:

- stable candidate ordering
- stable beam pruning
- stable replacement iteration order

The implementation must preserve that order explicitly and must not rely on hash iteration.

## Correction Heuristic

### Old Model

Current code conceptually uses:

```text
delta = target - overall
```

where `overall` is raw mean.

### New Model

The new correction heuristic must use target-step interval distance instead of point distance.

Given target interval `[L, U)`:

- if `f32(raw_mean) === q_target`
  - selection already quantizes to the target step
  - stop immediately

- else
  - correction direction must follow the authoritative step comparison rule below
  - raw interval distance only provides correction magnitude

This means:

- correction still happens in raw relative-wear space
- but the correction target is a **step interval**, not a decimal point target

Direction classification must follow this order:

1. compute `quantized_mean = f32(raw_mean)`
2. if `quantized_mean === q_target`, hit and stop
3. else if `quantized_mean < q_target`, treat as too low
4. else treat as too high

Raw interval distance remains a heuristic magnitude signal, but step comparison is authoritative for low/high side classification near midpoint boundaries.

### Important Clarification

The design does **not** attempt to invert:

```text
targetStep - f32(raw_mean)
```

into an exact material-side scalar adjustment.

That inversion is not single-valued because float32 quantization is a step function.

Instead:

- step equality provides the solved condition
- interval distance provides the correction heuristic

## Ranking Before A Hit

Before any solution hits the target step, candidates should be ranked by:

1. distance from `raw_mean` to the target interval `[L, U)`
2. existing local tie-break structure already used by the current algorithm

The design intentionally does not add a "closest to interval center" ranking because the user explicitly rejected same-step multi-solution selection.

Candidate ordering before search must remain stable and explicit:

- primary scalar ordering should use distance to the target guidance envelope `[L, U)`
- existing role-aware side bias may remain
- exact ties must continue to use existing stable value/id ordering

This preserves deterministic "first hit wins" behavior.

## Service-Level Changes

### Craft Assist Entry Point

In `selectCraftAssistForRecipe(...)`:

- stop adjusting target by `STEAM_PRECISION_MARGIN`
- stop deriving `safeTargetValue`
- build a `targetStepSpec` once from:
  - input step
  - approach mode

Suggested shape:

```js
{
  inputStep: number,
  targetStep: number,
  prevStep: number | null,
  nextStep: number | null,
  lowerBound: number,
  upperBound: number,
  approachMode: "below" | "infinite"
}
```

Then pass `targetStepSpec` into candidate collection, search, refinement, and final validation.

Any outer service phase that receives a solved hit from a child phase must return immediately instead of continuing to compare solved candidates.

### Final Validation

`validateCraftAssistFinalOverall(...)` must stop checking raw decimal comparisons like:

```text
overall < target
```

and instead check:

```text
f32(overall) === targetStep
```

For diagnostics, validation should log:

- `raw_mean`
- `quantized_mean`
- `input_step`
- `target_step`
- `target_range`

## Search-Level Changes

### Signature Changes

Replace scalar `targetValue` with `targetStepSpec` in step-aware search functions.

At minimum this affects the functions behind:

- `searchCraftAssistBestSolution(...)`
- score helpers
- solved-candidate helpers
- role-aware refinement and compensation helpers
- shard prefilter helpers
- shard worker ranking helpers

### Scoring Changes

Functions such as:

- `scoreCraftAssistSolutionSingleMaterial(...)`
- `scoreCraftAssistSolutionNeutral(...)`
- `scoreCraftAssistSolutionMultiMaterial(...)`
- `scoreCompleteSelection(...)`

must:

1. compute `raw_mean`
2. compute `quantized_mean = f32(raw_mean)`
3. return solved immediately if `quantized_mean === targetStep`
4. otherwise score by interval distance

### Below-Mode Branches

All below-mode branches that currently assume:

```text
overall < target - EPSILON
```

must be redefined as:

```text
f32(raw_mean) === prevFloat32(inputStep)
```

or equivalently:

```text
raw_mean ∈ preimage(prevFloat32(inputStep))
```

### Prefilter Changes

Oversized-material prefiltering remains allowed, but it must become step-aware.

Specifically:

- any ranking that currently uses scalar `targetValue` must switch to `targetStepSpec`
- prefilter ordering must remain deterministic
- prefilter may prune by step-aware heuristics
- prefilter must not preserve old decimal-target assumptions that could discard valid step-hit candidates under the approved staged execution order

The prefilter layer cannot declare final success by itself unless it has produced a complete candidate set that satisfies the same authoritative hit rule:

```text
f32(raw_mean) === q_target
```

If prefilter-enabled staged search does **not** produce a solved hit, the service must retry a full unfiltered search before returning failure.

This rule prevents prefilter pruning from creating false negatives while still allowing prefilter to remain part of the approved deterministic execution order.

## Logging Changes

Current logs label `predicted_overall` as a single result value. After this design:

- `predicted_overall` should remain the raw mean if retained
- add a new explicit log field for the authoritative comparison value:
  - `predicted_step_mean`

Recommended selection-complete log shape:

```text
target_input_step=<q_input>
target_step=<q_target>
predicted_raw_mean=<raw_mean>
predicted_step_mean=<f32(raw_mean)>
hit=true|false
```

This keeps future debugging grounded in the correct target domain.

## Wear Offset Path

Superseded by follow-up spec:

- `docs/superpowers/specs/2026-05-01-craft-assist-offset-step-window-design.md`

The original float32-step phase intentionally ignored user-input wear-offset values. The follow-up spec defines how the existing positive offset input expands the acceptable float32 target-step window while preserving the same authoritative final hit rule.

Historical note for this base phase:

This phase did not define any behavior for user-input wear-offset values.

Scope boundary:

- step-target search in this spec is defined only for no-offset flows
- any user-supplied offset value is outside the scope of this document
- if a request carries offset input in this phase, the offset input is ignored
- existing offset-related logic is intentionally not redesigned here

Implementation note:

- requests with active offset input still use this step-target behavior in this phase, but the offset field must be ignored
- if future implementation work needs to preserve, remove, bypass, or redesign offset-related behavior, that work must be covered by a separate follow-up spec instead of inferred from this document

## Testing Plan

Minimum coverage required:

1. current backend `infinite` mode:
   - selection succeeds when `f32(raw_mean) === q_input`

2. `below` mode:
   - selection succeeds when `f32(raw_mean) === prevFloat32(q_input)`

3. no safety margin:
   - `STEAM_PRECISION_MARGIN` path removed
   - no `safeTargetValue` comparison remains

4. raw-mean interval guidance:
   - correction chooses raise/lower direction based on `[L, U)`
   - midpoint-sensitive cases still use authoritative step comparison for final low/high classification

5. first-hit semantics:
   - once a hit is found, search stops across the whole service request and does not continue ranking same-step alternatives

6. deterministic result:
   - same input still returns the same first-hit solution across runs

7. regression samples:
   - sample around `0.27` where the old raw-mean comparison was misleading
   - sample around `0.24`
   - at least one `below` sample and one current backend `infinite` sample

8. validation:
   - final validation uses `f32(raw_mean) === targetStep`

9. boundary cases:
   - `below` with `inputStep === 0` is rejected explicitly
   - non-float32 input target is rejected explicitly

10. prefilter parity:
   - shard prefilter / worker ranking uses the same target-step semantics as the final search

## Acceptance Criteria

The design is ready for implementation when all of the following are true:

- user input is treated as an exact float32 step
- `below` mode targets the immediate previous float32 step
- search solved-state is defined by exact quantized-step equality
- the safety-margin target-adjustment chain is removable
- material selection remains in relative-wear space
- the algorithm stops on the first hit inside the target step
- no same-step post-hit ranking remains
- tests lock the new semantics in place
