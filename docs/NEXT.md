# NEXT — single mandated task for the next GLM iteration (reviewer override, 2026-08-29 11:20)

**Mountains, third pass — this time with a real acceptance.** The reviewer looked at `shots/scene.png` (11:08,
after `a29b3ee`): the ridges are still smooth pale-blue gradients — no rock banding, no snow fields, no tree-line.
The author has now said twice that the earlier cone peaks looked better. Your own by-eye verdicts have not
matched the reviewer's, so the gate is numeric this iteration, on a **ridge-only pixel mask**.

1. **Get the old look in front of you.** `git worktree add ~/aerial-agents/scratch/pre-curtain 047277e`
   (the commit before `f9b2b60` introduced the curtains), symlink `node_modules`, regenerate its `scene.png`
   / `inrun.png` there (DRIVE_PORT=8097), and open them next to the current ones. That is the contrast,
   rock/snow texture and readability to restore — on the layered 3D ridge meshes, not by reverting.
2. **Ridge-only instrument** in `ridges3d.spec.js`: build the mask by rendering one frame with the ridge
   meshes' `renderingGroupId`/layerMask isolated (or by colour-ID pass), then measure on `scene.png` and
   `inrun.png` inside that mask: (a) luminance std-dev ≥ 0.12 (texture/contrast; the current smooth
   gradients are ≈ 0.03–0.05); (b) mean luminance ≤ 0.72 (not washed out); (c) on the two nearest ridges
   a dark forest band (luma < 0.35, greenish) covering ≥ 15 % of their mask pixels, bottom-anchored;
   (d) rock pixels (luma 0.30–0.55, low saturation) ≥ 20 % and snow pixels (luma > 0.80) ≥ 15 % of the far
   ridges' mask. Negative control: the current `a29b3ee` tuning must FAIL (a)–(c).
3. **Make it pass properly**: procedural rock albedo with high-frequency noise and stratified banding in
   `makeRidgeSurface`, snow by slope + jittered altitude, forest band by altitude on the near ridges with a
   tree-line (impostor row or dark noise band with a ragged edge), per-ridge tint variance, fog mix on the
   near ridges ≤ 0.03 and far ridges ≤ 0.10, proper normals so the sun shades facets. Then regenerate
   `scene.png`, `inrun.png`, `kicker.png` and put the measured numbers in your entry.

Do nothing else this iteration except the checks. Remove this file when all three parts are committed.
