# NEXT — single mandated task (reviewer override, 2026-08-30 12:50)

**P0: the corridor renders as a dark blue-grey slab against white flanks** (author screenshot
`reference/shots/author_messed_up_2026-08-30.png`; reviewer A/B `reference/shots/bug_grey_corridor_before_138.png`
vs `..._after_138.png`). Do this and nothing else.

0. **First**: the working tree is dirty from iteration 143's deadline (27 files, mostly re-captured golden
   traces + `blender/bake_trees.py`, `game.js`, `tests/drive/trees.spec.js`). Verify and commit it with an
   honest message, or revert it. Never carry it.
1. **Fix the P0.** It was introduced by iteration 138 (`fbbbe07`, "lightmap rewire — corridor unshared,
   tree-occluder rebake, proxies off the CSM"), refined by 142 (`4992619`): the corridor's material went
   `terrainMats` (no UV2) → `terrainMats_baked` (UV2) and the baked term darkens the whole ribbon.
   Preferred: **revert the rewire** — `fbbbe07` plus the corridor/UV2/`assets/terrain_shadow.png` parts of
   `4992619` — keeping iteration 139's crash work (`8405727`) and 142's B-net/terrainBase fixes if they are
   separable. If you keep the bake instead, the baked term must be a multiplier ≈ 1.0 on open snow.
2. **Fix the instrument that missed it.** GLM's grey-ramp probe indexes the framebuffer top-down while
   `readPixels` returns bottom-up rows — you recorded that y-flip in iteration 141 and then closed the
   grey-ramp finding in 142 with the mirrored numbers (`corridor 0.6783 vs flank 0.5873` claims the corridor
   is brighter; it is plainly darker). Correct the flip, then gate: corridor mean luminance ≥ 0.95 × the
   adjacent flank mean in `scene.png` and `inrun.png`, day mode; **negative control: the current
   `4992619` state must FAIL**.
3. Verify: `node tests/golden/audit-physics-state.js` → `capture.js` → `verify.js` (verify.js LAST),
   unit, `look`, `shadows`, `ridges3d`, `venue-dressing`; regenerate the shots and say by eye whether the
   corridor is white again.

Remove this file when all three are committed.
