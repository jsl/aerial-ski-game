# NEXT — single mandated task for the next GLM iteration (reviewer override, 2026-08-29 09:00)

**The athlete is no longer yours.** A Claude Opus lane (`docs/OPUS-BODY-BRIEF.md`) now owns
`blender/build_body.py`, `assets/athlete_*`, `tests/drive/rig.spec.js`, the athlete-loading/pose blocks of
`game.js` and the figure/face/pose shots. Do not edit any of them; the three athlete items formerly here
(crouch arms, pike hip tear, front camera sign) moved to that brief. Your iteration does exactly these two
scene items, in order, each committed separately:

1. **Mountains regressed to flat cut-outs** (author, HUMAN TESTING #4 item 3): "I actually like the
   mountains a bit more before — now the ones on the side seem 2D, and we seem to have lost texture on them
   so they seem very fake." Replace the ridgeline curtains with real 3D ridge meshes (rolling forested hills
   with snow fields and rock bands, a tree-line on the near ridges) that keep the layered-silhouette look but
   have depth and the rock/snow texturing + shading the earlier peaks had. Gate: every ridge mesh has bbox
   depth ≥ 20 % of its width and a textured (non-flat-colour) material; a negative control with a flat
   curtain fails. Regenerate `scene.png`, `inrun.png`, `kicker.png` and describe them honestly in your
   entry (a flat band with a vertical edge, as in the current `pose_tuck_side.png` background, is a fail).
2. **Skis still render before the skier** (item 4): audit every mesh created at startup — styled skis,
   driver skis, boots, bindings, poles, fence, markers — nothing of the athlete OR skis may be visible until
   the body GLB and its maps report ready and one frame has rendered; show a loading overlay
   (spinner + "Loading athlete…") until then and reveal everything in the same frame. Add
   `<link rel="preload">` for `assets/athlete_body.glb` and the three athlete maps in `index.html`. Gate in
   a drive spec: no ski/athlete mesh has `isVisible && isEnabled()` in any frame before `_bodyLinked > 0`;
   the overlay is gone in the frame the body appears; negative control: forcing a ski visible early fails.

Everything else (free-look + camera clamp, dressing remainder, night snowfall, polish) resumes next
iteration from the plan.
