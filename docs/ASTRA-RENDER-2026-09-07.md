# Astra skier rendering review — September 7, 2026

Branch: `render-realism-glm` (initially clean, never switched to main).

User direction: retain the established slim aerialist/racing suit; reduce shoulder
slope and upper-body bulk; correct backward/double-toed boots; keep both toe and
heel fixed during downhill skiing and aerials. Skis may release during crashes.
Smooth the tuck transition and crash body deformation. After crashes, allow scene
panning and substantial zoom-out. User extended the review loop to approximately
18:00 Pacific local time (2026-09-08 01:00 UTC).

Earlier feedback is in `RENDER-PROGRESS.md` (September 1 heel lift/tuck entry,
September 2 boot shape and slide crumpling, September 4 upper-body bulk) and
`HANDOFF-BODY-2026-09-05.md`, including the September 7 F9/F10 updates.

## GPU setup

Both the asset build and actual browser renderer were verified on the NVIDIA
GeForce RTX 5070 Ti. Blender 5.2.1 uses Cycles OptiX. Browser checks use
`DRIVE_GPU=1`, selecting headless ANGLE/Vulkan without SwiftShader. Actual loaded
game reports WebGL 2 and `ANGLE (NVIDIA, Vulkan 1.4.329 (NVIDIA NVIDIA GeForce
RTX 5070 Ti (0x00002C05)), NVIDIA)`.

```
DRIVE_GPU=1 DRIVE_PORT=8395 npx playwright test -c tests/drive/playwright.config.js freelook.spec.js
DRIVE_GPU=1 DRIVE_PORT=8396 npx playwright test -c tests/drive/playwright.config.js boot-sole.spec.js '(^|/)look.spec.js$' pose-shots.spec.js
```

Keep frame-sensitive crash/get-up/walk-off suites sequential. The portable test
configuration still supports software rendering when `DRIVE_GPU` is unset.

## Baseline and first visual pass

Artifacts: `shots/astra-before/` and `shots/astra-pass1/` (ignored, reproducible).

- Baseline side view: the rounded boot toe points backward; shoulders/back are
  bulky, the waist lacks taper. Existing signed boot-axis tests encode the
  backward shape (longer projection toward the ski tail).
- New delivered-sole measurement selects the actual skinned sole bottom vertices
  and transforms them into the ski frame. At grounded tuck 0.25/0.5/0.75/1.0,
  heel lift reaches approximately 19/39/59/77 mm. The old ankle-point check
  assumes a parallel sole, hiding this rotation. Aerial tuck/pike stay within
  4.6 mm in the baseline.
- First build: correct forward toe and shorter upright heel; independent boot
  bones keep soles parallel while cuffs follow shin flex. The first review
  catches a 27 mm downward seating offset and exposed old foot geometry behind
  the shorter heel. These must be corrected before accepting the asset.
- Existing TORSO1 torso shaping now passes after F9's topology repair: chest
  depth 206 mm, waist/chest 0.819, maximum profile step 8.7 mm. Modest shoulder
  crown lift added. The first visual review still sees excess upper-back mass.
- Grounded stationary tuck previously blends through an aerodynamic crouch and
  then back toward a squat. Direct standing-to-squat interpolation removes that
  detour while retaining in-run pose blending and gameplay state.
- Crash spine uses wrapped relative angles so crossing the ±pi Euler boundary
  cannot introduce a false 180-degree difference in thigh/head alignment.

Boot shape gate correction is based on the user's explicit request and physical
orientation: the toe must extend toward the upturned ski shovel, the heel toward
the tail. New design projects 180 mm forward and 70 mm backward about the fixed
ankle station. It replaces tests demanding the opposite direction; it does not
relax sole contact or foot containment.

## Camera correction

Automatic crash framing previously pulled radius toward 1.9 m every frame and
re-centered the target during panning. A mouse/touch camera gesture, wheel input,
or WASD camera input now takes ownership until the next run. The free-look range
extends to 240 m; panning scales with view distance. Automatic initial crash
framing remains available before user input, and the terrain clamp remains live.

The forced-crash browser regression passes with real wheel zoom to 240 m and a
roughly 15 m right-drag pan. After Babylon finishes easing, the target stays
exactly where the user placed it. The baseline orbit-persistence test failed
before this fix. Full camera/terrain regression results are recorded below when
complete.

