# NEXT — single mandated task (reviewer, parallel Sol crash lane, branch sol/crash-cluster; author order 21:50: "launch a parallel sol xhigh sub-agent now to do the crash and walk off")

**THE CRASH CLUSTER. Multi-iteration task: it stays your only task until every gate below is green;
delete this file only in the commit that completes the whole set.** Full specs live in the
Reviewer-feedback entries named below — read them before coding. The suit mandate's remaining paint
items are re-queued AFTER this cluster; do not work on them here. Display-only throughout: no
`engine/` edits — if measurement proves the physics rest state itself is airborne, record the numbers
under Open questions and stop that item.

Order:

1. **#20 — the body lies COMPLETELY on the ground at crash rest** (author 21:45). At the end of every
   crash the whole body conforms to the local surface: no floating limbs, hips, or head. Gate in
   `crash-ragdoll.spec`, per world, at rest: downward-facing body points have max clearance ≤ 8 cm
   AND max penetration ≤ 5 cm across ALL segments; contact set includes torso + hip + ≥ 1 arm + ≥ 1
   leg. Negative control: the current build's floating segments FAIL.
2. **#13 — crash-slide tuning remainder** (author order, full spec in the #13 entry): slide onset
   ≤ 0.6 s after impact; μ_chop ≈ 0.45–0.55 (slower through the chop, 10–20 % slower at the chop
   bottom than μ_flat-throughout); world-scaled rest distances past the flat transition (single
   3–8 m, double 6–12 m, triple 10–18 m; never mid-slope, never off the out-run); ejected skis
   brake — 1–2 tumbles then rest ≤ 6 m from eject, ≥ 8 m uphill of the skier on double/triple.
   Gates with the current model as the failing negative control. Golden re-capture census-only with
   the audit if traces move.
3. **#14 — get-up and walk-off** (author; full spec in the #14 entry): ~0.5–1.0 s beat at rest, then
   a keyframed/procedural get-up (roll → kneel → stand, ~1.5–2.5 s, NOT a ragdoll re-entry), then a
   terrain-locked walk (~1.2–1.5 m/s, boots, no snow penetration) to just inside the near course
   boundary, clear of the corridor, never through a B-net; skis stay where they rested; end-of-run
   UI timing unchanged. Gate per world: within ~12 s of rest — standing pose, lateral offset ≥
   corridor half-width + 1 m, final speed 0, zero penetration, no net crossing; negative control:
   the current stay-down build fails. Verify this spec SERIALLY, not under parallel suite load.
4. **#18 — landing free-look view tilt** (full spec in the #18 entry): drag demand past the
   terrain-clamped beta becomes a smooth `camera.target.y` rise (view pitches up toward the jump,
   cap ~+35°), reversible, reset on R/free-look exit; the terrain clamp itself is UNCHANGED. Gate:
   scripted drag from crash rest brings the kicker lip's world point in-frame in every world with
   the clamp holding; tilt resets on R; negative control asserted FIRST (current build cannot).
   Canonical framings byte-similar.
5. **#19 — start flood lights its own pole** (one-liner, diagnosis in the #19 entry):
   `spotS.excludedMeshes.push(nightPoleStart)`; gate: night ready framing, each pole's mean
   luminance within 1.5× the median pole's; negative control: today's glowing start pole fails.

Each landed step: run the full verification chain per the standing rules (`verify.js` LAST when
traces move), regenerate the relevant shots, record the gate numbers in your progress entry.
