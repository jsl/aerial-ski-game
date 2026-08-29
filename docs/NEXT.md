# NEXT — single mandated task for the next work iteration (reviewer, 2026-08-29 05:55)

This file overrides the plan order. Do ONLY this; delete it in the commit that completes it.

## Helmet crown + chest-wall ownership + corridor parity (one Blender rebuild)

1. **Hemispherical crown (slipped in 92 and 93).** The gate and negative control exist; the geometry
   fix was undone by a later pass. Find the pass (log the crown-height metric after EVERY head-touching
   pass: `shape_helmet`, `soften`, `relax_suit`, `narrow_shoulders`, `finish_lowpoly`) and make the
   dome survive: either `shape_helmet` produces the sphere cap fitted to the cranium landmarks with the
   rim plane as its base, or the hemisphere projection runs as the LAST geometry pass before
   `finish_lowpoly`, with an assertion on the final low-poly mesh (crown height ≥ 0.45 × head width;
   top-20% normals tilt ≥ 25° at the 80% radius). Turn the crown gate HARD.
2. **Chest-wall ownership (APPROVED (b), entry 91 q1).** `upperArmR` owns the right chest wall; reskin
   the chest band so the torso owns its own chest sides; re-run the arm gates (no regression); the chest
   instrument then measures 0.30–0.45 m at the nipple line and its sanity band goes back to 0.30.
3. **Corridor/flank parity (review-90 item 3).** Corridor luminance ≥ darkest flank in the scene view;
   grey-ramp gate HARD again; report before/after numbers.
4. Rebuild 2048/96, `ASSET_V` bump, describe `face.png`, `figure_side.png`, `scene.png` by eye.