## Second visual pass (v106)

- Full 3D boot offset now follows the ski normal, including the 22-degree roll
  in the across-slope ready stance. Actual toe/heel contact passes the 5 mm
  gate; the previous offset had omitted the normal's lateral component.
- The hidden old foot is reshaped inside the boot shell; side-view review shows
  no backward foot protrusion. Assets rebuilt with OptiX at 2048/96.
- Unit tests: 88/88. Golden scenarios: 30/30 unchanged. GPU spine suite: 14/14.
- Camera suite: 6/6. Extra landing-tilt coverage in all three worlds passes
  after preserving the tilt baseline across drags and refreshing the camera
  view after terrain clamping.
- Wider body regression: 24 pass, 5 fail. Remaining failures concern ankle
  pixel framing, the old bbox-midpoint ankle station, rendered strap sampling,
  leg-axis station measurement, and stationary hand-to-knee reach (208 mm
  against a 200 mm limit). These are under investigation, not waived.
- Live tuck-entry reports an existing 144 mm shoulder handoff jump and an
  80 mm hip start jump despite passing its interim 150 mm limit. These are
  the next animation targets; passing that interim gate does not mean smooth.
- Upper-back vertices are predominantly upper-arm/shoulder-helper owned, so
  the torso-only reshaping misses the remaining rounded shoulder mass. Palette
  indices must be resolved with `bone.getIndex()`; array order includes a
  synthetic root and differs by one. No remote-knee weighting defect was found.

The rendered sole test now samples both stationary squat and downhill crouch,
aerial tuck and pure pike; a 3 cm displacement of the actual boot meshes is its
negative control. The stationary pose helper takes a stationarity weight as its
second argument (1 at the gate, 0 while moving), not a second tuck amount.

## Cuff instrument correction (before the third build)

The old leg-axis G2/G3 tests locate the ankle at the boot bbox midpoint. That
midpoint moves deliberately when correcting the backward toe and shortening the
heel; it is unsuitable for the ankle station. The replacement uses actual
skinned cuff-ring vertices in each ski's local frame, with side-specific leg
ownership resolved through the skin palette. G1 retains 30 mm; G2 retains 35 mm;
G3 retains a 60 mm block-displacement bound about the ski mounting station.
Actual vertex counts replace the old hardcoded `n:1`. An additional negative
control translates the rendered boots 120 mm along their skis.

This improved instrument stays RED on v106: left/right cuff centers are
-32/-34 mm along ski z while the shins are +12/+15 mm (44/49 mm mismatch).
The earlier stable asset has cuff centers +38/+35 mm and shin centers +11/+14 mm.
Thus the toe correction also flipped too much cuff lean; the next build must
fix cuff alignment independently of the toe. The instrument does not hide this
real regression. `tools/measure-leg-axis.js` is shared by the browser test and
`tools/probe_leg_axis.js` so the public probe reports the same geometry.

## Live tuck motion review

`tools/capture-skier-motion.js` records a real keyboard-driven tuck cycle with
GPU-rendered video, stills and per-frame driver positions. Baseline footage from
the stable preview (`shots/astra-motion-before/`) exposes a 521 mm leg jump at
full tuck. The initial working-source capture also catches a 534 mm jump from
tuck 0.9995 to 1.0, confirming a true endpoint discontinuity rather than input
speed. Joint-gap tests missed it because the connected body moved together.

The P13 renderer correction used its nominal blend weight only as an on/off
condition; it also positioned the shin using the thigh angle and relocated the
skis from that temporary chain. Grounded skis now retain their authored stations,
and the shin uses its own angle. The ready-stance thigh adjustment now preserves
the underlying squat instead of replacing it until a threshold. Grounded arm
attachments use the actual shoulder station rather than the torso's neck end.

New actual-motion regression passes: 74 frames, worst torso step 30 mm and
forearm step 61 mm during the initial 0→0.0835 input increment. The endpoint snap
is gone. The gate bounds per-frame driver movement relative to the tuck change,
with a small allowance for ready sway. Crouch suit/back appearance still needs
visual refinement; the saved video/stills document that separately.

## Third build and shoulder attachment

