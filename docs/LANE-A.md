# Lane A — athlete build (parallel lane)

Branch `lane/athlete`, worktree `~/aerial-agents/lane-A`. Merged into `render-realism-glm` by the
reviewer. Context: `docs/RENDER-PLAN.md` (P7, P8), `docs/RENDER-PROGRESS.md` entries 21–32 (the
arm fix history), `docs/ANALYSIS-render-2026-08-26.md`.

## File scope (edit ONLY these)
- `blender/build_body.py`, `blender/bakeutil.py`, `blender/body-model.json` is READ-ONLY.
- `assets/athlete_body.glb`, `assets/athlete_albedo.png`, `assets/athlete_normal.png`,
  `assets/athlete_ao.png`, `assets/athlete_maps.json` (rebuilt by the pipeline).
- `tests/drive/rig.spec.js` (athlete gates only).
- `docs/LANE-A.md` (this file).
Anything else (e.g. a `game.js` material change, `ASSET_V`) goes under **Merge notes** below as
exact patch text — do not edit those files. Do not re-capture golden traces.

## Tasks, in priority order
1. **Hands too long / disproportionate (author).** Measure wrist→fingertip vs forearm length
   (real ratio ≈ 0.75; game hand ≈ 0.16 m). The glove cluster is likely stretched by the arm
   settle/fallback. Scale the hand cluster about the wrist to the ratio; hard-gate 0.65–0.85;
   verify hanging (`armDrop` 1) and raised (0) in the browser (`DRIVE_PORT=8199`).
2. **Shoulders still too big (author).** Bideltoid breadth target 0.38–0.40 m at standing height
   1.515 m (hard gate ≤ 0.41 m). Arm bones are at ±0.175 already; the residual is mesh: stretch
   the upper arm only below the deltoid crease, scale the shoulder-cap cluster back to the base
   mesh's proportion about the shoulder joint, re-smooth the trapezius. If the segment layout
   still forces width, write the proposed `body-model` number under **Merge notes**.
3. **Loose suit (author).** Suit shell offset 1.5–2.5 cm proud of the body (torso/thighs more,
   shins/forearms less, none at hands/face/boots); suit-only smoothing that erases muscle relief
   (measure normal-map variance in the suit UV region before/after); fabric folds at elbows,
   knees, hips, armpits, boot and glove cuffs; bib as a looser panel. Girth report must show the
   offset; folds visible in `figure*.png`.
4. **Helmet brim wraps behind the ears** (a skin patch shows from the rear quarter).
5. Turn every soft ARM GATE hard once a build passes them.

## Verification
Blender build (`~/opt/blender-5.2.1-linux-x64/blender -b --factory-startup --python
blender/build_body.py -- --out assets/athlete_body.glb --res 2048 --samples 96`) with the gate
summary lines; `DRIVE_PORT=8199 npx playwright test --config tests/drive/playwright.config.js rig`;
`look` shots (`DRIVE_PORT=8199 npx playwright test --config tests/drive/playwright.config.js look`)
inspected and described. Each iteration ends with a commit and an entry below.

## Reviewer feedback
- (none yet)

## Merge notes (for the reviewer)
- `ASSET_V` in `game.js` must be bumped at merge time whenever `assets/` changed in this lane.

## Progress
