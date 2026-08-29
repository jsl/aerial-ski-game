# NEXT — the single mandated task for the next work iteration (reviewer, 2026-08-29 02:55)

This file overrides the plan order. Do ONLY this; delete this file in the commit that completes it.

## Crash: the roll-to-the-flat phase (author's repeated complaint; reviewer note 01:10)

Today the body stops ~1.2 s after the crash trigger, wherever it is — the inert crumple the author
rejected. Entry 84's "re-verification" passed only because the spec never asked for the roll.

Required behaviour (real browser, `crash-ragdoll.spec.js`):
1. `tumble`: full ragdoll for at most 1.0 s after the trigger (unchanged).
2. `roll`: the body becomes a near-rigid mass in its last pose and keeps moving DOWN the slope —
   sliding/rolling under gravity with friction deceleration ≈ 2–3 m/s² and angular damping, joints
   limited to ≤ 90°/s (no flailing) — for as long as the local slope under it is ≥ 10°.
3. `stopped`: when the slope under the body is < 10° (the flat) or speed < 0.1 m/s there, freeze;
   the body rests ON the snow (≥ 3 support points within 5 cm of the surface, none penetrating
   > 5 cm, no point > 0.6 m above the terrain under it); nothing moves afterwards.
4. Skis eject at the trigger and slide independently to rest on the snow.

Gates (all hard):
- if the crash trigger is on the landing slope (slope ≥ 20°), the rest position is ≥ 60% of the way
  from the trigger point down to the roll-out and on terrain with slope < 10°;
- total motion time 2–5 s on the standard landing; joint angular speed ≤ 90°/s after t+1.0 s;
- the resting-on-snow support-point gate above; skis on the surface;
- NEGATIVE CONTROL: with the roll phase disabled (build flag) the spec must FAIL on the rest-position
  gate. Record the measured timeline (t_trigger, roll start, rest, total, rest slope, distance) in the
  progress entry and describe a crash shot (add `shots/crash_rest.png` from the geometric side camera).

Do not touch face/helmet/legs/trees/sky in this iteration.