Asset v107 keeps the toe correction while restoring a neutral 3-degree cuff
lean independently of toe direction. Delivered soles remain within 5 mm of ski
tops through grounded and aerial poses; cuff/leg-axis tests and their actual
mesh-displacement controls pass. Boots plus grounded-tuck checks pass 18/18;
spine and strict 30 mm tuck-entry checks pass 17/17 on the GPU. The boot pixel
instrument now measures the actual ankle cloud rather than the shin center,
uses the visible boot face, and distinguishes navy by chroma under shadow.

Raw-versus-posed skin measurement found the upper-back bulge was partly an arm
attachment error: the ready stance translated the complete arm about 70 mm
backward to bring the hands near the thighs, also translating the shoulder and
sleeve-owned back vertices. A representative back point moved 49.6 mm backward.
Hands now follow with a small rigid arm swing about the shoulder. The side view
in `shots/astra-motion-shoulder/` has substantially less back bulge. The default-
off scapular reshaping experiment was removed; the reproducible v107 build path
passes its existing mesh/profile gates. Deep-squat waist deformation remains
visibly poor and is the next investigation.

## Crash camera review

Wheel, drag, or WASD input during a crash now takes manual camera control;
automatic target-follow, close-up zoom and broadside framing then yield. Free-
look radius extends to 240 m with proportional wheel zoom and radius-adjusted
panning. The GPU interaction test reaches the wide survey view and moves its
target more than a meter without the automatic camera reclaiming it.

Successive terrain-clamped drags preserve the target-height baseline. Releasing
a drag ends the tilt gesture, and an off-canvas release reaches Babylon's DOM
input. The sticky-drag test now uses `button: -1` for pointermove, matching real
browser events; its old default `button: 0` produced artificial button changes.
All six free-look checks pass. The broader landing-lip framing check exposed a
race in its setup: it assigned an uphill heading while automatic crash framing
still owned the camera. It now takes manual control before assigning the review
heading, and is awaiting its next run with the strict projection gate intact.

`tools/capture-skier-crash.js` records actual forced-touchdown gameplay through
crash, rest and recovery, with video, timed screenshots and per-frame driver/
ragdoll data. Baseline footage is in `shots/astra-crash-before/`. Crash/get-up/
walk-off regressions run sequentially to keep their real-time sampling reliable.

The corrected landing-tilt setup passes in all three worlds, including its
negative control and restart reset. The camera group is now 7/7 green. The
latest post-shoulder physics audit remains exact across 30 scenarios / 5,408
frames; all 88 unit tests pass.

Broader crash checks are exposing existing-instrument and motion questions:
triple slide onset is 1.79 s after first ground contact while the test still
expects the superseded 1.4 s rule; final F10 source waits for contact after 0.6 s
or a 4 s emergency wall. The positive chopped-snow speed difference is 12.7%,
inside its 10–20% band, but a separate-run legacy negative control also reaches
11.9%. One late neck-rate sample exceeds 90 degrees/s. These gates remain
unchanged pending baseline comparison and diagnosis; successful boot/pose
checks must not be presented as a fully green crash regression.

## Shared shoulder anchor and aerial endpoint check

The original stable v104 preview passes all four crash/recovery cases that
failed in the first v107 broad run (same tests, GPU renderer). Treat those
working-tree failures as possible pose-seed regressions, not as proven baseline
failures. No crash timing, speed, or motion-rate thresholds were relaxed.

An added airborne endpoint check directly measures rendered driver positions
at tuck 0→0.001 and 0.999→1. It reproduces a 125.27 mm upper-arm jump when the
old P13 shoulder correction switches on. The new shared anatomical shoulder
attachment stays active at both endpoints; arm movement is now 0.2–0.35 mm for
those increments. The same attachment applies after gamepad lateral posing
and to recovery's solved-pose copy, which previously left the engine's fixed
shoulder pivot behind as the rendered torso moved. Grounded tuck motion and
actual delivered sole checks remain green. The new helper is explicitly listed
as renderer-only in the engine-boundary unit test.

Crash relative thigh averaging now uses circular angles as well as wrapped
individual differences: thighs at +179 and -179 degrees must average near
180, not zero. This remains a display-only spine calculation.

Fresh close crash footage is in `shots/astra-crash-current/`; the study camera
shows bunched shoulders during recovery before the shared shoulder correction.
The default get-up/walk-off finishes normally in this recording. A targeted
post-correction crash rerun is in progress.

## Waist skin/UV passes v108 and v109

