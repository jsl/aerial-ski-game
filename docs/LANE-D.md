# Lane D — pose-vs-physics study (parallel lane)

Branch `lane/pose-analysis`, worktree `~/aerial-agents/lane-D`. Merged into `render-realism-glm`
by the reviewer. Analysis only: no game code changes.

## File scope (edit ONLY these)
- `tools/pose_vs_physics.js` (new; node, no runtime deps) and helpers under `tools/pose/`.
- `docs/POSE-VS-PHYSICS.md` (new) and `docs/LANE-D.md` (this file).
Do not edit `game.js`, `engine/`, tests, traces or assets. Proposed physics changes are written
as numbered proposals in `docs/POSE-VS-PHYSICS.md`, never applied.

## Inputs (local, gitignored)
- `reference/pose/<clip>/keypoints.json` for all six clips: RTMPose COCO-17 at 30 fps, **all
  detected people per frame** with per-keypoint scores; `reference/pose/README.md` explains the
  format; `overlay_sheet_*.jpg` per clip for sanity checks; `reference/pose/IMG_3523_hop/` is a
  cropped, upscaled track of the hop turn. Venv: `~/aerial-agents/rtmpose-venv` (re-run
  `reference/pose/extract_all.py` with a crop for the small-athlete clips 3523/3520 if needed).
- `docs/REFERENCE-FOOTAGE.md` (per-clip description), `reference/frames/<clip>/` (2 fps frames).
- Game side: golden traces `tests/golden/traces/*.json` (physics `state` per keyframe: run
  `node tests/golden/capture.js --help` / read `tests/golden/verify.js` to learn the format) and
  the pose tables in `engine/core/body-model.js` (read-only).

## Task
1. **Track the athlete** in each clip by continuity (nearest to previous hips, plausible size
   change), treat score < 0.5 as missing, smooth ≤ 3 frames; write the per-clip track to
   `reference/pose/<clip>/athlete_track.json` (local) and a per-clip overlay sheet for the
   reviewer to check.
2. **Derive per clip** (camera-plane, 2D): takeoff frame (feet leave the lip), landing frame,
   **airtime**; number of flips and mean/peak **angular rate** from the unwrapped angle of the
   shoulder-midpoint → hip-midpoint vector (determine **single or double** per clip); in-run
   crouch depth and arm-sweep timing into the lip (`IMG_3768`); tuck/layout shape in flight
   (knee and hip angles); landing absorption duration and sink/spray timing (`IMG_7841`); the hop
   turn timings (`IMG_3523_hop`). State the scale assumption (155 cm ski / ~1.7 m athlete) and
   the uncertainty of each number.
3. **Compare with the game**: from the golden traces (single/double/triple/twisting scenarios)
   extract airtime, flip count, angular rate, takeoff and landing body angles, tuck timing; tabulate
   clip vs game side by side with deltas.
4. **Propose** the physics parameter changes that would close the gaps (kicker lip angle/height,
   takeoff speed, gravity scale, moments of inertia, tuck speed-up, landing absorption) with
   predicted effects — as numbered proposals for the reviewer to approve, not as edits.

## Verification
`node tools/pose_vs_physics.js` runs end to end from the repo root and regenerates
`docs/POSE-VS-PHYSICS.md` tables; overlay sheets show the chosen athlete track. Each iteration
ends with a commit and an entry below.

## Reviewer feedback
- (none yet)

## Progress
