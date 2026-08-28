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
- **Reviewer (17:25) on the iteration-2 finding — the fix is a re-extraction, do it as a follow-up iteration:** re-run RTMPose on a **tracked, upscaled crop** per frame (use `athlete_track.json` hips/bbox from iteration 1 to centre a crop of ~3× the person height, upscale to ≥ 600 px person height, as in `reference/pose/IMG_3523_hop/run_pose.py`), and apply **test-time rotation**: run the detector+pose on the crop at 0°, 90°, 180°, 270°, keep the orientation with the highest mean keypoint score and rotate its keypoints back — inverted athletes then get a properly inverted skeleton. Write `tools/pose/reextract_tracked.py` (venv python) producing `reference/pose/<clip>/keypoints_tracked.json`, re-run the tracker/metrics on those, and redo the rotation table. Do this for IMG_7841, IMG_3765, IMG_3768, IMG_3520, IMG_3523 (skip IMG_3396 if the night footage stays untrackable — say so). Airtime and takeoff/landing frames can also be taken from the bbox/hip trajectory even where the skeleton is poor. Then finish task items 3–4 (golden-trace comparison, numbered proposals).
- **Reviewer (18:10) — flip counts without a skeleton, two routes; do both in the next iteration:**
  (1) **Silhouette axis.** In the tracked crop during flight the athlete is against sky: threshold non-sky pixels (sky = high value, low saturation; or background-subtract against the median of the crop's border), take the foreground mask's **PCA major axis angle** per frame (skis included — they are long and align with the body in layout), unwrap (axis is mod 180°, so unwrap with a ±90° rule using the rotation direction from the previous frames), differentiate for ω, integrate for total rotation → flips. Cross-check with a **Hough line on the ski pixels** where visible. Report per clip: total rotation, flips (nearest 0.5), peak/mean ω, airtime from the bbox/hip trajectory (takeoff = feet leave the lip line, landing = bbox bottom meets the landing surface).
  (2) **VLM annotation as ground truth.** Make a 30 fps contact sheet of each clip's flight window (crop follows the athlete), view it, and annotate by eye: number of flips, layout/tuck/pike, twists if any, takeoff and landing frame indices. Put the annotation table in `docs/POSE-VS-PHYSICS.md` labelled as visual annotation with ±1 frame uncertainty, and compare it with (1).
  Then finish tasks 3–4 (golden-trace comparison and numbered proposals) using whichever numbers you trust more, saying which.
- Do not commit the `node_modules` symlink (now excluded via `.git/info/exclude`).


## Progress

### 1 — Athlete tracker + per-clip tracks, overlay sheets, study doc skeleton
Implemented task item 1. `tools/pose_vs_physics.js` (node, no deps) now reads all seven
clips from `reference/pose/<clip>/keypoints.json`, tracks the athlete
(`tools/pose/track.js`: score < 0.5 missing; nearest-hip continuity with step and
size-ratio gates; rescue gates after 5 lost frames for airborne re-entry; seeds re-run
from every usable person every ~15th frame, best run by hip-travel + coverage +
confidence; gaps <= 3 interpolated; 3-tap median smoothing), writes
`reference/pose/<clip>/athlete_track.json` (local), renders per-clip review sheets
`overlay_sheet_track.jpg` via `tools/pose/overlay_track.py` (venv python + cv2, skipped
gracefully when the venv is absent), and regenerates `docs/POSE-VS-PHYSICS.md`
(method, scale assumption 155 cm ski / ~1.7 m athlete with ±15–20% uncertainty, per-clip
track-quality table, known issues).

Verification: `node tools/pose_vs_physics.js` runs end to end from the repo root.
Coverage (tracked/frames): IMG_3396 92/142 (64.8%), IMG_3520 226/238 (95%), IMG_3523
230/314 (73.2%), IMG_3523_hop 96/96 (100%), IMG_3765 107/112 (95.5%), IMG_3768 179/179
(100%), IMG_7841 86/128 (67.2%). Sheets for all 7 clips inspected: IMG_3520/3523/
3523_hop/3765/3768 verified on the athlete (3768 stays on the athlete through in-run,
arm sweep, flight, ride-out); IMG_3396 and IMG_7841 partially track bystanders
(known-issues section in the study doc documents exactly where and why).

Open: task items 2–4 (per-clip metrics, golden-trace comparison, physics proposals);
3396/7841 track quality; `reference/` had to be copied into this worktree from the main
checkout (gitignored, not committed) — merge needs nothing from it.

Reviewer at merge time: nothing to wire; `game.js`, `engine/`, tests untouched. The
only committed artefacts are `tools/pose_vs_physics.js`, `tools/pose/{track.js,
overlay_track.py}` and `docs/POSE-VS-PHYSICS.md`.

### 2 — Rotation study: flip counts not derivable from current pose data; partial capture in IMG_7841; hop window bounded
Implemented the first slice of task item 2. New `tools/pose/metrics.js`: shoulder-midpoint →
hip-midpoint angle θ(f) (image plane, 0° upright), unwrapped (reset after gaps > 3 so camera
cuts never fake rotation), differentiated to ω °/s (3-tap median), rotation intervals =
maximal |ω| ≥ 90°/s runs (merge ≤ 2 frames, never across gaps), flips estimate only for
plausible intervals (≥ 0.25 s, ≥ 180°, peak ≤ 3000°/s), plus a max-θ-excursion-in-0.5 s
diagnostic and a hip-surge helper. `tools/pose_vs_physics.js` writes
`reference/pose/<clip>/athlete_metrics.json` (local) and regenerates a new doc section
"Rotation metrics (iteration 2)" with a per-clip table + analyst verdicts.

Key finding (evidenced in the doc): RTMPose fits near-upright skeletons to the inverted
athlete at small scale, so flip counts are NOT derivable for IMG_3396/3520/3523 from the
current keypoints.json (θ excursion ≤ 126°/0.5 s while the sheets show full inversions; the
3520 123° jump at f120–122 is a track re-lock after a 12-frame gap, hip +437 px f120→123).
IMG_7841 is the only real capture: θ ~80°→~25° in the last 0.50 s before touchdown (mean
165°/s, peak 310°/s) — the open-for-landing attitude change. IMG_3523_hop: turn window
f58–75 ± 2 (0.57 ± 0.07 s) bounded; the ±60–70 px hip "surges" are left/right keypoint
swaps (~1 torso width at original scale), not travel. Each non-derivable clip gets a
proposed re-extraction window (crop + upscale around flight: 3520 ~f90–155, 3523 ~f150–210,
3396 ~f75–125, 7841 ~f60–90) for the next iteration.

Verification: `node tools/pose_vs_physics.js` end to end; all iteration-1 numbers reproduced
identically (coverage 64.8/95/73.2/100/95.5/100/67.2%, torso medians unchanged); sheets
re-rendered 7/7. New numbers: θ excursions 46/123/126/34/51/88/84°; rotation intervals
1/4/2/0/1/0/1 per clip (only 7841's is real rotation).

Open: rotation-aware re-extraction of the flight windows (then airtime, takeoff/landing
frames, flip counts, single/double); crouch depth + arm-sweep timing (3768/3765); tuck
shape; landing absorption (7841); golden-trace comparison (task 3); proposals (task 4).

Reviewer at merge time: nothing to wire; `game.js`, `engine/`, tests untouched. New file
`tools/pose/metrics.js`; `tools/pose_vs_physics.js` + `docs/POSE-VS-PHYSICS.md` updated.
`reference/pose/*/athlete_metrics.json` are local-only (gitignored), like the tracks.

### 3 — Kinematics 1: arm-sweep timing into the lip (3768); crouch/tuck/absorption ruled not derivable, with evidence
Implemented the next slice of task item 2. New `tools/pose/kine.js`: re-joins the tracked
person's full COCO-17 keypoints per frame via the track's `person` index (the track file
stores only hip/shoulder midpoints) and derives interior joint angles (back, hip, knee;
deg, image plane) plus torso-normalised heights (wrist vs shoulder/knee, hip vs ankle) —
no px/m scale assumption enters any number. A sweep detector finds a sustained ≥ 0.6-torso
wrist rise over 8 frames inside a caller-set window. `tools/pose_vs_physics.js` writes
`reference/pose/<clip>/athlete_kine.json` (local) and regenerates a new doc section
"Kinematics (iteration 3)" with a sweep table, a ruled-out table (evidence + what would fix
each) and a P7-usable summary.

Numbers: IMG_3768 arms quiet f48–59 (wr/sh −0.99 ± 0.07 torso), sweep f58 ± 3 → f80,
wrists cross shoulder level f70 ± 1, peak +1.05 torso (overhead by the ears), duration
0.73 s; takeoff estimated f81 ± 3 (person re-locks f80–82, wrist keypoints drop out f81,
hip image-motion turns downward from f82) → sweep leads the lip by ~0.8 s. Flight is
layout: hip/ankle 1.27–1.41 torso constant f82–176, knee 175–180° (no tuck). IMG_7841
touchdown f82 ± 2 (back 93° → 49° → 54° airborne → 2° grounded; torso collapses 53 → 15 px
across the touchdown); ride-out knee/hip angles 167–180° at 14–15 px torso = pose floor →
absorption NOT derivable. IMG_3765: no sweep resolvable (wrists die f71), ascent visible
f72–81 (5.8–22.6 px/frame, hip angle dips to 148°). Ruled-out items each carry the
re-extraction window that would fix them.

Verification: `node tools/pose_vs_physics.js` end to end from the repo root; all
iteration-1/2 numbers reproduced identically (coverage 64.8/95/73.2/100/95.5/100/67.2%,
θ excursions and rotation intervals unchanged); sheets re-rendered 7/7. Sweep numbers
cross-checked against a manual read of the per-frame series (scratch script under
`~/aerial-agents/scratch/lane-D/`).

Open: rotation-aware re-extraction of the flight windows is blocked in this environment —
no source videos, no `extract_all.py`, no `reference/frames/` exist here (checked
worktree + `lane-A` + `stable`); only the committed-style keypoints/overlays were copied
in. Airtime, takeoff/landing frames, flip counts, single/double (task 2 remainder), the
golden-trace comparison (task 3) and proposals (task 4) remain. Crouch depth additionally
needs a profile view or side re-extraction (behind-view geometry, evidenced above).

Reviewer at merge time: nothing to wire; `game.js`, `engine/`, tests untouched. New file
`tools/pose/kine.js`; `tools/pose_vs_physics.js` + `docs/POSE-VS-PHYSICS.md` updated.
`reference/pose/*/athlete_kine.json` are local-only (gitignored), like tracks/metrics.

### 3 — Kinematics (arm sweep into the lip) + reviewer's tracked-crop re-extraction; flip counts isolated to a pose-model failure
Two units in this iteration. **(a) Kinematics slice of task 2** — new `tools/pose/kine.js`
re-joins the tracked person's full COCO-17 keypoints per frame via the track's `person`
index and derives interior joint angles + torso-normalised heights (no px/m scale);
`tools/pose_vs_physics.js` writes `athlete_kine.json` (local) and regenerates a
"Kinematics (iteration 3)" doc section. IMG_3768 arm sweep quantified: arms quiet f48–59
(wr/sh −0.99 ± 0.07 torso), sweep f58 ± 3 → f80, wrists cross shoulder level f70 ± 1,
peak +1.05 torso overhead, duration 0.73 s; takeoff estimated f81 ± 3 → sweep leads the
lip by ~0.8 s (direct P7 renderer input). Ruled not derivable **with evidence**: 3768
crouch (behind view — back ~0 ± 3° while sheets show a deep crouch), 3768 tuck (flight
hip/ankle 1.27–1.41 torso constant), 3765 sweep (wrists die f71) and crouch (base view),
7841 landing absorption (knee 167–180° at 14–15 px torso = pose floor; touchdown f82 ± 2).

**(b) Reviewer feedback (17:25) acted on**: `tools/pose/reextract_tracked.py` (venv
python) re-runs RTMPose on a per-frame crop centred on the tracked hip (~3× person height,
upscaled so the person is ≥ 600 px) at 0/90/180/270°, keeps all people with keypoints
rotated back (`keypoints_tracked.json`, local), and the same tracker + rotation metrics
were re-run on the windows of IMG_3520/3523/3765/3768/7841 (3396 skipped per the
reviewer; 3523_hop already had the crop treatment). Two decode findings baked into the
tool: cv2 ignores the videos' rotation metadata and colour range (best-person mean score
0.19 vs 0.64 once ffmpeg + extract_all.py's filter chain is used), and single-person
re-extraction breaks continuity, so all people are kept for the tracker. The source
videos live in the main checkout `~/Code/aerial-ski-game/reference/video` (this worktree's
`reference/` has only keypoints/overlays).

Result: detection quality strongly improves (best-person mean 0.60–0.73 in the windows;
3523 rx 100% coverage), **but flip counts remain not derivable — now with the failure
isolated to the pose model**: 3520's rx inherits the original track's stale crop centres
(f108–119 no-detection gap; 437 px bystander re-lock at f122, the event iteration 2
flagged); 3523 shows θ within 2–40° of vertical through the whole sheet-verified flight
at ≥ 600 px person height and 0.73 mean score, and the orientation picker prefers the
upright crop (0° in 52/60 frames) — neither scale nor orientation is the bottleneck.
Gains: 7841's opening-for-landing sweep confirmed at higher quality (f67–75, 41°/0.30 s,
peak 163°/s); 3765/3768 rx windows rotation-quiet, consistent with (a).

Verification: `node tools/pose_vs_physics.js` end to end; all iteration-1/2 numbers
reproduced identically (coverage 64.8/95/73.2/100/95.5/100/67.2%, θ excursions and
rotation intervals unchanged); sheets re-rendered 7/7; re-extraction runs logged in
`~/aerial-agents/scratch/lane-D/reextract.log` (245 frames × 4 orientations). Rotation
mapping unit-tested against `cv.rotate` (scratch `test_rotmap.py`: OK).

Open: flip counts / single-or-double need manual flight-frame annotation or a
rotation-robust pose model (posed to the reviewer; a 2-pass re-centred crop re-run is a
partial option but pass-1 tracks are already contaminated). Task 3 (golden-trace
comparison) and task 4 (numbered proposals) remain — the airtime/takeoff/landing-frame
derivation from bbox/hip trajectories (reviewer suggestion) is the next analysis step.

Reviewer at merge time: nothing to wire; `game.js`, `engine/`, tests untouched. New
committed files: `tools/pose/kine.js`, `tools/pose/reextract_tracked.py`;
`tools/pose_vs_physics.js` + `docs/POSE-VS-PHYSICS.md` updated. All
`reference/pose/*/*_track*.json`, `*_metrics*.json`, `*_kine.json`,
`keypoints_tracked.json` stay local-only (gitignored).