The central waist initially carried mostly upper-arm weights: a 31 mm edge
collapsed to 3.3 mm in the real squat. Final-coordinate trunk ownership repair
removes that contamination. A complementary pass removes trunk influence from
actual outboard sleeve vertices. Both run before UV zoning and are reasserted
after helper assignment. Several scratch builds correctly failed zero-overlap
or stripe-width checks; none were installed. The accepted UV repair gives the
curved inner shoulder/armpit its own chart, rather than relabeling ownership or
relaxing the zero-overlap gate. The upper-arm stripe retains its specified
minimum width; paint and normal-relief masks use the same authored arc.

v108 and v109 build with all gates green on OptiX / RTX 5070 Ti, 9,097 vertices,
23 bones and zero shared arm/trunk UV texels. Current review footage is
`shots/astra-motion-pass5/`. Numeric worst-edge strain improves from 9.46 to
6.80 to 5.22 across these repairs, but the eye still sees a folded back waist.
Exact visible-triangle picking shows that remaining region is mostly spine/
hip-owned. Clay captures in `shots/astra-clay-pass5/` and the diagnostic rigid-
spine comparison `shots/astra-clay-rigid/` initially isolated deformation from
colour noise. Subsequent recomputed geometric-normal diagnostics, including
welded UV duplicates, confirm that changing the shader does not remove it. Removing the spine bend suppresses much of the paper-like
waist fold. A proper smooth spine curve is being investigated; the rigid-spine
negative control is not being shipped.

## Crash contact correction

The tumble contact solver projected a point out of snow but cleared its stored
vertical velocity only when the previous point was higher. If constraint
projection raised the current point above the previous one, this created an
upward Verlet velocity on the next substep. Snow contact now clears that
artificial rebound on every floor projection. Unchanged slide timing and ski-
brake gates pass all three venues afterward. The late joint-rate gate still
reports an elbow at 2.35 rad/s; the uniform 0.3 m/s post-fold fall cap ignores
that a moving hinge can rotate both adjacent short segments. A per-lever late
cap is staged for verification (head/neck 0.15, arms 0.18, legs 0.25, trunk
0.3 m/s). Gameplay engine/state code remains unchanged.

## Review checkpoint (loop continues)

The bounded spine curve passes its 14 GPU regressions and three targeted unit
cases; adjacent vertebral direction changes are at most 0.20 radians while the
hip/neck closure remains within 3 mm. The visible waist fold is reduced, with a
remaining diagonal seam linked to hip-helper influence high in the abdomen.
The fixed boot test now also verifies unchanged toe/heel mounting stations
through every pose, and rejects both a 3 cm lift and a 3 cm longitudinal slide.

Immediately before deliberately refreshing display traces, the exact audit
compared 30 scenarios / 5,408 frames with zero physics-state differences. The
standing ADR-0005 display-only recapture condition is therefore met. After
capture: 30/30 golden scenarios, 90/90 unit tests, 36/36 integration assertions,
all scenario-distinctness checks, and all five golden mutation controls pass.
The physics engine files are unchanged. This is a review checkpoint on the
working branch, not an all-green merge candidate: the actual crash angular-rate
check still fails in some poses. Full crash traces now retain both simulation
and wall clocks; a sampled neck rate reaches 2.27 rad/s in simulation time, so
this is not dismissed as a wall-clock artifact. Camera checks, boot/pose checks,
and all three crash-rest contact checks are green. Further waist and crash
refinement continues until the requested Pacific-time cutoff.


## Continued crash and visual review, 23:54 UTC

A render-side roll/settle governor now measures the neck, knees and elbows
against the preceding fixed step and limits internal pose corrections, keeping
whole-body translation. Its target is 170 degrees/s in the first fold second
and 60 afterward; existing 220/90-degree test limits are unchanged. Two main
GPU coherence runs pass. The latter actually exercised the governor 36 times,
with an unbounded candidate rate of 10.64 rad/s; the measured post-fold rate is
1.21 rad/s in simulation time. A focused negative control exposes a 600-degree/s
hinge correction when disabled, while rigid travel is preserved exactly.

This candidate remains under review. The broad crash run still fails two early
slide timing/speed cases, before the roll governor activates. A full-trace
inspection also finds a 32 mm neck gap around 5.2 seconds, beyond the older
joint-attachment gate's first-five-second window. Final tumble contact velocity
and additional length/contact convergence are the next checks. All 90 existing
unit cases plus the two new rate-control cases pass. Golden verification is
21/30 against the checkpoint, with expected crash-render divergences; no new
recapture has been performed yet.

