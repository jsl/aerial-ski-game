# NEXT — single mandated task for the next GLM iteration (reviewer override, 2026-08-29 10:10)

Iteration 101 landed the overlay + reveal gate and new ridge meshes, but the author's reports are not yet met.
Do exactly these two items, in order, each committed separately. Athlete files stay off-limits (Opus lane).

1. **The reveal gate does not cover the shadow.** Author (HUMAN TESTING #5): "the skis and the skier's
   shadow appear before the skier". `73f04b6` has no shadow handling at all. Until `_bodyLinked > 0` and the
   reveal frame, no athlete/ski/boot/binding mesh may be in any shadow generator's render list (or be a
   shadow caster in any other way); add them in the same frame the meshes become visible. Extend
   `tests/drive/reveal-gate.spec.js`: assert every shadow generator's `getShadowMap().renderList` contains
   no athlete/ski mesh in any frame before the reveal, and contains them after; negative control: adding a
   ski to the render list early must fail.
2. **Mountains, second pass — they still read as flat pale shapes.** In `shots/scene.png` after 101 the
   ridges are smooth light-blue gradients with no rock, no snow fields, no tree-line; the author preferred
   the earlier peaks ("we seem to have lost texture on them so they seem very fake"). Do this properly:
   `git log -S ridgeline --oneline` / `git log -S mountain --oneline` to find the earlier cone peaks and
   their material; bring back that rock/snow texturing (triplanar or UV rock albedo + normal, snow above a
   slope/altitude threshold, darker forested lower slopes with a visible tree-line band) on the new 3D ridge
   meshes, with proper normals so the sun shades their facets, and reduce the haze so they are not washed
   out at the corridor distance. View `scene.png`, `inrun.png`, `kicker.png` and describe honestly what the
   ridges look like now; a smooth single-colour gradient ridge is a fail.

3. **Crash: too much crumple before the slide** (author, HUMAN TESTING #6). Tumble phase (≤ 1 s) must keep the
   body a recognisable figure: joint excursions within ±35° of the layout pose, spine bend ≤ 40°, no limb folding
   through the torso; then the near-rigid roll/slide to rest ON the snow as specified. Gate in the crash spec on
   the peak joint excursions during the tumble; negative control: a fully limp ragdoll fails.

Everything else resumes from the plan next iteration.
