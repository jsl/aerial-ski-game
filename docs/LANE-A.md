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

### 1 — Hands scaled onto the anatomical hand/forearm ratio (hard-gated 0.65–0.85)

**What changed.** Task 1. Measured the shipped glb in the browser first: the glove cluster
extended **0.269 m past the wrist against the 0.25 m forearm segment — ratio 1.08**, i.e. a
hand as long as the forearm (the cluster inherits the forearm bone's x1.11 stretch from
`pose_onto_segments` and the settle fallbacks). Fix in `blender/build_body.py`:

- `scale_hands(body)` (after `settle_limb_geometry`): per side, measures the glove band
  (lowerArm-weighted verts below the wrist plane = bone tail) and scales it **z-only about
  the wrist plane** onto ratio 0.75 (length-only: the stretch was along the hanging arm
  axis, so cross-section/girth is kept), fading through a 5 cm cuff band above the wrist so
  the continuous mesh never tears. Only shortening applied.
- `hand_metrics` / `hand_ratio_gate`: hard gate on the FINAL geometry (after girth/boots):
  per-side ratio must be in **0.65–0.85**, else SystemExit. Build summary line:
  `HAND GATE summary: ratio 0.75..0.75 (gate 0.65-0.85, target 0.75)`; per-side
  `hand 269 mm vs forearm 250 mm (ratio 1.08) -> scale x0.70/x0.69 on 763 glove verts`.

`tests/drive/rig.spec.js` (athlete gates only):

- **New gate** "hands are proportionate to the forearm, hanging and raised": drives a real
  run (ArrowUp → ready turn → in-run → airborne), skins vertices by hand (raw CPU positions
  are bind-pose and go stale under pose), measures wrist→fingertip along the **forearm
  driver node's own local +Y axis** (centroid-to-centroid axes break when the flight pose
  bends the arm). Results: hanging **0.749/0.749**, in flight **0.749/0.749** — the hand
  follows its bone rigidly when the arms sweep overhead (armDrop → 0), no detach/stretch.
- **Instrument fix** in "hands hang beside the thighs": the hand centroid band was "lowest
  third by height", a proxy that only worked while the hand was stretched long; after the
  shortening it mixed cuff/forearm verts and read 0.1549/0.1536 vs the 0.155 threshold (a
  regression my shortening exposed in the instrument, not the geometry). Band is now the
  actual hand (verts distal of the wrist plane along the node axis): **L 0.1558, R 0.1552**
  vs > 0.155 — passes on real hand geometry. Threshold itself unchanged (its re-derivation
  is still the reviewer's open disposition from iter 30/32).

**Verification.** Blender build `--res 2048 --samples 96` green end-to-end (OPTIX);
`HAND GATE` in gate summary; ARM GATES unchanged by the z-only scale (12.5 mm / 24.3 mm /
10.5 deg / 28.0 mm — still soft, pre-existing, limits 10/10/10/5). Browser at
`DRIVE_PORT=8199`: **rig 8/8**, **look 1/1**, **athlete + athlete-wired + body +
ready-stance 11/11**. Shots inspected: `figure_front.png` / `figure.png` — gloves hang
beside the thighs ending mid-thigh, finger length proportionate; no long-finger read.

**Assets rebuilt** → `ASSET_V` must be bumped at merge time (see Merge notes).

**Open / next in lane priority.**
- Task 2 (shoulders bideltoid ≤ 0.41 m) is next; task 3 (loose suit) after it.
- ARM GATES remain over their limits (pre-existing whole-chain forearm lag, soft mode);
  not touched this iteration.
- Hand-clearance threshold 0.155 now passes on the corrected band but with ~0.5 mm margin;
  if the reviewer would rather re-derive the threshold, the band (node-axis distal-of-
  wrist) is the part worth keeping.