Fresh accepted v109 ready/tuck captures from front, quarter and side are in
`shots/astra-current-views/`, generated by `tools/capture-skier-views.js` on the
RTX 5070 Ti. The remaining abdomen/underarm seam is visible from more than one
angle. Pelvis weights, repartitioned spine weights, rigid-abdomen, recomputed
normals and rest-mesh fairing experiments remain isolated; none justifies a
production asset replacement yet. Astra continues the visual refinement loop.


## v110 checkpoint candidate, 00:26 UTC

The accepted armpit build reseats 105 inner-sleeve vertices with geometric and
bone-ownership fades, leaving the torso, hips and outer sleeve unchanged.
Maximum movement is 38.5 mm after three neighbor-smoothing steps. The first
60 mm attempt failed the unchanged sliver gate (64 faces / 0.6612%, limit
0.65%) and was rejected. The accepted 40 mm-cap version has 51 slivers /
0.5269%, better than the previous 54. All build gates pass, including zero UV
overlap, exact bind matrices and 23 bones / 9,097 vertices. The successful
source is installed with all five delivery assets and synchronized v110 tags.
Matched views are in `shots/astra-current-centered/` (v109) and
`shots/astra-pass8b-centered/` (v110). The armpit improvement is localized; the
side-waist fold remains open. All 34 body, boot and spine GPU cases pass.

The spine bound now has a smooth transition into saturation rather than a
hard angular stop. Its neutral response remains exactly linear and its maximum
adjacent turn remains 0.20 radians. Four spine units and 14 spine GPU cases pass.

The crash contact audit found 22 final corrections which reintroduced upward
velocity after contact; the largest point correction corresponded to 61.3 m/s
of artificial next-substep velocity. Final-contact points now clear that
residual after shape/neck polishing. Both head-floor checks also read the radius
from the head particle rather than its position vector (the previous undefined
radius made the comparison silently false). Six roll/settle length-contact
passes replace two. The rate governor's final floor correction now lifts its
bounded pose uniformly: the earlier independent point clamps stretched the
short neck constraint near the roll-out. The extended attachment gate covers
the full crash and stopped tail, not just the first five seconds. A passing
trace has a 10.1 mm maximum visible gap (the intended neck offset), less than
0.46 mm constraint residual and a maximum 0.33 mm corrective floor lift.

The subsequent 27-case crash/recovery/walk-off run is 26/27: all slide timing,
rough-snow speed, contact, recovery, framing and negative controls pass. Only
the late raw wall-clock joint-rate gate fails at 1.657 rad/s versus 1.571; the
same interval advances 25 ms of fixed-step time over 15.8 ms of wall time, with
simulation rate 1.049 rad/s. The next candidate lowers the late solver target
60 to 50 degrees/s to leave cadence margin. The 90-degree gate is unchanged.
A speculative 1.4-second post-contact tumble deadline was rejected: a CPU
input-cadence sweep bounded onset but left one pose propped for 14 seconds.
A contact-tangent alternative moved the timing failure between venues and was
also rejected. Neither is present in production.

The lightweight golden harness lacked root freeze/unfreeze, quaternion set,
and scene.getEngine APIs. It could silently discard a ragdoll at rest and hide
recovery failures in window._crashErr. Its inert rendering API is now complete
for that path, and run-scenario treats a crash-render exception as a failed
trace. Three regressions cover retained rest, default recovery, and the missing
API negative control. The corrected harness compares all 30 scenarios / 5,408
frames with zero physics-state differences. All 96 unit cases pass. Traces have
not yet been recaptured for this checkpoint candidate.

Matched side-camera crash films are `shots/astra-crash-baseline-side/` and
`shots/astra-crash-v110/`. They include full recovery and walk-off; tumble
orientations differ, so they are camera-matched reviews rather than identical
pose comparisons. Remaining waist/hip suit distortion is visible in folded
poses. The local review page now has six-view before/current comparisons and
links to both films. The charged-layout flight fixture fails with zero live
ride-out frames on the stable v104 server as well as the working tree; it is
recorded as a reproduced baseline fixture issue, without changing gameplay.

A later instrument check found that _airHold retained the ready scene's 22-degree
ski quaternions, unlike the production flight handoff. It now clears them before
pinning and refreshes spine/helpers after the final pose correction; pose-shots
uses this same production order. Earlier CPU pike/air conclusions from the stale
frame are superseded. Corrected snapshots justify re-evaluating the isolated
pelvis/waist candidate across all five pose families before accepting it.


## Late author feedback: lean waist, knee grasp, resolution and crotch

The author rejected both earlier waist previews as too full at the seat/waist,
accepted both tuck poses, asked for hands closer to or on the knees, and asked
to remove the apparent crossbar behind the bindings. v111 contracts 671
waist/seat vertices (maximum displacement 38.8 mm; peak width/depth reductions
18%/24%) with bone ownership excluding the arms. Outer torso and accepted leg
poses remain. All standard build gates pass on the RTX 5070 Ti with OptiX:
49/9679 sliver faces, zero arm/trunk UV overlap, exact bind matrices. A duplicate
face deletion in the existing suit de-overlap export helper was deduplicated.
The earlier isolated pelvis-weight pass was not shipped.

The render-only knee-grasp IK keeps shoulder and limb lengths fixed. Actual
flight wrist-to-knee distance is 25 mm; grounded wrists reach 33/84 mm given
the fixed right arm reach. The author accepted the tuck shapes, so reaching
farther by moving the whole torso or stretching arms was avoided. A final
endpoint test exposed the pre-existing exact-air-endpoint leg closure branch:
its 8–9 mm knee jump became 13.36 mm with hand IK. Applying that closure
consistently airborne reduced the worst arm endpoint step below 1.8 mm.
The unchanged 10 mm gate, live ground entry/release, grasp, chain and negative
controls all pass (6/6, /tmp/astra-v111-endpoint-fixed.log). Earlier focused
sole/leg tests passed on the lean mesh; final endpoint source needs its final
combined verification. Both ski-brake crossbars are removed; bindings remain.

The author reports blur when zooming in Safari. The adapter previously treated
normal 16.7 ms / 60 Hz presentation as overload because its threshold was 14 ms,
progressively giving away Retina resolution. The threshold is now 22 ms, with
existing 2x device pixel ratio rendering and recovery intact. A regression
feeds ten seconds of normal 60 Hz frames before testing actual overload and
recovery. Safari itself has not been exercised on this Linux GPU host.

Live server check: 8200 serves v111; 8201 currently serves the older v109
snapshot (earlier notes describing that port as v104 are stale). The user's
hostname is buypower.lan.phq.org. Crash controls: right-drag/Ctrl-drag pan,
left-drag orbit, scroll zoom; user input cancels automatic camera steering.
The latest seven camera checks pass. New feedback about excessive inner-thigh
gap is assigned to Astra for a local garment-shape pass, preserving ski stance.

Final pre-recapture audit after the endpoint and resolution corrections:
30 scenarios / 5,408 frames, zero gameplay physics-state differences; 98/98
unit tests pass. Display goldens are deliberately refreshed under ADR-0005.
Full crash verification, final mesh checks and quality regression are pending.


Final crash run update: main joint-speed gates now pass (late wall-clock
0.970 rad/s versus 1.571; early five-frame average 2.48 versus 3.84 (raw peak 3.28)). Rest is reached at 7.28 s.
A separate slide-onset gate fails: first roll at t=2.175, first ground contact
at 0.575, giving 1.600 s against 1.55 s. The trace shows a post-contact airborne
rebound before returning to the floor. This is not just a rate measurement
issue. Do not hide it by widening the gate or reviving the rejected deadline
that froze a propped pose. Full result will be appended after the run ends.
The three world timing, chopped-snow speed, ground contact and rest framing
checks have passed in this run. All 30 recaptured display goldens verify,
36 browser integration tests pass, and all five deliberate mutations are caught.


Crash suite completed: 22/23 pass in 9.1 minutes; only the 1.600-second
post-contact slide onset above remains red. All three default and optional-v4
recovery forensics and their negative controls pass. A separate inspection of
the saved main trace gives a maximum joint gap of 10.49 mm (neck), below the
20 mm attachment bound through the full crash and stopped tail; that assertion
is after the failing onset assertion in the combined test, so this is recorded
as an independent trace measurement rather than claiming the whole test passed.


Resolution verification: four focused quality checks pass on the NVIDIA GPU
(/tmp/astra-final-quality.log). A DPR=2 context keeps a 640x440 backing canvas
for a 320x220 viewport after ten seconds of simulated 60 Hz presentation;
normal frames cause no quality reduction. Actual overload still reduces scale,
and headroom restores it. GPU frame timing at the standard DPR=1 test viewport:
mean16.6 ms, p95 18.4 ms, 60.1 fps. This confirms the adapter and Retina backing
resolution behavior in Chromium; Safari-specific confirmation remains by user
review. Camera help now documents pan and zoom gestures.


## Final crotch candidate — not promoted after GPU review

The author reported an excessively open inner-thigh/crotch contour. The
v111 delivery is watertight (zero boundary loops), so the inspected problem
is its garment silhouette rather than a missing mesh face. The existing
leg template opens at a station 90 mm below the hip and retains a 3-degree
A-frame; the candidate preserved that stance, all joints, ski bindings,
outer thigh breadth, and the accepted tuck poses.

Crotch12 added at most 12 mm of medial fullness to the upper inner thighs.
The initial spatial-only mask failed the required hip-fold population gate
and was rejected. Restricting the same adjustment to inward-facing surface
normals preserved those anterior creases: 194 source vertices moved, all
11 fold bands were measured (mean 1.97 mm against the 1.9 mm floor), slivers
remained 49/9679, arm/trunk UV overlap stayed zero, and the 9094-vertex,
23-bone asset exported with exact bind matrices on the RTX 5070 Ti/OptiX.
CPU checks on the delivery-space approximation found no reversed triangles
or new midline crossings in ready, stationary tuck, air tuck, pike, or in-run.

Matched GPU images are in `shots/astra-crotch-before-centered/` and
`shots/astra-crotch12-centered/`. Ready/tuck front and quarter views showed
a modest reduction in the opening, but introduced a conspicuous dark
triangular mark on the inner left-image thigh just above the knee. The mark
disappears in `shots/astra-crotch12-clay/ready-front.png`, identifying a
baked-map artifact rather than a physical hole. The remaining cup-like
crotch contour also was not convincingly resolved. The candidate was not
promoted; production keeps the v111 body assets. This concern remains open,
and no further speculative mesh passes were started after the requested
loop cutoff.

Candidate source: `/tmp/astra-crotch12-candidate.py`; build log and first
failed log: `/tmp/astra-body-pass12/`. Body SHA-256:
`ed1decde6303a66b721acf75814cee470833c47a54b4bd856648112bfcd65f56`.
Source SHA-256:
`5fb72b220c472a7eaf4c4d800bc3143f0de1e7e1246df0d0bd65339923d468b3`.
The candidate and hashes are evidence only, not the production delivery.


## Final v112 checkpoint

The client is v112, serving the accepted v111 Lean11 body assets. Port8200
is the working branch; port8201 remains an older v109 snapshot. No merge or
push is part of this checkpoint. The refinement loop ended at the requested
18:00 Pacific local cutoff; the final minutes complete validation/artifacts.

Final focused GPU run:18/18 pass in3.3 minutes
(/tmp/astra-v112-final-pose-walkoff.log): continuous body loading/deformation
and suit placement, actual skinned toe/heel contact through40 ground/air/pike
stations with negative controls, cuff/shin alignment, tuck endpoints and live
entry/release, grounded/air knee grasp, and all-world walk-off/negative controls.
Quality4/4 and camera7/7 also pass. Unit98/98, display golden30/30,
integration36/36, and all5 mutation controls pass. The exact gameplay state
audit remains0 differences over30 scenarios/5,408 frames; engine files are
unchanged. Combining the final crash and walk-off suites gives26/27 pass;
the single unresolved rebound/onset failure is detailed above. Do not label
this checkpoint fully green or merge-ready.

Remaining visual concerns: the crotch opening/cup contour and some waist/seat
folding remain; the final crotch candidate was rejected. Safari itself is not
available on this Linux host, so the resolution fix is verified through a
Retina Chromium context and awaits the author's Safari visual review.

Fresh actual-keyboard tuck footage is in `shots/astra-motion-v112/`; final
crash-through-recovery footage is in `shots/astra-crash-v112/`. Both use
the confirmed RTX5070Ti ANGLE/Vulkan renderer. The local
`shots/astra-review.html` links the current films and six-view comparison.
